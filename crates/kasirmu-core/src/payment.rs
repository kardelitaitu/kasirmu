/*
last audited 25-07-26 by RSA-Agent (oz-core slice A)
crate: oz-core | status: SAFE | lint: CLEAN
findings: tender types sound; idempotency_key captured here confirms PAY-2 drop point is in oz-payment drivers, not oz-core; COR-1 FIXED DD-MM-YY (DSH-Agent) — id field doc updated to UUID v7
next: fix field doc | perf: N/A
*/
//! Payment domain type — individual payment tenders within a sale.
//!
//! A [`Payment`] represents a single tender against a sale. Most sales
//! have one payment (e.g. "cash" for the full amount), but split
//! payments produce multiple payment records (e.g. $10 cash + $5 card).
//! Gateway tracking fields capture external processor references
//! (card-terminal transaction IDs, gateway status, raw responses).
//!
//! # Schema mapping
//!
//! Maps to the `payments` table (migration `022_payments_table.sql`),
//! with gateway fields added by migration `027_payment_gateway_fields.sql`.

use serde::{Deserialize, Serialize};

use crate::money::Money;

/// A single payment tender against a sale.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Payment {
    /// Internal row id (UUID v7).
    pub id: String,

    /// FK to `sales.id`.
    pub sale_id: String,

    /// Payment method ("cash", "card", "other", etc.).
    pub method: String,

    /// Amount tendered in minor units.
    pub amount: Money,

    /// ISO-8601 timestamp of when this payment was recorded.
    pub created_at: String,

    /// Unique transaction reference returned by the payment gateway.
    pub gateway_reference: Option<String>,

    /// Status returned by the payment gateway (e.g. "approved", "declined").
    pub gateway_status: Option<String>,

    /// Raw JSON response returned by the payment gateway.
    pub gateway_response: Option<String>,

    /// Idempotency key (UUIDv7) used for the payment gateway request.
    /// Prevents duplicate charges on retry.
    pub idempotency_key: Option<String>,
}

/// Argument used to describe a payment split when completing a sale.
///
/// This is the serialisation boundary type used in IPC commands.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentSplitArg {
    /// Payment method ("cash", "card", "other", etc.).
    pub method: String,

    /// Amount in minor units.
    pub amount_minor: i64,

    /// Optional transaction reference returned by the payment gateway.
    pub gateway_reference: Option<String>,

    /// Optional status returned by the payment gateway.
    pub gateway_status: Option<String>,

    /// Optional raw response returned by the payment gateway.
    pub gateway_response: Option<String>,

    /// Idempotency key (UUIDv7) used for the payment gateway request.
    /// Prevents duplicate charges on retry when the same key is reused.
    pub idempotency_key: Option<String>,
}

#[cfg(test)]
#[path = "payment_tests.rs"]
mod tests;
