use super::*;
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use tower::ServiceExt;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn fresh_db() -> rusqlite::Connection {
    kasirmu_core::migrations::fresh_db()
}

fn test_token(tenant_id: Option<&str>) -> String {
    kasirmu_api::auth::create_token("test", Some(24), tenant_id, None)
        .unwrap()
        .token
}

fn authed_post(uri: &str, body: &str, tenant_id: Option<&str>) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(uri)
        .header("Authorization", format!("Bearer {}", test_token(tenant_id)))
        .header("Content-Type", "application/json")
        .body(Body::from(body.to_owned()))
        .unwrap()
}

/// A wiremock server answering the Midtrans QRIS charge with the REAL live
/// field name (`qr_string`, not the struct's internal `qr_code_url`).
async fn midtrans_mock() -> MockServer {
    let mock = MockServer::start().await;
    let body = serde_json::json!({
        "status_code": "201",
        "status_message": "QRIS transaction is created",
        "transaction_id": "txn-fixed-1",
        "order_id": "QRIS-FIXED-ORDER",
        "gross_amount": "15000.00",
        "currency": "IDR",
        "payment_type": "qris",
        "transaction_status": "pending",
        "qr_string": "0002010212154354112093600002AGWID20103UMI5144TEST5204581053033605405150005802ID5907TOKOPEDA6007JAKARTA62610123070001TEST0506ABCDEF5016050105030503050105000"
    });
    Mock::given(method("POST"))
        .and(path("/v2/charge"))
        .respond_with(ResponseTemplate::new(201).set_body_json(body))
        .mount(&mock)
        .await;
    mock
}

fn state_for(mock_uri: &str) -> PaymentState {
    let processor =
        QrisPaymentProcessor::new_with_endpoint("sk-test", &format!("{mock_uri}/v2"), true);
    PaymentState {
        db: Arc::new(Mutex::new(fresh_db())),
        pg: None,
        rate_limiter: RateLimiterState::new(),
        processor: Some(processor),
    }
}

fn state_disabled() -> PaymentState {
    PaymentState {
        db: Arc::new(Mutex::new(fresh_db())),
        pg: None,
        rate_limiter: RateLimiterState::new(),
        processor: None,
    }
}

async fn body_json(resp: axum::response::Response) -> serde_json::Value {
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&bytes).unwrap()
}

#[tokio::test]
async fn charge_returns_qr_and_journals_issuance() {
    let mock = midtrans_mock().await;
    let state = state_for(&mock.uri());
    let router = payment_router(state.clone());

    let resp = router
        .oneshot(authed_post(
            "/api/payment/midtrans/qris",
            r#"{"sale_id":"sale-99","amount_minor":15000}"#,
            Some("tenant-A"),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let json = body_json(resp).await;
    assert_eq!(json["status"], "qr_issued");
    assert_eq!(json["order_id"], "QRIS-FIXED-ORDER");
    assert_eq!(json["sale_id"], "sale-99");
    assert_eq!(json["expires_in_secs"], 300);
    assert!(
        json["qr_string"]
            .as_str()
            .unwrap()
            .starts_with("000201021215")
    );

    // The ledger row must exist BEFORE any response reaches the caller —
    // this is what makes an early settlement webhook resolvable.
    let l = LedgerDb {
        db: state.db.clone(),
        pg: None,
    };
    let e = l.lookup("QRIS-FIXED-ORDER").await.unwrap().unwrap();
    assert_eq!(e.tenant_id, "tenant-A");
    assert_eq!(e.sale_id, "sale-99");
    assert_eq!(e.amount_minor, 15000);
    assert_eq!(e.status, "issued");
}

#[tokio::test]
async fn charge_requires_bearer_token() {
    let mock = midtrans_mock().await;
    let router = payment_router(state_for(&mock.uri()));
    let req = Request::builder()
        .method("POST")
        .uri("/api/payment/midtrans/qris")
        .header("Content-Type", "application/json")
        .body(Body::from(
            r#"{"sale_id":"s","amount_minor":1}"#.to_string(),
        ))
        .unwrap();
    assert_eq!(
        router.oneshot(req).await.unwrap().status(),
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn charge_requires_tenant_scoped_token() {
    let mock = midtrans_mock().await;
    let router = payment_router(state_for(&mock.uri()));
    let resp = router
        .oneshot(authed_post(
            "/api/payment/midtrans/qris",
            r#"{"sale_id":"sale-1","amount_minor":15000}"#,
            None,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn charge_validates_body_before_any_gateway_call() {
    let mock = midtrans_mock().await;
    let router = payment_router(state_for(&mock.uri()));
    for body in [
        r#"{"sale_id":"s","amount_minor":0}"#,
        r#"{"sale_id":"s","amount_minor":-5}"#,
        r#"{"sale_id":"","amount_minor":100}"#,
        r#"{"sale_id":"s","amount_minor":100,"currency":"USD"}"#,
    ] {
        let resp = router
            .clone()
            .oneshot(authed_post(
                "/api/payment/midtrans/qris",
                body,
                Some("tenant-A"),
            ))
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST, "body: {body}");
    }
    // No mock hit was required for any of these.
    assert!(
        mock.received_requests().await.unwrap().is_empty(),
        "validation must reject before any gateway call"
    );
}

#[tokio::test]
async fn charge_fails_closed_without_server_key() {
    let router = payment_router(state_disabled());
    let resp = router
        .oneshot(authed_post(
            "/api/payment/midtrans/qris",
            r#"{"sale_id":"sale-1","amount_minor":15000}"#,
            Some("tenant-A"),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::SERVICE_UNAVAILABLE);
}

#[tokio::test]
async fn charge_gateway_error_is_502() {
    let mock = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v2/charge"))
        .respond_with(ResponseTemplate::new(402).set_body_json(serde_json::json!({
            "status_code": "402",
            "status_message": "Transaction amount exceeds limit"
        })))
        .mount(&mock)
        .await;
    let router = payment_router(state_for(&mock.uri()));
    let resp = router
        .oneshot(authed_post(
            "/api/payment/midtrans/qris",
            r#"{"sale_id":"sale-1","amount_minor":99999999999}"#,
            Some("tenant-A"),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_GATEWAY);
    // Exactly one gateway call, and nothing journaled for a failed charge.
    assert_eq!(mock.received_requests().await.unwrap().len(), 1);
}

// ── 3.1a status endpoint ─────────────────────────────────────────────

fn authed_get(uri: &str, tenant_id: Option<&str>) -> Request<Body> {
    Request::builder()
        .method("GET")
        .uri(uri)
        .header("Authorization", format!("Bearer {}", test_token(tenant_id)))
        .body(Body::empty())
        .unwrap()
}

async fn seed_order(state: &PaymentState, order_id: &str, tenant: &str) {
    LedgerDb {
        db: state.db.clone(),
        pg: None,
    }
    .record_issue(order_id, tenant, "sale-x", 1000, "IDR")
    .await
    .unwrap();
}

#[tokio::test]
async fn status_reports_issued_then_settled() {
    let state = state_disabled(); // status is ledger-only; no gateway needed
    seed_order(&state, "QRIS-s1", "tenant-A").await;
    let resp = payment_router(state.clone())
        .oneshot(authed_get(
            "/api/payment/midtrans/QRIS-s1/status",
            Some("tenant-A"),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let json = body_json(resp).await;
    assert_eq!(json["status"], "issued");
    assert_eq!(json["settled"], false);

    LedgerDb {
        db: state.db.clone(),
        pg: None,
    }
    .mark_status("QRIS-s1", "tenant-A", "settlement")
    .await
    .unwrap();
    let resp = payment_router(state)
        .oneshot(authed_get(
            "/api/payment/midtrans/QRIS-s1/status",
            Some("tenant-A"),
        ))
        .await
        .unwrap();
    let json = body_json(resp).await;
    assert_eq!(json["status"], "settlement");
    assert_eq!(json["settled"], true);
}

#[tokio::test]
async fn status_uniform_404_for_foreign_and_unknown() {
    let state = state_disabled();
    seed_order(&state, "QRIS-s2", "tenant-A").await;
    // Another tenant's real order and a nonexistent id must be
    // indistinguishable — same status AND same body. (Error bodies here
    // are the handler tuple's plain text, not JSON — body_json is for
    // success shapes only.)
    let foreign = payment_router(state.clone())
        .oneshot(authed_get(
            "/api/payment/midtrans/QRIS-s2/status",
            Some("tenant-B"),
        ))
        .await
        .unwrap();
    let ghost = payment_router(state)
        .oneshot(authed_get(
            "/api/payment/midtrans/QRIS-nope/status",
            Some("tenant-B"),
        ))
        .await
        .unwrap();
    assert_eq!(foreign.status(), StatusCode::NOT_FOUND);
    assert_eq!(ghost.status(), StatusCode::NOT_FOUND);
    let fb = axum::body::to_bytes(foreign.into_body(), 1024)
        .await
        .unwrap();
    let gb = axum::body::to_bytes(ghost.into_body(), 1024).await.unwrap();
    assert_eq!(fb, gb);
    assert!(
        !String::from_utf8_lossy(&fb).contains("QRIS-s2"),
        "the 404 body must not hint which id it looked up"
    );
}

#[tokio::test]
async fn status_requires_bearer_token() {
    let router = payment_router(state_disabled());
    let req = Request::builder()
        .method("GET")
        .uri("/api/payment/midtrans/QRIS-x/status")
        .body(Body::empty())
        .unwrap();
    assert_eq!(
        router.oneshot(req).await.unwrap().status(),
        StatusCode::UNAUTHORIZED
    );
}

// ── QRIS acquirer plumbing (MIDTRANS_QRIS_ACQUIRER) ──────────────────
//
// 6a32cc9dd removed the hardcoded "airpay shopee" from the driver and made
// the acquirer opt-in, but nothing on the server could set it. These tests
// own both directions of the new plumb: the generic default survives an unset
// config, and a configured value reaches the wire verbatim.

/// The charge body the server actually puts on the wire, for a processor built
/// from the given acquirer setting (`None` = unset config, the default).
///
/// Goes through [`build_qris_processor`] — the same function
/// [`PaymentState::from_state_with_rate_limiter`] uses at startup — with only
/// the endpoint swapped for the mock, so what is asserted is the body a live
/// merchant would receive.
async fn sent_charge_body(acquirer: Option<&str>) -> serde_json::Value {
    let mock = midtrans_mock().await;
    let api_base = format!("{mock_uri}/v2", mock_uri = mock.uri());
    let processor = build_qris_processor("sk-test", true, acquirer, Some(&api_base));
    let state = PaymentState {
        db: Arc::new(Mutex::new(fresh_db())),
        pg: None,
        rate_limiter: RateLimiterState::new(),
        processor: Some(processor),
    };
    let resp = payment_router(state)
        .oneshot(authed_post(
            "/api/payment/midtrans/qris",
            r#"{"sale_id":"sale-acq","amount_minor":15000}"#,
            Some("tenant-A"),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let received = mock.received_requests().await.unwrap();
    assert_eq!(received.len(), 1, "exactly one charge per request");
    serde_json::from_slice(&received[0].body).expect("charge body is JSON")
}

/// UNSET CONFIG PRESERVES THE GENERIC DEFAULT: with `MIDTRANS_QRIS_ACQUIRER`
/// unset the charge body carries no `qris` object at all — not an empty one,
/// not a fallback. This is what a live merchant sends today; the test is what
/// keeps 6a32cc9dd's fix from rotting back into a hardcode.
#[tokio::test]
async fn charge_omits_qris_object_entirely_when_acquirer_unset() {
    let body = sent_charge_body(None).await;
    assert!(
        body.get("qris").is_none(),
        "unset acquirer must omit `qris` entirely, body: {body}"
    );
    // The rest of the charge is untouched by the acquirer plumbing.
    assert_eq!(body["payment_type"], "qris", "body: {body}");
    assert_eq!(body["custom_expiry"]["unit"], "second", "body: {body}");
}

/// A CONFIGURED ACQUIRER FLOWS VERBATIM into `qris.acquirer`: the server does
/// not trim, case-fold, alias or otherwise rewrite it, because which acquirer
/// a merchant may name is governed by that merchant's Midtrans activation.
#[tokio::test]
async fn charge_sends_configured_acquirer_verbatim() {
    let body = sent_charge_body(Some("shopeepay")).await;
    assert_eq!(
        body["qris"]["acquirer"], "shopeepay",
        "configured acquirer must reach the wire verbatim, body: {body}"
    );
    // Same non-acquirer fields as the generic charge: the acquirer is additive.
    assert_eq!(body["payment_type"], "qris", "body: {body}");
    assert_eq!(
        body["transaction_details"]["gross_amount"], "15000",
        "body: {body}"
    );
}

/// Server-wide state carrying an acquirer setting, with a key present so the
/// processor is actually built.
fn cloud_state_with_acquirer(acquirer: Option<&str>) -> CloudServerState {
    CloudServerState {
        db: Arc::new(Mutex::new(fresh_db())),
        pg: None,
        started_at: std::time::Instant::now(),
        health_depth_cache: crate::HealthDepthCache::default(),
        stripe_webhook_secret: None,
        square_webhook_signature_key: None,
        square_webhook_url: None,
        midtrans_server_key: Some("sk-test".into()),
        midtrans_sandbox: true,
        midtrans_qris_acquirer: acquirer.map(str::to_owned),
    }
}

/// The startup wiring, which the two body tests cannot see on their own:
/// `PaymentState` reads the acquirer off `CloudServerState` and lands it on
/// the processor — and leaves it `None` when unset.
#[test]
fn payment_state_carries_acquirer_setting_from_cloud_state() {
    let unset = PaymentState::from_state_with_rate_limiter(
        cloud_state_with_acquirer(None),
        RateLimiterState::new(),
    );
    assert_eq!(
        unset.processor.expect("key set").acquirer(),
        None,
        "unset config must leave the processor generic"
    );

    let set = PaymentState::from_state_with_rate_limiter(
        cloud_state_with_acquirer(Some("gopay")),
        RateLimiterState::new(),
    );
    assert_eq!(
        set.processor.expect("key set").acquirer(),
        Some("gopay"),
        "configured acquirer must reach the processor"
    );
}
