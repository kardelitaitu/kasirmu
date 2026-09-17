/*
last audited 25-07-26 by RSA-Agent
crate: kasirmu-payment | status: SAFE | lint: CLEAN
findings: one-shot decline/timeout via Mutex sound; PAY-10: two "// SAFETY:" comments annotate safe lock unwraps — mislabeled, hurts unsafe-code grep hygiene
next: reword PAY-10 comments | perf: atomics + short mutex scopes
*/
//! Programmable mock for the [`PaymentProcessor`] trait.
//!
//! Use in unit tests to simulate approvals, declines, and network
//! errors without touching any payment gateway.

use async_trait::async_trait;
use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};

use foundation::{Currency, Money};
use kasirmu_hal::types::DeviceInfo;

use crate::PaymentProcessor;
use crate::error::PaymentError;
use crate::types::{PaymentMethod, PaymentReceipt, PaymentRequest, PaymentResult};

/// A builder for [`MockPaymentProcessor`].
///
/// # Example
///
/// ```
/// # use kasirmu_payment::drivers::mock::MockPaymentProcessor;
/// let proc = MockPaymentProcessor::builder()
///     .decline_next(true)
///     .build();
/// ```
#[derive(Debug, Default)]
pub struct MockPaymentProcessorBuilder {
    decline_next: bool,
    simulate_timeout: bool,
}

impl MockPaymentProcessorBuilder {
    /// If `true`, the next `authorize` call will return `Declined`.
    pub fn decline_next(mut self, decline: bool) -> Self {
        self.decline_next = decline;
        self
    }

    /// If `true`, the next `authorize` call will return `Timeout`.
    pub fn simulate_timeout(mut self, timeout: bool) -> Self {
        self.simulate_timeout = timeout;
        self
    }

    /// Build the [`MockPaymentProcessor`].
    pub fn build(self) -> MockPaymentProcessor {
        MockPaymentProcessor {
            authorize_calls: AtomicUsize::new(0),
            capture_calls: AtomicUsize::new(0),
            refund_calls: AtomicUsize::new(0),
            void_calls: AtomicUsize::new(0),
            receipt_calls: AtomicUsize::new(0),
            decline_next: Mutex::new(self.decline_next),
            simulate_timeout: Mutex::new(self.simulate_timeout),
        }
    }
}

/// A programmable mock payment processor for testing.
///
/// Tracks call counts for every method. Can be configured to simulate
/// declines and timeouts via [`MockPaymentProcessor::builder`].
#[derive(Debug)]
pub struct MockPaymentProcessor {
    authorize_calls: AtomicUsize,
    capture_calls: AtomicUsize,
    refund_calls: AtomicUsize,
    void_calls: AtomicUsize,
    receipt_calls: AtomicUsize,
    decline_next: Mutex<bool>,
    simulate_timeout: Mutex<bool>,
}

impl MockPaymentProcessor {
    /// Create a new `MockPaymentProcessor` that approves every request.
    pub fn new() -> Self {
        Self::builder().build()
    }

    /// Obtain a builder for configuring mock behaviour.
    pub fn builder() -> MockPaymentProcessorBuilder {
        MockPaymentProcessorBuilder::default()
    }

    /// Number of times `authorize` was called.
    pub fn authorize_calls(&self) -> usize {
        self.authorize_calls.load(Ordering::Relaxed)
    }

    /// Number of times `capture` was called.
    pub fn capture_calls(&self) -> usize {
        self.capture_calls.load(Ordering::Relaxed)
    }

    /// Number of times `refund` was called.
    pub fn refund_calls(&self) -> usize {
        self.refund_calls.load(Ordering::Relaxed)
    }

    /// Number of times `void` was called.
    pub fn void_calls(&self) -> usize {
        self.void_calls.load(Ordering::Relaxed)
    }

    fn check_decline(&self) -> Result<(), PaymentError> {
        // SAFETY: mock driver — lock poison is the intended failure signal in a test double.
        let mut decline = self.decline_next.lock().unwrap();
        if *decline {
            *decline = false; // one-shot
            return Err(PaymentError::Declined("mock decline".into()));
        }
        Ok(())
    }

    fn check_timeout(&self) -> Result<(), PaymentError> {
        // SAFETY: mock driver — lock poison is the intended failure signal in a test double.
        let mut timeout = self.simulate_timeout.lock().unwrap();
        if *timeout {
            *timeout = false;
            return Err(PaymentError::Timeout(5000));
        }
        Ok(())
    }
}

impl Default for MockPaymentProcessor {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl PaymentProcessor for MockPaymentProcessor {
    async fn authorize(&self, request: &PaymentRequest) -> Result<PaymentResult, PaymentError> {
        self.authorize_calls.fetch_add(1, Ordering::Relaxed);
        self.check_timeout()?;
        self.check_decline()?;

        Ok(PaymentResult {
            success: true,
            transaction_id: Some(format!("mock_txn_{:09}", 1)),
            auth_code: Some("MOCKAUTH".into()),
            amount_charged: request.amount,
            message: Some("approved".into()),
        })
    }

    async fn capture(&self, _transaction_id: &str) -> Result<PaymentResult, PaymentError> {
        self.capture_calls.fetch_add(1, Ordering::Relaxed);
        self.check_timeout()?;

        Ok(PaymentResult {
            success: true,
            transaction_id: Some("mock_capture_001".into()),
            auth_code: Some("MOCKCAPTURE".into()),
            amount_charged: Money::zero(Currency(*b"USD")),
            message: Some("captured".into()),
        })
    }

    async fn sale(&self, request: &PaymentRequest) -> Result<PaymentResult, PaymentError> {
        // Sale uses the default trait implementation which calls
        // authorize + capture. We override here for atomic mock
        // behaviour (decline/timeout checked once, not twice).
        self.authorize_calls.fetch_add(1, Ordering::Relaxed);
        self.check_timeout()?;
        self.check_decline()?;

        self.capture_calls.fetch_add(1, Ordering::Relaxed);

        Ok(PaymentResult {
            success: true,
            transaction_id: Some(format!("mock_sale_{:09}", 1)),
            auth_code: Some("MOCKSALE".into()),
            amount_charged: request.amount,
            message: Some("approved".into()),
        })
    }

    async fn refund(
        &self,
        _transaction_id: &str,
        _amount: Option<foundation::Money>,
        _idempotency_key: Option<&str>,
    ) -> Result<PaymentResult, PaymentError> {
        self.refund_calls.fetch_add(1, Ordering::Relaxed);

        Ok(PaymentResult {
            success: true,
            transaction_id: Some("mock_refund_001".into()),
            auth_code: None,
            amount_charged: Money::zero(Currency(*b"USD")),
            message: Some("refunded".into()),
        })
    }

    async fn void(&self, _transaction_id: &str) -> Result<PaymentResult, PaymentError> {
        self.void_calls.fetch_add(1, Ordering::Relaxed);

        Ok(PaymentResult {
            success: true,
            transaction_id: Some("mock_void_001".into()),
            auth_code: None,
            amount_charged: Money::zero(Currency(*b"USD")),
            message: Some("voided".into()),
        })
    }

    async fn receipt(&self, transaction_id: &str) -> Result<PaymentReceipt, PaymentError> {
        self.receipt_calls.fetch_add(1, Ordering::Relaxed);

        Ok(PaymentReceipt {
            transaction_id: transaction_id.to_owned(),
            method: PaymentMethod::Card,
            amount: Money::zero(Currency(*b"USD")),
            timestamp: "2026-06-30T12:00:00Z".into(),
            raw_data: None,
        })
    }

    fn device_info(&self) -> DeviceInfo {
        DeviceInfo::new("OZ-POS", "Mock Payment Processor", "0000-0000")
    }
}

#[cfg(test)]
#[path = "mock_tests.rs"]
mod tests;
