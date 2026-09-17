//! Unit tests for the sync queue (`queue.rs`): pending/all listing,
//! enqueue + dedup, mark synced/failed, status summary, last-synced
//! timestamp, conflict resolution application, the atomic remote-apply
//! pipeline (SYNC-01 receipts, quarantine gate, dead-letter retry
//! budget), CRDT merge consumption (SYNC-05), settings delta writes
//! (SYNC-10), and the deprecated non-atomic `apply_remote` mirror.
//! Extracted from the inline `mod tests` in `queue.rs` (F-018).

use super::*;
use kasirmu_core::migrations;
use rusqlite::Connection;

fn setup_store() -> Store<'static> {
    let conn: &'static Connection = Box::leak(Box::new(migrations::fresh_db()));
    Store::new(conn)
}

#[test]
fn queue_empty_pending() {
    let store = setup_store();
    let queue = SyncQueue::new();
    let pending = queue.list_pending(&store).unwrap();
    assert!(pending.is_empty());
}

#[test]
fn queue_enqueue_and_list() {
    let store = setup_store();
    let queue = SyncQueue::new();
    let item = queue
        .enqueue(&store, "complete_sale", r#"{"sale_id":"s1"}"#)
        .unwrap();
    assert_eq!(item.action, "complete_sale");

    let pending = queue.list_pending(&store).unwrap();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].id, item.id);
}

#[test]
fn queue_mark_synced() {
    let store = setup_store();
    let queue = SyncQueue::new();
    let item = queue.enqueue(&store, "test", "{}").unwrap();
    queue.mark_synced(&store, &item.id).unwrap();

    let pending = queue.list_pending(&store).unwrap();
    assert!(pending.is_empty());
}

#[test]
fn queue_mark_failed() {
    let store = setup_store();
    let queue = SyncQueue::new();
    let item = queue.enqueue(&store, "test", "{}").unwrap();
    queue
        .mark_failed(&store, &item.id, "network error")
        .unwrap();

    let all = queue.list_all(&store).unwrap();
    assert_eq!(all[0].status, OfflineQueueStatus::Failed);
}

#[test]
fn queue_last_synced_at_none() {
    let store = setup_store();
    let queue = SyncQueue::new();
    assert!(queue.last_synced_at(&store).unwrap().is_none());
}

#[test]
fn queue_last_synced_at_after_sync() {
    let store = setup_store();
    let queue = SyncQueue::new();
    let item = queue.enqueue(&store, "test", "{}").unwrap();
    queue.mark_synced(&store, &item.id).unwrap();
    assert!(queue.last_synced_at(&store).unwrap().is_some());
}

#[test]
fn queue_delete_removes_item() {
    let store = setup_store();
    let queue = SyncQueue::new();
    let item = queue.enqueue(&store, "test", "{}").unwrap();
    queue.delete(&store, &item.id).unwrap();
    let all = queue.list_all(&store).unwrap();
    assert!(all.is_empty());
}

#[test]
fn queue_delete_nonexistent_does_not_error() {
    let store = setup_store();
    let queue = SyncQueue::new();
    let result = queue.delete(&store, "nonexistent-id");
    assert!(result.is_ok());
}

#[test]
fn queue_pending_count() {
    let store = setup_store();
    let queue = SyncQueue::new();
    assert_eq!(queue.pending_count(&store).unwrap(), 0);

    queue.enqueue(&store, "a", "{}").unwrap();
    queue.enqueue(&store, "b", "{}").unwrap();
    assert_eq!(queue.pending_count(&store).unwrap(), 2);

    // After marking one synced, count decreases.
    let pending = queue.list_pending(&store).unwrap();
    queue.mark_synced(&store, &pending[0].id).unwrap();
    assert_eq!(queue.pending_count(&store).unwrap(), 1);
}

#[test]
fn queue_list_all_returns_all_statuses() {
    let store = setup_store();
    let queue = SyncQueue::new();
    let item1 = queue.enqueue(&store, "a", "{}").unwrap();
    let _item2 = queue.enqueue(&store, "b", "{}").unwrap();

    queue.mark_synced(&store, &item1.id).unwrap();

    let all = queue.list_all(&store).unwrap();
    assert_eq!(all.len(), 2);
}

#[test]
fn queue_list_pending_returns_oldest_first() {
    let store = setup_store();
    let queue = SyncQueue::new();
    let item1 = queue.enqueue(&store, "first", "{}").unwrap();
    let item2 = queue.enqueue(&store, "second", "{}").unwrap();

    let pending = queue.list_pending(&store).unwrap();
    assert_eq!(pending[0].id, item1.id, "oldest item should be first");
    assert_eq!(pending[1].id, item2.id);
}

// ── Dedup tests (P1-5) ────────────────────────────────────────────

#[test]
fn queue_enqueue_dedup_skips_duplicate() {
    let store = setup_store();
    let queue = SyncQueue::new();

    let payload = r#"{"sale_id":"s-1"}"#;
    let first = queue
        .enqueue_dedup(&store, "complete_sale", payload)
        .unwrap();
    assert!(first.is_some(), "first call should enqueue");

    let second = queue
        .enqueue_dedup(&store, "complete_sale", payload)
        .unwrap();
    assert!(second.is_none(), "duplicate should be skipped");

    let count = queue.pending_count(&store).unwrap();
    assert_eq!(count, 1);
}

#[test]
fn queue_enqueue_dedup_allows_different_payload() {
    let store = setup_store();
    let queue = SyncQueue::new();

    let first = queue
        .enqueue_dedup(&store, "complete_sale", r#"{"sale_id":"s-1"}"#)
        .unwrap();
    assert!(first.is_some());

    let second = queue
        .enqueue_dedup(&store, "complete_sale", r#"{"sale_id":"s-2"}"#)
        .unwrap();
    assert!(second.is_some(), "different sale_id should not be deduped");

    let count = queue.pending_count(&store).unwrap();
    assert_eq!(count, 2);
}

#[test]
fn queue_enqueue_dedup_allows_different_action() {
    let store = setup_store();
    let queue = SyncQueue::new();

    let payload = r#"{"id":"x"}"#;
    let first = queue
        .enqueue_dedup(&store, "complete_sale", payload)
        .unwrap();
    assert!(first.is_some());

    let second = queue.enqueue_dedup(&store, "void_sale", payload).unwrap();
    assert!(second.is_some(), "different action should not be deduped");

    let count = queue.pending_count(&store).unwrap();
    assert_eq!(count, 2);
}

#[test]
fn queue_enqueue_dedup_cross_terminal_scenario() {
    // Simulate: Terminal A completes a sale and enqueues it.
    // That sale syncs to Terminal B, which also tries to enqueue
    // the exact same payload — the dedup should prevent duplicates.
    let store = setup_store();
    let queue = SyncQueue::new();

    let payload = r#"{"sale_id":"s-cross-1","items":[{"sku":"COFFEE","qty":2}]}"#;

    // Terminal A enqueues
    let a = queue
        .enqueue_dedup(&store, "complete_sale", payload)
        .unwrap();
    assert!(a.is_some(), "Terminal A should enqueue");

    // Terminal B receives the same payload via sync and tries to enqueue
    let b = queue
        .enqueue_dedup(&store, "complete_sale", payload)
        .unwrap();
    assert!(b.is_none(), "Terminal B duplicate should be deduped");

    // Verify only one pending item exists
    let count = queue.pending_count(&store).unwrap();
    assert_eq!(count, 1);
}

#[test]
fn queue_enqueue_dedup_allows_after_mark_synced() {
    // After an item is synced, a new enqueue with the same payload
    // should not be deduped (only checks Pending items).
    let store = setup_store();
    let queue = SyncQueue::new();

    let payload = r#"{"sale_id":"s-1"}"#;
    let first = queue
        .enqueue_dedup(&store, "complete_sale", payload)
        .unwrap();
    assert!(first.is_some());
    let id = first.unwrap().id.clone();

    queue.mark_synced(&store, &id).unwrap();

    let second = queue
        .enqueue_dedup(&store, "complete_sale", payload)
        .unwrap();
    assert!(
        second.is_some(),
        "should re-enqueue after original is synced"
    );
}

// ── P1-6: SyncStatusSummary tests ────────────────────────────

#[test]
fn queue_status_summary_empty() {
    let store = setup_store();
    let queue = SyncQueue::new();
    let summary = queue.status_summary(&store).unwrap();
    assert_eq!(summary.pending_count, 0);
    assert_eq!(summary.synced_count, 0);
    assert_eq!(summary.failed_count, 0);
    assert!(summary.last_synced_at.is_none());
    assert!(summary.oldest_pending_at.is_none());
}

#[test]
fn queue_status_summary_with_data() {
    let store = setup_store();
    let queue = SyncQueue::new();

    let item1 = queue.enqueue(&store, "a", "{}").unwrap();
    queue.enqueue(&store, "b", "{}").unwrap();
    queue.mark_synced(&store, &item1.id).unwrap();

    let summary = queue.status_summary(&store).unwrap();
    assert_eq!(summary.pending_count, 1);
    assert_eq!(summary.synced_count, 1);
    assert_eq!(summary.failed_count, 0);
    assert!(summary.last_synced_at.is_some());
    assert!(summary.oldest_pending_at.is_some());
}

#[test]
fn queue_status_summary_after_mark_failed() {
    let store = setup_store();
    let queue = SyncQueue::new();

    let item = queue.enqueue(&store, "test", "{}").unwrap();
    queue.mark_failed(&store, &item.id, "timeout").unwrap();

    let summary = queue.status_summary(&store).unwrap();
    assert_eq!(summary.pending_count, 0);
    assert_eq!(summary.failed_count, 1);
    assert_eq!(summary.total_retry_count, 1);
}

#[test]
fn queue_last_synced_at_multiple_items() {
    let store = setup_store();
    let queue = SyncQueue::new();
    let item1 = queue.enqueue(&store, "a", "{}").unwrap();
    let item2 = queue.enqueue(&store, "b", "{}").unwrap();

    queue.mark_synced(&store, &item1.id).unwrap();
    let ts1 = queue.last_synced_at(&store).unwrap().unwrap();

    queue.mark_synced(&store, &item2.id).unwrap();
    let ts2 = queue.last_synced_at(&store).unwrap().unwrap();

    // The timestamp of the most recently synced item should be >= the earlier one.
    assert!(ts2 >= ts1, "last synced at should increase");
}

#[test]
fn queue_apply_resolution_local_wins() {
    let store = setup_store();
    let queue = SyncQueue::new();
    let local = queue.enqueue(&store, "test", "{}").unwrap();

    let remote = OfflineQueueItem {
        id: uuid::Uuid::now_v7().to_string(),
        action: "test".into(),
        payload: "{}".into(),
        status: OfflineQueueStatus::Pending,
        retry_count: 0,
        last_error: None,
        created_at: "2025-01-01T00:00:00.000Z".into(),
        synced_at: None,
        tenant_id: "default".into(),
        priority: kasirmu_core::offline::SyncPriority::Normal,
    };

    let resolved = ResolvedItem {
        local: Some(local.clone()),
        remote: Some(remote),
        winner: local.clone(),
    };

    queue.apply_resolution(&store, &resolved).unwrap();

    // Local item should be marked synced.
    let all = store.list_all_offline().unwrap();
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].status, OfflineQueueStatus::Synced);
}

#[test]
fn queue_apply_resolution_remote_wins() {
    let store = setup_store();
    let queue = SyncQueue::new();
    let local = queue.enqueue(&store, "test", "{}").unwrap();

    let remote = OfflineQueueItem {
        id: uuid::Uuid::now_v7().to_string(),
        action: "test".into(),
        payload: r#"{"from":"server"}"#.into(),
        status: OfflineQueueStatus::Pending,
        retry_count: 0,
        last_error: None,
        created_at: "2025-06-01T12:00:00.000Z".into(),
        synced_at: None,
        tenant_id: "default".into(),
        priority: kasirmu_core::offline::SyncPriority::Normal,
    };

    let resolved = ResolvedItem {
        local: Some(local.clone()),
        remote: Some(remote.clone()),
        winner: remote,
    };

    queue.apply_resolution(&store, &resolved).unwrap();

    // Local item should be marked synced. No new item enqueued because
    // the winner is the remote item (not a merge).
    let all = store.list_all_offline().unwrap();
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].status, OfflineQueueStatus::Synced);
}

fn seed_product_and_inventory(store: &Store<'_>) {
    store.conn().execute_batch(
            "INSERT INTO products (id, sku, name, price_minor, currency, created_at, updated_at) VALUES
                ('prod-coffee', 'COFFEE', 'Coffee', 350, 'USD', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
                ('prod-bagel', 'BAGEL', 'Bagel', 450, 'USD', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
             INSERT INTO inventory (product_id, qty, updated_at) VALUES
                ('prod-coffee', 50, '2025-01-01T00:00:00.000Z'),
                ('prod-bagel', 30, '2025-01-01T00:00:00.000Z');",
        )
        .unwrap();
}

fn inventory_qty(store: &Store<'_>, sku: &str) -> i64 {
    let pid = store.product_id_by_sku(sku).unwrap().unwrap();
    store.get_stock(&pid).unwrap()
}

#[test]
fn apply_remote_complete_sale_deducts_stock() {
    let store = setup_store();
    seed_product_and_inventory(&store);
    let queue = SyncQueue::new();

    let payload = r#"{"line_items":[{"sku":"COFFEE","qty":2},{"sku":"BAGEL","qty":1}]}"#;
    let remote = OfflineQueueItem::new("complete_sale", payload);
    let result = queue.apply_remote(&store, &remote);
    assert!(result.is_ok(), "apply_remote should succeed");

    assert_eq!(
        inventory_qty(&store, "COFFEE"),
        48,
        "COFFEE should drop from 50 to 48"
    );
    assert_eq!(
        inventory_qty(&store, "BAGEL"),
        29,
        "BAGEL should drop from 30 to 29"
    );
}

#[test]
fn apply_remote_atomic_replay_changes_stock_once() {
    let store = setup_store();
    seed_product_and_inventory(&store);
    let queue = SyncQueue::new();
    let remote = OfflineQueueItem {
        id: "remote-sale-once".into(),
        action: "complete_sale".into(),
        payload: r#"{"line_items":[{"sku":"COFFEE","qty":2}]}"#.into(),
        ..OfflineQueueItem::new("complete_sale", "{}")
    };

    assert!(queue.apply_remote_atomic(&store, &remote).unwrap());
    assert!(!queue.apply_remote_atomic(&store, &remote).unwrap());
    assert_eq!(inventory_qty(&store, "COFFEE"), 48);
    assert!(store.is_remote_item_applied(&remote.id).unwrap());
}

#[test]
fn apply_remote_atomic_failure_rolls_back_mutation_and_receipt() {
    let store = setup_store();
    seed_product_and_inventory(&store);
    let queue = SyncQueue::new();
    let remote = OfflineQueueItem {
        id: "remote-sale-invalid".into(),
        action: "complete_sale".into(),
        payload: r#"{"line_items":[{"sku":"COFFEE","qty":2},{"sku":"MISSING","qty":1}]}"#.into(),
        ..OfflineQueueItem::new("complete_sale", "{}")
    };

    assert!(queue.apply_remote_atomic(&store, &remote).is_err());
    assert_eq!(inventory_qty(&store, "COFFEE"), 50);
    assert!(!store.is_remote_item_applied(&remote.id).unwrap());
    assert!(!store.is_remote_failure_dead_lettered(&remote.id).unwrap());

    // The third failed attempt quarantines the poison item. A later
    // replay is skipped without mutating state or advancing a receipt.
    assert!(queue.apply_remote_atomic(&store, &remote).is_err());
    assert!(queue.apply_remote_atomic(&store, &remote).is_err());
    assert!(store.is_remote_failure_dead_lettered(&remote.id).unwrap());
    assert!(!queue.apply_remote_atomic(&store, &remote).unwrap());
}

#[test]
fn apply_remote_atomic_clears_stale_failure_after_success() {
    let store = setup_store();
    seed_product_and_inventory(&store);
    let queue = SyncQueue::new();
    let remote = OfflineQueueItem {
        id: "remote-sale-recovered".into(),
        action: "complete_sale".into(),
        payload: r#"{"line_items":[{"sku":"COFFEE","qty":1}]}"#.into(),
        ..OfflineQueueItem::new("complete_sale", "{}")
    };

    store
        .record_remote_failure(
            &remote.id,
            &remote.action,
            &remote.payload,
            "temporary failure",
            3,
        )
        .unwrap();
    assert_eq!(store.list_remote_failures().unwrap().len(), 1);

    assert!(queue.apply_remote_atomic(&store, &remote).unwrap());
    assert_eq!(inventory_qty(&store, "COFFEE"), 49);
    assert!(store.list_remote_failures().unwrap().is_empty());
}

#[test]
fn apply_remote_atomic_rejects_conflicting_existing_product() {
    let store = setup_store();
    let queue = SyncQueue::new();
    store
        .conn()
        .execute(
            "INSERT INTO products (id, sku, name, price_minor, currency, created_at, updated_at,
                                      product_type, version)
                 VALUES ('prod-existing', 'COFFEE', 'Existing Coffee', 350, 'USD',
                         '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z', 'retail', 1)",
            [],
        )
        .unwrap();
    let payload = serde_json::json!({
        "sku": "COFFEE",
        "name": "Different Coffee",
        "price_minor": 450,
        "currency": "USD",
        "initial_stock": 0,
        "product_type": "retail"
    })
    .to_string();
    let remote = OfflineQueueItem::new("product.created", &payload);

    assert!(queue.apply_remote_atomic(&store, &remote).is_err());
    assert!(!store.is_remote_item_applied(&remote.id).unwrap());
    assert_eq!(
        store.get_product("COFFEE").unwrap().unwrap().product.name,
        "Existing Coffee"
    );
}

#[test]
fn apply_remote_stock_adjustment() {
    let store = setup_store();
    seed_product_and_inventory(&store);
    let queue = SyncQueue::new();

    // Add 10 units.
    let payload = r#"{"sku":"COFFEE","delta":10}"#;
    let remote = OfflineQueueItem::new("stock.adjusted", payload);
    let result = queue.apply_remote(&store, &remote);
    assert!(result.is_ok());
    assert_eq!(
        inventory_qty(&store, "COFFEE"),
        60,
        "COFFEE should increase from 50 to 60"
    );

    // Remove 5 units.
    let payload = r#"{"sku":"BAGEL","delta":-5}"#;
    let remote = OfflineQueueItem::new("stock.adjusted", payload);
    let result = queue.apply_remote(&store, &remote);
    assert!(result.is_ok());
    assert_eq!(
        inventory_qty(&store, "BAGEL"),
        25,
        "BAGEL should drop from 30 to 25"
    );
}

#[test]
fn apply_remote_unknown_action_is_noop() {
    let store = setup_store();
    let queue = SyncQueue::new();
    let remote = OfflineQueueItem::new("unknown.action", r#"{"data":"test"}"#);
    let result = queue.apply_remote(&store, &remote);
    assert!(result.is_ok(), "unknown action should not error");
    let all = store.list_all_offline().unwrap();
    assert!(all.is_empty(), "no queue items should be created");
}

#[test]
fn apply_remote_atomic_rejects_unknown_action_without_receipt() {
    let store = setup_store();
    let queue = SyncQueue::new();
    let remote = OfflineQueueItem::new("unknown.action", r#"{\"data\":\"test\"}"#);
    assert!(queue.apply_remote_atomic(&store, &remote).is_err());
    assert!(!store.is_remote_item_applied(&remote.id).unwrap());
}

// ── finalize_sale (cloud webhook → terminal) ─────────────────

/// The cloud server's webhook path enqueues a `finalize_sale` item
/// (`{"sale_id": …}`) into offline_queue so the pending sale completes
/// on the terminal after payment capture. The dispatcher MUST apply
/// it: transition the sale to completed.
#[test]
fn apply_remote_atomic_finalizes_pending_sale() {
    let store = setup_store();
    let queue = SyncQueue::new();

    // Seed a pending sale the way the terminal's complete flow leaves it.
    let sale_id = "sale-finalize-1";
    store
        .conn()
        .execute(
            "INSERT INTO sales (id, total_minor, currency, line_count, status, payment_method,
                                    tendered_minor, discount_percent, discount_label, user_id,
                                    created_at, updated_at, subtotal_minor, tax_total_minor,
                                    deduction_locations, version)
                 VALUES (?1, 1000, 'USD', 1, 'pending', 'CARD', 1000, 0, NULL, 'user-1',
                         '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 1000, 0, '[]', 1)",
            [sale_id],
        )
        .unwrap();

    // The webhook's exact payload shape.
    let remote = OfflineQueueItem::new("finalize_sale", format!(r#"{{"sale_id":"{sale_id}"}}"#));
    let outcome = queue
        .apply_remote_atomic_full(&store, &remote)
        .expect("finalize_sale must apply, not dead-letter as unsupported");
    assert!(outcome.applied, "finalize_sale must be marked applied");

    // The pending sale must now be completed.
    let status: String = store
        .conn()
        .query_row("SELECT status FROM sales WHERE id = ?1", [sale_id], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(
        status, "completed",
        "sale must be finalized by the remote item"
    );
}

#[test]
fn apply_remote_legacy_finalizes_pending_sale() {
    let store = setup_store();
    let queue = SyncQueue::new();

    let sale_id = "sale-finalize-legacy";
    store
        .conn()
        .execute(
            "INSERT INTO sales (id, total_minor, currency, line_count, status, payment_method,
                                    tendered_minor, discount_percent, discount_label, user_id,
                                    created_at, updated_at, subtotal_minor, tax_total_minor,
                                    deduction_locations, version)
                 VALUES (?1, 1000, 'USD', 1, 'pending', 'CARD', 1000, 0, NULL, 'user-1',
                         '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 1000, 0, '[]', 1)",
            [sale_id],
        )
        .unwrap();

    let remote = OfflineQueueItem::new("finalize_sale", format!(r#"{{"sale_id":"{sale_id}"}}"#));
    queue
        .apply_remote(&store, &remote)
        .expect("legacy apply_remote must accept finalize_sale");
    let status: String = store
        .conn()
        .query_row("SELECT status FROM sales WHERE id = ?1", [sale_id], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(status, "completed");
}

// ── SYNC-10: remote settings application + reactivity ────────

/// Helper: a remote `settings.update` item as the cloud server would
/// deliver it (fixed id so the idempotency ledger absorbs replays).
fn remote_settings_update(id: &str) -> OfflineQueueItem {
    let mut item = OfflineQueueItem::new(
        "settings.update",
        r#"{"key":"store.name","value":"Remote Acme","terminal_id":"term-remote","version":3}"#,
    );
    item.id = id.into();
    item.created_at = "2026-01-02T00:00:00.000Z".into();
    item
}

/// SYNC-10 Red: a remote `settings.update` must apply the value row AND
/// a versioned delta ledger row atomically with the idempotency receipt
/// — today it errors as an unsupported action and gets quarantined.
#[test]
fn apply_remote_atomic_settings_update_writes_row_and_delta() {
    let store = setup_store();
    let queue = SyncQueue::new();
    let remote = remote_settings_update("remote-setting-1");

    assert!(
        queue.apply_remote_atomic(&store, &remote).unwrap(),
        "settings.update must apply instead of erroring as unsupported"
    );
    assert_eq!(
        kasirmu_core::settings::Settings::get(store.conn(), "store.name")
            .unwrap()
            .as_deref(),
        Some("Remote Acme"),
        "the settings row must be updated"
    );
    assert_eq!(
        kasirmu_core::settings::Settings::get_version(store.conn(), "store.name", "term-remote")
            .unwrap(),
        Some(1),
        "a versioned delta row must be written for the (key, terminal) pair"
    );
    assert!(
        store.is_remote_item_applied("remote-setting-1").unwrap(),
        "the idempotency receipt must be recorded with the mutation"
    );
}

/// SYNC-10 Red: the atomic apply must surface the settings change
/// (changed key + originating terminal) so the daemon can publish
/// `SettingsUpdated` for UI reactivity. `apply_remote_atomic_full` is
/// the reporting variant; the legacy bool wrapper keeps old callers.
#[test]
fn apply_remote_atomic_full_surfaces_settings_change() {
    let store = setup_store();
    let queue = SyncQueue::new();
    let remote = remote_settings_update("remote-setting-2");

    let outcome = queue.apply_remote_atomic_full(&store, &remote).unwrap();
    assert!(outcome.applied);
    assert_eq!(
        outcome.settings_change,
        Some(("store.name".to_string(), "term-remote".to_string())),
        "the changed key and originating terminal must be reported"
    );
}

/// SYNC-10: replay of the same remote settings item must NOT publish a
/// second change (the ledger skips it, so the outcome carries no change).
#[test]
fn apply_remote_atomic_full_replay_reports_no_settings_change() {
    let store = setup_store();
    let queue = SyncQueue::new();
    let remote = remote_settings_update("remote-setting-3");

    let first = queue.apply_remote_atomic_full(&store, &remote).unwrap();
    let replay = queue.apply_remote_atomic_full(&store, &remote).unwrap();
    assert!(first.applied);
    assert!(first.settings_change.is_some());
    assert!(
        !replay.applied && replay.settings_change.is_none(),
        "a replayed item must not re-apply or re-report the change (SYNC-01)"
    );
}

/// SYNC-10: the non-atomic dispatcher (legacy SyncEngine path) applies
/// settings updates with the same row + delta semantics.
#[test]
fn apply_remote_settings_update_non_atomic() {
    let store = setup_store();
    let queue = SyncQueue::new();
    let remote = remote_settings_update("remote-setting-4");

    queue.apply_remote(&store, &remote).unwrap();
    assert_eq!(
        kasirmu_core::settings::Settings::get(store.conn(), "store.name")
            .unwrap()
            .as_deref(),
        Some("Remote Acme")
    );
    assert_eq!(
        kasirmu_core::settings::Settings::get_version(store.conn(), "store.name", "term-remote")
            .unwrap(),
        Some(1)
    );
}

/// SYNC-10: the `settings.change` action alias (the audit catalog's
/// spelling) applies identically to `settings.update`.
#[test]
fn apply_remote_settings_change_alias() {
    let store = setup_store();
    let queue = SyncQueue::new();
    let mut remote = remote_settings_update("remote-setting-5");
    remote.action = "settings.change".into();

    let outcome = queue.apply_remote_atomic_full(&store, &remote).unwrap();
    assert!(outcome.applied);
    assert_eq!(
        outcome.settings_change,
        Some(("store.name".to_string(), "term-remote".to_string()))
    );
    assert_eq!(
        kasirmu_core::settings::Settings::get(store.conn(), "store.name")
            .unwrap()
            .as_deref(),
        Some("Remote Acme")
    );
}

// ── stock.movement cross-store delta routing (ADR #6) ────────

#[test]
fn apply_remote_stock_movement_inserts_into_ledger() {
    let store = setup_store();
    seed_product_and_inventory(&store);
    let queue = SyncQueue::new();

    let payload = serde_json::json!({
        "id": "sm-remote-1",
        "item_id": "prod-coffee",
        "delta": 10,
        "reason": "cross-store-transfer",
        "source_terminal_id": "term-store-b",
        "source_user_id": "user-store-b",
        "store_id": "store-b",
        "created_at": "2026-01-15T00:00:00Z"
    })
    .to_string();

    let remote = OfflineQueueItem::new("stock.movement", &payload);
    let result = queue.apply_remote(&store, &remote);
    assert!(result.is_ok(), "stock.movement should succeed");

    // Verify the movement was inserted into the ledger.
    let movements = store.list_stock_movements("prod-coffee", 10, 0).unwrap();
    let sm = movements.iter().find(|m| m.id == "sm-remote-1");
    assert!(sm.is_some(), "remote stock movement should be in ledger");
    let sm = sm.unwrap();
    assert_eq!(sm.delta, 10);
    assert_eq!(sm.store_id, "store-b");
    assert_eq!(sm.reason.as_deref(), Some("cross-store-transfer"));
    assert_eq!(sm.source_terminal_id.as_deref(), Some("term-store-b"));
}

#[test]
fn apply_remote_stock_movement_negative_delta() {
    let store = setup_store();
    seed_product_and_inventory(&store);
    let queue = SyncQueue::new();

    let payload = serde_json::json!({
        "id": "sm-remote-2",
        "item_id": "prod-bagel",
        "delta": -5,
        "reason": null,
        "source_terminal_id": null,
        "source_user_id": null,
        "store_id": "store-a",
        "created_at": "2026-01-15T00:00:00Z"
    })
    .to_string();

    let remote = OfflineQueueItem::new("stock.movement", &payload);
    queue.apply_remote(&store, &remote).unwrap();

    let movements = store.list_stock_movements("prod-bagel", 10, 0).unwrap();
    let sm = movements.iter().find(|m| m.id == "sm-remote-2").unwrap();
    assert_eq!(sm.delta, -5);
    assert_eq!(sm.store_id, "store-a");
}

#[test]
fn apply_remote_stock_movement_rebuilds_summary() {
    let store = setup_store();
    seed_product_and_inventory(&store);
    let queue = SyncQueue::new();

    // Insert movements from another store directly into the ledger.
    let payload = serde_json::json!({
        "id": "sm-cross-1",
        "item_id": "prod-coffee",
        "delta": 30,
        "reason": "transfer-in",
        "source_terminal_id": null,
        "source_user_id": null,
        "store_id": "store-b",
        "created_at": "2026-01-15T00:00:00Z"
    })
    .to_string();
    let remote = OfflineQueueItem::new("stock.movement", &payload);
    queue.apply_remote(&store, &remote).unwrap(); // Rebuild to verify the ledger-based computation.
    store.rebuild_stock_summary().unwrap();

    // 30 -> 50. seed_product_and_inventory writes inventory (prod-coffee = 50)
    // with no movement behind it — exactly the legacy shape the scoped rebuild
    // now closes with one `legacy-backfill` compensating movement. The pulled
    // cross-store delta is still the only REMOTE row, but the ledger is no
    // longer short by the 20 unbacked units, so the re-derive lands on 50
    // instead of destroying them. Same reader, same call; only the expected
    // quantity moved.
    let from_ledger = store.get_stock_from_ledger("prod-coffee").unwrap();
    assert_eq!(
        from_ledger, 50,
        "SUM of deltas for prod-coffee: 30 pulled + 20 healed unbacked units"
    );

    // The materialized inventory now reflects the healed ledger too.
    let inv_qty = store.get_stock("prod-coffee").unwrap();
    assert_eq!(inv_qty, 50, "inventory should be rebuilt to 50, not 30");
}

// ── SYNC-02: shared conflict-application service ────────────────

#[test]
fn apply_push_conflict_routes_version_lww() {
    // A higher local product version must win, exactly as the
    // SyncEngine would resolve it (SYNC-02 shared service).
    let store = setup_store();
    let queue = SyncQueue::new();
    let local = queue
        .enqueue(
            &store,
            "product.update",
            r#"{"version":5,"name":"Local New"}"#,
        )
        .unwrap();
    let server_item =
        OfflineQueueItem::new("product.update", r#"{"version":3,"name":"Server Stale"}"#);

    queue
        .apply_push_conflict(&store, &local, &server_item)
        .unwrap();

    // Local item marked resolved (synced) with the local-won tag; no
    // re-enqueued remote winner.
    let all = store.list_all_offline().unwrap();
    assert_eq!(all.len(), 1, "local winner must not enqueue a new item");
    assert_eq!(all[0].status, OfflineQueueStatus::Synced);
    assert!(
        all[0]
            .last_error
            .as_deref()
            .unwrap_or("")
            .contains("resolved: conflict (local won)"),
        "local item must carry the resolution tag, got: {:?}",
        all[0].last_error
    );
}

#[test]
fn apply_push_conflict_routes_sale_status_dag() {
    // Completed must win over pending even when the local item is
    // NEWER — proves the daemon path can no longer discard an advanced
    // sale state via blanket "remote wins" (SYNC-02).
    let store = setup_store();
    let queue = SyncQueue::new();
    let local = queue
        .enqueue(
            &store,
            "complete_sale",
            r#"{"status":"pending","version":2}"#,
        )
        .unwrap();
    let server_item =
        OfflineQueueItem::new("complete_sale", r#"{"status":"completed","version":1}"#);

    queue
        .apply_push_conflict(&store, &local, &server_item)
        .unwrap();

    let all = store.list_all_offline().unwrap();
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].status, OfflineQueueStatus::Synced);
    assert!(
        all[0]
            .last_error
            .as_deref()
            .unwrap_or("")
            .contains("resolved: conflict (remote won)"),
        "completed server sale must win the DAG, got: {:?}",
        all[0].last_error
    );
}

// ── SYNC-05: CRDT merge payloads are consumable end-to-end ─────

#[test]
fn apply_remote_consumes_crdt_merge_stock_adjusted() {
    let store = setup_store();
    seed_product_and_inventory(&store);
    let queue = SyncQueue::new();

    // Build the exact merged payload resolve_stock_crdt produces.
    let merged = serde_json::json!({
        "local": {"sku": "COFFEE", "delta": 10},
        "remote": {"sku": "COFFEE", "delta": -3},
        "merge_type": "crdt_delta"
    })
    .to_string();
    let remote = OfflineQueueItem::new("stock.adjusted", &merged);

    queue.apply_remote(&store, &remote).unwrap();

    // Both deltas applied: 50 + 10 - 3 = 57.
    assert_eq!(inventory_qty(&store, "COFFEE"), 57);
}

#[test]
fn apply_remote_consumes_crdt_merge_stock_movement() {
    let store = setup_store();
    seed_product_and_inventory(&store);
    let queue = SyncQueue::new();

    let merged = serde_json::json!({
        "local": {
            "id": "sm-merge-1", "item_id": "prod-coffee", "delta": 10,
            "reason": "merge-a", "source_terminal_id": null,
            "source_user_id": null, "store_id": "store-b",
            "created_at": "2026-01-15T00:00:00Z"
        },
        "remote": {
            "id": "sm-merge-2", "item_id": "prod-bagel", "delta": -2,
            "reason": "merge-b", "source_terminal_id": null,
            "source_user_id": null, "store_id": "store-c",
            "created_at": "2026-01-15T00:00:01Z"
        },
        "merge_type": "crdt_delta"
    })
    .to_string();
    let remote = OfflineQueueItem::new("stock.movement", &merged);

    queue.apply_remote(&store, &remote).unwrap();

    // Both movement rows inserted into the ledger.
    let movements = store.list_stock_movements("prod-coffee", 10, 0).unwrap();
    assert!(
        movements.iter().any(|m| m.id == "sm-merge-1"),
        "local-side movement must be inserted"
    );
    let movements = store.list_stock_movements("prod-bagel", 10, 0).unwrap();
    assert!(
        movements.iter().any(|m| m.id == "sm-merge-2"),
        "remote-side movement must be inserted"
    );
}

#[test]
fn crdt_merge_end_to_end_resolve_to_apply() {
    // Full SYNC-05 path: resolve_conflict → apply_resolution (enqueue
    // merged winner) → apply_remote (consume merged payload). Both
    // deltas must survive the entire pipeline.
    let store = setup_store();
    seed_product_and_inventory(&store);
    let queue = SyncQueue::new();

    // The LOCAL item must already be in the queue — apply_resolution
    // marks it resolved (mark_offline_resolved) and fails with NotFound
    // when no row exists (mirrors a real push-conflict where the local
    // item is a pending queue row).
    let local = queue
        .enqueue(&store, "stock.adjusted", r#"{"sku":"COFFEE","delta":10}"#)
        .unwrap();
    let remote = OfflineQueueItem::new("stock.adjusted", r#"{"sku":"COFFEE","delta":-3}"#);

    // Step 1: resolve — merged winner carries both deltas.
    let resolved = crate::conflict::resolve_conflict(&local, &remote);
    let payload: Value = serde_json::from_str(&resolved.winner.payload).unwrap();
    assert_eq!(payload["merge_type"], "crdt_delta");

    // Step 2: persist — merged winner enqueued as a new pending item.
    queue.apply_resolution(&store, &resolved).unwrap();
    let pending = store.list_pending_offline().unwrap();
    assert_eq!(pending.len(), 1, "merged winner must be re-enqueued");
    let winner = &pending[0];
    assert_eq!(winner.action, "stock.adjusted");
    assert!(
        winner.payload.contains("crdt_delta"),
        "winner payload must keep the merge envelope"
    );

    // Step 3: consume — the normal remote dispatcher applies BOTH deltas.
    queue.apply_remote(&store, winner).unwrap();
    assert_eq!(inventory_qty(&store, "COFFEE"), 57, "50 + 10 - 3");
}

/// Seed a product whose stock lives at TWO named locations via the canonical
/// per-location writer (summary {loc-a: 7, loc-b: 3}, aggregate 10).
fn seed_two_location_stock(store: &Store<'_>) -> String {
    let conn = store.conn();
    conn.execute(
        "INSERT INTO products (id, sku, name, price_minor, currency, created_at, updated_at)
         VALUES ('prod-loc', 'LOC-TWO', 'Loc Two', 100, 'USD',
                 '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
        [],
    )
    .unwrap();
    for loc in ["loc-a", "loc-b"] {
        conn.execute(
            "INSERT INTO inventory_locations (id, name, type, created_at, updated_at)
             VALUES (?1, ?1, 'store', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
            [loc],
        )
        .unwrap();
    }
    let tx = conn.unchecked_transaction().unwrap();
    for (loc, delta) in [("loc-a", 7), ("loc-b", 3)] {
        store
            .adjust_stock_at_location_with_reason(
                &tx,
                "LOC-TWO",
                delta,
                &kasirmu_core::inventory::LocationId::from(loc),
                Some("seed"),
                None,
                None,
                None,
            )
            .unwrap();
    }
    tx.commit().unwrap();
    store.product_id_by_sku("LOC-TWO").unwrap().unwrap()
}

fn location_carrying_crdt_winner() -> OfflineQueueItem {
    let local = OfflineQueueItem {
        id: "crdt-loc-local".into(),
        action: "stock.adjusted".into(),
        payload: r#"{"sku":"LOC-TWO","delta":10,"location_id":"loc-a"}"#.into(),
        ..OfflineQueueItem::new("stock.adjusted", "{}")
    };
    let remote = OfflineQueueItem {
        id: "crdt-loc-remote".into(),
        action: "stock.adjusted".into(),
        payload: r#"{"sku":"LOC-TWO","delta":-3,"location_id":"loc-b"}"#.into(),
        ..OfflineQueueItem::new("stock.adjusted", "{}")
    };
    crate::conflict::resolve_stock_crdt(&local, &remote).winner
}

/// The three per-location assertions every CRDT stock merge must satisfy.
fn assert_location_scoped_merge(store: &Store<'_>, pid: &str) {
    let conn = store.conn();
    let mut stmt = conn
        .prepare(
            "SELECT location_id, qty FROM stock_summary WHERE item_id = ?1 ORDER BY location_id",
        )
        .unwrap();
    let rows: Vec<(String, i64)> = stmt
        .query_map([pid], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    drop(stmt);

    // 1. Each location row moved by its OWN delta (7+10, 3-3).
    assert_eq!(
        rows,
        vec![("loc-a".to_string(), 17), ("loc-b".to_string(), 0)],
        "per-location rows must carry their own deltas"
    );
    // 2. The legacy aggregate equals the SUM over BOTH locations.
    let sum: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(qty), 0) FROM stock_summary WHERE item_id = ?1",
            [pid],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(inventory_qty(store, "LOC-TWO"), 17);
    assert_eq!(sum, 17, "aggregate must equal the sum of both locations");
    // 3. Rows not collapsed into the canonical default location.
    let default_rows: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM stock_summary WHERE item_id = ?1 AND location_id = ?2",
            [
                pid,
                kasirmu_core::inventory::CANONICAL_DEFAULT_LOCATION_UUID,
            ],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(default_rows, 0, "no phantom row at the default location");
}

/// SYNC-05 regression (a04865100 follow-up): a CRDT conflict envelope whose
/// INNER local and remote objects each name a location_id must apply each
/// delta at its own location through the atomic pull path - the same
/// apply_remote_in_tx stock.adjusted arm the daemon pull uses.
#[test]
fn apply_remote_atomic_crdt_envelope_applies_location_scoped_deltas() {
    let store = setup_store();
    let pid = seed_two_location_stock(&store);
    let winner = location_carrying_crdt_winner();
    assert!(
        SyncQueue::new()
            .apply_remote_atomic(&store, &winner)
            .unwrap(),
        "merged crdt winner must apply"
    );
    assert_location_scoped_merge(&store, &pid);
}

/// Same envelope through the deprecated non-atomic apply_remote mirror -
/// both pull arms must treat location_id identically (and correctly).
#[test]
fn apply_remote_crdt_envelope_applies_location_scoped_deltas() {
    let store = setup_store();
    let pid = seed_two_location_stock(&store);
    let winner = location_carrying_crdt_winner();
    SyncQueue::new().apply_remote(&store, &winner).unwrap();
    assert_location_scoped_merge(&store, &pid);
}
/// Version-skew regression (SYNC-05): a CRDT envelope whose local side names
/// a location (ADR-19-aware terminal) and whose remote side is a bare
/// sku/delta from an older sender. The named delta must move its own row,
/// the unscoped delta must land at the canonical default location, and the
/// legacy aggregate must stay the SUM over every stock_summary row.
#[test]
fn apply_remote_atomic_crdt_envelope_mixed_location_and_unscoped_sides() {
    let store = setup_store();
    let pid = seed_two_location_stock(&store);
    let local = OfflineQueueItem {
        id: "crdt-mixed-local".into(),
        action: "stock.adjusted".into(),
        payload: r#"{"sku":"LOC-TWO","delta":10,"location_id":"loc-a"}"#.into(),
        ..OfflineQueueItem::new("stock.adjusted", "{}")
    };
    let remote = OfflineQueueItem {
        id: "crdt-mixed-remote".into(),
        action: "stock.adjusted".into(),
        payload: r#"{"sku":"LOC-TWO","delta":5}"#.into(),
        ..OfflineQueueItem::new("stock.adjusted", "{}")
    };
    let winner = crate::conflict::resolve_stock_crdt(&local, &remote).winner;
    assert!(
        SyncQueue::new()
            .apply_remote_atomic(&store, &winner)
            .unwrap(),
        "mixed crdt winner must apply"
    );

    let conn = store.conn();
    let qty_at = |loc: &str| -> i64 {
        conn.query_row(
            "SELECT COALESCE(qty, 0) FROM stock_summary WHERE item_id = ?1 AND location_id = ?2",
            rusqlite::params![pid, loc],
            |r| r.get(0),
        )
        .unwrap()
    };
    assert_eq!(
        qty_at("loc-a"),
        17,
        "located side moved its own row (7 + 10)"
    );
    assert_eq!(qty_at("loc-b"), 3, "unrelated named row untouched");
    assert_eq!(
        qty_at(kasirmu_core::inventory::CANONICAL_DEFAULT_LOCATION_UUID),
        5,
        "unscoped side landed at the canonical default location"
    );

    // Reader-writer agreement: aggregate equals the SUM over ALL rows.
    let sum: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(qty), 0) FROM stock_summary WHERE item_id = ?1",
            [pid.as_str()],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(inventory_qty(&store, "LOC-TWO"), 25);
    assert_eq!(sum, 25, "aggregate must equal the SUM over all rows");
}
// ── SYNC ingest policy: a remote settings write cannot plant credentials ──

/// Helper: a remote `settings.update` for an arbitrary key/value, as the
/// cloud server or a compromised peer would deliver it.
fn remote_settings_kv(id: &str, key: &str, value: &str) -> OfflineQueueItem {
    let payload = serde_json::json!({
        "key": key,
        "value": value,
        "terminal_id": "term-remote",
        "version": 3,
    });
    let mut item = OfflineQueueItem::new("settings.update", payload.to_string());
    item.id = id.into();
    item.created_at = "2026-01-02T00:00:00.000Z".into();
    item
}

/// The live hole: a `settings.update` carrying `machine_id` — the device-bound
/// KDF factor and trial lock — must NOT be applied. Fails against HEAD, where
/// the arm called `Settings::set` with no predicate at all.
#[test]
fn remote_settings_update_refuses_machine_id_and_keeps_local_value() {
    let store = setup_store();
    let queue = SyncQueue::new();
    Settings::set(store.conn(), "machine_id", "own-machine-fingerprint").unwrap();

    let outcome = queue
        .apply_remote_atomic_full(
            &store,
            &remote_settings_kv("ingest-mid", "machine_id", "PLANTED"),
        )
        .unwrap();
    assert_eq!(
        Settings::get(store.conn(), "machine_id")
            .unwrap()
            .as_deref(),
        Some("own-machine-fingerprint"),
        "a remote item must not overwrite this install's machine_id"
    );
    assert_eq!(
        outcome.settings_change, None,
        "a refused key must not be reported as a settings change either"
    );
}

/// Same for the lifecycle-manager prefixes: `local_api.secret` is the per-install
/// JWT signing key and `local_api.enabled` is manager-owned intent. Fails against
/// HEAD.
#[test]
fn remote_settings_update_refuses_local_api_and_lan_server_keys() {
    let store = setup_store();
    let queue = SyncQueue::new();
    Settings::set(store.conn(), "local_api.secret", "own-signing-secret").unwrap();

    for (id, key) in [
        ("ingest-las", "local_api.secret"),
        ("ingest-lae", "local_api.enabled"),
        ("ingest-lsb", "lan_server.bind"),
        ("ingest-sts", "sync_terminal_secret"),
        ("ingest-sti", "sync_terminal_id"),
        ("ingest-lak", "license.api_key"),
    ] {
        queue
            .apply_remote_atomic(&store, &remote_settings_kv(id, key, "PLANTED"))
            .unwrap();
        let value = Settings::get(store.conn(), key).unwrap();
        assert!(
            value.as_deref() != Some("PLANTED"),
            "{key} was applied from a remote sync item"
        );
    }
}

/// The regression guard for the queue suite: a refusal must not abort the batch,
/// so an ordinary key arriving alongside a planted one still lands — under BOTH
/// dispatchers, since the legacy `apply_remote` arm is a separate copy of the
/// logic.
#[test]
fn remote_settings_batch_continues_past_a_refused_key() {
    let store = setup_store();
    let queue = SyncQueue::new();
    Settings::set(store.conn(), "machine_id", "own-machine-fingerprint").unwrap();

    for (n, apply) in [("atomic", true), ("legacy", false)] {
        let key = format!("store.name-{n}");
        if apply {
            queue
                .apply_remote_atomic(
                    &store,
                    &remote_settings_kv("b-mid-a", "machine_id", "PLANTED"),
                )
                .unwrap();
            queue
                .apply_remote_atomic(
                    &store,
                    &remote_settings_kv("b-ok-a", "receipt.footer", "Terima kasih"),
                )
                .unwrap();
        } else {
            queue
                .apply_remote(
                    &store,
                    &remote_settings_kv("b-mid-l", "machine_id", "PLANTED"),
                )
                .unwrap();
            queue
                .apply_remote(
                    &store,
                    &remote_settings_kv("b-ok-l", "receipt.footer", "Terima kasih"),
                )
                .unwrap();
        }
        assert_eq!(
            Settings::get(store.conn(), "receipt.footer")
                .unwrap()
                .as_deref(),
            Some("Terima kasih"),
            "the ordinary key after a refused one must still apply ({n} dispatcher)"
        );
        assert_eq!(
            Settings::get(store.conn(), "machine_id")
                .unwrap()
                .as_deref(),
            Some("own-machine-fingerprint"),
            "{n} dispatcher must still refuse machine_id"
        );
        let _ = key;
    }
}

/// The refused key must be ABSENT, not merely unchanged: with no local value
/// seeded, a remote `settings.update` carrying a deny-listed key must leave no
/// row behind after the legacy (non-atomic) dispatcher runs — asserted by
/// reading the row back, because a warn line followed by a write is exactly
/// what a log-based assertion would pass on. Companion to
/// `remote_settings_batch_continues_past_a_refused_key`, which seeds a local
/// value and asserts it is retained; both must hold for the early-return
/// guard in the legacy settings arm to mean anything.
#[test]
fn legacy_apply_remote_leaves_a_refused_key_absent_from_the_database() {
    let store = setup_store();
    let queue = SyncQueue::new();

    for (id, key) in [
        ("ingest-absent-sak", "sync_api_key"),
        ("ingest-absent-mid", "machine_id"),
    ] {
        queue
            .apply_remote(&store, &remote_settings_kv(id, key, "PLANTED"))
            .unwrap();
        assert_eq!(
            Settings::get(store.conn(), key).unwrap(),
            None,
            "{key} was written by the legacy dispatcher despite the ingest policy refusal"
        );
    }
}

/// PIN OF A KNOWN HAZARD, NOT AN ENDORSEMENT. INVERT THIS TEST, DO NOT DELETE IT.
///
/// What the four refusal pins above prove is that the ingest gate refuses
/// SECRET_KEY_DENY_LIST, the device-bound ids and the two manager prefixes. What they do
/// not prove is the shape of the rule: IngestPolicy::RemoteSync is an EXCLUSION list over
/// an OPEN namespace (platform/core/src/settings/raw.rs:660-670), not an allow-list, so
/// every name the exclusion list does not carry — including names no screen can write
/// through the local doors but a peer can type into a payload — is admitted and written
/// through the bare Settings::set INSERT (raw.rs:98-114 delegating to raw.rs:37-45). The
/// applied key is the payload's own string, read verbatim at queue.rs:525-531.
///
/// Two properties make that serious, and they are the whole reason this is pinned in a
/// test rather than parked in a report:
///
/// 1. **The sender is not an authority.** Nothing in transport or sync_api signs or MACs
///    a settings item (queue.rs:10-12), and the server stores a pushed payload opaquely
///    (apps/cloud-server/src/sync_store.rs:201), so any peer inside the tenant — or the
///    server operator — can name the key.
/// 2. **The reader carries a bearer secret.** crates/kasirmu-core/src/sync_auth.rs:72 sends
///    `Authorization: Bearer <sync api key>` to whatever sync_server_url currently holds,
///    so planting that one name exfiltrates a credential without ever naming a credential
///    key. sync_enabled, pg_sync.host, pg_sync.user, pg_sync.dbname and redis.cache_ttl
///    are the same door in other shapes.
///
/// INVERTED, not deleted, 13-09-26, for the interim hazard-set fix (option B).
/// Read the five paragraphs above as the HISTORY of the finding: at 29f8f2634 this
/// test was GREEN and its greenness WAS the finding. Every assertion below now
/// carries the opposite polarity, so it is RED until the refusal lands — that red
/// set is the deliverable, and a pin asserting the door was shut before the code
/// shut it would have been a lie. After the hazard set lands, green here means the
/// opposite of what it meant at 29f8f2634: the planted row must NOT arrive, the
/// delta ledger must stay empty for the remote terminal, and the change must not be
/// published as SettingsUpdated. The fn name is kept, per the original instruction,
/// so the inversion reads as a flip in the diff rather than a deletion; rename it
/// (`remote_settings_update_refuses_a_key_the_exclusion_list_misses`) in the same
/// commit that turns it green.
#[test]
fn remote_settings_update_applies_a_key_the_exclusion_list_misses() {
    let store = setup_store();
    let queue = SyncQueue::new();
    let planted = "https://sync-ingest-hazard.invalid/";
    let mine = "https://my-own-server.invalid/";
    Settings::set(store.conn(), "sync_server_url", mine).unwrap();

    // Positive control FIRST: the gate must still admit what normal operation
    // replicates, or every refusal below would pass for a gate that refuses
    // everything. Reversed polarity from the original, same purpose.
    assert!(
        IngestPolicy::RemoteSync.admits("ui.locale"),
        "ui.locale stopped being admitted - the refusals below would prove nothing"
    );

    // The hazard name, now required to be refused.
    assert!(
        !IngestPolicy::RemoteSync.admits("sync_server_url"),
        "RED UNTIL THE HAZARD SET LANDS: a peer must not be able to repoint this install's sync target"
    );

    let outcome = queue
        .apply_remote_atomic_full(
            &store,
            &remote_settings_kv("ingest-unlisted", "sync_server_url", planted),
        )
        .unwrap();

    assert_eq!(
        Settings::get(store.conn(), "sync_server_url")
            .unwrap()
            .as_deref(),
        Some(mine),
        "RED UNTIL THE HAZARD SET LANDS: an unsigned item must not overwrite the sync target"
    );
    assert_eq!(
        Settings::get_version(store.conn(), "sync_server_url", "term-remote").unwrap(),
        None,
        "RED UNTIL THE HAZARD SET LANDS: a refused key must not reach the delta ledger as an operator edit"
    );
    assert_eq!(
        outcome.settings_change.as_ref().map(|(k, _)| k.as_str()),
        None,
        "RED UNTIL THE HAZARD SET LANDS: a key that was not applied must not be published to the UI (SYNC-10)"
    );
}

/// The rest of the named hazard set - one refusal per name, all six on the door,
/// both dispatchers.
///
/// Not one of these is a credential, a device identity, or manager-owned, which is
/// exactly why they are admitted at HEAD and why this test is RED for every name in
/// the loop: an exclusion list over an open namespace can only refuse what its
/// author thought to name. Why each is worth a line despite that:
///
/// * sync_server_url - the reader carries a bearer secret
///   (crates/kasirmu-core/src/sync_auth.rs:72 sends Authorization: Bearer <sync api key>
///   to whatever this row says), so the plant exfiltrates a credential without
///   ever naming a credential key.
/// * sync_enabled - switches the transport on or off tenant-wide. The one name in
///   the set that had to be bought: it was the example a fold-leg pin used for
///   "an ordinary key", and the example moved to ui.locale
///   (raw_tests.rs:732-760) rather than the leg being deleted. Six doors, six
///   refusals, no silent member lost.
/// * pg_sync.host / pg_sync.user / pg_sync.dbname - repoint where this install
///   reads its reference data from. The password stays deny-listed; the destination
///   does not, and the destination is the half an attacker needs.
/// * redis.cache_ttl - an availability knob, included because severity is not the
///   criterion. The criterion is "a peer named it and nobody meant that".
///
/// None of the six is ever a queue producer on the paths that matter, so refusing
/// them at the ingest door drops no working traffic: sync_server_url's four writers
/// are crates/kasirmu-bridge/src/sync.rs:71, apps/tablet-client/src/commands/sync.rs:87,
/// apps/desktop-client/src/sync_bootstrap.rs:83 and platform/sync/src/daemon_tick.rs:83,
/// none of which calls Store::enqueue_settings_update_superseding
/// (crates/kasirmu-core/src/db/offline.rs:194). That is what makes this set safe to
/// refuse while the wider allow-list is not.
#[test]
fn remote_settings_update_refuses_the_named_hazard_set() {
    let store = setup_store();
    let queue = SyncQueue::new();
    // Six names, six legs. The count is the point: a set that quietly loses a
    // member is how the twelve stayed a twelve, so the list length is asserted
    // below rather than trusted.
    let hazard = [
        ("hz-url", "sync_server_url"),
        ("hz-enabled", "sync_enabled"),
        ("hz-pg-host", "pg_sync.host"),
        ("hz-pg-user", "pg_sync.user"),
        ("hz-pg-dbname", "pg_sync.dbname"),
        ("hz-redis-ttl", "redis.cache_ttl"),
    ];
    // Every name is measured before anything is asserted, so ONE red run lists every
    // hazard name the gate still lets through. A per-name assert stops at the first,
    // which is a poor instrument for a fix that has to cover all six.
    let mut open: Vec<String> = Vec::new();
    for (id, key) in hazard {
        let admitted = IngestPolicy::RemoteSync.admits(key);
        let outcome = queue
            .apply_remote_atomic_full(&store, &remote_settings_kv(id, key, "PLANTED"))
            .unwrap();
        let row = Settings::get(store.conn(), key).unwrap();
        let delta = Settings::get_version(store.conn(), key, "term-remote").unwrap();
        let published = outcome
            .settings_change
            .as_ref()
            .map(|(k, _)| k.as_str().to_string());
        if admitted || row.is_some() || delta.is_some() || published.is_some() {
            open.push(format!(
                "{key} (admits={admitted}, row={row:?}, delta={delta:?}, published_to_ui={published:?})"
            ));
        }
    }
    // The legacy arm carries its own copy of the settings logic, so the refusal has
    // to hold there too - same fixture as
    // legacy_apply_remote_leaves_a_refused_key_absent_from_the_database.
    for (id, key) in [
        ("hz-legacy-url", "sync_server_url"),
        ("hz-legacy-ttl", "redis.cache_ttl"),
    ] {
        queue
            .apply_remote(&store, &remote_settings_kv(id, key, "PLANTED"))
            .unwrap();
        if Settings::get(store.conn(), key).unwrap().is_some() {
            open.push(format!("{key} (written by the LEGACY dispatcher)"));
        }
    }
    // The count is pinned as well as the behaviour: a hazard list that quietly
    // loses a member keeps every other leg green, and the change still reads as
    // the one that was briefed. Six names, six legs on the atomic door.
    assert_eq!(hazard.len(), 6, "the named hazard set is six doors");
    assert!(
        open.is_empty(),
        "RED UNTIL THE HAZARD SET LANDS: {} refusal checks are still open across the six hazard names (six on the atomic door, two on the legacy door): {:?}",
        open.len(),
        open
    );
}

/// The half that must NEVER regress: the names ordinary operation actually puts on
/// the wire have to keep applying from a peer - row, delta row, and the
/// SettingsUpdated report. Green at HEAD, green after the refusal lands; red here
/// means replication broke, not that a door opened. Every name below is one of the
/// twelve a screen writes today, with its call site pinned by
/// ingestible_keys_cover_the_ui_egress_call_sites.
#[test]
fn remote_settings_still_applies_the_names_normal_operation_replicates() {
    let store = setup_store();
    let queue = SyncQueue::new();
    let twelve = [
        ("leg-locale", "ui.locale", "id"),
        ("leg-survey", "exit_survey.last_response", "fine"),
        ("leg-prev-ver", "updater.previous_version", "0.0.36"),
        (
            "leg-backup-path",
            "updater.last_backup_path",
            "/var/lib/oz/back.kasirpkg",
        ),
        ("leg-low-stock", "inventory.low_stock_threshold", "5"),
        (
            "leg-pref-wh",
            "inventory.deduction_prefer_warehouse",
            "true",
        ),
        ("leg-sound", "kds.sound_enabled", "true"),
        ("leg-yellow", "kds.yellow_threshold_min", "10"),
        ("leg-red", "kds.red_threshold_min", "20"),
        ("leg-auto-ack", "kds.auto_acknowledge", "false"),
        ("leg-density", "kds.density", "3"),
        ("leg-course", "restaurant.course_firing", "true"),
    ];
    for (n, (id, key, value)) in twelve.into_iter().enumerate() {
        assert!(
            IngestPolicy::RemoteSync.admits(key),
            "{key} is a name the UI replicates and the ingest gate now refuses it"
        );
        let outcome = queue
            .apply_remote_atomic_full(&store, &remote_settings_kv(id, key, value))
            .unwrap();
        assert_eq!(
            Settings::get(store.conn(), key).unwrap().as_deref(),
            Some(value),
            "{key} must still apply from a remote item"
        );
        assert_eq!(
            Settings::get_version(store.conn(), key, "term-remote").unwrap(),
            Some(1),
            "{key} must still write its delta row"
        );
        assert_eq!(
            outcome.settings_change.as_ref().map(|(k, _)| k.as_str()),
            Some(key),
            "{key} must still be reported as a settings change"
        );
        let _ = n;
    }
}

/// The two refusal legs that already work, restated INSIDE this change so the
/// hazard-set extension is proved to add a refusal without subtracting one. A
/// deny-listed credential, a device-bound identity and a manager-owned prefix name
/// are refused by the same accessor on the same door as the hazard set - if the
/// new arm ever replaces the shared rule instead of standing under it, this goes
/// red first. Green at HEAD and expected green after.
#[test]
fn remote_settings_refusal_legs_stay_closed_beside_the_hazard_set() {
    let store = setup_store();
    let queue = SyncQueue::new();
    for (id, key) in [
        ("leg-token", "sync.auth_token"),
        ("leg-pg-pass", "pg_sync.password"),
        ("leg-redis-url", "redis.url"),
        ("leg-mid", "machine_id"),
        ("leg-sti", "sync_terminal_id"),
        ("leg-lae", "local_api.enabled"),
        ("leg-lsb", "lan_server.bind"),
    ] {
        assert!(
            !IngestPolicy::RemoteSync.admits(key),
            "{key} stopped being refused - the hazard set must not displace the existing rule"
        );
        let outcome = queue
            .apply_remote_atomic_full(&store, &remote_settings_kv(id, key, "PLANTED"))
            .unwrap();
        assert_eq!(
            Settings::get(store.conn(), key).unwrap(),
            None,
            "{key} must not be created by a remote item"
        );
        assert_eq!(
            outcome.settings_change.as_ref().map(|(k, _)| k.as_str()),
            None,
            "{key} must not be published as a settings change"
        );
    }
}

/// DRIFT SURFACE, stated rather than allowed to look authoritative. The list below
/// is derived from UI call sites that NOTHING reconciles against the ingest gate -
/// the same class of defect the two hand-copied shell deny lists were, all night.
/// It cannot be expressed as a code assertion (the callers are TypeScript, the gate
/// is Rust, and no build step reads one to generate the other), so it is a
/// documented enumeration naming each key and the line that writes it, and it
/// asserts the one property that must survive any shape of refusal: every name the
/// UI puts on the wire is admitted at the ingest door. The day a refusal list
/// covers one of these, this goes red instead of replication breaking quietly.
///
/// And the honesty clause, because the count matters more than the code: this is a
/// census of what someone thought to TRACE, not of what a caller can SEND. Both
/// shells' setters take an arbitrary key string from the renderer
/// (crates/kasirmu-bridge/src/settings.rs run_set_setting / set_setting_scoped /
/// set_settings_scoped, apps/tablet-client/src/commands/settings.rs) and hand it to
/// the one enqueue funnel, so the reachable egress surface is every setting the UI
/// can write - see .agents/egress-surface.md for the enumeration and the size. A
/// full allow-list must be built against THAT number, not against the twelve.
#[test]
fn ingestible_keys_cover_the_ui_egress_call_sites() {
    let traced: &[(&str, &str)] = &[
        (
            "ui.locale",
            "ui/src/features/settings/sections/GeneralSection.tsx:50",
        ),
        (
            "exit_survey.last_response",
            "ui/src/components/ExitSurveyModal.tsx:54",
        ),
        (
            "updater.previous_version",
            "ui/src/frontend/shell/UpdateBanner.tsx:13",
        ),
        (
            "updater.last_backup_path",
            "ui/src/frontend/shell/UpdateBanner.tsx:16",
        ),
        (
            "inventory.low_stock_threshold",
            "ui/src/features/settings/workspace-cards/WorkspaceInventorySettings.tsx:98",
        ),
        (
            "inventory.deduction_prefer_warehouse",
            "ui/src/features/settings/workspace-cards/WorkspaceInventorySettings.tsx:99",
        ),
        (
            "kds.sound_enabled",
            "ui/src/features/settings/workspace-cards/WorkspaceKdsSettings.tsx:137",
        ),
        (
            "kds.yellow_threshold_min",
            "ui/src/features/settings/workspace-cards/WorkspaceKdsSettings.tsx:138",
        ),
        (
            "kds.red_threshold_min",
            "ui/src/features/settings/workspace-cards/WorkspaceKdsSettings.tsx:139",
        ),
        (
            "kds.auto_acknowledge",
            "ui/src/features/settings/workspace-cards/WorkspaceKdsSettings.tsx (kds block)",
        ),
        (
            "kds.density",
            "ui/src/features/settings/workspace-cards/WorkspaceKdsSettings.tsx (kds block)",
        ),
        (
            "restaurant.course_firing",
            "ui/src/features/settings/workspace-cards/WorkspaceRestaurantPosSettings.tsx:114",
        ),
    ];
    assert_eq!(traced.len(), 12, "the traced egress census is twelve names");
    for (key, site) in traced {
        assert!(
            IngestPolicy::RemoteSync.admits(key),
            "{key} ({site}) is a name the UI puts on the wire today; refusing it at ingest silently stops it replicating"
        );
    }
}

/// The asymmetry this change deliberately creates, asserted in the direction that
/// is easy to break by accident: a name refused FROM THE NETWORK must still travel
/// IN A PACKAGE.
///
/// A restore legitimately contains whatever the app owns, so narrowing
/// PortablePackage would break restores - which is why the six hazard names are
/// refused by the RemoteSync arm alone, and why they are declared as a THIRD list
/// (keys::PEER_NAMED_HAZARD_KEYS) rather than folded into
/// is_non_exportable_setting_key, which both arms share. Fold them in and this
/// test is the thing that goes red, which is the point: the two lanes look
/// tidier side by side and a backup stops restoring a sync target.
///
/// Also the drift canary for the shared-predicate problem the interim fix has to
/// live with: admits() answers BOTH the ingest door and the two egress doors, so
/// refusing a name here stops it being OFFERED as well as APPLIED. That is the
/// symmetric behaviour the two egress call sites were written to demand, and none
/// of these six names is produced by a UI setter today (see
/// .agents/egress-surface.md), so it costs no working traffic - but it is a real
/// narrowing of the egress surface, and this is where it is recorded.
#[test]
fn a_hazard_name_refused_from_the_network_still_travels_in_a_package() {
    for key in [
        "sync_server_url",
        "sync_enabled",
        "pg_sync.host",
        "pg_sync.user",
        "pg_sync.dbname",
        "redis.cache_ttl",
    ] {
        assert!(
            !IngestPolicy::RemoteSync.admits(key),
            "{key} must be refused by remote sync"
        );
        // This ONE assertion is also the shape check: PortablePackage refuses
        // exactly the shared credential list, the device list and the two manager
        // prefixes, and nothing else. So an admits here proves the name is on none
        // of them - the hazard refusal belongs to one lane only - without this
        // crate reaching across a dependency edge it does not have (platform-sync
        // deliberately has no platform-core edge; queue.rs imports the policy
        // through the kasirmu_core::settings facade, and reaching for
        // platform_core::settings::keys here would build one).
        //
        // The same boolean therefore carries two facts, and the pair is what a
        // future fold of these names into is_non_exportable_setting_key breaks:
        // the moment the hazard list joins the shared list, PortablePackage stops
        // admitting and this test goes red on the line above.
        assert!(
            IngestPolicy::PortablePackage.admits(key),
            "{key} must STILL travel in a portable package: a refusal here means it was folded into the shared exclusion rule, and restores break"
        );
    }
}
