//! Stock-movement reads and ledger retention (part of the
//! `products_stock_adjust` module).
//!
//! Key functions: `list_stock_movements` (the immutable delta ledger for
//! audit and sync) and `archive_stock_movements` (copy old rows to
//! `stock_movements_archive`, consolidate them into one `archive-rollup`
//! movement per product, delete them from the live table).
//!
//! Invariants: rollup rows are never re-archived; each item group is
//! processed in its own transaction; incremental vacuum runs once after
//! all groups.

use super::*;

impl Store<'_> {
    /// List all stock movement rows for a product, ordered by time (ADR #6).
    ///
    /// Returns the complete immutable delta ledger for audit and sync.
    pub fn list_stock_movements(
        &self,
        product_id: &str,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<StockMovement>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, item_id, delta, reason, source_terminal_id, source_user_id,
                    store_id, created_at
             FROM stock_movements
             WHERE item_id = ?1
             ORDER BY created_at DESC
             LIMIT ?2 OFFSET ?3",
        )?;
        let rows = stmt.query_map(params![product_id, limit, offset], |row| {
            Ok(StockMovement {
                id: row.get(0)?,
                item_id: row.get(1)?,
                delta: row.get(2)?,
                reason: row.get(3)?,
                source_terminal_id: row.get(4)?,
                source_user_id: row.get(5)?,
                store_id: row.get(6)?,
                created_at: row.get(7)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(CoreError::from)
    }

    /// Archive stock movements older than `older_than_days` days.
    ///
    /// Uses archive-rollup consolidation (ADR #6 Q4 / P-1 Ledger Retention):
    ///
    /// 1. Copies old rows to `stock_movements_archive` for audit compliance.
    /// 2. Inserts a single rollup row per product — `SUM(delta)` of all
    ///    archived rows, with `reason: 'archive-rollup'`.
    /// 3. Deletes old rows from the live table.
    ///
    /// Rollup rows are excluded from future archiving via `WHERE reason != 'archive-rollup'`.
    /// Each item_id group is processed in its own transaction so concurrent
    /// `adjust_stock` calls are never blocked for long.
    ///
    /// Capped at `max_groups` item_id groups per call to bound runtime
    /// (subsequent calls pick up remaining groups — idempotent).
    ///
    /// Returns the number of item groups that were archived.
    pub fn archive_stock_movements(
        &self,
        older_than_days: i64,
        max_groups: usize,
    ) -> Result<usize, CoreError> {
        // Compute the cutoff timestamp (now minus older_than_days).
        let cutoff = chrono::Utc::now() - chrono::Duration::days(older_than_days);
        let cutoff_str = cutoff.to_rfc3339_opts(chrono::SecondsFormat::Secs, true);

        // Find item_ids that have archivable rows (excluding rollup rows).
        let mut stmt = self.conn.prepare(
            "SELECT DISTINCT item_id
             FROM stock_movements
             WHERE created_at < ?1
               AND reason != 'archive-rollup'
             LIMIT ?2",
        )?;
        let item_ids: Vec<String> = stmt
            .query_map(params![cutoff_str, max_groups as i64], |row| row.get(0))?
            .collect::<Result<Vec<_>, _>>()?;

        if item_ids.is_empty() {
            return Ok(0);
        }

        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let mut groups_archived = 0usize;

        for item_id in &item_ids {
            let tx = self.conn.unchecked_transaction()?;

            // 1. Copy old rows to archive (skip previous rollup rows). Post
            //    ADR-18 §2b + migration 080 stock_movements_archive gained
            //    a `location_id` column (NOT NULL DEFAULT canonical UUID);
            //    post ADR-18 §9c + migration 085 it also gained a nullable
            //    `inventory_transaction_id` FK column. The select-list below
            //    must enumerate ALL 10 columns in the same order as the
            //    CREATE TABLE from migration 072 + ALTERs from 080/085,
            //    otherwise SQLite rejects with "X columns but Y values
            //    were supplied" and the archive transaction rolls back.
            tx.execute(
                "INSERT INTO stock_movements_archive
                 SELECT id, item_id, delta, reason,
                        source_terminal_id, source_user_id,
                        store_id, created_at,
                        location_id, inventory_transaction_id
                 FROM stock_movements
                 WHERE item_id = ?1
                   AND created_at < ?2
                   AND reason != 'archive-rollup'",
                params![item_id, cutoff_str],
            )?;

            // 2. Insert a rollup row consolidating all archived deltas.
            //    Post migration 080 location_id is NOT NULL DEFAULT canonical
            //    UUID on stock_movements, so we anchor the rollup to the
            //    canonical default explicitly (the COALESCE would otherwise
            //    surface a NULL on pre-080 stock_movements rows). Post
            //    migration 085 inventory_transaction_id is NULLABLE; the
            //    rollup row has no original inventory_transaction session
            //    because it consolidates multiple sessions — NULL is correct.
            let rollup_id = uuid::Uuid::now_v7().to_string();
            tx.execute(
                "INSERT INTO stock_movements
                     (id, item_id, delta, reason, store_id, created_at,
                      location_id, inventory_transaction_id)
                 SELECT ?1, ?2, COALESCE(SUM(delta), 0), 'archive-rollup',
                        '', ?3,
                        '01926b3a-0000-7000-8000-000000000001', NULL
                 FROM stock_movements
                 WHERE item_id = ?2
                   AND created_at < ?4
                   AND reason != 'archive-rollup'",
                params![rollup_id, item_id, now, cutoff_str],
            )?;

            // 3. Delete old rows from the live table.
            tx.execute(
                "DELETE FROM stock_movements
                 WHERE item_id = ?1
                   AND created_at < ?2
                   AND reason != 'archive-rollup'",
                params![item_id, cutoff_str],
            )?;

            tx.commit()?;
            groups_archived += 1;
        }

        // Run incremental vacuum once after all groups to reclaim disk space.
        self.conn
            .execute_batch("PRAGMA incremental_vacuum(50)")
            .map_err(|e| CoreError::Internal(format!("incremental_vacuum failed: {e}")))?;

        Ok(groups_archived)
    }
}
