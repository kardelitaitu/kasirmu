use super::*;
use crate::drivers::mock::MockPaymentProcessor;
use foundation::{Currency, Money};

fn usd() -> Currency {
    "USD".parse().unwrap()
}

#[tokio::test]
async fn default_sale_calls_authorize_then_capture() {
    let proc = MockPaymentProcessor::new();
    let req = PaymentRequest {
        amount: Money::from_major(10, usd()).unwrap(),
        reference: None,
        description: None,
        idempotency_key: None,
    };

    let result = proc.sale(&req).await.unwrap();
    assert!(result.success);
    assert_eq!(proc.authorize_calls(), 1);
    assert_eq!(proc.capture_calls(), 1);
}

#[tokio::test]
async fn default_sale_returns_auth_failure() {
    let proc = MockPaymentProcessor::builder().decline_next(true).build();
    let req = PaymentRequest {
        amount: Money::from_major(10, usd()).unwrap(),
        reference: None,
        description: None,
        idempotency_key: None,
    };

    let result = proc.sale(&req).await;
    assert!(
        result.is_err(),
        "sale should return Err when authorize declines"
    );
    // capture should not have been called because authorize failed.
    assert_eq!(proc.authorize_calls(), 1);
    assert_eq!(proc.capture_calls(), 0);
}

#[tokio::test]
async fn authorize_happy_path() {
    let proc = MockPaymentProcessor::new();
    let req = PaymentRequest {
        amount: Money::from_major(25, usd()).unwrap(),
        reference: Some("inv-001".into()),
        description: None,
        idempotency_key: None,
    };

    let result = proc.authorize(&req).await.unwrap();
    assert!(result.success);
    assert!(result.transaction_id.is_some());
    assert_eq!(result.amount_charged.minor_units, 2500);
}

#[tokio::test]
async fn capture_happy_path() {
    let proc = MockPaymentProcessor::new();
    let result = proc.capture("txn_test_001").await.unwrap();
    assert!(result.success);
}

#[tokio::test]
async fn refund_happy_path() {
    let proc = MockPaymentProcessor::new();
    let result = proc.refund("txn_test_001", None, None).await.unwrap();
    assert!(result.success);
}

#[tokio::test]
async fn void_happy_path() {
    let proc = MockPaymentProcessor::new();
    let result = proc.void("txn_test_001").await.unwrap();
    assert!(result.success);
}

#[tokio::test]
async fn receipt_returns_data() {
    let proc = MockPaymentProcessor::new();
    let receipt = proc.receipt("txn_test_001").await.unwrap();
    assert_eq!(receipt.transaction_id, "txn_test_001");
}

#[tokio::test]
async fn device_info_returns_mock_identity() {
    let proc = MockPaymentProcessor::new();
    let info = proc.device_info();
    assert_eq!(info.vendor, "OZ-POS");
    assert_eq!(info.model, "Mock Payment Processor");
}
