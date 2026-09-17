//! Integration tests for shift management.
//!
//! Tests cover the full open/close lifecycle, cash reconciliation
//! calculations, FK constraints, timestamps, and listing order.

use kasirmu_core::{Store, migrations};

fn setup() -> rusqlite::Connection {
    migrations::fresh_db()
}

fn store(conn: &rusqlite::Connection) -> Store<'_> {
    Store::new(conn)
}

fn seed_users(conn: &rusqlite::Connection) {
    conn.execute_batch(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at) VALUES
            ('role-staff', 'Staff', 'Staff role', '[]', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
            ('role-manager', 'Manager', 'Manager role', '[]', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
         INSERT INTO users (id, username, pin_hash, display_name, role_id, created_at, updated_at) VALUES
            ('user-alice', 'alice', 'hash1', 'Alice', 'role-staff', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
            ('user-bob', 'bob', 'hash2', 'Bob', 'role-manager', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');"
    ).unwrap();
}

fn seed_terminal(conn: &rusqlite::Connection) {
    conn.execute_batch(
        "INSERT INTO terminals (id, name, device_id, created_at, updated_at) VALUES
         ('term-front', 'Front Register', 'dev-front', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');"
    ).unwrap();
}

// ── Open shift ────────────────────────────────────────────────────────

#[test]
fn shift_open_creates_open_shift() {
    let conn = setup();
    seed_users(&conn);
    let s = store(&conn);

    let shift = s.open_shift("user-alice", None, 500).unwrap();
    assert_eq!(shift.user_id, "user-alice");
    assert_eq!(shift.opening_balance_minor, 500);
    assert_eq!(shift.status, "open");
    assert!(shift.closed_at.is_none());
    assert!(shift.closing_balance_minor.is_none());
    assert!(shift.expected_cash_minor.is_none());
    assert!(shift.cash_difference_minor.is_none());
    assert_eq!(shift.total_sales_minor, 0);
    assert_eq!(shift.total_cash_minor, 0);
    assert_eq!(shift.total_card_minor, 0);
    assert_eq!(shift.total_other_minor, 0);
    assert_eq!(shift.total_voids_minor, 0);
    assert_eq!(shift.total_refunds_minor, 0);
}

#[test]
fn shift_open_with_terminal() {
    let conn = setup();
    seed_users(&conn);
    seed_terminal(&conn);
    let s = store(&conn);

    let shift = s
        .open_shift("user-alice", Some("term-front"), 1000)
        .unwrap();
    assert_eq!(shift.terminal_id.as_deref(), Some("term-front"));
}

#[test]
fn shift_open_without_terminal() {
    let conn = setup();
    seed_users(&conn);
    let s = store(&conn);

    let shift = s.open_shift("user-alice", None::<&str>, 0).unwrap();
    assert!(shift.terminal_id.is_none());
}

#[test]
fn shift_open_negative_balance_rejected() {
    let conn = setup();
    seed_users(&conn);
    let s = store(&conn);

    let err = s.open_shift("user-alice", None, -100).unwrap_err();
    assert!(
        matches!(err, kasirmu_core::CoreError::Validation { field, .. } if field == "opening_balance_minor")
    );
}

#[test]
fn shift_open_empty_user_rejected() {
    let conn = setup();
    let s = store(&conn);

    let err = s.open_shift("", None, 0).unwrap_err();
    assert!(matches!(err, kasirmu_core::CoreError::Validation { field, .. } if field == "user_id"));
}

#[test]
fn shift_open_nonexistent_user_rejected() {
    let conn = setup();
    let s = store(&conn);

    let err = s.open_shift("user-ghost", None, 100).unwrap_err();
    assert!(
        matches!(err, kasirmu_core::CoreError::Validation { field, .. } if field == "user_id"),
        "expected Validation error for nonexistent user, got: {err}"
    );
}

// ── Close shift ───────────────────────────────────────────────────────

#[test]
fn shift_close_sets_all_closed_fields() {
    let conn = setup();
    seed_users(&conn);
    let s = store(&conn);

    let shift = s.open_shift("user-alice", None, 100).unwrap();
    let closed = s.close_shift(&shift.id, 500, Some("End of day")).unwrap();

    assert!(closed.is_closed());
    assert!(closed.closed_at.is_some());
    assert!(closed.closed_at.unwrap().contains('T'));
    assert_eq!(closed.closing_balance_minor, Some(500));
    assert_eq!(closed.notes, "End of day");
}

#[test]
fn shift_close_no_notes() {
    let conn = setup();
    seed_users(&conn);
    let s = store(&conn);

    let shift = s.open_shift("user-alice", None, 100).unwrap();
    let closed = s.close_shift(&shift.id, 200, None).unwrap();
    assert_eq!(closed.notes, "");
}

#[test]
fn shift_close_calculates_cash_difference() {
    let conn = setup();
    seed_users(&conn);
    let s = store(&conn);

    // Open with 100, close with 150, no sales → expected = 100, diff = 50.
    let shift = s.open_shift("user-alice", None, 100).unwrap();
    let closed = s.close_shift(&shift.id, 150, None).unwrap();

    assert_eq!(closed.expected_cash_minor, Some(100));
    assert_eq!(closed.cash_difference_minor, Some(50));
}

#[test]
fn shift_close_with_sales_affects_cash_difference() {
    let conn = setup();
    seed_users(&conn);
    let s = store(&conn);

    // Open with 200, create a cash sale for 300.
    let shift = s.open_shift("user-alice", None, 200).unwrap();

    // Seed a cash sale during the shift's time window.
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    conn.execute_batch(&format!(
        "INSERT INTO sales (id, user_id, status, total_minor, payment_method, currency, line_count, created_at, updated_at)
         VALUES ('sale-1', 'user-alice', 'completed', 300, 'cash', 'USD', 1, '{now}', '{now}');"
    )).unwrap();

    // Close with 600 → expected = 200 + 300 = 500, diff = 600 - 500 = 100.
    let closed = s.close_shift(&shift.id, 600, None).unwrap();
    assert_eq!(closed.expected_cash_minor, Some(500));
    assert_eq!(closed.cash_difference_minor, Some(100));
    assert_eq!(closed.total_sales_minor, 300);
    assert_eq!(closed.total_cash_minor, 300);
}

#[test]
fn shift_close_different_payment_methods() {
    let conn = setup();
    seed_users(&conn);
    let s = store(&conn);

    let shift = s.open_shift("user-alice", None, 100).unwrap();
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    conn.execute_batch(&format!(
        "INSERT INTO sales (id, user_id, status, total_minor, payment_method, currency, line_count, created_at, updated_at) VALUES
         ('sale-c1', 'user-alice', 'completed', 500, 'cash', 'USD', 1, '{now}', '{now}'),
         ('sale-c2', 'user-alice', 'completed', 300, 'card', 'USD', 1, '{now}', '{now}'),
         ('sale-c3', 'user-alice', 'completed', 200, 'mobile_wallet', 'USD', 1, '{now}', '{now}');"
    )).unwrap();

    let closed = s.close_shift(&shift.id, 700, None).unwrap();
    assert_eq!(closed.total_sales_minor, 1000);
    assert_eq!(closed.total_cash_minor, 500);
    assert_eq!(closed.total_card_minor, 300);
    assert_eq!(closed.total_other_minor, 200);
    assert_eq!(closed.expected_cash_minor, Some(600)); // 100 + 500
    assert_eq!(closed.cash_difference_minor, Some(100)); // 700 - 600
}

#[test]
fn shift_close_includes_voids_and_refunds() {
    let conn = setup();
    seed_users(&conn);
    let s = store(&conn);

    let shift = s.open_shift("user-alice", None, 100).unwrap();
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    // Completed sale, voided sale, and a refund.
    conn.execute_batch(&format!(
        "INSERT INTO sales (id, user_id, status, total_minor, currency, line_count, created_at, updated_at) VALUES
         ('sale-ok', 'user-alice', 'completed', 1000, 'USD', 1, '{now}', '{now}'),
         ('sale-vd', 'user-alice', 'voided', 200, 'USD', 1, '{now}', '{now}');
         INSERT INTO refunds (id, sale_id, total_minor, currency, processed_by, created_at)
         VALUES ('ref-1', 'sale-ok', 300, 'USD', 'user-alice', '{now}');"
    )).unwrap();

    let closed = s.close_shift(&shift.id, 1100, None).unwrap();
    assert_eq!(closed.total_sales_minor, 1000);
    assert_eq!(closed.total_voids_minor, 200);
    assert_eq!(closed.total_refunds_minor, 300);
}

#[test]
fn shift_close_already_closed_rejected() {
    let conn = setup();
    seed_users(&conn);
    let s = store(&conn);

    let shift = s.open_shift("user-alice", None, 100).unwrap();
    s.close_shift(&shift.id, 200, None).unwrap();
    let err = s.close_shift(&shift.id, 300, None).unwrap_err();
    assert!(matches!(err, kasirmu_core::CoreError::Validation { field, .. } if field == "status"));
}

#[test]
fn shift_close_not_found() {
    let conn = setup();
    let s = store(&conn);

    let err = s.close_shift("nonexistent", 100, None).unwrap_err();
    assert!(matches!(err, kasirmu_core::CoreError::NotFound { entity, .. } if entity == "shift"));
}

#[test]
fn shift_close_different_user_sales_not_included() {
    let conn = setup();
    seed_users(&conn);
    let s = store(&conn);

    // Alice opens shift.
    let shift = s.open_shift("user-alice", None, 100).unwrap();
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    // Bob's sale — should NOT be included in Alice's shift totals.
    conn.execute_batch(&format!(
        "INSERT INTO sales (id, user_id, status, total_minor, currency, line_count, created_at, updated_at) VALUES
         ('sale-bob', 'user-bob', 'completed', 9999, 'USD', 1, '{now}', '{now}');"
    )).unwrap();

    let closed = s.close_shift(&shift.id, 150, None).unwrap();
    assert_eq!(closed.total_sales_minor, 0); // Bob's sale excluded
    assert_eq!(closed.expected_cash_minor, Some(100));
}

// ── Get active shift ──────────────────────────────────────────────────

#[test]
fn shift_get_active_returns_open_shift() {
    let conn = setup();
    seed_users(&conn);
    let s = store(&conn);

    let shift = s.open_shift("user-alice", None, 500).unwrap();
    let active = s.get_active_shift("user-alice").unwrap().unwrap();
    assert_eq!(active.id, shift.id);
    assert!(active.is_open());
}

#[test]
fn shift_get_active_returns_none_when_no_open_shift() {
    let conn = setup();
    seed_users(&conn);
    let s = store(&conn);

    let active = s.get_active_shift("user-alice").unwrap();
    assert!(active.is_none());
}

#[test]
fn shift_get_active_returns_none_after_close() {
    let conn = setup();
    seed_users(&conn);
    let s = store(&conn);

    let shift = s.open_shift("user-alice", None, 100).unwrap();
    s.close_shift(&shift.id, 200, None).unwrap();
    let active = s.get_active_shift("user-alice").unwrap();
    assert!(active.is_none());
}

#[test]
fn shift_get_active_returns_correct_user_shift() {
    let conn = setup();
    seed_users(&conn);
    let s = store(&conn);

    // Both users have open shifts.
    let _alice = s.open_shift("user-alice", None, 100).unwrap();
    let bob = s.open_shift("user-bob", None, 200).unwrap();

    let active = s.get_active_shift("user-bob").unwrap().unwrap();
    assert_eq!(active.id, bob.id);
}

// ── List shifts ───────────────────────────────────────────────────────

#[test]
fn shift_list_ordered_by_opened_at_desc() {
    let conn = setup();
    seed_users(&conn);
    let s = store(&conn);

    let s1 = s.open_shift("user-alice", None, 100).unwrap();
    s.close_shift(&s1.id, 150, None).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(5));
    let s2 = s.open_shift("user-alice", None, 200).unwrap();
    s.close_shift(&s2.id, 250, None).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(5));
    let s3 = s.open_shift("user-bob", None, 300).unwrap();

    let shifts = s.list_shifts().unwrap();
    assert_eq!(shifts.len(), 3);
    assert_eq!(shifts[0].id, s3.id);
    assert_eq!(shifts[1].id, s2.id);
    assert_eq!(shifts[2].id, s1.id);
}

#[test]
fn shift_list_includes_both_open_and_closed() {
    let conn = setup();
    seed_users(&conn);
    let s = store(&conn);

    let shift = s.open_shift("user-alice", None, 100).unwrap();
    s.close_shift(&shift.id, 200, None).unwrap();
    let _open = s.open_shift("user-alice", None, 300).unwrap();

    let shifts = s.list_shifts().unwrap();
    assert_eq!(shifts.len(), 2);
}

#[test]
fn shift_list_empty_db() {
    let conn = setup();
    let s = store(&conn);

    let shifts = s.list_shifts().unwrap();
    assert!(shifts.is_empty());
}

// ── Get shift ─────────────────────────────────────────────────────────

#[test]
fn shift_get_found() {
    let conn = setup();
    seed_users(&conn);
    let s = store(&conn);

    let shift = s.open_shift("user-alice", None, 500).unwrap();
    let loaded = s.get_shift(&shift.id).unwrap().unwrap();
    assert_eq!(loaded.id, shift.id);
    assert_eq!(loaded.user_id, "user-alice");
    assert_eq!(loaded.opening_balance_minor, 500);
}

#[test]
fn shift_get_not_found() {
    let conn = setup();
    let s = store(&conn);

    let loaded = s.get_shift("nonexistent").unwrap();
    assert!(loaded.is_none());
}

// ── Multiple shifts per user ──────────────────────────────────────────

#[test]
fn shift_user_can_open_multiple_shifts_over_time() {
    let conn = setup();
    seed_users(&conn);
    let s = store(&conn);

    let s1 = s.open_shift("user-alice", None, 100).unwrap();
    s.close_shift(&s1.id, 200, None).unwrap();

    let s2 = s.open_shift("user-alice", None, 300).unwrap();
    s.close_shift(&s2.id, 400, None).unwrap();

    let shifts = s.list_shifts().unwrap();
    assert_eq!(shifts.len(), 2);
    // Most recent first.
    assert_eq!(shifts[0].id, s2.id);
    assert_eq!(shifts[1].id, s1.id);
}

// ── Timestamps ────────────────────────────────────────────────────────

#[test]
fn shift_timestamps_are_iso8601() {
    let conn = setup();
    seed_users(&conn);
    let s = store(&conn);

    let shift = s.open_shift("user-alice", None, 100).unwrap();
    assert!(
        shift.opened_at.contains('T'),
        "opened_at should be ISO-8601"
    );
    assert!(
        shift.opened_at.ends_with('Z'),
        "opened_at should end with Z"
    );
    assert!(shift.created_at.contains('T'));
    assert!(shift.created_at.ends_with('Z'));
    assert!(shift.updated_at.contains('T'));
    assert!(shift.updated_at.ends_with('Z'));

    let closed = s.close_shift(&shift.id, 200, None).unwrap();
    assert!(closed.closed_at.unwrap().contains('T'));
    assert!(closed.updated_at.contains('T'));
    assert!(closed.updated_at.ends_with('Z'));
}

// ── Edge cases ────────────────────────────────────────────────────────

#[test]
fn shift_close_zero_balance() {
    let conn = setup();
    seed_users(&conn);
    let s = store(&conn);

    let shift = s.open_shift("user-alice", None, 0).unwrap();
    let closed = s.close_shift(&shift.id, 0, None).unwrap();
    assert_eq!(closed.closing_balance_minor, Some(0));
    assert_eq!(closed.cash_difference_minor, Some(0));
}

#[test]
fn shift_close_over_short_cash() {
    let conn = setup();
    seed_users(&conn);
    let s = store(&conn);

    // Open with 100, close with 80 → short by 20.
    let shift = s.open_shift("user-alice", None, 100).unwrap();
    let closed = s.close_shift(&shift.id, 80, Some("Short $20")).unwrap();
    assert_eq!(closed.cash_difference_minor, Some(-20));
    assert_eq!(closed.notes, "Short $20");
}

#[test]
fn shift_close_missing_user_scoped() {
    let conn = setup();
    seed_users(&conn);
    let s = store(&conn);

    // Close shift for a shift owned by a different user — should work
    // since close_shift only checks existence + status.
    let shift = s.open_shift("user-alice", None, 100).unwrap();
    // close_shift doesn't verify ownership; it closes by id.
    let closed = s.close_shift(&shift.id, 200, None).unwrap();
    assert!(closed.is_closed());
}
