//! Sibling unit tests for `tax.rs` (AGENTS.md: no tests in production files).
//!
//! Moved here with the types from `modules/tax/src/models_tests.rs`; the assertions are unchanged,
//! and `foundation::` paths became `crate::` because a crate cannot name itself by path.


use super::*;

// ── RoundingMode::divide ────────────────────────────────────────

#[test]
fn halfup_exact_division() {
    assert_eq!(RoundingMode::HalfUp.divide(10, 2).unwrap(), 5);
}

#[test]
fn halfup_rounds_half_away_from_zero() {
    // 5 / 2 = 2.5 → rounds to 3 (half away from zero)
    assert_eq!(RoundingMode::HalfUp.divide(5, 2).unwrap(), 3);
}

#[test]
fn halfup_rounds_exactly_half_to_upper() {
    // 15 / 10 = 1.5 → rounds to 2
    assert_eq!(RoundingMode::HalfUp.divide(15, 10).unwrap(), 2);
}

#[test]
fn halfup_truncates_when_below_half() {
    // 14 / 10 = 1.4 → rounds to 1
    assert_eq!(RoundingMode::HalfUp.divide(14, 10).unwrap(), 1);
}

#[test]
fn halfup_zero_numerator() {
    assert_eq!(RoundingMode::HalfUp.divide(0, 7).unwrap(), 0);
}

#[test]
fn halfup_numerator_less_than_divisor() {
    // 3 / 10 = 0.3 → rounds to 0
    assert_eq!(RoundingMode::HalfUp.divide(3, 10).unwrap(), 0);
}

#[test]
fn halfup_large_values() {
    // Typical tax scenario: 33333 / 3 (e.g. 333.33 minor units / 3 items)
    assert_eq!(RoundingMode::HalfUp.divide(33333, 3).unwrap(), 11111);
}

#[test]
fn halfup_overflow_returns_none() {
    // i64::MAX / 2 would overflow when adding divisor/2
    let result = RoundingMode::HalfUp.divide(i64::MAX, 2);
    assert!(result.is_none());
}

#[test]
fn halfup_negative_exact_division_does_not_shift() {
    // Regression: (n + d/2) / d with truncating division gives
    // wrong result for exact negative division (e.g. -4/2 returns
    // -1, not -2). The exact-division guard fixes this.
    assert_eq!(RoundingMode::HalfUp.divide(-4, 2).unwrap(), -2);
    assert_eq!(RoundingMode::HalfUp.divide(-6, 2).unwrap(), -3);
    assert_eq!(RoundingMode::HalfUp.divide(4, 2).unwrap(), 2);
}

#[test]
fn halfup_negative_rounds_correctly() {
    // -5/2 = -2.5 → round half up (toward +∞) → -2
    assert_eq!(RoundingMode::HalfUp.divide(-5, 2).unwrap(), -2);
    // -3/2 = -1.5 → -1
    assert_eq!(RoundingMode::HalfUp.divide(-3, 2).unwrap(), -1);
    // -7/10 = -0.7 → 0
    assert_eq!(RoundingMode::HalfUp.divide(-7, 10).unwrap(), 0);
}

#[test]
fn truncate_exact_division() {
    assert_eq!(RoundingMode::Truncate.divide(10, 2).unwrap(), 5);
}

#[test]
fn truncate_rounds_down() {
    // 5 / 2 = 2.5 → truncates to 2
    assert_eq!(RoundingMode::Truncate.divide(5, 2).unwrap(), 2);
}

#[test]
fn truncate_rounds_toward_zero() {
    // 15 / 10 = 1.5 → truncates to 1
    assert_eq!(RoundingMode::Truncate.divide(15, 10).unwrap(), 1);
}

#[test]
fn truncate_zero_numerator() {
    assert_eq!(RoundingMode::Truncate.divide(0, 7).unwrap(), 0);
}

// ── RoundingMode::wire_name ─────────────────────────────────────

#[test]
fn wire_name_matches_serde_representation() {
    assert_eq!(RoundingMode::HalfUp.wire_name(), "half_up");
    assert_eq!(RoundingMode::Truncate.wire_name(), "truncate");
}

// ── RoundingMode serde roundtrip ────────────────────────────────

#[test]
fn rounding_mode_serde_roundtrip() {
    for mode in [RoundingMode::HalfUp, RoundingMode::Truncate] {
        let json = serde_json::to_string(&mode).unwrap();
        let back: RoundingMode = serde_json::from_str(&json).unwrap();
        assert_eq!(back, mode);
    }
}

#[test]
fn rounding_mode_default_is_halfup() {
    assert_eq!(RoundingMode::default(), RoundingMode::HalfUp);
}

// ── TaxRate ─────────────────────────────────────────────────────

#[test]
fn tax_rate_new_sets_fields() {
    let rate = TaxRate::new("VAT", 2100); // 21%
    assert_eq!(rate.name, "VAT");
    assert_eq!(rate.rate_bps, 2100);
    assert!(!rate.is_default);
    assert!(!rate.is_inclusive);
}

#[test]
fn tax_rate_new_trims_name() {
    let rate = TaxRate::new("  Sales Tax  ", 825);
    assert_eq!(rate.name, "Sales Tax");
}

#[test]
#[should_panic(expected = "tax rate name must not be empty")]
fn tax_rate_new_rejects_empty_name() {
    TaxRate::new("  ", 100);
}

#[test]
#[should_panic(expected = "rate_bps must be non-negative")]
fn tax_rate_new_rejects_negative_rate() {
    TaxRate::new("Bad", -1);
}

#[test]
fn tax_rate_new_allows_zero_rate() {
    let rate = TaxRate::new("Zero", 0);
    assert_eq!(rate.rate_bps, 0);
}

#[test]
fn tax_rate_with_default() {
    let rate = TaxRate::new("VAT", 2100).with_default();
    assert!(rate.is_default);
}

#[test]
fn tax_rate_with_inclusive() {
    let rate = TaxRate::new("VAT", 2100).with_inclusive();
    assert!(rate.is_inclusive);
}

#[test]
fn tax_rate_new_generates_unique_id() {
    let a = TaxRate::new("A", 100);
    let b = TaxRate::new("B", 200);
    assert_ne!(a.id, b.id);
}

// ── TaxRate::display_rate ───────────────────────────────────────

#[test]
fn display_rate_whole_percent() {
    let rate = TaxRate::new("VAT", 2100); // 21.00%
    assert_eq!(rate.display_rate(), "21%");
}

#[test]
fn display_rate_fractional_percent() {
    let rate = TaxRate::new("Tax", 825); // 8.25%
    assert_eq!(rate.display_rate(), "8.25%");
}

#[test]
fn display_rate_small_fraction() {
    let rate = TaxRate::new("Tax", 150); // 1.50%
    assert_eq!(rate.display_rate(), "1.50%");
}

#[test]
fn display_rate_zero_percent() {
    let rate = TaxRate::new("Zero", 0);
    assert_eq!(rate.display_rate(), "0%");
}

#[test]
fn display_rate_one_percent() {
    let rate = TaxRate::new("One", 100);
    assert_eq!(rate.display_rate(), "1%");
}

// ── TaxRate serde roundtrip ─────────────────────────────────────

#[test]
fn tax_rate_serde_roundtrip() {
    let rate = TaxRate::new("VAT", 2100).with_default().with_inclusive();
    let json = serde_json::to_string(&rate).unwrap();
    let back: TaxRate = serde_json::from_str(&json).unwrap();
    assert_eq!(back.name, "VAT");
    assert_eq!(back.rate_bps, 2100);
    assert!(back.is_default);
    assert!(back.is_inclusive);
}
