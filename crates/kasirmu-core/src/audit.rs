/*
last audited 25-07-26 by RSA-Agent (oz-core slice A)
crate: oz-core | status: SAFE | lint: CLEAN
findings: append-only audit entry type sound; COR-1 FIXED DD-MM-YY (DSH-Agent) — id field doc updated to UUID v7, matching the constructor's ADR #6 generation
next: fix field doc | perf: N/A
*/
//! Audit log — immutable, append-only record of sensitive actions.
//!
//! # PCI-DSS Compliance
//!
//! - **10.2.1**: Audit log captures user ID, event type, date/time,
//!   and success/failure.
//! - **10.3.1**: Audit logs cannot be modified (no UPDATE/DELETE).
//! - **10.3.2**: Audit logs are retained for at least 12 months
//!   (enforced by log rotation policy in `oz-logging`).

use serde::{Deserialize, Serialize};

/// A single immutable audit entry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuditEntry {
    /// UUID v7 identifier.
    pub id: String,
    /// FK to `users.id`. Empty string for system-initiated actions.
    pub user_id: String,
    /// Action type (kebab-case, e.g. "sale.void", "login").
    pub action: String,
    /// Type of entity affected (e.g. "sale", "user", "setting").
    pub target_type: Option<String>,
    /// Identifier of the affected entity.
    pub target_id: Option<String>,
    /// JSON blob with action-specific metadata.
    pub details: String,
    /// Outcome: "success" or "failure".
    pub outcome: String,
    /// ISO-8601 timestamp.
    pub created_at: String,
}

/// A server-side audit review checkpoint (AUD-04).
///
/// Persists each "Mark Reviewed" action with the tenant store, reviewer,
/// review timestamp, and a `(created_at, id)` high-water mark so the badge
/// state is durable, shared across managers, and auditable.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuditReviewCheckpoint {
    /// UUID v7 identifier.
    pub id: String,
    /// Tenant store the checkpoint belongs to.
    pub store_id: String,
    /// User who performed the review.
    pub reviewer_user_id: String,
    /// ISO-8601 timestamp of the review action.
    pub reviewed_at: String,
    /// High-water mark: newest `audit_log.created_at` covered by this review.
    pub reviewed_through_created_at: String,
    /// Tie-breaker: `audit_log.id` of the newest covered entry.
    pub reviewed_through_id: String,
}

impl AuditEntry {
    /// Create a new audit entry with a generated UUID v7 and current UTC timestamp.
    pub fn new(
        user_id: impl Into<String>,
        action: impl Into<String>,
        target_type: Option<impl Into<String>>,
        target_id: Option<impl Into<String>>,
        details: Option<impl Into<String>>,
        outcome: impl Into<String>,
    ) -> Self {
        Self {
            id: uuid::Uuid::now_v7().to_string(),
            user_id: user_id.into(),
            action: action.into(),
            target_type: target_type.map(|s| s.into()),
            target_id: target_id.map(|s| s.into()),
            details: details.map(|s| s.into()).unwrap_or_else(|| "{}".into()),
            outcome: outcome.into(),
            created_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        }
    }
}

#[cfg(test)]
#[path = "audit_tests.rs"]
mod tests;
