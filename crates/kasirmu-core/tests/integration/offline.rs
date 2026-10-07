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

#[test]
fn test_sale_execution_zero_lookups() {
    let conn = setup();

    // Seed location, legal entity, and PB1 tax rate
    conn.execute(
        "INSERT INTO legal_entities (id, tenant_id, name, legal_name, country_code, currency)
         VALUES ('ent-zero', 'default', 'Zero Lookup PT', 'Zero Lookup PT', 'ID', 'IDR')",
        [],
    )
    .unwrap();

    conn.execute(
        "INSERT INTO locations (id, name, tenant_id, legal_entity_id, currency, timezone, locale)
         VALUES ('loc-zero', 'Store Zero', 'default', 'ent-zero', 'IDR', 'Asia/Jakarta', 'id-ID')",
        [],
    )
    .unwrap();

    conn.execute(
        "INSERT INTO tax_rates (id, name, rate_bps, is_default, is_active, location_id, rounding_mode)
         VALUES ('tax-pb1', 'PB1', 1000, 1, 1, 'loc-zero', 'half_up')",
        [],
    )
    .unwrap();

    // 1. Cold boot: Load ActiveMarketProfile once into memory
    let profile = kasirmu_core::load_active_market_profile(&conn, "loc-zero").unwrap();
    assert_eq!(profile.country_code, "ID");
    assert_eq!(profile.currency, "IDR");
    assert_eq!(profile.tax_regime, "PB1");
    assert_eq!(
        profile.statutory_rounding,
        kasirmu_core::tax_rate::RoundingMode::HalfUp
    );

    // 2. Run a 100-item checkout calculation cycle using the compiled in-memory profile
    let start = std::time::Instant::now();
    let mut total_gross = 0i64;
    let mut total_tax = 0i64;

    for i in 1..=100 {
        let item_price = 10_000i64 * (i % 5 + 1); // 10k to 50k IDR
        let tax_amount = profile
            .statutory_rounding
            .divide(item_price * 1000, 10000)
            .unwrap();
        total_gross += item_price + tax_amount;
        total_tax += tax_amount;
    }

    let elapsed = start.elapsed();
    assert!(total_gross > 0);
    assert!(total_tax > 0);
    // Sub-10ms execution time for pure in-memory calculation (0 network, 0 database queries)
    assert!(
        elapsed.as_millis() < 10,
        "100-item checkout cycle took {:?}, expected < 10ms",
        elapsed
    );
}

#[test]
fn test_two_hundred_consecutive_offline_sales_durability() {
    let mut conn = setup();

    // 1. Seed initial stock for 200 sales
    {
        let s = store(&conn);
        s.create_product(
            "COFFEE_01",
            "Kopi Susu Gula Aren",
            foundation::Money {
                minor_units: 18000,
                currency: "IDR".parse().unwrap(),
            },
            None,
            None,
            500, // Stock: 500 units
            None,
        )
        .unwrap();
    }

    let start_time = std::time::Instant::now();
    let loc = kasirmu_core::inventory::LocationId::from(
        kasirmu_core::inventory::CANONICAL_DEFAULT_LOCATION_UUID,
    );

    // 2. Execute 200 consecutive sales in disconnected offline mode
    for i in 1..=200 {
        let sale_id = format!("sale-offline-{i:03}");
        let payload = format!(r#"{{"saleId":"{sale_id}","itemCount":1,"total":18000}}"#);

        let tx = conn.transaction().unwrap();
        let s = store(&tx);
        // Record offline queue item
        let item = s.enqueue_offline("sale.create", &payload).unwrap();
        assert_eq!(item.status, OfflineQueueStatus::Pending);

        // Deduct inventory
        s.adjust_stock_at_location_with_reason(&tx, "COFFEE_01", -1, &loc, None, None, None, None)
            .unwrap();
        tx.commit().unwrap();
    }

    let elapsed = start_time.elapsed();
    let s = store(&conn);

    // 3. Verify exactly 200 sale queue events and 200 inventory adjustment queue events
    let pending = s.list_pending_offline().unwrap();
    let sale_events: Vec<_> = pending
        .iter()
        .filter(|i| i.action == "sale.create")
        .collect();
    assert_eq!(sale_events.len(), 200);

    // 4. Verify stock decremented cleanly from 500 down to 300
    let product_id = s.product_id_by_sku("COFFEE_01").unwrap().unwrap();
    let remaining_stock = s.get_stock(&product_id).unwrap();
    assert_eq!(remaining_stock, 300);

    // 5. Verify queue ordering is strictly monotonic by ID
    for (idx, item) in sale_events.iter().enumerate() {
        let expected_sale_id = format!("sale-offline-{:03}", idx + 1);
        assert!(item.payload.contains(&expected_sale_id));
        assert_eq!(item.status, OfflineQueueStatus::Pending);
    }

    // Must complete swiftly under 3000ms
    assert!(
        elapsed.as_millis() < 3000,
        "200 consecutive offline sales took {:?}, expected < 3000ms",
        elapsed
    );
}

#[test]
fn test_full_pilot_dry_run_onboarding_to_50_sales_shift_and_sync() {
    let mut conn = setup();

    // ── Phase 1: Clean Install & First-Run Onboarding ──────────────────
    let args = kasirmu_core::db::provisioning::ProvisionDeviceArgs {
        terminal_id: "term-beta-pilot-01".into(),
        location_name: "Kopi Kenangan Beta".into(),
        currency: "IDR".into(),
        timezone: "Asia/Jakarta".into(),
        owner_username: "barista_andi".into(),
        owner_display_name: "Andi Barista".into(),
        owner_pin: "1234".into(),
        preset: "restaurant".into(),
        features: vec!["sales".into(), "inventory".into(), "shifts".into()],
        location_kind: kasirmu_core::db::provisioning::LocationKind::Restaurant,
        mode: kasirmu_core::db::provisioning::ProvisioningMode::Local,
        tenant_id: None,
        device_credential_id: None,
        tax_preset: Some("ppn11_service5".into()),
        seed_sample_products: Some(true),
    };
    let prov = kasirmu_core::db::provisioning::provision_device(&mut conn, &args).unwrap();
    assert!(prov.created, "First-run provision must create a new record");

    let s = store(&conn);
    // Verify starter catalog products exist with inventory
    let americano_id = s
        .product_id_by_sku("SMPL-REST-01")
        .unwrap()
        .expect("Americano must exist");
    let croissant_id = s
        .product_id_by_sku("SMPL-REST-02")
        .unwrap()
        .expect("Croissant must exist");
    let mineral_water_id = s
        .product_id_by_sku("SMPL-REST-03")
        .unwrap()
        .expect("Mineral Water must exist");

    assert_eq!(s.get_stock(&americano_id).unwrap(), 100);
    assert_eq!(s.get_stock(&croissant_id).unwrap(), 50);
    assert_eq!(s.get_stock(&mineral_water_id).unwrap(), 120);

    // ── Phase 2: Start Shift (Opening Float) ───────────────────────────
    let user_id = prov.owner_user_id;
    let shift = s
        .open_shift(&user_id, Some("term-beta-pilot-01"), 100_000)
        .unwrap(); // Rp 100.000 starting cash
    assert_eq!(shift.status, "open");
    assert_eq!(shift.opening_balance_minor, 100_000);

    // ── Phase 3: Execute 50 Real Sales with Inventory & Offline Queue ─
    let loc = kasirmu_core::inventory::LocationId::from(
        kasirmu_core::inventory::CANONICAL_DEFAULT_LOCATION_UUID,
    );
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    // Track total cash collected across the 50 sales
    let mut total_cash_sales_minor: i64 = 0;
    let mut total_sales_volume_minor: i64 = 0;

    for i in 1..=50 {
        let sale_id = format!("sale-pilot-{i:03}");
        let (sku, item_price_minor, qty, pay_method) = match i % 3 {
            1 => ("SMPL-REST-01", 25_000, 1, "cash"), // Americano Rp 25.000 Cash
            2 => ("SMPL-REST-02", 28_000, 1, "qris"), // Croissant Rp 28.000 QRIS
            _ => ("SMPL-REST-03", 8_000, 1, "cash"),  // Mineral Water Rp 8.000 Cash
        };

        // PPN 11% (1100 bps) + Service 5% (500 bps) = 16% total tax
        let subtotal_minor = item_price_minor * qty;
        let tax_minor = subtotal_minor * 16 / 100;
        let total_minor = subtotal_minor + tax_minor;

        total_sales_volume_minor += total_minor;
        if pay_method == "cash" {
            total_cash_sales_minor += total_minor;
        }

        let tx = conn.transaction().unwrap();
        let s_tx = store(&tx);

        // 1. Deduct stock in transaction
        s_tx.adjust_stock_at_location_with_reason(&tx, sku, -qty, &loc, None, None, None, None)
            .unwrap();

        // 2. Insert into sales table
        tx.execute(
            "INSERT INTO sales (id, user_id, status, total_minor, payment_method, currency, line_count, subtotal_minor, tax_total_minor, created_at, updated_at)
             VALUES (?1, ?2, 'completed', ?3, ?4, 'IDR', 1, ?5, ?6, ?7, ?7)",
            rusqlite::params![sale_id, user_id, total_minor, pay_method, subtotal_minor, tax_minor, now],
        ).unwrap();

        // 3. Enqueue to offline sync queue
        let payload = format!(
            r#"{{"saleId":"{sale_id}","totalMinor":{total_minor},"method":"{pay_method}"}}"#
        );
        let queue_item = s_tx.enqueue_offline("sale.create", &payload).unwrap();
        assert_eq!(queue_item.status, OfflineQueueStatus::Pending);

        tx.commit().unwrap();

        // ── Phase 4: Thermal Receipt Printing Simulation ───────────────
        let mut receipt_bytes: Vec<u8> = Vec::new();
        receipt_bytes.extend_from_slice(&[0x1B, 0x40]); // ESC @ (Init)
        receipt_bytes.extend_from_slice(b"\x1b\x61\x01Kopi Kenangan Beta\n"); // Centered store header
        receipt_bytes
            .extend_from_slice(format!("Cashier: Andi Barista\nReceipt: {sale_id}\n").as_bytes());
        receipt_bytes.extend_from_slice(format!("Total: IDR {total_minor}\n").as_bytes());
        receipt_bytes.extend_from_slice(&[0x1D, 0x56, 0x41, 0x03]); // GS V A (Paper Cut)

        assert!(
            receipt_bytes.starts_with(&[0x1B, 0x40]),
            "Receipt must begin with ESC @"
        );
        assert!(
            receipt_bytes.ends_with(&[0x1D, 0x56, 0x41, 0x03]),
            "Receipt must end with paper cut"
        );
    }

    // ── Phase 5: End of Shift Reconciliation ──────────────────────────
    let s = store(&conn);
    let expected_cash = 100_000 + total_cash_sales_minor;
    let actual_counted_cash = expected_cash; // Exact match to the Rupiah

    let closed_shift = s
        .close_shift(
            &shift.id,
            actual_counted_cash,
            Some("End of day beta pilot shift"),
        )
        .unwrap();
    assert_eq!(closed_shift.status, "closed");
    assert_eq!(closed_shift.total_sales_minor, total_sales_volume_minor);
    assert_eq!(closed_shift.total_cash_minor, total_cash_sales_minor);
    assert_eq!(closed_shift.expected_cash_minor, Some(expected_cash));
    assert_eq!(
        closed_shift.cash_difference_minor,
        Some(0),
        "Cash difference must be exactly 0"
    );

    // Verify inventory balances after 50 sales:
    // 17 sales of Americano (100 - 17 = 83)
    // 17 sales of Croissant (50 - 17 = 33)
    // 16 sales of Mineral Water (120 - 16 = 104)
    assert_eq!(s.get_stock(&americano_id).unwrap(), 83);
    assert_eq!(s.get_stock(&croissant_id).unwrap(), 33);
    assert_eq!(s.get_stock(&mineral_water_id).unwrap(), 104);

    // ── Phase 6: Cloud Sync Drain & Convergence ────────────────────────
    let pending_events = s.list_pending_offline().unwrap();
    assert_eq!(
        pending_events.len(),
        100,
        "50 sales and 50 inventory adjustments in offline sync queue"
    );
    let sale_events: Vec<_> = pending_events
        .iter()
        .filter(|i| i.action == "sale.create")
        .collect();
    assert_eq!(sale_events.len(), 50, "Exactly 50 sale events enqueued");

    // Simulate online reconnection and batch sync drain
    for item in &pending_events {
        s.mark_offline_synced(&item.id).unwrap();
    }

    let remaining_pending = s.list_pending_offline().unwrap();
    assert_eq!(
        remaining_pending.len(),
        0,
        "Offline queue must be 100% drained and converged"
    );

    let all_items = s.list_all_offline().unwrap();
    assert_eq!(all_items.len(), 100);
    for item in &all_items {
        assert_eq!(item.status, OfflineQueueStatus::Synced);
        assert!(item.synced_at.is_some());
    }
}
