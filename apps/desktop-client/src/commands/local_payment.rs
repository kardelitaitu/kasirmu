//! Local payment method commands (regional slice 6, saas-2 design slice
//! queue #6) — the market rail surface, entity → location.
//!
//! Wire contract: the core `EffectivePaymentRail` model is returned as-is
//! (camelCase serde — the shape the dev-mock and the card mirror). The
//! module never touches entitlements or `payment_gateways`: which rails a
//! market/site offers is a MARKET fact; `supports_qris` is a TIER answer
//! (license layer) and gateway credentials live in `payment_gateways`. The
//! write path rejects credential-shaped parameter keys outright.
//!
//! Read: `settings:read` (any operator can see the rail surface).
//! Write: `settings:edit` + the ADR #47 location-resource gate — the
//! location layer is what the card edits; the legal-entity layer is
//! managed through the same command with the entity scope resolved by
//! later management surfaces.

// Wave F: the bodies moved to kasirmu_bridge::local_payment. The gate pair keeps
// its original order (session gate then the ADR #47 location-resource gate)
// inside the bridge fn.

#[allow(unused_imports)] // sibling local_payment_tests.rs depends on it
use kasirmu_core::db::assignments::ScopeType;
use kasirmu_core::db::payment_methods::EffectivePaymentRail;
#[allow(unused_imports)] // sibling local_payment_tests.rs depends on it
use kasirmu_core::{Store, permissions};
use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

pub use kasirmu_bridge::local_payment::LocalPaymentRailArgs;

/// Read the effective payment-rail surface for one location of the
/// session's store (regional slice 6).
///
/// Resolves the session's store database (ADR #7) and checks `settings:read`
/// inline. The read walks entity → location per rail with provenance — the
/// same chain semantics as the regional read. An unlinked or unknown
/// location answers an empty list (no market, no invented rails).
#[tauri::command]
pub async fn get_local_payment_methods_scoped(
    location_id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<EffectivePaymentRail>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::local_payment::get_local_payment_methods_scoped(
        &ctx,
        &location_id,
        &session_token,
    )
    .await
    .map_err(Into::into)
}

/// Replace the location's rail list (the card's whole-list write,
/// transactional) and return the freshly effective surface (read-after-
/// write, same connection) so the card re-renders provenance without a
/// second round-trip.
///
/// Checks `settings:edit` scoped to the location resource (ADR #47).
/// Validation happens in core — credential-shaped parameter keys, blank
/// codes/labels, duplicates — inside the same transaction that rewrites
/// the rows; this command adds no validation of its own.
#[tauri::command]
pub async fn set_local_payment_methods_scoped(
    location_id: String,
    rails: Vec<LocalPaymentRailArgs>,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<EffectivePaymentRail>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::local_payment::set_local_payment_methods_scoped(
        &ctx,
        &location_id,
        rails,
        &session_token,
    )
    .await
    .map_err(Into::into)
}
