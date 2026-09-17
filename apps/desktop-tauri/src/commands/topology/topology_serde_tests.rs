//! Serde and structural tests for the typed topology payloads: envelope
//! shape, duplicate-id rejection, thousand-node round-trips, and
//! injection/encoding edge cases (HTML, RTL, zero-width, control chars).
//!
//! Split from topology_tests.rs so every test file in the commands dir
//! stays under the ~3k-line guideline. `use super::*` resolves the root's
//! flat namespace; `use super::topology_tests::*` shares the module's test
//! helpers (fresh_conn).

use super::topology_tests::*;
use super::*;

// ── TopologyData structural tests ──────────────────────────────

#[test]
fn save_topology_data_rejects_duplicate_wire_ids() {
    let conn = fresh_conn();
    let nodes = vec![TopologyNodePayload {
        id: "n1".into(),
        node_type: "store".into(),
        name: "Dup".into(),
        subtitle: None,
        x: 0.0,
        y: 0.0,
        tier_requirement: None,
        telemetry_badge: None,
        telemetry_status: None,
        metadata: None,
    }];
    let wires = vec![
        TopologyWirePayload {
            id: "same-id".into(),
            from_node_id: "n1".into(),
            to_node_id: "n1".into(),
            direction: "one-way".into(),
            label: None,
            from_port: None,
            to_port: None,
        },
        TopologyWirePayload {
            id: "same-id".into(),
            from_node_id: "n1".into(),
            to_node_id: "n1".into(),
            direction: "two-way".into(),
            label: None,
            from_port: None,
            to_port: None,
        },
    ];
    let result = save_topology_data(&conn, nodes, wires);
    assert!(result.is_err());
    let err = result.unwrap_err().to_string();
    assert!(
        err.contains("duplicate wire id"),
        "error should mention duplicate wire id, got: {err}"
    );
}

#[test]
fn save_topology_data_rejects_wire_to_nonexistent_node() {
    let conn = fresh_conn();
    let nodes = vec![TopologyNodePayload {
        id: "n1".into(),
        node_type: "store".into(),
        name: "Store".into(),
        subtitle: None,
        x: 0.0,
        y: 0.0,
        tier_requirement: None,
        telemetry_badge: None,
        telemetry_status: None,
        metadata: None,
    }];
    let wires = vec![TopologyWirePayload {
        id: "orphan".into(),
        from_node_id: "ghost".into(),
        to_node_id: "n1".into(),
        direction: "one-way".into(),
        label: None,
        from_port: None,
        to_port: None,
    }];
    let result = save_topology_data(&conn, nodes, wires);
    assert!(result.is_err());
    let err = result.unwrap_err().to_string();
    assert!(
        err.contains("unknown from_node_id"),
        "error should mention unknown from_node_id, got: {err}"
    );
}

#[test]
fn save_topology_data_rejects_wire_to_unknown_to_node() {
    let conn = fresh_conn();
    let nodes = vec![TopologyNodePayload {
        id: "n1".into(),
        node_type: "store".into(),
        name: "Store".into(),
        subtitle: None,
        x: 0.0,
        y: 0.0,
        tier_requirement: None,
        telemetry_badge: None,
        telemetry_status: None,
        metadata: None,
    }];
    let wires = vec![TopologyWirePayload {
        id: "orphan".into(),
        from_node_id: "n1".into(),
        to_node_id: "nowhere".into(),
        direction: "one-way".into(),
        label: None,
        from_port: None,
        to_port: None,
    }];
    let result = save_topology_data(&conn, nodes, wires);
    assert!(result.is_err());
    let err = result.unwrap_err().to_string();
    assert!(
        err.contains("unknown to_node_id"),
        "error should mention unknown to_node_id, got: {err}"
    );
}
