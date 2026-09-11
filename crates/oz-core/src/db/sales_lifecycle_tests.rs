//! Unit tests for the shortfall-resolved settlement door (complete_sale_with_resolved_shortfalls).
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

/// HEAD-failure: FAILS AGAINST HEAD. Before this change this door wrote no
/// audit row (the handler wrote it later, off-transaction), so the
/// audit_count assertion sees 0 at HEAD and 1 here.
#[test]
fn shortfall_settlement_writes_one_audit_row_with_real_actor() {
    let conn = fresh();
    let s = store(&conn);
    seed_stocked_product(&conn, "SHORTFALL-SKU");
    let sale = single_line_sale("SHORTFALL-SKU", Some("cashier-2"));

    s.complete_sale_with_resolved_shortfalls(
        &sale,
        None,
        &tender(1000),
        "cashier-2",
        None,
        &[],
        &[],
    )
    .unwrap();

    assert_eq!(audit_count(&conn), 1);
    let entries = store(&conn).list_audit_entries(10, 0).unwrap();
    assert_eq!(entries[0].action, "sale.completed");
    // PCI 10.2.1: the REAL actor, not the handler's empty string.
    assert_eq!(entries[0].user_id, "cashier-2");
    assert_eq!(entries[0].target_type.as_deref(), Some("sale"));
    assert_eq!(entries[0].target_id.as_deref(), Some(sale.id.as_str()));
    assert_eq!(entries[0].outcome, "success");
}

/// HEAD-failure: explicitly NOT a HEAD-failure - passes at HEAD trivially
/// (HEAD wrote no audit row). Guards the rollback property of the
/// shortfall door's audit seat, mirroring the checkout door.
#[test]
fn shortfall_settlement_rollback_leaves_no_audit_row() {
    let conn = fresh();
    let s = store(&conn);
    seed_stocked_product(&conn, "SF-ROLLBACK-SKU");
    let sale = single_line_sale("SF-ROLLBACK-SKU", Some("cashier-2"));

    let err = s
        .complete_sale_with_resolved_shortfalls(
            &sale,
            None,
            &tender_with_colliding_keys(1000),
            "cashier-2",
            None,
            &[],
            &[],
        )
        .unwrap_err();

    assert!(err.to_string().contains("idempotency_key"));
    assert_eq!(audit_count(&conn), 0);
    assert_eq!(sale_count(&conn), 0);
}
