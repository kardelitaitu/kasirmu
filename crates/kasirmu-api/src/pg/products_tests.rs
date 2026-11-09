//! Tests for the product read path: the stock-fold rule behind the lateral
//! aggregate, and the projection's shape.
//!
//! The pure tests run everywhere. The two tests that need a real catalogue
//! (multiple @stock_summary rows per product; a product with none) are
//! pg-tests-gated: written in @pg_tests.rs, they compile on every machine and
//! are skipped unless the pg-tests feature is on AND a Postgres is reachable.

use super::*;

// -- The stock fold (pure) --------------------------------------------------

/// A product stocked at SEVERAL locations must still be ONE product row, and
/// its @stock_qty must be the SUM across locations - never one location's
/// qty, and never a multiplied row count.
///
/// This is the exact fact a bare LEFT JOIN stock_summary would break: the key
/// is (item_id, location_id) (ADR-18), so three locations are three rows. The
/// lateral aggregate folds them into one row carrying the SUM, and this test
/// pins that the fold's RESULT is what the mapper reports.
#[test]
fn several_stock_summary_rows_fold_into_one_total() {
    // 2 at the store, 3 at the warehouse, 5 in transit.
    let folded = product_stock_qty(ProductStock::LocationRows(2 + 3 + 5));
    assert_eq!(
        folded,
        Some(10),
        "a product stocked at three locations reports the SUM, once"
    );
    // A single location is the degenerate case of the same fold.
    assert_eq!(product_stock_qty(ProductStock::LocationRows(7)), Some(7));
    // Zero is a REAL answer once a location row exists: an empty shelf is not
    // "unknown stock", and must not degrade to NULL.
    assert_eq!(
        product_stock_qty(ProductStock::LocationRows(0)),
        Some(0),
        "a location row with qty 0 is zero stock, not unknown stock"
    );
}

/// A product with NO @stock_summary row must be RETURNED (the lateral
/// aggregate always emits exactly one row, so the outer join has nothing to
/// drop) and must fall back to the legacy @inventory.qty, including its NULL.
#[test]
fn no_stock_summary_rows_falls_back_to_the_inventory_aggregate() {
    assert_eq!(
        product_stock_qty(ProductStock::NoLocationRows(Some(42))),
        Some(42),
        "no location rows -> the legacy inventory aggregate answers, as before"
    );
    assert_eq!(
        product_stock_qty(ProductStock::NoLocationRows(None)),
        None,
        "neither table row -> unknown stock, which serialises as null"
    );
}

// -- The projection (pure) --------------------------------------------------

/// @PRODUCT_SELECT must contain no correlated @stock_summary subquery, and
/// must carry the stock columns the mapper reads.
///
/// This is a guard, not decoration: the debt entry named a per-row scalar
/// subquery inside this constant, and the whole point of the rewrite is that
/// the row's stock arrives from a lateral aggregate instead. A revert to the
/// subquery would still COMPILE and still return correct numbers, so only a
/// test on the SQL text itself can catch it.
#[test]
fn product_select_has_no_correlated_stock_subquery() {
    let projection = PRODUCT_SELECT.to_ascii_lowercase();
    assert!(
        !projection.contains("(select sum(ss.qty)"),
        "the per-row SUM(stock_summary.qty) subquery is back: {PRODUCT_SELECT}"
    );
    assert!(
        projection.contains("left join lateral"),
        "stock must come from the per-row lateral aggregate: {PRODUCT_SELECT}"
    );
    assert!(
        projection.contains("coalesce(sk.ss_qty, i.qty)"),
        "the COALESCE fallback to inventory.qty must survive: {PRODUCT_SELECT}"
    );
    assert!(
        projection.contains("sk.ss_has_rows as stock_has_location_rows"),
        "the mapper reads stock_has_location_rows to pick the winner: {PRODUCT_SELECT}"
    );
}

/// The aggregate must be evaluated PER PRODUCT, never for the whole table:
/// exactly one @stock_summary read and no unscoped GROUP BY over it.
///
/// A grouped LEFT JOIN (SELECT item_id, SUM(qty) ... GROUP BY item_id) is
/// correct but makes every page cost a full aggregate over every tenant's
/// rows; it is the shape this projection deliberately replaces.
#[test]
fn stock_aggregate_is_scoped_to_the_current_row() {
    let projection = PRODUCT_SELECT.to_ascii_lowercase();
    assert_eq!(
        projection.matches("from stock_summary").count(),
        1,
        "exactly one stock_summary read: {PRODUCT_SELECT}"
    );
    assert!(
        projection.contains("where ss.item_id = p.id"),
        "the aggregate must be keyed to the CURRENT row: {PRODUCT_SELECT}"
    );
    assert!(
        !projection.contains("group by"),
        "no unscoped GROUP BY: {PRODUCT_SELECT}"
    );
}
