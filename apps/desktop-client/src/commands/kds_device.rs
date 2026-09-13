//! KDS device management commands.
//!
//! IPC surface for registering, listing, updating status, and
//! deactivating Kitchen Display System devices.
//!
//! All commands require `kds:manage` permission for writes and
//! `kds:view` for reads.
//!
//! Wave D / D2b: every body lives in `oz_bridge::kds_device`; each command here
//! is a thin adapter that resolves the bridge context and maps `BridgeError`
//! onto `AppError` variant-for-variant.

use tauri::State;

use oz_core::kds::{KdsConnectionStatus, KdsDevice, RegisterKdsDeviceInput};

use crate::error::AppError;
use crate::state::AppState;

/// Register a new KDS device bound to a Restaurant POS.
///
/// The caller supplies a pre-hashed pairing token (SHA-256 of the QR
/// enrollment token) and its expiry timestamp. The device starts in
/// `disconnected` status and `is_active = true`.
#[tauri::command]
pub async fn register_kds_device_scoped(
    session_token: String,
    input: RegisterKdsDeviceInput,
    state: State<'_, AppState>,
) -> Result<KdsDevice, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::kds_device::register_kds_device(&ctx, &session_token, input)
        .await
        .map_err(Into::into)
}

/// List all KDS devices for the Restaurant POS bound to the current session.
#[tauri::command]
pub async fn list_kds_devices_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<KdsDevice>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::kds_device::list_kds_devices(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Get a single KDS device by ID.
#[tauri::command]
pub async fn get_kds_device_scoped(
    session_token: String,
    device_id: String,
    state: State<'_, AppState>,
) -> Result<Option<KdsDevice>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::kds_device::get_kds_device(&ctx, &session_token, &device_id)
        .await
        .map_err(Into::into)
}

/// Update a KDS device's connection status.
///
/// The Restaurant POS calls this when a KDS device connects or
/// disconnects. Setting `Connected` also updates `last_seen_at`.
#[tauri::command]
pub async fn update_kds_device_status_scoped(
    session_token: String,
    device_id: String,
    status: KdsConnectionStatus,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::kds_device::update_kds_device_status(&ctx, &session_token, &device_id, status)
        .await
        .map_err(Into::into)
}

/// Deactivate a KDS device (soft-delete).
///
/// Deactivated devices no longer receive routed orders. The device
/// record is retained for audit purposes.
#[tauri::command]
pub async fn deactivate_kds_device_scoped(
    session_token: String,
    device_id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::kds_device::deactivate_kds_device(&ctx, &session_token, &device_id)
        .await
        .map_err(Into::into)
}

/// Acknowledge a KDS order — the device accepted the ticket and started
/// prep, advancing it pending → preparing.
///
/// Uses optimistic locking: if another device already acknowledged
/// this order, returns `false` instead of erroring.
#[tauri::command]
pub async fn ack_kds_order_scoped(
    session_token: String,
    order_id: String,
    device_id: String,
    state: State<'_, AppState>,
) -> Result<bool, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::kds_device::ack_kds_order(&ctx, &session_token, &order_id, &device_id)
        .await
        .map_err(Into::into)
}
