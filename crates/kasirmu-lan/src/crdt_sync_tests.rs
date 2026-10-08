use super::*;
use kasirmu_core::offline::{OfflineQueueStatus, SyncPriority};

fn sample_item(id: &str, action: &str, payload: &str) -> OfflineQueueItem {
    OfflineQueueItem {
        id: id.into(),
        action: action.into(),
        payload: payload.into(),
        status: OfflineQueueStatus::Pending,
        retry_count: 0,
        last_error: None,
        tenant_id: "default".into(),
        created_at: "2026-10-07T01:00:00Z".into(),
        synced_at: None,
        priority: SyncPriority::Normal,
        origin_terminal_id: Some("tablet-a".into()),
    }
}

#[test]
fn crdt_delta_broadcast_serde_roundtrip() {
    let item = sample_item(
        "q-1",
        "stock.adjusted",
        r#"{"sku":"COFFEE","qty_delta":-2}"#,
    );
    let event = CrdtSyncEvent::DeltaBroadcast(CrdtDeltaBroadcast {
        batch: vec![item],
        origin_terminal_id: "tablet-a".into(),
        occurred_at: "2026-10-07T01:00:00Z".into(),
    });

    let json = serde_json::to_string(&event).unwrap();
    assert!(json.starts_with(CRDT_EVENT_TAG_PREFIX));
    assert!(json.contains("crdt.delta_broadcast"));
    assert!(json.contains("COFFEE"));

    let back: CrdtSyncEvent = serde_json::from_str(&json).unwrap();
    match back {
        CrdtSyncEvent::DeltaBroadcast(b) => {
            assert_eq!(b.origin_terminal_id, "tablet-a");
            assert_eq!(b.batch.len(), 1);
            assert_eq!(b.batch[0].action, "stock.adjusted");
            assert_eq!(b.batch[0].payload, r#"{"sku":"COFFEE","qty_delta":-2}"#);
        }
    }
}

#[tokio::test]
async fn crdt_sync_handler_broadcasts_json() {
    let (tx, mut rx) = broadcast::channel(16);
    let handler = CrdtSyncHandler { tx };

    let item = sample_item("q-2", "stock.adjusted", r#"{"sku":"TEA","qty_delta":5}"#);
    let event = CrdtSyncEvent::DeltaBroadcast(CrdtDeltaBroadcast {
        batch: vec![item],
        origin_terminal_id: "tablet-b".into(),
        occurred_at: "2026-10-07T01:05:00Z".into(),
    });

    handler.handle(&event).unwrap();

    let received = rx.recv().await.unwrap();
    assert!(received.starts_with(CRDT_EVENT_TAG_PREFIX));
    assert!(received.contains("TEA"));
}
