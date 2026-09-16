/*
last audited 31-08-26 by RSA-Agent (user-role campaign, Section D)
crate: oz-pos-app | status: SAFE | lint: CLEAN
findings: staff IPC surface fail-closed end-to-end — legacy unscoped commands (list_staff/create_staff/update_staff/list_roles) are permission-denied tombstones (ADR #7); every scoped command gates (STAFF_READ reads, STAFF_CREATE + C1.1 tier limit on create, STAFF_UPDATE on update, STAFF_READ on role list); enforce_role_assignment_policy (STAFF-02/10) identical across shells: Owner-role assignment needs staff:manage_roles, no self-promotion, last-active-owner lock; bootstrap_owner is the only ungated command (first-run bootstrap by design) | REV 2026-09-16 (DSH agents-3, IPC-parity): all four unscoped names in that parenthetical are GONE from this file, not merely denied. list_staff had already gone; create_staff, update_staff and list_roles were retired here after the parity leg showed each registered in neither shell, unnamed by any UI code and uncalled by production Rust, with no test and no ledger row naming them. Each body was Err(PermissionDenied("legacy unscoped staff commands are disabled; use X_scoped")) - a refusal behind a door that generate_handler! never opened, so deleting it removes no reachable behaviour and no coverage. The scoped trio (list_staff_scoped at STAFF_READ, create_staff_scoped at STAFF_CREATE + C1.1, update_staff_scoped at STAFF_UPDATE) and bootstrap_owner are untouched, and the STAFF-02/10 role-assignment policy they share is unchanged. The sentence above stands as the 31-08-26 reading it was.
next: STAFF_DELETE has no desktop/tablet IPC consumer (registered + sensitive; deactivation rides STAFF_UPDATE) — confirm the cloud/CLI consumer in Section G | perf: fine
*/
//! Staff management commands — list, create, update staff members and roles.
//!
//! These commands are the IPC surface for the Staff Management UI.
//!
//! Wave B / B5: the bodies now live in the headless `oz_bridge::staff` module.
//! Every `#[tauri::command]` below keeps its exact name, parameter list,
//! attributes and `Result<_, AppError>` wire contract; it builds a
//! [`crate::state::AppState::bridge_ctx`] and delegates one call. The three
//! legacy unscoped tombstones keep their inline denial (there is no business
//! logic in them to move), while `run_bootstrap_owner` and `role_dto` stay as
//! `AppError` adapters because the sibling test modules call them directly.
//! The global-identity gates, the role-assignment policy (STAFF-02/10), the
//! C1.1 staff quota, the STAFF-05 transaction, the security-event writes and
//! the STAFF-03 session sweep all run inside the bridge, in the same order.

use tauri::State;

use oz_core::db::Store;
// Retained for the sibling test modules, which reach these through their
// `use super::*`; the shims no longer name them.
#[allow(unused_imports)]
use oz_core::db::assignments::{Assignment, ScopeMode, ScopeType};
#[allow(unused_imports)]
use oz_core::{Role, User};

use crate::error::AppError;
use crate::state::AppState;

// The picker-ticket module is still named by the sibling tests; the signing
// itself moved to `oz_bridge::picker` and is reached through the context.
#[allow(unused_imports)]
use crate::commands::picker_ticket;

pub use oz_bridge::staff::{
    AssignmentArgs, AssignmentDto, BootstrapOwnerArgs, BootstrapOwnerResult, CreateRoleArgs,
    CreateStaffArgs, CreateStaffScopedArgs, PermissionKeyDto, ProfileArgs, ProfileViewDto, RoleDto,
    RoleHolderDto, RoleHoldersDto, StaffMemberDto, UpdateRoleArgs, UpdateStaffArgs,
    UpdateStaffScopedArgs, assignment_dto, assignment_spec, enforce_role_assignment_policy,
    parse_scope_mode, to_staff_dto,
};

/// Serialize a grant set into the JSON array roles.permissions stores.
///
/// Stays in the shell and is passed into the bridge as a `&str`: encoding needs
/// `serde_json`, which is not an `oz-bridge` dependency. The encoder cannot fail
/// for a `Vec<String>`, so running it before the session gate moves no observable
/// order.
fn grants_json(keys: &[String]) -> Result<String, AppError> {
    serde_json::to_string(keys).map_err(|e| AppError::Internal(format!("encoding grants: {e}")))
}

/// Build the authoring DTO from a domain role, adding the two facts the
/// surface needs in order to decide what it may offer.
///
/// Thin adapter over `oz_bridge::staff::role_dto`: same name, parameters and
/// `Result<_, AppError>` so the sibling test modules keep building DTOs from a
/// shell-held `Store`.
#[allow(dead_code)] // retained by the Wave-B extraction contract for sibling tests
fn role_dto(store: &Store<'_>, role: Role) -> Result<RoleDto, AppError> {
    oz_bridge::staff::role_dto(store, role).map_err(AppError::from)
}

// ── List roles ─────────────────────────────────────────────────────

// ── Create staff member ────────────────────────────────────────────

// ── Update staff member ────────────────────────────────────────────

// ── Session-scoped staff commands (ADR #7 · audit-open-findings STAFF-01) ────────

/// List staff members. Caller identity is resolved from the session token.
#[tauri::command]
pub async fn list_staff_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<StaffMemberDto>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::staff::list_staff_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Load a staff member full profile as the session user sees it (ADR #35
/// D6). Sensitive fields are withheld or masked unless the caller holds
/// `staff:read_identity` / `staff:read_payroll`, and every sensitive read is
/// audited — see [`Store`].
#[tauri::command]
pub async fn get_staff_profile_scoped(
    session_token: String,
    user_id: String,
    state: State<'_, AppState>,
) -> Result<ProfileViewDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::staff::get_staff_profile_scoped(&ctx, &session_token, &user_id)
        .await
        .map_err(Into::into)
}

/// List roles. Caller identity is resolved from the session token.
#[tauri::command]
pub async fn list_roles_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<RoleDto>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::staff::list_roles_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

// ── Role authoring (ADR #47 ruling 4) ──────────────────────────────

/// List the registered permission keys.
#[tauri::command]
pub async fn list_permission_keys_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<PermissionKeyDto>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::staff::list_permission_keys_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Create a custom role: a named key-set row in the same vocabulary
/// enforcement already speaks (ADR #47 ruling 4).
#[tauri::command]
pub async fn create_role_scoped(
    session_token: String,
    args: CreateRoleArgs,
    state: State<'_, AppState>,
) -> Result<RoleDto, AppError> {
    let grants = grants_json(&args.permissions)?;
    let ctx = state.bridge_ctx();
    oz_bridge::staff::create_role_scoped(&ctx, &session_token, &args, &grants)
        .await
        .map_err(Into::into)
}

/// Re-name, re-describe, or re-grant an authored role.
#[tauri::command]
pub async fn update_role_scoped(
    session_token: String,
    args: UpdateRoleArgs,
    state: State<'_, AppState>,
) -> Result<RoleDto, AppError> {
    let grants = grants_json(&args.permissions)?;
    let ctx = state.bridge_ctx();
    oz_bridge::staff::update_role_scoped(&ctx, &session_token, &args, &grants)
        .await
        .map_err(Into::into)
}

/// Delete an authored role.
#[tauri::command]
pub async fn delete_role_scoped(
    id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::staff::delete_role_scoped(&ctx, &id, &session_token)
        .await
        .map_err(Into::into)
}

/// List the accounts that hold one role, org-wide.
#[tauri::command]
pub async fn list_role_holders_scoped(
    id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<RoleHoldersDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::staff::list_role_holders_scoped(&ctx, &id, &session_token)
        .await
        .map_err(Into::into)
}

/// Create a staff member. Caller identity is resolved from the session token.
///
/// STAFF-02: enforces the role-assignment hierarchy (only Owner-level
/// callers may create an Owner account).
#[tauri::command]
pub async fn create_staff_scoped(
    session_token: String,
    args: CreateStaffScopedArgs,
    state: State<'_, AppState>,
) -> Result<StaffMemberDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::staff::create_staff_scoped(&ctx, &session_token, &args)
        .await
        .map_err(Into::into)
}

/// Update a staff member. Caller identity is resolved from the session token.
#[tauri::command]
pub async fn update_staff_scoped(
    session_token: String,
    args: UpdateStaffScopedArgs,
    state: State<'_, AppState>,
) -> Result<StaffMemberDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::staff::update_staff_scoped(&ctx, &session_token, &args)
        .await
        .map_err(Into::into)
}

// ── Bootstrap first owner (no authentication required) ────────────────

/// Business logic for [`bootstrap_owner`] (extracted for testing).
#[allow(dead_code)] // retained by the Wave-B extraction contract for sibling tests
fn run_bootstrap_owner(
    conn: &rusqlite::Connection,
    args: &BootstrapOwnerArgs,
) -> Result<BootstrapOwnerResult, AppError> {
    oz_bridge::staff::run_bootstrap_owner(conn, args).map_err(AppError::from)
}

/// Create the first owner user in a fresh installation.
#[tauri::command]
pub async fn bootstrap_owner(
    args: BootstrapOwnerArgs,
    state: State<'_, AppState>,
) -> Result<BootstrapOwnerResult, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::staff::bootstrap_owner(&ctx, &args)
        .await
        .map_err(Into::into)
}
