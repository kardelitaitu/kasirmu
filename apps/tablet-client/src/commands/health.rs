//! Health-check commands used by the front-end's startup smoke test and
//! the About dialog. No state required.

// Phase 3.3 T1 (tablet bridge-sharing): the bodies moved to
// kasirmu_bridge::health, same Wave-F shape the desktop shell landed. The
// compile-time identity constants (env!/option_env!) still resolve HERE —
// they are per-crate, and threading them keeps the About dialog answering
// with the tablet shell's values (name would otherwise read "oz-bridge").
// The tablet registers no scoped health commands today, so this slice
// needs no BridgeCtx; the scoped twins arrive with a later slice that
// also builds the tablet seam.

use tauri::command;

use crate::error::AppError;

pub use kasirmu_bridge::health::VersionInfo;

/// Liveness probe. Returns `Ok("pong")` if the Tauri runtime is alive.
#[command]
pub async fn ping() -> Result<String, AppError> {
    kasirmu_bridge::health::ping().await.map_err(Into::into)
}

#[command]
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

/// Get the stable device identifier (hostname) for terminal binding.
#[command]
pub async fn get_device_id() -> Result<String, AppError> {
    kasirmu_bridge::health::get_device_id().await.map_err(Into::into)
}

/// Get the local IP address of the machine.
#[command]
pub async fn get_local_ip() -> Result<String, AppError> {
    kasirmu_bridge::health::get_local_ip().await.map_err(Into::into)
}

#[cfg(test)]
#[path = "health_tests.rs"]
mod tests;
