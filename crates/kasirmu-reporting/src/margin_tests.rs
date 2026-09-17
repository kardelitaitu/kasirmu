use super::*;
use oz_core::migrations;
use oz_core::{Cart, CartLine, Currency, Money, Sale, SaleStatus, Sku};
use rusqlite::{Connection, params};

fn fresh() -> Connection {
    migrations::fresh_db()
}

fn usd() -> Currency {
    "USD".parse().unwrap()
}

fn seed_product(conn: &Connection, sku: &str, price_minor: i64, cost_minor: i64) {
    let store = oz_core::db::Store::new(conn);
    store
        .create_product(
            sku,
            sku,
            Money {
                minor_units: price_minor,
                currency: usd(),
            },
            None,
            None,
            100,
            None,
        )
        .unwrap();
    conn.execute(
        "UPDATE products SET cost_minor = ?1 WHERE sku = ?2",
        params![cost_minor, sku],
    )
    .unwrap();
}

fn complete_sale(conn: &Connection, lines: &[(&str, i64, i64)]) -> String {
    let store = oz_core::db::Store::new(conn);
    let mut cart = Cart::new(usd());
    for (sku, qty, unit_minor) in lines {
        cart.add_line(CartLine::new(
            Sku::new(*sku),
            *qty,
            Money {
                minor_units: *unit_minor,
                currency: usd(),
            },
        ))
        .unwrap();
    }
    let mut sale = Sale::from_cart(&cart).unwrap();
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    sale.created_at = now.clone();
    sale.updated_at = now;
    store.create_sale(&sale).unwrap();
    store
        .update_sale_status(&sale.id, SaleStatus::Active)
        .unwrap();
    store
        .update_sale_status(&sale.id, SaleStatus::Completed)
        .unwrap();
    sale.id
}

// ── margin_percent ────────────────────────────────────────────

#[test]
fn margin_percent_positive() {
    assert!((margin_percent(1700, 2500) - 68.0).abs() < 1e-9);
}

#[test]
fn margin_percent_negative_for_loss_leader() {
    assert!((margin_percent(-900, 1500) - (-60.0)).abs() < 1e-9);
}

#[test]
fn margin_percent_zero_total_is_zero() {
    assert_eq!(margin_percent(0, 0), 0.0);
    // Even a negative margin on a zero-total line (fully discounted)
    // reports 0% — no division by zero, no ±∞.
    assert_eq!(margin_percent(-5, 0), 0.0);
}

// ── query_sale_lines_with_margin ──────────────────────────────

#[test]
fn margin_query_empty_sale() {
    let conn = fresh();
    let rows = query_sale_lines_with_margin(&conn, "no-such-sale").unwrap();
    assert!(rows.is_empty());
}

#[test]
fn margin_query_enriches_lines_with_cost() {
    let conn = fresh();
    seed_product(&conn, "STEAK", 2500, 800);
    seed_product(&conn, "SODA", 300, 100);
    let sale_id = complete_sale(&conn, &[("STEAK", 2, 2500), ("SODA", 3, 300)]);

    let rows = query_sale_lines_with_margin(&conn, &sale_id).unwrap();
    assert_eq!(rows.len(), 2);

    let steak = &rows[0];
    assert_eq!(steak.sku, "STEAK");
    assert_eq!(steak.name, "STEAK");
    assert_eq!(steak.qty, 2);
    assert_eq!(steak.unit_price_minor, 2500);
    assert_eq!(steak.line_total_minor, 5000);
    assert_eq!(steak.unit_cost_minor, 800);
    assert_eq!(steak.margin_minor, 3400);
    assert!((steak.margin_percent - 68.0).abs() < 1e-9);

    let soda = &rows[1];
    assert_eq!(soda.line_total_minor, 900);
    assert_eq!(soda.margin_minor, 600);
    assert!((soda.margin_percent - 66.6666666667).abs() < 1e-6);
}

#[test]
fn margin_query_negative_when_cost_above_price() {
    let conn = fresh();
    seed_product(&conn, "LOSS", 500, 800);
    let sale_id = complete_sale(&conn, &[("LOSS", 3, 500)]);

    let rows = query_sale_lines_with_margin(&conn, &sale_id).unwrap();
    assert_eq!(rows[0].margin_minor, -900);
    assert!((rows[0].margin_percent - (-60.0)).abs() < 1e-9);
}

#[test]
fn margin_snapshot_is_frozen_after_cost_edit() {
    // Core HPP invariant: the per-line snapshot (written at checkout)
    // must survive a later cost edit — historical margins never change.
    let conn = fresh();
    seed_product(&conn, "STEAK", 2500, 800);
    let sale_id = complete_sale(&conn, &[("STEAK", 2, 2500)]);
    conn.execute(
        "UPDATE products SET cost_minor = 1500 WHERE sku = 'STEAK'",
        [],
    )
    .unwrap();

    let rows = query_sale_lines_with_margin(&conn, &sale_id).unwrap();
    assert_eq!(
        rows[0].unit_cost_minor, 800,
        "snapshot must not follow the edited HPP"
    );
    assert_eq!(rows[0].margin_minor, (2500 - 800) * 2);
}

#[test]
fn margin_falls_back_to_current_cost_when_snapshot_missing() {
    // Legacy / unset-cost sales have no snapshot: the report follows the
    // product's current cost (the documented fallback).
    let conn = fresh();
    seed_product(&conn, "NEW", 500, 0); // cost unset at sale time
    let sale_id = complete_sale(&conn, &[("NEW", 1, 500)]);
    conn.execute("UPDATE products SET cost_minor = 300 WHERE sku = 'NEW'", [])
        .unwrap();

    let rows = query_sale_lines_with_margin(&conn, &sale_id).unwrap();
    assert_eq!(
        rows[0].unit_cost_minor, 300,
        "unset-snapshot rows follow the current product cost"
    );
    assert_eq!(rows[0].margin_minor, 200);
}

#[test]
fn margin_query_zero_cost_falls_back() {
    let conn = fresh();
    // Product with no cost set: cost_minor stays NULL → 0.
    seed_product(&conn, "FREE", 500, 0);
    let sale_id = complete_sale(&conn, &[("FREE", 1, 500)]);

    let rows = query_sale_lines_with_margin(&conn, &sale_id).unwrap();
    assert_eq!(rows[0].unit_cost_minor, 0);
    assert_eq!(rows[0].margin_minor, 500);
    assert_eq!(rows[0].margin_percent, 100.0);
}

// ── Serde ─────────────────────────────────────────────────────

#[test]
fn sale_line_margin_serde_roundtrip() {
    let row = SaleLineMargin {
        sale_line_id: "sl-1".into(),
        sku: "COFFEE".into(),
        name: "Coffee".into(),
        qty: 2,
        unit_price_minor: 350,
        line_total_minor: 700,
        unit_cost_minor: 100,
        margin_minor: 500,
        margin_percent: 71.42857,
    };
    let json = serde_json::to_string(&row).unwrap();
    let back: SaleLineMargin = serde_json::from_str(&json).unwrap();
    assert_eq!(back.sku, "COFFEE");
    assert_eq!(back.margin_minor, 500);
    assert!((back.margin_percent - 71.42857).abs() < 1e-9);
}
