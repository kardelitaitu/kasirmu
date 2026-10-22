//! Tests for `redis_backend.rs` — key derivation, Lua source, and the
//! fallback contract (connection refusal → `Ok(None)` → in-process).
//!
//! Integration tests that require a live Redis are gated behind the
//! `OZ_TEST_REDIS_URL` environment variable (mirroring the PG integration
//! tests' `OZ_TEST_PG_URL` pattern): they skip when Redis is unavailable.
//!
//! # What runs without a server (O-T14)
//!
//! The default `cargo test -p kasirmu-cloud --bin kasirmu-cloud` run needs no
//! Redis at all. `test_backend()` below reads `OZ_TEST_REDIS_URL`, returns
//! `None` when it is unset, and every integration test returns early on that
//! `None` — so the three integration tests EXECUTE in the default run and
//! take their skip branch. They used to carry `#[ignore]`, which made them
//! invisible no-ops; the attribute is gone because `test_backend()` already
//! performs the gating, and a test that runs-and-skips is honest where an
//! ignored one is not.
//!
//! # What needs `OZ_TEST_REDIS_URL`
//!
//! Everything below `test_backend()`: the snapshot round trip, the rate
//! limiter burst, and the TTL expiry. Point `OZ_TEST_REDIS_URL` at any
//! reachable Redis/Valkey and all three run for real.
//!
//! # Why TTL/expiry cannot be tested without a server
//!
//! `RedisBackend::snapshot_set` issues `SETEX` (server-side expiry) and
//! `snapshot_get` issues a plain `GET` that honours whatever the server has
//! already thrown away (`redis_backend.rs:192-205`, `redis_backend.rs:160-170`).
//! The expiry therefore lives entirely in Redis; this crate never compares a
//! timestamp against a TTL on that path. The one TTL check the repo owns is
//! the in-process cache in `sync_api.rs` (`generated_at.elapsed() <
//! SNAPSHOT_CACHE_TTL_SECS`), and it is covered separately by
//! `sync_api_tests.rs` via back-dated entries. A fake Redis here would assert
//! only that the fake expires its own map — a test of the fake, not of the
//! product — so the integration test below is the only honest way to cover it.
//
// One leg still carries `#[ignore]`: `connect_returns_none_when_refused`
// (`--ignored` to run it), which waits out a real connection timeout.

use super::*;

use std::time::{Duration, Instant};

// ── Pure helpers ─────────────────────────────────────────────────────

#[test]
fn snapshot_keys_are_namespaced_per_tenant() {
    assert_eq!(snapshot_version_key("t1"), "oz:snapshot:t1:ver");
    assert_eq!(snapshot_data_key("t1"), "oz:snapshot:t1:data");
    // Tenants must not collide.
    assert_ne!(snapshot_version_key("t1"), snapshot_version_key("t2"));
    assert_ne!(snapshot_data_key("t1"), snapshot_data_key("t2"));
    // Version and data keys for the same tenant are distinct.
    assert_ne!(snapshot_version_key("t1"), snapshot_data_key("t1"));
}

#[test]
fn lua_source_is_non_empty_and_contains_key_operations() {
    let src = token_bucket_lua_source();
    assert!(!src.is_empty(), "Lua source must not be empty");
    // The script must use Redis Hash ops and EXPIRE.
    assert!(src.contains("HGET"), "script must read the bucket hash");
    assert!(src.contains("HSET"), "script must write the bucket hash");
    assert!(src.contains("EXPIRE"), "script must set a TTL");
    assert!(
        src.contains("math.min"),
        "script must cap refill at capacity"
    );
    // Both outcome shapes are returned.
    assert!(src.contains("{1, 0}"), "allowed outcome must be {{1, 0}}");
    assert!(
        src.contains("{0, retry_after}"),
        "denied outcome must include retry_after"
    );
}

#[test]
fn rate_limit_key_is_namespaced() {
    assert_eq!(RedisBackend::rate_limit_key("a|b"), "oz:rate_limit:a|b");
}

// ── Connection fallback contract ────────────────────────────────────

#[tokio::test]
async fn connect_rejects_malformed_url() {
    // A URL that cannot even be parsed is a configuration error → Err,
    // NOT a silent fallback.
    let result = RedisBackend::connect("not a url").await;
    assert!(result.is_err(), "malformed URL must surface as an error");
}

#[tokio::test]
#[ignore = "hangs: see the timing note in this test"]
async fn connect_returns_none_when_refused() {
    // Point at a port that is (almost certainly) not listening. The
    // connection manager will retry, so this can take a moment — the
    // contract is `Ok(None)` (fall back to in-process), never a panic.
    let url = "redis://127.0.0.1:1";
    match RedisBackend::connect(url).await {
        Ok(None) => {} // expected fallback path
        Ok(Some(_)) => {
            // Something is actually listening on port 1 — treat as success.
        }
        Err(e) => panic!("refused connection must not return Err: {e}"),
    }
}

// ── Integration (gated on OZ_TEST_REDIS_URL) ────────────────────────

/// Upper bound the TTL test will wait for Redis to drop a 1 s SETEX key.
///
/// Generous on purpose: the assertion is about the server honouring the TTL,
/// not about this machine's scheduler. It exists so a server that never
/// expires the key fails the test with a named message instead of hanging.
const TTL_EXPIRY_BOUND: Duration = Duration::from_secs(10);

/// Gap between polls for the expired key — well under the 1 s TTL so the
/// test notices expiry promptly and stops waiting.
const TTL_POLL_INTERVAL: Duration = Duration::from_millis(50);

async fn test_backend() -> Option<RedisBackend> {
    let Ok(url) = std::env::var("OZ_TEST_REDIS_URL") else {
        return None;
    };
    match RedisBackend::connect(&url).await {
        Ok(Some(b)) => Some(b),
        Ok(None) => {
            eprintln!("Redis integration test skipped: no server at {url}");
            None
        }
        Err(e) => {
            eprintln!("Redis integration test skipped: {e}");
            None
        }
    }
}

#[tokio::test]
async fn integration_snapshot_roundtrip() {
    let Some(backend) = test_backend().await else {
        return;
    };
    let tenant = format!("t-{}", uuid::Uuid::now_v7());
    // Use a key-scoped DB index so we don't collide with real data.

    // Miss before store.
    assert_eq!(backend.snapshot_get(&tenant).await.unwrap(), None);

    // Store + hit.
    backend
        .snapshot_set(&tenant, "v7", b"{\"products\":[]}", 30)
        .await
        .unwrap();
    let (version, bytes) = backend.snapshot_get(&tenant).await.unwrap().unwrap();
    assert_eq!(version, "v7");
    assert_eq!(bytes, b"{\"products\":[]}");

    // Overwrite.
    backend
        .snapshot_set(&tenant, "v8", b"{\"products\":[1]}", 30)
        .await
        .unwrap();
    let (version, bytes) = backend.snapshot_get(&tenant).await.unwrap().unwrap();
    assert_eq!(version, "v8");
    assert_eq!(bytes, b"{\"products\":[1]}");
}

#[tokio::test]
async fn integration_rate_limit_allows_then_denies() {
    let Some(backend) = test_backend().await else {
        return;
    };
    let key = format!("it-{}", uuid::Uuid::now_v7());
    // Capacity 2, refill 2/sec — the burst of 2 is allowed, the third is not.
    assert_eq!(backend.check_rate_limit(&key, 2, 2.0).await.unwrap(), None);
    assert_eq!(backend.check_rate_limit(&key, 2, 2.0).await.unwrap(), None);
    let denied = backend.check_rate_limit(&key, 2, 2.0).await.unwrap();
    assert!(denied.is_some(), "third consume must be denied");
}

#[tokio::test]
async fn integration_snapshot_ttl_expires() {
    let Some(backend) = test_backend().await else {
        return;
    };
    let tenant = format!("ttl-{}", uuid::Uuid::now_v7());
    backend.snapshot_set(&tenant, "v1", b"x", 1).await.unwrap();
    assert_eq!(
        backend.snapshot_get(&tenant).await.unwrap().unwrap().0,
        "v1"
    );

    // The 1s TTL is enforced by the SERVER (SETEX), so this test has to wait
    // for real — a fake clock would change nothing, because nothing in this
    // crate reads a clock on this path. Poll instead of sleeping a fixed 2s:
    // the loop returns the moment Redis drops the key (typically on the first
    // poll after the second ticks over) instead of always paying the full
    // nap, and it states its own bound in the failure message below.
    let deadline = Instant::now() + TTL_EXPIRY_BOUND;
    let mut polls = 0u32;
    loop {
        if backend.snapshot_get(&tenant).await.unwrap().is_none() {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "entry did not expire within {TTL_EXPIRY_BOUND:?} (1s SETEX TTL); \
             the server is not honouring the TTL this backend sets"
        );
        polls += 1;
        tokio::time::sleep(TTL_POLL_INTERVAL).await;
    }
    // `polls > 0` is part of the contract, not bookkeeping: a zero-TTL SETEX
    // would delete the key before the first read even ran, and the expiry
    // assertion above would then pass for the wrong reason.
    assert!(
        polls > 0,
        "the entry vanished before the first poll — TTL not applied at all"
    );
}
