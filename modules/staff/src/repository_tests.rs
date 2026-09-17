use super::*;
use rusqlite::Connection;

fn fresh() -> Connection {
    kasirmu_core::migrations::fresh_db()
}

fn seed_role(conn: &Connection, id: &str, name: &str, permissions: &str) {
    conn.execute(
        "INSERT INTO roles (id, name, description, permissions) VALUES (?1, ?2, '', ?3)",
        rusqlite::params![id, name, permissions],
    )
    .unwrap();
}

fn seed_user(conn: &Connection, id: &str, username: &str, role_id: &str) {
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active) VALUES (?1, ?2, 'hash', ?1, ?3, 1)",
        rusqlite::params![id, username, role_id],
    )
    .unwrap();
}

#[test]
fn get_user_returns_none_for_missing() {
    let conn = fresh();
    let repo = StaffRepository::new(&conn);
    assert!(repo.get_user("nope").unwrap().is_none());
}

#[test]
fn get_user_roundtrip() {
    let conn = fresh();
    seed_role(&conn, "role-1", "admin", r#"["*"]"#);
    seed_user(&conn, "u-1", "alice", "role-1");
    let repo = StaffRepository::new(&conn);

    let user = repo.get_user("u-1").unwrap().unwrap();
    assert_eq!(user.username, "alice");
    assert_eq!(user.role_id, "role-1");
    assert!(user.is_active);
}

#[test]
fn get_user_inactive() {
    let conn = fresh();
    seed_role(&conn, "role-1", "admin", "[]");
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active) VALUES ('u-2', 'bob', 'hash', 'Bob', 'role-1', 0)",
        [],
    )
    .unwrap();
    let repo = StaffRepository::new(&conn);
    let user = repo.get_user("u-2").unwrap().unwrap();
    assert!(!user.is_active);
}

#[test]
fn get_role_returns_none_for_missing() {
    let conn = fresh();
    let repo = StaffRepository::new(&conn);
    assert!(repo.get_role("nope").unwrap().is_none());
}

#[test]
fn get_role_roundtrip() {
    let conn = fresh();
    seed_role(&conn, "role-1", "cashier", r#"["sales:process"]"#);
    let repo = StaffRepository::new(&conn);

    let role = repo.get_role("role-1").unwrap().unwrap();
    assert_eq!(role.name, "cashier");
    assert_eq!(role.permissions, r#"["sales:process"]"#);
}
