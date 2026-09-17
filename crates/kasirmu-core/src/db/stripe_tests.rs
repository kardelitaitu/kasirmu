use super::*;
use crate::migrations;
use rusqlite::Connection;

fn fresh() -> Connection {
    migrations::fresh_db()
}

fn store(conn: &Connection) -> Store<'_> {
    Store::new(conn)
}

#[test]
fn set_then_get_roundtrips() {
    let conn = fresh();
    let s = store(&conn);
    s.set_stripe_customer("cus_123", "tenant-a").unwrap();
    assert_eq!(
        s.get_tenant_for_stripe_customer("cus_123").unwrap(),
        Some("tenant-a".to_string())
    );
}

#[test]
fn unknown_customer_returns_none() {
    let conn = fresh();
    let s = store(&conn);
    assert_eq!(s.get_tenant_for_stripe_customer("cus_nope").unwrap(), None);
}

#[test]
fn upsert_moves_customer_to_new_tenant() {
    let conn = fresh();
    let s = store(&conn);
    s.set_stripe_customer("cus_123", "tenant-a").unwrap();
    s.set_stripe_customer("cus_123", "tenant-b").unwrap();
    assert_eq!(
        s.get_tenant_for_stripe_customer("cus_123").unwrap(),
        Some("tenant-b".to_string()),
        "re-mapping must overwrite the previous tenant"
    );
}
