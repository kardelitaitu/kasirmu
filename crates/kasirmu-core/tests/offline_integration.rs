//! Integration tests for the offline queue and sync modules —
//! queue lifecycle, status transitions, ordering, and edge cases.
//!
//! Tests exercise the full persistence layer via the public
//! [`kasirmu_core::Store`] API against an in-memory SQLite database.

use kasirmu_core::{OfflineQueueStatus, Store, migrations};
use rusqlite::Connection;

// ── Helpers ───────────────────────────────────────────────────────────

fn setup() -> Connection {
    migrations::fresh_db()
}

fn store(conn: &Connection) -> Store<'_> {
    Store::new(conn)
}

fn seed_queue(conn: &Connection) {
    conn.execute_batch(
        "INSERT INTO offline_queue (id, action, payload, status, retry_count, last_error, created_at, synced_at) VALUES
            ('oq-1', 'sale.create', '{\"total\":100}', 'pending', 0, '',       '2025-01-01T12:00:00.000Z', ''),
            ('oq-2', 'product.update', '{}',          'pending', 2, 'timeout','2025-01-01T12:05:00.000Z', ''),
            ('oq-3', 'sale.void', '{\"id\":\"s-1\"}','synced',  0, '',       '2025-01-01T11:00:00.000Z', '2025-01-01T11:01:00.000Z'),
            ('oq-4', 'sale.create', '{\"total\":200}','failed',  3, 'server error','2025-01-01T10:00:00.000Z', '');"
    ).unwrap();
}

// ── Enqueue ──────────────────────────────────────────────────────────

#[test]
fn enqueue_creates_pending_item() {
    let conn = setup();
    let s = store(&conn);
    let item = s.enqueue_offline("sale.create", r#"{"total":50}"#).unwrap();
    assert_eq!(item.action, "sale.create");
    assert_eq!(item.payload, r#"{"total":50}"#);
    assert_eq!(item.status, OfflineQueueStatus::Pending);
    assert_eq!(item.retry_count, 0);
    assert!(item.last_error.is_none());
    assert!(item.synced_at.is_none());
    assert!(!item.id.is_empty());
    assert!(!item.created_at.is_empty());
}

#[test]
fn enqueue_persists_to_db() {
    let conn = setup();
    let s = store(&conn);
    s.enqueue_offline("sale.create", "{}").unwrap();
    let items = s.list_all_offline().unwrap();
    assert_eq!(items.len(), 1);
}

#[test]
fn enqueue_multiple_items() {
    let conn = setup();
    let s = store(&conn);
    s.enqueue_offline("a", "{}").unwrap();
    s.enqueue_offline("b", "{}").unwrap();
    s.enqueue_offline("c", "{}").unwrap();

    let items = s.list_all_offline().unwrap();
    assert_eq!(items.len(), 3);
}

// ── List pending (oldest first) ──────────────────────────────────────

#[test]
fn list_pending_offline_empty() {
    let conn = setup();
    let items = store(&conn).list_pending_offline().unwrap();
    assert!(items.is_empty());
}

#[test]
fn list_pending_returns_only_pending_oldest_first() {
    let conn = setup();
    seed_queue(&conn);
    let items = store(&conn).list_pending_offline().unwrap();
    assert_eq!(items.len(), 2);
    assert_eq!(items[0].id, "oq-1", "oldest pending first");
    assert_eq!(items[1].id, "oq-2");
    assert_eq!(items[0].retry_count, 0);
    assert_eq!(items[1].retry_count, 2);
    assert_eq!(items[1].last_error.as_deref(), Some("timeout"));
}

// ── List all (most recent first) ─────────────────────────────────────

#[test]
fn list_all_offline_empty() {
    let conn = setup();
    let items = store(&conn).list_all_offline().unwrap();
    assert!(items.is_empty());
}

#[test]
fn list_all_returns_all_statuses_most_recent_first() {
    let conn = setup();
    seed_queue(&conn);
    let items = store(&conn).list_all_offline().unwrap();
    assert_eq!(items.len(), 4);
    // Most recent first (created_at DESC).
    assert_eq!(items[0].id, "oq-2");
    assert_eq!(items[1].id, "oq-1");
    assert_eq!(items[2].id, "oq-3");
    assert_eq!(items[3].id, "oq-4");
}

// ── Mark synced ──────────────────────────────────────────────────────

#[test]
fn mark_synced_updates_status_and_synced_at() {
    let conn = setup();
    seed_queue(&conn);
    let s = store(&conn);

    s.mark_offline_synced("oq-1").unwrap();

    let all = s.list_all_offline().unwrap();
    let item = all.into_iter().find(|i| i.id == "oq-1").unwrap();
    assert_eq!(item.status, OfflineQueueStatus::Synced);
    assert!(item.synced_at.is_some(), "synced_at should be populated");
    assert!(
        item.synced_at.unwrap().contains('T'),
        "synced_at should be ISO-8601"
    );
}

#[test]
fn mark_synced_removes_from_pending() {
    let conn = setup();
    seed_queue(&conn);
    let s = store(&conn);

    s.mark_offline_synced("oq-1").unwrap();
    s.mark_offline_synced("oq-2").unwrap();

    let pending = s.list_pending_offline().unwrap();
    assert!(pending.is_empty(), "all items should be synced");
}

#[test]
fn mark_synced_not_found_returns_error() {
    let conn = setup();
    let err = store(&conn).mark_offline_synced("nonexistent").unwrap_err();
    assert!(
        matches!(err, kasirmu_core::CoreError::NotFound { entity, .. } if entity == "offline_queue")
    );
}

// ── Mark failed ──────────────────────────────────────────────────────

#[test]
fn mark_failed_sets_status_and_error() {
    let conn = setup();
    seed_queue(&conn);
    let s = store(&conn);

    s.mark_offline_failed("oq-1", "network error").unwrap();

    let all = s.list_all_offline().unwrap();
    let item = all.into_iter().find(|i| i.id == "oq-1").unwrap();
    assert_eq!(item.status, OfflineQueueStatus::Failed);
    assert_eq!(item.last_error.as_deref(), Some("network error"));
    assert_eq!(
        item.retry_count, 1,
        "retry_count should increment from 0 to 1"
    );
}

#[test]
fn mark_failed_increments_existing_retry_count() {
    let conn = setup();
    seed_queue(&conn);
    let s = store(&conn);

    s.mark_offline_failed("oq-2", "another error").unwrap();

    let all = s.list_all_offline().unwrap();
    let item = all.into_iter().find(|i| i.id == "oq-2").unwrap();
    assert_eq!(item.retry_count, 3, "should increment from 2 to 3");
}

#[test]
fn mark_failed_not_found_does_not_error() {
    let conn = setup();
    let s = store(&conn);
    // mark_offline_failed uses UPDATE which succeeds even if 0 rows affected.
    s.mark_offline_failed("nonexistent", "error").unwrap();
}

// ── Pending count ────────────────────────────────────────────────────

#[test]
fn pending_count_zero_on_empty_db() {
    let conn = setup();
    assert_eq!(store(&conn).pending_offline_count().unwrap(), 0);
}

#[test]
fn pending_count_matches_pending_items() {
    let conn = setup();
    seed_queue(&conn);
    assert_eq!(store(&conn).pending_offline_count().unwrap(), 2);
}

#[test]
fn pending_count_decreases_after_mark_synced() {
    let conn = setup();
    seed_queue(&conn);
    let s = store(&conn);

    assert_eq!(s.pending_offline_count().unwrap(), 2);
    s.mark_offline_synced("oq-1").unwrap();
    assert_eq!(s.pending_offline_count().unwrap(), 1);
    s.mark_offline_synced("oq-2").unwrap();
    assert_eq!(s.pending_offline_count().unwrap(), 0);
}

// ── Full lifecycle ───────────────────────────────────────────────────

#[test]
fn full_queue_lifecycle() {
    let conn = setup();
    let s = store(&conn);

    // 1. Enqueue an item.
    let item = s
        .enqueue_offline("complete_sale", r#"{"sale_id":"s-1"}"#)
        .unwrap();
    assert_eq!(s.pending_offline_count().unwrap(), 1);

    // 2. Mark as synced.
    s.mark_offline_synced(&item.id).unwrap();
    assert_eq!(s.pending_offline_count().unwrap(), 0);

    // 3. List all — item should be synced.
    let all = s.list_all_offline().unwrap();
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].status, OfflineQueueStatus::Synced);

    // 4. Delete the item.
    s.delete_offline_item(&item.id).unwrap();
    assert!(s.list_all_offline().unwrap().is_empty());
}

#[test]
fn pending_then_failed_then_retry_lifecycle() {
    let conn = setup();
    let s = store(&conn);

    // Enqueue.
    let item = s
        .enqueue_offline("sale.create", r#"{"total":500}"#)
        .unwrap();
    assert_eq!(s.pending_offline_count().unwrap(), 1);

    // Fail.
    s.mark_offline_failed(&item.id, "server timeout").unwrap();
    assert_eq!(s.pending_offline_count().unwrap(), 0);

    // Re-enqueue (simulating retry).
    let retry = s
        .enqueue_offline("sale.create", r#"{"total":500}"#)
        .unwrap();

    // Mark as synced.
    s.mark_offline_synced(&retry.id).unwrap();

    // Verify both items exist: one failed, one synced.
    let all = s.list_all_offline().unwrap();
    assert_eq!(all.len(), 2);
    let failed_count = all
        .iter()
        .filter(|i| i.status == OfflineQueueStatus::Failed)
        .count();
    let synced_count = all
        .iter()
        .filter(|i| i.status == OfflineQueueStatus::Synced)
        .count();
    assert_eq!(failed_count, 1);
    assert_eq!(synced_count, 1);
}

// ── Delete ───────────────────────────────────────────────────────────

#[test]
fn delete_offline_item_removes() {
    let conn = setup();
    seed_queue(&conn);
    let s = store(&conn);

    s.delete_offline_item("oq-1").unwrap();

    let all = s.list_all_offline().unwrap();
    assert_eq!(all.len(), 3);
    assert!(all.into_iter().all(|i| i.id != "oq-1"));
}

#[test]
fn delete_offline_item_nonexistent_does_not_error() {
    let conn = setup();
    let s = store(&conn);
    s.delete_offline_item("nonexistent").unwrap();
}

#[test]
fn delete_all_items_empties_queue() {
    let conn = setup();
    seed_queue(&conn);
    let s = store(&conn);

    for item in s.list_all_offline().unwrap() {
        s.delete_offline_item(&item.id).unwrap();
    }

    assert_eq!(s.list_all_offline().unwrap().len(), 0);
    assert_eq!(s.pending_offline_count().unwrap(), 0);
}

// ── OfflineQueueStatus domain logic ──────────────────────────────────

#[test]
fn status_from_stored_str() {
    assert_eq!(
        OfflineQueueStatus::from_stored_str("pending"),
        Some(OfflineQueueStatus::Pending)
    );
    assert_eq!(
        OfflineQueueStatus::from_stored_str("synced"),
        Some(OfflineQueueStatus::Synced)
    );
    assert_eq!(
        OfflineQueueStatus::from_stored_str("failed"),
        Some(OfflineQueueStatus::Failed)
    );
    assert_eq!(OfflineQueueStatus::from_stored_str("unknown"), None);
}

#[test]
fn status_as_stored_str() {
    assert_eq!(OfflineQueueStatus::Pending.as_stored_str(), "pending");
    assert_eq!(OfflineQueueStatus::Synced.as_stored_str(), "synced");
    assert_eq!(OfflineQueueStatus::Failed.as_stored_str(), "failed");
}
