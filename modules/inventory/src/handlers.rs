/*
last audited 25-07-26 by RSA-Agent (modules-inventory slice A: handlers deep read)
crate: modules-inventory | status: SAFE | lint: CLEAN
findings: MSL-3 — InventoryStockHandler deduction is tx-safe (error path drops tx, rollback) and BOM-aware. Pattern (2) FIXED in 0ae9a43bb 'fix(inventory): refuse a sale whose recipe row cannot be read' — the old `ings.flatten()` dropped row-level FromSql errors, so an empty list made the code take the simple-product arm and deduct the COMPOSITE while leaving ingredients untouched; every row must now decode (`ingredients.push(i?)`), so an unreadable recipe row refuses the sale and rolls the deduction back. Pinned by an_undecodable_recipe_row_refuses_the_sale_rather_than_mis_deducting (modules/inventory/src/handlers_tests.rs:39). Pattern (1) is DELIBERATE and verified, not pending: the stock_summary writes stay .ok()-swallowed best-effort because stock_summary is a derived cache rebuilt from the movement ledger (rebuild_stock_summary) by the sync daemon (platform/sync/src/daemon_tick.rs, pg_daemon.rs); the authoritative deduction is fail-closed via `UPDATE inventory ... RETURNING qty` + the new_qty>=0 check. UPDATE-RETURNING no-row maps to insufficient-stock error (fail-closed, misleading message)
next: none | perf: N/A
*/
//! Event handlers for the Inventory module.
//!
//! These handlers respond to domain events published on the kernel
//! event bus. Each handler holds a reference to the shared database
//! connection so it can perform side effects atomically.

use std::sync::{Arc, Mutex};

use crate::error::InventoryError;
use crate::models::ProductType;
use foundation::contracts::{EventHandler, HandlerType, ModuleResult};
use foundation::events::SaleCompleted;
use rusqlite::Connection;
use tracing::{error, info};

/// Handler that decrements stock when a sale is completed.
///
/// For each line item in the completed sale, this handler first checks
/// if the product has a recipe (Bill of Materials) defined in the
/// `product_recipes` table. If it does, each ingredient's stock is
/// deducted by `qty × quantity_required` instead of deducting the
/// composite item itself. If no recipe exists, the handler falls back
/// to deducting the sold product's own stock directly.
///
/// Non-inventory product types (e.g. `service`) are silently skipped —
/// they have no stock to deduct.
///
/// If a product is not found by SKU, the handler logs a warning
/// and continues (the product may be a non-inventory item).
#[derive(Debug)]
pub struct InventoryStockHandler {
    db: Arc<Mutex<Connection>>,
}

impl InventoryStockHandler {
    /// Create a new handler with a shared database connection.
    pub fn new(db: Arc<Mutex<Connection>>) -> Self {
        Self { db }
    }

    /// Deduct stock for a single line item, respecting BOM recipes.
    ///
    /// If `tx` is provided, all deductions run within that transaction
    /// (the caller is responsible for commit/rollback). If `tx` is None,
    /// each adjust_stock call creates its own transaction internally
    /// (legacy behavior for tests that don't need atomicity).
    ///
    /// If the product has a recipe, deduct each ingredient by
    /// `qty_sold × quantity_required`. Otherwise, deduct the
    /// product itself.
    ///
    /// Returns `Ok(())` if the deduction succeeded (or was skipped —
    /// unknown SKUs and non-inventory products are silently skipped).
    /// Returns `Err` if a deduction failed (e.g. insufficient stock).
    fn handle_line(
        &self,
        tx: &rusqlite::Transaction<'_>,
        sku: &str,
        qty: i64,
    ) -> Result<(), InventoryError> {
        use rusqlite::params;

        // Look up product ID by SKU.
        let product_id: Option<String> = tx
            .query_row(
                "SELECT id FROM products WHERE sku = ?1",
                params![sku],
                |row| row.get(0),
            )
            .ok();

        let product_id = match product_id {
            Some(pid) => pid,
            None => {
                error!(sku, "inventory handler: product not found by SKU");
                return Ok(());
            }
        };

        // Check product type
        let ptype_str: Option<String> = tx
            .query_row(
                "SELECT product_type FROM products WHERE id = ?1",
                params![product_id],
                |row| row.get(0),
            )
            .ok();

        if let Some(ref pt) = ptype_str
            && let Some(product_type) = ProductType::parse_str(pt)
            && !product_type.tracks_inventory()
        {
            info!(
                sku,
                "inventory handler: skipping non-inventory product — no stock to deduct"
            );
            return Ok(());
        } else if ptype_str
            .as_deref()
            .and_then(ProductType::parse_str)
            .is_none()
        {
            // Fail-open diagnostic, not a control-flow change: when the stored
            // product_type cannot be mapped, the chained condition above goes
            // false, the line falls through, and stock is deducted. `stored`
            // is logged in Debug form so NULL, "" and "RETAIL" stay
            // distinguishable — parse_str is case-sensitive and maps all three
            // to None. Whether a mislabelled row should block the deduction
            // instead is a product decision, deliberately not made here; a
            // shared helper cannot cover this site because handling it there
            // would change this control flow.
            tracing::warn!(
                sku = %sku,
                stored = ?ptype_str,
                operation = "InventoryStockHandler::handle_line",
                "unmapped product_type on sale line; stock was deducted anyway because the type could not be mapped"
            );
        }

        // Query recipe ingredients
        let mut stmt = tx.prepare("SELECT ingredient_product_id, quantity_required FROM product_recipes WHERE parent_product_id = ?1")?;
        let ings = stmt.query_map(params![product_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })?;

        // Every row must decode. `ings.flatten()` used to drop row-level
        // `FromSql` errors on the floor, and the consequence was silent stock
        // drift on BOTH sides: an empty list makes the code below take the
        // simple-product arm, so the COMPOSITE item is deducted and its
        // INGREDIENTS are never touched — the opposite of what the recipe
        // says. Measured before the fix: a `CAKE` sale with a recipe row whose
        // `quantity_required` could not decode left the ingredient at full
        // stock and decremented the finished good (cake 5 -> 3, flour 50 -> 50).
        //
        // A row that cannot be read is an infrastructure fact, not evidence
        // that the product has no recipe, so it is refused rather than treated
        // as an absent BOM. Failing here rolls the whole sale deduction back
        // (the handler holds one transaction and `handle` propagates), which is
        // the safe direction: a sale that does not settle can be retried, stock
        // that silently drifted cannot be noticed.
        let mut ingredients = Vec::new();
        for i in ings {
            ingredients.push(i?);
        }

        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

        if ingredients.is_empty() {
            let mut update_stmt = tx.prepare("UPDATE inventory SET qty = qty - ?1, updated_at = ?2 WHERE product_id = ?3 RETURNING qty")?;
            let new_qty: Option<i64> = update_stmt
                .query_row(params![qty, now, &product_id], |r| r.get(0))
                .ok();
            match new_qty {
                Some(q) if q >= 0 => {
                    tx.execute("UPDATE stock_summary SET qty = qty - ?1, updated_at = ?2 WHERE item_id = ?3", params![qty, now, &product_id]).ok();
                    info!(
                        sku,
                        qty = -qty,
                        new_qty = q,
                        "inventory handler: stock decremented for simple product"
                    );
                }
                _ => {
                    return Err(InventoryError::validation(
                        "stock",
                        format!("insufficient stock for SKU {sku}"),
                    ));
                }
            }
        } else {
            for (ingredient_product_id, quantity_required) in ingredients {
                let ingredient_sku: Option<String> = tx
                    .query_row(
                        "SELECT sku FROM products WHERE id = ?1",
                        params![&ingredient_product_id],
                        |r| r.get(0),
                    )
                    .ok();

                let deduct_qty = qty * quantity_required;
                let mut update_stmt = tx.prepare("UPDATE inventory SET qty = qty - ?1, updated_at = ?2 WHERE product_id = ?3 RETURNING qty")?;
                let new_qty: Option<i64> = update_stmt
                    .query_row(params![deduct_qty, now, &ingredient_product_id], |r| {
                        r.get(0)
                    })
                    .ok();
                match new_qty {
                    Some(q) if q >= 0 => {
                        tx.execute("UPDATE stock_summary SET qty = qty - ?1, updated_at = ?2 WHERE item_id = ?3", params![deduct_qty, now, &ingredient_product_id]).ok();
                        info!(
                            sku = ingredient_sku.as_deref().unwrap_or(""),
                            qty = -deduct_qty,
                            recipe_for = sku,
                            new_qty = q,
                            "inventory handler: BOM ingredient stock decremented"
                        );
                    }
                    _ => {
                        return Err(InventoryError::validation(
                            "stock",
                            format!(
                                "insufficient stock for SKU {}",
                                ingredient_sku.as_deref().unwrap_or(sku)
                            ),
                        ));
                    }
                }
            }
        }
        Ok(())
    }
}

impl EventHandler<SaleCompleted> for InventoryStockHandler {
    // DEAD / test-only (see scripts/handler-classification.json): this handler is
    // constructed nowhere in production, so it deliberately stays internal_helper
    // rather than claiming a seam category it does not exercise.
    fn handler_type(&self) -> HandlerType {
        HandlerType::InternalHelper
    }

    fn handle(&self, event: &SaleCompleted) -> ModuleResult {
        let mut conn = self
            .db
            .lock()
            .map_err(|e| anyhow::anyhow!("inventory handler: db lock failed: {e}"))?;
        let tx = conn.transaction()?;

        for line in &event.line_items {
            if let Err(e) = self.handle_line(&tx, &line.sku, line.qty) {
                return Err(anyhow::anyhow!(
                    "inventory handler: deduction failed for {}: {e}",
                    line.sku
                ));
            }
        }

        tx.commit()
            .map_err(|e| anyhow::anyhow!("inventory handler: transaction commit failed: {e}"))?;
        Ok(())
    }
}

#[cfg(test)]
#[path = "handlers_tests.rs"]
mod tests;
