//! Cloud-sync command bodies (configure, push and pull) — the tauri-free half
//! of `apps/desktop-tauri/src/commands/sync.rs`.
//!
//! Wave F: thirteen commands move here. The three `pg_sync_*` commands stay in
//! the shell because they need the `PgSyncDaemon` handle on `AppState`, which
//! lives in `platform-sync` — a crate this one does not depend on.
//!
//! Gate order is a verbatim port of the shell: resolve the session, enforce
//! `sync:manage` where the shell enforced it (`get_sync_settings_scoped`,
//! `get_pg_sync_settings_scoped` and `test_sync_connection` carry no gate and
//! none is invented), then open the caller's store and take its connection
//! lock. The push/pull cycles keep their three- and four-phase structure: a
//! short lock to read, HTTP with no lock held, a short lock to write, and the
//! one token-refresh retry on `AuthExpired`. The pull writes one pre-pull
//! backup beside the live DB and then disposes of it: removed on success,
//! retained (one per database, newest) on failure — see
//! `dispose_pre_pull_backup`.

use std::path::Path;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use kasirmu_core::db::Store;
use kasirmu_core::permissions;
use kasirmu_core::settings::Settings;
use kasirmu_core::sync_client::{self, PullResult, SyncAttemptResult, SyncConfig};

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

/// Stores the sync credential a completed device link earned (ADR #54 §2.5 step 7).
///
/// The two keys are the ones the sync daemon already reads, so turning sync on afterwards finds
/// them. The secret goes through its typed encrypting setter rather than a raw settings write:
/// the credential-storage-form gate treats `sync_terminal_secret` as device-protected, and a
/// plain write would both fail that gate and leave a secret in the clear.
///
/// Returns whether anything was stored; a link that earned no credential is not an error.
pub async fn store_linked_terminal(
    ctx: &BridgeCtx<'_>,
    terminal: Option<&kasirmu_core::desktop_link::TerminalCredential>,
) -> Result<bool, BridgeError> {
    let Some(terminal) = terminal else {
        return Ok(false);
    };
    if !terminal.issued {
        return Ok(false);
    }
    let (Some(terminal_id), Some(device_secret)) = (
        terminal.terminal_id.as_deref(),
        terminal.device_secret.as_deref(),
    ) else {
        // `issued` without both halves is a server contract violation, not a user problem.
        return Err(BridgeError::Internal(
            "the link reply claimed a credential without one".to_string(),
        ));
    };
    let server_url = {
        let conn = ctx.lock_global().await;
        Settings::set_sync_terminal_id(&conn, terminal_id)?;
        Settings::set_sync_terminal_secret(&conn, device_secret)?;
        Settings::set_sync_enabled(&conn, true)?;
        Settings::get_sync_server_url(&conn)?.unwrap_or_default()
    };

    if !server_url.is_empty() {
        let token_resp =
            sync_client::request_token_client_credentials(&server_url, terminal_id, device_secret)
                .await;
        // Collapsed: `token.is_some()` was checked and then re-proved by the
        // `if let` immediately inside it, so the outer test could only ever be
        // true. Clippy's collapsible_if (C25) is right that this was one
        // condition written twice.
        if token_resp.ok
            && let Some(ref token_str) = token_resp.token
        {
            let conn = ctx.lock_global().await;
            Settings::set_sync_api_key(&conn, token_str)?;
        }
    }

    Ok(true)
}

/// Get the current sync configuration settings.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncSettingsDto {
    /// Server Url.
    pub server_url: Option<String>,
    /// Has Api Key.
    pub has_api_key: bool,
    /// Enabled.
    pub enabled: bool,
    /// The origin the app actually resolves to (ADR #55): the environment
    /// override, an attested pin, or the canonical compiled origin.
    pub resolved_origin: String,
    /// Which tier supplied `resolved_origin` — `env-override`, `pinned`, `main`,
    /// `fallback` or `debug-local`. Carried so the settings surface can say *why*
    /// an origin won: a silent fallback is otherwise indistinguishable from
    /// misconfiguration.
    pub resolved_origin_source: String,
}

/// Update sync settings.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSyncSettingsArgs {
    /// Server Url.
    pub server_url: Option<String>,
    /// Api Key.
    pub api_key: Option<String>,
    /// Enabled.
    pub enabled: bool,
}

/// Persist sync settings (server URL, API key, enabled flag) atomically.
///
/// All three writes execute inside a single SQLite transaction so a
/// failure on any one rolls back the others — the same atomicity fix the
/// tablet client landed. Clearing the server URL (passing `null` or an
/// empty string) writes an EMPTY row rather than deleting it: that
/// row-presence contract is what `sync_bootstrap::should_auto_provision`
/// relies on to distinguish a cleared+disabled install from a fresh one.
pub fn update_sync_settings_data(
    conn: &Connection,
    args: &UpdateSyncSettingsArgs,
) -> Result<(), BridgeError> {
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

// ── PostgreSQL sync settings & daemon commands ──────────────────

/// PostgreSQL sync configuration (the PG transport's connection settings).
/// `has_password` reports whether a secret is stored — the password itself
/// is never echoed back to the front-end.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PgSyncSettingsDto {
    /// Whether PostgreSQL sync is enabled.
    pub enabled: bool,
    /// PostgreSQL hostname or IP.
    pub host: Option<String>,
    /// PostgreSQL port.
    pub port: Option<String>,
    /// PostgreSQL database name.
    pub dbname: Option<String>,
    /// PostgreSQL user.
    pub user: Option<String>,
    /// Whether a password is stored (never echoed back).
    pub has_password: bool,
    /// Whether the transport requires a TLS connection to PostgreSQL.
    pub require_tls: bool,
}

/// Business logic for `get_pg_sync_settings` (extracted for testing).
pub fn run_get_pg_sync_settings(conn: &Connection) -> Result<PgSyncSettingsDto, BridgeError> {
    Ok(PgSyncSettingsDto {
        enabled: Settings::is_pg_sync_enabled(conn)?,
        host: Settings::get_pg_sync_host(conn)?.filter(|s| !s.is_empty()),
        port: Settings::get_pg_sync_port(conn)?.filter(|s| !s.is_empty()),
        dbname: Settings::get_pg_sync_dbname(conn)?.filter(|s| !s.is_empty()),
        user: Settings::get_pg_sync_user(conn)?.filter(|s| !s.is_empty()),
        has_password: Settings::get_pg_sync_password(conn)?.is_some_and(|s| !s.is_empty()),
        require_tls: Settings::get_pg_sync_require_tls(conn)?,
    })
}

/// Update PG sync settings.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePgSyncSettingsArgs {
    /// Whether PostgreSQL sync is enabled.
    pub enabled: bool,
    /// PostgreSQL hostname or IP (`None` clears).
    pub host: Option<String>,
    /// PostgreSQL port (`None` clears).
    pub port: Option<String>,
    /// PostgreSQL database name (`None` clears).
    pub dbname: Option<String>,
    /// PostgreSQL user (`None` clears).
    pub user: Option<String>,
    /// PostgreSQL password — written only when `Some`, so the UI's masked
    /// untouched field never blanks the stored secret (mirror of the
    /// HTTP sync API-key handling).
    pub password: Option<String>,
    /// Whether the transport requires a TLS connection to PostgreSQL.
    /// Written on every update (defaults to `false` when absent).
    pub require_tls: Option<bool>,
}

/// Persist PG sync settings atomically in a single transaction.
///
/// Extracted as a free function so the persistence contract (optional
/// field clearing + password preservation) can be tested without a Tauri
/// runtime, mirroring `update_sync_settings_data`.
pub fn update_pg_sync_settings_data(
    conn: &Connection,
    args: &UpdatePgSyncSettingsArgs,
) -> Result<(), BridgeError> {
    let tx = conn.unchecked_transaction()?;
    Settings::set_pg_sync_enabled(&tx, args.enabled)?;
    // `None` (or an empty string) clears the field — the same row-presence
    // contract the HTTP sync URL handling uses.
    Settings::set_pg_sync_host(&tx, args.host.as_deref().unwrap_or(""))?;
    Settings::set_pg_sync_port(&tx, args.port.as_deref().unwrap_or(""))?;
    Settings::set_pg_sync_dbname(&tx, args.dbname.as_deref().unwrap_or(""))?;
    Settings::set_pg_sync_user(&tx, args.user.as_deref().unwrap_or(""))?;
    if let Some(ref password) = args.password {
        Settings::set_pg_sync_password(&tx, password)?;
    }
    // Write require_tls on every update (defaults to false when absent).
    Settings::set_pg_sync_require_tls(&tx, args.require_tls.unwrap_or(false))?;
    tx.commit()?;
    Ok(())
}

// Debug-only fallback URL used by the status-bar health probe so the sync
// indicator can recover while auto-provisioning is still writing the
// persisted settings row. Points at the unified cloud server.
#[cfg(debug_assertions)]
const LOCAL_DEV_SYNC_URL: &str = kasirmu_core::server_origin::MAIN_SERVER_ORIGIN;

/// Resolve the URL used by the status-bar health probe.
///
/// Explicitly supplied and persisted URLs always win. The debug-only local
/// fallback is intentionally added here rather than in the frontend so the
/// status indicator can recover even while auto-provisioning is still writing
/// the persisted settings row.
pub fn resolve_sync_probe_url(
    candidate: Option<String>,
    saved: Option<String>,
    allow_local_fallback: bool,
) -> Option<String> {
    if let Some(url) = candidate.filter(|url| !url.trim().is_empty()) {
        return Some(url);
    }
    if let Some(url) = saved.filter(|url| !url.trim().is_empty()) {
        return Some(url);
    }

    // Every caller still passes this flag in every profile; only the debug arm below
    // reads it, because production must not probe an unexpected URL. Name the unused
    // arm rather than renaming the parameter or deleting the caller's intent.
    #[cfg(not(debug_assertions))]
    let _ = allow_local_fallback;

    // The health indicator must be able to probe the cloud server before
    // the asynchronous bootstrap has persisted URL/key settings. Keep this
    // fallback debug-only so production never probes an unexpected URL.
    // An empty URL is unconfigured; an explicit opt-out is represented by
    // keeping a configured URL and disabling sync.
    #[cfg(debug_assertions)]
    if allow_local_fallback {
        return Some(LOCAL_DEV_SYNC_URL.to_string());
    }

    None
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
pub fn validate_pull_consent(args: &SyncPullArgs) -> Result<(), BridgeError> {
    if !args.confirm_destructive {
        return Err(BridgeError::Invalid(
            "confirm_destructive must be true to proceed with sync pull".into(),
        ));
    }
    Ok(())
}

// ── Scoped variants (ADR #7) ────────────────────────────────────

/// Get sync settings resolved from a session token. ADR #7.
pub async fn get_sync_settings_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<SyncSettingsDto, BridgeError> {
    // ungated-ok: read-only, and the api key is reduced to a presence bool below
    let session = ctx.resolve_session(session_token)?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let server_url = Settings::get_sync_server_url(&db)?.filter(|s| !s.is_empty());
    let api_key = Settings::get_sync_api_key(&db)?.filter(|k| !k.is_empty());
    let enabled = Settings::is_sync_enabled(&db)?;
    drop(db);
    let resolved = kasirmu_core::attestation::resolved_origin();
    Ok(SyncSettingsDto {
        server_url,
        has_api_key: api_key.is_some(),
        enabled,
        resolved_origin: resolved.url,
        resolved_origin_source: resolved.source.as_str().to_string(),
    })
}

/// Update sync settings.
pub async fn update_sync_settings(
    ctx: &BridgeCtx<'_>,
    args: UpdateSyncSettingsArgs,
) -> Result<(), BridgeError> {
    let db = ctx.lock_global().await;
    update_sync_settings_data(&db, &args)?;
    drop(db);
    Ok(())
}

/// Update sync settings (scoped).
pub async fn update_sync_settings_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: UpdateSyncSettingsArgs,
) -> Result<(), BridgeError> {
    // F-017: enforce per-domain permission on this scoped command.
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::SYNC_MANAGE)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    update_sync_settings_data(&db, &args)?;
    drop(db);
    Ok(())
}

/// Get PG sync settings (scoped).
pub async fn get_pg_sync_settings_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<PgSyncSettingsDto, BridgeError> {
    // ungated-ok: read-only pg connection settings; the password is not in the DTO
    let session = ctx.resolve_session(session_token)?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    run_get_pg_sync_settings(&db)
}

/// Update PG sync settings (scoped).
pub async fn update_pg_sync_settings_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: UpdatePgSyncSettingsArgs,
) -> Result<(), BridgeError> {
    // F-017: enforce per-domain permission on this scoped command.
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::SYNC_MANAGE)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    update_pg_sync_settings_data(&db, &args)?;
    drop(db);
    Ok(())
}

/// Pending sync count (scoped).
pub async fn pending_sync_count_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<i64, BridgeError> {
    // F-017: enforce per-domain permission on this scoped command.
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::SYNC_MANAGE)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    Ok(store.pending_offline_count()?)
}

/// Request a sync token (scoped).
pub async fn request_sync_token_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<sync_client::TokenResult, BridgeError> {
    // F-017: enforce per-domain permission on this scoped command.
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::SYNC_MANAGE)
        .await?;
    let resolved = {
        let conn = ctx
            .db_manager
            .open_store(&session.store_id)
            .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
        let db = conn
            .lock()
            .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
        Settings::get_sync_server_url(&db)?.filter(|s| !s.is_empty())
    }; // conn + db dropped here — std::sync::MutexGuard is not Send
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

/// Get sync plan (scoped).
pub async fn get_sync_plan_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<sync_client::TenantPlanResult, BridgeError> {
    // F-017: enforce per-domain permission on this scoped command.
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::SYNC_MANAGE)
        .await?;
    let (url, api_key) = {
        let conn = ctx
            .db_manager
            .open_store(&session.store_id)
            .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
        let db = conn
            .lock()
            .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
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

/// Test the cloud sync connection by pinging the configured server
/// (pre-session, no authentication required). Falls back to the cloud
/// probe URL when no URL is saved, so the login screen's sync indicator
/// works out of the box.
pub async fn test_sync_connection(
    ctx: &BridgeCtx<'_>,
) -> Result<sync_client::PingResult, BridgeError> {
    let (saved, api_key, allow_local_fallback) = {
        let db = ctx.lock_global().await;
        let saved = Settings::get_sync_server_url(&db)?;
        // Read alongside the URL so the credential verdict can be reported in
        // the same answer: `/health` is public, so reachability alone would
        // draw a green pill over a refused credential.
        let api_key = Settings::get_sync_api_key(&db)?;
        let allow_local_fallback = saved
            .as_deref()
            .map(|value| value.trim().is_empty())
            .unwrap_or(true);
        (saved, api_key, allow_local_fallback)
    }; // db lock dropped here
    let resolved = resolve_sync_probe_url(None, saved, allow_local_fallback);
    match resolved {
        Some(u) => Ok(sync_client::probe_sync_connection(&u, api_key.as_deref()).await),
        // No URL to probe, so no credential check was made: `auth: None` is the
        // documented value for a reachability-only answer (`PingResult::auth`).
        None => Ok(sync_client::PingResult {
            ok: false,
            status: "No server URL configured".into(),
            latency_ms: None,
            auth: None,
        }),
    }
}

/// Test sync connection (scoped).
pub async fn test_sync_connection_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<sync_client::PingResult, BridgeError> {
    // F-017: enforce per-domain permission on this scoped command.
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::SYNC_MANAGE)
        .await?;
    let (saved, api_key, allow_local_fallback) = {
        let conn = ctx
            .db_manager
            .open_store(&session.store_id)
            .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
        let db = conn
            .lock()
            .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
        let saved = Settings::get_sync_server_url(&db)?;
        // See `test_sync_connection`: the credential verdict rides the same
        // probe so a refused key cannot render green.
        let api_key = Settings::get_sync_api_key(&db)?;
        let allow_local_fallback = saved
            .as_deref()
            .map(|value| value.trim().is_empty())
            .unwrap_or(true);
        (saved, api_key, allow_local_fallback)
    }; // conn + db dropped here
    let resolved = resolve_sync_probe_url(None, saved, allow_local_fallback);
    match resolved {
        Some(u) => Ok(sync_client::probe_sync_connection(&u, api_key.as_deref()).await),
        // No URL to probe, so no credential check was made: `auth: None` is the
        // documented value for a reachability-only answer (`PingResult::auth`).
        None => Ok(sync_client::PingResult {
            ok: false,
            status: "No server URL configured".into(),
            latency_ms: None,
            auth: None,
        }),
    }
}

// ── Scoped variants (ADR #7) ────────────────────────────────────

/// Sync run (scoped — 3-phase with auth refresh).
pub async fn sync_run_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<SyncAttemptResult, BridgeError> {
    // F-017: enforce per-domain permission on this scoped command.
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::SYNC_MANAGE)
        .await?;
    // Phase 1: Read pending items and config from DB (brief lock).
    let (pending_items, config_opt) = {
        let conn = ctx
            .db_manager
            .open_store(&session.store_id)
            .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
        let db = conn
            .lock()
            .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
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

    // C49: the ONE ordering rule, shared by every push path
    // (`kasirmu_core::offline::order_for_push`). Without it a Critical item
    // queued behind a bulk one waits a whole cycle, so the value of the priority
    // column would depend on which of the push paths happened to run.
    //
    // Sorted ONCE, before the push: Phase 3 and the 401 retry below both reuse
    // this same vector, so the server's index-aligned outcome list still lines up.
    let mut pending_items = pending_items;
    kasirmu_core::offline::order_for_push(&mut pending_items);

    // Phase 2: Async HTTP push (no DB lock held).
    let mut outcomes = sync_client::send_items_to_server(&config, &pending_items).await;

    // ADR sync-auth-hardening P1: refresh token once on 401.
    if matches!(outcomes, Err(sync_client::SyncHttpError::AuthExpired)) {
        let client_credentials = {
            let session = ctx.resolve_session(session_token)?;
            let conn = ctx
                .db_manager
                .open_store(&session.store_id)
                .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
            let db = conn
                .lock()
                .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
            match (
                Settings::get_sync_terminal_id(&db)?,
                Settings::get_sync_terminal_secret(&db)?,
            ) {
                (Some(id), Some(secret)) => Some((id, secret)),
                _ => None,
            }
        };
        let fresh_key = sync_client::request_refresh_token(
            &config.server_url,
            client_credentials
                .as_ref()
                .map(|(id, secret)| (id.as_str(), secret.as_str())),
        )
        .await;
        if let Some(fresh_key) = fresh_key {
            {
                let session = ctx.resolve_session(session_token)?;
                let conn = ctx
                    .db_manager
                    .open_store(&session.store_id)
                    .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
                let db = conn
                    .lock()
                    .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
                sync_client::persist_refreshed_api_key(&db, &fresh_key)?;
            }
            let retry_config = {
                let session = ctx.resolve_session(session_token)?;
                let conn = ctx
                    .db_manager
                    .open_store(&session.store_id)
                    .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
                let db = conn
                    .lock()
                    .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
                let store = Store::new(&db);
                SyncConfig::from_settings(&store)?
            };
            if let Some(cfg) = retry_config {
                outcomes = sync_client::send_items_to_server(&cfg, &pending_items).await;
            }
        }
    }

    // Phase 3: Write outcomes back to DB (brief lock).
    let session = ctx.resolve_session(session_token)?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    match outcomes {
        Ok(outcomes) => Ok(sync_client::apply_sync_outcomes(
            &store,
            &pending_items,
            &outcomes,
        )?),
        Err(sync_client::SyncHttpError::PlanRequired) => Ok(SyncAttemptResult {
            synced: 0,
            failed: 0,
            error: Some("cloud sync requires a paid plan".into()),
            plan_required: true,
        }),
        // A batch the server never saw is retried, not condemned: `failed` is
        // terminal for a push item. See `sync_client::undelivered_batch`.
        Err(e) => Ok(sync_client::undelivered_batch(&e)),
    }
}

pub mod backup;
// The pre-pull backup family is private to the sync MODULE: the helpers take
// paths rather than a context, and `sync_tests.rs` reaches them through
// `use super::*`. Nothing outside `sync` needs them, so there is no re-export.
use backup::{dispose_pre_pull_backup, pre_pull_backup_path};
// `is_pre_pull_backup` and `prune_pre_pull_backups` are named only by
// `sync_tests.rs` through `use super::*` — the production pull path needs only
// the two above, so these are gated to the test build to keep the lib
// warning-free.
#[cfg(test)]
use backup::{is_pre_pull_backup, prune_pre_pull_backups};

/// Sync pull (scoped — 4-phase with auth refresh + backup). Takes the shell's
/// main database path only to recognise the LEGACY backup family that build
/// used to write; the backup itself is named after the store database it
/// clones, which this crate derives from `StoreDatabaseManager::store_db_path`.
pub async fn sync_pull_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: SyncPullArgs,
    db_path: &Path,
) -> Result<PullResult, BridgeError> {
    // F-017: enforce per-domain permission on this scoped command.
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::SYNC_MANAGE)
        .await?;
    validate_pull_consent(&args)?;

    // The database this pull mutates, and therefore the database the pre-pull
    // backup is a clone of. The backup is named after THIS file, not after
    // the shell's main database, so each store gets its own rotation scope.
    let store_db = ctx.db_manager.store_db_path(&session.store_id);

    // Phase 1: Read config from DB (brief lock).
    let config_opt = {
        let conn = ctx
            .db_manager
            .open_store(&session.store_id)
            .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
        let db = conn
            .lock()
            .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
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
    let mut snapshot = sync_client::fetch_snapshot_from_server(&config).await;

    // ADR sync-auth-hardening P1: refresh token once on 401.
    if matches!(snapshot, Err(sync_client::SyncHttpError::AuthExpired)) {
        let client_credentials = {
            let session = ctx.resolve_session(session_token)?;
            let conn = ctx
                .db_manager
                .open_store(&session.store_id)
                .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
            let db = conn
                .lock()
                .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
            match (
                Settings::get_sync_terminal_id(&db)?,
                Settings::get_sync_terminal_secret(&db)?,
            ) {
                (Some(id), Some(secret)) => Some((id, secret)),
                _ => None,
            }
        };
        let fresh_key = sync_client::request_refresh_token(
            &config.server_url,
            client_credentials
                .as_ref()
                .map(|(id, secret)| (id.as_str(), secret.as_str())),
        )
        .await;
        if let Some(fresh_key) = fresh_key {
            {
                let session = ctx.resolve_session(session_token)?;
                let conn = ctx
                    .db_manager
                    .open_store(&session.store_id)
                    .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
                let db = conn
                    .lock()
                    .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
                sync_client::persist_refreshed_api_key(&db, &fresh_key)?;
            }
            let retry_config = {
                let session = ctx.resolve_session(session_token)?;
                let conn = ctx
                    .db_manager
                    .open_store(&session.store_id)
                    .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
                let db = conn
                    .lock()
                    .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
                let store = Store::new(&db);
                SyncConfig::from_settings(&store)?
            };
            if let Some(cfg) = retry_config {
                snapshot = sync_client::fetch_snapshot_from_server(&cfg).await;
            }
        }
    }

    // Phase 3: Create a pre-pull backup (defence in depth — H-2).
    //
    // This file is deliberately UNFILTERED: `Store::backup` is the SQLite
    // online-backup page copy and consults no policy, so the settings deny
    // list applied to every export lane does not reach it. It is a complete
    // plaintext clone of the database, written beside the live file, and it
    // exists for one purpose — recovering a local DB that Phase 4 corrupts
    // half-way through. Phase 5 therefore decides its fate; it must not be
    // deleted before Phase 4 runs, or the recovery property is gone.
    let backup_path = {
        let session = ctx.resolve_session(session_token)?;
        let conn = ctx
            .db_manager
            .open_store(&session.store_id)
            .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
        let db = conn
            .lock()
            .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
        let store = Store::new(&db);
        let timestamp = chrono::Utc::now().format("%Y%m%d%H%M%S").to_string();
        let backup_path = pre_pull_backup_path(&store_db, &timestamp);
        store
            .backup(&backup_path.display().to_string())
            .map_err(|e| {
                tracing::warn!(backup = %backup_path.display(), error = %e, "sync-pull backup failed");
                BridgeError::Internal(format!("sync-pull backup failed: {e}"))
            })?;
        tracing::info!(backup = %backup_path.display(), "pre-pull backup created");
        backup_path
    };

    // Phase 4: Apply snapshot to DB (brief lock).
    let applied = {
        let session = ctx.resolve_session(session_token)?;
        let conn = ctx
            .db_manager
            .open_store(&session.store_id)
            .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
        let db = conn
            .lock()
            .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
        let store = Store::new(&db);
        match snapshot {
            Ok(s) => Ok(sync_client::apply_snapshot(&store, &s)?),
            // A failed fetch never touched the local database, so there is
            // nothing to recover from: still reported as an Ok result with
            // `error` set, exactly as before.
            Err(e) => Ok(PullResult {
                products_pulled: 0,
                tax_rates_pulled: 0,
                users_pulled: 0,
                error: Some(e.to_string()),
            }),
        }
    };

    // Phase 5: dispose of the pre-pull backup — deleted on success, retained
    // (one per database) on failure. Runs after the DB lock is released.
    dispose_pre_pull_backup(db_path, &store_db, &backup_path, applied.is_ok());
    applied
}

/// Settings changed sink (scoped — no-op for session-validated callers).
pub async fn settings_changed_sink_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    _key: &str,
    _value: Option<String>,
) -> Result<(), BridgeError> {
    // ungated-ok: deliberate no-op - authenticates, then takes no action
    ctx.resolve_scope(session_token)?;
    Ok(())
}

#[cfg(test)]
#[path = "sync_tests.rs"]
mod sync_tests;
