//! Data management commands: backup, restore, export .kasirpkg, import .kasirpkg.
//!
//! Wave F: the bodies now live in the headless `kasirmu_bridge::data` module. Each
//! `#[tauri::command]` below keeps its exact name, attribute set, parameter list
//! and `Result<_, AppError>` wire contract; it builds a `BridgeCtx` from
//! `AppState` and delegates. `AppState::db_path` is the one value the bridge cannot
//! reach, so the backup pair and its two scoped twins clone it here and pass it
//! down as `&Path`; `default_backup_path` itself moved with the bodies, so the
//! `backup.db` derivation is unchanged and still shared by all four commands. Gate
//! kind and order (`resolve_session` then the SETTINGS_EDIT / DATA_EXPORT check), the
//! pre-transaction position of both quota gates, the single transaction
//! boundary and every error string are byte-identical. The eight DTOs moved
//! and are re-exported so the sibling `data_tests.rs` still names them (including
//! the M-7 assertion that `BackupStatus` never carries a path), and the three
//! helpers that file calls stay as `AppError` adapters.

use tauri::State;

use oz_core::db::Store;

use crate::error::AppError;
use crate::state::AppState;

pub use kasirmu_bridge::data::{
    BackupResult, BackupStatus, ExportDataArgs, ExportDataResult, ImportDataArgs, ImportDataResult,
    ImportPreviewArgs, ImportPreviewResult,
};

// ── Commands ──────────────────────────────────────────────────────

#[tauri::command]
/// Get backup status.
pub async fn get_backup_status(state: State<'_, AppState>) -> Result<BackupStatus, AppError> {
    let db_path = state.db_path.clone();
    kasirmu_bridge::data::get_backup_status(&db_path)
        .await
        .map_err(Into::into)
}

#[tauri::command]
/// Create backup.
pub async fn create_backup(state: State<'_, AppState>) -> Result<BackupResult, AppError> {
    let ctx = state.bridge_ctx();
    let db_path = state.db_path.clone();
    kasirmu_bridge::data::create_backup(&ctx, &db_path)
        .await
        .map_err(Into::into)
}

/// Adapter over `kasirmu_bridge::data::exportable_settings_rows`; the redaction rule moved
/// with the export body.
#[allow(dead_code)] // retained by the Wave-F extraction contract for sibling tests
fn exportable_settings_rows(rows: Vec<(String, String)>) -> Vec<serde_json::Value> {
    kasirmu_bridge::data::exportable_settings_rows(rows)
}

#[tauri::command]
/// Export data.
pub async fn export_data(
    session_token: String,
    args: ExportDataArgs,
    state: State<'_, AppState>,
) -> Result<ExportDataResult, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::data::export_data(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

#[tauri::command]
/// Import preview.
pub async fn import_preview(
    session_token: String,
    args: ImportPreviewArgs,
    state: State<'_, AppState>,
) -> Result<ImportPreviewResult, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::data::import_preview(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

/// AppError adapter over `kasirmu_bridge::data::gate_import_product_batch` — retained
/// because the sibling tests drive this exact production decision.
#[allow(dead_code)] // retained by the Wave-F extraction contract for sibling tests
pub(crate) fn gate_import_product_batch(
    store: &Store<'_>,
    products: &[serde_json::Value],
) -> Result<i64, AppError> {
    kasirmu_bridge::data::gate_import_product_batch(store, products).map_err(Into::into)
}

/// AppError adapter over `kasirmu_bridge::data::gate_import_user_batch`.
#[allow(dead_code)] // retained by the Wave-F extraction contract for sibling tests
pub(crate) fn gate_import_user_batch(
    store: &Store<'_>,
    users: &[serde_json::Value],
) -> Result<i64, AppError> {
    kasirmu_bridge::data::gate_import_user_batch(store, users).map_err(Into::into)
}

#[tauri::command]
/// Import data.
pub async fn import_data(
    session_token: String,
    args: ImportDataArgs,
    state: State<'_, AppState>,
) -> Result<ImportDataResult, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::data::import_data(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

#[tauri::command]
/// Session-scoped variant of `get_backup_status`.
pub async fn get_backup_status_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<BackupStatus, AppError> {
    let ctx = state.bridge_ctx();
    let db_path = state.db_path.clone();
    kasirmu_bridge::data::get_backup_status_scoped(&ctx, &session_token, &db_path)
        .await
        .map_err(Into::into)
}

#[tauri::command]
/// Session-scoped variant of `create_backup`.
pub async fn create_backup_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<BackupResult, AppError> {
    let ctx = state.bridge_ctx();
    let db_path = state.db_path.clone();
    kasirmu_bridge::data::create_backup_scoped(&ctx, &session_token, &db_path)
        .await
        .map_err(Into::into)
}
