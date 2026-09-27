//! Staff IPC wire types: the request args and response DTOs for the staff,
//! role, bootstrap-owner and trash commands.
//!
//! Split out of `staff.rs` on 2026-09-27 because the type declarations alone
//! were 522 of its lines while carrying no logic - the command bodies that
//! consume them stayed put and import from here. Tauri renames command
//! ARGUMENTS to camelCase, so the `*Args` structs carry `rename_all`; the
//! response DTOs serialize with their own serde derives, which is why the two
//! groups look different.

use serde::{Deserialize, Serialize};

use kasirmu_core::db::profile::UserProfile;

/// A user single effective assignment as seen by the front-end (ADR #35
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
    /// Avatar reference — the content-addressed image hash, or null for none.
    /// `list_staff_scoped` already loads every member's profile, and `avatar`
    /// is not a sensitive column, so this needs no `staff:read_*` grant.
    pub avatar: Option<String>,
    /// Phone in E.164 form, or null when the member has none on file. Not a
    /// withheld field: `get_staff_profile_scoped` already returns it to any
    /// `staff:read` caller, so listing it widens no access.
    pub phone: Option<String>,
    /// When the member entered the trash, or null on the live roster.
    ///
    /// Set only by the trash read: the live paths build this DTO through
    /// `to_staff_dto`, which leaves it null, so "has a deleted_at" is exactly
    /// "this row came from the trash" without a second flag to keep in step.
    pub deleted_at: Option<String>,
    /// ID of the associated role.
    pub role_id: String,
    /// Role Name.
    pub role_name: String,
    /// Whether this is active.
    pub is_active: bool,
    /// National id rendered last-4 masked (ADR #35 D6: the full value never
    /// renders without `staff:read_identity`; the list only shows the mask).
    pub national_id_masked: String,
    /// Whether all 8 required profile fields are present — incomplete users
    /// are flagged and management-role assignment is gated on this.
    pub is_profile_complete: bool,
    /// The user single effective assignment (ADR #35 D5 / spec 0048).
    pub assignment: AssignmentDto,
    /// When the staff account was created, or None when unknown/unset.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
}

/// The 17 profile fields carried by the staff create/edit IPC args (ADR #35
/// D6 / spec 0049). All optional on the wire — creation-time mandatory-ness
/// is enforced by `create_user_with_profile` with field-specific errors, and
/// the form blocks submission before the command is ever called.
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

/// A staff profile as seen by the caller (ADR #35 D6): full sensitive
/// values only when the explicit grants are held, national id always
/// last-4 masked, reads audited by kasirmu-core.
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
    /// True when `national_id` and `tax_id` are absent because the caller does
    /// NOT hold `staff:read_identity` — withheld, rather than unset.
    ///
    /// The edit form needs this to tell "no document on file" from "a document
    /// you may not see": it must not demand the field (which forces the editor
    /// to invent a value for something they cannot read) and must not offer an
    /// empty box that would blank the stored one. Consumers that only display
    /// the profile can ignore it.
    pub identity_withheld: bool,
}

impl From<kasirmu_core::db::profile::ProfileView> for ProfileViewDto {
    fn from(view: kasirmu_core::db::profile::ProfileView) -> Self {
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
            identity_withheld: view.identity_withheld,
        }
    }
}

/// Roledto.
#[derive(Debug, Serialize)]
pub struct RoleDto {
    /// Unique identifier.
    pub id: String,
    /// Display name.
    pub name: String,
    /// Human-readable description.
    pub description: String,
    /// Granted permission keys, verbatim from the role permissions JSON
    /// (may include `"*"`). Shown in the staff screen so an admin can see
    /// exactly what each role can do.
    pub permissions: Vec<String>,
    /// Set only when the row is in the trash: the RFC-3339 instant the role was
    /// soft-deleted, or `None` for a live role. The trash tab renders the
    /// days remaining before the purge sweep deletes the row for good.
    pub deleted_at: Option<String>,
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
    ///
    /// This is FOREIGN-KEY truth and the only field that may gate deletion.
    /// It is NOT a count of accounts and must never be labelled as one —
    /// `holder_count` is that number, and it is not derivable from this one.
    pub reference_count: i64,
    /// Accounts that resolve to this role: the only value that may be
    /// worded as "used by N accounts". From `Store::role_holder_count`, i.e.
    /// the same predicate authorization uses. NOT a sum of referrer rows:
    /// `create_user` writes a `users` row AND an `assignments` row for one
    /// person, so the sum counts every ordinary account twice.
    pub holder_count: i64,
    /// Non-account references — `role_workspace_types` and `role_workspaces`
    /// rows, i.e. workspace configuration pointing at this role. A grant
    /// blocks a delete just as a holder does, yet no account holds anything
    /// through it, so it is reported apart rather than added to a count of
    /// people.
    pub grant_count: i64,
}

/// Createstaffargs.
#[derive(Debug, Deserialize)]
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

/// Updatestaffargs.
#[derive(Debug, Deserialize)]
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

/// Arguments for creating a staff member from a session token.
///
/// Deliberately carries NO caller identity field — the caller is resolved
/// from the session token by the command.
#[derive(Debug, Deserialize)]
pub struct CreateStaffScopedArgs {
    /// Username.
    pub username: String,
    /// Pin.
    pub pin: String,
    /// Display Name.
    pub display_name: String,
    /// ID of the associated role.
    pub role_id: String,
    /// ADR #35 D6 profile fields — creation requires the 9 mandatory fields
    /// (validated by `create_user_with_profile`).
    pub profile: ProfileArgs,
    /// Optional assignment scope (spec 0048). When `Some`, the user is
    /// created with this scope instead of the default global all/all.
    #[serde(default)]
    pub assignment: Option<AssignmentArgs>,
}

/// Arguments for updating a staff member from a session token.
///
/// Deliberately carries NO caller identity field — the caller is resolved
/// from the session token by the command.
#[derive(Debug, Deserialize)]
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

/// Create-role args. Deliberately carries no id; see [`create_role_scoped`].
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

/// One account that holds a role, as the authoring surface shows it.
///
/// Mirrors `kasirmu_core::db::roles::RoleHolder`. The scope fields are `None`
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

impl From<kasirmu_core::db::roles::RoleHolder> for RoleHolderDto {
    fn from(h: kasirmu_core::db::roles::RoleHolder) -> Self {
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

/// Bootstrapownerargs.
#[derive(Debug, Deserialize)]
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
pub struct BootstrapOwnerResult {
    /// LoginSession dto.
    pub session: kasirmu_core::auth::LoginSession,
    /// Short-lived picker ticket (audit-open-findings residual).
    ///
    /// The pre-session `list_workspaces` / `list_workspace_screens`
    /// commands verify this ticket and resolve the caller REAL role
    /// from the database — caller-supplied `role_id` / `user_id` are
    /// never trusted for the workspace picker.
    pub picker_ticket: String,
}
