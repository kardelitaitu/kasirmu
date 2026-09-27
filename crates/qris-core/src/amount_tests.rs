//! Unit tests for `amount`.
//!
//! Moved out of `amount.rs` to satisfy the AGENTS.md section 2 rule that unit
//! tests live in a sibling `*_tests.rs` file rather than inside a production
//! `.rs` file. Wired from `amount.rs` with:
//!   `#[cfg(test)] #[path = "amount_tests.rs"] mod tests;`

use super::*;

#[test]
fn parse_integer_amount() {
    assert_eq!(parse_amount("50000").unwrap(), 50_000);
}

#[test]
fn parse_decimal_amount() {
    assert_eq!(parse_amount("50000.00").unwrap(), 50_000);
}

#[test]
fn parse_zero() {
    assert_eq!(parse_amount("0").unwrap(), 0);
}

#[test]
fn reject_empty() {
    assert!(parse_amount("").is_err());
}

#[test]
fn reject_text() {
    assert!(parse_amount("abc").is_err());
}

#[test]
fn format_round_trip() {
    let amount = 123_456u64;
    let s = format_amount(amount);
    assert_eq!(parse_amount(&s).unwrap(), amount);
}

/// QRIS-D: the fee is exact at boundaries where f64 is not.
///
/// `0.1` is not exactly representable as f64, so the old float path could
/// round a boundary case the wrong way. Integer arithmetic has no such
/// ambiguity, and these cases pin that.
#[test]
fn fee_is_exact_at_float_boundaries() {
    // 0.1% of 1_000 = 1 exactly.
    assert_eq!(calculate_percentage_fee(1_000, "0.1").unwrap(), 1);
    // 0.1% of 999 = 0.999 -> ceiling 1.
    assert_eq!(calculate_percentage_fee(999, "0.1").unwrap(), 1);
    // 0.1% of 1_001 = 1.001 -> ceiling 2.
    assert_eq!(calculate_percentage_fee(1_001, "0.1").unwrap(), 2);
    // An exact zero fee stays zero.
    assert_eq!(calculate_percentage_fee(1_000, "0").unwrap(), 0);
    assert_eq!(calculate_percentage_fee(1_000, "0.00").unwrap(), 0);
    // Leading-dot and trailing-dot forms parse.
    assert_eq!(calculate_percentage_fee(10_000, ".5").unwrap(), 50);
    assert_eq!(calculate_percentage_fee(10_000, "1.").unwrap(), 100);
}

/// Rejects input the exact parser cannot represent.
#[test]
fn fee_rejects_unrepresentable_percentages() {
    for bad in ["-0.5", "abc", "", "  ", "1e3", "0.00001", "1.2.3"] {
        assert!(
            calculate_percentage_fee(100_000, bad).is_err(),
            "{bad:?} must be rejected"
        );
    }
}

#[test]
fn fee_percentage_accuracy_and_rounding() {
    // 0.01% accuracy tests:
    // 0.01% on 350,000 = 35 rupiah exactly
    assert_eq!(calculate_percentage_fee(350_000, "0.01").unwrap(), 35);
    assert_eq!(calculate_percentage_fee(10_000, "0.01").unwrap(), 1);
    assert_eq!(calculate_percentage_fee(100_000, "0.01").unwrap(), 10);
    assert_eq!(calculate_percentage_fee(1_000_000, "0.01").unwrap(), 100);

    // Fractional result must be rounded up (ceil):
    // e.g. 0.01% on 5,555 = 0.5555 -> rounds up to 1
    assert_eq!(calculate_percentage_fee(5_555, "0.01").unwrap(), 1);
    // 0.01% on 1 = 0.0001 -> rounds up to 1
    assert_eq!(calculate_percentage_fee(1, "0.01").unwrap(), 1);
    // 0.01% on 350,001 = 35.0001 -> rounds up to 36
    assert_eq!(calculate_percentage_fee(350_001, "0.01").unwrap(), 36);

    // Standard QRIS fees (0.7% MDR):
    // 0.7% on 50,000 = 350 exactly
    assert_eq!(calculate_percentage_fee(50_000, "0.7").unwrap(), 350);
    // 0.7% on 50,001 = 350.007 -> rounds up to 351
    assert_eq!(calculate_percentage_fee(50_001, "0.7").unwrap(), 351);
    // 0.7% on 50,010 = 350.07 -> rounds up to 351
    assert_eq!(calculate_percentage_fee(50_010, "0.7").unwrap(), 351);

    // 0.3% MDR:
    // 0.3% on 33,333 = 99.999 -> rounds up to 100
    assert_eq!(calculate_percentage_fee(33_333, "0.3").unwrap(), 100);

    // Invalid percentage inputs
    assert!(calculate_percentage_fee(100_000, "-0.5").is_err());
    assert!(calculate_percentage_fee(100_000, "abc").is_err());
}
