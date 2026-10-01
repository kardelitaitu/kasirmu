//! Unit tests for `error`.
//!
//! Moved out of `error.rs` to satisfy the AGENTS.md section 2 rule that unit
//! tests live in a sibling `*_tests.rs` file rather than inside a production
//! `.rs` file. Wired from `error.rs` with:
//!   `#[cfg(test)] #[path = "error_tests.rs"] mod tests;`

use super::*;

#[test]
fn inventory_error_validation_message() {
    let err = InventoryError::validation("sku", "must not be empty");
    assert!(matches!(
        err,
        InventoryError::Validation { field, .. } if field == "sku"
    ));
    assert_eq!(
        format!("{err}"),
        "validation error on sku: must not be empty"
    );
}

#[test]
fn inventory_error_not_found_message() {
    let err = InventoryError::NotFound {
        entity: "product",
        id: "bad-id".into(),
    };
    assert_eq!(format!("{err}"), "not found: product bad-id");
}

#[test]
fn inventory_error_from_rusqlite() {
    let rusqlite_err = rusqlite::Error::QueryReturnedNoRows;
    let err = InventoryError::from(rusqlite_err);
    assert!(matches!(err, InventoryError::Db(_)));
}
