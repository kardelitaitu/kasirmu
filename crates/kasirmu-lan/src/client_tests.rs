use std::time::Duration;
use tokio::time::timeout;

use super::*;
use crate::table_sync::{TableStatusChanged, TableSyncEvent};
use crate::{KdsDiscoverResponse, LanEventForwarder};
use kasirmu_core::Table;

fn sample_table() -> Table {
    Table {
        id: "tbl-live".into(),
        name: "Table 5".into(),
        capacity: 2,
        pos_x: 10.0,
        pos_y: 20.0,
        shape: "circle".into(),
        width: 10.0,
        height: 10.0,
        status: "available".into(),
        active_sale_id: None,
        section: "Patio".into(),
        active: true,
        sort_order: 1,
        created_at: "2026-10-06T00:00:00Z".into(),
        updated_at: "2026-10-06T01:00:00Z".into(),
    }
}

#[test]
fn lan_event_parse_identifies_types() {
    let table_ev = TableSyncEvent::StatusChanged(TableStatusChanged {
        table: sample_table(),
        occurred_at: "2026-10-06T01:00:00Z".into(),
    });
    let table_json = serde_json::to_string(&table_ev).unwrap();

    let parsed = LanEvent::parse(&table_json);
    match parsed {
        LanEvent::Table(TableSyncEvent::StatusChanged(ev)) => {
            assert_eq!(ev.table.id, "tbl-live");
            assert_eq!(ev.occurred_at, "2026-10-06T01:00:00Z");
        }
        other => panic!("expected Table event, got {other:?}"),
    }

    let raw_json = r#"{"sale_id":"s-1","total_minor":500}"#;
    match LanEvent::parse(raw_json) {
        LanEvent::RawJson(s) => assert_eq!(s, raw_json),
        other => panic!("expected RawJson event, got {other:?}"),
    }
}

#[tokio::test]
async fn lan_client_noise_connects_and_receives_table_event() {
    let port = 19181;
    let bind_addr = format!("127.0.0.1:{port}");
    let psk = "secret-passphrase";

    let discover = KdsDiscoverResponse {
        restaurant_pos_id: "pos-1".into(),
        devices: vec![],
        version: "0.0.41".into(),
        transports: vec!["noise-psk-v1".into()],
        active_queue: None,
        table_states: None,
        active_leases: None,
    };
    let discover_json = serde_json::to_string(&discover).unwrap();

    let forwarder =
        LanEventForwarder::new(bind_addr.clone(), Some(psk.into())).with_discovery(discover_json);
    let handle = forwarder.handle();
    tokio::spawn(forwarder.run());

    // Give server a moment to bind
    tokio::time::sleep(Duration::from_millis(50)).await;

    let config = LanClientConfig {
        server_addr: bind_addr,
        psk: Some(psk.into()),
        device_id: Some("tablet-a".into()),
        station_ids: vec![],
        want_queue: false,
        want_tables: false,
    };

    let (client_handle, mut event_rx) = start_lan_client(config);

    // First event should be discovery
    let first = timeout(Duration::from_secs(2), event_rx.recv())
        .await
        .expect("timed out waiting for discovery")
        .expect("channel error");

    match first {
        LanEvent::Discovery(d) => assert_eq!(d.restaurant_pos_id, "pos-1"),
        other => panic!("expected discovery event, got {other:?}"),
    }

    // Now server broadcasts a table event
    let mut table = sample_table();
    table.status = "occupied".into();
    table.active_sale_id = Some("sale-42".into());

    let status_event = TableSyncEvent::StatusChanged(TableStatusChanged {
        table: table.clone(),
        occurred_at: "2026-10-06T02:00:00Z".into(),
    });
    handle.broadcast(serde_json::to_string(&status_event).unwrap());

    let second = timeout(Duration::from_secs(2), event_rx.recv())
        .await
        .expect("timed out waiting for table event")
        .expect("channel error");

    match second {
        LanEvent::Table(TableSyncEvent::StatusChanged(ev)) => {
            assert_eq!(ev.table.status, "occupied");
            assert_eq!(ev.table.active_sale_id.as_deref(), Some("sale-42"));
        }
        other => panic!("expected Table event, got {other:?}"),
    }

    client_handle.stop();
}

#[tokio::test]
async fn lan_client_plain_connects_and_receives_event() {
    let port = 19182;
    let bind_addr = format!("127.0.0.1:{port}");

    let forwarder = LanEventForwarder::new(bind_addr.clone(), None);
    let handle = forwarder.handle();
    tokio::spawn(forwarder.run());

    tokio::time::sleep(Duration::from_millis(50)).await;

    let config = LanClientConfig {
        server_addr: bind_addr,
        psk: None,
        device_id: Some("tablet-b".into()),
        station_ids: vec![],
        want_queue: false,
        want_tables: false,
    };

    let (client_handle, mut event_rx) = start_lan_client(config);

    let mut table = sample_table();
    table.status = "cleaning".into();

    let status_event = TableSyncEvent::StatusChanged(TableStatusChanged {
        table: table.clone(),
        occurred_at: "2026-10-06T03:00:00Z".into(),
    });

    // Wait a brief moment for connection to establish before broadcasting
    tokio::time::sleep(Duration::from_millis(100)).await;
    handle.broadcast(serde_json::to_string(&status_event).unwrap());

    let received = timeout(Duration::from_secs(2), event_rx.recv())
        .await
        .expect("timed out waiting for table event")
        .expect("channel error");

    match received {
        LanEvent::Table(TableSyncEvent::StatusChanged(ev)) => {
            assert_eq!(ev.table.status, "cleaning");
        }
        other => panic!("expected Table event, got {other:?}"),
    }

    client_handle.stop();
}

#[tokio::test]
async fn lan_client_sends_uplink_and_triggers_server_handler() {
    let port = 19183;
    let bind_addr = format!("127.0.0.1:{port}");
    let (uplink_received_tx, mut uplink_received_rx) = tokio::sync::mpsc::channel(10);

    let discover = KdsDiscoverResponse {
        restaurant_pos_id: "pos-1".into(),
        devices: vec![],
        version: "0.0.41".into(),
        transports: vec!["noise-psk-v1".into()],
        active_queue: None,
        table_states: None,
        active_leases: None,
    };
    let discover_json = serde_json::to_string(&discover).unwrap();

    let forwarder = LanEventForwarder::new(bind_addr.clone(), Some("secret-uplink".into()))
        .with_discovery(discover_json)
        .with_uplink_handler(Arc::new(move |msg| {
            let _ = uplink_received_tx.try_send(msg);
        }));
    tokio::spawn(forwarder.run());

    tokio::time::sleep(Duration::from_millis(50)).await;

    let config = LanClientConfig {
        server_addr: bind_addr,
        psk: Some("secret-uplink".into()),
        device_id: Some("tablet-kds".into()),
        station_ids: vec!["grill".into()],
        want_queue: false,
        want_tables: false,
    };

    let (client_handle, _event_rx) = start_lan_client(config);

    // Wait for client to connect
    tokio::time::sleep(Duration::from_millis(150)).await;

    // Send KdsLineItemBumped uplink event
    let bump_event = r#"{"type":"kds.line_item_bumped","kds_order_id":"ord-1","sale_id":"sale-1","line_item_id":"line-1","stations":["grill"],"to_status":"prepared","bumped_by":"tablet-kds","occurred_at":"2026-10-06T04:00:00Z"}"#;
    client_handle
        .send(bump_event.to_string())
        .expect("send failed");

    let received = timeout(Duration::from_secs(3), uplink_received_rx.recv())
        .await
        .expect("timed out waiting for uplink event")
        .expect("channel closed");

    assert!(received.contains("kds.line_item_bumped"));
    assert!(received.contains("prepared"));
    assert!(received.contains("tablet-kds"));

    client_handle.stop();
}
