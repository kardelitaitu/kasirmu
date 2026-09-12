/*
last audited 25-07-26 by RSA-Agent (cloud-server slice B: sync_api deep read)
crate: cloud-server | status: SAFE | lint: CLEAN
findings: CS-3 FIXED — the SQLite arm of sync_store push_batch now wraps the batch in one unchecked_transaction (commit at the end; UNIQUE failures stay statement-level so per-item outcomes are unchanged) SQLite arm of sync_store push_batch loops per-item in autocommit (no BEGIN/COMMIT), so a mid-batch failure persists partial items; proposed: unchecked_transaction around the loop to match the documented contract. Otherwise exemplary: tenant_id always from JWT claims (never request body, spoofing prevention documented), plan middleware fail-closed, per-tenant rate limiting, TTL caches for snapshot and tenant count with documented staleness rationale, index-order-preserving outcome reassembly, optional UUID-validation skip documented as a measured perf lever
next: none | perf: batch transaction also fixes per-item autocommit latency
*/
//! Sync API — server-side handlers for the offline-sync push/pull protocol.
//!
//! These endpoints mirror the client-side [`platform_sync::transport`] types:
//!
//! - `POST /api/sync/push` — receives items, persists with existing IDs, returns outcomes
//! - `POST /api/sync/pull` — receives a `PullRequest` with `since` timestamp, returns `PullResponse`
//! - `GET  /api/sync/status` — returns server status and pending queue count

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{Extension, Path, Query, Request, State},
    http::StatusCode,
    middleware,
    response::IntoResponse,
    routing::{get, post},
};
use rusqlite::Connection;
use serde::Deserialize;
use sha2::Digest;
use tokio::sync::Mutex;

use oz_api::auth::{ApiTokenClaims, auth_middleware};
use platform_sync::transport::{PullRequest, PullResponse, PushOutcome, PushResponse};

use crate::metrics;
use crate::rate_limit::{RateLimiterState, rate_limit_middleware};

/// Snapshot cache entry: generation timestamp, reference-data version
/// stamp, and the serialised JSON bytes.
///
/// `version` lets the handler revalidate a TTL-expired entry cheaply:
/// when `SyncStore::snapshot_version` still matches, the cached bytes are
/// served and the timestamp refreshed instead of re-serialising the full
/// 3-table snapshot (products + tax_rates + users) on every cache miss.
#[derive(Clone)]
pub struct SnapshotData {
    /// When the entry was generated (or last version-revalidated).
    pub generated_at: std::time::Instant,
    /// Reference-data version stamp (counts + MAX(updated_at) per table).
    pub version: String,
    /// Serialised JSON snapshot bytes, served verbatim.
    pub bytes: Vec<u8>,
}

/// Per-tenant snapshot cache map.
///
/// Each tenant's entry is an `Arc<RwLock<Option<SnapshotData>>>` so a cold
/// cache miss is **single-flight**: the first request to miss acquires the
/// write lock and recomputes; every concurrent request for the same tenant
/// blocks on that lock, re-checks, and serves the freshly-written bytes
/// instead of stampeding the database (one 3-table snapshot per burst,
/// not N).
type SnapshotCache =
    Arc<Mutex<std::collections::HashMap<String, Arc<tokio::sync::RwLock<Option<SnapshotData>>>>>>;

/// Cached global tenant count (status endpoint).
///
/// `distinct_tenant_count()` is a `COUNT(DISTINCT tenant_id)` over the
/// whole `offline_queue` — O(n) on a table bounded only by the 90-day
/// retention horizon. Every terminal polls `/api/sync/status` on its
/// heartbeat, so an uncached scan would repeat constantly on the hot
/// path. The count only feeds the tiered-heartbeat calculation, so a
/// bounded-stale value is fine: refresh at most once per
/// [`TENANT_COUNT_CACHE_TTL`](Self::TENANT_COUNT_CACHE_TTL) and serve
/// the cached value in between.
#[derive(Clone, Default)]
pub struct TenantCountCache(Arc<Mutex<Option<(std::time::Instant, i64)>>>);

impl TenantCountCache {
    /// How long a cached tenant count is trusted before the next refresh.
    const TENANT_COUNT_CACHE_TTL: std::time::Duration = std::time::Duration::from_secs(60);

    /// Return the cached count, or `None` when no refresh has run yet.
    async fn cached(&self) -> Option<i64> {
        let guard = self.0.lock().await;
        guard
            .as_ref()
            .filter(|(at, _)| at.elapsed() < Self::TENANT_COUNT_CACHE_TTL)
            .map(|(_, count)| *count)
    }

    /// Store a freshly-computed count.
    async fn store(&self, count: i64) {
        let mut guard = self.0.lock().await;
        *guard = Some((std::time::Instant::now(), count));
    }
}

/// Shared state for sync handlers — a database connection behind `Arc<Mutex<>>`.
#[derive(Clone)]
pub struct SyncState {
    pub db: Arc<Mutex<Connection>>,
    /// Postgres pool for the sync data layer (Phase 1.2). `None` keeps the
    /// SQLite backend; `Some` routes push/pull/status/snapshot/plan through
    /// Postgres while the REST API continues to use the SQLite connection.
    pub pg: Option<deadpool_postgres::Pool>,
    /// Snapshot cache: keyed by tenant_id, stores (generated_at, JSON bytes).
    /// P-3 Step 4: in-memory cache with 15-minute TTL.
    pub snapshot_cache: SnapshotCache,
    /// P8-1: Per-tenant rate limiter for sync endpoints.
    pub rate_limiter: RateLimiterState,
    /// Skip UUID validation on push items. When true, items are inserted
    /// without parsing the id as UUID — saves ~0.02 core CPU at 200+ terminals.
    /// Set via OZ_SKIP_PUSH_VALIDATION=1.
    pub skip_push_validation: bool,
    /// TTL-cached global tenant count for the status endpoint.
    pub tenant_count_cache: TenantCountCache,
}

impl SyncState {
    /// Create a new SyncState from a CloudServerState and an existing RateLimiterState.
    /// This ensures the rate limiter instance is shared with the cleanup task.
    pub fn from_with_rate_limiter(
        state: super::CloudServerState,
        rate_limiter: RateLimiterState,
    ) -> Self {
        Self {
            db: state.db,
            pg: None,
            snapshot_cache: Arc::new(Mutex::new(std::collections::HashMap::new())),
            rate_limiter,
            skip_push_validation: std::env::var("OZ_SKIP_PUSH_VALIDATION")
                .map(|v| v == "1" || v == "true")
                .unwrap_or(false),
            tenant_count_cache: TenantCountCache::default(),
        }
    }

    /// Build the sync data backend for this state (Phase 1.2).
    ///
    /// Cheap to call: it clones the already-shared SQLite `Arc` or Postgres
    /// pool, so handlers can obtain a backend without holding state locks.
    fn store(&self) -> crate::sync_store::SyncStore {
        match &self.pg {
            Some(pool) => crate::sync_store::SyncStore::postgres(pool.clone()),
            None => crate::sync_store::SyncStore::sqlite(self.db.clone()),
        }
    }

    /// Global tenant count for the status endpoint, served from a
    /// TTL-bounded cache to avoid a `COUNT(DISTINCT tenant_id)` full scan
    /// on every heartbeat poll (SOTA: the count only feeds tiered
    /// heartbeat sizing, so up to 60s of staleness is harmless).
    async fn cached_tenant_count(&self) -> i64 {
        if let Some(count) = self.tenant_count_cache.cached().await {
            return count;
        }
        let count = self.store().distinct_tenant_count().await;
        self.tenant_count_cache.store(count).await;
        count
    }
}

impl From<super::CloudServerState> for SyncState {
    fn from(state: super::CloudServerState) -> Self {
        Self::from_with_rate_limiter(state, RateLimiterState::new())
    }
}

/// Build the sync router with all four endpoints, protected by JWT auth,
/// per-tenant rate limiting (P8-1), and optional plan enforcement
/// (ADR sync-plan-gating).
///
/// Middleware order (axum: first `.layer()` = outermost, runs FIRST):
///
///   `.layer(axum::Extension(rate_limiter.clone()))` — makes RateLimiterState available
///   `.layer(axum::Extension(store))`                  — makes the SyncStore available to plan_middleware
///   `.layer(axum::Extension(enforce_plans))`          — plan gate on/off
///   `.layer(middleware::from_fn(auth_middleware))`        ← outermost (injects ApiTokenClaims)
///   `.layer(middleware::from_fn(plan_middleware))`        ← reads claims, gates free tenants
///   `.layer(middleware::from_fn(rate_limit_middleware))`  ← innermost (reads claims)
///
/// Execution order: auth_middleware → plan_middleware → rate_limit_middleware → handler
/// Axum layers are applied from outside to inside, so the LAST .layer() is the
/// innermost (closest to the handler).
pub fn sync_router(state: SyncState, enforce_plans: bool) -> Router {
    sync_router_with_plan_enforcement(state, enforce_plans)
}

/// Build the sync router with an explicit plan-enforcement flag (used by
/// tests and by [`sync_router`], which reads `OZ_ENFORCE_PLANS`).
pub fn sync_router_with_plan_enforcement(state: SyncState, enforce_plans: bool) -> Router {
    let rate_limiter = state.rate_limiter.clone();
    let store = state.store();
    Router::new()
        .route("/api/sync/push", post(push_handler))
        .route("/api/sync/pull", post(pull_handler))
        .route("/api/sync/status", get(status_handler))
        .route("/api/sync/snapshot", get(snapshot_handler))
        .route("/api/sync/conflicts", get(list_conflicts_handler))
        .route(
            "/api/sync/conflicts/:id/resolve",
            post(resolve_conflict_handler),
        )
        .with_state(state)
        .layer(middleware::from_fn(rate_limit_middleware))
        .layer(middleware::from_fn(plan_middleware))
        .layer(middleware::from_fn(auth_middleware))
        .layer(axum::Extension(rate_limiter))
        .layer(axum::Extension(store))
        .layer(axum::Extension(enforce_plans))
}

/// Plan gate (ADR sync-plan-gating): when enforcement is enabled, a tenant
/// on the `free` plan (or with no assigned plan — fail closed) is rejected
/// with a structured 403 `{"error":"plan_required"}`. Runs after auth so
/// claims are available, before the handler.
#[allow(clippy::result_large_err)]
pub async fn plan_middleware(
    Extension(enforce_plans): Extension<bool>,
    Extension(store): Extension<crate::sync_store::SyncStore>,
    request: Request,
    next: middleware::Next,
) -> Result<axum::response::Response, axum::response::Response> {
    use axum::response::IntoResponse;
    use oz_core::TenantPlan;

    if !enforce_plans {
        return Ok(next.run(request).await);
    }

    let tenant_id = request
        .extensions()
        .get::<oz_api::auth::ApiTokenClaims>()
        .and_then(|claims| claims.tenant_id.as_deref())
        .unwrap_or("default");

    let plan = store.get_tenant_plan(tenant_id).await.map_err(|_| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(serde_json::json!({ "error": "internal" })),
        )
            .into_response()
    })?;

    if plan.unwrap_or(TenantPlan::Free) == TenantPlan::Free {
        return Err((
            axum::http::StatusCode::FORBIDDEN,
            axum::Json(serde_json::json!({ "error": "plan_required" })),
        )
            .into_response());
    }

    Ok(next.run(request).await)
}

/// `POST /api/sync/push` — receive and persist offline queue items.
///
/// Each item is inserted with its existing client-generated ID. Duplicate
/// IDs (UNIQUE constraint violation) are reported as `Rejected`.
#[tracing::instrument(skip(state, items), fields(tenant_id = claims.tenant_id.as_deref().unwrap_or("default"), item_count = items.len()))]
async fn push_handler(
    State(state): State<SyncState>,
    Extension(claims): Extension<ApiTokenClaims>,
    axum::Json(items): axum::Json<Vec<oz_core::offline::OfflineQueueItem>>,
) -> Result<axum::Json<PushResponse>, (axum::http::StatusCode, String)> {
    let start = std::time::Instant::now();

    // Tenant isolation: use the tenant_id from the JWT claims, not the
    // incoming JSON body, to prevent tenant spoofing.
    let tenant_id = claims.tenant_id.as_deref().unwrap_or("default");

    // Estimate batch size for metrics.
    let batch_bytes = serde_json::to_vec(&items).map(|v| v.len()).unwrap_or(0) as f64;
    metrics::SYNC_BATCH_SIZE_BYTES.observe(batch_bytes);

    // Phase 1.2: INSERT goes through the sync store in a single transaction
    // (previously one transaction per item). `db_start` measures backend
    // access for the whole batch (mutex lock / pool acquisition).
    let store = state.store();
    let db_start = std::time::Instant::now();
    // Phase 1: separate valid items from rejected UUIDs (cheap, no DB).
    // `valid_indexes` records each valid item's ORIGINAL position so the
    // batch outcomes can be reassembled in request order — the client
    // zips `pending` against `results` by index (apply_push_results), so
    // a reordering would mark the WRONG items as synced/failed.
    let mut valid_items: Vec<oz_core::offline::OfflineQueueItem> = Vec::with_capacity(items.len());
    let mut valid_indexes: Vec<usize> = Vec::with_capacity(items.len());
    for (idx, item) in items.iter().enumerate() {
        if !state.skip_push_validation && uuid::Uuid::parse_str(&item.id).is_err() {
            metrics::SYNC_PUSHES_TOTAL
                .with_label_values(&["rejected"])
                .inc();
        } else {
            valid_items.push(item.clone());
            valid_indexes.push(idx);
        }
    }

    // Phase 2: single-transaction batch insert for the valid items.
    let batch_results = if valid_items.is_empty() {
        Vec::new()
    } else {
        store
            .push_batch(&valid_items, tenant_id)
            .await
            .map_err(|e| {
                metrics::SYNC_PUSHES_TOTAL
                    .with_label_values(&["rejected"])
                    .inc();
                (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e)
            })?
    };

    // Outbound webhook fan-out (2026-09-03): accepted event-action
    // items enqueue signed `webhook` outbox entries. Never fails the
    // push — fan-out errors are logged, the items are already durable.
    crate::outbound_webhooks::fanout_from_outcomes(
        &state.db,
        &state.pg,
        tenant_id,
        &valid_items,
        &batch_results,
    )
    .await;

    // Reassemble in request order: invalid ids stay Rejected at their
    // original position; batch outcomes land at the valid items' slots.
    let mut results = Vec::with_capacity(items.len());
    for (idx, item) in items.iter().enumerate() {
        let outcome = match valid_indexes.iter().position(|&v| v == idx) {
            Some(pos) => batch_results.get(pos).cloned().unwrap_or_else(|| {
                // Should be unreachable: every valid index has an outcome.
                PushOutcome::Rejected {
                    reason: format!("missing batch outcome for {}", item.id),
                }
            }),
            None => PushOutcome::Rejected {
                reason: format!("invalid id: {}", item.id),
            },
        };
        let label = match &outcome {
            PushOutcome::Accepted => "accepted",
            PushOutcome::Rejected { reason } if reason.starts_with("duplicate id:") => "conflict",
            PushOutcome::Rejected { .. } => "rejected",
            PushOutcome::Conflict(..) => "conflict",
        };
        metrics::SYNC_PUSHES_TOTAL.with_label_values(&[label]).inc();
        results.push(outcome);
    }

    metrics::DB_CONTENTION_SECONDS
        .with_label_values(&["push"])
        .observe(db_start.elapsed().as_secs_f64());
    metrics::SYNC_PUSH_DURATION_MS.observe(start.elapsed().as_secs_f64() * 1000.0);
    Ok(axum::Json(PushResponse { results }))
}

/// `POST /api/sync/pull` — return items changed since the given timestamp.
///
/// Supports cursor-based pagination (P-3): the client passes an opaque
/// `cursor` from the previous page's `next_cursor` to fetch the next page.
/// Each page returns at most 500 items. When `next_cursor` is null, all
/// pages have been consumed.
#[tracing::instrument(skip(state, req), fields(tenant_id = claims.tenant_id.as_deref().unwrap_or("default"), since = req.since.as_deref().unwrap_or("null")))]
async fn pull_handler(
    State(state): State<SyncState>,
    Extension(claims): Extension<ApiTokenClaims>,
    axum::Json(req): axum::Json<PullRequest>,
) -> Result<axum::Json<PullResponse>, (axum::http::StatusCode, String)> {
    let start = std::time::Instant::now();
    let tenant_id = claims.tenant_id.as_deref().unwrap_or("default");
    // Phase 1.2: anchor check + paginated pull go through the sync store,
    // so the SQLite and Postgres backends share one code path.
    let store = state.store();
    let db_start = std::time::Instant::now();

    // P-1 retention: if the client's anchor (`since`) is older than the
    // oldest retained row, the requested data has been pruned. Skip this
    // check when using a cursor (subsequent pages don't re-check anchor).
    if req.cursor.is_none()
        && let Some(ref since) = req.since
        && let Some(oldest_ts) = store.oldest_created_at(tenant_id).await
        && since.as_str() < oldest_ts.as_str()
    {
        metrics::SYNC_ANCHOR_EXPIRED_TOTAL.inc();
        return Err((
            axum::http::StatusCode::GONE,
            serde_json::json!({
                "error": "anchor_expired",
                "oldest_available": oldest_ts,
            })
            .to_string(),
        ));
    }

    // P-3: decode cursor if present. Format: "created_at|id".
    let (cursor_ts, cursor_id) = if let Some(ref cursor) = req.cursor {
        let parts: Vec<&str> = cursor.splitn(2, '|').collect();
        if parts.len() == 2 {
            (Some(parts[0].to_owned()), Some(parts[1].to_owned()))
        } else {
            (None, None)
        }
    } else {
        (None, None)
    };

    // Build paginated query. Fetch one extra row (501) to detect more pages.
    let limit = 501i64;
    let cursor = match (&cursor_ts, &cursor_id) {
        (Some(ts), Some(cid)) => Some((ts.as_str(), cid.as_str())),
        _ => None,
    };
    let mut items: Vec<oz_core::offline::OfflineQueueItem> = store
        .pull_items(tenant_id, req.since.as_deref(), cursor, limit)
        .await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e))?;
    metrics::DB_CONTENTION_SECONDS
        .with_label_values(&["pull"])
        .observe(db_start.elapsed().as_secs_f64());

    // P-3: Detect if there are more pages (501st row exists).
    // RUST-07: the pagination cursor is derived from the last *kept* row.
    // `get` (not `last().unwrap()`) so an empty slice yields `None` instead
    // of panicking.
    let next_cursor = if items.len() > 500 {
        items.truncate(500);
        items
            .last()
            .map(|last| format!("{}|{}", last.created_at, last.id))
    } else {
        None
    };

    metrics::SYNC_PULL_DURATION_MS.observe(start.elapsed().as_secs_f64() * 1000.0);
    Ok(axum::Json(PullResponse { items, next_cursor }))
}

/// Compute a strong ETag quote-wrapped hex string from bytes.
fn compute_etag(bytes: &[u8]) -> String {
    format!("\"{}\"", hex::encode(sha2::Sha256::digest(bytes)))
}

/// Build a JSON response from pre-serialized bytes with ETag and Cache-Control headers.
///
/// Serves the snapshot cache hit path without a
/// `serde_json::from_slice` → `axum::Json` re-serialize round trip
/// (SOTA finding C). If `If-None-Match` matches the computed ETag, returns
/// `304 Not Modified` with zero body transmission.
fn json_snapshot_response(bytes: Vec<u8>, if_none_match: Option<&str>) -> axum::response::Response {
    let etag = compute_etag(&bytes);
    let mut headers = axum::http::HeaderMap::new();
    if let Ok(val) = axum::http::HeaderValue::from_str(&etag) {
        headers.insert(axum::http::header::ETAG, val);
    }
    headers.insert(
        axum::http::header::CACHE_CONTROL,
        axum::http::HeaderValue::from_static("public, max-age=60"),
    );

    if let Some(inm) = if_none_match {
        let inm_clean = inm.trim();
        if inm_clean == etag || inm_clean == "*" {
            return (axum::http::StatusCode::NOT_MODIFIED, headers).into_response();
        }
    }

    headers.insert(
        axum::http::header::CONTENT_TYPE,
        axum::http::HeaderValue::from_static("application/json"),
    );
    (axum::http::StatusCode::OK, headers, bytes).into_response()
}

/// `GET /api/sync/snapshot` — return reference data baseline for a tenant (P-3).
///
/// Called by clients whose sync anchor has expired. Returns all products,
/// tax rates, and users for the requesting tenant (scoped by `tenant_id`
/// from JWT claims). Responses are cached in-memory per-tenant with a
/// 15-min TTL and include an `ETag`. If `If-None-Match` matches, returns
/// `304 Not Modified` to save bandwidth and CPU.
///
/// Both `POST /api/v1/tax-rates` and `POST /api/v1/users` now stamp
/// `tenant_id` from JWT claims (same pattern as `create_product` in
/// `oz-api/src/routes/products.rs`). New tax rates and users are
/// correctly scoped per-tenant for snapshot isolation.
#[tracing::instrument(skip(state, headers), fields(tenant_id = claims.tenant_id.as_deref().unwrap_or("default")))]
async fn snapshot_handler(
    State(state): State<SyncState>,
    headers: axum::http::HeaderMap,
    Extension(claims): Extension<ApiTokenClaims>,
) -> Result<axum::response::Response, (axum::http::StatusCode, axum::Json<serde_json::Value>)> {
    let start = std::time::Instant::now();
    let tenant_id = claims.tenant_id.as_deref().unwrap_or("default");
    let if_none_match = headers
        .get(axum::http::header::IF_NONE_MATCH)
        .and_then(|v| v.to_str().ok());

    // Helper: build an error JSON response with a non-2xx status (SYNC-09).
    // A failed snapshot must never look like a valid empty snapshot — the
    // client rejects non-success statuses before deserialising the body.
    let error_json = |msg: &str| -> (axum::http::StatusCode, axum::Json<serde_json::Value>) {
        tracing::error!(tenant_id, error = msg, "snapshot: query failed");
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(serde_json::json!({"error": msg})),
        )
    };

    // P-3 Step 4: in-memory per-tenant cache (15-min TTL) with
    // single-flight dedup and version revalidation.
    //
    // Reference data (products, tax rates, users) changes infrequently
    // during a shift, so a long TTL keeps cache hits high. Two SOTA
    // refinements keep that cache cheap without staleness or stampedes:
    //
    // 1. SINGLE-FLIGHT: each tenant's entry is an `Arc<RwLock<Option<…>>>`.
    //    A cold miss acquires the WRITE lock, so concurrent requests for
    //    the same tenant block on that lock and then serve the
    //    freshly-written bytes — one 3-table snapshot per burst, not N.
    // 2. VERSION REVALIDATION: on a TTL-expired entry, instead of blindly
    //    re-serialising the whole snapshot, we run a cheap version stamp
    //    query (COUNT + MAX(updated_at) per table). If nothing changed,
    //    the cached bytes are served and the timestamp refreshed; the
    //    expensive full snapshot runs only when reference data actually
    //    changed.
    const SNAPSHOT_CACHE_TTL_SECS: u64 = 900;

    // ADR #43 D4 — cross-instance snapshot cache: when a Redis backend is
    // configured, try it BEFORE the in-process cache. A hit serves the
    // stored bytes (version + data stored with a matching TTL); a miss or
    // Redis error falls through to the in-process single-flight path, and
    // a full recompute writes the result back to Redis.
    if let Some(redis) = state.rate_limiter.redis() {
        match redis.snapshot_get(tenant_id).await {
            Ok(Some((_version, bytes))) => {
                metrics::SYNC_PULL_DURATION_MS.observe(start.elapsed().as_secs_f64() * 1000.0);
                return Ok(json_snapshot_response(bytes, if_none_match));
            }
            Ok(None) => {
                // Cache miss — fall through to the in-process path.
            }
            Err(e) => {
                tracing::debug!(tenant_id, error = %e, "Redis snapshot cache miss (error) — using in-process");
            }
        }
    }

    // Fast path: fresh cache hit under the READ lock — zero DB access
    // (SOTA finding C: serve the stored bytes, no re-serialise).
    let entry = {
        let mut cache = state.snapshot_cache.lock().await;
        cache
            .entry(tenant_id.to_owned())
            .or_insert_with(|| Arc::new(tokio::sync::RwLock::new(None)))
            .clone()
    };

    {
        let guard = entry.read().await;
        if let Some(data) = guard.as_ref()
            && data.generated_at.elapsed().as_secs() < SNAPSHOT_CACHE_TTL_SECS
        {
            return Ok(json_snapshot_response(data.bytes.clone(), if_none_match));
        }
    }

    // Slow path: acquire the WRITE lock — this serialises recomputation
    // per tenant (single-flight). Re-check freshness because another
    // request may have just refreshed the entry while we waited.
    let mut guard = entry.write().await;
    if let Some(data) = guard.as_ref()
        && data.generated_at.elapsed().as_secs() < SNAPSHOT_CACHE_TTL_SECS
    {
        return Ok(json_snapshot_response(data.bytes.clone(), if_none_match));
    }

    let store = state.store();

    // Version revalidation: cheap stamp first. If reference data is
    // unchanged since the cached entry, serve the cached bytes and
    // refresh the timestamp — no full 3-table re-serialise.
    let version = match store.snapshot_version(tenant_id).await {
        Ok(v) => v,
        Err(e) => return Err(error_json(&e)),
    };
    if let Some(data) = guard.as_mut()
        && data.version == version
    {
        let bytes = data.bytes.clone();
        data.generated_at = std::time::Instant::now();
        drop(guard);
        return Ok(json_snapshot_response(bytes, if_none_match));
    }

    // Full recompute: query + serialise once, cache + serve the bytes.
    let db_start = std::time::Instant::now();
    let (products, tax_rates, users) = match store.snapshot_all(tenant_id).await {
        Ok(v) => v,
        Err(e) => return Err(error_json(&e)),
    };

    metrics::DB_CONTENTION_SECONDS
        .with_label_values(&["snapshot"])
        .observe(db_start.elapsed().as_secs_f64());

    let snapshot = serde_json::json!({
        "products": products,
        "tax_rates": tax_rates,
        "users": users,
    });

    // Serialize once: the bytes are both cached and served as the
    // response body (SOTA finding C — no second JSON pass).
    let bytes = match serde_json::to_vec(&snapshot) {
        Ok(bytes) => bytes,
        Err(e) => return Err(error_json(&e.to_string())),
    };

    *guard = Some(SnapshotData {
        generated_at: std::time::Instant::now(),
        version: version.clone(),
        bytes: bytes.clone(),
    });
    drop(guard);

    // ADR #43 D4: write the freshly-computed snapshot back to Redis so
    // other instances can serve it. A failure is non-fatal — the in-process
    // cache already holds the bytes for this instance.
    if let Some(redis) = state.rate_limiter.redis()
        && let Err(e) = redis
            .snapshot_set(tenant_id, &version, &bytes, SNAPSHOT_CACHE_TTL_SECS)
            .await
    {
        tracing::debug!(tenant_id, error = %e, "Redis snapshot write-back failed");
    }

    // Opportunistically prune expired entries so a tenant that stops
    // polling cannot leave its entry in memory forever (unbounded growth
    // under tenant churn). The TTL read-check above only skips STALE
    // reads; this eviction is what bounds the map size.
    let mut cache = state.snapshot_cache.lock().await;
    cache.retain(|_, entry| {
        let stale = entry
            .try_read()
            .map(|g| {
                g.as_ref()
                    .map(|d| d.generated_at.elapsed().as_secs() >= SNAPSHOT_CACHE_TTL_SECS)
                    .unwrap_or(true)
            })
            .unwrap_or(false);
        !stale
    });

    metrics::SYNC_PULL_DURATION_MS.observe(start.elapsed().as_secs_f64() * 1000.0);
    Ok(json_snapshot_response(bytes, if_none_match))
}

/// `GET /api/sync/status` — return server health, version, and pending queue depth.
#[tracing::instrument(skip(state), fields(tenant_id = claims.tenant_id.as_deref().unwrap_or("default")))]
async fn status_handler(
    State(state): State<SyncState>,
    Extension(claims): Extension<ApiTokenClaims>,
) -> axum::Json<SyncStatusResponse> {
    let tenant_id = claims.tenant_id.as_deref().unwrap_or("default");
    let store = state.store();
    let (pending_count, total_tenants) = (
        store.pending_count(tenant_id).await,
        state.cached_tenant_count().await,
    );

    // P-3: Tiered heartbeat — server tells client how often to poll.
    // < 1000 tenants → 120s, 1000-5000 → 300s, 5000+ → max(300, 10k/count*60).
    let heartbeat_interval_secs = match total_tenants {
        0..=999 => 120,
        1000..=5000 => 300,
        _ => (10_000 / total_tenants * 60).max(300),
    };

    axum::Json(SyncStatusResponse {
        status: "ok".into(),
        version: env!("CARGO_PKG_VERSION").into(),
        pending_count,
        heartbeat_interval_secs: heartbeat_interval_secs as u64,
    })
}

/// Query filters for `GET /api/sync/conflicts`.
///
/// Both filters are optional; omitted means "every status" / "every severity".
/// An unrecognised value simply matches nothing rather than erroring, because
/// a filter is a narrowing of an already tenant-scoped list — there is no
/// spoofing surface to protect here, only a smaller result set.
#[derive(Debug, Deserialize)]
pub struct ConflictListQuery {
    /// `open` | `resolved` | `dismissed`.
    pub status: Option<String>,
    /// `high` | `medium` | `low`.
    pub severity: Option<String>,
}

/// Response from `GET /api/sync/conflicts`.
#[derive(Debug, serde::Serialize)]
pub struct ConflictListResponse {
    /// Matching conflicts, newest first.
    pub conflicts: Vec<crate::conflict_resolution::SyncConflictRow>,
    /// Number of rows returned.
    pub count: usize,
}

/// Body of `POST /api/sync/conflicts/:id/resolve`.
#[derive(Debug, Deserialize)]
pub struct ResolveConflictRequest {
    /// The chosen side or a custom merge, recorded verbatim on the row.
    pub resolution: String,
}

/// `GET /api/sync/conflicts` — list this tenant's flagged conflicts.
///
/// Tenant scoping comes from the JWT claims and never from the query string,
/// so one tenant cannot enumerate another's conflicts by editing a parameter.
#[tracing::instrument(skip(state), fields(tenant_id = claims.tenant_id.as_deref().unwrap_or("default")))]
async fn list_conflicts_handler(
    State(state): State<SyncState>,
    Extension(claims): Extension<ApiTokenClaims>,
    Query(query): Query<ConflictListQuery>,
) -> Result<Json<ConflictListResponse>, StatusCode> {
    let tenant_id = claims.tenant_id.as_deref().unwrap_or("default");
    let store = state.store();

    let conflicts = store
        .list_conflicts(
            tenant_id,
            query.status.as_deref(),
            query.severity.as_deref(),
        )
        .await
        .map_err(|e| {
            tracing::error!("list_conflicts failed: {e}");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    Ok(Json(ConflictListResponse {
        count: conflicts.len(),
        conflicts,
    }))
}

/// `POST /api/sync/conflicts/:id/resolve` — record a manager's decision.
///
/// Returns 404 when the id does not exist, belongs to another tenant, or is
/// already closed. Resolving twice must not overwrite the first decision: the
/// row is the audit trail, so a second write is a conflict of its own rather
/// than a silent update.
#[tracing::instrument(skip(state, body), fields(tenant_id = claims.tenant_id.as_deref().unwrap_or("default")))]
async fn resolve_conflict_handler(
    State(state): State<SyncState>,
    Extension(claims): Extension<ApiTokenClaims>,
    Path(id): Path<String>,
    Json(body): Json<ResolveConflictRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let tenant_id = claims.tenant_id.as_deref().unwrap_or("default");
    let store = state.store();

    let resolved = store
        .resolve_conflict(tenant_id, &id, &body.resolution, &claims.sub)
        .await
        .map_err(|e| {
            tracing::error!("resolve_conflict failed: {e}");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    if !resolved {
        return Err(StatusCode::NOT_FOUND);
    }

    Ok(Json(serde_json::json!({
        "id": id,
        "status": "resolved",
        "resolution": body.resolution,
    })))
}

/// Response from the status endpoint.
#[derive(Debug, serde::Serialize)]
pub struct SyncStatusResponse {
    /// Server health status (e.g. `"ok"`).
    pub status: String,
    /// Server package version.
    pub version: String,
    /// Number of items in the queue with status `pending`.
    pub pending_count: i64,
    /// Recommended heartbeat interval in seconds (P-3 tiered heartbeat).
    pub heartbeat_interval_secs: u64,
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "sync_api_tests.rs"]
mod tests;
