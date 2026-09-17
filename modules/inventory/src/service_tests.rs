use super::*;

use rusqlite::Connection;

fn fresh() -> Connection {
    kasirmu_core::migrations::fresh_db()
}

fn seed_product(conn: &Connection, id: &str, sku: &str, name: &str, price: i64) {
    conn.execute(
        "INSERT INTO products (id, sku, name, price_minor, currency, product_type, version, is_active, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 'USD', 'retail', 1, 1, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
        rusqlite::params![id, sku, name, price],
    )
    .unwrap();
}

#[test]
fn get_product_delegates_to_repository() {
    let conn = fresh();
    seed_product(&conn, "p-1", "SKU-1", "Widget", 1500);
    let result = InventoryService::get_product(&conn, "p-1").unwrap();
    let p = result.unwrap();
    assert_eq!(p.sku.as_str(), "SKU-1");
    assert_eq!(p.name, "Widget");
}

#[test]
fn get_product_missing_returns_none() {
    let conn = fresh();
    assert!(
        InventoryService::get_product(&conn, "nope")
            .unwrap()
            .is_none()
    );
}

#[test]
fn get_product_returns_correct_price() {
    let conn = fresh();
    seed_product(&conn, "p-2", "SKU-2", "Expensive", 99999);
    let p = InventoryService::get_product(&conn, "p-2")
        .unwrap()
        .unwrap();
    assert_eq!(p.price.minor_units, 99999);
}

// NOTE: get_stock and adjust_stock depend on inventory.sku and
// inventory.low_stock_threshold columns which are planned-schema columns
// not yet in the current migration. Tests will be added when the
// migration is applied.
