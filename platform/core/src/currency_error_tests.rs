//! Sibling unit tests for the currency half of `error.rs`
//! (AGENTS.md: no tests in production files).
//!
//! Moved here with the type from `modules/currency/src/error_tests.rs`; the
//! assertions are unchanged, and `platform_core::PlatformError` became plain
//! `PlatformError` because a crate cannot name itself by path.

use super::*;

#[test]
fn currency_error_validation_message() {
    let err = CurrencyError::validation("rate_millionths", "rate must be positive");
    assert!(matches!(err, CurrencyError::Validation { field, .. } if field == "rate_millionths"));
    assert_eq!(
        format!("{err}"),
        "validation error on rate_millionths: rate must be positive"
    );
}

#[test]
fn currency_error_not_found_message() {
    let err = CurrencyError::NotFound {
        entity: "exchange_rate",
        id: "bad-id".into(),
    };
    assert_eq!(format!("{err}"), "not found: exchange_rate bad-id");
}

#[test]
fn currency_error_from_rusqlite() {
    // Build a rusqlite error without needing a real DB.
    let rusqlite_err = rusqlite::Error::QueryReturnedNoRows;
    let err = CurrencyError::from(rusqlite_err);
    assert!(matches!(err, CurrencyError::Db(_)));
}

#[test]
fn currency_error_platform_message() {
    let err = CurrencyError::Platform(PlatformError::Internal("settings read failed".into()));
    assert_eq!(
        format!("{err}"),
        "platform error: internal error: settings read failed"
    );
}

#[test]
fn currency_error_from_platform_error() {
    let platform_err = PlatformError::Internal("test".into());
    let err = CurrencyError::from(platform_err);
    assert!(matches!(err, CurrencyError::Platform(_)));
}
