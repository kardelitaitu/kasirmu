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

use kasirmu_core::db::Store;
use kasirmu_core::permissions;

use crate::commands::authz::require_permission_for_session;
use crate::error::AppError;
use crate::state::AppState;

pub use kasirmu_bridge::data::{
    BackupResult, BackupStatus, ExportDataArgs, ExportDataResult, ImportDataArgs, ImportDataResult,
    ImportPreviewArgs, ImportPreviewResult, ListRestoreCandidatesResult, RestorePrepareArgs,
    RestorePrepareResult, RestoreStatus,
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
/// Export data WITHOUT a session — the read-only local twin (ADR #58 §4a Q-A option 3).
///
/// Registered so a revoked tenant can still retrieve their own data once §2.5 locks
/// them out of every session-gated path. Read-only and local-only by construction: it
/// shares `export_data`'s body, so it cannot import, mutate, or reach the network.
pub async fn export_data_without_session(
    args: ExportDataArgs,
    state: State<'_, AppState>,
) -> Result<ExportDataResult, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::data::export_data_without_session(&ctx, args)
        .await
        .map_err(Into::into)
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

// ── C8 S5a: the restore surface, now reachable over IPC ───────────

/// List the backup generations beside the live database, each with its verdict.
///
/// Read-only, so it takes `SETTINGS_READ` rather than the write permission
/// `restore_prepare` requires — the read/write split of the same permission
/// family. It does resolve a session, because the registration sweep counts a
/// command that resolves none as an UNGATED door, and an ungated door onto the
/// recovery surface is what this slice exists to avoid. The bridge function
/// behind it takes no token by design (a pure read); the gate belongs on the
/// renderer-reachable path, which is this wrapper.
#[tauri::command]
pub async fn list_restore_candidates(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<ListRestoreCandidatesResult, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SETTINGS_READ).await?;
    let db_path = state.db_path.clone();
    kasirmu_bridge::data::list_restore_candidates(&db_path)
        .await
        .map_err(Into::into)
}

/// Report whether a restore request is pending beside the live database.
///
/// Read-only, gated on `SETTINGS_READ` — deliberately NOT the `SETTINGS_EDIT`
/// that `restore_prepare` needs, so an operator who may see that a restore is
/// pending does not thereby gain the right to request one. It reads one JSON
/// file and mutates nothing.
#[tauri::command]
pub async fn restore_status(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<RestoreStatus, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SETTINGS_READ).await?;
    let db_path = state.db_path.clone();
    kasirmu_bridge::data::restore_status(&db_path)
        .await
        .map_err(Into::into)
}

/// Request a restore of the named candidate on the next boot.
///
/// THIS COMMAND IS GATED, and the gate is the point of the slice: it writes
/// `<db>.restore-request.json`, which the boot consumer (slice S4) promotes
/// before anything opens the database. A wrapper that forwarded without
/// checking would hand the renderer a way to replace the database — so the
/// session is resolved and `SETTINGS_EDIT` is required HERE, in the wrapper
/// body, before the bridge is called.
///
/// The bridge enforces the same permission inside `restore_prepare`; this is
/// deliberately not a duplicate-but-independent check but the same gate on the
/// path the renderer actually takes, which is what the registration sweep
/// reads (`resolves_session` + a named permission in this wrapper). The bridge
/// check stays authoritative for every other caller (the CLI, future lanes).
///
/// The restore is REFUSED rather than queued: a candidate that fails validation
/// or a typed store name that does not match the candidate's own `store.name`
/// returns an error and writes no request file (runbook §11.2, §11.6).
#[tauri::command]
pub async fn restore_prepare(
    session_token: String,
    args: RestorePrepareArgs,
    state: State<'_, AppState>,
) -> Result<RestorePrepareResult, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SETTINGS_EDIT).await?;
    let ctx = state.bridge_ctx();
    let db_path = state.db_path.clone();
    kasirmu_bridge::data::restore_prepare(&ctx, &session_token, &db_path, args)
        .await
        .map_err(Into::into)
}

#[cfg(test)]
#[path = "data_tests.rs"]
mod tests;
