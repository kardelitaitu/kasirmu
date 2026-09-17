use super::*;
use rusqlite::Connection;

fn fresh() -> Connection {
    kasirmu_core::migrations::fresh_db()
}

fn make_customer(id: &str, name: &str) -> Customer {
    Customer {
        id: id.into(),
        name: name.into(),
        email: None,
        phone: None,
        loyalty_points: 0,
        total_spent_minor: 0,
        currency: "USD".into(),
        notes: String::new(),
        created_at: String::new(),
        updated_at: String::new(),
    }
}

#[test]
fn get_customer_returns_none_for_missing() {
    let conn = fresh();
    let repo = CrmRepository::new(&conn);
    assert!(repo.get_customer("nope").unwrap().is_none());
}

#[test]
fn get_customer_after_create() {
    let conn = fresh();
    let repo = CrmRepository::new(&conn);
    let c = make_customer("cust-1", "Alice");
    let tx = conn.unchecked_transaction().unwrap();
    repo.create_customer_tx(&tx, &c).unwrap();
    tx.commit().unwrap();

    let loaded = repo.get_customer("cust-1").unwrap().unwrap();
    assert_eq!(loaded.name, "Alice");
    assert_eq!(loaded.currency, "USD");
}

#[test]
fn get_customer_with_email_and_phone() {
    let conn = fresh();
    let repo = CrmRepository::new(&conn);
    let mut c = make_customer("cust-2", "Bob");
    c.email = Some(Email::new("bob@example.com").unwrap());
    c.phone = Some(Phone::new("+1-555-0102").unwrap());
    let tx = conn.unchecked_transaction().unwrap();
    repo.create_customer_tx(&tx, &c).unwrap();
    tx.commit().unwrap();

    let loaded = repo.get_customer("cust-2").unwrap().unwrap();
    assert_eq!(loaded.email.as_ref().unwrap().as_str(), "bob@example.com");
    assert_eq!(loaded.phone.as_ref().unwrap().as_str(), "+1-555-0102");
}

#[test]
fn create_customer_persists_loyalty_points() {
    let conn = fresh();
    let repo = CrmRepository::new(&conn);
    let mut c = make_customer("cust-3", "Carol");
    c.loyalty_points = 750;
    c.total_spent_minor = 50000;
    let tx = conn.unchecked_transaction().unwrap();
    repo.create_customer_tx(&tx, &c).unwrap();
    tx.commit().unwrap();

    let loaded = repo.get_customer("cust-3").unwrap().unwrap();
    assert_eq!(loaded.loyalty_points, 750);
    assert_eq!(loaded.total_spent_minor, 50000);
}
