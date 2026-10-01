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
            (Self::Pending, Self::Active) | (Self::Active, Self::Completed | Self::Voided)
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
#[path = "enums_tests.rs"]
mod tests;
