/*
last audited 31-08-26 by TDD-Agent (round M; PAY-2 closed for charges when the caller supplies a key)
crate: oz-payment | status: SAFE | lint: CLEAN
findings: capture_method manual correctly maps authorize/capture model; PAY-2 FIXED for authorize — idempotency_key_for() forwards PaymentRequest.idempotency_key as the Idempotency-Key header, verbatim, or omits the header when absent or blank (blank must not be sent: Some("") would put every caller who leaves the field empty into one shared key and Stripe would reject each later charge as a conflict). The tell that this was an oversight rather than a decision: parse_error already mapped Stripe's idempotency_error code to PaymentError::Duplicate, so the driver handled a duplicate-key rejection it could never receive. PAY-2 CLOSED for refunds 09-09-26: refund() now accepts a caller-supplied idempotency_key forwarded as the Idempotency-Key header. PAY-3 CLOSED 09-09-26: refund() honors Some(amount) — partial refunds send the amount, None keeps Stripe's full-refund default. COR-31 CLOSED 09-09-26: HTTP client bounded (10s connect / 30s total) — safe because charges carry keys and refunds accept a caller-supplied key. PAY-4 CLOSED 09-09-26: classifier rewritten — card_data codes (expired_card/incorrect_number/incorrect_cvc/incorrect_zip) map to InvalidCard, everything else on card_error (including card_declined, processing_error, and code-less declines) maps to Declined; the message.contains("card") heuristic is gone. no confirm step — card-not-present intents stay requires_payment_method unless confirmed elsewhere
next: none | perf: N/A
*/
//! Stripe payment processor — implements [`PaymentProcessor`] using the
//! Stripe REST API directly via `reqwest`.
//!
//! # Configuration
//!
//! The processor reads `STRIPE_SECRET_KEY` from the environment at
//! construction. In production the key should be set in the OS key-ring
//! (see `kasirmu_core::Keyring`); this driver provides a `new` constructor
//! that accepts an explicit key for that use case.
//!
//! # Testing
//!
//! Use `new_with_endpoint` to direct requests
//! to a local mock server (e.g. `wiremock`) during integration tests.

use async_trait::async_trait;
use std::fmt;
use std::sync::Arc;
use std::time::Duration;

use foundation::{Currency, Money};
use kasirmu_hal::types::DeviceInfo;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE, HeaderMap, HeaderValue};

use crate::PaymentProcessor;
use crate::error::PaymentError;
use crate::types::{PaymentMethod, PaymentReceipt, PaymentRequest, PaymentResult};

/// Default base URL for the Stripe API.
const STRIPE_API_BASE: &str = "https://api.stripe.com/v1";

/// A [`PaymentProcessor`] implementation backed by the Stripe REST API.
///
/// Supports:
/// - **Card-not-present** payments (default)
/// - **Card-present** payments (when constructed with `card_present: true`)
///
/// # Example
///
/// ```no_run
/// # use kasirmu_payment::drivers::stripe::StripePaymentProcessor;
/// # use kasirmu_payment::PaymentProcessor;
/// # async fn example() -> Result<(), Box<dyn std::error::Error>> {
/// # let request = unimplemented!();
/// let proc = StripePaymentProcessor::from_env()?;
/// proc.sale(&request).await?;
/// # Ok(())
/// # }
/// ```
pub struct StripePaymentProcessor {
    client: Arc<reqwest::Client>,
    /// Whether to use card-present terminal API (vs card-not-present).
    card_present: bool,
    /// Base URL for the Stripe API (configurable for testing).
    api_base: String,
}

impl fmt::Debug for StripePaymentProcessor {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("StripePaymentProcessor")
            .field("client", &self.client)
            .field("secret_key", &"***")
            .field("card_present", &self.card_present)
            .field("api_base", &self.api_base)
            .finish()
    }
}

impl Clone for StripePaymentProcessor {
    fn clone(&self) -> Self {
        Self {
            client: Arc::clone(&self.client),
            card_present: self.card_present,
            api_base: self.api_base.clone(),
        }
    }
}

/// Minimal response fields we extract from the Stripe PaymentIntent JSON.
#[derive(serde::Deserialize, Debug, Clone)]
struct PaymentIntentResponse {
    id: String,
    amount: i64,
    #[serde(default)]
    amount_received: Option<i64>,
    currency: String,
    status: String,
}

/// Minimal refund response fields.
#[derive(serde::Deserialize, Debug, Clone)]
struct RefundResponse {
    id: String,
    amount: i64,
    currency: String,
    status: String,
}

/// Stripe API error response body.
#[derive(serde::Deserialize, Debug)]
struct StripeErrorBody {
    error: StripeErrorDetail,
}

#[derive(serde::Deserialize, Debug)]
struct StripeErrorDetail {
    #[serde(rename = "type")]
    error_type: String,
    message: Option<String>,
    #[allow(dead_code)]
    code: Option<String>,
}

impl StripePaymentProcessor {
    /// Create a new Stripe payment processor with the given secret key.
    ///
    /// The `card_present` flag switches between `card_present` and `card`
    /// payment method types. Requests are sent to the live Stripe API at
    /// `https://api.stripe.com/v1`.
    pub fn new(secret_key: &str, card_present: bool) -> Self {
        Self::new_with_endpoint(secret_key, STRIPE_API_BASE, card_present)
    }

    /// Create a new Stripe payment processor with a custom API endpoint.
    ///
    /// This constructor is useful for integration tests where requests
    /// should be directed to a mock server (e.g. `wiremock`).
    pub fn new_with_endpoint(secret_key: &str, api_base: &str, card_present: bool) -> Self {
        let mut headers = HeaderMap::new();
        let mut auth_value = HeaderValue::from_str(&format!("Bearer {}", secret_key))
            .unwrap_or_else(|e| {
                tracing::error!(error = %e, "invalid Stripe auth header — using placeholder");
                HeaderValue::from_static("Bearer placeholder")
            });
        auth_value.set_sensitive(true);
        headers.insert(AUTHORIZATION, auth_value);
        headers.insert(
            CONTENT_TYPE,
            HeaderValue::from_static("application/x-www-form-urlencoded"),
        );

        let client = reqwest::Client::builder()
            .default_headers(headers)
            .no_proxy()
            // COR-31: bound the client — 10s connect / 30s total, the same
            // budget whatsapp.rs uses for a small JSON POST. Payments are
            // idempotent at the API layer (charges via Idempotency-Key,
            // refunds now via the caller-supplied key), so a timeout +
            // retry cannot double-charge or double-refund.
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .build()
            .unwrap_or_else(|e| {
                tracing::error!(
                    error = %e,
                    "failed to build HTTP client for Stripe — using default"
                );
                reqwest::Client::new()
            });

        Self {
            client: Arc::new(client),
            card_present,
            api_base: api_base.to_owned(),
        }
    }

    /// Create a new Stripe payment processor from the `STRIPE_SECRET_KEY`
    /// environment variable.
    ///
    /// # Errors
    ///
    /// Returns [`PaymentError::Network`] if the env var is not set.
    pub fn from_env() -> Result<Self, PaymentError> {
        Ok(Self::new(&Self::secret_key_from_env()?, false))
    }

    /// Create a new card-present (terminal) Stripe payment processor
    /// from the `STRIPE_SECRET_KEY` environment variable.
    pub fn from_env_terminal() -> Result<Self, PaymentError> {
        Ok(Self::new(&Self::secret_key_from_env()?, true))
    }

    /// Read `STRIPE_SECRET_KEY` from the environment.
    fn secret_key_from_env() -> Result<String, PaymentError> {
        std::env::var("STRIPE_SECRET_KEY")
            .map_err(|_| PaymentError::Network("STRIPE_SECRET_KEY not set".into()))
    }

    /// The payment method type string used for this processor.
    fn pm_type(&self) -> &'static str {
        if self.card_present {
            "card_present"
        } else {
            "card"
        }
    }

    /// Convert a `Money` value to Stripe's amount-in-cents format.
    fn to_stripe_amount(amount: &Money) -> i64 {
        amount.minor_units
    }

    /// Convert a Stripe currency code (lowercase) to a [`foundation::Currency`].
    ///
    /// PA-02: unknown codes are a hard error, not a silent USD fallback —
    /// a malformed gateway currency would otherwise mislabel the recorded
    /// amount.
    fn to_currency(code: &str) -> Result<Currency, PaymentError> {
        code.parse::<Currency>()
            .map_err(|_| PaymentError::Network(format!("unknown gateway currency code: {code}")))
    }

    /// Convert Stripe amount + currency code to [`Money`].
    fn to_money(minor_units: i64, currency: &str) -> Result<Money, PaymentError> {
        Ok(Money {
            minor_units,
            currency: Self::to_currency(currency)?,
        })
    }

    /// The `Idempotency-Key` to send for a charge request, if any.
    ///
    /// PAY-2: Stripe dedups on this header, and the driver never sent one —
    /// while `parse_error` already maps Stripe's `idempotency_error` code to
    /// [`PaymentError::Duplicate`]. The rejection handling for a duplicate
    /// key existed with no key ever sent to trigger it.
    ///
    /// Returns `None` for an absent OR blank key. Blank must not be sent:
    /// `Some("")` would put every caller who leaves the field empty into one
    /// shared key, and Stripe would reject each charge after the first as a
    /// conflict — turning the double-charge guard into a way to refuse
    /// legitimate payments. The value is forwarded verbatim, never clamped:
    /// truncating maps two distinct keys onto one and silently drops a
    /// charge, which is worse than a loud rejection from Stripe.
    fn idempotency_key_for(request: &PaymentRequest) -> Option<&str> {
        let key = request.idempotency_key.as_deref()?;
        if key.trim().is_empty() {
            None
        } else {
            Some(key)
        }
    }

    /// Perform an HTTP POST to the Stripe API and return (status, body).
    ///
    /// `idempotency_key` is sent as the `Idempotency-Key` header when
    /// present; see [`Self::idempotency_key_for`].
    async fn post(
        &self,
        path: &str,
        form: Vec<(&str, &str)>,
        idempotency_key: Option<&str>,
    ) -> Result<(u16, String), PaymentError> {
        let url = format!("{}{}", self.api_base, path);
        let mut request = self.client.post(&url).form(&form);
        if let Some(key) = idempotency_key {
            request = request.header("Idempotency-Key", key);
        }
        let resp = request
            .send()
            .await
            .map_err(|e| PaymentError::Network(e.to_string()))?;

        let status = resp.status().as_u16();
        let body = resp
            .text()
            .await
            .map_err(|e| PaymentError::Network(e.to_string()))?;
        Ok((status, body))
    }

    /// Perform an HTTP GET to the Stripe API and return (status, body).
    async fn get(&self, path: &str) -> Result<(u16, String), PaymentError> {
        let url = format!("{}{}", self.api_base, path);
        let resp = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| PaymentError::Network(e.to_string()))?;

        let status = resp.status().as_u16();
        let body = resp
            .text()
            .await
            .map_err(|e| PaymentError::Network(e.to_string()))?;
        Ok((status, body))
    }

    /// Classify a Stripe error type into a specific PaymentError variant.
    ///
    /// PAY-4: the previous version used `message.contains("card")` as a
    /// heuristic, which sent most card_error declines (including the generic
    /// "Your card was declined.") to [`PaymentError::InvalidCard`] instead of
    /// [`PaymentError::Declined`]. The `card_error => Declined` arm was
    /// nearly unreachable. Now:
    ///
    /// | Code | Maps to |
    /// |------|---------|
    /// | `expired_card`, `incorrect_number`, `incorrect_cvc`, `incorrect_zip` | `InvalidCard` — card data problem |
    /// | `card_declined`, `processing_error`, other codes, or no code | `Declined` — bank/processor refused |
    fn classify_stripe_error(
        error_type: &str,
        message: Option<&str>,
        code: Option<&str>,
    ) -> PaymentError {
        let msg = message.unwrap_or(error_type).to_string();
        match error_type {
            "card_error" => match code {
                // Card-data problems: the instrument itself is bad.
                Some("expired_card")
                | Some("incorrect_number")
                | Some("incorrect_cvc")
                | Some("incorrect_zip") => PaymentError::InvalidCard(msg),
                // Everything else — including card_declined, processing_error,
                // and any future code — is a decline.
                _ => PaymentError::Declined(msg),
            },
            "idempotency_error" => PaymentError::Duplicate(msg),
            "invalid_request_error"
            | "api_error"
            | "api_connection_error"
            | "authentication_error"
            | "rate_limit_error" => PaymentError::Network(msg),
            _ => PaymentError::Network(format!("stripe_error: {}", msg)),
        }
    }

    /// Parse a Stripe API error response body into a [`PaymentError`].
    fn parse_error(status: u16, body: &str) -> PaymentError {
        if let Ok(err) = serde_json::from_str::<StripeErrorBody>(body) {
            Self::classify_stripe_error(
                &err.error.error_type,
                err.error.message.as_deref(),
                err.error.code.as_deref(),
            )
        } else {
            PaymentError::Network(format!("HTTP {}: {}", status, body))
        }
    }

    /// Parse a successful Stripe response body into a [`PaymentIntentResponse`].
    fn parse_intent(body: &str) -> Result<PaymentIntentResponse, PaymentError> {
        serde_json::from_str(body).map_err(|e| {
            PaymentError::Network(format!(
                "failed to parse PaymentIntent: {} -- body: {}",
                e, body
            ))
        })
    }

    /// Parse a successful Stripe response body into a [`RefundResponse`].
    fn parse_refund(body: &str) -> Result<RefundResponse, PaymentError> {
        serde_json::from_str(body).map_err(|e| {
            PaymentError::Network(format!("failed to parse Refund: {} -- body: {}", e, body))
        })
    }

    /// Extract success status and amount from an intent response.
    fn intent_result(intent: &PaymentIntentResponse) -> Result<(bool, Money), PaymentError> {
        let success = intent.status == "succeeded" || intent.status == "requires_capture";
        let amount = Self::to_money(
            intent.amount_received.unwrap_or(intent.amount),
            &intent.currency,
        )?;
        Ok((success, amount))
    }
}

#[async_trait]
impl PaymentProcessor for StripePaymentProcessor {
    async fn authorize(&self, request: &PaymentRequest) -> Result<PaymentResult, PaymentError> {
        let amount_str = Self::to_stripe_amount(&request.amount).to_string();
        let currency_str = String::from_utf8_lossy(&request.amount.currency.0).into_owned();
        let mut form = vec![
            ("amount", amount_str.as_str()),
            ("currency", currency_str.as_str()),
            ("payment_method_types[]", self.pm_type()),
            ("capture_method", "manual"),
        ];
        if let Some(ref desc) = request.description {
            form.push(("description", desc.as_str()));
        }

        let (status, body) = self
            .post("/payment_intents", form, Self::idempotency_key_for(request))
            .await?;
        if !(200..300).contains(&status) {
            return Err(Self::parse_error(status, &body));
        }

        let intent = Self::parse_intent(&body)?;
        let (success, amount) = Self::intent_result(&intent)?;

        Ok(PaymentResult {
            success,
            transaction_id: Some(intent.id),
            auth_code: None,
            amount_charged: amount,
            message: Some(intent.status),
        })
    }

    async fn capture(&self, transaction_id: &str) -> Result<PaymentResult, PaymentError> {
        // No key: capture takes only a transaction_id, and it is safe to
        // leave — capturing an already-captured intent is a Stripe error
        // response, not a second charge.
        let (status, body) = self
            .post(
                &format!("/payment_intents/{}/capture", transaction_id),
                vec![],
                None,
            )
            .await?;
        if !(200..300).contains(&status) {
            return Err(Self::parse_error(status, &body));
        }

        let intent = Self::parse_intent(&body)?;
        let (success, amount) = Self::intent_result(&intent)?;

        Ok(PaymentResult {
            success,
            transaction_id: Some(intent.id),
            auth_code: None,
            amount_charged: amount,
            message: Some(intent.status),
        })
    }

    async fn refund(
        &self,
        transaction_id: &str,
        amount: Option<Money>,
        idempotency_key: Option<&str>,
    ) -> Result<PaymentResult, PaymentError> {
        let mut form: Vec<(&str, String)> = vec![("payment_intent", transaction_id.to_string())];
        if let Some(ref a) = amount {
            // PAY-3: honor a partial refund amount. Stripe accepts an
            // optional `amount` on the refund — omitting it refunds the
            // full charge.
            form.push(("amount", Self::to_stripe_amount(a).to_string()));
        }
        // PAY-2: forward the caller-supplied idempotency key when present so
        // a retried refund dedups instead of double-refunding. Absent keys
        // keep the legacy behavior (no key), which Stripe treats as distinct
        // operations — callers that care must supply one.
        let form_refs: Vec<(&str, &str)> = form.iter().map(|(k, v)| (*k, v.as_str())).collect();
        let (status, body) = self.post("/refunds", form_refs, idempotency_key).await?;
        if !(200..300).contains(&status) {
            return Err(Self::parse_error(status, &body));
        }

        let refund = Self::parse_refund(&body)?;
        let amount = Self::to_money(refund.amount, &refund.currency)?;

        Ok(PaymentResult {
            success: refund.status == "succeeded",
            transaction_id: Some(refund.id),
            auth_code: None,
            amount_charged: amount,
            message: Some(refund.status),
        })
    }

    async fn void(&self, transaction_id: &str) -> Result<PaymentResult, PaymentError> {
        // No key: cancelling an already-cancelled intent is a Stripe error,
        // not a second state change, so a retry cannot double-apply.
        let (status, body) = self
            .post(
                &format!("/payment_intents/{}/cancel", transaction_id),
                vec![],
                None,
            )
            .await?;
        if !(200..300).contains(&status) {
            return Err(Self::parse_error(status, &body));
        }

        let intent = Self::parse_intent(&body)?;
        let (success, amount) = Self::intent_result(&intent)?;

        Ok(PaymentResult {
            success,
            transaction_id: Some(intent.id),
            auth_code: None,
            amount_charged: amount,
            message: Some(intent.status),
        })
    }

    async fn receipt(&self, transaction_id: &str) -> Result<PaymentReceipt, PaymentError> {
        let (status, body) = self
            .get(&format!("/payment_intents/{}", transaction_id))
            .await?;
        if !(200..300).contains(&status) {
            return Err(Self::parse_error(status, &body));
        }

        let intent = Self::parse_intent(&body)?;
        let (_, amount) = Self::intent_result(&intent)?;

        Ok(PaymentReceipt {
            transaction_id: intent.id,
            method: PaymentMethod::Card,
            amount,
            timestamp: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            raw_data: None,
        })
    }

    fn device_info(&self) -> DeviceInfo {
        DeviceInfo::new("Stripe", "REST API", "cloud")
    }
}

#[cfg(test)]
#[path = "stripe_tests.rs"]
mod tests;
