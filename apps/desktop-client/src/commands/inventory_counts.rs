//! Tauri commands for physical inventory / stock counting.
//!
//! Wave C / C2: the bodies live in the headless
//! `oz_bridge::inventory_counts` module. Each `#[tauri::command]` below
//! keeps its exact name, parameter list and `Result<_, AppError>` return so
//! the registered IPC surface and the serialized error shape are unchanged;
//! it borrows a `BridgeCtx` from `AppState`, calls the bridge, and maps
//! `BridgeError` back to `AppError` variant-for-variant. The DTOs and args
//! moved with the bodies and are re-exported so `use super::*` in
//! `inventory_counts_tests.rs` still resolves them.
//!
//! Gate order runs inside the bridge, in the same order as before: resolve
//! the session scope, authorize against the GLOBAL identity DB
//! (non-scope-aware `Store::require_permission`, as the shell used for this
//! domain), then open the store-scoped connection. Stock-count commands
//! resolve the store and actor from the opaque session token.

#[allow(unused_imports)] // sibling inventory_counts_tests.rs depends on it
use oz_core::Store;
use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

pub use oz_bridge::inventory_counts::{
    AddCountLineArgs, CompleteStockCountArgs, CreateStockCountArgs, RemoveCountLineArgs,
    StockAdjustmentDto, StockCountDto, StockCountLineDto, UpdateCountLineArgs,
};

/// Validate a physical quantity and reject negative values at the command boundary.
///
/// Thin adapter over `oz_bridge::inventory_counts::validate_quantity`: the
/// name, parameter list and `Result<_, AppError>` type are unchanged so the
/// sibling test module keeps matching on `AppError::Invalid`.
#[allow(dead_code)] // retained by the Wave-C C2 extraction contract for sibling tests
fn validate_quantity(field: &'static str, quantity: i64) -> Result<(), AppError> {
    oz_bridge::inventory_counts::validate_quantity(field, quantity).map_err(AppError::from)
}

/// Create a stock count in the session's store and attribute it to the session user.
#[tauri::command]
pub async fn create_stock_count_scoped(
    session_token: String,
    args: CreateStockCountArgs,
    state: State<'_, AppState>,
) -> Result<StockCountDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::inventory_counts::create_stock_count_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

/// Fetch one stock count from the session's store.
#[tauri::command]
pub async fn get_stock_count_scoped(
    session_token: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<Option<StockCountDto>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::inventory_counts::get_stock_count_scoped(&ctx, &session_token, &id)
        .await
        .map_err(Into::into)
}

/// List stock counts from the session's store.
#[tauri::command]
pub async fn list_stock_counts_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<StockCountDto>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::inventory_counts::list_stock_counts_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Fetch lines from a count in the session's store.
#[tauri::command]
pub async fn get_count_lines_scoped(
    session_token: String,
    count_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<StockCountLineDto>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::inventory_counts::get_count_lines_scoped(&ctx, &session_token, &count_id)
        .await
        .map_err(Into::into)
}

/// Add a line to an editable count in the session's store.
#[tauri::command]
pub async fn add_count_line_scoped(
    session_token: String,
    args: AddCountLineArgs,
    state: State<'_, AppState>,
) -> Result<StockCountLineDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::inventory_counts::add_count_line_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

/// Update a line belonging to an editable count in the session's store.
#[tauri::command]
pub async fn update_count_line_scoped(
    session_token: String,
    args: UpdateCountLineArgs,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::inventory_counts::update_count_line_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

/// Remove a line belonging to an editable count in the session's store.
#[tauri::command]
pub async fn remove_count_line_scoped(
    session_token: String,
    args: RemoveCountLineArgs,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::inventory_counts::remove_count_line_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

/// Complete a count and attribute generated adjustments to the session user.
#[tauri::command]
pub async fn complete_stock_count_scoped(
    session_token: String,
    args: CompleteStockCountArgs,
    state: State<'_, AppState>,
) -> Result<Vec<StockAdjustmentDto>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::inventory_counts::complete_stock_count_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

/// Move an editable count to `in_progress` or `cancelled`.
#[tauri::command]
pub async fn update_stock_count_status_scoped(
    session_token: String,
    id: String,
    status: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::inventory_counts::update_stock_count_status_scoped(
        &ctx,
        &session_token,
        &id,
        &status,
    )
    .await
    .map_err(Into::into)
}

/// List adjustments from the session's store.
#[tauri::command]
pub async fn list_stock_adjustments_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<StockAdjustmentDto>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::inventory_counts::list_stock_adjustments_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

// ── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "inventory_counts_tests.rs"]
mod tests;
