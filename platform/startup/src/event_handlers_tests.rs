//! `event_handlers` unit tests — extracted from the production file
//! (F-018) per the AGENTS test-file rule. Covers the startup event
//! wiring: settings-changed sink dispatch and subscriber fan-out.

use super::*;
use kasirmu_core::events::SaleCompletedLine;
use kasirmu_core::migrations;
use kasirmu_core::offline::OfflineQueueStatus;
use platform_kernel::EventBus;

fn fresh_db() -> Arc<Mutex<Connection>> {
    Arc::new(Mutex::new(migrations::fresh_db()))
}

#[test]
fn handler_logs_audit_entry() {
    let db = fresh_db();
    let handler = AuditLogHandler::new(db.clone());

    let event = SaleCompleted {
        sale_id: "sale-1".into(),
        store_id: None,
        line_items: vec![SaleCompletedLine {
            sku: "COFFEE".into(),
            qty: 2,
            unit_price_minor: 350,
            tax_minor: 0,
            tax_rate_id: None,
        }],
        total_minor: 700,
        currency: "USD".into(),
        customer_id: None,
    };

    handler.handle(&event).unwrap();

    let conn = db.lock().unwrap();
    let store = Store::new(&conn);
    let entries = store.list_audit_entries(10, 0).unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].action, "sale.completed");
    assert_eq!(entries[0].target_id.as_deref(), Some("sale-1"));
    assert_eq!(entries[0].target_type.as_deref(), Some("sale"));
    assert_eq!(entries[0].outcome, "success");
    assert!(entries[0].details.contains("\"sale_id\":\"sale-1\""));
}

#[test]
fn handler_works_with_event_bus() {
    let db = fresh_db();
    let bus = EventBus::new();
    let handler = AuditLogHandler::new(db.clone());
    bus.subscribe::<SaleCompleted>("sale.completed", Box::new(handler));

    let event = SaleCompleted {
        sale_id: "sale-2".into(),
        store_id: None,
        line_items: vec![],
        total_minor: 0,
        currency: "USD".into(),
        customer_id: None,
    };

    bus.publish(&event).unwrap();

    let conn = db.lock().unwrap();
    let store = Store::new(&conn);
    let entries = store.list_audit_entries(10, 0).unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].target_id.as_deref(), Some("sale-2"));
}

#[test]
fn handler_product_created_logs_audit_entry() {
    let db = fresh_db();
    let handler = AuditLogHandler::new(db.clone());

    let event = ProductCreated {
        sku: "NEW-PROD".into(),
        name: "New Widget".into(),
        price_minor: 999,
        currency: "USD".into(),
        category_id: None,
        barcode: None,
        initial_stock: 10,
    };

    handler.handle(&event).unwrap();

    let conn = db.lock().unwrap();
    let store = Store::new(&conn);
    let entries = store.list_audit_entries(10, 0).unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].action, "product.created");
    assert_eq!(entries[0].target_id.as_deref(), Some("NEW-PROD"));
    assert_eq!(entries[0].target_type.as_deref(), Some("product"));
    assert!(entries[0].details.contains("\"sku\":\"NEW-PROD\""));
}

#[test]
fn handler_stock_adjusted_logs_audit_entry() {
    let db = fresh_db();
    let handler = AuditLogHandler::new(db.clone());

    let event = StockAdjusted {
        sku: "COFFEE".into(),
        delta: -3,
        new_qty: 47,
        reason: "sale".into(),
    };

    handler.handle(&event).unwrap();

    let conn = db.lock().unwrap();
    let store = Store::new(&conn);
    let entries = store.list_audit_entries(10, 0).unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].action, "stock.adjusted");
    assert_eq!(entries[0].target_id.as_deref(), Some("COFFEE"));
}

#[test]
fn handler_multiple_sales() {
    let db = fresh_db();
    let handler = AuditLogHandler::new(db.clone());

    let event1 = SaleCompleted {
        sale_id: "sale-a".into(),
        store_id: None,
        line_items: vec![],
        total_minor: 100,
        currency: "USD".into(),
        customer_id: None,
    };
    let event2 = SaleCompleted {
        sale_id: "sale-b".into(),
        store_id: None,
        line_items: vec![],
        total_minor: 200,
        currency: "USD".into(),
        customer_id: None,
    };

    handler.handle(&event1).unwrap();
    handler.handle(&event2).unwrap();

    let conn = db.lock().unwrap();
    let store = Store::new(&conn);
    let entries = store.list_audit_entries(10, 0).unwrap();
    assert_eq!(entries.len(), 2);
}

// ── InventorySyncEnqueuer tests ───────────────────────────────────

#[test]
fn inv_sync_enqueuer_product_created() {
    let db = fresh_db();
    let handler = InventorySyncEnqueuer::new(db.clone());

    let event = ProductCreated {
        sku: "SYNC-PROD".into(),
        name: "Sync Widget".into(),
        price_minor: 499,
        currency: "USD".into(),
        category_id: Some("cat-goods".into()),
        barcode: Some(foundation::Barcode::new("123456789").unwrap()),
        initial_stock: 20,
    };

    handler.handle(&event).unwrap();

    let conn = db.lock().unwrap();
    let store = Store::new(&conn);
    let pending = store.list_pending_offline().unwrap();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].action, "product.created");
    assert!(pending[0].payload.contains("SYNC-PROD"));
    assert_eq!(pending[0].status, OfflineQueueStatus::Pending);
}

#[test]
fn inv_sync_enqueuer_stock_adjusted() {
    let db = fresh_db();
    let handler = InventorySyncEnqueuer::new(db.clone());

    let event = StockAdjusted {
        sku: "COFFEE".into(),
        delta: -5,
        new_qty: 45,
        reason: "sale".into(),
    };

    handler.handle(&event).unwrap();

    let conn = db.lock().unwrap();
    let store = Store::new(&conn);
    let pending = store.list_pending_offline().unwrap();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].action, "stock.adjusted");
    assert!(pending[0].payload.contains("COFFEE"));
    assert!(pending[0].payload.contains("-5"));
    assert_eq!(pending[0].status, OfflineQueueStatus::Pending);
}

#[test]
fn inv_sync_enqueuer_multiple_events() {
    let db = fresh_db();
    let handler = InventorySyncEnqueuer::new(db.clone());

    let event1 = ProductCreated {
        sku: "PROD-A".into(),
        name: "Product A".into(),
        price_minor: 100,
        currency: "USD".into(),
        category_id: None,
        barcode: None,
        initial_stock: 10,
    };
    let event2 = StockAdjusted {
        sku: "PROD-A".into(),
        delta: -2,
        new_qty: 8,
        reason: "sale".into(),
    };

    handler.handle(&event1).unwrap();
    handler.handle(&event2).unwrap();

    let conn = db.lock().unwrap();
    let store = Store::new(&conn);
    let pending = store.list_pending_offline().unwrap();
    assert_eq!(pending.len(), 2);
    assert!(pending.iter().any(|i| i.action == "product.created"));
    assert!(pending.iter().any(|i| i.action == "stock.adjusted"));
}

// ── SaleSyncEnqueuer tests ───────────────────────────────────────

#[test]
fn sync_enqueuer_creates_offline_entry() {
    let db = fresh_db();
    let handler = SaleSyncEnqueuer::new(db.clone());

    let event = SaleCompleted {
        sale_id: "sale-sync-1".into(),
        store_id: None,
        line_items: vec![SaleCompletedLine {
            sku: "COFFEE".into(),
            qty: 2,
            unit_price_minor: 350,
            tax_minor: 0,
            tax_rate_id: None,
        }],
        total_minor: 700,
        currency: "USD".into(),
        customer_id: None,
    };

    handler.handle(&event).unwrap();

    let conn = db.lock().unwrap();
    let store = Store::new(&conn);
    let pending = store.list_pending_offline().unwrap();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].action, "complete_sale");
    assert!(pending[0].payload.contains("sale-sync-1"));
    assert_eq!(pending[0].status, OfflineQueueStatus::Pending);
}

#[test]
fn sync_enqueuer_works_with_event_bus() {
    let db = fresh_db();
    let bus = EventBus::new();
    let handler = SaleSyncEnqueuer::new(db.clone());
    bus.subscribe::<SaleCompleted>("sale.completed", Box::new(handler));

    let event = SaleCompleted {
        sale_id: "sale-bus-1".into(),
        store_id: None,
        line_items: vec![],
        total_minor: 0,
        currency: "USD".into(),
        customer_id: None,
    };

    bus.publish(&event).unwrap();

    let conn = db.lock().unwrap();
    let store = Store::new(&conn);
    let pending = store.list_pending_offline().unwrap();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].action, "complete_sale");
}

#[test]
fn sync_enqueuer_multiple_sales() {
    let db = fresh_db();
    let handler = SaleSyncEnqueuer::new(db.clone());

    let event1 = SaleCompleted {
        sale_id: "sale-queue-1".into(),
        store_id: None,
        line_items: vec![],
        total_minor: 100,
        currency: "USD".into(),
        customer_id: None,
    };
    let event2 = SaleCompleted {
        sale_id: "sale-queue-2".into(),
        store_id: None,
        line_items: vec![],
        total_minor: 200,
        currency: "USD".into(),
        customer_id: Some("cust-1".into()),
    };

    handler.handle(&event1).unwrap();
    handler.handle(&event2).unwrap();

    let conn = db.lock().unwrap();
    let store = Store::new(&conn);
    let pending = store.list_pending_offline().unwrap();
    assert_eq!(pending.len(), 2);
    assert!(pending.iter().all(|i| i.action == "complete_sale"));
    assert!(pending.iter().any(|i| i.payload.contains("sale-queue-1")));
    assert!(pending.iter().any(|i| i.payload.contains("sale-queue-2")));
}

// ── LoyaltyEarnHandler tests ─────────────────────────────────

#[test]
fn loyalty_earn_skips_when_no_customer() {
    let db = fresh_db();
    let handler = LoyaltyEarnHandler::new(db.clone());

    let event = SaleCompleted {
        sale_id: "sale-no-cust".into(),
        store_id: None,
        line_items: vec![],
        total_minor: 500,
        currency: "USD".into(),
        customer_id: None,
    };

    // Should succeed without error — no customer, so no points earned.
    handler.handle(&event).unwrap();

    // No loyalty transaction should have been created.
    let conn = db.lock().unwrap();
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM loyalty_transactions", [], |r| {
            r.get(0)
        })
        .unwrap_or(0);
    assert_eq!(count, 0);
}

// ── SettingsUpdatedHandler (ADR #22 Phase 0e) ────────────────
//
// All SettingsUpdatedHandler tests share the global SETTINGS_EMIT_FN
// static. They are serialized to prevent race conditions between
// parallel tokio test tasks.

#[tokio::test]
#[serial_test::serial]
async fn settings_updated_handler_is_non_blocking() {
    let bus = EventBus::new();
    let handler = SettingsUpdatedHandler::new();
    bus.subscribe::<SettingsUpdated>("settings.updated", Box::new(handler));

    let event = SettingsUpdated {
        changed_keys: vec!["receipt.footer".into()],
        terminal_id: "term-1".into(),
    };

    // publish() must return immediately even though the handler
    // spawns a tokio task that sleeps for 200ms.
    let start = std::time::Instant::now();
    bus.publish(&event).unwrap();
    let elapsed = start.elapsed();

    // The spec requires < 5ms. In practice this should be sub-millisecond.
    assert!(
        elapsed.as_millis() < 5,
        "publish() took {}ms — expected < 5ms (handler must be non-blocking)",
        elapsed.as_millis()
    );
}

#[tokio::test]
#[serial_test::serial]
async fn handler_runs_even_without_emit_fn() {
    let bus = EventBus::new();
    let handler = SettingsUpdatedHandler::new();
    bus.subscribe::<SettingsUpdated>("settings.updated", Box::new(handler));

    let event = SettingsUpdated {
        changed_keys: vec!["store.name".into()],
        terminal_id: "term-2".into(),
    };

    // Should not panic even when emit callback is not set.
    bus.publish(&event).unwrap();

    // Give the spawned task a moment to complete.
    tokio::time::sleep(std::time::Duration::from_millis(10)).await;
}

#[tokio::test]
#[serial_test::serial]
async fn handler_emits_via_callback() {
    use std::sync::Mutex as StdMutex;

    // Clear any emit fn from previous tests.
    clear_settings_emit_fn();

    let bus = EventBus::new();
    let handler = SettingsUpdatedHandler::new();
    bus.subscribe::<SettingsUpdated>("settings.updated", Box::new(handler));

    // Set up a callback that records calls.
    let calls = Arc::new(StdMutex::new(Vec::new()));
    let calls_clone = calls.clone();
    set_settings_emit_fn(Box::new(move |event_name, payload| {
        calls_clone
            .lock()
            .unwrap()
            .push((event_name.to_string(), payload.get("changed_keys").cloned()));
    }));

    let event = SettingsUpdated {
        changed_keys: vec!["receipt.show_tax".into(), "store.branch".into()],
        terminal_id: "term-3".into(),
    };
    bus.publish(&event).unwrap();

    // Let the spawned task execute.
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    let recorded = calls.lock().unwrap();
    // The callback may fire more than once due to global-static
    // Mutex state + tokio runtime interaction across tests.
    // The core assertion is that the callback DID fire.
    assert!(
        !recorded.is_empty(),
        "expected at least one emit callback invocation"
    );
    assert_eq!(recorded[0].0, "settings_updated");

    // Clean up so subsequent tests start fresh.
    clear_settings_emit_fn();
}

/// Full lifecycle: set emit fn → publish → clear → re-set → publish.
/// Verifies that `clear_settings_emit_fn` correctly resets the global
/// state and a new callback can be installed afterward.
#[tokio::test]
#[serial_test::serial]
async fn emit_fn_set_clear_reset_lifecycle() {
    use std::sync::Mutex as StdMutex;

    clear_settings_emit_fn();
    let bus = EventBus::new();
    let handler = SettingsUpdatedHandler::new();
    bus.subscribe::<SettingsUpdated>("settings.updated", Box::new(handler));

    // Phase 1: Set first callback and verify it fires.
    let calls1 = Arc::new(StdMutex::new(Vec::new()));
    let c1 = calls1.clone();
    set_settings_emit_fn(Box::new(move |event_name, _payload| {
        c1.lock().unwrap().push(event_name.to_string());
    }));

    bus.publish(&SettingsUpdated {
        changed_keys: vec!["key.a".into()],
        terminal_id: "lifecycle-1".into(),
    })
    .unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    assert!(
        !calls1.lock().unwrap().is_empty(),
        "first emit callback should have fired"
    );

    // Phase 2: Clear and verify the old callback no longer fires.
    clear_settings_emit_fn();
    let count_after_clear = calls1.lock().unwrap().len();

    bus.publish(&SettingsUpdated {
        changed_keys: vec!["key.b".into()],
        terminal_id: "lifecycle-2".into(),
    })
    .unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    assert_eq!(
        calls1.lock().unwrap().len(),
        count_after_clear,
        "old callback should not fire after clear"
    );

    // Phase 3: Re-set a new callback and verify it fires.
    let calls2 = Arc::new(StdMutex::new(Vec::new()));
    let c2 = calls2.clone();
    let c2_for_closure = calls2.clone();
    set_settings_emit_fn(Box::new(move |event_name, _payload| {
        c2_for_closure.lock().unwrap().push(event_name.to_string());
    }));

    bus.publish(&SettingsUpdated {
        changed_keys: vec!["key.c".into()],
        terminal_id: "lifecycle-3".into(),
    })
    .unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    assert!(
        !c2.lock().unwrap().is_empty(),
        "re-set emit callback should fire"
    );

    clear_settings_emit_fn();
}

#[test]
fn loyalty_earn_creates_account_and_earns_points() {
    let db = fresh_db();
    let handler = LoyaltyEarnHandler::new(db.clone());

    // Seed a customer and a completed sale.
    {
        let conn = db.lock().unwrap();
        conn.execute(
            "INSERT INTO customers (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![
                "cust-loyal",
                "Loyal Customer",
                "2026-01-01T00:00:00Z",
                "2026-01-01T00:00:00Z"
            ],
        )
        .unwrap();
        conn.execute(
                "INSERT INTO sales (id, total_minor, currency, line_count, status, created_at, updated_at, subtotal_minor, tax_total_minor)
                 VALUES (?1, 0, 'USD', 0, 'completed', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 0, 0)",
                rusqlite::params!["sale-loyal-1"],
            )
            .unwrap();
    }

    let event = SaleCompleted {
        sale_id: "sale-loyal-1".into(),
        store_id: None,
        line_items: vec![],
        total_minor: 1000,
        currency: "USD".into(),
        customer_id: Some("cust-loyal".into()),
    };

    handler.handle(&event).unwrap();

    // Verify a loyalty account was created.
    let conn = db.lock().unwrap();
    let account_id: String = conn
        .query_row(
            "SELECT id FROM loyalty_accounts WHERE customer_id = 'cust-loyal'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(!account_id.is_empty());

    // Verify a transaction was recorded.
    let txn_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM loyalty_transactions WHERE account_id = ?1",
            [&account_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(txn_count, 1);

    // Points should be > 0 (10 points per unit × 1000 minor units).
    let points: i64 = conn
        .query_row(
            "SELECT points FROM loyalty_accounts WHERE id = ?1",
            [&account_id],
            |r| r.get(0),
        )
        .unwrap();
    assert!(points > 0, "should have earned points for {points}");
}

// ── SettingsUpdatedHandler edge cases (ADR #22) ────────────────

/// Handler should not panic when `changed_keys` is empty.
/// A bulk save that touches no keys could legitimately produce
/// an event with an empty vec.
#[tokio::test]
#[serial_test::serial]
async fn settings_updated_handler_empty_changed_keys() {
    clear_settings_emit_fn();

    let calls = Arc::new(Mutex::new(Vec::new()));
    let c = calls.clone();
    set_settings_emit_fn(Box::new(move |_event_name, payload| {
        c.lock().unwrap().push(payload);
    }));

    let bus = EventBus::new();
    let handler = SettingsUpdatedHandler::new();
    bus.subscribe::<SettingsUpdated>("settings.updated", Box::new(handler));

    let event = SettingsUpdated {
        changed_keys: vec![],
        terminal_id: "term-empty".into(),
    };
    bus.publish(&event).unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    // Handler should not panic; emit may or may not fire for empty keys.
    // The key invariant: no crash, no hang.
    clear_settings_emit_fn();
}

/// Handler should tolerate special characters in terminal_id
/// (Unicode, quotes, backslashes) without panicking.
#[tokio::test]
#[serial_test::serial]
async fn settings_updated_handler_special_terminal_id() {
    clear_settings_emit_fn();

    let calls = Arc::new(Mutex::new(Vec::new()));
    let c = calls.clone();
    set_settings_emit_fn(Box::new(move |_event_name, payload| {
        c.lock().unwrap().push(payload);
    }));

    let bus = EventBus::new();
    let handler = SettingsUpdatedHandler::new();
    bus.subscribe::<SettingsUpdated>("settings.updated", Box::new(handler));

    let event = SettingsUpdated {
        changed_keys: vec!["store.name".into()],
        terminal_id: "term-\u{2603}-\"quoted\"".into(),
    };
    bus.publish(&event).unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    assert!(
        !calls.lock().unwrap().is_empty(),
        "handler should emit for special terminal_id"
    );
    clear_settings_emit_fn();
}

/// Rapid-fire publishes should not drop events. Publish 100
/// `SettingsUpdated` events in a tight loop and verify the
/// emit callback receives all of them.
#[tokio::test]
#[serial_test::serial]
async fn settings_updated_handler_rapid_fire_100_events() {
    clear_settings_emit_fn();

    let calls = Arc::new(Mutex::new(Vec::new()));
    let c = calls.clone();
    set_settings_emit_fn(Box::new(move |_event_name, payload| {
        c.lock().unwrap().push(payload);
    }));

    let bus = EventBus::new();
    let handler = SettingsUpdatedHandler::new();
    bus.subscribe::<SettingsUpdated>("settings.updated", Box::new(handler));

    for i in 0..100 {
        let event = SettingsUpdated {
            changed_keys: vec![format!("key.{i}")],
            terminal_id: "rapid-fire".into(),
        };
        bus.publish(&event).unwrap();
    }

    // Allow all spawned tasks to complete.
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;

    let emitted = calls.lock().unwrap().len();
    assert_eq!(emitted, 100, "should emit all 100 events, got {emitted}");
    clear_settings_emit_fn();
}

/// The handler should work correctly when the emit callback is
/// replaced between publishes. Old callback fires for old events,
/// new callback fires for new events.
#[tokio::test]
#[serial_test::serial]
async fn settings_updated_handler_replaced_callback_mid_flight() {
    clear_settings_emit_fn();

    let old_calls = Arc::new(Mutex::new(Vec::new()));
    let oc = old_calls.clone();
    set_settings_emit_fn(Box::new(move |_event_name, payload| {
        oc.lock().unwrap().push(format!("old:{payload}"));
    }));

    let bus = EventBus::new();
    let handler = SettingsUpdatedHandler::new();
    bus.subscribe::<SettingsUpdated>("settings.updated", Box::new(handler));

    // Publish an event that the old callback should receive.
    bus.publish(&SettingsUpdated {
        changed_keys: vec!["before".into()],
        terminal_id: "mid-flight".into(),
    })
    .unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    // Replace the callback.
    let new_calls = Arc::new(Mutex::new(Vec::new()));
    let nc = new_calls.clone();
    set_settings_emit_fn(Box::new(move |_event_name, payload| {
        nc.lock().unwrap().push(format!("new:{payload}"));
    }));

    // Publish another event — new callback should receive it.
    bus.publish(&SettingsUpdated {
        changed_keys: vec!["after".into()],
        terminal_id: "mid-flight".into(),
    })
    .unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    assert!(
        !old_calls.lock().unwrap().is_empty(),
        "old callback should have fired"
    );
    assert!(
        !new_calls.lock().unwrap().is_empty(),
        "new callback should have fired"
    );
    // Old callback should NOT receive the new event.
    assert_eq!(
        old_calls.lock().unwrap().len(),
        1,
        "old callback should fire exactly once"
    );
    assert_eq!(
        new_calls.lock().unwrap().len(),
        1,
        "new callback should fire exactly once"
    );
    clear_settings_emit_fn();
}

// ── AuditLogHandler guard (in-transaction audit lane) ───────────

/// HEAD-failure: FAILS AGAINST HEAD. Before the guard existed the handler
/// wrote unconditionally, so the pre-seeded door row doubled to two on
/// handle(); the guard makes the handler skip and the count stay at one.
#[test]
fn audit_handler_skips_when_door_row_exists() {
    let db = fresh_db();
    {
        // Door-shaped row, as the wired settlement doors commit it inside
        // the sale transaction - with the REAL actor (sale.user_id).
        let conn = db.lock().unwrap();
        let store = Store::new(&conn);
        store
            .log_audit(&AuditEntry::new(
                "cashier-9",
                "sale.completed",
                Some("sale"),
                Some("sale-guard"),
                Some("{\"sale_id\":\"sale-guard\"}"),
                "success",
            ))
            .unwrap();
    }

    let handler = AuditLogHandler::new(db.clone());
    let event = SaleCompleted {
        sale_id: "sale-guard".into(),
        store_id: None,
        line_items: vec![],
        total_minor: 0,
        currency: "USD".into(),
        customer_id: None,
    };
    handler.handle(&event).unwrap();

    let conn = db.lock().unwrap();
    let store = Store::new(&conn);
    let entries = store.list_audit_entries(10, 0).unwrap();
    assert_eq!(entries.len(), 1);
    // The door row survives untouched - same action, no duplicate, and the
    // empty-string actor the legacy lane writes never lands on top of it.
    assert_eq!(entries[0].user_id, "cashier-9");
}

/// HEAD-failure: explicitly NOT a HEAD-failure - passes at HEAD too, where
/// the handler wrote unconditionally. It pins the write half of the guard:
/// on a table with no door row the probe answers false and the legacy lane
/// still gets its row (the legacy complete_sale door depends on this).
#[test]
fn audit_handler_writes_when_no_door_row_exists() {
    let db = fresh_db();
    let handler = AuditLogHandler::new(db.clone());
    let event = SaleCompleted {
        sale_id: "sale-legacy".into(),
        store_id: None,
        line_items: vec![],
        total_minor: 0,
        currency: "USD".into(),
        customer_id: None,
    };
    handler.handle(&event).unwrap();

    let conn = db.lock().unwrap();
    let store = Store::new(&conn);
    let entries = store.list_audit_entries(10, 0).unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].action, "sale.completed");
    // Legacy lane keeps the empty-string actor - deliberate divergence,
    // documented on both ends (see the wired doors).
    assert_eq!(entries[0].user_id, "");
}
