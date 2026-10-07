//! Integration tests for distributed table and held cart lease protocol over LAN.

use kasirmu_lan::{
    LanClientConfig, LanEvent, LanEventForwarder, TableLeaseTracker, TableLockAcquired,
    TableLockReleased, TableSyncEvent, start_lan_client,
};
use std::sync::{Arc, RwLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

fn now_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

#[tokio::test]
async fn distributed_table_leases_sync_and_reconcile_over_lan() {
    let port = 19189;
    let bind_addr = format!("127.0.0.1:{port}");
    let psk = "lease-secret-token";

    let tracker = Arc::new(RwLock::new(TableLeaseTracker::new()));
    let tracker_provider = tracker.clone();
    let lease_provider = Arc::new(move || {
        let now_ms = now_epoch_ms();
        tracker_provider.read().unwrap().active_leases(now_ms)
    });

    let tracker_uplink = tracker.clone();
    let base_discover = kasirmu_lan::KdsDiscoverResponse {
        restaurant_pos_id: "pos-main".into(),
        devices: vec![],
        version: "0.0.41".into(),
        transports: vec!["noise-psk-v1".into()],
        active_queue: None,
        table_states: None,
        active_leases: None,
    };
    let discover_json = serde_json::to_string(&base_discover).unwrap();

    let forwarder = LanEventForwarder::new(bind_addr.clone(), Some(psk.into()))
        .with_discovery(discover_json)
        .with_table_leases(lease_provider);
    let handle = forwarder.handle();

    let forwarder_broadcast = handle.clone();
    let uplink_handler = Arc::new(move |raw: String| {
        let trimmed = raw.trim();
        if trimmed.starts_with(kasirmu_lan::TABLE_EVENT_TAG_PREFIX)
            && let Ok(ev) = serde_json::from_str::<TableSyncEvent>(trimmed)
        {
            let now_ms = now_epoch_ms();
            match &ev {
                TableSyncEvent::LockAcquired(lock) => {
                    let mut trk = tracker_uplink.write().unwrap();
                    let _ = trk.try_acquire(lock.clone(), now_ms);
                }
                TableSyncEvent::LockReleased(rel) => {
                    let mut trk = tracker_uplink.write().unwrap();
                    let _ = trk.release(rel);
                }
                _ => {}
            }
        }
        forwarder_broadcast.broadcast(raw);
    });

    let forwarder = forwarder.with_uplink_handler(uplink_handler);
    tokio::spawn(forwarder.run());

    // Give server a moment to bind
    tokio::time::sleep(Duration::from_millis(50)).await;

    // ── Terminal A connects ──
    let config_a = LanClientConfig {
        server_addr: bind_addr.clone(),
        psk: Some(psk.into()),
        device_id: Some("term-waiter-1".into()),
        station_ids: vec![],
        want_queue: false,
        want_tables: true,
    };
    let (client_a, mut rx_a) = start_lan_client(config_a);

    // Drain discovery on A
    let ev = tokio::time::timeout(Duration::from_secs(3), rx_a.recv())
        .await
        .expect("term A discovery timeout")
        .expect("term A rx error");
    assert!(matches!(ev, LanEvent::Discovery(_)));

    // ── Terminal B connects ──
    let config_b = LanClientConfig {
        server_addr: bind_addr.clone(),
        psk: Some(psk.into()),
        device_id: Some("term-waiter-2".into()),
        station_ids: vec![],
        want_queue: false,
        want_tables: true,
    };
    let (client_b, mut rx_b) = start_lan_client(config_b);

    // Drain discovery on B
    let ev = tokio::time::timeout(Duration::from_secs(3), rx_b.recv())
        .await
        .expect("term B discovery timeout")
        .expect("term B rx error");
    assert!(matches!(ev, LanEvent::Discovery(_)));

    // ── Terminal A acquires lease on Table 12 ──
    let lock_a = TableLockAcquired {
        table_id: "table-12".into(),
        terminal_id: "term-waiter-1".into(),
        terminal_label: Some("Waiter 1 iPad".into()),
        held_cart_id: Some("cart-xyz-88".into()),
        lease_ttl_ms: 30000,
        acquired_at: "2026-10-07T00:00:00Z".into(),
    };
    let lock_a_event = TableSyncEvent::LockAcquired(lock_a.clone());
    let lock_a_json = serde_json::to_string(&lock_a_event).unwrap();
    client_a.send_async(lock_a_json).await.unwrap();

    // Terminal B must receive LockAcquired broadcast
    let received_b = tokio::time::timeout(Duration::from_secs(3), rx_b.recv())
        .await
        .expect("term B receive timeout")
        .expect("term B receive error");
    match received_b {
        LanEvent::Table(TableSyncEvent::LockAcquired(acquired)) => {
            assert_eq!(acquired.table_id, "table-12");
            assert_eq!(acquired.terminal_id, "term-waiter-1");
            assert_eq!(acquired.held_cart_id, Some("cart-xyz-88".into()));
        }
        other => panic!("expected LockAcquired on terminal B, got {other:?}"),
    }

    // ── Terminal B attempts conflicting acquisition on Table 12 ──
    let lock_b = TableLockAcquired {
        table_id: "table-12".into(),
        terminal_id: "term-waiter-2".into(),
        terminal_label: Some("Waiter 2 Pixel".into()),
        held_cart_id: None,
        lease_ttl_ms: 30000,
        acquired_at: "2026-10-07T00:00:05Z".into(),
    };
    {
        let mut trk = tracker.write().unwrap();
        let acquire_res = trk.try_acquire(lock_b, now_epoch_ms());
        assert!(acquire_res.is_err(), "Terminal B acquisition must conflict");
        let conflict = acquire_res.unwrap_err();
        assert_eq!(conflict.terminal_id, "term-waiter-1");
    }

    // ── Terminal A releases lease on Table 12 ──
    let release_a = TableLockReleased {
        table_id: "table-12".into(),
        terminal_id: "term-waiter-1".into(),
        released_at: "2026-10-07T00:01:00Z".into(),
    };
    let release_a_event = TableSyncEvent::LockReleased(release_a.clone());
    let release_a_json = serde_json::to_string(&release_a_event).unwrap();
    client_a.send_async(release_a_json).await.unwrap();

    // Terminal B must receive LockReleased broadcast
    let received_rel_b = tokio::time::timeout(Duration::from_secs(3), rx_b.recv())
        .await
        .expect("term B release timeout")
        .expect("term B release error");
    match received_rel_b {
        LanEvent::Table(TableSyncEvent::LockReleased(rel)) => {
            assert_eq!(rel.table_id, "table-12");
            assert_eq!(rel.terminal_id, "term-waiter-1");
        }
        other => panic!("expected LockReleased on terminal B, got {other:?}"),
    }

    // ── Terminal B now successfully acquires Table 12 ──
    let lock_b_success = TableLockAcquired {
        table_id: "table-12".into(),
        terminal_id: "term-waiter-2".into(),
        terminal_label: Some("Waiter 2 Pixel".into()),
        held_cart_id: None,
        lease_ttl_ms: 30000,
        acquired_at: "2026-10-07T00:01:05Z".into(),
    };
    let lock_b_event = TableSyncEvent::LockAcquired(lock_b_success.clone());
    let lock_b_json = serde_json::to_string(&lock_b_event).unwrap();
    client_b.send_async(lock_b_json).await.unwrap();

    // Wait for tracker to record B's lease
    tokio::time::sleep(Duration::from_millis(50)).await;

    // ── Terminal C connects with want_tables: true and reconciles active_leases ──
    let config_c = LanClientConfig {
        server_addr: bind_addr.clone(),
        psk: Some(psk.into()),
        device_id: Some("term-waiter-3".into()),
        station_ids: vec![],
        want_queue: false,
        want_tables: true,
    };
    let (_client_c, mut rx_c) = start_lan_client(config_c);

    let ev_c = tokio::time::timeout(Duration::from_secs(3), rx_c.recv())
        .await
        .expect("term C discovery timeout")
        .expect("term C rx error");
    match ev_c {
        LanEvent::Discovery(discovery) => {
            let leases = discovery
                .active_leases
                .expect("active_leases must be present");
            assert_eq!(leases.len(), 1);
            assert_eq!(leases[0].table_id, "table-12");
            assert_eq!(leases[0].terminal_id, "term-waiter-2");
        }
        other => panic!("expected Discovery on terminal C, got {other:?}"),
    }

    client_a.stop();
    client_b.stop();
}
