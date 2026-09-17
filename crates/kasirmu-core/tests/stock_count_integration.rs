//! Integration tests for the stock count module — create, add lines,
//! update lines, complete (with adjustments + inventory reconciliation),
//! and listing.
//!
//! Tests exercise the full persistence layer via the public
//! [`kasirmu_core::Store`] API against an in-memory SQLite database.

use kasirmu_core::{CountType, StockCount, StockCountLine, StockCountStatus, Store, migrations};
use rusqlite::Connection;

// ── Helpers ───────────────────────────────────────────────────────────

fn setup() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    conn.pragma_update(None, "journal_mode", "WAL").unwrap();
    migrations::run(&mut conn).unwrap();
    conn
}

fn store(conn: &Connection) -> Store<'_> {
    Store::new(conn)
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn seed_user(conn: &Connection, id: &str) {
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
        rusqlite::params![id, id, id],
    )
    .unwrap();
}

fn seed_product_with_inventory(conn: &Connection, sku: &str, name: &str, qty: i64) -> String {
    let pid = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO products (id, sku, name, price_minor, currency, created_at, updated_at)
         VALUES (?1, ?2, ?3, 1000, 'USD', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
        rusqlite::params![pid, sku, name],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO inventory (product_id, qty, updated_at) VALUES (?1, ?2, '2025-01-01T00:00:00.000Z')",
        rusqlite::params![pid, qty],
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

fn make_count(
    id: &str,
    number: &str,
    status: StockCountStatus,
    count_type: CountType,
) -> StockCount {
    let now = now();
    StockCount {
        id: id.into(),
        count_number: number.into(),
        status,
        count_type,
        notes: "integration test".into(),
        counted_by: None,
        created_at: now.clone(),
        completed_at: None,
        updated_at: now,
    }
}

fn make_line(
    count_id: &str,
    sku: &str,
    name: &str,
    expected: i64,
    counted: Option<i64>,
) -> StockCountLine {
    let diff = counted.map(|value| value - expected).unwrap_or(0);
    StockCountLine {
        id: uuid::Uuid::new_v4().to_string(),
        count_id: count_id.into(),
        sku: sku.into(),
        product_name: name.into(),
        expected_qty: expected,
        counted_qty: counted,
        difference: diff,
        notes: String::new(),
    }
}

// ── Create ────────────────────────────────────────────────────────────

#[test]
fn create_and_fetch_stock_count() {
    let conn = setup();
    let s = store(&conn);
    let id = uuid::Uuid::new_v4().to_string();
    let count = make_count(&id, "CNT-INT-001", StockCountStatus::Draft, CountType::Full);

    s.create_stock_count(&count).unwrap();

    let fetched = s.get_stock_count(&id).unwrap().unwrap();
    assert_eq!(fetched.count_number, "CNT-INT-001");
    assert_eq!(fetched.status, StockCountStatus::Draft);
    assert_eq!(fetched.count_type, CountType::Full);
    assert_eq!(fetched.notes, "integration test");
}

#[test]
fn get_stock_count_not_found() {
    let conn = setup();
    let count = store(&conn).get_stock_count("nope").unwrap();
    assert!(count.is_none());
}

// ── List ──────────────────────────────────────────────────────────────

#[test]
fn list_stock_counts_newest_first() {
    let conn = setup();
    let s = store(&conn);

    // Use explicit timestamps so ORDER BY created_at DESC is deterministic.
    let mut c1 = make_count(
        &uuid::Uuid::new_v4().to_string(),
        "CNT-001",
        StockCountStatus::Draft,
        CountType::Full,
    );
    c1.created_at = "2025-01-01T00:00:00.000Z".into();
    let mut c2 = make_count(
        &uuid::Uuid::new_v4().to_string(),
        "CNT-002",
        StockCountStatus::Completed,
        CountType::Cyclic,
    );
    c2.created_at = "2025-01-02T00:00:00.000Z".into();

    s.create_stock_count(&c1).unwrap();
    s.create_stock_count(&c2).unwrap();

    let list = s.list_stock_counts().unwrap();
    assert_eq!(list.len(), 2);
    // c2.created_at is newer, so newest first means c2 first.
    assert_eq!(list[0].count_number, "CNT-002");
    assert_eq!(list[1].count_number, "CNT-001");
}

#[test]
fn list_stock_counts_mixed_statuses() {
    let conn = setup();
    let s = store(&conn);

    for (i, status) in [
        StockCountStatus::Draft,
        StockCountStatus::InProgress,
        StockCountStatus::Completed,
        StockCountStatus::Cancelled,
    ]
    .into_iter()
    .enumerate()
    {
        let c = make_count(
            &uuid::Uuid::new_v4().to_string(),
            &format!("CNT-STAT-{i}"),
            status,
            CountType::Spot,
        );
        s.create_stock_count(&c).unwrap();
    }

    let list = s.list_stock_counts().unwrap();
    assert_eq!(list.len(), 4);
}

// ── Lines ─────────────────────────────────────────────────────────────

#[test]
fn add_and_get_count_lines() {
    let conn = setup();
    let s = store(&conn);
    let count_id = uuid::Uuid::new_v4().to_string();
    let count = make_count(
        &count_id,
        "CNT-LINES",
        StockCountStatus::Draft,
        CountType::Cyclic,
    );
    s.create_stock_count(&count).unwrap();

    let line = make_line(&count_id, "SKU-001", "Widget", 10, None);
    s.add_count_line(&line).unwrap();

    let lines = s.get_count_lines(&count_id).unwrap();
    assert_eq!(lines.len(), 1);
    assert_eq!(lines[0].sku, "SKU-001");
    assert_eq!(lines[0].expected_qty, 10);
    assert!(lines[0].counted_qty.is_none());
}

#[test]
fn update_count_line_record_count() {
    let conn = setup();
    let s = store(&conn);
    let count_id = uuid::Uuid::new_v4().to_string();
    let count = make_count(
        &count_id,
        "CNT-UPDATE",
        StockCountStatus::InProgress,
        CountType::Spot,
    );
    s.create_stock_count(&count).unwrap();

    let line = make_line(&count_id, "SKU-002", "Gadget", 20, None);
    s.add_count_line(&line).unwrap();

    let updated = StockCountLine {
        id: line.id.clone(),
        count_id: count_id.clone(),
        sku: "SKU-002".into(),
        product_name: "Gadget".into(),
        expected_qty: 20,
        counted_qty: Some(15),
        difference: -5,
        notes: "5 missing".into(),
    };
    s.update_count_line(&updated).unwrap();

    let lines = s.get_count_lines(&count_id).unwrap();
    assert_eq!(lines[0].counted_qty, Some(15));
    assert_eq!(lines[0].difference, -5);
    assert_eq!(lines[0].notes, "5 missing");
}

#[test]
fn remove_count_line() {
    let conn = setup();
    let s = store(&conn);
    let count_id = uuid::Uuid::new_v4().to_string();
    let count = make_count(
        &count_id,
        "CNT-REMOVE",
        StockCountStatus::Draft,
        CountType::Full,
    );
    s.create_stock_count(&count).unwrap();

    let line = make_line(&count_id, "SKU-003", "Thing", 5, Some(5));
    s.add_count_line(&line).unwrap();

    s.remove_count_line(&line.id).unwrap();

    let lines = s.get_count_lines(&count_id).unwrap();
    assert!(lines.is_empty());
}

// ── Complete with adjustments ────────────────────────────────────────

#[test]
fn complete_stock_count_creates_adjustments_and_updates_inventory() {
    let conn = setup();
    seed_user(&conn, "user-1");
    seed_product_with_inventory(&conn, "SKU-COMPLETE", "Completable", 20);
    let s = store(&conn);

    let count_id = uuid::Uuid::new_v4().to_string();
    let count = make_count(
        &count_id,
        "CNT-COMPLETE",
        StockCountStatus::InProgress,
        CountType::Cyclic,
    );
    s.create_stock_count(&count).unwrap();

    // Expected 20, counted 15 (5 missing).
    let line = make_line(&count_id, "SKU-COMPLETE", "Completable", 20, Some(15));
    s.add_count_line(&line).unwrap();

    let adjustments = s.complete_stock_count(&count_id, Some("user-1")).unwrap();
    assert_eq!(adjustments.len(), 1);
    assert_eq!(adjustments[0].sku, "SKU-COMPLETE");
    assert_eq!(adjustments[0].previous_qty, 20);
    assert_eq!(adjustments[0].adjusted_qty, 15);

    // Inventory reconciled: was 20, now 15.
    assert_eq!(get_inventory_qty(&conn, "SKU-COMPLETE"), 15);

    // Count should be completed.
    let updated = s.get_stock_count(&count_id).unwrap().unwrap();
    assert_eq!(updated.status, StockCountStatus::Completed);
    assert!(updated.completed_at.is_some());
}

#[test]
fn complete_count_no_differences_creates_no_adjustments() {
    let conn = setup();
    seed_user(&conn, "user-1");
    seed_product_with_inventory(&conn, "SKU-NODIFF", "No Diff", 10);
    let s = store(&conn);

    let count_id = uuid::Uuid::new_v4().to_string();
    let count = make_count(
        &count_id,
        "CNT-NODIFF",
        StockCountStatus::InProgress,
        CountType::Spot,
    );
    s.create_stock_count(&count).unwrap();

    // Counted matches expected.
    let line = make_line(&count_id, "SKU-NODIFF", "No Diff", 10, Some(10));
    s.add_count_line(&line).unwrap();

    let adjustments = s.complete_stock_count(&count_id, Some("user-1")).unwrap();
    assert!(adjustments.is_empty());
}

#[test]
fn complete_count_not_in_progress_fails() {
    let conn = setup();
    let s = store(&conn);

    let count_id = uuid::Uuid::new_v4().to_string();
    let count = make_count(
        &count_id,
        "CNT-ALREADY",
        StockCountStatus::Completed,
        CountType::Full,
    );
    s.create_stock_count(&count).unwrap();

    let err = s.complete_stock_count(&count_id, None).unwrap_err();
    assert!(matches!(
        err,
        kasirmu_core::CoreError::Validation {
            field: "status",
            ..
        }
    ));
}

#[test]
fn complete_count_with_multiple_products() {
    let conn = setup();
    seed_user(&conn, "user-1");
    seed_product_with_inventory(&conn, "SKU-M1", "Product M1", 50);
    seed_product_with_inventory(&conn, "SKU-M2", "Product M2", 30);
    let s = store(&conn);

    let count_id = uuid::Uuid::new_v4().to_string();
    let count = make_count(
        &count_id,
        "CNT-MULTI",
        StockCountStatus::InProgress,
        CountType::Full,
    );
    s.create_stock_count(&count).unwrap();

    // M1: expected 50, counted 45 (shortage 5).
    s.add_count_line(&make_line(&count_id, "SKU-M1", "Product M1", 50, Some(45)))
        .unwrap();
    // M2: expected 30, counted 35 (overage 5).
    s.add_count_line(&make_line(&count_id, "SKU-M2", "Product M2", 30, Some(35)))
        .unwrap();

    let adjustments = s.complete_stock_count(&count_id, Some("user-1")).unwrap();
    assert_eq!(adjustments.len(), 2);

    assert_eq!(get_inventory_qty(&conn, "SKU-M1"), 45);
    assert_eq!(get_inventory_qty(&conn, "SKU-M2"), 35);
}

// ── Adjustments listing ──────────────────────────────────────────────

#[test]
fn list_stock_adjustments_after_completion() {
    let conn = setup();
    seed_user(&conn, "user-1");
    seed_product_with_inventory(&conn, "SKU-ADJ", "Adjustable", 100);
    let s = store(&conn);

    let count_id = uuid::Uuid::new_v4().to_string();
    let count = make_count(
        &count_id,
        "CNT-ADJ",
        StockCountStatus::InProgress,
        CountType::Cyclic,
    );
    s.create_stock_count(&count).unwrap();

    s.add_count_line(&make_line(
        &count_id,
        "SKU-ADJ",
        "Adjustable",
        100,
        Some(90),
    ))
    .unwrap();

    s.complete_stock_count(&count_id, Some("user-1")).unwrap();

    let adjustments = s.list_stock_adjustments().unwrap();
    assert_eq!(adjustments.len(), 1);
    assert_eq!(adjustments[0].sku, "SKU-ADJ");
    assert_eq!(adjustments[0].count_id.as_deref(), Some(count_id.as_str()));
}

// ── Next count number ────────────────────────────────────────────────

#[test]
fn next_count_number_generates_unique_sequential() {
    let conn = setup();
    let s = store(&conn);

    let n1 = s.next_count_number().unwrap();
    assert!(n1.starts_with("CNT-"));
    assert!(n1.contains(&chrono::Utc::now().format("%Y%m%d").to_string()));

    let count = make_count(
        &uuid::Uuid::new_v4().to_string(),
        &n1,
        StockCountStatus::Draft,
        CountType::Full,
    );
    s.create_stock_count(&count).unwrap();

    let n2 = s.next_count_number().unwrap();
    assert_ne!(n1, n2);
    assert!(n2 > n1);
}

#[test]
fn empty_adjustments_list() {
    let conn = setup();
    let adjustments = store(&conn).list_stock_adjustments().unwrap();
    assert!(adjustments.is_empty());
}
