//! Unit tests for topology persistence: settings-key validation
//! (`topology_setting_key`, `topology_runtime_setting_key`) and the
//! diagram-payload validation gate.
//!
//! Mounted as `persistence_tests` beside `persistence.rs` in
//! `kasirmu_bridge::topology` via `#[path]`; the flat namespace resolves
//! through `use super::*`.
use super::*;
use crate::topology::model::TOPOLOGY_RUNTIME_SETTING_KEY;
use crate::topology::model::TOPOLOGY_SETTING_KEY;

// ── topology_setting_key ────────────────────────────────────

#[test]
fn topology_setting_key_none_returns_base() {
    let key = topology_setting_key(None).unwrap();
    assert_eq!(key, TOPOLOGY_SETTING_KEY);
}

#[test]
fn topology_setting_key_with_branch() {
    let key = topology_setting_key(Some("main")).unwrap();
    assert_eq!(key, format!("{TOPOLOGY_SETTING_KEY}/main"));
}

#[test]
fn topology_setting_key_empty_branch_rejected() {
    assert!(topology_setting_key(Some("")).is_err());
    assert!(topology_setting_key(Some("  ")).is_err());
}

#[test]
fn topology_setting_key_slash_rejected() {
    assert!(topology_setting_key(Some("a/b")).is_err());
}

#[test]
fn topology_setting_key_control_chars_rejected() {
    assert!(topology_setting_key(Some("branch\u{0}test")).is_err());
    assert!(topology_setting_key(Some("branch\u{1}test")).is_err());
}

#[test]
fn topology_setting_key_too_long_rejected() {
    let long = "a".repeat(201);
    assert!(topology_setting_key(Some(&long)).is_err());
}

#[test]
fn topology_setting_key_max_length_ok() {
    let ok = "a".repeat(200);
    assert!(topology_setting_key(Some(&ok)).is_ok());
}

// ── topology_runtime_setting_key ────────────────────────────

#[test]
fn topology_runtime_setting_key_base_returns_runtime_base() {
    let key = topology_runtime_setting_key(TOPOLOGY_SETTING_KEY).unwrap();
    assert_eq!(key, TOPOLOGY_RUNTIME_SETTING_KEY);
}

#[test]
fn topology_runtime_setting_key_branch_returns_runtime_branch() {
    let branch_key = format!("{TOPOLOGY_SETTING_KEY}/west");
    let key = topology_runtime_setting_key(&branch_key).unwrap();
    assert_eq!(key, format!("{TOPOLOGY_RUNTIME_SETTING_KEY}/west"));
}

#[test]
fn topology_runtime_setting_key_invalid_prefix_rejected() {
    assert!(topology_runtime_setting_key("wrong-prefix").is_err());
}

// ── validate_topology_structure ─────────────────────────────

fn make_node(id: &str, node_type: &str) -> TopologyNodePayload {
    TopologyNodePayload {
        id: id.into(),
        node_type: node_type.into(),
        name: format!("Name {id}"),
        subtitle: None,
        x: 0.0,
        y: 0.0,
        tier_requirement: None,
        telemetry_badge: None,
        telemetry_status: None,
        metadata: None,
    }
}

fn make_wire(id: &str, from: &str, to: &str) -> TopologyWirePayload {
    TopologyWirePayload {
        id: id.into(),
        from_node_id: from.into(),
        to_node_id: to.into(),
        direction: WireDirection::OneWay,
        label: None,
        from_port: None,
        to_port: None,
    }
}

#[test]
fn validate_topology_empty_is_ok() {
    assert!(validate_topology_structure(&[], &[]).is_ok());
}

#[test]
fn validate_topology_single_node_no_wires() {
    let nodes = vec![make_node("n1", "store")];
    assert!(validate_topology_structure(&nodes, &[]).is_ok());
}

#[test]
fn validate_topology_valid_wire() {
    let nodes = vec![make_node("n1", "store"), make_node("n2", "workspace")];
    let wires = vec![make_wire("w1", "n1", "n2")];
    assert!(validate_topology_structure(&nodes, &wires).is_ok());
}

#[test]
fn validate_topology_duplicate_node_id_rejected() {
    let nodes = vec![make_node("n1", "store"), make_node("n1", "workspace")];
    let err = validate_topology_structure(&nodes, &[]).unwrap_err();
    assert!(format!("{err}").contains("duplicate node id"));
}

#[test]
fn validate_topology_unknown_node_type_rejected() {
    let nodes = vec![make_node("n1", "teleporter")];
    let err = validate_topology_structure(&nodes, &[]).unwrap_err();
    assert!(format!("{err}").contains("unknown type"));
}

#[test]
fn validate_topology_duplicate_wire_id_rejected() {
    let nodes = vec![make_node("n1", "store"), make_node("n2", "workspace")];
    let wires = vec![make_wire("w1", "n1", "n2"), make_wire("w1", "n2", "n1")];
    let err = validate_topology_structure(&nodes, &wires).unwrap_err();
    assert!(format!("{err}").contains("duplicate wire id"));
}

#[test]
fn validate_topology_unknown_wire_direction_rejected() {
    let nodes = vec![make_node("n1", "store"), make_node("n2", "workspace")];
    let mut wire = make_wire("w1", "n1", "n2");
    wire.direction = WireDirection::Unknown;
    let err = validate_topology_structure(&nodes, &[wire]).unwrap_err();
    assert!(format!("{err}").contains("unknown direction"));
}

#[test]
fn validate_topology_unknown_port_rejected() {
    let nodes = vec![make_node("n1", "store"), make_node("n2", "workspace")];
    let mut wire = make_wire("w1", "n1", "n2");
    wire.from_port = Some(PortName::Unknown);
    let err = validate_topology_structure(&nodes, &[wire]).unwrap_err();
    assert!(format!("{err}").contains("unknown port"));
}

#[test]
fn validate_topology_wire_references_unknown_node() {
    let nodes = vec![make_node("n1", "store")];
    let wires = vec![make_wire("w1", "n1", "nonexistent")];
    let err = validate_topology_structure(&nodes, &wires).unwrap_err();
    assert!(
        format!("{err}").contains("unknown from_node_id")
            || format!("{err}").contains("unknown to_node_id")
    );
}

#[test]
fn validate_topology_valid_wire_with_ports() {
    let nodes = vec![make_node("n1", "store"), make_node("n2", "workspace")];
    let mut wire = make_wire("w1", "n1", "n2");
    wire.from_port = Some(PortName::Right);
    wire.to_port = Some(PortName::Left);
    wire.direction = WireDirection::TwoWay;
    assert!(validate_topology_structure(&nodes, &[wire]).is_ok());
}

// ── validate_warehouse_quota ────────────────────────────────

fn wh_node(id: &str) -> Value {
    serde_json::json!({"id": id, "type": "warehouse", "name": "WH", "x": 0, "y": 0})
}

fn store_node_val(id: &str) -> Value {
    serde_json::json!({"id": id, "type": "store", "name": "Store", "x": 0, "y": 0})
}

#[test]
fn validate_warehouse_quota_no_warehouses_always_ok() {
    use kasirmu_core::subscription::SubscriptionTier;
    let nodes = vec![store_node_val("n1")];
    assert!(validate_warehouse_quota(&nodes, &SubscriptionTier::Free).is_ok());
    assert!(validate_warehouse_quota(&nodes, &SubscriptionTier::Pro).is_ok());
}

#[test]
fn validate_warehouse_quota_free_tier_one_warehouse() {
    use kasirmu_core::subscription::SubscriptionTier;
    let nodes = vec![wh_node("n1")];
    assert!(validate_warehouse_quota(&nodes, &SubscriptionTier::Free).is_ok());
}

#[test]
fn validate_warehouse_quota_free_tier_two_warehouses_rejected() {
    use kasirmu_core::subscription::SubscriptionTier;
    let nodes = vec![wh_node("n1"), wh_node("n2")];
    let err = validate_warehouse_quota(&nodes, &SubscriptionTier::Free).unwrap_err();
    assert!(format!("{err}").contains("quota exceeded"));
}

#[test]
fn validate_warehouse_quota_no_limit_for_tier_without_cap() {
    use kasirmu_core::subscription::SubscriptionTier;
    let nodes: Vec<Value> = (0..100).map(|i| wh_node(&format!("w{i}"))).collect();
    // Premium/Enterprise have no warehouse cap (§3).
    assert!(validate_warehouse_quota(&nodes, &SubscriptionTier::Premium).is_ok());
    assert!(validate_warehouse_quota(&nodes, &SubscriptionTier::Enterprise).is_ok());
}

// ── validate_diagram_payloads ───────────────────────────────

#[test]
fn validate_diagram_payloads_empty_is_ok() {
    assert!(validate_diagram_payloads(&[], &[]).is_ok());
}

#[test]
fn validate_diagram_payloads_valid_node_wire() {
    let nodes = vec![serde_json::json!({"id":"n1","type":"store","name":"S","x":0,"y":0})];
    let wires = vec![];
    assert!(validate_diagram_payloads(&nodes, &wires).is_ok());
}

#[test]
fn validate_diagram_payloads_invalid_node_type_rejected() {
    let nodes = vec![serde_json::json!({"id":"n1","type":"teleporter","name":"S","x":0,"y":0})];
    let err = validate_diagram_payloads(&nodes, &[]).unwrap_err();
    assert!(
        format!("{err}").contains("unknown type") || format!("{err}").contains("invalid topology")
    );
}

#[test]
fn validate_diagram_payloads_branch_location_mapped_to_store() {
    // "branch-location" should be silently mapped to "store"
    let nodes =
        vec![serde_json::json!({"id":"n1","type":"branch-location","name":"S","x":0,"y":0})];
    assert!(validate_diagram_payloads(&nodes, &[]).is_ok());
}

#[test]
fn validate_diagram_payloads_invalid_json_rejected() {
    let nodes = vec![serde_json::json!({"missing_fields": true})];
    let err = validate_diagram_payloads(&nodes, &[]).unwrap_err();
    assert!(format!("{err}").contains("invalid topology nodes"));
}

// ── ADR #45 §4.2: template names and keys ───────────────────────────

#[test]
fn normalize_template_name_trims_and_keeps_inner_whitespace() {
    // A template name is a label the merchant reads, so "Weekend Setup" is
    // legitimate; only the surrounding padding is storage noise.
    assert_eq!(
        normalize_template_name("  Weekend Setup \n").unwrap(),
        "Weekend Setup"
    );
}

#[test]
fn normalize_template_name_keeps_unicode_labels() {
    assert_eq!(normalize_template_name("café").unwrap(), "café");
    assert_eq!(normalize_template_name("開店セット").unwrap(), "開店セット");
}

#[test]
fn normalize_template_name_rejects_empty_and_whitespace_only() {
    assert!(normalize_template_name("").is_err());
    assert!(normalize_template_name("   ").is_err());
    assert!(normalize_template_name("\t\n ").is_err());
}

#[test]
fn normalize_template_name_rejects_separators() {
    // The name is a key SEGMENT. A separator would let one template forge a key
    // outside the template namespace, or make listing ambiguous.
    assert!(normalize_template_name("a/b").is_err());
    assert!(normalize_template_name("a\\b").is_err());
    assert!(normalize_template_name("../apply-recovery").is_err());
}

#[test]
fn normalize_template_name_rejects_control_characters() {
    assert!(normalize_template_name("a\u{0}b").is_err());
    assert!(normalize_template_name("a\u{7}b").is_err());
}

#[test]
fn normalize_template_name_bounds_length_in_characters_not_bytes() {
    let at_limit = "a".repeat(MAX_TEMPLATE_NAME_CHARS);
    assert_eq!(
        normalize_template_name(&at_limit).unwrap().chars().count(),
        MAX_TEMPLATE_NAME_CHARS
    );
    assert!(normalize_template_name(&"a".repeat(MAX_TEMPLATE_NAME_CHARS + 1)).is_err());

    // Multibyte: 64 characters of Japanese is ~192 bytes. Counting bytes would
    // reject a perfectly short name for a Japanese-language store.
    let wide = "開".repeat(MAX_TEMPLATE_NAME_CHARS);
    assert!(wide.len() > MAX_TEMPLATE_NAME_CHARS * 2);
    assert_eq!(
        normalize_template_name(&wide).unwrap().chars().count(),
        MAX_TEMPLATE_NAME_CHARS
    );
}

#[test]
fn template_key_is_nested_under_the_branch_topology_key() {
    let topo = topology_setting_key(Some("main")).unwrap();
    let key = template_setting_key(&topo, "Weekend Setup");
    assert_eq!(
        key,
        format!("{TOPOLOGY_SETTING_KEY}/main/template/Weekend Setup")
    );
}

#[test]
fn template_prefix_is_a_strict_prefix_of_every_template_key() {
    // Listing filters by this prefix, so a key that did not start with it would
    // be invisible while still existing.
    let topo = topology_setting_key(Some("main")).unwrap();
    let prefix = template_key_prefix(&topo);
    assert!(template_setting_key(&topo, "a").starts_with(&prefix));
    assert!(template_setting_key(&topo, "café").starts_with(&prefix));
}

#[test]
fn unscoped_and_branch_templates_do_not_share_a_namespace() {
    // The legacy unscoped diagram must not see a branch's templates, or a
    // single-branch install would leak its templates into every branch view.
    let unscoped = template_key_prefix(&topology_setting_key(None).unwrap());
    let branch = template_key_prefix(&topology_setting_key(Some("main")).unwrap());
    assert!(!branch.starts_with(&unscoped[..unscoped.len() - 1]));
    assert_ne!(unscoped, branch);
}

#[test]
fn sort_template_names_is_case_insensitive_with_a_stable_tiebreak() {
    let sorted = sort_template_names(vec![
        "Zebra".into(),
        "apple".into(),
        "Banana".into(),
        "banana".into(),
    ]);
    assert_eq!(sorted, vec!["apple", "Banana", "banana", "Zebra"]);
}

#[test]
fn sort_template_names_is_a_total_order() {
    // The list is rendered from this order, so equal names must not shuffle.
    let a = sort_template_names(vec!["x".into(), "x".into(), "A".into()]);
    let b = sort_template_names(vec!["A".into(), "x".into(), "x".into()]);
    assert_eq!(a, b);
}
