//! Cloud-sync command bodies (configure, push and pull) — the tauri-free half
//! of `apps/desktop-client/src/commands/sync.rs`.
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
//! [`dispose_pre_pull_backup`].

use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use oz_core::db::Store;
use oz_core::permissions;
use oz_core::settings::Settings;
use oz_core::sync_client::{self, PullResult, SyncAttemptResult, SyncConfig};

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

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
const LOCAL_DEV_SYNC_URL: &str = "https://license.ozpos.my.id";

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
    Ok(SyncSettingsDto {
        server_url,
        has_api_key: api_key.is_some(),
        enabled,
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
    let (saved, allow_local_fallback) = {
        let db = ctx.lock_global().await;
        let saved = Settings::get_sync_server_url(&db)?;
        let allow_local_fallback = saved
            .as_deref()
            .map(|value| value.trim().is_empty())
            .unwrap_or(true);
        (saved, allow_local_fallback)
    }; // db lock dropped here
    let resolved = resolve_sync_probe_url(None, saved, allow_local_fallback);
    match resolved {
        Some(u) => Ok(sync_client::ping_server(&u).await),
        None => Ok(sync_client::PingResult {
            ok: false,
            status: "No server URL configured".into(),
            latency_ms: None,
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
    let (saved, allow_local_fallback) = {
        let conn = ctx
            .db_manager
            .open_store(&session.store_id)
            .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
        let db = conn
            .lock()
            .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
        let saved = Settings::get_sync_server_url(&db)?;
        let allow_local_fallback = saved
            .as_deref()
            .map(|value| value.trim().is_empty())
            .unwrap_or(true);
        (saved, allow_local_fallback)
    }; // conn + db dropped here
    let resolved = resolve_sync_probe_url(None, saved, allow_local_fallback);
    match resolved {
        Some(u) => Ok(sync_client::ping_server(&u).await),
        None => Ok(sync_client::PingResult {
            ok: false,
            status: "No server URL configured".into(),
            latency_ms: None,
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
        Err(e) => Ok(sync_client::mark_all_failed(
            &store,
            &pending_items,
            &e.to_string(),
        )?),
    }
}

/// Filename infix of the pre-pull backup written by [`sync_pull_scoped`].
///
/// The full shape is `<db-stem>.sync-pull-<YYYYMMDDHHMMSS>.backup.db`: the
/// live database's extension replaced by a timestamped marker. Both disposal
/// and rotation match on this infix, so changing it changes both.
const PRE_PULL_BACKUP_INFIX: &str = "sync-pull-";

/// Filename suffix of the pre-pull backup (see [`PRE_PULL_BACKUP_INFIX`]).
const PRE_PULL_BACKUP_SUFFIX: &str = ".backup.db";

/// How many pre-pull backups survive a pull, per database.
///
/// One, not one-per-pull: a retained copy is worth exactly as much as the
/// recovery it enables, and a second one is worth nothing — while a directory
/// full of them is worth a great deal to anyone who finds them. See
/// [`dispose_pre_pull_backup`] for why each one is unfiltered cleartext.
const PRE_PULL_BACKUPS_KEPT: usize = 1;

/// The path the pre-pull backup for `db_path` takes at `timestamp`.
///
/// `Path::set_extension` replaces everything after the last dot of the file
/// name, so `/data/oz-pos.db` yields `/data/oz-pos.sync-pull-<ts>.backup.db`
/// — always a sibling of the live database, never a file inside it.
fn pre_pull_backup_path(db_path: &Path, timestamp: &str) -> PathBuf {
    let mut path = db_path.to_path_buf();
    path.set_extension(format!(
        "{PRE_PULL_BACKUP_INFIX}{timestamp}{PRE_PULL_BACKUP_SUFFIX}"
    ));
    path
}

/// Whether `candidate` is a pre-pull backup of `db_path` — and not a backup of
/// some other database sharing the directory, nor the live file itself.
fn is_pre_pull_backup(db_path: &Path, candidate: &Path) -> bool {
    let (Some(stem), Some(name)) = (db_path.file_stem(), candidate.file_name()) else {
        return false;
    };
    let prefix = format!("{}.{}", stem.to_string_lossy(), PRE_PULL_BACKUP_INFIX);
    let name = name.to_string_lossy();
    name.len() > prefix.len() + PRE_PULL_BACKUP_SUFFIX.len()
        && name.starts_with(&prefix)
        && name.ends_with(PRE_PULL_BACKUP_SUFFIX)
}

/// Rotate the pre-pull backups belonging to `db_path` down to the `keep`
/// newest, returning the paths actually removed.
///
/// `protect` — the backup this pull just wrote, when it is being retained — is
/// never removed and consumes one slot of the budget, so a retained recovery
/// copy can never be rotated out by a later-timestamped sibling from a skewed
/// clock.
///
/// Selection is by file name, not mtime: the timestamp is fixed-width
/// `%Y%m%d%H%M%S` UTC, so lexicographic order *is* chronological order, and a
/// copy SQLite wrote and never reopened has no mtime worth trusting. A missing
/// or unreadable parent directory is not an error — there is nothing to rotate.
fn prune_pre_pull_backups(db_path: &Path, keep: usize, protect: Option<&Path>) -> Vec<PathBuf> {
    let Some(parent) = db_path.parent() else {
        return Vec::new();
    };
    let Ok(entries) = std::fs::read_dir(parent) else {
        return Vec::new();
    };
    let mut found: Vec<PathBuf> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| is_pre_pull_backup(db_path, path))
        .collect();
    // Newest first: descending file name == descending timestamp.
    found.sort_by(|a, b| b.file_name().cmp(&a.file_name()));

    // Only count the protected file if it is actually on disk — otherwise a
    // copy we just deleted would reserve the budget and starve the survivor.
    let protected_present = protect.map_or(false, |p| found.iter().any(|f| f == p));
    let mut kept = usize::from(protected_present);
    let mut removed = Vec::new();
    for path in found {
        if protect == Some(path.as_path()) {
            continue;
        }
        if kept < keep {
            kept += 1;
            continue;
        }
        match std::fs::remove_file(&path) {
            Ok(()) => removed.push(path),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => {
                // Never fatal: a stuck stale copy is a disk-space nuisance,
                // not a reason to fail a pull that already succeeded.
                tracing::warn!(backup = %path.display(), error = %e, "pre-pull backup rotation failed");
            }
        }
    }
    removed
}

/// Decide the fate of the pre-pull backup once the pull's outcome is known.
///
/// * `applied_ok == true` — the local database is coherent: either the
///   snapshot applied cleanly, or the fetch failed and nothing was written at
///   all. The recovery point has served no purpose, so it is deleted.
/// * `applied_ok == false` — the apply failed part-way, which is exactly the
///   state this file exists to undo, so it is retained and only its older
///   siblings are rotated away.
///
/// Either way the directory is capped at [`PRE_PULL_BACKUPS_KEPT`] copies for
/// this database, so a long-lived till cannot accumulate a pile.
///
/// WHY THE PILE MATTERS: `Store::backup` is the SQLite online-backup API — a
/// page-level copy of the whole database that consults no policy, so the
/// settings deny list that filters every export lane does NOT apply here. Each
/// file is a complete plaintext clone, secrets included, written beside the
/// live database where machine backup tools, antivirus indexers and anyone
/// tidying a folder will find it. Removing it on the success path is what keeps
/// that exposure to one transient file instead of one per pull, forever.
///
/// Every log line here names the PATH and never the contents — the contents
/// are precisely what must not reach a log.
fn dispose_pre_pull_backup(db_path: &Path, backup_path: &Path, applied_ok: bool) {
    if applied_ok {
        match std::fs::remove_file(backup_path) {
            Ok(()) => {
                tracing::debug!(backup = %backup_path.display(), "pre-pull backup removed after successful pull");
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => {
                tracing::warn!(backup = %backup_path.display(), error = %e, "pre-pull backup could not be removed after a successful pull");
            }
        }
    } else {
        tracing::warn!(backup = %backup_path.display(), "pull failed; pre-pull backup retained for recovery");
    }

    // Success: our own copy is already gone, so rotation just trims orphans
    // left by earlier failed pulls down to one. Failure: `protect` makes this
    // pull's copy the single survivor.
    let protect = if applied_ok { None } else { Some(backup_path) };
    for stale in prune_pre_pull_backups(db_path, PRE_PULL_BACKUPS_KEPT, protect) {
        tracing::debug!(backup = %stale.display(), "rotated out a stale pre-pull backup");
    }
}

/// Sync pull (scoped — 4-phase with auth refresh + backup). Takes the local
/// database path from the shell: the pre-pull backup is written next to the
/// live database file, which is shell state this crate cannot derive (same
/// reasoning as the settings profile directory).
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
        let backup_path = pre_pull_backup_path(db_path, &timestamp);
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
    dispose_pre_pull_backup(db_path, &backup_path, applied.is_ok());
    applied
}

/// Settings changed sink (scoped — no-op for session-validated callers).
pub async fn settings_changed_sink_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    _key: &str,
    _value: Option<String>,
) -> Result<(), BridgeError> {
    ctx.resolve_scope(session_token)?;
    Ok(())
}

#[cfg(test)]
#[path = "sync_tests.rs"]
mod sync_tests;
