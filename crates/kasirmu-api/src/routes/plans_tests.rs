use super::*;
use crate::DEFAULT_CORS_ORIGINS;
use crate::router;
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use std::sync::Arc;
use tokio::sync::Mutex;
use tower::ServiceExt;

fn test_app() -> axum::Router {
    let conn = oz_core::migrations::fresh_db();
    let state = AppState {
        db: Arc::new(Mutex::new(conn)),
        pg: None,
        admin_key: None,
        api_secret: String::new(),
        allow_terminal_credentials: true,
        db_path: ":memory:".into(),
        port: 3099,
        cors_origins: DEFAULT_CORS_ORIGINS.iter().map(|s| s.to_string()).collect(),
        image_dir: std::path::PathBuf::from("./data/images"),
    };
    router(state)
}

async fn body_json(resp: axum::response::Response) -> serde_json::Value {
    let bytes = resp
        .into_body()
        .collect()
        .await
        .expect("collect body")
        .to_bytes();
    serde_json::from_slice(&bytes).expect("parse JSON body")
}

fn put_plan(uri: &str, body: &str, admin_key: Option<&str>) -> Request<Body> {
    let mut builder = Request::builder()
        .method("PUT")
        .uri(uri)
        .header("Content-Type", "application/json");
    if let Some(key) = admin_key {
        builder = builder.header("X-Admin-Key", key);
    }
    builder.body(Body::from(body.to_owned())).unwrap()
}

fn authed_get(uri: &str, tenant_id: Option<&str>) -> Request<Body> {
    let token = crate::auth::create_token("test", Some(1), tenant_id, None)
        .unwrap()
        .token;
    Request::builder()
        .method("GET")
        .uri(uri)
        .header("Authorization", format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap()
}

// ── Self plan read (ADR sync-plan-gating follow-up) ──────────

#[tokio::test]
async fn get_my_plan_returns_pro_after_set() {
    let app = test_app();
    // Seed a pro plan for tenant-a via the admin endpoint.
    let resp = app
        .clone()
        .oneshot(put_plan(
            "/api/v1/tenants/tenant-a/plan",
            r#"{"plan":"pro"}"#,
            None,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let resp = app
        .oneshot(authed_get("/api/v1/tenants/me/plan", Some("tenant-a")))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let json = body_json(resp).await;
    assert_eq!(json["tenant_id"], "tenant-a");
    assert_eq!(json["plan"], "pro");
}

#[tokio::test]
async fn get_my_plan_defaults_to_free_when_no_row() {
    let app = test_app();
    let resp = app
        .oneshot(authed_get("/api/v1/tenants/me/plan", Some("tenant-nobody")))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let json = body_json(resp).await;
    assert_eq!(json["tenant_id"], "tenant-nobody");
    assert_eq!(json["plan"], "free", "missing row must fail closed to free");
}

#[tokio::test]
async fn get_my_plan_requires_auth() {
    let app = test_app();
    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/tenants/me/plan")
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn set_plan_pro_returns_stored_plan() {
    let app = test_app();
    let resp = app
        .oneshot(put_plan(
            "/api/v1/tenants/tenant-a/plan",
            r#"{"plan":"pro"}"#,
            None,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let json = body_json(resp).await;
    assert_eq!(json["tenant_id"], "tenant-a");
    assert_eq!(json["plan"], "pro");
}

#[tokio::test]
async fn set_plan_free_accepted() {
    let app = test_app();
    let resp = app
        .oneshot(put_plan(
            "/api/v1/tenants/tenant-a/plan",
            r#"{"plan":"free"}"#,
            None,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let json = body_json(resp).await;
    assert_eq!(json["plan"], "free");
}

#[tokio::test]
async fn set_plan_unknown_plan_rejected() {
    let app = test_app();
    let resp = app
        .oneshot(put_plan(
            "/api/v1/tenants/tenant-a/plan",
            r#"{"plan":"enterprise"}"#,
            None,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let json = body_json(resp).await;
    assert_eq!(json["error"], "unknown_plan");
}

#[tokio::test]
async fn set_plan_rejects_invalid_tenant_id() {
    let app = test_app();
    // Same charset rule as settings.rs — a tenant ID outside `[A-Za-z0-9_-]`
    // or longer than 64 must be rejected before touching the store. Use an
    // overlong (65-char) ID: it is URI-safe, so the request builds, and
    // `valid_tenant` rejects it.
    let tenant = "t".repeat(65);
    let uri = format!("/api/v1/tenants/{tenant}/plan");
    let resp = app
        .oneshot(put_plan(&uri, r#"{"plan":"pro"}"#, None))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let json = body_json(resp).await;
    assert_eq!(json["error"], "invalid_tenant");
}

#[tokio::test]
async fn set_plan_requires_admin_key_when_configured() {
    let conn = oz_core::migrations::fresh_db();
    let state = AppState {
        db: Arc::new(Mutex::new(conn)),
        pg: None,
        admin_key: Some("super-secret".to_string()),
        api_secret: String::new(),
        allow_terminal_credentials: true,
        db_path: ":memory:".into(),
        port: 3099,
        cors_origins: DEFAULT_CORS_ORIGINS.iter().map(|s| s.to_string()).collect(),
        image_dir: std::path::PathBuf::from("./data/images"),
    };
    let app = router(state);

    // No key → 401.
    let resp = app
        .clone()
        .oneshot(put_plan(
            "/api/v1/tenants/tenant-a/plan",
            r#"{"plan":"pro"}"#,
            None,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);

    // Wrong key → 401.
    let resp = app
        .clone()
        .oneshot(put_plan(
            "/api/v1/tenants/tenant-a/plan",
            r#"{"plan":"pro"}"#,
            Some("wrong-key"),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);

    // Correct key → 200.
    let resp = app
        .oneshot(put_plan(
            "/api/v1/tenants/tenant-a/plan",
            r#"{"plan":"pro"}"#,
            Some("super-secret"),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}
