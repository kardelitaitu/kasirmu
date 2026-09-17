use super::*;
use rusqlite::Connection;

fn fresh() -> Connection {
    kasirmu_core::migrations::fresh_db()
}

fn seed_customer(conn: &Connection, id: &str, name: &str) {
    conn.execute(
        "INSERT INTO customers (id, name) VALUES (?1, ?2)",
        rusqlite::params![id, name],
    )
    .unwrap();
}

#[test]
fn get_account_delegates_to_repository() {
    let conn = fresh();
    seed_customer(&conn, "cust-1", "Alice");
    conn.execute(
        "INSERT INTO loyalty_accounts (id, customer_id, points, lifetime_points) VALUES ('a-1', 'cust-1', 300, 1500)",
        [],
    )
    .unwrap();
    let acct = LoyaltyService::get_account_by_customer(&conn, "cust-1")
        .unwrap()
        .unwrap();
    assert_eq!(acct.points, 300);
}

#[test]
fn get_account_missing_returns_none() {
    let conn = fresh();
    assert!(
        LoyaltyService::get_account_by_customer(&conn, "nobody")
            .unwrap()
            .is_none()
    );
}

#[test]
fn get_gift_card_delegates_to_repository() {
    let conn = fresh();
    conn.execute(
        "INSERT INTO gift_cards (id, card_number, pin, initial_balance_minor, current_balance_minor, currency, status, issued_to, issue_date, updated_at)
         VALUES ('gc-1', '1111', '', 25000, 25000, 'IDR', 'active', '', '2025-01-01', '2025-01-01')",
        [],
    )
    .unwrap();
    let card = LoyaltyService::get_gift_card(&conn, "1111")
        .unwrap()
        .unwrap();
    assert_eq!(card.card_number, "1111");
}

#[test]
fn get_gift_card_missing_returns_none() {
    let conn = fresh();
    assert!(
        LoyaltyService::get_gift_card(&conn, "0000")
            .unwrap()
            .is_none()
    );
}
