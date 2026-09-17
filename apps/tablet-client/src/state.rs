/*
last audited 25-07-26 by RSA-Agent (tablet-client slice A: verified)
crate: tablet-client | status: SAFE | lint: CLEAN
findings: clean — matches desktop-client guarded patterns. Coverage note: verified under the risk-ranked sampling protocol (global sweep clean), not line-by-line deep read
next: none | perf: N/A
*/
//! `AppState` — the long-lived state managed by Tauri and reached via
//! `State<'_, AppState>` in every command.
//!
//! Holds:
//! - A `rusqlite::Connection` (behind a `tokio::sync::Mutex`) for DB access.
//! - A `DriverRegistry` from `oz_hal` for hardware access.
//! - The Tauri `AppHandle` for emitting events back to the front-end.
//!
//! `AppState::new` opens the local SQLite database, runs migrations, and
//! creates an empty `DriverRegistry`. Hardware is registered at runtime
//! via the setup wizard (or a future `init_hardware` command); the front
//! end never assumes a particular device is plugged in at startup.
//!
//! # Connection pooling
//!
//! The `Mutex<Connection>` here is a single-connection placeholder. A
//! real deployment will switch to `r2d2_sqlite` or `deadpool-sqlite`
//! so that Tauri commands can issue concurrent reads (the `rust-backend`
//! skill prescribes this; switching is mechanical).

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::RwLock;

use oz_security::mask::mask_token;
use rusqlite::Connection;
use tauri::AppHandle;
use tauri::Manager;
use tokio::sync::{Mutex, oneshot};

use oz_core::cache::{Cache, create_cache};
use oz_core::migrations;
use oz_core::session::SessionContext;
use oz_hal::DriverRegistry;
use oz_plugin::PluginManager;
use platform_core::StoreDatabaseManager;
use platform_kernel::Kernel;

use crate::error::AppError;

/// Shared application state.
pub struct AppState {
    /// SQLite connection for the local store. Wrapped in a `Mutex` so
    /// commands can borrow it across `.await` points safely.
    ///
    /// `Arc`-wrapped because `BridgeCtx::db` borrows
    /// `&Arc<Mutex<Connection>>`. The wrapper is invisible to call sites:
    /// `state.db.lock()` and `&state.db` keep compiling through `Arc`'s
    /// `Deref`, and every clone names the *same* connection — there is no
    /// second handle here to fall out of sync with.
    pub db: Arc<Mutex<Connection>>,

    /// HAL driver registry. Use `state.registry.scanner(id)` etc.
    pub registry: Arc<DriverRegistry>,

    /// Tauri app handle, used for emitting events to the front-end.
    /// `None` in test or headless contexts where no UI is attached.
    ///
    /// Also the source of the two legs `BridgeCtx` takes from the shell:
    /// `media_cache_dir` (resolved here, since no tauri type may enter
    /// `oz-bridge`) and `emitter` (boxed `TauriEventSink`).
    pub app: Option<AppHandle>,

    /// Path to the SQLite database file (for diagnostics + `oz-cli` reuse).
    pub db_path: PathBuf,

    /// Cancel-sender for the active barcode scanner background task.
    /// When `Some`, the scanner polling loop is running; dropping
    /// or signalling it stops the loop gracefully.
    pub scanner_cancel: Mutex<Option<oneshot::Sender<()>>>,

    /// Module system kernel. Manages module lifecycle (load → start → stop).
    /// Modules are registered in `lib.rs::run()` during setup.
    pub kernel: Mutex<Kernel>,

    /// In-memory session store mapping opaque session tokens to resolved
    /// [`SessionContext`] values. ADR #4 / ADR #7.
    pub session_store: Arc<RwLock<HashMap<String, SessionContext>>>,

    /// Session TTL in seconds. Read from `session.ttl_seconds` setting
    /// at startup; defaults to 86400 (24 hours). Set to 0 to disable
    /// session expiry (development mode).
    pub session_ttl_seconds: i64,

    /// Terminal identifier for multi-terminal deployments.
    ///
    /// Set once at startup or via set_feature(MultiTerminal, true).
    /// Consumers (Redis pub/sub subscriber, inventory change publisher)
    /// read this field instead of calling std::env::var().
    ///
    /// `Arc`-wrapped for `BridgeCtx::terminal_id`, exactly as `db` above
    /// (see that field's note for why the wrapper costs no call site).
    pub terminal_id: Arc<tokio::sync::Mutex<Option<String>>>,

    /// Store-scoped database manager (ADR #4 Phase 2 / ADR #7).
    /// Each resolved store is opened in its own migrated SQLite database.
    pub db_manager: StoreDatabaseManager,

    /// Cache layer handed to bridge bodies that build `Store::with_cache`.
    ///
    /// **The tablet runs uncached.** `cache-redis` is not in `oz-core`'s
    /// default feature set and this shell does not enable it, so
    /// `create_cache` always reaches its documented fallback: a `NoopCache`
    /// that "always misses" and reports `is_healthy() == false`
    /// (`crates/oz-core/src/cache.rs`). The URL passed at construction is
    /// deliberately empty — this shell owns no Redis to point at. The field
    /// exists because `BridgeCtx` requires the leg, **not** because a
    /// working cache is wired: read "uncached" here, never "cached".
    pub cache: Arc<dyn Cache>,

    /// Plugin-manager slot, present to satisfy `BridgeCtx::plugins`
    /// (`&Mutex<Option<PluginManager>>`).
    ///
    /// Always `None` on this shell, and the reason is *different from
    /// desktop's*: there, `None` means "no `plugins/` directory exists or
    /// loading failed" and a manager can appear later; here it means **this
    /// shell has no plugin host at all** — nothing ever assigns one. A
    /// bridge body that needs Lua business rules must treat that as
    /// unsupported on tablet, not as a load failure to retry.
    pub plugins: Mutex<Option<PluginManager>>,

    /// Serialises topology Applies within this process, to satisfy
    /// `BridgeCtx::topology_apply_lock`.
    ///
    /// Inert here for one checkable reason: this shell exposes **no
    /// topology surface at all** — `commands/authz.rs` records that the
    /// tablet `AppError` has no `TopologyValidation` variant — so nothing
    /// takes this lock and it never contends.
    /// **If a topology command is ever added to the tablet, this stops
    /// being a placeholder and becomes a real serialisation guarantee: the
    /// line must be revisited then** to confirm it guards the same
    /// cross-database diff the desktop lock guards (and that no second
    /// tablet-side lock has appeared beside it, which would guard nothing).
    pub topology_apply_lock: Mutex<()>,

    /// Per-process secret for the pre-session picker ticket HMAC.
    ///
    /// Parity with the desktop client (audit-open-findings residual). Generated
    /// once at startup. Tickets are short-lived (5 min) and die with
    /// the process, so the secret is never persisted — a restart
    /// simply invalidates outstanding tickets.
    pub picker_ticket_secret: Vec<u8>,
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
        // Tablet store DBs are scoped by construction to the `default`
        // tenant. A foreign-tenant row here means a sync/restore mishap
        // planted another store's data into this file; refuse to boot so
        // the operator reconciles it instead of silently mixing tenants.
        // Two indexed COUNTs (`idx_products_tenant` / `idx_users_tenant`)
        // — cheap enough to run at every startup.
        oz_core::db::Store::new(&conn)
            .check_tenant_integrity()
            .map_err(|e| AppError::Internal(format!("tenant integrity check: {e}")))?;

        // ── Popularity full pass (ADR #37) ────────────────────────────
        // Materialize popularity scores right after migrations so product
        // lookups rank recently-managed items from the first launch (sales
        // come from sale_lines, edit events were seeded by migration 134,
        // search events accumulate from launch). Local-only analytics — a
        // failure must not block startup.
        if let Err(e) = oz_core::db::Store::new(&conn).recompute_all_popularity() {
            tracing::warn!(
                error = %e,
                "popularity full pass failed; product popularity sort falls back"
            );
        }

        // ── Session TTL ──────────────────────────────────────────────
        // Read from settings; default 24h. 0 or missing = no expiry.
        let session_ttl_seconds: i64 = oz_core::Settings::get(&conn, "session.ttl_seconds")
            .ok()
            .flatten()
            .and_then(|s| s.parse::<i64>().ok())
            .unwrap_or(86400);

        let data_dir = db_path
            .parent()
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."));
        let db_manager = StoreDatabaseManager::new(data_dir, oz_core::migrations::ALL);
        let registry = Arc::new(DriverRegistry::default());

        tracing::info!(?db_path, "AppState initialised");

        Ok(Self {
            db: Arc::new(Mutex::new(conn)),
            registry,
            app: Some(app.clone()),
            db_path,
            scanner_cancel: Mutex::new(None),
            kernel: Mutex::new(Kernel::new()),
            session_store: Arc::new(RwLock::new(HashMap::new())),
            session_ttl_seconds,
            terminal_id: Arc::new(Mutex::new(None)),
            cache: create_cache("", 300),
            plugins: Mutex::new(None),
            topology_apply_lock: Mutex::new(()),
            db_manager,
            picker_ticket_secret: uuid::Uuid::new_v4().as_bytes().to_vec(),
        })
    }

    /// Resolve an opaque session token to its [`SessionContext`].
    ///
    /// ADR #4 / ADR #7: Commands call this to look up the caller's
    /// resolved scope. Returns `AppError::InvalidSession` if the
    /// token is unknown OR if the session has expired (TTL check).
    ///
    /// Expired sessions are atomically removed during resolution.
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
            // On Android this reaches logcat, which is a broader audience
            // than a desktop console: any adb shell or a bug-report dump
            // picks it up.
            tracing::info!(token = %mask_token(token), "session expired — removed from store");
        }

        Err(AppError::InvalidSession)
    }

    /// Resolve a session token and return its context and store-scoped database.
    ///
    /// ADR #7: The session determines the store; callers never supply a
    /// store identifier directly for scoped commands.
    pub fn resolve_scope(
        &self,
        token: &str,
    ) -> Result<(SessionContext, std::sync::Arc<std::sync::Mutex<Connection>>), AppError> {
        let session = self.resolve_session(token)?;
        let conn = self
            .db_manager
            .open_store(&session.store_id)
            .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;
        Ok((session, conn))
    }

    /// Resolve a session token and return only its store-scoped database.
    pub fn resolve_store(
        &self,
        token: &str,
    ) -> Result<std::sync::Arc<std::sync::Mutex<Connection>>, AppError> {
        self.resolve_scope(token).map(|(_, conn)| conn)
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
    /// Returns true if the token was present and removed. switch_organization
    /// uses this to invalidate the current token BEFORE minting the new session,
    /// so the old token is dead before any new session exists. This is the
    /// load-bearing half of the invalidate-then-mint ordering; it is distinct
    /// from invalidate_user_sessions_except, which sweeps every token for a
    /// user.
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
    /// Called periodically by the background session-cleanup daemon.
    pub fn prune_expired_sessions(&self) -> usize {
        let mut store = match self.session_store.write() {
            Ok(s) => s,
            Err(e) => {
                tracing::warn!("session store lock poisoned during prune: {e}");
                return 0;
            }
        };
        let before = store.len();
        store.retain(|_, ctx| !ctx.is_expired());
        let pruned = before - store.len();
        if pruned > 0 {
            tracing::info!(
                "pruned {pruned} expired session(s), {remaining} remain",
                remaining = store.len()
            );
        }
        pruned
    }
}

fn resolve_db_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Internal(format!("resolving app data dir: {e}")))?;

    // ── Data-dir migration ─────────────────────────────────────────────
    // Before the bundle identifier change (com.ozpos.tablet → mu.kasir.tablet),
    // the DB lived at <base>/com.ozpos.tablet/oz-pos.db. After the change,
    // app_data_dir() returns the new path. Copy (not move) the old DB to
    // the new location so existing installs keep their data.
    if let Some(base) = dir.parent() {
        let old_db = base.join("com.ozpos.tablet").join("oz-pos.db");
        let new_db = dir.join("kasir.db");
        if old_db.exists() && !new_db.exists() {
            std::fs::copy(&old_db, &new_db).map_err(|e| {
                AppError::Internal(format!("migrating db from {old_db:?} to {new_db:?}: {e}"))
            })?;
        }
    }

    Ok(dir.join("kasir.db"))
}

// ---------------------------------------------------------------------------
// ADR #49 Slice 0 — the ctx seam.
//
// `bridge_ctx` is the single borrow point between the tablet shell's
// `AppState` and the tauri-free `oz-bridge` crate: a shim builds one per
// call, runs the extracted command body, and maps `BridgeError` back to
// `AppError` at `commands/authz.rs` so the wire shape is untouched. The
// error seam already existed; this is the half that was missing.
// ---------------------------------------------------------------------------
impl AppState {
    /// Borrow a headless bridge context for command shims. Cheap: refs +
    /// one `PathBuf` clone + one secret clone. Locks nothing (never
    /// `blocking_lock` — it is called from inside async shims).
    ///
    /// Nine legs are real tablet services (`db`, `db_manager`, `sessions`
    /// ← `session_store`, `session_ttl_seconds`, `kernel`, `terminal_id`,
    /// `registry`, `scanner_cancel`, `picker_ticket_secret`) and two are
    /// derived from `app` (`media_cache_dir`, `emitter`). Three are
    /// tablet-private **placeholders with documented meaning** — a later
    /// slice must read them as "this shell does not have it", never as
    /// "wired, therefore working":
    ///
    /// - `cache`: the tablet runs **uncached** (`NoopCache`; see
    ///   `AppState::cache`),
    /// - `plugins`: `None` means **no plugin host on this shell**, which is
    ///   a different claim from desktop's "failed to load" (see
    ///   `AppState::plugins`),
    /// - `topology_apply_lock`: never contended, because this shell has no
    ///   topology surface; see `AppState::topology_apply_lock` for the
    ///   condition that turns it into a real guarantee.
    ///
    /// `emitter` is never `None` while `app` holds a handle — a live shell
    /// that swallowed its own UI events would be a silent-loss bug, not a
    /// headless default. It is `None` only where `app` is `None`
    /// (`for_test*`), matching the bridge's documented headless no-op.
    #[allow(dead_code)] // consumed by the Slice 1+ shims (audit.rs, sync.rs)
    pub(crate) fn bridge_ctx(&self) -> oz_bridge::ctx::BridgeCtx<'_> {
        // The media root is a shell concern: `AppHandle`/`Manager` never
        // enter oz-bridge, so `app_cache_dir()` is resolved here and
        // injected as a plain PathBuf. `None` when this shell holds no
        // handle, and a failed resolution degrades the same way.
        let media_cache_dir = self
            .app
            .as_ref()
            .and_then(|app| match app.path().app_cache_dir() {
                Ok(dir) => Some(dir),
                Err(e) => {
                    tracing::warn!("resolving app cache dir: {e}");
                    None
                }
            });

        oz_bridge::ctx::BridgeCtx {
            db: &self.db,
            db_manager: &self.db_manager,
            sessions: &self.session_store,
            session_ttl_seconds: self.session_ttl_seconds,
            cache: &self.cache,
            kernel: &self.kernel,
            terminal_id: &self.terminal_id,
            media_cache_dir,
            picker_ticket_secret: self.picker_ticket_secret.clone(),
            registry: &self.registry,
            plugins: &self.plugins,
            emitter: self
                .app
                .as_ref()
                .map(|app| crate::commands::authz::event_sink(app)),
            scanner_cancel: &self.scanner_cancel,
            topology_apply_lock: &self.topology_apply_lock,
        }
    }
}

impl Drop for AppState {
    fn drop(&mut self) {
        tracing::info!("stopping kernel modules");
        // Retry the lock for up to 500ms before giving up. This addresses
        // a Windows window-lifecycle bottleneck where `try_lock()` would
        // silently skip `stop_all()` if a Tauri command was mid-execution.
        // A single `try_lock()` is too aggressive during shutdown because
        // commands may still be draining. But `blocking_lock()` risks a
        // deadlock if a command holding the lock is waiting for the runtime
        // to shut down (circular dependency). The bounded retry loop
        // gives commands time to finish while guaranteeing the Drop
        // doesn't hang indefinitely.
        const DROP_LOCK_RETRIES: usize = 50;
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
                "kernel lock contended after 500ms, skipping stop_all — \
                 modules may not have been stopped cleanly"
            );
        }
    }
}

#[cfg(test)]
impl AppState {
    /// Construct an `AppState` suitable for unit tests.
    /// Creates a lightweight Tauri app handle via `tauri::test::mock_builder`.
    pub fn for_test() -> Self {
        Self {
            db: Arc::new(Mutex::new(Connection::open_in_memory().unwrap())),
            registry: Arc::new(DriverRegistry::default()),
            app: None,
            db_path: ":memory:".into(),
            scanner_cancel: Mutex::new(None),
            kernel: Mutex::new(Kernel::new()),
            session_store: Arc::new(RwLock::new(HashMap::new())),
            session_ttl_seconds: 86400,
            terminal_id: Arc::new(Mutex::new(None)),
            cache: create_cache("", 300),
            plugins: Mutex::new(None),
            topology_apply_lock: Mutex::new(()),
            db_manager: StoreDatabaseManager::new(std::env::temp_dir(), oz_core::migrations::ALL),
            picker_ticket_secret: b"test-picker-ticket-secret".to_vec(),
        }
    }

    /// Construct an `AppState` with a pre-configured connection (migrations
    /// already run). Used by integration tests that need a seeded database.
    pub fn for_test_with_conn(conn: Connection) -> Self {
        Self {
            db: Arc::new(Mutex::new(conn)),
            registry: Arc::new(DriverRegistry::default()),
            app: None,
            db_path: ":memory:".into(),
            scanner_cancel: Mutex::new(None),
            kernel: Mutex::new(Kernel::new()),
            session_store: Arc::new(RwLock::new(HashMap::new())),
            session_ttl_seconds: 86400,
            terminal_id: Arc::new(Mutex::new(None)),
            cache: create_cache("", 300),
            plugins: Mutex::new(None),
            topology_apply_lock: Mutex::new(()),
            db_manager: StoreDatabaseManager::new(std::env::temp_dir(), oz_core::migrations::ALL),
            picker_ticket_secret: b"test-picker-ticket-secret".to_vec(),
        }
    }

    /// Construct a test state with an isolated store database directory.
    ///
    /// Injecting the manager lets scope tests prove that a session cannot
    /// observe another store's database file.
    pub fn for_test_with_db_manager(db_manager: StoreDatabaseManager) -> Self {
        let mut state = Self::for_test();
        state.db_manager = db_manager;
        state
    }
}

#[cfg(test)]
#[path = "state_tests.rs"]
mod tests;
