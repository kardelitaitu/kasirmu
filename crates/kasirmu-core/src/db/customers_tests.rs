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

// ── MSL-44: an invalid email/phone must not be STORED ───────────

/// The store wrote the raw string to the column while every API surface
/// reported `None`, so the bad value persisted invisibly.
///
/// `create_customer` and `update_customer` both bind `email`/`phone` straight
/// into the INSERT/UPDATE, and only apply `Email::new(..).ok()` when building
/// the returned struct — so an invalid address is written to disk and then
/// reported as absent:
///
/// ```text
/// PROBE returned email      = None
/// PROBE stored   email      = Some("not-an-email")
/// PROBE read-back           = None
/// PROBE after-update stored = Some("also-bad")
/// ```
///
/// Every current caller validates first (the bridge's and tablet's
/// `validate_customer_fields`, and the CLI), so this is a latent trap rather
/// than a live wrong answer — but it is the worst kind: the type system says
/// the field is `None` in every direction while the column holds garbage, and
/// any future reader of the raw column (a report, an export, a sync push)
/// silently picks it up. The store already validates `name` itself, so it is
/// the right layer for these two as well.
#[test]
fn an_invalid_email_is_stored_as_null_not_verbatim() {
    let conn = fresh();
    let s = store(&conn);

    let c = s
        .create_customer("X", Some("not-an-email"), None, None)
        .unwrap();
    assert!(c.email.is_none(), "the API reports no email");

    // The COLUMN must agree with the API. Before the fix it held the raw string,
    // so a reader of the raw column saw a value every caller believed absent.
    let raw: Option<String> = conn
        .query_row(
            "SELECT email FROM customers WHERE id = ?1",
            rusqlite::params![c.id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        raw, None,
        "an unparseable email must be stored as NULL, not as the caller's raw string"
    );
    assert!(
        s.get_customer(&c.id).unwrap().unwrap().email.is_none(),
        "and the read path agrees"
    );
}

#[test]
fn an_invalid_phone_is_stored_as_null_not_verbatim() {
    let conn = fresh();
    let s = store(&conn);
    let c = s
        .create_customer("Bob", None, Some("+1-555-0102"), None)
        .unwrap();

    s.update_customer(&c.id, "Bob", None, Some("call me"), None)
        .unwrap();

    let raw: Option<String> = conn
        .query_row(
            "SELECT phone FROM customers WHERE id = ?1",
            rusqlite::params![c.id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        raw, None,
        "an unparseable phone must be stored as NULL, not as the caller's raw string"
    );
}

/// A valid value still round-trips verbatim, trimmed — the property the fix must
/// not break.
#[test]
fn a_valid_email_and_phone_are_stored_verbatim() {
    let conn = fresh();
    let s = store(&conn);
    let c = s
        .create_customer("Zoe", Some(" zoe@example.com "), Some("+1-555-0199"), None)
        .unwrap();

    assert_eq!(
        c.email.as_ref().map(ToString::to_string).as_deref(),
        Some("zoe@example.com")
    );
    assert_eq!(
        c.phone.as_ref().map(ToString::to_string).as_deref(),
        Some("+1-555-0199")
    );
    let (raw_e, raw_p): (Option<String>, Option<String>) = conn
        .query_row(
            "SELECT email, phone FROM customers WHERE id = ?1",
            rusqlite::params![c.id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(
        raw_e.as_deref(),
        Some("zoe@example.com"),
        "trimmed, not raw"
    );
    assert_eq!(raw_p.as_deref(), Some("+1-555-0199"));
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
/// COR-23: a blocked delete must NAME what is holding the row.
///
/// The reference guard is the FK itself (`sales.customer_id` and
/// `loyalty_accounts.customer_id`, both NO ACTION) and that is deliberate —
/// CUST-11 wants the delete blocked rather than cascading. What was missing is
/// only the reporting: the bare `DELETE` met a raw
/// `FOREIGN KEY constraint failed` and reached the client as `CoreError::Db`,
/// which names neither the customer nor the blocker, so a UI can only show a
/// storage fault. `Conflict` is the right variant over `NotFound` because the
/// customer genuinely exists.
#[test]
fn delete_customer_with_sales_is_a_named_conflict() {
    let conn = fresh();
    seed_customers(&conn);
    conn.execute(
        "INSERT INTO sales (id, total_minor, currency, line_count, status, customer_id,
                          created_at, updated_at, subtotal_minor, tax_total_minor)
         VALUES ('s-1', 2500, 'USD', 1, 'completed', 'cust-1',
                 '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z', 2500, 0)",
        [],
    )
    .unwrap();

    let err = store(&conn).delete_customer("cust-1").unwrap_err();
    let CoreError::Validation { field, message } = &err else {
        panic!("a blocked delete must be a typed Validation, not a raw FK error: {err:?}");
    };
    assert_eq!(
        *field, "customer_id",
        "the field names the blocker, not the entity"
    );
    assert!(
        message.contains("loyalty account") && message.contains("reassigned"),
        "the message must say what is holding the row and what to do: {message}"
    );
    // And the row survives — the guard still blocks, only the message changed.
    assert!(store(&conn).get_customer("cust-1").unwrap().is_some());
}

/// The loyalty half of the same guard, since it is a SECOND referrer and a
/// mapping that only covered `sales` would report this one as a raw DB error.
#[test]
fn delete_customer_with_a_loyalty_account_is_the_same_named_conflict() {
    let conn = fresh();
    seed_customers(&conn);
    store(&conn)
        .get_or_create_loyalty_account("cust-1")
        .unwrap();

    let err = store(&conn).delete_customer("cust-1").unwrap_err();
    assert!(
        matches!(&err, CoreError::Validation { field, .. } if *field == "customer_id"),
        "the loyalty referrer must produce the same typed refusal: {err:?}"
    );
    assert!(store(&conn).get_customer("cust-1").unwrap().is_some());
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
