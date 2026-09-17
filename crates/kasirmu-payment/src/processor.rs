/*
last audited 25-07-26 by RSA-Agent; PAY-2 refund key added 09-09-26 (agent-2-cargo)
crate: oz-payment | status: SAFE | lint: CLEAN
findings: async_trait Send+Sync; default sale() composes authorize->capture correctly (returns declined result, propagates infra errors); lifecycle doc sound. PAY-2 CLOSED for refunds 09-09-26: refund() now takes idempotency_key: Option<&str>, giving callers a dedup handle on retries (all drivers honor it when present; fresh fallback when absent).
next: none | perf: N/A
*/
//! [`PaymentProcessor`] trait — the interface every payment gateway
//! (Stripe, Square, EMV terminal) implements.
//!
//! # Lifecycle
//!
//! ```text
//! authorize(request)
//!     │
//!     ▼
//!   success? ──no──→ void(authorization)
//!     │
//!    yes
//!     │
//!     ▼
//!   capture(transaction_id)
//!     │
//!     ▼
//!   success? ──no──→ (manual reconciliation)
//!     │
//!    yes
//!     │
//!     ▼
//!   refund(transaction_id, amount)  ←── optional later
//! ```

use async_trait::async_trait;

use crate::error::PaymentError;
use crate::types::{PaymentReceipt, PaymentRequest, PaymentResult};
use oz_hal::types::DeviceInfo;

/// A processor that can authorize, capture, refund, and void payments.
///
/// Every method is async so that network calls or hardware I/O never
/// block the main thread.
#[async_trait]
pub trait PaymentProcessor: Send + Sync {
    /// Authorize a payment (hold funds without capturing them yet).
    ///
    /// Returns a [`PaymentResult`] with a `transaction_id` on success.
    async fn authorize(&self, request: &PaymentRequest) -> Result<PaymentResult, PaymentError>;

    /// Capture an authorized payment that was previously held.
    ///
    /// `transaction_id` is the value returned by [`authorize`](Self::authorize).
    async fn capture(&self, transaction_id: &str) -> Result<PaymentResult, PaymentError>;

    /// Execute an immediate sale (authorize + capture in one call).
    ///
    /// The default implementation calls [`authorize`](Self::authorize) followed
    /// by [`capture`](Self::capture) with the returned transaction ID.
    async fn sale(&self, request: &PaymentRequest) -> Result<PaymentResult, PaymentError> {
        let auth = self.authorize(request).await?;
        if !auth.success {
            return Ok(auth);
        }
        if let Some(ref txn_id) = auth.transaction_id {
            self.capture(txn_id).await
        } else {
            Ok(auth)
        }
    }

    /// Refund a previously captured payment.
    ///
    /// If `amount` is `None` the full amount is refunded.
    ///
    /// When `idempotency_key` is `Some`, the gateway uses it to deduplicate
    /// retries — the same key with the same body produces the same result
    /// rather than a second refund. Callers MUST supply a unique key per
    /// distinct refund operation (e.g. `"{sale_id}:{refund_counter}"`).
    /// When `None` (legacy callers), the driver generates a fresh key per
    /// call, which provides no deduplication — a timeout+retry may double
    /// the refund.
    async fn refund(
        &self,
        transaction_id: &str,
        amount: Option<foundation::Money>,
        idempotency_key: Option<&str>,
    ) -> Result<PaymentResult, PaymentError>;

    /// Void / reverse a pending authorization (before capture).
    async fn void(&self, transaction_id: &str) -> Result<PaymentResult, PaymentError>;

    /// Return a receipt for a completed transaction.
    async fn receipt(&self, transaction_id: &str) -> Result<PaymentReceipt, PaymentError>;

    /// Static device / processor identity (used in logs and the setup wizard).
    fn device_info(&self) -> DeviceInfo;
}

#[cfg(test)]
#[path = "processor_tests.rs"]
mod tests;
