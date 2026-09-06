use super::*;
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use std::collections::HashMap;
use tower::ServiceExt;

fn fresh_db() -> Connection {
    oz_core::migrations::fresh_db()
}

/// Create a test JWT token scoped to the given tenant.
fn test_token(tenant_id: Option<&str>) -> String {
    oz_api::auth::create_token("test", Some(24), tenant_id, None)
        .unwrap()
        .token
}

/// Helper: build an authorized request builder with a Bearer token.
fn authed(method: axum::http::Method, uri: &str, tenant_id: Option<&str>) -> Request<Body> {
    let token = test_token(tenant_id);
    Request::builder()
        .method(method)
        .uri(uri)
        .header("Authorization", format!("Bearer {token}"))
        .header("Content-Type", "application/json")
        .body(Body::empty())
        .unwrap()
}

/// Helper: build an authorized POST request with a JSON body.
fn authed_post(uri: &str, body: &str, tenant_id: Option<&str>) -> Request<Body> {
    let token = test_token(tenant_id);
    Request::builder()
        .method("POST")
        .uri(uri)
        .header("Authorization", format!("Bearer {token}"))
        .header("Content-Type", "application/json")
        .body(Body::from(body.to_owned()))
        .unwrap()
}

fn test_router() -> Router {
    let state = SyncState {
        db: Arc::new(Mutex::new(fresh_db())),
        snapshot_cache: Arc::new(Mutex::new(HashMap::new())),
        rate_limiter: RateLimiterState::new(),
        pg: None,
        skip_push_validation: false,
        tenant_count_cache: TenantCountCache::default(),
    };
    sync_router(state, false)
}

fn test_router_with_state(state: SyncState) -> Router {
    sync_router(state, false)
}

/// Build a router with plan enforcement explicitly enabled/disabled,
/// avoiding the `OZ_ENFORCE_PLANS` env var (ADR sync-plan-gating).
fn test_router_with_plan_enforcement(enforce: bool) -> Router {
    let state = SyncState {
        db: Arc::new(Mutex::new(fresh_db())),
        snapshot_cache: Arc::new(Mutex::new(HashMap::new())),
        rate_limiter: RateLimiterState::new(),
        pg: None,
        skip_push_validation: false,
        tenant_count_cache: TenantCountCache::default(),
    };
    sync_router_with_plan_enforcement(state, enforce)
}

/// Seed a tenant plan in the test DB shared by the given router.
/// The router owns its DB, so this writes via the same migrations
/// connection the router was built from is not reachable; instead we
/// build the state first, seed it, then build the router around it.
/// Build a router whose test DB already has a plan row for `tenant`,
/// with enforcement explicitly enabled/disabled. Seeding happens before
/// the router is built so the handler sees the row.
async fn test_router_with_plan(tenant: &str, plan: &str, enforce: bool) -> Router {
    let state = SyncState {
        db: Arc::new(Mutex::new(fresh_db())),
        snapshot_cache: Arc::new(Mutex::new(HashMap::new())),
        rate_limiter: RateLimiterState::new(),
        pg: None,
        skip_push_validation: false,
        tenant_count_cache: TenantCountCache::default(),
    };
    {
        let conn = state.db.lock().await;
        oz_core::Store::new(&conn)
            .set_tenant_plan(
                tenant,
                if plan == "pro" {
                    oz_core::TenantPlan::Pro
                } else {
                    oz_core::TenantPlan::Free
                },
            )
            .unwrap();
    }
    sync_router_with_plan_enforcement(state, enforce)
}

// ── Auth enforcement ─────────────────────────────────────────────

#[tokio::test]
async fn push_rejects_without_auth() {
    let app = test_router();
    let req = Request::builder()
        .method("POST")
        .uri("/api/sync/push")
        .header("Content-Type", "application/json")
        .body(Body::from("[]"))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn pull_rejects_without_auth() {
    let app = test_router();
    let req = Request::builder()
        .method("POST")
        .uri("/api/sync/pull")
        .header("Content-Type", "application/json")
        .body(Body::from(r#"{"since":null}"#))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn status_rejects_without_auth() {
    let app = test_router();
    let req = Request::builder()
        .uri("/api/sync/status")
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn snapshot_rejects_without_auth() {
    let app = test_router();
    let req = Request::builder()
        .uri("/api/sync/snapshot")
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn snapshot_returns_data_with_auth() {
    let app = test_router();
    let req = authed(axum::http::Method::GET, "/api/sync/snapshot", None);
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body_bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap();
    assert!(json["products"].is_array());
    assert!(json["tax_rates"].is_array());
    assert!(json["users"].is_array());
}

#[tokio::test]
async fn snapshot_omits_pin_hash_entirely() {
    // SYNC-06: the snapshot contract must never export credential
    // verifier material. Even with a user seeded that HAS a pin_hash,
    // the serialised snapshot bytes must not contain the field.
    let state = SyncState {
        db: Arc::new(Mutex::new(fresh_db())),
        snapshot_cache: Arc::new(Mutex::new(HashMap::new())),
        rate_limiter: RateLimiterState::new(),
        pg: None,
        skip_push_validation: false,
        tenant_count_cache: TenantCountCache::default(),
    };
    let app = test_router_with_state(state.clone());

    {
        let conn = state.db.lock().await;
        conn.execute(
            "INSERT INTO roles (id, name, permissions) VALUES ('r-owner', 'Owner', '[]')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO users (id, username, pin_hash, display_name, role_id, tenant_id)
             VALUES ('user-secret', 'alice', 'SENSITIVE-HASH', 'Alice', 'r-owner', 'tenant-a')",
            [],
        )
        .unwrap();
    }

    let req = authed(
        axum::http::Method::GET,
        "/api/sync/snapshot",
        Some("tenant-a"),
    );
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body_bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let body_str = String::from_utf8(body_bytes.to_vec()).unwrap();

    // The raw wire bytes must not contain the sensitive field name NOR
    // the seeded hash value anywhere (users array or otherwise).
    assert!(
        !body_str.contains("pin_hash"),
        "snapshot must not contain pin_hash: {body_str}"
    );
    assert!(
        !body_str.contains("SENSITIVE-HASH"),
        "snapshot must not leak the seeded hash: {body_str}"
    );

    // But the non-secret metadata must still be present.
    let json: serde_json::Value = serde_json::from_str(&body_str).unwrap();
    assert_eq!(json["users"].as_array().unwrap().len(), 1);
    assert_eq!(json["users"][0]["username"], "alice");
    assert_eq!(json["users"][0]["display_name"], "Alice");
}

#[tokio::test]
async fn snapshot_query_failure_returns_500_not_empty_success() {
    // SYNC-09: a server-side snapshot query failure must never be
    // mistaken for a valid empty snapshot. Drop the products table to
    // force a query error and assert the handler returns a non-2xx
    // status with an error envelope.
    let state = SyncState {
        db: Arc::new(Mutex::new(fresh_db())),
        snapshot_cache: Arc::new(Mutex::new(HashMap::new())),
        rate_limiter: RateLimiterState::new(),
        pg: None,
        skip_push_validation: false,
        tenant_count_cache: TenantCountCache::default(),
    };
    let app = test_router_with_state(state.clone());

    {
        let conn = state.db.lock().await;
        conn.execute("DROP TABLE products", []).unwrap();
    }

    let req = authed(axum::http::Method::GET, "/api/sync/snapshot", None);
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::INTERNAL_SERVER_ERROR);

    let body_bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap();
    assert!(
        json["error"].is_string(),
        "error envelope must carry a message: {json}"
    );
}

#[tokio::test]
async fn snapshot_serves_store_id_when_present() {
    // The snapshot contract carries the migration 069/117 soft-scoping
    // column: a product tagged with a store_id must round-trip through
    // the handler so the client can import it scoped instead of into
    // the global catalog.
    let state = SyncState {
        db: Arc::new(Mutex::new(fresh_db())),
        snapshot_cache: Arc::new(Mutex::new(HashMap::new())),
        rate_limiter: RateLimiterState::new(),
        pg: None,
        skip_push_validation: false,
        tenant_count_cache: TenantCountCache::default(),
    };
    let app = test_router_with_state(state.clone());

    {
        let conn = state.db.lock().await;
        conn.execute(
            "INSERT INTO locations (id, name) VALUES ('store-a', 'Store A')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO products (id, sku, name, price_minor, currency, tenant_id, store_id)
             VALUES ('prod-a', 'SKU-A', 'Product A', 100, 'USD', 'tenant-a', 'store-a')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO products (id, sku, name, price_minor, currency, tenant_id)
             VALUES ('prod-g', 'SKU-G', 'Global', 200, 'USD', 'tenant-a')",
            [],
        )
        .unwrap();
    }

    let req = authed(
        axum::http::Method::GET,
        "/api/sync/snapshot",
        Some("tenant-a"),
    );
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body_bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap();

    let products = json["products"].as_array().unwrap();
    let scoped = products
        .iter()
        .find(|p| p["sku"] == "SKU-A")
        .expect("scoped product must be present");
    assert_eq!(
        scoped["store_id"], "store-a",
        "store-tagged product must carry its store_id in the snapshot"
    );
    let global = products
        .iter()
        .find(|p| p["sku"] == "SKU-G")
        .expect("global product must be present");
    assert!(
        global["store_id"].is_null(),
        "global product must carry a null store_id"
    );
}

#[tokio::test]
async fn snapshot_cache_hit_returns_200() {
    // After a successful snapshot, a second request within the TTL
    // must still return 200 (the cache path must return Ok), serve
    // application/json, and round-trip as the same JSON body — proving
    // the raw-bytes cache-hit path (SOTA finding C) is wire-compatible
    // with the original axum::Json response.
    let app = test_router();
    let req1 = authed(axum::http::Method::GET, "/api/sync/snapshot", None);
    let resp1 = app.clone().oneshot(req1).await.unwrap();
    assert_eq!(resp1.status(), StatusCode::OK);
    assert_eq!(
        resp1
            .headers()
            .get("content-type")
            .unwrap()
            .to_str()
            .unwrap(),
        "application/json"
    );
    let body1 = resp1.into_body().collect().await.unwrap().to_bytes();
    let json1: serde_json::Value = serde_json::from_slice(&body1).unwrap();

    // Second request hits the cache: same status, same content-type,
    // same JSON.
    let req2 = authed(axum::http::Method::GET, "/api/sync/snapshot", None);
    let resp2 = app.oneshot(req2).await.unwrap();
    assert_eq!(resp2.status(), StatusCode::OK);
    assert_eq!(
        resp2
            .headers()
            .get("content-type")
            .unwrap()
            .to_str()
            .unwrap(),
        "application/json"
    );
    let body2 = resp2.into_body().collect().await.unwrap().to_bytes();
    let json2: serde_json::Value = serde_json::from_slice(&body2).unwrap();
    assert_eq!(json1, json2, "cache hit must serve the identical JSON");
}

#[tokio::test]
async fn snapshot_returns_etag_and_handles_if_none_match_304() {
    let app = test_router();

    // 1. Initial snapshot request returns 200 OK with an ETag and Cache-Control
    let req1 = authed(axum::http::Method::GET, "/api/sync/snapshot", None);
    let resp1 = app.clone().oneshot(req1).await.unwrap();
    assert_eq!(resp1.status(), StatusCode::OK);
    let etag = resp1
        .headers()
        .get("etag")
        .expect("snapshot response must include ETag header")
        .to_str()
        .unwrap()
        .to_string();
    assert!(etag.starts_with('"') && etag.ends_with('"'));
    assert_eq!(
        resp1
            .headers()
            .get("cache-control")
            .unwrap()
            .to_str()
            .unwrap(),
        "public, max-age=60"
    );

    // 2. Request with matching If-None-Match returns 304 Not Modified with zero body
    let token = test_token(None);
    let req2 = Request::builder()
        .method("GET")
        .uri("/api/sync/snapshot")
        .header("Authorization", format!("Bearer {token}"))
        .header("If-None-Match", &etag)
        .body(Body::empty())
        .unwrap();

    let resp2 = app.clone().oneshot(req2).await.unwrap();
    assert_eq!(resp2.status(), StatusCode::NOT_MODIFIED);
    assert_eq!(
        resp2.headers().get("etag").unwrap().to_str().unwrap(),
        etag.as_str()
    );
    let body2 = resp2.into_body().collect().await.unwrap().to_bytes();
    assert!(body2.is_empty(), "304 response body must be empty");

    // 3. Request with non-matching If-None-Match returns 200 OK
    let req3 = Request::builder()
        .method("GET")
        .uri("/api/sync/snapshot")
        .header("Authorization", format!("Bearer {token}"))
        .header("If-None-Match", "\"non-matching-etag\"")
        .body(Body::empty())
        .unwrap();

    let resp3 = app.oneshot(req3).await.unwrap();
    assert_eq!(resp3.status(), StatusCode::OK);
}

/// A cache hit must serve the stored bytes with ZERO database access —
/// the whole point of the raw-bytes cache (SOTA finding C). Warm the
/// cache, then DELETE every product from the DB: a hit that touched the
/// DB would return the now-empty set, but the cache must return the
/// original snapshot.
#[tokio::test]
async fn snapshot_cache_hit_serves_without_db_access() {
    let state = SyncState {
        db: Arc::new(Mutex::new(fresh_db())),
        snapshot_cache: Arc::new(Mutex::new(HashMap::new())),
        rate_limiter: RateLimiterState::new(),
        pg: None,
        skip_push_validation: false,
        tenant_count_cache: TenantCountCache::default(),
    };
    let app = test_router_with_state(state.clone());

    // Seed a product for tenant-a so the snapshot has content.
    {
        let conn = state.db.lock().await;
        conn.execute(
            "INSERT INTO roles (id, name, permissions) VALUES ('r-cache', 'Owner', '[]')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO products (id, sku, name, price_minor, currency, tenant_id)
             VALUES ('prod-cache', 'SKU-CACHE', 'Cached', 100, 'USD', 'tenant-a')",
            [],
        )
        .unwrap();
    }

    // First request warms the cache with the product present.
    let req1 = authed(
        axum::http::Method::GET,
        "/api/sync/snapshot",
        Some("tenant-a"),
    );
    let resp1 = app.clone().oneshot(req1).await.unwrap();
    assert_eq!(resp1.status(), StatusCode::OK);
    let body1 = resp1.into_body().collect().await.unwrap().to_bytes();
    let json1: serde_json::Value = serde_json::from_slice(&body1).unwrap();
    assert_eq!(
        json1["products"].as_array().unwrap().len(),
        1,
        "warm snapshot must include the product"
    );

    // DELETE every product — the cache hit must NOT see this.
    {
        let conn = state.db.lock().await;
        conn.execute("DELETE FROM products", []).unwrap();
    }

    // Second request is a cache hit: must still return the product.
    let req2 = authed(
        axum::http::Method::GET,
        "/api/sync/snapshot",
        Some("tenant-a"),
    );
    let resp2 = app.oneshot(req2).await.unwrap();
    assert_eq!(resp2.status(), StatusCode::OK);
    let body2 = resp2.into_body().collect().await.unwrap().to_bytes();
    let json2: serde_json::Value = serde_json::from_slice(&body2).unwrap();
    assert_eq!(
        json2["products"].as_array().unwrap().len(),
        1,
        "cache hit must serve bytes with zero DB access"
    );
    assert_eq!(json1, json2);
}

/// The snapshot cache must evict expired entries — otherwise every
/// tenant that ever connects leaves a (Instant, Vec<u8>) entry forever,
/// an unbounded memory leak (Bug 1 — snapshot cache).
///
/// Seed 5 stale entries directly into the cache, then insert a fresh
/// one. The store must opportunistically prune the expired entries so
/// the cache does not grow unboundedly with tenant churn.
#[tokio::test]
async fn snapshot_cache_evicts_expired_entries_on_insert() {
    let state = SyncState {
        db: Arc::new(Mutex::new(fresh_db())),
        snapshot_cache: Arc::new(Mutex::new(HashMap::new())),
        rate_limiter: RateLimiterState::new(),
        pg: None,
        skip_push_validation: false,
        tenant_count_cache: TenantCountCache::default(),
    };

    // Seed 5 stale entries directly into the cache (expired past the
    // 900s TTL).
    {
        let mut cache = state.snapshot_cache.lock().await;
        for i in 0..5 {
            cache.insert(
                format!("stale-tenant-{i}"),
                Arc::new(tokio::sync::RwLock::new(Some(super::SnapshotData {
                    generated_at: std::time::Instant::now() - std::time::Duration::from_secs(1800),
                    version: String::new(),
                    bytes: b"{}".to_vec(),
                }))),
            );
        }
        assert_eq!(cache.len(), 5, "precondition: 5 stale entries");
    }

    // Seed a product so the miss path produces a real snapshot.
    {
        let conn = state.db.lock().await;
        conn.execute(
            "INSERT INTO roles (id, name, permissions) VALUES ('r-evic', 'Owner', '[]')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO products (id, sku, name, price_minor, currency, tenant_id)
             VALUES ('prod-evic', 'SKU-EVIC', 'EvictTest', 100, 'USD', 'fresh-tenant')",
            [],
        )
        .unwrap();
    }

    // A miss for a new tenant triggers a cache insert with opportunistic
    // eviction — the 5 stale entries must be gone.
    let app = test_router_with_state(state.clone());
    let req = authed(
        axum::http::Method::GET,
        "/api/sync/snapshot",
        Some("fresh-tenant"),
    );
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let cache = state.snapshot_cache.lock().await;
    assert_eq!(
        cache.len(),
        1,
        "stale entries must be evicted; only the fresh tenant's entry should remain, got {} entries",
        cache.len()
    );
    assert!(
        cache.contains_key("fresh-tenant"),
        "the fresh tenant's entry must be present"
    );
}

/// When the snapshot cache TTL expires, the next request must re-query
/// the DB and serve FRESH data. The cache entry's timestamp is
/// backdated directly (child module can reach the cache map) so no real
/// 15-minute wait is needed.
#[tokio::test]
async fn snapshot_cache_refetches_after_expiry() {
    let state = SyncState {
        db: Arc::new(Mutex::new(fresh_db())),
        snapshot_cache: Arc::new(Mutex::new(HashMap::new())),
        rate_limiter: RateLimiterState::new(),
        pg: None,
        skip_push_validation: false,
        tenant_count_cache: TenantCountCache::default(),
    };
    let app = test_router_with_state(state.clone());

    // Warm the cache (empty snapshot).
    let req1 = authed(
        axum::http::Method::GET,
        "/api/sync/snapshot",
        Some("tenant-a"),
    );
    let resp1 = app.clone().oneshot(req1).await.unwrap();
    assert_eq!(resp1.status(), StatusCode::OK);
    let body1 = resp1.into_body().collect().await.unwrap().to_bytes();
    let json1: serde_json::Value = serde_json::from_slice(&body1).unwrap();
    assert_eq!(json1["products"].as_array().unwrap().len(), 0);

    // Add a product to the DB, then backdate the cached entry beyond the
    // 900s TTL so the next request must treat it as stale.
    {
        let conn = state.db.lock().await;
        conn.execute(
            "INSERT INTO roles (id, name, permissions) VALUES ('r-expiry', 'Owner', '[]')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO products (id, sku, name, price_minor, currency, tenant_id)
             VALUES ('prod-expiry', 'SKU-EXPIRY', 'Fresh', 100, 'USD', 'tenant-a')",
            [],
        )
        .unwrap();
    }
    {
        let cache = state.snapshot_cache.lock().await;
        let entry = cache
            .get("tenant-a")
            .expect("cache must be warm after the first request");
        let mut guard = entry.write().await;
        if let Some(data) = guard.as_mut() {
            data.generated_at = std::time::Instant::now() - std::time::Duration::from_secs(1800);
        }
    }

    // The expired cache must be replaced by a fresh DB read.
    let req2 = authed(
        axum::http::Method::GET,
        "/api/sync/snapshot",
        Some("tenant-a"),
    );
    let resp2 = app.oneshot(req2).await.unwrap();
    assert_eq!(resp2.status(), StatusCode::OK);
    let body2 = resp2.into_body().collect().await.unwrap().to_bytes();
    let json2: serde_json::Value = serde_json::from_slice(&body2).unwrap();
    assert_eq!(
        json2["products"].as_array().unwrap().len(),
        1,
        "expired cache must re-query and see the fresh product"
    );
}

/// Version revalidation: a TTL-expired entry whose reference-data version
/// stamp is unchanged must serve the cached bytes WITHOUT a full 3-table
/// recompute.
///
/// Proof: warm the cache with a valid product, corrupt that product's
/// `price_minor` to a non-integer (SQLite TEXT affinity — exactly the
/// SYNC-10 class of row-decode failure), then backdate the entry past the
/// TTL. A revalidation path calls only the cheap `snapshot_version`
/// stamp (COUNT + MAX(updated_at) — both unaffected by the corruption),
/// sees the stamp is unchanged, and serves the cached bytes → 200 with
/// the product. A full recompute would instead hit `snapshot_all`, fail
/// to decode the corrupt row, and return 500.
#[tokio::test]
async fn snapshot_cache_version_revalidation_skips_recompute_when_unchanged() {
    let state = SyncState {
        db: Arc::new(Mutex::new(fresh_db())),
        snapshot_cache: Arc::new(Mutex::new(HashMap::new())),
        rate_limiter: RateLimiterState::new(),
        pg: None,
        skip_push_validation: false,
        tenant_count_cache: TenantCountCache::default(),
    };
    let app = test_router_with_state(state.clone());

    // Seed one valid product so the warm snapshot has content.
    {
        let conn = state.db.lock().await;
        conn.execute(
            "INSERT INTO roles (id, name, permissions) VALUES ('r-reval', 'Owner', '[]')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO products (id, sku, name, price_minor, currency, tenant_id)
             VALUES ('prod-reval', 'SKU-REVAL', 'Revalidated', 100, 'USD', 'tenant-a')",
            [],
        )
        .unwrap();
    }

    // Warm the cache (snapshot has 1 product).
    let req1 = authed(
        axum::http::Method::GET,
        "/api/sync/snapshot",
        Some("tenant-a"),
    );
    let resp1 = app.clone().oneshot(req1).await.unwrap();
    assert_eq!(resp1.status(), StatusCode::OK);

    // Corrupt the product row (price_minor → non-numeric TEXT) WITHOUT
    // touching updated_at or the row count, so the version stamp is
    // unchanged but a full snapshot_all would fail to decode.
    {
        let conn = state.db.lock().await;
        conn.execute(
            "UPDATE products SET price_minor = 'not-an-int' WHERE id = 'prod-reval'",
            [],
        )
        .unwrap();
    }

    // Backdate the cached entry beyond the 900s TTL.
    {
        let cache = state.snapshot_cache.lock().await;
        let entry = cache
            .get("tenant-a")
            .expect("cache must be warm after the first request");
        let mut guard = entry.write().await;
        if let Some(data) = guard.as_mut() {
            data.generated_at = std::time::Instant::now() - std::time::Duration::from_secs(1800);
        }
    }

    // The revalidation path must serve the cached bytes (200, product
    // present) rather than recomputing and failing to decode (500).
    let req2 = authed(
        axum::http::Method::GET,
        "/api/sync/snapshot",
        Some("tenant-a"),
    );
    let resp2 = app.clone().oneshot(req2).await.unwrap();
    assert_eq!(
        resp2.status(),
        StatusCode::OK,
        "unchanged version must serve cached bytes, not fail on the corrupt row"
    );
    let body2 = resp2.into_body().collect().await.unwrap().to_bytes();
    let json2: serde_json::Value = serde_json::from_slice(&body2).unwrap();
    assert_eq!(
        json2["products"].as_array().unwrap().len(),
        1,
        "cached bytes must still include the product"
    );

    // A version change (row count bump) MUST invalidate: add a second
    // product, backdate again, and the next request must recompute and
    // see BOTH products (the corruption is cleaned by a fresh decode of
    // the whole snapshot — the new product is valid).
    {
        let conn = state.db.lock().await;
        conn.execute(
            "UPDATE products SET price_minor = 100, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
             WHERE id = 'prod-reval'",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO products (id, sku, name, price_minor, currency, tenant_id)
             VALUES ('prod-reval-2', 'SKU-REVAL2', 'Second', 200, 'USD', 'tenant-a')",
            [],
        )
        .unwrap();
    }
    {
        let cache = state.snapshot_cache.lock().await;
        let entry = cache
            .get("tenant-a")
            .expect("cache must still have the entry");
        let mut guard = entry.write().await;
        if let Some(data) = guard.as_mut() {
            data.generated_at = std::time::Instant::now() - std::time::Duration::from_secs(1800);
        }
    }
    let req3 = authed(
        axum::http::Method::GET,
        "/api/sync/snapshot",
        Some("tenant-a"),
    );
    let resp3 = app.clone().oneshot(req3).await.unwrap();
    assert_eq!(resp3.status(), StatusCode::OK);
    let body3 = resp3.into_body().collect().await.unwrap().to_bytes();
    let json3: serde_json::Value = serde_json::from_slice(&body3).unwrap();
    assert_eq!(
        json3["products"].as_array().unwrap().len(),
        2,
        "a version change must force a full recompute that sees both products"
    );
}

/// Single-flight: a burst of concurrent cold-miss requests for the same
/// tenant must all succeed with identical bodies and converge on ONE
/// cache entry (the write-lock serialisation collapses N stampeding
/// recomputes into one). A regression guard for the per-tenant
/// `Arc<RwLock<Option<SnapshotData>>>` design.
///
/// Fires 16 concurrent requests for the same tenant. All must return 200
/// with identical bodies, and the cache must end up with exactly one
/// entry for that tenant.
#[tokio::test]
async fn snapshot_cache_single_flight_under_concurrency() {
    let state = SyncState {
        db: Arc::new(Mutex::new(fresh_db())),
        snapshot_cache: Arc::new(Mutex::new(HashMap::new())),
        rate_limiter: RateLimiterState::new(),
        pg: None,
        skip_push_validation: false,
        tenant_count_cache: TenantCountCache::default(),
    };
    let app = std::sync::Arc::new(test_router_with_state(state.clone()));

    // Seed one product so the snapshot has deterministic content.
    {
        let conn = state.db.lock().await;
        conn.execute(
            "INSERT INTO roles (id, name, permissions) VALUES ('r-sf', 'Owner', '[]')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO products (id, sku, name, price_minor, currency, tenant_id)
             VALUES ('prod-sf', 'SKU-SF', 'SingleFlight', 100, 'USD', 'tenant-a')",
            [],
        )
        .unwrap();
    }

    // Fire N concurrent cold-miss requests for the same tenant.
    let mut handles = Vec::with_capacity(16);
    for _ in 0..16 {
        let app = app.clone();
        handles.push(tokio::spawn(async move {
            let req = authed(
                axum::http::Method::GET,
                "/api/sync/snapshot",
                Some("tenant-a"),
            );
            let resp = app.as_ref().clone().oneshot(req).await.unwrap();
            assert_eq!(resp.status(), StatusCode::OK);
            resp.into_body().collect().await.unwrap().to_bytes()
        }));
    }

    let mut bodies: Vec<bytes::Bytes> = Vec::new();
    for h in handles {
        let b = h.await.unwrap();
        bodies.push(b);
    }

    // All bodies identical, and exactly one cache entry for the tenant.
    for b in &bodies[1..] {
        assert_eq!(
            bodies[0], *b,
            "all single-flight responses must be identical"
        );
    }
    let cache = state.snapshot_cache.lock().await;
    assert_eq!(
        cache.len(),
        1,
        "single-flight must converge on one cache entry, got {}",
        cache.len()
    );
    assert!(cache.contains_key("tenant-a"));
}

/// Snapshot caching must be per-tenant: after tenant A warms its cache,
/// a request from tenant B must NOT receive A's data.
#[tokio::test]
async fn snapshot_cache_tenant_isolation() {
    let state = SyncState {
        db: Arc::new(Mutex::new(fresh_db())),
        snapshot_cache: Arc::new(Mutex::new(HashMap::new())),
        rate_limiter: RateLimiterState::new(),
        pg: None,
        skip_push_validation: false,
        tenant_count_cache: TenantCountCache::default(),
    };
    let app = test_router_with_state(state.clone());

    // Seed data for tenant-a only.
    {
        let conn = state.db.lock().await;
        conn.execute(
            "INSERT INTO roles (id, name, permissions) VALUES ('r-iso', 'Owner', '[]')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO products (id, sku, name, price_minor, currency, tenant_id)
             VALUES ('prod-iso', 'SKU-ISO', 'Isolated', 100, 'USD', 'tenant-a')",
            [],
        )
        .unwrap();
    }

    // Tenant A warms the cache with its product.
    let req_a = authed(
        axum::http::Method::GET,
        "/api/sync/snapshot",
        Some("tenant-a"),
    );
    let resp_a = app.clone().oneshot(req_a).await.unwrap();
    let body_a = resp_a.into_body().collect().await.unwrap().to_bytes();
    let json_a: serde_json::Value = serde_json::from_slice(&body_a).unwrap();
    assert_eq!(json_a["products"].as_array().unwrap().len(), 1);

    // Tenant B (cache populated for A) must see an EMPTY snapshot.
    let req_b = authed(
        axum::http::Method::GET,
        "/api/sync/snapshot",
        Some("tenant-b"),
    );
    let resp_b = app.oneshot(req_b).await.unwrap();
    assert_eq!(resp_b.status(), StatusCode::OK);
    let body_b = resp_b.into_body().collect().await.unwrap().to_bytes();
    let json_b: serde_json::Value = serde_json::from_slice(&body_b).unwrap();
    assert_eq!(
        json_b["products"].as_array().unwrap().len(),
        0,
        "tenant B must not receive tenant A's cached snapshot"
    );
}

/// The raw-bytes snapshot cache must behave identically against live
/// PostgreSQL: first request queries + caches, second request is a hit
/// serving identical JSON with the same content-type.
#[tokio::test]
async fn pg_integration_snapshot_cache_roundtrip() {
    let url = std::env::var("OZ_TEST_PG_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:15432/postgres".into());
    let pool = match crate::db::DbPool::connect_postgres(&url, false, 20, true).await {
        Ok(crate::db::DbPool::Postgres(pool)) => pool,
        Ok(_) => unreachable!("connect_postgres with a postgres:// URL returns Postgres"),
        Err(e) => {
            eprintln!("PG snapshot-cache integration test skipped: {e}");
            return;
        }
    };
    let tenant = format!("pg-snap-{}", uuid::Uuid::now_v7());
    let state = SyncState {
        db: Arc::new(Mutex::new(fresh_db())),
        snapshot_cache: Arc::new(Mutex::new(HashMap::new())),
        rate_limiter: RateLimiterState::new(),
        pg: Some(pool.clone()),
        skip_push_validation: false,
        tenant_count_cache: TenantCountCache::default(),
    };
    let app = test_router_with_state(state.clone());

    // Seed one product for the tenant so the snapshot has content.
    {
        let client = pool.get().await.unwrap();
        let role_id = format!("role-{tenant}");
        client
            .execute(
                "INSERT INTO roles (id, name, permissions) VALUES ($1, $2, '[]')",
                &[&role_id, &role_id],
            )
            .await
            .unwrap();
        client
            .execute(
                "INSERT INTO products (id, sku, name, price_minor, currency, track_serial, is_active, tenant_id)
                 VALUES ($1, $2, 'Widget', 100, 'USD', 1, 1, $3)",
                &[&format!("prod-{tenant}"), &format!("SKU-{tenant}"), &tenant],
            )
            .await
            .unwrap();
    }

    // Request 1 (cache miss) and request 2 (cache hit) must be identical.
    let mut bodies = Vec::new();
    for _ in 0..2 {
        let req = authed(axum::http::Method::GET, "/api/sync/snapshot", Some(&tenant));
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(
            resp.headers()
                .get("content-type")
                .unwrap()
                .to_str()
                .unwrap(),
            "application/json"
        );
        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(
            json["products"].as_array().unwrap().len(),
            1,
            "PG snapshot must include the product"
        );
        bodies.push(json);
    }
    assert_eq!(
        bodies[0], bodies[1],
        "cache hit on PG must serve the identical snapshot"
    );

    // Cleanup.
    let client = pool.get().await.unwrap();
    client
        .execute("DELETE FROM products WHERE tenant_id = $1", &[&tenant])
        .await
        .unwrap();
    client
        .execute(
            "DELETE FROM roles WHERE id = $1",
            &[&format!("role-{tenant}")],
        )
        .await
        .unwrap();
}

#[tokio::test]
async fn pull_returns_500_on_malformed_row() {
    // SYNC-10: a row that fails to decode must fail the whole pull
    // (5xx) rather than being silently dropped. Seed a row whose
    // retry_count is non-numeric (SQLite stores it as TEXT despite the
    // INTEGER affinity) so the SQLite row decoder's `get::<_, i64>` fails.
    let state = SyncState {
        db: Arc::new(Mutex::new(fresh_db())),
        snapshot_cache: Arc::new(Mutex::new(HashMap::new())),
        rate_limiter: RateLimiterState::new(),
        pg: None,
        skip_push_validation: false,
        tenant_count_cache: TenantCountCache::default(),
    };
    let app = test_router_with_state(state.clone());

    {
        let conn = state.db.lock().await;
        conn.execute_batch(
            "INSERT INTO offline_queue (id, action, payload, status, retry_count, created_at, tenant_id) VALUES
             ('good', 'act', '{}', 'pending', 0, '2026-01-01T00:00:00Z', 'tenant-a'),
             ('bad', 'act', '{}', 'pending', 'not-a-number', '2026-01-02T00:00:00Z', 'tenant-a')",
        )
        .unwrap();
    }

    let req = authed_post("/api/sync/pull", r#"{"since":null}"#, Some("tenant-a"));
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(
        resp.status(),
        StatusCode::INTERNAL_SERVER_ERROR,
        "malformed row must fail the pull, not be silently dropped"
    );
}

#[tokio::test]
async fn snapshot_tenant_isolation() {
    let state = SyncState {
        db: Arc::new(Mutex::new(fresh_db())),
        snapshot_cache: Arc::new(Mutex::new(HashMap::new())),
        rate_limiter: RateLimiterState::new(),
        pg: None,
        skip_push_validation: false,
        tenant_count_cache: TenantCountCache::default(),
    };
    let app = test_router_with_state(state.clone());

    // Seed a product for tenant-a only.
    {
        let conn = state.db.lock().await;
        // Seed a role so the FK on users is satisfied.
        conn.execute(
            "INSERT INTO roles (id, name, permissions) VALUES ('r-owner', 'Owner', '[]')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO products (id, sku, name, price_minor, currency, tenant_id)
             VALUES ('prod-a', 'SKU-A', 'Product A', 100, 'USD', 'tenant-a')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tax_rates (id, name, rate_bps, tenant_id)
             VALUES ('tax-a', 'Tax A', 800, 'tenant-a')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO users (id, username, pin_hash, display_name, role_id, tenant_id)
             VALUES ('user-a', 'alice', 'hash', 'Alice', 'r-owner', 'tenant-a')",
            [],
        )
        .unwrap();
    }

    // Tenant B's snapshot should be empty (no data seeded for tenant-b).
    let req_b = authed(
        axum::http::Method::GET,
        "/api/sync/snapshot",
        Some("tenant-b"),
    );
    let resp_b = app.clone().oneshot(req_b).await.unwrap();
    assert_eq!(resp_b.status(), StatusCode::OK);
    let body_b = resp_b.into_body().collect().await.unwrap().to_bytes();
    let json_b: serde_json::Value = serde_json::from_slice(&body_b).unwrap();
    assert_eq!(
        json_b["products"].as_array().unwrap().len(),
        0,
        "tenant-b should see no products"
    );
    assert_eq!(
        json_b["tax_rates"].as_array().unwrap().len(),
        0,
        "tenant-b should see no tax rates"
    );
    assert_eq!(
        json_b["users"].as_array().unwrap().len(),
        0,
        "tenant-b should see no users"
    );

    // Tenant A's snapshot should contain the seeded data.
    let req_a = authed(
        axum::http::Method::GET,
        "/api/sync/snapshot",
        Some("tenant-a"),
    );
    let resp_a = app.oneshot(req_a).await.unwrap();
    assert_eq!(resp_a.status(), StatusCode::OK);
    let body_a = resp_a.into_body().collect().await.unwrap().to_bytes();
    let json_a: serde_json::Value = serde_json::from_slice(&body_a).unwrap();
    assert_eq!(
        json_a["products"].as_array().unwrap().len(),
        1,
        "tenant-a should see 1 product"
    );
    assert_eq!(json_a["products"][0]["sku"], "SKU-A");
    assert_eq!(
        json_a["tax_rates"].as_array().unwrap().len(),
        1,
        "tenant-a should see 1 tax rate"
    );
    assert_eq!(
        json_a["users"].as_array().unwrap().len(),
        1,
        "tenant-a should see 1 user"
    );
}

// ── Basic push/pull with auth ────────────────────────────────────

#[tokio::test]
async fn push_empty_array_returns_ok() {
    let app = test_router();
    let req = authed_post("/api/sync/push", "[]", None);
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}

#[tokio::test]
async fn push_inserts_items_with_existing_ids() {
    let state = SyncState {
        db: Arc::new(Mutex::new(fresh_db())),
        snapshot_cache: Arc::new(Mutex::new(HashMap::new())),
        rate_limiter: RateLimiterState::new(),
        pg: None,
        skip_push_validation: false,
        tenant_count_cache: TenantCountCache::default(),
    };
    let app = test_router_with_state(state.clone());

    let id1 = uuid::Uuid::now_v7().to_string();
    let id2 = uuid::Uuid::now_v7().to_string();
    let body = format!(
        r#"[
            {{"id":"{id1}","action":"create","payload":"{{}}","status":"pending","retry_count":0,"last_error":null,"created_at":"2026-01-01T00:00:00Z","synced_at":null}},
            {{"id":"{id2}","action":"update","payload":"{{\"x\":1}}","status":"pending","retry_count":0,"last_error":null,"created_at":"2026-01-01T00:01:00Z","synced_at":null}}
        ]"#
    );
    let req = authed_post("/api/sync/push", &body, None);
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body_bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let push_resp: PushResponse = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(push_resp.results.len(), 2);
    assert!(matches!(push_resp.results[0], PushOutcome::Accepted));
    assert!(matches!(push_resp.results[1], PushOutcome::Accepted));

    // Verify both persisted
    let conn = state.db.lock().await;
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM offline_queue WHERE id IN (?1, ?2)",
            rusqlite::params![id1, id2],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 2);
}

#[tokio::test]
async fn push_duplicate_id_returns_rejected() {
    let state = SyncState {
        db: Arc::new(Mutex::new(fresh_db())),
        snapshot_cache: Arc::new(Mutex::new(HashMap::new())),
        rate_limiter: RateLimiterState::new(),
        pg: None,
        skip_push_validation: false,
        tenant_count_cache: TenantCountCache::default(),
    };
    let app = test_router_with_state(state.clone());

    let dup_id = uuid::Uuid::now_v7().to_string();

    // Insert first item directly (with explicit tenant_id)
    {
        let conn = state.db.lock().await;
        conn.execute(
            "INSERT INTO offline_queue (id, action, payload, status, created_at, tenant_id)
             VALUES (?1, 'test', '{}', 'pending', '2026-01-01T00:00:00Z', 'default')",
            [&dup_id],
        )
        .unwrap();
    }

    // Try to push a duplicate
    let body = format!(
        r#"[{{"id":"{dup_id}","action":"create","payload":"{{}}","status":"pending","retry_count":0,"last_error":null,"created_at":"2026-01-01T00:00:00Z","synced_at":null}}]"#
    );
    let req = authed_post("/api/sync/push", &body, None);
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body_bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let push_resp: PushResponse = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(push_resp.results.len(), 1);
    match &push_resp.results[0] {
        PushOutcome::Rejected { reason } => {
            assert!(reason.contains("duplicate"), "got: {reason}");
        }
        other => panic!("expected Rejected, got: {other:?}"),
    }
}

#[tokio::test]
async fn push_rejects_invalid_non_uuid_id() {
    let state = SyncState {
        db: Arc::new(Mutex::new(fresh_db())),
        snapshot_cache: Arc::new(Mutex::new(HashMap::new())),
        rate_limiter: RateLimiterState::new(),
        pg: None,
        skip_push_validation: false,
        tenant_count_cache: TenantCountCache::default(),
    };
    let app = test_router_with_state(state.clone());

    // A hostile id (the round-119 injection string) must be rejected at
    // push, never persisted — defense-in-depth so only UUID ids ever
    // reach the prune DELETE path. A well-formed UUIDv7 in the same
    // batch must still be accepted (valid clients are not blocked).
    let hostile = "x'); CREATE TABLE hacked(id TEXT);--";
    let valid = uuid::Uuid::now_v7().to_string();
    let body = format!(
        r#"[
            {{"id":"{hostile}","action":"create","payload":"{{}}","status":"pending","retry_count":0,"last_error":null,"created_at":"2026-01-01T00:00:00Z","synced_at":null}},
            {{"id":"{valid}","action":"create","payload":"{{}}","status":"pending","retry_count":0,"last_error":null,"created_at":"2026-01-01T00:00:00Z","synced_at":null}}
        ]"#
    );
    let req = authed_post("/api/sync/push", &body, None);
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body_bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let push_resp: PushResponse = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(push_resp.results.len(), 2);
    match &push_resp.results[0] {
        PushOutcome::Rejected { reason } => {
            assert!(
                reason.contains("invalid id"),
                "expected invalid-id rejection, got: {reason}"
            );
        }
        other => panic!("expected Rejected for hostile id, got: {other:?}"),
    }
    assert!(
        matches!(push_resp.results[1], PushOutcome::Accepted),
        "valid UUID must be accepted: {:?}",
        push_resp.results[1]
    );

    // The hostile id must never be persisted; the valid one must be.
    let conn = state.db.lock().await;
    let hostile_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM offline_queue WHERE id = ?1",
            [hostile],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(hostile_count, 0, "hostile id was persisted!");
    let valid_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM offline_queue WHERE id = ?1",
            [&valid],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(valid_count, 1, "valid UUID should be persisted");
    // The injected CREATE TABLE must never have executed.
    let hacked: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE name = 'hacked'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(hacked, 0, "injected CREATE TABLE executed!");
}

/// The two-phase handler logic (UUID validation → single batch INSERT)
/// must report the right per-item outcome for a MIXED batch: an invalid
/// id, a fresh item, and a duplicate of an existing row. The duplicate
/// must not abort the valid insert — the batch survives it.
#[tokio::test]
async fn handler_mixed_batch_invalid_uuid_valid_duplicate() {
    let state = SyncState {
        db: Arc::new(Mutex::new(fresh_db())),
        snapshot_cache: Arc::new(Mutex::new(HashMap::new())),
        rate_limiter: RateLimiterState::new(),
        pg: None,
        skip_push_validation: false,
        tenant_count_cache: TenantCountCache::default(),
    };
    let app = test_router_with_state(state.clone());

    // Seed an existing row that the batch will duplicate.
    let dup_id = uuid::Uuid::now_v7().to_string();
    {
        let conn = state.db.lock().await;
        conn.execute(
            "INSERT INTO offline_queue (id, action, payload, status, created_at, tenant_id)
             VALUES (?1, 'test', '{}', 'pending', '2026-01-01T00:00:00Z', 'default')",
            [&dup_id],
        )
        .unwrap();
    }

    let hostile = "not-a-uuid";
    let fresh = uuid::Uuid::now_v7().to_string();
    let body = format!(
        r#"[
            {{"id":"{hostile}","action":"create","payload":"{{}}","status":"pending","retry_count":0,"last_error":null,"created_at":"2026-01-01T00:00:00Z","synced_at":null}},
            {{"id":"{fresh}","action":"create","payload":"{{}}","status":"pending","retry_count":0,"last_error":null,"created_at":"2026-01-01T00:00:00Z","synced_at":null}},
            {{"id":"{dup_id}","action":"create","payload":"{{}}","status":"pending","retry_count":0,"last_error":null,"created_at":"2026-01-01T00:00:00Z","synced_at":null}}
        ]"#
    );
    let req = authed_post("/api/sync/push", &body, None);
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body_bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let push_resp: PushResponse = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(push_resp.results.len(), 3);
    match &push_resp.results[0] {
        PushOutcome::Rejected { reason } => {
            assert!(reason.contains("invalid id"), "got: {reason}");
        }
        other => panic!("expected invalid-id Rejected, got: {other:?}"),
    }
    assert!(
        matches!(push_resp.results[1], PushOutcome::Accepted),
        "fresh item must be Accepted: {:?}",
        push_resp.results[1]
    );
    match &push_resp.results[2] {
        PushOutcome::Rejected { reason } => {
            assert!(
                reason.contains("duplicate id"),
                "duplicate must be Rejected, got: {reason}"
            );
        }
        other => panic!("expected duplicate Rejected, got: {other:?}"),
    }

    // Exactly the fresh item was persisted; the duplicate and hostile id
    // were not double-inserted.
    let conn = state.db.lock().await;
    let fresh_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM offline_queue WHERE id = ?1",
            [&fresh],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(fresh_count, 1, "fresh item must be persisted once");
    let dup_total: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM offline_queue WHERE id = ?1",
            [&dup_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(dup_total, 1, "duplicate id must not be double-inserted");
}

/// The push response outcomes must be in the SAME ORDER as the request
/// items — the client (`apply_push_results`) zips `pending` against
/// `results` by index to mark items synced/failed. A regression hoisted
/// invalid-UUID rejections to the front, shifting outcomes for mixed
/// batches and marking the WRONG items as synced. RED: [valid, invalid,
/// valid] must return [Accepted, Rejected, Accepted] in request order.
#[tokio::test]
async fn push_outcomes_preserve_request_order_with_mixed_batch() {
    let state = SyncState {
        db: Arc::new(Mutex::new(fresh_db())),
        snapshot_cache: Arc::new(Mutex::new(HashMap::new())),
        rate_limiter: RateLimiterState::new(),
        pg: None,
        skip_push_validation: false,
        tenant_count_cache: TenantCountCache::default(),
    };
    let app = test_router_with_state(state.clone());

    let first = uuid::Uuid::now_v7().to_string();
    let hostile = "middle-not-a-uuid";
    let last = uuid::Uuid::now_v7().to_string();
    let body = format!(
        r#"[
            {{"id":"{first}","action":"create","payload":"{{}}","status":"pending","retry_count":0,"last_error":null,"created_at":"2026-01-01T00:00:00Z","synced_at":null}},
            {{"id":"{hostile}","action":"create","payload":"{{}}","status":"pending","retry_count":0,"last_error":null,"created_at":"2026-01-01T00:00:00Z","synced_at":null}},
            {{"id":"{last}","action":"create","payload":"{{}}","status":"pending","retry_count":0,"last_error":null,"created_at":"2026-01-01T00:00:00Z","synced_at":null}}
        ]"#
    );
    let req = authed_post("/api/sync/push", &body, None);
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body_bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let push_resp: PushResponse = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(push_resp.results.len(), 3, "one outcome per request item");

    // Index 0 = first item (valid) → Accepted.
    assert!(
        matches!(push_resp.results[0], PushOutcome::Accepted),
        "results[0] must be Accepted (first item), got: {:?}",
        push_resp.results[0]
    );
    // Index 1 = middle item (invalid) → Rejected.
    match &push_resp.results[1] {
        PushOutcome::Rejected { reason } => {
            assert!(reason.contains("invalid id"), "got: {reason}");
        }
        other => panic!("results[1] must be Rejected (middle item), got: {other:?}"),
    }
    // Index 2 = last item (valid) → Accepted.
    assert!(
        matches!(push_resp.results[2], PushOutcome::Accepted),
        "results[2] must be Accepted (last item), got: {:?}",
        push_resp.results[2]
    );
}

/// With `OZ_SKIP_PUSH_VALIDATION=1` (trusted server-to-server), a
/// non-UUID id must pass through the handler and be inserted — the
/// validation gate is the only thing stopping it.
#[tokio::test]
async fn push_batch_skip_validation_flag_accepts_non_uuid() {
    let state = SyncState {
        db: Arc::new(Mutex::new(fresh_db())),
        snapshot_cache: Arc::new(Mutex::new(HashMap::new())),
        rate_limiter: RateLimiterState::new(),
        pg: None,
        skip_push_validation: true,
        tenant_count_cache: TenantCountCache::default(),
    };
    let app = test_router_with_state(state.clone());

    let non_uuid = "server-generated-key-123";
    let body = format!(
        r#"[{{"id":"{non_uuid}","action":"create","payload":"{{}}","status":"pending","retry_count":0,"last_error":null,"created_at":"2026-01-01T00:00:00Z","synced_at":null}}]"#
    );
    let req = authed_post("/api/sync/push", &body, None);
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body_bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let push_resp: PushResponse = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(push_resp.results.len(), 1);
    assert!(
        matches!(push_resp.results[0], PushOutcome::Accepted),
        "skip_push_validation must accept the non-UUID id: {:?}",
        push_resp.results[0]
    );

    let conn = state.db.lock().await;
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM offline_queue WHERE id = ?1",
            [non_uuid],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        count, 1,
        "non-UUID id must be persisted when validation is skipped"
    );
}

#[tokio::test]
async fn pull_returns_items_for_tenant() {
    let state = SyncState {
        db: Arc::new(Mutex::new(fresh_db())),
        snapshot_cache: Arc::new(Mutex::new(HashMap::new())),
        rate_limiter: RateLimiterState::new(),
        pg: None,
        skip_push_validation: false,
        tenant_count_cache: TenantCountCache::default(),
    };
    let app = test_router_with_state(state.clone());

    // Seed items for both tenants
    {
        let conn = state.db.lock().await;
        conn.execute_batch(
            "INSERT INTO offline_queue (id, action, payload, status, created_at, tenant_id) VALUES
             ('t1-a', 'act', '{}', 'pending', '2026-01-02T00:00:00Z', 'tenant-a'),
             ('t1-b', 'act', '{}', 'pending', '2026-01-01T00:00:00Z', 'tenant-a'),
             ('t2-a', 'act', '{}', 'pending', '2026-01-03T00:00:00Z', 'tenant-b')",
        )
        .unwrap();
    }

    // Pull as tenant-a — should only see tenant-a's items
    let req = authed_post("/api/sync/pull", r#"{"since":null}"#, Some("tenant-a"));
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body_bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let pull_resp: PullResponse = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(pull_resp.items.len(), 2);
    assert_eq!(pull_resp.items[0].id, "t1-b");
    assert_eq!(pull_resp.items[1].id, "t1-a");
}

#[tokio::test]
async fn pull_tenant_isolation() {
    let state = SyncState {
        db: Arc::new(Mutex::new(fresh_db())),
        snapshot_cache: Arc::new(Mutex::new(HashMap::new())),
        rate_limiter: RateLimiterState::new(),
        pg: None,
        skip_push_validation: false,
        tenant_count_cache: TenantCountCache::default(),
    };
    let app = test_router_with_state(state.clone());

    // Seed items for both tenants
    {
        let conn = state.db.lock().await;
        conn.execute_batch(
            "INSERT INTO offline_queue (id, action, payload, status, created_at, tenant_id) VALUES
             ('a-only', 'act', '{}', 'pending', '2026-01-01T00:00:00Z', 'tenant-a'),
             ('b-only', 'act', '{}', 'pending', '2026-01-02T00:00:00Z', 'tenant-b')",
        )
        .unwrap();
    }

    // Tenant B should NOT see tenant A's item
    let req = authed_post("/api/sync/pull", r#"{"since":null}"#, Some("tenant-b"));
    let resp = app.clone().oneshot(req).await.unwrap();
    let body_bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let pull_resp: PullResponse = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(pull_resp.items.len(), 1);
    assert_eq!(pull_resp.items[0].id, "b-only");

    // Tenant A should NOT see tenant B's item
    let req_a = authed_post("/api/sync/pull", r#"{"since":null}"#, Some("tenant-a"));
    let resp_a = app.oneshot(req_a).await.unwrap();
    let body_a = resp_a.into_body().collect().await.unwrap().to_bytes();
    let pull_a: PullResponse = serde_json::from_slice(&body_a).unwrap();
    assert_eq!(pull_a.items.len(), 1);
    assert_eq!(pull_a.items[0].id, "a-only");
}

#[tokio::test]
async fn pull_filters_by_since_and_tenant() {
    let state = SyncState {
        db: Arc::new(Mutex::new(fresh_db())),
        snapshot_cache: Arc::new(Mutex::new(HashMap::new())),
        rate_limiter: RateLimiterState::new(),
        pg: None,
        skip_push_validation: false,
        tenant_count_cache: TenantCountCache::default(),
    };
    let app = test_router_with_state(state.clone());

    {
        let conn = state.db.lock().await;
        conn.execute_batch(
            "INSERT INTO offline_queue (id, action, payload, status, created_at, tenant_id) VALUES
             ('old', 'act', '{}', 'pending', '2026-01-01T00:00:00Z', 'default'),
             ('mid', 'act', '{}', 'pending', '2026-01-15T00:00:00Z', 'default'),
             ('new', 'act', '{}', 'pending', '2026-02-01T00:00:00Z', 'default'),
             ('other', 'act', '{}', 'pending', '2026-01-15T00:00:00Z', 'other-tenant')",
        )
        .unwrap();
    }

    // Should return mid and new for default tenant
    let req = authed_post(
        "/api/sync/pull",
        r#"{"since":"2026-01-15T00:00:00Z"}"#,
        None,
    );
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body_bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let pull_resp: PullResponse = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(pull_resp.items.len(), 2);
    assert_eq!(pull_resp.items[0].id, "mid");
    assert_eq!(pull_resp.items[1].id, "new");
}

// ── Status endpoint ─────────────────────────────────────────────

#[tokio::test]
async fn status_returns_ok() {
    let app = test_router();
    let req = authed(axum::http::Method::GET, "/api/sync/status", None);
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}

#[tokio::test]
async fn status_returns_json() {
    let app = test_router();
    let req = authed(axum::http::Method::GET, "/api/sync/status", None);
    let resp = app.oneshot(req).await.unwrap();
    let body_bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["status"], "ok");
    assert!(json["version"].is_string());
    assert_eq!(json["pending_count"], 0);
}

#[tokio::test]
async fn status_counts_only_current_tenant() {
    let state = SyncState {
        db: Arc::new(Mutex::new(fresh_db())),
        snapshot_cache: Arc::new(Mutex::new(HashMap::new())),
        rate_limiter: RateLimiterState::new(),
        pg: None,
        skip_push_validation: false,
        tenant_count_cache: TenantCountCache::default(),
    };
    let app = test_router_with_state(state.clone());

    {
        let conn = state.db.lock().await;
        conn.execute_batch(
            "INSERT INTO offline_queue (id, action, payload, status, created_at, tenant_id) VALUES
             ('a1', 'act', '{}', 'pending', '2026-01-01T00:00:00Z', 'tenant-a'),
             ('a2', 'act', '{}', 'pending', '2026-01-01T00:00:00Z', 'tenant-a'),
             ('b1', 'act', '{}', 'pending', '2026-01-01T00:00:00Z', 'tenant-b')",
        )
        .unwrap();
    }

    // Tenant A sees 2 pending
    let req_a = authed(
        axum::http::Method::GET,
        "/api/sync/status",
        Some("tenant-a"),
    );
    let resp_a = app.clone().oneshot(req_a).await.unwrap();
    let body_a = resp_a.into_body().collect().await.unwrap().to_bytes();
    let json_a: serde_json::Value = serde_json::from_slice(&body_a).unwrap();
    assert_eq!(json_a["pending_count"], 2);

    // Tenant B sees 1 pending
    let req_b = authed(
        axum::http::Method::GET,
        "/api/sync/status",
        Some("tenant-b"),
    );
    let resp_b = app.clone().oneshot(req_b).await.unwrap();
    let body_b = resp_b.into_body().collect().await.unwrap().to_bytes();
    let json_b: serde_json::Value = serde_json::from_slice(&body_b).unwrap();
    assert_eq!(json_b["pending_count"], 1);
}

#[tokio::test]
async fn status_counts_zero_for_empty_tenant() {
    let state = SyncState {
        db: Arc::new(Mutex::new(fresh_db())),
        snapshot_cache: Arc::new(Mutex::new(HashMap::new())),
        rate_limiter: RateLimiterState::new(),
        pg: None,
        skip_push_validation: false,
        tenant_count_cache: TenantCountCache::default(),
    };
    let app = test_router_with_state(state.clone());

    {
        let conn = state.db.lock().await;
        conn.execute_batch(
            "INSERT INTO offline_queue (id, action, payload, status, created_at, tenant_id) VALUES
             ('x', 'act', '{}', 'pending', '2026-01-01T00:00:00Z', 'tenant-a')",
        )
        .unwrap();
    }

    // Tenant C (no items) sees 0
    let req = authed(
        axum::http::Method::GET,
        "/api/sync/status",
        Some("tenant-c"),
    );
    let resp = app.oneshot(req).await.unwrap();
    let body_bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["pending_count"], 0);
}

/// The tenant-count cache must serve the TTL'd value instead of re-scanning
/// `offline_queue` on every status poll. First read warms the cache; rows
/// added for new tenants afterwards are NOT visible until the cache
/// expires (the value only feeds tiered-heartbeat sizing).
#[tokio::test]
async fn tenant_count_cache_serves_stale_value_within_ttl() {
    let state = SyncState {
        db: Arc::new(Mutex::new(fresh_db())),
        snapshot_cache: Arc::new(Mutex::new(HashMap::new())),
        rate_limiter: RateLimiterState::new(),
        pg: None,
        skip_push_validation: false,
        tenant_count_cache: TenantCountCache::default(),
    };

    {
        let conn = state.db.lock().await;
        conn.execute_batch(
            "INSERT INTO offline_queue (id, action, payload, status, created_at, tenant_id) VALUES
             ('t1', 'act', '{}', 'pending', '2026-01-01T00:00:00Z', 'tenant-a')",
        )
        .unwrap();
    }

    // First read warms the cache: 1 distinct tenant.
    assert_eq!(state.cached_tenant_count().await, 1);

    // A second tenant appears in the DB, but within the 60s TTL the cache
    // must serve the previous count (no rescan of offline_queue).
    {
        let conn = state.db.lock().await;
        conn.execute_batch(
            "INSERT INTO offline_queue (id, action, payload, status, created_at, tenant_id) VALUES
             ('t2', 'act', '{}', 'pending', '2026-01-01T00:00:00Z', 'tenant-b')",
        )
        .unwrap();
    }

    assert_eq!(
        state.cached_tenant_count().await,
        1,
        "cache must serve the stale count within TTL"
    );
}

/// When the cache TTL expires, the next read must RESCAN and return the
/// updated tenant count. The cache's internal timestamp is backdated
/// directly (the test module can reach `TenantCountCache.0`) so no real
/// 60s wait is needed.
#[tokio::test]
async fn tenant_count_cache_refreshes_after_expiry() {
    let state = SyncState {
        db: Arc::new(Mutex::new(fresh_db())),
        snapshot_cache: Arc::new(Mutex::new(HashMap::new())),
        rate_limiter: RateLimiterState::new(),
        pg: None,
        skip_push_validation: false,
        tenant_count_cache: TenantCountCache::default(),
    };

    {
        let conn = state.db.lock().await;
        conn.execute_batch(
            "INSERT INTO offline_queue (id, action, payload, status, created_at, tenant_id) VALUES
             ('r1', 'act', '{}', 'pending', '2026-01-01T00:00:00Z', 'tenant-a')",
        )
        .unwrap();
    }
    assert_eq!(state.cached_tenant_count().await, 1);

    // A second tenant appears AFTER the warm read.
    {
        let conn = state.db.lock().await;
        conn.execute_batch(
            "INSERT INTO offline_queue (id, action, payload, status, created_at, tenant_id) VALUES
             ('r2', 'act', '{}', 'pending', '2026-01-01T00:00:00Z', 'tenant-b')",
        )
        .unwrap();
    }

    // Backdate the cached entry beyond the 60s TTL so the next read must
    // treat it as expired and rescan → 2.
    {
        let mut guard = state.tenant_count_cache.0.lock().await;
        let (_, count) = guard.as_ref().expect("cache must be warm");
        *guard = Some((
            std::time::Instant::now() - std::time::Duration::from_secs(120),
            *count,
        ));
    }

    assert_eq!(
        state.cached_tenant_count().await,
        2,
        "expired cache must rescan and see the new tenant"
    );
}

/// The cache must behave identically on the real PostgreSQL backend:
/// warm at N, serve stale within TTL, rescan after expiry.
///
/// Runs on a DEDICATED throwaway database: `distinct_tenant_count` is a
/// global aggregate over the whole `offline_queue`, so sharing the dev DB
/// with parallel PG tests (which write their own rows) makes the count
/// non-deterministic. The temp DB is process-unique and dropped after.
#[tokio::test]
async fn pg_integration_tenant_count_cache() {
    let url = std::env::var("OZ_TEST_PG_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:15432/postgres".into());
    // Admin connection (raw, no schema) to create the throwaway DB.
    let admin_pool = match crate::db::DbPool::connect_postgres(&url, false, 20, false).await {
        Ok(crate::db::DbPool::Postgres(pool)) => pool,
        Ok(_) => unreachable!("connect_postgres with a postgres:// URL returns Postgres"),
        Err(e) => {
            eprintln!("PG tenant-count cache integration test skipped: {e}");
            return;
        }
    };
    let admin = admin_pool.get().await.expect("admin client");
    let db_name = format!("oz_tenant_count_{}", std::process::id());
    admin
        .batch_execute(&format!("DROP DATABASE IF EXISTS {db_name} WITH (FORCE);"))
        .await
        .expect("drop stale database should succeed");
    if let Err(e) = admin
        .execute(&format!("CREATE DATABASE {db_name}"), &[])
        .await
    {
        eprintln!("PG tenant-count cache test skipped: cannot CREATE DATABASE ({e})");
        return;
    }
    let (base, query) = match url.split_once('?') {
        Some((b, q)) => (b, Some(q)),
        None => (url.as_str(), None),
    };
    let (head, _old_db) = base
        .rsplit_once('/')
        .expect("URL must have a database path");
    let db_url = match query {
        Some(q) => format!("{head}/{db_name}?{q}"),
        None => format!("{head}/{db_name}"),
    };
    drop(admin);

    // The dedicated DB: full schema applied here, no other test touches it.
    let pool = match crate::db::DbPool::connect_postgres(&db_url, false, 20, true).await {
        Ok(crate::db::DbPool::Postgres(pool)) => pool,
        Ok(_) => unreachable!("connect_postgres with a postgres:// URL returns Postgres"),
        Err(e) => {
            eprintln!("PG tenant-count cache integration test skipped: {e}");
            return;
        }
    };
    let tenant = format!("pg-cache-{}", uuid::Uuid::now_v7());

    let state = SyncState {
        db: Arc::new(Mutex::new(fresh_db())),
        snapshot_cache: Arc::new(Mutex::new(HashMap::new())),
        rate_limiter: RateLimiterState::new(),
        pg: Some(pool.clone()),
        skip_push_validation: false,
        tenant_count_cache: TenantCountCache::default(),
    };

    // Seed two tenants directly in PG.
    {
        let client = pool.get().await.unwrap();
        for i in 0..2 {
            client
                .execute(
                    "INSERT INTO offline_queue (id, action, payload, status, created_at, tenant_id)
                     VALUES ($1, 'act', '{}', 'pending', '2026-01-01T00:00:00Z', $2)",
                    &[&format!("{tenant}-item-{i}"), &format!("{tenant}-t{i}")],
                )
                .await
                .unwrap();
        }
    }

    // Warm: 2 distinct tenants.
    assert_eq!(state.cached_tenant_count().await, 2);

    // Add a third tenant; within TTL the cache still serves 2.
    {
        let client = pool.get().await.unwrap();
        client
            .execute(
                "INSERT INTO offline_queue (id, action, payload, status, created_at, tenant_id)
                 VALUES ($1, 'act', '{}', 'pending', '2026-01-01T00:00:00Z', $2)",
                &[&format!("{tenant}-item-3"), &format!("{tenant}-t3")],
            )
            .await
            .unwrap();
    }
    assert_eq!(
        state.cached_tenant_count().await,
        2,
        "cache must serve stale count within TTL on PG"
    );

    // Expire the cache → rescan sees 3.
    {
        let mut guard = state.tenant_count_cache.0.lock().await;
        let (_, count) = guard.as_ref().expect("cache must be warm");
        *guard = Some((
            std::time::Instant::now() - std::time::Duration::from_secs(120),
            *count,
        ));
    }
    assert_eq!(
        state.cached_tenant_count().await,
        3,
        "expired PG cache must rescan"
    );

    // Cleanup: drop the dedicated database.
    let admin = admin_pool.get().await.expect("admin client for cleanup");
    admin
        .batch_execute(&format!("DROP DATABASE IF EXISTS {db_name} WITH (FORCE);"))
        .await
        .expect("drop dedicated database should succeed");
}

/// Concurrent cold reads must all agree on the same count and leave the
/// cache populated — no double-count, no panic under parallel warm-up.
#[tokio::test]
async fn tenant_count_cache_concurrent_first_reads() {
    let state = SyncState {
        db: Arc::new(Mutex::new(fresh_db())),
        snapshot_cache: Arc::new(Mutex::new(HashMap::new())),
        rate_limiter: RateLimiterState::new(),
        pg: None,
        skip_push_validation: false,
        tenant_count_cache: TenantCountCache::default(),
    };

    {
        let conn = state.db.lock().await;
        conn.execute_batch(
            "INSERT INTO offline_queue (id, action, payload, status, created_at, tenant_id) VALUES
             ('c1', 'act', '{}', 'pending', '2026-01-01T00:00:00Z', 'tenant-a'),
             ('c2', 'act', '{}', 'pending', '2026-01-01T00:00:00Z', 'tenant-b'),
             ('c3', 'act', '{}', 'pending', '2026-01-01T00:00:00Z', 'tenant-c')",
        )
        .unwrap();
    }

    let mut handles = Vec::new();
    for _ in 0..8 {
        let state = state.clone();
        handles.push(tokio::spawn(
            async move { state.cached_tenant_count().await },
        ));
    }
    let mut counts = Vec::with_capacity(handles.len());
    for handle in handles {
        counts.push(handle.await.unwrap());
    }
    assert!(
        counts.iter().all(|c| *c == 3),
        "all concurrent reads must agree on 3, got: {counts:?}"
    );

    // Cache is now warm — a subsequent read is served without rescanning.
    assert_eq!(state.cached_tenant_count().await, 3);
}

// ── Plan enforcement (ADR sync-plan-gating) ─────────────────────

#[tokio::test]
async fn free_tenant_push_rejected_when_enforced() {
    let app = test_router_with_plan_enforcement(true);
    // No plan row → fail closed to free.
    let req = authed_post("/api/sync/push", r#"[]"#, Some("tenant-free-no-row"));
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(
        json["error"], "plan_required",
        "a free tenant must get a structured plan_required rejection"
    );
}

#[tokio::test]
async fn explicitly_free_tenant_push_rejected_when_enforced() {
    let app = test_router_with_plan("tenant-free", "free", true).await;
    let req = authed_post("/api/sync/push", r#"[]"#, Some("tenant-free"));
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["error"], "plan_required");
}

#[tokio::test]
async fn pro_tenant_push_accepted_when_enforced() {
    let app = test_router_with_plan("tenant-pro", "pro", true).await;
    let id = uuid::Uuid::now_v7().to_string();
    let body = format!(
        r#"[{{"id":"{id}","action":"complete_sale","payload":"{{}}","status":"pending","retry_count":0,"last_error":null,"created_at":"2026-01-01T00:00:00Z","synced_at":null}}]"#
    );
    let req = authed_post("/api/sync/push", &body, Some("tenant-pro"));
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(
        resp.status(),
        StatusCode::OK,
        "a pro tenant must be able to push when enforcement is on"
    );
}

#[tokio::test]
async fn free_tenant_push_allowed_when_not_enforced() {
    // Dev mode: OZ_ENFORCE_PLANS unset — everything works as before.
    let app = test_router_with_plan("tenant-free", "free", false).await;
    let id = uuid::Uuid::now_v7().to_string();
    let body = format!(
        r#"[{{"id":"{id}","action":"complete_sale","payload":"{{}}","status":"pending","retry_count":0,"last_error":null,"created_at":"2026-01-01T00:00:00Z","synced_at":null}}]"#
    );
    let req = authed_post("/api/sync/push", &body, Some("tenant-free"));
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(
        resp.status(),
        StatusCode::OK,
        "dev mode must not gate free tenants"
    );
}

#[tokio::test]
async fn status_endpoint_also_gated_by_plan() {
    let app = test_router_with_plan_enforcement(true);
    let req = authed(
        axum::http::Method::GET,
        "/api/sync/status",
        Some("tenant-gated"),
    );
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["error"], "plan_required");
}

// ── Transport type compatibility ─────────────────────────────────

#[tokio::test]
async fn push_response_uses_transport_types() {
    let app = test_router();
    let req = authed_post("/api/sync/push", "[]", None);
    let resp = app.oneshot(req).await.unwrap();
    let body_bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let push_resp: PushResponse = serde_json::from_slice(&body_bytes).unwrap();
    assert!(push_resp.results.is_empty());
}

#[tokio::test]
async fn pull_response_uses_transport_types() {
    let app = test_router();
    let req = authed_post("/api/sync/pull", r#"{"since":null}"#, None);
    let resp = app.oneshot(req).await.unwrap();
    let body_bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let pull_resp: PullResponse = serde_json::from_slice(&body_bytes).unwrap();
    assert!(pull_resp.items.is_empty());
}

// ── Validation ──────────────────────────────────────────────────

#[tokio::test]
async fn push_rejects_malformed_json() {
    let app = test_router();
    let token = test_token(None);
    let req = Request::builder()
        .method("POST")
        .uri("/api/sync/push")
        .header("Authorization", format!("Bearer {token}"))
        .header("Content-Type", "application/json")
        .body(Body::from("not json"))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

// ── Anchor expiry (P-1 retention) ────────────────────────────

#[tokio::test]
async fn pull_returns_410_when_anchor_expired() {
    let state = SyncState {
        db: Arc::new(Mutex::new(fresh_db())),
        snapshot_cache: Arc::new(Mutex::new(HashMap::new())),
        rate_limiter: RateLimiterState::new(),
        pg: None,
        skip_push_validation: false,
        tenant_count_cache: TenantCountCache::default(),
    };
    let app = test_router_with_state(state.clone());

    // Seed an item with a known timestamp.
    {
        let conn = state.db.lock().await;
        conn.execute(
            "INSERT INTO offline_queue (id, action, payload, status, created_at, tenant_id)
             VALUES ('a1', 'act', '{}', 'pending', '2026-04-15T00:00:00Z', 'default')",
            [],
        )
        .unwrap();
    }

    // Pull with a `since` timestamp older than the oldest row.
    // The anchor (2025-01-01) is before the oldest row (2026-04-15),
    // so the server should return 410 Gone.
    let req = authed_post(
        "/api/sync/pull",
        r#"{"since":"2025-01-01T00:00:00Z"}"#,
        None,
    );
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::GONE);

    let body_bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["error"], "anchor_expired");
    assert_eq!(json["oldest_available"], "2026-04-15T00:00:00Z");
}

#[tokio::test]
async fn pull_succeeds_when_anchor_is_fresh() {
    let state = SyncState {
        db: Arc::new(Mutex::new(fresh_db())),
        snapshot_cache: Arc::new(Mutex::new(HashMap::new())),
        rate_limiter: RateLimiterState::new(),
        pg: None,
        skip_push_validation: false,
        tenant_count_cache: TenantCountCache::default(),
    };
    let app = test_router_with_state(state.clone());

    {
        let conn = state.db.lock().await;
        conn.execute(
            "INSERT INTO offline_queue (id, action, payload, status, created_at, tenant_id)
             VALUES ('a1', 'act', '{}', 'pending', '2026-04-15T00:00:00Z', 'default')",
            [],
        )
        .unwrap();
    }

    // Pull with a `since` timestamp newer than the oldest row.
    // The anchor (2026-05-01) is after the oldest row, so normal
    // response is expected.
    let req = authed_post(
        "/api/sync/pull",
        r#"{"since":"2026-05-01T00:00:00Z"}"#,
        None,
    );
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body_bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let pull_resp: PullResponse = serde_json::from_slice(&body_bytes).unwrap();
    assert!(pull_resp.items.is_empty()); // since is after the only row
}

#[tokio::test]
async fn pull_null_since_never_expired() {
    let state = SyncState {
        db: Arc::new(Mutex::new(fresh_db())),
        snapshot_cache: Arc::new(Mutex::new(HashMap::new())),
        rate_limiter: RateLimiterState::new(),
        pg: None,
        skip_push_validation: false,
        tenant_count_cache: TenantCountCache::default(),
    };
    let app = test_router_with_state(state);

    // Initial sync (since = null) should always succeed regardless
    // of what's in the DB.
    let req = authed_post("/api/sync/pull", r#"{"since":null}"#, None);
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}

#[tokio::test]
async fn pull_rejects_malformed_json() {
    let app = test_router();
    let token = test_token(None);
    let req = Request::builder()
        .method("POST")
        .uri("/api/sync/pull")
        .header("Authorization", format!("Bearer {token}"))
        .header("Content-Type", "application/json")
        .body(Body::from("not json"))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

// ── P152: Rate Limiting Integration Tests ────────────────────────

/// Helper: send `count` authed POST requests and return all status codes.
async fn send_n_push_requests(app: &Router, tenant: Option<&str>, n: usize) -> Vec<StatusCode> {
    let mut codes = Vec::with_capacity(n);
    let token = test_token(tenant);
    for _ in 0..n {
        let req = Request::builder()
            .method("POST")
            .uri("/api/sync/push")
            .header("Authorization", format!("Bearer {token}"))
            .header("Content-Type", "application/json")
            .body(Body::from("[]"))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        codes.push(resp.status());
    }
    codes
}

/// Helper: create a SyncState with a shared RateLimiterState for
/// cross-request rate limit testing.
fn shared_state() -> SyncState {
    SyncState {
        db: Arc::new(Mutex::new(fresh_db())),
        snapshot_cache: Arc::new(Mutex::new(HashMap::new())),
        rate_limiter: RateLimiterState::new(),
        pg: None,
        skip_push_validation: false,
        tenant_count_cache: TenantCountCache::default(),
    }
}

#[tokio::test]
async fn rate_limit_429_when_push_limit_exceeded() {
    let state = shared_state();
    let app = test_router_with_state(state);

    // First 100 requests should be OK (push limit = 100/min).
    let codes = send_n_push_requests(&app, Some("tenant-rl"), 101).await;

    assert_eq!(codes[0..100].iter().filter(|c| c.is_success()).count(), 100);
    assert_eq!(codes[100], StatusCode::TOO_MANY_REQUESTS);
}

#[tokio::test]
async fn rate_limit_429_includes_retry_after_header() {
    let state = shared_state();
    let app = test_router_with_state(state);

    // Exhaust the push limit.
    let _ = send_n_push_requests(&app, Some("tenant-hdr"), 100).await;

    // 101st request should return 429 with Retry-After header.
    let token = test_token(Some("tenant-hdr"));
    let req = Request::builder()
        .method("POST")
        .uri("/api/sync/push")
        .header("Authorization", format!("Bearer {token}"))
        .header("Content-Type", "application/json")
        .body(Body::from("[]"))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::TOO_MANY_REQUESTS);

    let retry_after = resp.headers().get("Retry-After");
    assert!(retry_after.is_some(), "429 must include Retry-After header");
    let secs: u64 = retry_after.unwrap().to_str().unwrap().parse().unwrap();
    assert!(secs > 0, "Retry-After must be positive: {secs}");

    let body_bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["error"], "rate_limit_exceeded");
    assert!(json["retry_after_seconds"].as_u64().unwrap() > 0);
}

#[tokio::test]
async fn rate_limit_tenant_isolation() {
    let state = shared_state();
    let app = test_router_with_state(state);

    // Exhaust tenant A's push limit.
    let _ = send_n_push_requests(&app, Some("tenant-a"), 100).await;

    // Tenant A's 101st request should be 429.
    let token_a = test_token(Some("tenant-a"));
    let req_a = Request::builder()
        .method("POST")
        .uri("/api/sync/push")
        .header("Authorization", format!("Bearer {token_a}"))
        .header("Content-Type", "application/json")
        .body(Body::from("[]"))
        .unwrap();
    let resp_a = app.clone().oneshot(req_a).await.unwrap();
    assert_eq!(resp_a.status(), StatusCode::TOO_MANY_REQUESTS);

    // Tenant B should still succeed (independent bucket).
    let token_b = test_token(Some("tenant-b"));
    let req_b = Request::builder()
        .method("POST")
        .uri("/api/sync/push")
        .header("Authorization", format!("Bearer {token_b}"))
        .header("Content-Type", "application/json")
        .body(Body::from("[]"))
        .unwrap();
    let resp_b = app.oneshot(req_b).await.unwrap();
    assert_eq!(
        resp_b.status(),
        StatusCode::OK,
        "tenant B should not be rate-limited when tenant A is exhausted"
    );
}

#[tokio::test]
async fn rate_limit_endpoint_isolation() {
    let state = shared_state();
    let app = test_router_with_state(state);

    // Exhaust push endpoint for a tenant.
    let _ = send_n_push_requests(&app, Some("tenant-ep"), 100).await;

    // Push should now be 429.
    let token = test_token(Some("tenant-ep"));
    let req_push = Request::builder()
        .method("POST")
        .uri("/api/sync/push")
        .header("Authorization", format!("Bearer {token}"))
        .header("Content-Type", "application/json")
        .body(Body::from("[]"))
        .unwrap();
    let resp_push = app.clone().oneshot(req_push).await.unwrap();
    assert_eq!(resp_push.status(), StatusCode::TOO_MANY_REQUESTS);

    // Pull should still work (separate 300/min limit).
    let req_pull = Request::builder()
        .method("POST")
        .uri("/api/sync/pull")
        .header("Authorization", format!("Bearer {token}"))
        .header("Content-Type", "application/json")
        .body(Body::from(r#"{"since":null}"#))
        .unwrap();
    let resp_pull = app.oneshot(req_pull).await.unwrap();
    assert_eq!(
        resp_pull.status(),
        StatusCode::OK,
        "pull should not be rate-limited when push is exhausted"
    );
}

#[tokio::test]
async fn rate_limit_burst_allowance() {
    let state = shared_state();
    let app = test_router_with_state(state);

    // Burst of 50 requests should all succeed (push capacity = 100).
    let codes = send_n_push_requests(&app, Some("tenant-burst"), 50).await;
    assert!(
        codes.iter().all(|c| c.is_success()),
        "first 50 requests should all succeed within burst allowance"
    );

    // Next 50 should also succeed (we're still within 100 burst).
    let codes2 = send_n_push_requests(&app, Some("tenant-burst"), 50).await;
    assert!(codes2.iter().all(|c| c.is_success()));

    // 101st should be 429.
    let codes3 = send_n_push_requests(&app, Some("tenant-burst"), 1).await;
    assert_eq!(codes3[0], StatusCode::TOO_MANY_REQUESTS);
}

#[tokio::test]
async fn rate_limit_status_endpoint_within_burst_limit() {
    let state = shared_state();
    let app = test_router_with_state(state);

    // /api/sync/status has a 300/min limit. 50 rapid GETs should all pass.
    // Health endpoints (/health, /api/health) are in the main router
    // (build_router in main.rs) which does NOT apply rate_limit_middleware —
    // they are exempt by architecture, so no 429 test is needed for them.
    let token = test_token(Some("tenant-status"));
    for _ in 0..50 {
        let req = Request::builder()
            .method("GET")
            .uri("/api/sync/status")
            .header("Authorization", format!("Bearer {token}"))
            .body(Body::empty())
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert!(
            resp.status().is_success(),
            "status endpoint should not be rate-limited at 50 requests (300/min limit)"
        );
    }
}

// ── Pool wait bound (SOTA finding D) ─────────────────────────────

/// Build a PG-backed SyncState + router whose pool is `max_size(1)`.
async fn pg_router_with_pool_size(
    url: &str,
    size: usize,
) -> Option<(axum::Router, deadpool_postgres::Pool, SyncState)> {
    let pool = match crate::db::DbPool::connect_postgres(url, false, size, true).await {
        Ok(crate::db::DbPool::Postgres(pool)) => pool,
        Ok(_) => unreachable!("connect_postgres with a postgres:// URL returns Postgres"),
        Err(e) => {
            eprintln!("PG pool-bound integration test skipped: {e}");
            return None;
        }
    };
    let state = SyncState {
        db: Arc::new(Mutex::new(fresh_db())),
        snapshot_cache: Arc::new(Mutex::new(HashMap::new())),
        rate_limiter: RateLimiterState::new(),
        pg: Some(pool.clone()),
        skip_push_validation: false,
        tenant_count_cache: TenantCountCache::default(),
    };
    let app = test_router_with_state(state.clone());
    Some((app, pool, state))
}

/// The end-to-end version of the pool wait bound: with a fully-exhausted
/// PG pool (max_size(1), connection held), a real push request must
/// complete with a 500 within ~5s — NOT hang indefinitely. This is the
/// doc §7.2 scenario through the full handler → store → pool stack.
#[tokio::test]
async fn pg_integration_push_returns_500_when_pool_exhausted() {
    let url = std::env::var("OZ_TEST_PG_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:15432/postgres".into());
    let Some((app, pool, _state)) = pg_router_with_pool_size(&url, 1).await else {
        return;
    };

    // Exhaust the pool: take the single connection and hold it.
    let _held = pool.get().await.expect("first get should succeed");

    let id = uuid::Uuid::now_v7().to_string();
    let body = format!(
        r#"[{{"id":"{id}","action":"create","payload":"{{}}","status":"pending","retry_count":0,"last_error":null,"created_at":"2026-01-01T00:00:00Z","synced_at":null}}]"#
    );
    let req = authed_post("/api/sync/push", &body, None);

    // Guard with 15s: a regression that removes the 5s wait_timeout
    // fails the test instead of hanging the whole suite.
    let result = tokio::time::timeout(std::time::Duration::from_secs(15), app.oneshot(req)).await;
    let resp = match result {
        Err(_) => panic!("push hung beyond 15s — wait_timeout lost"),
        Ok(Ok(resp)) => resp,
        Ok(Err(_)) => unreachable!("tower oneshot error is infallible"),
    };

    assert_eq!(
        resp.status(),
        StatusCode::INTERNAL_SERVER_ERROR,
        "exhausted pool must fail fast with 500, not hang"
    );
}

/// After the held connection is dropped, the same router must serve
/// requests again — the pool must not be permanently poisoned by the
/// timeout path.
#[tokio::test]
async fn pg_integration_pool_recovers_after_exhaustion() {
    let url = std::env::var("OZ_TEST_PG_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:15432/postgres".into());
    let Some((app, pool, _state)) = pg_router_with_pool_size(&url, 1).await else {
        return;
    };

    // Exhaust → push fails fast.
    {
        let _held = pool.get().await.expect("first get should succeed");
        let id = uuid::Uuid::now_v7().to_string();
        let body = format!(
            r#"[{{"id":"{id}","action":"create","payload":"{{}}","status":"pending","retry_count":0,"last_error":null,"created_at":"2026-01-01T00:00:00Z","synced_at":null}}]"#
        );
        let req = authed_post("/api/sync/push", &body, None);
        let resp =
            tokio::time::timeout(std::time::Duration::from_secs(15), app.clone().oneshot(req))
                .await
                .expect("push must complete within 15s")
                .expect("tower oneshot error is infallible");
        assert_eq!(resp.status(), StatusCode::INTERNAL_SERVER_ERROR);
    } // held connection dropped here → slot freed

    // The SAME router now succeeds: the pool recovers.
    let id = uuid::Uuid::now_v7().to_string();
    let body = format!(
        r#"[{{"id":"{id}","action":"create","payload":"{{}}","status":"pending","retry_count":0,"last_error":null,"created_at":"2026-01-01T00:00:00Z","synced_at":null}}]"#
    );
    let req = authed_post("/api/sync/push", &body, None);
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(
        resp.status(),
        StatusCode::OK,
        "pool must recover after drop"
    );

    // Verify the item actually persisted in PG (the handler wrote through
    // the PG store, not the SQLite fallback).
    let client = pool.get().await.unwrap();
    let count: i64 = client
        .query_one("SELECT COUNT(*) FROM offline_queue WHERE id = $1", &[&id])
        .await
        .unwrap()
        .get(0);
    assert_eq!(count, 1);
    client
        .execute("DELETE FROM offline_queue WHERE id = $1", &[&id])
        .await
        .unwrap();
}
