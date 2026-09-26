//! Unit tests for `errors`.
//!
//! Moved out of `errors.rs` to satisfy the AGENTS.md section 2 rule that unit
//! tests live in a sibling `*_tests.rs` file rather than inside a production
//! `.rs` file. Wired from `errors.rs` with:
//!   `#[cfg(test)] #[path = "errors_tests.rs"] mod tests;`

use super::*;

#[test]
fn not_found_error_display() {
    let err = NotFoundError {
        entity: "product",
        id: "SKU-999".into(),
    };
    assert_eq!(err.to_string(), "product not found: SKU-999");
}

#[test]
fn not_found_error_debug() {
    let err = NotFoundError {
        entity: "product",
        id: "SKU-999".into(),
    };
    assert!(!format!("{err:?}").is_empty());
}

#[test]
fn conflict_error_display() {
    let err = ConflictError {
        entity: "product",
        field: "sku",
    };
    assert_eq!(err.to_string(), "product conflict on sku");
}

#[test]
fn conflict_error_debug() {
    let err = ConflictError {
        entity: "category",
        field: "name",
    };
    assert!(!format!("{err:?}").is_empty());
}

#[test]
fn validation_error_display() {
    let err = ValidationError {
        field: "price",
        message: "must be positive".into(),
    };
    assert_eq!(
        err.to_string(),
        "validation failed on price: must be positive"
    );
}

#[test]
fn validation_error_debug() {
    let err = ValidationError {
        field: "email",
        message: "invalid format".into(),
    };
    assert!(!format!("{err:?}").is_empty());
}

#[test]
fn not_found_error_fields() {
    let err = NotFoundError {
        entity: "user",
        id: "user-42".into(),
    };
    assert_eq!(err.entity, "user");
    assert_eq!(err.id, "user-42");
}

#[test]
fn conflict_error_fields() {
    let err = ConflictError {
        entity: "role",
        field: "id",
    };
    assert_eq!(err.entity, "role");
    assert_eq!(err.field, "id");
}

#[test]
fn validation_error_fields() {
    let err = ValidationError {
        field: "name",
        message: "too short".into(),
    };
    assert_eq!(err.field, "name");
    assert_eq!(err.message, "too short");
}

#[test]
fn not_found_error_implements_std_error() {
    let err = NotFoundError {
        entity: "x",
        id: "y".into(),
    };
    let _: &dyn std::error::Error = &err;
}

#[test]
fn conflict_error_implements_std_error() {
    let err = ConflictError {
        entity: "x",
        field: "y",
    };
    let _: &dyn std::error::Error = &err;
}

#[test]
fn validation_error_implements_std_error() {
    let err = ValidationError {
        field: "x",
        message: "y".into(),
    };
    let _: &dyn std::error::Error = &err;
}
