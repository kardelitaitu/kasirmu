/*
last audited DD-MM-YY by DSH-Agent (consolidated from 25-07-26 + 12-07-27 stamps)
crate: desktop-client | status: SAFE | lint: CLEAN
findings: DB connection with foreign_keys ON + WAL (documented); kernel Drop with bounded lock-retry; test-only in-memory mock constructor. Prior findings preserved: unsafe env::set_var removed (C-2), terminal_id typed field, M-4 logging, M-5 plugin task handle. 0 production unwrap/expect (the in-memory Connection::open_in_memory().unwrap() at state.rs is test-constructor scope).
next: SQLCipher (carried) | perf: Arc-clones on checkout hot path (carried)
*/

//! `AppState` — the long-lived state managed by Tauri and reached via
//! `State<'_, AppState>` in every command.
//!
//! Holds:
//! - A `rusqlite::Connection` (behind a `tokio::sync::Mutex`) for DB access.
//! - A `DriverRegistry` from `kasirmu_hal` for hardware access.
//! - The Tauri `AppHandle` for emitting events back to the front-end.
//!
//! `AppState::new` opens the local SQLite database, runs migrations, and
//! creates an empty `DriverRegistry`. `AppState::new` does not populate it:
//! the registry is filled after `manage()` by the hardware bootstrap daemon
//! in `lib.rs`, which reads the saved `TerminalProfile` through
//! `platform_startup::hardware`. The field starts empty so a failure to read
//! the profile cannot prevent the app from starting, and the front end never
//! assumes a particular device is present.
//!
//! # Connection pooling
//!
//! The `Mutex<Connection>` here is a single-connection placeholder. A
//! real deployment will switch to `r2d2_sqlite` or `deadpool-sqlite`
//! so that Tauri commands can issue concurrent reads (the `rust-backend`
//! skill prescribes this; switching is mechanical).
//!
//! # Sync primitive convention (M-1)
//!
//! | Primitive | Where | Why |
//! |-----------|-------|-----|
//! | `tokio::sync::Mutex` | Every async-accessible field (`db`, `kernel`, `plugins`, `scanner_cancel`, `terminal_id`) | `.lock().await` is required in Tauri command handlers; calling `.lock()` on `std::sync::Mutex` from async code blocks the tokio worker thread. |
//! | `std::sync::RwLock` | `session_store`, `kds_queue_cache` (both behind `Arc`) | Accessed from both sync (`resolve_session`, `create_session`) and async (`session cleanup daemon`) code. `tokio::sync::RwLock::read()` would panic if called from sync context without a blocking wrapper. Keep `std::sync::RwLock` and wrap async access with `tokio::task::spawn_blocking` when necessary. `kds_queue_cache` is the same shape for a sharper reason: its reader is the LAN `KdsQueueProvider`, a plain `Fn()` running synchronously inside the per-peer accept task — no await is possible there. |
//! | `std::sync::mpsc` | `inventory_pubsub_shutdown` only | Used from `Drop` which is sync-only. Tokio channels don't implement `Sync` and would require an async `Drop` bound. |
//! | `Arc<AtomicBool>` | Plugin reload flag | Lock-free flag set by the `notify` callback (sync) and consumed by the tokio loop (async). Correct by design — no `.lock()` at all. |
//!
//! **Rule of thumb:** When adding a new field to `AppState`, default to
//! `tokio::sync::Mutex` unless the field is accessed exclusively from
//! sync code (e.g. `Drop`, `notify` callbacks). If you must use
//! `std::sync::Mutex`, document why in the field's doc comment.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::RwLock;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use kasirmu_security::mask::mask_token;

use kasirmu_core::cache::Cache;
use kasirmu_plugin::PluginManager;
use notify::Watcher as _;

use rusqlite::Connection;
use rusqlite::OptionalExtension;
use tauri::AppHandle;
use tauri::Manager;
use tokio::sync::{Mutex, oneshot};

use kasirmu_core::migrations;
use kasirmu_core::session::SessionContext;
use kasirmu_hal::DriverRegistry;
use platform_core::StoreDatabaseManager;
use platform_kernel::Kernel;
use platform_sync::daemon::SyncDaemon;
use platform_sync::pg_daemon::PgSyncDaemon;

use crate::error::AppError;

/// Shared application state.
pub struct AppState {
    /// SQLite connection for the local store. Wrapped in `Arc<Mutex<..>>` so
    /// the background sync daemon can hold a reference.
    pub db: Arc<Mutex<Connection>>,

    /// HAL driver registry. Use `state.registry.scanner(id)` etc.
    pub registry: Arc<DriverRegistry>,

    /// Tauri app handle, used for emitting events to the front-end.
    /// `None` in test or headless contexts where no UI is attached.
    pub app: Option<AppHandle>,

    /// Path to the SQLite database file (for diagnostics + `kasirmu-cli` reuse).
    pub db_path: PathBuf,

    /// Cancel-sender for the active barcode scanner background task.
    /// When `Some`, the scanner polling loop is running; dropping
    /// or signalling it stops the loop gracefully.
    pub scanner_cancel: Mutex<Option<oneshot::Sender<()>>>,

    /// Module system kernel. Manages module lifecycle (load → start → stop).
    /// Modules are registered in `lib.rs::run()` during setup.
    pub kernel: Mutex<Kernel>,

    /// Optional plugin manager for custom Lua business rules.
    /// `None` when no `plugins/` directory exists or loading failed.
    /// Wrapped in an `Arc<Mutex>` to share with background hot-reload task.
    pub plugins: Arc<Mutex<Option<PluginManager>>>,

    /// Plugin file watcher (kept alive to prevent dropping).
    pub plugin_watcher: Option<notify::RecommendedWatcher>,

    /// Join handle for the plugin hot-reload background task. Aborted on
    /// [`AppState::drop`] to stop the loop gracefully (M-5).
    pub plugin_hot_reload_task: Option<tokio::task::JoinHandle<()>>,

    /// Background sync daemon. Started during app setup via
    /// [`SyncDaemon::start`](platform_sync::daemon::SyncDaemon::start).
    pub sync_daemon: SyncDaemon,

    /// Background PostgreSQL sync daemon (the optional PG transport).
    /// Started during app setup alongside the HTTP daemon; its tick loop
    /// no-ops while `pg_sync.enabled` is off. The `pg_sync_*` commands
    /// start/stop it and read its status.
    pub pg_sync_daemon: PgSyncDaemon,

    /// Caching layer (Redis-backed when configured, no-op otherwise).
    /// Shared across all `Store` instances via `Arc`.
    pub cache: Arc<dyn Cache>,

    /// Store-scoped database manager (ADR #4 Phase 2).
    ///
    /// Manages per-store SQLite files created when additional stores
    /// are added. The global database (locations, users, terminals)
    /// is accessed via `db_manager.global()`.
    pub db_manager: StoreDatabaseManager,

    /// Shutdown sender for the inventory pub/sub background listener.
    /// Dropped on app shutdown to stop the listener thread gracefully.
    pub inventory_pubsub_shutdown: Option<std::sync::mpsc::Sender<()>>,

    /// Kernel shutdown signal. Send `()` in [`Drop`] before attempting the
    /// kernel lock retry loop (M-2). Long-running kernel operations can
    /// listen on the corresponding receiver to abort early on shutdown.
    pub kernel_shutdown: Option<tokio::sync::oneshot::Sender<()>>,

    /// In-memory session store mapping opaque session tokens to resolved
    /// [`SessionContext`] values. ADR #4 / ADR #7.
    ///
    /// Tokens are randomly-generated UUIDs created during login/session
    /// resolution. Commands look up their context via [`AppState::resolve_session`].
    pub session_store: Arc<RwLock<HashMap<String, SessionContext>>>,

    /// Session TTL in seconds. Read from `session.ttl_seconds` setting
    /// at startup; defaults to 86400 (24 hours). Set to 0 to disable
    /// session expiry (development mode).
    ///
    /// Used by `create_session` to stamp `expires_at` on new sessions,
    /// and by `resolve_session` / `prune_expired_sessions` to reject
    /// stale tokens.
    pub session_ttl_seconds: i64,

    /// Terminal identifier for multi-terminal deployments.
    ///
    /// Set once at startup from the registered terminal matching this
    /// device's hostname. Commands that auto-register a terminal via
    /// `set_feature(MultiTerminal, true)` update this field directly
    /// instead of mutating the process env (which is UB from async
    /// tokio workers). Consumers (Redis pub/sub subscriber, inventory
    /// change publisher) read this field.
    pub terminal_id: Arc<Mutex<Option<String>>>,

    /// Per-process secret for the pre-session picker ticket HMAC.
    ///
    /// Generated once at startup (audit-open-findings residual). Tickets are
    /// short-lived (5 min) and die with the process, so the secret is
    /// never persisted — there is nothing to leak from the OS keyring
    /// and a restart simply invalidates outstanding tickets.
    pub picker_ticket_secret: Vec<u8>,

    /// Serializes topology Applies within this process. The topology diff
    /// spans the global and store databases, so concurrent Applies cannot
    /// safely compare revisions or recover partial work independently.
    pub topology_apply_lock: Mutex<()>,

    /// Handle to the loopback local REST API server (`local_api` module)
    /// when it is running. `None` = stopped (the default; enabled via
    /// Settings → Local API). Stopped in [`Drop`] so the listener socket
    /// dies with the process.
    pub local_api: Mutex<Option<crate::local_api::LocalApiHandle>>,

    /// Serializes every local-API lifecycle transition (enable, disable,
    /// port change, boot auto-start). The check-then-act sequences span
    /// awaits (bind, persist), so without this lock a Settings toggle
    /// racing the boot daemon could leave a server listening while the
    /// persisted setting says off. Always acquired BEFORE `local_api`
    /// and the db lock; nothing takes it while holding either.
    pub local_api_op: Mutex<()>,

    /// In-memory KDS active-queue snapshot served to reconnecting LAN KDS
    /// peers (kds-sync).
    ///
    /// Refreshed by the command shims in `commands/kds.rs` after every
    /// kitchen transition (create / status change / line-item bump), and
    /// read **synchronously** by the [`KdsQueueProvider`] closure attached
    /// to the LAN forwarder in `lib.rs` — that provider runs inside the
    /// per-peer accept task and must never touch the async DB mutex, so
    /// the queue is materialised here instead of queried on demand.
    ///
    /// `std::sync::RwLock` (M-1 exception, sync reader): the provider is
    /// a plain `Fn()`; write guards are taken only for the duration of a
    /// pointer swap, never across an await. Starts as the empty default;
    /// first populated when this terminal executes a KDS transition.
    ///
    /// [`KdsQueueProvider`]: kasirmu_lan::KdsQueueProvider
    pub kds_queue_cache: Arc<RwLock<kasirmu_lan::KdsQueueSnapshot>>,
}

impl AppState {
    /// Open the DB at `<app_data_dir>/kasir.db`, run migrations, and
    /// create the empty driver registry.
    pub fn new(app: &AppHandle) -> Result<Self, AppError> {
        let db_path = resolve_db_path(app)?;
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| AppError::Internal(format!("creating db dir {parent:?}: {e}")))?;
        }

        let mut conn = Connection::open(&db_path)
            .map_err(|e| AppError::Internal(format!("opening {db_path:?}: {e}")))?;
        conn.pragma_update(None, "foreign_keys", "ON")
            .map_err(|e| AppError::Internal(format!("enabling foreign_keys: {e}")))?;
        conn.pragma_update(None, "journal_mode", "WAL")
            .map_err(|e| AppError::Internal(format!("enabling WAL: {e}")))?;

        migrations::run(&mut conn)
            .map_err(|e| AppError::Internal(format!("running migrations: {e}")))?;

        // ── Tenant-integrity gate (fail loud) ────────────────────────
        // Desktop store DBs are scoped by construction to the `default`
        // tenant. A foreign-tenant row here means a sync/restore mishap
        // planted another store's data into this file; refuse to boot so
        // the operator reconciles it instead of silently mixing tenants.
        // Two indexed COUNTs (`idx_products_tenant` / `idx_users_tenant`)
        // — cheap enough to run at every startup.
        kasirmu_core::db::Store::new(&conn)
            .check_tenant_integrity()
            .map_err(|e| AppError::Internal(format!("tenant integrity check: {e}")))?;

        // Seed the primary store profile if none exists.
        seed_primary_store(&conn)
            .map_err(|e| AppError::Internal(format!("seeding primary store: {e}")))?;

        // ── Popularity full pass (ADR #37) ────────────────────────────
        // Materialize popularity scores right after migrations so the retail
        // grid's default popularity sort is meaningful from the first launch:
        // sales are read from sale_lines, edit events were seeded by
        // migration 134, and search events accumulate from launch. The pass
        // is local-only analytics — a failure must not block startup.
        if let Err(e) = kasirmu_core::db::Store::new(&conn).recompute_all_popularity() {
            tracing::warn!(
                error = %e,
                "popularity full pass failed; retail popularity sort falls back"
            );
        }

        // ── Cache layer initialisation (read settings BEFORE moving conn) ──
        let redis_url = kasirmu_core::Settings::get_redis_url(&conn).unwrap_or_else(|e| {
            tracing::warn!(error = %e, "failed to read redis_url setting, falling back to localhost");
            "redis://127.0.0.1/".into()
        });
        let cache_ttl = kasirmu_core::Settings::get_redis_cache_ttl(&conn).unwrap_or_else(|e| {
            tracing::warn!(error = %e, "failed to read cache_ttl setting, falling back to 300s");
            300u64
        });
        let cache = platform_startup::init_cache(&redis_url, cache_ttl);

        // ── Session TTL ──────────────────────────────────────────────
        // Read from settings; default 24h. 0 or missing = no expiry.
        // MUST be read before `conn` is moved into `Arc::new(Mutex::new(conn))`.
        let session_ttl_seconds: i64 = kasirmu_core::Settings::get(&conn, "session.ttl_seconds")
            .ok()
            .flatten()
            .and_then(|s| s.parse::<i64>().ok())
            .unwrap_or(86400);

        // ── OZ_TERMINAL_ID for multi-terminal support ───────────────
        // On subsequent launches where MultiTerminal is already enabled,
        // look up the registered terminal by hostname. The terminal_id is
        // stored in AppState (typed field) instead of the process env var.
        // The Redis pub/sub subscriber and inventory change publisher read
        // it from this field — they no longer call std::env::var().
        let terminal_id: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
        let reg = kasirmu_core::Settings::load_features(&conn).unwrap_or_default();
        if reg.is_enabled(kasirmu_core::Feature::MultiTerminal) {
            let device_id = std::env::var("COMPUTERNAME")
                .or_else(|_| std::env::var("HOSTNAME"))
                .unwrap_or_default();
            if !device_id.is_empty() {
                let store = kasirmu_core::db::Store::new(&conn);
                if let Ok(Some(terminal)) = store.get_terminal_by_device_id(&device_id) {
                    *terminal_id.blocking_lock() = Some(terminal.id.clone());
                    tracing::info!(
                        terminal_id = %terminal.id,
                        device_id = %device_id,
                        "terminal_id set at startup for multi-terminal"
                    );
                }
            }
        }

        // ── Start inventory pub/sub listener (Redis only) ────────────
        let pubsub_terminal_id = terminal_id.blocking_lock().clone();
        let inventory_pubsub_shutdown =
            cache.start_inventory_pubsub(cache.clone(), pubsub_terminal_id);
        if inventory_pubsub_shutdown.is_some() {
            tracing::info!("inventory pub/sub listener started");
        }

        let db = Arc::new(Mutex::new(conn));

        // ── Store-scoped database manager (ADR #4 Phase 2) ────────
        let db_dir = db_path
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| PathBuf::from("."));
        let db_manager = StoreDatabaseManager::new(db_dir, kasirmu_core::migrations::ALL);

        let registry = Arc::new(DriverRegistry::default());

        // Load plugins from <app_data_dir>/plugins/.
        let plugins_dir = app.path().app_data_dir().ok().map(|d| d.join("plugins"));
        let plugins: Arc<Mutex<Option<PluginManager>>> =
            Arc::new(Mutex::new(plugins_dir.as_ref().and_then(
                |dir| match PluginManager::new(dir) {
                    Ok(pm) => Some(pm),
                    Err(e) => {
                        tracing::warn!(error = %e, "initialising plugin manager");
                        None
                    }
                },
            )));

        // Start plugin hot-reload file watcher (M-5).
        let (plugin_watcher, plugin_hot_reload_task) = if let Some(dir) = plugins_dir.as_ref() {
            if dir.exists() {
                start_plugin_watcher(plugins.clone(), dir.clone())
            } else {
                (None, None)
            }
        } else {
            (None, None)
        };

        // ── Kernel shutdown channel (M-2) ────────────────────────────
        // The receiver is dropped here — the infrastructure is in place for
        // future long-running kernel operations to listen for shutdown.
        let (kernel_shutdown_tx, _kernel_shutdown_rx) = tokio::sync::oneshot::channel::<()>();

        tracing::info!(
            cache_healthy = cache.is_healthy(),
            ?db_path,
            plugins_loaded = plugins.try_lock().map(|g| g.is_some()).unwrap_or(false),
            "AppState initialised"
        );

        Ok(Self {
            db,
            db_manager,
            registry,
            app: Some(app.clone()),
            db_path,
            scanner_cancel: Mutex::new(None),
            kernel: Mutex::new(Kernel::new()),
            plugins,
            plugin_watcher,
            plugin_hot_reload_task,
            sync_daemon: SyncDaemon::new(),
            pg_sync_daemon: PgSyncDaemon::new(),
            cache,
            inventory_pubsub_shutdown,
            kernel_shutdown: Some(kernel_shutdown_tx),
            session_store: Arc::new(RwLock::new(HashMap::new())),
            session_ttl_seconds,
            terminal_id,
            picker_ticket_secret: uuid::Uuid::new_v4().as_bytes().to_vec(),
            topology_apply_lock: Mutex::new(()),
            local_api: Mutex::new(None),
            local_api_op: Mutex::new(()),
            kds_queue_cache: Arc::new(RwLock::new(kasirmu_lan::KdsQueueSnapshot::default())),
        })
    }
}

/// Seed the default primary store profile if the table is empty.
///
/// Called once on first startup after migrations run. Subsequent
/// launches find the existing row and skip the insert.
///
/// Migration 025 seeds a `'default'` row with `is_primary = 0` (so tests can
/// create their own primary stores). If that row already exists we must
/// promote it to primary with an explicit `UPDATE`, because an
/// `INSERT OR IGNORE` cannot change the existing `is_primary` value — leaving
/// `get_primary_store()` (which queries `is_primary = 1`) returning `None`
/// and breaking boot on a fresh install.
fn seed_primary_store(conn: &Connection) -> Result<(), rusqlite::Error> {
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM locations", [], |r| r.get(0))?;
    if count == 0 {
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        conn.execute(
            "INSERT INTO locations (id, name, address, tax_id, currency, timezone, is_primary, created_at, updated_at)
             VALUES ('default', 'Main Store', '', '', 'USD', 'UTC', 1, ?1, ?1)",
            rusqlite::params![now],
        )?;
        tracing::info!("seeded default primary store profile");
    } else {
        // Promote the canonical 'default' store to primary. The unique partial
        // index on is_primary = 1 allows at most one primary store, so only
        // promote when no other store is already primary (multi-store case).
        let affected = conn.execute(
            "UPDATE locations SET is_primary = 1
             WHERE id = 'default'
               AND NOT EXISTS (
                 SELECT 1 FROM locations WHERE is_primary = 1 AND id != 'default'
               )",
            [],
        )?;
        if affected > 0 {
            tracing::info!("promoted 'default' store profile to primary");
        }
    }
    Ok(())
}

impl AppState {
    /// Create a `Store` with the shared cache layer and terminal
    /// identity for pub/sub message tagging.
    ///
    /// Command handlers should use this instead of `Store::new(&conn)`
    /// to benefit from Redis caching (when configured) and to ensure
    /// inventory-change pub/sub messages are correctly tagged with the
    /// terminal's identity.
    /// Create a `Store` with the shared cache layer and a pre-acquired
    /// terminal identity for pub/sub message tagging.
    ///
    /// Callers should acquire the terminal_id via
    /// `state.terminal_id.lock().await.clone()` BEFORE locking the
    /// database, so the db guard never crosses an await point.
    ///
    /// Command handlers should use this instead of `Store::new(&conn)`
    /// to benefit from Redis caching (when configured) and to ensure
    /// inventory-change pub/sub messages are correctly tagged with the
    /// terminal's identity.
    pub fn store_with_tid<'a>(
        &self,
        conn: &'a Connection,
        tid: Option<String>,
    ) -> kasirmu_core::db::Store<'a> {
        kasirmu_core::db::Store::with_cache(conn, self.cache.clone()).with_terminal_id(tid)
    }

    /// Resolve an opaque session token to its [`SessionContext`].
    ///
    /// ADR #4 / ADR #7: Commands call this to look up the caller's
    /// resolved scope (store, instance, type, user, role, terminal).
    /// Returns `AppError::InvalidSession` if the token is unknown
    /// OR if the session has expired (TTL check).
    ///
    /// Expired sessions are atomically removed from the store during
    /// resolution, so subsequent lookups also get `InvalidSession`.
    ///
    /// Uses a double-check lock pattern: the fast path (valid session)
    /// only acquires a shared read lock. The exclusive write lock is
    /// only acquired when a session is actually expired, which is rare.
    pub fn resolve_session(&self, token: &str) -> Result<SessionContext, AppError> {
        // Fast path: read-only check.
        {
            let store = self
                .session_store
                .read()
                .map_err(|e| AppError::Internal(format!("session store lock poisoned: {e}")))?;

            match store.get(token) {
                Some(ctx) if !ctx.is_expired() => return Ok(ctx.clone()),
                Some(_) => {} // expired — fall through to write-lock path
                None => return Err(AppError::InvalidSession),
            }
        }

        // Slow path: expired session — acquire write lock to remove it.
        let mut store = self
            .session_store
            .write()
            .map_err(|e| AppError::Internal(format!("session store lock poisoned: {e}")))?;

        // Double-check: another thread may have already removed or refreshed it.
        if let Some(ctx) = store.get(token)
            && ctx.is_expired()
        {
            store.remove(token);
            // Masked, not raw: this fires on ordinary use of a stale token,
            // and a session token is a bearer credential — anyone who reads
            // it off a console or a support capture can act as that session
            // without knowing the PIN.
            tracing::info!(token = %mask_token(token), "session expired — removed from store");
        }

        Err(AppError::InvalidSession)
    }

    /// Remove every session bound to `user_id` except the token in
    /// `keep_token` (STAFF-03 PIN rotation).
    ///
    /// The caller's own session is preserved — they authenticated moments
    /// ago and the UI follows up with a reload using the same token — while
    /// stale terminal sessions issued under the old PIN are invalidated.
    pub fn invalidate_user_sessions_except(&self, user_id: &str, keep_token: &str) -> usize {
        let mut store = match self.session_store.write() {
            Ok(s) => s,
            Err(e) => {
                tracing::warn!("session store lock poisoned during invalidation: {e}");
                return 0;
            }
        };
        let before = store.len();
        store.retain(|token, ctx| {
            ctx.user_id != user_id || (!keep_token.is_empty() && token == keep_token)
        });
        let removed = before - store.len();
        if removed > 0 {
            tracing::info!(
                user_id = %user_id,
                removed = %removed,
                keep_token = %mask_token(keep_token),
                "sessions invalidated after PIN rotation"
            );
        }
        removed
    }

    /// Remove a single session token from the store (SaaS-3 L194 org switch).
    ///
    /// Returns `true` if the token was present and removed. The caller —
    /// `switch_organization` — uses this to invalidate the *current* token
    /// BEFORE minting the new session, so the old token is dead before any
    /// new session exists. This is the load-bearing half of the
    /// invalidate-then-mint ordering that prevents both tokens being live at
    /// once; it is deliberately distinct from `invalidate_user_sessions_except`,
    /// which sweeps every token for a user.
    pub fn invalidate_session(&self, token: &str) -> bool {
        let mut store = match self.session_store.write() {
            Ok(s) => s,
            Err(e) => {
                tracing::warn!("session store lock poisoned during single invalidation: {e}");
                return false;
            }
        };
        store.remove(token).is_some()
    }

    /// Remove all expired sessions from the store in a single sweep.
    ///
    /// Called periodically by the background session-cleanup daemon
    /// (every 5 minutes). Also called lazily during `create_session`
    /// when the store is approaching capacity.
    pub fn prune_expired_sessions(&self) -> usize {
        let mut store = match self.session_store.write() {
            Ok(s) => s,
            Err(e) => {
                tracing::warn!("session store lock poisoned during prune: {e}");
                return 0;
            }
        };
        let before = store.len();
        store.retain(|token, ctx| {
            if ctx.is_expired() {
                tracing::trace!(token = %mask_token(token), "pruning expired session");
                false
            } else {
                true
            }
        });
        let pruned = before - store.len();
        if pruned > 0 {
            tracing::info!(
                "pruned {pruned} expired session(s), {remaining} remain",
                remaining = store.len()
            );
        }
        pruned
    }

    /// Resolve a session token and open the store-scoped database.
    ///
    /// ADR #7: Convenience method combining `resolve_session` +
    /// `db_manager.open_store` in one call. Most domain commands
    /// should use this instead of the global `db` field.
    ///
    /// Returns the resolved [`SessionContext`] and an [`Arc`]`<Mutex<Connection>>`
    /// for the store-scoped SQLite database. The caller must call `.lock()` on
    /// the returned connection before querying.
    ///
    /// # Multi-KDS scoping (plan_multi_kds_one_location)
    ///
    /// | `restaurant_pos_id` | Effective store |
    /// |---|---|
    /// | `None` (default) | `session.store_id` — identical to today |
    /// | `Some(id)` | Terminal binding's `bound_store_id` for `id` |
    ///
    /// When `restaurant_pos_id` is `Some`, we look up the terminal's
    /// binding in the global `terminals` table to find which store it
    /// is bound to. The global DB lock is acquired via `blocking_lock()`
    /// for the brief duration of a single SELECT — acceptable because:
    ///
    /// - The lock is held for microseconds (one indexed query).
    /// - `blocking_lock()` is already used in other sync contexts
    ///   (setup hooks, state tests, plugin watchers).
    /// - The alternative (making this async) would require updating
    ///   90+ callers across both desktop-client and tablet-client.
    ///
    /// If the terminal is not found or has no binding, we fall back to
    /// `session.store_id` — a safe default.
    pub fn resolve_scope(
        &self,
        token: &str,
    ) -> Result<(SessionContext, Arc<std::sync::Mutex<Connection>>), AppError> {
        let session = self.resolve_session(token)?;
        let effective_store_id = match session.restaurant_pos_id.as_deref() {
            Some(resto_id) => {
                // Multi-KDS mode: resolve the Restaurant POS terminal's
                // binding to find its store database. The terminals table
                // maps terminal_id → bound_store_id.
                self.resolve_restaurant_pos_store(resto_id)
                    .unwrap_or_else(|e| {
                        tracing::warn!(
                            restaurant_pos_id = %resto_id,
                            error = %e,
                            "failed to resolve restaurant POS store binding, \
                             falling back to session.store_id"
                        );
                        session.store_id.clone()
                    })
            }
            None => session.store_id.clone(),
        };
        let conn = self
            .db_manager
            .open_store(&effective_store_id)
            .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;
        Ok((session, conn))
    }

    /// Look up the store ID bound to a Restaurant POS terminal.
    ///
    /// Queries the global `terminals` table for the terminal's
    /// `bound_store_id`. Used by [`resolve_scope`] when a session
    /// carries a `restaurant_pos_id`.
    ///
    /// Uses `blocking_lock()` on the tokio Mutex — safe here because
    /// the lock is held for a single indexed SELECT (microseconds).
    ///
    /// Returns `AppError::Invalid` if the terminal is not found or
    /// has no binding.
    fn resolve_restaurant_pos_store(&self, restaurant_pos_id: &str) -> Result<String, AppError> {
        let db = self.db.blocking_lock();
        let binding: Option<String> = db
            .query_row(
                "SELECT bound_location_id FROM terminals WHERE id = ?1",
                rusqlite::params![restaurant_pos_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| AppError::Internal(format!("querying terminal binding: {e}")))?;
        binding.ok_or_else(|| {
            AppError::Invalid(format!(
                "restaurant POS '{restaurant_pos_id}' not found or has no store binding"
            ))
        })
    }

    /// Resolve a session token and return only the store-scoped database
    /// connection. Convenience wrapper for commands that don't need the
    /// [`SessionContext`] (e.g., `adjust_stock_scoped`).
    pub fn resolve_store(
        &self,
        token: &str,
    ) -> Result<Arc<std::sync::Mutex<Connection>>, AppError> {
        self.resolve_scope(token).map(|(_, conn)| conn)
    }
}

/// Start a background file watcher that hot-reloads plugins when
/// `.lua` or `plugin.toml` files change in `plugins_dir`.
///
/// Returns a tuple of (file watcher, task join handle). The join handle
/// should be stored and aborted during [`Drop`] to stop the loop
/// gracefully (M-5).
fn start_plugin_watcher(
    plugins: Arc<Mutex<Option<PluginManager>>>,
    plugins_dir: PathBuf,
) -> (
    Option<notify::RecommendedWatcher>,
    Option<tokio::task::JoinHandle<()>>,
) {
    let reload_flag = Arc::new(AtomicBool::new(false));
    let flag_clone = reload_flag.clone();

    let mut watcher = match notify::RecommendedWatcher::new(
        move |_res: Result<notify::Event, notify::Error>| {
            flag_clone.store(true, Ordering::SeqCst);
        },
        notify::Config::default(),
    ) {
        Ok(w) => w,
        Err(e) => {
            tracing::warn!(error = %e, "failed to create plugin file watcher");
            return (None, None);
        }
    };

    if let Err(e) = watcher.watch(&plugins_dir, notify::RecursiveMode::Recursive) {
        tracing::warn!(error = %e, "failed to watch plugins directory");
        return (None, None);
    }

    tracing::info!(dir = %plugins_dir.display(), "plugin hot-reload watcher started");

    let handle = tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;
            if reload_flag.swap(false, Ordering::SeqCst) {
                tracing::info!("plugin change detected, hot-reloading…");
                reload_plugins(&plugins, &plugins_dir).await;
            }
        }
    });

    (Some(watcher), Some(handle))
}

/// Rebuild the plugin manager from `plugins_dir`, replacing the shared
/// handle only on success.
///
/// Last-known-good rollback (PLG-07): if the reload fails (invalid manifest,
/// unsafe script path, etc.) the previous runtime is kept untouched so a
/// broken edit can never take the plugin subsystem down.
async fn reload_plugins(plugins: &Arc<Mutex<Option<PluginManager>>>, plugins_dir: &Path) {
    let mut guard = plugins.lock().await;
    match PluginManager::new(plugins_dir) {
        Ok(pm) => {
            *guard = Some(pm);
            tracing::info!("plugins hot-reloaded successfully");
        }
        Err(e) => {
            tracing::error!(
                error = %e,
                "failed to hot-reload plugins, keeping old runtime"
            );
        }
    }
}

fn resolve_db_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Internal(format!("resolving app data dir: {e}")))?;

    // ── Data-dir migration ─────────────────────────────────────────────
    // Before the bundle identifier change (com.ozpos.app → mu.kasir.app),
    // the DB lived at <base>/com.ozpos.app/oz-pos.db. After the change,
    // app_data_dir() returns the new path. Copy (not move) the old DB to
    // the new location so existing installs keep their data.
    if let Some(base) = dir.parent() {
        let old_db = base.join("com.ozpos.app").join("oz-pos.db");
        let new_db = dir.join("kasir.db");
        if old_db.exists() && !new_db.exists() {
            std::fs::create_dir_all(&dir)
                .map_err(|e| AppError::Internal(format!("creating app data dir {dir:?}: {e}")))?;
            std::fs::copy(&old_db, &new_db).map_err(|e| {
                AppError::Internal(format!("migrating db from {old_db:?} to {new_db:?}: {e}"))
            })?;
        }
    }

    Ok(dir.join("kasir.db"))
}

impl Drop for AppState {
    fn drop(&mut self) {
        // Stop the local API server first: its handlers share `db`, so
        // closing the listener before the kernel drain avoids serving
        // requests against a half-stopped backend.
        if let Some(handle) = self.local_api.try_lock().ok().and_then(|mut g| g.take()) {
            handle.stop();
        }

        // Abort the plugin hot-reload background task (M-5).
        if let Some(handle) = self.plugin_hot_reload_task.take() {
            handle.abort();
            tracing::info!("plugin hot-reload task cancelled");
        }

        // Signal kernel shutdown (M-2). This tells any kernel command
        // holding the lock to abort early, reducing contention during the
        // retry loop below. The receiver is a no-op for now — infrastructure
        // for future long-running kernel operations.
        if let Some(tx) = self.kernel_shutdown.take() {
            let _ = tx.send(());
            tracing::info!("kernel shutdown signal sent");
        }

        tracing::info!("stopping kernel modules");
        // Retry the lock for up to 2000ms (200 × 10ms) before giving up. This addresses
        // a Windows window-lifecycle bottleneck where `try_lock()` would
        // silently skip `stop_all()` if a Tauri command was mid-execution.
        // A single `try_lock()` is too aggressive during shutdown because
        // commands may still be draining. But `blocking_lock()` risks a
        // deadlock if a command holding the lock is waiting for the runtime
        // to shut down (circular dependency). The bounded retry loop
        // gives commands time to finish while guaranteeing the Drop
        // doesn't hang indefinitely. Increased from 50→200 for a more
        // generous shutdown window (M-2).
        const DROP_LOCK_RETRIES: usize = 200;
        let mut stopped = false;
        for _ in 0..DROP_LOCK_RETRIES {
            if let Ok(mut kernel) = self.kernel.try_lock() {
                let _ = kernel.stop_all();
                stopped = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        if !stopped {
            tracing::warn!(
                "kernel lock contended after {}ms, skipping stop_all — \
                 modules may not have been stopped cleanly",
                DROP_LOCK_RETRIES * 10,
            );
        }
    }
}

#[cfg(test)]
impl AppState {
    /// Construct an `AppState` suitable for unit tests.
    /// Creates a lightweight Tauri app handle via `tauri::test::mock_builder`.
    pub fn for_test() -> Self {
        let db = Arc::new(Mutex::new(Connection::open_in_memory().unwrap()));
        Self {
            db,
            db_manager: StoreDatabaseManager::new(
                std::env::temp_dir(),
                kasirmu_core::migrations::ALL,
            ),
            registry: Arc::new(DriverRegistry::default()),
            app: None,
            db_path: ":memory:".into(),
            scanner_cancel: Mutex::new(None),
            kernel: Mutex::new(Kernel::new()),
            plugins: Arc::new(Mutex::new(None)),
            plugin_watcher: None,
            plugin_hot_reload_task: None,
            sync_daemon: SyncDaemon::new(),
            pg_sync_daemon: PgSyncDaemon::new(),
            cache: kasirmu_core::cache::create_cache("redis://127.0.0.1/", 300),
            inventory_pubsub_shutdown: None,
            kernel_shutdown: None,
            session_store: Arc::new(RwLock::new(HashMap::new())),
            session_ttl_seconds: 86400,
            terminal_id: Arc::new(Mutex::new(None)),
            picker_ticket_secret: b"test-picker-ticket-secret".to_vec(),
            topology_apply_lock: Mutex::new(()),
            local_api: Mutex::new(None),
            local_api_op: Mutex::new(()),
            kds_queue_cache: Arc::new(RwLock::new(kasirmu_lan::KdsQueueSnapshot::default())),
        }
    }

    /// Construct a test state with a caller-provided global database connection.
    ///
    /// This keeps authorization tests independent from the production app
    /// bootstrap while preserving the same global-identity lookup path.
    pub fn for_test_with_conn(conn: Connection) -> Self {
        let mut state = Self::for_test();
        state.db = Arc::new(Mutex::new(conn));
        state
    }

    /// Construct a test state with an isolated store database directory.
    ///
    /// The production state owns this manager, so injecting it here lets
    /// scope tests prove that a session cannot observe another store's file.
    pub fn for_test_with_db_manager(db_manager: StoreDatabaseManager) -> Self {
        let mut state = Self::for_test();
        state.db_manager = db_manager;
        state
    }
}

#[cfg(test)]
#[path = "state_tests.rs"]
mod tests;
