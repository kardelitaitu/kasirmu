//! Local payment method commands (regional slice 6) — tablet twin of the
//! desktop surface. The tablet shell checks `settings:edit` on the session;
//! the location-resource scoping that the desktop shell layers on top
//! (ADR #47) has no tablet helper yet, matching this shell's other scoped
//! write commands.

use oz_core::db::payment_methods::{EffectivePaymentRail, NewPaymentRail};
use oz_core::{Store, permissions};
use tauri::State;

use crate::commands::authz::require_permission_for_session;
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
