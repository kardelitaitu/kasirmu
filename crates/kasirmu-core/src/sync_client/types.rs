//! Sync wire types and HTTP error classification (ADR sync-auth-hardening P1/P4).
//!
//! Split out of `sync_client.rs` on 2026-09-28. `PushOutcome` is the SINGLE
//! definition of the per-item push result: `platform_sync::transport` re-exports
//! it, so both `kasirmu_core::sync_client::PushOutcome` and
//! `platform_sync::transport::PushOutcome` resolve here.
//!
//! Invariant: a 401 is SPLIT (`AuthExpired` vs `AuthInvalid`) so a caller can
//! refresh-and-retry exactly once on an expired token, while a genuinely invalid
//! key stays a configuration problem that no refresh may mask. A duplicate-id
//! reason is NOT a rejection: ids are client-generated once at enqueue, so the
//! server already holding one means this item was pushed before.

use serde::{Deserialize, Serialize};

use super::SyncAuthHealth;
use crate::offline::OfflineQueueItem;

/// Per-item outcome returned by the server's `POST /api/sync/push`.
///
/// The single definition of this type: `platform_sync::transport` re-exports
/// it (`pub use kasirmu_core::sync_client::PushOutcome`), so both the
/// `kasirmu_core::sync_client::PushOutcome` and the
/// `platform_sync::transport::PushOutcome` import paths resolve to this enum.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum PushOutcome {
    /// Item was accepted and applied by the server.
    Accepted,
    /// Item conflicted with the server version.
    Conflict(OfflineQueueItem),
    /// Item was rejected with a reason.
    Rejected {
        /// Human-readable rejection reason from the server.
        reason: String,
    },
}

/// Server response envelope for push.
#[derive(Debug, Deserialize)]
pub(crate) struct PushResponse {
    pub(crate) results: Vec<PushOutcome>,
}

/// Prefix the cloud server puts on the `Rejected` reason when a pushed item's
/// id already exists (`apps/cloud-server/src/sync_store.rs` `push_batch`,
/// `format!("duplicate id: {}", item.id)`).
///
/// A duplicate id is NOT a rejection: item ids are client-generated UUIDs
/// assigned once at enqueue, so the only way the server already holds an id is
/// that THIS item was pushed before — the canonical case being a crash between
/// the server insert and the local `mark_offline_synced`, then a re-push on
/// recovery. The data is safely on the server; the correct local state is
/// `synced`, not a terminal `failed`. The server itself agrees: it labels
/// duplicate-id outcomes `"conflict"` (not `"rejected"`) in its push metrics
/// (`sync_api.rs`). Both the immediate
/// [`apply_sync_outcomes`](super::apply_sync_outcomes) and the daemon's
/// `apply_push_results` route these to synced via this predicate.
pub const DUPLICATE_ID_REJECTION_PREFIX: &str = "duplicate id:";

/// Whether a `Rejected` reason is an idempotent-replay duplicate (already on
/// the server) rather than a genuine rejection.
pub fn is_duplicate_id_rejection(reason: &str) -> bool {
    reason.starts_with(DUPLICATE_ID_REJECTION_PREFIX)
}

/// Result of a single sync attempt.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncAttemptResult {
    /// Number of items successfully synced.
    pub synced: usize,
    /// Number of items that failed to sync.
    pub failed: usize,
    /// Error message if the entire sync failed (e.g. network error).
    pub error: Option<String>,
    /// The server rejected the attempt because this tenant is on the
    /// `free` plan (ADR sync-plan-gating). The UI shows an upgrade prompt
    /// and queued items stay `pending` — they are valid, just gated.
    #[serde(default)]
    pub plan_required: bool,
}

/// Typed HTTP error from the sync client (ADR sync-auth-hardening P1/P4).
///
/// 401 responses are split so callers can refresh the stored token and retry
/// exactly once when it EXPIRED, while treating a genuinely invalid key as a
/// configuration problem that must not be masked by a refresh.
#[derive(Debug, thiserror::Error)]
pub enum SyncHttpError {
    /// The server said the token expired (HTTP 401 + `token_expired`, or a
    /// bare 401 from an older server). Safe to refresh the API key and
    /// retry once.
    #[error("sync server rejected authentication: token expired (HTTP 401)")]
    AuthExpired,

    /// The server said the token is invalid or missing (HTTP 401 +
    /// `invalid_token` / `missing_token`). A configuration problem — do NOT
    /// refresh; surface the error.
    #[error("sync server rejected authentication: invalid token (HTTP 401)")]
    AuthInvalid,

    /// The tenant is on the `free` plan and cloud sync is gated
    /// (HTTP 403 + `plan_required`, ADR sync-plan-gating). Terminal: do
    /// NOT refresh, retry, or quarantine — surface the upgrade prompt.
    #[error("cloud sync requires a paid plan (HTTP 403 plan_required)")]
    PlanRequired,

    /// The server returned a non-2xx status other than 401.
    #[error("sync server returned {status}: {body}")]
    Server {
        /// HTTP status code.
        status: u16,
        /// Response body for diagnostics.
        body: String,
    },

    /// The request failed at the network layer (connect, timeout, DNS).
    #[error("sync request failed: {0}")]
    Network(String),

    /// The response could not be parsed.
    #[error("sync response parse failed: {0}")]
    Parse(String),

    /// The HTTP client could not be constructed.
    #[error("failed to build HTTP client: {0}")]
    Client(String),
}

/// Classify a 401 response body (ADR sync-auth-hardening P4).
///
/// Servers with structured errors say `token_expired` / `invalid_token` /
/// `missing_token`. A bare 401 (older server) is treated as stale auth so
/// the refresh-and-retry behaviour from P1 keeps working.
fn classify_401(body: &str) -> SyncHttpError {
    if body.contains("token_expired") {
        SyncHttpError::AuthExpired
    } else if body.contains("invalid_token") || body.contains("missing_token") {
        SyncHttpError::AuthInvalid
    } else {
        SyncHttpError::AuthExpired
    }
}

/// Classify a non-2xx HTTP status into a typed [`SyncHttpError`]
/// (ADR sync-auth-hardening P4 + ADR sync-plan-gating).
///
/// Used by both `send_items_to_server` and `fetch_snapshot_from_server` so
/// the push and pull paths agree on 401/403 semantics:
///
/// - `401` → `AuthExpired` / `AuthInvalid` (refresh only on expiry).
/// - `403` + `plan_required` → `PlanRequired` (terminal — no refresh,
///   no retry, no quarantine).
/// - anything else → `Server { status, body }`.
pub(crate) fn classify_http_status(status: u16, body: &str) -> SyncHttpError {
    if status == reqwest::StatusCode::UNAUTHORIZED.as_u16() {
        classify_401(body)
    } else if status == reqwest::StatusCode::FORBIDDEN.as_u16() && body.contains("plan_required") {
        SyncHttpError::PlanRequired
    } else {
        SyncHttpError::Server {
            status,
            body: body.to_owned(),
        }
    }
}

/// Result of a `pull_snapshot` round-trip.
///
/// The three counts tell the UI how many rows landed in the local
/// cache for each domain (products, tax rates, users). `error` is
/// populated when the entire pull failed at the network or decode
/// stage — partial successes are surfaced as `Ok` with the per-domain
/// counts.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PullResult {
    /// Number of products upserted from the server snapshot.
    pub products_pulled: usize,
    /// Number of tax rates upserted from the server snapshot.
    pub tax_rates_pulled: usize,
    /// Number of users upserted from the server snapshot.
    pub users_pulled: usize,
    /// Error message if the entire pull failed (e.g. network error).
    pub error: Option<String>,
}

/// Result of a health-check ping to the cloud server.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PingResult {
    /// Whether the server responded successfully.
    pub ok: bool,
    /// Status text (e.g. "Connected", "Connection refused", etc.).
    pub status: String,
    /// Round-trip latency in milliseconds, if the ping succeeded.
    pub latency_ms: Option<u64>,
    /// Whether the stored credential was accepted, when one was checked.
    ///
    /// `ok` alone answers "did something reply?" — `/health` is public, so
    /// a green `ok` says nothing about whether sync can actually run. This
    /// carries the credential's own verdict alongside it, so a renderer can
    /// tell "connected and authorised" from "connected but every push will
    /// 401". `None` means no credential check was made (a probe with no
    /// stored key, or a reachability-only caller).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth: Option<SyncAuthHealth>,
}

/// Format an ISO-8601 expiry timestamp as a human-readable relative duration.
///
/// Returns strings like "in 2 hours", "in 3 days", "in 5 minutes", or
/// the raw timestamp if parsing fails.
#[cfg(feature = "sync-http")]
pub(crate) fn format_expiry(iso: &str) -> String {
    // Try RFC 3339 first (the most common ISO-8601 variant from APIs).
    let Ok(expiry) = chrono::DateTime::parse_from_rfc3339(iso) else { return format!("expires {iso}") };
    let now = chrono::Utc::now();
    let dur = expiry.signed_duration_since(now);

    if dur.num_seconds() <= 0 {
        return "expired".into();
    }

    let mins = dur.num_minutes();
    let hours = dur.num_hours();
    let days = dur.num_days();

    if days >= 2 {
        format!("expires in {days} days")
    } else if days == 1 {
        "expires in 1 day".into()
    } else if hours >= 2 {
        format!("expires in {hours} hours")
    } else if hours == 1 {
        "expires in 1 hour".into()
    } else if mins >= 2 {
        format!("expires in {mins} minutes")
    } else if mins == 1 {
        "expires in 1 minute".into()
    } else {
        "expires in less than a minute".into()
    }
}
