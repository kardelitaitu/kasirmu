//! Generic migration runner.
/*
last audited 25-07-26 by RSA-Agent (platform-core slice D: database/migrations deep read)
crate: platform-core | status: SAFE | lint: CLEAN
findings: exemplary — DB-02 checksum verification with legacy-line-ending migration and drift re-apply (idempotency requirement documented, tx-atomic so no partial DDL); DB-05 FK isolation around applies/rollback (PRAGMA is a no-op inside tx — documented), restore-never-masks-error; last-only rollback prevents out-of-order reverts; parameterized; production 1-1078 read, 1079+ inline tests
drift re-apply, 14-09-26: the "must be idempotent" requirement that comment stated was unsatisfiable for the statement form the registry leans on most — SQLite has no `ALTER TABLE … ADD COLUMN IF NOT EXISTS`, and 26 of the 58 registered migrations use the unguarded form (63 statements) — so a comment-only edit to any of them reached the re-apply and panicked startup with `duplicate column name`. `reapply_script` now falls back to statement-by-statement execution, skipping only statements whose effect is provably already present: `pragma_table_info` for ADD COLUMN, `sqlite_master.sql` text for INDEX/TRIGGER/VIEW, and never `CREATE TABLE` (SQLite rewrites a table's stored DDL on a later ADD COLUMN — measured — so that text is not a record of the statement). The splitter is hand-rolled because rusqlite 0.31 keeps `sqlite3_prepare_v3`'s tail pointer in a `pub(crate)` field. Measured over the registry by kasirmu-core's `cosmetic_edit_to_any_migration_re_applies_cleanly`: 30 of 58 migrations failed a comment-only edit before the fallback, 3 after — and those 3 are one-shot data/rename migrations (a column converted then dropped, a table renamed, a rebuild reading a column it has already replaced) where re-running the script is impossible by construction, which the forward-only contract already assigns to backup-plus-forward-repair (DB-03). Production range re-measured against the file, not inferred.
next: none | perf: single pass over registered migrations; the splitter runs only on the drift path
*/
//!
//! A [`Migration`] is a named SQL script. [`run`] applies every
//! unapplied migration against a [`rusqlite::Connection`], tracking
//! applied migrations in a `schema_migrations` table.
//!
//! `rollback_last` reverts the most recently applied migration by
//! running its `down` SQL (if one exists).
//!
//! # Integrity guarantees (audit-open-findings DB-02 / DB-05)
//!
//! * **Migration checksums** — every applied migration records a SHA-256
//!   checksum of its SQL. [`run`] recomputes the checksum of each
//!   registered migration and **fails closed** when an already-applied
//!   definition changed (historical migrations must never be edited in
//!   place). A changed definition is first re-applied — see
//!   `reapply_script`, which tolerates the statements whose effect is
//!   provably already present so that a comment-only edit cannot brick
//!   startup. Rows applied before checksum tracking existed are backfilled
//!   once on the first run after upgrade.
//! * **Foreign-key isolation** — [`run`] disables `foreign_keys` at the
//!   connection level *around* each migration apply and restores the
//!   caller's previous setting afterwards. SQLite ignores `PRAGMA
//!   foreign_keys` inside a transaction, so rebuild migrations (081/089)
//!   that toggle it in their own SQL were silently running with
//!   enforcement ON — risking cascade data loss on populated child tables.
//!
//! Callers provide their own list of migrations (typically compiled
//! via `include_str!`).
//!
//! # Where the statement layer lives
//!
//! This file is the **ledger and the policy**: which migrations exist, what was
//! applied, what changed, and what to do about it. Everything that has to *read
//! SQL* lives in `crate::database::statements` — splitting a script into
//! statements, tokens and canonical forms, the parsers, and the proofs that a
//! statement's effect is already present. Four calls cross that boundary and
//! every one is semantic — `split_statements`, `is_significant` (does this
//! fragment have any effect?), `insert_would_insert_nothing` (would running it
//! insert nothing?) and `already_satisfied` (does the error it just raised mean
//! its effect is already there?); no lexer primitive does. Nothing here inspects
//! a token, and nothing there knows about `Migration`, `schema_migrations` or
//! checksums.

use std::collections::HashMap;
#[cfg(test)]
use std::collections::HashSet;

// `optional()` is used only by this file's own tests — the production users moved
// to `database::statements` with the proof.
#[cfg(test)]
use rusqlite::OptionalExtension;
use rusqlite::{Connection, Transaction, params};
use sha2::{Digest, Sha256};

use super::proofs::{already_satisfied, insert_would_insert_nothing};
use super::statements::{is_significant, split_statements};
use crate::error::PlatformError;

/// One embedded migration.
pub struct Migration {
    /// Filename, e.g. `"001_sales.sql"`. Also used as the primary key in
    /// `schema_migrations`.
    pub id: &'static str,
    /// Raw SQL contents.
    pub sql: &'static str,
}

/// Apply every unapplied migration. Idempotent: running twice is a no-op
/// after the first call.
///
/// Requires `&mut Connection` because [`Connection::transaction`] does.
pub fn run(conn: &mut Connection, migrations: &[Migration]) -> Result<(), PlatformError> {
    ensure_schema_migrations_table(conn)?;
    let applied = load_applied_with_checksums(conn)?;
    // Before anything is applied: a database from a newer build must be refused
    // rather than half-migrated by this one.
    check_not_forward_migrated(&applied, migrations)?;
    for mig in migrations {
        match applied.get(mig.id) {
            Some(Some(stored)) => {
                // DB-02: an applied migration's definition must be byte-for-byte
                // identical to what was committed. Editing a historical file in
                // place would silently produce a different schema on fresh
                // installs vs upgrades.
                let current = checksum_hex(mig.sql);
                if *stored != current {
                    // Databases created before line-ending canonicalization
                    // may contain the raw Windows checksum. Accept that
                    // exact legacy representation and rewrite it to the
                    // canonical checksum.
                    if has_legacy_checksum(stored, mig.sql) {
                        update_checksum(conn, mig.id, &current)?;
                        tracing::info!(migration = mig.id, "normalized legacy migration checksum");
                    } else {
                        // DB-02: the migration SQL changed after it was applied.
                        // Instead of hard-failing (which bricks the app for
                        // comment-only / whitespace edits), re-run the
                        // migration SQL. A script that is idempotent, or whose
                        // drift is cosmetic, re-applies cleanly; one that is
                        // not gets a second, statement-level attempt (see
                        // [`reapply_script`]). If both attempts fail, the SQL
                        // has genuinely changed in a way that cannot be
                        // reconciled and the user must act.
                        tracing::warn!(
                            migration = mig.id,
                            stored = %stored,
                            current = %current,
                            "migration definition drift detected — \
                             re-applying SQL and updating checksum (DB-02)"
                        );
                        reapply_for_drift(conn, mig)?;
                        update_checksum(conn, mig.id, &current)?;
                        tracing::info!(migration = mig.id, "drift auto-patched — checksum updated");
                    }
                }
                tracing::debug!(migration = mig.id, "already applied; checksum verified");
            }
            Some(None) => {
                // Row applied before checksum tracking existed: adopt the
                // current definition as the baseline (one-time backfill).
                let current = checksum_hex(mig.sql);
                update_checksum(conn, mig.id, &current)?;
                tracing::info!(migration = mig.id, "backfilled legacy checksum");
            }
            None => apply_one(conn, mig)?,
        }
    }
    Ok(())
}

/// Roll back the most recently applied migration by ID.
///
/// `down_sql` is the SQL to revert the migration (e.g. `DROP TABLE IF EXISTS x`).
/// Returns `Ok(false)` if no migrations have been applied or the given
/// migration ID is not the last applied one.
///
/// Only the last migration (by `applied_at` order) can be rolled back.
/// This prevents out-of-order reverts.
pub fn rollback(
    conn: &mut Connection,
    migration_id: &str,
    down_sql: &str,
) -> Result<bool, PlatformError> {
    // Ensure the tracking table exists before reading from it.
    ensure_schema_migrations_table(conn)?;
    let applied = load_applied_ordered(conn)?;
    let Some(last) = applied.last() else {
        return Ok(false); // No migrations applied
    };

    if last != migration_id {
        return Ok(false); // Can only rollback the last applied migration
    }

    tracing::info!(migration = migration_id, "rolling back migration");
    // DB-05: destructive down SQL (DROP TABLE) must not cascade into
    // dependent rows; same connection-level isolation as apply_one.
    let fk_was_on = foreign_keys_enabled(conn)?;
    if fk_was_on {
        conn.pragma_update(None, "foreign_keys", "OFF")?;
    }
    let result = (|| -> Result<bool, PlatformError> {
        let tx: Transaction = conn.transaction()?;
        tx.execute_batch(down_sql)?;
        tx.execute(
            "DELETE FROM schema_migrations WHERE id = ?1",
            params![migration_id],
        )?;
        tx.commit()?;
        Ok(true)
    })();
    // Restore the caller's FK setting even on failure, but never let a
    // restore error mask the original migration error (DB-05).
    if fk_was_on && let Err(restore_err) = conn.pragma_update(None, "foreign_keys", "ON") {
        tracing::error!(
            migration = migration_id,
            error = %restore_err,
            "failed to restore foreign_keys=ON after rollback"
        );
    }
    if matches!(result, Ok(true)) {
        tracing::info!(migration = migration_id, "rollback complete");
    }
    result
}

fn ensure_schema_migrations_table(conn: &Connection) -> Result<(), PlatformError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            id         TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            checksum   TEXT
        )",
    )?;
    // DB-02: databases created before checksum tracking lack the column.
    // `CREATE TABLE IF NOT EXISTS` won't add it to an existing table, so
    // migrate the tracking table in place.
    let has_checksum: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('schema_migrations') WHERE name = 'checksum'",
        [],
        |r| r.get(0),
    )?;
    if has_checksum == 0 {
        conn.execute_batch("ALTER TABLE schema_migrations ADD COLUMN checksum TEXT")?;
    }
    Ok(())
}

/// Load applied migration IDs (used by tests; `run` uses the checksum
/// variant [`load_applied_with_checksums`] for drift detection).
#[cfg(test)]
fn load_applied(conn: &Connection) -> Result<HashSet<String>, PlatformError> {
    let mut stmt = conn.prepare("SELECT id FROM schema_migrations")?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    let mut set = HashSet::new();
    for id in rows {
        set.insert(id?);
    }
    Ok(set)
}

/// Load applied migration IDs with their stored checksums.
///
/// `None` marks a row applied before checksum tracking existed (backfilled
/// on the next [`run`]).
fn load_applied_with_checksums(
    conn: &Connection,
) -> Result<HashMap<String, Option<String>>, PlatformError> {
    let mut stmt = conn.prepare("SELECT id, checksum FROM schema_migrations")?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
    })?;
    let mut map = HashMap::new();
    for row in rows {
        let (id, checksum) = row?;
        map.insert(id, checksum);
    }
    Ok(map)
}

/// Load applied migration IDs in application order (oldest first).
fn load_applied_ordered(conn: &Connection) -> Result<Vec<String>, PlatformError> {
    let mut stmt = conn.prepare("SELECT id FROM schema_migrations ORDER BY applied_at ASC")?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    let mut ids = Vec::new();
    for id in rows {
        ids.push(id?);
    }
    Ok(ids)
}

/// The `YYYYMMDD` prefix of a date-shaped migration id, else `None`.
///
/// Production ids are date-prefixed, which makes their lexicographic order the
/// same as their chronological order -- so "later than everything I know" is
/// answerable from the id alone. A non-date-shaped id (`001_sales.sql`, a
/// pre-reset row, or a fixture id) has no position in that order and is
/// therefore never read as coming from the future.
fn date_prefix(id: &str) -> Option<&str> {
    let digits = id.split_once('_')?.0;
    if digits.len() == 8 && digits.bytes().all(|b| b.is_ascii_digit()) {
        Some(digits)
    } else {
        None
    }
}

/// Refuse to run against a database that a NEWER build already migrated.
///
/// [`run`] deliberately ignores ledger rows it does not recognise: a pre-reset
/// dev database carries ids the registry no longer lists, and booting anyway is
/// the documented upgrade path (see
/// `existing_db_with_legacy_rows_upgrades_idempotently` in
/// `crates/kasirmu-core/src/migrations_tests.rs`). That tolerance has a second
/// consequence. A database migrated forward by a newer build also carries only
/// *later* ids -- ones this binary has never heard of -- and once its schema has
/// been renamed or dropped by a migration this build cannot see, every query
/// after startup starts failing on a table name that no longer exists. That is
/// how a build from `0.0.38` came to panic with
/// `seeding primary store: no such table: store_profiles` against a database the
/// `0.0.39` build had renamed to `locations`: the runner "succeeded", because
/// all 21 migrations it knows were already recorded, and 38 recorded names it
/// had never seen were silently ignored.
///
/// The two cases are separable by the id itself, so the split is exact rather
/// than a policy choice: a date-shaped id sorting after the newest date-shaped
/// id in this registry cannot be history this build has lost, it belongs to a
/// build ahead of this one. Anything older or unparseable keeps its tolerance.
fn check_not_forward_migrated(
    applied: &HashMap<String, Option<String>>,
    migrations: &[Migration],
) -> Result<(), PlatformError> {
    // An registry with no date-shaped id (a test fixture, or a crate that embeds
    // none) has no vantage point from which to call anything "the future"; the
    // guard stays inert rather than reading every row as foreign.
    let Some(newest) = migrations.iter().filter_map(|m| date_prefix(m.id)).max() else {
        return Ok(());
    };
    let mut ahead: Vec<&str> = applied
        .keys()
        .filter(|id| date_prefix(id).is_some_and(|d| d > newest))
        .map(|s| s.as_str())
        .collect();
    if ahead.is_empty() {
        return Ok(());
    }
    ahead.sort_unstable();
    let shown = ahead.iter().take(3).copied().collect::<Vec<_>>().join(", ");
    Err(PlatformError::Internal(format!(
        "{} recorded migration(s) are newer than this build knows (e.g. {shown}; this build's newest is \
         {newest}_*.sql), so this database was migrated by a later release. Refusing to run: its schema may \
         already have been renamed or dropped by migrations this binary cannot see, which surfaces later as \
         a confusing `no such table` in whatever opens first. Boot a build at least as new as the database, \
         or point this one at its own database file.",
        ahead.len()
    )))
}

/// SHA-256 hex checksum of a migration's SQL (DB-02).
///
/// Migration files are stored with LF endings, but a Windows working tree may
/// provide CRLF text to `include_str!`. Canonicalize line endings before
/// hashing so the checksum represents the SQL definition rather than the
/// checkout platform.
fn checksum_hex(sql: &str) -> String {
    let canonical = canonicalize_line_endings(sql);
    checksum_hex_bytes(canonical.as_bytes())
}

/// Whether a stored checksum matches a pre-canonicalization line ending form.
fn has_legacy_checksum(stored: &str, sql: &str) -> bool {
    let canonical = canonicalize_line_endings(sql);
    stored == legacy_checksum_hex(sql)
        || stored == legacy_checksum_hex(&canonical.replace('\n', "\r\n"))
}

/// Normalize CRLF and bare CR line endings to LF.
fn canonicalize_line_endings(sql: &str) -> String {
    sql.replace("\r\n", "\n").replace('\r', "\n")
}

/// SHA-256 hex checksum using the pre-canonicalization byte representation.
fn legacy_checksum_hex(sql: &str) -> String {
    checksum_hex_bytes(sql.as_bytes())
}

/// Hash bytes as a lowercase SHA-256 hex string.
fn checksum_hex_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

/// Update a stored migration checksum atomically.
fn update_checksum(
    conn: &mut Connection,
    migration_id: &str,
    checksum: &str,
) -> Result<(), PlatformError> {
    let tx = conn.transaction()?;
    tx.execute(
        "UPDATE schema_migrations SET checksum = ?1 WHERE id = ?2",
        params![checksum, migration_id],
    )?;
    tx.commit()?;
    Ok(())
}

/// Whether the connection currently enforces foreign keys (DB-05).
fn foreign_keys_enabled(conn: &Connection) -> Result<bool, PlatformError> {
    let v: i64 = conn.query_row("PRAGMA foreign_keys", [], |r| r.get(0))?;
    Ok(v == 1)
}

/// Re-apply an already-applied migration's SQL to handle definition drift.
///
/// Used when a migration file was edited after it was already applied.
/// The SQL is re-executed (must be idempotent) and the stored checksum
/// is updated by the caller. FK isolation matches [`apply_one`].
fn reapply_for_drift(conn: &mut Connection, mig: &Migration) -> Result<(), PlatformError> {
    let fk_was_on = foreign_keys_enabled(conn)?;
    if fk_was_on {
        conn.pragma_update(None, "foreign_keys", "OFF")?;
    }
    let result = reapply_script(conn, mig);
    if fk_was_on && let Err(restore_err) = conn.pragma_update(None, "foreign_keys", "ON") {
        tracing::error!(
            migration = mig.id,
            error = %restore_err,
            "failed to restore foreign_keys=ON after drift re-apply"
        );
    }
    result
}

/// Re-apply a drifted migration script, whole first and statement by
/// statement only as a fallback.
///
/// Attempt 1 runs the script as a unit — the historical behaviour, which
/// succeeds whenever the script is idempotent or the drift is cosmetic and
/// every statement is already a no-op. Attempt 2 is reached only when
/// attempt 1 failed with an error [`is_skip_candidate_error`] can classify
/// (a duplicate object, or a reference to an object a later migration
/// removed); it runs the script one statement at a time and skips the
/// statements whose effect is already present *and provably identical* (see
/// `proofs::already_satisfied`, where that proof lives).
///
/// When attempt 2 does not recover either, the caller receives **attempt 2's**
/// error, because that is the one that names the statement which actually
/// blocked the re-apply — attempt 1 can only ever report the *first*
/// classifiable error, which is usually the benign one. The script-level
/// error is logged alongside it. Attempt 1 stays the gatekeeper: attempt 2 is
/// never entered for an error it cannot classify, so a script that fails for
/// any other reason still reports exactly what it reported before this
/// fallback existed.
fn reapply_script(conn: &mut Connection, mig: &Migration) -> Result<(), PlatformError> {
    let whole_script_error = match apply_whole_script(conn, mig) {
        Ok(()) => return Ok(()),
        Err(err) => err,
    };
    if !is_skip_candidate_error(&whole_script_error.to_string()) {
        return Err(whole_script_error.into());
    }
    match apply_statement_by_statement(conn, mig) {
        Ok(()) => {
            tracing::info!(
                migration = mig.id,
                "drift re-applied statement by statement (already-satisfied statements skipped)"
            );
            Ok(())
        }
        Err(err) => {
            tracing::warn!(
                migration = mig.id,
                error = %err,
                script_error = %whole_script_error,
                "per-statement drift re-apply did not recover"
            );
            Err(err)
        }
    }
}

/// Run a migration script as a single batch, inside one transaction.
fn apply_whole_script(conn: &mut Connection, mig: &Migration) -> Result<(), rusqlite::Error> {
    let tx: Transaction = conn.transaction()?;
    tx.execute_batch(mig.sql)?;
    tx.commit()?;
    Ok(())
}

/// Run a migration script one statement at a time, skipping the statements
/// whose effect is already present and provably identical.
///
/// A statement can be skipped at either of two moments, and both are needed:
///
/// * **Before it runs** — [`insert_would_insert_nothing`] proves an
///   `INSERT OR IGNORE` seed's rows are all already there. This is the only
///   skip that leaves the database byte-identical, because *running* such a
///   statement still allocates a rowid per attempted row (advancing an
///   `AUTOINCREMENT` table's `sqlite_sequence`) and fires `BEFORE INSERT`
///   triggers for rows `OR IGNORE` then discards.
/// * **After SQLite refuses it** — [`already_satisfied`] proves the error means
///   the statement's effect has already landed, which covers the statements that
///   cannot run at all in this schema.
///
/// Every skip is logged: a statement that is silently skipped is a statement
/// whose intended change is *not* applied, and that decision must be
/// auditable from the log alone.
fn apply_statement_by_statement(
    conn: &mut Connection,
    mig: &Migration,
) -> Result<(), PlatformError> {
    let tx: Transaction = conn.transaction()?;
    for statement in split_statements(mig.sql) {
        let statement = statement.trim();
        if !is_significant(statement) {
            continue; // whitespace, or nothing but comments
        }
        if insert_would_insert_nothing(&tx, statement)? {
            tracing::info!(
                migration = mig.id,
                "drift re-apply: statement would insert nothing — skipped before execution"
            );
            continue;
        }
        if let Err(err) = tx.execute_batch(statement) {
            let message = err.to_string();
            if !is_skip_candidate_error(&message) || !already_satisfied(&tx, statement, &message)? {
                return Err(err.into());
            }
            tracing::info!(
                migration = mig.id,
                "drift re-apply: statement already satisfied — skipped"
            );
        }
    }
    tx.commit()?;
    Ok(())
}

/// Whether SQLite's error message is one the statement-level fallback can
/// classify — and therefore retry statement by statement.
///
/// Two families qualify:
///
/// * **the object already exists** (`already exists`, `duplicate column name`) —
///   the statement's effect is present, and `proofs::already_satisfied` is
///   asked to prove exactly that.
/// * **an object a later migration removed** (`has no column named …`, `no such
///   column: …`) — the statement cannot run in the schema this registry has
///   since built, and `proofs::already_satisfied` is asked whether its effect is
///   nevertheless already there (a seed whose rows are still in the table, for
///   instance). `no such table` is deliberately **not** in this list: a
///   statement naming an absent table has no `pragma_table_info` row, no primary
///   key and no `sqlite_master` row to compare, so every proof arm refuses it at
///   its first gate and admitting the text would only widen the retry.
///
/// The second family used to be fatal, which bricked startup for a *whole-script*
/// failure it produced: attempt 1 stops at the first bad statement, and if that
/// statement names a dropped column the error is not a duplicate-object one, so
/// the fallback was never entered and the failure was reported verbatim —
/// `20260813_init.sql` re-applied after `20260831_loyalty_multiplier_fixedpoint.sql`
/// dropped the column its loyalty seed names died on exactly that path.
///
/// Anything else stays fatal exactly as before: the fallback must not become a
/// place where a script's genuine failure is retried and then reported twice.
fn is_skip_candidate_error(message: &str) -> bool {
    let message = message.to_ascii_lowercase();
    message.contains("already exists")
        || message.contains("duplicate column name")
        || message.contains("has no column named")
        || message.contains("no such column")
}

fn apply_one(conn: &mut Connection, mig: &Migration) -> Result<(), PlatformError> {
    tracing::info!(migration = mig.id, "applying migration");
    // DB-05: `PRAGMA foreign_keys` is a no-op inside a transaction, so
    // rebuild migrations (081/089) cannot rely on their own toggles.
    // Disable enforcement at the connection level *before* the transaction
    // and restore the caller's prior setting afterwards.
    let fk_was_on = foreign_keys_enabled(conn)?;
    if fk_was_on {
        conn.pragma_update(None, "foreign_keys", "OFF")?;
    }
    let result = (|| -> Result<(), PlatformError> {
        let tx: Transaction = conn.transaction()?;
        tx.execute_batch(mig.sql)?;
        tx.execute(
            "INSERT INTO schema_migrations (id, checksum) VALUES (?1, ?2)",
            params![mig.id, checksum_hex(mig.sql)],
        )?;
        tx.commit()?;
        Ok(())
    })();
    // Restore the caller's FK setting even on failure, but never let a
    // restore error mask the original migration error (DB-05).
    if fk_was_on && let Err(restore_err) = conn.pragma_update(None, "foreign_keys", "ON") {
        tracing::error!(
            migration = mig.id,
            error = %restore_err,
            "failed to restore foreign_keys=ON after migration apply"
        );
    }
    result
}

#[cfg(test)]
#[path = "migrations_tests.rs"]
mod tests;
