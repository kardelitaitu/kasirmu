//! Tests for the read-only stock variance report (checklist item C12).
//!
//! Focus: a \`(item, location)\` whose \`stock_summary.qty\` disagrees with
//! \`SUM(stock_movements.delta)\` is REPORTED (with the correct difference) and
//! never repaired — the whole point of C12 is that a double-deducted row is
//! surfaced to an operator instead of being silently rewritten by a rebuild.
use super::*;
use crate::migrations;
use rusqlite::Connection;

fn fresh() -> Connection {
    migrations::fresh_db()
}

fn store(conn: &Connection) -> Store<'_> {
    Store::new(conn)
}

fn seed_product(conn: &Connection, sku: &str) -> String {
    let id = uuid::Uuid::now_v7().to_string();
    conn.execute(
        "INSERT INTO products (id, sku, name, price_minor, currency, created_at, updated_at)
         VALUES (?1, ?2, ?3, 1000, 'USD', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
        params![id, sku, sku],
    )
    .unwrap();
    id
}

fn seed_location(conn: &Connection, id: &str) {
    conn.execute(
        "INSERT INTO inventory_locations (id, name, type, created_at, updated_at)
         VALUES (?1, ?1, 'store', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
        params![id],
    )
    .unwrap();
}

/// Append one ledger row. Deltas are the only thing the report sums.
fn seed_movement(conn: &Connection, item_id: &str, location_id: &str, delta: i64) {
    conn.execute(
        "INSERT INTO stock_movements (id, item_id, location_id, delta, reason, created_at)
         VALUES (?1, ?2, ?3, ?4, 'sale', '2025-01-01T00:00:00.000Z')",
        params![
            uuid::Uuid::now_v7().to_string(),
            item_id,
            location_id,
            delta
        ],
    )
    .unwrap();
}

fn seed_summary(conn: &Connection, item_id: &str, location_id: &str, qty: i64) {
    conn.execute(
        "INSERT INTO stock_summary (item_id, location_id, qty, updated_at)
         VALUES (?1, ?2, ?3, '2025-01-01T00:00:00.000Z')",
        params![item_id, location_id, qty],
    )
    .unwrap();
}

fn stored_qty(conn: &Connection, item_id: &str, location_id: &str) -> i64 {
    conn.query_row(
        "SELECT qty FROM stock_summary WHERE item_id = ?1 AND location_id = ?2",
        params![item_id, location_id],
        |r| r.get(0),
    )
    .unwrap()
}

fn movement_count(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM stock_movements", [], |r| r.get(0))
        .unwrap()
}

/// The C12 scenario: a terminal re-applied its own pushed \`complete_sale\`, so
/// the ledger shows -6 while the summary was deducted twice, down to 8.
#[test]
fn divergent_row_is_reported_with_the_correct_difference() {
    let conn = fresh();
    let loc = "loc-main";
    seed_location(&conn, loc);
    let item = seed_product(&conn, "C12-DIVERGENT");
    seed_movement(&conn, &item, loc, 10);
    seed_movement(&conn, &item, loc, -6);
    seed_summary(&conn, &item, loc, 8); // ledger says 4, summary says 8

    let rows = store(&conn).stock_variance_report(1, 50).unwrap();

    assert_eq!(rows.len(), 1, "exactly the divergent pair is reported");
    let row = &rows[0];
    assert_eq!(row.item_id, item);
    assert_eq!(row.location_id, loc);
    assert_eq!(row.stored_qty, 8);
    assert_eq!(row.ledger_qty, 4);
    assert_eq!(row.difference, 4);
}

/// The report must not invent a row for a pair that already agrees — and when
/// the operator asks for everything (min 0) it comes back as a zero difference,
/// not as a phantom variance.
#[test]
fn consistent_row_is_excluded_by_default_and_zero_at_min_zero() {
    let conn = fresh();
    let loc = "loc-main";
    seed_location(&conn, loc);
    let item = seed_product(&conn, "C12-CONSISTENT");
    seed_movement(&conn, &item, loc, 5);
    seed_movement(&conn, &item, loc, -2);
    seed_summary(&conn, &item, loc, 3);

    let store = store(&conn);
    assert!(store.stock_variance_report(1, 50).unwrap().is_empty());

    let rows = store.stock_variance_report(0, 50).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].difference, 0);
}

/// C12 is a report, not a repair: the stored qty and the ledger are byte-for-byte
/// what they were before the call. This is the guard against a future "helpful"
/// \`qty = SUM(delta)\` rewrite landing inside the reader.
#[test]
fn report_performs_no_writes() {
    let conn = fresh();
    let loc = "loc-main";
    seed_location(&conn, loc);
    let item = seed_product(&conn, "C12-READONLY");
    seed_movement(&conn, &item, loc, 10);
    seed_movement(&conn, &item, loc, -6);
    seed_summary(&conn, &item, loc, 8);
    let before_movements = movement_count(&conn);

    let rows = store(&conn).stock_variance_report(1, 50).unwrap();
    assert_eq!(rows.len(), 1, "precondition: the divergence is visible");

    assert_eq!(stored_qty(&conn, &item, loc), 8, "summary untouched");
    assert_eq!(movement_count(&conn), before_movements, "ledger untouched");
}

/// A pair with movement history but NO summary row is a real drift too — the
/// ledger drives the join so it reports \`stored_qty = 0\` instead of vanishing.
#[test]
fn movement_without_summary_row_is_reported_as_zero_stored() {
    let conn = fresh();
    let loc = "loc-main";
    seed_location(&conn, loc);
    let item = seed_product(&conn, "C12-NO-SUMMARY");
    seed_movement(&conn, &item, loc, -3);

    let rows = store(&conn).stock_variance_report(1, 50).unwrap();

    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].stored_qty, 0);
    assert_eq!(rows[0].ledger_qty, -3);
    assert_eq!(rows[0].difference, 3);
}

/// Operator triage reads top-down: the biggest absolute disagreement first, and
/// the \`limit\` bounds how much a single call can pull.
#[test]
fn rows_are_ordered_by_absolute_difference_and_limited() {
    let conn = fresh();
    let loc = "loc-main";
    seed_location(&conn, loc);
    let small = seed_product(&conn, "C12-SMALL");
    let large = seed_product(&conn, "C12-LARGE");
    let negative = seed_product(&conn, "C12-NEGATIVE");
    // Expected differences: small +2, large +15, negative -4.
    for (item, delta, qty) in [(&small, 5i64, 7i64), (&large, 5, 20), (&negative, 5, 1)] {
        seed_movement(&conn, item, loc, delta);
        seed_summary(&conn, item, loc, qty);
    }

    let store = store(&conn);
    let rows = store.stock_variance_report(1, 50).unwrap();
    assert_eq!(
        rows.iter().map(|r| r.difference).collect::<Vec<_>>(),
        vec![15, -4, 2],
        "descending |difference|: -4 outranks +2"
    );

    let limited = store.stock_variance_report(1, 2).unwrap();
    assert_eq!(limited.len(), 2);
    assert_eq!(limited[0].item_id, large);
    assert_eq!(limited[1].item_id, negative);
}

/// Both bound parameters are validated: a silently truncated or unfiltered
/// report is worse than a loud error, because the operator cannot tell.
#[test]
fn invalid_arguments_are_rejected() {
    let conn = fresh();
    let store = store(&conn);

    assert!(store.stock_variance_report(-1, 50).is_err());
    assert!(store.stock_variance_report(0, 0).is_err());
    assert!(
        store
            .stock_variance_report(0, STOCK_VARIANCE_MAX_ROWS + 1)
            .is_err()
    );
    assert!(store.stock_variance_report(0, 1).is_ok());
}
