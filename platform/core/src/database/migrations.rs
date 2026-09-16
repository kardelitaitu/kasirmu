//! Generic migration runner.
/*
last audited 25-07-26 by RSA-Agent (platform-core slice D: database/migrations deep read)
crate: platform-core | status: SAFE | lint: CLEAN
findings: exemplary — DB-02 checksum verification with legacy-line-ending migration and drift re-apply (idempotency requirement documented, tx-atomic so no partial DDL); DB-05 FK isolation around applies/rollback (PRAGMA is a no-op inside tx — documented), restore-never-masks-error; last-only rollback prevents out-of-order reverts; parameterized; production 1-1078 read, 1079+ inline tests
drift re-apply, 14-09-26: the "must be idempotent" requirement that comment stated was unsatisfiable for the statement form the registry leans on most — SQLite has no `ALTER TABLE … ADD COLUMN IF NOT EXISTS`, and 26 of the 58 registered migrations use the unguarded form (63 statements) — so a comment-only edit to any of them reached the re-apply and panicked startup with `duplicate column name`. `reapply_script` now falls back to statement-by-statement execution, skipping only statements whose effect is provably already present: `pragma_table_info` for ADD COLUMN, `sqlite_master.sql` text for INDEX/TRIGGER/VIEW, and never `CREATE TABLE` (SQLite rewrites a table's stored DDL on a later ADD COLUMN — measured — so that text is not a record of the statement). The splitter is hand-rolled because rusqlite 0.31 keeps `sqlite3_prepare_v3`'s tail pointer in a `pub(crate)` field. Measured over the registry by oz-core's `cosmetic_edit_to_any_migration_re_applies_cleanly`: 30 of 58 migrations failed a comment-only edit before the fallback, 3 after — and those 3 are one-shot data/rename migrations (a column converted then dropped, a table renamed, a rebuild reading a column it has already replaced) where re-running the script is impossible by construction, which the forward-only contract already assigns to backup-plus-forward-repair (DB-03). Production range re-measured against the file, not inferred.
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

use std::collections::HashMap;
#[cfg(test)]
use std::collections::HashSet;

use rusqlite::{Connection, OptionalExtension, Transaction, params};
use sha2::{Digest, Sha256};

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
/// `crates/oz-core/src/migrations_tests.rs`). That tolerance has a second
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
/// attempt 1 failed with a duplicate-object error; it runs the script one
/// statement at a time and skips the statements whose effect is already
/// present *and provably identical* (see [`already_satisfied`]).
///
/// When attempt 2 does not recover either, the caller receives **attempt 2's**
/// error, because that is the one that names the statement which actually
/// blocked the re-apply — attempt 1 can only ever report the *first*
/// duplicate-object error, which is usually the benign one. The script-level
/// error is logged alongside it. Attempt 1 stays the gatekeeper: attempt 2 is
/// never entered unless attempt 1 failed with a duplicate-object error, so a
/// script that fails for any other reason still reports exactly what it
/// reported before this fallback existed.
fn reapply_script(conn: &mut Connection, mig: &Migration) -> Result<(), PlatformError> {
    let whole_script_error = match apply_whole_script(conn, mig) {
        Ok(()) => return Ok(()),
        Err(err) => err,
    };
    if !is_duplicate_object_error(&whole_script_error) {
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
        if statement.is_empty() || canonical_ddl(statement).is_empty() {
            continue; // whitespace or a trailing comment
        }
        if let Err(err) = tx.execute_batch(statement) {
            if !is_duplicate_object_error(&err) || !already_satisfied(&tx, statement, &err)? {
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

/// Whether a SQLite error reports that the object a statement declares
/// already exists.
fn is_duplicate_object_error(err: &rusqlite::Error) -> bool {
    let message = err.to_string().to_ascii_lowercase();
    message.contains("already exists") || message.contains("duplicate column name")
}

/// Whether a statement's effect is already present *and provably identical*,
/// so the duplicate-object error it just raised can be ignored.
///
/// The proof is per statement kind and deliberately conservative — a
/// statement this function cannot prove is never skipped:
///
/// * `ALTER TABLE … ADD COLUMN` — `pragma_table_info` reports the existing
///   column's declared type, nullability and default. That is an
///   authoritative record of the definition the statement asked for, so a
///   difference in any of the three is a real divergence and is surfaced.
/// * `CREATE INDEX` / `CREATE TRIGGER` / `CREATE VIEW` — `sqlite_master.sql`
///   holds the statement verbatim, so the stored text and the script's text
///   are compared token for token.
/// * `CREATE TABLE` — never skipped, because `sqlite_master.sql` is not a
///   record of the statement that created the table: SQLite *rewrites* a
///   table's stored DDL when a later `ALTER TABLE ADD COLUMN` runs, and
///   rebuild migrations create `*_new` scratch tables that they then drop
///   and rename. Migrations whose only non-idempotent statements are
///   `CREATE TABLE` therefore still fail loudly, as they always have.
fn already_satisfied(
    conn: &Connection,
    statement: &str,
    error: &rusqlite::Error,
) -> Result<bool, PlatformError> {
    let tokens: Vec<Token<'_>> = tokenize(statement)
        .into_iter()
        .filter(|token| !is_terminator(token))
        .collect();
    let message = error.to_string();

    if let Some(add) = parse_add_column(&tokens) {
        if !message.contains("duplicate column name") || !message.contains(&add.column) {
            return Ok(false);
        }
        let existing = column_info(conn, &add.table, &add.column)?;
        return Ok(existing.is_some_and(|existing| add.declared.matches(&existing)));
    }

    if let Some(create) = parse_create(&tokens) {
        if create.kind == CreateKind::Table {
            return Ok(false);
        }
        if !message.contains("already exists") || !message.contains(&create.name) {
            return Ok(false);
        }
        let stored: Option<String> = conn
            .query_row(
                "SELECT sql FROM sqlite_master WHERE name = ?1 AND sql IS NOT NULL",
                params![create.name],
                |row| row.get(0),
            )
            .optional()?;
        return Ok(stored.is_some_and(|stored| canonical_ddl(&stored) == canonical_ddl(statement)));
    }

    Ok(false)
}

// ── Statement splitting ──────────────────────────────────────────
//
// SQLite's own splitter is not reachable from `rusqlite` 0.31: the tail
// pointer `sqlite3_prepare_v3` produces is stored in `RawStatement::tail`,
// which is `pub(crate)` (`Statement::check_no_tail` is the only consumer).
// The fallback therefore walks the script itself, with a scanner that knows
// the four places a `;` can hide — a `--` comment, a `/* */` comment, a
// quoted literal or identifier, and a `CREATE TRIGGER` body, whose `;`
// separators sit between `BEGIN` and the `END` that closes it.

/// Split a migration script into its individual statements.
///
/// The split is lossless: concatenating the returned slices reproduces the
/// input exactly, so a fragment cannot be silently dropped.
fn split_statements(sql: &str) -> Vec<&str> {
    let mut statements = Vec::new();
    let mut start = 0usize;
    let mut index = 0usize;
    // Inside a `CREATE TRIGGER` body, `BEGIN` and `CASE` open a level and
    // `END` closes one. The `;` that ends the statement is the first one seen
    // at level zero *after* the body's own `END` has closed it.
    let mut in_trigger = false;
    let mut trigger_depth = 0i32;
    let mut trigger_body_closed = false;
    let mut lead: Vec<&str> = Vec::with_capacity(3);

    while index < sql.len() {
        let rest = &sql[index..];
        if rest.starts_with("--") {
            index = skip_line_comment(sql, index + 2);
            continue;
        }
        if rest.starts_with("/*") {
            index = skip_block_comment(sql, index + 2);
            continue;
        }
        let ch = rest.chars().next().expect("index is on a char boundary");
        if ch == '\'' {
            index = skip_quoted(sql, index, '\'').1;
        } else if ch == '"' || ch == '`' {
            index = skip_quoted(sql, index, ch).1;
        } else if ch == '[' {
            index = skip_bracket(sql, index).1;
        } else if ch == ';' {
            if !in_trigger || (trigger_depth == 0 && trigger_body_closed) {
                statements.push(&sql[start..index + 1]);
                start = index + 1;
                in_trigger = false;
                trigger_depth = 0;
                trigger_body_closed = false;
                lead.clear();
            }
            index += 1;
        } else if is_identifier_char(ch) {
            let word_start = index;
            while index < sql.len() {
                let c = sql[index..].chars().next().expect("char boundary");
                if is_identifier_char(c) {
                    index += c.len_utf8();
                } else {
                    break;
                }
            }
            let word = &sql[word_start..index];
            if in_trigger {
                if word.eq_ignore_ascii_case("BEGIN") || word.eq_ignore_ascii_case("CASE") {
                    trigger_depth += 1;
                } else if word.eq_ignore_ascii_case("END") && trigger_depth > 0 {
                    trigger_depth -= 1;
                    if trigger_depth == 0 {
                        trigger_body_closed = true;
                    }
                }
            } else {
                if lead.len() < 3 {
                    lead.push(word);
                }
                if is_create_trigger_lead(&lead) {
                    in_trigger = true;
                }
            }
        } else {
            index += ch.len_utf8();
        }
    }
    if start < sql.len() {
        statements.push(&sql[start..]);
    }
    statements
}

/// Whether a character can appear in a bare SQL word (identifier or keyword).
fn is_identifier_char(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || ch == '_' || ch == '$'
}

/// Whether the leading words of a statement spell `CREATE [TEMP|TEMPORARY]
/// TRIGGER`.
fn is_create_trigger_lead(lead: &[&str]) -> bool {
    let is = |word: &str, expected: &str| word.eq_ignore_ascii_case(expected);
    match lead {
        [create, trigger] => is(create, "CREATE") && is(trigger, "TRIGGER"),
        [create, temp, trigger] => {
            is(create, "CREATE")
                && (is(temp, "TEMP") || is(temp, "TEMPORARY"))
                && is(trigger, "TRIGGER")
        }
        _ => false,
    }
}

/// Skip a quoted region opened by `quote` at `index`; returns
/// `(body_end, next_index)`. A doubled quote is an escaped quote rather than
/// a terminator, and an unterminated region runs to the end of the input.
fn skip_quoted(sql: &str, index: usize, quote: char) -> (usize, usize) {
    let mut cursor = index + quote.len_utf8();
    while cursor < sql.len() {
        let ch = sql[cursor..].chars().next().expect("char boundary");
        if ch == quote {
            let after = cursor + ch.len_utf8();
            if sql[after..].starts_with(quote) {
                cursor = after + quote.len_utf8();
                continue;
            }
            return (cursor, after);
        }
        cursor += ch.len_utf8();
    }
    (sql.len(), sql.len())
}

/// Skip a `[...]` identifier opened at `index`; returns `(body_end, next)`.
fn skip_bracket(sql: &str, index: usize) -> (usize, usize) {
    let mut cursor = index + 1;
    while cursor < sql.len() {
        if sql.as_bytes()[cursor] == b']' {
            return (cursor, cursor + 1);
        }
        cursor += sql[cursor..]
            .chars()
            .next()
            .expect("char boundary")
            .len_utf8();
    }
    (sql.len(), sql.len())
}

/// Skip past the newline that ends a `--` comment (or to the end of input).
fn skip_line_comment(sql: &str, index: usize) -> usize {
    match sql[index..].find('\n') {
        Some(offset) => index + offset + 1,
        None => sql.len(),
    }
}

/// Skip past the `*/` that closes a `/* */` comment (or to the end of input).
fn skip_block_comment(sql: &str, index: usize) -> usize {
    match sql[index..].find("*/") {
        Some(offset) => index + offset + 2,
        None => sql.len(),
    }
}

// ── Statement classification ─────────────────────────────────────

/// A significant token of a SQL statement. Whitespace and comments are not
/// tokens.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TokenKind {
    /// A bare word: `ALTER`, `products`, `TEXT`, `0`.
    Word,
    /// A single-quoted literal; `value` is the body without the quotes.
    Str,
    /// A quoted identifier (`"x"`, `` `x` ``, `[x]`); `value` is the body.
    Quoted,
    /// Any other significant character: `(`, `)`, `,`, `;`.
    Punct,
}

/// One token of a SQL statement.
#[derive(Debug, Clone, Copy)]
struct Token<'a> {
    kind: TokenKind,
    /// Unquoted token text.
    value: &'a str,
}

/// Tokenize a SQL statement, dropping whitespace and comments.
fn tokenize(sql: &str) -> Vec<Token<'_>> {
    let mut tokens = Vec::new();
    let mut index = 0usize;
    while index < sql.len() {
        let rest = &sql[index..];
        let ch = rest.chars().next().expect("index is on a char boundary");
        if ch.is_whitespace() {
            index += ch.len_utf8();
            continue;
        }
        if rest.starts_with("--") {
            index = skip_line_comment(sql, index + 2);
            continue;
        }
        if rest.starts_with("/*") {
            index = skip_block_comment(sql, index + 2);
            continue;
        }
        match ch {
            '\'' | '"' | '`' => {
                let (body_end, next) = skip_quoted(sql, index, ch);
                tokens.push(Token {
                    kind: if ch == '\'' {
                        TokenKind::Str
                    } else {
                        TokenKind::Quoted
                    },
                    value: &sql[index + ch.len_utf8()..body_end],
                });
                index = next;
            }
            '[' => {
                let (body_end, next) = skip_bracket(sql, index);
                tokens.push(Token {
                    kind: TokenKind::Quoted,
                    value: &sql[index + 1..body_end],
                });
                index = next;
            }
            _ if is_identifier_char(ch) => {
                let start = index;
                while index < sql.len() {
                    let c = sql[index..].chars().next().expect("char boundary");
                    if is_identifier_char(c) {
                        index += c.len_utf8();
                    } else {
                        break;
                    }
                }
                tokens.push(Token {
                    kind: TokenKind::Word,
                    value: &sql[start..index],
                });
            }
            _ => {
                tokens.push(Token {
                    kind: TokenKind::Punct,
                    value: &sql[index..index + ch.len_utf8()],
                });
                index += ch.len_utf8();
            }
        }
    }
    tokens
}

/// Canonical, comparable form of a token sequence.
///
/// SQL keywords, identifiers and function names are case-insensitive, so they
/// are upper-cased; string literals are not, so they are kept verbatim and
/// delimited, which also keeps a literal from ever being confused with a bare
/// word. Tokens are joined with a separator that cannot occur inside one.
fn canonical(tokens: &[Token<'_>]) -> String {
    let mut parts: Vec<String> = Vec::with_capacity(tokens.len());
    for token in tokens {
        match token.kind {
            TokenKind::Str => parts.push(format!("'{}'", token.value)),
            _ => parts.push(token.value.to_ascii_uppercase()),
        }
    }
    parts.join("\u{1}")
}

/// Canonical form of a whole DDL statement, for comparison against the text
/// SQLite stores in `sqlite_master.sql`.
///
/// SQLite strips `IF NOT EXISTS` from the DDL it stores — measured, not
/// assumed — so the clause is dropped from both sides before comparing.
fn canonical_ddl(sql: &str) -> String {
    let tokens = tokenize(sql);
    let mut kept: Vec<Token<'_>> = Vec::with_capacity(tokens.len());
    let mut index = 0usize;
    while index < tokens.len() {
        let token = tokens[index];
        if is_terminator(&token) {
            index += 1;
            continue;
        }
        if is_word(&token, "IF")
            && tokens.get(index + 1).is_some_and(|t| is_word(t, "NOT"))
            && tokens.get(index + 2).is_some_and(|t| is_word(t, "EXISTS"))
        {
            index += 3;
            continue;
        }
        kept.push(token);
        index += 1;
    }
    canonical(&kept)
}

/// Whether a token is a statement terminator.
fn is_terminator(token: &Token<'_>) -> bool {
    token.kind == TokenKind::Punct && token.value == ";"
}

/// Whether a token is the given bare keyword, ignoring case.
fn is_word(token: &Token<'_>, word: &str) -> bool {
    token.kind == TokenKind::Word && token.value.eq_ignore_ascii_case(word)
}

/// The unquoted text of an identifier token.
fn identifier(token: &Token<'_>) -> Option<String> {
    match token.kind {
        TokenKind::Word | TokenKind::Quoted => Some(token.value.to_string()),
        _ => None,
    }
}

/// A column's declared definition, in canonical form.
struct ColumnDecl {
    /// Canonical token form of the declared type (`TEXT`, `INTEGER`).
    type_name: String,
    /// Whether the declaration carries `NOT NULL`.
    not_null: bool,
    /// Canonical token form of the `DEFAULT` expression, outer parentheses
    /// removed.
    default: Option<String>,
}

impl ColumnDecl {
    /// Whether an existing column carries exactly this declaration.
    fn matches(&self, existing: &ColumnInfo) -> bool {
        self.type_name == existing.type_name
            && self.not_null == existing.not_null
            && self.default == existing.default
    }
}

/// A column as the database reports it, in canonical form.
struct ColumnInfo {
    type_name: String,
    not_null: bool,
    default: Option<String>,
}

/// `ALTER TABLE <table> ADD [COLUMN] <column> <declaration>`.
struct AddColumn {
    table: String,
    column: String,
    declared: ColumnDecl,
}

/// The kind of object a `CREATE` statement declares.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CreateKind {
    Table,
    Index,
    Trigger,
    View,
}

/// `CREATE [UNIQUE|TEMP|TEMPORARY|VIRTUAL] <kind> [IF NOT EXISTS] <name>`.
struct Create {
    kind: CreateKind,
    name: String,
}

/// Parse an `ADD COLUMN` statement, or `None` for anything else.
fn parse_add_column(tokens: &[Token<'_>]) -> Option<AddColumn> {
    if !tokens.first().is_some_and(|t| is_word(t, "ALTER"))
        || !tokens.get(1).is_some_and(|t| is_word(t, "TABLE"))
    {
        return None;
    }
    let table = identifier(tokens.get(2)?)?;
    let mut cursor = 3usize;
    if !tokens.get(cursor).is_some_and(|t| is_word(t, "ADD")) {
        return None;
    }
    cursor += 1;
    if tokens.get(cursor).is_some_and(|t| is_word(t, "COLUMN")) {
        cursor += 1;
    }
    let column = identifier(tokens.get(cursor)?)?;
    let declared = parse_column_decl(&tokens[cursor + 1..]);
    Some(AddColumn {
        table,
        column,
        declared,
    })
}

/// Parse a `CREATE` statement, or `None` for anything else.
fn parse_create(tokens: &[Token<'_>]) -> Option<Create> {
    if !tokens.first().is_some_and(|t| is_word(t, "CREATE")) {
        return None;
    }
    let mut cursor = 1usize;
    while tokens.get(cursor).is_some_and(|t| {
        is_word(t, "UNIQUE")
            || is_word(t, "TEMP")
            || is_word(t, "TEMPORARY")
            || is_word(t, "VIRTUAL")
    }) {
        cursor += 1;
    }
    let kind = tokens.get(cursor)?;
    let kind = if is_word(kind, "TABLE") {
        CreateKind::Table
    } else if is_word(kind, "INDEX") {
        CreateKind::Index
    } else if is_word(kind, "TRIGGER") {
        CreateKind::Trigger
    } else if is_word(kind, "VIEW") {
        CreateKind::View
    } else {
        return None;
    };
    cursor += 1;
    if tokens.get(cursor).is_some_and(|t| is_word(t, "IF"))
        && tokens.get(cursor + 1).is_some_and(|t| is_word(t, "NOT"))
        && tokens.get(cursor + 2).is_some_and(|t| is_word(t, "EXISTS"))
    {
        cursor += 3;
    }
    let name = identifier(tokens.get(cursor)?)?;
    Some(Create { kind, name })
}

/// Parse the declaration that follows an `ADD COLUMN` column name.
fn parse_column_decl(tokens: &[Token<'_>]) -> ColumnDecl {
    // The declared type runs until the first constraint keyword at the top
    // level, so a type with arguments (`VARCHAR(255)`) stays intact.
    let mut depth = 0i32;
    let mut type_end = 0usize;
    while type_end < tokens.len() {
        let token = &tokens[type_end];
        if token.kind == TokenKind::Punct {
            if token.value == "(" {
                depth += 1;
            } else if token.value == ")" {
                depth -= 1;
            }
        } else if depth == 0 && (is_column_constraint_keyword(token) || is_terminator(token)) {
            break;
        }
        type_end += 1;
    }

    let mut not_null = false;
    let mut default = None;
    let mut cursor = type_end;
    while cursor < tokens.len() {
        if is_word(&tokens[cursor], "NOT")
            && tokens.get(cursor + 1).is_some_and(|t| is_word(t, "NULL"))
        {
            not_null = true;
            cursor += 2;
            continue;
        }
        if is_word(&tokens[cursor], "DEFAULT") {
            let end = expression_end(tokens, cursor + 1);
            default = Some(canonical(strip_outer_parens(&tokens[cursor + 1..end])));
            cursor = end;
            continue;
        }
        cursor += 1;
    }

    ColumnDecl {
        type_name: canonical(&tokens[..type_end]),
        not_null,
        default,
    }
}

/// Index of the first token that ends an expression starting at `start`.
fn expression_end(tokens: &[Token<'_>], start: usize) -> usize {
    let mut depth = 0i32;
    let mut cursor = start;
    while cursor < tokens.len() {
        let token = &tokens[cursor];
        if token.kind == TokenKind::Punct {
            if token.value == "(" {
                depth += 1;
            } else if token.value == ")" {
                if depth == 0 {
                    break;
                }
                depth -= 1;
            }
        } else if depth == 0 && (is_column_constraint_keyword(token) || is_terminator(token)) {
            break;
        }
        cursor += 1;
    }
    cursor
}

/// Keywords that terminate a column's declared type or default expression.
fn is_column_constraint_keyword(token: &Token<'_>) -> bool {
    token.kind == TokenKind::Word
        && [
            "NOT",
            "NULL",
            "DEFAULT",
            "CHECK",
            "PRIMARY",
            "UNIQUE",
            "REFERENCES",
            "COLLATE",
            "GENERATED",
            "AS",
            "CONSTRAINT",
        ]
        .iter()
        .any(|keyword| token.value.eq_ignore_ascii_case(keyword))
}

/// Strip parentheses that wrap a whole expression.
///
/// SQLite reports `DEFAULT (strftime(…))` as `strftime(…)` — measured — so the
/// wrapper has to be removed from the script's side too before comparing.
fn strip_outer_parens<'a>(mut tokens: &'a [Token<'a>]) -> &'a [Token<'a>] {
    loop {
        if tokens.len() < 2 {
            return tokens;
        }
        let opens = tokens[0].kind == TokenKind::Punct && tokens[0].value == "(";
        let closes = tokens[tokens.len() - 1].kind == TokenKind::Punct
            && tokens[tokens.len() - 1].value == ")";
        if !opens || !closes {
            return tokens;
        }
        let mut depth = 0i32;
        let mut wraps_whole = false;
        for (index, token) in tokens.iter().enumerate() {
            if token.kind == TokenKind::Punct && token.value == "(" {
                depth += 1;
            } else if token.kind == TokenKind::Punct && token.value == ")" {
                depth -= 1;
                if depth == 0 {
                    wraps_whole = index == tokens.len() - 1;
                    break;
                }
            }
        }
        if !wraps_whole {
            return tokens;
        }
        tokens = &tokens[1..tokens.len() - 1];
    }
}

/// Read a column's definition from the database.
fn column_info(
    conn: &Connection,
    table: &str,
    column: &str,
) -> Result<Option<ColumnInfo>, PlatformError> {
    let mut statement =
        conn.prepare("SELECT name, type, \"notnull\", dflt_value FROM pragma_table_info(?1)")?;
    let mut rows = statement.query(params![table])?;
    while let Some(row) = rows.next()? {
        let name: String = row.get(0)?;
        if !name.eq_ignore_ascii_case(column) {
            continue;
        }
        let declared_type: String = row.get(1)?;
        let not_null: i64 = row.get(2)?;
        let default: Option<String> = row.get(3)?;
        let default = default.map(|text| {
            let tokens = tokenize(&text);
            canonical(strip_outer_parens(&tokens))
        });
        let type_tokens = tokenize(&declared_type);
        return Ok(Some(ColumnInfo {
            type_name: canonical(&type_tokens),
            not_null: not_null != 0,
            default,
        }));
    }
    Ok(None)
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
mod tests {
    use super::*;

    fn fresh() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON").unwrap();
        conn
    }

    const TEST_MIGRATIONS: &[Migration] = &[Migration {
        id: "001_test.sql",
        sql: "CREATE TABLE test_table (id INTEGER PRIMARY KEY)",
    }];

    const TWO_MIGRATIONS: &[Migration] = &[
        Migration {
            id: "001_first.sql",
            sql: "CREATE TABLE test_table (id INTEGER PRIMARY KEY)",
        },
        Migration {
            id: "002_second.sql",
            sql: "ALTER TABLE test_table ADD COLUMN name TEXT",
        },
    ];

    /// A registry in production's shape: date-prefixed ids, so the guard has a
    /// vantage point from which "newer than me" means something.
    const DATE_REGISTRY: &[Migration] = &[Migration {
        id: "20260101_first.sql",
        sql: "CREATE TABLE test_table (id INTEGER PRIMARY KEY)",
    }];

    fn ledger_has(conn: &Connection, id: &str) -> bool {
        conn.query_row(
            "SELECT COUNT(*) FROM schema_migrations WHERE id = ?1",
            params![id],
            |r| r.get::<_, i64>(0),
        )
        .unwrap()
            == 1
    }

    fn table_exists(conn: &Connection, name: &str) -> bool {
        conn.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name = ?1",
            params![name],
            |r| r.get::<_, i64>(0),
        )
        .unwrap()
            == 1
    }

    #[test]
    fn a_database_migrated_by_a_newer_build_is_refused_before_anything_applies() {
        let mut conn = Connection::open_in_memory().unwrap();
        ensure_schema_migrations_table(&conn).unwrap();
        conn.execute(
            "INSERT INTO schema_migrations (id) VALUES ('20991231_from_the_future.sql')",
            [],
        )
        .unwrap();

        let err = run(&mut conn, DATE_REGISTRY).unwrap_err().to_string();
        assert!(
            err.contains("newer than this build") && err.contains("20991231_from_the_future.sql"),
            "unhelpful refusal: {err}"
        );
        // The point of checking first: nothing was applied on the way out.
        assert!(
            !table_exists(&conn, "test_table"),
            "the registry's own migration ran despite the refusal"
        );
    }

    #[test]
    fn a_legacy_row_the_registry_no_longer_lists_still_upgrades() {
        // The documented dev-DB path, at this level: `001_sales.sql` is not
        // date-shaped, so it has no position in the chronology and must not be
        // read as coming from the future.
        let mut conn = Connection::open_in_memory().unwrap();
        ensure_schema_migrations_table(&conn).unwrap();
        conn.execute(
            "INSERT INTO schema_migrations (id) VALUES ('001_sales.sql')",
            [],
        )
        .unwrap();

        run(&mut conn, DATE_REGISTRY).unwrap();
        assert!(
            ledger_has(&conn, "001_sales.sql"),
            "the legacy row was pruned"
        );
        assert!(table_exists(&conn, "test_table"));
    }

    #[test]
    fn a_pruned_older_date_shaped_migration_is_tolerated() {
        // History this build lost is not the future: an id that sorts BEFORE the
        // newest known one cannot come from a build ahead of this one.
        let mut conn = Connection::open_in_memory().unwrap();
        ensure_schema_migrations_table(&conn).unwrap();
        conn.execute(
            "INSERT INTO schema_migrations (id) VALUES ('20250101_pruned_away.sql')",
            [],
        )
        .unwrap();

        run(&mut conn, DATE_REGISTRY).unwrap();
        assert!(table_exists(&conn, "test_table"));
    }

    #[test]
    fn a_registry_with_no_date_shaped_ids_cannot_call_anything_the_future() {
        // Guard stays inert rather than refusing everything: the `001_`/`002_`
        // fixture corpus has no vantage point, and must not acquire one by
        // accident. A genuinely-future row here is ignored, as before.
        let mut conn = Connection::open_in_memory().unwrap();
        ensure_schema_migrations_table(&conn).unwrap();
        conn.execute(
            "INSERT INTO schema_migrations (id) VALUES ('20991231_from_the_future.sql')",
            [],
        )
        .unwrap();

        run(&mut conn, TEST_MIGRATIONS).unwrap();
        assert!(table_exists(&conn, "test_table"));
    }

    #[test]
    fn first_run_applies_all_migrations() {
        let mut conn = fresh();
        run(&mut conn, TEST_MIGRATIONS).unwrap();
        let applied = load_applied(&conn).unwrap();
        for mig in TEST_MIGRATIONS {
            assert!(
                applied.contains(mig.id),
                "missing applied entry for {}",
                mig.id
            );
        }
    }

    #[test]
    fn second_run_is_idempotent() {
        let mut conn = fresh();
        run(&mut conn, TEST_MIGRATIONS).unwrap();
        run(&mut conn, TEST_MIGRATIONS).unwrap();
        let applied = load_applied(&conn).unwrap();
        assert_eq!(applied.len(), TEST_MIGRATIONS.len());
    }

    #[test]
    fn migration_checksums_are_stable_across_line_endings() {
        let lf = "CREATE TABLE test_table (id INTEGER PRIMARY KEY)\n";
        let crlf = lf.replace('\n', "\r\n");

        assert_eq!(checksum_hex(lf), checksum_hex(&crlf));
    }

    #[test]
    fn legacy_line_ending_checksum_is_migrated() {
        use sha2::Digest;

        let migrations = [Migration {
            id: "001_line_endings.sql",
            sql: "CREATE TABLE line_endings (id INTEGER PRIMARY KEY)\n",
        }];
        let mut conn = fresh();
        run(&mut conn, &migrations).unwrap();

        let legacy_sql = migrations[0].sql.replace('\n', "\r\n");
        let legacy_checksum = hex::encode(sha2::Sha256::digest(legacy_sql.as_bytes()));
        let tx = conn.transaction().unwrap();
        tx.execute(
            "UPDATE schema_migrations SET checksum = ?1 WHERE id = ?2",
            params![legacy_checksum, migrations[0].id],
        )
        .unwrap();
        tx.commit().unwrap();

        run(&mut conn, &migrations).unwrap();
        let stored: String = conn
            .query_row(
                "SELECT checksum FROM schema_migrations WHERE id = ?1",
                params![migrations[0].id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(stored, checksum_hex(migrations[0].sql));
    }

    #[test]
    fn migration_creates_table() {
        let mut conn = fresh();
        run(&mut conn, TEST_MIGRATIONS).unwrap();
        let exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='test_table'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(exists, 1, "expected `test_table` after migration");
    }

    #[test]
    fn run_with_empty_list_does_nothing() {
        let mut conn = fresh();
        run(&mut conn, &[]).unwrap();
        let applied = load_applied(&conn).unwrap();
        assert!(applied.is_empty());
    }

    // ── Rollback tests ─────────────────────────────────────────────

    #[test]
    fn rollback_reverts_last_migration_and_removes_tracking() {
        let mut conn = fresh();
        run(&mut conn, TEST_MIGRATIONS).unwrap();

        // Verify table exists before rollback.
        let exists_before: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='test_table'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(exists_before, 1);

        // Rollback using the `rollback()` function with explicit down SQL.
        let rolled_back =
            rollback(&mut conn, "001_test.sql", "DROP TABLE IF EXISTS test_table").unwrap();
        assert!(rolled_back, "rollback should succeed");

        // Verify table was dropped.
        let exists_after: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='test_table'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(exists_after, 0, "table should be dropped after rollback");

        // Verify tracking row removed.
        let applied = load_applied(&conn).unwrap();
        assert!(
            !applied.contains("001_test.sql"),
            "tracking row should be removed"
        );
    }

    #[test]
    fn rollback_empty_db_returns_false() {
        let mut conn = fresh();
        let result = rollback(&mut conn, "001_test.sql", "DROP TABLE test_table").unwrap();
        assert!(!result, "rollback on empty DB should return false");
    }

    #[test]
    fn rollback_wrong_id_returns_false() {
        let mut conn = fresh();
        run(&mut conn, TEST_MIGRATIONS).unwrap();

        // Try rolling back with a non-matching ID.
        let result = rollback(&mut conn, "999_wrong.sql", "DROP TABLE test_table").unwrap();
        assert!(!result, "rollback with wrong ID should return false");

        // Table should still exist.
        let exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='test_table'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(exists, 1, "table should survive failed rollback");
    }

    #[test]
    fn rollback_only_reverts_last_migration() {
        let mut conn = fresh();
        run(&mut conn, TWO_MIGRATIONS).unwrap();

        // Try rolling back the first migration while second is on top — should fail.
        let result = rollback(
            &mut conn,
            "001_first.sql",
            "DROP TABLE IF EXISTS test_table",
        )
        .unwrap();
        assert!(
            !result,
            "rollback of non-last migration should return false"
        );

        // Both still exist.
        let applied = load_applied(&conn).unwrap();
        assert_eq!(applied.len(), 2);

        // Rollback the last one instead.
        let result = rollback(
            &mut conn,
            "002_second.sql",
            "ALTER TABLE test_table DROP COLUMN name",
        )
        .unwrap();
        assert!(result, "rollback of last migration should succeed");

        let applied = load_applied(&conn).unwrap();
        assert_eq!(applied.len(), 1);
        assert!(applied.contains("001_first.sql"));
    }

    // ── Edge case tests ─────────────────────────────────────────────

    #[test]
    fn duplicate_migration_id_with_identical_sql_is_skipped() {
        let mut conn = fresh();
        // Run once.
        run(&mut conn, TEST_MIGRATIONS).unwrap();
        // Run again with the same list — the duplicate ID is skipped and the
        // checksum verifies (idempotent).
        run(&mut conn, TEST_MIGRATIONS).unwrap();
        let applied = load_applied(&conn).unwrap();
        assert_eq!(applied.len(), 1);
    }

    #[test]
    fn drift_with_non_idempotent_sql_fails() {
        let mut conn = fresh();
        run(&mut conn, TEST_MIGRATIONS).unwrap();

        // Same ID, non-idempotent SQL (missing IF NOT EXISTS) → re-apply
        // fails because the table already exists, surfacing the breaking
        // change to the user.
        let drifted = &[Migration {
            id: "001_test.sql",
            sql: "CREATE TABLE test_table (id INTEGER PRIMARY KEY, name TEXT)",
        }];
        let err = run(&mut conn, drifted).unwrap_err();
        // The error comes from the SQL execution, not the checksum check.
        assert!(
            err.to_string().contains("already exists"),
            "expected SQL re-apply error, got: {err}"
        );
    }

    #[test]
    fn drift_with_idempotent_sql_auto_patches() {
        let mut conn = fresh();
        run(&mut conn, TEST_MIGRATIONS).unwrap();

        // Same ID, idempotent SQL (IF NOT EXISTS) → re-apply is a no-op,
        // checksum is auto-updated, and startup succeeds.
        let drifted = &[Migration {
            id: "001_test.sql",
            sql: "CREATE TABLE IF NOT EXISTS test_table (id INTEGER PRIMARY KEY, name TEXT)",
        }];
        run(&mut conn, drifted).unwrap(); // must not error

        // Checksum was updated to match the new definition.
        let stored: String = conn
            .query_row(
                "SELECT checksum FROM schema_migrations WHERE id = '001_test.sql'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(stored, checksum_hex(drifted[0].sql));

        // Table still exists.
        let exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='test_table'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(exists, 1);
    }

    // ── DB-02: statement-level drift re-apply ───────────────────────

    /// A migration shaped like `20260901_product_images.sql`: a guarded
    /// `CREATE TABLE` plus the unguarded `ALTER TABLE … ADD COLUMN` that
    /// SQLite offers no `IF NOT EXISTS` form for.
    const ADD_COLUMN_MIGRATION: &[Migration] = &[Migration {
        id: "001_add_column.sql",
        sql: "CREATE TABLE IF NOT EXISTS products (id TEXT NOT NULL PRIMARY KEY);\n\
              ALTER TABLE products ADD COLUMN image_hash TEXT;",
    }];

    /// The same migration after a comment-only edit — the drift that used to
    /// panic startup with `duplicate column name: image_hash`.
    const ADD_COLUMN_MIGRATION_COMMENTED: &[Migration] = &[Migration {
        id: "001_add_column.sql",
        sql: "CREATE TABLE IF NOT EXISTS products (id TEXT NOT NULL PRIMARY KEY);\n\
              ALTER TABLE products ADD COLUMN image_hash TEXT;\n\
              -- cosmetic: the hash mirrors product_images slot 1",
    }];

    #[test]
    fn drift_comment_only_edit_to_unguarded_add_column_self_heals() {
        let mut conn = fresh();
        run(&mut conn, ADD_COLUMN_MIGRATION).unwrap();

        // A comment-only edit changes the file's checksum but not its
        // executable SQL, so the re-apply must succeed: the `ADD COLUMN` is
        // already satisfied and the column definition is identical.
        run(&mut conn, ADD_COLUMN_MIGRATION_COMMENTED).unwrap();

        let stored: String = conn
            .query_row(
                "SELECT checksum FROM schema_migrations WHERE id = '001_add_column.sql'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(stored, checksum_hex(ADD_COLUMN_MIGRATION_COMMENTED[0].sql));

        let declared: Option<String> = conn
            .query_row(
                "SELECT type FROM pragma_table_info('products') WHERE name = 'image_hash'",
                [],
                |row| row.get(0),
            )
            .optional()
            .unwrap();
        assert_eq!(declared.as_deref(), Some("TEXT"));
    }

    #[test]
    fn drift_add_column_with_conflicting_type_is_surfaced() {
        let mut conn = fresh();
        run(&mut conn, ADD_COLUMN_MIGRATION).unwrap();

        // Same column name, different declared type: the existing column is
        // not what the edited script asks for, so the drift must be reported
        // rather than skipped.
        let drifted = &[Migration {
            id: "001_add_column.sql",
            sql: "CREATE TABLE IF NOT EXISTS products (id TEXT NOT NULL PRIMARY KEY);\n\
                  ALTER TABLE products ADD COLUMN image_hash INTEGER;",
        }];
        let err = run(&mut conn, drifted).unwrap_err();
        assert!(
            err.to_string().contains("duplicate column name"),
            "expected the duplicate-column error to surface, got: {err}"
        );
    }

    #[test]
    fn drift_add_column_with_conflicting_default_is_surfaced() {
        let mut conn = fresh();
        run(
            &mut conn,
            &[Migration {
                id: "001_add_column.sql",
                sql: "CREATE TABLE IF NOT EXISTS products (id TEXT NOT NULL PRIMARY KEY);\n\
                      ALTER TABLE products ADD COLUMN currency TEXT NOT NULL DEFAULT '';",
            }],
        )
        .unwrap();

        let drifted = &[Migration {
            id: "001_add_column.sql",
            sql: "CREATE TABLE IF NOT EXISTS products (id TEXT NOT NULL PRIMARY KEY);\n\
                  ALTER TABLE products ADD COLUMN currency TEXT NOT NULL DEFAULT 'IDR';",
        }];
        let err = run(&mut conn, drifted).unwrap_err();
        assert!(
            err.to_string().contains("duplicate column name"),
            "expected the duplicate-column error to surface, got: {err}"
        );
    }

    #[test]
    fn drift_add_column_with_expression_default_self_heals() {
        // SQLite reports `DEFAULT (strftime(…))` without the wrapping
        // parentheses, so the comparison has to strip them from the script's
        // side too — otherwise a comment-only edit to a timestamp column
        // would look like a changed default.
        let mut conn = fresh();
        run(
            &mut conn,
            &[Migration {
                id: "001_add_column.sql",
                sql: "CREATE TABLE IF NOT EXISTS products (id TEXT NOT NULL PRIMARY KEY);\n\
                      ALTER TABLE products ADD COLUMN created_at TEXT NOT NULL \
                      DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));",
            }],
        )
        .unwrap();

        let drifted = &[Migration {
            id: "001_add_column.sql",
            sql: "CREATE TABLE IF NOT EXISTS products (id TEXT NOT NULL PRIMARY KEY);\n\
                  ALTER TABLE products ADD COLUMN created_at TEXT NOT NULL \
                  DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));\n\
                  -- cosmetic",
        }];
        run(&mut conn, drifted).unwrap();
    }

    #[test]
    fn drift_cosmetic_edit_to_unguarded_trigger_self_heals() {
        let mut conn = fresh();
        run(
            &mut conn,
            &[Migration {
                id: "001_trigger.sql",
                sql: "CREATE TABLE IF NOT EXISTS audit_log (id TEXT NOT NULL);\n\
                      CREATE TRIGGER audit_log_immutable_delete BEFORE DELETE ON audit_log \
                      BEGIN SELECT RAISE(ABORT, 'immutable'); END;",
            }],
        )
        .unwrap();

        let drifted = &[Migration {
            id: "001_trigger.sql",
            sql: "CREATE TABLE IF NOT EXISTS audit_log (id TEXT NOT NULL);\n\
                  CREATE TRIGGER audit_log_immutable_delete BEFORE DELETE ON audit_log \
                  BEGIN SELECT RAISE(ABORT, 'immutable'); END;\n\
                  -- cosmetic",
        }];
        run(&mut conn, drifted).unwrap();
    }

    #[test]
    fn drift_changed_trigger_body_is_surfaced() {
        let mut conn = fresh();
        run(
            &mut conn,
            &[Migration {
                id: "001_trigger.sql",
                sql: "CREATE TABLE IF NOT EXISTS audit_log (id TEXT NOT NULL);\n\
                      CREATE TRIGGER audit_log_immutable_delete BEFORE DELETE ON audit_log \
                      BEGIN SELECT RAISE(ABORT, 'immutable'); END;",
            }],
        )
        .unwrap();

        let drifted = &[Migration {
            id: "001_trigger.sql",
            sql: "CREATE TABLE IF NOT EXISTS audit_log (id TEXT NOT NULL);\n\
                  CREATE TRIGGER audit_log_immutable_delete BEFORE DELETE ON audit_log \
                  BEGIN SELECT RAISE(ABORT, 'cannot delete'); END;",
        }];
        let err = run(&mut conn, drifted).unwrap_err();
        assert!(
            err.to_string().contains("already exists"),
            "expected the duplicate-trigger error to surface, got: {err}"
        );
    }

    #[test]
    fn split_statements_ignores_semicolons_in_comments_literals_and_trigger_bodies() {
        let sql = "\
-- a line comment with a ; semicolon\n\
CREATE TABLE t (a TEXT DEFAULT 'x;y');\n\
/* a block comment with a ; semicolon */\n\
CREATE TRIGGER trg AFTER INSERT ON t BEGIN\n\
    UPDATE t SET a = CASE WHEN a IS NULL THEN 'none' ELSE a END;\n\
    DELETE FROM t WHERE a = 'gone;';\n\
END;\n\
CREATE INDEX idx_t_a ON t(a);\n";

        let statements = split_statements(sql);

        // Lossless: no fragment can be dropped without changing the script.
        assert_eq!(statements.concat(), sql);

        let significant: Vec<&str> = statements
            .iter()
            .copied()
            .filter(|statement| !canonical_ddl(statement).is_empty())
            .collect();
        assert_eq!(significant.len(), 3, "got: {significant:#?}");
        assert!(
            significant[0].contains("CREATE TABLE t"),
            "{}",
            significant[0]
        );
        assert!(
            significant[1].contains("CREATE TRIGGER trg"),
            "{}",
            significant[1]
        );
        // The body's own `;` separators and the `CASE … END` inside it must
        // not split the statement.
        assert!(
            significant[1].trim_end().ends_with("END;"),
            "the trigger body must stay one statement: {}",
            significant[1]
        );
        assert!(
            significant[2].contains("CREATE INDEX idx_t_a"),
            "{}",
            significant[2]
        );
    }

    #[test]
    fn canonical_ddl_ignores_if_not_exists_and_comments() {
        // SQLite stores a table's DDL without the `IF NOT EXISTS` clause it
        // was created with, so the two forms must compare equal.
        let stored = "CREATE TABLE product_images (product_id TEXT NOT NULL)";
        let statement = "CREATE TABLE IF NOT EXISTS product_images (\n\
                         product_id TEXT NOT NULL  -- the owning product\n\
                         );";
        assert_eq!(canonical_ddl(stored), canonical_ddl(statement));
    }

    #[test]
    fn partial_crash_with_if_not_exists_recovers() {
        // Simulate a crash that occurs AFTER the SQL executes but BEFORE
        // the tracking INSERT is committed.
        //
        // In this scenario, `run()` will see NO tracking row and attempt
        // to re-apply the SQL. If the SQL uses `IF NOT EXISTS`, it succeeds
        // idempotently. If it uses plain `CREATE TABLE`, the re-apply will
        // fail — which is correct: the migration author must use idempotent
        // SQL patterns.
        //
        // This test verifies that re-running with idempotent SQL works.
        let mut conn = fresh();

        // Create the table manually (simulating the SQL that executed before crash).
        conn.execute_batch("CREATE TABLE test_table (id INTEGER PRIMARY KEY)")
            .unwrap();
        // No tracking row — simulating the missing INSERT + commit.

        // Now run with a migration that uses IF NOT EXISTS (recommended pattern).
        let idempotent_migration = &[Migration {
            id: "001_test.sql",
            sql: "CREATE TABLE IF NOT EXISTS test_table (id INTEGER PRIMARY KEY)",
        }];
        run(&mut conn, idempotent_migration).unwrap();

        // Tracking row should now exist.
        let applied = load_applied(&conn).unwrap();
        assert!(
            applied.contains("001_test.sql"),
            "tracking row should be added on recovery"
        );

        // Table should still exist.
        let exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='test_table'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(exists, 1, "table should survive recovery re-run");
    }

    #[test]
    fn migration_table_created_outside_of_runner() {
        // Verify that a table created manually (e.g. by a concurrent process)
        // is detected as already-applied via its tracking row.
        let mut conn = fresh();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_migrations (
                id TEXT PRIMARY KEY,
                applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            )",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO schema_migrations (id) VALUES (?1)",
            params!["001_test.sql"],
        )
        .unwrap();
        // Create the actual table too (simulating another process that did both).
        conn.execute_batch("CREATE TABLE test_table (id INTEGER PRIMARY KEY)")
            .unwrap();

        // Running migrations should be a no-op (and backfill the checksum).
        run(&mut conn, TEST_MIGRATIONS).unwrap();
        let applied = load_applied(&conn).unwrap();
        assert_eq!(applied.len(), 1);
        let stored: String = conn
            .query_row(
                "SELECT checksum FROM schema_migrations WHERE id = '001_test.sql'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(stored, checksum_hex(TEST_MIGRATIONS[0].sql));
    }

    #[test]
    fn load_applied_ordered_returns_correct_order() {
        let mut conn = fresh();
        run(&mut conn, TWO_MIGRATIONS).unwrap();

        let ordered = load_applied_ordered(&conn).unwrap();
        assert_eq!(ordered.len(), 2);
        assert_eq!(ordered[0], "001_first.sql");
        assert_eq!(ordered[1], "002_second.sql");
    }

    #[test]
    fn rollback_then_rereapply_works() {
        let mut conn = fresh();
        run(&mut conn, TEST_MIGRATIONS).unwrap();

        // Rollback.
        rollback(&mut conn, "001_test.sql", "DROP TABLE IF EXISTS test_table").unwrap();

        // Re-apply.
        run(&mut conn, TEST_MIGRATIONS).unwrap();

        // Table should exist again.
        let exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='test_table'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(exists, 1, "table should be re-created after re-apply");

        let applied = load_applied(&conn).unwrap();
        assert!(applied.contains("001_test.sql"));
    }

    // ── DB-02: checksum tracking & drift detection ─────────────────

    #[test]
    fn applied_migration_records_checksum() {
        let mut conn = fresh();
        run(&mut conn, TEST_MIGRATIONS).unwrap();
        let stored: String = conn
            .query_row(
                "SELECT checksum FROM schema_migrations WHERE id = '001_test.sql'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(stored, checksum_hex(TEST_MIGRATIONS[0].sql));
    }

    #[test]
    fn legacy_row_without_checksum_is_backfilled() {
        // Old-shape tracking table (no checksum column) with an applied row
        // — simulates a database migrated before DB-02 shipped.
        let mut conn = fresh();
        conn.execute_batch(
            "CREATE TABLE schema_migrations (
                id TEXT PRIMARY KEY,
                applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            )",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO schema_migrations (id) VALUES ('001_test.sql')",
            [],
        )
        .unwrap();
        conn.execute_batch("CREATE TABLE test_table (id INTEGER PRIMARY KEY)")
            .unwrap();

        run(&mut conn, TEST_MIGRATIONS).unwrap();

        let stored: String = conn
            .query_row(
                "SELECT checksum FROM schema_migrations WHERE id = '001_test.sql'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            stored,
            checksum_hex(TEST_MIGRATIONS[0].sql),
            "legacy row must be backfilled with the current definition checksum"
        );
    }

    // ── DB-05: FK isolation around rebuild migrations ──────────────

    #[test]
    fn foreign_keys_disabled_during_rebuild_migration() {
        let mut conn = fresh(); // FK enforcement ON

        run(
            &mut conn,
            &[Migration {
                id: "001_parent.sql",
                sql: "CREATE TABLE parent (id TEXT PRIMARY KEY);
                      CREATE TABLE child (id TEXT PRIMARY KEY, parent_id TEXT NOT NULL REFERENCES parent(id) ON DELETE CASCADE);",
            }],
        )
        .unwrap();
        conn.execute("INSERT INTO parent (id) VALUES ('p1')", [])
            .unwrap();
        conn.execute("INSERT INTO child (id, parent_id) VALUES ('c1', 'p1')", [])
            .unwrap();

        // Rebuild migration following the 081/089 pattern (DROP parent, then
        // rename the replacement into place). With FK enforcement ON at the
        // connection level, DROP TABLE would cascade-delete the child row.
        run(
            &mut conn,
            &[Migration {
                id: "002_rebuild.sql",
                sql: "CREATE TABLE parent_new (id TEXT PRIMARY KEY);
                      INSERT INTO parent_new SELECT id FROM parent;
                      DROP TABLE parent;
                      ALTER TABLE parent_new RENAME TO parent;",
            }],
        )
        .unwrap();

        // Child row must survive the parent rebuild.
        let children: i64 = conn
            .query_row("SELECT COUNT(*) FROM child", [], |r| r.get(0))
            .unwrap();
        assert_eq!(children, 1, "child row must survive parent rebuild");

        // FK enforcement restored, and no violations remain.
        let fk_violations: i64 = conn
            .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(fk_violations, 0, "no FK violations after rebuild");
    }
}
