//! Zero-MDR QRIS Notification Listener IPC commands (desktop shell).

use tauri::{AppHandle, Emitter, State};

use kasirmu_bridge::qris_listener::{
    QrisListenerStatusDto, QrisRecentPaymentDto, SimulateQrisNotificationArgs,
};

use crate::error::AppError;
use crate::state::AppState;

/// Query status of the QRIS notification listener.
#[tauri::command]
pub async fn get_qris_listener_status_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<QrisListenerStatusDto, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::qris_listener::get_qris_listener_status_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Open notification listener settings in the OS (no-op on desktop).
#[tauri::command]
pub async fn open_qris_listener_settings_scoped(
    _session_token: String,
    _state: State<'_, AppState>,
) -> Result<(), AppError> {
    Ok(())
}

/// Simulate an incoming bank push notification for test / development.
#[tauri::command]
pub async fn simulate_qris_notification_scoped(
    session_token: String,
    args: SimulateQrisNotificationArgs,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<QrisRecentPaymentDto>, AppError> {
    let ctx = state.bridge_ctx();
    let result = kasirmu_bridge::qris_listener::simulate_qris_notification_scoped(
        &ctx,
        &session_token,
        args,
    )
    .await
    .map_err(AppError::from)?;

    if let Some(ref payment) = result {
        let _ = app_handle.emit("kasirmu:qrisPaymentNotification", payment);
    }

    Ok(result)
}
