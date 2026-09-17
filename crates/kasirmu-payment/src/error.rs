/*
last audited 25-07-26 by RSA-Agent
crate: oz-payment | status: SAFE | lint: CLEAN
findings: 7 variants, non_exhaustive, sound taxonomy; Timeout carries ms; Declined vs Ok(success=false) convention not pinned in trait docs
next: none | perf: N/A
*/
//! Error type for `oz-payment`.

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// High-level classification of a [`PaymentError`] for retry and resilience policies.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ErrorClass {
    /// Transient infrastructure/connectivity error (e.g. network timeout or drop).
    /// Safe and recommended to retry automatically.
    Transient,
    /// Definitive terminal failure (e.g. card declined, invalid credentials, unsupported feature).
    /// Automatic retry is futile; requires operator or customer intervention.
    Terminal,
    /// Asynchronous / deferred state (e.g. QR issued, payment pending or awaiting external settlement).
    Deferred,
}

/// Errors that can originate in a payment-processor call.
#[derive(Debug, Error)]
#[non_exhaustive]
pub enum PaymentError {
    /// The processor rejected the authorization request.
    #[error("authorization declined: {0}")]
    Declined(String),

    /// The processor timed out before responding.
    #[error("processor timed out after {0} ms")]
    Timeout(u32),

    /// A network-level error prevented the call from completing.
    #[error("network error: {0}")]
    Network(String),

    /// The processor's API returned an unexpected response shape.
    #[error("invalid response: {0}")]
    InvalidResponse(String),

    /// The card was invalid (e.g. expired, incorrect CVC, unsupported card type).
    #[error("invalid card: {0}")]
    InvalidCard(String),

    /// The payment instrument expired before settlement (PAY-8: an unpaid
    /// QRIS QR past its validity window — previously mis-mapped to
    /// `InvalidCard`, which reads as a card problem to the UI).
    #[error("payment expired: {0}")]
    Expired(String),

    /// The transaction is a duplicate of a previously processed transaction.
    #[error("duplicate transaction: {0}")]
    Duplicate(String),

    /// The operation is not implemented by this driver yet (planned feature
    /// or gateway capability that has not been built).
    #[error("not implemented by this driver: {0}")]
    Unsupported(String),
}

impl PaymentError {
    /// Classify this error into an [`ErrorClass`] indicating whether it is
    /// transient (retryable), terminal (fail fast / stop), or deferred.
    #[must_use]
    pub fn classify(&self) -> ErrorClass {
        match self {
            Self::Timeout(_) | Self::Network(_) => ErrorClass::Transient,
            Self::Expired(_) => ErrorClass::Deferred,
            Self::Declined(_)
            | Self::InvalidResponse(_)
            | Self::InvalidCard(_)
            | Self::Duplicate(_)
            | Self::Unsupported(_) => ErrorClass::Terminal,
        }
    }
}

#[cfg(test)]
#[path = "error_tests.rs"]
mod tests;
