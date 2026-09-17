use super::*;
use crate::migrations;
use rusqlite::Connection;

fn fresh() -> Connection {
    migrations::fresh_db()
}

fn store(conn: &Connection) -> Store<'_> {
    Store::new(conn)
}

fn seed_customers(conn: &Connection) {
    conn.execute_batch(
        "INSERT INTO customers (id, name, email, phone, notes, created_at, updated_at) VALUES
            ('cust-1', 'Alice',  'alice@example.com',  '+1-555-0101', 'Regular',   '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
            ('cust-2', 'Bob',    NULL,                 '+1-555-0102', '',          '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
            ('cust-3', 'Carol',  'carol@example.com',  NULL,          'VIP',       '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');"
    ).unwrap();
}

// ── List ────────────────────────────────────────────────────────

#[test]
fn list_customers_empty_db() {
    let conn = fresh();
    let customers = store(&conn).list_customers().unwrap();
    assert!(customers.is_empty());
}

#[test]
fn list_customers_returns_all() {
    let conn = fresh();
    seed_customers(&conn);
    let customers = store(&conn).list_customers().unwrap();
    assert_eq!(customers.len(), 3);
    assert_eq!(customers[0].name, "Alice");
    assert_eq!(customers[1].name, "Bob");
    assert_eq!(customers[2].name, "Carol");
}

// ── Get ─────────────────────────────────────────────────────────

#[test]
fn get_customer_found() {
    let conn = fresh();
    seed_customers(&conn);
    let c = store(&conn).get_customer("cust-1").unwrap().unwrap();
    assert_eq!(c.name, "Alice");
    assert_eq!(
        c.email.as_ref().map(|e| e.as_str()),
        Some("alice@example.com")
    );
    assert_eq!(c.phone.as_ref().map(|p| p.as_str()), Some("+1-555-0101"));
    assert_eq!(c.notes, "Regular");
}

#[test]
fn get_customer_not_found() {
    let conn = fresh();
    let c = store(&conn).get_customer("nope").unwrap();
    assert!(c.is_none());
}

#[test]
fn get_customer_nullable_fields() {
    let conn = fresh();
    seed_customers(&conn);
    let c = store(&conn).get_customer("cust-2").unwrap().unwrap();
    assert_eq!(c.name, "Bob");
    assert!(c.email.is_none());
    assert_eq!(c.phone.as_ref().map(|p| p.as_str()), Some("+1-555-0102"));
}

// ── Create ──────────────────────────────────────────────────────

#[test]
fn create_customer_minimal() {
    let conn = fresh();
    let c = store(&conn)
        .create_customer("Diana", None, None, None)
        .unwrap();
    assert_eq!(c.name, "Diana");
    assert!(c.email.is_none());
    assert!(c.phone.is_none());
    assert_eq!(c.notes, "");
    assert!(!c.id.is_empty());
}

#[test]
fn create_customer_with_all_fields() {
    let conn = fresh();
    let c = store(&conn)
        .create_customer(
            "Diana",
            Some("diana@test.com"),
            Some("555-0100"), // Phone needs digits; dashes alone won't parse
            Some("Preferred"),
        )
        .unwrap();
    assert_eq!(c.name, "Diana");
    assert_eq!(c.email.as_ref().map(|e| e.as_str()), Some("diana@test.com"));
    assert_eq!(c.phone.as_ref().map(|p| p.as_str()), Some("555-0100"));
    assert_eq!(c.notes, "Preferred");
    assert_eq!(c.loyalty_points, 0);
    assert_eq!(c.total_spent_minor, 0);
}

#[test]
fn create_customer_empty_name() {
    let conn = fresh();
    let err = store(&conn)
        .create_customer("   ", None, None, None)
        .unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "name"));
}

// ── Update ──────────────────────────────────────────────────────

#[test]
fn update_customer_basic() {
    let conn = fresh();
    seed_customers(&conn);
    let updated = store(&conn)
        .update_customer(
            "cust-1",
            "Alice Updated",
            Some("alice@new.com"),
            None,
            Some("Changed"),
        )
        .unwrap();
    assert_eq!(updated.name, "Alice Updated");
    assert_eq!(
        updated.email.as_ref().map(|e| e.as_str()),
        Some("alice@new.com")
    );
    assert_eq!(updated.notes, "Changed");
    assert!(updated.updated_at.as_str() > "2025-01-01");
}

#[test]
fn update_customer_not_found() {
    let conn = fresh();
    let err = store(&conn)
        .update_customer("nope", "X", None, None, None)
        .unwrap_err();
    assert!(matches!(err, CoreError::NotFound { .. }));
}

#[test]
fn update_customer_empty_name() {
    let conn = fresh();
    seed_customers(&conn);
    let err = store(&conn)
        .update_customer("cust-1", "", None, None, None)
        .unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "name"));
}

// ── Delete ──────────────────────────────────────────────────────

#[test]
fn delete_customer_removes_row() {
    let conn = fresh();
    seed_customers(&conn);
    store(&conn).delete_customer("cust-1").unwrap();
    let c = store(&conn).get_customer("cust-1").unwrap();
    assert!(c.is_none());
}

#[test]
fn delete_customer_not_found() {
    let conn = fresh();
    let err = store(&conn).delete_customer("nope").unwrap_err();
    assert!(matches!(err, CoreError::NotFound { .. }));
}

// ── Additional edge cases ─────────────────────────────────────

#[test]
fn list_customers_ordered_by_name() {
    let conn = fresh();
    // Seed out of alphabetical order.
    conn.execute_batch(
        "INSERT INTO customers (id, name, created_at, updated_at) VALUES
            ('c-z', 'Zara',  '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
            ('c-a', 'Alpha', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
            ('c-m', 'Mike',  '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');",
    )
    .unwrap();
    let customers = store(&conn).list_customers().unwrap();
    assert_eq!(customers.len(), 3);
    assert_eq!(customers[0].name, "Alpha");
    assert_eq!(customers[1].name, "Mike");
    assert_eq!(customers[2].name, "Zara");
}

#[test]
fn update_customer_clear_email_and_phone() {
    let conn = fresh();
    seed_customers(&conn);
    // cust-1 had email and phone; update to clear them.
    let updated = store(&conn)
        .update_customer("cust-1", "Alice", None, None, Some("Cleared fields"))
        .unwrap();
    assert_eq!(updated.name, "Alice");
    assert!(updated.email.is_none(), "email should be cleared");
    assert!(updated.phone.is_none(), "phone should be cleared");
    assert_eq!(updated.notes, "Cleared fields");
}

#[test]
fn create_customer_invalid_email_saved_as_none() {
    let conn = fresh();
    let c = store(&conn)
        .create_customer("Test", Some("not-an-email"), None, None)
        .unwrap();
    // Email::new("not-an-email") returns Err, so and_then returns None.
    assert!(c.email.is_none());
    assert_eq!(c.name, "Test");
}

// ── Search (CUST-06) ───────────────────────────────────────────

#[test]
fn search_customers_matches_name_email_and_phone() {
    let conn = fresh();
    seed_customers(&conn);

    let (by_name, total) = store(&conn).search_customers("Alice", 100, 0).unwrap();
    assert_eq!(total, 1);
    assert_eq!(by_name[0].id, "cust-1");

    let (by_email, _) = store(&conn)
        .search_customers("carol@example.com", 100, 0)
        .unwrap();
    assert_eq!(by_email.len(), 1);
    assert_eq!(by_email[0].id, "cust-3");

    let (by_phone, _) = store(&conn).search_customers("555-0102", 100, 0).unwrap();
    assert_eq!(by_phone.len(), 1);
    assert_eq!(by_phone[0].id, "cust-2");
}

#[test]
fn search_customers_is_bounded_and_paginated() {
    let conn = fresh();
    for i in 0..5 {
        conn.execute(
            "INSERT INTO customers (id, name, created_at, updated_at)
             VALUES (?1, ?2, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
            params![format!("c-{i}"), format!("Person {i}")],
        )
        .unwrap();
    }

    let (page1, total) = store(&conn).search_customers("Person", 2, 0).unwrap();
    assert_eq!(total, 5);
    assert_eq!(page1.len(), 2);

    let (page3, _) = store(&conn).search_customers("Person", 2, 4).unwrap();
    assert_eq!(page3.len(), 1);

    let (oversized, _) = store(&conn).search_customers("Person", 10_000, 0).unwrap();
    assert!(oversized.len() <= 100, "limit must be clamped to 100");
}

#[test]
fn search_customers_literal_wildcards_are_escaped() {
    let conn = fresh();
    seed_customers(&conn);
    conn.execute(
        "INSERT INTO customers (id, name, created_at, updated_at)
         VALUES ('c-pct', '100%', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
        [],
    )
    .unwrap();

    // Escaped: a bare % matches only rows with a literal %, never all.
    let (items, total) = store(&conn).search_customers("%", 100, 0).unwrap();
    assert_eq!(total, 1, "a bare % must not broaden to every row");
    assert_eq!(items[0].id, "c-pct");

    // Same for the single-char wildcard _: no customer name contains a
    // literal underscore, so an escaped _ matches nothing (it must not
    // broaden to match every row).
    let (items, total) = store(&conn).search_customers("_", 100, 0).unwrap();
    assert_eq!(total, 0, "a bare _ must not broaden to every row");
    assert!(items.is_empty());

    let (items, _) = store(&conn).search_customers("100%", 100, 0).unwrap();
    assert_eq!(items.len(), 1);
}

#[test]
fn search_customers_empty_query_returns_all_bounded() {
    let conn = fresh();
    seed_customers(&conn);
    let (items, total) = store(&conn).search_customers("", 100, 0).unwrap();
    assert_eq!(total, 3);
    assert_eq!(items.len(), 3);
}

#[test]
fn search_customers_no_match_returns_empty() {
    let conn = fresh();
    seed_customers(&conn);
    let (items, total) = store(&conn)
        .search_customers("zzz-no-such", 100, 0)
        .unwrap();
    assert!(items.is_empty());
    assert_eq!(total, 0);
}
