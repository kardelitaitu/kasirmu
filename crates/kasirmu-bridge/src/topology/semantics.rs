//! Semantic validation engine for the topology graph (pure JSON/Value logic).
//!
//! Validates nodes/wires as serde_json values against the shared semantics
//! contract (topologySemantics.json) and the ADR #34 typed-connection gates.
//! Includes the apply-key/revision/fingerprint/ledger JSON helpers, which are
//! value-level and deliberately Tauri-free. Extracted from
//! commands/topology.rs.
//!
//! Ported verbatim from
//! `apps/desktop-client/src/commands/topology/semantics.rs` (Wave E step E9c) as
//! the second leaf of the `kasirmu_bridge::topology` mirror: `super::model::*` and
//! every relative path stay exactly as written. The desktop module re-exports
//! this surface and keeps the `oz_core::topology` re-export blocks locally,
//! because their consumers are sibling desktop modules (two call sites pass
//! `value_string(..)` straight into `topology_validation`) and the topology
//! root cfg(test) globs. Only the name these bodies actually use is
//! re-imported here.

use rusqlite::Connection;
use serde_json::Value;
use sha2::{Digest, Sha256};

use oz_core::error::CoreError;

use crate::error::BridgeError;
use crate::workspaces::CreateInstanceRequest;

use super::model::*;

// The pure semantic-validation core lives in oz_core::topology (shared
// domain contract); this module re-exports the value-level helpers the
// desktop layers consume and adapts validate_semantic_json's CoreError
// onto the AppError::TopologyValidation wire shape, which the shim mapper
// rebuilds field-for-field from BridgeError::TopologyValidation.
pub(crate) use oz_core::topology::semantic_branch_profile_id;

/// Validate the semantic ownership contract, mapping core failures onto the
/// desktop AppError surface (same variant and fields as before the move).
pub fn validate_semantic_json(nodes: &[Value], wires: &[Value]) -> Result<(), BridgeError> {
    oz_core::topology::validate_semantic_json(nodes, wires).map_err(map_topology_error)
}

/// Map a core topology validation failure onto the desktop wire shape.
fn map_topology_error(err: CoreError) -> BridgeError {
    match err {
        CoreError::TopologyValidation {
            code,
            node_id,
            wire_id,
            port_id,
            message,
        } => BridgeError::TopologyValidation {
            code,
            node_id,
            wire_id,
            port_id,
            message,
        },
        other => BridgeError::Internal(format!("topology validation failed: {other}")),
    }
}

/// Resolve the settings key for one Apply request's revision ledger.
///
/// Validates the request id against the same control-char/slash length rules
/// as the topology branch keys; the ledger is stored under
/// `TOPOLOGY_APPLY_REQUEST_PREFIX`.
pub fn topology_apply_request_key(request_id: &str) -> Result<String, BridgeError> {
    if request_id.trim().is_empty()
        || request_id.len() > 200
        || request_id.chars().any(|ch| ch.is_control() || ch == '/')
    {
        return Err(BridgeError::Invalid(
            "topology request id contains invalid characters".into(),
        ));
    }
    Ok(format!("{TOPOLOGY_APPLY_REQUEST_PREFIX}{request_id}"))
}

/// Read the `revision` field from a stored topology envelope (`0` when absent).
pub(crate) fn topology_revision_from_json(value: &Value) -> u64 {
    value.get("revision").and_then(Value::as_u64).unwrap_or(0)
}

/// Hash the full Apply request into a stable idempotency fingerprint.
///
/// SHA-256 over the canonical JSON of every Apply input; the same logical
/// request always yields the same fingerprint, so the request ledger can
/// detect and reject replay after a crash or retry.
#[allow(clippy::too_many_arguments)]
pub fn topology_apply_fingerprint(
    store_id: &str,
    branch_id: Option<&str>,
    base_revision: u64,
    workspace_creations: &[CreateInstanceRequest],
    workspace_updates: &[UpdateInstanceRequest],
    workspace_archives: &[String],
    diagram_nodes: &[Value],
    diagram_wires: &[Value],
    resolved_issue_keys: &[String],
) -> Result<String, BridgeError> {
    let payload = serde_json::json!({
        "store_id": store_id,
        "branch_id": branch_id,
        "base_revision": base_revision,
        "workspace_creations": workspace_creations,
        "workspace_updates": workspace_updates,
        "workspace_archives": workspace_archives,
        "diagram_nodes": diagram_nodes,
        "diagram_wires": diagram_wires,
        "resolved_issue_keys": resolved_issue_keys,
    });
    let bytes = serde_json::to_vec(&payload)
        .map_err(|e| BridgeError::Internal(format!("serialize topology request: {e}")))?;
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    Ok(hex::encode(hasher.finalize()))
}

/// Serialise the request ledger entry (revision + fingerprint) for storage.
pub fn topology_apply_ledger_json(revision: u64, fingerprint: &str) -> Result<String, BridgeError> {
    serde_json::to_string(&serde_json::json!({
        "revision": revision,
        "fingerprint": fingerprint,
    }))
    .map_err(|e| BridgeError::Internal(format!("serialize topology request ledger: {e}")))
}

/// Read the current revision of a stored topology envelope (`0` when absent).
pub fn current_topology_revision(conn: &Connection, setting_key: &str) -> Result<u64, BridgeError> {
    let Some(raw) = oz_core::Settings::get(conn, setting_key)? else {
        return Ok(0);
    };
    let value: Value = serde_json::from_str(&raw)
        .map_err(|e| BridgeError::Internal(format!("invalid topology JSON: {e}")))?;
    Ok(topology_revision_from_json(&value))
}

/// Serialise the versioned graph envelope, defaulting missing wire ports.
///
/// Mirrors the save-side port normalization (`from_port ?? right`, `to_port
/// ?? left`) so the stored envelope matches what the frontend loader
/// expects.
pub fn topology_envelope_json(
    nodes: &[Value],
    wires: &[Value],
    revision: u64,
    resolved_issue_keys: &[String],
) -> Result<String, BridgeError> {
    let wires: Vec<Value> = wires
        .iter()
        .cloned()
        .map(|mut wire| {
            if let Some(object) = wire.as_object_mut() {
                object
                    .entry("from_port")
                    .or_insert_with(|| Value::String("right".into()));
                object
                    .entry("to_port")
                    .or_insert_with(|| Value::String("left".into()));
            }
            wire
        })
        .collect();
    serde_json::to_string(&serde_json::json!({
        "schema_version": TOPOLOGY_SCHEMA_VERSION,
        "revision": revision,
        "nodes": nodes,
        "wires": wires,
        "resolved_issue_keys": resolved_issue_keys,
    }))
    .map_err(|e| BridgeError::Internal(format!("serialize topology: {e}")))
}

/// Allow a canonical legacy diagram to be read once by its matching branch.
///
/// Unscoped diagrams without a stable `store_profile_id` are intentionally
/// not guessed into a branch: doing so would recreate the cross-branch leak
/// this key split is meant to prevent.
pub fn legacy_topology_belongs_to_branch(
    value: &Value,
    branch_id: &str,
) -> Result<bool, BridgeError> {
    let (nodes, wires) = if value.get("schema_version").is_some() {
        validate_topology_envelope(value)?
    } else {
        let object = value
            .as_object()
            .ok_or_else(|| BridgeError::Internal("topology payload must be an object".into()))?;
        let nodes = object
            .get("nodes")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        let wires = object
            .get("wires")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        (nodes, wires)
    };
    Ok(semantic_branch_profile_id(nodes, wires) == Some(branch_id))
}

/// Build a desktop `BridgeError::TopologyValidation` failure with optional ids.
pub fn topology_validation(
    code: &str,
    node_id: Option<&str>,
    wire_id: Option<&str>,
    port_id: Option<&str>,
    message: impl Into<String>,
) -> BridgeError {
    BridgeError::TopologyValidation {
        code: code.into(),
        node_id: node_id.map(str::to_owned),
        wire_id: wire_id.map(str::to_owned),
        port_id: port_id.map(str::to_owned),
        message: message.into(),
    }
}

/// Persist the exact command payload in a versioned graph envelope.
pub fn validate_topology_envelope(value: &Value) -> Result<(&[Value], &[Value]), BridgeError> {
    let object = value
        .as_object()
        .ok_or_else(|| BridgeError::Internal("topology payload must be an object".into()))?;
    if let Some(version) = object.get("schema_version")
        && version.as_u64() != Some(TOPOLOGY_SCHEMA_VERSION)
    {
        return Err(topology_validation(
            "unsupported-schema-version",
            None,
            None,
            None,
            format!("unsupported topology schema version: {}", version),
        ));
    }
    let nodes = object
        .get("nodes")
        .and_then(Value::as_array)
        .ok_or_else(|| BridgeError::Internal("topology payload is missing nodes".into()))?;
    let wires = object
        .get("wires")
        .and_then(Value::as_array)
        .ok_or_else(|| BridgeError::Internal("topology payload is missing wires".into()))?;
    Ok((nodes.as_slice(), wires.as_slice()))
}

/// Minimal load-time shape gate.
///
/// The load boundary stays raw: stored nodes and wires must carry only the
/// field the editor cannot operate without — a non-empty `id` (the editor
/// keys every node and wire by id). Display/geometry fields (`name`,
/// `subtitle`, `x`, `y`), directions, ports, and unknown node types are all
/// healed or folded by the frontend load path (normalizeWireDirection,
/// nodeKind's unknown-type fold, port defaults, ghost-wire filtering). Wire
/// endpoints are deliberately NOT required here: the editor's ghost-wire
/// filter drops an endpoint-less wire exactly like a wire with unknown
/// endpoints (already served raw), so requiring endpoint presence would
/// brick a whole topology over one legacy wire. Requiring any of these
/// fields would brick a whole topology over a single legacy row — the same
/// failure the raw-load fixes for corrupt directions and semantic
/// violations were about. The strict typed parse (name/x/y required) still
/// runs at the save/Apply boundary, where the healed value must hold.
pub fn validate_load_shape(nodes: &[Value], wires: &[Value]) -> Result<(), BridgeError> {
    for node in nodes {
        require_load_id(node, "node")?;
    }
    for wire in wires {
        require_load_id(wire, "wire")?;
    }
    Ok(())
}

/// A loadable node or wire must be an object with a non-empty id.
pub(crate) fn require_load_id(value: &Value, what: &str) -> Result<(), BridgeError> {
    let object = value
        .as_object()
        .ok_or_else(|| BridgeError::Internal(format!("topology {what} must be an object")))?;
    let id = object.get("id").and_then(Value::as_str).unwrap_or_default();
    if id.trim().is_empty() {
        return Err(BridgeError::Internal(format!(
            "topology {what} is missing a valid id"
        )));
    }
    Ok(())
}
