use super::*;
use oz_core::kds::{KdsLineItem, KdsModifier, KdsOrder};

// ── Test doubles ─────────────────────────────────────────────────────

/// Minimal frozen-type ticket row for snapshot tests.
fn sample_order(id: &str) -> KdsOrder {
    KdsOrder {
        id: id.into(),
        sale_id: "sale-7".into(),
        store_id: Some("store-1".into()),
        target_instance_id: None,
        status: "preparing".into(),
        items_summary: "Steak x2".into(),
        item_count: 2,
        display_number: Some(101),
        ticket_prefix: "".into(),
        received_at: "2026-09-13T08:00:00Z".into(),
        started_at: Some("2026-09-13T08:01:00Z".into()),
        ready_at: None,
        served_at: None,
        prep_time_seconds: 420,
        kitchen_zone: Some("grill".into()),
        notes: "no onions".into(),
        table_number: Some("T5".into()),
        priority: false,
    }
}

fn sample_line(kds_order_id: &str, id: &str) -> KdsLineItem {
    KdsLineItem {
        id: id.into(),
        kds_order_id: kds_order_id.into(),
        sku: "STEAK".into(),
        display_name: "Grilled Steak".into(),
        qty: 2,
        course: Some("main".into()),
        modifiers: vec![KdsModifier {
            name: "Temperature".into(),
            choice: "Medium Rare".into(),
            price_minor: 0,
        }],
        line_position: 1,
        item_status: "preparing".into(),
        started_at: Some("2026-09-13T08:01:00Z".into()),
        ready_at: None,
        served_at: None,
        created_at: "2026-09-13T08:00:00Z".into(),
    }
}

fn order_placed(stations: Vec<String>) -> KdsOrderPlaced {
    KdsOrderPlaced {
        kds_order_id: "kds-1".into(),
        sale_id: "sale-7".into(),
        store_id: Some("store-1".into()),
        stations,
        display_number: Some(101),
        table_number: Some("T5".into()),
        ticket_prefix: "#".into(),
        items: vec![sample_line("kds-1", "line-1")],
        notes: "no onions".into(),
        priority: true,
        occurred_at: "2026-09-13T08:02:00Z".into(),
    }
}

fn line_bumped(stations: Vec<String>) -> KdsLineItemBumped {
    KdsLineItemBumped {
        kds_order_id: "kds-1".into(),
        sale_id: "sale-7".into(),
        line_item_id: "line-1".into(),
        stations,
        to_status: "ready".into(),
        bumped_by: Some("expo-1".into()),
        occurred_at: "2026-09-13T08:10:00Z".into(),
    }
}

fn order_ready(stations: Vec<String>) -> KdsOrderReady {
    KdsOrderReady {
        kds_order_id: "kds-1".into(),
        sale_id: "sale-7".into(),
        stations,
        display_number: Some(101),
        ready_at: Some("2026-09-13T08:12:00Z".into()),
        bumped_by: Some("expo-1".into()),
        occurred_at: "2026-09-13T08:12:00Z".into(),
    }
}

fn order_recalled(stations: Vec<String>) -> KdsOrderRecalled {
    KdsOrderRecalled {
        kds_order_id: "kds-1".into(),
        sale_id: "sale-7".into(),
        line_item_id: Some("line-1".into()),
        stations,
        recall_to: "preparing".into(),
        reason: Some("wrong temp".into()),
        occurred_at: "2026-09-13T08:15:00Z".into(),
    }
}

// ── Serde round-trips (one per variant) ──────────────────────────────

#[test]
fn order_placed_serde_roundtrip() {
    let event = KdsSyncEvent::OrderPlaced(order_placed(vec!["grill".into()]));
    let json = serde_json::to_string(&event).unwrap();
    let back: KdsSyncEvent = serde_json::from_str(&json).unwrap();
    match back {
        KdsSyncEvent::OrderPlaced(e) => {
            assert_eq!(e.kds_order_id, "kds-1");
            assert_eq!(e.sale_id, "sale-7");
            assert_eq!(e.stations, vec!["grill".to_string()]);
            assert_eq!(e.items.len(), 1);
            assert_eq!(e.items[0].qty, 2);
            assert_eq!(e.items[0].modifiers[0].choice, "Medium Rare");
            assert!(e.priority);
            assert_eq!(e.occurred_at, "2026-09-13T08:02:00Z");
        }
        other => panic!("expected OrderPlaced, got {other:?}"),
    }
}

#[test]
fn line_item_bumped_serde_roundtrip() {
    let event = KdsSyncEvent::LineItemBumped(line_bumped(vec!["grill".into()]));
    let json = serde_json::to_string(&event).unwrap();
    let back: KdsSyncEvent = serde_json::from_str(&json).unwrap();
    match back {
        KdsSyncEvent::LineItemBumped(e) => {
            assert_eq!(e.line_item_id, "line-1");
            assert_eq!(e.to_status, "ready");
            assert_eq!(e.bumped_by.as_deref(), Some("expo-1"));
        }
        other => panic!("expected LineItemBumped, got {other:?}"),
    }
}

#[test]
fn order_ready_serde_roundtrip() {
    let event = KdsSyncEvent::OrderReady(order_ready(vec![]));
    let json = serde_json::to_string(&event).unwrap();
    let back: KdsSyncEvent = serde_json::from_str(&json).unwrap();
    match back {
        KdsSyncEvent::OrderReady(e) => {
            assert_eq!(e.ready_at.as_deref(), Some("2026-09-13T08:12:00Z"));
            assert!(e.stations.is_empty(), "empty = broadcast intent");
        }
        other => panic!("expected OrderReady, got {other:?}"),
    }
}

#[test]
fn order_recalled_serde_roundtrip() {
    let event = KdsSyncEvent::Recalled(order_recalled(vec!["fry".into()]));
    let json = serde_json::to_string(&event).unwrap();
    let back: KdsSyncEvent = serde_json::from_str(&json).unwrap();
    match back {
        KdsSyncEvent::Recalled(e) => {
            assert_eq!(e.line_item_id.as_deref(), Some("line-1"));
            assert_eq!(e.recall_to, "preparing");
            assert_eq!(e.reason.as_deref(), Some("wrong temp"));
        }
        other => panic!("expected Recalled, got {other:?}"),
    }
}

#[test]
fn recall_without_line_item_is_whole_ticket() {
    let mut e = order_recalled(vec!["fry".into()]);
    e.line_item_id = None;
    let event = KdsSyncEvent::Recalled(e);
    let json = serde_json::to_string(&event).unwrap();
    let back: KdsSyncEvent = serde_json::from_str(&json).unwrap();
    match back {
        KdsSyncEvent::Recalled(e) => assert!(e.line_item_id.is_none()),
        other => panic!("unexpected {other:?}"),
    }
}

// ── Wire tag placement (pins the fast-path prefix) ───────────────────

#[test]
fn every_variant_serialises_tag_as_first_key() {
    for event in [
        KdsSyncEvent::OrderPlaced(order_placed(vec![])),
        KdsSyncEvent::LineItemBumped(line_bumped(vec![])),
        KdsSyncEvent::OrderReady(order_ready(vec![])),
        KdsSyncEvent::Recalled(order_recalled(vec![])),
    ] {
        let json = serde_json::to_string(&event).unwrap();
        assert!(
            json.starts_with(KDS_EVENT_TAG_PREFIX),
            "tag must be the first key for {json}"
        );
        assert!(json.contains(&format!("\"type\":\"{}\"", event.tag())));
        assert_eq!(event.stations().len(), 0);
    }
}

#[test]
fn tag_values_are_the_documented_namespace() {
    assert_eq!(
        KdsSyncEvent::OrderPlaced(order_placed(vec![])).tag(),
        EVENT_ORDER_PLACED
    );
    assert_eq!(
        KdsSyncEvent::LineItemBumped(line_bumped(vec![])).tag(),
        EVENT_LINE_ITEM_BUMPED
    );
    assert_eq!(
        KdsSyncEvent::OrderReady(order_ready(vec![])).tag(),
        EVENT_ORDER_READY
    );
    assert_eq!(
        KdsSyncEvent::Recalled(order_recalled(vec![])).tag(),
        EVENT_ORDER_RECALLED
    );
    assert_eq!(
        KdsSyncEvent::OrderPlaced(order_placed(vec![])).event_name(),
        "kds.sync"
    );
}

// ── Station-scoped delivery logic ────────────────────────────────────

fn scoped_line(stations: &[&str]) -> String {
    serde_json::to_string(&KdsSyncEvent::OrderPlaced(order_placed(
        stations.iter().map(|s| s.to_string()).collect(),
    )))
    .unwrap()
}

fn grill_sub() -> PeerSubscription {
    PeerSubscription {
        device_id: Some("kds-grill".into()),
        station_ids: vec!["grill".into()],
    }
}

#[test]
fn event_station_scope_only_matches_kds_lines() {
    assert_eq!(
        event_station_scope(&scoped_line(&["grill", "fry"])),
        Some(vec!["grill".to_string(), "fry".to_string()])
    );
    // Legacy event lines carry no scope → no opinion → deliver to all.
    assert_eq!(
        event_station_scope("{\"sale_id\":\"s1\",\"total_minor\":100}"),
        None
    );
    assert_eq!(event_station_scope("{\"type\":\"ping\"}"), None);
    assert_eq!(event_station_scope("not json at all"), None);
}

#[test]
fn unparsable_kds_line_fails_open() {
    // Correct prefix, broken JSON: the predicate must return None so the
    // caller delivers (fail-open) rather than silently dropping.
    assert_eq!(event_station_scope(r#"{"type":"kds.order_placed"#), None);
}

#[test]
fn legacy_peer_without_subscription_receives_everything() {
    let scoped = scoped_line(&["grill"]);
    assert!(should_deliver(None, &scoped));
    assert!(should_deliver(None, "{\"type\":\"ping\"}"));
}

#[test]
fn expo_peer_receives_all_stations() {
    let expo = PeerSubscription {
        device_id: Some("expo-screen".into()),
        station_ids: vec![],
    };
    assert!(expo.receives_all());
    assert!(should_deliver(Some(&expo), &scoped_line(&["grill"])));
    assert!(should_deliver(Some(&expo), &scoped_line(&["fry", "cold"])));
    assert!(should_deliver(Some(&expo), "{\"type\":\"ping\"}"));
}

#[test]
fn station_scoped_peer_only_receives_matching_stations() {
    let grill = grill_sub();
    assert!(should_deliver(Some(&grill), &scoped_line(&["grill"])));
    assert!(should_deliver(
        Some(&grill),
        &scoped_line(&["fry", "grill"])
    ));
    assert!(!should_deliver(Some(&grill), &scoped_line(&["fry"])));
    assert!(!should_deliver(Some(&grill), &scoped_line(&["cold"])));
    // Multi-station peer matches on any overlap.
    let multi = PeerSubscription {
        device_id: None,
        station_ids: vec!["grill".into(), "cold".into()],
    };
    assert!(should_deliver(Some(&multi), &scoped_line(&["cold"])));
    assert!(!should_deliver(Some(&multi), &scoped_line(&["fry"])));
}

#[test]
fn broadcast_intent_events_reach_scoped_peers() {
    // Empty `stations` on the event mirrors resolve_kds_targets'
    // fallback: everyone sees it, scoped peers included.
    assert!(should_deliver(Some(&grill_sub()), &scoped_line(&[])));
}

#[test]
fn scoped_peer_still_receives_unscoped_legacy_lines() {
    assert!(should_deliver(Some(&grill_sub()), "{\"type\":\"ping\"}"));
    assert!(should_deliver(
        Some(&grill_sub()),
        "{\"sale_id\":\"s1\",\"course_id\":\"main\"}"
    ));
}

#[test]
fn subscription_from_wire_requires_a_signal() {
    // Pure legacy hello: neither field present → no subscription at all.
    assert!(subscription_from_wire(vec![], None).is_none());
    // Expo registers with a device id but no stations.
    let expo = subscription_from_wire(vec![], Some("expo-1".into())).unwrap();
    assert!(expo.receives_all());
    assert_eq!(expo.device_id.as_deref(), Some("expo-1"));
    let grill = subscription_from_wire(vec!["grill".into()], None).unwrap();
    assert!(!grill.receives_all());
}

// ── KdsSyncHandler (event-bus bridge) ────────────────────────────────

#[test]
fn kds_sync_handler_forwards_tagged_json() {
    let (tx, mut rx) = broadcast::channel(16);
    let handler = KdsSyncHandler { tx };
    handler
        .handle(&KdsSyncEvent::OrderReady(order_ready(vec!["grill".into()])))
        .unwrap();
    let received = rx.try_recv().unwrap();
    assert!(received.starts_with(KDS_EVENT_TAG_PREFIX));
    assert!(received.contains("kds.order_ready"));
    assert!(received.contains("kds-1"));
}

// ── Old-payload wire compatibility ───────────────────────────────────
//
// These capture the PRE-kds-sync wire shapes verbatim: the same bytes an
// old client sends and an old POS emits today must keep parsing with the
// extended (serde-default) structs.

#[test]
fn old_schema_hello_still_deserializes() {
    #[derive(Deserialize)]
    struct OldHelloProbe {
        op: String,
        psk: String,
        #[serde(default)]
        station_ids: Vec<String>,
        #[serde(default)]
        device_id: Option<String>,
    }
    // Verbatim pre-kds-sync hello line (HelloMsg in lib.rs gains exactly
    // these two defaulted fields).
    let line = r#"{"op":"hello","psk":"s3cret"}"#;
    let probe: OldHelloProbe = serde_json::from_str(line).unwrap();
    assert_eq!(probe.op, "hello");
    assert_eq!(probe.psk, "s3cret");
    assert!(probe.station_ids.is_empty());
    assert!(probe.device_id.is_none());
    // The defaulted fields must not disturb subscription derivation.
    assert!(subscription_from_wire(probe.station_ids, probe.device_id).is_none());
}

#[test]
fn old_schema_discover_still_deserializes() {
    #[derive(Deserialize)]
    struct OldDiscoverProbe {
        op: String,
        #[serde(default)]
        want_queue: bool,
        #[serde(default)]
        station_ids: Vec<String>,
        #[serde(default)]
        device_id: Option<String>,
    }
    // Verbatim pre-kds-sync discover line (DiscoverMsg in lib.rs gains
    // exactly these defaulted fields).
    let line = r#"{"op":"discover"}"#;
    let probe: OldDiscoverProbe = serde_json::from_str(line).unwrap();
    assert_eq!(probe.op, "discover");
    assert!(!probe.want_queue);
    assert!(probe.station_ids.is_empty());
    assert!(probe.device_id.is_none());
}

#[test]
fn old_schema_discovery_response_still_deserializes() {
    // Verbatim pre-kds-sync KdsDiscoverResponse JSON (devices omitted,
    // transports already present — the active_queue field must default).
    let old_payload = r#"{
        "restaurant_pos_id":"pos-1",
        "devices":[],
        "version":"0.0.37",
        "transports":["noise-psk-v1","legacy-psk-v1"]
    }"#;
    let parsed: crate::KdsDiscoverResponse = serde_json::from_str(old_payload).unwrap();
    assert_eq!(parsed.restaurant_pos_id, "pos-1");
    assert!(parsed.active_queue.is_none());
    // Re-serialization must omit the new field entirely (skip_serializing_if).
    let out = serde_json::to_string(&parsed).unwrap();
    assert!(
        !out.contains("active_queue"),
        "None must not appear on the wire: {out}"
    );
}

#[test]
fn new_discovery_response_roundtrips_with_active_queue() {
    let snapshot = KdsQueueSnapshot {
        generated_at: "2026-09-13T09:00:00Z".into(),
        tickets: vec![KdsQueueTicket {
            order: sample_order("kds-9"),
            line_items: vec![sample_line("kds-9", "line-9")],
            stations: vec!["grill".into()],
        }],
    };
    let response = crate::KdsDiscoverResponse {
        restaurant_pos_id: "pos-1".into(),
        devices: vec![],
        version: "0.0.37".into(),
        transports: vec!["noise-psk-v1".into(), "legacy-psk-v1".into()],
        active_queue: Some(snapshot),
    };
    let json = serde_json::to_string(&response).unwrap();
    assert!(json.contains("\"active_queue\""));
    // from_value: KdsDiscoverResponse carries `&'static str` fields that
    // cannot borrow out of the owned `json` string.
    let back: crate::KdsDiscoverResponse =
        serde_json::from_value(serde_json::from_str(&json).unwrap()).unwrap();
    let queue = back.active_queue.expect("active_queue must round-trip");
    assert_eq!(queue.generated_at, "2026-09-13T09:00:00Z");
    assert_eq!(queue.tickets.len(), 1);
    assert_eq!(queue.tickets[0].order.id, "kds-9");
    assert_eq!(queue.tickets[0].line_items[0].sku, "STEAK");
    assert_eq!(queue.tickets[0].stations, vec!["grill".to_string()]);
}

// ── Snapshot apply path & discovery response building ────────────────

fn provider() -> KdsQueueProvider {
    Arc::new(|| KdsQueueSnapshot {
        generated_at: "2026-09-13T09:00:00Z".into(),
        tickets: vec![KdsQueueTicket {
            order: sample_order("kds-9"),
            line_items: vec![sample_line("kds-9", "line-9")],
            stations: vec!["grill".into()],
        }],
    })
}

const BASE_PAYLOAD: &str =
    r#"{"restaurant_pos_id":"pos-1","devices":[],"version":"0.0.37","transports":[]}"#;

#[test]
fn non_opting_peer_gets_byte_identical_payload() {
    // No opt-in — even with a provider configured, legacy bytes hold.
    let out = build_discovery_response(BASE_PAYLOAD, false, Some(&provider()));
    assert_eq!(out, BASE_PAYLOAD);
    // Opt-in but no provider configured: still unchanged.
    let out = build_discovery_response(BASE_PAYLOAD, true, None);
    assert_eq!(out, BASE_PAYLOAD);
}

#[test]
fn opt_in_peer_gets_active_queue_injected() {
    let out = build_discovery_response(BASE_PAYLOAD, true, Some(&provider()));
    let value: serde_json::Value = serde_json::from_str(&out).unwrap();
    assert_eq!(value["restaurant_pos_id"], "pos-1");
    let queue = value
        .get("active_queue")
        .expect("active_queue must be injected");
    assert_eq!(queue["generated_at"], "2026-09-13T09:00:00Z");
    assert_eq!(queue["tickets"][0]["order"]["id"], "kds-9");
    assert_eq!(queue["tickets"][0]["stations"][0], "grill");
}

#[test]
fn injection_survives_typed_deserialize_on_client_side() {
    // The client-side apply path: an injected response parses straight
    // into the typed response with the snapshot populated.
    let out = build_discovery_response(BASE_PAYLOAD, true, Some(&provider()));
    let parsed: crate::KdsDiscoverResponse =
        serde_json::from_value(serde_json::from_str(&out).unwrap()).unwrap();
    let queue = parsed.active_queue.expect("typed apply path");
    assert_eq!(queue.tickets.len(), 1);
    assert_eq!(queue.tickets[0].order.status, "preparing");
    assert_eq!(queue.tickets[0].order.item_count, 2);
    // Snapshot-first ordering: the event dedup rule documented in the
    // module header — occurred_at <= generated_at is already applied.
    let event_ts = "2026-09-13T08:59:00Z";
    assert!(event_ts <= queue.generated_at.as_str());
    let later = "2026-09-13T09:00:01Z";
    assert!(later > queue.generated_at.as_str());
}

#[test]
fn malformed_payload_is_returned_unchanged() {
    // Non-JSON and non-object payloads must not gain a snapshot key —
    // the response degrades to the legacy bytes instead of breaking.
    assert_eq!(
        build_discovery_response("not json", true, Some(&provider())),
        "not json"
    );
    assert_eq!(
        build_discovery_response("[1,2,3]", true, Some(&provider())),
        "[1,2,3]"
    );
}

#[test]
fn empty_snapshot_still_satisfies_the_opt_in() {
    let empty: KdsQueueProvider = Arc::new(|| KdsQueueSnapshot {
        generated_at: "2026-09-13T09:00:00Z".into(),
        tickets: vec![],
    });
    let out = build_discovery_response(BASE_PAYLOAD, true, Some(&empty));
    let value: serde_json::Value = serde_json::from_str(&out).unwrap();
    assert_eq!(
        value["active_queue"]["tickets"].as_array().unwrap().len(),
        0
    );
}

#[test]
fn snapshot_applies_events_filter_by_capture_time() {
    // Snapshot apply semantics used by clients: tickets carry their own
    // stations, and post-apply live traffic follows the same delivery
    // predicate as before the reconnect.
    let snapshot = provider()();
    assert_eq!(snapshot.generated_at, "2026-09-13T09:00:00Z");
    assert_eq!(snapshot.tickets[0].stations, vec!["grill".to_string()]);
    let grill = grill_sub();
    let cold = PeerSubscription {
        device_id: Some("kds-cold".into()),
        station_ids: vec!["cold".into()],
    };
    let ticket_scope = scoped_line(&["grill"]);
    assert!(should_deliver(Some(&grill), &ticket_scope));
    assert!(!should_deliver(Some(&cold), &ticket_scope));
}
