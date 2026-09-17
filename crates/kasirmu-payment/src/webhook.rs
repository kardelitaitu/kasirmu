/*
last audited 25-07-26 by RSA-Agent
crate: oz-payment | status: SAFE | lint: CLEAN
findings: UnverifiedWebhookGuard fails closed — correct default for a stub; per-gateway verifiers PLANNED
next: implement verifiers before webhook endpoints go live | perf: N/A
*/
//! Webhook signature verification — PLANNED (stub).
//!
//! Each gateway signs webhook payloads differently:
//!
//! * Stripe — HMAC-SHA256 over the raw body with a `whsec_` signing secret.
//! * Paddle — Paddle-Signature header, HMAC-SHA256 over `ts|payload`.
//! * Midtrans — Server-Key + order-id signature in the notification body.
//! * Square — Signature header (HMAC-SHA256 with the webhook signature key).
//!
//! This module provides a single [`WebhookVerifier`] trait so webhook
//! handlers can verify a payload without knowing which gateway sent it.
//! It is the counterpart to the per-gateway drivers in [`crate::drivers`].

use crate::error::PaymentError;

/// A verified webhook event, normalised across gateways.
#[derive(Debug, Clone)]
pub struct WebhookEvent {
    /// Normalised event type (e.g. "payment.succeeded", "refund.created").
    pub event_type: String,
    /// Gateway-specific payload (already parsed JSON object).
    pub payload: serde_json::Value,
}

/// Verifies gateway webhook signatures.
///
/// **PLANNED:** every method returns [`PaymentError::Unsupported`] until
/// the per-gateway verifiers are implemented.
#[async_trait::async_trait]
pub trait WebhookVerifier: Send + Sync {
    /// Verify the raw request body and return the parsed event.
    ///
    /// `headers` carries the gateway's signature header(s); the concrete
    /// secret is supplied at construction.
    async fn verify(
        &self,
        headers: &std::collections::HashMap<String, String>,
        body: &[u8],
    ) -> Result<WebhookEvent, PaymentError>;
}

/// A verifier that always rejects — used before a gateway's real verifier
/// is wired up. Guarantees a missing implementation fails closed, never
/// silently accepts an unverified webhook.
pub struct UnverifiedWebhookGuard;

#[async_trait::async_trait]
impl WebhookVerifier for UnverifiedWebhookGuard {
    async fn verify(
        &self,
        _headers: &std::collections::HashMap<String, String>,
        _body: &[u8],
    ) -> Result<WebhookEvent, PaymentError> {
        Err(PaymentError::Unsupported(
            "webhook verification — PLANNED, not implemented yet (fails closed)".into(),
        ))
    }
}

#[cfg(test)]
#[path = "webhook_tests.rs"]
mod tests;
