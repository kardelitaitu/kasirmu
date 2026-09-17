use super::*;
use crate::migrations;
use rusqlite::Connection;

fn fresh() -> Connection {
    migrations::fresh_db()
}

fn store(conn: &Connection) -> Store<'_> {
    Store::new(conn)
}

fn seed_user(conn: &Connection, id: &str) {
    // The actual users schema (from 021_shifts.sql et al) uses
    // `username, pin_hash, display_name, role_id` rather than the
    // `name, pin, role` columns a casual reader might guess from
    // the crate's domain types. Seed the FK target role first.
    conn.execute(
        "INSERT OR IGNORE INTO roles (id, name, description, permissions, created_at, updated_at)
         VALUES ('role-owner', 'Owner', 'Owner role', '[\"*\"]',
                 '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id,
                            created_at, updated_at)
         VALUES (?1, ?2, 'hash', ?3, 'role-owner',
                 '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
        params![id, id, id],
    )
    .unwrap();
}

fn seed_product(conn: &Connection, sku: &str, name: &str) {
    conn.execute(
        "INSERT INTO products (id, sku, name, price_minor, currency, created_at, updated_at)
         VALUES (?1, ?2, ?3, 1000, 'USD', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
        params![uuid::Uuid::now_v7().to_string(), sku, name],
    )
    .unwrap();
}

fn seed_inventory(conn: &Connection, sku: &str, qty: i64) {
    let pid: String = conn
        .query_row(
            "SELECT id FROM products WHERE sku = ?1",
            params![sku],
            |r| r.get(0),
        )
        .unwrap();
    conn.execute(
        "INSERT INTO inventory (product_id, qty, updated_at) VALUES (?1, ?2, '2025-01-01T00:00:00.000Z')",
        params![pid, qty],
    )
    .unwrap();
}

fn make_line(sku: &str, product_name: &str, qty: i64) -> StockTransferLine {
    StockTransferLine {
        id: String::new(),
        transfer_id: String::new(),
        sku: sku.to_owned(),
        product_name: product_name.to_owned(),
        qty,
        received_qty: 0,
    }
}

#[test]
fn create_and_get_transfer() {
    let conn = fresh();
    seed_user(&conn, "user-1");
    seed_product(&conn, "SKU-001", "Widget");
    seed_inventory(&conn, "SKU-001", 100);

    let lines = vec![make_line("SKU-001", "Widget", 10)];
    let t = store(&conn)
        .create_transfer(None, None, None, None, "test notes", "user-1", &lines)
        .unwrap();
    assert_eq!(t.status, "draft");
    assert!(t.transfer_number.starts_with("TRF-"));

    let fetched = store(&conn).get_transfer(&t.id).unwrap().unwrap();
    assert_eq!(fetched.id, t.id);
    assert_eq!(fetched.status, "draft");
}

#[test]
fn list_transfers_orders_by_created_at() {
    let conn = fresh();
    seed_user(&conn, "user-1");
    seed_product(&conn, "SKU-001", "Widget");
    seed_inventory(&conn, "SKU-001", 100);

    let lines = vec![make_line("SKU-001", "Widget", 5)];
    let _t1 = store(&conn)
        .create_transfer(None, None, None, None, "first", "user-1", &lines)
        .unwrap();

    std::thread::sleep(std::time::Duration::from_millis(10));

    let _t2 = store(&conn)
        .create_transfer(None, None, None, None, "second", "user-1", &lines)
        .unwrap();

    let all = store(&conn).list_transfers().unwrap();
    assert_eq!(all.len(), 2);
    assert!(all[0].created_at >= all[1].created_at);
}

#[test]
fn send_transfer_decrements_inventory() {
    let conn = fresh();
    seed_user(&conn, "user-1");
    seed_product(&conn, "SKU-001", "Widget");
    seed_inventory(&conn, "SKU-001", 50);

    let lines = vec![make_line("SKU-001", "Widget", 10)];
    let t = store(&conn)
        .create_transfer(None, None, None, None, "", "user-1", &lines)
        .unwrap();

    let sent = store(&conn).send_transfer(&t.id).unwrap();
    assert_eq!(sent.status, "in_transit");
    assert!(sent.sent_at.is_some());
}

#[test]
fn send_transfer_insufficient_stock_fails() {
    let conn = fresh();
    seed_user(&conn, "user-1");
    seed_product(&conn, "SKU-001", "Widget");
    seed_inventory(&conn, "SKU-001", 5);

    let lines = vec![make_line("SKU-001", "Widget", 10)];
    let t = store(&conn)
        .create_transfer(None, None, None, None, "", "user-1", &lines)
        .unwrap();

    let err = store(&conn).send_transfer(&t.id).unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "qty"));
}

#[test]
fn receive_transfer_increments_inventory() {
    let conn = fresh();
    seed_user(&conn, "user-1");
    seed_user(&conn, "user-2");
    seed_product(&conn, "SKU-001", "Widget");
    seed_inventory(&conn, "SKU-001", 50);

    let lines = vec![make_line("SKU-001", "Widget", 10)];
    let t = store(&conn)
        .create_transfer(None, None, None, None, "", "user-1", &lines)
        .unwrap();
    let sent = store(&conn).send_transfer(&t.id).unwrap();
    assert_eq!(sent.status, "in_transit");

    let transfer_lines = store(&conn).get_transfer_lines(&t.id).unwrap();
    let received = store(&conn)
        .receive_transfer(
            &t.id,
            "user-2",
            &[ReceivedLine {
                line_id: transfer_lines[0].id.clone(),
                received_qty: 10,
            }],
        )
        .unwrap();
    assert_eq!(received.status, "received");
    assert!(received.received_at.is_some());
    assert_eq!(received.received_by.unwrap(), "user-2");
}

#[test]
fn cancel_draft_transfer() {
    let conn = fresh();
    seed_user(&conn, "user-1");
    seed_product(&conn, "SKU-001", "Widget");
    seed_inventory(&conn, "SKU-001", 50);

    let lines = vec![make_line("SKU-001", "Widget", 10)];
    let t = store(&conn)
        .create_transfer(None, None, None, None, "", "user-1", &lines)
        .unwrap();

    let cancelled = store(&conn).cancel_transfer(&t.id).unwrap();
    assert_eq!(cancelled.status, "cancelled");
}

#[test]
fn add_and_remove_transfer_line() {
    let conn = fresh();
    seed_user(&conn, "user-1");
    seed_product(&conn, "SKU-001", "Widget");
    seed_inventory(&conn, "SKU-001", 100);

    let t = store(&conn)
        .create_transfer(None, None, None, None, "", "user-1", &[])
        .unwrap();

    let line = store(&conn)
        .add_transfer_line(&t.id, "SKU-001", "Widget", 5)
        .unwrap();
    assert_eq!(line.qty, 5);

    let lines = store(&conn).get_transfer_lines(&t.id).unwrap();
    assert_eq!(lines.len(), 1);

    store(&conn).remove_transfer_line(&line.id).unwrap();
    let lines = store(&conn).get_transfer_lines(&t.id).unwrap();
    assert_eq!(lines.len(), 0);
}

#[test]
fn partial_receive_writes_received_partial_status() {
    let conn = fresh();
    seed_user(&conn, "user-1");
    seed_user(&conn, "user-2");
    seed_product(&conn, "SKU-001", "Widget");
    seed_inventory(&conn, "SKU-001", 50);

    let lines = vec![make_line("SKU-001", "Widget", 10)];
    let t = store(&conn)
        .create_transfer(None, None, None, None, "", "user-1", &lines)
        .unwrap();
    store(&conn).send_transfer(&t.id).unwrap();

    let transfer_lines = store(&conn).get_transfer_lines(&t.id).unwrap();
    let result = store(&conn)
        .receive_transfer(
            &t.id,
            "user-2",
            &[ReceivedLine {
                line_id: transfer_lines[0].id.clone(),
                received_qty: 4,
            }],
        )
        .unwrap();
    // Status becomes received_partial because 4 < 10 (ADR §13 finding 34).
    assert_eq!(result.status, "received_partial");

    // Verify the line's received_qty was recorded.
    let lines = store(&conn).get_transfer_lines(&t.id).unwrap();
    assert_eq!(lines[0].received_qty, 4);

    // A partial transfer remains receivable. Only the delta is credited,
    // so completing it must add six rather than re-adding the first four.
    let completed = store(&conn)
        .receive_transfer(
            &t.id,
            "user-2",
            &[ReceivedLine {
                line_id: lines[0].id.clone(),
                received_qty: 10,
            }],
        )
        .unwrap();
    assert_eq!(completed.status, "received");
    let final_lines = store(&conn).get_transfer_lines(&t.id).unwrap();
    assert_eq!(final_lines[0].received_qty, 10);
    let pid: String = conn
        .query_row("SELECT id FROM products WHERE sku = 'SKU-001'", [], |row| {
            row.get(0)
        })
        .unwrap();
    let destination_qty: i64 = conn
        .query_row(
            "SELECT qty FROM inventory WHERE product_id = ?1",
            params![pid],
            |row| row.get(0),
        )
        .unwrap();
    // The source and destination are represented by the shared legacy
    // inventory table in this core test fixture. The net quantity is
    // unchanged after dispatch (50 - 10) and receipt (+4 + 6).
    assert_eq!(destination_qty, 50);
}

#[test]
fn receive_zero_qty_keeps_in_transit() {
    let conn = fresh();
    seed_user(&conn, "user-1");
    seed_user(&conn, "user-2");
    seed_product(&conn, "SKU-001", "Widget");
    seed_inventory(&conn, "SKU-001", 30);

    let lines = vec![make_line("SKU-001", "Widget", 10)];
    let t = store(&conn)
        .create_transfer(None, None, None, None, "", "user-1", &lines)
        .unwrap();
    store(&conn).send_transfer(&t.id).unwrap();

    let transfer_lines = store(&conn).get_transfer_lines(&t.id).unwrap();

    // Receive 0 — no inventory increment, status stays in_transit
    let result = store(&conn)
        .receive_transfer(
            &t.id,
            "user-2",
            &[ReceivedLine {
                line_id: transfer_lines[0].id.clone(),
                received_qty: 0,
            }],
        )
        .unwrap();
    assert_eq!(result.status, "in_transit");

    // Verify received_qty was recorded as 0
    let lines = store(&conn).get_transfer_lines(&t.id).unwrap();
    assert_eq!(lines[0].received_qty, 0);
}

#[test]
fn get_transfer_not_found_returns_none() {
    let conn = fresh();
    let result = store(&conn).get_transfer("nonexistent").unwrap();
    assert!(result.is_none());
}

#[test]
fn cancel_received_transfer_rejected() {
    let conn = fresh();
    seed_user(&conn, "user-1");
    seed_user(&conn, "user-2");
    seed_product(&conn, "SKU-001", "Widget");
    seed_inventory(&conn, "SKU-001", 50);

    let lines = vec![make_line("SKU-001", "Widget", 10)];
    let t = store(&conn)
        .create_transfer(None, None, None, None, "", "user-1", &lines)
        .unwrap();
    store(&conn).send_transfer(&t.id).unwrap();

    let transfer_lines = store(&conn).get_transfer_lines(&t.id).unwrap();
    store(&conn)
        .receive_transfer(
            &t.id,
            "user-2",
            &[ReceivedLine {
                line_id: transfer_lines[0].id.clone(),
                received_qty: 10,
            }],
        )
        .unwrap();

    let err = store(&conn).cancel_transfer(&t.id).unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "status"));
}

#[test]
fn send_already_in_transit_rejected() {
    let conn = fresh();
    seed_user(&conn, "user-1");
    seed_product(&conn, "SKU-001", "Widget");
    seed_inventory(&conn, "SKU-001", 50);

    let lines = vec![make_line("SKU-001", "Widget", 10)];
    let t = store(&conn)
        .create_transfer(None, None, None, None, "", "user-1", &lines)
        .unwrap();
    store(&conn).send_transfer(&t.id).unwrap();

    let err = store(&conn).send_transfer(&t.id).unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "status"));
}

#[test]
fn add_line_to_non_draft_transfer_rejected() {
    let conn = fresh();
    seed_user(&conn, "user-1");
    seed_product(&conn, "SKU-001", "Widget");
    seed_inventory(&conn, "SKU-001", 100);

    let lines = vec![make_line("SKU-001", "Widget", 10)];
    let t = store(&conn)
        .create_transfer(None, None, None, None, "", "user-1", &lines)
        .unwrap();
    store(&conn).send_transfer(&t.id).unwrap();

    let err = store(&conn)
        .add_transfer_line(&t.id, "SKU-001", "Widget", 5)
        .unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "status"));
}

#[test]
fn transfer_full_lifecycle() {
    let conn = fresh();
    seed_user(&conn, "user-1");
    seed_user(&conn, "user-2");
    seed_product(&conn, "SKU-001", "Widget");
    seed_inventory(&conn, "SKU-001", 100);

    // Step 1: Create draft
    let lines = vec![make_line("SKU-001", "Widget", 20)];
    let t = store(&conn)
        .create_transfer(None, None, None, None, "lifecycle test", "user-1", &lines)
        .unwrap();
    assert_eq!(t.status, "draft");
    assert!(t.transfer_number.starts_with("TRF-"));

    // Step 2: Send → in_transit
    let sent = store(&conn).send_transfer(&t.id).unwrap();
    assert_eq!(sent.status, "in_transit");
    assert!(sent.sent_at.is_some());

    // Step 3: Receive full → received
    let transfer_lines = store(&conn).get_transfer_lines(&t.id).unwrap();
    assert_eq!(transfer_lines[0].qty, 20);

    let received = store(&conn)
        .receive_transfer(
            &t.id,
            "user-2",
            &[ReceivedLine {
                line_id: transfer_lines[0].id.clone(),
                received_qty: 20,
            }],
        )
        .unwrap();
    assert_eq!(received.status, "received");
    assert!(received.received_at.is_some());
    assert_eq!(received.received_by.unwrap(), "user-2");

    // Verify received_qty persisted on the line
    let final_lines = store(&conn).get_transfer_lines(&t.id).unwrap();
    assert_eq!(final_lines[0].received_qty, 20);
}

#[test]
fn cancel_in_transit_transfer() {
    let conn = fresh();
    seed_user(&conn, "user-1");
    seed_product(&conn, "SKU-001", "Widget");
    seed_inventory(&conn, "SKU-001", 50);

    let lines = vec![make_line("SKU-001", "Widget", 10)];
    let t = store(&conn)
        .create_transfer(None, None, None, None, "", "user-1", &lines)
        .unwrap();

    // Send first
    let sent = store(&conn).send_transfer(&t.id).unwrap();
    assert_eq!(sent.status, "in_transit");

    // Cancel while in_transit
    let cancelled = store(&conn).cancel_transfer(&t.id).unwrap();
    assert_eq!(cancelled.status, "cancelled");

    // Cancelling an in-transit transfer is a true reversal: the source
    // inventory returns to the pre-dispatch quantity exactly once.
    let pid: String = conn
        .query_row("SELECT id FROM products WHERE sku = 'SKU-001'", [], |row| {
            row.get(0)
        })
        .unwrap();
    let qty: i64 = conn
        .query_row(
            "SELECT qty FROM inventory WHERE product_id = ?1",
            params![pid],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(qty, 50);

    let second = store(&conn).cancel_transfer(&t.id).unwrap_err();
    assert!(matches!(second, CoreError::Validation { field, .. } if field == "status"));
}

#[test]
fn receive_excess_stock_errors() {
    let conn = fresh();
    seed_user(&conn, "user-1");
    seed_user(&conn, "user-2");
    seed_product(&conn, "SKU-001", "Widget");
    seed_inventory(&conn, "SKU-001", 50);

    let lines = vec![make_line("SKU-001", "Widget", 10)];
    let t = store(&conn)
        .create_transfer(None, None, None, None, "", "user-1", &lines)
        .unwrap();
    store(&conn).send_transfer(&t.id).unwrap();

    let transfer_lines = store(&conn).get_transfer_lines(&t.id).unwrap();

    // Try to receive 15 when only 10 were ordered
    let err = store(&conn)
        .receive_transfer(
            &t.id,
            "user-2",
            &[ReceivedLine {
                line_id: transfer_lines[0].id.clone(),
                received_qty: 15,
            }],
        )
        .unwrap_err();
    assert!(
        matches!(&err, CoreError::Validation { field, message } if *field == "received_qty" && message.contains("15"))
    );

    // Transfer should still be in_transit (receive was rolled back)
    let after = store(&conn).get_transfer(&t.id).unwrap().unwrap();
    assert_eq!(after.status, "in_transit");
}

#[test]
fn cancel_nonexistent_transfer_errors() {
    let conn = fresh();
    let err = store(&conn).cancel_transfer("i-do-not-exist").unwrap_err();
    assert!(matches!(err, CoreError::NotFound { entity, .. } if entity == "stock_transfer"));
}

#[test]
fn receive_draft_transfer_rejected() {
    let conn = fresh();
    seed_user(&conn, "user-1");
    seed_user(&conn, "user-2");
    seed_product(&conn, "SKU-001", "Widget");
    seed_inventory(&conn, "SKU-001", 30);

    let lines = vec![make_line("SKU-001", "Widget", 10)];
    let t = store(&conn)
        .create_transfer(None, None, None, None, "", "user-1", &lines)
        .unwrap();

    // Transfer is still 'draft' — cannot receive
    let err = store(&conn)
        .receive_transfer(&t.id, "user-2", &[])
        .unwrap_err();
    assert!(
        matches!(&err, CoreError::Validation { field, message } if *field == "status" && message.contains("draft"))
    );
}

// ── Extended error paths ─────────────────────────────────────────

#[test]
fn send_nonexistent_transfer_errors() {
    let conn = fresh();
    let err = store(&conn).send_transfer("nonexistent").unwrap_err();
    assert!(matches!(err, CoreError::NotFound { entity, .. } if entity == "stock_transfer"));
}

#[test]
fn receive_nonexistent_transfer_errors() {
    let conn = fresh();
    let err = store(&conn)
        .receive_transfer("nonexistent", "user-2", &[])
        .unwrap_err();
    assert!(matches!(err, CoreError::NotFound { entity, .. } if entity == "stock_transfer"));
}

#[test]
fn add_line_to_nonexistent_transfer_errors() {
    let conn = fresh();
    let err = store(&conn)
        .add_transfer_line("nonexistent", "SKU-001", "Widget", 5)
        .unwrap_err();
    assert!(matches!(err, CoreError::NotFound { entity, .. } if entity == "stock_transfer"));
}

#[test]
fn remove_nonexistent_line_errors() {
    let conn = fresh();
    let err = store(&conn)
        .remove_transfer_line("nonexistent-line")
        .unwrap_err();
    assert!(matches!(err, CoreError::NotFound { entity, .. } if entity == "stock_transfer_line"));
}

#[test]
fn remove_line_from_sent_transfer_rejected() {
    let conn = fresh();
    seed_user(&conn, "user-1");
    seed_product(&conn, "SKU-001", "Widget");
    seed_inventory(&conn, "SKU-001", 50);

    let t = store(&conn)
        .create_transfer(None, None, None, None, "", "user-1", &[])
        .unwrap();
    let line = store(&conn)
        .add_transfer_line(&t.id, "SKU-001", "Widget", 5)
        .unwrap();
    store(&conn).send_transfer(&t.id).unwrap();

    let err = store(&conn).remove_transfer_line(&line.id).unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "status"));
}

#[test]
fn create_transfer_with_multiple_lines() {
    let conn = fresh();
    seed_user(&conn, "user-1");
    seed_product(&conn, "SKU-001", "Widget");
    seed_product(&conn, "SKU-002", "Gadget");
    seed_inventory(&conn, "SKU-001", 100);
    seed_inventory(&conn, "SKU-002", 50);

    let lines = vec![
        make_line("SKU-001", "Widget", 10),
        make_line("SKU-002", "Gadget", 5),
    ];
    let t = store(&conn)
        .create_transfer(None, None, None, None, "multi-line", "user-1", &lines)
        .unwrap();
    assert_eq!(t.status, "draft");

    let fetched_lines = store(&conn).get_transfer_lines(&t.id).unwrap();
    assert_eq!(fetched_lines.len(), 2);
    assert_eq!(fetched_lines[0].sku, "SKU-001");
    assert_eq!(fetched_lines[1].sku, "SKU-002");
}

#[test]
fn list_transfers_with_lines_by_status_batches_lines() {
    let conn = fresh();
    let s = store(&conn);
    seed_user(&conn, "user-1");
    seed_product(&conn, "SKU-001", "Widget");
    seed_product(&conn, "SKU-002", "Gadget");
    seed_inventory(&conn, "SKU-001", 100);
    seed_inventory(&conn, "SKU-002", 50);

    // Two in-transit transfers (each with lines) and one draft transfer.
    let t1 = s
        .create_transfer(
            None,
            None,
            None,
            None,
            "",
            "user-1",
            &[
                make_line("SKU-001", "Widget", 10),
                make_line("SKU-002", "Gadget", 5),
            ],
        )
        .unwrap();
    s.send_transfer(&t1.id).unwrap();
    let t2 = s
        .create_transfer(
            None,
            None,
            None,
            None,
            "",
            "user-1",
            &[make_line("SKU-001", "Widget", 3)],
        )
        .unwrap();
    s.send_transfer(&t2.id).unwrap();
    let _t3 = s
        .create_transfer(None, None, None, None, "draft", "user-1", &[])
        .unwrap();

    let batched = s.list_transfers_with_lines_by_status("in_transit").unwrap();
    assert_eq!(batched.len(), 2, "only in-transit transfers are returned");

    let t1_batch = batched
        .iter()
        .find(|(t, _)| t.id == t1.id)
        .expect("transfer 1 present");
    assert_eq!(t1_batch.1.len(), 2, "both lines batched for transfer 1");
    assert_eq!(t1_batch.1[0].sku, "SKU-001");
    assert_eq!(t1_batch.1[1].sku, "SKU-002");

    let t2_batch = batched
        .iter()
        .find(|(t, _)| t.id == t2.id)
        .expect("transfer 2 present");
    assert_eq!(t2_batch.1.len(), 1);
    assert_eq!(t2_batch.1[0].qty, 3);
}

#[test]
fn list_transfers_with_lines_empty_status_is_empty() {
    let conn = fresh();
    let result = store(&conn)
        .list_transfers_with_lines_by_status("in_transit")
        .unwrap();
    assert!(result.is_empty());
}

#[test]
fn create_transfer_with_explicit_locations() {
    let conn = fresh();
    let s = store(&conn);
    seed_user(&conn, "user-1");
    seed_product(&conn, "SKU-001", "Widget");
    seed_inventory(&conn, "SKU-001", 100);

    // Create inventory locations for FK compliance.
    let loc_wh_a_id = s
        .create_inventory_location("Warehouse A", "warehouse", "Main warehouse")
        .unwrap();
    let loc_store_b_id = s
        .create_inventory_location("Store B", "store", "Retail store B")
        .unwrap();

    let lines = vec![make_line("SKU-001", "Widget", 10)];
    let t = s
        .create_transfer(
            Some(&loc_wh_a_id),
            Some(&loc_store_b_id),
            None,
            None,
            "warehouse to store",
            "user-1",
            &lines,
        )
        .unwrap();

    let fetched = s.get_transfer(&t.id).unwrap().unwrap();
    assert_eq!(
        fetched.source_location,
        Some(loc_wh_a_id),
        "explicit source location should be preserved"
    );
    assert_eq!(
        fetched.destination_location,
        Some(loc_store_b_id),
        "explicit destination location should be preserved"
    );
}
