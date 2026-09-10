use super::*;
use crate::migrations;
use rusqlite::Connection;

fn fresh() -> Connection {
    migrations::fresh_db()
}

fn store(conn: &Connection) -> Store<'_> {
    Store::new(conn)
}

fn seed_audit_entries(conn: &Connection) {
    conn.execute_batch(
        "INSERT INTO audit_log (id, user_id, action, target_type, target_id, details, outcome, created_at) VALUES
            ('aud-1', 'user-1', 'sale.create',  'sale', 'sale-1', '{\"total\":1000}', 'success', '2025-01-01T12:00:00.000Z'),
            ('aud-2', 'user-2', 'sale.void',    'sale', 'sale-2', '{\"reason\":\"test\"}', 'success', '2025-01-01T12:05:00.000Z'),
            ('aud-3', 'user-1', 'product.create','product','prod-1','{}','success','2025-01-01T13:00:00.000Z'),
            ('aud-4', 'system', 'user.login',   'user',  'user-1', '{}', 'failure', '2025-01-01T14:00:00.000Z');"
    ).unwrap();
}

// ── log_audit ───────────────────────────────────────────────────

#[test]
fn log_audit_persists_entry() {
    let conn = fresh();
    let s = store(&conn);
    let entry = AuditEntry::new(
        "user-1",
        "sale.create",
        Some("sale".to_string()),
        Some("sale-99".to_string()),
        Some("{\"total\":500}".to_string()),
        "success",
    );
    s.log_audit(&entry).unwrap();

    let entries = s.list_audit_entries(10, 0).unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].action, "sale.create");
    assert_eq!(entries[0].user_id, "user-1");
    assert_eq!(entries[0].target_id.as_deref(), Some("sale-99"));
    assert_eq!(entries[0].outcome, "success");
}

#[test]
fn log_audit_nullable_types() {
    let conn = fresh();
    let s = store(&conn);
    let entry = AuditEntry::new(
        "user-1",
        "test.event",
        None::<String>,
        None::<String>,
        None::<String>,
        "info",
    );
    s.log_audit(&entry).unwrap();

    let entries = s.list_audit_entries(10, 0).unwrap();
    assert_eq!(entries.len(), 1);
    assert!(entries[0].target_type.is_none());
    assert!(entries[0].target_id.is_none());
    assert_eq!(entries[0].details, "{}");
}

#[test]
fn log_audit_multiple_entries() {
    let conn = fresh();
    let s = store(&conn);
    for i in 0..5 {
        let entry = AuditEntry::new(
            "user-1",
            format!("event.{i}"),
            None::<String>,
            None::<String>,
            None::<String>,
            "ok",
        );
        s.log_audit(&entry).unwrap();
    }
    let entries = s.list_audit_entries(10, 0).unwrap();
    assert_eq!(entries.len(), 5);
}

// ── list_audit_entries ──────────────────────────────────────────

#[test]
fn list_audit_entries_empty_db() {
    let conn = fresh();
    let entries = store(&conn).list_audit_entries(10, 0).unwrap();
    assert!(entries.is_empty());
}

#[test]
fn list_audit_entries_returns_all() {
    let conn = fresh();
    seed_audit_entries(&conn);
    let entries = store(&conn).list_audit_entries(10, 0).unwrap();
    assert_eq!(entries.len(), 4);
}

#[test]
fn list_audit_entries_ordered_desc() {
    let conn = fresh();
    seed_audit_entries(&conn);
    let entries = store(&conn).list_audit_entries(10, 0).unwrap();
    // Most recent first.
    assert_eq!(entries[0].id, "aud-4");
    assert_eq!(entries[1].id, "aud-3");
    assert_eq!(entries[2].id, "aud-2");
    assert_eq!(entries[3].id, "aud-1");
}

#[test]
fn list_audit_entries_respects_limit() {
    let conn = fresh();
    seed_audit_entries(&conn);
    let entries = store(&conn).list_audit_entries(2, 0).unwrap();
    assert_eq!(entries.len(), 2);
}

#[test]
fn list_audit_entries_pagination() {
    let conn = fresh();
    seed_audit_entries(&conn);
    let page1 = store(&conn).list_audit_entries(2, 0).unwrap();
    let page2 = store(&conn).list_audit_entries(2, 2).unwrap();
    assert_eq!(page1.len(), 2);
    assert_eq!(page2.len(), 2);
    assert_ne!(page1[0].id, page2[0].id);
    // Combined should cover all 4.
}

#[test]
fn list_audit_entries_large_offset() {
    let conn = fresh();
    seed_audit_entries(&conn);
    let entries = store(&conn).list_audit_entries(10, 100).unwrap();
    assert!(entries.is_empty());
}

#[test]
fn list_audit_entries_includes_null_details() {
    let conn = fresh();
    seed_audit_entries(&conn);
    let entries = store(&conn).list_audit_entries(10, 0).unwrap();
    let login_entry = entries.iter().find(|e| e.action == "user.login").unwrap();
    assert_eq!(login_entry.outcome, "failure");
    assert_eq!(login_entry.details, "{}");
}

#[test]
fn audit_log_with_large_details() {
    let conn = fresh();
    let s = store(&conn);

    let large_details = format!(
        "{{\"payload\":\"{}\",\"metadata\":{{\"count\":{}}}}}",
        "x".repeat(2000),
        42
    );
    assert!(large_details.len() > 2000);

    let entry = AuditEntry::new(
        "user-1",
        "bulk.import",
        Some("product".to_string()),
        Some("batch-99".to_string()),
        Some(large_details.clone()),
        "success",
    );
    s.log_audit(&entry).unwrap();

    let entries = s.list_audit_entries(10, 0).unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].details, large_details);
}

#[test]
fn audit_log_multiple_same_action() {
    let conn = fresh();
    let s = store(&conn);

    for i in 0..3 {
        let entry = AuditEntry::new(
            "user-1",
            "inventory.sync",
            Some("inventory".to_string()),
            Some(format!("item-{i}")),
            Some(format!("{{\"qty\":{i}}}")),
            "ok",
        );
        s.log_audit(&entry).unwrap();
    }

    let entries = s.list_audit_entries(10, 0).unwrap();
    assert_eq!(entries.len(), 3);
    // All should have the same action.
    assert!(entries.iter().all(|e| e.action == "inventory.sync"));
    // Should be in reverse chronological order (most recent first).
    assert_eq!(entries[0].target_id.as_deref(), Some("item-2"));
    assert_eq!(entries[1].target_id.as_deref(), Some("item-1"));
    assert_eq!(entries[2].target_id.as_deref(), Some("item-0"));
}

#[test]
fn audit_log_limit_zero_returns_empty() {
    let conn = fresh();
    seed_audit_entries(&conn);
    let entries = store(&conn).list_audit_entries(0, 0).unwrap();
    assert!(entries.is_empty());
}

#[test]
fn audit_log_exact_limit_matches_total() {
    let conn = fresh();
    seed_audit_entries(&conn);
    let entries = store(&conn).list_audit_entries(4, 0).unwrap();
    assert_eq!(entries.len(), 4);
    assert_eq!(entries[0].id, "aud-4");
}

#[test]
fn audit_log_very_long_action_name() {
    let conn = fresh();
    let s = store(&conn);

    let long_action = "custom.event.".to_owned() + &"x".repeat(180);
    // "custom.event." = 13 chars, + 180 = 193
    assert_eq!(long_action.len(), 193);

    let entry = AuditEntry::new(
        "admin",
        &long_action,
        Some("test".to_string()),
        None::<String>,
        None::<String>,
        "info",
    );
    s.log_audit(&entry).unwrap();

    let entries = s.list_audit_entries(10, 0).unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].action.len(), 193);
}

/// ── Additional edge cases (ADR-8 PCI-DSS §10) ───────────────────

#[test]
fn audit_log_duplicate_id_rejected() {
    let conn = fresh();
    let s = store(&conn);

    let entry = AuditEntry::new(
        "user-1",
        "test.dup",
        Some("x".to_string()),
        None::<String>,
        None::<String>,
        "success",
    );
    s.log_audit(&entry).unwrap();

    // Attempt to insert a second entry with the same ID via raw SQL
    let result = conn.execute(
        "INSERT INTO audit_log (id, user_id, action, target_type, target_id, details, outcome, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![
            &entry.id, "user-1", "test.dup", "x", std::option::Option::<&str>::None,
            "{}", "success", &entry.created_at,
        ],
    );
    assert!(
        result.is_err(),
        "duplicate PK should produce SQLITE_CONSTRAINT"
    );
    let err = result.unwrap_err();
    assert!(
        err.to_string().contains("UNIQUE") || err.to_string().contains("constraint"),
        "expected constraint error, got: {err}"
    );

    // Verify only one entry exists
    let entries = s.list_audit_entries(10, 0).unwrap();
    assert_eq!(entries.len(), 1);
}

#[test]
fn audit_log_html_in_details_preserved() {
    let conn = fresh();
    let s = store(&conn);

    // HTML strings should be stored as-is (no sanitization at the DB layer)
    let html_details = r#"{"message":"<script>alert('xss')</script>","input":"<b>bold</b>"}"#;
    let entry = AuditEntry::new(
        "admin",
        "form.submit",
        Some("form".to_string()),
        Some("form-1".to_string()),
        Some(html_details.to_string()),
        "failure",
    );
    s.log_audit(&entry).unwrap();

    let entries = s.list_audit_entries(10, 0).unwrap();
    assert_eq!(entries.len(), 1);
    assert!(
        entries[0].details.contains("<script>"),
        "HTML in details should be stored as-is"
    );
    assert!(entries[0].details.contains("<b>bold</b>"));
}

#[test]
fn audit_log_unicode_in_details() {
    let conn = fresh();
    let s = store(&conn);

    let unicode_details = r#"{"message":"Selamat pagi 🌏","emoji":"✅🚀","cjk":"你好世界"}"#;
    let entry = AuditEntry::new(
        "user-1",
        "i18n.test",
        None::<String>,
        None::<String>,
        Some(unicode_details.to_string()),
        "success",
    );
    s.log_audit(&entry).unwrap();

    let entries = s.list_audit_entries(10, 0).unwrap();
    assert_eq!(entries.len(), 1);
    assert!(
        entries[0].details.contains("🌏"),
        "emoji should survive round-trip"
    );
    assert!(
        entries[0].details.contains("你好世界"),
        "CJK should survive round-trip"
    );
}

#[test]
fn audit_log_long_user_id() {
    let conn = fresh();
    let s = store(&conn);

    // 200-char user ID
    let long_user = "user-".to_owned() + &"a".repeat(195);
    assert_eq!(long_user.len(), 200);

    let entry = AuditEntry::new(
        &long_user,
        "bulk.import",
        None::<String>,
        None::<String>,
        None::<String>,
        "success",
    );
    s.log_audit(&entry).unwrap();

    let entries = s.list_audit_entries(10, 0).unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].user_id.len(), 200);
}

#[test]
fn audit_log_special_chars_target_type() {
    let conn = fresh();
    let s = store(&conn);

    // Dotted namespace path, hyphenated, with numbers
    let entry = AuditEntry::new(
        "system",
        "setting.update",
        Some("oz-pos.settings.v3".to_string()),
        Some("workspace.123".to_string()),
        None::<String>,
        "success",
    );
    s.log_audit(&entry).unwrap();

    let entries = s.list_audit_entries(10, 0).unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(
        entries[0].target_type.as_deref(),
        Some("oz-pos.settings.v3")
    );
    assert_eq!(entries[0].target_id.as_deref(), Some("workspace.123"));
}

// ── Filtered + keyset pagination (AUD-02/AUD-03) ──────────────

#[test]
fn filtered_entries_outcome_filter_matches_db_rows() {
    let conn = fresh();
    seed_audit_entries(&conn);
    let (items, total, has_more) = store(&conn)
        .list_audit_entries_filtered(Some("failure"), None, None, None, 50)
        .unwrap();
    assert_eq!(total, 1);
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].action, "user.login");
    assert!(!has_more);
}

#[test]
fn filtered_entries_free_text_query_matches_action_and_target() {
    let conn = fresh();
    seed_audit_entries(&conn);
    // Query matches action (sale) — 2 rows.
    let (items, total, _) = store(&conn)
        .list_audit_entries_filtered(None, Some("sale"), None, None, 50)
        .unwrap();
    assert_eq!(total, 2);
    assert_eq!(items.len(), 2);
    // Query matches target_id (prod-1) — 1 row.
    let (items, total, _) = store(&conn)
        .list_audit_entries_filtered(None, Some("prod-1"), None, None, 50)
        .unwrap();
    assert_eq!(total, 1);
    assert_eq!(items[0].id, "aud-3");
}

#[test]
fn filtered_entries_wildcard_query_is_escaped() {
    let conn = fresh();
    let s = store(&conn);
    s.log_audit(&AuditEntry::new(
        "user-1",
        "bulk.import",
        Some("product".to_string()),
        Some("batch-50%".to_string()),
        None::<String>,
        "success",
    ))
    .unwrap();
    // A bare '%' must not match every row — only literal-% rows.
    let (items, total, _) = store(&conn)
        .list_audit_entries_filtered(None, Some("%"), None, None, 50)
        .unwrap();
    assert_eq!(total, 1);
    assert_eq!(items[0].target_id.as_deref(), Some("batch-50%"));
}

#[test]
fn filtered_entries_keyset_cursor_is_stable_and_excludes_prior_rows() {
    let conn = fresh();
    seed_audit_entries(&conn);
    // Page 1: most recent 2 (aud-4, aud-3).
    let (page1, total1, has_more1) = store(&conn)
        .list_audit_entries_filtered(None, None, None, None, 2)
        .unwrap();
    assert_eq!(total1, 4);
    assert_eq!(page1.len(), 2);
    assert_eq!(page1[0].id, "aud-4");
    assert_eq!(page1[1].id, "aud-3");
    assert!(has_more1);

    // Page 2: continue strictly before (created_at, id) of last row.
    let last = &page1[1];
    let (page2, _, has_more2) = store(&conn)
        .list_audit_entries_filtered(None, None, Some(&last.created_at), Some(&last.id), 2)
        .unwrap();
    assert_eq!(page2.len(), 2);
    assert_eq!(page2[0].id, "aud-2");
    assert_eq!(page2[1].id, "aud-1");
    assert!(!has_more2);
}

// ── Export snapshot (AUD-09) ───────────────────────────────────

#[test]
fn export_entries_returns_all_matching_rows_newest_first() {
    let conn = fresh();
    seed_audit_entries(&conn);
    let items = store(&conn).list_audit_entries_export(None, None).unwrap();
    // All 4 rows, newest first (aud-4 … aud-1) — not clamped to a page.
    assert_eq!(items.len(), 4);
    assert_eq!(items[0].id, "aud-4");
    assert_eq!(items[1].id, "aud-3");
    assert_eq!(items[2].id, "aud-2");
    assert_eq!(items[3].id, "aud-1");
}

#[test]
fn export_entries_applies_outcome_and_query_filters() {
    let conn = fresh();
    seed_audit_entries(&conn);
    // Outcome filter only.
    let items = store(&conn)
        .list_audit_entries_export(Some("failure"), None)
        .unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].action, "user.login");
    // Query filter only.
    let items = store(&conn)
        .list_audit_entries_export(None, Some("sale"))
        .unwrap();
    assert_eq!(items.len(), 2);
}

#[test]
fn export_entries_with_no_matches_returns_empty() {
    let conn = fresh();
    seed_audit_entries(&conn);
    let items = store(&conn)
        .list_audit_entries_export(Some("success"), Some("nonexistent-action"))
        .unwrap();
    assert!(items.is_empty());
}

#[test]
fn filtered_entries_limit_clamped_to_200() {
    let conn = fresh();
    seed_audit_entries(&conn);
    let (items, total, _) = store(&conn)
        .list_audit_entries_filtered(None, None, None, None, 10_000)
        .unwrap();
    assert_eq!(items.len(), 4);
    assert_eq!(total, 4);
    // 0 clamps to 1 and still returns a row.
    let (items, _, _) = store(&conn)
        .list_audit_entries_filtered(None, None, None, None, 0)
        .unwrap();
    assert_eq!(items.len(), 1);
}

// ── Review checkpoints (AUD-04) ────────────────────────────────

fn checkpoint(
    id: &str,
    store: &str,
    reviewer: &str,
    reviewed_at: &str,
) -> crate::AuditReviewCheckpoint {
    crate::AuditReviewCheckpoint {
        id: id.into(),
        store_id: store.into(),
        reviewer_user_id: reviewer.into(),
        reviewed_at: reviewed_at.into(),
        reviewed_through_created_at: "2025-01-01T12:00:00.000Z".into(),
        reviewed_through_id: "aud-1".into(),
    }
}

#[test]
fn save_review_checkpoint_persists_row() {
    let conn = fresh();
    let s = store(&conn);
    let cp = checkpoint("cp-1", "store-a", "user-1", "2025-02-01T00:00:00.000Z");
    s.save_review_checkpoint(&cp).unwrap();

    let latest = s.latest_review_checkpoint().unwrap().unwrap();
    assert_eq!(latest.id, "cp-1");
    assert_eq!(latest.store_id, "store-a");
    assert_eq!(latest.reviewer_user_id, "user-1");
    assert_eq!(latest.reviewed_through_id, "aud-1");
}

#[test]
fn save_review_checkpoint_emits_audit_review_event() {
    let conn = fresh();
    let s = store(&conn);
    let cp = checkpoint("cp-1", "store-a", "user-1", "2025-02-01T00:00:00.000Z");
    s.save_review_checkpoint(&cp).unwrap();

    let entries = s.list_audit_entries(10, 0).unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].action, "audit.review");
    assert_eq!(
        entries[0].target_type.as_deref(),
        Some("audit_review_checkpoint")
    );
    assert_eq!(entries[0].target_id.as_deref(), Some("cp-1"));
    assert!(entries[0].details.contains("reviewed_through_id"));
}

#[test]
fn latest_review_checkpoint_returns_newest() {
    let conn = fresh();
    let s = store(&conn);
    s.save_review_checkpoint(&checkpoint(
        "cp-1",
        "store-a",
        "user-1",
        "2025-02-01T00:00:00.000Z",
    ))
    .unwrap();
    s.save_review_checkpoint(&checkpoint(
        "cp-2",
        "store-a",
        "user-2",
        "2025-03-01T00:00:00.000Z",
    ))
    .unwrap();

    let latest = s.latest_review_checkpoint().unwrap().unwrap();
    assert_eq!(latest.id, "cp-2");
    assert_eq!(latest.reviewer_user_id, "user-2");
}

#[test]
fn latest_review_checkpoint_empty_is_none() {
    let conn = fresh();
    assert!(store(&conn).latest_review_checkpoint().unwrap().is_none());
}
#[test]
fn count_audit_entries_after_counts_full_table() {
    let conn = fresh();
    seed_audit_entries(&conn);
    let s = store(&conn);
    // All 4 rows are after 2024.
    assert_eq!(
        s.count_audit_entries_after("2024-01-01T00:00:00.000Z")
            .unwrap(),
        4
    );
    // Only aud-4 is after 13:30.
    assert_eq!(
        s.count_audit_entries_after("2025-01-01T13:30:00.000Z")
            .unwrap(),
        1
    );
    // Nothing after 2026.
    assert_eq!(
        s.count_audit_entries_after("2026-01-01T00:00:00.000Z")
            .unwrap(),
        0
    );
}

// ── Sensitive-detail sanitisation (AUD-06) ─────────────────────

#[test]
fn log_audit_redacts_sensitive_keys() {
    let conn = fresh();
    let s = store(&conn);
    let entry = AuditEntry::new(
        "user-1",
        "login",
        None::<String>,
        None::<String>,
        Some(
            "{\"user\":\"admin\",\"password\":\"hunter2\",\"api_key\":\"sk-123\",\"pin\":\"4321\"}"
                .to_string(),
        ),
        "failure",
    );
    s.log_audit(&entry).unwrap();
    let entries = s.list_audit_entries(10, 0).unwrap();
    assert!(!entries[0].details.contains("hunter2"));
    assert!(!entries[0].details.contains("sk-123"));
    assert!(!entries[0].details.contains("4321"));
    assert!(entries[0].details.contains("[REDACTED]"));
    // Non-sensitive values survive.
    assert!(entries[0].details.contains("admin"));
}

#[test]
fn log_audit_redacts_nested_sensitive_keys() {
    let conn = fresh();
    let s = store(&conn);
    let entry = AuditEntry::new(
        "user-1",
        "sale.refund",
        None::<String>,
        None::<String>,
        Some("{\"reason\":\"ok\",\"card\":{\"card_number\":\"4242\",\"cvv\":\"123\"}}".to_string()),
        "success",
    );
    s.log_audit(&entry).unwrap();
    let entries = s.list_audit_entries(10, 0).unwrap();
    assert!(!entries[0].details.contains("4242"));
    assert!(!entries[0].details.contains("\"123\""));
    assert!(entries[0].details.contains("[REDACTED]"));
    assert!(entries[0].details.contains("\"reason\":\"ok\""));
}

#[test]
fn log_audit_truncates_oversized_details() {
    let conn = fresh();
    let s = store(&conn);
    let big = format!("{{\"payload\":\"{}\"}}", "x".repeat(10_000));
    let entry = AuditEntry::new(
        "user-1",
        "bulk.import",
        None::<String>,
        None::<String>,
        Some(big.clone()),
        "success",
    );
    s.log_audit(&entry).unwrap();
    let entries = s.list_audit_entries(10, 0).unwrap();
    assert!(entries[0].details.len() < big.len());
    assert!(entries[0].details.ends_with("[truncated]"));
}

#[test]
fn log_audit_keeps_non_secret_json_intact() {
    let conn = fresh();
    let s = store(&conn);
    let details = "{\"total_minor\":1000,\"reason\":\"test\"}";
    let entry = AuditEntry::new(
        "user-1",
        "sale.void",
        None::<String>,
        None::<String>,
        Some(details.to_string()),
        "success",
    );
    s.log_audit(&entry).unwrap();
    let entries = s.list_audit_entries(10, 0).unwrap();
    assert!(entries[0].details.contains("1000"));
    assert!(!entries[0].details.contains("[REDACTED]"));
}

// ── Tier audit retention sweep (todo-global-saas-2.md P1) ───────

use crate::subscription::SubscriptionTier;

/// Insert an audit row with an explicit RFC3339 timestamp and id.
fn insert_audit_at(conn: &Connection, id: &str, created_at: &str) {
    conn.execute(
        "INSERT INTO audit_log (id, user_id, action, details, outcome, created_at)
         VALUES (?1, 'sweeper-test', 'sale.void', '{}', 'success', ?2)",
        rusqlite::params![id, created_at],
    )
    .unwrap();
}

/// Count rows in audit_log.
fn audit_count(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM audit_log", [], |r| r.get(0))
        .unwrap()
}

/// The sweep must leave the trigger marker disarmed after every path.
fn marker_count(conn: &Connection) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM settings WHERE key = 'audit.retention_sweep_active'",
        [],
        |r| r.get(0),
    )
    .unwrap()
}

#[test]
fn audit_retention_row_inside_window_survives() {
    let conn = fresh();
    let s = store(&conn);
    // Plus = 90 days. `now` is far in the future of the seeded timestamps;
    // a row 10 days old is inside the window.
    let now = "2100-01-01T00:00:00.000Z";
    insert_audit_at(&conn, "aud-win", "2099-12-22T00:00:00.000Z");
    let deleted = s
        .sweep_audit_retention(&SubscriptionTier::Plus, now)
        .unwrap();
    assert_eq!(deleted, 0, "nothing is past the Plus window");
    assert_eq!(audit_count(&conn), 1);
    assert_eq!(marker_count(&conn), 0, "marker must not linger");
}

#[test]
fn audit_retention_row_outside_window_is_swept() {
    let conn = fresh();
    let s = store(&conn);
    // Plus = 90 days: a row 91 days old is out, a row 89 days old is in.
    let now = "2100-01-01T00:00:00.000Z";
    insert_audit_at(&conn, "aud-old", "2099-10-02T00:00:00.000Z");
    insert_audit_at(&conn, "aud-new", "2099-10-04T00:00:00.000Z");
    let deleted = s
        .sweep_audit_retention(&SubscriptionTier::Plus, now)
        .unwrap();
    assert_eq!(deleted, 1, "only the 91-day-old row is past the window");
    assert_eq!(audit_count(&conn), 1);
    let remaining = s.list_audit_entries(10, 0).unwrap();
    assert_eq!(remaining[0].id, "aud-new");
    assert_eq!(marker_count(&conn), 0);
}

#[test]
fn audit_retention_window_is_measured_from_event_timestamp() {
    // The schedule is measured from the EVENT timestamp, not from row
    // insertion order: insert the IN-WINDOW row first and the EXPIRED row
    // second (higher rowid, newer in the table) — only the expired one
    // goes, despite being the most recently inserted.
    let conn = fresh();
    let s = store(&conn);
    let now = "2100-01-01T00:00:00.000Z";
    insert_audit_at(&conn, "aud-in-window", "2099-12-22T00:00:00.000Z");
    insert_audit_at(&conn, "aud-expired-but-late", "2099-01-01T00:00:00.000Z");
    let deleted = s
        .sweep_audit_retention(&SubscriptionTier::Plus, now)
        .unwrap();
    assert_eq!(deleted, 1, "event timestamp, not insertion order, decides");
    let remaining = s.list_audit_entries(10, 0).unwrap();
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].id, "aud-in-window");
    assert_eq!(marker_count(&conn), 0);
}

#[test]
fn audit_retention_per_tier_windows() {
    // One row exactly N days + 1ms old is expired for every tier with a
    // shorter window and survives for every tier with a longer one.
    let cases: &[(SubscriptionTier, &str, usize)] = &[
        // 200 days old: Plus(90) and Pro(180) sweep it;
        // Premium(365)/Enterprise(1095) keep it.
        (SubscriptionTier::Plus, "2099-06-15T00:00:00.000Z", 1),
        (SubscriptionTier::Pro, "2099-06-15T00:00:00.000Z", 1),
        (SubscriptionTier::Premium, "2099-06-15T00:00:00.000Z", 0),
        (SubscriptionTier::Enterprise, "2099-06-15T00:00:00.000Z", 0),
    ];
    for (tier, ts, expected) in cases {
        let conn = fresh();
        let s = store(&conn);
        insert_audit_at(&conn, "aud-tier", ts);
        let deleted = s
            .sweep_audit_retention(tier, "2100-01-01T00:00:00.000Z")
            .unwrap();
        assert_eq!(
            deleted, *expected,
            "tier {:?} swept {deleted} rows, expected {expected}",
            tier
        );
        assert_eq!(marker_count(&conn), 0);
    }
}

#[test]
fn audit_retention_free_purges_everything() {
    // Free has NO retention entitlement: every row goes, regardless of
    // age ("Free has no tenant-facing audit logs").
    let conn = fresh();
    let s = store(&conn);
    let now = "2100-01-01T00:00:00.000Z";
    insert_audit_at(&conn, "aud-fresh", now); // brand new — still purged
    insert_audit_at(&conn, "aud-ancient", "2019-01-01T00:00:00.000Z");
    let deleted = s
        .sweep_audit_retention(&SubscriptionTier::Free, now)
        .unwrap();
    assert_eq!(deleted, 2);
    assert_eq!(audit_count(&conn), 0);
    assert_eq!(marker_count(&conn), 0);
}

#[test]
fn audit_retention_sweep_is_noop_when_nothing_expired() {
    let conn = fresh();
    let s = store(&conn);
    // Empty-table fast path (paid tier, nothing at all).
    let deleted = s
        .sweep_audit_retention(&SubscriptionTier::Enterprise, "2100-01-01T00:00:00.000Z")
        .unwrap();
    assert_eq!(deleted, 0);
    // Free on an empty table also fast-paths (no transaction, no marker).
    let deleted = s
        .sweep_audit_retention(&SubscriptionTier::Free, "2100-01-01T00:00:00.000Z")
        .unwrap();
    assert_eq!(deleted, 0);

    // Non-empty table, nothing past the cutoff (paid tier): the row 1ms
    // inside the Enterprise window survives.
    insert_audit_at(&conn, "aud-live", "2099-12-31T23:59:59.999Z");
    let deleted = s
        .sweep_audit_retention(&SubscriptionTier::Enterprise, "2100-01-01T00:00:00.000Z")
        .unwrap();
    assert_eq!(deleted, 0);
    assert_eq!(audit_count(&conn), 1);
    assert_eq!(marker_count(&conn), 0, "no sweep left a marker behind");
}

#[test]
fn audit_retention_sweep_is_idempotent() {
    let conn = fresh();
    let s = store(&conn);
    insert_audit_at(&conn, "aud-x", "2099-01-01T00:00:00.000Z");
    let first = s
        .sweep_audit_retention(&SubscriptionTier::Plus, "2100-01-01T00:00:00.000Z")
        .unwrap();
    let second = s
        .sweep_audit_retention(&SubscriptionTier::Plus, "2100-01-01T00:00:00.000Z")
        .unwrap();
    assert_eq!(first, 1);
    assert_eq!(second, 0, "second sweep finds nothing to do");
}

#[test]
fn audit_retention_trigger_still_blocks_direct_delete() {
    // The carve-out is transaction-scoped: a plain DELETE outside a live
    // sweep must still hit the immutability trigger.
    let conn = fresh();
    insert_audit_at(&conn, "aud-locked", "2019-01-01T00:00:00.000Z");
    let err = conn
        .execute("DELETE FROM audit_log WHERE id = 'aud-locked'", [])
        .unwrap_err();
    assert!(
        err.to_string().contains("immutable"),
        "expected the immutability trigger, got: {err}"
    );
}

#[test]
fn audit_retention_update_remains_absolutely_immutable() {
    // Deletion is the implemented retention policy; UPDATE stays blocked
    // with NO carve-out (migration 20260920 touches only the DELETE
    // trigger).
    let conn = fresh();
    insert_audit_at(&conn, "aud-frozen", "2019-01-01T00:00:00.000Z");
    let err = conn
        .execute(
            "UPDATE audit_log SET details = '{}' WHERE id = 'aud-frozen'",
            [],
        )
        .unwrap_err();
    assert!(err.to_string().contains("immutable"), "got: {err}");
}

#[test]
fn audit_retention_bad_now_timestamp_fails_closed() {
    let conn = fresh();
    let s = store(&conn);
    insert_audit_at(&conn, "aud-badts", "2099-01-01T00:00:00.000Z");
    let err = s
        .sweep_audit_retention(&SubscriptionTier::Plus, "not-a-timestamp")
        .unwrap_err();
    assert!(
        err.to_string().contains("bad `now` timestamp"),
        "got: {err}"
    );
    assert_eq!(audit_count(&conn), 1, "nothing deleted on error");
    assert_eq!(marker_count(&conn), 0);
}

// ── Filtered export (security-event export, owner ruling D61-7) ──

#[test]
fn filtered_export_actions_allowlist_restricts_rows() {
    let conn = fresh();
    seed_audit_entries(&conn);
    // Restricted to the two sale actions.
    let items = store(&conn)
        .list_audit_entries_export_filtered(
            Some(&["sale.create", "sale.void"]),
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();
    assert_eq!(items.len(), 2);
    assert_eq!(items[0].id, "aud-2");
    assert_eq!(items[1].id, "aud-1");
    // Empty allow-list fails CLOSED: a caller that forgets to populate
    // its allow-list must not be rewarded with every audit row (the
    // shared WHERE builder's rule, carried into the export).
    let items = store(&conn)
        .list_audit_entries_export_filtered(Some(&[]), None, None, None, None, None)
        .unwrap();
    assert!(items.is_empty());
}

#[test]
fn filtered_export_actor_is_exact_user_id_match() {
    let conn = fresh();
    seed_audit_entries(&conn);
    conn.execute(
        "INSERT INTO audit_log (id, user_id, action, target_type, target_id, details, outcome, created_at)
         VALUES ('aud-5', 'user-10', 'sale.create', 'sale', 'sale-10', '{}', 'success', '2025-01-01T15:00:00.000Z')",
        [],
    )
    .unwrap();
    // EXACT match (journal D84 ruling 2): user-1 must not pick up the
    // user-10 row the way a LIKE filter would.
    let items = store(&conn)
        .list_audit_entries_export_filtered(None, Some("user-1"), None, None, None, None)
        .unwrap();
    assert_eq!(items.len(), 2);
    assert!(items.iter().all(|e| e.user_id == "user-1"));
    // 'system' resolves the SYSTEM_ACTOR rows naturally — the column
    // literal is the value.
    let items = store(&conn)
        .list_audit_entries_export_filtered(None, Some("system"), None, None, None, None)
        .unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].id, "aud-4");
}

#[test]
fn filtered_export_date_bounds_inclusive_after_exclusive_before() {
    let conn = fresh();
    seed_audit_entries(&conn);
    // created_after is INCLUSIVE: aud-3 sits exactly at 13:00 and IS returned.
    let items = store(&conn)
        .list_audit_entries_export_filtered(
            None,
            None,
            Some("2025-01-01T13:00:00.000Z".into()),
            None,
            None,
            None,
        )
        .unwrap();
    assert_eq!(items.len(), 2);
    assert_eq!(items[0].id, "aud-4");
    assert_eq!(items[1].id, "aud-3");
    // created_before is EXCLUSIVE: aud-4 sits exactly at 14:00 and is NOT.
    let items = store(&conn)
        .list_audit_entries_export_filtered(
            None,
            None,
            None,
            Some("2025-01-01T14:00:00.000Z".into()),
            None,
            None,
        )
        .unwrap();
    assert_eq!(items.len(), 3);
    assert!(items.iter().all(|e| e.id != "aud-4"));
    // Fixed-width strftime values sort lexicographically == chronologically.
    let items = store(&conn)
        .list_audit_entries_export_filtered(
            None,
            None,
            Some("2025-01-01T12:05:00.000Z".into()),
            Some("2025-01-01T13:00:00.000Z".into()),
            None,
            None,
        )
        .unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].id, "aud-2");
}

#[test]
fn filtered_export_combined_filters() {
    let conn = fresh();
    seed_audit_entries(&conn);
    let items = store(&conn)
        .list_audit_entries_export_filtered(
            Some(&["sale.create", "product.create"]),
            Some("user-1"),
            Some("2025-01-01T12:05:00.000Z".into()),
            None,
            None,
            None,
        )
        .unwrap();
    // sale.create falls before the `after` bound; product.create survives
    // actions + actor + date together.
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].id, "aud-3");
}
