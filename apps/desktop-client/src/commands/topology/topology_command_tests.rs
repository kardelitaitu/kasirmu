//! Tauri command + crash-injection tests — command integration, audit follow-ups, validation ordering, atomicity, Apply recovery journal
//!
//! Split from topology_tests.rs (6k-line file) so every file in the
//! commands dir stays under the ~3k-line guideline. `use super::*`
//! resolves the root's flat namespace; `use super::topology_tests::*`
//! shares the module's test helpers (fresh_conn, semantic_node, ...).

use super::topology_tests::*;
use super::*;
use oz_core::db::Store;
use oz_core::migrations;
use oz_core::session::SessionContext;
use serde_json::Value;
use tempfile::tempdir;

use crate::commands::workspaces::CreateInstanceRequest;
use crate::error::AppError;
use crate::state::AppState;
// ── Tauri command integration tests ─────────────────────────────
//
// These tests exercise the `#[tauri::command]` functions through a
// mock Tauri app, covering the lock+delegate bodies that cannot be
// reached via the free functions alone.

use tauri::Manager as _;

fn make_node_cmd(id: &str) -> TopologyNodePayload {
    TopologyNodePayload {
        id: id.into(),
        node_type: "store".into(),
        name: format!("Store {id}"),
        subtitle: None,
        x: 10.0,
        y: 20.0,
        tier_requirement: None,
        telemetry_badge: None,
        telemetry_status: None,
        metadata: None,
    }
}

#[tokio::test]
async fn tauri_save_topology_persists_and_load_returns_it() {
    let state = AppState::for_test();
    {
        let mut conn = state.db.lock().await;
        migrations::run(&mut conn).unwrap();
    }

    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    save_topology(
        vec![serde_json::to_value(make_node_cmd("n1")).unwrap()],
        vec![],
        None,
        app.state(),
    )
    .await
    .unwrap();
    let loaded = load_topology(None, app.state()).await.unwrap();
    assert!(loaded.is_some());
    let data = loaded.unwrap();
    assert_eq!(data["nodes"].as_array().unwrap().len(), 1);
    assert_eq!(data["nodes"][0]["id"], "n1");
    assert!(data["wires"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn tauri_save_topology_overwrites_previous() {
    let state = AppState::for_test();
    {
        let mut conn = state.db.lock().await;
        migrations::run(&mut conn).unwrap();
    }

    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    save_topology(
        vec![serde_json::to_value(make_node_cmd("first")).unwrap()],
        vec![],
        None,
        app.state(),
    )
    .await
    .unwrap();
    save_topology(
        vec![serde_json::to_value(make_node_cmd("second")).unwrap()],
        vec![],
        None,
        app.state(),
    )
    .await
    .unwrap();

    let loaded = load_topology(None, app.state()).await.unwrap().unwrap();
    assert_eq!(loaded["nodes"].as_array().unwrap().len(), 1);
    assert_eq!(loaded["nodes"][0]["id"], "second");
}

#[tokio::test]
async fn tauri_topology_commands_are_branch_scoped() {
    let state = AppState::for_test();
    {
        let mut conn = state.db.lock().await;
        migrations::run(&mut conn).unwrap();
    }

    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    save_topology(
        vec![serde_json::to_value(make_node_cmd("branch-a-node")).unwrap()],
        vec![],
        Some("branch-a".into()),
        app.state(),
    )
    .await
    .unwrap();
    save_topology(
        vec![serde_json::to_value(make_node_cmd("branch-b-node")).unwrap()],
        vec![],
        Some("branch-b".into()),
        app.state(),
    )
    .await
    .unwrap();

    let branch_a = load_topology(Some("branch-a".into()), app.state())
        .await
        .unwrap()
        .unwrap();
    let branch_b = load_topology(Some("branch-b".into()), app.state())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(branch_a["nodes"][0]["id"], "branch-a-node");
    assert_eq!(branch_b["nodes"][0]["id"], "branch-b-node");
}

#[tokio::test]
async fn tauri_load_topology_serves_stored_node_without_display_name_raw() {
    // `name` is display-only: normalizeTopologyGraph never reads it, the
    // editor renders an empty card title, and the user can retype it.
    // The typed shape gate required it (plus x/y) on every stored node,
    // so a single legacy row without `name` bricked the ENTIRE topology
    // at load — the same class of failure the raw-load fixes for corrupt
    // directions and semantic violations were about. The load boundary
    // must serve the row raw so the editor can heal it.
    let state = AppState::for_test();
    {
        let mut conn = state.db.lock().await;
        migrations::run(&mut conn).unwrap();
        oz_core::Settings::set(
                &conn,
                TOPOLOGY_SETTING_KEY,
                r#"{"nodes":[{"id":"store-1","type":"store","x":0,"y":0},{"id":"ws-1","type":"workspace","x":200,"y":0}],"wires":[]}"#,
            )
            .unwrap();
    }

    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    let loaded = load_topology(None, app.state()).await.unwrap().unwrap();
    // Raw passthrough: the nameless node is served intact (the editor
    // renders the card without a title and heals it on the next edit).
    assert!(loaded["nodes"][0].get("name").is_none());
    assert_eq!(loaded["nodes"][1]["id"], "ws-1");
}

#[tokio::test]
async fn tauri_load_topology_returns_none_for_fresh_app() {
    let state = AppState::for_test();
    {
        let mut conn = state.db.lock().await;
        migrations::run(&mut conn).unwrap();
    }

    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    let loaded = load_topology(None, app.state()).await.unwrap();
    assert!(loaded.is_none());
}

#[tokio::test]
async fn tauri_save_topology_with_wires_roundtrips_fully() {
    let state = AppState::for_test();
    {
        let mut conn = state.db.lock().await;
        migrations::run(&mut conn).unwrap();
    }

    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    // The fixture must satisfy the semantic contract (674e41bb): the
    // branch node carries its seeded `default` store_profile_id, ws-1 is a
    // workspace, and the wire declares its deterministic `location`
    // relationship — a bare legacy store→store wire is ambiguous and
    // correctly rejected at the save boundary.
    let nodes = vec![
        serde_json::json!({
            "id": "store-a",
            "type": "store",
            "name": "Store A",
            "x": 0.0,
            "y": 0.0,
            "store_profile_id": "default",
        }),
        serde_json::json!({
            "id": "ws-1",
            "type": "workspace",
            "name": "POS",
            "x": 200.0,
            "y": 0.0,
        }),
    ];
    let wires = vec![serde_json::json!({
        "id": "cmd-w-1",
        "from_node_id": "store-a",
        "to_node_id": "ws-1",
        "direction": "one-way",
        "from_port_id": "location-out",
        "to_port_id": "location-in",
        "relationship_type": "location",
    })];

    save_topology(nodes, wires, None, app.state())
        .await
        .unwrap();
    let loaded = load_topology(None, app.state()).await.unwrap().unwrap();

    assert_eq!(loaded["nodes"].as_array().unwrap().len(), 2);
    assert_eq!(loaded["wires"].as_array().unwrap().len(), 1);
    assert_eq!(loaded["wires"][0]["from_node_id"], "store-a");
    assert_eq!(loaded["wires"][0]["to_node_id"], "ws-1");
}

#[tokio::test]
async fn tauri_load_topology_serves_corrupt_stored_direction_raw() {
    // The frontend contract (normalizeWireDirection) explicitly heals a
    // corrupt stored direction at the editor load path, and the free
    // function load_topology_data is documented raw-by-design ("the load
    // boundary stays raw"). The command must therefore serve the stored
    // value raw so the editor can normalize it — rejecting the whole
    // topology here would brick it: the user could never open the graph
    // to heal the row, and the frontend's healing would be unreachable.
    let state = AppState::for_test();
    {
        let mut conn = state.db.lock().await;
        migrations::run(&mut conn).unwrap();
        oz_core::Settings::set(
                &conn,
                TOPOLOGY_SETTING_KEY,
                r#"{"nodes":[{"id":"store-1","type":"store","name":"Legacy","x":0,"y":0},{"id":"ws-1","type":"workspace","name":"POS","x":200,"y":0}],"wires":[{"id":"w-legacy","from_node_id":"store-1","to_node_id":"ws-1","direction":"bidirectional"}]}"#,
            )
            .unwrap();
    }

    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    let loaded = load_topology(None, app.state()).await.unwrap().unwrap();
    // Raw passthrough: the editor's normalizeWireDirection folds the
    // corrupt value to one-way and heals the row on the next Apply.
    assert_eq!(loaded["wires"][0]["direction"], "bidirectional");
}

#[tokio::test]
async fn tauri_load_topology_serves_semantic_contract_violation_raw() {
    // validate_semantic_ownership at load would brick the whole topology
    // when a stored SEMANTIC graph violates the contract (here: a
    // workspace with no location-in wire -> missing-location-input). The
    // frontend loads raw and surfaces these errors at Apply time
    // (validateTopologyGraph toast in TopologyScreen / NodeTopologyEditor)
    // so the user can repair the graph — load must serve it raw, matching
    // load_topology_data's documented raw-by-design contract.
    let state = AppState::for_test();
    {
        let mut conn = state.db.lock().await;
        migrations::run(&mut conn).unwrap();
        // Semantic fields present (store_profile_id on the branch) but
        // ws-1 has no location-in wire — a missing-location-input
        // violation the editor would surface as a repair prompt.
        oz_core::Settings::set(
                &conn,
                TOPOLOGY_SETTING_KEY,
                r#"{"nodes":[{"id":"branch","type":"branch-location","name":"HQ","x":0,"y":0,"store_profile_id":"default"},{"id":"ws-1","type":"workspace","name":"POS","x":200,"y":0}],"wires":[]}"#,
            )
            .unwrap();
    }

    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    let loaded = load_topology(None, app.state()).await.unwrap().unwrap();
    assert_eq!(loaded["nodes"].as_array().unwrap().len(), 2);
}
// ── Audit follow-up: node-id uniqueness + enum validation + atomicity ─
//
// These tests cover the gaps surfaced by TOPOLOGY_AUDIT (#4, #5, #11)
// and the node-id uniqueness asymmetry found while writing this suite.
// They exercise `save_topology_data` (the free function the
// `apply_topology_diff` command delegates to) and the serde enums
// introduced to fix audit #11.

fn node(id: &str, node_type: &str) -> TopologyNodePayload {
    TopologyNodePayload {
        id: id.into(),
        node_type: node_type.into(),
        name: format!("Node {id}"),
        subtitle: None,
        x: 0.0,
        y: 0.0,
        tier_requirement: None,
        telemetry_badge: None,
        telemetry_status: None,
        metadata: None,
    }
}

fn wire(id: &str, from: &str, to: &str) -> TopologyWirePayload {
    TopologyWirePayload {
        id: id.into(),
        from_node_id: from.into(),
        to_node_id: to.into(),
        direction: "one-way".into(),
        label: None,
        from_port: None,
        to_port: None,
    }
}

// ── #11: enum PartialEq<&str> + From<&str> consistency ───────────

// ── #11: save rejects every Unknown enum variant (fail-closed) ─────

#[test]
fn save_rejects_unknown_node_type_variant() {
    let conn = fresh_conn();
    // Build a node whose type deserialised to Unknown.
    let mut n = node("n1", "store");
    n.node_type = NodeType::Unknown;
    let result = save_topology_data(&conn, vec![n], vec![]);
    assert!(result.is_err());
    let err = result.unwrap_err().to_string();
    assert!(
        err.contains("unknown type"),
        "expected 'unknown type' in error, got: {err}"
    );
    // DB must remain empty — nothing was persisted.
    assert!(load_topology_data(&conn).unwrap().is_none());
}

#[test]
fn save_rejects_unknown_wire_direction_variant() {
    let conn = fresh_conn();
    let mut w = wire("w1", "n1", "n2");
    w.direction = WireDirection::Unknown;
    let result = save_topology_data(
        &conn,
        vec![node("n1", "store"), node("n2", "workspace")],
        vec![w],
    );
    assert!(result.is_err());
    let err = result.unwrap_err().to_string();
    assert!(
        err.contains("unknown direction"),
        "expected 'unknown direction' in error, got: {err}"
    );
    assert!(load_topology_data(&conn).unwrap().is_none());
}

#[test]
fn save_rejects_unknown_from_port_variant() {
    let conn = fresh_conn();
    let mut w = wire("w1", "n1", "n2");
    w.from_port = Some(PortName::Unknown);
    let result = save_topology_data(
        &conn,
        vec![node("n1", "store"), node("n2", "workspace")],
        vec![w],
    );
    assert!(result.is_err());
    let err = result.unwrap_err().to_string();
    assert!(err.contains("unknown port"), "got: {err}");
    assert!(load_topology_data(&conn).unwrap().is_none());
}

#[test]
fn save_rejects_unknown_to_port_variant() {
    let conn = fresh_conn();
    let mut w = wire("w1", "n1", "n2");
    w.to_port = Some(PortName::Unknown);
    let result = save_topology_data(
        &conn,
        vec![node("n1", "store"), node("n2", "workspace")],
        vec![w],
    );
    assert!(result.is_err());
    let err = result.unwrap_err().to_string();
    assert!(err.contains("unknown port"), "got: {err}");
    assert!(load_topology_data(&conn).unwrap().is_none());
}

#[test]
fn save_accepts_all_four_valid_node_types() {
    let conn = fresh_conn();
    let nodes = vec![
        node("s", "store"),
        node("w", "workspace"),
        node("h", "warehouse"),
        node("hw", "hardware"),
    ];
    save_topology_data(&conn, nodes, vec![]).unwrap();
    let loaded = load_topology_data(&conn).unwrap().unwrap();
    assert_eq!(loaded.nodes.len(), 4);
    assert_eq!(loaded.nodes[0].node_type, NodeType::Store);
    assert_eq!(loaded.nodes[1].node_type, NodeType::Workspace);
    assert_eq!(loaded.nodes[2].node_type, NodeType::Warehouse);
    assert_eq!(loaded.nodes[3].node_type, NodeType::Hardware);
}

// ── Bug fix: save_topology_data now rejects duplicate node ids ──────
//
// Previously only wire-id uniqueness was checked. Two nodes sharing an
// id would be accepted, then the `node_ids` HashSet would collapse
// them, making wire endpoint resolution ambiguous.

#[test]
fn save_rejects_duplicate_node_ids() {
    let conn = fresh_conn();
    let nodes = vec![
        node("dup", "store"),
        TopologyNodePayload {
            id: "dup".into(),
            node_type: "workspace".into(),
            ..node("dup", "store")
        },
    ];
    let result = save_topology_data(&conn, nodes, vec![]);
    assert!(result.is_err());
    let err = result.unwrap_err().to_string();
    assert!(
        err.contains("duplicate node id"),
        "expected 'duplicate node id' in error, got: {err}"
    );
    // Nothing persisted.
    assert!(load_topology_data(&conn).unwrap().is_none());
}

#[test]
fn save_rejects_duplicate_node_ids_with_valid_wires() {
    let conn = fresh_conn();
    // Two nodes share "n1"; a wire between them is otherwise valid.
    let nodes = vec![
        node("n1", "store"),
        TopologyNodePayload {
            id: "n1".into(),
            node_type: "workspace".into(),
            ..node("n1", "store")
        },
    ];
    let wires = vec![wire("w1", "n1", "n1")];
    let result = save_topology_data(&conn, nodes, wires);
    assert!(result.is_err());
    assert!(
        result
            .unwrap_err()
            .to_string()
            .contains("duplicate node id")
    );
    assert!(load_topology_data(&conn).unwrap().is_none());
}

// ── Transaction integrity: failed validation must not poison DB ────

#[test]
fn failed_save_does_not_overwrite_existing_topology() {
    let conn = fresh_conn();
    // Seed a valid topology.
    save_topology_data(&conn, vec![node("good", "store")], vec![]).unwrap();
    assert_eq!(load_topology_data(&conn).unwrap().unwrap().nodes.len(), 1);

    // Attempt a save that fails validation (duplicate node id).
    let bad = vec![node("dup", "store"), node("dup", "workspace")];
    let result = save_topology_data(&conn, bad, vec![]);
    assert!(result.is_err());

    // The pre-existing good topology must be intact.
    let loaded = load_topology_data(&conn).unwrap().unwrap();
    assert_eq!(loaded.nodes.len(), 1);
    assert_eq!(loaded.nodes[0].id, "good");
}

#[test]
fn failed_save_due_to_bad_wire_leaves_existing_topology_intact() {
    let conn = fresh_conn();
    save_topology_data(&conn, vec![node("keep", "store")], vec![]).unwrap();

    // Wire references a node that isn't in the new node list.
    let result = save_topology_data(
        &conn,
        vec![node("other", "workspace")],
        vec![wire("w1", "other", "ghost")],
    );
    assert!(result.is_err());
    // Original topology preserved.
    let loaded = load_topology_data(&conn).unwrap().unwrap();
    assert_eq!(loaded.nodes.len(), 1);
    assert_eq!(loaded.nodes[0].id, "keep");
}

// ── Validation ordering: node checks run before wire checks ────────

#[test]
fn duplicate_node_id_error_takes_precedence_over_wire_errors() {
    let conn = fresh_conn();
    // Both a duplicate node id AND an orphan wire are present.
    // Node-id uniqueness is checked first, so the error must mention
    // the node, not the wire.
    let nodes = vec![node("dup", "store"), node("dup", "workspace")];
    let wires = vec![wire("w1", "ghost", "alsoghost")];
    let result = save_topology_data(&conn, nodes, wires);
    assert!(result.is_err());
    let err = result.unwrap_err().to_string();
    assert!(
        err.contains("duplicate node id"),
        "node-id check must run first, got: {err}"
    );
    assert!(!err.contains("from_node_id"));
}

// ── Round-trip of the full enum surface through the DB ─────────────

#[test]
fn all_valid_directions_and_ports_roundtrip_through_db() {
    let conn = fresh_conn();
    let nodes = vec![node("a", "store"), node("b", "workspace")];
    let wires = vec![
        TopologyWirePayload {
            id: "w1".into(),
            from_node_id: "a".into(),
            to_node_id: "b".into(),
            direction: "one-way".into(),
            label: None,
            from_port: Some("right".into()),
            to_port: Some("left".into()),
        },
        TopologyWirePayload {
            id: "w2".into(),
            from_node_id: "a".into(),
            to_node_id: "b".into(),
            direction: "two-way".into(),
            label: None,
            from_port: Some("top".into()),
            to_port: Some("bottom".into()),
        },
    ];
    save_topology_data(&conn, nodes, wires).unwrap();
    let loaded = load_topology_data(&conn).unwrap().unwrap();
    assert_eq!(loaded.wires.len(), 2);
    assert_eq!(loaded.wires[0].direction, WireDirection::OneWay);
    assert_eq!(loaded.wires[0].from_port, Some(PortName::Right));
    assert_eq!(loaded.wires[0].to_port, Some(PortName::Left));
    assert_eq!(loaded.wires[1].direction, WireDirection::TwoWay);
    assert_eq!(loaded.wires[1].from_port, Some(PortName::Top));
    assert_eq!(loaded.wires[1].to_port, Some(PortName::Bottom));
}

// ── Backward-compat: load coerces legacy unknown values, save rejects ─

#[test]
fn legacy_unknown_node_type_loads_as_unknown_then_save_rejects() {
    let conn = fresh_conn();
    // Hand-edited legacy JSON with an unknown type.
    let legacy = r#"{"nodes":[{"id":"n1","type":"foo","name":"Legacy","x":0,"y":0}],"wires":[]}"#;
    oz_core::Settings::set(&conn, TOPOLOGY_SETTING_KEY, legacy).unwrap();

    // Load coerces to Unknown (does not error — backward compat).
    let loaded = load_topology_data(&conn).unwrap().unwrap();
    assert_eq!(loaded.nodes[0].node_type, NodeType::Unknown);

    // Re-saving must fail-closed.
    let result = save_topology_data(&conn, loaded.nodes, loaded.wires);
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("unknown type"));
}

#[test]
fn legacy_unknown_direction_loads_then_save_rejects() {
    let conn = fresh_conn();
    let legacy = r#"{"nodes":[{"id":"a","type":"store","name":"A","x":0,"y":0},
                                  {"id":"b","type":"workspace","name":"B","x":1,"y":1}],
                          "wires":[{"id":"w1","from_node_id":"a","to_node_id":"b","direction":"sideways"}]}"#;
    oz_core::Settings::set(&conn, TOPOLOGY_SETTING_KEY, legacy).unwrap();
    let loaded = load_topology_data(&conn).unwrap().unwrap();
    assert_eq!(loaded.wires[0].direction, WireDirection::Unknown);
    let result = save_topology_data(&conn, loaded.nodes, loaded.wires);
    assert!(result.is_err());
    assert!(
        result
            .unwrap_err()
            .to_string()
            .contains("unknown direction")
    );
}

// ── Empty-string ids are still accepted (no spurious rejection) ────

#[test]
fn save_accepts_empty_node_id_when_unique() {
    let conn = fresh_conn();
    // A single empty-id node is unusual but not ambiguous; only
    // duplicates should be rejected.
    let mut n = node("", "store");
    n.id = String::new();
    save_topology_data(&conn, vec![n], vec![]).unwrap();
    let loaded = load_topology_data(&conn).unwrap().unwrap();
    assert_eq!(loaded.nodes.len(), 1);
    assert!(loaded.nodes[0].id.is_empty());
}

// ── Save is idempotent: identical data saves twice without drift ───

#[test]
fn identical_save_twice_produces_same_loaded_state() {
    let conn = fresh_conn();
    let nodes = vec![
        node("a", "store"),
        node("b", "workspace"),
        node("c", "warehouse"),
    ];
    let wires = vec![wire("w1", "a", "b"), wire("w2", "b", "c")];
    save_topology_data(&conn, nodes.clone(), wires.clone()).unwrap();
    let first = load_topology_data(&conn).unwrap().unwrap();
    save_topology_data(&conn, nodes, wires).unwrap();
    let second = load_topology_data(&conn).unwrap().unwrap();
    assert_eq!(first.nodes.len(), second.nodes.len());
    assert_eq!(first.wires.len(), second.wires.len());
    assert_eq!(second.nodes[0].id, "a");
    assert_eq!(second.wires[1].from_node_id, "b");
}

// ── Atomicity: a single save is all-or-nothing on validation ───────
//
// If any element fails validation, nothing in the batch persists.

#[test]
fn save_with_mixed_valid_and_invalid_data_persists_neither() {
    let conn = fresh_conn();
    // One valid node + one invalid (unknown type). The whole batch
    // must be rejected — no partial persistence.
    let nodes = vec![node("ok", "store"), {
        let mut n = node("bad", "store");
        n.node_type = NodeType::Unknown;
        n
    }];
    let result = save_topology_data(&conn, nodes, vec![]);
    assert!(result.is_err());
    // Neither the valid nor the invalid node was persisted.
    assert!(load_topology_data(&conn).unwrap().is_none());
}

// ── Wire self-reference is allowed (a node can wire to itself) ─────

#[test]
fn save_allows_self_referential_wire() {
    let conn = fresh_conn();
    let nodes = vec![node("n1", "store")];
    let wires = vec![wire("self", "n1", "n1")];
    save_topology_data(&conn, nodes, wires).unwrap();
    let loaded = load_topology_data(&conn).unwrap().unwrap();
    assert_eq!(loaded.wires.len(), 1);
    assert_eq!(loaded.wires[0].from_node_id, "n1");
    assert_eq!(loaded.wires[0].to_node_id, "n1");
}

// ── Large valid graph passes all validation in one save ───────────

#[test]
fn large_valid_graph_with_wires_passes_validation() {
    let conn = fresh_conn();
    let nodes: Vec<TopologyNodePayload> =
        (0..200).map(|i| node(&format!("n-{i}"), "store")).collect();
    let wires: Vec<TopologyWirePayload> = (0..199)
        .map(|i| {
            wire(
                &format!("w-{i}"),
                &format!("n-{i}"),
                &format!("n-{}", i + 1),
            )
        })
        .collect();
    save_topology_data(&conn, nodes, wires).unwrap();
    let loaded = load_topology_data(&conn).unwrap().unwrap();
    assert_eq!(loaded.nodes.len(), 200);
    assert_eq!(loaded.wires.len(), 199);
    // Chain integrity: wire i connects n-i → n-(i+1).
    for i in 0..199 {
        assert_eq!(loaded.wires[i].from_node_id, format!("n-{i}"));
        assert_eq!(loaded.wires[i].to_node_id, format!("n-{}", i + 1));
    }
}

// ── One bad wire in a large batch rejects the entire batch ─────────

#[test]
fn one_orphan_wire_in_large_batch_rejects_all() {
    let conn = fresh_conn();
    let nodes: Vec<TopologyNodePayload> =
        (0..100).map(|i| node(&format!("n-{i}"), "store")).collect();
    let mut wires: Vec<TopologyWirePayload> = (0..99)
        .map(|i| {
            wire(
                &format!("w-{i}"),
                &format!("n-{i}"),
                &format!("n-{}", i + 1),
            )
        })
        .collect();
    // Append one wire referencing a non-existent node.
    wires.push(wire("bad", "n-0", "ghost"));
    let result = save_topology_data(&conn, nodes, wires);
    assert!(result.is_err());
    assert!(
        result
            .unwrap_err()
            .to_string()
            .contains("unknown to_node_id")
    );
    // Nothing persisted.
    assert!(load_topology_data(&conn).unwrap().is_none());
}
// ── Wire direction / port serialization edge cases (#10, #11) ──

#[test]
fn save_topology_data_rejects_wire_with_unknown_direction() {
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
        id: "w1".into(),
        from_node_id: "n1".into(),
        to_node_id: "n1".into(),
        direction: WireDirection::Unknown,
        label: None,
        from_port: None,
        to_port: None,
    }];
    let result = save_topology_data(&conn, nodes, wires);
    assert!(result.is_err());
    let err = result.unwrap_err().to_string();
    assert!(err.contains("unknown direction"));
}

// ── Diagram metadata persistence (#1 follow-up) ───────────────

#[test]
fn diagram_node_with_persisted_metadata_roundtrips() {
    let conn = fresh_conn();
    let node = TopologyNodePayload {
        id: "ws-diagram".into(),
        node_type: "workspace".into(),
        name: "Diagrammed POS".into(),
        subtitle: None,
        x: 340.0,
        y: 80.0,
        tier_requirement: None,
        telemetry_badge: None,
        telemetry_status: None,
        metadata: Some(serde_json::json!({
            "typeKey": "kds",
            "persisted": true
        })),
    };
    save_topology_data(&conn, vec![node], vec![]).unwrap();
    let loaded = load_topology_data(&conn).unwrap().unwrap();
    assert_eq!(loaded.nodes.len(), 1);
    let meta = loaded.nodes[0].metadata.as_ref().unwrap();
    assert_eq!(meta["typeKey"], "kds");
    assert_eq!(meta["persisted"], true);
}

#[test]
fn diagram_node_without_persisted_metadata_roundtrips() {
    let conn = fresh_conn();
    // A freshly-added workspace node — not yet persisted to workspace_instances
    let node = TopologyNodePayload {
        id: "ws-draft".into(),
        node_type: "workspace".into(),
        name: "Draft POS".into(),
        subtitle: None,
        x: 340.0,
        y: 80.0,
        tier_requirement: None,
        telemetry_badge: None,
        telemetry_status: None,
        metadata: Some(serde_json::json!({
            "typeKey": "store-pos",
            "persisted": false
        })),
    };
    save_topology_data(&conn, vec![node], vec![]).unwrap();
    let loaded = load_topology_data(&conn).unwrap().unwrap();
    let meta = loaded.nodes[0].metadata.as_ref().unwrap();
    assert_eq!(meta["persisted"], false);
    assert_eq!(meta["typeKey"], "store-pos");
}

// ── Crash-injection: Apply recovery journal ──────────────────────
//
// `apply_topology_diff` writes a durable recovery journal BEFORE the
// store transaction, then commits the store, then saves the global
// topology (clearing the journal atomically inside the save tx). A
// process crash can therefore leave the system in one of three on-disk
// states; each test below constructs the exact state a crash would
// leave behind and asserts `recover_pending_topology_apply` heals to
// the correct end state. The journal is the only durable record of an
// interrupted cross-database Apply, so this contract is safety-critical.

/// Build an AppState whose global DB is migrated and whose store DBs
/// live in an isolated temp dir (mirrors the production layout). The
/// TempDir is returned so it outlives the state's lazy store opens.
fn state_with_store() -> (tempfile::TempDir, AppState) {
    let dir = tempdir().unwrap();
    let global = oz_core::migrations::fresh_db();
    let mut state = AppState::for_test_with_conn(global);
    state.db_manager =
        platform_core::StoreDatabaseManager::new(dir.path().to_path_buf(), migrations::ALL);
    (dir, state)
}

fn crash_creation(store_id: &str, id: &str) -> CreateInstanceRequest {
    CreateInstanceRequest {
        id: id.into(),
        type_key: "pos".into(),
        store_id: store_id.into(),
        name: format!("Crash {id}"),
        purpose_key: Some("general".into()),
        description: None,
        colour: None,
    }
}

/// Commit the exact INSERT the Apply store transaction performs, so the
/// store DB byte-matches the state a crash after the store commit would
/// leave behind.
fn commit_creation_to_store(state: &AppState, creation: &CreateInstanceRequest) {
    let store_conn = state.db_manager.open_store(&creation.store_id).unwrap();
    let store = store_conn.lock().unwrap();
    let tx = store.unchecked_transaction().unwrap();
    // The store DB seeds its own `locations` row when provisioned;
    // the workspace FKs require both it and the type row before any
    // instance can be inserted.
    tx.execute(
        "INSERT OR IGNORE INTO locations (id, name) VALUES (?1, ?2)",
        rusqlite::params![creation.store_id, "Test Store"],
    )
    .unwrap();
    tx.execute(
        "INSERT OR IGNORE INTO workspace_types \
             (key, name, description, layout_mode, icon, sort_order, accent_colour) \
             VALUES ('pos', 'POS', '', 'fullscreen', '', 0, '')",
        [],
    )
    .unwrap();
    tx.execute(
        "INSERT INTO workspace_instances \
             (id, type_key, location_id, name, description, colour, purpose_key, status, \
              last_accessed_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'active', \
                     strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
        rusqlite::params![
            creation.id,
            creation.type_key,
            creation.store_id,
            creation.name,
            creation.description.as_deref().unwrap_or(""),
            creation.colour.as_deref(),
            creation.purpose_key.as_deref().unwrap_or("general"),
        ],
    )
    .unwrap();
    tx.commit().unwrap();
}

fn store_has_instance(state: &AppState, store_id: &str, id: &str) -> bool {
    let store_conn = state.db_manager.open_store(store_id).unwrap();
    let store = store_conn.lock().unwrap();
    let count: i64 = store
        .query_row(
            "SELECT COUNT(*) FROM workspace_instances WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get(0),
        )
        .unwrap();
    count > 0
}

#[tokio::test]
async fn crash_before_store_commit_heals_to_exact_prior_state() {
    // Crash point 1: journal persisted, store transaction never began.
    // Recovery must be a no-op on both databases — no compensation
    // damage, previous topology restored, journal cleared.
    let store_id = "store-crash-1";
    let (_dir, state) = state_with_store();
    let previous = topology_envelope_json(&[], &[], 0, &[]).unwrap();
    let desired = topology_envelope_json(&[], &[], 1, &[]).unwrap();
    let creation = crash_creation(store_id, "ws-crash-1");
    {
        let db = state.db.lock().await;
        oz_core::Settings::set(&db, TOPOLOGY_SETTING_KEY, &previous).unwrap();
        persist_topology_recovery(
            &db,
            &TopologyApplyRecovery {
                store_id: store_id.into(),
                topology_branch_id: None,
                creations: vec![creation],
                snapshots: vec![],
                previous_topology: Some(previous.clone()),
                desired_topology: Some(desired),
            },
        )
        .unwrap();
    }
    // Store is untouched by the crash — assert recovery leaves it that way.
    recover_pending_topology_apply(&state, store_id)
        .await
        .unwrap();
    let db = state.db.lock().await;
    assert!(
        oz_core::Settings::get(&db, TOPOLOGY_APPLY_RECOVERY_KEY)
            .unwrap()
            .is_none(),
        "recovery journal must be cleared after healing"
    );
    assert_eq!(
        oz_core::Settings::get(&db, TOPOLOGY_SETTING_KEY)
            .unwrap()
            .unwrap(),
        previous,
        "global topology must be restored to the exact prior envelope"
    );
    drop(db);
    assert!(!store_has_instance(&state, store_id, "ws-crash-1"));
}

#[tokio::test]
async fn crash_after_store_commit_compensates_both_databases() {
    // Crash point 2: store transaction committed, global save never ran.
    // Recovery must delete the created instance, restore the previous
    // global topology, and clear the journal.
    let store_id = "store-crash-2";
    let (_dir, state) = state_with_store();
    let previous = topology_envelope_json(&[], &[], 0, &[]).unwrap();
    let desired = topology_envelope_json(&[], &[], 1, &[]).unwrap();
    let creation = crash_creation(store_id, "ws-crash-2");
    {
        let db = state.db.lock().await;
        oz_core::Settings::set(&db, TOPOLOGY_SETTING_KEY, &previous).unwrap();
        persist_topology_recovery(
            &db,
            &TopologyApplyRecovery {
                store_id: store_id.into(),
                topology_branch_id: None,
                creations: vec![creation.clone()],
                snapshots: vec![],
                previous_topology: Some(previous.clone()),
                desired_topology: Some(desired),
            },
        )
        .unwrap();
    }
    // The crash landed between the store commit and the global save:
    // the created instance IS present in the store DB.
    commit_creation_to_store(&state, &creation);
    assert!(store_has_instance(&state, store_id, "ws-crash-2"));

    recover_pending_topology_apply(&state, store_id)
        .await
        .unwrap();

    let db = state.db.lock().await;
    assert!(
        oz_core::Settings::get(&db, TOPOLOGY_APPLY_RECOVERY_KEY)
            .unwrap()
            .is_none(),
        "recovery journal must be cleared after healing"
    );
    assert_eq!(
        oz_core::Settings::get(&db, TOPOLOGY_SETTING_KEY)
            .unwrap()
            .unwrap(),
        previous,
        "global topology must be restored to the exact prior envelope"
    );
    drop(db);
    assert!(
        !store_has_instance(&state, store_id, "ws-crash-2"),
        "created instance must be compensated (deleted) from the store"
    );
}

#[tokio::test]
async fn recovery_finalizes_without_compensating_a_completed_apply() {
    // Crash point 3: global save committed (current == desired) but the
    // journal is still present. In the current Apply flow the journal is
    // cleared atomically inside the save transaction, so this state is
    // defensive — but the recovery contract explicitly promises NOT to
    // compensate a completed Apply. Pinning it prevents a regression if
    // the journal clear ever moves out of the save transaction.
    let store_id = "store-crash-3";
    let (_dir, state) = state_with_store();
    let previous = topology_envelope_json(&[], &[], 0, &[]).unwrap();
    let desired = topology_envelope_json(&[], &[], 1, &[]).unwrap();
    let creation = crash_creation(store_id, "ws-crash-3");
    {
        let db = state.db.lock().await;
        // The global save DID commit: current == desired.
        oz_core::Settings::set(&db, TOPOLOGY_SETTING_KEY, &desired).unwrap();
        persist_topology_recovery(
            &db,
            &TopologyApplyRecovery {
                store_id: store_id.into(),
                topology_branch_id: None,
                creations: vec![creation.clone()],
                snapshots: vec![],
                previous_topology: Some(previous),
                desired_topology: Some(desired.clone()),
            },
        )
        .unwrap();
    }
    commit_creation_to_store(&state, &creation);
    assert!(store_has_instance(&state, store_id, "ws-crash-3"));

    recover_pending_topology_apply(&state, store_id)
        .await
        .unwrap();

    let db = state.db.lock().await;
    assert!(
        oz_core::Settings::get(&db, TOPOLOGY_APPLY_RECOVERY_KEY)
            .unwrap()
            .is_none(),
        "recovery journal must be cleared after finalizing"
    );
    assert_eq!(
        oz_core::Settings::get(&db, TOPOLOGY_SETTING_KEY)
            .unwrap()
            .unwrap(),
        desired,
        "completed Apply must NOT be rolled back"
    );
    drop(db);
    assert!(
        store_has_instance(&state, store_id, "ws-crash-3"),
        "completed Apply's store mutations must NOT be compensated"
    );
}

#[tokio::test]
async fn stale_revision_apply_is_rejected_without_residue_end_to_end() {
    // Round 136: exercise `apply_topology_diff` end-to-end through the
    // real command harness (session, permission, subscription, store
    // DB). A stale base revision is rejected at the command's early
    // revision gate — before the journal or store transaction — so the
    // failure must leave no recovery journal, no request ledger, and
    // must not disturb the committed revision 1 envelope. This test
    // also pins the SUCCESS path of the first Apply, which previously
    // deadlocked: the revision read-back re-locked the still-held
    // `state.db` tokio mutex (tokio::sync::Mutex is not reentrant).
    let store_id = "store-e2e";
    let dir = tempdir().unwrap();
    let global = oz_core::migrations::fresh_db();
    {
        let store = Store::new(&global);
        store.seed_default_roles().unwrap();
        global
            .execute(
                "INSERT INTO users (id, username, pin_hash, display_name, role_id, \
                     is_active, created_at, updated_at) \
                     VALUES ('user-owner', 'owner', 'hash', 'Owner', 'role-owner', 1, \
                             '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
                [],
            )
            .unwrap();
        global
            .execute(
                "INSERT OR IGNORE INTO locations (id, name) VALUES (?1, ?2)",
                rusqlite::params![store_id, "Test Store"],
            )
            .unwrap();
        global
            .execute(
                "INSERT OR IGNORE INTO tenant_subscription \
                     (tenant_id, tier_key, status, expires_at, max_locations, max_pos_instances, \
                      allowed_types_json, signature, signed_payload, api_key, updated_at) \
                     VALUES ('default', 'pro', 'active', NULL, 2, 3, '[]', 'BOOTSTRAP_FREE', \
                             '', '', '2026-08-10T00:00:00.000Z')",
                [],
            )
            .unwrap();
    }
    let mut state = AppState::for_test_with_conn(global);
    state.db_manager =
        platform_core::StoreDatabaseManager::new(dir.path().to_path_buf(), migrations::ALL);
    let token = "token-owner".to_string();
    state.session_store.write().unwrap().insert(
        token.clone(),
        SessionContext::new(
            "user-owner".into(),
            "role-owner".into(),
            "terminal-1".into(),
            store_id.into(),
            "instance-1".into(),
            "pos".into(),
            None,
            0,
        ),
    );
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    let nodes = vec![serde_json::json!({
        "id": "branch-1",
        "type": "branch-location",
        "name": "Branch",
        "store_profile_id": store_id,
        "x": 0.0,
        "y": 0.0,
    })];
    let wires: Vec<Value> = vec![];

    // First Apply from the fresh base revision — succeeds, lands revision 1.
    let first = apply_topology_diff(
        token.clone(),
        vec![],
        vec![],
        vec![],
        nodes.clone(),
        wires.clone(),
        None,
        0,
        "request-e2e-1".into(),
        None,
        // ADR #46 §6: a real note, to prove the field survives the whole
        // command -> save -> row -> audit path rather than being dropped.
        Some("opened the second register".into()),
        app.state(),
    )
    .await
    .unwrap();
    assert_eq!(first.revision, 1);

    // Second Apply replays the STALE base revision (0) while the document
    // is already at 1 — the save rejects AFTER the store transaction
    // commits, so the live error path must compensate and restore.
    let second = apply_topology_diff(
        token.clone(),
        vec![],
        vec![],
        vec![],
        nodes,
        wires,
        None,
        0,
        "request-e2e-2".into(),
        None,
        None,
        app.state(),
    )
    .await;
    assert!(
        matches!(second, Err(AppError::TopologyValidation { ref code, .. }) if code == "topology-revision-conflict"),
        "stale Apply must be rejected with a revision conflict, got {second:?}"
    );

    let app_state = app.state::<AppState>();
    let db = app_state.db.lock().await;
    assert!(
        oz_core::Settings::get(&db, TOPOLOGY_APPLY_RECOVERY_KEY)
            .unwrap()
            .is_none(),
        "the recovery journal must be cleared after a compensated failure"
    );
    assert_eq!(
        current_topology_revision(&db, TOPOLOGY_SETTING_KEY).unwrap(),
        1,
        "the first Apply's revision 1 envelope must survive the failed retry"
    );
    let request_key = topology_apply_request_key("request-e2e-2").unwrap();
    assert!(
        oz_core::Settings::get(&db, &request_key).unwrap().is_none(),
        "the failed Apply must not leave a request ledger"
    );

    // ADR #46 Verification: "a test forcing Apply compensation asserts no
    // revision row survives it." This test already forces exactly that path —
    // the stale Apply fails AFTER the store transaction commits, so it is
    // compensated — which makes it the right place to pin the §3 claim that
    // the revision INSERT lives inside the committing transaction. A row here
    // would mean history recorded a deploy that was rolled back.
    let revisions: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM topology_revisions WHERE branch_id = ''",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        revisions, 1,
        "only the successful Apply may have a revision row"
    );

    // ADR #46 §6 end-to-end: the note the merchant typed reached the revision
    // row through the real command, not just the audit record.
    let stored_note: String = db
        .query_row(
            "SELECT change_note FROM topology_revisions WHERE branch_id = '' AND revision = 1",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(stored_note, "opened the second register");

    // ADR #46 §6: the audit record is written on the success path only, and
    // into the EFFECTIVE store's database (audit_log is per-store), not the
    // global one the revision row lives in.
    drop(db);
    let store_conn = app_state.db_manager.open_store(store_id).unwrap();
    let store_db = store_conn.lock().unwrap();
    let topology_events: Vec<String> = oz_core::Store::new(&store_db)
        .list_audit_entries(50, 0)
        .unwrap()
        .into_iter()
        .filter(|e| e.action == "topology.apply")
        .map(|e| e.details)
        .collect();
    assert_eq!(
        topology_events.len(),
        1,
        "a rejected Apply must write no audit record"
    );
    let details: serde_json::Value = serde_json::from_str(&topology_events[0]).unwrap();
    assert_eq!(details["revision"], 1);
    assert_eq!(details["branch_id"], "");

    // The two records describe one event and must not disagree about it.
    assert_eq!(details["change_note"], "opened the second register");
}

#[tokio::test]
// The `sessions` guard is explicitly `drop`ped before the awaits below;
// clippy's await_holding_lock cannot see through the explicit drop and
// flags a false positive. Allowed with the drop in place.
#[allow(clippy::await_holding_lock)]
async fn can_save_topology_probe_gates_on_topology_write_permission() {
    // Phase 1 §I: the capability probe the editor uses to gate the Save
    // toolbar (TopologyScreen -> canSaveTopology -> can_save_topology)
    // must agree with the Apply gate: both resolve the session against
    // the GLOBAL identity DB and require TOPOLOGY_WRITE (dedicated key
    // replacing staff:update, admin/owner only).
    let store_id = "store-cap";
    let dir = tempdir().unwrap();
    let global = oz_core::migrations::fresh_db();
    {
        let store = Store::new(&global);
        store.seed_default_roles().unwrap();
        // role-lite: narrow custom role without topology:write.
        global
                .execute_batch(
                    "INSERT INTO roles (id, name, description, permissions, created_at, updated_at) VALUES
                        ('role-lite', 'Lite', 'Limited', '[\"sales:view\"]', '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');",
                )
                .unwrap();
        for (id, username, role_id) in [
            ("user-owner", "owner", "role-owner"),
            ("user-admin", "admin", "role-admin"),
            ("user-manager", "manager", "role-manager"),
            ("user-cashier", "cashier", "role-lite"),
        ] {
            global
                .execute(
                    "INSERT INTO users (id, username, pin_hash, display_name, role_id, \
                         is_active, created_at, updated_at) \
                         VALUES (?1, ?2, 'hash', ?2, ?3, 1, \
                                 '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
                    rusqlite::params![id, username, role_id],
                )
                .unwrap();
        }
        global
            .execute(
                "INSERT OR IGNORE INTO locations (id, name) VALUES (?1, ?2)",
                rusqlite::params![store_id, "Test Store"],
            )
            .unwrap();
    }
    let mut state = AppState::for_test_with_conn(global);
    state.db_manager =
        platform_core::StoreDatabaseManager::new(dir.path().to_path_buf(), migrations::ALL);
    let owner_token = "token-owner".to_string();
    let admin_token = "token-admin".to_string();
    let manager_token = "token-manager".to_string();
    let cashier_token = "token-cashier".to_string();
    let mut sessions = state.session_store.write().unwrap();
    sessions.insert(
        owner_token.clone(),
        SessionContext::new(
            "user-owner".into(),
            "role-owner".into(),
            "terminal-1".into(),
            store_id.into(),
            "instance-1".into(),
            "pos".into(),
            None,
            0,
        ),
    );
    sessions.insert(
        admin_token.clone(),
        SessionContext::new(
            "user-admin".into(),
            "role-admin".into(),
            "terminal-2".into(),
            store_id.into(),
            "instance-2".into(),
            "pos".into(),
            None,
            0,
        ),
    );
    sessions.insert(
        manager_token.clone(),
        SessionContext::new(
            "user-manager".into(),
            "role-manager".into(),
            "terminal-3".into(),
            store_id.into(),
            "instance-3".into(),
            "pos".into(),
            None,
            0,
        ),
    );
    sessions.insert(
        cashier_token.clone(),
        SessionContext::new(
            "user-cashier".into(),
            "role-lite".into(),
            "terminal-4".into(),
            store_id.into(),
            "instance-4".into(),
            "pos".into(),
            None,
            0,
        ),
    );
    drop(sessions);
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    assert!(
        can_save_topology(owner_token, app.state()).await.unwrap(),
        "an owner session must be allowed to save topology"
    );
    assert!(
        can_save_topology(admin_token, app.state()).await.unwrap(),
        "an admin session must be allowed to save topology"
    );
    let manager_denied = can_save_topology(manager_token, app.state()).await;
    assert!(
        matches!(manager_denied, Err(AppError::PermissionDenied(_))),
        "a manager session (has staff:update, lacks topology:write) must be denied by the capability probe, got {manager_denied:?}"
    );
    let denied = can_save_topology(cashier_token, app.state()).await;
    assert!(
        matches!(denied, Err(AppError::PermissionDenied(_))),
        "a limited session must be denied by the capability probe, got {denied:?}"
    );
}

#[tokio::test]
async fn authorize_topology_write_enforces_location_scope() {
    let dir = tempdir().unwrap();
    let global = oz_core::migrations::fresh_db();
    {
        let store = Store::new(&global);
        store.seed_default_roles().unwrap();
        global
            .execute_batch(
                "INSERT INTO roles (id, name, description, permissions, created_at, updated_at) VALUES
                    ('role-topo-mgr', 'Topo Manager', 'Scoped Topo', '[\"topology:write\"]', '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');",
            )
            .unwrap();

        global
            .execute(
                "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
                 VALUES ('user-scoped-mgr', 'scoped-mgr', 'hash', 'Scoped Mgr', 'role-topo-mgr', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
                [],
            )
            .unwrap();

        // Assign user-scoped-mgr to store-allowed only
        store
            .set_assignment(
                "user-scoped-mgr",
                "role-topo-mgr",
                &oz_core::db::assignments::AssignmentSpec {
                    scope_mode: oz_core::db::assignments::ScopeMode::Scoped,
                    branches_all: false,
                    branches: vec!["store-allowed".into()],
                    workspaces_all: true,
                    workspaces: vec![],
                    scope_type: oz_core::db::assignments::ScopeType::Organization,
                    scope_id: None,
                },
            )
            .unwrap();
    }

    let mut state = AppState::for_test_with_conn(global);
    state.db_manager =
        platform_core::StoreDatabaseManager::new(dir.path().to_path_buf(), migrations::ALL);

    let token = "token-scoped-mgr".to_string();
    {
        let mut sessions = state.session_store.write().unwrap();
        sessions.insert(
            token.clone(),
            SessionContext::new(
                "user-scoped-mgr".into(),
                "role-topo-mgr".into(),
                "term-1".into(),
                "store-allowed".into(),
                "inst-1".into(),
                "admin".into(),
                None,
                0,
            ),
        );
    }

    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    // authorize_topology_write for store-allowed succeeds
    let key_ok = authorize_topology_write(&token, &app.state(), Some("store-allowed")).await;
    assert!(
        key_ok.is_ok(),
        "scoped manager must be allowed on their assigned branch"
    );

    // authorize_topology_write for store-denied fails with PermissionDenied
    let key_err = authorize_topology_write(&token, &app.state(), Some("store-denied")).await;
    assert!(
        matches!(key_err, Err(AppError::PermissionDenied(_))),
        "scoped manager must be denied on an unassigned branch, got {key_err:?}"
    );
}

#[test]
fn shared_topology_contract_matches_backend_warehouse_roles() {
    let contract = shared_topology_semantics();
    // The CONTRACT version, not the envelope version. ADR #45 §1 raised the
    // semantics contract to 2 by giving every pairing row explicit `endpoints`;
    // the saved-diagram envelope is unchanged and stays at 1.
    assert_eq!(contract["schemaVersion"], TOPOLOGY_CONTRACT_SCHEMA_VERSION);
    assert!(is_warehouse_primary_input_port(Some("location-in")));
    assert!(is_warehouse_primary_input_port(Some("operation-in")));
    assert!(is_warehouse_operational_input_port(Some("stock-in")));
    assert!(is_warehouse_operational_input_port(Some("transfer-in")));
    assert!(!is_warehouse_primary_input_port(Some("stock-in")));
    assert!(!is_warehouse_operational_input_port(Some("operation-in")));
    assert!(shared_semantic_pairing_contains(
        Some("transfer-out"),
        Some("transfer-in"),
        Some("inventory-transfer"),
    ));
}

#[tokio::test]
async fn restore_topology_setting_none_removes_the_key() {
    // The remove path: restore_topology_setting with previous=None must
    // delete the setting key entirely, not leave behind an empty value.
    // The crash-recovery tests always use Some(previous) — this pins the
    // remove branch that fires when no prior topology existed.
    let _store_id = "store-restore-none";
    let (_dir, state) = state_with_store();
    let key = TOPOLOGY_SETTING_KEY;
    {
        let db = state.db.lock().await;
        oz_core::Settings::set(&db, key, "stale-data").unwrap();
        assert!(
            oz_core::Settings::get(&db, key).unwrap().is_some(),
            "setting must exist before restore"
        );
    }
    {
        let db = state.db.lock().await;
        restore_topology_setting(&db, key, None).unwrap();
    }
    let db = state.db.lock().await;
    assert!(
        oz_core::Settings::get(&db, key).unwrap().is_none(),
        "setting must be removed when previous is None"
    );
}

/// Helper: seed a workspace instance with specific field values in the store DB.
fn seed_instance_in_store(
    state: &AppState,
    store_id: &str,
    id: &str,
    name: &str,
    description: &str,
    purpose_key: &str,
    status: &str,
) {
    let store_conn = state.db_manager.open_store(store_id).unwrap();
    let store = store_conn.lock().unwrap();
    let tx = store.unchecked_transaction().unwrap();
    tx.execute(
        "INSERT OR IGNORE INTO locations (id, name) VALUES (?1, ?2)",
        rusqlite::params![store_id, "Test Store"],
    )
    .unwrap();
    tx.execute(
        "INSERT OR IGNORE INTO workspace_types \
             (key, name, description, layout_mode, icon, sort_order, accent_colour) \
             VALUES ('pos', 'POS', '', 'fullscreen', '', 0, '')",
        [],
    )
    .unwrap();
    tx.execute(
        "INSERT INTO workspace_instances \
             (id, type_key, location_id, name, description, colour, purpose_key, status, \
              last_accessed_at) \
             VALUES (?1, 'pos', ?2, ?3, ?4, NULL, ?5, ?6, \
                     strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
        rusqlite::params![id, store_id, name, description, purpose_key, status],
    )
    .unwrap();
    tx.commit().unwrap();
}

/// Read the current field values of a workspace instance from the store DB.
fn read_instance_fields(
    state: &AppState,
    store_id: &str,
    id: &str,
) -> (String, String, String, String) {
    let store_conn = state.db_manager.open_store(store_id).unwrap();
    let store = store_conn.lock().unwrap();
    store
        .query_row(
            "SELECT name, description, purpose_key, status FROM workspace_instances WHERE id = ?1",
            rusqlite::params![id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .unwrap()
}

#[tokio::test]
async fn crash_recovery_with_snapshots_restores_pre_mutation_rows() {
    // The existing crash tests only exercise creations (DELETE on compensation).
    // This test pins the snapshot-restore path: when Apply modifies existing
    // workspace rows (update + archive), the recovery journal stores pre-mutation
    // snapshots. Compensation must restore those rows to their exact prior state.
    let store_id = "store-snapshot";
    let (_dir, state) = state_with_store();

    // 1. Seed two workspace instances with known pre-mutation values.
    seed_instance_in_store(
        &state,
        store_id,
        "ws-pre",
        "Pre-Mutation",
        "Original description",
        "general",
        "active",
    );
    seed_instance_in_store(
        &state,
        store_id,
        "ws-archive",
        "To-Archive",
        "Will be archived",
        "general",
        "active",
    );

    // 2. Simulate the Apply mutation: update ws-pre, archive ws-archive.
    //    The Apply flow would UPDATE ws-pre's fields and SET status='archived'
    //    on ws-archive — then crash before the global save commits.
    {
        let store_conn = state.db_manager.open_store(store_id).unwrap();
        let store = store_conn.lock().unwrap();
        let tx = store.unchecked_transaction().unwrap();
        tx.execute(
            "UPDATE workspace_instances SET name = 'Updated Name', description = 'Changed', \
             purpose_key = 'kitchen', status = 'active' WHERE id = 'ws-pre'",
            [],
        )
        .unwrap();
        tx.execute(
            "UPDATE workspace_instances SET status = 'archived' WHERE id = 'ws-archive'",
            [],
        )
        .unwrap();
        tx.commit().unwrap();
    }

    // 3. Write the recovery journal with pre-mutation snapshots and one creation.
    let creation = crash_creation(store_id, "ws-new");
    let snapshot_pre: WorkspaceApplySnapshot = serde_json::from_value(serde_json::json!({
        "id": "ws-pre",
        "name": "Pre-Mutation",
        "description": "Original description",
        "colour": null,
        "purpose_key": "general",
        "status": "active",
    }))
    .unwrap();
    let snapshot_archive: WorkspaceApplySnapshot = serde_json::from_value(serde_json::json!({
        "id": "ws-archive",
        "name": "To-Archive",
        "description": "Will be archived",
        "colour": null,
        "purpose_key": "general",
        "status": "active",
    }))
    .unwrap();
    let previous = topology_envelope_json(&[], &[], 0, &[]).unwrap();
    let desired = topology_envelope_json(&[], &[], 1, &[]).unwrap();
    {
        let db = state.db.lock().await;
        oz_core::Settings::set(&db, TOPOLOGY_SETTING_KEY, &previous).unwrap();
        persist_topology_recovery(
            &db,
            &TopologyApplyRecovery {
                store_id: store_id.into(),
                topology_branch_id: None,
                creations: vec![creation.clone()],
                snapshots: vec![snapshot_pre, snapshot_archive],
                previous_topology: Some(previous.clone()),
                desired_topology: Some(desired),
            },
        )
        .unwrap();
    }
    // The creation was committed to the store (crash landed after store commit).
    commit_creation_to_store(&state, &creation);
    assert!(store_has_instance(&state, store_id, "ws-new"));

    // 4. Run recovery.
    recover_pending_topology_apply(&state, store_id)
        .await
        .unwrap();

    // 5. Verify: creations deleted, snapshots restored.
    assert!(
        !store_has_instance(&state, store_id, "ws-new"),
        "created instance must be deleted"
    );
    let (name, desc, purpose, status) = read_instance_fields(&state, store_id, "ws-pre");
    assert_eq!(name, "Pre-Mutation", "ws-pre name must be restored");
    assert_eq!(
        desc, "Original description",
        "ws-pre description must be restored"
    );
    assert_eq!(purpose, "general", "ws-pre purpose_key must be restored");
    assert_eq!(status, "active", "ws-pre status must be restored");
    let (name2, _, _, status2) = read_instance_fields(&state, store_id, "ws-archive");
    assert_eq!(name2, "To-Archive", "ws-archive name must be preserved");
    assert_eq!(
        status2, "active",
        "ws-archive status must be restored from archived to active"
    );

    // 6. Global topology restored, journal cleared.
    let db = state.db.lock().await;
    assert!(
        oz_core::Settings::get(&db, TOPOLOGY_APPLY_RECOVERY_KEY)
            .unwrap()
            .is_none()
    );
    assert_eq!(
        oz_core::Settings::get(&db, TOPOLOGY_SETTING_KEY)
            .unwrap()
            .unwrap(),
        previous
    );
}
