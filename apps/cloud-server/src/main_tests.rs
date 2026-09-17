use super::*;
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use tower::ServiceExt;

// ── Admin key env semantics ───────────────────────────────────
fn configured_admin_key(raw: Result<String, std::env::VarError>) -> Option<String> {
    raw.ok().filter(|key| !key.is_empty())
}

#[test]
fn configured_admin_key_missing_is_none() {
    assert_eq!(
        configured_admin_key(Err(std::env::VarError::NotPresent)),
        None
    );
}

#[test]
fn configured_admin_key_empty_is_none() {
    assert_eq!(configured_admin_key(Ok(String::new())), None);
}

#[test]
fn configured_admin_key_non_empty_is_some() {
    assert_eq!(
        configured_admin_key(Ok("super-secret".to_string())),
        Some("super-secret".to_string())
    );
}

// ── OZ_WORKER_THREADS semantics ────────────────────────────────────

#[test]
fn worker_threads_unset_defaults_to_two() {
    assert_eq!(parse_worker_threads(Err(std::env::VarError::NotPresent)), 2);
}

#[test]
fn worker_threads_valid_value_is_used() {
    assert_eq!(parse_worker_threads(Ok("4".into())), 4);
    assert_eq!(parse_worker_threads(Ok("16".into())), 16);
}

#[test]
fn worker_threads_zero_maps_to_cpu_count() {
    // 0 = auto: logical CPU count (available_parallelism), never 0.
    let n = parse_worker_threads(Ok("0".into()));
    assert!(n >= 1, "0 must map to a real CPU count, got {n}");
}

#[test]
fn worker_threads_garbage_falls_back_to_two() {
    assert_eq!(parse_worker_threads(Ok("banana".into())), 2);
    assert_eq!(parse_worker_threads(Ok("-3".into())), 2);
}

#[test]
fn worker_threads_trims_whitespace() {
    assert_eq!(parse_worker_threads(Ok(" 8 ".into())), 8);
}

/// Helper: create a default config for tests.
fn test_config() -> config::CloudServerConfig {
    config::CloudServerConfig {
        db_path: ":memory:".into(),
        database_url: None,
        require_tls: false,
        db_pool_size: 20,
        apply_schema: true,
        port: 3099,
        admin_key: None,
        enforce_plans: false,
        production: false,
        log_format: config::LogFormat::Plain,
        redirect_only: false,
        sync_redirect_url: None,
        stripe_webhook_secret: None,
        square_webhook_signature_key: None,
        square_webhook_url: None,
        midtrans_server_key: None,
        midtrans_sandbox: false,
        midtrans_qris_acquirer: None,
        api_secret: None,
        redis_url: None,
    }
}

/// Helper: build an in-memory database with migrations applied.
fn fresh_db() -> Connection {
    kasirmu_core::migrations::fresh_db()
}

/// Helper: create a test router backed by an in-memory database.
fn test_app() -> Router {
    let state = CloudServerState {
        db: Arc::new(Mutex::new(fresh_db())),
        pg: None,
        started_at: Instant::now(),
        health_depth_cache: HealthDepthCache::default(),
        stripe_webhook_secret: None,
        square_webhook_signature_key: None,
        square_webhook_url: None,
        midtrans_server_key: None,
        midtrans_sandbox: false,
        midtrans_qris_acquirer: None,
    };
    let config = test_config();
    build_router(
        state,
        crate::rate_limit::RateLimiterState::new(),
        &config,
        None,
    )
}

/// Create a test JWT token.
fn test_token(tenant_id: Option<&str>) -> String {
    kasirmu_api::auth::create_token("test", Some(24), tenant_id, None)
        .unwrap()
        .token
}

/// Add an Authorization header to a request builder.
fn with_auth(uri: &str, tenant_id: Option<&str>) -> Request<Body> {
    let token = test_token(tenant_id);
    Request::builder()
        .uri(uri)
        .header("Authorization", format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap()
}

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

#[tokio::test]
async fn metrics_returns_prometheus_text() {
    let app = test_app();
    let req = Request::builder()
        .uri("/metrics")
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = resp.into_body().collect().await.unwrap().to_bytes();
    let text = String::from_utf8_lossy(&body);
    assert!(text.contains("sync_pushes_total"));
    assert!(text.contains("sync_push_duration_ms"));
    assert!(text.contains("sync_pull_duration_ms"));
    assert!(text.contains("sync_anchor_expired_total"));
}

/// Smoke test for the observability counters added with the operations
/// runbook (docs/archived/2026-08-15-unify-auth-and-sync.md §11.5 item 9): drive a REAL 429 from
/// the token-mint rate limiter and a REAL 5xx from an unconfigured
/// webhook secret, then assert the /metrics endpoint renders both
/// counters at their expected values.
#[tokio::test]
async fn metrics_render_rate_limit_and_webhook_counters() {
    let app = test_app();

    // ── 429: exhaust the token-mint limiter (30/min/IP) ──────
    // The limiter runs BEFORE auth, so no credentials are needed; all
    // requests share the "unknown" IP bucket (no proxy headers).
    let mut last_status = StatusCode::OK;
    for _ in 0..31 {
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/tokens")
            .header("Content-Type", "application/json")
            .body(Body::from(r#"{"label":"smoke","expiry_hours":1}"#))
            .unwrap();
        last_status = app.clone().oneshot(req).await.unwrap().status();
    }
    assert_eq!(
        last_status,
        StatusCode::TOO_MANY_REQUESTS,
        "the 31st token mint must be rate-limited"
    );

    // ── 5xx: webhook with no STRIPE_WEBHOOK_SECRET configured ──
    // The handler returns 500 before signature verification when the
    // secret is missing; the response-status middleware counts it.
    let req = Request::builder()
        .method("POST")
        .uri("/api/webhooks/stripe")
        .header("stripe-signature", "t=1,v1=irrelevant")
        .header("Content-Type", "application/json")
        .body(Body::from(
            r#"{"id":"evt_smoke","type":"payment_intent.succeeded","data":{"object":{}}}"#,
        ))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(
        resp.status(),
        StatusCode::INTERNAL_SERVER_ERROR,
        "webhook without a configured secret must 500"
    );

    // ── Both counters render on /metrics at the expected values ──
    let req = Request::builder()
        .uri("/metrics")
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = resp.into_body().collect().await.unwrap().to_bytes();
    let text = String::from_utf8_lossy(&body);
    // The counters are process-global, so other tests may have
    // incremented them too; asserting the rendered label lines (the
    // status-code asserts above already prove the events occurred) is
    // the robust smoke check.
    assert!(
        text.contains("rate_limit_429_total{limiter=\"token\"}"),
        "expected the token 429 counter, got:\n{text}"
    );
    assert!(
        text.contains("webhook_5xx_total"),
        "expected the webhook 5xx counter, got:\n{text}"
    );
}

#[tokio::test]
async fn health_returns_ok() {
    let app = test_app();
    // kasirmu-api health endpoint
    let req = Request::builder()
        .uri("/api/v1/health")
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}

#[tokio::test]
async fn cloud_health_api_alias_returns_ok() {
    let app = test_app();
    let req = Request::builder()
        .uri("/api/health")
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body = resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["status"], "ok");
    assert!(json["db_connected"].as_bool().unwrap());
}

#[tokio::test]
async fn cloud_health_returns_ok_with_db_ping() {
    let app = test_app();
    let req = Request::builder()
        .uri("/health")
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body = resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["status"], "ok");
    assert!(json["version"].is_string());
    assert_eq!(json["db"], "sqlite");
    assert!(json["uptime_seconds"].as_u64().is_some());
    assert_eq!(json["db_connected"], true);
    assert!(json["db_latency_us"].as_u64().unwrap() > 0);
    assert_eq!(json["sync_queue_depth"], 0);
    assert!(json["last_sync_at"].is_null());
}

/// The derivation-selection field: present, a plain bool, and equal to what
/// the crypto crate itself says this process chose. The third assertion is
/// what keeps the payload honest - the endpoint may not report an answer the
/// derivation does not actually live by.
#[tokio::test]
async fn cloud_health_reports_the_portable_derivation_selection() {
    let app = test_app();
    let req = Request::builder()
        .uri("/health")
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    let body = resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();

    let field = &json["portable_derivation_uses_master_key"];
    assert!(field.is_boolean(), "must be a plain bool, got {field}");
    assert_eq!(
        field.as_bool().unwrap(),
        kasirmu_core::crypto::master_key_derivation_active(),
        "the payload must carry the derivation own answer"
    );
    // Nothing key-shaped may ride along with it.
    let obj = json.as_object().unwrap();
    let leaking: Vec<&String> = obj
        .keys()
        .filter(|k| {
            let k = k.to_lowercase();
            k.contains("master_key_value") || k.contains("key_hash") || k.contains("key_len")
        })
        .collect();
    assert!(
        leaking.is_empty(),
        "health payload exposed key material: {leaking:?}"
    );
}

/// Measured, not assumed: the OpenAPI drift walk in `openapi_tests.rs`
/// compares documented fields against the serde wire shape for
/// `PushOutcome`/`PushResponse` ONLY - it never reaches `HealthResponse`, so
/// a field could be live-but-undocumented (or documented-but-gone) without
/// anything going red. This closes that gap for this one payload.
#[tokio::test]
async fn health_payload_matches_its_published_schema() {
    let app = test_app();
    let req = Request::builder()
        .uri("/health")
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    let body = resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();

    let emitted: std::collections::BTreeSet<String> =
        json.as_object().unwrap().keys().cloned().collect();
    let spec = openapi::openapi_spec();
    let props = spec["components"]["schemas"]["HealthResponse"]["properties"]
        .as_object()
        .expect("HealthResponse properties must be documented");
    let documented: std::collections::BTreeSet<String> = props.keys().cloned().collect();

    assert_eq!(
        documented, emitted,
        "the published HealthResponse schema and the real payload have drifted apart"
    );
}

#[tokio::test]
async fn cloud_health_reports_queue_depth() {
    let state = CloudServerState {
        db: Arc::new(Mutex::new(fresh_db())),
        pg: None,
        started_at: Instant::now(),
        health_depth_cache: HealthDepthCache::default(),
        stripe_webhook_secret: None,
        square_webhook_signature_key: None,
        square_webhook_url: None,
        midtrans_server_key: None,
        midtrans_sandbox: false,
        midtrans_qris_acquirer: None,
    };
    let app = build_router(
        state.clone(),
        crate::rate_limit::RateLimiterState::new(),
        &test_config(),
        None,
    );

    // Seed some pending queue items
    {
        let conn = state.db.lock().await;
        conn.execute_batch(
            "INSERT INTO offline_queue (id, action, payload, status, created_at, synced_at, tenant_id) VALUES
             ('h-1', 'act', '{}', 'pending', '2026-06-01T00:00:00Z', NULL, 't1'),
             ('h-2', 'act', '{}', 'pending', '2026-06-02T00:00:00Z', NULL, 't1'),
             ('h-3', 'act', '{}', 'synced', '2026-06-03T00:00:00Z', '2026-06-03T12:00:00Z', 't1')"
        )
        .unwrap();
    }

    let req = Request::builder()
        .uri("/health")
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body = resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["sync_queue_depth"], 2);
    assert!(!json["last_sync_at"].is_null());
}

#[tokio::test]
async fn cloud_health_reports_last_sync_at() {
    let state = CloudServerState {
        db: Arc::new(Mutex::new(fresh_db())),
        pg: None,
        started_at: Instant::now(),
        health_depth_cache: HealthDepthCache::default(),
        stripe_webhook_secret: None,
        square_webhook_signature_key: None,
        square_webhook_url: None,
        midtrans_server_key: None,
        midtrans_sandbox: false,
        midtrans_qris_acquirer: None,
    };
    let app = build_router(
        state.clone(),
        crate::rate_limit::RateLimiterState::new(),
        &test_config(),
        None,
    );

    // Seed some items with various synced_at times
    {
        let conn = state.db.lock().await;
        conn.execute_batch(
            "INSERT INTO offline_queue (id, action, payload, status, created_at, synced_at, tenant_id) VALUES
             ('h-a', 'act', '{}', 'synced', '2026-06-01T00:00:00Z', '2026-06-02T12:00:00Z', 't1'),
             ('h-b', 'act', '{}', 'synced', '2026-06-03T00:00:00Z', '2026-06-04T08:30:00Z', 't1')"
        )
        .unwrap();
    }

    let req = Request::builder()
        .uri("/health")
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body = resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["last_sync_at"], "2026-06-04T08:30:00Z");
}

// ── Console smoke test (tokio-console) ───────────────────────────

#[cfg(all(feature = "console", tokio_unstable))]
#[tokio::test]
async fn console_subscriber_inits_without_panic() {
    // This test verifies that the console subscriber can be
    // initialised without panicking. In CI it's a no-op since the
    // `console` feature is not enabled; run locally with:
    //   RUSTFLAGS="--cfg tokio_unstable" cargo test --features console -p kasirmu-cloud
    console_subscriber::init();
    // If we get here, init succeeded (no double-init panic).
    tracing::info!("tokio-console smoke test passed");
}

#[tokio::test]
async fn sync_status_returns_ok_with_auth() {
    let app = test_app();
    let req = with_auth("/api/sync/status", None);
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}

#[tokio::test]
async fn token_mint_is_rate_limited_per_ip() {
    let app = test_app();
    let mint = |ip: &str| {
        Request::builder()
            .method("POST")
            .uri("/api/v1/tokens")
            .header("content-type", "application/json")
            .header("x-forwarded-for", ip)
            .body(Body::from(r#"{"label":"rate-limit-test"}"#))
            .unwrap()
    };

    // Open dev mint (no admin key): 30 mints allowed per IP.
    for i in 0..30 {
        let resp = app.clone().oneshot(mint("203.0.113.10")).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK, "mint {i} should succeed");
    }
    // The 31st mint from the same IP is throttled.
    let resp = app.clone().oneshot(mint("203.0.113.10")).await.unwrap();
    assert_eq!(resp.status(), StatusCode::TOO_MANY_REQUESTS);
    // A different IP still has its own bucket.
    let resp = app.oneshot(mint("203.0.113.11")).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}

#[tokio::test]
async fn sync_push_and_pull_roundtrip() {
    let state = CloudServerState {
        db: Arc::new(Mutex::new(fresh_db())),
        pg: None,
        started_at: Instant::now(),
        health_depth_cache: HealthDepthCache::default(),
        stripe_webhook_secret: None,
        square_webhook_signature_key: None,
        square_webhook_url: None,
        midtrans_server_key: None,
        midtrans_sandbox: false,
        midtrans_qris_acquirer: None,
    };
    let rate_limiter = crate::rate_limit::RateLimiterState::new();
    let app = build_router(state.clone(), rate_limiter, &test_config(), None);

    // Seed an item directly with tenant_id
    {
        let conn = state.db.lock().await;
        conn.execute(
            "INSERT INTO offline_queue (id, action, payload, status, created_at, tenant_id) 
             VALUES (?1, ?2, ?3, 'pending', datetime('now'), 'default')",
            rusqlite::params!["test-id", "complete_sale", r#"{"total":100}"#],
        )
        .unwrap();
    }

    // Pull should return the seeded item (for default tenant)
    let req = authed_post("/api/sync/pull", r#"{"since": null}"#, None);
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body = resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let items = json["items"].as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["id"], "test-id");
    assert_eq!(items[0]["action"], "complete_sale");
}

#[tokio::test]
async fn cors_allowed_origin_echoed() {
    let app = test_app();
    let req = Request::builder()
        .uri("/api/sync/status")
        .header("Authorization", format!("Bearer {}", test_token(None)))
        .header("Origin", "tauri://localhost")
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    let allow_origin = resp
        .headers()
        .get("access-control-allow-origin")
        .map(|v| v.to_str().unwrap());
    assert_eq!(allow_origin, Some("tauri://localhost"));
}

#[tokio::test]
async fn cors_disallowed_origin_gets_no_header() {
    let app = test_app();
    let req = Request::builder()
        .uri("/api/sync/status")
        .header("Authorization", format!("Bearer {}", test_token(None)))
        .header("Origin", "http://evil.example")
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert!(
        resp.headers().get("access-control-allow-origin").is_none(),
        "disallowed origin must not receive CORS headers"
    );
}

#[tokio::test]
async fn unknown_route_returns_401_or_404() {
    let app = test_app();
    let req = Request::builder()
        .uri("/api/unknown")
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    // Auth middleware on sync router catches unknown routes before
    // the 404 handler; both 401 and 404 are acceptable.
    assert!(
        resp.status() == StatusCode::UNAUTHORIZED || resp.status() == StatusCode::NOT_FOUND,
        "expected 401 or 404, got: {}",
        resp.status()
    );
}

// ── Multi-tenant isolation integration tests ─────────────────────

#[tokio::test]
async fn multi_tenant_tenant_a_push_invisible_to_tenant_b() {
    let state = CloudServerState {
        db: Arc::new(Mutex::new(fresh_db())),
        pg: None,
        started_at: Instant::now(),
        health_depth_cache: HealthDepthCache::default(),
        stripe_webhook_secret: None,
        square_webhook_signature_key: None,
        square_webhook_url: None,
        midtrans_server_key: None,
        midtrans_sandbox: false,
        midtrans_qris_acquirer: None,
    };
    let rate_limiter = crate::rate_limit::RateLimiterState::new();
    let app = build_router(state.clone(), rate_limiter, &test_config(), None);

    // Tenant A pushes two items (real UUID ids — push_handler rejects
    // non-UUID ids; see round 121)
    let a_id_1 = uuid::Uuid::now_v7().to_string();
    let a_id_2 = uuid::Uuid::now_v7().to_string();
    let push_body = format!(
        r#"[
            {{"id":"{a_id_1}","action":"sale.create","payload":"{{\"total\":100}}","status":"pending","retry_count":0,"last_error":null,"created_at":"2026-06-01T00:00:00Z","synced_at":null}},
            {{"id":"{a_id_2}","action":"sale.void","payload":"{{\"reason\":\"test\"}}","status":"pending","retry_count":0,"last_error":null,"created_at":"2026-06-02T00:00:00Z","synced_at":null}}
        ]"#
    );
    let push_req = authed_post("/api/sync/push", &push_body, Some("tenant-a"));
    let push_resp = app.clone().oneshot(push_req).await.unwrap();
    assert_eq!(push_resp.status(), StatusCode::OK);

    // Tenant B pulls — should see ZERO items (isolation)
    let pull_req = authed_post("/api/sync/pull", r#"{"since":null}"#, Some("tenant-b"));
    let pull_resp = app.clone().oneshot(pull_req).await.unwrap();
    assert_eq!(pull_resp.status(), StatusCode::OK);
    let body = pull_resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(
        json["items"].as_array().unwrap().len(),
        0,
        "Tenant B should see zero items from Tenant A's push"
    );

    // Tenant A pulls — should see its 2 items
    let pull_a = authed_post("/api/sync/pull", r#"{"since":null}"#, Some("tenant-a"));
    let resp_a = app.clone().oneshot(pull_a).await.unwrap();
    let body_a = resp_a.into_body().collect().await.unwrap().to_bytes();
    let json_a: serde_json::Value = serde_json::from_slice(&body_a).unwrap();
    assert_eq!(json_a["items"].as_array().unwrap().len(), 2);
    assert_eq!(json_a["items"][0]["id"], a_id_1);
    assert_eq!(json_a["items"][1]["id"], a_id_2);
}

#[tokio::test]
async fn multi_tenant_bidirectional_isolation() {
    let state = CloudServerState {
        db: Arc::new(Mutex::new(fresh_db())),
        pg: None,
        started_at: Instant::now(),
        health_depth_cache: HealthDepthCache::default(),
        stripe_webhook_secret: None,
        square_webhook_signature_key: None,
        square_webhook_url: None,
        midtrans_server_key: None,
        midtrans_sandbox: false,
        midtrans_qris_acquirer: None,
    };
    let rate_limiter = crate::rate_limit::RateLimiterState::new();
    let app = build_router(state.clone(), rate_limiter, &test_config(), None);

    // Tenant A pushes one item (real UUID id)
    let id_a = uuid::Uuid::now_v7().to_string();
    let push_a = authed_post(
        "/api/sync/push",
        &format!(
            r#"[{{"id":"{id_a}","action":"act","payload":"{{}}","status":"pending","retry_count":0,"last_error":null,"created_at":"2026-06-01T00:00:00Z","synced_at":null}}]"#
        ),
        Some("tenant-a"),
    );
    let r = app.clone().oneshot(push_a).await.unwrap();
    assert_eq!(r.status(), StatusCode::OK);

    // Tenant B pushes one item (real UUID id)
    let id_b = uuid::Uuid::now_v7().to_string();
    let push_b = authed_post(
        "/api/sync/push",
        &format!(
            r#"[{{"id":"{id_b}","action":"act","payload":"{{}}","status":"pending","retry_count":0,"last_error":null,"created_at":"2026-06-01T00:00:00Z","synced_at":null}}]"#
        ),
        Some("tenant-b"),
    );
    let r = app.clone().oneshot(push_b).await.unwrap();
    assert_eq!(r.status(), StatusCode::OK);

    // Tenant A should see ONLY its own item
    let pull_a = authed_post("/api/sync/pull", r#"{"since":null}"#, Some("tenant-a"));
    let r_a = app.clone().oneshot(pull_a).await.unwrap();
    let b_a = r_a.into_body().collect().await.unwrap().to_bytes();
    let j_a: serde_json::Value = serde_json::from_slice(&b_a).unwrap();
    let items_a = j_a["items"].as_array().unwrap();
    assert_eq!(items_a.len(), 1, "Tenant A sees only its own items");
    assert_eq!(items_a[0]["id"], id_a);

    // Tenant B should see ONLY its own item
    let pull_b = authed_post("/api/sync/pull", r#"{"since":null}"#, Some("tenant-b"));
    let r_b = app.oneshot(pull_b).await.unwrap();
    let b_b = r_b.into_body().collect().await.unwrap().to_bytes();
    let j_b: serde_json::Value = serde_json::from_slice(&b_b).unwrap();
    let items_b = j_b["items"].as_array().unwrap();
    assert_eq!(items_b.len(), 1, "Tenant B sees only its own items");
    assert_eq!(items_b[0]["id"], id_b);
}

#[tokio::test]
async fn multi_tenant_status_scoped_per_tenant() {
    let state = CloudServerState {
        db: Arc::new(Mutex::new(fresh_db())),
        pg: None,
        started_at: Instant::now(),
        health_depth_cache: HealthDepthCache::default(),
        stripe_webhook_secret: None,
        square_webhook_signature_key: None,
        square_webhook_url: None,
        midtrans_server_key: None,
        midtrans_sandbox: false,
        midtrans_qris_acquirer: None,
    };
    let rate_limiter = crate::rate_limit::RateLimiterState::new();
    let app = build_router(state.clone(), rate_limiter, &test_config(), None);

    // Tenant A pushes 3 items (real UUID ids)
    let a_ids: Vec<String> = (0..3).map(|_| uuid::Uuid::now_v7().to_string()).collect();
    let push_a_body = format!(
        r#"[
            {{"id":"{0}","action":"act","payload":"{{}}","status":"pending","retry_count":0,"last_error":null,"created_at":"2026-06-01T00:00:00Z","synced_at":null}},
            {{"id":"{1}","action":"act","payload":"{{}}","status":"pending","retry_count":0,"last_error":null,"created_at":"2026-06-01T00:00:00Z","synced_at":null}},
            {{"id":"{2}","action":"act","payload":"{{}}","status":"pending","retry_count":0,"last_error":null,"created_at":"2026-06-01T00:00:00Z","synced_at":null}}
        ]"#,
        a_ids[0], a_ids[1], a_ids[2]
    );
    let push_a = authed_post("/api/sync/push", &push_a_body, Some("tenant-a"));
    let r = app.clone().oneshot(push_a).await.unwrap();
    assert_eq!(r.status(), StatusCode::OK);

    // Tenant B pushes 1 item (real UUID id)
    let b_id = uuid::Uuid::now_v7().to_string();
    let push_b = authed_post(
        "/api/sync/push",
        &format!(
            r#"[{{"id":"{b_id}","action":"act","payload":"{{}}","status":"pending","retry_count":0,"last_error":null,"created_at":"2026-06-01T00:00:00Z","synced_at":null}}]"#
        ),
        Some("tenant-b"),
    );
    let r = app.clone().oneshot(push_b).await.unwrap();
    assert_eq!(r.status(), StatusCode::OK);

    // Tenant A status: 3 pending
    let s_a = with_auth("/api/sync/status", Some("tenant-a"));
    let r_a = app.clone().oneshot(s_a).await.unwrap();
    let b_a = r_a.into_body().collect().await.unwrap().to_bytes();
    let j_a: serde_json::Value = serde_json::from_slice(&b_a).unwrap();
    assert_eq!(j_a["pending_count"], 3);

    // Tenant B status: 1 pending
    let s_b = with_auth("/api/sync/status", Some("tenant-b"));
    let r_b = app.oneshot(s_b).await.unwrap();
    let b_b = r_b.into_body().collect().await.unwrap().to_bytes();
    let j_b: serde_json::Value = serde_json::from_slice(&b_b).unwrap();
    assert_eq!(j_b["pending_count"], 1);
}

#[tokio::test]
async fn multi_tenant_default_tenant_isolation() {
    let state = CloudServerState {
        db: Arc::new(Mutex::new(fresh_db())),
        pg: None,
        started_at: Instant::now(),
        health_depth_cache: HealthDepthCache::default(),
        stripe_webhook_secret: None,
        square_webhook_signature_key: None,
        square_webhook_url: None,
        midtrans_server_key: None,
        midtrans_sandbox: false,
        midtrans_qris_acquirer: None,
    };
    let rate_limiter = crate::rate_limit::RateLimiterState::new();
    let app = build_router(state.clone(), rate_limiter, &test_config(), None);

    // Push items as default tenant (real UUID id)
    let def_id = uuid::Uuid::now_v7().to_string();
    let push_d = authed_post(
        "/api/sync/push",
        &format!(
            r#"[{{"id":"{def_id}","action":"act","payload":"{{}}","status":"pending","retry_count":0,"last_error":null,"created_at":"2026-06-01T00:00:00Z","synced_at":null}}]"#
        ),
        None,
    );
    let r = app.clone().oneshot(push_d).await.unwrap();
    assert_eq!(r.status(), StatusCode::OK);

    // Explicit tenant-c should NOT see default tenant's items
    let pull_c = authed_post("/api/sync/pull", r#"{"since":null}"#, Some("tenant-c"));
    let r_c = app.clone().oneshot(pull_c).await.unwrap();
    let b_c = r_c.into_body().collect().await.unwrap().to_bytes();
    let j_c: serde_json::Value = serde_json::from_slice(&b_c).unwrap();
    assert_eq!(
        j_c["items"].as_array().unwrap().len(),
        0,
        "tenant-c should not see default tenant items"
    );

    // Default tenant should see its own item
    let pull_d = authed_post("/api/sync/pull", r#"{"since":null}"#, None);
    let r_d = app.oneshot(pull_d).await.unwrap();
    let b_d = r_d.into_body().collect().await.unwrap().to_bytes();
    let j_d: serde_json::Value = serde_json::from_slice(&b_d).unwrap();
    assert_eq!(j_d["items"].as_array().unwrap().len(), 1);
    assert_eq!(j_d["items"][0]["id"], def_id);
}

/// Full lifecycle: free tenant push → rejected → Stripe webhook
/// upgrades plan → same push now accepted.
#[tokio::test]
async fn lifecycle_free_tenant_upgraded_via_webhook_can_sync() {
    let secret = "whsec_lifecycle_test";
    let state = CloudServerState {
        db: Arc::new(Mutex::new(fresh_db())),
        pg: None,
        started_at: Instant::now(),
        health_depth_cache: HealthDepthCache::default(),
        stripe_webhook_secret: Some(secret.to_string()),
        square_webhook_signature_key: None,
        square_webhook_url: None,
        midtrans_server_key: None,
        midtrans_sandbox: false,
        midtrans_qris_acquirer: None,
    };
    let mut config = test_config();
    config.enforce_plans = true;
    config.stripe_webhook_secret = Some(secret.to_string());
    let rate_limiter = crate::rate_limit::RateLimiterState::new();
    let app = build_router(state.clone(), rate_limiter, &config, None);

    let tenant = "lifecycle-tenant";
    let sale_id = uuid::Uuid::now_v7().to_string();
    let body = format!(
        r#"[{{"id":"{sale_id}","action":"complete_sale","payload":"{{}}","status":"pending","retry_count":0,"last_error":null,"created_at":"2026-01-01T00:00:00Z","synced_at":null}}]"#
    );

    // Step 1: Push as free tenant → rejected
    let req = authed_post("/api/sync/push", &body, Some(tenant));
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(
        resp.status(),
        StatusCode::FORBIDDEN,
        "free tenant must be rejected when plan enforcement is on"
    );
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["error"], "plan_required");

    // Step 2: Fire Stripe webhook to upgrade tenant to pro
    let webhook_payload = serde_json::json!({
        "id": "evt_lifecycle_test",
        "type": "customer.subscription.created",
        "data": { "object": {
            "id": "sub_lifecycle",
            "customer": "cus_lifecycle",
            "status": "active",
            "metadata": { "tenant_id": tenant },
        }},
    });
    let webhook_bytes = serde_json::to_vec(&webhook_payload).unwrap();
    let sig = lifecycle_stripe_signature(&webhook_bytes, secret);

    let webhook_req = Request::builder()
        .method("POST")
        .uri("/api/webhooks/stripe")
        .header("Content-Type", "application/json")
        .header("Stripe-Signature", &sig)
        .body(Body::from(webhook_bytes))
        .unwrap();
    let webhook_resp = app.clone().oneshot(webhook_req).await.unwrap();
    assert_eq!(
        webhook_resp.status(),
        StatusCode::OK,
        "webhook must upgrade tenant successfully"
    );
    let wb = webhook_resp.into_body().collect().await.unwrap().to_bytes();
    let wj: serde_json::Value = serde_json::from_slice(&wb).unwrap();
    assert_eq!(wj["plan"], "pro", "tenant must be upgraded to pro");

    // Step 3: Push same sale again → now accepted
    let req2 = authed_post("/api/sync/push", &body, Some(tenant));
    let resp2 = app.oneshot(req2).await.unwrap();
    assert_eq!(
        resp2.status(),
        StatusCode::OK,
        "upgraded tenant must be able to sync"
    );
    let b2 = resp2.into_body().collect().await.unwrap().to_bytes();
    let j2: serde_json::Value = serde_json::from_slice(&b2).unwrap();
    let results = j2["results"]
        .as_array()
        .expect("push response must have results array");
    assert_eq!(results.len(), 1, "one push item → one outcome");
    assert_eq!(
        results[0]["outcome"], "accepted",
        "the sale must be accepted after plan upgrade"
    );
}

/// HMAC-SHA256 Stripe signature helper for the lifecycle test.
///
/// Uses the CURRENT unix timestamp: the verifier enforces a ±5 minute
/// freshness window (CS-2 fix), so a fixed historical timestamp would be
/// rejected as stale.
fn lifecycle_stripe_signature(payload: &[u8], secret: &str) -> String {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .to_string();
    let mut signed_bytes = Vec::with_capacity(timestamp.len() + 1 + payload.len());
    signed_bytes.extend_from_slice(timestamp.as_bytes());
    signed_bytes.push(b'.');
    signed_bytes.extend_from_slice(payload);
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).unwrap();
    mac.update(&signed_bytes);
    let expected = hex::encode(mac.finalize().into_bytes());
    format!("t={},v1={}", timestamp, expected)
}

/// Health must fail fast under pool saturation (Bug 3). The Docker
/// healthcheck has its own --timeout=5s; if the health handler waited
/// the full 5s builder wait_timeout while the pool is exhausted, the
/// container would be marked unhealthy and restarted during a burst.
/// The health path bounds its wait to 2s and returns a degraded
/// (db_connected: false) response instead.
#[tokio::test]
async fn pg_integration_health_fails_fast_when_pool_exhausted() {
    let url = std::env::var("OZ_TEST_PG_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:15432/postgres".into());
    let pool = match crate::db::DbPool::connect_postgres(&url, false, 1, false).await {
        Ok(crate::db::DbPool::Postgres(pool)) => pool,
        Ok(_) => unreachable!("postgres:// URL returns Postgres"),
        Err(e) => {
            eprintln!("PG health-under-saturation integration test skipped: {e}");
            return;
        }
    };
    let state = CloudServerState {
        db: Arc::new(Mutex::new(fresh_db())),
        pg: Some(pool.clone()),
        started_at: Instant::now(),
        health_depth_cache: HealthDepthCache::default(),
        stripe_webhook_secret: None,
        square_webhook_signature_key: None,
        square_webhook_url: None,
        midtrans_server_key: None,
        midtrans_sandbox: false,
        midtrans_qris_acquirer: None,
    };
    let app = build_router(
        state,
        crate::rate_limit::RateLimiterState::new(),
        &test_config(),
        None,
    );

    // Exhaust the max_size(1) pool.
    let _held = pool.get().await.expect("first get should succeed");

    // The health request must complete within ~2s (not the 5s builder
    // wait_timeout) with a degraded response.
    let start = std::time::Instant::now();
    let req = Request::builder()
        .uri("/health")
        .body(Body::empty())
        .unwrap();
    let resp = tokio::time::timeout(std::time::Duration::from_secs(4), app.oneshot(req))
        .await
        .expect("health must complete within 4s — it should fail fast, not wait the full 5s pool timeout")
        .expect("tower oneshot error is infallible");
    let elapsed = start.elapsed();

    assert_eq!(
        resp.status(),
        StatusCode::OK,
        "health always returns 200 with a degraded payload"
    );
    let body = resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(
        json["db_connected"], false,
        "exhausted pool must be reported as db_connected: false"
    );
    assert!(
        elapsed < std::time::Duration::from_secs(3),
        "health must fail fast (~2s), took {elapsed:?}"
    );
}

/// The health endpoint's `SELECT MAX(synced_at) FROM offline_queue`
/// runs on every Docker healthcheck (every 15s). Without an index on
/// synced_at it is a full table scan over the 90-day retention queue —
/// constant O(n) cost on the free-tier CPU budget, exactly the class of
/// waste the SOTA pass eliminated elsewhere. The index must exist in
/// PG_INIT so the query is an index scan.
#[tokio::test]
async fn pg_integration_health_last_sync_query_is_indexed() {
    let url = std::env::var("OZ_TEST_PG_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:15432/postgres".into());
    let pool = match crate::db::DbPool::connect_postgres(&url, false, 20, true).await {
        Ok(crate::db::DbPool::Postgres(pool)) => pool,
        Ok(_) => unreachable!("connect_postgres with a postgres:// URL returns Postgres"),
        Err(e) => {
            eprintln!("PG health-index integration test skipped: {e}");
            return;
        }
    };

    // The index must exist in the applied PG_INIT schema.
    let client = pool.get().await.unwrap();
    let index: Option<String> = client
        .query_opt(
            "SELECT indexname FROM pg_indexes
             WHERE tablename = 'offline_queue' AND indexname = 'idx_offline_queue_synced_at'",
            &[],
        )
        .await
        .unwrap()
        .map(|r| r.get(0));
    assert!(
        index.is_some(),
        "idx_offline_queue_synced_at must exist — the health MAX(synced_at) query \
         (every 15s) full-scans without it"
    );

    // Prove the plan uses the index, not a Seq Scan, on a non-trivial
    // table. Unique ids per run (uuid prefix) so re-runs never collide
    // with leftover rows; clean leftovers first.
    let seed_tenant = format!("health-index-seed-{}", uuid::Uuid::now_v7());
    client
        .execute(
            "DELETE FROM offline_queue WHERE tenant_id LIKE 'health-index-seed-%'",
            &[],
        )
        .await
        .unwrap();
    client
        .execute(
            "INSERT INTO offline_queue (id, action, payload, status, created_at, tenant_id)
             SELECT 'seed-' || g || '-' || $1, 'act', '{}', 'synced',
                    '2026-01-01T00:00:00Z', $2
             FROM generate_series(1, 2000) g",
            &[&uuid::Uuid::now_v7().simple().to_string(), &seed_tenant],
        )
        .await
        .unwrap();
    // EXPLAIN returns one row PER PLAN LINE; join them all.
    let rows = client
        .query(
            "EXPLAIN SELECT MAX(synced_at) FROM offline_queue WHERE synced_at IS NOT NULL",
            &[],
        )
        .await
        .unwrap();
    let plan: String = rows
        .iter()
        .map(|r| r.get::<_, String>(0))
        .collect::<Vec<_>>()
        .join(" ");
    assert!(
        !plan.contains("Seq Scan"),
        "health MAX(synced_at) must use the index, got plan: {plan}"
    );
    assert!(
        plan.contains("Index Scan")
            || plan.contains("Index Only Scan")
            || plan.contains("Bitmap Index"),
        "health MAX(synced_at) must use an index scan, got plan: {plan}"
    );

    client
        .execute(
            "DELETE FROM offline_queue WHERE tenant_id = $1",
            &[&seed_tenant],
        )
        .await
        .unwrap();
}

#[tokio::test]
async fn request_id_middleware_generates_id_when_missing() {
    let app = test_app();
    let req = Request::builder()
        .uri("/health")
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let req_id = resp
        .headers()
        .get("x-request-id")
        .expect("response must include x-request-id header")
        .to_str()
        .unwrap();
    assert!(!req_id.is_empty());
}

#[tokio::test]
async fn request_id_middleware_preserves_incoming_id() {
    let app = test_app();
    let custom_id = "custom-client-req-12345";
    let req = Request::builder()
        .uri("/health")
        .header("x-request-id", custom_id)
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let req_id = resp
        .headers()
        .get("x-request-id")
        .expect("response must include x-request-id header")
        .to_str()
        .unwrap();
    assert_eq!(req_id, custom_id);
}
