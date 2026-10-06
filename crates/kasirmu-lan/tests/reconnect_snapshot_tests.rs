//! Integration tests for LAN reconnect snapshots and failure recovery.

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;
use tokio::time::timeout;

use kasirmu_core::Table;
use kasirmu_core::kds::{KdsLineItem, KdsOrder};
use kasirmu_lan::table_sync::{TableStatusChanged, TableSyncEvent};
use kasirmu_lan::{
    KdsDiscoverResponse, KdsQueueProvider, KdsQueueSnapshot, KdsQueueTicket, LanClientConfig,
    LanEvent, LanEventForwarder, TableStateProvider, start_lan_client,
};

fn sample_table(id: &str, name: &str, status: &str) -> Table {
    Table {
        id: id.into(),
        name: name.into(),
        capacity: 4,
        pos_x: 20.0,
        pos_y: 30.0,
        shape: "square".into(),
        width: 10.0,
        height: 10.0,
        status: status.into(),
        active_sale_id: None,
        section: "Main Dining".into(),
        active: true,
        sort_order: 1,
        created_at: "2026-10-07T00:00:00Z".into(),
        updated_at: "2026-10-07T01:00:00Z".into(),
    }
}

fn sample_order(id: &str) -> KdsOrder {
    KdsOrder {
        id: id.into(),
        sale_id: "sale-1".into(),
        store_id: Some("store-1".into()),
        target_instance_id: Some("bar".into()),
        status: "preparing".into(),
        items_summary: "1x Espresso".into(),
        item_count: 1,
        display_number: Some(1),
        ticket_prefix: "A".into(),
        received_at: "2026-10-07T02:50:00Z".into(),
        started_at: None,
        ready_at: None,
        served_at: None,
        prep_time_seconds: 0,
        kitchen_zone: Some("beverage".into()),
        notes: String::new(),
        table_number: Some("Table 2".into()),
        priority: false,
    }
}

fn sample_line(kds_order_id: &str) -> KdsLineItem {
    KdsLineItem {
        id: "line-1".into(),
        kds_order_id: kds_order_id.into(),
        sku: "ESP".into(),
        display_name: "Espresso".into(),
        qty: 1,
        course: None,
        modifiers: vec![],
        line_position: 1,
        item_status: "preparing".into(),
        started_at: None,
        ready_at: None,
        served_at: None,
        created_at: "2026-10-07T02:50:00Z".into(),
    }
}

#[tokio::test]
async fn reconnect_fetches_fresh_table_snapshot_and_reconciles() {
    let port = 19186;
    let bind_addr = format!("127.0.0.1:{port}");
    let psk = "reconnect-secret";

    let state_version = Arc::new(AtomicUsize::new(0));
    let state_version_clone = state_version.clone();

    let table_provider: TableStateProvider = Arc::new(move || {
        let ver = state_version_clone.load(Ordering::SeqCst);
        if ver == 0 {
            vec![
                sample_table("t-1", "Table 1", "available"),
                sample_table("t-2", "Table 2", "occupied"),
            ]
        } else {
            vec![
                sample_table("t-1", "Table 1", "cleaning"),
                sample_table("t-2", "Table 2", "available"),
            ]
        }
    });

    let kds_provider: KdsQueueProvider = Arc::new(|| KdsQueueSnapshot {
        generated_at: "2026-10-07T03:00:00Z".into(),
        tickets: vec![KdsQueueTicket {
            order: sample_order("kds-1"),
            line_items: vec![sample_line("kds-1")],
            stations: vec!["bar".into()],
        }],
    });

    let base_discover = KdsDiscoverResponse {
        restaurant_pos_id: "pos-main".into(),
        devices: vec![],
        version: "0.0.41".into(),
        transports: vec!["noise-psk-v1".into()],
        active_queue: None,
        table_states: None,
    };
    let discover_json = serde_json::to_string(&base_discover).unwrap();

    let forwarder = LanEventForwarder::new(bind_addr.clone(), Some(psk.into()))
        .with_discovery(discover_json)
        .with_kds_queue(kds_provider)
        .with_table_provider(table_provider);
    let handle = forwarder.handle();
    tokio::spawn(forwarder.run());

    tokio::time::sleep(Duration::from_millis(50)).await;

    // First connection: Tablet opts in to both want_tables and want_queue
    let config = LanClientConfig {
        server_addr: bind_addr.clone(),
        psk: Some(psk.into()),
        device_id: Some("tablet-waiter".into()),
        station_ids: vec![],
        want_queue: true,
        want_tables: true,
    };
    let (client_1, mut rx_1) = start_lan_client(config.clone());

    // Discovery event carries initial snapshots
    let first_ev = timeout(Duration::from_secs(2), rx_1.recv())
        .await
        .expect("timed out waiting for initial discovery")
        .expect("channel error");

    match first_ev {
        LanEvent::Discovery(discovery) => {
            let tables = discovery.table_states.expect("table_states must be present");
            assert_eq!(tables.len(), 2);
            assert_eq!(tables[0].id, "t-1");
            assert_eq!(tables[0].status, "available");
            assert_eq!(tables[1].id, "t-2");
            assert_eq!(tables[1].status, "occupied");

            let queue = discovery.active_queue.expect("active_queue must be present");
            assert_eq!(queue.tickets.len(), 1);
            assert_eq!(queue.tickets[0].order.id, "kds-1");
        }
        other => panic!("expected LanEvent::Discovery, got {other:?}"),
    }

    // Live event while connected: Table 1 gets occupied
    let live_ev = TableSyncEvent::StatusChanged(TableStatusChanged {
        table: sample_table("t-1", "Table 1", "occupied"),
        occurred_at: "2026-10-07T03:05:00Z".into(),
    });
    handle.broadcast(serde_json::to_string(&live_ev).unwrap());

    let received_live = timeout(Duration::from_secs(2), rx_1.recv())
        .await
        .expect("timed out waiting for live table event")
        .expect("channel error");
    match received_live {
        LanEvent::Table(TableSyncEvent::StatusChanged(sc)) => {
            assert_eq!(sc.table.id, "t-1");
            assert_eq!(sc.table.status, "occupied");
        }
        other => panic!("expected LanEvent::Table, got {other:?}"),
    }

    // Tablet disconnects (e.g. Wi-Fi drop / sleep)
    client_1.stop();
    tokio::time::sleep(Duration::from_millis(50)).await;

    // While tablet is offline, restaurant operations advance state:
    state_version.store(1, Ordering::SeqCst);

    // Tablet reconnects!
    let (client_2, mut rx_2) = start_lan_client(config);

    // Tablet receives refreshed discovery snapshot reconciling all missed state
    let reconnect_ev = timeout(Duration::from_secs(2), rx_2.recv())
        .await
        .expect("timed out waiting for reconnect discovery")
        .expect("channel error");

    match reconnect_ev {
        LanEvent::Discovery(discovery) => {
            let tables = discovery.table_states.expect("reconnect table_states must be present");
            assert_eq!(tables.len(), 2);
            assert_eq!(tables[0].id, "t-1");
            assert_eq!(tables[0].status, "cleaning"); // Reconciled!
            assert_eq!(tables[1].id, "t-2");
            assert_eq!(tables[1].status, "available"); // Reconciled!
        }
        other => panic!("expected LanEvent::Discovery, got {other:?}"),
    }

    client_2.stop();
}
