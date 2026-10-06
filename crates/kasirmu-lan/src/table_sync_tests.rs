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
