//! Tests for `api_audit.rs` — the middleware's capture rules and the
//! router integration (auth short-circuit, GET silence, write capture).

use std::sync::{Arc, Mutex};

use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::routing::{get, put};
use tower::ServiceExt;

use super::{ApiWriteEvent, AuditSink};
use crate::api_audit::audit_middleware;

#[derive(Default)]
struct Collector(Arc<Mutex<Vec<ApiWriteEvent>>>);

impl Collector {
    fn take(&self) -> Vec<ApiWriteEvent> {
        std::mem::take(&mut *self.0.lock().unwrap())
    }
}

impl AuditSink for Collector {
    fn record(&self, event: &ApiWriteEvent) {
        self.0.lock().unwrap().push(event.clone());
    }
}

fn app(secret: &str, sink: Arc<Collector>) -> Router {
    use axum::middleware;
    async fn ok() -> (StatusCode, &'static str) {
        (StatusCode::OK, "done")
    }
    async fn fail() -> (StatusCode, &'static str) {
        (StatusCode::UNPROCESSABLE_ENTITY, "nope")
    }
    async fn read() -> (StatusCode, &'static str) {
        (StatusCode::OK, "read")
    }
    Router::new()
        .route("/api/v1/thing", put(ok))
        .route("/api/v1/bad", put(fail))
        .route("/api/v1/other", get(read))
        .route("/notapi", put(ok))
        .layer(middleware::from_fn_with_state(
            sink as Arc<dyn AuditSink>,
            audit_middleware,
        ))
        .layer(middleware::from_fn_with_state(
            crate::auth::AuthState {
                secret: Arc::new(secret.to_string()),
            },
            crate::auth::auth_middleware_with_state,
        ))
}

fn bearer(secret: &str, sub: &str) -> String {
    crate::auth::create_token_full(sub, None, None, None, None, Some(secret))
        .expect("mint")
        .token
}

#[tokio::test]
async fn write_with_valid_token_is_captured_with_claims() {
    let secret = "audit-test-secret";
    let sink = Arc::new(Collector::default());
    let app = app(secret, sink.clone());
    let tok = bearer(secret, "kds-script");
    let resp = app
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri("/api/v1/thing")
                .header("authorization", format!("Bearer {tok}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let events = sink.take();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].method, "PUT");
    assert_eq!(events[0].path, "/api/v1/thing");
    assert_eq!(events[0].status, 200);
    assert_eq!(events[0].token_label.as_deref(), Some("kds-script"));
}

#[tokio::test]
async fn failed_write_records_failure_status() {
    let secret = "audit-test-secret";
    let sink = Arc::new(Collector::default());
    let app = app(secret, sink.clone());
    let tok = bearer(secret, "op");
    let resp = app
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri("/api/v1/bad")
                .header("authorization", format!("Bearer {tok}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let events = sink.take();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].status, 422);
}

#[tokio::test]
async fn unauthenticated_write_never_reaches_sink() {
    let sink = Arc::new(Collector::default());
    let app = app("s", sink.clone());
    let resp = app
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri("/api/v1/thing")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    assert!(sink.take().is_empty(), "401 must not produce audit events");
}

#[tokio::test]
async fn reads_and_non_api_paths_are_silent() {
    let secret = "audit-test-secret";
    let sink = Arc::new(Collector::default());
    let app = app(secret, sink.clone());
    let tok = bearer(secret, "op");
    for (method, uri) in [("GET", "/api/v1/other"), ("PUT", "/notapi")] {
        let resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(uri)
                    .header("authorization", format!("Bearer {tok}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK, "{method} {uri}");
    }
    assert!(sink.take().is_empty());
}
