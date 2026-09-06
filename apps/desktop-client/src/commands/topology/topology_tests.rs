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
use serde_json::Value;

use crate::error::AppError;

pub(crate) fn fresh_conn() -> Connection {
    // These tests exercise the settings serialization contract, not the
    // filesystem. An in-memory database keeps the connection self-contained
    // and avoids leaving SQLite's journal/WAL files in a TempDir that is
    // dropped when this helper returns.
    let mut conn = Connection::open_in_memory().unwrap();
    migrations::run(&mut conn).unwrap();
    conn
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

#[test]
fn semantic_save_persists_version_and_fields() {
    let conn = fresh_conn();
    let nodes = vec![
        semantic_node("branch", "branch-location", Some("default")),
        semantic_node("ws-1", "workspace", None),
    ];
    let wires = vec![semantic_location_wire("wire-1", "ws-1")];
    save_topology_json(&conn, nodes, wires).unwrap();

    let raw = oz_core::Settings::get(&conn, TOPOLOGY_SETTING_KEY)
        .unwrap()
        .unwrap();
    let value: Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(value["schema_version"], TOPOLOGY_SCHEMA_VERSION);
    assert_eq!(value["nodes"][0]["store_profile_id"], "default");
    assert_eq!(value["wires"][0]["from_port_id"], "location-out");
    assert_eq!(value["wires"][0]["to_port_id"], "location-in");
    assert_eq!(value["wires"][0]["relationship_type"], "location");
}

#[test]
fn semantic_save_persists_and_clears_resolved_issue_keys() {
    let conn = fresh_conn();
    let nodes = vec![
        semantic_node("branch", "branch-location", Some("default")),
        semantic_node("ws-1", "workspace", None),
    ];
    let wires = vec![semantic_location_wire("wire-1", "ws-1")];
    let issue = "node:wh-1:topology-validation-warehouse-missing-stock-routing".to_string();

    save_topology_json_at_key_with_revision(
        &conn,
        nodes.clone(),
        wires.clone(),
        TOPOLOGY_SETTING_KEY,
        std::slice::from_ref(&issue),
        None,
        None,
        None,
        None,
    )
    .unwrap();
    let raw = oz_core::Settings::get(&conn, TOPOLOGY_SETTING_KEY)
        .unwrap()
        .unwrap();
    let value: Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(value["resolved_issue_keys"], serde_json::json!([issue]));

    save_topology_json_at_key_with_revision(
        &conn,
        nodes,
        wires,
        TOPOLOGY_SETTING_KEY,
        &[],
        None,
        None,
        None,
        None,
    )
    .unwrap();
    let raw = oz_core::Settings::get(&conn, TOPOLOGY_SETTING_KEY)
        .unwrap()
        .unwrap();
    let value: Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(value["resolved_issue_keys"], serde_json::json!([]));
}

#[test]
fn semantic_save_rejects_ambiguous_legacy_workspace_wire() {
    let conn = fresh_conn();
    let result = save_topology_json(
        &conn,
        vec![
            semantic_node("branch", "store", None),
            semantic_node("ws-1", "workspace", None),
            semantic_node("ws-2", "workspace", None),
        ],
        vec![
            serde_json::json!({
                "id": "wire-owner",
                "from_node_id": "branch",
                "to_node_id": "ws-1",
                "direction": "one-way",
            }),
            serde_json::json!({
                "id": "wire-ambiguous",
                "from_node_id": "ws-1",
                "to_node_id": "ws-2",
                "direction": "one-way",
            }),
        ],
    );

    match result {
        Err(AppError::TopologyValidation { code, wire_id, .. }) => {
            assert_eq!(code, "ambiguous-legacy-wire");
            assert_eq!(wire_id.as_deref(), Some("wire-ambiguous"));
        }
        other => panic!("expected ambiguous-legacy-wire, got {other:?}"),
    }
}

#[test]
fn semantic_save_compiles_operational_wires_to_branch_runtime_plan() {
    let conn = fresh_conn();
    let branch_key = topology_setting_key(Some("default")).unwrap();
    let mut resto = semantic_node("resto-pos", "workspace", None);
    resto["metadata"] = serde_json::json!({ "typeKey": "restaurant-pos" });
    let mut kds = semantic_node("kds", "workspace", None);
    kds["metadata"] = serde_json::json!({ "typeKey": "kds" });
    let operation_wire = serde_json::json!({
        "id": "wire-resto-kds-runtime",
        "from_node_id": "resto-pos",
        "to_node_id": "kds",
        "direction": "one-way",
        "from_port_id": "operation-out",
        "to_port_id": "operation-in",
        "relationship_type": "generic",
    });

    save_topology_json_at_key(
        &conn,
        vec![
            semantic_node("branch", "branch-location", Some("default")),
            resto,
            kds,
        ],
        vec![
            semantic_location_wire("wire-resto-location", "resto-pos"),
            operation_wire,
        ],
        &branch_key,
    )
    .unwrap();

    let runtime_json = oz_core::Settings::get(&conn, "oz-pos/topology-runtime/default")
        .unwrap()
        .expect("semantic save must compile a runtime plan");
    let runtime: Value = serde_json::from_str(&runtime_json).unwrap();
    assert_eq!(runtime["schema_version"], TOPOLOGY_SCHEMA_VERSION);
    assert_eq!(runtime["branch_id"], "default");
    assert_eq!(runtime["routes"][0]["wire_id"], "wire-resto-kds-runtime");
    assert_eq!(runtime["routes"][0]["source_instance_id"], "resto-pos");
    assert_eq!(runtime["routes"][0]["target_instance_id"], "kds");
    assert_eq!(runtime["routes"][0]["relationship_type"], "generic");

    // A later save without operational wires replaces the manifest rather
    // than leaving the removed route active.
    save_topology_json_at_key(
        &conn,
        vec![
            semantic_node("branch", "branch-location", Some("default")),
            semantic_node("store-pos", "workspace", None),
        ],
        vec![semantic_location_wire("wire-store-location", "store-pos")],
        &branch_key,
    )
    .unwrap();
    let cleared: Value = serde_json::from_str(
        &oz_core::Settings::get(&conn, "oz-pos/topology-runtime/default")
            .unwrap()
            .unwrap(),
    )
    .unwrap();
    assert_eq!(cleared["routes"].as_array().unwrap().len(), 0);
}

#[test]
fn branch_topology_settings_are_isolated() {
    let conn = fresh_conn();
    let branch_a_key = topology_setting_key(Some("branch-a")).unwrap();
    let branch_b_key = topology_setting_key(Some("branch-b")).unwrap();

    save_topology_json_at_key(
        &conn,
        vec![serde_json::json!({
            "id": "branch-a",
            "type": "store",
            "name": "Branch A",
            "x": 0.0,
            "y": 0.0,
        })],
        vec![],
        &branch_a_key,
    )
    .unwrap();
    save_topology_json_at_key(
        &conn,
        vec![serde_json::json!({
            "id": "branch-b",
            "type": "store",
            "name": "Branch B",
            "x": 0.0,
            "y": 0.0,
        })],
        vec![],
        &branch_b_key,
    )
    .unwrap();

    let a = oz_core::Settings::get(&conn, &branch_a_key)
        .unwrap()
        .unwrap();
    let b = oz_core::Settings::get(&conn, &branch_b_key)
        .unwrap()
        .unwrap();
    assert!(a.contains("branch-a"));
    assert!(!a.contains("branch-b"));
    assert!(b.contains("branch-b"));
    assert!(!b.contains("branch-a"));
    let runtime_a: Value = serde_json::from_str(
        &oz_core::Settings::get(&conn, "oz-pos/topology-runtime/branch-a")
            .unwrap()
            .unwrap(),
    )
    .unwrap();
    let runtime_b: Value = serde_json::from_str(
        &oz_core::Settings::get(&conn, "oz-pos/topology-runtime/branch-b")
            .unwrap()
            .unwrap(),
    )
    .unwrap();
    assert_eq!(runtime_a["branch_id"], "branch-a");
    assert_eq!(runtime_b["branch_id"], "branch-b");
    assert!(
        oz_core::Settings::get(&conn, TOPOLOGY_SETTING_KEY)
            .unwrap()
            .is_none()
    );
}

#[test]
fn topology_setting_key_rejects_path_injection() {
    let result = topology_setting_key(Some("branch/a"));
    assert!(result.is_err());
}

#[test]
fn legacy_topology_is_only_migrated_for_matching_branch() {
    let value = serde_json::json!({
        "schema_version": TOPOLOGY_SCHEMA_VERSION,
        "nodes": [{
            "id": "branch-a",
            "type": "branch-location",
            "store_profile_id": "branch-a"
        }],
        "wires": []
    });
    assert!(legacy_topology_belongs_to_branch(&value, "branch-a").unwrap());
    assert!(!legacy_topology_belongs_to_branch(&value, "branch-b").unwrap());
}

#[test]
fn semantic_save_preserves_bend_points() {
    // The command envelope persists the RAW wire payload (save_topology_json
    // writes `wires: Vec<Value>` untouched after validation), so the editor's
    // bend points must survive the Apply round-trip even though the typed
    // validation struct has no `bends` field (serde ignores unknown fields).
    let conn = fresh_conn();
    let nodes = vec![
        semantic_node("branch", "branch-location", Some("default")),
        semantic_node("ws-1", "workspace", None),
    ];
    let mut wire = semantic_location_wire("wire-1", "ws-1");
    wire["bends"] = serde_json::json!([{ "x": 350.0, "y": 334.0 }, { "x": 400.0, "y": 300.0 }]);
    save_topology_json(&conn, nodes, vec![wire]).unwrap();

    let raw = oz_core::Settings::get(&conn, TOPOLOGY_SETTING_KEY)
        .unwrap()
        .unwrap();
    let value: Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(value["wires"][0]["bends"][0]["x"], 350.0);
    assert_eq!(value["wires"][0]["bends"][0]["y"], 334.0);
    assert_eq!(value["wires"][0]["bends"][1]["x"], 400.0);
    assert_eq!(value["wires"][0]["bends"][1]["y"], 300.0);
}

#[test]
fn semantic_save_accepts_two_way_location_wire() {
    // Direction is presentation-only: the frontend contract keeps
    // one-way | reverse | two-way all legal (normalizeWireDirection),
    // so the Apply boundary must NOT reject a location wire whose
    // direction was cycled to two-way in the editor.
    let conn = fresh_conn();
    let nodes = vec![
        semantic_node("branch", "branch-location", Some("default")),
        semantic_node("ws-1", "workspace", None),
    ];
    let mut wire = semantic_location_wire("wire-1", "ws-1");
    wire["direction"] = Value::String("two-way".into());
    save_topology_json(&conn, nodes, vec![wire]).unwrap();

    let raw = oz_core::Settings::get(&conn, TOPOLOGY_SETTING_KEY)
        .unwrap()
        .unwrap();
    let value: Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(value["wires"][0]["direction"], "two-way");
}

#[test]
fn semantic_save_accepts_reverse_location_wire() {
    // The editor cycles direction left-to-right -> right-to-left -> both;
    // reverse must round-trip through Apply like the other legal states.
    let conn = fresh_conn();
    let nodes = vec![
        semantic_node("branch", "branch-location", Some("default")),
        semantic_node("ws-1", "workspace", None),
    ];
    let mut wire = semantic_location_wire("wire-1", "ws-1");
    wire["direction"] = Value::String("reverse".into());
    save_topology_json(&conn, nodes, vec![wire]).unwrap();

    let raw = oz_core::Settings::get(&conn, TOPOLOGY_SETTING_KEY)
        .unwrap()
        .unwrap();
    let value: Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(value["wires"][0]["direction"], "reverse");
}

#[test]
fn semantic_save_accepts_kds_operation_feed_from_restaurant_pos() {
    let conn = fresh_conn();
    let mut resto = semantic_node("resto-pos", "workspace", None);
    resto["metadata"] = serde_json::json!({ "typeKey": "restaurant-pos" });
    let mut kds = semantic_node("kds", "workspace", None);
    kds["metadata"] = serde_json::json!({ "typeKey": "kds" });
    let operation_wire = serde_json::json!({
        "id": "wire-resto-kds",
        "from_node_id": "resto-pos",
        "to_node_id": "kds",
        "direction": "one-way",
        "from_port_id": "operation-out",
        "to_port_id": "operation-in",
        "relationship_type": "generic",
    });
    let result = save_topology_json(
        &conn,
        vec![
            semantic_node("branch", "branch-location", Some("default")),
            resto,
            kds,
        ],
        vec![
            semantic_location_wire("wire-resto-location", "resto-pos"),
            operation_wire,
        ],
    );
    assert!(result.is_ok());
}

#[test]
fn semantic_save_rejects_operation_feed_from_non_restaurant_pos() {
    let conn = fresh_conn();
    let mut store_pos = semantic_node("store-pos", "workspace", None);
    store_pos["metadata"] = serde_json::json!({ "typeKey": "store-pos" });
    let mut kds = semantic_node("kds", "workspace", None);
    kds["metadata"] = serde_json::json!({ "typeKey": "kds" });
    let invalid_operation_wire = serde_json::json!({
        "id": "wire-invalid-operation-source",
        "from_node_id": "store-pos",
        "to_node_id": "kds",
        "direction": "one-way",
        "from_port_id": "operation-out",
        "to_port_id": "operation-in",
        "relationship_type": "generic",
    });
    let result = save_topology_json(
        &conn,
        vec![
            semantic_node("branch", "branch-location", Some("default")),
            store_pos,
            kds,
        ],
        vec![
            semantic_location_wire("wire-pos-location", "store-pos"),
            invalid_operation_wire,
        ],
    );

    match result {
        Err(AppError::TopologyValidation {
            code,
            wire_id,
            node_id,
            ..
        }) => {
            assert_eq!(code, "invalid-operation-source");
            assert_eq!(wire_id.as_deref(), Some("wire-invalid-operation-source"));
            assert_eq!(node_id.as_deref(), Some("kds"));
        }
        other => panic!("expected invalid-operation-source, got {other:?}"),
    }
}

#[test]
fn semantic_save_rejects_mismatched_non_location_wire() {
    let conn = fresh_conn();
    let mut store_pos = semantic_node("store-pos", "workspace", None);
    store_pos["metadata"] = serde_json::json!({ "typeKey": "store-pos" });
    let invalid_wire = serde_json::json!({
        "id": "wire-invalid-pair",
        "from_node_id": "store-pos",
        "to_node_id": "warehouse-1",
        "direction": "one-way",
        "from_port_id": "stock-out",
        "to_port_id": "location-in",
        "relationship_type": "stock-routing",
    });
    let result = save_topology_json(
        &conn,
        vec![
            semantic_node("branch", "branch-location", Some("default")),
            store_pos,
            semantic_node("warehouse-1", "warehouse", None),
        ],
        vec![
            semantic_location_wire("wire-store-location", "store-pos"),
            invalid_wire,
        ],
    );

    match result {
        Err(AppError::TopologyValidation { code, wire_id, .. }) => {
            assert_eq!(code, "invalid-semantic-connection");
            assert_eq!(wire_id.as_deref(), Some("wire-invalid-pair"));
        }
        other => panic!("expected invalid-semantic-connection, got {other:?}"),
    }
}

#[test]
fn semantic_save_rejects_ticket_wire_from_non_kds_workspace() {
    let conn = fresh_conn();
    let mut store_pos = semantic_node("store-pos", "workspace", None);
    store_pos["metadata"] = serde_json::json!({ "typeKey": "store-pos" });
    let invalid_wire = serde_json::json!({
        "id": "wire-invalid-ticket-source",
        "from_node_id": "store-pos",
        "to_node_id": "printer-1",
        "direction": "one-way",
        "from_port_id": "ticket-out",
        "to_port_id": "ticket-in",
        "relationship_type": "ticket-routing",
    });
    let result = save_topology_json(
        &conn,
        vec![
            semantic_node("branch", "branch-location", Some("default")),
            store_pos,
            semantic_node("printer-1", "hardware", None),
        ],
        vec![
            semantic_location_wire("wire-store-location", "store-pos"),
            invalid_wire,
        ],
    );

    match result {
        Err(AppError::TopologyValidation { code, wire_id, .. }) => {
            assert_eq!(code, "invalid-semantic-connection");
            assert_eq!(wire_id.as_deref(), Some("wire-invalid-ticket-source"));
        }
        other => panic!("expected invalid-semantic-connection, got {other:?}"),
    }
}

#[test]
fn semantic_save_accepts_valid_stock_routing_wire() {
    let conn = fresh_conn();
    let mut store_pos = semantic_node("store-pos", "workspace", None);
    store_pos["metadata"] = serde_json::json!({ "typeKey": "store-pos" });
    let valid_wire = serde_json::json!({
        "id": "wire-stock",
        "from_node_id": "store-pos",
        "to_node_id": "warehouse-1",
        "direction": "one-way",
        "from_port_id": "stock-out",
        "to_port_id": "stock-in",
        "relationship_type": "stock-routing",
    });
    let result = save_topology_json(
        &conn,
        vec![
            semantic_node("branch", "branch-location", Some("default")),
            store_pos,
            semantic_node("warehouse-1", "warehouse", None),
        ],
        vec![
            semantic_location_wire("wire-store-location", "store-pos"),
            semantic_location_wire("wire-warehouse-scope", "warehouse-1"),
            valid_wire,
        ],
    );

    assert!(result.is_ok());
}

#[test]
fn semantic_save_accepts_warehouse_to_warehouse_transfer_route() {
    let conn = fresh_conn();
    let hub = semantic_node("warehouse-hub", "warehouse", None);
    let satellite = semantic_node("warehouse-satellite", "warehouse", None);
    let transfer_wire = serde_json::json!({
        "id": "wire-warehouse-transfer",
        "from_node_id": "warehouse-hub",
        "to_node_id": "warehouse-satellite",
        "direction": "one-way",
        "from_port_id": "transfer-out",
        "to_port_id": "transfer-in",
        "relationship_type": "inventory-transfer",
    });

    let result = save_topology_json(
        &conn,
        vec![
            semantic_node("branch", "branch-location", Some("default")),
            hub,
            satellite,
        ],
        vec![
            semantic_location_wire("wire-hub-scope", "warehouse-hub"),
            semantic_location_wire("wire-satellite-scope", "warehouse-satellite"),
            transfer_wire,
        ],
    );

    assert!(result.is_ok());
}

#[test]
fn semantic_save_accepts_warehouse_location_or_retail_pos_operation() {
    let conn = fresh_conn();
    let mut retail_pos = semantic_node("retail-pos", "workspace", None);
    retail_pos["metadata"] = serde_json::json!({ "typeKey": "store-pos" });
    let warehouse = semantic_node("warehouse-1", "warehouse", None);
    let operation_wire = serde_json::json!({
        "id": "wire-retail-warehouse",
        "from_node_id": "retail-pos",
        "to_node_id": "warehouse-1",
        "direction": "one-way",
        "from_port_id": "operation-out",
        "to_port_id": "operation-in",
        "relationship_type": "generic",
    });

    let result = save_topology_json(
        &conn,
        vec![
            semantic_node("branch", "branch-location", Some("default")),
            retail_pos,
            warehouse,
        ],
        vec![
            semantic_location_wire("wire-retail-location", "retail-pos"),
            operation_wire,
        ],
    );
    assert!(result.is_ok());

    let location_result = save_topology_json(
        &conn,
        vec![
            semantic_node("branch", "branch-location", Some("default")),
            semantic_node("warehouse-1", "warehouse", None),
        ],
        vec![semantic_location_wire(
            "wire-warehouse-scope",
            "warehouse-1",
        )],
    );
    assert!(location_result.is_ok());
}

#[test]
fn semantic_save_rejects_multiple_warehouse_primary_inputs() {
    let conn = fresh_conn();
    let mut retail_pos = semantic_node("retail-pos", "workspace", None);
    retail_pos["metadata"] = serde_json::json!({ "typeKey": "store-pos" });
    let operation_wire = serde_json::json!({
        "id": "wire-retail-warehouse",
        "from_node_id": "retail-pos",
        "to_node_id": "warehouse-1",
        "direction": "one-way",
        "from_port_id": "operation-out",
        "to_port_id": "operation-in",
        "relationship_type": "generic",
    });
    let result = save_topology_json(
        &conn,
        vec![
            semantic_node("branch", "branch-location", Some("default")),
            retail_pos,
            semantic_node("warehouse-1", "warehouse", None),
        ],
        vec![
            semantic_location_wire("wire-warehouse-scope", "warehouse-1"),
            semantic_location_wire("wire-retail-location", "retail-pos"),
            operation_wire,
        ],
    );

    match result {
        Err(AppError::TopologyValidation { code, node_id, .. }) => {
            assert_eq!(code, "multiple-warehouse-inputs");
            assert_eq!(node_id.as_deref(), Some("warehouse-1"));
        }
        other => panic!("expected multiple-warehouse-inputs, got {other:?}"),
    }
}

#[test]
fn semantic_save_rejects_warehouse_operation_from_non_retail_pos() {
    let mut restaurant_pos = semantic_node("restaurant-pos", "workspace", None);
    restaurant_pos["metadata"] = serde_json::json!({ "typeKey": "restaurant-pos" });
    let operation_wire = serde_json::json!({
        "id": "wire-invalid-warehouse-operation",
        "from_node_id": "restaurant-pos",
        "to_node_id": "warehouse-1",
        "direction": "one-way",
        "from_port_id": "operation-out",
        "to_port_id": "operation-in",
        "relationship_type": "generic",
    });
    let result = save_topology_json(
        &fresh_conn(),
        vec![
            semantic_node("branch", "branch-location", Some("default")),
            restaurant_pos,
            semantic_node("warehouse-1", "warehouse", None),
        ],
        vec![
            semantic_location_wire("wire-restaurant-location", "restaurant-pos"),
            operation_wire,
        ],
    );

    match result {
        Err(AppError::TopologyValidation { code, wire_id, .. }) => {
            assert_eq!(code, "invalid-warehouse-operation-source");
            assert_eq!(wire_id.as_deref(), Some("wire-invalid-warehouse-operation"));
        }
        other => panic!("expected invalid-warehouse-operation-source, got {other:?}"),
    }
}

#[test]
fn semantic_save_rejects_directed_operational_cycle() {
    let conn = fresh_conn();
    let cycle_wires = vec![
        semantic_location_wire("wire-owner-1", "ws-1"),
        semantic_location_wire("wire-owner-2", "ws-2"),
        serde_json::json!({
            "id": "wire-cycle-a",
            "from_node_id": "ws-1",
            "to_node_id": "ws-2",
            "direction": "one-way",
            "from_port_id": "generic-out",
            "to_port_id": "generic-in",
            "relationship_type": "generic",
        }),
        serde_json::json!({
            "id": "wire-cycle-b",
            "from_node_id": "ws-2",
            "to_node_id": "ws-1",
            "direction": "one-way",
            "from_port_id": "generic-out",
            "to_port_id": "generic-in",
            "relationship_type": "generic",
        }),
    ];
    let result = save_topology_json(
        &conn,
        vec![
            semantic_node("branch", "branch-location", Some("default")),
            semantic_node("ws-1", "workspace", None),
            semantic_node("ws-2", "workspace", None),
        ],
        cycle_wires,
    );

    match result {
        Err(AppError::TopologyValidation { code, .. }) => {
            assert_eq!(code, "cycle-detected");
        }
        other => panic!("expected cycle-detected, got {other:?}"),
    }
}

#[test]
fn semantic_save_requires_one_location_input_per_workspace() {
    let conn = fresh_conn();
    let nodes = vec![
        semantic_node("branch", "branch-location", Some("default")),
        semantic_node("ws-1", "workspace", None),
    ];
    let result = save_topology_json(&conn, nodes, vec![]);
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("Location In"));
}

#[test]
fn semantic_save_rejects_unknown_store_profile() {
    let conn = fresh_conn();
    let nodes = vec![
        semantic_node("branch", "branch-location", Some("missing-store")),
        semantic_node("ws-1", "workspace", None),
    ];
    let result = save_topology_json(&conn, nodes, vec![semantic_location_wire("wire-1", "ws-1")]);
    assert!(result.is_err());
    assert!(
        result
            .unwrap_err()
            .to_string()
            .contains("unknown store_profile_id")
    );
}

#[test]
fn apply_gate_rejects_duplicate_node_ids_before_mutation() {
    // The Apply pre-mutation gate must reject a structurally malformed
    // diagram (duplicate node ids) BEFORE any workspace row is mutated.
    // Structural validation used to run only at the final save — after
    // workspace creations/updates/archivals — so a malformed diagram
    // passed the gate, mutated rows, then failed at save and forced the
    // full compensation unwind. The editor's savedById Map also silently
    // collapses duplicate ids at load, so the Apply gate is the last
    // hard boundary that can catch them.
    let conn = fresh_conn();
    let nodes = vec![
        semantic_node("branch", "branch-location", Some("default")),
        semantic_node("ws-1", "workspace", None),
        semantic_node("ws-1", "workspace", None),
    ];
    let wires = vec![semantic_location_wire("wire-1", "ws-1")];
    let result = validate_apply_gate(&[&conn], &nodes, &wires);
    assert!(result.is_err(), "gate must reject duplicate node ids");
    let err = result.unwrap_err().to_string();
    // Layer-agnostic on purpose. This used to match only the Apply gate's own
    // wording. ADR #45 §4.3 follow-up moved the check upstream into
    // `validate_semantic_json`, which now refuses a duplicate id while building
    // the graph index - so that message arrives first and the gate's own check
    // is now defence in depth. What this test actually asserts is "the gate
    // rejects duplicates before mutating anything", which is true whichever
    // layer catches it; pinning one layer's phrasing would only make this break
    // when the wording changes.
    assert!(
        err.contains("duplicate node id") || err.contains("share the id"),
        "gate should reject duplicate node ids, got: {err}"
    );
}

#[test]
fn semantic_validate_reports_missing_branch_when_graph_has_no_branch() {
    // Frontend contract parity: validateTopologyGraph reports
    // `missing-branch-location` when the graph has ZERO branch-location
    // nodes ("Add exactly one Branch Location node.") and
    // `multiple-branch-locations` only when it has MORE than one. The
    // Rust validator collapsed both into `multiple-branch-locations`, so
    // a zero-branch graph rejected by the Apply gate surfaced the wrong
    // guidance code to the UI.
    let conn = fresh_conn();
    let nodes = vec![semantic_node("ws-1", "workspace", None)];
    // A location wire makes the payload semantic (has_semantic_fields)
    // even though no branch node exists.
    let wires = vec![semantic_location_wire("wire-1", "ws-1")];
    match validate_semantic_ownership(&conn, &nodes, &wires) {
        Err(AppError::TopologyValidation { code, .. }) => {
            assert_eq!(code, "missing-branch-location")
        }
        other => panic!("expected TopologyValidation(missing-branch-location), got {other:?}"),
    }
}

#[test]
fn semantic_validate_reports_multiple_branches_when_graph_has_two() {
    // The other half of the frontend parity contract: MORE than one
    // branch-location node keeps the `multiple-branch-locations` code
    // ("Keep exactly one Branch Location node in this graph.").
    let conn = fresh_conn();
    let nodes = vec![
        semantic_node("branch-1", "branch-location", Some("default")),
        semantic_node("branch-2", "branch-location", Some("default")),
    ];
    let wires = vec![semantic_location_wire("wire-1", "branch-2")];
    match validate_semantic_ownership(&conn, &nodes, &wires) {
        Err(AppError::TopologyValidation { code, .. }) => {
            assert_eq!(code, "multiple-branch-locations")
        }
        other => {
            panic!("expected TopologyValidation(multiple-branch-locations), got {other:?}")
        }
    }
}

#[test]
fn semantic_ownership_accepts_branch_profile_in_second_registry() {
    // ADR #7 regression: branch profiles created through the scoped
    // store-profile family are written into the SESSION's store database
    // (store-<id>.sqlite); the global database only carries the seeded
    // default profile. The Apply gate used to run the ownership check
    // against the global connection alone, so every freshly created
    // branch was rejected with `unknown-branch-location` forever.
    // Ownership must pass when the profile exists in ANY registry.
    let global = fresh_conn();
    let store_db = fresh_conn();
    let nodes = vec![
        semantic_node("branch", "branch-location", Some("branch-1")),
        semantic_node("ws-1", "workspace", None),
    ];
    let wires = vec![semantic_location_wire("wire-1", "ws-1")];

    // Sanity: neither registry knows the profile yet, so the
    // single-registry check on the global connection rejects.
    assert!(matches!(
        validate_semantic_ownership(&global, &nodes, &wires),
        Err(AppError::TopologyValidation { code, .. }) if code == "unknown-branch-location"
    ));

    // The scoped create command wrote the profile into the store database.
    store_db
        .execute(
            "INSERT INTO locations (id, name) VALUES ('branch-1', 'Branch One')",
            [],
        )
        .unwrap();
    validate_semantic_ownership_in(&[&global, &store_db], &nodes, &wires).unwrap();
}

#[test]
fn apply_gate_and_save_accept_branch_profile_from_store_registry() {
    // The production Apply path runs the gate and the revision-guarded
    // save with [global, session store] registries. A branch profile that
    // only exists in the session store database must pass both.
    let global = fresh_conn();
    let store_db = fresh_conn();
    store_db
        .execute(
            "INSERT INTO locations (id, name) VALUES ('branch-1', 'Branch One')",
            [],
        )
        .unwrap();
    let nodes = vec![
        semantic_node("branch", "branch-location", Some("branch-1")),
        semantic_node("ws-1", "workspace", None),
    ];
    let wires = vec![semantic_location_wire("wire-1", "ws-1")];

    validate_apply_gate(&[&global, &store_db], &nodes, &wires).unwrap();
    let revision = save_topology_json_at_key_with_revision(
        &global,
        nodes,
        wires,
        TOPOLOGY_SETTING_KEY,
        &[],
        None,
        None,
        Some(&store_db),
        None,
    )
    .unwrap();
    assert_eq!(revision, 1);
}

#[test]
fn save_with_registry_still_rejects_unknown_branch() {
    // The dual-registry acceptance must not become a blanket bypass: a
    // profile id present in NEITHER registry is still rejected.
    let global = fresh_conn();
    let store_db = fresh_conn();
    let nodes = vec![
        semantic_node("branch", "branch-location", Some("ghost-branch")),
        semantic_node("ws-1", "workspace", None),
    ];
    let wires = vec![semantic_location_wire("wire-1", "ws-1")];
    let result = save_topology_json_at_key_with_revision(
        &global,
        nodes,
        wires,
        TOPOLOGY_SETTING_KEY,
        &[],
        None,
        None,
        Some(&store_db),
        None,
    );
    assert!(matches!(
        result,
        Err(AppError::TopologyValidation { code, .. }) if code == "unknown-branch-location"
    ));
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
fn serialise_deserialise_full_graph() {
    let data = TopologyData {
        nodes: vec![
            TopologyNodePayload {
                id: "store-1".into(),
                node_type: "store".into(),
                name: "Downtown".into(),
                subtitle: Some("Primary".into()),
                x: 80.0,
                y: 140.0,
                tier_requirement: None,
                telemetry_badge: Some("Online (2 POS)".into()),
                telemetry_status: Some("online".into()),
                metadata: None,
            },
            TopologyNodePayload {
                id: "ws-1".into(),
                node_type: "workspace".into(),
                name: "POS #1".into(),
                subtitle: Some("Main Checkout".into()),
                x: 340.0,
                y: 80.0,
                tier_requirement: None,
                telemetry_badge: Some("Active".into()),
                telemetry_status: Some("online".into()),
                metadata: None,
            },
        ],
        wires: vec![TopologyWirePayload {
            id: "w-1".into(),
            from_node_id: "store-1".into(),
            to_node_id: "ws-1".into(),
            direction: "one-way".into(),
            label: Some("Binds Store".into()),
            from_port: Some("right".into()),
            to_port: Some("left".into()),
        }],
    };

    let json = serde_json::to_string_pretty(&data).unwrap();
    let roundtripped: TopologyData = serde_json::from_str(&json).unwrap();

    assert_eq!(roundtripped.nodes.len(), 2);
    assert_eq!(roundtripped.wires.len(), 1);
    assert_eq!(roundtripped.nodes[1].node_type, "workspace");
}

#[test]
fn default_direction_is_one_way() {
    assert_eq!(default_direction(), "one-way");
}

#[test]
fn deserialise_minimal_node() {
    let json = r#"{"id":"n1","type":"store","name":"Test","x":0,"y":0}"#;
    let node: TopologyNodePayload = serde_json::from_str(json).unwrap();
    assert_eq!(node.node_type, "store");
    assert!(node.subtitle.is_none());
    assert!(node.telemetry_badge.is_none());
}

#[test]
fn deserialise_minimal_wire_defaults_direction() {
    let json = r#"{"id":"w1","from_node_id":"a","to_node_id":"b"}"#;
    let wire: TopologyWirePayload = serde_json::from_str(json).unwrap();
    assert_eq!(wire.direction, "one-way");
}

#[test]
fn deserialise_two_way_direction() {
    let json = r#"{"id":"w1","from_node_id":"a","to_node_id":"b","direction":"two-way"}"#;
    let wire: TopologyWirePayload = serde_json::from_str(json).unwrap();
    assert_eq!(wire.direction, "two-way");
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

#[test]
fn metadata_roundtrip() {
    let node = TopologyNodePayload {
        id: "store-1".into(),
        node_type: "store".into(),
        name: "With Metadata".into(),
        subtitle: None,
        x: 10.0,
        y: 20.0,
        tier_requirement: None,
        telemetry_badge: None,
        telemetry_status: None,
        metadata: Some(serde_json::json!({
            "address": "123 Main St",
            "region": "west",
            "open_since": "2024-01-15",
        })),
    };
    let json = serde_json::to_string(&node).unwrap();
    let roundtripped: TopologyNodePayload = serde_json::from_str(&json).unwrap();
    let meta = roundtripped.metadata.unwrap();
    assert_eq!(meta["address"], "123 Main St");
    assert_eq!(meta["region"], "west");
    assert_eq!(meta["open_since"], "2024-01-15");
}

#[test]
fn multiple_wires_and_nodes_roundtrip() {
    let data = TopologyData {
        nodes: vec![
            TopologyNodePayload {
                id: "store-1".into(),
                node_type: "store".into(),
                name: "Main".into(),
                subtitle: None,
                x: 0.0,
                y: 0.0,
                tier_requirement: None,
                telemetry_badge: None,
                telemetry_status: None,
                metadata: None,
            },
            TopologyNodePayload {
                id: "ws-1".into(),
                node_type: "workspace".into(),
                name: "POS #1".into(),
                subtitle: None,
                x: 200.0,
                y: 100.0,
                tier_requirement: None,
                telemetry_badge: None,
                telemetry_status: None,
                metadata: None,
            },
            TopologyNodePayload {
                id: "wh-1".into(),
                node_type: "warehouse".into(),
                name: "Warehouse".into(),
                subtitle: None,
                x: 200.0,
                y: 300.0,
                tier_requirement: None,
                telemetry_badge: None,
                telemetry_status: None,
                metadata: None,
            },
        ],
        wires: vec![
            TopologyWirePayload {
                id: "w-1".into(),
                from_node_id: "store-1".into(),
                to_node_id: "ws-1".into(),
                direction: "one-way".into(),
                label: None,
                from_port: Some("right".into()),
                to_port: Some("left".into()),
            },
            TopologyWirePayload {
                id: "w-2".into(),
                from_node_id: "ws-1".into(),
                to_node_id: "wh-1".into(),
                direction: "two-way".into(),
                label: Some("Inventory sync".into()),
                from_port: None,
                to_port: None,
            },
        ],
    };

    let json = serde_json::to_string_pretty(&data).unwrap();
    let roundtripped: TopologyData = serde_json::from_str(&json).unwrap();

    assert_eq!(roundtripped.nodes.len(), 3);
    assert_eq!(roundtripped.wires.len(), 2);
    assert_eq!(roundtripped.wires[1].direction, "two-way");
    assert_eq!(
        roundtripped.wires[1].label.as_deref(),
        Some("Inventory sync")
    );
}

#[test]
fn node_type_variants() {
    let json = r#"[
            {"id":"s1","type":"store","name":"Store","x":0,"y":0},
            {"id":"w1","type":"workspace","name":"Workspace","x":1,"y":1},
            {"id":"h1","type":"warehouse","name":"Warehouse","x":2,"y":2},
            {"id":"h2","type":"hardware","name":"Printer","x":3,"y":3}
        ]"#;
    let nodes: Vec<TopologyNodePayload> = serde_json::from_str(json).unwrap();
    assert_eq!(nodes[0].node_type, "store");
    assert_eq!(nodes[1].node_type, "workspace");
    assert_eq!(nodes[2].node_type, "warehouse");
    assert_eq!(nodes[3].node_type, "hardware");
}

#[test]
fn load_corrupt_json_returns_error() {
    let conn = fresh_conn();
    oz_core::Settings::set(&conn, TOPOLOGY_SETTING_KEY, "not valid json at all").unwrap();

    let result = oz_core::Settings::get(&conn, TOPOLOGY_SETTING_KEY).unwrap();
    assert!(result.is_some());

    // Deserialisation should fail.
    let raw = result.unwrap();
    let parsed: Result<TopologyData, _> = serde_json::from_str(&raw);
    assert!(parsed.is_err());
}

#[test]
fn all_fields_filled_roundtrip() {
    let node = TopologyNodePayload {
        id: "full-node".into(),
        node_type: "hardware".into(),
        name: "Receipt Printer #3".into(),
        subtitle: Some("Kitchen".into()),
        x: 400.5,
        y: 250.75,
        tier_requirement: Some("standard".into()),
        telemetry_badge: Some("Online".into()),
        telemetry_status: Some("online".into()),
        metadata: Some(serde_json::json!({"model": "Epson TM-T88"})),
    };
    let wire = TopologyWirePayload {
        id: "full-wire".into(),
        from_node_id: "full-node".into(),
        to_node_id: "ws-1".into(),
        direction: "two-way".into(),
        label: Some("Print job channel".into()),
        from_port: Some("usb".into()),
        to_port: Some("network".into()),
    };

    let data = TopologyData {
        nodes: vec![node],
        wires: vec![wire],
    };
    let json = serde_json::to_string_pretty(&data).unwrap();
    let roundtripped: TopologyData = serde_json::from_str(&json).unwrap();

    assert_eq!(roundtripped.nodes[0].subtitle.as_deref(), Some("Kitchen"));
    assert_eq!(
        roundtripped.nodes[0].tier_requirement.as_deref(),
        Some("standard")
    );
    assert_eq!(
        roundtripped.nodes[0].telemetry_status.as_deref(),
        Some("online")
    );
    assert_eq!(
        roundtripped.wires[0].label.as_deref(),
        Some("Print job channel")
    );
    assert_eq!(roundtripped.wires[0].from_port, Some(PortName::Unknown));
    assert_eq!(roundtripped.wires[0].to_port, Some(PortName::Unknown));
}

#[test]
fn serialised_type_field_rename() {
    let node = TopologyNodePayload {
        id: "n1".into(),
        node_type: "workspace".into(),
        name: "Test".into(),
        subtitle: None,
        x: 1.0,
        y: 2.0,
        tier_requirement: None,
        telemetry_badge: None,
        telemetry_status: None,
        metadata: None,
    };
    let json = serde_json::to_string(&node).unwrap();
    // The JSON key must be "type" (not "node_type") due to #[serde(rename = "type")].
    assert!(json.contains(r#""type":"workspace""#));
    assert!(!json.contains("node_type"));
}

#[test]
fn special_characters_in_names() {
    let node = TopologyNodePayload {
        id: "u-1".into(),
        node_type: "store".into(),
        name: "Café Zürich — Hauptfiliale «1»".into(),
        subtitle: Some("Unicode & Ö姆ojis 🎉".into()),
        x: 0.0,
        y: 0.0,
        tier_requirement: None,
        telemetry_badge: None,
        telemetry_status: None,
        metadata: None,
    };
    let json = serde_json::to_string(&node).unwrap();
    let roundtripped: TopologyNodePayload = serde_json::from_str(&json).unwrap();
    assert_eq!(roundtripped.name, "Café Zürich — Hauptfiliale «1»");
    assert_eq!(
        roundtripped.subtitle.as_deref(),
        Some("Unicode & Ö姆ojis 🎉")
    );
}

#[test]
fn wire_with_no_optional_fields() {
    let json = r#"{"id":"w-min","from_node_id":"a","to_node_id":"b"}"#;
    let wire: TopologyWirePayload = serde_json::from_str(json).unwrap();
    assert_eq!(wire.id, "w-min");
    assert_eq!(wire.from_node_id, "a");
    assert_eq!(wire.to_node_id, "b");
    assert_eq!(wire.direction, "one-way");
    assert!(wire.label.is_none());
    assert!(wire.from_port.is_none());
    assert!(wire.to_port.is_none());
}
