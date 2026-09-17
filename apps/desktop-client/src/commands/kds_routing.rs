//! KDS routing commands: order-target resolution and routing-rule CRUD.
//!
//! Resolves which KDS devices should receive an order based on line items,
//! topology station assignments, per-restaurant routing rules, and device
//! station bindings; `get`/`save` manage the rule set of the session's
//! restaurant.
//!
//! Wave D / D2b: every body lives in `kasirmu_bridge::kds_routing`; each command
//! here is a thin adapter that maps `BridgeError` onto `AppError`.

use tauri::State;

use kasirmu_core::kds::{KdsRoutingRule, KdsRoutingRuleInput};

use crate::error::AppError;
use crate::state::AppState;

/// Resolve which KDS device IDs should receive an order based on its
/// line items, the restaurant's routing rules, and the registered device
/// station bindings.
///
/// Returns a list of device IDs. The caller is responsible for
/// filtering or pushing events to those devices.
///
/// Rules compose over the frozen 3-phase algorithm of
/// `kasirmu_core::kds::resolve_kds_targets` (station targeting per line,
/// broadcast fallback, unclaimed-station catch-all); an empty rule set
/// routes exactly as before.
#[tauri::command]
pub async fn resolve_kds_targets_scoped(
    session_token: String,
    order_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<String>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::kds_routing::resolve_kds_targets(&ctx, &session_token, &order_id)
        .await
        .map_err(Into::into)
}

/// List the KDS routing rules of the session's restaurant, highest
/// priority first (lower number = higher priority).
#[tauri::command]
pub async fn get_kds_routing_rules_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<KdsRoutingRule>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::kds_routing::get_kds_routing_rules(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Replace the complete KDS routing rule set of the session's restaurant.
///
/// The submitted list is the new truth (an empty list clears the scope);
/// ids and timestamps are server-assigned. Returns the persisted rules.
#[tauri::command]
pub async fn save_kds_routing_rules_scoped(
    session_token: String,
    rules: Vec<KdsRoutingRuleInput>,
    state: State<'_, AppState>,
) -> Result<Vec<KdsRoutingRule>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::kds_routing::save_kds_routing_rules(&ctx, &session_token, rules)
        .await
        .map_err(Into::into)
}
