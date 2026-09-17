use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;

use async_trait::async_trait;
use foundation::Money;
use oz_hal::types::DeviceInfo;

use super::*;
use crate::error::PaymentError;
use crate::processor::PaymentProcessor;

use crate::types::{PaymentReceipt, PaymentRequest, PaymentResult};

struct FlakyMockProcessor {
    call_count: AtomicU32,
    fail_until_attempt: u32,
    fail_with: PaymentError,
}

impl FlakyMockProcessor {
    fn new(fail_until_attempt: u32, fail_with: PaymentError) -> Self {
        Self {
            call_count: AtomicU32::new(0),
            fail_until_attempt,
            fail_with,
        }
    }

    fn calls(&self) -> u32 {
        self.call_count.load(Ordering::SeqCst)
    }
    fn usd() -> foundation::Currency {
        "USD".parse().unwrap()
    }
}

#[async_trait]
impl PaymentProcessor for FlakyMockProcessor {
    async fn authorize(&self, _request: &PaymentRequest) -> Result<PaymentResult, PaymentError> {
        let count = self.call_count.fetch_add(1, Ordering::SeqCst) + 1;
        if count <= self.fail_until_attempt {
            match &self.fail_with {
                PaymentError::Network(msg) => Err(PaymentError::Network(msg.clone())),
                PaymentError::Timeout(ms) => Err(PaymentError::Timeout(*ms)),
                PaymentError::Declined(msg) => Err(PaymentError::Declined(msg.clone())),
                other => Err(PaymentError::Unsupported(other.to_string())),
            }
        } else {
            Ok(PaymentResult {
                success: true,
                transaction_id: Some("tx_123".into()),
                auth_code: Some("auth_ok".into()),
                amount_charged: Money::from_major(10, Self::usd()).unwrap(),
                message: Some("approved".into()),
            })
        }
    }

    async fn capture(&self, _transaction_id: &str) -> Result<PaymentResult, PaymentError> {
        Ok(PaymentResult {
            success: true,
            transaction_id: Some("tx_123".into()),
            auth_code: None,
            amount_charged: Money::from_major(10, Self::usd()).unwrap(),
            message: Some("captured".into()),
        })
    }

    async fn refund(
        &self,
        _transaction_id: &str,
        _amount: Option<Money>,
        _idempotency_key: Option<&str>,
    ) -> Result<PaymentResult, PaymentError> {
        Ok(PaymentResult {
            success: true,
            transaction_id: Some("tx_ref".into()),
            auth_code: None,
            amount_charged: Money::from_major(10, Self::usd()).unwrap(),
            message: Some("refunded".into()),
        })
    }

    async fn void(&self, _transaction_id: &str) -> Result<PaymentResult, PaymentError> {
        Ok(PaymentResult {
            success: true,
            transaction_id: None,
            auth_code: None,
            amount_charged: Money::zero(Self::usd()),
            message: Some("voided".into()),
        })
    }

    async fn receipt(&self, _transaction_id: &str) -> Result<PaymentReceipt, PaymentError> {
        Err(PaymentError::Unsupported("receipt not implemented".into()))
    }

    fn device_info(&self) -> DeviceInfo {
        DeviceInfo::new("Mock", "Flaky", "0000")
    }
}

#[tokio::test]
async fn resilient_processor_retries_transient_error_and_succeeds() {
    let flaky = Arc::new(FlakyMockProcessor::new(
        2, // fails first 2 calls, succeeds on 3rd
        PaymentError::Network("temporary connection drop".into()),
    ));

    let config = ResilientProcessorConfig {
        max_retries: 3,
        initial_backoff_ms: 1,
        max_backoff_ms: 5,
        failure_threshold: 5,
        cooldown_duration: Duration::from_secs(10),
    };

    let resilient = ResilientProcessor::with_config(flaky.clone(), config);
    let req = PaymentRequest {
        amount: Money::from_major(10, FlakyMockProcessor::usd()).unwrap(),
        reference: None,
        description: None,
        idempotency_key: None,
    };

    let res = resilient
        .authorize(&req)
        .await
        .expect("should succeed on retry");
    assert!(res.success);
    assert_eq!(flaky.calls(), 3); // attempt 0 (fail), retry 1 (fail), retry 2 (success)
}

#[tokio::test]
async fn resilient_processor_does_not_retry_terminal_error() {
    let flaky = Arc::new(FlakyMockProcessor::new(
        5,
        PaymentError::Declined("card stolen".into()),
    ));

    let config = ResilientProcessorConfig {
        max_retries: 3,
        initial_backoff_ms: 1,
        max_backoff_ms: 5,
        failure_threshold: 5,
        cooldown_duration: Duration::from_secs(10),
    };

    let resilient = ResilientProcessor::with_config(flaky.clone(), config);
    let req = PaymentRequest {
        amount: Money::from_major(10, FlakyMockProcessor::usd()).unwrap(),
        reference: None,
        description: None,
        idempotency_key: None,
    };

    let res = resilient.authorize(&req).await;
    assert!(matches!(res, Err(PaymentError::Declined(_))));
    assert_eq!(flaky.calls(), 1); // no retries for terminal errors
}

#[tokio::test]
async fn circuit_breaker_trips_and_fails_fast() {
    let flaky = Arc::new(FlakyMockProcessor::new(100, PaymentError::Timeout(1000)));

    let config = ResilientProcessorConfig {
        max_retries: 1,
        initial_backoff_ms: 1,
        max_backoff_ms: 2,
        failure_threshold: 2, // 2 failed operations trip the breaker
        cooldown_duration: Duration::from_millis(50),
    };

    let resilient = ResilientProcessor::with_config(flaky.clone(), config);
    let req = PaymentRequest {
        amount: Money::from_major(10, FlakyMockProcessor::usd()).unwrap(),
        reference: None,
        description: None,
        idempotency_key: None,
    };

    // Op 1: 1 try + 1 retry = 2 calls to flaky -> fails operation -> failure count = 1
    let _ = resilient.authorize(&req).await;
    assert_eq!(resilient.breaker().state().await, CircuitState::Closed);

    // Op 2: 1 try + 1 retry = 2 calls to flaky -> fails operation -> failure count = 2 >= threshold -> trips Open
    let _ = resilient.authorize(&req).await;
    assert_eq!(resilient.breaker().state().await, CircuitState::Open);

    let calls_before_open = flaky.calls();

    // Op 3: fails fast without touching inner processor
    let res = resilient.authorize(&req).await;
    assert!(matches!(res, Err(PaymentError::Network(_))));
    assert_eq!(flaky.calls(), calls_before_open);

    // Wait for cooldown
    tokio::time::sleep(Duration::from_millis(60)).await;
    assert_eq!(resilient.breaker().state().await, CircuitState::HalfOpen);
}
