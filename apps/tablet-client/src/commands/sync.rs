//! Cloud sync commands — configure and trigger sync from the UI.
//!
//! The `sync_run` command runs a sync cycle immediately (instead of
//! waiting for the background daemon's interval). The settings commands
//! let the user configure the server URL and API key.

use serde::{Deserialize, Serialize};
use tauri::{State, command};

use oz_core::db::Store;
use oz_core::permissions;
use oz_core::settings::Settings;
use oz_core::sync_client::{self, PullResult, SyncAttemptResult, SyncConfig};
use rusqlite::Connection;

use crate::commands::authz::require_permission_for_session;
use crate::error::AppError;
use crate::state::AppState;

/// Get the current sync configuration settings.
#[derive(Debug, Serialize)]
pub struct SyncSettingsDto {
    /// Server Url.
    pub server_url: Option<String>,
    /// Has Api Key.
    pub has_api_key: bool,
    /// Enabled.
    pub enabled: bool,
}

/// Get sync settings.
#[command]
pub async fn get_sync_settings(state: State<'_, AppState>) -> Result<SyncSettingsDto, AppError> {
    let db = state.db.lock().await;
    let server_url = Settings::get_sync_server_url(&db)?.filter(|s| !s.is_empty());
    let api_key = Settings::get_sync_api_key(&db)?.filter(|k| !k.is_empty());
    let enabled = Settings::is_sync_enabled(&db)?;
    drop(db);
    Ok(SyncSettingsDto {
        server_url,
        has_api_key: api_key.is_some(),
        enabled,
    })
}

/// Update sync settings.
#[derive(Debug, Deserialize)]
pub struct UpdateSyncSettingsArgs {
    /// Server Url.
    pub server_url: Option<String>,
    /// Api Key.
    pub api_key: Option<String>,
    /// Enabled.
    pub enabled: bool,
}

#[command]
/// Update sync settings.
pub async fn update_sync_settings(
    args: UpdateSyncSettingsArgs,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let db = state.db.lock().await;
    update_sync_settings_data(&db, &args)?;
    drop(db);
    Ok(())
}

/// Persist sync settings (server URL, API key, enabled flag) atomically.
///
/// All three writes execute inside a single SQLite transaction so a
/// failure on any one rolls back the others — preventing the
/// partially-updated state the previous sequential-write version could
/// leave behind (e.g. a new API key persisted while the `enabled` flag
/// still held its old value).
///
/// Extracted as a free function so the atomicity contract can be tested
/// without a Tauri runtime
/// (see `update_sync_settings_data_rolls_back_on_partial_failure`).
pub fn update_sync_settings_data(
    conn: &Connection,
    args: &UpdateSyncSettingsArgs,
) -> Result<(), AppError> {
    let tx = conn.unchecked_transaction()?;
    // Always update server URL (passing `null` or empty string clears it).
    let url = args.server_url.as_deref().unwrap_or("");
    Settings::set_sync_server_url(&tx, url)?;
    // Only update API key if `Some(key)` was passed from the UI.
    // When `args.api_key` is `None` (the masked API field on the front-end was not modified),
    // preserve the existing key stored in the database.
    if let Some(ref key) = args.api_key {
        Settings::set_sync_api_key(&tx, key)?;
    }
    Settings::set_sync_enabled(&tx, args.enabled)?;
    tx.commit()?;
    Ok(())
}

/// Immediately run a sync cycle that pushes pending sales, credit, and
/// other queued offline transactions to the configured cloud server.
///
/// Uses a three-phase split (read → async HTTP → write) so the DB
/// lock is not held during the network round-trip.
#[command]
pub async fn sync_run(state: State<'_, AppState>) -> Result<SyncAttemptResult, AppError> {
    // Phase 1: Read pending items and config from DB (brief lock).
    let (pending_items, config_opt) = {
        let db = state.db.lock().await;
        let store = Store::new(&db);
        let pending = store.list_pending_offline()?;
        let config = SyncConfig::from_settings(&store)?;
        (pending, config)
    };

    let config = match config_opt {
        Some(c) => c,
        None => {
            return Ok(SyncAttemptResult {
                synced: 0,
                failed: 0,
                error: Some("Sync is not configured or disabled".into()),
                plan_required: false,
            });
        }
    };

    if pending_items.is_empty() {
        return Ok(SyncAttemptResult {
            synced: 0,
            failed: 0,
            error: None,
            plan_required: false,
        });
    }

    // Phase 2: Async HTTP push (no DB lock held).
    let outcomes = sync_client::send_items_to_server(&config, &pending_items).await;

    // Phase 3: Write outcomes back to DB (brief lock).
    let db = state.db.lock().await;
    let store = Store::new(&db);
    match outcomes {
        Ok(outcomes) => Ok(sync_client::apply_sync_outcomes(
            &store,
            &pending_items,
            &outcomes,
        )?),
        // ADR sync-plan-gating: a free tenant is gated, not broken. Do NOT
        // mark the items failed — they stay `pending` and sync automatically
        // once the tenant upgrades.
        Err(sync_client::SyncHttpError::PlanRequired) => Ok(SyncAttemptResult {
            synced: 0,
            failed: 0,
            error: Some("cloud sync requires a paid plan".into()),
            plan_required: true,
        }),
        Err(e) => Ok(sync_client::mark_all_failed(
            &store,
            &pending_items,
            &e.to_string(),
        )?),
    }
}

/// Get the pending sync count.
#[command]
pub async fn pending_sync_count(state: State<'_, AppState>) -> Result<i64, AppError> {
    let db = state.db.lock().await;
    let store = Store::new(&db);
    let count = store.pending_offline_count()?;
    drop(db);
    Ok(count)
}

/// Request a new JWT API token from the cloud server's
/// `POST /api/v1/tokens` endpoint.
///
/// Uses the URL from the front-end text field if provided,
/// otherwise falls back to saved settings.
#[command]
pub async fn request_sync_token(
    url: Option<String>,
    state: State<'_, AppState>,
) -> Result<sync_client::TokenResult, AppError> {
    let resolved = match url.filter(|u| !u.is_empty()) {
        Some(u) => Some(u),
        None => {
            let db = state.db.lock().await;
            Settings::get_sync_server_url(&db)?.filter(|s| !s.is_empty())
        }
    };
    match resolved {
        Some(u) => {
            Ok(sync_client::request_token(&u, sync_client::admin_key_from_env().as_deref()).await)
        }
        None => Ok(sync_client::TokenResult {
            ok: false,
            token: None,
            status: "No server URL configured".into(),
            expires_at: None,
        }),
    }
}

/// Read the caller's own sync plan from the server (ADR sync-plan-gating).
///
/// Resolves URL + API key from settings, then calls `GET
/// /api/v1/tenants/me/plan`. The endpoint is not plan-gated, so a free
/// tenant can read its own plan to render the upgrade prompt without
/// running a sync.
#[command]
pub async fn get_sync_plan(
    state: State<'_, AppState>,
) -> Result<sync_client::TenantPlanResult, AppError> {
    // Resolve URL + API key first (brief DB lock), then drop the lock
    // before the async HTTP call.
    let (url, api_key) = {
        let db = state.db.lock().await;
        let store = Store::new(&db);
        let config = SyncConfig::from_settings(&store)?;
        match config {
            Some(c) => (Some(c.server_url), c.api_key),
            None => (None, None),
        }
    };
    match (url, api_key) {
        (Some(u), Some(key)) => Ok(sync_client::fetch_tenant_plan(&u, &key).await),
        _ => Ok(sync_client::TenantPlanResult {
            ok: false,
            plan: None,
            status: "Sync is not configured".into(),
        }),
    }
}

/// Test the cloud sync connection by pinging the configured server.
/// If `url` is provided from the front-end, it is used directly.
#[command]
pub async fn test_sync_connection(
    url: Option<String>,
    state: State<'_, AppState>,
) -> Result<sync_client::PingResult, AppError> {
    let resolved = match url.filter(|u| !u.is_empty()) {
        Some(u) => Some(u),
        None => {
            let db = state.db.lock().await;
            Settings::get_sync_server_url(&db)?.filter(|s| !s.is_empty())
        }
    };
    match resolved {
        Some(u) => Ok(sync_client::ping_server(&u).await),
        None => Ok(sync_client::PingResult {
            ok: false,
            status: "No server URL configured".into(),
            latency_ms: None,
        }),
    }
}

/// Arguments for `sync_pull`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncPullArgs {
    /// Must be `true` to proceed with the destructive pull.
    /// Prevents accidental local-data overwrite from UI double-clicks
    /// or programmatic calls without user consent (H-2).
    pub confirm_destructive: bool,
}

/// Reject a pull that lacks explicit destructive consent (H-2).
///
/// Extracted as a free function so the consent gate can be unit-tested
/// without a Tauri runtime.
fn validate_pull_consent(args: &SyncPullArgs) -> Result<(), AppError> {
    if !args.confirm_destructive {
        return Err(AppError::Invalid(
            "confirm_destructive must be true to proceed with sync pull".into(),
        ));
    }
    Ok(())
}

/// Pull a server snapshot and overwrite the local cache for products,
/// tax rates, and users. The UI is expected to confirm the overwrite
/// before invoking this command.
///
/// Uses a three-phase split (read → async HTTP → write) so the DB
/// lock is not held during the network round-trip.
#[command]
pub async fn sync_pull(
    args: SyncPullArgs,
    state: State<'_, AppState>,
) -> Result<PullResult, AppError> {
    validate_pull_consent(&args)?;
    // Phase 1: Read config from DB (brief lock).
    let config_opt = {
        let db = state.db.lock().await;
        let store = Store::new(&db);
        SyncConfig::from_settings(&store)?
    };

    let config = match config_opt {
        Some(c) => c,
        None => {
            return Ok(PullResult {
                products_pulled: 0,
                tax_rates_pulled: 0,
                users_pulled: 0,
                error: Some("Sync is not configured or disabled".into()),
            });
        }
    };

    // Phase 2: Async HTTP fetch (no DB lock held).
    let snapshot = sync_client::fetch_snapshot_from_server(&config).await;

    // Phase 3: Apply snapshot to DB (brief lock).
    let db = state.db.lock().await;
    let store = Store::new(&db);
    match snapshot {
        Ok(s) => Ok(sync_client::apply_snapshot(&store, &s)?),
        Err(e) => Ok(PullResult {
            products_pulled: 0,
            tax_rates_pulled: 0,
            users_pulled: 0,
            error: Some(e.to_string()),
        }),
    }
}

/// Session-scoped variant of `get_sync_settings`.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn get_sync_settings_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<SyncSettingsDto, AppError> {
    let (_session, conn_arc) = state.resolve_scope(&session_token)?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let server_url = Settings::get_sync_server_url(&db)?.filter(|s| !s.is_empty());
    let api_key = Settings::get_sync_api_key(&db)?.filter(|k| !k.is_empty());
    let enabled = Settings::is_sync_enabled(&db)?;
    drop(db);
    Ok(SyncSettingsDto {
        server_url,
        has_api_key: api_key.is_some(),
        enabled,
    })
}

/// Session-scoped variant of `update_sync_settings`.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn update_sync_settings_scoped(
    session_token: String,
    args: UpdateSyncSettingsArgs,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SYNC_MANAGE).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    update_sync_settings_data(&db, &args)?;
    drop(db);
    Ok(())
}

/// Session-scoped variant of `sync_run`.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn sync_run_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<SyncAttemptResult, AppError> {
    // Phase 1: Read pending items and config from DB (brief lock).
    let (pending_items, config_opt) = {
        let (session, conn_arc) = state.resolve_scope(&session_token)?;
        require_permission_for_session(&state, &session, permissions::SYNC_MANAGE).await?;
        let db_guard = conn_arc
            .lock()
            .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
        let db = &*db_guard;
        let store = Store::new(&db);
        let pending = store.list_pending_offline()?;
        let config = SyncConfig::from_settings(&store)?;
        (pending, config)
    };

    let config = match config_opt {
        Some(c) => c,
        None => {
            return Ok(SyncAttemptResult {
                synced: 0,
                failed: 0,
                error: Some("Sync is not configured or disabled".into()),
                plan_required: false,
            });
        }
    };

    if pending_items.is_empty() {
        return Ok(SyncAttemptResult {
            synced: 0,
            failed: 0,
            error: None,
            plan_required: false,
        });
    }

    // Phase 2: Async HTTP push (no DB lock held).
    let outcomes = sync_client::send_items_to_server(&config, &pending_items).await;

    // Phase 3: Write outcomes back to the SAME store database the pending
    // items were read from (brief lock, re-resolved after the HTTP await).
    //
    // This used to lock `state.db` — the global connection — so the marks
    // landed on a different file's `offline_queue` than the rows Phase 1
    // read: store items stayed `pending` forever while untouched global
    // rows were flipped, and `pending_sync_count_scoped` kept counting the
    // stranded store rows. Re-resolve the scope here rather than carrying
    // the Phase 1 guard across the `send_items_to_server` await — the
    // store manager's std::sync::Mutex guard is not Send, and the global
    // connection is the wrong file anyway.
    let (_session, conn_arc) = state.resolve_scope(&session_token)?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    match outcomes {
        Ok(outcomes) => Ok(sync_client::apply_sync_outcomes(
            &store,
            &pending_items,
            &outcomes,
        )?),
        // ADR sync-plan-gating: a free tenant is gated, not broken. Do NOT
        // mark the items failed — they stay `pending` and sync automatically
        // once the tenant upgrades.
        Err(sync_client::SyncHttpError::PlanRequired) => Ok(SyncAttemptResult {
            synced: 0,
            failed: 0,
            error: Some("cloud sync requires a paid plan".into()),
            plan_required: true,
        }),
        Err(e) => Ok(sync_client::mark_all_failed(
            &store,
            &pending_items,
            &e.to_string(),
        )?),
    }
}

/// Session-scoped variant of `pending_sync_count`.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn pending_sync_count_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<i64, AppError> {
    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SYNC_MANAGE).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    let count = store.pending_offline_count()?;
    drop(db);
    Ok(count)
}

/// Session-scoped variant of `request_sync_token`.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn request_sync_token_scoped(
    session_token: String,
    url: Option<String>,
    state: State<'_, AppState>,
) -> Result<sync_client::TokenResult, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SYNC_MANAGE).await?;
    let resolved = match url.filter(|u| !u.is_empty()) {
        Some(u) => Some(u),
        None => {
            let conn_arc = state
                .db_manager
                .open_store(&session.store_id)
                .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;
            let db_guard = conn_arc
                .lock()
                .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
            let db = &*db_guard;
            Settings::get_sync_server_url(&db)?.filter(|s| !s.is_empty())
        }
    };
    match resolved {
        Some(u) => {
            Ok(sync_client::request_token(&u, sync_client::admin_key_from_env().as_deref()).await)
        }
        None => Ok(sync_client::TokenResult {
            ok: false,
            token: None,
            status: "No server URL configured".into(),
            expires_at: None,
        }),
    }
}

/// Session-scoped variant of `get_sync_plan`.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn get_sync_plan_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<sync_client::TenantPlanResult, AppError> {
    // Resolve URL + API key first (brief DB lock), then drop the lock
    // before the async HTTP call.
    let (url, api_key) = {
        let (session, conn_arc) = state.resolve_scope(&session_token)?;
        require_permission_for_session(&state, &session, permissions::SYNC_MANAGE).await?;
        let db_guard = conn_arc
            .lock()
            .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
        let db = &*db_guard;
        let store = Store::new(&db);
        let config = SyncConfig::from_settings(&store)?;
        match config {
            Some(c) => (Some(c.server_url), c.api_key),
            None => (None, None),
        }
    };
    match (url, api_key) {
        (Some(u), Some(key)) => Ok(sync_client::fetch_tenant_plan(&u, &key).await),
        _ => Ok(sync_client::TenantPlanResult {
            ok: false,
            plan: None,
            status: "Sync is not configured".into(),
        }),
    }
}

/// Session-scoped variant of `test_sync_connection`.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn test_sync_connection_scoped(
    session_token: String,
    url: Option<String>,
    state: State<'_, AppState>,
) -> Result<sync_client::PingResult, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SYNC_MANAGE).await?;
    let resolved = match url.filter(|u| !u.is_empty()) {
        Some(u) => Some(u),
        None => {
            let conn_arc = state
                .db_manager
                .open_store(&session.store_id)
                .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;
            let db_guard = conn_arc
                .lock()
                .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
            let db = &*db_guard;
            Settings::get_sync_server_url(&db)?.filter(|s| !s.is_empty())
        }
    };
    match resolved {
        Some(u) => Ok(sync_client::ping_server(&u).await),
        None => Ok(sync_client::PingResult {
            ok: false,
            status: "No server URL configured".into(),
            latency_ms: None,
        }),
    }
}

/// Session-scoped variant of `sync_pull`.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn sync_pull_scoped(
    session_token: String,
    args: SyncPullArgs,
    state: State<'_, AppState>,
) -> Result<PullResult, AppError> {
    validate_pull_consent(&args)?;
    // Phase 1: Read config from DB (brief lock).
    let config_opt = {
        let (session, conn_arc) = state.resolve_scope(&session_token)?;
        require_permission_for_session(&state, &session, permissions::SYNC_MANAGE).await?;
        let db_guard = conn_arc
            .lock()
            .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
        let db = &*db_guard;
        let store = Store::new(&db);
        SyncConfig::from_settings(&store)?
    };

    let config = match config_opt {
        Some(c) => c,
        None => {
            return Ok(PullResult {
                products_pulled: 0,
                tax_rates_pulled: 0,
                users_pulled: 0,
                error: Some("Sync is not configured or disabled".into()),
            });
        }
    };

    // Phase 2: Async HTTP fetch (no DB lock held).
    let snapshot = sync_client::fetch_snapshot_from_server(&config).await;

    // Phase 3: Apply snapshot to DB (brief lock).
    let db = state.db.lock().await;
    let store = Store::new(&db);
    match snapshot {
        Ok(s) => Ok(sync_client::apply_snapshot(&store, &s)?),
        Err(e) => Ok(PullResult {
            products_pulled: 0,
            tax_rates_pulled: 0,
            users_pulled: 0,
            error: Some(e.to_string()),
        }),
    }
}

#[cfg(test)]
#[path = "sync_tests.rs"]
mod tests;
