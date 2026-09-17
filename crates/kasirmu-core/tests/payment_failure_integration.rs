//! Integration tests: Payment Failure & Sale Void Recovery (P39-3)
//!
//! Verifies the end-to-end flow when a payment fails after stock deduction:
//!   1. Create product with stock
//!   2. Complete sale → stock deducted, sale status = 'pending'
//!   3. Payment fails → void the pending sale
//!   4. Stock is restored to original amount
//!   5. Sale status = 'voided'
//!
//! Also covers: oversell rejection, stale pending sale reaping (ADR-20 §6),
//! and edge cases around partial payment splits.

use foundation::{Currency, Money};
use kasirmu_core::{PaymentSplitArg, Sale, SaleLine, SaleStatus, Store, migrations};
use rusqlite::Connection;

// ── Helpers ───────────────────────────────────────────────────────────

fn setup() -> Connection {
    migrations::fresh_db()
}

fn store(conn: &Connection) -> Store<'_> {
    Store::new(conn)
}

fn usd() -> Currency {
    "USD".parse().unwrap()
}

fn price(minor: i64) -> Money {
    Money {
        minor_units: minor,
        currency: usd(),
    }
}

fn new_sale_line(sale_id: &str, sku: &str, qty: i64, unit_minor: i64, position: i64) -> SaleLine {
    SaleLine {
        id: format!("line-{}-{}", sale_id, sku),
        sale_id: sale_id.to_string(),
        sku: sku.to_string(),
        qty,
        unit_price: price(unit_minor),
        line_total: price(unit_minor * qty),
        line_position: position,
        tax_amount: price(0),
        tax_rate_id: None,
        tax_breakdown_json: None,
        serial_number: None,
        course: None,
        modifiers_json: None,
    }
}

fn new_sale(id: &str, lines: Vec<SaleLine>, total_minor: i64) -> Sale {
    Sale {
        id: id.to_string(),
        status: SaleStatus::Active,
        total: price(total_minor),
        line_count: lines.len() as i64,
        currency: usd(),
        payment_method: Some("cash".to_string()),
        tendered_minor: Some(total_minor),
        discount_percent: 0,
        discount_label: None,
        user_id: Some("staff-1".to_string()),
        created_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        updated_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        lines,
        subtotal: price(total_minor),
        tax_total: price(0),
        customer_id: None,
        base_currency: None,
        base_total_minor: None,
        tender_rate_millionths: None,
        tip_minor: 0,
        service_charge_minor: 0,
        version: 1,
    }
}

fn get_stock(s: &Store<'_>, sku: &str) -> i64 {
    let id = s.product_id_by_sku(sku).unwrap().unwrap();
    s.get_stock(&id).unwrap()
}

// ── Core: Complete sale → void → stock restored ───────────────────────

#[test]
fn complete_sale_then_void_restores_stock() {
    let conn = setup();
    let s = store(&conn);

    // Seed product with stock.
    let _p = s
        .create_product("COFFEE", "Espresso", price(350), None, None, 100, None)
        .unwrap();
    assert_eq!(get_stock(&s, "COFFEE"), 100);

    // Complete the sale (stock deducted, sale → 'pending').
    let sale = new_sale(
        "sale-void-1",
        vec![new_sale_line("sale-void-1", "COFFEE", 3, 350, 1)],
        1050,
    );

    let payment_splits = vec![PaymentSplitArg {
        method: "cash".to_string(),
        amount_minor: 1050,
        gateway_reference: None,
        gateway_status: None,
        gateway_response: None,
        idempotency_key: None,
    }];

    let result = s
        .complete_sale_deduction(&sale, None, &payment_splits, "staff-1", None)
        .unwrap();
    assert_eq!(result.sale_id, "sale-void-1");
    assert_eq!(result.status, SaleStatus::Pending);

    // Stock should be deducted: 100 - 3 = 97.
    assert_eq!(get_stock(&s, "COFFEE"), 97);

    // ── Simulate payment failure → void the pending sale ──────────
    s.void_pending_sale("sale-void-1").unwrap();

    // Stock should be restored: 97 + 3 = 100.
    assert_eq!(
        get_stock(&s, "COFFEE"),
        100,
        "stock must be fully restored after void"
    );

    // Sale status should be 'voided'.
    let voided = s.get_sale("sale-void-1").unwrap().unwrap();
    assert_eq!(voided.status, SaleStatus::Voided);

    // Verify product still exists.
    let products = s.list_products().unwrap();
    assert_eq!(products.len(), 1);
    assert_eq!(products[0].product.sku.as_str(), "COFFEE");
}

#[test]
fn void_pending_sale_restores_multi_line_stock() {
    let conn = setup();
    let s = store(&conn);

    // Seed two products.
    s.create_product("TEA", "Green Tea", price(250), None, None, 50, None)
        .unwrap();
    s.create_product("CAKE", "Cheesecake", price(600), None, None, 20, None)
        .unwrap();
    assert_eq!(get_stock(&s, "TEA"), 50);
    assert_eq!(get_stock(&s, "CAKE"), 20);

    // Complete a multi-line sale.
    let sale = new_sale(
        "sale-multi-void",
        vec![
            new_sale_line("sale-multi-void", "TEA", 2, 250, 1),
            new_sale_line("sale-multi-void", "CAKE", 1, 600, 2),
        ],
        1100,
    );

    let payment_splits = vec![PaymentSplitArg {
        method: "cash".to_string(),
        amount_minor: 1100,
        gateway_reference: None,
        gateway_status: None,
        gateway_response: None,
        idempotency_key: None,
    }];

    s.complete_sale_deduction(&sale, None, &payment_splits, "staff-1", None)
        .unwrap();

    assert_eq!(get_stock(&s, "TEA"), 48, "50 - 2 = 48");
    assert_eq!(get_stock(&s, "CAKE"), 19, "20 - 1 = 19");

    // Void → both restored.
    s.void_pending_sale("sale-multi-void").unwrap();

    assert_eq!(get_stock(&s, "TEA"), 50, "must be fully restored");
    assert_eq!(get_stock(&s, "CAKE"), 20, "must be fully restored");
}

#[test]
fn void_nonexistent_sale_returns_not_found() {
    let conn = setup();
    let s = store(&conn);

    let err = s.void_pending_sale("nonexistent-sale").unwrap_err();
    assert!(matches!(err, kasirmu_core::CoreError::NotFound { .. }));
}

#[test]
fn void_nonpending_sale_returns_not_found() {
    let conn = setup();
    let s = store(&conn);

    // Create a completed sale directly (not via deduction flow).
    let sale = new_sale(
        "sale-completed",
        vec![new_sale_line("sale-completed", "FAKE", 1, 100, 1)],
        100,
    );
    s.create_sale(&sale).unwrap();

    // Void should fail — sale is 'completed', not 'pending'.
    let err = s.void_pending_sale("sale-completed").unwrap_err();
    assert!(matches!(err, kasirmu_core::CoreError::NotFound { .. }));
}

// ── Oversell rejection (payment never attempted) ──────────────────────

#[test]
fn complete_sale_rejects_oversell() {
    let conn = setup();
    let s = store(&conn);

    s.create_product("LIMITED", "Limited Item", price(500), None, None, 5, None)
        .unwrap();

    let sale = new_sale(
        "sale-oversell",
        vec![new_sale_line("sale-oversell", "LIMITED", 10, 500, 1)],
        5000,
    );

    let payment_splits = vec![PaymentSplitArg {
        method: "cash".to_string(),
        amount_minor: 5000,
        gateway_reference: None,
        gateway_status: None,
        gateway_response: None,
        idempotency_key: None,
    }];

    let err = s
        .complete_sale_deduction(&sale, None, &payment_splits, "staff-1", None)
        .unwrap_err();
    assert!(
        matches!(err, kasirmu_core::CoreError::Validation { .. }),
        "oversell should return Validation error with PartialStockResult"
    );

    // Stock must be unchanged — the transaction was rolled back.
    assert_eq!(get_stock(&s, "LIMITED"), 5);

    // Sale must not exist.
    assert!(s.get_sale("sale-oversell").unwrap().is_none());
}

#[test]
fn complete_sale_empty_lines_succeeds() {
    let conn = setup();
    let s = store(&conn);

    let sale = Sale {
        id: "sale-empty".to_string(),
        status: SaleStatus::Active,
        total: price(0),
        line_count: 0,
        currency: usd(),
        payment_method: Some("cash".to_string()),
        tendered_minor: Some(0),
        discount_percent: 0,
        discount_label: None,
        user_id: Some("staff-1".to_string()),
        created_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        updated_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        lines: vec![],
        subtotal: price(0),
        tax_total: price(0),
        customer_id: None,
        base_currency: None,
        base_total_minor: None,
        tender_rate_millionths: None,
        tip_minor: 0,
        service_charge_minor: 0,
        version: 1,
    };

    let result = s
        .complete_sale_deduction(&sale, None, &[], "staff-1", None)
        .unwrap();
    assert_eq!(result.sale_id, "sale-empty", "empty sale should succeed");

    // Clean up — void it.
    s.void_pending_sale("sale-empty").unwrap();
}

// ── Payment split edge cases ──────────────────────────────────────────

#[test]
fn multi_payment_split_persists_all_records() {
    let conn = setup();
    let s = store(&conn);

    s.create_product("WATER", "Mineral Water", price(150), None, None, 100, None)
        .unwrap();

    let sale = new_sale(
        "sale-split",
        vec![new_sale_line("sale-split", "WATER", 4, 150, 1)],
        600,
    );

    let payment_splits = vec![
        PaymentSplitArg {
            method: "cash".to_string(),
            amount_minor: 400,
            gateway_reference: None,
            gateway_status: None,
            gateway_response: None,
            idempotency_key: None,
        },
        PaymentSplitArg {
            method: "card".to_string(),
            amount_minor: 200,
            gateway_reference: Some("txn-abc".to_string()),
            gateway_status: Some("captured".to_string()),
            gateway_response: None,
            idempotency_key: Some("idem-abc".to_string()),
        },
    ];

    let result = s
        .complete_sale_deduction(&sale, None, &payment_splits, "staff-1", None)
        .unwrap();
    assert_eq!(result.sale_id, "sale-split");

    // Verify payment records in DB.
    let payment_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM payments WHERE sale_id = ?1",
            rusqlite::params!["sale-split"],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(payment_count, 2, "both payment splits should be persisted");

    // Clean up.
    s.void_pending_sale("sale-split").unwrap();
}

// ── Stale pending sale reaping (ADR-20 §6) ────────────────────────────

#[test]
fn stale_pending_sale_is_detected() {
    let conn = setup();
    let s = store(&conn);

    s.create_product(
        "STALE-ITEM",
        "Stale Product",
        price(100),
        None,
        None,
        50,
        None,
    )
    .unwrap();

    let sale = new_sale(
        "sale-stale",
        vec![new_sale_line("sale-stale", "STALE-ITEM", 1, 100, 1)],
        100,
    );

    let payment_splits = vec![PaymentSplitArg {
        method: "cash".to_string(),
        amount_minor: 100,
        gateway_reference: None,
        gateway_status: None,
        gateway_response: None,
        idempotency_key: None,
    }];

    s.complete_sale_deduction(&sale, None, &payment_splits, "staff-1", None)
        .unwrap();

    // Artificially age the pending_expires_at to force staleness.
    let past = chrono::Utc::now()
        .checked_sub_signed(chrono::Duration::hours(1))
        .unwrap()
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    conn.execute(
        "UPDATE sales SET pending_expires_at = ?1 WHERE id = 'sale-stale'",
        rusqlite::params![past],
    )
    .unwrap();

    // find_stale_pending_sales should detect it.
    let stale = s.find_stale_pending_sales().unwrap();
    assert_eq!(stale.len(), 1, "aged sale should be detected as stale");
    assert_eq!(stale[0], "sale-stale");

    // Reap should void it and restore stock.
    let reaped = s.reap_stale_pending_sales().unwrap();
    assert_eq!(reaped, 1, "one stale sale should be voided");
}

#[test]
fn reaped_sale_restores_stock() {
    let conn = setup();
    let s = store(&conn);

    s.create_product(
        "REAP-ITEM",
        "Reap Product",
        price(200),
        None,
        None,
        30,
        None,
    )
    .unwrap();
    assert_eq!(get_stock(&s, "REAP-ITEM"), 30);

    let sale = new_sale(
        "sale-reap",
        vec![new_sale_line("sale-reap", "REAP-ITEM", 5, 200, 1)],
        1000,
    );

    let payment_splits = vec![PaymentSplitArg {
        method: "cash".to_string(),
        amount_minor: 1000,
        gateway_reference: None,
        gateway_status: None,
        gateway_response: None,
        idempotency_key: None,
    }];

    s.complete_sale_deduction(&sale, None, &payment_splits, "staff-1", None)
        .unwrap();

    // Deducted: 30 - 5 = 25.
    assert_eq!(get_stock(&s, "REAP-ITEM"), 25);

    // Age the sale.
    let past = chrono::Utc::now()
        .checked_sub_signed(chrono::Duration::hours(1))
        .unwrap()
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    conn.execute(
        "UPDATE sales SET pending_expires_at = ?1 WHERE id = 'sale-reap'",
        rusqlite::params![past],
    )
    .unwrap();

    // Reap.
    s.reap_stale_pending_sales().unwrap();

    // Stock restored: 25 + 5 = 30.
    assert_eq!(get_stock(&s, "REAP-ITEM"), 30);

    // Sale voided.
    let voided = s.get_sale("sale-reap").unwrap().unwrap();
    assert_eq!(voided.status, SaleStatus::Voided);
}

// ── Void idempotency ──────────────────────────────────────────────────

#[test]
fn void_twice_returns_not_found_on_second_attempt() {
    let conn = setup();
    let s = store(&conn);

    s.create_product(
        "IDEM-ITEM",
        "Idempotent Test",
        price(100),
        None,
        None,
        10,
        None,
    )
    .unwrap();

    let sale = new_sale(
        "sale-idem",
        vec![new_sale_line("sale-idem", "IDEM-ITEM", 2, 100, 1)],
        200,
    );

    let payment_splits = vec![PaymentSplitArg {
        method: "cash".to_string(),
        amount_minor: 200,
        gateway_reference: None,
        gateway_status: None,
        gateway_response: None,
        idempotency_key: None,
    }];

    s.complete_sale_deduction(&sale, None, &payment_splits, "staff-1", None)
        .unwrap();

    // First void succeeds.
    s.void_pending_sale("sale-idem").unwrap();

    // Second void fails — sale is already voided, not pending.
    let err = s.void_pending_sale("sale-idem").unwrap_err();
    assert!(
        matches!(err, kasirmu_core::CoreError::NotFound { .. }),
        "second void should return NotFound"
    );
}

// ── Concurrent sale-vs-reap race condition ────────────────────────────

#[test]
fn concurrent_reap_wins_over_finalize() {
    let conn = setup();
    let s = store(&conn);

    s.create_product(
        "RACE-ITEM",
        "Race Product",
        price(300),
        None,
        None,
        50,
        None,
    )
    .unwrap();

    let sale = new_sale(
        "sale-race",
        vec![new_sale_line("sale-race", "RACE-ITEM", 5, 300, 1)],
        1500,
    );

    let payment_splits = vec![PaymentSplitArg {
        method: "cash".to_string(),
        amount_minor: 1500,
        gateway_reference: None,
        gateway_status: None,
        gateway_response: None,
        idempotency_key: None,
    }];

    s.complete_sale_deduction(&sale, None, &payment_splits, "staff-1", None)
        .unwrap();

    assert_eq!(get_stock(&s, "RACE-ITEM"), 45, "50 - 5 = 45");

    // Age the sale to make it eligible for reaping.
    let past = chrono::Utc::now()
        .checked_sub_signed(chrono::Duration::hours(1))
        .unwrap()
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    conn.execute(
        "UPDATE sales SET pending_expires_at = ?1 WHERE id = 'sale-race'",
        rusqlite::params![past],
    )
    .unwrap();

    // Reaper runs first — voids the stale sale.
    let reaped = s.reap_stale_pending_sales().unwrap();
    assert_eq!(reaped, 1, "reaper should void the stale sale");

    // Stock restored: 45 + 5 = 50.
    assert_eq!(get_stock(&s, "RACE-ITEM"), 50);

    // Now the cashier tries to finalize — rusqlite execute returns Ok(0)
    // for 0 rows affected, not an error. Finalize is a silent no-op.
    let _ = s.finalize_sale("sale-race"); // succeeds silently

    // Sale remains voided.
    let voided = s.get_sale("sale-race").unwrap().unwrap();
    assert_eq!(
        voided.status,
        SaleStatus::Voided,
        "reaper already voided it"
    );

    // Stock stays restored (reaper already did it).
    assert_eq!(get_stock(&s, "RACE-ITEM"), 50);
}

#[test]
fn finalize_wins_over_reap() {
    let conn = setup();
    let s = store(&conn);

    s.create_product(
        "RACE2-ITEM",
        "Race Product 2",
        price(200),
        None,
        None,
        30,
        None,
    )
    .unwrap();

    let sale = new_sale(
        "sale-race2",
        vec![new_sale_line("sale-race2", "RACE2-ITEM", 3, 200, 1)],
        600,
    );

    let payment_splits = vec![PaymentSplitArg {
        method: "card".to_string(),
        amount_minor: 600,
        gateway_reference: Some("txn-race2".to_string()),
        gateway_status: Some("captured".to_string()),
        gateway_response: None,
        idempotency_key: Some("idem-race2".to_string()),
    }];

    s.complete_sale_deduction(&sale, None, &payment_splits, "staff-1", None)
        .unwrap();

    assert_eq!(get_stock(&s, "RACE2-ITEM"), 27, "30 - 3 = 27");

    // Age the sale.
    let past = chrono::Utc::now()
        .checked_sub_signed(chrono::Duration::hours(1))
        .unwrap()
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    conn.execute(
        "UPDATE sales SET pending_expires_at = ?1 WHERE id = 'sale-race2'",
        rusqlite::params![past],
    )
    .unwrap();

    // Cashier finalizes first.
    s.finalize_sale("sale-race2").unwrap();

    let completed = s.get_sale("sale-race2").unwrap().unwrap();
    assert_eq!(completed.status, SaleStatus::Completed);

    // Reaper runs — should skip the completed sale (it's no longer pending).
    let reaped = s.reap_stale_pending_sales().unwrap();
    assert_eq!(reaped, 0, "reaper should skip completed sale");

    // Stock stays deducted — sale completed.
    assert_eq!(get_stock(&s, "RACE2-ITEM"), 27);
}

// ── Stock not restored on completed sale ──────────────────────────────

#[test]
fn completed_sale_preserves_stock_deduction() {
    let conn = setup();
    let s = store(&conn);

    s.create_product("FINAL", "Final Sale", price(300), None, None, 40, None)
        .unwrap();

    let sale = new_sale(
        "sale-final",
        vec![new_sale_line("sale-final", "FINAL", 4, 300, 1)],
        1200,
    );

    let payment_splits = vec![PaymentSplitArg {
        method: "card".to_string(),
        amount_minor: 1200,
        gateway_reference: Some("txn-final".to_string()),
        gateway_status: Some("captured".to_string()),
        gateway_response: None,
        idempotency_key: Some("idem-final".to_string()),
    }];

    s.complete_sale_deduction(&sale, None, &payment_splits, "staff-1", None)
        .unwrap();

    // Stock deducted: 40 - 4 = 36.
    assert_eq!(get_stock(&s, "FINAL"), 36);

    // Finalize (payment captured).
    s.finalize_sale("sale-final").unwrap();

    let completed = s.get_sale("sale-final").unwrap().unwrap();
    assert_eq!(completed.status, SaleStatus::Completed);

    // Stock stays deducted — the sale was completed, not voided.
    assert_eq!(
        get_stock(&s, "FINAL"),
        36,
        "completed sale keeps stock deducted"
    );
}
