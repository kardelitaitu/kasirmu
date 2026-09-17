//! Replay tests using pre-recorded payment gateway fixtures (P5-4).
//!
//! These tests load recorded HTTP request/response pairs from JSON fixture
//! files in `tests/fixtures/<driver>/<scenario>.json`, start a wiremock
//! server configured with those responses, and verify each
//! [`PaymentProcessor`] method handles them correctly.
//!
//! Unlike the manual wiremock tests in `*_integration.rs`, these tests use
//! data that was (or could be) captured from a real sandbox run, ensuring
//! the test data matches actual gateway response formats.
//!
//! # Running
//!
//! ```bash
//! cargo test --package kasirmu-payment --test recorded_fixture_tests
//! ```

use foundation::{Currency, Money};
use kasirmu_payment::PaymentProcessor;
use kasirmu_payment::drivers::{
    qris::QrisPaymentProcessor, square::SquarePaymentProcessor, stripe::StripePaymentProcessor,
};
use kasirmu_payment::types::PaymentRequest;

mod fixtures;
use fixtures::{load_scenario, start_replay_server};

/// Helper: construct a USD currency.
fn usd() -> Currency {
    "USD".parse().unwrap()
}

/// Helper: construct an IDR currency (for QRIS).
fn idr() -> Currency {
    "IDR".parse().unwrap()
}

/// Helper: create a request for the given major-unit amount.
fn request_usd(major_amount: i64) -> PaymentRequest {
    PaymentRequest {
        amount: Money::from_major(major_amount, usd()).unwrap(),
        reference: None,
        description: None,
        idempotency_key: None,
    }
}

/// Helper: create a request with IDR minor units (for QRIS).
fn request_idr(minor_amount: i64) -> PaymentRequest {
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

/// Helper: configure a stripe processor pointed at the mock server.
fn stripe_at(uri: &str) -> StripePaymentProcessor {
    StripePaymentProcessor::new_with_endpoint("sk_test_fixture", uri, false)
}

/// Helper: configure a square processor pointed at the mock server.
fn square_at(uri: &str) -> SquarePaymentProcessor {
    SquarePaymentProcessor::new_with_endpoint("EAAA_test_fixture_key", "L_FIXTURE", uri)
}

/// Helper: configure a Qris processor pointed at the mock server.
fn qris_at(uri: &str) -> QrisPaymentProcessor {
    QrisPaymentProcessor::new_with_endpoint("MID-test-fixture-key", uri, false)
}

// ── Stripe fixture tests ─────────────────────────────────────────

#[tokio::test]
async fn stripe_authorize_success_via_fixture() {
    let scenario = load_scenario("stripe", "success");
    let mock_server = start_replay_server(&scenario).await;
    let proc = stripe_at(&mock_server.uri());

    let result = proc.authorize(&request_usd(15)).await.unwrap();
    assert!(result.success);
    assert_eq!(result.transaction_id.unwrap(), "pi_fixture_success_001");
    assert_eq!(result.amount_charged.minor_units, 1500);
}

#[tokio::test]
async fn stripe_authorize_decline_via_fixture() {
    let scenario = load_scenario("stripe", "decline");
    let mock_server = start_replay_server(&scenario).await;
    let proc = stripe_at(&mock_server.uri());

    let err = proc.authorize(&request_usd(10)).await.unwrap_err();
    let msg = err.to_string();
    assert!(
        msg.contains("declined"),
        "expected declined error, got: {msg}"
    );
}

#[tokio::test]
async fn stripe_authorize_timeout_via_fixture() {
    let scenario = load_scenario("stripe", "timeout");
    let mock_server = start_replay_server(&scenario).await;
    let proc = stripe_at(&mock_server.uri());

    let err = proc.authorize(&request_usd(10)).await.unwrap_err();
    let msg = err.to_string();
    assert!(
        msg.contains("500") || msg.contains("error"),
        "expected error message containing 500 or error, got: {msg}"
    );
}

// ── Square fixture tests ─────────────────────────────────────────

#[tokio::test]
async fn square_authorize_success_via_fixture() {
    let scenario = load_scenario("square", "success");
    let mock_server = start_replay_server(&scenario).await;
    let proc = square_at(&mock_server.uri());

    let result = proc.authorize(&request_usd(15)).await.unwrap();
    assert!(result.success);
    assert_eq!(result.transaction_id.unwrap(), "sq_fixture_success_001");
    assert_eq!(result.amount_charged.minor_units, 1500);
}

#[tokio::test]
async fn square_authorize_decline_via_fixture() {
    let scenario = load_scenario("square", "decline");
    let mock_server = start_replay_server(&scenario).await;
    let proc = square_at(&mock_server.uri());

    let err = proc.authorize(&request_usd(10)).await.unwrap_err();
    let msg = err.to_string();
    assert!(
        msg.contains("declined"),
        "expected declined error, got: {msg}"
    );
}

#[tokio::test]
async fn square_authorize_timeout_via_fixture() {
    let scenario = load_scenario("square", "timeout");
    let mock_server = start_replay_server(&scenario).await;
    let proc = square_at(&mock_server.uri());

    let err = proc.authorize(&request_usd(10)).await.unwrap_err();
    let msg = err.to_string();
    assert!(
        msg.contains("500") || msg.contains("error"),
        "expected error message, got: {msg}"
    );
}

// ── QRIS fixture tests ───────────────────────────────────────────

#[tokio::test]
async fn qris_authorize_success_via_fixture() {
    let scenario = load_scenario("qris", "success");
    let mock_server = start_replay_server(&scenario).await;
    let proc = qris_at(&mock_server.uri());

    let result = proc.authorize(&request_idr(25000)).await.unwrap();
    assert!(result.success);
    assert!(result.transaction_id.is_some());
    assert_eq!(result.amount_charged.minor_units, 25000);

    let msg = result.message.unwrap_or_default();
    assert!(
        msg.contains("https://"),
        "expected QR URL in message, got: {msg}"
    );
}

#[tokio::test]
async fn qris_authorize_decline_via_fixture() {
    let scenario = load_scenario("qris", "decline");
    let mock_server = start_replay_server(&scenario).await;
    let proc = qris_at(&mock_server.uri());

    let err = proc.authorize(&request_idr(99999999)).await.unwrap_err();
    let msg = err.to_string();
    assert!(
        msg.contains("exceeds limit"),
        "expected limit error, got: {msg}"
    );
}

#[tokio::test]
async fn qris_authorize_timeout_via_fixture() {
    let scenario = load_scenario("qris", "timeout");
    let mock_server = start_replay_server(&scenario).await;
    let proc = qris_at(&mock_server.uri());

    let err = proc.authorize(&request_idr(10000)).await.unwrap_err();
    let msg = err.to_string();
    assert!(
        msg.contains("500") || msg.contains("error"),
        "expected error message, got: {msg}"
    );
}
