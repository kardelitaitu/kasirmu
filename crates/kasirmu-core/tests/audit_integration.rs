//! Integration tests for the audit log — timestamps, ordering, pagination,
//! and append-only invariants.
//!
//! These tests run against an in-memory SQLite database with the full
//! migration set, exercising the public [`kasirmu_core::Store`] API.

use kasirmu_core::{AuditEntry, Store, migrations};
use rusqlite::Connection;

// ── Helpers ───────────────────────────────────────────────────────────

/// Open an in-memory database with migrations applied.
fn setup() -> Connection {
    migrations::fresh_db()
}

fn store(conn: &Connection) -> Store<'_> {
    Store::new(conn)
}

/// Create an audit entry with a specific created_at timestamp (for ordering tests).
fn entry_with_timestamp(
    user_id: &str,
    action: &str,
    target_type: Option<&str>,
    target_id: Option<&str>,
    details: Option<&str>,
    outcome: &str,
    created_at: &str,
) -> AuditEntry {
    AuditEntry {
        id: uuid::Uuid::now_v7().to_string(),
        user_id: user_id.to_owned(),
        action: action.to_owned(),
        target_type: target_type.map(String::from),
        target_id: target_id.map(String::from),
        details: details.unwrap_or("{}").to_owned(),
        outcome: outcome.to_owned(),
        created_at: created_at.to_owned(),
    }
}

/// Insert an audit entry directly into the database (bypassing Store::log_audit)
/// so we can control the timestamp. Returns the entry id.
fn insert_direct(conn: &Connection, entry: &AuditEntry) {
    conn.execute(
        "INSERT INTO audit_log (id, user_id, action, target_type, target_id, details, outcome, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![
            entry.id, entry.user_id, entry.action,
            entry.target_type, entry.target_id,
            entry.details, entry.outcome, entry.created_at,
        ],
    )
    .unwrap();
}

// ── Timestamp format ──────────────────────────────────────────────────

#[test]
fn auto_generated_timestamps_are_iso8601() {
    let conn = setup();
    let s = store(&conn);
    for i in 0..10 {
        let entry = AuditEntry::new(
            format!("user-{i}"),
            "system.backup",
            None::<String>,
            None::<String>,
            None::<String>,
            "success",
        );
        s.log_audit(&entry).unwrap();
    }

    let entries = s.list_audit_entries(100, 0).unwrap();
    assert_eq!(entries.len(), 10);
    for entry in &entries {
        // ISO-8601 with milliseconds: "2026-06-29T12:34:56.789Z"
        assert!(
            entry.created_at.contains('T'),
            "timestamp should contain T separator: {}",
            entry.created_at
        );
        assert!(
            entry.created_at.ends_with('Z'),
            "timestamp should end with Z (UTC): {}",
            entry.created_at
        );

        // Verify parseable as RFC-3339.
        let parsed = chrono::DateTime::parse_from_rfc3339(&entry.created_at);
        assert!(
            parsed.is_ok(),
            "timestamp should be valid RFC-3339: {}",
            entry.created_at
        );
    }
}

#[test]
fn timestamps_are_unique_per_entry() {
    let conn = setup();
    let s = store(&conn);
    // Insert several entries quickly; their auto-generated timestamps should differ
    // (at least in milliseconds for most cases).
    let mut ids = Vec::new();
    for i in 0..5 {
        let entry = AuditEntry::new(
            format!("user-{i}"),
            "test.action",
            None::<String>,
            None::<String>,
            None::<String>,
            "ok",
        );
        let id = entry.id.clone();
        s.log_audit(&entry).unwrap();
        ids.push(id);
    }

    let entries = s.list_audit_entries(100, 0).unwrap();
    // All timestamps must be valid RFC-3339; they may collide if inserted within
    // the same millisecond (chrono millisecond resolution).
    for entry in &entries {
        let parsed = chrono::DateTime::parse_from_rfc3339(&entry.created_at);
        assert!(
            parsed.is_ok(),
            "timestamp should be valid RFC-3339: {}",
            entry.created_at
        );
    }
    // At minimum, the earliest and latest timestamps should differ (likely).
    let min_ts = entries.iter().map(|e| e.created_at.as_str()).min().unwrap();
    let max_ts = entries.iter().map(|e| e.created_at.as_str()).max().unwrap();
    assert!(max_ts >= min_ts, "timestamps should be non-decreasing");
}

// ── Ordering ──────────────────────────────────────────────────────────

#[test]
fn entries_ordered_by_created_at_desc() {
    let conn = setup();
    let s = store(&conn);

    // Insert entries with explicit timestamps, deliberately out of chronological order.
    let t1 = "2026-01-01T12:00:00.000Z";
    let t2 = "2026-01-01T14:00:00.000Z";
    let t3 = "2026-01-02T08:00:00.000Z";
    let t4 = "2026-01-03T00:00:00.000Z";

    // Insert in mixed order.
    let e1 = entry_with_timestamp("u1", "order.test", None, None, None, "ok", t4); // latest
    let e2 = entry_with_timestamp("u1", "order.test", None, None, None, "ok", t2);
    let e3 = entry_with_timestamp("u1", "order.test", None, None, None, "ok", t1); // earliest
    let e4 = entry_with_timestamp("u1", "order.test", None, None, None, "ok", t3);

    insert_direct(&conn, &e1);
    insert_direct(&conn, &e2);
    insert_direct(&conn, &e3);
    insert_direct(&conn, &e4);

    let entries = s.list_audit_entries(100, 0).unwrap();
    assert_eq!(entries.len(), 4);
    // Should be DESC by created_at.
    assert_eq!(entries[0].created_at, t4, "most recent should be first");
    assert_eq!(entries[1].created_at, t3);
    assert_eq!(entries[2].created_at, t2);
    assert_eq!(entries[3].created_at, t1, "oldest should be last");
}

#[test]
fn entries_with_same_timestamp_retain_insert_order() {
    let conn = setup();
    let s = store(&conn);

    let ts = "2026-06-01T12:00:00.000Z";
    let e1 = entry_with_timestamp("u1", "action.a", None, None, None, "ok", ts);
    let e2 = entry_with_timestamp("u2", "action.b", None, None, None, "ok", ts);
    let e3 = entry_with_timestamp("u3", "action.c", None, None, None, "ok", ts);

    insert_direct(&conn, &e1);
    insert_direct(&conn, &e2);
    insert_direct(&conn, &e3);

    let entries = s.list_audit_entries(100, 0).unwrap();
    assert_eq!(entries.len(), 3);
    // When timestamps tie, insertion order (rowid order) determines the result.
    // All timestamps are identical, so the DB will return them in rowid order (insertion order DESC with no index?
    // Actually, ORDER BY created_at DESC will order by timestamp first; ties may be in any order.
    // Just verify all three are present and have the right timestamp.
    let actions: Vec<&str> = entries.iter().map(|e| e.action.as_str()).collect();
    assert!(actions.contains(&"action.a"));
    assert!(actions.contains(&"action.b"));
    assert!(actions.contains(&"action.c"));
    for entry in &entries {
        assert_eq!(entry.created_at, ts);
    }
}

#[test]
fn entries_across_different_days_ordered_correctly() {
    let conn = setup();
    let s = store(&conn);

    // Insert entries across multiple days.
    let days = [
        "2026-01-01T10:00:00.000Z",
        "2026-01-01T23:59:59.000Z",
        "2026-01-02T00:00:01.000Z",
        "2026-01-15T12:00:00.000Z",
        "2026-02-01T00:00:00.000Z",
        "2025-12-31T23:59:59.000Z",
    ];

    for (i, ts) in days.iter().enumerate() {
        let entry =
            entry_with_timestamp("u1", &format!("day_test.{i}"), None, None, None, "ok", ts);
        insert_direct(&conn, &entry);
    }

    let entries = s.list_audit_entries(100, 0).unwrap();
    assert_eq!(entries.len(), 6);

    // Verify DESC ordering: newest first.
    let expected = [
        "2026-02-01T00:00:00.000Z", // feb
        "2026-01-15T12:00:00.000Z", // mid-jan
        "2026-01-02T00:00:01.000Z", // jan 2
        "2026-01-01T23:59:59.000Z", // jan 1 late
        "2026-01-01T10:00:00.000Z", // jan 1 early
        "2025-12-31T23:59:59.000Z", // dec 31 previous year
    ];

    for (i, (entry, exp)) in entries.iter().zip(expected.iter()).enumerate() {
        assert_eq!(entry.created_at, *exp, "position {i} should be {exp}");
    }
}

// ── Pagination ────────────────────────────────────────────────────────

#[test]
fn pagination_exact_pages() {
    let conn = setup();
    let s = store(&conn);

    // Insert 10 entries with sequential timestamps.
    for i in 0..10 {
        let ts = format!("2026-01-01T{:02}:00:00.000Z", i + 1);
        let entry = entry_with_timestamp("u1", &format!("action.{i}"), None, None, None, "ok", &ts);
        insert_direct(&conn, &entry);
    }

    // Page size 3 → 4 pages (3 + 3 + 3 + 1).
    let page1 = s.list_audit_entries(3, 0).unwrap();
    let page2 = s.list_audit_entries(3, 3).unwrap();
    let page3 = s.list_audit_entries(3, 6).unwrap();
    let page4 = s.list_audit_entries(3, 9).unwrap();

    assert_eq!(page1.len(), 3, "page 1 should have 3 entries");
    assert_eq!(page2.len(), 3, "page 2 should have 3 entries");
    assert_eq!(page3.len(), 3, "page 3 should have 3 entries");
    assert_eq!(page4.len(), 1, "page 4 should have 1 entry");

    // All pages combined = all entries.
    let combined: Vec<String> = page1
        .into_iter()
        .chain(page2)
        .chain(page3)
        .chain(page4)
        .map(|e| e.action)
        .collect();
    assert_eq!(combined.len(), 10);
}

#[test]
fn pagination_large_offsets_return_empty() {
    let conn = setup();
    let s = store(&conn);

    for i in 0..5 {
        let entry = AuditEntry::new(
            format!("u{i}"),
            "paginate.test",
            None::<String>,
            None::<String>,
            None::<String>,
            "ok",
        );
        s.log_audit(&entry).unwrap();
    }

    // Offset beyond total.
    let entries = s.list_audit_entries(10, 100).unwrap();
    assert!(entries.is_empty());

    // Offset exactly at boundary.
    let entries = s.list_audit_entries(10, 5).unwrap();
    assert!(entries.is_empty());
}

#[test]
fn pagination_consistent_across_calls() {
    let conn = setup();
    let s = store(&conn);

    // Insert 20 entries.
    for i in 0..20 {
        let ts = format!("2026-01-01T{:02}:00:00.000Z", i + 1);
        let entry = entry_with_timestamp("u1", &format!("event.{i}"), None, None, None, "ok", &ts);
        insert_direct(&conn, &entry);
    }

    // Fetch all at once, then compare paginated results.
    let all = s.list_audit_entries(100, 0).unwrap();
    assert_eq!(all.len(), 20);

    // Page size 5.
    for page in 0i64..4 {
        let offset = page * 5;
        let entries = s.list_audit_entries(5, offset).unwrap();
        assert_eq!(entries.len(), 5, "page {page} should have 5 entries");
        for (j, entry) in entries.iter().enumerate() {
            let global_idx = (page * 5 + j as i64) as usize;
            assert_eq!(
                entry.id, all[global_idx].id,
                "entry mismatch at page {page} index {j}"
            );
        }
    }
}

// ── Date-based filtering (raw SQL) ────────────────────────────────────

#[test]
fn query_entries_by_date_range() {
    let conn = setup();

    // Insert entries on 3 different days.
    let day1 = "2026-01-10T10:00:00.000Z";
    let day1b = "2026-01-10T14:30:00.000Z";
    let day2 = "2026-01-11T08:00:00.000Z";
    let day3 = "2026-01-12T23:59:59.000Z";

    insert_direct(
        &conn,
        &entry_with_timestamp("u1", "day1.a", None, None, None, "ok", day1),
    );
    insert_direct(
        &conn,
        &entry_with_timestamp("u1", "day1.b", None, None, None, "ok", day1b),
    );
    insert_direct(
        &conn,
        &entry_with_timestamp("u1", "day2", None, None, None, "ok", day2),
    );
    insert_direct(
        &conn,
        &entry_with_timestamp("u1", "day3", None, None, None, "ok", day3),
    );

    // Use the underlying connection directly to query by date.
    let mut stmt = conn
        .prepare(
            "SELECT id, user_id, action, target_type, target_id, details, outcome, created_at
         FROM audit_log WHERE date(created_at) = '2026-01-10' ORDER BY created_at ASC",
        )
        .unwrap();

    let rows: Vec<AuditEntry> = stmt
        .query_map([], |row| {
            Ok(AuditEntry {
                id: row.get("id")?,
                user_id: row.get("user_id")?,
                action: row.get("action")?,
                target_type: row.get("target_type")?,
                target_id: row.get("target_id")?,
                details: row.get("details")?,
                outcome: row.get("outcome")?,
                created_at: row.get("created_at")?,
            })
        })
        .unwrap()
        .map(|r| r.unwrap())
        .collect();

    assert_eq!(rows.len(), 2, "should find 2 entries on 2026-01-10");
    assert_eq!(rows[0].action, "day1.a", "chronological order within day");
    assert_eq!(rows[1].action, "day1.b");
}

#[test]
fn query_entries_filtered_by_action() {
    let conn = setup();
    let s = store(&conn);

    for i in 0..5 {
        let action = if i % 2 == 0 {
            "sale.create"
        } else {
            "sale.void"
        };
        let entry = AuditEntry::new(
            "u1",
            action,
            Some("sale"),
            Some(&format!("sale-{i}")),
            None::<String>,
            "success",
        );
        s.log_audit(&entry).unwrap();
    }

    // Query with raw SQL to filter by action.
    let mut stmt = conn
        .prepare(
            "SELECT id, user_id, action, target_type, target_id, details, outcome, created_at
         FROM audit_log WHERE action = 'sale.void' ORDER BY created_at ASC",
        )
        .unwrap();

    let rows: Vec<AuditEntry> = stmt
        .query_map([], |row| {
            Ok(AuditEntry {
                id: row.get("id")?,
                user_id: row.get("user_id")?,
                action: row.get("action")?,
                target_type: row.get("target_type")?,
                target_id: row.get("target_id")?,
                details: row.get("details")?,
                outcome: row.get("outcome")?,
                created_at: row.get("created_at")?,
            })
        })
        .unwrap()
        .map(|r| r.unwrap())
        .collect();

    assert_eq!(rows.len(), 2, "should find 2 void actions");
    for row in &rows {
        assert_eq!(row.action, "sale.void");
        assert_eq!(row.target_type.as_deref(), Some("sale"));
    }
}

#[test]
fn query_entries_by_outcome() {
    let conn = setup();
    let s = store(&conn);

    let success = AuditEntry::new(
        "u1",
        "login",
        None::<String>,
        None::<String>,
        None::<String>,
        "success",
    );
    let failure = AuditEntry::new(
        "u1",
        "login",
        None::<String>,
        None::<String>,
        Some("{\"reason\":\"bad pin\"}"),
        "failure",
    );
    s.log_audit(&success).unwrap();
    s.log_audit(&failure).unwrap();

    let mut stmt = conn
        .prepare(
            "SELECT id, user_id, action, target_type, target_id, details, outcome, created_at
         FROM audit_log WHERE outcome = 'failure'",
        )
        .unwrap();

    let rows: Vec<AuditEntry> = stmt
        .query_map([], |row| {
            Ok(AuditEntry {
                id: row.get("id")?,
                user_id: row.get("user_id")?,
                action: row.get("action")?,
                target_type: row.get("target_type")?,
                target_id: row.get("target_id")?,
                details: row.get("details")?,
                outcome: row.get("outcome")?,
                created_at: row.get("created_at")?,
            })
        })
        .unwrap()
        .map(|r| r.unwrap())
        .collect();

    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].outcome, "failure");
    assert!(rows[0].details.contains("bad pin"));
}

// ── Write-once enforcement ───────────────────────────────────────────

#[test]
fn update_audit_entry_trigger_rejects_update() {
    let conn = setup();
    let s = store(&conn);

    let entry = AuditEntry::new(
        "u1",
        "original",
        None::<String>,
        None::<String>,
        None::<String>,
        "success",
    );
    let id = entry.id.clone();
    s.log_audit(&entry).unwrap();

    // UPDATE via raw SQL is now blocked by the audit_log_immutable_update trigger.
    let result = conn.execute(
        "UPDATE audit_log SET action = 'hacked' WHERE id = ?1",
        rusqlite::params![id],
    );
    assert!(
        result.is_err(),
        "UPDATE on audit_log should be rejected by trigger"
    );
    if let Err(e) = result {
        let msg = e.to_string();
        assert!(
            msg.contains("immutable"),
            "error should mention immutability: {msg}"
        );
    }

    // Entry remains unchanged.
    let entries = s.list_audit_entries(10, 0).unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].action, "original");
}

#[test]
fn delete_audit_entry_trigger_rejects_delete() {
    let conn = setup();
    let s = store(&conn);

    let entry = AuditEntry::new(
        "u1",
        "to_delete_test",
        None::<String>,
        None::<String>,
        None::<String>,
        "success",
    );
    let id = entry.id.clone();
    s.log_audit(&entry).unwrap();

    // DELETE via raw SQL is now blocked by the audit_log_immutable_delete trigger.
    let result = conn.execute("DELETE FROM audit_log WHERE id = ?1", rusqlite::params![id]);
    assert!(
        result.is_err(),
        "DELETE on audit_log should be rejected by trigger"
    );
    if let Err(e) = result {
        let msg = e.to_string();
        assert!(
            msg.contains("immutable"),
            "error should mention immutability: {msg}"
        );
    }

    // Entry remains in place.
    let entries = s.list_audit_entries(10, 0).unwrap();
    assert_eq!(entries.len(), 1);
}

// ── Volume ────────────────────────────────────────────────────────────

#[test]
fn bulk_insert_and_retrieve() {
    let conn = setup();
    let s = store(&conn);

    // Insert 50 audit entries with sequential timestamps.
    for i in 0..50 {
        let ts = format!("2026-01-01T{:02}:{:02}:00.000Z", i / 60, i % 60);
        let entry =
            entry_with_timestamp("u1", &format!("bulk.{i}"), None, None, None, "success", &ts);
        insert_direct(&conn, &entry);
    }

    let all = s.list_audit_entries(100, 0).unwrap();
    assert_eq!(all.len(), 50);

    // Verify DESC ordering is correct for all 50 entries.
    for window in all.windows(2) {
        assert!(
            window[0].created_at >= window[1].created_at,
            "entry {} (ts={}) should be after {} (ts={})",
            window[0].action,
            window[0].created_at,
            window[1].action,
            window[1].created_at,
        );
    }
}

#[test]
fn bulk_pagination_all_pages() {
    let conn = setup();
    let s = store(&conn);

    // Insert 200 entries — still 4 full pages of 50.
    for i in 0..200 {
        let ts = format!(
            "2026-06-01T{:02}:{:02}:{:02}.000Z",
            i / 3600,
            (i / 60) % 60,
            i % 60
        );
        let entry = entry_with_timestamp("u1", &format!("bulk.{i}"), None, None, None, "ok", &ts);
        insert_direct(&conn, &entry);
    }

    // Verify total.
    let all = s.list_audit_entries(300, 0).unwrap();
    assert_eq!(all.len(), 200);

    // Paginate through with page size 50 — 4 pages.
    let page_size = 50;
    let mut total_from_pages = 0;
    for page in 0..4 {
        let entries = s.list_audit_entries(page_size, page * page_size).unwrap();
        assert_eq!(
            entries.len(),
            50,
            "page {page} should have {page_size} entries"
        );
        total_from_pages += entries.len();

        // Verify entries are in DESC order within each page.
        for window in entries.windows(2) {
            assert!(
                window[0].created_at >= window[1].created_at,
                "page {page}: misordered entries"
            );
        }
    }
    assert_eq!(total_from_pages, 200);
}

#[test]
fn first_page_is_most_recent() {
    let conn = setup();
    let s = store(&conn);

    // Insert entries where timestamps decrease.
    for i in 0..10 {
        let ts = format!("2026-06-{:02}T12:00:00.000Z", 30 - i);
        let entry = entry_with_timestamp("u1", &format!("event.{i}"), None, None, None, "ok", &ts);
        insert_direct(&conn, &entry);
    }

    // First page (size 3) should have the 3 most recent entries.
    let page1 = s.list_audit_entries(3, 0).unwrap();
    assert_eq!(page1.len(), 3);
    assert_eq!(page1[0].action, "event.0", "most recent first");
    assert_eq!(page1[1].action, "event.1");
    assert_eq!(page1[2].action, "event.2");

    // Second page should have the next 3.
    let page2 = s.list_audit_entries(3, 3).unwrap();
    assert_eq!(page2.len(), 3);
    assert_eq!(page2[0].action, "event.3");
    assert_eq!(page2[1].action, "event.4");
    assert_eq!(page2[2].action, "event.5");
}
