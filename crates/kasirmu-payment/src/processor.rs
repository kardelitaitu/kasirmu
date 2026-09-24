/*
last audited 25-07-26 by RSA-Agent; PAY-2 refund key added 09-09-26 (agent-2-cargo)
crate: kasirmu-payment | status: SAFE | lint: CLEAN
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
use kasirmu_hal::types::DeviceInfo;

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
    ///
    /// # Why there is no `idempotency_key`, and what that costs a caller
    ///
    /// Unlike [`refund`](Self::refund), this method takes **no key**, so a driver
    /// has nothing the gateway could deduplicate on. The consequence is the same
    /// one `refund`'s doc names — *"a timeout+retry may double the refund"* — and
    /// here it is **a double capture**: a capture that committed server-side but
    /// timed out before the answer arrived will be applied a second time if the
    /// caller retries.
    ///
    /// Two things follow, and they are the reason this paragraph exists rather
    /// than the parameter:
    ///
    /// * **`ResilientProcessor` treats this method as single-shot**
    ///   (`resilience.rs`, `RetryPolicy::SingleShot`). It does NOT consume its
    ///   retry budget here, because retrying would risk the second capture. That
    ///   is a deliberate REDUCTION of the decorator's behaviour, not an oversight.
    /// * **A caller that must retry has to make that safe itself** — by
    ///   reconciling on a status query before re-issuing, the way the QRIS charge
    ///   path reconciles a quiet terminal. Adding a key parameter is design doc §9
    ///   item 5, an open question; until it is taken, this doc is the contract.
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
    ///
    /// Takes no key, for the same reason [`capture`](Self::capture) does not, and
    /// carries the same cost: a void that committed server-side and timed out is
    /// applied again on a retry. [`ResilientProcessor`](crate::ResilientProcessor)
    /// therefore treats it as single-shot as well.
    ///
    /// Note this is the *payment-crate* `void`. The card-terminal trait's void
    /// (`kasirmu_hal::EdcTerminal::void`) is a different method on a different
    /// device class and has its own contract.
    async fn void(&self, transaction_id: &str) -> Result<PaymentResult, PaymentError>;

    /// Return a receipt for a completed transaction.
    async fn receipt(&self, transaction_id: &str) -> Result<PaymentReceipt, PaymentError>;

    /// Static device / processor identity (used in logs and the setup wizard).
    fn device_info(&self) -> DeviceInfo;
}

#[cfg(test)]
#[path = "processor_tests.rs"]
mod tests;
