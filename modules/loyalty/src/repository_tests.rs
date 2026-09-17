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

fn seed_loyalty_account(
    conn: &Connection,
    id: &str,
    customer_id: &str,
    points: i64,
    lifetime: i64,
) {
    conn.execute(
        "INSERT INTO loyalty_accounts (id, customer_id, points, lifetime_points) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![id, customer_id, points, lifetime],
    )
    .unwrap();
}

fn seed_gift_card(conn: &Connection, id: &str, card_number: &str, balance: i64, currency: &str) {
    conn.execute(
        "INSERT INTO gift_cards (id, card_number, pin, initial_balance_minor, current_balance_minor, currency, status, issued_to, issue_date, updated_at)
         VALUES (?1, ?2, '', ?3, ?3, ?4, 'active', '', '2025-01-01', '2025-01-01')",
        rusqlite::params![id, card_number, balance, currency],
    )
    .unwrap();
}

#[test]
fn get_account_by_customer_returns_none_for_missing() {
    let conn = fresh();
    let repo = LoyaltyRepository::new(&conn);
    assert!(repo.get_account_by_customer("nope").unwrap().is_none());
}

#[test]
fn get_account_by_customer_roundtrip() {
    let conn = fresh();
    seed_customer(&conn, "cust-1", "Alice");
    seed_loyalty_account(&conn, "acct-1", "cust-1", 500, 2000);
    let repo = LoyaltyRepository::new(&conn);

    let acct = repo.get_account_by_customer("cust-1").unwrap().unwrap();
    assert_eq!(acct.id, "acct-1");
    assert_eq!(acct.customer_id, "cust-1");
    assert_eq!(acct.points, 500);
    assert_eq!(acct.lifetime_points, 2000);
}

#[test]
fn get_account_by_customer_with_tier() {
    let conn = fresh();
    seed_customer(&conn, "cust-2", "Bob");
    conn.execute(
        "INSERT INTO loyalty_accounts (id, customer_id, points, lifetime_points, tier_id) VALUES ('acct-2', 'cust-2', 100, 1000, 'tier-gold')",
        [],
    )
    .unwrap();
    let repo = LoyaltyRepository::new(&conn);
    let acct = repo.get_account_by_customer("cust-2").unwrap().unwrap();
    assert_eq!(acct.tier_id.as_deref(), Some("tier-gold"));
}

#[test]
fn get_gift_card_by_number_returns_none_for_missing() {
    let conn = fresh();
    let repo = LoyaltyRepository::new(&conn);
    assert!(repo.get_gift_card_by_number("0000-0000").unwrap().is_none());
}

#[test]
fn get_gift_card_by_number_roundtrip() {
    let conn = fresh();
    seed_gift_card(&conn, "gc-1", "1234-5678", 50000, "IDR");
    let repo = LoyaltyRepository::new(&conn);

    let card = repo.get_gift_card_by_number("1234-5678").unwrap().unwrap();
    assert_eq!(card.id, "gc-1");
    assert_eq!(card.card_number, "1234-5678");
    assert_eq!(card.current_balance_minor, 50000);
    assert_eq!(card.currency, "IDR");
    assert_eq!(card.status, "active");
}

#[test]
fn get_gift_card_by_number_with_expiry() {
    let conn = fresh();
    conn.execute(
        "INSERT INTO gift_cards (id, card_number, pin, initial_balance_minor, current_balance_minor, currency, status, issued_to, issue_date, expiry_date, updated_at)
         VALUES ('gc-2', '9999', '', 10000, 5000, 'USD', 'active', 'John', '2025-01-01', '2026-01-01', '2025-06-01')",
        [],
    )
    .unwrap();
    let repo = LoyaltyRepository::new(&conn);
    let card = repo.get_gift_card_by_number("9999").unwrap().unwrap();
    assert_eq!(card.expiry_date.as_deref(), Some("2026-01-01"));
}
