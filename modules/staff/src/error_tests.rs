//! Unit tests for `error`.
//!
//! Moved out of `error.rs` to satisfy the AGENTS.md section 2 rule that unit
//! tests live in a sibling `*_tests.rs` file rather than inside a production
//! `.rs` file. Wired from `error.rs` with:
//!   `#[cfg(test)] #[path = "error_tests.rs"] mod tests;`

use super::*;

#[test]
fn staff_error_validation_message() {
    let err = StaffError::validation("username", "must not be empty");
    assert!(matches!(
        err,
        StaffError::Validation { field, .. } if field == "username"
    ));
    assert_eq!(
        format!("{err}"),
        "validation error on username: must not be empty"
    );
}

#[test]
fn staff_error_not_found_message() {
    let err = StaffError::NotFound {
        entity: "user",
        id: "bad-id".into(),
    };
    assert_eq!(format!("{err}"), "not found: user bad-id");
}

#[test]
fn staff_error_from_rusqlite() {
    let rusqlite_err = rusqlite::Error::QueryReturnedNoRows;
    let err = StaffError::from(rusqlite_err);
    assert!(matches!(err, StaffError::Db(_)));
}

#[test]
fn staff_error_from_platform_error() {
    let platform_err = platform_core::PlatformError::Internal("test".into());
    let err = StaffError::from(platform_err);
    assert!(matches!(err, StaffError::Platform(_)));
}
