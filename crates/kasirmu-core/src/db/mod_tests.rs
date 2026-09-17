//! Tests for the `Store` facade helpers in `db/mod.rs`.
//!
//! Covers the pure and query-level logic that previously had no coverage:
//! `remove_destination_for_backup` (RUST-03 IO-error semantics), the online
//! backup path, `check_integrity`, `check_tenant_integrity`, and the
//! `row_to_product` row mapper.

use super::*;
use crate::migrations;
use rusqlite::Connection;

fn fresh() -> Connection {
    migrations::fresh_db()
}

fn store(conn: &Connection) -> Store<'_> {
    Store::new(conn)
}

/* ── remove_destination_for_backup (RUST-03) ────────────────────── */

#[test]
fn remove_destination_ok_when_file_exists() {
    let dir = std::env::temp_dir().join(format!("oz_rm_dst_{}", uuid::Uuid::now_v7()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("backup.sqlite");
    std::fs::write(&path, b"x").unwrap();

    assert!(Store::remove_destination_for_backup(&path.to_string_lossy()).is_ok());
    assert!(!path.exists(), "existing destination must be removed");
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn remove_destination_ok_when_missing() {
    // A missing destination is the normal fresh-backup case — must NOT error.
    let dir = std::env::temp_dir().join(format!("oz_rm_missing_{}", uuid::Uuid::now_v7()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("never-existed.sqlite");

    assert!(Store::remove_destination_for_backup(&path.to_string_lossy()).is_ok());
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn remove_destination_propagates_non_notfound_errors() {
    // A directory target is not a file: remove_file fails with a non-NotFound
    // error, which must propagate (RUST-03: only missing files are acceptable).
    let dir = std::env::temp_dir().join(format!("oz_rm_dir_{}", uuid::Uuid::now_v7()));
    std::fs::create_dir_all(&dir).unwrap();
    let target = dir.join("backup.sqlite");
    std::fs::create_dir_all(&target).unwrap();

    let result = Store::remove_destination_for_backup(&target.to_string_lossy());
    assert!(result.is_err(), "directory target must fail");
    std::fs::remove_dir_all(&dir).unwrap();
}

/* ── backup / repair_to ─────────────────────────────────────────── */

#[test]
fn backup_creates_valid_copy() {
    let conn = fresh();
    let s = store(&conn);
    // Insert a row so the copy has content.
    s.set_setting("audit.key", "value").unwrap();

    let dir = std::env::temp_dir().join(format!("oz_backup_{}", uuid::Uuid::now_v7()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("backup.sqlite");

    s.backup(&path.to_string_lossy()).unwrap();
    assert!(path.exists());

    // The copy is a valid DB containing the row.
    let copy = rusqlite::Connection::open(&path).unwrap();
    let got: Option<String> = copy
        .query_row(
            "SELECT value FROM settings WHERE key = 'audit.key'",
            [],
            |r| r.get(0),
        )
        .ok();
    assert_eq!(got.as_deref(), Some("value"));
    // Close the read-only copy before cleanup so Windows can remove the dir.
    drop(copy);
    std::fs::remove_dir_all(&dir).unwrap();
}

/* ── check_integrity ────────────────────────────────────────────── */

#[test]
fn check_integrity_passes_on_healthy_db() {
    let conn = fresh();
    let s = store(&conn);
    assert!(s.check_integrity().is_ok());
}

/* ── check_tenant_integrity ─────────────────────────────────────── */

#[test]
fn tenant_integrity_passes_when_no_foreign_rows() {
    let conn = fresh();
    let s = store(&conn);
    // Fresh DB has no rows — no foreign tenant rows possible.
    assert!(s.check_tenant_integrity().is_ok());
}

#[test]
fn tenant_integrity_detects_foreign_rows() {
    let conn = fresh();
    let s = store(&conn);
    // A product row must carry tenant_id = 'default'. Planting one with a
    // different tenant must trip the guard.
    conn.execute(
        "INSERT INTO products (id, sku, name, price_minor, currency, tenant_id, created_at, updated_at)
         VALUES ('p-1', 'SKU-X', 'Foreign', 100, 'IDR', 'other-tenant', '2026-01-01', '2026-01-01')",
        [],
    )
    .unwrap();

    let err = s.check_tenant_integrity().unwrap_err();
    let msg = err.to_string();
    assert!(
        msg.contains("foreign-tenant"),
        "error names the failure: {msg}"
    );
    assert!(
        msg.contains("products"),
        "error names the offending table: {msg}"
    );
}

/* ── row_to_product ─────────────────────────────────────────────── */

#[test]
fn row_to_product_maps_full_row() {
    let conn = fresh();
    // products.category_id is a FK — the category must exist first.
    conn.execute(
        "INSERT INTO categories (id, name, created_at, updated_at)
         VALUES ('cat-1', 'Widgets', '2026-01-01', '2026-01-01')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO products (id, sku, name, price_minor, currency, category_id, barcode, created_at, updated_at, price_updated_at, product_type, track_serial, version, cost_minor, brand, rack_location, notes, unit, is_active)
         VALUES ('p-1', 'SKU-1', 'Widget', 2500, 'IDR', 'cat-1', '8991234567890', '2026-01-01', '2026-01-02', '2026-01-03', 'retail', 1, 3, 1500, 'Acme', 'A-1', 'note', 'pc', 1)",
        [],
    )
    .unwrap();

    let mut stmt = conn
        .prepare("SELECT * FROM products WHERE id = 'p-1'")
        .unwrap();
    let mut rows = stmt.query([]).unwrap();
    let row = rows.next().unwrap().unwrap();
    let product = row_to_product(row).unwrap();

    assert_eq!(product.id, "p-1");
    assert_eq!(product.sku.as_str(), "SKU-1");
    assert_eq!(product.name, "Widget");
    assert_eq!(product.price.minor_units, 2500);
    assert_eq!(
        std::str::from_utf8(&product.price.currency.0).unwrap(),
        "IDR"
    );
    assert_eq!(product.category_id.as_deref(), Some("cat-1"));
    assert_eq!(
        product.barcode.as_ref().map(|b| b.as_str()),
        Some("8991234567890")
    );
    assert!(product.track_serial);
    assert_eq!(product.version, 3);
    assert_eq!(product.cost_minor, 1500);
    assert_eq!(product.brand.as_deref(), Some("Acme"));
    assert_eq!(product.rack_location.as_deref(), Some("A-1"));
    assert_eq!(product.notes.as_deref(), Some("note"));
    assert_eq!(product.unit.as_deref(), Some("pc"));
    assert!(product.is_active);
}

#[test]
fn row_to_product_defaults_optional_columns() {
    // A minimal insert — every optional column must default safely.
    let conn = fresh();
    conn.execute(
        "INSERT INTO products (id, sku, name, price_minor, currency, created_at, updated_at)
         VALUES ('p-2', 'SKU-2', 'Bare', 100, 'USD', '2026-01-01', '2026-01-01')",
        [],
    )
    .unwrap();

    let mut stmt = conn
        .prepare("SELECT * FROM products WHERE id = 'p-2'")
        .unwrap();
    let mut rows = stmt.query([]).unwrap();
    let row = rows.next().unwrap().unwrap();
    let product = row_to_product(row).unwrap();

    assert_eq!(product.sku.as_str(), "SKU-2");
    assert_eq!(product.price.minor_units, 100);
    assert_eq!(
        std::str::from_utf8(&product.price.currency.0).unwrap(),
        "USD"
    );
    // Optional fields default.
    assert!(product.category_id.is_none());
    assert!(product.barcode.is_none());
    assert!(!product.track_serial);
    assert_eq!(product.version, 1);
    assert_eq!(product.cost_minor, 0);
    assert!(product.brand.is_none());
    assert!(product.is_active, "is_active defaults to true (1)");
}

#[test]
fn row_to_product_fails_on_invalid_currency() {
    let conn = fresh();
    conn.execute(
        "INSERT INTO products (id, sku, name, price_minor, currency, created_at, updated_at)
         VALUES ('p-3', 'SKU-3', 'BadCur', 100, 'NOTACUR', '2026-01-01', '2026-01-01')",
        [],
    )
    .unwrap();

    let mut stmt = conn
        .prepare("SELECT * FROM products WHERE id = 'p-3'")
        .unwrap();
    let mut rows = stmt.query([]).unwrap();
    let row = rows.next().unwrap().unwrap();
    assert!(row_to_product(row).is_err(), "invalid currency must error");
}
