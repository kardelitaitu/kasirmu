/*
last audited 31-08-26 by RSA-Agent (user-role campaign, Section D)
crate: oz-tablet | status: SAFE | lint: CLEAN
findings: tablet twin of the desktop authz helpers — same map_gate_error to the permissionDenied wire shape, same defer to Store::require_permission[_scoped] (the centralized spec 0047 gate)
next: none | perf: fine
*/
//! Authorization helpers for Tauri commands.
//!
//! Provides `require_permission` and `require_permission_for_user`
//! to verify that the caller has the required permission.

use kasirmu_core::CoreError;
use kasirmu_core::db::Store;
use kasirmu_core::session::SessionContext;

use crate::error::AppError;
use crate::state::AppState;

use std::sync::Arc;

use kasirmu_bridge::ctx::EventSink;
use tauri::{AppHandle, Emitter};

/// [`EventSink`] over the tablet shell's `AppHandle`.
///
/// [`BridgeCtx::emitter`](kasirmu_bridge::ctx::BridgeCtx::emitter) is the
/// tauri-free stand-in for `tauri::Emitter`, so building the sink is the
/// shell's job: Wave D bridge bodies emit UI events through it instead of
/// holding a handle, which keeps `oz-bridge` headless. Mirrors the desktop
/// sink at `apps/desktop-client/src/commands/authz.rs`.
///
/// Built only from a live handle. A shell that holds one must hand out a
/// sink rather than `None`, because `None` makes every emit a silent
/// no-op — a lost UI event would still look like working behaviour.
pub(crate) struct TauriEventSink {
    handle: AppHandle,
}

impl EventSink for TauriEventSink {
    fn emit(&self, event: &'static str, payload: serde_json::Value) {
        // Same contract as the shell's `let _ = app.emit(..)`: a lost UI
        // event is never a command failure.
        let _ = self.handle.emit(event, payload);
    }
}

/// Box a sink for the `AppHandle` a live tablet build runs under.
pub(crate) fn event_sink(app: &AppHandle) -> Arc<dyn EventSink> {
    Arc::new(TauriEventSink {
        handle: app.clone(),
    })
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
/// has the given permission.  This prevents role‑ID forgery.
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

/// Authorize the session user against the GLOBAL identity database,
/// scope-aware (ADR #35 D5 / spec 0048): the session's resolved store
/// (branch) and workspace `type_key` are evaluated against the caller's
/// assignment in addition to the permission. Global assignments and legacy
/// users without an assignment row are not scope-restricted.
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

// ── Phase 3.3 T1: the bridge error seam ────────────────────────────
//
// kasirmu_bridge command bodies return `BridgeError`; the tablet shell's Tauri
// commands return `AppError`. This variant-for-variant conversion is the
// only place the two meet, mirroring the desktop seam in
// apps/desktop-client/src/commands/authz.rs. `BridgeError` is
// `#[non_exhaustive]`, so a wildcard arm is required from this crate; any
// variant a later bridge wave adds degrades to `AppError::Internal` rather
// than failing to compile, and the explicit arms above the wildcard must be
// extended when that happens. The desktop seam carries an explicit
// `TopologyValidation` arm; the tablet `AppError` has no such variant (no
// topology surface on this shell), so topology denials arrive through the
// wildcard as `Internal` — the same degradation the desktop seam promises
// for unknown variants.

impl From<kasirmu_bridge::error::BridgeError> for AppError {
    /// Variant-for-variant conversion back to the command error type.
    fn from(e: kasirmu_bridge::error::BridgeError) -> Self {
        match e {
            kasirmu_bridge::error::BridgeError::Core { sub_kind, message } => {
                Self::Core { sub_kind, message }
            }
            kasirmu_bridge::error::BridgeError::Invalid(message) => Self::Invalid(message),
            kasirmu_bridge::error::BridgeError::PermissionDenied(message) => {
                Self::PermissionDenied(message)
            }
            kasirmu_bridge::error::BridgeError::InvalidSession => Self::InvalidSession,
            kasirmu_bridge::error::BridgeError::Internal(message) => Self::Internal(message),
            kasirmu_bridge::error::BridgeError::Hardware { sub_kind, message } => {
                Self::Hardware { sub_kind, message }
            }
            other => Self::Internal(other.to_string()),
        }
    }
}

#[cfg(test)]
#[path = "authz_tests.rs"]
mod tests;
