use super::*;
use crate::migrations;
use rusqlite::Connection;

fn fresh() -> Connection {
    migrations::fresh_db()
}

fn store(conn: &Connection) -> Store<'_> {
    Store::new(conn)
}

fn usd() -> crate::money::Currency {
    "USD".parse().unwrap()
}

fn price(minor: i64) -> crate::Money {
    crate::Money {
        minor_units: minor,
        currency: usd(),
    }
}

#[test]
fn store_get_set_setting() {
    let conn = fresh();
    let s = store(&conn);
    assert_eq!(s.get_setting("my.key").unwrap(), None);
    s.set_setting("my.key", "hello").unwrap();
    assert_eq!(s.get_setting("my.key").unwrap(), Some("hello".into()));
}

#[test]
fn store_features_roundtrip() {
    let conn = fresh();
    let s = store(&conn);
    let reg = crate::FeatureRegistry::simple_retail();
    s.save_features(&reg).unwrap();
    let loaded = s.load_features().unwrap();
    assert_eq!(loaded, reg);
}

#[test]
fn store_name_get_set() {
    let conn = fresh();
    let s = store(&conn);
    assert_eq!(s.get_store_name().unwrap(), None);
    s.set_store_name("Acme").unwrap();
    assert_eq!(s.get_store_name().unwrap(), Some("Acme".into()));
}

#[test]
fn store_conn_returns_underlying_connection() {
    let conn = fresh();
    let s = store(&conn);
    let p = s
        .create_product("T1", "Test", price(1), None, None, 0, None)
        .unwrap();
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM products WHERE sku = 'T1'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(count, 1);
    drop(p);
}

#[test]
fn backup_creates_snapshot_file() {
    let conn = fresh();
    // seed some data
    conn.execute_batch(
        "INSERT INTO categories (id, name, colour) VALUES ('cat-test', 'Test', '#000')",
    )
    .unwrap();
    let s = store(&conn);

    // Unique destination per run: the previous hardcoded
    // `oz-test-backup.db` collided across parallel test processes on
    // Windows — a stale or still-open file made the backup fail with
    // os error 32 ("file being used by another process"). A fresh UUID
    // name means a given run can never hit another run's leftover file.
    let tmp = std::env::temp_dir().join(format!("oz-test-backup-{}.db", uuid::Uuid::now_v7()));

    s.backup(tmp.to_str().unwrap()).unwrap();

    let backup_conn = Connection::open(&tmp).unwrap();
    let count: i64 = backup_conn
        .query_row("SELECT COUNT(*) FROM categories", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 1);
    // Close the backup connection before removing the file — on Windows
    // an open handle prevents deletion (os error 32) and would leave a
    // locked stale file behind for the next run.
    drop(backup_conn);

    let _ = std::fs::remove_file(&tmp);
}

// ── Store Tax ID ───────────────────────────────────────────────────

#[test]
fn store_tax_id_default_none() {
    let conn = fresh();
    let s = store(&conn);
    assert_eq!(s.get_store_tax_id().unwrap(), None);
}

#[test]
fn store_tax_id_set_and_get() {
    let conn = fresh();
    let s = store(&conn);
    s.set_store_tax_id("12-3456789").unwrap();
    assert_eq!(s.get_store_tax_id().unwrap(), Some("12-3456789".into()));
}

#[test]
fn store_tax_id_overwrites() {
    let conn = fresh();
    let s = store(&conn);
    s.set_store_tax_id("OLD").unwrap();
    s.set_store_tax_id("NEW").unwrap();
    assert_eq!(s.get_store_tax_id().unwrap(), Some("NEW".into()));
}

// ── Store Address ─────────────────────────────────────────────────

#[test]
fn store_address_default_none() {
    let conn = fresh();
    let s = store(&conn);
    assert_eq!(s.get_store_address().unwrap(), None);
}

#[test]
fn store_address_set_and_get() {
    let conn = fresh();
    let s = store(&conn);
    s.set_store_address("123 Main St, Springfield").unwrap();
    assert_eq!(
        s.get_store_address().unwrap(),
        Some("123 Main St, Springfield".into())
    );
}

#[test]
fn store_address_overwrites() {
    let conn = fresh();
    let s = store(&conn);
    s.set_store_address("Old Address").unwrap();
    s.set_store_address("New Address").unwrap();
    assert_eq!(s.get_store_address().unwrap(), Some("New Address".into()));
}

#[test]
fn store_address_special_chars() {
    let conn = fresh();
    let s = store(&conn);
    s.set_store_address("Café & Bakery — 中文 Español\nFloor 2")
        .unwrap();
    let addr = s.get_store_address().unwrap();
    assert!(addr.as_deref().unwrap().contains("Café"));
    assert!(addr.as_deref().unwrap().contains("中文"));
    assert!(addr.as_deref().unwrap().contains("Español"));
}

#[test]
fn setting_overwrite_with_empty_string() {
    let conn = fresh();
    let s = store(&conn);
    s.set_setting("greeting", "hello").unwrap();
    s.set_setting("greeting", "").unwrap();
    assert_eq!(
        s.get_setting("greeting").unwrap(),
        Some("".into()),
        "empty string should be a valid setting value"
    );
}

#[test]
fn setting_with_long_value() {
    let conn = fresh();
    let s = store(&conn);
    let long = "a".repeat(10_000);
    s.set_setting("long.key", &long).unwrap();
    let got = s.get_setting("long.key").unwrap();
    assert_eq!(got, Some(long));
}

// ── Input validation ────────────────────────────────────────────────

#[test]
fn set_store_name_rejects_empty() {
    let conn = fresh();
    let s = store(&conn);
    let err = s.set_store_name("").unwrap_err();
    assert!(matches!(
        err,
        CoreError::Validation {
            field: "store_name",
            ..
        }
    ));
}

#[test]
fn set_store_name_rejects_whitespace() {
    let conn = fresh();
    let s = store(&conn);
    let err = s.set_store_name("   ").unwrap_err();
    assert!(matches!(
        err,
        CoreError::Validation {
            field: "store_name",
            ..
        }
    ));
}

#[test]
fn set_store_address_rejects_empty() {
    let conn = fresh();
    let s = store(&conn);
    let err = s.set_store_address("").unwrap_err();
    assert!(matches!(
        err,
        CoreError::Validation {
            field: "store_address",
            ..
        }
    ));
}

#[test]
fn set_store_address_rejects_whitespace() {
    let conn = fresh();
    let s = store(&conn);
    let err = s.set_store_address("   ").unwrap_err();
    assert!(matches!(
        err,
        CoreError::Validation {
            field: "store_address",
            ..
        }
    ));
}

#[test]
fn set_store_tax_id_rejects_empty() {
    let conn = fresh();
    let s = store(&conn);
    let err = s.set_store_tax_id("").unwrap_err();
    assert!(matches!(
        err,
        CoreError::Validation {
            field: "store_tax_id",
            ..
        }
    ));
}

#[test]
fn set_store_tax_id_rejects_whitespace() {
    let conn = fresh();
    let s = store(&conn);
    let err = s.set_store_tax_id("   ").unwrap_err();
    assert!(matches!(
        err,
        CoreError::Validation {
            field: "store_tax_id",
            ..
        }
    ));
}
