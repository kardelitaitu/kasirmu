//! Integration tests for the purchase order module — create with lines,
//! list, get, status transitions, receive with inventory update, and
//! validation.
//!
//! Tests exercise the full persistence layer via the public
//! [`kasirmu_core::Store`] API against an in-memory SQLite database.

use kasirmu_core::db::purchase_orders::CreatePoLineInput;
use kasirmu_core::{Store, migrations};
use rusqlite::Connection;

// ── Helpers ───────────────────────────────────────────────────────────

fn setup() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    migrations::run(&mut conn).unwrap();
    conn
}

fn store(conn: &Connection) -> Store<'_> {
    Store::new(conn)
}

fn seed_supplier(conn: &Connection, id: &str, name: &str) {
    conn.execute(
        "INSERT INTO suppliers (id, code, name, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'active', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
        rusqlite::params![id, name, name],
    )
    .unwrap();
}

fn seed_product_with_inventory(conn: &Connection, sku: &str, name: &str, qty: i64) -> String {
    let pid = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO products (id, sku, name, price_minor, currency, created_at, updated_at, price_updated_at)
         VALUES (?1, ?2, ?3, 1000, 'USD', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
        rusqlite::params![pid, sku, name],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO inventory (product_id, qty) VALUES (?1, ?2)",
        rusqlite::params![pid, qty],
    )
    .unwrap();
    // Also seed stock_summary at the canonical default location so
    // adjust_stock_at_location_with_reason (which reads current qty from
    // stock_summary, not the legacy inventory table) sees the correct
    // initial quantity.
    conn.execute(
        "INSERT INTO stock_summary (item_id, location_id, qty, updated_at) VALUES (?1, ?2, ?3, '2025-01-01T00:00:00.000Z')",
        rusqlite::params![pid, kasirmu_core::inventory::CANONICAL_DEFAULT_LOCATION_UUID, qty],
    )
    .unwrap();
    pid
}

fn get_inventory_qty(conn: &Connection, sku: &str) -> i64 {
    conn.query_row(
        "SELECT COALESCE(qty, 0) FROM inventory i JOIN products p ON i.product_id = p.id WHERE p.sku = ?1",
        rusqlite::params![sku],
        |r| r.get(0),
    )
    .unwrap_or(0)
}

fn one_line(sku: &str, name: &str, qty: i64, cost: i64) -> CreatePoLineInput {
    CreatePoLineInput {
        sku: sku.into(),
        product_name: name.into(),
        qty,
        unit_cost_minor: cost,
    }
}

// ── Create ────────────────────────────────────────────────────────────

#[test]
fn create_po_starts_as_draft_with_lines() {
    let conn = setup();
    seed_supplier(&conn, "sup-1", "Acme");

    let lines = vec![one_line("SKU-001", "Widget", 5, 1000)];
    let po = store(&conn)
        .create_purchase_order("PO-001", "sup-1", "2025-06-01", "Urgent", None, &lines)
        .unwrap();

    assert_eq!(po.order.po_number, "PO-001");
    assert_eq!(po.order.status, "draft");
    assert_eq!(po.order.subtotal_minor, 5000);
    assert_eq!(po.order.total_minor, 5000);
    assert_eq!(po.lines.len(), 1);
    assert_eq!(po.lines[0].sku, "SKU-001");
    assert_eq!(po.lines[0].qty, 5);
}

#[test]
fn create_po_with_multiple_lines() {
    let conn = setup();
    seed_supplier(&conn, "sup-1", "Acme");

    let lines = vec![
        one_line("SKU-A", "Product A", 3, 500),
        one_line("SKU-B", "Product B", 10, 200),
    ];
    let po = store(&conn)
        .create_purchase_order("PO-MULTI", "sup-1", "", "", None, &lines)
        .unwrap();

    assert_eq!(po.lines.len(), 2);
    // Subtotal: 3*500 + 10*200 = 1500 + 2000 = 3500.
    assert_eq!(po.order.subtotal_minor, 3500);
}

#[test]
fn create_po_empty_po_number_fails() {
    let conn = setup();
    seed_supplier(&conn, "sup-1", "Acme");

    let err = store(&conn)
        .create_purchase_order("", "sup-1", "", "", None, &[])
        .unwrap_err();
    assert!(matches!(
        err,
        kasirmu_core::CoreError::Validation {
            field: "po_number",
            ..
        }
    ));
}

#[test]
fn create_po_negative_qty_fails() {
    let conn = setup();
    seed_supplier(&conn, "sup-1", "Acme");

    let lines = vec![one_line("SKU-001", "Widget", -1, 1000)];
    let err = store(&conn)
        .create_purchase_order("PO-NEG", "sup-1", "", "", None, &lines)
        .unwrap_err();
    assert!(matches!(
        err,
        kasirmu_core::CoreError::Validation { field: "qty", .. }
    ));
}

#[test]
fn create_po_negative_cost_fails() {
    let conn = setup();
    seed_supplier(&conn, "sup-1", "Acme");

    let lines = vec![one_line("SKU-001", "Widget", 5, -100)];
    let err = store(&conn)
        .create_purchase_order("PO-NEGCOST", "sup-1", "", "", None, &lines)
        .unwrap_err();
    assert!(matches!(
        err,
        kasirmu_core::CoreError::Validation {
            field: "unit_cost_minor",
            ..
        }
    ));
}

// ── List & Get ───────────────────────────────────────────────────────

#[test]
fn list_purchase_orders_includes_lines_and_supplier() {
    let conn = setup();
    seed_supplier(&conn, "sup-1", "Acme Corp");

    let lines = vec![one_line("SKU-001", "Widget", 2, 500)];
    store(&conn)
        .create_purchase_order("PO-LIST", "sup-1", "", "", None, &lines)
        .unwrap();

    let list = store(&conn).list_purchase_orders().unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].lines.len(), 1);
    assert_eq!(list[0].supplier_name.as_deref(), Some("Acme Corp"));
}

#[test]
fn get_po_by_id_returns_lines() {
    let conn = setup();
    seed_supplier(&conn, "sup-1", "Acme");

    let lines = vec![one_line("SKU-001", "Widget", 3, 1000)];
    let created = store(&conn)
        .create_purchase_order("PO-GET", "sup-1", "", "", None, &lines)
        .unwrap();

    let fetched = store(&conn)
        .get_purchase_order(&created.order.id)
        .unwrap()
        .unwrap();

    assert_eq!(fetched.order.po_number, "PO-GET");
    assert_eq!(fetched.lines.len(), 1);
    assert_eq!(fetched.lines[0].qty, 3);
}

#[test]
fn get_po_not_found() {
    let conn = setup();
    let po = store(&conn).get_purchase_order("nope").unwrap();
    assert!(po.is_none());
}

// ── Status transitions ───────────────────────────────────────────────

#[test]
fn update_po_status_through_lifecycle() {
    let conn = setup();
    seed_supplier(&conn, "sup-1", "Acme");

    let po = store(&conn)
        .create_purchase_order("PO-LIFE", "sup-1", "", "", None, &[])
        .unwrap();

    // draft → pending.
    let p = store(&conn)
        .update_po_status(&po.order.id, "pending")
        .unwrap();
    assert_eq!(p.order.status, "pending");

    // pending → approved.
    let a = store(&conn)
        .update_po_status(&po.order.id, "approved")
        .unwrap();
    assert_eq!(a.order.status, "approved");
}

#[test]
fn update_po_invalid_status_fails() {
    let conn = setup();
    seed_supplier(&conn, "sup-1", "Acme");

    let po = store(&conn)
        .create_purchase_order("PO-INV", "sup-1", "", "", None, &[])
        .unwrap();

    let err = store(&conn)
        .update_po_status(&po.order.id, "shipped")
        .unwrap_err();
    assert!(matches!(
        err,
        kasirmu_core::CoreError::Validation {
            field: "status",
            ..
        }
    ));
}

#[test]
fn update_po_status_not_found_fails() {
    let conn = setup();
    let err = store(&conn)
        .update_po_status("nope", "approved")
        .unwrap_err();
    assert!(matches!(
        err,
        kasirmu_core::CoreError::NotFound {
            entity: "purchase_order",
            ..
        }
    ));
}

// ── Receive ──────────────────────────────────────────────────────────

#[test]
fn receive_po_updates_inventory() {
    let conn = setup();
    seed_supplier(&conn, "sup-1", "Acme");
    seed_product_with_inventory(&conn, "SKU-RECV", "Receivable", 10);

    let lines = vec![one_line("SKU-RECV", "Receivable", 5, 1000)];
    let po = store(&conn)
        .create_purchase_order("PO-RECV", "sup-1", "", "", None, &lines)
        .unwrap();

    store(&conn)
        .update_po_status(&po.order.id, "approved")
        .unwrap();
    let received = store(&conn).receive_purchase_order(&po.order.id).unwrap();

    assert_eq!(received.order.status, "received");
    assert!(received.order.received_date.is_some());

    // Inventory: 10 + 5 = 15.
    assert_eq!(get_inventory_qty(&conn, "SKU-RECV"), 15);
}

#[test]
fn receive_non_approved_po_fails() {
    let conn = setup();
    seed_supplier(&conn, "sup-1", "Acme");

    let po = store(&conn)
        .create_purchase_order("PO-DRAFT-RECV", "sup-1", "", "", None, &[])
        .unwrap();

    let err = store(&conn)
        .receive_purchase_order(&po.order.id)
        .unwrap_err();
    assert!(matches!(
        err,
        kasirmu_core::CoreError::Validation {
            field: "status",
            ..
        }
    ));
}

// ── Cancel ────────────────────────────────────────────────────────────

#[test]
fn update_po_to_cancelled() {
    let conn = setup();
    seed_supplier(&conn, "sup-1", "Acme");

    let po = store(&conn)
        .create_purchase_order("PO-CANCEL", "sup-1", "", "", None, &[])
        .unwrap();

    let cancelled = store(&conn)
        .update_po_status(&po.order.id, "cancelled")
        .unwrap();
    assert_eq!(cancelled.order.status, "cancelled");
}
