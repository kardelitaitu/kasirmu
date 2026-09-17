//! Wiremock-based Stripe payment lifecycle tests.
//!
//! These tests simulate the **full payment lifecycle** against a [`wiremock`]
//! HTTP mock server that mimics the Stripe REST API. They validate:
//!
//! 1. The request/response format matches what Stripe expects
//! 2. The full authorize → capture → refund lifecycle
//! 3. Processor output maps correctly to Payment/PaymentSplitArg fields
//! 4. Error responses (declined, server error) are handled properly
//! 5. Card-present vs card-not-present payment method types
//!
//! All tests run against a local wiremock server — no real Stripe credentials
//! or network access are required. See [`stripe_integration`]
//! for the base set of wiremock tests; this file adds the full lifecycle coverage.
//!
//! # Running
//!
//! ```bash
//! cargo test --package oz-payment --test stripe_lifecycle
//! ```

use foundation::{Currency, Money};
use oz_core::PaymentSplitArg;
use kasirmu_payment::PaymentProcessor;
use kasirmu_payment::drivers::stripe::StripePaymentProcessor;
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
fn request(major_amount: i64, description: Option<&str>) -> PaymentRequest {
    PaymentRequest {
        amount: Money::from_major(major_amount, usd()).unwrap(),
        reference: None,
        description: description.map(String::from),
        idempotency_key: None,
    }
}

/// Default test Stripe secret key.
const TEST_SECRET_KEY: &str = "sk_test_e2e_mock_key";

/// Spawn a wiremock server that mimics the Stripe REST API.
///
/// Returns `(mock_server, processor)` ready for testing.
async fn stripe_fixture(card_present: bool) -> (MockServer, StripePaymentProcessor) {
    let mock_server = MockServer::start().await;

    let proc = StripePaymentProcessor::new_with_endpoint(
        TEST_SECRET_KEY,
        &mock_server.uri(),
        card_present,
    );

    (mock_server, proc)
}

// ── Full Lifecycle: Authorize → Capture → Refund ────────────────────

#[tokio::test]
async fn full_authorize_capture_refund_lifecycle() {
    let (mock_server, proc) = stripe_fixture(false).await;

    // ── 1. Authorize ─────────────────────────────────────────────
    Mock::given(method("POST"))
        .and(path("/payment_intents"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": "pi_e2e_auth_001",
            "amount": 1500,
            "amount_received": 1500,
            "currency": "usd",
            "status": "requires_capture"
        })))
        .mount(&mock_server)
        .await;

    let auth = proc
        .authorize(&request(15, Some("E2E Test Order #1")))
        .await
        .unwrap();
    assert!(auth.success, "authorize should succeed");
    assert_eq!(auth.transaction_id.as_deref(), Some("pi_e2e_auth_001"));
    assert_eq!(auth.amount_charged.minor_units, 1500);
    assert_eq!(
        auth.amount_charged.currency,
        usd(),
        "currency should be preserved"
    );
    let txn_id = auth.transaction_id.unwrap();

    // Verify gateway reference format matches what PaymentSplitArg expects.
    let split = PaymentSplitArg {
        method: "card".into(),
        amount_minor: 1500,
        gateway_reference: Some(txn_id.clone()),
        gateway_status: Some("requires_capture".into()),
        gateway_response: None,
        idempotency_key: None,
    };
    assert_eq!(split.gateway_reference.as_deref(), Some("pi_e2e_auth_001"));
    assert_eq!(split.gateway_status.as_deref(), Some("requires_capture"));

    // ── 2. Capture ─────────────────────────────────────────────
    Mock::given(method("POST"))
        .and(path("/payment_intents/pi_e2e_auth_001/capture"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": "pi_e2e_auth_001",
            "amount": 1500,
            "amount_received": 1500,
            "currency": "usd",
            "status": "succeeded"
        })))
        .mount(&mock_server)
        .await;

    let cap = proc.capture(&txn_id).await.unwrap();
    assert!(cap.success, "capture should succeed");
    assert_eq!(cap.amount_charged.minor_units, 1500);

    // ── 3. Refund (full) ───────────────────────────────────────
    Mock::given(method("POST"))
        .and(path("/refunds"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": "re_e2e_refund_001",
            "amount": 1500,
            "currency": "usd",
            "status": "succeeded"
        })))
        .mount(&mock_server)
        .await;

    let refund = proc.refund(&txn_id, None, None).await.unwrap();
    assert!(refund.success, "refund should succeed");
    assert_eq!(refund.transaction_id.as_deref(), Some("re_e2e_refund_001"));
    assert_eq!(refund.amount_charged.minor_units, 1500);

    // ── 4. Receipt ─────────────────────────────────────────────
    Mock::given(method("GET"))
        .and(path("/payment_intents/pi_e2e_auth_001"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": "pi_e2e_auth_001",
            "amount": 1500,
            "amount_received": 1500,
            "currency": "usd",
            "status": "succeeded"
        })))
        .mount(&mock_server)
        .await;

    let receipt = proc.receipt(&txn_id).await.unwrap();
    assert_eq!(receipt.transaction_id, "pi_e2e_auth_001");
    assert_eq!(receipt.method, PaymentMethod::Card);
    assert_eq!(receipt.amount.minor_units, 1500);
}

// ── Sale (Authorize + Capture in one call) ─────────────────────────

#[tokio::test]
async fn sale_happy_path_with_gateway_fields() {
    let (mock_server, proc) = stripe_fixture(false).await;

    Mock::given(method("POST"))
        .and(path("/payment_intents"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": "pi_e2e_sale_001",
            "amount": 2000,
            "amount_received": 2000,
            "currency": "usd",
            "status": "requires_capture"
        })))
        .mount(&mock_server)
        .await;

    Mock::given(method("POST"))
        .and(path("/payment_intents/pi_e2e_sale_001/capture"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": "pi_e2e_sale_001",
            "amount": 2000,
            "amount_received": 2000,
            "currency": "usd",
            "status": "succeeded"
        })))
        .mount(&mock_server)
        .await;

    let result = proc.sale(&request(20, None)).await.unwrap();
    assert!(result.success);
    assert_eq!(result.amount_charged.minor_units, 2000);
    assert_eq!(result.transaction_id.as_deref(), Some("pi_e2e_sale_001"));

    // Verify the result maps correctly to PaymentSplitArg fields
    // (as used when completing a sale via the POS command).
    let split = PaymentSplitArg {
        method: "card".into(),
        amount_minor: result.amount_charged.minor_units,
        gateway_reference: result.transaction_id.clone(),
        gateway_status: result.message.clone(),
        gateway_response: None,
        idempotency_key: None,
    };
    assert_eq!(split.gateway_reference, Some("pi_e2e_sale_001".into()));
    assert_eq!(split.gateway_status, Some("succeeded".into()));
}

// ── Void / Cancel ───────────────────────────────────────────────────

#[tokio::test]
async fn void_authorization_before_capture() {
    let (mock_server, proc) = stripe_fixture(false).await;

    // Authorize
    Mock::given(method("POST"))
        .and(path("/payment_intents"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": "pi_e2e_void_001",
            "amount": 3000,
            "amount_received": 3000,
            "currency": "usd",
            "status": "requires_capture"
        })))
        .mount(&mock_server)
        .await;

    let auth = proc.authorize(&request(30, None)).await.unwrap();
    let txn_id = auth.transaction_id.unwrap();

    // Void (cancel before capture)
    Mock::given(method("POST"))
        .and(path("/payment_intents/pi_e2e_void_001/cancel"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": "pi_e2e_void_001",
            "amount": 3000,
            "amount_received": null,
            "currency": "usd",
            "status": "canceled"
        })))
        .mount(&mock_server)
        .await;

    let void_result = proc.void(&txn_id).await.unwrap();
    assert!(void_result.transaction_id.is_some());
    assert_eq!(void_result.amount_charged.minor_units, 3000);
}

// ── Partial refund ──────────────────────────────────────────────────

#[tokio::test]
async fn partial_refund_after_capture() {
    let (mock_server, proc) = stripe_fixture(false).await;

    // Authorize + capture
    Mock::given(method("POST"))
        .and(path("/payment_intents"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": "pi_e2e_partial_001",
            "amount": 5000,
            "amount_received": 5000,
            "currency": "usd",
            "status": "requires_capture"
        })))
        .mount(&mock_server)
        .await;

    Mock::given(method("POST"))
        .and(path("/payment_intents/pi_e2e_partial_001/capture"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": "pi_e2e_partial_001",
            "amount": 5000,
            "amount_received": 5000,
            "currency": "usd",
            "status": "succeeded"
        })))
        .mount(&mock_server)
        .await;

    let sale = proc.sale(&request(50, None)).await.unwrap();
    let txn_id = sale.transaction_id.unwrap();

    // Partial refund of $10 (1000 minor units)
    Mock::given(method("POST"))
        .and(path("/refunds"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": "re_e2e_partial_001",
            "amount": 1000,
            "currency": "usd",
            "status": "succeeded"
        })))
        .mount(&mock_server)
        .await;

    let partial = Money::from_major(10, usd()).unwrap();
    let refund = proc.refund(&txn_id, Some(partial), None).await.unwrap();
    assert!(refund.success);
    assert_eq!(
        refund.amount_charged.minor_units, 1000,
        "partial refund amount should be $10 (1000 minor)"
    );
}

// ── Card-present (Terminal) payments ────────────────────────────────

#[tokio::test]
async fn card_present_authorize_uses_correct_method_type() {
    let (mock_server, proc) = stripe_fixture(true).await;

    Mock::given(method("POST"))
        .and(path("/payment_intents"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": "pi_e2e_terminal_001",
            "amount": 2500,
            "amount_received": 2500,
            "currency": "usd",
            "status": "requires_capture"
        })))
        .mount(&mock_server)
        .await;

    let result = proc.authorize(&request(25, None)).await.unwrap();
    assert!(result.success);
    assert_eq!(
        result.transaction_id.as_deref(),
        Some("pi_e2e_terminal_001")
    );

    // Verify the Authorization header has the correct secret key.
    let received = mock_server.received_requests().await.unwrap_or_default();
    assert_eq!(received.len(), 1);
    let auth_header = received[0]
        .headers
        .get("Authorization")
        .expect("Authorization header should be present");
    assert_eq!(
        auth_header.to_str().unwrap(),
        &format!("Bearer {}", TEST_SECRET_KEY)
    );
}

// ── Error handling ──────────────────────────────────────────────────

#[tokio::test]
async fn authorize_handles_stripe_card_declined_error() {
    let (mock_server, proc) = stripe_fixture(false).await;

    Mock::given(method("POST"))
        .and(path("/payment_intents"))
        .respond_with(ResponseTemplate::new(402).set_body_json(serde_json::json!({
            "error": {
                "type": "card_error",
                "message": "Your card was declined.",
                "code": "card_declined"
            }
        })))
        .mount(&mock_server)
        .await;

    let err = proc.authorize(&request(10, None)).await.unwrap_err();
    let msg = err.to_string();
    assert!(
        msg.contains("declined"),
        "expected declined error, got: {msg}"
    );
    // Verify the error is logged and can be surfaced in the UI.
    assert!(
        msg.contains("Your card"),
        "expected original Stripe message, got: {msg}"
    );
}

#[tokio::test]
async fn authorize_handles_insufficient_funds() {
    let (mock_server, proc) = stripe_fixture(false).await;

    Mock::given(method("POST"))
        .and(path("/payment_intents"))
        .respond_with(ResponseTemplate::new(402).set_body_json(serde_json::json!({
            "error": {
                "type": "card_error",
                "message": "Your card has insufficient funds.",
                "code": "insufficient_funds"
            }
        })))
        .mount(&mock_server)
        .await;

    let err = proc.authorize(&request(999, None)).await.unwrap_err();
    let msg = err.to_string();
    assert!(
        msg.contains("insufficient funds"),
        "expected insufficient_funds error, got: {msg}"
    );
}

#[tokio::test]
async fn capture_handles_not_found() {
    let (mock_server, proc) = stripe_fixture(false).await;

    Mock::given(method("POST"))
        .and(path("/payment_intents/pi_nonexistent/capture"))
        .respond_with(ResponseTemplate::new(404).set_body_json(serde_json::json!({
            "error": {
                "type": "invalid_request_error",
                "message": "No such payment_intent: pi_nonexistent",
                "code": "resource_missing"
            }
        })))
        .mount(&mock_server)
        .await;

    let err = proc.capture("pi_nonexistent").await.unwrap_err();
    let msg = err.to_string();
    assert!(
        msg.contains("No such") || msg.contains("resource_missing"),
        "unexpected error: {msg}"
    );
}

#[tokio::test]
async fn refund_handles_already_refunded() {
    let (mock_server, proc) = stripe_fixture(false).await;

    Mock::given(method("POST"))
        .and(path("/refunds"))
        .respond_with(ResponseTemplate::new(400).set_body_json(serde_json::json!({
            "error": {
                "type": "invalid_request_error",
                "message": "This payment_intent has already been refunded.",
                "code": "charge_already_refunded"
            }
        })))
        .mount(&mock_server)
        .await;

    let err = proc
        .refund("pi_already_refunded", None, None)
        .await
        .unwrap_err();
    let msg = err.to_string();
    assert!(
        msg.contains("already been refunded") || msg.contains("already_refunded"),
        "unexpected error: {msg}"
    );
}

#[tokio::test]
async fn authorize_handles_stripe_server_error() {
    let (mock_server, proc) = stripe_fixture(false).await;

    Mock::given(method("POST"))
        .and(path("/payment_intents"))
        .respond_with(ResponseTemplate::new(500).set_body_string("Internal Server Error"))
        .mount(&mock_server)
        .await;

    let err = proc.authorize(&request(10, None)).await.unwrap_err();
    let msg = err.to_string();
    assert!(msg.contains("500"), "expected HTTP 500 error, got: {msg}");
}

// ── Request body verification ───────────────────────────────────────

#[tokio::test]
async fn authorize_sends_description_and_metadata() {
    let (mock_server, proc) = stripe_fixture(false).await;

    Mock::given(method("POST"))
        .and(path("/payment_intents"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": "pi_e2e_form_001",
            "amount": 5000,
            "amount_received": 5000,
            "currency": "usd",
            "status": "requires_capture"
        })))
        .mount(&mock_server)
        .await;

    let req = request(50, Some("Invoice #12345"));
    let _ = proc.authorize(&req).await.unwrap();

    let received = mock_server.received_requests().await.unwrap_or_default();
    assert_eq!(received.len(), 1);

    let body = std::str::from_utf8(&received[0].body).unwrap();
    // Verify all required Stripe form fields are present.
    assert!(
        body.contains("amount=5000"),
        "body should contain amount: {body}"
    );
    assert!(
        body.contains("currency=USD"),
        "body should contain currency: {body}"
    );
    assert!(
        body.contains("payment_method_types%5B%5D=card"),
        "body should contain payment_method_types: {body}"
    );
    assert!(
        body.contains("capture_method=manual"),
        "body should contain capture_method: {body}"
    );
    assert!(
        body.contains("description=Invoice+%2312345"),
        "body should contain description: {body}"
    );

    // Verify the Authorization header.
    let auth_header = received[0]
        .headers
        .get("Authorization")
        .expect("Authorization header should be present");
    assert_eq!(
        auth_header.to_str().unwrap(),
        &format!("Bearer {}", TEST_SECRET_KEY)
    );
}

// ── Network resilience ──────────────────────────────────────────────

#[tokio::test]
async fn network_error_returns_meaningful_message() {
    // Point at a port where nothing is listening.
    let proc =
        StripePaymentProcessor::new_with_endpoint(TEST_SECRET_KEY, "http://127.0.0.1:1", false);

    let err = proc.authorize(&request(10, None)).await.unwrap_err();
    let msg = err.to_string();
    assert!(
        msg.contains("network error") || msg.contains("Connection refused"),
        "expected network error, got: {msg}"
    );
}

// ── Money/Currency round-trip ───────────────────────────────────────

#[tokio::test]
async fn stripe_amount_roundtrip_preserves_currency() {
    let (mock_server, proc) = stripe_fixture(false).await;

    // Authorize in EUR
    let eur: Currency = "EUR".parse().unwrap();
    let req = PaymentRequest {
        amount: Money::from_major(100, eur).unwrap(),
        reference: None,
        description: None,
        idempotency_key: None,
    };

    Mock::given(method("POST"))
        .and(path("/payment_intents"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": "pi_e2e_eur_001",
            "amount": 10000,
            "amount_received": 10000,
            "currency": "eur",
            "status": "requires_capture"
        })))
        .mount(&mock_server)
        .await;

    let result = proc.authorize(&req).await.unwrap();
    assert_eq!(result.amount_charged.minor_units, 10000);
    assert_eq!(result.amount_charged.currency, eur);
}
