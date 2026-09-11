/*
last audited 31-08-26 by RSA-Agent (user-role campaign, Section D)
crate: oz-pos-app | status: SAFE | lint: CLEAN
findings: centralized enforcement gate per spec 0047 — require_permission[_scoped] defers to Store::authorize_with (db/staff.rs:297) which denies by default at every branch (unregistered required key, missing/inactive user, unresolvable role, scope mismatch); role derived server-side so the frontend cannot forge role_id; the session variant authorizes against the global identity DB (store DBs carry no user rows by design)
next: none | perf: one indexed user lookup + role fetch per gate — fine
*/
//! Authorization helpers for Tauri commands.
//!
//! Provides [`require_permission_for_user`](crate::commands::authz::require_permission_for_user) to verify that the caller
//! has the required permission: it looks up the user's actual role from
//! the database, preventing role‑ID forgery.

use oz_core::CoreError;
use oz_core::db::Store;
use oz_core::db::assignments::ScopeType;
use oz_core::session::SessionContext;

use crate::error::AppError;
use crate::state::AppState;

use std::sync::Arc;

use oz_bridge::ctx::EventSink;
use tauri::{AppHandle, Emitter};

/// [`EventSink`] over the shell's `AppHandle`.
///
/// Wave D bridge bodies emit UI events through the injected sink instead of a
/// tauri handle, which keeps `oz-bridge` headless. Built only when
/// `AppState::app` holds a handle (`None` in headless/test contexts).
struct TauriEventSink {
    handle: AppHandle,
}

impl EventSink for TauriEventSink {
    fn emit(&self, event: &'static str, payload: serde_json::Value) {
        // Mirrors the shell's `let _ = app.emit(...)`: a lost UI event is
        // never a command failure.
        let _ = self.handle.emit(event, payload);
    }
}

/// Map a gate denial to the client's `permissionDenied` wire shape.
///
/// `Store::require_permission` returns `CoreError::PermissionDenied` for
/// every fail-closed case; anything else (DB errors) becomes a `Core` error
/// as usual. The frontend sees `kind: "permissionDenied"` unchanged.
fn map_gate_error(e: CoreError) -> AppError {
    match e {
        CoreError::PermissionDenied(message) => AppError::PermissionDenied(message),
        other => AppError::from(other),
    }
}

/// Look up the user by `user_id`, load their role, and verify the role
/// has the given permission.
///
/// This is the recommended helper for all Tauri commands because the
/// backend always derives the role from the user — a compromised or
/// tampered frontend cannot forge a different role_id.
///
/// # Errors
///
/// Returns [`AppError::PermissionDenied`] if the user is not found,
/// the role is missing, or the permission is not granted.  Returns
/// [`AppError::Core`] on DB errors.
pub fn require_permission_for_user(
    store: &Store<'_>,
    user_id: &str,
    required: &str,
) -> Result<(), AppError> {
    store
        .require_permission(user_id, required)
        .map_err(map_gate_error)
}

/// The scope-aware variant (ADR #35 D5 / spec 0048): for commands that run
/// inside a branch/workspace context, this enforces the caller's scoped
/// assignment in addition to the permission. Global assignments and legacy
/// users without an assignment are not scope-restricted.
pub fn require_permission_for_user_scoped(
    store: &Store<'_>,
    user_id: &str,
    required: &str,
    branch: Option<&str>,
    workspace: Option<&str>,
) -> Result<(), AppError> {
    store
        .require_permission_scoped(user_id, required, branch, workspace)
        .map_err(map_gate_error)
}

/// Authorize the session user against the GLOBAL identity database.
///
/// Users + roles live ONLY in the global identity DB: staff CRUD
/// (`bootstrap_owner`, `create_staff`, `update_staff_scoped`) writes there,
/// and per-store databases never receive user rows — they run the same
/// migrations but the `users` table stays empty by design.
///
/// Commands that open a store-scoped DB (`open_store`) MUST authorize with
/// this helper before touching the store connection. Running
/// `require_permission_for_user` against the store connection always fails
/// with "user not found" for every caller — owner included — because the
/// lookup queries the store DB's empty `users` table (this was the topology
/// Apply denial: "You don't have permission to do this." for everyone).
///
/// Scope-aware (ADR #35 D5 / spec 0048, scoped-sessions follow-up): the
/// session's resolved store (branch) and workspace `type_key` are evaluated
/// against the caller's assignment in addition to the permission. A scoped
/// member whose session context is out of scope is denied fail-closed — a
/// session can never be switched into a store/workspace type the assignment
/// does not cover. Global assignments and legacy users without an assignment
/// row are not scope-restricted.
pub async fn require_permission_for_session(
    state: &AppState,
    session: &SessionContext,
    required: &str,
) -> Result<(), AppError> {
    let db = state.db.lock().await;
    let store = Store::new(&db);
    require_permission_for_user_scoped(
        &store,
        &session.user_id,
        required,
        Some(&session.store_id),
        Some(&session.type_key),
    )
}

/// The ADR #47 hierarchical-resource variant of the session gate (ruling
/// 2's single scoped choke point): everything
/// [`require_permission_for_session`] enforces, PLUS the caller's
/// assignment must COVER the named resource.
///
/// Coverage follows ruling 3's downward-only inheritance: an
/// `organization` assignment covers every resource kind, a `location`
/// assignment only its own location id, and a `legal_entity` assignment
/// its own entity id plus any location belonging to it (the walk reads
/// the GLOBAL identity DB's `locations` copy — the same connection this
/// gate already authorizes against, and the one boot resolution and the
/// local API consult). Sibling and upward access deny, unknown locations
/// deny fail-closed.
///
/// Legacy users without an assignment row are not scope-restricted
/// (ruling 5, preserved bit-for-bit); the permission itself is still
/// enforced on every path.
pub async fn require_permission_for_session_resource(
    state: &AppState,
    session: &SessionContext,
    required: &str,
    scope_type: ScopeType,
    scope_id: &str,
) -> Result<(), AppError> {
    let db = state.db.lock().await;
    let store = Store::new(&db);
    require_permission_for_user_scoped(
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

// ---------------------------------------------------------------------------
// Wave 2.0 bridge seam (ADDITIVE). No existing code above is modified.
//
// `bridge_ctx` is the single borrow point between the Tauri shell's
// `AppState` and the tauri-free `oz-bridge` crate: a shim builds one per
// call, runs the extracted command body, and maps `BridgeError` back to
// `AppError` variant-for-variant so the wire shape is untouched.
// ---------------------------------------------------------------------------

use tauri::Manager as _;

use oz_bridge::ctx::BridgeCtx;
use oz_bridge::error::BridgeError;

impl crate::state::AppState {
    /// Borrow a headless bridge context for command shims. Cheap: refs + one PathBuf clone.
    /// Must NOT lock anything (no blocking_lock — called inside async shims); borrows fields only.
    #[allow(dead_code)] // consumed by Wave A command shims
    pub(crate) fn bridge_ctx(&self) -> BridgeCtx<'_> {
        // The media root is a shell concern: `AppHandle` / `Manager` never
        // enter oz-bridge, so `app_cache_dir()` is resolved here and injected
        // as a plain PathBuf. `None` in headless/test contexts (no handle),
        // which is also how a failed resolution degrades — the same
        // `resolving app cache dir` text the command paths report.
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

        BridgeCtx {
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
            emitter: self.app.as_ref().map(|app| {
                let sink = TauriEventSink {
                    handle: app.clone(),
                };
                Arc::new(sink) as Arc<dyn EventSink>
            }),
            scanner_cancel: &self.scanner_cancel,
            topology_apply_lock: &self.topology_apply_lock,
        }
    }
}

impl From<BridgeError> for AppError {
    /// Variant-for-variant conversion back to the command error type.
    ///
    /// `BridgeError` is `#[non_exhaustive]`, so a wildcard arm is required
    /// from another crate; any variant added in a later wave degrades to
    /// `AppError::Internal` rather than failing to compile, and the explicit
    /// arms above it must be extended when that happens.
    fn from(e: BridgeError) -> Self {
        match e {
            BridgeError::Core { sub_kind, message } => Self::Core { sub_kind, message },
            BridgeError::Invalid(message) => Self::Invalid(message),
            BridgeError::PermissionDenied(message) => Self::PermissionDenied(message),
            BridgeError::InvalidSession => Self::InvalidSession,
            BridgeError::Internal(message) => Self::Internal(message),
            BridgeError::Hardware { sub_kind, message } => Self::Hardware { sub_kind, message },
            other => Self::Internal(other.to_string()),
        }
    }
}

#[cfg(test)]
#[path = "authz_tests.rs"]
mod tests;
