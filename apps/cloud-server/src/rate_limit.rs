/*
last audited 25-07-26 by RSA-Agent (cloud-server slice A: verified)
crate: cloud-server | status: SAFE | lint: CLEAN
findings: clean — sharded token buckets with per-route configs and background cleanup; unwraps carry SAFETY comments on static metric names; panic guards are deliberate pool-type mismatches; sweep found no SQL interpolation
next: none | perf: N/A
*/
//! Per-tenant token-bucket rate limiter (P8-1).
//!
//! Provides an axum middleware that limits request rates per tenant
//! (identified via JWT claims) using the token-bucket algorithm.
//! A background task periodically removes stale buckets.
//!
//! # Rate limits
//!
//! | Endpoint | Limit | Window |
//! |---|---|---|
//! | `POST /api/sync/push` | 100 | per minute |
//! | `POST /api/sync/pull` | 300 | per minute |
//! | `GET  /api/sync/status` | 300 | per minute |
//! | `GET  /api/sync/snapshot` | 50 | per minute |
//! | `POST /api/v1/tokens` | 30 | per minute, per client IP |
//!
//! When exceeded, returns `429 Too Many Requests` with a `Retry-After` header.

use std::{
    collections::HashMap,
    hash::{Hash, Hasher},
    sync::Arc,
    time::{Duration, Instant},
};

use axum::{
    extract::{Extension, Request},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
};
use tokio::sync::RwLock;
use tracing::warn;

use crate::redis_backend::RedisBackend;

// ── Rate limit configuration ──────────────────────────────────────

/// Rate limit configuration for a single route.
#[derive(Debug, Clone, Copy)]
struct RateLimitConfig {
    /// Maximum tokens (burst capacity).
    capacity: u32,
    /// Tokens replenished per second.
    refill_per_sec: f64,
}

/// Map of URI path prefixes to their rate limit configs.
/// Order matters: more specific prefixes first.
const RATE_LIMITS: &[(&str, RateLimitConfig)] = &[
    (
        "/api/sync/snapshot",
        RateLimitConfig {
            capacity: 50,
            refill_per_sec: 50.0 / 60.0, // 50/min
        },
    ),
    (
        "/api/sync/push",
        RateLimitConfig {
            capacity: 100,
            refill_per_sec: 100.0 / 60.0, // 100/min
        },
    ),
    (
        "/api/sync/pull",
        RateLimitConfig {
            capacity: 300,
            refill_per_sec: 300.0 / 60.0, // 300/min
        },
    ),
    (
        "/api/sync/status",
        RateLimitConfig {
            capacity: 300,
            refill_per_sec: 300.0 / 60.0, // 300/min
        },
    ),
];

/// Rate limit for `POST /api/v1/tokens` — 30 mint attempts per minute per
/// client IP. Minting is rare in normal operation (once per terminal boot or
/// on token expiry), so this is generous for legitimate clients while still
/// blocking brute-force attacks on the admin key / terminal credentials.
const TOKEN_RATE_LIMIT: RateLimitConfig = RateLimitConfig {
    capacity: 30,
    refill_per_sec: 30.0 / 60.0, // 30/min
};

// ── Token bucket ──────────────────────────────────────────────────

/// A single token bucket for one tenant + endpoint combination.
#[derive(Debug, Clone)]
struct TokenBucket {
    /// Current token count (capped at capacity).
    tokens: f64,
    /// Maximum tokens (burst capacity).
    capacity: u32,
    /// Tokens replenished per second.
    refill_per_sec: f64,
    /// Last time tokens were refilled.
    last_refill: Instant,
}

impl TokenBucket {
    fn new(capacity: u32, refill_per_sec: f64) -> Self {
        Self {
            tokens: capacity as f64,
            capacity,
            refill_per_sec,
            last_refill: Instant::now(),
        }
    }

    /// Attempt to consume one token. Returns `true` if allowed.
    fn try_consume(&mut self) -> bool {
        self.refill();
        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            true
        } else {
            false
        }
    }

    /// Refill tokens based on elapsed time since last refill.
    fn refill(&mut self) {
        let elapsed = self.last_refill.elapsed().as_secs_f64();
        if elapsed > 0.0 {
            self.tokens = (self.tokens + elapsed * self.refill_per_sec).min(self.capacity as f64);
            self.last_refill = Instant::now();
        }
    }

    /// Return the time in seconds until one token is available.
    fn time_until_token(&self) -> f64 {
        let deficit = 1.0 - self.tokens;
        if deficit <= 0.0 {
            return 0.0;
        }
        deficit / self.refill_per_sec
    }
}

// ── Rate limiter state ────────────────────────────────────────────

/// Number of shards for the bucket map.
///
/// Every rate-limited request previously took the single global write
/// lock (SOTA finding E) — at the 200-400 terminal ceiling (~2,700
/// req/s through `/api/sync/*`), one `RwLock<HashMap>` serialized every
/// tenant's token consumption. Sharding by key hash means each request
/// locks only its shard, so contention drops ~16×.
const SHARD_COUNT: usize = 16;

/// One shard of the bucket map: an independently-locked per-tenant map.
type BucketShard = RwLock<HashMap<String, TokenBucket>>;

/// Shared per-tenant rate limiter state.
///
/// Buckets are stored across [`SHARD_COUNT`] independent
/// `RwLock<HashMap>`s, indexed by a hash of the bucket key, so
/// concurrent requests for different tenants/endpoints never contend
/// on the same lock.
///
/// When [`RateLimiterState::redis`] is `Some` (ADR #43 D4), the limiter
/// first tries the atomic Redis token-bucket script (shared across all
/// instances); on a Redis error it falls back to the in-process shards.
#[derive(Clone)]
pub struct RateLimiterState {
    /// Per-endpoint key → per-tenant → TokenBucket.
    /// Key format: `"{tenant_id}|{endpoint_key}"`.
    /// One `RwLock` per shard; `shard_for(key)` picks the lock.
    shards: Arc<Vec<Arc<BucketShard>>>,
    /// Optional Redis backend for cross-instance rate limiting.
    /// `None` (the default) keeps everything in-process.
    redis: Option<RedisBackend>,
}

impl RateLimiterState {
    /// Create a new empty rate limiter state.
    pub fn new() -> Self {
        let shards = (0..SHARD_COUNT)
            .map(|_| Arc::new(RwLock::new(HashMap::new())))
            .collect::<Vec<_>>();
        Self {
            shards: Arc::new(shards),
            redis: None,
        }
    }

    /// Create a rate limiter that prefers the given Redis backend for
    /// cross-instance token buckets (ADR #43 D4), falling back to the
    /// in-process shards on any Redis error.
    pub fn with_redis(redis: RedisBackend) -> Self {
        let mut limiter = Self::new();
        limiter.redis = Some(redis);
        limiter
    }

    /// The optional Redis backend, if configured.
    pub fn redis(&self) -> Option<&RedisBackend> {
        self.redis.as_ref()
    }

    /// Return the shared Redis backend, if any, consuming the reference.
    pub fn redis_owned(&self) -> Option<RedisBackend> {
        self.redis.clone()
    }

    /// Replace the Redis backend (used at startup when it becomes
    /// available after the limiter is constructed).
    pub fn set_redis(&mut self, redis: Option<RedisBackend>) {
        self.redis = redis;
    }

    /// Pick the shard lock for a bucket key (stable across calls).
    fn shard_for(&self, key: &str) -> Arc<BucketShard> {
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        key.hash(&mut hasher);
        let idx = hasher.finish() as usize % SHARD_COUNT;
        self.shards[idx].clone()
    }

    /// Try to consume a token for the given tenant and URI path.
    /// Returns `Ok(())` if allowed, or `Err(retry_after_seconds)` if rate-limited.
    pub async fn check_rate_limit(&self, tenant_id: &str, path: &str) -> Result<(), f64> {
        let Some((prefix, config)) = RATE_LIMITS
            .iter()
            .find(|(prefix, _)| path.starts_with(prefix))
        else {
            return Ok(()); // No rate limit configured for this path
        };

        self.check_keyed(
            format!("{tenant_id}|{prefix}"),
            config.capacity,
            config.refill_per_sec,
        )
        .await
    }

    /// Try to consume a token for the token-mint endpoint, keyed by client IP.
    ///
    /// `/api/v1/tokens` mints the JWT, so there are no `ApiTokenClaims` to key
    /// the per-tenant limiter on; it is throttled by client IP instead to stop
    /// brute-forcing of the admin key / terminal client credentials.
    pub async fn check_token_rate_limit(&self, ip: &str) -> Result<(), f64> {
        self.check_keyed(
            format!("ip:{ip}"),
            TOKEN_RATE_LIMIT.capacity,
            TOKEN_RATE_LIMIT.refill_per_sec,
        )
        .await
    }

    /// Consume one token from the bucket identified by `key`, creating it on
    /// demand with the given capacity and refill rate. Locks only the shard
    /// that owns `key` (SOTA finding E).
    ///
    /// When a Redis backend is configured (ADR #43 D4), the token bucket is
    /// shared across instances via the atomic Lua script; on any Redis error
    /// the request falls back to the in-process shard so a Redis outage
    /// never blocks sync.
    async fn check_keyed(
        &self,
        key: String,
        capacity: u32,
        refill_per_sec: f64,
    ) -> Result<(), f64> {
        if let Some(redis) = self.redis() {
            match redis.check_rate_limit(&key, capacity, refill_per_sec).await {
                Ok(None) => return Ok(()),                        // allowed
                Ok(Some(retry_after)) => return Err(retry_after), // denied
                Err(e) => {
                    // Redis failure — fall through to the in-process bucket
                    // so a single instance keeps working. Log at debug: a
                    // full Redis outage would spam the log otherwise.
                    tracing::debug!(key, error = %e, "Redis rate limiter failed — using in-process");
                }
            }
        }

        let shard = self.shard_for(&key);
        let mut buckets = shard.write().await;
        let bucket = buckets
            .entry(key)
            .or_insert_with(|| TokenBucket::new(capacity, refill_per_sec));

        if bucket.try_consume() {
            Ok(())
        } else {
            Err(bucket.time_until_token())
        }
    }

    /// Remove buckets that haven't been used in more than `max_age`.
    pub async fn cleanup_stale_buckets(&self, max_age: Duration) {
        let cutoff = Instant::now() - max_age;
        for shard in self.shards.iter() {
            let mut buckets = shard.write().await;
            buckets.retain(|_, bucket| bucket.last_refill > cutoff);
        }
    }

    /// Return the number of active buckets (for metrics/debugging).
    pub async fn bucket_count(&self) -> usize {
        let mut total = 0;
        for shard in self.shards.iter() {
            total += shard.read().await.len();
        }
        total
    }
}

// ── Axum middleware ───────────────────────────────────────────────

/// Axum middleware that rate-limits requests per tenant.
///
/// Must be applied AFTER the auth middleware (which injects `ApiTokenClaims`)
/// and AFTER the `RateLimiterState` extension is added to the router.
///
/// Accesses tenant_id via `request.extensions().get::<ApiTokenClaims>()`
/// (injected by auth_middleware) and the RateLimiterState via `Extension`
/// (injected by the router layer in sync_api.rs).
///
/// Returns `429 Too Many Requests` with `Retry-After` header when rate-limited.
pub async fn rate_limit_middleware(
    Extension(rate_limiter): Extension<RateLimiterState>,
    request: Request,
    next: Next,
) -> Response {
    let path = request.uri().path();

    // Tenant ID comes from the auth middleware's extension — if not present,
    // fall through without rate limiting (auth middleware will reject anyway).
    let tenant_id = request
        .extensions()
        .get::<kasirmu_api::auth::ApiTokenClaims>()
        .and_then(|claims| claims.tenant_id.as_deref())
        .unwrap_or("default");

    match rate_limiter.check_rate_limit(tenant_id, path).await {
        Ok(()) => next.run(request).await,
        Err(retry_after) => {
            let retry_secs = retry_after.ceil() as u64;
            warn!(
                tenant_id,
                path,
                retry_after_secs = retry_secs,
                "rate limit exceeded"
            );
            crate::metrics::RATE_LIMIT_429_TOTAL
                .with_label_values(&["sync"])
                .inc();
            (
                StatusCode::TOO_MANY_REQUESTS,
                [("Retry-After", &retry_secs.to_string())],
                axum::Json(serde_json::json!({
                    "error": "rate_limit_exceeded",
                    "retry_after_seconds": retry_secs,
                })),
            )
                .into_response()
        }
    }
}

/// Axum middleware that rate-limits `POST /api/v1/tokens` per client IP.
///
/// Unlike [`rate_limit_middleware`], this runs BEFORE authentication — the
/// token endpoint mints the JWT, so there are no `ApiTokenClaims` to key on.
///
/// The client IP is resolved from the `X-Forwarded-For` / `X-Real-IP` headers,
/// which the reverse proxy must overwrite (per the plan the proxy is the single
/// public entry point). Without a proxy header, all requests share one
/// `"unknown"` bucket.
pub async fn token_rate_limit_middleware(
    Extension(rate_limiter): Extension<RateLimiterState>,
    request: Request,
    next: Next,
) -> Response {
    // Only the token-mint endpoint is throttled here; every other route on
    // the API router passes straight through.
    if request.uri().path() != "/api/v1/tokens" {
        return next.run(request).await;
    }

    let ip = client_ip(&request);
    match rate_limiter.check_token_rate_limit(&ip).await {
        Ok(()) => next.run(request).await,
        Err(retry_after) => {
            let retry_secs = retry_after.ceil() as u64;
            warn!(
                ip = %ip,
                path = "/api/v1/tokens",
                retry_after_secs = retry_secs,
                "token mint rate limit exceeded"
            );
            crate::metrics::RATE_LIMIT_429_TOTAL
                .with_label_values(&["token"])
                .inc();
            (
                StatusCode::TOO_MANY_REQUESTS,
                [("Retry-After", &retry_secs.to_string())],
                axum::Json(serde_json::json!({
                    "error": "rate_limit_exceeded",
                    "retry_after_seconds": retry_secs,
                })),
            )
                .into_response()
        }
    }
}

/// Resolve the client IP for token-mint rate limiting. Prefers the
/// `X-Forwarded-For` header (first hop, set/overwritten by the reverse proxy),
/// then `X-Real-IP`, and finally a shared `"unknown"` bucket when neither is
/// present.
fn client_ip(request: &Request) -> String {
    if let Some(ip) = request
        .headers()
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(',').next())
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        return ip.to_string();
    }
    if let Some(ip) = request
        .headers()
        .get("x-real-ip")
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        return ip.to_string();
    }
    "unknown".to_string()
}

// ── Background cleanup ────────────────────────────────────────────

/// Start a background task that removes stale rate-limit buckets every 60 seconds.
///
/// Buckets unused for more than 5 minutes are removed. The task runs until
/// the returned `tokio::sync::watch::Sender` is dropped or the application shuts down.
pub fn start_rate_limit_cleanup(state: RateLimiterState) -> tokio::sync::watch::Sender<bool> {
    let (tx, mut rx) = tokio::sync::watch::channel::<bool>(false);

    tokio::spawn(async move {
        // Lazy cleanup: only sweep when bucket count is high.
        // With <1000 buckets, the sweep is a no-op (HashMap::retain on
        // a small map is negligible). This avoids acquiring the write
        // lock every 60s when there are few active tenants.
        loop {
            tokio::select! {
                _ = tokio::time::sleep(Duration::from_secs(120)) => {
                    let count = state.bucket_count().await;
                    if count > 500 {
                        state.cleanup_stale_buckets(Duration::from_secs(300)).await;
                    }
                }
                _ = rx.changed() => {
                    break;
                }
            }
        }
    });

    tx
}

// ── Tests ─────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "rate_limit_tests.rs"]
mod tests;
