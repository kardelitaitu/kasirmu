//! Unit tests for the currency command bodies (Wave-A test relocation: moved
//! out of `apps/desktop-tauri/src/commands/currencies_tests.rs`).
//!
//! Mounted at the foot of `currency.rs` with `#[cfg(test)] #[path]`, so
//! `use super::*` resolves the DTOs and the pure lookup exactly as the desktop
//! sibling module did. The `currency_info` and DTO conformance cases need no
//! harness; the exchange-rate section appended from
//! `apps/desktop-tauri/src/commands/exchange_rates_tests.rs` drives the
//! global-database rate path through the crate's headless `TestBridge`.
//! The bridge's `currency_info` is a synchronous `&str` function (the
//! `String` + `async` form is the desktop `#[tauri::command]` wrapper), so the
//! three lookup cases dropped their `.await` and are plain `#[test]`s; the
//! asserted behaviour is unchanged.

use super::*;

#[test]
fn usd_has_exponent_2() {
    let info = currency_info("USD").unwrap();
    assert_eq!(info.exponent, 2);
}

#[test]
fn jpy_has_exponent_0() {
    let info = currency_info("JPY").unwrap();
    assert_eq!(info.exponent, 0);
}

#[test]
fn invalid_code_is_error() {
    assert!(currency_info("XX").is_err());
}

#[test]
fn currency_info_debug_output() {
    let info = CurrencyInfo {
        code: "USD".into(),
        exponent: 2,
    };
    let d = format!("{info:?}");
    assert!(d.contains("USD"));
    assert!(d.contains("2"));
}

#[test]
fn currency_info_serialize() {
    let info = CurrencyInfo {
        code: "IDR".into(),
        exponent: 0,
    };
    let json = serde_json::to_value(&info).unwrap();
    assert_eq!(json["code"], "IDR");
    assert_eq!(json["exponent"], 0);
}

#[test]
fn currency_dto_debug() {
    let dto = CurrencyDto {
        code: "EUR".into(),
        name: "Euro".into(),
        minor_exponent: 2,
        symbol: "€".into(),
    };
    let d = format!("{dto:?}");
    assert!(d.contains("Euro"));
}

#[test]
fn currency_dto_serialize() {
    let dto = CurrencyDto {
        code: "JPY".into(),
        name: "Yen".into(),
        minor_exponent: 0,
        symbol: "¥".into(),
    };
    let json = serde_json::to_value(&dto).unwrap();
    assert_eq!(json["code"], "JPY");
    assert_eq!(json["minor_exponent"], 0);
}

#[test]
fn set_default_currency_args_deserialize() {
    let json = r#"{"code":"USD"}"#;
    let args: SetDefaultCurrencyArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.code, "USD");
}

#[test]
fn set_default_currency_args_debug() {
    let args = SetDefaultCurrencyArgs { code: "IDR".into() };
    let d = format!("{args:?}");
    assert!(d.contains("IDR"));
}

// ── exchange-rate coverage (CUR-05 / CUR-03) ────────────────────────
//
// Wave-A test relocation: the cases below moved out of
// `apps/desktop-tauri/src/commands/exchange_rates_tests.rs`. The pure
// validation cases call the bridge's `validate_create_rate_args` directly —
// the desktop shim keeps an `AppError`-returning adapter over this function,
// so its `AppError::Invalid` assertions map 1:1 onto `BridgeError::Invalid`.
// The `create_exchange_rate` cases drive the global-database path through
// the crate's headless `TestBridge` (the desktop mock app managed an
// `AppState::for_test` whose global DB is the same fully-migrated in-memory
// database).

use crate::testing::TestBridge;

fn args(from: &str, to: &str, effective_date: Option<&str>) -> CreateExchangeRateArgs {
    CreateExchangeRateArgs {
        from_currency: from.into(),
        to_currency: to.into(),
        rate_millionths: 920_000,
        source: None,
        effective_date: effective_date.map(String::from),
    }
}

// ── validate_create_rate_args pure-function coverage (CUR-05) ──

#[test]
fn validate_rejects_empty_from_currency() {
    let err = validate_create_rate_args(&args("", "IDR", None)).unwrap_err();
    assert!(matches!(err, BridgeError::Invalid(msg) if msg.contains("from_currency")));
}

#[test]
fn validate_rejects_empty_to_currency() {
    let err = validate_create_rate_args(&args("USD", "", None)).unwrap_err();
    assert!(matches!(err, BridgeError::Invalid(msg) if msg.contains("to_currency")));
}

#[test]
fn validate_rejects_zero_and_negative_rate() {
    let mut a = args("USD", "IDR", None);
    a.rate_millionths = 0;
    let err = validate_create_rate_args(&a).unwrap_err();
    assert!(matches!(err, BridgeError::Invalid(msg) if msg.contains("positive")));

    a.rate_millionths = -1;
    let err = validate_create_rate_args(&a).unwrap_err();
    assert!(matches!(err, BridgeError::Invalid(msg) if msg.contains("positive")));
}

#[test]
fn validate_rejects_non_iso_to_currency() {
    // to_currency is validated too — not just from_currency.
    let err = validate_create_rate_args(&args("USD", "US1", None)).unwrap_err();
    assert!(matches!(err, BridgeError::Invalid(msg) if msg.contains("to_currency")));
}

#[test]
fn validate_rejects_same_currency_pair() {
    let err = validate_create_rate_args(&args("USD", "USD", None)).unwrap_err();
    assert!(matches!(err, BridgeError::Invalid(msg) if msg.contains("differ")));
}

#[test]
fn validate_accepts_valid_input() {
    assert!(validate_create_rate_args(&args("USD", "IDR", Some("2026-08-11"))).is_ok());
    assert!(validate_create_rate_args(&args("USD", "IDR", None)).is_ok());
}

// ── CUR-05: field-level validation on create_exchange_rate ──

#[tokio::test]
async fn create_exchange_rate_rejects_same_currency_pair() {
    // A rate from USD to USD is semantically meaningless and must fail
    // with a field-specific error, not persist (CUR-05).
    let bridge = TestBridge::new();
    let err = create_exchange_rate(&bridge.ctx(), &args("USD", "USD", None))
        .await
        .unwrap_err();
    assert!(matches!(
        err,
        BridgeError::Invalid(msg) if msg.contains("from_currency")
    ));
}

#[tokio::test]
async fn create_exchange_rate_rejects_non_iso_currency_code() {
    // "US1" is not a valid ISO-4217 code; the DB FK would accept any
    // 3-letter code the currencies table contains, so the command must
    // validate shape up front (CUR-05).
    let bridge = TestBridge::new();
    let err = create_exchange_rate(&bridge.ctx(), &args("US1", "IDR", None))
        .await
        .unwrap_err();
    assert!(matches!(
        err,
        BridgeError::Invalid(msg) if msg.contains("from_currency")
    ));
}

#[tokio::test]
async fn create_exchange_rate_rejects_malformed_effective_date() {
    // 2026-02-30 does not exist; a strict YYYY-MM-DD parse must reject
    // it with a field-specific error instead of persisting a date the
    // "latest effective rate" selection can never match (CUR-05).
    let bridge = TestBridge::new();
    let err = create_exchange_rate(&bridge.ctx(), &args("USD", "IDR", Some("2026-02-30")))
        .await
        .unwrap_err();
    assert!(matches!(
        err,
        BridgeError::Invalid(msg) if msg.contains("effective_date")
    ));
}

#[tokio::test]
async fn create_exchange_rate_accepts_valid_input() {
    // Positive path: valid pair + ISO codes + strict date persist and
    // round-trip through the DTO.
    let bridge = TestBridge::new();
    let dto = create_exchange_rate(&bridge.ctx(), &args("USD", "IDR", Some("2026-08-11")))
        .await
        .unwrap();
    assert_eq!(dto.from_currency, "USD");
    assert_eq!(dto.to_currency, "IDR");
    assert_eq!(dto.rate_millionths, 920_000);
}
