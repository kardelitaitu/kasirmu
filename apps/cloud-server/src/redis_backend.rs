/*
last audited 2026-09-02 by Architecture Team
crate: cloud-server | status: PROPOSED | lint: CLEAN
findings: D4 — Redis/Valkey cross-instance snapshot cache + shared rate limiter
next: integration with in-process fallback on Redis error
*/

//! Optional Redis backend for the cloud sync server (ADR #43 D4).
//!
//! Provides a cross-instance snapshot cache (tenant → version + bytes, with
//! TTL) and an atomic token-bucket rate limiter via a Lua script.  Both
//! operations fall back to the in-process implementation when Redis is
//! unavailable — single-instance deployments need nothing new.
//!
//! # Key design
//!
//! - **Snapshot cache** — two keys per tenant, set in a pipeline:
//!   `oz:snapshot:{tenant}:ver` (version string) and
//!   `oz:snapshot:{tenant}:data` (raw JSON bytes).  Both share the same
//!   TTL so they expire together.  On a cache hit the handler serves the
//!   bytes directly; on a miss it recomputes and stores.
//! - **Rate limiter** — a Lua script (`TOKEN_BUCKET_LUA`) implements a
//!   token bucket identical in semantics to the in-process `TokenBucket`
//!   (`rate_limit.rs`, private).  Redis’s single-
//!   threaded execution makes the Lua script atomic across all instances.
//! - **Fallback** — every public method (`snapshot_get`, `snapshot_set`,
//!   `check_rate_limit`) returns `Err` on Redis failure; the caller
//!   catches the error and falls back to the in-process implementation.

use redis::aio::ConnectionManager;

/// Prefix for Redis keys used by the snapshot cache.
const SNAPSHOT_KEY_PREFIX: &str = "oz:snapshot";
/// Prefix for Redis keys used by the rate limiter.
const RATE_LIMIT_KEY_PREFIX: &str = "oz:rate_limit";

/// Lua token-bucket script, loaded once and executed via `EVALSHA`.
///
/// `KEYS[1]` = `oz:rate_limit:{key}` (Redis Hash: `tokens`, `last_refill`)
/// `ARGV[1]` = capacity (u32)
/// `ARGV[2]` = refill_per_sec (f64)
/// `ARGV[3]` = now (unix seconds as f64)
/// `ARGV[4]` = window_seconds (u32 — TTL for the key)
///
/// Returns:
///   `{1, 0}` — allowed (consumed one token)
///   `{0, retry_after}` — denied, retry after this many seconds (f64)
const TOKEN_BUCKET_LUA: &str = r#"
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local window = tonumber(ARGV[4])

local raw_tokens = redis.call('HGET', key, 'tokens')
local raw_ts = redis.call('HGET', key, 'last_refill')

local tokens, last_refill
if raw_tokens then
    tokens = tonumber(raw_tokens)
    last_refill = tonumber(raw_ts)
    local elapsed = now - last_refill
    if elapsed > 0 then
        tokens = math.min(tokens + elapsed * refill, capacity)
    end
else
    tokens = capacity
    last_refill = now
end

if tokens >= 1 then
    tokens = tokens - 1
    redis.call('HSET', key, 'tokens', tokens, 'last_refill', now)
    redis.call('EXPIRE', key, window)
    return {1, 0}
else
    local deficit = 1 - tokens
    local retry_after = deficit / refill
    return {0, retry_after}
end
"#;

/// A connected Redis (or Valkey) backend for cross-instance caching and
/// rate limiting.
///
/// All operations are async; a failure (connection lost, timeout, …)
/// returns `Err` so the caller can fall back to the in-process
/// implementation.
#[derive(Clone)]
pub struct RedisBackend {
    conn: ConnectionManager,
}

impl RedisBackend {
    /// Open a connection to Redis at `url` and verify it is reachable via
    /// `PING`.  Returns `Ok(Some(Self))` on success, `Ok(None)` if the
    /// connection was refused (logged as a warning — the caller should
    /// fall back to the in-process implementation), and `Err` on a
    /// genuinely malformed URL (a configuration error).
    pub async fn connect(url: &str) -> Result<Option<Self>, String> {
        let client = redis::Client::open(url).map_err(|e| format!("invalid REDIS_URL: {e}"))?;
        match ConnectionManager::new(client).await {
            Ok(conn) => {
                let backend = Self { conn };
                if backend.ping().await {
                    tracing::info!("Redis backend connected");
                    Ok(Some(backend))
                } else {
                    tracing::warn!("Redis backend: PING failed — falling back to in-process");
                    Ok(None)
                }
            }
            Err(e) => {
                tracing::warn!(
                    "Redis backend unavailable ({}); falling back to in-process",
                    e
                );
                Ok(None)
            }
        }
    }

    /// Check whether the backend is reachable.
    pub async fn ping(&self) -> bool {
        let mut conn = self.conn.clone();
        redis::cmd("PING")
            .query_async::<String>(&mut conn)
            .await
            .is_ok()
    }

    // ── Snapshot cache ────────────────────────────────────────────────

    /// Format the Redis key for a tenant's snapshot metadata.
    fn snapshot_ver_key(tenant_id: &str) -> String {
        format!("{SNAPSHOT_KEY_PREFIX}:{tenant_id}:ver")
    }

    /// Format the Redis key for a tenant's snapshot bytes.
    fn snapshot_data_key(tenant_id: &str) -> String {
        format!("{SNAPSHOT_KEY_PREFIX}:{tenant_id}:data")
    }

    /// Retrieve a cached snapshot entry for `tenant_id`.
    ///
    /// Returns `Ok(Some((version, bytes)))` on a cache hit, `Ok(None)` on
    /// a cache miss (the key does not exist or is expired), or `Err` on a
    /// Redis error (the caller should fall back to the in-process cache).
    pub async fn snapshot_get(&self, tenant_id: &str) -> Result<Option<(String, Vec<u8>)>, String> {
        let ver_key = Self::snapshot_ver_key(tenant_id);
        let data_key = Self::snapshot_data_key(tenant_id);
        let mut conn = self.conn.clone();

        // Two GETs (not a pipeline) for reliable type inference.
        // The extra round-trip is negligible compared to the DB query
        // that a cache miss triggers.
        let ver: Option<String> = redis::cmd("GET")
            .arg(&ver_key)
            .query_async(&mut conn)
            .await
            .map_err(|e| format!("Redis snapshot_get (ver) failed: {e}"))?;
        let data: Option<Vec<u8>> = redis::cmd("GET")
            .arg(&data_key)
            .query_async(&mut conn)
            .await
            .map_err(|e| format!("Redis snapshot_get (data) failed: {e}"))?;

        match (ver, data) {
            (Some(v), Some(d)) => Ok(Some((v, d))),
            _ => Ok(None),
        }
    }

    /// Store a snapshot entry for `tenant_id` with a TTL.
    ///
    /// Both the version string and the raw bytes are stored under separate
    /// keys with the same TTL so they expire together.
    pub async fn snapshot_set(
        &self,
        tenant_id: &str,
        version: &str,
        bytes: &[u8],
        ttl_secs: u64,
    ) -> Result<(), String> {
        let ver_key = Self::snapshot_ver_key(tenant_id);
        let data_key = Self::snapshot_data_key(tenant_id);
        let mut conn = self.conn.clone();

        redis::cmd("SETEX")
            .arg(&ver_key)
            .arg(ttl_secs as i64)
            .arg(version)
            .query_async::<()>(&mut conn)
            .await
            .map_err(|e| format!("Redis snapshot_set (ver) failed: {e}"))?;
        redis::cmd("SETEX")
            .arg(&data_key)
            .arg(ttl_secs as i64)
            .arg(bytes)
            .query_async::<()>(&mut conn)
            .await
            .map_err(|e| format!("Redis snapshot_set (data) failed: {e}"))?;

        Ok(())
    }

    // ── Rate limiter ──────────────────────────────────────────────────

    /// Format the Redis key for a rate-limit bucket.
    fn rate_limit_key(key: &str) -> String {
        format!("{RATE_LIMIT_KEY_PREFIX}:{key}")
    }

    /// Try to consume one token from the rate-limit bucket identified by
    /// `key`, with the given `capacity` and `refill_per_sec` refill rate.
    ///
    /// Returns:
    /// - `Ok(None)` — allowed (token consumed).
    /// - `Ok(Some(retry_after_secs))` — denied, caller should wait this
    ///   many seconds before retrying.
    /// - `Err(...)` — Redis error; the caller should fall back to the
    ///   in-process rate limiter.
    pub async fn check_rate_limit(
        &self,
        key: &str,
        capacity: u32,
        refill_per_sec: f64,
    ) -> Result<Option<f64>, String> {
        let redis_key = Self::rate_limit_key(key);
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs_f64();
        let window: u32 = 60; // TTL for the hash key

        let mut conn = self.conn.clone();
        let result: (i64, f64) = redis::Script::new(TOKEN_BUCKET_LUA)
            .key(&redis_key)
            .arg(capacity)
            .arg(refill_per_sec)
            .arg(now)
            .arg(window)
            .invoke_async(&mut conn)
            .await
            .map_err(|e| format!("Redis rate_limit script failed: {e}"))?;

        match result {
            (1, _) => Ok(None),            // allowed
            (0, retry) => Ok(Some(retry)), // denied
            _ => Err(format!(
                "unexpected Redis rate_limit result: ({}, {})",
                result.0, result.1
            )),
        }
    }
}

// ── Pure helpers (testable without Redis) ────────────────────────────

/// Return the Redis key used for a tenant's snapshot version.
#[allow(dead_code)]
pub fn snapshot_version_key(tenant_id: &str) -> String {
    format!("oz:snapshot:{tenant_id}:ver")
}

/// Return the Redis key used for a tenant's snapshot bytes.
#[allow(dead_code)]
pub fn snapshot_data_key(tenant_id: &str) -> String {
    format!("oz:snapshot:{tenant_id}:data")
}

/// Return the Lua script source for the token-bucket rate limiter.
#[allow(dead_code)]
pub fn token_bucket_lua_source() -> &'static str {
    TOKEN_BUCKET_LUA
}

#[cfg(test)]
#[path = "redis_backend_tests.rs"]
mod tests;
