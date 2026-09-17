//! Webhook verifier — tests.
//!
//! The guard is functional (fails closed); per-gateway verifiers are stubs
//! until implemented.

use std::collections::HashMap;

use crate::webhook::{UnverifiedWebhookGuard, WebhookEvent, WebhookVerifier};

// ── UnverifiedWebhookGuard — existing test ─────────────────────────

#[tokio::test]
async fn guard_fails_closed() {
    let guard = UnverifiedWebhookGuard;
    let headers = HashMap::new();
    let result = guard.verify(&headers, b"{}").await;
    assert!(
        matches!(result, Err(crate::PaymentError::Unsupported(_))),
        "expected Unsupported error, got {result:?}"
    );
}

// ── NEW TESTS ─────────────────────────────────────────────────────

// ── UnverifiedWebhookGuard with various inputs ────────────────────

#[tokio::test]
async fn guard_fails_closed_with_nonempty_headers() {
    let guard = UnverifiedWebhookGuard;
    let mut headers = HashMap::new();
    headers.insert("stripe-signature".into(), "whsec_test123".into());
    headers.insert("content-type".into(), "application/json".into());
    let body = r#"{"id":"evt_123","type":"payment_intent.succeeded"}"#;
    let result = guard.verify(&headers, body.as_bytes()).await;
    assert!(result.is_err());
}

#[tokio::test]
async fn guard_fails_closed_with_empty_body() {
    let guard = UnverifiedWebhookGuard;
    let headers = HashMap::new();
    let result = guard.verify(&headers, b"").await;
    assert!(result.is_err());
}

#[tokio::test]
async fn guard_fails_closed_with_large_body() {
    let guard = UnverifiedWebhookGuard;
    let headers = HashMap::new();
    let body = "x".repeat(1024 * 1024); // 1MB
    let result = guard.verify(&headers, body.as_bytes()).await;
    assert!(result.is_err());
}

#[tokio::test]
async fn guard_error_message_contains_planned() {
    let guard = UnverifiedWebhookGuard;
    let headers = HashMap::new();
    let result = guard.verify(&headers, b"{}").await;
    let err = result.unwrap_err();
    let msg = err.to_string();
    assert!(
        msg.contains("PLANNED"),
        "error message should mention PLANNED: {msg}"
    );
}

#[tokio::test]
async fn guard_error_is_unsupported_variant() {
    let guard = UnverifiedWebhookGuard;
    let headers = HashMap::new();
    let result = guard.verify(&headers, b"{}").await;
    assert!(matches!(result, Err(crate::PaymentError::Unsupported(_))));
}

// ── WebhookEvent struct ───────────────────────────────────────────

#[test]
fn webhook_event_creation() {
    let event = WebhookEvent {
        event_type: "payment.succeeded".into(),
        payload: serde_json::json!({"id": "pay_123", "amount": 1000}),
    };
    assert_eq!(event.event_type, "payment.succeeded");
    assert_eq!(event.payload["id"], "pay_123");
    assert_eq!(event.payload["amount"], 1000);
}

#[test]
fn webhook_event_clone() {
    let event = WebhookEvent {
        event_type: "refund.created".into(),
        payload: serde_json::json!({"id": "ref_456"}),
    };
    let cloned = event.clone();
    assert_eq!(cloned.event_type, event.event_type);
    assert_eq!(cloned.payload, event.payload);
}

#[test]
fn webhook_event_debug() {
    let event = WebhookEvent {
        event_type: "payment.succeeded".into(),
        payload: serde_json::json!({}),
    };
    let debug = format!("{event:?}");
    assert!(debug.contains("payment.succeeded"));
    assert!(debug.contains("WebhookEvent"));
}

#[test]
fn webhook_event_various_event_types() {
    for event_type in [
        "payment.succeeded",
        "payment.failed",
        "refund.created",
        "refund.succeeded",
        "charge.dispute.created",
        "subscription.updated",
    ] {
        let event = WebhookEvent {
            event_type: event_type.into(),
            payload: serde_json::json!({}),
        };
        assert_eq!(event.event_type, event_type);
    }
}

#[test]
fn webhook_event_complex_payload() {
    let payload = serde_json::json!({
        "id": "evt_123",
        "type": "payment_intent.succeeded",
        "data": {
            "object": {
                "id": "pi_456",
                "amount": 2500,
                "currency": "usd",
                "status": "succeeded",
                "metadata": {
                    "order_id": "order_789"
                }
            }
        }
    });
    let event = WebhookEvent {
        event_type: "payment.succeeded".into(),
        payload,
    };
    assert_eq!(event.payload["data"]["object"]["id"], "pi_456");
    assert_eq!(event.payload["data"]["object"]["amount"], 2500);
    assert_eq!(event.payload["data"]["object"]["currency"], "usd");
    assert_eq!(
        event.payload["data"]["object"]["metadata"]["order_id"],
        "order_789"
    );
}

#[test]
fn webhook_event_empty_payload() {
    let event = WebhookEvent {
        event_type: "test.event".into(),
        payload: serde_json::json!({}),
    };
    assert!(event.payload.is_object());
    assert!(event.payload.as_object().unwrap().is_empty());
}

#[test]
fn webhook_event_array_payload() {
    let event = WebhookEvent {
        event_type: "batch.event".into(),
        payload: serde_json::json!([1, 2, 3]),
    };
    assert!(event.payload.is_array());
    assert_eq!(event.payload.as_array().unwrap().len(), 3);
}

// ── Custom WebhookVerifier implementation ─────────────────────────

struct MockVerifier {
    should_succeed: bool,
    event_type: String,
}

#[async_trait::async_trait]
impl WebhookVerifier for MockVerifier {
    async fn verify(
        &self,
        _headers: &HashMap<String, String>,
        _body: &[u8],
    ) -> Result<WebhookEvent, crate::PaymentError> {
        if self.should_succeed {
            Ok(WebhookEvent {
                event_type: self.event_type.clone(),
                payload: serde_json::json!({"verified": true}),
            })
        } else {
            Err(crate::PaymentError::Unsupported(
                "mock verification failed".into(),
            ))
        }
    }
}

#[tokio::test]
async fn custom_verifier_succeeds() {
    let verifier = MockVerifier {
        should_succeed: true,
        event_type: "payment.succeeded".into(),
    };
    let headers = HashMap::new();
    let result = verifier.verify(&headers, b"{}").await;
    let event = result.unwrap();
    assert_eq!(event.event_type, "payment.succeeded");
    assert_eq!(event.payload["verified"], true);
}

#[tokio::test]
async fn custom_verifier_fails() {
    let verifier = MockVerifier {
        should_succeed: false,
        event_type: String::new(),
    };
    let headers = HashMap::new();
    let result = verifier.verify(&headers, b"{}").await;
    assert!(result.is_err());
}

#[tokio::test]
async fn custom_verifier_with_stripe_like_headers() {
    let verifier = MockVerifier {
        should_succeed: true,
        event_type: "payment.succeeded".into(),
    };
    let mut headers = HashMap::new();
    headers.insert(
        "stripe-signature".into(),
        "t=1234567890,v1=abc123,v0=def456".into(),
    );
    let body =
        r#"{"id":"evt_123","type":"payment_intent.succeeded","data":{"object":{"id":"pi_456"}}}"#;
    let result = verifier.verify(&headers, body.as_bytes()).await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn custom_verifier_with_paddle_like_headers() {
    let verifier = MockVerifier {
        should_succeed: true,
        event_type: "payment.succeeded".into(),
    };
    let mut headers = HashMap::new();
    headers.insert("paddle-signature".into(), "ts=123;h1=abc123".into());
    let body = r#"{"alert_id":123,"event_type":"payment.succeeded","data":{"id":"txn_456"}}"#;
    let result = verifier.verify(&headers, body.as_bytes()).await;
    assert!(result.is_ok());
}

// ── PaymentError variants ─────────────────────────────────────────

#[test]
fn payment_error_unsupported_display() {
    let err = crate::PaymentError::Unsupported("test message".into());
    let msg = err.to_string();
    assert!(msg.contains("test message"));
}

#[test]
fn payment_error_unsupported_debug() {
    let err = crate::PaymentError::Unsupported("debug test".into());
    let debug = format!("{err:?}");
    assert!(debug.contains("Unsupported"));
    assert!(debug.contains("debug test"));
}
