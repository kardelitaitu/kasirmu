//! Unit tests for the shared validation helpers.
//!
//! Split out of `validation.rs` to satisfy the AGENTS.md rule that unit
//! tests live in a sibling `*_tests.rs` file, never inside a production
//! `.rs` file. Wired from `validation.rs` with:
//!   `#[cfg(test)] #[path = "validation_tests.rs"] mod tests;`

use super::*;

// ── validate_not_empty ───────────────────────────────────────

#[test]
fn not_empty_accepts_non_empty() {
    assert!(validate_not_empty("name", "Coffee").is_ok());
}

#[test]
fn not_empty_rejects_empty() {
    let err = validate_not_empty("name", "").unwrap_err();
    assert_eq!(err.field, "name");
    assert!(err.message.contains("must not be empty"));
}

#[test]
fn not_empty_rejects_whitespace() {
    let err = validate_not_empty("sku", "   ").unwrap_err();
    assert_eq!(err.field, "sku");
}

#[test]
fn not_empty_trims_input() {
    assert!(validate_not_empty("name", "  Coffee  ").is_ok());
}

// ── validate_range ───────────────────────────────────────────

#[test]
fn range_accepts_inclusive_bounds() {
    assert!(validate_range("x", 0u8, 0u8, 100u8).is_ok());
    assert!(validate_range("x", 100u8, 0u8, 100u8).is_ok());
}

#[test]
fn range_rejects_below_min() {
    let err = validate_range("discount", -1i64, 0i64, 100i64).unwrap_err();
    assert_eq!(err.field, "discount");
    assert!(err.message.contains("must be between"));
}

#[test]
fn range_rejects_above_max() {
    let err = validate_range("discount", 101u8, 0u8, 100u8).unwrap_err();
    assert_eq!(err.field, "discount");
}

#[test]
fn range_works_with_different_types() {
    assert!(validate_range("price", 500, 0, 10_000).is_ok());
    let err = validate_range("price", -1, 0, 10_000).unwrap_err();
    assert_eq!(err.field, "price");
}

#[test]
fn range_with_min_equals_max_accepts_exact_value() {
    // When min == max, only the exact value is accepted.
    assert!(validate_range("flag", 42, 42, 42).is_ok());
    let err = validate_range("flag", 41, 42, 42).unwrap_err();
    assert!(err.message.contains("must be between"));
    let err = validate_range("flag", 43, 42, 42).unwrap_err();
    assert!(err.message.contains("must be between"));
}

#[test]
fn range_accepts_i64_min_at_lower_bound() {
    // i64::MIN at the lower bound should pass
    assert!(validate_range("x", i64::MIN, i64::MIN, 0).is_ok());
    // Number just above the lower bound should also pass
    assert!(validate_range("x", i64::MIN + 1, i64::MIN, 0).is_ok());
}

#[test]
fn range_accepts_i64_max_at_upper_bound() {
    assert!(validate_range("x", i64::MAX, 0, i64::MAX).is_ok());
    assert!(validate_range("x", i64::MAX - 1, 0, i64::MAX).is_ok());
}

#[test]
fn range_accepts_any_value_with_full_i64_bounds() {
    // With min=i64::MIN, max=i64::MAX, every i64 value is valid.
    assert!(validate_range("x", 0_i64, i64::MIN, i64::MAX).is_ok());
    assert!(validate_range("x", i64::MIN, i64::MIN, i64::MAX).is_ok());
    assert!(validate_range("x", i64::MAX, i64::MIN, i64::MAX).is_ok());
}

#[test]
fn range_with_inverted_bounds_rejects_all_values() {
    // When min > max (e.g. min=10, max=5), every value is rejected
    // because (value < 10) || (value > 5) is always true.
    // This is documented behavior — callers must ensure min <= max.
    assert!(validate_range("x", 0_i64, 10, 5).is_err());
    assert!(validate_range("x", 7_i64, 10, 5).is_err());
    assert!(validate_range("x", 15_i64, 10, 5).is_err());
}

// ── validate_min_length ──────────────────────────────────────

#[test]
fn min_length_accepts_equal() {
    assert!(validate_min_length("pin", "1234", 4).is_ok());
}

#[test]
fn min_length_accepts_longer() {
    assert!(validate_min_length("pin", "123456", 4).is_ok());
}

#[test]
fn min_length_rejects_shorter() {
    let err = validate_min_length("pin", "12", 4).unwrap_err();
    assert_eq!(err.field, "pin");
    assert!(err.message.contains("at least 4"));
}

#[test]
fn min_length_trims_before_counting() {
    assert!(validate_min_length("pin", "  1234  ", 4).is_ok());
}

// ── validate_max_length ──────────────────────────────────────

#[test]
fn max_length_accepts_equal() {
    assert!(validate_max_length("sku", "ABCD", 4).is_ok());
}

#[test]
fn max_length_accepts_shorter() {
    assert!(validate_max_length("sku", "AB", 4).is_ok());
}

#[test]
fn max_length_rejects_longer() {
    let err = validate_max_length("sku", "ABCDE", 4).unwrap_err();
    assert_eq!(err.field, "sku");
    assert!(err.message.contains("at most 4"));
}

#[test]
fn max_length_trims_before_check() {
    // Consistent with validate_not_empty, validate_min_length, etc.
    // Whitespace padding should not cause a rejection.
    assert!(
        validate_max_length("name", "  Coffee  ", 7).is_ok(),
        "'  Coffee  ' trimmed to 6 chars should pass max=7"
    );
    // True overflow after trim still rejects
    let err = validate_max_length("name", "  LongName  ", 5).unwrap_err();
    assert_eq!(err.field, "name");
    assert!(err.message.contains("at most 5"));
}

#[test]
fn max_length_whitespace_only_passes_when_within_max() {
    // All-whitespace input trims to empty (0 chars), so max=2 should pass.
    assert!(
        validate_max_length("sku", "    ", 2).is_ok(),
        "whitespace-only input trims to 0 chars, should pass max=2"
    );
}

#[test]
fn max_length_with_zero_max_rejects_non_empty() {
    // max=0 means only empty strings are valid.
    assert!(validate_max_length("x", "", 0).is_ok());
    let err = validate_max_length("x", "a", 0).unwrap_err();
    assert!(err.message.contains("at most 0"));
}

// ── validate_alphanumeric ───────────────────────────────────

#[test]
fn alphanumeric_accepts_plain_text() {
    assert!(validate_alphanumeric("username", "alice").is_ok());
}

#[test]
fn alphanumeric_accepts_digits() {
    assert!(validate_alphanumeric("sku", "COFFEE123").is_ok());
}

#[test]
fn alphanumeric_accepts_unicode() {
    assert!(validate_alphanumeric("name", "café").is_ok());
    assert!(validate_alphanumeric("name", "用户").is_ok());
}

#[test]
fn alphanumeric_rejects_empty() {
    let err = validate_alphanumeric("user", "").unwrap_err();
    assert_eq!(err.field, "user");
    assert!(err.message.contains("must not be empty"));
}

#[test]
fn alphanumeric_rejects_whitespace() {
    let err = validate_alphanumeric("user", "   ").unwrap_err();
    assert_eq!(err.field, "user");
}

#[test]
fn alphanumeric_rejects_punctuation() {
    let err = validate_alphanumeric("user", "alice!").unwrap_err();
    assert!(err.message.contains("invalid character"));
}

#[test]
fn alphanumeric_rejects_spaces() {
    let err = validate_alphanumeric("user", "alice bob").unwrap_err();
    assert!(err.message.contains("invalid character"));
}

#[test]
fn alphanumeric_rejects_underscore() {
    let err = validate_alphanumeric("user", "alice_bob").unwrap_err();
    assert!(err.message.contains("invalid character"));
}

#[test]
fn alphanumeric_trims_before_check() {
    assert!(validate_alphanumeric("user", "  alice  ").is_ok());
}

// ── validate_ascii_alphanumeric ──────────────────────────────

#[test]
fn ascii_alphanumeric_accepts_ascii_letters() {
    assert!(validate_ascii_alphanumeric("sku", "COFFEE").is_ok());
}

#[test]
fn ascii_alphanumeric_accepts_digits() {
    assert!(validate_ascii_alphanumeric("sku", "BAGEL99").is_ok());
}

#[test]
fn ascii_alphanumeric_rejects_empty() {
    let err = validate_ascii_alphanumeric("user", "").unwrap_err();
    assert_eq!(err.field, "user");
    assert!(err.message.contains("must not be empty"));
}

#[test]
fn ascii_alphanumeric_rejects_whitespace() {
    let err = validate_ascii_alphanumeric("sku", "   ").unwrap_err();
    assert_eq!(err.field, "sku");
}

#[test]
fn ascii_alphanumeric_rejects_punctuation() {
    let err = validate_ascii_alphanumeric("sku", "COFFEE-1").unwrap_err();
    assert!(err.message.contains("invalid character"));
}

#[test]
fn ascii_alphanumeric_rejects_unicode() {
    let err = validate_ascii_alphanumeric("name", "café").unwrap_err();
    assert!(err.message.contains("invalid character"));
}

#[test]
fn ascii_alphanumeric_trims_before_check() {
    assert!(validate_ascii_alphanumeric("sku", "  COFFEE  ").is_ok());
}

#[test]
fn ascii_alphanumeric_uppercase_lowercase() {
    assert!(validate_ascii_alphanumeric("user", "Alice99").is_ok());
}

// ── validate_regex ───────────────────────────────────────────

#[test]
fn regex_matches_pattern() {
    let hex = regex::Regex::new(r"^#[0-9a-fA-F]{6}$").unwrap();
    assert!(validate_regex("color", "#ff6600", &hex).is_ok());
}

#[test]
fn regex_rejects_non_match() {
    let hex = regex::Regex::new(r"^#[0-9a-fA-F]{6}$").unwrap();
    let err = validate_regex("color", "#GGG", &hex).unwrap_err();
    assert_eq!(err.field, "color");
    assert!(err.message.contains("does not match"));
}

#[test]
fn regex_rejects_empty() {
    let any = regex::Regex::new(r".*").unwrap();
    let err = validate_regex("x", "", &any).unwrap_err();
    assert_eq!(err.field, "x");
    assert!(err.message.contains("must not be empty"));
}

#[test]
fn regex_anchored_pattern_requires_full_match() {
    let digits = regex::Regex::new(r"^\d+$").unwrap();
    assert!(validate_regex("num", "123", &digits).is_ok());
    assert!(validate_regex("num", "12a3", &digits).is_err());
}

#[test]
fn regex_unanchored_pattern_matches_substring() {
    // Without anchors, is_match finds digits anywhere in the string.
    let has_digit = regex::Regex::new(r"\d").unwrap();
    assert!(validate_regex("x", "abc123", &has_digit).is_ok());
    assert!(validate_regex("x", "abc", &has_digit).is_err());
}

#[test]
fn regex_trims_before_matching() {
    let hex = regex::Regex::new(r"^#[0-9a-fA-F]{6}$").unwrap();
    assert!(validate_regex("color", "  #ff6600  ", &hex).is_ok());
}

// ── validate_non_empty_bounded ───────────────────────────────

#[test]
fn bounded_accepts_valid() {
    assert!(validate_non_empty_bounded("name", "Coffee", 2, 50).is_ok());
}

#[test]
fn bounded_rejects_empty() {
    let err = validate_non_empty_bounded("name", "", 2, 50).unwrap_err();
    assert_eq!(err.field, "name");
    assert!(err.message.contains("must not be empty"));
}

#[test]
fn bounded_rejects_too_short() {
    let err = validate_non_empty_bounded("name", "X", 2, 50).unwrap_err();
    assert_eq!(err.field, "name");
    assert!(err.message.contains("at least 2"));
}

#[test]
fn bounded_rejects_too_long() {
    let err = validate_non_empty_bounded("name", &"X".repeat(51), 2, 50).unwrap_err();
    assert_eq!(err.field, "name");
    assert!(err.message.contains("at most 50"));
}

#[test]
fn bounded_trims_before_checks() {
    assert!(validate_non_empty_bounded("name", "  Coffee  ", 2, 50).is_ok());
}

#[test]
fn bounded_with_zero_min_accepts_one_char() {
    // When min = 0, a single character is valid (after trimming).
    assert!(validate_non_empty_bounded("flag", "X", 0, 10).is_ok());
}

#[test]
fn bounded_with_min_equals_max_accepts_exact_length() {
    // When min == max, only the exact length is accepted.
    assert!(validate_non_empty_bounded("pin", "1234", 4, 4).is_ok());
    let err = validate_non_empty_bounded("pin", "123", 4, 4).unwrap_err();
    assert!(err.message.contains("at least 4"));
    let err = validate_non_empty_bounded("pin", "12345", 4, 4).unwrap_err();
    assert!(err.message.contains("at most 4"));
}

#[test]
fn bounded_with_max_zero_rejects_all_non_empty() {
    // When max = 0 and min = 0, only empty strings are valid...
    // but empty strings are rejected first by the non-empty check.
    // So all inputs should be rejected.
    assert!(validate_non_empty_bounded("x", "", 0, 0).is_err());
    assert!(validate_non_empty_bounded("x", "a", 0, 0).is_err());
}

// ── Error traits ─────────────────────────────────────────────

#[test]
fn returned_error_implements_std_error() {
    let err = validate_not_empty("x", "").unwrap_err();
    let _: &dyn std::error::Error = &err;
}

#[test]
fn returned_error_is_send_sync() {
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<ValidationError>();
}

// ── validate_sku ────────────────────────────────────────────

#[test]
fn sku_accepts_valid() {
    assert!(validate_sku("sku", "COFFEE").is_ok());
    assert!(validate_sku("sku", "BAGEL99").is_ok());
    assert!(validate_sku("sku", "A").is_ok());
}

#[test]
fn sku_rejects_empty() {
    let err = validate_sku("sku", "").unwrap_err();
    assert!(err.message.contains("must not be empty"));
}

#[test]
fn sku_rejects_punctuation() {
    let err = validate_sku("sku", "COFFEE-1").unwrap_err();
    assert!(err.message.contains("ASCII alphanumeric"));
}

#[test]
fn sku_rejects_too_long() {
    let long = "X".repeat(crate::constants::MAX_SKU_LENGTH + 1);
    let err = validate_sku("sku", &long).unwrap_err();
    assert!(err.message.contains("at most"));
}

#[test]
fn sku_accepts_max_length() {
    let max = "X".repeat(crate::constants::MAX_SKU_LENGTH);
    assert!(validate_sku("sku", &max).is_ok());
}

// ── validate_email ───────────────────────────────────────────

#[test]
fn email_accepts_simple() {
    assert!(validate_email("email", "alice@example.com").is_ok());
}

#[test]
fn email_accepts_subdomain() {
    assert!(validate_email("email", "bob@mail.example.co.id").is_ok());
}

#[test]
fn email_accepts_plus_addressing() {
    assert!(validate_email("email", "user+tag@example.com").is_ok());
}

#[test]
fn email_rejects_empty() {
    let err = validate_email("email", "").unwrap_err();
    assert!(err.message.contains("must not be empty"));
}

#[test]
fn email_rejects_missing_at() {
    let err = validate_email("email", "not-an-email").unwrap_err();
    assert!(err.message.contains("valid email"));
}

#[test]
fn email_rejects_missing_domain() {
    let err = validate_email("email", "alice@").unwrap_err();
    assert!(err.message.contains("valid email"));
}

#[test]
fn email_trims_input() {
    assert!(validate_email("email", "  alice@example.com  ").is_ok());
}

// ── validate_phone ───────────────────────────────────────────

#[test]
fn phone_accepts_international() {
    assert!(validate_phone("phone", "+6281234567890").is_ok());
}

#[test]
fn phone_accepts_with_separators() {
    assert!(validate_phone("phone", "+1-555-0100").is_ok());
    assert!(validate_phone("phone", "+1 555 0100").is_ok());
    assert!(validate_phone("phone", "+1.555.0100").is_ok());
    assert!(validate_phone("phone", "+1 (555) 0100").is_ok());
}

#[test]
fn phone_accepts_digits_only() {
    assert!(validate_phone("phone", "08123456789").is_ok());
}

#[test]
fn phone_rejects_empty() {
    let err = validate_phone("phone", "").unwrap_err();
    assert!(err.message.contains("must not be empty"));
}

#[test]
fn phone_rejects_too_few_digits() {
    let err = validate_phone("phone", "123456").unwrap_err();
    assert!(err.message.contains("at least 7 digits"));
}

#[test]
fn phone_rejects_letters() {
    let err = validate_phone("phone", "abc1234567").unwrap_err();
    assert!(err.message.contains("valid phone"));
}

#[test]
fn phone_trims_input() {
    assert!(validate_phone("phone", "  +6281234567890  ").is_ok());
}

// ── validate_money_range ─────────────────────────────────────

#[test]
fn money_range_accepts_valid() {
    assert!(validate_money_range("price", 1299, 0, 1_000_000).is_ok());
    assert!(validate_money_range("price", 0, 0, 1_000_000).is_ok());
    assert!(validate_money_range("price", 1_000_000, 0, 1_000_000).is_ok());
}

#[test]
fn money_range_rejects_negative() {
    let err = validate_money_range("price", -1, 0, 1_000_000).unwrap_err();
    assert!(err.message.contains("must be between"));
}

#[test]
fn money_range_rejects_above_max() {
    let err = validate_money_range("price", 2_000_000, 0, 1_000_000).unwrap_err();
    assert!(err.message.contains("must be between"));
}

// ── validate_string_length ───────────────────────────────────

#[test]
fn string_length_accepts_valid() {
    assert!(validate_string_length("name", "Coffee", 2, 50).is_ok());
}

#[test]
fn string_length_rejects_too_short() {
    let err = validate_string_length("name", "X", 2, 50).unwrap_err();
    assert!(err.message.contains("at least 2"));
}

#[test]
fn string_length_rejects_too_long() {
    let err = validate_string_length("name", &"X".repeat(51), 2, 50).unwrap_err();
    assert!(err.message.contains("at most 50"));
}

#[test]
fn string_length_rejects_empty() {
    let err = validate_string_length("name", "", 2, 50).unwrap_err();
    assert!(err.message.contains("must not be empty"));
}

#[test]
fn string_length_trims_before_check() {
    assert!(validate_string_length("name", "  Coffee  ", 2, 50).is_ok());
}
