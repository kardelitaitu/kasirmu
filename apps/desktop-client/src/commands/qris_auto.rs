//! QRIS Auto dynamic-charge IPC — thin wrappers over
//! [`oz_bridge::qris_auto`] (ADR-49: business logic lives in the bridge;
//! the command layer only lifts `State` and maps errors).
//!
//! The charge returns when the QR EXISTS (`status: "qr_issued"`, PAY-6 two
//! phase contract); settlement arrives asynchronously via the cloud webhook
//! and is observed through [`qris_auto_status_scoped`].

use serde::Deserialize;
use tauri::State;

use oz_bridge::qris_auto::{QrisAutoChargeDto, QrisAutoStatusDto};

use crate::error::AppError;
use crate::state::AppState;

/// Arguments for [`qris_auto_charge_scoped`].
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QrisAutoChargeArgs {
    /// Local sale id the issuance binds to (recorded in the cloud ledger).
    pub sale_id: String,
    /// Amount requested, minor units (IDR — exponent 0; never float).
    pub amount_minor: i64,
    /// Optional idempotency key; a retry with the SAME key re-uses the
    /// already-issued live QR instead of minting a second charge.
    #[serde(default)]
    pub idempotency_key: Option<String>,
}

/// Arguments for [`qris_auto_status_scoped`].
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QrisAutoStatusArgs {
    /// Order id from the charge response.
    pub order_id: String,
}

/// Issue a dynamic Midtrans QRIS charge for a sale (scoped, ADR #7).
#[tauri::command]
pub async fn qris_auto_charge_scoped(
    session_token: String,
    args: QrisAutoChargeArgs,
    state: State<'_, AppState>,
) -> Result<QrisAutoChargeDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::qris_auto::qris_auto_charge_scoped(
        &ctx,
        &session_token,
        &args.sale_id,
        args.amount_minor,
        args.idempotency_key,
    )
    .await
    .map_err(Into::into)
}

/// Poll a charge's settlement status (scoped, ADR #7).
#[tauri::command]
pub async fn qris_auto_status_scoped(
    session_token: String,
    args: QrisAutoStatusArgs,
    state: State<'_, AppState>,
) -> Result<QrisAutoStatusDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::qris_auto::qris_auto_status_scoped(&ctx, &session_token, &args.order_id)
        .await
        .map_err(Into::into)
}
