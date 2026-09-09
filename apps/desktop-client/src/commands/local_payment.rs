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

use oz_core::db::assignments::ScopeType;
use oz_core::db::payment_methods::{EffectivePaymentRail, NewPaymentRail};
use oz_core::{Store, permissions};
use tauri::State;

use crate::commands::authz::{
    require_permission_for_session, require_permission_for_session_resource,
};
use crate::error::AppError;
use crate::state::AppState;

/// One rail in the card's replace-set submission.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalPaymentRailArgs {
    /// Stable rail code (e.g. `qris`, `va-bca`).
    pub rail_code: String,
    /// Display label.
    pub label: String,
    /// Whether the scope offers the rail.
    pub is_enabled: bool,
    /// Per-rail market metadata (JSON object). Credential-shaped keys are
    /// rejected by the core write path.
    #[serde(default)]
    pub parameters: String,
}

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
    let (session, conn) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SETTINGS_READ).await?;
    let conn = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&conn);
    Ok(store.local_payment_methods_for_location(&location_id)?)
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
    let (session, conn) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SETTINGS_EDIT).await?;
    require_permission_for_session_resource(
        &state,
        &session,
        permissions::SETTINGS_EDIT,
        ScopeType::Location,
        &location_id,
    )
    .await?;
    let submitted: Vec<NewPaymentRail> = rails
        .into_iter()
        .map(|r| NewPaymentRail {
            rail_code: r.rail_code,
            label: r.label,
            is_enabled: r.is_enabled,
            parameters: r.parameters,
        })
        .collect();
    let conn = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&conn);
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    store.replace_local_payment_methods("location", &location_id, &submitted, &now)?;
    Ok(store.local_payment_methods_for_location(&location_id)?)
}

#[cfg(test)]
#[path = "local_payment_tests.rs"]
mod tests;
