//! Health-check commands used by the front-end's startup smoke test and
//! the About dialog. No state required.

// Wave F: the bodies moved to kasirmu_bridge::health. The compile-time identity
// constants (env!/option_env!) are resolved HERE — they are per-crate, and
// threading them keeps the About dialog answering with the desktop shell's
// values. The runtime host probes live in the bridge verbatim.

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

pub use kasirmu_bridge::health::VersionInfo;

/// Liveness probe. Returns `Ok("pong")` if the Tauri runtime is alive.
#[tauri::command]
pub async fn ping() -> Result<String, AppError> {
    kasirmu_bridge::health::ping().await.map_err(Into::into)
}

#[tauri::command]
/// Version.
pub async fn version() -> Result<VersionInfo, AppError> {
    kasirmu_bridge::health::version(
        env!("CARGO_PKG_NAME"),
        env!("CARGO_PKG_VERSION"),
        env!("CARGO_PKG_RUST_VERSION"),
        option_env!("TARGET").unwrap_or("unknown"),
    )
    .await
    .map_err(Into::into)
}

/// Version info resolved from a session token. ADR #7.
/// Validates the session token and returns the same compile-time version info.
#[tauri::command]
pub async fn version_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<VersionInfo, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::health::version_scoped(
        &ctx,
        &session_token,
        env!("CARGO_PKG_NAME"),
        env!("CARGO_PKG_VERSION"),
        env!("CARGO_PKG_RUST_VERSION"),
        option_env!("TARGET").unwrap_or("unknown"),
    )
    .await
    .map_err(Into::into)
}

/// Get the stable device identifier (hostname) for terminal binding.
///
/// Reads `COMPUTERNAME` on Windows, `HOSTNAME` on Unix, or falls back
/// to `"unknown-device"`. This is used by WorkspaceContext to populate
/// the `terminal_id` field when creating session tokens (ADR #7).
#[tauri::command]
pub async fn get_device_id() -> Result<String, AppError> {
    kasirmu_bridge::health::get_device_id()
        .await
        .map_err(Into::into)
}

/// Get the local IP address of the machine.
#[tauri::command]
pub async fn get_local_ip() -> Result<String, AppError> {
    kasirmu_bridge::health::get_local_ip()
        .await
        .map_err(Into::into)
}

/// Session-scoped variant of [`ping`].
#[tauri::command]
pub async fn ping_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::health::ping_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Session-scoped variant of [`get_device_id`].
#[tauri::command]
pub async fn get_device_id_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::health::get_device_id_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Session-scoped variant of [`get_local_ip`].
#[tauri::command]
pub async fn get_local_ip_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::health::get_local_ip_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}
