//! Tauri command + crash-injection tests — command integration, audit follow-ups, validation ordering, atomicity, Apply recovery journal
//!
//! Split from topology_tests.rs (6k-line file) so every file in the
//! commands dir stays under the ~3k-line guideline. `use super::*`
//! resolves the root's flat namespace; `use super::topology_tests::*`
//! shares the module's test helpers (fresh_conn, semantic_node, ...).

use super::topology_tests::*;
use super::*;
use kasirmu_core::db::Store;
use kasirmu_core::migrations;
use kasirmu_core::session::SessionContext;
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

/// R1 (ruled 2026-09-16): `load_topology` now rides a session like the
/// template reads. The older command tests seed this session at their call
/// sites — same shape the auth-gated tests build by hand further down the
/// file; the token is constant because the load gate checks existence and
/// liveness, nothing about identity.
fn seed_topology_session(state: &AppState) -> String {
    let token = "token-topology-loader".to_string();
    let mut sessions = state.session_store.write().unwrap();
    sessions.insert(
        token.clone(),
        SessionContext::new(
            "user-loader".into(),
            "role-admin".into(),
            "term-loader".into(),
            "store-1".into(),
            "inst-loader".into(),
            "admin".into(),
            None,
            0,
        ),
    );
    token
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
    let loaded = load_topology(
        seed_topology_session(app.state::<AppState>().inner()),
        None,
        app.state(),
    )
    .await
    .unwrap();
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

    let loaded = load_topology(
        seed_topology_session(app.state::<AppState>().inner()),
        None,
        app.state(),
    )
    .await
    .unwrap()
    .unwrap();
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

    let token = seed_topology_session(app.state::<AppState>().inner());
    let branch_a = load_topology(token.clone(), Some("branch-a".into()), app.state())
        .await
        .unwrap()
        .unwrap();
    let branch_b = load_topology(token, Some("branch-b".into()), app.state())
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
        kasirmu_core::Settings::set(
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

    let loaded = load_topology(
        seed_topology_session(app.state::<AppState>().inner()),
        None,
        app.state(),
    )
    .await
    .unwrap()
    .unwrap();
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

    let loaded = load_topology(
        seed_topology_session(app.state::<AppState>().inner()),
        None,
        app.state(),
    )
    .await
    .unwrap();
    assert!(loaded.is_none());
}

#[tokio::test]
async fn tauri_save_topology_with_wires_roundtrips_fully() {
    let state = AppState::for_test();
    {
        let mut conn = state.db.lock().await;
        migrations::run(&mut conn).unwrap();
        // ADR #56 §2.6 stopped the baseline migration seeding the 'default'
        // location, so a migrated-only DB no longer carries the profile this
        // fixture names in store_profile_id. Restore the provisioned baseline the
        // test was written against — the same call the suite's other
        // provisioned-store fixtures use (crates/kasirmu-bridge/src/testing.rs).
        migrations::seed_provisioned_baseline(&conn);
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
    let loaded = load_topology(
        seed_topology_session(app.state::<AppState>().inner()),
        None,
        app.state(),
    )
    .await
    .unwrap()
    .unwrap();

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
        kasirmu_core::Settings::set(
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

    let loaded = load_topology(
        seed_topology_session(app.state::<AppState>().inner()),
        None,
        app.state(),
    )
    .await
    .unwrap()
    .unwrap();
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
        kasirmu_core::Settings::set(
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

    let loaded = load_topology(
        seed_topology_session(app.state::<AppState>().inner()),
        None,
        app.state(),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(loaded["nodes"].as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn load_topology_requires_a_session() {
    // R1 (todo-topology-editor.md §5, ruled 2026-09-16): reading a branch's
    // diagram reveals its configuration, so it rides the same session gate
    // the template reads ride — the "the draft endpoint stays open for
    // pre-session canvases" asymmetry was the oversight this ruling ends.
    // The eight older command tests prove the gate ACCEPTS a live session;
    // this proves it REFUSES without one, and that the refusal comes from
    // the session rather than the branch, the key, or the stored row — the
    // same call succeeds once a session exists.
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
        vec![serde_json::to_value(make_node_cmd("secret-plan")).unwrap()],
        vec![],
        Some("branch-under-read".into()),
        app.state(),
    )
    .await
    .unwrap();

    let anon = load_topology(
        "token-never-issued".into(),
        Some("branch-under-read".into()),
        app.state(),
    )
    .await;
    assert!(
        matches!(anon, Err(AppError::InvalidSession)),
        "an unknown token must not read a branch's diagram, got {anon:?}"
    );
    let token = seed_topology_session(app.state::<AppState>().inner());
    let seen = load_topology(token, Some("branch-under-read".into()), app.state())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(seen["nodes"][0]["id"], "secret-plan");
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
    kasirmu_core::Settings::set(&conn, TOPOLOGY_SETTING_KEY, legacy).unwrap();

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
    kasirmu_core::Settings::set(&conn, TOPOLOGY_SETTING_KEY, legacy).unwrap();
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
    let global = kasirmu_core::migrations::fresh_db();
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
        kasirmu_core::Settings::set(&db, TOPOLOGY_SETTING_KEY, &previous).unwrap();
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
        kasirmu_core::Settings::get(&db, TOPOLOGY_APPLY_RECOVERY_KEY)
            .unwrap()
            .is_none(),
        "recovery journal must be cleared after healing"
    );
    assert_eq!(
        kasirmu_core::Settings::get(&db, TOPOLOGY_SETTING_KEY)
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
        kasirmu_core::Settings::set(&db, TOPOLOGY_SETTING_KEY, &previous).unwrap();
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
        kasirmu_core::Settings::get(&db, TOPOLOGY_APPLY_RECOVERY_KEY)
            .unwrap()
            .is_none(),
        "recovery journal must be cleared after healing"
    );
    assert_eq!(
        kasirmu_core::Settings::get(&db, TOPOLOGY_SETTING_KEY)
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
        kasirmu_core::Settings::set(&db, TOPOLOGY_SETTING_KEY, &desired).unwrap();
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
        kasirmu_core::Settings::get(&db, TOPOLOGY_APPLY_RECOVERY_KEY)
            .unwrap()
            .is_none(),
        "recovery journal must be cleared after finalizing"
    );
    assert_eq!(
        kasirmu_core::Settings::get(&db, TOPOLOGY_SETTING_KEY)
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
    let global = kasirmu_core::migrations::fresh_db();
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
                     VALUES ('default', 'pro', 'active', NULL, 2, 3, '[\"pos\"]', 'BOOTSTRAP_FREE', \
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

    // Second Apply replays the STALE base revision (0) while the document is
    // already at 1, and the revision gate rejects it at the FRONT of
    // apply_topology_diff (crates/kasirmu-bridge/src/topology/commands.rs:527-541):
    // that return runs before the recovery journal is written (:646) and before
    // the store transaction opens (:674-905), so this call commits nothing and
    // there is nothing here for the live error path to compensate.
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
    // What this assertion actually grades, since the wording below it has long
    // suggested a compensation: this Apply wrote no journal at all (it returned
    // at the revision gate). The journal it finds gone is the FIRST, successful
    // Apply's, finalized by recover_pending_topology_apply at commands.rs:526
    // through the "apply completed, just finalize" branch. So this is a
    // recovery-finalization check, not a compensation check.
    assert!(
        kasirmu_core::Settings::get(&db, TOPOLOGY_APPLY_RECOVERY_KEY)
            .unwrap()
            .is_none(),
        "the FIRST Apply's journal must be finalized by recovery, not left pending \
         (this stale retry wrote none — it returned at the revision gate; see the \
         comment above)"
    );
    assert_eq!(
        current_topology_revision(&db, TOPOLOGY_SETTING_KEY).unwrap(),
        1,
        "the first Apply's revision 1 envelope must survive the failed retry"
    );
    let request_key = topology_apply_request_key("request-e2e-2").unwrap();
    assert!(
        kasirmu_core::Settings::get(&db, &request_key)
            .unwrap()
            .is_none(),
        "the failed Apply must not leave a request ledger"
    );

    // ADR #46 Verification: "a test forcing Apply compensation asserts no
    // revision row survives it." This test does NOT force that path — the stale
    // Apply returns at the revision gate above, before any store commit — so
    // what the count below pins is the narrower and still real claim that a
    // refused Apply writes no revision row of its own (the single row is the
    // first, successful Apply's, whose envelope assertion above holds it at 1).
    // The §3 claim that the revision INSERT lives inside the committing
    // transaction is owned by the two tests that do land after a commit:
    // crash_after_store_commit_compensates_both_databases and
    // recovery_finalizes_without_compensating_a_completed_apply. No duplicate
    // belongs here.
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
    let topology_events: Vec<String> = kasirmu_core::Store::new(&store_db)
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
    let global = kasirmu_core::migrations::fresh_db();
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
        can_save_topology(owner_token, None, app.state())
            .await
            .unwrap(),
        "an owner session must be allowed to save topology"
    );
    assert!(
        can_save_topology(admin_token, None, app.state())
            .await
            .unwrap(),
        "an admin session must be allowed to save topology"
    );
    let manager_denied = can_save_topology(manager_token, None, app.state()).await;
    assert!(
        matches!(manager_denied, Err(AppError::PermissionDenied(_))),
        "a manager session (has staff:update, lacks topology:write) must be denied by the capability probe, got {manager_denied:?}"
    );
    let denied = can_save_topology(cashier_token, None, app.state()).await;
    assert!(
        matches!(denied, Err(AppError::PermissionDenied(_))),
        "a limited session must be denied by the capability probe, got {denied:?}"
    );
}

#[tokio::test]
async fn authorize_topology_write_enforces_location_scope() {
    let dir = tempdir().unwrap();
    let global = kasirmu_core::migrations::fresh_db();
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
                &kasirmu_core::db::assignments::AssignmentSpec {
                    scope_mode: kasirmu_core::db::assignments::ScopeMode::Scoped,
                    branches_all: false,
                    branches: vec!["store-allowed".into()],
                    workspaces_all: true,
                    workspaces: vec![],
                    scope_type: kasirmu_core::db::assignments::ScopeType::Organization,
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

#[tokio::test]
async fn probe_and_enforcement_agree_for_a_branch_scoped_writer() {
    // R2 / Phase 3 (todo-topology-editor.md §5, ruled 2026-09-16): topology
    // is LOCATION-SCOPED, and the capability probe must answer through the
    // same gate the enforcement uses. A writer whose assignment covers
    // store-allowed only hears "yes" from the probe exactly where
    // authorize_topology_write says "yes", and "no" — same error kind —
    // exactly where it says no. The pin arm (M3, same ruling) asserts the
    // scope check runs BEFORE the revision-row lookup: revision 99 exists
    // nowhere, so PermissionDenied proves the gate fired first, while any
    // not-found answer would prove the old scope-free body reached the row
    // lookup unguarded. Fixture shape is authorize_topology_write_enforces_location_scope's,
    // reused so the two checks demonstrably read one rule and one assignment.
    let dir = tempdir().unwrap();
    let global = kasirmu_core::migrations::fresh_db();
    {
        let store = Store::new(&global);
        store.seed_default_roles().unwrap();
        global
            .execute_batch(
                "INSERT INTO roles (id, name, description, permissions, created_at, updated_at) VALUES
                    ('role-topo-mgr2', 'Topo Mgr2', 'Scoped Topo 2', '[\"topology:write\"]', '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');",
            )
            .unwrap();
        global
            .execute(
                "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
                 VALUES ('user-scoped-mgr2', 'scoped-mgr2', 'hash', 'Scoped Mgr 2', 'role-topo-mgr2', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
                [],
            )
            .unwrap();
        store
            .set_assignment(
                "user-scoped-mgr2",
                "role-topo-mgr2",
                &kasirmu_core::db::assignments::AssignmentSpec {
                    scope_mode: kasirmu_core::db::assignments::ScopeMode::Scoped,
                    branches_all: false,
                    branches: vec!["store-allowed".into()],
                    workspaces_all: true,
                    workspaces: vec![],
                    scope_type: kasirmu_core::db::assignments::ScopeType::Organization,
                    scope_id: None,
                },
            )
            .unwrap();
    }
    let mut state = AppState::for_test_with_conn(global);
    state.db_manager =
        platform_core::StoreDatabaseManager::new(dir.path().to_path_buf(), migrations::ALL);
    let token = "token-scoped-mgr2".to_string();
    {
        let mut sessions = state.session_store.write().unwrap();
        sessions.insert(
            token.clone(),
            SessionContext::new(
                "user-scoped-mgr2".into(),
                "role-topo-mgr2".into(),
                "term-2".into(),
                "store-allowed".into(),
                "inst-2".into(),
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

    // The assigned branch: probe and enforcement must both answer yes.
    let probe_ok =
        can_save_topology(token.clone(), Some("store-allowed".into()), app.state()).await;
    let write_ok = authorize_topology_write(&token, &app.state(), Some("store-allowed")).await;
    assert!(
        matches!(probe_ok, Ok(true)),
        "the probe must allow the branch the assignment covers, got {probe_ok:?}"
    );
    assert!(
        write_ok.is_ok(),
        "the enforcement allows the covered branch"
    );

    // The unassigned branch: BOTH answer no, with the SAME error kind —
    // agreeing on a different failure is not the property.
    let probe_no = can_save_topology(token.clone(), Some("store-denied".into()), app.state()).await;
    let write_no = authorize_topology_write(&token, &app.state(), Some("store-denied")).await;
    assert!(
        matches!(probe_no, Err(AppError::PermissionDenied(_))),
        "R2: the probe must deny a branch the assignment does not cover, got {probe_no:?}"
    );
    assert!(
        matches!(write_no, Err(AppError::PermissionDenied(_))),
        "the enforcement already denies it — the disagreement this ruling ends"
    );

    // Pin (M3 arm): scope BEFORE row lookup. Revision 99 exists nowhere, so
    // a PermissionDenied answer can only have come from the gate, while the
    // old scope-free body would fall through to the row lookup.
    let pin_no = pin_topology_revision(
        token.clone(),
        Some("store-denied".into()),
        99,
        true,
        app.state(),
    )
    .await;
    assert!(
        matches!(pin_no, Err(AppError::PermissionDenied(_))),
        "pin must scope-check the named branch before touching any row, got {pin_no:?}"
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
        kasirmu_core::Settings::set(&db, key, "stale-data").unwrap();
        assert!(
            kasirmu_core::Settings::get(&db, key).unwrap().is_some(),
            "setting must exist before restore"
        );
    }
    {
        let db = state.db.lock().await;
        restore_topology_setting(&db, key, None).unwrap();
    }
    let db = state.db.lock().await;
    assert!(
        kasirmu_core::Settings::get(&db, key).unwrap().is_none(),
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
        kasirmu_core::Settings::set(&db, TOPOLOGY_SETTING_KEY, &previous).unwrap();
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
        kasirmu_core::Settings::get(&db, TOPOLOGY_APPLY_RECOVERY_KEY)
            .unwrap()
            .is_none()
    );
    assert_eq!(
        kasirmu_core::Settings::get(&db, TOPOLOGY_SETTING_KEY)
            .unwrap()
            .unwrap(),
        previous
    );
}

// ── Two-store characterisation: docs/plans/notes.md item 20 ────────────────
//
// OBSERVES which database receives the writes when the SESSION store and the
// DIAGRAM store_profile_id differ. It changes no production line and demands no
// policy: whether the behaviour is intended is the open owner question recorded
// as notes.md item 20. Reuses the helpers this file already carries --
// crash_creation (:863) and store_has_instance (:917) -- so it is a case, not a
// new harness.

async fn char_apply(
    app: &tauri::App<tauri::test::MockRuntime>,
    token: &str,
    diagram_store: &str,
    request_id: &str,
) -> Result<kasirmu_bridge::topology::commands::TopologyApplyResult, crate::error::AppError> {
    let nodes = vec![serde_json::json!({
        "id": "branch-char",
        "type": "branch-location",
        "name": "Branch",
        "store_profile_id": diagram_store,
        "x": 0.0,
        "y": 0.0,
    })];
    apply_topology_diff(
        token.to_string(),
        vec![crash_creation(diagram_store, "ws-char-1")],
        vec![],
        vec![],
        nodes,
        vec![],
        None,
        0,
        request_id.to_string(),
        None,
        Some("characterise foreign-store apply".into()),
        app.state(),
    )
    .await
}

fn char_audit_count(state: &AppState, store_id: &str) -> i64 {
    let conn = state.db_manager.open_store(store_id).unwrap();
    let db = conn.lock().unwrap();
    db.query_row("SELECT COUNT(*) FROM audit_log", [], |r| r.get(0))
        .unwrap_or(-1)
}

#[tokio::test]
async fn apply_naming_a_foreign_store_records_which_database_receives_the_writes() {
    use kasirmu_core::db::assignments::{AssignmentSpec, ScopeMode, ScopeType};
    let store_a = "char-store-a"; // the SESSION store, both users
    let store_b = "char-store-b"; // the DIAGRAM store_profile_id -- foreign
    let dir = tempdir().unwrap();
    let global = kasirmu_core::migrations::fresh_db();
    // ADR #56 §2.6: the baseline the chain used to seed (the 'default' location and the
    // BOOTSTRAP_FREE tenant_subscription) is now written only by provisioning, so a
    // migrated-only DB is UNPROVISIONED. This fixture's scenario — and the one below,
    // whose entitlement refusal depends on the location count and the free tier — is the
    // provisioned world the test was written in, so restore it explicitly.
    kasirmu_core::migrations::seed_provisioned_baseline(&global);
    {
        let store = Store::new(&global);
        store.seed_default_roles().unwrap();
        global
            .execute_batch(
                r#"INSERT INTO roles (id, name, description, permissions, created_at, updated_at) VALUES ('role-topo-mgr', 'Topo Manager', 'Scoped Topo', '["topology:write"]', '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')"#,
            )
            .unwrap();
        global
            .execute_batch(
                r#"INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at) VALUES ('user-legacy', 'legacy', 'hash', 'Legacy Owner', 'role-owner', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z'), ('user-scoped', 'scoped', 'hash', 'Scoped Mgr', 'role-topo-mgr', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')"#,
            )
            .unwrap();
        for sid in [store_a, store_b] {
            global
                .execute(
                    "INSERT OR IGNORE INTO locations (id, name) VALUES (?1, ?2)",
                    rusqlite::params![sid, sid],
                )
                .unwrap();
        }
        global
            .execute(
                r#"INSERT OR IGNORE INTO tenant_subscription (tenant_id, tier_key, status, expires_at, max_locations, max_pos_instances, allowed_types_json, signature, signed_payload, api_key, updated_at) VALUES ('default', 'pro', 'active', NULL, 2, 3, '[]', 'BOOTSTRAP_FREE', '', '', '2026-08-10T00:00:00.000Z')"#,
                [],
            )
            .unwrap();
        // user-scoped carries an explicit branch LIST naming store_a only, so
        // store_b sits outside it, and workspaces_all = true so the workspace
        // dimension cannot be the reason for any denial: the question is the
        // branch intersection at crates/kasirmu-core/src/db/assignments.rs:204.
        store
            .set_assignment(
                "user-scoped",
                "role-topo-mgr",
                &AssignmentSpec {
                    scope_mode: ScopeMode::Scoped,
                    branches_all: false,
                    branches: vec![store_a.into()],
                    workspaces_all: true,
                    workspaces: vec![],
                    scope_type: ScopeType::Organization,
                    scope_id: None,
                },
            )
            .unwrap();
    }
    let mut state = AppState::for_test_with_conn(global);
    state.db_manager =
        platform_core::StoreDatabaseManager::new(dir.path().to_path_buf(), migrations::ALL);
    // A store database is created by MIGRATIONS ONLY (manager.rs:116), so it is
    // unprovisioned under §2.6 as well. Seed both stores the Apply below can reach,
    // because an instance written into one carries a location FK into that same database.
    for sid in [store_a, store_b] {
        let conn = state.db_manager.open_store(sid).unwrap();
        let db = conn.lock().unwrap();
        migrations::seed_provisioned_baseline(&db);
    }
    for (tok, uid, rid) in [
        ("token-legacy", "user-legacy", "role-owner"),
        ("token-scoped", "user-scoped", "role-topo-mgr"),
    ] {
        state.session_store.write().unwrap().insert(
            tok.to_string(),
            SessionContext::new(
                uid.into(),
                rid.into(),
                "terminal-1".into(),
                store_a.into(),
                "instance-1".into(),
                "pos".into(),
                None,
                0,
            ),
        );
    }
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();
    let legacy = char_apply(&app, "token-legacy", store_b, "request-char-legacy").await;
    let scoped = char_apply(&app, "token-scoped", store_b, "request-char-scoped").await;
    let st = app.state::<AppState>();
    let obs = format!(
        "legacy_ok={} scoped_ok={} inst_a={} inst_b={} audit_a={} audit_b={}",
        legacy.is_ok(),
        scoped.is_ok(),
        store_has_instance(&st, store_a, "ws-char-1"),
        store_has_instance(&st, store_b, "ws-char-1"),
        char_audit_count(&st, store_a),
        char_audit_count(&st, store_b),
    );
    let errs = format!(
        "legacy_err={:?} scoped_err={:?}",
        legacy.as_ref().err(),
        scoped.as_ref().err()
    );
    // CHARACTERISATION, not contract. Observed at this SHA; whether it is intended
    // is the open owner question in docs/plans/notes.md item 20. Two facts are
    // pinned, both about WHERE the request stopped, because neither user reaches a
    // write:
    //
    //  * user-legacy (role-owner, NO assignments row) is refused with a
    //    SUBSCRIPTION-tier message, not a scope message. The permission call at
    //    crates/kasirmu-bridge/src/topology/commands.rs:476-482 runs BEFORE the tier
    //    check (commands.rs:~713), so an assignment-less session passing scope on a
    //    store it merely NAMED in the diagram is the observation -- the write was
    //    stopped by an entitlement that has nothing to do with store identity.
    //  * user-scoped (explicit branch list = [store_a], store_b named by the
    //    diagram) is refused with "branch/workspace out of scope", which is
    //    crates/kasirmu-core/src/db/assignments.rs:204 intersecting exactly as written.
    //
    // No row landed in either store, so the residual-state assertions are the
    // point: whatever the ruling on item 20 turns out to be, today the divergence
    // does not reach the databases in this configuration.
    let legacy_msg = legacy
        .as_ref()
        .err()
        .map(|e| e.to_string())
        .unwrap_or_default();
    let scoped_msg = scoped
        .as_ref()
        .err()
        .map(|e| e.to_string())
        .unwrap_or_default();
    assert!(
        legacy.is_err() && legacy_msg.contains("subscription tier"),
        "assignment-less Apply should stop at the entitlement gate, not at scope; got [{}] on {}",
        legacy_msg,
        obs,
    );
    assert!(
        scoped.is_err() && scoped_msg.contains("out of scope"),
        "Scoped Apply naming a store outside its branch list should deny on scope; got [{}]",
        scoped_msg,
    );
    assert_eq!(
        (
            store_has_instance(&st, store_a, "ws-char-1"),
            store_has_instance(&st, store_b, "ws-char-1"),
            char_audit_count(&st, store_a),
            char_audit_count(&st, store_b),
        ),
        (false, false, 0, 0),
        "no instance and no audit row may exist in either store; observed {} errors [{}]",
        obs,
        errs,
    );
    let _ = dir;
}

// ── Phase 1 / R4: the ownership gate must consult the store it writes ──────
//
// The ruled design (todo-topology-editor.md §5, 2026-09-16) confirms the
// diagram's storeProfileId MAY select the write store, but every gate layer
// must resolve against the TARGET store. The permission layer already does
// (`char_apply`'s scoped user is refused out-of-scope; `commands.rs` passes
// `Some(&effective_store_id)`). The ownership gate did not: `validate_apply_gate`
// saw [global, session] and NEVER the target's own registry, so a store that
// describes itself — its own `locations` carries its id — could not be a
// write target, while the reverse acceptance path stayed undocumented.
//
// Fact of record, established BEFORE choosing the fix: the scoped-create
// family writes the profile row into the SESSION store's database — pinned
// green by `create_location_profile_scoped_end_to_end_owner` at
// `crates/kasirmu-bridge/src/locations_tests.rs:148-154` (count == 2 after create),
// and `platform_core::StoreDatabaseManager::create_store_db` runs migrations
// only — which seed every new store database exactly one row under the id
// 'default', never a self-named row. So the ruling's literal
// [global, effective] alone WOULD
// recreate the forever-reject the old comment guards (a freshly created
// branch profile exists only in the session registry) — the goal's fact
// clause selects [global, session, EFFECTIVE]: the target is finally
// consulted, and no working flow loses its arm.
//
// Each test below builds its own state (fresh global, legacy-owner session,
// NOTHING in any locations table beyond migration defaults) and adds
// registry rows explicitly — the registry placement IS the variable.
#[tokio::test]
async fn self_describing_store_passes_the_ownership_gate() {
    // R4 referee: the profile row exists ONLY in the named store's own
    // registry. Today the gate never reads that registry, so Apply answers
    // `unknown-branch-location` — the target's self-knowledge is worthless.
    // After the alignment the gate must accept (diagram-only apply saves).
    let dir = tempdir().unwrap();
    let global = kasirmu_core::migrations::fresh_db();
    {
        let store = Store::new(&global);
        store.seed_default_roles().unwrap();
        global
            .execute(
                "INSERT INTO users (id, username, pin_hash, display_name, role_id, \
                     is_active, created_at, updated_at) \
                     VALUES ('user-gate-owner', 'gateowner', 'hash', 'Gate Owner', 'role-owner', 1, \
                             '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
                [],
            )
            .unwrap();
        global
            .execute(
                r#"INSERT OR IGNORE INTO tenant_subscription (tenant_id, tier_key, status, expires_at, max_locations, max_pos_instances, allowed_types_json, signature, signed_payload, api_key, updated_at) VALUES ('default', 'pro', 'active', NULL, 2, 3, '["store-pos"]', 'BOOTSTRAP_FREE', '', '', '2026-08-10T00:00:00.000Z')"#,
                [],
            )
            .unwrap();
    }
    let mut state = AppState::for_test_with_conn(global);
    state.db_manager =
        platform_core::StoreDatabaseManager::new(dir.path().to_path_buf(), migrations::ALL);
    // The session store exists but carries no char-gate rows.
    {
        let c = state.db_manager.open_store("char-gate-sess").unwrap();
        drop(c.lock().unwrap());
    }
    // The target store exists and describes ITSELF — and nothing else does:
    // not the global identity DB, not the session registry.
    {
        let c = state.db_manager.open_store("char-gate-self").unwrap();
        let db = c.lock().unwrap();
        db.execute(
            "INSERT INTO locations (id, name) VALUES ('char-gate-self', 'Self Named')",
            [],
        )
        .unwrap();
    }
    let token = "token-gate-owner".to_string();
    state.session_store.write().unwrap().insert(
        token.clone(),
        SessionContext::new(
            "user-gate-owner".into(),
            "role-owner".into(),
            "terminal-g".into(),
            "char-gate-sess".into(),
            "instance-g".into(),
            "admin".into(),
            None,
            0,
        ),
    );
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();
    let nodes = vec![serde_json::json!({
        "id": "branch-g",
        "type": "branch-location",
        "name": "Self",
        "store_profile_id": "char-gate-self",
        "x": 0.0,
        "y": 0.0,
    })];
    let result = apply_topology_diff(
        token,
        vec![],
        vec![],
        vec![],
        nodes,
        vec![],
        None,
        0,
        "request-gate-self".to_string(),
        None,
        Some("R4 referee: target registry consulted".into()),
        app.state(),
    )
    .await;
    let msg = result
        .as_ref()
        .err()
        .map(|e| e.to_string())
        .unwrap_or_default();
    assert!(
        result.is_ok(),
        "a store whose own registry names its profile must pass the ownership gate (R4); got [{}]",
        msg,
    );
    let _ = dir;
}

#[tokio::test]
async fn session_registry_row_still_authorizes_the_fresh_branch() {
    // The forever-reject guard (green BEFORE and AFTER the alignment — its
    // job is to make a wrong fix fail): a freshly scoped-created profile
    // lives ONLY in the session registry (locations_tests.rs:148-154). The
    // aligned gate keeps that arm, so the same apply that works today must
    // still work after the target registry joins the slice.
    let dir = tempdir().unwrap();
    let global = kasirmu_core::migrations::fresh_db();
    {
        let store = Store::new(&global);
        store.seed_default_roles().unwrap();
        global
            .execute(
                "INSERT INTO users (id, username, pin_hash, display_name, role_id, \
                     is_active, created_at, updated_at) \
                     VALUES ('user-gate-fresh', 'gatefresh', 'hash', 'Gate Fresh', 'role-owner', 1, \
                             '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
                [],
            )
            .unwrap();
        global
            .execute(
                r#"INSERT OR IGNORE INTO tenant_subscription (tenant_id, tier_key, status, expires_at, max_locations, max_pos_instances, allowed_types_json, signature, signed_payload, api_key, updated_at) VALUES ('default', 'pro', 'active', NULL, 2, 3, '["store-pos"]', 'BOOTSTRAP_FREE', '', '', '2026-08-10T00:00:00.000Z')"#,
                [],
            )
            .unwrap();
    }
    let mut state = AppState::for_test_with_conn(global);
    state.db_manager =
        platform_core::StoreDatabaseManager::new(dir.path().to_path_buf(), migrations::ALL);
    {
        let c = state.db_manager.open_store("char-gate-sess2").unwrap();
        let db = c.lock().unwrap();
        // Exactly what create_location_profile_scoped leaves behind: the row
        // in the SESSION store's registry, and a bare store db for the
        // target with only its 'default' migration seed.
        db.execute(
            "INSERT INTO locations (id, name) VALUES ('char-gate-freshb', 'Fresh Branch')",
            [],
        )
        .unwrap();
    }
    {
        let c = state.db_manager.open_store("char-gate-freshb").unwrap();
        drop(c.lock().unwrap());
    }
    let token = "token-gate-fresh".to_string();
    state.session_store.write().unwrap().insert(
        token.clone(),
        SessionContext::new(
            "user-gate-fresh".into(),
            "role-owner".into(),
            "terminal-g2".into(),
            "char-gate-sess2".into(),
            "instance-g2".into(),
            "admin".into(),
            None,
            0,
        ),
    );
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();
    let nodes = vec![serde_json::json!({
        "id": "branch-f",
        "type": "branch-location",
        "name": "Fresh",
        "store_profile_id": "char-gate-freshb",
        "x": 0.0,
        "y": 0.0,
    })];
    let result = apply_topology_diff(
        token,
        vec![],
        vec![],
        vec![],
        nodes,
        vec![],
        None,
        0,
        "request-gate-fresh".to_string(),
        None,
        Some("R4 false-reject guard".into()),
        app.state(),
    )
    .await;
    assert!(
        result.is_ok(),
        "the session-registry arm must survive the alignment or the \
         documented forever-reject returns; got {:?}",
        result.as_ref().err(),
    );
    let _ = dir;
}

#[tokio::test]
async fn session_only_row_authorizing_a_foreign_target_is_the_accepted_residual() {
    // ACCEPTED RESIDUAL, pinned deliberately (R4 round, 2026-09-16): the
    // gate keeps ANY-registry semantics, so a row sitting in the SESSION's
    // registry still authorises writing into a DIFFERENT target store whose
    // own registry does not name it — here the target store db exists and
    // carries only its 'default' seed. Closing this fully needs either a
    // write-side change (scoped create seeds a self-row into the new store
    // db — touches the §I locations family, outside this phase's fence) or
    // dropping the session arm (which the fresh-create fact above shows
    // would regress real flows). The alignment records the gap, not misses
    // it; this test fails the day either closure lands, and whoever breaks
    // it should read this comment as the upgrade note it is.
    let dir = tempdir().unwrap();
    let global = kasirmu_core::migrations::fresh_db();
    {
        let store = Store::new(&global);
        store.seed_default_roles().unwrap();
        global
            .execute(
                "INSERT INTO users (id, username, pin_hash, display_name, role_id, \
                     is_active, created_at, updated_at) \
                     VALUES ('user-gate-res', 'gateres', 'hash', 'Gate Res', 'role-owner', 1, \
                             '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
                [],
            )
            .unwrap();
        global
            .execute(
                r#"INSERT OR IGNORE INTO tenant_subscription (tenant_id, tier_key, status, expires_at, max_locations, max_pos_instances, allowed_types_json, signature, signed_payload, api_key, updated_at) VALUES ('default', 'pro', 'active', NULL, 2, 3, '["store-pos"]', 'BOOTSTRAP_FREE', '', '', '2026-08-10T00:00:00.000Z')"#,
                [],
            )
            .unwrap();
    }
    let mut state = AppState::for_test_with_conn(global);
    state.db_manager =
        platform_core::StoreDatabaseManager::new(dir.path().to_path_buf(), migrations::ALL);
    {
        let c = state.db_manager.open_store("char-gate-sess3").unwrap();
        let db = c.lock().unwrap();
        db.execute(
            "INSERT INTO locations (id, name) VALUES ('char-gate-resb', 'Residual Branch')",
            [],
        )
        .unwrap();
    }
    {
        // Target exists WITHOUT a self row — the non-target membership is
        // what still accepts.
        let c = state.db_manager.open_store("char-gate-resb").unwrap();
        drop(c.lock().unwrap());
    }
    let token = "token-gate-res".to_string();
    state.session_store.write().unwrap().insert(
        token.clone(),
        SessionContext::new(
            "user-gate-res".into(),
            "role-owner".into(),
            "terminal-g3".into(),
            "char-gate-sess3".into(),
            "instance-g3".into(),
            "admin".into(),
            None,
            0,
        ),
    );
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();
    let nodes = vec![serde_json::json!({
        "id": "branch-r",
        "type": "branch-location",
        "name": "Residual",
        "store_profile_id": "char-gate-resb",
        "x": 0.0,
        "y": 0.0,
    })];
    let result = apply_topology_diff(
        token,
        vec![],
        vec![],
        vec![],
        nodes,
        vec![],
        None,
        0,
        "request-gate-res".to_string(),
        None,
        Some("R4 residual pinned".into()),
        app.state(),
    )
    .await;
    assert!(
        result.is_ok(),
        "the accepted residual is documented behavior, not an oversight — \
         if this fails, the closure landed; upgrade the comment above; got {:?}",
        result.as_ref().err(),
    );
    let _ = dir;
}

// ── Replay coverage per request_id ────────────────────────────────────────
//
// Two promises, one test each, both stated so they can FAIL:
//   * a retried `request_id` is answered from the request ledger and repeats
//     no workspace mutation (it must also be distinguishable from a first
//     application, which is why a NEW id at the stale base revision is
//     refused with topology-revision-conflict and does not advance), and
//   * a DIFFERENT `request_id` carrying the SAME content is not a retry at all
//     — the id, not the payload, is the replay key.
// The ledger is written by `apply_topology_diff` via
// `topology_apply_request_key(&request_id)` and read back in the block that
// returns `Ok(TopologyApplyResult { revision })` before the revision gate, in
// `crates/kasirmu-bridge/src/topology/commands.rs`. Neither case touches the
// two-store question owned by notes.md item 20.

fn replay_app(
    store_id: &str,
) -> (
    tempfile::TempDir,
    tauri::App<tauri::test::MockRuntime>,
    String,
) {
    // The same session/subscription/store-DB shape the stale-revision e2e case
    // builds inline; factored out so both replay cases grade the same harness.
    let dir = tempdir().unwrap();
    let global = kasirmu_core::migrations::fresh_db();
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
                rusqlite::params![store_id, "Replay Store"],
            )
            .unwrap();
        global
            .execute(
                r#"INSERT OR IGNORE INTO tenant_subscription (tenant_id, tier_key, status, expires_at, max_locations, max_pos_instances, allowed_types_json, signature, signed_payload, api_key, updated_at) VALUES ('default', 'pro', 'active', NULL, 2, 3, '["store-pos"]', 'BOOTSTRAP_FREE', '', '', '2026-08-10T00:00:00.000Z')"#,
                [],
            )
            .unwrap();
    }
    let mut state = AppState::for_test_with_conn(global);
    state.db_manager =
        platform_core::StoreDatabaseManager::new(dir.path().to_path_buf(), migrations::ALL);
    // Provision the store DB the way `commit_creation_to_store` does: the Apply
    // path INSERTs a workspace instance, whose FKs need both the store's own
    // `locations` row and a `workspace_types` row for the type it creates. The
    // two existing Apply cases never reach this — neither passes a creation.
    {
        let store_conn = state.db_manager.open_store(store_id).unwrap();
        let store = store_conn.lock().unwrap();
        store
            .execute(
                "INSERT OR IGNORE INTO locations (id, name) VALUES (?1, ?2)",
                rusqlite::params![store_id, "Replay Store"],
            )
            .unwrap();
        store
            .execute(
                "INSERT OR IGNORE INTO workspace_types \
                     (key, name, description, layout_mode, icon, sort_order, accent_colour) \
                     VALUES ('store-pos', 'Store POS', '', 'fullscreen', '', 0, '')",
                [],
            )
            .unwrap();
    }
    let token = "token-replay".to_string();
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
    (dir, app, token)
}

async fn replay_apply(
    app: &tauri::App<tauri::test::MockRuntime>,
    token: &str,
    store_id: &str,
    instance_id: &str,
    request_id: &str,
    base_revision: u64,
) -> Result<kasirmu_bridge::topology::commands::TopologyApplyResult, AppError> {
    let creations = vec![CreateInstanceRequest {
        id: instance_id.into(),
        type_key: "store-pos".into(),
        store_id: store_id.into(),
        name: format!("Replay {instance_id}"),
        purpose_key: Some("general".into()),
        description: None,
        colour: None,
    }];
    let nodes = vec![serde_json::json!({
        "id": "branch-replay",
        "type": "branch-location",
        "name": "Branch",
        "store_profile_id": store_id,
        "x": 0.0,
        "y": 0.0,
    })];
    apply_topology_diff(
        token.to_string(),
        creations,
        vec![],
        vec![],
        nodes,
        vec![],
        None,
        base_revision,
        request_id.to_string(),
        None,
        Some("replay coverage".into()),
        app.state(),
    )
    .await
}

#[tokio::test]
async fn a_retried_request_id_answers_from_the_ledger_without_repeating_the_mutation() {
    let store_id = "store-replay-same";
    let (dir, app, token) = replay_app(store_id);
    let state_guard = app.state::<AppState>();
    let state: &AppState = &state_guard;

    let first = replay_apply(&app, &token, store_id, "ws-replay-1", "req-replay-same", 0)
        .await
        .expect("the first Apply must succeed");
    assert_eq!(
        first.revision, 1,
        "a first Apply must advance a fresh document to revision 1"
    );
    assert!(
        store_has_instance(state, store_id, "ws-replay-1"),
        "the first Apply must have created the workspace instance"
    );
    let audit_after_first = char_audit_count(state, store_id);
    assert!(
        audit_after_first > 0,
        "the first Apply must leave an audit trail to compare against; got {audit_after_first}"
    );

    // The retry: same request_id, same content, and the SAME stale base_revision
    // — precisely what a client that never received the response re-sends. The
    // ledger sits before the revision gate, so answering a revision conflict
    // here would mean the id never bought the idempotence it promises.
    let retry = replay_apply(&app, &token, store_id, "ws-replay-1", "req-replay-same", 0)
        .await
        .expect("a retried request_id must be answered from the ledger, not rejected as stale");
    assert_eq!(
        retry.revision, first.revision,
        "a replay must return the ORIGINAL revision, not a new one: first {} retry {}",
        first.revision, retry.revision
    );
    assert_eq!(
        char_audit_count(state, store_id),
        audit_after_first,
        "a replay must not write a second audit row (was {audit_after_first}, now {})",
        char_audit_count(state, store_id)
    );

    // WHAT MAKES THIS DISTINGUISHABLE FROM A FIRST APPLICATION: the calls above
    // are the same request with the same stale base revision, and the only way
    // the second one can return revision 1 is by reading the ledger — a first
    // application of that payload is what produced revision 1 in the first place,
    // and a second application under a NEW request id is test 2's subject (it is
    // refused by the revision gate, which proves the id is the replay key). A
    // third mutation cannot be used as the control here: the tier this fixture
    // resolves to (see the note on `replay_app`) caps the store at ONE pos
    // instance, so a control Apply would fail on quota and prove nothing.
    let _ = dir;
}

#[tokio::test]
async fn a_different_request_id_carrying_the_same_content_is_not_treated_as_a_replay() {
    let store_id = "store-replay-other";
    let (dir, app, token) = replay_app(store_id);
    let state_guard = app.state::<AppState>();
    let state: &AppState = &state_guard;

    let first = replay_apply(&app, &token, store_id, "ws-replay-3", "req-original", 0)
        .await
        .expect("the first Apply must succeed");
    assert_eq!(first.revision, 1);

    // Identical content, fresh id, stale base revision: the ledger has never
    // seen this id, so this is a NEW Apply and the revision gate is the correct
    // answer. A replay guard keyed on the payload instead of the id would
    // return Ok(1) here and this assertion is what catches that swap.
    let other = replay_apply(&app, &token, store_id, "ws-replay-3", "req-different-id", 0).await;
    assert!(
        matches!(other, Err(AppError::TopologyValidation { ref code, .. })
            if code == "topology-revision-conflict"),
        "a different request_id must be graded as a new Apply, not excused as a replay; got {other:?}"
    );
    assert!(
        store_has_instance(state, store_id, "ws-replay-3"),
        "the refused Apply must not have disturbed the committed instance"
    );
    let _ = dir;
}

// The other two arms of the same idempotency block, one test each:
//   * a reused request_id carrying a DIFFERENT payload is refused by name --
//     "topology request id was already used for a different Apply"
//     (crates/kasirmu-bridge/src/topology/commands.rs:502-507), and
//   * a ledger entry with no fingerprint field is REMOVED, not answered from
//     and not treated as an idempotent success (commands.rs:516-519).
// Both were first written to assert the WRONG promise and shown to fail: the
// first printed  got Err(Invalid("topology request id was already used for a
// different Apply"))  where a plain replay was claimed, and the second read
// back  left: None, right: Some("{\"revision\":7}")  where survival was claimed.

#[tokio::test]
async fn a_reused_request_id_carrying_a_different_payload_is_refused_by_name() {
    let store_id = "store-replay-idreuse";
    let (dir, app, token) = replay_app(store_id);
    let state_guard = app.state::<AppState>();
    let state: &AppState = &state_guard;

    let first = replay_apply(&app, &token, store_id, "ws-reuse-a", "req-reuse-payload", 0)
        .await
        .expect("the first Apply must succeed");
    assert_eq!(first.revision, 1, "a first Apply must reach revision 1");
    let audit_after_first = char_audit_count(state, store_id);
    let request_key = topology_apply_request_key("req-reuse-payload").unwrap();
    let ledger_after_first = {
        let db = state.db.lock().await;
        kasirmu_core::Settings::get(&db, &request_key)
            .unwrap()
            .expect("a successful Apply must write a request ledger")
    };

    // Same request id, a DIFFERENT payload (a second workspace instance), and
    // the same stale base_revision 0. The ledger is read before the revision
    // gate, so the stale revision never gets to speak.
    let reuse = replay_apply(&app, &token, store_id, "ws-reuse-b", "req-reuse-payload", 0).await;
    // The refusal must NAME itself. base_revision 0 is stale against the
    // committed revision 1, so a call reaching the generic replay answer would
    // return Ok(1), and one reaching the revision gate would return
    // topology-revision-conflict. Either fails this assertion; only the id-reuse
    // branch produces the string below.
    const ID_REUSE: &str = "topology request id was already used for a different Apply";
    assert!(
        matches!(&reuse, Err(AppError::Invalid(m)) if m.as_str() == ID_REUSE),
        "a reused request id carrying a different payload must be refused by the id-reuse \
         branch naming itself; got {reuse:?}"
    );
    assert!(
        matches!(&reuse, Err(e) if e.to_string().contains(ID_REUSE)),
        "the refusal must carry that message through Display into the IPC payload; \
         got {reuse:?}"
    );

    // Read the ledger back unchanged, and prove the refused payload created
    // nothing: the refusal is graded on state, not on its return value.
    let db = state.db.lock().await;
    assert_eq!(
        kasirmu_core::Settings::get(&db, &request_key)
            .unwrap()
            .as_deref(),
        Some(ledger_after_first.as_str()),
        "a refused id reuse must not overwrite the ledger it is refusing"
    );
    assert_eq!(
        current_topology_revision(&db, TOPOLOGY_SETTING_KEY).unwrap(),
        1,
        "a refused id reuse must not advance the document"
    );
    drop(db);
    assert!(
        !store_has_instance(state, store_id, "ws-reuse-b"),
        "the refused payload's workspace instance must not exist"
    );
    assert!(
        store_has_instance(state, store_id, "ws-reuse-a"),
        "the refused Apply must leave the committed instance intact"
    );
    assert_eq!(
        char_audit_count(state, store_id),
        audit_after_first,
        "a refused id reuse must write no second audit row"
    );
    let _ = dir;
}

#[tokio::test]
async fn a_pre_fingerprint_ledger_entry_is_removed_rather_than_replayed() {
    let store_id = "store-replay-prefp";
    let (dir, app, token) = replay_app(store_id);
    let state_guard = app.state::<AppState>();
    let state: &AppState = &state_guard;
    let request_id = "req-prefingerprint";
    let request_key = topology_apply_request_key(request_id).unwrap();
    // Exactly the shape an interrupted development build left behind: a ledger
    // entry carrying a revision and no fingerprint at all.
    let seeded = r#"{"revision":7}"#;

    {
        let db = state.db.lock().await;
        kasirmu_core::Settings::set(&db, &request_key, seeded).unwrap();
        assert_eq!(
            kasirmu_core::Settings::get(&db, &request_key)
                .unwrap()
                .as_deref(),
            Some(seeded),
            "the seeded pre-fingerprint ledger must round-trip before the Apply"
        );
    }

    // base_revision 9 against a fresh document (current 0): the revision gate
    // is what refuses this call either way, so the ONLY thing this run grades is
    // whether the branch ahead of it cleared the unbound key.
    let res = replay_apply(&app, &token, store_id, "ws-prefp-1", request_id, 9).await;
    assert!(
        matches!(&res, Err(AppError::TopologyValidation { code, .. })
            if code == "topology-revision-conflict"),
        "an unbound request id must not be excused as an idempotent success; got {res:?}"
    );
    let db = state.db.lock().await;
    // The branch deletes it -- read back, not inferred. With the remove line
    // absent this call still fails on the revision gate above and the key stays
    // on disk holding the seeded value; that was the first form of this
    // assertion, and it failed with left: None.
    assert!(
        kasirmu_core::Settings::get(&db, &request_key)
            .unwrap()
            .is_none(),
        "the pre-fingerprint ledger entry must be removed by the branch ahead of the \
         revision gate, not left for the next caller"
    );
    assert_eq!(
        current_topology_revision(&db, TOPOLOGY_SETTING_KEY).unwrap(),
        0,
        "a refused Apply must not have advanced the document"
    );
    drop(db);
    assert!(
        !store_has_instance(state, store_id, "ws-prefp-1"),
        "the refused Apply must have created no workspace instance"
    );
    let _ = dir;
}
