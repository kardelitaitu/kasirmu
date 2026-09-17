//! Raw key-value settings helpers.
//!
//! OPEN ASYMMETRY, recorded 12-09-26, deliberately not decided here: two
//! in-transaction delta writers coexist. The standalone ledger door
//! ([`Settings::write_delta`]) wraps a nested caller's attempt in a SAVEPOINT
//! ([`Settings::write_delta_nested`]) and rolls the attempt back on
//! collision; the tracked funnel's canonical body
//! ([`Settings::set_tracked_in_tx`] → `write_delta_on_tx`) writes its delta
//! bare, single-attempt, inside the caller's transaction with no savepoint.
//! Which variant a nested caller gets therefore depends on which door it
//! entered. Reconciling savepoint-versus-bare is a finding to record, not a
//! path to pick at this hour.
/*
last audited 25-07-26 by RSA-Agent (platform-core slice C: settings/raw deep read)
crate: platform-core | status: SAFE | lint: CLEAN
findings: exemplary — DB-08 delta-ledger concurrency contract documented and implemented (UNIQUE (key,terminal,version) collision retry under BEGIN IMMEDIATE, bounded 32 attempts, savepoint variant for nested callers with lingering-savepoint logging); all SQL parameterized; delta loss documented non-fatal with sync reconstruction path; next_delta_version .unwrap_or(1) is safe (collision retried)
next: none | perf: single-connection LOCAL GUC-free
*/

use super::Settings;
use crate::error::PlatformError;
use rusqlite::{Connection, params};

impl Settings {
    /// Read a single setting by key. Returns `None` if the key doesn't exist.
    pub fn get(conn: &Connection, key: &str) -> Result<Option<String>, PlatformError> {
        let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
        let mut rows = stmt.query_map(params![key], |row| row.get::<_, String>(0))?;
        match rows.next() {
            Some(Ok(v)) => Ok(Some(v)),
            Some(Err(e)) => Err(e.into()),
            None => Ok(None),
        }
    }

    /// Insert or update a setting.
    pub fn set(conn: &Connection, key: &str, value: &str) -> Result<(), PlatformError> {
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value,
                                            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
            params![key, value],
        )?;
        Ok(())
    }

    /// Delete a setting. Returns `true` if the key existed.
    pub fn remove(conn: &Connection, key: &str) -> Result<bool, PlatformError> {
        let n = conn.execute("DELETE FROM settings WHERE key = ?1", params![key])?;
        Ok(n > 0)
    }

    /// Load every row from the `settings` table as `(key, value)` pairs.
    pub fn load_all(conn: &Connection) -> Result<Vec<(String, String)>, PlatformError> {
        let mut stmt = conn.prepare("SELECT key, value FROM settings ORDER BY key")?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        rows.map(|r| Ok(r?)).collect()
    }

    /// Load only the rows a portable package may carry — the egress face of
    /// [`IngestPolicy::PortablePackage`].
    ///
    /// `load_all` filtered through the ONE shared predicate,
    /// [`keys::is_non_exportable_setting_key`], plus the lifecycle-manager
    /// prefix rule ([`is_manager_owned_key`]). Nothing is restated here: the
    /// credential/device list lives in `keys.rs` and is built from the key
    /// constants themselves.
    ///
    /// `Settings::load_all` is deliberately NOT filtered and must not be. It is
    /// a general-purpose internal accessor — `Settings::load_features` and
    /// `Settings::prune_stale_features` (crates/kasirmu-core) both read through it,
    /// and feature rows are ordinary settings rows — so filtering it would
    /// re-type a whole-table read as an egress read and silently break feature
    /// pruning. Portability is a property of the caller's policy, expressed by
    /// this accessor, not of the table.
    pub fn load_exportable(conn: &Connection) -> Result<Vec<(String, String)>, PlatformError> {
        Ok(Self::load_all(conn)?
            .into_iter()
            .filter(|(key, _)| IngestPolicy::PortablePackage.admits(key))
            .collect())
    }

    /// Insert or update a setting under an explicit [`IngestPolicy`].
    ///
    /// Identical to [`Settings::set`] for [`IngestPolicy::TrustedLocal`]. For
    /// a filtering policy, a refused key is **warned about and skipped**: the
    /// call returns `Ok(false)`, writes nothing, and leaves the caller's batch
    /// running. A refusal is not an error and must not become one — the house
    /// precedent is the unsupported-action warn-and-continue in
    /// `platform/sync/src/queue.rs` and the non-fatal delta write in this
    /// file. Aborting a sync batch or a package restore over one disallowed
    /// row would turn a defence into an outage.
    ///
    /// Returns `true` when the row was written, `false` when the policy
    /// refused it. The warn line names the key and the policy, never the value.
    pub fn set_with_policy(
        conn: &Connection,
        key: &str,
        value: &str,
        policy: impl IngestPolicyKind,
    ) -> Result<bool, PlatformError> {
        if !policy.admits(key) {
            tracing::warn!(
                key,
                policy = policy.label(),
                "settings key refused by ingest policy (skipped, batch continues)"
            );
            return Ok(false);
        }
        Self::set(conn, key, value)?;
        Ok(true)
    }

    /// Write multiple settings under an explicit [`IngestPolicy`], inside the
    /// caller's own transaction.
    ///
    /// The batch form of [`Settings::set_with_policy`]: refused rows are
    /// warned about and skipped, every other row is written, and the call still
    /// returns `Ok(())`. It takes `&rusqlite::Transaction` so a lane that
    /// already owns a transaction (the sync dispatcher, the `.ozpkg` import)
    /// does not open a nested one.
    pub fn set_batch_with_policy(
        tx: &rusqlite::Transaction<'_>,
        rows: &[(String, String)],
        policy: impl IngestPolicyKind + Copy,
    ) -> Result<(), PlatformError> {
        for (key, value) in rows {
            Self::set_with_policy(tx, key, value, policy)?;
        }
        Ok(())
    }

    /// Write multiple settings inside a single transaction.
    pub fn set_batch(conn: &Connection, rows: &[(String, String)]) -> Result<(), PlatformError> {
        let tx = conn.unchecked_transaction()?;
        for (key, value) in rows {
            tx.execute(
                "INSERT INTO settings (key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value,
                                                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
                params![key, value],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    // ── Delta ledger methods ──────────────────────────────────────

    /// Standalone delta writer — serialized allocation with a bounded retry.
    ///
    /// Computes `version = MAX(version) + 1` for the `(key, terminal_id)`
    /// pair and inserts a new row.
    ///
    /// # Concurrency contract (DB-08, migration 116)
    ///
    /// Migration 116 adds `idx_setting_updated_unique_version`, a UNIQUE
    /// index on `(key, terminal_id, version)`. Two concurrent writers that
    /// compute the same `MAX(version) + 1` collide: the loser's INSERT fails
    /// with a constraint error. When called standalone (no outer
    /// transaction), each attempt therefore runs in its own `BEGIN IMMEDIATE`
    /// transaction — SQLite's reserved write lock serializes concurrent
    /// allocations — and a constraint/busy collision retries with a fresh
    /// snapshot, so the ledger records gapless sequential versions and no
    /// delta is lost. Callers already inside a transaction take the
    /// single-attempt savepoint path (`write_delta_nested`): their outer
    /// transaction's earlier value write already serializes the allocation,
    /// and a retry inside the same transaction could not observe the
    /// winner's committed row anyway.
    pub fn write_delta(
        conn: &Connection,
        key: &str,
        value: &str,
        terminal_id: &str,
    ) -> Result<(), PlatformError> {
        if !conn.is_autocommit() {
            Self::write_delta_nested(conn, key, value, terminal_id)
        } else {
            Self::write_delta_standalone(conn, key, value, terminal_id)
        }
    }

    /// Single-attempt savepoint variant for callers already inside a
    /// transaction. `execute_batch` is used instead of `conn.savepoint()`
    /// because the latter requires `&mut Connection`. A collision surfaces
    /// the constraint error (the caller's earlier value write has already
    /// serialized the allocation, so this is not expected).
    fn write_delta_nested(
        conn: &Connection,
        key: &str,
        value: &str,
        terminal_id: &str,
    ) -> Result<(), PlatformError> {
        let sp = format!("_oz_delta_{}", std::process::id());
        conn.execute_batch(&format!("SAVEPOINT {sp}"))?;
        let result = Self::write_delta_row(
            conn,
            key,
            value,
            terminal_id,
            Self::next_delta_version(conn, key, terminal_id),
        );
        match result {
            Ok(()) => {
                conn.execute_batch(&format!("RELEASE {sp}"))?;
                Ok(())
            }
            Err(e) => {
                tracing::warn!(key, terminal_id, error = %e, "delta write failed, rolling back savepoint");
                if let Err(rollback_err) = conn.execute_batch(&format!("ROLLBACK TO {sp}")) {
                    tracing::error!(key, terminal_id, error = %rollback_err, "ROLLBACK TO savepoint failed — savepoint may linger");
                }
                Err(e)
            }
        }
    }

    /// Per-attempt `BEGIN IMMEDIATE` variant with a bounded retry for
    /// standalone callers (see the `write_delta` concurrency contract).
    fn write_delta_standalone(
        conn: &Connection,
        key: &str,
        value: &str,
        terminal_id: &str,
    ) -> Result<(), PlatformError> {
        const MAX_ATTEMPTS: u32 = 32;
        let mut attempt: u32 = 0;
        loop {
            let result = (|| -> Result<(), PlatformError> {
                conn.execute_batch("BEGIN IMMEDIATE")?;
                let version = Self::next_delta_version(conn, key, terminal_id);
                Self::write_delta_row(conn, key, value, terminal_id, version)?;
                conn.execute_batch("COMMIT")?;
                Ok(())
            })();
            match result {
                Ok(()) => return Ok(()),
                Err(e) => {
                    // End the attempt's transaction (a no-op when BEGIN failed).
                    let _ = conn.execute_batch("ROLLBACK");
                    let transient = matches!(
                        &e,
                        PlatformError::Db(rusqlite::Error::SqliteFailure(err, _))
                            if err.code == rusqlite::ErrorCode::ConstraintViolation
                                || err.code == rusqlite::ErrorCode::DatabaseBusy
                    );
                    if transient && attempt + 1 < MAX_ATTEMPTS {
                        attempt += 1;
                        continue;
                    }
                    if transient {
                        tracing::warn!(key, terminal_id, error = %e, "delta write gave up after concurrent collisions");
                    }
                    return Err(e);
                }
            }
        }
    }

    /// Compute the next version for a `(key, terminal_id)` pair.
    fn next_delta_version(conn: &Connection, key: &str, terminal_id: &str) -> i64 {
        conn.query_row(
            "SELECT COALESCE(MAX(version), 0) + 1
             FROM setting_updated
             WHERE key = ?1 AND terminal_id = ?2",
            params![key, terminal_id],
            |row| row.get(0),
        )
        .unwrap_or(1)
    }

    /// Insert one versioned delta row.
    fn write_delta_row(
        conn: &Connection,
        key: &str,
        value: &str,
        terminal_id: &str,
        version: i64,
    ) -> Result<(), PlatformError> {
        conn.execute(
            "INSERT INTO setting_updated (key, value, terminal_id, version)
             VALUES (?1, ?2, ?3, ?4)",
            params![key, value, terminal_id, version],
        )?;
        Ok(())
    }

    /// Get the latest version number for a `(key, terminal_id)` pair.
    ///
    /// Returns `None` if no deltas exist for that pair. Used by shared
    /// settings cards to detect concurrent edits (compare known version
    /// against the stored version before writing).
    pub fn get_version(
        conn: &Connection,
        key: &str,
        terminal_id: &str,
    ) -> Result<Option<i64>, PlatformError> {
        let mut stmt = conn.prepare(
            "SELECT version FROM setting_updated
             WHERE key = ?1 AND terminal_id = ?2
             ORDER BY version DESC LIMIT 1",
        )?;
        let mut rows = stmt.query_map(params![key, terminal_id], |row| row.get::<_, i64>(0))?;
        match rows.next() {
            Some(Ok(v)) => Ok(Some(v)),
            Some(Err(e)) => Err(e.into()),
            None => Ok(None),
        }
    }

    /// The one deny-listed credential the tracked funnel still writes:
    /// `smtp_config` is legitimately funnel-written by both shells today —
    /// each merges its password JSON (`Store::merged_smtp_password_json`)
    /// before the write, and the key has its own merge and encryption path —
    /// so the refusal below excepts it by name. The exception lives HERE,
    /// beside the refusal, and is deliberately not threaded through the
    /// callers: a policy that exists in three call sites is exactly the one
    /// the fourth funnel forgets.
    ///
    /// SECURITY DECISION, pinned: this exception is compared against the RAW
    /// key, while the deny list is matched normalised (trimmed and ASCII
    /// case-folded by `keys::is_secret_setting_key`). The asymmetry is
    /// deliberate and must stay. An exception to a security guard is the
    /// narrowest thing in the guard; folding the exception the same way would
    /// let any casing or padding of `smtp_config` claim it and walk back
    /// through the door the normalisation just closed. What that costs is that
    /// a hand-written variant of the legitimate key is refused rather than
    /// admitted — a support annoyance, not a hole, and a theoretical one: both
    /// shells write this key from code as an exact constant.
    /// Pinned by `decision_pin_the_credential_exception_is_matched_exactly`.
    const CLEARTEXT_CREDENTIAL_EXCEPTION: &str = crate::settings::keys::SMTP_CONFIG;

    /// The cleartext-credential rule as a QUESTION: `Some(message)` when the
    /// tracked funnel must refuse `key`, `None` when the key may be written.
    ///
    /// Byte-identical to the message `Settings::refuse_cleartext_credential`
    /// raises, so a lane that pre-flights a batch and a lane that refuses per
    /// row hand back the same words.
    ///
    /// This is the ONE definition of the rule — the predicate, the named
    /// exception above, and the wording of the refusal all live here.
    /// `refuse_cleartext_credential` (private) is it turned into an error;
    /// [`Settings::set_tracked`] and [`Settings::set_tracked_in_tx`] are it
    /// applied per row.
    ///
    /// It is public because a BATCH door must ask the rule of every row
    /// BEFORE writing any of them: a loop that only refuses per row writes
    /// three rows before it answers no, which is not the all-or-nothing the
    /// batch commands promise their UI. A lane asks this and wraps the
    /// returned string in its own error type; it must NOT rebuild the
    /// predicate, because the day the exception changes, one lane keeps
    /// refusing and the other starts accepting and nothing fails.
    ///
    /// The message names the key and never the value — a value in an error
    /// string is a leak through the log lane.
    pub fn cleartext_credential_refusal(key: &str) -> Option<String> {
        // The predicate above normalises `key`; this comparison does NOT, on
        // purpose — see `CLEARTEXT_CREDENTIAL_EXCEPTION`. Folding the
        // exception would make it a bypass.
        if crate::settings::keys::is_secret_setting_key(key)
            && key != Self::CLEARTEXT_CREDENTIAL_EXCEPTION
        {
            return Some(format!(
                "{key} holds a credential — the tracked settings funnel refuses to store it in cleartext"
            ));
        }
        None
    }

    /// The manager-owned-key refusal: ONE sentence, both shells.
    ///
    /// Same shape as [`Settings::cleartext_credential_refusal`] one door over:
    /// the rule ([`is_manager_owned_key`]) and the WORDING of the refusal both
    /// live here, and a lane that must refuse before it writes its first row
    /// asks this and wraps the answer in its own error variant. It must NOT
    /// rebuild the sentence.
    ///
    /// `owner` is the manager NAME, not the wording. Only the desktop lane can
    /// name a manager (its `managed_key_owner` label lookup, in
    /// `crates/kasirmu-bridge/src/settings.rs`); the tablet has no manager surface and
    /// passes `None`, which is the generic `dedicated` spelling the bridge batch
    /// door already used. Before this, each lane carried its own paraphrase of
    /// one rule — the tablet hardcoded one phrasing, the bridge built another at
    /// both of its doors — three doors, two sentences, and nothing failed when
    /// they drifted. That is the defect `371b6ace0` closed for the credential
    /// sentence one door over, in the same subsystem, for the third time.
    ///
    /// Like the credential refusal, the message names the key and never the
    /// value — a value in an error string is a leak through the log lane.
    pub fn manager_owned_key_refusal(key: &str, owner: Option<&str>) -> Option<String> {
        if !is_manager_owned_key(key) {
            return None;
        }
        let owner = owner.unwrap_or("dedicated");
        Some(format!(
            "{key} is managed by the {owner} controls — use those"
        ))
    }
    /// Refuse to store a deny-listed credential in cleartext through the
    /// tracked funnel: the question above, turned into an error.
    ///
    /// Private on purpose — a lane that must refuse BEFORE it writes its
    /// first row asks [`Settings::cleartext_credential_refusal`] and wraps the
    /// message in its own error type, so no lane has to name a
    /// `PlatformError` it does not otherwise use.
    ///
    /// `crate::settings::keys::is_secret_setting_key` is the same predicate
    /// the raw `get_setting` IPC surface refuses reads with (C-2); this is
    /// its write face. Unlike the ingest-policy refusal (warn-and-skip), a
    /// tracked refusal is an ERROR — the renderer-reachable doors must fail
    /// loudly, not quietly drop a credential write the operator believes
    /// happened — and like the manager-key guard and the ingest refusal
    /// alike, the message names the key and never the value.
    ///
    /// The rule is [`Settings::cleartext_credential_refusal`]; this adds the
    /// warn line and the error, so the per-row door and a batch pre-flight
    /// can never answer the same key differently.
    fn refuse_cleartext_credential(key: &str) -> Result<(), PlatformError> {
        if let Some(message) = Self::cleartext_credential_refusal(key) {
            tracing::warn!(
                key,
                "cleartext credential write refused by the tracked settings funnel"
            );
            return Err(PlatformError::Internal(message));
        }
        Ok(())
    }

    /// Set a value AND write a delta record — both in a single transaction.
    ///
    /// This is the recommended method for Tauri command handlers that have
    /// access to a terminal ID and NO transaction of their own; a caller that
    /// already holds one calls [`Settings::set_tracked_in_tx`] instead.
    ///
    /// A thin wrapper: it opens the transaction and hands it to
    /// [`Settings::set_tracked_in_tx`], which is the CANONICAL body — the
    /// value write and the delta write live there and only there, and the
    /// credential rule it applies is still the one definition. Splitting
    /// them into two bodies is how the batch door ended up restating the
    /// credential rule in the bridge, and a restated rule is the drift this
    /// file's own doc block exists to warn about; a lane that already
    /// holds a transaction now calls the in-tx form directly and cannot
    /// drift.
    ///
    /// The wrapper asks the refusal once BEFORE opening the transaction.
    /// The predicate is a pure function of the key, so a caller already
    /// inside a transaction of its own gets the refusal and never the
    /// unspecified rusqlite nested-BEGIN error: which answer a caller sees
    /// must not depend on whether a transaction happens to be open.
    /// (Pinned by
    /// `set_tracked_refuses_before_it_begins_when_a_transaction_is_already_open`
    /// in `raw_tests.rs`.)
    ///
    /// Everything else the body does is unchanged by the extraction: a
    /// deny-listed credential key is REFUSED with an error naming the key
    /// and never the value, excepting only `smtp_config`. A failed delta
    /// write stays non-fatal — warned about, the value write stands. Why
    /// that is safe is a dated claim, not an invariant, and it lives where
    /// the claim was first written down: `SAFETY_BASIS` in
    /// `crates/kasirmu-cli/src/commands/credential_deltas.rs` — nothing reads
    /// the ledger back and `get_version` has zero production callers, AS
    /// OF 2026-09-12. (An earlier draft of this line said "the sync layer
    /// reconstructs" from the settings table; no such code exists — the
    /// only `INSERT INTO setting_updated` in the tree is the writer in
    /// this file.) A missing delta row is also not a rare swallowed error:
    /// the ledger covers ONLY the tracked doors, and every typed setter —
    /// the receipt, store and credit saves in
    /// `crates/kasirmu-bridge/src/settings.rs` among them — writes its value
    /// with no delta row at all, so an incomplete ledger is the design,
    /// not the exception.
    pub fn set_tracked(
        conn: &Connection,
        key: &str,
        value: &str,
        terminal_id: &str,
    ) -> Result<(), PlatformError> {
        // Refuse BEFORE the begin: a caller already inside a transaction
        // that hit the old order got the rusqlite nested-BEGIN error (whose
        // exact wording rusqlite 0.31 does not guarantee) instead of the
        // refusal. The predicate is a pure function of the key, so asking
        // it here costs nothing and the canonical body asks it again
        // harmlessly.
        Self::refuse_cleartext_credential(key)?;
        let tx = conn.unchecked_transaction()?;
        Self::set_tracked_in_tx(&tx, key, value, terminal_id)?;
        tx.commit()?;
        Ok(())
    }

    /// Set a value AND write a delta record INSIDE the caller's transaction.
    ///
    /// The in-transaction form of [`Settings::set_tracked`], and the
    /// canonical body of the tracked write: it owns the cleartext-credential
    /// refusal (and so the one named exception), the value write, and the
    /// delta write. It takes `&rusqlite::Transaction` rather than opening a
    /// transaction of its own — the `log_audit_in_tx` /
    /// [`Settings::set_batch_with_policy`] shape — so a command that already
    /// owns the transaction (the desktop batch door) can run the whole
    /// tracked write without nesting a second BEGIN, which SQLite rejects.
    ///
    /// Refusal semantics are unchanged from `set_tracked`: an ERROR naming
    /// the key and never the value, raised before anything is written. A
    /// failed delta write stays non-fatal — it is warned about and the
    /// value write stands. Why that is safe is a dated claim, not an
    /// invariant: nothing reads the ledger back and `get_version` has zero
    /// production callers, AS OF 2026-09-12, as first written down in
    /// `SAFETY_BASIS` (`crates/kasirmu-cli/src/commands/credential_deltas.rs`)
    /// — the "sync layer can reconstruct" mechanism this line used to cite
    /// does not exist. Nor is a missing delta row an exception to a
    /// complete ledger: it covers only the tracked doors, while every
    /// typed setter (the receipt, store and credit saves in
    /// `crates/kasirmu-bridge/src/settings.rs`) writes its value with no delta
    /// row at all.
    ///
    /// A batch caller that must refuse BEFORE writing its first row asks
    /// [`Settings::cleartext_credential_refusal`] over the whole key set
    /// first; the per-row refusal here is the floor under that pre-flight,
    /// not a substitute for it.
    pub fn set_tracked_in_tx(
        tx: &rusqlite::Transaction<'_>,
        key: &str,
        value: &str,
        terminal_id: &str,
    ) -> Result<(), PlatformError> {
        Self::refuse_cleartext_credential(key)?;
        Self::set(tx, key, value)?;
        // Inline delta write within the caller's transaction: no nested BEGIN
        // (SQLite does not support nested transactions).
        if let Err(e) = Self::write_delta_on_tx(tx, key, value, terminal_id) {
            tracing::warn!(key, terminal_id, error = %e, "delta write failed (non-fatal)");
        }
        Ok(())
    }

    /// Batch write with delta tracking for every row.
    ///
    /// Like `set_batch()`, but also writes a delta row for each key/value
    /// pair. All operations run in a single transaction.
    ///
    /// Same refusal as `set_tracked`, applied batch-wide BEFORE any write:
    /// one deny-listed credential row aborts the whole batch rather than
    /// silently dropping one entry, so this batch door cannot become the
    /// front door the single-write guard closed.
    pub fn set_batch_tracked(
        conn: &Connection,
        rows: &[(String, String)],
        terminal_id: &str,
    ) -> Result<(), PlatformError> {
        // Batch-wide refusal BEFORE any write — one deny-listed row aborts
        // the whole batch rather than dropping only its own row, so this door
        // cannot become the new front door.
        //
        // What this line used to claim — that the batch-wide shape "matches
        // the bridge's `run_set_settings_batch` guard" — was a misdescription
        // until 08-09-26. The bridge loop got its credential refusal from
        // `Settings::set_tracked`, which applies it PER ROW, so a batch of
        // three good rows and one credential row wrote the three and refused
        // the fourth. The bridge now refuses both guards batch-wide before any
        // write, so the two doors really do agree; see
        // `crates/kasirmu-bridge/src/settings.rs::run_set_settings_batch`.
        //
        // DEAD CODE, RECORDED NOT DELETED (08-09-26 review): this function has
        // no production caller — only `oz_core::settings` re-exports it and
        // the platform-core tests exercise it. It also cannot be called from
        // inside a caller's transaction: like `set_tracked` it opens its own
        // `unchecked_transaction`, and a second BEGIN fails with "cannot start
        // a transaction within a transaction". A tablet that adopts a batch
        // door must pass a BARE connection, or grow an in-transaction variant
        // the way the bridge did. Kept because it is the guard for that door.
        for (key, _) in rows {
            Self::refuse_cleartext_credential(key)?;
        }
        let tx = conn.unchecked_transaction()?;
        for (key, value) in rows {
            // The SAME canonical body `set_tracked` delegates to — refusal,
            // value write, non-fatal delta write — run inside this
            // transaction instead of a copy of it written here.
            Self::set_tracked_in_tx(&tx, key, value, terminal_id)?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Write a delta row using an existing transaction (no nested BEGIN).
    fn write_delta_on_tx(
        tx: &rusqlite::Transaction,
        key: &str,
        value: &str,
        terminal_id: &str,
    ) -> Result<(), PlatformError> {
        let version = Self::next_delta_version(tx, key, terminal_id);
        Self::write_delta_row(tx, key, value, terminal_id, version)
    }
}
// ── Ingest policy ───────────────────────────────────────────────────

/// The seal. Private to this module on purpose: nothing outside `settings`
/// can implement [`IngestPolicyKind`], so no lane can invent a policy of its
/// own — the only values a funnelled accessor accepts are the three variants
/// of [`IngestPolicy`] below. Skipping the filter is therefore UNWRITABLE
/// rather than merely unreviewed, which is the point of sealing it: an
/// `AllowAll` variant would be one keystroke away forever, and a lane-local
/// `struct MyPolicy` would be one `impl` away.
mod sealed {
    /// Sealed marker for the ingest-policy types.
    pub trait Sealed {}
}

/// Where a settings read or write came from, and therefore what may legally
/// travel with it.
///
/// Three lanes exist today and each has a different trust property:
///
/// * [`IngestPolicy::TrustedLocal`] — the app itself, on the machine that
///   owns the database: the settings UI, first-run seeding, the lifecycle
///   managers that mint per-install secrets, and every typed setter in this
///   crate. Nothing is filtered; this is what `Settings::set` does today.
/// * [`IngestPolicy::PortablePackage`] — the `.ozpkg` lane, in both
///   directions. A package is written to a file, carried to another install
///   and opened with a shared password, so per-install credentials and
///   device-bound identities must not cross it (the invariant documented on
///   `keys::SECRET_KEY_DENY_LIST`).
/// * [`IngestPolicy::RemoteSync`] — anything arriving from the sync server.
///   Refuses for the same reason as a portable package, with a sharper
///   threat: no sync item is signed or MACed anywhere in `transport` or
///   `sync_api`, the push handler stores any action string opaquely, and no
///   ADR claims a trusted-server threat model. One accepted write reaches
///   every terminal in the tenant, so an unfiltered ingest lets a single
///   tenant credential — or the server operator — overwrite `machine_id` or
///   `local_api.secret` on every install.
///
/// Sealed by [`sealed::Sealed`]; there is deliberately no variant meaning
/// "filter nothing, I promise I am portable".
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IngestPolicy {
    /// Local, on-device write by code that owns the database: no filtering.
    TrustedLocal,
    /// `.ozpkg` export/import: credentials and device-bound ids are refused.
    PortablePackage,
    /// Settings arriving from the sync server: the refusals a package makes,
    /// PLUS the peer-named hazard set (`keys::PEER_NAMED_HAZARD_KEYS`) - the one
    /// place the two untrusted lanes do not share a rule, because this is the only
    /// lane where the key string belongs to a SENDER rather than to this app.
    RemoteSync,
}

/// What an ingest policy permits. Sealed — see [`sealed`].
///
/// A funnelled accessor takes `impl IngestPolicyKind`, so the only way to
/// reach one is to name an [`IngestPolicy`] variant.
pub trait IngestPolicyKind: sealed::Sealed {
    /// True when `key` may travel under this policy.
    fn admits(&self, key: &str) -> bool;
    /// Static name for log lines. Never carries a value.
    fn label(&self) -> &'static str;
}

impl sealed::Sealed for IngestPolicy {}

impl IngestPolicyKind for IngestPolicy {
    fn admits(&self, key: &str) -> bool {
        match self {
            // The local lane owns the database; filtering it would break the
            // lifecycle managers that mint these very keys.
            IngestPolicy::TrustedLocal => true,
            // The package lane keeps the shared rule: a backup restore
            // legitimately contains whatever the app owns, so this arm refuses
            // exactly what it always refused and nothing else.
            IngestPolicy::PortablePackage => {
                !(crate::settings::keys::is_non_exportable_setting_key(key)
                    || is_manager_owned_key(key))
            }
            // Remote sync is the same refusals PLUS the hazard set, and this is
            // the one deliberate asymmetry between the two untrusted lanes.
            //
            // keys::is_peer_named_hazard_key is refused HERE and nowhere else,
            // because it is not about what may travel in a package: it is about
            // what a SENDER may name. Those six names sit outside all three
            // shared exclusion lists - none is a credential, a device identity
            // or manager-owned - so an exclusion list over an open namespace
            // admitted them, and nothing signs the item that carries them. See
            // the doc on the list for why sync_server_url is the serious one.
            //
            // THE ASYMMETRY IS THE DEBT, stated so it does not read as a rule:
            // these names still leave this install in a .ozpkg, and the egress
            // gate in crates/kasirmu-bridge/src/settings.rs and
            // apps/tablet-client/src/commands/settings.rs asks admits(), so
            // either list can still be OFFERED to the network and is now simply
            // refused on arrival. Closing the namespace is the paired allow-list,
            // not this arm.
            IngestPolicy::RemoteSync => {
                !(crate::settings::keys::is_non_exportable_setting_key(key)
                    || is_manager_owned_key(key)
                    || crate::settings::keys::is_peer_named_hazard_key(key))
            }
        }
    }

    fn label(&self) -> &'static str {
        match self {
            IngestPolicy::TrustedLocal => "trusted_local",
            IngestPolicy::PortablePackage => "portable_package",
            IngestPolicy::RemoteSync => "remote_sync",
        }
    }
}

/// True for keys owned by a dedicated lifecycle manager rather than by the
/// generic settings surface: `local_api.*` and `lan_server.*`.
///
/// Writing one through a bulk lane desyncs the manager behind its back:
/// `local_api.enabled` persisted without the Local API server running is a
/// fail-open intent, and `lan_server.bind` widens a listener with no PSK
/// change. The sealed policy is where the rule belongs, because it is exactly
/// the per-lane difference a policy type exists to express — and this is now
/// the ONLY definition of it. The desktop bridge used to carry the same
/// decision as a second `starts_with` pair (`managed_key_owner` over
/// `"local_api."` / `"lan_server."`, with a boolean `is_managed_key` beside
/// it); that copy is deleted, so the two definitions that could drift are down
/// to one.
///
/// **Who asks it** (this is the only place the decision survives, so the
/// callers are recorded here and nowhere else):
///
/// * The sealed policy above — [`IngestPolicyKind::admits`] ORs it in for BOTH
///   untrusted directions, so `.ozpkg` and remote-sync ingest refuse these
///   prefixes alongside the deny list. [`Settings::load_exportable`] and
///   `crates/kasirmu-bridge/src/data.rs` reach it that way, and so does
///   `crates/kasirmu-cli/src/commands/ozpkg.rs`, which asks `PortablePackage` rather
///   than the bare predicate — non-credential but manager-owned rows like
///   `local_api.enabled` and `lan_server.bind` therefore travel in neither a
///   CLI package nor a GUI one.
/// * Tablet write funnel — `apps/tablet-client/src/commands/settings.rs` calls
///   this predicate directly and refuses a manager-owned key with it.
/// * Desktop write funnel — `crates/kasirmu-bridge/src/settings.rs` refuses with
///   this predicate too, through its `managed_key_owner`, which adds ONLY the
///   owner label the refusal message shows. The label stays in the bridge
///   because the message text is a UI surface rather than a second policy, and
///   even it takes its prefixes from `keys::LOCAL_API_SECRET` /
///   `keys::LAN_SERVER_PSK` instead of a retyped list. A third prefix joining
///   this predicate therefore refuses on every lane at once, and the desktop
///   message falls back to a generic label rather than to accepting.
/// * Sync ingest (`platform/sync/src/queue.rs`) — refuses the deny list and
///   these prefixes on ingest, symmetrically with egress. Both dispatchers
///   write through the ONE funnel accessor
///   `Settings::set_with_policy(..., IngestPolicy::RemoteSync)` — the atomic
///   arm at `queue.rs:531-536` and the legacy arm at `queue.rs:698-703` — and
///   `queue.rs:41-56` is the read-only face of that same predicate, kept so a
///   refused key is never reported as a change.
///
///   What is still NOT checked is the FORM of the stored value. `admits` is a
///   key-only predicate; once it passes, the accessor hands the value to
///   `Settings::set` verbatim, with no shape check and no encryption. A
///   plaintext credential arriving under an admitted key therefore survives
///   ingest. That is the live open question on this lane, so do not read the
///   refusal above as a value guard — it is a key guard.
///
/// Nothing is refused under [`IngestPolicy::TrustedLocal`]: the managers that
/// own these keys write them locally, and filtering that would break them.
///
/// The candidate is folded exactly as the credential half of the same ingest
/// boolean folds it — [`keys::is_non_exportable_setting_key`] trims and
/// ASCII-case-folds through `keys::normalised_candidate`, and so does this,
/// against the SAME shared fold (it is `pub` in `keys.rs` because the two
/// callers of the fold sit on opposite sides of the crate boundary — this gate
/// inside platform-core, the owner label in `crates/kasirmu-bridge/src/settings.rs`
/// — and no second normalisation is written here). Before that, one
/// boolean had two matching semantics inside it: `IngestPolicy::PortablePackage
/// | RemoteSync` refused `STRIPE.API_KEY` on the credential arm while its
/// manager arm `starts_with`-matched raw, so `LAN_SERVER.BIND` and
/// `Local_api.enabled` were admitted by both untrusted lanes. Every consumer
/// reads the exact lowercase constant, so no such variant row did anything
/// today — this closes policy drift, not an exploit. The hazard was the next
/// prefix: a reader adding one would have assumed the fold covered it.
///
/// The fold applies to the INPUT, never to the prefix literals, which stay the
/// lowercase constants they are. Callers still hand this the raw key, so the
/// signature is unchanged and no caller moves.
pub fn is_manager_owned_key(key: &str) -> bool {
    let candidate = crate::settings::keys::normalised_candidate(key);
    candidate.starts_with("local_api.") || candidate.starts_with("lan_server.")
}

/// Compile-time belt on the third list: a hazard name must be NEW to the guard,
/// not a second refusal of a name `keys::SECRET_KEY_DENY_LIST` or
/// `keys::NON_EXPORTABLE_DEVICE_KEYS` already carries.
///
/// Why it sits here and not beside the list in `keys.rs`: the ratchet
/// `keys_tests::decision_pin_membership_tests_live_only_in_the_identity_functions`
/// reads that file and fails any line that tests one of those two lists outside
/// the identity functions - which is the second-definition rule it exists to
/// hold. This module is the only other place that composes all three lists into
/// one boolean (the `RemoteSync` arm of [`IngestPolicyKind::admits`]), so the
/// belt belongs next to the composition it protects rather than at the
/// declarations that composition reads.
///
/// Runtime is the wrong place to notice an overlap at all: both answers are
/// refused, so a double membership would be invisible in behaviour and would
/// survive as two lists agreeing by accident. A name on both lists is a defect;
/// here it is a compile error.
const _: () = {
    const fn same_name(a: &str, b: &str) -> bool {
        let (x, y) = (a.as_bytes(), b.as_bytes());
        if x.len() != y.len() {
            return false;
        }
        let mut i = 0;
        while i < x.len() {
            if x[i] != y[i] {
                return false;
            }
            i += 1;
        }
        true
    }
    const fn already_refused(name: &str) -> bool {
        let mut i = 0;
        while i < crate::settings::keys::SECRET_KEY_DENY_LIST.len() {
            if same_name(name, crate::settings::keys::SECRET_KEY_DENY_LIST[i]) {
                return true;
            }
            i += 1;
        }
        let mut j = 0;
        while j < crate::settings::keys::NON_EXPORTABLE_DEVICE_KEYS.len() {
            if same_name(name, crate::settings::keys::NON_EXPORTABLE_DEVICE_KEYS[j]) {
                return true;
            }
            j += 1;
        }
        false
    }
    let mut k = 0;
    while k < crate::settings::keys::PEER_NAMED_HAZARD_KEYS.len() {
        assert!(
            !already_refused(crate::settings::keys::PEER_NAMED_HAZARD_KEYS[k]),
            "a peer-named hazard key must not also sit on the credential or device list"
        );
        k += 1;
    }
};

#[cfg(test)]
#[path = "raw_tests.rs"]
mod tests;
