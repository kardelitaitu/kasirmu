//! Unit tests for `handlers`.
//!
//! Moved out of `handlers.rs` to satisfy the AGENTS.md section 2 rule that unit
//! tests live in a sibling `*_tests.rs` file rather than inside a production
//! `.rs` file. Wired from `handlers.rs` with:
//!   `#[cfg(test)] #[path = "handlers_tests.rs"] mod tests;`

use super::*;

use kasirmu_core::db::Store;
use kasirmu_core::migrations;
use platform_kernel::EventBus;

fn fresh_db() -> Arc<Mutex<Connection>> {
    // O-T01: snapshot clone (~3 ms) rather than a 68-migration replay (~305 ms).
    let conn = migrations::fresh_db();
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

/// A recipe row that cannot decode must refuse the sale, not silently
/// turn the product into a simple one.
///
/// The old `ings.flatten()` dropped row-level `FromSql` errors, so an
/// unreadable BOM row produced an EMPTY ingredient list — and the empty
/// list is the code path for "this product has no recipe". The composite
/// item was then deducted while its ingredients stayed at full stock.
#[test]
fn an_undecodable_recipe_row_refuses_the_sale_rather_than_mis_deducting() {
    let db = fresh_db();
    {
        let conn = db.lock().unwrap();
        seed_product(&conn);
        // A composite product plus one recipe row whose quantity_required
        // cannot decode as i64 — the row-level FromSql error.
        conn.execute_batch(
            "INSERT INTO products (id, sku, name, price_minor, currency, created_at, updated_at)
             VALUES ('p2', 'CAKE', 'Cake', 1000, 'USD', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
             INSERT INTO inventory (product_id, qty, updated_at) VALUES ('p2', 5, '2025-01-01T00:00:00.000Z');
             INSERT INTO products (id, sku, name, price_minor, currency, created_at, updated_at)
             VALUES ('p3', 'FLOUR', 'Flour', 100, 'USD', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
             INSERT INTO inventory (product_id, qty, updated_at) VALUES ('p3', 50, '2025-01-01T00:00:00.000Z');
             INSERT INTO product_recipes (id, parent_product_id, ingredient_product_id, quantity_required)
             VALUES ('r1', 'p2', 'p3', 'not-a-number');"
        )
        .unwrap();
    }
    let handler = InventoryStockHandler::new(db.clone());
    let event = SaleCompleted {
        sale_id: "sale-probe".into(),
        store_id: None,
        line_items: vec![kasirmu_core::events::SaleCompletedLine {
            sku: "CAKE".into(),
            qty: 2,
            unit_price_minor: 1000,
            tax_minor: 0,
            tax_rate_id: None,
        }],
        total_minor: 2000,
        currency: "USD".into(),
        customer_id: None,
    };
    // The sale must be REFUSED, not settled against a mis-read recipe.
    let r = handler.handle(&event);
    assert!(
        r.is_err(),
        "an undecodable recipe row must refuse the deduction, not fall through to the simple-product arm"
    );

    // And the transaction rolled back, so neither side moved.
    let conn = db.lock().unwrap();
    let cake: i64 = conn
        .query_row("SELECT qty FROM inventory WHERE product_id = 'p2'", [], |x| x.get(0))
        .unwrap();
    let flour: i64 = conn
        .query_row("SELECT qty FROM inventory WHERE product_id = 'p3'", [], |x| x.get(0))
        .unwrap();
    assert_eq!(cake, 5, "the composite product must not be deducted");
    assert_eq!(flour, 50, "the ingredient must not be touched either");
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
        line_items: vec![kasirmu_core::events::SaleCompletedLine {
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
        line_items: vec![kasirmu_core::events::SaleCompletedLine {
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
        line_items: vec![kasirmu_core::events::SaleCompletedLine {
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
        line_items: vec![kasirmu_core::events::SaleCompletedLine {
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
        line_items: vec![kasirmu_core::events::SaleCompletedLine {
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
            kasirmu_core::events::SaleCompletedLine {
                sku: "BURGER".into(),
                qty: 2,
                unit_price_minor: 500,
                tax_minor: 0,
                tax_rate_id: None,
            },
            kasirmu_core::events::SaleCompletedLine {
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
        line_items: vec![kasirmu_core::events::SaleCompletedLine {
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
        line_items: vec![kasirmu_core::events::SaleCompletedLine {
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
            kasirmu_core::events::SaleCompletedLine {
                sku: "COFFEE".into(),
                qty: 2,
                unit_price_minor: 350,
                tax_minor: 0,
                tax_rate_id: None,
            },
            kasirmu_core::events::SaleCompletedLine {
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
            kasirmu_core::events::SaleCompletedLine {
                sku: "COFFEE".into(),
                qty: 2,
                unit_price_minor: 350,
                tax_minor: 0,
                tax_rate_id: None,
            },
            kasirmu_core::events::SaleCompletedLine {
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
