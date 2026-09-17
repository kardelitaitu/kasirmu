//! Integration tests for the inventory module — stock adjustments,
//! product delete cascade, product variant CRUD, ordering,
//! deactivation, and edge cases.
//!
//! Tests exercise the full persistence layer via the public
//! [`kasirmu_core::Store`] API against an in-memory SQLite database.

use foundation::Barcode;
use kasirmu_core::inventory::{CANONICAL_DEFAULT_LOCATION_UUID, LocationId};
use kasirmu_core::{Currency, Money, ProductVariant, Store, migrations};
use rusqlite::Connection;

// ── Helpers ───────────────────────────────────────────────────────────

fn setup() -> Connection {
    migrations::fresh_db()
}

fn store(conn: &Connection) -> Store<'_> {
    Store::new(conn)
}

fn usd() -> Currency {
    "USD".parse().unwrap()
}

fn price(minor: i64) -> Money {
    Money {
        minor_units: minor,
        currency: usd(),
    }
}

/// Seed a product with initial stock.
fn seed_product(conn: &Connection, _id: &str, sku: &str, name: &str, initial_stock: i64) {
    store(conn)
        .create_product(sku, name, price(1000), None, None, initial_stock, None)
        .unwrap();
}

/// Helper: canonical wrapper around `adjust_stock_at_location_with_reason`
/// that creates a transaction and uses the canonical default location.
/// Returns the post-update qty, matching the old `adjust_stock` contract.
fn adjust_stock(
    s: &Store<'_>,
    conn: &Connection,
    sku: &str,
    delta: i64,
) -> Result<i64, kasirmu_core::CoreError> {
    let tx = conn.unchecked_transaction()?;
    let loc = LocationId::from(CANONICAL_DEFAULT_LOCATION_UUID);
    let result =
        s.adjust_stock_at_location_with_reason(&tx, sku, delta, &loc, None, None, None, None)?;
    tx.commit()?;
    Ok(result)
}

// ── Stock: Multi-step adjustments ────────────────────────────────────

#[test]
fn stock_multi_step_adjustments() {
    let conn = setup();
    seed_product(&conn, "p1", "MULTI", "Multi Step", 100);
    let s = store(&conn);

    // Sell 10 → 90.
    assert_eq!(adjust_stock(&s, &conn, "MULTI", -10).unwrap(), 90);
    // Sell 30 → 60.
    assert_eq!(adjust_stock(&s, &conn, "MULTI", -30).unwrap(), 60);
    // Restock 50 → 110.
    assert_eq!(adjust_stock(&s, &conn, "MULTI", 50).unwrap(), 110);
    // Sell 110 → 0.
    assert_eq!(adjust_stock(&s, &conn, "MULTI", -110).unwrap(), 0);
}

#[test]
fn stock_sell_to_zero_then_restock() {
    let conn = setup();
    seed_product(&conn, "p2", "ZERO-RESTOCK", "Zero Then Restock", 25);
    let s = store(&conn);

    // Sell all 25.
    assert_eq!(adjust_stock(&s, &conn, "ZERO-RESTOCK", -25).unwrap(), 0);

    // Verify get_stock returns 0.
    let id = s.product_id_by_sku("ZERO-RESTOCK").unwrap().unwrap();
    assert_eq!(s.get_stock(&id).unwrap(), 0);

    // Restock 15.
    assert_eq!(adjust_stock(&s, &conn, "ZERO-RESTOCK", 15).unwrap(), 15);
}

#[test]
fn stock_first_adjustment_creates_inventory_row() {
    let conn = setup();
    // Create a product without initial stock.
    let s = store(&conn);
    let p = s
        .create_product(
            "FIRST-ADJ",
            "First Adjustment",
            price(500),
            None,
            None,
            0,
            None,
        )
        .unwrap();

    // No inventory row yet — get_stock returns 0.
    assert_eq!(s.get_stock(&p.id).unwrap(), 0);

    // First adjustment creates the inventory row.
    assert_eq!(adjust_stock(&s, &conn, "FIRST-ADJ", 25).unwrap(), 25);
    assert_eq!(s.get_stock(&p.id).unwrap(), 25);
}

#[test]
fn stock_adjust_after_product_delete_returns_not_found() {
    let conn = setup();
    seed_product(&conn, "p3", "DEL-ADJ", "Delete Then Adjust", 10);
    let s = store(&conn);

    s.delete_product("DEL-ADJ").unwrap();

    let err = adjust_stock(&s, &conn, "DEL-ADJ", 5).unwrap_err();
    assert!(matches!(err, kasirmu_core::CoreError::NotFound { .. }));
}

#[test]
fn stock_adjust_oversell_rejected() {
    let conn = setup();
    seed_product(&conn, "p4", "OVERSELL", "Oversell Test", 5);
    let s = store(&conn);

    let err = adjust_stock(&s, &conn, "OVERSELL", -10).unwrap_err();
    assert!(matches!(
        err,
        kasirmu_core::CoreError::InsufficientStockAtLocation { .. }
    ));
}

// ── Stock: Multiple products ─────────────────────────────────────────

#[test]
fn stock_multiple_products_tracked_independently() {
    let conn = setup();
    seed_product(&conn, "mp1", "PROD-A", "Product A", 100);
    seed_product(&conn, "mp2", "PROD-B", "Product B", 200);
    seed_product(&conn, "mp3", "PROD-C", "Product C", 300);
    let s = store(&conn);

    assert_eq!(adjust_stock(&s, &conn, "PROD-A", -10).unwrap(), 90);
    assert_eq!(adjust_stock(&s, &conn, "PROD-B", 25).unwrap(), 225);
    assert_eq!(adjust_stock(&s, &conn, "PROD-C", -50).unwrap(), 250);

    // Verify each independently.
    let id_a = s.product_id_by_sku("PROD-A").unwrap().unwrap();
    let id_b = s.product_id_by_sku("PROD-B").unwrap().unwrap();
    let id_c = s.product_id_by_sku("PROD-C").unwrap().unwrap();
    assert_eq!(s.get_stock(&id_a).unwrap(), 90);
    assert_eq!(s.get_stock(&id_b).unwrap(), 225);
    assert_eq!(s.get_stock(&id_c).unwrap(), 250);
}

// ── Stock: Overflow ──────────────────────────────────────────────────

#[test]
fn stock_adjust_overflow_rejected() {
    let conn = setup();
    let s = store(&conn);
    let _p = s
        .create_product(
            "OVERFLOW",
            "Overflow",
            price(100),
            None,
            None,
            i64::MAX,
            None,
        )
        .unwrap();

    let err = adjust_stock(&s, &conn, "OVERFLOW", 1).unwrap_err();
    assert!(matches!(
        err,
        kasirmu_core::CoreError::InsufficientStockAtLocation { .. }
    ));
}

// ── Product delete cascades to inventory ─────────────────────────────

#[test]
fn product_delete_cascades_to_inventory() {
    let conn = setup();
    seed_product(&conn, "p-cas", "CASCADE", "Cascade Test", 50);
    let s = store(&conn);

    let id = s.product_id_by_sku("CASCADE").unwrap().unwrap();
    assert_eq!(s.get_stock(&id).unwrap(), 50);

    s.delete_product("CASCADE").unwrap();

    // Product gone.
    let p = s.get_product("CASCADE").unwrap();
    assert!(p.is_none());

    // Inventory row also gone (ON DELETE CASCADE).
    // product_id_by_sku returns None because the product is gone.
    assert!(s.product_id_by_sku("CASCADE").unwrap().is_none());
}

// ──── Product list includes stock after adjustments ──────────────────

#[test]
fn list_products_reflects_stock_adjustments() {
    let conn = setup();
    seed_product(&conn, "pa", "LIST-ADJ-A", "Adjust A", 30);
    seed_product(&conn, "pb", "LIST-ADJ-B", "Adjust B", 40);
    let s = store(&conn);

    adjust_stock(&s, &conn, "LIST-ADJ-A", -10).unwrap();
    adjust_stock(&s, &conn, "LIST-ADJ-B", 5).unwrap();

    let products = s.list_products().unwrap();
    let a = products
        .iter()
        .find(|p| p.product.sku.as_str() == "LIST-ADJ-A")
        .unwrap();
    let b = products
        .iter()
        .find(|p| p.product.sku.as_str() == "LIST-ADJ-B")
        .unwrap();

    assert_eq!(a.stock_qty, Some(20), "30 - 10 = 20");
    assert_eq!(b.stock_qty, Some(45), "40 + 5 = 45");
}

// ── Product variants: ordering ───────────────────────────────────────

#[test]
fn variants_ordered_by_sort_order_then_name() {
    let conn = setup();
    seed_product(&conn, "pv", "VARIANT-ORDER", "Variant Order", 0);
    let s = store(&conn);

    let variants = vec![
        ProductVariant::new("VARIANT-ORDER", "Large", "VO-LARGE").with_sort_order(3),
        ProductVariant::new("VARIANT-ORDER", "Medium", "VO-MEDIUM").with_sort_order(2),
        ProductVariant::new("VARIANT-ORDER", "Small", "VO-SMALL").with_sort_order(1),
    ];
    for v in &variants {
        s.create_product_variant(v).unwrap();
    }

    let loaded = s.list_product_variants("VARIANT-ORDER").unwrap();
    assert_eq!(loaded.len(), 3);
    assert_eq!(loaded[0].sku, "VO-SMALL", "sort_order 1 first");
    assert_eq!(loaded[1].sku, "VO-MEDIUM", "sort_order 2 second");
    assert_eq!(loaded[2].sku, "VO-LARGE", "sort_order 3 third");
}

#[test]
fn variants_same_sort_order_ordered_by_name() {
    let conn = setup();
    seed_product(&conn, "pv2", "VARIANT-TIE", "Variant Tie", 0);
    let s = store(&conn);

    let variants = vec![
        ProductVariant::new("VARIANT-TIE", "Zulu", "VT-Z").with_sort_order(1),
        ProductVariant::new("VARIANT-TIE", "Alpha", "VT-A").with_sort_order(1),
        ProductVariant::new("VARIANT-TIE", "Beta", "VT-B").with_sort_order(1),
    ];
    for v in &variants {
        s.create_product_variant(v).unwrap();
    }

    let loaded = s.list_product_variants("VARIANT-TIE").unwrap();
    assert_eq!(loaded.len(), 3);
    // Same sort_order, tie-break by name ASC.
    assert_eq!(loaded[0].sku, "VT-A", "Alpha first");
    assert_eq!(loaded[1].sku, "VT-B", "Beta second");
    assert_eq!(loaded[2].sku, "VT-Z", "Zulu third");
}

#[test]
fn variants_empty_list() {
    let conn = setup();
    seed_product(&conn, "pv-empty", "VARIANT-EMPTY", "No Variants", 0);
    let s = store(&conn);

    let loaded = s.list_product_variants("VARIANT-EMPTY").unwrap();
    assert!(loaded.is_empty());
}

#[test]
fn variants_no_price_override() {
    let conn = setup();
    seed_product(&conn, "pv-np", "VARIANT-NO-PRICE", "No Price Variant", 0);
    let s = store(&conn);

    let v = ProductVariant::new("VARIANT-NO-PRICE", "Default Price", "VNP-001");
    s.create_product_variant(&v).unwrap();

    let loaded = s.get_product_variant("VNP-001").unwrap().unwrap();
    assert!(
        loaded.price.is_none(),
        "variant with no price override should have None price"
    );
}

#[test]
fn variants_price_override_roundtrip() {
    let conn = setup();
    seed_product(&conn, "pv-po", "VARIANT-PRICE", "Price Variant", 0);
    let s = store(&conn);

    let v =
        ProductVariant::new("VARIANT-PRICE", "Price Override", "VPO-001").with_price(price(1500));
    s.create_product_variant(&v).unwrap();

    let loaded = s.get_product_variant("VPO-001").unwrap().unwrap();
    assert_eq!(loaded.price.unwrap().minor_units, 1500);
}

// ── Product variants: deactivation ───────────────────────────────────

#[test]
fn variant_deactivate_and_reactivate() {
    let conn = setup();
    seed_product(&conn, "pv-da", "VARIANT-DEACT", "Deactivate", 0);
    let s = store(&conn);

    let v = ProductVariant::new("VARIANT-DEACT", "Toggle Me", "VD-001");
    s.create_product_variant(&v).unwrap();

    // Deactivate.
    let deactivated = ProductVariant {
        is_active: false,
        ..v.clone()
    };
    s.update_product_variant(&deactivated).unwrap();
    let loaded = s.get_product_variant("VD-001").unwrap().unwrap();
    assert!(!loaded.is_active, "variant should be deactivated");

    // Reactivate.
    let reactivated = ProductVariant {
        is_active: true,
        ..v
    };
    s.update_product_variant(&reactivated).unwrap();
    let loaded = s.get_product_variant("VD-001").unwrap().unwrap();
    assert!(loaded.is_active, "variant should be reactivated");
}

#[test]
fn variant_get_nonexistent_sku() {
    let conn = setup();
    let s = store(&conn);
    let found = s.get_product_variant("NONEXISTENT-VARIANT").unwrap();
    assert!(found.is_none());
}

#[test]
fn variant_delete_not_found() {
    let conn = setup();
    let s = store(&conn);
    let err = s.delete_product_variant("NO-SUCH-VARIANT").unwrap_err();
    assert!(matches!(err, kasirmu_core::CoreError::NotFound { .. }));
}

// ── Product variants: FK constraint ──────────────────────────────────

#[test]
fn variant_create_with_missing_parent_rejected_by_fk() {
    let conn = setup();
    let s = store(&conn);

    let v = ProductVariant::new("PARENT-DOES-NOT-EXIST", "Orphan", "ORPHAN-001");
    let result = s.create_product_variant(&v);
    assert!(
        result.is_err(),
        "should reject variant with non-existent parent SKU"
    );
}

#[test]
fn variant_parent_delete_cascades_to_variants() {
    let conn = setup();
    seed_product(&conn, "pv-del", "VARIANT-DEL-PARENT", "Delete Parent", 0);
    let s = store(&conn);

    let v = ProductVariant::new("VARIANT-DEL-PARENT", "Child", "VDP-001");
    s.create_product_variant(&v).unwrap();
    assert!(s.get_product_variant("VDP-001").unwrap().is_some());

    // Delete the parent product.
    s.delete_product("VARIANT-DEL-PARENT").unwrap();

    // Variant should be gone (ON DELETE CASCADE).
    let found = s.get_product_variant("VDP-001").unwrap();
    assert!(found.is_none(), "variant should cascade on parent delete");
}

// ── Product variants: barcode uniqueness ─────────────────────────────

#[test]
fn variant_duplicate_barcode_rejected() {
    let conn = setup();
    seed_product(&conn, "pv-bc", "VARIANT-BARCODE", "Barcode Test", 0);
    let s = store(&conn);

    let v1 = ProductVariant::new("VARIANT-BARCODE", "First", "VB-001")
        .with_barcode(Barcode::new("1234567890123").unwrap());
    s.create_product_variant(&v1).unwrap();

    let v2 = ProductVariant::new("VARIANT-BARCODE", "Second", "VB-002")
        .with_barcode(Barcode::new("1234567890123").unwrap());
    let result = s.create_product_variant(&v2);
    assert!(result.is_err(), "duplicate barcode should be rejected");
}

#[test]
fn variant_multiple_null_barcodes_allowed() {
    let conn = setup();
    seed_product(&conn, "pv-nbc", "VARIANT-NO-BARCODE", "No Barcode", 0);
    let s = store(&conn);

    let v1 = ProductVariant::new("VARIANT-NO-BARCODE", "First", "VNB-001");
    let v2 = ProductVariant::new("VARIANT-NO-BARCODE", "Second", "VNB-002");
    s.create_product_variant(&v1).unwrap();
    s.create_product_variant(&v2).unwrap();

    let loaded = s.list_product_variants("VARIANT-NO-BARCODE").unwrap();
    assert_eq!(loaded.len(), 2);
}

// ── Product variants: update fields ──────────────────────────────────

#[test]
fn variant_update_barcode() {
    let conn = setup();
    seed_product(&conn, "pv-ub", "VARIANT-UPDATE-BC", "Update Barcode", 0);
    let s = store(&conn);

    let v = ProductVariant::new("VARIANT-UPDATE-BC", "Original", "VUB-001")
        .with_barcode(Barcode::new("old-barcode").unwrap());
    s.create_product_variant(&v).unwrap();

    let updated = ProductVariant {
        barcode: Some(Barcode::new("new-barcode").unwrap()),
        ..v
    };
    s.update_product_variant(&updated).unwrap();

    let loaded = s.get_product_variant("VUB-001").unwrap().unwrap();
    assert_eq!(
        loaded.barcode.as_ref().map(|b| b.as_str()),
        Some("new-barcode")
    );
}

#[test]
fn variant_update_sort_order() {
    let conn = setup();
    seed_product(&conn, "pv-so", "VARIANT-SORT", "Sort Order", 0);
    let s = store(&conn);

    let v = ProductVariant::new("VARIANT-SORT", "Reorder Me", "VS-001").with_sort_order(1);
    s.create_product_variant(&v).unwrap();

    let updated = ProductVariant { sort_order: 5, ..v };
    s.update_product_variant(&updated).unwrap();

    let loaded = s.get_product_variant("VS-001").unwrap().unwrap();
    assert_eq!(loaded.sort_order, 5);
}

// ── get_stock edge cases ─────────────────────────────────────────────

#[test]
fn get_stock_nonexistent_product_id_returns_zero() {
    let conn = setup();
    let s = store(&conn);
    assert_eq!(s.get_stock("nonexistent-id").unwrap(), 0);
}

#[test]
fn get_stock_zero_for_product_without_inventory_row() {
    let conn = setup();
    let s = store(&conn);
    let p = s
        .create_product(
            "NO-INV",
            "No Inventory Row",
            price(100),
            None,
            None,
            0,
            None,
        )
        .unwrap();

    // Product exists but has no inventory row → get_stock returns 0.
    assert_eq!(s.get_stock(&p.id).unwrap(), 0);
}

// ── Product with stock_qty in list ───────────────────────────────────

#[test]
fn products_without_stock_show_none_in_list() {
    let conn = setup();
    let s = store(&conn);
    let p = s
        .create_product("NO-STOCK-LIST", "No Stock", price(100), None, None, 0, None)
        .unwrap();

    let products = s.list_products().unwrap();
    let found = products.iter().find(|pr| pr.product.id == p.id).unwrap();
    assert_eq!(
        found.stock_qty, None,
        "product without inventory row shows None"
    );
}

#[test]
fn products_with_stock_show_qty_in_list() {
    let conn = setup();
    seed_product(&conn, "p-sq", "STOCK-LIST", "Stocked Product", 42);
    let s = store(&conn);

    let products = s.list_products().unwrap();
    let found = products
        .iter()
        .find(|p| p.product.sku.as_str() == "STOCK-LIST")
        .unwrap();
    assert_eq!(found.stock_qty, Some(42));
}

// ── Inventory updated_at timestamps ──────────────────────────────────

#[test]
fn inventory_updated_at_changes_on_adjustment() {
    let conn = setup();
    seed_product(&conn, "p-ts", "INV-TIMESTAMP", "Timestamp Test", 10);
    let s = store(&conn);

    let id = s.product_id_by_sku("INV-TIMESTAMP").unwrap().unwrap();

    // Read initial updated_at from inventory table.
    let initial: String = conn
        .query_row(
            "SELECT updated_at FROM inventory WHERE product_id = ?1",
            rusqlite::params![id],
            |row| row.get(0),
        )
        .unwrap();

    std::thread::sleep(std::time::Duration::from_millis(2));

    adjust_stock(&s, &conn, "INV-TIMESTAMP", 5).unwrap();

    let after: String = conn
        .query_row(
            "SELECT updated_at FROM inventory WHERE product_id = ?1",
            rusqlite::params![id],
            |row| row.get(0),
        )
        .unwrap();

    assert!(
        after > initial,
        "updated_at should be newer after adjustment"
    );
    assert!(after.contains('T'), "updated_at should be ISO-8601");
    assert!(after.ends_with('Z'), "updated_at should be UTC");
}
