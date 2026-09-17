//! Topology persistence: branch-scoped settings keys, save/load, and the
//! cross-database Apply recovery journal.
//!
//! Extracted from commands/topology.rs. Depends on the semantic engine
//! (`super::semantics`) for the save/Apply-time gates.
//!
//! Ported verbatim from
//! `apps/desktop-tauri/src/commands/topology/persistence.rs` (Wave E step d)
//! as the fifth leaf of the `kasirmu_bridge::topology` mirror, after model,
//! semantics and revisions, so its three `super::` device lines all resolve
//! here. The four helpers that took `&AppState` take exactly the parts their
//! bodies reach - db, db_manager, apply_lock - following the precedent this
//! file sets with `validate_apply_gate`, which already took
//! `&[&Connection]`. Desktop adapters supply the parts.

use rusqlite::{Connection, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::BridgeError;
use crate::workspaces::CreateInstanceRequest;

use kasirmu_core::topology::{
    has_semantic_fields, is_warehouse_operational_input_port, semantic_node_type, value_string,
};
use platform_core::StoreDatabaseManager;

use super::model::*;
use super::revisions::*;
use super::semantics::*;

/// Resolve the branch-scoped runtime plan key paired with a topology key.
pub fn topology_runtime_setting_key(topology_key: &str) -> Result<String, BridgeError> {
    if topology_key == TOPOLOGY_SETTING_KEY {
        return Ok(TOPOLOGY_RUNTIME_SETTING_KEY.to_owned());
    }
    let prefix = format!("{TOPOLOGY_SETTING_KEY}/");
    let branch_id = topology_key
        .strip_prefix(&prefix)
        .filter(|id| !id.is_empty())
        .ok_or_else(|| BridgeError::Internal("invalid topology setting key".into()))?;
    Ok(format!("{TOPOLOGY_RUNTIME_SETTING_KEY}/{branch_id}"))
}

/// Compile operational semantic wires into the runtime routing artifact.
///
/// Location ownership edges stay in the diagram contract; operational edges
/// are copied into a branch-scoped manifest consumed by runtime adapters. The
/// manifest deliberately keeps stable instance IDs and semantic port fields,
/// never display names or canvas coordinates.
pub fn compile_topology_runtime_plan(
    nodes: &[Value],
    wires: &[Value],
    branch_id: Option<String>,
) -> Value {
    let node_ids: std::collections::HashSet<&str> = nodes
        .iter()
        .filter_map(|node| value_string(node, "id"))
        .collect();
    let node_by_id: std::collections::HashMap<&str, &Value> = nodes
        .iter()
        .filter_map(|node| value_string(node, "id").map(|id| (id, node)))
        .collect();
    let routes: Vec<Value> = wires
        .iter()
        .filter(|wire| value_string(wire, "relationship_type") != Some("location"))
        .filter(|wire| {
            node_ids.contains(value_string(wire, "from_node_id").unwrap_or_default())
                && node_ids.contains(value_string(wire, "to_node_id").unwrap_or_default())
        })
        .map(|wire| {
            serde_json::json!({
                "wire_id": value_string(wire, "id").unwrap_or_default(),
                "source_instance_id": value_string(wire, "from_node_id").unwrap_or_default(),
                "target_instance_id": value_string(wire, "to_node_id").unwrap_or_default(),
                "from_port_id": value_string(wire, "from_port_id").unwrap_or_default(),
                "to_port_id": value_string(wire, "to_port_id").unwrap_or_default(),
                "relationship_type": value_string(wire, "relationship_type").unwrap_or_default(),
                "target_node_kind": value_string(
                    node_by_id
                        .get(value_string(wire, "to_node_id").unwrap_or_default())
                        .copied()
                        .unwrap_or(&Value::Null),
                    "type",
                ).unwrap_or_default(),
            })
        })
        .collect();
    serde_json::json!({
        "schema_version": TOPOLOGY_SCHEMA_VERSION,
        "branch_id": branch_id,
        "routes": routes,
    })
}

/// Resolve the settings key for one branch topology.
///
/// The unscoped key remains the compatibility path for legacy callers. New
/// branch-aware callers always use a separate key, so one branch can never
/// overwrite another branch's diagram.
pub fn topology_setting_key(branch_id: Option<&str>) -> Result<String, BridgeError> {
    let Some(branch_id) = branch_id else {
        return Ok(TOPOLOGY_SETTING_KEY.to_owned());
    };
    if branch_id.trim().is_empty()
        || branch_id.len() > 200
        || branch_id.chars().any(|ch| ch.is_control() || ch == '/')
    {
        return Err(BridgeError::Invalid(
            "topology branch id contains invalid characters".into(),
        ));
    }
    Ok(format!("{TOPOLOGY_SETTING_KEY}/{branch_id}"))
}

/// Validate a merchant-supplied template name and return its stored form.
///
/// The name becomes a segment of the settings key, so it is checked the way
/// [`topology_setting_key`] checks a branch id rather than the way a display
/// label is checked: trimmed, non-empty, bounded in length, and free of
/// separators that would let one template forge a key outside the template
/// namespace. Whitespace inside a name is kept — "Weekend Setup" is a fine
/// template name.
pub fn normalize_template_name(raw: &str) -> Result<String, BridgeError> {
    let name = raw.trim();
    if name.is_empty() {
        return Err(BridgeError::Invalid("template name is empty".into()));
    }
    if name.chars().count() > MAX_TEMPLATE_NAME_CHARS {
        return Err(BridgeError::Invalid(format!(
            "template name exceeds {MAX_TEMPLATE_NAME_CHARS} characters"
        )));
    }
    if name
        .chars()
        .any(|ch| ch.is_control() || ch == '/' || ch == '\\')
    {
        return Err(BridgeError::Invalid(
            "template name contains invalid characters".into(),
        ));
    }
    Ok(name.to_owned())
}

/// Settings key for one template under one branch's topology key.
pub fn template_setting_key(topology_key: &str, name: &str) -> String {
    format!("{topology_key}/{TOPOLOGY_TEMPLATE_SEGMENT}/{name}")
}

/// Shared prefix of every template under one branch's topology key.
pub fn template_key_prefix(topology_key: &str) -> String {
    format!("{topology_key}/{TOPOLOGY_TEMPLATE_SEGMENT}/")
}

/// Save a diagram template. `payload` is the serialized canvas, opaque to the
/// backend: a template is a starting point a merchant edits before Apply, so it
/// deliberately does NOT run the diagram gates that `apply_topology_diff` runs.
pub fn template_save(
    conn: &Connection,
    topology_key: &str,
    raw_name: &str,
    payload: &Value,
) -> Result<(), BridgeError> {
    let name = normalize_template_name(raw_name)?;
    let key = template_setting_key(topology_key, &name);
    let json = serde_json::to_string(payload)
        .map_err(|e| BridgeError::Internal(format!("serialize topology template: {e}")))?;
    kasirmu_core::Settings::set(conn, &key, &json)?;
    Ok(())
}

/// Load one diagram template, or `None` when it was never saved or has become
/// unreadable. A corrupt template is reported as absent rather than as an error:
/// the list is built from keys, so one bad row must not brick the whole panel.
pub fn template_load(
    conn: &Connection,
    topology_key: &str,
    raw_name: &str,
) -> Result<Option<Value>, BridgeError> {
    let name = normalize_template_name(raw_name)?;
    let key = template_setting_key(topology_key, &name);
    let Some(raw) = kasirmu_core::Settings::get(conn, &key)? else {
        return Ok(None);
    };
    Ok(serde_json::from_str(&raw).ok())
}

/// Names of a branch's templates, sorted for a stable list.
///
/// Scoped to a key prefix in SQL instead of `Settings::load_all`, which would
/// deserialize every stored setting — including every branch's diagram envelope
/// and runtime plan — merely to list a handful of names. The `LIKE` is only an
/// index-friendly prefilter: `%` and `_` are legal in a branch id and would
/// over-match, so each candidate is still checked with `starts_with`.
pub fn template_list(conn: &Connection, topology_key: &str) -> Result<Vec<String>, BridgeError> {
    let prefix = template_key_prefix(topology_key);
    let mut stmt = conn.prepare("SELECT key FROM settings WHERE key LIKE ?1 || '%'")?;
    let names = stmt
        .query_map(rusqlite::params![prefix], |row| row.get::<_, String>(0))?
        .filter_map(|r| r.ok())
        .filter_map(|key| {
            key.strip_prefix(&prefix)
                .filter(|name| !name.is_empty() && !name.contains('/'))
                .map(str::to_owned)
        })
        .collect();
    Ok(sort_template_names(names))
}

/// Delete one template. Returns `false` when it did not exist.
pub fn template_delete(
    conn: &Connection,
    topology_key: &str,
    raw_name: &str,
) -> Result<bool, BridgeError> {
    let name = normalize_template_name(raw_name)?;
    let key = template_setting_key(topology_key, &name);
    Ok(kasirmu_core::Settings::remove(conn, &key)?)
}

/// Sort template names for the list. Case-insensitive with a case-sensitive
/// tiebreak so "café", "Café" and "apple" land in the order a merchant reads
/// them, deterministically, on every platform.
pub fn sort_template_names(mut names: Vec<String>) -> Vec<String> {
    names.sort_by(|a, b| {
        a.to_lowercase()
            .cmp(&b.to_lowercase())
            .then_with(|| a.cmp(b))
    });
    names
}

/// Save a versioned topology envelope under a settings key.
///
/// Runs the semantic-ownership and diagram-payload gates, then writes the
/// diagram and its compiled runtime plan in one IMMEDIATE transaction,
/// bumping the revision. With `expected_revision`, a concurrent writer that
/// committed first aborts this save with a `topology-revision-conflict`.
/// When `request` is given, the request ledger is persisted and the Apply
/// recovery journal is cleared in the same transaction.
///
/// When `revision_ctx` is given, an immutable revision row is written to
/// `topology_revisions` in THIS transaction (ADR #46 §3). The caller must NOT
/// write it instead: outside this transaction, history can either survive a
/// compensated Apply or go missing after a committed one. `None` is for the
/// `#[cfg(test)]` save helper, which is not a publish.
///
/// `branch_registry` (ADR #7): when given, the canonical Branch Location
/// profile may live in EITHER `conn` (global registry) or this connection
/// (the session store's database, where the scoped profile family writes
/// branch profiles). Pass `None` for single-registry callers and tests.
///
/// CONTRACT — callers must gate; this is not safe to call directly. It re-runs
/// semantic OWNERSHIP only (`validate_semantic_ownership[_in]` above, its first
/// statements), and nothing else: `validate_apply_gate`'s canonical-semantic
/// and structural checks, `validate_warehouse_quota`, `validate_warehouse_capacity`
/// and the session/entitlement resolution are the CALLER's, all of which
/// `commands.rs` runs before it reaches this function at `:944`. A client that
/// saves through this helper without them can publish a diagram the Apply
/// command would reject — the hazard M4 (`todo-topology-editor.md:408`) exists
/// to close.
///
/// STAYS `pub`, and the reason is a LIVE caller, not a shim: the desktop
/// test build reaches it through a three-link chain —
/// `apps/desktop-tauri/src/commands/topology/topology_command_tests.rs:55`,
/// `:84`, `:92` call the `#[cfg(test)]` command harness
/// `commands.rs:236 save_topology`, which calls
/// `persistence.rs:221 save_topology_json_at_key` (also `#[cfg(test)]`), which
/// calls the adapter at `:154`, which calls THIS function at `:165`. Its
/// sibling `validate_warehouse_quota` had no such chain — that adapter was
/// unreferenced and is now deleted, which let the quota helper go
/// `pub(crate)`; this one cannot follow until the round-trip harness is
/// rehomed, which is an `apps/**` change with its own owner.
#[allow(clippy::too_many_arguments)]
pub fn save_topology_json_at_key_with_revision(
    conn: &Connection,
    nodes: Vec<Value>,
    wires: Vec<Value>,
    setting_key: &str,
    resolved_issue_keys: &[String],
    expected_revision: Option<u64>,
    request: Option<(&str, &str)>,
    branch_registry: Option<&Connection>,
    revision_ctx: Option<&TopologyRevisionContext<'_>>,
) -> Result<u64, BridgeError> {
    // Thin adapter over the registries form (R4 alignment): one optional
    // extra registry becomes the two-element slice Apply used before the
    // target store joined it; the 40-odd test callers keep this shape.
    let registries: Vec<&Connection> = match branch_registry {
        Some(b) => vec![conn, b],
        None => vec![conn],
    };
    save_topology_json_at_key_with_registries(
        conn,
        nodes,
        wires,
        setting_key,
        resolved_issue_keys,
        expected_revision,
        request,
        &registries,
        revision_ctx,
    )
}

/// The registries form of the save-boundary ownership re-check.
///
/// `ownership_registries` is the caller's FULL set — every database whose
/// `locations` table may vouch for the canonical Branch Location profile.
/// Production Apply passes `[global, session, effective]` (R4, ruled
/// 2026-09-16, mirroring `validate_apply_gate`'s slice at its call site:
/// the save boundary that did NOT consult the target registry was the second
/// site of the same class and is the reason the R4 referee test
/// (`self_describing_store_passes_the_ownership_gate`) failed here first).
/// `conn` (the settings database the envelope lands in) is not implicit —
/// pass it explicitly as the first element; the old single-`branch_registry`
/// adapter constructs exactly `[conn]` or `[conn, b]`.
///
/// CONTRACT — callers must gate; this is not safe to call directly. It re-runs
/// semantic OWNERSHIP only (`validate_semantic_ownership_in`, its first
/// statement), and nothing else: `validate_apply_gate`'s canonical-semantic
/// and structural checks, `validate_warehouse_quota`, `validate_warehouse_capacity`
/// and the session/entitlement resolution are the CALLER's. A client that
/// saves through this helper without them can publish a diagram the Apply
/// command would reject — the hazard M4 (`todo-topology-editor.md:408`) exists
/// to close.
#[allow(clippy::too_many_arguments)]
pub fn save_topology_json_at_key_with_registries(
    conn: &Connection,
    nodes: Vec<Value>,
    wires: Vec<Value>,
    setting_key: &str,
    resolved_issue_keys: &[String],
    expected_revision: Option<u64>,
    request: Option<(&str, &str)>,
    ownership_registries: &[&Connection],
    revision_ctx: Option<&TopologyRevisionContext<'_>>,
) -> Result<u64, BridgeError> {
    validate_semantic_ownership_in(ownership_registries, &nodes, &wires)?;
    // The legacy typed structs validate geometry and known serialized node
    // kinds. `branch-location` is a semantic alias, so normalize only the
    // temporary validation copy; the raw command payload is persisted intact.
    validate_diagram_payloads(&nodes, &wires)?;
    // IMMEDIATE transaction: BEGIN takes the reserved write lock up front, so
    // the revision read + conflict check below are atomic against peer
    // writers. Previously the read ran outside any lock (TOCTOU) — a
    // concurrent writer could commit between this read and this save's
    // commit, and both saves would succeed, silently dropping the peer's
    // revision (lost update). Serializing writers at BEGIN means a save that
    // blocks on a peer re-reads the fresh revision after the peer commits and
    // is rejected with a conflict.
    let tx = Transaction::new_unchecked(conn, TransactionBehavior::Immediate)?;
    let current_revision = current_topology_revision(&tx, setting_key)?;
    if let Some(expected) = expected_revision
        && expected != current_revision
    {
        return Err(topology_validation(
            "topology-revision-conflict",
            None,
            None,
            None,
            format!("topology revision conflict: expected {expected}, current {current_revision}"),
        ));
    }
    let revision = current_revision.saturating_add(1);
    let runtime_key = topology_runtime_setting_key(setting_key)?;
    let runtime_branch_id = setting_key
        .strip_prefix(&format!("{TOPOLOGY_SETTING_KEY}/"))
        .map(str::to_owned);
    // Owned copy taken before `runtime_branch_id` moves into the compiler
    // below. Cloned rather than re-derived so the settings-key prefix rule
    // stays defined in exactly one place; a branch id is short and this runs
    // once per Apply.
    //
    // `unwrap_or_default()` yields `""` for the unscoped legacy graph, and the
    // revision row stores `""` rather than NULL for the reason the migration
    // header gives: UNIQUE ignores NULLs in both engines, so a nullable branch
    // would let the unscoped graph reuse a revision number.
    let revision_branch_id = runtime_branch_id.clone().unwrap_or_default();
    let runtime_plan = compile_topology_runtime_plan(&nodes, &wires, runtime_branch_id);
    let runtime_json = serde_json::to_string(&runtime_plan)
        .map_err(|e| BridgeError::Internal(format!("serialize topology runtime plan: {e}")))?;
    let json = topology_envelope_json(&nodes, &wires, revision, resolved_issue_keys)?;
    kasirmu_core::Settings::set(&tx, setting_key, &json)?;
    kasirmu_core::Settings::set(&tx, &runtime_key, &runtime_json)?;
    if let Some((request_key, fingerprint)) = request {
        let ledger = topology_apply_ledger_json(revision, fingerprint)?;
        kasirmu_core::Settings::set(&tx, request_key, &ledger)?;
        kasirmu_core::Settings::remove(&tx, TOPOLOGY_APPLY_RECOVERY_KEY)?;
    }
    // ADR #46 §3: the revision row commits or rolls back with the envelope.
    // Placed after the envelope write so `json` is recorded byte-identically
    // to what `settings` now holds — a revision must be self-contained and
    // needs no reconstruction (§2).
    if let Some(ctx) = revision_ctx {
        insert_topology_revision(
            &tx,
            &revision_branch_id,
            revision,
            &json,
            nodes.len(),
            wires.len(),
            ctx,
        )?;
    }
    tx.commit()?;
    Ok(revision)
}

/// Snapshot of a workspace row touched by a topology Apply.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceApplySnapshot {
    id: String,
    name: String,
    description: String,
    colour: Option<String>,
    purpose_key: String,
    status: String,
}

/// Persisted cross-database Apply recovery journal record.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopologyApplyRecovery {
    /// Store the Apply is scoped to (cross-database compensation identity).
    pub store_id: String,
    /// Branch the topology diff belongs to, when scoped.
    #[serde(default)]
    pub topology_branch_id: Option<String>,
    /// Workspace instance creations to replay on compensation.
    pub creations: Vec<CreateInstanceRequest>,
    /// Pre-mutation workspace row snapshots for restore-on-failure.
    pub snapshots: Vec<WorkspaceApplySnapshot>,
    /// Exact previous topology setting JSON to restore on compensation.
    pub previous_topology: Option<String>,
    /// Exact canonical diagram JSON expected after the Apply. Recovery uses
    /// it to distinguish a crash before the global write from a crash after
    /// it, because the workspace and global databases cannot share a SQLite
    /// transaction.
    #[serde(default)]
    pub desired_topology: Option<String>,
}

/// Restore the topology setting after a compensating Apply failure.
///
/// Diagram settings and workspace instances live in separate SQLite
/// databases, so Apply uses a forward-write plus compensation boundary. The
/// restore itself is transactional and preserves the exact prior raw setting,
/// including legacy envelopes.
pub fn restore_topology_setting(
    conn: &Connection,
    setting_key: &str,
    previous: Option<&str>,
) -> Result<(), BridgeError> {
    let tx = conn.unchecked_transaction()?;
    match previous {
        Some(json) => kasirmu_core::Settings::set(&tx, setting_key, json)?,
        None => {
            kasirmu_core::Settings::remove(&tx, setting_key)?;
        }
    }
    tx.commit()?;
    Ok(())
}

/// Persist the Apply compensation journal for crash-recovery replay.
pub fn persist_topology_recovery(
    conn: &Connection,
    recovery: &TopologyApplyRecovery,
) -> Result<(), BridgeError> {
    let json = serde_json::to_string(recovery)
        .map_err(|e| BridgeError::Internal(format!("serialize topology recovery: {e}")))?;
    let tx = conn.unchecked_transaction()?;
    kasirmu_core::Settings::set(&tx, TOPOLOGY_APPLY_RECOVERY_KEY, &json)?;
    tx.commit()?;
    Ok(())
}

/// Remove the Apply compensation journal once both databases are settled.
pub fn clear_topology_recovery(conn: &Connection) -> Result<(), BridgeError> {
    let tx = conn.unchecked_transaction()?;
    kasirmu_core::Settings::remove(&tx, TOPOLOGY_APPLY_RECOVERY_KEY)?;
    tx.commit()?;
    Ok(())
}

/// Complete a previously interrupted cross-database Apply before accepting a
/// new mutation. The journal is intentionally retained until both databases
/// are restored, making compensation retryable after a process crash or
/// transient database lock.
pub async fn recover_pending_topology_apply_at_startup(
    db: &tokio::sync::Mutex<Connection>,
    db_manager: &StoreDatabaseManager,
    apply_lock: &tokio::sync::Mutex<()>,
) -> Result<(), BridgeError> {
    let expected_store_id = {
        let db = db.lock().await;
        let Some(raw) = kasirmu_core::Settings::get(&db, TOPOLOGY_APPLY_RECOVERY_KEY)? else {
            return Ok(());
        };
        serde_json::from_str::<TopologyApplyRecovery>(&raw)
            .map(|recovery| recovery.store_id)
            .map_err(|e| BridgeError::Internal(format!("invalid topology recovery journal: {e}")))?
    };
    let _apply_guard = apply_lock.lock().await;
    recover_pending_topology_apply(db, db_manager, &expected_store_id).await
}

/// Replay or compensate a pending cross-database Apply for one store.
///
/// Shared by the startup recovery daemon and the tests; verifies the journal
/// belongs to the expected store before touching either database.
///
/// Precondition: the caller must already hold the topology apply lock (see
/// [`recover_pending_topology_apply_at_startup`]) and must have authorized the
/// topology write through the command-layer gate; this helper performs no
/// permission gate of its own.
pub async fn recover_pending_topology_apply(
    db: &tokio::sync::Mutex<Connection>,
    db_manager: &StoreDatabaseManager,
    expected_store_id: &str,
) -> Result<(), BridgeError> {
    let recovery = {
        let db = db.lock().await;
        kasirmu_core::Settings::get(&db, TOPOLOGY_APPLY_RECOVERY_KEY)?
            .map(|json| serde_json::from_str::<TopologyApplyRecovery>(&json))
            .transpose()
            .map_err(|e| BridgeError::Internal(format!("invalid topology recovery journal: {e}")))?
    };
    let Some(recovery) = recovery else {
        return Ok(());
    };
    if recovery.store_id != expected_store_id {
        return Err(BridgeError::Internal(format!(
            "topology Apply recovery is pending for store {}, not {}",
            recovery.store_id, expected_store_id
        )));
    }
    // If the desired diagram is already present, the process crashed after
    // the global commit but before clearing the journal. Do not compensate a
    // successful Apply; simply finalize the journal.
    if let Some(desired) = recovery.desired_topology.as_deref() {
        let current = {
            let db = db.lock().await;
            let key = topology_setting_key(recovery.topology_branch_id.as_deref())?;
            kasirmu_core::Settings::get(&db, &key)?
        };
        if current.as_deref() == Some(desired) {
            let db = db.lock().await;
            clear_topology_recovery(&db)?;
            return Ok(());
        }
    }
    compensate_workspace_diff(
        db_manager,
        &recovery.store_id,
        &recovery.creations,
        &recovery.snapshots,
    )
    .await?;
    {
        let db = db.lock().await;
        let setting_key = topology_setting_key(recovery.topology_branch_id.as_deref())?;
        restore_topology_setting(&db, &setting_key, recovery.previous_topology.as_deref())?;
        clear_topology_recovery(&db)?;
    }
    Ok(())
}

/// Capture rows that the workspace portion of Apply will update or archive.
///
/// Precondition: internally ungated - call only from inside an authorized
/// topology Apply (the command layer holds the apply lock and the
/// `topology_settings_write` gate there); this helper locks the store
/// connection itself and needs no caller-held lock.
pub async fn snapshot_workspace_rows(
    db_manager: &StoreDatabaseManager,
    store_id: &str,
    updates: &[UpdateInstanceRequest],
    archives: &[String],
) -> Result<Vec<WorkspaceApplySnapshot>, BridgeError> {
    let conn = db_manager
        .open_store(store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db for compensation: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock for compensation: {e}")))?;
    let mut ids = std::collections::HashSet::new();
    ids.extend(updates.iter().map(|item| item.id.as_str()));
    ids.extend(archives.iter().map(String::as_str));
    let mut snapshots = Vec::with_capacity(ids.len());
    for id in ids {
        let row = db
            .query_row(
                "SELECT id, name, description, colour, purpose_key, status FROM workspace_instances WHERE id = ?1",
                rusqlite::params![id],
                |row| {
                    Ok(WorkspaceApplySnapshot {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        description: row.get(2)?,
                        colour: row.get(3)?,
                        purpose_key: row.get(4)?,
                        status: row.get(5)?,
                    })
                },
            )
            .map_err(|e| BridgeError::Internal(format!("snapshot workspace {id}: {e}")))?;
        snapshots.push(row);
    }
    Ok(snapshots)
}

/// Compensate workspace mutations after a global diagram write fails.
///
/// Precondition: internally ungated - call only to roll back an already
/// authorized topology Apply whose global write failed (the command layer
/// holds the apply lock and the `topology_settings_write` gate in that
/// window); this helper locks the store connection itself and writes in one
/// transaction.
pub async fn compensate_workspace_diff(
    db_manager: &StoreDatabaseManager,
    store_id: &str,
    creations: &[CreateInstanceRequest],
    snapshots: &[WorkspaceApplySnapshot],
) -> Result<(), BridgeError> {
    let conn = db_manager
        .open_store(store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db for rollback: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock for rollback: {e}")))?;
    let tx = db.unchecked_transaction()?;
    for creation in creations {
        tx.execute(
            "DELETE FROM workspace_instances WHERE id = ?1",
            rusqlite::params![creation.id],
        )?;
    }
    for snapshot in snapshots {
        tx.execute(
            "UPDATE workspace_instances
             SET name = ?2, description = ?3, colour = ?4, purpose_key = ?5,
                 status = ?6, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?1",
            rusqlite::params![
                snapshot.id,
                snapshot.name,
                snapshot.description,
                snapshot.colour,
                snapshot.purpose_key,
                snapshot.status,
            ],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// Verify the canonical Branch Location exists in the given registry
/// database.
///
/// Single-registry form of [`validate_semantic_ownership_in`]; see it for
/// the ownership contract and the ADR #7 rationale for multiple
/// registries.
pub fn validate_semantic_ownership(
    conn: &Connection,
    nodes: &[Value],
    wires: &[Value],
) -> Result<(), BridgeError> {
    validate_semantic_ownership_in(&[conn], nodes, wires)
}

/// Verify the canonical Branch Location exists in at least one of the
/// given registry databases.
///
/// ADR #7: the scoped store-profile family (create/list/delete) writes
/// branch profiles into the **session store's** database, while the global
/// database only carries the seeded default profile. A branch created
/// after bootstrap therefore never appears in the global registry, and a
/// diagram referencing it must not be rejected with
/// `unknown-branch-location`. Ownership passes when the profile id exists
/// in ANY registry; the semantic-shape checks (missing/multiple branch
/// locations) still run once, on the first registry.
pub fn validate_semantic_ownership_in(
    registries: &[&Connection],
    nodes: &[Value],
    wires: &[Value],
) -> Result<(), BridgeError> {
    validate_semantic_json(nodes, wires)?;
    if !has_semantic_fields(nodes, wires) {
        return Ok(());
    }
    let Some(profile_id) = semantic_branch_profile_id(nodes, wires) else {
        return Ok(());
    };
    for conn in registries {
        let exists: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM locations WHERE id = ?1)",
            rusqlite::params![profile_id],
            |row| row.get(0),
        )?;
        if exists {
            return Ok(());
        }
    }
    Err(topology_validation(
        "unknown-branch-location",
        None,
        None,
        None,
        format!("Branch Location references unknown store_profile_id: {profile_id}"),
    ))
}

/// Pre-mutation validation gate for a topology Apply.
///
/// Rejects malformed diagrams BEFORE any workspace creation, update, or
/// archival. The semantic ownership checks are DB-backed (branch identity
/// must exist); the structural checks (duplicate node/wire ids, unknown
/// node types, unknown directions/ports, ghost endpoints) must also run
/// here — running them only at the final save would let a malformed
/// diagram mutate workspace rows and then fail at save, forcing the
/// compensation cycle to unwind a partial apply.
///
/// CONTRACT — this is the gate, not a helper behind it: a caller that mutates
/// workspaces or saves an envelope without having run it first has skipped the
/// only place the canonical semantic shape is required. Production runs it
/// from `apply_topology_diff`'s ownership block in
/// `crates/kasirmu-bridge/src/topology/commands.rs` (the `validate_apply_gate`
/// call), before the workspace block — by name, not line number, because
/// R4 moved the block the old `commands.rs:561` citation pointed at.
///
/// NARROWED to `pub(crate)` (M4, `todo-topology-editor.md:408`). Its whole
/// caller set is inside this crate — `commands.rs:561` plus the mounted
/// `topology_tests.rs` cases — and, unlike its two sibling helpers, no shell
/// adapter names it, so a third client cannot reach an ungated copy of it.
pub(crate) fn validate_apply_gate(
    registries: &[&Connection],
    nodes: &[Value],
    wires: &[Value],
) -> Result<(), BridgeError> {
    // Production Apply is the strict semantic boundary. Legacy geometric
    // payloads remain readable by the low-level load/save compatibility
    // helpers, but they must not bypass ownership and entitlement checks on
    // the authenticated mutation command.
    if !has_semantic_fields(nodes, wires) {
        return Err(topology_validation(
            "semantic-contract-required",
            None,
            None,
            None,
            "topology Apply requires canonical semantic node and wire fields",
        ));
    }
    validate_semantic_ownership_in(registries, nodes, wires)?;
    validate_diagram_payloads(nodes, wires)
}

/// Enforce the subscription-tier warehouse count quota for a topology save.
///
/// CONTRACT — callers must gate; this is not safe to call directly. It checks
/// ONE axis (tier × warehouse count) and no others: not `validate_apply_gate`
/// (semantic shape, ownership, structural validity), not
/// `validate_warehouse_capacity`, not session authority, not the revision
/// conflict. A command that reaches for this helper alone has bypassed every
/// other gate on the path. Production calls it at `commands.rs:638`, after the
/// apply gate and before any save.
///
/// NARROWED to `pub(crate)` (M4, `todo-topology-editor.md:408`, finished by
/// the follow-up that deleted the desktop shell's `#[allow(dead_code)]`
/// `validate_warehouse_quota` adapter — the only out-of-crate reference). Its
/// remaining callers are all in this crate: `commands.rs:638` on the Apply path
/// plus the mounted `persistence_tests.rs` and `topology_command_tests.rs`
/// cases, so no client can reach a quota check that skipped the gates above it.
pub(crate) fn validate_warehouse_quota(
    nodes: &[Value],
    tier: &kasirmu_core::subscription::SubscriptionTier,
) -> Result<(), BridgeError> {
    if let Some(limit) = tier.max_warehouses()
        && nodes
            .iter()
            .filter(|node| value_string(node, "type") == Some("warehouse"))
            .count() as i64
            > limit
    {
        return Err(BridgeError::PermissionDenied(format!(
            "topology warehouse quota exceeded: limit {limit}"
        )));
    }
    Ok(())
}

/// Enforce the backend-owned warehouse capacity invariant for tiers that
/// expose capacity-aware routing. UI validation remains useful feedback, but
/// a direct IPC caller must not be able to route stock into a full warehouse.
pub fn validate_warehouse_capacity(
    nodes: &[Value],
    wires: &[Value],
    tier: &kasirmu_core::subscription::SubscriptionTier,
    resolved_issue_keys: &[String],
) -> Result<(), BridgeError> {
    if !matches!(
        tier,
        kasirmu_core::subscription::SubscriptionTier::Pro
            | kasirmu_core::subscription::SubscriptionTier::Premium
            | kasirmu_core::subscription::SubscriptionTier::Enterprise
    ) {
        return Ok(());
    }
    for warehouse in nodes
        .iter()
        .filter(|node| semantic_node_type(node) == Some("warehouse"))
    {
        let Some(metadata) = warehouse.get("metadata") else {
            continue;
        };
        let Some(stock) = metadata.get("stock").and_then(Value::as_f64) else {
            continue;
        };
        let Some(capacity) = metadata.get("capacity").and_then(Value::as_f64) else {
            continue;
        };
        let warehouse_id = value_string(warehouse, "id");
        if stock >= capacity
            && let Some(wire) = wires.iter().find(|wire| {
                value_string(wire, "to_node_id") == warehouse_id
                    && is_warehouse_operational_input_port(value_string(wire, "to_port_id"))
                    && matches!(
                        value_string(wire, "relationship_type"),
                        Some("stock-routing" | "inventory-transfer")
                    )
            })
        {
            return Err(topology_validation(
                "warehouse-at-capacity",
                warehouse_id,
                value_string(wire, "id"),
                value_string(wire, "to_port_id"),
                format!(
                    "warehouse {} is at capacity ({stock}/{capacity})",
                    warehouse_id.unwrap_or("<unknown>")
                ),
            ));
        }

        // A capacity-aware warehouse with room must have an operational
        // stock/transfer route unless the user explicitly dismissed this
        // branch-scoped prompt in the topology document. This mirrors the
        // frontend contract but remains authoritative for direct IPC callers.
        if stock < capacity {
            let has_operational_route = wires.iter().any(|wire| {
                value_string(wire, "to_node_id") == warehouse_id
                    && is_warehouse_operational_input_port(value_string(wire, "to_port_id"))
                    && matches!(
                        value_string(wire, "relationship_type"),
                        Some("stock-routing" | "inventory-transfer")
                    )
            });
            let issue_key = format!(
                "node:{}:topology-validation-warehouse-missing-stock-routing",
                warehouse_id.unwrap_or_default()
            );
            if !has_operational_route && !resolved_issue_keys.iter().any(|key| key == &issue_key) {
                return Err(topology_validation(
                    "warehouse-missing-stock-routing",
                    warehouse_id,
                    None,
                    None,
                    format!(
                        "warehouse {} has capacity but no operational stock or transfer route",
                        warehouse_id.unwrap_or("<unknown>")
                    ),
                ));
            }
        }
    }
    Ok(())
}

/// Parse raw diagram values into the legacy typed payloads and run the
/// structural validator (duplicate ids, unknown types/directions/ports,
/// ghost endpoints) without persisting them. `branch-location` is a
/// semantic alias, so normalize it only for the temporary validation copy;
/// the raw command payload is persisted intact.
pub fn validate_diagram_payloads(nodes: &[Value], wires: &[Value]) -> Result<(), BridgeError> {
    let typed_node_values: Vec<Value> = nodes
        .iter()
        .map(|node| {
            let mut node = node.clone();
            if node.get("type").and_then(Value::as_str) == Some("branch-location") {
                node["type"] = Value::String("store".into());
            }
            node
        })
        .collect();
    let typed_nodes: Vec<TopologyNodePayload> =
        serde_json::from_value(Value::Array(typed_node_values))
            .map_err(|e| BridgeError::Internal(format!("invalid topology nodes: {e}")))?;
    let typed_wires: Vec<TopologyWirePayload> =
        serde_json::from_value(Value::Array(wires.to_vec()))
            .map_err(|e| BridgeError::Internal(format!("invalid topology wires: {e}")))?;
    // Reuse the existing structural validator without persisting its legacy
    // representation — the save callers write the raw command payload intact.
    validate_topology_structure(&typed_nodes, &typed_wires)
}

/// Validate typed node and wire structure without persisting it.
pub fn validate_topology_structure(
    nodes: &[TopologyNodePayload],
    wires: &[TopologyWirePayload],
) -> Result<(), BridgeError> {
    let mut node_ids = std::collections::HashSet::new();
    for node in nodes {
        if !node_ids.insert(&node.id) {
            return Err(BridgeError::Internal(format!(
                "duplicate node id: {}",
                node.id
            )));
        }
        if node.node_type == NodeType::Unknown {
            return Err(BridgeError::Internal(format!(
                "node {} has unknown type",
                node.id
            )));
        }
    }
    let mut wire_ids = std::collections::HashSet::new();
    for wire in wires {
        if !wire_ids.insert(&wire.id) {
            return Err(BridgeError::Internal(format!(
                "duplicate wire id: {}",
                wire.id
            )));
        }
        if wire.direction == WireDirection::Unknown {
            return Err(BridgeError::Internal(format!(
                "wire {} has unknown direction",
                wire.id
            )));
        }
        if wire.from_port == Some(PortName::Unknown) || wire.to_port == Some(PortName::Unknown) {
            return Err(BridgeError::Internal(format!(
                "wire {} has unknown port",
                wire.id
            )));
        }
        if !node_ids.contains(&wire.from_node_id) {
            return Err(BridgeError::Internal(format!(
                "wire {} references unknown from_node_id: {}",
                wire.id, wire.from_node_id
            )));
        }
        if !node_ids.contains(&wire.to_node_id) {
            return Err(BridgeError::Internal(format!(
                "wire {} references unknown to_node_id: {}",
                wire.id, wire.to_node_id
            )));
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "persistence_tests.rs"]
mod persistence_tests;

#[cfg(test)]
#[path = "topology_persistence_tests.rs"]
mod topology_persistence_tests;
