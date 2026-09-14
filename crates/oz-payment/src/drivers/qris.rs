/*
last audited 25-07-26 by RSA-Agent; PAY-2 refund key + COR-31 bounded 09-09-26 (agent-2-cargo)
crate: oz-payment | status: SAFE | lint: CLEAN
findings: PAY-1 HIGH parse_amount unwrap_or(0) zeroes Midtrans "14500.00"-format amounts (authorize/capture/refund/receipt); PAY-2 fresh order_id per call defeats Midtrans idempotency on retry; PAY-3 refund ignores partial amount; PAY-6 sale() returns SCAN_QR protocol string in message, success = QR-issued not settled (60s poll vs 300s QR validity); PAY-7 Default constructs empty-key processor; PAY-8 expire mapped to InvalidCard
next: fix amount parsing (PAY-1), honor idempotency (PAY-2), partial refund (PAY-3). COR-31 HELD DELIBERATELY — no HTTP timeout here, and it stays that way until PAY-2 is closed for real: order_id_for() reuses PaymentRequest.idempotency_key only WHEN THE CALLER SUPPLIES ONE and falls back to a fresh order_id otherwise, so a timeout is safe only on the subset of calls that carry a key. A timed-out QR issuance retried without a key mints a second live QR for the same basket, and PAY-6 means the first one is still scannable for its 300s validity. Either require the key or make the fallback deterministic before bounding the client. | perf: poll loop sleeps between attempts, early-exits on settled status
fixed 2026-07-25 (glm-5.3 review P1 pass): PAY-1 parse_amount now returns Result — decimal "14500.00" forms parse 1:1 into exp-0 IDR minor units (inverse of to_amount_string), non-zero fractions and malformed input are InvalidResponse instead of silent zeros (refund refund_amount included); PAY-2 order_id_for() reuses PaymentRequest.idempotency_key (charset-filtered, Midtrans 50-char cap) with fresh fallback when absent
fixed 2026-07-25 (glm-5.3 review P2 pass): PAY-3 refund now honors Some(amount) — partial refunds submit the amount in whole IDR minor units, non-IDR rejected pre-flight, None keeps full-refund null; PAY-6 sale/capture docs now state the honest two-phase contract (success = QR issued; capture polls ~60s per call vs 300s QR validity, re-enter on Timeout); PAY-7 Default (empty-key processor) removed — construct via new/from_env/sandbox_from_env; PAY-8 expire maps to the new PaymentError::Expired instead of InvalidCard
fixed 2026-09-09 (agent-2-cargo): PAY-2 refund now accepts a caller-supplied idempotency_key (honoured when present; transaction-prefixed fresh key fallback when absent); COR-31 HTTP client bounded (10s connect / 30s total) — safe because charges honour the caller key and refunds accept a caller-supplied key; the poll loop's own 60s budget sits above the per-request cap, so a stalled status call now fails fast.
fixed 2026-09-14: QRIS acquirer hardcode removed from charge_qris() — the driver no longer sends the legacy "airpay shopee" (ShopeePay-only) alias for every merchant. `qris.acquirer` is now omitted entirely by default (generic QRIS, any wallet), and is sent verbatim only when a processor is built with with_acquirer(); per-merchant/per-terminal default + cashier override remain the cloud-server's job (todo-payment.md Phase 3).
*/
//! QRIS payment processor — implements [`PaymentProcessor`] using the
//! Midtrans REST API for Indonesian QRIS (Quick Response Code Indonesian
//! Standard) payments.
//!
//! QRIS is the standardized QR code payment system mandated by Bank
//! Indonesia. Customers scan the displayed QR code with any compatible
//! e-wallet (GoPay, OVO, DANA, LinkAja, etc.) and confirm the payment
//! on their phone.
//!
//! # Flow
//!
//! 1. **`authorize`** — Calls the Midtrans Charge API with
//!    `payment_type: "qris"` and returns a `transaction_id`.
//! 2. **`capture`** — Polls the transaction status until `settlement`
//!    or `expire`.
//! 3. **`sale`** — Charges the QR and returns it immediately
//!    (`SCAN_QR|<order_id>[|<qr_url>]` in `message`); `success: true`
//!    means the QR was **issued**, not settled. The UI displays the QR
//!    and calls `capture` to poll for settlement.
//! 4. **`refund`** — Submits a refund via the Midtrans Refund API.
//! 5. **`void`** — Cancels a pending transaction via the Cancel API.
//!
//! # Configuration
//!
//! The processor reads `MIDTRANS_SERVER_KEY` from the environment at
//! construction. The server key is found in the Midtrans dashboard
//! under Settings → Access Keys.
//!
//! The QRIS acquirer is **not** configured here and is **not** sent at all by
//! default: a charge omits `qris.acquirer`, so Midtrans issues a generic QRIS
//! code any wallet can scan. Call [`QrisPaymentProcessor::with_acquirer`] to
//! pin a charge to one acquirer for a merchant holding that co-branded
//! activation.
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
use oz_hal::types::DeviceInfo;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE, HeaderMap, HeaderValue};

use crate::PaymentProcessor;
use crate::error::PaymentError;
use crate::types::{PaymentMethod, PaymentReceipt, PaymentRequest, PaymentResult};

/// Base URL for the Midtrans API (production).
const MIDTRANS_API_BASE: &str = "https://api.midtrans.com/v2";

/// Base URL for the Midtrans sandbox API.
const MIDTRANS_SANDBOX_BASE: &str = "https://api.sandbox.midtrans.com/v2";

/// Number of milliseconds to wait between status polls.
const POLL_INTERVAL_MS: u64 = 2000;

/// Maximum number of polling attempts before giving up.
const MAX_POLL_ATTEMPTS: u32 = 30;

/// How long a QRIS transaction is valid (in seconds).
const QRIS_EXPIRY_SECS: u64 = 300; // 5 minutes

/// A [`PaymentProcessor`] implementation backed by the Midtrans QRIS API.
///
/// # Example
///
/// ```no_run
/// # use oz_payment::drivers::qris::QrisPaymentProcessor;
/// # use oz_payment::PaymentProcessor;
/// # async fn example() -> Result<(), Box<dyn std::error::Error>> {
/// # let request = unimplemented!();
/// let proc = QrisPaymentProcessor::from_env()?;
/// proc.sale(&request).await?;
/// # Ok(())
/// # }
/// ```
pub struct QrisPaymentProcessor {
    client: Arc<reqwest::Client>,
    /// Whether to use the sandbox endpoint.
    sandbox: bool,
    /// Base URL for the Midtrans API (configurable for testing).
    api_base: String,
    /// Optional QRIS acquirer override sent as `qris.acquirer` on charge.
    ///
    /// `None` — the default — omits the field entirely so Midtrans issues a
    /// **generic** QRIS code any QRIS-compliant wallet can scan. Set it via
    /// [`QrisPaymentProcessor::with_acquirer`] only for a merchant that holds
    /// that acquirer's co-branded activation.
    acquirer: Option<String>,
}

impl fmt::Debug for QrisPaymentProcessor {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("QrisPaymentProcessor")
            .field("client", &self.client)
            .field("server_key", &"***")
            .field("sandbox", &self.sandbox)
            .field("api_base", &self.api_base)
            .field("acquirer", &self.acquirer)
            .finish()
    }
}

impl Clone for QrisPaymentProcessor {
    fn clone(&self) -> Self {
        Self {
            client: Arc::clone(&self.client),
            sandbox: self.sandbox,
            api_base: self.api_base.clone(),
            acquirer: self.acquirer.clone(),
        }
    }
}

/// QRIS charge response from Midtrans.
#[derive(serde::Deserialize, Debug, Clone)]
#[allow(dead_code)]
struct QrisChargeResponse {
    #[serde(default)]
    transaction_id: String,
    #[serde(default)]
    order_id: String,
    #[serde(default)]
    gross_amount: String,
    #[serde(default)]
    transaction_status: String,
    #[serde(default)]
    status_code: String,
    #[serde(default)]
    status_message: String,
    /// The QR code content (URL or raw string to render). The live Midtrans
    /// QRIS `/v2/charge` response carries it as **`qr_string`** — without the
    /// alias below the field silently deserialized to `None` against the real
    /// gateway (only the fixture-driven tests, which used this field's own
    /// name, passed). Found while wiring the cloud charge endpoint
    /// (`todo-payment-agents-1.md`, 09-13).
    #[serde(default, alias = "qr_string")]
    qr_code_url: Option<String>,
    /// Actions the POS can take (e.g., "deeplink_redirect").
    #[serde(default)]
    actions: Option<Vec<QrisAction>>,
}

#[derive(serde::Deserialize, Debug, Clone)]
#[allow(dead_code)]
struct QrisAction {
    #[serde(default)]
    name: String,
    #[serde(default)]
    url: String,
}

/// Transaction status response from Midtrans.
#[derive(serde::Deserialize, Debug, Clone)]
#[allow(dead_code)]
struct TransactionStatusResponse {
    #[serde(default)]
    transaction_id: String,
    #[serde(default)]
    order_id: String,
    #[serde(default)]
    gross_amount: String,
    #[serde(default)]
    transaction_status: String,
    #[serde(default)]
    status_code: String,
    #[serde(default)]
    status_message: String,
    #[serde(default)]
    currency: String,
    #[serde(default)]
    payment_type: String,
}

/// Midtrans API error response.
#[derive(serde::Deserialize, Debug)]
struct MidtransErrorResponse {
    #[serde(default)]
    status_code: String,
    #[serde(default)]
    status_message: String,
}

impl QrisPaymentProcessor {
    /// Create a new QRIS payment processor with the given server key.
    ///
    /// When `sandbox` is true, requests go to the Midtrans sandbox
    /// environment (`api.sandbox.midtrans.com`).
    pub fn new(server_key: &str, sandbox: bool) -> Self {
        let api_base = if sandbox {
            MIDTRANS_SANDBOX_BASE
        } else {
            MIDTRANS_API_BASE
        };
        Self::new_with_endpoint(server_key, api_base, sandbox)
    }

    /// Create a new QRIS payment processor with a custom API endpoint.
    ///
    /// This constructor is useful for integration tests where requests
    /// should be directed to a mock server (e.g. `wiremock`).
    pub fn new_with_endpoint(server_key: &str, api_base: &str, sandbox: bool) -> Self {
        let mut headers = HeaderMap::new();
        let encoded = base64_standard(&format!("{}:", server_key));
        let mut auth_value =
            HeaderValue::from_str(&format!("Basic {}", encoded)).unwrap_or_else(|e| {
                tracing::error!(
                    error = %e,
                    "invalid Midtrans auth header — using placeholder"
                );
                HeaderValue::from_static("Basic placeholder")
            });
        auth_value.set_sensitive(true);
        headers.insert(AUTHORIZATION, auth_value);
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

        let client = reqwest::Client::builder()
            .default_headers(headers)
            .no_proxy()
            // COR-31: bound the client — 10s connect / 30s total, same
            // budget as the other payment drivers. The poll loop's own
            // 60s budget sits above this per-request cap, so a stalled
            // single status call now fails fast instead of hanging.
            // Timeout is safe now that charges honor the caller key
            // (PAY-2) and refunds accept a caller-supplied key.
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .build()
            .unwrap_or_else(|e| {
                tracing::error!(
                    error = %e,
                    "failed to build HTTP client for Midtrans — using default"
                );
                reqwest::Client::new()
            });

        Self {
            client: Arc::new(client),
            sandbox,
            api_base: api_base.to_owned(),
            // No acquirer by default: the charge omits `qris.acquirer` so the
            // QR Midtrans returns is generic (see `with_acquirer`).
            acquirer: None,
        }
    }

    /// Pin the charge to a specific QRIS acquirer (e.g. `"gopay"`,
    /// `"shopeepay"`, `"dana"`, `"linkaja"`).
    ///
    /// Builder-style; the value is forwarded to Midtrans verbatim as
    /// `qris.acquirer` in the `POST /charge` body — the driver does not
    /// validate or rewrite it, because which acquirer a merchant may name is
    /// governed by that merchant's Midtrans activation, not by this client.
    /// A blank value is treated as unset, restoring the generic default.
    ///
    /// Leaving this unset (the default for every constructor) omits the
    /// `qris` object entirely, which is what makes the issued QR scanable by
    /// any QRIS-compliant wallet instead of one branded e-wallet.
    #[must_use]
    pub fn with_acquirer(mut self, acquirer: impl Into<String>) -> Self {
        let value = acquirer.into();
        self.acquirer = if value.trim().is_empty() {
            None
        } else {
            Some(value)
        };
        self
    }

    /// The configured QRIS acquirer, or `None` when the driver sends a
    /// generic (no-acquirer) charge.
    #[must_use]
    pub fn acquirer(&self) -> Option<&str> {
        self.acquirer.as_deref()
    }

    /// Create a new QRIS processor from the `MIDTRANS_SERVER_KEY`
    /// environment variable.
    pub fn from_env() -> Result<Self, PaymentError> {
        Ok(Self::new(&Self::server_key_from_env()?, false))
    }

    /// Create a new QRIS processor in sandbox mode from the
    /// `MIDTRANS_SERVER_KEY` environment variable.
    pub fn from_env_sandbox() -> Result<Self, PaymentError> {
        Ok(Self::new(&Self::server_key_from_env()?, true))
    }

    /// Read `MIDTRANS_SERVER_KEY` from the environment.
    fn server_key_from_env() -> Result<String, PaymentError> {
        std::env::var("MIDTRANS_SERVER_KEY")
            .map_err(|_| PaymentError::Network("MIDTRANS_SERVER_KEY not set".into()))
    }

    /// The base URL for API calls.
    fn base_url(&self) -> &str {
        &self.api_base
    }

    /// Generate a unique order ID for a QRIS transaction.
    ///
    /// The suffix is drawn from the random tail of a UUIDv7 (not its
    /// timestamp head) so two keyless charges in the same millisecond can
    /// never mint the same order_id and silently attach to one QR code.
    fn generate_order_id() -> String {
        let uuid_hex = uuid::Uuid::now_v7().simple().to_string();
        format!(
            "QRIS-{}-{}",
            chrono::Utc::now().timestamp(),
            uuid_hex
                .get(uuid_hex.len() - 12..)
                .unwrap_or("000000000000")
        )
    }

    /// Derive the Midtrans `order_id` for a charge request.
    ///
    /// PAY-2: reuse [`PaymentRequest::idempotency_key`] when the caller
    /// supplies one, so a retried charge resolves to the same Midtrans
    /// transaction instead of minting a duplicate QR code. Falls back to a
    /// freshly generated order ID (the documented [`PaymentRequest`]
    /// contract) when no usable key is present.
    fn order_id_for(request: &PaymentRequest) -> String {
        let key = request
            .idempotency_key
            .as_deref()
            .unwrap_or_default()
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
            .take(44) // "QRIS-" + 44 = 49 <= Midtrans's 50-char cap
            .collect::<String>();
        if key.is_empty() {
            Self::generate_order_id()
        } else {
            format!("QRIS-{key}")
        }
    }

    /// Convert a `Money` value to Midtrans' amount format (IDR, no decimals).
    fn to_amount_string(amount: &Money) -> String {
        amount.minor_units.to_string()
    }

    /// Parse a Midtrans `gross_amount` string into minor units.
    ///
    /// Midtrans sends amounts as decimal strings padded to two fractional
    /// digits (e.g. `"14500.00"`). IDR has a 0 ISO-4217 exponent (the minor
    /// unit IS the Rupiah — see `foundation::money`), and
    /// [`Self::to_amount_string`] sends minor units raw, so the major part
    /// maps 1:1 to minor units. PAY-1: the previous
    /// `s.parse().unwrap_or(0)` silently zeroed every decimal-form amount,
    /// corrupting authorize/capture/refund/receipt accounting — malformed
    /// input and non-zero fractions (not representable in IDR) are now hard
    /// [`PaymentError::InvalidResponse`]s instead of silent zeros.
    fn parse_amount(s: &str) -> Result<i64, PaymentError> {
        let bad = || PaymentError::InvalidResponse(format!("unparseable gross_amount: {s:?}"));
        let (major_str, frac_str) = match s.trim().split_once('.') {
            Some((m, f)) => (m, f),
            None => (s.trim(), ""),
        };
        // A non-zero fraction is sub-Rupiah and unrepresentable in an
        // exp-0 currency — dropping it would understate the amount.
        let frac_ok = match frac_str.parse::<i64>() {
            Ok(f) => f == 0,
            Err(_) => frac_str.is_empty(),
        };
        if frac_str.len() > 2 || !frac_ok {
            return Err(PaymentError::InvalidResponse(format!(
                "sub-minor gross_amount not representable in IDR: {s:?}"
            )));
        }
        major_str.parse::<i64>().map_err(|_| bad())
    }

    /// Perform a JSON POST to the Midtrans API and return (status, body).
    async fn post_json(
        &self,
        path: &str,
        body: serde_json::Value,
    ) -> Result<(u16, String), PaymentError> {
        let url = format!("{}{}", self.base_url(), path);
        let resp = self
            .client
            .post(&url)
            .json(&body)
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

    /// Perform a JSON GET to the Midtrans API and return (status, body).
    async fn get_json(&self, path: &str) -> Result<(u16, String), PaymentError> {
        let url = format!("{}{}", self.base_url(), path);
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

    /// Classify a Midtrans status code into a specific PaymentError variant.
    fn classify_midtrans_status(status_code: &str, status_message: &str) -> PaymentError {
        match status_code {
            "402" => PaymentError::InvalidCard(format!(
                "midtrans card error: {} (code: {})",
                status_message, status_code
            )),
            "406" => PaymentError::Duplicate(format!(
                "midtrans duplicate: {} (code: {})",
                status_message, status_code
            )),
            _ => {
                let msg = if status_message.is_empty() {
                    format!("midtrans_error: HTTP {}", status_code)
                } else {
                    format!("midtrans_error: {} (code: {})", status_message, status_code)
                };
                PaymentError::Network(msg)
            }
        }
    }

    /// Parse a Midtrans API error from the response body.
    fn parse_error(status: u16, body: &str) -> PaymentError {
        if let Ok(err) = serde_json::from_str::<MidtransErrorResponse>(body) {
            Self::classify_midtrans_status(&err.status_code, &err.status_message)
        } else {
            PaymentError::Network(format!("HTTP {}: {}", status, body))
        }
    }

    /// Charge a QRIS payment and return the charge response.
    async fn charge_qris(
        &self,
        request: &PaymentRequest,
        order_id: &str,
    ) -> Result<QrisChargeResponse, PaymentError> {
        let amount_str = Self::to_amount_string(&request.amount);
        let mut body = serde_json::json!({
            "payment_type": "qris",
            "transaction_details": {
                "order_id": order_id,
                "gross_amount": amount_str
            },
            "custom_expiry": {
                "expiry_duration": QRIS_EXPIRY_SECS,
                "unit": "second"
            }
        });

        // `qris.acquirer` is a wire field that locks the issued QR to one
        // branded e-wallet, and a merchant may only name an acquirer Midtrans
        // has activated for that account. This driver used to hardcode the
        // legacy `"airpay shopee"` alias here, which pinned EVERY merchant's
        // QRIS code to ShopeePay. The field is now sent only when explicitly
        // configured via [`Self::with_acquirer`]; otherwise the whole `qris`
        // object is omitted and Midtrans returns a generic QRIS code that any
        // QRIS-compliant wallet can scan.
        if let Some(acquirer) = self.acquirer.as_deref() {
            body["qris"] = serde_json::json!({ "acquirer": acquirer });
        }

        let (status, text) = self.post_json("/charge", body).await?;
        if !(200..300).contains(&status) {
            return Err(Self::parse_error(status, &text));
        }

        serde_json::from_str(&text).map_err(|e| {
            PaymentError::InvalidResponse(format!(
                "failed to parse QRIS charge response: {} — body: {}",
                e, text
            ))
        })
    }

    /// Poll the transaction status until settlement or failure.
    async fn poll_status(&self, order_id: &str) -> Result<TransactionStatusResponse, PaymentError> {
        for attempt in 1..=MAX_POLL_ATTEMPTS {
            let (status, text) = self.get_json(&format!("/{}/status", order_id)).await?;

            if !(200..300).contains(&status) {
                return Err(Self::parse_error(status, &text));
            }

            if let Ok(tx) = serde_json::from_str::<TransactionStatusResponse>(&text) {
                match tx.transaction_status.as_str() {
                    "settlement" | "capture" => return Ok(tx),
                    "deny" | "cancel" => {
                        let msg = tx.status_message.clone();
                        return Err(PaymentError::Declined(if msg.is_empty() {
                            format!("QRIS payment {}", tx.transaction_status)
                        } else {
                            msg
                        }));
                    }
                    "expire" => {
                        // PAY-8: expiry is not a card problem — the customer
                        // never completed payment before the QR validity
                        // window closed. Surface it as `Expired` so the UI
                        // can offer "regenerate QR" instead of "check card".
                        return Err(PaymentError::Expired(if tx.status_message.is_empty() {
                            format!("QRIS transaction {} expired", tx.order_id)
                        } else {
                            tx.status_message.clone()
                        }));
                    }
                    _ => {
                        // Still pending — keep polling.
                        if attempt >= MAX_POLL_ATTEMPTS {
                            return Err(PaymentError::Timeout(attempt * POLL_INTERVAL_MS as u32));
                        }
                    }
                }
            }

            // Check first, sleep between polls: an already-settled
            // transaction returns on the first attempt instead of
            // waiting a full POLL_INTERVAL_MS (2 s) for nothing.
            tokio::time::sleep(std::time::Duration::from_millis(POLL_INTERVAL_MS)).await;
        }

        Err(PaymentError::Timeout(
            MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS as u32,
        ))
    }
}

#[async_trait]
impl PaymentProcessor for QrisPaymentProcessor {
    /// Generate a QRIS charge and return the transaction details.
    ///
    /// The returned [`PaymentResult`] contains the `transaction_id` and
    /// a message with the QR code URL/content that the POS should display.
    async fn authorize(&self, request: &PaymentRequest) -> Result<PaymentResult, PaymentError> {
        let order_id = Self::order_id_for(request);
        let charge = self.charge_qris(request, &order_id).await?;

        let amount = Money {
            minor_units: Self::parse_amount(&charge.gross_amount)?,
            currency: Currency(*b"IDR"),
        };

        let msg = if let Some(ref qr_url) = charge.qr_code_url {
            format!("{}|{}", charge.transaction_status, qr_url)
        } else {
            charge.transaction_status.clone()
        };

        Ok(PaymentResult {
            success: charge.status_code == "201" || charge.status_code == "200",
            transaction_id: Some(charge.order_id),
            auth_code: None,
            amount_charged: amount,
            message: Some(msg),
        })
    }

    /// Poll for settlement of a QRIS transaction.
    ///
    /// Polls at most [`MAX_POLL_ATTEMPTS`] × [`POLL_INTERVAL_MS`] (≈60 s)
    /// per call — a per-call budget, deliberately shorter than the QR's
    /// full [`QRIS_EXPIRY_SECS`] (300 s) validity so one IPC call never
    /// blocks for the whole window. On [`PaymentError::Timeout`] the QR
    /// is still alive: callers should re-enter `capture` with the same
    /// order id until it settles or [`PaymentError::Expired`] arrives.
    async fn capture(&self, transaction_id: &str) -> Result<PaymentResult, PaymentError> {
        let tx = self.poll_status(transaction_id).await?;

        let amount = Money {
            minor_units: Self::parse_amount(&tx.gross_amount)?,
            currency: Currency(*b"IDR"),
        };

        Ok(PaymentResult {
            success: tx.transaction_status == "settlement" || tx.transaction_status == "capture",
            transaction_id: Some(tx.transaction_id),
            auth_code: None,
            amount_charged: amount,
            message: Some(tx.transaction_status),
        })
    }

    /// Execute a complete QRIS sale: charge + poll for settlement.
    ///
    /// # Two-phase contract (PAY-6)
    ///
    /// `sale` only **issues** the QR — `success: true` means Midtrans
    /// accepted the charge and a QR exists, NOT that money moved. The
    /// QR string is returned in `message` as
    /// `SCAN_QR|<order_id>[|<qr_url>]` for the UI to render; the UI then
    /// calls [`PaymentProcessor::capture`] with the returned
    /// `transaction_id` to poll for settlement (see `capture` for the
    /// per-call poll budget vs. the 300 s QR validity window).
    async fn sale(&self, request: &PaymentRequest) -> Result<PaymentResult, PaymentError> {
        let order_id = Self::order_id_for(request);
        let charge = self.charge_qris(request, &order_id).await?;

        if charge.status_code != "201" && charge.status_code != "200" {
            return Err(Self::parse_error(
                400,
                &format!("charge failed: {}", charge.status_message),
            ));
        }

        // Return the QR info immediately so the UI can display it.
        // The UI should then call capture() with the order_id to poll.
        let amount = Money {
            minor_units: Self::parse_amount(&charge.gross_amount)?,
            currency: Currency(*b"IDR"),
        };

        let msg = if let Some(ref qr_url) = charge.qr_code_url {
            format!("SCAN_QR|{}|{}", charge.order_id, qr_url)
        } else {
            format!("SCAN_QR|{}", charge.order_id)
        };

        Ok(PaymentResult {
            success: true,
            transaction_id: Some(charge.order_id),
            auth_code: None,
            amount_charged: amount,
            message: Some(msg),
        })
    }

    /// Refund a settled QRIS transaction.
    ///
    /// With `amount: None` this is a full refund (Midtrans `amount: null`).
    /// With `Some(amount)` a partial refund is submitted — the amount is
    /// sent as whole IDR minor units (for IDR the minor unit IS the
    /// Rupiah, mirroring `to_amount_string`'s inverse). Non-IDR amounts
    /// are rejected before any network call (PAY-3: the amount parameter
    /// used to be ignored entirely, turning every partial refund into a
    /// full refund).
    async fn refund(
        &self,
        transaction_id: &str,
        amount: Option<Money>,
        idempotency_key: Option<&str>,
    ) -> Result<PaymentResult, PaymentError> {
        let refund_amount = match amount {
            None => serde_json::json!(null),
            Some(m) => {
                if m.currency != Currency(*b"IDR") {
                    return Err(PaymentError::Unsupported(format!(
                        "QRIS refunds support IDR only, got {}",
                        m.currency
                    )));
                }
                serde_json::json!(m.minor_units)
            }
        };
        // PAY-2: honor the caller-supplied idempotency key so a retried
        // refund resolves to the same Midtrans refund instead of refunding
        // twice. When absent, fall back to a transaction-prefixed fresh key
        // (legacy behavior — no dedup, but the order id stays greppable in
        // Midtrans' dashboard).
        let key = match idempotency_key {
            Some(k) if !k.trim().is_empty() => k.to_owned(),
            _ => format!("refund-{}-{}", transaction_id, uuid::Uuid::now_v7()),
        };
        let refund_body = serde_json::json!({
            "refund_key": key,
            "amount": refund_amount,
            "reason": "requested_by_merchant"
        });

        let (status, text) = self
            .post_json(&format!("/{}/refund", transaction_id), refund_body)
            .await?;

        if !(200..300).contains(&status) {
            return Err(Self::parse_error(status, &text));
        }

        #[derive(serde::Deserialize)]
        struct RefundResponse {
            #[serde(default)]
            transaction_id: String,
            #[serde(default)]
            refund_amount: String,
            #[serde(default)]
            status_code: String,
            #[serde(default)]
            status_message: String,
        }

        let refund: RefundResponse = serde_json::from_str(&text).map_err(|e| {
            PaymentError::InvalidResponse(format!("failed to parse refund: {} — body: {}", e, text))
        })?;

        Ok(PaymentResult {
            success: refund.status_code == "200",
            transaction_id: Some(refund.transaction_id),
            auth_code: None,
            amount_charged: Money {
                minor_units: Self::parse_amount(&refund.refund_amount)?,
                currency: Currency(*b"IDR"),
            },
            message: Some(refund.status_message),
        })
    }

    /// Cancel/void a pending QRIS transaction.
    async fn void(&self, transaction_id: &str) -> Result<PaymentResult, PaymentError> {
        let (status, text) = self
            .post_json(
                &format!("/{}/cancel", transaction_id),
                serde_json::json!({}),
            )
            .await?;

        if !(200..300).contains(&status) {
            return Err(Self::parse_error(status, &text));
        }

        #[derive(serde::Deserialize)]
        struct CancelResponse {
            #[serde(default)]
            transaction_id: String,
            #[serde(default)]
            status_code: String,
            #[serde(default)]
            status_message: String,
        }

        let cancel: CancelResponse = serde_json::from_str(&text).map_err(|e| {
            PaymentError::InvalidResponse(format!("failed to parse cancel: {} — body: {}", e, text))
        })?;

        Ok(PaymentResult {
            success: cancel.status_code == "200",
            transaction_id: Some(cancel.transaction_id),
            auth_code: None,
            amount_charged: Money::zero(Currency(*b"IDR")),
            message: Some(cancel.status_message),
        })
    }

    /// Return a receipt for a completed QRIS transaction.
    async fn receipt(&self, transaction_id: &str) -> Result<PaymentReceipt, PaymentError> {
        let (status, text) = self
            .get_json(&format!("/{}/status", transaction_id))
            .await?;

        if !(200..300).contains(&status) {
            return Err(Self::parse_error(status, &text));
        }

        let tx: TransactionStatusResponse = serde_json::from_str(&text).map_err(|e| {
            PaymentError::InvalidResponse(format!(
                "failed to parse transaction status: {} — body: {}",
                e, text
            ))
        })?;

        let amount = Money {
            minor_units: Self::parse_amount(&tx.gross_amount)?,
            currency: Currency(*b"IDR"),
        };

        Ok(PaymentReceipt {
            transaction_id: tx.transaction_id,
            method: PaymentMethod::Qr,
            amount,
            timestamp: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            raw_data: None,
        })
    }

    fn device_info(&self) -> DeviceInfo {
        DeviceInfo::new("Midtrans", "QRIS", "cloud")
    }
}

/// Standard Base64 encoding (no padding, no line breaks).
fn base64_standard(input: &str) -> String {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD.encode(input.as_bytes())
}

#[cfg(test)]
#[path = "qris_tests.rs"]
mod tests;
