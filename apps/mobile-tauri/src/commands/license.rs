//! Licence commands — the tablet shell's copy of the desktop read surface.
//!
//! The settings hub lives in the shared `ui/`, so Settings → License
//! Subscription renders in BOTH shells; a command only one shell registered
//! would be an IPC parity gap the tablet discovers at runtime as a permanent
//! "Failed to load license info" behind a Retry button that fails the same way
//! every time.
//!
//! READ-ONLY ON PURPOSE. `activate_license`, `renew_license`,
//! `pause_subscription`, `resume_subscription`, `test_auth_connection` and
//! every `*_scoped` twin stay desktop-only: activation and billing management
//! are back-office actions, not tablet ones. What is registered here is exactly
//! what the licence screen reaches on mount and on its poll — nothing more.
//!
//! Each body is the same headless `kasirmu_bridge::license` call the desktop
//! command makes, borrowing a `BridgeCtx` from `AppState` and mapping
//! `BridgeError` back to `AppError` variant-for-variant (the `From` impl lives
//! in `commands/authz.rs`, the same seam the other tablet shims use). The
//! command names and parameter lists are IDENTICAL to the desktop ones, so the
//! UI's `invoke` calls resolve unchanged.

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

pub use kasirmu_bridge::license::{LicenseStatusDto, ServerLicenseStatusDto};

/// Analyzes the local license state and returns a comprehensive status response.
///
/// The licence screen's mount path: it reads locally-stored data, so it needs
/// no network and answers even on a device that has never been activated.
#[tauri::command]
pub async fn get_license_status(state: State<'_, AppState>) -> Result<LicenseStatusDto, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::license::get_license_status(&ctx)
        .await
        .map_err(Into::into)
}

/// Checks the license status against the PocketBase license server.
///
/// Unlike [`get_license_status`] which reads locally-stored data, this
/// command calls the server's `/api/v1/license/status` endpoint to get
/// the authoritative current status (e.g. whether the license has been
/// revoked or downgraded since last activation).
///
/// The stored API key is decrypted and sent as a Bearer token for
/// authentication. Returns the server's response directly.
#[tauri::command]
pub async fn check_license_status(
    state: State<'_, AppState>,
) -> Result<ServerLicenseStatusDto, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::license::check_license_status(&ctx)
        .await
        .map_err(Into::into)
}
