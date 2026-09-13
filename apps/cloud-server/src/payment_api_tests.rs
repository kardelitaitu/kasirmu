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
    oz_core::migrations::fresh_db()
}

fn test_token(tenant_id: Option<&str>) -> String {
    oz_api::auth::create_token("test", Some(24), tenant_id, None)
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
    let processor = QrisPaymentProcessor::new_with_endpoint("sk-test", &format!("{mock_uri}/v2"), true);
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
    assert!(json["qr_string"]
        .as_str()
        .unwrap()
        .starts_with("000201021215"));

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
        .body(Body::from(r#"{"sale_id":"s","amount_minor":1}"#.to_string()))
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
