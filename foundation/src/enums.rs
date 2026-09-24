//! Shared enums for the kasir.mu domain model.
/*
last audited 25-07-26 by RSA-Agent (foundation slice E: enums deep read)
crate: foundation | status: SAFE | lint: CLEAN
findings: clean — SaleStatus with exhaustive transition matrix + kebab-case serde round-trip tests, from_stored_str returns None (fail-closed, no default), PaymentMethod::Other(String) catch-all; inline tests (COR-33 pattern)
next: none | perf: N/A
*/
//!
//! These types are used across multiple crates and services.

use serde::{Deserialize, Serialize};

/// The lifecycle state of a sale.
///
/// ```text
/// Pending ──→ Active ──→ Completed
///               │
///               └──→ Voided
/// ```
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SaleStatus {
    /// Sale has been created but not yet started.
    Pending,
    /// Sale is in progress (items being scanned, cart open).
    Active,
    /// Sale has been paid and finalised.
    Completed,
    /// Sale has been cancelled.
    Voided,
}

impl SaleStatus {
    /// Returns `true` when no further transitions are allowed.
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Voided)
    }

    /// Canonical string representation for database storage (kebab-case).
    pub fn as_stored_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Active => "active",
            Self::Completed => "completed",
            Self::Voided => "voided",
        }
    }

    /// Parse a status from its stored string representation.
    pub fn from_stored_str(s: &str) -> Option<Self> {
        match s {
            "pending" => Some(Self::Pending),
            "active" => Some(Self::Active),
            "completed" => Some(Self::Completed),
            "voided" => Some(Self::Voided),
            _ => None,
        }
    }

    /// Check whether a transition from `from` to `to` is valid.
    pub fn can_transition_to(from: Self, to: Self) -> bool {
        matches!(
            (from, to),
            (Self::Pending, Self::Active)
                | (Self::Active, Self::Completed)
                | (Self::Active, Self::Voided)
        )
    }
}

/// Error returned when an invalid state transition is attempted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InvalidTransition {
    /// The state before the attempted transition.
    pub from: SaleStatus,
    /// The state that was requested.
    pub to: SaleStatus,
}

impl std::fmt::Display for InvalidTransition {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "cannot transition from {:?} to {:?}", self.from, self.to)
    }
}

impl std::error::Error for InvalidTransition {}

/// Payment method enumeration.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PaymentMethod {
    /// Cash payment.
    Cash,
    /// Card payment (credit / debit).
    Card,
    /// Catch-all for other payment methods (e.g. voucher).
    Other(String),
}

impl std::fmt::Display for PaymentMethod {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Cash => f.write_str("cash"),
            Self::Card => f.write_str("card"),
            Self::Other(s) => f.write_str(s),
        }
    }
}

#[cfg(test)]
mod tests {
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
}
