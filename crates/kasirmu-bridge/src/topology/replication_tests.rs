use super::super::revisions::sign_topology_revision_payload;
use super::*;
use rusqlite::Connection;
use serde_json::json;

const TEST_KEY_ID: &str = "key-2026-v1";
const TEST_KEY: &[u8] = b"secret-topology-signing-key-32b!";

fn fresh_conn() -> Connection {
    kasirmu_core::migrations::fresh_db()
}

fn sample_valid_envelope(branch_id: &str, revision: i64) -> String {
    let envelope = json!({
        "schema_version": 1,
        "revision": revision,
        "nodes": [
            {
                "id": "branch",
                "type": "branch-location",
                "name": "Main Branch",
                "store_profile_id": branch_id
            },
            {
                "id": "pos-1",
                "type": "workspace",
                "name": "Register 1",
                "metadata": {
                    "typeKey": "store-pos"
                }
            }
        ],
        "wires": [
            {
                "id": "wire-1",
                "from_node_id": "branch",
                "to_node_id": "pos-1",
                "direction": "one-way",
                "from_port_id": "location-out",
                "to_port_id": "location-in",
                "relationship_type": "location"
            }
        ]
    });
    serde_json::to_string(&envelope).unwrap()
}

fn create_signed_remote_revision(
    branch_id: &str,
    tenant_id: &str,
    org_id: &str,
    revision: i64,
    base_revision: Option<i64>,
    key_id: &str,
    key_bytes: &[u8],
) -> RemoteTopologyRevision {
    let diagram = sample_valid_envelope(branch_id, revision);
    let canonical = canonical_topology_revision_payload(
        tenant_id,
        org_id,
        branch_id,
        revision,
        base_revision,
        &diagram,
    );
    let signature = sign_topology_revision_payload(key_bytes, &canonical);

    RemoteTopologyRevision {
        id: format!("rev-{revision}"),
        branch_id: branch_id.to_string(),
        revision,
        base_revision,
        change_note: format!("Revision {revision} publish"),
        diagram: Some(diagram),
        workspace_creations: 1,
        workspace_updates: 0,
        workspace_archives: 0,
        node_count: 2,
        wire_count: 1,
        contract_schema_version: 2,
        pinned: false,
        published_at: chrono::Utc::now().to_rfc3339(),
        published_by: "admin-actor".to_string(),
        tenant_id: tenant_id.to_string(),
        org_id: org_id.to_string(),
        actor: "admin-actor".to_string(),
        key_id: Some(key_id.to_string()),
        signature: Some(signature),
    }
}

fn test_config(branch_id: &str, tenant_id: &str) -> TopologyReplicationConfig {
    let trusted_keys = TrustedKeyRegistry::new().with_key(TEST_KEY_ID, TEST_KEY.to_vec());
    TopologyReplicationConfig::new(tenant_id, "org-hq", branch_id, trusted_keys)
}

struct MockTransport {
    revisions: Vec<RemoteTopologyRevision>,
    network_down: bool,
}

impl MockTransport {
    fn new(revisions: Vec<RemoteTopologyRevision>) -> Self {
        Self {
            revisions,
            network_down: false,
        }
    }

    fn network_down() -> Self {
        Self {
            revisions: Vec::new(),
            network_down: true,
        }
    }
}

impl TopologyReplicationTransport for MockTransport {
    async fn fetch_revisions(
        &self,
        branch_id: &str,
        since_revision: u64,
    ) -> Result<Vec<RemoteTopologyRevision>, TopologyReplicationError> {
        if self.network_down {
            return Err(TopologyReplicationError::NetworkUnavailable(
                "connection refused: cloud-server unreachable".to_string(),
            ));
        }
        let filtered = self
            .revisions
            .iter()
            .filter(|r| r.branch_id == branch_id && (r.revision as u64) > since_revision)
            .cloned()
            .collect();
        Ok(filtered)
    }
}

// ── T3: Atomic Apply ──────────────────────────────────────────────────

#[test]
fn single_revision_applies_atomically_to_sqlite() {
    let mut conn = fresh_conn();
    let config = test_config("branch-main", "tenant-1");
    let rev1 = create_signed_remote_revision(
        "branch-main",
        "tenant-1",
        "org-hq",
        1,
        None,
        TEST_KEY_ID,
        TEST_KEY,
    );

    let outcome = apply_single_replicated_revision(&mut conn, &rev1, &config)
        .expect("valid revision apply must succeed");
    assert_eq!(outcome, RevisionApplyOutcome::Applied { revision: 1 });

    let watermark = get_local_topology_watermark(&conn, "branch-main").unwrap();
    assert_eq!(watermark, 1);

    // Verify settings table updated for offline boot (I1)
    let setting_key = topology_setting_key(Some("branch-main")).unwrap();
    let stored_setting = kasirmu_core::Settings::get(&conn, &setting_key)
        .unwrap()
        .expect("topology setting must exist");
    assert!(stored_setting.contains("\"revision\":1"));

    // Verify topology_revisions row
    let (row_rev, key_id, sig): (i64, String, String) = conn
        .query_row(
            "SELECT revision, key_id, signature FROM topology_revisions WHERE branch_id = 'branch-main'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!(row_rev, 1);
    assert_eq!(key_id, TEST_KEY_ID);
    assert!(!sig.is_empty());
}

// ── T5: Replay & Out-of-Order Idempotency ──────────────────────────────

#[test]
fn replayed_and_duplicate_revisions_are_skipped_idempotently() {
    let mut conn = fresh_conn();
    let config = test_config("branch-main", "tenant-1");
    let rev1 = create_signed_remote_revision(
        "branch-main",
        "tenant-1",
        "org-hq",
        1,
        None,
        TEST_KEY_ID,
        TEST_KEY,
    );

    let outcome1 = apply_single_replicated_revision(&mut conn, &rev1, &config).unwrap();
    assert_eq!(outcome1, RevisionApplyOutcome::Applied { revision: 1 });

    // Replay rev 1 again
    let outcome2 = apply_single_replicated_revision(&mut conn, &rev1, &config).unwrap();
    assert_eq!(
        outcome2,
        RevisionApplyOutcome::SkippedDuplicate { revision: 1 }
    );

    // Watermark unchanged
    assert_eq!(
        get_local_topology_watermark(&conn, "branch-main").unwrap(),
        1
    );
}

// ── T8: Monotonic Gap & Concurrency Detection ──────────────────────────

#[test]
fn revision_sequence_gap_is_refused() {
    let mut conn = fresh_conn();
    let config = test_config("branch-main", "tenant-1");

    // Local watermark is 0; remote sends revision 2 directly (gap: missing 1)
    let rev2 = create_signed_remote_revision(
        "branch-main",
        "tenant-1",
        "org-hq",
        2,
        Some(1),
        TEST_KEY_ID,
        TEST_KEY,
    );

    let err = apply_single_replicated_revision(&mut conn, &rev2, &config).unwrap_err();
    match err {
        TopologyReplicationError::ConcurrencyGap { expected, received } => {
            assert_eq!(expected, 1);
            assert_eq!(received, 2);
        }
        other => panic!("expected ConcurrencyGap, got {other:?}"),
    }

    // Watermark remains 0
    assert_eq!(
        get_local_topology_watermark(&conn, "branch-main").unwrap(),
        0
    );
}

#[test]
fn mismatched_base_revision_is_refused() {
    let mut conn = fresh_conn();
    let config = test_config("branch-main", "tenant-1");
    let rev1 = create_signed_remote_revision(
        "branch-main",
        "tenant-1",
        "org-hq",
        1,
        None,
        TEST_KEY_ID,
        TEST_KEY,
    );
    apply_single_replicated_revision(&mut conn, &rev1, &config).unwrap();

    // Remote claims base_revision is 99 instead of 1
    let mut rev2 = create_signed_remote_revision(
        "branch-main",
        "tenant-1",
        "org-hq",
        2,
        Some(99),
        TEST_KEY_ID,
        TEST_KEY,
    );
    // Sign with base_revision = 99
    let canonical = canonical_topology_revision_payload(
        "tenant-1",
        "org-hq",
        "branch-main",
        2,
        Some(99),
        rev2.diagram.as_ref().unwrap(),
    );
    rev2.signature = Some(sign_topology_revision_payload(TEST_KEY, &canonical));

    let err = apply_single_replicated_revision(&mut conn, &rev2, &config).unwrap_err();
    match err {
        TopologyReplicationError::ConcurrencyConflict { expected, received } => {
            assert_eq!(expected, 1);
            assert_eq!(received, Some(99));
        }
        other => panic!("expected ConcurrencyConflict, got {other:?}"),
    }
}

// ── T4: Bad Revision Rejection ─────────────────────────────────────────

#[test]
fn tampered_signature_is_rejected_whole() {
    let mut conn = fresh_conn();
    let config = test_config("branch-main", "tenant-1");
    let mut rev = create_signed_remote_revision(
        "branch-main",
        "tenant-1",
        "org-hq",
        1,
        None,
        TEST_KEY_ID,
        TEST_KEY,
    );
    // Tamper signature
    rev.signature = Some("deadbeefcafebabe0123456789abcdef".to_string());

    let err = apply_single_replicated_revision(&mut conn, &rev, &config).unwrap_err();
    match err {
        TopologyReplicationError::InvalidSignature { key_id, revision } => {
            assert_eq!(key_id, TEST_KEY_ID);
            assert_eq!(revision, 1);
        }
        other => panic!("expected InvalidSignature, got {other:?}"),
    }

    assert_eq!(
        get_local_topology_watermark(&conn, "branch-main").unwrap(),
        0
    );
}

#[test]
fn invalid_semantic_graph_is_rejected_and_leaves_db_clean() {
    let mut conn = fresh_conn();
    let config = test_config("branch-main", "tenant-1");

    // Invalid graph: workspace node without branch location wire
    let invalid_envelope = json!({
        "schema_version": 1,
        "revision": 1,
        "nodes": [
            {
                "id": "orphan-pos",
                "type": "workspace",
                "name": "Orphan",
                "store_profile_id": "branch-main",
                "metadata": { "typeKey": "store-pos" }
            }
        ],
        "wires": []
    })
    .to_string();

    let canonical = canonical_topology_revision_payload(
        "tenant-1",
        "org-hq",
        "branch-main",
        1,
        None,
        &invalid_envelope,
    );
    let signature = sign_topology_revision_payload(TEST_KEY, &canonical);

    let rev = RemoteTopologyRevision {
        id: "rev-1".into(),
        branch_id: "branch-main".into(),
        revision: 1,
        base_revision: None,
        change_note: "Bad graph".into(),
        diagram: Some(invalid_envelope),
        workspace_creations: 1,
        workspace_updates: 0,
        workspace_archives: 0,
        node_count: 1,
        wire_count: 0,
        contract_schema_version: 2,
        pinned: false,
        published_at: chrono::Utc::now().to_rfc3339(),
        published_by: "actor".into(),
        tenant_id: "tenant-1".into(),
        org_id: "org-hq".into(),
        actor: "actor".into(),
        key_id: Some(TEST_KEY_ID.into()),
        signature: Some(signature),
    };

    let err = apply_single_replicated_revision(&mut conn, &rev, &config).unwrap_err();
    assert!(matches!(
        err,
        TopologyReplicationError::InvalidTopology { .. }
    ));
    assert_eq!(
        get_local_topology_watermark(&conn, "branch-main").unwrap(),
        0
    );
}

// ── T1: Cross-Tenant Isolation ────────────────────────────────────────

#[test]
fn cross_tenant_revision_is_rejected() {
    let mut conn = fresh_conn();
    let config = test_config("branch-main", "tenant-legit");
    let rev = create_signed_remote_revision(
        "branch-main",
        "tenant-attacker",
        "org-hq",
        1,
        None,
        TEST_KEY_ID,
        TEST_KEY,
    );

    let err = apply_single_replicated_revision(&mut conn, &rev, &config).unwrap_err();
    match err {
        TopologyReplicationError::TenantMismatch { expected, received } => {
            assert_eq!(expected, "tenant-legit");
            assert_eq!(received, "tenant-attacker");
        }
        other => panic!("expected TenantMismatch, got {other:?}"),
    }
    assert_eq!(
        get_local_topology_watermark(&conn, "branch-main").unwrap(),
        0
    );
}

// ── T10: Additive Key Rotation (ADR-66 D4) ────────────────────────────

#[test]
fn retired_key_is_refused_until_new_key_is_registered() {
    let mut conn = fresh_conn();
    let old_key_id = "key-2025-retired";
    let new_key_id = "key-2026-active";
    let new_key_bytes = b"brand-new-2026-signing-secret-key!";

    // Registry holds only old key initially
    let mut registry = TrustedKeyRegistry::new().with_key(old_key_id, b"old-secret-key".to_vec());
    let mut config =
        TopologyReplicationConfig::new("tenant-1", "org-hq", "branch-main", registry.clone());

    // Remote revision signed with new key
    let rev = create_signed_remote_revision(
        "branch-main",
        "tenant-1",
        "org-hq",
        1,
        None,
        new_key_id,
        new_key_bytes,
    );

    // 1. Refused because new key is not trusted yet
    let err = apply_single_replicated_revision(&mut conn, &rev, &config).unwrap_err();
    match err {
        TopologyReplicationError::UntrustedKeyId(key) => assert_eq!(key, new_key_id),
        other => panic!("expected UntrustedKeyId, got {other:?}"),
    }

    // 2. Add new key additively (D4: additive key rotation)
    registry.add_key(new_key_id, new_key_bytes.to_vec());
    config.trusted_keys = registry;

    // 3. Acceptance succeeds without code change
    let outcome = apply_single_replicated_revision(&mut conn, &rev, &config).unwrap();
    assert_eq!(outcome, RevisionApplyOutcome::Applied { revision: 1 });
    assert_eq!(
        get_local_topology_watermark(&conn, "branch-main").unwrap(),
        1
    );
}

// ── T2: Offline Autonomy & Complete Replication Cycle ─────────────────

#[tokio::test]
async fn network_unavailability_degrades_gracefully_without_error_propagation() {
    let mut conn = fresh_conn();
    let config = test_config("branch-main", "tenant-1");
    let transport = MockTransport::network_down();

    let res = run_topology_replication(&mut conn, &transport, &config).await;
    assert!(matches!(
        res,
        Err(TopologyReplicationError::NetworkUnavailable(_))
    ));

    // Terminal SQLite is 100% operational and healthy
    assert_eq!(
        get_local_topology_watermark(&conn, "branch-main").unwrap(),
        0
    );
}

#[tokio::test]
async fn full_replication_cycle_pulls_and_applies_monotonic_revisions() {
    let mut conn = fresh_conn();
    let config = test_config("branch-main", "tenant-1");

    let rev1 = create_signed_remote_revision(
        "branch-main",
        "tenant-1",
        "org-hq",
        1,
        None,
        TEST_KEY_ID,
        TEST_KEY,
    );
    let rev2 = create_signed_remote_revision(
        "branch-main",
        "tenant-1",
        "org-hq",
        2,
        Some(1),
        TEST_KEY_ID,
        TEST_KEY,
    );

    let transport = MockTransport::new(vec![rev1, rev2]);

    let report = run_topology_replication(&mut conn, &transport, &config)
        .await
        .expect("replication cycle must succeed");

    assert_eq!(report.initial_watermark, 0);
    assert_eq!(report.final_watermark, 2);
    assert_eq!(report.pulled_count, 2);
    assert_eq!(report.applied_count, 2);
    assert_eq!(report.skipped_count, 0);

    // Second run with same transport yields 0 applied, 0 pulled
    let report2 = run_topology_replication(&mut conn, &transport, &config)
        .await
        .expect("second replication cycle must succeed");
    assert_eq!(report2.initial_watermark, 2);
    assert_eq!(report2.final_watermark, 2);
    assert_eq!(report2.pulled_count, 0);
    assert_eq!(report2.applied_count, 0);
}
