//! Field-level edge cases for the typed topology payloads: empty/oversized
//! ids and names, coordinate extremes, null/absent optional fields, and
//! wire/port/direction combinations.
//!
//! Mounted as `topology_field_tests` beside `model.rs` in `kasirmu_bridge::topology`
//! via `#[path]`; the flat namespace resolves through `use super::*`.
use super::*;

// ── Field-level edge cases ────────────────────────────────────

#[test]
fn node_empty_id() {
    let json = r#"{"id":"","type":"store","name":"No ID","x":0,"y":0}"#;
    let node: TopologyNodePayload = serde_json::from_str(json).unwrap();
    assert!(node.id.is_empty());
}

#[test]
fn node_empty_type() {
    let json = r#"{"id":"n1","type":"","name":"No Type","x":0,"y":0}"#;
    let node: TopologyNodePayload = serde_json::from_str(json).unwrap();
    assert_eq!(node.node_type, NodeType::Unknown);
}

#[test]
fn node_empty_name() {
    let json = r#"{"id":"n1","type":"store","name":"","x":0,"y":0}"#;
    let node: TopologyNodePayload = serde_json::from_str(json).unwrap();
    assert!(node.name.is_empty());
}

#[test]
fn node_negative_coordinates() {
    let node = TopologyNodePayload {
        id: "n1".into(),
        node_type: "store".into(),
        name: "Negative".into(),
        subtitle: None,
        x: -100.5,
        y: -200.3,
        tier_requirement: None,
        telemetry_badge: None,
        telemetry_status: None,
        metadata: None,
    };
    let json = serde_json::to_string(&node).unwrap();
    let roundtripped: TopologyNodePayload = serde_json::from_str(&json).unwrap();
    assert!((roundtripped.x - (-100.5)).abs() < f64::EPSILON);
    assert!((roundtripped.y - (-200.3)).abs() < f64::EPSILON);
}

#[test]
fn node_zero_coordinates() {
    let json = r#"{"id":"n1","type":"store","name":"Origin","x":0,"y":0}"#;
    let node: TopologyNodePayload = serde_json::from_str(json).unwrap();
    assert_eq!(node.x, 0.0);
    assert_eq!(node.y, 0.0);
}

#[test]
fn node_large_coordinates() {
    let node = TopologyNodePayload {
        id: "n1".into(),
        node_type: "store".into(),
        name: "Far".into(),
        subtitle: None,
        x: 99999.999,
        y: -99999.999,
        tier_requirement: None,
        telemetry_badge: None,
        telemetry_status: None,
        metadata: None,
    };
    let json = serde_json::to_string(&node).unwrap();
    let roundtripped: TopologyNodePayload = serde_json::from_str(&json).unwrap();
    assert!((roundtripped.x - 99999.999).abs() < 0.001);
    assert!((roundtripped.y - (-99999.999)).abs() < 0.001);
}

#[test]
fn node_fractional_coordinates() {
    let node = TopologyNodePayload {
        id: "n1".into(),
        node_type: "store".into(),
        name: "Precise".into(),
        subtitle: None,
        x: 0.123456789,
        y: 0.987654321,
        tier_requirement: None,
        telemetry_badge: None,
        telemetry_status: None,
        metadata: None,
    };
    let json = serde_json::to_string(&node).unwrap();
    let roundtripped: TopologyNodePayload = serde_json::from_str(&json).unwrap();
    assert!((roundtripped.x - 0.123456789).abs() < 1e-8);
    assert!((roundtripped.y - 0.987654321).abs() < 1e-8);
}

#[test]
fn node_empty_string_subtitle() {
    let json = r#"{"id":"n1","type":"store","name":"Test","x":0,"y":0,"subtitle":""}"#;
    let node: TopologyNodePayload = serde_json::from_str(json).unwrap();
    assert_eq!(node.subtitle.as_deref(), Some(""));
}

#[test]
fn node_null_subtitle_roundtrip() {
    let json = r#"{"id":"n1","type":"store","name":"Test","x":0,"y":0,"subtitle":null}"#;
    let node: TopologyNodePayload = serde_json::from_str(json).unwrap();
    assert!(node.subtitle.is_none());
}

#[test]
fn node_unknown_extra_fields_ignored() {
    let json = r#"{"id":"n1","type":"store","name":"Test","x":0,"y":0,"unknown_field":"val","nested":{"a":1}}"#;
    let node: TopologyNodePayload = serde_json::from_str(json).unwrap();
    assert_eq!(node.id, "n1");
    assert_eq!(node.node_type, "store");
}

#[test]
fn node_null_metadata() {
    let json = r#"{"id":"n1","type":"store","name":"Test","x":0,"y":0,"metadata":null}"#;
    let node: TopologyNodePayload = serde_json::from_str(json).unwrap();
    assert!(node.metadata.is_none());
}

#[test]
fn node_metadata_with_nested_objects() {
    let node = TopologyNodePayload {
        id: "n1".into(),
        node_type: "hardware".into(),
        name: "Printer".into(),
        subtitle: None,
        x: 0.0,
        y: 0.0,
        tier_requirement: None,
        telemetry_badge: None,
        telemetry_status: None,
        metadata: Some(serde_json::json!({
            "config": {
                "ip": "192.168.1.100",
                "port": 9100,
                "settings": {
                    "paper_size": "80mm",
                    "encoding": "UTF-8"
                }
            },
            "tags": ["kitchen", "main"],
            "enabled": true,
            "count": 42
        })),
    };
    let json = serde_json::to_string(&node).unwrap();
    let roundtripped: TopologyNodePayload = serde_json::from_str(&json).unwrap();
    let meta = roundtripped.metadata.unwrap();
    assert_eq!(meta["config"]["ip"], "192.168.1.100");
    assert_eq!(meta["config"]["settings"]["paper_size"], "80mm");
    assert_eq!(meta["tags"][0], "kitchen");
    assert_eq!(meta["enabled"], true);
    assert_eq!(meta["count"], 42);
}

#[test]
fn node_missing_type_field_fails() {
    let json = r#"{"id":"n1","name":"Test","x":0,"y":0}"#;
    let result: Result<TopologyNodePayload, _> = serde_json::from_str(json);
    assert!(result.is_err());
}

#[test]
fn node_missing_name_field_fails() {
    let json = r#"{"id":"n1","type":"store","x":0,"y":0}"#;
    let result: Result<TopologyNodePayload, _> = serde_json::from_str(json);
    assert!(result.is_err());
}

#[test]
fn node_wrong_type_for_coordinates() {
    let json = r#"{"id":"n1","type":"store","name":"Test","x":"bad","y":false}"#;
    let result: Result<TopologyNodePayload, _> = serde_json::from_str(json);
    assert!(result.is_err());
}

#[test]
fn node_long_name_roundtrip() {
    let long_name = "A".repeat(1000);
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
    assert_eq!(roundtripped.name.len(), 1000);
    assert_eq!(roundtripped.name, long_name);
}

// ── Wire field-level edge cases ───────────────────────────────

#[test]
fn wire_empty_id() {
    let json = r#"{"id":"","from_node_id":"a","to_node_id":"b"}"#;
    let wire: TopologyWirePayload = serde_json::from_str(json).unwrap();
    assert!(wire.id.is_empty());
}

#[test]
fn wire_empty_from_node() {
    let json = r#"{"id":"w1","from_node_id":"","to_node_id":"b"}"#;
    let wire: TopologyWirePayload = serde_json::from_str(json).unwrap();
    assert!(wire.from_node_id.is_empty());
}

#[test]
fn wire_empty_to_node() {
    let json = r#"{"id":"w1","from_node_id":"a","to_node_id":""}"#;
    let wire: TopologyWirePayload = serde_json::from_str(json).unwrap();
    assert!(wire.to_node_id.is_empty());
}

#[test]
fn wire_self_reference() {
    let wire = TopologyWirePayload {
        id: "self-wire".into(),
        from_node_id: "n1".into(),
        to_node_id: "n1".into(),
        direction: "two-way".into(),
        label: None,
        from_port: None,
        to_port: None,
    };
    let json = serde_json::to_string(&wire).unwrap();
    let roundtripped: TopologyWirePayload = serde_json::from_str(&json).unwrap();
    assert_eq!(roundtripped.from_node_id, roundtripped.to_node_id);
}

#[test]
fn wire_unexpected_direction_preserved() {
    let json = r#"{"id":"w1","from_node_id":"a","to_node_id":"b","direction":"bidirectional"}"#;
    let wire: TopologyWirePayload = serde_json::from_str(json).unwrap();
    assert_eq!(wire.direction, WireDirection::Unknown);
}

#[test]
fn wire_null_label_roundtrip() {
    let json = r#"{"id":"w1","from_node_id":"a","to_node_id":"b","label":null}"#;
    let wire: TopologyWirePayload = serde_json::from_str(json).unwrap();
    assert!(wire.label.is_none());
}

#[test]
fn wire_empty_label() {
    let json = r#"{"id":"w1","from_node_id":"a","to_node_id":"b","label":""}"#;
    let wire: TopologyWirePayload = serde_json::from_str(json).unwrap();
    assert_eq!(wire.label.as_deref(), Some(""));
}

#[test]
fn wire_unknown_extra_fields_ignored() {
    let json = r#"{"id":"w1","from_node_id":"a","to_node_id":"b","color":"red","weight":5}"#;
    let wire: TopologyWirePayload = serde_json::from_str(json).unwrap();
    assert_eq!(wire.id, "w1");
    assert_eq!(wire.from_node_id, "a");
    assert_eq!(wire.direction, "one-way");
}

#[test]
fn wire_missing_required_field_fails() {
    let json = r#"{"id":"w1","from_node_id":"a"}"#;
    let result: Result<TopologyWirePayload, _> = serde_json::from_str(json);
    assert!(result.is_err());
}

#[test]
fn wire_empty_required_fields_roundtrip() {
    let json = r#"{"id":"","from_node_id":"","to_node_id":""}"#;
    let wire: TopologyWirePayload = serde_json::from_str(json).unwrap();
    assert!(wire.id.is_empty());
    assert!(wire.from_node_id.is_empty());
    assert!(wire.to_node_id.is_empty());
}

#[test]
fn wire_long_label() {
    let long_label = "x".repeat(5000);
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
    assert_eq!(roundtripped.label.as_deref().unwrap().len(), 5000);
}

// ── Combinatorial optional field patterns ──────────────────────

#[test]
fn node_only_id_type_name_coords() {
    let json = r#"{"id":"n1","type":"store","name":"Minimal","x":10,"y":20}"#;
    let node: TopologyNodePayload = serde_json::from_str(json).unwrap();
    assert!(node.subtitle.is_none());
    assert!(node.tier_requirement.is_none());
    assert!(node.telemetry_badge.is_none());
    assert!(node.telemetry_status.is_none());
    assert!(node.metadata.is_none());
    assert_eq!(node.x, 10.0);
    assert_eq!(node.y, 20.0);
}

#[test]
fn node_only_subtitle_present() {
    let json = r#"{"id":"n1","type":"store","name":"Test","x":0,"y":0,"subtitle":"Hello"}"#;
    let node: TopologyNodePayload = serde_json::from_str(json).unwrap();
    assert_eq!(node.subtitle.as_deref(), Some("Hello"));
    assert!(node.tier_requirement.is_none());
    assert!(node.metadata.is_none());
}

#[test]
fn node_only_tier_requirement_present() {
    let json =
        r#"{"id":"n1","type":"store","name":"Test","x":0,"y":0,"tier_requirement":"premium"}"#;
    let node: TopologyNodePayload = serde_json::from_str(json).unwrap();
    assert_eq!(node.tier_requirement.as_deref(), Some("premium"));
    assert!(node.subtitle.is_none());
}

#[test]
fn node_only_telemetry_badge_present() {
    let json = r#"{"id":"n1","type":"store","name":"Test","x":0,"y":0,"telemetry_badge":"Online"}"#;
    let node: TopologyNodePayload = serde_json::from_str(json).unwrap();
    assert!(node.telemetry_badge.is_some());
    assert!(node.telemetry_status.is_none());
}

#[test]
fn node_only_telemetry_status_present() {
    let json =
        r#"{"id":"n1","type":"store","name":"Test","x":0,"y":0,"telemetry_status":"warning"}"#;
    let node: TopologyNodePayload = serde_json::from_str(json).unwrap();
    assert!(node.telemetry_status.is_some());
    assert!(node.telemetry_badge.is_none());
}

#[test]
fn node_only_metadata_present() {
    let json = r#"{"id":"n1","type":"store","name":"Test","x":0,"y":0,"metadata":{"key":"val"}}"#;
    let node: TopologyNodePayload = serde_json::from_str(json).unwrap();
    assert!(node.metadata.is_some());
    assert!(node.subtitle.is_none());
    assert!(node.tier_requirement.is_none());
}

#[test]
fn node_all_tier_fields_present() {
    let json = r#"{"id":"n1","type":"warehouse","name":"Full Tier","x":10,"y":20,"subtitle":"Warehouse A","tier_requirement":"enterprise","telemetry_badge":"Online","telemetry_status":"online","metadata":{"capacity":50000}}"#;
    let node: TopologyNodePayload = serde_json::from_str(json).unwrap();
    assert_eq!(node.node_type, "warehouse");
    assert_eq!(node.subtitle.as_deref(), Some("Warehouse A"));
    assert_eq!(node.tier_requirement.as_deref(), Some("enterprise"));
    assert_eq!(node.telemetry_badge.as_deref(), Some("Online"));
    assert_eq!(node.telemetry_status.as_deref(), Some("online"));
    assert!(node.metadata.is_some());
}

// ── Wire port and direction combinations ──────────────────────

#[test]
fn wire_only_from_port() {
    let json = r#"{"id":"w1","from_node_id":"a","to_node_id":"b","from_port":"left"}"#;
    let wire: TopologyWirePayload = serde_json::from_str(json).unwrap();
    assert_eq!(wire.from_port, Some(PortName::Left));
    assert!(wire.to_port.is_none());
}

#[test]
fn wire_only_to_port() {
    let json = r#"{"id":"w1","from_node_id":"a","to_node_id":"b","to_port":"right"}"#;
    let wire: TopologyWirePayload = serde_json::from_str(json).unwrap();
    assert_eq!(wire.to_port, Some(PortName::Right));
    assert!(wire.from_port.is_none());
}

#[test]
fn wire_both_ports_present() {
    let json =
        r#"{"id":"w1","from_node_id":"a","to_node_id":"b","from_port":"out","to_port":"in"}"#;
    let wire: TopologyWirePayload = serde_json::from_str(json).unwrap();
    assert_eq!(wire.from_port, Some(PortName::Unknown));
    assert_eq!(wire.to_port, Some(PortName::Unknown));
}

#[test]
fn wire_label_without_ports() {
    let json = r#"{"id":"w1","from_node_id":"a","to_node_id":"b","label":"direct link"}"#;
    let wire: TopologyWirePayload = serde_json::from_str(json).unwrap();
    assert_eq!(wire.label.as_deref(), Some("direct link"));
    assert!(wire.from_port.is_none());
    assert!(wire.to_port.is_none());
}

#[test]
fn wire_all_optionals_present() {
    let wire = TopologyWirePayload {
        id: "full-wire".into(),
        from_node_id: "a".into(),
        to_node_id: "b".into(),
        direction: "two-way".into(),
        label: Some("bi-directional sync".into()),
        from_port: Some("primary".into()),
        to_port: Some("secondary".into()),
    };
    let json = serde_json::to_string(&wire).unwrap();
    let roundtripped: TopologyWirePayload = serde_json::from_str(&json).unwrap();
    assert_eq!(roundtripped.direction, "two-way");
    assert_eq!(roundtripped.label.as_deref(), Some("bi-directional sync"));
    assert_eq!(roundtripped.from_port, Some(PortName::Unknown));
    assert_eq!(roundtripped.to_port, Some(PortName::Unknown));
}
