//! Tauri commands for workspace listing, navigation screens, and
//! per-user workspace assignment (admin feature).
//!
//! ADR #4 Phase 1: Now returns `WorkspaceDto` with instance-aware fields
//! and supports instance CRUD.
//!
//! ADR #7: Session-scoped commands are used for authenticated operations.
//! Only the pre-session workspace picker retains narrowly scoped discovery
//! commands; legacy mutation and user-targeted assignment commands are not
//! registered with Tauri.
//!
//! Wave E / E2: the bodies now live in the headless `oz_bridge::workspaces`
//! module. Each `#[tauri::command]` below keeps its exact name, parameter
//! list, attributes and `Result<_, AppError>` wire contract; it builds a
//! `BridgeCtx` from `AppState` and delegates. The session-scoped gates run
//! inside the bridge against the global identity DB, in the same order as
//! before. The DTOs moved with the bodies and are re-exported so
//! `use super::*` in `workspaces_tests.rs` still resolves them; the
//! `remediation_target` validator stays as an AppError adapter for the same
//! tests.

#[allow(unused_imports)] // sibling workspaces_tests.rs depends on it
use oz_core::db::Store;
use oz_core::db::workspaces::WorkspaceDto;

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

pub use oz_bridge::workspaces::{
    BootResolution, CreateInstanceRequest, WorkspaceScreenDto, WorkspaceTypeDto,
};

/// Resolve which store a §J quota-remediation command will act on.
///
/// Desktop adapter: `workspaces_tests.rs` calls this validator directly;
/// the behaviour lives in `oz_bridge::workspaces::remediation_target`.
#[allow(dead_code)] // retained for workspaces_tests.rs, which calls it directly
fn remediation_target(
    global: &rusqlite::Connection,
    session_store_id: &str,
    requested: Option<String>,
) -> Result<String, AppError> {
    oz_bridge::workspaces::remediation_target(global, session_store_id, requested)
        .map_err(AppError::from)
}

/// List workspace instances for the pre-session workspace picker.
///
/// The caller presents the picker ticket minted by `staff_login`; the REAL
/// user is resolved from the global identity database and the REAL role is
/// used for the listing. The requested store is opened through
/// `StoreDatabaseManager` so this read cannot accidentally query the
/// global identity database or another store's connection.
#[tauri::command]
pub async fn list_workspaces(
    state: State<'_, AppState>,
    ticket: String,
    store_id: String,
) -> Result<Vec<WorkspaceDto>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::workspaces::list_workspaces(&ctx, ticket, store_id)
        .await
        .map_err(Into::into)
}

/// List screens (nav items) for a workspace type during boot/workspace
/// selection. The store ID is explicit so the read is routed to the correct
/// store database.
#[tauri::command]
pub async fn list_workspace_screens(
    state: State<'_, AppState>,
    ticket: String,
    type_key: String,
    store_id: String,
) -> Result<Vec<WorkspaceScreenDto>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::workspaces::list_workspace_screens(&ctx, ticket, type_key, store_id)
        .await
        .map_err(Into::into)
}

/// List workspace instances accessible to the session user within their store. ADR #7.
///
/// ADR #5: Filters results by subscription tier entitlement.
#[tauri::command]
pub async fn list_workspaces_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<WorkspaceDto>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::workspaces::list_workspaces_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Get a single workspace instance. `is_default` reflects the session user. ADR #7.
#[tauri::command]
pub async fn get_workspace_instance_scoped(
    session_token: String,
    instance_id: String,
    state: State<'_, AppState>,
) -> Result<WorkspaceDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::workspaces::get_workspace_instance_scoped(&ctx, &session_token, instance_id)
        .await
        .map_err(Into::into)
}

/// Create a new workspace instance (admin). Permission from session. ADR #7.
///
/// ADR #5: Enforces subscription tier quota before creating.
#[tauri::command]
pub async fn create_workspace_instance_scoped(
    session_token: String,
    req: CreateInstanceRequest,
    state: State<'_, AppState>,
) -> Result<WorkspaceDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::workspaces::create_workspace_instance_scoped(&ctx, &session_token, req)
        .await
        .map_err(Into::into)
}

/// Update the editable fields of a workspace instance (admin). ADR #7.
///
/// Renames the instance and updates its description / accent colour.
/// The `type_key` and `store_id` are immutable and cannot be changed.
/// Requires `STAFF_UPDATE` permission from the session user.
#[tauri::command]
pub async fn update_workspace_instance_scoped(
    session_token: String,
    instance_id: String,
    name: String,
    description: Option<String>,
    colour: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::workspaces::update_workspace_instance_scoped(
        &ctx,
        &session_token,
        instance_id,
        name,
        description,
        colour,
    )
    .await
    .map_err(Into::into)
}

/// Archive (soft-delete) a workspace instance (admin). ADR #7.
///
/// Sets the instance status to `archived`, preserving referential
/// integrity with historical sales. Requires `STAFF_UPDATE` permission.
#[tauri::command]
pub async fn archive_workspace_instance_scoped(
    session_token: String,
    instance_id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::workspaces::archive_workspace_instance_scoped(&ctx, &session_token, instance_id)
        .await
        .map_err(Into::into)
}

/// Recover `QuotaSuspended` workspace instances after a tier upgrade. ADR #5 Phase 3b.
///
/// Iterates the target store's database, restores suspended instances up to
/// the tier's per-store register limit, and returns the count of restored instances.
#[tauri::command]
pub async fn recover_workspace_instances_scoped(
    session_token: String,
    store_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<u32, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::workspaces::recover_workspace_instances_scoped(&ctx, &session_token, store_id)
        .await
        .map_err(Into::into)
}

/// Suspend surplus workspace instances after a tier downgrade. ADR #5 Phase 3c.
///
/// If the store has more active instances than the tier allows, the
/// least-recently-used instances are transitioned to `QuotaSuspended`.
/// Returns the count of suspended instances.
#[tauri::command]
pub async fn suspend_surplus_workspace_instances_scoped(
    session_token: String,
    store_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<u32, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::workspaces::suspend_surplus_workspace_instances_scoped(
        &ctx,
        &session_token,
        store_id,
    )
    .await
    .map_err(Into::into)
}

/// List screens for a workspace type from the store-scoped database. ADR #7.
#[tauri::command]
pub async fn list_workspace_screens_scoped(
    session_token: String,
    type_key: String,
    state: State<'_, AppState>,
) -> Result<Vec<WorkspaceScreenDto>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::workspaces::list_workspace_screens_scoped(&ctx, &session_token, type_key)
        .await
        .map_err(Into::into)
}

/// Replace all instance assignments for a user. Caller permission from session. ADR #7.
#[tauri::command]
pub async fn set_user_workspace_instances_scoped(
    session_token: String,
    user_id: String,
    instance_ids: Vec<String>,
    default_instance_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::workspaces::set_user_workspace_instances_scoped(
        &ctx,
        &session_token,
        user_id,
        instance_ids,
        default_instance_id,
    )
    .await
    .map_err(Into::into)
}

/// Get instance IDs assigned to a user. Permission check from session. ADR #7.
#[tauri::command]
pub async fn get_user_workspace_instances_scoped(
    session_token: String,
    user_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<String>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::workspaces::get_user_workspace_instances_scoped(&ctx, &session_token, user_id)
        .await
        .map_err(Into::into)
}

/// List workspace instances in an explicitly named store for the session user.
///
/// Authenticated replacement for the terminal-management screen's use of the
/// pre-session picker command (which hardcoded `role-owner`). The session
/// token binds the caller; the requested store is opened through
/// `StoreDatabaseManager` and `list_workspaces` still enforces the caller's
/// store access, so a session can only enumerate stores it may see.
#[tauri::command]
pub async fn list_workspaces_for_store_scoped(
    session_token: String,
    store_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<WorkspaceDto>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::workspaces::list_workspaces_for_store_scoped(&ctx, &session_token, store_id)
        .await
        .map_err(Into::into)
}

/// List all workspace types resolved from a session token. ADR #7.
#[tauri::command]
pub async fn list_all_workspaces_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<WorkspaceTypeDto>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::workspaces::list_all_workspaces_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Replace all instance assignments for a user through the session-scoped API.
///
/// The former unscoped command accepted a forgeable `caller_user_id` and is
/// intentionally retained only as a non-callable Rust symbol for source
/// compatibility. It is not registered with Tauri; callers must use
/// `set_user_workspace_instances_scoped`.
#[allow(dead_code)]
pub async fn set_user_workspace_instances(
    _state: State<'_, AppState>,
    _user_id: String,
    _instance_ids: Vec<String>,
    _default_instance_id: Option<String>,
    _caller_user_id: String,
) -> Result<(), AppError> {
    Err(AppError::PermissionDenied(
        "legacy unscoped workspace commands are disabled; use set_user_workspace_instances_scoped"
            .into(),
    ))
}

/// Get instance IDs through the session-scoped API.
///
/// The former unscoped command is not registered with Tauri because it had no
/// authenticated caller context. Callers must use
/// `get_user_workspace_instances_scoped`.
#[allow(dead_code)]
pub async fn get_user_workspace_instances(
    _state: State<'_, AppState>,
    _user_id: String,
) -> Result<Vec<String>, AppError> {
    Err(AppError::PermissionDenied(
        "legacy unscoped workspace commands are disabled; use get_user_workspace_instances_scoped"
            .into(),
    ))
}

/// Resolve the active store and instance from device binding.
///
/// This is called once at boot time (before authentication). It does not use
/// a session token because no user is logged in yet.
#[tauri::command]
pub async fn resolve_boot_store(
    state: State<'_, AppState>,
    device_id: Option<String>,
) -> Result<BootResolution, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::workspaces::resolve_boot_store(&ctx, device_id)
        .await
        .map_err(Into::into)
}
