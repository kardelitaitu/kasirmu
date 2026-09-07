//! Accounts Payable (Hutang / Beli Tempo) domain model.
//!
//! A [`Payable`] is money the store owes a supplier for stock received but
//! not yet paid — the "add product, haven't paid yet" flow (Phase 4 of
//! `docs/plans/payment-methods-plan.md` §2b). It mirrors the planned
//! receivables (AR) shape so both sides share one settlement pattern.
//!
//! [`PayableStatus`] is the single source of truth for the `payables.status`
//! CHECK constraint in `20260918_payables.sql`; the store validates
//! transitions before they reach SQL. Money is fixed-point [`Money`] (i64
//! minor units) end to end — never a float.
//!
//! This module is pure (no DB): it holds the state machine, the row shapes,
//! and the derived predicates. Persistence lives in `crate::db::payables`.

use serde::{Deserialize, Serialize};

use crate::Money;

/// Lifecycle status of a payable.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PayableStatus {
    /// Nothing paid yet.
    Open,
    /// Partly paid: `0 < paid < amount`.
    Partial,
    /// Fully settled. Terminal.
    Paid,
    /// Forgiven without payment (money-destruction event; audited). Terminal.
    WrittenOff,
}

impl PayableStatus {
    /// Parse from the DB TEXT column. An unknown value falls back to
    /// [`PayableStatus::Open`] — fail toward "still owed", never silently
    /// treat an unrecognized row as settled.
    pub fn from_db(s: &str) -> Self {
        match s {
            "open" => Self::Open,
            "partial" => Self::Partial,
            "paid" => Self::Paid,
            "written_off" => Self::WrittenOff,
            _ => Self::Open,
        }
    }

    /// The DB TEXT representation.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Partial => "partial",
            Self::Paid => "paid",
            Self::WrittenOff => "written_off",
        }
    }

    /// Terminal statuses accept no further payment or write-off.
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Paid | Self::WrittenOff)
    }

    /// Legal transitions driven by payments and write-off. A payable never
    /// returns from a terminal state; `Paid`/`WrittenOff` are sinks.
    pub fn can_transition(from: Self, to: Self) -> bool {
        use PayableStatus::*;
        matches!(
            (from, to),
            (Open, Partial)
                | (Open, Paid)
                | (Open, WrittenOff)
                | (Partial, Paid)
                | (Partial, WrittenOff)
        )
    }

    /// Derive the status implied by amounts, used after a payment lands. A
    /// write-off is an explicit action, not amount-derived, so this never
    /// returns [`PayableStatus::WrittenOff`].
    #[must_use]
    pub fn from_amounts(paid_minor: i64, amount_minor: i64) -> Self {
        if paid_minor <= 0 {
            Self::Open
        } else if paid_minor >= amount_minor {
            Self::Paid
        } else {
            Self::Partial
        }
    }
}

/// A payable row: a debt owed to a supplier. Maps to the `payables` table.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Payable {
    /// Internal row id (UUID v7).
    pub id: String,
    /// Owning tenant.
    pub tenant_id: String,
    /// The supplier owed.
    pub supplier_id: String,
    /// Originating purchase order, when the debt came from a PO receipt.
    pub po_id: Option<String>,
    /// Free-text origin tag (`po_receive` / `stock_add` / `manual` …).
    pub source: String,
    /// Supplier's invoice / bill reference.
    pub reference: String,
    /// Total owed.
    pub amount: Money,
    /// Cumulative amount paid toward this payable.
    pub paid: Money,
    /// ISO `YYYY-MM-DD` due date; `None` = open-ended (never overdue).
    pub due_date: Option<String>,
    /// Lifecycle status.
    pub status: PayableStatus,
    /// Free-form note.
    pub note: String,
    /// ISO-8601 creation timestamp.
    pub created_at: String,
    /// ISO-8601 last-update timestamp.
    pub updated_at: String,
    /// Set when the payable reached `paid`.
    pub settled_at: Option<String>,
    /// Set when the payable was written off.
    pub written_off_at: Option<String>,
}

impl Payable {
    /// Remaining balance owed (`amount - paid`, floored at 0), in minor units.
    #[must_use]
    pub fn balance_minor(&self) -> i64 {
        (self.amount.minor_units - self.paid.minor_units).max(0)
    }

    /// True while the debt is still owed (open or partial).
    #[must_use]
    pub fn is_owed(&self) -> bool {
        matches!(self.status, PayableStatus::Open | PayableStatus::Partial)
    }

    /// Overdue when still owed and the due date is strictly before `today`.
    /// Both are ISO `YYYY-MM-DD`, so a lexical compare is date-correct. A
    /// payable with no due date is never overdue.
    #[must_use]
    pub fn is_overdue(&self, today: &str) -> bool {
        self.is_owed() && self.due_date.as_deref().is_some_and(|d| d < today)
    }
}

/// One recorded payment toward a payable (settlement history). Maps to a
/// `payable_payments` row.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PayablePayment {
    /// Internal row id (UUID v7).
    pub id: String,
    /// Owning tenant.
    pub tenant_id: String,
    /// The payable this payment reduces.
    pub payable_id: String,
    /// Amount paid in this event.
    pub amount: Money,
    /// Actual tender used (`cash` / `bank_transfer` / `qris` …), mirroring
    /// the `payments.method` free-string convention.
    pub method: String,
    /// ISO-8601 timestamp of the payment.
    pub paid_at: String,
    /// User id that recorded it, when known.
    pub recorded_by: Option<String>,
    /// Free-form note.
    pub note: String,
}

/// Input for creating a payable. The id, timestamps, status, and paid amount
/// are assigned by the store; the caller supplies the commercial facts.
#[derive(Debug, Clone)]
pub struct NewPayable {
    /// Owning tenant.
    pub tenant_id: String,
    /// The supplier owed.
    pub supplier_id: String,
    /// Originating purchase order, if any.
    pub po_id: Option<String>,
    /// Origin tag; defaults to `manual` when empty.
    pub source: String,
    /// Supplier invoice reference.
    pub reference: String,
    /// Total owed (must be positive).
    pub amount: Money,
    /// ISO `YYYY-MM-DD` due date, if any.
    pub due_date: Option<String>,
    /// Free-form note.
    pub note: String,
}

#[cfg(test)]
#[path = "payable_tests.rs"]
mod tests;
