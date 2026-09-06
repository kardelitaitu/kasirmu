use super::*;
use crate::Money;
use crate::inventory::{CANONICAL_DEFAULT_LOCATION_UUID, LocationId};
use crate::migrations;
use rusqlite::Connection;

fn fresh() -> Connection {
    migrations::fresh_db()
}

fn seed_everything(conn: &Connection) {
    conn.execute_batch(
        "INSERT INTO categories (id, name, colour) VALUES
            ('cat-drinks', 'Drinks',  '#06b6d4'),
            ('cat-food',   'Food',    '#f97316');
         INSERT INTO products (id, sku, name, price_minor, currency, category_id, barcode, created_at, updated_at) VALUES
            ('prod-1', 'DRINK-001', 'Espresso',   350, 'USD', 'cat-drinks', NULL,           '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
            ('prod-2', 'FOOD-001',  'Bagel',      450, 'USD', 'cat-food',   '5901234123457', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
            ('prod-3', 'DRINK-002', 'Green Tea',  275, 'USD', 'cat-drinks', NULL,           '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
         INSERT INTO inventory (product_id, qty) VALUES
            ('prod-1', 50),
            ('prod-2', 12);
         -- Post ADR-18 §2c + migration 089: stock_summary has the
         -- composite PRIMARY KEY (item_id, location_id). Seed both
         -- legacy inventory AND stock_summary at the canonical default
         -- UUID so the canonical adjust_stock_at_location_with_reason
         -- Layer-1 read returns the seeded qty (was 0 pre-fix because
         -- the Runner-only-saw-inventory-table fixtures missed the
         -- post-refactor aggregate surface).
         INSERT INTO stock_summary (item_id, location_id, qty, updated_at) VALUES
            ('prod-1', '01926b3a-0000-7000-8000-000000000001', 50, '2025-01-01T00:00:00.000Z'),
            ('prod-2', '01926b3a-0000-7000-8000-000000000001', 12, '2025-01-01T00:00:00.000Z');",
    )
    .unwrap();
}

fn seed_for_canonical_test(conn: &Connection) {
    // Seed canonical default-location stock_summary rows so that
    // Store::adjust_stock_at_location_with_reason's Layer 1 read of
    // `stock_summary` returns realistic (>=0) values — without this
    // seed, Layer 1 reads 0 and the `>=0` filter rejects every test
    // deduction. Mirrors seed_everything's inventory seed but routes
    // through the post-ADR-18 §3 authoritative per-location surface.
    //
    // Idempotent (INSERT OR IGNORE): after the seed_everything change
    // that also seeds stock_summary at canonical UUID, tests calling
    // BOTH helpers land the same (item_id, location_id) twice. The
    // ignore-on-conflict clause turns the second seed into a no-op,
    // preserving the realistic qty=50 / qty=12 fixture without
    // tripping the composite-PK UNIQUE constraint.
    conn.execute_batch(
        "INSERT OR IGNORE INTO stock_summary (item_id, location_id, qty, updated_at) VALUES
            ('prod-1', '01926b3a-0000-7000-8000-000000000001', 50, '2025-01-01T00:00:00.000Z'),
            ('prod-2', '01926b3a-0000-7000-8000-000000000001', 12, '2025-01-01T00:00:00.000Z');",
    )
    .unwrap();
}

fn store(conn: &Connection) -> Store<'_> {
    Store::new(conn)
}

/// Helper: canonical wrapper around `adjust_stock_at_location_with_reason`
/// that creates a transaction and uses the canonical default location.
fn adjust_stock(s: &Store<'_>, conn: &Connection, sku: &str, delta: i64) -> Result<i64, CoreError> {
    let tx = conn.unchecked_transaction()?;
    let loc = LocationId::from(CANONICAL_DEFAULT_LOCATION_UUID);
    let result =
        s.adjust_stock_at_location_with_reason(&tx, sku, delta, &loc, None, None, None, None)?;
    tx.commit()?;
    Ok(result)
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

// ── Product queries ──────────────────────────────────────────

#[test]
fn list_products_empty_db() {
    let conn = fresh();
    let products = store(&conn).list_products().unwrap();
    assert!(products.is_empty());
}

#[test]
fn list_products_returns_all() {
    let conn = fresh();
    seed_everything(&conn);
    let products = store(&conn).list_products().unwrap();
    assert_eq!(products.len(), 3);
}

#[test]
fn list_products_includes_category_name() {
    let conn = fresh();
    seed_everything(&conn);
    let products = store(&conn).list_products().unwrap();
    let espresso = products
        .iter()
        .find(|p| p.product.sku.as_str() == "DRINK-001")
        .unwrap();
    assert_eq!(espresso.category_name.as_deref(), Some("Drinks"));
}

#[test]
fn list_products_includes_stock_qty() {
    let conn = fresh();
    seed_everything(&conn);
    let products = store(&conn).list_products().unwrap();
    let espresso = products
        .iter()
        .find(|p| p.product.sku.as_str() == "DRINK-001")
        .unwrap();
    assert_eq!(espresso.stock_qty, Some(50));
    let tea = products
        .iter()
        .find(|p| p.product.sku.as_str() == "DRINK-002")
        .unwrap();
    assert_eq!(tea.stock_qty, None);
}

#[test]
fn get_product_by_sku() {
    let conn = fresh();
    seed_everything(&conn);
    let p = store(&conn).get_product("DRINK-001").unwrap().unwrap();
    assert_eq!(p.product.sku.as_str(), "DRINK-001");
    assert_eq!(p.product.name, "Espresso");
    assert_eq!(p.product.price.minor_units, 350);
    assert_eq!(p.stock_qty, Some(50));
}

#[test]
fn get_product_unknown_sku() {
    let conn = fresh();
    let p = store(&conn).get_product("NOPE").unwrap();
    assert!(p.is_none());
}

// ── Product creation ─────────────────────────────────────────

#[test]
fn create_product_minimal() {
    let conn = fresh();
    let p = store(&conn)
        .create_product("NEW-001", "Widget", price(199), None, None, 0, None)
        .unwrap();
    assert_eq!(p.sku.as_str(), "NEW-001");
    assert_eq!(p.name, "Widget");
    assert_eq!(p.price.minor_units, 199);
    assert!(!p.id.is_empty());
    assert!(p.category_id.is_none());
    assert!(p.barcode.is_none());
}

#[test]
fn create_product_with_all_fields() {
    let conn = fresh();
    seed_everything(&conn);
    let p = store(&conn)
        .create_product(
            "FULL-001",
            "Full Item",
            price(999),
            Some("cat-drinks"),
            Some("1234567890123"),
            5,
            None,
        )
        .unwrap();
    assert_eq!(p.category_id.as_deref(), Some("cat-drinks"));
    assert_eq!(
        p.barcode.as_ref().map(|b| b.as_str()),
        Some("1234567890123")
    );
    let qty = store(&conn).get_stock(&p.id).unwrap();
    assert_eq!(qty, 5);
}

#[test]
fn create_product_without_stock() {
    let conn = fresh();
    let p = store(&conn)
        .create_product("NOSTOCK", "No Stock", price(100), None, None, 0, None)
        .unwrap();
    let qty = store(&conn).get_stock(&p.id).unwrap();
    assert_eq!(qty, 0);
}

#[test]
fn create_product_duplicate_sku() {
    let conn = fresh();
    store(&conn)
        .create_product("DUP", "First", price(100), None, None, 0, None)
        .unwrap();
    let err = store(&conn)
        .create_product("DUP", "Second", price(200), None, None, 0, None)
        .unwrap_err();
    assert!(matches!(err, CoreError::Conflict { .. }));
}

#[test]
fn create_product_validation_errors() {
    let conn = fresh();
    let s = store(&conn);
    let err = s
        .create_product("  ", "X", price(1), None, None, 0, None)
        .unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "sku"));
    let err = s
        .create_product("SKU", "", price(1), None, None, 0, None)
        .unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "name"));
    let err = s
        .create_product("SKU", "X", price(-1), None, None, 0, None)
        .unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "price"));
    let err = s
        .create_product("SKU", "X", price(1), None, None, -5, None)
        .unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "initial_stock"));
}

#[test]
fn create_service_product_never_gets_inventory_row() {
    let conn = fresh();
    // Even with initial_stock > 0, service products skip inventory.
    let p = store(&conn)
        .create_product(
            "CARWASH",
            "Car Wash",
            price(5000),
            None,
            None,
            10,
            Some("service"),
        )
        .unwrap();
    assert_eq!(p.product_type, crate::ProductType::Service);
    // get_stock returns 0 when no inventory row exists.
    let qty = store(&conn).get_stock(&p.id).unwrap();
    assert_eq!(qty, 0);
    // list_products returns stock_qty = None via LEFT JOIN.
    let pwd = store(&conn).get_product("CARWASH").unwrap().unwrap();
    assert_eq!(
        pwd.stock_qty, None,
        "service product should have null stock_qty"
    );
}

// ── Product update / delete ─────────────────────────────────

#[test]
fn update_product_basic() {
    let conn = fresh();
    seed_everything(&conn);
    let updated = store(&conn)
        .update_product("DRINK-001", "Latte", price(400), None, None, None, Some(1))
        .unwrap();
    assert_eq!(updated.name, "Latte");
    assert_eq!(updated.price.minor_units, 400);
    assert_eq!(updated.sku.as_str(), "DRINK-001");
}

#[test]
fn update_product_not_found() {
    let conn = fresh();
    let err = store(&conn)
        .update_product("NOPE", "X", price(1), None, None, None, Some(1))
        .unwrap_err();
    assert!(matches!(err, CoreError::NotFound { .. }));
}

#[test]
fn update_product_empty_name() {
    let conn = fresh();
    seed_everything(&conn);
    let err = store(&conn)
        .update_product("DRINK-001", "", price(1), None, None, None, Some(1))
        .unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "name"));
}

#[test]
fn update_product_negative_price() {
    let conn = fresh();
    seed_everything(&conn);
    let err = store(&conn)
        .update_product("DRINK-001", "X", price(-1), None, None, None, Some(1))
        .unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "price"));
}

#[test]
fn update_product_with_category() {
    let conn = fresh();
    seed_everything(&conn);
    let updated = store(&conn)
        .update_product(
            "DRINK-001",
            "Latte",
            price(400),
            Some("cat-food"),
            None,
            None,
            Some(1),
        )
        .unwrap();
    assert_eq!(updated.category_id.as_deref(), Some("cat-food"));
}

#[test]
fn delete_product_removes_row() {
    let conn = fresh();
    seed_everything(&conn);
    store(&conn).delete_product("DRINK-001").unwrap();
    let p = store(&conn).get_product("DRINK-001").unwrap();
    assert!(p.is_none());
}

#[test]
fn delete_product_not_found() {
    let conn = fresh();
    let err = store(&conn).delete_product("NOPE").unwrap_err();
    assert!(matches!(err, CoreError::NotFound { .. }));
}

// ── Categories ───────────────────────────────────────────────

#[test]
fn list_categories_empty_db() {
    let conn = fresh();
    let cats = store(&conn).list_categories().unwrap();
    assert!(cats.is_empty());
}

#[test]
fn list_categories_seeded() {
    let conn = fresh();
    seed_everything(&conn);
    let cats = store(&conn).list_categories().unwrap();
    assert_eq!(cats.len(), 2);
    assert_eq!(cats[0].name, "Drinks");
    assert_eq!(cats[1].name, "Food");
}

#[test]
fn create_category() {
    let conn = fresh();
    let cat = store(&conn)
        .create_category("cat-tools", "Tools", "#10b981", "dots-1")
        .unwrap();
    assert_eq!(cat.id, "cat-tools");
    assert_eq!(cat.name, "Tools");
    assert_eq!(cat.colour, "#10b981");
    assert_eq!(cat.icon, "dots-1");
}

#[test]
fn create_category_duplicate_name() {
    let conn = fresh();
    store(&conn)
        .create_category("cat-1", "Drinks", "#000", "")
        .unwrap();
    let err = store(&conn)
        .create_category("cat-2", "Drinks", "#fff", "")
        .unwrap_err();
    assert!(matches!(err, CoreError::Conflict { .. }));
}

#[test]
fn create_category_empty_name() {
    let conn = fresh();
    let err = store(&conn)
        .create_category("cat-1", "   ", "#000", "")
        .unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "name"));
}

#[test]
fn delete_category_removes_row() {
    let conn = fresh();
    store(&conn)
        .create_category("cat-orphan", "Orphan", "#000", "")
        .unwrap();
    store(&conn).delete_category("cat-orphan").unwrap();
    let cat = store(&conn).get_category("cat-orphan").unwrap();
    assert!(cat.is_none());
}

#[test]
fn delete_category_not_found() {
    let conn = fresh();
    let err = store(&conn).delete_category("nope").unwrap_err();
    assert!(matches!(err, CoreError::NotFound { .. }));
}

#[test]
fn delete_category_with_unlink_nullifies_products_and_returns_count() {
    let conn = fresh();
    let s = store(&conn);
    s.create_category("cat-1", "Drinks", "#06b6d4", "hot-drink")
        .unwrap();
    s.create_category("cat-2", "Food", "#f97316", "food")
        .unwrap();
    // Seed two products linked to cat-1 and one to cat-2.
    for (sku, cat) in [("SKU-1", "cat-1"), ("SKU-2", "cat-1"), ("SKU-3", "cat-2")] {
        s.create_product(sku, sku, price(100), Some(cat), None, 0, None)
            .unwrap();
    }

    let unlinked = s.delete_category_with_unlink("cat-1").unwrap();
    assert_eq!(unlinked, 2);
    assert!(s.get_category("cat-1").unwrap().is_none());
    // cat-2 and its product are untouched; the unlinked products exist
    // with a NULL category_id.
    assert!(s.get_category("cat-2").unwrap().is_some());
    let rows = s
        .conn
        .query_row(
            "SELECT COUNT(*) FROM products WHERE category_id IS NULL",
            [],
            |row| row.get::<_, i64>(0),
        )
        .unwrap();
    assert_eq!(rows, 2);
}

#[test]
fn delete_category_with_unlink_missing_returns_not_found() {
    let conn = fresh();
    let err = store(&conn)
        .delete_category_with_unlink("nope")
        .unwrap_err();
    assert!(matches!(err, CoreError::NotFound { .. }));
}

// ── Inventory ────────────────────────────────────────────────

#[test]
fn adjust_stock_add() {
    let conn = fresh();
    seed_everything(&conn);
    let new_qty = adjust_stock(&store(&conn), &conn, "DRINK-001", 5).unwrap();
    assert_eq!(new_qty, 55);
}

#[test]
fn adjust_stock_remove() {
    let conn = fresh();
    seed_everything(&conn);
    let new_qty = adjust_stock(&store(&conn), &conn, "DRINK-001", -10).unwrap();
    assert_eq!(new_qty, 40);
}

#[test]
fn adjust_stock_negative_error() {
    let conn = fresh();
    seed_everything(&conn);
    let err = adjust_stock(&store(&conn), &conn, "DRINK-001", -100).unwrap_err();
    assert!(matches!(err, CoreError::InsufficientStockAtLocation { .. }));
}

#[test]
fn adjust_stock_unknown_sku() {
    let conn = fresh();
    let err = adjust_stock(&store(&conn), &conn, "NO-SKU", 5).unwrap_err();
    assert!(matches!(err, CoreError::NotFound { .. }));
}

// ── Barcode lookup ───────────────────────────────────────────

#[test]
fn lookup_product_by_barcode_found() {
    let conn = fresh();
    seed_everything(&conn);
    let p = store(&conn)
        .lookup_product_with_details_by_barcode("5901234123457")
        .unwrap()
        .unwrap();
    assert_eq!(p.product.sku.as_str(), "FOOD-001");
    assert_eq!(p.product.name, "Bagel");
    assert_eq!(p.stock_qty, Some(12));
}

#[test]
fn lookup_product_by_barcode_not_found() {
    let conn = fresh();
    seed_everything(&conn);
    let p = store(&conn)
        .lookup_product_with_details_by_barcode("0000000000000")
        .unwrap();
    assert!(p.is_none());
}

#[test]
fn lookup_product_by_barcode_empty_string() {
    let conn = fresh();
    seed_everything(&conn);
    let p = store(&conn)
        .lookup_product_with_details_by_barcode("")
        .unwrap();
    assert!(p.is_none(), "empty barcode should return None");
}

#[test]
fn lookup_product_by_barcode_whitespace() {
    let conn = fresh();
    seed_everything(&conn);
    let p = store(&conn)
        .lookup_product_with_details_by_barcode("   ")
        .unwrap();
    assert!(p.is_none(), "whitespace-only barcode should return None");
}

#[test]
fn get_product_by_barcode_found() {
    let conn = fresh();
    seed_everything(&conn);
    let p = store(&conn)
        .get_product_by_barcode("5901234123457")
        .unwrap()
        .unwrap();
    assert_eq!(p.sku.as_str(), "FOOD-001");
}

#[test]
fn get_product_by_barcode_not_found() {
    let conn = fresh();
    seed_everything(&conn);
    let p = store(&conn)
        .get_product_by_barcode("0000000000000")
        .unwrap();
    assert!(p.is_none());
}

#[test]
fn get_product_by_barcode_empty() {
    let conn = fresh();
    let p = store(&conn).get_product_by_barcode("").unwrap();
    assert!(p.is_none());
}

#[test]
fn get_product_by_barcode_trims_input() {
    let conn = fresh();
    seed_everything(&conn);
    let p = store(&conn)
        .get_product_by_barcode("  5901234123457  ")
        .unwrap()
        .unwrap();
    assert_eq!(p.sku.as_str(), "FOOD-001");
}

#[test]
fn product_has_no_barcode_by_default() {
    let conn = fresh();
    seed_everything(&conn);
    let p = store(&conn).get_product("DRINK-001").unwrap().unwrap();
    assert!(p.product.barcode.is_none());
}

// ── get_stock / product_id_by_sku ────────────────────────────

#[test]
fn get_stock_for_existing_product() {
    let conn = fresh();
    seed_everything(&conn);
    let id = store(&conn)
        .product_id_by_sku("DRINK-001")
        .unwrap()
        .unwrap();
    let qty = store(&conn).get_stock(&id).unwrap();
    assert_eq!(qty, 50);
}

#[test]
fn get_stock_for_unstocked_product() {
    let conn = fresh();
    seed_everything(&conn);
    let id = store(&conn)
        .product_id_by_sku("DRINK-002")
        .unwrap()
        .unwrap();
    let qty = store(&conn).get_stock(&id).unwrap();
    assert_eq!(qty, 0, "unstocked product should return 0");
}

#[test]
fn product_id_by_sku_unknown() {
    let conn = fresh();
    let id = store(&conn).product_id_by_sku("NO-SKU").unwrap();
    assert!(id.is_none());
}

// ── Product Variant CRUD ─────────────────────────────────────

fn seed_product_variant_parent(conn: &Connection) {
    conn.execute_batch(
        "INSERT INTO products (id, sku, name, price_minor, currency, created_at, updated_at, price_updated_at) VALUES
            ('pv-parent', 'PARENT-001', 'Parent Product', 1000, 'USD', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');"
    ).unwrap();
}

#[test]
fn create_and_list_product_variants() {
    let conn = fresh();
    seed_product_variant_parent(&conn);
    let s = store(&conn);

    let v1 = ProductVariant {
        id: uuid::Uuid::now_v7().to_string(),
        parent_sku: "PARENT-001".into(),
        name: "Small".into(),
        sku: "PARENT-001-SMALL".into(),
        price: Some(price(800)),
        barcode: Some(foundation::Barcode::new("sm-barcode").unwrap()),
        sort_order: 1,
        is_active: true,
        created_at: "2025-01-01T00:00:00.000Z".into(),
        updated_at: "2025-01-01T00:00:00.000Z".into(),
    };

    let v2 = ProductVariant {
        id: uuid::Uuid::now_v7().to_string(),
        parent_sku: "PARENT-001".into(),
        name: "Large".into(),
        sku: "PARENT-001-LARGE".into(),
        price: Some(price(1200)),
        barcode: None,
        sort_order: 2,
        is_active: true,
        created_at: "2025-01-01T00:00:00.000Z".into(),
        updated_at: "2025-01-01T00:00:00.000Z".into(),
    };

    s.create_product_variant(&v1).unwrap();
    s.create_product_variant(&v2).unwrap();

    let variants = s.list_product_variants("PARENT-001").unwrap();
    assert_eq!(variants.len(), 2);
    assert_eq!(variants[0].sku, "PARENT-001-SMALL");
    assert_eq!(variants[1].sku, "PARENT-001-LARGE");

    // Verify price and barcode on first variant.
    assert_eq!(variants[0].price.unwrap().minor_units, 800);
    assert_eq!(
        variants[0].barcode.as_ref().map(|b| b.as_str()),
        Some("sm-barcode")
    );
    assert!(variants[0].is_active);
}

#[test]
fn list_product_variants_empty() {
    let conn = fresh();
    seed_product_variant_parent(&conn);
    let variants = store(&conn).list_product_variants("PARENT-001").unwrap();
    assert!(variants.is_empty());
}

#[test]
fn get_product_variant_found() {
    let conn = fresh();
    seed_product_variant_parent(&conn);
    let s = store(&conn);
    let v = ProductVariant {
        id: uuid::Uuid::now_v7().to_string(),
        parent_sku: "PARENT-001".into(),
        name: "Medium".into(),
        sku: "PARENT-001-MED".into(),
        price: None,
        barcode: None,
        sort_order: 1,
        is_active: true,
        created_at: "2025-01-01T00:00:00.000Z".into(),
        updated_at: "2025-01-01T00:00:00.000Z".into(),
    };
    s.create_product_variant(&v).unwrap();

    let found = s.get_product_variant("PARENT-001-MED").unwrap().unwrap();
    assert_eq!(found.name, "Medium");
    assert!(found.price.is_none());
}

#[test]
fn get_product_variant_not_found() {
    let conn = fresh();
    let found = store(&conn).get_product_variant("NO-VARIANT").unwrap();
    assert!(found.is_none());
}

#[test]
fn update_product_variant() {
    let conn = fresh();
    seed_product_variant_parent(&conn);
    let s = store(&conn);
    let v = ProductVariant {
        id: uuid::Uuid::now_v7().to_string(),
        parent_sku: "PARENT-001".into(),
        name: "Original".into(),
        sku: "VAR-001".into(),
        price: Some(price(500)),
        barcode: Some(foundation::Barcode::new("orig").unwrap()),
        sort_order: 1,
        is_active: true,
        created_at: "2025-01-01T00:00:00.000Z".into(),
        updated_at: "2025-01-01T00:00:00.000Z".into(),
    };
    s.create_product_variant(&v).unwrap();

    let updated_v = ProductVariant {
        name: "Updated".into(),
        sku: "VAR-001".into(),
        price: Some(price(600)),
        barcode: Some(foundation::Barcode::new("new-barcode").unwrap()),
        sort_order: 2,
        is_active: false,
        ..v
    };
    s.update_product_variant(&updated_v).unwrap();

    let found = s.get_product_variant("VAR-001").unwrap().unwrap();
    assert_eq!(found.name, "Updated");
    assert_eq!(found.price.unwrap().minor_units, 600);
    assert!(!found.is_active);
}

#[test]
fn update_product_variant_not_found() {
    let conn = fresh();
    let s = store(&conn);
    let v = ProductVariant {
        id: "vid".into(),
        parent_sku: "P".into(),
        name: "X".into(),
        sku: "NO-SKU".into(),
        price: None,
        barcode: None,
        sort_order: 0,
        is_active: true,
        created_at: String::new(),
        updated_at: String::new(),
    };
    let err = s.update_product_variant(&v).unwrap_err();
    assert!(matches!(err, CoreError::NotFound { entity, .. } if entity == "product_variant"));
}

#[test]
fn delete_product_variant_removes() {
    let conn = fresh();
    seed_product_variant_parent(&conn);
    let s = store(&conn);
    let v = ProductVariant {
        id: uuid::Uuid::now_v7().to_string(),
        parent_sku: "PARENT-001".into(),
        name: "Delete Me".into(),
        sku: "VAR-TO-DEL".into(),
        price: None,
        barcode: None,
        sort_order: 0,
        is_active: true,
        created_at: String::new(),
        updated_at: String::new(),
    };
    s.create_product_variant(&v).unwrap();
    s.delete_product_variant("VAR-TO-DEL").unwrap();
    let found = s.get_product_variant("VAR-TO-DEL").unwrap();
    assert!(found.is_none());
}

#[test]
fn delete_product_variant_not_found() {
    let conn = fresh();
    let err = store(&conn).delete_product_variant("NO-SKU").unwrap_err();
    assert!(matches!(err, CoreError::NotFound { entity, .. } if entity == "product_variant"));
}

#[test]
fn variant_price_as_none() {
    let conn = fresh();
    seed_product_variant_parent(&conn);
    let s = store(&conn);
    let v = ProductVariant {
        id: uuid::Uuid::now_v7().to_string(),
        parent_sku: "PARENT-001".into(),
        name: "No Price".into(),
        sku: "VAR-NO-PRICE".into(),
        price: None,
        barcode: None,
        sort_order: 0,
        is_active: true,
        created_at: "2025-01-01T00:00:00.000Z".into(),
        updated_at: "2025-01-01T00:00:00.000Z".into(),
    };
    s.create_product_variant(&v).unwrap();
    let found = s.get_product_variant("VAR-NO-PRICE").unwrap().unwrap();
    assert!(found.price.is_none());
}

// ── Stock Movements Delta Ledger (ADR #6) ───────────────────

#[test]
fn stock_movements_table_exists() {
    let conn = fresh();
    let exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='stock_movements'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        exists, 1,
        "stock_movements table should exist after migration"
    );
}

#[test]
fn stock_summary_table_exists() {
    let conn = fresh();
    let exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='stock_summary'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        exists, 1,
        "stock_summary table should exist after migration"
    );
}

#[test]
fn adjust_stock_writes_to_ledger() {
    let conn = fresh();
    seed_everything(&conn);

    let s = store(&conn);
    let tx = conn.unchecked_transaction().unwrap();
    let loc = crate::inventory::LocationId::from(crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID);
    s.adjust_stock_at_location_with_reason(
        &tx,
        "DRINK-001",
        -3,
        &loc,
        Some("sale"),
        None,
        Some(&crate::terminal::TerminalId::from("term-1")),
        Some(&crate::user::UserId::from("user-1")),
    )
    .unwrap();
    tx.commit().unwrap();

    // Verify ledger row was written.
    let movements = store(&conn).list_stock_movements("prod-1", 10, 0).unwrap();
    assert_eq!(movements.len(), 1);
    assert_eq!(movements[0].delta, -3);
    assert_eq!(movements[0].reason.as_deref(), Some("sale"));
    assert_eq!(movements[0].item_id, "prod-1");
}

#[test]
fn adjust_stock_without_reason_writes_to_ledger() {
    let conn = fresh();
    seed_everything(&conn);

    adjust_stock(&store(&conn), &conn, "DRINK-001", 5).unwrap();

    let movements = store(&conn).list_stock_movements("prod-1", 10, 0).unwrap();
    assert_eq!(movements.len(), 1);
    assert_eq!(movements[0].delta, 5);
    assert!(movements[0].reason.is_none());
}

#[test]
fn get_stock_from_ledger_computes_sum() {
    let conn = fresh();
    seed_everything(&conn);

    // The migration backfill runs against empty inventory (before seed_everything),
    // so the ledger starts with no rows. get_stock_from_ledger falls back to
    // inventory.qty = 50.
    let initial = store(&conn).get_stock_from_ledger("prod-1").unwrap();
    assert_eq!(initial, 50, "fallback to inventory returns 50");

    // Adjustment writes a delta row. SUM(delta) = 10 (just the adjustment).
    adjust_stock(&store(&conn), &conn, "DRINK-001", 10).unwrap();
    let after = store(&conn).get_stock_from_ledger("prod-1").unwrap();
    assert_eq!(after, 10, "SUM(delta) should be 10 (only adjustment row)");

    // Multiple adjustments accumulate.
    adjust_stock(&store(&conn), &conn, "DRINK-001", -5).unwrap();
    adjust_stock(&store(&conn), &conn, "DRINK-001", 20).unwrap();
    let after2 = store(&conn).get_stock_from_ledger("prod-1").unwrap();
    assert_eq!(after2, 25, "SUM of deltas: 10 + (-5) + 20 = 25");
}

#[test]
fn get_stock_from_ledger_zero_deltas() {
    let conn = fresh();
    // fresh DB has no products, so ledger should have no rows.
    // Fallback to inventory table returns 0.
    let qty = store(&conn).get_stock_from_ledger("nonexistent").unwrap();
    assert_eq!(qty, 0);
}
#[test]
fn list_stock_movements_paginated() {
    let conn = fresh();
    seed_everything(&conn);

    // Write 5 movements (migration backfill ran against empty inventory,
    // so only these 5 adjust_stock calls create rows).
    for _i in 0..5 {
        let s = store(&conn);
        let tx = conn.unchecked_transaction().unwrap();
        let loc =
            crate::inventory::LocationId::from(crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID);
        s.adjust_stock_at_location_with_reason(
            &tx,
            "DRINK-001",
            1,
            &loc,
            Some("restock"),
            None,
            Some(&crate::terminal::TerminalId::from("term-1")),
            Some(&crate::user::UserId::from("user-1")),
        )
        .unwrap();
        tx.commit().unwrap();
    }

    // With limit 3, should return 3 most recent.
    let page1 = store(&conn).list_stock_movements("prod-1", 3, 0).unwrap();
    assert_eq!(page1.len(), 3);

    // With offset 3, should return remaining 2.
    let page2 = store(&conn).list_stock_movements("prod-1", 10, 3).unwrap();
    assert_eq!(page2.len(), 2);
}

#[test]
fn adjust_stock_writes_source_audit_fields() {
    let conn = fresh();
    seed_everything(&conn);

    let s = store(&conn);
    let tx = conn.unchecked_transaction().unwrap();
    let loc = crate::inventory::LocationId::from(crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID);
    s.adjust_stock_at_location_with_reason(
        &tx,
        "DRINK-001",
        -5,
        &loc,
        Some("sale"),
        None,
        Some(&crate::terminal::TerminalId::from("term-kitchen")),
        Some(&crate::user::UserId::from("user-alice")),
    )
    .unwrap();
    tx.commit().unwrap();

    let movements = store(&conn).list_stock_movements("prod-1", 1, 0).unwrap();
    assert_eq!(movements.len(), 1);
    assert_eq!(
        movements[0].source_terminal_id.as_deref(),
        Some("term-kitchen")
    );
    assert_eq!(movements[0].source_user_id.as_deref(), Some("user-alice"));
    assert_eq!(movements[0].delta, -5);
    assert_eq!(movements[0].reason.as_deref(), Some("sale"));
}

#[test]
fn adjust_stock_without_source_audit_stores_nulls() {
    let conn = fresh();
    seed_everything(&conn);

    // adjust_stock_at_location_with_reason passes None for audit fields.
    adjust_stock(&store(&conn), &conn, "DRINK-001", 10).unwrap();

    let movements = store(&conn).list_stock_movements("prod-1", 1, 0).unwrap();
    assert_eq!(movements.len(), 1);
    assert_eq!(movements[0].source_terminal_id, None);
    assert_eq!(movements[0].source_user_id, None);
}

#[test]
fn rebuild_stock_summary_from_ledger() {
    let conn = fresh();
    seed_everything(&conn);

    // Insert deltas that bypass the normal adjust_stock path
    // (simulating external sync deltas).
    conn.execute_batch(
        "INSERT INTO stock_movements (id, item_id, delta, reason, created_at) VALUES
            ('sm-1', 'prod-1', 50, 'migration-seed', '2025-01-01T00:00:00.000Z'),
            ('sm-2', 'prod-1', -10, 'sale', '2025-01-02T00:00:00.000Z'),
            ('sm-3', 'prod-2', 100, 'restock', '2025-01-01T00:00:00.000Z'),
            ('sm-4', 'prod-2', -25, 'sale', '2025-01-02T00:00:00.000Z');",
    )
    .unwrap();

    let count = store(&conn).rebuild_stock_summary().unwrap();
    assert_eq!(count, 2, "should rebuild 2 product stock levels");

    // Verify stock_summary was rebuilt.
    let qty1: i64 = conn
        .query_row(
            "SELECT qty FROM stock_summary WHERE item_id = 'prod-1'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(qty1, 40, "prod-1: 50 + (-10) = 40");

    let qty2: i64 = conn
        .query_row(
            "SELECT qty FROM stock_summary WHERE item_id = 'prod-2'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(qty2, 75, "prod-2: 100 + (-25) = 75");

    // Verify inventory was synced.
    let inv1 = store(&conn).get_stock("prod-1").unwrap();
    assert_eq!(inv1, 40);
    let inv2 = store(&conn).get_stock("prod-2").unwrap();
    assert_eq!(inv2, 75);
}

#[test]
fn rebuild_stock_summary_empty_ledger() {
    let conn = fresh();

    // Rebuild on a fresh DB with no movements.
    let count = store(&conn).rebuild_stock_summary().unwrap();
    assert_eq!(count, 0, "no rows to rebuild");

    // stock_summary should be empty.
    let rows: i64 = conn
        .query_row("SELECT COUNT(*) FROM stock_summary", [], |r| r.get(0))
        .unwrap();
    assert_eq!(rows, 0);
}

/// ADR-19 §15 criterion 19-1: rebuild_stock_summary() aggregates per
/// (item_id, location_id), not per item_id alone. This test seeds stock
/// movements in TWO different locations for the same SKU and asserts the
/// rebuild produces TWO stock_summary rows (one per location) instead of
/// single aggregated row at the canonical default UUID (the dormant
/// bug pre-refactor).
#[test]
fn rebuild_stock_summary_aggregates_per_location() {
    let conn = fresh();
    seed_everything(&conn);
    let canonical = crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID;
    let transit = "01926b3a-0000-7000-8000-000000000002";
    let s = store(&conn);

    // Seed stock_movements in two locations for the same SKU (prod-1).
    // Pre-refactor these would collapse into ONE stock_summary row at
    // canonical with qty=80; post-refactor they must produce TWO rows.
    conn.execute_batch(&format!(
        "INSERT INTO stock_movements (id, item_id, delta, reason,\n                                          source_terminal_id, source_user_id,\n                                          store_id, created_at, location_id)\n             VALUES ('mv-loc-c', 'prod-1',  30, 'restock', NULL, NULL, '', '2025-01-01T00:00:00.000Z', '{canonical}'),\n                    ('mv-loc-t', 'prod-1',  50, 'restock', NULL, NULL, '', '2025-01-01T00:00:00.000Z', '{transit}'),\n                    ('mv-loc-c2','prod-2',  12, 'restock', NULL, NULL, '', '2025-01-01T00:00:00.000Z', '{canonical}')"
    ))
    .unwrap();

    let count = s.rebuild_stock_summary().unwrap();
    assert_eq!(
        count, 3,
        "three (item_id, location_id) tuples should be rebuilt, got {count}"
    );

    // Verify TWO rows for prod-1: per-location qty breakdown.
    let canonical_qty: i64 = conn
        .query_row(
            "SELECT qty FROM stock_summary WHERE item_id = 'prod-1' AND location_id = ?1",
            params![canonical],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        canonical_qty, 30,
        "canonical default location must hold 30, got {canonical_qty}"
    );

    let transit_qty: i64 = conn
        .query_row(
            "SELECT qty FROM stock_summary WHERE item_id = 'prod-1' AND location_id = ?1",
            params![transit],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        transit_qty, 50,
        "transit location must hold 50 (NOT aggregated to 80), got {transit_qty}"
    );

    // Single canonical-only row for prod-2.
    let prod2_qty: i64 = conn
        .query_row(
            "SELECT qty FROM stock_summary WHERE item_id = 'prod-2' AND location_id = ?1",
            params![canonical],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(prod2_qty, 12, "prod-2 canonical row must hold 12");

    // Verify NO aggregated single row at wrong total of 80 somewhere.
    let total: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(qty), 0) FROM stock_summary WHERE item_id = 'prod-1'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        total, 80,
        "sum across locations must equal 80, but row count must be 2 not 1"
    );

    let prod1_row_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM stock_summary WHERE item_id = 'prod-1'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        prod1_row_count, 2,
        "prod-1 must have exactly 2 stock_summary rows (one per location), got {prod1_row_count}"
    );
}

// ── Archive Stock Movements (ADR #6 Q4) ─────────────────────

#[test]
fn archive_movements_table_exists() {
    let conn = fresh();
    let exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='stock_movements_archive'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        exists, 1,
        "stock_movements_archive table should exist after migration 072"
    );
}

#[test]
fn archive_movements_empty_db_returns_zero() {
    let conn = fresh();
    let count = store(&conn).archive_stock_movements(90, 50).unwrap();
    assert_eq!(count, 0, "no rows to archive in empty DB");
}

#[test]
fn archive_movements_no_old_rows_returns_zero() {
    let conn = fresh();
    seed_everything(&conn);
    // Write a recent movement.
    adjust_stock(&store(&conn), &conn, "DRINK-001", 5).unwrap();

    // All rows are recent — nothing to archive.
    let count = store(&conn).archive_stock_movements(90, 50).unwrap();
    assert_eq!(count, 0);

    // Live table still has the adjustment row.
    let movements = store(&conn).list_stock_movements("prod-1", 10, 0).unwrap();
    assert_eq!(movements.len(), 1);
    assert_eq!(movements[0].delta, 5);
}

#[test]
fn archive_movements_creates_rollup_row() {
    let conn = fresh();
    seed_everything(&conn);
    let s = store(&conn);

    // Insert old rows by manually setting created_at.
    conn.execute_batch(
        "INSERT INTO stock_movements (id, item_id, delta, reason, store_id, created_at) VALUES
            ('sm-old-1', 'prod-1', 30, 'restock', '', '2020-01-01T00:00:00Z'),
            ('sm-old-2', 'prod-1', -5, 'sale',    '', '2020-02-01T00:00:00Z'),
            ('sm-old-3', 'prod-1', 10, 'restock', '', '2020-03-01T00:00:00Z');",
    )
    .unwrap();

    // Archive with 30-day window (all rows are "old").
    let count = s.archive_stock_movements(30, 50).unwrap();
    assert_eq!(count, 1, "one item group archived");

    // Live table should have one rollup row.
    let movements = s.list_stock_movements("prod-1", 10, 0).unwrap();
    assert_eq!(movements.len(), 1, "one rollup row in live table");
    assert_eq!(movements[0].reason.as_deref(), Some("archive-rollup"));
    assert_eq!(
        movements[0].delta, 35,
        "SUM(old deltas) = 30 + (-5) + 10 = 35"
    );

    // Archive table should have the 3 old rows.
    let archived: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM stock_movements_archive WHERE item_id = 'prod-1'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(archived, 3, "three old rows archived");

    // SUM(delta) from live table should equal SUM(delta) of original rows.
    let from_ledger = s.get_stock_from_ledger("prod-1").unwrap();
    assert_eq!(from_ledger, 35, "SUM(delta) preserved via rollup");
}

#[test]
fn archive_movements_preserves_recent_rows() {
    let conn = fresh();
    seed_everything(&conn);
    let s = store(&conn);

    // Mix of old and new rows.
    conn.execute_batch(
        "INSERT INTO stock_movements (id, item_id, delta, reason, store_id, created_at) VALUES
            ('sm-old-1', 'prod-1', 50, 'restock', '', '2020-01-01T00:00:00Z'),
            ('sm-old-2', 'prod-1', -10, 'sale',    '', '2020-02-01T00:00:00Z');",
    )
    .unwrap();
    // New row via normal API (gets current timestamp).
    adjust_stock(&s, &conn, "DRINK-001", 5).unwrap();

    let count = s.archive_stock_movements(30, 50).unwrap();
    assert_eq!(count, 1, "one item group archived");

    let movements = s.list_stock_movements("prod-1", 10, 0).unwrap();
    // Should have: 1 recent adjustment + 1 rollup = 2 rows.
    assert_eq!(movements.len(), 2);

    let rollup = movements
        .iter()
        .find(|m| m.reason.as_deref() == Some("archive-rollup"))
        .unwrap();
    assert_eq!(rollup.delta, 40, "SUM of archived deltas = 50 + (-10) = 40");

    let recent = movements
        .iter()
        .find(|m| m.reason.as_deref() != Some("archive-rollup"))
        .unwrap();
    assert_eq!(recent.delta, 5, "recent delta untouched");

    // SUM from ledger = rollup + recent = 40 + 5 = 45.
    let from_ledger = s.get_stock_from_ledger("prod-1").unwrap();
    assert_eq!(from_ledger, 45);
}

#[test]
fn archive_movements_idempotent() {
    let conn = fresh();
    seed_everything(&conn);
    let s = store(&conn);

    conn.execute_batch(
        "INSERT INTO stock_movements (id, item_id, delta, reason, store_id, created_at) VALUES
            ('sm-old-1', 'prod-1', 20, 'restock', '', '2020-01-01T00:00:00Z');",
    )
    .unwrap();

    // First archive creates the rollup.
    let first = s.archive_stock_movements(30, 50).unwrap();
    assert_eq!(first, 1);

    // Second archive should be a no-op (rollup excluded from archiving).
    let second = s.archive_stock_movements(30, 50).unwrap();
    assert_eq!(second, 0, "no new groups to archive");

    let movements = s.list_stock_movements("prod-1", 10, 0).unwrap();
    assert_eq!(movements.len(), 1, "still one rollup row");
    assert_eq!(movements[0].delta, 20);
}

#[test]
fn archive_movements_respects_max_groups() {
    let conn = fresh();
    seed_everything(&conn);
    let s = store(&conn);

    // Insert old rows for two products.
    conn.execute_batch(
        "INSERT INTO stock_movements (id, item_id, delta, reason, store_id, created_at) VALUES
            ('sm-old-a', 'prod-1', 10, 'restock', '', '2020-01-01T00:00:00Z'),
            ('sm-old-b', 'prod-2', 20, 'restock', '', '2020-01-01T00:00:00Z');",
    )
    .unwrap();

    // Cap at 1 group — should only archive prod-1.
    let count = s.archive_stock_movements(30, 1).unwrap();
    assert_eq!(count, 1, "only one group archived (capped)");

    // Second call picks up remaining group.
    let count2 = s.archive_stock_movements(30, 50).unwrap();
    assert_eq!(count2, 1, "second group archived");
}

#[test]
fn archive_movements_does_not_archive_rollup_rows() {
    let conn = fresh();
    seed_everything(&conn);
    let s = store(&conn);

    // Insert old rows.
    conn.execute_batch(
        "INSERT INTO stock_movements (id, item_id, delta, reason, store_id, created_at) VALUES
            ('sm-old-1', 'prod-1', 50, 'restock', '', '2020-01-01T00:00:00Z');",
    )
    .unwrap();

    // Archive once.
    s.archive_stock_movements(30, 50).unwrap();

    // Verify the rollup row is not in the archive table.
    let rollup_in_archive: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM stock_movements_archive WHERE reason = 'archive-rollup'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(rollup_in_archive, 0, "rollup rows are never archived");

    // The original old row IS in the archive.
    let old_in_archive: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM stock_movements_archive WHERE id = 'sm-old-1'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(old_in_archive, 1, "old row preserved in archive");
}

#[test]
fn archive_movements_zero_sum_creates_rollup_with_zero() {
    let conn = fresh();
    seed_everything(&conn);
    let s = store(&conn);

    // Rows that cancel out: 50 + (-30) + (-20) = 0.
    conn.execute_batch(
        "INSERT INTO stock_movements (id, item_id, delta, reason, store_id, created_at) VALUES
            ('sm-zero-1', 'prod-1', 50,  'restock', '', '2020-01-01T00:00:00Z'),
            ('sm-zero-2', 'prod-1', -30, 'sale',    '', '2020-02-01T00:00:00Z'),
            ('sm-zero-3', 'prod-1', -20, 'sale',    '', '2020-03-01T00:00:00Z');",
    )
    .unwrap();

    s.archive_stock_movements(30, 50).unwrap();

    let movements = s.list_stock_movements("prod-1", 10, 0).unwrap();
    assert_eq!(movements.len(), 1);
    assert_eq!(
        movements[0].delta, 0,
        "rollup delta = 0 for net-zero deltas"
    );

    let from_ledger = s.get_stock_from_ledger("prod-1").unwrap();
    assert_eq!(from_ledger, 0);
}

#[test]
fn stock_summary_tracks_latest_quantity() {
    let conn = fresh();
    seed_everything(&conn);

    // Migration backfill ran against empty inventory, so stock_summary starts empty.
    // After the first adjust_stock call, the summary row is created.
    adjust_stock(&store(&conn), &conn, "DRINK-001", 20).unwrap();
    let qty: i64 = conn
        .query_row(
            "SELECT qty FROM stock_summary WHERE item_id = 'prod-1'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    // new_qty = previous_qty (50 from inventory) + 20 = 70
    assert_eq!(
        qty, 70,
        "stock_summary should reflect current total after adjustment"
    );

    // Second adjustment updates the summary.
    adjust_stock(&store(&conn), &conn, "DRINK-001", -10).unwrap();
    let qty2: i64 = conn
        .query_row(
            "SELECT qty FROM stock_summary WHERE item_id = 'prod-1'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(qty2, 60);
}

// ── ADR-19 §15 criterion 19-2: per-location stock adjustment core API ──

/// `adjust_stock_at_location_with_reason` deducts exact available qty to zero
/// without returning the `InsufficientStockAtLocation` variant.
/// (ADR-19 §16.2 — `adjust_stock_at_location_with_reason_deducts_to_zero`.)
#[test]
fn adjust_stock_at_location_with_reason_deducts_to_zero() {
    let conn = fresh();
    seed_everything(&conn);
    let s = store(&conn);
    let loc = crate::inventory::LocationId::from(crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID);

    // DRINK-001 seeded at qty=50 by `seed_everything`.
    let tx = conn.unchecked_transaction().unwrap();
    let new_qty = s
        .adjust_stock_at_location_with_reason(
            &tx,
            "DRINK-001",
            -50,
            &loc,
            Some("sale"),
            None,
            None,
            None,
        )
        .unwrap();
    assert_eq!(new_qty, 0, "deducting exact qty should leave 0 stock");
    tx.commit().unwrap();

    let product_id = s.product_id_by_sku("DRINK-001").unwrap().unwrap();
    let summary_qty: i64 = conn
        .query_row(
            "SELECT qty FROM stock_summary WHERE item_id = ?1 AND location_id = ?2",
            rusqlite::params![product_id, loc.as_str()],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        summary_qty, 0,
        "stock_summary row should reflect on-disk post-update qty"
    );
}

/// `adjust_stock_at_location_with_reason` over-deducting returns
/// `CoreError::InsufficientStockAtLocation` with the original available qty.
/// (ADR-19 §16.2 — `adjust_stock_at_location_with_reason_insufficient_qty_errors`.)
#[test]
fn adjust_stock_at_location_with_reason_insufficient_qty_errors() {
    let conn = fresh();
    seed_everything(&conn);
    let s = store(&conn);
    let loc = crate::inventory::LocationId::from(crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID);

    let tx = conn.unchecked_transaction().unwrap();
    let err = s
        .adjust_stock_at_location_with_reason(
            &tx,
            "DRINK-001",
            -100,
            &loc,
            Some("sale"),
            None,
            None,
            None,
        )
        .unwrap_err();
    tx.rollback().unwrap();

    match err {
        CoreError::InsufficientStockAtLocation {
            sku,
            requested_delta,
            available_qty,
            ..
        } => {
            assert_eq!(sku, "DRINK-001");
            assert_eq!(requested_delta, -100);
            assert_eq!(
                available_qty, 50,
                "DRINK-001 is seeded at qty=50 by seed_everything"
            );
        }
        other => panic!("expected InsufficientStockAtLocation, got {other:?}"),
    }
}

// `adjust_stock_at_location_with_reason` with positive delta credits the
// location from zero — covers the restock path used by purchase-order
// receive + manual restock flows (ADR-19 §3.2 + §6 sale-void inverse).
// ── adjust_stock_batch tests (ADR-19 §3) ──────────────────

/// ADR-19 §16.2: empty batch is a no-op.
#[test]
fn adjust_stock_batch_empty_batch_returns_ok() {
    let conn = fresh();
    seed_everything(&conn);
    seed_for_canonical_test(&conn);
    let s = store(&conn);
    let tx = conn.unchecked_transaction().unwrap();
    s.adjust_stock_batch(&tx, &[], Some("sale"), None, None, None)
        .unwrap();
    tx.commit().unwrap();
}

/// ADR-19 §16.2: single deduction against sufficient stock.
#[test]
fn adjust_stock_batch_single_deduction_succeeds() {
    let conn = fresh();
    seed_everything(&conn);
    seed_for_canonical_test(&conn);
    let s = store(&conn);
    let tx = conn.unchecked_transaction().unwrap();
    s.adjust_stock_batch(
        &tx,
        &[crate::sale_deduction::StockDeduction {
            sku: "DRINK-001".into(),
            location_id: crate::inventory::LocationId::from(
                crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID,
            ),
            delta: -5,
        }],
        Some("sale"),
        None,
        None,
        None,
    )
    .unwrap();
    tx.commit().unwrap();
    let qty = s.get_stock("prod-1").unwrap();
    assert_eq!(qty, 45);
}

/// ADR-19 §16.2: split deduction across two locations succeeds.
#[test]
fn adjust_stock_batch_split_deduction_succeeds() {
    let conn = fresh();
    seed_everything(&conn);
    seed_for_canonical_test(&conn);
    // Create a second location so we can split.
    conn.execute_batch(
        "INSERT INTO inventory_locations (id, name, type) VALUES ('loc-wh-a', 'WH A', 'warehouse');
         INSERT INTO stock_summary (item_id, location_id, qty) VALUES ('prod-1', 'loc-wh-a', 100);",
    )
    .unwrap();
    let s = store(&conn);
    let tx = conn.unchecked_transaction().unwrap();
    s.adjust_stock_batch(
        &tx,
        &[
            crate::sale_deduction::StockDeduction {
                sku: "DRINK-001".into(),
                location_id: crate::inventory::LocationId::from(
                    crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID,
                ),
                delta: -10,
            },
            crate::sale_deduction::StockDeduction {
                sku: "DRINK-001".into(),
                location_id: crate::inventory::LocationId::from("loc-wh-a"),
                delta: -20,
            },
        ],
        Some("sale"),
        None,
        None,
        None,
    )
    .unwrap();
    tx.commit().unwrap();
    // Stock at canonical default: 50 - 10 = 40
    let default_qty: i64 = conn
        .query_row(
            "SELECT qty FROM stock_summary WHERE item_id = 'prod-1' AND location_id = ?1",
            rusqlite::params![crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(default_qty, 40);
    // Stock at WH A: 100 - 20 = 80
    let wh_qty: i64 = conn
        .query_row(
            "SELECT qty FROM stock_summary WHERE item_id = 'prod-1' AND location_id = 'loc-wh-a'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(wh_qty, 80);
}

/// ADR-19 §16.2: insufficient stock at one location errors on first shortfall.
#[test]
fn adjust_stock_batch_insufficient_stock_errors() {
    let conn = fresh();
    seed_everything(&conn);
    seed_for_canonical_test(&conn);
    let s = store(&conn);
    let tx = conn.unchecked_transaction().unwrap();
    let err = s
        .adjust_stock_batch(
            &tx,
            &[crate::sale_deduction::StockDeduction {
                sku: "DRINK-001".into(),
                location_id: crate::inventory::LocationId::from(
                    crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID,
                ),
                delta: -999,
            }],
            Some("sale"),
            None,
            None,
            None,
        )
        .unwrap_err();
    assert!(matches!(err, CoreError::InsufficientStockAtLocation { .. }));
    // Transaction should be rolled back — stock unchanged.
    tx.rollback().unwrap();
    let qty = s.get_stock("prod-1").unwrap();
    assert_eq!(qty, 50);
}

#[test]
fn adjust_stock_at_location_with_reason_credits_positive_delta() {
    let conn = fresh();
    seed_everything(&conn);
    let s = store(&conn);
    let loc = crate::inventory::LocationId::from(crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID);

    // DRINK-002 is seeded with no inventory row (qty=0).
    let tx = conn.unchecked_transaction().unwrap();
    let new_qty = s
        .adjust_stock_at_location_with_reason(
            &tx,
            "DRINK-002",
            25,
            &loc,
            Some("restock"),
            None,
            None,
            None,
        )
        .unwrap();
    assert_eq!(
        new_qty, 25,
        "restocking into an empty location should yield the credited qty"
    );
    tx.commit().unwrap();
}

// ── Synchronous alert engine tests (ADR-18 §9e) ────────────────

/// Helper: seed a product with some stock at the default location,
/// then create a stock_threshold row.
fn seed_with_threshold(
    conn: &rusqlite::Connection,
    product_id: &str,
    location_id: &str,
    threshold_qty: i64,
) -> String {
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let threshold_id = uuid::Uuid::now_v7().to_string();
    if location_id.is_empty() {
        conn.execute(
            "INSERT INTO stock_thresholds (id, product_id, location_id, threshold, enabled, created_at, updated_at)
             VALUES (?1, ?2, NULL, ?3, 1, ?4, ?4)",
            rusqlite::params![threshold_id, product_id, threshold_qty, now],
        ).unwrap();
    } else {
        conn.execute(
            "INSERT INTO stock_thresholds (id, product_id, location_id, threshold, enabled, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5)",
            rusqlite::params![threshold_id, product_id, location_id, threshold_qty, now],
        ).unwrap();
    }
    threshold_id
}

fn count_active_alerts(conn: &rusqlite::Connection, threshold_id: &str) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM stock_alert_events \
         WHERE threshold_id = ?1 AND status = 'active'",
        rusqlite::params![threshold_id],
        |row| row.get(0),
    )
    .unwrap_or(0)
}

fn count_resolved_alerts(conn: &rusqlite::Connection, threshold_id: &str) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM stock_alert_events \
         WHERE threshold_id = ?1 AND status = 'resolved'",
        rusqlite::params![threshold_id],
        |row| row.get(0),
    )
    .unwrap_or(0)
}

#[test]
fn threshold_triggers_alert_on_deduction_below_threshold() {
    let conn = fresh();
    seed_everything(&conn);
    let s = store(&conn);
    let loc = crate::inventory::LocationId::from(crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID);

    // FOOD-001 is seeded with 12 stock at default location.
    let prod_id = s.product_id_by_sku("FOOD-001").unwrap().unwrap();
    let tid = seed_with_threshold(
        &conn,
        &prod_id,
        crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID,
        10,
    );

    // Deduct 3 → qty goes to 9 which is below threshold 10.
    let tx = conn.unchecked_transaction().unwrap();
    s.adjust_stock_at_location_with_reason(
        &tx,
        "FOOD-001",
        -3,
        &loc,
        Some("sale"),
        None,
        None,
        None,
    )
    .unwrap();
    tx.commit().unwrap();

    // Verify alert was created.
    assert_eq!(
        count_active_alerts(&conn, &tid),
        1,
        "one active alert should exist when stock drops below threshold"
    );

    // Verify alert content.
    let alert: (String, i64, i64) = conn
        .query_row(
            "SELECT product_id, current_qty, threshold FROM stock_alert_events \
             WHERE threshold_id = ?1 AND status = 'active' LIMIT 1",
            rusqlite::params![tid],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_eq!(
        alert.0, prod_id,
        "alert should reference the correct product"
    );
    assert_eq!(alert.1, 9, "current_qty should be 9 after deduction");
    assert_eq!(alert.2, 10, "threshold should be 10");
}

#[test]
fn threshold_no_alert_when_above_threshold() {
    let conn = fresh();
    seed_everything(&conn);
    let s = store(&conn);
    let loc = crate::inventory::LocationId::from(crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID);

    let prod_id = s.product_id_by_sku("FOOD-001").unwrap().unwrap();
    let tid = seed_with_threshold(
        &conn,
        &prod_id,
        crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID,
        10,
    );

    // Deduct only 1 → qty goes to 11 which is still above threshold 10.
    let tx = conn.unchecked_transaction().unwrap();
    s.adjust_stock_at_location_with_reason(
        &tx,
        "FOOD-001",
        -1,
        &loc,
        Some("sale"),
        None,
        None,
        None,
    )
    .unwrap();
    tx.commit().unwrap();

    assert_eq!(
        count_active_alerts(&conn, &tid),
        0,
        "no alert when stock remains above threshold"
    );
}

#[test]
fn threshold_dedup_repeated_deduction_does_not_duplicate_alert() {
    let conn = fresh();
    seed_everything(&conn);
    let s = store(&conn);
    let loc = crate::inventory::LocationId::from(crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID);

    let prod_id = s.product_id_by_sku("FOOD-001").unwrap().unwrap();
    let tid = seed_with_threshold(
        &conn,
        &prod_id,
        crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID,
        10,
    );

    // First deduction below threshold.
    let tx = conn.unchecked_transaction().unwrap();
    s.adjust_stock_at_location_with_reason(
        &tx,
        "FOOD-001",
        -3,
        &loc,
        Some("sale"),
        None,
        None,
        None,
    )
    .unwrap();
    tx.commit().unwrap();

    assert_eq!(
        count_active_alerts(&conn, &tid),
        1,
        "first trigger creates one alert"
    );

    // Restock to go above threshold (alert gets resolved).
    let tx = conn.unchecked_transaction().unwrap();
    s.adjust_stock_at_location_with_reason(
        &tx,
        "FOOD-001",
        5,
        &loc,
        Some("restock"),
        None,
        None,
        None,
    )
    .unwrap();
    tx.commit().unwrap();

    // Deduct again to trigger below threshold (old alert was resolved,
    // new one is created — dedup doesn't block since previous is resolved).
    let tx = conn.unchecked_transaction().unwrap();
    s.adjust_stock_at_location_with_reason(
        &tx,
        "FOOD-001",
        -10,
        &loc,
        Some("sale"),
        None,
        None,
        None,
    )
    .unwrap();
    tx.commit().unwrap();

    assert_eq!(
        count_active_alerts(&conn, &tid),
        1,
        "only one active alert at a time after recreate cycle"
    );
}

#[test]
fn threshold_recovery_auto_resolves_alert() {
    let conn = fresh();
    seed_everything(&conn);
    let s = store(&conn);
    let loc = crate::inventory::LocationId::from(crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID);

    let prod_id = s.product_id_by_sku("FOOD-001").unwrap().unwrap();
    let tid = seed_with_threshold(
        &conn,
        &prod_id,
        crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID,
        10,
    );

    // Deduct 3 → qty=9 < 10 → active alert.
    let tx = conn.unchecked_transaction().unwrap();
    s.adjust_stock_at_location_with_reason(
        &tx,
        "FOOD-001",
        -3,
        &loc,
        Some("sale"),
        None,
        None,
        None,
    )
    .unwrap();
    tx.commit().unwrap();

    assert_eq!(count_active_alerts(&conn, &tid), 1);

    // Restock 5 → qty=14 >= 10 → auto-resolve.
    let tx = conn.unchecked_transaction().unwrap();
    s.adjust_stock_at_location_with_reason(
        &tx,
        "FOOD-001",
        5,
        &loc,
        Some("restock"),
        None,
        None,
        None,
    )
    .unwrap();
    tx.commit().unwrap();

    assert_eq!(
        count_active_alerts(&conn, &tid),
        0,
        "active alert should be resolved after stock recovers"
    );
    assert_eq!(
        count_resolved_alerts(&conn, &tid),
        1,
        "resolved alert should exist after stock recovers"
    );
}

#[test]
fn threshold_global_fallback_creates_alert() {
    let conn = fresh();
    seed_everything(&conn);
    let s = store(&conn);
    let loc = crate::inventory::LocationId::from(crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID);

    let prod_id = s.product_id_by_sku("FOOD-001").unwrap().unwrap();
    // No location-specific threshold — only global (location_id IS NULL).
    let tid = seed_with_threshold(&conn, &prod_id, "", 10);

    let tx = conn.unchecked_transaction().unwrap();
    s.adjust_stock_at_location_with_reason(
        &tx,
        "FOOD-001",
        -3,
        &loc,
        Some("sale"),
        None,
        None,
        None,
    )
    .unwrap();
    tx.commit().unwrap();

    assert_eq!(
        count_active_alerts(&conn, &tid),
        1,
        "global (location_id IS NULL) threshold should create an alert"
    );
}

#[test]
fn threshold_no_threshold_skips_alert() {
    let conn = fresh();
    seed_everything(&conn);
    let s = store(&conn);
    let loc = crate::inventory::LocationId::from(crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID);

    // Deduct to zero — no threshold configured → no alert.
    let tx = conn.unchecked_transaction().unwrap();
    s.adjust_stock_at_location_with_reason(
        &tx,
        "FOOD-001",
        -12,
        &loc,
        Some("sale"),
        None,
        None,
        None,
    )
    .unwrap();
    tx.commit().unwrap();

    let alert_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM stock_alert_events", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(
        alert_count, 0,
        "no alert should be created when no threshold is configured"
    );
}

#[test]
fn threshold_location_specific_takes_precedence_over_global() {
    let conn = fresh();
    seed_everything(&conn);
    let s = store(&conn);
    let loc = crate::inventory::LocationId::from(crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID);

    let prod_id = s.product_id_by_sku("FOOD-001").unwrap().unwrap();
    // Location-specific threshold = 5
    let _loc_tid = seed_with_threshold(
        &conn,
        &prod_id,
        crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID,
        5,
    );
    // Global threshold = 10
    let global_tid = seed_with_threshold(&conn, &prod_id, "", 10);

    // Deduct 7 → qty=5. Location-specific threshold is 5, so stock is NOT below it.
    // But global threshold is 10, so if the global fallback were used (qty=5 < 10), it would trigger.
    let tx = conn.unchecked_transaction().unwrap();
    s.adjust_stock_at_location_with_reason(
        &tx,
        "FOOD-001",
        -7,
        &loc,
        Some("sale"),
        None,
        None,
        None,
    )
    .unwrap();
    tx.commit().unwrap();

    // No alert because location-specific threshold (5) takes precedence and qty (5) >= 5.
    assert_eq!(
        count_active_alerts(&conn, &global_tid),
        0,
        "location-specific threshold should take precedence over global"
    );
}

// ── stock.negative event emission (ADR-18 §4) ────────────────────

/// A test-only Cache implementation that records calls to
/// `publish_negative_stock_event` in an `Arc<Mutex<Vec>>` so tests
/// can verify the event was emitted.
#[allow(clippy::type_complexity)]
struct TestNegativeEventCache {
    events: std::sync::Arc<std::sync::Mutex<Vec<(String, String, String, i64, i64)>>>,
}

impl TestNegativeEventCache {
    #[allow(clippy::type_complexity)]
    fn new() -> (
        Self,
        std::sync::Arc<std::sync::Mutex<Vec<(String, String, String, i64, i64)>>>,
    ) {
        let events = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        (
            Self {
                events: events.clone(),
            },
            events,
        )
    }
}

impl crate::cache::Cache for TestNegativeEventCache {
    fn get_product(&self, _sku: &str) -> Option<crate::db::ProductWithDetails> {
        None
    }
    fn set_product(&self, _sku: &str, _product: &crate::db::ProductWithDetails) {}
    fn invalidate_product(&self, _sku: &str) {}
    fn get_inventory(&self, _product_id: &str) -> Option<i64> {
        None
    }
    fn set_inventory(&self, _product_id: &str, _qty: i64) {}
    fn invalidate_inventory(&self, _product_id: &str) {}
    fn is_healthy(&self) -> bool {
        true
    }

    fn publish_negative_stock_event(
        &self,
        product_id: &str,
        sku: &str,
        location_id: &str,
        delta: i64,
        current_qty: i64,
        _terminal_id: Option<&str>,
    ) {
        if let Ok(mut events) = self.events.lock() {
            events.push((
                product_id.to_owned(),
                sku.to_owned(),
                location_id.to_owned(),
                delta,
                current_qty,
            ));
        }
    }
}

/// Helper: create a terminal bound to a workspace instance that allows
/// negative stock for the canonical default location.
///
/// The `terminals` schema in migration 016 does not include
/// `workspace_instance_id`; this helper uses ALTER TABLE to add it
/// (idempotent via IF NOT EXISTS check). A future migration should
/// ship the column in the base schema.
fn seed_allow_negative_terminal(conn: &rusqlite::Connection) -> String {
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let ws_inst_id = uuid::Uuid::now_v7().to_string();
    let term_id = uuid::Uuid::now_v7().to_string();
    let loc = crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID;

    // Add workspace_instance_id column if it doesn't exist yet.
    let col_exists: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('terminals') WHERE name = 'workspace_instance_id'")
        .and_then(|mut stmt| stmt.query_row([], |row| row.get::<_, i64>(0)).map(|c| c > 0))
        .unwrap_or(false);
    if !col_exists {
        conn.execute_batch(
            "ALTER TABLE terminals ADD COLUMN workspace_instance_id TEXT REFERENCES workspace_instances(id);"
        ).unwrap();
    }

    conn.execute_batch(&format!(
        "INSERT OR IGNORE INTO locations (id, name) VALUES ('store-neg', 'Neg Store');
         INSERT OR IGNORE INTO workspace_instances (id, type_key, location_id, name) \
           VALUES ('{ws}', (SELECT key FROM workspace_types LIMIT 1), 'store-neg', 'NegTest');
         INSERT OR IGNORE INTO workspace_inventory_locations \
           (id, instance_id, location_id, is_primary, allow_negative_stock, sort_order) \
           VALUES ('wsl-{ws}', '{ws}', '{loc}', 1, 1, 0);
         INSERT OR IGNORE INTO terminals (id, name, device_id, workspace_instance_id, created_at, updated_at) \
           VALUES ('{term}', 'NegTerm', '{term}-dev', '{ws}', '{now}', '{now}');",
        ws = ws_inst_id,
        term = term_id,
        loc = loc
    ))
    .unwrap();
    term_id
}

#[test]
fn negative_stock_event_fires_when_allow_negative_enabled() {
    let conn = fresh();
    seed_everything(&conn);
    let loc = crate::inventory::LocationId::from(crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID);

    // Create a terminal that allows negative stock for the default location.
    let term_id = seed_allow_negative_terminal(&conn);

    // Create cache and store with it.
    let (test_cache, recorded_events) = TestNegativeEventCache::new();
    let cache_arc: std::sync::Arc<dyn crate::cache::Cache> = std::sync::Arc::new(test_cache);
    let s = crate::db::Store::with_cache(&conn, cache_arc);

    // FOOD-001 is seeded at qty=12. Deduct 15 → new_qty=-3 (negative!).
    let tx = conn.unchecked_transaction().unwrap();
    let result = s.adjust_stock_at_location_with_reason(
        &tx,
        "FOOD-001",
        -15,
        &loc,
        Some("sale"),
        None,
        Some(&crate::terminal::TerminalId::from(term_id)),
        None,
    );
    // The deduction should succeed (allow_negative_stock = true).
    assert!(
        result.is_ok(),
        "deduction should succeed with allow_negative_stock=true: {:?}",
        result
    );
    assert_eq!(result.unwrap(), -3, "stock should go to -3");
    tx.commit().unwrap();

    // Verify the negative stock event was published.
    let events = recorded_events.lock().unwrap();
    assert_eq!(
        events.len(),
        1,
        "exactly one negative event should be emitted"
    );
    assert_eq!(events[0].1, "FOOD-001", "sku should match");
    assert_eq!(events[0].3, -15, "delta should be -15");
    assert_eq!(events[0].4, -3, "current_qty should be -3");
}

#[test]
fn negative_stock_event_not_fired_for_normal_deduction() {
    let conn = fresh();
    seed_everything(&conn);
    let loc = crate::inventory::LocationId::from(crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID);

    let (test_cache, recorded_events) = TestNegativeEventCache::new();
    let cache_arc: std::sync::Arc<dyn crate::cache::Cache> = std::sync::Arc::new(test_cache);
    let s = crate::db::Store::with_cache(&conn, cache_arc);

    // FOOD-001 has qty=12. Deduct 5 → new_qty=7 (still positive).
    let tx = conn.unchecked_transaction().unwrap();
    let result = s.adjust_stock_at_location_with_reason(
        &tx,
        "FOOD-001",
        -5,
        &loc,
        Some("sale"),
        None,
        None,
        None,
    );
    assert!(result.is_ok());
    tx.commit().unwrap();

    // No negative event should be emitted.
    let events = recorded_events.lock().unwrap();
    assert_eq!(events.len(), 0, "no negative event for positive qty");
}

// ── ADR #36: attribute roundtrip + stock total ──────────────────

#[test]
fn create_with_attributes_roundtrips_through_get_product() {
    let conn = fresh();
    let s = store(&conn);

    // default_supplier_id is an FK to suppliers (046) — seed the row.
    conn.execute(
        "INSERT INTO suppliers (id, code, name, created_at, updated_at) \
         VALUES ('sup-1', 'SUP-01', 'Supplier One', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
        [],
    )
    .unwrap();

    let attrs = CreateProductAttributes {
        cost_minor: 7500,
        brand: Some("Acme".into()),
        rack_location: Some("A-07".into()),
        notes: Some("Fragile — keep upright".into()),
        unit: Some("pcs".into()),
        is_active: false,
        default_supplier_id: Some("sup-1".into()),
    };
    let product = s
        .create_product_with_attributes(
            "ATTRIB-1",
            "Attribute Product",
            price(12000),
            None,
            None,
            0,
            Some("retail"),
            &attrs,
        )
        .unwrap();
    assert_eq!(product.cost_minor, 7500);
    assert_eq!(product.brand.as_deref(), Some("Acme"));
    assert_eq!(product.rack_location.as_deref(), Some("A-07"));
    assert_eq!(product.notes.as_deref(), Some("Fragile — keep upright"));
    assert_eq!(product.unit.as_deref(), Some("pcs"));
    assert!(!product.is_active);
    assert_eq!(product.default_supplier_id.as_deref(), Some("sup-1"));

    // Roundtrip through the DB read path.
    let fetched = s.get_product("ATTRIB-1").unwrap().unwrap();
    assert_eq!(fetched.product.cost_minor, 7500);
    assert_eq!(fetched.product.brand.as_deref(), Some("Acme"));
    assert_eq!(fetched.product.rack_location.as_deref(), Some("A-07"));
    assert_eq!(fetched.product.unit.as_deref(), Some("pcs"));
    assert!(!fetched.product.is_active);
}

#[test]
fn update_product_attributes_patch_clear_and_keep() {
    let conn = fresh();
    let s = store(&conn);
    s.create_product_with_attributes(
        "PATCH-1",
        "Patch Product",
        price(1000),
        None,
        None,
        0,
        Some("retail"),
        &CreateProductAttributes {
            brand: Some("KeepMe".into()),
            rack_location: Some("B-02".into()),
            ..Default::default()
        },
    )
    .unwrap();

    // PATCH: set brand (Some(Some)), clear rack (Some(None)), leave
    // cost/unit absent (None = keep).
    s.update_product_attributes(
        "PATCH-1",
        &UpdateProductAttributes {
            cost_minor: None,
            brand: Some(Some("Changed".into())),
            rack_location: Some(None),
            notes: None,
            unit: None,
            is_active: None,
            default_supplier_id: None,
        },
    )
    .unwrap();

    let fetched = s.get_product("PATCH-1").unwrap().unwrap();
    assert_eq!(fetched.product.brand.as_deref(), Some("Changed"));
    assert_eq!(fetched.product.rack_location, None, "rack must be cleared");
    assert_eq!(
        fetched.product.unit, None,
        "absent unit must keep (no change)"
    );

    // Clear brand too via Some(None) and deactivate.
    s.update_product_attributes(
        "PATCH-1",
        &UpdateProductAttributes {
            cost_minor: Some(888),
            brand: Some(None),
            rack_location: None,
            notes: None,
            unit: None,
            is_active: Some(false),
            default_supplier_id: None,
        },
    )
    .unwrap();
    let fetched = s.get_product("PATCH-1").unwrap().unwrap();
    assert_eq!(fetched.product.brand, None);
    assert_eq!(fetched.product.cost_minor, 888);
    assert!(!fetched.product.is_active);
}

#[test]
fn list_products_stock_is_sum_across_locations() {
    let conn = fresh();
    let s = store(&conn);
    let pid = s
        .create_product_with_attributes(
            "SUM-1",
            "Multi-Location Product",
            price(5000),
            None,
            None,
            0,
            Some("retail"),
            &CreateProductAttributes::default(),
        )
        .unwrap()
        .id;

    // Seed stock at three locations (10 + 4 + 1 = 15 total units).
    let wh_a = s
        .create_inventory_location("Warehouse A", "warehouse", "")
        .unwrap();
    let wh_b = s
        .create_inventory_location("Warehouse B", "warehouse", "")
        .unwrap();
    for (loc, qty) in [
        (crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID, 10i64),
        (wh_a.as_str(), 4i64),
        (wh_b.as_str(), 1i64),
    ] {
        conn.execute(
            "INSERT OR REPLACE INTO stock_summary (item_id, location_id, qty, updated_at) \
             VALUES (?1, ?2, ?3, '2025-01-01T00:00:00.000Z')",
            params![pid, loc, qty],
        )
        .unwrap();
    }

    let listed = s.list_products().unwrap();
    let sum = listed
        .iter()
        .find(|p| p.product.sku.as_str() == "SUM-1")
        .unwrap();
    assert_eq!(
        sum.stock_qty,
        Some(15),
        "stock column must total units across all locations (ADR #36 D3)"
    );
}

// ── Product quota (subscription-tiers.md §Numeric Limits) ─────────────

#[test]
fn tier_max_products_matches_published_contract() {
    use crate::subscription::SubscriptionTier;
    assert_eq!(SubscriptionTier::Free.max_products(), Some(200));
    assert_eq!(SubscriptionTier::Plus.max_products(), Some(500));
    assert_eq!(SubscriptionTier::Pro.max_products(), Some(1_000));
    assert_eq!(SubscriptionTier::Premium.max_products(), Some(10_000));
    assert_eq!(SubscriptionTier::Enterprise.max_products(), None);
}

#[test]
fn enforce_product_quota_allows_under_limit() {
    let conn = fresh();
    seed_everything(&conn);
    let store = Store::new(&conn);
    // 3 seeded products, Free cap is 200 — passes.
    store
        .enforce_product_quota(&crate::subscription::SubscriptionTier::Free)
        .expect("3 products must be under the Free 200 cap");
}

#[test]
fn enforce_product_quota_rejects_at_limit() {
    let conn = fresh();
    let store = Store::new(&conn);
    // Free cap is 200 — insert exactly 200 rows, then the next must fail.
    for i in 0..200 {
        store
            .create_product(
                &format!("SKU-{i:03}"),
                &format!("P{i}"),
                Money::zero(usd()),
                None,
                None,
                0,
                None,
            )
            .expect("insert under cap");
    }
    let err = store
        .enforce_product_quota(&crate::subscription::SubscriptionTier::Free)
        .expect_err("200 products must hit the Free cap");
    let msg = err.to_string();
    assert!(
        msg.contains("200 products"),
        "actionable message expected, got: {msg}"
    );
    assert!(msg.contains("Free"), "tier name expected, got: {msg}");
}

#[test]
fn enforce_product_quota_enterprise_unlimited() {
    let conn = fresh();
    let store = Store::new(&conn);
    for i in 0..210 {
        store
            .create_product(
                &format!("SKU-{i:03}"),
                &format!("P{i}"),
                Money::zero(usd()),
                None,
                None,
                0,
                None,
            )
            .expect("enterprise has no product cap");
    }
    store
        .enforce_product_quota(&crate::subscription::SubscriptionTier::Enterprise)
        .expect("Enterprise is unlimited");
}
