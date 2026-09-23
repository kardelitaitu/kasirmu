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

// ── C4 S2: the void and payment producers (transactional outbox) ──

fn queue_rows(conn: &Connection, action: &str) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM offline_queue WHERE action = ?1",
        rusqlite::params![action],
        |r| r.get(0),
    )
    .unwrap()
}

/// A committed void must leave EXACTLY ONE `void_sale` queue row carrying the
/// sale id the pull-side arm compare-and-sets on. Nothing in production
/// enqueued this action before: a void made on one terminal never reached the
/// others.
#[test]
fn void_sale_writes_one_void_outbox_row() {
    let conn = fresh();
    let s = store(&conn);
    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(Sku::new("VOID-OUTBOX"), 1, price(1000)))
        .unwrap();
    let sale = Sale::from_cart(&cart).unwrap();
    s.create_sale(&sale).unwrap();
    s.update_sale_status(&sale.id, crate::SaleStatus::Active)
        .unwrap();

    s.void_sale(&sale.id, "user-2", "customer request").unwrap();

    assert_eq!(queue_rows(&conn, "void_sale"), 1);
    let (payload, tenant, priority): (String, String, i32) = conn
        .query_row(
            "SELECT payload, tenant_id, priority FROM offline_queue WHERE action = 'void_sale'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!(priority, 0, "Critical");
    assert_eq!(tenant, "default", "tenant read from the sale row");
    let v: serde_json::Value = serde_json::from_str(&payload).unwrap();
    assert_eq!(v["sale_id"], serde_json::json!(sale.id));
    assert!(v.get("origin").is_none());
}

/// A void that LOSES the compare-and-set must write no queue row: the CAS
/// branch rolls back before the outbox seat. A completed sale is the case the
/// status graph forbids - pushing a void for it would void a paid sale on
/// every other terminal.
#[test]
fn refused_void_writes_no_outbox_row() {
    let conn = fresh();
    let s = store(&conn);
    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(Sku::new("VOID-REFUSED"), 1, price(1000)))
        .unwrap();
    let sale = Sale::from_cart(&cart).unwrap();
    s.create_sale(&sale).unwrap();
    s.update_sale_status(&sale.id, crate::SaleStatus::Active)
        .unwrap();
    s.update_sale_status(&sale.id, crate::SaleStatus::Completed)
        .unwrap();

    let err = s.void_sale(&sale.id, "user-2", "too late").unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "status"));
    assert_eq!(
        queue_rows(&conn, "void_sale"),
        0,
        "a refused void must leave no outbox row"
    );
}

/// A split settlement must write ONE `payment.recorded` row PER SPLIT, each
/// carrying the payment id and its idempotency key when present - the two
/// identities the pull-side arm probes.
#[test]
fn split_settlement_writes_one_payment_outbox_row_per_split() {
    let conn = fresh();
    let s = store(&conn);
    seed_stocked_product(&conn, "PAY-OUTBOX");
    let mut sale = single_line_sale("PAY-OUTBOX", Some("cashier-3"));
    sale.total = price(1000);

    let splits = vec![
        crate::PaymentSplitArg {
            method: "cash".into(),
            amount_minor: 400,
            gateway_reference: None,
            gateway_status: None,
            gateway_response: None,
            idempotency_key: Some("idem-cash".into()),
        },
        crate::PaymentSplitArg {
            method: "card".into(),
            amount_minor: 600,
            gateway_reference: Some("gw-ref-1".into()),
            gateway_status: Some("approved".into()),
            gateway_response: None,
            idempotency_key: None,
        },
    ];
    s.complete_sale_deduction_with_locations_and_estimate(
        &sale,
        None,
        &[],
        &splits,
        "cashier-3",
        None,
        &[],
        false,
    )
    .unwrap();

    assert_eq!(
        queue_rows(&conn, "payment.recorded"),
        2,
        "one row per split"
    );
    let payment_ids: Vec<String> = conn
        .prepare("SELECT id FROM payments WHERE sale_id = ?1 ORDER BY method")
        .unwrap()
        .query_map(rusqlite::params![&sale.id], |r| r.get(0))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();
    assert_eq!(payment_ids.len(), 2);

    // Keyed by method rather than sorted: "card" sorts before "cash", which
    // would make the two assertions below depend on that accident.
    let mut by_method: std::collections::HashMap<String, serde_json::Value> = conn
        .prepare("SELECT payload FROM offline_queue WHERE action = 'payment.recorded'")
        .unwrap()
        .query_map([], |r| r.get::<_, String>(0))
        .unwrap()
        .map(|r| {
            let v: serde_json::Value = serde_json::from_str(&r.unwrap()).unwrap();
            (v["method"].as_str().unwrap().to_string(), v)
        })
        .collect();
    assert_eq!(by_method.len(), 2, "one row per distinct split");

    let cash = by_method.remove("cash").expect("cash split row");
    assert_eq!(cash["method"], serde_json::json!("cash"));
    assert_eq!(cash["sale_id"], serde_json::json!(sale.id));
    assert_eq!(cash["amount_minor"], serde_json::json!(400));
    assert_eq!(cash["currency"], serde_json::json!("USD"));
    assert_eq!(cash["idempotency_key"], serde_json::json!("idem-cash"));
    assert!(
        payment_ids.contains(&cash["id"].as_str().unwrap().to_string()),
        "the payload names the payments row it describes"
    );
    assert!(cash.get("origin").is_none());

    let card = by_method.remove("card").expect("card split row");
    assert_eq!(card["method"], serde_json::json!("card"));
    assert_eq!(card["amount_minor"], serde_json::json!(600));
    assert_eq!(card["gateway_reference"], serde_json::json!("gw-ref-1"));
    assert_eq!(card["gateway_status"], serde_json::json!("approved"));
    assert_eq!(
        card["idempotency_key"],
        serde_json::Value::Null,
        "absent key stays null, never an invented one"
    );
    assert!(payment_ids.contains(&card["id"].as_str().unwrap().to_string()));
}

/// The rollback proof for the payment producer: the same UNIQUE collision the
/// sale outbox seat is tested against rolls the queue rows back with the sale.
#[test]
fn rolled_back_settlement_writes_no_payment_outbox_row() {
    let conn = fresh();
    let s = store(&conn);
    seed_stocked_product(&conn, "PAY-ROLLBACK");
    let sale = single_line_sale("PAY-ROLLBACK", Some("cashier-4"));

    let err = s
        .complete_sale_deduction_with_locations_and_estimate(
            &sale,
            None,
            &[],
            &tender_with_colliding_keys(1000),
            "cashier-4",
            None,
            &[],
            false,
        )
        .unwrap_err();
    assert!(err.to_string().contains("idempotency_key"));

    assert_eq!(
        queue_rows(&conn, "payment.recorded"),
        0,
        "a rolled-back settlement must leave no payment outbox row"
    );
    assert_eq!(sale_count(&conn), 0);
}
