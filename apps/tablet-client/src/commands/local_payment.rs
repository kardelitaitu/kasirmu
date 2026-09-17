//! Local payment method commands (regional slice 6) — tablet twin of the
//! desktop surface.
//!
//! Phase 3.3 T3: `LocalPaymentRailArgs` is re-exported from the shared
//! `oz_bridge::local_payment` module (Agent 2's Wave F extraction), same
//! as the desktop shell — single wire definition, and it inherits the
//! 2026-09-13 casing repair: the UI has always sent snake_case
//! (`rail_code`, `is_enabled` — LocalPaymentSettingsCard.tsx handleSave,
//! verified back to slice 6 c549f7e5ab), which the old camelCase rename
//! on both shells silently rejected.
//!
//! # ADR #49 status — measured 2026-09-16, `verify-body-parity.py` → **1 / 2**
//!
//! **One door is ported.** [`get_local_payment_methods_scoped`] delegates to
//! [`oz_bridge::local_payment::get_local_payment_methods_scoped`]: the bodies
//! were statement-identical, and the door names a permission
//! (`SETTINGS_READ`), so the move is ledger-neutral. The twin's argument order
//! is payload-first, `session_token` last.
//!
//! **One door is REFUSED.** [`set_local_payment_methods_scoped`] would **gain a
//! gate**: the twin adds an ADR #47 location-resource check on top of the
//! session gate — `require_permission_for_session_resource(&session,
//! SETTINGS_EDIT, ScopeType::Location, location_id)`
//! (`crates/kasirmu-bridge/src/local_payment.rs:82-88`) — which this shell has never
//! enforced. §4 forbids adding a gate inside an extraction as plainly as
//! removing one, so the body stays tablet-native.
//!
//! **Correction to the note this file used to carry.** It claimed "no
//! `BridgeCtx` on tablet yet", which is stale: [`AppState::bridge_ctx`] exists
//! (`apps/tablet-client/src/state.rs:417`) and is what the ported door above
//! uses. That paragraph predates the Slice 1+ shims and had already stopped
//! describing this shell.

use oz_core::db::payment_methods::{EffectivePaymentRail, NewPaymentRail};
use oz_core::{Store, permissions};
use tauri::State;

use crate::commands::authz::require_permission_for_session;
use crate::error::AppError;
use crate::state::AppState;

pub use oz_bridge::local_payment::LocalPaymentRailArgs;

/// Read the effective payment-rail surface for one location (slice 6).
///
/// # ADR #49 — ported 2026-09-16
///
/// Delegates to [`oz_bridge::local_payment::get_local_payment_methods_scoped`].
/// The body was statement-identical and the gate is `SETTINGS_READ` on both
/// sides, so the move is ledger-neutral. Argument order follows the twin:
/// `location_id` first, `session_token` last.
#[tauri::command]
pub async fn get_local_payment_methods_scoped(
    location_id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<EffectivePaymentRail>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::local_payment::get_local_payment_methods_scoped(&ctx, &location_id, &session_token)
        .await
        .map_err(Into::into)
}

/// Replace the location's rail list (the card's whole-list write,
/// transactional) and return the freshly effective surface.
///
/// # ADR #49 NOT APPLIED, deliberately — delegating would ADD a gate
///
/// Refused 2026-09-16. This shell gates on the session alone
/// (`SETTINGS_EDIT`, `require_permission_for_session`). The bridge twin layers
/// an ADR #47 location-resource check on top —
/// `require_permission_for_session_resource(&session, SETTINGS_EDIT,
/// ScopeType::Location, location_id)`
/// (`crates/kasirmu-bridge/src/local_payment.rs:82-88`) — which has never run on
/// this shell. §4 forbids adding a gate inside an extraction as plainly as
/// removing one, and a stricter gate can start refusing writes the shell
/// accepts today.
///
/// This is a **parity gap, not a policy question**: the desktop shell already
/// delegated this module, so the resource gate *is* desktop's shipped
/// behaviour. Adopting it is a gating change and must land in its own commit —
/// not inside an extraction.
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
