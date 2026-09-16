//! Tauri commands for the node topology: capability probe, diagram
//! templates, load, revisions, and the atomic Apply diff.
//!
//! Wave E (e): the bodies moved to oz_bridge::topology::commands, the last
//! leaf of the oz_bridge::topology mirror; this module keeps every
//! #[tauri::command] with its byte-identical signature and delegates through
//! the bridge_ctx seam. authorize_topology_write stays as an AppError-typed
//! adapter because the mounted tests call it through the root glob, and the
//! #[cfg(test)] save_topology helper stays verbatim: a dependency is compiled
//! without cfg(test), so a test-only item can never move.

use serde_json::Value;
use tauri::State;

use crate::commands::workspaces::CreateInstanceRequest;
use crate::error::AppError;
use crate::state::AppState;

use super::model::UpdateInstanceRequest;
use super::revisions::{TopologyRevisionPinResult, TopologyRevisionSummary};

pub use oz_bridge::topology::commands::{TopologyApplyResult, TopologyRevisionGraphResult};

// Only the cfg(test) save_topology helper below reaches persistence names (the
// library half delegates through oz_bridge directly); an ungated glob here
// would be a library-build unused-import warning.
#[cfg(test)]
use super::persistence::*;

// ── Commands ───────────────────────────────────────────────────────

/// Return whether the authenticated session can save topology changes.
///
/// The frontend uses this capability probe for UI gating; the Apply command
/// repeats the permission check server-side and remains authoritative.
#[tauri::command]
pub async fn can_save_topology(
    session_token: String,
    branch_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<bool, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::topology::commands::can_save_topology(&ctx, session_token, branch_id)
        .await
        .map_err(Into::into)
}

// ── Diagram templates (ADR #45 §4.2) ─────────────────────────────

/// Author a topology write and resolve the branch's topology key.
///
/// Desktop adapter over [oz_bridge::topology::commands::authorize_topology_write]:
/// the mounted tests call it through the root glob, so it stays AppError-typed.
#[allow(dead_code)] // AppError-typed adapter retained for the mounted tests
pub(crate) async fn authorize_topology_write(
    session_token: &str,
    state: &State<'_, AppState>,
    branch_id: Option<&str>,
) -> Result<String, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::topology::commands::authorize_topology_write(&ctx, session_token, branch_id)
        .await
        .map_err(Into::into)
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
    let ctx = state.bridge_ctx();
    oz_bridge::topology::commands::save_topology_template(
        &ctx,
        session_token,
        name,
        payload,
        branch_id,
    )
    .await
    .map_err(Into::into)
}

/// Load one diagram template. `None` when it never existed or is unreadable.
#[tauri::command]
pub async fn load_topology_template(
    session_token: String,
    name: String,
    branch_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Option<Value>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::topology::commands::load_topology_template(&ctx, session_token, name, branch_id)
        .await
        .map_err(Into::into)
}

/// Names of a branch's saved templates, sorted for display.
#[tauri::command]
pub async fn list_topology_templates(
    session_token: String,
    branch_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<String>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::topology::commands::list_topology_templates(&ctx, session_token, branch_id)
        .await
        .map_err(Into::into)
}

/// Delete one template. Returns `false` when there was nothing to delete.
#[tauri::command]
pub async fn delete_topology_template(
    session_token: String,
    name: String,
    branch_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<bool, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::topology::commands::delete_topology_template(&ctx, session_token, name, branch_id)
        .await
        .map_err(Into::into)
}

/// Load the persisted topology graph.
///
/// Returns `None` when no topology has been saved yet (the front-end
/// should fall back to the built-in retail preset).
#[tauri::command]
pub async fn load_topology(
    session_token: String,
    branch_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Option<Value>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::topology::commands::load_topology(&ctx, session_token, branch_id)
        .await
        .map_err(Into::into)
}

/// ADR #46 §4: pin or unpin one revision, exempting it from deflation.
#[tauri::command]
pub async fn pin_topology_revision(
    session_token: String,
    branch_id: Option<String>,
    revision: i64,
    pinned: bool,
    state: State<'_, AppState>,
) -> Result<TopologyRevisionPinResult, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::topology::commands::pin_topology_revision(
        &ctx,
        session_token,
        branch_id,
        revision,
        pinned,
    )
    .await
    .map_err(Into::into)
}

/// ADR #46 §1/§8: one branch's deploy history, newest first, metadata only.
#[tauri::command]
pub async fn list_topology_revisions(
    session_token: String,
    branch_id: Option<String>,
    limit: Option<u32>,
    state: State<'_, AppState>,
) -> Result<Vec<TopologyRevisionSummary>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::topology::commands::list_topology_revisions(&ctx, session_token, branch_id, limit)
        .await
        .map_err(Into::into)
}

/// ADR #46 §5/§7: fetch one revision's graph, to diff it or load it as a
/// draft.
#[tauri::command]
pub async fn load_topology_revision(
    session_token: String,
    branch_id: Option<String>,
    revision: i64,
    state: State<'_, AppState>,
) -> Result<TopologyRevisionGraphResult, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::topology::commands::load_topology_revision(&ctx, session_token, branch_id, revision)
        .await
        .map_err(Into::into)
}

/// Apply a full topology diff atomically (Critical #4).
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
    change_note: Option<String>,
    state: State<'_, AppState>,
) -> Result<TopologyApplyResult, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::topology::commands::apply_topology_diff(
        &ctx,
        session_token,
        workspace_creations,
        workspace_updates,
        workspace_archives,
        diagram_nodes,
        diagram_wires,
        branch_id,
        base_revision,
        request_id,
        resolved_issue_keys,
        change_note,
    )
    .await
    .map_err(Into::into)
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
