//! Unit tests for `constants`.
//!
//! Moved out of `constants.rs` to satisfy the AGENTS.md section 2 rule that unit
//! tests live in a sibling `*_tests.rs` file rather than inside a production
//! `.rs` file. Wired from `constants.rs` with:
//!   `#[cfg(test)] #[path = "constants_tests.rs"] mod tests;`

use super::*;

#[test]
fn default_currency_parses() {
    let c: crate::Currency = DEFAULT_CURRENCY_CODE.parse().unwrap();
    assert_eq!(c.to_string(), "USD");
}

#[test]
fn max_discount_value() {
    assert_eq!(MAX_DISCOUNT_PERCENT, 100);
}

#[test]
fn basis_points_denominator_value() {
    assert_eq!(BASIS_POINTS_DENOMINATOR, 10_000);
}

#[test]
fn pin_min_length_value() {
    assert_eq!(PIN_MIN_LENGTH, 4);
}

#[test]
fn max_sku_length_value() {
    assert_eq!(MAX_SKU_LENGTH, 64);
}

#[test]
fn max_name_length_value() {
    assert_eq!(MAX_NAME_LENGTH, 255);
}

#[test]
fn constants_are_send_sync() {
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<&str>();
}
