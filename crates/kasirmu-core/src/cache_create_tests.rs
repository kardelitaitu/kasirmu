//! Contract tests for [`create_cache`]'s fallback path.
//!
//! `create_cache` is the only cache code that runs on EVERY build: the
//! `RedisCache` behind it needs a server, but the decision to fall back
//! to [`NoopCache`] happens at startup on real terminals, driven by the
//! user-editable `redis.url` setting
//! (`apps/desktop-client/src/state.rs` -> `platform_startup::init_cache`).
//!
//! These tests deliberately use addresses that need no infrastructure:
//! a refused port (127.0.0.1:1) and RFC 5737 TEST-NET-1 (192.0.2.1),
//! which is reserved and must never be routed, so it black-holes exactly
//! like the firewalled host an operator can accidentally configure.

use super::*;

#[cfg(feature = "cache-redis")]
#[test]
fn create_cache_bounds_its_connect_when_redis_is_unreachable() {
    use std::time::{Duration, Instant};

    // B49: RedisCache::connect used the UNTIMED get_connection(), so a
    // host that accepts no SYN and sends no RST (firewalled, VLAN ACL,
    // DHCP reassignment) blocked the caller for the OS TCP default —
    // measured at ~21s on Windows and up to ~2min on Linux — on the
    // startup path. The same file already uses
    // get_connection_with_timeout for pub/sub, so the bound is known
    // to be the right tool here.
    let started = Instant::now();
    let cache = create_cache("redis://192.0.2.1:6379/", 60);
    let elapsed = started.elapsed();

    assert!(
        !cache.is_healthy(),
        "an unreachable Redis must degrade to the noop cache"
    );
    assert!(
        elapsed < Duration::from_secs(10),
        "create_cache blocked for {elapsed:?}; the connect must be bounded \
         so a bad redis.url cannot stall terminal startup"
    );
}

#[test]
fn create_cache_falls_back_when_the_port_is_refused() {
    // The common misconfiguration: nothing listening at all. A refused
    // connection fails fast, so this pins the fallback itself rather
    // than the timeout.
    let cache = create_cache("redis://127.0.0.1:1/", 60);
    assert!(
        !cache.is_healthy(),
        "a refused connection must not be reported as healthy"
    );
}

#[test]
fn the_fallback_cache_still_satisfies_the_trait_contract() {
    // Whatever the reason for falling back, callers keep the guarantee
    // they rely on: reads miss, writes are inert, pub/sub is declined,
    // and nothing panics on a POS hot path.
    let cache = create_cache("redis://127.0.0.1:1/", 60);

    assert!(cache.get_product("SKU-1").is_none());
    assert!(cache.get_inventory("p-1").is_none());
    cache.set_inventory("p-1", 5);
    cache.invalidate_inventory("p-1");
    cache.invalidate_product("SKU-1");
    cache.publish_inventory_change("p-1", "SKU-1", 5, Some("T1"));
    cache.publish_negative_stock_event("p-1", "SKU-1", "loc-1", -1, -1, Some("T1"));
    assert!(
        cache
            .start_inventory_pubsub(Arc::new(NoopCache), Some("T1".to_string()))
            .is_none(),
        "a fallback cache must decline pub/sub rather than spawn a dead listener"
    );
    assert!(!cache.is_healthy());
}
