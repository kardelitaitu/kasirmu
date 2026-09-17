/*
last audited 31-08-26 by TDD-Agent (round M; PAY-2 closed for charges, still open for refunds)
crate: oz-payment | status: SAFE | lint: CLEAN
findings: PAY-2 FIXED for authorize — idempotency_key_for() now honors PaymentRequest.idempotency_key verbatim and falls back to a fresh Uuid::now_v7() only when it is absent or blank. Blank must not be sent as-is: Some("") would put every caller who leaves the field empty into ONE shared idempotency key, and Square would then reject every charge after the first as a duplicate. Verbatim (no charset sanitizing, no length clamp) because a clamp maps two distinct caller keys onto one, and a collision here silently drops a legitimate charge — a loud API rejection is the better failure. authorize is the only CreatePaymentRequest site, and sale() delegates through it, so all charges are covered. PAY-2 CLOSED for refunds 09-09-26: refund() now accepts a caller-supplied idempotency_key (honoured when present; fresh Uuid fallback when absent). PAY-3 CLOSED 09-09-26: full refund (None) now resolves the original charge amount via GET /payments/{id} instead of sending zero-amount USD. COR-31 CLOSED 09-09-26: HTTP client bounded (10s connect / 30s total) — safe because charges carry keys and refunds accept a caller-supplied key. PAY-5 CLOSED 09-09-26: CreatePaymentRequest now sends autocomplete: false — authorize is a two-phase hold (APPROVED), not an immediate capture; the default sale() authorize→capture lifecycle now works against the real API. currency hard-error on unknown codes good (PA-02)
next: none | perf: N/A
*/
//! Square payment processor — implements [`PaymentProcessor`] using the
//! Square REST API directly via `reqwest`.
//!
//! # Configuration
//!
//! The processor is constructed with an API key and a location ID. In
//! production the key should be set in the OS key-ring (see
//! `oz_core::Keyring`); this driver provides a `new` constructor that
//! accepts an explicit key for that use case.

use async_trait::async_trait;
use std::fmt;
use std::time::Duration;

use foundation::{Currency, Money};
use kasirmu_hal::types::DeviceInfo;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE, HeaderMap, HeaderValue};
use serde::Serialize;
use uuid::Uuid;

use crate::PaymentProcessor;
use crate::error::PaymentError;
use crate::types::{PaymentMethod, PaymentReceipt, PaymentRequest, PaymentResult};

/// Default base URL for the Square API.
const SQUARE_API_BASE: &str = "https://connect.squareup.com/v2";

/// A [`PaymentProcessor`] implementation backed by the Square REST API.
///
/// Supports card-not-present payments via the Square Payments API.
///
/// # Example
///
/// ```no_run
/// # use kasirmu_payment::drivers::square::SquarePaymentProcessor;
/// # use kasirmu_payment::PaymentProcessor;
/// # async fn example() -> Result<(), Box<dyn std::error::Error>> {
/// # let request = unimplemented!();
/// let proc = SquarePaymentProcessor::new("api_key", "location_id");
/// proc.sale(&request).await?;
/// # Ok(())
/// # }
/// ```
pub struct SquarePaymentProcessor {
    #[allow(dead_code)]
    api_key: String,
    location_id: String,
    client: reqwest::Client,
    /// Base URL for the Square API (configurable for testing).
    api_base: String,
}

impl fmt::Debug for SquarePaymentProcessor {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SquarePaymentProcessor")
            .field("api_key", &"***")
            .field("location_id", &self.location_id)
            .field("client", &self.client)
            .field("api_base", &self.api_base)
            .finish()
    }
}

/// Request body for Square Create Payment.
#[derive(Serialize, Debug)]
struct CreatePaymentRequest {
    idempotency_key: String,
    amount_money: MoneyAmount,
    source_id: String,
    location_id: String,
    reference_id: Option<String>,
    note: Option<String>,
    /// PAY-5: `false` keeps authorize as a two-phase hold. Square defaults
    /// to `autocomplete: true` (authorize immediately captures), which
    /// would make the trait's authorize→capture model fail against the
    /// real API — capture on an already-completed payment errors. With
    /// `autocomplete: false` the payment returns APPROVED and capture's
    /// POST /payments/{id}/complete transitions it to COMPLETED.
    autocomplete: bool,
}

/// Request body for Square Refund.
#[derive(Serialize, Debug)]
struct CreateRefundRequest {
    idempotency_key: String,
    payment_id: String,
    amount_money: MoneyAmount,
}

/// Amount + currency used in Square API requests.
#[derive(Serialize, Debug)]
struct MoneyAmount {
    amount: i64,
    currency: String,
}

/// Minimal response fields we extract from the Square Payment JSON.
#[derive(serde::Deserialize, Debug, Clone)]
struct PaymentResponse {
    payment: PaymentData,
}

#[derive(serde::Deserialize, Debug, Clone)]
struct PaymentData {
    id: String,
    status: String,
    amount_money: MoneyAmountResponse,
    created_at: Option<String>,
}

/// Minimal refund response fields.
#[derive(serde::Deserialize, Debug, Clone)]
struct RefundResponse {
    refund: RefundData,
}

#[derive(serde::Deserialize, Debug, Clone)]
struct RefundData {
    id: String,
    status: String,
    amount_money: MoneyAmountResponse,
}

#[derive(serde::Deserialize, Debug, Clone)]
struct MoneyAmountResponse {
    amount: i64,
    currency: String,
}

/// Square API error response body.
#[derive(serde::Deserialize, Debug)]
struct SquareErrorBody {
    errors: Vec<SquareErrorDetail>,
}

#[derive(serde::Deserialize, Debug)]
struct SquareErrorDetail {
    #[allow(dead_code)]
    code: Option<String>,
    detail: Option<String>,
}

impl SquarePaymentProcessor {
    /// Create a new Square payment processor with the given API key and location ID.
    ///
    /// Requests are sent to the live Square API at `https://connect.squareup.com/v2`.
    pub fn new(api_key: &str, location_id: &str) -> Self {
        Self::new_with_endpoint(api_key, location_id, SQUARE_API_BASE)
    }

    /// Create a new Square payment processor with a custom API endpoint.
    ///
    /// This constructor is useful for integration tests where requests
    /// should be directed to a mock server (e.g. `wiremock`).
    pub fn new_with_endpoint(api_key: &str, location_id: &str, api_base: &str) -> Self {
        let mut headers = HeaderMap::new();
        let mut auth_value =
            HeaderValue::from_str(&format!("Bearer {}", api_key)).unwrap_or_else(|e| {
                tracing::error!(error = %e, "invalid Square auth header — using placeholder");
                HeaderValue::from_static("Bearer placeholder")
            });
        auth_value.set_sensitive(true);
        headers.insert(AUTHORIZATION, auth_value);
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

        let client = reqwest::Client::builder()
            .default_headers(headers)
            .no_proxy()
            // COR-31: bound the client — 10s connect / 30s total, same
            // budget as the other payment drivers. Timeout is now safe
            // because charges carry idempotency keys (PAY-2) and refunds
            // accept a caller-supplied key.
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .build()
            .unwrap_or_else(|e| {
                tracing::error!(
                    error = %e,
                    "failed to build HTTP client for Square — using default"
                );
                reqwest::Client::new()
            });

        Self {
            api_key: api_key.to_owned(),
            location_id: location_id.to_owned(),
            client,
            api_base: api_base.to_owned(),
        }
    }

    /// Convert a `Money` value to Square's amount-minor-units format.
    fn to_square_amount(amount: &Money) -> i64 {
        amount.minor_units
    }

    /// Convert a Square currency code (uppercase) to a [`foundation::Currency`].
    ///
    /// PA-02: unknown codes are a hard error, not a silent USD fallback —
    /// a malformed gateway currency would otherwise mislabel the recorded
    /// amount.
    fn to_currency(code: &str) -> Result<Currency, PaymentError> {
        code.parse::<Currency>()
            .map_err(|_| PaymentError::Network(format!("unknown gateway currency code: {code}")))
    }

    /// Convert Square amount + currency code to [`Money`].
    fn to_money(minor_units: i64, currency: &str) -> Result<Money, PaymentError> {
        Ok(Money {
            minor_units,
            currency: Self::to_currency(currency)?,
        })
    }

    /// Perform an HTTP POST to the Square API and return (status, body).
    async fn post<T: Serialize + ?Sized>(
        &self,
        path: &str,
        body: &T,
    ) -> Result<(u16, String), PaymentError> {
        let url = format!("{}{}", self.api_base, path);
        let resp = self
            .client
            .post(&url)
            .json(body)
            .send()
            .await
            .map_err(|e| PaymentError::Network(e.to_string()))?;

        let status = resp.status().as_u16();
        let body_text = resp
            .text()
            .await
            .map_err(|e| PaymentError::Network(e.to_string()))?;
        Ok((status, body_text))
    }

    /// Perform an HTTP GET to the Square API and return (status, body).
    async fn get(&self, path: &str) -> Result<(u16, String), PaymentError> {
        let url = format!("{}{}", self.api_base, path);
        let resp = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| PaymentError::Network(e.to_string()))?;

        let status = resp.status().as_u16();
        let body_text = resp
            .text()
            .await
            .map_err(|e| PaymentError::Network(e.to_string()))?;
        Ok((status, body_text))
    }

    /// Classify a Square error code into a specific PaymentError variant.
    fn classify_square_error(code: Option<&str>, detail: Option<&str>) -> PaymentError {
        let msg = detail.unwrap_or(code.unwrap_or("unknown")).to_string();
        match code {
            Some(c)
                if c == "CARD_DECLINED"
                    || c == "VERIFY_CVV_FAILURE"
                    || c == "VERIFY_AVS_FAILURE"
                    || c == "INVALID_EXPIRATION"
                    || c == "INVALID_CARD"
                    || c == "CARD_EXPIRED"
                    || c == "INVALID_PIN"
                    || c == "INVALID_ACCOUNT"
                    || c == "CARDHOLDER_VERIFICATION_REQUIRED" =>
            {
                PaymentError::Declined(msg)
            }
            Some(c)
                if c == "INVALID_LOCATION"
                    || c == "MISSING_REQUIRED_PARAMETER"
                    || c == "UNSUPPORTED_CARD_BRAND"
                    || c == "CARD_NOT_SUPPORTED"
                    || c == "UNSUPPORTED_ENTRY_METHOD" =>
            {
                PaymentError::InvalidCard(msg)
            }
            Some(c) if c == "DUPLICATE_CARD" || c == "IDEMPOTENCY_KEY_REUSED" => {
                PaymentError::Duplicate(msg)
            }
            Some(c) if c == "TIMEOUT" || c == "GATEWAY_TIMEOUT" => PaymentError::Timeout(30000),
            _ => PaymentError::Network(msg),
        }
    }

    /// Parse a Square API error response body into a [`PaymentError`].
    fn parse_error(status: u16, body: &str) -> PaymentError {
        if let Ok(err) = serde_json::from_str::<SquareErrorBody>(body) {
            let mut errors = err.errors;
            if errors.is_empty() {
                PaymentError::Network(format!("square_error: HTTP {}", status))
            } else {
                // Classify the most specific error from Square's error list
                let first = errors.remove(0);
                Self::classify_square_error(first.code.as_deref(), first.detail.as_deref())
            }
        } else {
            PaymentError::Network(format!("HTTP {}: {}", status, body))
        }
    }

    /// Parse a successful Square response body into a [`PaymentData`].
    fn parse_payment(body: &str) -> Result<PaymentData, PaymentError> {
        let resp: PaymentResponse = serde_json::from_str(body).map_err(|e| {
            PaymentError::Network(format!("failed to parse Payment: {} — body: {}", e, body))
        })?;
        Ok(resp.payment)
    }

    /// Parse a successful Square response body into a [`RefundData`].
    fn parse_refund(body: &str) -> Result<RefundData, PaymentError> {
        let resp: RefundResponse = serde_json::from_str(body).map_err(|e| {
            PaymentError::Network(format!("failed to parse Refund: {} — body: {}", e, body))
        })?;
        Ok(resp.refund)
    }

    /// Derive the Square `idempotency_key` for a charge request.
    ///
    /// PAY-2: honor [`PaymentRequest::idempotency_key`] so that a retried
    /// charge resolves to the same Square payment instead of being taken
    /// twice. This used to mint a fresh `Uuid::now_v7()` on every call, which
    /// meant Square's own duplicate protection could never fire — the caller
    /// had supplied a key and the driver threw it away.
    ///
    /// The value is passed through verbatim. Square's key is free-form, so
    /// there is no charset to sanitize into (unlike Midtrans), and clamping
    /// the length would map two distinct caller keys onto one — a collision
    /// on this path silently drops a legitimate charge as a "duplicate",
    /// which is worse than a loud API rejection.
    fn idempotency_key_for(request: &PaymentRequest) -> String {
        match request.idempotency_key.as_deref() {
            // Blank counts as absent, not as a key. `Some("")` sent verbatim
            // would park every caller who leaves the field empty in one
            // shared idempotency key, and Square would reject every charge
            // after the first as a duplicate.
            Some(key) if !key.trim().is_empty() => key.to_owned(),
            _ => Uuid::now_v7().to_string(),
        }
    }

    /// Extract success status and amount from payment data.
    fn payment_result(data: &PaymentData) -> Result<(bool, Money), PaymentError> {
        let success = data.status == "COMPLETED" || data.status == "APPROVED";
        let amount = Self::to_money(data.amount_money.amount, &data.amount_money.currency)?;
        Ok((success, amount))
    }
}

#[async_trait]
impl PaymentProcessor for SquarePaymentProcessor {
    async fn authorize(&self, request: &PaymentRequest) -> Result<PaymentResult, PaymentError> {
        let currency_str = String::from_utf8_lossy(&request.amount.currency.0).into_owned();
        let body = CreatePaymentRequest {
            idempotency_key: Self::idempotency_key_for(request),
            amount_money: MoneyAmount {
                amount: Self::to_square_amount(&request.amount),
                currency: currency_str,
            },
            source_id: "EXTERNAL".to_string(),
            location_id: self.location_id.clone(),
            reference_id: request.reference.clone(),
            note: request.description.clone(),
            // PAY-5: two-phase authorize — hold only, capture later.
            autocomplete: false,
        };

        let (status, body_text) = self.post("/payments", &body).await?;
        if !(200..300).contains(&status) {
            return Err(Self::parse_error(status, &body_text));
        }

        let payment = Self::parse_payment(&body_text)?;
        let (success, amount) = Self::payment_result(&payment)?;

        Ok(PaymentResult {
            success,
            transaction_id: Some(payment.id),
            auth_code: None,
            amount_charged: amount,
            message: Some(payment.status),
        })
    }

    async fn capture(&self, transaction_id: &str) -> Result<PaymentResult, PaymentError> {
        let path = format!("/payments/{}/complete", transaction_id);
        let (status, body_text) = self.post(&path, &serde_json::json!({})).await?;
        if !(200..300).contains(&status) {
            return Err(Self::parse_error(status, &body_text));
        }

        let payment = Self::parse_payment(&body_text)?;
        let (success, amount) = Self::payment_result(&payment)?;

        Ok(PaymentResult {
            success,
            transaction_id: Some(payment.id),
            auth_code: None,
            amount_charged: amount,
            message: Some(payment.status),
        })
    }

    async fn refund(
        &self,
        transaction_id: &str,
        amount: Option<Money>,
        idempotency_key: Option<&str>,
    ) -> Result<PaymentResult, PaymentError> {
        // PAY-3: Square's Refund API requires an amount_money, so a full
        // refund (None) must resolve the original charge amount from the
        // payment record instead of sending a zero-amount refund.
        let charged_amount = match amount {
            Some(a) => a,
            None => {
                let (status, body_text) =
                    self.get(&format!("/payments/{}", transaction_id)).await?;
                if !(200..300).contains(&status) {
                    return Err(Self::parse_error(status, &body_text));
                }
                let payment = Self::parse_payment(&body_text)?;
                Self::to_money(payment.amount_money.amount, &payment.amount_money.currency)?
            }
        };
        let currency_str = String::from_utf8_lossy(&charged_amount.currency.0).into_owned();
        // PAY-2: honor the caller-supplied idempotency key so a retried
        // refund resolves to the same Square refund instead of refunding
        // twice. Fresh UUID fallback for legacy callers (no dedup).
        let key = match idempotency_key {
            Some(k) if !k.trim().is_empty() => k.to_owned(),
            _ => Uuid::now_v7().to_string(),
        };
        let body = CreateRefundRequest {
            idempotency_key: key,
            payment_id: transaction_id.to_string(),
            amount_money: MoneyAmount {
                amount: Self::to_square_amount(&charged_amount),
                currency: currency_str,
            },
        };

        let (status, body_text) = self.post("/refunds", &body).await?;
        if !(200..300).contains(&status) {
            return Err(Self::parse_error(status, &body_text));
        }

        let refund = Self::parse_refund(&body_text)?;
        let refund_amount =
            Self::to_money(refund.amount_money.amount, &refund.amount_money.currency)?;

        Ok(PaymentResult {
            success: refund.status == "COMPLETED"
                || refund.status == "APPROVED"
                || refund.status == "PENDING",
            transaction_id: Some(refund.id),
            auth_code: None,
            amount_charged: refund_amount,
            message: Some(refund.status),
        })
    }

    async fn void(&self, transaction_id: &str) -> Result<PaymentResult, PaymentError> {
        let path = format!("/payments/{}/cancel", transaction_id);
        let (status, body_text) = self.post(&path, &serde_json::json!({})).await?;
        if !(200..300).contains(&status) {
            return Err(Self::parse_error(status, &body_text));
        }

        let payment = Self::parse_payment(&body_text)?;
        let (success, amount) = Self::payment_result(&payment)?;

        Ok(PaymentResult {
            success,
            transaction_id: Some(payment.id),
            auth_code: None,
            amount_charged: amount,
            message: Some(payment.status),
        })
    }

    async fn receipt(&self, transaction_id: &str) -> Result<PaymentReceipt, PaymentError> {
        let path = format!("/payments/{}", transaction_id);
        let (status, body_text) = self.get(&path).await?;
        if !(200..300).contains(&status) {
            return Err(Self::parse_error(status, &body_text));
        }

        let payment = Self::parse_payment(&body_text)?;
        let (_, amount) = Self::payment_result(&payment)?;

        Ok(PaymentReceipt {
            transaction_id: payment.id,
            method: PaymentMethod::Card,
            amount,
            timestamp: payment.created_at.unwrap_or_else(|| {
                chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
            }),
            raw_data: None,
        })
    }

    fn device_info(&self) -> DeviceInfo {
        DeviceInfo::new("Square", "Square API", "cloud")
    }
}

#[cfg(test)]
#[path = "square_tests.rs"]
mod tests;
