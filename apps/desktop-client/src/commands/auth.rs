/*
last audited 25-07-26 by RSA-Agent (desktop-client slice B: auth deep read)
crate: desktop-client | status: SAFE | lint: CLEAN
findings: DC-3 FIXED — verify_pin now records attempts through the persistent per-account limiter (record_login_attempt_scoped, 5/60s per account + global 60/60s, same flow as staff_login: clear on success, failures stay counted), closing the in-session 4-digit PIN brute-force window; verification failure semantics unchanged (Ok(false) on bad PIN). Otherwise exemplary: STAFF-06 uniform pre-auth (no enumeration oracle) with randomized 50-200ms delay; STAFF-07 layered persistent rate limiting (3/10/30 per 60s + exponential backoff); verify_pin fails closed on malformed/placeholder hashes; picker-ticket identity binding with user_id match; server-side instance-access authorization; deterministic LRU session eviction with lazy prune; keepalive validates before refresh
next: none | perf: N/A
*/
//! Staff authentication commands — login, logout, session verification.
//!
//! These commands are the IPC surface for `ui/src/features/auth/`. PIN
//! hashing and verification is delegated to `oz_core::auth`.

#[allow(unused_imports)] // sibling *_tests.rs depends on it
use std::time::{SystemTime, UNIX_EPOCH};

#[allow(unused_imports)] // sibling *_tests.rs depends on it
use serde::{Deserialize, Serialize};
use tauri::State;

#[allow(unused_imports)] // sibling *_tests.rs depends on it
use oz_core::auth::LoginSession;
#[allow(unused_imports)] // sibling *_tests.rs depends on it
use oz_core::db::Store;
#[allow(unused_imports)] // sibling *_tests.rs depends on it
use oz_core::db::assignments::ScopeType;
#[allow(unused_imports)] // sibling *_tests.rs depends on it
use oz_core::db::audit_security::SecurityEvent;
#[allow(unused_imports)] // sibling *_tests.rs depends on it
use oz_core::permissions;
#[allow(unused_imports)] // sibling *_tests.rs depends on it
use oz_core::session::SessionContext;
#[allow(unused_imports)] // sibling *_tests.rs depends on it
use oz_core::subscription::TenantSubscription;
#[allow(unused_imports)] // sibling *_tests.rs depends on it
use oz_security::mask::mask_token;

#[allow(unused_imports)] // sibling *_tests.rs depends on it
use foundation::validate_not_empty;

#[allow(unused_imports)] // sibling *_tests.rs depends on it
use crate::commands::authz::require_permission_for_session;
#[allow(unused_imports)] // sibling *_tests.rs depends on it
use crate::commands::picker_ticket;
use crate::error::AppError;
use crate::state::AppState;

pub use oz_bridge::auth::{
    CheckUsernameArgs, CheckUsernameResult, CreateSessionArgs, CreateSessionResult, HasUsersResult,
    IMPERSONATION_SESSION_TTL_SECONDS, OrganizationSummary, RefreshPickerTicketResult,
    SessionContextDto, SessionKeepaliveResult, StaffLoginArgs, StaffLoginResult,
};

/// The desktop's single security-event sink, now owned by the bridge.
///
/// Re-exported so `commands/staff.rs` keeps importing it from here: the
/// per-client tier-promotion policy stays stated exactly once, and the
/// auth paths and the staff-management paths keep routing through one
/// definition. See `oz_bridge::auth::record_security_event`.

/// Check a username before the PIN step (STAFF-06).
///
/// Returns a **uniform** pre-auth response so the command cannot be used as
/// an account-enumeration oracle: it always answers `proceed: true` for any
/// syntactically valid username, whether the account exists, is inactive,
/// or is unknown. The actual found/active state is emitted as a server-side
/// trace only. Failed login attempts are handled by `staff_login`, which
/// reports a single uniform error for every bad-credential case.
#[tauri::command]
pub async fn staff_check_username(
    args: CheckUsernameArgs,
    state: State<'_, AppState>,
) -> Result<CheckUsernameResult, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::auth::check_username(&ctx, &args)
        .await
        .map_err(Into::into)
}

/// Authenticate a staff member by username and PIN.
///
/// Looks up the user by username, verifies the PIN against the stored
/// argon2 hash, and returns a [`LoginSession`] on success.
///
/// Rate limiting (STAFF-07) combines per-account, per-device, and global
/// abuse controls with exponential backoff instead of a fixed short lock:
///   - per account: 3 failed attempts in a 60s window
///   - per device:  10 failed attempts in a 60s window (across usernames)
///   - global:      30 failed attempts in a 60s window
/// Backoff doubles per strike (capped at 1h). All rows persist across
/// app restarts.
///
/// # Errors
///
/// Returns `Invalid` for a **uniform** credential failure — unknown user,
/// deactivated account, and wrong PIN all report the same message so the
/// endpoint cannot be used to enumerate accounts or probe account state
/// (STAFF-06/STAFF-07). The rate-limit lockout reports retry-after info
/// only.
#[tauri::command]
pub async fn staff_login(
    args: StaffLoginArgs,
    state: State<'_, AppState>,
) -> Result<StaffLoginResult, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::auth::staff_login(&ctx, &args)
        .await
        .map_err(Into::into)
}

/// Create a new session and return an opaque session token.
///
/// ADR #4 / ADR #7: Called after login + workspace selection to
/// establish the caller's resolved scope. The returned token must
/// be passed to every subsequent command as the `session_token`
/// parameter.
///
/// The token is a random UUID v7 stored in the in-memory session
/// store. Session TTL (default 24h) is configurable via the
/// `session.ttl_seconds` setting. A background daemon prunes
/// expired tokens every 5 minutes.
#[tauri::command]
pub async fn create_session(
    args: CreateSessionArgs,
    state: State<'_, AppState>,
) -> Result<CreateSessionResult, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::auth::create_session(&ctx, &args)
        .await
        .map_err(Into::into)
}

/// Enumerate the Organizations (legal entities) this device knows about.
///
/// SaaS-3 L194 (pre-login org selector source). This is a DEVICE-LOCAL
/// enumeration: it returns the legal_entities belonging to the device tenant
/// (default) and nothing else. It is callable before authentication because it
/// reveals only org ids/names (device configuration, not account secrets), and
/// it is the enumerated allow-list that create_session and switch_organization
/// constrain org selection to — no cross-tenant identity broker exists.
#[tauri::command]
pub async fn list_organizations(
    state: State<'_, AppState>,
) -> Result<Vec<OrganizationSummary>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::auth::list_organizations(&ctx)
        .await
        .map_err(Into::into)
}

/// Switch the active Organization (legal entity) for an authenticated session.
///
/// SaaS-3 L194. The sequence is fail-closed and mirrors the impersonation guard,
/// but the leak class it closes is different: it must never leave BOTH the old
/// and new tokens live. So it INVALIDATES the current token FIRST (old token dead
/// before any new session exists), then mints a fresh session whose scope
/// re-derives from the user assignment alone — no credential carryover, no grant
/// merge.
///
/// Steps:
/// 1. Resolve + authenticate the current session (caller identity).
/// 2. The chosen org must be in the device-local enumerated set.
/// 3. The user assignment must cover the org (assignment_covers_resource with
///    ScopeType::LegalEntity) — fail-closed, mirroring the impersonation guard.
///    Organization-scope users cover all; LegalEntity-scope users cover only
///    their own entity.
/// 4. FULL re-authentication: the PIN is verified against the users stored
///    pin_hash — no credential carryover from the old session.
/// 5. check_tenant_integrity re-runs on the single already-open tenant DB as
///    defense-in-depth, exactly as at startup.
/// 6. Invalidate the old token, THEN mint the new session.
#[tauri::command]
pub async fn switch_organization(
    session_token: String,
    org_id: String,
    pin: String,
    state: State<'_, AppState>,
) -> Result<CreateSessionResult, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::auth::switch_organization(&ctx, &session_token, &org_id, &pin)
        .await
        .map_err(Into::into)
}

/// Begin an operator impersonation session for support.
///
/// The caller must present a valid operator session that holds the
/// `operator:impersonate` capability (granted to the ADMIN preset; OWNER
/// inherits it via `*`). The produced session carries ONLY the target user's
/// scope and grants — the impersonated context reuses the operator's
/// store/instance/type/terminal scope with the target's `user_id`/`role_id`. The
/// operator's own grants are never merged, and `operator:impersonate` is never
/// propagated into the produced token, so privilege amplification is
/// structurally impossible.
///
/// The target must belong to the operator's authorized tenant scope (the same
/// store/instance); otherwise the request is denied fail-closed. The session is
/// short-lived ([`IMPERSONATION_SESSION_TTL_SECONDS`]) and an `impersonate.start`
/// security event is recorded naming the operator (actor) and the impersonated
/// user (subject).
#[tauri::command]
pub async fn impersonate_user_scoped(
    session_token: String,
    target_user_id: String,
    state: State<'_, AppState>,
) -> Result<CreateSessionResult, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::auth::impersonate_user_scoped(&ctx, &session_token, &target_user_id)
        .await
        .map_err(Into::into)
}

/// Check whether any staff accounts exist in the database.
///
/// Used on startup to decide whether to show the owner bootstrap
/// screen (CreatePinScreen) or the regular login screen. This is a
/// pre-auth query — it does not reveal any account details, only
/// whether the `users` table is non-empty.
#[tauri::command]
pub async fn has_users(state: State<'_, AppState>) -> Result<HasUsersResult, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::auth::has_users(&ctx).await.map_err(Into::into)
}

/// Destroy an active session, invalidating the token.
///
/// ADR #4 / ADR #7: Called on logout or store switch. After this
/// call, any commands using the old token will fail with
/// `AppError::InvalidSession`.
///
/// Records a `logout` security event when the token actually resolved. A
/// store switch destroys the old session too, and that is a genuine session
/// end worth recording; an unknown or already-evicted token records nothing,
/// so a replayed logout cannot manufacture phantom events.
#[tauri::command]
pub async fn destroy_session(
    state: State<'_, AppState>,
    session_token: String,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::auth::destroy_session(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Refresh the current session's TTL so long-lived screens (analytics,
/// reports, dashboards) keep the session alive during active use.
///
/// ADR #7: extends `expires_at` to `now + session.ttl_seconds` for a
/// still-valid session, identical to the expiry `create_session` assigns.
/// Returns `AppError::InvalidSession` when the token is unknown or
/// already expired (matching `resolve_session`), so the frontend hears
/// about a dead session through the same typed error as any command.
/// Sessions without an expiry (development mode) are a no-op and return
/// `expires_at: None`.
#[tauri::command]
pub async fn session_keepalive(
    state: State<'_, AppState>,
    session_token: String,
) -> Result<SessionKeepaliveResult, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::auth::session_keepalive(&ctx, &session_token).map_err(Into::into)
}

/// Verify the current session user's PIN.
///
/// Used by destructive operations (topology Apply, void, etc.) to
/// confirm the operator's identity before committing. The PIN is
/// compared against the hash stored in the global identity DB.
///
/// DC-3 fix: confirmation attempts are gated by the same persistent
/// per-account limiter as `staff_login` (STAFF-07). The session proves
/// prior authentication, but without a limiter a compromised renderer
/// could brute-force a 4-digit staff PIN at full speed inside a valid
/// session. The budget is looser than login (5/60s per account) because
/// the caller is already authenticated; successful verification clears
/// the counter.
#[tauri::command]
pub async fn verify_pin(
    state: State<'_, AppState>,
    session_token: String,
    pin: String,
) -> Result<bool, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::auth::verify_pin(&ctx, &session_token, &pin)
        .await
        .map_err(Into::into)
}

/// Mint a fresh picker ticket for a caller who already holds a valid session token.
///
/// Used when the UI returns to the workspace picker (e.g. Back button from KDS)
/// and needs to re-call `create_session` without going through `staff_login`
/// again. The body is the bridge's — see [`oz_bridge::auth::refresh_picker_ticket`].
#[tauri::command]
pub async fn refresh_picker_ticket(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<RefreshPickerTicketResult, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::auth::refresh_picker_ticket(&ctx, &session_token).map_err(Into::into)
}

// ── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "auth_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "security_scoped_integration_tests.rs"]
mod security_integration_tests;
