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

use serde::{Deserialize, Serialize};
use tauri::{State, command};

use oz_core::auth::hash_pin;
use oz_core::db::Store;
use oz_core::db::assignments::{Assignment, AssignmentSpec, ScopeMode, ScopeType};
use oz_core::db::audit_security::{
    SECURITY_ACTION_USER_CREATE, SECURITY_ACTION_USER_UPDATE, SECURITY_REASON_ACCOUNT_CREATED,
    SECURITY_REASON_PIN_ROTATED, SECURITY_REASON_PROFILE_CHANGED, SecurityEvent,
};
use oz_core::db::profile::{UserProfile, mask_last4};
use oz_core::permissions;
use oz_core::subscription::TenantSubscription;
use oz_core::{Role, User};

use foundation::{validate_min_length, validate_not_empty};

use crate::commands::auth::record_security_event;
use crate::commands::authz::{require_permission_for_session, require_permission_for_user};
use crate::commands::picker_ticket;
use crate::error::AppError;
use crate::state::AppState;

// ── Staff member DTO ────────────────────────────────────────────────

/// A user's single effective assignment as seen by the front-end (ADR #35
/// D5 / spec 0048 + ADR #47): scope mode, the per-dimension explicit-all
/// flags and lists, and the resource axis. Legacy users without an
/// assignment row resolve as global all/all organization.
#[derive(Debug, Serialize)]
pub struct AssignmentDto {
    /// `"global"` or `"scoped"`.
    pub scope_mode: String,
    /// Branch dimension is explicit `all`.
    pub branches_all: bool,
    /// Branch ids in scope when `branches_all` is false.
    pub branch_ids: Vec<String>,
    /// Workspace dimension is explicit `all`.
    pub workspaces_all: bool,
    /// Workspace keys in scope when `workspaces_all` is false.
    pub workspace_keys: Vec<String>,
    /// ADR #47 resource axis: `"organization"`, `"legal_entity"`, or
    /// `"location"`.
    pub scope_type: String,
    /// The resource id when the axis is not organization.
    pub scope_id: Option<String>,
}

/// The assignment scope carried by the staff create/edit IPC args (ADR #35
/// D5 / spec 0048 + ADR #47): `scope_mode` plus the per-dimension
/// explicit-all flag and list, and the optional resource axis. Empty lists
/// never mean "all" — the `*_all` flags are the explicit marker, so `list`
/// with no ids is a deny. A missing `scope_type` (or an empty string) is
/// the org-wide default, keeping pre-ADR-47 callers unchanged.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct AssignmentArgs {
    /// `"global"` or `"scoped"`.
    pub scope_mode: String,
    /// Branch dimension is explicit `all`.
    pub branches_all: bool,
    /// Branch ids in scope when `branches_all` is false.
    pub branch_ids: Vec<String>,
    /// Workspace dimension is explicit `all`.
    pub workspaces_all: bool,
    /// Workspace keys in scope when `workspaces_all` is false.
    pub workspace_keys: Vec<String>,
    /// ADR #47 resource axis: `"organization"` (default),
    /// `"legal_entity"`, or `"location"`.
    pub scope_type: Option<String>,
    /// The resource id; required when `scope_type` is not organization.
    pub scope_id: Option<String>,
}

/// Staff member as seen by the front-end (no pin_hash exposed).
#[derive(Debug, Serialize)]
pub struct StaffMemberDto {
    /// Unique identifier.
    pub id: String,
    /// Username.
    pub username: String,
    /// Display Name.
    pub display_name: String,
    /// ID of the associated role.
    pub role_id: String,
    /// Role Name.
    pub role_name: String,
    /// Whether this is active.
    pub is_active: bool,
    /// National id rendered last-4 masked (ADR #35 D6).
    pub national_id_masked: String,
    /// Whether all 8 required profile fields are present.
    pub is_profile_complete: bool,
    /// The user's single effective assignment (ADR #35 D5 / spec 0048).
    pub assignment: AssignmentDto,
}

/// The 17 profile fields carried by the staff create/edit IPC args (ADR #35
/// D6 / spec 0049). All optional on the wire — creation-time mandatory-ness
/// is enforced by `create_user_with_profile`, and the form blocks submission
/// before the command is ever called.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(default)]
pub struct ProfileArgs {
    /// ISO date (`YYYY-MM-DD`), never in the future.
    pub date_of_birth: Option<String>,
    /// Phone in E.164 form.
    pub phone: Option<String>,
    /// `"ssn"` or `"nik"`.
    pub national_id_type: Option<String>,
    /// National id (ssn 9 / nik 16 digits) — encrypted at rest.
    pub national_id: Option<String>,
    /// Lowercase email, unique when present.
    pub email: Option<String>,
    /// Monthly take-home pay in i64 minor units — encrypted at rest.
    pub monthly_take_home_minor: Option<i64>,
    /// Emergency contact name (required at creation).
    pub emergency_contact_name: Option<String>,
    /// Emergency contact phone (required at creation).
    pub emergency_contact_phone: Option<String>,
    /// Job title (free text).
    pub job_title: Option<String>,
    /// Free-text notes.
    pub notes: Option<String>,
    /// Street address.
    pub address: Option<String>,
    /// UI language preference.
    pub language: Option<String>,
    /// Avatar reference.
    pub avatar: Option<String>,
    /// Tax identification number.
    pub tax_id: Option<String>,
    /// Expiry of the national id document (`YYYY-MM-DD`).
    pub national_id_expires_at: Option<String>,
    /// Relationship of the emergency contact (e.g. "spouse").
    pub emergency_contact_relationship: Option<String>,
    /// Hire date (`YYYY-MM-DD`).
    pub hire_date: Option<String>,
}

impl ProfileArgs {
    /// Build the domain [`UserProfile`] (empty strings for the stable slots).
    pub fn into_profile(self) -> UserProfile {
        UserProfile {
            date_of_birth: self.date_of_birth,
            phone: self.phone,
            national_id_type: self.national_id_type,
            national_id: self.national_id,
            email: self.email,
            monthly_take_home_minor: self.monthly_take_home_minor,
            emergency_contact_name: self.emergency_contact_name,
            emergency_contact_phone: self.emergency_contact_phone,
            job_title: self.job_title.unwrap_or_default(),
            notes: self.notes.unwrap_or_default(),
            address: self.address,
            language: self.language,
            avatar: self.avatar,
            tax_id: self.tax_id,
            national_id_expires_at: self.national_id_expires_at,
            emergency_contact_relationship: self.emergency_contact_relationship,
            hire_date: self.hire_date,
        }
    }
}

/// A staff profile as seen by the caller (ADR #35 D6).
#[derive(Debug, Serialize)]
pub struct ProfileViewDto {
    /// Target user id.
    pub user_id: String,
    /// Login username.
    pub username: String,
    /// Display name.
    pub display_name: String,
    /// ISO date of birth.
    pub date_of_birth: Option<String>,
    /// Phone in E.164 form.
    pub phone: Option<String>,
    /// `"ssn"` or `"nik"`.
    pub national_id_type: Option<String>,
    /// Full national id — present only with `staff:read_identity`.
    pub national_id: Option<String>,
    /// Last-4 masked national id — always present.
    pub national_id_masked: String,
    /// Lowercase email.
    pub email: Option<String>,
    /// Monthly take-home pay — present only with `staff:read_payroll`.
    pub monthly_take_home_minor: Option<i64>,
    /// Emergency contact name.
    pub emergency_contact_name: Option<String>,
    /// Emergency contact phone.
    pub emergency_contact_phone: Option<String>,
    /// Job title.
    pub job_title: String,
    /// Free-text notes.
    pub notes: String,
    /// Street address.
    pub address: Option<String>,
    /// UI language preference.
    pub language: Option<String>,
    /// Avatar reference.
    pub avatar: Option<String>,
    /// Tax id — present only with `staff:read_identity`.
    pub tax_id: Option<String>,
    /// National id document expiry.
    pub national_id_expires_at: Option<String>,
    /// Emergency contact relationship.
    pub emergency_contact_relationship: Option<String>,
    /// Hire date.
    pub hire_date: Option<String>,
    /// Whether all 8 required profile fields are present.
    pub is_complete: bool,
}

impl From<oz_core::db::profile::ProfileView> for ProfileViewDto {
    fn from(view: oz_core::db::profile::ProfileView) -> Self {
        Self {
            user_id: String::new(),
            username: view.username,
            display_name: view.display_name,
            date_of_birth: view.date_of_birth,
            phone: view.phone,
            national_id_type: view.national_id_type,
            national_id: view.national_id,
            national_id_masked: view.national_id_masked,
            email: view.email,
            monthly_take_home_minor: view.monthly_take_home_minor,
            emergency_contact_name: view.emergency_contact_name,
            emergency_contact_phone: view.emergency_contact_phone,
            job_title: view.job_title,
            notes: view.notes,
            address: view.address,
            language: view.language,
            avatar: view.avatar,
            tax_id: view.tax_id,
            national_id_expires_at: view.national_id_expires_at,
            emergency_contact_relationship: view.emergency_contact_relationship,
            hire_date: view.hire_date,
            is_complete: view.is_complete,
        }
    }
}

fn to_staff_dto(
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
        username: user.username.clone(),
        display_name: user.display_name.clone(),
        role_id: user.role_id.clone(),
        role_name,
        is_active: user.is_active,
        national_id_masked: profile
            .and_then(|p| p.national_id.as_deref())
            .map(mask_last4)
            .unwrap_or_else(|| "****".to_string()),
        is_profile_complete: profile.map(|p| p.is_complete()).unwrap_or(false),
        assignment: assignment_dto(assignment),
    }
}

/// Render an assignment for the wire. Legacy users without an assignment
/// row (pre-0048 databases) resolve as global all/all — the same effective
/// semantics as `users.role_id` alone.
fn assignment_dto(assignment: Option<&Assignment>) -> AssignmentDto {
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
fn parse_scope_mode(s: &str) -> Result<ScopeMode, AppError> {
    ScopeMode::parse(s).ok_or_else(|| AppError::Invalid(format!("invalid scope_mode: {s}")))
}

/// Map the wire args to an oz-core assignment spec.
fn assignment_spec(args: &AssignmentArgs) -> Result<AssignmentSpec, AppError> {
    // ADR #47 resource axis: absent/empty is the org-wide default so
    // pre-ADR-47 callers are unchanged; anything else must parse and carry
    // a valid (type, id) pair — the same rule the SQL pair triggers
    // enforce, checked here for a typed error.
    let scope_type = match args.scope_type.as_deref() {
        None | Some("") => ScopeType::Organization,
        Some(s) => ScopeType::parse(s)
            .ok_or_else(|| AppError::Invalid(format!("invalid scope_type: {s}")))?,
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
            return Err(AppError::Invalid(
                "organization scope must not carry a scope_id".into(),
            ));
        }
        (_, None) => {
            return Err(AppError::Invalid(format!(
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

#[derive(Debug, Serialize)]
/// Roledto.
pub struct RoleDto {
    /// Unique identifier.
    pub id: String,
    /// Display name.
    pub name: String,
    /// Human-readable description.
    pub description: String,
    /// Granted permission keys, verbatim from the role's permissions JSON
    /// (may include `"*"`). Shown in the staff screen so an admin can see
    /// exactly what each role can do.
    pub permissions: Vec<String>,
    /// Whether the preset seeder owns this row. `true` means the authoring
    /// surface must not offer Edit or Delete: `seed_default_roles` upserts
    /// preset ids and overwrites their grants, and it is reachable from the
    /// UI (`seed_default_roles_scoped`), so an accepted edit would be
    /// silently destroyed later. `role-custom` is a preset — a role *called*
    /// custom is not an authored row.
    pub is_builtin: bool,
    /// Rows still pointing at this role across `users`, `assignments`,
    /// `role_workspace_types` and `role_workspaces`. Non-zero means Delete is
    /// refused, so the UI can say so before the click rather than after.
    pub reference_count: i64,
}

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

#[derive(Debug, Deserialize)]
/// Createstaffargs.
pub struct CreateStaffArgs {
    /// Username.
    pub username: String,
    /// Pin.
    pub pin: String,
    /// Display Name.
    pub display_name: String,
    /// ID of the associated role.
    pub role_id: String,
    /// User ID of the caller (from `LoginSession`). Used for permission check.
    pub caller_user_id: String,
}

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

#[derive(Debug, Deserialize)]
/// Updatestaffargs.
pub struct UpdateStaffArgs {
    /// Unique identifier.
    pub id: String,
    /// Username.
    pub username: String,
    /// Display Name.
    pub display_name: String,
    /// ID of the associated role.
    pub role_id: String,
    /// Whether this is active.
    pub is_active: bool,
    /// User ID of the caller (from `LoginSession`). Used for permission check.
    pub caller_user_id: String,
}

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

/// Arguments for creating a staff member from a session token.
///
/// Deliberately carries NO caller identity field.
#[derive(Debug, Deserialize)]
/// Createstaffscopedargs.
pub struct CreateStaffScopedArgs {
    /// Username.
    pub username: String,
    /// Pin.
    pub pin: String,
    /// Display Name.
    pub display_name: String,
    /// ID of the associated role.
    pub role_id: String,
    /// ADR #35 D6 profile fields — creation requires the 9 mandatory fields.
    pub profile: ProfileArgs,
    /// Optional assignment scope (spec 0048). When `Some`, the user is
    /// created with this scope instead of the default global all/all.
    #[serde(default)]
    pub assignment: Option<AssignmentArgs>,
}

/// Arguments for updating a staff member from a session token.
///
/// Deliberately carries NO caller identity field.
#[derive(Debug, Deserialize)]
/// Updatestaffscopedargs.
pub struct UpdateStaffScopedArgs {
    /// Unique identifier.
    pub id: String,
    /// Username.
    pub username: String,
    /// Display Name.
    pub display_name: String,
    /// ID of the associated role.
    pub role_id: String,
    /// Whether this is active.
    pub is_active: bool,
    /// Optional new PIN (STAFF-03). When `Some(non-empty)` the PIN is
    /// validated, hashed server-side, and persisted via `update_user_pin`.
    /// `None`/empty leaves the current PIN unchanged.
    pub pin: Option<String>,
    /// ADR #35 D6 profile fields (validated + encrypted at rest). When
    /// `Some`, they are written atomically with the user update.
    #[serde(default)]
    pub profile: Option<ProfileArgs>,
    /// Optional assignment scope (ADR #35 D5 / spec 0048). When `Some`, it
    /// is written atomically with the user + profile update inside the same
    /// transaction (replaces the legacy store-scoped workspace write for
    /// callers using the new model).
    #[serde(default)]
    pub assignment: Option<AssignmentArgs>,
}

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

/// Create-role args. Deliberately carries no id; see [create_role_scoped].
#[derive(Debug, Deserialize)]
pub struct CreateRoleArgs {
    /// Display name, unique across roles.
    pub name: String,
    /// What the role covers.
    #[serde(default)]
    pub description: String,
    /// Registry permission keys to grant.
    #[serde(default)]
    pub permissions: Vec<String>,
}

/// Update-role args. The grant set replaces wholesale — a role edit is not
/// partial, because a grant silently carried over from the previous set
/// would be a privilege nobody asked for.
#[derive(Debug, Deserialize)]
pub struct UpdateRoleArgs {
    /// The authored role to rewrite. Preset ids are refused core-side.
    pub id: String,
    /// Display name, unique across roles.
    pub name: String,
    /// What the role covers.
    #[serde(default)]
    pub description: String,
    /// The complete replacement grant set.
    #[serde(default)]
    pub permissions: Vec<String>,
}

/// One registered permission key: the vocabulary the authoring picker
/// offers, read from the same registry enforcement consults.
#[derive(Debug, Serialize)]
pub struct PermissionKeyDto {
    /// The key, e.g. 'sales:void'.
    pub key: String,
    /// Its family, e.g. 'sales'.
    pub family: String,
    /// Whether the key is sensitive — never grantable under a family
    /// wildcard, and blocked for an incomplete profile (ADR #35 D3/D6).
    pub sensitive: bool,
    /// What granting it means, for the picker caption.
    pub description: String,
}

/// Serialize a grant set into the JSON array roles.permissions stores.
fn grants_json(keys: &[String]) -> Result<String, AppError> {
    serde_json::to_string(keys).map_err(|e| AppError::Internal(format!("encoding grants: {e}")))
}

/// Build the authoring DTO from a domain role, adding the two facts the
/// surface needs in order to decide what it may offer.
fn role_dto(store: &Store<'_>, role: Role) -> Result<RoleDto, AppError> {
    // Everything borrowed from `role` is read before its fields move into
    // the DTO; `permission_keys` takes &self and `name`/`description` move.
    let permissions = role.permission_keys();
    let is_builtin = oz_core::db::roles::is_builtin_role_id(&role.id);
    let reference_count = store
        .role_reference_counts(&role.id)?
        .iter()
        .map(|(_, count)| count)
        .sum();
    Ok(RoleDto {
        id: role.id,
        name: role.name,
        description: role.description,
        permissions,
        is_builtin,
        reference_count,
    })
}

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

/// One account that holds a role, as the authoring surface shows it.
///
/// Mirrors `oz_core::db::roles::RoleHolder`. The scope fields are `None`
/// together when the account has no `assignments` row at all — a different
/// fact from "scoped to nothing", which the surface has to render apart.
#[derive(Debug, Serialize)]
pub struct RoleHolderDto {
    /// Account id.
    pub user_id: String,
    /// Login name.
    pub username: String,
    /// Display name shown in the list.
    pub display_name: String,
    /// Whether the account is active. Carried alongside the role because an
    /// inactive account still holds it and still blocks deleting the role.
    pub is_active: bool,
    /// `false` when the account has no `assignments` row and resolves through
    /// `users.role_id`; every scope field below is then `None`.
    pub has_assignment: bool,
    /// `global` or `scoped` (the 0048 branch/workspace dimension).
    pub scope_mode: Option<String>,
    /// The ADR #47 resource axis: `organization`, `legal_entity`, `location`.
    pub scope_type: Option<String>,
    /// The bound resource id; `None` exactly when `scope_type` is
    /// `organization`.
    pub scope_id: Option<String>,
    /// `all` or `list` — read this BEFORE the count. A scoped assignment
    /// with `all` covers every branch and therefore has zero list rows, so a
    /// bare count of 0 means unrestricted, not nothing.
    pub branch_scope: Option<String>,
    /// `all` or `list`, for `workspace_count` — same caveat.
    pub workspace_scope: Option<String>,
    /// Branch ids in scope; `None` when there is no assignment row.
    pub branch_count: Option<i64>,
    /// Workspace keys in scope; `None` when there is no assignment row.
    pub workspace_count: Option<i64>,
}

impl From<oz_core::db::roles::RoleHolder> for RoleHolderDto {
    fn from(h: oz_core::db::roles::RoleHolder) -> Self {
        Self {
            user_id: h.user_id,
            username: h.username,
            display_name: h.display_name,
            is_active: h.is_active,
            has_assignment: h.has_assignment,
            scope_mode: h.scope_mode,
            scope_type: h.scope_type,
            scope_id: h.scope_id,
            branch_scope: h.branch_scope,
            workspace_scope: h.workspace_scope,
            branch_count: h.branch_count,
            workspace_count: h.workspace_count,
        }
    }
}

/// A capped page of holders plus the uncapped total.
#[derive(Debug, Serialize)]
pub struct RoleHoldersDto {
    /// At most `cap` rows, in stable display order.
    pub holders: Vec<RoleHolderDto>,
    /// Every holder, including those past `cap`. `holders.len()` may be
    /// smaller; the difference is what the surface renders as "and N more".
    pub total: i64,
    /// The cap actually applied, so the front end never hardcodes 50 and then
    /// under-reports silently when the ceiling moves.
    pub cap: i64,
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

/// Enforce role-assignment policy (STAFF-02).
///
/// - Only a caller with `staff:manage_roles` (i.e. the Owner preset, which
///   carries `*`) may create or promote an account to the Owner role.
/// - A caller may not change their own role (no self-promotion).
/// - The last active Owner may not be deactivated, demoted, or edited away.
fn enforce_role_assignment_policy(
    store: &Store<'_>,
    caller_user_id: &str,
    target_user_id: Option<&str>,
    target_role_id: &str,
    target_is_active: bool,
) -> Result<(), AppError> {
    // Only Owner-level roles may assign the Owner role.
    if target_role_id == oz_core::builtin_roles::OWNER {
        require_permission_for_user(store, caller_user_id, permissions::STAFF_MANAGE_ROLES)?;
    }

    if let Some(target_id) = target_user_id {
        // No self-promotion / self-deactivation: a user cannot change their
        // own role and cannot deactivate their own account (STAFF-10).
        if target_id == caller_user_id {
            let caller = store
                .get_user(caller_user_id)?
                .ok_or_else(|| AppError::PermissionDenied("user not found".into()))?;
            if caller.role_id != target_role_id {
                return Err(AppError::PermissionDenied(
                    "you cannot change your own role".into(),
                ));
            }
            if !target_is_active {
                return Err(AppError::PermissionDenied(
                    "you cannot deactivate your own account".into(),
                ));
            }
        }

        // Last-owner protection: cannot deactivate/demote the last active Owner.
        if let Some(target) = store.get_user(target_id)?
            && target.role_id == oz_core::builtin_roles::OWNER
            && (target_role_id != oz_core::builtin_roles::OWNER || !target_is_active)
        {
            let active_owners = store
                .list_users()?
                .iter()
                .filter(|u| u.role_id == oz_core::builtin_roles::OWNER && u.is_active)
                .count();
            if active_owners <= 1 {
                return Err(AppError::PermissionDenied(
                    "cannot deactivate or demote the last active Owner".into(),
                ));
            }
        }
    }

    Ok(())
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
    store.enforce_staff_quota(&sub.effective_tier())?;
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

/// Arguments for the `bootstrap_owner` command.
#[derive(Debug, Deserialize)]
/// Bootstrapownerargs.
pub struct BootstrapOwnerArgs {
    /// Username for the first owner account.
    pub username: String,
    /// Plain-text PIN (minimum 4 characters).
    pub pin: String,
    /// Display name for the first owner.
    pub display_name: String,
}

/// Result of a successful owner bootstrap — returns a login session
/// so the front-end can auto-login immediately.
#[derive(Debug, Serialize)]
/// Bootstrapownerresult.
pub struct BootstrapOwnerResult {
    /// LoginSession dto.
    pub session: oz_core::auth::LoginSession,
    /// Short-lived picker ticket (audit-open-findings residual).
    ///
    /// The pre-session `list_workspaces` / `list_workspace_screens`
    /// commands verify this ticket and resolve the caller's REAL role
    /// from the database — caller-supplied `role_id` / `user_id` are
    /// never trusted for the workspace picker.
    pub picker_ticket: String,
}

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
