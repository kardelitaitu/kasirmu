//! Integration tests for [`SquarePaymentProcessor`] using `wiremock` to
//! simulate the Square REST API.
//!
//! These tests start a local mock HTTP server, point the processor at it,
//! and verify that each `PaymentProcessor` method sends the correct
//! requests and handles responses correctly.
//!
//! # Running
//!
//! ```bash
//! cargo test --package oz-payment --test square_integration
//! ```

use foundation::{Currency, Money};
use kasirmu_payment::PaymentProcessor;
use kasirmu_payment::drivers::square::SquarePaymentProcessor;
use kasirmu_payment::types::{PaymentMethod, PaymentRequest};
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{method, path},
};

/// Helper: construct a USD currency.
fn usd() -> Currency {
    "USD".parse().unwrap()
}

/// Helper: create a request for the given major-unit amount.
fn request(major_amount: i64) -> PaymentRequest {
    PaymentRequest {
        amount: Money::from_major(major_amount, usd()).unwrap(),
        reference: None,
        description: None,
        idempotency_key: None,
    }
}

const MOCK_API_KEY: &str = "EAAA_test_square_api_key";
const MOCK_LOCATION_ID: &str = "L_ABC123";

// ── Authorize ────────────────────────────────────────────────────────

#[tokio::test]
async fn authorize_happy_path() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/payments"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "payment": {
                "id": "sq_payment_auth_001",
                "status": "APPROVED",
                "amount_money": {"amount": 1500, "currency": "USD"},
                "created_at": "2026-06-30T12:00:00Z"
            }
        })))
        .mount(&mock_server)
        .await;

    let proc = SquarePaymentProcessor::new_with_endpoint(
        MOCK_API_KEY,
        MOCK_LOCATION_ID,
        &mock_server.uri(),
    );

    let result = proc.authorize(&request(15)).await.unwrap();
    assert!(result.success);
    assert_eq!(result.transaction_id.unwrap(), "sq_payment_auth_001");
    assert_eq!(result.amount_charged.minor_units, 1500);
}

#[tokio::test]
async fn authorize_declined() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/payments"))
        .respond_with(ResponseTemplate::new(402).set_body_json(serde_json::json!({
            "errors": [
                {"code": "CARD_DECLINED", "detail": "The card was declined."}
            ]
        })))
        .mount(&mock_server)
        .await;

    let proc = SquarePaymentProcessor::new_with_endpoint(
        MOCK_API_KEY,
        MOCK_LOCATION_ID,
        &mock_server.uri(),
    );

    let err = proc.authorize(&request(10)).await.unwrap_err();
    let msg = err.to_string();
    assert!(
        msg.contains("declined"),
        "expected declined error, got: {msg}"
    );
}

#[tokio::test]
async fn authorize_server_error() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/payments"))
        .respond_with(ResponseTemplate::new(500).set_body_string("Internal Server Error"))
        .mount(&mock_server)
        .await;

    let proc = SquarePaymentProcessor::new_with_endpoint(
        MOCK_API_KEY,
        MOCK_LOCATION_ID,
        &mock_server.uri(),
    );

    let err = proc.authorize(&request(10)).await.unwrap_err();
    let msg = err.to_string();
    assert!(msg.contains("500"), "expected HTTP 500 error, got: {msg}");
}

#[tokio::test]
async fn authorize_non_json_response() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/payments"))
        .respond_with(ResponseTemplate::new(200).set_body_string("not-json"))
        .mount(&mock_server)
        .await;

    let proc = SquarePaymentProcessor::new_with_endpoint(
        MOCK_API_KEY,
        MOCK_LOCATION_ID,
        &mock_server.uri(),
    );

    let err = proc.authorize(&request(10)).await.unwrap_err();
    let msg = err.to_string();
    assert!(
        msg.contains("failed to parse"),
        "expected parse error, got: {msg}"
    );
}

// ── Sale (authorize + capture via default impl) ──────────────────────

#[tokio::test]
async fn sale_happy_path() {
    let mock_server = MockServer::start().await;

    // Authorize response
    Mock::given(method("POST"))
        .and(path("/payments"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "payment": {
                "id": "sq_sale_001",
                "status": "APPROVED",
                "amount_money": {"amount": 2000, "currency": "USD"},
                "created_at": "2026-06-30T12:00:00Z"
            }
        })))
        .mount(&mock_server)
        .await;

    // Capture response
    Mock::given(method("POST"))
        .and(path("/payments/sq_sale_001/complete"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "payment": {
                "id": "sq_sale_001",
                "status": "COMPLETED",
                "amount_money": {"amount": 2000, "currency": "USD"},
                "created_at": "2026-06-30T12:00:00Z"
            }
        })))
        .mount(&mock_server)
        .await;

    let proc = SquarePaymentProcessor::new_with_endpoint(
        MOCK_API_KEY,
        MOCK_LOCATION_ID,
        &mock_server.uri(),
    );

    let result = proc.sale(&request(20)).await.unwrap();
    assert!(result.success);
    assert_eq!(result.amount_charged.minor_units, 2000);
}

// ── Capture ──────────────────────────────────────────────────────────

#[tokio::test]
async fn capture_happy_path() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/payments/sq_capture_001/complete"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "payment": {
                "id": "sq_capture_001",
                "status": "COMPLETED",
                "amount_money": {"amount": 3000, "currency": "USD"},
                "created_at": "2026-06-30T12:00:00Z"
            }
        })))
        .mount(&mock_server)
        .await;

    let proc = SquarePaymentProcessor::new_with_endpoint(
        MOCK_API_KEY,
        MOCK_LOCATION_ID,
        &mock_server.uri(),
    );

    let result = proc.capture("sq_capture_001").await.unwrap();
    assert!(result.success);
    assert_eq!(result.amount_charged.minor_units, 3000);
}

#[tokio::test]
async fn capture_not_found() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/payments/sq_missing/complete"))
        .respond_with(ResponseTemplate::new(404).set_body_json(serde_json::json!({
            "errors": [
                {"code": "NOT_FOUND", "detail": "Payment not found"}
            ]
        })))
        .mount(&mock_server)
        .await;

    let proc = SquarePaymentProcessor::new_with_endpoint(
        MOCK_API_KEY,
        MOCK_LOCATION_ID,
        &mock_server.uri(),
    );

    let err = proc.capture("sq_missing").await.unwrap_err();
    let msg = err.to_string();
    assert!(msg.contains("not found"), "unexpected error: {msg}");
}

// ── Refund ───────────────────────────────────────────────────────────

#[tokio::test]
async fn refund_happy_path() {
    let mock_server = MockServer::start().await;

    // PAY-3: a full refund (None) resolves the original charge amount by
    // fetching the payment first — mock that GET, then the refund POST.
    Mock::given(method("GET"))
        .and(path("/payments/sq_payment_001"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "payment": {
                "id": "sq_payment_001",
                "status": "COMPLETED",
                "amount_money": {"amount": 5000, "currency": "USD"},
                "created_at": "2026-06-30T12:00:00Z"
            }
        })))
        .mount(&mock_server)
        .await;

    Mock::given(method("POST"))
        .and(path("/refunds"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "refund": {
                "id": "sq_refund_001",
                "status": "COMPLETED",
                "amount_money": {"amount": 5000, "currency": "USD"}
            }
        })))
        .mount(&mock_server)
        .await;

    let proc = SquarePaymentProcessor::new_with_endpoint(
        MOCK_API_KEY,
        MOCK_LOCATION_ID,
        &mock_server.uri(),
    );

    let result = proc.refund("sq_payment_001", None, None).await.unwrap();
    assert!(result.success);
    assert_eq!(result.transaction_id.unwrap(), "sq_refund_001");
    assert_eq!(result.amount_charged.minor_units, 5000);
}

#[tokio::test]
async fn refund_declined() {
    let mock_server = MockServer::start().await;

    // PAY-3: a full refund fetches the payment first to resolve the original
    // amount — mock the GET so the test reaches the refund POST below.
    Mock::given(method("GET"))
        .and(path("/payments/sq_not_completed"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "payment": {
                "id": "sq_not_completed",
                "status": "APPROVED",
                "amount_money": {"amount": 9000, "currency": "USD"},
                "created_at": "2026-06-30T12:00:00Z"
            }
        })))
        .mount(&mock_server)
        .await;

    Mock::given(method("POST"))
        .and(path("/refunds"))
        .respond_with(ResponseTemplate::new(400).set_body_json(serde_json::json!({
            "errors": [
                {"code": "INVALID_REQUEST", "detail": "Payment has not been completed"}
            ]
        })))
        .mount(&mock_server)
        .await;

    let proc = SquarePaymentProcessor::new_with_endpoint(
        MOCK_API_KEY,
        MOCK_LOCATION_ID,
        &mock_server.uri(),
    );

    let err = proc
        .refund("sq_not_completed", None, None)
        .await
        .unwrap_err();
    let msg = err.to_string();
    assert!(
        msg.contains("not been completed"),
        "unexpected error: {msg}"
    );
}

// ── Void ─────────────────────────────────────────────────────────────

#[tokio::test]
async fn void_happy_path() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/payments/sq_void_001/cancel"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "payment": {
                "id": "sq_void_001",
                "status": "CANCELED",
                "amount_money": {"amount": 2500, "currency": "USD"},
                "created_at": "2026-06-30T12:00:00Z"
            }
        })))
        .mount(&mock_server)
        .await;

    let proc = SquarePaymentProcessor::new_with_endpoint(
        MOCK_API_KEY,
        MOCK_LOCATION_ID,
        &mock_server.uri(),
    );

    let result = proc.void("sq_void_001").await.unwrap();
    assert!(result.transaction_id.is_some());
    assert_eq!(result.amount_charged.minor_units, 2500);
}

#[tokio::test]
async fn void_not_found() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/payments/sq_nonexistent/cancel"))
        .respond_with(ResponseTemplate::new(404).set_body_json(serde_json::json!({
            "errors": [
                {"code": "NOT_FOUND", "detail": "Payment not found"}
            ]
        })))
        .mount(&mock_server)
        .await;

    let proc = SquarePaymentProcessor::new_with_endpoint(
        MOCK_API_KEY,
        MOCK_LOCATION_ID,
        &mock_server.uri(),
    );

    let err = proc.void("sq_nonexistent").await.unwrap_err();
    let msg = err.to_string();
    assert!(msg.contains("not found"), "unexpected error: {msg}");
}

// ── Receipt ──────────────────────────────────────────────────────────

#[tokio::test]
async fn receipt_happy_path() {
    let mock_server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/payments/sq_receipt_001"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "payment": {
                "id": "sq_receipt_001",
                "status": "COMPLETED",
                "amount_money": {"amount": 1000, "currency": "USD"},
                "created_at": "2026-06-30T12:00:00Z"
            }
        })))
        .mount(&mock_server)
        .await;

    let proc = SquarePaymentProcessor::new_with_endpoint(
        MOCK_API_KEY,
        MOCK_LOCATION_ID,
        &mock_server.uri(),
    );

    let receipt = proc.receipt("sq_receipt_001").await.unwrap();
    assert_eq!(receipt.transaction_id, "sq_receipt_001");
    assert_eq!(receipt.method, PaymentMethod::Card);
    assert_eq!(receipt.amount.minor_units, 1000);
}

#[tokio::test]
async fn receipt_not_found() {
    let mock_server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/payments/sq_nonexistent"))
        .respond_with(ResponseTemplate::new(404).set_body_json(serde_json::json!({
            "errors": [
                {"code": "NOT_FOUND", "detail": "Payment not found"}
            ]
        })))
        .mount(&mock_server)
        .await;

    let proc = SquarePaymentProcessor::new_with_endpoint(
        MOCK_API_KEY,
        MOCK_LOCATION_ID,
        &mock_server.uri(),
    );

    let err = proc.receipt("sq_nonexistent").await.unwrap_err();
    let msg = err.to_string();
    assert!(msg.contains("not found"), "unexpected error: {msg}");
}

// ── Request body verification ───────────────────────────────────────

#[tokio::test]
async fn authorize_sends_correct_json_body() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/payments"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "payment": {
                "id": "sq_body_001",
                "status": "APPROVED",
                "amount_money": {"amount": 5000, "currency": "USD"},
                "created_at": "2026-06-30T12:00:00Z"
            }
        })))
        .mount(&mock_server)
        .await;

    let proc = SquarePaymentProcessor::new_with_endpoint(
        MOCK_API_KEY,
        MOCK_LOCATION_ID,
        &mock_server.uri(),
    );

    let req = PaymentRequest {
        amount: Money::from_major(50, usd()).unwrap(),
        reference: Some("inv-001".into()),
        description: Some("Test order".into()),
        idempotency_key: None,
    };

    let _ = proc.authorize(&req).await.unwrap();

    // Verify the request that reached the mock server.
    let received = mock_server.received_requests().await.unwrap_or_default();
    assert_eq!(received.len(), 1, "expected 1 request");

    let body: serde_json::Value =
        serde_json::from_slice(&received[0].body).expect("request should be valid JSON");

    assert_eq!(body["amount_money"]["amount"], 5000, "body: {body}");
    assert_eq!(body["amount_money"]["currency"], "USD", "body: {body}");
    assert_eq!(body["source_id"], "EXTERNAL", "body: {body}");
    assert_eq!(body["location_id"], MOCK_LOCATION_ID, "body: {body}");
    // PAY-5: authorize must be a two-phase hold — Square's default
    // autocomplete:true would capture immediately and break the
    // authorize→capture lifecycle against the real API.
    assert_eq!(body["autocomplete"], false, "body: {body}");
    assert!(
        body["idempotency_key"].as_str().unwrap_or("").len() >= 36,
        "body: {body}"
    );
    assert_eq!(body["reference_id"], "inv-001", "body: {body}");
    assert_eq!(body["note"], "Test order", "body: {body}");

    // Verify the Authorization header (Bearer auth)
    let auth_header = received[0]
        .headers
        .get("Authorization")
        .expect("Authorization header should be present")
        .to_str()
        .unwrap_or("");
    assert!(
        auth_header.starts_with("Bearer "),
        "expected Bearer auth, got: {auth_header:?}"
    );

    // Verify Content-Type is application/json
    let content_type = received[0]
        .headers
        .get("Content-Type")
        .expect("Content-Type header should be present")
        .to_str()
        .unwrap_or("");
    assert!(
        content_type.contains("application/json"),
        "expected JSON content type, got: {content_type:?}"
    );
}

#[tokio::test]
async fn refund_sends_correct_json_body() {
    let mock_server = MockServer::start().await;

    // PAY-3: a full refund (None) fetches the payment first to resolve the
    // original charge amount — mock the GET.
    Mock::given(method("GET"))
        .and(path("/payments/sq_to_refund"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "payment": {
                "id": "sq_to_refund",
                "status": "COMPLETED",
                "amount_money": {"amount": 3000, "currency": "USD"},
                "created_at": "2026-06-30T12:00:00Z"
            }
        })))
        .mount(&mock_server)
        .await;

    Mock::given(method("POST"))
        .and(path("/refunds"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "refund": {
                "id": "sq_refund_body",
                "status": "COMPLETED",
                "amount_money": {"amount": 3000, "currency": "USD"}
            }
        })))
        .mount(&mock_server)
        .await;

    let proc = SquarePaymentProcessor::new_with_endpoint(
        MOCK_API_KEY,
        MOCK_LOCATION_ID,
        &mock_server.uri(),
    );

    let _ = proc.refund("sq_to_refund", None, None).await.unwrap();

    let received = mock_server.received_requests().await.unwrap_or_default();
    // Two requests: GET /payments/{id} then POST /refunds
    assert_eq!(received.len(), 2);

    let body: serde_json::Value =
        serde_json::from_slice(&received[1].body).expect("request should be valid JSON");

    assert_eq!(body["payment_id"], "sq_to_refund", "body: {body}");
    assert!(
        body["idempotency_key"].as_str().unwrap_or("").len() >= 36,
        "body: {body}"
    );
    // PAY-3: the full refund now carries the resolved charge amount (3000),
    // not a zero-amount USD placeholder.
    assert_eq!(body["amount_money"]["amount"], 3000, "body: {body}");
    assert_eq!(body["amount_money"]["currency"], "USD", "body: {body}");
}

// ── Network error ────────────────────────────────────────────────────

#[tokio::test]
async fn authorize_network_error() {
    // Point at a port where nothing is listening — should produce a
    // connection refused error.
    let proc = SquarePaymentProcessor::new_with_endpoint(
        MOCK_API_KEY,
        MOCK_LOCATION_ID,
        "http://127.0.0.1:1",
    );

    let err = proc.authorize(&request(10)).await.unwrap_err();
    let msg = err.to_string();
    assert!(
        msg.contains("network error"),
        "expected network error, got: {msg}"
    );
}
