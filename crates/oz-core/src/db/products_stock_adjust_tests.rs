//! Tests for the canonical stock-adjust module (ADR-19 §3.1).
//!
//! Focus: the legacy `inventory` table is a single-PK `(product_id)`
//! AGGREGATE — every writer must recompute its qty as the SUM over the
//! per-location `stock_summary` rows (the value the product-grid reader
//! derives at query time) instead of clobbering it with one location's qty,
//! and the legacy transfer/count writers must route through the canonical
//! adjust fn so there is exactly one stock writer.
use super::*;
use crate::db::stock_transfers::ReceivedLine;
use crate::migrations;
use crate::stock_transfer::StockTransferLine;
use rusqlite::Connection;

fn fresh() -> Connection {
    migrations::fresh_db()
}

fn store(conn: &Connection) -> Store<'_> {
    Store::new(conn)
}

fn seed_product(conn: &Connection, sku: &str) -> String {
    conn.execute(
        "INSERT INTO products (id, sku, name, price_minor, currency, created_at, updated_at)
         VALUES (?1, ?2, ?3, 1000, 'USD', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
        params![uuid::Uuid::now_v7().to_string(), sku, sku],
    )
    .unwrap();
    conn.query_row(
        "SELECT id FROM products WHERE sku = ?1",
        params![sku],
        |r| r.get(0),
    )
    .unwrap()
}

fn seed_location(conn: &Connection, id: &str, name: &str) {
    conn.execute(
        "INSERT INTO inventory_locations (id, name, type, created_at, updated_at)
         VALUES (?1, ?2, 'store', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
        params![id, name],
    )
    .unwrap();
}

fn seed_legacy_inventory(conn: &Connection, product_id: &str, qty: i64) {
    conn.execute(
        "INSERT INTO inventory (product_id, qty, updated_at)
         VALUES (?1, ?2, '2025-01-01T00:00:00.000Z')",
        params![product_id, qty],
    )
    .unwrap();
}

/// (qty, location_id) of the legacy single-PK inventory row.
fn inventory_qty(conn: &Connection, product_id: &str) -> (i64, String) {
    conn.query_row(
        "SELECT qty, location_id FROM inventory WHERE product_id = ?1",
        params![product_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .unwrap()
}

/// Per-location stock_summary rows, ordered by location.
fn summary_rows(conn: &Connection, product_id: &str) -> Vec<(String, i64)> {
    let mut stmt = conn
        .prepare(
            "SELECT location_id, qty FROM stock_summary WHERE item_id = ?1
             ORDER BY location_id",
        )
        .unwrap();
    stmt.query_map(params![product_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap()
}

/// The exact stock expression the product-grid reader uses
/// (products_crud list_products): SUM over stock_summary, fallback inventory.
fn reader_stock_qty(conn: &Connection, product_id: &str) -> i64 {
    conn.query_row(
        "SELECT COALESCE((SELECT SUM(ss.qty) FROM stock_summary ss
                          WHERE ss.item_id = p.id), i.qty)
         FROM products p LEFT JOIN inventory i ON p.id = i.product_id
         WHERE p.id = ?1",
        params![product_id],
        |r| r.get::<_, Option<i64>>(0),
    )
    .unwrap()
    .unwrap_or(0)
}

/// Apply a canonical per-location adjustment inside its own transaction.
fn adjust_at(store: &Store<'_>, sku: &str, delta: i64, location: &str) {
    let tx = store.conn.unchecked_transaction().unwrap();
    store
        .adjust_stock_at_location_with_reason(
            &tx,
            sku,
            delta,
            &crate::inventory::LocationId::from(location),
            Some("test"),
            None,
            None,
            None,
        )
        .unwrap();
    tx.commit().unwrap();
}

/// REPAIR (a)+(c): after adjusting ONE of two locations, the legacy aggregate
/// must equal the sum of BOTH per-location rows, and location_id must not be
/// flipped to whichever location wrote last.
#[test]
fn inventory_aggregate_recomputes_from_per_location_rows() {
    let conn = fresh();
    let s = store(&conn);
    let pid = seed_product(&conn, "SKU-AGG");
    seed_location(&conn, "loc-a", "Store A");
    seed_location(&conn, "loc-b", "Store B");

    adjust_at(&s, "SKU-AGG", 7, "loc-a");
    adjust_at(&s, "SKU-AGG", 3, "loc-b");
    // Aggregate = 10; the loc-b write did NOT repoint location_id.
    assert_eq!(inventory_qty(&conn, &pid), (10, "loc-a".to_string()));

    adjust_at(&s, "SKU-AGG", -2, "loc-a");
    // The old ON CONFLICT ... qty = excluded.qty clobber left 5 here.
    assert_eq!(inventory_qty(&conn, &pid).0, 8);
    assert_eq!(
        summary_rows(&conn, &pid),
        vec![("loc-a".to_string(), 5), ("loc-b".to_string(), 3)]
    );
    assert_eq!(reader_stock_qty(&conn, &pid), 8);
}

/// The transfer send/receive/cancel paths route through the canonical writer:
/// after each step the legacy aggregate equals the reader value.
#[test]
fn transfer_paths_agree_with_reader() {
    let conn = fresh();
    let s = store(&conn);
    let pid = seed_product(&conn, "SKU-TRF");
    // Legacy seed: single-PK inventory only, no stock_summary rows —
    // the bridge must materialise it before the canonical write.
    seed_legacy_inventory(&conn, &pid, 50);

    let lines = vec![StockTransferLine {
        id: String::new(),
        transfer_id: String::new(),
        sku: "SKU-TRF".into(),
        product_name: "Widget".into(),
        qty: 10,
        received_qty: 0,
    }];
    let t = s
        .create_transfer(None, None, None, None, "", "user-1", &lines)
        .unwrap();
    s.send_transfer(&t.id).unwrap();
    assert_eq!(inventory_qty(&conn, &pid).0, 40);
    assert_eq!(reader_stock_qty(&conn, &pid), 40);

    let line_id: String = conn
        .query_row(
            "SELECT id FROM stock_transfer_lines WHERE transfer_id = ?1",
            params![t.id],
            |r| r.get(0),
        )
        .unwrap();
    s.receive_transfer(
        &t.id,
        "user-2",
        &[ReceivedLine {
            line_id,
            received_qty: 10,
        }],
    )
    .unwrap();
    assert_eq!(inventory_qty(&conn, &pid).0, 50);
    let summary_sum: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(qty), 0) FROM stock_summary WHERE item_id = ?1",
            params![pid],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(summary_sum, 50);
    assert_eq!(reader_stock_qty(&conn, &pid), 50);

    // A second transfer cancelled while in transit restores the dispatched
    // qty at the source through the canonical writer (a fully received
    // transfer cannot be cancelled — reversal is send-side only).
    let t2 = s
        .create_transfer(None, None, None, None, "", "user-1", &lines)
        .unwrap();
    s.send_transfer(&t2.id).unwrap();
    assert_eq!(inventory_qty(&conn, &pid).0, 40);
    s.cancel_transfer(&t2.id).unwrap();
    assert_eq!(inventory_qty(&conn, &pid).0, 50);
    assert_eq!(reader_stock_qty(&conn, &pid), 50);
}

/// The send precheck works per LOCATION, not against the aggregate: 7 @ loc-a
/// + 3 @ loc-b is enough for a 10-unit aggregate but not for a 10-unit
/// transfer from loc-a — and the failure leaves both surfaces untouched.
#[test]
fn transfer_precheck_matches_per_location_reader() {
    let conn = fresh();
    let s = store(&conn);
    let pid = seed_product(&conn, "SKU-PRE");
    seed_location(&conn, "loc-a", "Store A");
    seed_location(&conn, "loc-b", "Store B");
    adjust_at(&s, "SKU-PRE", 7, "loc-a");
    adjust_at(&s, "SKU-PRE", 3, "loc-b");

    let lines = vec![StockTransferLine {
        id: String::new(),
        transfer_id: String::new(),
        sku: "SKU-PRE".into(),
        product_name: "Widget".into(),
        qty: 10,
        received_qty: 0,
    }];
    let t = s
        .create_transfer(
            Some("loc-a"),
            Some("loc-b"),
            None,
            None,
            "",
            "user-1",
            &lines,
        )
        .unwrap();
    let err = s.send_transfer(&t.id).unwrap_err();
    assert!(
        matches!(err, CoreError::Validation { ref field, ref message }
            if *field == "qty"
                && message.contains("have 7")
                && message.contains("need 10")),
        "unexpected error: {err:?}"
    );
    // Nothing moved: aggregate == reader == 10.
    assert_eq!(inventory_qty(&conn, &pid).0, 10);
    assert_eq!(reader_stock_qty(&conn, &pid), 10);

    // A 5-unit transfer from loc-a succeeds and both surfaces agree.
    let lines5 = vec![StockTransferLine {
        id: String::new(),
        transfer_id: String::new(),
        sku: "SKU-PRE".into(),
        product_name: "Widget".into(),
        qty: 5,
        received_qty: 0,
    }];
    let t5 = s
        .create_transfer(
            Some("loc-a"),
            Some("loc-b"),
            None,
            None,
            "",
            "user-1",
            &lines5,
        )
        .unwrap();
    s.send_transfer(&t5.id).unwrap();
    assert_eq!(inventory_qty(&conn, &pid).0, 5);
    assert_eq!(
        summary_rows(&conn, &pid),
        vec![("loc-a".to_string(), 2), ("loc-b".to_string(), 3)]
    );
    assert_eq!(reader_stock_qty(&conn, &pid), 5);
}

/// The count path computes its delta against the reader value and lands the
/// correction through the canonical writer, so afterwards inventory.qty ==
/// SUM(stock_summary) == the counted total.
#[test]
fn count_path_agrees_with_reader() {
    let conn = fresh();
    let s = store(&conn);
    let pid = seed_product(&conn, "SKU-CNT");
    seed_location(&conn, "loc-a", "Store A");
    seed_location(&conn, "loc-b", "Store B");
    adjust_at(&s, "SKU-CNT", 7, "loc-a");
    adjust_at(&s, "SKU-CNT", 3, "loc-b");
    assert_eq!(inventory_qty(&conn, &pid).0, 10);

    let count_id = uuid::Uuid::now_v7().to_string();
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    s.create_stock_count(&crate::stock_count::StockCount {
        id: count_id.clone(),
        count_number: "CNT-CNT-AGREE".into(),
        status: crate::stock_count::StockCountStatus::InProgress,
        count_type: crate::stock_count::CountType::Cyclic,
        notes: String::new(),
        counted_by: None,
        created_at: now.clone(),
        completed_at: None,
        updated_at: now,
    })
    .unwrap();
    s.add_count_line(&crate::stock_count::StockCountLine {
        id: uuid::Uuid::now_v7().to_string(),
        count_id: count_id.clone(),
        sku: "SKU-CNT".into(),
        product_name: "Widget".into(),
        expected_qty: 10,
        counted_qty: Some(8),
        difference: -2,
        notes: String::new(),
    })
    .unwrap();

    let adjustments = s.complete_stock_count(&count_id, None).unwrap();
    assert_eq!(adjustments.len(), 1);
    assert_eq!(adjustments[0].previous_qty, 10);
    assert_eq!(adjustments[0].adjusted_qty, 8);

    // The shrink waterfalled onto the largest holder (loc-a 7 → 5).
    assert_eq!(
        summary_rows(&conn, &pid),
        vec![("loc-a".to_string(), 5), ("loc-b".to_string(), 3)]
    );
    assert_eq!(inventory_qty(&conn, &pid).0, 8);
    assert_eq!(reader_stock_qty(&conn, &pid), 8);
}

/// A count against legacy inventory-only seed data bridges the aggregate into
/// stock_summary at the canonical default location and stays reader-consistent.
#[test]
fn count_path_bridges_legacy_inventory_seed() {
    let conn = fresh();
    let s = store(&conn);
    let pid = seed_product(&conn, "SKU-CNT2");
    seed_legacy_inventory(&conn, &pid, 10);

    let count_id = uuid::Uuid::now_v7().to_string();
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    s.create_stock_count(&crate::stock_count::StockCount {
        id: count_id.clone(),
        count_number: "CNT-CNT-BRIDGE".into(),
        status: crate::stock_count::StockCountStatus::InProgress,
        count_type: crate::stock_count::CountType::Full,
        notes: String::new(),
        counted_by: None,
        created_at: now.clone(),
        completed_at: None,
        updated_at: now,
    })
    .unwrap();
    s.add_count_line(&crate::stock_count::StockCountLine {
        id: uuid::Uuid::now_v7().to_string(),
        count_id: count_id.clone(),
        sku: "SKU-CNT2".into(),
        product_name: "Widget".into(),
        expected_qty: 10,
        counted_qty: Some(8),
        difference: -2,
        notes: String::new(),
    })
    .unwrap();

    let adjustments = s.complete_stock_count(&count_id, None).unwrap();
    assert_eq!(adjustments[0].previous_qty, 10);
    assert_eq!(adjustments[0].adjusted_qty, 8);
    assert_eq!(inventory_qty(&conn, &pid).0, 8);
    assert_eq!(reader_stock_qty(&conn, &pid), 8);
}
