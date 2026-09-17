//! Payment settlement ledger CRUD — PLANNED (stubs).
/*
last audited 25-07-26 by RSA-Agent (oz-core slice B5: trivial stub file)
crate: oz-core | status: SAFE | lint: CLEAN
findings: honest fail-fast stubs + schema-mirroring struct; zero logic; no risk
next: none | perf: N/A
*/
//!
//! These methods are stubs until the reconciliation job is implemented.
//! The `payment_settlements` table is created by migration
//! `20260825_payment_infra.sql` but the Rust methods below are not yet
//! functional.

use super::Store;
use crate::error::CoreError;

/// PLANNED: record an incoming settlement from a gateway.
pub fn record_settlement(_store: &Store<'_>) -> Result<(), CoreError> {
    Err(CoreError::Internal(
        "record_settlement — PLANNED, not implemented yet".into(),
    ))
}

/// PLANNED: list settlements for a tenant by status.
pub fn list_settlements(_store: &Store<'_>) -> Result<Vec<PaymentSettlement>, CoreError> {
    Err(CoreError::Internal(
        "list_settlements — PLANNED, not implemented yet".into(),
    ))
}

/// PLANNED: mark a settlement as matched or discrepancy (reconciliation).
pub fn update_settlement_status(_store: &Store<'_>) -> Result<(), CoreError> {
    Err(CoreError::Internal(
        "update_settlement_status — PLANNED, not implemented yet".into(),
    ))
}

/// A payment settlement row (from `payment_settlements`).
#[derive(Debug, Clone)]
pub struct PaymentSettlement {
    /// UUID v7.
    pub id: String,
    /// RLS tenant scope.
    pub tenant_id: String,
    /// Gateway name.
    pub gateway: String,
    /// Gateway settlement/batch reference.
    pub batch_id: String,
    /// ISO-8601 settlement timestamp (nullable).
    pub settled_at: Option<String>,
    /// Expected amount in minor units.
    pub expected_minor: i64,
    /// Actual deposited amount in minor units.
    pub actual_minor: i64,
    /// Currency code.
    pub currency: String,
    /// Status: "pending", "matched", "discrepancy", "reconciled".
    pub status: String,
    /// ISO-8601 creation timestamp.
    pub created_at: String,
    /// ISO-8601 update timestamp.
    pub updated_at: String,
}
