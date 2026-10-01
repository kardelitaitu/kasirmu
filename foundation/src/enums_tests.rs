//! Unit tests for `enums`.
//!
//! Moved out of `enums.rs` to satisfy the AGENTS.md section 2 rule that unit
//! tests live in a sibling `*_tests.rs` file rather than inside a production
//! `.rs` file. Wired from `enums.rs` with:
//!   `#[cfg(test)] #[path = "enums_tests.rs"] mod tests;`

use super::*;

// ── SaleStatus ────────────────────────────────────────────────

#[test]
fn sale_status_pending_is_not_terminal() {
    assert!(!SaleStatus::Pending.is_terminal());
}

#[test]
fn sale_status_active_is_not_terminal() {
    assert!(!SaleStatus::Active.is_terminal());
}

#[test]
fn sale_status_completed_is_terminal() {
    assert!(SaleStatus::Completed.is_terminal());
}

#[test]
fn sale_status_voided_is_terminal() {
    assert!(SaleStatus::Voided.is_terminal());
}

#[test]
fn sale_status_valid_transitions() {
    assert!(SaleStatus::can_transition_to(
        SaleStatus::Pending,
        SaleStatus::Active
    ));
    assert!(SaleStatus::can_transition_to(
        SaleStatus::Active,
        SaleStatus::Completed
    ));
    assert!(SaleStatus::can_transition_to(
        SaleStatus::Active,
        SaleStatus::Voided
    ));
}

#[test]
fn sale_status_invalid_transitions() {
    assert!(!SaleStatus::can_transition_to(
        SaleStatus::Pending,
        SaleStatus::Completed
    ));
    assert!(!SaleStatus::can_transition_to(
        SaleStatus::Pending,
        SaleStatus::Voided
    ));
    assert!(!SaleStatus::can_transition_to(
        SaleStatus::Completed,
        SaleStatus::Pending
    ));
    assert!(!SaleStatus::can_transition_to(
        SaleStatus::Completed,
        SaleStatus::Active
    ));
    assert!(!SaleStatus::can_transition_to(
        SaleStatus::Completed,
        SaleStatus::Voided
    ));
    assert!(!SaleStatus::can_transition_to(
        SaleStatus::Voided,
        SaleStatus::Pending
    ));
    assert!(!SaleStatus::can_transition_to(
        SaleStatus::Voided,
        SaleStatus::Active
    ));
}

#[test]
fn sale_status_as_stored_str() {
    assert_eq!(SaleStatus::Pending.as_stored_str(), "pending");
    assert_eq!(SaleStatus::Active.as_stored_str(), "active");
    assert_eq!(SaleStatus::Completed.as_stored_str(), "completed");
    assert_eq!(SaleStatus::Voided.as_stored_str(), "voided");
}

#[test]
fn sale_status_from_stored_str() {
    assert_eq!(
        SaleStatus::from_stored_str("pending"),
        Some(SaleStatus::Pending)
    );
    assert_eq!(
        SaleStatus::from_stored_str("active"),
        Some(SaleStatus::Active)
    );
    assert_eq!(
        SaleStatus::from_stored_str("completed"),
        Some(SaleStatus::Completed)
    );
    assert_eq!(
        SaleStatus::from_stored_str("voided"),
        Some(SaleStatus::Voided)
    );
    assert_eq!(SaleStatus::from_stored_str("unknown"), None);
    assert_eq!(SaleStatus::from_stored_str(""), None);
}

#[test]
fn sale_status_serde_roundtrip() {
    let statuses = [
        SaleStatus::Pending,
        SaleStatus::Active,
        SaleStatus::Completed,
        SaleStatus::Voided,
    ];
    for s in &statuses {
        let json = serde_json::to_string(s).unwrap();
        let back: SaleStatus = serde_json::from_str(&json).unwrap();
        assert_eq!(*s, back);
    }
}

#[test]
fn sale_status_serde_kebab_case() {
    let json = serde_json::to_string(&SaleStatus::Active).unwrap();
    assert_eq!(json, "\"active\"");
    let json = serde_json::to_string(&SaleStatus::Completed).unwrap();
    assert_eq!(json, "\"completed\"");
}

#[test]
fn sale_status_debug() {
    assert!(!format!("{:?}", SaleStatus::Pending).is_empty());
    assert!(!format!("{:?}", SaleStatus::Active).is_empty());
}

#[test]
fn sale_status_clone_eq() {
    assert_eq!(SaleStatus::Pending, SaleStatus::Pending);
    assert_ne!(SaleStatus::Pending, SaleStatus::Active);
}

// ── InvalidTransition ─────────────────────────────────────────

#[test]
fn invalid_transition_display() {
    let err = InvalidTransition {
        from: SaleStatus::Pending,
        to: SaleStatus::Completed,
    };
    let msg = err.to_string();
    assert!(
        msg.contains("Pending"),
        "message should contain 'Pending', got: {msg}"
    );
    assert!(
        msg.contains("Completed"),
        "message should contain 'Completed', got: {msg}"
    );
}

#[test]
fn invalid_transition_debug() {
    let err = InvalidTransition {
        from: SaleStatus::Pending,
        to: SaleStatus::Completed,
    };
    assert!(!format!("{err:?}").is_empty());
}

#[test]
fn invalid_transition_implements_std_error() {
    let err = InvalidTransition {
        from: SaleStatus::Pending,
        to: SaleStatus::Completed,
    };
    let _: &dyn std::error::Error = &err;
}

#[test]
fn invalid_transition_clone_eq() {
    let a = InvalidTransition {
        from: SaleStatus::Pending,
        to: SaleStatus::Active,
    };
    let b = InvalidTransition {
        from: SaleStatus::Pending,
        to: SaleStatus::Active,
    };
    assert_eq!(a, b);
    assert_ne!(
        a,
        InvalidTransition {
            from: SaleStatus::Pending,
            to: SaleStatus::Completed
        }
    );
}

// ── PaymentMethod ─────────────────────────────────────────────

#[test]
fn payment_method_cash_display() {
    assert_eq!(PaymentMethod::Cash.to_string(), "cash");
}

#[test]
fn payment_method_card_display() {
    assert_eq!(PaymentMethod::Card.to_string(), "card");
}

#[test]
fn payment_method_other_display() {
    assert_eq!(
        PaymentMethod::Other("gift-card".to_string()).to_string(),
        "gift-card"
    );
}

#[test]
fn payment_method_debug() {
    assert!(!format!("{:?}", PaymentMethod::Cash).is_empty());
}

#[test]
fn payment_method_clone_eq() {
    assert_eq!(PaymentMethod::Cash, PaymentMethod::Cash);
    assert_ne!(PaymentMethod::Cash, PaymentMethod::Card);
    let a = PaymentMethod::Other("crypto".into());
    let b = PaymentMethod::Other("crypto".into());
    assert_eq!(a, b);
}

#[test]
fn payment_method_serde_roundtrip() {
    let methods = [
        PaymentMethod::Cash,
        PaymentMethod::Card,
        PaymentMethod::Other("mobile-pay".into()),
    ];
    for m in &methods {
        let json = serde_json::to_string(m).unwrap();
        let back: PaymentMethod = serde_json::from_str(&json).unwrap();
        assert_eq!(*m, back);
    }
}

#[test]
fn payment_method_serde_kebab_case() {
    assert_eq!(
        serde_json::to_string(&PaymentMethod::Cash).unwrap(),
        "\"cash\""
    );
    assert_eq!(
        serde_json::to_string(&PaymentMethod::Card).unwrap(),
        "\"card\""
    );
}
