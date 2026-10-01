//! Unit tests for the settings-domain error taxonomy.
//!
//! Moved out of `error.rs` to satisfy the AGENTS.md section 2 rule that unit
//! tests live in a sibling `*_tests.rs` file rather than inside a production
//! `.rs` file. Wired from `error.rs` with:
//!   `#[cfg(test)] #[path = "error_tests.rs"] mod tests;`

use super::*;

#[test]
fn settings_error_validation_message() {
    let err = SettingsError::validation("key", "must not be empty");
    assert!(matches!(
        err,
        SettingsError::Validation { field, .. } if field == "key"
    ));
    assert_eq!(
        format!("{err}"),
        "validation error on key: must not be empty"
    );
}

#[test]
fn settings_error_not_found_message() {
    let err = SettingsError::NotFound {
        entity: "setting",
        id: "missing_key".into(),
    };
    assert_eq!(format!("{err}"), "not found: setting missing_key");
}

#[test]
fn settings_error_from_rusqlite() {
    let rusqlite_err = rusqlite::Error::QueryReturnedNoRows;
    let err = SettingsError::from(rusqlite_err);
    assert!(matches!(err, SettingsError::Db(_)));
}
