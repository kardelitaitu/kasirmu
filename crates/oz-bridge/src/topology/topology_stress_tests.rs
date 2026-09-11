//! Stress and boundary behaviour of the topology data layer: NaN/inf
//! coordinate sanitisation, thousand-node and ten-thousand-node graphs,
//! hundred-kilobyte strings, unicode and astral-plane names, concurrent
//! readers and writers over file-backed databases, save/load cycle
//! integrity, and revision-race publication.
//!
//! Moved subset of the desktop `topology_stress_tests` module. Mounted as
//! `topology_stress_tests` beside `model.rs` in `oz_bridge::topology` via
//! `#[path]`; the flat namespace resolves through `use super::*`. The
//! former `super::topology_tests::*` helpers are embedded test-locally
//! (`fresh_conn` delegates to the shared headless harness, the payload
//! builders are copied verbatim). The orphan-wire rejection test stays
//! desktop-side: it drives the `#[cfg(test)]` `save_topology_data`
//! helper, which is desktop-only.
use super::*;
use crate::topology::persistence::save_topology_json_at_key_with_revision;
use crate::topology::revisions::TopologyRevisionContext;
use oz_core::migrations;
use rusqlite::Connection;
use tempfile::tempdir;

fn fresh_conn() -> rusqlite::Connection {
    crate::testing::temp_conn()
}

#[test]
fn nan_x_coordinate_sanitised_to_zero() {
    let node = TopologyNodePayload {
        id: "nan-x".into(),
        node_type: "store".into(),
        name: "NaN X".into(),
        subtitle: None,
        x: f64::NAN,
        y: 0.0,
        tier_requirement: None,
        telemetry_badge: None,
        telemetry_status: None,
        metadata: None,
    };
    let json = serde_json::to_string(&node).unwrap();
    let roundtripped: TopologyNodePayload = serde_json::from_str(&json).unwrap();
    assert_eq!(roundtripped.x, 0.0, "NaN x must be sanitised to 0.0");
}

#[test]
fn nan_y_coordinate_sanitised_to_zero() {
    let node = TopologyNodePayload {
        id: "nan-y".into(),
        node_type: "store".into(),
        name: "NaN Y".into(),
        subtitle: None,
        x: 0.0,
        y: f64::NAN,
        tier_requirement: None,
        telemetry_badge: None,
        telemetry_status: None,
        metadata: None,
    };
    let json = serde_json::to_string(&node).unwrap();
    let roundtripped: TopologyNodePayload = serde_json::from_str(&json).unwrap();
    assert_eq!(roundtripped.y, 0.0, "NaN y must be sanitised to 0.0");
}

#[test]
fn infinity_x_coordinate_sanitised_to_zero() {
    let node = TopologyNodePayload {
        id: "inf-x".into(),
        node_type: "store".into(),
        name: "Inf X".into(),
        subtitle: None,
        x: f64::INFINITY,
        y: 0.0,
        tier_requirement: None,
        telemetry_badge: None,
        telemetry_status: None,
        metadata: None,
    };
    let json = serde_json::to_string(&node).unwrap();
    let roundtripped: TopologyNodePayload = serde_json::from_str(&json).unwrap();
    assert_eq!(roundtripped.x, 0.0, "Infinity x must be sanitised to 0.0");
}

#[test]
fn neg_infinity_y_coordinate_sanitised_to_zero() {
    let node = TopologyNodePayload {
        id: "neg-inf-y".into(),
        node_type: "store".into(),
        name: "Neg Inf Y".into(),
        subtitle: None,
        x: 0.0,
        y: f64::NEG_INFINITY,
        tier_requirement: None,
        telemetry_badge: None,
        telemetry_status: None,
        metadata: None,
    };
    let json = serde_json::to_string(&node).unwrap();
    let roundtripped: TopologyNodePayload = serde_json::from_str(&json).unwrap();
    assert_eq!(roundtripped.y, 0.0, "-Infinity y must be sanitised to 0.0");
}

#[test]
fn mixed_nan_sanitised_does_not_poison_topology() {
    let good = TopologyNodePayload {
        id: "good".into(),
        node_type: "store".into(),
        name: "Good".into(),
        subtitle: None,
        x: 1.0,
        y: 2.0,
        tier_requirement: None,
        telemetry_badge: None,
        telemetry_status: None,
        metadata: None,
    };
    let bad = TopologyNodePayload {
        id: "bad".into(),
        node_type: "store".into(),
        name: "Bad".into(),
        subtitle: None,
        x: f64::NAN,
        y: f64::INFINITY,
        tier_requirement: None,
        telemetry_badge: None,
        telemetry_status: None,
        metadata: None,
    };
    let data = TopologyData {
        nodes: vec![good, bad],
        wires: vec![],
    };
    let json = serde_json::to_string(&data).unwrap();
    let roundtripped: TopologyData = serde_json::from_str(&json).unwrap();
    assert_eq!(roundtripped.nodes.len(), 2);
    assert_eq!(roundtripped.nodes[0].x, 1.0);
    assert_eq!(roundtripped.nodes[1].x, 0.0, "NaN must be sanitised to 0.0");
    assert_eq!(
        roundtripped.nodes[1].y, 0.0,
        "Infinity must be sanitised to 0.0"
    );
}

// ── Graph integrity — wiring bugs ──────────────────────────────

#[test]
fn duplicate_node_ids_are_not_rejected() {
    let data = TopologyData {
        nodes: vec![
            TopologyNodePayload {
                id: "dup-id".into(),
                node_type: "store".into(),
                name: "First".into(),
                subtitle: None,
                x: 0.0,
                y: 0.0,
                tier_requirement: None,
                telemetry_badge: None,
                telemetry_status: None,
                metadata: None,
            },
            TopologyNodePayload {
                id: "dup-id".into(),
                node_type: "workspace".into(),
                name: "Second".into(),
                subtitle: None,
                x: 100.0,
                y: 0.0,
                tier_requirement: None,
                telemetry_badge: None,
                telemetry_status: None,
                metadata: None,
            },
        ],
        wires: vec![],
    };
    let json = serde_json::to_string(&data).unwrap();
    let roundtripped: TopologyData = serde_json::from_str(&json).unwrap();
    assert_eq!(roundtripped.nodes.len(), 2);
    assert_eq!(roundtripped.nodes[0].id, roundtripped.nodes[1].id);
}

#[test]
fn thousand_wires_between_two_nodes_roundtrip() {
    let wires: Vec<TopologyWirePayload> = (0..1000)
        .map(|i| TopologyWirePayload {
            id: format!("w-{i}"),
            from_node_id: "a".into(),
            to_node_id: "b".into(),
            direction: "one-way".into(),
            label: None,
            from_port: None,
            to_port: None,
        })
        .collect();
    let data = TopologyData {
        nodes: vec![],
        wires,
    };
    let json = serde_json::to_string(&data).unwrap();
    let roundtripped: TopologyData = serde_json::from_str(&json).unwrap();
    assert_eq!(roundtripped.wires.len(), 1000);
    assert_eq!(roundtripped.wires[0].id, "w-0");
    assert_eq!(roundtripped.wires[999].id, "w-999");
}

#[test]
fn star_topology_preserved_through_db() {
    let conn = fresh_conn();
    let mut nodes: Vec<TopologyNodePayload> = (0..50)
        .map(|i| TopologyNodePayload {
            id: format!("leaf-{i}"),
            node_type: "workspace".into(),
            name: format!("Leaf {i}"),
            subtitle: None,
            x: (i as f64) * 20.0,
            y: 0.0,
            tier_requirement: None,
            telemetry_badge: None,
            telemetry_status: None,
            metadata: None,
        })
        .collect();
    nodes.push(TopologyNodePayload {
        id: "hub".into(),
        node_type: "store".into(),
        name: "Hub".into(),
        subtitle: None,
        x: 500.0,
        y: 500.0,
        tier_requirement: None,
        telemetry_badge: None,
        telemetry_status: None,
        metadata: None,
    });
    let wires: Vec<TopologyWirePayload> = (0..50)
        .map(|i| TopologyWirePayload {
            id: format!("w-{i}"),
            from_node_id: "hub".into(),
            to_node_id: format!("leaf-{i}"),
            direction: "two-way".into(),
            label: None,
            from_port: None,
            to_port: None,
        })
        .collect();
    let data = TopologyData { nodes, wires };
    let json = serde_json::to_string(&data).unwrap();
    oz_core::Settings::set(&conn, TOPOLOGY_SETTING_KEY, &json).unwrap();
    let loaded_raw = oz_core::Settings::get(&conn, TOPOLOGY_SETTING_KEY)
        .unwrap()
        .unwrap();
    let loaded: TopologyData = serde_json::from_str(&loaded_raw).unwrap();
    assert_eq!(loaded.nodes.len(), 51);
    assert_eq!(loaded.wires.len(), 50);
    let hub_wires: Vec<&TopologyWirePayload> = loaded
        .wires
        .iter()
        .filter(|w| w.from_node_id == "hub")
        .collect();
    assert_eq!(hub_wires.len(), 50);
}

// ── Large-scale persistence stress ─────────────────────────────

#[test]
fn five_thousand_node_graph_db_roundtrip() {
    let conn = fresh_conn();
    let nodes: Vec<TopologyNodePayload> = (0..5000)
        .map(|i| TopologyNodePayload {
            id: format!("node-{i:05}"),
            node_type: if i % 4 == 0 {
                "store"
            } else if i % 4 == 1 {
                "workspace"
            } else if i % 4 == 2 {
                "warehouse"
            } else {
                "hardware"
            }
            .into(),
            name: format!("Node {i}"),
            subtitle: if i % 10 == 0 {
                Some(format!("tenth-{i}"))
            } else {
                None
            },
            x: (i as f64) * 1.5,
            y: (i as f64) * 0.5,
            tier_requirement: if i % 3 == 0 {
                Some("premium".into())
            } else {
                None
            },
            telemetry_badge: if i % 5 == 0 {
                Some("Online".into())
            } else {
                None
            },
            telemetry_status: if i % 7 == 0 {
                Some("online".into())
            } else {
                None
            },
            metadata: None,
        })
        .collect();
    let data = TopologyData {
        nodes,
        wires: vec![],
    };
    let json = serde_json::to_string(&data).unwrap();
    oz_core::Settings::set(&conn, TOPOLOGY_SETTING_KEY, &json).unwrap();
    let loaded_raw = oz_core::Settings::get(&conn, TOPOLOGY_SETTING_KEY)
        .unwrap()
        .unwrap();
    let loaded: TopologyData = serde_json::from_str(&loaded_raw).unwrap();
    assert_eq!(loaded.nodes.len(), 5000);
    // Verify a few sample nodes for data integrity.
    assert_eq!(loaded.nodes[0].id, "node-00000");
    assert_eq!(loaded.nodes[999].node_type, "hardware");
    assert_eq!(loaded.nodes[1000].name, "Node 1000");
    // Nodes where i % 10 == 0 get a subtitle ("tenth-0", "tenth-10", …).
    assert_eq!(loaded.nodes[0].subtitle.as_deref(), Some("tenth-0"));
    assert_eq!(loaded.nodes[10].subtitle.as_deref(), Some("tenth-10"));
    assert!(
        loaded.nodes[9].subtitle.is_none(),
        "i=9 → no subtitle (9 % 10 = 9)"
    );
}

#[test]
fn three_thousand_wires_db_roundtrip() {
    let conn = fresh_conn();
    let nodes: Vec<TopologyNodePayload> = (0..100)
        .map(|i| TopologyNodePayload {
            id: format!("n-{i}"),
            node_type: "store".into(),
            name: format!("Node {i}"),
            subtitle: None,
            x: 0.0,
            y: 0.0,
            tier_requirement: None,
            telemetry_badge: None,
            telemetry_status: None,
            metadata: None,
        })
        .collect();
    let wires: Vec<TopologyWirePayload> = (0..3000)
        .map(|i| TopologyWirePayload {
            id: format!("w-{i}"),
            from_node_id: format!("n-{}", i % 100),
            to_node_id: format!("n-{}", (i + 1) % 100),
            direction: if i % 2 == 0 { "one-way" } else { "two-way" }.into(),
            label: if i % 10 == 0 {
                Some(format!("Label {i}"))
            } else {
                None
            },
            from_port: None,
            to_port: None,
        })
        .collect();
    let data = TopologyData { nodes, wires };
    let json = serde_json::to_string(&data).unwrap();
    oz_core::Settings::set(&conn, TOPOLOGY_SETTING_KEY, &json).unwrap();
    let loaded_raw = oz_core::Settings::get(&conn, TOPOLOGY_SETTING_KEY)
        .unwrap()
        .unwrap();
    let loaded: TopologyData = serde_json::from_str(&loaded_raw).unwrap();
    assert_eq!(loaded.nodes.len(), 100);
    assert_eq!(loaded.wires.len(), 3000);
    assert_eq!(loaded.wires[0].direction, "one-way");
    assert_eq!(loaded.wires[1].direction, "two-way");
    assert_eq!(loaded.wires[0].label.as_deref(), Some("Label 0"));
    assert!(loaded.wires[1].label.is_none());
}

// ── Extreme string values ──────────────────────────────────────

#[test]
fn node_id_with_special_url_chars() {
    let special_id = "store/1?region=west#section@host:port/path";
    let node = TopologyNodePayload {
        id: special_id.into(),
        node_type: "store".into(),
        name: "URL Chars".into(),
        subtitle: None,
        x: 0.0,
        y: 0.0,
        tier_requirement: None,
        telemetry_badge: None,
        telemetry_status: None,
        metadata: None,
    };
    let json = serde_json::to_string(&node).unwrap();
    let roundtripped: TopologyNodePayload = serde_json::from_str(&json).unwrap();
    assert_eq!(roundtripped.id, special_id);
}

#[test]
fn hundred_kb_node_name_roundtrip() {
    let long_name = "X".repeat(100_000);
    let node = TopologyNodePayload {
        id: "n1".into(),
        node_type: "store".into(),
        name: long_name.clone(),
        subtitle: None,
        x: 0.0,
        y: 0.0,
        tier_requirement: None,
        telemetry_badge: None,
        telemetry_status: None,
        metadata: None,
    };
    let json = serde_json::to_string(&node).unwrap();
    let roundtripped: TopologyNodePayload = serde_json::from_str(&json).unwrap();
    assert_eq!(roundtripped.name.len(), 100_000);
    assert_eq!(roundtripped.name, long_name);
}

#[test]
fn hundred_kb_wire_label_roundtrip() {
    let long_label = "Y".repeat(100_000);
    let wire = TopologyWirePayload {
        id: "w1".into(),
        from_node_id: "a".into(),
        to_node_id: "b".into(),
        direction: "one-way".into(),
        label: Some(long_label.clone()),
        from_port: None,
        to_port: None,
    };
    let json = serde_json::to_string(&wire).unwrap();
    let roundtripped: TopologyWirePayload = serde_json::from_str(&json).unwrap();
    assert_eq!(roundtripped.label.as_deref().unwrap().len(), 100_000);
}

// ── Direction edge cases ───────────────────────────────────────

#[test]
fn empty_direction_preserved() {
    let json = r#"{"id":"w1","from_node_id":"a","to_node_id":"b","direction":""}"#;
    let wire: TopologyWirePayload = serde_json::from_str(json).unwrap();
    assert_eq!(wire.direction, WireDirection::Unknown);
}

#[test]
fn direction_with_unicode() {
    let wire = TopologyWirePayload {
        id: "w1".into(),
        from_node_id: "a".into(),
        to_node_id: "b".into(),
        direction: "↔ bidirectional ←→".into(),
        label: None,
        from_port: None,
        to_port: None,
    };
    let json = serde_json::to_string(&wire).unwrap();
    let roundtripped: TopologyWirePayload = serde_json::from_str(&json).unwrap();
    assert_eq!(roundtripped.direction, WireDirection::Unknown);
}

#[test]
fn direction_preserved_through_db() {
    let conn = fresh_conn();
    let data = TopologyData {
        nodes: vec![TopologyNodePayload {
            id: "n1".into(),
            node_type: "store".into(),
            name: "Dir Test".into(),
            subtitle: None,
            x: 0.0,
            y: 0.0,
            tier_requirement: None,
            telemetry_badge: None,
            telemetry_status: None,
            metadata: None,
        }],
        wires: vec![TopologyWirePayload {
            id: "w1".into(),
            from_node_id: "n1".into(),
            to_node_id: "n2".into(),
            direction: "two-way".into(),
            label: None,
            from_port: None,
            to_port: None,
        }],
    };
    let json = serde_json::to_string(&data).unwrap();
    oz_core::Settings::set(&conn, TOPOLOGY_SETTING_KEY, &json).unwrap();
    let loaded_raw = oz_core::Settings::get(&conn, TOPOLOGY_SETTING_KEY)
        .unwrap()
        .unwrap();
    let loaded: TopologyData = serde_json::from_str(&loaded_raw).unwrap();
    assert_eq!(loaded.wires[0].direction, "two-way");
}

// ── Metadata extreme values ────────────────────────────────────

#[test]
fn deeply_nested_metadata_roundtrip() {
    let mut nested = serde_json::json!("deep");
    for _ in 0..64 {
        nested = serde_json::json!({"level": nested});
    }
    let node = TopologyNodePayload {
        id: "deep-meta".into(),
        node_type: "store".into(),
        name: "Deep".into(),
        subtitle: None,
        x: 0.0,
        y: 0.0,
        tier_requirement: None,
        telemetry_badge: None,
        telemetry_status: None,
        metadata: Some(nested),
    };
    let json = serde_json::to_string(&node).unwrap();
    let roundtripped: TopologyNodePayload = serde_json::from_str(&json).unwrap();
    let meta = roundtripped.metadata.unwrap();
    // Navigate 64 levels deep.
    let mut current = &meta;
    for _ in 0..64 {
        current = &current["level"];
    }
    assert_eq!(current.as_str(), Some("deep"));
}

#[test]
fn metadata_with_large_array() {
    let large_array: Vec<i64> = (0..10_000).collect();
    let node = TopologyNodePayload {
        id: "array-meta".into(),
        node_type: "store".into(),
        name: "Large Array".into(),
        subtitle: None,
        x: 0.0,
        y: 0.0,
        tier_requirement: None,
        telemetry_badge: None,
        telemetry_status: None,
        metadata: Some(serde_json::json!({"values": large_array})),
    };
    let json = serde_json::to_string(&node).unwrap();
    let roundtripped: TopologyNodePayload = serde_json::from_str(&json).unwrap();
    let meta = roundtripped.metadata.unwrap();
    assert_eq!(meta["values"].as_array().unwrap().len(), 10_000);
    assert_eq!(meta["values"][9999], 9999);
}

#[test]
fn metadata_with_hundred_kb_string() {
    let big_string = "Z".repeat(100_000);
    let node = TopologyNodePayload {
        id: "big-str-meta".into(),
        node_type: "store".into(),
        name: "Big String".into(),
        subtitle: None,
        x: 0.0,
        y: 0.0,
        tier_requirement: None,
        telemetry_badge: None,
        telemetry_status: None,
        metadata: Some(serde_json::json!({"big_field": big_string})),
    };
    let json = serde_json::to_string(&node).unwrap();
    let roundtripped: TopologyNodePayload = serde_json::from_str(&json).unwrap();
    let meta = roundtripped.metadata.unwrap();
    assert_eq!(meta["big_field"].as_str().unwrap().len(), 100_000);
}

// ── Ordering stability through DB ──────────────────────────────

#[test]
fn wire_order_preserved_through_db() {
    let conn = fresh_conn();
    let wires: Vec<TopologyWirePayload> = (0..100)
        .map(|i| TopologyWirePayload {
            id: format!("ordered-wire-{i:03}"),
            from_node_id: "a".into(),
            to_node_id: "b".into(),
            direction: "one-way".into(),
            label: Some(format!("label-{i}")),
            from_port: None,
            to_port: None,
        })
        .collect();
    let data = TopologyData {
        nodes: vec![],
        wires,
    };
    let json = serde_json::to_string(&data).unwrap();
    oz_core::Settings::set(&conn, TOPOLOGY_SETTING_KEY, &json).unwrap();
    let loaded_raw = oz_core::Settings::get(&conn, TOPOLOGY_SETTING_KEY)
        .unwrap()
        .unwrap();
    let loaded: TopologyData = serde_json::from_str(&loaded_raw).unwrap();
    for i in 0..100 {
        assert_eq!(
            loaded.wires[i].id,
            format!("ordered-wire-{i:03}"),
            "wire order broken at index {i}"
        );
        assert_eq!(
            loaded.wires[i].label.as_deref(),
            Some(format!("label-{i}").as_str()),
        );
    }
}

#[test]
fn node_order_preserved_through_db() {
    let conn = fresh_conn();
    let nodes: Vec<TopologyNodePayload> = (0..100)
        .map(|i| TopologyNodePayload {
            id: format!("ordered-node-{i:03}"),
            node_type: "store".into(),
            name: format!("Node {i}"),
            subtitle: None,
            x: i as f64,
            y: 0.0,
            tier_requirement: None,
            telemetry_badge: None,
            telemetry_status: None,
            metadata: None,
        })
        .collect();
    let data = TopologyData {
        nodes,
        wires: vec![],
    };
    let json = serde_json::to_string(&data).unwrap();
    oz_core::Settings::set(&conn, TOPOLOGY_SETTING_KEY, &json).unwrap();
    let loaded_raw = oz_core::Settings::get(&conn, TOPOLOGY_SETTING_KEY)
        .unwrap()
        .unwrap();
    let loaded: TopologyData = serde_json::from_str(&loaded_raw).unwrap();
    for i in 0..100 {
        assert_eq!(
            loaded.nodes[i].id,
            format!("ordered-node-{i:03}"),
            "node order broken at index {i}"
        );
        assert_eq!(loaded.nodes[i].name, format!("Node {i}"),);
    }
}

// ── Concurrent modification simulation ─────────────────────────

#[test]
fn sequential_save_a_then_b_then_verify_b() {
    let conn = fresh_conn();
    // First, save A.
    let data_a = TopologyData {
        nodes: vec![TopologyNodePayload {
            id: "a".into(),
            node_type: "store".into(),
            name: "Data A".into(),
            subtitle: None,
            x: 0.0,
            y: 0.0,
            tier_requirement: None,
            telemetry_badge: None,
            telemetry_status: None,
            metadata: None,
        }],
        wires: vec![],
    };
    oz_core::Settings::set(
        &conn,
        TOPOLOGY_SETTING_KEY,
        &serde_json::to_string(&data_a).unwrap(),
    )
    .unwrap();

    // Then, save B.
    let data_b = TopologyData {
        nodes: vec![TopologyNodePayload {
            id: "b".into(),
            node_type: "workspace".into(),
            name: "Data B".into(),
            subtitle: None,
            x: 100.0,
            y: 100.0,
            tier_requirement: None,
            telemetry_badge: None,
            telemetry_status: None,
            metadata: None,
        }],
        wires: vec![],
    };
    oz_core::Settings::set(
        &conn,
        TOPOLOGY_SETTING_KEY,
        &serde_json::to_string(&data_b).unwrap(),
    )
    .unwrap();

    // Verify B is loaded.
    let loaded_raw = oz_core::Settings::get(&conn, TOPOLOGY_SETTING_KEY)
        .unwrap()
        .unwrap();
    let loaded: TopologyData = serde_json::from_str(&loaded_raw).unwrap();
    assert_eq!(loaded.nodes.len(), 1);
    assert_eq!(loaded.nodes[0].id, "b");
    assert_eq!(loaded.nodes[0].name, "Data B");
}

#[test]
fn hundred_save_cycles_data_integrity() {
    let conn = fresh_conn();
    for i in 0..100 {
        let data = TopologyData {
            nodes: vec![TopologyNodePayload {
                id: format!("cycle-{i}"),
                node_type: "store".into(),
                name: format!("Cycle {i} with some data"),
                subtitle: if i % 2 == 0 {
                    Some(format!("even-{i}"))
                } else {
                    None
                },
                x: i as f64,
                y: (i * 2) as f64,
                tier_requirement: if i % 3 == 0 {
                    Some("premium".into())
                } else {
                    None
                },
                telemetry_badge: if i % 5 == 0 {
                    Some("Online".into())
                } else {
                    None
                },
                telemetry_status: if i % 7 == 0 {
                    Some("online".into())
                } else {
                    None
                },
                metadata: None,
            }],
            wires: vec![],
        };
        oz_core::Settings::set(
            &conn,
            TOPOLOGY_SETTING_KEY,
            &serde_json::to_string(&data).unwrap(),
        )
        .unwrap();
    }
    // Verify last cycle.
    let loaded_raw = oz_core::Settings::get(&conn, TOPOLOGY_SETTING_KEY)
        .unwrap()
        .unwrap();
    let loaded: TopologyData = serde_json::from_str(&loaded_raw).unwrap();
    assert_eq!(loaded.nodes.len(), 1);
    assert_eq!(loaded.nodes[0].id, "cycle-99");
    assert_eq!(loaded.nodes[0].name, "Cycle 99 with some data");
    assert_eq!(loaded.nodes[0].x, 99.0);
    assert_eq!(loaded.nodes[0].y, 198.0);
    assert!(loaded.nodes[0].subtitle.is_none()); // 99 is odd
    assert_eq!(loaded.nodes[0].tier_requirement.as_deref(), Some("premium")); // 99 % 3 == 0
}

// ── Settings raw-value inspection ──────────────────────────────

#[test]
fn raw_stored_json_is_valid_topology() {
    let conn = fresh_conn();
    let data = TopologyData {
        nodes: vec![TopologyNodePayload {
            id: "raw-test".into(),
            node_type: "hardware".into(),
            name: "Raw Check".into(),
            subtitle: Some("verify".into()),
            x: 10.0,
            y: 20.0,
            tier_requirement: Some("standard".into()),
            telemetry_badge: Some("Online".into()),
            telemetry_status: Some("online".into()),
            metadata: Some(serde_json::json!({"checked": true})),
        }],
        wires: vec![TopologyWirePayload {
            id: "raw-wire".into(),
            from_node_id: "raw-test".into(),
            to_node_id: "other".into(),
            direction: "two-way".into(),
            label: Some("raw-label".into()),
            from_port: Some("out".into()),
            to_port: Some("in".into()),
        }],
    };
    oz_core::Settings::set(
        &conn,
        TOPOLOGY_SETTING_KEY,
        &serde_json::to_string(&data).unwrap(),
    )
    .unwrap();
    let raw = oz_core::Settings::get(&conn, TOPOLOGY_SETTING_KEY)
        .unwrap()
        .unwrap();
    // Raw JSON must parse as TopologyData.
    let reparsed: TopologyData = serde_json::from_str(&raw).unwrap();
    assert_eq!(reparsed.nodes.len(), 1);
    assert_eq!(reparsed.wires.len(), 1);
    // JSON must contain expected field markers.
    assert!(raw.contains(r#""type":"hardware""#));
    assert!(raw.contains(r#""direction":"two-way""#));
    assert!(raw.contains(r#""metadata""#));
}

// ── Empty / missing / null direction edge cases ────────────────

#[test]
fn direction_null_defaults_to_one_way() {
    let json = r#"{"id":"w1","from_node_id":"a","to_node_id":"b","direction":null}"#;
    let wire: TopologyWirePayload = serde_json::from_str(json).unwrap();
    assert_eq!(wire.direction, "one-way");
}

#[test]
fn direction_missing_defaults_to_one_way() {
    let json = r#"{"id":"w1","from_node_id":"a","to_node_id":"b"}"#;
    let wire: TopologyWirePayload = serde_json::from_str(json).unwrap();
    assert_eq!(wire.direction, "one-way");
}

// ── Schema evolution / backward compatibility ──────────────────

#[test]
fn load_older_format_without_optional_fields() {
    // Simulate data from an older app version that had no
    // subtitle, tier_requirement, telemetry_*, or metadata fields.
    let old_json = r#"{"id":"old","type":"store","name":"Legacy","x":1,"y":2}"#;
    let node: TopologyNodePayload = serde_json::from_str(old_json).unwrap();
    assert_eq!(node.id, "old");
    assert_eq!(node.node_type, "store");
    assert_eq!(node.name, "Legacy");
    assert_eq!(node.x, 1.0);
    assert_eq!(node.y, 2.0);
    assert!(node.subtitle.is_none());
    assert!(node.tier_requirement.is_none());
    assert!(node.telemetry_badge.is_none());
    assert!(node.telemetry_status.is_none());
    assert!(node.metadata.is_none());
}

#[test]
fn load_older_wire_without_direction_label_ports() {
    let old_json = r#"{"id":"w-old","from_node_id":"a","to_node_id":"b"}"#;
    let wire: TopologyWirePayload = serde_json::from_str(old_json).unwrap();
    assert_eq!(wire.id, "w-old");
    assert_eq!(wire.from_node_id, "a");
    assert_eq!(wire.to_node_id, "b");
    assert_eq!(wire.direction, "one-way");
    assert!(wire.label.is_none());
    assert!(wire.from_port.is_none());
    assert!(wire.to_port.is_none());
}

#[test]
fn both_type_and_node_type_in_json_type_wins() {
    // If someone sends both `type` and `node_type`, the rename
    // attribute means `type` deserialises into `node_type`.
    let json =
        r#"{"id":"n1","type":"store","node_type":"workspace","name":"Conflict","x":0,"y":0}"#;
    let node: TopologyNodePayload = serde_json::from_str(json).unwrap();
    // `type` wins because #[serde(rename = "type")] maps the JSON
    // `type` key onto the Rust `node_type` field.
    assert_eq!(node.node_type, "store");
}

#[test]
fn topology_data_with_extra_top_level_keys_backward_compat() {
    // New front-end might send extra keys; old back-end should
    // ignore them.
    let json =
        r#"{"nodes":[],"wires":[],"version":2,"migrated_from":"v1","ui_state":{"zoom":1.5}}"#;
    let data: TopologyData = serde_json::from_str(json).unwrap();
    assert!(data.nodes.is_empty());
    assert!(data.wires.is_empty());
}

#[test]
fn node_with_coordinates_as_integers() {
    // JSON allows `{"x": 10, "y": 20}` — serde coerces integer to f64.
    let json = r#"{"id":"n1","type":"store","name":"Int Coords","x":10,"y":20}"#;
    let node: TopologyNodePayload = serde_json::from_str(json).unwrap();
    assert!((node.x - 10.0).abs() < f64::EPSILON);
    assert!((node.y - 20.0).abs() < f64::EPSILON);
}

#[test]
fn roundtrip_preserves_exact_field_values() {
    let original = TopologyNodePayload {
        id: "exact-match".into(),
        node_type: "hardware".into(),
        name: "Exact Match Printer #2".into(),
        subtitle: Some("Kitchen Back".into()),
        x: 312.75,
        y: -88.25,
        tier_requirement: Some("enterprise".into()),
        telemetry_badge: Some("Online".into()),
        telemetry_status: Some("online".into()),
        metadata: Some(serde_json::json!({"firmware": "v2.1.0", "ports": 2})),
    };
    let json = serde_json::to_string(&original).unwrap();
    let roundtripped: TopologyNodePayload = serde_json::from_str(&json).unwrap();
    assert_eq!(roundtripped.id, original.id);
    assert_eq!(roundtripped.node_type, original.node_type);
    assert_eq!(roundtripped.name, original.name);
    assert_eq!(roundtripped.subtitle, original.subtitle);
    assert!((roundtripped.x - original.x).abs() < f64::EPSILON);
    assert!((roundtripped.y - original.y).abs() < f64::EPSILON);
    assert_eq!(roundtripped.tier_requirement, original.tier_requirement);
    assert_eq!(roundtripped.telemetry_badge, original.telemetry_badge);
    assert_eq!(roundtripped.telemetry_status, original.telemetry_status);
    assert_eq!(roundtripped.metadata, original.metadata);
}

// ── Thread safety ───────────────────────────────────────────────

#[test]
fn concurrent_saves_to_same_db() {
    let dir = tempdir().unwrap();
    let db_path = dir.path().join("concurrent.db");

    // Run migrations once on a throwaway connection.
    {
        let mut setup = Connection::open(&db_path).unwrap();
        migrations::run(&mut setup).unwrap();
    }

    let path_str = db_path.to_string_lossy().to_string();
    let threads: Vec<_> = (0..10)
        .map(|i| {
            let p = path_str.clone();
            std::thread::spawn(move || {
                let conn = Connection::open(&p).unwrap();
                let payload = TopologyNodePayload {
                    id: format!("thread-{i}"),
                    node_type: "store".into(),
                    name: format!("Thread {i}"),
                    subtitle: None,
                    x: i as f64,
                    y: 0.0,
                    tier_requirement: None,
                    telemetry_badge: None,
                    telemetry_status: None,
                    metadata: None,
                };
                let data = TopologyData {
                    nodes: vec![payload],
                    wires: vec![],
                };
                oz_core::Settings::set(
                    &conn,
                    TOPOLOGY_SETTING_KEY,
                    &serde_json::to_string(&data).unwrap(),
                )
                .unwrap();
            })
        })
        .collect();

    for t in threads {
        t.join().expect("thread panicked");
    }

    // At least one thread's data should be visible (last writer
    // wins — SQLite serialises writes via its internal mutex).
    let final_conn = Connection::open(&db_path).unwrap();
    let raw = oz_core::Settings::get(&final_conn, TOPOLOGY_SETTING_KEY)
        .unwrap()
        .unwrap();
    let loaded: TopologyData = serde_json::from_str(&raw).unwrap();
    assert_eq!(loaded.nodes.len(), 1);
    // The winner is one of the threads (non-deterministic).
    assert!(loaded.nodes[0].id.starts_with("thread-"));
}

#[test]
fn concurrent_readers_dont_block_each_other() {
    let dir = tempdir().unwrap();
    let db_path = dir.path().join("readers.db");

    {
        let mut setup = Connection::open(&db_path).unwrap();
        migrations::run(&mut setup).unwrap();
        let data = TopologyData {
            nodes: vec![TopologyNodePayload {
                id: "shared".into(),
                node_type: "store".into(),
                name: "Shared".into(),
                subtitle: None,
                x: 0.0,
                y: 0.0,
                tier_requirement: None,
                telemetry_badge: None,
                telemetry_status: None,
                metadata: None,
            }],
            wires: vec![],
        };
        oz_core::Settings::set(
            &setup,
            TOPOLOGY_SETTING_KEY,
            &serde_json::to_string(&data).unwrap(),
        )
        .unwrap();
    }

    let path_str = db_path.to_string_lossy().to_string();
    let handles: Vec<_> = (0..10)
        .map(|_| {
            let p = path_str.clone();
            std::thread::spawn(move || {
                let conn = Connection::open(&p).unwrap();
                let raw = oz_core::Settings::get(&conn, TOPOLOGY_SETTING_KEY)
                    .unwrap()
                    .unwrap();
                let loaded: TopologyData = serde_json::from_str(&raw).unwrap();
                assert_eq!(loaded.nodes.len(), 1);
                assert_eq!(loaded.nodes[0].id, "shared");
            })
        })
        .collect();

    for h in handles {
        h.join().expect("reader thread panicked");
    }
}

#[test]
fn concurrent_read_write_cycle_stress() {
    let dir = tempdir().unwrap();
    let db_path = dir.path().join("rw_stress.db");

    {
        let mut setup = Connection::open(&db_path).unwrap();
        migrations::run(&mut setup).unwrap();
    }

    let path_str = db_path.to_string_lossy().to_string();
    let writer_handle = {
        let p = path_str.clone();
        std::thread::spawn(move || {
            for i in 0..25 {
                let conn = Connection::open(&p).unwrap();
                let data = TopologyData {
                    nodes: vec![TopologyNodePayload {
                        id: format!("write-{i}"),
                        node_type: "store".into(),
                        name: format!("Write {i}"),
                        subtitle: None,
                        x: i as f64,
                        y: 0.0,
                        tier_requirement: None,
                        telemetry_badge: None,
                        telemetry_status: None,
                        metadata: None,
                    }],
                    wires: vec![],
                };
                oz_core::Settings::set(
                    &conn,
                    TOPOLOGY_SETTING_KEY,
                    &serde_json::to_string(&data).unwrap(),
                )
                .unwrap();
            }
        })
    };

    let reader_handle = {
        let p = path_str.clone();
        std::thread::spawn(move || {
            for _ in 0..25 {
                let conn = Connection::open(&p).unwrap();
                if let Ok(Some(raw)) = oz_core::Settings::get(&conn, TOPOLOGY_SETTING_KEY)
                    && let Ok(loaded) = serde_json::from_str::<TopologyData>(&raw)
                    && !loaded.nodes.is_empty()
                {
                    assert!(loaded.nodes[0].id.starts_with("write-"));
                }
            }
        })
    };

    writer_handle.join().expect("writer panicked");
    reader_handle.join().expect("reader panicked");
}

#[test]
fn concurrent_saves_different_keys_dont_interfere() {
    let dir = tempdir().unwrap();
    let db_path = dir.path().join("multi_key.db");

    {
        let mut setup = Connection::open(&db_path).unwrap();
        migrations::run(&mut setup).unwrap();
    }

    let path_str = db_path.to_string_lossy().to_string();
    let threads: Vec<_> = (0..5)
        .map(|i| {
            let p = path_str.clone();
            std::thread::spawn(move || {
                let conn = Connection::open(&p).unwrap();
                let key = format!("oz-pos/topo-race-{i}");
                let data = TopologyData {
                    nodes: vec![TopologyNodePayload {
                        id: format!("race-{i}"),
                        node_type: "store".into(),
                        name: format!("Race {i}"),
                        subtitle: None,
                        x: i as f64,
                        y: 0.0,
                        tier_requirement: None,
                        telemetry_badge: None,
                        telemetry_status: None,
                        metadata: None,
                    }],
                    wires: vec![],
                };
                oz_core::Settings::set(&conn, &key, &serde_json::to_string(&data).unwrap())
                    .unwrap();

                // Verify our own write is readable.
                let raw = oz_core::Settings::get(&conn, &key).unwrap().unwrap();
                let loaded: TopologyData = serde_json::from_str(&raw).unwrap();
                assert_eq!(loaded.nodes[0].id, format!("race-{i}"));
            })
        })
        .collect();

    for t in threads {
        t.join().expect("thread panicked");
    }
}

// ── Roundtrip stability ─────────────────────────────────────────

#[test]
fn five_hundred_serial_roundtrips() {
    let node = TopologyNodePayload {
        id: "stable".into(),
        node_type: "store".into(),
        name: "Stability Test".into(),
        subtitle: Some("Round".into()),
        x: 42.5,
        y: -13.25,
        tier_requirement: Some("premium".into()),
        telemetry_badge: Some("Online".into()),
        telemetry_status: Some("online".into()),
        metadata: Some(serde_json::json!({"count": 0})),
    };
    let mut current = serde_json::to_string(&node).unwrap();
    for cycle in 0..500 {
        let roundtripped: TopologyNodePayload = serde_json::from_str(&current).unwrap();
        // Mutate metadata count to detect stale data.
        let mut meta = roundtripped.metadata.unwrap();
        meta["count"] = serde_json::json!(cycle + 1);
        let updated = TopologyNodePayload {
            metadata: Some(meta),
            ..roundtripped
        };
        current = serde_json::to_string(&updated).unwrap();
    }
    // After 500 cycles, verify all fields intact.
    let final_node: TopologyNodePayload = serde_json::from_str(&current).unwrap();
    assert_eq!(final_node.id, "stable");
    assert_eq!(final_node.name, "Stability Test");
    assert_eq!(final_node.subtitle.as_deref(), Some("Round"));
    assert!((final_node.x - 42.5).abs() < f64::EPSILON);
    assert!((final_node.y - (-13.25)).abs() < f64::EPSILON);
    assert_eq!(final_node.metadata.unwrap()["count"], 500);
}

#[test]
fn five_hundred_db_save_load_cycles() {
    let conn = fresh_conn();
    for i in 0..500 {
        let data = TopologyData {
            nodes: vec![TopologyNodePayload {
                id: "cycle".into(),
                node_type: "store".into(),
                name: format!("Cycle {i}"),
                subtitle: None,
                x: i as f64,
                y: (i * 2) as f64,
                tier_requirement: None,
                telemetry_badge: None,
                telemetry_status: None,
                metadata: None,
            }],
            wires: vec![],
        };
        oz_core::Settings::set(
            &conn,
            TOPOLOGY_SETTING_KEY,
            &serde_json::to_string(&data).unwrap(),
        )
        .unwrap();

        if i % 50 == 0 {
            // Verify intermediate state.
            let raw = oz_core::Settings::get(&conn, TOPOLOGY_SETTING_KEY)
                .unwrap()
                .unwrap();
            let loaded: TopologyData = serde_json::from_str(&raw).unwrap();
            assert_eq!(loaded.nodes.len(), 1);
            assert_eq!(loaded.nodes[0].name, format!("Cycle {i}"));
        }
    }

    // Final verification.
    let raw = oz_core::Settings::get(&conn, TOPOLOGY_SETTING_KEY)
        .unwrap()
        .unwrap();
    let loaded: TopologyData = serde_json::from_str(&raw).unwrap();
    assert_eq!(loaded.nodes[0].name, "Cycle 499");
    assert_eq!(loaded.nodes[0].x, 499.0);
    assert_eq!(loaded.nodes[0].y, 998.0);
}

#[test]
fn big_small_oscillation_db() {
    let conn = fresh_conn();
    for cycle in 0..50 {
        // Big save (50 nodes).
        let big = TopologyData {
            nodes: (0..50)
                .map(|i| TopologyNodePayload {
                    id: format!("big-{cycle}-{i}"),
                    node_type: "store".into(),
                    name: format!("Big {cycle}.{i}"),
                    subtitle: None,
                    x: i as f64,
                    y: cycle as f64,
                    tier_requirement: None,
                    telemetry_badge: None,
                    telemetry_status: None,
                    metadata: None,
                })
                .collect(),
            wires: vec![],
        };
        oz_core::Settings::set(
            &conn,
            TOPOLOGY_SETTING_KEY,
            &serde_json::to_string(&big).unwrap(),
        )
        .unwrap();

        // Small save (1 node).
        let small = TopologyData {
            nodes: vec![TopologyNodePayload {
                id: format!("small-{cycle}"),
                node_type: "workspace".into(),
                name: format!("Small {cycle}"),
                subtitle: None,
                x: 0.0,
                y: 0.0,
                tier_requirement: None,
                telemetry_badge: None,
                telemetry_status: None,
                metadata: None,
            }],
            wires: vec![],
        };
        oz_core::Settings::set(
            &conn,
            TOPOLOGY_SETTING_KEY,
            &serde_json::to_string(&small).unwrap(),
        )
        .unwrap();
    }

    let raw = oz_core::Settings::get(&conn, TOPOLOGY_SETTING_KEY)
        .unwrap()
        .unwrap();
    let loaded: TopologyData = serde_json::from_str(&raw).unwrap();
    // Last write was "small-49".
    assert_eq!(loaded.nodes.len(), 1);
    assert_eq!(loaded.nodes[0].id, "small-49");
    assert_eq!(loaded.nodes[0].node_type, "workspace");
}

// ── Data integrity validation ───────────────────────────────────

#[test]
fn all_metadata_value_types_roundtrip() {
    let node = TopologyNodePayload {
        id: "all-types".into(),
        node_type: "store".into(),
        name: "All Meta Types".into(),
        subtitle: None,
        x: 0.0,
        y: 0.0,
        tier_requirement: None,
        telemetry_badge: None,
        telemetry_status: None,
        metadata: {
            let mut m = serde_json::json!({
                "null_val": null,
                "bool_val": true,
                "int_val": 42,
                "float_val": std::f64::consts::PI,
                "string_val": "hello",
                "array_val": [1, "two", false, null],
                "object_val": {"nested": {"a": 1, "b": [2, 3]}},
                "empty_array": [],
                "empty_object": {},
                "negative": -273,
            });
            m["large"] = serde_json::json!(9_007_199_254_740_991i64);
            Some(m)
        },
    };
    let json = serde_json::to_string(&node).unwrap();
    let roundtripped: TopologyNodePayload = serde_json::from_str(&json).unwrap();
    let meta = roundtripped.metadata.unwrap();
    assert!(meta["null_val"].is_null());
    assert_eq!(meta["bool_val"].as_bool(), Some(true));
    assert_eq!(meta["int_val"].as_i64(), Some(42));
    assert!((meta["float_val"].as_f64().unwrap() - std::f64::consts::PI).abs() < 1e-10);
    assert_eq!(meta["string_val"].as_str(), Some("hello"));
    assert_eq!(meta["array_val"].as_array().unwrap().len(), 4);
    assert_eq!(meta["array_val"][0].as_i64(), Some(1));
    assert_eq!(meta["array_val"][1].as_str(), Some("two"));
    assert_eq!(meta["object_val"]["nested"]["a"].as_i64(), Some(1));
    assert!(meta["empty_array"].as_array().unwrap().is_empty());
    assert!(meta["empty_object"].as_object().unwrap().is_empty());
    assert_eq!(meta["negative"].as_i64(), Some(-273));
    assert_eq!(meta["large"].as_i64(), Some(9_007_199_254_740_991));
}

#[test]
fn all_wire_fields_exact_roundtrip() {
    let original = TopologyWirePayload {
        id: "exact-wire".into(),
        from_node_id: "node-a".into(),
        to_node_id: "node-b".into(),
        direction: "two-way".into(),
        label: Some("Exact Label".into()),
        from_port: Some("primary-out".into()),
        to_port: Some("secondary-in".into()),
    };
    let json = serde_json::to_string(&original).unwrap();
    let roundtripped: TopologyWirePayload = serde_json::from_str(&json).unwrap();
    assert_eq!(roundtripped.id, original.id);
    assert_eq!(roundtripped.from_node_id, original.from_node_id);
    assert_eq!(roundtripped.to_node_id, original.to_node_id);
    assert_eq!(roundtripped.direction, original.direction);
    assert_eq!(roundtripped.label, original.label);
    assert_eq!(roundtripped.from_port, original.from_port);
    assert_eq!(roundtripped.to_port, original.to_port);
}

#[test]
fn entire_topology_data_struct_equality_through_db() {
    let conn = fresh_conn();
    let original = TopologyData {
        nodes: vec![
            TopologyNodePayload {
                id: "eq-1".into(),
                node_type: "store".into(),
                name: "Equality Store".into(),
                subtitle: Some("Check".into()),
                x: 10.0,
                y: 20.0,
                tier_requirement: Some("standard".into()),
                telemetry_badge: Some("Online".into()),
                telemetry_status: Some("online".into()),
                metadata: Some(serde_json::json!({"verified": true})),
            },
            TopologyNodePayload {
                id: "eq-2".into(),
                node_type: "workspace".into(),
                name: "Equality WS".into(),
                subtitle: None,
                x: 200.0,
                y: 100.0,
                tier_requirement: None,
                telemetry_badge: None,
                telemetry_status: None,
                metadata: None,
            },
        ],
        wires: vec![TopologyWirePayload {
            id: "eq-w".into(),
            from_node_id: "eq-1".into(),
            to_node_id: "eq-2".into(),
            direction: "two-way".into(),
            label: Some("sync".into()),
            from_port: Some("a".into()),
            to_port: Some("b".into()),
        }],
    };

    oz_core::Settings::set(
        &conn,
        TOPOLOGY_SETTING_KEY,
        &serde_json::to_string(&original).unwrap(),
    )
    .unwrap();
    let raw = oz_core::Settings::get(&conn, TOPOLOGY_SETTING_KEY)
        .unwrap()
        .unwrap();
    let loaded: TopologyData = serde_json::from_str(&raw).unwrap();

    // Structural equality via debug format (avoids requiring PartialEq).
    assert_eq!(loaded.nodes.len(), original.nodes.len());
    assert_eq!(loaded.wires.len(), original.wires.len());

    // Deep field comparison.
    for (i, (l, r)) in loaded.nodes.iter().zip(original.nodes.iter()).enumerate() {
        assert_eq!(l.id, r.id, "node[{i}].id mismatch");
        assert_eq!(l.node_type, r.node_type, "node[{i}].node_type mismatch");
        assert_eq!(l.name, r.name, "node[{i}].name mismatch");
        assert_eq!(l.subtitle, r.subtitle, "node[{i}].subtitle mismatch");
        assert!((l.x - r.x).abs() < f64::EPSILON, "node[{i}].x mismatch");
        assert!((l.y - r.y).abs() < f64::EPSILON, "node[{i}].y mismatch");
        assert_eq!(
            l.tier_requirement, r.tier_requirement,
            "node[{i}].tier_requirement mismatch"
        );
        assert_eq!(
            l.telemetry_badge, r.telemetry_badge,
            "node[{i}].telemetry_badge mismatch"
        );
        assert_eq!(
            l.telemetry_status, r.telemetry_status,
            "node[{i}].telemetry_status mismatch"
        );
        assert_eq!(l.metadata, r.metadata, "node[{i}].metadata mismatch");
    }

    for (i, (l, r)) in loaded.wires.iter().zip(original.wires.iter()).enumerate() {
        assert_eq!(l.id, r.id, "wire[{i}].id mismatch");
        assert_eq!(
            l.from_node_id, r.from_node_id,
            "wire[{i}].from_node_id mismatch"
        );
        assert_eq!(l.to_node_id, r.to_node_id, "wire[{i}].to_node_id mismatch");
        assert_eq!(l.direction, r.direction, "wire[{i}].direction mismatch");
        assert_eq!(l.label, r.label, "wire[{i}].label mismatch");
        assert_eq!(l.from_port, r.from_port, "wire[{i}].from_port mismatch");
        assert_eq!(l.to_port, r.to_port, "wire[{i}].to_port mismatch");
    }
}

// ── Corrupt / malformed data resilience ─────────────────────────

#[test]
fn empty_settings_value_fails_to_deserialise() {
    let conn = fresh_conn();
    oz_core::Settings::set(&conn, TOPOLOGY_SETTING_KEY, "").unwrap();
    let raw = oz_core::Settings::get(&conn, TOPOLOGY_SETTING_KEY)
        .unwrap()
        .unwrap();
    let result: Result<TopologyData, _> = serde_json::from_str(&raw);
    assert!(
        result.is_err(),
        "empty string should not be valid topology JSON"
    );
}

#[test]
fn whitespace_only_settings_value_fails() {
    let conn = fresh_conn();
    oz_core::Settings::set(&conn, TOPOLOGY_SETTING_KEY, "   ").unwrap();
    let raw = oz_core::Settings::get(&conn, TOPOLOGY_SETTING_KEY)
        .unwrap()
        .unwrap();
    let result: Result<TopologyData, _> = serde_json::from_str(&raw);
    assert!(
        result.is_err(),
        "whitespace should not be valid topology JSON"
    );
}

#[test]
fn json_with_duplicate_keys_rejected() {
    // serde_json rejects duplicate keys by default (the behaviour
    // can be toggled via serde_json::DeserializerBuilder).
    let json = r#"{"id":"n1","type":"store","name":"Dup",
            "name":"Overwritten","x":0,"y":0}"#;
    let result: Result<TopologyNodePayload, _> = serde_json::from_str(json);
    assert!(result.is_err(), "duplicate JSON keys must be rejected");
}

#[test]
fn json_trailing_comma_fails() {
    let json = r#"{"id":"n1","type":"store","name":"Comma","x":0,"y":0,}"#;
    let result: Result<TopologyNodePayload, _> = serde_json::from_str(json);
    assert!(result.is_err(), "trailing comma should be rejected");
}

#[test]
fn metadata_with_non_object_json_succeeds() {
    // metadata is Option<serde_json::Value> — any valid JSON is accepted.
    let node = TopologyNodePayload {
        id: "meta-any".into(),
        node_type: "store".into(),
        name: "Any Meta".into(),
        subtitle: None,
        x: 0.0,
        y: 0.0,
        tier_requirement: None,
        telemetry_badge: None,
        telemetry_status: None,
        metadata: Some(serde_json::json!(42)),
    };
    let json = serde_json::to_string(&node).unwrap();
    let roundtripped: TopologyNodePayload = serde_json::from_str(&json).unwrap();
    assert_eq!(roundtripped.metadata.unwrap().as_i64(), Some(42));
}

// ── UTF-8 / encoding boundaries ────────────────────────────────

#[test]
fn four_byte_utf8_in_node_name() {
    let name = "𝄞 Music Note 🎵 Flute 𐍈 Gothic";
    let node = TopologyNodePayload {
        id: "utf8-4byte".into(),
        node_type: "store".into(),
        name: name.into(),
        subtitle: Some("🎉🇺🇳🎂".into()),
        x: 0.0,
        y: 0.0,
        tier_requirement: None,
        telemetry_badge: None,
        telemetry_status: None,
        metadata: Some(serde_json::json!({"emoji": "✅🔥💯"})),
    };
    let json = serde_json::to_string(&node).unwrap();
    let roundtripped: TopologyNodePayload = serde_json::from_str(&json).unwrap();
    assert_eq!(roundtripped.name, name);
    assert_eq!(roundtripped.subtitle.as_deref(), Some("🎉🇺🇳🎂"));
    assert_eq!(
        roundtripped.metadata.unwrap()["emoji"].as_str(),
        Some("✅🔥💯")
    );
}

#[test]
fn node_name_with_grapheme_clusters() {
    // é (composed) vs é (pre-composed) — must preserve exact bytes.
    let composed = "caf\u{00E9}".to_string(); // é as single codepoint
    let decomposed = "cafe\u{0301}".to_string(); // e + combining accent
    let node = TopologyNodePayload {
        id: "grapheme".into(),
        node_type: "store".into(),
        name: composed.clone(),
        subtitle: Some(decomposed.clone()),
        x: 0.0,
        y: 0.0,
        tier_requirement: None,
        telemetry_badge: None,
        telemetry_status: None,
        metadata: None,
    };
    let json = serde_json::to_string(&node).unwrap();
    let roundtripped: TopologyNodePayload = serde_json::from_str(&json).unwrap();
    // Both forms must be preserved byte-exact.
    assert_eq!(roundtripped.name, composed);
    assert_eq!(roundtripped.name.len(), 5); // c(1) + a(1) + f(1) + é(2) = 5
    assert_eq!(roundtripped.subtitle.as_deref(), Some(decomposed.as_str()));
    // decomposed "cafe\u{0301}" = 5 + 1 combining accent = 6
    assert_eq!(roundtripped.subtitle.unwrap().len(), 6);
}

#[test]
fn wire_label_with_astral_plane_chars() {
    let label = "🔗 𝄞🎵✨ 𝓦𝓲𝓻𝓮 🧵".to_string();
    let wire = TopologyWirePayload {
        id: "astral-wire".into(),
        from_node_id: "a".into(),
        to_node_id: "b".into(),
        direction: "one-way".into(),
        label: Some(label.clone()),
        from_port: Some("🔌".into()),
        to_port: Some("🔋".into()),
    };
    let json = serde_json::to_string(&wire).unwrap();
    let roundtripped: TopologyWirePayload = serde_json::from_str(&json).unwrap();
    assert_eq!(roundtripped.label.as_deref(), Some(label.as_str()));
    assert_eq!(roundtripped.from_port, Some(PortName::Unknown));
    assert_eq!(roundtripped.to_port, Some(PortName::Unknown));
}

// ── Large-scale combined stress ─────────────────────────────────

#[test]
fn ten_thousand_nodes_with_all_fields() {
    let nodes: Vec<TopologyNodePayload> = (0..10_000)
        .map(|i| TopologyNodePayload {
            id: format!("full-node-{i:05}"),
            node_type: match i % 4 {
                0 => "store".into(),
                1 => "workspace".into(),
                2 => "warehouse".into(),
                _ => "hardware".into(),
            },
            name: format!("Full Node #{i} — with émojis 🎉"),
            subtitle: Some(format!("Sub-{i}")),
            x: (i as f64) * 1.25,
            y: (i as f64) * -0.75,
            tier_requirement: Some(if i % 3 == 0 { "premium" } else { "standard" }.into()),
            telemetry_badge: Some(if i % 2 == 0 { "Online" } else { "Offline" }.into()),
            telemetry_status: Some(if i % 2 == 0 { "online" } else { "offline" }.into()),
            metadata: Some(serde_json::json!({
                "index": i,
                "region": i % 5,
                "active": i % 7 != 0,
            })),
        })
        .collect();
    let data = TopologyData {
        nodes,
        wires: vec![],
    };
    let json = serde_json::to_string(&data).unwrap();
    let roundtripped: TopologyData = serde_json::from_str(&json).unwrap();
    assert_eq!(roundtripped.nodes.len(), 10_000);
    // Spot-check specific nodes.
    assert_eq!(roundtripped.nodes[0].node_type, "store");
    assert_eq!(roundtripped.nodes[1].node_type, "workspace");
    assert_eq!(roundtripped.nodes[0].name, "Full Node #0 — with émojis 🎉");
    assert_eq!(roundtripped.nodes[0].x, 0.0);
    assert_eq!(roundtripped.nodes[5_000].x, 6250.0);
    assert_eq!(roundtripped.nodes[9_999].id, "full-node-09999");
    assert_eq!(
        roundtripped.nodes[9_999].metadata.as_ref().unwrap()["index"],
        9999
    );
}

#[test]
fn twenty_five_thousand_wires_db() {
    let conn = fresh_conn();
    let nodes: Vec<TopologyNodePayload> = (0..200)
        .map(|i| TopologyNodePayload {
            id: format!("n-{i}"),
            node_type: "store".into(),
            name: format!("Node {i}"),
            subtitle: None,
            x: 0.0,
            y: 0.0,
            tier_requirement: None,
            telemetry_badge: None,
            telemetry_status: None,
            metadata: None,
        })
        .collect();
    let wires: Vec<TopologyWirePayload> = (0..25_000)
        .map(|i| TopologyWirePayload {
            id: format!("w-{i:05}"),
            from_node_id: format!("n-{}", i % 200),
            to_node_id: format!("n-{}", (i + 7) % 200),
            direction: "one-way".into(),
            label: if i % 20 == 0 {
                Some(format!("batch-label-{i}"))
            } else {
                None
            },
            from_port: None,
            to_port: None,
        })
        .collect();
    let data = TopologyData { nodes, wires };
    let json = serde_json::to_string(&data).unwrap();

    // -- DB roundtrip --
    oz_core::Settings::set(&conn, TOPOLOGY_SETTING_KEY, &json).unwrap();
    let loaded_raw = oz_core::Settings::get(&conn, TOPOLOGY_SETTING_KEY)
        .unwrap()
        .unwrap();
    let loaded: TopologyData = serde_json::from_str(&loaded_raw).unwrap();
    assert_eq!(loaded.nodes.len(), 200);
    assert_eq!(loaded.wires.len(), 25_000);
    assert_eq!(loaded.wires[0].id, "w-00000");
    assert_eq!(loaded.wires[24_999].id, "w-24999");
    // Verify every 1000th wire for label integrity.
    for i in (0..25_000).step_by(1000) {
        if i % 20 == 0 {
            assert_eq!(
                loaded.wires[i].label.as_deref(),
                Some(format!("batch-label-{i}").as_str()),
                "label mismatch at wire {i}"
            );
        }
    }
}

#[test]
fn five_thousand_nodes_with_five_thousand_wires_combined_db() {
    let conn = fresh_conn();
    let nodes: Vec<TopologyNodePayload> = (0..5_000)
        .map(|i| TopologyNodePayload {
            id: format!("combo-n-{i:04}"),
            node_type: "store".into(),
            name: format!("Combo Node {i}"),
            subtitle: None,
            x: i as f64,
            y: (i * 2) as f64,
            tier_requirement: None,
            telemetry_badge: None,
            telemetry_status: None,
            metadata: None,
        })
        .collect();
    let wires: Vec<TopologyWirePayload> = (0..5_000)
        .map(|i| TopologyWirePayload {
            id: format!("combo-w-{i:04}"),
            from_node_id: format!("combo-n-{i:04}"),
            to_node_id: format!("combo-n-{:04}", (i + 1) % 5_000),
            direction: if i % 2 == 0 { "one-way" } else { "two-way" }.into(),
            label: None,
            from_port: None,
            to_port: None,
        })
        .collect();
    let data = TopologyData { nodes, wires };
    let json = serde_json::to_string(&data).unwrap();

    oz_core::Settings::set(&conn, TOPOLOGY_SETTING_KEY, &json).unwrap();
    let loaded_raw = oz_core::Settings::get(&conn, TOPOLOGY_SETTING_KEY)
        .unwrap()
        .unwrap();
    let loaded: TopologyData = serde_json::from_str(&loaded_raw).unwrap();
    assert_eq!(loaded.nodes.len(), 5_000);
    assert_eq!(loaded.wires.len(), 5_000);

    // Verify ring integrity: each wire connects sequential nodes.
    for i in 0..5_000 {
        let w = &loaded.wires[i];
        assert_eq!(w.from_node_id, format!("combo-n-{i:04}"));
        let next = (i + 1) % 5_000;
        assert_eq!(w.to_node_id, format!("combo-n-{next:04}"));
    }
}

// ── Racing publishes (ADR #46 Phase 1 gate) ─────────────────────
//
// Supervisor-authored (Round 118): the R36 directive's concurrency
// Verification test — the last item gating the ADR #46 Phase-1
// declaration (see todo-global-saas-1.md, Rounds 109/112/113). Two
// racing publishes to ONE branch must yield two ORDERED revisions, not
// a clobbered row; and the CAS path must reject the loser with
// `topology-revision-conflict` rather than silently double-increment.
//
// The persistence layer's IMMEDIATE transaction is what makes both
// guarantees hold: writers serialize at BEGIN, so a blocked writer
// re-reads the fresh revision after the peer commits.

fn race_node(id: &str) -> serde_json::Value {
    serde_json::json!({ "id": id, "type": "store", "name": "Store", "x": 0.0, "y": 0.0 })
}

#[test]
fn racing_publishes_to_one_branch_yield_two_ordered_revisions() {
    let dir = tempdir().unwrap();
    let db_path = dir.path().join("racing.db");
    {
        let mut setup = Connection::open(&db_path).unwrap();
        migrations::run(&mut setup).unwrap();
    }

    let path_str = db_path.to_string_lossy().to_string();
    let threads: Vec<_> = (0..2)
        .map(|i| {
            let p = path_str.clone();
            let note = format!("race {i}");
            std::thread::spawn(move || {
                let conn = Connection::open(&p).unwrap();
                let context = TopologyRevisionContext {
                    change_note: &note,
                    published_by: "user-racer",
                    workspace_creations: 1,
                    workspace_updates: 0,
                    workspace_archives: 0,
                };
                // expected = None: both publishers believe they are current.
                // The IMMEDIATE transaction must serialize them.
                save_topology_json_at_key_with_revision(
                    &conn,
                    vec![race_node(&format!("racer-{i}"))],
                    vec![],
                    TOPOLOGY_SETTING_KEY,
                    &[],
                    None,
                    None,
                    None,
                    Some(&context),
                )
                .map_err(|e| e.to_string())
            })
        })
        .collect();

    let outcomes: Vec<Result<u64, String>> = threads
        .into_iter()
        .map(|t| t.join().expect("thread panicked"))
        .collect();

    // BOTH must succeed: the second re-reads the fresh revision after the
    // first commits and takes revision 2. A lost update here is the exact
    // "clobbered row" failure the gate forbids.
    assert!(
        outcomes.iter().all(|o| o.is_ok()),
        "a racing publisher was lost: {outcomes:?}"
    );

    let conn = Connection::open(&db_path).unwrap();
    let rows: Vec<(i64, String)> = conn
        .prepare(
            "SELECT revision, change_note FROM topology_revisions
             WHERE branch_id = '' ORDER BY revision",
        )
        .unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();

    assert_eq!(rows.len(), 2, "two publishes, two rows: {rows:?}");
    assert_eq!(
        rows.iter().map(|(rev, _)| *rev).collect::<Vec<_>>(),
        vec![1, 2],
        "ordered, no gaps"
    );
    let notes: Vec<&str> = rows.iter().map(|(_, n)| n.as_str()).collect();
    assert!(notes.contains(&"race 0") && notes.contains(&"race 1"));
}

#[test]
fn racing_publishes_with_the_same_expected_revision_cas_reject_one() {
    let dir = tempdir().unwrap();
    let db_path = dir.path().join("racing-cas.db");
    {
        let mut setup = Connection::open(&db_path).unwrap();
        migrations::run(&mut setup).unwrap();
    }

    let path_str = db_path.to_string_lossy().to_string();
    let threads: Vec<_> = (0..2)
        .map(|i| {
            let p = path_str.clone();
            let note = format!("cas race {i}");
            std::thread::spawn(move || {
                let conn = Connection::open(&p).unwrap();
                let context = TopologyRevisionContext {
                    change_note: &note,
                    published_by: "user-racer",
                    workspace_creations: 0,
                    workspace_updates: 1,
                    workspace_archives: 0,
                };
                // Both publishers read current=0 and send expected=0.
                // Exactly one may win.
                save_topology_json_at_key_with_revision(
                    &conn,
                    vec![race_node(&format!("cas-racer-{i}"))],
                    vec![],
                    TOPOLOGY_SETTING_KEY,
                    &[],
                    Some(0),
                    None,
                    None,
                    Some(&context),
                )
                .map_err(|e| e.to_string())
            })
        })
        .collect();

    let outcomes: Vec<Result<u64, String>> = threads
        .into_iter()
        .map(|t| t.join().expect("thread panicked"))
        .collect();

    let winners = outcomes.iter().filter(|o| o.is_ok()).count();
    let losers = outcomes
        .iter()
        .filter_map(|o| o.as_ref().err())
        .collect::<Vec<_>>();
    assert_eq!(winners, 1, "CAS admits exactly one: {outcomes:?}");
    assert_eq!(
        losers.len(),
        1,
        "the loser must be rejected, not queued: {outcomes:?}"
    );
    assert!(
        losers[0].contains("topology revision conflict"),
        "rejection is the revision-conflict error: {losers:?}"
    );

    let conn = Connection::open(&db_path).unwrap();
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM topology_revisions WHERE branch_id = ''",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 1, "one winner, one row");
}
