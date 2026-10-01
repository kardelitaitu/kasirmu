//! Sibling unit tests for `customer.rs` (AGENTS.md: no tests in production files).
//!
//! Moved here with the type from `modules/crm/src/models_tests.rs`; the assertions are
//! unchanged. `foundation::contact::` became `crate::contact::` because a crate cannot name
//! itself by path.

use super::*;

use crate::contact::{Email, Phone};

// ── Customer ────────────────────────────────────────────────────

#[test]
fn customer_new_sets_defaults() {
    let c = Customer::new("Alice");
    assert_eq!(c.name, "Alice");
    assert!(c.email.is_none());
    assert!(c.phone.is_none());
    assert_eq!(c.loyalty_points, 0);
    assert_eq!(c.total_spent_minor, 0);
    assert_eq!(c.currency, "USD");
    assert!(c.notes.is_empty());
}

#[test]
fn customer_new_trims_name() {
    let c = Customer::new("  Bob  ");
    assert_eq!(c.name, "Bob");
}

#[test]
#[should_panic(expected = "customer name must not be empty")]
fn customer_new_rejects_empty_name() {
    Customer::new("  ");
}

#[test]
fn customer_new_generates_unique_id() {
    let a = Customer::new("A");
    let b = Customer::new("B");
    assert_ne!(a.id, b.id);
}

#[test]
fn customer_with_email() {
    let c = Customer::new("Alice").with_email(Email::new("alice@example.com").unwrap());
    assert_eq!(c.email.as_ref().unwrap().as_str(), "alice@example.com");
}

#[test]
fn customer_with_phone() {
    let c = Customer::new("Bob").with_phone(Phone::new("+1-555-0102").unwrap());
    assert_eq!(c.phone.as_ref().unwrap().as_str(), "+1-555-0102");
}

#[test]
fn customer_builder_chain() {
    let c = Customer::new("Carol")
        .with_email(Email::new("carol@example.com").unwrap())
        .with_phone(Phone::new("+6281234567890").unwrap());
    assert!(c.email.is_some());
    assert!(c.phone.is_some());
}

#[test]
fn customer_serde_roundtrip() {
    let c = Customer::new("Dave")
        .with_email(Email::new("dave@example.com").unwrap())
        .with_phone(Phone::new("+1-555-0199").unwrap());
    let json = serde_json::to_string(&c).unwrap();
    let back: Customer = serde_json::from_str(&json).unwrap();
    assert_eq!(back.name, "Dave");
    assert_eq!(back.email.as_ref().unwrap().as_str(), "dave@example.com");
    assert_eq!(back.phone.as_ref().unwrap().as_str(), "+1-555-0199");
}

#[test]
fn customer_serde_none_fields() {
    let c = Customer::new("Eve");
    let json = serde_json::to_string(&c).unwrap();
    let back: Customer = serde_json::from_str(&json).unwrap();
    assert!(back.email.is_none());
    assert!(back.phone.is_none());
}
