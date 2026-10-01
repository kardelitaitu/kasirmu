//! Unit tests for `error`.
//!
//! Moved out of `error.rs` to satisfy the AGENTS.md section 2 rule that unit
//! tests live in a sibling `*_tests.rs` file rather than inside a production
//! `.rs` file. Wired from `error.rs` with:
//!   `#[cfg(test)] #[path = "error_tests.rs"] mod tests;`

use super::*;

#[test]
fn terminal_error_validation_message() {
    let err = TerminalError::validation("name", "must not be empty");
    assert!(matches!(
        err,
        TerminalError::Validation { field, .. } if field == "name"
    ));
    assert_eq!(
        format!("{err}"),
        "validation error on name: must not be empty"
    );
}

#[test]
fn terminal_error_not_found_message() {
    let err = TerminalError::NotFound {
        entity: "terminal",
        id: "bad-id".into(),
    };
    assert_eq!(format!("{err}"), "not found: terminal bad-id");
}

#[test]
fn terminal_error_from_rusqlite() {
    let rusqlite_err = rusqlite::Error::QueryReturnedNoRows;
    let err = TerminalError::from(rusqlite_err);
    assert!(matches!(err, TerminalError::Db(_)));
}
