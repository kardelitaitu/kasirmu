/*
last audited 25-07-26 by RSA-Agent (oz-notification slice A: whatsapp deep read; N-1 + N-2 FIXED 25-07-26)
crate: oz-notification | status: SAFE | lint: CLEAN
findings: N-1 FIXED — the currency template arm now maps the real code and amount_1000 carried on TemplateParameter (new currency_code/amount_1000 fields; currency() converts minor units to the API 1/1000 scale) instead of the hardcoded IDR/0 stub. N-2 FIXED — 429 handling honours the Retry-After header (captured before the body consumes the response; falls back to 60s) and validate_phone's doc now matches the 7-digit minimum. Mock client and handler call sites unchanged (currency constructor keeps its signature)
next: none | perf: N/A
*/
//! WhatsApp Cloud API client implementation.
//!
//! Uses the Meta Graph API v21.0+ to send template messages, text messages,
//! and verify webhook signatures via HMAC-SHA256.
//!
//! # Environment variables
//!
//! - `WHATSAPP_PHONE_NUMBER_ID` — The WhatsApp Business phone number ID
//! - `WHATSAPP_ACCESS_TOKEN` — Permanent or temporary access token
//! - `WHATSAPP_APP_SECRET` — App secret for webhook signature verification

use async_trait::async_trait;
use hmac::{Hmac, Mac};
use sha2::Sha256;

use crate::{
    NotificationClient, NotificationError, NotificationResult, NotificationStatus,
    TemplateParameter,
};

type HmacSha256 = Hmac<Sha256>;

/// Build the bounded HTTP client used for every Meta Graph call.
///
/// COR-31: both constructors used a bare `reqwest::Client::new()`, which has
/// no timeout of any kind. A Meta endpoint that accepts the TCP connection
/// and then never answers parks the send forever — the caller is awaiting
/// `send()`, so the queued notification neither completes nor fails, and the
/// only symptom is a message that silently never arrives.
///
/// 10s connect / 30s total. This is a small JSON POST to a well-known API,
/// not a bulk transfer, so it follows the 30s convention already used by
/// `sync_client.rs` rather than the 120s budget the export path needs.
fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(30))
        .build()
        // The builder only fails if the TLS backend cannot initialise,
        // which is fatal for any HTTPS use anyway. Falling back to
        // Client::new() would quietly restore the unbounded hang, so it is
        // logged rather than swallowed.
        .unwrap_or_else(|e| {
            tracing::error!(
                error = %e,
                "could not build bounded HTTP client for WhatsApp; requests are unbounded"
            );
            reqwest::Client::new()
        })
}

/// WhatsApp Cloud API client for sending messages via the Meta Graph API.
///
/// # Example
///
/// ```ignore
/// let client = WhatsAppClient::from_env()?;
/// client.send_template(
///     "+6281234567890",
///     "order_confirmed",
///     &[TemplateParameter::text("Order #42"), TemplateParameter::currency("IDR", 50000)],
///     Some("id"),
/// ).await?;
/// ```
#[derive(Debug)]
pub struct WhatsAppClient {
    /// WhatsApp Business phone number ID.
    phone_number_id: String,
    /// WhatsApp Cloud API access token.
    access_token: String,
    /// App secret for webhook verification (optional).
    app_secret: Option<String>,
    /// HTTP client for API requests.
    http_client: reqwest::Client,
    /// Base URL for the WhatsApp Cloud API.
    base_url: String,
}

impl WhatsAppClient {
    /// Create a new WhatsApp client with explicit credentials.
    pub fn new(phone_number_id: impl Into<String>, access_token: impl Into<String>) -> Self {
        Self {
            phone_number_id: phone_number_id.into(),
            access_token: access_token.into(),
            app_secret: None,
            http_client: http_client(),
            base_url: "https://graph.facebook.com/v21.0".into(),
        }
    }

    /// Create a WhatsApp client from environment variables.
    ///
    /// Reads `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, and
    /// optionally `WHATSAPP_APP_SECRET`.
    pub fn from_env() -> NotificationResult<Self> {
        let phone_number_id = std::env::var("WHATSAPP_PHONE_NUMBER_ID").map_err(|_| {
            NotificationError::Config(
                "WHATSAPP_PHONE_NUMBER_ID environment variable not set".into(),
            )
        })?;
        let access_token = std::env::var("WHATSAPP_ACCESS_TOKEN").map_err(|_| {
            NotificationError::Config("WHATSAPP_ACCESS_TOKEN environment variable not set".into())
        })?;
        let app_secret = std::env::var("WHATSAPP_APP_SECRET").ok();

        Ok(Self {
            phone_number_id,
            access_token,
            app_secret,
            http_client: http_client(),
            base_url: "https://graph.facebook.com/v21.0".into(),
        })
    }

    /// Set the app secret for webhook signature verification.
    pub fn with_app_secret(mut self, secret: impl Into<String>) -> Self {
        self.app_secret = Some(secret.into());
        self
    }

    /// Set a custom HTTP client (useful for testing with wiremock).
    #[doc(hidden)]
    pub fn with_http_client(mut self, client: reqwest::Client) -> Self {
        self.http_client = client;
        self
    }

    /// Validate that a phone number is in international format.
    fn validate_phone(to: &str) -> NotificationResult<()> {
        if to.is_empty() || !to.starts_with('+') {
            return Err(NotificationError::InvalidPhoneNumber(format!(
                "phone number must be in international format (e.g., +6281234567890): {to}"
            )));
        }
        // Must have at least 7 digits after the + (shortest valid country
        // numbering plans); the doc comment previously claimed 10.
        let digits: String = to.chars().filter(|c| c.is_ascii_digit()).collect();
        if digits.len() < 7 {
            return Err(NotificationError::InvalidPhoneNumber(format!(
                "phone number has too few digits: {to}"
            )));
        }
        Ok(())
    }

    /// Build the API URL for sending messages.
    fn messages_url(&self) -> String {
        format!("{}/{}/messages", self.base_url, self.phone_number_id)
    }

    /// Parse the WhatsApp API response into a NotificationStatus.
    fn parse_response(body: &serde_json::Value) -> NotificationStatus {
        let message_id = body["messages"][0]["id"].as_str().map(|s| s.to_string());
        let accepted = body["messages"][0]["message_status"].as_str() == Some("accepted");
        NotificationStatus {
            message_id,
            accepted,
            status: if accepted { "accepted" } else { "rejected" }.into(),
        }
    }
}

#[async_trait]
impl NotificationClient for WhatsAppClient {
    async fn send_template(
        &self,
        to: &str,
        template_name: &str,
        parameters: &[TemplateParameter],
        language: Option<&str>,
    ) -> NotificationResult<NotificationStatus> {
        Self::validate_phone(to)?;

        let lang_code = language.unwrap_or("id");

        let components = if parameters.is_empty() {
            serde_json::json!([{
                "type": "body",
                "parameters": []
            }])
        } else {
            serde_json::json!([{
                "type": "body",
                "parameters": parameters.iter().map(|p| {
                    match p.param_type.as_str() {
                        "text" => serde_json::json!({
                            "type": "text",
                            "text": p.text.as_deref().unwrap_or("")
                        }),
                        // N-1 fix: map the real currency code and amount
                        // (1/1000 scale per the Cloud API) instead of the
                        // previous hardcoded "IDR"/0 stub that made Meta
                        // render the fallback text for every currency.
                        "currency" => {
                            let code = p.currency_code.as_deref().unwrap_or("IDR");
                            let amount_1000 = p.amount_1000.unwrap_or(0);
                            serde_json::json!({
                                "type": "currency",
                                "currency": {
                                    "fallback_value": p.text.as_deref().unwrap_or(""),
                                    "code": code,
                                    "amount_1000": amount_1000
                                }
                            })
                        }
                        _ => serde_json::json!({
                            "type": "text",
                            "text": p.text.as_deref().unwrap_or("")
                        })
                    }
                }).collect::<Vec<_>>()
            }])
        };

        let payload = serde_json::json!({
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": to,
            "type": "template",
            "template": {
                "name": template_name,
                "language": {
                    "code": lang_code
                },
                "components": components
            }
        });

        let response = self
            .http_client
            .post(self.messages_url())
            .bearer_auth(&self.access_token)
            .json(&payload)
            .send()
            .await?;

        let status = response.status();
        // N-2 fix: capture Retry-After before the body consumes the response.
        let retry_after_header = response
            .headers()
            .get(reqwest::header::RETRY_AFTER)
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.trim().parse::<u64>().ok());
        let body: serde_json::Value = response.json().await.unwrap_or_default();

        if status.is_success() {
            Ok(Self::parse_response(&body))
        } else {
            let error = body["error"]["message"].as_str().unwrap_or("unknown error");

            if status.as_u16() == 429 {
                // N-2 fix: honour the server-supplied Retry-After header
                // when present instead of hardcoding 60 seconds; fall back
                // to 60 when the header is missing or unparseable.
                Err(NotificationError::RateLimited {
                    retry_after_seconds: retry_after_header.unwrap_or(60),
                    message: error.to_string(),
                })
            } else if body["error"]["code"].as_i64() == Some(100) {
                Err(NotificationError::TemplateNotFound(
                    template_name.to_string(),
                ))
            } else {
                Err(NotificationError::Api(error.to_string()))
            }
        }
    }

    async fn send_text(&self, to: &str, body: &str) -> NotificationResult<NotificationStatus> {
        Self::validate_phone(to)?;

        let payload = serde_json::json!({
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": to,
            "type": "text",
            "text": {
                "preview_url": false,
                "body": body
            }
        });

        let response = self
            .http_client
            .post(self.messages_url())
            .bearer_auth(&self.access_token)
            .json(&payload)
            .send()
            .await?;

        let status = response.status();
        let body: serde_json::Value = response.json().await.unwrap_or_default();

        if status.is_success() {
            Ok(Self::parse_response(&body))
        } else {
            let error = body["error"]["message"].as_str().unwrap_or("unknown error");
            Err(NotificationError::Api(error.to_string()))
        }
    }

    fn verify_webhook_signature(
        &self,
        payload: &[u8],
        signature_header: &str,
    ) -> NotificationResult<bool> {
        let app_secret = self.app_secret.as_ref().ok_or_else(|| {
            NotificationError::Config(
                "WHATSAPP_APP_SECRET not configured — cannot verify webhook signatures".into(),
            )
        })?;

        // The signature header format is: "sha256=<hex-encoded-hmac>"
        let expected_sig = signature_header
            .strip_prefix("sha256=")
            .unwrap_or(signature_header);

        let mut mac = HmacSha256::new_from_slice(app_secret.as_bytes())
            .map_err(|e| NotificationError::Config(format!("HMAC init failed: {e}")))?;
        mac.update(payload);

        let expected_bytes = hex::decode(expected_sig)
            .map_err(|e| NotificationError::Api(format!("invalid hex signature: {e}")))?;

        Ok(mac.verify_slice(&expected_bytes).is_ok())
    }
}

#[cfg(test)]
#[path = "whatsapp_tests.rs"]
mod tests;
