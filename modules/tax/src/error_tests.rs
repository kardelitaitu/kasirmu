//! Unit tests for `error`.
//!
//! Moved out of `error.rs` to satisfy the AGENTS.md section 2 rule that unit
//! tests live in a sibling `*_tests.rs` file rather than inside a production
//! `.rs` file. Wired from `error.rs` with:
//!   `#[cfg(test)] #[path = "error_tests.rs"] mod tests;`

use super::*;

#[test]
fn tax_error_validation_message() {
    let err = TaxError::validation("rate_bps", "rate must be positive");
    assert!(matches!(
        err,
        TaxError::Validation { field, .. } if field == "rate_bps"
    ));
    assert_eq!(
        format!("{err}"),
        "validation error on rate_bps: rate must be positive"
    );
}

#[test]
fn tax_error_not_found_message() {
    let err = TaxError::NotFound {
        entity: "tax_rate",
        id: "bad-id".into(),
    };
    assert_eq!(format!("{err}"), "not found: tax_rate bad-id");
}

#[test]
fn tax_error_from_rusqlite() {
    let rusqlite_err = rusqlite::Error::QueryReturnedNoRows;
    let err = TaxError::from(rusqlite_err);
    assert!(matches!(err, TaxError::Db(_)));
}
