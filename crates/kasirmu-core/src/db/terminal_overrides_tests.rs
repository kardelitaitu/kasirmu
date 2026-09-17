use super::*;
use crate::migrations;
use rusqlite::Connection;

fn fresh() -> Connection {
    migrations::fresh_db()
}

fn store(conn: &Connection) -> Store<'_> {
    Store::new(conn)
}

fn seed_terminal(conn: &Connection) {
    conn.execute_batch(
        "INSERT INTO terminals (id, name, device_id, created_at, updated_at)
         VALUES ('term-1', 'Front Register', 'dev-001', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
                ('term-2', 'Back Office',    'dev-002', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')"
    ).unwrap();
}

// ── list_terminal_overrides ──────────────────────────────────────

#[test]
fn list_overrides_empty_when_none_exist() {
    let conn = fresh();
    seed_terminal(&conn);
    let overrides = store(&conn).list_terminal_overrides("term-1").unwrap();
    assert!(overrides.is_empty());
}

#[test]
fn list_overrides_returns_all_for_terminal() {
    let conn = fresh();
    seed_terminal(&conn);
    let s = store(&conn);
    s.set_terminal_override("term-1", "card-payment", false)
        .unwrap();
    s.set_terminal_override("term-1", "receipt-printing", true)
        .unwrap();
    // Different terminal should not appear.
    s.set_terminal_override("term-2", "card-payment", true)
        .unwrap();

    let overrides = s.list_terminal_overrides("term-1").unwrap();
    assert_eq!(overrides.len(), 2);
    assert_eq!(overrides[0].feature, "card-payment");
    assert!(!overrides[0].enabled);
    assert_eq!(overrides[1].feature, "receipt-printing");
    assert!(overrides[1].enabled);
}

// ── get_terminal_override ────────────────────────────────────────

#[test]
fn get_override_found() {
    let conn = fresh();
    seed_terminal(&conn);
    let s = store(&conn);
    s.set_terminal_override("term-1", "card-payment", false)
        .unwrap();
    let o = s
        .get_terminal_override("term-1", "card-payment")
        .unwrap()
        .unwrap();
    assert_eq!(o.feature, "card-payment");
    assert!(!o.enabled);
}

#[test]
fn get_override_not_found() {
    let conn = fresh();
    seed_terminal(&conn);
    let o = store(&conn)
        .get_terminal_override("term-1", "nonexistent")
        .unwrap();
    assert!(o.is_none());
}

// ── set_terminal_override ────────────────────────────────────────

#[test]
fn set_override_inserts_new_row() {
    let conn = fresh();
    seed_terminal(&conn);
    let s = store(&conn);
    s.set_terminal_override("term-1", "card-payment", false)
        .unwrap();
    let o = s
        .get_terminal_override("term-1", "card-payment")
        .unwrap()
        .unwrap();
    assert_eq!(o.feature, "card-payment");
    assert!(!o.enabled);
}

#[test]
fn set_override_updates_existing_row() {
    let conn = fresh();
    seed_terminal(&conn);
    let s = store(&conn);
    s.set_terminal_override("term-1", "card-payment", false)
        .unwrap();
    // Update to enabled.
    s.set_terminal_override("term-1", "card-payment", true)
        .unwrap();
    let o = s
        .get_terminal_override("term-1", "card-payment")
        .unwrap()
        .unwrap();
    assert!(o.enabled);
    assert!(!o.created_at.is_empty());
    assert!(!o.updated_at.is_empty());
}

// ── delete_terminal_override ─────────────────────────────────────

#[test]
fn delete_override_removes_row() {
    let conn = fresh();
    seed_terminal(&conn);
    let s = store(&conn);
    s.set_terminal_override("term-1", "card-payment", false)
        .unwrap();
    s.delete_terminal_override("term-1", "card-payment")
        .unwrap();
    assert!(
        s.get_terminal_override("term-1", "card-payment")
            .unwrap()
            .is_none()
    );
}

#[test]
fn delete_override_not_found() {
    let conn = fresh();
    seed_terminal(&conn);
    let err = store(&conn)
        .delete_terminal_override("term-1", "nope")
        .unwrap_err();
    assert!(
        matches!(err, CoreError::NotFound { entity, .. } if entity == "terminal_feature_override")
    );
}

// ── clear_terminal_overrides ─────────────────────────────────────

#[test]
fn clear_overrides_removes_all() {
    let conn = fresh();
    seed_terminal(&conn);
    let s = store(&conn);
    s.set_terminal_override("term-1", "card-payment", false)
        .unwrap();
    s.set_terminal_override("term-1", "receipt-printing", true)
        .unwrap();
    s.clear_terminal_overrides("term-1").unwrap();
    let overrides = s.list_terminal_overrides("term-1").unwrap();
    assert!(overrides.is_empty());
}

#[test]
fn clear_overrides_other_terminal_untouched() {
    let conn = fresh();
    seed_terminal(&conn);
    let s = store(&conn);
    s.set_terminal_override("term-1", "card-payment", false)
        .unwrap();
    s.set_terminal_override("term-2", "card-payment", true)
        .unwrap();
    s.clear_terminal_overrides("term-1").unwrap();
    let overrides = s.list_terminal_overrides("term-2").unwrap();
    assert_eq!(overrides.len(), 1);
}

// ── Additional edge-case tests ─────────────────────────────────

#[test]
fn list_overrides_ordered_by_feature_asc() {
    let conn = fresh();
    seed_terminal(&conn);
    let s = store(&conn);
    s.set_terminal_override("term-1", "z-feature", true)
        .unwrap();
    s.set_terminal_override("term-1", "a-feature", true)
        .unwrap();
    s.set_terminal_override("term-1", "m-feature", true)
        .unwrap();

    let overrides = s.list_terminal_overrides("term-1").unwrap();
    assert_eq!(overrides.len(), 3);
    assert_eq!(overrides[0].feature, "a-feature");
    assert_eq!(overrides[1].feature, "m-feature");
    assert_eq!(overrides[2].feature, "z-feature");
}

#[test]
fn set_override_multiple_features() {
    let conn = fresh();
    seed_terminal(&conn);
    let s = store(&conn);
    s.set_terminal_override("term-1", "a", true).unwrap();
    s.set_terminal_override("term-1", "b", false).unwrap();
    s.set_terminal_override("term-1", "c", true).unwrap();

    let overrides = s.list_terminal_overrides("term-1").unwrap();
    assert_eq!(overrides.len(), 3);
}

#[test]
fn clear_overrides_nonexistent_terminal_is_noop() {
    let conn = fresh();
    let s = store(&conn);
    s.clear_terminal_overrides("no-such-terminal").unwrap();
}

#[test]
fn set_override_update_timestamp_changes() {
    let conn = fresh();
    seed_terminal(&conn);
    let s = store(&conn);
    s.set_terminal_override("term-1", "feature-x", true)
        .unwrap();
    let original = s
        .get_terminal_override("term-1", "feature-x")
        .unwrap()
        .unwrap();
    let orig_updated = original.updated_at.clone();

    // Sleep 1ms to ensure timestamp change
    std::thread::sleep(std::time::Duration::from_millis(2));

    s.set_terminal_override("term-1", "feature-x", false)
        .unwrap();
    let updated = s
        .get_terminal_override("term-1", "feature-x")
        .unwrap()
        .unwrap();
    assert_ne!(updated.updated_at, orig_updated);
    assert!(!updated.enabled);
}

#[test]
fn list_overrides_for_nonexistent_terminal_returns_empty() {
    let conn = fresh();
    let s = store(&conn);
    let overrides = s.list_terminal_overrides("no-such-terminal").unwrap();
    assert!(overrides.is_empty());
}

#[test]
fn delete_override_wrong_terminal_returns_not_found() {
    let conn = fresh();
    seed_terminal(&conn);
    let s = store(&conn);
    s.set_terminal_override("term-1", "feature-x", true)
        .unwrap();
    let err = s
        .delete_terminal_override("term-2", "feature-x")
        .unwrap_err();
    assert!(matches!(err, CoreError::NotFound { .. }));
}
