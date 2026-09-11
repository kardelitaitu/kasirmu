//! Setup Wizard commands.
//!
//! `complete_setup` persists the chosen preset and enabled features to
//! the settings table and marks the wizard as complete.
//! `get_setup_status` lets the front-end decide whether to show the
//! wizard or go straight to the main app.
//!
//! Wave E slice E8: command bodies live in `oz_bridge::setup`; these are
//! thin shims that build a `BridgeCtx` and map `BridgeError` back to
//! `AppError` (wire shape unchanged).

#[allow(unused_imports)] // sibling setup_tests.rs depends on it
use oz_core::{FeatureRegistry, Settings, Store, features};
use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

pub use oz_bridge::setup::{CompleteSetupArgs, EnabledFeaturesResult, SetupStatus};

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
    oz_bridge::setup::get_enabled_features(&ctx)
        .await
        .map_err(Into::into)
}

/// Persist the chosen preset and features, then mark setup as complete.
///
/// Called by the front-end when the user clicks "Complete Setup" on
/// the last step of the wizard.
#[tauri::command]
pub async fn complete_setup(
    state: State<'_, AppState>,
    args: CompleteSetupArgs,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::setup::complete_setup(&ctx, args)
        .await
        .map_err(Into::into)
}

/// Returns whether the setup wizard has been completed.
///
/// The front-end calls this on mount to decide whether to render
/// the wizard or the main application.
#[tauri::command]
pub async fn get_setup_status(state: State<'_, AppState>) -> Result<SetupStatus, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::setup::get_setup_status(&ctx)
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
    oz_bridge::setup::seed_default_roles_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Dismiss the setup wizard without enabling any features.
///
/// Called when the user clicks "Skip setup". Only writes the
/// `show_setup_wizard = false` flag — no preset or features are saved.
#[tauri::command]
pub async fn dismiss_setup_wizard(state: State<'_, AppState>) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::setup::dismiss_setup_wizard(&ctx)
        .await
        .map_err(Into::into)
}

#[cfg(test)]
#[path = "setup_tests.rs"]
mod tests;
