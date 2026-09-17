//! Sibling unit tests for `service.rs` (AGENTS.md: no tests in production files).

use super::*;

use foundation::{Cart, CartLine, Sku};

fn usd() -> foundation::Currency {
    "USD".parse().unwrap()
}

fn cart_with_line() -> Cart {
    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(
        Sku::new("COFFEE"),
        2,
        foundation::Money {
            minor_units: 350,
            currency: usd(),
        },
    ))
    .unwrap();
    cart
}

fn fresh_conn() -> rusqlite::Connection {
    kasirmu_core::migrations::fresh_db()
}

#[test]
fn process_checkout_persists_completed_sale() {
    let mut conn = fresh_conn();
    let sale = SalesService::process_checkout(
        &mut conn,
        &cart_with_line(),
        Some("u-1".to_string()),
        "cash".to_string(),
    )
    .unwrap();

    assert_eq!(sale.status, SaleStatus::Completed);
    assert_eq!(sale.payment_method.as_deref(), Some("cash"));
    assert_eq!(sale.total.minor_units, 700);

    // Read back from the DB through the service.
    let fetched = SalesService::get_sale(&conn, &sale.id).unwrap().unwrap();
    assert_eq!(fetched.id, sale.id);
    assert_eq!(fetched.status, SaleStatus::Completed);
    assert_eq!(fetched.total.minor_units, 700);
    assert_eq!(fetched.line_count, 1);
    assert_eq!(fetched.lines.len(), 1);
    assert_eq!(fetched.lines[0].sku, "COFFEE");
}

#[test]
fn process_checkout_without_user_id() {
    let mut conn = fresh_conn();
    let sale =
        SalesService::process_checkout(&mut conn, &cart_with_line(), None, "card".to_string())
            .unwrap();
    assert_eq!(sale.payment_method.as_deref(), Some("card"));
    assert!(sale.user_id.is_none());
}

#[test]
fn get_sale_via_service_missing_returns_none() {
    let conn = fresh_conn();
    assert!(SalesService::get_sale(&conn, "missing").unwrap().is_none());
}

#[test]
fn void_sale_marks_active_sale_voided() {
    let conn = fresh_conn();
    // MSL-2 fix: only Active→Voided is legal. Seed an Active sale
    // directly through the repository (process_checkout emits Completed
    // sales, which must go through the refund flow, not void_sale).
    let sale = Sale::from_cart_with_user(&cart_with_line(), None).unwrap();
    {
        let repo = SalesRepository::new(&conn);
        let tx = conn.unchecked_transaction().unwrap();
        repo.create_sale_tx(&tx, &sale).unwrap();
        tx.commit().unwrap();
    }
    SalesRepository::new(&conn)
        .update_sale_status(&sale.id, SaleStatus::Active)
        .unwrap();

    SalesService::void_sale(&conn, &sale.id).unwrap();

    let fetched = SalesService::get_sale(&conn, &sale.id).unwrap().unwrap();
    assert_eq!(fetched.status, SaleStatus::Voided);
    assert!(fetched.is_terminal());
}

#[test]
fn void_sale_not_found_errors() {
    let conn = fresh_conn();
    let err = SalesService::void_sale(&conn, "missing").unwrap_err();
    assert!(err.to_string().contains("missing"));
}

#[test]
fn void_sale_already_voided_errors() {
    let conn = fresh_conn();
    let sale = Sale::from_cart_with_user(&cart_with_line(), None).unwrap();
    {
        let repo = SalesRepository::new(&conn);
        let tx = conn.unchecked_transaction().unwrap();
        repo.create_sale_tx(&tx, &sale).unwrap();
        tx.commit().unwrap();
    }
    SalesRepository::new(&conn)
        .update_sale_status(&sale.id, SaleStatus::Active)
        .unwrap();
    SalesService::void_sale(&conn, &sale.id).unwrap();

    let err = SalesService::void_sale(&conn, &sale.id).unwrap_err();
    assert!(err.to_string().contains("already voided"));
}

#[test]
fn void_sale_completed_errors_routes_to_refund_flow() {
    // MSL-2 fix: process_checkout emits Completed sales; voiding one is
    // now rejected (Completed→Voided is not in the transition matrix) —
    // the refund flow is the route for completed sales.
    let mut conn = fresh_conn();
    let sale =
        SalesService::process_checkout(&mut conn, &cart_with_line(), None, "cash".to_string())
            .unwrap();

    let err = SalesService::void_sale(&conn, &sale.id).unwrap_err();
    assert!(err.to_string().contains("refund flow"));
}
