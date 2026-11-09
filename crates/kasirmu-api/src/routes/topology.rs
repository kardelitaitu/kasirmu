//! Store topology authoring, signing, and replication endpoints (ADR-66 / done-plan-topology-web-authoring.md Phase 2).
//!
//! Provides centralized planning, cryptographic signing, revision publication,
//! and terminal replication for multi-store topology configurations.
//!
//! Handlers:
//! - [`topology_plan_handler`]: Desired-state validation, Pro+ eligibility check (D2/T11), diff preview.
//! - [`topology_publish_handler`]: Optimistic concurrency check (I4/T8), HMAC-SHA256 signing (D4),
//!   atomic revision append, and immutable audit logging (D5).
//! - [`topology_pull_handler`]: Scoped revision pull for terminal synchronization (I5/T1).

use std::collections::{HashMap, HashSet};

use axum::{
    Extension, Json,
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use chrono::Utc;
use hmac::{Hmac, Mac};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use kasirmu_core::db::Store;
use kasirmu_core::error::CoreError;
use kasirmu_core::topology::{
    TOPOLOGY_CONTRACT_SCHEMA_VERSION, semantic_branch_profile_id, validate_semantic_json,
    value_string,
};

use crate::AppState;
use crate::auth::ApiTokenClaims;

// ── Types ─────────────────────────────────────────────────────────────

/// Request payload for computing a topology diff and validating desired state.
#[derive(Debug, Deserialize)]
pub struct TopologyPlanRequest {
    /// Target branch profile identifier.
    pub branch_id: String,
    /// Desired topology canvas nodes.
    pub nodes: Vec<Value>,
    /// Desired topology canvas wires.
    pub wires: Vec<Value>,
    /// Expected base revision for concurrency preview.
    pub base_revision: Option<i64>,
}

/// Diff summary of workspace changes between current and desired topology.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopologyDiffSummary {
    /// Number of new workspace instances to create.
    pub created: usize,
    /// Number of existing workspace instances to update (name or purpose).
    pub updated: usize,
    /// Number of existing workspace instances to archive.
    pub archived: usize,
    /// Number of workspaces undergoing a destructive type change (archive + recreate).
    pub type_changed: usize,
}

/// Response payload from `POST /api/v1/topology/plan`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopologyPlanResponse {
    /// Whether the desired state satisfies all schema and semantic invariants.
    pub valid: bool,
    /// Target branch profile ID.
    pub branch_id: String,
    /// Verified base revision.
    pub base_revision: Option<i64>,
    /// Computed workspace diff summary.
    pub summary: TopologyDiffSummary,
    /// Semantic contract schema version.
    pub contract_schema_version: u64,
}

/// Request payload for publishing and signing a new topology revision.
#[derive(Debug, Deserialize)]
pub struct TopologyPublishRequest {
    /// Target branch profile identifier.
    pub branch_id: String,
    /// Organization scope for enterprise multi-tenancy.
    pub org_id: Option<String>,
    /// Predecessor revision number for optimistic concurrency.
    pub base_revision: Option<i64>,
    /// Human-readable explanation of changes.
    pub change_note: Option<String>,
    /// Desired topology canvas nodes.
    pub nodes: Vec<Value>,
    /// Desired topology canvas wires.
    pub wires: Vec<Value>,
    /// Optional pre-rendered diagram envelope JSON.
    pub envelope: Option<Value>,
    /// Step-up authentication PIN (ADR-66 D5).
    pub step_up_pin: Option<String>,
}

/// Response payload from `POST /api/v1/topology/publish`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopologyPublishResponse {
    /// Unique revision row identifier (UUID v4).
    pub id: String,
    /// Target branch profile ID.
    pub branch_id: String,
    /// Newly allocated revision number (monotonically increasing).
    pub revision: i64,
    /// Anchored predecessor revision.
    pub base_revision: Option<i64>,
    /// ISO-8601 publish timestamp.
    pub published_at: String,
    /// Author / actor identity.
    pub published_by: String,
    /// Key ID of the signing credential.
    pub key_id: String,
    /// Cryptographic signature over the canonical revision payload.
    pub signature: String,
    /// Human-readable change note.
    pub change_note: String,
    /// Workspace-instance diff summary.
    pub summary: TopologyDiffSummary,
}

/// Query parameters for `GET /api/v1/topology/revisions/pull`.
#[derive(Debug, Deserialize)]
pub struct TopologyPullQuery {
    /// Target branch identifier.
    pub branch_id: String,
    /// Watermark: return revisions strictly greater than this number.
    pub since_revision: Option<i64>,
    /// Optional pagination page size (clamped 1..=100, default 50).
    pub limit: Option<usize>,
}

/// Individual revision item returned during synchronization pull.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopologyRevisionItem {
    /// Revision row ID.
    pub id: String,
    /// Branch identifier.
    pub branch_id: String,
    /// Revision sequence number.
    pub revision: i64,
    /// Predecessor base revision.
    pub base_revision: Option<i64>,
    /// Change note.
    pub change_note: String,
    /// Raw serialized diagram envelope (None if deflated).
    pub diagram: Option<String>,
    /// Workspace creation count.
    pub workspace_creations: i64,
    /// Workspace update count.
    pub workspace_updates: i64,
    /// Workspace archive count.
    pub workspace_archives: i64,
    /// Total node count.
    pub node_count: i64,
    /// Total wire count.
    pub wire_count: i64,
    /// Contract schema version.
    pub contract_schema_version: i64,
    /// Whether revision is pinned against retention sweeps.
    pub pinned: bool,
    /// ISO-8601 publication timestamp.
    pub published_at: String,
    /// Publishing user or service.
    pub published_by: String,
    /// Tenant identifier.
    pub tenant_id: String,
    /// Organization scope.
    pub org_id: String,
    /// Actor identifier.
    pub actor: String,
    /// Cryptographic key identifier.
    pub key_id: Option<String>,
    /// Cryptographic signature.
    pub signature: Option<String>,
}

/// Response payload from `GET /api/v1/topology/revisions/pull`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopologyPullResponse {
    /// Target branch.
    pub branch_id: String,
    /// Calling tenant scope.
    pub tenant_id: String,
    /// Ordered list of revisions since the watermark.
    pub revisions: Vec<TopologyRevisionItem>,
}

// ── Cryptographic Signing & Canonical Payload ──────────────────────────

/// Canonical payload string used for signing and verifying a topology revision (ADR-66).
pub fn canonical_topology_revision_payload(
    tenant_id: &str,
    org_id: &str,
    branch_id: &str,
    revision: i64,
    base_revision: Option<i64>,
    envelope: &str,
) -> String {
    let envelope_hash = hex::encode(Sha256::digest(envelope.as_bytes()));
    let base_str = base_revision
        .map(|b| b.to_string())
        .unwrap_or_else(|| "none".to_string());
    format!("{tenant_id}:{org_id}:{branch_id}:{revision}:{base_str}:{envelope_hash}")
}

/// Compute HMAC-SHA256 signature for a topology revision payload (ADR-66 D4).
pub fn sign_topology_revision_payload(key: &[u8], canonical_payload: &str) -> String {
    // INVARIANT: HMAC accepts a key of ANY length -- RFC 2104 defines no minimum or
    // maximum for the key, and the hmac crate's `new_from_slice` returns Err only for
    // algorithms with a fixed-size key (e.g. SipHash). The error message is the
    // invariant stated in the one place a maintainer would look.
    let mut mac =
        <Hmac<Sha256> as Mac>::new_from_slice(key).expect("HMAC-SHA256 accepts any key length");
    mac.update(canonical_payload.as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

/// Verify HMAC-SHA256 signature for a topology revision payload in constant time (ADR-66 D4).
pub fn verify_topology_revision_signature(
    key: &[u8],
    canonical_payload: &str,
    hex_signature: &str,
) -> bool {
    let Ok(sig_bytes) = hex::decode(hex_signature) else {
        return false;
    };
    let Ok(mut mac) = <Hmac<Sha256> as Mac>::new_from_slice(key) else {
        return false;
    };
    mac.update(canonical_payload.as_bytes());
    mac.verify_slice(&sig_bytes).is_ok()
}

/// Resolve the active topology signing key and its key identifier (ADR-66 D4).
pub fn resolved_topology_signing_key(api_secret: &str) -> (String, Vec<u8>) {
    let key_id = std::env::var("OZ_TOPOLOGY_KEY_ID")
        .or_else(|_| std::env::var("KASIRMU_TOPOLOGY_KEY_ID"))
        .unwrap_or_else(|_| "key-2026-10-v1".to_string());

    let raw_key = std::env::var("OZ_TOPOLOGY_SIGNING_KEY")
        .or_else(|_| std::env::var("KASIRMU_TOPOLOGY_SIGNING_KEY"))
        .unwrap_or_else(|_| {
            if !api_secret.is_empty() {
                api_secret.to_string()
            } else {
                "dev-topology-signing-secret-key-32b".to_string()
            }
        });

    (key_id, raw_key.into_bytes())
}

// ── Rollout Controls: Kill Switch & Shadow Mode (Phase 5) ─────────────

/// Check if the centralized web authoring kill switch is active (Phase 5).
///
/// Checks runtime `settings` table (`topology:kill_switch`) with fallback to env vars.
/// When active, web plan and publish endpoints immediately return 503 Service Unavailable,
/// disabling web publishing without requiring an emergency terminal update.
pub fn is_topology_web_authoring_disabled(db: &rusqlite::Connection) -> bool {
    db.query_row(
        "SELECT value FROM settings WHERE key = 'topology:kill_switch'",
        [],
        |r| r.get::<_, String>(0),
    )
    .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
    .unwrap_or_else(|_| {
        std::env::var("OZ_TOPOLOGY_WEB_AUTHORING_DISABLED")
            .or_else(|_| std::env::var("KASIRMU_TOPOLOGY_WEB_AUTHORING_DISABLED"))
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false)
    })
}

/// Check if shadow mode rollout is active (Phase 5).
///
/// Checks runtime `settings` table (`topology:shadow_mode`) with fallback to env vars.
/// When active, web authoring evaluates and validates plans without syncing revisions to terminals.
pub fn is_topology_shadow_mode_active(db: &rusqlite::Connection) -> bool {
    db.query_row(
        "SELECT value FROM settings WHERE key = 'topology:shadow_mode'",
        [],
        |r| r.get::<_, String>(0),
    )
    .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
    .unwrap_or_else(|_| {
        std::env::var("OZ_TOPOLOGY_SHADOW_MODE")
            .or_else(|_| std::env::var("KASIRMU_TOPOLOGY_SHADOW_MODE"))
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false)
    })
}

// ── Multi-Store Eligibility Gate ───────────────────────────────────────

/// Verify tenant eligibility for centralized web authoring (ADR-66 D2 & T11).
///
/// Restricts web authoring to multi-store tenants (Pro and above).
/// Single-store tenants (Free, Plus) must author topology locally on-device.
pub fn check_tenant_multi_store_eligibility(
    db: &rusqlite::Connection,
    tenant_id: &str,
) -> Result<bool, CoreError> {
    // 1. Check `tenant_subscription` table (primary source of truth for quotas & locations).
    let mut stmt = db.prepare_cached(
        "SELECT tier_key, max_locations FROM tenant_subscription WHERE tenant_id = ?1",
    )?;
    let mut rows = stmt.query(params![tenant_id])?;
    if let Some(row) = rows.next()? {
        let tier_key: String = row.get(0)?;
        let max_locations: Option<i64> = row.get(1)?;
        let is_single_store = matches!(
            tier_key.to_lowercase().as_str(),
            "free" | "plus" | "standard" | "one_time" | "trial"
        ) || max_locations.map(|m| m <= 1).unwrap_or(false);

        return Ok(!is_single_store);
    }

    // 2. Fall back to `tenant_plan` table (sync plans).
    let store = Store::new(db);
    match store.get_tenant_plan(tenant_id)? {
        Some(kasirmu_core::TenantPlan::Pro) => Ok(true),
        Some(kasirmu_core::TenantPlan::Free) => Ok(false),
        None => {
            // No explicit row found. In dev/test without setup, fail closed.
            Ok(false)
        }
    }
}

// ── Pure Diff Computation ──────────────────────────────────────────────

fn extract_workspace_summary(node: &Value) -> Option<(&str, &str, &str, &str)> {
    if value_string(node, "type") != Some("workspace") {
        return None;
    }
    let id = value_string(node, "id")?;
    let type_key = node
        .get("metadata")
        .and_then(|m| value_string(m, "typeKey"))
        .unwrap_or("store-pos");
    let name = value_string(node, "name").unwrap_or("");
    let purpose_key = node
        .get("metadata")
        .and_then(|m| value_string(m, "purposeKey"))
        .unwrap_or("general");
    Some((id, type_key, name, purpose_key))
}

/// Compute workspace creation/update/archive/type-change diff summary (ADR-22 §B / ADR-46 §2).
pub fn compute_topology_plan_diff(
    previous_nodes: &[Value],
    desired_nodes: &[Value],
) -> TopologyDiffSummary {
    let mut prev_map = HashMap::new();
    for node in previous_nodes {
        if let Some((id, type_key, name, purpose_key)) = extract_workspace_summary(node) {
            prev_map.insert(id, (type_key, name, purpose_key));
        }
    }

    let mut desired_map = HashMap::new();
    for node in desired_nodes {
        if let Some((id, type_key, name, purpose_key)) = extract_workspace_summary(node) {
            desired_map.insert(id, (type_key, name, purpose_key));
        }
    }

    let mut creates = HashSet::new();
    let mut updates = HashSet::new();
    let mut type_changes = HashSet::new();
    let mut archives = HashSet::new();

    // Check desired workspaces
    for (&id, &(type_key, name, purpose_key)) in &desired_map {
        match prev_map.get(id) {
            None => {
                creates.insert(id);
            }
            Some(&(prev_type, prev_name, prev_purpose)) => {
                if prev_type != type_key {
                    type_changes.insert(id);
                    archives.insert(id);
                    creates.insert(id);
                } else if prev_name != name || prev_purpose != purpose_key {
                    updates.insert(id);
                }
            }
        }
    }

    // Check archived workspaces (existed previously, not in desired)
    for &id in prev_map.keys() {
        if !desired_map.contains_key(id) {
            archives.insert(id);
        }
    }

    let type_changed = type_changes.len();
    TopologyDiffSummary {
        created: creates.len().saturating_sub(type_changed),
        updated: updates.len(),
        archived: archives.len().saturating_sub(type_changed),
        type_changed,
    }
}

// ── Handlers ───────────────────────────────────────────────────────────

/// `POST /api/v1/topology/plan` — validate desired-state and compute diff preview.
pub async fn topology_plan_handler(
    State(state): State<AppState>,
    Extension(claims): Extension<ApiTokenClaims>,
    Json(body): Json<TopologyPlanRequest>,
) -> Response {
    let tenant_id = claims.tenant_id.as_deref().unwrap_or("default");

    // 0. Kill switch check (Phase 5)
    {
        let db = state.db.lock().await;
        if is_topology_web_authoring_disabled(&db) {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({
                    "error": "kill_switch_active",
                    "message": "Centralized topology web authoring is temporarily disabled by administrative kill switch"
                })),
            )
                .into_response();
        }
    }

    // 1. Multi-store eligibility check (ADR-66 D2 & T11)
    {
        let db = state.db.lock().await;
        match check_tenant_multi_store_eligibility(&db, tenant_id) {
            Ok(true) => {}
            Ok(false) => {
                return (
                    StatusCode::FORBIDDEN,
                    Json(serde_json::json!({
                        "error": "plan_gate_exceeded",
                        "message": "Centralized topology authoring requires Pro plan or above"
                    })),
                )
                    .into_response();
            }
            Err(e) => {
                tracing::error!(error = %e, tenant_id, "failed to check tenant multi-store eligibility");
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({"error": "eligibility_check_failed"})),
                )
                    .into_response();
            }
        }
    }

    // 2. Location containment & branch profile verification (D6, T9)
    if let Some(branch_profile_id) = semantic_branch_profile_id(&body.nodes, &body.wires)
        && branch_profile_id != body.branch_id
    {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "branch_mismatch",
                "message": format!(
                    "Graph branch profile `{branch_profile_id}` does not match target branch `{}`",
                    body.branch_id
                )
            })),
        )
            .into_response();
    }

    // 3. Validate semantic graph (I3 & T4)
    if let Err(e) = validate_semantic_json(&body.nodes, &body.wires) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "invalid_topology",
                "message": e.to_string()
            })),
        )
            .into_response();
    }

    // 4. Query previous active revision for diff calculation
    let previous_nodes: Vec<Value> = {
        let db = state.db.lock().await;
        let mut stmt = match db.prepare_cached(
            "SELECT diagram FROM topology_revisions
             WHERE branch_id = ?1 AND tenant_id = ?2
             ORDER BY revision DESC LIMIT 1",
        ) {
            Ok(s) => s,
            Err(e) => {
                tracing::error!(error = %e, "failed to prepare revision lookup");
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({"error": "database_error"})),
                )
                    .into_response();
            }
        };

        match stmt.query_row(params![body.branch_id, tenant_id], |row| {
            let diagram: Option<String> = row.get(0)?;
            Ok(diagram)
        }) {
            Ok(Some(diagram_json)) => serde_json::from_str::<Value>(&diagram_json)
                .ok()
                .and_then(|v| v.get("nodes").and_then(Value::as_array).cloned())
                .unwrap_or_default(),
            Ok(None) | Err(rusqlite::Error::QueryReturnedNoRows) => Vec::new(),
            Err(e) => {
                tracing::error!(error = %e, "failed to query latest revision diagram");
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({"error": "database_error"})),
                )
                    .into_response();
            }
        }
    };

    // 5. Compute pure workspace diff
    let summary = compute_topology_plan_diff(&previous_nodes, &body.nodes);

    (
        StatusCode::OK,
        Json(TopologyPlanResponse {
            valid: true,
            branch_id: body.branch_id,
            base_revision: body.base_revision,
            summary,
            contract_schema_version: TOPOLOGY_CONTRACT_SCHEMA_VERSION,
        }),
    )
        .into_response()
}

/// `POST /api/v1/topology/publish` — sign and publish an immutable topology revision.
pub async fn topology_publish_handler(
    State(state): State<AppState>,
    Extension(claims): Extension<ApiTokenClaims>,
    headers: HeaderMap,
    Json(body): Json<TopologyPublishRequest>,
) -> Response {
    let tenant_id = claims.tenant_id.as_deref().unwrap_or("default");
    let actor = claims.sub.clone();
    let org_id = body.org_id.as_deref().unwrap_or("");

    // 0. Kill switch check (Phase 5)
    {
        let db = state.db.lock().await;
        if is_topology_web_authoring_disabled(&db) {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({
                    "error": "kill_switch_active",
                    "message": "Centralized topology web authoring is temporarily disabled by administrative kill switch"
                })),
            )
                .into_response();
        }
    }

    // 1. Multi-store eligibility check (ADR-66 D2 & T11)
    {
        let db = state.db.lock().await;
        match check_tenant_multi_store_eligibility(&db, tenant_id) {
            Ok(true) => {}
            Ok(false) => {
                return (
                    StatusCode::FORBIDDEN,
                    Json(serde_json::json!({
                        "error": "plan_gate_exceeded",
                        "message": "Centralized topology authoring requires Pro plan or above"
                    })),
                )
                    .into_response();
            }
            Err(e) => {
                tracing::error!(error = %e, tenant_id, "failed to check eligibility");
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({"error": "eligibility_check_failed"})),
                )
                    .into_response();
            }
        }
    }

    // 2. Location containment & branch profile verification (D6, T9)
    if let Some(branch_profile_id) = semantic_branch_profile_id(&body.nodes, &body.wires)
        && branch_profile_id != body.branch_id
    {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "branch_mismatch",
                "message": format!(
                    "Graph branch profile `{branch_profile_id}` does not match target branch `{}`",
                    body.branch_id
                )
            })),
        )
            .into_response();
    }

    // 3. Validate semantic graph (I3 & T4)
    if let Err(e) = validate_semantic_json(&body.nodes, &body.wires) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "invalid_topology",
                "message": e.to_string()
            })),
        )
            .into_response();
    }

    // 4. Optional step-up authentication validation (ADR-66 D5)
    let step_up_pin = body
        .step_up_pin
        .as_deref()
        .or_else(|| headers.get("X-Step-Up-PIN").and_then(|v| v.to_str().ok()));
    if let Some(pin) = step_up_pin
        && pin.trim().is_empty()
    {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({
                "error": "invalid_step_up_pin",
                "message": "Step-up authentication PIN cannot be blank"
            })),
        )
            .into_response();
    }

    // 5. Database write inside an explicit rusqlite transaction
    let mut db = state.db.lock().await;
    let tx = match db.transaction() {
        Ok(t) => t,
        Err(e) => {
            tracing::error!(error = %e, "failed to begin transaction");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "transaction_start_failed"})),
            )
                .into_response();
        }
    };

    // 6. Optimistic concurrency check (I4 & T8)
    let current_revision: Option<i64> = match tx.query_row(
        "SELECT revision FROM topology_revisions
         WHERE branch_id = ?1 AND tenant_id = ?2
         ORDER BY revision DESC LIMIT 1",
        params![body.branch_id, tenant_id],
        |row| row.get(0),
    ) {
        Ok(rev) => Some(rev),
        Err(rusqlite::Error::QueryReturnedNoRows) => None,
        Err(e) => {
            tracing::error!(error = %e, "failed to query current revision");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "concurrency_query_failed"})),
            )
                .into_response();
        }
    };

    if current_revision != body.base_revision {
        return (
            StatusCode::CONFLICT,
            Json(serde_json::json!({
                "error": "topology_revision_conflict",
                "message": "base_revision mismatch: concurrent modification detected",
                "current_revision": current_revision,
                "expected_base": body.base_revision
            })),
        )
            .into_response();
    }

    let new_revision = current_revision.unwrap_or(0) + 1;

    // 7. Load previous nodes for diff summary
    let previous_nodes: Vec<Value> = if let Some(base_rev) = current_revision {
        match tx.query_row(
            "SELECT diagram FROM topology_revisions
             WHERE branch_id = ?1 AND tenant_id = ?2 AND revision = ?3",
            params![body.branch_id, tenant_id, base_rev],
            |row| {
                let diag: Option<String> = row.get(0)?;
                Ok(diag)
            },
        ) {
            Ok(Some(diag_str)) => serde_json::from_str::<Value>(&diag_str)
                .ok()
                .and_then(|v| v.get("nodes").and_then(Value::as_array).cloned())
                .unwrap_or_default(),
            _ => Vec::new(),
        }
    } else {
        Vec::new()
    };

    let summary = compute_topology_plan_diff(&previous_nodes, &body.nodes);

    // 8. Build and serialize envelope
    let envelope_val = body.envelope.unwrap_or_else(|| {
        serde_json::json!({
            "schema_version": 1,
            "revision": new_revision,
            "nodes": body.nodes,
            "wires": body.wires
        })
    });
    let envelope_str = match serde_json::to_string(&envelope_val) {
        Ok(s) => s,
        Err(e) => {
            tracing::error!(error = %e, "failed to serialize envelope JSON");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "envelope_serialization_failed"})),
            )
                .into_response();
        }
    };

    // 9. Sign payload with active key (ADR-66 D4)
    let (key_id, signing_key) = resolved_topology_signing_key(&state.api_secret);
    let canonical_payload = canonical_topology_revision_payload(
        tenant_id,
        org_id,
        &body.branch_id,
        new_revision,
        body.base_revision,
        &envelope_str,
    );
    let signature = sign_topology_revision_payload(&signing_key, &canonical_payload);

    let revision_id = format!("rev-{}", Uuid::new_v4());
    let now_rfc3339 = Utc::now().to_rfc3339();
    let change_note = body.change_note.unwrap_or_default();
    let node_count = body.nodes.len() as i64;
    let wire_count = body.wires.len() as i64;

    // 10. Insert revision row
    if let Err(e) = tx.execute(
        "INSERT INTO topology_revisions (
            id, branch_id, revision, change_note, diagram,
            workspace_creations, workspace_updates, workspace_archives,
            node_count, wire_count, contract_schema_version, pinned,
            published_at, published_by, tenant_id, org_id, actor,
            key_id, signature, base_revision
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5,
            ?6, ?7, ?8,
            ?9, ?10, ?11, 0,
            ?12, ?13, ?14, ?15, ?16,
            ?17, ?18, ?19
        )",
        params![
            revision_id,
            body.branch_id,
            new_revision,
            change_note,
            envelope_str,
            summary.created as i64,
            summary.updated as i64,
            summary.archived as i64,
            node_count,
            wire_count,
            TOPOLOGY_CONTRACT_SCHEMA_VERSION as i64,
            now_rfc3339,
            actor,
            tenant_id,
            org_id,
            actor,
            key_id,
            signature,
            body.base_revision,
        ],
    ) {
        tracing::error!(error = %e, "failed to insert topology revision row");
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "revision_insert_failed"})),
        )
            .into_response();
    }

    // 11. Write immutable audit log record (ADR-66 D5)
    let audit_id = format!("audit-{}", Uuid::new_v4());
    let audit_details = serde_json::json!({
        "tenant_id": tenant_id,
        "org_id": org_id,
        "branch_id": body.branch_id,
        "from_revision": body.base_revision,
        "to_revision": new_revision,
        "key_id": key_id,
        "summary": summary
    })
    .to_string();

    let _ = tx.execute(
        "INSERT INTO audit_log (
            id, user_id, action, target_type, target_id, details, outcome, created_at
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8
        )",
        params![
            audit_id,
            actor,
            "topology.publish",
            "branch_topology",
            body.branch_id,
            audit_details,
            "success",
            now_rfc3339,
        ],
    );

    // 12. Commit transaction
    if let Err(e) = tx.commit() {
        tracing::error!(error = %e, "failed to commit revision publish transaction");
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "transaction_commit_failed"})),
        )
            .into_response();
    }

    (
        StatusCode::CREATED,
        Json(TopologyPublishResponse {
            id: revision_id,
            branch_id: body.branch_id,
            revision: new_revision,
            base_revision: body.base_revision,
            published_at: now_rfc3339,
            published_by: actor,
            key_id,
            signature,
            change_note,
            summary,
        }),
    )
        .into_response()
}

/// `GET /api/v1/topology/revisions/pull` — terminal replication watermark pull.
pub async fn topology_pull_handler(
    State(state): State<AppState>,
    Extension(claims): Extension<ApiTokenClaims>,
    Query(query): Query<TopologyPullQuery>,
) -> Response {
    let tenant_id = claims.tenant_id.as_deref().unwrap_or("default");
    let since_revision = query.since_revision.unwrap_or(0);
    let limit = query.limit.unwrap_or(50).clamp(1, 100);

    let db = state.db.lock().await;

    // In shadow mode (Phase 5), terminals do not pull/apply revisions
    if is_topology_shadow_mode_active(&db) {
        return (
            StatusCode::OK,
            Json(TopologyPullResponse {
                branch_id: query.branch_id,
                tenant_id: tenant_id.to_string(),
                revisions: Vec::new(),
            }),
        )
            .into_response();
    }
    let mut stmt = match db.prepare_cached(
        "SELECT id, branch_id, revision, base_revision, change_note, diagram,
                workspace_creations, workspace_updates, workspace_archives,
                node_count, wire_count, contract_schema_version, pinned,
                published_at, published_by, tenant_id, org_id, actor,
                key_id, signature
         FROM topology_revisions
         WHERE branch_id = ?1 AND tenant_id = ?2 AND revision > ?3
         ORDER BY revision ASC
         LIMIT ?4",
    ) {
        Ok(s) => s,
        Err(e) => {
            tracing::error!(error = %e, "failed to prepare pull query");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "database_error"})),
            )
                .into_response();
        }
    };

    let rows_res = stmt.query_map(
        params![query.branch_id, tenant_id, since_revision, limit as i64],
        |row| {
            let key_id_raw: String = row.get(18)?;
            let sig_raw: String = row.get(19)?;
            Ok(TopologyRevisionItem {
                id: row.get(0)?,
                branch_id: row.get(1)?,
                revision: row.get(2)?,
                base_revision: row.get(3)?,
                change_note: row.get(4)?,
                diagram: row.get(5)?,
                workspace_creations: row.get(6)?,
                workspace_updates: row.get(7)?,
                workspace_archives: row.get(8)?,
                node_count: row.get(9)?,
                wire_count: row.get(10)?,
                contract_schema_version: row.get(11)?,
                pinned: row.get::<_, i64>(12)? != 0,
                published_at: row.get(13)?,
                published_by: row.get(14)?,
                tenant_id: row.get(15)?,
                org_id: row.get(16)?,
                actor: row.get(17)?,
                key_id: if key_id_raw.is_empty() {
                    None
                } else {
                    Some(key_id_raw)
                },
                signature: if sig_raw.is_empty() {
                    None
                } else {
                    Some(sig_raw)
                },
            })
        },
    );

    let revisions: Vec<TopologyRevisionItem> = match rows_res {
        Ok(iter) => iter.filter_map(Result::ok).collect(),
        Err(e) => {
            tracing::error!(error = %e, "failed to map pull rows");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "database_error"})),
            )
                .into_response();
        }
    };

    (
        StatusCode::OK,
        Json(TopologyPullResponse {
            branch_id: query.branch_id,
            tenant_id: tenant_id.to_string(),
            revisions,
        }),
    )
        .into_response()
}

#[cfg(test)]
#[path = "topology_tests.rs"]
mod tests;
