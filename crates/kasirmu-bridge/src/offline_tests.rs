//! Unit tests for the offline-queue command helpers (test relocation:
//! moved out of `apps/desktop-tauri/src/commands/offline_tests.rs`).
//!
//! Mounted at the foot of `offline.rs` with `#[cfg(test)] #[path]`, so
//! `use super::*` resolves the `run_*` helpers and DTOs from the bridge
//! module directly — the desktop `run_*` shims are thin `AppError`
//! adapters over these same functions.

use super::*;
use rusqlite::Connection;

fn fresh_conn() -> Connection {
    crate::testing::temp_conn()
}

#[test]
fn list_pending_offline_empty_db() {
    let conn = fresh_conn();
    let items = run_list_pending_offline(&conn).unwrap();
    assert!(items.is_empty());
}

// ── list_remote_failures (dead-letter discovery) ────────────────

#[test]
fn run_list_remote_failures_empty_db() {
    let conn = fresh_conn();
    let failures = run_list_remote_failures(&conn).unwrap();
    assert!(failures.is_empty(), "fresh db must have no failures");
}

// ── requeue_remote_failure (dead-letter requeue workflow) ────────

#[test]
fn run_requeue_remote_failure_unknown_id_errors() {
    let conn = fresh_conn();
    let err = run_requeue_remote_failure(&conn, "never-seen").unwrap_err();
    match err {
        BridgeError::Core { sub_kind, .. } => {
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

// -- DTO struct tests --

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

// ── C49b: the retry path CALLS the shared ordering rule ─────────
//
// `retry_offline_sync_scoped` carried the LAST copy of the queue-ordering rule:
// it sorted the pending batch by its priority column alone. Priority alone is not a
// (most items are Critical and `created_at` is millisecond precision), so the copy
// disagreed with the shared expression `kasirmu_core::offline::order_for_push` that
// the other four production paths already call.
//
// This asserts the ORDER OF THE HTTP REQUEST BODY, not a sorted local vector, so it
// is a CALL-SITE test: delete the `order_for_push` call and the body reverts to the
// un-sorted read (`created_at` ASC), which puts the Low item first and fails here.
// That is the C20 negative control on this path. The server is a raw loopback
// socket, the same pattern `sync_tests.rs` uses for `sync_run_scoped`, chosen over a
// mock HTTP crate because this crate has no dev-dependency on one.
#[tokio::test]
async fn retry_offline_sync_scoped_pushes_critical_before_an_earlier_low_item() {
    use kasirmu_core::offline::SyncPriority;
    use kasirmu_core::permissions;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    // Fake push server: accept one request, capture the body, accept every item.
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let server_url = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        let Ok((mut socket, _)) = listener.accept().await else {
            return String::new();
        };
        let mut buffer = vec![0_u8; 64 * 1024];
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

    let bridge = crate::testing::TestBridge::new();
    let token = bridge.token_granting(permissions::SYNC_MANAGE).await;
    let store_id = "store-pin";

    // Configure sync through the PRODUCTION setter: `SyncConfig::from_settings`
    // reads the typed `sync_enabled` / `sync.server_url` rows, so a hand-written
    // `sync.enabled` key is ignored and the run would push nothing.
    {
        let conn = bridge.db_manager().open_store(store_id).unwrap();
        let db = conn.lock().unwrap();
        crate::sync::update_sync_settings_data(
            &db,
            &crate::sync::UpdateSyncSettingsArgs {
                server_url: Some(server_url.clone()),
                api_key: Some("test-jwt".into()),
                enabled: true,
            },
        )
        .unwrap();
        let store = Store::new(&db);
        // Enqueued in the WRONG order on purpose: Low arrives FIRST, so
        // `ORDER BY created_at ASC` alone would keep it ahead of Critical.
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

    let ctx = bridge.ctx();
    let result = retry_offline_sync_scoped(&ctx, &token)
        .await
        .expect("the retry push must reach the fake server");
    assert_eq!(result.synced_count, 3, "all three items are accepted");

    let request = server.await.expect("the fake server task must finish");
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
        "the REQUEST BODY must carry Critical before Normal before Low; delete the order_for_push call and the Low item leads, which is the C20 negative control on this path"
    );
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
