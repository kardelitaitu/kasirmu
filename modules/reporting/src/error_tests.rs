//! Unit tests for `error`.
//!
//! Moved out of `error.rs` to satisfy the AGENTS.md section 2 rule that unit
//! tests live in a sibling `*_tests.rs` file rather than inside a production
//! `.rs` file. Wired from `error.rs` with:
//!   `#[cfg(test)] #[path = "error_tests.rs"] mod tests;`

use super::*;

#[test]
fn reporting_error_validation_message() {
    let err = ReportingError::validation("date", "must be a valid date");
    assert!(matches!(
        err,
        ReportingError::Validation { field, .. } if field == "date"
    ));
    assert_eq!(
        format!("{err}"),
        "validation error on date: must be a valid date"
    );
}

#[test]
fn reporting_error_not_found_message() {
    let err = ReportingError::NotFound {
        entity: "report",
        id: "2025-13-01".into(),
    };
    assert_eq!(format!("{err}"), "not found: report 2025-13-01");
}

#[test]
fn reporting_error_from_rusqlite() {
    let rusqlite_err = rusqlite::Error::QueryReturnedNoRows;
    let err = ReportingError::from(rusqlite_err);
    assert!(matches!(err, ReportingError::Db(_)));
}
