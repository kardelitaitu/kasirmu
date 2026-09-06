//! Tauri commands for the node topology: capability probe, load, and the
//! atomic Apply diff. Extracted from commands/topology.rs.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

use oz_core::db::Store;
use oz_core::permissions;
use oz_core::subscription::TenantSubscription;

use crate::commands::authz::require_permission_for_user;
use crate::commands::workspaces::CreateInstanceRequest;
use crate::error::AppError;
use crate::state::AppState;

use super::model::*;
use super::persistence::*;
use super::semantics::*;

// ── Commands ───────────────────────────────────────────────────────

/// Return whether the authenticated session can save topology changes.
///
/// The frontend uses this capability probe for UI gating; the Apply command
/// repeats the permission check server-side and remains authoritative.
#[tauri::command]
pub async fn can_save_topology(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<bool, AppError> {
    let session = state.resolve_session(&session_token)?;
    // Topology is a global admin tool — use scope-free permission check.
    {
        let global_db = state.db.lock().await;
        let global_store = Store::new(&global_db);
        require_permission_for_user(&global_store, &session.user_id, permissions::STAFF_UPDATE)?;
    }
    Ok(true)
}

// ── Diagram templates (ADR #45 §4.2) ─────────────────────────────
//
// Templates used to live in `localStorage`, which is per-browser and silently
// loses them on a device change, a profile switch, or a reinstall. They are
// business configuration — they seed a graph a merchant then edits and Applies —
// so they belong in the same settings namespace as that graph, scoped to the
// same branch.
//
// They deliberately do NOT run the diagram validation gates that
// `apply_topology_diff` runs. A template is a starting point, not a claim about
// live configuration: it may legitimately be a partial layout, and rejecting it
// would make the feature useless. Authorization is still enforced, because a
// template a branch loads becomes the diagram that branch Applies.

/// Author a topology write and resolve the branch's topology key.
async fn authorize_topology_write(
    session_token: &str,
    state: &State<'_, AppState>,
    branch_id: Option<&str>,
) -> Result<String, AppError> {
    let session = state.resolve_session(session_token)?;
    // Topology is a global admin tool — scope-free permission check, matching
    // `can_save_topology`.
    {
        let global_db = state.db.lock().await;
        let global_store = Store::new(&global_db);
        require_permission_for_user(&global_store, &session.user_id, permissions::STAFF_UPDATE)?;
    }
    topology_setting_key(branch_id)
}

/// Save a diagram template under a branch, replacing any template of that name.
#[tauri::command]
pub async fn save_topology_template(
    session_token: String,
    name: String,
    payload: Value,
    branch_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let topo_key = authorize_topology_write(&session_token, &state, branch_id.as_deref()).await?;
    let conn = state.db.lock().await;
    template_save(&conn, &topo_key, &name, &payload)
}

/// Load one diagram template. `None` when it never existed or is unreadable.
#[tauri::command]
pub async fn load_topology_template(
    session_token: String,
    name: String,
    branch_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Option<Value>, AppError> {
    let topo_key = topology_setting_key(branch_id.as_deref())?;
    let session = state.resolve_session(&session_token)?;
    let conn = state.db.lock().await;
    // Reading a template reveals a branch's configuration, so it needs a
    // session — but not the write capability.
    let _ = &session.user_id;
    template_load(&conn, &topo_key, &name)
}

/// Names of a branch's saved templates, sorted for display.
#[tauri::command]
pub async fn list_topology_templates(
    session_token: String,
    branch_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<String>, AppError> {
    let topo_key = topology_setting_key(branch_id.as_deref())?;
    state.resolve_session(&session_token)?;
    let conn = state.db.lock().await;
    template_list(&conn, &topo_key)
}

/// Delete one template. Returns `false` when there was nothing to delete.
#[tauri::command]
pub async fn delete_topology_template(
    session_token: String,
    name: String,
    branch_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<bool, AppError> {
    let topo_key = authorize_topology_write(&session_token, &state, branch_id.as_deref()).await?;
    let conn = state.db.lock().await;
    template_delete(&conn, &topo_key, &name)
}

/// Test-only compatibility harness for the retired direct topology writer.
///
/// Production topology persistence is exclusively `apply_topology_diff`, which
/// performs authorization, revision checks, workspace diffing, and recovery
/// journaling. Keeping this helper under `cfg(test)` preserves low-level
/// command round-trip coverage without exposing a second production write
/// path through Tauri IPC.
#[cfg(test)]
pub(crate) async fn save_topology(
    nodes: Vec<Value>,
    wires: Vec<Value>,
    branch_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let setting_key = topology_setting_key(branch_id.as_deref())?;
    let conn = state.db.lock().await;
    save_topology_json_at_key(&conn, nodes, wires, &setting_key).map(|_| ())
}

/// Load the persisted topology graph.
///
/// Returns `None` when no topology has been saved yet (the front-end
/// should fall back to the built-in retail preset).
///
/// # Load boundary stays raw
///
/// Stored values are served raw so the frontend's documented load-time
/// healing (normalizeWireDirection, ghost-wire filtering, port defaults)
/// can run — mirroring `load_topology_data`. Structure is enforced at the
/// save boundary (`save_topology_json_at_key`), where the healed value must hold.
/// Do NOT re-add `validate_topology_structure` here: a single stored
/// corrupt value would brick the whole topology instead of letting the
/// editor repair it.
#[tauri::command]
pub async fn load_topology(
    branch_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Option<Value>, AppError> {
    let setting_key = topology_setting_key(branch_id.as_deref())?;
    let conn = state.db.lock().await;
    let raw = match oz_core::Settings::get(&conn, &setting_key)? {
        Some(json) => Some(json),
        None => {
            // Migrate only an old diagram whose canonical branch identity
            // proves it belongs to this branch. Ambiguous legacy geometry is
            // left unassigned rather than leaked into every branch.
            let Some(branch_id) = branch_id.as_deref() else {
                return Ok(None);
            };
            let Some(legacy_json) = oz_core::Settings::get(&conn, TOPOLOGY_SETTING_KEY)? else {
                return Ok(None);
            };
            let value: Value = serde_json::from_str(&legacy_json)
                .map_err(|e| AppError::Internal(format!("invalid topology JSON: {e}")))?;
            if legacy_topology_belongs_to_branch(&value, branch_id)? {
                Some(legacy_json)
            } else {
                None
            }
        }
    };
    let Some(json) = raw else {
        return Ok(None);
    };
    let value: Value = serde_json::from_str(&json)
        .map_err(|e| AppError::Internal(format!("invalid topology JSON: {e}")))?;
    let (nodes, wires) = validate_topology_envelope(&value)?;
    // Minimal shape gate only: stored nodes and wires must carry the id the
    // editor keys by (see validate_load_shape for the rationale). Neither
    // the closed-union structural gate (validate_topology_structure) NOR the
    // semantic-ownership gate (validate_semantic_ownership) runs at load:
    // the frontend contract heals healable corruption at the editor load
    // path (normalizeWireDirection, ghost-wire filtering, port defaults)
    // and surfaces contract violations (missing-location-input etc.) as
    // Apply-time toasts the user repairs in the editor — the free function
    // load_topology_data is documented raw-by-design ("the load boundary
    // stays raw"). Rejecting a stored row for display-level gaps would
    // brick the whole topology instead of letting the editor repair it.
    // Both gates run at the save/Apply boundary (save_topology_json_at_key), where
    // the healed value must hold.
    validate_load_shape(nodes, wires)?;
    Ok(Some(value))
}

/// Result returned after a topology Apply commits.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopologyApplyResult {
    /// Revision assigned to the committed branch topology.
    pub revision: u64,
}

/// Apply a full topology diff atomically (Critical #4).
///
/// Creates, updates, and archives workspace instances within a single
/// SQLite transaction on the store database, then saves the topology
/// diagram (nodes + wires) on the global database.
///
/// # Transaction guarantee
///
/// All workspace instance mutations (create, update, archive) execute
/// inside a single SQLite transaction. If any operation fails, the
/// entire set of workspace changes rolls back. The create step runs its
/// INSERT SQL *directly* on the outer transaction rather than delegating
/// to `Store::create_workspace_instance` — that helper opens its own
/// `unchecked_transaction` (`BEGIN`), which SQLite rejects with "cannot
/// start a transaction within a transaction" when nested (see the
/// `create_workspace_instance_cannot_nest_in_open_transaction` test in
/// oz-core). The update and archive steps delegate to
/// `Store::{update_workspace_instance,archive_instance}`, which use
/// `Connection::execute` directly and therefore compose safely inside
/// the outer transaction.
///
/// The topology diagram save is a separate step on the global DB. The command
/// snapshots the affected workspace rows and previous diagram, then compensates
/// both databases if the second write fails. A compensation failure is returned
/// explicitly so the caller can surface an operator-recovery condition.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn apply_topology_diff(
    session_token: String,
    workspace_creations: Vec<CreateInstanceRequest>,
    workspace_updates: Vec<UpdateInstanceRequest>,
    workspace_archives: Vec<String>,
    diagram_nodes: Vec<Value>,
    diagram_wires: Vec<Value>,
    branch_id: Option<String>,
    base_revision: u64,
    request_id: String,
    resolved_issue_keys: Option<Vec<String>>,
    state: State<'_, AppState>,
) -> Result<TopologyApplyResult, AppError> {
    let session = state.resolve_session(&session_token)?;
    tracing::info!(
        user_id = %session.user_id,
        role_id = %session.role_id,
        session_store_id = %session.store_id,
        session_type_key = %session.type_key,
        creations = workspace_creations.len(),
        updates = workspace_updates.len(),
        archives = workspace_archives.len(),
        "topology Apply: START — full session + payload context"
    );
    // Log each workspace creation's store_id for mismatch diagnosis.
    for c in &workspace_creations {
        tracing::info!(
            workspace_id = %c.id,
            creation_store_id = %c.store_id,
            type_key = %c.type_key,
            name = %c.name,
            "topology Apply: creation payload"
        );
    }
    for u in &workspace_updates {
        tracing::info!(
            workspace_id = %u.id,
            name = %u.name,
            "topology Apply: update payload"
        );
    }
    let _apply_guard = state.topology_apply_lock.lock().await;
    let topology_key = topology_setting_key(branch_id.as_deref())?;
    let request_key = topology_apply_request_key(&request_id)?;
    let resolved_issue_keys = resolved_issue_keys.unwrap_or_default();
    let request_fingerprint = topology_apply_fingerprint(
        &session.store_id,
        branch_id.as_deref(),
        base_revision,
        &workspace_creations,
        &workspace_updates,
        &workspace_archives,
        &diagram_nodes,
        &diagram_wires,
        &resolved_issue_keys,
    )?;

    // Authorization: workspace topology changes require admin access. The
    // topology Apply is a GLOBAL admin operation — it modifies workspace
    // instances across branches/stores, so it must NOT be scope-restricted.
    // Use require_permission_for_user (which skips the branch/workspace
    // scope check) instead of require_permission_for_session. The user's
    // identity + role live in the GLOBAL identity DB — the store-scoped
    // DB below has an empty `users` table by design, so the gate MUST run
    // here against the global DB. (Authorizing against the store connection
    // would deny every caller — owner included — with "user not found".)
    {
        let global_db = state.db.lock().await;
        let global_store = Store::new(&global_db);
        match require_permission_for_user(
            &global_store,
            &session.user_id,
            permissions::STAFF_UPDATE,
        ) {
            Ok(()) => {
                tracing::info!(user_id = %session.user_id, "topology Apply: RBAC check PASSED")
            }
            Err(e) => {
                tracing::error!(user_id = %session.user_id, error = %e, "topology Apply: RBAC check FAILED");
                return Err(e);
            }
        }
    }

    // The topology is a global admin tool. The diagram's Branch Location
    // determines which store owns the workspace instances — this may differ
    // from the session's store (e.g. the admin workspace is in store A but
    // the topology references Branch Location B). Use the diagram's
    // storeProfileId as the authoritative scope for all workspace operations;
    // fall back to session.store_id for legacy graphs without semantic fields.
    let effective_store_id = semantic_branch_profile_id(&diagram_nodes, &diagram_wires)
        .map(str::to_owned)
        .unwrap_or_else(|| session.store_id.clone());
    tracing::info!(effective_store_id = %effective_store_id, session_store_id = %session.store_id, "topology Apply: effective store resolved");

    // A retried request returns the original result without repeating any
    // workspace mutation. The process-wide Apply lock also makes the
    // revision check and this ledger lookup deterministic.
    {
        let global_db = state.db.lock().await;
        if let Some(raw) = oz_core::Settings::get(&global_db, &request_key)? {
            let value: Value = serde_json::from_str(&raw)
                .map_err(|e| AppError::Internal(format!("invalid topology request ledger: {e}")))?;
            if let Some(stored_fingerprint) = value.get("fingerprint").and_then(Value::as_str) {
                if stored_fingerprint != request_fingerprint {
                    return Err(AppError::Invalid(
                        "topology request id was already used for a different Apply".into(),
                    ));
                }
                let revision = value
                    .get("revision")
                    .and_then(Value::as_u64)
                    .ok_or_else(|| {
                        AppError::Internal("topology request ledger has no revision".into())
                    })?;
                return Ok(TopologyApplyResult { revision });
            }
            // A pre-fingerprint ledger entry can only come from an interrupted
            // development build. Remove it rather than treating an unbound
            // request id as an idempotent success for an unrelated payload.
            oz_core::Settings::remove(&global_db, &request_key)?;
        }
    }

    // Finish any prior cross-database Apply before comparing revisions. A
    // prior process may have committed the diagram but not cleared its
    // journal, in which case recovery must finalize it first.
    recover_pending_topology_apply(&state, &effective_store_id).await?;
    {
        let global_db = state.db.lock().await;
        let current_revision = current_topology_revision(&global_db, &topology_key)?;
        if current_revision != base_revision {
            return Err(topology_validation(
                "topology-revision-conflict",
                None,
                None,
                None,
                format!(
                    "topology revision conflict: expected {base_revision}, current {current_revision}"
                ),
            ));
        }
    }

    // Reject malformed graphs before any workspace mutation. The gate
    // requires canonical semantic node and wire fields, semantic ownership,
    // and structural validity.
    //
    // Ownership registries: branch profiles created through the scoped
    // commands land in the SESSION's store database (store-<id>.sqlite),
    // while the global database only carries the seeded default profile.
    // The gate therefore accepts a canonical branch profile from either
    // registry — validating the global one alone rejected every freshly
    // created branch with `unknown-branch-location` forever.
    {
        let global_db = state.db.lock().await;
        let branch_conn = state
            .db_manager
            .open_store(&session.store_id)
            .map_err(|e| AppError::Internal(format!("opening store db for topology gate: {e}")))?;
        let branch_db = branch_conn
            .lock()
            .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
        validate_apply_gate(&[&global_db, &branch_db], &diagram_nodes, &diagram_wires)?;
    }

    // Capture lengths before the workspace block consumes the vectors
    // (via `into_iter`-style moves). Also used for tracing after the
    // diagram save.
    let created = workspace_creations.len();
    let updated = workspace_updates.len();
    let archived = workspace_archives.len();
    let node_count = diagram_nodes.len();
    let wire_count = diagram_wires.len();

    // Capture the exact diagram state before mutating the store database.
    // If the later global write fails, the workspace transaction is
    // compensated from this snapshot.
    let previous_topology = {
        let global_db = state.db.lock().await;
        oz_core::Settings::get(&global_db, &topology_key)?
    };
    let desired_topology = topology_envelope_json(
        &diagram_nodes,
        &diagram_wires,
        base_revision.saturating_add(1),
        &resolved_issue_keys,
    )?;

    // Snapshot all pre-existing rows that a later compensation may need to restore.
    let workspace_snapshot = snapshot_workspace_rows(
        &state,
        &effective_store_id,
        &workspace_updates,
        &workspace_archives,
    )
    .await?;

    // Validate branch-id consistency. The branch_id parameter (if any) must
    // match the Branch Location's store_profile_id so the topology key stays
    // coherent with the diagram's canonical branch identity.
    if let Some(requested_branch_id) = branch_id.as_deref()
        && let Some(branch_profile_id) = semantic_branch_profile_id(&diagram_nodes, &diagram_wires)
        && requested_branch_id != branch_profile_id
    {
        return Err(topology_validation(
            "branch-id-mismatch",
            None,
            None,
            None,
            format!(
                "topology branch {requested_branch_id} does not match Branch Location {branch_profile_id}"
            ),
        ));
    }
    for creation in &workspace_creations {
        if creation.store_id != effective_store_id {
            return Err(AppError::TopologyValidation {
                code: "workspace-store-mismatch".into(),
                node_id: None,
                wire_id: None,
                port_id: None,
                message: format!(
                    "workspace {} must be compiled to Branch Location {}",
                    creation.id, effective_store_id
                ),
            });
        }
    }

    // Load entitlement before acquiring the non-Send store connection guard.
    // Tauri command futures must remain Send across every await boundary.
    let effective_tier = {
        let global_db = state.db.lock().await;
        TenantSubscription::validate_clock_rollback(&global_db)?;
        let subscription = TenantSubscription::load(&global_db, "default")?
            .ok_or_else(|| AppError::Internal("default tenant subscription not found".into()))?;
        subscription.verify_signature()?;
        subscription.effective_tier()
    };
    validate_warehouse_quota(&diagram_nodes, &effective_tier)?;
    validate_warehouse_capacity(
        &diagram_nodes,
        &diagram_wires,
        &effective_tier,
        &resolved_issue_keys,
    )?;

    // The journal is written BEFORE any store mutation. If the process
    // crashes after the store commit, startup/next Apply can compare the
    // desired diagram and compensate deterministically.
    let recovery = TopologyApplyRecovery {
        store_id: effective_store_id.clone(),
        topology_branch_id: branch_id.clone(),
        creations: workspace_creations.clone(),
        snapshots: workspace_snapshot.clone(),
        previous_topology: previous_topology.clone(),
        desired_topology: Some(desired_topology.clone()),
    };
    {
        let db = state.db.lock().await;
        persist_topology_recovery(&db, &recovery)?;
    }

    // ── Workspace CRUD in a single transaction ────────────────────────
    //
    // Scoped in a block so all non-`Send` types (MutexGuard, Store,
    // Transaction) are dropped before the `state.db.lock().await` call
    // below. Tauri requires command futures to be `Send`.
    tracing::info!(
        effective_store_id = %effective_store_id,
        creations = workspace_creations.len(),
        updates = workspace_updates.len(),
        archives = workspace_archives.len(),
        "topology Apply: opening store DB for workspace CRUD"
    );
    {
        let conn = state
            .db_manager
            .open_store(&effective_store_id)
            .map_err(|e| {
                AppError::Internal(format!(
                    "opening store db for store '{effective_store_id}': {e}"
                ))
            })?;
        let db = conn
            .lock()
            .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
        let store = Store::new(&db);

        // Preserve the same subscription and entitlement boundary as the
        // standalone workspace-create command. The topology diff must not
        // become an entitlement bypass just because it batches mutations.
        for creation in &workspace_creations {
            if creation.id.trim().is_empty()
                || creation.type_key.trim().is_empty()
                || creation.store_id.trim().is_empty()
                || creation.name.trim().is_empty()
            {
                return Err(AppError::Invalid(
                    "workspace creation requires non-empty id, type_key, store_id, and name".into(),
                ));
            }
            if creation.store_id != effective_store_id {
                tracing::warn!(
                    workspace_id = %creation.id,
                    creation_store = %creation.store_id,
                    effective_store = %effective_store_id,
                    "topology Apply: workspace targets a different store"
                );
                return Err(AppError::PermissionDenied(format!(
                    "workspace '{}' store_id '{}' does not match topology branch store '{}'",
                    creation.id, creation.store_id, effective_store_id
                )));
            }
            if !effective_tier.allows_workspace_type(&creation.type_key) {
                return Err(AppError::PermissionDenied(format!(
                    "subscription tier does not allow workspace type {}",
                    creation.type_key
                )));
            }
            if creation
                .purpose_key
                .as_deref()
                .unwrap_or("general")
                .trim()
                .is_empty()
            {
                return Err(AppError::Invalid(
                    "workspace purpose_key must not be empty".into(),
                ));
            }
        }
        for update in &workspace_updates {
            let owner: String = store
                .conn()
                .query_row(
                    "SELECT location_id FROM workspace_instances WHERE id = ?1",
                    rusqlite::params![update.id],
                    |row| row.get(0),
                )
                .map_err(|_| {
                    tracing::warn!(workspace_id = %update.id, "topology Apply: workspace not found in store DB");
                    AppError::PermissionDenied(format!(
                        "workspace '{}' not found in store '{}' — it may have been created in a different store",
                        update.id, effective_store_id
                    ))
                })?;
            if owner != effective_store_id {
                tracing::warn!(
                    workspace_id = %update.id,
                    workspace_store = %owner,
                    effective_store = %effective_store_id,
                    "topology Apply: workspace ownership mismatch"
                );
                return Err(AppError::PermissionDenied(format!(
                    "workspace '{}' is in store '{}' but topology targets store '{}'",
                    update.id, owner, effective_store_id
                )));
            }
        }
        for archive_id in &workspace_archives {
            let owner: String = store
                .conn()
                .query_row(
                    "SELECT location_id FROM workspace_instances WHERE id = ?1",
                    rusqlite::params![archive_id],
                    |row| row.get(0),
                )
                .map_err(|_| {
                    tracing::warn!(workspace_id = %archive_id, "topology Apply: archive target not found in store DB");
                    AppError::PermissionDenied(format!(
                        "workspace '{}' not found in store '{}' for archive",
                        archive_id, effective_store_id
                    ))
                })?;
            if owner != effective_store_id {
                tracing::warn!(
                    workspace_id = %archive_id,
                    workspace_store = %owner,
                    effective_store = %effective_store_id,
                    "topology Apply: archive target ownership mismatch"
                );
                return Err(AppError::PermissionDenied(format!(
                    "workspace '{}' is in store '{}' but topology targets store '{}' for archive",
                    archive_id, owner, effective_store_id
                )));
            }
        }
        // Quota check: only enforce when new workspaces are actually being
        // created. Topology edits (0 creates, 0 archives) should not be
        // blocked by the quota — the user is reorganizing existing workspaces,
        // not adding new ones. This prevents a tier downgrade from locking
        // the user out of editing their existing topology.
        if !workspace_creations.is_empty()
            && let Some(limit) = effective_tier.max_pos_instances()
        {
            // Only POS registers (store-pos/restaurant-pos) consume the
            // register budget — kds/warehouse/inventory/admin instances must
            // not block legitimate register creation.
            let current = store.count_active_pos_instances(&effective_store_id)?;
            let archived_ids: std::collections::HashSet<&str> =
                workspace_archives.iter().map(String::as_str).collect();
            let archived_active = archived_ids
                .iter()
                .filter(|id| {
                    store
                        .conn()
                        .query_row(
                            "SELECT status = 'active' FROM workspace_instances WHERE id = ?1",
                            rusqlite::params![id],
                            |row| row.get::<_, bool>(0),
                        )
                        .unwrap_or(false)
                })
                .count() as i64;
            let projected = current - archived_active + workspace_creations.len() as i64;
            if projected > limit {
                return Err(AppError::PermissionDenied(format!(
                    "workspace instance quota exceeded: limit {limit}, current {current}, archived {archived_active}, requested {}, projected {projected}",
                    workspace_creations.len()
                )));
            }
        }

        // Inside this transaction, all create / update / archive SQL runs
        // *directly* on `tx`. We deliberately do NOT delegate to
        // `Store::create_workspace_instance` here: that method opens its
        // own transaction via `unchecked_transaction`, which issues a raw
        // `BEGIN` that SQLite rejects ("cannot start a transaction within
        // a transaction") when an outer transaction is already open. See
        // `create_workspace_instance_cannot_nest_in_open_transaction` in
        // oz-core. Running the INSERT/UPDATE SQL directly preserves the
        // single-transaction atomicity: if any step fails, the whole
        // batch rolls back.
        let tx = db
            .unchecked_transaction()
            .map_err(|e| AppError::Internal(format!("begin transaction: {e}")))?;

        // 1. Create new workspace instances (direct SQL — no nested tx).
        for creation in &workspace_creations {
            // Mirrors Store::create_workspace_instance's existence check
            // + INSERT, minus the nested transaction.
            let exists: bool = tx
                .query_row(
                    "SELECT COUNT(*) > 0 FROM workspace_instances WHERE id = ?1",
                    rusqlite::params![creation.id],
                    |row| row.get(0),
                )
                .unwrap_or(false);
            if exists {
                return Err(AppError::Internal(format!(
                    "workspace instance already exists: {}",
                    creation.id
                )));
            }
            tx.execute(
                "INSERT INTO workspace_instances \
                 (id, type_key, location_id, name, description, colour, purpose_key, status, last_accessed_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'active', \
                         strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
                rusqlite::params![
                    creation.id,
                    creation.type_key,
                    creation.store_id,
                    creation.name,
                    creation.description.as_deref().unwrap_or(""),
                    creation.colour.as_deref(),
                    creation.purpose_key.as_deref().unwrap_or("general"),
                ],
            )
            .map_err(|e| AppError::Internal(format!("create instance {}: {e}", creation.id)))?;
        }

        // 2. Update existing workspace instances (rename only).
        //
        // `update_workspace_instance` uses `self.conn.execute` directly
        // (no nested transaction), so it composes safely inside this tx.
        let tx_store = Store::new(&tx);
        for update in &workspace_updates {
            tx_store.update_workspace_instance(&update.id, &update.name, None, None)?;
            if let Some(purpose_key) = update.purpose_key.as_deref() {
                if purpose_key.trim().is_empty() {
                    return Err(AppError::Invalid(
                        "workspace purpose_key must not be empty".into(),
                    ));
                }
                tx.execute(
                    "UPDATE workspace_instances SET purpose_key = ?2, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1",
                    rusqlite::params![update.id, purpose_key],
                )?;
            }
        }

        // 3. Archive workspace instances removed from the canvas.
        //
        // `archive_instance` also uses `self.conn.execute` directly, so
        // it is safe to call within this transaction. A 0-rows-affected
        // archive surfaces as NotFound, which aborts (and rolls back)
        // the whole batch.
        for archive_id in &workspace_archives {
            tx_store.archive_instance(archive_id)?;
        }

        tx.commit()
            .map_err(|e| AppError::Internal(format!("commit transaction: {e}")))?;
        // db, store, tx, tx_store all drop here when the block ends.
    }

    // ── Save topology diagram on global database ─────────────────────
    //
    // This `.await` is now safe — all non-`Send` types from the store
    // DB block have been dropped.
    tracing::info!(
        node_count = diagram_nodes.len(),
        wire_count = diagram_wires.len(),
        "topology Apply: workspace CRUD committed, saving diagram"
    );
    let global_db = state.db.lock().await;
    // Same ownership registries as the pre-mutation gate: the session's
    // store database may be the only one holding the branch profile row.
    // The store guards live only inside this block — a MutexGuard over a
    // rusqlite Connection is !Send, so it must not be held across the
    // error-path awaits below (lexical scope, not explicit drop, is what
    // the async generator liveness analysis respects here).
    let save_result = {
        let branch_conn = state
            .db_manager
            .open_store(&session.store_id)
            .map_err(|e| AppError::Internal(format!("opening store db for topology save: {e}")))?;
        let branch_db = branch_conn
            .lock()
            .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
        save_topology_json_at_key_with_revision(
            &global_db,
            diagram_nodes,
            diagram_wires,
            &topology_key,
            &resolved_issue_keys,
            Some(base_revision),
            Some((&request_key, &request_fingerprint)),
            Some(&branch_db),
        )
        // branch_db and branch_conn drop here with the block.
    };
    if let Err(save_error) = save_result {
        drop(global_db);
        // The durable recovery journal was written before the workspace
        // transaction. Keep it until both databases have been compensated.
        if let Err(compensation_error) = compensate_workspace_diff(
            &state,
            &effective_store_id,
            &workspace_creations,
            &workspace_snapshot,
        )
        .await
        {
            return Err(AppError::Internal(format!(
                "topology save failed ({save_error}); workspace compensation pending ({compensation_error})"
            )));
        }
        let restore = {
            let db = state.db.lock().await;
            restore_topology_setting(&db, &topology_key, previous_topology.as_deref())
        };
        if let Err(restore_error) = restore {
            return Err(AppError::Internal(format!(
                "topology save failed ({save_error}); diagram compensation pending ({restore_error})"
            )));
        }
        {
            let db = state.db.lock().await;
            clear_topology_recovery(&db)?;
        }
        return Err(save_error);
    }

    // The `global_db` guard from the save is still held on the success path
    // — re-locking `state.db` here would deadlock (tokio::sync::Mutex is not
    // reentrant), so read the committed revision through the guard we
    // already own. (Latent since the success path was first built; no test
    // exercised the real command end-to-end until round 136.)
    let revision = current_topology_revision(&global_db, &topology_key)?;
    drop(global_db);
    let result = TopologyApplyResult { revision };
    tracing::info!(
        created,
        updated,
        archived,
        nodes = node_count,
        wires = wire_count,
        revision = result.revision,
        "topology diff applied"
    );

    Ok(result)
}
