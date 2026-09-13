//! Local payment method commands (regional slice 6) — tablet twin of the
//! desktop surface. The tablet shell checks `settings:edit` on the session;
//! the location-resource scoping that the desktop shell layers on top
//! (ADR #47) has no tablet helper yet, matching this shell's other scoped
//! write commands.
//!
//! Phase 3.3 T3: `LocalPaymentRailArgs` is re-exported from the shared
//! `oz_bridge::local_payment` module (Agent 2's Wave F extraction), same
//! as the desktop shell — single wire definition, and it inherits the
//! 2026-09-13 casing repair: the UI has always sent snake_case
//! (`rail_code`, `is_enabled` — LocalPaymentSettingsCard.tsx handleSave,
//! verified back to slice 6 c549f7e5ab), which the old camelCase rename
//! on both shells silently rejected. The bodies stay tablet-native
//! (native `resolve_scope` + `require_permission_for_session`; no
//! BridgeCtx on tablet yet — see the T2 seam notes in `void.rs`).

use oz_core::db::payment_methods::{EffectivePaymentRail, NewPaymentRail};
use oz_core::{Store, permissions};
use tauri::State;

use crate::commands::authz::require_permission_for_session;
use crate::error::AppError;
use crate::state::AppState;

pub use oz_bridge::local_payment::LocalPaymentRailArgs;

/// Read the effective payment-rail surface for one location (slice 6).
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
/// transactional) and return the freshly effective surface.
#[tauri::command]
pub async fn set_local_payment_methods_scoped(
    location_id: String,
    rails: Vec<LocalPaymentRailArgs>,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<EffectivePaymentRail>, AppError> {
    let (session, conn) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SETTINGS_EDIT).await?;
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
