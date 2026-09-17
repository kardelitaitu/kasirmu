//! IPC surface for the loopback local API server (step 2 of
//! `docs/guides/EXTENDING.md`).
//!
//! Device-level settings (`local_api.*` on the global DB, like the
//! `lan_server.*` precedent): the server is one per machine, not per
//! store — but it SERVES the primary store's database (resolved via
//! `locations.is_primary`, see `local_api::open_api_store_connection`).
//! Mutations require `settings:edit`; status reads require
//! `settings:read`. The signing secret never crosses the IPC boundary —
//! the UI gets a minted token, not the secret (the secret doubles as the
//! operator `X-Admin-Key`, so it is also on the settings secret
//! deny-list).
//!
//! The lifecycle logic lives in the `run_*` helpers (image dir injected,
//! no `AppHandle`), so `local_api_command_tests.rs` covers the real
//! start/stop/restart sequences; the `#[tauri::command]` wrappers only
//! add session auth + path resolution. Every transition holds
//! `AppState::local_api_op` for its full check-then-act sequence, so a
//! toggle can never interleave with the boot auto-start daemon.

use std::path::PathBuf;
use std::sync::Arc;

use rusqlite::Connection;
use tauri::Manager;

use crate::commands::authz::require_permission_for_session;
use crate::error::AppError;
use crate::local_api::{self, LocalApiStatus};
use crate::state::AppState;
use kasirmu_core::permissions;

/// Resolve the local image store directory (same layout as
/// `commands::products_images`: `app_cache_dir()/images`).
fn image_dir_for(app: &tauri::AppHandle) -> Result<PathBuf, AppError> {
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| AppError::Internal(format!("resolving app cache dir: {e}")))?;
    Ok(cache_dir.join("images"))
}

/// Persist a `local_api.*` setting on the global DB.
fn persist_setting(conn: &Connection, key: &str, value: &str) -> Result<(), AppError> {
    kasirmu_core::Settings::set(conn, key, value)
        .map_err(|e| AppError::Internal(format!("persisting {key}: {e}")))
}

/// Read port + secret + served-store API connection from state.
///
/// The global-db guard is dropped before returning —
/// `open_api_store_connection` opens its own handle. The served store
/// id is resolved on the GLOBAL DB (`local_api.store_id` override,
/// else `locations.is_primary`), never the store DB. `image_dir`
/// is injected by the caller (command or test).
async fn prepare(
    state: &AppState,
) -> Result<
    (
        u16,
        String,
        Arc<tokio::sync::Mutex<Connection>>,
        PathBuf,
        String,
    ),
    AppError,
> {
    let (port, secret, store_id) = {
        let db = state.db.lock().await;
        let port = local_api::resolve_port(&db);
        let secret = local_api::load_or_create_secret(&db).map_err(AppError::Internal)?;
        let store_id = local_api::resolve_store_id(&db);
        (port, secret, store_id)
    }; // global db guard dropped — open_store below may await internally
    let (api_db, api_db_path) = local_api::open_api_store_connection(&state.db_manager, &store_id)
        .map_err(AppError::Internal)?;
    Ok((port, secret, api_db, api_db_path, store_id))
}

/// Bind + register the server handle (callers hold the op lock).
/// `port` 0 = use the persisted configuration. Shared with the boot
/// auto-start daemon (`lib.rs`) so both paths run identical logic.
/// API writes are audited into the served store's `audit_log`.
pub(crate) async fn start_and_store(
    state: &AppState,
    image_dir: PathBuf,
    port: u16,
) -> Result<(), AppError> {
    let (configured_port, secret, api_db, api_db_path, store_id) = prepare(state).await?;
    let port = if port == 0 { configured_port } else { port };
    let sink = local_api::StoreAuditSink::new(api_db.clone(), store_id);
    let handle = local_api::start_with_audit(
        api_db,
        api_db_path,
        image_dir,
        secret,
        port,
        Some(Arc::new(sink)),
    )
    .await
    .map_err(AppError::Internal)?;
    *state.local_api.lock().await = Some(handle);
    Ok(())
}

/// Build the status snapshot from current settings + running handle.
async fn build_status(state: &AppState) -> Result<LocalApiStatus, AppError> {
    let (enabled, port, store_id) = {
        let db = state.db.lock().await;
        (
            local_api::is_enabled(&db),
            local_api::resolve_port(&db),
            local_api::resolve_store_id(&db),
        )
    };
    let slot = state.local_api.lock().await;
    Ok(LocalApiStatus {
        enabled,
        running: slot.is_some(),
        port,
        base_url: slot.as_ref().map(|h| h.base_url.clone()),
        store_id,
    })
}

/// Enable or disable the server. Logic body of the scoped command;
/// `image_dir` injected for testability. Holds the lifecycle op lock for
/// the whole check-then-act sequence (review HIGH-2).
async fn run_set_enabled(
    state: &AppState,
    image_dir: PathBuf,
    enabled: bool,
) -> Result<LocalApiStatus, AppError> {
    let _op = state.local_api_op.lock().await;

    if !enabled {
        // Scoped take (see run_rotate_secret for why).
        let running = {
            let mut slot = state.local_api.lock().await;
            slot.take()
        };
        if let Some(handle) = running {
            handle.stop_async().await;
        }
        let db = state.db.lock().await;
        persist_setting(&db, local_api::SETTINGS_ENABLED, "0")?;
        drop(db);
        return build_status(state).await;
    }

    // Already running? Idempotent success.
    if state.local_api.lock().await.is_some() {
        return build_status(state).await;
    }

    start_and_store(state, image_dir, 0).await?;

    // Persist the enabled intent only AFTER a successful bind, so a
    // port conflict never leaves an "enabled but not running" setting
    // to confuse the next boot.
    let db = state.db.lock().await;
    persist_setting(&db, local_api::SETTINGS_ENABLED, "1")?;
    drop(db);
    build_status(state).await
}

/// Port change. Logic body of the scoped command; `port` is re-validated
/// here so the helper is safe to call from tests directly.
async fn run_set_port(
    state: &AppState,
    image_dir: PathBuf,
    port: u16,
) -> Result<LocalApiStatus, AppError> {
    if !(1024..=65535).contains(&port) {
        return Err(AppError::Invalid(
            "port must be between 1024 and 65535".into(),
        ));
    }
    let _op = state.local_api_op.lock().await;

    {
        let db = state.db.lock().await;
        persist_setting(&db, local_api::SETTINGS_PORT, &port.to_string())?;
    }

    // Restart if running so the new port takes effect immediately.
    // stop_async guarantees the old listener is gone before re-binding
    // (review MED-3: rapid disable→enable on the same port).
    let was_running = {
        let mut slot = state.local_api.lock().await;
        match slot.take() {
            Some(handle) => {
                drop(slot); // release the slot before start + re-lock
                handle.stop_async().await;
                true
            }
            None => false,
        }
    };
    if was_running {
        start_and_store(state, image_dir, port).await?;
    }
    build_status(state).await
}

/// Secret rotation. Logic body of the scoped command.
async fn run_rotate_secret(
    state: &AppState,
    image_dir: PathBuf,
) -> Result<LocalApiStatus, AppError> {
    let _op = state.local_api_op.lock().await;

    {
        let db = state.db.lock().await;
        local_api::rotate_secret(&db).map_err(AppError::Internal)?;
    }

    // Running server still holds the OLD secret in its AppState —
    // restart it so the new key takes effect immediately. Take in a
    // scoped block: `if let Some(h) = lock.await.take()` keeps the slot
    // guard alive through the whole body (the edition-2024
    // scrutinee-temporary change was reverted before stabilization),
    // and `start_and_store` re-locks the slot — the task would deadlock
    // against its own guard.
    let running = {
        let mut slot = state.local_api.lock().await;
        slot.take()
    };
    if let Some(handle) = running {
        let port = handle.port;
        handle.stop_async().await;
        start_and_store(state, image_dir, port).await?;
    }
    build_status(state).await
}

/// Store selection. Logic body of the scoped command. `store_id` empty
/// = back to the primary store. When the server is running it restarts
/// against the newly selected store's database (the served DB lives in
/// the serve state, not the socket — same restart shape as a port
/// change).
async fn run_set_store(
    state: &AppState,
    image_dir: PathBuf,
    store_id: &str,
) -> Result<LocalApiStatus, AppError> {
    let _op = state.local_api_op.lock().await;
    let store_id = store_id.trim();
    {
        let db = state.db.lock().await;
        if store_id.is_empty() {
            persist_setting(&db, local_api::SETTINGS_STORE, "")?;
        } else {
            if !local_api::store_exists(&db, store_id) {
                return Err(AppError::Invalid(format!("unknown store: {store_id}")));
            }
            persist_setting(&db, local_api::SETTINGS_STORE, store_id)?;
        }
    }

    let running = {
        let mut slot = state.local_api.lock().await;
        slot.take()
    };
    if let Some(handle) = running {
        let port = handle.port;
        handle.stop_async().await;
        start_and_store(state, image_dir, port).await?;
    }
    build_status(state).await
}

/// Report whether the local API is enabled/running and on which port.
#[tauri::command]
pub async fn local_api_status_scoped(
    session_token: String,
    state: tauri::State<'_, AppState>,
) -> Result<LocalApiStatus, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SETTINGS_READ).await?;
    build_status(&state).await
}

/// Enable or disable the local API server (persisted across restarts).
///
/// Enabling binds `127.0.0.1:<port>` against the PRIMARY STORE's
/// database; a port conflict returns an error and leaves the setting
/// off. Loopback-only by design — LAN exposure is not part of this
/// surface (see the guide §10).
#[tauri::command]
pub async fn local_api_set_enabled_scoped(
    session_token: String,
    enabled: bool,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<LocalApiStatus, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SETTINGS_EDIT).await?;
    run_set_enabled(&state, image_dir_for(&app)?, enabled).await
}

/// Change the listen port. When the server is running it is restarted
/// on the new port; a failed restart returns an error and leaves the
/// new port persisted (the next enable/boot retries it).
#[tauri::command]
pub async fn local_api_set_port_scoped(
    session_token: String,
    port: u16,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<LocalApiStatus, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SETTINGS_EDIT).await?;
    run_set_port(&state, image_dir_for(&app)?, port).await
}

/// Choose which store the local API serves. Empty string resets to the
/// primary store. Running servers restart against the new target.
#[tauri::command]
pub async fn local_api_set_store_scoped(
    session_token: String,
    store_id: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<LocalApiStatus, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SETTINGS_EDIT).await?;
    run_set_store(&state, image_dir_for(&app)?, &store_id).await
}

/// Rotate the per-install signing secret.
///
/// Every previously minted token stops validating immediately and the
/// operator `X-Admin-Key` changes with it — the UI confirms this with
/// the merchant before calling. When the server is running it restarts
/// on the same port with the new secret (the secret lives in the serve
/// state, not the socket); minted tokens must be regenerated from the
/// panel afterwards.
#[tauri::command]
pub async fn local_api_rotate_secret_scoped(
    session_token: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<LocalApiStatus, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SETTINGS_EDIT).await?;
    run_rotate_secret(&state, image_dir_for(&app)?).await
}

/// Mint a long-lived API token signed with the per-install secret.
///
/// Returns the JWT + expiry; the secret itself never crosses the IPC
/// boundary. Master-data writes additionally need
/// `X-Admin-Key: <secret>` — the UI explains this and the secret is
/// available to operators via the settings table only (deny-listed from
/// `get_setting`).
#[tauri::command]
pub async fn local_api_mint_token_scoped(
    session_token: String,
    label: String,
    expiry_hours: Option<i64>,
    state: tauri::State<'_, AppState>,
) -> Result<kasirmu_api::auth::TokenResponse, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SETTINGS_EDIT).await?;
    let secret = {
        let db = state.db.lock().await;
        local_api::load_or_create_secret(&db).map_err(AppError::Internal)?
    };
    local_api::mint_token(&secret, &label, expiry_hours).map_err(AppError::Internal)
}

#[cfg(test)]
#[path = "local_api_command_tests.rs"]
mod tests;
