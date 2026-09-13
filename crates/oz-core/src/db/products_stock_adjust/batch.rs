//! Pre-checked batch deductions and the legacy single-location wrapper
//! (part of the `products_stock_adjust` module).
//!
//! Key functions: `adjust_stock_batch` (ADR-19 §3: Phase 1 pre-checks
//! every deduction against current per-location stock, Phase 2 executes
//! each via the canonical adjust) and the deprecated
//! `adjust_stock_with_reason`, preserved verbatim per ADR-19 §3.4.
//!
//! Invariants: the pre-check avoids partial deductions; Phase 1 and
//! Phase 2 must read stock identically (both legacy-aware).

use super::*;

impl Store<'_> {
    /// Atomically deduct from multiple locations for one or more SKUs
    /// inside the caller's transaction (ADR-19 §3).
    ///
    /// All deductions happen inside the caller-provided `&Transaction` —
    /// no internal BEGIN/COMMIT. Used by the split-fulfillment flow (§6b)
    /// where one line item is deducted from 2+ locations simultaneously.
    ///
    /// 1. Pre-check every deduction against current stock at its location.
    ///    If ANY deduction would cause negative stock at its location, the
    ///    function returns [`CoreError::InsufficientStockAtLocation`] for
    ///    the **first** shortfall encountered (the caller should have
    ///    already validated all deductions before calling).
    /// 2. Execute all deductions — each is a single call to
    ///    [`adjust_stock_at_location_with_reason`](Self::adjust_stock_at_location_with_reason).
    ///
    /// The caller is responsible for `BEGIN IMMEDIATE` and COMMIT/ROLLBACK.
    pub fn adjust_stock_batch(
        &self,
        tx: &rusqlite::Transaction<'_>,
        deductions: &[crate::sale_deduction::StockDeduction],
        reason: Option<&str>,
        inventory_transaction_id: Option<&crate::inventory_transaction::InventoryTransactionId>,
        terminal_id: Option<&crate::terminal::TerminalId>,
        source_user_id: Option<&crate::user::UserId>,
    ) -> Result<(), CoreError> {
        if deductions.is_empty() {
            return Ok(());
        }

        // Phase 1: pre-check all deductions against current stock.
        for d in deductions {
            let product_id =
                self.product_id_by_sku(&d.sku)?
                    .ok_or_else(|| CoreError::NotFound {
                        entity: "product",
                        id: d.sku.clone(),
                    })?;

            // Distinguish QueryReturnedNoRows (no stock at this location → 0)
            // from real DB errors (corruption, lock → propagate).
            // Same legacy-aware read as the canonical adjust; Phase 1 and
            // Phase 2 must agree or the pre-check green-lights a deduction the
            // writer then refuses (or vice versa).
            let current_qty =
                self.legacy_aware_location_qty(tx, &product_id, d.location_id.as_str())?;

            let mut allow_negative = false;
            if let Some(t_id) = terminal_id
                && let Ok(ws_id) = tx.query_row(
                    "SELECT workspace_instance_id FROM terminals WHERE id = ?1",
                    rusqlite::params![t_id.as_str()],
                    |row| row.get::<_, String>(0),
                )
                && let Ok(allowed) = tx.query_row(
                    "SELECT COALESCE(allow_negative_stock, 0) FROM workspace_inventory_locations \
                         WHERE instance_id = ?1 AND location_id = ?2",
                    rusqlite::params![ws_id, d.location_id.as_str()],
                    |row| row.get::<_, i64>(0),
                )
            {
                allow_negative = allowed == 1;
            }

            if !allow_negative {
                let _new_qty = current_qty
                    .checked_add(d.delta)
                    .filter(|&v| v >= 0)
                    .ok_or_else(|| CoreError::InsufficientStockAtLocation {
                        sku: d.sku.clone(),
                        location_id: d.location_id.clone(),
                        requested_delta: d.delta,
                        available_qty: current_qty,
                    })?;
            }
        }

        // Phase 2: execute all deductions (all pre-checks passed).
        for d in deductions {
            self.adjust_stock_at_location_with_reason(
                tx,
                &d.sku,
                d.delta,
                &d.location_id,
                reason,
                inventory_transaction_id,
                terminal_id,
                source_user_id,
            )?;
        }

        Ok(())
    }

    /// Adjust stock with an explicit reason for the delta ledger (ADR #6).
    ///
    /// **ADR-19 §3.4** (deferred): this function is preserved verbatim from the
    /// pre-ADR-19 v0.0.10 baseline. The §3.4 demotion to a wrapper around
    /// [`adjust_stock_at_location_with_reason`](Self::adjust_stock_at_location_with_reason)
    /// is **deferred to v0.1.0** because the wrapper's contract (NULL
    /// location_id → canonical-default via column-DFT, single-PK inventory
    /// upsert) is depended on by 8+ downstream cargo tests across
    /// `db::products`, `db::purchase_orders`, `db::stock_transfers`, and
    /// `db::workspaces`. Routing it through the canonical fn during the
    /// v0.0.10 transition would require updating those tests + the
    /// production callsites in `app/*/commands/products.rs` +
    /// `modules/inventory/src/handlers.rs` — out of scope for Criterion
    /// 19-2 (which delivers the new canonical API surface, not the
    /// migration of existing callers).
    ///
    /// **Layer-1 stale-source note for §3.4 follow-up**: this wrapper reads
    /// `previous_qty` from the **legacy `inventory` table** via
    /// `self.get_stock(&product_id)`. The canonical §3.1 fn reads from
    /// `stock_summary` (post-ADR-18 §3 authoritative per-location surface).
    /// A future test or production flow that seeds ONLY `stock_summary`
    /// (not `inventory`) will pass the §3.1 path but fail this wrapper with
    /// phantom zero stock — a §3.4 migration foot-gun. The §3.4 follow-up
    /// should explicitly migrate Layer-1 reads to `stock_summary`.
    #[deprecated(note = "use adjust_stock_at_location_with_reason instead")]
    pub fn adjust_stock_with_reason(
        &self,
        sku: &str,
        delta: i64,
        reason: Option<&str>,
        source_terminal_id: Option<&str>,
        source_user_id: Option<&str>,
    ) -> Result<i64, CoreError> {
        let product_id = self
            .product_id_by_sku(sku)?
            .ok_or_else(|| CoreError::NotFound {
                entity: "product",
                id: sku.to_owned(),
            })?;

        let previous_qty = self.get_stock(&product_id)?;

        let new_qty = previous_qty
            .checked_add(delta)
            .filter(|&v| v >= 0)
            .ok_or_else(|| CoreError::Validation {
                field: "delta",
                message: format!(
                    "adjustment would cause negative stock (previous: {previous_qty}, delta: {delta})"
                ),
            })?;

        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let movement_id = uuid::Uuid::now_v7().to_string();

        let tx = self.conn.unchecked_transaction()?;

        // 1. Write the immutable delta row (CRDT ledger — ADR #6).
        tx.execute(
            "INSERT INTO stock_movements (id, item_id, delta, reason,
                                          source_terminal_id, source_user_id, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                movement_id,
                product_id,
                delta,
                reason,
                source_terminal_id,
                source_user_id,
                now
            ],
        )?;

        // 2. Update the materialised inventory table (backward compat).
        tx.execute(
            "INSERT INTO inventory (product_id, qty, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(product_id) DO UPDATE SET qty = excluded.qty,
                                                     updated_at = excluded.updated_at",
            params![product_id, new_qty, now],
        )?;

        // 3. Update the stock_summary materialised view (perf — ADR #6 + ADR-19 §3).
        // Uses the canonical default location UUID per ADR-18 §13-36 frozen seed.
        // The helper targets the composite PRIMARY KEY (item_id, location_id)
        // introduced by migration 089 — pre-refactor single-column
        // ON CONFLICT(item_id) raise "ON CONFLICT clause does not match any
        // PRIMARY KEY or UNIQUE constraint" and cascade-fail 46+ tests.
        upsert_stock_summary_in_tx(
            &tx,
            &product_id,
            crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID,
            new_qty,
            &now,
        )?;

        tx.commit()?;

        if let Some(cache) = &self.cache {
            cache.invalidate_inventory(&product_id);
            cache.publish_inventory_change(&product_id, sku, new_qty, self.terminal_id.as_deref());
        }

        Ok(new_qty)
    }
}
