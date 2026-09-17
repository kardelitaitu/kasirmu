use super::*;
use crate::migrations;

fn seed(conn: &rusqlite::Connection) {
    conn.execute_batch(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at)
         VALUES ('role-staff', 'Staff', 'Staff', '[]', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
         INSERT INTO users (id, username, pin_hash, display_name, role_id, created_at, updated_at) VALUES
            ('u-alice', 'alice', 'h', 'Alice', 'role-staff', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
            ('u-bob',   'bob',   'h', 'Bob',   'role-staff', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
         INSERT INTO sales (id, total_minor, currency, line_count, status, user_id, created_at) VALUES
            ('s1', 10000, 'USD', 1, 'completed', 'u-alice', '2026-07-10T09:00:00Z'),
            ('s2', 25000, 'USD', 1, 'completed', 'u-alice', '2026-07-10T14:00:00Z'),
            ('s3', 5000,  'USD', 1, 'completed', 'u-bob',   '2026-07-11T10:00:00Z'),
            -- pending + voided are excluded, and the no-cashier sale too
            ('s4', 90000, 'USD', 1, 'pending',   'u-alice', '2026-07-10T15:00:00Z'),
            ('s5', 70000, 'USD', 1, 'voided',    'u-bob',   '2026-07-11T11:00:00Z'),
            ('s6', 40000, 'USD', 1, 'completed', NULL,      '2026-07-10T16:00:00Z'),
            -- outside the range
            ('s7', 80000, 'USD', 1, 'completed', 'u-alice', '2026-08-01T09:00:00Z');
         INSERT INTO shifts (id, user_id, opened_at, closed_at, status, total_sales_minor, created_at, updated_at) VALUES
            ('sh1', 'u-alice', '2026-07-10T08:00:00Z', '2026-07-10T16:00:00Z', 'closed',  30000, '2026-07-10T08:00:00Z', '2026-07-10T16:00:00Z'),
            ('sh2', 'u-alice', '2026-07-11T08:00:00Z', NULL,                  'open',    5000,  '2026-07-11T08:00:00Z', '2026-07-11T08:00:00Z'),
            ('sh3', 'u-bob',   '2026-07-12T08:00:00Z', '2026-07-12T16:00:00Z', 'closed',  9000,  '2026-07-12T08:00:00Z', '2026-07-12T16:00:00Z'),
            -- outside the range
            ('sh4', 'u-bob',   '2026-08-01T08:00:00Z', '2026-08-01T16:00:00Z', 'closed', 1000, '2026-08-01T08:00:00Z', '2026-08-01T16:00:00Z');",
    )
    .unwrap();
}

#[test]
fn summary_aggregates_shifts_and_sales_per_user() {
    let conn = migrations::fresh_db();
    seed(&conn);
    let store = Store::new(&conn);

    let rows = store
        .staff_analytics_summary("2026-07-01", "2026-07-31")
        .unwrap();
    let alice = rows.iter().find(|r| r.user_id == "u-alice").unwrap();
    assert_eq!(alice.shift_count, 2);
    assert_eq!(alice.closed_shift_count, 1);
    assert_eq!(alice.shift_sales_minor, 35000);
    assert_eq!(alice.sale_count, 2);
    assert_eq!(alice.sale_total_minor, 35000);

    let bob = rows.iter().find(|r| r.user_id == "u-bob").unwrap();
    assert_eq!(bob.shift_count, 1);
    assert_eq!(bob.closed_shift_count, 1);
    assert_eq!(bob.shift_sales_minor, 9000);
    assert_eq!(bob.sale_count, 1);
    assert_eq!(bob.sale_total_minor, 5000);
}

#[test]
fn summary_excludes_pending_voided_and_no_cashier_sales() {
    let conn = migrations::fresh_db();
    seed(&conn);
    let store = Store::new(&conn);

    let rows = store
        .staff_analytics_summary("2026-07-01", "2026-07-31")
        .unwrap();
    let alice = rows.iter().find(|r| r.user_id == "u-alice").unwrap();
    // s4 (pending) and s6 (no cashier) must not count.
    assert_eq!(alice.sale_count, 2);
    assert_eq!(alice.sale_total_minor, 35000);
}

#[test]
fn summary_respects_date_range() {
    let conn = migrations::fresh_db();
    seed(&conn);
    let store = Store::new(&conn);

    // Narrow to a single day: alice has 2 sales + 1 shift on 07-10.
    let rows = store
        .staff_analytics_summary("2026-07-10", "2026-07-10")
        .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].user_id, "u-alice");
    assert_eq!(rows[0].sale_count, 2);
    assert_eq!(rows[0].shift_count, 1);

    // An empty range yields nothing.
    assert!(
        store
            .staff_analytics_summary("2020-01-01", "2020-01-02")
            .unwrap()
            .is_empty()
    );
}

#[test]
fn summary_zero_fills_the_missing_side() {
    let conn = migrations::fresh_db();
    // u-bob gets sales but no shifts; a third user gets only a shift.
    seed(&conn);
    conn.execute_batch(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, created_at, updated_at)
         VALUES ('u-cara', 'cara', 'h', 'Cara', 'role-staff', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
         INSERT INTO sales (id, total_minor, currency, line_count, status, user_id, created_at)
         VALUES ('s8', 1234, 'USD', 1, 'completed', 'u-cara', '2026-07-20T09:00:00Z');
         INSERT INTO shifts (id, user_id, opened_at, status, total_sales_minor, created_at, updated_at)
         VALUES ('sh5', 'u-bob', '2026-07-13T08:00:00Z', 'closed', 1111, '2026-07-13T08:00:00Z', '2026-07-13T16:00:00Z');",
    )
    .unwrap();
    let store = Store::new(&conn);

    let rows = store
        .staff_analytics_summary("2026-07-01", "2026-07-31")
        .unwrap();
    // u-bob: 1 extra shift, no sales in July (his only sale is 07-11,
    // still counted above — adjust: assert zero-fill via u-cara instead).
    let cara = rows.iter().find(|r| r.user_id == "u-cara").unwrap();
    assert_eq!(cara.shift_count, 0);
    assert_eq!(cara.closed_shift_count, 0);
    assert_eq!(cara.shift_sales_minor, 0);
    assert_eq!(cara.sale_count, 1);
    assert_eq!(cara.sale_total_minor, 1234);

    let bob = rows.iter().find(|r| r.user_id == "u-bob").unwrap();
    assert_eq!(bob.shift_count, 2);
    assert_eq!(bob.sale_count, 1);
}

#[test]
fn daily_series_groups_shifts_and_sales_by_day() {
    let conn = migrations::fresh_db();
    seed(&conn);
    let store = Store::new(&conn);

    let rows = store
        .staff_analytics_daily("u-alice", "2026-07-01", "2026-07-31")
        .unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].day, "2026-07-10");
    assert_eq!(rows[0].sale_count, 2);
    assert_eq!(rows[0].sale_total_minor, 35000);
    assert_eq!(rows[0].shift_count, 1);
    assert_eq!(rows[0].shift_sales_minor, 30000);
    assert_eq!(rows[1].day, "2026-07-11");
    assert_eq!(rows[1].sale_count, 0);
    assert_eq!(rows[1].shift_count, 1);
    assert_eq!(rows[1].shift_sales_minor, 5000);
}

#[test]
fn daily_series_excludes_non_completed_sales_and_no_cashier() {
    let conn = migrations::fresh_db();
    seed(&conn);
    let store = Store::new(&conn);

    let rows = store
        .staff_analytics_daily("u-bob", "2026-07-01", "2026-07-31")
        .unwrap();
    // bob: sale s3 (completed) on 07-11 and shift sh3 on 07-12; the
    // voided s5 must not count as a sale.
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].day, "2026-07-11");
    assert_eq!(rows[0].sale_count, 1);
    assert_eq!(rows[0].sale_total_minor, 5000);
    assert_eq!(rows[0].shift_count, 0);
    assert_eq!(rows[1].day, "2026-07-12");
    assert_eq!(rows[1].sale_count, 0);
    assert_eq!(rows[1].shift_count, 1);
    assert_eq!(rows[1].shift_sales_minor, 9000);
}

#[test]
fn daily_series_respects_date_range() {
    let conn = migrations::fresh_db();
    seed(&conn);
    let store = Store::new(&conn);

    assert!(
        store
            .staff_analytics_daily("u-alice", "2020-01-01", "2020-01-02")
            .unwrap()
            .is_empty()
    );
}
