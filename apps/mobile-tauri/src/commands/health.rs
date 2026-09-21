//! Health-check commands used by the front-end's startup smoke test and
//! the About dialog. No state required.

// Phase 3.3 T1 (tablet bridge-sharing): the bodies moved to
// kasirmu_bridge::health, same Wave-F shape the desktop shell landed. The
// compile-time identity constants (env!/option_env!) still resolve HERE —
// they are per-crate, and threading them keeps the About dialog answering
// with the tablet shell's values (name would otherwise read "kasirmu-bridge").
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
    kasirmu_bridge::health::get_device_id()
        .await
        .map_err(Into::into)
}

/// Get the local IP address of the machine.
#[command]
pub async fn get_local_ip() -> Result<String, AppError> {
    kasirmu_bridge::health::get_local_ip()
        .await
        .map_err(Into::into)
}

/// Report this installation’s APK signing-certificate fingerprint (ADR #57 §2.1).
///
/// **Why this is a command rather than only an argument to the licence call.**
/// The fingerprint is otherwise produced strictly inside `check_license_status`,
/// which returns early when no licence is activated — so on a fresh or
/// free-tier install the entire JNI path is unreachable and therefore
/// unverifiable. That is exactly the situation that let it ship with no on-device
/// evidence. Exposing the read makes it observable on ANY device, which is what
/// turns "the tablet app compiles" into "the tablet reports the certificate we
/// pinned".
///
/// **It reveals nothing sensitive.** The fingerprint is a property of the public
/// APK, published in the release artifact; anyone with the APK can compute it. It
/// is explicitly NOT a credential and is not in the credential-family deny list
/// (`platform/core/src/settings/keys.rs` makes the same argument for
/// `DEVICE_REVOKED`). An operator comparing it against the pinned value is the
/// intended use.
///
/// Returns `None` off Android and on every failure inside the Android path —
/// the fail-open direction ADR #57 §2.2 requires, since an absent value
/// classifies as `unknown` and never as a mismatch.
#[command]
pub async fn get_build_fingerprint() -> Result<Option<String>, AppError> {
    // `spawn_blocking`: the read performs JNI calls, and the Bluetooth transport
    // documents why that must never run on a runtime worker or the main thread.
    tokio::task::spawn_blocking(kasirmu_bridge::build_integrity::apk_signing_fingerprint)
        .await
        .map_err(|e| AppError::Internal(format!("fingerprint read panicked: {e}")))
}

#[cfg(test)]
#[path = "health_tests.rs"]
mod tests;
