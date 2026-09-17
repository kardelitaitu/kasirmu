//! Tests for product image storage (spec 0046b §3.2–3.3).
//!
//! Covers: slot bounds, menu invariant (set/clear), promotion on clear,
//! slot-1 mirror, version bumps, missing product, idempotent clear.

use super::*;
use crate::migrations::fresh_db;

/// Create a product with the given type and return its id.
fn seed_product(conn: &rusqlite::Connection, sku: &str, product_type: &str) -> String {
    conn.execute(
        "INSERT INTO products (id, sku, name, price_minor, currency, product_type, version)
         VALUES (?1, ?2, ?3, 1000, 'USD', ?4, 1)",
        rusqlite::params![
            format!("prod-{sku}"),
            sku,
            format!("Product {sku}"),
            product_type
        ],
    )
    .unwrap();
    format!("prod-{sku}")
}

/// Read the slot-1 mirror column.
fn image_hash(conn: &rusqlite::Connection, product_id: &str) -> Option<String> {
    conn.query_row(
        "SELECT image_hash FROM products WHERE id = ?1",
        rusqlite::params![product_id],
        |row| row.get(0),
    )
    .unwrap()
}

/// Read the (slot, hash, position) rows for a product, ordered by slot.
fn image_rows(conn: &rusqlite::Connection, product_id: &str) -> Vec<(i32, String, i32)> {
    let mut stmt = conn
        .prepare(
            "SELECT slot, hash, position FROM product_images
             WHERE product_id = ?1 ORDER BY slot ASC",
        )
        .unwrap();
    let rows = stmt
        .query_map(rusqlite::params![product_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })
        .unwrap();
    rows.map(|r| r.unwrap()).collect()
}

fn version(conn: &rusqlite::Connection, product_id: &str) -> i64 {
    conn.query_row(
        "SELECT version FROM products WHERE id = ?1",
        rusqlite::params![product_id],
        |row| row.get(0),
    )
    .unwrap()
}

#[test]
fn set_image_writes_slot_1_and_mirror() {
    let conn = fresh_db();
    let store = Store::new(&conn);
    let pid = seed_product(&conn, "A", "retail");

    store.set_product_image(&pid, 1, "abc123").unwrap();

    assert_eq!(image_hash(&conn, &pid), Some("abc123".into()));
    assert_eq!(image_rows(&conn, &pid), vec![(1, "abc123".into(), 0)]);
    assert_eq!(version(&conn, &pid), 2);
}

#[test]
fn set_image_writes_alternative_slot_without_mirror() {
    let conn = fresh_db();
    let store = Store::new(&conn);
    let pid = seed_product(&conn, "A", "retail");

    store.set_product_image(&pid, 1, "primary").unwrap();
    store.set_product_image(&pid, 2, "alt1").unwrap();
    store.set_product_image(&pid, 3, "alt2").unwrap();

    assert_eq!(image_hash(&conn, &pid), Some("primary".into()));
    assert_eq!(
        image_rows(&conn, &pid),
        vec![
            (1, "primary".into(), 0),
            (2, "alt1".into(), 0),
            (3, "alt2".into(), 0)
        ]
    );
    assert_eq!(version(&conn, &pid), 4);
}

#[test]
fn set_image_replaces_existing_slot() {
    let conn = fresh_db();
    let store = Store::new(&conn);
    let pid = seed_product(&conn, "A", "retail");

    store.set_product_image(&pid, 1, "old").unwrap();
    store.set_product_image(&pid, 1, "new").unwrap();

    assert_eq!(image_hash(&conn, &pid), Some("new".into()));
    assert_eq!(image_rows(&conn, &pid), vec![(1, "new".into(), 0)]);
}

#[test]
fn set_image_out_of_range_slot_rejected() {
    let conn = fresh_db();
    let store = Store::new(&conn);
    let pid = seed_product(&conn, "A", "retail");

    let err = store.set_product_image(&pid, 0, "abc").unwrap_err();
    assert!(matches!(err, CoreError::Validation { field: "slot", .. }));
    let err = store.set_product_image(&pid, 6, "abc").unwrap_err();
    assert!(matches!(err, CoreError::Validation { field: "slot", .. }));
}

#[test]
fn set_image_menu_item_only_slot_1() {
    let conn = fresh_db();
    let store = Store::new(&conn);
    let pid = seed_product(&conn, "M", "restaurant");

    store.set_product_image(&pid, 1, "abc").unwrap();
    assert_eq!(image_hash(&conn, &pid), Some("abc".into()));

    let err = store.set_product_image(&pid, 2, "alt").unwrap_err();
    assert!(matches!(err, CoreError::Validation { field: "slot", .. }));
}

#[test]
fn set_image_missing_product_not_found() {
    let conn = fresh_db();
    let store = Store::new(&conn);

    let err = store.set_product_image("missing", 1, "abc").unwrap_err();
    assert!(matches!(
        err,
        CoreError::NotFound {
            entity: "product",
            ..
        }
    ));
}

#[test]
fn clear_image_no_alternatives_clears_mirror() {
    let conn = fresh_db();
    let store = Store::new(&conn);
    let pid = seed_product(&conn, "A", "retail");

    store.set_product_image(&pid, 1, "primary").unwrap();
    store.clear_product_image(&pid, 1).unwrap();

    assert_eq!(image_hash(&conn, &pid), None);
    assert!(image_rows(&conn, &pid).is_empty());
}

#[test]
fn clear_image_promotes_first_alternative() {
    let conn = fresh_db();
    let store = Store::new(&conn);
    let pid = seed_product(&conn, "A", "retail");

    store.set_product_image(&pid, 1, "primary").unwrap();
    store.set_product_image(&pid, 2, "alt1").unwrap();
    store.set_product_image(&pid, 3, "alt2").unwrap();

    store.clear_product_image(&pid, 1).unwrap();

    // First alternative (lowest slot) is promoted to primary.
    assert_eq!(image_hash(&conn, &pid), Some("alt1".into()));
    assert_eq!(
        image_rows(&conn, &pid),
        vec![(1, "alt1".into(), 0), (3, "alt2".into(), 0)]
    );
}

#[test]
fn clear_image_menu_item_slot_1_refused() {
    let conn = fresh_db();
    let store = Store::new(&conn);
    let pid = seed_product(&conn, "M", "restaurant");

    store.set_product_image(&pid, 1, "abc").unwrap();

    let err = store.clear_product_image(&pid, 1).unwrap_err();
    assert!(matches!(err, CoreError::Validation { field: "slot", .. }));
    // Image still intact
    assert_eq!(image_hash(&conn, &pid), Some("abc".into()));
}

#[test]
fn clear_image_alternative_only_deletes_row() {
    let conn = fresh_db();
    let store = Store::new(&conn);
    let pid = seed_product(&conn, "A", "retail");

    store.set_product_image(&pid, 1, "primary").unwrap();
    store.set_product_image(&pid, 2, "alt1").unwrap();

    store.clear_product_image(&pid, 2).unwrap();

    assert_eq!(image_hash(&conn, &pid), Some("primary".into()));
    assert_eq!(image_rows(&conn, &pid), vec![(1, "primary".into(), 0)]);
}

#[test]
fn clear_image_idempotent_when_absent() {
    let conn = fresh_db();
    let store = Store::new(&conn);
    let pid = seed_product(&conn, "A", "retail");

    // Clearing a non-existent alternative is a no-op success
    store.clear_product_image(&pid, 4).unwrap();
    assert!(image_rows(&conn, &pid).is_empty());
}

#[test]
fn clear_image_missing_product_not_found() {
    let conn = fresh_db();
    let store = Store::new(&conn);

    let err = store.clear_product_image("missing", 1).unwrap_err();
    assert!(matches!(
        err,
        CoreError::NotFound {
            entity: "product",
            ..
        }
    ));
}

#[test]
fn set_image_dedupe_hash_stored_once_per_product_slot() {
    let conn = fresh_db();
    let store = Store::new(&conn);
    let pid = seed_product(&conn, "A", "retail");

    // Same hash applied to two different products is stored once per slot
    // (content-addressed) — the DB only records the hash string.
    store.set_product_image(&pid, 1, "same-hash").unwrap();
    let pid2 = seed_product(&conn, "B", "retail");
    store.set_product_image(&pid2, 1, "same-hash").unwrap();

    assert_eq!(image_hash(&conn, &pid), Some("same-hash".into()));
    assert_eq!(image_hash(&conn, &pid2), Some("same-hash".into()));
    // Only one physical file would exist; DB holds two references.
}

#[test]
fn list_product_images_returns_slots_in_order() {
    let conn = fresh_db();
    let store = Store::new(&conn);
    let pid = seed_product(&conn, "A", "retail");

    // Empty list for a product with no images.
    assert!(store.list_product_images(&pid).unwrap().is_empty());

    store.set_product_image(&pid, 1, "primary").unwrap();
    store.set_product_image(&pid, 2, "alt1").unwrap();
    store.set_product_image(&pid, 5, "alt4").unwrap();

    let images = store.list_product_images(&pid).unwrap();
    assert_eq!(
        images,
        vec![
            ProductImage {
                slot: 1,
                hash: "primary".into(),
                position: 0
            },
            ProductImage {
                slot: 2,
                hash: "alt1".into(),
                position: 0
            },
            ProductImage {
                slot: 5,
                hash: "alt4".into(),
                position: 0
            },
        ]
    );
}

#[test]
fn list_product_images_missing_product_returns_empty() {
    let conn = fresh_db();
    let store = Store::new(&conn);
    assert!(store.list_product_images("missing").unwrap().is_empty());
}
