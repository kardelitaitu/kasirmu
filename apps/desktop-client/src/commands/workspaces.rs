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

use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::State;

use hmac::{Hmac, Mac};
use sha2::Sha256;

use oz_core::db::Store;
use oz_core::db::workspaces::{CreateWorkspaceInstanceArgs, WorkspaceDto};
use oz_core::permissions;
use oz_core::session::SessionContext;
use oz_core::subscription::TenantSubscription;

use crate::commands::authz::require_permission_for_session;
use crate::commands::picker_ticket;
use crate::error::AppError;
use crate::state::AppState;

type HmacSha256 = Hmac<Sha256>;

/// Legacy workspace DTO (pre-ADR #4).
///
/// Kept for the session-scoped workspace-type listing command. New code
/// should use `WorkspaceDto` from `oz_core::db::workspaces` when it needs
/// instance-aware data.
#[derive(Debug, Serialize)]
#[allow(dead_code)]
pub struct WorkspaceTypeDto {
    /// Key.
    pub key: String,
    /// Display name.
    pub name: String,
    /// Human-readable description.
    pub description: String,
    /// Icon.
    pub icon: String,
}

/// Screen within a workspace as seen by the front-end.
#[derive(Debug, Serialize)]
pub struct WorkspaceScreenDto {
    /// Screen Key.
    pub screen_key: String,
    /// Display sort order.
    pub sort_order: i32,
}

/// Request body for creating a workspace instance.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CreateInstanceRequest {
    /// Unique identifier.
    pub id: String,
    /// Type Key.
    pub type_key: String,
    /// ID of the associated store.
    pub store_id: String,
    /// Display name.
    pub name: String,
    /// Controlled business purpose, independent from the technical type and label.
    #[serde(default)]
    pub purpose_key: Option<String>,
    /// Human-readable description.
    pub description: Option<String>,
    /// Colour.
    pub colour: Option<String>,
}

// ── Pre-session Picker Commands (audit-open-findings residual) ────
// The workspace picker (shown right after login, before a session token
// exists) calls `list_workspaces` / `list_workspace_screens` with the
// short-lived picker ticket minted by `staff_login`. These verify the
// ticket and resolve the REAL user + role from the global identity DB —
// caller-supplied `role_id` / `user_id` are never trusted.

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
    // 1. Verify the ticket — uniform denial for forged/expired/malformed.
    let now_ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let user_id = picker_ticket::verify_picker_ticket(&state.picker_ticket_secret, &ticket, now_ts)
        .ok_or_else(|| AppError::PermissionDenied("invalid or expired picker session".into()))?;

    // 2. Resolve the REAL user + role + assignment from the global identity
    //    DB. The ticket binds the user; the role is derived from the DB,
    //    never the claim. The assignment (ADR #35 D5 / spec 0048) is what
    //    constrains a scoped user's picker below.
    let (real_role_id, real_user_id, assignment) = {
        let db = state.db.lock().await;
        let store = Store::new(&db);
        let user = store.get_user(&user_id)?.ok_or_else(|| {
            AppError::PermissionDenied("picker session user no longer exists".into())
        })?;
        if !user.is_active {
            return Err(AppError::PermissionDenied(
                "picker session user is inactive".into(),
            ));
        }
        let role = store
            .get_role(&user.role_id)?
            .ok_or_else(|| AppError::Internal(format!("role {} not found", user.role_id)))?;
        let assignment = store.assignment_for_user(&user.id)?;
        (role.id, user.id, assignment)
    };

    // 3. List instances in the requested store using the REAL role + user.
    let conn = state
        .db_manager
        .open_store(&store_id)
        .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let rows = store.list_workspaces(&real_role_id, Some(&real_user_id), &store_id)?;
    drop(db);

    // 4. Scope-filter the listing through the user's assignment (ADR #35 D5
    //    / spec 0048): global assignments and legacy users pass everything;
    //    a scoped assignment keeps only in-scope store + workspace type.
    Ok(match assignment {
        Some(assignment) => rows
            .into_iter()
            .filter(|d| assignment.matches_scope(Some(&store_id), Some(&d.type_key)))
            .collect(),
        None => rows,
    })
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
    let now_ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    picker_ticket::verify_picker_ticket(&state.picker_ticket_secret, &ticket, now_ts)
        .ok_or_else(|| AppError::PermissionDenied("invalid or expired picker session".into()))?;
    let conn = state
        .db_manager
        .open_store(&store_id)
        .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let rows = store.list_workspace_type_screens(&type_key)?;
    drop(db);
    Ok(rows
        .into_iter()
        .map(|r| WorkspaceScreenDto {
            screen_key: r.screen_key,
            sort_order: r.sort_order,
        })
        .collect())
}

// ── Scoped Commands (ADR #7) ────────────────────────────────────────

/// List workspace instances accessible to the session user within their store. ADR #7.
///
/// ADR #5: Filters results by subscription tier entitlement.
#[tauri::command]
pub async fn list_workspaces_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<WorkspaceDto>, AppError> {
    let session = state.resolve_session(&session_token)?; // ADR #5: Load subscription from global DB for entitlement filtering.
    // Also validates the system clock has not been rolled back. The user's
    // assignment (ADR #35 D5 / spec 0048) rides the same global-DB lock so
    // the listing below can scope-filter post-login switches. The FULL
    // subscription (not just its tier) is kept so entitlement filtering
    // honors the signed payload's allowed_types_json — a Plus +
    // restaurant_starter bundle lists kds even though the Plus tier
    // statically excludes it (C3.2).
    let (sub, assignment) = {
        let global_db = state.db.lock().await;
        TenantSubscription::validate_clock_rollback(&global_db)?;
        let sub = TenantSubscription::load(&global_db, "default")?.unwrap_or_else(|| {
            tracing::warn!("no subscription found for tenant 'default', defaulting to Free tier");
            TenantSubscription::bootstrap_free()
        });
        // Verify the RSA signature before honoring the row's tier/allowed-
        // types — a tampered row (forged tier, invalid signature) must fail
        // closed, matching create_session (round 6) and the other 13
        // subscription-trusting call sites.
        sub.verify_signature()?;
        let assignment = Store::new(&global_db).assignment_for_user(&session.user_id)?;
        (sub, assignment)
    };
    let conn = state
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let rows = store.list_workspaces_with_entitlement(
        &session.role_id,
        Some(&session.user_id),
        &session.store_id,
        &sub,
    )?;
    drop(db);
    // Scope-filter through the user's assignment (scoped-sessions follow-up):
    // global assignments and legacy users (no assignment) pass everything; a
    // scoped assignment keeps only instances whose store (branch) and
    // workspace type are in scope — fail closed, so a scoped member cannot
    // switch into an out-of-scope workspace type after login.
    Ok(match assignment {
        Some(assignment) => rows
            .into_iter()
            .filter(|d| assignment.matches_scope(Some(&session.store_id), Some(&d.type_key)))
            .collect(),
        None => rows,
    })
}

/// Get a single workspace instance. `is_default` reflects the session user. ADR #7.
#[tauri::command]
pub async fn get_workspace_instance_scoped(
    session_token: String,
    instance_id: String,
    state: State<'_, AppState>,
) -> Result<WorkspaceDto, AppError> {
    let session = state.resolve_session(&session_token)?;
    let conn = state
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let dto = store.get_workspace_instance(&instance_id, Some(&session.user_id))?;
    drop(db);
    Ok(dto)
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
    let session = state.resolve_session(&session_token)?;
    // Authorization: the session user's identity + role live in the GLOBAL
    // identity DB — the store DB has an empty `users` table by design, so
    // every scoped command authorizes against the global DB before touching
    // the store connection.
    require_permission_for_session(&state, &session, permissions::STAFF_UPDATE).await?;

    // ADR #5: Load subscription from the GLOBAL database first.
    // Also validates the system clock has not been rolled back.
    // This must happen before opening the store DB to avoid holding
    // a std::sync::MutexGuard across an .await boundary.
    let sub = {
        let global_db = state.db.lock().await;
        TenantSubscription::validate_clock_rollback(&global_db)?;
        TenantSubscription::load(&global_db, "default")?
            .ok_or_else(|| AppError::Internal("default tenant subscription not found".into()))?
    };
    sub.verify_signature()?;

    let conn = state
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    // The signed payload's allowed_types_json is the workspace-type
    // entitlement source (C3.2: Plus + restaurant_starter lists kds); the
    // register-count limit still comes from the effective tier inside.
    store.enforce_instance_quota(&sub, &req.type_key, &req.store_id)?;
    let _row = store.create_workspace_instance_with_purpose(CreateWorkspaceInstanceArgs {
        id: req.id.clone(),
        type_key: req.type_key.clone(),
        store_id: req.store_id.clone(),
        name: req.name.clone(),
        description: req.description.clone().unwrap_or_default(),
        colour: req.colour.clone(),
        purpose_key: req
            .purpose_key
            .clone()
            .unwrap_or_else(|| "general".to_string()),
    })?;
    let dto = store.get_workspace_instance(&req.id, Some(&session.user_id))?;
    drop(db);
    tracing::info!(
        instance_id = %req.id,
        type_key = %req.type_key,
        store_id = %req.store_id,
        "workspace instance created (scoped)"
    );
    Ok(dto)
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
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::STAFF_UPDATE).await?;
    let conn = state
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    store.update_workspace_instance(
        &instance_id,
        &name,
        description.as_deref(),
        colour.as_deref(),
    )?;
    drop(db);
    tracing::info!(instance_id = %instance_id, "workspace instance updated (scoped)");
    Ok(())
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
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::STAFF_UPDATE).await?;
    let conn = state
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    store.archive_instance(&instance_id)?;
    drop(db);
    tracing::info!(instance_id = %instance_id, "workspace instance archived (scoped)");
    Ok(())
}

/// Resolve which store a §J quota-remediation command will act on.
///
/// `None` keeps the historical behaviour: the caller's own store, taken from the
/// session. `Some(id)` lets the owner-facing tenant-level over-quota card remediate
/// a location the caller is not currently signed in to, which is the case the
/// remediation exists for — an owner with 3 surplus registers in store B while
/// signed in to store A.
///
/// The id is validated against the tenant's `locations` table BEFORE any store
/// database is opened. `DbManager::open_store` creates the file when it is missing
/// (platform/core/src/database/manager.rs:70), so an unvalidated id would silently
/// mint a fresh store database, find nothing to remediate there, and return a
/// successful `0`. For a quota repair that is the worst available failure shape:
/// it looks finished. `resolve_session`/`open_store` are also never given a
/// caller-supplied id anywhere else, so this stays the single choke point.
fn remediation_target(
    global: &rusqlite::Connection,
    session_store_id: &str,
    requested: Option<String>,
) -> Result<String, AppError> {
    let Some(raw) = requested else {
        return Ok(session_store_id.to_string());
    };
    // Trimmed before it is used anywhere: this value goes on to name a database
    // file through open_store, so a padded id must not become a second, distinct
    // store that merely looks like the first.
    let id = raw.trim();
    if id.is_empty() {
        return Err(AppError::Invalid(
            "store_id must not be blank; omit it to target the caller's own store".into(),
        ));
    }
    if Store::new(global).get_location_profile(id)?.is_none() {
        return Err(AppError::Invalid(format!("unknown store: {id}")));
    }
    Ok(id.to_string())
}

/// Async shell around [`remediation_target`]: takes the global lock and
/// forwards. Split out so the validation is reachable from a plain #[test],
/// following the `load_over_quota_report` precedent in commands/subscription.rs.
async fn resolve_remediation_target(
    state: &State<'_, AppState>,
    session: &SessionContext,
    store_id: Option<String>,
) -> Result<String, AppError> {
    let global_db = state.db.lock().await;
    remediation_target(&global_db, &session.store_id, store_id)
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
    // F-017: enforce per-domain permission on this scoped command.
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::WORKSPACES_SWITCH).await?;
    // §J B1: an explicit target is owner-level and cross-store, so it is validated
    // against `locations` before the store db is opened. The gate stays
    // WORKSPACES_SWITCH either way — the permission is what a caller may do, the
    // validated id only says which store they may do it to.
    let target = resolve_remediation_target(&state, &session, store_id).await?;

    // Load subscription from the GLOBAL database.
    let sub = {
        let global_db = state.db.lock().await;
        TenantSubscription::validate_clock_rollback(&global_db)?;
        TenantSubscription::load(&global_db, "default")?
            .ok_or_else(|| AppError::Internal("default tenant subscription not found".into()))?
    };
    sub.verify_signature()?;

    let conn = state
        .db_manager
        .open_store(&target)
        .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let effective = sub.effective_tier();
    let restored = store.auto_recover_instances(&target, &effective)?;
    drop(db);
    tracing::info!(
        store_id = %target,
        caller_store = %session.store_id,
        restored = %restored,
        tier = %effective.name(),
        "workspace instances recovered after tier upgrade"
    );
    Ok(restored as u32)
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
    // F-017: enforce per-domain permission on this scoped command.
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::WORKSPACES_SWITCH).await?;
    // §J B1: see `resolve_remediation_target`. An explicit store is validated
    // against `locations` before its database is opened, so a typo cannot create
    // an empty store db and report a clean 0-instance suspension.
    let target = resolve_remediation_target(&state, &session, store_id).await?;

    // Load subscription from the GLOBAL database.
    let sub = {
        let global_db = state.db.lock().await;
        TenantSubscription::validate_clock_rollback(&global_db)?;
        TenantSubscription::load(&global_db, "default")?
            .ok_or_else(|| AppError::Internal("default tenant subscription not found".into()))?
    };
    sub.verify_signature()?;

    let conn = state
        .db_manager
        .open_store(&target)
        .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let effective = sub.effective_tier();
    let suspended = store.suspend_surplus_instances(&target, &effective)?;
    drop(db);
    tracing::info!(
        store_id = %target,
        caller_store = %session.store_id,
        suspended = %suspended,
        tier = %effective.name(),
        "surplus workspace instances suspended after tier downgrade"
    );
    Ok(suspended as u32)
}

/// List screens for a workspace type from the store-scoped database. ADR #7.
#[tauri::command]
pub async fn list_workspace_screens_scoped(
    session_token: String,
    type_key: String,
    state: State<'_, AppState>,
) -> Result<Vec<WorkspaceScreenDto>, AppError> {
    let conn = state.resolve_store(&session_token)?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let rows = store.list_workspace_type_screens(&type_key)?;
    drop(db);
    Ok(rows
        .into_iter()
        .map(|r| WorkspaceScreenDto {
            screen_key: r.screen_key,
            sort_order: r.sort_order,
        })
        .collect())
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
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::STAFF_UPDATE).await?;
    let conn = state
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let ids: Vec<&str> = instance_ids.iter().map(|s| s.as_str()).collect();
    store.set_user_workspace_instances(&user_id, ids, default_instance_id.as_deref())?;
    drop(db);
    tracing::info!(user_id = %user_id, count = %instance_ids.len(), "user workspace instance assignments updated (scoped)");
    Ok(())
}

/// Get instance IDs assigned to a user. Permission check from session. ADR #7.
#[tauri::command]
pub async fn get_user_workspace_instances_scoped(
    session_token: String,
    user_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<String>, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::STAFF_READ).await?;
    let conn = state
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let ids = store.get_user_workspace_instance_ids(&user_id)?;
    drop(db);
    Ok(ids)
}

// ── Original Commands (deprecated for multi-store — ADR #7) ─────────

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
    let session = state.resolve_session(&session_token)?;
    // The user's assignment lives in the GLOBAL identity DB (ADR #35 D5 / spec
    // 0048) — load it before opening the requested store so the listing can be
    // scope-filtered below.
    // ADR #5: the tenant subscription is also loaded from the GLOBAL DB first
    // (with clock-rollback validation) so this listing applies the same tier
    // entitlement filter as `list_workspaces_scoped` — a Free-tier session must
    // not enumerate tier-disallowed workspace types (e.g. kds) through the
    // terminal-management screen.
    let (assignment, sub) = {
        let global_db = state.db.lock().await;
        TenantSubscription::validate_clock_rollback(&global_db)?;
        let sub = TenantSubscription::load(&global_db, "default")?.unwrap_or_else(|| {
            tracing::warn!("no subscription found for tenant 'default', defaulting to Free tier");
            TenantSubscription::bootstrap_free()
        });
        // Verify the RSA signature before honoring the row's tier/allowed-
        // types — a tampered row (forged tier, invalid signature) must fail
        // closed, matching create_session (round 6) and the other 13
        // subscription-trusting call sites.
        sub.verify_signature()?;
        let assignment = Store::new(&global_db).assignment_for_user(&session.user_id)?;
        (assignment, sub)
    };
    let conn = state
        .db_manager
        .open_store(&store_id)
        .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let rows = store.list_workspaces_with_entitlement(
        &session.role_id,
        Some(&session.user_id),
        &store_id,
        &sub,
    )?;
    drop(db);
    // Scope-filter through the user's assignment: a scoped member listing an
    // explicitly named store outside their branch scope, or a workspace type
    // outside their workspace scope, sees nothing (fail closed) — the
    // terminal-management screen cannot switch them into an out-of-scope
    // workspace after login. Global assignments and legacy users pass through.
    Ok(match assignment {
        Some(assignment) => rows
            .into_iter()
            .filter(|d| assignment.matches_scope(Some(&store_id), Some(&d.type_key)))
            .collect(),
        None => rows,
    })
}

// ── Legacy Commands (backward compatible) ────────────────────────────

/// List all workspace types resolved from a session token. ADR #7.
#[tauri::command]
pub async fn list_all_workspaces_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<WorkspaceTypeDto>, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::STAFF_READ).await?;
    let conn = state
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let rows = store.list_all_workspace_types()?;
    drop(db);
    Ok(rows
        .into_iter()
        .map(|r| WorkspaceTypeDto {
            key: r.key,
            name: r.name,
            description: r.description,
            icon: r.icon,
        })
        .collect())
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

// ── Boot Resolution (ADR #4 Phase 3) ────────────────────────────────

/// DTO returned by `resolve_boot_store`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootResolution {
    /// Whether this is bound.
    pub is_bound: bool,
    /// ID of the associated store.
    pub store_id: String,
    /// ID of the associated instance.
    pub instance_id: Option<String>,
}

/// Verify a device-binding HMAC signature using constant-time comparison.
///
/// Uses `mac.verify_slice()` which internally uses `subtle::ConstantTimeEq`
/// to prevent timing side-channel attacks. The previous implementation
/// used `hex::encode(mac.finalize().into_bytes()) == signature`, which
/// short-circuits on the first differing byte — leaking the position
/// of the mismatch to an attacker.
fn verify_binding_hmac(
    secret: &str,
    terminal_id: &str,
    store_id: &str,
    instance_id: &str,
    hex_signature: &str,
) -> bool {
    let expected_bytes = match hex::decode(hex_signature) {
        Ok(b) => b,
        Err(_) => return false,
    };
    let mut mac = match HmacSha256::new_from_slice(secret.as_bytes()) {
        Ok(m) => m,
        Err(_) => return false,
    };
    mac.update(terminal_id.as_bytes());
    mac.update(b":");
    mac.update(store_id.as_bytes());
    mac.update(b":");
    mac.update(instance_id.as_bytes());
    mac.verify_slice(&expected_bytes).is_ok()
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
    let device_id = device_id
        .filter(|d| !d.is_empty())
        .or_else(|| {
            std::env::var("COMPUTERNAME")
                .or_else(|_| std::env::var("HOSTNAME"))
                .ok()
        })
        .unwrap_or_default();

    if device_id.is_empty() {
        let primary_id = {
            let db = state.db.lock().await;
            let store = Store::new(&db);
            let primary = store
                .get_primary_location()?
                .ok_or_else(|| AppError::Internal("no primary store found".into()))?;
            primary.id
        };
        tracing::info!(
            store_id = %primary_id,
            "boot resolution: no device_id available, using primary store"
        );
        return Ok(BootResolution {
            is_bound: false,
            store_id: primary_id,
            instance_id: None,
        });
    }

    let binding_info: Option<(String, String, String, String)> = {
        let db = state.db.lock().await;
        let store = Store::new(&db);
        store
            .get_terminal_by_device_id(&device_id)?
            .and_then(|terminal| {
                let tid = terminal.id;
                store
                    .get_terminal_binding(&tid)
                    .ok()
                    .flatten()
                    .map(|(s, i, sig)| (tid, s, i, sig))
            })
    };

    if let Some((terminal_id, bound_store_id, bound_instance_id, signature)) = binding_info {
        let signature_valid = {
            let keyring = oz_security::default_keyring()
                .map_err(|e| AppError::Internal(format!("keyring unavailable: {e}")))?;
            let secret = keyring
                .get_secret(crate::commands::terminals::DEVICE_BINDING_KEYRING_NAME)
                .map_err(|e| AppError::Internal(format!("keyring read failed: {e}")))?;

            match secret {
                Some(secret) => verify_binding_hmac(
                    &secret,
                    &terminal_id,
                    &bound_store_id,
                    &bound_instance_id,
                    &signature,
                ),
                None => false,
            }
        };

        if !signature_valid {
            tracing::warn!(
                terminal_id = %terminal_id,
                bound_store_id = %bound_store_id,
                "device binding HMAC validation failed — falling back to primary store"
            );
        } else {
            let instance_exists = {
                state
                    .db_manager
                    .open_store(&bound_store_id)
                    .ok()
                    .and_then(|db_arc| {
                        let db = db_arc.lock().ok()?;
                        let store = Store::new(&db);
                        store
                            .get_workspace_instance(&bound_instance_id, None)
                            .ok()
                            .map(|_| true)
                    })
                    .unwrap_or(false)
            };

            if !instance_exists {
                tracing::warn!(
                    terminal_id = %terminal_id,
                    bound_store_id = %bound_store_id,
                    bound_instance_id = %bound_instance_id,
                    "bound instance not found or not active — falling back to primary store"
                );
            } else {
                tracing::info!(
                    terminal_id = %terminal_id,
                    store_id = %bound_store_id,
                    instance_id = %bound_instance_id,
                    "device binding resolved — auto-booting into bound workspace"
                );
                return Ok(BootResolution {
                    is_bound: true,
                    store_id: bound_store_id,
                    instance_id: Some(bound_instance_id),
                });
            }
        }
    }

    let primary_id = {
        let db = state.db.lock().await;
        let store = Store::new(&db);
        let primary = store
            .get_primary_location()?
            .ok_or_else(|| AppError::Internal("no primary store found".into()))?;
        primary.id
    };

    tracing::info!(
        store_id = %primary_id,
        "boot resolution fell back to primary store"
    );
    Ok(BootResolution {
        is_bound: false,
        store_id: primary_id,
        instance_id: None,
    })
}

// ── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "workspaces_tests.rs"]
mod tests;
