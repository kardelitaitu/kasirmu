//! Integration tests for LAN CRDT delta broadcast and multi-terminal replication.

use std::sync::Arc;
use std::time::Duration;
use tokio::time::timeout;

use kasirmu_core::offline::{OfflineQueueItem, OfflineQueueStatus, SyncPriority};
use kasirmu_lan::crdt_sync::{CrdtDeltaBroadcast, CrdtSyncEvent, EVENT_CRDT_DELTA_BROADCAST};
use kasirmu_lan::{
    LanClientConfig, LanEvent, LanEventForwarder, start_lan_client,
};

fn sample_item(id: &str, action: &str, payload: &str, terminal: &str) -> OfflineQueueItem {
    OfflineQueueItem {
        id: id.into(),
        action: action.into(),
        payload: payload.into(),
        status: OfflineQueueStatus::Pending,
        retry_count: 0,
        last_error: None,
        tenant_id: "default".into(),
        created_at: "2026-10-07T02:00:00Z".into(),
        synced_at: None,
        priority: SyncPriority::Normal,
        origin_terminal_id: Some(terminal.into()),
    }
}

#[tokio::test]
async fn crdt_delta_broadcast_replicates_to_peer_terminals() {
    let port = 19185;
    let bind_addr = format!("127.0.0.1:{port}");
    let psk = "crdt-sync-secret";

    let (uplink_tx, mut uplink_rx) = tokio::sync::mpsc::channel(10);
    let forwarder = LanEventForwarder::new(bind_addr.clone(), Some(psk.into()))
        .with_uplink_handler(Arc::new(move |raw| {
            let _ = uplink_tx.try_send(raw);
        }));
    let handle = forwarder.handle();
    tokio::spawn(forwarder.run());

    tokio::time::sleep(Duration::from_millis(50)).await;

    // Terminal A: Waiter Tablet
    let config_a = LanClientConfig {
        server_addr: bind_addr.clone(),
        psk: Some(psk.into()),
        device_id: Some("tablet-a".into()),
        station_ids: vec![],
        want_queue: false,
        want_tables: true,
    };
    let (client_a, mut rx_a) = start_lan_client(config_a);

    // Terminal B: Counter POS
    let config_b = LanClientConfig {
        server_addr: bind_addr.clone(),
        psk: Some(psk.into()),
        device_id: Some("pos-counter".into()),
        station_ids: vec![],
        want_queue: false,
        want_tables: true,
    };
    let (client_b, mut rx_b) = start_lan_client(config_b);

    // Wait for discovery messages on both clients
    let _ = timeout(Duration::from_secs(2), rx_a.recv()).await;
    let _ = timeout(Duration::from_secs(2), rx_b.recv()).await;

    // Terminal A performs a stock adjustment mutation and uplinks delta broadcast
    let item_a = sample_item("q-item-1", "stock.adjusted", r#"{"sku":"COFFEE","qty_delta":-2}"#, "tablet-a");
    let delta_a = CrdtSyncEvent::DeltaBroadcast(CrdtDeltaBroadcast {
        batch: vec![item_a],
        origin_terminal_id: "tablet-a".into(),
        occurred_at: "2026-10-07T02:00:00Z".into(),
    });
    let delta_json = serde_json::to_string(&delta_a).unwrap();
    client_a.send(delta_json.clone()).unwrap();

    // Server receives uplink from Terminal A
    let received_uplink = timeout(Duration::from_secs(2), uplink_rx.recv())
        .await
        .expect("server timed out receiving uplink")
        .expect("uplink channel closed");
    assert!(received_uplink.contains(EVENT_CRDT_DELTA_BROADCAST));
    assert!(received_uplink.contains("COFFEE"));

    // Server forwards delta to all peers (simulating desktop lib.rs forwarder broadcast)
    handle.broadcast(received_uplink);

    // Terminal B receives the replicated CRDT delta over LAN
    let event_on_b = timeout(Duration::from_secs(2), rx_b.recv())
        .await
        .expect("timed out waiting for crdt delta on peer")
        .expect("channel error");

    match event_on_b {
        LanEvent::Crdt(CrdtSyncEvent::DeltaBroadcast(b_delta)) => {
            assert_eq!(b_delta.origin_terminal_id, "tablet-a");
            assert_eq!(b_delta.batch.len(), 1);
            assert_eq!(b_delta.batch[0].id, "q-item-1");
            assert_eq!(b_delta.batch[0].payload, r#"{"sku":"COFFEE","qty_delta":-2}"#);
        }
        other => panic!("expected LanEvent::Crdt, got {other:?}"),
    }

    client_a.stop();
    client_b.stop();
}
