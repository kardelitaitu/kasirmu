use super::*;

// ── KdsStatus as_str ───────────────────────────────────────────

#[test]
fn status_as_str_all_variants() {
    assert_eq!(KdsStatus::Pending.as_str(), "pending");
    assert_eq!(KdsStatus::Preparing.as_str(), "preparing");
    assert_eq!(KdsStatus::Ready.as_str(), "ready");
    assert_eq!(KdsStatus::Served.as_str(), "served");
    assert_eq!(KdsStatus::Cancelled.as_str(), "cancelled");
}

// ── KdsStatus from_str ─────────────────────────────────────────

#[test]
fn status_from_str_all_variants() {
    assert_eq!(KdsStatus::from_str("pending"), Some(KdsStatus::Pending));
    assert_eq!(KdsStatus::from_str("preparing"), Some(KdsStatus::Preparing));
    assert_eq!(KdsStatus::from_str("ready"), Some(KdsStatus::Ready));
    assert_eq!(KdsStatus::from_str("served"), Some(KdsStatus::Served));
    assert_eq!(KdsStatus::from_str("cancelled"), Some(KdsStatus::Cancelled));
}

#[test]
fn status_from_str_invalid() {
    assert_eq!(KdsStatus::from_str("bogus"), None);
    assert_eq!(KdsStatus::from_str(""), None);
    assert_eq!(KdsStatus::from_str("PENDING"), None);
}

#[test]
fn status_from_str_roundtrip() {
    for s in &[
        KdsStatus::Pending,
        KdsStatus::Preparing,
        KdsStatus::Ready,
        KdsStatus::Served,
        KdsStatus::Cancelled,
    ] {
        assert_eq!(KdsStatus::from_str(s.as_str()), Some(s.clone()));
    }
}

// ── Serde roundtrips ───────────────────────────────────────────

#[test]
fn kds_status_serde_roundtrip() {
    let status = KdsStatus::Ready;
    let json = serde_json::to_string(&status).unwrap();
    let back: KdsStatus = serde_json::from_str(&json).unwrap();
    assert_eq!(back, KdsStatus::Ready);
}

#[test]
fn kds_order_serde_roundtrip() {
    let order = KdsOrder {
        id: "o-1".into(),
        sale_id: "s-1".into(),
        store_id: Some("store-default".into()),
        target_instance_id: Some("kds-main".into()),
        status: "pending".into(),
        items_summary: "Coffee x2, Bagel".into(),
        item_count: 3,
        display_number: Some(1),
        ticket_prefix: String::new(),
        received_at: "2025-01-01T12:00:00.000Z".into(),
        started_at: None,
        ready_at: None,
        served_at: None,
        prep_time_seconds: 300,
        kitchen_zone: Some("front".into()),
        notes: "No onions".into(),
        table_number: None,
        priority: true,
    };
    let json = serde_json::to_string(&order).unwrap();
    let back: KdsOrder = serde_json::from_str(&json).unwrap();
    assert_eq!(back.id, order.id);
    assert_eq!(back.sale_id, order.sale_id);
    assert_eq!(back.status, order.status);
    assert_eq!(back.items_summary, order.items_summary);
    assert_eq!(back.item_count, order.item_count);
    assert_eq!(back.prep_time_seconds, order.prep_time_seconds);
    assert_eq!(back.kitchen_zone, Some("front".into()));
    assert_eq!(back.notes, order.notes);
}

#[test]
fn create_kds_order_input_serde_roundtrip() {
    let input = CreateKdsOrderInput {
        sale_id: "s-1".into(),
        store_id: None,
        items_summary: "Tea".into(),
        item_count: 1,
        kitchen_zone: None,
        notes: String::new(),
        table_number: None,
        priority: true,
    };
    let json = serde_json::to_string(&input).unwrap();
    let back: CreateKdsOrderInput = serde_json::from_str(&json).unwrap();
    assert_eq!(back.sale_id, "s-1");
    assert_eq!(back.items_summary, "Tea");
    assert_eq!(back.item_count, 1);
    assert_eq!(back.notes, "");
    assert!(back.priority);
}

#[test]
fn kds_order_optional_timestamps() {
    let order = KdsOrder {
        id: "o-2".into(),
        sale_id: "s-2".into(),
        store_id: None,
        target_instance_id: None,
        status: "served".into(),
        items_summary: "Done".into(),
        item_count: 1,
        display_number: None,
        ticket_prefix: String::new(),
        received_at: "2025-01-01T12:00:00.000Z".into(),
        started_at: Some("2025-01-01T12:05:00.000Z".into()),
        ready_at: Some("2025-01-01T12:10:00.000Z".into()),
        served_at: Some("2025-01-01T12:12:00.000Z".into()),
        prep_time_seconds: 720,
        kitchen_zone: None,
        notes: String::new(),
        table_number: None,
        priority: false,
    };
    assert_eq!(
        order.started_at.as_deref(),
        Some("2025-01-01T12:05:00.000Z")
    );
    assert_eq!(order.ready_at.as_deref(), Some("2025-01-01T12:10:00.000Z"));
    assert_eq!(order.served_at.as_deref(), Some("2025-01-01T12:12:00.000Z"));
    assert!(order.display_number.is_none());
}

// ── KdsConnectionStatus ────────────────────────────────────────

#[test]
fn connection_status_as_str_all_variants() {
    assert_eq!(KdsConnectionStatus::Connected.as_str(), "connected");
    assert_eq!(KdsConnectionStatus::Disconnected.as_str(), "disconnected");
    assert_eq!(KdsConnectionStatus::Stale.as_str(), "stale");
}

#[test]
fn connection_status_from_str_all_variants() {
    assert_eq!(
        KdsConnectionStatus::parse_db("connected"),
        Some(KdsConnectionStatus::Connected)
    );
    assert_eq!(
        KdsConnectionStatus::parse_db("disconnected"),
        Some(KdsConnectionStatus::Disconnected)
    );
    assert_eq!(
        KdsConnectionStatus::parse_db("stale"),
        Some(KdsConnectionStatus::Stale)
    );
}

#[test]
fn connection_status_from_str_invalid() {
    assert_eq!(KdsConnectionStatus::parse_db("bogus"), None);
    assert_eq!(KdsConnectionStatus::parse_db(""), None);
}

// ── KdsDevice ──────────────────────────────────────────────────

fn make_device(id: &str, station_ids: Vec<&str>) -> KdsDevice {
    KdsDevice {
        id: id.into(),
        name: format!("Device {id}"),
        restaurant_pos_id: "resto-1".into(),
        station_ids: station_ids.into_iter().map(String::from).collect(),
        is_active: true,
        last_seen_at: None,
        connection_status: KdsConnectionStatus::Disconnected,
        created_at: "2025-01-01T00:00:00.000Z".into(),
        updated_at: "2025-01-01T00:00:00.000Z".into(),
    }
}

fn make_line_item(sku: &str) -> KdsLineItem {
    KdsLineItem {
        id: "li-1".into(),
        kds_order_id: "order-1".into(),
        sku: sku.into(),
        display_name: format!("Product {sku}"),
        qty: 1,
        course: None,
        modifiers: vec![],
        line_position: 0,
        item_status: "pending".into(),
        started_at: None,
        ready_at: None,
        served_at: None,
        created_at: "2025-01-01T00:00:00.000Z".into(),
    }
}

// ── resolve_kds_targets ────────────────────────────────────────

#[test]
fn routing_single_device_receives_all_orders() {
    let devices = vec![make_device("d-1", vec![])]; // empty = broadcast
    let items = vec![make_line_item("SKU-1")];
    let targets = resolve_kds_targets(&items, &devices, |_| None);
    assert_eq!(targets, vec!["d-1"]);
}

#[test]
fn routing_station_targeted_device_gets_matching_orders() {
    let devices = vec![
        make_device("d-grill", vec!["station-grill"]),
        make_device("d-bar", vec!["station-bar"]),
    ];
    let items = vec![make_line_item("STEAK")];
    let targets = resolve_kds_targets(&items, &devices, |sku| {
        if sku == "STEAK" {
            Some("station-grill".into())
        } else {
            None
        }
    });
    assert!(targets.contains(&"d-grill".to_string()));
    assert!(!targets.contains(&"d-bar".to_string()));
}

#[test]
fn routing_untargeted_station_broadcasts_to_all() {
    let devices = vec![
        make_device("d-1", vec!["station-grill"]),
        make_device("d-2", vec!["station-bar"]),
    ];
    let items = vec![make_line_item("UNKNOWN-SKU")];
    // No device claims "unknown-station"
    let targets = resolve_kds_targets(&items, &devices, |_| Some("unknown-station".into()));
    // Both devices should receive it (broadcast fallback)
    assert!(targets.contains(&"d-1".to_string()));
    assert!(targets.contains(&"d-2".to_string()));
}

#[test]
fn routing_inactive_device_excluded() {
    let mut device = make_device("d-1", vec![]);
    device.is_active = false;
    let devices = vec![device];
    let items = vec![make_line_item("SKU-1")];
    let targets = resolve_kds_targets(&items, &devices, |_| None);
    assert!(targets.is_empty());
}

#[test]
fn routing_empty_station_ids_means_broadcast() {
    let devices = vec![make_device("d-broadcast", vec![])];
    let items = vec![make_line_item("SKU-1")];
    let targets = resolve_kds_targets(&items, &devices, |_| None);
    assert_eq!(targets, vec!["d-broadcast"]);
}

#[test]
fn routing_deduplication_across_overlapping_stations() {
    let devices = vec![make_device("d-both", vec!["s1", "s2"])];
    let items = vec![make_line_item("A"), make_line_item("B")];
    let targets = resolve_kds_targets(&items, &devices, |sku| {
        if sku == "A" {
            Some("s1".into())
        } else {
            Some("s2".into())
        }
    });
    // d-both should appear only once
    assert_eq!(targets.len(), 1);
    assert_eq!(targets[0], "d-both");
}

#[test]
fn routing_empty_line_items_no_targets() {
    let devices = vec![make_device("d-1", vec!["station-grill"])];
    let items: Vec<KdsLineItem> = vec![];
    let targets = resolve_kds_targets(&items, &devices, |_| Some("station-grill".into()));
    // No line items → no station lookups → no targets from phase 1
    // No broadcast devices → no targets from phase 2
    assert!(targets.is_empty());
}

#[test]
fn routing_mixed_station_and_broadcast() {
    let devices = vec![
        make_device("d-grill", vec!["station-grill"]),
        make_device("d-all", vec![]), // broadcast
    ];
    let items = vec![make_line_item("STEAK")];
    let targets = resolve_kds_targets(&items, &devices, |sku| {
        if sku == "STEAK" {
            Some("station-grill".into())
        } else {
            None
        }
    });
    // Both should receive: d-grill via station, d-all via broadcast
    assert!(targets.contains(&"d-grill".to_string()));
    assert!(targets.contains(&"d-all".to_string()));
}

#[test]
fn routing_no_devices_returns_empty() {
    let items = vec![make_line_item("SKU-1")];
    let targets = resolve_kds_targets(&items, &[], |_| None);
    assert!(targets.is_empty());
}

// ── Multi-KDS plan §7.3 additional tests ─────────────────────

#[test]
fn routing_voided_order_excluded_from_routing() {
    // A voided order is never sent to routing by the POS (the POS checks
    // order status before calling resolve_kds_targets). However, if it
    // were sent with no line items and only station-targeted devices
    // (no broadcast), it should produce no targets.
    let devices = vec![
        make_device("d-grill", vec!["station-grill"]),
        make_device("d-bar", vec!["station-bar"]),
    ];
    let empty_items: Vec<KdsLineItem> = vec![];
    let targets = resolve_kds_targets(&empty_items, &devices, |_| None);
    assert!(
        targets.is_empty(),
        "station-targeted only, no items → no targets"
    );
}

#[test]
fn kds_device_serde_roundtrip() {
    let device = KdsDevice {
        id: "dev-1".into(),
        name: "Grill Display".into(),
        restaurant_pos_id: "resto-1".into(),
        station_ids: vec!["grill".into(), "fryer".into()],
        is_active: true,
        last_seen_at: Some("2025-06-01T12:00:00Z".into()),
        connection_status: KdsConnectionStatus::Connected,
        created_at: "2025-01-01T00:00:00Z".into(),
        updated_at: "2025-06-01T12:00:00Z".into(),
    };
    let json = serde_json::to_string(&device).unwrap();
    let back: KdsDevice = serde_json::from_str(&json).unwrap();
    assert_eq!(back.id, device.id);
    assert_eq!(back.name, device.name);
    assert_eq!(back.station_ids, device.station_ids);
    assert_eq!(back.connection_status, KdsConnectionStatus::Connected);
}

#[test]
fn register_input_serde_roundtrip() {
    let input = RegisterKdsDeviceInput {
        name: "Bar Display".into(),
        restaurant_pos_id: "resto-1".into(),
        station_ids: vec!["bar".into()],
        pairing_token_hash: "abc123".into(),
        pairing_expires_at: "2099-12-31T23:59:59Z".into(),
    };
    let json = serde_json::to_string(&input).unwrap();
    let back: RegisterKdsDeviceInput = serde_json::from_str(&json).unwrap();
    assert_eq!(back.name, input.name);
    assert_eq!(back.restaurant_pos_id, input.restaurant_pos_id);
    assert_eq!(back.station_ids, input.station_ids);
}

#[test]
fn routing_multiple_stations_multiple_devices() {
    let devices = vec![
        make_device("d-grill", vec!["station-grill"]),
        make_device("d-bar", vec!["station-bar"]),
        make_device("d-fryer", vec!["station-fryer"]),
    ];
    let items = vec![make_line_item("STEAK"), make_line_item("BEER")];
    let targets = resolve_kds_targets(&items, &devices, |sku| match sku {
        "STEAK" => Some("station-grill".into()),
        "BEER" => Some("station-bar".into()),
        _ => None,
    });
    assert!(targets.contains(&"d-grill".to_string()));
    assert!(targets.contains(&"d-bar".to_string()));
    assert!(!targets.contains(&"d-fryer".to_string()));
}

// ── Routing rules (kds_routing_rules engine) ─────────────────────

fn make_rule(
    id: &str,
    priority: i64,
    matcher: KdsRuleMatcher,
    matcher_value: &str,
    target_station: &str,
    is_active: bool,
) -> KdsRoutingRule {
    KdsRoutingRule {
        id: id.into(),
        restaurant_pos_id: "resto-1".into(),
        priority,
        matcher,
        matcher_value: matcher_value.into(),
        target_station: target_station.into(),
        is_active,
        created_at: "2026-09-13T00:00:00.000Z".into(),
        updated_at: "2026-09-13T00:00:00.000Z".into(),
    }
}

/// Zone map for the split-routing fixture: burger defaults to the grill,
/// cocktail carries no zone at all, steak goes to the grill.
fn zone_fixture(sku: &str) -> Option<String> {
    match sku {
        "BURGER" | "STEAK" => Some("station-grill".into()),
        _ => None,
    }
}

fn no_category(_: &str) -> Option<String> {
    None
}

#[test]
fn rules_empty_is_identical_to_static_routing() {
    // The equivalence pin: for the same inputs, an empty rules vec must
    // produce the exact same target SET as the frozen resolve_kds_targets
    // (order of the returned Vec is HashSet-arbitrary in both).
    let devices = vec![
        make_device("d-grill", vec!["station-grill"]),
        make_device("d-bar", vec!["station-bar"]),
        make_device("d-expo", vec![]),
    ];
    let items = vec![
        make_line_item("BURGER"),
        make_line_item("COCKTAIL"),
        make_line_item("UNKNOWN"),
    ];
    let mut static_targets = resolve_kds_targets(&items, &devices, zone_fixture);
    let mut ruled_targets =
        resolve_kds_targets_with_rules(&items, &devices, &[], zone_fixture, no_category);
    static_targets.sort();
    ruled_targets.sort();
    assert_eq!(static_targets, ruled_targets);
}

#[test]
fn rules_empty_equivalent_under_catch_all_scenario() {
    // Equivalence must hold on the phase-3 path too (unclaimed station
    // triggering the broadcast), not just the happy targeting path.
    let devices = vec![
        make_device("d-grill", vec!["station-grill"]),
        make_device("d-bar", vec!["station-bar"]),
    ];
    let items = vec![make_line_item("MYSTERY")];
    let mut static_targets = resolve_kds_targets(&items, &devices, |_| Some("nowhere".into()));
    let mut ruled_targets = resolve_kds_targets_with_rules(
        &items,
        &devices,
        &[],
        |_| Some("nowhere".into()),
        no_category,
    );
    static_targets.sort();
    ruled_targets.sort();
    assert_eq!(static_targets, ruled_targets);
    assert_eq!(static_targets.len(), 2);
}

#[test]
fn sku_rule_routes_zoneless_line_to_its_station() {
    // COCKTAIL has no kitchen_zone — without the rule it contributes no
    // station; the rule gives it the bar station.
    let devices = vec![
        make_device("d-grill", vec!["station-grill"]),
        make_device("d-bar", vec!["station-bar"]),
    ];
    let items = vec![make_line_item("COCKTAIL")];
    let rules = vec![make_rule(
        "r-1",
        1,
        KdsRuleMatcher::Sku,
        "COCKTAIL",
        "station-bar",
        true,
    )];
    let targets =
        resolve_kds_targets_with_rules(&items, &devices, &rules, zone_fixture, no_category);
    assert_eq!(targets, vec!["d-bar"]);
}

#[test]
fn sku_rule_overrides_the_zone_default_for_its_line() {
    // BURGER's zone says grill; a higher-priority rule reroutes it to the
    // fryer. The steak line keeps its zone default — rules are per line.
    let devices = vec![
        make_device("d-grill", vec!["station-grill"]),
        make_device("d-fryer", vec!["station-fryer"]),
    ];
    let items = vec![make_line_item("BURGER"), make_line_item("STEAK")];
    let rules = vec![make_rule(
        "r-1",
        1,
        KdsRuleMatcher::Sku,
        "BURGER",
        "station-fryer",
        true,
    )];
    let targets =
        resolve_kds_targets_with_rules(&items, &devices, &rules, zone_fixture, no_category);
    assert!(targets.contains(&"d-fryer".to_string()));
    assert!(targets.contains(&"d-grill".to_string()));
    assert_eq!(targets.len(), 2);
}

#[test]
fn split_routing_burger_kitchen_cocktail_bar() {
    // The flagship scenario from the work order, without touching catalog
    // data: cocktail lines to the Bar device, burger to Kitchen.
    let devices = vec![
        make_device("d-kitchen", vec!["station-kitchen"]),
        make_device("d-bar", vec!["station-bar"]),
    ];
    let items = vec![make_line_item("BURGER"), make_line_item("COCKTAIL")];
    let rules = vec![make_rule(
        "r-bar",
        5,
        KdsRuleMatcher::Sku,
        "COCKTAIL",
        "station-bar",
        true,
    )];
    let targets = resolve_kds_targets_with_rules(
        &items,
        &devices,
        &rules,
        |sku| {
            if sku == "BURGER" {
                Some("station-kitchen".into())
            } else {
                None
            }
        },
        no_category,
    );
    assert!(targets.contains(&"d-kitchen".to_string()));
    assert!(targets.contains(&"d-bar".to_string()));
    assert_eq!(targets.len(), 2);
}

#[test]
fn category_rule_matches_lines_by_category_id() {
    // Every line in category "cat-drinks" routes to the bar, whatever its
    // zone says (or not). No zone fixture for these lines: category alone
    // supplies the station.
    let devices = vec![
        make_device("d-grill", vec!["station-grill"]),
        make_device("d-bar", vec!["station-bar"]),
    ];
    let items = vec![make_line_item("MOJITO"), make_line_item("BURGER")];
    let rules = vec![make_rule(
        "r-cat",
        1,
        KdsRuleMatcher::Category,
        "cat-drinks",
        "station-bar",
        true,
    )];
    let targets = resolve_kds_targets_with_rules(&items, &devices, &rules, zone_fixture, |sku| {
        if sku == "MOJITO" {
            Some("cat-drinks".into())
        } else {
            None
        }
    });
    assert!(targets.contains(&"d-bar".to_string()));
    assert!(targets.contains(&"d-grill".to_string()));
}

#[test]
fn lower_priority_number_wins() {
    // Two rules match BURGER; priority 1 (fryer) outranks priority 9 (bar).
    let devices = vec![
        make_device("d-fryer", vec!["station-fryer"]),
        make_device("d-bar", vec!["station-bar"]),
    ];
    let items = vec![make_line_item("BURGER")];
    let rules = vec![
        make_rule(
            "r-low",
            9,
            KdsRuleMatcher::Sku,
            "BURGER",
            "station-bar",
            true,
        ),
        make_rule(
            "r-high",
            1,
            KdsRuleMatcher::Sku,
            "BURGER",
            "station-fryer",
            true,
        ),
    ];
    let targets =
        resolve_kds_targets_with_rules(&items, &devices, &rules, zone_fixture, no_category);
    assert_eq!(targets, vec!["d-fryer"]);
}

#[test]
fn sku_matcher_outranks_category_at_equal_priority() {
    // Same priority: the more specific matcher wins regardless of order.
    let devices = vec![
        make_device("d-grill", vec!["station-grill"]),
        make_device("d-bar", vec!["station-bar"]),
    ];
    let items = vec![make_line_item("SIGNATURE"); 1];
    let rules = vec![
        make_rule(
            "r-cat",
            3,
            KdsRuleMatcher::Category,
            "cat-sig",
            "station-bar",
            true,
        ),
        make_rule(
            "r-sku",
            3,
            KdsRuleMatcher::Sku,
            "SIGNATURE",
            "station-grill",
            true,
        ),
    ];
    let targets = resolve_kds_targets_with_rules(&items, &devices, &rules, no_zone, |sku| {
        if sku == "SIGNATURE" {
            Some("cat-sig".into())
        } else {
            None
        }
    });
    assert_eq!(targets, vec!["d-grill"]);
}

fn no_zone(_: &str) -> Option<String> {
    None
}

#[test]
fn inactive_rule_is_ignored() {
    let devices = vec![
        make_device("d-grill", vec!["station-grill"]),
        make_device("d-bar", vec!["station-bar"]),
    ];
    let items = vec![make_line_item("BURGER")];
    let rules = vec![make_rule(
        "r-off",
        1,
        KdsRuleMatcher::Sku,
        "BURGER",
        "station-bar",
        false,
    )];
    // Inactive rule must not pull the line off its zone default.
    let targets =
        resolve_kds_targets_with_rules(&items, &devices, &rules, zone_fixture, no_category);
    assert_eq!(targets, vec!["d-grill"]);
}

#[test]
fn tag_rule_never_matches_while_tags_are_unmodeled() {
    // Stamped semantics: 'tag' is admitted by the table CHECK but the
    // catalog has no tags — the line must fall back to its zone default.
    let devices = vec![make_device("d-grill", vec!["station-grill"])];
    let items = vec![make_line_item("BURGER")];
    let rules = vec![make_rule(
        "r-tag",
        1,
        KdsRuleMatcher::Tag,
        "spicy",
        "station-bar",
        true,
    )];
    let targets =
        resolve_kds_targets_with_rules(&items, &devices, &rules, zone_fixture, no_category);
    assert_eq!(targets, vec!["d-grill"]);
}

#[test]
fn rule_station_claimed_by_no_device_still_triggers_catch_all() {
    // A rule can name a station no device serves; composing means phase 3
    // behaves exactly as it does for an unroutable zone.
    let devices = vec![
        make_device("d-grill", vec!["station-grill"]),
        make_device("d-bar", vec!["station-bar"]),
    ];
    let items = vec![make_line_item("BURGER")];
    let rules = vec![make_rule(
        "r-ghost",
        1,
        KdsRuleMatcher::Sku,
        "BURGER",
        "station-ghost",
        true,
    )];
    let targets =
        resolve_kds_targets_with_rules(&items, &devices, &rules, zone_fixture, no_category);
    assert!(targets.contains(&"d-grill".to_string()));
    assert!(targets.contains(&"d-bar".to_string()));
    assert_eq!(targets.len(), 2);
}

#[test]
fn rule_matcher_kind_db_roundtrip() {
    for m in [
        KdsRuleMatcher::Sku,
        KdsRuleMatcher::Category,
        KdsRuleMatcher::Tag,
    ] {
        assert_eq!(KdsRuleMatcher::parse_db(m.as_str()), Some(m));
    }
    assert_eq!(KdsRuleMatcher::parse_db("bogus"), None);
    assert_eq!(KdsRuleMatcher::Sku.as_str(), "sku");
    assert_eq!(KdsRuleMatcher::Category.as_str(), "category");
    assert_eq!(KdsRuleMatcher::Tag.as_str(), "tag");
}

#[test]
fn routing_rule_serde_roundtrip() {
    let rule = make_rule(
        "r-1",
        1,
        KdsRuleMatcher::Category,
        "cat-drinks",
        "station-bar",
        true,
    );
    let json = serde_json::to_string(&rule).unwrap();
    assert!(
        json.contains("\"category\""),
        "matcher must be snake_case: {json}"
    );
    let back: KdsRoutingRule = serde_json::from_str(&json).unwrap();
    assert_eq!(back, rule);
}

#[test]
fn routing_rule_input_defaults_to_active() {
    // Omitted is_active must mean active — mirroring the column default.
    let input: KdsRoutingRuleInput = serde_json::from_str(
        r#"{"priority":1,"matcher":"sku","matcher_value":"BURGER","target_station":"station-grill"}"#,
    )
    .unwrap();
    assert!(input.is_active);
    assert_eq!(input.matcher, KdsRuleMatcher::Sku);
}
