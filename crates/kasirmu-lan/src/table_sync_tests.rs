use super::*;

fn sample_table() -> Table {
    Table {
        id: "tbl-1".into(),
        name: "Table 1".into(),
        capacity: 4,
        pos_x: 20.0,
        pos_y: 30.0,
        shape: "circle".into(),
        width: 10.0,
        height: 10.0,
        status: "occupied".into(),
        active_sale_id: Some("sale-99".into()),
        section: "Main Dining".into(),
        active: true,
        sort_order: 1,
        created_at: "2026-10-06T00:00:00Z".into(),
        updated_at: "2026-10-06T01:00:00Z".into(),
    }
}

#[test]
fn table_sync_event_serialisation_matches_tag_prefix() {
    let event = TableSyncEvent::StatusChanged(TableStatusChanged {
        table: sample_table(),
        occurred_at: "2026-10-06T01:00:00Z".into(),
    });

    let json = serde_json::to_string(&event).unwrap();
    assert!(
        json.starts_with(TABLE_EVENT_TAG_PREFIX),
        "serialized JSON {json} must start with {TABLE_EVENT_TAG_PREFIX}"
    );

    let deserialized: TableSyncEvent = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized.tag(), EVENT_TABLE_STATUS_CHANGED);
    match deserialized {
        TableSyncEvent::StatusChanged(sc) => {
            assert_eq!(sc.table.id, "tbl-1");
            assert_eq!(sc.table.status, "occupied");
            assert_eq!(sc.occurred_at, "2026-10-06T01:00:00Z");
        }
        _ => panic!("expected StatusChanged variant"),
    }
}

#[test]
fn table_sync_handler_broadcasts_json() {
    let (tx, mut rx) = broadcast::channel(16);
    let handler = TableSyncHandler { tx };

    let event = TableSyncEvent::StatusChanged(TableStatusChanged {
        table: sample_table(),
        occurred_at: "2026-10-06T01:00:00Z".into(),
    });

    handler.handle(&event).unwrap();

    let received = rx.try_recv().unwrap();
    assert!(received.contains("\"table.status_changed\""));
    assert!(received.contains("\"tbl-1\""));
    assert!(received.contains("\"occupied\""));
}

#[test]
fn table_lock_acquired_and_released_serde_roundtrip() {
    let acquire_event = TableSyncEvent::LockAcquired(TableLockAcquired {
        table_id: "tbl-5".into(),
        terminal_id: "tablet-waiter-1".into(),
        terminal_label: Some("Waiter Tablet 1".into()),
        held_cart_id: Some("cart-77".into()),
        lease_ttl_ms: 180_000,
        acquired_at: "2026-10-07T03:50:00Z".into(),
    });

    let json = serde_json::to_string(&acquire_event).unwrap();
    assert!(json.starts_with(TABLE_EVENT_TAG_PREFIX));
    assert!(json.contains("table.lock_acquired"));
    assert!(json.contains("Waiter Tablet 1"));

    let back: TableSyncEvent = serde_json::from_str(&json).unwrap();
    assert_eq!(back.tag(), EVENT_TABLE_LOCK_ACQUIRED);
    match back {
        TableSyncEvent::LockAcquired(acq) => {
            assert_eq!(acq.table_id, "tbl-5");
            assert_eq!(acq.terminal_id, "tablet-waiter-1");
            assert_eq!(acq.lease_ttl_ms, 180_000);
        }
        _ => panic!("wrong variant"),
    }

    let release_event = TableSyncEvent::LockReleased(TableLockReleased {
        table_id: "tbl-5".into(),
        terminal_id: "tablet-waiter-1".into(),
        released_at: "2026-10-07T03:52:00Z".into(),
    });
    let json_rel = serde_json::to_string(&release_event).unwrap();
    assert!(json_rel.starts_with(TABLE_EVENT_TAG_PREFIX));
    assert!(json_rel.contains("table.lock_released"));

    let claim_event = TableSyncEvent::ClaimRequested(TableClaimRequested {
        table_id: "tbl-5".into(),
        requester_terminal_id: "pos-counter".into(),
        requested_at: "2026-10-07T03:51:00Z".into(),
    });
    let json_claim = serde_json::to_string(&claim_event).unwrap();
    assert!(json_claim.starts_with(TABLE_EVENT_TAG_PREFIX));
    assert!(json_claim.contains("table.claim_requested"));
}

#[test]
fn table_lease_tracker_acquire_conflict_and_expiration() {
    let mut tracker = TableLeaseTracker::new();
    let now = 1_000_000;

    let acq = TableLockAcquired {
        table_id: "tbl-10".into(),
        terminal_id: "tablet-a".into(),
        terminal_label: Some("Tablet A".into()),
        held_cart_id: None,
        lease_ttl_ms: 60_000,
        acquired_at: "2026-10-07T03:50:00Z".into(),
    };

    // Initial acquire succeeds
    let lease = tracker
        .try_acquire(acq.clone(), now)
        .expect("acquire should succeed");
    assert_eq!(lease.expires_at_epoch_ms, now + 60_000);
    assert_eq!(tracker.active_leases(now).len(), 1);

    // Another terminal attempts to acquire before expiration -> conflict
    let acq_b = TableLockAcquired {
        table_id: "tbl-10".into(),
        terminal_id: "tablet-b".into(),
        terminal_label: Some("Tablet B".into()),
        held_cart_id: None,
        lease_ttl_ms: 60_000,
        acquired_at: "2026-10-07T03:50:30Z".into(),
    };
    let conflict = tracker
        .try_acquire(acq_b.clone(), now + 30_000)
        .expect_err("should conflict");
    assert_eq!(conflict.terminal_id, "tablet-a");

    // Same terminal renews -> succeeds
    let renewed = tracker
        .try_acquire(acq, now + 30_000)
        .expect("renew should succeed");
    assert_eq!(renewed.expires_at_epoch_ms, now + 30_000 + 60_000);

    // Wrong terminal cannot release
    let fake_release = TableLockReleased {
        table_id: "tbl-10".into(),
        terminal_id: "tablet-b".into(),
        released_at: "2026-10-07T03:51:00Z".into(),
    };
    assert!(!tracker.release(&fake_release));
    assert!(tracker.get_lease("tbl-10", now + 30_000).is_some());

    // Correct terminal releases
    let real_release = TableLockReleased {
        table_id: "tbl-10".into(),
        terminal_id: "tablet-a".into(),
        released_at: "2026-10-07T03:51:00Z".into(),
    };
    assert!(tracker.release(&real_release));
    assert!(tracker.get_lease("tbl-10", now + 30_000).is_none());

    // Terminal B can now acquire
    let granted_b = tracker
        .try_acquire(acq_b, now + 35_000)
        .expect("now B should succeed");
    assert_eq!(granted_b.terminal_id, "tablet-b");

    // After TTL passes, lease expires automatically
    assert!(tracker.get_lease("tbl-10", now + 35_000 + 70_000).is_none());
    assert_eq!(tracker.active_leases(now + 35_000 + 70_000).len(), 0);
}
