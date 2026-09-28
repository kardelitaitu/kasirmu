//! Unit tests for `barcode` — sibling test file per AGENTS.md
//! (tests must never live inside production `.rs` files; COR-33).
//!
//! Wired from `barcode.rs` via `#[cfg(test)] #[path = "barcode_tests.rs"]
//! mod tests;`.

use super::*;

// ── Construction ─────────────────────────────────────────────

#[test]
fn valid_ean13() {
    let bc = Barcode::new("5901234123457").unwrap();
    assert_eq!(bc.as_str(), "5901234123457");
}

#[test]
fn valid_upc_a() {
    let bc = Barcode::new("012345678905").unwrap();
    assert_eq!(bc.as_str(), "012345678905");
}

#[test]
fn valid_alphanumeric() {
    let bc = Barcode::new("ABC123XYZ").unwrap();
    assert_eq!(bc.as_str(), "ABC123XYZ");
}

#[test]
fn trims_whitespace() {
    let bc = Barcode::new("  4901234567890  ").unwrap();
    assert_eq!(bc.as_str(), "4901234567890");
}

#[test]
fn rejects_empty() {
    let err = Barcode::new("").unwrap_err();
    assert_eq!(err.field, "barcode");
    assert!(err.message.contains("must not be empty"));
}

#[test]
fn rejects_whitespace_only() {
    let err = Barcode::new("   ").unwrap_err();
    assert!(err.message.contains("must not be empty"));
}

// ── FromStr ──────────────────────────────────────────────────

#[test]
fn from_str_works() {
    let bc: Barcode = "5901234123457".parse().unwrap();
    assert_eq!(bc.to_string(), "5901234123457");
}

// ── Serde ────────────────────────────────────────────────────

#[test]
fn serde_roundtrip() {
    let bc = Barcode::new("4901234567890").unwrap();
    let json = serde_json::to_string(&bc).unwrap();
    assert_eq!(json, "\"4901234567890\"");
    let back: Barcode = serde_json::from_str(&json).unwrap();
    assert_eq!(back, bc);
}

#[test]
fn display_and_as_str_match() {
    let bc = Barcode::new("012345678905").unwrap();
    assert_eq!(bc.as_str(), bc.to_string());
}

// ── Display / Clone / Eq / Hash ──

#[test]
fn barcode_display_formats_as_inner() {
    let bc = Barcode::new("4901234567890").unwrap();
    assert_eq!(bc.to_string(), "4901234567890");
}

#[test]
fn barcode_clone_preserves_value() {
    let bc = Barcode::new("5901234123457").unwrap();
    let c = bc.clone();
    assert_eq!(bc, c);
    assert_eq!(c.as_str(), "5901234123457");
}

#[test]
fn barcode_equality_compares_inner_value() {
    let a = Barcode::new("ABC").unwrap();
    let b = Barcode::new("ABC").unwrap();
    let c = Barcode::new("XYZ").unwrap();
    assert_eq!(a, b);
    assert_ne!(a, c);
}

#[test]
fn barcode_hash_consistent_with_eq() {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let a = Barcode::new("ABC").unwrap();
    let b = Barcode::new("ABC").unwrap();
    let mut ha = DefaultHasher::new();
    let mut hb = DefaultHasher::new();
    a.hash(&mut ha);
    b.hash(&mut hb);
    assert_eq!(ha.finish(), hb.finish());
}

#[test]
fn barcode_debug_format_contains_value() {
    let bc = Barcode::new("4901234567890").unwrap();
    let debug = format!("{bc:?}");
    assert!(debug.contains("4901234567890"));
}

// ── FromStr error ──

#[test]
fn from_str_error_on_whitespace() {
    let err: ValidationError = "   ".parse::<Barcode>().unwrap_err();
    assert_eq!(err.field, "barcode");
    assert!(err.message.contains("must not be empty"));
}

// ── Edge cases ───────────────────────────────────────────────

#[test]
fn preserves_leading_zeros() {
    let bc = Barcode::new("000123456789").unwrap();
    assert_eq!(bc.as_str(), "000123456789");
}

#[test]
fn accepts_very_long_barcode() {
    let long = "A".repeat(1000);
    let bc = Barcode::new(&long).unwrap();
    assert_eq!(bc.as_str(), &long);
}

#[test]
fn accepts_unicode_characters() {
    let bc = Barcode::new("café-ラテ").unwrap();
    assert_eq!(bc.as_str(), "café-ラテ");
}

#[test]
fn serde_rejects_empty_string() {
    let result: Result<Barcode, _> = serde_json::from_str("\"\"");
    assert!(result.is_err());
}

#[test]
fn serde_rejects_whitespace_only() {
    let result: Result<Barcode, _> = serde_json::from_str("\"   \"");
    assert!(result.is_err());
}
