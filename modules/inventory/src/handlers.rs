/*
last audited 25-07-26 by RSA-Agent (modules-inventory slice A: handlers deep read)
crate: modules-inventory | status: SAFE | lint: CLEAN
findings: MSL-3 INFO — InventoryStockHandler deduction is tx-safe (error path drops tx, rollback) and BOM-aware, but two error-swallow patterns exist: (1) stock_summary writes are .ok()-swallowed best-effort (derived-cache drift self-heals via the ADR #6 rebuild); (2) a recipe-table read error would yield an empty ingredient list and deduct the composite product instead of ingredients (infrastructure-failure only; unknown-SKU and non-inventory skips are correct). UPDATE-RETURNING no-row maps to insufficient-stock error (fail-closed, misleading message)
next: tighten stock_summary error surfacing | perf: N/A
*/
//! Event handlers for the Inventory module.
//!
//! These handlers respond to domain events published on the kernel
//! event bus. Each handler holds a reference to the shared database
//! connection so it can perform side effects atomically.

use std::sync::{Arc, Mutex};

use crate::error::InventoryError;
use crate::models::ProductType;
use foundation::contracts::{EventHandler, ModuleResult};
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

        let mut ingredients = Vec::new();
        for i in ings.flatten() {
            ingredients.push(i);
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
mod tests {
    use super::*;
    use oz_core::db::Store;
    use oz_core::migrations;
    use platform_kernel::EventBus;

    fn fresh_db() -> Arc<Mutex<Connection>> {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrations::run(&mut conn).unwrap();
        Arc::new(Mutex::new(conn))
    }

    fn seed_product(db: &Connection) {
        db.execute_batch(
            "INSERT INTO products (id, sku, name, price_minor, currency, created_at, updated_at)
             VALUES ('p1', 'COFFEE', 'Coffee', 350, 'USD', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
             INSERT INTO inventory (product_id, qty, updated_at) VALUES ('p1', 10, '2025-01-01T00:00:00.000Z');
             INSERT INTO stock_summary (item_id, location_id, qty, updated_at)
             VALUES ('p1', '01926b3a-0000-7000-8000-000000000001', 10, '2025-01-01T00:00:00.000Z');",
        )
        .unwrap();
    }

    #[test]
    fn handler_decrements_stock() {
        let db = fresh_db();
        {
            let conn = db.lock().unwrap();
            seed_product(&conn);
        }

        let handler = InventoryStockHandler::new(db.clone());

        let event = SaleCompleted {
            sale_id: "sale-1".into(),
            store_id: None,
            line_items: vec![oz_core::events::SaleCompletedLine {
                sku: "COFFEE".into(),
                qty: 3,
                unit_price_minor: 350,
                tax_minor: 0,
                tax_rate_id: None,
            }],
            total_minor: 1050,
            currency: "USD".into(),
            customer_id: None,
        };

        handler.handle(&event).unwrap();

        // Verify stock was decremented.
        let conn = db.lock().unwrap();
        let store = Store::new(&conn);
        let product_id = store.product_id_by_sku("COFFEE").unwrap().unwrap();
        let qty = store.get_stock(&product_id).unwrap();
        assert_eq!(qty, 7);
    }

    #[test]
    fn handler_works_with_event_bus() {
        let db = fresh_db();
        {
            let conn = db.lock().unwrap();
            seed_product(&conn);
        }

        let bus = EventBus::new();
        let handler = InventoryStockHandler::new(db.clone());
        bus.subscribe("sale.completed", Box::new(handler));

        let event = SaleCompleted {
            sale_id: "sale-2".into(),
            store_id: None,
            line_items: vec![oz_core::events::SaleCompletedLine {
                sku: "COFFEE".into(),
                qty: 1,
                unit_price_minor: 350,
                tax_minor: 0,
                tax_rate_id: None,
            }],
            total_minor: 350,
            currency: "USD".into(),
            customer_id: None,
        };

        bus.publish(&event).unwrap();

        let conn = db.lock().unwrap();
        let store = Store::new(&conn);
        let product_id = store.product_id_by_sku("COFFEE").unwrap().unwrap();
        let qty = store.get_stock(&product_id).unwrap();
        assert_eq!(qty, 9);
    }

    #[test]
    fn handler_unknown_sku_does_not_crash() {
        let db = fresh_db();
        let handler = InventoryStockHandler::new(db.clone());

        let event = SaleCompleted {
            sale_id: "sale-3".into(),
            store_id: None,
            line_items: vec![oz_core::events::SaleCompletedLine {
                sku: "UNKNOWN".into(),
                qty: 1,
                unit_price_minor: 100,
                tax_minor: 0,
                tax_rate_id: None,
            }],
            total_minor: 100,
            currency: "USD".into(),
            customer_id: None,
        };

        // Should not panic or error.
        let result = handler.handle(&event);
        assert!(result.is_ok());
    }

    // ── BOM / Recipe deduction tests ────────────────────────────

    fn seed_bom_products(conn: &Connection) {
        conn.execute_batch(
            "INSERT INTO products (id, sku, name, price_minor, currency, created_at, updated_at) VALUES
                ('burger', 'BURGER', 'Cheeseburger', 500, 'USD', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
                ('bun', 'BUN', 'Burger Bun', 100, 'USD', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
                ('patty', 'PATTY', 'Beef Patty', 200, 'USD', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
                ('cheese', 'CHEESE', 'Cheese Slice', 50, 'USD', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
             INSERT INTO inventory (product_id, qty, updated_at) VALUES
                ('bun', 100, '2025-01-01T00:00:00.000Z'),
                ('patty', 50, '2025-01-01T00:00:00.000Z'),
                ('cheese', 200, '2025-01-01T00:00:00.000Z');
             INSERT INTO stock_summary (item_id, location_id, qty, updated_at) VALUES
                ('bun', '01926b3a-0000-7000-8000-000000000001', 100, '2025-01-01T00:00:00.000Z'),
                ('patty', '01926b3a-0000-7000-8000-000000000001', 50, '2025-01-01T00:00:00.000Z'),
                ('cheese', '01926b3a-0000-7000-8000-000000000001', 200, '2025-01-01T00:00:00.000Z');
             INSERT INTO product_recipes (id, parent_product_id, ingredient_product_id, quantity_required, unit) VALUES
                ('r1', 'burger', 'bun', 1, 'pcs'),
                ('r2', 'burger', 'patty', 1, 'pcs'),
                ('r3', 'burger', 'cheese', 2, 'pcs');",
        )
        .unwrap();
    }

    #[test]
    fn handler_deducts_bom_ingredients_when_recipe_exists() {
        let db = fresh_db();
        {
            let conn = db.lock().unwrap();
            seed_bom_products(&conn);
        }

        let handler = InventoryStockHandler::new(db.clone());

        let event = SaleCompleted {
            sale_id: "sale-bom-1".into(),
            store_id: None,
            line_items: vec![oz_core::events::SaleCompletedLine {
                sku: "BURGER".into(),
                qty: 3,
                unit_price_minor: 500,
                tax_minor: 0,
                tax_rate_id: None,
            }],
            total_minor: 1500,
            currency: "USD".into(),
            customer_id: None,
        };

        handler.handle(&event).unwrap();

        let conn = db.lock().unwrap();
        let store = Store::new(&conn);

        // 3 burgers should deduct: 3 buns, 3 patties, 6 cheese slices
        let bun_id = store.product_id_by_sku("BUN").unwrap().unwrap();
        let patty_id = store.product_id_by_sku("PATTY").unwrap().unwrap();
        let cheese_id = store.product_id_by_sku("CHEESE").unwrap().unwrap();

        assert_eq!(store.get_stock(&bun_id).unwrap(), 97); // 100 - 3
        assert_eq!(store.get_stock(&patty_id).unwrap(), 47); // 50 - 3
        assert_eq!(store.get_stock(&cheese_id).unwrap(), 194); // 200 - 6
    }

    #[test]
    fn handler_skips_bom_for_simple_products() {
        let db = fresh_db();
        {
            let conn = db.lock().unwrap();
            seed_bom_products(&conn);
        }

        let handler = InventoryStockHandler::new(db.clone());

        // Selling a simple product (BUN has no recipe) should deduct directly.
        let event = SaleCompleted {
            sale_id: "sale-simple-1".into(),
            store_id: None,
            line_items: vec![oz_core::events::SaleCompletedLine {
                sku: "BUN".into(),
                qty: 5,
                unit_price_minor: 100,
                tax_minor: 0,
                tax_rate_id: None,
            }],
            total_minor: 500,
            currency: "USD".into(),
            customer_id: None,
        };

        handler.handle(&event).unwrap();

        let conn = db.lock().unwrap();
        let store = Store::new(&conn);
        let bun_id = store.product_id_by_sku("BUN").unwrap().unwrap();
        assert_eq!(store.get_stock(&bun_id).unwrap(), 95); // 100 - 5
    }

    #[test]
    fn handler_mixed_bom_and_simple_products() {
        let db = fresh_db();
        {
            let conn = db.lock().unwrap();
            seed_bom_products(&conn);
        }

        let handler = InventoryStockHandler::new(db.clone());

        let event = SaleCompleted {
            sale_id: "sale-mixed-1".into(),
            store_id: None,
            line_items: vec![
                oz_core::events::SaleCompletedLine {
                    sku: "BURGER".into(),
                    qty: 2,
                    unit_price_minor: 500,
                    tax_minor: 0,
                    tax_rate_id: None,
                },
                oz_core::events::SaleCompletedLine {
                    sku: "BUN".into(),
                    qty: 10,
                    unit_price_minor: 100,
                    tax_minor: 0,
                    tax_rate_id: None,
                },
            ],
            total_minor: 2000,
            currency: "USD".into(),
            customer_id: None,
        };

        handler.handle(&event).unwrap();

        let conn = db.lock().unwrap();
        let store = Store::new(&conn);
        let bun_id = store.product_id_by_sku("BUN").unwrap().unwrap();
        let patty_id = store.product_id_by_sku("PATTY").unwrap().unwrap();
        let cheese_id = store.product_id_by_sku("CHEESE").unwrap().unwrap();

        assert_eq!(store.get_stock(&bun_id).unwrap(), 88); // 100 - 2 (BOM) - 10 (direct)
        assert_eq!(store.get_stock(&patty_id).unwrap(), 48); // 50 - 2
        assert_eq!(store.get_stock(&cheese_id).unwrap(), 196); // 200 - 4
    }

    #[test]
    fn handler_deducts_bom_ingredients_via_event_bus() {
        let db = fresh_db();
        {
            let conn = db.lock().unwrap();
            seed_bom_products(&conn);
        }

        let bus = EventBus::new();
        let handler = InventoryStockHandler::new(db.clone());
        bus.subscribe("sale.completed", Box::new(handler));

        let event = SaleCompleted {
            sale_id: "sale-bus-1".into(),
            store_id: None,
            line_items: vec![oz_core::events::SaleCompletedLine {
                sku: "BURGER".into(),
                qty: 1,
                unit_price_minor: 500,
                tax_minor: 0,
                tax_rate_id: None,
            }],
            total_minor: 500,
            currency: "USD".into(),
            customer_id: None,
        };

        bus.publish(&event).unwrap();

        let conn = db.lock().unwrap();
        let store = Store::new(&conn);
        let cheese_id = store.product_id_by_sku("CHEESE").unwrap().unwrap();
        assert_eq!(store.get_stock(&cheese_id).unwrap(), 198); // 200 - 2 (1 burger * 2 cheese)
    }

    #[test]
    fn handler_skips_service_products() {
        let db = fresh_db();
        {
            let conn = db.lock().unwrap();
            // Create a service product (no inventory row needed).
            conn.execute_batch(
                "INSERT INTO products (id, sku, name, price_minor, currency, product_type, created_at, updated_at)
                 VALUES ('svc-1', 'CARWASH', 'Car Wash', 5000, 'USD', 'service', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');"
            ).unwrap();
        }

        let handler = InventoryStockHandler::new(db.clone());

        let event = SaleCompleted {
            sale_id: "sale-svc-1".into(),
            store_id: None,
            line_items: vec![oz_core::events::SaleCompletedLine {
                sku: "CARWASH".into(),
                qty: 1,
                unit_price_minor: 5000,
                tax_minor: 0,
                tax_rate_id: None,
            }],
            total_minor: 5000,
            currency: "USD".into(),
            customer_id: None,
        };

        // Should succeed without error — service products are skipped silently.
        let result = handler.handle(&event);
        assert!(result.is_ok());
    }

    #[test]
    fn handler_partial_deduction_leaves_inconsistent_stock() {
        // Bug #1: When a sale has multiple line items and one deduction
        // fails (e.g. insufficient stock), earlier successful deductions
        // are already committed because each adjust_stock() call creates
        // its own transaction. This leaves the inventory in an inconsistent
        // state — some products deducted, others not — for a single sale.
        let db = fresh_db();
        {
            let conn = db.lock().unwrap();
            conn.execute_batch(
                "INSERT INTO products (id, sku, name, price_minor, currency, product_type, created_at, updated_at) VALUES
                    ('p-coffee', 'COFFEE', 'Coffee', 350, 'USD', 'retail', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
                    ('p-tea', 'TEA', 'Tea', 250, 'USD', 'retail', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
                 INSERT INTO inventory (product_id, qty, updated_at) VALUES
                    ('p-coffee', 5, '2025-01-01T00:00:00.000Z'),
                    ('p-tea', 1, '2025-01-01T00:00:00.000Z');
                 INSERT INTO stock_summary (item_id, location_id, qty, updated_at) VALUES
                    ('p-coffee', '01926b3a-0000-7000-8000-000000000001', 5, '2025-01-01T00:00:00.000Z'),
                    ('p-tea', '01926b3a-0000-7000-8000-000000000001', 1, '2025-01-01T00:00:00.000Z');",
            )
            .unwrap();
        }

        let handler = InventoryStockHandler::new(db.clone());

        // COFFEE has 5, TEA has 1. Sell 2 coffee (OK) + 3 tea (FAILS — only 1 in stock).
        let event = SaleCompleted {
            sale_id: "sale-partial-1".into(),
            store_id: None,
            line_items: vec![
                oz_core::events::SaleCompletedLine {
                    sku: "COFFEE".into(),
                    qty: 2,
                    unit_price_minor: 350,
                    tax_minor: 0,
                    tax_rate_id: None,
                },
                oz_core::events::SaleCompletedLine {
                    sku: "TEA".into(),
                    qty: 3,
                    unit_price_minor: 250,
                    tax_minor: 0,
                    tax_rate_id: None,
                },
            ],
            total_minor: 1450,
            currency: "USD".into(),
            customer_id: None,
        };

        let result = handler.handle(&event);
        // After the fix, deduction failure propagates as an error and the
        // transaction rolls back — all deductions are atomic.
        assert!(
            result.is_err(),
            "handler should return error when deduction fails"
        );
        assert!(
            result.unwrap_err().to_string().contains("TEA"),
            "error should mention the failing SKU"
        );

        let conn = db.lock().unwrap();
        let store = Store::new(&conn);
        let coffee_id = store.product_id_by_sku("COFFEE").unwrap().unwrap();
        let qty = store.get_stock(&coffee_id).unwrap();
        // FIX VERIFIED: COFFEE stock is still 5 because the transaction
        // rolled back — all-or-nothing atomicity.
        assert_eq!(qty, 5, "COFFEE stock must be 5 (tx rolled back)");
    }

    #[test]
    fn handler_multiple_line_items() {
        let db = fresh_db();
        {
            let conn = db.lock().unwrap();
            // Add a second product.
            conn.execute_batch(
                "INSERT INTO products (id, sku, name, price_minor, currency, created_at, updated_at)
                 VALUES ('p2', 'TEA', 'Tea', 250, 'USD', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
                 INSERT INTO inventory (product_id, qty, updated_at) VALUES ('p2', 15, '2025-01-01T00:00:00.000Z');
                 INSERT INTO stock_summary (item_id, location_id, qty, updated_at)
                 VALUES ('p2', '01926b3a-0000-7000-8000-000000000001', 15, '2025-01-01T00:00:00.000Z');",
            )
            .unwrap();
            seed_product(&conn);
        }

        let handler = InventoryStockHandler::new(db.clone());

        let event = SaleCompleted {
            sale_id: "sale-4".into(),
            store_id: None,
            line_items: vec![
                oz_core::events::SaleCompletedLine {
                    sku: "COFFEE".into(),
                    qty: 2,
                    unit_price_minor: 350,
                    tax_minor: 0,
                    tax_rate_id: None,
                },
                oz_core::events::SaleCompletedLine {
                    sku: "TEA".into(),
                    qty: 5,
                    unit_price_minor: 250,
                    tax_minor: 0,
                    tax_rate_id: None,
                },
            ],
            total_minor: 1950,
            currency: "USD".into(),
            customer_id: None,
        };

        handler.handle(&event).unwrap();

        let conn = db.lock().unwrap();
        let store = Store::new(&conn);
        let coffee_id = store.product_id_by_sku("COFFEE").unwrap().unwrap();
        let tea_id = store.product_id_by_sku("TEA").unwrap().unwrap();
        assert_eq!(store.get_stock(&coffee_id).unwrap(), 8); // 10 - 2
        assert_eq!(store.get_stock(&tea_id).unwrap(), 10); // 15 - 5
    }
}
