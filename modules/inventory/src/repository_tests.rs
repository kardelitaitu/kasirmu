use super::*;

use rusqlite::Connection;

fn fresh() -> Connection {
    kasirmu_core::migrations::fresh_db()
}

fn seed_product(conn: &Connection, id: &str, sku: &str, name: &str, price: i64, currency: &str) {
    conn.execute(
        "INSERT INTO products (id, sku, name, price_minor, currency, product_type, version, is_active, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'retail', 1, 1, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
        rusqlite::params![id, sku, name, price, currency],
    )
    .unwrap();
}

#[test]
fn get_product_returns_none_for_missing_id() {
    let conn = fresh();
    let repo = InventoryRepository::new(&conn);
    assert!(repo.get_product("does-not-exist").unwrap().is_none());
}

#[test]
fn get_product_roundtrip() {
    let conn = fresh();
    seed_product(&conn, "p-1", "SKU-001", "Widget", 1500, "USD");
    let repo = InventoryRepository::new(&conn);

    let p = repo.get_product("p-1").unwrap().unwrap();
    assert_eq!(p.id, "p-1");
    assert_eq!(p.sku.as_str(), "SKU-001");
    assert_eq!(p.name, "Widget");
    assert_eq!(p.price.minor_units, 1500);
    assert_eq!(p.price.currency.to_string(), "USD");
    assert!(p.is_active);
}

#[test]
fn get_product_with_optional_fields() {
    let conn = fresh();
    conn.execute(
        "INSERT INTO products (id, sku, name, price_minor, currency, product_type, version, is_active, created_at, updated_at, cost_minor, brand, rack_location, notes, unit)
         VALUES ('p-opt', 'OPT-SKU', 'Optional', 100, 'USD', 'retail', 1, 1, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z', 750, 'BrandX', 'A-01', 'Some notes', 'pcs')",
        [],
    )
    .unwrap();
    let repo = InventoryRepository::new(&conn);
    let p = repo.get_product("p-opt").unwrap().unwrap();
    assert_eq!(p.cost_minor, 750);
    assert_eq!(p.brand.as_deref(), Some("BrandX"));
    assert_eq!(p.rack_location.as_deref(), Some("A-01"));
    assert_eq!(p.notes.as_deref(), Some("Some notes"));
    assert_eq!(p.unit.as_deref(), Some("pcs"));
}

#[test]
fn get_product_with_barcode() {
    let conn = fresh();
    conn.execute(
        "INSERT INTO products (id, sku, name, price_minor, currency, product_type, version, is_active, created_at, updated_at, barcode)
         VALUES ('p-bc', 'BC-SKU', 'Barcode', 100, 'USD', 'retail', 1, 1, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z', '1234567890128')",
        [],
    )
    .unwrap();
    let repo = InventoryRepository::new(&conn);
    let p = repo.get_product("p-bc").unwrap().unwrap();
    assert!(p.barcode.is_some());
}

#[test]
fn get_product_inactive() {
    let conn = fresh();
    conn.execute(
        "INSERT INTO products (id, sku, name, price_minor, currency, product_type, version, is_active, created_at, updated_at)
         VALUES ('p-inact', 'INACT', 'Inactive', 100, 'USD', 'retail', 1, 0, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
        [],
    )
    .unwrap();
    let repo = InventoryRepository::new(&conn);
    let p = repo.get_product("p-inact").unwrap().unwrap();
    assert!(!p.is_active);
}

#[test]
fn get_product_restaurant_type() {
    let conn = fresh();
    conn.execute(
        "INSERT INTO products (id, sku, name, price_minor, currency, product_type, version, is_active, created_at, updated_at)
         VALUES ('p-rest', 'REST-1', 'Meal', 5000, 'IDR', 'restaurant', 1, 1, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
        [],
    )
    .unwrap();
    let repo = InventoryRepository::new(&conn);
    let p = repo.get_product("p-rest").unwrap().unwrap();
    assert_eq!(p.product_type, ProductType::Restaurant);
}

#[test]
fn get_product_service_type() {
    let conn = fresh();
    conn.execute(
        "INSERT INTO products (id, sku, name, price_minor, currency, product_type, version, is_active, created_at, updated_at)
         VALUES ('p-svc', 'SVC-1', 'Service', 0, 'USD', 'service', 1, 1, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
        [],
    )
    .unwrap();
    let repo = InventoryRepository::new(&conn);
    let p = repo.get_product("p-svc").unwrap().unwrap();
    assert_eq!(p.product_type, ProductType::Service);
}

#[test]
fn get_product_unknown_type_defaults_to_retail() {
    let conn = fresh();
    conn.execute(
        "INSERT INTO products (id, sku, name, price_minor, currency, product_type, version, is_active, created_at, updated_at)
         VALUES ('p-unk', 'UNK-1', 'Unknown', 100, 'USD', 'nonexistent', 1, 1, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
        [],
    )
    .unwrap();
    let repo = InventoryRepository::new(&conn);
    let p = repo.get_product("p-unk").unwrap().unwrap();
    // Unknown product type defaults to Retail
    assert_eq!(p.product_type, ProductType::Retail);
}

#[test]
fn get_product_default_optional_fields_are_none() {
    let conn = fresh();
    seed_product(&conn, "p-min", "MIN-1", "Minimal", 50, "USD");
    let repo = InventoryRepository::new(&conn);
    let p = repo.get_product("p-min").unwrap().unwrap();
    assert!(p.barcode.is_none());
    assert!(p.brand.is_none());
    assert!(p.rack_location.is_none());
    assert!(p.notes.is_none());
    assert!(p.unit.is_none());
    assert!(p.default_supplier_id.is_none());
}

// NOTE: get_stock and adjust_stock_tx query `inventory.sku` and
// `inventory.low_stock_threshold` columns which do not exist in the
// current migration schema. These are planned-schema methods; their
// tests will be added once the migration is applied.
