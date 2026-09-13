//! Sync Transport — async HTTP client for communicating with the remote
//! sync server.
/*
last audited 25-07-26 by RSA-Agent (platform-sync slice D: transport deep read)
crate: platform-sync | status: SAFE | lint: CLEAN
findings: exemplary — RUST-05 fail-closed client construction (bearer header + 30s timeout; convenience new() expect is a documented impossible-invariant wrapper, production paths use try_new); classify_transport_error gives actionable diagnostics; 401 bodies classified per P1/P4 (token_expired refresh-once vs invalid_token config problem); 403 plan_required terminal; ADR #11 server_migrated JSON redirect parsing (strict field checks, tested); 410 Gone maps to AnchorExpired with oldest_available; body read once; no_proxy; separate 5s health-check timeout prevents daemon stalls; test pins the snapshot user wire format against all profile fields (ADR #35 D6 residency)
next: none | perf: gzip on
*/
//!
//! The transport layer handles:
//!
//! - **Push** — sending pending offline queue items to the server
//! - **Pull** — fetching updates from the server since the last sync
//!
//! # Wire format
//!
//! All requests/responses use JSON. The server exposes two endpoints:
//!
//! - `POST /api/sync/push` — receives an array of queue items
//! - `POST /api/sync/pull` — receives a `since` timestamp, returns updates

use oz_core::offline::OfflineQueueItem;
use serde::{Deserialize, Serialize};

use crate::SyncError;

/// Outcome of pushing a single item to the server.
///
/// Single definition lives in [`oz_core::sync_client::PushOutcome`]; this
/// re-export keeps the `platform_sync::transport::PushOutcome` import path
/// compiling for cloud-server and in-crate callers.
pub use oz_core::sync_client::PushOutcome;

/// Response from the push endpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PushResponse {
    /// Per-item outcomes in the same order as the push request.
    pub results: Vec<PushOutcome>,
}

/// Request body for the pull endpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PullRequest {
    /// ISO-8601 timestamp of the last successful sync. `None` for initial sync.
    pub since: Option<String>,
    /// Opaque cursor for paginated pulls (P-3). `None` for first page.
    #[serde(default)]
    pub cursor: Option<String>,
}

/// Response from the pull endpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PullResponse {
    /// Items that have changed on the server since the given timestamp.
    pub items: Vec<OfflineQueueItem>,
    /// Opaque cursor for the next page (P-3). `None` when no more pages.
    #[serde(default)]
    pub next_cursor: Option<String>,
}

/// Snapshot schema version understood by this client.
///
/// Snapshots claiming a newer version are rejected (RUST-04 fail-closed).
pub const SNAPSHOT_SCHEMA_VERSION: u32 = 1;

/// Legacy servers omit the version field — treat them as schema v1.
fn default_snapshot_version() -> u32 {
    SNAPSHOT_SCHEMA_VERSION
}

/// A product row in a server snapshot (typed, RUST-04).
///
/// Required fields (id, sku, name, price_minor, currency) fail
/// deserialization when missing, so malformed reference data is rejected
/// at the transport boundary instead of imported with defaults.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotProduct {
    /// Server-side row id.
    pub id: String,
    /// Unique product SKU.
    pub sku: String,
    /// Display name.
    pub name: String,
    /// Price in minor currency units.
    pub price_minor: i64,
    /// ISO-4217 currency code.
    pub currency: String,
    /// Optional category foreign key.
    #[serde(default)]
    pub category_id: Option<String>,
    /// Optional barcode.
    #[serde(default)]
    pub barcode: Option<String>,
    /// ISO-8601 creation timestamp; `None` lets the DB default fill it.
    #[serde(default)]
    pub created_at: Option<String>,
    /// ISO-8601 last-update timestamp; defaults to `now()` on insert.
    #[serde(default)]
    pub updated_at: Option<String>,
    /// ISO-8601 last price-change timestamp; defaults to `now()`.
    #[serde(default)]
    pub price_updated_at: Option<String>,
    /// Serial-number tracking flag.
    #[serde(default)]
    pub track_serial: bool,
    /// Store scoping for the soft-scoping layer (migration 069/117).
    ///
    /// `None`/absent means the shared global catalog; `Some(id)` means the
    /// row is visible only to that store. Backward compatible: servers that
    /// omit the field deserialize as `None`, so every imported row lands in
    /// the global catalog exactly as before.
    #[serde(default)]
    pub store_id: Option<String>,
    /// Product brand (free text, synced — ADR #36 D2).
    #[serde(default)]
    pub brand: Option<String>,
    /// Rack position code (synced).
    #[serde(default)]
    pub rack_location: Option<String>,
    /// Free-text notes (synced).
    #[serde(default)]
    pub notes: Option<String>,
    /// Unit of measure (synced).
    #[serde(default)]
    pub unit: Option<String>,
    /// Active/sellable status (synced so retirement propagates).
    /// `cost_minor`, `default_supplier_id`, and `popularity_score` are
    /// deliberately absent — local-only (ADR #36 D2, ADR #37 D4).
    #[serde(default = "default_snapshot_is_active")]
    pub is_active: bool,
}

fn default_snapshot_is_active() -> bool {
    true
}

impl Default for SnapshotProduct {
    fn default() -> Self {
        Self {
            id: String::new(),
            sku: String::new(),
            name: String::new(),
            price_minor: 0,
            currency: String::new(),
            category_id: None,
            barcode: None,
            created_at: None,
            updated_at: None,
            price_updated_at: None,
            track_serial: false,
            store_id: None,
            brand: None,
            rack_location: None,
            notes: None,
            unit: None,
            is_active: true,
        }
    }
}

/// A tax-rate row in a server snapshot (typed, RUST-04).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotTaxRate {
    /// Server-side row id.
    pub id: String,
    /// Tax-rate display name.
    pub name: String,
    /// Rate in basis points (1/10000); must be >= 0.
    pub rate_bps: i64,
    /// Whether this is the store's default tax rate.
    #[serde(default)]
    pub is_default: bool,
    /// Whether tax is included in the displayed price.
    #[serde(default)]
    pub is_inclusive: bool,
    /// ISO-8601 creation timestamp.
    #[serde(default)]
    pub created_at: Option<String>,
    /// ISO-8601 last-update timestamp.
    #[serde(default)]
    pub updated_at: Option<String>,
    /// Scope: the legal entity this rate applies to, or `None` when it is not
    /// entity-scoped. With [`Self::location_id`] this is
    /// one-or-the-other-or-neither — `oz_core::db::tax::TaxRateScope` is the
    /// type that cannot represent both.
    ///
    /// These four fields exist because a scoped rate that travels WITHOUT its
    /// scope lands as NULL, and NULL scope means **tenant-global**: a Jakarta
    /// rate would silently price every branch that pulled it. Absence of the
    /// keys in a payload is therefore read as tenant-global — which is exactly
    /// what every pre-scoping row is — so an older server keeps working and
    /// keeps the same answer.
    #[serde(default)]
    pub legal_entity_id: Option<String>,
    /// Scope: the location this rate applies to, or `None` when it is not
    /// location-scoped.
    #[serde(default)]
    pub location_id: Option<String>,
    /// Validity window start, business date `YYYY-MM-DD`; `None` = no lower
    /// bound. Compared as a DATE, never as text — see
    /// `oz_core::db::tax::parse_effective_date`.
    #[serde(default)]
    pub effective_from: Option<String>,
    /// Validity window end, business date `YYYY-MM-DD`, EXCLUSIVE; `None` =
    /// does not expire.
    #[serde(default)]
    pub effective_to: Option<String>,
    /// E1 statutory rounding directive stored on the rate (`''` = no
    /// directive, the store preference applies; else a `RoundingMode` serde
    /// snake_case name, the alphabet the 20260929 schema CHECK enforces).
    /// D64 binding condition (a): the mode must travel or a hub-authored
    /// directive lands `''` at the branch silently. Same back-compat ruling
    /// as the scope fields: payloads written before 20260929 carry no key,
    /// and absence IS the empty sentinel — every pre-E1 row.
    #[serde(default)]
    pub rounding_mode: String,
}

/// A user row in a server snapshot (typed, RUST-04).
///
/// `pin_hash` is deliberately absent — credential verifier material
/// never travels over the sync channel (SYNC-06).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotUser {
    /// Server-side row id.
    pub id: String,
    /// Login username.
    pub username: String,
    /// Display name.
    pub display_name: String,
    /// Role foreign key.
    pub role_id: String,
    /// Whether the user can log in.
    #[serde(default)]
    pub is_active: bool,
    /// ISO-8601 creation timestamp.
    #[serde(default)]
    pub created_at: Option<String>,
    /// ISO-8601 last-update timestamp.
    #[serde(default)]
    pub updated_at: Option<String>,
}

/// Response from the snapshot endpoint (P-3 Steps 3-5).
///
/// Contains the server's authoritative reference data for a tenant.
/// The client imports this wholesale when its sync anchor has expired
/// (data pruned server-side). All rows are typed (RUST-04) so malformed
/// reference data fails at the boundary rather than importing defaults.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncSnapshotResponse {
    /// Snapshot schema version. Missing defaults to 1 (legacy servers).
    #[serde(default = "default_snapshot_version")]
    pub version: u32,
    /// Product rows keyed by SKU.
    pub products: Vec<SnapshotProduct>,
    /// Tax-rate rows keyed by ID.
    pub tax_rates: Vec<SnapshotTaxRate>,
    /// User rows keyed by username.
    pub users: Vec<SnapshotUser>,
}

/// Classifies a `reqwest::Error` into a human-readable transport error message
/// that distinguishes between connection failures, timeouts, DNS errors, etc.
///
/// This produces actionable diagnostics instead of the raw `reqwest` error string,
/// helping operators understand *why* a sync failed (server down vs network issue).
/// `timeout_secs` is the deadline the caller's client was actually configured
/// with, so the timeout branch reports the time that really applied (30s for
/// sync requests, 5s for health probes) rather than a hardcoded guess.
fn classify_transport_error(e: &reqwest::Error, url: &str, timeout_secs: u64) -> String {
    if e.is_timeout() {
        format!("request timed out after {timeout_secs}s to {url}")
    } else if e.is_connect() {
        let msg = e.to_string().to_lowercase();
        if msg.contains("connection refused") {
            format!("cloud server not running at {url} (connection refused)")
        } else {
            format!("cannot connect to {url}: {e}")
        }
    } else if e.is_request() {
        format!("request failed: {e}")
    } else {
        format!("transport error: {e}")
    }
}

/// The HTTP sync transport.
pub struct SyncTransport {
    client: reqwest::Client,
    base_url: String,
    /// Sender identity + logical counter for conflict detection. `None`
    /// disables stamping, which is the historical behaviour — the server then
    /// treats every item as coming from a peer that predates vector support
    /// and skips detection for it.
    stamp: Option<VectorStamp>,
}

/// State needed to stamp outgoing payloads with causality metadata.
struct VectorStamp {
    terminal_id: String,
    /// Monotonic per push. Seeded from the persisted clock so a restart does
    /// not rewind it: a rewound counter would make the server classify every
    /// push as stale and detection would silently stop working.
    counter: std::sync::atomic::AtomicU64,
}

impl SyncTransport {
    /// Create a new transport targeting the given server URL.
    ///
    /// RUST-05: fails **closed**. If the HTTP client cannot be built with
    /// the configured bearer token and 30-second timeout, returns an error
    /// instead of silently falling back to an unauthenticated,
    /// timeout-less `reqwest::Client`. Production callers (e.g. the sync
    /// daemon) use this and degrade the cycle gracefully.
    pub fn try_new(server_url: &str, api_key: Option<&str>) -> Result<Self, SyncError> {
        let mut headers = reqwest::header::HeaderMap::new();
        if let Some(key) = api_key
            && let Ok(val) = reqwest::header::HeaderValue::from_str(&format!("Bearer {key}"))
        {
            headers.insert(reqwest::header::AUTHORIZATION, val);
        }
        let client = reqwest::Client::builder()
            .no_proxy()
            .gzip(true)
            .default_headers(headers)
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| {
                SyncError::Transport(format!(
                    "failed to build sync HTTP client with configured auth/timeout: {e}"
                ))
            })?;

        Ok(Self {
            client,
            base_url: server_url.trim_end_matches('/').to_owned(),
            stamp: None,
        })
    }

    /// Highest counter stamped so far, or `None` when stamping is disabled.
    ///
    /// The caller must persist this after a successful push. If it does not,
    /// the next process starts from the old value, the server sees a counter
    /// it has already passed, classifies every push as stale, and detection
    /// silently stops for this terminal.
    pub fn last_stamped_counter(&self) -> Option<u64> {
        self.stamp
            .as_ref()
            .map(|s| s.counter.load(std::sync::atomic::Ordering::Relaxed))
    }

    /// Enable conflict-detection stamping on outgoing pushes.
    ///
    /// `initial_counter` must come from the persisted clock, not from zero:
    /// the server compares counters per terminal, so a counter that rewinds on
    /// restart makes every subsequent push look older than what is already
    /// stored — it would be classified `Stale` and detection would quietly
    /// stop for this terminal.
    pub fn with_vector_stamping(mut self, terminal_id: &str, initial_counter: u64) -> Self {
        self.stamp = Some(VectorStamp {
            terminal_id: terminal_id.to_string(),
            counter: std::sync::atomic::AtomicU64::new(initial_counter),
        });
        self
    }

    /// Convenience constructor for tests and [`crate::SyncEngine::new`].
    ///
    /// Delegates to [`SyncTransport::try_new`] and panics only when the
    /// client cannot be built — a documented impossible invariant (the
    /// builder is called with a valid header value and fixed options).
    /// Production paths call [`SyncTransport::try_new`] and degrade the
    /// cycle gracefully instead of panicking.
    pub fn new(server_url: &str, api_key: Option<&str>) -> Self {
        // SAFETY: documented convenience wrapper over `try_new` — panics only when
        // the client cannot be built with valid config, an impossible invariant (RUST-05).
        Self::try_new(server_url, api_key).expect(
            "sync transport client construction must succeed with valid config (RUST-05 invariant)",
        )
    }

    /// Push pending items to the server.
    ///
    /// Returns a vector of outcomes, one per item in the same order.
    pub async fn push_items(
        &self,
        items: &[OfflineQueueItem],
    ) -> Result<Vec<PushOutcome>, SyncError> {
        let url = format!("{}/api/sync/push", self.base_url);

        // Stamp only when enabled, and once per item: the counter advances per
        // item so two items in one batch do not carry the same logical instant.
        let stamped = match &self.stamp {
            Some(stamp) => {
                let mut out = Vec::with_capacity(items.len());
                for item in items {
                    let counter = stamp
                        .counter
                        .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
                        .saturating_add(1);
                    let mut copy = item.clone();
                    copy.payload =
                        crate::crdt::stamp_payload(&item.payload, &stamp.terminal_id, counter);
                    out.push(copy);
                }
                Some(out)
            }
            None => None,
        };
        let body = stamped.as_deref().unwrap_or(items);

        let resp = self
            .client
            .post(&url)
            .json(body)
            .send()
            .await
            .map_err(|e| SyncError::Transport(classify_transport_error(&e, &url, 30)))?;

        if !resp.status().is_success() {
            // Read the body once; 401/403 classification, the migration
            // redirect, and the generic Transport error all need it, and
            // `text()` consumes the response.
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            // ADR sync-auth-hardening P1/P4: a 401 with `token_expired` means
            // stale auth — the caller refreshes and retries once; a genuinely
            // invalid token is a config problem that must not be masked.
            if status == reqwest::StatusCode::UNAUTHORIZED {
                return Err(classify_auth_401(&body));
            }
            // ADR sync-plan-gating: a 403 plan_required is terminal — no
            // refresh, no retry, no quarantine.
            if status == reqwest::StatusCode::FORBIDDEN && body.contains("plan_required") {
                return Err(SyncError::PlanRequired);
            }

            // ADR #11: Detect server migration redirect.
            if let Some(new_url) = parse_server_migrated(&body) {
                return Err(SyncError::ServerMigrated { new_url });
            }

            return Err(SyncError::Transport(format!(
                "push returned {status}: {body}"
            )));
        }

        let push_resp: PushResponse = resp
            .json()
            .await
            .map_err(|e| SyncError::Transport(format!("push response parse failed: {e}")))?;

        Ok(push_resp.results)
    }

    /// Pull updates from the server since the given timestamp.
    ///
    /// Pass `None` for `since` to pull all available data (initial sync).
    /// Pass `cursor` for paginated subsequent pages (P-3).
    pub async fn pull_updates(
        &self,
        since: Option<&str>,
        cursor: Option<&str>,
    ) -> Result<PullResponse, SyncError> {
        let url = format!("{}/api/sync/pull", self.base_url);
        let request = PullRequest {
            since: since.map(|s| s.to_owned()),
            cursor: cursor.map(|c| c.to_owned()),
        };

        let resp = self
            .client
            .post(&url)
            .json(&request)
            .send()
            .await
            .map_err(|e| SyncError::Transport(classify_transport_error(&e, &url, 30)))?;

        // P-1 retention: 410 Gone means the client's anchor has expired
        // (data older than the `since` timestamp has been pruned).
        if resp.status() == reqwest::StatusCode::GONE {
            let body: serde_json::Value = resp.json().await.unwrap_or_default();
            let oldest_available = body
                .get("oldest_available")
                .and_then(|v| v.as_str())
                .map(|s| s.to_owned());
            return Err(SyncError::AnchorExpired { oldest_available });
        }

        if !resp.status().is_success() {
            // Read the body once; 401/403 classification, the migration
            // redirect, and the generic Transport error all need it.
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            // ADR sync-auth-hardening P1/P4: same stale-auth contract as push.
            if status == reqwest::StatusCode::UNAUTHORIZED {
                return Err(classify_auth_401(&body));
            }
            // ADR sync-plan-gating: a 403 plan_required is terminal.
            if status == reqwest::StatusCode::FORBIDDEN && body.contains("plan_required") {
                return Err(SyncError::PlanRequired);
            }

            // ADR #11: Detect server migration redirect.
            if let Some(new_url) = parse_server_migrated(&body) {
                return Err(SyncError::ServerMigrated { new_url });
            }

            return Err(SyncError::Transport(format!(
                "pull returned {status}: {body}"
            )));
        }

        let pull_resp: PullResponse = resp
            .json()
            .await
            .map_err(|e| SyncError::Transport(format!("pull response parse failed: {e}")))?;

        Ok(pull_resp)
    }

    /// Check whether the cloud server is reachable by calling `GET /api/health`.
    ///
    /// Returns `Ok(())` when the server responds with a 2xx status.
    /// Returns `Err` with a classified transport error otherwise.
    ///
    /// Uses a short 5-second timeout (separate from the 30-second sync timeout)
    /// so that health checks don't block the daemon when the server is down.
    pub async fn health_check(&self) -> Result<(), SyncError> {
        let url = format!("{}/api/health", self.base_url);
        // Use a short-lived client with a 5-second timeout for health checks.
        // This prevents the daemon from stalling for 30 seconds on every cycle
        // when the server is unreachable.
        let health_client = reqwest::Client::builder()
            .no_proxy()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .map_err(|e| {
                SyncError::Transport(format!(
                    "failed to build health-check client with 5s timeout: {e}"
                ))
            })?;
        let resp = health_client
            .get(&url)
            .send()
            .await
            .map_err(|e| SyncError::Transport(classify_transport_error(&e, &url, 5)))?;

        if resp.status().is_success() {
            Ok(())
        } else {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            Err(SyncError::Transport(format!(
                "health check returned {status}: {body}"
            )))
        }
    }

    /// Fetch the server's authoritative snapshot of reference data (P-3).
    ///
    /// Called when the client's sync anchor has expired — the server's
    /// delta log has been pruned beyond the client's last sync point.
    /// The snapshot provides a fresh baseline from which delta pulls resume.
    pub async fn fetch_snapshot(&self) -> Result<SyncSnapshotResponse, SyncError> {
        let url = format!("{}/api/sync/snapshot", self.base_url);
        let resp = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| SyncError::Transport(classify_transport_error(&e, &url, 30)))?;

        if !resp.status().is_success() {
            // Read the body once; 401/403 classification, the migration
            // redirect, and the generic Transport error all need it.
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            // ADR sync-auth-hardening P1/P4: same stale-auth contract as push.
            if status == reqwest::StatusCode::UNAUTHORIZED {
                return Err(classify_auth_401(&body));
            }
            // ADR sync-plan-gating: a 403 plan_required is terminal.
            if status == reqwest::StatusCode::FORBIDDEN && body.contains("plan_required") {
                return Err(SyncError::PlanRequired);
            }

            // ADR #11: Detect server migration redirect.
            if let Some(new_url) = parse_server_migrated(&body) {
                return Err(SyncError::ServerMigrated { new_url });
            }

            return Err(SyncError::Transport(format!(
                "snapshot returned {status}: {body}"
            )));
        }

        let snapshot: SyncSnapshotResponse = resp
            .json()
            .await
            .map_err(|e| SyncError::Transport(format!("snapshot parse failed: {e}")))?;

        Ok(snapshot)
    }
}

/// Classify a 401 response body (ADR sync-auth-hardening P4): explicit
/// `token_expired` (or a bare 401 from an older server) maps to
/// [`SyncError::AuthExpired`]; explicit `invalid_token` / `missing_token`
/// maps to [`SyncError::AuthInvalid`].
fn classify_auth_401(body: &str) -> SyncError {
    if body.contains("token_expired") {
        SyncError::AuthExpired
    } else if body.contains("invalid_token") || body.contains("missing_token") {
        SyncError::AuthInvalid
    } else {
        SyncError::AuthExpired
    }
}

/// Parse a `server_migrated` redirect from a JSON response body (ADR #11).
///
/// Returns `Some(new_url)` if the body contains `{"error":"server_migrated","new_url":"..."}`,
/// or `None` otherwise.
fn parse_server_migrated(body: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(body).ok()?;
    if v.get("error")?.as_str()? == "server_migrated" {
        v.get("new_url")?.as_str().map(|s| s.to_owned())
    } else {
        None
    }
}

#[cfg(test)]
#[path = "transport_tests.rs"]
mod tests;
