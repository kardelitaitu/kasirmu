//! Command-layer unit tests for the topology bridge (relocated subset).
//!
//! From apps/desktop-client/src/commands/topology/topology_command_tests.rs:
//! the enum-contract, wire-serde, revision/TOCTOU, apply-ledger, envelope-
//! version, fingerprint, and warehouse quota/capacity subsets. The desktop
//! original retains the tauri mock-app integration tests, the
//! save_topology_data/load_topology_data compatibility tests, the
//! AppState-backed recovery/authorize tests, and the shared-contract test
//! (symbols without a bridge counterpart).

use super::*;
use rusqlite::Connection;
use serde_json::Value;

use kasirmu_core::migrations;
use kasirmu_core::topology::TOPOLOGY_CONTRACT_SCHEMA_VERSION;
use tempfile::tempdir;

use crate::error::BridgeError;
use crate::topology::persistence::{
    save_topology_json_at_key_with_revision, validate_warehouse_capacity, validate_warehouse_quota,
};
use crate::topology::semantics::{
    topology_apply_fingerprint, topology_apply_request_key, topology_envelope_json,
    validate_topology_envelope,
};

fn fresh_conn() -> Connection {
    crate::testing::temp_conn()
}

#[test]
fn node_type_partial_eq_str_matches_all_known_variants() {
    assert_eq!(NodeType::Store, "store");
    assert_eq!(NodeType::Workspace, "workspace");
    assert_eq!(NodeType::Warehouse, "warehouse");
    assert_eq!(NodeType::Hardware, "hardware");
    // Unknown never matches a concrete string.
    assert_ne!(NodeType::Unknown, "store");
    assert_ne!(NodeType::Unknown, "unknown");
}

#[test]
fn node_type_from_str_roundtrips_known_and_unknown() {
    assert_eq!(NodeType::from("store"), NodeType::Store);
    assert_eq!(NodeType::from("workspace"), NodeType::Workspace);
    assert_eq!(NodeType::from("warehouse"), NodeType::Warehouse);
    assert_eq!(NodeType::from("hardware"), NodeType::Hardware);
    // Anything else collapses to Unknown (caught on save).
    assert_eq!(NodeType::from("foo"), NodeType::Unknown);
    assert_eq!(NodeType::from(""), NodeType::Unknown);
    assert_eq!(NodeType::from("Store"), NodeType::Unknown); // case-sensitive
}

#[test]
fn wire_direction_partial_eq_and_from_consistent() {
    assert_eq!(WireDirection::OneWay, "one-way");
    assert_eq!(WireDirection::TwoWay, "two-way");
    assert_ne!(WireDirection::Unknown, "one-way");
    assert_eq!(WireDirection::from("one-way"), WireDirection::OneWay);
    assert_eq!(WireDirection::from("two-way"), WireDirection::TwoWay);
    assert_eq!(WireDirection::from("bidirectional"), WireDirection::Unknown);
}

#[test]
fn port_name_partial_eq_and_from_consistent() {
    assert_eq!(PortName::Top, "top");
    assert_eq!(PortName::Right, "right");
    assert_eq!(PortName::Bottom, "bottom");
    assert_eq!(PortName::Left, "left");
    assert_ne!(PortName::Unknown, "left");
    assert_eq!(PortName::from("top"), PortName::Top);
    assert_eq!(PortName::from("left"), PortName::Left);
    assert_eq!(PortName::from("usb"), PortName::Unknown);
}

#[test]
fn wire_null_direction_defaults_to_one_way() {
    let json = r#"{"id":"w1","from_node_id":"a","to_node_id":"b","direction":null}"#;
    let wire: TopologyWirePayload = serde_json::from_str(json).unwrap();
    assert_eq!(wire.direction, WireDirection::OneWay);
}

#[test]
fn wire_unknown_direction_becomes_unknown_variant() {
    // Any unrecognized wire direction string maps to WireDirection::Unknown
    // via #[serde(other)], which is then rejected by save_topology_data.
    let json = r#"{"id":"w1","from_node_id":"a","to_node_id":"b","direction":"bidirectional"}"#;
    let wire: TopologyWirePayload = serde_json::from_str(json).unwrap();
    assert_eq!(wire.direction, WireDirection::Unknown);
}

#[test]
fn wire_unknown_port_becomes_unknown_variant() {
    let json =
        r#"{"id":"w1","from_node_id":"a","to_node_id":"b","from_port":"north","to_port":"south"}"#;
    let wire: TopologyWirePayload = serde_json::from_str(json).unwrap();
    assert_eq!(wire.from_port, Some(PortName::Unknown));
    assert_eq!(wire.to_port, Some(PortName::Unknown));
}

#[test]
fn revision_aware_save_increments_and_rejects_stale_writer() {
    let conn = fresh_conn();
    let nodes = vec![serde_json::json!({
        "id": "store-1", "type": "store", "name": "Store", "x": 0.0, "y": 0.0
    })];
    let first = save_topology_json_at_key_with_revision(
        &conn,
        nodes.clone(),
        vec![],
        TOPOLOGY_SETTING_KEY,
        &[],
        Some(0),
        None,
        None,
        None,
    )
    .unwrap();
    assert_eq!(first, 1);
    let second = save_topology_json_at_key_with_revision(
        &conn,
        nodes.clone(),
        vec![],
        TOPOLOGY_SETTING_KEY,
        &[],
        Some(0),
        None,
        None,
        None,
    );
    assert!(
        matches!(second, Err(BridgeError::TopologyValidation { code, .. }) if code == "topology-revision-conflict")
    );
    let raw = kasirmu_core::Settings::get(&conn, TOPOLOGY_SETTING_KEY)
        .unwrap()
        .unwrap();
    let value: Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(value["revision"], 1);
}

#[test]
fn in_flight_peer_writer_is_not_silently_overwritten() {
    // TOCTOU race: the revision read + expected check happened OUTSIDE
    // any write lock, so a save whose read landed before a peer's commit
    // silently overwrote the peer (lost update). This test holds an
    // IMMEDIATE write lock (conn B) while conn A saves with
    // expected=0: A's read sees 0 (B's newer envelope is uncommitted),
    // A passes the check, then blocks on B's lock; B commits revision 1;
    // A's write proceeds. Pre-fix A commits revision 1 on top of B's —
    // both writers succeed, B's data lost. With the read inside an
    // IMMEDIATE transaction A re-reads after B's commit and must be
    // rejected with a revision conflict.
    let dir = tempdir().unwrap();
    let db_path = dir.path().join("rev_lock.db");
    {
        let mut setup = Connection::open(&db_path).unwrap();
        migrations::run(&mut setup).unwrap();
    }
    let path_str = db_path.to_string_lossy().to_string();

    // Writer B holds the write lock and commits a newer revision after
    // a controlled delay so A's save is already in flight.
    let b_conn = Connection::open(&db_path).unwrap();
    let tx_b =
        rusqlite::Transaction::new_unchecked(&b_conn, rusqlite::TransactionBehavior::Immediate)
            .unwrap();

    // Writer A saves on a second connection with a busy timeout so its
    // write attempt waits for B instead of erroring immediately.
    let p = path_str.clone();
    let a_handle = std::thread::spawn(move || {
        let conn = Connection::open(&p).unwrap();
        conn.busy_timeout(std::time::Duration::from_secs(5))
            .unwrap();
        let nodes = vec![serde_json::json!({
            "id": "a-1", "type": "store", "name": "A", "x": 0.0, "y": 0.0
        })];
        save_topology_json_at_key_with_revision(
            &conn,
            nodes,
            vec![],
            TOPOLOGY_SETTING_KEY,
            &[],
            Some(0),
            None,
            None,
            None,
        )
    });

    // Give A time to read revision 0 and block on B's lock, then commit
    // the newer revision from B's side.
    std::thread::sleep(std::time::Duration::from_millis(150));
    let b_nodes = vec![serde_json::json!({
        "id": "b-1", "type": "store", "name": "B", "x": 0.0, "y": 0.0
    })];
    let b_envelope = topology_envelope_json(&b_nodes, &[], 1, &[]).unwrap();
    kasirmu_core::Settings::set(&tx_b, TOPOLOGY_SETTING_KEY, &b_envelope).unwrap();
    tx_b.commit().unwrap();

    let a = a_handle.join().expect("writer A panicked");
    assert!(
        matches!(a, Err(BridgeError::TopologyValidation { ref code, .. }) if code == "topology-revision-conflict"),
        "writer A silently overwrote in-flight writer B: {a:?}"
    );
}

#[test]
fn request_ledger_key_rejects_path_injection() {
    assert!(topology_apply_request_key("request/evil").is_err());
    assert_eq!(
        topology_apply_request_key("request-1").unwrap(),
        "oz-pos/topology/apply-request/request-1"
    );
}

#[test]
fn contract_and_envelope_versions_are_independent_axes() {
    // The trap this pins: `TOPOLOGY_SCHEMA_VERSION` is enforced on READ by
    // `validate_topology_envelope`, which rejects any stored diagram whose
    // `schema_version` is not exactly it. Someone "fixing" a version mismatch by
    // raising the envelope constant would silently make every merchant's saved
    // graph unreadable — a data-availability event dressed up as a bump.
    assert_eq!(TOPOLOGY_SCHEMA_VERSION, 1);
    assert_eq!(TOPOLOGY_CONTRACT_SCHEMA_VERSION, 2);
    assert_ne!(TOPOLOGY_SCHEMA_VERSION, TOPOLOGY_CONTRACT_SCHEMA_VERSION);

    // And the envelope validator still accepts the version real diagrams carry.
    let stored = serde_json::json!({
        "schema_version": TOPOLOGY_SCHEMA_VERSION,
        "nodes": [],
        "wires": [],
    });
    assert!(
        validate_topology_envelope(&stored).is_ok(),
        "a diagram saved under the current envelope version must stay readable"
    );

    let future = serde_json::json!({
        "schema_version": TOPOLOGY_CONTRACT_SCHEMA_VERSION,
        "nodes": [],
        "wires": [],
    });
    let err = validate_topology_envelope(&future).unwrap_err();
    assert!(
        format!("{err}").contains("unsupported topology schema version"),
        "the envelope validator must still reject a version it does not know"
    );
}

#[test]
fn request_fingerprint_binds_store_branch_revision_and_graph_payload() {
    let first = topology_apply_fingerprint(
        "store-1",
        Some("branch-1"),
        4,
        &[],
        &[],
        &[],
        &[serde_json::json!({ "id": "node-1" })],
        &[],
        &[],
    )
    .unwrap();
    let changed_graph = topology_apply_fingerprint(
        "store-1",
        Some("branch-1"),
        4,
        &[],
        &[],
        &[],
        &[serde_json::json!({ "id": "node-2" })],
        &[],
        &[],
    )
    .unwrap();
    let changed_scope = topology_apply_fingerprint(
        "store-1",
        Some("branch-2"),
        4,
        &[],
        &[],
        &[],
        &[serde_json::json!({ "id": "node-1" })],
        &[],
        &[],
    )
    .unwrap();
    assert_ne!(first, changed_graph);
    assert_ne!(first, changed_scope);
}

#[test]
fn backend_warehouse_quota_allows_two_plus_warehouses() {
    // Plus allows 2 warehouses (§3) — two nodes must pass.
    let nodes = vec![
        serde_json::json!({ "id": "wh-1", "type": "warehouse" }),
        serde_json::json!({ "id": "wh-2", "type": "warehouse" }),
    ];
    let result =
        validate_warehouse_quota(&nodes, &kasirmu_core::subscription::SubscriptionTier::Plus);
    assert!(result.is_ok());
}

#[test]
fn backend_warehouse_quota_rejects_multiple_free_warehouses() {
    // Free allows 1 warehouse (§3) — two nodes must be rejected.
    let nodes = vec![
        serde_json::json!({ "id": "wh-1", "type": "warehouse" }),
        serde_json::json!({ "id": "wh-2", "type": "warehouse" }),
    ];
    let result =
        validate_warehouse_quota(&nodes, &kasirmu_core::subscription::SubscriptionTier::Free);
    assert!(
        matches!(result, Err(BridgeError::PermissionDenied(message)) if message.contains("limit 1"))
    );
}

#[test]
fn backend_warehouse_capacity_requires_operational_route_or_dismissal() {
    let nodes = vec![serde_json::json!({
        "id": "wh-1",
        "type": "warehouse",
        "metadata": { "stock": 5, "capacity": 10 }
    })];

    let result = validate_warehouse_capacity(
        &nodes,
        &[],
        &kasirmu_core::subscription::SubscriptionTier::Pro,
        &[],
    );
    assert!(
        matches!(result, Err(BridgeError::TopologyValidation { code, .. }) if code == "warehouse-missing-stock-routing")
    );

    let issue_key = "node:wh-1:topology-validation-warehouse-missing-stock-routing".to_string();
    let dismissed = validate_warehouse_capacity(
        &nodes,
        &[],
        &kasirmu_core::subscription::SubscriptionTier::Pro,
        &[issue_key],
    );
    assert!(dismissed.is_ok());
}

#[test]
fn backend_warehouse_capacity_rejects_stock_routing_into_full_pro_room() {
    let nodes = vec![serde_json::json!({
        "id": "wh-1",
        "type": "warehouse",
        "metadata": { "stock": 10, "capacity": 10 }
    })];
    let wires = vec![serde_json::json!({
        "id": "wire-1",
        "to_node_id": "wh-1",
        "relationship_type": "stock-routing",
        "to_port_id": "stock-in"
    })];
    let result = validate_warehouse_capacity(
        &nodes,
        &wires,
        &kasirmu_core::subscription::SubscriptionTier::Pro,
        &[],
    );
    assert!(
        matches!(result, Err(BridgeError::TopologyValidation { code, .. }) if code == "warehouse-at-capacity")
    );
}
