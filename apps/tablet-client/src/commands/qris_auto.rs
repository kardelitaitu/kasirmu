//! QRIS Auto dynamic-charge IPC — tablet twin of the desktop module of the
//! same name. The desktop form is a thin `BridgeCtx` delegate; the tablet
//! `AppState` cannot build a `BridgeCtx` yet (the documented blocker behind
//! `browser.rs`/`health.rs`/`scale.rs`), so this follows the tablet's own
//! current sync-command shape: resolve the scope inline, brief DB lock for
//! the sync config, drop the guard before the HTTP await. The DTO types are
//! imported from [`kasirmu_bridge::qris_auto`] so the IPC wire shape is identical
//! on both clients (one TS surface, ipc-parity); when the tablet gains the
//! ctx plumbing this module becomes the desktop's delegate verbatim.

use serde::Deserialize;
use tauri::State;

use kasirmu_bridge::qris_auto::{QrisAutoChargeDto, QrisAutoStatusDto};
use oz_core::db::Store;
use oz_core::permissions;
use oz_core::sync_client::{self, SyncConfig};

use crate::commands::authz::require_permission_for_session;
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
    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SALES_PROCESS).await?;
    let config = {
        let db_guard = conn_arc
            .lock()
            .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
        let db = &*db_guard;
        let store = Store::new(db);
        SyncConfig::from_settings(&store)?
    };
    let Some(config) = config else {
        return Err(AppError::Invalid(
            "Cloud sync is not configured — QRIS Auto needs the server URL and API token."
                .to_string(),
        ));
    };
    sync_client::qris_charge_on_server(
        &config,
        &args.sale_id,
        args.amount_minor,
        args.idempotency_key.as_deref(),
    )
    .await
    .map(QrisAutoChargeDto::from)
    .map_err(|e| AppError::Internal(e.to_string()))
}

/// Poll a charge's settlement status (scoped, ADR #7).
#[tauri::command]
pub async fn qris_auto_status_scoped(
    session_token: String,
    args: QrisAutoStatusArgs,
    state: State<'_, AppState>,
) -> Result<QrisAutoStatusDto, AppError> {
    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SALES_PROCESS).await?;
    let config = {
        let db_guard = conn_arc
            .lock()
            .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
        let db = &*db_guard;
        let store = Store::new(db);
        SyncConfig::from_settings(&store)?
    };
    let Some(config) = config else {
        return Err(AppError::Invalid(
            "Cloud sync is not configured — QRIS Auto needs the server URL and API token."
                .to_string(),
        ));
    };
    sync_client::qris_status_from_server(&config, &args.order_id)
        .await
        .map(QrisAutoStatusDto::from)
        .map_err(|e| AppError::Internal(e.to_string()))
}
