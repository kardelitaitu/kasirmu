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

/// A failed `is_active` read must REFUSE, not report the product as active.
///
/// `is_active: row.get::<_, i64>(18).unwrap_or(1) != 0` made a failed column read
/// mean "active" — the permissive direction, and the opposite of `track_serial` one
/// field up, which defaults to `0`. The mapper's own note at `image_hash` records the
/// general hazard: a failed read returns a silently wrong answer either way, so the
/// default must be one that cannot claim the product is sellable.
///
/// Dropping the column is the discriminating input: `products` loses `is_active` while
/// the rest of the row stays valid, so the assertion is about THIS read rather than
/// about a broken database. The table is rebuilt rather than altered because SQLite
/// cannot drop a column here, preserving every other column's position.
#[test]
fn a_failed_is_active_read_refuses_rather_than_reporting_active() {
    let conn = fresh();
    seed_product(&conn, "p-inactive", "SKU-INACT", "Widget", 1500, "USD");
    let repo = InventoryRepository::new(&conn);

    // Sanity first, so a failure below is caused by the removed column rather than
    // by a fixture that never worked.
    assert!(repo.get_product("p-inactive").unwrap().unwrap().is_active);

    conn.execute_batch(
        r#"ALTER TABLE products RENAME TO products_full;
CREATE TABLE products AS SELECT id, sku, name, price_minor, currency, category_id,
    barcode, created_at, updated_at, price_updated_at, track_serial, product_type,
    version, cost_minor, brand, rack_location, notes, unit, default_supplier_id,
    popularity_score, image_hash FROM products_full;"#,
    )
    .expect("rebuild products without is_active");

    let err = repo
        .get_product("p-inactive")
        .expect_err("a failed is_active read must not be reported as active");
    let msg = format!("{err:?}");
    assert!(
        msg.contains("is_active") || msg.contains("no such column"),
        "the refusal must name the real cause, got: {msg}"
    );
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

/// `image_hash` is read from index 21, the column the SELECT actually lists there.
///
/// The mapper is positional and the SELECT is 22 columns, with `popularity_score`
/// at 20 and `image_hash` LAST at 21. The pre-fix code read `row.get(20)` for
/// `image_hash`, so the DTO carried the product's popularity SCORE and the real
/// column was never read at all.
///
/// This survived because the two spellings agree on the existing fixtures:
/// `seed_product` sets neither column, so both return `None`, and nothing else in
/// this file asserts `image_hash`. The pin sets BOTH to distinct non-null values,
/// which is the only way the swap is observable, and asserts each lands on its own
/// field.
#[test]
fn get_product_reads_image_hash_from_its_own_column_not_the_popularity_score() {
    let conn = fresh();
    conn.execute(
        "INSERT INTO products (id, sku, name, price_minor, currency, product_type, version, is_active, created_at, updated_at, popularity_score, image_hash)
         VALUES ('p-img', 'IMG-SKU', 'Imaged', 100, 'USD', 'retail', 1, 1, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z', 42.5, 'deadbeef')
         ",
        [],
    )
    .unwrap();
    let repo = InventoryRepository::new(&conn);
    let p = repo.get_product("p-img").unwrap().unwrap();
    assert_eq!(
        p.image_hash.as_deref(),
        Some("deadbeef"),
        "image_hash must come from the image_hash column, not from popularity_score"
    );
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

// ── P3.2/P3.5: the repository is namespace-checked ──────────────────────

/// The wrap must not have widened the module's reach: its own table passes the
/// ownership check, a foreign table through the same handle is refused.
#[test]
fn the_repository_is_scoped_to_its_own_namespace() {
    use kasirmu_core::db::Store;
    use kasirmu_core::db::namespaced::{Grants, ModuleId, NamespaceError, NamespacedStore};

    let conn = fresh();
    let ns = NamespacedStore::new(Store::new(&conn), ModuleId("inventory"), Grants::none());

    ns.own()
        .query("SELECT 1 FROM products", [], |row| row.get::<_, i64>(0))
        .expect("inventory must be allowed to read its own table");

    let err = ns
        .own()
        .query("SELECT 1 FROM sales", [], |row| row.get::<_, i64>(0))
        .unwrap_err();
    assert!(
        matches!(err, NamespaceError::Foreign { ref table, .. } if table == "sales"),
        "expected Foreign on sales, got {err:?}"
    );
}

// NOTE: the get_stock/adjust_stock_tx pair
// `inventory.sku` and `inventory.low_stock_threshold`, columns the migrations do not
// carry, and had no caller left once InventoryService's wrappers went.
