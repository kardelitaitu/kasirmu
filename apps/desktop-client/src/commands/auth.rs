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

use oz_core::auth::LoginSession;
use oz_core::db::Store;
use oz_core::db::audit_security::{
    SECURITY_REASON_BAD_PIN, SECURITY_REASON_INACTIVE, SECURITY_REASON_RATE_LIMITED,
    SECURITY_REASON_UNKNOWN_USER, SecurityEvent,
};
use oz_core::session::SessionContext;
use oz_core::subscription::TenantSubscription;
use oz_security::mask::mask_token;

use foundation::validate_not_empty;

use crate::commands::picker_ticket;
use crate::error::AppError;
use crate::state::AppState;

/// Arguments for the `staff_login` command.
#[derive(Debug, Deserialize)]
pub struct StaffLoginArgs {
    /// Staff username (case-sensitive).
    pub username: String,
    /// Plain-text PIN entered by the staff member.
    pub pin: String,
    /// Optional device/terminal identifier for per-device abuse controls
    /// (STAFF-07). When absent the backend derives one from the host name
    /// (`COMPUTERNAME`/`HOSTNAME`) so distributed brute-force from a single
    /// terminal is still bounded.
    #[serde(default)]
    pub device_id: Option<String>,
}

/// Result of a successful staff login.
#[derive(Debug, Serialize)]
pub struct StaffLoginResult {
    /// Session info including user id, display name, and role.
    pub session: LoginSession,
    /// Short-lived picker ticket (audit-open-findings residual).
    ///
    /// The pre-session `list_workspaces` / `list_workspace_screens`
    /// commands verify this ticket and resolve the caller's REAL role
    /// from the database — caller-supplied `role_id` / `user_id` are
    /// never trusted for the workspace picker.
    pub picker_ticket: String,
}

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

/// The desktop's single security-event sink — the auth paths and the
/// staff-management paths both route here (todo-global-saas-2.md P1
/// "audit baseline").
///
/// Deliberately infallible from the caller's point of view: a failed audit
/// write is not a reason to refuse a correct PIN or destroy a session, so the
/// `Err` arm logs and drops. `Ok(false)` is the Free-tier gate — that tenant
/// keeps no tenant-facing audit records — and is silent by design.
///
/// Takes a borrowed [`Store`] rather than [`AppState`] because every login
/// site already holds the global DB lock; re-entering it would deadlock the
/// tokio mutex.
///
/// `debug_upgrade: true` matches the desktop's other tier reads
/// (`require_audit_tier`). It cannot smuggle a real Free tenant into the
/// table: `apply_debug_upgrade` is `cfg!(debug_assertions)`-gated, so only a
/// dev build promotes its own active Free row.
///
/// `pub(crate)` so the staff commands share this one definition: the
/// per-client tier-promotion policy is then stated exactly once and cannot
/// drift between the auth and staff-management paths.
pub(crate) fn record_security_event(store: &Store, event: &SecurityEvent) {
    match store.record_security_event(event, true) {
        Ok(true) => {}
        Ok(false) => tracing::debug!(
            action = event.action,
            "security event skipped: tier carries no audit retention entitlement"
        ),
        Err(e) => tracing::warn!(
            error = %e,
            action = event.action,
            "security event write failed — authentication continues"
        ),
    }
}

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
    let username = args.username.trim().to_lowercase();
    validate_not_empty("username", &username).map_err(|e| AppError::Invalid(e.to_string()))?;

    // S1: Enforce minimum 4-digit PIN at the server boundary.
    // Prevents brute-force on short PINs and keeps client/server in sync.
    if args.pin.len() < 4 {
        return Err(AppError::Invalid("PIN must be at least 4 digits".into()));
    }

    // STAFF-07: resolve the device id — prefer the caller's, else the host.
    let device_id = args
        .device_id
        .as_deref()
        .filter(|d| !d.is_empty())
        .map(str::to_owned)
        .or_else(|| std::env::var("COMPUTERNAME").ok())
        .or_else(|| std::env::var("HOSTNAME").ok());

    let db = state.db.lock().await;
    let store = Store::new(&db);

    // Check rate limiter (persistent — survives app restarts).
    // Records the attempt — on success (PIN correct) we clear the
    // counter; on failure the attempt stays recorded.
    if let Err(retry_after) = store.record_login_attempt_scoped(
        &username,
        device_id.as_deref(),
        oz_core::db::staff::LoginLimits {
            max_attempts: 3,         // per-account max
            window_secs: 60,         // window secs
            device_max_attempts: 10, // per-device max
            global_max_attempts: 30, // global max
            max_backoff_secs: 3600,  // max backoff secs
        },
    )? {
        tracing::warn!(
            username = %username,
            device_id = device_id.as_deref().unwrap_or("unknown"),
            retry_after,
            "staff login rate limit exceeded"
        );
        // A lockout is the strongest brute-force signal the limiter emits, so
        // it is recorded even though no credential was ever compared. No
        // account resolved at this point, hence the None user id.
        record_security_event(
            &store,
            &SecurityEvent::login_failed(
                &username,
                SECURITY_REASON_RATE_LIMITED,
                None,
                device_id.as_deref(),
            ),
        );
        return Err(AppError::Invalid(format!(
            "Too many attempts. Try again in {retry_after}s."
        )));
    }

    // Look up user by username.
    let user = match store.get_user_by_username(&username)? {
        Some(u) => u,
        None => {
            // Recorded against the attempted name: an unknown-account probe
            // is reconnaissance and the only identity here is the username.
            record_security_event(
                &store,
                &SecurityEvent::login_failed(
                    &username,
                    SECURITY_REASON_UNKNOWN_USER,
                    None,
                    device_id.as_deref(),
                ),
            );
            return Err(AppError::Invalid("invalid username or PIN".into()));
        }
    };

    // Uniform failure — do not reveal that the account is deactivated.
    if !user.is_active {
        tracing::debug!(
            username = %username,
            "staff login: account inactive (uniform error returned)"
        );
        // The client still hears the uniform message; the distinction lives
        // only in the audit row, which is where it belongs.
        record_security_event(
            &store,
            &SecurityEvent::login_failed(
                &username,
                SECURITY_REASON_INACTIVE,
                Some(&user.id),
                device_id.as_deref(),
            ),
        );
        return Err(AppError::Invalid("invalid username or PIN".into()));
    }

    // Verify PIN against stored hash.
    // `verify_pin` fails closed (Ok(false)) on malformed/placeholder hashes;
    // the Err arm is retained for future argon2 library errors.
    let valid = oz_core::auth::verify_pin(&args.pin, &user.pin_hash)
        .map_err(|e| AppError::Internal(format!("PIN verification failed: {e}")))?;

    if !valid {
        tracing::debug!(
            username = %username,
            "staff login: wrong PIN (uniform error returned)"
        );
        record_security_event(
            &store,
            &SecurityEvent::login_failed(
                &username,
                SECURITY_REASON_BAD_PIN,
                Some(&user.id),
                device_id.as_deref(),
            ),
        );
        return Err(AppError::Invalid("invalid username or PIN".into()));
    }

    // PIN correct — clear rate limiter for this user and device.
    store.clear_login_attempts(&username)?;
    if let Some(dev) = device_id.as_deref().filter(|d| !d.is_empty()) {
        store.clear_login_attempts_by_device(dev)?;
    }

    // Look up role for the session.
    let role = store
        .get_role(&user.role_id)?
        .ok_or_else(|| AppError::Internal(format!("role {} not found", user.role_id)))?;

    // Recorded only once the login is genuinely going to succeed: the role
    // above is the last thing that can fail it. Still inside the DB lock, so
    // the write shares the store the attempt was authenticated against.
    record_security_event(
        &store,
        &SecurityEvent::login_success(&user.id, &user.username, device_id.as_deref()),
    );

    drop(db);

    // Mint the short-lived picker ticket bound to this authenticated
    // user. It is only valid for the pre-session workspace picker;
    // `create_session` hands out the opaque session token afterwards.
    let now_ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let picker_ticket = picker_ticket::sign_picker_ticket(
        &state.picker_ticket_secret,
        &user.id,
        now_ts + picker_ticket::PICKER_TICKET_TTL_SECS,
    );

    // Granted keys ride the session so UI gates mirror the backend
    // registry (wildcards included) instead of role-name strings.
    let permissions = role.permission_keys();

    Ok(StaffLoginResult {
        session: LoginSession {
            user_id: user.id,
            display_name: user.display_name,
            role_name: role.name,
            role_id: role.id,
            permissions,
        },
        picker_ticket,
    })
}

/// Arguments for `create_session`.
#[derive(Debug, Deserialize)]
pub struct CreateSessionArgs {
    /// The authenticated user ID (must match the picker ticket).
    pub user_id: String,
    /// The user's active role ID.
    pub role_id: String,
    /// The resolved store ID.
    pub store_id: String,
    /// The resolved workspace instance ID.
    pub instance_id: String,
    /// The workspace type key (derived from the instance).
    pub type_key: String,
    /// The terminal/device ID.
    pub terminal_id: String,
    /// HMAC-signed picker ticket from `staff_login`/`bootstrap_owner`.
    /// Used to authenticate the caller's identity before minting a session.
    pub picker_ticket: String,
}

/// Result of `create_session` — returns the opaque session token.
#[derive(Debug, Serialize)]
pub struct CreateSessionResult {
    /// Opaque session token to be passed with every subsequent command.
    pub session_token: String,
    /// The resolved session context (for frontend display).
    pub context: SessionContextDto,
}

/// Lightweight session context DTO for the frontend.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionContextDto {
    /// ID of the associated user.
    pub user_id: String,
    /// ID of the associated role.
    pub role_id: String,
    /// ID of the associated store.
    pub store_id: String,
    /// ID of the associated instance.
    pub instance_id: String,
    /// Type Key.
    pub type_key: String,
    /// ID of the associated terminal.
    pub terminal_id: String,
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
    // H-3: Validate required fields BEFORE any side effects.
    if args.store_id.is_empty() || args.instance_id.is_empty() || args.user_id.is_empty() {
        return Err(AppError::Invalid(
            "store_id, instance_id, and user_id must not be empty".into(),
        ));
    }

    // H-3: Verify the picker ticket to authenticate the caller's identity.
    // The ticket was minted by staff_login/bootstrap_owner and bound to the
    // authenticated user. We derive user_id from the ticket instead of
    // trusting the caller-supplied value.
    let now_ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let verified_user_id = picker_ticket::verify_picker_ticket(
        &state.picker_ticket_secret,
        &args.picker_ticket,
        now_ts,
    )
    .ok_or_else(|| {
        tracing::warn!(
            user_id = %args.user_id,
            "session creation denied — invalid or expired picker ticket"
        );
        AppError::Invalid("Invalid or expired picker ticket".into())
    })?;

    // Ensure the caller-supplied user_id matches the ticket-bound identity.
    if verified_user_id != args.user_id {
        tracing::warn!(
            user_id = %args.user_id,
            ticket_user_id = %verified_user_id,
            "session creation denied — user_id mismatch with picker ticket"
        );
        return Err(AppError::Invalid("Invalid or expired picker ticket".into()));
    }

    // Server-side authorization: verify the user has a valid role assignment
    // for the requested workspace instance (ADR #4 / ADR #7).
    {
        let db = state.db.lock().await;
        let store = oz_core::db::Store::new(&db);
        if !store.verify_instance_access(
            &args.role_id,
            &args.user_id,
            &args.instance_id,
            &args.store_id,
        )? {
            tracing::warn!(
                user_id = %args.user_id,
                role_id = %args.role_id,
                instance_id = %args.instance_id,
                "authorization denied — user has no access to this instance"
            );
            return Err(AppError::Invalid(
                "User does not have access to this workspace instance".into(),
            ));
        }
    }

    // ADR #5: the tenant subscription gates which workspace types a session
    // may open. Role access (above) and tier entitlement are orthogonal —
    // an owner whose subscription no longer covers the type (e.g. kds after
    // a downgrade) must fail closed here, not after the session exists.
    // The signature is verified before the row's tier/allowed-types are
    // honored, matching create_staff_scoped and every other subscription-
    // trusting command: a tampered row (forged tier, invalid RSA signature)
    // must fail closed, not silently widen session access.
    let sub = {
        let db = state.db.lock().await;
        TenantSubscription::validate_clock_rollback(&db)?;
        let sub = TenantSubscription::load(&db, "default")?.unwrap_or_else(|| {
            tracing::warn!("no subscription found for tenant 'default', defaulting to Free tier");
            TenantSubscription::bootstrap_free()
        });
        sub.verify_signature()?;
        sub
    };
    if !sub.allows_workspace_type(&args.type_key) {
        tracing::warn!(
            user_id = %args.user_id,
            type_key = %args.type_key,
            "session creation denied — workspace type not entitled by tenant subscription"
        );
        return Err(AppError::Invalid(format!(
            "Workspace type '{}' is not entitled by the tenant subscription",
            args.type_key
        )));
    }

    let token = uuid::Uuid::now_v7().to_string();

    // Compute session expiry from the cached TTL setting.
    // 0 or negative means no expiry (development mode).
    let expires_at = if state.session_ttl_seconds > 0 {
        Some(now_ts + state.session_ttl_seconds)
    } else {
        None
    };

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
        // Iterates all entries to find the oldest by created_at timestamp.
        // With max 256 entries, this is negligible overhead and guarantees
        // fair eviction (unlike the previous non-deterministic keys().next()).
        const MAX_SESSIONS: usize = 256;
        if session_store.len() >= MAX_SESSIONS {
            let oldest_entry = session_store
                .iter()
                .min_by_key(|(_, ctx)| ctx.created_at)
                .map(|(token, _)| token.clone());

            if let Some(old_token) = oldest_entry {
                session_store.remove(&old_token);
                tracing::warn!(
                    old_token = %mask_token(&old_token),
                    "session store full — evicted oldest session by created_at"
                );
            }
        }

        let context = SessionContext::new(
            args.user_id.clone(),
            args.role_id.clone(),
            args.terminal_id.clone(),
            args.store_id.clone(),
            args.instance_id.clone(),
            args.type_key.clone(),
            expires_at,
            now_ts,
        );
        session_store.insert(token.clone(), context.clone());
    }

    // Invalidate the location cache — a new session means either a fresh
    // login or a workspace switch, so cached location bindings from the
    // previous session should not carry over.
    oz_core::location_resolver::invalidate_location_cache();

    tracing::info!(
        user_id = %args.user_id,
        store_id = %args.store_id,
        instance_id = %args.instance_id,
        ttl_seconds = %state.session_ttl_seconds,
        "session created"
    );

    Ok(CreateSessionResult {
        session_token: token,
        context: SessionContextDto {
            user_id: args.user_id,
            role_id: args.role_id,
            store_id: args.store_id,
            instance_id: args.instance_id,
            type_key: args.type_key,
            terminal_id: args.terminal_id,
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
    let session = state.resolve_session(&session_token)?;
    let db = state.db.lock().await;
    let store = Store::new(&db);

    // Record the attempt up front (same flow as staff_login: the counter
    // is cleared on success, failures stay counted).
    if let Err(retry_after) = store.record_login_attempt_scoped(
        &session.user_id,
        None,
        oz_core::db::staff::LoginLimits {
            max_attempts: 5,         // per-account max
            window_secs: 60,         // window secs
            device_max_attempts: 10, // per-device max (no device dimension here)
            global_max_attempts: 60, // global max
            max_backoff_secs: 3600,  // max backoff secs
        },
    )? {
        tracing::warn!(
            user_id = %session.user_id,
            retry_after,
            "verify_pin rate limit exceeded"
        );
        return Err(AppError::Invalid(format!(
            "Too many attempts. Try again in {retry_after}s."
        )));
    }

    let user = store
        .get_user(&session.user_id)?
        .ok_or_else(|| AppError::Invalid("user not found".into()))?;
    let valid = oz_core::auth::verify_pin(&pin, &user.pin_hash)
        .map_err(|e| AppError::Internal(format!("PIN verification failed: {e}")))?;
    if valid {
        // PIN correct — clear the limiter for this account.
        store.clear_login_attempts(&session.user_id)?;
    }
    Ok(valid)
}

/// Result of `refresh_picker_ticket` — a fresh HMAC-signed ticket.
#[derive(Debug, Serialize)]
pub struct RefreshPickerTicketResult {
    /// Fresh picker ticket valid for another 5 minutes.
    pub picker_ticket: String,
}

/// Mint a fresh picker ticket for a caller who already holds a valid session token.
///
/// Used when the UI returns to the workspace picker (e.g. Back button from KDS)
/// and needs to re-call `create_session` without going through `staff_login`
/// again. The picker ticket has a short TTL (5 minutes) so if the user was
/// browsing the workspace picker for longer than that, the original ticket
/// from login has expired.
///
/// Security: re-minting is safe because it requires a valid, non-expired
/// session token — proving the caller has already authenticated. The new
/// ticket is bound to the session's `user_id`, so identity is preserved.
#[tauri::command]
pub async fn refresh_picker_ticket(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<RefreshPickerTicketResult, AppError> {
    // Verify the existing session token — this proves the caller is already
    // authenticated (STAFF-01 / ADR #4).
    let session = state.resolve_session(&session_token)?;

    let now_ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    let picker_ticket = picker_ticket::sign_picker_ticket(
        &state.picker_ticket_secret,
        &session.user_id,
        now_ts + picker_ticket::PICKER_TICKET_TTL_SECS,
    );

    tracing::debug!(
        user_id = %session.user_id,
        "picker ticket refreshed via session token"
    );

    Ok(RefreshPickerTicketResult { picker_ticket })
}

// ── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "auth_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "security_scoped_integration_tests.rs"]
mod security_integration_tests;
