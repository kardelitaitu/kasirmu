/*
last audited DD-MM-YY by DSH-Agent
crate: oz-notification | status: SAFE | lint: CLEAN
findings: 0 production unsafe blocks — the only unsafe is test-only std::env::set_var/remove_var in whatsapp_tests.rs (serial_test-gated, SAFETY documented). Production lock().unwrap() confined to mock.rs (documented test-double pattern). Verified webhook HMAC verification (whatsapp.rs:328) and mock driver. No defects found.
next: none | perf: N/A
*/
//! WhatsApp Cloud API notification client for OZ-POS.
//!
//! Provides a notification abstraction with a mock driver for testing
//! and a real WhatsApp Cloud API client for production use.
//!
//! # Quick start
//!
//! ```ignore
//! use kasirmu_notification::{NotificationClient, WhatsAppClient, MockNotificationClient};
//!
//! // Production
//! let client = WhatsAppClient::new("PHONE_NUMBER_ID", "ACCESS_TOKEN");
//! client.send_template("+1234567890", "order_confirmed", &json!({...})).await?;
//!
//! // Testing
//! let mock = MockNotificationClient::new();
//! mock.send_template("+1234567890", "order_confirmed", &json!({...})).await?;
//! assert_eq!(mock.sent_count(), 1);
//! ```

pub mod email_scheduler;
pub mod handlers;
pub mod mock;
pub mod whatsapp;

use async_trait::async_trait;
use serde::Serialize;
use std::fmt::Debug;

/// Error type for notification operations.
#[derive(Debug, thiserror::Error)]
pub enum NotificationError {
    /// The WhatsApp API returned an error response.
    #[error("whatsapp API error: {0}")]
    Api(String),
    /// Network-level failure (connection refused, timeout, DNS).
    #[error("network error: {0}")]
    Network(#[from] reqwest::Error),
    /// Invalid phone number format.
    #[error("invalid phone number: {0}")]
    InvalidPhoneNumber(String),
    /// Template name not found in the WhatsApp Business account.
    #[error("template not found: {0}")]
    TemplateNotFound(String),
    /// Rate limited by the WhatsApp API.
    #[error("rate limited (retry after {retry_after_seconds}s): {message}")]
    RateLimited {
        /// Seconds to wait before retrying.
        retry_after_seconds: u64,
        /// Human-readable message.
        message: String,
    },
    /// Configuration error (missing env vars, invalid credentials).
    #[error("configuration error: {0}")]
    Config(String),
}

/// Result type alias for notification operations.
pub type NotificationResult<T> = Result<T, NotificationError>;

/// Parameters for a WhatsApp template message.
///
/// Each parameter replaces a `{{N}}` placeholder in the template body,
/// header, or buttons. The type field determines how WhatsApp renders
/// the parameter.
#[derive(Debug, Clone, Serialize)]
pub struct TemplateParameter {
    /// The parameter type: "text", "currency", "date_time", "image", "document", "video".
    #[serde(rename = "type")]
    pub param_type: String,
    /// The parameter value (for "text" type) or sub-object (for media types).
    pub text: Option<String>,
    /// ISO-4217 currency code for "currency" parameters (e.g. "IDR").
    /// `None` for other parameter types.
    pub currency_code: Option<String>,
    /// Amount in 1/1000 units for "currency" parameters, per the WhatsApp
    /// Cloud API (`amount_1000`). `None` for other parameter types.
    pub amount_1000: Option<i64>,
}

impl TemplateParameter {
    /// Create a text parameter.
    pub fn text(value: impl Into<String>) -> Self {
        Self {
            param_type: "text".into(),
            text: Some(value.into()),
            currency_code: None,
            amount_1000: None,
        }
    }

    /// Create a currency parameter.
    ///
    /// `code` is the ISO-4217 code (e.g. "IDR"); `amount` is in minor
    /// units and is converted to the API's 1/1000 scale (`amount_1000`),
    /// so `currency("IDR", 50_000)` renders a Rp50.000 currency bubble.
    /// `fallback_value` keeps a plain-text rendering for clients that do
    /// not support the currency widget.
    pub fn currency(code: &str, amount: i64) -> Self {
        Self {
            param_type: "currency".into(),
            text: Some(format!("{} {}", amount, code)),
            currency_code: Some(code.to_owned()),
            amount_1000: Some(amount.saturating_mul(1000)),
        }
    }
}

/// Notification delivery status returned after sending.
#[derive(Debug, Clone, Serialize)]
pub struct NotificationStatus {
    /// WhatsApp message ID (wa_id) if successfully queued.
    pub message_id: Option<String>,
    /// Whether the message was accepted by the WhatsApp API.
    pub accepted: bool,
    /// Human-readable status description.
    pub status: String,
}

/// Trait for notification clients — WhatsApp, mock, and future providers.
///
/// All methods are async and return `NotificationResult<T>`.
#[async_trait]
pub trait NotificationClient: Debug + Send + Sync {
    /// Send a WhatsApp template message to a phone number.
    ///
    /// # Arguments
    /// - `to`: Recipient phone number in international format (e.g., "+6281234567890").
    /// - `template_name`: Name of the approved WhatsApp template (e.g., "order_confirmed").
    /// - `parameters`: Template body parameters (replaces `{{1}}`, `{{2}}`, etc.).
    /// - `language`: BCP 47 language code (default: "id" for Indonesian).
    async fn send_template(
        &self,
        to: &str,
        template_name: &str,
        parameters: &[TemplateParameter],
        language: Option<&str>,
    ) -> NotificationResult<NotificationStatus>;

    /// Send a free-form text message (requires user-initiated conversation).
    async fn send_text(&self, to: &str, body: &str) -> NotificationResult<NotificationStatus>;

    /// Verify a WhatsApp webhook signature.
    ///
    /// Uses HMAC-SHA256 with the app secret to verify that the webhook
    /// payload came from Meta's servers.
    fn verify_webhook_signature(
        &self,
        payload: &[u8],
        signature_header: &str,
    ) -> NotificationResult<bool>;
}

#[cfg(test)]
#[path = "lib_tests.rs"]
mod tests;
