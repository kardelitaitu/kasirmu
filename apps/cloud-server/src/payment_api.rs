/*
last audited 13-09-26 by DSH (agents-1: fresh module, written audited)
crate: cloud-server | status: SAFE | lint: CLEAN
findings: clean — all SQL bound-params via midtrans_ledger; tenant_id only ever from JWT claims (never body, fail-closed 401); server key flows through the processor's Debug-masked field and is never logged; charge-response parsing has no unwrap
next: none | perf: N/A
*/
//! Midtrans QRIS charge endpoint (todo-payment-agents-1, Phase 1.1).
//!
//! `POST /api/payment/midtrans/qris` — JWT-authenticated (same
//! `auth_middleware` + per-tenant rate-limit stack as `sync_api`), raises a
//! QR through the EXISTING `oz-payment` Midtrans driver (do not fork it: the
//! repair stamp records why), and records the issuance in
//! [`crate::midtrans_ledger`] so the settlement webhook can resolve the sale
//! even before the device syncs.
//!
//! Two-phase contract kept honest end to end (PAY-6): a `200` here means the
//! QR was ISSUED, not paid. `status: "qr_issued"` says so in the body; the
//! QR validity window is Midtrans-side (300 s), settlement arrives via
//! `POST /api/webhooks/midtrans`.

use std::sync::Arc;

use axum::{
    Router,
    extract::{Extension, Path, State},
    http::StatusCode,
    middleware,
    routing::{get, post},
};
use foundation::{Currency, Money};
use oz_api::auth::{ApiTokenClaims, auth_middleware};
use oz_payment::PaymentProcessor as _;
use oz_payment::drivers::qris::QrisPaymentProcessor;
use oz_payment::types::PaymentRequest;
use serde::Deserialize;
use tokio::sync::Mutex;

use crate::CloudServerState;
use crate::midtrans_ledger::LedgerDb;
use crate::rate_limit::{RateLimiterState, rate_limit_middleware};

/// The only currency the Midtrans QRIS driver produces (PAY-3 pre-flight
/// in the driver rejects others; the endpoint rejects before any HTTP call).
const QRIS_CURRENCY: &[u8; 3] = b"IDR";

/// QR validity window served to the UI so the countdown has ONE source of
/// truth: the driver hardcodes the same 300 s (`QRIS_EXPIRY_SECS` in
/// `crates/oz-payment/src/drivers/qris.rs` — Midtrans-side expiry we do not
/// control; agents-3 repair notes the roadmap's "15 minutes" was wrong).
const QRIS_EXPIRY_SECS: u32 = 300;

/// State for the payment API router.
#[derive(Clone)]
pub struct PaymentState {
    /// SQLite connection (single-store / dev deployments).
    pub db: Arc<Mutex<rusqlite::Connection>>,
    /// PostgreSQL pool when on Postgres.
    pub pg: Option<deadpool_postgres::Pool>,
    /// Per-tenant limiter, shared shape with `SyncState`.
    pub rate_limiter: RateLimiterState,
    /// Built once at startup from the server key + sandbox flag; `None` when
    /// `MIDTRANS_SERVER_KEY` is unset — the handler then fails closed with
    /// 503. Tests inject a wiremock-backed processor here directly.
    pub processor: Option<QrisPaymentProcessor>,
}

impl From<CloudServerState> for PaymentState {
    fn from(state: CloudServerState) -> Self {
        Self::from_state_with_rate_limiter(state, RateLimiterState::new())
    }
}

impl PaymentState {
    /// Build with an explicit limiter (mirrors the sync API's
    /// `from_with_rate_limiter` so tests can pin limiter state).
    pub fn from_state_with_rate_limiter(
        state: CloudServerState,
        rate_limiter: RateLimiterState,
    ) -> Self {
        let processor = state
            .midtrans_server_key
            .as_deref()
            .map(|key| QrisPaymentProcessor::new(key, state.midtrans_sandbox));
        Self {
            db: state.db.clone(),
            pg: state.pg.clone(),
            rate_limiter,
            processor,
        }
    }
}

/// Build the payment router. Middleware order mirrors `sync_router` minus
/// the plan gate (payments are not a plan-gated surface in agents-1):
/// auth_middleware → rate_limit_middleware → handler.
pub fn payment_router(state: PaymentState) -> Router {
    let rate_limiter = state.rate_limiter.clone();
    Router::new()
        .route("/api/payment/midtrans/qris", post(qris_charge_handler))
        .route(
            "/api/payment/midtrans/{order_id}/status",
            get(qris_status_handler),
        )
        .with_state(state)
        .layer(middleware::from_fn(rate_limit_middleware))
        .layer(middleware::from_fn(auth_middleware))
        .layer(axum::Extension(rate_limiter))
}

/// Request body for `POST /api/payment/midtrans/qris`.
#[derive(Debug, Deserialize)]
pub struct ChargeRequest {
    /// Device-side sale this QR will settle. Sent as text; deliberately not
    /// validated against a cloud `sales` row — the row usually has not
    /// synced yet (that race is why the ledger exists).
    pub sale_id: String,
    /// Amount in IDR minor units. For IDR the minor unit IS the Rupiah
    /// (exp-0, the same convention the driver fixed in PAY-1).
    pub amount_minor: i64,
    /// ISO code; must be `IDR` (case-insensitive) or absent.
    #[serde(default)]
    pub currency: Option<String>,
    /// Optional caller idempotency key. The driver derives `order_id` from
    /// it, so a retry with the same key re-uses the SAME live QR instead of
    /// minting a second one (PAY-2).
    #[serde(default)]
    pub idempotency_key: Option<String>,
    /// Optional description forwarded to the driver.
    #[serde(default)]
    pub description: Option<String>,
}

/// Response body on success — note the status name: ISSUED, not paid.
#[derive(Debug, serde::Serialize)]
pub struct ChargeResponse {
    /// Midtrans order id this QR carries (also the ledger primary key).
    pub order_id: String,
    /// The QR payload string for rendering, when the gateway returned one.
    pub qr_string: Option<String>,
    /// Always `qr_issued`: settlement is asynchronous and webhook-driven.
    pub status: &'static str,
    /// Echo of the requested amount (minor units) for UI-side assertion.
    pub amount_minor: i64,
    /// Echo of the currency (`IDR`).
    pub currency: &'static str,
    /// Echo of the sale this issuance is bound to.
    pub sale_id: String,
    /// Seconds the QR stays valid gateway-side (countdown source; the driver
    /// enforces the same window with its `QRIS_EXPIRY_SECS` constant).
    pub expires_in_secs: u32,
}

async fn qris_charge_handler(
    State(state): State<PaymentState>,
    Extension(claims): Extension<ApiTokenClaims>,
    axum::Json(body): axum::Json<ChargeRequest>,
) -> Result<axum::Json<ChargeResponse>, (StatusCode, String)> {
    // Tenant strictly from the JWT — the body is never trusted for it
    // (sync_api's spoofing rule, applied to the payment surface).
    let tenant_id = claims.tenant_id.clone().ok_or((
        StatusCode::UNAUTHORIZED,
        "token is not tenant-scoped; QRIS charges require a tenant".into(),
    ))?;

    let amount_minor = body.amount_minor;
    if amount_minor <= 0 {
        return Err((
            StatusCode::BAD_REQUEST,
            "amount_minor must be a positive integer (IDR minor units)".into(),
        ));
    }
    if body.sale_id.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, "sale_id is required".into()));
    }
    if let Some(cur) = &body.currency
        && !cur.eq_ignore_ascii_case("IDR")
    {
        return Err((
            StatusCode::BAD_REQUEST,
            format!("QRIS supports only IDR, got '{cur}'"),
        ));
    }

    let processor = state.processor.as_ref().ok_or((
        StatusCode::SERVICE_UNAVAILABLE,
        "MIDTRANS_SERVER_KEY not configured; QRIS charges are disabled".into(),
    ))?;

    let request = PaymentRequest {
        amount: Money {
            minor_units: amount_minor,
            currency: Currency(*QRIS_CURRENCY),
        },
        reference: Some(body.sale_id.clone()),
        description: body.description.clone(),
        idempotency_key: body.idempotency_key.clone(),
    };

    // `sale` is the honest two-phase entry point: it charges and returns as
    // soon as the QR exists; it does NOT poll for settlement (PAY-6).
    let result = processor
        .sale(&request)
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, format!("midtrans charge failed: {e}")))?;

    if !result.success {
        return Err((
            StatusCode::BAD_GATEWAY,
            format!(
                "midtrans refused the charge: {}",
                result.message.unwrap_or_else(|| "no message".into())
            ),
        ));
    }

    let order_id = result
        .transaction_id
        .clone()
        .ok_or((StatusCode::BAD_GATEWAY, "no order_id in charge".into()))?;
    // The driver's documented message format is `SCAN_QR|<order_id>[|<qr>]`.
    let qr_string = result
        .message
        .as_deref()
        .and_then(|m| m.split('|').nth(2))
        .map(str::to_owned);

    // Record BEFORE responding: a settlement webhook may already be in
    // flight (fast scanners pay in seconds). If this write fails the QR is
    // live but unattributable — log at ERROR with everything needed for
    // manual reconciliation, and fail the request loudly.
    let ledger = LedgerDb {
        db: state.db.clone(),
        pg: state.pg.clone(),
    };
    if let Err(e) = ledger
        .record_issue(&order_id, &tenant_id, &body.sale_id, amount_minor, "IDR")
        .await
    {
        tracing::error!(
            order_id = %order_id,
            tenant_id = %tenant_id,
            sale_id = %body.sale_id,
            amount_minor,
            error = %e,
            "MIDTRANS LEDGER WRITE FAILED AFTER CHARGE — QR is live but settlement cannot be attributed; reconcile manually"
        );
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("charge issued but not journaled (reconcile order {order_id}): {e}"),
        ));
    }

    Ok(axum::Json(ChargeResponse {
        order_id,
        qr_string,
        status: "qr_issued",
        amount_minor,
        currency: "IDR",
        sale_id: body.sale_id,
        expires_in_secs: QRIS_EXPIRY_SECS,
    }))
}

/// Response body for the status poll.
#[derive(Debug, serde::Serialize)]
pub struct StatusResponse {
    /// Echo of the queried order id.
    pub order_id: String,
    /// Verbatim ledger status: `issued`, `pending`, `settlement`, `capture`,
    /// `expire`, `cancel`, `amount_mismatch`, ...
    pub status: String,
    /// True iff the ledger records `settlement`/`capture` — the poll-loop
    /// exit condition for the UI.
    pub settled: bool,
}

/// `GET /api/payment/midtrans/{order_id}/status` — the settlement poll the
/// UI runs while the webhook is racing the device's sync push (agents-3
/// 3.1a). Read-only over the ledger.
///
/// A query for another tenant's order answers the SAME 404 as an unknown
/// order: the endpoint must not leak the existence of other tenants'
/// transactions. (The ledger read is the unscoped resolver-style lookup, so
/// this comparison is deliberately on the RESULT, not in the WHERE clause —
/// one uniform miss shape is the point.)
async fn qris_status_handler(
    State(state): State<PaymentState>,
    Extension(claims): Extension<ApiTokenClaims>,
    Path(order_id): Path<String>,
) -> Result<axum::Json<StatusResponse>, (StatusCode, String)> {
    let tenant_id = claims.tenant_id.ok_or((
        StatusCode::UNAUTHORIZED,
        "token is not tenant-scoped".into(),
    ))?;
    let ledger = LedgerDb {
        db: state.db.clone(),
        pg: state.pg.clone(),
    };
    let entry = ledger
        .lookup(&order_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?
        .filter(|e| e.tenant_id == tenant_id);
    let entry = entry.ok_or((StatusCode::NOT_FOUND, "no such order".into()))?;
    let settled = entry.status == "settlement" || entry.status == "capture";
    Ok(axum::Json(StatusResponse {
        order_id: entry.order_id,
        status: entry.status,
        settled,
    }))
}

#[cfg(test)]
#[path = "payment_api_tests.rs"]
mod tests;
