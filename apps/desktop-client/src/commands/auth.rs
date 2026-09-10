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

use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::State;

#[allow(unused_imports)] // sibling *_tests.rs depends on it
use oz_core::auth::LoginSession;
use oz_core::db::Store;
use oz_core::db::assignments::ScopeType;
use oz_core::db::audit_security::SecurityEvent;
use oz_core::permissions;
use oz_core::session::SessionContext;
#[allow(unused_imports)] // sibling *_tests.rs depends on it
use oz_core::subscription::TenantSubscription;
use oz_security::mask::mask_token;

use foundation::validate_not_empty;

use crate::commands::authz::require_permission_for_session;
#[allow(unused_imports)] // sibling *_tests.rs depends on it
use crate::commands::picker_ticket;
use crate::error::AppError;
use crate::state::AppState;

pub use oz_bridge::auth::{
    CreateSessionArgs, CreateSessionResult, RefreshPickerTicketResult, SessionContextDto,
    StaffLoginArgs, StaffLoginResult,
};

/// Arguments for the `staff_check_username` command.
#[derive(Debug, Deserialize)]
pub struct CheckUsernameArgs {
    /// Staff username to look up.
    pub username: String,
}

/// Result of a username existence check.
#[derive(Debug, Serialize)]
pub struct CheckUsernameResult {
    /// Always `true`. The pre-check never reveals whether the account
    /// exists or is active (STAFF-06); the real state is written to the
    /// server log only, and the login endpoint reports a uniform failure.
    pub proceed: bool,
}

/// The desktop's single security-event sink, now owned by the bridge.
///
/// Re-exported so `commands/staff.rs` keeps importing it from here: the
/// per-client tier-promotion policy stays stated exactly once, and the
/// auth paths and the staff-management paths keep routing through one
/// definition. See `oz_bridge::auth::record_security_event`.
pub(crate) use oz_bridge::auth::record_security_event;

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
    let username = args.username.trim().to_lowercase();
    validate_not_empty("username", &username).map_err(|e| AppError::Invalid(e.to_string()))?;

    // S3: Random delay (50–200ms) to mask timing side-channels.
    // Computed before the DB lock so the delay is not blocked by the mutex.
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_nanos();
    let delay_ms: u64 = 50 + (nanos % 151) as u64;

    // Scope the DB lock so Store<'_> (which is not Send) is dropped
    // before the tokio::time::sleep await point.
    {
        let db = state.db.lock().await;
        let store = Store::new(&db);
        let user = store.get_user_by_username(&username)?;
        match &user {
            Some(u) => tracing::debug!(
                username = %username,
                is_active = u.is_active,
                "staff_check_username: account exists (server-side detail only)"
            ),
            None => tracing::debug!(
                username = %username,
                "staff_check_username: no such account (server-side detail only)"
            ),
        }
    } // db + Store dropped here — not held across the await

    tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;

    Ok(CheckUsernameResult { proceed: true })
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
    let db = state.db.lock().await;
    let store = oz_core::db::Store::new(&db);
    let orgs = store
        .list_legal_entities("default")?
        .into_iter()
        .map(|le| OrganizationSummary {
            id: le.id,
            name: le.name,
        })
        .collect();
    Ok(orgs)
}

/// Summary of an Organization (legal entity) available on this device.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizationSummary {
    /// Legal entity id (the legal_entities.id a session can be scoped to).
    pub id: String,
    /// Display name for the org selector.
    pub name: String,
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
    // 1. Resolve + authenticate the current session.
    let current = state.resolve_session(&session_token)?;
    let user_id = current.user_id.clone();

    // 2. Enumerated-list-only: the org must be one this device knows.
    let org_name = {
        let db = state.db.lock().await;
        let store = oz_core::db::Store::new(&db);
        store
            .get_legal_entity("default", &org_id)?
            .map(|le| le.name)
            .ok_or_else(|| {
                tracing::warn!(
                    user_id = %user_id,
                    org_id = %org_id,
                    "organization switch denied — org not in device-local enumerated set"
                );
                AppError::Invalid("Unknown organization".into())
            })?
    };

    // 3. Assignment gate (fail-closed — mirrors the impersonation guard).
    {
        let db = state.db.lock().await;
        let store = oz_core::db::Store::new(&db);
        let covered =
            store.assignment_covers_resource(&user_id, ScopeType::LegalEntity, &org_id)?;
        if !covered.unwrap_or(false) {
            tracing::warn!(
                user_id = %user_id,
                org_id = %org_id,
                "organization switch denied — assignment does not cover org"
            );
            return Err(AppError::Invalid(
                "User does not have access to this organization".into(),
            ));
        }
    }

    // 4. FULL re-authentication — no credential carryover.
    let role_id = {
        let db = state.db.lock().await;
        let store = oz_core::db::Store::new(&db);
        let user = store
            .get_user(&user_id)?
            .ok_or_else(|| AppError::Invalid("user not found".into()))?;
        let valid = oz_core::auth::verify_pin(&pin, &user.pin_hash)
            .map_err(|e| AppError::Internal(format!("PIN verification failed: {e}")))?;
        if !valid {
            tracing::warn!(
                user_id = %user_id,
                org_id = %org_id,
                "organization switch denied — PIN re-authentication failed"
            );
            return Err(AppError::Invalid("invalid PIN".into()));
        }
        user.role_id.clone()
    };

    // 5. Defense-in-depth: re-run tenant integrity on the active DB.
    {
        let db = state.db.lock().await;
        oz_core::db::Store::new(&db)
            .check_tenant_integrity()
            .map_err(|e| AppError::Internal(format!("tenant integrity check: {e}")))?;
    }

    // 6. INVALIDATE the old token FIRST, then mint the new session.
    state.invalidate_session(&session_token);

    let now_ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let token = uuid::Uuid::now_v7().to_string();
    let expires_at = if state.session_ttl_seconds > 0 {
        Some(now_ts + state.session_ttl_seconds)
    } else {
        None
    };

    let context = SessionContext::new(
        user_id.clone(),
        role_id,
        current.terminal_id.clone(),
        current.store_id.clone(),
        current.instance_id.clone(),
        current.type_key.clone(),
        expires_at,
        now_ts,
    );

    {
        let mut session_store = state
            .session_store
            .write()
            .map_err(|e| AppError::Internal(format!("session store lock poisoned: {e}")))?;
        if session_store.len() >= 256 {
            let oldest = session_store
                .iter()
                .min_by_key(|(_, c)| c.created_at)
                .map(|(t, _)| t.clone());
            if let Some(old) = oldest {
                session_store.remove(&old);
            }
        }
        session_store.insert(token.clone(), context.clone());
    }

    // Security audit (todo-global-saas-3.md L227 multi-org follow-up): a
    // successful switch is a full re-authentication that re-scopes the
    // operator's data authority, so it is recorded like the other session
    // lifecycle events. Emitted only on the success path — the deny paths
    // above already log and leave no re-scoped session behind. A write
    // failure or tier skip never fails the switch itself (the
    // `record_security_event` helper logs and continues).
    {
        // Everything the audit write needs — the DB guard, the Store
        // borrow over it, the username lookup and the write itself —
        // lives and dies inside this scope. Nothing borrows the guard
        // across an await or outlives it, so the async future stays
        // Send (the same shape destroy_session uses for its logout
        // event).
        let db = state.db.lock().await;
        let store = oz_core::db::Store::new(&db);
        let username = store
            .get_user(&user_id)
            .ok()
            .flatten()
            .map(|u| u.username)
            .unwrap_or_default();
        record_security_event(
            &store,
            &SecurityEvent::org_switch(
                user_id.clone(),
                username,
                Some(current.terminal_id.clone()),
                org_id.clone(),
            ),
        );
    }

    tracing::info!(user_id = %user_id, org_id = %org_id, "organization switched");

    Ok(CreateSessionResult {
        session_token: token,
        context: SessionContextDto {
            user_id,
            role_id: context.role_id.clone(),
            store_id: context.store_id.clone(),
            instance_id: context.instance_id.clone(),
            type_key: context.type_key.clone(),
            terminal_id: context.terminal_id.clone(),
            org_label: Some(org_name),
        },
    })
}

/// Bounded lifetime of an impersonation session, in seconds.
///
/// Impersonation sessions are deliberately short-lived and never inherit the
/// operator's `session.ttl_seconds`: a support session must expire on its own
/// rather than ride a 24h operator login. The integration suite asserts that the
/// emitted `expires_at` always reflects this constant.
pub(crate) const IMPERSONATION_SESSION_TTL_SECONDS: i64 = 1800;

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
    // 1. Resolve and authenticate the operator's own session.
    let operator = state.resolve_session(&session_token)?;

    // 2. Capability gate: the operator must hold operator:impersonate. This locks
    //    the DB internally and releases before returning, so the later locks
    //    below cannot deadlock.
    require_permission_for_session(&state, &operator, permissions::OPERATOR_IMPERSONATE).await?;

    // 3. Validate the target identifier (H-3: no empty input).
    if target_user_id.trim().is_empty() {
        return Err(AppError::Invalid("target_user_id must not be empty".into()));
    }

    // 4. Resolve the target user and enforce tenant isolation within a single DB
    //    lock.
    let target = {
        let db = state.db.lock().await;
        let store = Store::new(&db);

        let target = store
            .get_user(&target_user_id)?
            .ok_or_else(|| AppError::Invalid(format!("no such user: {target_user_id}")))?;

        // Tenant-isolation guard: the target must be reachable from the operator's
        // authorized store/instance. Impersonation never crosses a tenant
        // boundary.
        if !store.verify_instance_access(
            &target.role_id,
            &target.id,
            &operator.instance_id,
            &operator.store_id,
        )? {
            tracing::warn!(
                operator = %operator.user_id,
                target = %target.id,
                operator_instance = %operator.instance_id,
                operator_store = %operator.store_id,
                "impersonation denied — target outside operator tenant scope"
            );
            return Err(AppError::PermissionDenied(
                "Target user is outside the operator's authorized tenant scope".into(),
            ));
        }

        target
    };

    // Snapshot time once for both the expiry and the creation timestamp.
    let now_ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    let token = uuid::Uuid::now_v7().to_string();
    let expires_at = Some(now_ts + IMPERSONATION_SESSION_TTL_SECONDS);

    // 5. Record the start event (actor = operator, subject = target). The
    //    produced session reuses the operator's scope with the target's identity,
    //    so the audit must name BOTH the operator (actor) and the impersonated
    //    user (subject) explicitly.
    {
        let db = state.db.lock().await;
        let store = Store::new(&db);
        // Resolve the operator's username for the audit actor field; fall back to
        // the id (e.g. when the operator row is unavailable) rather than failing
        // the whole impersonation over an audit detail.
        let operator_username = store
            .get_user(&operator.user_id)?
            .map(|u| u.username)
            .unwrap_or_else(|| operator.user_id.clone());
        let event = SecurityEvent::impersonate_start(
            operator.user_id.clone(),
            operator_username,
            target.id.clone(),
            target.username.clone(),
            Some(operator.terminal_id.clone()),
        );
        record_security_event(&store, &event);
    }

    // 6. Insert the target-scoped session, mirroring create_session's
    //    prune-at-200 / LRU-at-256 eviction so the impersonation store cannot
    //    grow unbounded.
    {
        let mut session_store = state
            .session_store
            .write()
            .map_err(|e| AppError::Internal(format!("session store lock poisoned: {e}")))?;

        // Lazy prune: sweep expired sessions when the store is near capacity.
        if session_store.len() >= 200 {
            let before = session_store.len();
            session_store.retain(|_, ctx| !ctx.is_expired());
            let pruned = before - session_store.len();
            if pruned > 0 {
                tracing::info!("lazy prune removed {pruned} expired session(s)");
            }
        }

        // Defensive: log if a UUID collision occurs (astronomically unlikely).
        if session_store.contains_key(&token) {
            tracing::warn!(token = %mask_token(&token), "session token collision detected — overwriting");
        }

        // Enforce a maximum session count with deterministic LRU eviction.
        const MAX_SESSIONS: usize = 256;
        if session_store.len() >= MAX_SESSIONS {
            let oldest_entry = session_store
                .iter()
                .min_by_key(|(_, ctx)| ctx.created_at)
                .map(|(t, _)| t.clone());
            if let Some(old_token) = oldest_entry {
                session_store.remove(&old_token);
                tracing::warn!(
                    old_token = %mask_token(&old_token),
                    "session store full — evicted oldest session by created_at"
                );
            }
        }

        let context = SessionContext::new(
            target.id.clone(),
            target.role_id.clone(),
            operator.terminal_id.clone(),
            operator.store_id.clone(),
            operator.instance_id.clone(),
            operator.type_key.clone(),
            expires_at,
            now_ts,
        );
        session_store.insert(token.clone(), context.clone());
    }

    tracing::info!(
        operator = %operator.user_id,
        target = %target.id,
        ttl_seconds = %IMPERSONATION_SESSION_TTL_SECONDS,
        "impersonation session started"
    );

    Ok(CreateSessionResult {
        session_token: token,
        context: SessionContextDto {
            user_id: target.id,
            role_id: target.role_id,
            store_id: operator.store_id,
            instance_id: operator.instance_id,
            type_key: operator.type_key,
            terminal_id: operator.terminal_id,
            org_label: None,
        },
    })
}

/// Result of the `has_users` check.
#[derive(Debug, Serialize)]
pub struct HasUsersResult {
    /// Whether at least one user account exists in the database.
    pub has_users: bool,
}

/// Check whether any staff accounts exist in the database.
///
/// Used on startup to decide whether to show the owner bootstrap
/// screen (CreatePinScreen) or the regular login screen. This is a
/// pre-auth query — it does not reveal any account details, only
/// whether the `users` table is non-empty.
#[tauri::command]
pub async fn has_users(state: State<'_, AppState>) -> Result<HasUsersResult, AppError> {
    let db = state.db.lock().await;
    let store = Store::new(&db);
    let users = store.list_users()?;
    Ok(HasUsersResult {
        has_users: !users.is_empty(),
    })
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
    // Take the context out with the token so the logout event can name who
    // left. The std RwLock guard is scoped and dropped before the DB await —
    // it is not Send and must never be held across it.
    let ctx = {
        let mut sessions = state
            .session_store
            .write()
            .map_err(|e| AppError::Internal(format!("session store lock poisoned: {e}")))?;
        sessions.remove(&session_token)
    };

    if let Some(ctx) = ctx {
        let db = state.db.lock().await;
        let store = Store::new(&db);
        let username = store
            .get_user(&ctx.user_id)
            .ok()
            .flatten()
            .map(|u| u.username)
            .unwrap_or_default();
        record_security_event(
            &store,
            &SecurityEvent::logout(&ctx.user_id, username, Some(&ctx.terminal_id)),
        );
    }

    tracing::info!("session destroyed");
    Ok(())
}

/// Result of `session_keepalive` — the refreshed expiry timestamp.
#[derive(Debug, Serialize)]
pub struct SessionKeepaliveResult {
    /// Refreshed unix expiry (seconds). `None` when sessions have no
    /// TTL (development mode) — the frontend can stop pinging then.
    pub expires_at: Option<i64>,
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
    let mut store = state
        .session_store
        .write()
        .map_err(|e| AppError::Internal(format!("session store lock poisoned: {e}")))?;

    let expired = match store.get(&session_token) {
        Some(ctx) => ctx.is_expired(),
        None => return Err(AppError::InvalidSession),
    };
    if expired {
        store.remove(&session_token);
        return Err(AppError::InvalidSession);
    }

    let now_ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let expires_at = if state.session_ttl_seconds > 0 {
        Some(now_ts + state.session_ttl_seconds)
    } else {
        None
    };
    if let Some(entry) = store.get_mut(&session_token) {
        entry.expires_at = expires_at;
    }

    tracing::debug!(ttl_seconds = %state.session_ttl_seconds, "session keepalive");
    Ok(SessionKeepaliveResult { expires_at })
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
