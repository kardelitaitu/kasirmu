//! Integration tests for [`MockPaymentProcessor`] using `wiremock`.
//!
//! The mock driver itself is in-memory and does not make HTTP calls;
//! these tests verify the **test infrastructure** that the other
//! wiremock-based integration tests (Stripe, Square, QRIS) depend on.
//!
//! They serve as a canary: if wiremock, `reqwest`, the tokio runtime,
//! or test setup/teardown break, these tests will catch it before the
//! processor-specific tests do.
//!
//! # Running
//!
//! ```bash
//! cargo test --package kasirmu-payment --test mock_integration
//! ```

use foundation::{Currency, Money};
use kasirmu_payment::PaymentProcessor;
use kasirmu_payment::drivers::mock::MockPaymentProcessor;
use kasirmu_payment::types::PaymentRequest;

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

/// Build a reqwest client that bypasses system proxy so localhost wiremock
/// tests work when HTTP_PROXY / HTTPS_PROXY env vars are set.
fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .no_proxy()
        .build()
        .expect("reqwest client with no_proxy should build")
}

// ── Wiremock infrastructure smoke tests ──────────────────────────────

#[tokio::test]
async fn wiremock_server_starts_and_stops() {
    let mock_server = wiremock::MockServer::start().await;

    wiremock::Mock::given(wiremock::matchers::method("POST"))
        .and(wiremock::matchers::path("/health"))
        .respond_with(
            wiremock::ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "status": "ok"
            })),
        )
        .mount(&mock_server)
        .await;

    let response = http_client()
        .post(format!("{}/health", mock_server.uri()))
        .send()
        .await
        .expect("reqwest POST to wiremock should succeed");

    assert_eq!(response.status(), 200, "wiremock should return 200");

    let body: serde_json::Value = response
        .json()
        .await
        .expect("response body should be valid JSON");

    assert_eq!(body["status"], "ok", "body should contain status: ok");

    // Verify request was received.
    let requests = mock_server.received_requests().await.unwrap_or_default();
    assert_eq!(requests.len(), 1, "wiremock should have received 1 request");
}

#[tokio::test]
async fn wiremock_matches_on_path_and_method() {
    let mock_server = wiremock::MockServer::start().await;

    // Only match POST /authorize; GET /authorize should not match.
    wiremock::Mock::given(wiremock::matchers::method("POST"))
        .and(wiremock::matchers::path("/authorize"))
        .respond_with(
            wiremock::ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "result": "approved",
                "transaction_id": "wm_txn_001"
            })),
        )
        .mount(&mock_server)
        .await;

    // Send a POST — should match.
    let resp = http_client()
        .post(format!("{}/authorize", mock_server.uri()))
        .header("Authorization", "Bearer sk_test_wm")
        .body("amount=1000&currency=usd")
        .send()
        .await
        .expect("POST should succeed");

    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["result"], "approved");
    assert_eq!(body["transaction_id"], "wm_txn_001");

    // Send a GET — should NOT match (wiremock returns 404 for unmocked routes).
    let resp = http_client()
        .get(format!("{}/authorize", mock_server.uri()))
        .send()
        .await
        .expect("GET should not error");

    assert_eq!(
        resp.status(),
        404,
        "unmocked GET /authorize should return 404"
    );

    // Two requests were received (POST matched, GET returned 404).
    let matched = mock_server.received_requests().await.unwrap_or_default();
    assert_eq!(
        matched.len(),
        2,
        "wiremock received 2 requests total (POST + GET)"
    );
}

// ── Cross-infrastructure: wiremock + MockProcessor combined ──────────

#[tokio::test]
async fn wiremock_and_mock_processor_can_coexist() {
    // Start wiremock (simulates a payment gateway ping).
    let mock_server = wiremock::MockServer::start().await;

    wiremock::Mock::given(wiremock::matchers::method("GET"))
        .and(wiremock::matchers::path("/ping"))
        .respond_with(
            wiremock::ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "service": "payment-gateway",
                "alive": true
            })),
        )
        .mount(&mock_server)
        .await;

    // Use the mock processor for a local payment.
    let mock_proc = MockPaymentProcessor::new();
    let payment_result = mock_proc.authorize(&request(15)).await.unwrap();
    assert!(payment_result.success);

    // Independently hit wiremock via reqwest.
    let resp = http_client()
        .get(format!("{}/ping", mock_server.uri()))
        .send()
        .await
        .expect("reqwest should reach wiremock");

    assert_eq!(resp.status(), 200);

    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["service"], "payment-gateway");
    assert_eq!(body["alive"], true);

    // Verify the mock processor was called independently.
    assert_eq!(mock_proc.authorize_calls(), 1);

    // Verify wiremock received our ping.
    let requests = mock_server.received_requests().await.unwrap_or_default();
    assert_eq!(requests.len(), 1, "wiremock should have received 1 request");
}
