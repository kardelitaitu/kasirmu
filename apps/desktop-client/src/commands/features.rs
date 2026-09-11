/*
last audited 12-07-27 by C-2 env-var fix
crate: oz-pos-app | status: SAFE (C-2 resolved) | lint: CLEAN
findings: unsafe env::set_var removed from async command path; terminal_id written via AppState field | next: typed setter in AppState + tokio::sync::watch; callers migrate | perf: not in request hot path; concurrency is the concern
*/

//! Feature flag management Tauri commands.
//!
//! Exposes `list_all_features` (returns all 32 features with enabled
//! status and metadata) and `set_feature` (toggle a single feature on
//! or off with automatic dependency resolution).
//!
//! The front-end consumes these via the Feature Toggle screen
//! (Settings → Features) so users can enable/disable capabilities
//! after the initial Setup Wizard.
//!
//! Wave F: the command bodies live in `oz_bridge::features`. Kept here are the
//! tauri-facing shims (headers byte-identical), the DTO re-exports and the two
//! helpers that `features_tests.rs` calls directly.

use tauri::State;

use oz_core::Feature;

use crate::error::AppError;
use crate::state::AppState;

pub use oz_bridge::features::{
    FeatureDto, ListAllFeaturesResult, SetFeatureArgs, SetFeatureResult, SetFeaturesBulkArgs,
};

#[allow(dead_code)] // features_tests.rs calls this helper directly
fn feature_to_module_id(feature: Feature) -> Option<&'static str> {
    oz_bridge::features::feature_to_module_id(feature)
}

#[allow(dead_code)] // features_tests.rs calls this helper directly
fn all_feature_metadata() -> Vec<(Feature, &'static str, &'static str, &'static str)> {
    oz_bridge::features::all_feature_metadata()
}

#[cfg(test)]
#[path = "features_tests.rs"]
mod tests;

/// Fetch every known feature with its current enabled status, metadata,
/// and dependency information.
///
/// The front-end renders this into the Feature Toggle screen.
#[tauri::command]
pub async fn list_all_features(
    state: State<'_, AppState>,
) -> Result<ListAllFeaturesResult, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::features::list_all_features(&ctx)
        .await
        .map_err(Into::into)
}

/// Enable or disable multiple feature flags atomically in a single
/// SQLite transaction.
///
/// Unlike `set_feature`, this bulk operation:
/// - Executes all changes in a single SQLite transaction
/// - Does NOT run kernel module lifecycle (use individual `set_feature`
///   for module-backed features that need start/stop)
/// - Does NOT cascade auto-enable dependencies (each feature is toggled
///   individually; call `set_feature` if dependency resolution is needed)
/// - Returns `ListAllFeaturesResult` so the front-end can refresh its
///   display with a single response
///
/// This is intended for bulk group toggles in the Feature Toggle screen
/// (e.g. "Enable all Hardware", "Disable all Advanced").
#[tauri::command]
pub async fn set_features_bulk(
    session_token: String,
    args: SetFeaturesBulkArgs,
    state: State<'_, AppState>,
) -> Result<ListAllFeaturesResult, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::features::set_features_bulk(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

/// Enable or disable a single feature flag.
///
/// When enabling, all required dependencies are automatically enabled
/// as well. When disabling, only the specified feature is turned off
/// (dependents are NOT cascaded — the UI must handle that).
///
/// When the feature corresponds to a registered kernel module, the
/// module is started (on enable) or stopped (on disable) via
/// `kernel.start_module` / `kernel.stop_module`. Module lifecycle
/// failures are logged but do not prevent the feature toggle from
/// succeeding — the feature registry is persisted regardless.
#[tauri::command]
pub async fn set_feature(
    session_token: String,
    args: SetFeatureArgs,
    state: State<'_, AppState>,
) -> Result<SetFeatureResult, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::features::set_feature(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

/// Session-scoped variant of [`list_all_features`].
#[tauri::command]
pub async fn list_all_features_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<ListAllFeaturesResult, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::features::list_all_features_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}
