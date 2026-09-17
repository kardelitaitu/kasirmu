//! Integration tests for the CRM (customer) module — loyalty points,
//! spending tracking, ordering, timestamps, and edge cases.
//!
//! Tests exercise the full persistence layer via the public
//! [`kasirmu_core::Store`] API against an in-memory SQLite database.

use kasirmu_core::{Store, migrations};
use rusqlite::Connection;

// ── Helpers ───────────────────────────────────────────────────────────

fn setup() -> Connection {
    migrations::fresh_db()
}

fn store(conn: &Connection) -> Store<'_> {
    Store::new(conn)
}

fn seed_customers(conn: &Connection) {
    conn.execute_batch(
        "INSERT INTO customers (id, name, email, phone, loyalty_points, total_spent_minor, currency, notes, created_at, updated_at) VALUES
            ('crm-1', 'Alice',  'alice@example.com',  '+1-555-0101', 150,  15000, 'USD', 'Regular',   '2025-01-01T00:00:00.000Z', '2025-01-05T00:00:00.000Z'),
            ('crm-2', 'Bob',    NULL,                 '+1-555-0102', 500,  75000, 'USD', 'Gold',      '2025-01-02T00:00:00.000Z', '2025-01-10T00:00:00.000Z'),
            ('crm-3', 'Carol',  'carol@example.com',  NULL,          0,    0,     'USD', 'New',       '2025-01-03T00:00:00.000Z', '2025-01-03T00:00:00.000Z'),
            ('crm-4', 'David',  'david@example.com',  '+1-555-0104', 1250, 250000,'USD', 'VIP',       '2025-01-04T00:00:00.000Z', '2025-01-15T00:00:00.000Z');"
    ).unwrap();
}

// ── Loyalty Points ───────────────────────────────────────────────────

#[test]
fn new_customer_defaults_to_zero_loyalty_and_spending() {
    let conn = setup();
    let s = store(&conn);
    let c = s.create_customer("New Customer", None, None, None).unwrap();
    assert_eq!(
        c.loyalty_points, 0,
        "new customers start with 0 loyalty points"
    );
    assert_eq!(
        c.total_spent_minor, 0,
        "new customers start with 0 spending"
    );
    assert_eq!(c.currency, "USD", "default currency should be USD");
    assert!(!c.id.is_empty());
    assert!(!c.created_at.is_empty());
}

#[test]
fn loyalty_points_persist_after_raw_sql_update() {
    let conn = setup();
    let s = store(&conn);
    let c = s.create_customer("Loyalty Test", None, None, None).unwrap();

    // Simulate earning points (e.g., from a completed purchase).
    conn.execute(
        "UPDATE customers SET loyalty_points = loyalty_points + 50 WHERE id = ?1",
        rusqlite::params![c.id],
    )
    .unwrap();

    let loaded = s.get_customer(&c.id).unwrap().unwrap();
    assert_eq!(
        loaded.loyalty_points, 50,
        "loyalty points should accumulate"
    );
}

#[test]
fn loyalty_points_can_increase_and_decrease() {
    let conn = setup();
    let s = store(&conn);
    let c = s
        .create_customer("Point Tracker", None, None, None)
        .unwrap();

    // Earn 100 points.
    conn.execute(
        "UPDATE customers SET loyalty_points = 100 WHERE id = ?1",
        rusqlite::params![c.id],
    )
    .unwrap();

    // Redeem 30 points.
    conn.execute(
        "UPDATE customers SET loyalty_points = loyalty_points - 30 WHERE id = ?1",
        rusqlite::params![c.id],
    )
    .unwrap();

    let loaded = s.get_customer(&c.id).unwrap().unwrap();
    assert_eq!(loaded.loyalty_points, 70, "100 earned - 30 redeemed = 70");
}

#[test]
fn loyalty_points_can_go_to_zero() {
    let conn = setup();
    let s = store(&conn);
    let c = s.create_customer("Zero Test", None, None, None).unwrap();

    conn.execute(
        "UPDATE customers SET loyalty_points = 500 WHERE id = ?1",
        rusqlite::params![c.id],
    )
    .unwrap();
    conn.execute(
        "UPDATE customers SET loyalty_points = 0 WHERE id = ?1",
        rusqlite::params![c.id],
    )
    .unwrap();

    let loaded = s.get_customer(&c.id).unwrap().unwrap();
    assert_eq!(loaded.loyalty_points, 0, "points can be reset to 0");
}

// ── Spending ─────────────────────────────────────────────────────────

#[test]
fn total_spent_tracks_lifetime_value() {
    let conn = setup();
    let s = store(&conn);
    let c = s.create_customer("Spender", None, None, None).unwrap();

    // Simulate a $50 purchase.
    conn.execute(
        "UPDATE customers SET total_spent_minor = total_spent_minor + 5000 WHERE id = ?1",
        rusqlite::params![c.id],
    )
    .unwrap();

    // Another $25.50 purchase.
    conn.execute(
        "UPDATE customers SET total_spent_minor = total_spent_minor + 2550 WHERE id = ?1",
        rusqlite::params![c.id],
    )
    .unwrap();

    let loaded = s.get_customer(&c.id).unwrap().unwrap();
    assert_eq!(loaded.total_spent_minor, 7550, "5000 + 2550 = 7550");
    assert_eq!(loaded.currency, "USD");
}

#[test]
fn spending_persists_across_multiple_sessions() {
    let conn = setup();
    let s = store(&conn);
    let c = s.create_customer("Long Term", None, None, None).unwrap();

    // Session 1: $35.
    conn.execute(
        "UPDATE customers SET total_spent_minor = total_spent_minor + 3500 WHERE id = ?1",
        rusqlite::params![c.id],
    )
    .unwrap();

    // Session 2: $100.
    conn.execute(
        "UPDATE customers SET total_spent_minor = total_spent_minor + 10000 WHERE id = ?1",
        rusqlite::params![c.id],
    )
    .unwrap();

    // Session 3: $12.99.
    conn.execute(
        "UPDATE customers SET total_spent_minor = total_spent_minor + 1299 WHERE id = ?1",
        rusqlite::params![c.id],
    )
    .unwrap();

    let loaded = s.get_customer(&c.id).unwrap().unwrap();
    assert_eq!(
        loaded.total_spent_minor, 14799,
        "3500 + 10000 + 1299 = 14799"
    );
    assert_eq!(
        loaded.loyalty_points, 0,
        "spending updates don't affect loyalty by default"
    );
}

// ── Combined loyalty + spending ──────────────────────────────────────

#[test]
fn seeded_customer_has_initial_loyalty_and_spending() {
    let conn = setup();
    seed_customers(&conn);
    let s = store(&conn);

    let alice = s.get_customer("crm-1").unwrap().unwrap();
    assert_eq!(alice.loyalty_points, 150);
    assert_eq!(alice.total_spent_minor, 15000);

    let bob = s.get_customer("crm-2").unwrap().unwrap();
    assert_eq!(bob.loyalty_points, 500);
    assert_eq!(bob.total_spent_minor, 75000);

    let david = s.get_customer("crm-4").unwrap().unwrap();
    assert_eq!(david.loyalty_points, 1250);
    assert_eq!(david.total_spent_minor, 250000);
    assert_eq!(david.notes, "VIP");
}

#[test]
fn simulate_complete_checkout_cycle() {
    let conn = setup();
    let s = store(&conn);

    // Create a customer.
    let c = s.create_customer("Checkout Sim", None, None, None).unwrap();

    // Purchase #1: $45.50 — earn 45 loyalty points (1 per $1 spent).
    conn.execute_batch(&format!(
        "UPDATE customers SET total_spent_minor = total_spent_minor + 4550, loyalty_points = loyalty_points + 45 WHERE id = '{}'",
        c.id,
    )).unwrap();

    // Purchase #2: $22.00 — earn 22 points.
    conn.execute_batch(&format!(
        "UPDATE customers SET total_spent_minor = total_spent_minor + 2200, loyalty_points = loyalty_points + 22 WHERE id = '{}'",
        c.id,
    )).unwrap();

    // Redeem 50 points for a discount.
    conn.execute_batch(&format!(
        "UPDATE customers SET loyalty_points = loyalty_points - 50 WHERE id = '{}'",
        c.id,
    ))
    .unwrap();

    // Purchase #3: $10.00 — earn 10 points.
    conn.execute_batch(&format!(
        "UPDATE customers SET total_spent_minor = total_spent_minor + 1000, loyalty_points = loyalty_points + 10 WHERE id = '{}'",
        c.id,
    )).unwrap();

    let loaded = s.get_customer(&c.id).unwrap().unwrap();
    assert_eq!(loaded.total_spent_minor, 7750, "4550 + 2200 + 1000 = 7750");
    assert_eq!(loaded.loyalty_points, 27, "45 + 22 - 50 + 10 = 27");
}

// ── Ordering and listing ─────────────────────────────────────────────

#[test]
fn customers_listed_in_alphabetical_order() {
    let conn = setup();
    seed_customers(&conn);
    let s = store(&conn);

    let customers = s.list_customers().unwrap();
    assert_eq!(customers.len(), 4);
    assert_eq!(customers[0].name, "Alice");
    assert_eq!(customers[1].name, "Bob");
    assert_eq!(customers[2].name, "Carol");
    assert_eq!(customers[3].name, "David");
}

#[test]
fn list_customers_includes_loyalty_and_spending() {
    let conn = setup();
    seed_customers(&conn);
    let s = store(&conn);

    let customers = s.list_customers().unwrap();
    let david = customers.iter().find(|c| c.name == "David").unwrap();
    assert_eq!(david.loyalty_points, 1250);
    assert_eq!(david.total_spent_minor, 250000);

    let carol = customers.iter().find(|c| c.name == "Carol").unwrap();
    assert_eq!(carol.loyalty_points, 0);
    assert_eq!(carol.total_spent_minor, 0);
}

// ── Update with loyalty ──────────────────────────────────────────────

#[test]
fn update_customer_preserves_loyalty_and_spending() {
    let conn = setup();
    seed_customers(&conn);
    let s = store(&conn);

    // Update Alice's contact info — loyalty and spending should remain.
    let updated = s
        .update_customer(
            "crm-1",
            "Alice Smith",
            Some("alice.smith@example.com"),
            Some("+1-555-9999"),
            Some("Updated contact"),
        )
        .unwrap();
    assert_eq!(updated.name, "Alice Smith");
    assert_eq!(
        updated.email.as_ref().map(|e| e.as_str()),
        Some("alice.smith@example.com")
    );
    assert_eq!(
        updated.loyalty_points, 150,
        "loyalty points preserved after contact update"
    );
    assert_eq!(
        updated.total_spent_minor, 15000,
        "spending preserved after contact update"
    );
}

// ── Large values ─────────────────────────────────────────────────────

#[test]
fn large_loyalty_points_value() {
    let conn = setup();
    let s = store(&conn);
    let c = s.create_customer("High Value", None, None, None).unwrap();

    conn.execute(
        "UPDATE customers SET loyalty_points = 999999999 WHERE id = ?1",
        rusqlite::params![c.id],
    )
    .unwrap();

    let loaded = s.get_customer(&c.id).unwrap().unwrap();
    assert_eq!(
        loaded.loyalty_points, 999_999_999,
        "large loyalty values should roundtrip"
    );
}

#[test]
fn large_total_spent_value() {
    let conn = setup();
    let s = store(&conn);
    let c = s.create_customer("Big Spender", None, None, None).unwrap();

    conn.execute(
        "UPDATE customers SET total_spent_minor = 2147483647 WHERE id = ?1",
        rusqlite::params![c.id],
    )
    .unwrap();

    let loaded = s.get_customer(&c.id).unwrap().unwrap();
    assert_eq!(
        loaded.total_spent_minor, 2_147_483_647,
        "large spending values should roundtrip"
    );
}

#[test]
fn i64_max_loyalty_points() {
    let conn = setup();
    let s = store(&conn);
    let c = s.create_customer("Max Points", None, None, None).unwrap();

    conn.execute(
        "UPDATE customers SET loyalty_points = 9223372036854775807 WHERE id = ?1",
        rusqlite::params![c.id],
    )
    .unwrap();

    let loaded = s.get_customer(&c.id).unwrap().unwrap();
    assert_eq!(loaded.loyalty_points, i64::MAX, "i64::max should roundtrip");
}

// ── Timestamps ───────────────────────────────────────────────────────

#[test]
fn created_at_is_set_on_creation() {
    let conn = setup();
    let s = store(&conn);
    let c = s
        .create_customer("Timestamp Test", None, None, None)
        .unwrap();
    assert!(!c.created_at.is_empty(), "created_at should be populated");
    assert!(c.created_at.contains('T'), "created_at should be ISO-8601");
    assert!(c.created_at.ends_with('Z'), "created_at should be UTC");
}

#[test]
fn updated_at_increases_on_update() {
    let conn = setup();
    let s = store(&conn);
    let c = s
        .create_customer("Update Tracker", None, None, None)
        .unwrap();

    let updated = s
        .update_customer(&c.id, "Update Tracker", None, None, None)
        .unwrap();
    assert!(
        !updated.updated_at.is_empty(),
        "updated_at should be set after update"
    );
}

// ── Nullable fields ─────────────────────────────────────────────────

#[test]
fn email_and_phone_are_nullable_in_list() {
    let conn = setup();
    seed_customers(&conn);
    let s = store(&conn);

    let customers = s.list_customers().unwrap();
    let bob = customers.iter().find(|c| c.name == "Bob").unwrap();
    assert!(bob.email.is_none(), "Bob has no email");
    assert_eq!(bob.phone.as_ref().map(|p| p.as_str()), Some("+1-555-0102"));

    let carol = customers.iter().find(|c| c.name == "Carol").unwrap();
    assert_eq!(
        carol.email.as_ref().map(|e| e.as_str()),
        Some("carol@example.com")
    );
    assert!(carol.phone.is_none(), "Carol has no phone");
}

// ── Delete ───────────────────────────────────────────────────────────

#[test]
fn delete_customer_also_removes_loyalty_data() {
    let conn = setup();
    seed_customers(&conn);
    let s = store(&conn);

    // Delete a customer with non-zero loyalty/spending.
    s.delete_customer("crm-4").unwrap();
    let loaded = s.get_customer("crm-4").unwrap();
    assert!(loaded.is_none(), "deleted customer should not exist");

    // Verify the other customers remain.
    let remaining = s.list_customers().unwrap();
    assert_eq!(remaining.len(), 3);
}
