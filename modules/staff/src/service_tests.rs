use super::*;
use rusqlite::Connection;

fn fresh() -> Connection {
    kasirmu_core::migrations::fresh_db()
}

#[test]
fn get_user_delegates_to_repository() {
    let conn = fresh();
    conn.execute(
        "INSERT INTO roles (id, name, description, permissions) VALUES ('r-1', 'admin', '', '[]')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active) VALUES ('u-1', 'alice', 'hash', 'Alice', 'r-1', 1)",
        [],
    )
    .unwrap();
    let user = StaffService::get_user(&conn, "u-1").unwrap().unwrap();
    assert_eq!(user.username, "alice");
}

#[test]
fn get_user_missing_returns_none() {
    let conn = fresh();
    assert!(StaffService::get_user(&conn, "nope").unwrap().is_none());
}

#[test]
fn get_role_delegates_to_repository() {
    let conn = fresh();
    conn.execute(
        "INSERT INTO roles (id, name, description, permissions) VALUES ('r-1', 'manager', 'Can manage', '[]')",
        [],
    )
    .unwrap();
    let role = StaffService::get_role(&conn, "r-1").unwrap().unwrap();
    assert_eq!(role.name, "manager");
}

#[test]
fn get_role_missing_returns_none() {
    let conn = fresh();
    assert!(StaffService::get_role(&conn, "nope").unwrap().is_none());
}
