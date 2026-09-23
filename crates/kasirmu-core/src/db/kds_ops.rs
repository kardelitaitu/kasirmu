//! KDS operational helpers - acknowledgment, replay, cleanup, health.
//!
//! Key functions: ack_kds_order (device accepted a ticket),
//! replay_kds_orders_since (offline catch-up),
//! cleanup_old_kds_orders (retention), mark_stale_kds_devices and
//! deactivate_stale_kds_devices (health monitoring with logging).
//!
//! Invariants: replay/cleanup are timestamp-scoped and store-safe;
//! stale devices are auto-deactivated with a logged reason.

use crate::KdsOrder;
use crate::db::Store;
use crate::error::CoreError;
use rusqlite::params;

// ── Order Acknowledgment ─────────────────────────────────────────

impl Store<'_> {
    /// Acknowledge a KDS order — the device accepted the ticket and started
    /// prep, so the order advances pending → preparing. Uses an
    /// `UPDATE WHERE status = 'pending'` pattern for optimistic locking:
    /// only one device can win the race. Returns `Ok(true)` on success,
    /// `Ok(false)` if another device already acknowledged it.
    pub fn ack_kds_order(&self, order_id: &str, device_id: &str) -> Result<bool, CoreError> {
        let now = chrono::Utc::now()
            .format("%Y-%m-%dT%H:%M:%S%.3fZ")
            .to_string();
        let affected = self.conn.execute(
            "UPDATE kds_orders SET status = 'preparing', started_at = ?1,
             acked_by_device = ?2, acked_at = ?1
             WHERE id = ?3 AND status = 'pending'",
            params![now, device_id, order_id],
        )?;
        Ok(affected > 0)
    }
}

// ── KDS Event Replay & Cleanup ──────────────────────────────────

impl Store<'_> {
    /// Replay KDS orders created or updated since a given ISO-8601 timestamp.
    ///
    /// Used by KDS devices on reconnection to catch up with missed events.
    /// Returns orders whose `received_at` is strictly after `since`, ordered
    /// by `received_at ASC` (oldest first, so the device processes them
    /// in the correct sequence).
    pub fn replay_kds_orders_since(
        &self,
        since: &str,
        status_filter: Option<&str>,
    ) -> Result<Vec<KdsOrder>, CoreError> {
        let mut sql = String::from(
            "SELECT id, sale_id, store_id, target_instance_id, status, items_summary, item_count, display_number,
                    received_at, started_at, ready_at, served_at,
                    prep_time_seconds, kitchen_zone, notes, table_number, priority, ticket_prefix
             FROM kds_orders WHERE received_at > ?1",
        );
        let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(since.to_owned())];
        if let Some(s) = status_filter {
            sql.push_str(" AND status = ?2");
            params.push(Box::new(s.to_owned()));
        }
        sql.push_str(" ORDER BY received_at ASC");

        let mut stmt = self.conn.prepare(&sql)?;
        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            params.iter().map(|p| p.as_ref()).collect();
        let rows = stmt.query_map(param_refs.as_slice(), Self::row_to_kds_order)?;
        rows.map(|r| Ok(r?)).collect()
    }

    /// Prune KDS orders older than the given number of days.
    ///
    /// Returns the number of orders deleted. Used by the daily cleanup
    /// daemon to prevent unbounded event log growth (plan §4.0).
    /// Only prunes orders in terminal states (ready, served, cancelled).
    /// # Transaction behaviour (C18 P3)
    ///
    /// The three DELETEs are FK-ordered (line items and targets before the
    /// orders they hang off), which is a real sequence invariant, not three
    /// independent statements: a failure between them leaves a pruned parent
    /// with orphaned children, or — worse — the parent rows gone while a
    /// child table still references them, which the FK then refuses to let a
    /// later prune fix. Own-or-join, the `stock_counts.rs` idiom.
    pub fn cleanup_old_kds_orders(&self, retention_days: i64) -> Result<usize, CoreError> {
        let owned = self.conn.is_autocommit();
        let tx = if owned {
            Some(self.conn.unchecked_transaction()?)
        } else {
            None
        };
        let cutoff = (chrono::Utc::now() - chrono::Duration::days(retention_days))
            .format("%Y-%m-%dT%H:%M:%S%.3fZ")
            .to_string();

        // Delete line items first (FK constraint).
        let deleted_items = self.conn.execute(
            "DELETE FROM kds_line_items WHERE kds_order_id IN (
                SELECT id FROM kds_orders WHERE received_at < ?1
                AND status IN ('ready', 'served', 'cancelled')
            )",
            params![cutoff],
        )?;

        // Delete order targets.
        let deleted_targets = self.conn.execute(
            "DELETE FROM kds_order_targets WHERE kds_order_id IN (
                SELECT id FROM kds_orders WHERE received_at < ?1
                AND status IN ('ready', 'served', 'cancelled')
            )",
            params![cutoff],
        )?;

        // Delete orders.
        let deleted_orders = self.conn.execute(
            "DELETE FROM kds_orders WHERE received_at < ?1
             AND status IN ('ready', 'served', 'cancelled')",
            params![cutoff],
        )?;

        if let Some(tx) = tx {
            tx.commit()?;
        }

        if deleted_orders > 0 {
            tracing::info!(
                orders = deleted_orders,
                line_items = deleted_items,
                targets = deleted_targets,
                retention_days,
                "KDS event log cleanup completed"
            );
        }

        let _ = owned;
        Ok(deleted_orders)
    }
}

// ── KDS Device Health Monitoring ────────────────────────────────

impl Store<'_> {
    /// Mark connected devices as stale if they haven't communicated recently.
    ///
    /// A device is considered stale if `last_seen_at` is older than
    /// `stale_threshold_secs` seconds ago. Called periodically by the
    /// health monitoring daemon (plan §4.0).
    ///
    /// Returns the number of devices transitioned to stale.
    pub fn mark_stale_kds_devices(&self, stale_threshold_secs: i64) -> Result<usize, CoreError> {
        let cutoff = (chrono::Utc::now() - chrono::Duration::seconds(stale_threshold_secs))
            .format("%Y-%m-%dT%H:%M:%S%.3fZ")
            .to_string();

        let affected = self.conn.execute(
            "UPDATE kds_devices
             SET connection_status = 'stale', updated_at = ?1
             WHERE connection_status = 'connected'
               AND last_seen_at IS NOT NULL
               AND last_seen_at < ?2",
            params![cutoff, cutoff],
        )?;

        if affected > 0 {
            tracing::info!(count = affected, "KDS devices marked stale");
        }

        Ok(affected)
    }

    /// Deactivate devices that have been stale for too long.
    ///
    /// A device is deactivated if `connection_status = 'stale'` and
    /// `updated_at` is older than `max_stale_duration_secs` seconds ago.
    /// This prevents permanently-offline devices from accumulating.
    ///
    /// Returns the number of devices deactivated.
    pub fn deactivate_stale_kds_devices(
        &self,
        max_stale_duration_secs: i64,
    ) -> Result<usize, CoreError> {
        let cutoff = (chrono::Utc::now() - chrono::Duration::seconds(max_stale_duration_secs))
            .format("%Y-%m-%dT%H:%M:%S%.3fZ")
            .to_string();

        let affected = self.conn.execute(
            "UPDATE kds_devices
             SET is_active = 0, updated_at = ?1
             WHERE connection_status = 'stale'
               AND updated_at < ?2",
            params![cutoff, cutoff],
        )?;

        if affected > 0 {
            tracing::info!(
                count = affected,
                "KDS devices auto-deactivated after prolonged stale period"
            );
        }

        Ok(affected)
    }
}
