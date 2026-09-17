use super::*;
use crate::migrations;
use rusqlite::Connection;

fn fresh() -> Connection {
    migrations::fresh_db()
}

fn store(conn: &Connection) -> Store<'_> {
    Store::new(conn)
}

fn seed_terminal(conn: &Connection, id: &str, name: &str, device_id: &str) {
    conn.execute(
        "INSERT INTO terminals (id, name, device_id, is_active, created_at, updated_at)
         VALUES (?1, ?2, ?3, 1,
                 strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                 strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
        params![id, name, device_id],
    )
    .unwrap();
}

// ── Get ─────────────────────────────────────────────────────────

#[test]
fn get_profile_when_not_set_returns_none() {
    let conn = fresh();
    seed_terminal(&conn, "t1", "Front Counter", "dev-1");
    let profile = store(&conn).get_terminal_profile("t1").unwrap();
    assert!(profile.is_none());
}

#[test]
fn get_profile_after_set() {
    let conn = fresh();
    seed_terminal(&conn, "t1", "Front Counter", "dev-1");
    store(&conn)
        .set_terminal_profile("t1", "kds_kiosk", None)
        .unwrap();

    let profile = store(&conn).get_terminal_profile("t1").unwrap().unwrap();
    assert_eq!(profile.terminal_id, "t1");
    assert_eq!(profile.profile_type, "kds_kiosk");
    assert!(profile.locked_screen.is_none());
}

#[test]
fn get_profile_not_found_when_terminal_does_not_exist() {
    let conn = fresh();
    let profile = store(&conn).get_terminal_profile("nonexistent").unwrap();
    assert!(profile.is_none());
}

// ── Set ─────────────────────────────────────────────────────────

#[test]
fn set_profile_upserts() {
    let conn = fresh();
    seed_terminal(&conn, "t1", "Front Counter", "dev-1");
    store(&conn)
        .set_terminal_profile("t1", "kds_kiosk", None)
        .unwrap();

    // Update existing
    store(&conn)
        .set_terminal_profile("t1", "counter_pos", Some("products"))
        .unwrap();

    let profile = store(&conn).get_terminal_profile("t1").unwrap().unwrap();
    assert_eq!(profile.profile_type, "counter_pos");
    assert_eq!(profile.locked_screen.as_deref(), Some("products"));
}

#[test]
fn set_profile_with_locked_screen() {
    let conn = fresh();
    seed_terminal(&conn, "t2", "KDS Tablet", "dev-2");
    store(&conn)
        .set_terminal_profile("t2", "kds_kiosk", Some("kds"))
        .unwrap();

    let profile = store(&conn).get_terminal_profile("t2").unwrap().unwrap();
    assert_eq!(profile.profile_type, "kds_kiosk");
    assert_eq!(profile.locked_screen.as_deref(), Some("kds"));
}

#[test]
fn set_profile_fails_for_nonexistent_terminal() {
    let conn = fresh();
    let err = store(&conn)
        .set_terminal_profile("nonexistent", "kds_kiosk", None)
        .unwrap_err();
    assert!(matches!(err, CoreError::NotFound { entity, .. } if entity == "terminal"));
}

// ── Delete ──────────────────────────────────────────────────────

#[test]
fn delete_profile_removes_row() {
    let conn = fresh();
    seed_terminal(&conn, "t1", "Front Counter", "dev-1");
    store(&conn)
        .set_terminal_profile("t1", "kds_kiosk", None)
        .unwrap();
    store(&conn).delete_terminal_profile("t1").unwrap();

    let profile = store(&conn).get_terminal_profile("t1").unwrap();
    assert!(profile.is_none());
}

#[test]
fn delete_profile_not_found() {
    let conn = fresh();
    let err = store(&conn)
        .delete_terminal_profile("nonexistent")
        .unwrap_err();
    assert!(matches!(err, CoreError::NotFound { entity, .. } if entity == "terminal_profile"));
}

// ── List ────────────────────────────────────────────────────────

#[test]
fn list_profiles_empty_db() {
    let conn = fresh();
    let profiles = store(&conn).list_terminal_profiles().unwrap();
    assert!(profiles.is_empty());
}

#[test]
fn list_profiles_after_seeding() {
    let conn = fresh();
    seed_terminal(&conn, "t1", "Front Counter", "dev-1");
    seed_terminal(&conn, "t2", "KDS Tablet", "dev-2");
    store(&conn)
        .set_terminal_profile("t1", "counter_pos", None)
        .unwrap();
    store(&conn)
        .set_terminal_profile("t2", "kds_kiosk", Some("kds"))
        .unwrap();

    let profiles = store(&conn).list_terminal_profiles().unwrap();
    assert_eq!(profiles.len(), 2);
    assert_eq!(profiles[0].terminal_id, "t1");
    assert_eq!(profiles[1].profile_type, "kds_kiosk");
}

// ── Additional edge cases ─────────────────────────────────────

#[test]
fn set_profile_no_terminals_exist_fails() {
    let conn = fresh();
    let err = store(&conn)
        .set_terminal_profile("t1", "kds_kiosk", None)
        .unwrap_err();
    assert!(matches!(err, CoreError::NotFound { entity, .. } if entity == "terminal"));
}

#[test]
fn delete_profile_on_terminal_without_profile_returns_not_found() {
    let conn = fresh();
    seed_terminal(&conn, "t1", "Front Counter", "dev-1");
    // Terminal exists but has no profile row
    let err = store(&conn).delete_terminal_profile("t1").unwrap_err();
    assert!(matches!(err, CoreError::NotFound { entity, .. } if entity == "terminal_profile"));
}

#[test]
fn list_profiles_skips_terminals_without_profile() {
    let conn = fresh();
    seed_terminal(&conn, "t1", "Front Counter", "dev-1");
    seed_terminal(&conn, "t2", "KDS Tablet", "dev-2");
    // Only set profile on t1
    store(&conn)
        .set_terminal_profile("t1", "counter_pos", None)
        .unwrap();

    let profiles = store(&conn).list_terminal_profiles().unwrap();
    assert_eq!(profiles.len(), 1);
    assert_eq!(profiles[0].terminal_id, "t1");
}

#[test]
fn set_profile_remove_locked_screen() {
    let conn = fresh();
    seed_terminal(&conn, "t1", "Front Counter", "dev-1");
    // Set with locked_screen
    store(&conn)
        .set_terminal_profile("t1", "kds_kiosk", Some("kds"))
        .unwrap();
    // Remove locked_screen
    store(&conn)
        .set_terminal_profile("t1", "kds_kiosk", None)
        .unwrap();

    let profile = store(&conn).get_terminal_profile("t1").unwrap().unwrap();
    assert_eq!(profile.profile_type, "kds_kiosk");
    assert!(profile.locked_screen.is_none());
}

#[test]
fn set_profile_updated_timestamp_changes() {
    let conn = fresh();
    seed_terminal(&conn, "t1", "Front Counter", "dev-1");
    store(&conn)
        .set_terminal_profile("t1", "kds_kiosk", None)
        .unwrap();
    let original = store(&conn).get_terminal_profile("t1").unwrap().unwrap();

    // Sleep briefly so timestamp differs
    std::thread::sleep(std::time::Duration::from_millis(2));
    store(&conn)
        .set_terminal_profile("t1", "counter_pos", Some("products"))
        .unwrap();
    let updated = store(&conn).get_terminal_profile("t1").unwrap().unwrap();

    assert_eq!(updated.profile_type, "counter_pos");
    assert_eq!(updated.locked_screen.as_deref(), Some("products"));
    assert_ne!(original.updated_at, updated.updated_at);
}

#[test]
fn list_profiles_ordered_by_terminal_id_asc() {
    let conn = fresh();
    // Create terminals with IDs that sort out of order
    seed_terminal(&conn, "z-terminal", "Z Terminal", "dev-z");
    seed_terminal(&conn, "a-terminal", "A Terminal", "dev-a");
    seed_terminal(&conn, "m-terminal", "M Terminal", "dev-m");
    store(&conn)
        .set_terminal_profile("z-terminal", "kds_kiosk", None)
        .unwrap();
    store(&conn)
        .set_terminal_profile("a-terminal", "counter_pos", None)
        .unwrap();
    store(&conn)
        .set_terminal_profile("m-terminal", "kds_kiosk", Some("kds"))
        .unwrap();

    let profiles = store(&conn).list_terminal_profiles().unwrap();
    assert_eq!(profiles.len(), 3);
    assert_eq!(profiles[0].terminal_id, "a-terminal");
    assert_eq!(profiles[1].terminal_id, "m-terminal");
    assert_eq!(profiles[2].terminal_id, "z-terminal");
}
