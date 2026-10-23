//! Headless loopback REST API for kasir.mu, extracted from
//! `apps/desktop-tauri/src/local_api.rs` (Agent 1, Phase 1.2).
//!
//! Owns the settings-driven enable/port/secret resolution, the dedicated
//! per-store WAL connection and the `axum::serve` lifecycle on top of the
//! shared `kasirmu-api` router. No Tauri, windowing or GUI dependency, so a
//! headless binary can drive it directly.
//!
//! Entry points: `start` / `start_with_audit` (yield a `LocalApiHandle`
//! that can be signalled to stop), the minting and rotation helpers
//! (`mint_token`, `rotate_secret`, `load_or_create_secret`), and
//! `StoreAuditSink` for write auditing into the served store's `audit_log`.
//!
//! Local REST API server — embeds the `kasirmu-api` router on loopback so
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
//! `kasirmu_api::spec::local_spec()` — the shared contract with every
//! operation tagged `x-oz-scope: "both"`.

#![deny(unsafe_code)]

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use platform_core::StoreDatabaseManager;
use rusqlite::Connection;
use serde::Serialize;
use tokio::net::TcpListener;
use tokio::sync::{Mutex, mpsc, oneshot};

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
///
/// THE SAME NUMBER EXISTS IN TWO CRATES, deliberately, and they answer different
/// questions. `kasirmu_api::auth::MAX_TOKEN_HOURS` is the authoritative CEILING: it is
/// enforced inside `create_token_full`, which that module documents as "the single funnel
/// both mint doors pass through". This copy supplies the OPERATOR DOOR's clamp, which is
/// `clamp(1, MAX_TOKEN_HOURS)` -- a floor as well as a ceiling, because the IPC mint must
/// refuse a zero-length token. The api funnel enforces the ceiling only and says why: a
/// floor there "would break the legitimate use of this primitive to mint an ALREADY-EXPIRED
/// token". So neither copy can simply become the other.
///
/// They are kept in step by construction rather than by a constant reference:
/// `mint_token` clamps to this value and then delegates to `kasirmu_api::auth::create_token_full`,
/// which re-clamps to its own. The effective bound is therefore `min` of the two, and
/// `mint_token_roundtrip_and_clamp` asserts the minted lifetime equals THIS constant --
/// which fails if either copy moves in either direction. Verified by lowering the api copy
/// to 24: the test fails, so the coupling is real.
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
    match kasirmu_core::Settings::get(global, SETTINGS_STORE)
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
/// tokio Mutex, which is what `kasirmu_api::AppState` requires. WAL mode
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
    // PC-1: the id is validated where it is joined into a filename, so this door cannot open a
    // path the store id talked it into.
    let path = db_manager
        .checked_store_db_path(store_id)
        .map_err(|e| format!("preparing store db {store_id}: {e}"))?;
    let conn = Connection::open(&path).map_err(|e| format!("opening {}: {e}", path.display()))?;
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(|e| format!("enabling FK on {}: {e}", path.display()))?;
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| format!("enabling WAL on {}: {e}", path.display()))?;
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| format!("setting busy_timeout on {}: {e}", path.display()))?;
    Ok((Arc::new(Mutex::new(conn)), path))
}

/// The validated claims of a request's bearer token, or `None` when the
/// request carries no usable token.
///
/// Takes the `HeaderMap` rather than the whole `Request` on purpose: a
/// `Request` owns an `axum::body::Body`, which is not `Sync`, so borrowing one
/// across the `await` below would make this future `!Send` and the middleware
/// unusable as a `Router` layer. `HeaderMap` is `Sync`, so borrowing it is
/// free.
///
/// A validation failure is deliberately NOT an error here. The router's own
/// auth middleware owns the 401 taxonomy (`missing_token` / `invalid_token` /
/// `token_expired`) and must keep owning it; this helper exists only so the
/// guard below can ask what claims a token the REAL auth would accept carries.
/// It never turns a rejection into a different rejection, only adds one of its
/// own.
async fn bearer_claims(
    headers: &axum::http::HeaderMap,
    secret: &str,
) -> Option<kasirmu_api::auth::ApiTokenClaims> {
    let token = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())?
        .strip_prefix("Bearer ")?;
    kasirmu_api::auth::validate_token_with_secret(token, Some(secret))
        .await
        .ok()
}

/// Refuse a WRITE whose token carries a tenant claim this surface's own boot
/// check would reject (C34).
///
/// THE HAZARD. This surface serves exactly ONE store - the app's own
/// `store-{id}.sqlite` - and that store is the `default` tenant by
/// construction. `Store::check_tenant_integrity` refuses to start the app when
/// any `products` or `users` row carries another tenant, and it runs on every
/// launch. The shared `kasirmu-api` write routes stamp the request's tenant
/// claim onto the row they just wrote (`products.rs`, `users.rs`), so a single
/// request carrying a non-default claim can leave a row that makes the next
/// launch fail - a remote way to brick the install.
///
/// WHY THE CLAIM IS REACHABLE AT ALL. `mint_token` (the UI path) passes no
/// tenant, so a UI-minted token is safe. But the embedded router serves
/// `POST /api/v1/tokens` publicly, gated by the per-install secret - which
/// doubles as the operator admin key - and that mint takes `tenant_id`
/// straight from the request body. Nothing between the body and the stamp
/// knows this surface serves a single tenant. This layer is that knowledge.
///
/// WHY WRITES ONLY. A read carrying a foreign claim selects nothing here and
/// cannot affect the next boot, so GET/HEAD/OPTIONS keep their exact
/// behaviour. Only a write can plant the row the boot check rejects.
///
/// WHY `"default"` AND NOT JUST "not empty". The routes resolve the claim with
/// `claims.tenant_id.as_deref().unwrap_or("default")`, which maps `None` to the
/// accepted value but passes `Some("")` straight through - an empty claim
/// would stamp `tenant_id = ''`, which the boot check rejects exactly as a
/// named foreign tenant. So the ONLY two admitted values are an absent claim
/// and the literal `"default"`.
///
/// The guard is deliberately at the boundary rather than at each stamp: one
/// rule here covers `products`, `users`, `tax_rates` and any stamp site added
/// later, and it cannot drift from the routes it protects. It does not weaken
/// `check_tenant_integrity` - that invariant still refuses a genuinely
/// foreign-tenant store, which is what makes this a boundary guard rather than
/// a second implementation of the check.
async fn reject_foreign_tenant_writes(
    secret: &str,
    req: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    use axum::response::IntoResponse;

    let is_write = !matches!(req.method().as_str(), "GET" | "HEAD" | "OPTIONS");
    if is_write
        && let Some(claims) = bearer_claims(req.headers(), secret).await
        && let Some(tenant) = claims.tenant_id.as_deref()
        && tenant != "default"
    {
        tracing::warn!(
            tenant = %tenant,
            method = %req.method(),
            path = %req.uri().path(),
            "local API: refused a write carrying a non-default tenant claim - such a row would make the next app launch fail its tenant integrity check"
        );
        return (
            axum::http::StatusCode::FORBIDDEN,
            axum::Json(serde_json::json!({
                "error": "foreign_tenant_write",
                "message": "this local API serves a single store; a token scoped to another tenant cannot write here",
            })),
        )
            .into_response();
    }
    next.run(req).await
}

/// Mark every request on this surface as SINGLE-TENANT (C39).
///
/// The shared token route reads this marker and refuses a caller-supplied
/// `tenant_id`; the cloud server never inserts it, so the cloud mint keeps
/// accepting one. One line here, no branch in the route that could drift.
async fn mark_single_tenant(
    mut req: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    req.extensions_mut()
        .insert(kasirmu_api::routes::tokens::SingleTenantSurface);
    next.run(req).await
}

/// Read `local_api.enabled` from the settings table.
///
/// MSL-33: a failed READ is propagated, not answered `false`. The two used
/// to be the same thing because `.unwrap_or(None)` mapped every
/// `rusqlite::Error` to "no such key" — but this is the flag that decides
/// whether an HTTP surface is exposed at all, and a wrong `false` is the one
/// direction that is NOT safe here: it is silent (the merchant ticked the
/// box and the API simply never came up) and it is the opposite of the
/// sibling `load_or_create_secret`, which has always propagated the same
/// read. The `local_api.enabled = "0"` case still answers `false` — that is a
/// value, not a failure.
pub fn is_enabled(conn: &Connection) -> Result<bool, String> {
    let raw = kasirmu_core::Settings::get(conn, SETTINGS_ENABLED)
        .map_err(|e| format!("reading {SETTINGS_ENABLED}: {e}"))?;
    Ok(raw.as_deref() == Some("1"))
}

/// Read and validate `local_api.port`; falls back to [`DEFAULT_PORT`] when
/// the key is absent or unparseable.
///
/// MSL-33: a failed READ propagates (same reasoning as [`is_enabled`]). An
/// ABSENT or unparseable value still falls back to [`DEFAULT_PORT`] — that is
/// a stored value this function is specified to reject, not a database fault,
/// and it is what `resolve_port_defaults_and_validates` pins.
pub fn resolve_port(conn: &Connection) -> Result<u16, String> {
    let Some(raw) = kasirmu_core::Settings::get(conn, SETTINGS_PORT)
        .map_err(|e| format!("reading {SETTINGS_PORT}: {e}"))?
    else {
        return Ok(DEFAULT_PORT);
    };
    Ok(raw
        .trim()
        .parse::<u16>()
        .ok()
        .filter(|p| (1024..=65535).contains(p))
        .unwrap_or(DEFAULT_PORT))
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
///
/// **Encrypted at rest as of C14(a).** The value used to be written by a bare
/// `Settings::set`, so it sat in cleartext in `settings.value` and in every
/// unfiltered `.db` / `.backup.db` snapshot — while doubling as the token
/// signing key and the operator admin key. Two things happen here now:
///
/// 1. A **legacy plaintext row is migrated in place** before it is read, so an
///    existing install stops leaking on its next boot rather than waiting for an
///    operator to rotate. The migration is idempotent and cannot double-encrypt:
///    the ciphertext form (124 base64url chars) and the legacy form (64 lowercase
///    hex chars) are disjoint on both length and alphabet.
/// 2. A **newly generated** secret is written through the encrypting setter.
pub fn load_or_create_secret(conn: &Connection) -> Result<String, String> {
    match platform_core::settings::Settings::migrate_local_api_secret(conn) {
        Ok(true) => tracing::info!(
            "local API: migrated the per-install signing secret to encrypted-at-rest storage (C14a)"
        ),
        Ok(false) => {}
        // A failed migration must not stop the API loading its secret: the read
        // below still works, and the next boot retries.
        Err(e) => tracing::warn!(
            error = %e,
            "local API: could not migrate the signing secret to encrypted storage; continuing"
        ),
    }

    if let Some(existing) = kasirmu_core::Settings::get_local_api_secret(conn)
        .map_err(|e| format!("reading {SETTINGS_SECRET}: {e}"))?
        .filter(|s| !s.trim().is_empty())
    {
        return Ok(existing);
    }
    let secret = new_secret();
    kasirmu_core::Settings::set_local_api_secret(conn, &secret)
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
    kasirmu_core::Settings::set_local_api_secret(conn, &secret)
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
) -> Result<kasirmu_api::auth::TokenResponse, String> {
    let hours = expiry_hours
        .unwrap_or(DEFAULT_TOKEN_HOURS)
        .clamp(1, MAX_TOKEN_HOURS);
    let label = if label.trim().is_empty() {
        "local-script"
    } else {
        label.trim()
    };
    kasirmu_api::auth::create_token_full(label, Some(hours), None, None, None, Some(secret))
        .map_err(|e| format!("minting local API token: {e}"))
}

/// Binds `127.0.0.1:port` and serve the `kasirmu-api` router until the
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
    audit: Option<Arc<dyn kasirmu_api::api_audit::AuditSink>>,
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

    let api_state = kasirmu_api::AppState {
        db,
        pg: None,
        // The per-install secret doubles as the operator admin key: token
        // minting over HTTP and master-data writes require X-Admin-Key.
        admin_key: Some(secret.clone()),
        // Cloned so the C34 boundary layer below can validate with the very
        // same secret the router's auth middleware uses.
        api_secret: secret.clone(),
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
    let app = kasirmu_api::router_with_openapi(
        api_state,
        Some(kasirmu_api::spec::local_spec(bound_port)),
        audit,
    )
    // C34: the embedded surface must not let a request write a tenant value
    // its OWN boot check will reject. Applied here (outside the router) so it
    // runs BEFORE the router's auth layer, which means it sees the request
    // even when the token is one the auth layer would accept - and it never
    // needs the router to expose its claims. See
    // [`reject_foreign_tenant_writes`] for why the claim is reachable and why
    // only writes are gated.
    .layer(axum::middleware::from_fn({
        let guard_secret = Arc::new(secret);
        move |req: axum::extract::Request, next: axum::middleware::Next| {
            let guard_secret = guard_secret.clone();
            async move { reject_foreign_tenant_writes(&guard_secret, req, next).await }
        }
    }))
    // C39: declare this surface single-tenant, so the shared token route
    // refuses a caller-supplied `tenant_id` instead of minting a token this
    // store can never honour.
    //
    // Order against the C34 guard is immaterial: `Router::layer` makes the
    // LAST call outermost, so this marker runs before the guard, and the two
    // are independent anyway - the guard reads the TENANT CLAIM off the
    // bearer token, the marker writes an extension the token route reads.
    .layer(axum::middleware::from_fn(mark_single_tenant))
    // The guard is the OUTERMOST layer, so its refusal short-circuits before
    // the router's own security-headers layer runs and would otherwise be the
    // one response on this surface without them (the MED-4 finding: anything
    // outside the router's layer scope escapes it). Re-applying the SAME
    // public middleware here - rather than copying its header list - keeps one
    // definition of what those headers are; the insert is idempotent for every
    // response that already passed through the inner copy.
    .layer(axum::middleware::from_fn(
        kasirmu_api::security_headers_middleware,
    ));

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

// ── O-M46: the audit sink's own connection and single writer ──────────────

/// How many audit events may wait for the writer at once.
const AUDIT_CHANNEL_CAPACITY: usize = 1024;

/// One message for the single audit writer.
enum AuditMsg {
    /// Insert this row.
    Row(AuditRow),
    /// Drain what is already queued, then stop.
    Flush(oneshot::Sender<()>),
}

/// A queued audit event, already reduced to the row it will become.
///
/// The row is built on the REQUEST path, not in the writer. That keeps the
/// facts the event describes — and `created_at` — at observation time
/// instead of at dequeue time, so a queue that is momentarily backed up does
/// not silently re-time the audit trail.
struct AuditRow(kasirmu_core::AuditEntry);

/// Audit writers still alive (incremented before the writer is spawned,
/// decremented when it exits).
static LIVE_AUDIT_WRITERS: AtomicU64 = AtomicU64::new(0);
/// Highest concurrent writer count seen while a sink was RUNNING.
static PEAK_AUDIT_WRITERS: AtomicU64 = AtomicU64::new(0);

/// Wait until every audit writer has drained and stopped.
///
/// The writer is a SPAWNED task, so nothing tells a caller when the rows it
/// just enqueued were actually committed. This is the test's handle on that:
/// drop every [`StoreAuditSink`] and await this, and every row the sinks
/// accepted is on disk or counted as a failure. The API surface never waits
/// on it.
pub async fn await_audit_writers() {
    while LIVE_AUDIT_WRITERS.load(Ordering::Acquire) > 0 {
        tokio::task::yield_now().await;
    }
}

/// Audit sink writing API mutations into the SERVED store's
/// `audit_log` table, so script writes appear in the merchant's audit
/// review UI next to register actions.
///
/// # O-M46 — why this is not "spawn a task per event"
///
/// The previous shape spawned one task per `record` and let every one of
/// them contend for the HANDLERS' `Arc<Mutex<Connection>>`. Every mutating
/// request therefore queued an extra blocking `INSERT` behind the single
/// connection the handlers use — an audit write could sit in front of the
/// next merchant read — and the number of in-flight tasks was bounded only by
/// the request rate.
///
/// There are now two separate things:
///
/// 1. **A dedicated connection** ([`StoreAuditSink::open`], or derived from
///    the handler connection by [`StoreAuditSink::new`]). It never touches the
///    handlers' mutex, so an audit INSERT can no longer queue a handler behind
///    it or vice versa. It is opened WAL + `busy_timeout(5s)` — the same
///    PRAGMAs [`open_api_store_connection`] puts on the handler connection —
///    because it writes the same file: busy_timeout is what makes a second
///    writer WAIT for the other rather than fail with `SQLITE_BUSY`.
/// 2. **A bounded channel drained by ONE writer task** that does blocking IO on
///    `spawn_blocking`. Serialising the writes is not merely tidy: the audit
///    chain hash reads the previous row's hash, so concurrent writers are not
///    guaranteed to link in commit order. One writer links in the order the
///    events were observed.
///
/// # What happens when the channel is FULL: `record` BLOCKS
///
/// The alternative is to drop and count the drop. For an audit trail a hole is
/// the failure mode that matters — an event that happened and was not recorded
/// cannot be distinguished from an event that never happened — so this sink
/// never discards an event: `record` waits for room and the wait is the
/// back-pressure on the request that produced the event.
///
/// The consequence is stated plainly: **sustained audit throughput above what
/// one SQLite connection can absorb turns into added request latency, not
/// memory growth.** A localised defect (disk full, corrupt file, a database
/// locked by another process) still cannot wedge the surface indefinitely: the
/// INSERT itself is bounded by the connection's 5 s `busy_timeout`, after
/// which it fails and returns the writer to the queue.
///
/// `record` is unusual among [`kasirmu_api::api_audit::AuditSink`]
/// implementations in that it may block briefly when the queue is saturated;
/// that is the deliberate trade recorded above, not an oversight.
///
/// # Failures are COUNTED
///
/// A failed write used to be a `tracing::warn!` and nothing else, so a
/// persistently failing audit trail was invisible outside the log. Every
/// failure now increments the sink's shared counter, which can be read with
/// [`StoreAuditSink::failure_count`] and is emitted on a rate-limited cadence
/// (first failure immediately, then at most once per
/// `AUDIT_FAILURE_REPORT_EVERY` for a persistent fault). Every increment
/// also logs at ERROR with the running total, so "one blip" and "broken for an
/// hour" are distinguishable from the log alone.
///
/// `user_id` carries the token LABEL — API tokens are not bound to register
/// users, and inventing a synthetic user row would pollute the staff table.
pub struct StoreAuditSink {
    tx: mpsc::Sender<AuditMsg>,
    store_id: String,
    failures: Arc<AtomicU64>,
    reports: Arc<AtomicU64>,
    writers_spawned: Arc<AtomicU64>,
    /// Set by the writer just before it exits.
    #[allow(dead_code)]
    shutdown: Option<Arc<std::sync::atomic::AtomicBool>>,
}

/// Emit the failure counter at most once per this many failures, so a
/// persistent fault reports but does not flood.
const AUDIT_FAILURE_REPORT_EVERY: u64 = 100;

/// How long [`StoreAuditSink::flush_inner`] waits for the writer before
/// giving up and reporting that it did.
const AUDIT_FLUSH_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

impl StoreAuditSink {
    /// Sink writing to the given store connection (the API's own
    /// dedicated WAL connection — same file the handlers mutate).
    ///
    /// O-M46: the connection is used ONCE, to seed a dedicated audit
    /// connection on the same file; the sink holds no handle on `store`
    /// afterwards, so audit writes cannot queue behind a handler.
    pub fn new(store: Arc<Mutex<Connection>>, store_id: String) -> Self {
        // ONE non-blocking attempt at the path. It must never WAIT for the
        // handler lock: `new` is called from a runtime thread, and a handler
        // holding the connection across a commit is exactly the state a
        // waiting constructor would deadlock on. A busy lock means a live
        // handler is already using the file, so the shared-connection path
        // below is correct (and safe) for this call.
        let path = store
            .try_lock()
            .ok()
            .and_then(|conn| conn.path().map(PathBuf::from))
            .filter(|p| !p.as_os_str().is_empty());
        match path {
            Some(path) => match Self::open(&path, store_id.clone()) {
                Ok(sink) => sink,
                // The file will not take a second connection: keep the sink
                // (and its counted failures) alive rather than refusing.
                Err(e) => Self::unavailable(&e, store_id),
            },
            // A bare in-memory connection (tests) has no file a second
            // connection could reach. Fall back to the handlers' connection
            // rather than refusing to audit at all.
            None => Self::with_shared_connection(store, store_id),
        }
    }

    /// Sink writing through its OWN connection to `path`.
    ///
    /// This is what [`start`] / [`start_with_audit`] use, and it is how the
    /// app should build the sink: the audit trail then neither waits on, nor
    /// is delayed by, the handler connection. The file must already be
    /// migrated (the caller has opened it through [`open_api_store_connection`]).
    pub fn open(path: &std::path::Path, store_id: String) -> Result<Self, String> {
        let conn = Connection::open(path)
            .map_err(|e| format!("opening audit connection to {}: {e}", path.display()))?;
        conn.pragma_update(None, "foreign_keys", "ON")
            .map_err(|e| format!("enabling FK on {}: {e}", path.display()))?;
        conn.pragma_update(None, "journal_mode", "WAL")
            .map_err(|e| format!("enabling WAL on {}: {e}", path.display()))?;
        // THE setting that makes a second writer safe: without it a
        // concurrent handler commit fails the audit write with SQLITE_BUSY
        // instead of waiting for it.
        conn.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|e| format!("setting busy_timeout on {}: {e}", path.display()))?;
        Ok(Self::start_writer(std::sync::Mutex::new(conn), store_id))
    }

    /// Sink writing through the handlers' connection.
    ///
    /// Still serialises on the channel, and still counts failures, but the
    /// INSERT runs behind the handlers' mutex — keep this for connections
    /// no second handle can reach (a bare `:memory:` database in tests).
    pub fn with_shared_connection(store: Arc<Mutex<Connection>>, store_id: String) -> Self {
        struct Shared(Arc<Mutex<Connection>>);

        impl AuditTarget for Shared {
            /// Blocking, not async: the writer already runs this on a blocking
            /// thread, and tokio's blocking_lock is the wait that is legal
            /// there - it parks that thread, never a reactor worker.
            fn insert(&self, entry: &kasirmu_core::AuditEntry) -> Result<(), String> {
                let conn = self.0.blocking_lock();
                kasirmu_core::Store::new(&conn)
                    .log_audit(entry)
                    .map_err(|e| e.to_string())
            }
        }

        Self::start_writer(Shared(store), store_id)
    }

    /// How many writer tasks have been spawned for this sink.
    #[must_use]
    pub fn writers_spawned(&self) -> u64 {
        self.writers_spawned.load(Ordering::Acquire)
    }

    /// How many audit writes this sink has failed to persist.
    ///
    /// THE readable signal for a broken audit trail - the counter the old
    /// `tracing::warn!` was the only trace of. Monotonic for the life of the
    /// sink; a row that fails here is a row that is NOT in `audit_log`, so
    /// anything above zero means the trail has a hole.
    #[must_use]
    pub fn failure_count(&self) -> u64 {
        self.failures.load(Ordering::Relaxed)
    }

    /// How many rows are queued behind the writer right now (0 when idle).
    ///
    /// The backlog that `record`'s block-on-full policy lets build. A value
    /// that stays near `AUDIT_CHANNEL_CAPACITY` means requests are waiting
    /// on the audit trail - added latency, no lost rows.
    #[must_use]
    pub fn backlog(&self) -> usize {
        self.tx.max_capacity() - self.tx.capacity()
    }

    /// Wait until this sink's writer has committed every row it accepted.
    ///
    /// The rows are written by a SPAWNED task, so accepting an event does not
    /// mean it is in `audit_log` yet. This waits for the writer to drain and
    /// exit — the readable end of the queue, and what the tests below use to
    /// assert "nothing recorded was lost" rather than "nothing was lost yet".
    /// With no runtime there is nothing to wait on and the call returns
    /// immediately.
    pub async fn flush(&self) {
        if let Err(e) = self.flush_inner().await {
            // Never a warn-and-hope: the caller is told the trail may be
            // short, and failure_count already says how much is missing.
            tracing::error!(error = %e, "local API audit flush did not complete");
        }
    }

    /// [`Self::flush`] with the failure handed back instead of logged.
    ///
    /// Bounded, deliberately. Flushing is a diagnostic/shutdown convenience,
    /// and a flush that waits forever is strictly worse than one that says it
    /// gave up: the writer could be wedged on a locked database, and a caller
    /// - including a test - must be told rather than hang.
    pub async fn flush_inner(&self) -> Result<(), String> {
        let deadline = tokio::time::Instant::now() + AUDIT_FLUSH_TIMEOUT;
        // An idle sink is already durable: do not enqueue a barrier behind
        // events nobody is going to send.
        if self.tx.max_capacity() == self.tx.capacity() {
            return Ok(());
        }
        let (reply_tx, reply_rx) = oneshot::channel();
        tokio::time::timeout_at(deadline, self.tx.send(AuditMsg::Flush(reply_tx)))
            .await
            .map_err(|_| "audit queue stayed full for the whole flush window".to_string())?
            .map_err(|_| "audit writer is gone".to_string())?;
        tokio::time::timeout_at(deadline, reply_rx)
            .await
            .map_err(|_| "audit writer did not drain in time".to_string())?
            .map_err(|_| "audit writer dropped reply".to_string())
    }

    fn unavailable(why: &str, store_id: String) -> Self {
        tracing::error!(
            error = %why,
            store_id = %store_id,
            "local API audit sink could not open its own connection; every audit write will be counted as a failure"
        );
        Self::start_writer(Unavailable, store_id)
    }

    fn start_writer(target: impl AuditTarget, store_id: String) -> Self {
        let (tx, rx) = mpsc::channel::<AuditMsg>(AUDIT_CHANNEL_CAPACITY);
        let failures = Arc::new(AtomicU64::new(0));
        let reports = Arc::new(AtomicU64::new(0));
        let writers_spawned = Arc::new(AtomicU64::new(1));
        let shutdown = Arc::new(std::sync::atomic::AtomicBool::new(false));
        // A WEAK view of our own sender: the writer must not keep the channel
        // alive, or it would be the one sender that never goes away.
        let tx_watch = tx.clone();
        let writer_failures = failures.clone();
        let writer_reports = reports.clone();
        LIVE_AUDIT_WRITERS.fetch_add(1, Ordering::AcqRel);
        // Honour `record`'s "never panic" contract: if there is no runtime to
        // spawn on, say so through the counter instead of panicking.
        let writer_shutdown = shutdown.clone();
        let spawned = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            tokio::spawn(run_audit_writer(
                rx,
                target,
                writer_failures,
                writer_reports,
                writer_shutdown,
                tx_watch.downgrade(),
            ))
        }));
        if spawned.is_err() {
            LIVE_AUDIT_WRITERS.fetch_sub(1, Ordering::AcqRel);
            writers_spawned.store(0, Ordering::Release);
            count_audit_failure(&failures, &reports, "no runtime for the audit writer");
        }
        Self {
            tx,
            store_id,
            failures,
            reports,
            writers_spawned,
            shutdown: Some(shutdown),
        }
    }
}

impl kasirmu_api::api_audit::AuditSink for StoreAuditSink {
    fn record(&self, event: &kasirmu_api::api_audit::ApiWriteEvent) {
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
            "store_id": self.store_id,
        })
        .to_string();
        let entry = kasirmu_core::AuditEntry {
            id: kasirmu_core::new_id(),
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

        // Fast path: room in the queue, no yield at all.
        let msg = AuditMsg::Row(AuditRow(entry));
        match self.tx.try_send(msg) {
            Ok(()) => {}
            // FULL: park the request until the writer frees a slot. This is
            // the back-pressure described on the type — the event is delayed,
            // never dropped. `record` is sync, so "parking" means publishing
            // the pending event to the writer and awaiting it; the handed-off
            // event needs no clone.
            Err(mpsc::error::TrySendError::Full(msg)) => self.await_room(msg),
            Err(mpsc::error::TrySendError::Closed(_)) => {
                count_audit_failure(&self.failures, &self.reports, "audit writer is gone");
            }
        }
    }
}

impl StoreAuditSink {
    /// Hand `msg` to the writer once the full queue has room for it.
    ///
    /// The blocking path of [`kasirmu_api::api_audit::AuditSink::record`],
    /// and the reason this sink never loses an event. Three cases:
    ///
    /// * there is a runtime to park on — `send().await` waits for a slot and
    ///   the request that produced the event waits with it;
    /// * there is NOT (a sync caller outside any runtime) — the event is
    ///   parked in [`PENDING_AUDIT`] and the next `record` on a runtime
    ///   thread publishes it, so the event is still not lost, only late;
    /// * the writer is gone — the event is counted as a failure, never
    ///   silently discarded.
    fn await_room(&self, msg: AuditMsg) {
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            let tx = self.tx.clone();
            let failures = self.failures.clone();
            let reports = self.reports.clone();
            handle.spawn(Self::drain_parked_then_send(tx, failures, reports, msg));
            return;
        }

        // No runtime on this thread. Park the event, but BOUND the parking:
        // "block, never drop" is a promise to never lose an event while the
        // trail is alive, not a licence to grow unboundedly when nobody can
        // ever drain it. An overflow is therefore a COUNTED loss, reported at
        // ERROR, not a silent one.
        let overflowed = PENDING_AUDIT.lock().is_ok_and(|mut q| {
            if q.len() >= AUDIT_CHANNEL_CAPACITY {
                true
            } else {
                q.push_back(msg);
                false
            }
        });
        if overflowed {
            count_audit_failure(
                &self.failures,
                &self.reports,
                "audit queue full with no runtime to wait on it",
            );
        }
    }

    /// Publish anything parked by a runtime-less caller, then `msg`, each in
    /// turn (waiting for a slot when the queue is full), then keep draining.
    async fn drain_parked_then_send(
        tx: mpsc::Sender<AuditMsg>,
        failures: Arc<AtomicU64>,
        reports: Arc<AtomicU64>,
        msg: AuditMsg,
    ) {
        // Publish what an earlier runtime-less caller left behind
        // first, so the queue stays in observation order.
        let parked: Vec<AuditMsg> = PENDING_AUDIT
            .lock()
            .map(|mut q| q.drain(..).collect())
            .unwrap_or_default();

        let write_failures = failures.clone();
        let write_reports = reports.clone();
        for next in parked.into_iter().chain(std::iter::once(msg)) {
            // O-M46: `is_closed()` BEFORE `send().await`, and the order is the
            // whole fix. Sending to a CLOSED tokio channel never resolves the
            // future: once the queue is empty and the receiver is gone, the
            // sender is parked and stays parked. `send().await` alone therefore
            // HUNG this task forever whenever the writer had already exited —
            // and because the task was spawned onto the shared runtime, runtime
            // shutdown then blocked waiting for it, so the TEST PROCESS hung with
            // no failing test named. Two tests in this file hung that way.
            //
            // Checking first turns that into a counted failure, which is what the
            // contract says a dead writer is. `is_closed()` can still race a close
            // that happens between the check and the send, so the send arm keeps
            // its error handling too.
            if tx.is_closed() {
                count_audit_failure(&write_failures, &write_reports, "audit writer is gone");
                return;
            }
            if tx.send(next).await.is_err() {
                count_audit_failure(&write_failures, &write_reports, "audit writer is gone");
                return;
            }
        }
        // Anything parked while this task was running.
        loop {
            let next = PENDING_AUDIT.lock().ok().and_then(|mut q| q.pop_front());
            let Some(next) = next else { return };
            if tx.is_closed() {
                count_audit_failure(&write_failures, &write_reports, "audit writer is gone");
                return;
            }
            if tx.send(next).await.is_err() {
                count_audit_failure(&write_failures, &write_reports, "audit writer is gone");
                return;
            }
        }
    }
}

/// Events parked by [`StoreAuditSink::await_room`] when no runtime existed to
/// wait on the full queue (a sync caller outside Tokio).
static PENDING_AUDIT: std::sync::Mutex<std::collections::VecDeque<AuditMsg>> =
    std::sync::Mutex::new(std::collections::VecDeque::new());

/// Where a queued row is written.
trait AuditTarget: Send + Sync + 'static {
    /// Insert one row. `Err` is the failure the counter records.
    fn insert(&self, entry: &kasirmu_core::AuditEntry) -> Result<(), String>;
}

impl AuditTarget for std::sync::Mutex<Connection> {
    fn insert(&self, entry: &kasirmu_core::AuditEntry) -> Result<(), String> {
        kasirmu_core::Store::new(&crate::unpoisoned_lock(self))
            .log_audit(entry)
            .map_err(|e| e.to_string())
    }
}

/// The target of a sink that could not open its connection: every row fails,
/// and every failure is counted.
struct Unavailable;

impl AuditTarget for Unavailable {
    fn insert(&self, _entry: &kasirmu_core::AuditEntry) -> Result<(), String> {
        Err("audit connection unavailable".to_string())
    }
}

fn count_audit_failure(failures: &AtomicU64, reports: &AtomicU64, why: &str) {
    let total = failures.fetch_add(1, Ordering::Relaxed) + 1;
    let first = total == 1;
    let due = total.is_multiple_of(AUDIT_FAILURE_REPORT_EVERY);
    if first || due {
        reports.fetch_add(1, Ordering::Relaxed);
        tracing::error!(
            total,
            "local API audit write failed; audit trail is incomplete (see StoreAuditSink::failure_count)"
        );
    } else {
        tracing::debug!(total, error = %why, "local API audit write failed");
    }
}

/// The single writer: one event at a time, in enqueue order.
async fn run_audit_writer(
    mut rx: mpsc::Receiver<AuditMsg>,
    target: impl AuditTarget,
    failures: Arc<AtomicU64>,
    reports: Arc<AtomicU64>,
    shutdown: Arc<std::sync::atomic::AtomicBool>,
    sender: mpsc::WeakSender<AuditMsg>,
) {
    let target = Arc::new(target);
    let tx_closed = sender.strong_count() == 0;
    drop(sender);
    PEAK_AUDIT_WRITERS.fetch_max(LIVE_AUDIT_WRITERS.load(Ordering::Acquire), Ordering::AcqRel);
    loop {
        let msg = match rx.try_recv() {
            Ok(msg) => msg,
            Err(mpsc::error::TryRecvError::Empty)
                // WRITER LIFETIME. A sink is the only thing that can send;
                // once every sink is dropped, nothing can ever fill the queue
                // again, and a writer that keeps receiving would leave
                // exactly one parked "flush" behind it - the state in which a
                // blocked `record` waits forever for a drainer that no longer
                // exists. So an EMPTY channel with no senders left ends the
                // writer.
                if tx_closed =>
            {
                break;
            }
            Err(mpsc::error::TryRecvError::Empty) => match rx.recv().await {
                Some(msg) => msg,
                // Last sender dropped while we waited: the queue is drained
                // and nothing can refill it.
                None => break,
            },
            Err(mpsc::error::TryRecvError::Disconnected) => break,
        };
        match msg {
            AuditMsg::Flush(reply) => {
                let _ = reply.send(());
                break;
            }
            AuditMsg::Row(row) => {
                let AuditRow(entry) = row;
                let target = target.clone();
                let write_failures = failures.clone();
                let write_reports = reports.clone();
                // `log_audit` is blocking IO; keep it off the reactor.
                let done = tokio::task::spawn_blocking(move || {
                    if let Err(e) = target.insert(&entry) {
                        count_audit_failure(&write_failures, &write_reports, &e);
                    }
                })
                .await;
                if done.is_err() {
                    count_audit_failure(&failures, &reports, "audit writer task panicked");
                }
            }
        }
    }
    shutdown.store(true, Ordering::Release);
    LIVE_AUDIT_WRITERS.fetch_sub(1, Ordering::AcqRel);
}

/// Take a lock that a panic cannot have left in a state worth refusing.
///
/// The audit writer must never panic, and a poisoned lock would turn one
/// earlier panic into a permanent audit outage — the one failure mode an
/// audit trail must not have. The guarded value is a `Connection` whose
/// usability is decided by SQLite on the next statement, not by the poison
/// flag, so recovering it here is safe.
fn unpoisoned_lock<T>(m: &std::sync::Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[cfg(test)]
#[path = "lib_tests.rs"]
mod tests;

#[cfg(test)]
struct AlwaysFails;

#[cfg(test)]
impl AuditTarget for AlwaysFails {
    fn insert(&self, _entry: &kasirmu_core::AuditEntry) -> Result<(), String> {
        Err("synthetic audit write failure".to_string())
    }
}
