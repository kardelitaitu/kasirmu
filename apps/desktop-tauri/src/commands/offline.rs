//! Offline queue commands.
//!
//! These commands allow the front-end to enqueue, list, and sync
//! transactions that were created while the network was unavailable.

//!
//! Wave F: the command bodies live in `kasirmu_bridge::offline`. Kept here are the
//! `#[tauri::command]` shims (headers byte-identical), the DTO re-exports and
//! the three `run_*` AppError adapters that `offline_tests.rs` calls directly.
//! The test mount keeps its original MID-FILE position between those helpers
//! and the scoped command variants — it was deliberately not moved to the foot.

use tauri::State;

use kasirmu_core::permissions;

use crate::commands::authz::require_permission_for_session;
use crate::error::AppError;
use crate::state::AppState;

pub use kasirmu_bridge::offline::{
    EnqueueOfflineArgs, OfflineQueueItemDto, OfflineQueueSummaryDto, RemoteSyncFailureDto,
    RequeueRemoteFailureArgs, SyncResult,
};

#[allow(dead_code)] // offline_tests.rs calls this helper directly and matches AppError::Core
fn run_list_pending_offline(
    conn: &rusqlite::Connection,
) -> Result<Vec<OfflineQueueItemDto>, AppError> {
    kasirmu_bridge::offline::run_list_pending_offline(conn).map_err(Into::into)
}

#[allow(dead_code)] // offline_tests.rs calls this helper directly and matches AppError::Core
fn run_requeue_remote_failure(conn: &rusqlite::Connection, item_id: &str) -> Result<(), AppError> {
    kasirmu_bridge::offline::run_requeue_remote_failure(conn, item_id).map_err(Into::into)
}

#[allow(dead_code)] // offline_tests.rs calls this helper directly and matches AppError::Core
fn run_list_remote_failures(
    conn: &rusqlite::Connection,
) -> Result<Vec<RemoteSyncFailureDto>, AppError> {
    kasirmu_bridge::offline::run_list_remote_failures(conn).map_err(Into::into)
}

/// Enqueue a transaction for later sync (scoped).
#[tauri::command]
pub async fn enqueue_offline_scoped(
    args: EnqueueOfflineArgs,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<OfflineQueueItemDto, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::offline::enqueue_offline_scoped(&ctx, args, &session_token)
        .await
        .map_err(Into::into)
}

/// List all pending (unsynced) offline queue items (scoped).
#[tauri::command]
pub async fn list_pending_offline_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<OfflineQueueItemDto>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::offline::list_pending_offline_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// List all offline queue items (scoped).
#[tauri::command]
pub async fn list_all_offline_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<OfflineQueueItemDto>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::offline::list_all_offline_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Get a summary of the offline queue status (scoped).
#[tauri::command]
pub async fn offline_queue_status_summary_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<OfflineQueueSummaryDto, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::offline::offline_queue_status_summary_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Get the count of pending offline items (scoped).
#[tauri::command]
pub async fn pending_offline_count_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<i64, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::offline::pending_offline_count_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Attempt to sync all pending offline items (scoped).
#[tauri::command]
pub async fn retry_offline_sync_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<SyncResult, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::offline::retry_offline_sync_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Delete a processed offline queue item (scoped).
#[tauri::command]
pub async fn delete_offline_item_scoped(
    id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::offline::delete_offline_item_scoped(&ctx, id, &session_token)
        .await
        .map_err(Into::into)
}

/// Requeue a dead-lettered remote item (scoped).
#[tauri::command]
pub async fn requeue_remote_failure_scoped(
    args: RequeueRemoteFailureArgs,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::offline::requeue_remote_failure_scoped(&ctx, args, &session_token)
        .await
        .map_err(Into::into)
}

/// List retained remote-application failures (dead-letter discovery) resolved from a session token. ADR #7.
///
/// Requires `SYNC_MANAGE` — a manager-only view. The bridge twin is ungated
/// (`ungated-ok: documented split`), so the gate is enforced here rather than
/// via delegation.
#[tauri::command]
pub async fn list_remote_failures_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<RemoteSyncFailureDto>, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SYNC_MANAGE).await?;
    let conn_arc = state.resolve_store(&session_token)?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let failures = run_list_remote_failures(db)?;
    let _ = db;
    Ok(failures)
}
