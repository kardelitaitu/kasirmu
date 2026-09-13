//! Stress / schema-evolution / corruption tests — graph integrity, large-scale stress, schema evolution, thread safety, corrupt data, UTF-8 boundaries
//!
//! Split from topology_tests.rs (6k-line file) so every file in the
//! commands dir stays under the ~3k-line guideline. `use super::*`
//! resolves the root's flat namespace; `use super::topology_tests::*`
//! shares the module's test helpers (fresh_conn, semantic_node, ...).

use super::topology_tests::*;
use super::*;
// ── NaN / Infinity coordinate sanitisation ────────────────────
//
// Non-finite f64 values are now sanitised to 0.0 by custom serde
// serialiser/deserialiser helpers, preventing topology poisoning.

#[test]
fn save_topology_data_rejects_orphan_wires() {
    let conn = fresh_conn();
    let data = TopologyData {
        nodes: vec![],
        wires: vec![TopologyWirePayload {
            id: "orphan".into(),
            from_node_id: "ghost".into(),
            to_node_id: "nowhere".into(),
            direction: "one-way".into(),
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
    assert_eq!(loaded.wires.len(), 1);
    assert_eq!(loaded.wires[0].from_node_id, "ghost");

    // save_topology_data should reject wires referencing unknown nodes.
    let result = save_topology_data(&conn, loaded.nodes, loaded.wires);
    assert!(result.is_err());
    let err = result.unwrap_err().to_string();
    assert!(
        err.contains("unknown from_node_id"),
        "error should mention unknown from_node_id, got: {err}"
    );
}
