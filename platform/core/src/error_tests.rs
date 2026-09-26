//! Unit tests for `error`.
//!
//! Moved out of `error.rs` to satisfy the AGENTS.md section 2 rule that unit
//! tests live in a sibling `*_tests.rs` file rather than inside a production
//! `.rs` file. Wired from `error.rs` with:
//!   `#[cfg(test)] #[path = "error_tests.rs"] mod tests;`

use super::*;

#[test]
fn db_error_display() {
    let err = PlatformError::Db(rusqlite::Error::InvalidParameterName("x".into()));
    let msg = err.to_string();
    assert!(
        msg.starts_with("database error:"),
        "expected db error prefix, got: {msg}"
    );
}

#[test]
fn not_found_error_display() {
    let err = PlatformError::NotFound("setting.key".into());
    assert_eq!(err.to_string(), "not found: setting.key");
}

#[test]
fn internal_error_display() {
    let err = PlatformError::Internal("something went wrong".into());
    assert_eq!(err.to_string(), "internal error: something went wrong");
}

#[test]
fn platform_error_debug() {
    let err = PlatformError::Internal("test".into());
    assert!(!format!("{err:?}").is_empty());
}

#[test]
fn from_rusqlite_error() {
    let inner = rusqlite::Error::InvalidColumnName("col".into());
    let err: PlatformError = inner.into();
    assert!(err.to_string().contains("database error"));
}

#[test]
fn platform_error_implements_send_sync() {
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<PlatformError>();
}

#[test]
fn platform_error_variants_are_distinct() {
    let db_err = PlatformError::Db(rusqlite::Error::InvalidParameterName("x".into()));
    let nf_err = PlatformError::NotFound("x".into());
    let int_err = PlatformError::Internal("x".into());
    assert_ne!(format!("{db_err:?}"), format!("{nf_err:?}"));
    assert_ne!(format!("{nf_err:?}"), format!("{int_err:?}"));
}
