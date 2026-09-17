/*
last audited 25-07-26 by RSA-Agent (oz-core slice A)
crate: oz-core | status: SAFE | lint: CLEAN
findings: safe-drop type sound; new() generates v7 correctly; COR-1 FIXED DD-MM-YY (DSH-Agent) — id field doc updated to UUID v7
next: fix field doc | perf: N/A
*/
//! Cash Payout (Safe Drop) domain type.
//!
//! A cash payout represents cash physically removed from the drawer
//! mid-shift (e.g. a bank drop or manager pickup). Payouts reduce the
//! expected cash calculation at shift close.

use serde::{Deserialize, Serialize};

/// A mid-shift cash removal from the drawer (safe drop).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CashPayout {
    /// Internal row id (UUID v7).
    pub id: String,
    /// FK to `shifts.id`.
    pub shift_id: String,
    /// Amount removed in minor units (must be > 0).
    pub amount_minor: i64,
    /// Reason for the payout (e.g. "bank drop", "manager pickup").
    pub reason: String,
    /// ISO-8601 timestamp.
    pub created_at: String,
}

impl CashPayout {
    /// Create a new CashPayout with a generated UUID.
    pub fn new(shift_id: impl Into<String>, amount_minor: i64, reason: impl Into<String>) -> Self {
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        Self {
            id: uuid::Uuid::now_v7().to_string(),
            shift_id: shift_id.into(),
            amount_minor,
            reason: reason.into(),
            created_at: now,
        }
    }
}

#[cfg(test)]
#[path = "cash_payout_tests.rs"]
mod tests;
