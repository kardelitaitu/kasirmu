//! QRIS Auto bridge commands — the device's route to the cloud's dynamic
//! Midtrans QRIS flow (agents-3 3.1b).
//!
//! Two scoped reads/writes over the stored sync credential:
//! - [`qris_auto_charge_scoped`] issues a QR (`POST /api/payment/midtrans/qris`);
//! - [`qris_auto_status_scoped`] polls its settlement (`GET …/status`).
//!
//! The tenant authority is always the stored API key the sync daemon
//! already uses — the device never names a tenant, and no body field is
//! trusted for one. DTOs here re-declare the cloud shapes in the repo's
//! camelCase IPC idiom (the `sync_client` structs carry the snake_case wire
//! names); errors surface as [`BridgeError`] so the command layer keeps its
//! single `map_err(Into::into)` contract.

use oz_core::db::Store;
use oz_core::permissions;
use oz_core::sync_client::{self, SyncConfig};

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

/// IPC view of a charge issue. `status` is `qr_issued` — rendering the QR
/// is not payment; the cashier waits on [`qris_auto_status_scoped`].
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QrisAutoChargeDto {
    /// Midtrans order id (cloud ledger key, status-poll handle).
    pub order_id: String,
    /// QR payload to render; null when the channel returns none.
    pub qr_string: Option<String>,
    /// `qr_issued` at issuance time.
    pub status: String,
    /// Echo of the requested amount, minor units.
    pub amount_minor: i64,
    /// Echo of the currency (`IDR`).
    pub currency: String,
    /// Echo of the sale the issuance is bound to.
    pub sale_id: String,
    /// QR validity window in seconds (UI countdown source).
    pub expires_in_secs: u32,
}

/// IPC view of a settlement poll.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QrisAutoStatusDto {
    /// Echo of the queried order id.
    pub order_id: String,
    /// Verbatim cloud ledger status.
    pub status: String,
    /// True once the ledger records settlement/capture.
    pub settled: bool,
}

impl From<sync_client::QrisChargeResult> for QrisAutoChargeDto {
    fn from(r: sync_client::QrisChargeResult) -> Self {
        Self {
            order_id: r.order_id,
            qr_string: r.qr_string,
            status: r.status,
            amount_minor: r.amount_minor,
            currency: r.currency,
            sale_id: r.sale_id,
            expires_in_secs: r.expires_in_secs,
        }
    }
}

impl From<sync_client::QrisStatusResult> for QrisAutoStatusDto {
    fn from(r: sync_client::QrisStatusResult) -> Self {
        Self {
            order_id: r.order_id,
            status: r.status,
            settled: r.settled,
        }
    }
}

/// Resolve the session, check the permission, and read the sync config —
/// guards are dropped before any await (std MutexGuard is not Send; the
/// F-017 idiom shared with [`crate::sync`]).
///
/// [`crate::sync`]: crate::sync
async fn session_config(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<SyncConfig, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::SALES_PROCESS)
        .await?;
    let config = {
        let conn = ctx
            .db_manager
            .open_store(&session.store_id)
            .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
        let db = conn
            .lock()
            .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
        let store = Store::new(&db);
        SyncConfig::from_settings(&store)?
    };
    config.ok_or_else(|| {
        BridgeError::Invalid(
            "Cloud sync is not configured — QRIS Auto needs the server URL and API token (Settings → Cloud Sync)."
                .into(),
        )
    })
}

/// Issue a dynamic QRIS charge for a sale (scoped). An `idempotency_key`
/// that has already been charged re-uses the SAME live QR (PAY-2), so the
/// UI may retry a dropped response with the key it already holds.
pub async fn qris_auto_charge_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    sale_id: &str,
    amount_minor: i64,
    idempotency_key: Option<String>,
) -> Result<QrisAutoChargeDto, BridgeError> {
    let config = session_config(ctx, session_token).await?;
    sync_client::qris_charge_on_server(&config, sale_id, amount_minor, idempotency_key.as_deref())
        .await
        .map(QrisAutoChargeDto::from)
        .map_err(|e| BridgeError::Internal(e.to_string()))
}

/// Poll one charge's settlement status (scoped). Settled here means the
/// cloud recorded the webhook — the sale itself completes when the queued
/// `finalize_sale` rides back on the next sync pull; the UI triggers one on
/// the settled signal so the cashier is not waiting for the daemon tick.
pub async fn qris_auto_status_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    order_id: &str,
) -> Result<QrisAutoStatusDto, BridgeError> {
    let config = session_config(ctx, session_token).await?;
    sync_client::qris_status_from_server(&config, order_id)
        .await
        .map(QrisAutoStatusDto::from)
        .map_err(|e| BridgeError::Internal(e.to_string()))
}

#[cfg(test)]
#[path = "qris_auto_tests.rs"]
mod tests;
