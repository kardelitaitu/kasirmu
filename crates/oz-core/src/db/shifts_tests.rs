use super::*;
use crate::migrations;
use rusqlite::Connection;

fn fresh() -> Connection {
    migrations::fresh_db()
}

fn store(conn: &Connection) -> Store<'_> {
    Store::new(conn)
}

fn seed_user(conn: &Connection) {
    conn.execute_batch(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at) VALUES
            ('role-staff', 'staff', 'Staff', '[]', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
         INSERT INTO users (id, username, pin_hash, display_name, role_id, created_at, updated_at) VALUES
            ('user-1', 'alice', 'hash', 'Alice', 'role-staff', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');"
    ).unwrap();
}

fn seed_inactive_user(conn: &Connection) {
    conn.execute_batch(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at) VALUES
            ('role-inact', 'inactive_role', 'Inactive', '[]', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
         INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at) VALUES
            ('user-inactive', 'inactive', 'hash', 'Inactive', 'role-inact', 0, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');"
    ).unwrap();
}

#[test]
fn open_shift_with_inactive_user_rejected() {
    let conn = fresh();
    seed_inactive_user(&conn);
    let s = store(&conn);
    let err = s.open_shift("user-inactive", None, 100).unwrap_err();
    assert!(
        matches!(err, CoreError::Validation { field, .. } if field == "user_id"),
        "expected Validation error for inactive user, got: {err}"
    );
}

#[test]
fn open_shift_duplicate_rejected() {
    let conn = fresh();
    seed_user(&conn);
    let s = store(&conn);

    s.open_shift("user-1", None, 100).unwrap();
    let err = s.open_shift("user-1", None, 200).unwrap_err();
    assert!(
        matches!(err, CoreError::Validation { field, .. } if field == "user_id"),
        "expected Validation error for duplicate shift, got: {err}"
    );
}

#[test]
fn open_shift_succeeds_after_previous_closed() {
    let conn = fresh();
    seed_user(&conn);
    let s = store(&conn);

    let shift = s.open_shift("user-1", None, 100).unwrap();
    s.close_shift(&shift.id, 150, None).unwrap();

    // Should be allowed to open a new shift after the previous one is closed.
    let shift2 = s.open_shift("user-1", None, 200).unwrap();
    assert_eq!(shift2.opening_balance_minor, 200);
    assert!(shift2.is_open());
}

#[test]
fn open_shift_creates_open_shift() {
    let conn = fresh();
    seed_user(&conn);
    let s = store(&conn);

    let shift = s.open_shift("user-1", None, 500).unwrap();
    assert_eq!(shift.user_id, "user-1");
    assert_eq!(shift.opening_balance_minor, 500);
    assert!(shift.is_open());
    assert!(shift.terminal_id.is_none());
    assert!(!shift.id.is_empty());
    assert!(shift.opened_at.contains('T'));
}

#[test]
fn open_shift_with_terminal() {
    let conn = fresh();
    seed_user(&conn);
    conn.execute_batch(
        "INSERT INTO terminals (id, name, device_id, created_at, updated_at) VALUES
         ('term-1', 'Front Register', 'dev-001', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')"
    ).unwrap();
    let s = store(&conn);

    let shift = s.open_shift("user-1", Some("term-1"), 500).unwrap();
    assert_eq!(shift.terminal_id.as_deref(), Some("term-1"));
}

#[test]
fn open_shift_empty_user_rejected() {
    let conn = fresh();
    let err = store(&conn).open_shift("", None, 0).unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "user_id"));
}

#[test]
fn open_shift_negative_balance_rejected() {
    let conn = fresh();
    seed_user(&conn);
    let err = store(&conn).open_shift("user-1", None, -1).unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "opening_balance_minor"));
}

#[test]
fn close_shift_sets_closed_fields() {
    let conn = fresh();
    seed_user(&conn);
    let s = store(&conn);

    let shift = s.open_shift("user-1", None, 100).unwrap();
    let closed = s.close_shift(&shift.id, 500, Some("All good")).unwrap();

    assert!(closed.is_closed());
    assert!(closed.closed_at.is_some());
    assert_eq!(closed.closing_balance_minor, Some(500));
    assert_eq!(closed.notes, "All good");
}

#[test]
fn close_shift_calculates_cash_difference() {
    let conn = fresh();
    seed_user(&conn);
    let s = store(&conn);

    // Open with 100, close with 150, no sales → expected = 100, diff = 50.
    let shift = s.open_shift("user-1", None, 100).unwrap();
    let closed = s.close_shift(&shift.id, 150, None).unwrap();

    assert_eq!(closed.expected_cash_minor, Some(100)); // opening + 0 cash sales
    assert_eq!(closed.cash_difference_minor, Some(50)); // 150 - 100
}

/// RED: expected_cash must subtract cash refunds. A $10 cash refund during
/// the shift takes $10 out of the drawer, so the expected cash should be
/// opening + cash_sales − cash_refunds − payouts. Without this the
/// expected_cash is overstated and the cash_difference hides a real shortage.
#[test]
fn close_shift_includes_cash_refunds_in_expected_cash() {
    let conn = fresh();
    seed_user(&conn);
    let s = store(&conn);
    let usd: crate::Currency = "USD".parse().unwrap();
    let money = |minor: i64| crate::Money {
        minor_units: minor,
        currency: usd,
    };

    // Open with $100 (10000 minor), then a $10 (1000 minor) cash refund
    // occurs.
    let shift = s.open_shift("user-1", None, 10000).unwrap();
    conn.execute_batch(
        "INSERT INTO products (id, sku, name, price_minor, currency, created_at, updated_at, product_type)
         VALUES ('p-sku', 'SKU', 'Sku', 1000, 'USD', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z', 'retail');
         INSERT INTO sales (id, total_minor, currency, line_count, status, payment_method,
                            created_at, updated_at, user_id, version)
         VALUES ('refund-sale-1', 1000, 'USD', 1, 'completed', 'cash',
                 '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'user-1', 1);
         INSERT INTO sale_lines (id, sale_id, sku, qty, unit_minor, line_minor, currency, line_position)
         VALUES ('sl-1', 'refund-sale-1', 'SKU', 1, 1000, 1000, 'USD', 1);"
    )
    .unwrap();
    s.create_refund(&crate::Refund::new(
        "refund-sale-1",
        money(1000),
        "refund",
        "",
        "user-1",
        vec![crate::RefundLine::new(
            "sl-1",
            "SKU",
            1,
            money(1000),
            money(1000),
        )],
    ))
    .unwrap();

    // Close with $90 (9000). Drawer: 10000 opening − 1000 refund = 9000.
    // Expected cash = 10000 − 1000 = 9000, diff = 9000 − 9000 = 0.
    let closed = s.close_shift(&shift.id, 9000, None).unwrap();
    assert_eq!(
        closed.expected_cash_minor,
        Some(9000),
        "expected_cash must include cash refunds (10000 opening − 1000 refund = 9000)"
    );
    assert_eq!(
        closed.cash_difference_minor,
        Some(0),
        "drawer equals expected (9000 − 9000 = 0)"
    );
}

#[test]
fn close_shift_already_closed_rejected() {
    let conn = fresh();
    seed_user(&conn);
    let s = store(&conn);

    let shift = s.open_shift("user-1", None, 100).unwrap();
    s.close_shift(&shift.id, 200, None).unwrap();

    let err = s.close_shift(&shift.id, 300, None).unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "status"));
}

#[test]
fn close_shift_not_found() {
    let conn = fresh();
    let err = store(&conn)
        .close_shift("nonexistent", 100, None)
        .unwrap_err();
    assert!(matches!(err, CoreError::NotFound { entity, .. } if entity == "shift"));
}

#[test]
fn get_active_shift_returns_none_when_no_open_shift() {
    let conn = fresh();
    seed_user(&conn);
    let s = store(&conn);

    let active = s.get_active_shift("user-1").unwrap();
    assert!(active.is_none());
}

#[test]
fn get_active_shift_returns_open_shift() {
    let conn = fresh();
    seed_user(&conn);
    let s = store(&conn);

    let shift = s.open_shift("user-1", None, 100).unwrap();
    let active = s.get_active_shift("user-1").unwrap().unwrap();
    assert_eq!(active.id, shift.id);
    assert!(active.is_open());
}

#[test]
fn get_active_shift_returns_none_after_close() {
    let conn = fresh();
    seed_user(&conn);
    let s = store(&conn);

    let shift = s.open_shift("user-1", None, 100).unwrap();
    s.close_shift(&shift.id, 200, None).unwrap();

    let active = s.get_active_shift("user-1").unwrap();
    assert!(active.is_none(), "no open shift after close");
}

#[test]
fn list_shifts_ordered_by_opened_at_desc() {
    let conn = fresh();
    seed_user(&conn);
    let s = store(&conn);

    let s1 = s.open_shift("user-1", None, 100).unwrap();
    s.close_shift(&s1.id, 150, None).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(2));
    let s2 = s.open_shift("user-1", None, 200).unwrap();

    let shifts = s.list_shifts().unwrap();
    assert_eq!(shifts.len(), 2);
    assert_eq!(shifts[0].id, s2.id, "most recent first");
    assert_eq!(shifts[1].id, s1.id);
}

#[test]
fn list_shifts_empty_db() {
    let conn = fresh();
    let shifts = store(&conn).list_shifts().unwrap();
    assert!(shifts.is_empty());
}

#[test]
fn get_shift_found() {
    let conn = fresh();
    seed_user(&conn);
    let s = store(&conn);

    let shift = s.open_shift("user-1", None, 500).unwrap();
    let loaded = s.get_shift(&shift.id).unwrap().unwrap();
    assert_eq!(loaded.id, shift.id);
    assert_eq!(loaded.opening_balance_minor, 500);
}

#[test]
fn get_shift_not_found() {
    let conn = fresh();
    let shift = store(&conn).get_shift("nonexistent").unwrap();
    assert!(shift.is_none());
}

// ── Shift report tests ───────────────────────────────────────

#[test]
fn get_shift_report_not_found() {
    let conn = fresh();
    let err = store(&conn).get_shift_report("nonexistent").unwrap_err();
    assert!(matches!(err, CoreError::NotFound { entity, .. } if entity == "shift"));
}

#[test]
fn get_shift_report_with_payouts() {
    let conn = fresh();
    seed_user(&conn);
    let s = store(&conn);

    let shift = s.open_shift("user-1", None, 200).unwrap();
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    // Add a cash payout.
    s.create_cash_payout(&shift.id, 300, "safe drop").unwrap();

    // Insert a cash sale.
    conn.execute_batch(&format!(
        "INSERT INTO sales (id, user_id, status, total_minor, payment_method, currency, line_count, created_at, updated_at) VALUES
         ('sale-p1', 'user-1', 'completed', 500, 'cash', 'USD', 1, '{now}', '{now}');"
    )).unwrap();

    // Close the shift.
    let closed = s.close_shift(&shift.id, 500, None).unwrap();

    // Expected cash = opening(200) + cash_sales(500) - payouts(300) = 400
    assert_eq!(closed.expected_cash_minor, Some(400));
    assert_eq!(closed.total_payouts_minor, 300);
    assert_eq!(closed.cash_difference_minor, Some(100)); // 500 - 400

    let report = s.get_shift_report(&shift.id).unwrap();
    assert_eq!(report.cash_payouts.len(), 1);
    assert_eq!(report.cash_payouts[0].amount_minor, 300);
}

#[test]
fn get_shift_report_with_sales() {
    let conn = fresh();
    seed_user(&conn);
    let s = store(&conn);

    let shift = s.open_shift("user-1", None, 200).unwrap();
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    // Insert sales with different payment methods.
    conn.execute_batch(&format!(
        "INSERT INTO sales (id, user_id, status, total_minor, payment_method, currency, line_count, created_at, updated_at) VALUES
         ('sale-c1', 'user-1', 'completed', 500, 'cash', 'USD', 1, '{now}', '{now}'),
         ('sale-c2', 'user-1', 'completed', 300, 'card', 'USD', 1, '{now}', '{now}'),
         ('sale-c3', 'user-1', 'completed', 200, 'mobile_wallet', 'USD', 1, '{now}', '{now}'),
         ('sale-v1', 'user-1', 'voided', 100, 'cash', 'USD', 1, '{now}', '{now}');
         INSERT INTO payments (id, sale_id, method, amount_minor, currency, created_at) VALUES
         ('pmt-1', 'sale-c1', 'cash', 500, 'USD', '{now}'),
         ('pmt-2', 'sale-c2', 'card', 300, 'USD', '{now}'),
         ('pmt-3', 'sale-c3', 'mobile_wallet', 200, 'USD', '{now}');"
    )).unwrap();

    // Close the shift so totals are stored.
    s.close_shift(&shift.id, 800, None).unwrap();

    let report = s.get_shift_report(&shift.id).unwrap();

    // Verify the shift identity is included.
    assert_eq!(report.shift.id, shift.id);
    assert_eq!(report.shift.total_sales_minor, 1000);

    // Payment breakdown from payments table.
    assert_eq!(report.payment_breakdown.len(), 3);
    assert_eq!(report.payment_breakdown[0].method, "cash");
    assert_eq!(report.payment_breakdown[0].count, 1);
    assert_eq!(report.payment_breakdown[0].total_minor, 500);
    assert_eq!(report.payment_breakdown[1].method, "card");
    assert_eq!(report.payment_breakdown[2].method, "mobile_wallet");

    // Counts.
    assert_eq!(report.sale_count, 3, "completed sales");
    assert_eq!(report.void_count, 1, "voided sales");
    assert_eq!(report.refund_count, 0, "no refunds");

    // Hourly breakdown should have the sales grouped by hour.
    assert!(
        !report.hourly_breakdown.is_empty(),
        "should have hourly data"
    );
    let total_from_hours: i64 = report.hourly_breakdown.iter().map(|h| h.total_minor).sum();
    assert_eq!(total_from_hours, 1000, "hourly totals match sales");

    // Gross profit: no sale lines were inserted, so COGS is 0 and the
    // profit equals the completed-sale revenue (1000).
    assert_eq!(report.cogs_minor, 0);
    assert_eq!(report.gross_profit_minor, 1000);
    assert_eq!(report.gross_margin_percent, 100.0);
}

#[test]
fn get_shift_report_gross_profit_from_product_costs() {
    let conn = fresh();
    seed_user(&conn);
    let s = store(&conn);

    let shift = s.open_shift("user-1", None, 200).unwrap();
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    // Two products with known costs; a completed sale of 2× STEAK
    // (2500 − 800) and a voided sale that must NOT contribute COGS.
    conn.execute_batch(&format!(
        "INSERT INTO products (id, sku, name, price_minor, currency, cost_minor, created_at, updated_at) VALUES
         ('p-1', 'STEAK', 'Steak', 2500, 'USD', 800, '{now}', '{now}'),
         ('p-2', 'SODA',  'Soda',  300,  'USD', 100, '{now}', '{now}');
         INSERT INTO sales (id, user_id, status, total_minor, payment_method, currency, line_count, created_at, updated_at) VALUES
         ('sale-g1', 'user-1', 'completed', 5000, 'cash', 'USD', 1, '{now}', '{now}'),
         ('sale-g2', 'user-1', 'completed', 900,  'card', 'USD', 1, '{now}', '{now}'),
         ('sale-g3', 'user-1', 'voided',    500,  'cash', 'USD', 1, '{now}', '{now}');
         INSERT INTO sale_lines (id, sale_id, sku, qty, unit_minor, line_minor, currency, line_position) VALUES
         ('sl-1', 'sale-g1', 'STEAK', 2, 2500, 5000, 'USD', 1),
         ('sl-2', 'sale-g2', 'SODA',  3, 300,  900,  'USD', 1),
         ('sl-3', 'sale-g3', 'STEAK', 1, 2500, 2500, 'USD', 1);"
    ))
    .unwrap();

    s.close_shift(&shift.id, 800, None).unwrap();
    let report = s.get_shift_report(&shift.id).unwrap();

    // Revenue = completed sales only: 5000 + 900 = 5900.
    // COGS = (800 × 2) + (100 × 3) = 1900 (the voided line is excluded).
    // Gross profit = 5900 − 1900 = 4000 (~67.8% margin).
    assert_eq!(report.sale_count, 2);
    assert_eq!(report.cogs_minor, 1900);
    assert_eq!(report.gross_profit_minor, 4000);
    let expected_margin = 4000.0 / 5900.0 * 100.0;
    assert!(
        (report.gross_margin_percent - expected_margin).abs() < 1e-9,
        "margin was {}",
        report.gross_margin_percent
    );
}

#[test]
fn get_shift_report_open_shift() {
    let conn = fresh();
    seed_user(&conn);
    let s = store(&conn);

    // Open a shift but don't close it.
    let shift = s.open_shift("user-1", None, 100).unwrap();
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    conn.execute_batch(&format!(
        "INSERT INTO sales (id, user_id, status, total_minor, payment_method, currency, line_count, created_at, updated_at) VALUES
         ('sale-1', 'user-1', 'completed', 250, 'cash', 'USD', 1, '{now}', '{now}');"
    )).unwrap();

    // Report should still work for an open shift (uses current time as end).
    let report = s.get_shift_report(&shift.id).unwrap();
    assert_eq!(report.shift.status, "open");
    assert!(report.shift.closed_at.is_none());
    assert_eq!(report.sale_count, 1);
    assert_eq!(
        report.payment_breakdown.len(),
        0,
        "no payments table entries"
    );
}

#[test]
fn close_shift_atomic_within_transaction() {
    let conn = fresh();
    seed_user(&conn);
    let s = store(&conn);

    let shift = s.open_shift("user-1", None, 200).unwrap();
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    // Insert a cash sale and a payout.
    conn.execute_batch(&format!(
        "INSERT INTO sales (id, user_id, status, total_minor, payment_method, currency, line_count, created_at, updated_at) VALUES
         ('sale-tx', 'user-1', 'completed', 1000, 'cash', 'USD', 1, '{now}', '{now}');"
    )).unwrap();
    s.create_cash_payout(&shift.id, 300, "safe drop").unwrap();

    // Close the shift — should see both the sale and the payout.
    let closed = s.close_shift(&shift.id, 1000, None).unwrap();

    // expected_cash = opening(200) + cash_sales(1000) - payouts(300) = 900
    assert_eq!(closed.expected_cash_minor, Some(900));
    assert_eq!(closed.cash_difference_minor, Some(100)); // 1000 - 900
    assert_eq!(closed.total_cash_minor, 1000);
    assert_eq!(closed.total_payouts_minor, 300);
}

#[test]
fn get_shift_report_empty_shift() {
    let conn = fresh();
    seed_user(&conn);
    let s = store(&conn);

    let shift = s.open_shift("user-1", None, 100).unwrap();

    let report = s.get_shift_report(&shift.id).unwrap();
    assert_eq!(report.sale_count, 0);
    assert_eq!(report.void_count, 0);
    assert_eq!(report.refund_count, 0);
    assert!(report.payment_breakdown.is_empty());
    assert!(report.hourly_breakdown.is_empty());
}
