//! KDS device management commands (enrollment + device list).
//!
//! ADR #49 shims over `kasirmu_bridge::kds_device`: the bodies live in the
//! bridge, so this shell and the desktop call one implementation.
//!
//! Only the two doors the renderer actually reaches are registered here.
//! `get_kds_device_scoped`, `update_kds_device_status_scoped`,
//! `deactivate_kds_device_scoped` and `ack_kds_order_scoped` have wrappers in
//! `ui/src/api/kds.ts` that NOTHING imports outside tests — registering them
//! would be a scoped orphan, which is the dead surface the parity gate grades
//! (`info[scoped-orphans]`). Add one when a screen grows a real caller.
//!
//! Permission gate: `KDS_UPDATE` for the write, `KDS_VIEW` for the read, both
//! enforced inside the bridge fn (`crates/kasirmu-bridge/src/kds_device.rs:42`
//! and `:68`), not here. That is what makes these safe to register — the
//! bridge fn is NOT the `ungated-ok` shape that `offline_queue_status_summary`
//! has, and which is why that read is guarded instead of registered.

use tauri::{State, command};

use kasirmu_core::kds::{KdsDevice, RegisterKdsDeviceInput};

use crate::error::AppError;
use crate::state::AppState;

/// Register a new KDS device bound to a Restaurant POS.
///
/// The caller supplies a pre-hashed pairing token (SHA-256 of the QR
/// enrollment token) and its expiry timestamp. The device starts in
/// `disconnected` status and `is_active = true`.
#[command]
pub async fn register_kds_device_scoped(
    session_token: String,
    input: RegisterKdsDeviceInput,
    state: State<'_, AppState>,
) -> Result<KdsDevice, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::kds_device::register_kds_device(&ctx, &session_token, input)
        .await
        .map_err(Into::into)
}

/// List all KDS devices for the Restaurant POS bound to the current session.
///
/// Rendered by `KdsDeviceStatusIndicator`, which sits in the KDS header — so
/// this fires on every KDS screen mount on the tablet.
#[command]
pub async fn list_kds_devices_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<KdsDevice>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::kds_device::list_kds_devices(&ctx, &session_token)
        .await
        .map_err(Into::into)
}
