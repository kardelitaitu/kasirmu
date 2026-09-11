//! Table management Tauri commands.
//!
//! CRUD for restaurant floor-plan tables plus section listing.
//!
//! All commands have scoped variants (ADR #7) that use the session token
//! pattern. Old commands are preserved with deprecation notices.

// Wave F: the bodies moved to oz_bridge::tables. The three read commands
// stay GATE-FREE (no permission check by design — resolve_store alone);
// the six write commands keep their TABLES_* gates in the bridge fn.

use oz_core::Table;
#[allow(unused_imports)] // sibling tables_tests.rs depends on it
use oz_core::db::Store;
use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

// ── Read Commands ────────────────────────────────────────────────────

/// List tables for the store resolved from a session token. ADR #7.
#[tauri::command]
pub async fn list_tables_scoped(
    session_token: String,
    section: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<Table>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::tables::list_tables_scoped(&ctx, &session_token, section)
        .await
        .map_err(Into::into)
}

/// Get a table from the store resolved from a session token. ADR #7.
#[tauri::command]
pub async fn get_table_scoped(
    session_token: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<Option<Table>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::tables::get_table_scoped(&ctx, &session_token, &id)
        .await
        .map_err(Into::into)
}

/// List sections for the store resolved from a session token. ADR #7.
#[tauri::command]
pub async fn list_sections_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<String>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::tables::list_sections_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

// ── Write Commands ───────────────────────────────────────────────────

/// Create a table in the store resolved from a session token. ADR #7.
#[tauri::command]
pub async fn create_table_scoped(
    session_token: String,
    table: Table,
    state: State<'_, AppState>,
) -> Result<Table, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::tables::create_table_scoped(&ctx, &session_token, table)
        .await
        .map_err(Into::into)
}

/// Update a table in the store resolved from a session token. ADR #7.
#[tauri::command]
pub async fn update_table_scoped(
    session_token: String,
    table: Table,
    state: State<'_, AppState>,
) -> Result<Table, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::tables::update_table_scoped(&ctx, &session_token, table)
        .await
        .map_err(Into::into)
}

/// Delete a table in the store resolved from a session token. ADR #7.
#[tauri::command]
pub async fn delete_table_scoped(
    session_token: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::tables::delete_table_scoped(&ctx, &session_token, &id)
        .await
        .map_err(Into::into)
}

/// Update a table's status in the store resolved from a session token. ADR #7.
#[tauri::command]
pub async fn update_table_status_scoped(
    session_token: String,
    id: String,
    status: String,
    state: State<'_, AppState>,
) -> Result<Table, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::tables::update_table_status_scoped(&ctx, &session_token, &id, &status)
        .await
        .map_err(Into::into)
}

/// Assign an order to a table in the store resolved from a session token. ADR #7.
#[tauri::command]
pub async fn assign_table_order_scoped(
    session_token: String,
    table_id: String,
    sale_id: String,
    state: State<'_, AppState>,
) -> Result<Table, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::tables::assign_table_order_scoped(&ctx, &session_token, &table_id, &sale_id)
        .await
        .map_err(Into::into)
}

/// Release a table in the store resolved from a session token. ADR #7.
#[tauri::command]
pub async fn release_table_scoped(
    session_token: String,
    table_id: String,
    state: State<'_, AppState>,
) -> Result<Table, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::tables::release_table_scoped(&ctx, &session_token, &table_id)
        .await
        .map_err(Into::into)
}

#[cfg(test)]
#[path = "tables_tests.rs"]
mod tests;
