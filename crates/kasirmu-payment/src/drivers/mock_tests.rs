use super::*;
use foundation::Currency;

fn usd() -> Currency {
    "USD".parse().unwrap()
}

fn make_req() -> PaymentRequest {
    PaymentRequest {
        amount: Money::from_major(10, usd()).unwrap(),
        reference: None,
        description: None,
        idempotency_key: None,
    }
}

#[tokio::test]
async fn mock_approves_by_default() {
    let p = MockPaymentProcessor::new();
    let result = p.authorize(&make_req()).await.unwrap();
    assert!(result.success);
    assert_eq!(p.authorize_calls(), 1);
}

#[tokio::test]
async fn mock_decline() {
    let p = MockPaymentProcessor::builder().decline_next(true).build();
    let result = p.authorize(&make_req()).await;
    assert!(matches!(result, Err(PaymentError::Declined(_))));
}

#[tokio::test]
async fn mock_decline_is_one_shot() {
    let p = MockPaymentProcessor::builder().decline_next(true).build();
    // First call is declined.
    assert!(p.authorize(&make_req()).await.is_err());
    // Second call is approved.
    let result = p.authorize(&make_req()).await.unwrap();
    assert!(result.success);
}

#[tokio::test]
async fn mock_timeout() {
    let p = MockPaymentProcessor::builder()
        .simulate_timeout(true)
        .build();
    let result = p.authorize(&make_req()).await;
    assert!(matches!(result, Err(PaymentError::Timeout(5000))));
}

#[tokio::test]
async fn mock_sale_approves() {
    let p = MockPaymentProcessor::new();
    let result = p.sale(&make_req()).await.unwrap();
    assert!(result.success);
}

#[tokio::test]
async fn mock_sale_declines() {
    let p = MockPaymentProcessor::builder().decline_next(true).build();
    let result = p.sale(&make_req()).await;
    assert!(result.is_err());
}

#[tokio::test]
async fn mock_refund() {
    let p = MockPaymentProcessor::new();
    let result = p.refund("txn_001", None, None).await.unwrap();
    assert!(result.success);
    assert_eq!(p.refund_calls(), 1);
}

#[tokio::test]
async fn mock_void() {
    let p = MockPaymentProcessor::new();
    let result = p.void("txn_001").await.unwrap();
    assert!(result.success);
    assert_eq!(p.void_calls(), 1);
}

#[tokio::test]
async fn mock_receipt() {
    let p = MockPaymentProcessor::new();
    let receipt = p.receipt("txn_001").await.unwrap();
    assert_eq!(receipt.transaction_id, "txn_001");
}

#[tokio::test]
async fn mock_device_info() {
    let p = MockPaymentProcessor::new();
    let info = p.device_info();
    assert_eq!(info.vendor, "OZ-POS");
}

#[tokio::test]
async fn mock_tracks_calls() {
    let p = MockPaymentProcessor::new();
    p.authorize(&make_req()).await.unwrap();
    p.authorize(&make_req()).await.unwrap();
    p.authorize(&make_req()).await.unwrap();
    assert_eq!(p.authorize_calls(), 3);
}
