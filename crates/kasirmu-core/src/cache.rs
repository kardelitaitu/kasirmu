//! Caching layer for frequently-accessed POS data.
/*
last audited 31-08-26 by Antigravity (oz-core: pub/sub filtering, connect path, lock policy)
crate: oz-core | status: SAFE | lint: CLEAN
findings: 3 fixed — B48 a subscriber whose terminal_id was unknown compared ""
against "" and classified EVERY notification as its own write, ignoring all
invalidations (rule extracted to inventory_invalidation_target, outside the
cache-redis gate, so it is testable without a server); B49 RedisCache::connect
used the untimed get_connection(), so an unreachable-but-non-refusing
redis.url stalled terminal startup ~21s (Windows) before create_cache could
fall back (now CONNECT_TIMEOUT, shared with the pub/sub path); a poisoned conn
mutex silently turned every operation into a permanent no-op — including
invalidate_* and publish_negative_stock_event — while is_healthy() is sampled
once at startup and never polled (now reported by lock_or_report, which
REFUSES a poisoned guard rather than recovering it).
Still true: every Redis error degrades to miss/noop, the fail-safe direction;
no secrets in keys; the listener exits cleanly on its shutdown signal.
next: create_cache logs nothing when the feature is simply not compiled, so a
startup cache_healthy=false cannot be told apart from a dead server; the
pub/sub listener breaks permanently on its first non-timeout error with no
reconnect, and the returned Sender cannot tell its owner it died; neither is
reachable today — nothing calls start_inventory_pubsub or
publish_inventory_change.
perf: single mutex-guarded connection — one dead or slow connection serialises
every caller; reconnect and backoff need a real server to test.
*/
//!
//! Provides a [`Cache`] trait, a [`NoopCache`] fallback, and an optional
//! `RedisCache` implementation behind the `cache-redis` feature flag.

use std::sync::Arc;

use crate::db::ProductWithDetails;

/// A key-value cache for frequently-accessed POS data.
pub trait Cache: Send + Sync {
    /// Get a cached product by SKU. Returns `None` on miss.
    fn get_product(&self, sku: &str) -> Option<ProductWithDetails>;
    /// Set a cached product with the configured TTL.
    fn set_product(&self, sku: &str, product: &ProductWithDetails);
    /// Invalidate a cached product.
    fn invalidate_product(&self, sku: &str);

    /// Get cached inventory quantity for a product.
    fn get_inventory(&self, product_id: &str) -> Option<i64>;
    /// Set a cached inventory quantity.
    fn set_inventory(&self, product_id: &str, qty: i64);
    /// Invalidate cached inventory for a product.
    fn invalidate_inventory(&self, product_id: &str);

    /// Returns `true` when the cache backend is connected and healthy.
    fn is_healthy(&self) -> bool;

    /// Start a background listener for inventory change notifications.
    ///
    /// `terminal_id` identifies this terminal for pub/sub filtering —
    /// the subscriber will skip messages tagged with its own terminal_id.
    /// Pass `None` if terminal identity is unknown (all messages will
    /// be processed).
    ///
    /// Returns a shutdown sender that can be used to stop the listener.
    /// Returns `None` when the backend does not support pub/sub (e.g.
    /// no-op cache). The `_cache` Arc is passed through so the spawned
    /// thread can hold a reference to the cache for invalidation.
    fn start_inventory_pubsub(
        &self,
        _cache: Arc<dyn Cache>,
        _terminal_id: Option<String>,
    ) -> Option<std::sync::mpsc::Sender<()>> {
        let _ = (_cache, _terminal_id);
        None
    }

    /// Publish an inventory change notification.
    ///
    /// `terminal_id` identifies this terminal so other subscribers can
    /// skip their own messages. Called after stock adjustments.
    /// Default impl is a no-op; `RedisCache` overrides this to publish
    /// to `inventory:updates`.
    fn publish_inventory_change(
        &self,
        _product_id: &str,
        _sku: &str,
        _new_qty: i64,
        _terminal_id: Option<&str>,
    ) {
    }

    /// Publish a `stock.negative` warning event (ADR-18 §4).
    ///
    /// Called when `allow_negative_stock` is enabled on a location and
    /// a stock adjustment results in negative quantity. The payload
    /// includes `{ product_id, sku, location_id, delta, current_qty, terminal_id, timestamp }`.
    /// Default impl is a no-op; `RedisCache` overrides this to publish
    /// to `stock:negative`.
    fn publish_negative_stock_event(
        &self,
        _product_id: &str,
        _sku: &str,
        _location_id: &str,
        _delta: i64,
        _current_qty: i64,
        _terminal_id: Option<&str>,
    ) {
    }
}

/// No-op cache that always misses.
///
/// Used as the default fallback when Redis is unavailable or the
/// `cache-redis` feature is disabled.
pub struct NoopCache;

impl Cache for NoopCache {
    fn get_product(&self, _sku: &str) -> Option<ProductWithDetails> {
        None
    }
    fn set_product(&self, _sku: &str, _product: &ProductWithDetails) {}
    fn invalidate_product(&self, _sku: &str) {}
    fn get_inventory(&self, _product_id: &str) -> Option<i64> {
        None
    }
    fn set_inventory(&self, _product_id: &str, _qty: i64) {}
    fn invalidate_inventory(&self, _product_id: &str) {}
    fn is_healthy(&self) -> bool {
        false
    }
    fn start_inventory_pubsub(
        &self,
        _cache: Arc<dyn Cache>,
        _terminal_id: Option<String>,
    ) -> Option<std::sync::mpsc::Sender<()>> {
        let _ = (_cache, _terminal_id);
        None
    }

    fn publish_negative_stock_event(
        &self,
        _product_id: &str,
        _sku: &str,
        _location_id: &str,
        _delta: i64,
        _current_qty: i64,
        _terminal_id: Option<&str>,
    ) {
    }
}

/// Redis-backed cache implementation.
///
/// Connects to a Redis instance and stores values as JSON strings with
/// a configurable TTL. Only available when the `cache-redis` feature is
/// enabled.
#[cfg(feature = "cache-redis")]
pub mod redis_cache {
    use std::sync::{Arc, Mutex};

    use super::Cache;
    use crate::db::ProductWithDetails;

    /// Redis-backed cache.
    pub struct RedisCache {
        #[allow(dead_code)]
        client: redis::Client,
        conn: Mutex<redis::Connection>,
        ttl_seconds: u64,
    }

    /// Longest we will wait for a Redis connection.
    ///
    /// Both users of this live on paths where blocking for the OS TCP
    /// default is worse than failing and degrading: `connect()` runs
    /// during terminal startup against the user-editable `redis.url`
    /// setting, and the pub/sub listener must keep polling its shutdown
    /// channel. Shared so the two cannot drift apart.
    const CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

    impl RedisCache {
        /// Connect to a Redis instance at the given URL.
        ///
        /// The attempt is bounded by [`CONNECT_TIMEOUT`]. An
        /// unreachable-but-non-refusing host (firewalled, VLAN ACL,
        /// reassigned DHCP address) would otherwise stall the caller for
        /// the OS TCP connect default — measured ~21s on Windows, up to
        /// ~2min on Linux — before `create_cache` could fall back.
        ///
        /// # Errors
        ///
        /// Returns a `RedisError` when the URL is invalid or the
        /// connection cannot be established within [`CONNECT_TIMEOUT`].
        pub fn connect(url: &str, ttl_seconds: u64) -> Result<Self, redis::RedisError> {
            let client = redis::Client::open(url)?;
            let conn = client.get_connection_with_timeout(CONNECT_TIMEOUT)?;
            Ok(Self {
                client,
                conn: Mutex::new(conn),
                ttl_seconds,
            })
        }

        /// Subscribe to the inventory change channel and invalidate local cache
        /// entries when remote updates arrive.
        ///
        /// Spawns a background task that listens on `inventory:updates` and
        /// calls `invalidate_inventory` for each received notification.
        /// The returned `std::sync::mpsc::Sender` can be used to stop the
        /// subscription (drop it or send a value).
        ///
        /// A read timeout of 5 seconds is set on the underlying TCP connection
        /// so the shutdown signal is checked at least every 5 seconds even when
        /// no messages are being published.
        fn subscribe_inventory_changes(
            client: redis::Client,
            cache: Arc<dyn Cache>,
            terminal_id: Option<String>,
        ) -> Result<std::sync::mpsc::Sender<()>, redis::RedisError> {
            let (tx, rx) = std::sync::mpsc::channel::<()>();

            // Spawn a blocking task since `redis` crate connections are synchronous.
            // `redis::Client` is `Clone` (wraps an Arc internally), so we can cheaply
            // share it with the spawned thread.
            std::thread::spawn(move || {
                // Connect with a bounded timeout so the shutdown signal can
                // be checked regularly even when no messages arrive, and so
                // a dead Redis cannot strand this thread in connect.
                let mut conn = match client.get_connection_with_timeout(CONNECT_TIMEOUT) {
                    Ok(c) => c,
                    Err(e) => {
                        tracing::error!(
                            error = %e,
                            "failed to connect for inventory pub/sub"
                        );
                        return;
                    }
                };

                // Set read timeout on the TCP stream so `get_message()` unblocks.
                let _ = conn.set_read_timeout(Some(std::time::Duration::from_secs(5)));

                let mut pubsub = conn.as_pubsub();

                if let Err(e) = pubsub.subscribe("inventory:updates") {
                    tracing::error!(error = %e, "failed to subscribe to inventory:updates");
                    return;
                }

                tracing::info!("subscribed to inventory:updates channel");

                let own_id = terminal_id.unwrap_or_default();
                loop {
                    // Check if we should stop (non-blocking check).
                    if rx.try_recv().is_ok() {
                        tracing::info!("inventory pub/sub shutting down");
                        let _ = pubsub.unsubscribe("inventory:updates");
                        return;
                    }

                    match pubsub.get_message() {
                        Ok(msg) => {
                            let payload: String = msg.get_payload().unwrap_or_default();
                            if let Some(pid) =
                                super::inventory_invalidation_target(&payload, &own_id)
                            {
                                cache.invalidate_inventory(&pid);
                                tracing::debug!(
                                    product_id = %pid,
                                    "invalidated inventory cache from pub/sub"
                                );
                            }
                        }
                        Err(e) => {
                            // Timeouts are expected when no messages arrive.
                            // Other errors (connection lost) terminate the loop.
                            let err_str = e.to_string();
                            if err_str.contains("timed out") || err_str.contains("timeout") {
                                continue;
                            }
                            tracing::warn!(error = %e, "inventory pub/sub error");
                            break;
                        }
                    }
                }
            });

            Ok(tx)
        }
    }

    impl Cache for RedisCache {
        fn get_product(&self, sku: &str) -> Option<ProductWithDetails> {
            let key = format!("product:{sku}");
            let mut conn = super::lock_or_report(self.conn.lock(), "get_product")?;
            let data: Option<String> = redis::cmd("GET").arg(&key).query(&mut *conn).ok()?;
            data.and_then(|s| serde_json::from_str(&s).ok())
        }

        fn set_product(&self, sku: &str, product: &ProductWithDetails) {
            let key = format!("product:{sku}");
            let Ok(data) = serde_json::to_string(product) else {
                return;
            };
            let Some(mut conn) = super::lock_or_report(self.conn.lock(), "set_product") else {
                return;
            };
            let _: Result<(), _> = redis::cmd("SETEX")
                .arg(&key)
                .arg(self.ttl_seconds)
                .arg(&data)
                .query(&mut *conn);
        }

        fn invalidate_product(&self, sku: &str) {
            let key = format!("product:{sku}");
            let Some(mut conn) = super::lock_or_report(self.conn.lock(), "invalidate_product")
            else {
                return;
            };
            let _: Result<(), _> = redis::cmd("DEL").arg(&key).query(&mut *conn);
        }

        fn get_inventory(&self, product_id: &str) -> Option<i64> {
            let key = format!("inventory:{product_id}");
            let mut conn = super::lock_or_report(self.conn.lock(), "get_inventory")?;
            redis::cmd("GET").arg(&key).query(&mut *conn).ok()
        }

        fn set_inventory(&self, product_id: &str, qty: i64) {
            let key = format!("inventory:{product_id}");
            let Some(mut conn) = super::lock_or_report(self.conn.lock(), "set_inventory") else {
                return;
            };
            let _: Result<(), _> = redis::cmd("SETEX")
                .arg(&key)
                .arg(self.ttl_seconds)
                .arg(qty)
                .query(&mut *conn);
        }

        fn invalidate_inventory(&self, product_id: &str) {
            let key = format!("inventory:{product_id}");
            let Some(mut conn) = super::lock_or_report(self.conn.lock(), "invalidate_inventory")
            else {
                return;
            };
            let _: Result<(), _> = redis::cmd("DEL").arg(&key).query(&mut *conn);
        }

        fn is_healthy(&self) -> bool {
            let Some(mut conn) = super::lock_or_report(self.conn.lock(), "is_healthy") else {
                return false;
            };
            redis::cmd("PING").query::<String>(&mut *conn).is_ok()
        }

        fn start_inventory_pubsub(
            &self,
            cache: Arc<dyn Cache>,
            terminal_id: Option<String>,
        ) -> Option<std::sync::mpsc::Sender<()>> {
            let client = self.client.clone();
            match Self::subscribe_inventory_changes(client, cache, terminal_id) {
                Ok(tx) => Some(tx),
                Err(e) => {
                    tracing::warn!(
                        error = %e,
                        "failed to start inventory pub/sub subscription"
                    );
                    None
                }
            }
        }

        fn publish_inventory_change(
            &self,
            product_id: &str,
            sku: &str,
            new_qty: i64,
            terminal_id: Option<&str>,
        ) {
            let key = "inventory:updates";
            let payload = serde_json::json!({
                "product_id": product_id,
                "sku": sku,
                "new_qty": new_qty,
                "terminal_id": terminal_id.unwrap_or(""),
                "timestamp": chrono::Utc::now().to_rfc3339_opts(
                    chrono::SecondsFormat::Millis, true,
                ),
            });
            let Ok(msg) = serde_json::to_string(&payload) else {
                return;
            };
            let Some(mut conn) =
                super::lock_or_report(self.conn.lock(), "publish_inventory_change")
            else {
                return;
            };
            let _: Result<(), _> = redis::cmd("PUBLISH").arg(key).arg(&msg).query(&mut *conn);
        }

        fn publish_negative_stock_event(
            &self,
            product_id: &str,
            sku: &str,
            location_id: &str,
            delta: i64,
            current_qty: i64,
            terminal_id: Option<&str>,
        ) {
            let key = "stock:negative";
            let payload = serde_json::json!({
                "product_id": product_id,
                "sku": sku,
                "location_id": location_id,
                "delta": delta,
                "current_qty": current_qty,
                "terminal_id": terminal_id.unwrap_or(""),
                "timestamp": chrono::Utc::now().to_rfc3339_opts(
                    chrono::SecondsFormat::Millis, true,
                ),
            });
            let Ok(msg) = serde_json::to_string(&payload) else {
                return;
            };
            let Some(mut conn) =
                super::lock_or_report(self.conn.lock(), "publish_negative_stock_event")
            else {
                return;
            };
            let _: Result<(), _> = redis::cmd("PUBLISH").arg(key).arg(&msg).query(&mut *conn);
        }
    }
}

/// Borrow the shared Redis connection, refusing it if the lock is poisoned.
///
/// `Some(guard)` when the mutex is healthy; `None` when a previous holder
/// panicked, with the fact logged at error level instead of swallowed.
///
/// The deliberate choice is NOT to recover the guard via
/// `PoisonError::into_inner()`. Every critical section here sits around a
/// request/response exchange, so a panic between sending a RESP command
/// and reading its reply can leave the socket mid-conversation. Handing
/// that connection to the next caller makes it read a reply meant for
/// someone else — turning a cache miss into a *wrong cache hit*, which is
/// the one outcome a cache must not produce. Refusing the lock degrades
/// to a miss, the fail-safe direction.
///
/// The cost of refusing is that poisoning is permanent, so it must never
/// be silent: without the log a terminal quietly stops invalidating
/// products, stops publishing negative-stock warnings, and serves stale
/// rows until the TTL, while `is_healthy()` — sampled exactly once at
/// startup (`apps/desktop-client/src/state.rs:331`) and never polled —
/// keeps reporting whatever it saw at boot.
///
/// Lives outside the `cache-redis` gate: it is generic over the guard, so
/// the policy is testable with a plain `Mutex<i32>` and no Redis. That also
/// means its only production caller (`RedisCache`) is compiled out in a
/// default build, where the tests are the sole user — hence the conditional
/// `allow`, rather than gating the function and losing the coverage.
#[cfg_attr(not(feature = "cache-redis"), allow(dead_code))]
pub(crate) fn lock_or_report<T>(
    result: Result<T, std::sync::PoisonError<T>>,
    operation: &str,
) -> Option<T> {
    match result {
        Ok(guard) => Some(guard),
        Err(_) => {
            tracing::error!(
                operation,
                "Redis connection lock is poisoned; this operation is being \
                 skipped and the cache will stay degraded until the process restarts"
            );
            None
        }
    }
}

/// Decide what one `inventory:updates` pub/sub notification means for the
/// local cache: `Some(product_id)` to invalidate, `None` to ignore.
///
/// Deliberately lives OUTSIDE the `cache-redis` gate: the filtering rules
/// are pure, and extracting them is what makes the subscriber — which
/// otherwise needs a live Redis plus a background thread — testable at
/// all. `RedisCache`'s listener thread is the only caller.
///
/// Because that only caller is gated, the function is dead code in a default
/// build and the tests are its sole user. The conditional `allow` keeps the
/// coverage without gating the function itself, and without silencing the
/// warning in the configuration where it would actually mean something.
///
/// `own_terminal_id` is this terminal's identity, `""` when unknown;
/// messages carrying the same non-empty id are our own writes and must not
/// bounce back as invalidations.
#[cfg_attr(not(feature = "cache-redis"), allow(dead_code))]
pub(crate) fn inventory_invalidation_target(
    payload: &str,
    own_terminal_id: &str,
) -> Option<String> {
    let notification: serde_json::Value = serde_json::from_str(payload).ok()?;
    let msg_terminal_id = notification["terminal_id"].as_str().unwrap_or("");
    // Skip our own messages — but only when we actually HAVE an identity
    // to compare. publish_inventory_change() writes "" for an unknown
    // remote terminal and a None local terminal_id also arrives as "", so
    // treating "" == "" as "our own write" made a terminal with unknown
    // identity ignore EVERY notification and serve stale inventory until
    // the TTL (B48). The trait documents the opposite: "Pass None if
    // terminal identity is unknown (all messages will be processed)."
    if !own_terminal_id.is_empty() && own_terminal_id == msg_terminal_id {
        return None;
    }
    notification["product_id"].as_str().map(str::to_owned)
}

/// Create a cache, attempting Redis first and falling back to no-op.
///
/// When the `cache-redis` feature is enabled, tries to connect to the
/// given Redis URL. On success, returns a `RedisCache`; on failure
/// logs a warning and returns [`NoopCache`]. When the feature is
/// disabled, always returns [`NoopCache`].
#[cfg_attr(not(feature = "cache-redis"), allow(unused_variables))]
pub fn create_cache(redis_url: &str, ttl_seconds: u64) -> Arc<dyn Cache> {
    #[cfg(feature = "cache-redis")]
    {
        match redis_cache::RedisCache::connect(redis_url, ttl_seconds) {
            Ok(cache) => return Arc::new(cache),
            Err(e) => tracing::warn!(error = %e, "Redis unavailable, using noop cache"),
        }
    }
    Arc::new(NoopCache)
}

#[cfg(test)]
#[path = "cache_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "cache_create_tests.rs"]
mod create_tests;

#[cfg(test)]
#[path = "cache_lock_tests.rs"]
mod lock_tests;

#[cfg(test)]
#[path = "cache_pubsub_tests.rs"]
mod pubsub_tests;
