//! Tauri commands for product bundles (ADR #7 scoped variants).
//!
//! Wave F: every body lives in the headless `kasirmu_bridge::bundles` module. Each
//! `#[tauri::command]` below keeps its exact name, parameter list and
//! `Result<_, AppError>` return; it borrows a `BridgeCtx` from `AppState`,
//! calls the bridge and maps `BridgeError` back to `AppError`
//! variant-for-variant. The args structs moved with the bodies and are
//! re-exported so `use super::*;` in `bundles_tests.rs` still resolves them.

use tauri::State;

use oz_core::product_bundle::BundleWithItems;

use crate::error::AppError;
use crate::state::AppState;

pub use kasirmu_bridge::bundles::{CreateBundleArgs, CreateBundleItemArg};

// ── Tests ──────────────────────────────────────────────────────────────

// ── Scoped variants (ADR #7) ────────────────────────────────────

/// Scoped variant of `list_bundles` (ADR #7).
#[tauri::command]
pub async fn list_bundles_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<BundleWithItems>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::bundles::list_bundles_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Scoped variant of `get_bundle` (ADR #7).
#[tauri::command]
pub async fn get_bundle_scoped(
    id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Option<BundleWithItems>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::bundles::get_bundle_scoped(&ctx, &session_token, &id)
        .await
        .map_err(Into::into)
}

/// Scoped variant of `update_bundle` (ADR #7).
#[tauri::command]
pub async fn update_bundle_scoped(
    bundle: BundleWithItems,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<BundleWithItems, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::bundles::update_bundle_scoped(&ctx, &session_token, bundle)
        .await
        .map_err(Into::into)
}

/// Scoped variant of `delete_bundle` (ADR #7).
#[tauri::command]
pub async fn delete_bundle_scoped(
    id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::bundles::delete_bundle_scoped(&ctx, &session_token, &id)
        .await
        .map_err(Into::into)
}

/// Scoped variant of `lookup_bundle_by_sku` (ADR #7).
#[tauri::command]
pub async fn lookup_bundle_by_sku_scoped(
    sku: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Option<BundleWithItems>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::bundles::lookup_bundle_by_sku_scoped(&ctx, &session_token, &sku)
        .await
        .map_err(Into::into)
}

/// Create a new bundle (scoped).
#[tauri::command]
pub async fn create_bundle_scoped(
    args: CreateBundleArgs,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<BundleWithItems, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::bundles::create_bundle_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}
