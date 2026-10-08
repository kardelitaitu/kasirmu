//! KDS routing-rule commands.
//!
//! ADR #49 shims over `kasirmu_bridge::kds_routing`: the bodies live in the
//! bridge, so this shell and the desktop call one implementation.
//!
//! Only `get` and `save` are registered. `resolve_kds_targets_scoped` has a
//! wrapper in `ui/src/api/kds.ts` that nothing imports outside tests — see the
//! same note in `commands/kds_device.rs`.
//!
//! Permission gate: `KDS_VIEW` for the read, `KDS_UPDATE` for the write, both
//! enforced inside the bridge fn
//! (`crates/kasirmu-bridge/src/kds_routing.rs:142` and `:177`), not here.

use tauri::{State, command};

use kasirmu_core::kds::{KdsRoutingRule, KdsRoutingRuleInput};

use crate::error::AppError;
use crate::state::AppState;

/// List the KDS routing rules of the session's restaurant, highest
/// priority first (lower number = higher priority).
#[command]
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
#[command]
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
