/*
last audited 26-09-26 by DSH (findings corrected: the claim was a stale universal)
crate: kasirmu-payment | status: SAFE | lint: CLEAN
findings: Money (i64 minor units) throughout per house policy. The idempotency_key contract ("processor generates fallback if None") was described here as "ignored by all live drivers — PAY-2"; that was true when written on 25-07-26 and is FALSE now. PAY-2 is closed: all three IMPLEMENTED drivers honour a caller-supplied key — qris.rs:689, stripe.rs:465 (via idempotency_key_for at :242), square.rs:439 (via :341) — each pinned by a test (qris_tests.rs:105, stripe_tests.rs:21/:293, square_tests.rs:186). The single driver that ignores it is Paddle (paddle.rs:115, `_idempotency_key`), and it ignores it because it is a PLANNED stub returning Unsupported for every method (paddle.rs:111-120), so the contract is unhonoured by a driver that performs no operation at all. Note the shape: a universal ("all live drivers") was written from a non-universal observation (the state of the majority at the time), and nothing re-checks a universal when its referent set changes — three of the four drivers were fixed underneath it and the sentence kept reading as current.
next: none in this file | perf: N/A
*/
//! Data types used by the [`PaymentProcessor`](crate::PaymentProcessor) trait.
//!
//! These types model the request/response lifecycle of a payment:
//! authorize → capture → refund.

use foundation::Money;
use serde::{Deserialize, Serialize};

/// The payment processor driver method (driver interface, not DB persistence authority).
///
/// # Architecture Note (ADR-64 D1 & D2)
///
/// This enum is used by [`PaymentProcessor`](crate::PaymentProcessor)
/// drivers (Stripe, Square, QRIS) to communicate with external payment APIs.
/// It is NOT the database persistence authority. Database rows in `payments.method`
/// are strictly validated against the 12-member closed set (`cash`, `card`,
/// `card_debit`, `card_credit`, `qris_manual`, `qris`, `bank_transfer`,
/// `ewallet`, `open_bill`, `credit`, `pay_later`, `other`) via SQLite CHECK
/// constraints.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[non_exhaustive]
pub enum PaymentMethod {
    /// Physical cash.
    Cash,
    /// Credit / debit card (chip, swipe, or contactless).
    Card,
    /// Mobile QR (QRIS, Alipay, WeChat).
    Qr,
    /// Any other method not covered by the variants above.
    Other(String),
}

impl PaymentMethod {
    /// A human-readable label (e.g. for receipts).
    pub fn label(&self) -> &str {
        match self {
            Self::Cash => "Cash",
            Self::Card => "Card",
            Self::Qr => "QR",
            Self::Other(s) => s.as_str(),
        }
    }
}

/// The execution phase of an asynchronous or two-phase payment (ADR-64 D3).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PaymentPhase {
    /// Payment instrument issued (e.g. QR generated, invoice link created),
    /// awaiting payment by customer.
    Issued,
    /// Payment definitively confirmed/captured by processor.
    Confirmed,
}

/// The lifecycle state of a payment tender (ADR-64 D4).
///
/// Models the state machine:
/// Pending → Authorized → Confirmed → Settled
/// or terminal states: Failed, Voided, Refunded, Disputed, Unconfirmed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TenderState {
    /// Tender initiated but awaiting customer action or gateway response.
    Pending,
    /// Funds held/authorized by processor, pending capture.
    Authorized,
    /// Payment corroborated (e.g. gateway webhook or cashier verified).
    Confirmed,
    /// Funds settled into merchant account (end of day / reconciliation).
    Settled,
    /// Terminal failure or rejection by processor.
    Failed,
    /// Explicitly voided prior to settlement.
    Voided,
    /// Refunded back to the customer.
    Refunded,
    /// Disputed or subject to chargeback.
    Disputed,
    /// Offline electronic tender recorded by cashier with no external corroboration.
    Unconfirmed,
}

/// A request to process a payment.
#[derive(Debug, Clone)]
pub struct PaymentRequest {
    /// The amount to charge.
    pub amount: Money,
    /// Optional reference for card / terminal payments (e.g. invoice ID).
    pub reference: Option<String>,
    /// Optional description shown on the cardholder's statement.
    pub description: Option<String>,
    /// Idempotency key (UUIDv7) to prevent duplicate charges on retry.
    /// If `None`, the processor will generate a fallback key.
    pub idempotency_key: Option<String>,
}

/// The outcome of a payment attempt.
#[derive(Debug, Clone)]
pub struct PaymentResult {
    /// Whether the payment was approved or issued.
    pub success: bool,
    /// Execution phase of the payment (ADR-64 D3).
    pub phase: PaymentPhase,
    /// Processor-assigned transaction ID (present on success).
    pub transaction_id: Option<String>,
    /// Authorization code from the processor (present on success).
    pub auth_code: Option<String>,
    /// The amount that was actually charged (may differ from requested
    /// amount in partial-capture scenarios).
    pub amount_charged: Money,
    /// Human-readable message (e.g. "approved", "declined: insufficient funds").
    pub message: Option<String>,
}

impl PaymentResult {
    /// Construct a confirmed payment result.
    pub fn confirmed(
        success: bool,
        transaction_id: Option<String>,
        auth_code: Option<String>,
        amount_charged: Money,
        message: Option<String>,
    ) -> Self {
        Self {
            success,
            phase: PaymentPhase::Confirmed,
            transaction_id,
            auth_code,
            amount_charged,
            message,
        }
    }

    /// Construct an issued (asynchronous / pending scan) payment result.
    pub fn issued(
        transaction_id: Option<String>,
        amount_charged: Money,
        message: Option<String>,
    ) -> Self {
        Self {
            success: true,
            phase: PaymentPhase::Issued,
            transaction_id,
            auth_code: None,
            amount_charged,
            message,
        }
    }
}

/// Processor-specific receipt / terminal data returned after a successful
/// transaction. May be printed or shown to the customer.
#[derive(Debug, Clone)]
pub struct PaymentReceipt {
    /// Processor-assigned transaction ID.
    pub transaction_id: String,
    /// The payment method used.
    pub method: PaymentMethod,
    /// The amount charged.
    pub amount: Money,
    /// Timestamp of the transaction (ISO-8601).
    pub timestamp: String,
    /// Any raw data the processor returned (e.g. hex-encoded EMV data).
    pub raw_data: Option<String>,
}

#[cfg(test)]
#[path = "types_tests.rs"]
mod tests;
