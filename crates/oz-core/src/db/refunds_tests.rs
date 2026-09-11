use super::*;
use crate::migrations;
use crate::{Refund, RefundLine};
use rusqlite::Connection;

fn fresh() -> Connection {
    migrations::fresh_db()
}

fn store(conn: &Connection) -> Store<'_> {
    Store::new(conn)
}

fn usd() -> Currency {
    "USD".parse().unwrap()
}

fn price(minor: i64) -> Money {
    Money {
        minor_units: minor,
        currency: usd(),
    }
}

fn seed_completed_sale(conn: &Connection) {
    conn.execute_batch(
        "INSERT INTO products (id, sku, name, price_minor, currency, created_at, updated_at) VALUES
            ('ref-p1', 'COFFEE', 'Coffee', 350, 'USD', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
         INSERT INTO sales (id, total_minor, currency, line_count, status, created_at, updated_at,
                            deduction_locations) VALUES
            ('ref-sale-1', 700, 'USD', 2, 'completed', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z',
             '{\"version\":1,\"lines\":[{\"sale_line_id\":\"ref-sl-1\",\"sku\":\"COFFEE\",\"deductions\":[{\"location_id\":\"01926b3a-0000-7000-8000-000000000001\",\"qty\":2}]}]}');
         INSERT INTO sale_lines (id, sale_id, sku, qty, unit_minor, line_minor, currency, line_position) VALUES
            ('ref-sl-1', 'ref-sale-1', 'COFFEE', 2, 350, 700, 'USD', 1);"
    ).unwrap();
}

/// Seed a sale with multi-location split deductions for FIFO testing.
/// Loc A gets 2, Loc B gets 3.
fn seed_split_location_sale(conn: &Connection) {
    conn.execute_batch(
        "INSERT INTO inventory_locations (id, name, type) VALUES
            ('loc-store', 'Store Inventory', 'store'),
            ('loc-wh-a', 'Warehouse A', 'warehouse');
         INSERT INTO products (id, sku, name, price_minor, currency, created_at, updated_at) VALUES
            ('p-cho', 'CHO-001', 'Choco Bar', 500, 'USD', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
         INSERT INTO sales (id, total_minor, currency, line_count, status, created_at, updated_at,
                            deduction_locations) VALUES
            ('split-sale-1', 2500, 'USD', 1, 'completed', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z',
             '{\"version\":1,\"lines\":[{\"sale_line_id\":\"split-sl-1\",\"sku\":\"CHO-001\",\"deductions\":[{\"location_id\":\"loc-store\",\"qty\":2,\"sold_at\":\"2026-07-19T10:00:00Z\"},{\"location_id\":\"loc-wh-a\",\"qty\":3,\"sold_at\":\"2026-07-19T10:00:01Z\"}]}]}');
         INSERT INTO sale_lines (id, sale_id, sku, qty, unit_minor, line_minor, currency, line_position) VALUES
            ('split-sl-1', 'split-sale-1', 'CHO-001', 5, 500, 2500, 'USD', 1);"
    ).unwrap();
}

#[test]
fn create_refund_persists() {
    let conn = fresh();
    seed_completed_sale(&conn);
    let s = store(&conn);

    let line = RefundLine::new("ref-sl-1", "COFFEE", 2, price(350), price(700));
    let refund = Refund::new(
        "ref-sale-1",
        price(700),
        "customer changed mind",
        "",
        "user-1",
        vec![line],
    );

    s.create_refund(&refund).unwrap();

    let refunds = s.list_refunds_for_sale("ref-sale-1").unwrap();
    assert_eq!(refunds.len(), 1);
    assert_eq!(refunds[0].total.minor_units, 700);
    assert_eq!(refunds[0].total.currency, usd());
    assert_eq!(refunds[0].reason, "customer changed mind");
    assert_eq!(refunds[0].processed_by, "user-1");
    assert_eq!(refunds[0].lines.len(), 1);
    assert_eq!(refunds[0].lines[0].sku, "COFFEE");
    assert_eq!(refunds[0].lines[0].qty, 2);
}

#[test]
fn create_refund_nonexistent_sale_fails() {
    let conn = fresh();
    let s = store(&conn);

    let line = RefundLine::new("sl-x", "COFFEE", 1, price(350), price(350));
    let refund = Refund::new("nonexistent", price(350), "test", "", "user-1", vec![line]);

    let result = s.create_refund(&refund);
    assert!(result.is_err());
}

#[test]
fn list_refunds_empty_for_sale() {
    let conn = fresh();
    seed_completed_sale(&conn);
    let s = store(&conn);
    let refunds = s.list_refunds_for_sale("ref-sale-1").unwrap();
    assert!(refunds.is_empty());
}

#[test]
fn total_refunded_for_sale_no_refunds() {
    let conn = fresh();
    seed_completed_sale(&conn);
    let s = store(&conn);
    // No refunds → zero balance (not NotFound — callers use this as a
    // refundable-balance check).
    let result = s.total_refunded_for_sale("ref-sale-1").unwrap();
    assert_eq!(result.minor_units, 0);
    assert_eq!(result.currency, usd());
}

/// RED: a sale must not be refunded for MORE than the original total. The
/// current code applies no over-refund guard — the same completed sale can
/// be refunded unlimited times, and each refund restores stock.
#[test]
fn create_refund_rejects_over_refund() {
    let conn = fresh();
    seed_completed_sale(&conn);
    let s = store(&conn);

    // First refund: $7 (full amount).
    let line1 = RefundLine::new("ref-sl-1", "COFFEE", 2, price(350), price(700));
    let refund1 = Refund::new(
        "ref-sale-1",
        price(700),
        "refund",
        "",
        "user-1",
        vec![line1],
    );
    s.create_refund(&refund1).unwrap();

    // Second refund: $3.50 (partial — total refunded would be $10.50 > $7 sale).
    let line2 = RefundLine::new("ref-sl-1", "COFFEE", 1, price(350), price(350));
    let refund2 = Refund::new(
        "ref-sale-1",
        price(350),
        "over-refund",
        "",
        "user-1",
        vec![line2],
    );
    let err = s.create_refund(&refund2).unwrap_err();
    assert!(
        matches!(err, CoreError::Validation { .. }),
        "over-refunding a sale must be rejected, got: {err:?}"
    );
}

/// COR-26: the persistence guard must not trust its callers. A refund whose
/// currency differs from the sale's recorded currency must be rejected at
/// `create_refund` — otherwise the over-refund guard (which sums refunds
/// `WHERE currency = <refund currency>`) can be bypassed by refunding the
/// same sale once per currency, and cross-currency minor-unit amounts are
/// compared against the wrong unit entirely.
#[test]
fn create_refund_rejects_currency_mismatch() {
    let conn = fresh();
    seed_completed_sale(&conn);
    let s = store(&conn);

    let eur: Currency = "EUR".parse().unwrap();
    let line = RefundLine::new(
        "ref-sl-1",
        "COFFEE",
        2,
        Money {
            minor_units: 350,
            currency: eur,
        },
        Money {
            minor_units: 700,
            currency: eur,
        },
    );
    let refund = Refund::new(
        "ref-sale-1",
        Money {
            minor_units: 700,
            currency: eur,
        },
        "wrong currency",
        "",
        "user-1",
        vec![line],
    );

    let err = s.create_refund(&refund).unwrap_err();
    assert!(
        matches!(err, CoreError::CurrencyMismatch(..)),
        "a refund in a currency other than the sale's must be rejected, got: {err:?}"
    );
}

/// COR-25: the over-refund guard must fail CLOSED. The cumulative SUM read
/// used `.unwrap_or(0)`, so a read error — e.g. an integer SUM overflowing
/// to float and failing the i64 decode — was silently read as "no refunds
/// yet" and the guard let the refund through. Seed a sale totalling
/// `i64::MAX` with two recorded refunds of `i64::MAX/2 + 1` each (the shape
/// sync replay or a direct write can produce), making the SUM unreadable,
/// then attempt a third refund: it must be rejected, not treated as the
/// first one.
#[test]
fn over_refund_guard_fails_closed_when_cumulative_sum_unreadable() {
    let conn = fresh();
    let half = i64::MAX / 2 + 1; // 4_611_686_018_427_387_904
    conn.execute_batch(&format!(
        "INSERT INTO sales (id, total_minor, currency, line_count, status, created_at, updated_at)
         VALUES ('ovf-sale', {max}, 'USD', 0, 'completed', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
         INSERT INTO refunds (id, sale_id, total_minor, currency, reason, processed_by, created_at) VALUES
             ('ovf-r1', 'ovf-sale', {half}, 'USD', 'replayed', 'user-1', '2025-01-01T00:00:00.000Z'),
             ('ovf-r2', 'ovf-sale', {half}, 'USD', 'replayed', 'user-1', '2025-01-01T00:00:00.000Z');",
        max = i64::MAX
    ))
    .unwrap();
    let s = store(&conn);

    let refund = Refund::new("ovf-sale", price(1), "third", "", "user-1", vec![]);
    let result = s.create_refund(&refund);
    assert!(
        result.is_err(),
        "guard must fail closed when the cumulative refunded SUM cannot be read, \
         got Ok — the refund was accepted against an unknown refunded balance"
    );

    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM refunds WHERE sale_id = 'ovf-sale'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 2, "the rejected refund must not be persisted");
}

#[test]
fn multiple_partial_refunds() {
    let conn = fresh();
    seed_completed_sale(&conn);
    let s = store(&conn);

    // First refund: 1 item.
    let line1 = RefundLine::new("ref-sl-1", "COFFEE", 1, price(350), price(350));
    let r1 = Refund::new(
        "ref-sale-1",
        price(350),
        "partial",
        "",
        "user-1",
        vec![line1],
    );
    s.create_refund(&r1).unwrap();

    // Second refund: 1 item.
    let line2 = RefundLine::new("ref-sl-1", "COFFEE", 1, price(350), price(350));
    let r2 = Refund::new(
        "ref-sale-1",
        price(350),
        "partial",
        "",
        "user-1",
        vec![line2],
    );
    s.create_refund(&r2).unwrap();

    let refunds = s.list_refunds_for_sale("ref-sale-1").unwrap();
    assert_eq!(refunds.len(), 2);
    assert_eq!(refunds[0].total.minor_units, 350);
    assert_eq!(refunds[1].total.minor_units, 350);

    // Verify audit log entries.
    let audit_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM audit_log WHERE action = 'sale.refund' AND target_id = 'ref-sale-1'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(audit_count, 2);
}

// ── ADR-19 §5.3 FIFO refund stock restoration tests ─────────────

fn get_stock_at(conn: &Connection, sku: &str, location_id: &str) -> i64 {
    conn.query_row(
        "SELECT COALESCE(qty, 0) FROM stock_summary
         WHERE item_id = (SELECT id FROM products WHERE sku = ?1)
         AND location_id = ?2",
        rusqlite::params![sku, location_id],
        |row| row.get(0),
    )
    .unwrap_or(0)
}

/// Full refund of a split-location sale — stock should be credited
/// forward (oldest deduction first): loc-store gets +2, loc-wh-a gets +3.
#[test]
fn refund_credits_split_location_full_refund_forward_fifo() {
    let conn = fresh();
    seed_split_location_sale(&conn);
    let s = store(&conn);

    // Initial stock is 0 at both locations.
    assert_eq!(get_stock_at(&conn, "CHO-001", "loc-store"), 0);
    assert_eq!(get_stock_at(&conn, "CHO-001", "loc-wh-a"), 0);

    // Full refund of all 5 units.
    let line = RefundLine::new("split-sl-1", "CHO-001", 5, price(500), price(2500));
    let refund = Refund::new(
        "split-sale-1",
        price(2500),
        "full refund",
        "",
        "user-1",
        vec![line],
    );
    s.create_refund(&refund).unwrap();

    // Stock credited forward: 2 to loc-store, 3 to loc-wh-a.
    assert_eq!(
        get_stock_at(&conn, "CHO-001", "loc-store"),
        2,
        "store gets 2 (oldest deduction first)"
    );
    assert_eq!(
        get_stock_at(&conn, "CHO-001", "loc-wh-a"),
        3,
        "warehouse gets 3 (second deduction)"
    );

    // Verify audit log.
    let audit_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM audit_log WHERE action = 'sale.refund' AND target_id = 'split-sale-1'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(audit_count, 1);
}

/// Partial refund of a split-location line — stock should be credited
/// in REVERSE order (most recent deduction first): loc-wh-a gets credited
/// before loc-store.
#[test]
fn refund_credits_split_location_partial_refund_reverse_order() {
    let conn = fresh();
    seed_split_location_sale(&conn);
    let s = store(&conn);

    // Refund 2 of 5 units (partial).
    let line = RefundLine::new("split-sl-1", "CHO-001", 2, price(500), price(1000));
    let refund = Refund::new(
        "split-sale-1",
        price(1000),
        "partial refund 2",
        "",
        "user-1",
        vec![line],
    );
    s.create_refund(&refund).unwrap();

    // Stock credited in reverse: loc-wh-a (most recent) gets 2,
    // loc-store gets 0 (remaining = 0 after warehouse covers it).
    assert_eq!(
        get_stock_at(&conn, "CHO-001", "loc-store"),
        0,
        "store gets 0 (partial refund credits most recent deduction first)"
    );
    assert_eq!(
        get_stock_at(&conn, "CHO-001", "loc-wh-a"),
        2,
        "warehouse gets 2 (most recent deduction credited first)"
    );
}

/// Partial refund that spans two deduction locations — credit crosses
/// from most recent to oldest.
#[test]
fn refund_credits_across_two_locations_partial() {
    let conn = fresh();
    seed_split_location_sale(&conn);
    let s = store(&conn);

    // Refund 4 of 5 units — should exhaust loc-wh-a (3) and take 1 from loc-store.
    let line = RefundLine::new("split-sl-1", "CHO-001", 4, price(500), price(2000));
    let refund = Refund::new(
        "split-sale-1",
        price(2000),
        "partial refund 4",
        "",
        "user-1",
        vec![line],
    );
    s.create_refund(&refund).unwrap();

    assert_eq!(
        get_stock_at(&conn, "CHO-001", "loc-wh-a"),
        3,
        "warehouse gets full 3 (most recent deduction first)"
    );
    assert_eq!(
        get_stock_at(&conn, "CHO-001", "loc-store"),
        1,
        "store gets remaining 1 after warehouse exhausted"
    );
}

/// Refund with qty larger than original deduction should fail.
#[test]
fn refund_qty_exceeds_original_deduction_fails() {
    let conn = fresh();
    seed_split_location_sale(&conn);
    let s = store(&conn);

    let line = RefundLine::new("split-sl-1", "CHO-001", 99, price(500), price(49500));
    let refund = Refund::new(
        "split-sale-1",
        price(49500),
        "excessive refund",
        "",
        "user-1",
        vec![line],
    );
    let result = s.create_refund(&refund);
    assert!(result.is_err(), "refund exceeding original qty should fail");
    match result.unwrap_err() {
        // The over-refund (total) guard fires first — the refund amount
        // 49500 exceeds the sale total 2500. The qty guard is the
        // second-line check.
        CoreError::Validation { field, .. } => {
            assert!(
                field == "total" || field == "refund_line.qty",
                "expected total or qty validation, got field: {field}"
            );
        }
        other => panic!("expected Validation error, got: {other:?}"),
    }
}

/// Legacy sale (NULL deduction_locations) falls back to default location.
#[test]
fn refund_legacy_sale_with_null_deduction_locations() {
    let conn = fresh();
    // The default location (01926b3a-...-001) is seeded by migration 078.
    // Use the old seed that sets deduction_locations = NULL explicitly.
    conn.execute_batch(
        "INSERT INTO products (id, sku, name, price_minor, currency, created_at, updated_at) VALUES
            ('legacy-p1', 'LEGACY', 'Legacy Item', 100, 'USD', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
         INSERT INTO sales (id, total_minor, currency, line_count, status, created_at, updated_at) VALUES
            ('legacy-sale-1', 200, 'USD', 1, 'completed', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
         INSERT INTO sale_lines (id, sale_id, sku, qty, unit_minor, line_minor, currency, line_position) VALUES
            ('legacy-sl-1', 'legacy-sale-1', 'LEGACY', 2, 100, 200, 'USD', 1);"
    ).unwrap();
    let s = store(&conn);

    let line = RefundLine::new("legacy-sl-1", "LEGACY", 2, price(100), price(200));
    let refund = Refund::new(
        "legacy-sale-1",
        price(200),
        "legacy refund",
        "",
        "user-1",
        vec![line],
    );
    s.create_refund(&refund).unwrap();

    // Stock should be credited to default location.
    assert_eq!(
        get_stock_at(&conn, "LEGACY", "01926b3a-0000-7000-8000-000000000001"),
        2,
        "legacy refund credits to default location"
    );

    // Audit log should have the legacy warning entry (targets the refund,
    // not the sale, to avoid shadowing the primary `sale.refund` entry).
    let warn_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM audit_log WHERE action = 'sale.refund.legacy' AND target_id = ?1",
            params![refund.id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        warn_count, 1,
        "legacy fallback should emit a warning audit entry"
    );
}

/// Verify that a refund correctly updates the stock_movements ledger.
#[test]
fn refund_creates_positive_stock_movements() {
    let conn = fresh();
    seed_split_location_sale(&conn);
    let s = store(&conn);

    let line = RefundLine::new("split-sl-1", "CHO-001", 3, price(500), price(1500));
    let refund = Refund::new(
        "split-sale-1",
        price(1500),
        "partial refund 3",
        "",
        "user-1",
        vec![line],
    );
    s.create_refund(&refund).unwrap();

    // Check that stock_movements has positive entries with reason 'refund' and location_id set.
    let movement_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM stock_movements
             WHERE item_id = (SELECT id FROM products WHERE sku = 'CHO-001')
             AND reason = 'refund' AND delta > 0",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        movement_count, 1,
        "should have one positive movement (wh-a gets 3)"
    );

    let total_delta: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(delta), 0) FROM stock_movements
             WHERE item_id = (SELECT id FROM products WHERE sku = 'CHO-001')
             AND reason = 'refund'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        total_delta, 3,
        "total credited delta should match refund qty"
    );
}

// ── Additional edge cases ─────────────────────────────────────

#[test]
fn create_refund_note_persisted() {
    let conn = fresh();
    seed_completed_sale(&conn);
    let s = store(&conn);

    let line = RefundLine::new("ref-sl-1", "COFFEE", 2, price(350), price(700));
    let refund = Refund::new(
        "ref-sale-1",
        price(700),
        "defective",
        "Customer reported broken seal",
        "user-2",
        vec![line],
    );
    s.create_refund(&refund).unwrap();

    let refunds = s.list_refunds_for_sale("ref-sale-1").unwrap();
    assert_eq!(refunds.len(), 1);
    assert_eq!(refunds[0].note.as_str(), "Customer reported broken seal");
    assert_eq!(refunds[0].processed_by, "user-2");
}

#[test]
fn list_refunds_nonexistent_sale_returns_empty() {
    let conn = fresh();
    let s = store(&conn);
    let refunds = s.list_refunds_for_sale("no-such-sale").unwrap();
    assert!(refunds.is_empty());
}

#[test]
fn total_refunded_for_sale_accumulates() {
    let conn = fresh();
    seed_completed_sale(&conn);
    let s = store(&conn);

    // First refund: 350
    let line1 = RefundLine::new("ref-sl-1", "COFFEE", 1, price(350), price(350));
    let r1 = Refund::new(
        "ref-sale-1",
        price(350),
        "partial",
        "",
        "user-1",
        vec![line1],
    );
    s.create_refund(&r1).unwrap();

    // Second refund: 350
    let line2 = RefundLine::new("ref-sl-1", "COFFEE", 1, price(350), price(350));
    let r2 = Refund::new(
        "ref-sale-1",
        price(350),
        "partial",
        "",
        "user-1",
        vec![line2],
    );
    s.create_refund(&r2).unwrap();

    let total = s.total_refunded_for_sale("ref-sale-1").unwrap();
    assert_eq!(total.minor_units, 700);
}

#[test]
fn refund_line_not_in_deductions_fails() {
    let conn = fresh();
    seed_completed_sale(&conn);
    // A real sale_lines row that this sale's deduction_locations JSON does NOT
    // list. The guard needs that row to exist: a refund line naming no line of
    // the sale at all is refused earlier, for there being no sold quantity to
    // bound it (see create_refund_rejects_unknown_sale_line_id_on_a_legacy_sale),
    // and the JSON lookup below would never run.
    conn.execute(
        "INSERT INTO sale_lines (id, sale_id, sku, qty, unit_minor, line_minor, currency, line_position)
         VALUES ('non-existent-sl', 'ref-sale-1', 'COFFEE', 1, 350, 350, 'USD', 9)",
        [],
    )
    .unwrap();
    let s = store(&conn);

    // Refund line references a sale_line_id that doesn't exist in deduction_locations JSON.
    let line = RefundLine::new("non-existent-sl", "COFFEE", 1, price(350), price(350));
    let refund = Refund::new("ref-sale-1", price(350), "test", "", "user-1", vec![line]);
    let err = s.create_refund(&refund).unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "deduction_locations"));
}

#[test]
fn refund_malformed_deduction_locations_json_fails() {
    let conn = fresh();
    // Sale with deliberately bad JSON in deduction_locations.
    conn.execute_batch(
        "INSERT INTO products (id, sku, name, price_minor, currency, created_at, updated_at) VALUES
            ('bad-p1', 'BAD', 'Bad Item', 100, 'USD', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
         INSERT INTO sales (id, total_minor, currency, line_count, status, created_at, updated_at,
                            deduction_locations) VALUES
            ('bad-sale-1', 100, 'USD', 1, 'completed', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z',
             '{invalid json}');
         INSERT INTO sale_lines (id, sale_id, sku, qty, unit_minor, line_minor, currency, line_position) VALUES
            ('bad-sl-1', 'bad-sale-1', 'BAD', 1, 100, 100, 'USD', 1);"
    ).unwrap();
    let s = store(&conn);

    let line = RefundLine::new("bad-sl-1", "BAD", 1, price(100), price(100));
    let refund = Refund::new("bad-sale-1", price(100), "test", "", "user-1", vec![line]);
    let err = s.create_refund(&refund).unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "deduction_locations"));
}

#[test]
fn list_refunds_multiple_sales_isolation() {
    let conn = fresh();
    seed_completed_sale(&conn);
    // Also seed a second sale with a different sale ID.
    conn.execute_batch(
        "INSERT INTO sales (id, total_minor, currency, line_count, status, created_at, updated_at,
                            deduction_locations) VALUES
            ('ref-sale-2', 350, 'USD', 1, 'completed', '2025-01-02T00:00:00.000Z', '2025-01-02T00:00:00.000Z',
             '{\"version\":1,\"lines\":[{\"sale_line_id\":\"ref-sl-2\",\"sku\":\"COFFEE\",\"deductions\":[{\"location_id\":\"01926b3a-0000-7000-8000-000000000001\",\"qty\":1}]}]}');
         INSERT INTO sale_lines (id, sale_id, sku, qty, unit_minor, line_minor, currency, line_position) VALUES
            ('ref-sl-2', 'ref-sale-2', 'COFFEE', 1, 350, 350, 'USD', 1);"
    ).unwrap();
    let s = store(&conn);

    // Refund for sale-1
    let line1 = RefundLine::new("ref-sl-1", "COFFEE", 1, price(350), price(350));
    let r1 = Refund::new(
        "ref-sale-1",
        price(350),
        "partial",
        "",
        "user-1",
        vec![line1],
    );
    s.create_refund(&r1).unwrap();

    // Only refunds for sale-1 should appear
    let refunds1 = s.list_refunds_for_sale("ref-sale-1").unwrap();
    assert_eq!(refunds1.len(), 1);

    // Sale-2 should have zero refunds
    let refunds2 = s.list_refunds_for_sale("ref-sale-2").unwrap();
    assert!(refunds2.is_empty());
}

#[test]
fn total_refunded_for_nonexistent_sale_returns_not_found() {
    let conn = fresh();
    let s = store(&conn);
    let err = s.total_refunded_for_sale("no-such-sale").unwrap_err();
    assert!(matches!(err, CoreError::NotFound { .. }));
}

#[test]
fn refund_zero_price_line_restores_stock() {
    let conn = fresh();
    seed_completed_sale(&conn);
    let s = store(&conn);

    // A refund with zero-price line but positive qty should still restore stock.
    let line = RefundLine::new("ref-sl-1", "COFFEE", 1, price(0), price(0));
    let refund = Refund::new(
        "ref-sale-1",
        price(0),
        "zero price",
        "",
        "user-1",
        vec![line],
    );
    s.create_refund(&refund).unwrap();

    // Stock should still be restored despite zero monetary value.
    let movement_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM stock_movements WHERE reason = 'refund' AND delta > 0",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        movement_count, 1,
        "zero-price refund should still create stock movement"
    );
}

#[test]
fn refund_empty_lines_vector_persists_refund_header() {
    let conn = fresh();
    seed_completed_sale(&conn);
    let s = store(&conn);

    // Refund with empty lines vec — still creates the refund header row.
    let refund = Refund::new("ref-sale-1", price(0), "void", "", "user-1", vec![]);
    s.create_refund(&refund).unwrap();

    let refunds = s.list_refunds_for_sale("ref-sale-1").unwrap();
    assert_eq!(refunds.len(), 1);
    assert_eq!(refunds[0].reason, "void");
    assert_eq!(refunds[0].lines.len(), 0);
}

#[test]
fn refund_partial_exact_qty_treated_as_full_forward_fifo() {
    let conn = fresh();
    seed_split_location_sale(&conn);
    let s = store(&conn);

    // Refund qty = total_deducted = 5 (exact match). Code does
    // `if refund_qty >= total_deducted` → forward FIFO path.
    let line = RefundLine::new("split-sl-1", "CHO-001", 5, price(500), price(2500));
    let refund = Refund::new(
        "split-sale-1",
        price(2500),
        "full refund",
        "",
        "user-1",
        vec![line],
    );
    s.create_refund(&refund).unwrap();

    // Forward FIFO: loc-store gets 2, loc-wh-a gets 3.
    assert_eq!(get_stock_at(&conn, "CHO-001", "loc-store"), 2);
    assert_eq!(get_stock_at(&conn, "CHO-001", "loc-wh-a"), 3);
}

// ── LOY-03 wiring: create_refund reverses loyalty in-tx ────────

#[test]
fn create_refund_reverses_loyalty_proportionally() {
    let conn = fresh();
    seed_completed_sale(&conn); // total 700 USD
    conn.execute(
        "INSERT INTO customers (id, name, notes, created_at, updated_at)
         VALUES ('cust-ref', 'Bob', '', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
        [],
    )
    .unwrap();
    conn.execute(
        "UPDATE sales SET customer_id = 'cust-ref' WHERE id = 'ref-sale-1'",
        [],
    )
    .unwrap();
    let s = store(&conn);
    // Bronze: 700 earns 70 points.
    s.earn_points("cust-ref", "ref-sale-1", 700).unwrap();

    let line = RefundLine::new("ref-sl-1", "COFFEE", 1, price(350), price(350));
    let refund = Refund::new(
        "ref-sale-1",
        price(350),
        "one of two cups",
        "",
        "user-1",
        vec![line],
    );
    s.create_refund(&refund).unwrap();

    // 350/700 of 70 points = 35 reversed.
    let reversed: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(points), 0) FROM loyalty_transactions WHERE sale_id = 'ref-sale-1' AND txn_type = 'refund_reversal'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(reversed, -35);
    let points: i64 = conn
        .query_row(
            "SELECT points FROM loyalty_accounts WHERE customer_id = 'cust-ref'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(points, 35);
}

#[test]
fn create_refund_without_loyalty_still_succeeds() {
    let conn = fresh();
    seed_completed_sale(&conn);
    let s = store(&conn);
    let line = RefundLine::new("ref-sl-1", "COFFEE", 2, price(350), price(700));
    let refund = Refund::new(
        "ref-sale-1",
        price(700),
        "changed mind",
        "",
        "user-1",
        vec![line],
    );
    // No earn txn on this sale: reversal is a no-op, refund unaffected.
    s.create_refund(&refund).unwrap();
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM loyalty_transactions", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(count, 0);
}

#[test]
fn create_refund_reduces_customer_lifetime_spend() {
    let conn = fresh();
    seed_completed_sale(&conn); // total 700 USD
    conn.execute(
        "INSERT INTO customers (id, name, notes, total_spent_minor, created_at, updated_at)
         VALUES ('cust-ref', 'Bob', '', 700, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
        [],
    )
    .unwrap();
    conn.execute(
        "UPDATE sales SET customer_id = 'cust-ref' WHERE id = 'ref-sale-1'",
        [],
    )
    .unwrap();
    let s = store(&conn);
    let line = RefundLine::new("ref-sl-1", "COFFEE", 1, price(350), price(350));
    let refund = Refund::new(
        "ref-sale-1",
        price(350),
        "half back",
        "",
        "user-1",
        vec![line],
    );
    s.create_refund(&refund).unwrap();
    let spent: i64 = conn
        .query_row(
            "SELECT total_spent_minor FROM customers WHERE id = 'cust-ref'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(spent, 350, "lifetime spend drops by the refunded amount");
}

#[test]
fn create_refund_spend_reversal_floors_at_zero() {
    let conn = fresh();
    seed_completed_sale(&conn); // total 700 USD
    // Legacy customer whose spend was never accrued (projection gap).
    conn.execute(
        "INSERT INTO customers (id, name, notes, total_spent_minor, created_at, updated_at)
         VALUES ('cust-ref', 'Bob', '', 0, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
        [],
    )
    .unwrap();
    conn.execute(
        "UPDATE sales SET customer_id = 'cust-ref' WHERE id = 'ref-sale-1'",
        [],
    )
    .unwrap();
    let s = store(&conn);
    let line = RefundLine::new("ref-sl-1", "COFFEE", 2, price(350), price(700));
    let refund = Refund::new(
        "ref-sale-1",
        price(700),
        "full refund",
        "",
        "user-1",
        vec![line],
    );
    s.create_refund(&refund).unwrap();
    let spent: i64 = conn
        .query_row(
            "SELECT total_spent_minor FROM customers WHERE id = 'cust-ref'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(spent, 0, "spend floors at zero, never negative");
}

// ── Cumulative QUANTITY bound ──────────────────────────────────
//
// The sale total bounds VALUE; nothing bounded UNITS per sale line, so one
// line could be refunded again and again — each refund restoring stock — as
// long as each refund stayed inside the money bound. These tests pin the
// quantity bound. The seeded sale also carries a second line, so a rejection
// can be attributed to the quantity guard rather than to the money guard.

/// The canonical default location, seeded by migration 078.
const DEFAULT_LOC: &str = "01926b3a-0000-7000-8000-000000000001";

/// Seed a completed sale whose first line sold 10 units of TEA at 100 (1000)
/// plus a second line of 1 unit of JAM at 500, for a sale total of 1500, with
/// both lines deducted from the default location.
///
/// The 500 of non-TEA value matters: it lets a repeated refund stay inside the
/// cumulative MONEY bound while exceeding the TEA line's sold quantity —
/// exactly the hole the cumulative QUANTITY bound closes.
fn seed_quantity_sale(conn: &Connection) {
    conn.execute_batch(
        "INSERT INTO products (id, sku, name, price_minor, currency, created_at, updated_at) VALUES
            ('qty-p1', 'TEA', 'Tea', 100, 'USD', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
            ('qty-p2', 'JAM', 'Jam', 500, 'USD', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
         INSERT INTO sales (id, total_minor, currency, line_count, status, created_at, updated_at,
                            deduction_locations) VALUES
            ('qty-sale-1', 1500, 'USD', 2, 'completed', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z',
             '{\"version\":1,\"lines\":[{\"sale_line_id\":\"qty-sl-1\",\"sku\":\"TEA\",\"deductions\":[{\"location_id\":\"01926b3a-0000-7000-8000-000000000001\",\"qty\":10}]},{\"sale_line_id\":\"qty-sl-2\",\"sku\":\"JAM\",\"deductions\":[{\"location_id\":\"01926b3a-0000-7000-8000-000000000001\",\"qty\":1}]}]}');
         INSERT INTO sale_lines (id, sale_id, sku, qty, unit_minor, line_minor, currency, line_position) VALUES
            ('qty-sl-1', 'qty-sale-1', 'TEA', 10, 100, 1000, 'USD', 1),
            ('qty-sl-2', 'qty-sale-1', 'JAM', 1, 500, 500, 'USD', 2);"
    ).unwrap();
}

/// A refund of [qty] units of the 10-unit TEA line, charged at [minor] minor
/// units in the sale's currency.
fn tea_refund(qty: i64, minor: i64) -> Refund {
    let line = RefundLine::new("qty-sl-1", "TEA", qty, price(100), price(minor));
    Refund::new(
        "qty-sale-1",
        price(minor),
        "quantity bound",
        "",
        "user-1",
        vec![line],
    )
}

/// Repeated 60%-of-sold refunds of one line: the FIRST is legitimate, the
/// SECOND already returns 12 of the 10 units sold and must be rejected (and
/// not by the money bound — 600 + 600 is 1200 of a 1500 sale), and nothing
/// after it is accepted for that line.
#[test]
fn create_refund_rejects_repeated_60_percent_quantity_refunds() {
    let conn = fresh();
    seed_quantity_sale(&conn);
    let s = store(&conn);

    // 60% of the 10 units sold = 6 units.
    s.create_refund(&tea_refund(6, 600)).unwrap();
    assert_eq!(
        get_stock_at(&conn, "TEA", DEFAULT_LOC),
        6,
        "the first 60% refund credits its own units"
    );

    let err = s.create_refund(&tea_refund(6, 600)).unwrap_err();
    assert!(
        matches!(err, CoreError::Validation { field, .. } if field == "refund_line.qty"),
        "12 cumulative units of a 10-unit line must be rejected by the \
         QUANTITY bound (the money bound cannot fire: 1200 of 1500), got: {err:?}"
    );

    // A third refund of the same line — priced so low that only a quantity
    // guard can object — is still rejected.
    let third = s.create_refund(&tea_refund(6, 100)).unwrap_err();
    assert!(
        matches!(third, CoreError::Validation { field, .. } if field == "refund_line.qty"),
        "a third refund of an exhausted line must be rejected, got: {third:?}"
    );

    let refund_rows: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM refunds WHERE sale_id = 'qty-sale-1'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let line_rows: i64 = conn
        .query_row("SELECT COUNT(*) FROM refund_lines", [], |r| r.get(0))
        .unwrap();
    assert_eq!(refund_rows, 1, "a rejected refund persists no header row");
    assert_eq!(line_rows, 1, "a rejected refund persists no line row");
    assert_eq!(
        get_stock_at(&conn, "TEA", DEFAULT_LOC),
        6,
        "rejected refunds must not restore a single unit"
    );
}

/// Two legitimate partial refunds that together reach the sold quantity, then a
/// third unit that overshoots: 6 + 4 = 10 accepted, +1 rejected. This is the
/// shape the missing bound allowed — one line refunded several times — stopped
/// exactly at the sold quantity.
#[test]
fn create_refund_accepts_partials_to_full_qty_and_rejects_the_third() {
    let conn = fresh();
    seed_quantity_sale(&conn);
    let s = store(&conn);

    s.create_refund(&tea_refund(6, 600)).unwrap(); // 60% of sold
    s.create_refund(&tea_refund(4, 400)).unwrap(); // remaining 40%

    assert_eq!(
        get_stock_at(&conn, "TEA", DEFAULT_LOC),
        10,
        "two partial refunds summing to the sold quantity credit all 10 units"
    );

    let err = s.create_refund(&tea_refund(1, 100)).unwrap_err();
    assert!(
        matches!(err, CoreError::Validation { field, .. } if field == "refund_line.qty"),
        "one unit past the sold quantity must be rejected, got: {err:?}"
    );
    assert_eq!(get_stock_at(&conn, "TEA", DEFAULT_LOC), 10);
    assert_eq!(s.list_refunds_for_sale("qty-sale-1").unwrap().len(), 2);
}

/// A legitimate full-quantity refund — the whole line at full value — must
/// still succeed and must restore the entire quantity. Guards against a bound
/// that rejects the boundary case it exists to allow (prior + requested ==
/// sold).
#[test]
fn create_refund_full_quantity_refund_still_succeeds() {
    let conn = fresh();
    seed_quantity_sale(&conn);
    let s = store(&conn);

    s.create_refund(&tea_refund(10, 1000)).unwrap();

    let refunds = s.list_refunds_for_sale("qty-sale-1").unwrap();
    assert_eq!(refunds.len(), 1);
    assert_eq!(refunds[0].lines[0].qty, 10);
    assert_eq!(
        get_stock_at(&conn, "TEA", DEFAULT_LOC),
        10,
        "a full-quantity refund credits the whole line back"
    );
    assert_eq!(
        s.total_refunded_for_sale("qty-sale-1").unwrap().minor_units,
        1000
    );
}

/// The bound is per sale line, not per sale: exhausting the TEA line must not
/// block a refund of the JAM line on the same sale.
#[test]
fn create_refund_quantity_bound_is_per_line_not_per_sale() {
    let conn = fresh();
    seed_quantity_sale(&conn);
    let s = store(&conn);

    s.create_refund(&tea_refund(10, 1000)).unwrap();

    let jam = RefundLine::new("qty-sl-2", "JAM", 1, price(500), price(500));
    let refund = Refund::new(
        "qty-sale-1",
        price(500),
        "other line",
        "",
        "user-1",
        vec![jam],
    );
    s.create_refund(&refund)
        .unwrap_or_else(|e| panic!("a distinct sale line must stay refundable, got: {e:?}"));

    assert_eq!(
        get_stock_at(&conn, "TEA", DEFAULT_LOC),
        10,
        "the exhausted TEA line is credited once, not twice"
    );
    assert_eq!(
        get_stock_at(&conn, "JAM", DEFAULT_LOC),
        1,
        "the second line's refund credits its own unit"
    );
}

// ── The credit path that has no deduction_locations ────────────
//
// Both cumulative bounds are only meaningful if the line they bound against
// exists. refund_lines.sale_line_id carries NO foreign key
// (migrations/20260813_init.sql:537-539), so a bogus id inserts cleanly, and a
// legacy or imported sale — create_sale never writes deduction_locations
// (sales_lifecycle.rs:527-531) — routes restoration to
// credit_refund_to_default_location, which credited refund_line.qty with
// neither a per-line nor a cumulative bound. The money cap cannot see it
// either: it folds the CALLER-SUPPLIED line total, so a refund priced at zero
// passes it with room to spare.

/// Seed a legacy sale: deduction_locations explicitly NULL (the import/CLI
/// shape), one 10-unit line of TEA2 at 100 (1000) inside a 1500 sale, so the
/// money bound keeps a wide margin and only a quantity bound can object.
fn seed_legacy_quantity_sale(conn: &Connection) {
    conn.execute_batch(
        "INSERT INTO products (id, sku, name, price_minor, currency, created_at, updated_at) VALUES
            ('legx-p1', 'TEA2', 'Tea2', 100, 'USD', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
         INSERT INTO sales (id, total_minor, currency, line_count, status, created_at, updated_at,
                            deduction_locations) VALUES
            ('legx-sale-1', 1500, 'USD', 1, 'completed', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z', NULL);
         INSERT INTO sale_lines (id, sale_id, sku, qty, unit_minor, line_minor, currency, line_position) VALUES
            ('legx-sl-1', 'legx-sale-1', 'TEA2', 10, 100, 1000, 'USD', 1);"
    ).unwrap();
}

/// A refund of [qty] units of the legacy 10-unit line at [minor] of value.
fn legacy_refund(qty: i64, minor: i64) -> Refund {
    let line = RefundLine::new("legx-sl-1", "TEA2", qty, price(100), price(minor));
    Refund::new(
        "legx-sale-1",
        price(minor),
        "legacy qty",
        "",
        "user-1",
        vec![line],
    )
}

/// THE REPRODUCE, and it FAILS AGAINST HEAD: a legacy (deduction_locations
/// NULL) completed sale, one refund line whose sale_line_id exists in no
/// sale_lines row, qty 10^9, priced at zero so the money cap never engages.
/// HEAD's 0b guard CONTINUED past the missing row and the default-location
/// credit path had no bound at all, so this returned Ok and put a billion
/// phantom units on the shelf. Absence of a row is not a licence to mint
/// stock: it must be rejected, persist nothing, and credit nothing.
#[test]
fn create_refund_rejects_unknown_sale_line_id_on_a_legacy_sale() {
    let conn = fresh();
    seed_legacy_quantity_sale(&conn);
    let s = store(&conn);

    let ghost = RefundLine::new("legx-sl-GHOST", "TEA2", 1_000_000_000, price(0), price(0));
    let refund = Refund::new(
        "legx-sale-1",
        price(0),
        "phantom stock",
        "",
        "user-1",
        vec![ghost],
    );

    let err = s
        .create_refund(&refund)
        .expect_err("a refund line naming no line of this sale must be rejected");
    assert!(
        matches!(&err, CoreError::Validation { field, .. }
            if *field == "refund_line.sale_line_id"),
        "the unknown sale_line_id must be refused by the quantity guard, got: {err:?}"
    );

    let credited: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(delta), 0) FROM stock_movements WHERE reason = 'refund'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        credited, 0,
        "not one unit may reach the shelf for a bogus line"
    );
    let rows: i64 = conn
        .query_row("SELECT COUNT(*) FROM refunds", [], |r| r.get(0))
        .unwrap();
    assert_eq!(rows, 0, "the rejected refund persists nothing");
}

/// The cumulative case on the path with no deduction_locations: three partial
/// refunds of a legacy 10-unit line, each individually plausible and each
/// priced so the money cap waves it through. 4 + 4 land, the third 4 is
/// rejected at 12 of 10, and the last 2 units still fit — the bound stops at
/// sold, not before it.
#[test]
fn create_refund_bounds_cumulative_quantity_on_a_legacy_sale_line() {
    let conn = fresh();
    seed_legacy_quantity_sale(&conn);
    let s = store(&conn);

    s.create_refund(&legacy_refund(4, 300)).unwrap();
    s.create_refund(&legacy_refund(4, 300)).unwrap();
    assert_eq!(
        get_stock_at(&conn, "TEA2", DEFAULT_LOC),
        8,
        "two refunds of 4 units credit 8"
    );

    let err = s.create_refund(&legacy_refund(4, 300)).unwrap_err();
    assert!(
        matches!(err, CoreError::Validation { field, .. } if field == "refund_line.qty"),
        "the third refund takes the line past its 10 sold units, got: {err:?}"
    );
    assert_eq!(
        get_stock_at(&conn, "TEA2", DEFAULT_LOC),
        8,
        "the rejected third refund credits nothing"
    );

    s.create_refund(&legacy_refund(2, 100))
        .unwrap_or_else(|e| panic!("the last 2 units of a 10-unit line must refund, got: {e:?}"));
    assert_eq!(
        get_stock_at(&conn, "TEA2", DEFAULT_LOC),
        10,
        "exactly the sold quantity can come back, no more"
    );
}

/// The credit site's own arithmetic must not wrap. Seed a prior refund that
/// already booked i64::MAX - 1 units against the real line (a corrupt import
/// or a sync replay can), then drive credit_refund_to_default_location
/// DIRECTLY — bypassing create_refund — so this pins the add at the credit
/// site rather than the guard above it. already_credited + refund_line.qty
/// overflows i64 there; it must surface as a rejection, never as a negative
/// sum that slips the comparison and credits stock.
#[test]
fn default_location_credit_rejects_instead_of_wrapping_near_i64_max() {
    let conn = fresh();
    seed_legacy_quantity_sale(&conn);
    conn.execute(
        "INSERT INTO refunds (id, sale_id, total_minor, currency, reason, note, processed_by, created_at)
         VALUES ('legx-r-prior', 'legx-sale-1', 0, 'USD', 'prior', '', 'user-1',
                 '2025-01-01T00:00:00.000Z')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO refund_lines (id, refund_id, sale_line_id, sku, qty, unit_minor, line_minor, currency, created_at)
         VALUES ('legx-rl-prior', 'legx-r-prior', 'legx-sl-1', 'TEA2', ?1, 0, 0, 'USD',
                 '2025-01-01T00:00:00.000Z')",
        params![i64::MAX - 1],
    )
    .unwrap();
    let s = store(&conn);

    let refund = Refund::new(
        "legx-sale-1",
        price(0),
        "wrap attempt",
        "",
        "user-1",
        vec![RefundLine::new("legx-sl-1", "TEA2", 10, price(0), price(0))],
    );

    let tx = conn.unchecked_transaction().unwrap();
    let outcome = s.credit_refund_to_default_location(&tx, &refund);
    match outcome {
        Err(CoreError::Validation { field, message }) => {
            assert_eq!(field, "refund_line.qty", "wrong field: {field}");
            assert!(
                message.contains("overflow") || message.contains("exceeds"),
                "expected an overflow/bound rejection, got: {message}"
            );
        }
        Ok(()) => panic!("a wrapping quantity bound must never credit stock"),
        other => panic!("expected a Validation rejection, got: {other:?}"),
    }
    drop(tx);

    let credited: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(delta), 0) FROM stock_movements WHERE reason = 'refund'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(credited, 0, "no stock is credited when the bound overflows");
}

/// The deduction_locations path gets the same refusal: a line id absent from
/// sale_lines is rejected before that JSON is consulted (a sale whose JSON
/// lists an id the ledger never sold is exactly as unbounded as the legacy
/// path), and its cumulative bound keeps rejecting the third partial refund.
#[test]
fn deduction_path_rejects_unknown_line_and_still_bounds_cumulative_qty() {
    let conn = fresh();
    seed_quantity_sale(&conn);
    let s = store(&conn);

    let ghost = RefundLine::new("ghost-not-a-line", "TEA", 3, price(100), price(300));
    let refund = Refund::new(
        "qty-sale-1",
        price(300),
        "ghost line",
        "",
        "user-1",
        vec![ghost],
    );
    let err = s.create_refund(&refund).unwrap_err();
    assert!(
        matches!(err, CoreError::Validation { field, .. }
            if field == "refund_line.sale_line_id"),
        "an unknown sale line must be refused on the deduction path too, got: {err:?}"
    );
    let rows: i64 = conn
        .query_row("SELECT COUNT(*) FROM refund_lines", [], |r| r.get(0))
        .unwrap();
    assert_eq!(rows, 0, "a refused line persists nothing");

    s.create_refund(&tea_refund(6, 600)).unwrap();
    s.create_refund(&tea_refund(4, 400)).unwrap();
    let err = s.create_refund(&tea_refund(6, 300)).unwrap_err();
    assert!(
        matches!(err, CoreError::Validation { field, .. } if field == "refund_line.qty"),
        "12 cumulative units of a 10-unit line must be rejected, got: {err:?}"
    );
    assert_eq!(get_stock_at(&conn, "TEA", DEFAULT_LOC), 10);
}

/// The shape the shifts drawer test needs: a LEGACY sale (deduction_locations
/// NULL) with exactly one 1-unit line, refunded in full — the money bound at
/// its equality boundary (1000 of 1000) and the quantity bound at its equality
/// boundary (1 of 1 sold). Both must accept it and the unit must come back to
/// the default location. This is the proof that a fixture which names the line
/// it refunds is not blocked by either bound.
#[test]
fn legacy_sale_full_value_single_unit_refund_is_accepted() {
    let conn = fresh();
    conn.execute_batch(
        "INSERT INTO products (id, sku, name, price_minor, currency, created_at, updated_at, product_type)
         VALUES ('p-sku', 'SKU', 'Sku', 1000, 'USD', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z', 'retail');
         INSERT INTO sales (id, total_minor, currency, line_count, status, payment_method,
                            created_at, updated_at, user_id, version, deduction_locations)
         VALUES ('refund-sale-1', 1000, 'USD', 1, 'completed', 'cash',
                 '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'user-1', 1, NULL);
         INSERT INTO sale_lines (id, sale_id, sku, qty, unit_minor, line_minor, currency, line_position)
         VALUES ('sl-1', 'refund-sale-1', 'SKU', 1, 1000, 1000, 'USD', 1);"
    )
    .unwrap();
    let s = store(&conn);

    let line = RefundLine::new("sl-1", "SKU", 1, price(1000), price(1000));
    let refund = Refund::new(
        "refund-sale-1",
        price(1000),
        "cash refund",
        "",
        "user-1",
        vec![line],
    );
    s.create_refund(&refund).unwrap_or_else(|e| {
        panic!("a 1-unit line refunded 1 unit at full value must pass both bounds, got: {e:?}")
    });

    assert_eq!(
        get_stock_at(&conn, "SKU", DEFAULT_LOC),
        1,
        "the unit comes back to the default location"
    );
    assert_eq!(
        s.total_refunded_for_sale("refund-sale-1")
            .unwrap()
            .minor_units,
        1000
    );
}

// ── Per-line MONEY ceiling (line_total_minor is a claim, not a fact) ──
//
// refund_lines.line_minor used to be written exactly as the caller sent it.
// The quantity guard now guarantees the named sale line exists, so the booked
// value of that line is always available and the claim can be bounded by it.

/// Seed a sale whose ONE line was sold at an OVERRIDDEN price: 3 units of
/// SYRUP with unit_minor 1000 but line_minor 2400 (3 x 1000 = 3000 != 2400).
/// That mismatch is legitimate - it is what a cashier price override stores -
/// and it is why the ceiling is a pro-rated range and not an equality against
/// unit_minor * qty. deduction_locations is NULL so the legacy credit path is
/// the one under test.
fn seed_overridden_price_sale(conn: &Connection) {
    conn.execute_batch(
        "INSERT INTO products (id, sku, name, price_minor, currency, created_at, updated_at) VALUES
            ('ovr-p1', 'SYRUP', 'Syrup', 1000, 'USD', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
            ('ovr-p2', 'BUTTER', 'Butter', 600, 'USD', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
         INSERT INTO sales (id, total_minor, currency, line_count, status, created_at, updated_at,
                            deduction_locations) VALUES
            ('ovr-sale-1', 3000, 'USD', 2, 'completed', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z', NULL);
         INSERT INTO sale_lines (id, sale_id, sku, qty, unit_minor, line_minor, currency, line_position) VALUES
            ('ovr-sl-1', 'ovr-sale-1', 'SYRUP', 3, 1000, 2400, 'USD', 1),
            ('ovr-sl-2', 'ovr-sale-1', 'BUTTER', 1, 600, 600, 'USD', 2);"
    ).unwrap();
}

/// A refund of [qty] units of the overridden line, CLAIMING [claimed] minor
/// units of value for it. The header total is set to the same figure, and the
/// sale carries 600 of unrelated BUTTER value, so the SALE-level money ceiling
/// (3000) stays out of the way across all three attempts and every rejection
/// below can only have come from the per-line ceiling.
fn syrup_refund(qty: i64, claimed: i64) -> Refund {
    let line = RefundLine::new("ovr-sl-1", "SYRUP", qty, price(1000), price(claimed));
    Refund::new(
        "ovr-sale-1",
        price(claimed),
        "value claim",
        "",
        "user-1",
        vec![line],
    )
}

/// THE REPRODUCE, and it FAILS AGAINST HEAD: one unit of a 3-unit line booked
/// at 2400 may carry at most 801 minor units of refund (2400 / 3 = 800, plus
/// the one-unit tolerance). A caller claiming 900 for that single unit is
/// refunding value the line never held, and HEAD wrote it verbatim and
/// returned Ok. Nothing may be persisted and no unit may move.
#[test]
fn refund_line_total_above_the_derived_ceiling_is_refused() {
    let conn = fresh();
    seed_overridden_price_sale(&conn);
    let s = store(&conn);

    let err = s.create_refund(&syrup_refund(1, 900)).unwrap_err();
    assert!(
        matches!(err, CoreError::Validation { field, .. } if field == "refund_line.line_total"),
        "a claim above the line's pro-rated ceiling must be refused, got: {err:?}"
    );

    let rows: i64 = conn
        .query_row("SELECT COUNT(*) FROM refunds", [], |r| r.get(0))
        .unwrap();
    let line_rows: i64 = conn
        .query_row("SELECT COUNT(*) FROM refund_lines", [], |r| r.get(0))
        .unwrap();
    assert_eq!(
        (rows, line_rows),
        (0, 0),
        "a refused refund persists nothing"
    );
    let credited: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(delta), 0) FROM stock_movements WHERE reason = 'refund'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(credited, 0, "a refused refund restores no stock");
}

/// The tolerance is the point of the exercise: 800 is the exact ratio and 801
/// is one minor unit above it, and BOTH are legitimate - the UI rounds
/// unitPriceMinor and multiplies back, so it can land either side. 802 is two
/// above and is refused. An equality check would have rejected 801 and broken
/// real refunds; this pins that it does not.
#[test]
fn refund_line_total_within_one_minor_unit_of_the_ratio_is_accepted() {
    let conn = fresh();
    seed_overridden_price_sale(&conn);
    let s = store(&conn);

    // Exact ratio: 2400 * 1 / 3 = 800.
    s.create_refund(&syrup_refund(1, 800)).unwrap();
    // One minor unit above the ratio: still accepted.
    s.create_refund(&syrup_refund(1, 801)).unwrap();
    assert_eq!(
        get_stock_at(&conn, "SYRUP", DEFAULT_LOC),
        2,
        "both accepted refunds restored their unit"
    );

    // Two above the ratio for the remaining unit: refused.
    let err = s.create_refund(&syrup_refund(1, 802)).unwrap_err();
    assert!(
        matches!(err, CoreError::Validation { field, .. } if field == "refund_line.line_total"),
        "one minor unit is the tolerance, not two, got: {err:?}"
    );
    assert_eq!(get_stock_at(&conn, "SYRUP", DEFAULT_LOC), 2);
    assert_eq!(s.list_refunds_for_sale("ovr-sale-1").unwrap().len(), 2);
}

/// A line the SERVER itself sold at a changed price must still refund
/// normally: the whole 3-unit line at its booked 2400 (unit_minor * qty would
/// have said 3000) is accepted, credited, and booked UNCHANGED - the ceiling
/// refuses an over-claim, it never rewrites a receipt.
#[test]
fn overridden_price_line_refunds_at_its_booked_value() {
    let conn = fresh();
    seed_overridden_price_sale(&conn);
    let s = store(&conn);

    s.create_refund(&syrup_refund(3, 2400))
        .unwrap_or_else(|e| panic!("a full refund at the booked line value must pass, got: {e:?}"));

    let refunds = s.list_refunds_for_sale("ovr-sale-1").unwrap();
    assert_eq!(refunds.len(), 1);
    assert_eq!(
        refunds[0].lines[0].line_total.minor_units, 2400,
        "the accepted figure is stored as supplied, not clamped"
    );
    assert_eq!(get_stock_at(&conn, "SYRUP", DEFAULT_LOC), 3);
    assert_eq!(
        s.total_refunded_for_sale("ovr-sale-1").unwrap().minor_units,
        2400
    );
}

// ── Line identity: the claimed sku must be the sku that line sold ──
//
// Both cumulative bounds are measured against the sale line a refund names.
// If the sku on the refund line is free text, the bounds measure one product
// while the credit moves another: the default-location arm credits
// refund_line.sku, so naming TEA's line as GOLD passes quantity 1-of-1 and
// money 0-of-ceiling and mints a unit of GOLD. The deduction arm cannot be
// spoofed this way - it takes the sku from the recorded JSON
// (dl_line["sku"], falling back to the caller only when the JSON omits it) -
// which is exactly why the mint lives on the legacy/imported path.

/// Seed a legacy sale (deduction_locations NULL) with one line of [sku] at
/// [qty] units, priced so the money ceiling is never the binding constraint.
fn seed_identity_sale(conn: &Connection, sale_id: &str, line_id: &str, sku: &str, qty: i64) {
    let pid = format!("{sale_id}-p");
    let unit = 1000;
    conn.execute(
        "INSERT INTO products (id, sku, name, price_minor, currency, created_at, updated_at)
         VALUES (?1, ?2, ?2, 1000, 'USD', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
        params![pid, sku],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO sales (id, total_minor, currency, line_count, status, created_at, updated_at,
                            deduction_locations)
         VALUES (?1, ?2, 'USD', 1, 'completed', '2025-01-01T00:00:00.000Z',
                 '2025-01-01T00:00:00.000Z', NULL)",
        params![sale_id, unit * qty],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO sale_lines (id, sale_id, sku, qty, unit_minor, line_minor, currency, line_position)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'USD', 1)",
        params![line_id, sale_id, sku, qty, unit, unit * qty],
    )
    .unwrap();
}

/// THE MINT REPRODUCE, and it FAILS AGAINST HEAD: a legacy sale with one line
/// of TEA, qty 1, refunded through that line id but claiming sku GOLD, with
/// line and header value 0. HEAD's quantity bound saw 1 of 1 and its money
/// ceiling saw 0 of 1001, both passed, and the default-location arm credited a
/// unit of a product that was never sold. Must be refused, persisting nothing
/// and moving no stock for either sku.
#[test]
fn create_refund_rejects_wrong_sku_on_a_legacy_sale_line() {
    let conn = fresh();
    seed_identity_sale(&conn, "idn-sale-1", "idn-sl-1", "TEA", 1);
    conn.execute(
        "INSERT INTO products (id, sku, name, price_minor, currency, created_at, updated_at)
         VALUES ('idn-gold', 'GOLD', 'Gold bar', 999000, 'USD', '2025-01-01T00:00:00.000Z',
                 '2025-01-01T00:00:00.000Z')",
        [],
    )
    .unwrap();
    let s = store(&conn);

    let line = RefundLine::new("idn-sl-1", "GOLD", 1, price(0), price(0));
    let refund = Refund::new("idn-sale-1", price(0), "sku swap", "", "user-1", vec![line]);
    let err = s.create_refund(&refund).unwrap_err();
    assert!(
        matches!(err, CoreError::Validation { field, .. } if field == "refund_line.sku"),
        "a refund line whose sku is not the line's sku must be refused, got: {err:?}",
    );

    let rows: i64 = conn
        .query_row("SELECT COUNT(*) FROM refunds", [], |r| r.get(0))
        .unwrap();
    let line_rows: i64 = conn
        .query_row("SELECT COUNT(*) FROM refund_lines", [], |r| r.get(0))
        .unwrap();
    assert_eq!(
        (rows, line_rows),
        (0, 0),
        "a refused refund persists nothing"
    );
    let movements: i64 = conn
        .query_row("SELECT COUNT(*) FROM stock_movements", [], |r| r.get(0))
        .unwrap();
    assert_eq!(movements, 0, "no stock moves for a misidentified line");
    assert_eq!(
        get_stock_at(&conn, "GOLD", DEFAULT_LOC),
        0,
        "GOLD is not minted"
    );
    assert_eq!(get_stock_at(&conn, "TEA", DEFAULT_LOC), 0);

    // Two lines naming the SAME sale line with different skus cannot let one
    // satisfy the identity check while the other is credited.
    let pair = vec![
        RefundLine::new("idn-sl-1", "TEA", 1, price(0), price(0)),
        RefundLine::new("idn-sl-1", "GOLD", 1, price(0), price(0)),
    ];
    let err = s
        .create_refund(&Refund::new(
            "idn-sale-1",
            price(0),
            "split claim",
            "",
            "user-1",
            pair,
        ))
        .unwrap_err();
    assert!(
        matches!(err, CoreError::Validation { field, .. } if field == "refund_line.sku"),
        "disagreeing skus on one sale line must be refused, got: {err:?}",
    );
}

/// The happy path, and the rule's edges: naming the recorded sku refunds
/// normally, a padded sku still matches (the domain type trims), and a
/// differently-cased sku does NOT (the domain type does not case-fold). A
/// guard like this breaks real refunds on a case or space difference, so both
/// halves are pinned here.
#[test]
fn create_refund_matches_the_recorded_sku_exactly_after_trimming() {
    let conn = fresh();
    seed_identity_sale(&conn, "idn-sale-2", "idn-sl-2", "TEA3", 3);
    let s = store(&conn);

    let claim = |sku: &str| -> Refund {
        let line = RefundLine::new("idn-sl-2", sku, 1, price(1000), price(1000));
        Refund::new(
            "idn-sale-2",
            price(1000),
            "identity",
            "",
            "user-1",
            vec![line],
        )
    };

    s.create_refund(&claim("TEA3"))
        .unwrap_or_else(|e| panic!("the recorded sku must refund normally, got: {e:?}"));
    s.create_refund(&claim("  TEA3  "))
        .unwrap_or_else(|e| panic!("a padded sku is the same sku after trimming, got: {e:?}"));
    let err = s.create_refund(&claim("tea3")).unwrap_err();
    assert!(
        matches!(err, CoreError::Validation { field, .. } if field == "refund_line.sku"),
        "case is part of the identity - the domain type does not fold it, got: {err:?}",
    );

    assert_eq!(
        get_stock_at(&conn, "TEA3", DEFAULT_LOC),
        2,
        "only the two accepted refunds credited stock"
    );
}

/// The empty-sku rule, chosen and justified: a sale line that records no sku
/// cannot have any refund line identified against it, so the refund is
/// REFUSED rather than falling back to the caller's sku - the fallback is the
/// mint. sale_lines.sku is NOT NULL, so this covers the empty and
/// whitespace-only shapes a legacy or imported row can hold.
#[test]
fn create_refund_refuses_a_line_that_records_no_sku() {
    let conn = fresh();
    conn.execute(
        "INSERT INTO sales (id, total_minor, currency, line_count, status, created_at, updated_at,
                            deduction_locations)
         VALUES ('idn-sale-3', 1000, 'USD', 1, 'completed', '2025-01-01T00:00:00.000Z',
                 '2025-01-01T00:00:00.000Z', NULL)",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO sale_lines (id, sale_id, sku, qty, unit_minor, line_minor, currency, line_position)
         VALUES ('idn-sl-3', 'idn-sale-3', '', 1, 1000, 1000, 'USD', 1)",
        [],
    )
    .unwrap();
    let s = store(&conn);

    let line = RefundLine::new("idn-sl-3", "ANYTHING", 1, price(1000), price(1000));
    let err = s
        .create_refund(&Refund::new(
            "idn-sale-3",
            price(1000),
            "no sku",
            "",
            "user-1",
            vec![line],
        ))
        .unwrap_err();
    assert!(
        matches!(err, CoreError::Validation { field, .. } if field == "refund_line.sku"),
        "a line recording no sku must be refused, not trusted, got: {err:?}",
    );
    let rows: i64 = conn
        .query_row("SELECT COUNT(*) FROM refunds", [], |r| r.get(0))
        .unwrap();
    assert_eq!(rows, 0, "the refused refund persists nothing");
    let movements: i64 = conn
        .query_row("SELECT COUNT(*) FROM stock_movements", [], |r| r.get(0))
        .unwrap();
    assert_eq!(
        movements, 0,
        "and mints no stock for an unverifiable identity"
    );
}
