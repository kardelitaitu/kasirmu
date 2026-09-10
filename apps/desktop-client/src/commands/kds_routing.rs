//! KDS routing resolution command.
//!
//! Resolves which KDS devices should receive an order based on line items,
//! topology station assignments, and device station bindings.
//!
//! Wave D / D2b: the body lives in `oz_bridge::kds_routing`; this command is a
//! thin adapter that maps `BridgeError` onto `AppError`.

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

/// Resolve which KDS device IDs should receive an order based on its
/// line items and the registered device station bindings.
///
/// Returns a list of device IDs. The caller is responsible for
/// filtering or pushing events to those devices.
///
/// Uses the 3-phase algorithm from `oz_core::kds::resolve_kds_targets`:
/// 1. Station-based targeting — match line item SKU → topology station → device
/// 2. Broadcast fallback — devices with empty station_ids get everything
/// 3. Catch-all — if any station has no claiming device, broadcast to all
#[tauri::command]
pub async fn resolve_kds_targets_scoped(
    session_token: String,
    order_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<String>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::kds_routing::resolve_kds_targets(&ctx, &session_token, &order_id)
        .await
        .map_err(Into::into)
}
