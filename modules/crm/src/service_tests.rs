use super::*;
use rusqlite::Connection;

fn fresh() -> Connection {
    kasirmu_core::migrations::fresh_db()
}

#[test]
fn get_customer_delegates_to_repository() {
    let conn = fresh();
    conn.execute(
        "INSERT INTO customers (id, name, currency) VALUES ('c-1', 'Alice', 'USD')",
        [],
    )
    .unwrap();
    let c = CrmService::get_customer(&conn, "c-1").unwrap().unwrap();
    assert_eq!(c.name, "Alice");
}

#[test]
fn get_customer_missing_returns_none() {
    let conn = fresh();
    assert!(CrmService::get_customer(&conn, "nope").unwrap().is_none());
}

#[test]
fn create_customer_persists() {
    let mut conn = fresh();
    let c = Customer {
        id: "c-2".into(),
        name: "Bob".into(),
        email: None,
        phone: None,
        loyalty_points: 0,
        total_spent_minor: 0,
        currency: "USD".into(),
        notes: String::new(),
        created_at: String::new(),
        updated_at: String::new(),
    };
    CrmService::create_customer(&mut conn, &c).unwrap();
    let loaded = CrmService::get_customer(&conn, "c-2").unwrap().unwrap();
    assert_eq!(loaded.name, "Bob");
}
