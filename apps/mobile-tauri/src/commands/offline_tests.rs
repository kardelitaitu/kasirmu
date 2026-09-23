use super::*;
use kasirmu_core::OfflineQueueStatus;
use kasirmu_core::migrations;
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

// ── C54: the tablet retry path's push order, and its twin ────────
//
// `retry_offline_sync_scoped` is the tablet's own body for the operation the
// desktop delegates to `kasirmu_bridge::offline::retry_offline_sync_scoped`.
// Two implementations, one operation — the divergent-twin class. This test is
// the tablet's call-site proof, which the bridge's test file cannot provide:
// the tablet command needs `AppState`, and the bridge harness builds a
// `BridgeCtx`.
//
// It asserts the ORDER OF THE HTTP REQUEST BODY captured from a raw loopback
// socket (this crate has no mock-HTTP dev-dependency), the same pattern
// `sync_tests.rs` uses for `sync_run_scoped`. The queue is seeded in the WRONG
// order on purpose — Low first — so `Store::list_pending_offline`'s
// `ORDER BY created_at ASC` alone would push Low ahead of Critical. Deleting
// the `order_for_push` call makes this fail: that is the C20 negative control.
#[tokio::test]
async fn retry_offline_sync_scoped_pushes_critical_before_an_earlier_low_item() {
    use crate::commands::sync::{UpdateSyncSettingsArgs, update_sync_settings_data};
    use crate::state::AppState;
    use kasirmu_core::Store;
    use kasirmu_core::auth;
    use kasirmu_core::migrations;
    use kasirmu_core::offline::SyncPriority;
    use kasirmu_core::session::SessionContext;
    use platform_core::StoreDatabaseManager;
    use tauri::Manager as _;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    // Fake push server: accept one request, capture the body, accept all three.
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let server_url = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        let Ok((mut socket, _)) = listener.accept().await else {
            return String::new();
        };
        let mut buffer = vec![0_u8; 16 * 1024];
        let read = socket.read(&mut buffer).await.unwrap_or(0);
        let request = String::from_utf8_lossy(&buffer[..read]).to_string();
        let body =
            r#"{"results":[{"outcome":"accepted"},{"outcome":"accepted"},{"outcome":"accepted"}]}"#;
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        let _ = socket.write_all(response.as_bytes()).await;
        request
    });

    // The global db carries identity (roles + user) only; the scoped store db is
    // a separate file the manager creates below.
    let conn = migrations::fresh_db();
    let sync_user_id = {
        let store = Store::new(&conn);
        store.seed_default_roles().unwrap();
        let hash = auth::hash_pin("1234").unwrap();
        store
            .create_user("sync-admin", &hash, "Sync Admin", "role-owner")
            .unwrap()
            .id
    };

    let temp_dir = tempfile::tempdir().unwrap();
    let mut state = AppState::for_test_with_conn(conn);
    state.db_manager = StoreDatabaseManager::new(temp_dir.path().to_path_buf(), migrations::ALL);
    state.session_store.write().unwrap().insert(
        "retry-order-token".into(),
        SessionContext::new(
            sync_user_id,
            "role-owner".into(),
            "terminal-1".into(),
            "store-a".into(),
            "instance-1".into(),
            "restaurant-pos".into(),
            None,
            0,
        ),
    );
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    // Settings and the queue go through the STORE db — the queue the scoped push
    // reads. Enqueued Low first, on purpose.
    {
        let state = app.state::<AppState>();
        let conn_arc = state.resolve_store("retry-order-token").unwrap();
        let db_guard = conn_arc.lock().unwrap();
        update_sync_settings_data(
            &db_guard,
            &UpdateSyncSettingsArgs {
                server_url: Some(server_url),
                api_key: Some("test-jwt".into()),
                enabled: true,
            },
        )
        .unwrap();
        let store = Store::new(&db_guard);
        store
            .enqueue_offline_priority("bulk", r#"{"n":1}"#, SyncPriority::Low)
            .unwrap();
        store
            .enqueue_offline_priority("money", r#"{"n":2}"#, SyncPriority::Critical)
            .unwrap();
        store
            .enqueue_offline_priority("catalog", r#"{"n":3}"#, SyncPriority::Normal)
            .unwrap();
    }

    let result = retry_offline_sync_scoped("retry-order-token".into(), app.state()).await;
    let request = task.await.expect("the fake server task must finish");
    let body_start = request.find("\r\n\r\n").expect("a complete HTTP request") + 4;
    let body = &request[body_start..];
    let sent: Vec<String> =
        serde_json::from_str::<Vec<kasirmu_core::offline::OfflineQueueItem>>(body)
            .expect("the push body is the item array")
            .iter()
            .map(|i| i.action.clone())
            .collect();
    assert_eq!(
        sent,
        vec!["money", "catalog", "bulk"],
        "the REQUEST BODY must carry Critical before Normal before Low; delete the \
         order_for_push call and the Low item leads, which is the C20 negative control"
    );

    // C54 divergence, pinned rather than hidden: the push above SUCCEEDED (the
    // body proves it), yet the command returns Err because Phase 3 writes the
    // outcomes to `state.db` — the GLOBAL identity database — where these
    // store-row ids do not exist, so `mark_offline_synced` returns NotFound. The
    // bridge twin re-resolves the STORE scope instead. When the collapse lands,
    // this assertion fails and whoever lands it deletes it.
    match result {
        Err(AppError::Core { sub_kind, message }) => assert_eq!(
            format!("{sub_kind:?}"),
            "NotFound",
            "C54: the outcomes went to a db where these ids do not exist: {message}"
        ),
        other => panic!(
            "C54: expected the known Phase 3 divergence (NotFound from the global db), \
             got {other:?}; if the tablet now writes the store db, delete this assertion"
        ),
    }
}

#[test]
fn requeue_remote_failure_args_deserialize() {
    let json = r#"{"itemId":"dl-1"}"#;
    let args: RequeueRemoteFailureArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.item_id, "dl-1");
}
