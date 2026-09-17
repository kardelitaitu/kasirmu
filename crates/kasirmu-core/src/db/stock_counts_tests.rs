use super::*;
use crate::migrations;
use crate::stock_count::{CountType, StockCountLine, StockCountStatus};
use rusqlite::Connection;

fn fresh_conn() -> Connection {
    migrations::fresh_db()
}

fn seed_product(conn: &Connection, sku: &str, name: &str) {
    conn.execute(
        "INSERT INTO products (id, sku, name, price_minor, currency, created_at, updated_at) VALUES (?1, ?2, ?3, 1000, 'USD', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
        params![uuid::Uuid::now_v7().to_string(), sku, name],
    ).unwrap();
}

fn seed_inventory(conn: &Connection, product_id: &str, qty: i64) {
    conn.execute(
        "INSERT OR IGNORE INTO inventory (product_id, qty, updated_at) VALUES (?1, ?2, '2025-01-01T00:00:00.000Z')",
        params![product_id, qty],
    ).unwrap();
}

fn seed_user(conn: &Connection, id: &str) {
    // The actual users schema (from 021_shifts.sql et al) uses
    // `username, pin_hash, display_name, role_id` rather than the
    // `name, pin, role` columns a casual reader might guess.
    // `complete_stock_count` writes `stock_adjustments.created_by`
    // with the caller's id, so the FK target row must exist.
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

#[test]
fn create_and_get_stock_count() {
    let conn = fresh_conn();
    let store = Store::new(&conn);
    let id = uuid::Uuid::now_v7().to_string();
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    let count = StockCount {
        id: id.clone(),
        count_number: "CNT-TEST-001".into(),
        status: StockCountStatus::Draft,
        count_type: CountType::Full,
        notes: "Test count".into(),
        counted_by: None,
        created_at: now.clone(),
        completed_at: None,
        updated_at: now.clone(),
    };
    store.create_stock_count(&count).unwrap();

    let fetched = store.get_stock_count(&id).unwrap().expect("should exist");
    assert_eq!(fetched.count_number, "CNT-TEST-001");
    assert_eq!(fetched.status, StockCountStatus::Draft);
    assert_eq!(fetched.count_type, CountType::Full);
}

#[test]
fn list_stock_counts_ordered() {
    let conn = fresh_conn();
    let store = Store::new(&conn);
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    let c1 = StockCount {
        id: uuid::Uuid::now_v7().to_string(),
        count_number: "CNT-001".into(),
        status: StockCountStatus::Draft,
        count_type: CountType::Full,
        notes: "".into(),
        counted_by: None,
        created_at: "2025-01-02T00:00:00.000Z".into(),
        completed_at: None,
        updated_at: now.clone(),
    };
    let c2 = StockCount {
        id: uuid::Uuid::now_v7().to_string(),
        count_number: "CNT-002".into(),
        status: StockCountStatus::Completed,
        count_type: CountType::Cyclic,
        notes: "".into(),
        counted_by: None,
        created_at: "2025-01-01T00:00:00.000Z".into(),
        completed_at: Some(now.clone()),
        updated_at: now.clone(),
    };

    store.create_stock_count(&c1).unwrap();
    store.create_stock_count(&c2).unwrap();

    let list = store.list_stock_counts().unwrap();
    assert_eq!(list.len(), 2);
    // Newest first.
    assert_eq!(list[0].count_number, "CNT-001");
}

#[test]
fn add_and_get_count_lines() {
    let conn = fresh_conn();
    let store = Store::new(&conn);
    let count_id = uuid::Uuid::now_v7().to_string();
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    let count = StockCount {
        id: count_id.clone(),
        count_number: "CNT-LINES".into(),
        status: StockCountStatus::Draft,
        count_type: CountType::Full,
        notes: "".into(),
        counted_by: None,
        created_at: now.clone(),
        completed_at: None,
        updated_at: now.clone(),
    };
    store.create_stock_count(&count).unwrap();

    let line = StockCountLine {
        id: uuid::Uuid::now_v7().to_string(),
        count_id: count_id.clone(),
        sku: "TEST-SKU".into(),
        product_name: "Test Product".into(),
        expected_qty: 10,
        counted_qty: None,
        difference: 0,
        notes: "".into(),
    };
    store.add_count_line(&line).unwrap();

    let lines = store.get_count_lines(&count_id).unwrap();
    assert_eq!(lines.len(), 1);
    assert_eq!(lines[0].sku, "TEST-SKU");
    assert_eq!(lines[0].expected_qty, 10);
}

#[test]
fn update_count_line() {
    let conn = fresh_conn();
    let store = Store::new(&conn);
    let count_id = uuid::Uuid::now_v7().to_string();
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    let count = StockCount {
        id: count_id.clone(),
        count_number: "CNT-UPDATE".into(),
        status: StockCountStatus::InProgress,
        count_type: CountType::Spot,
        notes: "".into(),
        counted_by: None,
        created_at: now.clone(),
        completed_at: None,
        updated_at: now.clone(),
    };
    store.create_stock_count(&count).unwrap();

    let line = StockCountLine {
        id: uuid::Uuid::now_v7().to_string(),
        count_id: count_id.clone(),
        sku: "UPDATE-SKU".into(),
        product_name: "Update Product".into(),
        expected_qty: 10,
        counted_qty: None,
        difference: 0,
        notes: "".into(),
    };
    store.add_count_line(&line).unwrap();

    let updated = StockCountLine {
        id: line.id.clone(),
        count_id: count_id.clone(),
        sku: "UPDATE-SKU".into(),
        product_name: "Update Product".into(),
        expected_qty: 10,
        counted_qty: Some(8),
        difference: -2,
        notes: "Found 2 missing".into(),
    };
    store.update_count_line(&updated).unwrap();

    let lines = store.get_count_lines(&count_id).unwrap();
    assert_eq!(lines[0].counted_qty, Some(8));
    assert_eq!(lines[0].difference, -2);
}

#[test]
fn complete_stock_count_creates_adjustments() {
    let conn = fresh_conn();
    let store = Store::new(&conn);
    let count_id = uuid::Uuid::now_v7().to_string();
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    // Seed user (FK target on stock_adjustments.created_by), product,
    // and inventory rows before the test exercises the workflow.
    seed_user(&conn, "user-1");
    seed_product(&conn, "SKU-A", "Product A");
    let pid: String = conn
        .query_row("SELECT id FROM products WHERE sku='SKU-A'", [], |r| {
            r.get(0)
        })
        .unwrap();
    seed_inventory(&conn, &pid, 10);

    let count = StockCount {
        id: count_id.clone(),
        count_number: "CNT-COMPLETE".into(),
        status: StockCountStatus::InProgress,
        count_type: CountType::Cyclic,
        notes: "".into(),
        counted_by: None,
        created_at: now.clone(),
        completed_at: None,
        updated_at: now.clone(),
    };
    store.create_stock_count(&count).unwrap();

    let line = StockCountLine {
        id: uuid::Uuid::now_v7().to_string(),
        count_id: count_id.clone(),
        sku: "SKU-A".into(),
        product_name: "Product A".into(),
        expected_qty: 10,
        counted_qty: Some(8),
        difference: -2,
        notes: "".into(),
    };
    store.add_count_line(&line).unwrap();

    // Update count status to in_progress.
    let mut update = count.clone();
    update.status = StockCountStatus::InProgress;
    store.update_stock_count(&update).unwrap();

    let adjustments = store
        .complete_stock_count(&count_id, Some("user-1"))
        .unwrap();
    assert_eq!(adjustments.len(), 1);
    assert_eq!(adjustments[0].sku, "SKU-A");
    assert_eq!(adjustments[0].previous_qty, 10);
    assert_eq!(adjustments[0].adjusted_qty, 8);

    // Verify inventory was updated.
    let new_qty: i64 = conn
        .query_row(
            "SELECT qty FROM inventory WHERE product_id=?1",
            params![pid],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(new_qty, 8);

    // Count should be completed.
    let updated_count = store.get_stock_count(&count_id).unwrap().unwrap();
    assert_eq!(updated_count.status, StockCountStatus::Completed);
}

#[test]
fn next_count_number_generates_sequential() {
    let conn = fresh_conn();
    let store = Store::new(&conn);
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    let n1 = store.next_count_number().unwrap();
    assert!(n1.starts_with("CNT-"));

    // Create a count with that number.
    let count = StockCount {
        id: uuid::Uuid::now_v7().to_string(),
        count_number: n1.clone(),
        status: StockCountStatus::Draft,
        count_type: CountType::Full,
        notes: "".into(),
        counted_by: None,
        created_at: now.clone(),
        completed_at: None,
        updated_at: now.clone(),
    };
    store.create_stock_count(&count).unwrap();

    let n2 = store.next_count_number().unwrap();
    assert_ne!(n1, n2);
    assert!(n2 > n1);
}

#[test]
fn remove_count_line() {
    let conn = fresh_conn();
    let store = Store::new(&conn);
    let count_id = uuid::Uuid::now_v7().to_string();
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    let count = StockCount {
        id: count_id.clone(),
        count_number: "CNT-REMOVE".into(),
        status: StockCountStatus::Draft,
        count_type: CountType::Full,
        notes: "".into(),
        counted_by: None,
        created_at: now.clone(),
        completed_at: None,
        updated_at: now.clone(),
    };
    store.create_stock_count(&count).unwrap();

    let line = StockCountLine {
        id: uuid::Uuid::now_v7().to_string(),
        count_id: count_id.clone(),
        sku: "RM-SKU".into(),
        product_name: "Remove Me".into(),
        expected_qty: 5,
        counted_qty: None,
        difference: 0,
        notes: "".into(),
    };
    store.add_count_line(&line).unwrap();
    assert_eq!(store.get_count_lines(&count_id).unwrap().len(), 1);

    store.remove_count_line(&line.id).unwrap();
    assert!(store.get_count_lines(&count_id).unwrap().is_empty());
}

#[test]
fn complete_already_completed_count_rejected() {
    let conn = fresh_conn();
    let store = Store::new(&conn);
    let count_id = uuid::Uuid::now_v7().to_string();
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    let count = StockCount {
        id: count_id.clone(),
        count_number: "CNT-COMPLETED".into(),
        status: StockCountStatus::Completed,
        count_type: CountType::Full,
        notes: "".into(),
        counted_by: None,
        created_at: now.clone(),
        completed_at: Some(now.clone()),
        updated_at: now.clone(),
    };
    store.create_stock_count(&count).unwrap();

    let err = store.complete_stock_count(&count_id, None).unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "status"));
}

#[test]
fn get_count_line_by_id_not_found_returns_none() {
    let conn = fresh_conn();
    let store = Store::new(&conn);
    let result = store.get_count_line_by_id("nonexistent").unwrap();
    assert!(result.is_none());
}

#[test]
fn get_stock_count_not_found_returns_none() {
    let conn = fresh_conn();
    let store = Store::new(&conn);
    let result = store.get_stock_count("no-such-count").unwrap();
    assert!(result.is_none());
}

// ── Additional edge-case tests (10 new) ────────────────────────

#[test]
fn complete_draft_count_allowed() {
    let conn = fresh_conn();
    let store = Store::new(&conn);
    let count_id = uuid::Uuid::now_v7().to_string();
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    seed_user(&conn, "user-1");
    seed_product(&conn, "SKU-A", "Product A");
    let pid: String = conn
        .query_row("SELECT id FROM products WHERE sku='SKU-A'", [], |r| {
            r.get(0)
        })
        .unwrap();
    seed_inventory(&conn, &pid, 10);

    let count = StockCount {
        id: count_id.clone(),
        count_number: "CNT-DRAFT-COMPLETE".into(),
        status: StockCountStatus::Draft,
        count_type: CountType::Full,
        notes: "".into(),
        counted_by: None,
        created_at: now.clone(),
        completed_at: None,
        updated_at: now.clone(),
    };
    store.create_stock_count(&count).unwrap();

    let line = StockCountLine {
        id: uuid::Uuid::now_v7().to_string(),
        count_id: count_id.clone(),
        sku: "SKU-A".into(),
        product_name: "Product A".into(),
        expected_qty: 10,
        counted_qty: Some(12),
        difference: 2,
        notes: "".into(),
    };
    store.add_count_line(&line).unwrap();

    let adjustments = store
        .complete_stock_count(&count_id, Some("user-1"))
        .unwrap();
    assert_eq!(adjustments.len(), 1);
    assert_eq!(adjustments[0].adjusted_qty, 12);

    let updated = store.get_stock_count(&count_id).unwrap().unwrap();
    assert_eq!(updated.status, StockCountStatus::Completed);
}

#[test]
fn complete_stock_count_skip_zero_difference() {
    let conn = fresh_conn();
    let store = Store::new(&conn);
    let count_id = uuid::Uuid::now_v7().to_string();
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    seed_user(&conn, "user-1");
    seed_product(&conn, "SKU-A", "Product A");
    let pid: String = conn
        .query_row("SELECT id FROM products WHERE sku='SKU-A'", [], |r| {
            r.get(0)
        })
        .unwrap();
    seed_inventory(&conn, &pid, 10);

    let count = StockCount {
        id: count_id.clone(),
        count_number: "CNT-NOCHANGE".into(),
        status: StockCountStatus::InProgress,
        count_type: CountType::Full,
        notes: "".into(),
        counted_by: None,
        created_at: now.clone(),
        completed_at: None,
        updated_at: now.clone(),
    };
    store.create_stock_count(&count).unwrap();

    // counted = expected (10 = 10) → should skip adjustment
    let line = StockCountLine {
        id: uuid::Uuid::now_v7().to_string(),
        count_id: count_id.clone(),
        sku: "SKU-A".into(),
        product_name: "Product A".into(),
        expected_qty: 10,
        counted_qty: Some(10),
        difference: 0,
        notes: "".into(),
    };
    store.add_count_line(&line).unwrap();

    let adjustments = store.complete_stock_count(&count_id, None).unwrap();
    assert!(adjustments.is_empty());
}

#[test]
fn complete_stock_count_multiple_lines() {
    let conn = fresh_conn();
    let store = Store::new(&conn);
    let count_id = uuid::Uuid::now_v7().to_string();
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    seed_user(&conn, "user-1");
    seed_product(&conn, "SKU-A", "Product A");
    seed_product(&conn, "SKU-B", "Product B");
    let pid_a: String = conn
        .query_row("SELECT id FROM products WHERE sku='SKU-A'", [], |r| {
            r.get(0)
        })
        .unwrap();
    let pid_b: String = conn
        .query_row("SELECT id FROM products WHERE sku='SKU-B'", [], |r| {
            r.get(0)
        })
        .unwrap();
    seed_inventory(&conn, &pid_a, 10);
    seed_inventory(&conn, &pid_b, 20);

    let count = StockCount {
        id: count_id.clone(),
        count_number: "CNT-MULTI".into(),
        status: StockCountStatus::InProgress,
        count_type: CountType::Full,
        notes: "".into(),
        counted_by: None,
        created_at: now.clone(),
        completed_at: None,
        updated_at: now.clone(),
    };
    store.create_stock_count(&count).unwrap();

    store
        .add_count_line(&StockCountLine {
            id: uuid::Uuid::now_v7().to_string(),
            count_id: count_id.clone(),
            sku: "SKU-A".into(),
            product_name: "Product A".into(),
            expected_qty: 10,
            counted_qty: Some(12),
            difference: 2,
            notes: "".into(),
        })
        .unwrap();
    store
        .add_count_line(&StockCountLine {
            id: uuid::Uuid::now_v7().to_string(),
            count_id: count_id.clone(),
            sku: "SKU-B".into(),
            product_name: "Product B".into(),
            expected_qty: 20,
            counted_qty: Some(18),
            difference: -2,
            notes: "".into(),
        })
        .unwrap();

    let adjustments = store
        .complete_stock_count(&count_id, Some("user-1"))
        .unwrap();
    assert_eq!(adjustments.len(), 2);
    assert_eq!(adjustments[0].sku, "SKU-A");
    assert_eq!(adjustments[0].adjusted_qty, 12);
    assert_eq!(adjustments[1].sku, "SKU-B");
    assert_eq!(adjustments[1].adjusted_qty, 18);
}

#[test]
fn complete_stock_count_no_lines() {
    let conn = fresh_conn();
    let store = Store::new(&conn);
    let count_id = uuid::Uuid::now_v7().to_string();
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    let count = StockCount {
        id: count_id.clone(),
        count_number: "CNT-EMPTY".into(),
        status: StockCountStatus::InProgress,
        count_type: CountType::Full,
        notes: "".into(),
        counted_by: None,
        created_at: now.clone(),
        completed_at: None,
        updated_at: now.clone(),
    };
    store.create_stock_count(&count).unwrap();

    // Completing a count with no lines (or all zero-diff) should
    // still mark it as completed.
    let adjustments = store.complete_stock_count(&count_id, None).unwrap();
    assert!(adjustments.is_empty());

    let updated = store.get_stock_count(&count_id).unwrap().unwrap();
    assert_eq!(updated.status, StockCountStatus::Completed);
}

#[test]
fn complete_nonexistent_count_returns_not_found() {
    let conn = fresh_conn();
    let store = Store::new(&conn);
    let err = store
        .complete_stock_count("no-such-count", None)
        .unwrap_err();
    assert!(matches!(err, CoreError::NotFound { entity, .. } if entity == "stock_count"));
}

#[test]
fn update_stock_count_modifies_fields() {
    let conn = fresh_conn();
    let store = Store::new(&conn);
    let count_id = uuid::Uuid::now_v7().to_string();
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    seed_user(&conn, "user-2");

    let count = StockCount {
        id: count_id.clone(),
        count_number: "CNT-UPDATE-FIELDS".into(),
        status: StockCountStatus::Draft,
        count_type: CountType::Full,
        notes: "Original".into(),
        counted_by: None,
        created_at: now.clone(),
        completed_at: None,
        updated_at: now.clone(),
    };
    store.create_stock_count(&count).unwrap();

    let updated = StockCount {
        id: count_id.clone(),
        count_number: "CNT-UPDATE-FIELDS".into(),
        status: StockCountStatus::InProgress,
        count_type: CountType::Spot,
        notes: "Modified".into(),
        counted_by: Some("user-2".into()),
        created_at: now.clone(),
        completed_at: Some("2025-06-01T00:00:00.000Z".into()),
        updated_at: "2025-06-01T00:00:00.001Z".into(),
    };
    store.update_stock_count(&updated).unwrap();

    let fetched = store.get_stock_count(&count_id).unwrap().unwrap();
    assert_eq!(fetched.status, StockCountStatus::InProgress);
    assert_eq!(fetched.count_type, CountType::Spot);
    assert_eq!(fetched.notes, "Modified");
    assert_eq!(fetched.counted_by, Some("user-2".to_owned()));
    assert!(fetched.completed_at.is_some());
}

#[test]
fn remove_nonexistent_line_is_noop() {
    let conn = fresh_conn();
    let store = Store::new(&conn);
    store.remove_count_line("no-such-line").unwrap();
}

#[test]
fn get_count_lines_empty() {
    let conn = fresh_conn();
    let store = Store::new(&conn);
    let lines = store.get_count_lines("no-such-count").unwrap();
    assert!(lines.is_empty());
}

#[test]
fn list_stock_adjustments_ordered() {
    let conn = fresh_conn();
    let store = Store::new(&conn);
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    seed_user(&conn, "user-1");
    seed_product(&conn, "SKU-A", "Product A");
    seed_product(&conn, "SKU-B", "Product B");
    let pid_a: String = conn
        .query_row("SELECT id FROM products WHERE sku='SKU-A'", [], |r| {
            r.get(0)
        })
        .unwrap();
    let pid_b: String = conn
        .query_row("SELECT id FROM products WHERE sku='SKU-B'", [], |r| {
            r.get(0)
        })
        .unwrap();
    seed_inventory(&conn, &pid_a, 10);
    seed_inventory(&conn, &pid_b, 10);

    // Two counts on different products to produce 2 adjustments
    let pairs = [("SKU-A", 10, 12), ("SKU-B", 10, 8)];
    for (i, (sku, _expected, counted)) in pairs.iter().enumerate() {
        let cid = uuid::Uuid::now_v7().to_string();
        let count = StockCount {
            id: cid.clone(),
            count_number: format!("CNT-ADJ-{}", i),
            status: StockCountStatus::InProgress,
            count_type: CountType::Full,
            notes: "".into(),
            counted_by: None,
            created_at: now.clone(),
            completed_at: None,
            updated_at: now.clone(),
        };
        store.create_stock_count(&count).unwrap();
        store
            .add_count_line(&StockCountLine {
                id: uuid::Uuid::now_v7().to_string(),
                count_id: cid.clone(),
                sku: sku.to_string(),
                product_name: format!("Product {}", sku),
                expected_qty: 10,
                counted_qty: Some(*counted),
                difference: *counted - 10,
                notes: "".into(),
            })
            .unwrap();
        store.complete_stock_count(&cid, None).unwrap();
    }

    let adjustments = store.list_stock_adjustments().unwrap();
    assert_eq!(adjustments.len(), 2);
    // Newest first
    assert!(adjustments[0].created_at >= adjustments[1].created_at);
}

#[test]
fn list_stock_adjustments_empty() {
    let conn = fresh_conn();
    let store = Store::new(&conn);
    let adjustments = store.list_stock_adjustments().unwrap();
    assert!(adjustments.is_empty());
}
