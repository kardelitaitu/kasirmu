use super::*;
use crate::migrations;
use rusqlite::Connection;

fn fresh() -> Connection {
    migrations::fresh_db()
}

fn seed_user_and_shift(conn: &Connection) -> (Store<'_>, String) {
    conn.execute_batch(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at) VALUES
            ('role-c', 'cashier', 'C', '[]', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
         INSERT INTO users (id, username, pin_hash, display_name, role_id, created_at, updated_at) VALUES
            ('u1', 'alice', 'h', 'Alice', 'role-c', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');"
    ).unwrap();
    let s = Store::new(conn);
    let shift = s.open_shift("u1", None, 1000).unwrap();
    (s, shift.id)
}

#[test]
fn create_payout_on_open_shift() {
    let conn = fresh();
    let (s, shift_id) = seed_user_and_shift(&conn);

    let payout = s.create_cash_payout(&shift_id, 5000, "bank drop").unwrap();
    assert_eq!(payout.shift_id, shift_id);
    assert_eq!(payout.amount_minor, 5000);
    assert_eq!(payout.reason, "bank drop");
    assert!(!payout.id.is_empty());
}

#[test]
fn create_payout_closed_shift_rejected() {
    let conn = fresh();
    let (s, shift_id) = seed_user_and_shift(&conn);
    s.close_shift(&shift_id, 2000, None).unwrap();

    let err = s.create_cash_payout(&shift_id, 1000, "drop").unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "status"));
}

#[test]
fn create_payout_not_found_shift() {
    let conn = fresh();
    let s = Store::new(&conn);
    let err = s
        .create_cash_payout("nonexistent", 1000, "drop")
        .unwrap_err();
    assert!(matches!(err, CoreError::NotFound { entity, .. } if entity == "shift"));
}

#[test]
fn create_payout_zero_or_negative_rejected() {
    let conn = fresh();
    let (s, shift_id) = seed_user_and_shift(&conn);

    let err = s.create_cash_payout(&shift_id, 0, "zero").unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "amount_minor"));

    let err = s.create_cash_payout(&shift_id, -100, "neg").unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "amount_minor"));
}

#[test]
fn list_payouts_for_shift() {
    let conn = fresh();
    let (s, shift_id) = seed_user_and_shift(&conn);

    s.create_cash_payout(&shift_id, 3000, "drop 1").unwrap();
    s.create_cash_payout(&shift_id, 7000, "drop 2").unwrap();

    let payouts = s.list_cash_payouts(&shift_id).unwrap();
    assert_eq!(payouts.len(), 2);
    assert_eq!(payouts[0].amount_minor, 3000);
    assert_eq!(payouts[1].amount_minor, 7000);
}

#[test]
fn list_payouts_empty() {
    let conn = fresh();
    let (s, shift_id) = seed_user_and_shift(&conn);

    let payouts = s.list_cash_payouts(&shift_id).unwrap();
    assert!(payouts.is_empty());
}

#[test]
fn total_payouts_for_shift() {
    let conn = fresh();
    let (s, shift_id) = seed_user_and_shift(&conn);

    assert_eq!(s.get_total_payouts_for_shift(&shift_id).unwrap(), 0);

    s.create_cash_payout(&shift_id, 3000, "drop").unwrap();
    s.create_cash_payout(&shift_id, 7000, "drop").unwrap();

    assert_eq!(s.get_total_payouts_for_shift(&shift_id).unwrap(), 10000);
}

#[test]
fn payout_large_amount_accepted() {
    let conn = fresh();
    let (s, shift_id) = seed_user_and_shift(&conn);

    let payout = s
        .create_cash_payout(&shift_id, 10_000_000, "large bank drop")
        .unwrap();
    assert_eq!(payout.amount_minor, 10_000_000);
    assert!(!payout.created_at.is_empty());

    let total = s.get_total_payouts_for_shift(&shift_id).unwrap();
    assert_eq!(total, 10_000_000);
}

#[test]
fn payout_reason_empty_allowed() {
    let conn = fresh();
    let (s, shift_id) = seed_user_and_shift(&conn);

    let payout = s.create_cash_payout(&shift_id, 1000, "").unwrap();
    assert_eq!(payout.reason, "");
    assert_eq!(payout.amount_minor, 1000);
}

#[test]
fn payout_list_scoped_to_shift() {
    let conn = fresh();
    let (s, shift1_id) = seed_user_and_shift(&conn);

    // Create a second shift
    conn.execute_batch(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at) VALUES
            ('role-c2', 'senior_cashier', 'C+', '[]', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
         INSERT INTO users (id, username, pin_hash, display_name, role_id, created_at, updated_at) VALUES
            ('u2', 'bob', 'h', 'Bob', 'role-c2', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');"
    ).unwrap();
    let s2 = Store::new(&conn);
    let shift2 = s2.open_shift("u2", None, 500).unwrap();

    s.create_cash_payout(&shift1_id, 5000, "shift1 drop")
        .unwrap();
    s.create_cash_payout(&shift2.id, 2000, "shift2 drop")
        .unwrap();

    let shift1_payouts = s.list_cash_payouts(&shift1_id).unwrap();
    assert_eq!(shift1_payouts.len(), 1);
    assert_eq!(shift1_payouts[0].amount_minor, 5000);

    let shift2_payouts = s.list_cash_payouts(&shift2.id).unwrap();
    assert_eq!(shift2_payouts.len(), 1);
    assert_eq!(shift2_payouts[0].amount_minor, 2000);

    assert_eq!(s.get_total_payouts_for_shift(&shift1_id).unwrap(), 5000);
    assert_eq!(s.get_total_payouts_for_shift(&shift2.id).unwrap(), 2000);
}

#[test]
fn payout_total_updates_with_each_drop() {
    let conn = fresh();
    let (s, shift_id) = seed_user_and_shift(&conn);

    assert_eq!(s.get_total_payouts_for_shift(&shift_id).unwrap(), 0);

    s.create_cash_payout(&shift_id, 1000, "drop a").unwrap();
    assert_eq!(s.get_total_payouts_for_shift(&shift_id).unwrap(), 1000);

    s.create_cash_payout(&shift_id, 2000, "drop b").unwrap();
    assert_eq!(s.get_total_payouts_for_shift(&shift_id).unwrap(), 3000);

    s.create_cash_payout(&shift_id, 3000, "drop c").unwrap();
    assert_eq!(s.get_total_payouts_for_shift(&shift_id).unwrap(), 6000);
}

#[test]
fn payout_multiple_drops_different_reasons() {
    let conn = fresh();
    let (s, shift_id) = seed_user_and_shift(&conn);

    s.create_cash_payout(&shift_id, 2000, "safe drop").unwrap();
    s.create_cash_payout(&shift_id, 5000, "bank deposit")
        .unwrap();
    s.create_cash_payout(&shift_id, 1000, "change order")
        .unwrap();

    let payouts = s.list_cash_payouts(&shift_id).unwrap();
    assert_eq!(payouts.len(), 3);
    assert_eq!(payouts[0].reason, "safe drop");
    assert_eq!(payouts[1].reason, "bank deposit");
    assert_eq!(payouts[2].reason, "change order");

    assert_eq!(s.get_total_payouts_for_shift(&shift_id).unwrap(), 8000);
}

#[test]
fn payout_very_long_reason_accepted() {
    let conn = fresh();
    let (s, shift_id) = seed_user_and_shift(&conn);

    let long_reason = "reason_".repeat(100); // 700 chars
    let payout = s.create_cash_payout(&shift_id, 1000, &long_reason).unwrap();
    assert_eq!(payout.reason.len(), 700);
    assert!(payout.reason.starts_with("reason_"));
}

#[test]
fn payout_created_at_is_set() {
    let conn = fresh();
    let (s, shift_id) = seed_user_and_shift(&conn);

    let payout = s.create_cash_payout(&shift_id, 500, "test").unwrap();
    assert!(!payout.created_at.is_empty());
    assert!(payout.created_at.contains("T")); // ISO-8601 format
}

#[test]
fn payout_exact_float_amount() {
    let conn = fresh();
    let (s, shift_id) = seed_user_and_shift(&conn);

    // Opening float is 1000 (see seed_user_and_shift)
    let payout = s
        .create_cash_payout(&shift_id, 1000, "exact float")
        .unwrap();
    assert_eq!(payout.amount_minor, 1000);

    // A second payout of the same amount is also allowed
    let payout2 = s
        .create_cash_payout(&shift_id, 1000, "another float")
        .unwrap();
    assert_eq!(payout2.amount_minor, 1000);

    assert_eq!(s.get_total_payouts_for_shift(&shift_id).unwrap(), 2000);
}

// ── Additional edge cases ───────────────────────────────────────

#[test]
fn payout_ordering_asc_by_created_at() {
    let conn = fresh();
    let (s, shift_id) = seed_user_and_shift(&conn);

    let _p1 = s.create_cash_payout(&shift_id, 1000, "first").unwrap();
    std::thread::sleep(std::time::Duration::from_millis(10));
    let _p2 = s.create_cash_payout(&shift_id, 2000, "second").unwrap();
    std::thread::sleep(std::time::Duration::from_millis(10));
    let _p3 = s.create_cash_payout(&shift_id, 3000, "third").unwrap();

    let payouts = s.list_cash_payouts(&shift_id).unwrap();
    assert_eq!(payouts.len(), 3);
    assert_eq!(payouts[0].amount_minor, 1000);
    assert_eq!(payouts[1].amount_minor, 2000);
    assert_eq!(payouts[2].amount_minor, 3000);
    assert!(payouts[0].created_at <= payouts[1].created_at);
    assert!(payouts[1].created_at <= payouts[2].created_at);
}

#[test]
fn payout_minimum_amount_accepted() {
    let conn = fresh();
    let (s, shift_id) = seed_user_and_shift(&conn);

    // 1 minor unit (e.g. Rp 1, $0.01) is the minimum valid amount
    let payout = s.create_cash_payout(&shift_id, 1, "minimum drop").unwrap();
    assert_eq!(payout.amount_minor, 1);

    let total = s.get_total_payouts_for_shift(&shift_id).unwrap();
    assert_eq!(total, 1);
}

#[test]
fn payout_special_chars_in_reason() {
    let conn = fresh();
    let (s, shift_id) = seed_user_and_shift(&conn);

    // Unicode, emoji, and special characters in reason
    let reason = "Bank drop ✅ — #さようなら & <safe> [deposit]";
    let payout = s.create_cash_payout(&shift_id, 2500, reason).unwrap();
    assert_eq!(payout.reason, reason);

    let payouts = s.list_cash_payouts(&shift_id).unwrap();
    assert_eq!(payouts[0].reason, reason);
}

#[test]
fn payout_same_reason_multiple_times() {
    let conn = fresh();
    let (s, shift_id) = seed_user_and_shift(&conn);

    // Multiple drops with the same reason should all be stored
    for _ in 0..5 {
        s.create_cash_payout(&shift_id, 1000, "daily drop").unwrap();
    }

    let payouts = s.list_cash_payouts(&shift_id).unwrap();
    assert_eq!(payouts.len(), 5);
    assert!(payouts.iter().all(|p| p.reason == "daily drop"));
    assert_eq!(s.get_total_payouts_for_shift(&shift_id).unwrap(), 5000);
}

#[test]
fn payout_ids_globally_unique() {
    let conn = fresh();
    let (s, shift_id) = seed_user_and_shift(&conn);

    // UUID v7 IDs should be unique across multiple payout creates
    use std::collections::HashSet;
    let mut ids = HashSet::new();

    for i in 0..20 {
        let payout = s
            .create_cash_payout(&shift_id, 1000 * (i + 1), &format!("drop {i}"))
            .unwrap();
        assert!(
            ids.insert(payout.id.clone()),
            "duplicate payout ID generated: {}",
            payout.id
        );
    }

    let payouts = s.list_cash_payouts(&shift_id).unwrap();
    assert_eq!(payouts.len(), 20);
    assert_eq!(s.get_total_payouts_for_shift(&shift_id).unwrap(), 210000);
}
