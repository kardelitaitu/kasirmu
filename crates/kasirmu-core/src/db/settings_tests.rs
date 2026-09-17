#![allow(deprecated)] // Deprecated currency methods tested here for DB back-compat verification

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
fn store_default_currency_get_set() {
    let conn = fresh();
    let s = store(&conn);
    assert_eq!(s.get_default_currency().unwrap(), None);
    s.set_default_currency("EUR").unwrap();
    assert_eq!(s.get_default_currency().unwrap(), Some("EUR".into()));
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

// ── Exchange Rates ─────────────────────────────────────────────────

fn seed_currency(
    conn: &Connection,
    code: &str,
    numeric_code: &str,
    name: &str,
    exp: i32,
    sym: &str,
) {
    conn.execute(
        "INSERT OR IGNORE INTO currencies (code, numeric_code, name, minor_exponent, symbol) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![code, numeric_code, name, exp, sym],
    ).unwrap();
}

#[test]
fn list_exchange_rates_empty() {
    let conn = fresh();
    let s = store(&conn);
    let rates = s.list_exchange_rates().unwrap();
    assert!(rates.is_empty());
}

#[test]
fn create_exchange_rate_and_find_in_list() {
    let conn = fresh();
    seed_currency(&conn, "USD", "840", "US Dollar", 2, "$");
    seed_currency(&conn, "EUR", "978", "Euro", 2, "\u{20ac}");
    seed_currency(&conn, "JPY", "392", "Japanese Yen", 0, "\u{a5}");
    let s = store(&conn);
    s.create_exchange_rate("USD", "EUR", 920_000, "ecb", "2026-06-28")
        .unwrap();
    s.create_exchange_rate("USD", "JPY", 149_500_000, "ecb", "2026-06-28")
        .unwrap();

    let rates = s.list_exchange_rates().unwrap();
    assert_eq!(rates.len(), 2);
    assert!(rates.iter().any(|r| r.to_currency == "EUR"));
    assert!(rates.iter().any(|r| r.to_currency == "JPY"));
}

#[test]
fn create_exchange_rate_returns_row() {
    let conn = fresh();
    seed_currency(&conn, "EUR", "978", "Euro", 2, "\u{20ac}");
    seed_currency(&conn, "GBP", "826", "Pound", 2, "\u{a3}");
    let s = store(&conn);
    let row = s
        .create_exchange_rate("EUR", "GBP", 860_000, "ecb", "2026-06-28")
        .unwrap();
    assert_eq!(row.from_currency, "EUR");
    assert_eq!(row.to_currency, "GBP");
    assert_eq!(row.rate_millionths, 860_000);
}

#[test]
fn create_exchange_rate_rejects_zero_rate() {
    // C-1 closure: zero is a domain error in the Store layer (the
    // Tauri command layer also rejects `<= 0`, this is the
    // defence-in-depth check).
    let conn = fresh();
    seed_currency(&conn, "USD", "840", "US Dollar", 2, "$");
    seed_currency(&conn, "EUR", "978", "Euro", 2, "\u{20ac}");
    let s = store(&conn);
    let result = s.create_exchange_rate("USD", "EUR", 0, "manual", "2026-01-01");
    assert!(result.is_err(), "zero rate must be rejected");
}

#[test]
fn create_exchange_rate_rejects_negative_rate() {
    let conn = fresh();
    seed_currency(&conn, "USD", "840", "US Dollar", 2, "$");
    seed_currency(&conn, "EUR", "978", "Euro", 2, "\u{20ac}");
    let s = store(&conn);
    let result = s.create_exchange_rate("USD", "EUR", -500_000, "manual", "2026-01-01");
    assert!(result.is_err(), "negative rate must be rejected");
}

#[test]
fn delete_exchange_rate_removes() {
    let conn = fresh();
    seed_currency(&conn, "USD", "840", "US Dollar", 2, "$");
    seed_currency(&conn, "CAD", "124", "Canadian Dollar", 2, "CA$");
    let s = store(&conn);
    let row = s
        .create_exchange_rate("USD", "CAD", 1_360_000, "manual", "2026-06-28")
        .unwrap();
    s.delete_exchange_rate(&row.id).unwrap();
    let rates = s.list_exchange_rates().unwrap();
    assert!(rates.is_empty());
}

#[test]
fn upsert_exchange_rate_replaces_existing() {
    let conn = fresh();
    seed_currency(&conn, "USD", "840", "US Dollar", 2, "$");
    seed_currency(&conn, "EUR", "978", "Euro", 2, "\u{20ac}");
    let s = store(&conn);
    let first = s
        .create_exchange_rate("USD", "EUR", 900_000, "manual", "2026-07-01")
        .unwrap();
    let second = s
        .upsert_exchange_rate("USD", "EUR", 920_000, "auto-sync", "2026-07-01")
        .unwrap();
    // Same (from, to, date) but different id and updated rate
    assert_ne!(first.id, second.id);
    assert_eq!(second.rate_millionths, 920_000);
    assert_eq!(second.source, "auto-sync");
    // Only one row in the table
    let rates = s.list_exchange_rates().unwrap();
    assert_eq!(rates.len(), 1);
}

#[test]
fn delete_exchange_rate_not_found() {
    let conn = fresh();
    let s = store(&conn);
    let result = s.delete_exchange_rate("bad-id");
    assert!(matches!(result, Err(CoreError::NotFound { .. })));
}

// ── Delegation parity with CurrencyRepository ────────────────────────

#[test]
fn store_create_and_repository_list_have_same_row() {
    let conn = fresh();
    seed_currency(&conn, "USD", "840", "US Dollar", 2, "$");
    seed_currency(&conn, "EUR", "978", "Euro", 2, "\u{20ac}");
    let s = store(&conn);

    let row = s
        .create_exchange_rate("USD", "EUR", 920_000, "ecb", "2026-06-28")
        .unwrap();

    let repo = modules_currency::repository::CurrencyRepository::new(&conn);
    let repo_rates = repo.list_exchange_rates().unwrap();
    assert_eq!(repo_rates.len(), 1);
    assert_eq!(repo_rates[0], row);
}

#[test]
fn repository_create_and_store_list_have_same_row() {
    let conn = fresh();
    seed_currency(&conn, "USD", "840", "US Dollar", 2, "$");
    seed_currency(&conn, "EUR", "978", "Euro", 2, "\u{20ac}");
    let repo = modules_currency::repository::CurrencyRepository::new(&conn);

    let row = repo
        .create_exchange_rate("USD", "EUR", 920_000, "ecb", "2026-06-28")
        .unwrap();

    let s = store(&conn);
    let store_rates = s.list_exchange_rates().unwrap();
    assert_eq!(store_rates.len(), 1);
    assert_eq!(store_rates[0], row);
}

#[test]
fn store_upsert_and_repository_list_have_same_row() {
    let conn = fresh();
    seed_currency(&conn, "USD", "840", "US Dollar", 2, "$");
    seed_currency(&conn, "EUR", "978", "Euro", 2, "\u{20ac}");
    let s = store(&conn);

    let row = s
        .upsert_exchange_rate("USD", "EUR", 920_000, "auto-sync", "2026-06-28")
        .unwrap();

    let repo = modules_currency::repository::CurrencyRepository::new(&conn);
    let repo_rates = repo.list_exchange_rates().unwrap();
    assert_eq!(repo_rates.len(), 1);
    assert_eq!(repo_rates[0], row);
    assert_eq!(repo_rates[0].source, "auto-sync");
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

// ── Currency Format Settings ───────────────────────────────────────

#[test]
fn currency_format_default() {
    let conn = fresh();
    let s = store(&conn);
    // Default should be "symbol"
    assert_eq!(s.get_currency_format().unwrap(), "symbol");
}

#[test]
fn currency_format_set_and_get() {
    let conn = fresh();
    let s = store(&conn);
    s.set_currency_format("code").unwrap();
    assert_eq!(s.get_currency_format().unwrap(), "code");
}

#[test]
fn currency_symbol_position_default() {
    let conn = fresh();
    let s = store(&conn);
    assert_eq!(s.get_currency_symbol_position().unwrap(), "prefix");
}

#[test]
fn currency_separators_roundtrip() {
    let conn = fresh();
    let s = store(&conn);
    s.set_currency_decimal_separator("comma").unwrap();
    s.set_currency_thousands_separator("space").unwrap();
    assert_eq!(s.get_currency_decimal_separator().unwrap(), "comma");
    assert_eq!(s.get_currency_thousands_separator().unwrap(), "space");
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
