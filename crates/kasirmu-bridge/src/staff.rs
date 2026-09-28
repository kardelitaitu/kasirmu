//! Staff command bodies (Wave B / B5) — the tauri-free half of
//! `apps/desktop-tauri/src/commands/staff.rs`.
//!
//! Key functions: the session-scoped staff reads/writes ([`list_staff_scoped`](crate::staff::list_staff_scoped),
//! [`get_staff_profile_scoped`](crate::staff::get_staff_profile_scoped), [`create_staff_scoped`](crate::staff::create_staff_scoped),
//! [`update_staff_scoped`](crate::staff::update_staff_scoped)), the role-authoring surface ([`list_roles_scoped`](crate::staff::list_roles_scoped),
//! [`list_permission_keys_scoped`](crate::staff::list_permission_keys_scoped), [`create_role_scoped`](crate::staff::create_role_scoped),
//! [`update_role_scoped`](crate::staff::update_role_scoped), [`delete_role_scoped`](crate::staff::delete_role_scoped), [`list_role_holders_scoped`](crate::staff::list_role_holders_scoped))
//! and the ungated first-run [`bootstrap_owner`](crate::staff::bootstrap_owner) over its pure
//! [`run_bootstrap_owner`](crate::staff::run_bootstrap_owner) `&Connection` body. The three legacy unscoped
//! commands are denial tombstones and stay in the shell — they carry no
//! business logic to move.
//!
//! Users, roles and assignments are GLOBAL identity records (ADR #4 / #7), so
//! every gate and every write here runs on [`BridgeCtx::lock_global`](crate::ctx::BridgeCtx::lock_global). Gate
//! order, transaction boundaries, security-event placement and error paths are
//! verbatim ports: a shim builds the context, calls one function here, and maps
//! [`BridgeError`](crate::error::BridgeError) back to `AppError` so the wire shape never moves. The one
//! exception is `grants_json`: roles.permissions is stored as a JSON array and
//! `serde_json` is not an `kasirmu-bridge` dependency, so the shell still encodes it
//! and passes the string in (the encoder cannot fail for a `Vec<String>`).

use kasirmu_core::auth::hash_pin;
use kasirmu_core::availability::UsageCounts;
use kasirmu_core::db::Store;
use kasirmu_core::db::assignments::{Assignment, AssignmentSpec, ScopeMode, ScopeType};
use kasirmu_core::db::audit_security::{
    SECURITY_ACTION_USER_CREATE, SECURITY_ACTION_USER_UPDATE, SECURITY_REASON_ACCOUNT_CREATED,
    SECURITY_REASON_PIN_ROTATED, SECURITY_REASON_PROFILE_CHANGED, SecurityEvent,
};
use kasirmu_core::db::profile::{SensitiveWritePolicy, UserProfile, mask_last4};
use kasirmu_core::entitlements::Entitlements;
use kasirmu_core::permissions;
use kasirmu_core::subscription::TenantSubscription;
use kasirmu_core::{Role, User};
use kasirmu_security::mask::mask_token;
use rusqlite::{Connection, OptionalExtension};

use foundation::{validate_min_length, validate_not_empty};

use crate::auth::record_security_event;
use crate::ctx::BridgeCtx;
use crate::error::BridgeError;
use crate::picker::{PICKER_TICKET_TTL_SECS, sign_picker_ticket};

// ── Staff member DTOs ───────────────────────────────────────────────
// The `pub use` both re-exports to consumers (`crate::staff::<Dto>`, and the
// shells' `kasirmu_bridge::staff::...`) and brings the names into this module's
// scope for the command bodies below, so no second `use` is needed.
pub mod dto;
pub use dto::{
    AssignmentArgs, AssignmentDto, BootstrapOwnerArgs, BootstrapOwnerResult, CreateRoleArgs,
    CreateStaffArgs, CreateStaffScopedArgs, PermissionKeyDto, ProfileArgs, ProfileViewDto, RoleDto,
    RoleHolderDto, RoleHoldersDto, StaffMemberDto, UpdateRoleArgs, UpdateStaffArgs,
    UpdateStaffScopedArgs,
};

// ── Shared helpers ──────────────────────────────────────────────────

/// Local mirror of the private helper in [`crate::ctx`]: the staff gates use
/// `Store::require_permission` (not the scope-aware form), so they need the
/// same `PermissionDenied` → [`BridgeError::PermissionDenied`] translation
/// the authz seam applies.
fn map_gate_error(e: kasirmu_core::CoreError) -> BridgeError {
    match e {
        kasirmu_core::CoreError::PermissionDenied(message) => {
            BridgeError::PermissionDenied(message)
        }
        other => BridgeError::from(other),
    }
}

/// Verify a permission for one user against a [`Store`] already bound to the
/// global identity DB. Port of `authz::require_permission_for_user`.
fn require_permission_for_user(
    store: &Store<'_>,
    user_id: &str,
    required: &str,
) -> Result<(), BridgeError> {
    store
        .require_permission(user_id, required)
        .map_err(map_gate_error)
}

/// Build the wire DTO for one staff member from its role list, profile and
/// assignment. Exposed for the shell re-export and the sibling test modules.
pub fn to_staff_dto(
    user: &User,
    roles: &[Role],
    profile: Option<&UserProfile>,
    assignment: Option<&Assignment>,
) -> StaffMemberDto {
    let role_name = roles
        .iter()
        .find(|r| r.id == user.role_id)
        .map(|r| r.name.clone())
        .unwrap_or_default();
    StaffMemberDto {
        id: user.id.clone(),
        staff_code: None,
        username: user.username.clone(),
        display_name: user.display_name.clone(),
        avatar: profile.and_then(|p| p.avatar.clone()),
        phone: profile.and_then(|p| p.phone.clone()),
        // The live paths never produce a trashed row; the trash read stamps
        // this after the fact.
        deleted_at: None,
        role_id: user.role_id.clone(),
        role_name,
        is_active: user.is_active,
        national_id_masked: profile
            .and_then(|p| p.national_id.as_deref())
            .map(mask_last4)
            .unwrap_or_else(|| "****".to_string()),
        is_profile_complete: profile.map(|p| p.is_complete()).unwrap_or(false),
        assignment: assignment_dto(assignment),
        created_at: if user.created_at.is_empty() {
            None
        } else {
            Some(user.created_at.clone())
        },
    }
}

/// Render an assignment for the wire. Legacy users without an assignment
/// row (pre-0048 databases) resolve as global all/all — the same effective
/// semantics as `users.role_id` alone.
pub fn assignment_dto(assignment: Option<&Assignment>) -> AssignmentDto {
    match assignment {
        Some(a) => AssignmentDto {
            scope_mode: a.scope_mode.as_str().to_string(),
            branches_all: a.branches_all,
            branch_ids: a.branches.clone(),
            workspaces_all: a.workspaces_all,
            workspace_keys: a.workspaces.clone(),
            scope_type: a
                .scope_type
                .map(ScopeType::as_str)
                .unwrap_or("organization")
                .to_string(),
            scope_id: a.scope_id.clone(),
        },
        None => AssignmentDto {
            scope_mode: ScopeMode::Global.as_str().to_string(),
            branches_all: true,
            branch_ids: vec![],
            workspaces_all: true,
            workspace_keys: vec![],
            scope_type: "organization".to_string(),
            scope_id: None,
        },
    }
}

/// Parse the wire `scope_mode` string, rejecting anything else.
pub fn parse_scope_mode(s: &str) -> Result<ScopeMode, BridgeError> {
    ScopeMode::parse(s).ok_or_else(|| BridgeError::Invalid(format!("invalid scope_mode: {s}")))
}

/// Map the wire args to an kasirmu-core assignment spec.
pub fn assignment_spec(args: &AssignmentArgs) -> Result<AssignmentSpec, BridgeError> {
    // ADR #47 resource axis: absent/empty is the org-wide default so
    // pre-ADR-47 callers are unchanged; anything else must parse and carry
    // a valid (type, id) pair — the same rule the SQL pair triggers
    // enforce, checked here for a typed error.
    let scope_type = match args.scope_type.as_deref() {
        None | Some("") => ScopeType::Organization,
        Some(s) => ScopeType::parse(s)
            .ok_or_else(|| BridgeError::Invalid(format!("invalid scope_type: {s}")))?,
    };
    let scope_id = args
        .scope_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    match (scope_type, scope_id.as_deref()) {
        (ScopeType::Organization, None) => {}
        (ScopeType::Organization, Some(_)) => {
            return Err(BridgeError::Invalid(
                "organization scope must not carry a scope_id".into(),
            ));
        }
        (_, None) => {
            return Err(BridgeError::Invalid(format!(
                "{} scope requires a scope_id",
                scope_type.as_str()
            )));
        }
        (_, Some(_)) => {}
    }
    Ok(AssignmentSpec {
        scope_mode: parse_scope_mode(&args.scope_mode)?,
        branches_all: args.branches_all,
        branches: args.branch_ids.clone(),
        workspaces_all: args.workspaces_all,
        workspaces: args.workspace_keys.clone(),
        scope_type,
        scope_id,
    })
}

/// Build the authoring DTO from a domain role, adding the two facts the
/// surface needs in order to decide what it may offer.
pub fn role_dto(store: &Store<'_>, role: Role) -> Result<RoleDto, BridgeError> {
    // Everything borrowed from `role` is read before its fields move into
    // the DTO; `permission_keys` takes &self and `name`/`description` move.
    let permissions = role.permission_keys();
    let is_builtin = kasirmu_core::db::roles::is_builtin_role_id(&role.id);
    let refs = store.role_reference_counts(&role.id)?;
    let reference_count = refs.iter().map(|(_, count)| count).sum();
    // Split rather than summed, because the kinds answer different questions:
    // a workspace-type row blocks deletion while no account holds the role
    // through it. Folding both into one number and printing "Used by N
    // accounts" stated a fact about people never computed from people.
    let grant_count = refs
        .iter()
        .filter(|(table, _)| matches!(*table, "role_workspace_types" | "role_workspaces"))
        .map(|(_, count)| count)
        .sum();
    // Its own query, not `reference_count - grant_count`: an account whose
    // assignment names a different role is a referrer of THIS one without
    // being a holder of it, so no arithmetic over rows recovers the set. That
    // is also why `reference_count` above is kept rather than derived.
    let holder_count = store.role_holder_count(&role.id)?;
    Ok(RoleDto {
        id: role.id,
        name: role.name,
        description: role.description,
        permissions,
        deleted_at: None,
        is_builtin,
        reference_count,
        holder_count,
        grant_count,
    })
}

/// Enforce role-assignment policy (STAFF-02).
///
/// - Only a caller with `staff:manage_roles` (i.e. the Owner preset, which
///   carries `*`) may create or promote an account to the Owner role.
/// - A caller may not change their own role (no self-promotion).
/// - The last active Owner may not be deactivated, demoted, or edited away.
pub fn enforce_role_assignment_policy(
    store: &Store<'_>,
    caller_user_id: &str,
    target_user_id: Option<&str>,
    target_role_id: &str,
    target_is_active: bool,
) -> Result<(), BridgeError> {
    // Only Owner-level roles may assign the Owner role.
    if target_role_id == kasirmu_core::builtin_roles::OWNER {
        require_permission_for_user(store, caller_user_id, permissions::STAFF_MANAGE_ROLES)?;
    }

    if let Some(target_id) = target_user_id {
        // No self-promotion / self-deactivation: a user cannot change their
        // own role and cannot deactivate their own account (STAFF-10).
        if target_id == caller_user_id {
            let caller = store
                .get_user(caller_user_id)?
                .ok_or_else(|| BridgeError::PermissionDenied("user not found".into()))?;
            if caller.role_id != target_role_id {
                return Err(BridgeError::PermissionDenied(
                    "you cannot change your own role".into(),
                ));
            }
            if !target_is_active {
                return Err(BridgeError::PermissionDenied(
                    "you cannot deactivate your own account".into(),
                ));
            }
        }

        // Last-owner protection: cannot deactivate/demote the last active Owner.
        if let Some(target) = store.get_user(target_id)?
            && target.role_id == kasirmu_core::builtin_roles::OWNER
            && (target_role_id != kasirmu_core::builtin_roles::OWNER || !target_is_active)
        {
            let active_owners = store
                .list_users()?
                .iter()
                .filter(|u| u.role_id == kasirmu_core::builtin_roles::OWNER && u.is_active)
                .count();
            if active_owners <= 1 {
                return Err(BridgeError::PermissionDenied(
                    "cannot deactivate or demote the last active Owner".into(),
                ));
            }
        }
    }

    Ok(())
}

/// Sweep every session belonging to `user_id` except `keep_token` (STAFF-03),
/// logging `reason` so a PIN rotation and an account deletion share one path.
///
/// Verbatim port of `AppState::invalidate_user_sessions_except`, including the
/// poisoned-lock warn-and-return-0 behaviour and the masked log line: the
/// bridge holds the SAME `Arc` session map as the shell (see [`crate::auth`]),
/// so this is the same eviction, not a second copy of the state.
fn invalidate_user_sessions_except(
    ctx: &BridgeCtx<'_>,
    user_id: &str,
    keep_token: &str,
    reason: &str,
) {
    let mut store = match ctx.sessions.write() {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!("session store lock poisoned during invalidation: {e}");
            return;
        }
    };
    let before = store.len();
    store.retain(|token, ctx| {
        ctx.user_id != user_id || (!keep_token.is_empty() && token == keep_token)
    });
    let removed = before - store.len();
    if removed > 0 {
        tracing::info!(
            user_id = %user_id,
            removed = %removed,
            keep_token = %mask_token(keep_token),
            reason = %reason,
            "sessions invalidated"
        );
    }
}

// ── Session-scoped staff commands (ADR #7 · audit-open-findings STAFF-01) ──

/// List staff members. Caller identity is resolved from the session token.
///
/// # Errors
///
/// [`BridgeError::InvalidSession`] for an unknown or expired token;
/// [`BridgeError::PermissionDenied`] without `staff:read`;
/// [`BridgeError::Core`] on store errors.
pub async fn list_staff_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<Vec<StaffMemberDto>, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    let db = ctx.lock_global().await;
    let store = Store::new(&db);
    require_permission_for_user(&store, &session.user_id, permissions::STAFF_READ)?;
    let users = store.list_users()?;
    let roles = store.list_roles()?;
    let dtos = users
        .iter()
        .map(|u| {
            let profile = store.get_user_profile(&u.id).ok().flatten();
            let assignment = store.assignment_for_user(&u.id).ok().flatten();
            let mut dto = to_staff_dto(u, &roles, profile.as_ref(), assignment.as_ref());
            dto.staff_code = store.get_staff_code(&u.id).unwrap_or(None);
            dto
        })
        .collect();
    drop(db);
    Ok(dtos)
}

/// Load a staff member full profile as the session user sees it (ADR #35
/// D6). Sensitive fields are withheld or masked unless the caller holds
/// `staff:read_identity` / `staff:read_payroll`, and every sensitive read is
/// audited — see [`Store`].
///
/// # Errors
///
/// [`BridgeError::InvalidSession`] for an unknown or expired token;
/// [`BridgeError::PermissionDenied`] without `staff:read`;
/// [`BridgeError::Invalid`] when the target user does not exist;
/// [`BridgeError::Core`] on store errors.
pub async fn get_staff_profile_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    user_id: &str,
) -> Result<ProfileViewDto, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    let db = ctx.lock_global().await;
    let store = Store::new(&db);
    require_permission_for_user(&store, &session.user_id, permissions::STAFF_READ)?;
    let view = store
        .get_user_profile_viewed_by(&session.user_id, user_id)?
        .ok_or_else(|| BridgeError::Invalid(format!("no such user: {user_id}")))?;
    drop(db);
    let mut dto: ProfileViewDto = view.into();
    dto.user_id = user_id.to_string();
    Ok(dto)
}

/// List roles. Caller identity is resolved from the session token.
///
/// # Errors
///
/// [`BridgeError::InvalidSession`] for an unknown or expired token;
/// [`BridgeError::PermissionDenied`] without `staff:read`;
/// [`BridgeError::Core`] on store errors.
pub async fn list_roles_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<Vec<RoleDto>, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    let db = ctx.lock_global().await;
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

/// List the registered permission keys.
///
/// Without this the authoring UI would have to hardcode the vocabulary, which
/// is what ADR #35 forbids: the registry is the single source of truth, and a
/// picker fed from a copy of it drifts from the keys the gate actually
/// honors. Gated on 'staff:read' rather than 'staff:manage_roles' — knowing
/// which keys exist is not the power to grant them.
///
/// # Errors
///
/// [`BridgeError::InvalidSession`] for an unknown or expired token;
/// [`BridgeError::PermissionDenied`] without `staff:read`.
pub async fn list_permission_keys_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<Vec<PermissionKeyDto>, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::STAFF_READ)
        .await?;
    Ok(kasirmu_core::permission_registry::REGISTRY
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
/// something they cannot keep; a generated `role-<uuidv7>` is outside
/// ROLE_PRESETS by construction.
///
/// `grants_json` is the caller-encoded JSON array of permission keys (see the
/// module header: the encoder stays in the shell because `serde_json` is not
/// an `kasirmu-bridge` dependency).
///
/// # Errors
///
/// [`BridgeError::InvalidSession`] for an unknown or expired token;
/// [`BridgeError::PermissionDenied`] without `staff:manage_roles`;
/// [`BridgeError::Invalid`] for an empty name; [`BridgeError::Core`] on store
/// errors.
pub async fn create_role_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: &CreateRoleArgs,
    grants_json: &str,
) -> Result<RoleDto, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::STAFF_MANAGE_ROLES)
        .await?;
    validate_not_empty("name", &args.name).map_err(|e| BridgeError::Invalid(e.to_string()))?;
    let db = ctx.lock_global().await;
    let store = Store::new(&db);
    let role = store.create_role(
        &format!("role-{}", uuid::Uuid::now_v7()),
        &args.name,
        &args.description,
        grants_json,
    )?;
    role_dto(&store, role)
}

/// Re-name, re-describe, or re-grant an authored role.
///
/// Editing re-points every holder, so the grant set is validated against the
/// registry core-side and preset ids are refused there too — the rule lives in
/// one place, so this command cannot become the way around it.
///
/// # Errors
///
/// [`BridgeError::InvalidSession`] for an unknown or expired token;
/// [`BridgeError::PermissionDenied`] without `staff:manage_roles`;
/// [`BridgeError::Core`] on store errors.
pub async fn update_role_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: &UpdateRoleArgs,
    grants_json: &str,
) -> Result<RoleDto, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::STAFF_MANAGE_ROLES)
        .await?;
    let db = ctx.lock_global().await;
    let store = Store::new(&db);
    let role = store.update_role(&args.id, &args.name, &args.description, grants_json)?;
    role_dto(&store, role)
}

/// Delete an authored role.
///
/// Refused for preset ids and for any role still referenced. The second guard
/// matters more here than a usual FK: authorize_with fails closed on an
/// unresolvable role, so dropping one out from under a holder would be a
/// silent loss of access rather than an error.
///
/// # Errors
///
/// [`BridgeError::InvalidSession`] for an unknown or expired token;
/// [`BridgeError::PermissionDenied`] without `staff:manage_roles`;
/// [`BridgeError::Core`] on store errors.
pub async fn delete_role_scoped(
    ctx: &BridgeCtx<'_>,
    id: &str,
    session_token: &str,
) -> Result<(), BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::STAFF_MANAGE_ROLES)
        .await?;
    let db = ctx.lock_global().await;
    Store::new(&db).soft_delete_role(id)?;
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
///
/// # Errors
///
/// [`BridgeError::InvalidSession`] for an unknown or expired token;
/// [`BridgeError::PermissionDenied`] without `staff:read`;
/// [`BridgeError::Core`] on store errors.
pub async fn list_role_holders_scoped(
    ctx: &BridgeCtx<'_>,
    id: &str,
    session_token: &str,
) -> Result<RoleHoldersDto, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    let db = ctx.lock_global().await;
    let store = Store::new(&db);
    require_permission_for_user(&store, &session.user_id, permissions::STAFF_READ)?;
    let (holders, total) = store.role_holders(id, kasirmu_core::db::roles::ROLE_HOLDERS_MAX)?;
    Ok(RoleHoldersDto {
        holders: holders.into_iter().map(RoleHolderDto::from).collect(),
        total,
        cap: kasirmu_core::db::roles::ROLE_HOLDERS_MAX,
    })
}

/// Create a staff member. Caller identity is resolved from the session token.
///
/// STAFF-02: enforces the role-assignment hierarchy (only Owner-level
/// callers may create an Owner account).
///
/// # Errors
///
/// [`BridgeError::InvalidSession`] for an unknown or expired token;
/// [`BridgeError::Invalid`] for a blank/short field;
/// [`BridgeError::PermissionDenied`] without `staff:create` (or
/// `staff:manage_roles` when assigning the Owner role);
/// [`BridgeError::Internal`] when the tenant subscription row is missing;
/// [`BridgeError::Core`] on store or quota errors.
pub async fn create_staff_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: &CreateStaffScopedArgs,
) -> Result<StaffMemberDto, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    let username = args.username.trim().to_lowercase();
    let display_name = args.display_name.trim();

    validate_not_empty("username", &username).map_err(|e| BridgeError::Invalid(e.to_string()))?;
    validate_not_empty("display_name", display_name)
        .map_err(|e| BridgeError::Invalid(e.to_string()))?;
    validate_min_length("pin", &args.pin, 4).map_err(|e| BridgeError::Invalid(e.to_string()))?;
    validate_not_empty("role_id", &args.role_id)
        .map_err(|e| BridgeError::Invalid(e.to_string()))?;

    let pin_hash =
        hash_pin(&args.pin).map_err(|e| BridgeError::Internal(format!("hashing PIN: {e}")))?;

    let db = ctx.lock_global().await;
    let store = Store::new(&db);
    require_permission_for_user(&store, &session.user_id, permissions::STAFF_CREATE)?;
    enforce_role_assignment_policy(&store, &session.user_id, None, &args.role_id, true)?;
    // C1.1: enforce the subscription tier staff-user limit (Free 1 / Plus 5 /
    // Pro 20) before creating — the count runs against the global identity DB
    // that also holds the tenant_subscription row.
    let sub = TenantSubscription::load(&db, "default")?
        .ok_or_else(|| BridgeError::Internal("default tenant subscription not found".into()))?;
    sub.verify_signature()?;
    // MSL-36: ledger-aware (see `Entitlements::from_subscription_for_connection`).
    // This door grants a capability and nothing on its path validates the clock,
    // so the wall-clock reader would over-credit a rolled-back install.
    store.enforce_staff_quota(
        &Entitlements::from_subscription_for_connection(&sub, &db, UsageCounts::default()).tier,
    )?;
    let profile = args.profile.clone().into_profile();
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
    let staff_code = store.get_staff_code(&user.id).unwrap_or(None);
    drop(db);

    let mut dto = to_staff_dto(
        &user,
        &roles,
        Some(&profile),
        assignment.as_ref(),
    );
    dto.staff_code = staff_code;
    Ok(dto)
}

/// Update a staff member. Caller identity is resolved from the session token.
///
/// STAFF-02: enforces the role-assignment hierarchy (Owner-only promotion,
/// no self-promotion, last-owner protection).
/// STAFF-03: optionally rotates the PIN when `args.pin` is a non-empty value.
/// STAFF-05: the profile update, PIN rotation, and (optional) assignment
/// scope run as one command inside a single global-DB transaction — any
/// failure rolls the whole update back atomically. The legacy store-scoped
/// `workspace_keys` write path (which needed cross-DB compensation) is
/// retired; assignments ride the same transaction as the profile.
///
/// # Errors
///
/// [`BridgeError::InvalidSession`] for an unknown or expired token;
/// [`BridgeError::PermissionDenied`] without `staff:update`, or on any
/// role-hierarchy refusal (self-promotion, self-deactivation, last Owner);
/// [`BridgeError::Invalid`] for a short new PIN;
/// [`BridgeError::Internal`] on a PIN-hash failure or if the updated user
/// row vanishes; [`BridgeError::Core`] on store errors.
pub async fn update_staff_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: &UpdateStaffScopedArgs,
) -> Result<StaffMemberDto, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    let db = ctx.lock_global().await;

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

    // STAFF-05 compensation: snapshot the profile BEFORE the update so we can
    // restore it if the store-scoped workspace write fails afterwards.
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
        // C1.1 / W7-B: the reactivation door of the staff limit. Creating a
        // member is gated in `create_staff_scoped` and vetoed in-tx by
        // `create_user`; switching a member back ON adds exactly the same row
        // to the same count, so it walks the same gate — otherwise
        // deactivate -> create -> reactivate exceeds the cap while every
        // individual step is allowed.
        //
        // Only the INACTIVE -> ACTIVE transition is gated: that is the one that
        // grows the counted set, and a plan at its cap must still let an
        // operator edit an active member or deactivate one. The current state
        // is read HERE, inside the transaction and with the same
        // `deleted_at IS NULL` guard the write below uses, so a trashed or
        // absent id answers NotFound from `update_user_in_tx` rather than
        // being misreported as a quota failure.
        let reactivating = args.is_active
            && tx
                .query_row(
                    "SELECT is_active FROM users WHERE id = ?1 AND deleted_at IS NULL",
                    rusqlite::params![args.id],
                    |row| row.get::<_, bool>(0),
                )
                .optional()?
                .is_some_and(|active| !active);
        if reactivating {
            // Arms the in-tx veto on the SAME Store that performs the write, so
            // the verdict and the UPDATE commit or roll back together (the
            // pre-tx form alone leaves a WAL-snapshot TOCTOU where two
            // concurrent reactivations both pass).
            let tier = store.resolve_tier_fail_closed()?;
            store.enforce_staff_quota(&tier)?;
        }
        store.update_user_in_tx(
            &args.id,
            &args.username,
            &args.display_name,
            &args.role_id,
            args.is_active,
        )?;
        // ADR #35 D6: the profile columns (validated, encrypted at rest by
        // kasirmu-core) follow the same atomic update. Single-statement write,
        // safe inside this transaction.
        //
        // The write is caller-aware, and both halves of the policy matter:
        //
        // * an editor WITHOUT `staff:read_identity` was shown an empty national
        //   id and tax id because the read withheld them, not because they are
        //   unset. The write must therefore keep the stored ones: requiring
        //   them leaves no way to save except inventing a value for a document
        //   the editor cannot see, and clearing them destroys the real one.
        // * this screen does not manage payroll — the pay field belongs to its
        //   own surface — so an update from here never moves the stored amount.
        //   `keep_pay` is what makes that true; without it, omitting the field
        //   would clear it, and requiring it would force a blank edit.
        if let Some(profile) = &args.profile {
            let policy = SensitiveWritePolicy {
                keep_identity_record: !store
                    .holds_permission(&session.user_id, permissions::STAFF_READ_IDENTITY)?,
                keep_pay: true,
            };
            store.write_user_profile_with(policy, &args.id, &profile.clone().into_profile())?;
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
            validate_min_length("pin", pin, 4).map_err(|e| BridgeError::Invalid(e.to_string()))?;
            let pin_hash =
                hash_pin(pin).map_err(|e| BridgeError::Internal(format!("hashing PIN: {e}")))?;
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
            .ok_or_else(|| BridgeError::Internal(format!("updated user {} vanished", args.id)))?;
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
        // under the old PIN. The caller own session is preserved — they
        // authenticated moments ago and the UI reloads with the same token.
        invalidate_user_sessions_except(ctx, &args.id, session_token, SECURITY_REASON_PIN_ROTATED);
    }

    let profile = match &args.profile {
        Some(p) => Some(p.clone().into_profile()),
        None => previous_profile.and_then(|(_, _, _, _, _, p)| p),
    };
    let (assignment, staff_code) = {
        let db = ctx.lock_global().await;
        let store = Store::new(&db);
        (
            store.assignment_for_user(&args.id)?,
            store.get_staff_code(&args.id).unwrap_or(None),
        )
    };
    let mut dto = to_staff_dto(
        &user,
        &roles,
        profile.as_ref(),
        assignment.as_ref(),
    );
    dto.staff_code = staff_code;
    Ok(dto)
}

// ── Bootstrap first owner (no authentication required) ────────────────

/// Business logic for [`bootstrap_owner`] (extracted for testing).
///
/// # Errors
///
/// [`BridgeError::Invalid`] when staff accounts already exist or validation
/// fails (empty username, short PIN); [`BridgeError::Internal`] when the
/// Owner role is missing after seeding or the PIN cannot be hashed;
/// [`BridgeError::Core`] on store errors.
pub fn run_bootstrap_owner(
    conn: &Connection,
    args: &BootstrapOwnerArgs,
) -> Result<BootstrapOwnerResult, BridgeError> {
    let username = args.username.trim().to_lowercase();
    let display_name = args.display_name.trim();

    validate_not_empty("username", &username).map_err(|e| BridgeError::Invalid(e.to_string()))?;
    validate_not_empty("display_name", display_name)
        .map_err(|e| BridgeError::Invalid(e.to_string()))?;
    validate_min_length("pin", &args.pin, 4).map_err(|e| BridgeError::Invalid(e.to_string()))?;

    let pin_hash =
        hash_pin(&args.pin).map_err(|e| BridgeError::Internal(format!("hashing PIN: {e}")))?;

    let store = Store::new(conn);

    // Guard: refuse to bootstrap if users already exist.
    let existing = store.list_users()?;
    if !existing.is_empty() {
        return Err(BridgeError::Invalid(
            "cannot bootstrap: staff accounts already exist".into(),
        ));
    }

    // Seed roles first so role-owner exists.
    store.seed_default_roles()?;

    let user = store.create_user(
        &username,
        &pin_hash,
        display_name,
        kasirmu_core::builtin_roles::OWNER,
    )?;
    let role = store
        .get_role(kasirmu_core::builtin_roles::OWNER)?
        .ok_or_else(|| BridgeError::Internal("owner role not found after seeding".into()))?;

    tracing::info!(username = %username, "owner account bootstrapped");

    let permissions = role.permission_keys();

    Ok(BootstrapOwnerResult {
        session: kasirmu_core::auth::LoginSession {
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

/// Create the first owner user in a fresh installation.
///
/// This is the only command that does NOT require an existing session,
/// because there are no users yet. It seeds the default roles first,
/// then creates a user with the `role-owner` role.
///
/// # Errors
///
/// [`BridgeError::Invalid`] if any users already exist, preventing accidental
/// re-bootstrapping after staff accounts have been created, or if validation
/// fails (empty username, short PIN, etc.).
pub async fn bootstrap_owner(
    ctx: &BridgeCtx<'_>,
    args: &BootstrapOwnerArgs,
) -> Result<BootstrapOwnerResult, BridgeError> {
    let db = ctx.lock_global().await;
    let mut result = run_bootstrap_owner(&db, args)?;
    drop(db);

    // Mint the short-lived picker ticket bound to the new owner. It is
    // only valid for the pre-session workspace picker; `create_session`
    // hands out the opaque session token afterwards.
    let now_ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    result.picker_ticket = sign_picker_ticket(
        &ctx.picker_ticket_secret,
        &result.session.user_id,
        now_ts + PICKER_TICKET_TTL_SECS,
    );
    Ok(result)
}

// ── Trash: soft-deleted staff and roles ───────────────────────────────
pub mod trash;
pub use trash::{
    delete_staff_scoped, list_role_trash_scoped, list_staff_trash_scoped, restore_role_scoped,
    restore_staff_scoped,
};

#[cfg(test)]
#[path = "staff_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "staff_security_events_tests.rs"]
mod security_events_tests;

#[cfg(test)]
#[path = "staff_role_holders_tests.rs"]
mod role_holders_tests;
