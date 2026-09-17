//! Cloud sync client — pushes pending offline queue items to a remote server.
/*
last audited 25-07-26 by RSA-Agent (kasirmu-core slice C1: sync_client deep read) | 2026-09-06 DSH assist pass: stamp corrected only, no code change (COR-31 finding was stale)
crate: kasirmu-core | status: SAFE | lint: CLEAN
findings: sync-auth-hardening P1-P4 exemplary — typed 401 classification (refresh-once-on-expiry vs invalid-as-config-problem), terminal PlanRequired state (no retry/quarantine), admin-key gating (P2), client-credentials path (P3); SYNC-06 credential hygiene exemplary — snapshot users upsert with SNAPSHOT_PIN_HASH_PLACEHOLDER (never a real verifier), pin_hash omitted from UPDATE, deny_unknown_fields makes a misbehaving server fail loudly; pull applies in one tx; COR-31 CLOSED 2026-09-06 (assist pass) — the clause here previously read "COR-31 LOW: fetch_snapshot_from_server (1138) uses Client::new() with NO timeout", which was wrong twice over: the line number pointed past end of file (this file is 492 lines), and the function actually lives in sync_pull.rs:165, where it has been bounded since the COR-31 sweep (10s connect / 120s total, sync_pull.rs:180-182 — that comment even notes it overrode the 60s this stamp suggested, without ever correcting this stamp). Both clients still in this file are bounded as well (382 and 438, 30s each). No unbounded request remains in either file.
next: perf: batch push per-item outcomes, no N+1 (the former "add a 60s timeout to the snapshot fetch (COR-31)" item was already done, in another file — see findings above)
*/
//!
//! The sync client reads from the local offline queue, sends items as a batch
//! to the configured remote server via `POST /api/sync/push`, and marks each
//! item as synced or failed based on the server's per-item outcomes.
//!
//! Pull (`GET /api/sync/snapshot`) fetches the server's authoritative
//! reference data (products, tax rates, users) and upserts it locally.
//!
//! ## Runtime safety
//!
//! The public API (`ping_server`, `request_token`, `send_items_to_server`,
//! `fetch_snapshot_from_server`) is **async** using `reqwest::Client` so
//! Tauri v2 command handlers can call them with `.await` without nesting
//! Tokio runtimes. The legacy blocking helpers (`sync_pending`,
//! `send_items_to_server_blocking`) remain available only for
//! `tokio::task::spawn_blocking` or non-async contexts.

use serde::{Deserialize, Serialize};

use crate::db::Store;
use crate::error::CoreError;
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
#[derive(Debug, Clone, Deserialize)]
struct PushResponse {
    results: Vec<PushOutcome>,
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
/// (`sync_api.rs`). Both the immediate [`apply_sync_outcomes`] and the daemon's
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
fn classify_http_status(status: u16, body: &str) -> SyncHttpError {
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
}

/// Format an ISO-8601 expiry timestamp as a human-readable relative duration.
///
/// Returns strings like "in 2 hours", "in 3 days", "in 5 minutes", or
/// the raw timestamp if parsing fails.
#[cfg(feature = "sync-http")]
fn format_expiry(iso: &str) -> String {
    // Try RFC 3339 first (the most common ISO-8601 variant from APIs).
    let expiry = match chrono::DateTime::parse_from_rfc3339(iso) {
        Ok(dt) => dt,
        Err(_) => return format!("expires {iso}"),
    };
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

#[path = "sync_auth.rs"]
mod sync_auth;

pub use sync_auth::*;

#[path = "sync_pull.rs"]
mod sync_pull;

pub use sync_pull::*;

/// Sync client configuration.
#[derive(Debug, Clone)]
pub struct SyncConfig {
    /// Remote server base URL (e.g. "http://localhost:3099").
    pub server_url: String,
    /// API key for authentication (sent as `Authorization: Bearer {key}`).
    /// This should be a JWT token generated by the cloud server's
    /// `POST /api/v1/tokens` endpoint.
    pub api_key: Option<String>,
}

impl SyncConfig {
    /// Load sync configuration from settings.
    pub fn from_settings(store: &Store) -> Result<Option<Self>, CoreError> {
        let enabled = crate::settings::Settings::is_sync_enabled(store.conn())?;
        if !enabled {
            return Ok(None);
        }
        let server_url = crate::settings::Settings::get_sync_server_url(store.conn())?;
        let server_url = match server_url {
            Some(u) if !u.is_empty() => u,
            _ => return Ok(None),
        };
        let api_key =
            crate::settings::Settings::get_sync_api_key(store.conn())?.filter(|k| !k.is_empty());
        Ok(Some(Self {
            server_url,
            api_key,
        }))
    }
}

/// Apply per-item sync outcomes to the offline queue (mark items as
/// synced or failed). This is the DB-only post-processing phase that
/// runs after the async HTTP call completes, so no Store reference
/// is held during the network round-trip.
pub fn apply_sync_outcomes(
    store: &Store,
    pending: &[OfflineQueueItem],
    outcomes: &[PushOutcome],
) -> Result<SyncAttemptResult, CoreError> {
    let mut synced = 0usize;
    let mut failed = 0usize;
    let mut global_error: Option<String> = None;

    for (item, outcome) in pending.iter().zip(outcomes.iter()) {
        match outcome {
            PushOutcome::Accepted => {
                store.mark_offline_synced(&item.id)?;
                synced += 1;
            }
            PushOutcome::Rejected { reason } if is_duplicate_id_rejection(reason) => {
                // Idempotent replay: the server already holds this exact item
                // (same client-generated id), so the mutation is safely
                // persisted. Treat as synced rather than a terminal failure —
                // push-side `failed` items have no requeue path, so marking a
                // successful replay `failed` would strand it permanently and
                // pollute `failed_count`. See DUPLICATE_ID_REJECTION_PREFIX.
                tracing::info!(
                    item_id = %item.id,
                    "sync push duplicate-id replay: item already on server, marking synced"
                );
                store.mark_offline_synced(&item.id)?;
                synced += 1;
            }
            PushOutcome::Rejected { reason } => {
                store.mark_offline_failed(&item.id, reason)?;
                failed += 1;
                global_error = Some(reason.clone());
            }
            PushOutcome::Conflict(server_item) => {
                // OFF-11: the server already holds this queued action, so the
                // server's copy wins. Record it as a *resolved* conflict (via
                // `mark_offline_resolved`) rather than a bare failure — this is
                // the marker the `offline_queue_status_summary` conflict_count
                // query counts (`last_error LIKE 'resolved: conflict%'`), so the
                // UI's conflict observability reflects real command-boundary
                // conflicts instead of always reading zero.
                tracing::warn!(
                    item_id = %item.id,
                    server_action = %server_item.action,
                    "sync conflict: item already exists on server with different data; server copy wins"
                );
                let resolution = format!(
                    "server item wins (action={} already on server)",
                    server_item.action
                );
                store.mark_offline_resolved(&item.id, &resolution)?;
                synced += 1;
            }
        }
    }

    Ok(SyncAttemptResult {
        synced,
        failed,
        error: global_error,
        plan_required: false,
    })
}

/// Mark all pending items as failed with the given error message.
pub fn mark_all_failed(
    store: &Store,
    pending: &[OfflineQueueItem],
    err_msg: &str,
) -> Result<SyncAttemptResult, CoreError> {
    for item in pending {
        store.mark_offline_failed(&item.id, err_msg)?;
    }
    Ok(SyncAttemptResult {
        synced: 0,
        failed: pending.len(),
        error: Some(err_msg.into()),
        plan_required: false,
    })
}

/// Attempt to sync all pending offline items to the remote server.
///
/// Uses blocking HTTP — only safe when called from a non-async context
/// or inside `tokio::task::spawn_blocking`. For async Tauri commands,
/// prefer the split read/HTTP/write pattern using `send_items_to_server`
/// (async) + `apply_sync_outcomes`.
pub fn sync_pending(store: &Store, config: &SyncConfig) -> Result<SyncAttemptResult, CoreError> {
    let pending = store.list_pending_offline()?;
    if pending.is_empty() {
        return Ok(SyncAttemptResult {
            synced: 0,
            failed: 0,
            error: None,
            plan_required: false,
        });
    }

    // This still uses reqwest::blocking — only safe from spawn_blocking or
    // non-async contexts. The Tauri commands use the split async path instead.
    match send_items_to_server_blocking(config, &pending) {
        Ok(outcomes) => apply_sync_outcomes(store, &pending, &outcomes),
        // ADR sync-plan-gating: a free tenant is gated, not broken. Do NOT
        // mark the items failed — they stay `pending` and sync automatically
        // once the tenant upgrades.
        Err(SyncHttpError::PlanRequired) => Ok(SyncAttemptResult {
            synced: 0,
            failed: 0,
            error: Some("cloud sync requires a paid plan".into()),
            plan_required: true,
        }),
        Err(e) => mark_all_failed(store, &pending, &e.to_string()),
    }
}

/// Blocking variant of send_items_to_server — only for spawn_blocking contexts.
#[cfg(feature = "sync-http")]
fn send_items_to_server_blocking(
    config: &SyncConfig,
    items: &[OfflineQueueItem],
) -> Result<Vec<PushOutcome>, SyncHttpError> {
    let url = format!("{}/api/sync/push", config.server_url.trim_end_matches('/'));

    let mut request = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| SyncHttpError::Client(format!("failed to build HTTP client: {e}")))?
        .post(&url)
        .header("Content-Type", "application/json");

    if let Some(ref key) = config.api_key {
        request = request.header("Authorization", &format!("Bearer {key}"));
    }

    let resp = request
        .json(items)
        .send()
        .map_err(|e| SyncHttpError::Network(format!("sync HTTP request failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().unwrap_or_default();
        return Err(classify_http_status(status.as_u16(), &body));
    }

    let push_resp: PushResponse = resp
        .json()
        .map_err(|e| SyncHttpError::Parse(format!("sync response parse failed: {e}")))?;

    tracing::info!(
        item_count = items.len(),
        server = %config.server_url,
        "synced batch to server"
    );
    Ok(push_resp.results)
}

#[cfg(not(feature = "sync-http"))]
fn send_items_to_server_blocking(
    config: &SyncConfig,
    items: &[OfflineQueueItem],
) -> Result<Vec<PushOutcome>, SyncHttpError> {
    tracing::info!(
        item_count = items.len(),
        server = %config.server_url,
        "sync-http feature disabled; would sync batch to server"
    );
    Ok(vec![PushOutcome::Accepted; items.len()])
}

/// Send a batch of offline queue items to the remote server via
/// `POST /api/sync/push` and return per-item outcomes (async).
#[cfg(feature = "sync-http")]
pub async fn send_items_to_server(
    config: &SyncConfig,
    items: &[OfflineQueueItem],
) -> Result<Vec<PushOutcome>, SyncHttpError> {
    let url = format!("{}/api/sync/push", config.server_url.trim_end_matches('/'));

    let mut request = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| SyncHttpError::Client(e.to_string()))?
        .post(&url)
        .header("Content-Type", "application/json");

    if let Some(ref key) = config.api_key {
        request = request.header("Authorization", &format!("Bearer {key}"));
    }

    let resp = request
        .json(items)
        .send()
        .await
        .map_err(|e| SyncHttpError::Network(e.to_string()))?;

    if !resp.status().is_success() {
        // Read the body once; `text()` consumes the response.
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(classify_http_status(status.as_u16(), &body));
    }

    let push_resp: PushResponse = resp
        .json()
        .await
        .map_err(|e| SyncHttpError::Parse(e.to_string()))?;

    tracing::info!(
        item_count = items.len(),
        server = %config.server_url,
        "synced batch to server"
    );
    Ok(push_resp.results)
}

/// Stub used when `sync-http` feature is disabled — just logs the intent.
#[cfg(not(feature = "sync-http"))]
pub async fn send_items_to_server(
    config: &SyncConfig,
    items: &[OfflineQueueItem],
) -> Result<Vec<PushOutcome>, SyncHttpError> {
    tracing::info!(
        item_count = items.len(),
        server = %config.server_url,
        "sync-http feature disabled; would sync batch to server"
    );
    // Pretend all items were accepted when HTTP is compiled out.
    Ok(vec![PushOutcome::Accepted; items.len()])
}

// ── Memo cloud push (2026-09-07 cloud-read ruling) ─────────────────

/// One recipient row of a memo the desktop pushes to the cloud.
#[derive(Debug, Clone, Serialize)]
pub struct MemoRecipientPush {
    /// Recipient row id (desktop-minted).
    pub id: String,
    /// The terminal this row addresses.
    pub terminal_id: String,
    /// Delivery state (`pending`/`delivered`/`acknowledged`).
    pub delivery_status: String,
    /// Delivery instant, if delivered.
    pub delivered_at: Option<String>,
    /// Acknowledgement instant, if acknowledged.
    pub acknowledged_at: Option<String>,
    /// Who acknowledged.
    pub acknowledged_by: Option<String>,
}

/// One memo of the tenant's complete pushed state.
#[derive(Debug, Clone, Serialize)]
pub struct MemoPushRow {
    /// Memo id (desktop-minted, the cloud's primary key).
    pub id: String,
    /// Author's user id.
    pub author_user_id: String,
    /// Author's role snapshot at publish time.
    pub author_role: String,
    /// Title.
    pub title: String,
    /// Body.
    pub body: String,
    /// Lifecycle status.
    pub status: String,
    /// Display duration.
    pub duration: String,
    /// Current revision.
    pub revision: i64,
    /// Publish instant, if published.
    pub published_at: Option<String>,
    /// Expiry instant, if published.
    pub expires_at: Option<String>,
    /// Early-stop instant, if stopped.
    pub stopped_at: Option<String>,
    /// Who stopped it.
    pub stopped_by: Option<String>,
    /// Archival instant — the retention-deletion clock.
    pub archived_at: Option<String>,
    /// Creation timestamp.
    pub created_at: String,
    /// Last-update timestamp.
    pub updated_at: String,
    /// Targeted location ids; empty ⇒ Organization Memo.
    pub location_ids: Vec<String>,
    /// The published fan-out: one recipient per target terminal.
    pub recipients: Vec<MemoRecipientPush>,
}

/// Server acknowledgement for a memo push.
#[derive(Debug, Deserialize)]
pub struct MemoSyncAck {
    /// How many memos the server upserted.
    pub upserted: i64,
    /// How many stale rows it deleted (reconciliation).
    pub deleted: i64,
}

/// Server result of a terminal memo acknowledgement.
#[derive(Debug, Clone, Deserialize)]
pub struct MemoAckCloud {
    /// The memo that was acknowledged.
    pub memo_id: String,
    /// The terminal whose recipient row moved (server reads it from the
    /// token claim).
    pub terminal_id: String,
    /// Always `acknowledged` after the call.
    pub delivery_status: String,
    /// When the acknowledgement landed.
    pub acknowledged_at: String,
    /// True when THIS call moved the row; false on an idempotent re-ack.
    pub changed: bool,
}

/// Acknowledge a memo from this terminal through the cloud
/// (`POST /api/v1/memos/{memo_id}/ack`, async). The terminal identity
/// rides the token's `terminal_id` claim — the server rejects a token
/// with none — so the request cannot name another terminal. `user_id`
/// is informational (who at the terminal acknowledged).
#[cfg(feature = "sync-http")]
pub async fn ack_memo_on_server(
    config: &SyncConfig,
    memo_id: &str,
    user_id: Option<&str>,
) -> Result<MemoAckCloud, SyncHttpError> {
    let url = format!(
        "{}/api/v1/memos/{}/ack",
        config.server_url.trim_end_matches('/'),
        memo_id
    );

    let mut request = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| SyncHttpError::Client(e.to_string()))?
        .post(&url)
        .header("Content-Type", "application/json");

    if let Some(ref key) = config.api_key {
        request = request.header("Authorization", &format!("Bearer {key}"));
    }

    let resp = request
        .json(&serde_json::json!({ "acknowledged_by": user_id }))
        .send()
        .await
        .map_err(|e| SyncHttpError::Network(e.to_string()))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(classify_http_status(status.as_u16(), &body));
    }

    resp.json::<MemoAckCloud>()
        .await
        .map_err(|e| SyncHttpError::Parse(e.to_string()))
}

/// Stub used when `sync-http` feature is disabled — always fails so the
/// caller's local-write fallback applies (a durable ack has no honest
/// pretend-success).
#[cfg(not(feature = "sync-http"))]
pub async fn ack_memo_on_server(
    config: &SyncConfig,
    _memo_id: &str,
    _user_id: Option<&str>,
) -> Result<MemoAckCloud, SyncHttpError> {
    Err(SyncHttpError::Client(
        "sync-http feature is disabled".into(),
    ))
}

/// Push the tenant's complete memo state to the cloud via
/// `POST /api/v1/memos/sync` (async). The snapshot IS the truth — the
/// server upserts and deletes by omission, so a failed push self-corrects
/// on the next full push. Tenant scope rides the JWT, never the body.
#[cfg(feature = "sync-http")]
pub async fn push_memos_to_server(
    config: &SyncConfig,
    memos: &[MemoPushRow],
) -> Result<MemoSyncAck, SyncHttpError> {
    let url = format!(
        "{}/api/v1/memos/sync",
        config.server_url.trim_end_matches('/')
    );

    let mut request = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| SyncHttpError::Client(e.to_string()))?
        .post(&url)
        .header("Content-Type", "application/json");

    if let Some(ref key) = config.api_key {
        request = request.header("Authorization", &format!("Bearer {key}"));
    }
    // ADR sync-auth-hardening P2: a gated deployment (OZ_ADMIN_KEY set)
    // rejects the tenant-sync write for a non-terminal token without the
    // admin key — mirror `request_token`'s passthrough so a desktop that
    // provisioned via the fallback (admin-minted) path keeps pushing.
    if let Some(key) = admin_key_from_env() {
        request = request.header("x-admin-key", key);
    }

    let resp = request
        .json(&serde_json::json!({ "memos": memos }))
        .send()
        .await
        .map_err(|e| SyncHttpError::Network(e.to_string()))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(classify_http_status(status.as_u16(), &body));
    }

    resp.json::<MemoSyncAck>()
        .await
        .map_err(|e| SyncHttpError::Parse(e.to_string()))
}

/// One active memo served by the cloud (`GET /api/v1/memos/active`).
///
/// Wire-mirrors `kasirmu_api::pg::ActiveMemoPg` (snake_case field names —
/// that struct carries no serde rename), so the tablet can map it into
/// its display DTO without a serde rename on either side.
#[derive(Debug, Clone, Deserialize)]
pub struct ActiveMemoCloud {
    /// Memo id.
    pub id: String,
    /// Targeted location ids; empty ⇒ Organization Memo.
    pub location_ids: Vec<String>,
    /// Author's user id.
    pub author_user_id: String,
    /// Author's role snapshot.
    pub author_role: String,
    /// Title.
    pub title: String,
    /// Body.
    pub body: String,
    /// Display duration.
    pub duration: String,
    /// Current revision.
    pub revision: i64,
    /// Publish instant, if published.
    pub published_at: Option<String>,
    /// Expiry instant, if published.
    pub expires_at: Option<String>,
    /// Creation timestamp.
    pub created_at: String,
    /// This terminal's delivery state.
    pub delivery_status: String,
}

/// Server-issued poll cadence (base + KDS interval in seconds).
#[derive(Debug, Clone, Deserialize)]
pub struct MemoCadenceCloud {
    /// Base notification interval in seconds.
    pub base_interval_secs: i64,
    /// KDS interval in seconds (2 × base).
    pub kds_interval_secs: i64,
}

/// Response envelope for `GET /api/v1/memos/active`.
#[derive(Debug, Clone, Deserialize)]
pub struct ActiveMemosCloudResponse {
    /// The memos this terminal should display.
    pub memos: Vec<ActiveMemoCloud>,
    /// Server-issued poll cadence.
    pub cadence: MemoCadenceCloud,
}

/// Fetch the memos a terminal should display from the cloud
/// (`GET /api/v1/memos/active?terminal_id=…`, async). The bearer token
/// scopes the read to the token's tenant; a terminal-scoped token may
/// only read its own terminal (server-enforced).
#[cfg(feature = "sync-http")]
pub async fn fetch_active_memos_from_server(
    config: &SyncConfig,
    terminal_id: &str,
) -> Result<ActiveMemosCloudResponse, SyncHttpError> {
    let url = format!(
        "{}/api/v1/memos/active",
        config.server_url.trim_end_matches('/')
    );

    let mut request = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| SyncHttpError::Client(e.to_string()))?
        .get(&url)
        .query(&[("terminal_id", terminal_id)]);

    if let Some(ref key) = config.api_key {
        request = request.header("Authorization", &format!("Bearer {key}"));
    }

    let resp = request
        .send()
        .await
        .map_err(|e| SyncHttpError::Network(e.to_string()))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(classify_http_status(status.as_u16(), &body));
    }

    resp.json::<ActiveMemosCloudResponse>()
        .await
        .map_err(|e| SyncHttpError::Parse(e.to_string()))
}

/// Stub used when `sync-http` feature is disabled — always fails so the
/// caller's local-read fallback applies (a read has no honest success
/// stub, unlike the push path's pretend-accepted).
#[cfg(not(feature = "sync-http"))]
pub async fn fetch_active_memos_from_server(
    config: &SyncConfig,
    _terminal_id: &str,
) -> Result<ActiveMemosCloudResponse, SyncHttpError> {
    Err(SyncHttpError::Client(
        "sync-http feature is disabled".into(),
    ))
}

// ── QRIS Auto (dynamic Midtrans charge via the cloud) ───────────────

/// Result of a dynamic QRIS charge (`POST /api/payment/midtrans/qris`).
/// Mirrors the cloud's `ChargeResponse` verbatim — note `status` is
/// `qr_issued`: the QR exists, nobody has paid yet (PAY-6 two-phase
/// contract; the settlement signal arrives via `qris_status_from_server`).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct QrisChargeResult {
    /// Midtrans order id — the cloud ledger key and the status-poll handle.
    pub order_id: String,
    /// The QR payload to render. Omitted (null) on channels that return a
    /// hosted payment page URL instead of an inline string.
    pub qr_string: Option<String>,
    /// `qr_issued` at issuance time.
    pub status: String,
    /// Echo of the requested amount, minor units (IDR exponent 0).
    pub amount_minor: i64,
    /// Echo of the currency (`IDR`).
    pub currency: String,
    /// Echo of the local sale this issuance is bound to.
    pub sale_id: String,
    /// QR validity window in seconds — the UI countdown's single source.
    pub expires_in_secs: u32,
}

/// Result of a settlement poll (`GET /api/payment/midtrans/{order_id}/status`).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct QrisStatusResult {
    /// Echo of the queried order id.
    pub order_id: String,
    /// Verbatim cloud ledger status (`issued`, `pending`, `settlement`,
    /// `capture`, `expire`, `cancel`, `amount_mismatch`, ...).
    pub status: String,
    /// True iff the ledger recorded `settlement`/`capture` — the poll exit.
    pub settled: bool,
}

/// Wire body for the charge request. Private: the caller passes the parts.
#[cfg(feature = "sync-http")]
#[derive(Debug, serde::Serialize)]
struct QrisChargeBody {
    sale_id: String,
    amount_minor: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    idempotency_key: Option<String>,
}

/// Issue a dynamic QRIS charge through the cloud (async). The bearer token
/// is the stored sync API key — the same credential the push and pull paths
/// use, and the ONLY tenant authority: the cloud attributes the ledger row
/// to the token's tenant, never to anything in the body. An idempotency key
/// that has already been charged returns the SAME live QR (PAY-2), so a
/// retry after a dropped response is safe.
#[cfg(feature = "sync-http")]
pub async fn qris_charge_on_server(
    config: &SyncConfig,
    sale_id: &str,
    amount_minor: i64,
    idempotency_key: Option<&str>,
) -> Result<QrisChargeResult, SyncHttpError> {
    let url = format!(
        "{}/api/payment/midtrans/qris",
        config.server_url.trim_end_matches('/')
    );

    let mut request = reqwest::Client::builder()
        // The cloud waits on Midtrans inside this request; the gateway's
        // own budget is smaller than 30 s, so this ceiling only fires on
        // genuinely stuck connections. Same client ceiling as the memo read.
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| SyncHttpError::Client(e.to_string()))?
        .post(&url)
        .json(&QrisChargeBody {
            sale_id: sale_id.to_owned(),
            amount_minor,
            idempotency_key: idempotency_key.map(str::to_owned),
        });

    if let Some(ref key) = config.api_key {
        request = request.header("Authorization", &format!("Bearer {key}"));
    }

    let resp = request
        .send()
        .await
        .map_err(|e| SyncHttpError::Network(e.to_string()))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(classify_http_status(status.as_u16(), &body));
    }

    resp.json::<QrisChargeResult>()
        .await
        .map_err(|e| SyncHttpError::Parse(e.to_string()))
}

/// Stub when `sync-http` is off — QRIS Auto is definitionally a cloud
/// feature, so there is no honest local success to fake.
#[cfg(not(feature = "sync-http"))]
pub async fn qris_charge_on_server(
    _config: &SyncConfig,
    _sale_id: &str,
    _amount_minor: i64,
    _idempotency_key: Option<&str>,
) -> Result<QrisChargeResult, SyncHttpError> {
    Err(SyncHttpError::Client(
        "sync-http feature is disabled".into(),
    ))
}

/// Poll one QRIS charge's settlement status from the cloud (async). A 404
/// surfaces as `SyncHttpError::Server { status: 404, .. }` — the cloud
/// answers the same 404 for unknown orders and other tenants' orders
/// (uniform miss), so callers must treat 404 as "not visible to us", never
/// as an authorization bug to refresh around.
#[cfg(feature = "sync-http")]
pub async fn qris_status_from_server(
    config: &SyncConfig,
    order_id: &str,
) -> Result<QrisStatusResult, SyncHttpError> {
    let url = format!(
        "{}/api/payment/midtrans/{}/status",
        config.server_url.trim_end_matches('/'),
        order_id
    );

    let mut request = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| SyncHttpError::Client(e.to_string()))?
        .get(&url);

    if let Some(ref key) = config.api_key {
        request = request.header("Authorization", &format!("Bearer {key}"));
    }

    let resp = request
        .send()
        .await
        .map_err(|e| SyncHttpError::Network(e.to_string()))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(classify_http_status(status.as_u16(), &body));
    }

    resp.json::<QrisStatusResult>()
        .await
        .map_err(|e| SyncHttpError::Parse(e.to_string()))
}

/// Stub used when `sync-http` feature is disabled.
#[cfg(not(feature = "sync-http"))]
pub async fn qris_status_from_server(
    _config: &SyncConfig,
    _order_id: &str,
) -> Result<QrisStatusResult, SyncHttpError> {
    Err(SyncHttpError::Client(
        "sync-http feature is disabled".into(),
    ))
}

#[cfg(test)]
#[path = "sync_client_tests.rs"]
mod tests;
