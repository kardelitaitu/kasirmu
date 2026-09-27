//! Unit tests for `contact`.
//!
//! Moved out of `contact.rs` to satisfy the AGENTS.md section 2 rule that unit
//! tests live in a sibling `*_tests.rs` file rather than inside a production
//! `.rs` file. Wired from `contact.rs` with:
//!   `#[cfg(test)] #[path = "contact_tests.rs"] mod tests;`

use super::*;

// ── Email ────────────────────────────────────────────────────

#[test]
fn email_valid_simple() {
    let e = Email::new("alice@example.com").unwrap();
    assert_eq!(e.as_str(), "alice@example.com");
}

#[test]
fn email_with_subdomain() {
    let e = Email::new("alice@mail.example.co.uk").unwrap();
    assert_eq!(e.as_str(), "alice@mail.example.co.uk");
}

#[test]
fn email_with_plus_tag() {
    let e = Email::new("alice+tag@example.com").unwrap();
    assert_eq!(e.as_str(), "alice+tag@example.com");
}

#[test]
fn email_with_digits() {
    let e = Email::new("user123@example.com").unwrap();
    assert_eq!(e.as_str(), "user123@example.com");
}

#[test]
fn email_trims_whitespace() {
    let e = Email::new("  bob@example.com  ").unwrap();
    assert_eq!(e.as_str(), "bob@example.com");
}

#[test]
fn email_rejects_empty() {
    let err = Email::new("").unwrap_err();
    assert_eq!(err.field, "email");
    assert!(err.message.contains("must not be empty"));
}

#[test]
fn email_rejects_no_at() {
    let err = Email::new("notanemail").unwrap_err();
    assert!(err.message.contains("must contain exactly one '@'"));
}

#[test]
fn email_rejects_multiple_at() {
    let err = Email::new("a@b@c.com").unwrap_err();
    assert!(err.message.contains("must contain exactly one '@'"));
}

#[test]
fn email_rejects_empty_local() {
    let err = Email::new("@example.com").unwrap_err();
    assert!(err.message.contains("non-empty local part"));
}

#[test]
fn email_rejects_empty_domain() {
    let err = Email::new("user@").unwrap_err();
    assert!(err.message.contains("non-empty domain"));
}

#[test]
fn email_rejects_domain_without_dot() {
    let err = Email::new("user@localhost").unwrap_err();
    assert!(err.message.contains("must contain at least one '.'"));
}

#[test]
fn email_rejects_domain_leading_dot() {
    let err = Email::new("user@.example.com").unwrap_err();
    assert!(err.message.contains("must not start or end with a '.'"));
}

#[test]
fn email_rejects_domain_trailing_dot() {
    let err = Email::new("user@example.com.").unwrap_err();
    assert!(err.message.contains("must not start or end with a '.'"));
}

#[test]
fn email_from_str() {
    let e: Email = "carol@example.com".parse().unwrap();
    assert_eq!(e.to_string(), "carol@example.com");
}

#[test]
fn email_serde_roundtrip() {
    let e = Email::new("dave@example.com").unwrap();
    let json = serde_json::to_string(&e).unwrap();
    assert_eq!(json, "\"dave@example.com\"");
    let back: Email = serde_json::from_str(&json).unwrap();
    assert_eq!(back, e);
}

#[test]
fn email_serde_rejects_invalid() {
    // The Deserialize impl MUST validate, not just wrap the inner string.
    let result: Result<Email, _> = serde_json::from_str("\"not-an-email\"");
    assert!(
        result.is_err(),
        "invalid email should be rejected during deserialization"
    );
}

#[test]
fn email_serde_rejects_empty() {
    let result: Result<Email, _> = serde_json::from_str("\"\"");
    assert!(
        result.is_err(),
        "empty string should be rejected during deserialization"
    );
}

#[test]
fn email_error_implements_std_error() {
    let err = Email::new("").unwrap_err();
    let _: &dyn std::error::Error = &err;
}

// ── Phone ────────────────────────────────────────────────────

#[test]
fn phone_valid_us() {
    let p = Phone::new("+1-555-0102").unwrap();
    assert_eq!(p.as_str(), "+1-555-0102");
}

#[test]
fn phone_valid_indonesian() {
    let p = Phone::new("+6281234567890").unwrap();
    assert_eq!(p.as_str(), "+6281234567890");
}

#[test]
fn phone_valid_local() {
    let p = Phone::new("0812-3456-7890").unwrap();
    assert_eq!(p.as_str(), "0812-3456-7890");
}

#[test]
fn phone_with_spaces() {
    let p = Phone::new("+44 20 7946 0958").unwrap();
    assert_eq!(p.as_str(), "+44 20 7946 0958");
}

#[test]
fn phone_with_parentheses() {
    let p = Phone::new("(555) 123-4567").unwrap();
    assert_eq!(p.as_str(), "(555) 123-4567");
}

#[test]
fn phone_trims_whitespace() {
    let p = Phone::new("  +1-555-0102  ").unwrap();
    assert_eq!(p.as_str(), "+1-555-0102");
}

#[test]
fn phone_rejects_empty() {
    let err = Phone::new("").unwrap_err();
    assert_eq!(err.field, "phone");
    assert!(err.message.contains("must not be empty"));
}

#[test]
fn phone_rejects_no_digits() {
    let err = Phone::new("abc-def-ghij").unwrap_err();
    assert!(err.message.contains("at least one digit"));
}

#[test]
fn phone_rejects_whitespace_only() {
    let err = Phone::new("   ").unwrap_err();
    assert!(err.message.contains("must not be empty"));
}

#[test]
fn phone_from_str() {
    let p: Phone = "+1-555-0199".parse().unwrap();
    assert_eq!(p.to_string(), "+1-555-0199");
}

#[test]
fn phone_serde_roundtrip() {
    let p = Phone::new("+6281234567890").unwrap();
    let json = serde_json::to_string(&p).unwrap();
    assert_eq!(json, "\"+6281234567890\"");
    let back: Phone = serde_json::from_str(&json).unwrap();
    assert_eq!(back, p);
}

#[test]
fn phone_serde_rejects_no_digits() {
    // The Deserialize impl MUST validate, not just wrap the inner string.
    let result: Result<Phone, _> = serde_json::from_str("\"abc-def-ghij\"");
    assert!(
        result.is_err(),
        "phone with no digits should be rejected during deserialization"
    );
}

#[test]
fn phone_serde_rejects_empty() {
    let result: Result<Phone, _> = serde_json::from_str("\"\"");
    assert!(
        result.is_err(),
        "empty string should be rejected during deserialization"
    );
}

#[test]
fn phone_error_implements_std_error() {
    let err = Phone::new("").unwrap_err();
    let _: &dyn std::error::Error = &err;
}
