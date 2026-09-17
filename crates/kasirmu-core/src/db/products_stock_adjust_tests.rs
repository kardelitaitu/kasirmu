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

/// The send precheck works per LOCATION, not against the aggregate: 7 units at
/// loc-a plus 3 at loc-b is enough for a 10-unit aggregate but not for a
/// 10-unit transfer from loc-a — and the failure leaves both surfaces
/// untouched.
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
        matches!(err, CoreError::Validation { field, ref message }
            if field == "qty"
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

/// Store-level contract the sync CRDT merge path must meet (a04865100
/// follow-up): location-scoped deltas applied through the canonical writer
/// move each NAMED location row by its own delta, keep the legacy aggregate
/// equal to the SUM over BOTH locations, and never materialise a phantom row
/// at the canonical default location. The exact-vec assertion below doubles
/// as the no-collapse check.
#[test]
fn location_scoped_deltas_keep_named_rows_and_aggregate() {
    let conn = fresh();
    let s = store(&conn);
    let pid = seed_product(&conn, "SKU-LOC-MERGE");
    seed_location(&conn, "loc-a", "Store A");
    seed_location(&conn, "loc-b", "Store B");
    adjust_at(&s, "SKU-LOC-MERGE", 7, "loc-a");
    adjust_at(&s, "SKU-LOC-MERGE", 3, "loc-b");
    // The two deltas a conflicted sync envelope would carry:
    adjust_at(&s, "SKU-LOC-MERGE", 10, "loc-a");
    adjust_at(&s, "SKU-LOC-MERGE", -3, "loc-b");

    assert_eq!(
        summary_rows(&conn, &pid),
        vec![("loc-a".to_string(), 17), ("loc-b".to_string(), 0)]
    );
    assert_eq!(inventory_qty(&conn, &pid).0, 17);
    assert_eq!(reader_stock_qty(&conn, &pid), 17);
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

// ── LEGACY-AWARE READ: the two stock reads that disagreed with every other read ──

/// A positive delta at a NAMED location on a legacy install (inventory rows,
/// zero stock_summary rows) must ADD to the legacy aggregate, not replace it.
/// Before the guard the Layer-1 read returned 0, the write created one row of
/// 3, and the aggregate recompute at the inventory upsert made inventory.qty
/// BECOME 3 — 87 units gone, no error. Fails against HEAD.
#[test]
fn legacy_positive_delta_at_named_location_adds_to_the_aggregate() {
    let conn = fresh();
    let s = store(&conn);
    let pid = seed_product(&conn, "SKU-LPOS");
    seed_location(&conn, "loc-a", "Store A");
    seed_legacy_inventory(&conn, &pid, 90);

    adjust_at(&s, "SKU-LPOS", 3, "loc-a");

    assert_eq!(
        inventory_qty(&conn, &pid).0,
        93,
        "a first-touch +3 must not turn a legacy aggregate of 90 into 3"
    );
    assert_eq!(reader_stock_qty(&conn, &pid), 93);
}

/// A negative delta on the same legacy shape is REFUSED today, because Layer 1
/// reads 0 at the location and 0 - 10 underflows. It must now succeed against
/// the real legacy number. Fails against HEAD (it returns the error).
#[test]
fn legacy_negative_delta_at_named_location_succeeds_against_the_aggregate() {
    let conn = fresh();
    let s = store(&conn);
    let pid = seed_product(&conn, "SKU-LNEG");
    seed_location(&conn, "loc-a", "Store A");
    seed_legacy_inventory(&conn, &pid, 40);

    adjust_at(&s, "SKU-LNEG", -10, "loc-a");

    assert_eq!(inventory_qty(&conn, &pid).0, 30);
    assert_eq!(summary_rows(&conn, &pid), vec![("loc-a".to_string(), 30)]);
    assert_eq!(reader_stock_qty(&conn, &pid), 30);
}

/// The batch path has its OWN pre-read (Phase 1), which can regress
/// independently of the canonical single-write read. Same legacy shape,
/// deducted through adjust_stock_batch: HEAD's Phase-1 read sees 0 and rejects.
#[test]
fn legacy_batch_pre_read_is_legacy_aware_too() {
    let conn = fresh();
    let s = store(&conn);
    let pid = seed_product(&conn, "SKU-LBAT");
    seed_location(&conn, "loc-a", "Store A");
    seed_legacy_inventory(&conn, &pid, 20);

    let tx = conn.unchecked_transaction().unwrap();
    s.adjust_stock_batch(
        &tx,
        &[crate::sale_deduction::StockDeduction {
            sku: "SKU-LBAT".into(),
            location_id: crate::inventory::LocationId::from("loc-a"),
            delta: -5,
        }],
        Some("test"),
        None,
        None,
        None,
    )
    .unwrap();
    tx.commit().unwrap();

    assert_eq!(inventory_qty(&conn, &pid).0, 15);
    assert_eq!(reader_stock_qty(&conn, &pid), 15);
}

/// END-TO-END reachability for the family that destroys stock silently from a
/// UI button: receive_purchase_order (db/purchase_orders.rs) is local,
/// positive-delta and routes through the canonical adjust at the default
/// location, so on a legacy install receiving 5 units of a product holding 70
/// rewrote the aggregate to 5. Fails against HEAD.
#[test]
fn receive_po_on_legacy_inventory_keeps_the_aggregate() {
    let conn = fresh();
    let s = store(&conn);
    let pid = seed_product(&conn, "SKU-LPO");
    seed_legacy_inventory(&conn, &pid, 70);
    conn.execute(
        "INSERT INTO suppliers (id, code, name, status, created_at, updated_at) VALUES ('sup-legacy', 'SUP-L', 'Legacy Supplier', 'active', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
        [],
    )
    .unwrap();

    let po = s
        .create_purchase_order(
            "PO-LEGACY",
            "sup-legacy",
            "",
            "",
            None,
            &[crate::db::purchase_orders::CreatePoLineInput {
                sku: "SKU-LPO".into(),
                product_name: "Widget".into(),
                qty: 5,
                unit_cost_minor: 1000,
            }],
        )
        .unwrap();
    s.update_po_status(&po.order.id, "approved").unwrap();
    s.receive_purchase_order(&po.order.id).unwrap();

    assert_eq!(
        inventory_qty(&conn, &pid).0,
        75,
        "receiving 5 onto a legacy aggregate of 70 must not rewrite it to 5"
    );
    assert_eq!(reader_stock_qty(&conn, &pid), 75);
}

/// THE POINT OF THE CHANGE, asserted in the direction that matters.
///
/// This test was `#[ignore]`d as a CHARACTERISATION of the loss: rebuild
/// DELETEd every row of `stock_summary` with no WHERE and re-derived from
/// `stock_movements`, so the 20 units of pre-ADR-6 opening stock that had no
/// movement behind them were destroyed — and the legacy-aware fallback could
/// not save them, because it fires only while a product has NO summary rows,
/// which is exactly what a rebuild removes. It asserted 45.
///
/// Un-ignored and INVERTED by Option E: the scoped rebuild closes the ledger
/// shortfall with ONE compensating movement first, so the re-derive lands on
/// 60 and the following +5 write lands on 65. The exposure was the UPGRADE and
/// EVAL path (stock predating ADR #6, or the demo seed at seed_demo.rs), not
/// the default one — for any product created through the app the ledger SUM
/// already equals inventory and there is nothing to heal.
#[test]
fn rebuild_after_ledger_short_opening_stock_keeps_the_unbacked_units() {
    // Was #[ignore]d as a characterisation of the loss. Un-ignored and
    // INVERTED by the scoped self-healing rebuild: the 20 units with no
    // movement behind them are now closed by ONE compensating movement
    // (reason `legacy-backfill`) before the ledger is re-derived, so the
    // rebuild is a pure function of a COMPLETE ledger. Asserts 65 where it
    // asserted 45 — 60 opening + 5 sold-on, not 40 + 5.
    let conn = fresh();
    let s = store(&conn);
    let pid = seed_product(&conn, "SKU-RBS");
    seed_location(&conn, "default", "Default");
    seed_legacy_inventory(&conn, &pid, 60);
    conn.execute(
        "INSERT INTO stock_movements (id, item_id, location_id, delta, reason, created_at) VALUES ('mv-1', ?1, 'default', 40, 'opening', '2025-01-01T00:00:00.000Z')",
        params![pid],
    )
    .unwrap();

    s.rebuild_stock_summary().unwrap();
    adjust_at(&s, "SKU-RBS", 5, "default");

    assert_eq!(
        inventory_qty(&conn, &pid).0,
        65,
        "the 20 unbacked units must survive rebuild + recompute"
    );
    assert_eq!(reader_stock_qty(&conn, &pid), 65);
    let healed: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM stock_movements WHERE reason = 'legacy-backfill'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(healed, 1, "exactly one compensating movement");
}

/// Snapshot of a product's summary rows INCLUDING updated_at, so "untouched"
/// means byte-identical rather than same-qty.
fn summary_snapshot(conn: &Connection, product_id: &str) -> Vec<(String, i64, String)> {
    let mut stmt = conn
        .prepare(
            "SELECT location_id, qty, updated_at FROM stock_summary WHERE item_id = ?1 ORDER BY location_id",
        )
        .unwrap();
    stmt.query_map(params![product_id], |r| {
        Ok((r.get(0)?, r.get(1)?, r.get(2)?))
    })
    .unwrap()
    .collect::<Result<Vec<_>, _>>()
    .unwrap()
}

fn backfill_rows(conn: &Connection) -> Vec<(String, i64)> {
    let mut stmt = conn
        .prepare("SELECT item_id, delta FROM stock_movements WHERE reason = 'legacy-backfill' ORDER BY item_id")
        .unwrap();
    stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap()
}

/// The scoping is the point: a rebuild asked for product A must not rewrite
/// product B. The old table-wide DELETE did exactly that on every sync page.
#[test]
fn scoped_rebuild_leaves_an_untouched_product_byte_identical() {
    let conn = fresh();
    let s = store(&conn);
    let pid_a = seed_product(&conn, "SKU-SCA");
    let pid_b = seed_product(&conn, "SKU-SCB");
    seed_location(&conn, "loc-a", "Store A");
    adjust_at(&s, "SKU-SCA", 10, "loc-a");
    adjust_at(&s, "SKU-SCB", 7, "loc-a");
    let before_b = summary_snapshot(&conn, &pid_b);
    assert!(!before_b.is_empty(), "B must have summary rows to preserve");

    s.rebuild_stock_summary_for(std::slice::from_ref(&pid_a))
        .unwrap();

    assert_eq!(
        summary_snapshot(&conn, &pid_b),
        before_b,
        "B's rows must be byte-identical, updated_at included"
    );
    assert_eq!(
        summary_rows(&conn, &pid_a),
        vec![("loc-a".to_string(), 10)],
        "A must still be rebuilt"
    );
}

/// Self-healing means ONE compensating row, not one per rebuild: the second
/// run finds a complete ledger and writes nothing new.
#[test]
fn compensating_movement_is_idempotent_on_rerun() {
    let conn = fresh();
    let s = store(&conn);
    let pid = seed_product(&conn, "SKU-IDM");
    seed_location(&conn, "default", "Default");
    seed_legacy_inventory(&conn, &pid, 60);
    conn.execute(
        "INSERT INTO stock_movements (id, item_id, location_id, delta, reason, created_at) VALUES ('mv-idm', ?1, 'default', 40, 'opening', '2025-01-01T00:00:00.000Z')",
        params![pid],
    )
    .unwrap();

    s.rebuild_stock_summary_for(std::slice::from_ref(&pid))
        .unwrap();
    let first = backfill_rows(&conn);
    let qty_first = summary_rows(&conn, &pid);
    s.rebuild_stock_summary_for(std::slice::from_ref(&pid))
        .unwrap();
    s.rebuild_stock_summary().unwrap();

    assert_eq!(
        first,
        vec![(pid.clone(), 20)],
        "the shortfall healed is exactly the 20 unbacked units"
    );
    assert_eq!(
        backfill_rows(&conn),
        first,
        "re-running must not append or amend a second compensating row"
    );
    assert_eq!(
        summary_rows(&conn, &pid),
        qty_first,
        "and must not move the rebuilt qty"
    );
}

/// The trap in the predicate: a STALE inventory aggregate (the allow_negative
/// path skips the inventory write, so inventory is ahead of both the ledger
/// and the summary) looks like a shortfall and is NOT one. Backfilling here
/// would invent units that never existed.
#[test]
fn stale_inventory_aggregate_is_not_backfilled() {
    let conn = fresh();
    let s = store(&conn);
    let pid = seed_product(&conn, "SKU-STL");
    seed_location(&conn, "default", "Default");
    seed_legacy_inventory(&conn, &pid, 10);
    conn.execute(
        "INSERT INTO stock_movements (id, item_id, location_id, delta, reason, created_at) VALUES ('mv-stl-1', ?1, 'default', 10, 'opening', '2025-01-01T00:00:00.000Z')",
        params![pid],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO stock_movements (id, item_id, location_id, delta, reason, created_at) VALUES ('mv-stl-2', ?1, 'default', -3, 'sale', '2025-01-02T00:00:00.000Z')",
        params![pid],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO stock_summary (item_id, location_id, qty, updated_at) VALUES (?1, 'default', 7, '2025-01-02T00:00:00.000Z')",
        params![pid],
    )
    .unwrap();
    // inventory 10 > ledger 7, but the summary (7) disagrees with inventory,
    // so the 3-unit gap is a stale aggregate, not unbacked stock.
    assert_eq!(inventory_qty(&conn, &pid).0, 10);

    s.rebuild_stock_summary_for(std::slice::from_ref(&pid))
        .unwrap();

    assert!(
        backfill_rows(&conn).is_empty(),
        "a stale aggregate must never be healed into the ledger"
    );
    assert_eq!(
        summary_rows(&conn, &pid),
        vec![("default".to_string(), 7)],
        "the ledger total stands: 10 - 3 = 7, not 10"
    );
}

/// The scoping undoes itself if an empty id list degrades to a table-wide
/// sweep — `WHERE item_id IN ()` is a syntax error, and "skip the filter when
/// empty" is the tempting wrong fix. It must rebuild NOTHING.
#[test]
fn empty_product_set_rebuilds_nothing() {
    let conn = fresh();
    let s = store(&conn);
    let pid = seed_product(&conn, "SKU-EMP");
    seed_location(&conn, "default", "Default");
    seed_legacy_inventory(&conn, &pid, 60);
    conn.execute(
        "INSERT INTO stock_movements (id, item_id, location_id, delta, reason, created_at) VALUES ('mv-emp', ?1, 'default', 40, 'opening', '2025-01-01T00:00:00.000Z')",
        params![pid],
    )
    .unwrap();
    s.rebuild_stock_summary_for(std::slice::from_ref(&pid))
        .unwrap();
    let before = summary_snapshot(&conn, &pid);

    let rebuilt = s.rebuild_stock_summary_for(&[]).unwrap();

    assert_eq!(rebuilt, 0, "an empty scope rebuilds nothing");
    assert_eq!(
        summary_snapshot(&conn, &pid),
        before,
        "nothing may be deleted or rewritten"
    );
    assert_eq!(
        backfill_rows(&conn).len(),
        1,
        "and nothing may be healed out of an empty scope"
    );
}
/// The chunking is load-bearing, not theoretical. Every scoped statement binds
/// one parameter per id, so a scope wider than SQLite's
/// `SQLITE_MAX_VARIABLE_NUMBER` fails with `too many SQL variables` — and
/// `rebuild_stock_summary()` (the operator entry point, and the only thing the
/// two sync daemons call) passes EVERY ledger and summary id. The old
/// parameterless table-wide statement could not fail that way, so an unchunked
/// scope is a NEW failure mode on the sync path.
///
/// The fixture is deliberately LARGER than `REBUILD_SCOPE_CHUNK`, so the
/// rebuild must cross a chunk boundary, and it asserts that every product on
/// BOTH sides of it was healed and rebuilt: the loop may neither skip a chunk
/// nor let one chunk's filter bleed into another chunk's rows.
// The chunk ceiling check below has constant operands by design: clippy's
// suggested `const { assert!(…) }` form turns it into a build failure for
// whoever edits the chunk size, not a test failure for whoever runs the suite.
// The level sits on the function because, as a statement attribute on `assert!`
// itself, rustc reports `unused_attribute`.
#[allow(clippy::assertions_on_constants)]
#[test]
fn rebuild_scope_survives_a_catalog_larger_than_the_chunk() {
    // The ceiling that binds is the HISTORICAL one: 999 was
    // SQLITE_MAX_VARIABLE_NUMBER before SQLite 3.32; the bundled 3.4x allows
    // 32 766. A chunk of 900 ids plus each statement's own tail params stays
    // under both. If someone raises the chunk past 999 this assertion is the
    // thing that fails, on any engine, before a customer's catalog does.
    assert!(
        REBUILD_SCOPE_CHUNK < 999,
        "chunk of {REBUILD_SCOPE_CHUNK} ids would hit the pre-3.32 999-variable ceiling"
    );

    let conn = fresh();
    let s = store(&conn);
    seed_location(&conn, "default", "Default");
    let count = REBUILD_SCOPE_CHUNK + 100;
    let mut ids: Vec<String> = Vec::with_capacity(count);
    for i in 0..count {
        let pid = seed_product(&conn, &format!("SKU-CH-{i:05}"));
        // The legacy shape on EVERY product: inventory 60 with only a +40
        // movement behind it, so each one needs its own compensating row.
        seed_legacy_inventory(&conn, &pid, 60);
        conn.execute(
            "INSERT INTO stock_movements (id, item_id, location_id, delta, reason, created_at) VALUES (?1, ?2, 'default', 40, 'opening', '2025-01-01T00:00:00.000Z')",
            params![format!("mv-ch-{i}"), pid],
        )
        .unwrap();
        ids.push(pid);
    }
    assert!(
        ids.len() > REBUILD_SCOPE_CHUNK,
        "the scope must span more than one chunk"
    );

    let started = std::time::Instant::now();
    let rebuilt = s.rebuild_stock_summary_for(&ids).unwrap();
    let elapsed = started.elapsed();

    // Two (item_id, location_id) groups per product: the +40 at 'default' and
    // the +20 compensating row at the canonical default location.
    assert_eq!(
        rebuilt,
        count * 2,
        "every product on every chunk must be rebuilt"
    );
    let healed: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM stock_movements WHERE reason = 'legacy-backfill'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(healed, count as i64, "no chunk may be skipped by the heal");
    let stale: i64 = conn
        .query_row("SELECT COUNT(*) FROM inventory WHERE qty <> 60", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(stale, 0, "every aggregate re-derived to the healed 60");
    let distinct: i64 = conn
        .query_row(
            "SELECT COUNT(DISTINCT item_id) FROM stock_summary",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(distinct, count as i64, "and no product lost its rows");
    // The suite pays for a thousand-product fixture; keep that bounded.
    assert!(
        elapsed.as_secs() < 30,
        "chunked rebuild over {count} products took {elapsed:?}"
    );
}
