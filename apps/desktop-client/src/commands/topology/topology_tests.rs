//! Tests for the node-topology commands (topology.rs).
//!
//! The original 6k-line `mod tests` was split into six files by subject:
//! this file (semantic save/load roundtrip, versioned envelopes) plus
//! topology_field_tests.rs (payload field edge cases),
//! topology_serde_tests.rs (serde/structure + injection/encoding edge
//! cases), topology_persistence_tests.rs (save cycles, runtime plan, key
//! scoping), topology_stress_tests.rs and topology_command_tests.rs. The
//! shared helpers below are `pub(crate)` so the sibling modules glob them
//! via `use super::topology_tests::*`.

use super::*;
use oz_core::migrations;
use rusqlite::Connection;

pub(crate) fn fresh_conn() -> Connection {
    // These tests exercise the settings serialization contract, not the
    // filesystem. An in-memory database keeps the connection self-contained
    // and avoids leaving SQLite's journal/WAL files in a TempDir that is
    // dropped when this helper returns.
    let mut conn = Connection::open_in_memory().unwrap();
    migrations::run(&mut conn).unwrap();
    conn
}

#[test]
fn save_and_load_roundtrip() {
    let conn = fresh_conn();
    let nodes = vec![
        TopologyNodePayload {
            id: "store-1".into(),
            node_type: "store".into(),
            name: "Main Store".into(),
            subtitle: Some("Primary".into()),
            x: 100.0,
            y: 200.0,
            tier_requirement: None,
            telemetry_badge: Some("Online".into()),
            telemetry_status: Some("online".into()),
            metadata: None,
        },
        TopologyNodePayload {
            id: "ws-1".into(),
            node_type: "workspace".into(),
            name: "POS #1".into(),
            subtitle: None,
            x: 300.0,
            y: 100.0,
            tier_requirement: None,
            telemetry_badge: None,
            telemetry_status: None,
            metadata: None,
        },
    ];
    let wires = vec![TopologyWirePayload {
        id: "w-1".into(),
        from_node_id: "store-1".into(),
        to_node_id: "ws-1".into(),
        direction: "one-way".into(),
        label: Some("Binds Store".into()),
        from_port: Some("right".into()),
        to_port: Some("left".into()),
    }];

    save_topology_data(&conn, nodes, wires).unwrap();
    let loaded = load_topology_data(&conn).unwrap().unwrap();

    assert_eq!(loaded.nodes.len(), 2);
    assert_eq!(loaded.nodes[0].id, "store-1");
    assert_eq!(loaded.nodes[0].name, "Main Store");
    assert_eq!(loaded.nodes[0].x, 100.0);
    assert_eq!(loaded.wires.len(), 1);
    assert_eq!(loaded.wires[0].id, "w-1");
    assert_eq!(loaded.wires[0].from_port, Some(PortName::Right));
}

#[test]
fn save_normalizes_null_ports_to_renderer_defaults() {
    let conn = fresh_conn();
    let nodes = vec![
        TopologyNodePayload {
            id: "store-1".into(),
            node_type: "store".into(),
            name: "Main Store".into(),
            subtitle: Some("Primary".into()),
            x: 100.0,
            y: 200.0,
            tier_requirement: None,
            telemetry_badge: Some("Online".into()),
            telemetry_status: Some("online".into()),
            metadata: None,
        },
        TopologyNodePayload {
            id: "ws-1".into(),
            node_type: "workspace".into(),
            name: "POS #1".into(),
            subtitle: None,
            x: 300.0,
            y: 100.0,
            tier_requirement: None,
            telemetry_badge: None,
            telemetry_status: None,
            metadata: None,
        },
    ];
    // Null ports must be normalized to the editor's renderer defaults at
    // SAVE time so the DB never stores a wire with null from/to ports —
    // the frontend loader maps null → undefined, forcing every consumer
    // (e.g. the duplicate-wire detector) to re-apply the defaults.
    let wires = vec![
        TopologyWirePayload {
            id: "w-1".into(),
            from_node_id: "store-1".into(),
            to_node_id: "ws-1".into(),
            direction: "one-way".into(),
            label: Some("Binds Store".into()),
            from_port: None,
            to_port: None,
        },
        // Explicit non-default ports must NOT be normalized away — only
        // None gets filled (the get_or_insert contract).
        TopologyWirePayload {
            id: "w-2".into(),
            from_node_id: "store-1".into(),
            to_node_id: "ws-1".into(),
            direction: "one-way".into(),
            label: None,
            from_port: Some(PortName::Bottom),
            to_port: Some(PortName::Top),
        },
    ];

    save_topology_data(&conn, nodes, wires).unwrap();
    let loaded = load_topology_data(&conn).unwrap().unwrap();

    assert_eq!(loaded.wires.len(), 2);
    assert_eq!(loaded.wires[0].from_port, Some(PortName::Right));
    assert_eq!(loaded.wires[0].to_port, Some(PortName::Left));
    assert_eq!(loaded.wires[1].from_port, Some(PortName::Bottom));
    assert_eq!(loaded.wires[1].to_port, Some(PortName::Top));
}

#[test]
fn load_returns_none_for_fresh_db() {
    let conn = fresh_conn();
    let result = load_topology_data(&conn).unwrap();
    assert!(result.is_none());
}

#[test]
fn load_topology_data_preserves_raw_legacy_null_ports() {
    // Legacy rows written BEFORE the af7710d8 save-side normalization
    // store null ports. load_topology_data must NOT normalize them at
    // load time: the loader faithfully reflects what is stored, and the
    // frontend applies the renderer defaults (fromPort ?? 'right',
    // toPort ?? 'left') at every consumption point. A load->save cycle
    // heals the row via save_topology_data's own normalization — the
    // load boundary deliberately stays raw.
    let conn = fresh_conn();
    let legacy_json = r#"{"nodes":[{"id":"store-1","type":"store","name":"Legacy Store","x":0,"y":0}],"wires":[{"id":"w-legacy","from_node_id":"store-1","to_node_id":"store-1","direction":"one-way"}]}"#;
    oz_core::Settings::set(&conn, TOPOLOGY_SETTING_KEY, legacy_json).unwrap();

    let loaded = load_topology_data(&conn).unwrap().unwrap();
    assert_eq!(loaded.wires.len(), 1);
    // Raw passthrough: legacy null ports stay None at the load boundary.
    assert_eq!(loaded.wires[0].from_port, None);
    assert_eq!(loaded.wires[0].to_port, None);
    // The JSON key round-trips untouched (no write-back side effects).
    let stored = oz_core::Settings::get(&conn, TOPOLOGY_SETTING_KEY)
        .unwrap()
        .unwrap();
    assert_eq!(stored, legacy_json);
}

#[test]
fn save_overwrites_previous() {
    let conn = fresh_conn();

    save_topology_data(
        &conn,
        vec![TopologyNodePayload {
            id: "n1".into(),
            node_type: "store".into(),
            name: "First".into(),
            subtitle: None,
            x: 0.0,
            y: 0.0,
            tier_requirement: None,
            telemetry_badge: None,
            telemetry_status: None,
            metadata: None,
        }],
        vec![],
    )
    .unwrap();

    save_topology_data(
        &conn,
        vec![TopologyNodePayload {
            id: "n2".into(),
            node_type: "workspace".into(),
            name: "Second".into(),
            subtitle: None,
            x: 50.0,
            y: 60.0,
            tier_requirement: None,
            telemetry_badge: None,
            telemetry_status: None,
            metadata: None,
        }],
        vec![],
    )
    .unwrap();

    let loaded = load_topology_data(&conn).unwrap().unwrap();
    assert_eq!(loaded.nodes.len(), 1);
    assert_eq!(loaded.nodes[0].id, "n2");
}

#[test]
fn save_and_load_empty_graph() {
    let conn = fresh_conn();
    save_topology_data(&conn, vec![], vec![]).unwrap();
    let loaded = load_topology_data(&conn).unwrap().unwrap();
    assert!(loaded.nodes.is_empty());
    assert!(loaded.wires.is_empty());
}

#[test]
fn save_topology_data_returns_error_on_corrupt_existing_data() {
    let conn = fresh_conn();
    oz_core::Settings::set(&conn, TOPOLOGY_SETTING_KEY, "not valid json").unwrap();
    let result = load_topology_data(&conn);
    assert!(result.is_err());
}

#[test]
fn save_topology_data_rejects_empty_key() {
    let conn = fresh_conn();
    let node = TopologyNodePayload {
        id: "n1".into(),
        node_type: "store".into(),
        name: "".into(),
        subtitle: None,
        x: 0.0,
        y: 0.0,
        tier_requirement: None,
        telemetry_badge: None,
        telemetry_status: None,
        metadata: None,
    };
    save_topology_data(&conn, vec![node], vec![]).unwrap();
    let loaded = load_topology_data(&conn).unwrap().unwrap();
    assert_eq!(loaded.nodes.len(), 1);
    assert_eq!(loaded.nodes[0].name, "");
}
