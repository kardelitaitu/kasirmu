//! Auth command bodies (Wave B / B4a) — the tauri-free half of
//! `apps/desktop-tauri/src/commands/auth.rs`.
//!
//! Key items: [`record_security_event`](crate::auth::record_security_event) (the desktop's single security-event
//! sink, shared with `commands/staff.rs`), [[`insert_session`](crate::auth::insert_session)] (the session
//! mint primitive — lazy prune, deterministic LRU eviction, location-cache
//! invalidation) and the headless [`staff_login`](crate::auth::staff_login), [`create_session`](crate::auth::create_session),
//! [`verify_pin`](crate::auth::verify_pin) and [`refresh_picker_ticket`](crate::auth::refresh_picker_ticket) operations.
//!
//! Gate order is a verbatim port of the command bodies: rate limit → user
//! lookup → active check → PIN verify → backoff clear → ticket mint → security
//! events for login, and ticket verify → user match → instance access →
//! subscription entitlement → prune → LRU evict → insert → invalidate for
//! session creation. Errors are `BridgeError`s that the shim maps to
//! `AppError` variant-for-variant, so the wire shape never moves.
//!
//! `ctx.sessions` IS the shell's shared session map: minting here is visible to
//! `AppState::resolve_session` with no copying. No `.await` happens while the
//! write guard is held.

use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use foundation::validate_not_empty;
use kasirmu_core::Settings;
use kasirmu_core::auth::LoginSession;
use kasirmu_core::db::Store;
use kasirmu_core::db::assignments::ScopeType;
use kasirmu_core::db::audit_security::{
    SECURITY_REASON_BAD_PIN, SECURITY_REASON_INACTIVE, SECURITY_REASON_RATE_LIMITED,
    SECURITY_REASON_UNKNOWN_USER, SecurityEvent,
};
use kasirmu_core::session::SessionContext;
use kasirmu_core::subscription::TenantSubscription;
use kasirmu_security::mask::mask_token;
use platform_core::settings::keys;

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

/// Read the Unix clock, refusing a pre-epoch value rather than defaulting to 0.
///
/// Every timestamp this module hands to a session or a picker ticket is derived
/// from this, and 0 is the one value that must never be assumed. A session minted
/// at 0 expires in 1970 and a picker-ticket expiry compared against 0 is never
/// "in the past", so `.unwrap_or_default()` — which is what this replaced, in
/// three separate places — turned an unreadable clock into a clock that trusts
/// every stale credential.
///
/// Returning `None` is the fail-closed answer: the caller denies. It is a
/// `Result`-free helper because the only sensible response is a denial, and
/// making each caller match on an error would invite one of them to default.
///
/// `pub(crate)` on purpose, and the scoping was load-bearing in the wrong
/// direction: this was private to this module while THREE callers elsewhere kept
/// their own `.unwrap_or_default()` copies — the picker-ticket verifies in
/// `workspaces.rs` (two) and the ticket mint in `staff.rs`. A fix that stops at a
/// module boundary leaves exactly the duplicates ADR-49 creates. Reach for this
/// helper rather than a fresh `SystemTime::now()` in any new caller.
pub(crate) fn now_unix_secs() -> Option<i64> {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(d) => i64::try_from(d.as_secs()).ok(),
        Err(e) => {
            tracing::error!(
                error = %e,
                "system clock is before the UNIX epoch; refusing to mint or verify a credential against it"
            );
            None
        }
    }
}
use crate::picker;

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
    /// Optional Organization (legal entity) id the session should be scoped to.
    ///
    /// SaaS-3 L194: this is a routing hint only — never an authentication or
    /// authorization input. The session authority derives from the user
    /// assignments row. create_session validates that the org is in the
    /// device-local enumerated set (legal_entities for tenant "default") and
    /// that the user assignment covers it (assignment_covers_resource with
    /// ScopeType::LegalEntity) before setting the display-only org_label.
    /// An org not on the device, or one the user cannot access, is refused
    /// (fail-closed), mirroring the impersonation guard.
    #[serde(default)]
    pub org_id: Option<String>,
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
    /// Display-only label for the Organization (legal entity) this session is
    /// scoped to. NEVER an authentication or authorization input — purely for
    /// UI presentation (SaaS-3 L194). The session authority derives from the
    /// user assignments row, not from this field.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub org_label: Option<String>,
}

/// Result of `refresh_picker_ticket` — a fresh HMAC-signed ticket.
#[derive(Debug, Serialize)]
pub struct RefreshPickerTicketResult {
    /// Fresh picker ticket valid for another 5 minutes.
    pub picker_ticket: String,
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
/// Takes a borrowed [`Store`] rather than the whole context because every
/// login site already holds the global DB lock; re-entering it would deadlock
/// the tokio mutex.
///
/// `debug_upgrade: true` matches the desktop's other tier reads
/// (`require_audit_tier`). It cannot smuggle a real Free tenant into the
/// table: `apply_debug_upgrade` is `cfg!(debug_assertions)`-gated, so only a
/// dev build promotes its own active Free row.
///
/// MEASURED 2026-09-24, and this is why the value is NOT drift: the flag is a
/// documented PER-CLIENT policy, not an inconsistency. The shared store says so
/// itself (`kasirmu-core/src/db/audit_security.rs:379-383`: *"desktop's dev
/// Free->Premium promotion records in a debug build ... and tablet passes `false`
/// so it never mirrors the desktop divergence"*). Flipping this site alone — which
/// R11 asks for on its face, that an audit record must not depend on the build
/// profile — would collapse a two-shell policy in one line and silently change what
/// a desktop debug build writes into the security trail.
///
/// `apps/mobile-tauri/src/commands/auth_tests.rs:1324` pins the asymmetry as text on
/// all three legs (tablet call, this call, the store doc) and says explicitly that
/// *"flipping one call site is not a decision about the other"*. So R11 is
/// SATISFIED IN SCOPE, NOT IN APPLICATION: the tablet already passes `false` and
/// never mirrors the divergence, which is R11's actual requirement. Merging the two
/// values is a different decision needing its own ruling, and its own edit to the
/// store's per-client paragraph.
pub fn record_security_event(store: &Store, event: &SecurityEvent) {
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

/// Mint a session into the shell's shared session map and return its token.
///
/// Verbatim port of the `create_session` store section: UUID v7 token, expiry
/// from the cached TTL (0 or negative means no expiry), lazy prune at 200
/// entries, a collision warning, deterministic LRU eviction at
/// `MAX_SESSIONS` = 256 by oldest `created_at`, then the insert, then
/// `invalidate_location_cache()` so no location binding from the previous
/// session carries over.
///
/// # Errors
///
/// Returns [`BridgeError::Internal`] with the shell's exact
/// "session store lock poisoned" text when the map's lock is poisoned.
#[allow(clippy::too_many_arguments)] // the flat list IS the session row; see insert_session_at
pub fn insert_session(
    ctx: &BridgeCtx<'_>,
    user_id: &str,
    role_id: &str,
    terminal_id: &str,
    store_id: &str,
    instance_id: &str,
    type_key: &str,
    now_ts: i64,
) -> Result<String, BridgeError> {
    // Compute session expiry from the cached TTL setting.
    // 0 or negative means no expiry (development mode).
    let expires_at = if ctx.session_ttl_seconds > 0 {
        Some(now_ts + ctx.session_ttl_seconds)
    } else {
        None
    };
    insert_session_at(
        ctx,
        user_id,
        role_id,
        terminal_id,
        store_id,
        instance_id,
        type_key,
        now_ts,
        expires_at,
    )
}

/// The same mint primitive with the expiry supplied by the caller.
///
/// [[`insert_session`]] is the TTL-aware form every ordinary login path uses;
/// this variant exists because the impersonation mint deliberately ignores
/// the cached TTL and pins its own short lifetime. Everything else - token
/// shape, lazy prune, collision warning, deterministic LRU eviction, the
/// exact poisoned-lock text and the trailing location-cache invalidation -
/// stays in one place so no caller can drift from it.
///
/// # Errors
///
/// Returns [`BridgeError::Internal`] with the shell's exact
/// "session store lock poisoned" text when the map's lock is poisoned.
#[allow(clippy::too_many_arguments)] // the flat list IS the session row: six identity columns plus the clock, plus the caller's expiry
pub fn insert_session_at(
    ctx: &BridgeCtx<'_>,
    user_id: &str,
    role_id: &str,
    terminal_id: &str,
    store_id: &str,
    instance_id: &str,
    type_key: &str,
    now_ts: i64,
    expires_at: Option<i64>,
) -> Result<String, BridgeError> {
    let token = uuid::Uuid::now_v7().to_string();

    {
        let mut session_store = ctx
            .sessions
            .write()
            .map_err(|e| BridgeError::Internal(format!("session store lock poisoned: {e}")))?;

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
            user_id.to_owned(),
            role_id.to_owned(),
            terminal_id.to_owned(),
            store_id.to_owned(),
            instance_id.to_owned(),
            type_key.to_owned(),
            expires_at,
            now_ts,
        );
        session_store.insert(token.clone(), context.clone());
    }

    // Invalidate the location cache — a new session means either a fresh
    // login or a workspace switch, so cached location bindings from the
    // previous session should not carry over.
    kasirmu_core::location_resolver::invalidate_location_cache();

    Ok(token)
}

/// Authenticate a staff member by username and PIN.
///
/// Verbatim port of the `staff_login` command body: uniform credential
/// failure (STAFF-06), layered persistent rate limiting with exponential
/// backoff (STAFF-07), a security event on every exit path, then the
/// short-lived picker ticket bound to the authenticated user.
///
/// # Errors
///
/// Returns [`BridgeError::Invalid`] for the uniform credential failure and the
/// rate-limit lockout, [`BridgeError::Internal`] for a missing role or an
/// argon2 library failure, and [`BridgeError::Core`] on DB errors.
pub async fn staff_login(
    ctx: &BridgeCtx<'_>,
    args: &StaffLoginArgs,
) -> Result<StaffLoginResult, BridgeError> {
    let username = args.username.trim().to_lowercase();
    validate_not_empty("username", &username).map_err(|e| BridgeError::Invalid(e.to_string()))?;

    // S1: Enforce minimum 4-digit PIN at the server boundary.
    // Prevents brute-force on short PINs and keeps client/server in sync.
    if args.pin.len() < 4 {
        return Err(BridgeError::Invalid("PIN must be at least 4 digits".into()));
    }

    // STAFF-07: resolve the device id — prefer the caller's, else the host.
    let device_id = args
        .device_id
        .as_deref()
        .filter(|d| !d.is_empty())
        .map(str::to_owned)
        .or_else(|| std::env::var("COMPUTERNAME").ok())
        .or_else(|| std::env::var("HOSTNAME").ok());

    let db = ctx.lock_global().await;
    let store = Store::new(&db);

    // Check rate limiter (persistent — survives app restarts).
    // Records the attempt — on success (PIN correct) we clear the
    // counter; on failure the attempt stays recorded.
    if let Err(retry_after) = store.record_login_attempt_scoped(
        &username,
        device_id.as_deref(),
        kasirmu_core::db::staff::LoginLimits {
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
        return Err(BridgeError::Invalid(format!(
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
            return Err(BridgeError::Invalid("invalid username or PIN".into()));
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
        return Err(BridgeError::Invalid("invalid username or PIN".into()));
    }

    // Verify PIN against stored hash.
    // `verify_pin` fails closed (Ok(false)) on malformed/placeholder hashes;
    // the Err arm is retained for future argon2 library errors.
    let valid = kasirmu_core::auth::verify_pin(&args.pin, &user.pin_hash)
        .map_err(|e| BridgeError::Internal(format!("PIN verification failed: {e}")))?;

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
        return Err(BridgeError::Invalid("invalid username or PIN".into()));
    }

    // PIN correct — clear rate limiter for this user and device.
    store.clear_login_attempts(&username)?;
    if let Some(dev) = device_id.as_deref().filter(|d| !d.is_empty()) {
        store.clear_login_attempts_by_device(dev)?;
    }

    // Look up role for the session.
    let role = store
        .get_role(&user.role_id)?
        .ok_or_else(|| BridgeError::Internal(format!("role {} not found", user.role_id)))?;

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
    // Fail closed: a pre-epoch clock would mint a ticket whose expiry is
    // meaningless, and `now_ts` also rides the session's `created_at`.
    let Some(now_ts) = now_unix_secs() else {
        return Err(BridgeError::Internal(
            "system clock is before the UNIX epoch; refusing to mint a session".into(),
        ));
    };
    let picker_ticket = picker::sign_picker_ticket(
        &ctx.picker_ticket_secret,
        &user.id,
        now_ts + picker::PICKER_TICKET_TTL_SECS,
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

/// Create a new session and return an opaque session token.
///
/// Verbatim port of the `create_session` command body (ADR #4 / ADR #7): the
/// picker ticket — not the caller-supplied `user_id` — authenticates the
/// request, then instance access, then the tenant subscription's workspace-type
/// entitlement (ADR #5), then the mint via [[`insert_session`]].
///
/// # Errors
///
/// Returns [`BridgeError::Invalid`] for every fail-closed denial (empty ids,
/// invalid/expired ticket, unknown org, uncovered org, no instance access,
/// unentitled workspace type) and [`BridgeError::Internal`] for a poisoned
/// session map; DB and subscription errors surface as [`BridgeError::Core`].
pub async fn create_session(
    ctx: &BridgeCtx<'_>,
    args: &CreateSessionArgs,
) -> Result<CreateSessionResult, BridgeError> {
    // H-3: Validate required fields BEFORE any side effects.
    if args.store_id.is_empty() || args.instance_id.is_empty() || args.user_id.is_empty() {
        return Err(BridgeError::Invalid(
            "store_id, instance_id, and user_id must not be empty".into(),
        ));
    }

    // H-3: Verify the picker ticket to authenticate the caller's identity.
    // The ticket was minted by staff_login/bootstrap_owner and bound to the
    // authenticated user. We derive user_id from the ticket instead of
    // trusting the caller-supplied value.
    // Fail closed, and this site is the sharpest of the three:
    // `verify_picker_ticket` compares the ticket's expiry against this value, so
    // a 0 here satisfies the check for every ticket ever minted — an expired
    // ticket would verify and a session would be minted from it.
    let Some(now_ts) = now_unix_secs() else {
        return Err(BridgeError::Internal(
            "system clock is before the UNIX epoch; refusing to verify a picker ticket".into(),
        ));
    };
    let verified_user_id =
        picker::verify_picker_ticket(&ctx.picker_ticket_secret, &args.picker_ticket, now_ts)
            .ok_or_else(|| {
                tracing::warn!(
                    user_id = %args.user_id,
                    "session creation denied — invalid or expired picker ticket"
                );
                BridgeError::Invalid("Invalid or expired picker ticket".into())
            })?;

    // Ensure the caller-supplied user_id matches the ticket-bound identity.
    if verified_user_id != args.user_id {
        tracing::warn!(
            user_id = %args.user_id,
            ticket_user_id = %verified_user_id,
            "session creation denied — user_id mismatch with picker ticket"
        );
        return Err(BridgeError::Invalid(
            "Invalid or expired picker ticket".into(),
        ));
    }

    // SaaS-3 L194: optional Organization (legal entity) scoping.
    //
    // org_id is a routing hint only — fail-closed validation derives the
    // session real authority from the user assignment. The org must be in the
    // device-local enumerated set and the user assignment must cover it.
    let org_label: Option<String> = match args.org_id.as_ref().filter(|o| !o.is_empty()) {
        Some(org_id) => {
            let db = ctx.lock_global().await;
            let store = Store::new(&db);
            let entity = store
                .get_legal_entity("default", org_id)?
                .ok_or_else(|| BridgeError::Invalid("Unknown organization".into()))?;
            let covered = store.assignment_covers_resource(
                &verified_user_id,
                ScopeType::LegalEntity,
                org_id,
            )?;
            if !covered.unwrap_or(false) {
                tracing::warn!(
                    user_id = %verified_user_id,
                    org_id = %org_id,
                    "session creation denied — assignment does not cover organization"
                );
                return Err(BridgeError::Invalid(
                    "User does not have access to this organization".into(),
                ));
            }
            Some(entity.name)
        }
        None => None,
    };

    // Server-side authorization: verify the user has a valid role assignment
    // for the requested workspace instance (ADR #4 / ADR #7).
    {
        let db = ctx.lock_global().await;
        let store = Store::new(&db);
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
            return Err(BridgeError::Invalid(
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
    let mut sub = {
        let db = ctx.lock_global().await;
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
        return Err(BridgeError::Invalid(format!(
            "Workspace type '{}' is not entitled by the tenant subscription",
            args.type_key
        )));
    }

    // ADR #58 §2.3 / §2.5: Pre-expiry re-authentication obligation for paid tenants.
    //
    // A paid tenant must re-authenticate within the last 3 days before expiry.
    // Outside that window it operates locally on its stored signature; Free tenants
    // and perpetual/lifetime licenses owe no check.
    // Inside the window (now_ledger <= expires_at && now_ledger >= expires_at - 3 days),
    // an online status check is triggered. Per §2.4, transport failures fail open into
    // grace, so an outage does not brick the till; but a successful check refreshes
    // the lease or returns an authoritative revocation/downgrade verdict.
    if sub.tier != kasirmu_core::subscription::SubscriptionTier::Free
        && let Some(ref expires_at_str) = sub.expires_at
        && let Ok(expiry_dt) = chrono::DateTime::parse_from_rfc3339(expires_at_str)
    {
        let expiry = expiry_dt.with_timezone(&chrono::Utc);
        let now_ledger = {
            let db = ctx.lock_global().await;
            match TenantSubscription::compute_max_ledger_timestamp(&db) {
                Ok(ts) => chrono::DateTime::parse_from_rfc3339(&ts)
                    .map(|dt| dt.with_timezone(&chrono::Utc))
                    .unwrap_or_else(|_| chrono::Utc::now()),
                Err(_) => chrono::Utc::now(),
            }
        };
        let window_start = expiry - chrono::Duration::days(3);
        if now_ledger >= window_start && now_ledger <= expiry {
            tracing::info!(
                tenant_id = %sub.tenant_id,
                "tenant is within 3-day pre-expiry window — executing re-auth status check (ADR #58 §2.3)"
            );
            // Best-effort check: if online, updates cache/CRL and sweeps sessions on revocation.
            // If network fails, fails open into grace per §2.4.
            if crate::license::check_license_status(ctx).await.is_ok() {
                let db = ctx.lock_global().await;
                if let Ok(Some(fresh_sub)) = TenantSubscription::load(&db, &sub.tenant_id)
                    && fresh_sub.verify_signature().is_ok()
                {
                    sub = fresh_sub;
                }
            }
        }
    }

    // ADR #58 §2.5: a REVOKED tenant gets no new session, therefore no app.
    //
    // This is the tenant-level arm, distinct from §2.4a.2's per-DEVICE check
    // above: revoking one tablet must not end a multi-terminal business, and
    // revoking the TENANT must end every one of them.
    //
    // Only this arm locks. §2.3's pre-expiry window deliberately does NOT
    // refuse on a failed check — it continues into §2.2 grace, because
    // refusing there would let our own outage lock every till approaching
    // renewal (§2.4). The window's job is to make the check happen, so a
    // `revoked` verdict reaches the device at all; the verdict is what locks.
    if sub.lifecycle_state() == kasirmu_core::subscription::SubscriptionLifecycleState::Revoked {
        tracing::warn!(
            user_id = %args.user_id,
            terminal_id = %args.terminal_id,
            "session creation denied — this tenant has been revoked by an administrator"
        );
        return Err(BridgeError::Invalid(
            "This account has been revoked. Contact your administrator.".into(),
        ));
    }

    // ADR #58 §2.4a.2: refuse a session on a device a tenant admin revoked.
    //
    // The verdict is the *cached* server answer (written by
    // `license::check_license_status`), so this is a local read and cannot
    // block on the network — §2.7 forbids a network call that could brick a
    // register. `args.terminal_id` is already resolved by the caller, so no
    // new plumbing is needed.
    //
    // Fail-open by construction: an absent or unparseable value reads as
    // "not revoked", because a missing cache must never lock a till (§2.4).
    {
        let conn = ctx.lock_global().await;
        let revoked = Settings::get(&conn, keys::DEVICE_REVOKED)?
            .map(|v| v.eq_ignore_ascii_case("true"))
            .unwrap_or(false);
        if revoked {
            tracing::warn!(
                user_id = %args.user_id,
                terminal_id = %args.terminal_id,
                "session creation denied — this device has been revoked by an administrator"
            );
            return Err(BridgeError::Invalid(
                "This device has been revoked. Contact your administrator.".into(),
            ));
        }
    }

    let token = insert_session(
        ctx,
        &args.user_id,
        &args.role_id,
        &args.terminal_id,
        &args.store_id,
        &args.instance_id,
        &args.type_key,
        now_ts,
    )?;

    tracing::info!(
        user_id = %args.user_id,
        store_id = %args.store_id,
        instance_id = %args.instance_id,
        ttl_seconds = %ctx.session_ttl_seconds,
        "session created"
    );

    Ok(CreateSessionResult {
        session_token: token,
        context: SessionContextDto {
            // args is borrowed (the shim owns it), so the DTO clones the six
            // ids rather than moving them out.
            user_id: args.user_id.clone(),
            role_id: args.role_id.clone(),
            store_id: args.store_id.clone(),
            instance_id: args.instance_id.clone(),
            type_key: args.type_key.clone(),
            terminal_id: args.terminal_id.clone(),
            org_label,
        },
    })
}

/// Verify the current session user's PIN.
///
/// Verbatim port of the `verify_pin` command body (DC-3): the attempt is
/// recorded through the same persistent per-account limiter as `staff_login`
/// (5/60s per account, global 60/60s) before the hash comparison, and a
/// correct PIN clears the counter. Verification failure semantics are
/// unchanged — `Ok(false)` on a bad PIN.
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for an unknown/expired token,
/// [`BridgeError::Invalid`] for the lockout or a missing user,
/// [`BridgeError::Internal`] for an argon2 library failure, and
/// [`BridgeError::Core`] on DB errors.
pub async fn verify_pin(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    pin: &str,
) -> Result<bool, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    let db = ctx.lock_global().await;
    let store = Store::new(&db);

    // Record the attempt up front (same flow as staff_login: the counter
    // is cleared on success, failures stay counted).
    if let Err(retry_after) = store.record_login_attempt_scoped(
        &session.user_id,
        None,
        kasirmu_core::db::staff::LoginLimits {
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
        return Err(BridgeError::Invalid(format!(
            "Too many attempts. Try again in {retry_after}s."
        )));
    }

    let user = store
        .get_user(&session.user_id)?
        .ok_or_else(|| BridgeError::Invalid("user not found".into()))?;
    let valid = kasirmu_core::auth::verify_pin(pin, &user.pin_hash)
        .map_err(|e| BridgeError::Internal(format!("PIN verification failed: {e}")))?;
    if valid {
        // PIN correct — clear the limiter for this account.
        store.clear_login_attempts(&session.user_id)?;
    }
    Ok(valid)
}

/// Mint a fresh picker ticket for a caller who already holds a valid session token.
///
/// Verbatim port of the `refresh_picker_ticket` command body. Used when the UI
/// returns to the workspace picker (e.g. Back button from KDS) and needs to
/// re-call `create_session` without going through `staff_login` again. The
/// picker ticket has a short TTL (5 minutes) so if the user was browsing the
/// workspace picker for longer than that, the original ticket from login has
/// expired.
///
/// Security: re-minting is safe because it requires a valid, non-expired
/// session token — proving the caller has already authenticated. The new
/// ticket is bound to the session's `user_id`, so identity is preserved.
///
/// It is SYNC, and that is the whole reason it needs its own account check
/// rather than trusting the token. `resolve_session` would verify the account
/// is still live, but it also takes the identity-DB lock, which a sync fn
/// cannot `await`; the port therefore dropped the check and kept only the
/// in-memory lookup. A session minted before a manager DEACTIVATED the account
/// stays in the map until its TTL (up to 24h) or the 30s revalidation window
/// happens to be crossed by some OTHER command — so this call laundered a dead
/// account's token into a fresh 5-minute picker ticket, and the ticket is a
/// bearer credential for the pre-session workspace picker. The ticket itself
/// carries no account state, so nothing downstream can re-check it.
///
/// The check is done here with `try_lock` rather than by making the fn async.
/// The grant is a *downgrade* of an existing session, not an authentication,
/// so a busy identity DB must not become a new failure mode (the same
/// fail-open posture `revalidate_account` takes). Failing open here is not a
/// hole: the ticket only reaches the picker, and `create_session` re-derives
/// the caller's live authority from the database on the next step.
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for an unknown/expired token, and
/// the same error for an account that is no longer on the live roster
/// (trashed or deactivated) — identical to `resolve_session`, so a dead
/// account cannot tell the two apart.
pub fn refresh_picker_ticket(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<RefreshPickerTicketResult, BridgeError> {
    // Verify the existing session token — this proves the caller is already
    // authenticated (STAFF-01 / ADR #4).
    let session = ctx.resolve_session(session_token)?;

    // resolve_session's account check is skipped on the first resolve of a
    // token (it only starts the window) and is a 30s-cached backstop after
    // that, so confirm liveness against the row itself.
    if let Ok(db) = ctx.db.try_lock() {
        let live = db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM users \
                 WHERE id = ?1 AND deleted_at IS NULL AND is_active = 1)",
                rusqlite::params![session.user_id],
                |row| row.get::<_, bool>(0),
            )
            .unwrap_or(true); // fail open on a read error: see the doc above
        if !live {
            tracing::warn!(
                user_id = %session.user_id,
                "picker ticket refresh denied — account is no longer on the live roster"
            );
            return Err(BridgeError::InvalidSession);
        }
    }

    let Some(now_ts) = now_unix_secs() else {
        return Err(BridgeError::Internal(
            "cannot read the system clock; refusing to mint a picker ticket".into(),
        ));
    };

    let picker_ticket = picker::sign_picker_ticket(
        &ctx.picker_ticket_secret,
        &session.user_id,
        now_ts + picker::PICKER_TICKET_TTL_SECS,
    );

    tracing::debug!(
        user_id = %session.user_id,
        "picker ticket refreshed via session token"
    );

    Ok(RefreshPickerTicketResult { picker_ticket })
}

// ── Remaining session / pre-auth command bodies (B4b) ───────────────
pub mod session;
pub use session::{
    CheckUsernameArgs, CheckUsernameResult, HasUsersResult, IMPERSONATION_SESSION_TTL_SECONDS,
    OrganizationSummary, SessionKeepaliveResult, check_username, destroy_session, has_users,
    impersonate_user_scoped, invalidate_all_sessions, list_organizations, session_keepalive,
    switch_organization,
};

#[cfg(test)]
#[path = "auth_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "security_scoped_integration_tests.rs"]
mod security_integration_tests;
