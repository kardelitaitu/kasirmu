//! Paddle payment processor — STUB test placeholder.
//!
//! Tests will be added when the driver is implemented.
//! See `paddle.rs` for the planned API surface.

use foundation::{Currency, Money};

use crate::PaymentProcessor;
use crate::drivers::paddle::PaddlePaymentProcessor;

fn usd() -> Currency {
    "USD".parse().unwrap()
}

/// Verify the driver can be constructed and returns the expected
/// "not implemented" error for every operation.
#[tokio::test]
async fn stub_returns_unsupported() {
    let proc = PaddlePaymentProcessor::new("test-key");
    let req = crate::types::PaymentRequest {
        amount: Money::from_major(10, usd()).unwrap(),
        reference: Some("test-ref".into()),
        description: None,
        idempotency_key: None,
    };

    let result = proc.authorize(&req).await;
    assert!(
        matches!(result, Err(crate::PaymentError::Unsupported(_))),
        "expected Unsupported error, got {result:?}"
    );
}
