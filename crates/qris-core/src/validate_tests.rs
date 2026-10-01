//! Unit tests for `validate`.
//!
//! Moved out of `validate.rs` to satisfy the AGENTS.md section 2 rule that unit
//! tests live in a sibling `*_tests.rs` file rather than inside a production
//! `.rs` file. Wired from `validate.rs` with:
//!   `#[cfg(test)] #[path = "validate_tests.rs"] mod tests;`

use super::*;

use crate::QrisBuilder;

fn valid() -> QrisPayload {
    QrisBuilder::new()
        .nmid("ID1020001234567")
        .merchant_name("Test")
        .merchant_city("Jakarta")
        .merchant_category_code("5812")
        .build()
        .unwrap()
}

#[test]
fn valid_payload_passes() {
    assert!(validate(&valid()).is_ok());
    assert!(validate_all(&valid()).is_empty());
}

#[test]
fn empty_merchant_name_fails() {
    let mut p = valid();
    p.merchant_name.clear();
    assert!(validate(&p).is_err());
}
