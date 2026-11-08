//! Accounts Receivable (Piutang / Jual Tempo / Kasbon) domain model.
//!
//! A [`Receivable`](crate::receivable::Receivable) represents debt owed by a customer to the store
//! for goods or services delivered but not yet paid — the "sell now, pay
//! later" (Kasbon / Jual Tempo) flow (Phase 3 of `docs/plans/_done/done-payment-methods-plan.md` §1.5 & §2c).
//! It mirrors the [`Payable`](crate::payable::Payable) (AP) shape so both sides share one
//! settlement pattern.
//!
//! [`ReceivableStatus`](crate::receivable::ReceivableStatus) is the single source of truth for the `receivables.status`
//! CHECK constraint in `20261021_receivables.sql`; the store validates
//! transitions before they reach SQL. Money is fixed-point [`Money`] (i64
//! minor units) end to end — never a float.
//!
//! This module is pure (no DB): it holds the state machine, the row shapes,
//! and the derived predicates. Persistence lives in `crate::db::receivables`.

use serde::{Deserialize, Serialize};

use crate::Money;

/// Lifecycle status of a receivable.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReceivableStatus {
    /// Nothing paid yet.
    Open,
    /// Partly paid: `0 < paid < amount`.
    Partial,
    /// Fully settled. Terminal.
    Paid,
    /// Forgiven without payment (money-destruction event; audited). Terminal.
    WrittenOff,
}

impl ReceivableStatus {
    /// Parse from the DB TEXT column. An unknown value falls back to
    /// [`ReceivableStatus::Open`] — fail toward "still owed", never silently
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

    /// Legal transitions driven by payments and write-off. A receivable never
    /// returns from a terminal state; `Paid`/`WrittenOff` are sinks.
    pub fn can_transition(from: Self, to: Self) -> bool {
        use ReceivableStatus::{Open, Paid, Partial, WrittenOff};
        matches!(
            (from, to),
            (Open, Partial | Paid | WrittenOff) | (Partial, Paid | WrittenOff)
        )
    }

    /// Derive the status implied by amounts, used after a payment lands. A
    /// write-off is an explicit action, not amount-derived, so this never
    /// returns [`ReceivableStatus::WrittenOff`].
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

/// A receivable row: money a customer owes the store. Maps to the `receivables` table.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Receivable {
    /// Internal row id (UUID v7).
    pub id: String,
    /// Owning tenant.
    pub tenant_id: String,
    /// The customer who owes.
    pub customer_id: String,
    /// Originating sale, when the debt came from a POS transaction.
    pub sale_id: Option<String>,
    /// Free-text origin tag (`pos` / `manual` …).
    pub source: String,
    /// Receipt / invoice reference.
    pub reference: String,
    /// Total owed.
    pub amount: Money,
    /// Cumulative amount paid toward this receivable.
    pub paid: Money,
    /// ISO `YYYY-MM-DD` due date; `None` = open-ended (never overdue).
    pub due_date: Option<String>,
    /// Lifecycle status.
    pub status: ReceivableStatus,
    /// Free-form note.
    pub note: String,
    /// ISO-8601 creation timestamp.
    pub created_at: String,
    /// ISO-8601 last-update timestamp.
    pub updated_at: String,
    /// Set when the receivable reached `paid`.
    pub settled_at: Option<String>,
    /// Set when the receivable was written off.
    pub written_off_at: Option<String>,
}

impl Receivable {
    /// Remaining balance owed (`amount - paid`, floored at 0), in minor units.
    #[must_use]
    pub fn balance_minor(&self) -> i64 {
        (self.amount.minor_units - self.paid.minor_units).max(0)
    }

    /// True while the debt is still owed (open or partial).
    #[must_use]
    pub fn is_owed(&self) -> bool {
        matches!(
            self.status,
            ReceivableStatus::Open | ReceivableStatus::Partial
        )
    }

    /// Overdue when still owed and the due date is strictly before `today`.
    /// Both are ISO `YYYY-MM-DD`, so a lexical compare is date-correct. A
    /// receivable with no due date is never overdue.
    #[must_use]
    pub fn is_overdue(&self, today: &str) -> bool {
        self.is_owed() && self.due_date.as_deref().is_some_and(|d| d < today)
    }
}

/// One recorded payment toward a receivable (settlement history). Maps to a
/// `receivable_payments` row.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReceivablePayment {
    /// Internal row id (UUID v7).
    pub id: String,
    /// Owning tenant.
    pub tenant_id: String,
    /// The receivable this payment reduces.
    pub receivable_id: String,
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

/// Input for creating a receivable. The id, timestamps, status, and paid amount
/// are assigned by the store; the caller supplies the commercial facts.
#[derive(Debug, Clone)]
pub struct NewReceivable {
    /// Owning tenant.
    pub tenant_id: String,
    /// The customer who owes.
    pub customer_id: String,
    /// Originating sale, if any.
    pub sale_id: Option<String>,
    /// Origin tag; defaults to `pos` when empty.
    pub source: String,
    /// Receipt / invoice reference.
    pub reference: String,
    /// Total owed (must be positive).
    pub amount: Money,
    /// ISO `YYYY-MM-DD` due date, if any.
    pub due_date: Option<String>,
    /// Free-form note.
    pub note: String,
}

/// An aging bucket breakdown for accounts receivable.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceivableAgingBucket {
    /// 0 - 30 days outstanding.
    pub current_minor: i64,
    /// 31 - 60 days outstanding.
    pub days_31_60_minor: i64,
    /// 61 - 90 days outstanding.
    pub days_61_90_minor: i64,
    /// More than 90 days outstanding.
    pub days_over_90_minor: i64,
    /// Total outstanding debt across all buckets.
    pub total_outstanding_minor: i64,
}

/// A per-customer AR aging summary row.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomerAgingRow {
    /// Unique customer identifier.
    pub customer_id: String,
    /// Customer display name.
    pub customer_name: String,
    /// Optional customer contact phone number.
    pub customer_phone: Option<String>,
    /// 0 - 30 days outstanding in minor units.
    pub current_minor: i64,
    /// 31 - 60 days outstanding in minor units.
    pub days_31_60_minor: i64,
    /// 61 - 90 days outstanding in minor units.
    pub days_61_90_minor: i64,
    /// More than 90 days outstanding in minor units.
    pub days_over_90_minor: i64,
    /// Total balance outstanding for this customer in minor units.
    pub total_minor: i64,
    /// Count of open/partial receivables for this customer.
    pub open_count: u32,
}

/// Complete AR Aging report response.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceivableAgingReport {
    /// Effective cut-off date (`YYYY-MM-DD`).
    pub as_of_date: String,
    /// ISO-4217 currency code.
    pub currency: String,
    /// Aggregate aging totals across all customers.
    pub summary: ReceivableAgingBucket,
    /// Per-customer breakdown rows.
    pub customers: Vec<CustomerAgingRow>,
}

#[cfg(test)]
#[path = "receivable_tests.rs"]
mod tests;
