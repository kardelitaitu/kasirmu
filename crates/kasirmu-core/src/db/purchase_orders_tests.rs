use super::*;
use crate::migrations;
use rusqlite::Connection;

fn fresh() -> Connection {
    migrations::fresh_db()
}

fn store(conn: &Connection) -> Store<'_> {
    Store::new(conn)
}

fn seed_supplier(conn: &Connection) -> String {
    conn.execute(
        "INSERT INTO suppliers (id, code, name, status, created_at, updated_at) VALUES (?1, ?2, ?3, 'active', ?4, ?4)",
        params!["sup-po", "SUP-PO", "Test Supplier", "2025-01-01T00:00:00.000Z"],
    ).unwrap();
    "sup-po".into()
}

fn seed_product(conn: &Connection) {
    conn.execute(
        "INSERT INTO products (id, sku, name, price_minor, currency, created_at, updated_at, price_updated_at) VALUES (?1, ?2, ?3, 1000, 'USD', ?4, ?4, ?4)",
        params!["prod-po", "SKU-001", "Widget", "2025-01-01T00:00:00.000Z"],
    ).unwrap();
    conn.execute(
        "INSERT INTO inventory (product_id, qty) VALUES (?1, 10)",
        params!["prod-po"],
    )
    .unwrap();
    // Also seed stock_summary at the canonical default location so
    // the transactional adjust_stock_at_location_with_reason API
    // (which reads current qty from stock_summary, not the legacy
    // inventory table) sees the correct initial quantity.
    conn.execute(
        "INSERT INTO stock_summary (item_id, location_id, qty, updated_at) VALUES (?1, ?2, 10, ?3)",
        params![
            "prod-po",
            crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID,
            "2025-01-01T00:00:00.000Z"
        ],
    )
    .unwrap();
}

#[test]
fn create_po_with_lines() {
    let conn = fresh();
    seed_supplier(&conn);
    let lines = vec![CreatePoLineInput {
        sku: "SKU-001".into(),
        product_name: "Widget".into(),
        qty: 5,
        unit_cost_minor: 1000,
    }];
    let po = store(&conn)
        .create_purchase_order("PO-TEST-1", "sup-po", "2025-02-01", "Urgent", None, &lines)
        .unwrap();
    assert_eq!(po.order.po_number, "PO-TEST-1");
    assert_eq!(po.order.status, "draft");
    assert_eq!(po.order.subtotal_minor, 5000);
    assert_eq!(po.lines.len(), 1);
}

#[test]
fn get_po() {
    let conn = fresh();
    let sid = seed_supplier(&conn);
    let lines = vec![CreatePoLineInput {
        sku: "SKU-001".into(),
        product_name: "Widget".into(),
        qty: 2,
        unit_cost_minor: 500,
    }];
    let created = store(&conn)
        .create_purchase_order("PO-TEST-2", &sid, "", "", None, &lines)
        .unwrap();
    let fetched = store(&conn)
        .get_purchase_order(&created.order.id)
        .unwrap()
        .unwrap();
    assert_eq!(fetched.order.po_number, "PO-TEST-2");
    assert_eq!(fetched.lines.len(), 1);
}

#[test]
fn list_pos() {
    let conn = fresh();
    let sid = seed_supplier(&conn);
    let lines = vec![CreatePoLineInput {
        sku: "SKU-001".into(),
        product_name: "Widget".into(),
        qty: 2,
        unit_cost_minor: 500,
    }];
    store(&conn)
        .create_purchase_order("PO-TEST-3", &sid, "", "", None, &lines)
        .unwrap();
    let list = store(&conn).list_purchase_orders().unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].lines.len(), 1);
}

#[test]
fn update_status() {
    let conn = fresh();
    let sid = seed_supplier(&conn);
    let po = store(&conn)
        .create_purchase_order("PO-STATUS", &sid, "", "", None, &[])
        .unwrap();
    let updated = store(&conn)
        .update_po_status(&po.order.id, "approved")
        .unwrap();
    assert_eq!(updated.order.status, "approved");
}

#[test]
fn update_invalid_status() {
    let conn = fresh();
    let sid = seed_supplier(&conn);
    let po = store(&conn)
        .create_purchase_order("PO-INV", &sid, "", "", None, &[])
        .unwrap();
    let err = store(&conn)
        .update_po_status(&po.order.id, "invalid")
        .unwrap_err();
    assert!(matches!(
        err,
        CoreError::Validation {
            field: "status",
            ..
        }
    ));
}

#[test]
fn receive_po_updates_inventory() {
    let conn = fresh();
    seed_supplier(&conn);
    seed_product(&conn);

    let lines = vec![CreatePoLineInput {
        sku: "SKU-001".into(),
        product_name: "Widget".into(),
        qty: 5,
        unit_cost_minor: 1000,
    }];
    let po = store(&conn)
        .create_purchase_order("PO-RECV", "sup-po", "", "", None, &lines)
        .unwrap();
    store(&conn)
        .update_po_status(&po.order.id, "approved")
        .unwrap();
    let received = store(&conn).receive_purchase_order(&po.order.id).unwrap();
    assert_eq!(received.order.status, "received");
    assert!(received.order.received_date.is_some());

    let stock: i64 = conn
        .query_row(
            "SELECT qty FROM inventory WHERE product_id='prod-po'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(stock, 15);
}

#[test]
fn create_po_empty_number_rejected() {
    let conn = fresh();
    seed_supplier(&conn);
    let err = store(&conn)
        .create_purchase_order("  ", "sup-po", "", "", None, &[])
        .unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "po_number"));
}

#[test]
fn create_po_negative_qty_rejected() {
    let conn = fresh();
    seed_supplier(&conn);
    let lines = vec![CreatePoLineInput {
        sku: "SKU-001".into(),
        product_name: "Widget".into(),
        qty: -1,
        unit_cost_minor: 100,
    }];
    let err = store(&conn)
        .create_purchase_order("PO-NEG", "sup-po", "", "", None, &lines)
        .unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "qty"));
}

#[test]
fn get_po_not_found_returns_none() {
    let conn = fresh();
    let result = store(&conn).get_purchase_order("nonexistent").unwrap();
    assert!(result.is_none());
}

#[test]
fn receive_po_not_approved_rejected() {
    let conn = fresh();
    let sid = seed_supplier(&conn);
    let po = store(&conn)
        .create_purchase_order("PO-NOT-APPROVED", &sid, "", "", None, &[])
        .unwrap();
    // Still in "draft" status, not "approved".
    let err = store(&conn)
        .receive_purchase_order(&po.order.id)
        .unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "status"));
}

#[test]
fn po_full_lifecycle() {
    let conn = fresh();
    seed_supplier(&conn);
    seed_product(&conn);

    // Step 1: Create as draft
    let lines = vec![CreatePoLineInput {
        sku: "SKU-001".into(),
        product_name: "Widget".into(),
        qty: 5,
        unit_cost_minor: 1000,
    }];
    let po = store(&conn)
        .create_purchase_order(
            "PO-LIFECYCLE",
            "sup-po",
            "2025-03-01",
            "full cycle",
            None,
            &lines,
        )
        .unwrap();
    assert_eq!(po.order.status, "draft");
    assert_eq!(po.order.subtotal_minor, 5000);
    assert_eq!(po.lines.len(), 1);

    // Step 2: Approve
    let approved = store(&conn)
        .update_po_status(&po.order.id, "approved")
        .unwrap();
    assert_eq!(approved.order.status, "approved");

    // Step 3: Receive
    let received = store(&conn).receive_purchase_order(&po.order.id).unwrap();
    assert_eq!(received.order.status, "received");
    assert!(received.order.received_date.is_some());

    // Step 4: Verify inventory incremented (seed = 10, +5 = 15)
    let stock: i64 = conn
        .query_row(
            "SELECT qty FROM inventory WHERE product_id='prod-po'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(stock, 15);
}

#[test]
fn po_draft_to_pending_to_approved() {
    let conn = fresh();
    let sid = seed_supplier(&conn);
    let po = store(&conn)
        .create_purchase_order("PO-TRANSITIONS", &sid, "", "", None, &[])
        .unwrap();
    assert_eq!(po.order.status, "draft");

    let pending = store(&conn)
        .update_po_status(&po.order.id, "pending")
        .unwrap();
    assert_eq!(pending.order.status, "pending");

    let approved = store(&conn)
        .update_po_status(&po.order.id, "approved")
        .unwrap();
    assert_eq!(approved.order.status, "approved");
}

#[test]
fn po_cancel_then_reopen_then_receive() {
    let conn = fresh();
    seed_supplier(&conn);
    seed_product(&conn);

    let lines = vec![CreatePoLineInput {
        sku: "SKU-001".into(),
        product_name: "Widget".into(),
        qty: 3,
        unit_cost_minor: 500,
    }];
    let po = store(&conn)
        .create_purchase_order("PO-REOPEN", "sup-po", "", "", None, &lines)
        .unwrap();

    // Cancel first
    let cancelled = store(&conn)
        .update_po_status(&po.order.id, "cancelled")
        .unwrap();
    assert_eq!(cancelled.order.status, "cancelled");

    // Now try to receive while cancelled — should fail
    let err = store(&conn)
        .receive_purchase_order(&po.order.id)
        .unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "status"));

    // Reopen: set back to approved
    let reopened = store(&conn)
        .update_po_status(&po.order.id, "approved")
        .unwrap();
    assert_eq!(reopened.order.status, "approved");

    // Now receive should work
    let received = store(&conn).receive_purchase_order(&po.order.id).unwrap();
    assert_eq!(received.order.status, "received");

    // Verify inventory (seed = 10, +3 = 13)
    let stock: i64 = conn
        .query_row(
            "SELECT qty FROM inventory WHERE product_id='prod-po'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(stock, 13);
}

#[test]
fn po_update_status_nonexistent_id() {
    let conn = fresh();
    let err = store(&conn)
        .update_po_status("i-do-not-exist", "approved")
        .unwrap_err();
    assert!(matches!(err, CoreError::NotFound { entity, .. } if entity == "purchase_order"));
}

#[test]
fn po_receive_nonexistent_id() {
    let conn = fresh();
    let err = store(&conn)
        .receive_purchase_order("i-do-not-exist")
        .unwrap_err();
    assert!(matches!(err, CoreError::NotFound { entity, .. } if entity == "purchase_order"));
}

// ── Additional edge cases (coverage expansion) ──────────────────

#[test]
fn create_po_multiple_lines() {
    let conn = fresh();
    seed_supplier(&conn);

    let lines = vec![
        CreatePoLineInput {
            sku: "SKU-001".into(),
            product_name: "Widget A".into(),
            qty: 2,
            unit_cost_minor: 1000,
        },
        CreatePoLineInput {
            sku: "SKU-002".into(),
            product_name: "Widget B".into(),
            qty: 3,
            unit_cost_minor: 2000,
        },
    ];

    let po = store(&conn)
        .create_purchase_order(
            "PO-MULTI",
            "sup-po",
            "2025-03-01",
            "multi line",
            None,
            &lines,
        )
        .unwrap();
    assert_eq!(po.lines.len(), 2);
    assert_eq!(po.lines[0].sku, "SKU-001");
    assert_eq!(po.lines[1].sku, "SKU-002");
    // subtotal = (2*1000) + (3*2000) = 8000
    assert_eq!(po.order.subtotal_minor, 8000);
    assert_eq!(po.order.total_minor, 8000);

    // Verify via list and get
    let fetched = store(&conn)
        .get_purchase_order(&po.order.id)
        .unwrap()
        .unwrap();
    assert_eq!(fetched.lines.len(), 2);

    let listed = store(&conn).list_purchase_orders().unwrap();
    assert_eq!(listed[0].lines.len(), 2);
}

#[test]
fn create_po_empty_lines() {
    let conn = fresh();
    seed_supplier(&conn);

    let po = store(&conn)
        .create_purchase_order("PO-EMPTY", "sup-po", "", "no items", None, &[])
        .unwrap();
    assert!(po.lines.is_empty());
    assert_eq!(po.order.subtotal_minor, 0);
    assert_eq!(po.order.status, "draft");
}

#[test]
fn create_po_negative_unit_cost_rejected() {
    let conn = fresh();
    seed_supplier(&conn);

    let lines = vec![CreatePoLineInput {
        sku: "SKU-001".into(),
        product_name: "Widget".into(),
        qty: 1,
        unit_cost_minor: -100,
    }];
    let err = store(&conn)
        .create_purchase_order("PO-NEG-COST", "sup-po", "", "", None, &lines)
        .unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "unit_cost_minor"));
}

/// MONEY-05: the per-line `qty × unit_cost_minor` product comes from
/// untrusted IPC input (`CreatePoLineInput`) and dev/test builds disable
/// overflow checks, so an overflowing line silently wraps and the PO is
/// persisted with a corrupt (negative) subtotal. Must return a structured
/// Validation error instead.
#[test]
fn create_po_line_total_overflow_rejected() {
    let conn = fresh();
    seed_supplier(&conn);

    // (i64::MAX / 2) * 3 overflows i64.
    let lines = vec![CreatePoLineInput {
        sku: "SKU-001".into(),
        product_name: "Widget".into(),
        qty: i64::MAX / 2,
        unit_cost_minor: 3,
    }];
    let err = store(&conn)
        .create_purchase_order("PO-OVF-LINE", "sup-po", "", "", None, &lines)
        .unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "line_total"));

    // Nothing may be persisted.
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM purchase_orders WHERE po_number = 'PO-OVF-LINE'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 0, "no PO row may exist when a line total overflows");
}

/// MONEY-05: individual line products fit i64 but their SUM overflows
/// (i64::MAX + 1). The subtotal accumulator must use checked_add so the
/// PO cannot be persisted with a wrapped negative subtotal.
#[test]
fn create_po_subtotal_accumulation_overflow_rejected() {
    let conn = fresh();
    seed_supplier(&conn);

    let lines = vec![
        CreatePoLineInput {
            sku: "SKU-001".into(),
            product_name: "Widget".into(),
            qty: i64::MAX,
            unit_cost_minor: 1,
        },
        CreatePoLineInput {
            sku: "SKU-002".into(),
            product_name: "Gadget".into(),
            qty: 1,
            unit_cost_minor: 1,
        },
    ];
    let err = store(&conn)
        .create_purchase_order("PO-OVF-SUM", "sup-po", "", "", None, &lines)
        .unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "subtotal"));

    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM purchase_orders WHERE po_number = 'PO-OVF-SUM'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 0, "no PO row may exist when the subtotal overflows");
}

#[test]
fn create_po_with_notes() {
    let conn = fresh();
    seed_supplier(&conn);

    let lines = vec![CreatePoLineInput {
        sku: "SKU-001".into(),
        product_name: "Widget".into(),
        qty: 1,
        unit_cost_minor: 500,
    }];
    let po = store(&conn)
        .create_purchase_order(
            "PO-NOTES",
            "sup-po",
            "2025-04-01",
            "Rush order — urgent restock",
            None,
            &lines,
        )
        .unwrap();
    assert_eq!(po.order.notes, "Rush order — urgent restock");
    assert_eq!(po.order.expected_date, "2025-04-01");

    // Verify round-trip
    let fetched = store(&conn)
        .get_purchase_order(&po.order.id)
        .unwrap()
        .unwrap();
    assert_eq!(fetched.order.notes, "Rush order — urgent restock");
    assert_eq!(fetched.order.expected_date, "2025-04-01");
}

#[test]
fn create_po_with_created_by() {
    let conn = fresh();
    seed_supplier(&conn);

    // Seed role + user so FK constraints are satisfied
    conn.execute_batch(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at) VALUES
            ('role-po', 'procurement', 'PO mgr', '[]', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
         INSERT INTO users (id, username, pin_hash, display_name, role_id, created_at, updated_at) VALUES
            ('user-42', 'procurement', 'h', 'Procurement', 'role-po', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');"
    ).unwrap();

    let po = store(&conn)
        .create_purchase_order(
            "PO-CREATOR",
            "sup-po",
            "",
            "created by user-42",
            Some("user-42"),
            &[],
        )
        .unwrap();
    assert_eq!(po.order.created_by.as_deref(), Some("user-42"));

    // Verify round-trip
    let fetched = store(&conn)
        .get_purchase_order(&po.order.id)
        .unwrap()
        .unwrap();
    assert_eq!(fetched.order.created_by.as_deref(), Some("user-42"));
}

#[test]
fn po_list_orders_descending_by_date() {
    let conn = fresh();
    let sid = seed_supplier(&conn);

    // Create two POs, then verify newest is first
    let _po_a = store(&conn)
        .create_purchase_order("PO-DESC-A", &sid, "", "older", None, &[])
        .unwrap();

    // Sleep briefly so timestamps differ
    std::thread::sleep(std::time::Duration::from_millis(10));

    let _po_b = store(&conn)
        .create_purchase_order("PO-DESC-B", &sid, "", "newer", None, &[])
        .unwrap();

    let list = store(&conn).list_purchase_orders().unwrap();
    assert_eq!(list.len(), 2);
    // PO B (newer) should be first
    assert_eq!(list[0].order.po_number, "PO-DESC-B");
    assert_eq!(list[1].order.po_number, "PO-DESC-A");
    assert!(list[0].order.created_at >= list[1].order.created_at);
}

// ── TDD: create_purchase_order atomicity ────────────────────────
//
// The doc comment claims "all in one transaction" but the function
// issues the header INSERT and each line INSERT directly on
// self.conn (autocommit mode) with no enclosing transaction. If a
// line INSERT fails, the header and prior lines are already
// committed — leaving an orphaned partial PO.
//
// This test forces the 2nd line INSERT to fail via a RAISE(ABORT)
// trigger and asserts the entire PO (header + line 1) was rolled
// back — proving (non-)atomicity.

#[test]
fn create_purchase_order_rolls_back_on_line_insert_failure() {
    let conn = fresh();
    seed_supplier(&conn);

    // Install a trigger that rejects any line with product_name
    // 'TRIGGER_FAIL'. This simulates a disk/IO/constraint failure
    // on the 2nd line INSERT only.
    conn.execute_batch(
        "CREATE TRIGGER reject_fail_line
         BEFORE INSERT ON purchase_order_lines
         WHEN NEW.product_name = 'TRIGGER_FAIL'
         BEGIN
             SELECT RAISE(ABORT, 'forced failure on line insert');
         END;",
    )
    .unwrap();

    let lines = vec![
        CreatePoLineInput {
            sku: "SKU-001".into(),
            product_name: "Widget".into(),
            qty: 5,
            unit_cost_minor: 1000,
        },
        CreatePoLineInput {
            sku: "SKU-002".into(),
            product_name: "TRIGGER_FAIL".into(), // triggers RAISE
            qty: 3,
            unit_cost_minor: 500,
        },
    ];

    // The 2nd line INSERT hits the trigger and fails.
    let result = store(&conn).create_purchase_order("PO-ATOMIC-1", "sup-po", "", "", None, &lines);
    assert!(
        result.is_err(),
        "create_purchase_order must surface the forced line-insert failure"
    );

    // Atomicity contract: because the writes should be wrapped in
    // one transaction, the failed 2nd line must roll back the header
    // INSERT and the 1st line INSERT. If they persist, the function
    // is non-atomic (the bug).
    let header_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM purchase_orders WHERE po_number = 'PO-ATOMIC-1'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let line_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM purchase_order_lines WHERE sku IN ('SKU-001', 'SKU-002')",
            [],
            |row| row.get(0),
        )
        .unwrap();

    // These assertions FAIL in the RED phase (no transaction →
    // header + line 1 persist despite the 2nd line failing) and PASS
    // once a transaction wraps the batch.
    assert_eq!(
        header_count, 0,
        "PO header must be rolled back, got {header_count} row(s)"
    );
    assert_eq!(
        line_count, 0,
        "PO lines must be rolled back, got {line_count} row(s)"
    );
}

// ── TDD: receive_purchase_order atomicity + error propagation ───────
//
// receive_purchase_order (line 299) has two defects:
//
// 1. NON-ATOMIC: it issues the PO status UPDATE (line 314) in
//    autocommit mode, then loops calling self.adjust_stock() which
//    each start/commit their OWN unchecked_transaction (products.rs
//    line 1204). If adjust_stock fails on line N of M, the PO is
//    already 'received' and lines 1..N-1 are already committed — a
//    partial receive that can't be retried.
//
// 2. SILENT FAILURE (Axis 8): line 321 uses `let _ = ... .map_err(
//    |e| tracing::warn!(...))` which discards the Result. The
//    function returns Ok(po) even if stock adjustments failed.
//
// This test forces the 2nd line's adjust_stock to fail (by deleting
// the product so product_id_by_sku returns NotFound) and asserts:
//   a) receive_purchase_order returns Err (not silently Ok)
//   b) the PO status is NOT 'received' (rollback — atomicity)

#[test]
fn receive_purchase_order_propagates_stock_adjust_failure_and_rolls_back() {
    let conn = fresh();
    seed_supplier(&conn);
    // Seed two products with initial stock.
    conn.execute(
        "INSERT INTO products (id, sku, name, price_minor, currency, created_at, updated_at, price_updated_at) VALUES (?1, ?2, ?3, 1000, 'USD', ?4, ?4, ?4)",
        params!["prod-a", "SKU-A", "Widget A", "2025-01-01T00:00:00.000Z"],
    ).unwrap();
    conn.execute(
        "INSERT INTO inventory (product_id, qty) VALUES ('prod-a', 10)",
        [],
    )
    .unwrap();
    // Seed stock_summary so adjust_stock_at_location_with_reason reads
    // the correct initial qty (it reads from stock_summary, not inventory).
    conn.execute(
        "INSERT INTO stock_summary (item_id, location_id, qty, updated_at) VALUES ('prod-a', ?1, 10, '2025-01-01T00:00:00.000Z')",
        params![crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID],
    ).unwrap();
    conn.execute(
        "INSERT INTO products (id, sku, name, price_minor, currency, created_at, updated_at, price_updated_at) VALUES (?1, ?2, ?3, 1000, 'USD', ?4, ?4, ?4)",
        params!["prod-b", "SKU-B", "Widget B", "2025-01-01T00:00:00.000Z"],
    ).unwrap();
    conn.execute(
        "INSERT INTO inventory (product_id, qty) VALUES ('prod-b', 5)",
        [],
    )
    .unwrap();

    // Create + approve a PO with two lines.
    let lines = vec![
        CreatePoLineInput {
            sku: "SKU-A".into(),
            product_name: "Widget A".into(),
            qty: 5,
            unit_cost_minor: 1000,
        },
        CreatePoLineInput {
            sku: "SKU-B".into(),
            product_name: "Widget B".into(),
            qty: 3,
            unit_cost_minor: 500,
        },
    ];
    let po = store(&conn)
        .create_purchase_order("PO-RECV-ATOMIC", "sup-po", "", "", None, &lines)
        .unwrap();
    store(&conn)
        .update_po_status(&po.order.id, "approved")
        .unwrap();

    // Delete SKU-B's product row so adjust_stock('SKU-B', ...) fails
    // with NotFound. This simulates a mid-receive failure: line 1
    // (SKU-A) would succeed, but line 2 (SKU-B) fails.
    conn.execute("DELETE FROM inventory WHERE product_id = 'prod-b'", [])
        .unwrap();
    conn.execute("DELETE FROM products WHERE id = 'prod-b'", [])
        .unwrap();

    // receive_purchase_order must:
    //   a) return Err (not silently Ok) — the stock-adjust failure
    //      must be propagated, not swallowed by `let _ =`.
    //   b) roll back the PO status UPDATE — the PO must NOT be
    //      'received' because the receive was not atomic.
    let result = store(&conn).receive_purchase_order(&po.order.id);

    // (a) Error propagation — currently `let _ =` swallows it → Ok.
    assert!(
        result.is_err(),
        "receive_purchase_order must propagate the stock-adjust failure, \
         not silently return Ok (got {:?})",
        result.ok()
    );

    // (b) Atomicity — the PO status must NOT be 'received'. If the
    // status UPDATE and stock adjustments were in one transaction,
    // the failure would roll back the status change too.
    let status: String = conn
        .query_row(
            "SELECT status FROM purchase_orders WHERE id = ?1",
            params![po.order.id],
            |row| row.get(0),
        )
        .unwrap();
    assert_ne!(
        status, "received",
        "PO status must be rolled back (not 'received') when stock \
         adjustment fails — got '{status}'"
    );

    // (c) SKU-A's stock must NOT have been incremented either (full
    // rollback). If only the status was rolled back but SKU-A's
    // adjust_stock committed independently, that's still a partial
    // receive.
    let stock_a: i64 = conn
        .query_row(
            "SELECT qty FROM inventory WHERE product_id = 'prod-a'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        stock_a, 10,
        "SKU-A stock must be rolled back to 10 (not incremented to 15) \
         when the receive fails atomically — got {stock_a}"
    );
}

// ── Phase 2: receive_purchase_order_with_lines (damage marking) ─────────

/// Helper: create a one-line approved PO for SKU-001 qty 5 (inventory seed 10).
fn seed_approved_po(conn: &Connection) -> (String, String) {
    seed_supplier(conn);
    seed_product(conn);
    let lines = vec![CreatePoLineInput {
        sku: "SKU-001".into(),
        product_name: "Widget".into(),
        qty: 5,
        unit_cost_minor: 1000,
    }];
    let po = store(conn)
        .create_purchase_order("PO-PH2", "sup-po", "", "", None, &lines)
        .unwrap();
    store(conn)
        .update_po_status(&po.order.id, "approved")
        .unwrap();
    let line_id = po.lines[0].id.clone();
    (po.order.id, line_id)
}

#[test]
fn receive_po_with_lines_records_damage_and_good_stock() {
    let conn = fresh();
    let (po_id, line_id) = seed_approved_po(&conn);

    // 3 good, 1 damaged of the 5 ordered → 1 short.
    let received = store(&conn)
        .receive_purchase_order_with_lines(
            &po_id,
            &[ReceivePoLineInput {
                line_id: line_id.clone(),
                received_qty: 3,
                damaged_qty: 1,
            }],
        )
        .unwrap();

    assert_eq!(received.order.status, "received");
    assert!(received.order.received_date.is_some());
    let line = &received.lines[0];
    assert_eq!(line.received_qty, 3);
    assert_eq!(line.damaged_qty, 1);
    assert_eq!(line.short_qty(), 1);
    assert!(!line.fully_accounted());

    // Only good qty enters stock: 10 + 3 = 13.
    let stock: i64 = conn
        .query_row(
            "SELECT qty FROM inventory WHERE product_id='prod-po'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(stock, 13);

    // The receive state must persist on the line row.
    let persisted: (i64, i64) = conn
        .query_row(
            "SELECT received_qty, damaged_qty FROM purchase_order_lines WHERE id=?1",
            [&line_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(persisted, (3, 1));
}

#[test]
fn receive_po_with_lines_fully_accounted_no_short() {
    let conn = fresh();
    let (po_id, line_id) = seed_approved_po(&conn);

    let received = store(&conn)
        .receive_purchase_order_with_lines(
            &po_id,
            &[ReceivePoLineInput {
                line_id: line_id.clone(),
                received_qty: 4,
                damaged_qty: 1,
            }],
        )
        .unwrap();
    let line = &received.lines[0];
    assert_eq!(line.short_qty(), 0);
    assert!(line.fully_accounted());
}

#[test]
fn receive_po_with_lines_uncovered_line_treated_as_short() {
    let conn = fresh();
    let (po_id, _line_id) = seed_approved_po(&conn);

    // Pass an empty input → every line treated as 0 received / 0 damaged.
    let received = store(&conn)
        .receive_purchase_order_with_lines(&po_id, &[])
        .unwrap();
    let line = &received.lines[0];
    assert_eq!(line.received_qty, 0);
    assert_eq!(line.damaged_qty, 0);
    assert_eq!(line.short_qty(), 5);
    // No stock movement: still 10.
    let stock: i64 = conn
        .query_row(
            "SELECT qty FROM inventory WHERE product_id='prod-po'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(stock, 10);
}

#[test]
fn receive_po_with_lines_over_account_rejected() {
    let conn = fresh();
    let (po_id, line_id) = seed_approved_po(&conn);

    let err = store(&conn)
        .receive_purchase_order_with_lines(
            &po_id,
            &[ReceivePoLineInput {
                line_id: line_id.clone(),
                received_qty: 4,
                damaged_qty: 2, // 6 > 5 ordered
            }],
        )
        .unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "qty"));

    // Status must remain approved (atomic rollback).
    let status: String = conn
        .query_row(
            "SELECT status FROM purchase_orders WHERE id=?1",
            [&po_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(status, "approved");
}

#[test]
fn receive_po_with_lines_negative_qty_rejected() {
    let conn = fresh();
    let (po_id, line_id) = seed_approved_po(&conn);

    let err = store(&conn)
        .receive_purchase_order_with_lines(
            &po_id,
            &[ReceivePoLineInput {
                line_id: line_id.clone(),
                received_qty: -1,
                damaged_qty: 0,
            }],
        )
        .unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "qty"));
}

#[test]
fn receive_po_with_lines_not_approved_rejected() {
    let conn = fresh();
    seed_supplier(&conn);
    seed_product(&conn);
    let lines = vec![CreatePoLineInput {
        sku: "SKU-001".into(),
        product_name: "Widget".into(),
        qty: 5,
        unit_cost_minor: 1000,
    }];
    let po = store(&conn)
        .create_purchase_order("PO-PH2-DRAFT", "sup-po", "", "", None, &lines)
        .unwrap(); // status stays 'draft'

    let err = store(&conn)
        .receive_purchase_order_with_lines(
            &po.order.id,
            &[ReceivePoLineInput {
                line_id: po.lines[0].id.clone(),
                received_qty: 5,
                damaged_qty: 0,
            }],
        )
        .unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "status"));
}

#[test]
fn receive_po_with_lines_nonexistent_po_errors() {
    let conn = fresh();
    let err = store(&conn)
        .receive_purchase_order_with_lines(
            "does-not-exist",
            &[ReceivePoLineInput {
                line_id: "x".into(),
                received_qty: 1,
                damaged_qty: 0,
            }],
        )
        .unwrap_err();
    assert!(matches!(err, CoreError::NotFound { entity, .. } if entity == "purchase_order"));
}
