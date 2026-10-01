use super::*;
use crate::migrations;

fn fresh() -> rusqlite::Connection {
    // `fresh_db` clones a pre-migrated snapshot with FKs ON but seeds no
    // provisioning rows; `seed_provisioned_baseline` adds the 'default'
    // location, the tenant/legal-entity and the default workspace instances
    // that `workspace_instances.location_id` and `.instance_id` reference.
    let conn = migrations::fresh_db();
    migrations::seed_provisioned_baseline(&conn);
    conn
}

fn tx(conn: &mut rusqlite::Connection) -> rusqlite::Transaction<'_> {
    conn.transaction().unwrap()
}

fn seed_product(conn: &rusqlite::Connection, id: &str, sku: &str, ptype: &str) {
    conn.execute(
        "INSERT INTO products (id, sku, name, price_minor, currency, product_type)
         VALUES (?1, ?2, ?2, 1000, 'USD', ?3)",
        rusqlite::params![id, sku, ptype],
    )
    .unwrap();
}

/// The base migration seeds two system locations; the first is the canonical
/// default. Return that id so a caller can hang stock off it.
const DEFAULT_LOCATION: &str = "01926b3a-0000-7000-8000-000000000001";

/// `stock_summary.location_id` references `inventory_locations(id)`, so create a
/// real location rather than reusing an arbitrary string.
fn seed_location(conn: &rusqlite::Connection, id: &str) {
    conn.execute(
        "INSERT INTO inventory_locations (id, name, type, description)
         VALUES (?1, ?1, 'store', '')",
        rusqlite::params![id],
    )
    .unwrap();
}

/// `workspace_inventory_locations.location_id` and `.instance_id` reference
/// real rows, so seed the workspace type, its instance and a bound location.
fn seed_workspace_instance(conn: &rusqlite::Connection, instance: &str, location: &str) {
    conn.execute(
        "INSERT OR IGNORE INTO workspace_types (key, name) VALUES ('retail', 'Retail POS')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO workspace_instances (id, type_key, location_id, name)
         VALUES (?1, 'retail', 'default', ?1)",
        rusqlite::params![instance],
    )
    .unwrap();
    // Bind the inventory location to the instance so the FK holds.
    conn.execute(
        "INSERT INTO workspace_inventory_locations
             (id, instance_id, location_id, is_primary, allow_negative_stock, sort_order)
         VALUES (?1, ?2, ?3, 0, 0, 0)",
        rusqlite::params![format!("{instance}-{location}"), instance, location],
    )
    .unwrap();
}

#[test]
fn product_info_by_sku_returns_id_and_type() {
    let mut conn = fresh();
    seed_product(&conn, "p1", "SKU-1", "retail");
    let t = tx(&mut conn);
    let info = product_info_by_sku_in_tx(&t, "SKU-1").unwrap().unwrap();
    assert_eq!(info.product_id, "p1");
    assert_eq!(info.product_type, "retail");
}

#[test]
fn product_info_by_sku_missing_is_none() {
    let mut conn = fresh();
    let t = tx(&mut conn);
    assert!(product_info_by_sku_in_tx(&t, "NOPE").unwrap().is_none());
}

#[test]
fn ingredient_info_by_id_returns_sku_and_type() {
    let mut conn = fresh();
    seed_product(&conn, "ing-1", "FLOUR", "ingredient");
    let t = tx(&mut conn);
    let info = ingredient_info_by_id_in_tx(&t, "ing-1").unwrap().unwrap();
    assert_eq!(info.product_id, "FLOUR");
    assert_eq!(info.product_type, "ingredient");
}

#[test]
fn ingredient_info_by_id_missing_is_none() {
    let mut conn = fresh();
    let t = tx(&mut conn);
    assert!(ingredient_info_by_id_in_tx(&t, "nope").unwrap().is_none());
}

#[test]
fn require_product_id_by_sku_fails_not_found() {
    let mut conn = fresh();
    let t = tx(&mut conn);
    let err = require_product_id_by_sku_in_tx(&t, "ABSENT").unwrap_err();
    assert!(matches!(err, CoreError::NotFound { .. }), "got {err:?}");
}

/// A read FAILURE must surface as `Db`, never as `NotFound`.
///
/// The function used `.map_err(|_| CoreError::NotFound { entity: "product", .. })`,
/// which folded every error into "no product carries the SKU". The sibling test
/// above covers only the genuinely-absent case, so the swallow was invisible — the
/// same shape of gap this campaign keeps finding in pins that exercise one branch.
///
/// Why `NotFound` is actively wrong here rather than merely imprecise: the single
/// production caller (`db/sales_lifecycle.rs:280`) reaches this only after
/// `product_info_by_sku_in_tx` read the SAME row by the SAME SKU in the SAME
/// transaction and succeeded, so a "product not found" verdict at that point
/// contradicts a read that just worked. It can only mean the store became
/// unreadable, and the operator must be told that.
///
/// Dropping the table is the discriminating input: it makes the read fail while
/// the surrounding transaction stays valid.
#[test]
fn require_product_id_by_sku_propagates_a_read_failure_as_db() {
    let mut conn = fresh();
    let t = tx(&mut conn);
    t.execute_batch("DROP TABLE products;").unwrap();

    let err = require_product_id_by_sku_in_tx(&t, "ANY").unwrap_err();
    assert!(
        matches!(err, CoreError::Db(_)),
        "a read failure must not be reported as a missing product, got {err:?}"
    );
}

#[test]
fn location_qty_reads_the_summary_row() {
    let mut conn = fresh();
    seed_product(&conn, "p1", "SKU-1", "retail");
    conn.execute(
        "INSERT INTO stock_summary (item_id, location_id, qty, updated_at)
         VALUES ('p1', ?1, 7, '2025-01-01T00:00:00.000Z')",
        rusqlite::params![DEFAULT_LOCATION],
    )
    .unwrap();
    let t = tx(&mut conn);
    assert_eq!(location_qty_in_tx(&t, "p1", DEFAULT_LOCATION).unwrap(), 7);
}

#[test]
fn location_qty_missing_row_is_zero() {
    let mut conn = fresh();
    let t = tx(&mut conn);
    assert_eq!(location_qty_in_tx(&t, "p1", "loc-a").unwrap(), 0);
}

#[test]
fn allow_negative_defaults_false_without_override() {
    let mut conn = fresh();
    let t = tx(&mut conn);
    assert!(!allow_negative_at_in_tx(&t, "default", "loc-a").unwrap());
}

#[test]
fn allow_negative_reads_the_override() {
    let mut conn = fresh();
    seed_location(&conn, "loc-neg");
    seed_workspace_instance(&conn, "ws-neg", "loc-neg");
    conn.execute(
        "UPDATE workspace_inventory_locations SET allow_negative_stock = 1
         WHERE instance_id = 'ws-neg' AND location_id = 'loc-neg'",
        [],
    )
    .unwrap();
    let t = tx(&mut conn);
    assert!(allow_negative_at_in_tx(&t, "ws-neg", "loc-neg").unwrap());
}
