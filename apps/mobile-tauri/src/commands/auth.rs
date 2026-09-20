/*
last audited 25-07-26 by RSA-Agent (mobile-tauri slice A: auth verified)
crate: kasirmu-mobile | status: SAFE | lint: CLEAN
findings: auth surface mirrors desktop-tauri: STAFF-06 uniform pre-auth, STAFF-07 layered persistent rate limiting via record_login_attempt_scoped, picker-ticket identity binding; NO verify_pin command here (DC-3 does not exist on tablet). Coverage note: risk-ranked sampling
next: none | perf: N/A
*/
//! Staff authentication commands — login, logout, session verification.
//!
//! These commands are the IPC surface for `ui/src/features/auth/`. PIN
//! hashing and verification is delegated to `kasirmu_core::auth`.

use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{State, command};

use kasirmu_core::auth::LoginSession;
use kasirmu_core::db::Store;
use kasirmu_core::db::assignments::ScopeType;
use kasirmu_core::db::audit_security::{
    SECURITY_REASON_BAD_PIN, SECURITY_REASON_INACTIVE, SECURITY_REASON_RATE_LIMITED,
    SECURITY_REASON_UNKNOWN_USER, SecurityEvent,
};
use kasirmu_core::permissions;
use kasirmu_core::session::SessionContext;
use kasirmu_core::subscription::TenantSubscription;
use kasirmu_security::mask::mask_token;

use crate::commands::authz::require_permission_for_session;
use crate::commands::picker_ticket;
use crate::error::AppError;
use crate::state::AppState;

// Phase 3.3 T5: the auth wire DTOs moved to the shared `kasirmu_bridge::auth`
// module and are re-exported here, same as the desktop shell. The wire
// contract is one definition across shells — including `CreateSessionArgs`,
// whose `picker_ticket` the tablet copy had silently dropped (UI always sent
// it; the H-3 gate now runs here, restored field-for-field from the bridge).
// Command bodies stay tablet-native.
pub use kasirmu_bridge::auth::{
    CheckUsernameArgs, CheckUsernameResult, CreateSessionArgs, CreateSessionResult,
    OrganizationSummary, SessionContextDto, SessionKeepaliveResult, StaffLoginArgs,
    StaffLoginResult,
};

/// The tablet's single security-event sink — the auth paths and the
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
/// `debug_upgrade: false` is the tablet's side of a per-client policy that
/// `Store::record_security_event` documents at
/// `crates/kasirmu-core/src/db/audit_security.rs:369-373`: the flag is the caller's and is
/// passed through unchanged, the desktop's dev Free→Premium promotion applies only under
/// `cfg!(debug_assertions)`, and "tablet passes `false` so it never mirrors the desktop
/// divergence". This comment used to cite commit `dfbc41b2` for that invariant; the hash
/// does not exist in this repository (`git cat-file -t dfbc41b2` → "Not a valid object
/// name"), so the live citation is the one above, plus `06dcc61f4`, whose message records
/// the same divergence as preserved on purpose.
///
/// What the flag does NOT decide on its own: the skip needs a CONFIRMED Free row
/// (`ent.loaded && tier.audit_retention_days().is_none()`, audit_security.rs:389), and a
/// missing, tampered or unverifiable subscription row fails OPEN and records anyway
/// (audit_security.rs:357-367). So "a dev tablet records nothing, exactly like a
/// production one" — the sentence this comment used to end with — was true only of a
/// verified Free tenant, and is false for the release case it implied.
///
/// `pub(crate)` so the staff commands share this one definition: the per-client
/// tier-promotion policy is then stated exactly once and cannot drift between the auth and
/// staff-management paths. That the two SHELLS differ is the documented design, not drift;
/// `the_debug_upgrade_policy_is_per_client_by_design` in `auth_tests.rs` is what stops a
/// future consolidation from collapsing it quietly.
pub(crate) fn record_security_event(store: &Store, event: &SecurityEvent) {
    match store.record_security_event(event, false) {
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
#[command]
pub async fn staff_check_username(
    args: CheckUsernameArgs,
    state: State<'_, AppState>,
) -> Result<CheckUsernameResult, AppError> {
    let username = args.username.trim().to_lowercase();
    if username.is_empty() {
        return Err(AppError::Invalid("username must not be empty".into()));
    }

    // S3: Random delay (50–200ms) to mask timing side-channels.
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_nanos();
    let delay_ms: u64 = 50 + (nanos % 151) as u64;

    // Scope the DB lock so Store<'_> (not Send) is dropped before await.
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
    }

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
#[command]
pub async fn staff_login(
    args: StaffLoginArgs,
    state: State<'_, AppState>,
) -> Result<StaffLoginResult, AppError> {
    let username = args.username.trim().to_lowercase();
    if username.is_empty() {
        return Err(AppError::Invalid("username must not be empty".into()));
    }

    // S1: Enforce minimum 4-digit PIN at the server boundary.
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
    let valid = kasirmu_core::auth::verify_pin(&args.pin, &user.pin_hash)
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
    // user (audit-open-findings residual, parity with the desktop client). It is
    // only valid for the pre-session workspace picker; `create_session`
    // hands out the opaque session token afterwards.
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

/// Create a new session and return an opaque session token.
///
/// ADR #4 / ADR #7: Called after login + workspace selection.
/// Session TTL (default 24h) is configurable via `session.ttl_seconds`.
#[command]
pub async fn create_session(
    args: CreateSessionArgs,
    state: State<'_, AppState>,
) -> Result<CreateSessionResult, AppError> {
    // Validate required fields BEFORE any side effects.
    if args.store_id.is_empty() || args.instance_id.is_empty() || args.user_id.is_empty() {
        return Err(AppError::Invalid(
            "store_id, instance_id, and user_id must not be empty".into(),
        ));
    }

    // H-3: Verify the picker ticket to authenticate the caller's identity —
    // the same gate the desktop/bridge twin has always run. The ticket was
    // minted by staff_login/bootstrap_owner and bound to the authenticated
    // user; we derive user_id from the ticket instead of trusting the
    // caller-supplied value. The tablet DTO silently dropped this field
    // until Phase 3.3 T5, so this shell minted sessions with no ticket
    // verification — restored field-for-field against the bridge gate.
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

    // SaaS-3 L194: optional Organization (legal entity) scoping.
    // org_id is a routing hint only — fail-closed validation derives the
    // session real authority from the user assignment. The org must be in the
    // device-local enumerated set and the user assignment must cover it.
    let org_label: Option<String> = match args.org_id.as_ref().filter(|o| !o.is_empty()) {
        Some(org_id) => {
            let db = state.db.lock().await;
            let store = kasirmu_core::db::Store::new(&db);
            let entity = store
                .get_legal_entity("default", org_id)?
                .ok_or_else(|| AppError::Invalid("Unknown organization".into()))?;
            let covered =
                store.assignment_covers_resource(&args.user_id, ScopeType::LegalEntity, org_id)?;
            if !covered.unwrap_or(false) {
                tracing::warn!(
                    user_id = %args.user_id,
                    org_id = %org_id,
                    "session creation denied — assignment does not cover organization"
                );
                return Err(AppError::Invalid(
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
        let db = state.db.lock().await;
        let store = kasirmu_core::db::Store::new(&db);
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

    // Snapshot the current time once for both expiry and creation timestamp.
    let now_ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    // Compute session expiry from the cached TTL setting.
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

        if session_store.contains_key(&token) {
            tracing::warn!(token = %mask_token(&token), "session token collision detected — overwriting");
        }

        // Deterministic LRU eviction: find the oldest session by created_at.
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
    kasirmu_core::location_resolver::invalidate_location_cache();

    tracing::info!(
        user_id = %args.user_id,
        store_id = %args.store_id,
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
            org_label,
        },
    })
}

/// Enumerate the Organizations (legal entities) this device knows about.
///
/// SaaS-3 L194 (pre-login org selector source). Device-local enumeration:
/// returns the legal_entities belonging to the device tenant (default) and
/// nothing else. Callable before authentication because it reveals only org
/// ids/names (device configuration, not account secrets); it is the enumerated
/// allow-list that create_session and switch_organization constrain org
/// selection to — no cross-tenant identity broker exists.
#[command]
pub async fn list_organizations(
    state: State<'_, AppState>,
) -> Result<Vec<OrganizationSummary>, AppError> {
    let db = state.db.lock().await;
    let store = kasirmu_core::db::Store::new(&db);
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

/// Switch the active Organization (legal entity) for an authenticated session.
///
/// SaaS-3 L194. Fail-closed, mirrors the impersonation guard, but the leak class
/// it closes is different: it must never leave BOTH the old and new tokens live.
/// So it INVALIDATES the current token FIRST (old token dead before any new
/// session exists), then mints a fresh session whose scope re-derives from the
/// user assignment alone — no credential carryover, no grant merge.
///
/// Steps:
/// 1. Resolve + authenticate the current session (caller identity).
/// 2. The chosen org must be in the device-local enumerated set.
/// 3. The user assignment must cover the org (assignment_covers_resource with
///    ScopeType::LegalEntity) — fail-closed, mirroring the impersonation guard.
/// 4. FULL re-authentication: the PIN is verified against the users stored
///    pin_hash — no credential carryover from the old session.
/// 5. check_tenant_integrity re-runs on the single already-open tenant DB as
///    defense-in-depth, exactly as at startup.
/// 6. Invalidate the old token, THEN mint the new session.
#[command]
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
        let store = kasirmu_core::db::Store::new(&db);
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
        let store = kasirmu_core::db::Store::new(&db);
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
        let store = kasirmu_core::db::Store::new(&db);
        let user = store
            .get_user(&user_id)?
            .ok_or_else(|| AppError::Invalid("user not found".into()))?;
        let valid = kasirmu_core::auth::verify_pin(&pin, &user.pin_hash)
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
        kasirmu_core::db::Store::new(&db)
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
        let store = kasirmu_core::db::Store::new(&db);
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
#[command]
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

/// Destroy an active session, invalidating the token.
///
/// Records a `logout` security event when the token actually resolved — a
/// store switch destroys the old session too, and that is a genuine session
/// end worth recording. An unknown or already-evicted token records nothing,
/// so a replayed logout cannot manufacture phantom events.
#[command]
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
#[command]
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

/// Re-mint the picker ticket for the caller's own live session (ADR #4 / STAFF-01).
///
/// The ticket is signed at login with a five-minute TTL, so a user who lingers on
/// the workspace picker longer than that cannot re-enter a store: `create_session`
/// rejects the expired ticket. This command is the way back. It checks no role, and
/// does not need to -- holding a valid, unexpired session token already proves the
/// caller authenticated, and the ticket minted is bound to `session.user_id`, not to
/// anything the caller sent.
///
/// A pure shim over `kasirmu_bridge::auth::refresh_picker_ticket`, which is verbatim the
/// body the desktop registers (`apps/desktop-tauri/src/commands/auth.rs:294`). Before
/// this existed the name was in `scripts/ipc-parity-allowlist.json` **twice** in the
/// tablet's own array (:154 and :233) with no implementation behind either copy, so
/// `ui/src/api/staff.ts:569` had a wrapper this shell could never answer, and the
/// duplicate entry made the exemption look like coverage. Both entries are gone with
/// this command. What the renderer does with the rejection on a tablet that had no
/// such command is a separate question, recorded as T5-5 in
/// `.agents/reviews/done-todo-refactor-oz-pos-app-agents-3.md`.
#[command]
pub async fn refresh_picker_ticket(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<kasirmu_bridge::auth::RefreshPickerTicketResult, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::auth::refresh_picker_ticket(&ctx, &session_token).map_err(Into::into)
}
#[cfg(test)]
#[path = "auth_tests.rs"]
mod tests;
