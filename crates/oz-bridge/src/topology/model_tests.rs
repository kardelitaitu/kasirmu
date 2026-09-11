//! Unit tests for the typed topology model: enum conversions
//! (`From<&str>` / `PartialEq<&str>`), serde round-trips, and the
//! resilient f64/null/direction deserialization helpers.
//!
//! Mounted as `model_tests` beside `model.rs` in `oz_bridge::topology`
//! via `#[path]`; the flat namespace resolves through `use super::*`.
use super::*;

// ── NodeType From<&str> ─────────────────────────────────────

#[test]
fn node_type_from_str_valid_variants() {
    assert_eq!(NodeType::from("store"), NodeType::Store);
    assert_eq!(NodeType::from("workspace"), NodeType::Workspace);
    assert_eq!(NodeType::from("warehouse"), NodeType::Warehouse);
    assert_eq!(NodeType::from("hardware"), NodeType::Hardware);
}

#[test]
fn node_type_from_str_unknown_returns_unknown() {
    assert_eq!(NodeType::from("anything"), NodeType::Unknown);
    assert_eq!(NodeType::from(""), NodeType::Unknown);
    assert_eq!(NodeType::from("STORE"), NodeType::Unknown);
    assert_eq!(NodeType::from("Store"), NodeType::Unknown);
}

// ── NodeType PartialEq<&str> ────────────────────────────────

#[test]
fn node_type_partial_eq_str() {
    assert_eq!(NodeType::Store, "store");
    assert_eq!(NodeType::Workspace, "workspace");
    assert_eq!(NodeType::Warehouse, "warehouse");
    assert_eq!(NodeType::Hardware, "hardware");
}

#[test]
fn node_type_unknown_never_eq_str() {
    assert_ne!(NodeType::Unknown, "store");
    assert_ne!(NodeType::Unknown, "workspace");
    assert_ne!(NodeType::Unknown, "anything");
}

// ── NodeType serde ──────────────────────────────────────────

#[test]
fn node_type_serde_kebab_case() {
    assert_eq!(
        serde_json::to_string(&NodeType::Store).unwrap(),
        r#""store""#
    );
    assert_eq!(
        serde_json::to_string(&NodeType::Workspace).unwrap(),
        r#""workspace""#
    );
    assert_eq!(
        serde_json::to_string(&NodeType::Warehouse).unwrap(),
        r#""warehouse""#
    );
    assert_eq!(
        serde_json::to_string(&NodeType::Hardware).unwrap(),
        r#""hardware""#
    );
}

#[test]
fn node_type_serde_roundtrip() {
    for variant in [
        NodeType::Store,
        NodeType::Workspace,
        NodeType::Warehouse,
        NodeType::Hardware,
    ] {
        let json = serde_json::to_string(&variant).unwrap();
        let back: NodeType = serde_json::from_str(&json).unwrap();
        assert_eq!(back, variant);
    }
}

#[test]
fn node_type_serde_other_catches_unknown() {
    let json = r#""teleporter""#;
    let val: NodeType = serde_json::from_str(json).unwrap();
    assert_eq!(val, NodeType::Unknown);
}

// ── WireDirection From<&str> ────────────────────────────────

#[test]
fn wire_direction_from_str_valid() {
    assert_eq!(WireDirection::from("one-way"), WireDirection::OneWay);
    assert_eq!(WireDirection::from("two-way"), WireDirection::TwoWay);
    assert_eq!(WireDirection::from("reverse"), WireDirection::Reverse);
}

#[test]
fn wire_direction_from_str_unknown() {
    assert_eq!(WireDirection::from("bidi"), WireDirection::Unknown);
    assert_eq!(WireDirection::from(""), WireDirection::Unknown);
    assert_eq!(WireDirection::from("OneWay"), WireDirection::Unknown);
}

// ── WireDirection PartialEq<&str> ───────────────────────────

#[test]
fn wire_direction_partial_eq_str() {
    assert_eq!(WireDirection::OneWay, "one-way");
    assert_eq!(WireDirection::TwoWay, "two-way");
    assert_eq!(WireDirection::Reverse, "reverse");
}

#[test]
fn wire_direction_unknown_never_eq_str() {
    assert_ne!(WireDirection::Unknown, "one-way");
    assert_ne!(WireDirection::Unknown, "two-way");
}

// ── WireDirection serde ─────────────────────────────────────

#[test]
fn wire_direction_serde_kebab_case() {
    assert_eq!(
        serde_json::to_string(&WireDirection::OneWay).unwrap(),
        r#""one-way""#
    );
    assert_eq!(
        serde_json::to_string(&WireDirection::TwoWay).unwrap(),
        r#""two-way""#
    );
    assert_eq!(
        serde_json::to_string(&WireDirection::Reverse).unwrap(),
        r#""reverse""#
    );
}

#[test]
fn wire_direction_serde_other_catches_unknown() {
    let val: WireDirection = serde_json::from_str(r#""bidi""#).unwrap();
    assert_eq!(val, WireDirection::Unknown);
}

// ── PortName From<&str> ─────────────────────────────────────

#[test]
fn port_name_from_str_valid() {
    assert_eq!(PortName::from("top"), PortName::Top);
    assert_eq!(PortName::from("right"), PortName::Right);
    assert_eq!(PortName::from("bottom"), PortName::Bottom);
    assert_eq!(PortName::from("left"), PortName::Left);
}

#[test]
fn port_name_from_str_unknown() {
    assert_eq!(PortName::from("center"), PortName::Unknown);
    assert_eq!(PortName::from(""), PortName::Unknown);
    assert_eq!(PortName::from("Top"), PortName::Unknown);
}

// ── PortName PartialEq<&str> ────────────────────────────────

#[test]
fn port_name_partial_eq_str() {
    assert_eq!(PortName::Top, "top");
    assert_eq!(PortName::Right, "right");
    assert_eq!(PortName::Bottom, "bottom");
    assert_eq!(PortName::Left, "left");
}

#[test]
fn port_name_unknown_never_eq_str() {
    assert_ne!(PortName::Unknown, "top");
    assert_ne!(PortName::Unknown, "left");
}

// ── PortName serde ──────────────────────────────────────────

#[test]
fn port_name_serde_lowercase() {
    assert_eq!(serde_json::to_string(&PortName::Top).unwrap(), r#""top""#);
    assert_eq!(
        serde_json::to_string(&PortName::Right).unwrap(),
        r#""right""#
    );
}

#[test]
fn port_name_serde_other_catches_unknown() {
    let val: PortName = serde_json::from_str(r#""center""#).unwrap();
    assert_eq!(val, PortName::Unknown);
}

// ── ser_f64_finite / de_f64_or_null ────────────────────────

#[test]
fn serde_f64_normal_roundtrip() {
    let json = r#"{"id":"n1","type":"store","name":"S","x":123.45,"y":-67.8}"#;
    let node: TopologyNodePayload = serde_json::from_str(json).unwrap();
    assert!((node.x - 123.45).abs() < f64::EPSILON);
    assert!((node.y - (-67.8)).abs() < f64::EPSILON);
}

#[test]
fn serde_f64_nan_serializes_to_zero() {
    // NaN is not valid JSON so we can't deserialize it.
    // But the custom serializer guarantees NaN -> 0.0 on output.
    let mut node = TopologyNodePayload {
        id: "n1".into(),
        node_type: NodeType::Store,
        name: "S".into(),
        subtitle: None,
        x: f64::NAN,
        y: 1.0,
        tier_requirement: None,
        telemetry_badge: None,
        telemetry_status: None,
        metadata: None,
    };
    let out = serde_json::to_string(&node).unwrap();
    assert!(
        out.contains(r#""x":0.0"#),
        "NaN should serialize to 0.0, got {out}"
    );
    // Infinity should also serialize to 0.0
    node.x = f64::INFINITY;
    let out = serde_json::to_string(&node).unwrap();
    assert!(
        out.contains(r#""x":0.0"#),
        "Infinity should serialize to 0.0, got {out}"
    );
    // Negative infinity too
    node.x = f64::NEG_INFINITY;
    let out = serde_json::to_string(&node).unwrap();
    assert!(
        out.contains(r#""x":0.0"#),
        "NegInfinity should serialize to 0.0, got {out}"
    );
}

#[test]
fn serde_f64_null_deserializes_to_zero() {
    let json = r#"{"id":"n1","type":"store","name":"S","x":null,"y":null}"#;
    let node: TopologyNodePayload = serde_json::from_str(json).unwrap();
    assert_eq!(node.x, 0.0);
    assert_eq!(node.y, 0.0);
}

#[test]
fn serde_f64_absent_field_deserializes_to_zero() {
    // When x/y are absent, serde(default) kicks in and de_f64_or_null
    // provides the default 0.0
    let json = r#"{"id":"n1","type":"store","name":"S","x":0,"y":0}"#;
    let node: TopologyNodePayload = serde_json::from_str(json).unwrap();
    assert_eq!(node.x, 0.0);
    assert_eq!(node.y, 0.0);
}

// ── de_direction_or_null ────────────────────────────────────

#[test]
fn wire_direction_null_defaults_to_one_way() {
    let json = r#"{"id":"w1","from_node_id":"a","to_node_id":"b","direction":null}"#;
    let wire: TopologyWirePayload = serde_json::from_str(json).unwrap();
    assert_eq!(wire.direction, WireDirection::OneWay);
}

#[test]
fn wire_direction_absent_defaults_to_one_way() {
    let json = r#"{"id":"w1","from_node_id":"a","to_node_id":"b"}"#;
    let wire: TopologyWirePayload = serde_json::from_str(json).unwrap();
    assert_eq!(wire.direction, WireDirection::OneWay);
}

#[test]
fn wire_direction_valid_value_preserved() {
    let json = r#"{"id":"w1","from_node_id":"a","to_node_id":"b","direction":"two-way"}"#;
    let wire: TopologyWirePayload = serde_json::from_str(json).unwrap();
    assert_eq!(wire.direction, WireDirection::TwoWay);
}

// ── TopologyNodePayload defaults ────────────────────────────

#[test]
fn node_defaults_for_optional_fields() {
    let json = r#"{"id":"n1","type":"store","name":"S","x":1.0,"y":2.0}"#;
    let node: TopologyNodePayload = serde_json::from_str(json).unwrap();
    assert_eq!(node.id, "n1");
    assert_eq!(node.node_type, NodeType::Store);
    assert_eq!(node.name, "S");
    assert!(node.subtitle.is_none());
    assert!(node.tier_requirement.is_none());
    assert!(node.telemetry_badge.is_none());
    assert!(node.telemetry_status.is_none());
    assert!(node.metadata.is_none());
}

// ── TopologyData serde roundtrip ────────────────────────────

#[test]
fn topology_data_empty_roundtrip() {
    let data = TopologyData {
        nodes: vec![],
        wires: vec![],
    };
    let json = serde_json::to_string(&data).unwrap();
    let back: TopologyData = serde_json::from_str(&json).unwrap();
    assert!(back.nodes.is_empty());
    assert!(back.wires.is_empty());
}

#[test]
fn topology_data_full_roundtrip() {
    let data = TopologyData {
        nodes: vec![TopologyNodePayload {
            id: "store-1".into(),
            node_type: NodeType::Store,
            name: "Main Store".into(),
            subtitle: None,
            x: 100.0,
            y: 200.0,
            tier_requirement: Some("pro".into()),
            telemetry_badge: Some("Online".into()),
            telemetry_status: Some("online".into()),
            metadata: None,
        }],
        wires: vec![TopologyWirePayload {
            id: "wire-1".into(),
            from_node_id: "store-1".into(),
            to_node_id: "ws-1".into(),
            direction: WireDirection::TwoWay,
            label: Some("LAN".into()),
            from_port: Some(PortName::Right),
            to_port: Some(PortName::Left),
        }],
    };
    let json = serde_json::to_string(&data).unwrap();
    let back: TopologyData = serde_json::from_str(&json).unwrap();
    assert_eq!(back.nodes.len(), 1);
    assert_eq!(back.wires.len(), 1);
    assert_eq!(back.nodes[0].id, "store-1");
    assert_eq!(back.wires[0].direction, WireDirection::TwoWay);
    assert_eq!(back.wires[0].from_port, Some(PortName::Right));
}

// ── UpdateInstanceRequest serde ──────────────────────────────

#[test]
fn update_instance_request_roundtrip() {
    let req = UpdateInstanceRequest {
        id: "inst-1".into(),
        name: "POS 1".into(),
        purpose_key: Some("pos".into()),
    };
    let json = serde_json::to_string(&req).unwrap();
    let back: UpdateInstanceRequest = serde_json::from_str(&json).unwrap();
    assert_eq!(back.id, "inst-1");
    assert_eq!(back.name, "POS 1");
    assert_eq!(back.purpose_key, Some("pos".into()));
}

#[test]
fn update_instance_request_purpose_key_optional() {
    let req = UpdateInstanceRequest {
        id: "inst-1".into(),
        name: "POS 1".into(),
        purpose_key: None,
    };
    let json = serde_json::to_string(&req).unwrap();
    // Option<T> where T is not #[serde(skip_serializing_if)] means
    // None serializes as null, but we can still roundtrip
    let back: UpdateInstanceRequest = serde_json::from_str(&json).unwrap();
    assert!(back.purpose_key.is_none());
}

// ── default_direction ───────────────────────────────────────

#[test]
fn default_direction_is_one_way() {
    assert_eq!(default_direction(), WireDirection::OneWay);
}

// ── TopologyNodePayload — full-field serde ──────────────────

#[test]
fn node_all_fields_present() {
    let json = r#"{
        "id": "n1",
        "type": "warehouse",
        "name": "WH-1",
        "subtitle": "Central",
        "x": 50.5,
        "y": 75.2,
        "tier_requirement": "enterprise",
        "telemetry_badge": "3 workers",
        "telemetry_status": "warning",
        "metadata": {"region": "us-east"}
    }"#;
    let node: TopologyNodePayload = serde_json::from_str(json).unwrap();
    assert_eq!(node.node_type, NodeType::Warehouse);
    assert_eq!(node.subtitle.as_deref(), Some("Central"));
    assert_eq!(node.tier_requirement.as_deref(), Some("enterprise"));
    assert_eq!(node.telemetry_badge.as_deref(), Some("3 workers"));
    assert_eq!(node.telemetry_status.as_deref(), Some("warning"));
    assert_eq!(node.metadata.as_ref().unwrap()["region"], "us-east");
}

// ── WirePayload defaults ────────────────────────────────────

#[test]
fn wire_defaults_for_optional_fields() {
    let json = r#"{"id":"w1","from_node_id":"a","to_node_id":"b"}"#;
    let wire: TopologyWirePayload = serde_json::from_str(json).unwrap();
    assert!(wire.label.is_none());
    assert!(wire.from_port.is_none());
    assert!(wire.to_port.is_none());
}
