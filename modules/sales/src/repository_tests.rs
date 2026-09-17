//! Sibling unit tests for `repository.rs` (AGENTS.md: no tests in production files).

use super::*;

use foundation::{Cart, CartLine, Sku};
use rusqlite::Connection;

fn fresh() -> Connection {
    kasirmu_core::migrations::fresh_db()
}

fn usd() -> Currency {
    "USD".parse().unwrap()
}

fn sample_sale() -> Sale {
    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(
        Sku::new("COFFEE"),
        2,
        Money {
            minor_units: 350,
            currency: usd(),
        },
    ))
    .unwrap();
    cart.add_line(CartLine::new(
        Sku::new("CAKE"),
        1,
        Money {
            minor_units: 500,
            currency: usd(),
        },
    ))
    .unwrap();
    Sale::from_cart_with_user(&cart, Some("u-42".to_string())).unwrap()
}

#[test]
fn get_sale_missing_returns_none() {
    let conn = fresh();
    let repo = SalesRepository::new(&conn);
    assert!(repo.get_sale("does-not-exist").unwrap().is_none());
}

#[test]
fn create_sale_then_get_roundtrip() {
    let mut conn = fresh();
    let mut sale = sample_sale();
    sale.payment_method = Some("cash".to_string());
    sale.tendered_minor = Some(1500);

    let tx = conn.transaction().unwrap();
    SalesRepository::new(&tx)
        .create_sale_tx(&tx, &sale)
        .unwrap();
    tx.commit().unwrap();

    let repo = SalesRepository::new(&conn);
    let fetched = repo.get_sale(&sale.id).unwrap().expect("sale must exist");

    assert_eq!(fetched.id, sale.id);
    assert_eq!(fetched.status, sale.status);
    assert_eq!(fetched.total, sale.total);
    assert_eq!(fetched.currency, sale.currency);
    assert_eq!(fetched.line_count, 2);
    assert_eq!(fetched.payment_method.as_deref(), Some("cash"));
    assert_eq!(fetched.tendered_minor, Some(1500));
    assert_eq!(fetched.user_id.as_deref(), Some("u-42"));
    assert_eq!(fetched.version, 1);
    assert_eq!(fetched.lines.len(), 2);
    assert_eq!(fetched.lines[0].sku, "COFFEE");
    assert_eq!(fetched.lines[0].qty, 2);
    assert_eq!(fetched.lines[0].line_position, 1);
    assert_eq!(fetched.lines[0].unit_price.minor_units, 350);
    assert_eq!(fetched.lines[0].line_total.minor_units, 700);
    assert_eq!(fetched.lines[1].sku, "CAKE");
    assert_eq!(fetched.lines[1].line_position, 2);
    assert_eq!(fetched.lines[1].line_total.minor_units, 500);
}

#[test]
fn create_sale_persists_tax_and_breakdown_fields() {
    let mut conn = fresh();
    // tax_rate_id has a FK to tax_rates(id), so seed a matching row.
    conn.execute(
            "INSERT INTO tax_rates (id, name, rate_bps, is_default) VALUES ('rate-1', 'Sales Tax', 1000, 1)",
            [],
        )
        .unwrap();
    let mut sale = sample_sale();
    sale.lines[0].tax_amount = Money {
        minor_units: 35,
        currency: usd(),
    };
    sale.lines[0].tax_rate_id = Some("rate-1".to_string());
    sale.lines[0].tax_breakdown_json =
        Some("[{\"rate_id\":\"rate-1\",\"rate_bps\":1000}]".to_string());
    sale.lines[0].serial_number = Some("SN-123".to_string());
    sale.lines[0].course = Some("main".to_string());
    sale.lines[0].modifiers_json = Some("[{\"name\":\"Temp\",\"choice\":\"Hot\"}]".to_string());

    let tx = conn.transaction().unwrap();
    SalesRepository::new(&tx)
        .create_sale_tx(&tx, &sale)
        .unwrap();
    tx.commit().unwrap();

    let repo = SalesRepository::new(&conn);
    let fetched = repo.get_sale(&sale.id).unwrap().unwrap();
    assert_eq!(fetched.lines[0].tax_amount.minor_units, 35);
    assert_eq!(fetched.lines[0].tax_rate_id.as_deref(), Some("rate-1"));
    assert_eq!(
        fetched.lines[0].tax_breakdown_json.as_deref(),
        Some("[{\"rate_id\":\"rate-1\",\"rate_bps\":1000}]")
    );
    assert_eq!(fetched.lines[0].serial_number.as_deref(), Some("SN-123"));
    assert_eq!(fetched.lines[0].course.as_deref(), Some("main"));
    assert_eq!(
        fetched.lines[0].modifiers_json.as_deref(),
        Some("[{\"name\":\"Temp\",\"choice\":\"Hot\"}]")
    );
}

#[test]
fn get_sale_orders_lines_by_position() {
    let mut conn = fresh();
    let mut sale = sample_sale();
    // Reverse positions in memory to prove the query orders on read.
    sale.lines.reverse();
    let tx = conn.transaction().unwrap();
    SalesRepository::new(&tx)
        .create_sale_tx(&tx, &sale)
        .unwrap();
    tx.commit().unwrap();

    let repo = SalesRepository::new(&conn);
    let fetched = repo.get_sale(&sale.id).unwrap().unwrap();
    assert_eq!(fetched.lines[0].sku, "COFFEE");
    assert_eq!(fetched.lines[0].line_position, 1);
    assert_eq!(fetched.lines[1].sku, "CAKE");
    assert_eq!(fetched.lines[1].line_position, 2);
}

#[test]
fn get_sale_rejects_invalid_currency() {
    let mut conn = fresh();
    let sale = sample_sale();
    let tx = conn.transaction().unwrap();
    SalesRepository::new(&tx)
        .create_sale_tx(&tx, &sale)
        .unwrap();
    tx.commit().unwrap();

    // Corrupt the currency code so parsing fails on read.
    conn.execute(
        "UPDATE sales SET currency = 'ZZ' WHERE id = ?1",
        params![sale.id],
    )
    .unwrap();

    let repo = SalesRepository::new(&conn);
    assert!(repo.get_sale(&sale.id).is_err());
}

#[test]
fn update_sale_status_changes_status_and_bumps_version() {
    let mut conn = fresh();
    let sale = sample_sale();
    let tx = conn.transaction().unwrap();
    SalesRepository::new(&tx)
        .create_sale_tx(&tx, &sale)
        .unwrap();
    tx.commit().unwrap();

    let repo = SalesRepository::new(&conn);
    repo.update_sale_status(&sale.id, SaleStatus::Voided)
        .unwrap();

    let fetched = repo.get_sale(&sale.id).unwrap().unwrap();
    assert_eq!(fetched.status, SaleStatus::Voided);
    assert_eq!(fetched.version, 2);
}

#[test]
fn update_sale_status_missing_id_is_noop() {
    let conn = fresh();
    let repo = SalesRepository::new(&conn);
    let result = repo.update_sale_status("missing", SaleStatus::Voided);
    assert!(result.is_ok());
}
