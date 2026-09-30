//! Weight-scale bridge module (Wave D).
//!
//! Scale reads resolve the session scope from the opaque token and then go
//! straight to the HAL driver registry ([`BridgeCtx::registry`](crate::ctx::BridgeCtx::registry)); a register
//! with no scale yields `None` rather than an error, exactly as the shell
//! command bodies did.
//!
//! Absence and failure are kept apart on purpose. `None` means the register
//! has no scale bound; it is a defined state a UI can render as "no scale".
//! A read that fails, or an id in the snapshot that no longer resolves to a
//! driver, is an error and is surfaced as one — the scale snapshot and the
//! lookup are taken under one write guard precisely so a concurrent
//! unregister cannot turn a present device into a silent omission.

use serde::Serialize;

use kasirmu_hal::WeightReading;

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
/// propagates scale [`kasirmu_hal::HalError`]s; a register with no scale yields
/// `Ok(None)` by design.
pub async fn read_scale_weight_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<Option<WeightReading>, BridgeError> {
    // ungated-ok: per-REGISTER hardware read, not store data
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
/// Takes the snapshot and the driver lookup from one registry call, so an id
/// in the snapshot always resolves to the driver it named. A concurrent
/// unregister cannot leave an id whose driver is already gone.
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for an unknown token, and
/// [`BridgeError::Internal`] if the snapshot names an id the registry can no
/// longer resolve. That branch is unreachable through the single-call
/// registry accessor but is kept as a loud guard: omitting the device would
/// report a shorter list than the truth, and a device that is present is
/// exactly what an operator must not have hidden from them.
pub async fn list_scale_devices_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<Vec<ScaleDeviceInfo>, BridgeError> {
    // ungated-ok: per-REGISTER hardware read, not store data
    ctx.resolve_scope(session_token)?;
    let scales = ctx.registry.scales().await;
    let mut devices = Vec::with_capacity(scales.len());
    for (id, scale) in scales {
        let Some(scale) = scale else {
            return Err(BridgeError::Internal(format!(
                "scale \"{id}\" is listed by the registry but no longer resolves to a driver; refusing to report a shorter device list than the truth"
            )));
        };
        let info = scale.device_info();
        devices.push(ScaleDeviceInfo {
            vendor_id: info.vendor,
            product_id: info.model,
            device_path: info.serial,
        });
    }
    Ok(devices)
}

#[cfg(test)]
#[path = "scale_tests.rs"]
mod scale_tests;
