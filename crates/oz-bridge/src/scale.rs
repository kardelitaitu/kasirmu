//! Weight-scale bridge module (Wave D).
//!
//! Scale reads resolve the session scope from the opaque token and then go
//! straight to the HAL driver registry ([`BridgeCtx::registry`]); a register
//! with no scale yields `None` rather than an error, exactly as the shell
//! command bodies did.

use serde::Serialize;

use oz_hal::WeightReading;

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

/// Information about a detected scale device.
#[derive(Debug, Serialize)]
pub struct ScaleDeviceInfo {
    /// Vendor ID in hex (e.g. `"0x0922"`).
    pub vendor_id: String,
    /// Product ID in hex (e.g. `"0x8001"`).
    pub product_id: String,
    /// Platform device path.
    pub device_path: String,
}

/// Read scale weight (scoped).
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for an unknown token and
/// propagates scale [`oz_hal::HalError`]s; a register with no scale yields
/// `Ok(None)` by design.
pub async fn read_scale_weight_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<Option<WeightReading>, BridgeError> {
    ctx.resolve_scope(session_token)?;
    let scale = ctx.registry.scale("default").await;
    match scale {
        Some(s) => {
            let reading = s.read_weight()?;
            Ok(Some(reading))
        }
        None => Ok(None),
    }
}

/// List scale devices (scoped).
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for an unknown token.
pub async fn list_scale_devices_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<Vec<ScaleDeviceInfo>, BridgeError> {
    ctx.resolve_scope(session_token)?;
    let ids = ctx.registry.scale_ids().await;
    let mut devices = Vec::with_capacity(ids.len());
    for id in ids {
        if let Some(scale) = ctx.registry.scale(&id).await {
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
