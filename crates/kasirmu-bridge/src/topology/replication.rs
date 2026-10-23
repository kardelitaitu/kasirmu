//! Topology replication client for physical terminals (ADR-66 / done-plan-topology-web-authoring.md Phase 3).
//!
//! Provides the transport abstraction, cryptographic verification, watermark tracking,
//! and atomic application pipeline for synchronizing web-authored topology revisions to physical terminals.
//!
//! # Core Invariants
//! - **I1 (Offline Autonomy):** Replication is strictly network-optional. When cloud transport is
//!   unreachable, the till operates without disruption on its last known good revision.
//! - **I2 (Atomic Apply):** Revision application executes within a single SQLite transaction, updating
//!   both the diagram setting and the immutable `topology_revisions` log.
//! - **I3 (Reject, Never Half-Apply):** Invalid, malformed, or untrusted revisions are rejected whole.
//! - **I4 (Monotonic Ordering & Idempotency):** Duplicate or replayed revisions are ignored idempotently;
//!   gaps in the monotonic revision sequence trigger an immediate refusal.
//! - **I5 (Cryptographic Scoping):** Revisions must pass constant-time signature verification against
//!   a trusted `key_id` registry before application. Cross-tenant revisions are denied.

use std::collections::HashMap;

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use kasirmu_core::error::CoreError;
use kasirmu_core::topology::{semantic_branch_profile_id, validate_semantic_json};

use super::persistence::topology_setting_key;
use super::revisions::{
    TopologyRevisionContext, TopologyRevisionGraph, canonical_topology_revision_payload,
    insert_topology_revision_scoped, verify_topology_revision_signature,
};
use crate::error::BridgeError;

// ── Replication Error Taxonomy ─────────────────────────────────────────

/// Errors encountered during the topology replication and application cycle.
#[derive(Debug, thiserror::Error)]
pub enum TopologyReplicationError {
    /// Remote cloud transport was unreachable or timed out (offline-first fallback).
    #[error("network unavailable: {0}")]
    NetworkUnavailable(String),

    /// Cloud server rejected authentication or subscription plan.
    #[error("authentication or authorization denied by cloud server")]
    Unauthorized,

    /// Revision signature verification failed against trusted key.
    #[error("signature verification failed for revision {revision} under key {key_id}")]
    InvalidSignature {
        /// Key identifier cited by the revision.
        key_id: String,
        /// Revision sequence number.
        revision: i64,
    },

    /// Key cited in revision envelope is missing from trusted key registry.
    #[error("untrusted or missing key id `{0}`")]
    UntrustedKeyId(String),

    /// Revision signature header or envelope is missing.
    #[error("revision {0} is missing cryptographic signature")]
    MissingSignature(i64),

    /// Revision key_id is missing.
    #[error("revision {0} is missing key_id")]
    MissingKeyId(i64),

    /// Revision diagram snapshot is deflated / pruned and cannot be restored.
    #[error("revision {revision} is deflated and cannot be applied")]
    DeflatedRevision {
        /// Revision sequence number.
        revision: i64,
    },

    /// Desired topology failed semantic validation on the local terminal.
    #[error("invalid topology in revision {revision}: {reason}")]
    InvalidTopology {
        /// Revision sequence number.
        revision: i64,
        /// Semantic validation failure explanation.
        reason: String,
    },

    /// Non-monotonic revision gap encountered (out of order delivery).
    #[error("concurrency gap detected: expected revision {expected}, received {received}")]
    ConcurrencyGap {
        /// Expected next monotonic revision.
        expected: u64,
        /// Received remote revision number.
        received: i64,
    },

    /// Predecessor base revision mismatch against current terminal watermark.
    #[error("concurrency conflict detected: expected base {expected}, received {received:?}")]
    ConcurrencyConflict {
        /// Expected local base revision.
        expected: u64,
        /// Base revision declared by remote.
        received: Option<i64>,
    },

    /// Tenant boundary violation (cross-tenant leak attempt).
    #[error("tenant mismatch: expected `{expected}`, received `{received}`")]
    TenantMismatch {
        /// Expected tenant ID.
        expected: String,
        /// Remote tenant ID in revision.
        received: String,
    },

    /// Branch boundary violation.
    #[error("branch mismatch: expected `{expected}`, received `{received}`")]
    BranchMismatch {
        /// Expected branch ID.
        expected: String,
        /// Remote branch ID in revision.
        received: String,
    },

    /// Underlying SQLite storage error.
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),

    /// Core domain validation error.
    #[error("core domain error: {0}")]
    Core(#[from] CoreError),

    /// General bridge error.
    #[error("bridge error: {0}")]
    Bridge(#[from] BridgeError),
}

// ── Replication Models ─────────────────────────────────────────────────

/// Remote revision item fetched from `/api/v1/topology/revisions/pull`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteTopologyRevision {
    /// Revision row ID.
    pub id: String,
    /// Target branch identifier.
    pub branch_id: String,
    /// Monotonically increasing revision sequence number.
    pub revision: i64,
    /// Predecessor base revision for concurrency verification.
    pub base_revision: Option<i64>,
    /// Human-readable explanation of changes.
    pub change_note: String,
    /// Serialized JSON diagram envelope (None if deflated).
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

/// Trusted signing key registry for additive key rotation (ADR-66 D4 & T10).
#[derive(Debug, Clone, Default)]
pub struct TrustedKeyRegistry {
    keys: HashMap<String, Vec<u8>>,
}

impl TrustedKeyRegistry {
    /// Create an empty key registry.
    pub fn new() -> Self {
        Self::default()
    }

    /// Add a trusted key to the registry (builder pattern).
    pub fn with_key(mut self, key_id: impl Into<String>, key: Vec<u8>) -> Self {
        self.keys.insert(key_id.into(), key);
        self
    }

    /// Register a trusted key identifier and its secret material.
    pub fn add_key(&mut self, key_id: impl Into<String>, key: Vec<u8>) {
        self.keys.insert(key_id.into(), key);
    }

    /// Remove a retired key identifier.
    pub fn remove_key(&mut self, key_id: &str) -> Option<Vec<u8>> {
        self.keys.remove(key_id)
    }

    /// Lookup key material by identifier.
    pub fn get(&self, key_id: &str) -> Option<&[u8]> {
        self.keys.get(key_id).map(Vec::as_slice)
    }
}

/// Terminal replication configuration.
#[derive(Debug, Clone)]
pub struct TopologyReplicationConfig {
    /// Expected tenant identifier for multi-tenant containment (I5).
    pub tenant_id: String,
    /// Expected organization scope.
    pub org_id: String,
    /// Target branch profile identifier.
    pub branch_id: String,
    /// Trusted key registry for signature verification (D4).
    pub trusted_keys: TrustedKeyRegistry,
}

impl TopologyReplicationConfig {
    /// Create a new replication configuration for a specific tenant branch.
    pub fn new(
        tenant_id: impl Into<String>,
        org_id: impl Into<String>,
        branch_id: impl Into<String>,
        trusted_keys: TrustedKeyRegistry,
    ) -> Self {
        Self {
            tenant_id: tenant_id.into(),
            org_id: org_id.into(),
            branch_id: branch_id.into(),
            trusted_keys,
        }
    }
}

/// Outcome of processing an individual remote revision.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RevisionApplyOutcome {
    /// Revision was verified and applied atomically to local SQLite.
    Applied {
        /// Applied revision number.
        revision: u64,
    },
    /// Revision was an already-applied duplicate or stale revision (idempotent no-op).
    SkippedDuplicate {
        /// Skipped revision number.
        revision: u64,
    },
}

/// Comprehensive report produced at the end of a replication cycle.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopologyReplicationReport {
    /// Branch identifier.
    pub branch_id: String,
    /// Local watermark before replication began.
    pub initial_watermark: u64,
    /// Local watermark after replication completed.
    pub final_watermark: u64,
    /// Number of revisions received from remote.
    pub pulled_count: usize,
    /// Number of new revisions verified and applied.
    pub applied_count: usize,
    /// Number of duplicate/stale revisions skipped.
    pub skipped_count: usize,
}

// ── Transport Abstraction ──────────────────────────────────────────────

/// Trait abstracting transport communication with the remote topology API.
pub trait TopologyReplicationTransport: Send + Sync {
    /// Fetch revisions strictly greater than `since_revision` for `branch_id`.
    fn fetch_revisions(
        &self,
        branch_id: &str,
        since_revision: u64,
    ) -> impl std::future::Future<
        Output = Result<Vec<RemoteTopologyRevision>, TopologyReplicationError>,
    > + Send;
}

// ── Watermark & Queries ────────────────────────────────────────────────

/// Read the current highest applied revision number for a branch on the local terminal.
pub fn get_local_topology_watermark(
    conn: &Connection,
    branch_id: &str,
) -> Result<u64, rusqlite::Error> {
    let rev: Option<i64> = conn
        .query_row(
            "SELECT revision FROM topology_revisions
             WHERE branch_id = ?1
             ORDER BY revision DESC LIMIT 1",
            params![branch_id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(rev.unwrap_or(0).max(0) as u64)
}

// ── Verification Pipeline ──────────────────────────────────────────────

/// Verify cryptographic signature, tenant containment, and semantic graph invariants.
pub fn verify_remote_topology_revision<'a>(
    item: &'a RemoteTopologyRevision,
    config: &TopologyReplicationConfig,
) -> Result<(&'a str, Vec<Value>, Vec<Value>), TopologyReplicationError> {
    // 1. Tenant containment check (I5 & T1)
    if item.tenant_id != config.tenant_id {
        return Err(TopologyReplicationError::TenantMismatch {
            expected: config.tenant_id.clone(),
            received: item.tenant_id.clone(),
        });
    }

    // 2. Branch containment check (D6 & T9)
    if item.branch_id != config.branch_id {
        return Err(TopologyReplicationError::BranchMismatch {
            expected: config.branch_id.clone(),
            received: item.branch_id.clone(),
        });
    }

    // 3. Diagram presence (deflated revisions cannot be applied)
    let diagram = item
        .diagram
        .as_deref()
        .ok_or(TopologyReplicationError::DeflatedRevision {
            revision: item.revision,
        })?;

    // 4. Key trust check (ADR-66 D4 & T10)
    let key_id = item
        .key_id
        .as_deref()
        .ok_or(TopologyReplicationError::MissingKeyId(item.revision))?;
    let trusted_key = config
        .trusted_keys
        .get(key_id)
        .ok_or_else(|| TopologyReplicationError::UntrustedKeyId(key_id.to_string()))?;

    // 5. Signature verification (ADR-66 D4 & T4)
    let signature = item
        .signature
        .as_deref()
        .ok_or(TopologyReplicationError::MissingSignature(item.revision))?;
    let canonical = canonical_topology_revision_payload(
        &item.tenant_id,
        &item.org_id,
        &item.branch_id,
        item.revision,
        item.base_revision,
        diagram,
    );
    if !verify_topology_revision_signature(trusted_key, &canonical, signature) {
        return Err(TopologyReplicationError::InvalidSignature {
            key_id: key_id.to_string(),
            revision: item.revision,
        });
    }

    // 6. Semantic deserialization & invariant validation (I3 & T4)
    let parsed: Value =
        serde_json::from_str(diagram).map_err(|e| TopologyReplicationError::InvalidTopology {
            revision: item.revision,
            reason: format!("malformed envelope JSON: {e}"),
        })?;

    let nodes: Vec<Value> = parsed
        .get("nodes")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let wires: Vec<Value> = parsed
        .get("wires")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    if let Err(e) = validate_semantic_json(&nodes, &wires) {
        return Err(TopologyReplicationError::InvalidTopology {
            revision: item.revision,
            reason: e.to_string(),
        });
    }

    if let Some(branch_profile_id) = semantic_branch_profile_id(&nodes, &wires)
        && branch_profile_id != config.branch_id
    {
        return Err(TopologyReplicationError::InvalidTopology {
            revision: item.revision,
            reason: format!(
                "semantic branch profile `{branch_profile_id}` does not match target branch `{}`",
                config.branch_id
            ),
        });
    }

    Ok((diagram, nodes, wires))
}

// ── Atomic Application ─────────────────────────────────────────────────

/// Apply a single verified remote revision within an atomic SQLite transaction (I2 & T3).
pub fn apply_single_replicated_revision(
    conn: &mut Connection,
    item: &RemoteTopologyRevision,
    config: &TopologyReplicationConfig,
) -> Result<RevisionApplyOutcome, TopologyReplicationError> {
    let local_watermark = get_local_topology_watermark(conn, &item.branch_id)?;

    // 1. Monotonic ordering and idempotency check (I4 & T5)
    let incoming_rev = item.revision as u64;
    if incoming_rev <= local_watermark {
        return Ok(RevisionApplyOutcome::SkippedDuplicate {
            revision: incoming_rev,
        });
    }

    if incoming_rev != local_watermark + 1 {
        return Err(TopologyReplicationError::ConcurrencyGap {
            expected: local_watermark + 1,
            received: item.revision,
        });
    }

    let expected_base = if local_watermark == 0 {
        None
    } else {
        Some(local_watermark as i64)
    };
    if item.base_revision != expected_base
        && !(local_watermark == 0 && item.base_revision == Some(0))
    {
        return Err(TopologyReplicationError::ConcurrencyConflict {
            expected: local_watermark,
            received: item.base_revision,
        });
    }

    // 2. Cryptographic signature and semantic graph validation (I3, I5, T4)
    let (diagram_str, nodes, wires) = verify_remote_topology_revision(item, config)?;

    // 3. Begin atomic transaction on terminal SQLite
    let tx = conn.transaction()?;

    // 4. Update live settings table for runtime offline boot (I1)
    let setting_key = topology_setting_key(Some(&item.branch_id))?;
    kasirmu_core::Settings::set(&tx, &setting_key, diagram_str)?;

    // 5. Append immutable revision row in topology_revisions
    let rev_ctx = TopologyRevisionContext::new(
        &item.change_note,
        &item.published_by,
        item.workspace_creations as usize,
        item.workspace_updates as usize,
        item.workspace_archives as usize,
    )
    .with_signed_metadata(
        Some(&item.org_id),
        Some(&item.actor),
        item.key_id.as_deref(),
        item.signature.as_deref(),
        item.base_revision,
    );

    let graph = TopologyRevisionGraph {
        envelope: diagram_str,
        node_count: nodes.len(),
        wire_count: wires.len(),
    };
    insert_topology_revision_scoped(
        &tx,
        &item.branch_id,
        &item.tenant_id,
        incoming_rev,
        &graph,
        &rev_ctx,
    )?;

    // 6. Commit atomic transaction
    tx.commit()?;

    Ok(RevisionApplyOutcome::Applied {
        revision: incoming_rev,
    })
}

/// Execute a complete replication cycle over a transport, fetching and applying all new revisions.
pub async fn run_topology_replication<T: TopologyReplicationTransport>(
    conn: &mut Connection,
    transport: &T,
    config: &TopologyReplicationConfig,
) -> Result<TopologyReplicationReport, TopologyReplicationError> {
    let initial_watermark = get_local_topology_watermark(conn, &config.branch_id)?;
    let revisions = transport
        .fetch_revisions(&config.branch_id, initial_watermark)
        .await?;

    let pulled_count = revisions.len();
    let mut applied_count = 0;
    let mut skipped_count = 0;

    for rev in revisions {
        match apply_single_replicated_revision(conn, &rev, config)? {
            RevisionApplyOutcome::Applied { .. } => {
                applied_count += 1;
            }
            RevisionApplyOutcome::SkippedDuplicate { .. } => {
                skipped_count += 1;
            }
        }
    }

    let final_watermark = get_local_topology_watermark(conn, &config.branch_id)?;

    Ok(TopologyReplicationReport {
        branch_id: config.branch_id.clone(),
        initial_watermark,
        final_watermark,
        pulled_count,
        applied_count,
        skipped_count,
    })
}

#[cfg(test)]
#[path = "replication_tests.rs"]
mod tests;
