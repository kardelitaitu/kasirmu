//! Unit tests for `mcc`.
//!
//! Moved out of `mcc.rs` to satisfy the AGENTS.md section 2 rule that unit
//! tests live in a sibling `*_tests.rs` file rather than inside a production
//! `.rs` file. Wired from `mcc.rs` with:
//!   `#[cfg(test)] #[path = "mcc_tests.rs"] mod tests;`

use super::*;

#[test]
fn known_codes() {
    assert_eq!(
        mcc_description("5812"),
        Some("Eating Places and Restaurants")
    );
    assert_eq!(mcc_description("5814"), Some("Fast Food Restaurants"));
    assert_eq!(mcc_description("5912"), Some("Drug Stores and Pharmacies"));
    assert_eq!(mcc_description("4121"), Some("Taxicabs and Ride-hailing"));
    assert_eq!(mcc_description("8062"), Some("Hospitals"));
}

#[test]
fn unknown_code_returns_none() {
    assert_eq!(mcc_description("0000"), None);
    assert_eq!(mcc_description("9999"), None);
    assert_eq!(mcc_description(""), None);
}
