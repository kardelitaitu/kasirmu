//! Session and pre-auth command bodies (Wave B / B4b).
//!
//! The half of `auth.rs` that runs AFTER a staff login: session keepalive,
//! organization switching, session destruction, and the two pre-auth lookups
//! the login screen needs (`check_username`, `has_users`).
//!
//! Main entry points: [`session_keepalive`], [`switch_organization`],
//! [`destroy_session`], [`check_username`], [`has_users`],
//! [`list_organizations`], [`invalidate_all_sessions`].
//!
//! Invariant: the session gates run on the global identity DB and every
//! mutation records a security event; `record_security_event` and the session
//! insert helpers are shared with the login half through `super`.

use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use foundation::validate_not_empty;
use kasirmu_core::db::Store;
use kasirmu_core::db::assignments::ScopeType;
use kasirmu_core::db::audit_security::SecurityEvent;

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

use super::{
    CreateSessionResult, SessionContextDto, insert_session, insert_session_at,
    record_security_event,
};

/// Bounded lifetime of an impersonation session, in seconds.
///
/// Verbatim port of the constant the desktop command module declared:
/// impersonation sessions are deliberately short-lived and never inherit the
/// operator's session.ttl_seconds, so a support session expires on its own
/// rather than riding a 24h operator login. The integration suite asserts that
/// the emitted expires_at always reflects this constant.
pub const IMPERSONATION_SESSION_TTL_SECONDS: i64 = 1800;

/// Arguments for the staff_check_username command.
#[derive(Debug, Deserialize)]
pub struct CheckUsernameArgs {
    /// Staff username to look up.
    pub username: String,
}

/// Result of a username existence check.
#[derive(Debug, Serialize)]
pub struct CheckUsernameResult {
    /// Always true. The pre-check never reveals whether the account
    /// exists or is active (STAFF-06); the real state is written to the
    /// server log only, and the login endpoint reports a uniform failure.
    pub proceed: bool,
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

/// Result of the has_users check.
#[derive(Debug, Serialize)]
pub struct HasUsersResult {
    /// Whether at least one user account exists in the database.
    pub has_users: bool,
}

/// Result of session_keepalive — the refreshed expiry timestamp.
#[derive(Debug, Serialize)]
pub struct SessionKeepaliveResult {
    /// Refreshed unix expiry (seconds). None when sessions have no
    /// TTL (development mode) — the frontend can stop pinging then.
    pub expires_at: Option<i64>,
}

/// Remove EVERY live session. Returns how many were dropped.
///
/// ADR #58 §2.5: "Live sessions must be invalidated on revocation." A ban that
/// only refused NEW sessions would leave the revoked tenant trading until their
/// current session's TTL expired — up to 24 hours of selling after an abuse
/// verdict, which is not what a revocation is for.
///
/// The session store is in-memory and process-wide, so this is the whole fleet
/// for this terminal's shell. It does NOT fail a command on a poisoned lock: the
/// caller is reporting a verdict, and a lock-poison warn is the same posture
/// `invalidate_session` already takes.
#[must_use]
pub fn invalidate_all_sessions(ctx: &BridgeCtx<'_>) -> usize {
    let mut store = match ctx.sessions.write() {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!("session store lock poisoned during revocation sweep: {e}");
            return 0;
        }
    };
    let dropped = store.len();
    store.clear();
    dropped
}

/// Remove one token from the shell's shared session map.
///
/// Verbatim port of AppState::invalidate_session, including the warn-on-
/// poison text: the caller gets false rather than an error, and the single
/// invalidation never fails a command.
fn invalidate_session(ctx: &BridgeCtx<'_>, token: &str) -> bool {
    let mut store = match ctx.sessions.write() {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!("session store lock poisoned during single invalidation: {e}");
            return false;
        }
    };
    store.remove(token).is_some()
}

/// Unix seconds, or `None` when the clock cannot be read.
///
/// This mirrored the command bodies' `.unwrap_or_default()`, which returned 0 on
/// a pre-epoch clock. Zero is not a harmless default for a session timestamp: the
/// expiry is computed as `now_ts + TTL` and `created_at` IS this value, so a
/// keepalive would stamp an expiry in 1970 and a switch/impersonation mint would
/// create an already-dead session. That direction happens to be closed — the
/// resulting session reads as expired — but only because `is_expired` was fixed
/// to fail closed as well; relying on the two to agree silently was the real
/// hazard, and this now refuses at the source.
fn now_ts() -> Option<i64> {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(d) => i64::try_from(d.as_secs()).ok(),
        Err(e) => {
            tracing::error!(
                error = %e,
                "system clock is before the UNIX epoch; refusing to timestamp a session"
            );
            None
        }
    }
}

/// Check a username before the PIN step (STAFF-06).
///
/// Returns a uniform pre-auth response so the command cannot be used as an
/// account-enumeration oracle: it always answers proceed: true for any
/// syntactically valid username, whether the account exists, is inactive, or
/// is unknown. The actual found/active state is emitted as a server-side trace
/// only, behind a randomized 50-200ms delay that masks timing side-channels.
///
/// # Errors
///
/// Returns [BridgeError::Invalid] for an empty username and
/// [BridgeError::Core] on DB errors.
pub async fn check_username(
    ctx: &BridgeCtx<'_>,
    args: &CheckUsernameArgs,
) -> Result<CheckUsernameResult, BridgeError> {
    let username = args.username.trim().to_lowercase();
    validate_not_empty("username", &username).map_err(|e| BridgeError::Invalid(e.to_string()))?;

    // S3: Random delay (50-200ms) to mask timing side-channels.
    //
    // A pre-epoch clock must NOT collapse this to a constant: `subsec_nanos()` of a
    // failed read is `0`, which yields exactly 50 ms on every attempt and defeats the
    // mask this line exists to provide — the STAFF-06 account-enumeration defence.
    // The seed degrades to a clock-independent value rather than refusing, because a
    // refusal here would deny a legitimate login for a reason unrelated to
    // credentials, and because the mask only needs to be unpredictable to a remote
    // client, not cryptographically strong.
    //
    // Twin of the tablet's copy (`apps/mobile-tauri/src/commands/auth.rs`), which was
    // fixed first; the two are ADR-49 duplicates and must stay in step. Unlike the
    // `now_ts` helper below, this one does NOT propagate an error — see the note
    // there for why the two sites legitimately differ.
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or_else(|_| {
            tracing::warn!("system clock is before the UNIX epoch; timing mask seeded without it");
            // A CONSTANT would defeat the mask, which is this line's whole purpose,
            // so fall back to a process-local counter that still differs per attempt.
            use std::sync::atomic::{AtomicU32, Ordering};
            static FALLBACK_SEQ: AtomicU32 = AtomicU32::new(0);
            FALLBACK_SEQ
                .fetch_add(2654435761, Ordering::Relaxed)
                .wrapping_mul(0x9E37_79B9)
        });
    let delay_ms: u64 = 50 + (nanos % 151) as u64;

    // Scope the DB lock so Store<'_> (which is not Send) is dropped
    // before the tokio::time::sleep await point.
    {
        let db = ctx.lock_global().await;
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

/// Enumerate the Organizations (legal entities) this device knows about.
///
/// SaaS-3 L194 (pre-login org selector source). This is a DEVICE-LOCAL
/// enumeration: it returns the legal_entities belonging to the device tenant
/// (default) and nothing else. It is callable before authentication because it
/// reveals only org ids/names (device configuration, not account secrets), and
/// it is the enumerated allow-list that create_session and switch_organization
/// constrain org selection to — no cross-tenant identity broker exists.
///
/// # Errors
///
/// Returns [BridgeError::Core] when the entity list fails.
pub async fn list_organizations(
    ctx: &BridgeCtx<'_>,
) -> Result<Vec<OrganizationSummary>, BridgeError> {
    let db = ctx.lock_global().await;
    let store = Store::new(&db);
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

/// Check whether any staff accounts exist in the database.
///
/// Used on startup to decide whether to show the owner bootstrap screen
/// (CreatePinScreen) or the regular login screen. This is a pre-auth query —
/// it does not reveal any account details, only whether the users table is
/// non-empty.
///
/// # Errors
///
/// Returns [BridgeError::Core] when the user list fails.
pub async fn has_users(ctx: &BridgeCtx<'_>) -> Result<HasUsersResult, BridgeError> {
    let db = ctx.lock_global().await;
    let store = Store::new(&db);
    let users = store.list_users()?;
    Ok(HasUsersResult {
        has_users: !users.is_empty(),
    })
}

/// Destroy an active session, invalidating the token.
///
/// ADR #4 / ADR #7: called on logout or store switch. After this call, any
/// commands using the old token fail with InvalidSession. Records a logout
/// security event when the token actually resolved; an unknown or already-
/// evicted token records nothing, so a replayed logout cannot manufacture
/// phantom events.
///
/// # Errors
///
/// Returns [BridgeError::Internal] with the shell's exact poisoned-lock text
/// when the session map's write lock is poisoned, and [BridgeError::Core] on
/// a DB failure while recording the event.
pub async fn destroy_session(ctx: &BridgeCtx<'_>, session_token: &str) -> Result<(), BridgeError> {
    // Take the context out with the token so the logout event can name who
    // left. The std RwLock guard is scoped and dropped before the DB await —
    // it is not Send and must never be held across it.
    let session = {
        let mut sessions = ctx
            .sessions
            .write()
            .map_err(|e| BridgeError::Internal(format!("session store lock poisoned: {e}")))?;
        sessions.remove(session_token)
    };

    if let Some(session) = session {
        let db = ctx.lock_global().await;
        let store = Store::new(&db);
        let username = store
            .get_user(&session.user_id)
            .ok()
            .flatten()
            .map(|u| u.username)
            .unwrap_or_default();
        record_security_event(
            &store,
            &SecurityEvent::logout(&session.user_id, username, Some(&session.terminal_id)),
        );
    }

    tracing::info!("session destroyed");
    Ok(())
}

/// Refresh the current session's TTL so long-lived screens (analytics,
/// reports, dashboards) keep the session alive during active use.
///
/// ADR #7: extends expires_at to now + session.ttl_seconds for a still-valid
/// session, identical to the expiry create_session assigns. Returns
/// InvalidSession when the token is unknown or already expired (matching
/// resolve_session), so the frontend hears about a dead session through the
/// same typed error as any command. Sessions without an expiry (development
/// mode) are a no-op and return expires_at: None.
///
/// # Errors
///
/// Returns [BridgeError::InvalidSession] for an unknown or expired token,
/// [BridgeError::Internal] with the shell's exact poisoned-lock text, and
/// [BridgeError::Core] never (no DB access).
pub fn session_keepalive(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<SessionKeepaliveResult, BridgeError> {
    let mut store = ctx
        .sessions
        .write()
        .map_err(|e| BridgeError::Internal(format!("session store lock poisoned: {e}")))?;

    let expired = match store.get(session_token) {
        Some(session) => session.is_expired(),
        None => return Err(BridgeError::InvalidSession),
    };
    if expired {
        store.remove(session_token);
        return Err(BridgeError::InvalidSession);
    }

    let Some(now_ts) = now_ts() else {
        return Err(BridgeError::Internal(
            "system clock is before the UNIX epoch; refusing to refresh a session expiry".into(),
        ));
    };
    let expires_at = if ctx.session_ttl_seconds > 0 {
        Some(now_ts + ctx.session_ttl_seconds)
    } else {
        None
    };
    if let Some(entry) = store.get_mut(session_token) {
        entry.expires_at = expires_at;
    }

    tracing::debug!(ttl_seconds = %ctx.session_ttl_seconds, "session keepalive");
    Ok(SessionKeepaliveResult { expires_at })
}

/// Switch the active Organization (legal entity) for an authenticated session.
///
/// SaaS-3 L194. The sequence is fail-closed and mirrors the impersonation
/// guard, but the leak class it closes is different: it must never leave BOTH
/// the old and new tokens live. So it INVALIDATES the current token FIRST (old
/// token dead before any new session exists), then mints a fresh session whose
/// scope re-derives from the user assignment alone — no credential carryover,
/// no grant merge.
///
/// Steps (verbatim order from the command body):
/// 1. Resolve + authenticate the current session (caller identity).
/// 2. The chosen org must be in the device-local enumerated set.
/// 3. The user assignment must cover the org (assignment_covers_resource with
///    ScopeType::LegalEntity) — fail-closed, mirroring the impersonation guard.
/// 4. FULL re-authentication: the PIN is verified against the users stored
///    pin_hash — no credential carryover from the old session.
/// 5. check_tenant_integrity re-runs on the single already-open tenant DB as
///    defense-in-depth, exactly as at startup.
/// 6. Invalidate the old token, THEN mint the new session through
///    [insert_session] — the shared mint primitive, so the prune, the
///    deterministic LRU eviction, the poisoned-lock text and the trailing
///    location-cache invalidation are identical to every other login.
///
/// # Errors
///
/// Returns [BridgeError::InvalidSession] for a dead token,
/// [BridgeError::Invalid] for "Unknown organization" / an uncovered org / a
/// missing user / an "invalid PIN", [BridgeError::Internal] for a PIN-hash
/// library failure, an integrity-check failure or a poisoned session lock, and
/// [BridgeError::Core] on DB errors.
pub async fn switch_organization(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    org_id: &str,
    pin: &str,
) -> Result<CreateSessionResult, BridgeError> {
    // 1. Resolve + authenticate the current session.
    let current = ctx.resolve_session(session_token)?;
    let user_id = current.user_id.clone();

    // 2. Enumerated-list-only: the org must be one this device knows.
    let org_name = {
        let db = ctx.lock_global().await;
        let store = Store::new(&db);
        store
            .get_legal_entity("default", org_id)?
            .map(|le| le.name)
            .ok_or_else(|| {
                tracing::warn!(
                    user_id = %user_id,
                    org_id = %org_id,
                    "organization switch denied — org not in device-local enumerated set"
                );
                BridgeError::Invalid("Unknown organization".into())
            })?
    };

    // 3. Assignment gate (fail-closed — mirrors the impersonation guard).
    {
        let db = ctx.lock_global().await;
        let store = Store::new(&db);
        let covered = store.assignment_covers_resource(&user_id, ScopeType::LegalEntity, org_id)?;
        if !covered.unwrap_or(false) {
            tracing::warn!(
                user_id = %user_id,
                org_id = %org_id,
                "organization switch denied — assignment does not cover org"
            );
            return Err(BridgeError::Invalid(
                "User does not have access to this organization".into(),
            ));
        }
    }

    // 4. FULL re-authentication — no credential carryover.
    let role_id = {
        let db = ctx.lock_global().await;
        let store = Store::new(&db);
        let user = store
            .get_user(&user_id)?
            .ok_or_else(|| BridgeError::Invalid("user not found".into()))?;
        let valid = kasirmu_core::auth::verify_pin(pin, &user.pin_hash)
            .map_err(|e| BridgeError::Internal(format!("PIN verification failed: {e}")))?;
        if !valid {
            tracing::warn!(
                user_id = %user_id,
                org_id = %org_id,
                "organization switch denied — PIN re-authentication failed"
            );
            return Err(BridgeError::Invalid("invalid PIN".into()));
        }
        user.role_id.clone()
    };

    // 5. Defense-in-depth: re-run tenant integrity on the active DB.
    {
        let db = ctx.lock_global().await;
        Store::new(&db)
            .check_tenant_integrity()
            .map_err(|e| BridgeError::Internal(format!("tenant integrity check: {e}")))?;
    }

    // 6. INVALIDATE the old token FIRST, then mint the new session.
    invalidate_session(ctx, session_token);

    let Some(now_ts) = now_ts() else {
        return Err(BridgeError::Internal(
            "system clock is before the UNIX epoch; refusing to mint a switched session".into(),
        ));
    };
    let token = insert_session(
        ctx,
        &user_id,
        &role_id,
        &current.terminal_id,
        &current.store_id,
        &current.instance_id,
        &current.type_key,
        now_ts,
    )?;

    // Security audit (todo-global-saas-3.md L227 multi-org follow-up): a
    // successful switch is a full re-authentication that re-scopes the
    // operator's data authority, so it is recorded like the other session
    // lifecycle events. Emitted only on the success path — the deny paths
    // above already log and leave no re-scoped session behind. A write
    // failure or tier skip never fails the switch itself (the
    // record_security_event helper logs and continues).
    {
        // Everything the audit write needs — the DB guard, the Store
        // borrow over it, the username lookup and the write itself —
        // lives and dies inside this scope. Nothing borrows the guard
        // across an await or outlives it, so the async future stays
        // Send (the same shape destroy_session uses for its logout
        // event).
        let db = ctx.lock_global().await;
        let store = Store::new(&db);
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
                org_id.to_string(),
            ),
        );
    }

    tracing::info!(user_id = %user_id, org_id = %org_id, "organization switched");

    Ok(CreateSessionResult {
        session_token: token,
        context: SessionContextDto {
            user_id,
            role_id,
            store_id: current.store_id.clone(),
            instance_id: current.instance_id.clone(),
            type_key: current.type_key.clone(),
            terminal_id: current.terminal_id.clone(),
            org_label: Some(org_name),
        },
    })
}

/// Begin an operator impersonation session for support.
///
/// The caller must present a valid operator session that holds the
/// operator:impersonate capability (granted to the ADMIN preset; OWNER
/// inherits it via *). The produced session carries ONLY the target user's
/// scope and grants — the impersonated context reuses the operator's
/// store/instance/type/terminal scope with the target's user_id/role_id. The
/// operator's own grants are never merged, and operator:impersonate is never
/// propagated into the produced token, so privilege amplification is
/// structurally impossible.
///
/// The target must belong to the operator's authorized tenant scope (the same
/// store/instance); otherwise the request is denied fail-closed. The session is
/// short-lived ([IMPERSONATION_SESSION_TTL_SECONDS]) and an
/// impersonate.start security event is recorded naming the operator (actor) and
/// the impersonated user (subject) — still BEFORE the mint, as the command body
/// did. The mint itself runs through [insert_session_at] because this path
/// pins its own expiry instead of the cached session TTL.
///
/// # Errors
///
/// Returns [BridgeError::InvalidSession] for a dead operator token,
/// [BridgeError::PermissionDenied] for a missing capability or a target
/// outside the operator's tenant scope, [BridgeError::Invalid] for an empty or
/// unknown target, [BridgeError::Internal] with the shell's exact poisoned-lock
/// text, and [BridgeError::Core] on DB errors.
pub async fn impersonate_user_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    target_user_id: &str,
) -> Result<CreateSessionResult, BridgeError> {
    // 1. Resolve and authenticate the operator's own session.
    let operator = ctx.resolve_session(session_token)?;

    // 2. Capability gate: the operator must hold operator:impersonate. This
    //    locks the DB internally and releases before returning, so the later
    //    locks below cannot deadlock.
    ctx.require_session_permission(&operator, kasirmu_core::permissions::OPERATOR_IMPERSONATE)
        .await?;

    // 3. Validate the target identifier (H-3: no empty input).
    if target_user_id.trim().is_empty() {
        return Err(BridgeError::Invalid(
            "target_user_id must not be empty".into(),
        ));
    }

    // 4. Resolve the target user and enforce tenant isolation within a single
    //    DB lock.
    let target = {
        let db = ctx.lock_global().await;
        let store = Store::new(&db);

        let target = store
            .get_user(target_user_id)?
            .ok_or_else(|| BridgeError::Invalid(format!("no such user: {target_user_id}")))?;

        // Tenant-isolation guard: the target must be reachable from the
        // operator's authorized store/instance. Impersonation never crosses a
        // tenant boundary.
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
            return Err(BridgeError::PermissionDenied(
                "Target user is outside the operator's authorized tenant scope".into(),
            ));
        }

        target
    };

    // Snapshot time once for both the expiry and the creation timestamp.
    let Some(now_ts) = now_ts() else {
        return Err(BridgeError::Internal(
            "system clock is before the UNIX epoch; refusing to mint an impersonation session"
                .into(),
        ));
    };
    let expires_at = Some(now_ts + IMPERSONATION_SESSION_TTL_SECONDS);

    // 5. Record the start event (actor = operator, subject = target). The
    //    produced session reuses the operator's scope with the target's
    //    identity, so the audit must name BOTH the operator (actor) and the
    //    impersonated user (subject) explicitly.
    {
        let db = ctx.lock_global().await;
        let store = Store::new(&db);
        // Resolve the operator's username for the audit actor field; fall back
        // to the id (e.g. when the operator row is unavailable) rather than
        // failing the whole impersonation over an audit detail.
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

    // 6. Insert the target-scoped session through the shared mint primitive
    //    (prune-at-200 / LRU-at-256 / location-cache invalidation), pinned to
    //    the short impersonation lifetime.
    let token = insert_session_at(
        ctx,
        &target.id,
        &target.role_id,
        &operator.terminal_id,
        &operator.store_id,
        &operator.instance_id,
        &operator.type_key,
        now_ts,
        expires_at,
    )?;

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
