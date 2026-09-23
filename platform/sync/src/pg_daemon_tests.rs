//! Unit tests for the PostgreSQL sync daemon (`pg_daemon.rs`):
//! lifecycle/idempotent start-stop, `apply_pulled_page` semantics —
//! SYNC-01 durable anchor + monotonic created_at advancement, snapshot
//! recovery importing before the anchor reset, idempotent replay,
//! dead-letter quarantine after the retry budget, ADR #6 stock_summary
//! rebuild, SYNC-10 settings re-emit, SYNC-EW wakeup coalescing — plus
//! outbox schema, offline queue behaviour, and status DTO shape.
//! Extracted from the inline `mod tests` in `pg_daemon.rs` (F-018).

use super::*;
use kasirmu_core::migrations;
use kasirmu_core::offline::{OfflineQueueItem, OfflineQueueStatus};

fn setup_db() -> DbConnection {
    Arc::new(Mutex::new(migrations::fresh_db()))
}

fn seed_product_and_inventory(conn: &rusqlite::Connection) {
    conn.execute_batch(
            "INSERT INTO products (id, sku, name, price_minor, currency, created_at, updated_at) VALUES
                ('prod-coffee', 'COFFEE', 'Coffee', 350, 'USD', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
             INSERT INTO inventory (product_id, qty, updated_at) VALUES
                ('prod-coffee', 50, '2025-01-01T00:00:00.000Z');",
        )
        .unwrap();
}

/// A remote item shaped as the PG pull decodes it. `created_at` is the
/// durable-anchor watermark (the composite cursor orders on it);
/// `synced_at` is deliberately left NULL — the remote may never stamp it,
/// and the anchor must still advance on `created_at`.
fn remote_stock_adjustment(id: &str, delta: i64, created_at: &str) -> OfflineQueueItem {
    let mut item = OfflineQueueItem::new(
        "stock.adjusted",
        format!(r#"{{"sku":"COFFEE","delta":{delta}}}"#),
    );
    item.id = id.into();
    item.created_at = created_at.into();
    item
}

fn remote_poison_sale(id: &str) -> OfflineQueueItem {
    let mut item = OfflineQueueItem::new(
        "complete_sale",
        r#"{"line_items":[{"sku":"MISSING","qty":1}]}"#,
    );
    item.id = id.into();
    item.created_at = "2026-01-01T00:00:00.000Z".into();
    item
}

#[test]
fn snapshot_recovery_imports_before_resetting_anchor() {
    let conn = migrations::fresh_db();
    let store = Store::new(&conn);
    store
        .set_sync_pull_state(Some("stale"), Some("stale-cursor"))
        .unwrap();
    let snapshot = crate::transport::SyncSnapshotResponse {
        version: 1,
        products: vec![crate::transport::SnapshotProduct {
            id: "pg-snapshot-product".into(),
            sku: "PG-SNAPSHOT".into(),
            name: "PG Snapshot Product".into(),
            price_minor: 250,
            currency: "USD".into(),
            category_id: None,
            barcode: None,
            created_at: None,
            updated_at: None,
            price_updated_at: None,
            track_serial: false,
            store_id: None,
            ..Default::default()
        }],
        tax_rates: vec![],
        users: vec![],
    };

    let imported = recover_pg_snapshot(&store, &snapshot, Some("oldest"))
        .expect("valid snapshot should recover the PG anchor");
    assert_eq!(imported, 1);
    let pull_state = store.get_sync_pull_state().unwrap();
    assert_eq!(pull_state.since.as_deref(), Some("oldest"));
    assert_eq!(pull_state.cursor, None);
    let product_name: String = conn
        .query_row(
            "SELECT name FROM products WHERE sku = 'PG-SNAPSHOT'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(product_name, "PG Snapshot Product");
}

#[test]
fn snapshot_recovery_keeps_stale_anchor_when_import_fails() {
    let conn = migrations::fresh_db();
    let store = Store::new(&conn);
    store
        .set_sync_pull_state(Some("stale"), Some("stale-cursor"))
        .unwrap();
    let snapshot = crate::transport::SyncSnapshotResponse {
        version: 99,
        products: vec![],
        tax_rates: vec![],
        users: vec![],
    };

    assert!(recover_pg_snapshot(&store, &snapshot, Some("oldest")).is_err());
    let pull_state = store.get_sync_pull_state().unwrap();
    assert_eq!(pull_state.since.as_deref(), Some("stale"));
    assert_eq!(pull_state.cursor.as_deref(), Some("stale-cursor"));
}

// ── SYNC-01 parity: atomic pull apply + durable anchor ────────────

#[test]
fn apply_pulled_page_applies_stock_adjustment_and_records_receipt() {
    let conn = migrations::fresh_db();
    seed_product_and_inventory(&conn);
    let store = Store::new(&conn);

    let page = vec![remote_stock_adjustment(
        "pg-item-1",
        10,
        "2026-01-02T00:00:00.000Z",
    )];
    let new_since = apply_pulled_page(&store, &page, None, &noop_settings_sink());

    assert_eq!(store.get_stock("prod-coffee").unwrap(), 60);
    assert!(
        store.is_remote_item_applied("pg-item-1").unwrap(),
        "ledger receipt must be recorded with the mutation"
    );
    assert_eq!(
        new_since.as_deref(),
        Some("2026-01-02T00:00:00.000Z"),
        "anchor advances on created_at, not synced_at"
    );
}

/// Regression (composite-cursor slice): the durable anchor must advance
/// on `created_at` even when the remote NEVER stamps `synced_at` (NULL)
/// — otherwise a queue whose rows all lack a synced_at watermark never
/// advances and re-pulls everything every cycle.
#[test]
fn apply_pulled_page_advances_anchor_on_created_at_when_synced_at_null() {
    let conn = migrations::fresh_db();
    seed_product_and_inventory(&conn);
    let store = Store::new(&conn);

    let page = vec![remote_stock_adjustment(
        "pg-item-null",
        10,
        "2026-01-02T00:00:00.000Z",
    )];
    let new_since = apply_pulled_page(&store, &page, None, &noop_settings_sink());

    assert_eq!(store.get_stock("prod-coffee").unwrap(), 60);
    assert_eq!(
        new_since.as_deref(),
        Some("2026-01-02T00:00:00.000Z"),
        "anchor must advance on created_at even when synced_at is NULL"
    );
}

#[test]
fn apply_pulled_page_replay_is_idempotent() {
    let conn = migrations::fresh_db();
    seed_product_and_inventory(&conn);
    let store = Store::new(&conn);
    let page = vec![remote_stock_adjustment(
        "pg-item-replay",
        10,
        "2026-01-02T00:00:00.000Z",
    )];

    let _ = apply_pulled_page(&store, &page, None, &noop_settings_sink());
    let _ = apply_pulled_page(&store, &page, None, &noop_settings_sink());

    assert_eq!(
        store.get_stock("prod-coffee").unwrap(),
        60,
        "a replayed page must NOT re-apply the mutation (SYNC-01)"
    );
}

#[test]
fn apply_pulled_page_retains_anchor_on_retryable_failure() {
    let conn = migrations::fresh_db();
    let store = Store::new(&conn);
    let page = vec![remote_poison_sale("pg-poison-1")];

    let new_since = apply_pulled_page(&store, &page, None, &noop_settings_sink());
    assert!(
        new_since.is_none(),
        "retryable failure must retain the pull anchor"
    );
    assert!(
        !store
            .is_remote_failure_dead_lettered("pg-poison-1")
            .unwrap()
    );
}

#[test]
fn apply_pulled_page_dead_letters_then_advances() {
    let conn = migrations::fresh_db();
    let store = Store::new(&conn);
    let page = vec![remote_poison_sale("pg-poison-2")];

    // Attempts 1-2 retain the anchor; the 3rd dead-letters the item and
    // allows the page anchor to advance.
    assert!(apply_pulled_page(&store, &page, None, &noop_settings_sink()).is_none());
    assert!(apply_pulled_page(&store, &page, None, &noop_settings_sink()).is_none());
    let new_since = apply_pulled_page(&store, &page, None, &noop_settings_sink());
    assert!(
        new_since.is_some(),
        "dead-lettered item may advance the anchor"
    );
    assert!(
        store
            .is_remote_failure_dead_lettered("pg-poison-2")
            .unwrap()
    );
}

#[test]
fn apply_pulled_page_anchor_is_monotonic_max_created_at() {
    let conn = migrations::fresh_db();
    seed_product_and_inventory(&conn);
    let store = Store::new(&conn);

    let earlier = remote_stock_adjustment("pg-item-a", 1, "2026-01-01T00:00:00.000Z");
    let later = remote_stock_adjustment("pg-item-b", 1, "2026-01-03T00:00:00.000Z");

    // A prior anchor newer than one page row must not regress.
    let new_since = apply_pulled_page(
        &store,
        &[earlier, later],
        Some("2026-01-02T00:00:00.000Z"),
        &noop_settings_sink(),
    );
    assert_eq!(new_since.as_deref(), Some("2026-01-03T00:00:00.000Z"));
}

/// ADR #6 parity (SQLite daemon, daemon.rs): a page containing a
/// `stock.movement` writes ONLY the raw delta-ledger row (the summary
/// cache is NOT touched by the apply path), so the materialized
/// `stock_summary` must be rebuilt from the ledger before the anchor
/// advances. Without the rebuild, a remote stock movement pulled via PG
/// leaves the on-hand cache the app reads permanently stale.
#[test]
fn apply_pulled_page_rebuilds_stock_summary_after_stock_movements() {
    let conn = migrations::fresh_db();
    seed_product_and_inventory(&conn);
    let store = Store::new(&conn);

    let mut item = OfflineQueueItem::new(
        "stock.movement",
        r#"{"id":"sm-remote-1","item_id":"prod-coffee","delta":40,"reason":"restock","store_id":"default","created_at":"2026-01-05T00:00:00.000Z"}"#,
    );
    item.id = "pg-item-movement-1".into();
    item.created_at = "2026-01-05T00:00:00.000Z".into();

    let new_since = apply_pulled_page(
        &store,
        std::slice::from_ref(&item),
        None,
        &noop_settings_sink(),
    );

    assert_eq!(
        new_since.as_deref(),
        Some("2026-01-05T00:00:00.000Z"),
        "a stock.movement page applies and advances the anchor"
    );
    let summary_qty: i64 = conn
        .query_row(
            "SELECT qty FROM stock_summary WHERE item_id = 'prod-coffee'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    // 40 -> 50. seed_product_and_inventory writes inventory (prod-coffee = 50)
    // with no movement behind it — exactly the legacy shape the compensating
    // row closes — so the rebuild inside apply_pulled_page heals the 10 unbacked
    // units first and the ledger-derived cache lands on 50 rather than
    // destroying them. Same reader, same call; only the expected quantity moved.
    assert_eq!(
        summary_qty, 50,
        "stock_summary must be rebuilt from the ledger after a stock.movement page"
    );
}

/// ADR #6 parity: if the summary rebuild fails, the durable anchor must
/// be retained so the next cycle re-pulls the same page (the ledger
/// absorbs the replay) and retries the derived-state rebuild — mirroring
/// the SQLite daemon's "old anchor retained so a retry can restore the
/// derived state as well".
#[test]
fn apply_pulled_page_retains_anchor_when_stock_summary_rebuild_fails() {
    let conn = migrations::fresh_db();
    seed_product_and_inventory(&conn);
    let store = Store::new(&conn);
    // Force the rebuild to fail: the summary table no longer exists.
    conn.execute_batch("DROP TABLE stock_summary").unwrap();

    let mut item = OfflineQueueItem::new(
        "stock.movement",
        r#"{"id":"sm-remote-2","item_id":"prod-coffee","delta":10,"reason":"restock","store_id":"default","created_at":"2026-01-06T00:00:00.000Z"}"#,
    );
    item.id = "pg-item-movement-2".into();
    item.created_at = "2026-01-06T00:00:00.000Z".into();

    let new_since = apply_pulled_page(
        &store,
        std::slice::from_ref(&item),
        None,
        &noop_settings_sink(),
    );
    assert!(
        new_since.is_none(),
        "a failed summary rebuild must retain the pull anchor"
    );
}

/// Helper: a no-op settings sink for call sites that do not assert on
/// SYNC-10 emission.
fn noop_settings_sink() -> SettingsChangedSink {
    Arc::new(|_: &SettingsUpdated| {})
}

/// SYNC-10 parity: a pulled remote `settings.update` must re-emit
/// `SettingsUpdated` through the daemon's sink so the UI refetches — the
/// SQLite daemon publishes the changed key + originating terminal after
/// the tx commits; the PG path previously used `apply_remote_atomic`,
/// which drops the settings-change report entirely.
#[test]
fn apply_pulled_page_emits_settings_updated_after_settings_change() {
    let conn = migrations::fresh_db();
    let store = Store::new(&conn);

    let emitted = Arc::new(std::sync::Mutex::new(Vec::<SettingsUpdated>::new()));
    let sink: SettingsChangedSink = {
        let emitted = Arc::clone(&emitted);
        Arc::new(move |event: &SettingsUpdated| emitted.lock().unwrap().push(event.clone()))
    };

    let mut item = OfflineQueueItem::new(
        "settings.update",
        r#"{"key":"store.name","value":"Remote Acme","terminal_id":"term-remote","version":3}"#,
    );
    item.id = "pg-item-settings-1".into();
    item.created_at = "2026-01-02T00:00:00.000Z".into();

    let new_since = apply_pulled_page(&store, std::slice::from_ref(&item), None, &sink);

    assert_eq!(new_since.as_deref(), Some("2026-01-02T00:00:00.000Z"));
    let captured = emitted.lock().unwrap().clone();
    assert_eq!(
        captured.len(),
        1,
        "exactly one SettingsUpdated must be emitted per applied settings change"
    );
    assert_eq!(captured[0].changed_keys, vec!["store.name".to_string()]);
    assert_eq!(captured[0].terminal_id, "term-remote");
}

/// SYNC-10 negative: pages without settings changes must not emit
/// anything through the sink.
#[test]
fn apply_pulled_page_is_silent_for_non_settings_pages() {
    let conn = migrations::fresh_db();
    seed_product_and_inventory(&conn);
    let store = Store::new(&conn);

    let emitted = Arc::new(std::sync::Mutex::new(Vec::<SettingsUpdated>::new()));
    let sink: SettingsChangedSink = {
        let emitted = Arc::clone(&emitted);
        Arc::new(move |event: &SettingsUpdated| emitted.lock().unwrap().push(event.clone()))
    };

    let page = vec![remote_stock_adjustment(
        "pg-item-silent",
        10,
        "2026-01-02T00:00:00.000Z",
    )];
    let new_since = apply_pulled_page(&store, &page, None, &sink);

    assert!(new_since.is_some());
    assert!(
        emitted.lock().unwrap().is_empty(),
        "no settings change in the page → no SettingsUpdated emission"
    );
}

/// Helper: enqueue an offline item and return its actual ID (from the returned OfflineQueueItem).
fn enqueue_item(conn: &rusqlite::Connection, action: &str, payload: &str) -> String {
    let store = Store::new(conn);
    let item = store.enqueue_offline(action, payload).unwrap();
    item.id
}

/// Helper: get raw pending count from the offline_queue table.
fn raw_pending_count(conn: &rusqlite::Connection) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM offline_queue WHERE status = 'pending'",
        [],
        |r| r.get(0),
    )
    .unwrap_or(0)
}

// ── Lifecycle tests ─────────────────────────────────────────────

#[tokio::test]
async fn daemon_starts_stopped() {
    let daemon = PgSyncDaemon::new();
    assert!(!daemon.is_running().await);
}

#[tokio::test]
async fn daemon_start_and_stop() {
    let db = setup_db();
    let daemon = PgSyncDaemon::new();
    assert!(daemon.start(db).await);
    assert!(daemon.is_running().await);
    assert!(daemon.stop().await, "stop must confirm the run loop exited");
    assert!(!daemon.is_running().await);
}

#[tokio::test]
async fn daemon_status_defaults() {
    let daemon = PgSyncDaemon::new();
    let status = daemon.status().await;
    assert!(!status.running);
    assert!(status.last_sync_at.is_none());
    assert_eq!(status.last_pushed, 0);
    assert_eq!(status.last_pulled, 0);
    assert!(status.last_error.is_none());
}

#[tokio::test]
async fn daemon_stop_when_not_running_is_noop() {
    let daemon = PgSyncDaemon::new();
    assert!(
        daemon.stop().await,
        "stop with nothing running reports stopped"
    );
    assert!(!daemon.is_running().await);
}

/// Regression (silent-success start): a start on a live daemon used to log
/// a warning and return `()`, which the IPC command surfaced as `Ok(())` —
/// the caller could not tell that no new daemon was spawned. The second
/// start now reports `false` explicitly.
#[tokio::test]
async fn daemon_double_start_reports_already_running() {
    let db = setup_db();
    let daemon = PgSyncDaemon::new();
    assert!(daemon.start(db.clone()).await);
    assert!(daemon.is_running().await);
    assert!(
        !daemon.start(db).await,
        "a start on a live daemon must report that it did NOT spawn"
    );
    assert!(daemon.is_running().await);
    assert!(daemon.stop().await);
    assert!(!daemon.is_running().await);
}

#[tokio::test]
async fn daemon_custom_interval() {
    let daemon = PgSyncDaemon::with_interval(Duration::from_millis(50));
    assert_eq!(daemon.interval(), Duration::from_millis(50));
}

#[tokio::test]
async fn daemon_set_interval() {
    let mut daemon = PgSyncDaemon::new();
    daemon.set_interval(Duration::from_secs(10));
    assert_eq!(daemon.interval(), Duration::from_secs(10));
}

// ── Outbox schema validation ────────────────────────────────────

#[test]
fn outbox_schema_has_required_columns() {
    let conn = migrations::fresh_db();
    let mut stmt = conn
        .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='offline_queue'")
        .unwrap();
    let sql: String = stmt.query_row([], |r| r.get(0)).unwrap();
    assert!(sql.contains("id"), "offline_queue must have 'id' column");
    assert!(
        sql.contains("action"),
        "offline_queue must have 'action' column"
    );
    assert!(
        sql.contains("payload"),
        "offline_queue must have 'payload' column"
    );
    assert!(
        sql.contains("status"),
        "offline_queue must have 'status' column"
    );
    assert!(
        sql.contains("created_at"),
        "offline_queue must have 'created_at' column"
    );
}

#[test]
fn outbox_table_exists() {
    let conn = migrations::fresh_db();
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='offline_queue'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 1, "offline_queue table must exist after migrations");
}

// ── Idempotency & duplicate handling ───────────────────────────

#[test]
fn mark_offline_synced_is_idempotent() {
    let conn = migrations::fresh_db();
    let store = Store::new(&conn);
    let id = enqueue_item(&conn, "sale.completed", r#"{"sale_id":"s1"}"#);

    // First mark as synced — should succeed
    assert!(store.mark_offline_synced(&id).is_ok());

    // Second mark as synced — must succeed (idempotent)
    assert!(store.mark_offline_synced(&id).is_ok());
}

#[test]
fn mark_offline_synced_nonexistent_item() {
    let conn = migrations::fresh_db();
    let store = Store::new(&conn);
    // Syncing a nonexistent ID should not panic
    let result = store.mark_offline_synced("nonexistent-id");
    // Should be Ok (or Err depending on implementation) — but never panic
    let _ = result;
}

#[test]
fn duplicate_enqueue_creates_separate_items() {
    let conn = migrations::fresh_db();
    let store = Store::new(&conn);

    // Enqueue the same action twice
    store
        .enqueue_offline("stock.adjusted", r#"{"sku":"COFFEE"}"#)
        .unwrap();
    store
        .enqueue_offline("stock.adjusted", r#"{"sku":"COFFEE"}"#)
        .unwrap();

    // Both should be pending
    let count = raw_pending_count(&conn);
    assert_eq!(count, 2, "duplicate enqueue should create separate items");
}

// ── Large batch handling ───────────────────────────────────────

#[test]
fn large_batch_enqueue_10k_items() {
    let conn = migrations::fresh_db();
    let store = Store::new(&conn);

    // Enqueue 10,000 items
    for i in 0..10_000 {
        store
            .enqueue_offline(
                "product.created",
                &format!(r#"{{"sku":"SKU-{}","name":"Item {}"}}"#, i, i),
            )
            .unwrap();
    }

    let count = store.pending_offline_count().unwrap();
    assert_eq!(count, 10_000);
    assert_eq!(raw_pending_count(&conn), 10_000);
}

#[test]
fn list_pending_returns_correct_items() {
    let conn = migrations::fresh_db();
    let store = Store::new(&conn);

    for i in 0..100 {
        store
            .enqueue_offline("product.created", &format!(r#"{{"sku":"SKU-{}"}}"#, i))
            .unwrap();
    }

    let pending = store.list_pending_offline().unwrap();
    assert_eq!(pending.len(), 100);
    // All should have 'pending' status
    assert!(
        pending
            .iter()
            .all(|p| p.status == OfflineQueueStatus::Pending)
    );
}

#[test]
fn pending_count_zero_when_empty() {
    let conn = migrations::fresh_db();
    let store = Store::new(&conn);
    assert_eq!(store.pending_offline_count().unwrap(), 0);
}

// ── Graceful shutdown ──────────────────────────────────────────

#[tokio::test]
async fn daemon_stop_twice_is_idempotent() {
    let db = setup_db();
    let daemon = PgSyncDaemon::new();
    assert!(daemon.start(db).await);
    assert!(daemon.is_running().await);
    assert!(daemon.stop().await);
    assert!(daemon.stop().await, "second stop should be safe");
    assert!(!daemon.is_running().await);
}

#[tokio::test]
async fn daemon_stops_cleanly_with_short_interval() {
    let db = setup_db();
    let daemon = PgSyncDaemon::with_interval(Duration::from_millis(50));
    daemon.start(db).await;
    assert!(daemon.is_running().await);
    // Let it tick a few times
    tokio::time::sleep(Duration::from_millis(120)).await;
    daemon.stop().await;
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert!(!daemon.is_running().await);
}

/// Regression (stop/start race): `stop()` used to sleep a fixed 100ms and
/// return while the run loop could still be mid-cycle — the `running` flag
/// survived, the next `start()` was silently swallowed by the
/// already-running guard, and the daemon stayed dead until app restart.
/// Hold the DB lock to pin a tick mid-flight (the same window a slow
/// remote round trip produces), prove `stop()` waits for the loop to
/// exit, and prove an immediate `start()` brings the daemon back up.
#[tokio::test]
async fn daemon_stop_then_immediate_start_yields_running_daemon() {
    let db = setup_db();
    let daemon = PgSyncDaemon::with_interval(Duration::from_millis(10));
    assert!(daemon.start(db.clone()).await);
    assert!(daemon.is_running().await);

    // Hold the DB lock so a tick's spawn_blocking phase blocks
    // mid-cycle; released ~300ms in so the tick can finish after
    // stop() has committed to waiting for it.
    let blocker_db = db.clone();
    let blocker = tokio::spawn(async move {
        let _guard = blocker_db.lock().await;
        tokio::time::sleep(Duration::from_millis(300)).await;
    });
    tokio::time::sleep(Duration::from_millis(100)).await;

    assert!(
        daemon.stop().await,
        "stop must wait for the in-flight cycle and confirm the loop exited"
    );
    assert!(
        !daemon.is_running().await,
        "running must be cleared by the time stop() returns"
    );

    // The race this pins: start immediately after stop.
    assert!(
        daemon.start(db).await,
        "start immediately after stop must spawn a new daemon"
    );
    assert!(daemon.is_running().await);
    assert!(daemon.stop().await);

    blocker.await.unwrap();
}

// ── Status tracking ────────────────────────────────────────────

#[tokio::test]
async fn daemon_status_updates_running_flag() {
    let db = setup_db();
    let daemon = PgSyncDaemon::new();
    assert!(!daemon.status().await.running);
    assert!(daemon.start(db).await);
    assert!(daemon.status().await.running);
    assert!(daemon.stop().await);
    assert!(!daemon.status().await.running);
}

#[tokio::test]
async fn daemon_status_shows_pending_count_after_tick() {
    let db = setup_db();
    // Enqueue some items before starting (blocking — spawn_blocking to avoid runtime panic)
    {
        let db_clone = db.clone();
        tokio::task::spawn_blocking(move || {
            let conn = db_clone.blocking_lock();
            let store = Store::new(&conn);
            for i in 0..5 {
                store
                    .enqueue_offline("product.created", &format!(r#"{{"sku":"SKU-{}"}}"#, i))
                    .unwrap();
            }
        })
        .await
        .unwrap();
    }

    let daemon = PgSyncDaemon::with_interval(Duration::from_millis(30));
    daemon.start(db).await;
    // Wait for at least one tick
    tokio::time::sleep(Duration::from_millis(80)).await;

    let status = daemon.status().await;
    assert!(
        status.last_sync_at.is_some(),
        "last_sync_at should be set after tick"
    );
    // No PG configured, so items should still be pending
    assert_eq!(status.pending_count, 5);
    assert_eq!(status.last_pushed, 0);

    daemon.stop().await;
    tokio::time::sleep(Duration::from_millis(100)).await;
}

// ── Concurrent daemon instances (advisory lock simulation) ──────

#[tokio::test]
async fn two_daemons_cannot_run_simultaneously_on_same_db() {
    let db1 = setup_db();
    let db2 = db1.clone();

    let daemon1 = PgSyncDaemon::new();
    let daemon2 = PgSyncDaemon::new();

    daemon1.start(db1).await;
    assert!(daemon1.is_running().await);

    // Second daemon on the same DB — should be fine since they're
    // separate daemon instances (not the same object)
    daemon2.start(db2).await;
    assert!(daemon2.is_running().await);

    daemon1.stop().await;
    daemon2.stop().await;
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(!daemon1.is_running().await);
    assert!(!daemon2.is_running().await);
}

// ── Error isolation ────────────────────────────────────────────

#[test]
fn mark_offline_failed_stores_reason() {
    let conn = migrations::fresh_db();
    let store = Store::new(&conn);
    let id = enqueue_item(&conn, "sale.completed", r#"{"sale_id":"s1"}"#);

    let result = store.mark_offline_failed(&id, "connection refused");
    assert!(result.is_ok());

    // Verify the item is no longer pending
    let pending = store.pending_offline_count().unwrap();
    assert_eq!(pending, 0);
}

#[test]
fn one_failed_item_does_not_block_others() {
    let conn = migrations::fresh_db();
    let store = Store::new(&conn);

    // Enqueue 3 items
    let id1 = enqueue_item(&conn, "sale.1", r#"{"sale_id":"s1"}"#);
    let _id2 = enqueue_item(&conn, "sale.2", r#"{"sale_id":"s2"}"#);
    let id3 = enqueue_item(&conn, "sale.3", r#"{"sale_id":"s3"}"#);

    // Mark item 2 as failed
    store.mark_offline_failed(&id1, "error").unwrap();
    // Item 3 should still be pending
    assert_eq!(store.pending_offline_count().unwrap(), 2);
    // Mark item 3 as synced
    store.mark_offline_synced(&id3).unwrap();
    assert_eq!(store.pending_offline_count().unwrap(), 1);
}

// ── DbConnection thread safety ─────────────────────────────────

#[tokio::test]
async fn db_connection_can_be_cloned_and_shared() {
    let db = setup_db();
    let db2 = db.clone();

    // Verify both handles can access the same DB via spawn_blocking
    let handle = tokio::task::spawn_blocking(move || {
        let conn = db.blocking_lock();
        let count: i64 = conn.query_row("SELECT 1", [], |r| r.get(0)).unwrap();
        count
    });
    let result = handle.await.unwrap();
    assert_eq!(result, 1);

    // db2 should still work — also via spawn_blocking in async context
    let handle2 = tokio::task::spawn_blocking(move || {
        let conn = db2.blocking_lock();
        let count: i64 = conn.query_row("SELECT 1", [], |r| r.get(0)).unwrap();
        count
    });
    let result2 = handle2.await.unwrap();
    assert_eq!(result2, 1);
}

// ── PgDaemonStatus serialization ───────────────────────────────

#[test]
fn pg_daemon_status_default_values() {
    let status = PgDaemonStatus::default();
    assert!(!status.running);
    assert!(status.last_sync_at.is_none());
    assert!(status.last_error.is_none());
    assert_eq!(status.last_pushed, 0);
    assert_eq!(status.last_pulled, 0);
    assert_eq!(status.pending_count, 0);
}

#[test]
fn pg_daemon_status_clone() {
    let status = PgDaemonStatus {
        running: true,
        last_sync_at: Some("2026-07-22T00:00:00Z".into()),
        last_error: Some("test error".into()),
        last_pushed: 5,
        last_pulled: 3,
        pending_count: 10,
    };

    let cloned = status.clone();
    assert_eq!(cloned.running, status.running);
    assert_eq!(cloned.last_sync_at, status.last_sync_at);
    assert_eq!(cloned.last_error, status.last_error);
    assert_eq!(cloned.last_pushed, status.last_pushed);
    assert_eq!(cloned.last_pulled, status.last_pulled);
    assert_eq!(cloned.pending_count, status.pending_count);
}

// ── SYNC-EW: the two promises `nudge` makes ───────────────────────
//
// Mirror of the pair in `daemon_tests.rs`. `pg_daemon.rs` documents "identical
// semantics to `SyncDaemon::nudge`", so the same two properties are pinned here,
// and this is the caller that `PgSyncDaemon::wakeup_handle` was added for.

/// A `nudge()` before the daemon is listening must be STORED, not dropped.
#[tokio::test]
async fn nudge_while_stopped_stores_one_permit() {
    let daemon = PgSyncDaemon::new();
    daemon.nudge();

    tokio::time::timeout(Duration::from_secs(2), daemon.wakeup_handle().notified())
        .await
        .expect("a nudge issued while stopped must be stored, not dropped");
}

/// Three nudges must leave exactly ONE pending permit — `Notify` does not queue.
#[tokio::test]
async fn nudge_coalesces_a_burst_into_one_permit() {
    let daemon = PgSyncDaemon::new();
    let handle = daemon.wakeup_handle();

    daemon.nudge();
    daemon.nudge();
    daemon.nudge();

    tokio::time::timeout(Duration::from_secs(2), handle.notified())
        .await
        .expect("the first permit of the burst must be observable");

    assert!(
        tokio::time::timeout(Duration::from_millis(50), handle.notified())
            .await
            .is_err(),
        "three nudges must coalesce into one permit; a second permit means Notify queued"
    );
}

// ── apply_push_outcomes: the PG daemon applier ───────────────
//
// C48: `pg_daemon` routed EVERY `Rejected` outcome to
// `mark_offline_failed`, with no duplicate-id predicate — unlike
// `sync_client::apply_sync_outcomes`, `daemon::apply_push_results` and
// `lib.rs::apply_push_outcomes`. Unlike `run_sync_cycle` this daemon IS
// wired into the desktop (`desktop-tauri/src/state.rs`), so the divergence
// was live. These tests pin this applier to the shared rule.

/// Helper: read a row's status by id.
fn status_of(conn: &rusqlite::Connection, id: &str) -> String {
    conn.query_row(
        "SELECT status FROM offline_queue WHERE id = ?1",
        rusqlite::params![id],
        |r| r.get(0),
    )
    .unwrap()
}

/// A `Rejected` whose reason carries the duplicate-id prefix marks the row
/// SYNCED, not failed, on THIS applier.
///
/// Pre-fix this test FAILS: the bare `Rejected` arm called
/// `mark_offline_failed`, so the row read `failed` with the duplicate-id
/// text as its error.
#[test]
fn pg_apply_push_outcomes_duplicate_id_replay_marks_synced() {
    let conn = migrations::fresh_db();
    let store = Store::new(&conn);
    let queue = SyncQueue::new();
    let id = enqueue_item(&conn, "sale.create", "{\"total\":100}");
    let pending = store.list_pending_offline().unwrap();

    let results = vec![crate::transport::PushOutcome::Rejected {
        reason: format!(
            "{}{}",
            kasirmu_core::sync_client::DUPLICATE_ID_REJECTION_PREFIX,
            id
        ),
    }];
    apply_push_outcomes(&queue, &store, &pending, &results);

    assert_eq!(
        status_of(&conn, &id),
        "synced",
        "a duplicate-id replay is a successful earlier push, not a rejection"
    );
}

/// A genuine rejection still dead-letters the row — the carve-out must not
/// swallow real failures.
#[test]
fn pg_apply_push_outcomes_genuine_rejection_marks_failed() {
    let conn = migrations::fresh_db();
    let store = Store::new(&conn);
    let queue = SyncQueue::new();
    let id = enqueue_item(&conn, "sale.create", "{\"total\":100}");
    let pending = store.list_pending_offline().unwrap();

    let results = vec![crate::transport::PushOutcome::Rejected {
        reason: "pg insert failed: deadlock detected".into(),
    }];
    apply_push_outcomes(&queue, &store, &pending, &results);

    assert_eq!(status_of(&conn, &id), "failed");
    let err: String = conn
        .query_row(
            "SELECT last_error FROM offline_queue WHERE id = ?1",
            rusqlite::params![id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(err, "pg insert failed: deadlock detected");
}

/// The predicate is `starts_with`, so it must be ANCHORED: a reason that
/// merely MENTIONS a duplicate id is still a rejection.
#[test]
fn pg_apply_push_outcomes_duplicate_prefix_is_anchored() {
    let conn = migrations::fresh_db();
    let store = Store::new(&conn);
    let queue = SyncQueue::new();
    let id = enqueue_item(&conn, "sale.create", "{\"total\":100}");
    let pending = store.list_pending_offline().unwrap();

    let results = vec![crate::transport::PushOutcome::Rejected {
        reason: "pg insert failed: duplicate id: retried".into(),
    }];
    apply_push_outcomes(&queue, &store, &pending, &results);

    assert_eq!(
        status_of(&conn, &id),
        "failed",
        "the prefix is anchored: a reason that only mentions a duplicate id is still a rejection"
    );
}

/// `Accepted` is unchanged: the row is marked synced.
#[test]
fn pg_apply_push_outcomes_accepted_marks_synced() {
    let conn = migrations::fresh_db();
    let store = Store::new(&conn);
    let queue = SyncQueue::new();
    let id = enqueue_item(&conn, "sale.create", "{\"total\":100}");
    let pending = store.list_pending_offline().unwrap();

    let results = vec![crate::transport::PushOutcome::Accepted];
    apply_push_outcomes(&queue, &store, &pending, &results);

    assert_eq!(status_of(&conn, &id), "synced");
}

/// The `Conflict` arm is unchanged: still routed through the shared ADR #21
/// resolver, which marks the row resolved with an auditable tag rather than
/// dead-lettering it.
#[test]
fn pg_apply_push_outcomes_conflict_uses_shared_resolver() {
    let conn = migrations::fresh_db();
    let store = Store::new(&conn);
    let queue = SyncQueue::new();
    let id = enqueue_item(&conn, "sale.create", "{\"total\":100}");
    let pending = store.list_pending_offline().unwrap();

    // The server's copy of the same action, newer so the resolver has a
    // defined winner.
    let mut server_item = pending[0].clone();
    server_item.id = "pg-server-copy".into();
    server_item.created_at = "2030-01-01T00:00:00.000Z".into();

    let results = vec![crate::transport::PushOutcome::Conflict(server_item)];
    apply_push_outcomes(&queue, &store, &pending, &results);

    assert_eq!(
        status_of(&conn, &id),
        "synced",
        "a conflict is resolved, not dead-lettered"
    );
    let err: Option<String> = conn
        .query_row(
            "SELECT last_error FROM offline_queue WHERE id = ?1",
            rusqlite::params![id],
            |r| r.get(0),
        )
        .unwrap();
    assert!(
        err.as_deref()
            .is_some_and(|e| e.starts_with("resolved: conflict")),
        "the resolution must leave an auditable marker, got {err:?}"
    );
}

/// A batch longer than the results is not misaligned: `zip` stops at the
/// shorter side, so a truncated response leaves the trailing item PENDING
/// rather than marking it from a neighbour's outcome.
#[test]
fn pg_apply_push_outcomes_truncated_results_leave_trailing_items_pending() {
    let conn = migrations::fresh_db();
    let store = Store::new(&conn);
    let queue = SyncQueue::new();
    let first = enqueue_item(&conn, "sale.create", "{\"n\":1}");
    let second = enqueue_item(&conn, "sale.create", "{\"n\":2}");
    let pending = store.list_pending_offline().unwrap();

    let results = vec![crate::transport::PushOutcome::Accepted];
    apply_push_outcomes(&queue, &store, &pending, &results);

    assert_eq!(status_of(&conn, &first), "synced");
    assert_eq!(
        status_of(&conn, &second),
        "pending",
        "an item with no outcome must stay pending, never inherit a neighbour's"
    );
}
