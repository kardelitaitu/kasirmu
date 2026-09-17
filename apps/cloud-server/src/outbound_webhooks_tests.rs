//! Tests for `outbound_webhooks.rs` — validation, registry CRUD,
//! fan-out filtering, HMAC signing, delivery against a live local
//! receiver, and the admin API surface.

use super::*;

use axum::routing::post;
use tower::ServiceExt;

fn fresh_db() -> rusqlite::Connection {
    kasirmu_core::migrations::fresh_db()
}

// ── Validation ──────────────────────────────────────────────────────

#[test]
fn validate_url_accepts_http_and_https() {
    assert!(validate_url("http://127.0.0.1:8090/hooks").is_ok());
    assert!(validate_url("https://scripts.example.com/oz-events?t=1").is_ok());
}

#[test]
fn validate_url_rejects_other_schemes_and_shapes() {
    assert!(validate_url("ftp://example.com").is_err());
    assert!(validate_url("https://").is_err());
    assert!(validate_url("example.com/hooks").is_err());
    assert!(validate_url("https://exa mple.com").is_err());
    assert!(validate_url(&format!("https://e.com/{}", "x".repeat(2100))).is_err());
}

#[test]
fn validate_events_enforces_vocabulary() {
    assert!(validate_events(&["complete_sale".into()]).is_ok());
    assert!(validate_events(&["*".into()]).is_ok());
    assert!(validate_events(&["complete_sale".into(), "stock.movement".into()]).is_ok());
    assert!(validate_events(&[] as &[String]).is_err());
    assert!(validate_events(&["nonsense".into()]).is_err());
}

#[test]
fn is_event_action_matches_vocabulary_only() {
    assert!(is_event_action("complete_sale"));
    assert!(is_event_action("stock.adjusted"));
    assert!(!is_event_action("settings.changed"));
    assert!(!is_event_action("*")); // wildcard is a subscription, not an event
}

// ── Registry CRUD (SQLite) ──────────────────────────────────────────

#[test]
fn registry_create_list_delete_roundtrip() {
    let db = fresh_db();
    let (ep, secret) =
        create_endpoint_sqlite(&db, "default", "https://e.com/h", &["*".into()]).unwrap();
    assert_eq!(secret.len(), 32);
    assert!(ep.active);

    let list = list_endpoints_sqlite(&db, "default").unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].id, ep.id);
    // Listings never expose the signing secret (EndpointRow::public drops it).
    assert!(!serde_json::to_string(&list[0]).unwrap().contains(&secret));

    assert!(delete_endpoint_sqlite(&db, "default", &ep.id).unwrap());
    assert!(!delete_endpoint_sqlite(&db, "default", &ep.id).unwrap()); // second delete: false
    assert!(list_endpoints_sqlite(&db, "default").unwrap().is_empty());
}

#[test]
fn registry_rejects_invalid_input() {
    let db = fresh_db();
    assert!(create_endpoint_sqlite(&db, "t", "ftp://bad", &["*".into()]).is_err());
    assert!(create_endpoint_sqlite(&db, "t", "https://ok", &["bogus".into()]).is_err());
}

#[test]
fn registry_is_tenant_scoped() {
    let db = fresh_db();
    create_endpoint_sqlite(&db, "acme", "https://e.com/a", &["*".into()]).unwrap();
    assert!(list_endpoints_sqlite(&db, "other").unwrap().is_empty());
    assert_eq!(list_endpoints_sqlite(&db, "acme").unwrap().len(), 1);
}

// ── Matching ────────────────────────────────────────────────────────

fn row(events: &[&str], active: bool) -> EndpointRow {
    EndpointRow {
        id: "x".into(),
        tenant_id: "default".into(),
        url: "https://e.com".into(),
        secret: "s".into(),
        events: events.iter().map(|s| s.to_string()).collect(),
        active,
        created_at: String::new(),
        updated_at: String::new(),
    }
}

#[test]
fn matching_respects_wildcard_specificity_and_active() {
    assert!(endpoint_matches(&row(&["*"], true), "complete_sale"));
    assert!(endpoint_matches(
        &row(&["complete_sale"], true),
        "complete_sale"
    ));
    assert!(!endpoint_matches(
        &row(&["complete_sale"], true),
        "void_sale"
    ));
    assert!(!endpoint_matches(&row(&["*"], false), "complete_sale")); // inactive
}

// ── Fan-out ─────────────────────────────────────────────────────────

#[tokio::test]
async fn fanout_enqueues_per_matching_endpoint_only() {
    let conn = Arc::new(Mutex::new(fresh_db()));
    {
        let db = conn.lock().await;
        // wildcard endpoint + a complete_sale-only endpoint.
        create_endpoint_sqlite(&db, "default", "https://e.com/all", &["*".into()]).unwrap();
        create_endpoint_sqlite(
            &db,
            "default",
            "https://e.com/sale",
            &["complete_sale".into()],
        )
        .unwrap();
        // A different tenant's endpoint must not receive anything.
        create_endpoint_sqlite(&db, "other", "https://e.com/nope", &["*".into()]).unwrap();
    }
    let items = [
        AcceptedItem {
            item_id: "i1",
            action: "complete_sale",
            payload: r#"{"id":"s1","status":"completed"}"#,
            created_at: "2026-09-03T00:00:00Z",
        },
        AcceptedItem {
            item_id: "i2",
            action: "void_sale",
            payload: r#"{"id":"s2"}"#,
            created_at: "2026-09-03T00:00:01Z",
        },
        AcceptedItem {
            item_id: "i3",
            action: "not_an_event",
            payload: "{}",
            created_at: "2026-09-03T00:00:02Z",
        },
    ];
    let n = fanout(&conn, &None, "default", &items).await.unwrap();
    // complete_sale → 2 endpoints; void_sale → 1 (wildcard); not_an_event → 0.
    assert_eq!(n, 3);

    let db = conn.lock().await;
    let count: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM outbox WHERE topic = 'webhook'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 3);
    // Payload carries the self-contained delivery contract.
    let payload: String = db
        .query_row(
            "SELECT payload FROM outbox WHERE topic = 'webhook' LIMIT 1",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let v: serde_json::Value = serde_json::from_str(&payload).unwrap();
    assert!(v["url"].is_string() && v["secret"].is_string() && v["event"].is_string());
    assert!(v["event_id"].is_string() && v["data"].is_object());
    assert_eq!(v["tenant_id"], "default");
}

#[tokio::test]
async fn fanout_malformed_payload_still_delivers_raw() {
    let conn = Arc::new(Mutex::new(fresh_db()));
    {
        let db = conn.lock().await;
        create_endpoint_sqlite(&db, "default", "https://e.com/all", &["*".into()]).unwrap();
    }
    let items = [AcceptedItem {
        item_id: "i1",
        action: "stock.adjusted",
        payload: "not-json{{{",
        created_at: "2026-09-03T00:00:00Z",
    }];
    assert_eq!(fanout(&conn, &None, "default", &items).await.unwrap(), 1);
    let db = conn.lock().await;
    let payload: String = db
        .query_row("SELECT payload FROM outbox LIMIT 1", [], |r| r.get(0))
        .unwrap();
    let v: serde_json::Value = serde_json::from_str(&payload).unwrap();
    assert_eq!(v["data"]["data_raw"], "not-json{{{");
}

#[tokio::test]
async fn fanout_no_endpoints_is_noop() {
    let conn = Arc::new(Mutex::new(fresh_db()));
    let items = [AcceptedItem {
        item_id: "i1",
        action: "complete_sale",
        payload: "{}",
        created_at: "2026-09-03T00:00:00Z",
    }];
    assert_eq!(fanout(&conn, &None, "default", &items).await.unwrap(), 0);
}

// ── Signing ─────────────────────────────────────────────────────────

#[test]
fn signature_matches_rfc4231_test_case_2() {
    // RFC 4231 §4.2: key "Jefe", data "what do ya want for nothing?"
    let sig = signature("Jefe", b"what do ya want for nothing?");
    assert_eq!(
        sig,
        "sha256=5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"
    );
}

#[test]
fn verify_signature_roundtrip_and_tamper() {
    let body = br#"{"id":"e1","type":"complete_sale"}"#;
    let sig = signature("k32", body);
    assert!(verify_signature("k32", body, &sig));
    assert!(!verify_signature("k32", b"{\"tampered\":true}", &sig));
    assert!(!verify_signature("other", body, &sig));
    assert!(!verify_signature("k32", body, "sha256=deadbeef"));
}

// ── Delivery (live local receiver) ──────────────────────────────────

#[derive(Clone, Default)]
struct Received(std::sync::Arc<Mutex<Vec<(serde_json::Value, String, String)>>>);

async fn spawn_receiver(status: u16) -> (String, Received) {
    let state = Received::default();
    let code = StatusCode::from_u16(status).unwrap();
    let app = Router::new()
        .route(
            "/hook",
            post(
                move |axum::extract::State(s): axum::extract::State<Received>,
                      headers: HeaderMap,
                      body: String| async move {
                    let sig = headers
                        .get("X-OZ-Signature")
                        .and_then(|v| v.to_str().ok())
                        .unwrap_or("")
                        .to_string();
                    let event = headers
                        .get("X-OZ-Event")
                        .and_then(|v| v.to_str().ok())
                        .unwrap_or("")
                        .to_string();
                    let json = serde_json::from_str(&body).unwrap_or(serde_json::Value::Null);
                    s.0.lock().await.push((json, sig, event));
                    (code, "")
                },
            ),
        )
        .with_state(state.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (format!("http://127.0.0.1:{port}/hook"), state)
}

#[tokio::test]
async fn deliver_webhook_posts_signed_self_contained_body() {
    let (url, received) = spawn_receiver(200).await;
    let payload = serde_json::json!({
        "url": url,
        "secret": "topsecret",
        "event": "complete_sale",
        "event_id": "01abc",
        "item_id": "i1",
        "occurred_at": "2026-09-03T00:00:00Z",
        "tenant_id": "default",
        "data": {"id": "s1", "status": "completed"},
    })
    .to_string();
    deliver_webhook(&payload).await.unwrap();

    let got = received.0.lock().await;
    let (body, sig, event) = &got[0];
    assert_eq!(event, "complete_sale");
    assert_eq!(body["id"], "01abc");
    assert_eq!(body["type"], "complete_sale");
    assert_eq!(body["data"]["status"], "completed");
    assert!(verify_signature(
        "topsecret",
        body.to_string().as_bytes(),
        sig
    ));
    // The delivery body must NOT leak the secret or the raw url.
    assert!(!body.to_string().contains("topsecret"));
}

#[tokio::test]
async fn deliver_webhook_non_2xx_is_error_for_retry() {
    let (url, _r) = spawn_receiver(500).await;
    let payload = serde_json::json!({
        "url": url, "secret": "s", "event": "void_sale", "event_id": "e",
        "item_id": "i", "occurred_at": "t", "tenant_id": "default", "data": {},
    })
    .to_string();
    let err = deliver_webhook(&payload).await.unwrap_err();
    assert!(err.contains("500"), "{err}");
}

#[tokio::test]
async fn deliver_webhook_unreachable_is_error() {
    // Port 1 is reserved and nothing listens there.
    let payload = serde_json::json!({
        "url": "http://127.0.0.1:1/hook", "secret": "s", "event": "void_sale",
        "event_id": "e", "item_id": "i", "occurred_at": "t", "tenant_id": "default", "data": {},
    })
    .to_string();
    assert!(deliver_webhook(&payload).await.is_err());
}

#[tokio::test]
async fn dispatcher_routes_webhook_topic_and_rejects_malformed() {
    let conn = shared_conn_for_test();
    let err = deliver_outbox_entry_sqlite(conn, TOPIC, "not json")
        .await
        .unwrap_err();
    assert!(err.contains("parse"), "{err}");
}

fn shared_conn_for_test() -> Arc<Mutex<rusqlite::Connection>> {
    Arc::new(Mutex::new(fresh_db()))
}

// ── Admin API ───────────────────────────────────────────────────────

fn router_with(admin_key: Option<String>) -> Router {
    outbound_router(OutboundState {
        db: shared_conn_for_test(),
        pg: None,
        admin_key,
    })
}

#[tokio::test]
async fn admin_api_dev_open_create_list_delete() {
    let app = router_with(None); // dev mode: gate open
    let resp = app
        .clone()
        .oneshot(
            axum::http::Request::builder()
                .method("POST")
                .uri("/api/webhooks")
                .header("content-type", "application/json")
                .body(axum::body::Body::from(
                    r#"{"url":"https://e.com/h","events":["complete_sale"]}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
    let bytes = axum::body::to_bytes(resp.into_body(), 1 << 20)
        .await
        .unwrap();
    let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let secret = v["secret"].as_str().unwrap().to_string();
    assert_eq!(v["endpoint"]["events"][0], "complete_sale");

    let resp = app
        .clone()
        .oneshot(
            axum::http::Request::builder()
                .method("GET")
                .uri("/api/webhooks")
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(resp.into_body(), 1 << 20)
        .await
        .unwrap();
    let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(body["endpoints"].as_array().unwrap().len(), 1);
    assert!(!body.to_string().contains(&secret)); // redacted in list

    let id = v["endpoint"]["id"].as_str().unwrap().to_string();
    let resp = app
        .oneshot(
            axum::http::Request::builder()
                .method("DELETE")
                .uri(format!("/api/webhooks/{id}"))
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn admin_api_enforces_admin_key_when_configured() {
    let app = router_with(Some("letmein".into()));
    let resp = app
        .clone()
        .oneshot(
            axum::http::Request::builder()
                .method("GET")
                .uri("/api/webhooks")
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);

    let resp = app
        .oneshot(
            axum::http::Request::builder()
                .method("GET")
                .uri("/api/webhooks")
                .header("X-Admin-Key", "letmein")
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}

#[tokio::test]
async fn admin_api_rejects_bad_bodies() {
    let app = router_with(None);
    let resp = app
        .oneshot(
            axum::http::Request::builder()
                .method("POST")
                .uri("/api/webhooks")
                .header("content-type", "application/json")
                .body(axum::body::Body::from(
                    r#"{"url":"ftp://nope","events":["*"]}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}
