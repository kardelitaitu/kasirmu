//! Unit tests for the currency command bodies (Wave-A test relocation: moved
//! out of `apps/desktop-client/src/commands/currencies_tests.rs`).
//!
//! Mounted at the foot of `currency.rs` with `#[cfg(test)] #[path]`, so
//! `use super::*` resolves the DTOs and the pure lookup exactly as the desktop
//! sibling module did. Nothing here needs a `TestBridge`: every case is either
//! the session-free `currency_info` lookup or a plain DTO conformance check.
//! The bridge's `currency_info` is a synchronous `&str` function (the `String`
//! + `async` form is the desktop `#[tauri::command]` wrapper), so the three
//! lookup cases dropped their `.await` and are plain `#[test]`s; the asserted
//! behaviour is unchanged.

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
