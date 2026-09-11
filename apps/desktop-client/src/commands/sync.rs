//! Cloud sync commands — configure and trigger sync from the UI.
//!
//! The `sync_run` command runs a push cycle immediately (instead of
//! waiting for the background daemon's interval). `sync_pull` fetches
//! the server's snapshot of products / tax rates / users and replaces
//! the local cache. The settings commands let the user configure the
//! server URL and API key.
//!
//! Wave F: thirteen of the sixteen commands live in the headless
//! `oz_bridge::sync` module. Each `#[tauri::command]` below keeps its exact
//! name, parameter list and `Result<_, AppError>` return, so the registered
//! IPC surface and the serialized error shape are unchanged; a shim borrows a
//! `BridgeCtx` from `AppState`, calls the bridge and maps `BridgeError` back
//! to `AppError` variant-for-variant. The three `pg_sync_*` commands KEEP
//! THEIR BODIES HERE — they drive the `PgSyncDaemon` handle on `AppState`,
//! which lives in `platform-sync`, a crate the bridge does not depend on; the
//! same goes for `settings_changed_sink`, which the shell's lib.rs uses to
//! build that daemon's sink. The DTOs moved to the bridge and come back
//! through `pub use`; the free functions `sync_tests.rs` calls directly stay
//! as `AppError`-returning adapters over the bridge originals.

use std::sync::Arc;

use rusqlite::Connection;
use tauri::{Emitter, State};

use oz_core::events::SettingsUpdated;
#[allow(unused_imports)] // sibling sync_tests.rs depends on it
use oz_core::settings::Settings;
use oz_core::sync_client::{self, PullResult, SyncAttemptResult};
use platform_sync::daemon::SettingsChangedSink;
use platform_sync::pg_daemon::PgDaemonStatus;

use crate::commands::authz::require_permission_for_session;
use crate::error::AppError;
use crate::state::AppState;
use oz_core::permissions;

pub use oz_bridge::sync::{
    PgSyncSettingsDto, SyncPullArgs, SyncSettingsDto, UpdatePgSyncSettingsArgs,
    UpdateSyncSettingsArgs,
};

/// Get sync settings resolved from a session token. ADR #7.
#[tauri::command]
pub async fn get_sync_settings_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<SyncSettingsDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::sync::get_sync_settings_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Update sync settings.
#[tauri::command]
pub async fn update_sync_settings(
    args: UpdateSyncSettingsArgs,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::sync::update_sync_settings(&ctx, args)
        .await
        .map_err(Into::into)
}

/// Persist sync settings (server URL, API key, enabled flag) atomically.
///
/// All three writes execute inside a single SQLite transaction so a
/// failure on any one rolls back the others — the same atomicity fix the
/// tablet client landed. Clearing the server URL (passing `null` or an
/// empty string) writes an EMPTY row rather than deleting it: that
/// row-presence contract is what `sync_bootstrap::should_auto_provision`
/// relies on to distinguish a cleared+disabled install from a fresh one.
///
/// Adapter over `oz_bridge::sync::update_sync_settings_data`: the name,
/// parameter list and `AppError` return are unchanged so `sync_tests.rs`
/// keeps exercising the atomicity + clearing contract without a Tauri runtime.
#[allow(dead_code)] // retained by the Wave-F extraction contract for sibling sync_tests.rs
pub fn update_sync_settings_data(
    conn: &Connection,
    args: &UpdateSyncSettingsArgs,
) -> Result<(), AppError> {
    oz_bridge::sync::update_sync_settings_data(conn, args).map_err(Into::into)
}

// ── PostgreSQL sync settings & daemon commands ──────────────────

/// Business logic for `get_pg_sync_settings` (extracted for testing).
///
/// Adapter over `oz_bridge::sync::run_get_pg_sync_settings`, kept
/// `AppError`-returning for `sync_tests.rs`.
#[allow(dead_code)] // retained by the Wave-F extraction contract for sibling sync_tests.rs
fn run_get_pg_sync_settings(conn: &Connection) -> Result<PgSyncSettingsDto, AppError> {
    oz_bridge::sync::run_get_pg_sync_settings(conn).map_err(Into::into)
}

/// Persist PG sync settings atomically in a single transaction.
///
/// Extracted as a free function so the persistence contract (optional
/// field clearing + password preservation) can be tested without a Tauri
/// runtime, mirroring `update_sync_settings_data`.
#[allow(dead_code)] // retained by the Wave-F extraction contract for sibling sync_tests.rs
pub fn update_pg_sync_settings_data(
    conn: &Connection,
    args: &UpdatePgSyncSettingsArgs,
) -> Result<(), AppError> {
    oz_bridge::sync::update_pg_sync_settings_data(conn, args).map_err(Into::into)
}

/// SYNC-10 settings sink shared by the SQLite and PG daemons: a settings
/// change applied by sync is re-emitted as the `settings_updated` Tauri
/// event (the same wire shape the frontend SettingsContext listens for)
/// so the UI refetches the changed scope. Local saves already publish the
/// domain event; this closes the loop for the sync-applied path.
pub fn settings_changed_sink(app: &tauri::AppHandle) -> SettingsChangedSink {
    let app_handle = app.clone();
    Arc::new(move |event: &SettingsUpdated| {
        let payload = serde_json::json!({
            "changed_keys": event.changed_keys,
            "terminal_id": event.terminal_id,
        });
        let _ = app_handle.emit("settings_updated", payload);
    })
}

/// Resolve the URL used by the status-bar health probe.
///
/// Explicitly supplied and persisted URLs always win. The debug-only local
/// fallback is intentionally added here rather than in the frontend so the
/// status indicator can recover even while auto-provisioning is still writing
/// the persisted settings row.
#[allow(dead_code)] // retained by the Wave-F extraction contract for sibling sync_tests.rs
fn resolve_sync_probe_url(
    candidate: Option<String>,
    saved: Option<String>,
    allow_local_fallback: bool,
) -> Option<String> {
    oz_bridge::sync::resolve_sync_probe_url(candidate, saved, allow_local_fallback)
}

/// Reject a pull that lacks explicit destructive consent (H-2).
///
/// Extracted as a free function so the consent gate can be unit-tested
/// without a Tauri runtime.
#[allow(dead_code)] // retained by the Wave-F extraction contract for sibling sync_tests.rs
fn validate_pull_consent(args: &SyncPullArgs) -> Result<(), AppError> {
    oz_bridge::sync::validate_pull_consent(args).map_err(Into::into)
}

// ── Scoped variants (ADR #7) ────────────────────────────────────

/// Update sync settings (scoped).
#[tauri::command]
pub async fn update_sync_settings_scoped(
    args: UpdateSyncSettingsArgs,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::sync::update_sync_settings_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

/// Get PG sync settings (scoped).
#[tauri::command]
pub async fn get_pg_sync_settings_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<PgSyncSettingsDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::sync::get_pg_sync_settings_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Update PG sync settings (scoped).
#[tauri::command]
pub async fn update_pg_sync_settings_scoped(
    args: UpdatePgSyncSettingsArgs,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::sync::update_pg_sync_settings_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

/// PG sync status (scoped).
#[tauri::command]
pub async fn pg_sync_status_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<PgDaemonStatus, AppError> {
    state.resolve_scope(&session_token)?;
    Ok(state.pg_sync_daemon.status().await)
}

/// PG sync start (scoped).
#[tauri::command]
pub async fn pg_sync_start_scoped(
    app_handle: tauri::AppHandle,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    // F-017: starting/stopping the sync daemon is administrative.
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SYNC_MANAGE).await?;
    state.resolve_scope(&session_token)?;
    let db = state.db.clone();
    let sink = settings_changed_sink(&app_handle);
    state.pg_sync_daemon.start_with_sink(db, sink).await;
    Ok(())
}

/// PG sync stop (scoped).
#[tauri::command]
pub async fn pg_sync_stop_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    // F-017: starting/stopping the sync daemon is administrative.
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SYNC_MANAGE).await?;
    state.resolve_scope(&session_token)?;
    state.pg_sync_daemon.stop().await;
    Ok(())
}

/// Pending sync count (scoped).
#[tauri::command]
pub async fn pending_sync_count_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<i64, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::sync::pending_sync_count_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Request a sync token (scoped).
#[tauri::command]
pub async fn request_sync_token_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<sync_client::TokenResult, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::sync::request_sync_token_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Get sync plan (scoped).
#[tauri::command]
pub async fn get_sync_plan_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<sync_client::TenantPlanResult, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::sync::get_sync_plan_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Test the cloud sync connection by pinging the configured server
/// (pre-session, no authentication required). Falls back to the cloud
/// probe URL when no URL is saved, so the login screen's sync indicator
/// works out of the box.
#[tauri::command]
pub async fn test_sync_connection(
    state: State<'_, AppState>,
) -> Result<sync_client::PingResult, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::sync::test_sync_connection(&ctx)
        .await
        .map_err(Into::into)
}

/// Test sync connection (scoped).
#[tauri::command]
pub async fn test_sync_connection_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<sync_client::PingResult, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::sync::test_sync_connection_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Sync run (scoped — 3-phase with auth refresh).
#[tauri::command]
pub async fn sync_run_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<SyncAttemptResult, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::sync::sync_run_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Sync pull (scoped — 4-phase with auth refresh + backup).
#[tauri::command]
pub async fn sync_pull_scoped(
    args: SyncPullArgs,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<PullResult, AppError> {
    let ctx = state.bridge_ctx();
    let db_path = state.db_path.clone();
    oz_bridge::sync::sync_pull_scoped(&ctx, &session_token, args, &db_path)
        .await
        .map_err(Into::into)
}

/// Settings changed sink (scoped — no-op for session-validated callers).
#[tauri::command]
pub async fn settings_changed_sink_scoped(
    _key: String,
    _value: Option<String>,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::sync::settings_changed_sink_scoped(&ctx, &session_token, &_key, _value)
        .await
        .map_err(Into::into)
}

#[cfg(test)]
#[path = "sync_tests.rs"]
mod tests;
