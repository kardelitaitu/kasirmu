//! Integration tests for the currency/exchange rate module —
//! conversion rates, multi-currency edge cases, and Money operations.

#![allow(deprecated)]
//!
//! Tests exercise the full persistence layer via the public
//! [`kasirmu_core::Store`] API and [`kasirmu_core::Money`] / [`kasirmu_core::Currency`]
//! domain types against an in-memory SQLite database.
//!
//! After audit finding C-1 closure, exchange rates are stored as
//! `i64` millionths with a 6-decimal fixed-point scale (e.g. `0.92`
//! → `920_000`). Every rate literal in this file is therefore suffixed
//! with `_000` etc.; the conversion factor is documented at every
//! call site for clarity.

use kasirmu_core::{Currency, Money, Store, migrations};
use rusqlite::Connection;

// ── Helpers ───────────────────────────────────────────────────────────

fn setup() -> Connection {
    migrations::fresh_db()
}

fn store(conn: &Connection) -> Store<'_> {
    Store::new(conn)
}

fn usd() -> Currency {
    "USD".parse().unwrap()
}

fn eur() -> Currency {
    "EUR".parse().unwrap()
}

fn jpy() -> Currency {
    "JPY".parse().unwrap()
}

fn price(minor: i64, currency: Currency) -> Money {
    Money {
        minor_units: minor,
        currency,
    }
}

/// Seed a currency in the ISO-4217 table.
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

/// Seed currencies needed for exchange rate tests.
fn seed_common_currencies(conn: &Connection) {
    seed_currency(conn, "USD", "840", "US Dollar", 2, "$");
    seed_currency(conn, "EUR", "978", "Euro", 2, "\u{20ac}");
    seed_currency(conn, "GBP", "826", "Pound", 2, "\u{a3}");
    seed_currency(conn, "JPY", "392", "Japanese Yen", 0, "\u{a5}");
    seed_currency(conn, "CAD", "124", "Canadian Dollar", 2, "CA$");
    seed_currency(
        conn,
        "KWD",
        "414",
        "Kuwaiti Dinar",
        3,
        "\u{62f}\u{2e}\u{643}",
    );
}

// ── Exchange rate ordering ───────────────────────────────────────────

#[test]
fn exchange_rates_ordered_by_from_then_to_currency() {
    let conn = setup();
    seed_common_currencies(&conn);
    let s = store(&conn);

    // 0.79 USD/GBP, 1.08 EUR/USD, 0.92 USD/EUR, 1.26 GBP/USD — all in millionths.
    s.create_exchange_rate("USD", "GBP", 790_000, "ecb", "2026-06-28")
        .unwrap();
    s.create_exchange_rate("EUR", "USD", 1_080_000, "ecb", "2026-06-28")
        .unwrap();
    s.create_exchange_rate("USD", "EUR", 920_000, "ecb", "2026-06-28")
        .unwrap();
    s.create_exchange_rate("GBP", "USD", 1_260_000, "ecb", "2026-06-28")
        .unwrap();

    let rates = s.list_exchange_rates().unwrap();
    assert_eq!(rates.len(), 4);

    // Expect: EUR→USD, GBP→USD, USD→EUR, USD→GBP (alphabetical by from, then to).
    assert_eq!(rates[0].from_currency, "EUR");
    assert_eq!(rates[0].to_currency, "USD");
    assert_eq!(rates[1].from_currency, "GBP");
    assert_eq!(rates[1].to_currency, "USD");
    assert_eq!(rates[2].from_currency, "USD");
    assert_eq!(rates[2].to_currency, "EUR");
    assert_eq!(rates[3].from_currency, "USD");
    assert_eq!(rates[3].to_currency, "GBP");
}

#[test]
fn exchange_rates_same_pair_different_dates() {
    let conn = setup();
    seed_common_currencies(&conn);
    let s = store(&conn);

    // Two rates for the same pair on different dates.
    let r1 = s
        .create_exchange_rate("USD", "EUR", 900_000, "ecb", "2026-01-15")
        .unwrap();
    let r2 = s
        .create_exchange_rate("USD", "EUR", 920_000, "ecb", "2026-06-28")
        .unwrap();

    let rates = s.list_exchange_rates().unwrap();
    assert_eq!(rates.len(), 2);

    assert_eq!(r1.from_currency, "USD");
    assert_eq!(r1.to_currency, "EUR");
    assert_eq!(r1.effective_date, "2026-01-15");
    assert_eq!(r1.rate_millionths, 900_000);

    assert_eq!(r2.from_currency, "USD");
    assert_eq!(r2.to_currency, "EUR");
    assert_eq!(r2.effective_date, "2026-06-28");
    assert_eq!(r2.rate_millionths, 920_000);
}

#[test]
fn exchange_rates_list_empty_db() {
    let conn = setup();
    let s = store(&conn);
    let rates = s.list_exchange_rates().unwrap();
    assert!(rates.is_empty());
}

// ── Exchange rate FK constraints ─────────────────────────────────────

#[test]
fn create_exchange_rate_nonexistent_from_currency_rejected() {
    let conn = setup();
    seed_currency(&conn, "EUR", "978", "Euro", 2, "\u{20ac}");
    let s = store(&conn);

    let result = s.create_exchange_rate("XYZ", "EUR", 1_000_000, "manual", "2026-01-01");
    assert!(
        result.is_err(),
        "should reject rate with non-existent from_currency"
    );
}

#[test]
fn create_exchange_rate_nonexistent_to_currency_rejected() {
    let conn = setup();
    seed_currency(&conn, "USD", "840", "US Dollar", 2, "$");
    let s = store(&conn);

    let result = s.create_exchange_rate("USD", "XYZ", 1_000_000, "manual", "2026-01-01");
    assert!(
        result.is_err(),
        "should reject rate with non-existent to_currency"
    );
}

#[test]
fn create_exchange_rate_both_currencies_must_exist() {
    let conn = setup();
    let s = store(&conn);

    let result = s.create_exchange_rate("ABC", "DEF", 1_000_000, "manual", "2026-01-01");
    assert!(
        result.is_err(),
        "should reject rate when both currencies are missing"
    );
}

// ── Exchange rate domain validation (C-1 closure) ────────────────────

#[test]
fn create_exchange_rate_rejects_zero_rate() {
    let conn = setup();
    seed_common_currencies(&conn);
    let s = store(&conn);

    let result = s.create_exchange_rate("USD", "EUR", 0, "manual", "2026-01-01");
    assert!(result.is_err(), "zero rate must be rejected");
}

#[test]
fn create_exchange_rate_rejects_negative_rate() {
    let conn = setup();
    seed_common_currencies(&conn);
    let s = store(&conn);

    // -500_000 = -0.50
    let result = s.create_exchange_rate("USD", "EUR", -500_000, "manual", "2026-01-01");
    assert!(result.is_err(), "negative rate must be rejected");
}

// ── Exchange rate various values ─────────────────────────────────────

#[test]
fn exchange_rate_very_small_rate() {
    // 0.00025 = 250 in millionths (5-decimal magnitude test).
    let conn = setup();
    seed_common_currencies(&conn);
    let s = store(&conn);

    let row = s
        .create_exchange_rate("JPY", "KWD", 250, "manual", "2026-01-01")
        .unwrap();
    assert_eq!(row.rate_millionths, 250);
}

#[test]
fn exchange_rate_large_rate() {
    // 149.50 = 149_500_000.
    let conn = setup();
    seed_common_currencies(&conn);
    let s = store(&conn);

    let row = s
        .create_exchange_rate("USD", "JPY", 149_500_000, "ecb", "2026-06-28")
        .unwrap();
    assert_eq!(row.rate_millionths, 149_500_000);
}

// ── Exchange rate timestamps ─────────────────────────────────────────

#[test]
fn exchange_rate_created_at_is_set() {
    let conn = setup();
    seed_common_currencies(&conn);
    let s = store(&conn);

    let row = s
        .create_exchange_rate("USD", "EUR", 920_000, "ecb", "2026-06-28")
        .unwrap();
    assert!(!row.created_at.is_empty(), "created_at should be populated");
    assert!(
        row.created_at.contains('T'),
        "created_at should be ISO-8601: {}",
        row.created_at
    );
    assert!(
        row.created_at.ends_with('Z'),
        "created_at should be UTC: {}",
        row.created_at
    );
}

#[test]
fn exchange_rate_effective_date_roundtrips() {
    let conn = setup();
    seed_common_currencies(&conn);
    let s = store(&conn);

    let row = s
        .create_exchange_rate("GBP", "CAD", 1_720_000, "manual", "2026-07-15")
        .unwrap();
    assert_eq!(row.effective_date, "2026-07-15");
}

// ── Exchange rate delete ─────────────────────────────────────────────

#[test]
fn exchange_rate_delete_then_list() {
    let conn = setup();
    seed_common_currencies(&conn);
    let s = store(&conn);

    s.create_exchange_rate("USD", "EUR", 920_000, "ecb", "2026-06-28")
        .unwrap();
    s.create_exchange_rate("USD", "GBP", 790_000, "ecb", "2026-06-28")
        .unwrap();

    let before = s.list_exchange_rates().unwrap();
    assert_eq!(before.len(), 2);

    s.delete_exchange_rate(&before[0].id).unwrap();

    let after = s.list_exchange_rates().unwrap();
    assert_eq!(after.len(), 1);
    assert_eq!(after[0].id, before[1].id);
}

#[test]
fn exchange_rate_delete_nonexistent_returns_not_found() {
    let conn = setup();
    let s = store(&conn);

    let result = s.delete_exchange_rate("non-existent-id");
    assert!(matches!(result, Err(kasirmu_core::CoreError::NotFound { .. })));
}

// ── Exchange rate source field ───────────────────────────────────────

#[test]
fn exchange_rate_source_roundtrips() {
    let conn = setup();
    seed_common_currencies(&conn);
    let s = store(&conn);

    let row = s
        .create_exchange_rate("USD", "EUR", 920_000, "European Central Bank", "2026-06-28")
        .unwrap();
    assert_eq!(row.source, "European Central Bank");
}

#[test]
fn exchange_rate_different_sources() {
    let conn = setup();
    seed_common_currencies(&conn);
    let s = store(&conn);

    let manual = s
        .create_exchange_rate("USD", "EUR", 920_000, "manual", "2026-06-28")
        .unwrap();
    let api = s
        .create_exchange_rate("USD", "GBP", 790_000, "ecb", "2026-06-28")
        .unwrap();

    assert_eq!(manual.source, "manual");
    assert_eq!(api.source, "ecb");
}

// ── Currencies list ──────────────────────────────────────────────────

#[test]
fn currencies_list_ordered_by_code() {
    let conn = setup();
    seed_common_currencies(&conn);
    let s = store(&conn);

    let currencies = s.list_currencies().unwrap();
    assert_eq!(currencies.len(), 7);
    assert_eq!(currencies[0].0, "CAD");
    assert_eq!(currencies[1].0, "EUR");
    assert_eq!(currencies[2].0, "GBP");
    assert_eq!(currencies[3].0, "IDR");
    assert_eq!(currencies[4].0, "JPY");
    assert_eq!(currencies[5].0, "KWD");
    assert_eq!(currencies[6].0, "USD");
}

#[test]
fn currencies_list_empty_db() {
    let conn = setup();

    conn.execute("DELETE FROM exchange_rates", []).unwrap();
    conn.execute("DELETE FROM currencies", []).unwrap();

    let s = store(&conn);
    let currencies = s.list_currencies().unwrap();
    assert!(currencies.is_empty());
}

#[test]
fn currencies_list_contains_all_fields() {
    let conn = setup();

    conn.execute("DELETE FROM exchange_rates", []).unwrap();
    conn.execute("DELETE FROM currencies", []).unwrap();

    seed_currency(&conn, "USD", "840", "US Dollar", 2, "$");
    let s = store(&conn);

    let currencies = s.list_currencies().unwrap();
    assert_eq!(currencies.len(), 1);
    let (code, name, minor_exponent, symbol) = &currencies[0];
    assert_eq!(code, "USD");
    assert_eq!(name, "US Dollar");
    assert_eq!(*minor_exponent, 2);
    assert_eq!(symbol, "$");
}

// ── Money multi-currency ─────────────────────────────────────────────

#[test]
fn money_same_currency_add() {
    let a = price(100, usd()); // $1.00
    let b = price(250, usd()); // $2.50
    let result = a.checked_add(b).unwrap();
    assert_eq!(result.minor_units, 350);
    assert_eq!(result.currency, usd());
}

#[test]
fn money_different_currency_add_returns_none() {
    let a = price(100, usd());
    let b = price(200, eur());
    assert!(
        a.checked_add(b).is_none(),
        "cannot add different currencies"
    );
}

#[test]
fn money_overflow_returns_none() {
    let a = Money {
        minor_units: i64::MAX,
        currency: usd(),
    };
    let b = price(1, usd());
    assert!(a.checked_add(b).is_none(), "overflow should return None");
}

// ── Money from_major ─────────────────────────────────────────────────

#[test]
fn money_from_major_usd() {
    let m = Money::from_major(12, usd()).unwrap();
    assert_eq!(m.minor_units, 1200);
}

#[test]
fn money_from_major_eur() {
    let m = Money::from_major(5, eur()).unwrap();
    assert_eq!(m.minor_units, 500);
}

#[test]
fn money_from_major_jpy_zero_exponent() {
    let m = Money::from_major(1500, jpy()).unwrap();
    assert_eq!(m.minor_units, 1500, "JPY has 0 decimal places");
}

#[test]
fn money_from_major_kwd_three_exponents() {
    let kwd: Currency = "KWD".parse().unwrap();
    let m = Money::from_major(10, kwd).unwrap();
    assert_eq!(
        m.minor_units, 10_000,
        "KWD has 3 decimal places: 10 * 1000 = 10000"
    );
}

#[test]
fn money_from_major_overflow_returns_none() {
    let kwd: Currency = "KWD".parse().unwrap();
    assert!(
        Money::from_major(i64::MAX, kwd).is_none(),
        "overflow should return None"
    );
}

// ── Currency parsing ─────────────────────────────────────────────────

#[test]
fn currency_parse_valid_codes() {
    assert!("USD".parse::<Currency>().is_ok());
    assert!("eur".parse::<Currency>().is_ok());
    assert!("JpY".parse::<Currency>().is_ok());
    assert!("XXX".parse::<Currency>().is_ok());
}

#[test]
fn currency_parse_invalid_codes() {
    assert!(
        "US".parse::<Currency>().is_err(),
        "2-letter code should fail"
    );
    assert!(
        "USDD".parse::<Currency>().is_err(),
        "4-letter code should fail"
    );
    assert!(
        "U2D".parse::<Currency>().is_err(),
        "code with digit should fail"
    );
    assert!("".parse::<Currency>().is_err(), "empty string should fail");
    assert!(
        "usd ".parse::<Currency>().is_err(),
        "trailing space should fail"
    );
}

#[test]
fn currency_minor_unit_exponent() {
    assert_eq!(usd().minor_unit_exponent(), 2);
    assert_eq!(eur().minor_unit_exponent(), 2);
    assert_eq!(jpy().minor_unit_exponent(), 0);
    assert_eq!("IDR".parse::<Currency>().unwrap().minor_unit_exponent(), 0);
    assert_eq!("KRW".parse::<Currency>().unwrap().minor_unit_exponent(), 0);
    assert_eq!("VND".parse::<Currency>().unwrap().minor_unit_exponent(), 0);
    assert_eq!("CLP".parse::<Currency>().unwrap().minor_unit_exponent(), 0);
    assert_eq!("KWD".parse::<Currency>().unwrap().minor_unit_exponent(), 3);
    assert_eq!("OMR".parse::<Currency>().unwrap().minor_unit_exponent(), 3);
    assert_eq!("BHD".parse::<Currency>().unwrap().minor_unit_exponent(), 3);
    assert_eq!("JOD".parse::<Currency>().unwrap().minor_unit_exponent(), 3);
    assert_eq!("TND".parse::<Currency>().unwrap().minor_unit_exponent(), 3);
}

// ── Currency zero ────────────────────────────────────────────────────

#[test]
fn money_zero_different_currencies() {
    let zero_usd = Money::zero(usd());
    assert_eq!(zero_usd.minor_units, 0);
    assert_eq!(zero_usd.currency, usd());

    let zero_eur = Money::zero(eur());
    assert_eq!(zero_eur.minor_units, 0);
    assert_eq!(zero_eur.currency, eur());
}

// ── Exchange rate roundtrip through Store ────────────────────────────

#[test]
fn exchange_rate_all_fields_roundtrip() {
    let conn = setup();
    seed_currency(&conn, "USD", "840", "US Dollar", 2, "$");
    seed_currency(&conn, "JPY", "392", "Japanese Yen", 0, "\u{a5}");
    let s = store(&conn);

    let created = s
        .create_exchange_rate("USD", "JPY", 149_500_000, "ecb", "2026-06-28")
        .unwrap();

    let rates = s.list_exchange_rates().unwrap();
    assert_eq!(rates.len(), 1);

    let loaded = &rates[0];
    assert_eq!(loaded.id, created.id);
    assert_eq!(loaded.from_currency, "USD");
    assert_eq!(loaded.to_currency, "JPY");
    assert_eq!(loaded.rate_millionths, 149_500_000);
    assert_eq!(loaded.source, "ecb");
    assert_eq!(loaded.effective_date, "2026-06-28");
    assert!(!loaded.created_at.is_empty());
}

// ── Exchange rate display_rate formatting ────────────────────────────

#[test]
fn display_rate_two_decimals() {
    let conn = setup();
    seed_common_currencies(&conn);
    let s = store(&conn);
    let row = s
        .create_exchange_rate("USD", "EUR", 920_000, "ecb", "2026-06-28")
        .unwrap();
    assert_eq!(row.display_rate(), "0.92");
    assert_eq!(
        modules_currency::ExchangeRateRow::display_rate(&row),
        "0.92"
    );
}

#[test]
fn display_rate_six_decimals_kept() {
    let conn = setup();
    seed_common_currencies(&conn);
    let s = store(&conn);
    let row = s
        .create_exchange_rate("JPY", "KWD", 250, "manual", "2026-01-01")
        .unwrap();
    assert_eq!(row.display_rate(), "0.00025");
}

#[test]
fn display_rate_trailing_zeros_trimmed() {
    let conn = setup();
    seed_common_currencies(&conn);
    let s = store(&conn);
    let row = s
        .create_exchange_rate("USD", "JPY", 149_500_000, "ecb", "2026-06-28")
        .unwrap();
    assert_eq!(row.display_rate(), "149.5");
}

#[test]
fn display_rate_integer_only() {
    let conn = setup();
    seed_currency(&conn, "BTC", "1000", "Bitcoin", 8, "\u{20bf}");
    seed_currency(&conn, "USD", "840", "US Dollar", 2, "$");
    let s = store(&conn);
    let row = s
        .create_exchange_rate("BTC", "USD", 50_000_000, "market", "2026-06-20")
        .unwrap();
    assert_eq!(row.display_rate(), "50");
}

// ── Exchange rate unique constraint (same pair + same date) ──────────

#[test]
fn exchange_rate_duplicate_pair_date_rejected() {
    let conn = setup();
    seed_common_currencies(&conn);
    let s = store(&conn);

    s.create_exchange_rate("USD", "EUR", 900_000, "ecb", "2026-06-28")
        .unwrap();
    let result = s.create_exchange_rate("USD", "EUR", 920_000, "ecb", "2026-06-28");
    assert!(
        result.is_err(),
        "duplicate from_currency + to_currency + effective_date should be rejected"
    );
}

#[test]
fn exchange_rate_same_pair_different_dates_allowed() {
    let conn = setup();
    seed_common_currencies(&conn);
    let s = store(&conn);

    s.create_exchange_rate("USD", "EUR", 900_000, "ecb", "2026-01-15")
        .unwrap();
    s.create_exchange_rate("USD", "EUR", 920_000, "ecb", "2026-06-28")
        .unwrap();

    let rates = s.list_exchange_rates().unwrap();
    assert_eq!(
        rates.len(),
        2,
        "different effective dates should be allowed"
    );
}
