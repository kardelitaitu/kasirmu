/*
last audited 25-07-26 by RSA-Agent (cloud-server slice B: sync_api deep read)
crate: cloud-server | status: SAFE | lint: CLEAN
findings: CS-3 FIXED — the SQLite arm of sync_store push_batch now wraps the batch in one unchecked_transaction (commit at the end; UNIQUE failures stay statement-level so per-item outcomes are unchanged) SQLite arm of sync_store push_batch loops per-item in autocommit (no BEGIN/COMMIT), so a mid-batch failure persists partial items; proposed: unchecked_transaction around the loop to match the documented contract. Otherwise exemplary: tenant_id always from JWT claims (never request body, spoofing prevention documented), plan middleware fail-closed, per-tenant rate limiting, TTL caches for snapshot and tenant count with documented staleness rationale, index-order-preserving outcome reassembly, optional UUID-validation skip documented as a measured perf lever
findings: O-M25 FIXED — the snapshot cache was one global `tokio::Mutex<HashMap>` taken by EVERY snapshot request, with a full `Vec<u8>` payload clone on every HIT and a global `retain` sweep over all tenants under that same lock; now sharded 16 ways exactly as `rate_limit.rs` does it, storing/serving `bytes::Bytes` (hit = refcount bump), and the sweep locks one shard at a time with `try_lock` so two shards are never held at once and a busy shard is skipped rather than waited on
next: none | perf: snapshot cache hit is now allocation-free and contention is per-shard
*/
//! Sync API — server-side handlers for the offline-sync push/pull protocol.
//!
//! These endpoints mirror the client-side [`platform_sync::transport`] types:
//!
//! - `POST /api/sync/push` — receives items, persists with existing IDs, returns outcomes
//! - `POST /api/sync/pull` — receives a `PullRequest` with `since` timestamp, returns `PullResponse`
//! - `GET  /api/sync/status` — returns server status and pending queue count

use std::hash::{Hash, Hasher};
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

use kasirmu_api::auth::{ApiTokenClaims, auth_middleware};
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
///
/// **O-M25:** `bytes` is a `Bytes` handle, not a `Vec<u8>`. A cache HIT
/// serves the cached payload on every request, and a `Vec<u8>` clone is a
/// `memcpy` proportional to the whole snapshot (products + tax rates +
/// users — tens of KB per hit). `Bytes` clones are one refcount bump, so the
/// hit path allocates nothing at all. The served bytes are unchanged: a hit
/// still serves exactly the buffer that was serialised on the miss.
#[derive(Clone)]
pub struct SnapshotData {
    /// When the entry was generated (or last version-revalidated).
    pub generated_at: std::time::Instant,
    /// Reference-data version stamp (counts + MAX(updated_at) per table).
    pub version: String,
    /// Serialised JSON snapshot bytes, served verbatim.
    pub bytes: bytes::Bytes,
}

/// Number of shards for the snapshot cache map.
///
/// Mirrors `rate_limit::SHARD_COUNT`. Before O-M25 the whole map sat behind a
/// single `tokio::sync::Mutex`, and EVERY snapshot request took that lock —
/// a hit to get its tenant's entry handle, and a miss a second time for the
/// sweep — so all tenants serialised on one lock on the hot path. Sharding by
/// tenant hash means a request locks only the shard that owns its tenant, so
/// concurrent requests for different tenants never contend.
const SNAPSHOT_SHARD_COUNT: usize = 16;

/// One shard's tenant map: the value inside a [`SnapshotShard`] lock.
type SnapshotShardMap =
    std::collections::HashMap<String, Arc<tokio::sync::RwLock<Option<SnapshotData>>>>;

/// One shard of the snapshot cache: an independently-locked tenant map.
type SnapshotShard = std::sync::Mutex<SnapshotShardMap>;

/// Per-tenant snapshot cache, sharded by tenant hash (O-M25).
///
/// Each tenant's entry is an `Arc<RwLock<Option<SnapshotData>>>` so a cold
/// cache miss is **single-flight**: the first request to miss acquires the
/// write lock and recomputes; every concurrent request for the same tenant
/// blocks on that lock, re-checks, and serves the freshly-written bytes
/// instead of stampeding the database (one 3-table snapshot per burst,
/// not N).
///
/// The shard locks are plain `std::sync::Mutex`es, held only for a
/// `HashMap` lookup/insert or a `retain` sweep — never across an `.await`
/// and never two at once — so a poisoned lock cannot arise from a panic in
/// unrelated code and cannot deadlock. `lock_shard` recovers from poisoning
/// anyway, because the map is a cache: whatever a panicking writer left in it
/// is still valid data.
#[derive(Clone)]
pub struct SnapshotCache {
    /// One independently-locked map per shard; `shard_index` picks it.
    shards: Arc<Vec<Arc<SnapshotShard>>>,
}

impl Default for SnapshotCache {
    fn default() -> Self {
        Self::new()
    }
}

impl SnapshotCache {
    /// Create an empty sharded cache.
    pub fn new() -> Self {
        let shards = (0..SNAPSHOT_SHARD_COUNT)
            .map(|_| Arc::new(std::sync::Mutex::new(std::collections::HashMap::new())))
            .collect::<Vec<_>>();
        Self {
            shards: Arc::new(shards),
        }
    }

    /// Pick the shard index for a tenant key (stable across calls).
    ///
    /// Keyed on the tenant id ALONE, so every entry for a tenant lives in
    /// exactly one shard — that is what makes per-shard eviction
    /// equivalent to a global eviction.
    fn shard_index(tenant_id: &str) -> usize {
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        Hash::hash(tenant_id, &mut hasher);
        Hasher::finish(&hasher) as usize % SNAPSHOT_SHARD_COUNT
    }

    /// Lock the shard owning `tenant_id`, recovering from poisoning.
    ///
    /// The guarded value is a cache map: a panic elsewhere while a writer held
    /// the lock does not leave the map inconsistent (the only operations are
    /// `entry`, `insert` and `retain`, all panic-free), so serving from a
    /// "poisoned" map is safe and strictly better than failing every snapshot
    /// request for the rest of the process's life.
    fn lock_shard(&self, tenant_id: &str) -> std::sync::MutexGuard<'_, SnapshotShardMap> {
        self.shards[Self::shard_index(tenant_id)]
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Return this tenant's entry handle, creating the (empty) entry on first
    /// use. Locks exactly one shard, for a lookup and at most one insert.
    fn entry(&self, tenant_id: &str) -> Arc<tokio::sync::RwLock<Option<SnapshotData>>> {
        let mut map = self.lock_shard(tenant_id);
        map.entry(tenant_id.to_owned())
            .or_insert_with(|| Arc::new(tokio::sync::RwLock::new(None)))
            .clone()
    }

    /// Evict TTL-expired entries, sweeping the shards ONE AT A TIME.
    ///
    /// Each shard is locked only for its own `retain`, so two shard locks are
    /// never held simultaneously — there is no lock-ordering hazard to get
    /// right. Lock acquisition is `try_lock`: a shard that is busy (another
    /// request is inserting this tenant's handle right now) is SKIPPED rather
    /// than waited on, so a sweep can never park a request behind a slow
    /// tenant's map and can never starve a hot tenant. A skipped shard is
    /// swept by the next miss — every miss sweeps, and every miss is also
    /// what adds entries, so skipping cannot let the map grow unbounded.
    ///
    /// The staleness rule is unchanged from the pre-O-M25 global sweep: an
    /// entry is stale when its value is `Some` and older than the TTL, or
    /// when its value is `None` (a tenant that never completed a snapshot).
    fn evict_expired(&self, ttl: std::time::Duration) {
        for shard in self.shards.iter() {
            let Ok(mut map) = shard.try_lock() else {
                continue;
            };
            map.retain(|_, entry| {
                let stale = entry
                    .try_read()
                    .map(|g| {
                        g.as_ref()
                            .map(|d| d.generated_at.elapsed() >= ttl)
                            .unwrap_or(true)
                    })
                    .unwrap_or(false);
                !stale
            });
        }
    }

    /// Total number of cached tenant entries across every shard.
    ///
    /// Test-only accessor (the rate limiter exposes the same shape as
    /// `bucket_count`, which IS used in production by its cleanup task). Takes
    /// each shard lock in turn — never two at once.
    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.shards
            .iter()
            .map(|shard| {
                shard
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .len()
            })
            .sum()
    }

    /// Whether the tenant has an entry in the cache (regardless of staleness).
    #[cfg(test)]
    pub fn contains_key(&self, tenant_id: &str) -> bool {
        self.lock_shard(tenant_id).contains_key(tenant_id)
    }

    /// The cached entry handle for `tenant_id`, if present.
    ///
    /// Test-only accessor: lets a test backdate an entry to observe TTL
    /// behaviour without waiting 15 minutes.
    #[cfg(test)]
    pub fn get(&self, tenant_id: &str) -> Option<Arc<tokio::sync::RwLock<Option<SnapshotData>>>> {
        self.lock_shard(tenant_id).get(tenant_id).cloned()
    }
}

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
    /// P-3 Step 4: in-memory cache with 15-minute TTL. O-M25: sharded across
    /// [`SNAPSHOT_SHARD_COUNT`] independently-locked maps, serving `Bytes`.
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
            snapshot_cache: SnapshotCache::new(),
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
///   `.layer(axum::Extension(plan_cache))`             — O-H09: the short-TTL plan cache plan_middleware reads through
///   `.layer(axum::Extension(enforce_plans))`          — plan gate on/off
///   `.layer(middleware::from_fn(auth_middleware))`        ← outermost (injects ApiTokenClaims)
///   `.layer(middleware::from_fn(plan_middleware))`        ← reads claims, gates free tenants
///   `.layer(middleware::from_fn(rate_limit_middleware))`  ← innermost (reads claims)
///
/// Execution order: auth_middleware → plan_middleware → rate_limit_middleware → handler
/// Axum layers are applied from outside to inside, so the LAST .layer() is the
/// innermost (closest to the handler).
#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "kept as the named entry point of the sync gate: production goes through \
                  sync_router_with_plan_enforcement (default plan cache), this is the \
                  flag-only form the sync plan tests call"
    )
)]
pub fn sync_router(state: SyncState, enforce_plans: bool) -> Router {
    sync_router_with_plan_enforcement(state, enforce_plans)
}

/// Build the sync router with an explicit plan-enforcement flag (used by
/// tests and by [`sync_router`], which reads `OZ_ENFORCE_PLANS`).
#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "the flag-only form of the gate router; production adds the default plan \
                  cache through sync_router_with_plan_enforcement_with_cache"
    )
)]
pub fn sync_router_with_plan_enforcement(state: SyncState, enforce_plans: bool) -> Router {
    sync_router_with_plan_enforcement_with_cache(state, enforce_plans, None)
}

/// Build the sync router with an explicit plan cache (O-H09).
///
/// `None` installs a fresh [`crate::sync_store::PlanCache::default`], which is
/// what production wants: one cache per router, shared by every request through
/// the extension added below, alive for exactly as long as the deployed
/// process. `Some` lets a test supply a cache whose TTL it controls — the only
/// way to observe a plan change made after the router was built once the gate
/// is caching, since a hit is by definition not a read.
pub fn sync_router_with_plan_enforcement_with_cache(
    state: SyncState,
    enforce_plans: bool,
    plan_cache: Option<Arc<crate::sync_store::PlanCache>>,
) -> Router {
    let rate_limiter = state.rate_limiter.clone();
    let store = state.store();
    let plan_cache = plan_cache.unwrap_or_default();
    Router::new()
        .route("/api/sync/push", post(push_handler))
        .route("/api/sync/pull", post(pull_handler))
        .route("/api/sync/status", get(status_handler))
        .route("/api/sync/snapshot", get(snapshot_handler))
        .route("/api/sync/conflicts", get(list_conflicts_handler))
        .route(
            "/api/sync/conflicts/{id}/resolve",
            post(resolve_conflict_handler),
        )
        .with_state(state)
        .layer(middleware::from_fn(rate_limit_middleware))
        .layer(middleware::from_fn(plan_middleware))
        .layer(middleware::from_fn(auth_middleware))
        .layer(axum::Extension(rate_limiter))
        .layer(axum::Extension(store))
        .layer(axum::Extension(plan_cache))
        .layer(axum::Extension(enforce_plans))
}

/// Plan gate (ADR sync-plan-gating): when enforcement is enabled, a tenant
/// on the `free` plan (or with no assigned plan — fail closed) is rejected
/// with a structured 403 `{"error":"plan_required"}`. Runs after auth so
/// claims are available, before the handler.
///
/// O-H09: the plan is read through [`crate::sync_store::PlanCache`], so a
/// second request inside the cache TTL does not reach the database. The gate's
/// decisions are unchanged — a hit serves an answer a successful read produced,
/// a miss performs the same read as before, and an error is still a 500.
#[allow(clippy::result_large_err)]
pub async fn plan_middleware(
    Extension(enforce_plans): Extension<bool>,
    Extension(store): Extension<crate::sync_store::SyncStore>,
    Extension(plan_cache): Extension<Arc<crate::sync_store::PlanCache>>,
    request: Request,
    next: middleware::Next,
) -> Result<axum::response::Response, axum::response::Response> {
    use axum::response::IntoResponse;
    use kasirmu_core::TenantPlan;

    if !enforce_plans {
        return Ok(next.run(request).await);
    }

    let tenant_id = request
        .extensions()
        .get::<kasirmu_api::auth::ApiTokenClaims>()
        .and_then(|claims| claims.tenant_id.as_deref())
        .unwrap_or("default");

    // O-H09: read through the short-TTL plan cache instead of hitting the
    // database on every request. A cache MISS still performs the same store
    // read this gate always did; a hit skips it. The error arm below is
    // unchanged and deliberately not folded into `unwrap_or(Free)`: an error is
    // a 500, a plan of `None` is a 403, and the cache never stores an error.
    let plan = plan_cache
        .get_or_load(tenant_id, || store.get_tenant_plan(tenant_id))
        .await
        .map_err(|_| {
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

/// The Prometheus `outcome` label for one push result.
///
/// C50: this classification used to be an inline match arm with a
/// hand-written `reason.starts_with("duplicate id:")` literal — the FIFTH
/// expression of the duplicate-id rule and the only one that re-typed the
/// string instead of calling the shared predicate. The prefix's PRODUCER
/// (`sync_store/sqlite.rs` and `sync_store/pg.rs`, both
/// `format!("duplicate id: {}", item.id)`) and this CLASSIFIER lived in
/// different files, so a reword of
/// [`kasirmu_core::sync_client::DUPLICATE_ID_REJECTION_PREFIX`] would have
/// silently desynchronised the metric from the thing it measures:
/// `sync_pushes_total{outcome="conflict"}` would quietly stop counting
/// replays and start counting them as `rejected`. A metric that stops
/// measuring without failing is the same shape as the audit-retention
/// divergence (C44) and the inert quota axis (C36).
///
/// Calling the predicate instead of re-typing the prefix makes the coupling
/// explicit and compile-checked: there is no second literal to drift, and
/// the constant is reachable because this crate already depends on
/// `kasirmu-core` (`apps/cloud-server/Cargo.toml`) and already uses it in
/// this very file.
///
/// Extracted from the handler body so the classification is reachable from a
/// unit test without an HTTP round trip — the same reason the client-side
/// appliers were extracted. Kept private: it is an implementation detail of
/// the push handler's instrumentation, not part of the server's surface.
fn push_outcome_label(outcome: &PushOutcome) -> &'static str {
    match outcome {
        PushOutcome::Accepted => "accepted",
        PushOutcome::Rejected { reason }
            if kasirmu_core::sync_client::is_duplicate_id_rejection(reason) =>
        {
            "conflict"
        }
        PushOutcome::Rejected { .. } => "rejected",
        PushOutcome::Conflict(..) => "conflict",
    }
}

/// `POST /api/sync/push` — receive and persist offline queue items.
///
/// Each item is inserted with its existing client-generated ID. Duplicate
/// IDs (UNIQUE constraint violation) are reported as `Rejected`.
// O-M23: `items` is no longer a parameter (the handler takes the raw body and
// parses it below), so the span cannot read `items.len()` up front. The span now
// opens with `body_bytes` — the same quantity the metric records — and
// `item_count` is recorded on the span once the body has been parsed, so the
// field is still present on every span that reaches the parse.
#[tracing::instrument(skip(state, body), fields(tenant_id = claims.tenant_id.as_deref().unwrap_or("default"), body_bytes = body.len()))]
async fn push_handler(
    State(state): State<SyncState>,
    Extension(claims): Extension<ApiTokenClaims>,
    // O-M23: take the RAW body rather than `axum::Json<Vec<..>>`. Two reasons,
    // and the second is the one that matters:
    //
    // 1. Cost. The metric below needs the body size, and the old code got it by
    //    re-serialising the already-parsed `items` with `serde_json::to_vec` —
    //    a second full serialisation of the hottest write path, allocating a
    //    throwaway buffer the size of the request, purely to read `.len()`.
    //
    // 2. Meaning. The metric is documented as "Push request body size in bytes"
    //    (`metrics.rs`), i.e. the TRANSPORT size. `serde_json::to_vec(&items)`
    //    is the size of a RE-SERIALISATION, which is only equal to the request
    //    body if the client formatted its JSON exactly as serde would (no
    //    extra whitespace, same key order, same float formatting). A client
    //    sending pretty-printed JSON inflates its own request without the old
    //    metric ever seeing it. `bytes.len()` IS the body, so this observes the
    //    quantity the metric names rather than a proxy for it.
    //
    // Malformed JSON is still rejected, just at the parse below instead of in
    // the extractor, and with the same status the `Json` rejection produced.
    body: axum::body::Bytes,
) -> Result<axum::Json<PushResponse>, (axum::http::StatusCode, String)> {
    let start = std::time::Instant::now();

    // Tenant isolation: use the tenant_id from the JWT claims, not the
    // incoming JSON body, to prevent tenant spoofing.
    let tenant_id = claims.tenant_id.as_deref().unwrap_or("default");

    // Request body size, as sent.
    metrics::SYNC_BATCH_SIZE_BYTES.observe(body.len() as f64);

    // Parse at the handler edge. The status and message mirror what
    // `axum::Json` returned before, so a client sees no behaviour change.
    // 400, matching what the `axum::Json` extractor returned before O-M23:
    // `push_rejects_malformed_json` pins that status, and taking the raw body
    // must not silently renegotiate a client-visible contract.
    let items: Vec<kasirmu_core::offline::OfflineQueueItem> = serde_json::from_slice(&body)
        .map_err(|e| {
            (
                axum::http::StatusCode::BAD_REQUEST,
                format!("Failed to deserialize the JSON body into the target type: {e}"),
            )
        })?;
    // Recorded here rather than in `#[instrument(fields(..))]` because the
    // count does not exist until the body is parsed (O-M23). Nothing that read
    // `item_count` on the span loses it: every request that reaches this line
    // has it, and a body that fails to parse never had a count to report.
    tracing::Span::current().record("item_count", items.len());

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
    let mut valid_items: Vec<kasirmu_core::offline::OfflineQueueItem> =
        Vec::with_capacity(items.len());
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
    //
    // O-M22: this is a MERGE, not a scan. `valid_indexes` is strictly ascending
    // (one forward pass over `items` pushes `idx` in increasing order), so a
    // single forward cursor suffices: walk `items` and `valid_indexes` together
    // and the total work is O(items + valid), not the O(items x valid) of
    // `valid_indexes.iter().position(..)` inside the loop over all items (a
    // 1,000-item push did 10^6 comparisons).
    //
    // Order is the correctness invariant, not a nicety: the client zips `pending`
    // against `results` by index (`apply_push_results`), so a reordering would
    // mark the WRONG items synced. The loop emits exactly one outcome per
    // `items` entry, in request order, so `results.len() == items.len()`.
    let mut results = Vec::with_capacity(items.len());
    // Cursor into `valid_indexes` / `batch_results`: the position of the next
    // valid item still waiting for its outcome. It only ever moves forward,
    // which is what makes the walk linear rather than quadratic.
    let mut cursor = 0usize;
    for (idx, item) in items.iter().enumerate() {
        let outcome = if cursor < valid_indexes.len() && valid_indexes[cursor] == idx {
            // `idx` is the next valid item, so its outcome sits at the same
            // position: `valid_indexes` and `batch_results` were filled by the
            // same forward pass. Advance the cursor before reading so the
            // slot stays correct for the next iteration.
            let pos = cursor;
            cursor += 1;
            match batch_results.get(pos) {
                Some(outcome) => outcome.clone(),
                None => {
                    // Should be unreachable: every valid index has an outcome.
                    PushOutcome::Rejected {
                        reason: format!("missing batch outcome for {}", item.id),
                    }
                }
            }
        } else {
            // Not a valid index: the invalid id keeps its Rejected here, at its
            // original position in the request.
            PushOutcome::Rejected {
                reason: format!("invalid id: {}", item.id),
            }
        };
        metrics::SYNC_PUSHES_TOTAL
            .with_label_values(&[push_outcome_label(&outcome)])
            .inc();
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
    // C3 S5: pass the caller's OWN terminal identity down so the pull query
    // can exclude rows it originated. This is defence in depth for the
    // desktop shell, where the daemons apply against the global database
    // while checkout wrote a per-store one — so the client-side self-origin
    // skip is not the whole story. The claim is the verified one (never the
    // request body), and a caller with no terminal identity — an
    // admin-minted or legacy token — passes `None` and gets today's
    // behaviour: every tenant row in the window, unfiltered.
    let mut items: Vec<kasirmu_core::offline::OfflineQueueItem> = store
        .pull_items(
            tenant_id,
            claims.terminal_id.as_deref(),
            req.since.as_deref(),
            cursor,
            limit,
        )
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
///
/// O-M25: takes a `bytes::Bytes` rather than a `Vec<u8>`. `Bytes` is the body
/// type axum buffers into, so the caller's handle is moved into the response
/// as its single existing segment instead of being copied into one.
fn json_snapshot_response(
    bytes: bytes::Bytes,
    if_none_match: Option<&str>,
) -> axum::response::Response {
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
/// `kasirmu-api/src/routes/products.rs`). New tax rates and users are
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
                // O-M25: a `Bytes` response body takes this `Vec<u8>` as ONE
                // body segment and hands it over as-is, instead of the
                // `to_vec()` copy that this path used to force.
                return Ok(json_snapshot_response(
                    bytes::Bytes::from(bytes),
                    if_none_match,
                ));
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
    //
    // O-M25: `entry` locks exactly ONE cache shard (a bare map lookup, with no
    // `.await` inside the lock), so a request for tenant A no longer waits
    // behind a request for tenant B.
    let entry = state.snapshot_cache.entry(tenant_id);

    {
        let guard = entry.read().await;
        if let Some(data) = guard.as_ref()
            && data.generated_at.elapsed().as_secs() < SNAPSHOT_CACHE_TTL_SECS
        {
            // O-M25: `Bytes::clone` is a refcount bump, not a copy of the
            // response. This is the line that ran on EVERY cache hit.
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
        // Single-flight loser: serves the winner's bytes, refcount only.
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
    // O-M25: the serialised payload becomes an immutable `Bytes` handle, so
    // the cached copy and the served copy share one allocation. The buffer is
    // the exact buffer `to_vec` produced, moved — the wire bytes are
    // unchanged.
    let bytes = match serde_json::to_vec(&snapshot) {
        Ok(bytes) => bytes::Bytes::from(bytes),
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
    //
    // O-M25: the sweep no longer holds one global lock across every tenant.
    // It walks the shards one at a time (never two locks at once) and
    // `try_lock`s each, so a busy shard is skipped rather than making a
    // request wait, and a tenant being recomputed right now is never parked
    // behind the sweep. Same staleness rule as before; see
    // `SnapshotCache::evict_expired`.
    state
        .snapshot_cache
        .evict_expired(std::time::Duration::from_secs(SNAPSHOT_CACHE_TTL_SECS));

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
    /// Number of items in the queue with status `pending`, or -1 when the count
    /// could not be read. A client MUST treat -1 as unknown, never as an empty
    /// queue: this is the signal a terminal polls to decide whether its backlog
    /// is draining, so reading a failure as 0 stops the client retrying. Same
    /// third state as `HealthResponse::sync_queue_depth`.
    pub pending_count: i64,
    /// Recommended heartbeat interval in seconds (P-3 tiered heartbeat).
    pub heartbeat_interval_secs: u64,
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "sync_api_tests.rs"]
mod tests;
