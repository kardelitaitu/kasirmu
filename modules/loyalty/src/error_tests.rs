//! Unit tests for `error`.
//!
//! Moved out of `error.rs` to satisfy the AGENTS.md section 2 rule that unit
//! tests live in a sibling `*_tests.rs` file rather than inside a production
//! `.rs` file. Wired from `error.rs` with:
//!   `#[cfg(test)] #[path = "error_tests.rs"] mod tests;`

use super::*;

#[test]
fn loyalty_error_validation_message() {
    let err = LoyaltyError::validation("card_number", "must not be empty");
    assert!(matches!(
        err,
        LoyaltyError::Validation { field, .. } if field == "card_number"
    ));
    assert_eq!(
        format!("{err}"),
        "validation error on card_number: must not be empty"
    );
}

#[test]
fn loyalty_error_not_found_message() {
    let err = LoyaltyError::NotFound {
        entity: "loyalty_account",
        id: "cust-xxx".into(),
    };
    assert_eq!(format!("{err}"), "not found: loyalty_account cust-xxx");
}

#[test]
fn loyalty_error_from_rusqlite() {
    let rusqlite_err = rusqlite::Error::QueryReturnedNoRows;
    let err = LoyaltyError::from(rusqlite_err);
    assert!(matches!(err, LoyaltyError::Db(_)));
}
