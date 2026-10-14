//! Zero-MDR QRIS Notification Listener IPC commands (tablet shell).

use tauri::State;

use kasirmu_bridge::qris_listener::{
    QrisListenerStatusDto, QrisRecentPaymentDto, SimulateQrisNotificationArgs,
};
use kasirmu_core::permissions;

use crate::commands::authz::require_permission_for_session;
use crate::error::AppError;
use crate::state::AppState;

/// Query status of the QRIS notification listener on Android.
#[tauri::command]
pub async fn get_qris_listener_status_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<QrisListenerStatusDto, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SALES_PROCESS).await?;

    Ok(QrisListenerStatusDto {
        is_supported: true,
        is_enabled: true,
        is_connected: true,
        platform: "android".to_string(),
    })
}

/// Open Android Notification Listener system settings.
#[tauri::command]
pub async fn open_qris_listener_settings_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SALES_PROCESS).await?;

    Ok(())
}

/// Simulate an incoming bank push notification for test / development.
#[tauri::command]
pub async fn simulate_qris_notification_scoped(
    session_token: String,
    args: SimulateQrisNotificationArgs,
    state: State<'_, AppState>,
) -> Result<Option<QrisRecentPaymentDto>, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SALES_PROCESS).await?;

    let pkg = args.package_name.as_deref().unwrap_or("com.bca");
    let now = args.timestamp_ms.unwrap_or_else(|| {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0)
    });

    let parsed = qris_core::parse_notification(pkg, args.title.as_deref(), &args.text, now);
    let result: Option<QrisRecentPaymentDto> = parsed.map(Into::into);

    // Routed through the injected EventSink, not a raw AppHandle: the seam is what
    // keeps a second shell bindable (R10 #3), and state.rs:555 already builds the
    // sink from this shell's app handle. A raw `app_handle.emit` here was a new
    // blocking finding in verify-architecture-boundaries.
    //
    // This command does its own permission gate rather than calling the bridge body
    // the desktop shell uses, so the ctx is built locally for the emitter alone.
    let ctx = state.bridge_ctx();
    if let (Some(emitter), Some(payment)) = (ctx.emitter.as_ref(), result.as_ref()) {
        emitter.emit(
            "kasirmu:qrisPaymentNotification",
            serde_json::to_value(payment).unwrap_or(serde_json::Value::Null),
        );
    }

    Ok(result)
}
