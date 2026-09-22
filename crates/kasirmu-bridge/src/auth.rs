//! Auth command bodies (Wave B / B4a) — the tauri-free half of
//! `apps/desktop-tauri/src/commands/auth.rs`.
//!
//! Key items: [`record_security_event`] (the desktop's single security-event
//! sink, shared with `commands/staff.rs`), [`insert_session`] (the session
//! mint primitive — lazy prune, deterministic LRU eviction, location-cache
//! invalidation) and the headless [`staff_login`], [`create_session`],
//! [`verify_pin`] and [`refresh_picker_ticket`] operations.
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
/// [`insert_session`] is the TTL-aware form every ordinary login path uses;
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
    let now_ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
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
/// entitlement (ADR #5), then the mint via [`insert_session`].
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
    let now_ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
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
    let sub = {
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
    if sub.tier != kasirmu_core::subscription::SubscriptionTier::Free {
        if let Some(ref expires_at_str) = sub.expires_at {
            if let Ok(expiry_dt) = chrono::DateTime::parse_from_rfc3339(expires_at_str) {
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
                    let _ = crate::license::check_license_status(ctx).await;
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
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for an unknown/expired token.
pub fn refresh_picker_ticket(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<RefreshPickerTicketResult, BridgeError> {
    // Verify the existing session token — this proves the caller is already
    // authenticated (STAFF-01 / ADR #4).
    let session = ctx.resolve_session(session_token)?;

    let now_ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

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

/// Unix seconds, exactly as the command bodies compute it.
fn now_ts() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
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
    // Computed before the DB lock so the delay is not blocked by the mutex.
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_nanos();
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

    let now_ts = now_ts();
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

    let now_ts = now_ts();
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
    let now_ts = now_ts();
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

#[cfg(test)]
#[path = "auth_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "security_scoped_integration_tests.rs"]
mod security_integration_tests;
