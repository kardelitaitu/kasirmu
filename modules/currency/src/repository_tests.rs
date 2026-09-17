//! Sibling unit tests for `repository.rs` (AGENTS.md: no tests in
//! production files).

use super::*;
use rusqlite::Connection;

fn fresh() -> Connection {
    kasirmu_core::migrations::fresh_db()
}

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
        )
        .unwrap();
}

#[test]
fn list_exchange_rates_empty() {
    let conn = fresh();
    let repo = CurrencyRepository::new(&conn);
    let rates = repo.list_exchange_rates().unwrap();
    assert!(rates.is_empty());
}

#[test]
fn create_exchange_rate_and_find_in_list() {
    let conn = fresh();
    seed_currency(&conn, "USD", "840", "US Dollar", 2, "$");
    seed_currency(&conn, "EUR", "978", "Euro", 2, "\u{20ac}");
    seed_currency(&conn, "JPY", "392", "Japanese Yen", 0, "\u{a5}");
    let repo = CurrencyRepository::new(&conn);
    repo.create_exchange_rate("USD", "EUR", 920_000, "ecb", "2026-06-28")
        .unwrap();
    repo.create_exchange_rate("USD", "JPY", 149_500_000, "ecb", "2026-06-28")
        .unwrap();

    let rates = repo.list_exchange_rates().unwrap();
    assert_eq!(rates.len(), 2);
    assert!(rates.iter().any(|r| r.to_currency == "EUR"));
    assert!(rates.iter().any(|r| r.to_currency == "JPY"));
}

#[test]
fn create_exchange_rate_rejects_zero_rate() {
    let conn = fresh();
    seed_currency(&conn, "USD", "840", "US Dollar", 2, "$");
    seed_currency(&conn, "EUR", "978", "Euro", 2, "\u{20ac}");
    let repo = CurrencyRepository::new(&conn);
    let result = repo.create_exchange_rate("USD", "EUR", 0, "manual", "2026-01-01");
    assert!(result.is_err(), "zero rate must be rejected");
}

#[test]
fn create_exchange_rate_rejects_negative_rate() {
    let conn = fresh();
    seed_currency(&conn, "USD", "840", "US Dollar", 2, "$");
    seed_currency(&conn, "EUR", "978", "Euro", 2, "\u{20ac}");
    let repo = CurrencyRepository::new(&conn);
    let result = repo.create_exchange_rate("USD", "EUR", -500_000, "manual", "2026-01-01");
    assert!(result.is_err(), "negative rate must be rejected");
}

#[test]
fn upsert_exchange_rate_replaces_existing() {
    let conn = fresh();
    seed_currency(&conn, "USD", "840", "US Dollar", 2, "$");
    seed_currency(&conn, "EUR", "978", "Euro", 2, "\u{20ac}");
    let repo = CurrencyRepository::new(&conn);
    let first = repo
        .create_exchange_rate("USD", "EUR", 900_000, "manual", "2026-07-01")
        .unwrap();
    let second = repo
        .upsert_exchange_rate("USD", "EUR", 920_000, "auto-sync", "2026-07-01")
        .unwrap();
    assert_ne!(first.id, second.id);
    assert_eq!(second.rate_millionths, 920_000);
    assert_eq!(second.source, "auto-sync");
    let rates = repo.list_exchange_rates().unwrap();
    assert_eq!(rates.len(), 1);
}

#[test]
fn delete_exchange_rate_removes() {
    let conn = fresh();
    seed_currency(&conn, "USD", "840", "US Dollar", 2, "$");
    seed_currency(&conn, "CAD", "124", "Canadian Dollar", 2, "CA$");
    let repo = CurrencyRepository::new(&conn);
    let row = repo
        .create_exchange_rate("USD", "CAD", 1_360_000, "manual", "2026-06-28")
        .unwrap();
    repo.delete_exchange_rate(&row.id).unwrap();
    let rates = repo.list_exchange_rates().unwrap();
    assert!(rates.is_empty());
}

#[test]
fn delete_exchange_rate_not_found() {
    let conn = fresh();
    let repo = CurrencyRepository::new(&conn);
    let result = repo.delete_exchange_rate("bad-id");
    assert!(matches!(result, Err(CurrencyError::NotFound { .. })));
}

#[test]
fn upsert_exchange_rate_rejects_zero_rate() {
    let conn = fresh();
    seed_currency(&conn, "USD", "840", "US Dollar", 2, "$");
    seed_currency(&conn, "EUR", "978", "Euro", 2, "\u{20ac}");
    let repo = CurrencyRepository::new(&conn);
    let result = repo.upsert_exchange_rate("USD", "EUR", 0, "manual", "2026-01-01");
    assert!(result.is_err(), "upsert zero rate must be rejected");
}

#[test]
fn upsert_exchange_rate_rejects_negative_rate() {
    let conn = fresh();
    seed_currency(&conn, "USD", "840", "US Dollar", 2, "$");
    seed_currency(&conn, "EUR", "978", "Euro", 2, "\u{20ac}");
    let repo = CurrencyRepository::new(&conn);
    let result = repo.upsert_exchange_rate("USD", "EUR", -1, "manual", "2026-01-01");
    assert!(result.is_err(), "upsert negative rate must be rejected");
}

#[test]
fn list_exchange_rates_orders_by_from_then_to_currency() {
    let conn = fresh();
    seed_currency(&conn, "USD", "840", "US Dollar", 2, "$");
    seed_currency(&conn, "EUR", "978", "Euro", 2, "\u{20ac}");
    seed_currency(&conn, "GBP", "826", "Pound", 2, "\u{a3}");
    let repo = CurrencyRepository::new(&conn);

    // Insert out of alphabetical order.
    repo.create_exchange_rate("USD", "GBP", 790_000, "ecb", "2026-06-28")
        .unwrap();
    repo.create_exchange_rate("EUR", "USD", 1_080_000, "ecb", "2026-06-28")
        .unwrap();
    repo.create_exchange_rate("USD", "EUR", 920_000, "ecb", "2026-06-28")
        .unwrap();
    repo.create_exchange_rate("GBP", "USD", 1_260_000, "ecb", "2026-06-28")
        .unwrap();

    let rates = repo.list_exchange_rates().unwrap();
    assert_eq!(rates.len(), 4);
    assert_eq!(rates[0].from_currency, "EUR");
    assert_eq!(rates[1].from_currency, "GBP");
    assert_eq!(rates[2].from_currency, "USD");
    assert_eq!(rates[3].from_currency, "USD");
    assert_eq!(rates[2].to_currency, "EUR");
    assert_eq!(rates[3].to_currency, "GBP");
}

// ── CUR-04: latest-effective-rate selection ─────────────────────────

#[test]
fn get_latest_exchange_rate_prefers_most_recent_on_or_before() {
    let conn = fresh();
    seed_currency(&conn, "USD", "840", "US Dollar", 2, "$");
    seed_currency(&conn, "IDR", "360", "Rupiah", 0, "Rp");
    let repo = CurrencyRepository::new(&conn);

    // Two historical rates plus one future rate.
    repo.create_exchange_rate("USD", "IDR", 15_000_000_000, "manual", "2026-06-01")
        .unwrap();
    repo.create_exchange_rate("USD", "IDR", 16_000_000_000, "manual", "2026-07-01")
        .unwrap();
    repo.create_exchange_rate("USD", "IDR", 17_000_000_000, "manual", "2026-08-01")
        .unwrap();

    // As of 2026-07-15 → the 2026-07-01 rate wins.
    let r = repo
        .get_latest_exchange_rate("USD", "IDR", "2026-07-15")
        .unwrap()
        .expect("rate must exist");
    assert_eq!(r.rate_millionths, 16_000_000_000);
    assert_eq!(r.effective_date, "2026-07-01");

    // Exactly on the rate's date → that rate wins (inclusive bound).
    let r = repo
        .get_latest_exchange_rate("USD", "IDR", "2026-07-01")
        .unwrap()
        .expect("rate must exist");
    assert_eq!(r.rate_millionths, 16_000_000_000);

    // Before the oldest rate → forward-looking fallback to the earliest.
    let r = repo
        .get_latest_exchange_rate("USD", "IDR", "2026-05-01")
        .unwrap()
        .expect("forward fallback must exist");
    assert_eq!(r.rate_millionths, 15_000_000_000);

    // No rate for the pair → None.
    assert!(
        repo.get_latest_exchange_rate("USD", "EUR", "2026-07-15")
            .unwrap()
            .is_none()
    );
}

#[test]
fn list_exchange_rates_for_pair_bounds_to_pair_and_orders_recent_first() {
    let conn = fresh();
    seed_currency(&conn, "USD", "840", "US Dollar", 2, "$");
    seed_currency(&conn, "IDR", "360", "Rupiah", 0, "Rp");
    seed_currency(&conn, "JPY", "392", "Yen", 0, "\u{a5}");
    let repo = CurrencyRepository::new(&conn);

    repo.create_exchange_rate("USD", "IDR", 15_000_000_000, "manual", "2026-06-01")
        .unwrap();
    repo.create_exchange_rate("USD", "IDR", 16_000_000_000, "manual", "2026-07-01")
        .unwrap();
    repo.create_exchange_rate("USD", "JPY", 149_000_000, "manual", "2026-07-01")
        .unwrap();

    let usd_idr = repo.list_exchange_rates_for_pair("USD", "IDR").unwrap();
    assert_eq!(usd_idr.len(), 2, "only the USD→IDR pair rows");
    assert_eq!(usd_idr[0].effective_date, "2026-07-01", "most recent first");
    assert_eq!(usd_idr[1].effective_date, "2026-06-01", "older second");
    assert!(
        usd_idr.iter().all(|r| r.to_currency == "IDR"),
        "pair-bounded query must not leak other pairs"
    );
}

#[test]
fn upsert_creates_separate_rows_for_different_dates() {
    let conn = fresh();
    seed_currency(&conn, "USD", "840", "US Dollar", 2, "$");
    seed_currency(&conn, "EUR", "978", "Euro", 2, "\u{20ac}");
    let repo = CurrencyRepository::new(&conn);

    let first = repo
        .upsert_exchange_rate("USD", "EUR", 900_000, "ecb", "2026-01-15")
        .unwrap();
    let second = repo
        .upsert_exchange_rate("USD", "EUR", 920_000, "ecb", "2026-06-28")
        .unwrap();

    assert_ne!(first.id, second.id);
    let rates = repo.list_exchange_rates().unwrap();
    assert_eq!(rates.len(), 2);
}

#[test]
fn create_and_repository_return_equivalent_rows() {
    let conn = fresh();
    seed_currency(&conn, "USD", "840", "US Dollar", 2, "$");
    seed_currency(&conn, "IDR", "360", "Indonesian Rupiah", 0, "Rp");
    let repo = CurrencyRepository::new(&conn);

    // Use a large but realistic cross-rate value (USD→IDR) to confirm
    // i64 fixed-point rates round-trip unchanged.
    let created = repo
        .create_exchange_rate("USD", "IDR", 15_600_000_000i64, "manual", "2026-07-25")
        .unwrap();
    let listed = repo.list_exchange_rates().unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0], created);
    assert_eq!(created.from_currency, "USD");
    assert_eq!(created.to_currency, "IDR");
    assert_eq!(created.rate_millionths, 15_600_000_000i64);
}

#[test]
fn list_currencies_empty_db() {
    let conn = fresh();
    conn.execute("DELETE FROM currencies", []).unwrap();
    let repo = CurrencyRepository::new(&conn);
    let currencies = repo.list_currencies().unwrap();
    assert!(currencies.is_empty());
}

#[test]
fn list_currencies_returns_all_fields() {
    let conn = fresh();
    conn.execute("DELETE FROM currencies", []).unwrap();
    seed_currency(&conn, "EUR", "978", "Euro", 2, "\u{20ac}");
    let repo = CurrencyRepository::new(&conn);
    let currencies = repo.list_currencies().unwrap();
    assert_eq!(currencies.len(), 1);
    assert_eq!(currencies[0].code, "EUR");
    assert_eq!(currencies[0].name, "Euro");
    assert_eq!(currencies[0].minor_exponent, 2);
    assert_eq!(currencies[0].symbol, "\u{20ac}");
}

// ── Input validation ────────────────────────────────────────────────

#[test]
fn create_exchange_rate_rejects_empty_from_currency() {
    let conn = fresh();
    seed_currency(&conn, "USD", "840", "US Dollar", 2, "$");
    let repo = CurrencyRepository::new(&conn);
    let err = repo
        .create_exchange_rate("", "USD", 100_000, "manual", "2026-01-01")
        .unwrap_err();
    assert!(matches!(
        err,
        CurrencyError::Validation {
            field: "from_currency",
            ..
        }
    ));
}

#[test]
fn create_exchange_rate_rejects_empty_to_currency() {
    let conn = fresh();
    seed_currency(&conn, "USD", "840", "US Dollar", 2, "$");
    let repo = CurrencyRepository::new(&conn);
    let err = repo
        .create_exchange_rate("USD", "", 100_000, "manual", "2026-01-01")
        .unwrap_err();
    assert!(matches!(
        err,
        CurrencyError::Validation {
            field: "to_currency",
            ..
        }
    ));
}

#[test]
fn create_exchange_rate_rejects_empty_source() {
    let conn = fresh();
    seed_currency(&conn, "USD", "840", "US Dollar", 2, "$");
    seed_currency(&conn, "EUR", "978", "Euro", 2, "\u{20ac}");
    let repo = CurrencyRepository::new(&conn);
    let err = repo
        .create_exchange_rate("USD", "EUR", 100_000, "", "2026-01-01")
        .unwrap_err();
    assert!(matches!(
        err,
        CurrencyError::Validation {
            field: "source",
            ..
        }
    ));
}

#[test]
fn create_exchange_rate_rejects_empty_effective_date() {
    let conn = fresh();
    seed_currency(&conn, "USD", "840", "US Dollar", 2, "$");
    seed_currency(&conn, "EUR", "978", "Euro", 2, "\u{20ac}");
    let repo = CurrencyRepository::new(&conn);
    let err = repo
        .create_exchange_rate("USD", "EUR", 100_000, "manual", "")
        .unwrap_err();
    assert!(matches!(
        err,
        CurrencyError::Validation {
            field: "effective_date",
            ..
        }
    ));
}

#[test]
fn upsert_exchange_rate_rejects_empty_from_currency() {
    let conn = fresh();
    let repo = CurrencyRepository::new(&conn);
    let err = repo
        .upsert_exchange_rate("", "USD", 100_000, "manual", "2026-01-01")
        .unwrap_err();
    assert!(matches!(
        err,
        CurrencyError::Validation {
            field: "from_currency",
            ..
        }
    ));
}

#[test]
fn upsert_exchange_rate_rejects_empty_to_currency() {
    let conn = fresh();
    let repo = CurrencyRepository::new(&conn);
    let err = repo
        .upsert_exchange_rate("USD", "", 100_000, "manual", "2026-01-01")
        .unwrap_err();
    assert!(matches!(
        err,
        CurrencyError::Validation {
            field: "to_currency",
            ..
        }
    ));
}

#[test]
fn upsert_exchange_rate_rejects_empty_source() {
    let conn = fresh();
    let repo = CurrencyRepository::new(&conn);
    let err = repo
        .upsert_exchange_rate("USD", "EUR", 100_000, "", "2026-01-01")
        .unwrap_err();
    assert!(matches!(
        err,
        CurrencyError::Validation {
            field: "source",
            ..
        }
    ));
}

#[test]
fn upsert_exchange_rate_rejects_empty_effective_date() {
    let conn = fresh();
    let repo = CurrencyRepository::new(&conn);
    let err = repo
        .upsert_exchange_rate("USD", "EUR", 100_000, "manual", "")
        .unwrap_err();
    assert!(matches!(
        err,
        CurrencyError::Validation {
            field: "effective_date",
            ..
        }
    ));
}

#[test]
fn list_currencies_ordered_by_code() {
    let conn = fresh();
    conn.execute("DELETE FROM currencies", []).unwrap();
    seed_currency(&conn, "USD", "840", "US Dollar", 2, "$");
    seed_currency(&conn, "EUR", "978", "Euro", 2, "\u{20ac}");
    seed_currency(&conn, "CAD", "124", "Canadian Dollar", 2, "CA$");
    let repo = CurrencyRepository::new(&conn);
    let currencies = repo.list_currencies().unwrap();
    assert_eq!(currencies.len(), 3);
    assert_eq!(currencies[0].code, "CAD");
    assert_eq!(currencies[1].code, "EUR");
    assert_eq!(currencies[2].code, "USD");
}

// ── Input normalization: whitespace handling ─────────────────────

#[test]
fn create_exchange_rate_normalizes_currency_whitespace() {
    // "USD " (trailing space) passes the trim().is_empty() validation
    // but must be stored normalized so a "USD" lookup finds it.
    let conn = fresh();
    seed_currency(&conn, "USD", "840", "US Dollar", 2, "$");
    seed_currency(&conn, "EUR", "978", "Euro", 2, "\u{20ac}");
    let repo = CurrencyRepository::new(&conn);
    let row = repo
        .create_exchange_rate("USD ", "EUR", 920_000, "ecb", "2026-06-28")
        .unwrap();
    assert_eq!(row.from_currency, "USD", "from_currency must be trimmed");
    let found = repo
        .get_latest_exchange_rate("USD", "EUR", "2026-07-01")
        .unwrap()
        .expect("rate must be findable by normalized code");
    assert_eq!(found.id, row.id);
}

#[test]
fn create_exchange_rate_rejects_whitespace_only_currency() {
    let conn = fresh();
    let repo = CurrencyRepository::new(&conn);
    let err = repo
        .create_exchange_rate("   ", "EUR", 920_000, "ecb", "2026-06-28")
        .unwrap_err();
    assert!(matches!(
        err,
        CurrencyError::Validation {
            field: "from_currency",
            ..
        }
    ));
}

#[test]
fn upsert_exchange_rate_normalizes_currency_whitespace() {
    let conn = fresh();
    seed_currency(&conn, "USD", "840", "US Dollar", 2, "$");
    seed_currency(&conn, "EUR", "978", "Euro", 2, "\u{20ac}");
    let repo = CurrencyRepository::new(&conn);
    let row = repo
        .upsert_exchange_rate("USD ", "EUR", 920_000, "ecb", "2026-06-28")
        .unwrap();
    assert_eq!(row.from_currency, "USD", "from_currency must be trimmed");
    let found = repo
        .get_latest_exchange_rate("USD", "EUR", "2026-07-01")
        .unwrap()
        .expect("rate must be findable by normalized code");
    assert_eq!(found.id, row.id);
}

// ── Currency-format settings delegation (R2 Phase 5) ─────────────

#[test]
fn default_currency_defaults_to_none() {
    let conn = fresh();
    let repo = CurrencyRepository::new(&conn);
    assert_eq!(repo.get_default_currency().unwrap(), None);
}

#[test]
fn default_currency_roundtrip() {
    let conn = fresh();
    let repo = CurrencyRepository::new(&conn);
    repo.set_default_currency("IDR").unwrap();
    assert_eq!(repo.get_default_currency().unwrap(), Some("IDR".into()));
    // Overwrite to a different code.
    repo.set_default_currency("USD").unwrap();
    assert_eq!(repo.get_default_currency().unwrap(), Some("USD".into()));
}

#[test]
fn currency_format_defaults_to_symbol() {
    let conn = fresh();
    let repo = CurrencyRepository::new(&conn);
    assert_eq!(repo.get_currency_format().unwrap(), "symbol");
}

#[test]
fn currency_format_roundtrip() {
    let conn = fresh();
    let repo = CurrencyRepository::new(&conn);
    repo.set_currency_format("code").unwrap();
    assert_eq!(repo.get_currency_format().unwrap(), "code");
}

#[test]
fn currency_symbol_position_defaults_to_prefix() {
    let conn = fresh();
    let repo = CurrencyRepository::new(&conn);
    assert_eq!(repo.get_currency_symbol_position().unwrap(), "prefix");
}

#[test]
fn currency_symbol_position_roundtrip() {
    let conn = fresh();
    let repo = CurrencyRepository::new(&conn);
    repo.set_currency_symbol_position("suffix").unwrap();
    assert_eq!(repo.get_currency_symbol_position().unwrap(), "suffix");
}

#[test]
fn currency_decimal_separator_defaults_to_dot() {
    let conn = fresh();
    let repo = CurrencyRepository::new(&conn);
    assert_eq!(repo.get_currency_decimal_separator().unwrap(), "dot");
}

#[test]
fn currency_decimal_separator_roundtrip() {
    let conn = fresh();
    let repo = CurrencyRepository::new(&conn);
    repo.set_currency_decimal_separator("comma").unwrap();
    assert_eq!(repo.get_currency_decimal_separator().unwrap(), "comma");
}

#[test]
fn currency_thousands_separator_defaults_to_comma() {
    let conn = fresh();
    let repo = CurrencyRepository::new(&conn);
    assert_eq!(repo.get_currency_thousands_separator().unwrap(), "comma");
}

#[test]
fn currency_thousands_separator_roundtrip() {
    let conn = fresh();
    let repo = CurrencyRepository::new(&conn);
    repo.set_currency_thousands_separator("space").unwrap();
    assert_eq!(repo.get_currency_thousands_separator().unwrap(), "space");
}

#[test]
fn all_currency_format_settings_are_independent() {
    // Each setting writes its own key: setting one must not disturb
    // the others (regression guard against key collisions).
    let conn = fresh();
    let repo = CurrencyRepository::new(&conn);
    repo.set_currency_format("code").unwrap();
    repo.set_currency_symbol_position("suffix").unwrap();
    repo.set_currency_decimal_separator("comma").unwrap();
    repo.set_currency_thousands_separator("dot").unwrap();
    repo.set_default_currency("EUR").unwrap();

    assert_eq!(repo.get_currency_format().unwrap(), "code");
    assert_eq!(repo.get_currency_symbol_position().unwrap(), "suffix");
    assert_eq!(repo.get_currency_decimal_separator().unwrap(), "comma");
    assert_eq!(repo.get_currency_thousands_separator().unwrap(), "dot");
    assert_eq!(repo.get_default_currency().unwrap(), Some("EUR".into()));
}

// ── get_latest_exchange_rate edge cases ──────────────────────────

#[test]
fn get_latest_unique_pair_date_constraint_prevents_duplicate_rows() {
    // The schema has UNIQUE (from_currency, to_currency, effective_date),
    // so creating a second rate for the same pair+date must fail with a
    // constraint violation — the created_at tie-break in the query is
    // defensive, not reachable through the repository API.
    let conn = fresh();
    seed_currency(&conn, "USD", "840", "US Dollar", 2, "$");
    seed_currency(&conn, "EUR", "978", "Euro", 2, "\u{20ac}");
    let repo = CurrencyRepository::new(&conn);
    repo.create_exchange_rate("USD", "EUR", 900_000, "manual", "2026-07-01")
        .unwrap();
    let result = repo.create_exchange_rate("USD", "EUR", 920_000, "manual", "2026-07-01");
    assert!(
        result.is_err(),
        "duplicate (from,to,effective_date) must be rejected by the UNIQUE constraint"
    );
}

#[test]
fn get_latest_forward_fallback_picks_earliest_future_rate() {
    // No rate on/before the date: the earliest future rate wins.
    let conn = fresh();
    seed_currency(&conn, "USD", "840", "US Dollar", 2, "$");
    seed_currency(&conn, "GBP", "826", "Pound", 2, "\u{a3}");
    let repo = CurrencyRepository::new(&conn);
    repo.create_exchange_rate("USD", "GBP", 780_000, "ecb", "2026-08-01")
        .unwrap();
    repo.create_exchange_rate("USD", "GBP", 790_000, "ecb", "2026-09-01")
        .unwrap();
    let got = repo
        .get_latest_exchange_rate("USD", "GBP", "2026-07-01")
        .unwrap()
        .expect("forward fallback must exist");
    assert_eq!(got.rate_millionths, 780_000, "earliest future rate");
    assert_eq!(got.effective_date, "2026-08-01");
}

#[test]
fn get_latest_exact_date_inclusive() {
    // The on-or-before bound is inclusive: a rate effective ON the
    // requested date must be selected.
    let conn = fresh();
    seed_currency(&conn, "USD", "840", "US Dollar", 2, "$");
    seed_currency(&conn, "JPY", "392", "Yen", 0, "\u{a5}");
    let repo = CurrencyRepository::new(&conn);
    repo.create_exchange_rate("USD", "JPY", 150_000_000, "ecb", "2026-07-15")
        .unwrap();
    let got = repo
        .get_latest_exchange_rate("USD", "JPY", "2026-07-15")
        .unwrap()
        .expect("rate effective on the date must be found");
    assert_eq!(got.rate_millionths, 150_000_000);
}

#[test]
fn get_latest_ignores_other_pairs() {
    // Only rates for the requested pair participate; an unrelated
    // pair's future/historical rates must not leak in.
    let conn = fresh();
    seed_currency(&conn, "USD", "840", "US Dollar", 2, "$");
    seed_currency(&conn, "EUR", "978", "Euro", 2, "\u{20ac}");
    seed_currency(&conn, "GBP", "826", "Pound", 2, "\u{a3}");
    let repo = CurrencyRepository::new(&conn);
    repo.create_exchange_rate("EUR", "GBP", 850_000, "ecb", "2026-01-01")
        .unwrap();
    assert!(
        repo.get_latest_exchange_rate("USD", "EUR", "2026-07-01")
            .unwrap()
            .is_none(),
        "an unrelated pair's rate must not satisfy a USD/EUR lookup"
    );
}

// ── FK enforcement + list-for-pair empty ─────────────────────────

#[test]
fn create_exchange_rate_rejects_unknown_currency() {
    // exchange_rates.from_currency/to_currency have FK references to
    // currencies(code); a code not in the table must be rejected.
    let conn = fresh();
    let repo = CurrencyRepository::new(&conn);
    let result = repo.create_exchange_rate("XXX", "EUR", 920_000, "manual", "2026-01-01");
    assert!(
        result.is_err(),
        "a rate for an unknown currency must be rejected by the FK"
    );
}

#[test]
fn upsert_exchange_rate_rejects_unknown_currency() {
    let conn = fresh();
    let repo = CurrencyRepository::new(&conn);
    let result = repo.upsert_exchange_rate("USD", "ZZZ", 920_000, "manual", "2026-01-01");
    assert!(
        result.is_err(),
        "an upsert for an unknown currency must be rejected by the FK"
    );
}

#[test]
fn list_exchange_rates_for_pair_empty_returns_empty() {
    let conn = fresh();
    let repo = CurrencyRepository::new(&conn);
    let rates = repo.list_exchange_rates_for_pair("USD", "EUR").unwrap();
    assert!(rates.is_empty(), "no rates for the pair → empty vec");
}

#[test]
fn list_exchange_rates_orders_recent_first_within_pair() {
    // CUR-04 residual: the PaymentModal no-session fallback picks the
    // FIRST row of a pair from this list. Ordered only by
    // (from, to), SQLite returns insertion order — so a pair whose
    // older rate was entered first surfaced the stale rate. Within a
    // pair the newest effective date must come first, matching
    // list_exchange_rates_for_pair.
    let conn = fresh();
    seed_currency(&conn, "USD", "840", "US Dollar", 2, "$");
    seed_currency(&conn, "IDR", "360", "Rupiah", 0, "Rp");
    let repo = CurrencyRepository::new(&conn);
    repo.create_exchange_rate("USD", "IDR", 15_000_000_000, "manual", "2026-01-05")
        .unwrap();
    repo.create_exchange_rate("USD", "IDR", 16_300_000_000, "manual", "2026-06-01")
        .unwrap();
    repo.create_exchange_rate("IDR", "USD", 61_000, "manual", "2026-06-01")
        .unwrap();

    let rates = repo.list_exchange_rates().unwrap();
    let usd_idr: Vec<_> = rates
        .iter()
        .filter(|r| r.from_currency == "USD" && r.to_currency == "IDR")
        .collect();
    assert_eq!(usd_idr.len(), 2);
    assert_eq!(
        usd_idr[0].effective_date, "2026-06-01",
        "newest effective rate must lead its pair"
    );
    assert_eq!(usd_idr[1].effective_date, "2026-01-05");
}

// ── CUR-11: bounded latest-per-pair listing ──────────────────────────

#[test]
fn list_latest_exchange_rates_returns_one_row_per_pair() {
    let conn = fresh();
    let repo = CurrencyRepository::new(&conn);
    seed_currency(&conn, "USD", "840", "US Dollar", 2, "$");
    seed_currency(&conn, "EUR", "978", "Euro", 2, "\u{20ac}");
    seed_currency(&conn, "JPY", "392", "Japanese Yen", 0, "\u{a5}");
    repo.create_exchange_rate("USD", "EUR", 900_000, "ecb", "2026-06-01")
        .unwrap();
    repo.create_exchange_rate("USD", "EUR", 920_000, "ecb", "2026-06-28")
        .unwrap();
    repo.create_exchange_rate("USD", "JPY", 149_500_000, "ecb", "2026-06-28")
        .unwrap();
    let rows = repo.list_latest_exchange_rates().unwrap();
    assert_eq!(rows.len(), 2, "one row per pair, not the full history");
    let eur = rows.iter().find(|r| r.to_currency == "EUR").unwrap();
    assert_eq!(eur.rate_millionths, 920_000, "newest effective_date wins");
    assert_eq!(eur.effective_date, "2026-06-28");
}

#[test]
fn list_latest_exchange_rates_is_pair_independent() {
    let conn = fresh();
    let repo = CurrencyRepository::new(&conn);
    seed_currency(&conn, "USD", "840", "US Dollar", 2, "$");
    seed_currency(&conn, "EUR", "978", "Euro", 2, "\u{20ac}");
    repo.create_exchange_rate("USD", "EUR", 900_000, "ecb", "2026-06-01")
        .unwrap();
    repo.create_exchange_rate("USD", "EUR", 920_000, "ecb", "2026-06-28")
        .unwrap();
    // Same dates, opposite direction — each pair resolves independently.
    repo.create_exchange_rate("EUR", "USD", 1_100_000, "ecb", "2026-06-10")
        .unwrap();
    let rows = repo.list_latest_exchange_rates().unwrap();
    assert_eq!(rows.len(), 2);
    let fwd = rows.iter().find(|r| r.to_currency == "EUR").unwrap();
    assert_eq!(fwd.rate_millionths, 920_000);
    let rev = rows.iter().find(|r| r.to_currency == "USD").unwrap();
    assert_eq!(rev.rate_millionths, 1_100_000);
}

#[test]
fn list_latest_exchange_rates_empty_table() {
    let conn = fresh();
    let repo = CurrencyRepository::new(&conn);
    assert!(repo.list_latest_exchange_rates().unwrap().is_empty());
}
