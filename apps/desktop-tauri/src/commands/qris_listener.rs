//! Zero-MDR QRIS Notification Listener IPC commands (desktop shell).

use tauri::State;

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

    // Routed through the injected EventSink, not a raw AppHandle: the seam is what
    // keeps a second shell bindable (R10 #3), and `bridge_ctx()` already builds the
    // sink from the state's app handle (commands/authz.rs:215). A raw `app_handle.emit`
    // here was a new blocking finding in verify-architecture-boundaries.
    //
    // `None` is the headless default and makes this a silent no-op -- a lost UI event
    // is never a command failure, matching the sink's own contract.
    if let (Some(emitter), Some(payment)) = (ctx.emitter.as_ref(), result.as_ref()) {
        emitter.emit(
            "kasirmu:qrisPaymentNotification",
            serde_json::to_value(payment).unwrap_or(serde_json::Value::Null),
        );
    }

    Ok(result)
}
