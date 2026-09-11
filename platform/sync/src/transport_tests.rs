//! Unit tests for the sync transport (`transport.rs`): wire DTO serde
//! round-trips (push outcomes, pull request/response), RUST-05
//! fail-closed `try_new` construction, health-check timeout, 401
//! classification (P1/P4 token_expired vs invalid_token), 403
//! plan_required terminal, ADR #11 server_migrated redirect parsing,
//! 410 anchor-expiry mapping, and the snapshot user wire format pin
//! (ADR #35 D6). Extracted from the inline `mod tests` in `transport.rs`
//! (F-018).

use super::*;

// ADR #35 D6 / spec 0049 residency: the sync wire format for users
// carries only the operational fields — profile columns (national id,
// monthly pay, tax id, emergency contact, etc.) must never travel over
// the sync channel. Adding one here breaks the pin deliberately.
#[test]
fn snapshot_user_wire_format_has_no_profile_fields() {
    let user = SnapshotUser {
        id: "u-1".into(),
        username: "alice".into(),
        display_name: "Alice".into(),
        role_id: "role-staff".into(),
        is_active: true,
        created_at: Some("2026-01-01T00:00:00Z".into()),
        updated_at: Some("2026-01-01T00:00:00Z".into()),
    };
    let json = serde_json::to_value(&user).unwrap();
    let obj = json.as_object().expect("snapshot user is a JSON object");
    let keys: Vec<&String> = obj.keys().collect();
    for banned in [
        "national_id",
        "national_id_hash",
        "monthly_take_home_minor",
        "tax_id",
        "email",
        "phone",
        "date_of_birth",
        "emergency_contact_name",
        "emergency_contact_phone",
        "notes",
        "address",
        "hire_date",
    ] {
        assert!(
            !keys.contains(&&banned.to_string()),
            "sensitive/profile field {banned} must never sync"
        );
    }
}

#[test]
fn transport_construction() {
    let transport = SyncTransport::new("http://localhost:3099", None);
    assert_eq!(transport.base_url, "http://localhost:3099");
}

#[test]
fn transport_strips_trailing_slash() {
    let transport = SyncTransport::new("http://localhost:3099/", None);
    assert_eq!(transport.base_url, "http://localhost:3099");
}

#[test]
fn transport_with_api_key() {
    let transport = SyncTransport::new("http://localhost:3099", Some("sk-test"));
    assert_eq!(transport.base_url, "http://localhost:3099");
}

// ── parse_server_migrated (ADR #11) ─────────────────────────────

#[test]
fn parse_server_migrated_detects_redirect() {
    let body = r#"{"error":"server_migrated","new_url":"https://new.example.com"}"#;
    assert_eq!(
        super::parse_server_migrated(body),
        Some("https://new.example.com".into())
    );
}

#[test]
fn parse_server_migrated_ignores_other_errors() {
    assert_eq!(super::parse_server_migrated(r#"{"error":"timeout"}"#), None);
    assert_eq!(super::parse_server_migrated(r#"{"status":"ok"}"#), None);
    assert_eq!(super::parse_server_migrated("not json"), None);
}

#[test]
fn parse_server_migrated_requires_new_url() {
    // Missing new_url field — should return None.
    assert_eq!(
        super::parse_server_migrated(r#"{"error":"server_migrated"}"#),
        None
    );
}

#[test]
fn parse_server_migrated_empty_string() {
    assert_eq!(super::parse_server_migrated(""), None);
}

#[test]
fn parse_server_migrated_null_new_url() {
    // new_url is present but null — should return None.
    assert_eq!(
        super::parse_server_migrated(r#"{"error":"server_migrated","new_url":null}"#),
        None
    );
}

#[test]
fn parse_server_migrated_extra_fields_ok() {
    // Extra fields should not interfere with detection.
    let body = r#"{"error":"server_migrated","new_url":"https://x.com","extra":true}"#;
    assert_eq!(
        super::parse_server_migrated(body),
        Some("https://x.com".into())
    );
}

// ── PushOutcome serde + Debug ────────────────────────────────────

#[test]
fn push_outcome_accepted_debug() {
    let outcome = PushOutcome::Accepted;
    let debug = format!("{outcome:?}");
    assert!(debug.contains("Accepted"));
}

#[test]
fn push_outcome_accepted_json() {
    let json = serde_json::to_value(PushOutcome::Accepted).unwrap();
    assert_eq!(json["outcome"], "accepted");
}

#[test]
fn push_outcome_rejected_debug_and_json() {
    let outcome = PushOutcome::Rejected {
        reason: "duplicate id".into(),
    };
    let debug = format!("{outcome:?}");
    assert!(debug.contains("Rejected"));
    assert!(debug.contains("duplicate id"));

    let json = serde_json::to_value(&outcome).unwrap();
    assert_eq!(json["outcome"], "rejected");
    assert_eq!(json["reason"], "duplicate id");
}

#[test]
fn push_outcome_conflict_roundtrip() {
    let item = OfflineQueueItem::new("void_sale", "{}");
    let outcome = PushOutcome::Conflict(item.clone());
    let json = serde_json::to_string(&outcome).unwrap();
    let rt: PushOutcome = serde_json::from_str(&json).unwrap();
    match rt {
        PushOutcome::Conflict(rt_item) => {
            assert_eq!(rt_item.id, item.id);
            assert_eq!(rt_item.action, item.action);
        }
        _ => panic!("expected Conflict variant"),
    }
}

#[test]
fn push_outcome_all_variants_serde_roundtrip() {
    let outcomes = vec![
        PushOutcome::Accepted,
        PushOutcome::Rejected {
            reason: "test".into(),
        },
        PushOutcome::Conflict(OfflineQueueItem::new("void", "{}")),
    ];
    for outcome in &outcomes {
        let json = serde_json::to_string(outcome).unwrap();
        let rt: PushOutcome = serde_json::from_str(&json).unwrap();
        let rt_json = serde_json::to_string(&rt).unwrap();
        assert_eq!(json, rt_json);
    }
}

/// Wire-shape pin for the push-outcome contract (spec 0047 §3, guard 5).
///
/// PushOutcome is an INTERNALLY tagged enum —
/// `#[serde(tag = "outcome", rename_all = "snake_case")]` — so every variant
/// travels as a JSON object carrying the discriminator, and the Conflict
/// newtype payload (a whole OfflineQueueItem) is serde-flattened next to that
/// tag instead of nested under a "Conflict" key.
///
/// This is the shape the published OpenAPI document must describe. The
/// cloud-server side asserts the document against serde_json::to_value of
/// these same variants
/// (openapi_tests.rs::push_outcome_documented_schema_matches_serde_wire_shape),
/// so a tag change here fails a test on both sides of the wire instead of
/// quietly rotting the contract. The println! lines surface under --nocapture
/// and print the wire truth for a human auditing the document.
#[test]
fn push_outcome_serialises_as_internally_tagged_flat_object() {
    let accepted = serde_json::to_value(PushOutcome::Accepted).unwrap();
    assert_eq!(
        accepted,
        serde_json::json!({ "outcome": "accepted" }),
        "Accepted must be a flat object carrying the tag and nothing else"
    );

    let rejected = serde_json::to_value(PushOutcome::Rejected {
        reason: "duplicate id: 0190".into(),
    })
    .unwrap();
    assert_eq!(
        rejected,
        serde_json::json!({ "outcome": "rejected", "reason": "duplicate id: 0190" }),
        "Rejected must carry the tag plus a flat 'reason' string"
    );

    let item = OfflineQueueItem::new("void_sale", "{}");
    let conflict = serde_json::to_value(PushOutcome::Conflict(item.clone())).unwrap();
    let conflict_obj = conflict
        .as_object()
        .expect("Conflict must serialise as an object, never a bare string or a wrapped value");
    assert_eq!(conflict_obj["outcome"], "conflict");
    assert!(
        !conflict_obj.contains_key("Conflict"),
        "an externally tagged Conflict would nest the payload under a 'Conflict' key"
    );

    // Every field of the server item sits beside the tag, unchanged.
    let item_obj = serde_json::to_value(&item).unwrap();
    let item_obj = item_obj.as_object().unwrap();
    for (key, value) in item_obj {
        assert_eq!(
            conflict_obj.get(key),
            Some(value),
            "Conflict payload field `{key}` must be flattened next to the tag"
        );
    }
    let mut added: Vec<&str> = conflict_obj
        .keys()
        .map(String::as_str)
        .filter(|k| !item_obj.contains_key(*k))
        .collect();
    added.sort_unstable();
    assert_eq!(
        added,
        vec!["outcome"],
        "the tag is the only key a Conflict adds to the item payload"
    );

    println!("push-outcome wire truth  accepted = {accepted}");
    println!("push-outcome wire truth  conflict  = {conflict}");
    println!("push-outcome wire truth  rejected  = {rejected}");
}

// ── PushResponse tests ───────────────────────────────────────────

#[test]
fn push_response_debug() {
    let resp = PushResponse { results: vec![] };
    let debug = format!("{resp:?}");
    assert!(debug.contains("results"));
}

#[test]
fn push_response_json_field_names() {
    let resp = PushResponse { results: vec![] };
    let json = serde_json::to_value(&resp).unwrap();
    assert!(json.as_object().unwrap().contains_key("results"));
}

#[test]
fn push_response_serde_roundtrip() {
    let resp = PushResponse {
        results: vec![
            PushOutcome::Accepted,
            PushOutcome::Rejected {
                reason: "dup".into(),
            },
        ],
    };
    let json = serde_json::to_string(&resp).unwrap();
    let rt: PushResponse = serde_json::from_str(&json).unwrap();
    assert_eq!(rt.results.len(), 2);
}

// ── PullRequest tests ────────────────────────────────────────────

#[test]
fn pull_request_debug() {
    let req = PullRequest {
        since: None,
        cursor: None,
    };
    let debug = format!("{req:?}");
    assert!(debug.contains("since"));
}

#[test]
fn pull_request_json_some_since() {
    let req = PullRequest {
        since: Some("2026-01-01T00:00:00Z".into()),
        cursor: None,
    };
    let json = serde_json::to_value(&req).unwrap();
    assert_eq!(json["since"], "2026-01-01T00:00:00Z");
}

#[test]
fn pull_request_json_none_since() {
    let req = PullRequest {
        since: None,
        cursor: None,
    };
    let json = serde_json::to_value(&req).unwrap();
    assert!(json["since"].is_null());
}

#[test]
fn pull_request_serde_roundtrip() {
    let req = PullRequest {
        since: Some("2026-01-01T00:00:00Z".into()),
        cursor: None,
    };
    let json = serde_json::to_string(&req).unwrap();
    let rt: PullRequest = serde_json::from_str(&json).unwrap();
    assert_eq!(rt.since, Some("2026-01-01T00:00:00Z".into()));
}

// ── PullResponse tests ───────────────────────────────────────────

#[test]
fn pull_response_debug() {
    let resp = PullResponse {
        items: vec![],
        next_cursor: None,
    };
    let debug = format!("{resp:?}");
    assert!(debug.contains("items"));
}

#[test]
fn pull_response_json_field_names() {
    let resp = PullResponse {
        items: vec![],
        next_cursor: None,
    };
    let json = serde_json::to_value(&resp).unwrap();
    assert!(json.as_object().unwrap().contains_key("items"));
}

#[test]
fn pull_response_serde_roundtrip() {
    let item = OfflineQueueItem::new("complete_sale", "{}");
    let resp = PullResponse {
        items: vec![item.clone()],
        next_cursor: None,
    };
    let json = serde_json::to_string(&resp).unwrap();
    let rt: PullResponse = serde_json::from_str(&json).unwrap();
    assert_eq!(rt.items.len(), 1);
    assert_eq!(rt.items[0].id, item.id);
}

// ── Clone tests ──────────────────────────────────────────────────

#[test]
fn push_outcome_clone() {
    let outcome = PushOutcome::Rejected {
        reason: "test".into(),
    };
    let cloned = outcome.clone();
    let json1 = serde_json::to_string(&outcome).unwrap();
    let json2 = serde_json::to_string(&cloned).unwrap();
    assert_eq!(json1, json2);
}

#[test]
fn pull_request_clone() {
    let req = PullRequest {
        since: Some("2026-01-01".into()),
        cursor: None,
    };
    let cloned = req.clone();
    assert_eq!(cloned.since, req.since);
}

// ── ADR #11: Transport integration tests ──────────────────

use crate::test_helpers::spawn_redirect_server;

#[tokio::test]
async fn push_items_returns_server_migrated_on_redirect() {
    let new_url = "https://migrated.example.com";
    let server_url = spawn_redirect_server(new_url).await;
    let transport = SyncTransport::new(&server_url, None);

    let item = OfflineQueueItem::new("test_action", r#"{"key":"val"}"#);
    let result = transport.push_items(&[item]).await;

    match result {
        Err(SyncError::ServerMigrated { new_url: url }) => {
            assert_eq!(url, new_url, "ServerMigrated should carry the new_url");
        }
        other => panic!("expected SyncError::ServerMigrated, got {:?}", other),
    }
}

#[tokio::test]
async fn pull_updates_returns_server_migrated_on_redirect() {
    let new_url = "https://pull-migrated.example.com";
    let server_url = spawn_redirect_server(new_url).await;
    let transport = SyncTransport::new(&server_url, None);

    let result = transport.pull_updates(None, None).await;

    match result {
        Err(SyncError::ServerMigrated { new_url: url }) => {
            assert_eq!(url, new_url, "ServerMigrated should carry the new_url");
        }
        other => panic!("expected SyncError::ServerMigrated, got {:?}", other),
    }
}

#[tokio::test]
async fn fetch_snapshot_returns_server_migrated_on_redirect() {
    let new_url = "https://snapshot-migrated.example.com";
    let server_url = spawn_redirect_server(new_url).await;
    let transport = SyncTransport::new(&server_url, None);

    let result = transport.fetch_snapshot().await;

    match result {
        Err(SyncError::ServerMigrated { new_url: url }) => {
            assert_eq!(url, new_url, "ServerMigrated should carry the new_url");
        }
        other => panic!("expected SyncError::ServerMigrated, got {:?}", other),
    }
}

// ── SyncSnapshotResponse tests ──────────────────────────────

/// Build a typed snapshot response (RUST-04) with valid rows.
fn typed_response() -> SyncSnapshotResponse {
    SyncSnapshotResponse {
        version: 1,
        products: vec![SnapshotProduct {
            id: "p-1".into(),
            sku: "ITEM-1".into(),
            name: "Item One".into(),
            price_minor: 100,
            currency: "USD".into(),
            category_id: None,
            barcode: None,
            created_at: None,
            updated_at: None,
            price_updated_at: None,
            track_serial: false,
            store_id: None,
            ..Default::default()
        }],
        tax_rates: vec![SnapshotTaxRate {
            id: "t-1".into(),
            name: "Tax One".into(),
            rate_bps: 1000,
            is_default: false,
            is_inclusive: false,
            created_at: None,
            updated_at: None,
            legal_entity_id: None,
            location_id: None,
            effective_from: None,
            effective_to: None,
            rounding_mode: String::new(),
        }],
        users: vec![SnapshotUser {
            id: "u-1".into(),
            username: "admin".into(),
            display_name: "Admin".into(),
            role_id: "r-1".into(),
            is_active: true,
            created_at: None,
            updated_at: None,
        }],
    }
}

#[test]
fn sync_snapshot_response_debug() {
    let resp = typed_response();
    let debug = format!("{resp:?}");
    assert!(debug.contains("products"));
    assert!(debug.contains("tax_rates"));
    assert!(debug.contains("users"));
}

#[test]
fn sync_snapshot_response_serde_roundtrip() {
    let resp = typed_response();
    let json = serde_json::to_string(&resp).unwrap();
    let rt: SyncSnapshotResponse = serde_json::from_str(&json).unwrap();
    assert_eq!(rt.products.len(), 1);
    assert_eq!(rt.tax_rates.len(), 1);
    assert_eq!(rt.users.len(), 1);
    assert_eq!(rt.version, 1);
}

#[test]
fn sync_snapshot_response_defaults_version_to_one_when_absent() {
    // RUST-04: legacy servers omit `version`; it must default to 1.
    let wire = r#"{"products":[],"tax_rates":[],"users":[]}"#;
    let rt: SyncSnapshotResponse = serde_json::from_str(wire).unwrap();
    assert_eq!(rt.version, 1, "missing version defaults to schema v1");
}

#[test]
fn sync_snapshot_response_rejects_missing_required_product_fields() {
    // RUST-04: missing required fields fail deserialization at the
    // transport boundary instead of importing with defaults.
    let wire = r#"{"products":[{"name":"No Sku"}],"tax_rates":[],"users":[]}"#;
    let result: Result<SyncSnapshotResponse, _> = serde_json::from_str(wire);
    assert!(
        result.is_err(),
        "product missing sku must fail deserialization"
    );
}

#[test]
fn sync_snapshot_response_rejects_missing_required_user_fields() {
    let wire = r#"{"products":[],"tax_rates":[],"users":[{"username":"x"}]}"#;
    let result: Result<SyncSnapshotResponse, _> = serde_json::from_str(wire);
    assert!(
        result.is_err(),
        "user missing display_name/role_id must fail"
    );
}

#[test]
fn sync_snapshot_response_clone() {
    let resp = typed_response();
    let cloned = resp.clone();
    let json1 = serde_json::to_string(&resp).unwrap();
    let json2 = serde_json::to_string(&cloned).unwrap();
    assert_eq!(json1, json2);
}

// ── classify_transport_error tests ──────────────────────────────

#[test]
fn classify_transport_error_timeout() {
    // Simulate a timeout by creating a request that times out.
    // We test the classification logic by checking the message pattern.
    let rt = tokio::runtime::Runtime::new().unwrap();
    let err = rt.block_on(async {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_millis(1))
            .build()
            .unwrap();
        client
            .get("http://127.0.0.1:1/timeout")
            .send()
            .await
            .unwrap_err()
    });
    let msg = super::classify_transport_error(&err, "http://example.com");
    assert!(
        msg.contains("timed out") || msg.contains("timeout"),
        "expected timeout message, got: {msg}"
    );
}

#[test]
fn classify_transport_error_connection_refused() {
    let rt = tokio::runtime::Runtime::new().unwrap();
    let err = rt.block_on(async {
        // Disable system proxy so it doesn't intercept 127.0.0.1:1 and
        // return HTTP 403 instead of the raw TCP connection refused error.
        // Use a very short client timeout so the test fails fast.
        let client = reqwest::Client::builder()
            .no_proxy()
            .timeout(std::time::Duration::from_millis(50))
            .build()
            .unwrap();
        client
            .get("http://127.0.0.1:1/refused")
            .send()
            .await
            .unwrap_err()
    });
    let msg = super::classify_transport_error(&err, "http://127.0.0.1:1");
    assert!(
        msg.contains("cloud server not running")
            || msg.contains("cannot connect")
            || msg.contains("timed out"),
        "expected connection error message, got: {msg}"
    );
}

#[test]
fn classify_transport_error_includes_url() {
    let rt = tokio::runtime::Runtime::new().unwrap();
    let err = rt.block_on(async {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_millis(50))
            .build()
            .unwrap();
        client
            .get("http://192.0.2.1:9999/test")
            .send()
            .await
            .unwrap_err()
    });
    let url = "http://192.0.2.1:9999";
    let msg = super::classify_transport_error(&err, url);
    // The error message should either contain the URL or describe the issue.
    assert!(!msg.is_empty(), "error message should not be empty");
    assert!(
        msg.contains(url)
            || msg.contains("timed out")
            || msg.contains("cannot connect")
            || msg.contains("cloud server not running"),
        "expected descriptive error message, got: {msg}"
    );
}

#[test]
fn classify_transport_error_non_empty() {
    // All classification branches should produce non-empty messages.
    let rt = tokio::runtime::Runtime::new().unwrap();
    let err = rt.block_on(async {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_millis(50))
            .build()
            .unwrap();
        client
            .get("http://127.0.0.1:1/test")
            .send()
            .await
            .unwrap_err()
    });
    let msg = super::classify_transport_error(&err, "http://test.example.com");
    assert!(!msg.is_empty(), "classification should produce a message");
}

// ── health_check integration test ───────────────────────────────

// ── RUST-05: fail-closed auth/timeout guarantees ────────────────

/// Spawn a push endpoint that records the Authorization header it
/// received, so tests can assert the transport never silently drops
/// the configured bearer token (RUST-05).
async fn spawn_push_server_capturing_auth()
-> (String, std::sync::Arc<std::sync::Mutex<Option<String>>>) {
    use axum::{Router, routing::post};
    use std::sync::{Arc, Mutex};

    let seen: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    let seen_clone = Arc::clone(&seen);

    let listener = tokio::net::TcpListener::bind("localhost:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    async fn handle_push(
        axum::extract::State(seen): axum::extract::State<Arc<Mutex<Option<String>>>>,
        request: axum::extract::Request,
    ) -> (axum::http::StatusCode, axum::Json<PushResponse>) {
        let auth = request
            .headers()
            .get(reqwest::header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_owned());
        *seen.lock().unwrap() = auth;
        let body = axum::body::to_bytes(request.into_body(), 1024 * 1024)
            .await
            .unwrap_or_default();
        let item_count = serde_json::from_slice::<Vec<serde_json::Value>>(&body)
            .map(|v| v.len())
            .unwrap_or(0);
        (
            axum::http::StatusCode::OK,
            axum::Json(PushResponse {
                results: vec![PushOutcome::Accepted; item_count],
            }),
        )
    }

    let app = Router::new()
        .route("/api/sync/push", post(handle_push))
        .with_state(seen_clone);

    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    (format!("http://localhost:{port}"), seen)
}

#[tokio::test]
async fn push_items_sends_bearer_token_when_api_key_configured() {
    let (server_url, seen) = spawn_push_server_capturing_auth().await;
    let transport = SyncTransport::new(&server_url, Some("sk-test-123"));

    let item = OfflineQueueItem::new("complete_sale", r#"{"id":1}"#);
    transport.push_items(&[item]).await.unwrap();

    let captured = seen.lock().unwrap().clone();
    assert_eq!(
        captured.as_deref(),
        Some("Bearer sk-test-123"),
        "the configured bearer token must reach the server (RUST-05)"
    );
}
#[tokio::test]
async fn push_items_maps_bare_401_to_auth_expired() {
    use axum::{Router, http::StatusCode, routing::post};

    let listener = tokio::net::TcpListener::bind("localhost:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    async fn reject_push() -> StatusCode {
        StatusCode::UNAUTHORIZED
    }

    let app = Router::new().route("/api/sync/push", post(reject_push));
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    tokio::time::sleep(std::time::Duration::from_millis(10)).await;

    let transport = SyncTransport::new(&format!("http://localhost:{port}"), Some("stale-token"));
    let item = OfflineQueueItem::new("complete_sale", r#"{"id":3}"#);
    let err = transport.push_items(&[item]).await.unwrap_err();

    assert!(
        matches!(err, SyncError::AuthExpired),
        "a bare 401 must surface as AuthExpired (backward compat), got: {err:?}"
    );
}

#[tokio::test]
async fn push_items_maps_structured_invalid_token_401() {
    use axum::{Json, Router, http::StatusCode, response::IntoResponse, routing::post};

    let listener = tokio::net::TcpListener::bind("localhost:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    async fn reject_push() -> impl IntoResponse {
        (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error": "invalid_token"})),
        )
    }

    let app = Router::new().route("/api/sync/push", post(reject_push));
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    tokio::time::sleep(std::time::Duration::from_millis(10)).await;

    let transport = SyncTransport::new(&format!("http://localhost:{port}"), Some("bad-token"));
    let item = OfflineQueueItem::new("complete_sale", r#"{"id":4}"#);
    let err = transport.push_items(&[item]).await.unwrap_err();

    assert!(
        matches!(err, SyncError::AuthInvalid),
        "an explicit invalid_token 401 must surface as AuthInvalid, got: {err:?}"
    );
}

#[tokio::test]
async fn push_items_maps_403_plan_required() {
    use axum::{Json, Router, http::StatusCode, response::IntoResponse, routing::post};

    let listener = tokio::net::TcpListener::bind("localhost:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    async fn reject_push() -> impl IntoResponse {
        (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({"error": "plan_required"})),
        )
    }

    let app = Router::new().route("/api/sync/push", post(reject_push));
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    tokio::time::sleep(std::time::Duration::from_millis(10)).await;

    let transport = SyncTransport::new(
        &format!("http://localhost:{port}"),
        Some("free-tenant-token"),
    );
    let item = OfflineQueueItem::new("complete_sale", r#"{"id":5}"#);
    let err = transport.push_items(&[item]).await.unwrap_err();

    assert!(
        matches!(err, SyncError::PlanRequired),
        "a 403 plan_required must surface as PlanRequired (ADR sync-plan-gating), got: {err:?}"
    );
}

#[tokio::test]
async fn push_items_without_api_key_sends_no_auth_header() {
    let (server_url, seen) = spawn_push_server_capturing_auth().await;
    let transport = SyncTransport::new(&server_url, None);

    let item = OfflineQueueItem::new("complete_sale", r#"{"id":2}"#);
    transport.push_items(&[item]).await.unwrap();

    let captured = seen.lock().unwrap().clone();
    assert_eq!(
        captured, None,
        "no Authorization header may be sent when no API key is configured"
    );
}

#[tokio::test]
async fn health_check_succeeds_with_healthy_server() {
    let server_url =
        crate::test_helpers::spawn_redirect_server("https://migrated.example.com").await;
    let transport = SyncTransport::new(&server_url, None);

    let result = transport.health_check().await;
    assert!(
        result.is_ok(),
        "health check should succeed: {:?}",
        result.err()
    );
}

#[tokio::test]
async fn health_check_fails_when_server_returns_error() {
    use axum::{Json, Router, http::StatusCode, response::IntoResponse, routing::get};

    let listener = tokio::net::TcpListener::bind("localhost:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    async fn sick_health() -> impl IntoResponse {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"status": "error"})),
        )
    }

    let app = Router::new().route("/api/health", get(sick_health));
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    tokio::time::sleep(std::time::Duration::from_millis(10)).await;

    let server_url = format!("http://localhost:{port}");
    let transport = SyncTransport::new(&server_url, None);

    let result = transport.health_check().await;
    assert!(result.is_err(), "health check should fail on 500");
    let err = result.unwrap_err().to_string();
    assert!(
        err.contains("500") || err.contains("Internal Server Error"),
        "error should mention status code, got: {err}"
    );
}

// ── SnapshotTaxRate wire shape (tax scoping) ─────────────────────

#[test]
fn snapshot_tax_rate_accepts_a_payload_without_the_scope_keys() {
    // The back-compat ruling, pinned at the wire: a server predating
    // 20260921 sends seven keys, not eleven. That must deserialize — to the
    // tenant-global shape — rather than fail the whole snapshot.
    let legacy = r#"{"id":"t-1","name":"Tax One","rate_bps":1000}"#;
    let rate: SnapshotTaxRate = serde_json::from_str(legacy).unwrap();
    assert_eq!(rate.id, "t-1");
    assert_eq!(rate.rate_bps, 1000);
    assert_eq!(rate.legal_entity_id, None);
    assert_eq!(rate.location_id, None);
    assert_eq!(rate.effective_from, None);
    assert_eq!(rate.effective_to, None);
}

#[test]
fn snapshot_tax_rate_round_trips_scope_and_window_verbatim() {
    // Values are carried, not re-derived: the exclusive-end rule lives in
    // oz_core::db::tax and must not be restated per transport.
    let json = r#"{"id":"t-2","name":"Jakarta","rate_bps":1100,
                   "legal_entity_id":null,"location_id":"loc-jkt",
                   "effective_from":"2026-01-01","effective_to":"2027-01-01"}"#;
    let rate: SnapshotTaxRate = serde_json::from_str(json).unwrap();
    assert_eq!(rate.legal_entity_id, None, "explicit null stays None");
    assert_eq!(rate.location_id.as_deref(), Some("loc-jkt"));
    assert_eq!(rate.effective_from.as_deref(), Some("2026-01-01"));
    assert_eq!(rate.effective_to.as_deref(), Some("2027-01-01"));

    let back = serde_json::to_value(&rate).unwrap();
    assert_eq!(back["location_id"], "loc-jkt");
    assert_eq!(back["effective_to"], "2027-01-01");
    assert_eq!(
        back["legal_entity_id"],
        serde_json::Value::Null,
        "an unscoped-by-entity row serializes as null, which the branch reads back as None"
    );
}
