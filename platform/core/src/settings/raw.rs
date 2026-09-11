//! Raw key-value settings helpers.
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
    /// `Settings::prune_stale_features` (crates/oz-core) both read through it,
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

    /// Set a value AND write a delta record — both in a single transaction.
    ///
    /// This is the recommended method for Tauri command handlers that have
    /// access to a terminal ID. Calls `Settings::set()` for the value and
    /// `Settings::write_delta()` for the versioned audit trail, both
    /// within a single transaction. Since `write_delta()` uses a nested
    /// savepoint, the delta write failure does not roll back the `set()`.
    ///
    /// Delta write failures are logged but do not roll back the `set()` —
    /// delta loss is non-fatal; the sync layer can reconstruct from the
    /// settings table.
    pub fn set_tracked(
        conn: &Connection,
        key: &str,
        value: &str,
        terminal_id: &str,
    ) -> Result<(), PlatformError> {
        let tx = conn.unchecked_transaction()?;
        Self::set(conn, key, value)?;
        // Inline delta write within the existing transaction to avoid
        // nested BEGIN (SQLite does not support nested transactions).
        if let Err(e) = Self::write_delta_on_tx(&tx, key, value, terminal_id) {
            tracing::warn!(key, terminal_id, error = %e, "delta write failed (non-fatal)");
        }
        tx.commit()?;
        Ok(())
    }

    /// Batch write with delta tracking for every row.
    ///
    /// Like `set_batch()`, but also writes a delta row for each key/value
    /// pair. All operations run in a single transaction.
    pub fn set_batch_tracked(
        conn: &Connection,
        rows: &[(String, String)],
        terminal_id: &str,
    ) -> Result<(), PlatformError> {
        let tx = conn.unchecked_transaction()?;
        for (key, value) in rows {
            Self::set(conn, key, value)?;
            if let Err(e) = Self::write_delta_on_tx(&tx, key, value, terminal_id) {
                tracing::warn!(key, terminal_id, error = %e, "delta batch write failed (non-fatal)");
            }
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
    /// Settings arriving from the sync server: same refusals as a package.
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
            // Both untrusted directions share ONE rule, so the two lanes
            // cannot drift the way the two hand-copied shell lists did.
            IngestPolicy::PortablePackage | IngestPolicy::RemoteSync => {
                !(crate::settings::keys::is_non_exportable_setting_key(key)
                    || is_manager_owned_key(key))
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
/// change. This is the rule the desktop bridge has carried as
/// `managed_key_owner`/`is_managed_key` while the tablet and CLI lanes had
/// none; the sealed policy is where it belongs, because it is exactly the
/// per-lane difference a policy type exists to express. The bridge's copy is
/// the duplicate to delete when the lanes are converted — it is NOT deleted
/// here, and no lane calls this yet, so no behaviour moves in this commit.
///
/// **Which lanes change outcome when they are converted** (this is the only
/// place that decision survives, so it is recorded here and nowhere else):
///
/// * Desktop bridge — NO change. `is_non_exportable_key` already ORs this same
///   prefix rule in, so pointing `data.rs` at the policy is outcome-neutral and
///   its copy of the rule becomes dead code to delete.
/// * CLI `.ozpkg` (`crates/oz-cli/src/commands/ozpkg.rs`) — CHANGES. It applies
///   the platform-core predicate only, so `local_api.enabled` and
///   `lan_server.bind` still travel in its packages today; converting to
///   `PortablePackage` starts refusing them. Non-credential rows, but
///   manager-owned, so the refusal is correct — and it is the one conversion
///   that is not purely mechanical.
/// * Sync ingest (`platform/sync/src/queue.rs`) — CHANGES, strictly new
///   refusals: that lane applies ANY key the server sends with no check at all
///   today, so `RemoteSync` refuses both the deny list and these prefixes for
///   the first time.
///
/// Nothing is refused under [`IngestPolicy::TrustedLocal`]: the managers that
/// own these keys write them locally, and filtering that would break them.
pub fn is_manager_owned_key(key: &str) -> bool {
    key.starts_with("local_api.") || key.starts_with("lan_server.")
}

#[cfg(test)]
#[path = "raw_tests.rs"]
mod tests;
