/*
last audited 31-08-26 by RSA-Agent (user-role campaign, Section D)
crate: oz-tablet | status: SAFE | lint: CLEAN
findings: mirror of the desktop staff gate matrix (verified line-level: STAFF_READ reads, STAFF_CREATE + tier limit create, STAFF_UPDATE update, shared enforce_role_assignment_policy STAFF-02/10, permission-denied tombstones for legacy unscoped commands, ungated bootstrap_owner first-run bootstrap); tablet parity holds — no gate divergence found
next: none | perf: fine
*/
//! Staff management commands — list, create, update staff members and roles.
//!
//! These commands are the IPC surface for the Staff Management UI.

use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{State, command};

use oz_core::auth::hash_pin;
use oz_core::availability::UsageCounts;
use oz_core::db::Store;
use oz_core::db::audit_security::{
    SECURITY_ACTION_USER_CREATE, SECURITY_ACTION_USER_UPDATE, SECURITY_REASON_ACCOUNT_CREATED,
    SECURITY_REASON_PIN_ROTATED, SECURITY_REASON_PROFILE_CHANGED, SecurityEvent,
};
use oz_core::entitlements::Entitlements;
use oz_core::permissions;
use oz_core::subscription::TenantSubscription;

use oz_core::Role;

use foundation::{validate_min_length, validate_not_empty};

use crate::commands::auth::record_security_event;
use crate::commands::authz::{require_permission_for_session, require_permission_for_user};
use crate::commands::picker_ticket;
use crate::error::AppError;
use crate::state::AppState;

// Phase 3.3 T5: the staff wire DTOs and their helpers moved to the shared
// `oz_bridge::staff` module and are re-exported here, same as the desktop
// shell — one wire definition, ending the fork. `to_staff_dto`,
// `assignment_dto`, `parse_scope_mode`, `assignment_spec` and
// `enforce_role_assignment_policy` re-export as-is (their error type is the
// bridge's `BridgeError`, which the tablet converts via the `From<BridgeError>`
// seam); the shell keeps two thin `AppError` adapters that the sibling test
// modules call directly. Command bodies stay tablet-native.
pub use oz_bridge::staff::{
    AssignmentArgs, AssignmentDto, BootstrapOwnerArgs, BootstrapOwnerResult, CreateRoleArgs,
    CreateStaffArgs, CreateStaffScopedArgs, PermissionKeyDto, ProfileArgs, ProfileViewDto, RoleDto,
    RoleHolderDto, RoleHoldersDto, StaffMemberDto, UpdateRoleArgs, UpdateStaffArgs,
    UpdateStaffScopedArgs, assignment_dto, assignment_spec, enforce_role_assignment_policy,
    parse_scope_mode, to_staff_dto,
};

/// Serialize a grant set into the JSON array roles.permissions stores.
///
/// Stays in the shell and is passed into the bridge as a `&str`: encoding
/// needs `serde_json`, which is not an `oz-bridge` dependency (mirrors the
/// desktop staff.rs adapter exactly).
fn grants_json(keys: &[String]) -> Result<String, AppError> {
    serde_json::to_string(keys).map_err(|e| AppError::Internal(format!("encoding grants: {e}")))
}

/// Build the authoring DTO from a domain role, adding the two facts the
/// surface needs in order to decide what it may offer.
///
/// Thin adapter over `oz_bridge::staff::role_dto`: same name, parameters
/// and `Result<_, AppError>` so the sibling test modules keep building DTOs
/// from a shell-held `Store` (mirrors the desktop staff.rs adapter).
fn role_dto(store: &Store<'_>, role: Role) -> Result<RoleDto, AppError> {
    oz_bridge::staff::role_dto(store, role).map_err(AppError::from)
}

// ── List staff ─────────────────────────────────────────────────────

#[command]
/// List staff.
///
/// **Deprecated for multi-store (ADR #7):** Use [`list_staff_scoped`] so the
/// caller identity is resolved from the session token instead of a
/// client-supplied `caller_user_id`.
pub async fn list_staff(_state: State<'_, AppState>) -> Result<Vec<StaffMemberDto>, AppError> {
    Err(AppError::PermissionDenied(
        "legacy unscoped staff commands are disabled; use list_staff_scoped".into(),
    ))
}

// ── List roles ─────────────────────────────────────────────────────

#[command]
/// List roles.
///
/// **Deprecated for multi-store (ADR #7):** Use [`list_roles_scoped`].
pub async fn list_roles(_state: State<'_, AppState>) -> Result<Vec<RoleDto>, AppError> {
    Err(AppError::PermissionDenied(
        "legacy unscoped staff commands are disabled; use list_roles_scoped".into(),
    ))
}

// ── Create staff member ────────────────────────────────────────────

#[command]
/// Create staff.
///
/// **Deprecated for multi-store (ADR #7):** Use [`create_staff_scoped`]. The
/// legacy `caller_user_id` argument is forgeable — never call this from a
/// session-bound UI path.
pub async fn create_staff(
    _args: CreateStaffArgs,
    _state: State<'_, AppState>,
) -> Result<StaffMemberDto, AppError> {
    Err(AppError::PermissionDenied(
        "legacy unscoped staff commands are disabled; use create_staff_scoped".into(),
    ))
}

// ── Update staff member ────────────────────────────────────────────

#[command]
/// Update staff.
///
/// **Deprecated for multi-store (ADR #7):** Use [`update_staff_scoped`]. The
/// legacy `caller_user_id` argument is forgeable — never call this from a
/// session-bound UI path.
pub async fn update_staff(
    _args: UpdateStaffArgs,
    _state: State<'_, AppState>,
) -> Result<StaffMemberDto, AppError> {
    Err(AppError::PermissionDenied(
        "legacy unscoped staff commands are disabled; use update_staff_scoped".into(),
    ))
}

// ── Session-scoped staff commands (ADR #7 · audit-open-findings STAFF-01) ────────
//
// Replacement for the legacy staff commands. Caller identity is resolved
// from the opaque `session_token`; the commands NEVER accept a
// caller-supplied `caller_user_id`. Users/roles are GLOBAL identity
// records (ADR #4 / ADR #7) — the permission check and CRUD run against
// the global identity DB.

/// List staff members. Caller identity is resolved from the session token.
#[command]
pub async fn list_staff_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<StaffMemberDto>, AppError> {
    let session = state.resolve_session(&session_token)?;
    let db = state.db.lock().await;
    let store = Store::new(&db);
    require_permission_for_user(&store, &session.user_id, permissions::STAFF_READ)?;
    let users = store.list_users()?;
    let roles = store.list_roles()?;
    let dtos = users
        .iter()
        .map(|u| {
            let profile = store.get_user_profile(&u.id).ok().flatten();
            let assignment = store.assignment_for_user(&u.id).ok().flatten();
            to_staff_dto(u, &roles, profile.as_ref(), assignment.as_ref())
        })
        .collect();
    drop(db);
    Ok(dtos)
}

/// Load a staff member's full profile as the session user sees it (ADR #35
/// D6). Sensitive fields are withheld or masked unless the caller holds
/// `staff:read_identity` / `staff:read_payroll`, and every sensitive read is
/// audited.
#[command]
pub async fn get_staff_profile_scoped(
    session_token: String,
    user_id: String,
    state: State<'_, AppState>,
) -> Result<ProfileViewDto, AppError> {
    let session = state.resolve_session(&session_token)?;
    let db = state.db.lock().await;
    let store = Store::new(&db);
    require_permission_for_user(&store, &session.user_id, permissions::STAFF_READ)?;
    let view = store
        .get_user_profile_viewed_by(&session.user_id, &user_id)?
        .ok_or_else(|| AppError::Invalid(format!("no such user: {user_id}")))?;
    drop(db);
    let mut dto: ProfileViewDto = view.into();
    dto.user_id = user_id;
    Ok(dto)
}

/// List roles. Caller identity is resolved from the session token.
#[command]
pub async fn list_roles_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<RoleDto>, AppError> {
    let session = state.resolve_session(&session_token)?;
    let db = state.db.lock().await;
    let store = Store::new(&db);
    require_permission_for_user(&store, &session.user_id, permissions::STAFF_READ)?;
    let roles = store.list_roles()?;
    let dtos = roles
        .into_iter()
        .map(|r| role_dto(&store, r))
        .collect::<Result<Vec<_>, _>>()?;
    drop(db);
    Ok(dtos)
}

// ── Role authoring (ADR #47 ruling 4) ──────────────────────────────

/// List the registered permission keys.
///
/// Without this the authoring UI would have to hardcode the vocabulary, which
/// is what ADR #35 forbids: the registry is the single source of truth, and a
/// picker fed from a copy of it drifts from the keys the gate actually
/// honors. Gated on 'staff:read' rather than 'staff:manage_roles' — knowing
/// which keys exist is not the power to grant them.
#[command]
pub async fn list_permission_keys_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<PermissionKeyDto>, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::STAFF_READ).await?;
    Ok(oz_core::permission_registry::REGISTRY
        .iter()
        .map(|entry| PermissionKeyDto {
            key: entry.key.to_string(),
            family: entry.family.to_string(),
            sensitive: entry.sensitive,
            description: entry.description.to_string(),
        })
        .collect())
}

/// Create a custom role: a named key-set row in the same vocabulary
/// enforcement already speaks (ADR #47 ruling 4).
///
/// The id is generated here and never accepted from the wire. A row whose id
/// the preset seeder owns is rewritten by the next seed_default_roles_scoped,
/// so letting a caller choose ids would put them one typo away from authoring
/// something they cannot keep; a generated 'role-<uuidv7>' is outside
/// ROLE_PRESETS by construction.
#[command]
pub async fn create_role_scoped(
    session_token: String,
    args: CreateRoleArgs,
    state: State<'_, AppState>,
) -> Result<RoleDto, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::STAFF_MANAGE_ROLES).await?;
    validate_not_empty("name", &args.name).map_err(|e| AppError::Invalid(e.to_string()))?;
    let db = state.db.lock().await;
    let store = Store::new(&db);
    let role = store.create_role(
        &format!("role-{}", uuid::Uuid::now_v7()),
        &args.name,
        &args.description,
        &grants_json(&args.permissions)?,
    )?;
    role_dto(&store, role)
}

/// Re-name, re-describe, or re-grant an authored role.
///
/// Editing re-points every holder, so the grant set is validated against the
/// registry core-side and preset ids are refused there too — the rule lives in
/// one place, so this command cannot become the way around it.
#[command]
pub async fn update_role_scoped(
    session_token: String,
    args: UpdateRoleArgs,
    state: State<'_, AppState>,
) -> Result<RoleDto, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::STAFF_MANAGE_ROLES).await?;
    let db = state.db.lock().await;
    let store = Store::new(&db);
    let role = store.update_role(
        &args.id,
        &args.name,
        &args.description,
        &grants_json(&args.permissions)?,
    )?;
    role_dto(&store, role)
}

/// Delete an authored role.
///
/// Refused for preset ids and for any role still referenced. The second guard
/// matters more here than a usual FK: authorize_with fails closed on an
/// unresolvable role, so dropping one out from under a holder would be a
/// silent loss of access rather than an error.
#[command]
pub async fn delete_role_scoped(
    id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::STAFF_MANAGE_ROLES).await?;
    let db = state.db.lock().await;
    Store::new(&db).delete_role(&id)?;
    Ok(())
}

/// List the accounts that hold one role, org-wide.
///
/// No store filter, deliberately: `users`, `assignments` and `roles` are
/// tenant-global identity records (ADR #4 / #7) and a store-scoped database
/// holds none of them, so "who holds this role" has exactly one honest
/// answer for the whole organization. Gated on `staff:read`, the same gate
/// [`list_staff_scoped`] uses, because that command already discloses these
/// accounts and their role — asking for `staff:manage_roles` here would
/// imply this reveals something the staff list does not.
///
/// The predicate lives in core (`Store::role_holders`) and resolves a role
/// the way authorization does — assignment first, `users.role_id` as the
/// fallback. A holder list that disagreed with what a user can actually do
/// would be worse than no list, because this is the surface an admin reads
/// before revoking something.
#[tauri::command]
pub async fn list_role_holders_scoped(
    id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<RoleHoldersDto, AppError> {
    let session = state.resolve_session(&session_token)?;
    let db = state.db.lock().await;
    let store = Store::new(&db);
    require_permission_for_user(&store, &session.user_id, permissions::STAFF_READ)?;
    let (holders, total) = store.role_holders(&id, oz_core::db::roles::ROLE_HOLDERS_MAX)?;
    Ok(RoleHoldersDto {
        holders: holders.into_iter().map(RoleHolderDto::from).collect(),
        total,
        cap: oz_core::db::roles::ROLE_HOLDERS_MAX,
    })
}

/// Create a staff member. Caller identity is resolved from the session token.
///
/// STAFF-02: enforces the role-assignment hierarchy (only Owner-level
/// callers may create an Owner account).
#[command]
pub async fn create_staff_scoped(
    session_token: String,
    args: CreateStaffScopedArgs,
    state: State<'_, AppState>,
) -> Result<StaffMemberDto, AppError> {
    let session = state.resolve_session(&session_token)?;
    let username = args.username.trim().to_lowercase();
    let display_name = args.display_name.trim();

    validate_not_empty("username", &username).map_err(|e| AppError::Invalid(e.to_string()))?;
    validate_not_empty("display_name", display_name)
        .map_err(|e| AppError::Invalid(e.to_string()))?;
    validate_min_length("pin", &args.pin, 4).map_err(|e| AppError::Invalid(e.to_string()))?;
    validate_not_empty("role_id", &args.role_id).map_err(|e| AppError::Invalid(e.to_string()))?;

    let pin_hash =
        hash_pin(&args.pin).map_err(|e| AppError::Internal(format!("hashing PIN: {e}")))?;

    let db = state.db.lock().await;
    let store = Store::new(&db);
    require_permission_for_user(&store, &session.user_id, permissions::STAFF_CREATE)?;
    enforce_role_assignment_policy(&store, &session.user_id, None, &args.role_id, true)?;
    // C1.1: enforce the subscription tier's staff-user limit (Free 1 / Plus 5 /
    // Pro 20) before creating — the count runs against the global identity DB
    // that also holds the tenant_subscription row.
    let sub = TenantSubscription::load(&db, "default")?
        .ok_or_else(|| AppError::Internal("default tenant subscription not found".into()))?;
    sub.verify_signature()?;
    store
        .enforce_staff_quota(&Entitlements::from_subscription(&sub, UsageCounts::default()).tier)?;
    let profile = args.profile.into_profile();
    let assignment = args.assignment.as_ref().map(assignment_spec).transpose()?;
    let user = store.create_user_with_profile(
        &username,
        &pin_hash,
        display_name,
        &args.role_id,
        &profile,
        assignment.as_ref(),
    )?;
    let roles = store.list_roles()?;
    let assignment = store.assignment_for_user(&user.id)?;
    // Creating a staff account is a security event: it is how an attacker
    // with a stolen admin session installs persistence. Actor goes in
    // `user_id`, the new account in `target_id` — the same split
    // `staff.identity.read` already uses. `create_user_with_profile` commits
    // its own transaction, so this row is written just after the account
    // exists rather than inside it; a failure here loses the event but can
    // never strand the account.
    record_security_event(
        &store,
        &SecurityEvent::staff_change(
            &session.user_id,
            &user.id,
            &user.username,
            SECURITY_ACTION_USER_CREATE,
            SECURITY_REASON_ACCOUNT_CREATED,
        ),
    );
    drop(db);

    Ok(to_staff_dto(
        &user,
        &roles,
        Some(&profile),
        assignment.as_ref(),
    ))
}

/// Update a staff member. Caller identity is resolved from the session token.
///
/// STAFF-02: enforces the role-assignment hierarchy.
/// STAFF-03: optionally rotates the PIN when `args.pin` is a non-empty value.
/// STAFF-05: the profile update, PIN rotation, and (optional) assignment
/// scope run as one command inside a single global-DB transaction — any
/// failure rolls the whole update back atomically. The legacy store-scoped
/// `workspace_keys` write path (which needed cross-DB compensation) is
/// retired; assignments ride the same transaction as the profile.
#[command]
pub async fn update_staff_scoped(
    session_token: String,
    args: UpdateStaffScopedArgs,
    state: State<'_, AppState>,
) -> Result<StaffMemberDto, AppError> {
    let session = state.resolve_session(&session_token)?;
    let db = state.db.lock().await;

    // Permission + role-hierarchy checks run against the global identity DB.
    // The `Store` borrows the (non-Sync) `Connection`, so it must be scoped in
    // a block and dropped BEFORE any further `.await` — otherwise the command
    // future is not `Send` and Tauri rejects it at compile time.
    {
        let store = Store::new(&db);
        require_permission_for_user(&store, &session.user_id, permissions::STAFF_UPDATE)?;
        enforce_role_assignment_policy(
            &store,
            &session.user_id,
            Some(&args.id),
            &args.role_id,
            args.is_active,
        )?;
    }

    // Snapshot the profile BEFORE the update. Used below ONLY to default the
    // returned DTO's profile when the caller didn't send one — there is no
    // restore/compensation path and none is needed: the legacy store-scoped
    // `workspace_keys` write this snapshot once compensated was retired
    // (50337ba1b), and the assignment scope now joins the same transaction
    // as the user update below, so any later failure rolls both back.
    let previous_profile = {
        let store = Store::new(&db);
        let user = store.get_user(&args.id)?;
        let profile = store.get_user_profile(&args.id)?;
        user.map(|u| {
            (
                u.username,
                u.display_name,
                u.role_id,
                u.is_active,
                u.pin_hash,
                profile,
            )
        })
    };

    // STAFF-03: profile + PIN rotate atomically inside one transaction so a
    // failed PIN hash never leaves the profile half-updated (STAFF-05). The
    // transaction also borrows the non-Sync Connection, so it stays scoped in
    // its own block too.
    let (user, roles, pin_rotated) = {
        let tx = db.unchecked_transaction()?;
        let store = Store::new(&tx);
        // ADR #35 D6 incomplete-profile semantics: assigning a role that
        // grants sensitive permissions requires a complete profile.
        store.require_role_assignable(&args.id, &args.role_id)?;
        store.update_user_in_tx(
            &args.id,
            &args.username,
            &args.display_name,
            &args.role_id,
            args.is_active,
        )?;
        // ADR #35 D6: the profile columns (validated, encrypted at rest by
        // oz-core) follow the same atomic update.
        if let Some(profile) = &args.profile {
            store.write_user_profile(&args.id, &profile.clone().into_profile())?;
        }

        // ADR #35 D5 (spec 0048): the assignment scope rides the same
        // transaction — in-tx writer, no nested BEGIN. `update_user` above
        // already synced the assignment role; this replaces only the scope.
        if let Some(spec) = &args.assignment {
            let spec = assignment_spec(spec)?;
            store.write_assignment_scope(&args.id, &args.role_id, &spec)?;
        }

        // Hash server-side; never accept plaintext beyond the command boundary.
        let pin_rotated = if let Some(pin) = args.pin.as_deref().filter(|p| !p.is_empty()) {
            validate_min_length("pin", pin, 4).map_err(|e| AppError::Invalid(e.to_string()))?;
            let pin_hash =
                hash_pin(pin).map_err(|e| AppError::Internal(format!("hashing PIN: {e}")))?;
            store.update_user_pin(&args.id, &pin_hash)?;
            // A successful rotation also clears any accumulated failed-login
            // lockout for this account (atomic with the rotation).
            store.clear_login_attempts(&args.username.trim().to_lowercase())?;
            true
        } else {
            false
        };

        let user = store
            .get_user(&args.id)?
            .ok_or_else(|| AppError::Internal(format!("updated user {} vanished", args.id)))?;
        let roles = store.list_roles()?;
        // Recorded INSIDE the transaction, so the audit row commits with the
        // change it describes: a rolled-back edit leaves no phantom event, and
        // a committed one can never be missing its trail.
        record_security_event(
            &store,
            &SecurityEvent::staff_change(
                &session.user_id,
                &args.id,
                &user.username,
                SECURITY_ACTION_USER_UPDATE,
                SECURITY_REASON_PROFILE_CHANGED,
            ),
        );
        // A PIN rotation is a SECOND, distinct fact — it dropped every other
        // session for the account (STAFF-03). It reuses the catalogued
        // `user.update` action with its own classifier rather than inventing
        // `user.pin_change`, which has no Fluent label and would strand one.
        if pin_rotated {
            record_security_event(
                &store,
                &SecurityEvent::staff_change(
                    &session.user_id,
                    &args.id,
                    &user.username,
                    SECURITY_ACTION_USER_UPDATE,
                    SECURITY_REASON_PIN_ROTATED,
                ),
            );
        }
        tx.commit()?;
        (user, roles, pin_rotated)
    };
    drop(db);

    if pin_rotated {
        // STAFF-03: a rotated PIN invalidates every OTHER session issued
        // under the old PIN. The caller's own session is preserved — they
        // authenticated moments ago and the UI reloads with the same token.
        state.invalidate_user_sessions_except(&args.id, &session_token);
    }

    let profile = match &args.profile {
        Some(p) => Some(p.clone().into_profile()),
        None => previous_profile.and_then(|(_, _, _, _, _, p)| p),
    };
    let assignment = {
        let db = state.db.lock().await;
        let store = Store::new(&db);
        store.assignment_for_user(&args.id)?
    };
    Ok(to_staff_dto(
        &user,
        &roles,
        profile.as_ref(),
        assignment.as_ref(),
    ))
}

// ── Bootstrap first owner (no authentication required) ────────────────
//
// Parity with the desktop client (audit-open-findings residual): the tablet needs the
// same first-owner path so a fresh installation can be provisioned from the
// tablet itself. Like `staff_login`, the command mints a short-lived picker
// ticket so the pre-session workspace picker stays bound to the real user.

/// Create the first owner user in a fresh installation.
///
/// This is the only command that does NOT require an existing session,
/// because there are no users yet. It seeds the default roles first,
/// then creates a user with the `role-owner` role.
///
/// # Errors
///
/// Returns `Invalid` if any users already exist, preventing accidental
/// re-bootstrapping after staff accounts have been created.
/// Returns `Invalid` if validation fails (empty username, short PIN, etc.).
#[command]
pub async fn bootstrap_owner(
    args: BootstrapOwnerArgs,
    state: State<'_, AppState>,
) -> Result<BootstrapOwnerResult, AppError> {
    let db = state.db.lock().await;
    let mut result = run_bootstrap_owner(&db, &args)?;
    drop(db);

    // Mint the short-lived picker ticket bound to the new owner. It is
    // only valid for the pre-session workspace picker; `create_session`
    // hands out the opaque session token afterwards.
    let now_ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    result.picker_ticket = picker_ticket::sign_picker_ticket(
        &state.picker_ticket_secret,
        &result.session.user_id,
        now_ts + picker_ticket::PICKER_TICKET_TTL_SECS,
    );
    Ok(result)
}

/// Business logic for `bootstrap_owner` (extracted for testing).
fn run_bootstrap_owner(
    conn: &rusqlite::Connection,
    args: &BootstrapOwnerArgs,
) -> Result<BootstrapOwnerResult, AppError> {
    let username = args.username.trim().to_lowercase();
    let display_name = args.display_name.trim();

    validate_not_empty("username", &username).map_err(|e| AppError::Invalid(e.to_string()))?;
    validate_not_empty("display_name", display_name)
        .map_err(|e| AppError::Invalid(e.to_string()))?;
    validate_min_length("pin", &args.pin, 4).map_err(|e| AppError::Invalid(e.to_string()))?;

    let pin_hash =
        hash_pin(&args.pin).map_err(|e| AppError::Internal(format!("hashing PIN: {e}")))?;

    let store = Store::new(conn);

    // Guard: refuse to bootstrap if users already exist.
    let existing = store.list_users()?;
    if !existing.is_empty() {
        return Err(AppError::Invalid(
            "cannot bootstrap: staff accounts already exist".into(),
        ));
    }

    // Seed roles first so role-owner exists.
    store.seed_default_roles()?;

    let user = store.create_user(
        &username,
        &pin_hash,
        display_name,
        oz_core::builtin_roles::OWNER,
    )?;
    let role = store
        .get_role(oz_core::builtin_roles::OWNER)?
        .ok_or_else(|| AppError::Internal("owner role not found after seeding".into()))?;

    tracing::info!(username = %username, "owner account bootstrapped");

    let permissions = role.permission_keys();

    Ok(BootstrapOwnerResult {
        session: oz_core::auth::LoginSession {
            user_id: user.id,
            display_name: user.display_name,
            role_name: role.name,
            role_id: role.id,
            permissions,
        },
        // The command wrapper attaches the picker ticket after the pure
        // function returns (it needs the per-process secret).
        picker_ticket: String::new(),
    })
}

// ── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "staff_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "staff_security_events_tests.rs"]
mod security_events_tests;

/// Role-holder tests: a sibling module for the same reason the audit slice
/// used one — `staff_tests.rs` is another stream's in-flight file.
#[cfg(test)]
#[path = "staff_role_holders_tests.rs"]
mod role_holders_tests;
