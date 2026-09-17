use super::*;
use rusqlite::Connection;

fn fresh() -> Connection {
    kasirmu_core::migrations::fresh_db()
}

#[test]
fn get_tax_rate_delegates_to_repository() {
    let conn = fresh();
    conn.execute(
        "INSERT INTO tax_rates (id, name, rate_bps, is_default, is_active) VALUES ('t-1', 'VAT', 2100, 1, 1)",
        [],
    )
    .unwrap();
    let rate = TaxService::get_tax_rate(&conn, "t-1").unwrap().unwrap();
    assert_eq!(rate.name, "VAT");
}

#[test]
fn get_tax_rate_missing_returns_none() {
    let conn = fresh();
    assert!(TaxService::get_tax_rate(&conn, "nope").unwrap().is_none());
}

#[test]
fn list_tax_rates_delegates_to_repository() {
    let conn = fresh();
    conn.execute(
        "INSERT INTO tax_rates (id, name, rate_bps, is_default, is_active) VALUES ('t-1', 'Tax', 500, 0, 1)",
        [],
    )
    .unwrap();
    let rates = TaxService::list_tax_rates(&conn).unwrap();
    assert_eq!(rates.len(), 1);
}
