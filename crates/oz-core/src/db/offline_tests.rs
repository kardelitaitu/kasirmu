use super::*;
use crate::inventory::{CANONICAL_DEFAULT_LOCATION_UUID, LocationId};
use crate::migrations;
use rusqlite::Connection;

fn fresh() -> Connection {
    migrations::fresh_db()
}

fn store(conn: &Connection) -> Store<'_> {
    Store::new(conn)
}

fn seed_pending_and_synced(conn: &Connection) {
    conn.execute_batch(
        "INSERT INTO offline_queue (id, action, payload, status, retry_count, last_error, created_at, synced_at) VALUES
            ('oq-1', 'sale.create', '{\"total\":100}', 'pending', 0, '', '2025-01-01T12:00:00.000Z', ''),
            ('oq-2', 'product.update', '{}', 'pending', 2, 'timeout', '2025-01-01T12:05:00.000Z', ''),
            ('oq-3', 'sale.void', '{\"id\":\"s-1\"}', 'synced', 0, '', '2025-01-01T11:00:00.000Z', '2025-01-01T11:01:00.000Z'),
            ('oq-4', 'sale.create', '{\"total\":200}', 'failed', 3, 'server error', '2025-01-01T10:00:00.000Z', '');"
    ).unwrap();
}

// ── Enqueue ─────────────────────────────────────────────────────

#[test]
fn enqueue_offline_creates_pending_item() {
    let conn = fresh();
    let s = store(&conn);
    let item = s.enqueue_offline("sale.create", "{\"total\":50}").unwrap();
    assert_eq!(item.action, "sale.create");
    assert_eq!(item.payload, "{\"total\":50}");
    assert_eq!(item.status, OfflineQueueStatus::Pending);
    assert_eq!(item.retry_count, 0);
    assert!(!item.id.is_empty());
    assert!(!item.created_at.is_empty());
}

#[test]
fn enqueue_offline_persists_to_db() {
    let conn = fresh();
    let s = store(&conn);
    s.enqueue_offline("sale.create", "{}").unwrap();

    let items = s.list_all_offline().unwrap();
    assert_eq!(items.len(), 1);
}

/// SYNC-10 tablet parity: a local settings write must enqueue a
/// `settings.update` item with the payload shape the sync apply side
/// parses ({key, value, terminal_id}), tenant-scoped at Low priority.
#[test]
fn enqueue_settings_update_superseding_creates_item() {
    let conn = fresh();
    let s = store(&conn);

    s.enqueue_settings_update_superseding("theme", "dark", "term-1", "store-x")
        .unwrap();

    let pending = s.list_pending_offline_for_tenant("store-x").unwrap();
    assert_eq!(pending.len(), 1);
    let item = &pending[0];
    assert_eq!(item.action, "settings.update");
    assert_eq!(item.priority, SyncPriority::Low);
    let v: serde_json::Value = serde_json::from_str(&item.payload).unwrap();
    assert_eq!(v["key"], "theme");
    assert_eq!(v["value"], "dark");
    assert_eq!(v["terminal_id"], "term-1");
}

/// A second local save of the same key must replace the still-pending
/// item, so a v1→v2→v1 offline sequence pushes the newest value last.
#[test]
fn enqueue_settings_update_superseding_replaces_same_key() {
    let conn = fresh();
    let s = store(&conn);

    s.enqueue_settings_update_superseding("theme", "dark", "term-1", "store-x")
        .unwrap();
    s.enqueue_settings_update_superseding("theme", "light", "term-1", "store-x")
        .unwrap();

    let pending = s.list_pending_offline_for_tenant("store-x").unwrap();
    assert_eq!(
        pending.len(),
        1,
        "second save must replace the pending item"
    );
    let v: serde_json::Value = serde_json::from_str(&pending[0].payload).unwrap();
    assert_eq!(v["value"], "light");
}

/// Superseding one key must leave pending items for OTHER keys intact.
#[test]
fn enqueue_settings_update_superseding_keeps_other_keys() {
    let conn = fresh();
    let s = store(&conn);

    s.enqueue_settings_update_superseding("a", "1", "term-1", "store-x")
        .unwrap();
    s.enqueue_settings_update_superseding("b", "2", "term-1", "store-x")
        .unwrap();
    s.enqueue_settings_update_superseding("a", "3", "term-1", "store-x")
        .unwrap();

    let pending = s.list_pending_offline_for_tenant("store-x").unwrap();
    assert_eq!(pending.len(), 2);
    let mut keyed: Vec<(String, String)> = pending
        .iter()
        .map(|i| {
            let v: serde_json::Value = serde_json::from_str(&i.payload).unwrap();
            (
                v["key"].as_str().unwrap().to_string(),
                v["value"].as_str().unwrap().to_string(),
            )
        })
        .collect();
    keyed.sort();
    assert_eq!(
        keyed,
        vec![
            ("a".to_string(), "3".to_string()),
            ("b".to_string(), "2".to_string())
        ]
    );
}

/// Supersede must be tenant-scoped — store-y's save of the same key
/// must not remove store-x's pending item (multi-store isolation).
#[test]
fn enqueue_settings_update_superseding_is_tenant_scoped() {
    let conn = fresh();
    let s = store(&conn);

    s.enqueue_settings_update_superseding("theme", "dark", "term-1", "store-x")
        .unwrap();
    s.enqueue_settings_update_superseding("theme", "dark", "term-1", "store-y")
        .unwrap();

    let pending = s.list_pending_offline().unwrap();
    assert_eq!(
        pending.len(),
        2,
        "cross-tenant items must not be superseded"
    );
}

/// Supersede must be per-terminal — term-2's pending save of the same
/// key must survive term-1's re-save (version-LWW attributes changes
/// per terminal, so neither terminal may cancel the other's intent).
#[test]
fn enqueue_settings_update_superseding_keeps_other_terminals_items() {
    let conn = fresh();
    let s = store(&conn);

    s.enqueue_settings_update_superseding("theme", "dark", "term-1", "store-x")
        .unwrap();
    s.enqueue_settings_update_superseding("theme", "dark", "term-2", "store-x")
        .unwrap();
    // term-1 saves the same key again — only ITS older pending item is
    // superseded; term-2's item survives.
    s.enqueue_settings_update_superseding("theme", "light", "term-1", "store-x")
        .unwrap();

    let pending = s.list_pending_offline_for_tenant("store-x").unwrap();
    assert_eq!(pending.len(), 2, "term-2's pending item must survive");
    let terminals: Vec<String> = pending
        .iter()
        .map(|i| {
            let v: serde_json::Value = serde_json::from_str(&i.payload).unwrap();
            v["terminal_id"].as_str().unwrap_or("").to_string()
        })
        .collect();
    assert!(terminals.iter().any(|t| t == "term-1"));
    assert!(terminals.iter().any(|t| t == "term-2"));
}

// ── List pending ────────────────────────────────────────────────

#[test]
fn list_pending_offline_empty() {
    let conn = fresh();
    let items = store(&conn).list_pending_offline().unwrap();
    assert!(items.is_empty());
}

#[test]
fn list_pending_offline_returns_only_pending_oldest_first() {
    let conn = fresh();
    seed_pending_and_synced(&conn);
    let items = store(&conn).list_pending_offline().unwrap();
    assert_eq!(items.len(), 2);
    assert_eq!(items[0].id, "oq-1");
    assert_eq!(items[1].id, "oq-2");
    assert_eq!(items[0].retry_count, 0);
    assert_eq!(items[1].retry_count, 2);
    assert_eq!(items[1].last_error.as_deref(), Some("timeout"));
}

// ── List all ────────────────────────────────────────────────────

#[test]
fn list_all_offline_returns_all_statuses_most_recent_first() {
    let conn = fresh();
    seed_pending_and_synced(&conn);
    let items = store(&conn).list_all_offline().unwrap();
    assert_eq!(items.len(), 4);
    // Most recent first (created_at DESC).
    assert_eq!(items[0].id, "oq-2");
    assert_eq!(items[3].id, "oq-4");
}

// ── Mark synced ─────────────────────────────────────────────────

#[test]
fn mark_offline_synced_updates_status() {
    let conn = fresh();
    seed_pending_and_synced(&conn);
    let s = store(&conn);

    s.mark_offline_synced("oq-1").unwrap();

    let items = s.list_pending_offline().unwrap();
    assert_eq!(items.len(), 1, "only oq-2 should still be pending");
}

#[test]
fn mark_offline_synced_not_found() {
    let conn = fresh();
    let err = store(&conn).mark_offline_synced("nonexistent").unwrap_err();
    assert!(matches!(err, CoreError::NotFound { entity, .. } if entity == "offline_queue"));
}

#[test]
fn mark_offline_synced_sets_timestamp() {
    let conn = fresh();
    seed_pending_and_synced(&conn);
    let s = store(&conn);

    s.mark_offline_synced("oq-2").unwrap();

    let all = s.list_all_offline().unwrap();
    let item = all.into_iter().find(|i| i.id == "oq-2").unwrap();
    assert_eq!(item.status, OfflineQueueStatus::Synced);
    assert!(item.synced_at.is_some(), "synced_at should be populated");
}

// ── Mark failed ─────────────────────────────────────────────────

#[test]
fn mark_offline_failed_increments_retry() {
    let conn = fresh();
    seed_pending_and_synced(&conn);
    let s = store(&conn);

    s.mark_offline_failed("oq-1", "network error").unwrap();

    let all = s.list_all_offline().unwrap();
    let item = all.into_iter().find(|i| i.id == "oq-1").unwrap();
    assert_eq!(item.status, OfflineQueueStatus::Failed);
    assert_eq!(item.retry_count, 1);
    assert_eq!(item.last_error.as_deref(), Some("network error"));
}

#[test]
fn mark_offline_failed_increments_existing_retry() {
    let conn = fresh();
    seed_pending_and_synced(&conn);
    let s = store(&conn);

    s.mark_offline_failed("oq-2", "another error").unwrap();

    let all = s.list_all_offline().unwrap();
    let item = all.into_iter().find(|i| i.id == "oq-2").unwrap();
    assert_eq!(item.retry_count, 3, "should increment from 2 to 3");
}

// ── Pending count ───────────────────────────────────────────────

#[test]
fn pending_offline_count_zero() {
    let conn = fresh();
    let count = store(&conn).pending_offline_count().unwrap();
    assert_eq!(count, 0);
}

#[test]
fn pending_offline_count_matches() {
    let conn = fresh();
    seed_pending_and_synced(&conn);
    let count = store(&conn).pending_offline_count().unwrap();
    assert_eq!(count, 2);
}

// ── Delete ──────────────────────────────────────────────────────

#[test]
fn delete_offline_item_removes() {
    let conn = fresh();
    seed_pending_and_synced(&conn);
    let s = store(&conn);

    s.delete_offline_item("oq-1").unwrap();

    let all = s.list_all_offline().unwrap();
    assert_eq!(all.len(), 3);
    assert!(all.into_iter().all(|i| i.id != "oq-1"));
}

#[test]
fn delete_offline_item_nonexistent_does_not_error() {
    let conn = fresh();
    let s = store(&conn);
    // Deleting a non-existent item should succeed (no error).
    s.delete_offline_item("nonexistent").unwrap();
}

// ── Additional edge cases ─────────────────────────────────────

#[test]
fn enqueue_offline_with_tenant_sets_tenant_id() {
    let conn = fresh();
    let s = store(&conn);
    let item = s
        .enqueue_offline_with_tenant("sale.create", "{}", "tenant-a")
        .unwrap();
    assert_eq!(item.tenant_id, "tenant-a");
    assert_eq!(item.action, "sale.create");
}

#[test]
fn enqueue_offline_priority_roundtrip() {
    let conn = fresh();
    let s = store(&conn);
    let item = s
        .enqueue_offline_priority("payment.sync", "{}", SyncPriority::Critical)
        .unwrap();
    assert_eq!(item.priority, SyncPriority::Critical);
    let item = s
        .enqueue_offline_priority("audit.log", "{}", SyncPriority::Low)
        .unwrap();
    assert_eq!(item.priority, SyncPriority::Low);
    // Default is Normal.
    let item = s
        .enqueue_offline_priority("default", "{}", SyncPriority::Normal)
        .unwrap();
    assert_eq!(item.priority, SyncPriority::Normal);
}

#[test]
fn list_pending_offline_for_tenant_filters() {
    let conn = fresh();
    let s = store(&conn);

    // Enqueue items for different tenants.
    s.enqueue_offline_with_tenant("sale.create", "{}", "tenant-a")
        .unwrap();
    s.enqueue_offline_with_tenant("product.update", "{}", "tenant-b")
        .unwrap();
    s.enqueue_offline_with_tenant("sale.void", "{}", "tenant-a")
        .unwrap();

    let a_items = s.list_pending_offline_for_tenant("tenant-a").unwrap();
    assert_eq!(a_items.len(), 2);
    assert!(a_items.iter().all(|i| i.tenant_id == "tenant-a"));

    let b_items = s.list_pending_offline_for_tenant("tenant-b").unwrap();
    assert_eq!(b_items.len(), 1);
}

#[test]
fn enqueue_offline_scoped_combines_tenant_and_priority() {
    // OFF-09: the combined tenant + priority entry point the command
    // boundary uses must persist both fields on the same row.
    let conn = fresh();
    let s = store(&conn);
    let item = s
        .enqueue_offline_scoped("complete_sale", "{}", "store-a", SyncPriority::Critical)
        .unwrap();
    assert_eq!(item.tenant_id, "store-a");
    assert_eq!(item.priority, SyncPriority::Critical);

    let loaded = s.list_pending_offline_for_tenant("store-a").unwrap();
    assert_eq!(loaded.len(), 1);
    assert_eq!(loaded[0].priority, SyncPriority::Critical);

    // A different tenant never sees it.
    let other = s.list_pending_offline_for_tenant("store-b").unwrap();
    assert!(other.is_empty());
}

#[test]
fn pending_batch_orders_critical_before_normal_before_low() {
    // OFF-09: the retry command sorts the batch by priority so Critical
    // items always transmit first. Pins the ordering contract on the
    // raw items returned by the store.
    let conn = fresh();
    let s = store(&conn);
    s.enqueue_offline_scoped("settings.change", "{}", "default", SyncPriority::Low)
        .unwrap();
    s.enqueue_offline_scoped("complete_sale", "{}", "default", SyncPriority::Critical)
        .unwrap();
    s.enqueue_offline_scoped("product.update", "{}", "default", SyncPriority::Normal)
        .unwrap();

    let mut batch = s.list_pending_offline().unwrap();
    batch.sort_by_key(|i| i.priority);
    assert_eq!(batch.len(), 3);
    assert_eq!(batch[0].priority, SyncPriority::Critical);
    assert_eq!(batch[1].priority, SyncPriority::Normal);
    assert_eq!(batch[2].priority, SyncPriority::Low);
}

#[test]
fn list_pending_offline_for_tenant_empty() {
    let conn = fresh();
    let s = store(&conn);
    let items = s.list_pending_offline_for_tenant("no-such-tenant").unwrap();
    assert!(items.is_empty());
}

// ── SYNC-07: two-tenant boundary through the client queue ────────

#[test]
fn tenant_scoped_count_isolates_tenants() {
    let conn = fresh();
    let s = store(&conn);

    s.enqueue_offline_with_tenant("sale.create", "{}", "tenant-a")
        .unwrap();
    s.enqueue_offline_with_tenant("sale.create", "{}", "tenant-a")
        .unwrap();
    s.enqueue_offline_with_tenant("product.update", "{}", "tenant-b")
        .unwrap();

    assert_eq!(s.pending_offline_count_for_tenant("tenant-a").unwrap(), 2);
    assert_eq!(s.pending_offline_count_for_tenant("tenant-b").unwrap(), 1);
    assert_eq!(s.pending_offline_count_for_tenant("tenant-c").unwrap(), 0);
}

#[test]
fn tenant_scoped_mark_synced_refuses_cross_tenant() {
    let conn = fresh();
    let s = store(&conn);

    let item = s
        .enqueue_offline_with_tenant("sale.create", "{}", "tenant-a")
        .unwrap();

    // Correct tenant: succeeds.
    s.mark_offline_synced_for_tenant(&item.id, "tenant-a")
        .unwrap();
    assert_eq!(s.pending_offline_count().unwrap(), 0);

    // Cross-tenant (re-insert, then attempt from tenant-b): NotFound,
    // and the row stays untouched (still pending).
    let item2 = s
        .enqueue_offline_with_tenant("sale.create", "{}", "tenant-a")
        .unwrap();
    let err = s
        .mark_offline_synced_for_tenant(&item2.id, "tenant-b")
        .unwrap_err();
    assert!(matches!(err, CoreError::NotFound { entity, .. } if entity == "offline_queue"));
    assert_eq!(s.pending_offline_count_for_tenant("tenant-a").unwrap(), 1);
}

#[test]
fn tenant_scoped_mark_failed_does_not_touch_other_tenant() {
    let conn = fresh();
    let s = store(&conn);

    let item = s
        .enqueue_offline_with_tenant("sale.create", "{}", "tenant-a")
        .unwrap();

    // Cross-tenant mark-failed is a no-op: status stays pending.
    s.mark_offline_failed_for_tenant(&item.id, "tenant-b", "boom")
        .unwrap();
    let all = s.list_all_offline().unwrap();
    let row = all.into_iter().find(|i| i.id == item.id).unwrap();
    assert_eq!(row.status, OfflineQueueStatus::Pending);
    assert_eq!(row.retry_count, 0);

    // Correct tenant: marks failed + increments retry.
    s.mark_offline_failed_for_tenant(&item.id, "tenant-a", "boom")
        .unwrap();
    let all = s.list_all_offline().unwrap();
    let row = all.into_iter().find(|i| i.id == item.id).unwrap();
    assert_eq!(row.status, OfflineQueueStatus::Failed);
    assert_eq!(row.retry_count, 1);
}

#[test]
fn tenant_scoped_delete_does_not_touch_other_tenant() {
    let conn = fresh();
    let s = store(&conn);

    let item = s
        .enqueue_offline_with_tenant("sale.create", "{}", "tenant-a")
        .unwrap();

    // Cross-tenant delete is a no-op: row survives.
    s.delete_offline_item_for_tenant(&item.id, "tenant-b")
        .unwrap();
    assert_eq!(s.pending_offline_count().unwrap(), 1);

    // Correct tenant: row removed.
    s.delete_offline_item_for_tenant(&item.id, "tenant-a")
        .unwrap();
    assert_eq!(s.pending_offline_count().unwrap(), 0);
}

// ── SYNC-01: durable pull anchor + idempotency ledger ────────────

#[test]
fn sync_pull_state_defaults_to_none() {
    let conn = fresh();
    let st = store(&conn).get_sync_pull_state().unwrap();
    assert!(st.since.is_none());
    assert!(st.cursor.is_none());
}

#[test]
fn sync_pull_state_roundtrip() {
    let conn = fresh();
    let s = store(&conn);
    s.set_sync_pull_state(Some("2026-01-01T00:00:00Z"), None)
        .unwrap();
    let st = s.get_sync_pull_state().unwrap();
    assert_eq!(st.since.as_deref(), Some("2026-01-01T00:00:00Z"));
    assert!(st.cursor.is_none());

    // Single-row guard: overwrite, never insert a second row.
    s.set_sync_pull_state(
        Some("2026-02-01T00:00:00Z"),
        Some("2026-02-01T00:00:00Z|abc"),
    )
    .unwrap();
    let st = s.get_sync_pull_state().unwrap();
    assert_eq!(st.since.as_deref(), Some("2026-02-01T00:00:00Z"));
    assert_eq!(st.cursor.as_deref(), Some("2026-02-01T00:00:00Z|abc"));

    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM sync_pull_state", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 1, "sync_pull_state must stay a single row");
}

#[test]
fn sync_applied_items_tracks_ids() {
    let conn = fresh();
    let s = store(&conn);
    assert!(!s.is_remote_item_applied("item-1").unwrap());

    s.mark_remote_item_applied("item-1", "stock.adjusted")
        .unwrap();
    assert!(s.is_remote_item_applied("item-1").unwrap());

    // INSERT OR IGNORE — replay is a no-op.
    s.mark_remote_item_applied("item-1", "stock.adjusted")
        .unwrap();
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM sync_applied_items", [], |r| r.get(0))
        .unwrap();
    assert_eq!(
        count, 1,
        "re-applying the same item must not duplicate the ledger row"
    );
}

#[test]
fn mark_offline_failed_nonexistent_noop() {
    let conn = fresh();
    let s = store(&conn);
    // mark_offline_failed doesn't check affected rows, so this should be a no-op.
    s.mark_offline_failed("nonexistent", "test error").unwrap();
    // Verify state unchanged.
    let count = s.pending_offline_count().unwrap();
    assert_eq!(count, 0);
}

// ── requeue_remote_failure (dead-letter requeue workflow) ────────

#[test]
fn requeue_remote_failure_clears_quarantine_and_rewinds_anchor() {
    let conn = fresh();
    let s = store(&conn);

    // Drive a remote item to the dead letter (3 failed attempts).
    let mut dead_lettered = false;
    for _ in 0..3 {
        dead_lettered = s
            .record_remote_failure(
                "remote-item-1",
                "complete_sale",
                "{}",
                "permanent failure",
                3,
            )
            .unwrap();
    }
    assert!(dead_lettered, "third attempt must dead-letter the item");
    assert!(s.is_remote_failure_dead_lettered("remote-item-1").unwrap());

    // The daemon had already advanced the durable pull anchor past the
    // item (the anchor is what let it skip the quarantine).
    s.set_sync_pull_state(Some("2026-06-01T00:00:00Z"), Some("cursor-1"))
        .unwrap();

    s.requeue_remote_failure("remote-item-1").unwrap();

    // Quarantine cleared: no failure row remains.
    assert!(!s.is_remote_failure_dead_lettered("remote-item-1").unwrap());
    assert!(s.list_remote_failures().unwrap().is_empty());

    // Anchor rewound so the next pull re-fetches the requeued item. A
    // full re-pull is safe: the idempotency ledger skips every
    // already-applied item, and only the requeued item mutates.
    let st = s.get_sync_pull_state().unwrap();
    assert!(st.since.is_none(), "anchor must rewind to a full re-pull");
    assert!(
        st.cursor.is_none(),
        "cursor must be cleared with the anchor"
    );
}

#[test]
fn requeue_remote_failure_refuses_non_dead_lettered() {
    let conn = fresh();
    let s = store(&conn);

    // A retryable failure (not yet quarantined) cannot be requeued —
    // the daemon is already retrying it and the anchor is retained.
    s.record_remote_failure("remote-item-2", "complete_sale", "{}", "transient", 3)
        .unwrap();
    assert!(!s.is_remote_failure_dead_lettered("remote-item-2").unwrap());

    let err = s.requeue_remote_failure("remote-item-2").unwrap_err();
    assert!(matches!(err, CoreError::NotFound { entity, .. } if entity == "sync_remote_failures"));

    // An id that was never recorded is likewise NotFound.
    let err = s.requeue_remote_failure("never-seen").unwrap_err();
    assert!(matches!(err, CoreError::NotFound { entity, .. } if entity == "sync_remote_failures"));
}

// ── Dedup tests ───────────────────────────────────────────────────

#[test]
fn enqueue_dedup_first_call_inserts() {
    let conn = fresh();
    let s = store(&conn);
    let result = s
        .enqueue_offline_dedup("complete_sale", r#"{"sale_id":"s-1"}"#)
        .unwrap();
    assert!(result.is_some(), "first call should enqueue");
    let count = s.pending_offline_count().unwrap();
    assert_eq!(count, 1);
}

#[test]
fn enqueue_dedup_second_call_skips() {
    let conn = fresh();
    let s = store(&conn);

    // First call — inserts
    let first = s
        .enqueue_offline_dedup("complete_sale", r#"{"sale_id":"s-1"}"#)
        .unwrap();
    assert!(first.is_some());

    // Second call — dedup skips
    let second = s
        .enqueue_offline_dedup("complete_sale", r#"{"sale_id":"s-1"}"#)
        .unwrap();
    assert!(second.is_none(), "duplicate should be deduped");

    let count = s.pending_offline_count().unwrap();
    assert_eq!(count, 1, "only one item should be pending");
}

#[test]
fn enqueue_dedup_same_action_different_payload_passes() {
    let conn = fresh();
    let s = store(&conn);

    let first = s
        .enqueue_offline_dedup("complete_sale", r#"{"sale_id":"s-1"}"#)
        .unwrap();
    assert!(first.is_some());

    // Different sale_id — should insert
    let second = s
        .enqueue_offline_dedup("complete_sale", r#"{"sale_id":"s-2"}"#)
        .unwrap();
    assert!(second.is_some(), "different payload should not be deduped");

    let count = s.pending_offline_count().unwrap();
    assert_eq!(count, 2);
}

#[test]
fn enqueue_dedup_different_action_same_payload_passes() {
    let conn = fresh();
    let s = store(&conn);

    let first = s
        .enqueue_offline_dedup("complete_sale", r#"{"id":"x"}"#)
        .unwrap();
    assert!(first.is_some());

    // Different action — should insert
    let second = s
        .enqueue_offline_dedup("void_sale", r#"{"id":"x"}"#)
        .unwrap();
    assert!(second.is_some(), "different action should not be deduped");

    let count = s.pending_offline_count().unwrap();
    assert_eq!(count, 2);
}

#[test]
fn enqueue_dedup_synced_item_does_not_block() {
    let conn = fresh();
    let s = store(&conn);

    // Enqueue, mark synced, then try to enqueue same again
    let first = s
        .enqueue_offline_dedup("complete_sale", r#"{"sale_id":"s-1"}"#)
        .unwrap();
    assert!(first.is_some());
    let id = first.as_ref().unwrap().id.clone();
    s.mark_offline_synced(&id).unwrap();

    // Same action+payload — but the original is synced, not pending
    let second = s
        .enqueue_offline_dedup("complete_sale", r#"{"sale_id":"s-1"}"#)
        .unwrap();
    // The original item is synced so this should be treated as a new item.
    // (We only dedup against items still pending.)
    assert!(second.is_some(), "synced item should not block re-enqueue");
}

#[test]
fn enqueue_dedup_cross_terminal_scenario() {
    // Simulate: Terminal A enqueues sale, Terminal B receives it via
    // sync and tries to re-enqueue. The dedup should prevent the
    // duplicate if the payload is byte-identical.
    let conn = fresh();
    let s = store(&conn);

    // Terminal A completes the sale
    let payload = r#"{"sale_id":"s-A-1","items":[{"sku":"COFFEE","qty":2}]}"#;
    let result = s.enqueue_offline_dedup("complete_sale", payload).unwrap();
    assert!(result.is_some(), "Terminal A: first enqueue should succeed");

    // Same sale arrives from Terminal B via sync (byte-identical payload)
    let result = s.enqueue_offline_dedup("complete_sale", payload).unwrap();
    assert!(result.is_none(), "Terminal B: duplicate should be deduped");

    let count = s.pending_offline_count().unwrap();
    assert_eq!(count, 1, "only one pending item after cross-terminal dedup");
}

#[test]
fn list_all_offline_empty_db() {
    let conn = fresh();
    let items = store(&conn).list_all_offline().unwrap();
    assert!(items.is_empty());
}

#[test]
fn delete_offline_item_only_removes_target() {
    let conn = fresh();
    seed_pending_and_synced(&conn);
    let s = store(&conn);

    s.delete_offline_item("oq-1").unwrap();
    let remaining = s.list_all_offline().unwrap();
    assert_eq!(remaining.len(), 3);
    assert!(remaining.iter().all(|i| i.id != "oq-1"));
    // oq-2, oq-3, oq-4 should still be present.
    assert!(remaining.iter().any(|i| i.id == "oq-2"));
    assert!(remaining.iter().any(|i| i.id == "oq-3"));
    assert!(remaining.iter().any(|i| i.id == "oq-4"));
}

// ── P1-6: SyncStatusSummary tests ────────────────────────────────

#[test]
fn status_summary_empty_db() {
    let conn = fresh();
    let s = store(&conn);
    let summary = s.offline_queue_status_summary().unwrap();
    assert_eq!(summary.pending_count, 0);
    assert_eq!(summary.synced_count, 0);
    assert_eq!(summary.failed_count, 0);
    assert_eq!(summary.total_retry_count, 0);
    assert!(summary.last_synced_at.is_none());
    assert!(summary.oldest_pending_at.is_none());
}

#[test]
fn status_summary_with_seeded_data() {
    let conn = fresh();
    seed_pending_and_synced(&conn);
    let s = store(&conn);
    let summary = s.offline_queue_status_summary().unwrap();

    // oq-1 (pending), oq-2 (pending), oq-3 (synced), oq-4 (failed)
    assert_eq!(summary.pending_count, 2);
    assert_eq!(summary.synced_count, 1);
    assert_eq!(summary.failed_count, 1);
    // oq-4 has retry_count = 3
    assert_eq!(summary.total_retry_count, 3);

    // oq-3 is synced at '2025-01-01T11:01:00.000Z'
    assert_eq!(
        summary.last_synced_at.as_deref(),
        Some("2025-01-01T11:01:00.000Z")
    );

    // oq-1 is the oldest pending at '2025-01-01T12:00:00.000Z'
    assert_eq!(
        summary.oldest_pending_at.as_deref(),
        Some("2025-01-01T12:00:00.000Z")
    );
}

#[test]
fn status_summary_updates_after_operations() {
    let conn = fresh();
    let s = store(&conn);

    // Empty
    let summary = s.offline_queue_status_summary().unwrap();
    assert_eq!(summary.pending_count, 0);

    // Enqueue an item
    let item = s.enqueue_offline("test", "{}").unwrap();
    let summary = s.offline_queue_status_summary().unwrap();
    assert_eq!(summary.pending_count, 1);
    assert_eq!(summary.synced_count, 0);
    assert!(summary.oldest_pending_at.is_some());

    // Mark it synced
    s.mark_offline_synced(&item.id).unwrap();
    let summary = s.offline_queue_status_summary().unwrap();
    assert_eq!(summary.pending_count, 0);
    assert_eq!(summary.synced_count, 1);
    assert!(summary.last_synced_at.is_some());
}

#[test]
fn status_summary_total_retry_across_multiple_failed() {
    let conn = fresh();
    let s = store(&conn);

    // Insert two failed items with retry counts
    s.enqueue_offline("a", "{}").unwrap();
    let b = s.enqueue_offline("b", "{}").unwrap();
    s.mark_offline_failed(&b.id, "err").unwrap();
    s.mark_offline_failed(&b.id, "err").unwrap();

    let summary = s.offline_queue_status_summary().unwrap();
    assert_eq!(summary.failed_count, 1);
    assert_eq!(summary.total_retry_count, 2);
}

#[test]
fn status_summary_serde_roundtrip() {
    let summary = SyncStatusSummary {
        pending_count: 5,
        synced_count: 10,
        failed_count: 2,
        total_retry_count: 7,
        last_synced_at: Some("2025-06-01T12:00:00Z".into()),
        oldest_pending_at: None,
        conflict_count: 0,
    };
    let json = serde_json::to_string(&summary).unwrap();
    let rt: SyncStatusSummary = serde_json::from_str(&json).unwrap();
    assert_eq!(rt.pending_count, 5);
    assert_eq!(rt.synced_count, 10);
    assert_eq!(rt.failed_count, 2);
    assert_eq!(rt.total_retry_count, 7);
}

#[test]
fn status_summary_debug_output() {
    let summary = SyncStatusSummary {
        pending_count: 1,
        synced_count: 2,
        failed_count: 0,
        total_retry_count: 0,
        last_synced_at: None,
        oldest_pending_at: None,
        conflict_count: 0,
    };
    let debug = format!("{summary:?}");
    assert!(debug.contains("pending_count: 1"));
    assert!(debug.contains("synced_count: 2"));
}

// ── COR-20 degradation visibility (2026-09-06) ─────────────────────

#[test]
fn query_or_none_passes_through_a_real_value() {
    let got = query_or_none("test", Ok("2026-09-06T00:00:00Z".into()));
    assert_eq!(got.as_deref(), Some("2026-09-06T00:00:00Z"));
}

#[test]
fn query_or_none_treats_empty_result_as_silent_none() {
    // The normal "no rows" answer must NOT be logged as a degradation —
    // an empty queue is the expected common case for last_synced_at and
    // oldest_pending_at.
    let got = query_or_none("test", Err(rusqlite::Error::QueryReturnedNoRows));
    assert_eq!(got, None);
}

#[test]
fn query_or_none_degrades_real_db_errors_to_none() {
    // Same observable result as the empty case (None) but the log path —
    // a real failure must not be silently indistinguishable in the log.
    let err = rusqlite::Error::SqliteFailure(rusqlite::ffi::Error::new(1), Some("boom".into()));
    let got = query_or_none("test", Err(err));
    assert_eq!(got, None);
}

#[test]
fn status_summary_empty_db_returns_defaults_not_error() {
    // Regression pin for the QueryReturnedNoRows separation: with no rows at all,
    // the summary must still return Ok with zeros/None (the pre-fix .ok()
    // did this by conflation; the fix must not turn empty into Err).
    let conn = fresh();
    let s = store(&conn);
    let summary = s
        .offline_queue_status_summary()
        .expect("empty summary must be Ok");
    assert_eq!(summary.pending_count, 0);
    assert_eq!(summary.synced_count, 0);
    assert_eq!(summary.failed_count, 0);
    assert_eq!(summary.total_retry_count, 0);
    assert_eq!(summary.last_synced_at, None);
    assert_eq!(summary.oldest_pending_at, None);
    assert_eq!(summary.conflict_count, 0);
}

#[test]
fn status_summary_timestamps_survive_after_mark_synced() {
    // The Ok path of query_or_none must still surface real timestamps —
    // guarding against the separation accidentally dropping values.
    let conn = fresh();
    let s = store(&conn);
    let item = s.enqueue_offline("sale.create", "{}").unwrap();
    assert!(
        s.offline_queue_status_summary()
            .unwrap()
            .oldest_pending_at
            .is_some()
    );
    s.mark_offline_synced(&item.id).unwrap();
    let summary = s.offline_queue_status_summary().unwrap();
    assert!(
        summary.last_synced_at.is_some(),
        "synced_at must surface via query_or_none Ok path"
    );
    assert_eq!(summary.oldest_pending_at, None, "no pending items left");
}

#[test]
fn test_enqueue_offline_fails_when_subscription_read_only() {
    let conn = fresh();
    let s = store(&conn);

    // Update the seeded bootstrap subscription to Plus, expiring 30 days ago (past the 14-day offline grace period).
    let past_expiry = (chrono::Utc::now() - chrono::Duration::days(30)).to_rfc3339();
    conn.execute(
        "UPDATE tenant_subscription SET
            tier_key = 'plus', status = 'active', expires_at = ?1
         WHERE tenant_id = 'default'",
        rusqlite::params![past_expiry],
    )
    .unwrap();

    let err = s.enqueue_offline("sale.create", "{}").unwrap_err();
    assert!(
        matches!(err, CoreError::SubscriptionReadOnly(_)),
        "expected SubscriptionReadOnly error, got: {err:?}"
    );

    // Verify queue remains empty.
    let items = s.list_all_offline().unwrap();
    assert_eq!(
        items.len(),
        0,
        "no offline items may be enqueued when POS is read-only"
    );
}

// ── Transactional outbox primitive ──────────────────────────────

/// The row written by `enqueue_offline_in_tx` must live or die with the
/// caller's transaction - that IS the fix for the commit-then-enqueue loss
/// window. Rolled back: no queue row, so a settlement that never happened
/// can never be pushed.
#[test]
fn enqueue_offline_in_tx_rolls_back_with_its_transaction() {
    let conn = fresh();
    {
        let tx = conn.unchecked_transaction().unwrap();
        Store::enqueue_offline_in_tx(
            &tx,
            "complete_sale",
            "{\"sale_id\":\"s-9\"}",
            "store-7",
            SyncPriority::Critical,
        )
        .unwrap();
        // Visible inside the same transaction, and only there.
        let inside: i64 = tx
            .query_row("SELECT COUNT(*) FROM offline_queue", [], |r| r.get(0))
            .unwrap();
        assert_eq!(inside, 1);
        drop(tx); // rusqlite rolls back a dropped transaction
    }
    let after: i64 = conn
        .query_row("SELECT COUNT(*) FROM offline_queue", [], |r| r.get(0))
        .unwrap();
    assert_eq!(
        after, 0,
        "a rolled-back settlement must leave no outbox row"
    );
}

/// Committed: the row is there, with the tenant it was given and the
/// priority tier the sale lane needs. The tenant is the part worth pinning -
/// `enqueue_offline_priority` hardcodes "default", so a helper that silently
/// did the same would reintroduce the multi-store bug this one avoids.
#[test]
fn enqueue_offline_in_tx_commits_with_its_transaction_and_keeps_the_tenant() {
    let conn = fresh();
    {
        let tx = conn.unchecked_transaction().unwrap();
        Store::enqueue_offline_in_tx(
            &tx,
            "complete_sale",
            "{\"sale_id\":\"s-8\"}",
            "store-7",
            SyncPriority::Critical,
        )
        .unwrap();
        tx.commit().unwrap();
    }
    let (tenant, priority, status): (String, i32, String) = conn
        .query_row(
            "SELECT tenant_id, priority, status FROM offline_queue WHERE action = 'complete_sale'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!(
        tenant, "store-7",
        "the real tenant, not a hardcoded default"
    );
    assert_eq!(priority, SyncPriority::Critical as i32);
    assert_eq!(status, "pending");
}

// ── Wired settlement doors write the outbox row in-transaction ──

fn money(minor: i64) -> crate::Money {
    crate::Money {
        minor_units: minor,
        currency: "USD".parse().unwrap(),
    }
}

fn seed_item(conn: &Connection, sku: &str, stock: i64) {
    let s = store(conn);
    s.create_product(sku, sku, money(500), None, None, 0, Some("retail"))
        .unwrap();
    if stock > 0 {
        // adjust_stock is deprecated (single-column path); the canonical
        // successor needs a tx + location, same shape as the products_tests
        // shim. Seed data uses the canonical default location.
        let tx = conn.unchecked_transaction().unwrap();
        let loc = LocationId::from(CANONICAL_DEFAULT_LOCATION_UUID);
        s.adjust_stock_at_location_with_reason(&tx, sku, stock, &loc, None, None, None, None)
            .unwrap();
        tx.commit().unwrap();
    }
}

fn sale_with_one_line(sku: &str, qty: i64, unit_minor: i64) -> crate::Sale {
    let id = uuid::Uuid::now_v7().to_string();
    let line_id = uuid::Uuid::now_v7().to_string();
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let total = unit_minor * qty;
    crate::Sale {
        id: id.clone(),
        status: crate::SaleStatus::Pending,
        total: money(total),
        currency: "USD".parse().unwrap(),
        line_count: 1,
        payment_method: Some("cash".into()),
        tendered_minor: Some(total),
        discount_percent: 0,
        discount_label: None,
        user_id: None,
        created_at: now.clone(),
        updated_at: now,
        subtotal: money(total),
        tax_total: money(0),
        customer_id: None,
        base_currency: None,
        base_total_minor: None,
        tender_rate_millionths: None,
        tip_minor: 0,
        service_charge_minor: 0,
        version: 1,
        lines: vec![crate::SaleLine {
            id: line_id,
            sale_id: id,
            sku: sku.into(),
            qty,
            unit_price: money(unit_minor),
            line_total: money(total),
            line_position: 1,
            tax_amount: money(0),
            tax_rate_id: None,
            tax_breakdown_json: None,
            serial_number: None,
            course: None,
            modifiers_json: None,
        }],
    }
}

fn split(amount: i64, key: Option<&str>) -> crate::PaymentSplitArg {
    crate::PaymentSplitArg {
        method: "cash".into(),
        amount_minor: amount,
        gateway_reference: None,
        gateway_status: None,
        gateway_response: None,
        idempotency_key: key.map(str::to_string),
    }
}

fn outbox_rows(conn: &Connection, sale_id: &str) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM offline_queue WHERE action = 'complete_sale' AND instr(payload, ?1) > 0",
        rusqlite::params![format!("\"sale_id\":\"{sale_id}\"")],
        |r| r.get(0),
    )
    .unwrap()
}

/// A committed settlement through the main checkout door must leave EXACTLY
/// ONE queue row - the in-transaction one - and the handler's probe must see
/// it, which is what stops the second row. Two rows would push the sale twice.
#[test]
fn wired_settlement_leaves_exactly_one_outbox_row() {
    let conn = fresh();
    seed_item(&conn, "OUTBOX-A", 5);
    let s = store(&conn);
    let sale = sale_with_one_line("OUTBOX-A", 2, 500);
    let id = sale.id.clone();

    s.complete_sale_deduction(&sale, None, &[split(1000, None)], "user-a", None)
        .unwrap();

    assert_eq!(outbox_rows(&conn, &id), 1, "the settlement wrote one row");
    assert!(
        s.has_pending_outbox_row_for_sale("complete_sale", &id)
            .unwrap()
    );
    let (tenant, priority): (String, i32) = conn
        .query_row(
            "SELECT tenant_id, priority FROM offline_queue WHERE action = 'complete_sale'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(tenant, "default", "tenant read from the sale row");
    assert_eq!(priority, SyncPriority::Critical as i32);

    // The handler's guarded path, run after the commit as the bus does:
    // it must add nothing.
    if !s
        .has_pending_outbox_row_for_sale("complete_sale", &id)
        .unwrap()
    {
        s.enqueue_offline_priority(
            "complete_sale",
            &format!("{{\"sale_id\":\"{id}\"}}"),
            SyncPriority::Critical,
        )
        .unwrap();
    }
    assert_eq!(
        outbox_rows(&conn, &id),
        1,
        "the handler must not add a second row for a wired lane"
    );
}

/// The rollback proof, and it is only possible because the enqueue sits
/// BEFORE the payment inserts: two splits sharing one idempotency key collide
/// on the UNIQUE index, the whole transaction rolls back, and the outbox row
/// that had already been written inside it must be gone with the sale.
#[test]
fn rolled_back_settlement_enqueues_nothing() {
    let conn = fresh();
    seed_item(&conn, "OUTBOX-B", 5);
    let s = store(&conn);
    let sale = sale_with_one_line("OUTBOX-B", 2, 500);
    let id = sale.id.clone();

    let err = s
        .complete_sale_deduction(
            &sale,
            None,
            &[split(500, Some("dup-key")), split(500, Some("dup-key"))],
            "user-a",
            None,
        )
        .unwrap_err();
    assert!(matches!(err, CoreError::Db(_)), "{err:?}");

    assert_eq!(
        outbox_rows(&conn, &id),
        0,
        "a rolled-back settlement must leave no outbox row"
    );
    let sales: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sales WHERE id = ?1",
            rusqlite::params![&id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(sales, 0, "and no sale - the row and the sale die together");
    assert!(
        !s.has_pending_outbox_row_for_sale("complete_sale", &id)
            .unwrap()
    );
}
