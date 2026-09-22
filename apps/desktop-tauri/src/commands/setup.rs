//! Setup Wizard commands.
//!
//! `complete_setup` persists the chosen preset and enabled features to
//! the settings table and marks the wizard as complete.
//! `get_setup_status` lets the front-end decide whether to show the
//! wizard or go straight to the main app.
//!
//! Wave E slice E8: command bodies live in `kasirmu_bridge::setup`; these are
//! thin shims that build a `BridgeCtx` and map `BridgeError` back to
//! `AppError` (wire shape unchanged).

#[allow(unused_imports)] // sibling setup_tests.rs depends on it
use kasirmu_core::{FeatureRegistry, Settings, Store, features};
use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

pub use kasirmu_bridge::setup::EnabledFeaturesResult;

// ── Commands ─────────────────────────────────────────────────────────

/// Return the list of currently-enabled feature keys.
///
/// The front-end calls this once on mount to decide which nav items
/// and UI elements to show/hide.
#[tauri::command]
pub async fn get_enabled_features(
    state: State<'_, AppState>,
) -> Result<EnabledFeaturesResult, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::setup::get_enabled_features(&ctx)
        .await
        .map_err(Into::into)
}

// ── Retired by ADR #56 §2.2 ──────────────────────────────────────────
//
// `complete_setup` was REMOVED here with its bridge twin. It wrote the two
// booleans §2.1 retires (`SETUP_COMPLETE`, `SHOW_SETUP_WIZARD`), and nothing
// called it once the first-run path became `provision_device` (§2.3).
//
// `get_setup_status` and `dismiss_setup_wizard` were REMOVED here. Both
// existed to serve the three booleans §2.1 retires: the dismissal key a
// failed read could forge in either direction, and the Skip escape hatch that
// marked setup complete while provisioning nothing.
//
// Their replacement is `get_first_run_state` above, which reads the
// provisioning row instead of a boolean.

/// The first-run state for one terminal (ADR #56 §2.1).
///
/// Replaces [`get_setup_status`]'s boolean: a provisioning row cannot be forged
/// by a failed read, because an unreadable database yields no row.
#[tauri::command]
pub async fn get_first_run_state(
    state: State<'_, AppState>,
    terminal_id: String,
) -> Result<kasirmu_bridge::setup::FirstRunStateDto, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::setup::get_first_run_state(&ctx, &terminal_id)
        .await
        .map_err(Into::into)
}

/// Provision this terminal in one idempotent transaction (ADR #56 §2.2).
///
/// Creates the location, the workspaces, the owner, the features and the
/// provisioning marker together, or none of them.
#[tauri::command]
pub async fn provision_device(
    state: State<'_, AppState>,
    args: kasirmu_bridge::setup::ProvisionDeviceArgs,
) -> Result<kasirmu_bridge::setup::ProvisionDeviceResultDto, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::setup::provision_device(&ctx, args)
        .await
        .map_err(Into::into)
}

/// Requires the `staff:manage_roles` permission.
#[tauri::command]
pub async fn seed_default_roles_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<usize, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::setup::seed_default_roles_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}
