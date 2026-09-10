//! `BridgeCtx` — the tauri-free command middleware context.
//!
//! The bridge crate owns no state: a [`BridgeCtx`] is a per-call bundle of
//! references into the shell's `AppState`, built by the shim's `bridge_ctx()`
//! accessor and dropped when the command returns. Borrowing (rather than
//! holding `Arc`s) means a shell that re-assigns `db_manager` or
//! `session_store` is seen immediately by the next call, and nothing here can
//! outlive the state it points at. No tauri, gtk or webkit type appears in this
//! module.
//!
//! Session/scope resolution ([`BridgeCtx::resolve_session`],
//! [`BridgeCtx::resolve_scope`], [`BridgeCtx::resolve_store`]) and the authz
//! helpers are verbatim ports of the `AppState` / `commands/authz.rs`
//! behaviour: multi-KDS `restaurant_pos_id` binding, expired-token removal,
//! and fail-closed scope denial.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::RwLock;

use oz_core::cache::Cache;
use oz_core::db::Store;
use oz_core::db::assignments::ScopeType;
use oz_core::session::SessionContext;
use oz_hal::DriverRegistry;
use oz_plugin::PluginManager;
use oz_security::mask::mask_token;
use platform_core::StoreDatabaseManager;
use platform_kernel::Kernel;
use rusqlite::{Connection, OptionalExtension};
use tokio::sync::{Mutex, MutexGuard, oneshot};

use crate::error::BridgeError;

/// The bridge's tauri-free stand-in for `tauri::Emitter`.
///
/// Wave D commands (kds, hardware, pos) broadcast UI events, but no tauri
/// type may enter this crate: the shell implements this object-safe trait over
/// its `AppHandle` (`commands/authz.rs::TauriEventSink`) and injects it as
/// [`BridgeCtx::emitter`]. A recording mock serves headless tests, and `None`
/// — the headless default — makes every emit a silent no-op, exactly matching
/// the shell's `if let Some(app) = state.app.as_ref()` pattern: a lost UI
/// event is never a command failure.
pub trait EventSink: Send + Sync {
    /// Broadcast `event` to the frontend with `payload`.
    fn emit(&self, event: &'static str, payload: serde_json::Value);

    /// Broadcast a UI-facing event.
    ///
    /// The desktop sink only ever serves the UI, so the default forwards to
    /// [`EventSink::emit`]; a sink with a second destination overrides this.
    fn emit_ui(&self, event: &'static str, payload: serde_json::Value) {
        self.emit(event, payload);
    }
}

/// Everything a headless command body needs, borrowed from `AppState`.
pub struct BridgeCtx<'a> {
    /// Global identity DB (single connection, tokio Mutex).
    pub db: &'a Arc<Mutex<Connection>>,
    /// Per-store SQLite file manager (borrowed so re-assignment is seen).
    pub db_manager: &'a StoreDatabaseManager,
    /// Token -> SessionContext map (shared with AppState; tests mutate it after construction).
    pub sessions: &'a Arc<RwLock<HashMap<String, SessionContext>>>,
    /// Session TTL seconds (copied: immutable i64 field).
    pub session_ttl_seconds: i64,
    /// Cache layer for `Store::with_cache`.
    pub cache: &'a Arc<dyn Cache>,
    /// Kernel, for domain-event publishing on the event bus.
    pub kernel: &'a Mutex<Kernel>,
    /// Current terminal identity, if registered.
    pub terminal_id: &'a Arc<Mutex<Option<String>>>,
    /// Resolved `app_cache_dir` (None in headless/tests without an AppHandle).
    pub media_cache_dir: Option<PathBuf>,
    /// HMAC key for picker tickets (copied: minted per boot, tests seed their own).
    pub picker_ticket_secret: Vec<u8>,
    /// HAL driver registry: printers, scanners, drawers, displays, EDC, scales.
    pub registry: &'a DriverRegistry,
    /// Optional plugin manager for custom Lua business rules (`None` when no
    /// `plugins/` directory exists or loading failed).
    pub plugins: &'a Mutex<Option<PluginManager>>,
    /// UI event sink built from the shell's `AppHandle` (`None` headless).
    pub emitter: Option<Arc<dyn EventSink>>,
    /// Cancel token of the barcode-scanner poll loop: the shell keeps the
    /// `oneshot::Sender` while a loop is running; dropping or signalling it
    /// stops the loop gracefully.
    pub scanner_cancel: &'a Mutex<Option<oneshot::Sender<()>>>,
}

/// Map a gate denial to the client's `permissionDenied` wire shape.
///
/// `Store::require_permission_scoped` returns `CoreError::PermissionDenied`
/// for every fail-closed case; anything else (DB errors) becomes a `Core`
/// error as usual. Mirrors `commands/authz.rs::map_gate_error`.
fn map_gate_error(e: oz_core::CoreError) -> BridgeError {
    match e {
        oz_core::CoreError::PermissionDenied(message) => BridgeError::PermissionDenied(message),
        other => BridgeError::from(other),
    }
}

impl<'a> BridgeCtx<'a> {
    /// Resolve an opaque session token to its [`SessionContext`].
    ///
    /// ADR #4 / ADR #7: commands call this to look up the caller's resolved
    /// scope (store, instance, type, user, role, terminal). Returns
    /// [`BridgeError::InvalidSession`] if the token is unknown OR if the
    /// session has expired (TTL check).
    ///
    /// Expired sessions are atomically removed from the store during
    /// resolution, so subsequent lookups also get `InvalidSession`.
    ///
    /// Uses a double-check lock pattern: the fast path (valid session) only
    /// acquires a shared read lock; the exclusive write lock is taken only when
    /// a session is actually expired, which is rare.
    pub fn resolve_session(&self, token: &str) -> Result<SessionContext, BridgeError> {
        // Fast path: read-only check.
        {
            let store = self
                .sessions
                .read()
                .map_err(|e| BridgeError::Internal(format!("session store lock poisoned: {e}")))?;

            match store.get(token) {
                Some(ctx) if !ctx.is_expired() => return Ok(ctx.clone()),
                Some(_) => {} // expired — fall through to write-lock path
                None => return Err(BridgeError::InvalidSession),
            }
        }

        // Slow path: expired session — acquire write lock to remove it.
        let mut store = self
            .sessions
            .write()
            .map_err(|e| BridgeError::Internal(format!("session store lock poisoned: {e}")))?;

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

        Err(BridgeError::InvalidSession)
    }

    /// Resolve a session token to its [`SessionContext`] plus the
    /// store-scoped database connection for the session's effective store.
    ///
    /// Multi-KDS routing: when the session carries a `restaurant_pos_id`, the
    /// Restaurant POS terminal's `bound_location_id` (global `terminals`
    /// table) selects the store database. On lookup failure this falls back to
    /// `session.store_id` and logs a warning, exactly as
    /// `AppState::resolve_scope` does.
    pub fn resolve_scope(
        &self,
        token: &str,
    ) -> Result<(SessionContext, Arc<std::sync::Mutex<Connection>>), BridgeError> {
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
            .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
        Ok((session, conn))
    }

    /// Resolve a session token and return only the store-scoped database
    /// connection. Convenience wrapper for commands that do not need the
    /// [`SessionContext`] (e.g. `adjust_stock_scoped`).
    pub fn resolve_store(
        &self,
        token: &str,
    ) -> Result<Arc<std::sync::Mutex<Connection>>, BridgeError> {
        self.resolve_scope(token).map(|(_, conn)| conn)
    }

    /// Look up the store ID bound to a Restaurant POS terminal.
    ///
    /// Queries the global `terminals` table for the terminal's
    /// `bound_location_id`. Used by [`BridgeCtx::resolve_scope`] when a
    /// session carries a `restaurant_pos_id`.
    ///
    /// Uses `blocking_lock()` on the tokio Mutex — safe here because the lock
    /// is held for a single indexed SELECT (microseconds).
    ///
    /// Returns [`BridgeError::Invalid`] if the terminal is not found or has
    /// no binding.
    fn resolve_restaurant_pos_store(&self, restaurant_pos_id: &str) -> Result<String, BridgeError> {
        let db = self.db.blocking_lock();
        let binding: Option<String> = db
            .query_row(
                "SELECT bound_location_id FROM terminals WHERE id = ?1",
                rusqlite::params![restaurant_pos_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| BridgeError::Internal(format!("querying terminal binding: {e}")))?;
        binding.ok_or_else(|| {
            BridgeError::Invalid(format!(
                "restaurant POS '{restaurant_pos_id}' not found or has no store binding"
            ))
        })
    }

    /// Authorize a session against the GLOBAL identity database.
    ///
    /// Users + roles live ONLY in the global identity DB: staff CRUD writes
    /// there and per-store databases never receive user rows, so authorizing a
    /// store connection always fails with "user not found" for every caller —
    /// owner included. Commands that open a store-scoped DB MUST authorize here
    /// first.
    ///
    /// Scope-aware (ADR #35 D5 / spec 0048): the session's resolved store
    /// (branch) and workspace `type_key` are evaluated against the caller's
    /// assignment in addition to the permission — a scoped member whose session
    /// context is out of scope is denied fail-closed. Global assignments and
    /// legacy users without an assignment row are not scope-restricted.
    ///
    /// Mirrors `commands/authz.rs::require_permission_for_session`.
    ///
    /// # Errors
    ///
    /// Returns [`BridgeError::PermissionDenied`] when the user is missing,
    /// inactive, out of scope, or the role does not grant `required`;
    /// [`BridgeError::Core`] on DB errors.
    pub async fn require_session_permission(
        &self,
        session: &SessionContext,
        required: &str,
    ) -> Result<(), BridgeError> {
        let db = self.lock_global().await;
        let store = Store::new(&db);
        self.require_user_permission_scoped(
            &store,
            &session.user_id,
            required,
            Some(&session.store_id),
            Some(&session.type_key),
        )
    }

    /// The scope-aware gate over a caller-built [`Store`] (ADR #35 D5 /
    /// spec 0048): verifies the user's real role — so a tampered front end
    /// cannot forge a different `role_id` — plus that the role's assignment
    /// covers the given branch/workspace scope. Global assignments and legacy
    /// users without an assignment row are not scope-restricted.
    ///
    /// Mirrors `commands/authz.rs::require_permission_for_user_scoped`.
    pub fn require_user_permission_scoped(
        &self,
        store: &Store<'_>,
        user_id: &str,
        required: &str,
        branch: Option<&str>,
        workspace: Option<&str>,
    ) -> Result<(), BridgeError> {
        store
            .require_permission_scoped(user_id, required, branch, workspace)
            .map_err(map_gate_error)
    }

    /// The hierarchical session gate (ADR #47): what
    /// [`BridgeCtx::require_session_permission`] enforces, PLUS the caller's
    /// assignment must COVER the named resource.
    ///
    /// Coverage follows ruling 3's downward-only inheritance: an
    /// `organization` assignment covers every resource kind, a `location`
    /// assignment only its own location id, and a `legal_entity` assignment
    /// its own entity id plus any location belonging to it (the walk reads
    /// the GLOBAL identity DB's `locations` copy). Sibling and upward access
    /// deny, unknown locations deny fail-closed.
    ///
    /// Legacy users without an assignment row are not scope-restricted
    /// (ruling 5, preserved bit-for-bit); the permission itself is still
    /// enforced on every path.
    ///
    /// Mirrors `commands/authz.rs::require_permission_for_session_resource`.
    pub async fn require_permission_for_session_resource(
        &self,
        session: &SessionContext,
        required: &str,
        scope_type: ScopeType,
        scope_id: &str,
    ) -> Result<(), BridgeError> {
        let db = self.lock_global().await;
        let store = Store::new(&db);
        self.require_user_permission_scoped(
            &store,
            &session.user_id,
            required,
            Some(&session.store_id),
            Some(&session.type_key),
        )?;
        store
            .require_permission_for_resource(&session.user_id, required, scope_type, scope_id)
            .map_err(map_gate_error)
    }

    /// Create a cache-aware [`Store`] over a locked connection.
    ///
    /// Prefer [`BridgeCtx::store_with_tid`] when inventory-change pub/sub
    /// tagging matters: this sync form cannot await the `terminal_id` lock.
    pub fn store<'c>(&self, conn: &'c Connection) -> Store<'c> {
        Store::with_cache(conn, self.cache.clone())
    }

    /// Create a [`Store`] with the shared cache layer and a pre-acquired
    /// terminal identity for pub/sub message tagging.
    ///
    /// Callers acquire the terminal id via [`BridgeCtx::terminal_id`] BEFORE
    /// locking the database, so the db guard never crosses an await point.
    pub fn store_with_tid<'c>(&self, conn: &'c Connection, tid: Option<String>) -> Store<'c> {
        Store::with_cache(conn, self.cache.clone()).with_terminal_id(tid)
    }

    /// Lock the global identity DB (the authz path).
    ///
    /// Hold the returned guard only for the queries you need — it must not
    /// cross a long await.
    pub async fn lock_global(&self) -> MutexGuard<'a, Connection> {
        let db: &'a Arc<Mutex<Connection>> = self.db;
        db.lock().await
    }

    /// Current terminal id, or `None` when this device is not registered.
    pub async fn terminal_id(&self) -> Option<String> {
        self.terminal_id.lock().await.clone()
    }

    /// Best-effort domain-event publish on the kernel bus.
    ///
    /// Publishing is fire-and-forget for a command: a bus failure is logged
    /// and swallowed, so it never turns a committed write into a failed
    /// response.
    pub async fn publish_event<E>(&self, event: &E)
    where
        E: foundation::contracts::DomainEvent,
    {
        let kernel = self.kernel.lock().await;
        if let Err(e) = kernel.event_bus().publish(event) {
            tracing::warn!(error = %e, "event bus publish failed");
        }
    }
}
