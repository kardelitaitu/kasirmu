//! Unit tests for the checkout settlement door (complete_sale_deduction_with_locations_and_estimate).
//!
//! In-transaction audit row coverage (PCI 10.2.1): the audit row is
//! written at the outbox seat, inside the settlement transaction, so it
//! commits or rolls back with the sale, and AuditLogHandler's
//! has_audit_row_for probe keeps the post-commit handler from doubling it.

use super::*;
use crate::migrations;
use crate::{Cart, CartLine, Sku};
use rusqlite::Connection;

fn fresh() -> Connection {
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

fn audit_count(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM audit_log", [], |r| r.get(0))
        .unwrap()
}

fn sale_count(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM sales", [], |r| r.get(0))
        .unwrap()
}

/// Seed a stocked retail product at the canonical default location, so the
/// door's Phase-1 stock check passes without shortfalls.
fn seed_stocked_product(conn: &Connection, sku: &str) {
    let product_id = uuid::Uuid::now_v7().to_string();
    conn.execute(
        "INSERT OR IGNORE INTO products (id, sku, name, price_minor, currency, product_type) \
         VALUES (?1, ?2, ?2, 1000, 'USD', 'retail')",
        rusqlite::params![product_id, sku],
    )
    .unwrap();
    conn.execute(
        "INSERT OR IGNORE INTO inventory_locations (id, name, type) VALUES (?1, 'Default', 'store')",
        rusqlite::params![crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID],
    )
    .unwrap();
    conn.execute(
        "INSERT OR IGNORE INTO stock_summary (item_id, location_id, qty) VALUES (?1, ?2, 10)",
        rusqlite::params![
            product_id,
            crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID
        ],
    )
    .unwrap();
}

fn single_line_sale(sku: &str, actor: Option<&str>) -> Sale {
    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(Sku::new(sku), 1, price(1000)))
        .unwrap();
    let mut sale = Sale::from_cart(&cart).unwrap();
    sale.user_id = actor.map(|s| s.to_string());
    sale
}

/// Seed a terminal row so the receipt-code mint has a known terminal to
/// resolve (and lazily allocate an index_id for). `device_id` is UNIQUE, so
/// the id doubles as the device id for the test row.
fn seed_terminal(conn: &Connection, id: &str) {
    conn.execute(
        "INSERT OR IGNORE INTO terminals (id, name, device_id) VALUES (?1, ?1, ?1)",
        rusqlite::params![id],
    )
    .unwrap();
}

fn tender(amount_minor: i64) -> Vec<crate::PaymentSplitArg> {
    vec![crate::PaymentSplitArg {
        method: "cash".into(),
        amount_minor,
        gateway_reference: None,
        gateway_status: None,
        gateway_response: None,
        idempotency_key: None,
    }]
}

/// Two halves with the SAME idempotency key: the second payments insert
/// always collides with idx_payments_idempotency_key, which fails the whole
/// transaction AFTER the audit seat - the rollback property, testable
/// because the seat precedes the payment inserts.
fn tender_with_colliding_keys(total: i64) -> Vec<crate::PaymentSplitArg> {
    let half = total / 2;
    let mk = |amount_minor: i64| crate::PaymentSplitArg {
        method: "cash".into(),
        amount_minor,
        gateway_reference: None,
        gateway_status: None,
        gateway_response: None,
        idempotency_key: Some("dup-key".into()),
    };
    vec![mk(half), mk(total - half)]
}

// ── In-transaction audit row (door seat) ────────────────────────

/// HEAD-failure: FAILS AGAINST HEAD. Before this change the wired door
/// wrote no audit row at all (the handler wrote it later, off-transaction),
/// so the audit_count assertion sees 0 at HEAD and 1 here.
#[test]
fn checkout_settlement_writes_one_audit_row_with_real_actor() {
    let conn = fresh();
    let s = store(&conn);
    seed_stocked_product(&conn, "CHECKOUT-SKU");
    let sale = single_line_sale("CHECKOUT-SKU", Some("cashier-1"));

    s.complete_sale_deduction_with_locations_and_estimate(
        &sale,
        None,
        &[],
        &tender(1000),
        "cashier-1",
        None,
        &[],
        false,
    )
    .unwrap();

    assert_eq!(audit_count(&conn), 1);
    let entries = store(&conn).list_audit_entries(10, 0).unwrap();
    assert_eq!(entries[0].action, "sale.completed");
    // PCI 10.2.1: the REAL actor, not the handler's empty string.
    assert_eq!(entries[0].user_id, "cashier-1");
    assert_eq!(entries[0].target_type.as_deref(), Some("sale"));
    assert_eq!(entries[0].target_id.as_deref(), Some(sale.id.as_str()));
    assert_eq!(entries[0].outcome, "success");
    assert!(entries[0].details.contains("\"sale_id\":\""));
    assert!(entries[0].details.contains("\"line_count\":1"));
}

/// HEAD-failure: explicitly NOT a HEAD-failure - passes at HEAD trivially,
/// because HEAD wrote no audit row at all. It guards the rollback property
/// going forward: the audit seat sits before the payment inserts, so the
/// UNIQUE collision takes the audit row down with the sale.
#[test]
fn checkout_settlement_rollback_leaves_no_audit_row() {
    let conn = fresh();
    let s = store(&conn);
    seed_stocked_product(&conn, "ROLLBACK-SKU");
    let sale = single_line_sale("ROLLBACK-SKU", Some("cashier-1"));

    let err = s
        .complete_sale_deduction_with_locations_and_estimate(
            &sale,
            None,
            &[],
            &tender_with_colliding_keys(1000),
            "cashier-1",
            None,
            &[],
            false,
        )
        .unwrap_err();

    assert!(err.to_string().contains("idempotency_key"));
    assert_eq!(audit_count(&conn), 0);
    assert_eq!(sale_count(&conn), 0);
}

/// HEAD-failure: FAILS AGAINST HEAD (no audit row existed at all).
///
/// Redaction/sanitize on the door path: the door's payload keys are fixed
/// (sale_id/total_minor/currency/line_count), so no caller-injectable
/// sensitive KEY exists today and the redaction branch cannot be triggered
/// through the door. This test proves the payload still goes through
/// sanitize_details - the same single call site that redacts - via its
/// truncation branch: an oversized sale id inflates details past
/// MAX_DETAIL_LEN and must land capped with the truncation marker.
#[test]
fn checkout_audit_details_pass_sanitize_on_door_path() {
    let conn = fresh();
    let s = store(&conn);
    seed_stocked_product(&conn, "SANITIZE-SKU");
    let mut sale = single_line_sale("SANITIZE-SKU", Some("cashier-1"));
    sale.id = "x".repeat(4100);
    // Re-key the lines to the oversized id: sale_lines.sale_id carries an
    // FK to sales.id, and the mutation must stay internally consistent for
    // the door to reach the audit seat at all.
    for line in &mut sale.lines {
        line.sale_id = sale.id.clone();
    }

    s.complete_sale_deduction_with_locations_and_estimate(
        &sale,
        None,
        &[],
        &tender(1000),
        "cashier-1",
        None,
        &[],
        false,
    )
    .unwrap();

    let entries = store(&conn).list_audit_entries(10, 0).unwrap();
    assert_eq!(entries.len(), 1);
    assert!(entries[0].details.chars().count() <= 4012);
    assert!(entries[0].details.ends_with("[truncated]"));
}

/// Phase 3/4: with a terminal known, the frozen 22-char receipt hierarchy code
/// is minted, frozen into `sales.display_code`, returned on
/// `CompleteSaleResult.receipt_number`, and readable via the narrow
/// `sale_display_code` / `sale_display_codes` accessors — without widening the
/// `Sale` struct (the `sale_tax_estimate_note` precedent).
#[test]
fn checkout_freezes_receipt_hierarchy_code_and_it_is_readable() {
    let conn = fresh();
    let s = store(&conn);
    seed_stocked_product(&conn, "CODE-SKU");
    seed_terminal(&conn, "TERM-1");
    let sale = single_line_sale("CODE-SKU", Some("cashier-1"));

    let result = s
        .complete_sale_deduction_with_locations_and_estimate(
            &sale,
            None,
            &[],
            &tender(1000),
            "cashier-1",
            Some("TERM-1"),
            &[],
            false,
        )
        .unwrap();

    // 22 chars, four hyphens, the agreed assembly shape.
    let code = result.receipt_number;
    assert_eq!(code.len(), 22, "expected 22-char code, got {code}");
    assert_eq!(code.matches('-').count(), 4);

    // Frozen into the row.
    let stored: Option<String> = conn
        .query_row(
            "SELECT display_code FROM sales WHERE id = ?1",
            rusqlite::params![sale.id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(stored.as_deref(), Some(code.as_str()));

    // Readable via the narrow accessor (single + batch), no Sale churn.
    assert_eq!(
        s.sale_display_code(&sale.id).unwrap().as_deref(),
        Some(code.as_str())
    );
    let batch = s
        .sale_display_codes(std::slice::from_ref(&sale.id))
        .unwrap();
    assert_eq!(batch.len(), 1);
    assert_eq!(batch[0].1.as_deref(), Some(code.as_str()));
}
