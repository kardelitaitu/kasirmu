use rusqlite::Connection;

use super::*;
use crate::db::Store;

fn in_memory_db_with_schema() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(
        "CREATE TABLE locations (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL DEFAULT 'default',
            index_id INTEGER
        );
        CREATE TABLE sales (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL DEFAULT 'default',
            store_id TEXT NOT NULL,
            terminal_id TEXT,
            display_code TEXT,
            total_minor INTEGER NOT NULL DEFAULT 0,
            currency TEXT NOT NULL DEFAULT 'IDR',
            status TEXT NOT NULL DEFAULT 'Completed',
            faktur_pajak_nsfp TEXT,
            faktur_pajak_kode_transaksi TEXT NOT NULL DEFAULT '01',
            faktur_pajak_status TEXT NOT NULL DEFAULT '00',
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );",
    )
    .unwrap();
    conn
}

#[test]
fn validate_nsfp_accepts_valid_13_digits() {
    assert!(validate_nsfp("2600000000001").is_ok());
    assert!(validate_nsfp("2500000000123").is_ok());
    assert!(validate_nsfp("  2600000000001  ").is_ok());
}

#[test]
fn validate_nsfp_rejects_invalid_inputs() {
    assert!(validate_nsfp("").is_err());
    assert!(validate_nsfp("12345").is_err()); // too short
    assert!(validate_nsfp("26000000000001").is_err()); // 14 digits (too long)
    assert!(validate_nsfp("260000000000A").is_err()); // alphanumeric
    assert!(validate_nsfp("26-0000000001").is_err()); // contains hyphen
}

#[test]
fn validate_kode_transaksi_accepts_djp_codes() {
    for code in &["01", "02", "03", "04", "05", "06", "07", "08", "09", "10"] {
        assert!(validate_kode_transaksi(code).is_ok());
    }
}

#[test]
fn validate_kode_transaksi_rejects_out_of_range() {
    assert!(validate_kode_transaksi("00").is_err());
    assert!(validate_kode_transaksi("11").is_err());
    assert!(validate_kode_transaksi("99").is_err());
    assert!(validate_kode_transaksi("XX").is_err());
}

#[test]
fn format_faktur_pajak_17_assembles_correctly() {
    let formatted = format_faktur_pajak_17("01", "00", "2600000000123");
    assert_eq!(formatted, "01002600000000123");
    assert_eq!(formatted.len(), 17);
}

#[test]
fn get_faktur_pajak_returns_none_when_unstamped() {
    let conn = in_memory_db_with_schema();
    let store = Store::new(&conn);

    conn.execute(
        "INSERT INTO sales (id, store_id) VALUES ('sale-1', 'loc-1')",
        [],
    )
    .unwrap();

    let result = store.get_faktur_pajak("sale-1").unwrap();
    assert_eq!(result, None);
}

#[test]
fn stamp_faktur_pajak_updates_sale_and_formats_17_digits() {
    let conn = in_memory_db_with_schema();
    let store = Store::new(&conn);

    conn.execute(
        "INSERT INTO sales (id, store_id) VALUES ('sale-1', 'loc-1')",
        [],
    )
    .unwrap();

    let stamped = store
        .stamp_faktur_pajak("sale-1", "2600000000123", Some("01"))
        .unwrap();

    assert_eq!(stamped.nsfp, "2600000000123");
    assert_eq!(stamped.kode_transaksi, "01");
    assert_eq!(stamped.status, "00");
    assert_eq!(stamped.formatted, "01002600000000123");

    // Read back via get_faktur_pajak
    let read = store.get_faktur_pajak("sale-1").unwrap().unwrap();
    assert_eq!(read, stamped);

    // Batch read map
    let map = store
        .get_faktur_pajak_map(&["sale-1".to_string(), "sale-2".to_string()])
        .unwrap();
    assert_eq!(map.len(), 1);
    assert_eq!(map.get("sale-1"), Some(&stamped));
}

#[test]
fn stamp_faktur_pajak_defaults_kode_transaksi_to_01() {
    let conn = in_memory_db_with_schema();
    let store = Store::new(&conn);

    conn.execute(
        "INSERT INTO sales (id, store_id) VALUES ('sale-2', 'loc-1')",
        [],
    )
    .unwrap();

    let stamped = store
        .stamp_faktur_pajak("sale-2", "2600000000456", None)
        .unwrap();

    assert_eq!(stamped.kode_transaksi, "01");
    assert_eq!(stamped.status, "00");
    assert_eq!(stamped.formatted, "01002600000000456");
}

#[test]
fn stamp_faktur_pajak_returns_not_found_for_missing_sale() {
    let conn = in_memory_db_with_schema();
    let store = Store::new(&conn);

    let err = store
        .stamp_faktur_pajak("nonexistent-sale", "2600000000123", None)
        .unwrap_err();

    match err {
        CoreError::NotFound { entity, id } => {
            assert_eq!(entity, "sale");
            assert_eq!(id, "nonexistent-sale");
        }
        other => panic!("expected NotFound, got {other:?}"),
    }
}

#[test]
fn create_faktur_pengganti_fails_for_unstamped_sale() {
    let conn = in_memory_db_with_schema();
    let store = Store::new(&conn);

    conn.execute(
        "INSERT INTO sales (id, store_id) VALUES ('sale-3', 'loc-1')",
        [],
    )
    .unwrap();

    let err = store.create_faktur_pengganti("sale-3").unwrap_err();
    match err {
        CoreError::Validation { field, message } => {
            assert_eq!(field, "faktur_pajak");
            assert!(message.contains("has no approved NSFP"));
        }
        other => panic!("expected Validation, got {other:?}"),
    }
}

#[test]
fn create_faktur_pengganti_increments_status_and_preserves_nsfp() {
    let conn = in_memory_db_with_schema();
    let store = Store::new(&conn);

    conn.execute(
        "INSERT INTO sales (id, store_id) VALUES ('sale-4', 'loc-1')",
        [],
    )
    .unwrap();

    // Initial stamp
    let initial = store
        .stamp_faktur_pajak("sale-4", "2600000000789", Some("01"))
        .unwrap();
    assert_eq!(initial.status, "00");
    assert_eq!(initial.formatted, "01002600000000789");

    // First replacement: status 00 -> 01
    let rev1 = store.create_faktur_pengganti("sale-4").unwrap();
    assert_eq!(rev1.nsfp, "2600000000789"); // NSFP intact!
    assert_eq!(rev1.status, "01");
    assert_eq!(rev1.formatted, "01012600000000789");

    // Second replacement: status 01 -> 02
    let rev2 = store.create_faktur_pengganti("sale-4").unwrap();
    assert_eq!(rev2.nsfp, "2600000000789"); // NSFP still intact!
    assert_eq!(rev2.status, "02");
    assert_eq!(rev2.formatted, "01022600000000789");

    // Check read-back
    let current = store.get_faktur_pajak("sale-4").unwrap().unwrap();
    assert_eq!(current, rev2);
}
