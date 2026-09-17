/*
last audited 25-07-26 by RSA-Agent
crate: oz-payment | status: SAFE | lint: CLEAN
findings: PLANNED stub — every op returns Unsupported, fails closed
next: none until Paddle integration | perf: N/A
*/
//! Paddle payment processor — PLANNED (stub).
//!
//! Implements [`PaymentProcessor`] for Paddle (https://www.paddle.com),
//! a merchant-of-record payments platform popular for SaaS subscriptions
//! and digital goods.
//!
//! **Status: PLANNED — not yet implemented.**
//!
//! This driver exists so that:
//! - the `PaymentProcessor` trait surface is exercised from day one
//! - the cashier flow can already switch "processors" at config level
//! - wiring a real Paddle integration later is a drop-in replacement
//!
//! Planned API surface (Paddle Billing API v1):
//! - `authorize` — create a Paddle Checkout transaction and hold it
//! - `capture` — confirm the checkout payment once the customer pays
//! - `sale` — authorize + capture in one call (default trait impl)
//! - `refund` — Paddle "Adjustment" (full or partial)
//! - `void` — cancel a checkout before payment completes
//! - `receipt` — fetch transaction receipt / invoice details
//!
//! # Configuration
//!
//! Planned: `PADDLE_API_KEY` (client-side API key) read from the
//! environment at construction, mirroring the Stripe/QRIS `from_env`
//! pattern. Paddle uses `https://api.paddle.com` for the Billing API.

use async_trait::async_trait;

use foundation::Money;
use oz_hal::types::DeviceInfo;

use crate::PaymentProcessor;
use crate::error::PaymentError;
use crate::types::{PaymentReceipt, PaymentRequest, PaymentResult};

/// Base URL for the Paddle Billing API (production).
///
/// PLANNED: used once the real HTTP client is implemented.
#[allow(dead_code)]
const PADDLE_API_BASE: &str = "https://api.paddle.com";

/// A [`PaymentProcessor`] backed by Paddle.
///
/// **STUB:** every operation returns [`PaymentError::Unsupported`] until
/// the real Paddle Billing integration is implemented.
pub struct PaddlePaymentProcessor {
    /// PLANNED: client-side API key for the Paddle Billing API.
    #[allow(dead_code)]
    api_key: String,
    /// PLANNED: base URL (configurable for sandbox/testing).
    #[allow(dead_code)]
    api_base: String,
}

impl PaddlePaymentProcessor {
    /// Create a new Paddle processor with the given API key.
    ///
    /// # STUB
    ///
    /// Construction succeeds and validates the key is non-empty, but no
    /// network call is made yet.
    pub fn new(api_key: &str) -> Self {
        Self::new_with_endpoint(api_key, PADDLE_API_BASE)
    }

    /// Create a new Paddle processor with a custom API endpoint.
    ///
    /// This mirrors the `new_with_endpoint` pattern used by the other
    /// drivers so integration tests can point at a mock server later.
    pub fn new_with_endpoint(api_key: &str, api_base: &str) -> Self {
        Self {
            api_key: api_key.to_owned(),
            api_base: api_base.to_owned(),
        }
    }

    /// Create a new Paddle processor from the `PADDLE_API_KEY`
    /// environment variable.
    ///
    /// # Errors
    ///
    /// Returns [`PaymentError::Network`] if the env var is not set.
    pub fn from_env() -> Result<Self, PaymentError> {
        let key = std::env::var("PADDLE_API_KEY")
            .map_err(|_| PaymentError::Network("PADDLE_API_KEY not set".into()))?;
        Ok(Self::new(&key))
    }
}

#[async_trait]
impl PaymentProcessor for PaddlePaymentProcessor {
    async fn authorize(&self, _request: &PaymentRequest) -> Result<PaymentResult, PaymentError> {
        Err(PaymentError::Unsupported(
            "Paddle authorize — PLANNED, not implemented yet".into(),
        ))
    }

    async fn capture(&self, _transaction_id: &str) -> Result<PaymentResult, PaymentError> {
        Err(PaymentError::Unsupported(
            "Paddle capture — PLANNED, not implemented yet".into(),
        ))
    }

    async fn refund(
        &self,
        _transaction_id: &str,
        _amount: Option<Money>,
        _idempotency_key: Option<&str>,
    ) -> Result<PaymentResult, PaymentError> {
        Err(PaymentError::Unsupported(
            "Paddle refund — PLANNED, not implemented yet".into(),
        ))
    }

    async fn void(&self, _transaction_id: &str) -> Result<PaymentResult, PaymentError> {
        Err(PaymentError::Unsupported(
            "Paddle void — PLANNED, not implemented yet".into(),
        ))
    }

    async fn receipt(&self, _transaction_id: &str) -> Result<PaymentReceipt, PaymentError> {
        Err(PaymentError::Unsupported(
            "Paddle receipt — PLANNED, not implemented yet".into(),
        ))
    }

    fn device_info(&self) -> DeviceInfo {
        DeviceInfo::new("Paddle", "PaddlePaymentProcessor", "paddle")
    }
}

#[cfg(test)]
#[path = "paddle_tests.rs"]
mod tests;
