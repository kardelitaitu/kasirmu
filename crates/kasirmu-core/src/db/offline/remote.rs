//! Remote-item application tracking: the receipt side of pull replay (SYNC-01).
//!
//! Split out of `db/offline.rs` on 2026-09-28. These methods record WHICH remote
//! items this install has already applied, so a re-delivered pull is skipped
//! rather than applied twice, and they track the failures that dead-letter.
//!
//! Kept as one module because the applied-set and the failure set are two views
//! of the same question — "have I seen this item, and did it stick?" — and the
//! in-transaction variants must agree with their `&self` twins.
//!
//! Invariant: marking an item applied and recording its effect happen in ONE
//! transaction (`*_in_tx`), so a crash between the two cannot leave an item
//! marked applied with no recorded effect.

use rusqlite::params;

use crate::db::Store;
use crate::error::CoreError;

use super::RemoteSyncFailure;

impl Store<'_> {
    /// Check whether a remote item has already been applied locally (SYNC-01).
    pub fn is_remote_item_applied(&self, item_id: &str) -> Result<bool, CoreError> {
        self.conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sync_applied_items WHERE item_id = ?1)",
                params![item_id],
                |row| row.get(0),
            )
            .map_err(Into::into)
    }

    /// Record a remote item as applied locally (SYNC-01 idempotency ledger).
    ///
    /// `INSERT OR IGNORE` — re-recording the same id is a no-op, so replay
    /// of a page never double-counts a mutation.
    ///
    /// Records no effect: delegates to
    /// [`Self::mark_remote_item_applied_with_effect`] with `None`. A caller
    /// that knows the effect the application had must use that one — this
    /// signature is kept so the delivery-only callers keep working.
    pub fn mark_remote_item_applied(&self, item_id: &str, action: &str) -> Result<(), CoreError> {
        self.mark_remote_item_applied_with_effect(item_id, action, None)
    }

    /// Record a remote item as applied locally, keyed by the EFFECT it had (C3).
    ///
    /// `item_id` proves the item was DELIVERED once; it says nothing about the
    /// effect that delivery had, so a retry that produces a second deduction is
    /// a second effect and must be visible as one. `effect_key` is that effect,
    /// and `idx_sync_applied_items_effect_key` (PARTIAL, `WHERE effect_key IS
    /// NOT NULL`) enforces it appears once.
    ///
    /// `None` is the honest value for a caller that does not know the effect:
    /// it stays NULL — never a default and never an empty string — and the
    /// partial index deliberately ignores it, so the pre-C3 rows and the
    /// not-yet-effect-aware writers cannot collide with each other.
    pub fn mark_remote_item_applied_with_effect(
        &self,
        item_id: &str,
        action: &str,
        effect_key: Option<&str>,
    ) -> Result<(), CoreError> {
        self.conn.execute(
            "INSERT OR IGNORE INTO sync_applied_items (item_id, action, effect_key) \
             VALUES (?1, ?2, ?3)",
            params![item_id, action, effect_key],
        )?;
        Ok(())
    }

    /// Record a remote application failure and advance its retry/dead-letter state.
    ///
    /// The payload is retained for operator inspection. Once `max_attempts`
    /// is reached, the item is quarantined and no longer eligible for page
    /// application until a future explicit operator requeue workflow is added.
    pub fn record_remote_failure(
        &self,
        item_id: &str,
        action: &str,
        payload: &str,
        error: &str,
        max_attempts: i64,
    ) -> Result<bool, CoreError> {
        let max_attempts = max_attempts.max(1);
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "INSERT INTO sync_remote_failures
                (item_id, action, payload, attempts, last_error, dead_lettered)
             VALUES (?1, ?2, ?3, 1, ?4, CASE WHEN 1 >= ?5 THEN 1 ELSE 0 END)
             ON CONFLICT(item_id) DO UPDATE SET
                action = excluded.action,
                payload = excluded.payload,
                attempts = sync_remote_failures.attempts + 1,
                last_error = excluded.last_error,
                last_failed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                dead_lettered = CASE
                    WHEN sync_remote_failures.attempts + 1 >= ?5 THEN 1
                    ELSE 0
                END",
            params![item_id, action, payload, error, max_attempts],
        )?;
        let dead_lettered: bool = tx.query_row(
            "SELECT dead_lettered FROM sync_remote_failures WHERE item_id = ?1",
            params![item_id],
            |row| row.get(0),
        )?;
        tx.commit()?;
        Ok(dead_lettered)
    }

    /// List retained remote application failures, newest failure first.
    pub fn list_remote_failures(&self) -> Result<Vec<RemoteSyncFailure>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT item_id, action, payload, attempts, last_error, dead_lettered
             FROM sync_remote_failures ORDER BY last_failed_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(RemoteSyncFailure {
                item_id: row.get(0)?,
                action: row.get(1)?,
                payload: row.get(2)?,
                attempts: row.get(3)?,
                last_error: row.get(4)?,
                dead_lettered: row.get::<_, i64>(5)? != 0,
            })
        })?;
        rows.map(|row| row.map_err(CoreError::from)).collect()
    }

    /// Return whether a remote item has been quarantined as a dead letter.
    pub fn is_remote_failure_dead_lettered(&self, item_id: &str) -> Result<bool, CoreError> {
        self.conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sync_remote_failures WHERE item_id = ?1 AND dead_lettered = 1)",
                params![item_id],
                |row| row.get(0),
            )
            .map_err(Into::into)
    }

    /// Count items in `sync_remote_failures` that are currently dead-lettered.
    ///
    /// Returns the `-1` sentinel on error; callers must not treat -1 as zero
    /// dead letters. The value is documented here rather than named, because no
    /// `PENDING_COUNT_UNKNOWN` constant exists in this crate — this line linked
    /// to one until 2026-10-08, which is a broken intra-doc link under
    /// `RUSTDOCFLAGS=-D warnings` (rustdoc reported "no item named").
    pub fn count_dead_lettered_remote_failures(&self) -> Result<i64, CoreError> {
        self.conn
            .query_row(
                "SELECT COUNT(*) FROM sync_remote_failures WHERE dead_lettered = 1",
                [],
                |row| row.get(0),
            )
            .map_err(Into::into)
    }

    /// Clear a resolved remote failure after its item is applied successfully.
    pub fn clear_remote_failure(&self, item_id: &str) -> Result<(), CoreError> {
        let tx = self.conn.unchecked_transaction()?;
        self.clear_remote_failure_in_tx(&tx, item_id)?;
        tx.commit()?;
        Ok(())
    }

    /// Clear a remote failure using a caller-owned transaction.
    pub fn clear_remote_failure_in_tx(
        &self,
        tx: &rusqlite::Transaction<'_>,
        item_id: &str,
    ) -> Result<(), CoreError> {
        tx.execute(
            "DELETE FROM sync_remote_failures WHERE item_id = ?1",
            params![item_id],
        )?;
        Ok(())
    }

    /// Requeue a dead-lettered remote item so the next sync cycle retries it.
    ///
    /// Operators call this after remediating the item's source (for example
    /// creating the missing product a remote sale referenced, or upgrading a
    /// client whose version rejected the payload). The quarantine row is
    /// deleted and the durable pull anchor (`sync_pull_state`) is rewound to
    /// a full re-pull, so the next daemon cycle re-fetches the item and
    /// retries it with a fresh attempt budget. The re-pull is safe because
    /// the `sync_applied_items` idempotency ledger skips every already-
    /// applied item — only the requeued (never-applied) item mutates.
    ///
    /// Returns [`CoreError::NotFound`] when the item is not currently
    /// dead-lettered (either never recorded or still retryable) — a mistyped
    /// id or a request to requeue an item that is already being retried must
    /// not be a silent no-op.
    pub fn requeue_remote_failure(&self, item_id: &str) -> Result<(), CoreError> {
        let tx = self.conn.unchecked_transaction()?;
        // The dead-letter predicate lives in the DELETE so the check and the
        // mutation are atomic — an id that is not currently quarantined
        // (never recorded, or still being retried) deletes nothing and fails
        // with NotFound instead of silently no-op'ing.
        let affected = tx.execute(
            "DELETE FROM sync_remote_failures WHERE item_id = ?1 AND dead_lettered = 1",
            params![item_id],
        )?;
        if affected == 0 {
            return Err(CoreError::NotFound {
                entity: "sync_remote_failures",
                id: item_id.to_owned(),
            });
        }
        // Rewind the durable pull anchor (single-row table). A NULL `since`
        // means "pull everything" on the next cycle — the idempotency
        // ledger makes that safe. No row (pre-114 database) is a no-op.
        tx.execute(
            "UPDATE sync_pull_state SET since = NULL, cursor = NULL WHERE id = 1",
            [],
        )?;
        tx.commit()?;
        Ok(())
    }

    /// Record a remote item using a caller-owned transaction.
    ///
    /// The sync applier uses this method in the same transaction as the
    /// domain mutation, preventing a crash between mutation and receipt from
    /// causing a second application on replay.
    ///
    /// Records no effect — delegates to
    /// [`Self::mark_remote_item_applied_with_effect_in_tx`] with `None`, so
    /// the delivery-only callers keep working unchanged.
    pub fn mark_remote_item_applied_in_tx(
        &self,
        tx: &rusqlite::Transaction<'_>,
        item_id: &str,
        action: &str,
    ) -> Result<(), CoreError> {
        self.mark_remote_item_applied_with_effect_in_tx(tx, item_id, action, None)
    }

    /// [`Self::mark_remote_item_applied_with_effect`] in a caller-owned
    /// transaction, so the receipt commits or rolls back with the mutation it
    /// describes. See that method for what `effect_key` means and why `None` is
    /// a real value rather than a missing one.
    pub fn mark_remote_item_applied_with_effect_in_tx(
        &self,
        tx: &rusqlite::Transaction<'_>,
        item_id: &str,
        action: &str,
        effect_key: Option<&str>,
    ) -> Result<(), CoreError> {
        tx.execute(
            "INSERT OR IGNORE INTO sync_applied_items (item_id, action, effect_key) \
             VALUES (?1, ?2, ?3)",
            params![item_id, action, effect_key],
        )?;
        Ok(())
    }
}
