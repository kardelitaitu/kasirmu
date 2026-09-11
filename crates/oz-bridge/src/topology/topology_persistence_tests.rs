//! Persistence and cross-field tests: save/load cycles, branch key scoping,
//! the compiled runtime plan, trait implementations, and partial /
//! incremental save patterns.
//!
//! Mounted as `topology_persistence_tests` beside `persistence.rs` in
//! `oz_bridge::topology` via `#[path]`; the flat namespace resolves through
//! `use super::*`. The former `super::topology_tests::*` helpers are
//! embedded test-locally: `fresh_conn` delegates to the shared headless
//! harness (`crate::testing::temp_conn`), the payload builders are copied
//! verbatim.
use super::*;

fn fresh_conn() -> rusqlite::Connection {
    crate::testing::temp_conn()
}

pub(crate) fn semantic_node(id: &str, node_type: &str, store_profile_id: Option<&str>) -> Value {
    let mut node = serde_json::json!({
        "id": id,
        "type": node_type,
        "name": id,
        "x": 0.0,
        "y": 0.0,
    });
    if let Some(store_profile_id) = store_profile_id {
        node["store_profile_id"] = Value::String(store_profile_id.into());
    }
    node
}

pub(crate) fn semantic_location_wire(id: &str, to_node_id: &str) -> Value {
    serde_json::json!({
        "id": id,
        "from_node_id": "branch",
        "to_node_id": to_node_id,
        "direction": "one-way",
        "from_port_id": "location-out",
        "to_port_id": "location-in",
        "relationship_type": "location",
    })
}

// ── Persistence edge cases ─────────────────────────────────────

#[test]
fn multiple_save_cycles() {
    let conn = fresh_conn();
    for cycle in 0..10 {
        let data = TopologyData {
            nodes: vec![TopologyNodePayload {
                id: format!("cycle-{cycle}"),
                node_type: "store".into(),
                name: format!("Cycle {cycle}"),
                subtitle: None,
                x: cycle as f64,
                y: 0.0,
                tier_requirement: None,
                telemetry_badge: None,
                telemetry_status: None,
                metadata: None,
            }],
            wires: vec![],
        };
        let json = serde_json::to_string(&data).unwrap();
        oz_core::Settings::set(&conn, TOPOLOGY_SETTING_KEY, &json).unwrap();
    }
    // Verify only the last cycle persisted.
    let loaded_raw = oz_core::Settings::get(&conn, TOPOLOGY_SETTING_KEY)
        .unwrap()
        .unwrap();
    let loaded: TopologyData = serde_json::from_str(&loaded_raw).unwrap();
    assert_eq!(loaded.nodes.len(), 1);
    assert_eq!(loaded.nodes[0].id, "cycle-9");
}

#[test]
fn save_twice_same_data() {
    let conn = fresh_conn();
    let data = TopologyData {
        nodes: vec![TopologyNodePayload {
            id: "n1".into(),
            node_type: "store".into(),
            name: "Same".into(),
            subtitle: None,
            x: 1.0,
            y: 2.0,
            tier_requirement: None,
            telemetry_badge: None,
            telemetry_status: None,
            metadata: None,
        }],
        wires: vec![],
    };
    let json = serde_json::to_string(&data).unwrap();
    oz_core::Settings::set(&conn, TOPOLOGY_SETTING_KEY, &json).unwrap();
    oz_core::Settings::set(&conn, TOPOLOGY_SETTING_KEY, &json).unwrap();

    let loaded_raw = oz_core::Settings::get(&conn, TOPOLOGY_SETTING_KEY)
        .unwrap()
        .unwrap();
    let loaded: TopologyData = serde_json::from_str(&loaded_raw).unwrap();
    assert_eq!(loaded.nodes.len(), 1);
    assert_eq!(loaded.nodes[0].id, "n1");
}

#[test]
fn save_overwrites_with_larger_data() {
    let conn = fresh_conn();

    // Small first.
    let small = TopologyData {
        nodes: vec![],
        wires: vec![],
    };
    oz_core::Settings::set(
        &conn,
        TOPOLOGY_SETTING_KEY,
        &serde_json::to_string(&small).unwrap(),
    )
    .unwrap();

    // Large second.
    let large = TopologyData {
        nodes: (0..500)
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
            .collect(),
        wires: vec![],
    };
    oz_core::Settings::set(
        &conn,
        TOPOLOGY_SETTING_KEY,
        &serde_json::to_string(&large).unwrap(),
    )
    .unwrap();

    let loaded_raw = oz_core::Settings::get(&conn, TOPOLOGY_SETTING_KEY)
        .unwrap()
        .unwrap();
    let loaded: TopologyData = serde_json::from_str(&loaded_raw).unwrap();
    assert_eq!(loaded.nodes.len(), 500);
}

#[test]
fn fresh_conn_different_key_returns_none() {
    let conn = fresh_conn();
    let result = oz_core::Settings::get(&conn, "oz-pos/some-other-key").unwrap();
    assert!(result.is_none());
}

#[test]
fn topology_key_does_not_interfere_with_other_settings() {
    let conn = fresh_conn();
    oz_core::Settings::set(&conn, "oz-pos/custom-key", "custom_value").unwrap();

    // Topology key remains empty.
    let topo = oz_core::Settings::get(&conn, TOPOLOGY_SETTING_KEY).unwrap();
    assert!(topo.is_none());

    // Other key still readable.
    let other = oz_core::Settings::get(&conn, "oz-pos/custom-key").unwrap();
    assert_eq!(other.as_deref(), Some("custom_value"));
}

#[test]
fn roundtrip_preserves_json_order() {
    let json = r#"{"nodes":[{"id":"n1","type":"store","name":"Order Test","x":10,"y":20}],"wires":[{"id":"w1","from_node_id":"n1","to_node_id":"n2","direction":"one-way"}]}"#;
    let data: TopologyData = serde_json::from_str(json).unwrap();
    let serialized = serde_json::to_string(&data).unwrap();
    // Re-parse and verify structure (not byte equality since serde may reorder).
    let reparsed: TopologyData = serde_json::from_str(&serialized).unwrap();
    assert_eq!(reparsed.nodes.len(), 1);
    assert_eq!(reparsed.nodes[0].id, "n1");
}

// ── Cross-field interaction tests ──────────────────────────────

#[test]
fn multiple_wires_between_same_nodes() {
    let data = TopologyData {
        nodes: vec![
            TopologyNodePayload {
                id: "a".into(),
                node_type: "store".into(),
                name: "A".into(),
                subtitle: None,
                x: 0.0,
                y: 0.0,
                tier_requirement: None,
                telemetry_badge: None,
                telemetry_status: None,
                metadata: None,
            },
            TopologyNodePayload {
                id: "b".into(),
                node_type: "workspace".into(),
                name: "B".into(),
                subtitle: None,
                x: 100.0,
                y: 0.0,
                tier_requirement: None,
                telemetry_badge: None,
                telemetry_status: None,
                metadata: None,
            },
        ],
        wires: (0..5)
            .map(|i| TopologyWirePayload {
                id: format!("w-{i}"),
                from_node_id: "a".into(),
                to_node_id: "b".into(),
                direction: if i % 2 == 0 {
                    "one-way".into()
                } else {
                    "two-way".into()
                },
                label: Some(format!("connection {i}")),
                from_port: None,
                to_port: None,
            })
            .collect(),
    };
    let json = serde_json::to_string(&data).unwrap();
    let roundtripped: TopologyData = serde_json::from_str(&json).unwrap();
    assert_eq!(roundtripped.wires.len(), 5);
    assert_eq!(roundtripped.wires[0].from_node_id, "a");
    assert_eq!(roundtripped.wires[4].to_node_id, "b");
}

#[test]
fn mixed_node_types_preserved_through_save() {
    let conn = fresh_conn();
    let types = ["store", "workspace", "warehouse", "hardware"];
    let nodes: Vec<TopologyNodePayload> = types
        .iter()
        .enumerate()
        .map(|(i, t)| TopologyNodePayload {
            id: format!("{t}-{i}"),
            node_type: (*t).into(),
            name: format!("{t} #{i}"),
            subtitle: None,
            x: (i * 100) as f64,
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

    assert_eq!(
        loaded
            .nodes
            .iter()
            .map(|n| n.node_type.clone())
            .collect::<Vec<_>>(),
        types.iter().map(|t| NodeType::from(*t)).collect::<Vec<_>>(),
    );
}

#[test]
fn node_with_telemetry_status_but_no_badge() {
    let json =
        r#"{"id":"n1","type":"hardware","name":"Sensor","x":0,"y":0,"telemetry_status":"offline"}"#;
    let node: TopologyNodePayload = serde_json::from_str(json).unwrap();
    assert_eq!(node.telemetry_status.as_deref(), Some("offline"));
    assert!(node.telemetry_badge.is_none());
}

#[test]
fn node_with_telemetry_badge_but_no_status() {
    let json =
        r#"{"id":"n1","type":"hardware","name":"Sensor","x":0,"y":0,"telemetry_badge":"Online"}"#;
    let node: TopologyNodePayload = serde_json::from_str(json).unwrap();
    assert_eq!(node.telemetry_badge.as_deref(), Some("Online"));
    assert!(node.telemetry_status.is_none());
}

// ── Trait implementation tests ─────────────────────────────────

#[test]
fn node_payload_implements_debug() {
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
        metadata: None,
    };
    let debug = format!("{node:?}");
    assert!(debug.contains("n1"));
    assert!(debug.contains("Store"));
}

#[test]
fn wire_payload_implements_debug() {
    let wire = TopologyWirePayload {
        id: "w1".into(),
        from_node_id: "a".into(),
        to_node_id: "b".into(),
        direction: "one-way".into(),
        label: None,
        from_port: None,
        to_port: None,
    };
    let debug = format!("{wire:?}");
    assert!(debug.contains("w1"));
    assert!(debug.contains("from_node_id"));
}

#[test]
fn topology_data_implements_debug_and_clone() {
    let data = TopologyData {
        nodes: vec![],
        wires: vec![],
    };
    let _cloned = data.clone();
    let debug = format!("{data:?}");
    assert!(debug.contains("nodes"));
    assert!(debug.contains("wires"));
}

#[test]
fn default_direction_is_consistent() {
    for _ in 0..100 {
        assert_eq!(default_direction(), "one-way");
    }
}

#[test]
fn topology_key_is_correct_format() {
    assert!(TOPOLOGY_SETTING_KEY.starts_with("oz-pos/"));
    assert!(TOPOLOGY_SETTING_KEY.contains("topology"));
    assert!(!TOPOLOGY_SETTING_KEY.is_empty());
}

// ── Partial / incremental save patterns ────────────────────────

#[test]
fn save_only_nodes_empty_wires() {
    let conn = fresh_conn();
    let data = TopologyData {
        nodes: vec![TopologyNodePayload {
            id: "n1".into(),
            node_type: "store".into(),
            name: "Nodes Only".into(),
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
        &serde_json::to_string(&data).unwrap(),
    )
    .unwrap();
    let loaded_raw = oz_core::Settings::get(&conn, TOPOLOGY_SETTING_KEY)
        .unwrap()
        .unwrap();
    let loaded: TopologyData = serde_json::from_str(&loaded_raw).unwrap();
    assert_eq!(loaded.nodes.len(), 1);
    assert!(loaded.wires.is_empty());
}

#[test]
fn save_only_wires_empty_nodes() {
    let conn = fresh_conn();
    let data = TopologyData {
        nodes: vec![],
        wires: vec![TopologyWirePayload {
            id: "orphan-wire".into(),
            from_node_id: "ghost".into(),
            to_node_id: "ghost".into(),
            direction: "one-way".into(),
            label: None,
            from_port: None,
            to_port: None,
        }],
    };
    oz_core::Settings::set(
        &conn,
        TOPOLOGY_SETTING_KEY,
        &serde_json::to_string(&data).unwrap(),
    )
    .unwrap();
    let loaded_raw = oz_core::Settings::get(&conn, TOPOLOGY_SETTING_KEY)
        .unwrap()
        .unwrap();
    let loaded: TopologyData = serde_json::from_str(&loaded_raw).unwrap();
    assert!(loaded.nodes.is_empty());
    assert_eq!(loaded.wires.len(), 1);
}

#[test]
fn roundtrip_preserves_tier_and_telemetry_independently() {
    let scenarios = [
        (
            Some("premium".into()),
            Some("Online".into()),
            Some("online".into()),
        ),
        (Some("standard".into()), None, Some("warning".into())),
        (None, Some("Offline".into()), Some("offline".into())),
        (None, None, None),
    ];
    for (tier, badge, status) in &scenarios {
        let node = TopologyNodePayload {
            id: "n1".into(),
            node_type: "store".into(),
            name: "Scenario".into(),
            subtitle: None,
            x: 0.0,
            y: 0.0,
            tier_requirement: tier.clone(),
            telemetry_badge: badge.clone(),
            telemetry_status: status.clone(),
            metadata: None,
        };
        let json = serde_json::to_string(&node).unwrap();
        let roundtripped: TopologyNodePayload = serde_json::from_str(&json).unwrap();
        assert_eq!(roundtripped.tier_requirement, *tier);
        assert_eq!(roundtripped.telemetry_badge, *badge);
        assert_eq!(roundtripped.telemetry_status, *status);
    }
}

#[test]
fn roundtrip_preserves_subtitle_independent_of_other_fields() {
    let node = TopologyNodePayload {
        id: "n1".into(),
        node_type: "store".into(),
        name: "Test".into(),
        subtitle: Some("standalone-subtitle".into()),
        x: 0.0,
        y: 0.0,
        tier_requirement: None,
        telemetry_badge: None,
        telemetry_status: None,
        metadata: None,
    };
    let json = serde_json::to_string(&node).unwrap();
    let roundtripped: TopologyNodePayload = serde_json::from_str(&json).unwrap();
    assert_eq!(
        roundtripped.subtitle.as_deref(),
        Some("standalone-subtitle")
    );
}

#[test]
fn runtime_plan_excludes_location_wires_and_unknown_endpoints() {
    // The runtime manifest carries only operational (non-location) routes.
    // Location ownership edges are diagram-only; they must never be
    // compiled into the runtime routing artifact. Wires whose endpoints
    // dangle (reference node ids not present in the payload) must also be
    // filtered out rather than emitted with empty instance ids.
    let nodes = vec![
        semantic_node("branch", "branch-location", Some("default")),
        semantic_node("resto-pos", "workspace", None),
        semantic_node("kds", "workspace", None),
    ];
    let wires = vec![
        semantic_location_wire("wire-location", "resto-pos"),
        serde_json::json!({
            "id": "wire-op",
            "from_node_id": "resto-pos",
            "to_node_id": "kds",
            "direction": "one-way",
            "from_port_id": "operation-out",
            "to_port_id": "operation-in",
            "relationship_type": "generic",
        }),
        serde_json::json!({
            "id": "wire-dangling",
            "from_node_id": "ghost-node",
            "to_node_id": "kds",
            "direction": "one-way",
            "from_port_id": "operation-out",
            "to_port_id": "operation-in",
            "relationship_type": "generic",
        }),
    ];

    let plan = compile_topology_runtime_plan(&nodes, &wires, Some("default".to_string()));
    assert_eq!(plan["schema_version"], TOPOLOGY_SCHEMA_VERSION);
    assert_eq!(plan["branch_id"], "default");
    let routes = plan["routes"].as_array().unwrap();
    assert_eq!(
        routes.len(),
        1,
        "only the valid operational wire should be compiled; location and dangling wires must be excluded"
    );
    assert_eq!(routes[0]["wire_id"], "wire-op");
    assert_eq!(routes[0]["source_instance_id"], "resto-pos");
    assert_eq!(routes[0]["target_instance_id"], "kds");
    assert_eq!(routes[0]["from_port_id"], "operation-out");
    assert_eq!(routes[0]["to_port_id"], "operation-in");
    assert_eq!(routes[0]["relationship_type"], "generic");
    assert_eq!(routes[0]["target_node_kind"], "workspace");
}

#[test]
fn runtime_plan_carries_target_node_kind_and_branch_id() {
    // The manifest's target_node_kind is resolved from the target node's
    // `type` field — consumers use it to decide routing behaviour without
    // re-parsing the diagram. A branch-scoped plan must echo the branch id.
    let nodes = vec![
        semantic_node("branch", "branch-location", Some("b1")),
        semantic_node("resto", "workspace", None),
        serde_json::json!({
            "id": "wh",
            "type": "warehouse",
            "name": "WH",
            "x": 0.0,
            "y": 0.0,
        }),
    ];
    let wires = vec![
        semantic_location_wire("loc", "resto"),
        serde_json::json!({
            "id": "stock-wire",
            "from_node_id": "resto",
            "to_node_id": "wh",
            "direction": "one-way",
            "from_port_id": "stock-out",
            "to_port_id": "stock-in",
            "relationship_type": "stock-routing",
        }),
    ];

    let plan = compile_topology_runtime_plan(&nodes, &wires, Some("b1".to_string()));
    assert_eq!(plan["branch_id"], "b1");
    let routes = plan["routes"].as_array().unwrap();
    assert_eq!(routes.len(), 1);
    assert_eq!(routes[0]["target_node_kind"], "warehouse");
    assert_eq!(routes[0]["relationship_type"], "stock-routing");
}

#[test]
fn runtime_plan_unscoped_has_null_branch_and_filters_non_operational() {
    // Unscoped plans (branch_id = None) serialize branch_id as JSON null.
    // Only relationship types other than "location" are operational.
    let nodes = vec![
        semantic_node("branch", "branch-location", Some("default")),
        semantic_node("ws", "workspace", None),
    ];
    let wires = vec![
        semantic_location_wire("loc", "ws"),
        serde_json::json!({
            "id": "op",
            "from_node_id": "ws",
            "to_node_id": "branch",
            "direction": "one-way",
            "from_port_id": "op-out",
            "to_port_id": "op-in",
            "relationship_type": "generic",
        }),
    ];
    let plan = compile_topology_runtime_plan(&nodes, &wires, None);
    assert!(plan["branch_id"].is_null());
    let routes = plan["routes"].as_array().unwrap();
    assert_eq!(routes.len(), 1);
    assert_eq!(routes[0]["wire_id"], "op");
}

#[test]
fn runtime_setting_key_unscoped_returns_base_key() {
    // When the topology key has no branch suffix (legacy unscoped path),
    // the runtime key must resolve to the base constant — no branch id
    // appended.
    let key = topology_runtime_setting_key(TOPOLOGY_SETTING_KEY).unwrap();
    assert_eq!(key, TOPOLOGY_RUNTIME_SETTING_KEY);
}

#[test]
fn runtime_setting_key_branch_scoped_appends_branch_id() {
    // A branch-scoped topology key "oz-pos/topology/{branch}" must map to
    // "oz-pos/topology-runtime/{branch}".
    let key = topology_runtime_setting_key("oz-pos/topology/default").unwrap();
    assert_eq!(key, "oz-pos/topology-runtime/default");

    let key = topology_runtime_setting_key("oz-pos/topology/my-branch-42").unwrap();
    assert_eq!(key, "oz-pos/topology-runtime/my-branch-42");
}

#[test]
fn runtime_setting_key_rejects_arbitrary_key_without_prefix() {
    // Any key that is not the base topology key and lacks the prefix must
    // fail — a corrupted or mismatched key must not silently resolve.
    let err = topology_runtime_setting_key("some/other/key");
    assert!(err.is_err(), "arbitrary key must fail");
}

#[test]
fn runtime_setting_key_rejects_empty_branch_suffix() {
    // "oz-pos/topology/" (trailing slash, empty branch) must not resolve
    // to "oz-pos/topology-runtime/" — empty suffix is an invalid topology
    // key (topology_setting_key rejects it), so the runtime resolver must
    // also reject it.
    let err = topology_runtime_setting_key("oz-pos/topology/");
    assert!(err.is_err(), "empty branch suffix must fail");
}

// ── ADR #45 §4.2: diagram templates in persisted storage ────────────

#[test]
fn template_roundtrips_under_its_branch_key() {
    let conn = fresh_conn();
    let topo = topology_setting_key(Some("main")).unwrap();
    let payload = serde_json::json!({ "nodes": [{"id": "store-1"}], "wires": [] });

    template_save(&conn, &topo, "Weekend Setup", &payload).unwrap();
    let loaded = template_load(&conn, &topo, "Weekend Setup").unwrap();

    assert_eq!(loaded, Some(payload));
}

#[test]
fn template_is_stored_in_the_settings_table_not_browser_storage() {
    // The defect this section fixes is loss: a localStorage template vanishes on
    // a device change, a profile switch, or a reinstall, and the list simply
    // comes back empty with nothing to show for it. Proof of the fix is that
    // the bytes land in the same durable table the diagram itself uses.
    let conn = fresh_conn();
    let topo = topology_setting_key(Some("main")).unwrap();
    template_save(&conn, &topo, "Setup", &serde_json::json!({"nodes": []})).unwrap();

    let raw = oz_core::Settings::get(&conn, &template_setting_key(&topo, "Setup")).unwrap();
    assert!(raw.is_some(), "template must live in settings");
}

#[test]
fn template_name_is_trimmed_on_save_and_matches_on_lookup() {
    // The UI passes what the merchant typed; padding must not create a second
    // template that the list shows twice.
    let conn = fresh_conn();
    let topo = topology_setting_key(Some("main")).unwrap();
    let payload = serde_json::json!({ "nodes": [], "wires": [] });

    template_save(&conn, &topo, "  Opening  ", &payload).unwrap();

    assert_eq!(
        template_load(&conn, &topo, "Opening").unwrap(),
        Some(payload)
    );
    assert_eq!(
        template_list(&conn, &topo).unwrap(),
        vec!["Opening".to_string()]
    );
}

#[test]
fn saving_the_same_name_again_replaces_rather_than_duplicates() {
    let conn = fresh_conn();
    let topo = topology_setting_key(Some("main")).unwrap();
    template_save(&conn, &topo, "Setup", &serde_json::json!({"v": 1})).unwrap();
    template_save(&conn, &topo, "Setup", &serde_json::json!({"v": 2})).unwrap();

    assert_eq!(
        template_load(&conn, &topo, "Setup").unwrap(),
        Some(serde_json::json!({"v": 2}))
    );
    assert_eq!(template_list(&conn, &topo).unwrap().len(), 1);
}

#[test]
fn template_list_is_scoped_to_its_branch() {
    // Templates belong to a branch. A shared list would seed branch B with
    // branch A's layout, which is the drift ADR #34's one-root rule exists to
    // prevent.
    let conn = fresh_conn();
    let main = topology_setting_key(Some("main")).unwrap();
    let uptown = topology_setting_key(Some("uptown")).unwrap();

    template_save(&conn, &main, "Main Only", &serde_json::json!({"n": 1})).unwrap();
    template_save(&conn, &uptown, "Uptown Only", &serde_json::json!({"n": 2})).unwrap();

    assert_eq!(
        template_list(&conn, &main).unwrap(),
        vec!["Main Only".to_string()]
    );
    assert_eq!(
        template_list(&conn, &uptown).unwrap(),
        vec!["Uptown Only".to_string()]
    );
    assert_eq!(template_load(&conn, &main, "Uptown Only").unwrap(), None);
}

#[test]
fn template_list_does_not_see_the_diagram_or_runtime_plan() {
    // A branch's diagram lives at `.../topology/main` and its runtime plan at
    // `.../topology-runtime/main`. Neither may surface as a template name.
    let conn = fresh_conn();
    let topo = topology_setting_key(Some("main")).unwrap();
    save_topology_json_at_key_with_revision(
        &conn,
        vec![],
        vec![],
        &topo,
        &[],
        None,
        None,
        None,
        None,
    )
    .unwrap();
    let runtime_key = topology_runtime_setting_key(&topo).unwrap();
    oz_core::Settings::set(&conn, &runtime_key, "{}").unwrap();

    assert!(template_list(&conn, &topo).unwrap().is_empty());
}

#[test]
fn template_list_is_sorted_for_a_stable_panel() {
    let conn = fresh_conn();
    let topo = topology_setting_key(Some("main")).unwrap();
    for name in ["zulu", "Alpha", "mike"] {
        template_save(&conn, &topo, name, &serde_json::json!({})).unwrap();
    }
    assert_eq!(
        template_list(&conn, &topo).unwrap(),
        vec!["Alpha".to_string(), "mike".to_string(), "zulu".to_string()]
    );
}

#[test]
fn deleting_a_template_removes_it_and_reports_whether_it_existed() {
    let conn = fresh_conn();
    let topo = topology_setting_key(Some("main")).unwrap();
    template_save(&conn, &topo, "Temp", &serde_json::json!({})).unwrap();

    assert!(template_delete(&conn, &topo, "Temp").unwrap());
    assert_eq!(template_load(&conn, &topo, "Temp").unwrap(), None);
    assert!(template_list(&conn, &topo).unwrap().is_empty());
    // A second delete reports "there was nothing to delete" rather than erroring,
    // so a double-click in the panel cannot surface a stack trace.
    assert!(!template_delete(&conn, &topo, "Temp").unwrap());
}

#[test]
fn corrupt_template_reads_as_absent_instead_of_failing() {
    // The list is built from keys, so one unreadable row must not brick the
    // whole panel — the merchant keeps access to their other templates.
    let conn = fresh_conn();
    let topo = topology_setting_key(Some("main")).unwrap();
    oz_core::Settings::set(&conn, &template_setting_key(&topo, "Broken"), "{not json").unwrap();

    assert_eq!(template_load(&conn, &topo, "Broken").unwrap(), None);
    assert_eq!(
        template_list(&conn, &topo).unwrap(),
        vec!["Broken".to_string()]
    );
}

#[test]
fn invalid_template_names_are_rejected_at_the_boundary() {
    let conn = fresh_conn();
    let topo = topology_setting_key(Some("main")).unwrap();
    for bad in ["", "   ", "a/b", "a\\b", "x\u{0}y"] {
        assert!(
            template_save(&conn, &topo, bad, &serde_json::json!({})).is_err(),
            "name {bad:?} must not be storable"
        );
    }
    assert!(template_list(&conn, &topo).unwrap().is_empty());
}

#[test]
fn a_nested_template_key_is_not_listed_as_a_name() {
    // Defensive: if an older build or a hand-written row ever produced
    // `.../template/a/b`, listing must not report "a/b" as one selectable name
    // that load can never round-trip (normalize rejects the slash).
    let conn = fresh_conn();
    let topo = topology_setting_key(Some("main")).unwrap();
    oz_core::Settings::set(&conn, &format!("{topo}/template/a/b"), "{}").unwrap();
    template_save(&conn, &topo, "Good", &serde_json::json!({})).unwrap();

    assert_eq!(
        template_list(&conn, &topo).unwrap(),
        vec!["Good".to_string()]
    );
}
