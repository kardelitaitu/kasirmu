//! Unit tests for the kasirmu-core semantic topology validation engine:
//! the vendored contract parity check, semantic ownership gates,
//! typed-connection gates, and cycle detection.
//!
//! Loaded as the `tests` module of `topology.rs` via `#[path]`; the
//! crate namespace resolves through `use super::*`.

use super::*;
use serde_json::json;

/// The semantic contract is vendored into kasirmu-core so server builds never
/// depend on the UI tree (the `include_str!` above resolves to the local
/// copy). The UI file remains the TypeScript side's source, and this test is
/// the in-suite twin of `scripts/verify-topology-parity.py`: it requires the UI
/// canonical file to be present and then fails on any byte of drift.
///
/// It deliberately does NOT return early when the path is missing. The path
/// used to be spelled `ui/src/features/stores/`, that directory became
/// `locations/`, and the missing-file branch kept this test printing `ok`
/// while comparing zero bytes — a green that measured nothing, in a repo where
/// every test run is a full checkout (`dev-ci#cargo-nextest`), so the branch
/// was never a real server-only accommodation. A test whose premise is absent
/// is a failure: fix the path or restore the file, and do not put the silent
/// `return` back.
#[test]
fn vendored_contract_matches_ui_canonical() {
    let ui_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../ui/src/features/locations/topologySemantics.json");
    assert!(
        ui_path.exists(),
        "topology parity: no UI canonical contract at {} — this test compares the \
         vendored crates/kasirmu-core/src/topologySemantics.json against that file, so a \
         missing path means it has checked nothing. Either the UI file was deleted or \
         this path went stale again (stores/ -> locations/ has already happened once); \
         scripts/verify-topology-parity.py names the same pair.",
        ui_path.display()
    );
    let ui_bytes =
        std::fs::read(&ui_path).unwrap_or_else(|e| panic!("read {}: {e}", ui_path.display()));
    assert_eq!(
        SHARED_TOPOLOGY_SEMANTICS_JSON.as_bytes(),
        ui_bytes.as_slice(),
        "vendored crates/kasirmu-core/src/topologySemantics.json drifted from \
         ui/src/features/locations/topologySemantics.json — copy the file \
         across (scripts/verify-topology-parity.py enforces this too)"
    );
}

fn semantic_node(id: &str, node_type: &str, store_profile_id: Option<&str>) -> Value {
    let mut node = json!({
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

fn semantic_location_wire(id: &str, to_node_id: &str) -> Value {
    json!({
        "id": id,
        "from_node_id": "branch",
        "to_node_id": to_node_id,
        "direction": "one-way",
        "from_port_id": "location-out",
        "to_port_id": "location-in",
        "relationship_type": "location",
    })
}

fn validation_code(err: &CoreError) -> &str {
    match err {
        CoreError::TopologyValidation { code, .. } => code,
        other => panic!("expected TopologyValidation, got {other:?}"),
    }
}

#[test]
fn missing_branch_location_is_reported() {
    // A semantic marker is required to reach the branch gate: a pure
    // legacy geometric graph is intentionally accepted (readable during
    // migration), so the workspace carries a store_profile_id.
    let nodes = vec![semantic_node("ws-1", "workspace", Some("default"))];
    let wires = vec![];
    let err = validate_semantic_json(&nodes, &wires).expect_err("must fail without a branch");
    assert_eq!(validation_code(&err), "missing-branch-location");
}

#[test]
fn valid_semantic_graph_passes() {
    let nodes = vec![
        semantic_node("branch", "branch-location", Some("default")),
        semantic_node("ws-1", "workspace", None),
    ];
    let wires = vec![semantic_location_wire("wire-1", "ws-1")];
    validate_semantic_json(&nodes, &wires).expect("valid graph must pass");
}

#[test]
fn invalid_purpose_key_is_reported() {
    let mut ws = semantic_node("ws-1", "workspace", None);
    ws["metadata"] = json!({ "purposeKey": "dining-room", "typeKey": "store-pos" });
    let nodes = vec![
        semantic_node("branch", "branch-location", Some("default")),
        ws,
    ];
    let wires = vec![semantic_location_wire("wire-1", "ws-1")];
    let err = validate_semantic_json(&nodes, &wires).expect_err("dining-room needs restaurant-pos");
    assert_eq!(validation_code(&err), "invalid-purpose");
}

#[test]
fn directed_cycle_is_detected() {
    let nodes = vec![
        semantic_node("branch", "branch-location", Some("default")),
        semantic_node("ws-1", "workspace", None),
        semantic_node("ws-2", "workspace", None),
    ];
    let mut wires = vec![
        semantic_location_wire("loc-1", "ws-1"),
        semantic_location_wire("loc-2", "ws-2"),
    ];
    let route = |id: &str, from: &str, to: &str| {
        json!({
            "id": id,
            "from_node_id": from,
            "to_node_id": to,
            "direction": "one-way",
            "from_port_id": "stock-out",
            "to_port_id": "stock-in",
            "relationship_type": "stock-routing",
        })
    };
    wires.push(route("r-1", "ws-1", "ws-2"));
    wires.push(route("r-2", "ws-2", "ws-1"));
    let err = validate_semantic_json(&nodes, &wires).expect_err("cycle must be rejected");
    assert_eq!(validation_code(&err), "cycle-detected");
}

#[test]
fn an_unregistered_workspace_type_has_no_stock_endpoint_in_the_contract() {
    // Round 11 drew the wrong conclusion from the wrong fixture. Its third
    // argument came from `semantic_node`, whose third parameter is
    // `store_profile_id`, not `type_key` — so both of its workspace nodes were
    // built with NO type key at all. A type-less workspace canonicalizes to
    // `workspace:store-pos` by design (see node_kind_token), which the contract
    // does declare a stock endpoint for. Both graphs were therefore the same
    // legal wire, and neither ever tested `admin`. The retraction that followed
    // was itself unsupported.
    //
    // Rebuilt with `typed_node`, which does take a type key.
    let mut root = semantic_node("branch", "branch-location", Some("default"));
    root["name"] = json!("branch");
    let adm = typed_node("adm", "workspace", Some("admin"));
    let wh = typed_node("wh", "warehouse", None);
    let wires = vec![
        semantic_location_wire("loc-1", "adm"),
        semantic_location_wire("loc-2", "wh"),
        json!({
            "id": "s-1",
            "from_node_id": "adm",
            "to_node_id": "wh",
            "direction": "one-way",
            "from_port_id": "stock-out",
            "to_port_id": "stock-in",
            "relationship_type": "stock-routing",
        }),
    ];
    let nodes = vec![root, adm.clone(), wh.clone()];

    // First prove the fixture says what it looks like it says: this is the
    // unregistered case, not a store-pos wire wearing a different name.
    assert_eq!(node_kind_token(&adm), "workspace:admin");
    assert_eq!(node_kind_token(&wh), "warehouse");
    assert!(
        !pairing_admits_kinds("stock-out", "stock-in", "workspace:admin", "warehouse"),
        "the contract must not declare a stock endpoint for an unregistered type, \
         or this test is proving nothing about persistence"
    );

    let err = validate_semantic_json(&nodes, &wires)
        .expect_err("a wire the contract declares no endpoint for must not be persistable");
    assert_eq!(
        validation_code(&err),
        "invalid-semantic-connection",
        "the contract gate must be what refuses this wire"
    );
}

#[test]
fn a_stock_wire_from_a_registered_workspace_type_is_accepted() {
    // Positive control for the test above, and a guard against the same fixture
    // trap: built with `typed_node` so the source really is `workspace:store-pos`
    // rather than a type-less workspace that merely canonicalizes to it.
    let root = semantic_node("branch", "branch-location", Some("default"));
    let pos = typed_node("pos", "workspace", Some("store-pos"));
    let wh = typed_node("wh", "warehouse", None);
    assert_eq!(node_kind_token(&pos), "workspace:store-pos");
    assert!(pairing_admits_kinds(
        "stock-out",
        "stock-in",
        "workspace:store-pos",
        "warehouse"
    ));
    let nodes = vec![root, pos, wh];
    let wires = vec![
        semantic_location_wire("loc-1", "pos"),
        semantic_location_wire("loc-2", "wh"),
        json!({
            "id": "s-1",
            "from_node_id": "pos",
            "to_node_id": "wh",
            "direction": "one-way",
            "from_port_id": "stock-out",
            "to_port_id": "stock-in",
            "relationship_type": "stock-routing",
        }),
    ];
    validate_semantic_json(&nodes, &wires)
        .expect("store-pos -> warehouse is a declared stock endpoint");
}

#[test]
fn shared_semantics_contract_parses() {
    let contract = shared_topology_semantics();
    assert!(
        contract
            .pointer("/warehouse/primaryInputs")
            .and_then(Value::as_array)
            .is_some(),
        "contract must expose /warehouse/primaryInputs"
    );
}

#[test]
fn ambiguous_legacy_wire_is_detected() {
    let nodes = [
        semantic_node("ws-1", "workspace", None),
        semantic_node("ws-2", "workspace", None),
    ];
    let wire = json!({
        "id": "g-1",
        "from_node_id": "ws-1",
        "to_node_id": "ws-2",
        "direction": "one-way",
    });
    let node_by_id: std::collections::HashMap<&str, &Value> = nodes
        .iter()
        .filter_map(|node| value_string(node, "id").map(|id| (id, node)))
        .collect();
    assert!(
        ambiguous_legacy_wire(&node_by_id, &wire),
        "workspace-to-workspace geometric wire has no deterministic semantic migration"
    );
}

// ── shared_topology_semantics ─────────────────────────────────────

#[test]
fn shared_topology_semantics_loads_and_has_expected_keys() {
    let sem = shared_topology_semantics();
    assert!(sem.get("warehouse").is_some(), "must have warehouse key");
    assert!(
        sem.get("semanticPairings").is_some(),
        "must have semanticPairings key"
    );
    assert!(
        sem.get("schemaVersion").is_some(),
        "must have schemaVersion key"
    );
}

// ── value_string ──────────────────────────────────────────────────

#[test]
fn value_string_present_string() {
    let val = serde_json::json!({"key": "hello"});
    assert_eq!(value_string(&val, "key"), Some("hello"));
}

#[test]
fn value_string_missing_key() {
    let val = serde_json::json!({"key": "hello"});
    assert_eq!(value_string(&val, "missing"), None);
}

#[test]
fn value_string_non_string_value() {
    let val = serde_json::json!({"key": 42});
    assert_eq!(value_string(&val, "key"), None);
}

#[test]
fn value_string_null_value() {
    let val = serde_json::json!({"key": null});
    assert_eq!(value_string(&val, "key"), None);
}

// ── is_warehouse_primary_input_port ───────────────────────────────

#[test]
fn warehouse_primary_inputs_match_contract() {
    assert!(is_warehouse_primary_input_port(Some("location-in")));
    assert!(is_warehouse_primary_input_port(Some("operation-in")));
}

#[test]
fn warehouse_primary_inputs_reject_operational() {
    assert!(!is_warehouse_primary_input_port(Some("stock-in")));
    assert!(!is_warehouse_primary_input_port(Some("transfer-in")));
}

#[test]
fn warehouse_primary_inputs_reject_none() {
    assert!(!is_warehouse_primary_input_port(None));
}

#[test]
fn warehouse_primary_inputs_reject_unknown() {
    assert!(!is_warehouse_primary_input_port(Some("unknown-port")));
}

// ── is_warehouse_operational_input_port ───────────────────────────

#[test]
fn warehouse_operational_inputs_match_contract() {
    assert!(is_warehouse_operational_input_port(Some("stock-in")));
    assert!(is_warehouse_operational_input_port(Some("transfer-in")));
}

#[test]
fn warehouse_operational_inputs_reject_primary() {
    assert!(!is_warehouse_operational_input_port(Some("location-in")));
    assert!(!is_warehouse_operational_input_port(Some("operation-in")));
}

#[test]
fn warehouse_operational_inputs_reject_none() {
    assert!(!is_warehouse_operational_input_port(None));
}

// ── shared_semantic_pairing_contains ───────────────────────────────

#[test]
fn semantic_pairing_location_match() {
    assert!(shared_semantic_pairing_contains(
        Some("location-out"),
        Some("location-in"),
        Some("location")
    ));
}

#[test]
fn semantic_pairing_stock_routing_match() {
    assert!(shared_semantic_pairing_contains(
        Some("stock-out"),
        Some("stock-in"),
        Some("stock-routing")
    ));
}

#[test]
fn semantic_pairing_ticket_routing_match() {
    assert!(shared_semantic_pairing_contains(
        Some("ticket-out"),
        Some("ticket-in"),
        Some("ticket-routing")
    ));
}

#[test]
fn semantic_pairing_wrong_port_rejected() {
    assert!(!shared_semantic_pairing_contains(
        Some("stock-out"),
        Some("location-in"),
        Some("location")
    ));
}

#[test]
fn semantic_pairing_none_args() {
    assert!(!shared_semantic_pairing_contains(None, None, None));
}

#[test]
fn semantic_pairing_unknown_triple() {
    assert!(!shared_semantic_pairing_contains(
        Some("unknown-out"),
        Some("unknown-in"),
        Some("unknown-rel")
    ));
}

// ── has_semantic_fields ───────────────────────────────────────────

#[test]
fn has_semantic_fields_with_store_profile_id() {
    let nodes = vec![serde_json::json!({"store_profile_id": "sp-1"})];
    assert!(has_semantic_fields(&nodes, &[]));
}

#[test]
fn has_semantic_fields_with_metadata_store_profile_id() {
    let nodes = vec![serde_json::json!({"metadata": {"storeProfileId": "sp-1"}})];
    assert!(has_semantic_fields(&nodes, &[]));
}

#[test]
fn has_semantic_fields_with_wire_ports() {
    let wires = vec![serde_json::json!({"from_port_id": "location-out"})];
    assert!(has_semantic_fields(&[], &wires));
}

#[test]
fn has_semantic_fields_with_wire_relationship_type() {
    let wires = vec![serde_json::json!({"relationship_type": "location"})];
    assert!(has_semantic_fields(&[], &wires));
}

#[test]
fn has_semantic_fields_empty_graph() {
    assert!(!has_semantic_fields(&[], &[]));
}

#[test]
fn has_semantic_fields_legacy_geometric_only() {
    let nodes = vec![serde_json::json!({"id": "n1", "x": 100, "y": 200, "type": "workspace"})];
    let wires = vec![serde_json::json!({"from_node_id": "n1", "to_node_id": "n2"})];
    assert!(!has_semantic_fields(&nodes, &wires));
}

// ── semantic_branch_profile_id ────────────────────────────────────

#[test]
fn semantic_branch_profile_id_from_store_type() {
    let nodes = vec![serde_json::json!({
        "id": "b1", "type": "store", "store_profile_id": "sp-42"
    })];
    assert_eq!(semantic_branch_profile_id(&nodes, &[]), Some("sp-42"));
}

#[test]
fn semantic_branch_profile_id_from_branch_location_type() {
    let nodes = vec![serde_json::json!({
        "id": "b1", "type": "branch-location", "store_profile_id": "sp-99"
    })];
    assert_eq!(semantic_branch_profile_id(&nodes, &[]), Some("sp-99"));
}

#[test]
fn semantic_branch_profile_id_from_metadata() {
    let nodes = vec![serde_json::json!({
        "id": "b1", "type": "store",
        "metadata": {"storeProfileId": "sp-meta"}
    })];
    assert_eq!(semantic_branch_profile_id(&nodes, &[]), Some("sp-meta"));
}

#[test]
fn semantic_branch_profile_id_none_for_workspace() {
    let nodes = vec![serde_json::json!({"id": "w1", "type": "workspace"})];
    assert_eq!(semantic_branch_profile_id(&nodes, &[]), None);
}

#[test]
fn semantic_branch_profile_id_none_for_legacy_graph() {
    // Legacy graph has no semantic fields → has_semantic_fields returns false
    let nodes = vec![serde_json::json!({"id": "n1", "type": "workspace", "x": 0, "y": 0})];
    assert_eq!(semantic_branch_profile_id(&nodes, &[]), None);
}

// ── semantic_node_type ────────────────────────────────────────────

#[test]
fn semantic_node_type_present() {
    let node = serde_json::json!({"type": "warehouse"});
    assert_eq!(semantic_node_type(&node), Some("warehouse"));
}

#[test]
fn semantic_node_type_missing() {
    let node = serde_json::json!({"id": "n1"});
    assert_eq!(semantic_node_type(&node), None);
}

#[test]
fn semantic_node_type_non_string() {
    let node = serde_json::json!({"type": 42});
    assert_eq!(semantic_node_type(&node), None);
}

// ── ADR #45: endpoint predicates come from the contract ───────────
//
// Before ADR #45 the pairing table was shared but the endpoint rules — which
// node kinds may sit on each end of a row — were re-written by hand in four
// places: a Rust `match`, a Rust target-only pre-filter, and two TypeScript
// copies. These tests pin the evaluator that replaced them, which is now the
// only home for those rules.

fn typed_node(id: &str, node_type: &str, type_key: Option<&str>) -> Value {
    let mut node = json!({ "id": id, "type": node_type, "name": id });
    if let Some(type_key) = type_key {
        node["metadata"] = json!({ "typeKey": type_key });
    }
    node
}

fn wire_between(
    from: &Value,
    to: &Value,
    from_port: &str,
    to_port: &str,
    relationship: &str,
) -> Value {
    json!({
        "id": "w1",
        "from_node_id": from["id"],
        "to_node_id": to["id"],
        "from_port_id": from_port,
        "to_port_id": to_port,
        "relationship_type": relationship,
        "direction": "one-way",
    })
}

#[test]
fn a_non_workspace_node_wearing_the_restaurant_pos_key_is_refused_upstream_of_the_kds_check() {
    // ADR #45 follow-up #2. The KDS feed check used to test the source node's
    // type_key ALONE, so in principle a warehouse carrying "restaurant-pos"
    // could satisfy it. Building that graph to prove it turned up something
    // better: the wire-level contract gate added in section 1 rejects the
    // warehouse→KDS operation feed FIRST, so the weak predicate was never
    // reachable for this input. It was defence in depth that could not fire,
    // not a live hole — and this slice's change makes it consistent with the
    // adjacent retail_pos_ids set rather than fixing a shippable bug.
    //
    // Pinned here because the ORDER is the guarantee: if the wire gate is ever
    // loosened, this test tells us what the KDS check now has to catch.
    let mut root = typed_node("root", "branch-location", None);
    root["store_profile_id"] = json!("branch-1");
    let fake = typed_node("fake-wh", "warehouse", Some("restaurant-pos"));
    let kds = typed_node("kds-1", "workspace", Some("kds"));
    let wire = wire_between(&fake, &kds, "operation-out", "operation-in", "generic");

    let err = validate_semantic_json(&[root, fake, kds], &[wire])
        .expect_err("a warehouse is not a Restaurant POS, whatever type key it carries");
    let message = err.to_string();
    assert!(
        message.contains("incompatible semantic connection"),
        "the wire-level contract gate must be the one that refuses this feed, got {message}"
    );
    assert!(
        !message.contains("invalid-operation-source"),
        "if the KDS check is now reporting this, the wire gate has stopped catching it — \
         re-examine both rather than accepting this message"
    );
}

#[test]
fn node_kind_token_canonicalizes_the_branch_alias_and_workspace_family() {
    assert_eq!(
        node_kind_token(&typed_node("b", "store", None)),
        "branch-location",
        "`store` is the serialized alias; the contract speaks the canonical name"
    );
    assert_eq!(
        node_kind_token(&typed_node("w", "warehouse", None)),
        "warehouse"
    );
    assert_eq!(
        node_kind_token(&typed_node("h", "hardware", None)),
        "hardware"
    );
    assert_eq!(
        node_kind_token(&typed_node("k", "workspace", Some("kds"))),
        "workspace:kds"
    );
    // A workspace with no recorded type key is the Store POS baseline — the
    // same default `semantic_type_key` applies, so the two can never disagree.
    assert_eq!(
        node_kind_token(&typed_node("p", "workspace", None)),
        "workspace:store-pos"
    );
}

#[test]
fn endpoints_admit_declared_pairs_and_the_family_form() {
    // An exact declared pair.
    assert!(pairing_admits_kinds(
        "operation-out",
        "operation-in",
        "workspace:restaurant-pos",
        "workspace:kds"
    ));
    // A token written without a `:` suffix covers the family: the Location row
    // means "any workspace", not an enumeration of every type key.
    assert!(pairing_admits_kinds(
        "location-out",
        "location-in",
        "@branch-root",
        "workspace:store-pos"
    ));
    assert!(pairing_admits_kinds(
        "location-out",
        "location-in",
        "@branch-root",
        "warehouse"
    ));
    // The future-facing generic row carries the wildcard.
    assert!(pairing_admits_kinds(
        "generic-out",
        "generic-in",
        "hardware",
        "warehouse"
    ));
}

#[test]
fn endpoints_refuse_undeclared_pairs_and_unknown_kinds() {
    // The operation row's two admitted pairs are deliberately NOT the cross
    // product of its endpoints: a Store POS operational feed into a KDS is
    // undeclared, and this is why the contract lists pairs instead of sets.
    assert!(!pairing_admits_kinds(
        "operation-out",
        "operation-in",
        "workspace:store-pos",
        "workspace:kds"
    ));
    // A workspace may not originate a ticket feed; only a KDS may.
    assert!(!pairing_admits_kinds(
        "ticket-out",
        "ticket-in",
        "workspace:store-pos",
        "hardware"
    ));
    // Only the Branch Location owns location-out.
    assert!(!pairing_admits_kinds(
        "location-out",
        "location-in",
        "workspace:store-pos",
        "warehouse"
    ));
    // An unregistered workspace type is not authorable until the contract
    // declares it. That is the discipline ADR #45 buys: adding a POS type is a
    // contract edit, and both gates pick it up at once.
    assert!(!pairing_admits_kinds(
        "stock-out",
        "stock-in",
        "workspace:pharmacy-pos",
        "warehouse"
    ));
    // Unknown semantics fail closed, exactly as unknown port ids always have.
    assert!(!pairing_admits_kinds(
        "made-up-out",
        "stock-in",
        "warehouse",
        "warehouse"
    ));
}

#[test]
fn contract_gate_refuses_an_operation_feed_from_a_non_workspace_source() {
    // Regression for ADR #45 §1. The wire loop used to skip the contract check
    // for any operation-in wire whose TARGET was a KDS or a warehouse, without
    // ever inspecting the source — so this wire bypassed semantic validation
    // completely, while the frontend gate refused to offer it. The pre-filter
    // now requires a workspace source, so the gate runs.
    let hardware = typed_node("hw-1", "hardware", None);
    let kds = typed_node("kds-1", "workspace", Some("kds"));
    let wire = wire_between(&hardware, &kds, "operation-out", "operation-in", "generic");
    assert!(
        !semantic_wire_matches_contract(&wire, &hardware, &kds),
        "a hardware-sourced operational feed must not pass the contract gate"
    );
}

#[test]
fn contract_gate_still_admits_both_declared_operation_feeds() {
    let resto = typed_node("resto", "workspace", Some("restaurant-pos"));
    let kds = typed_node("kds", "workspace", Some("kds"));
    let store = typed_node("pos", "workspace", Some("store-pos"));
    let warehouse = typed_node("wh", "warehouse", None);
    assert!(semantic_wire_matches_contract(
        &wire_between(&resto, &kds, "operation-out", "operation-in", "generic"),
        &resto,
        &kds
    ));
    assert!(semantic_wire_matches_contract(
        &wire_between(
            &store,
            &warehouse,
            "operation-out",
            "operation-in",
            "generic"
        ),
        &store,
        &warehouse
    ));
}

// ── ADR #45 §2: the generated cross-language corpus ───────────────
//
// The corpus is every (pairing row × source kind × target kind) combination,
// and `topologySemantics.matrix.json` records the verdicts the Rust evaluator
// produced when it was last regenerated. BOTH gates assert against that file,
// so changing either evaluator without regenerating the matrix fails a test.
// That is the mechanism: a contract change has to become a deliberate,
// reviewable act whose blast radius shows up as a matrix diff, rather than a
// silent disagreement between two languages that a merchant discovers by
// pressing Apply.
//
// Regenerate with:
//   TOPOLOGY_MATRIX_UPDATE=1 cargo test -p kasirmu-core --lib topology_matrix
//
// The golden is Rust-generated on purpose: the backend is the persistence
// authority, so it defines what a wire that survives means. The TypeScript side
// (ui/src/__tests__/topologyMatrix.test.ts) is the one that catches the canvas
// drifting away from it.

/// Kinds the corpus probes. The first six come from the contract's own
/// `nodeKinds` plus `endpointWorkspaceTypeKeys`; the rest are deliberately undeclared,
/// so fail-closed behaviour is pinned in the golden rather than assumed.
fn corpus_kinds() -> Vec<&'static str> {
    vec![
        "branch-location",
        "warehouse",
        "hardware",
        "workspace:store-pos",
        "workspace:restaurant-pos",
        "workspace:kds",
        // An unregistered POS type, a purpose_key that is not a type_key, and
        // plain nonsense. None of the three may author a wire.
        "workspace:pharmacy-pos",
        "workspace:general",
        "not-a-kind",
    ]
}

fn matrix_path() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/topologySemantics.matrix.json")
}

/// Build the full verdict matrix by asking the live evaluator, never by
/// restating a rule — so the golden can only ever record what the code decides.
fn build_matrix() -> Value {
    let contract = shared_topology_semantics();
    let pairings = contract
        .get("semanticPairings")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let kinds: Vec<Value> = corpus_kinds()
        .iter()
        .map(|kind| Value::String((*kind).to_string()))
        .collect();
    let rows: Vec<Value> = pairings
        .iter()
        .map(|row| {
            let source = value_string(row, "source").unwrap_or_default();
            let target = value_string(row, "target").unwrap_or_default();
            let mut verdicts = serde_json::Map::new();
            for from in corpus_kinds() {
                for to in corpus_kinds() {
                    verdicts.insert(
                        format!("{from}|{to}"),
                        Value::Bool(pairing_admits_kinds(source, target, from, to)),
                    );
                }
            }
            json!({
                "source": source,
                "target": target,
                "relationshipType": value_string(row, "relationshipType").unwrap_or_default(),
                "verdicts": Value::Object(verdicts),
            })
        })
        .collect();
    json!({
        "generatedBy": "oz-core pairing_admits_kinds (ADR #45 §2)",
        "contractSchemaVersion": contract.get("schemaVersion").cloned().unwrap_or(Value::Null),
        "kinds": kinds,
        "rows": rows,
    })
}

#[test]
fn topology_matrix_golden_matches_the_rust_evaluator() {
    let path = matrix_path();
    let expected = build_matrix();
    if std::env::var("TOPOLOGY_MATRIX_UPDATE").is_ok() {
        let rendered = serde_json::to_string_pretty(&expected).expect("matrix must serialize");
        std::fs::write(&path, format!("{rendered}\n")).expect("matrix must be writable");
        return;
    }
    assert!(
        path.exists(),
        "topology matrix golden missing at {} — regenerate with \
         TOPOLOGY_MATRIX_UPDATE=1 cargo test -p kasirmu-core --lib topology_matrix",
        path.display()
    );
    let bytes = std::fs::read(&path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
    let golden: Value = serde_json::from_slice(&bytes).expect("matrix golden must be valid JSON");
    assert_eq!(
        golden, expected,
        "the Rust topology evaluator no longer matches \
         crates/kasirmu-core/src/topologySemantics.matrix.json — either restore the \
         evaluator, or regenerate the golden deliberately and review the matrix \
         diff (ADR #45 §2)"
    );
}

#[test]
fn topology_matrix_covers_every_contract_row_and_declared_kind() {
    // Guards the golden against going stale in the quiet direction: a new
    // pairing row or a newly declared workspace type must land in the corpus,
    // so the matrix cannot silently stop covering part of the contract.
    let golden = build_matrix();
    let pairings = shared_topology_semantics()
        .get("semanticPairings")
        .and_then(Value::as_array)
        .expect("contract must declare semanticPairings");
    let rows = golden["rows"].as_array().expect("matrix rows");
    assert_eq!(
        rows.len(),
        pairings.len(),
        "the matrix must hold exactly one row per contract pairing"
    );
    let kinds = golden["kinds"].as_array().expect("matrix kinds");
    let declared = shared_topology_semantics()
        .get("endpointWorkspaceTypeKeys")
        .and_then(Value::as_array)
        .expect("contract must declare endpointWorkspaceTypeKeys");
    for key in declared {
        let token = format!("workspace:{}", key.as_str().expect("type keys are strings"));
        assert!(
            kinds.iter().any(|k| k.as_str() == Some(token.as_str())),
            "declared workspace type {token} is missing from the corpus kinds"
        );
    }
    for kind in ["branch-location", "warehouse", "hardware"] {
        assert!(
            kinds.iter().any(|k| k.as_str() == Some(kind)),
            "node kind {kind} is missing from the corpus kinds"
        );
    }
}

#[test]
fn a_duplicate_node_id_now_outranks_the_structural_checks() {
    // ADR #45 §4.3 follow-up. This began life as a characterization test pinning
    // a DIVERGENCE: the backend reported `missing-branch-location` for a graph
    // that also had two nodes sharing an id, while the TypeScript tier table
    // names `duplicate-node` first. Its own comment said to rewrite it if the
    // backend ever ordered properly - and it now does, because the duplicate is
    // refused at index-build time before any structural gate runs.
    //
    // Kept rather than deleted: it is the regression test for the case that
    // motivated the fix, and it records that the two surfaces agree here.
    let warehouse_a = typed_node("wh", "warehouse", None);
    let warehouse_b = typed_node("wh", "warehouse", None);
    let admin = typed_node("adm", "workspace", Some("admin"));
    let wire = wire_between(&warehouse_a, &admin, "stock-out", "stock-in", "stock");

    let err = validate_semantic_json(&[warehouse_a, warehouse_b, admin], &[wire])
        .expect_err("a graph with no branch location must not validate");
    assert_eq!(validation_code(&err), "duplicate-node");
}

#[test]
fn the_backend_and_the_tier_order_agree_on_an_illegal_wire_before_a_missing_input() {
    // The other half of the record: for at least one two-defect graph the two
    // implementations do agree, so the divergence above is a specific gap rather
    // than a blanket incompatibility. Recording agreement matters as much -
    // otherwise the follow-up reads as though nothing lines up.
    //
    // Here a warehouse feeds an unregistered workspace type (invalid-semantic-
    // connection, tier 3) and the graph also has no branch location (tier 2).
    // Both surfaces name the tier-2 problem first.
    let warehouse = typed_node("wh", "warehouse", None);
    let admin = typed_node("adm", "workspace", Some("admin"));
    let wire = wire_between(&warehouse, &admin, "stock-out", "stock-in", "stock");

    let err = validate_semantic_json(&[warehouse, admin], &[wire])
        .expect_err("an unregistered workspace type must not validate");
    assert_eq!(validation_code(&err), "missing-branch-location");
}

#[test]
fn two_nodes_sharing_an_id_are_refused_before_anything_reads_the_index() {
    // ADR #45 §4.3 follow-up. The backend had no duplicate-node check at all:
    // the graph index used `entry(id).or_insert(node)`, which silently dropped
    // the second node and then validated the collapsed graph. `Ok(())` was the
    // real answer before this commit - confirmed by probe, not inferred.
    //
    // This is the one defect the tier ordering cannot express as a preference:
    // with two nodes claiming one id, every later lookup by id resolves to an
    // arbitrary one of them, so a graph the UI calls unreadable passed the
    // core validator. (The Apply gate had its own check, so this was not
    let mut root = typed_node("root", "branch-location", None);
    root["store_profile_id"] = json!("branch-1");
    let warehouse = typed_node("wh", "warehouse", None);
    let impostor = typed_node("wh", "workspace", Some("kds"));
    let wire = wire_between(&root, &warehouse, "location-out", "location-in", "location");

    let err = validate_semantic_json(&[root, warehouse, impostor], &[wire])
        .expect_err("two nodes must not share one id");
    assert_eq!(validation_code(&err), "duplicate-node");
}

#[test]
fn distinct_ids_still_validate_after_the_duplicate_guard_lands() {
    // Guards the fix itself: `insert` replaces rather than `or_insert`-skips, so
    // a mis-placed early return here would reject ordinary graphs.
    let mut root = typed_node("root", "branch-location", None);
    root["store_profile_id"] = json!("branch-1");
    let warehouse = typed_node("wh", "warehouse", None);
    let wire = wire_between(&root, &warehouse, "location-out", "location-in", "location");
    assert!(validate_semantic_json(&[root, warehouse], &[wire]).is_ok());
}

#[test]
fn a_device_wired_to_two_ticket_sources_is_refused() {
    // ADR #45 §4.3 follow-up, and the last item of the validation-code coverage
    // audit. This rule lived only in the TypeScript validator: two ticket feeds
    // into one device leave routing undefined, so which queue a ticket reaches
    // depends on wire order. The backend cannot accept that graph.
    // The contract admits ticket-routing only as
    // `workspace:kds --ticket-out--> hardware`, so the feed must come from a KDS
    // workspace. The first version of this test wired it from a branch-location on
    // `location-out` — a pairing the contract itself rejects — so it proved the
    // rule fires on a graph the wire gate would have refused regardless. That is a
    // weaker claim than the test appeared to make.
    let mut root = typed_node("root", "branch-location", None);
    root["store_profile_id"] = json!("branch-1");
    let kds = typed_node("kds-1", "workspace", Some("kds"));
    let printer = typed_node("printer", "hardware", None);
    let feed_a = wire_between(&kds, &printer, "ticket-out", "ticket-in", "ticket-routing");
    let mut feed_b = feed_a.clone();
    feed_b["id"] = json!("w2");

    let err = validate_semantic_json(&[root, kds, printer], &[feed_a, feed_b])
        .expect_err("one device must not take two ticket sources");
    assert_eq!(validation_code(&err), "multiple-ticket-inputs");
}

#[test]
fn a_single_ticket_source_does_not_trip_the_cardinality_rule() {
    // The other direction. A check written as `>= 1` instead of `> 1` would
    // reject every legal diagram, and the test above would still pass.
    //
    // Asserted as "not THIS code" rather than `is_ok()`, because a bare hardware
    // node with one feed is rejected by an unrelated rule further down (it has no
    // location input). Requiring `is_ok()` here would have made the guard depend
    // on rules it is not testing, and the first honest version of this test duly
    // failed for exactly that reason.
    let mut root = typed_node("root", "branch-location", None);
    root["store_profile_id"] = json!("branch-1");
    let kds = typed_node("kds-1", "workspace", Some("kds"));
    let printer = typed_node("printer", "hardware", None);
    let feed = wire_between(&kds, &printer, "ticket-out", "ticket-in", "ticket-routing");

    let outcome = validate_semantic_json(&[root, kds, printer], &[feed]);
    if let Err(err) = &outcome {
        assert_ne!(
            validation_code(err),
            "multiple-ticket-inputs",
            "one ticket source must not be read as two"
        );
    }
}
