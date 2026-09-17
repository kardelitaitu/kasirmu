//! Topology persistence: branch-scoped settings keys, save/load, and the
//! cross-database Apply recovery journal.
//!
//! Extracted from commands/topology.rs. Depends on the semantic engine
//! (`super::semantics`) for the save/Apply-time gates.
//!
//! Wave E (step d): the bodies moved to `kasirmu_bridge::topology::persistence`;
//! this module re-exports them and keeps three kinds of item of its own. The
//! four `&AppState` adapters exist because `lib.rs` startup and the mounted
//! tests call those helpers through a shared state handle the bridge never
//! sees, and they hand over exactly the parts the moved bodies reach (`db`,
//! `db_manager`, `topology_apply_lock`), so no lock is added, removed or
//! reordered. The nine value adapters exist because `commands.rs` and the
//! mounted tests consume those results where the `From<BridgeError>` seam
//! cannot apply - a tail expression, or a pattern match against an
//! `AppError` variant. The `#[cfg(test)]` save/load helpers at the bottom
//! stay here on purpose: a dependency is compiled without `cfg(test)`, so a
//! test-only item in the bridge would not exist in its artifact and no
//! re-export of any visibility could hand it back to the desktop test suite.
//! An explicitly declared item shadows the glob, so every name, path and
//! visibility is what it was before the move.

use rusqlite::Connection;
use serde_json::Value;

use crate::commands::workspaces::CreateInstanceRequest;
use crate::error::AppError;
use crate::state::AppState;

use super::model::*;
use super::revisions::*;
// Only the cfg(test) save/load helpers below reach semantics names (they call
// validate_topology_envelope); the library half of this module needs none.
#[cfg(test)]
use super::semantics::*;

pub use kasirmu_bridge::topology::persistence::*;

/// Adapter over the bridge startup recovery. The bridge side still drops its
/// global guard before acquiring the apply lock, exactly as before the move.
pub async fn recover_pending_topology_apply_at_startup(state: &AppState) -> Result<(), AppError> {
    kasirmu_bridge::topology::persistence::recover_pending_topology_apply_at_startup(
        &state.db,
        &state.db_manager,
        &state.topology_apply_lock,
    )
    .await
    .map_err(Into::into)
}

/// Adapter over [`kasirmu_bridge::topology::persistence::recover_pending_topology_apply`].
#[allow(dead_code)]
pub(crate) async fn recover_pending_topology_apply(
    state: &AppState,
    expected_store_id: &str,
) -> Result<(), AppError> {
    kasirmu_bridge::topology::persistence::recover_pending_topology_apply(
        &state.db,
        &state.db_manager,
        expected_store_id,
    )
    .await
    .map_err(Into::into)
}

/// Adapter over [`kasirmu_bridge::topology::persistence::snapshot_workspace_rows`].
#[allow(dead_code)]
pub(crate) async fn snapshot_workspace_rows(
    state: &AppState,
    store_id: &str,
    updates: &[UpdateInstanceRequest],
    archives: &[String],
) -> Result<Vec<WorkspaceApplySnapshot>, AppError> {
    kasirmu_bridge::topology::persistence::snapshot_workspace_rows(
        &state.db_manager,
        store_id,
        updates,
        archives,
    )
    .await
    .map_err(Into::into)
}

/// Adapter over [`kasirmu_bridge::topology::persistence::compensate_workspace_diff`].
#[allow(dead_code)]
pub(crate) async fn compensate_workspace_diff(
    state: &AppState,
    store_id: &str,
    creations: &[CreateInstanceRequest],
    snapshots: &[WorkspaceApplySnapshot],
) -> Result<(), AppError> {
    kasirmu_bridge::topology::persistence::compensate_workspace_diff(
        &state.db_manager,
        store_id,
        creations,
        snapshots,
    )
    .await
    .map_err(Into::into)
}

/// Adapter over [`kasirmu_bridge::topology::persistence::topology_setting_key`].
#[allow(dead_code)]
pub(crate) fn topology_setting_key(branch_id: Option<&str>) -> Result<String, AppError> {
    kasirmu_bridge::topology::persistence::topology_setting_key(branch_id).map_err(Into::into)
}

/// Adapter over [`kasirmu_bridge::topology::persistence::template_save`].
#[allow(dead_code)]
pub(crate) fn template_save(
    conn: &Connection,
    topology_key: &str,
    raw_name: &str,
    payload: &Value,
) -> Result<(), AppError> {
    kasirmu_bridge::topology::persistence::template_save(conn, topology_key, raw_name, payload)
        .map_err(Into::into)
}

/// Adapter over [`kasirmu_bridge::topology::persistence::template_load`].
#[allow(dead_code)]
pub(crate) fn template_load(
    conn: &Connection,
    topology_key: &str,
    raw_name: &str,
) -> Result<Option<Value>, AppError> {
    kasirmu_bridge::topology::persistence::template_load(conn, topology_key, raw_name)
        .map_err(Into::into)
}

/// Adapter over [`kasirmu_bridge::topology::persistence::template_list`].
#[allow(dead_code)]
pub(crate) fn template_list(
    conn: &Connection,
    topology_key: &str,
) -> Result<Vec<String>, AppError> {
    kasirmu_bridge::topology::persistence::template_list(conn, topology_key).map_err(Into::into)
}

/// Adapter over [`kasirmu_bridge::topology::persistence::template_delete`].
#[allow(dead_code)]
pub(crate) fn template_delete(
    conn: &Connection,
    topology_key: &str,
    raw_name: &str,
) -> Result<bool, AppError> {
    kasirmu_bridge::topology::persistence::template_delete(conn, topology_key, raw_name)
        .map_err(Into::into)
}

/// Adapter over [`kasirmu_bridge::topology::persistence::save_topology_json_at_key_with_revision`].
#[allow(dead_code)]
#[allow(clippy::too_many_arguments)]
pub(crate) fn save_topology_json_at_key_with_revision(
    conn: &Connection,
    nodes: Vec<Value>,
    wires: Vec<Value>,
    setting_key: &str,
    resolved_issue_keys: &[String],
    expected_revision: Option<u64>,
    request: Option<(&str, &str)>,
    branch_registry: Option<&Connection>,
    revision_ctx: Option<&TopologyRevisionContext<'_>>,
) -> Result<u64, AppError> {
    kasirmu_bridge::topology::persistence::save_topology_json_at_key_with_revision(
        conn,
        nodes,
        wires,
        setting_key,
        resolved_issue_keys,
        expected_revision,
        request,
        branch_registry,
        revision_ctx,
    )
    .map_err(Into::into)
}

/// Adapter over [`kasirmu_bridge::topology::persistence::validate_semantic_ownership`].
/// Caller set collapsed when the desktop topology unit tests relocated to
/// oz-bridge: production calls the `_in` variant directly and no mounted test
/// reaches this wrapper in either build.
#[allow(dead_code)]
pub(crate) fn validate_semantic_ownership(
    conn: &Connection,
    nodes: &[Value],
    wires: &[Value],
) -> Result<(), AppError> {
    kasirmu_bridge::topology::persistence::validate_semantic_ownership(conn, nodes, wires)
        .map_err(Into::into)
}

/// Adapter over [`kasirmu_bridge::topology::persistence::validate_warehouse_capacity`].
#[allow(dead_code)]
pub(crate) fn validate_warehouse_capacity(
    nodes: &[Value],
    wires: &[Value],
    tier: &kasirmu_core::subscription::SubscriptionTier,
    resolved_issue_keys: &[String],
) -> Result<(), AppError> {
    kasirmu_bridge::topology::persistence::validate_warehouse_capacity(
        nodes,
        wires,
        tier,
        resolved_issue_keys,
    )
    .map_err(Into::into)
}

/// Test convenience wrapper: save a topology envelope under an explicit key.
#[cfg(test)]
pub(crate) fn save_topology_json_at_key(
    conn: &Connection,
    nodes: Vec<Value>,
    wires: Vec<Value>,
    setting_key: &str,
) -> Result<u64, AppError> {
    save_topology_json_at_key_with_revision(
        conn,
        nodes,
        wires,
        setting_key,
        &[],
        None,
        None,
        None,
        None,
    )
}

/// Test-only legacy compat: serialise typed topology payloads to the
/// settings store under the unscoped `oz-pos/topology` key.
///
/// Writes the nodes + wires payloads as JSON under the
/// `oz-pos/topology` key. Any previous topology is overwritten.
/// The write is wrapped in a transaction to satisfy the project
/// rule that all database writes must occur inside a transaction.
///
/// Kept under `cfg(test)`: production topology persistence is exclusively
/// `apply_topology_diff` (revision-guarded, semantic-gated, journaled).
/// This helper round-trips the legacy typed payloads for the unit tests
/// without exposing a second production write path.
///
/// # Validation
///
/// Structural validation is delegated to [`validate_topology_structure`]
/// after the null-port normalization, so the validator sees the exact
/// values that will be stored: node and wire IDs must be unique, node
/// types/directions/ports must be known, and wire endpoints must
/// reference existing nodes.
#[cfg(test)]
pub(crate) fn save_topology_data(
    conn: &Connection,
    nodes: Vec<TopologyNodePayload>,
    wires: Vec<TopologyWirePayload>,
) -> Result<(), AppError> {
    // Normalize null ports to the editor's renderer defaults so the DB
    // never stores a wire with null from/to ports — the frontend loader
    // maps null -> undefined, forcing every consumer (e.g. the frontend
    // duplicate-wire detector) to re-apply these same defaults
    // (fromPort ?? 'right', toPort ?? 'left'). Done BEFORE validation so
    // the port checks below see the values that will actually be stored.
    let wires: Vec<TopologyWirePayload> = wires
        .into_iter()
        .map(|mut w| {
            // get_or_insert fills ONLY None — explicitly-set ports (e.g. a
            // bottom/top anchor chosen in the editor) survive untouched.
            w.from_port.get_or_insert(PortName::Right);
            w.to_port.get_or_insert(PortName::Left);
            w
        })
        .collect();

    // Reuse the shared structural validator (duplicate ids, unknown node
    // types/directions/ports, ghost endpoints) instead of maintaining a
    // second inline copy whose error text drifted from
    // validate_topology_structure. The node-id uniqueness check matters
    // beyond the duplicate-id error itself: without it the validator's
    // `node_ids` set would silently collapse duplicate node ids, making
    // wire endpoint resolution ambiguous (a wire pointing at "n1" could
    // resolve to either duplicate). The null-port normalization above ran
    // first, so these checks see the exact values that will be stored.
    validate_topology_structure(&nodes, &wires)?;

    let data = TopologyData { nodes, wires };
    let json = serde_json::to_string(&serde_json::json!({
        "schema_version": TOPOLOGY_SCHEMA_VERSION,
        "nodes": data.nodes,
        "wires": data.wires,
    }))
    .map_err(|e| AppError::Internal(e.to_string()))?;
    let tx = conn.unchecked_transaction()?;
    kasirmu_core::Settings::set(&tx, TOPOLOGY_SETTING_KEY, &json)?;
    tx.commit()?;
    Ok(())
}

/// Test-only legacy compat: load and deserialise persisted topology data.
///
/// Returns `None` when no topology has been saved yet.
///
/// Kept under `cfg(test)` with [`save_topology_data`]: production loads go
/// through the `load_topology` command, which serves the raw JSON so the
/// frontend's documented load-time healing can run.
///
/// # Why ports stay raw on the load side
///
/// This function deliberately does **not** normalize legacy null wire ports
/// (rows written before `save_topology_data` gained its `get_or_insert`
/// defaults). The loader is a faithful reflection of what is stored —
/// normalizing here would mask rows that still need healing, and the
/// frontend applies the renderer defaults (`fromPort ?? 'right'`, `toPort ??
/// 'left'`) at every consumption point anyway. A load -> save cycle heals a
/// legacy row via the save-side normalization; the load boundary stays raw.
/// Pinned by the `..._preserves_raw_legacy_null_ports` test below.
#[cfg(test)]
pub(crate) fn load_topology_data(conn: &Connection) -> Result<Option<TopologyData>, AppError> {
    let raw = kasirmu_core::Settings::get(conn, TOPOLOGY_SETTING_KEY)?;
    match raw {
        Some(json) => {
            let value: Value =
                serde_json::from_str(&json).map_err(|e| AppError::Internal(e.to_string()))?;
            let data_value = if value.get("schema_version").is_some() {
                validate_topology_envelope(&value)?;
                serde_json::json!({
                    "nodes": value.get("nodes").cloned().unwrap_or(Value::Array(vec![])),
                    "wires": value.get("wires").cloned().unwrap_or(Value::Array(vec![])),
                })
            } else {
                value
            };
            let data: TopologyData = serde_json::from_value(data_value)
                .map_err(|e| AppError::Internal(e.to_string()))?;
            Ok(Some(data))
        }
        None => Ok(None),
    }
}
