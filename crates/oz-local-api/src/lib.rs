//! Headless loopback REST API for OZ-POS, extracted from
//! `apps/desktop-client/src/local_api.rs` (Agent 1, Phase 1.2).
//!
//! Owns the settings-driven enable/port/secret resolution, the dedicated
//! per-store WAL connection and the `axum::serve` lifecycle on top of the
//! shared `oz-api` router. No Tauri, windowing or GUI dependency, so a
//! headless binary can drive it directly.
//!
//! Entry points: `start` / `start_with_audit` (yield a `LocalApiHandle`
//! that can be signalled to stop), the minting and rotation helpers
//! (`mint_token`, `rotate_secret`, `load_or_create_secret`), and
//! `StoreAuditSink` for write auditing into the served store's `audit_log`.
//!
//! Local REST API server — embeds the `oz-api` router on loopback so
//! merchants can run their own scripts against the register.
//!
//! Mirrors the `lan_server` precedent: settings-driven, default-off,
//! loopback-only. Settings keys (global DB, device-level):
//! `local_api.enabled` ("1"/"0"), `local_api.port` (default 3099),
//! `local_api.secret` (per-install random hex, generated on first
//! enable — signs API tokens and doubles as the operator admin key, so
//! it is on the settings secret deny-list and never leaves the backend
//! except via the dedicated mint/status commands).
//!
//! The server serves ONE store's database at a time — by default the
//! PRIMARY store, switchable via `local_api.store_id` (Settings panel)
//! — resolved on the GLOBAL DB and opened as a dedicated WAL connection
//! to `store-{id}.sqlite` (the same file the scoped Tauri commands read
//! through `state.resolve_scope()`), so scripts see exactly what the
//! register UI shows. Mutating requests are audited into that store's
//! `audit_log` via [`StoreAuditSink`]. The `local_api.*` settings
//! themselves live on the GLOBAL DB (device-level). CORS is
//! fail-closed (empty allowlist): local scripts are curl/Python/Node,
//! not browser pages. `GET /api/openapi.json` serves
//! `oz_api::spec::local_spec()` — the shared contract with every
//! operation tagged `x-oz-scope: "both"`.

use std::path::PathBuf;
use std::sync::Arc;

use platform_core::StoreDatabaseManager;
use rusqlite::Connection;
use serde::Serialize;
use tokio::net::TcpListener;
use tokio::sync::{Mutex, oneshot};

/// Settings key: "1" enables the local API (default off).
pub const SETTINGS_ENABLED: &str = "local_api.enabled";
/// Settings key: TCP port (default [`DEFAULT_PORT`]).
pub const SETTINGS_PORT: &str = "local_api.port";
/// Settings key: per-install signing secret (hex, 32 bytes).
pub const SETTINGS_SECRET: &str = "local_api.secret";
/// Settings key: store served by the API (unset = primary store).
pub const SETTINGS_STORE: &str = "local_api.store_id";
/// Default listen port — matches `OZ_API_PORT` in the standalone crate.
pub const DEFAULT_PORT: u16 = 3099;
/// Default token lifetime for UI-minted keys (30 days).
pub const DEFAULT_TOKEN_HOURS: i64 = 720;
/// Upper bound for UI-minted token lifetime (1 year).
pub const MAX_TOKEN_HOURS: i64 = 8760;

/// A running local API server and the means to stop it.
pub struct LocalApiHandle {
    /// The port actually bound (the OS picks for port 0 in tests).
    pub port: u16,
    /// Base URL for scripts, e.g. `http://127.0.0.1:3099/api/v1`.
    pub base_url: String,
    shutdown: oneshot::Sender<()>,
    task: tokio::task::JoinHandle<()>,
}

impl LocalApiHandle {
    /// Signal graceful shutdown and abort the task without waiting.
    /// Used by `AppState::drop` (sync context); prefer [`Self::stop_async`]
    /// when an await point is available — it guarantees the listener
    /// socket is released before returning, so an immediate re-bind of
    /// the same port cannot race the OS teardown.
    pub fn stop(self) {
        let _ = self.shutdown.send(());
        self.task.abort();
        tracing::info!(port = self.port, "local API server stopped");
    }

    /// Graceful shutdown awaited up to 2 s (abort fallback). Returns
    /// only after the serve task — and with it the listener — is gone.
    pub async fn stop_async(self) {
        let LocalApiHandle {
            port,
            shutdown,
            mut task,
            ..
        } = self;
        let _ = shutdown.send(());
        if tokio::time::timeout(std::time::Duration::from_secs(2), &mut task)
            .await
            .is_err()
        {
            task.abort();
            tracing::warn!(port, "local API graceful shutdown timed out, aborted");
        }
        tracing::info!(port, "local API server stopped");
    }
}

/// The primary store's id from the GLOBAL DB (`locations`),
/// falling back to `'default'` when no row is flagged (fresh install
/// before `seed_primary_store` promotion, or a corrupted profile).
pub fn primary_store_id(global: &Connection) -> String {
    global
        .query_row(
            "SELECT id FROM locations WHERE is_primary = 1 LIMIT 1",
            [],
            |r| r.get::<_, String>(0),
        )
        .unwrap_or_else(|_| "default".to_string())
}

/// True when `id` names a registered store profile.
pub fn store_exists(global: &Connection, id: &str) -> bool {
    global
        .query_row(
            "SELECT 1 FROM locations WHERE id = ?1 LIMIT 1",
            rusqlite::params![id],
            |_| Ok(true),
        )
        .unwrap_or(false)
}

/// The store the local API serves: `local_api.store_id` when it names a
/// real profile, else the primary store. A stale setting (deleted
/// store) silently degrades to primary rather than failing the boot
/// auto-start — the Settings UI re-validates on the next explicit
/// switch.
pub fn resolve_store_id(global: &Connection) -> String {
    match oz_core::Settings::get(global, SETTINGS_STORE)
        .ok()
        .flatten()
    {
        Some(id) if store_exists(global, id.trim()) => id.trim().to_string(),
        _ => primary_store_id(global),
    }
}

/// Open the dedicated API connection to a store's database.
///
/// Goes through `db_manager.open_store` first so the file exists and is
/// migrated (the manager caches its own std-Mutex connection — the UI's
/// path), then opens a SECOND connection to the same file wrapped in a
/// tokio Mutex, which is what `oz_api::AppState` requires. WAL mode
/// makes the two connections safe to share the file; `busy_timeout`
/// absorbs write contention between API and UI instead of surfacing
/// `SQLITE_BUSY` to scripts.
pub fn open_api_store_connection(
    db_manager: &StoreDatabaseManager,
    store_id: &str,
) -> Result<(Arc<Mutex<Connection>>, PathBuf), String> {
    db_manager
        .open_store(store_id)
        .map_err(|e| format!("preparing store db {store_id}: {e}"))?;
    let path = db_manager.store_db_path(store_id);
    let conn = Connection::open(&path).map_err(|e| format!("opening {}: {e}", path.display()))?;
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(|e| format!("enabling FK on {}: {e}", path.display()))?;
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| format!("enabling WAL on {}: {e}", path.display()))?;
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| format!("setting busy_timeout on {}: {e}", path.display()))?;
    Ok((Arc::new(Mutex::new(conn)), path))
}

/// Read `local_api.enabled` from the settings table.
pub fn is_enabled(conn: &Connection) -> bool {
    oz_core::Settings::get(conn, SETTINGS_ENABLED)
        .unwrap_or(None)
        .as_deref()
        == Some("1")
}

/// Read and validate `local_api.port`; falls back to [`DEFAULT_PORT`].
pub fn resolve_port(conn: &Connection) -> u16 {
    oz_core::Settings::get(conn, SETTINGS_PORT)
        .unwrap_or(None)
        .and_then(|s| s.trim().parse::<u16>().ok())
        .filter(|p| (1024..=65535).contains(p))
        .unwrap_or(DEFAULT_PORT)
}

/// Generate a fresh per-install secret value (NOT persisted here).
/// 32 CSPRNG bytes as 64 lowercase hex chars — the same strength
/// guidance as a cloud `OZ_API_SECRET` (review LOW-4: replaced a
/// two-UUIDv7 construction whose 48-bit timestamps shave no entropy
/// but add structure for no benefit).
fn new_secret() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Load the per-install secret, generating and persisting one on first
/// use.
pub fn load_or_create_secret(conn: &Connection) -> Result<String, String> {
    if let Some(existing) = oz_core::Settings::get(conn, SETTINGS_SECRET)
        .map_err(|e| format!("reading {SETTINGS_SECRET}: {e}"))?
        .filter(|s| !s.trim().is_empty())
    {
        return Ok(existing);
    }
    let secret = new_secret();
    oz_core::Settings::set(conn, SETTINGS_SECRET, &secret)
        .map_err(|e| format!("persisting {SETTINGS_SECRET}: {e}"))?;
    tracing::info!("local API: generated new per-install signing secret");
    Ok(secret)
}

/// Replace the persisted per-install secret with a fresh one and return
/// it. Every token minted under the old key stops validating
/// immediately, and the operator `X-Admin-Key` changes with it — the
/// UI must warn before calling this (review MED-2: rotation is also
/// the recovery path when a backup carrying the old secret leaked).
pub fn rotate_secret(conn: &Connection) -> Result<String, String> {
    let secret = new_secret();
    oz_core::Settings::set(conn, SETTINGS_SECRET, &secret)
        .map_err(|e| format!("persisting {SETTINGS_SECRET}: {e}"))?;
    tracing::info!("local API: signing secret rotated — previously minted tokens are invalid");
    Ok(secret)
}

/// Mint an API token signed with the local secret.
///
/// `expiry_hours` is clamped to `1..=MAX_TOKEN_HOURS`. The token carries
/// no `permissions` claim (legacy full-read) — on a loopback-only bind
/// the operator is the tenant. Master-data writes still additionally
/// require `X-Admin-Key: <secret>` (the operator tier, D1).
pub fn mint_token(
    secret: &str,
    label: &str,
    expiry_hours: Option<i64>,
) -> Result<oz_api::auth::TokenResponse, String> {
    let hours = expiry_hours
        .unwrap_or(DEFAULT_TOKEN_HOURS)
        .clamp(1, MAX_TOKEN_HOURS);
    let label = if label.trim().is_empty() {
        "local-script"
    } else {
        label.trim()
    };
    oz_api::auth::create_token_full(label, Some(hours), None, None, None, Some(secret))
        .map_err(|e| format!("minting local API token: {e}"))
}

/// Binds `127.0.0.1:port` and serve the `oz-api` router until the
/// returned handle is stopped.
///
/// `port` 0 lets the OS choose (tests); the actual port is reported on
/// the handle. Binding is done BEFORE spawning so a port conflict
/// returns `Err` to the caller instead of dying in a background task.
pub async fn start(
    db: Arc<Mutex<Connection>>,
    db_path: PathBuf,
    image_dir: PathBuf,
    secret: String,
    port: u16,
) -> Result<LocalApiHandle, String> {
    start_with_audit(db, db_path, image_dir, secret, port, None).await
}

/// [`start`] with the write-audit sink (the merchant-visible record of
/// API mutations; see [`StoreAuditSink`]).
#[allow(clippy::too_many_arguments)]
pub async fn start_with_audit(
    db: Arc<Mutex<Connection>>,
    db_path: PathBuf,
    image_dir: PathBuf,
    secret: String,
    port: u16,
    audit: Option<Arc<dyn oz_api::api_audit::AuditSink>>,
) -> Result<LocalApiHandle, String> {
    // Bind BEFORE building the router so the self-documenting
    // /api/openapi.json handler can advertise the actual port
    // (OS-chosen when 0).
    let listener = TcpListener::bind(("127.0.0.1", port))
        .await
        .map_err(|e| format!("binding 127.0.0.1:{port}: {e}"))?;
    let bound_port = listener
        .local_addr()
        .map_err(|e| format!("reading bound address: {e}"))?
        .port();

    let api_state = oz_api::AppState {
        db,
        pg: None,
        // The per-install secret doubles as the operator admin key: token
        // minting over HTTP and master-data writes require X-Admin-Key.
        admin_key: Some(secret.clone()),
        api_secret: secret,
        db_path: db_path.display().to_string(),
        port: bound_port,
        // Device credentials are a cloud-fleet provisioning concept; a
        // terminal secret must not become a local-API credential the
        // operator never minted (review MED-5).
        allow_terminal_credentials: false,
        // Fail-closed: no browser origin may call the local API. Local
        // scripts (curl/Python/Node) do not send CORS preflights.
        cors_origins: Vec::new(),
        image_dir,
    };
    // Mirror serve()'s contract: the content-addressed image store must
    // exist before the image routes can write to it.
    std::fs::create_dir_all(&api_state.image_dir)
        .map_err(|e| format!("creating image dir {}: {e}", api_state.image_dir.display()))?;
    // The shared OpenAPI document (every operation `x-oz-scope: "both"`)
    // served locally — scripts can discover the contract from the
    // running server instead of the repo docs. Built once with the
    // actual bound port and registered INSIDE router()'s layer scope
    // (review MED-4: routes appended to the returned Router escape the
    // CORS/security-headers/trace layers).
    let app =
        oz_api::router_with_openapi(api_state, Some(oz_api::spec::local_spec(bound_port)), audit);

    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let task = tokio::spawn(async move {
        let serve = axum::serve(listener, app).with_graceful_shutdown(async move {
            let _ = shutdown_rx.await;
        });
        if let Err(e) = serve.await {
            tracing::error!(error = %e, "local API server exited with error");
        }
    });

    let base_url = format!("http://127.0.0.1:{bound_port}/api/v1");
    tracing::info!(port = bound_port, "local API server listening on loopback");
    Ok(LocalApiHandle {
        port: bound_port,
        base_url,
        shutdown: shutdown_tx,
        task,
    })
}

/// Wire status for the Settings UI — never carries the secret itself.
/// IPC DTO convention: camelCase on the wire (see `OfflineQueueSummaryDto`).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalApiStatus {
    /// Whether the setting is on (persisted intent).
    pub enabled: bool,
    /// Whether a server is currently listening.
    pub running: bool,
    /// The configured port (from settings, even when not running).
    pub port: u16,
    /// Base URL when running.
    pub base_url: Option<String>,
    /// The store currently served (resolved: configured or primary).
    pub store_id: String,
}

/// Audit sink writing API mutations into the SERVED store's
/// `audit_log` table, so script writes appear in the merchant's audit
/// review UI next to register actions.
///
/// `record` is fire-and-forget by contract (the trait): the INSERT is
/// spawned onto the local runtime; a failed write logs a warning and
/// never surfaces to the API client (the audit trail must not become a
/// request dependency). `user_id` carries the token LABEL — API tokens
/// are not bound to register users, and inventing a synthetic user row
/// would pollute the staff table.
pub struct StoreAuditSink {
    store: Arc<Mutex<Connection>>,
    store_id: String,
}

impl StoreAuditSink {
    /// Sink writing to the given store connection (the API's own
    /// dedicated WAL connection — same file the handlers mutate).
    pub fn new(store: Arc<Mutex<Connection>>, store_id: String) -> Self {
        Self { store, store_id }
    }
}

impl oz_api::api_audit::AuditSink for StoreAuditSink {
    fn record(&self, event: &oz_api::api_audit::ApiWriteEvent) {
        let store = self.store.clone();
        let store_id = self.store_id.clone();
        let event = event.clone();
        tokio::spawn(async move {
            // /api/v1/<segment>/<rest…> → target_type + target_id.
            let mut segs = event.path.trim_start_matches("/api/v1/").split('/');
            let target_type = segs.next().filter(|s| !s.is_empty()).map(str::to_string);
            let target_id = segs.next().filter(|s| !s.is_empty()).map(str::to_string);
            let details = serde_json::json!({
                "method": event.method,
                "path": event.path,
                "status": event.status,
                // NOT "token" — AUD-06 redacts that key name in details
                // payloads (correctly so, for every other writer).
                "token_label": event.token_label,
                "store_id": store_id,
            })
            .to_string();
            let entry = oz_core::AuditEntry {
                id: uuid::Uuid::now_v7().to_string(),
                user_id: event
                    .token_label
                    .clone()
                    .unwrap_or_else(|| "api".to_string()),
                action: "api.write".to_string(),
                target_type,
                target_id,
                details,
                outcome: if event.status < 400 {
                    "success"
                } else {
                    "failure"
                }
                .to_string(),
                created_at: chrono::Utc::now().to_rfc3339(),
            };
            let conn = store.lock().await;
            if let Err(e) = oz_core::Store::new(&conn).log_audit(&entry) {
                tracing::warn!(error = %e, "local API audit write failed");
            }
        });
    }
}

#[cfg(test)]
#[path = "lib_tests.rs"]
mod tests;
