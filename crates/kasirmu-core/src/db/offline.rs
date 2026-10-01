//! Offline Queue — enqueue, list, mark, delete offline sync items.
/*
last audited 25-07-26 by RSA-Agent (kasirmu-core slice B5: offline queue deep read)
crate: kasirmu-core | status: SAFE | lint: CLEAN
findings: sync plumbing production-grade — tenant-scoped variants throughout (SYNC-07: cross-tenant reads as NotFound/no-op), sync_applied_items idempotency ledger (INSERT OR IGNORE + in-tx variant co-located with the domain mutation), durable pull anchor with crash-safe write-after-apply ordering, atomic dead-letter requeue (predicate inside the DELETE) with anchor rewind; COR-20 CLOSED 2026-09-06: the dedup EXISTS check and the observability summary still degrade to their benign defaults (duplicate enqueue is replay-safe; dashboards show zeros), but every degradation now logs op + underlying error via log_degraded, and query_or_none separates the normal QueryReturnedNoRows empty case from real DB errors that .ok() previously conflated
next: none | perf: status summary is 4 small queries, fine at desktop scale
*/

use rusqlite::params;
use serde::{Deserialize, Serialize};

use crate::error::CoreError;
use crate::offline::{OfflineQueueItem, OfflineQueueStatus};
// `offline_tests.rs` reaches `SyncPriority` through `use super::*`; the production
// enqueue code that uses it lives in `db::offline::enqueue`, which imports it
// directly, so an unconditional import here would be unused in the lib build.
#[cfg(test)]
use crate::offline::SyncPriority;

use super::Store;

/// COR-20: a degraded observability query must be visible in the log.
///
/// The defaults chosen on DB error are deliberately benign — the dedup
/// EXISTS check falls through to a normal enqueue (duplicate enqueues are
/// replay-safe via the server's idempotency ledger), and the status summary
/// reports zeros/None so dashboards degrade instead of failing. But a queue
/// that silently reads "0 failed" because its database is unhealthy is
/// exactly the hidden failure state the Phase 2 offline-sync spec forbids.
/// Every degradation logs the operation name and the underlying error so
/// the cause is discoverable without changing the benign behavior.
pub(super) fn log_degraded(operation: &str, err: &rusqlite::Error) {
    tracing::warn!(
        op = operation,
        error = %err,
        "offline_queue query degraded to default (COR-20)"
    );
}

/// The identity this install stamps on the rows it produces (C3, slice S5a).
///
/// Read ONCE per enqueue call — never per row — from the same persisted
/// `sync_terminal_id` the sync daemons read to stamp their pushes. An
/// unpaired install has no id and the row keeps SQL NULL, which is the
/// migration's explicit contract: a guessed origin would make the
/// self-origin gate suppress a legitimate deduction (silent stock loss).
///
/// A read ERROR propagates instead of degrading to `None`. A NULL written
/// because the lookup failed is indistinguishable from a genuine "unpaired",
/// and it would silently reopen the double deduction this stamp exists to
/// close — the failure must be visible, not benign.
pub(super) fn enqueue_origin(conn: &rusqlite::Connection) -> Result<Option<String>, CoreError> {
    crate::settings::Settings::get_sync_terminal_id(conn)
}

/// Decode a currency's raw bytes for a sync payload.
///
/// The outbox payload is JSON the pull side parses, so a non-UTF-8 currency
/// must be a hard error here (the same rejection `create_refund` performs
/// before it writes the row) rather than a payload the applier dead-letters
/// after the refund has already committed locally.
pub(super) fn currency_str<'a>(
    currency: &'a crate::money::Currency,
    field: &'static str,
) -> Result<&'a str, CoreError> {
    std::str::from_utf8(&currency.0).map_err(|e| CoreError::Validation {
        field,
        message: format!("invalid UTF-8 in currency bytes: {e}"),
    })
}

/// Run a single-row observability query whose "no rows" answer is normal.
///
/// `Ok` → value; `QueryReturnedNoRows` → `None` silently (an empty queue is the
/// expected common case, not an error); any other DB error → `None` logged
/// via [`log_degraded`]. This separates the conflation `.ok()` performed.
fn query_or_none(operation: &str, result: Result<String, rusqlite::Error>) -> Option<String> {
    match result {
        Ok(v) => Some(v),
        Err(rusqlite::Error::QueryReturnedNoRows) => None,
        Err(e) => {
            log_degraded(operation, &e);
            None
        }
    }
}

/// Summary of offline queue status — counts by status and sync timing.
/// Used by P1-6 sync observability dashboard widgets.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncStatusSummary {
    /// Number of pending (unsynced) items.
    pub pending_count: i64,
    /// Number of successfully synced items.
    pub synced_count: i64,
    /// Number of failed items.
    pub failed_count: i64,
    /// Total retry count across all failed items.
    pub total_retry_count: i64,
    /// ISO-8601 timestamp of the most recently synced item, if any.
    pub last_synced_at: Option<String>,
    /// ISO-8601 timestamp of the oldest pending item, if any.
    pub oldest_pending_at: Option<String>,
    /// Number of items resolved via conflict during the last sync cycle.
    /// (P1-3: items whose last_error starts with "resolved: conflict").
    pub conflict_count: i64,
}

/// Durable pull anchor/cursor for the background sync daemon (SYNC-01).
///
/// Persisted in the single-row `sync_pull_state` table so the daemon only
/// fetches remote updates newer than the last successfully-applied page
/// (plus the opaque pagination cursor for the next page, P-3).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SyncPullState {
    /// ISO-8601 anchor timestamp of the last successfully applied page.
    pub since: Option<String>,
    /// Opaque pagination cursor for the next page (P-3). `None` when the
    /// previous page was the final one.
    pub cursor: Option<String>,
}

/// A retained failure from applying a remote sync item.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RemoteSyncFailure {
    /// Remote item identifier.
    pub item_id: String,
    /// Remote action name.
    pub action: String,
    /// Original payload retained for operator inspection.
    pub payload: String,
    /// Number of failed application attempts.
    pub attempts: i64,
    /// Most recent application error.
    pub last_error: String,
    /// Whether retry is exhausted and the item is quarantined.
    pub dead_lettered: bool,
}

pub mod enqueue;
pub mod remote;

impl Store<'_> {
    /// List all pending (unsynced) offline queue items, oldest first.
    pub fn list_pending_offline(&self) -> Result<Vec<OfflineQueueItem>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, action, payload, status, retry_count, last_error, created_at, synced_at, tenant_id, priority, origin_terminal_id
             FROM offline_queue WHERE status = 'pending' ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map([], Self::row_to_offline_queue_item)?;
        rows.map(|r| Ok(r?)).collect()
    }

    /// List all offline queue items.
    pub fn list_all_offline(&self) -> Result<Vec<OfflineQueueItem>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, action, payload, status, retry_count, last_error, created_at, synced_at, tenant_id, priority, origin_terminal_id
             FROM offline_queue ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map([], Self::row_to_offline_queue_item)?;
        rows.map(|r| Ok(r?)).collect()
    }

    /// List pending offline items scoped to a tenant.
    pub fn list_pending_offline_for_tenant(
        &self,
        tenant_id: &str,
    ) -> Result<Vec<OfflineQueueItem>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, action, payload, status, retry_count, last_error, created_at, synced_at, tenant_id, priority, origin_terminal_id
             FROM offline_queue WHERE status = 'pending' AND tenant_id = ?1 ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map(params![tenant_id], Self::row_to_offline_queue_item)?;
        rows.map(|r| Ok(r?)).collect()
    }

    /// Mark an offline queue item as synced.
    ///
    /// The transition is a guarded compare-and-set, not a blind write: the row
    /// must still be `pending` for the update to land, so a stale or double
    /// caller can neither re-mark an already-synced item nor — the case that
    /// loses data — overwrite a dead-lettered (`failed`) row's terminal state
    /// with `synced`. Same conditional-transition shape as `finalize_sale`
    /// (`WHERE id = ?2 AND status = 'pending'`).
    ///
    /// # Transaction behaviour
    ///
    /// SQLite has no nested `BEGIN`, so — exactly like [`Store::log_audit`] —
    /// this JOINS a caller-owned transaction and only opens its own in
    /// autocommit. A caller that rolls back therefore leaves the row un-marked;
    /// a caller with no transaction gets one, so the existence probe and the
    /// write that depends on it are atomic.
    ///
    /// # Errors
    ///
    /// [`CoreError::NotFound`] when the id does not exist. An id that exists in
    /// a non-pending state is an idempotent no-op returning `Ok(())` — duplicate
    /// id replays and daemon retries must not fail, and
    /// `mark_offline_synced_is_idempotent` pins that contract.
    pub fn mark_offline_synced(&self, id: &str) -> Result<(), CoreError> {
        if self.conn.is_autocommit() {
            let tx = self.conn.unchecked_transaction()?;
            Self::mark_synced_on(&tx, id)?;
            tx.commit()?;
            Ok(())
        } else {
            Self::mark_synced_on(self.conn, id)
        }
    }

    /// The guarded `pending -> synced` write, on a connection or on a
    /// caller-owned transaction (`Transaction` derefs to `Connection`).
    ///
    /// A row that exists but is not `pending` is not an error: the CAS
    /// correctly changed nothing, and the caller gets `Ok(())`.
    fn mark_synced_on(conn: &rusqlite::Connection, id: &str) -> Result<(), CoreError> {
        let affected = conn.execute(
            "UPDATE offline_queue SET status = 'synced', synced_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?1 AND status = 'pending'",
            params![id],
        )?;
        if affected == 1 {
            return Ok(());
        }
        // rows == 0: the id is absent, or it is present in a non-pending state.
        // Only the first is an error; the second is the no-op the CAS exists to
        // produce. Probe instead of guessing which one happened.
        let exists: i64 = conn.query_row(
            "SELECT COUNT(*) FROM offline_queue WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )?;
        if exists == 0 {
            return Err(CoreError::NotFound {
                entity: "offline_queue",
                id: id.to_owned(),
            });
        }
        Ok(())
    }

    /// Mark an offline queue item as synced, scoped to a tenant (SYNC-07).
    ///
    /// Returns [`CoreError::NotFound`] when the id does not exist **or**
    /// belongs to a different tenant — a cross-tenant mutation is treated
    /// exactly like a missing item so the client queue boundary is safe by
    /// construction even in a multi-tenant process.
    ///
    /// The `status = 'pending'` half of the predicate is not optional and is the
    /// whole reason this matches [`Self::mark_offline_synced`]: without it a
    /// tenant-scoped caller resurrected a dead-lettered row, writing
    /// `status = 'synced'` and an invented `synced_at` over a row whose
    /// `retry_count` and `last_error` still recorded the failure — an
    /// internally contradictory row, and one the queue-status summary
    /// (`SUM(retry_count) WHERE status = 'failed'`) silently stops counting.
    /// A row that exists but is NOT pending is the idempotent no-op the CAS is
    /// built to produce, so it returns `Ok(())` rather than erroring.
    /// # Transaction behaviour (C19 slice B)
    ///
    /// Joins a caller-owned transaction and opens its own only in autocommit,
    /// matching [`Self::mark_offline_synced`]: the write and the existence probe
    /// below must be atomic, or a concurrent delete landing between them makes
    /// the probe answer with a state the write never saw.
    pub fn mark_offline_synced_for_tenant(
        &self,
        id: &str,
        tenant_id: &str,
    ) -> Result<(), CoreError> {
        if self.conn.is_autocommit() {
            let tx = self.conn.unchecked_transaction()?;
            Self::mark_synced_for_tenant_on(&tx, id, tenant_id)?;
            tx.commit()?;
            Ok(())
        } else {
            Self::mark_synced_for_tenant_on(self.conn, id, tenant_id)
        }
    }

    /// The guarded tenant-scoped write, on a connection or a caller-owned
    /// transaction (`Transaction` derefs to `Connection`).
    fn mark_synced_for_tenant_on(
        conn: &rusqlite::Connection,
        id: &str,
        tenant_id: &str,
    ) -> Result<(), CoreError> {
        let affected = conn.execute(
            "UPDATE offline_queue SET status = 'synced', synced_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?1 AND tenant_id = ?2 AND status = 'pending'",
            params![id, tenant_id],
        )?;
        if affected == 1 {
            return Ok(());
        }
        // rows == 0: one of three cases, and only one is an error. The row is
        // absent, it belongs to another tenant, or it is present in a
        // non-pending state. Only the FIRST is NotFound — the same
        // "probe instead of guessing which one happened" shape
        // [`Self::mark_synced_on`] uses, narrowed to the tenant.
        let exists: i64 = conn.query_row(
            "SELECT COUNT(*) FROM offline_queue WHERE id = ?1 AND tenant_id = ?2",
            params![id, tenant_id],
            |row| row.get(0),
        )?;
        if exists == 0 {
            return Err(CoreError::NotFound {
                entity: "offline_queue",
                id: id.to_owned(),
            });
        }
        // Present and ours, but not pending: the CAS correctly changed
        // nothing, which is the no-op it exists to produce.
        Ok(())
    }

    /// Mark an offline queue item as resolved via conflict (P1-3).
    ///
    /// Sets status to 'synced' and records the resolution type in
    /// `last_error` so the status summary can count conflict resolutions.
    ///
    /// # Guarded transition (C19 slice B)
    ///
    /// This is the THIRD sibling of the compare-and-set shape
    /// ([`Self::mark_offline_synced`], [`Self::mark_offline_synced_for_tenant`])
    /// and the last one to gain the guard. Its predicate was a bare
    /// `WHERE id = ?1`, so a stale or double caller flipped a dead-lettered
    /// (`failed`) row to `synced` and invented a `synced_at` over a row whose
    /// `retry_count` and `last_error` still recorded the failure — an
    /// internally contradictory row, and one the queue-status summary
    /// (`SUM(retry_count) WHERE status = 'failed'`) silently stops counting.
    ///
    /// A row that exists but is NOT pending is the idempotent no-op the CAS
    /// produces, so it returns `Ok(())` rather than erroring — matching the
    /// sibling's contract, which `mark_offline_synced_is_idempotent` pins.
    ///
    /// # Transaction behaviour
    ///
    /// Joins a caller-owned transaction and opens its own only in autocommit,
    /// exactly like [`Self::mark_offline_synced`]: SQLite has no nested
    /// `BEGIN`, and the existence probe must be atomic with the write it
    /// decides on, or a concurrent delete between them answers with a state
    /// that never existed.
    pub fn mark_offline_resolved(&self, id: &str, resolution: &str) -> Result<(), CoreError> {
        if self.conn.is_autocommit() {
            let tx = self.conn.unchecked_transaction()?;
            Self::mark_resolved_on(&tx, id, resolution)?;
            tx.commit()?;
            Ok(())
        } else {
            Self::mark_resolved_on(self.conn, id, resolution)
        }
    }

    /// The guarded resolution write, on a connection or a caller-owned
    /// transaction (`Transaction` derefs to `Connection`).
    ///
    /// A row that exists but is not `pending` is not an error: the CAS
    /// correctly changed nothing and the caller gets `Ok(())`.
    fn mark_resolved_on(
        conn: &rusqlite::Connection,
        id: &str,
        resolution: &str,
    ) -> Result<(), CoreError> {
        let marker = format!("resolved: conflict ({resolution})");
        let affected = conn.execute(
            "UPDATE offline_queue SET status = 'synced', synced_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), last_error = ?1
             WHERE id = ?2 AND status = 'pending'",
            params![marker, id],
        )?;
        if affected == 1 {
            return Ok(());
        }
        // rows == 0: the id is absent, or it is present in a non-pending state.
        // Only the first is an error; the second is the no-op the CAS exists to
        // produce. Probe instead of guessing which one happened.
        let exists: i64 = conn.query_row(
            "SELECT COUNT(*) FROM offline_queue WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )?;
        if exists == 0 {
            return Err(CoreError::NotFound {
                entity: "offline_queue",
                id: id.to_owned(),
            });
        }
        Ok(())
    }

    /// Mark an offline queue item as failed with an error message.
    pub fn mark_offline_failed(&self, id: &str, error: &str) -> Result<(), CoreError> {
        self.conn.execute(
            "UPDATE offline_queue SET status = 'failed', last_error = ?1, retry_count = retry_count + 1 WHERE id = ?2",
            params![error, id],
        )?;
        Ok(())
    }

    /// Mark an offline queue item as failed, scoped to a tenant (SYNC-07).
    ///
    /// A cross-tenant id is a no-op (`Ok(())`), matching the unscoped
    /// variant's lenient semantics but never mutating another tenant's row.
    pub fn mark_offline_failed_for_tenant(
        &self,
        id: &str,
        tenant_id: &str,
        error: &str,
    ) -> Result<(), CoreError> {
        self.conn.execute(
            "UPDATE offline_queue SET status = 'failed', last_error = ?1, retry_count = retry_count + 1
             WHERE id = ?2 AND tenant_id = ?3",
            params![error, id, tenant_id],
        )?;
        Ok(())
    }

    /// Get the count of pending offline items.
    pub fn pending_offline_count(&self) -> Result<i64, CoreError> {
        self.conn
            .query_row(
                "SELECT COUNT(*) FROM offline_queue WHERE status = 'pending'",
                [],
                |row| row.get(0),
            )
            .map_err(Into::into)
    }

    /// Get the count of pending offline items scoped to a tenant (SYNC-07).
    pub fn pending_offline_count_for_tenant(&self, tenant_id: &str) -> Result<i64, CoreError> {
        self.conn
            .query_row(
                "SELECT COUNT(*) FROM offline_queue WHERE status = 'pending' AND tenant_id = ?1",
                params![tenant_id],
                |row| row.get(0),
            )
            .map_err(Into::into)
    }

    /// Delete a processed offline queue item.
    pub fn delete_offline_item(&self, id: &str) -> Result<(), CoreError> {
        self.conn
            .execute("DELETE FROM offline_queue WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Delete an offline queue item, scoped to a tenant (SYNC-07).
    ///
    /// A cross-tenant id is a no-op — the row (if any) is left untouched.
    pub fn delete_offline_item_for_tenant(
        &self,
        id: &str,
        tenant_id: &str,
    ) -> Result<(), CoreError> {
        self.conn.execute(
            "DELETE FROM offline_queue WHERE id = ?1 AND tenant_id = ?2",
            params![id, tenant_id],
        )?;
        Ok(())
    }

    /// Get a summary of the offline queue status (P1-6 sync observability).
    ///
    /// Returns counts by status, total retry count, last sync timestamp,
    /// and oldest pending timestamp — all in a single query.
    pub fn offline_queue_status_summary(&self) -> Result<SyncStatusSummary, CoreError> {
        // Status counts
        let counts: Vec<(String, i64)> = self
            .conn
            .prepare("SELECT status, COUNT(*) FROM offline_queue GROUP BY status")?
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })?
            .filter_map(|r| match r {
                Ok(v) => Some(v),
                // COR-20: a row that fails to read must not silently vanish
                // from the counts the dashboard renders.
                Err(e) => {
                    log_degraded("offline_queue_status_summary.counts_row", &e);
                    None
                }
            })
            .collect();

        let mut pending_count: i64 = 0;
        let mut synced_count: i64 = 0;
        let mut failed_count: i64 = 0;
        for (status, count) in &counts {
            match status.as_str() {
                "pending" => pending_count = *count,
                "synced" => synced_count = *count,
                "failed" => failed_count = *count,
                _ => {}
            }
        }

        // Total retry count across all failed items
        let total_retry_count: i64 = match self.conn.query_row(
            "SELECT COALESCE(SUM(retry_count), 0) FROM offline_queue WHERE status = 'failed'",
            [],
            |row| row.get(0),
        ) {
            Ok(v) => v,
            Err(e) => {
                log_degraded("offline_queue_status_summary.total_retry_count", &e);
                0
            }
        };

        // Last synced at (most recent synced_at timestamp)
        let last_synced_at: Option<String> = query_or_none(
            "offline_queue_status_summary.last_synced_at",
            self.conn.query_row(
                "SELECT synced_at FROM offline_queue WHERE status = 'synced' AND synced_at IS NOT NULL ORDER BY synced_at DESC LIMIT 1",
                [],
                |row| row.get(0),
            ),
        );

        // Oldest pending at (earliest created_at among pending items)
        let oldest_pending_at: Option<String> = query_or_none(
            "offline_queue_status_summary.oldest_pending_at",
            self.conn.query_row(
                "SELECT created_at FROM offline_queue WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1",
                [],
                |row| row.get(0),
            ),
        );

        // P1-3: Count items resolved via conflict (last_error starts with "resolved: conflict")
        let conflict_count: i64 = match self.conn.query_row(
            "SELECT COUNT(*) FROM offline_queue WHERE last_error LIKE 'resolved: conflict%'",
            [],
            |row| row.get(0),
        ) {
            Ok(v) => v,
            Err(e) => {
                log_degraded("offline_queue_status_summary.conflict_count", &e);
                0
            }
        };

        Ok(SyncStatusSummary {
            pending_count,
            synced_count,
            failed_count,
            total_retry_count,
            last_synced_at,
            oldest_pending_at,
            conflict_count,
        })
    }

    /// Read the persisted sync pull anchor and cursor (SYNC-01).
    ///
    /// Returns the `since` timestamp and `cursor` from the last
    /// successfully-applied page. Both are `None` on first sync (pull
    /// everything). A missing row (pre-114 database) defaults to `None`.
    pub fn get_sync_pull_state(&self) -> Result<SyncPullState, CoreError> {
        use rusqlite::OptionalExtension;
        self.conn
            .query_row(
                "SELECT since, cursor FROM sync_pull_state WHERE id = 1",
                [],
                |row| {
                    Ok(SyncPullState {
                        since: row.get(0)?,
                        cursor: row.get(1)?,
                    })
                },
            )
            .optional()
            .map(std::option::Option::unwrap_or_default)
            .map_err(Into::into)
    }

    /// Persist the sync pull anchor and cursor (SYNC-01).
    ///
    /// Called only AFTER a page of remote items was applied successfully,
    /// so a crash mid-pull replays safely — the idempotency ledger then
    /// skips any already-applied items.
    pub fn set_sync_pull_state(
        &self,
        since: Option<&str>,
        cursor: Option<&str>,
    ) -> Result<(), CoreError> {
        self.conn.execute(
            "INSERT INTO sync_pull_state (id, since, cursor) VALUES (1, ?1, ?2)
             ON CONFLICT(id) DO UPDATE SET since = excluded.since, cursor = excluded.cursor",
            params![since, cursor],
        )?;
        Ok(())
    }

    fn row_to_offline_queue_item(row: &rusqlite::Row) -> rusqlite::Result<OfflineQueueItem> {
        let status_str: String = row.get("status")?;
        Ok(OfflineQueueItem {
            id: row.get("id")?,
            action: row.get("action")?,
            payload: row.get("payload")?,
            status: OfflineQueueStatus::from_stored_str(&status_str)
                .unwrap_or(OfflineQueueStatus::Pending),
            retry_count: row.get("retry_count")?,
            last_error: row.get("last_error")?,
            created_at: row.get("created_at")?,
            synced_at: row.get("synced_at")?,
            tenant_id: row.get("tenant_id")?,
            priority: row.get::<_, i32>("priority").map_or(
                crate::offline::SyncPriority::Normal,
                crate::offline::SyncPriority::from,
            ),
            // NULL stays NULL: "unknown origin", never a default.
            origin_terminal_id: row.get("origin_terminal_id")?,
        })
    }
}

// ── Tests ─────────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "offline_tests.rs"]
mod tests;
