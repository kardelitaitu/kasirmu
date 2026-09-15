use super::*;
use oz_core::OfflineQueueStatus;
use oz_core::migrations;
use rusqlite::Connection;

fn fresh_conn() -> Connection {
    migrations::fresh_db()
}

#[test]
fn list_pending_offline_empty_db() {
    let conn = fresh_conn();
    let items = run_list_pending_offline(&conn).unwrap();
    assert!(items.is_empty());
}

#[test]
fn enqueue_and_list_pending() {
    let conn = fresh_conn();
    let store = Store::new(&conn);

    let item = store
        .enqueue_offline("complete_sale", r#"{"sale_id":"abc"}"#)
        .unwrap();
    assert_eq!(item.action, "complete_sale");
    assert_eq!(item.status, OfflineQueueStatus::Pending);

    let pending = store.list_pending_offline().unwrap();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].id, item.id);
}

#[test]
fn mark_offline_synced() {
    let conn = fresh_conn();
    let store = Store::new(&conn);

    let item = store.enqueue_offline("void_sale", "{}").unwrap();
    store.mark_offline_synced(&item.id).unwrap();

    let synced_item = store.list_all_offline().unwrap();
    assert_eq!(synced_item.len(), 1);
    assert_eq!(synced_item[0].status, OfflineQueueStatus::Synced);
    assert!(synced_item[0].synced_at.is_some());
}

#[test]
fn mark_offline_failed() {
    let conn = fresh_conn();
    let store = Store::new(&conn);

    let item = store.enqueue_offline("complete_sale", "{}").unwrap();
    store
        .mark_offline_failed(&item.id, "network error")
        .unwrap();

    let failed = store.list_all_offline().unwrap();
    assert_eq!(failed[0].status, OfflineQueueStatus::Failed);
    assert_eq!(failed[0].last_error.as_deref(), Some("network error"));
    assert_eq!(failed[0].retry_count, 1);
}

#[test]
fn pending_offline_count() {
    let conn = fresh_conn();
    let store = Store::new(&conn);

    assert_eq!(store.pending_offline_count().unwrap(), 0);
    store.enqueue_offline("test", "{}").unwrap();
    assert_eq!(store.pending_offline_count().unwrap(), 1);
}

#[test]
fn delete_offline_item() {
    let conn = fresh_conn();
    let store = Store::new(&conn);

    let item = store.enqueue_offline("test", "{}").unwrap();
    store.delete_offline_item(&item.id).unwrap();
    assert_eq!(store.list_all_offline().unwrap().len(), 0);
}

#[test]
fn enqueue_offline_validation() {
    let conn = fresh_conn();
    let store = Store::new(&conn);
    let item = store.enqueue_offline("", "{}").unwrap();
    // Empty action is stored as-is (no front-end validation at store level).
    assert_eq!(item.action, "");
    let loaded = store.list_all_offline().unwrap();
    assert_eq!(loaded.len(), 1);
}

#[test]
fn retry_sync_marks_pending_as_synced() {
    let conn = fresh_conn();
    let store = Store::new(&conn);

    store
        .enqueue_offline("complete_sale", r#"{"id":"1"}"#)
        .unwrap();
    store.enqueue_offline("void_sale", r#"{"id":"2"}"#).unwrap();

    let pending = store.list_pending_offline().unwrap();
    assert_eq!(pending.len(), 2);

    for item in &pending {
        store.mark_offline_synced(&item.id).unwrap();
    }

    let remaining = store.list_pending_offline().unwrap();
    assert!(remaining.is_empty());
}

// -- DTO struct tests --

#[test]
fn offline_queue_item_dto_debug() {
    let dto = OfflineQueueItemDto {
        id: "q1".into(),
        action: "complete_sale".into(),
        payload: "{}".into(),
        status: "pending".into(),
        retry_count: 0,
        last_error: None,
        created_at: "2025-01-01".into(),
        synced_at: None,
        tenant_id: "store-a".into(),
        priority: "critical".into(),
    };
    let d = format!("{dto:?}");
    assert!(d.contains("complete_sale"));
    assert!(d.contains("store-a"));
    assert!(d.contains("critical"));
}

#[test]
fn offline_queue_item_dto_serialize() {
    let dto = OfflineQueueItemDto {
        id: "q2".into(),
        action: "void_sale".into(),
        payload: "{}".into(),
        status: "synced".into(),
        retry_count: 1,
        last_error: Some("timeout".into()),
        created_at: "2025-02-01".into(),
        synced_at: Some("2025-02-02".into()),
        tenant_id: "store-b".into(),
        priority: "normal".into(),
    };
    let json = serde_json::to_value(&dto).unwrap();
    assert_eq!(json["action"], "void_sale");
    assert_eq!(json["retryCount"], 1);
    assert!(json["lastError"].is_string());
    // OFF-09: tenant + priority metadata survive the serializer.
    assert_eq!(json["tenantId"], "store-b");
    assert_eq!(json["priority"], "normal");
}

#[test]
fn enqueue_offline_args_optional_tenant_and_priority() {
    // OFF-09: tenant + priority are optional for backward compat, and a
    // front-end can never escalate to Critical by passing junk.
    let bare: EnqueueOfflineArgs =
        serde_json::from_str(r#"{"action":"a","payload":"{}"}"#).unwrap();
    assert!(bare.tenant_id.is_none());
    assert!(bare.priority.is_none());

    let scoped: EnqueueOfflineArgs = serde_json::from_str(
        r#"{"action":"a","payload":"{}","tenantId":"store-a","priority":"critical"}"#,
    )
    .unwrap();
    assert_eq!(scoped.tenant_id.as_deref(), Some("store-a"));
    assert_eq!(scoped.priority.as_deref(), Some("critical"));
}

#[test]
fn sync_result_debug() {
    let sr = SyncResult {
        synced_count: 5,
        failed_count: 2,
        total_count: 7,
        plan_required: false,
    };
    let d = format!("{sr:?}");
    assert!(d.contains("5"));
    assert!(d.contains("7"));
}

#[test]
fn sync_result_serialize() {
    let sr = SyncResult {
        synced_count: 10,
        failed_count: 0,
        total_count: 10,
        plan_required: false,
    };
    let json = serde_json::to_value(&sr).unwrap();
    assert_eq!(json["syncedCount"], 10);
    assert_eq!(json["failedCount"], 0);
}

#[test]
fn enqueue_offline_args_deserialize() {
    let json = r#"{"action":"complete_sale","payload":"{}"}"#;
    let args: EnqueueOfflineArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.action, "complete_sale");
    assert_eq!(args.payload, "{}");
}

#[test]
fn enqueue_offline_args_debug() {
    let args = EnqueueOfflineArgs {
        action: "test".into(),
        payload: "{}".into(),
        tenant_id: None,
        priority: None,
    };
    let d = format!("{args:?}");
    assert!(d.contains("test"));
}

// ── run_list_remote_failures (dead-letter discovery) ────────────────

#[test]
fn run_list_remote_failures_empty_db() {
    let conn = fresh_conn();
    let failures = run_list_remote_failures(&conn).unwrap();
    assert!(failures.is_empty(), "fresh db must have no failures");
}

#[test]
fn run_list_remote_failures_returns_retained_failures_newest_first() {
    let conn = fresh_conn();
    let store = Store::new(&conn);

    // Two distinct remote items: one retryable, one dead-lettered after
    // the third failed attempt. Both must be listed — operators need to
    // see every retained failure, with dead-lettered items flagged.
    store
        .record_remote_failure(
            "dl-item-1",
            "complete_sale",
            "{\"sale_id\":\"s1\"}",
            "missing product",
            3,
        )
        .unwrap();
    for _ in 0..3 {
        store
            .record_remote_failure("retry-item-2", "stock.adjusted", "{}", "bad", 3)
            .unwrap();
    }
    assert!(!store.is_remote_failure_dead_lettered("dl-item-1").unwrap());
    assert!(
        store
            .is_remote_failure_dead_lettered("retry-item-2")
            .unwrap()
    );

    let failures = run_list_remote_failures(&conn).unwrap();
    assert_eq!(failures.len(), 2);
    let by_id: std::collections::HashMap<_, _> = failures
        .iter()
        .map(|dto| (dto.item_id.clone(), dto))
        .collect();
    let dl = by_id.get("dl-item-1").unwrap();
    assert_eq!(dl.action, "complete_sale");
    assert_eq!(dl.attempts, 1);
    assert_eq!(dl.last_error, "missing product");
    assert!(!dl.dead_lettered, "dl-item-1 is still retryable");
    let retry = by_id.get("retry-item-2").unwrap();
    assert_eq!(retry.action, "stock.adjusted");
    assert_eq!(retry.attempts, 3);
    assert!(retry.dead_lettered, "retry-item-2 hit the dead letter");
    assert_eq!(retry.payload, "{}");
}

// ── run_requeue_remote_failure (dead-letter requeue workflow) ────────

#[test]
fn run_requeue_remote_failure_clears_dead_letter() {
    let conn = fresh_conn();
    let store = Store::new(&conn);

    // Drive a remote item to the dead letter, then persist a pull
    // anchor past it (as the daemon would after quarantining it).
    for _ in 0..3 {
        store
            .record_remote_failure("dl-item-1", "complete_sale", "{}", "bad", 3)
            .unwrap();
    }
    assert!(store.is_remote_failure_dead_lettered("dl-item-1").unwrap());
    store
        .set_sync_pull_state(Some("2026-06-01T00:00:00Z"), Some("cursor-1"))
        .unwrap();

    run_requeue_remote_failure(&conn, "dl-item-1").unwrap();

    assert!(!store.is_remote_failure_dead_lettered("dl-item-1").unwrap());
    assert!(store.list_remote_failures().unwrap().is_empty());
    let st = store.get_sync_pull_state().unwrap();
    assert!(st.since.is_none(), "anchor must rewind after requeue");
    assert!(st.cursor.is_none(), "cursor must clear with the anchor");
}
#[test]
fn run_requeue_remote_failure_unknown_id_errors() {
    let conn = fresh_conn();
    let err = run_requeue_remote_failure(&conn, "never-seen").unwrap_err();
    match err {
        AppError::Core { sub_kind, .. } => {
            assert_eq!(format!("{sub_kind:?}"), "NotFound");
        }
        other => panic!("expected NotFound Core error, got {other:?}"),
    }
}

#[test]
fn requeue_remote_failure_args_deserialize() {
    let json = r#"{"itemId":"dl-1"}"#;
    let args: RequeueRemoteFailureArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.item_id, "dl-1");
}
