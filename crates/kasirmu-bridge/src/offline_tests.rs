//! Unit tests for the offline-queue command helpers (test relocation:
//! moved out of `apps/desktop-client/src/commands/offline_tests.rs`).
//!
//! Mounted at the foot of `offline.rs` with `#[cfg(test)] #[path]`, so
//! `use super::*` resolves the `run_*` helpers and DTOs from the bridge
//! module directly — the desktop `run_*` shims are thin `AppError`
//! adapters over these same functions.

use super::*;
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
