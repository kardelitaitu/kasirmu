//! Weight scale commands.
//!
//! Phase 3.3 T2: `ScaleDeviceInfo` moved to the shared `oz_bridge::scale`
//! module (Agent 2's Wave D extraction) and is re-exported here, same as
//! the desktop shell. The bodies stay tablet-native this slice: the
//! scoped twins on the bridge take a `BridgeCtx` the tablet `AppState`
//! cannot yet build (see the T2 seam notes in `void.rs`), so the shims
//! keep resolving sessions natively (`state.resolve_session`) and going
//! straight to the HAL registry — byte-identical behaviour to the
//! bridge bodies, which only differ by ctx plumbing.

use tauri::{State, command};

use kasirmu_hal::WeightReading;

use crate::error::AppError;
use crate::state::AppState;

pub use oz_bridge::scale::ScaleDeviceInfo;

/// Read the current weight from the registered weight scale.
///
/// Uses the default scale registered under the "default" key.
/// Returns `None` if no scale is registered.
#[command]
pub async fn read_scale_weight(
    state: State<'_, AppState>,
) -> Result<Option<WeightReading>, AppError> {
    let scale = state.registry.scale("default").await;
    match scale {
        Some(s) => {
            let reading = s.read_weight()?;
            Ok(Some(reading))
        }
        None => Ok(None),
    }
}

/// Session-scoped variant of `read_scale_weight`.
#[command]
pub async fn read_scale_weight_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Option<WeightReading>, AppError> {
    let _session = state.resolve_session(&session_token)?;
    let scale = state.registry.scale("default").await;
    match scale {
        Some(s) => {
            let reading = s.read_weight()?;
            Ok(Some(reading))
        }
        None => Ok(None),
    }
}

/// List all registered weight scales resolved from a session token. ADR #7.
#[command]
pub async fn list_scale_devices_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<ScaleDeviceInfo>, AppError> {
    let _session = state.resolve_session(&session_token)?;
    let ids = state.registry.scale_ids().await;
    let mut devices = Vec::with_capacity(ids.len());
    for id in ids {
        if let Some(scale) = state.registry.scale(&id).await {
            let info = scale.device_info();
            devices.push(ScaleDeviceInfo {
                vendor_id: info.vendor,
                product_id: info.model,
                device_path: info.serial,
            });
        }
    }
    Ok(devices)
}

#[cfg(test)]
#[path = "scale_tests.rs"]
mod tests;
