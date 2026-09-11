//! Serde behaviour of the typed topology payloads: null/missing/extra
//! top-level fields, malformed node and wire entries, extreme and hostile
//! string content (HTML, RTL, zero-width, control chars), and large-graph
//! roundtrips through `TopologyData`.
//!
//! Moved subset of the desktop `topology_serde_tests` module. Mounted as
//! `topology_serde_tests` beside `model.rs` in `oz_bridge::topology` via
//! `#[path]`; the flat namespace resolves through `use super::*`. The
//! save-path rejection tests stay desktop-side: they drive the
//! `#[cfg(test)]` `save_topology_data` helper, which is desktop-only.

use super::*;
#[test]
fn data_with_null_nodes_field_fails() {
    let json = r#"{"nodes":null,"wires":[]}"#;
    let result: Result<TopologyData, _> = serde_json::from_str(json);
    assert!(result.is_err());
}

#[test]
fn data_with_null_wires_field_fails() {
    let json = r#"{"nodes":[],"wires":null}"#;
    let result: Result<TopologyData, _> = serde_json::from_str(json);
    assert!(result.is_err());
}

#[test]
fn data_missing_nodes_field_fails() {
    let json = r#"{"wires":[]}"#;
    let result: Result<TopologyData, _> = serde_json::from_str(json);
    assert!(result.is_err());
}

#[test]
fn data_missing_wires_field_fails() {
    let json = r#"{"nodes":[]}"#;
    let result: Result<TopologyData, _> = serde_json::from_str(json);
    assert!(result.is_err());
}

#[test]
fn data_extra_top_level_fields_ignored() {
    let json = r#"{"nodes":[],"wires":[],"version":2,"created_at":"2024-01-01"}"#;
    let data: TopologyData = serde_json::from_str(json).unwrap();
    assert!(data.nodes.is_empty());
    assert!(data.wires.is_empty());
}

#[test]
fn serde_allows_duplicate_wire_ids() {
    // Serde serialization itself does not enforce uniqueness — that
    // validation lives in save_topology_data. This test verifies the
    // serde layer preserves duplicate IDs without error.
    let data = TopologyData {
        nodes: vec![TopologyNodePayload {
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
        }],
        wires: vec![
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
        ],
    };
    let json = serde_json::to_string(&data).unwrap();
    let roundtripped: TopologyData = serde_json::from_str(&json).unwrap();
    assert_eq!(roundtripped.wires.len(), 2);
    assert_eq!(roundtripped.wires[0].id, roundtripped.wires[1].id);
}

#[test]
fn data_thousand_node_graph_roundtrips() {
    let nodes: Vec<TopologyNodePayload> = (0..1000)
        .map(|i| TopologyNodePayload {
            id: format!("n-{i}"),
            node_type: "store".into(),
            name: format!("Node {i}"),
            subtitle: None,
            x: (i as f64) * 10.0,
            y: (i as f64) * 5.0,
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
    let roundtripped: TopologyData = serde_json::from_str(&json).unwrap();
    assert_eq!(roundtripped.nodes.len(), 1000);
    assert_eq!(roundtripped.nodes[999].id, "n-999");
}

// ── JSON structural edge cases ─────────────────────────────────

#[test]
fn json_array_instead_of_node_fails() {
    let json = r#"["a","b","c"]"#;
    let result: Result<TopologyNodePayload, _> = serde_json::from_str(json);
    assert!(result.is_err());
}

#[test]
fn json_primitive_instead_of_node_fails() {
    let json = r#"42"#;
    let result: Result<TopologyNodePayload, _> = serde_json::from_str(json);
    assert!(result.is_err());
}

#[test]
fn json_null_boolean_string_for_node_fails() {
    let cases = ["null", "true", r#""hello""#];
    for case in &cases {
        let result: Result<TopologyNodePayload, _> = serde_json::from_str(case);
        assert!(result.is_err(), "expected error for: {case}");
    }
}

#[test]
fn json_number_for_string_node_field_fails() {
    let json = r#"{"id":123,"type":"store","name":"Test","x":0,"y":0}"#;
    let result: Result<TopologyNodePayload, _> = serde_json::from_str(json);
    assert!(result.is_err());
}

#[test]
fn json_bool_for_string_wire_field_fails() {
    let json = r#"{"id":true,"from_node_id":"a","to_node_id":"b"}"#;
    let result: Result<TopologyWirePayload, _> = serde_json::from_str(json);
    assert!(result.is_err());
}

#[test]
fn json_string_for_coordinate_fails() {
    let json = r#"{"id":"n1","type":"store","name":"Test","x":"10","y":"20"}"#;
    let result: Result<TopologyNodePayload, _> = serde_json::from_str(json);
    assert!(result.is_err());
}

#[test]
fn json_nested_node_array() {
    let json = r#"{"nodes":[{"id":"n1","type":"store","name":"Nested","x":0,"y":0}],"wires":[]}"#;
    let data: TopologyData = serde_json::from_str(json).unwrap();
    assert_eq!(data.nodes.len(), 1);
}

// ── HTML / special content injection ───────────────────────────

#[test]
fn node_name_with_html_injection() {
    let node = TopologyNodePayload {
        id: "n1".into(),
        node_type: "store".into(),
        name: "<script>alert('xss')</script>".into(),
        subtitle: Some("<img src=x onerror=alert(1)>".into()),
        x: 0.0,
        y: 0.0,
        tier_requirement: None,
        telemetry_badge: None,
        telemetry_status: None,
        metadata: None,
    };
    let json = serde_json::to_string(&node).unwrap();
    let roundtripped: TopologyNodePayload = serde_json::from_str(&json).unwrap();
    assert!(roundtripped.name.contains("<script>"));
    assert!(roundtripped.subtitle.as_deref().unwrap().contains("<img"));
}

#[test]
fn wire_label_with_special_chars() {
    let json = r#"{"id":"w1","from_node_id":"a","to_node_id":"b","label":"tab\tnewline\nquote\"backslash\\"}"#;
    let wire: TopologyWirePayload = serde_json::from_str(json).unwrap();
    assert!(wire.label.as_deref().unwrap().contains('\t'));
    assert!(wire.label.as_deref().unwrap().contains('\n'));
    assert!(wire.label.as_deref().unwrap().contains('"'));
}

#[test]
fn node_metadata_with_html() {
    let node = TopologyNodePayload {
        id: "n1".into(),
        node_type: "store".into(),
        name: "Test".into(),
        subtitle: None,
        x: 0.0,
        y: 0.0,
        tier_requirement: None,
        telemetry_badge: None,
        telemetry_status: None,
        metadata: Some(serde_json::json!({
            "description": "<b>bold</b><script>bad</script>",
            "xss_payload": "\"><img src=x>"
        })),
    };
    let json = serde_json::to_string(&node).unwrap();
    let roundtripped: TopologyNodePayload = serde_json::from_str(&json).unwrap();
    let meta = roundtripped.metadata.unwrap();
    assert!(meta["description"].as_str().unwrap().contains("<script>"));
}

// ── Unicode / encoding edge cases ─────────────────────────────

#[test]
fn node_name_with_rtl_text() {
    let name = "\u{202E}Reverse\u{202C} normal";
    let node = TopologyNodePayload {
        id: "rtl".into(),
        node_type: "store".into(),
        name: name.into(),
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
    assert_eq!(roundtripped.name, name);
}

#[test]
fn node_name_with_zero_width_chars() {
    let name = "Ex\u{200B}ample\u{200C}Name\u{200D}";
    let node = TopologyNodePayload {
        id: "zw".into(),
        node_type: "store".into(),
        name: name.into(),
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
    assert_eq!(roundtripped.name, name);
    assert_eq!(roundtripped.name.len(), name.len());
}

#[test]
fn node_name_with_control_chars() {
    let name = "Line1\u{0000}null\u{0001}start\u{001F}unit-sep";
    let node = TopologyNodePayload {
        id: "ctrl".into(),
        node_type: "store".into(),
        name: name.into(),
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
    assert_eq!(roundtripped.name, name);
}
