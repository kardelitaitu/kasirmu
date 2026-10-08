//! Integration tests for the terminal module — CRUD, ping, timestamps,
//! deactivation, and edge cases.
//!
//! Tests exercise the full persistence layer via the public
//! [`kasirmu_core::Store`] API against an in-memory SQLite database.

use kasirmu_core::{Store, Terminal, migrations};
use rusqlite::Connection;

// ── Helpers ───────────────────────────────────────────────────────────

fn setup() -> Connection {
    migrations::fresh_db()
}

fn store(conn: &Connection) -> Store<'_> {
    Store::new(conn)
}

fn make_terminal(id: &str, name: &str, device_id: &str) -> Terminal {
    Terminal {
        id: id.to_owned(),
        name: name.to_owned(),
        device_id: device_id.to_owned(),
        terminal_secret: Some("secret-default".to_string()),
        is_active: true,
        last_seen_at: None,
        metadata: Some("{}".to_string()),
        created_at: "2025-01-01T00:00:00.000Z".to_string(),
        updated_at: "2025-01-01T00:00:00.000Z".to_string(),
    }
}

fn seed_terminals(conn: &Connection) {
    conn.execute_batch(
        "INSERT INTO terminals (id, name, device_id, terminal_secret, is_active, metadata, created_at, updated_at) VALUES
            ('term-a', 'Front Register', 'dev-001', 'secret-1', 1, '{}', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
            ('term-b', 'Back Office',    'dev-002', 'secret-2', 1, '{\"location\":\"office\"}', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
            ('term-c', 'Kiosk',          'dev-003', 'secret-3', 0, '{\"model\":\"kiosk-v2\"}', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');"
    ).unwrap();
}

// ── List ─────────────────────────────────────────────────────────────

#[test]
fn list_terminals_empty_db() {
    let conn = setup();
    let terminals = store(&conn).list_terminals().unwrap();
    assert!(terminals.is_empty());
}

#[test]
fn list_terminals_ordered_by_name() {
    let conn = setup();
    seed_terminals(&conn);
    let terminals = store(&conn).list_terminals().unwrap();
    assert_eq!(terminals.len(), 3);
    assert_eq!(terminals[0].name, "Back Office");
    assert_eq!(terminals[1].name, "Front Register");
    assert_eq!(terminals[2].name, "Kiosk");
}

#[test]
fn list_terminals_includes_inactive() {
    let conn = setup();
    seed_terminals(&conn);
    let terminals = store(&conn).list_terminals().unwrap();
    let kiosk = terminals.iter().find(|t| t.id == "term-c").unwrap();
    assert!(!kiosk.is_active, "Kiosk should be inactive");
}

// ── Get ──────────────────────────────────────────────────────────────

#[test]
fn get_terminal_by_id() {
    let conn = setup();
    seed_terminals(&conn);
    let t = store(&conn).get_terminal("term-a").unwrap().unwrap();
    assert_eq!(t.name, "Front Register");
    assert_eq!(t.device_id, "dev-001");
    assert_eq!(t.terminal_secret.as_deref(), Some("secret-1"));
    assert!(t.is_active);
}

#[test]
fn get_terminal_not_found() {
    let conn = setup();
    let t = store(&conn).get_terminal("nonexistent").unwrap();
    assert!(t.is_none());
}

#[test]
fn get_terminal_by_device_id() {
    let conn = setup();
    seed_terminals(&conn);
    let t = store(&conn)
        .get_terminal_by_device_id("dev-002")
        .unwrap()
        .unwrap();
    assert_eq!(t.name, "Back Office");
    assert_eq!(t.id, "term-b");
}

#[test]
fn get_terminal_by_device_id_not_found() {
    let conn = setup();
    let t = store(&conn)
        .get_terminal_by_device_id("unknown-device")
        .unwrap();
    assert!(t.is_none());
}

// ── Create ───────────────────────────────────────────────────────────

#[test]
fn create_terminal_persists() {
    let conn = setup();
    let t = make_terminal("term-new", "New Register", "dev-999");
    store(&conn).create_terminal(&t).unwrap();

    let loaded = store(&conn).get_terminal("term-new").unwrap().unwrap();
    assert_eq!(loaded.name, "New Register");
    assert_eq!(loaded.device_id, "dev-999");
    assert_eq!(loaded.terminal_secret.as_deref(), Some("secret-default"));
    assert!(loaded.is_active);
    assert!(loaded.last_seen_at.is_none());
}

#[test]
fn create_terminal_duplicate_id_fails() {
    let conn = setup();
    let t1 = make_terminal("term-dup", "First", "dev-1");
    store(&conn).create_terminal(&t1).unwrap();

    let t2 = make_terminal("term-dup", "Second", "dev-2");
    let result = store(&conn).create_terminal(&t2);
    assert!(result.is_err(), "duplicate terminal id should be rejected");
}

#[test]
fn create_terminal_duplicate_device_id_fails() {
    let conn = setup();
    let t1 = make_terminal("term-d1", "First", "same-device");
    store(&conn).create_terminal(&t1).unwrap();

    let t2 = make_terminal("term-d2", "Second", "same-device");
    let result = store(&conn).create_terminal(&t2);
    assert!(result.is_err(), "duplicate device_id should be rejected");
}

// ── Update ───────────────────────────────────────────────────────────

#[test]
fn update_terminal_basic() {
    let conn = setup();
    seed_terminals(&conn);

    let updated = Terminal {
        id: "term-a".to_string(),
        name: "Front Register v2".to_string(),
        device_id: "dev-001-new".to_string(),
        terminal_secret: Some("new-secret".to_string()),
        is_active: true,
        last_seen_at: None,
        metadata: Some(r#"{"version":2}"#.to_string()),
        created_at: String::new(),
        updated_at: String::new(),
    };
    store(&conn).update_terminal(&updated).unwrap();

    let loaded = store(&conn).get_terminal("term-a").unwrap().unwrap();
    assert_eq!(loaded.name, "Front Register v2");
    assert_eq!(loaded.device_id, "dev-001-new");
    assert_eq!(loaded.terminal_secret.as_deref(), Some("new-secret"));
    assert_eq!(loaded.metadata.as_deref(), Some(r#"{"version":2}"#));
}

#[test]
fn update_terminal_not_found() {
    let conn = setup();
    let t = make_terminal("nope", "X", "dev-x");
    let err = store(&conn).update_terminal(&t).unwrap_err();
    assert!(
        matches!(err, kasirmu_core::CoreError::NotFound { entity, .. } if entity == "terminal")
    );
}

// ── Deactivate / Reactivate ──────────────────────────────────────────

#[test]
fn terminal_deactivate_and_reactivate() {
    let conn = setup();
    seed_terminals(&conn);
    let s = store(&conn);

    // Deactivate an active terminal.
    let deactivated = Terminal {
        id: "term-a".to_string(),
        name: "Front Register".to_string(),
        device_id: "dev-001".to_string(),
        terminal_secret: Some("secret-1".to_string()),
        is_active: false,
        last_seen_at: None,
        metadata: Some("{}".to_string()),
        created_at: String::new(),
        updated_at: String::new(),
    };
    s.update_terminal(&deactivated).unwrap();
    let loaded = s.get_terminal("term-a").unwrap().unwrap();
    assert!(!loaded.is_active, "terminal should be deactivated");

    // Reactivate.
    let reactivated = Terminal {
        is_active: true,
        ..deactivated
    };
    s.update_terminal(&reactivated).unwrap();
    let loaded = s.get_terminal("term-a").unwrap().unwrap();
    assert!(loaded.is_active, "terminal should be reactivated");
}

// ── Ping ─────────────────────────────────────────────────────────────

#[test]
fn ping_terminal_sets_last_seen_at() {
    let conn = setup();
    seed_terminals(&conn);
    let s = store(&conn);

    s.ping_terminal("term-b").unwrap();

    let loaded = s.get_terminal("term-b").unwrap().unwrap();
    assert!(
        loaded.last_seen_at.is_some(),
        "last_seen_at should be set after ping"
    );
    assert!(
        !loaded.updated_at.is_empty(),
        "updated_at should be set after ping"
    );
}

#[test]
fn ping_terminal_not_found() {
    let conn = setup();
    let err = store(&conn).ping_terminal("nonexistent").unwrap_err();
    assert!(
        matches!(err, kasirmu_core::CoreError::NotFound { entity, .. } if entity == "terminal")
    );
}

#[test]
fn ping_terminal_updates_timestamp() {
    let conn = setup();
    seed_terminals(&conn);
    let s = store(&conn);

    s.ping_terminal("term-a").unwrap();
    let after_first = s
        .get_terminal("term-a")
        .unwrap()
        .unwrap()
        .last_seen_at
        .clone();

    std::thread::sleep(std::time::Duration::from_millis(2));

    s.ping_terminal("term-a").unwrap();
    let after_second = s.get_terminal("term-a").unwrap().unwrap().last_seen_at;

    assert!(
        after_second > after_first,
        "second ping should produce a newer timestamp"
    );
}

// ── Delete ───────────────────────────────────────────────────────────

#[test]
fn delete_terminal_removes() {
    let conn = setup();
    seed_terminals(&conn);
    store(&conn).delete_terminal("term-c").unwrap();

    let t = store(&conn).get_terminal("term-c").unwrap();
    assert!(t.is_none(), "deleted terminal should not exist");

    let remaining = store(&conn).list_terminals().unwrap();
    assert_eq!(remaining.len(), 2);
}

#[test]
fn delete_terminal_not_found() {
    let conn = setup();
    let err = store(&conn).delete_terminal("nope").unwrap_err();
    assert!(matches!(err, kasirmu_core::CoreError::NotFound { .. }));
}

// ── Terminal metadata ────────────────────────────────────────────────

#[test]
fn terminal_metadata_roundtrip() {
    let conn = setup();
    let t = Terminal {
        id: "term-meta".to_string(),
        name: "Meta Terminal".to_string(),
        device_id: "dev-meta".to_string(),
        terminal_secret: Some("sec-meta".to_string()),
        is_active: false,
        last_seen_at: None,
        metadata: Some(r#"{"os":"windows","app_version":"1.2.3"}"#.to_string()),
        created_at: "2025-01-01T00:00:00.000Z".to_string(),
        updated_at: "2025-01-01T00:00:00.000Z".to_string(),
    };
    store(&conn).create_terminal(&t).unwrap();

    let loaded = store(&conn).get_terminal("term-meta").unwrap().unwrap();
    assert!(!loaded.is_active);
    assert_eq!(
        loaded.metadata.as_deref(),
        Some(r#"{"os":"windows","app_version":"1.2.3"}"#)
    );
    assert_eq!(loaded.terminal_secret.as_deref(), Some("sec-meta"));
}

#[test]
fn terminal_nullable_fields() {
    let conn = setup();
    let t = Terminal {
        id: "term-null".to_string(),
        name: "Null Fields".to_string(),
        device_id: "dev-null".to_string(),
        terminal_secret: None,
        is_active: true,
        last_seen_at: None,
        metadata: None,
        created_at: "2025-01-01T00:00:00.000Z".to_string(),
        updated_at: "2025-01-01T00:00:00.000Z".to_string(),
    };
    store(&conn).create_terminal(&t).unwrap();

    let loaded = store(&conn).get_terminal("term-null").unwrap().unwrap();
    assert!(loaded.terminal_secret.is_none());
    assert!(loaded.last_seen_at.is_none());
    assert!(loaded.metadata.is_none());
}

// ── Terminal timestamps ──────────────────────────────────────────────

#[test]
fn terminal_timestamps_on_create() {
    let conn = setup();
    let t = make_terminal("term-ts", "Timestamp Test", "dev-ts");
    store(&conn).create_terminal(&t).unwrap();

    let loaded = store(&conn).get_terminal("term-ts").unwrap().unwrap();
    assert!(!loaded.created_at.is_empty());
    assert!(!loaded.updated_at.is_empty());
}

#[test]
fn terminal_updated_at_increases_on_ping() {
    let conn = setup();
    seed_terminals(&conn);
    let s = store(&conn);

    let initial = s
        .get_terminal("term-a")
        .unwrap()
        .unwrap()
        .updated_at
        .clone();

    std::thread::sleep(std::time::Duration::from_millis(2));

    s.ping_terminal("term-a").unwrap();

    let after = s.get_terminal("term-a").unwrap().unwrap().updated_at;
    assert!(after > initial, "updated_at should increase after ping");
    assert!(after.contains('T'), "updated_at should be ISO-8601");
    assert!(after.ends_with('Z'), "updated_at should be UTC");
}
