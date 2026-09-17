//! Tauri command bodies for the node topology: capability probe, diagram
//! templates, load, revisions, and the atomic Apply diff.
//!
//! Ported verbatim from `apps/desktop-client/src/commands/topology/commands.rs`
//! (Wave E, e) as the last leaf of the `kasirmu_bridge::topology` mirror, after
//! model, semantics, revisions and persistence, so its four `super::` device
//! lines all resolve here. The desktop file keeps the `#[tauri::command]`
//! shims; every fn takes `ctx: &BridgeCtx<'_>` first and answers in
//! `BridgeError`.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use kasirmu_core::permissions;
use kasirmu_core::subscription::TenantSubscription;
use kasirmu_core::topology::semantic_branch_profile_id;

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;
use crate::workspaces::CreateInstanceRequest;

use super::model::*;
use super::persistence::*;
use super::revisions::*;
use super::semantics::*;

// ── Commands ───────────────────────────────────────────────────────

/// Return whether the authenticated session can save topology changes.
///
/// The frontend uses this capability probe for UI gating; the Apply command
/// repeats the permission check server-side and remains authoritative.
///
/// R2 (todo-topology-editor.md §5, ruled 2026-09-16): topology is a
/// LOCATION-SCOPED tool, so the probe answers through the SAME scoped gate
/// `authorize_topology_write` and Apply use — a writer whose assignment
/// excludes the branch must hear "no" from the probe, not learn it by
/// authoring a diagram that dies at Apply. Global assignments and legacy
/// users without an assignment row stay unrestricted by the scoped checker
/// itself (`ctx.rs` — the same carve-outs the enforcement respects).
pub async fn can_save_topology(
    ctx: &BridgeCtx<'_>,
    session_token: String,
    branch_id: Option<String>,
) -> Result<bool, BridgeError> {
    let session = ctx.resolve_session(&session_token)?;
    {
        let global_db = ctx.db.lock().await;
        let global_store = ctx.store(&global_db);
        ctx.require_user_permission_scoped(
            &global_store,
            &session.user_id,
            permissions::TOPOLOGY_WRITE,
            branch_id.as_deref(),
            None,
        )?;
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
pub async fn authorize_topology_write(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    branch_id: Option<&str>,
) -> Result<String, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    // Topology mutation requires topology:write with branch scope (todo-global-saas-1.md §I).
    {
        let global_db = ctx.db.lock().await;
        let global_store = ctx.store(&global_db);
        ctx.require_user_permission_scoped(
            &global_store,
            &session.user_id,
            permissions::TOPOLOGY_WRITE,
            branch_id,
            None,
        )?;
    }
    topology_setting_key(branch_id)
}

/// Save a diagram template under a branch, replacing any template of that name.
pub async fn save_topology_template(
    ctx: &BridgeCtx<'_>,
    session_token: String,
    name: String,
    payload: Value,
    branch_id: Option<String>,
) -> Result<(), BridgeError> {
    let topo_key = authorize_topology_write(ctx, &session_token, branch_id.as_deref()).await?;
    let conn = ctx.db.lock().await;
    template_save(&conn, &topo_key, &name, &payload)
}

/// Load one diagram template. `None` when it never existed or is unreadable.
pub async fn load_topology_template(
    ctx: &BridgeCtx<'_>,
    session_token: String,
    name: String,
    branch_id: Option<String>,
) -> Result<Option<Value>, BridgeError> {
    let topo_key = topology_setting_key(branch_id.as_deref())?;
    let session = ctx.resolve_session(&session_token)?;
    let conn = ctx.db.lock().await;
    // Reading a template reveals a branch's configuration, so it needs a
    // session — but not the write capability.
    let _ = &session.user_id;
    template_load(&conn, &topo_key, &name)
}

/// Names of a branch's saved templates, sorted for display.
pub async fn list_topology_templates(
    ctx: &BridgeCtx<'_>,
    session_token: String,
    branch_id: Option<String>,
) -> Result<Vec<String>, BridgeError> {
    let topo_key = topology_setting_key(branch_id.as_deref())?;
    ctx.resolve_session(&session_token)?;
    let conn = ctx.db.lock().await;
    template_list(&conn, &topo_key)
}

/// Delete one template. Returns `false` when there was nothing to delete.
pub async fn delete_topology_template(
    ctx: &BridgeCtx<'_>,
    session_token: String,
    name: String,
    branch_id: Option<String>,
) -> Result<bool, BridgeError> {
    let topo_key = authorize_topology_write(ctx, &session_token, branch_id.as_deref()).await?;
    let conn = ctx.db.lock().await;
    template_delete(&conn, &topo_key, &name)
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
pub async fn load_topology(
    ctx: &BridgeCtx<'_>,
    // R1 (todo-topology-editor.md §5, ruled 2026-09-16): this read requires
    // a session, mirroring load_topology_template — the parameter landed in
    // all three layers before the body enforced it, so the session test in
    // `topology_command_tests.rs` failed for the RIGHT reason (behavior,
    // not compile) against the stage-1 body.
    session_token: String,
    branch_id: Option<String>,
) -> Result<Option<Value>, BridgeError> {
    let setting_key = topology_setting_key(branch_id.as_deref())?;
    // Resolve BEFORE the settings lookup: an unauthorized caller learns
    // nothing about whether a diagram exists, in this branch or any other.
    ctx.resolve_session(&session_token)?;
    let conn = ctx.db.lock().await;
    let raw = match kasirmu_core::Settings::get(&conn, &setting_key)? {
        Some(json) => Some(json),
        None => {
            // Migrate only an old diagram whose canonical branch identity
            // proves it belongs to this branch. Ambiguous legacy geometry is
            // left unassigned rather than leaked into every branch.
            let Some(branch_id) = branch_id.as_deref() else {
                return Ok(None);
            };
            let Some(legacy_json) = kasirmu_core::Settings::get(&conn, TOPOLOGY_SETTING_KEY)? else {
                return Ok(None);
            };
            let value: Value = serde_json::from_str(&legacy_json)
                .map_err(|e| BridgeError::Internal(format!("invalid topology JSON: {e}")))?;
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
        .map_err(|e| BridgeError::Internal(format!("invalid topology JSON: {e}")))?;
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

/// One revision's graph, as returned to the browser.
///
/// `status` carries the three-way distinction rather than an error: a
/// merchant browsing history who asks for a pruned deploy expects an answer,
/// not an exception. Collapsing `deflated` into `not-found` would make a
/// recorded deploy read as though it never happened — silently rewriting
/// history at the moment someone is reconstructing an incident (ADR #46 §4).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopologyRevisionGraphResult {
    /// `"restorable"` | `"deflated"` | `"not-found"`.
    pub status: &'static str,
    /// The revision that was asked for, echoed back for keyed rendering.
    pub revision: i64,
    /// Merchant-authored "what changed and why"; empty when not given.
    pub change_note: String,
    /// ISO-8601 commit time.
    pub published_at: String,
    /// Session user who Applied it.
    pub published_by: String,
    /// The contract the revision was authored under, so the browser can say
    /// WHY an old graph may not validate (ADR #46 §7) instead of failing
    /// opaquely. Absent for a deflated row, which has no graph to judge.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contract_schema_version: Option<i64>,
    /// The stored envelope, present only when `status == "restorable"`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagram: Option<Value>,
}

/// ADR #46 §4: pin or unpin one revision, exempting it from deflation.
///
/// Gated on `TOPOLOGY_WRITE`, deliberately unlike its two read siblings.
/// Reading history answers an auditor's question, so it rides `AUDIT_VIEW`;
/// pinning changes what stays RESTORABLE, which is an operational topology
/// decision and the same gate Apply itself needs. A user who cannot deploy
/// should not decide which deploys are protected. "The same gate" is now
/// literal (R2, ruled 2026-09-16): the check is scoped to the branch whose
/// revisions are being pinned, as Apply's is — the branch_id was already a
/// parameter; only the gate's scope was missing.
pub async fn pin_topology_revision(
    ctx: &BridgeCtx<'_>,
    session_token: String,
    branch_id: Option<String>,
    revision: i64,
    pinned: bool,
) -> Result<TopologyRevisionPinResult, BridgeError> {
    let session = ctx.resolve_session(&session_token)?;
    let global_db = ctx.db.lock().await;
    {
        let global_store = ctx.store(&global_db);
        ctx.require_user_permission_scoped(
            &global_store,
            &session.user_id,
            permissions::TOPOLOGY_WRITE,
            branch_id.as_deref(),
            None,
        )?;
    }
    set_topology_revision_pinned(
        &global_db,
        branch_id.as_deref().unwrap_or(""),
        revision,
        pinned,
    )
}

/// ADR #46 §1/§8: one branch's deploy history, newest first, metadata only.
///
/// Gated on `AUDIT_VIEW`, not `TOPOLOGY_WRITE`. Revision history answers the
/// same question the audit screen answers — who changed this, when, and why —
/// for the same audience, and `audit:view` already gates it. Gating on write
/// would deny a manager who has every right to read the record; inventing a
/// `topology:read` key would need role seeds and is out of scope (Rule 3).
pub async fn list_topology_revisions(
    ctx: &BridgeCtx<'_>,
    session_token: String,
    branch_id: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<TopologyRevisionSummary>, BridgeError> {
    let session = ctx.resolve_session(&session_token)?;
    let global_db = ctx.db.lock().await;
    {
        let global_store = ctx.store(&global_db);
        ctx.require_permission_for_user(&global_store, &session.user_id, permissions::AUDIT_VIEW)?;
    }
    // `""` is the unscoped legacy graph, the same convention the write path
    // and the retention sweep use.
    list_topology_revision_summaries(
        &global_db,
        branch_id.as_deref().unwrap_or(""),
        normalize_topology_revision_limit(limit),
    )
}

/// ADR #46 §5/§7: fetch one revision's graph, to diff it or load it as a
/// draft. Never mutates — restore-to-draft is a client-side action, and
/// re-Applying a past revision is out of scope for v1 (§5).
pub async fn load_topology_revision(
    ctx: &BridgeCtx<'_>,
    session_token: String,
    branch_id: Option<String>,
    revision: i64,
) -> Result<TopologyRevisionGraphResult, BridgeError> {
    let session = ctx.resolve_session(&session_token)?;
    let global_db = ctx.db.lock().await;
    {
        let global_store = ctx.store(&global_db);
        ctx.require_permission_for_user(&global_store, &session.user_id, permissions::AUDIT_VIEW)?;
    }
    let branch_id = branch_id.as_deref().unwrap_or("");
    match load_topology_revision_row(&global_db, branch_id, revision)? {
        TopologyRevisionLookup::NotFound => Ok(TopologyRevisionGraphResult {
            status: "not-found",
            revision,
            change_note: String::new(),
            published_at: String::new(),
            published_by: String::new(),
            contract_schema_version: None,
            diagram: None,
        }),
        TopologyRevisionLookup::Deflated {
            change_note,
            published_at,
            published_by,
        } => Ok(TopologyRevisionGraphResult {
            status: "deflated",
            revision,
            change_note,
            published_at,
            published_by,
            contract_schema_version: None,
            diagram: None,
        }),
        TopologyRevisionLookup::Restorable {
            change_note,
            published_at,
            published_by,
            contract_schema_version,
            envelope,
        } => {
            let diagram: Value = serde_json::from_str(&envelope).map_err(|e| {
                BridgeError::Internal(format!("invalid topology revision JSON: {e}"))
            })?;
            Ok(TopologyRevisionGraphResult {
                status: "restorable",
                revision,
                change_note,
                published_at,
                published_by,
                contract_schema_version: Some(contract_schema_version),
                diagram: Some(diagram),
            })
        }
    }
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
/// kasirmu-core). The update and archive steps delegate to
/// `Store::{update_workspace_instance,archive_instance}`, which use
/// `Connection::execute` directly and therefore compose safely inside
/// the outer transaction.
///
/// The topology diagram save is a separate step on the global DB. The command
/// snapshots the affected workspace rows and previous diagram, then compensates
/// both databases if the second write fails. A compensation failure is returned
/// explicitly so the caller can surface an operator-recovery condition.
#[allow(clippy::too_many_arguments)]
pub async fn apply_topology_diff(
    ctx: &BridgeCtx<'_>,
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
    // ADR #46 §6: "what changed and why", the commit-message equivalent.
    // Optional — an Apply is never blocked on a merchant writing a note.
    //
    // A plain comment, not `///`: doc comments are not permitted on function
    // parameters (only the built-in attributes are), and `model.rs:283-285`
    // records that this same mistake was already caught here once by
    // `clippy -D warnings`.
    change_note: Option<String>,
) -> Result<TopologyApplyResult, BridgeError> {
    // Validated FIRST, before the session lookup and long before the recovery
    // journal or the store transaction, so an over-long note costs a retry
    // rather than a deploy. See `normalize_topology_change_note` for why this
    // rejects instead of truncating.
    let change_note = normalize_topology_change_note(change_note.as_deref())?;
    let session = ctx.resolve_session(&session_token)?;
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
    let _apply_guard = ctx.topology_apply_lock.lock().await;
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

    // The diagram's Branch Location determines which store owns the workspace
    // instances — this may differ from the session's store (e.g. the admin
    // workspace is in store A but the topology references Branch Location B). Use the diagram's
    // storeProfileId as the authoritative scope for all workspace operations;
    // fall back to session.store_id for legacy graphs without semantic fields.
    let effective_store_id = semantic_branch_profile_id(&diagram_nodes, &diagram_wires)
        .map(str::to_owned)
        .unwrap_or_else(|| session.store_id.clone());
    tracing::info!(effective_store_id = %effective_store_id, session_store_id = %session.store_id, "topology Apply: effective store resolved");

    // Authorization: workspace topology changes require topology:write access
    // evaluated with location scope (todo-global-saas-1.md §I). A manager assigned
    // to Location A cannot apply topology changes to Location B.
    // The user's identity + role live in the GLOBAL identity DB.
    {
        let global_db = ctx.db.lock().await;
        let global_store = ctx.store(&global_db);
        match ctx.require_user_permission_scoped(
            &global_store,
            &session.user_id,
            permissions::TOPOLOGY_WRITE,
            Some(&effective_store_id),
            None,
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

    // A retried request returns the original result without repeating any
    // workspace mutation. The process-wide Apply lock also makes the
    // revision check and this ledger lookup deterministic.
    {
        let global_db = ctx.db.lock().await;
        if let Some(raw) = kasirmu_core::Settings::get(&global_db, &request_key)? {
            let value: Value = serde_json::from_str(&raw).map_err(|e| {
                BridgeError::Internal(format!("invalid topology request ledger: {e}"))
            })?;
            if let Some(stored_fingerprint) = value.get("fingerprint").and_then(Value::as_str) {
                if stored_fingerprint != request_fingerprint {
                    return Err(BridgeError::Invalid(
                        "topology request id was already used for a different Apply".into(),
                    ));
                }
                let revision = value
                    .get("revision")
                    .and_then(Value::as_u64)
                    .ok_or_else(|| {
                        BridgeError::Internal("topology request ledger has no revision".into())
                    })?;
                return Ok(TopologyApplyResult { revision });
            }
            // A pre-fingerprint ledger entry can only come from an interrupted
            // development build. Remove it rather than treating an unbound
            // request id as an idempotent success for an unrelated payload.
            kasirmu_core::Settings::remove(&global_db, &request_key)?;
        }
    }

    // Finish any prior cross-database Apply before comparing revisions. A
    // prior process may have committed the diagram but not cleared its
    // journal, in which case recovery must finalize it first.
    recover_pending_topology_apply(ctx.db, ctx.db_manager, &effective_store_id).await?;
    {
        let global_db = ctx.db.lock().await;
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
    // Ownership registries (R4, ruled 2026-09-16): [global, session,
    // EFFECTIVE].
    //   * SESSION stays required by fact, not habit: branch profiles created
    //     through the scoped commands land in the session store's database
    //     (`locations_tests.rs:148-154` pins it green), and a store database
    //     is migrated with only a 'default' seed — dropping this arm would
    //     return every freshly created branch to the `unknown-branch-location`
    //     forever-reject the previous comment on this block guarded.
    //   * EFFECTIVE is NEW: the store the diagram actually writes into is
    //     finally consulted about its own identity. Before this line existed,
    //     a self-describing store's registry could not authorize an Apply
    //     into it — the referee is
    //     `self_describing_store_passes_the_ownership_gate`.
    //   * ACCEPTED RESIDUAL, pinned by
    //     `session_only_row_authorizing_a_foreign_target_is_the_accepted_residual`:
    //     ownership keeps ANY-registry semantics, so a session-side row can
    //     still authorize writes into a target that does not name itself.
    //     Full closure needs a write-side self-seed in the §I locations
    //     family (outside this fence) or removal of the session arm (which
    //     the fresh-create fact rules out). Recorded, not missed.
    {
        let global_db = ctx.db.lock().await;
        let branch_conn = ctx.db_manager.open_store(&session.store_id).map_err(|e| {
            // M5 / ruling R3: cause is logged, not returned (path-free error).
            tracing::error!(store = %session.store_id, error = %e, "topology Apply: opening store db failed for the ownership gate");
            BridgeError::Internal(format!(
                "opening store db for topology gate: store '{}'",
                session.store_id
            ))
        })?;
        let branch_db = branch_conn
            .lock()
            .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
        // The effective store's registry joins the slice — same physical DB
        // when the diagram names the session's own store, so that case does
        // not re-open or double-lock. Note: `open_store` creates-and-migrates
        // an absent file, so a diagram naming an entirely unknown id can now
        // leave an empty store database behind even as the gate rejects it —
        // file-only, zero rows, identical to what `create_store_db` already
        // produces on the success path. Accepted side effect, recorded.
        let effective_conn = (effective_store_id != session.store_id)
            .then(|| ctx.db_manager.open_store(&effective_store_id))
            .transpose()
            .map_err(|e| {
                // M5 / ruling R3 discipline holds on the new arm too.
                tracing::error!(store = %effective_store_id, error = %e, "topology Apply: opening the effective store db failed for the ownership gate");
                BridgeError::Internal(format!(
                    "opening store db for topology gate: store '{}'",
                    effective_store_id
                ))
            })?;
        let effective_db = effective_conn
            .as_ref()
            .map(|c| {
                c.lock()
                    .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))
            })
            .transpose()?;
        let mut registries: Vec<&rusqlite::Connection> = vec![&global_db, &branch_db];
        if let Some(db) = effective_db.as_deref() {
            registries.push(db);
        }
        validate_apply_gate(&registries, &diagram_nodes, &diagram_wires)?;
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
        let global_db = ctx.db.lock().await;
        kasirmu_core::Settings::get(&global_db, &topology_key)?
    };
    let desired_topology = topology_envelope_json(
        &diagram_nodes,
        &diagram_wires,
        base_revision.saturating_add(1),
        &resolved_issue_keys,
    )?;

    // Snapshot all pre-existing rows that a later compensation may need to restore.
    let workspace_snapshot = snapshot_workspace_rows(
        ctx.db_manager,
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
            return Err(BridgeError::TopologyValidation {
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
        let global_db = ctx.db.lock().await;
        TenantSubscription::validate_clock_rollback(&global_db)?;
        let subscription = TenantSubscription::load(&global_db, "default")?
            .ok_or_else(|| BridgeError::Internal("default tenant subscription not found".into()))?;
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
        let db = ctx.db.lock().await;
        persist_topology_recovery(&db, &recovery)?;
    }

    // ── Workspace CRUD in a single transaction ────────────────────────
    //
    // Scoped in a block so all non-`Send` types (MutexGuard, Store,
    // Transaction) are dropped before the `ctx.db.lock().await` call
    // below. Tauri requires command futures to be `Send`.
    tracing::info!(
        effective_store_id = %effective_store_id,
        creations = workspace_creations.len(),
        updates = workspace_updates.len(),
        archives = workspace_archives.len(),
        "topology Apply: opening store DB for workspace CRUD"
    );
    {
        let conn = ctx
            .db_manager
            .open_store(&effective_store_id)
            .map_err(|e| {
                // M5 / ruling R3: cause is logged, not returned (path-free error).
                tracing::error!(store = %effective_store_id, error = %e, "topology Apply: opening store db failed for workspace CRUD");
                BridgeError::Internal(format!(
                    "opening store db for store '{}'",
                    effective_store_id
                ))
            })?;
        let db = conn
            .lock()
            .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
        let store = ctx.store(&db);

        // Preserve the same subscription and entitlement boundary as the
        // standalone workspace-create command. The topology diff must not
        // become an entitlement bypass just because it batches mutations.
        for creation in &workspace_creations {
            if creation.id.trim().is_empty()
                || creation.type_key.trim().is_empty()
                || creation.store_id.trim().is_empty()
                || creation.name.trim().is_empty()
            {
                return Err(BridgeError::Invalid(
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
                return Err(BridgeError::PermissionDenied(format!(
                    "workspace '{}' store_id '{}' does not match topology branch store '{}'",
                    creation.id, creation.store_id, effective_store_id
                )));
            }
            if !effective_tier.allows_workspace_type(&creation.type_key) {
                return Err(BridgeError::PermissionDenied(format!(
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
                return Err(BridgeError::Invalid(
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
                    BridgeError::PermissionDenied(format!(
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
                return Err(BridgeError::PermissionDenied(format!(
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
                    BridgeError::PermissionDenied(format!(
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
                return Err(BridgeError::PermissionDenied(format!(
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
                return Err(BridgeError::PermissionDenied(format!(
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
        // kasirmu-core. Running the INSERT/UPDATE SQL directly preserves the
        // single-transaction atomicity: if any step fails, the whole
        // batch rolls back.
        let tx = db
            .unchecked_transaction()
            .map_err(|e| BridgeError::Internal(format!("begin transaction: {e}")))?;

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
                return Err(BridgeError::Internal(format!(
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
            .map_err(|e| BridgeError::Internal(format!("create instance {}: {e}", creation.id)))?;
        }

        // 2. Update existing workspace instances (rename only).
        //
        // `update_workspace_instance` uses `self.conn.execute` directly
        // (no nested transaction), so it composes safely inside this tx.
        let tx_store = ctx.store(&tx);
        for update in &workspace_updates {
            tx_store.update_workspace_instance(&update.id, &update.name, None, None)?;
            if let Some(purpose_key) = update.purpose_key.as_deref() {
                if purpose_key.trim().is_empty() {
                    return Err(BridgeError::Invalid(
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
            .map_err(|e| BridgeError::Internal(format!("commit transaction: {e}")))?;
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
    let global_db = ctx.db.lock().await;
    // Same ownership registries as the pre-mutation gate: the session's
    // store database may be the only one holding the branch profile row.
    // The store guards live only inside this block — a MutexGuard over a
    // rusqlite Connection is !Send, so it must not be held across the
    // error-path awaits below (lexical scope, not explicit drop, is what
    // the async generator liveness analysis respects here).
    // ADR #46 §1-§3: this Apply becomes an immutable revision row, written
    // inside the same transaction as the envelope. The counts are the ones
    // captured above, before the workspace block moved the request vectors.
    //
    // Declared OUTSIDE the save block because the success path reuses it for
    // the §6 audit record; the two records describe one event and must not be
    // free to disagree about it.
    let revision_ctx = TopologyRevisionContext {
        change_note: &change_note,
        published_by: &session.user_id,
        workspace_creations: created,
        workspace_updates: updated,
        workspace_archives: archived,
    };
    let save_result = {
        let branch_conn = ctx.db_manager.open_store(&session.store_id).map_err(|e| {
            // M5 / ruling R3: cause is logged, not returned (path-free error).
            tracing::error!(store = %session.store_id, error = %e, "topology Apply: opening store db failed for the diagram save");
            BridgeError::Internal(format!(
                "opening store db for topology save: store '{}'",
                session.store_id
            ))
        })?;
        let branch_db = branch_conn
            .lock()
            .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
        // R4: the save boundary's ownership re-check must agree with the
        // gate it follows — same [global, session, EFFECTIVE] slice, built
        // the same way (no re-open when the diagram names the session's own
        // store). The second site of the same class was real: the referee
        // passed the gate and died HERE before this line existed.
        let effective_conn = (effective_store_id != session.store_id)
            .then(|| ctx.db_manager.open_store(&effective_store_id))
            .transpose()
            .map_err(|e| {
                tracing::error!(store = %effective_store_id, error = %e, "topology Apply: opening the effective store db failed for the diagram save");
                BridgeError::Internal(format!(
                    "opening store db for topology save: store '{}'",
                    effective_store_id
                ))
            })?;
        let effective_db = effective_conn
            .as_ref()
            .map(|c| {
                c.lock()
                    .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))
            })
            .transpose()?;
        let mut save_registries: Vec<&rusqlite::Connection> = vec![&global_db, &branch_db];
        if let Some(db) = effective_db.as_deref() {
            save_registries.push(db);
        }
        save_topology_json_at_key_with_registries(
            &global_db,
            diagram_nodes,
            diagram_wires,
            &topology_key,
            &resolved_issue_keys,
            Some(base_revision),
            Some((&request_key, &request_fingerprint)),
            &save_registries,
            Some(&revision_ctx),
        )
        // The guards and slice drop here with the block.
    };
    if let Err(save_error) = save_result {
        drop(global_db);
        // The durable recovery journal was written before the workspace
        // transaction. Keep it until both databases have been compensated.
        if let Err(compensation_error) = compensate_workspace_diff(
            ctx.db_manager,
            &effective_store_id,
            &workspace_creations,
            &workspace_snapshot,
        )
        .await
        {
            return Err(BridgeError::Internal(format!(
                "topology save failed ({save_error}); workspace compensation pending ({compensation_error})"
            )));
        }
        let restore = {
            let db = ctx.db.lock().await;
            restore_topology_setting(&db, &topology_key, previous_topology.as_deref())
        };
        if let Err(restore_error) = restore {
            return Err(BridgeError::Internal(format!(
                "topology save failed ({save_error}); diagram compensation pending ({restore_error})"
            )));
        }
        {
            let db = ctx.db.lock().await;
            clear_topology_recovery(&db)?;
        }
        return Err(save_error);
    }

    // The `global_db` guard from the save is still held on the success path
    // — re-locking `ctx.db` here would deadlock (tokio::sync::Mutex is not
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

    // ADR #46 §6: topology Apply has never written an audit record, so "who
    // changed this branch's topology, and why" had no answer at all.
    //
    // Deliberately NOT fatal. The Apply succeeded and its revision row is
    // already committed; returning an error here would tell a merchant their
    // deploy did not happen when it did, and the command's caller would treat
    // a real deploy as a failure. A missing audit row is the lesser error, and
    // it is logged loudly enough to find.
    //
    // Written to the EFFECTIVE store's database, not the session's: audit_log
    // is per-store, and this is the branch whose topology changed.
    let audit_result = (|| -> Result<(), BridgeError> {
        let store_conn = ctx
            .db_manager
            .open_store(&effective_store_id)
            .map_err(|e| {
                // M5 / ruling R3: cause is logged, not returned (path-free error).
                tracing::error!(store = %effective_store_id, error = %e, "topology Apply: opening store db failed for the audit write");
                BridgeError::Internal(format!(
                    "opening store db for topology audit: store '{}'",
                    effective_store_id
                ))
            })?;
        let db = store_conn
            .lock()
            .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
        audit_topology_apply(
            &db,
            branch_id.as_deref().unwrap_or(""),
            result.revision,
            node_count,
            wire_count,
            &revision_ctx,
        )
    })();
    if let Err(error) = audit_result {
        tracing::warn!(
            error = %error,
            revision = result.revision,
            "topology Apply: audit record failed to write; revision row still authoritative"
        );
    }

    Ok(result)
}
