//! Weight scale integration.
//!
//! Wave D / D3b: the bodies live in the headless `kasirmu_bridge::scale` module.
//! Each `#[tauri::command]` below keeps its exact name, parameter list
//! and `Result<_, AppError>` return; the DTO moved with the bodies and is
//! re-exported so the sibling test module still resolves it via the parent
//! module.

use kasirmu_hal::WeightReading;
use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

pub use kasirmu_bridge::scale::ScaleDeviceInfo;

/// Read scale weight (scoped).
#[tauri::command]
pub async fn read_scale_weight_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Option<WeightReading>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::scale::read_scale_weight_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// List scale devices (scoped).
#[tauri::command]
pub async fn list_scale_devices_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<ScaleDeviceInfo>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::scale::list_scale_devices_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}
