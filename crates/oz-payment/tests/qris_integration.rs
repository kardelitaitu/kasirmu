//! Integration tests for [`QrisPaymentProcessor`] using `wiremock` to
//! simulate the Midtrans REST API.
//!
//! These tests start a local mock HTTP server, point the processor at it,
//! and verify that each `PaymentProcessor` method sends the correct
//! requests and handles responses correctly.
//!
//! # Running
//!
//! ```bash
//! cargo test --package oz-payment --test qris_integration
//! ```

use foundation::{Currency, Money};
use oz_payment::PaymentProcessor;
use oz_payment::drivers::qris::QrisPaymentProcessor;
use oz_payment::types::{PaymentMethod, PaymentRequest};
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{body_partial_json, method, path},
};

/// Helper: construct an IDR currency.
fn idr() -> Currency {
    "IDR".parse().unwrap()
}

/// Helper: create a request for the given minor-unit amount.
fn request(minor_amount: i64) -> PaymentRequest {
    PaymentRequest {
        amount: Money {
            minor_units: minor_amount,
            currency: idr(),
        },
        reference: None,
        description: None,
        idempotency_key: None,
    }
}

/// The mock server key used in tests.
const MOCK_SERVER_KEY: &str = "MID-server_test_key_123456";

// ── Authorize (QRIS charge) ──────────────────────────────────────────

#[tokio::test]
async fn authorize_happy_path() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/charge"))
        .respond_with(ResponseTemplate::new(201).set_body_json(serde_json::json!({
            "status_code": "201",
            "status_message": "QRIS transaction is created",
            "transaction_id": "txn_mock_001",
            "order_id": "QRIS-1234567890-abc",
            "gross_amount": "25000",
            "transaction_status": "pending",
            "qr_code_url": "https://example.com/qr/mock-qr-code"
        })))
        .mount(&mock_server)
        .await;

    let proc = QrisPaymentProcessor::new_with_endpoint(MOCK_SERVER_KEY, &mock_server.uri(), false);

    let result = proc.authorize(&request(25000)).await.unwrap();
    assert!(result.success);
    assert!(result.transaction_id.is_some());
    assert_eq!(result.amount_charged.minor_units, 25000);

    // Message should contain the QR code URL
    let msg = result.message.unwrap_or_default();
    assert!(
        msg.contains("https://"),
        "expected QR URL in message, got: {msg}"
    );
    assert!(msg.contains("pending"), "expected status in message: {msg}");
}

#[tokio::test]
async fn authorize_declined() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/charge"))
        .respond_with(ResponseTemplate::new(402).set_body_json(serde_json::json!({
            "status_code": "402",
            "status_message": "Transaction amount exceeds limit",
            "transaction_id": "",
            "order_id": ""
        })))
        .mount(&mock_server)
        .await;

    let proc = QrisPaymentProcessor::new_with_endpoint(MOCK_SERVER_KEY, &mock_server.uri(), false);

    let err = proc.authorize(&request(99999999)).await.unwrap_err();
    let msg = err.to_string();
    assert!(
        msg.contains("exceeds limit"),
        "expected limit error, got: {msg}"
    );
}

#[tokio::test]
async fn authorize_server_error() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/charge"))
        .respond_with(ResponseTemplate::new(500).set_body_string("Internal Server Error"))
        .mount(&mock_server)
        .await;

    let proc = QrisPaymentProcessor::new_with_endpoint(MOCK_SERVER_KEY, &mock_server.uri(), false);

    let err = proc.authorize(&request(10000)).await.unwrap_err();
    let msg = err.to_string();
    assert!(msg.contains("500"), "expected HTTP 500 error, got: {msg}");
}

#[tokio::test]
async fn authorize_non_json_response() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/charge"))
        .respond_with(ResponseTemplate::new(201).set_body_string("not-json"))
        .mount(&mock_server)
        .await;

    let proc = QrisPaymentProcessor::new_with_endpoint(MOCK_SERVER_KEY, &mock_server.uri(), false);

    let err = proc.authorize(&request(10000)).await.unwrap_err();
    let msg = err.to_string();
    assert!(
        msg.contains("failed to parse"),
        "expected parse error, got: {msg}"
    );
}

// ── Sale (charge + poll) ─────────────────────────────────────────────

#[tokio::test]
async fn sale_returns_qr_info() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/charge"))
        .respond_with(ResponseTemplate::new(201).set_body_json(serde_json::json!({
            "status_code": "201",
            "status_message": "QRIS transaction is created",
            "transaction_id": "txn_sale_001",
            "order_id": "QRIS-sale-001",
            "gross_amount": "35000",
            "transaction_status": "pending",
            "qr_code_url": "https://example.com/qr/sale-qr"
        })))
        .mount(&mock_server)
        .await;

    let proc = QrisPaymentProcessor::new_with_endpoint(MOCK_SERVER_KEY, &mock_server.uri(), false);

    let result = proc.sale(&request(35000)).await.unwrap();
    assert!(result.success);
    assert_eq!(result.amount_charged.minor_units, 35000);

    // Sale should return SCAN_QR|order_id|qr_url format
    let msg = result.message.unwrap_or_default();
    assert!(
        msg.starts_with("SCAN_QR|"),
        "expected SCAN_QR format, got: {msg}"
    );
    assert!(
        msg.contains("https://example.com/qr/sale-qr"),
        "expected QR URL in message: {msg}"
    );
}

// ── Capture (status polling) ─────────────────────────────────────────

#[tokio::test]
async fn capture_settlement() {
    let mock_server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/order-001/status"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "transaction_id": "txn_capture_001",
            "order_id": "order-001",
            "gross_amount": "50000",
            "transaction_status": "settlement",
            "status_code": "200",
            "status_message": "Success",
            "currency": "IDR",
            "payment_type": "qris"
        })))
        .mount(&mock_server)
        .await;

    let proc = QrisPaymentProcessor::new_with_endpoint(MOCK_SERVER_KEY, &mock_server.uri(), false);

    let result = proc.capture("order-001").await.unwrap();
    assert!(result.success);
    assert_eq!(result.amount_charged.minor_units, 50000);
    assert_eq!(result.message.unwrap_or_default(), "settlement");
}

#[tokio::test]
async fn capture_declined() {
    let mock_server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/order-deny/status"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "transaction_id": "txn_deny_001",
            "order_id": "order-deny",
            "gross_amount": "10000",
            "transaction_status": "deny",
            "status_code": "202",
            "status_message": "Transaction denied by Acquirer",
            "currency": "IDR",
            "payment_type": "qris"
        })))
        .mount(&mock_server)
        .await;

    let proc = QrisPaymentProcessor::new_with_endpoint(MOCK_SERVER_KEY, &mock_server.uri(), false);

    let err = proc.capture("order-deny").await.unwrap_err();
    let msg = err.to_string();
    assert!(
        msg.contains("denied"),
        "expected declined error, got: {msg}"
    );
}

#[tokio::test]
async fn capture_not_found() {
    let mock_server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/missing/status"))
        .respond_with(ResponseTemplate::new(404).set_body_json(serde_json::json!({
            "status_code": "404",
            "status_message": "Transaction not found"
        })))
        .mount(&mock_server)
        .await;

    let proc = QrisPaymentProcessor::new_with_endpoint(MOCK_SERVER_KEY, &mock_server.uri(), false);

    let err = proc.capture("missing").await.unwrap_err();
    let msg = err.to_string();
    assert!(
        msg.contains("not found"),
        "expected not found error, got: {msg}"
    );
}

// ── Refund ───────────────────────────────────────────────────────────

#[tokio::test]
async fn refund_happy_path() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/order-refund/refund"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "transaction_id": "txn_refund_001",
            "refund_amount": "25000",
            "status_code": "200",
            "status_message": "Success, refund transaction is created"
        })))
        .mount(&mock_server)
        .await;

    let proc = QrisPaymentProcessor::new_with_endpoint(MOCK_SERVER_KEY, &mock_server.uri(), false);

    let result = proc.refund("order-refund", None, None).await.unwrap();
    assert!(result.success);
    assert_eq!(result.amount_charged.minor_units, 25000);
}

// PAY-3: a partial refund must carry the requested amount to Midtrans
// (the driver used to ignore the parameter entirely, refunding in full).
#[tokio::test]
async fn refund_partial_amount_is_sent() {
    let mock_server = MockServer::start().await;

    let expected = Mock::given(method("POST"))
        .and(path("/order-partial/refund"))
        // partial-JSON: the body also carries a random `refund_key`.
        .and(body_partial_json(serde_json::json!({
            "amount": 7500,
            "reason": "requested_by_merchant"
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "transaction_id": "txn_partial_001",
            "refund_amount": "7500.00",
            "status_code": "200",
            "status_message": "Success, refund transaction is created"
        })))
        .expect(1)
        .mount_as_scoped(&mock_server)
        .await;

    let proc = QrisPaymentProcessor::new_with_endpoint(MOCK_SERVER_KEY, &mock_server.uri(), false);

    let result = proc
        .refund(
            "order-partial",
            Some(Money {
                minor_units: 7500,
                currency: idr(),
            }),
            None,
        )
        .await
        .unwrap();
    assert!(result.success);
    // The echoed refund_amount parses 1:1 for exp-0 IDR (PAY-1).
    assert_eq!(result.amount_charged.minor_units, 7500);
    // Dropping the scoped guard asserts the expect(1) hit count.
    drop(expected);
}

// PAY-3: non-IDR partial refunds are rejected before any network call.
#[tokio::test]
async fn refund_rejects_non_idr_amount() {
    let mock_server = MockServer::start().await;

    let proc = QrisPaymentProcessor::new_with_endpoint(MOCK_SERVER_KEY, &mock_server.uri(), false);

    let err = proc
        .refund(
            "order-usd",
            Some(Money {
                minor_units: 100,
                currency: Currency(*b"USD"),
            }),
            None,
        )
        .await
        .unwrap_err();
    assert!(err.to_string().contains("IDR"), "got: {err}");
}

#[tokio::test]
async fn refund_declined() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/order-not-settled/refund"))
        .respond_with(ResponseTemplate::new(400).set_body_json(serde_json::json!({
            "status_code": "400",
            "status_message": "Transaction cannot be refunded: not yet settled"
        })))
        .mount(&mock_server)
        .await;

    let proc = QrisPaymentProcessor::new_with_endpoint(MOCK_SERVER_KEY, &mock_server.uri(), false);

    let err = proc
        .refund("order-not-settled", None, None)
        .await
        .unwrap_err();
    let msg = err.to_string();
    assert!(
        msg.contains("not yet settled"),
        "expected refund error, got: {msg}"
    );
}

// ── Void ─────────────────────────────────────────────────────────────

#[tokio::test]
async fn void_happy_path() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/order-void/cancel"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "transaction_id": "txn_void_001",
            "status_code": "200",
            "status_message": "Success, transaction is canceled"
        })))
        .mount(&mock_server)
        .await;

    let proc = QrisPaymentProcessor::new_with_endpoint(MOCK_SERVER_KEY, &mock_server.uri(), false);

    let result = proc.void("order-void").await.unwrap();
    assert!(result.success);
    assert_eq!(
        result.message.unwrap_or_default(),
        "Success, transaction is canceled"
    );
}

#[tokio::test]
async fn void_not_found() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/order-nonexistent/cancel"))
        .respond_with(ResponseTemplate::new(404).set_body_json(serde_json::json!({
            "status_code": "404",
            "status_message": "Transaction not found"
        })))
        .mount(&mock_server)
        .await;

    let proc = QrisPaymentProcessor::new_with_endpoint(MOCK_SERVER_KEY, &mock_server.uri(), false);

    let err = proc.void("order-nonexistent").await.unwrap_err();
    let msg = err.to_string();
    assert!(
        msg.contains("not found"),
        "expected not found error, got: {msg}"
    );
}

// ── Receipt ──────────────────────────────────────────────────────────

#[tokio::test]
async fn receipt_happy_path() {
    let mock_server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/order-receipt/status"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "transaction_id": "txn_receipt_001",
            "order_id": "order-receipt",
            "gross_amount": "75000",
            "transaction_status": "settlement",
            "status_code": "200",
            "status_message": "Success",
            "currency": "IDR",
            "payment_type": "qris"
        })))
        .mount(&mock_server)
        .await;

    let proc = QrisPaymentProcessor::new_with_endpoint(MOCK_SERVER_KEY, &mock_server.uri(), false);

    let receipt = proc.receipt("order-receipt").await.unwrap();
    assert_eq!(receipt.transaction_id, "txn_receipt_001");
    assert_eq!(receipt.method, PaymentMethod::Qr);
    assert_eq!(receipt.amount.minor_units, 75000);
}

#[tokio::test]
async fn receipt_not_found() {
    let mock_server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/order-missing/status"))
        .respond_with(ResponseTemplate::new(404).set_body_json(serde_json::json!({
            "status_code": "404",
            "status_message": "Transaction not found"
        })))
        .mount(&mock_server)
        .await;

    let proc = QrisPaymentProcessor::new_with_endpoint(MOCK_SERVER_KEY, &mock_server.uri(), false);

    let err = proc.receipt("order-missing").await.unwrap_err();
    let msg = err.to_string();
    assert!(
        msg.contains("not found"),
        "expected not found error, got: {msg}"
    );
}

// ── Request body verification ───────────────────────────────────────

#[tokio::test]
async fn authorize_sends_correct_json_body() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/charge"))
        .respond_with(ResponseTemplate::new(201).set_body_json(serde_json::json!({
            "status_code": "201",
            "status_message": "OK",
            "transaction_id": "txn_body_001",
            "order_id": "QRIS-body-001",
            "gross_amount": "15000",
            "transaction_status": "pending",
            "qr_code_url": "https://example.com/qr/body-test"
        })))
        .mount(&mock_server)
        .await;

    let proc = QrisPaymentProcessor::new_with_endpoint(MOCK_SERVER_KEY, &mock_server.uri(), false);

    let _ = proc.authorize(&request(15000)).await.unwrap();

    // Verify the request that reached the mock server.
    let received = mock_server.received_requests().await.unwrap_or_default();
    assert_eq!(received.len(), 1, "expected 1 request");

    let body: serde_json::Value =
        serde_json::from_slice(&received[0].body).expect("request should be valid JSON");

    assert_eq!(body["payment_type"], "qris", "body: {body}");
    let order_id = body["transaction_details"]["order_id"]
        .as_str()
        .unwrap_or("");
    assert!(
        order_id.starts_with("QRIS-"),
        "order_id should start with QRIS-, got: {order_id}, body: {body}"
    );
    assert_eq!(
        body["transaction_details"]["gross_amount"], "15000",
        "body: {body}"
    );
    // No acquirer is configured on this processor, so the charge must carry
    // NO `qris` object at all. The previous behaviour — a hardcoded
    // `"airpay shopee"` (the legacy ShopeePay alias) — locked every merchant's
    // QR to one wallet; a generic QRIS code is what any wallet can scan.
    assert!(
        body.get("qris").is_none(),
        "generic charge must omit `qris` entirely, body: {body}"
    );
    assert!(
        !body.to_string().contains("airpay") && !body.to_string().contains("shopee"),
        "no vendor acquirer may be hardcoded into the charge, body: {body}"
    );
    assert_eq!(
        body["custom_expiry"]["expiry_duration"], 300,
        "body: {body}"
    );
    assert_eq!(body["custom_expiry"]["unit"], "second", "body: {body}");

    // Verify the Authorization header (Basic auth)
    let auth_header = received[0]
        .headers
        .get("Authorization")
        .expect("Authorization header should be present")
        .to_str()
        .unwrap_or("");
    assert!(
        auth_header.starts_with("Basic "),
        "expected Basic auth, got: {auth_header:?}"
    );
    assert!(
        auth_header.len() > 10,
        "auth header seems too short: {auth_header:?}"
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

/// The other half of the acquirer contract: omitting it is the default, but an
/// explicitly configured acquirer must still reach the wire unchanged.
#[tokio::test]
async fn authorize_sends_configured_acquirer_verbatim() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/charge"))
        .respond_with(ResponseTemplate::new(201).set_body_json(serde_json::json!({
            "status_code": "201",
            "status_message": "OK",
            "transaction_id": "txn_acq_001",
            "order_id": "QRIS-acq-001",
            "gross_amount": "15000",
            "transaction_status": "pending",
            "qr_code_url": "https://example.com/qr/acq-test"
        })))
        .mount(&mock_server)
        .await;

    let proc = QrisPaymentProcessor::new_with_endpoint(MOCK_SERVER_KEY, &mock_server.uri(), false)
        .with_acquirer("gopay");
    assert_eq!(proc.acquirer(), Some("gopay"));

    let _ = proc.authorize(&request(15000)).await.unwrap();

    let received = mock_server.received_requests().await.unwrap_or_default();
    assert_eq!(received.len(), 1, "expected 1 request");
    let body: serde_json::Value =
        serde_json::from_slice(&received[0].body).expect("request should be valid JSON");

    // The configured acquirer is forwarded verbatim...
    assert_eq!(body["qris"]["acquirer"], "gopay", "body: {body}");
    // ...and nothing else about the charge changes.
    assert_eq!(body["payment_type"], "qris", "body: {body}");
    assert_eq!(
        body["transaction_details"]["gross_amount"], "15000",
        "body: {body}"
    );
    assert_eq!(
        body["custom_expiry"]["expiry_duration"], 300,
        "body: {body}"
    );
    assert_eq!(body["custom_expiry"]["unit"], "second", "body: {body}");
}

/// A blank acquirer is treated as unset, so a misconfigured terminal falls back
/// to a generic QRIS charge rather than sending `"acquirer": ""`.
#[tokio::test]
async fn authorize_blank_acquirer_falls_back_to_generic() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/charge"))
        .respond_with(ResponseTemplate::new(201).set_body_json(serde_json::json!({
            "status_code": "201",
            "status_message": "OK",
            "transaction_id": "txn_acq_002",
            "order_id": "QRIS-acq-002",
            "gross_amount": "15000",
            "transaction_status": "pending"
        })))
        .mount(&mock_server)
        .await;

    let proc = QrisPaymentProcessor::new_with_endpoint(MOCK_SERVER_KEY, &mock_server.uri(), false)
        .with_acquirer("   ");
    assert_eq!(proc.acquirer(), None);

    let _ = proc.authorize(&request(15000)).await.unwrap();

    let received = mock_server.received_requests().await.unwrap_or_default();
    assert_eq!(received.len(), 1, "expected 1 request");
    let body: serde_json::Value =
        serde_json::from_slice(&received[0].body).expect("request should be valid JSON");
    assert!(
        body.get("qris").is_none(),
        "blank acquirer must omit `qris`, body: {body}"
    );
}

#[tokio::test]
async fn refund_sends_correct_json_body() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/order-refund-body/refund"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "transaction_id": "txn_refund_body",
            "refund_amount": "5000",
            "status_code": "200",
            "status_message": "Success"
        })))
        .mount(&mock_server)
        .await;

    let proc = QrisPaymentProcessor::new_with_endpoint(MOCK_SERVER_KEY, &mock_server.uri(), false);

    let _ = proc.refund("order-refund-body", None, None).await.unwrap();

    let received = mock_server.received_requests().await.unwrap_or_default();
    assert_eq!(received.len(), 1);

    let body: serde_json::Value =
        serde_json::from_slice(&received[0].body).expect("request should be valid JSON");

    assert!(
        body["refund_key"]
            .as_str()
            .unwrap_or("")
            .contains("refund-order-refund-body-"),
        "refund_key should contain the order id, got: {body}"
    );
    assert!(
        body["amount"].is_null(),
        "amount should be null for full refund, got: {body}"
    );
    assert_eq!(body["reason"], "requested_by_merchant", "body: {body}");
}

// ── Network error ────────────────────────────────────────────────────

#[tokio::test]
async fn authorize_network_error() {
    // Point at a port where nothing is listening — should produce a
    // connection refused error.
    let proc =
        QrisPaymentProcessor::new_with_endpoint(MOCK_SERVER_KEY, "http://127.0.0.1:1", false);

    let err = proc.authorize(&request(10000)).await.unwrap_err();
    let msg = err.to_string();
    assert!(
        msg.contains("network error"),
        "expected network error, got: {msg}"
    );
}
