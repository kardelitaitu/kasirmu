//! Weight scale commands.
//!
//! Phase 3.3 T2 moved `ScaleDeviceInfo` to `kasirmu_bridge::scale` and this
//! slice goes the rest of the way: all three bodies now delegate to the
//! bridge, exactly as `analytics.rs` and `audit.rs` do. The old header said
//! the tablet "cannot yet build" a `BridgeCtx`; that stopped being true when
//! `AppState::bridge_ctx()` landed (`state.rs:473`, which already carries
//! `registry`), and the native copies were the last place the tablet could
//! diverge from the desktop. Delegating is what makes the
//! `ac93cff77` fix reach this shell: the native `list_scale_devices_scoped`
//! below still walked `scale_ids()` and skipped any id that did not resolve,
//! so a scale could vanish from the list with no error — the same defect the
//! bridge had. A copy is dropped rather than re-patched.

use tauri::{State, command};

use kasirmu_hal::WeightReading;

use crate::error::AppError;
use crate::state::AppState;

pub use kasirmu_bridge::scale::ScaleDeviceInfo;

/// Read the current weight from the registered weight scale.
///
/// Uses the default scale registered under the "default" key.
/// Returns `None` if no scale is registered.
#[command]
pub async fn read_scale_weight(
    state: State<'_, AppState>,
) -> Result<Option<WeightReading>, AppError> {
    kasirmu_bridge::scale::read_scale_weight(&state.bridge_ctx())
        .await
        .map_err(Into::into)
}

/// Session-scoped variant of `read_scale_weight`.
#[command]
pub async fn read_scale_weight_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Option<WeightReading>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::scale::read_scale_weight_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// List all registered weight scales resolved from a session token. ADR #7.
#[command]
pub async fn list_scale_devices_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<ScaleDeviceInfo>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::scale::list_scale_devices_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

#[cfg(test)]
#[path = "scale_tests.rs"]
mod tests;
