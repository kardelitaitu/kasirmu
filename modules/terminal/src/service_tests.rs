use super::*;
use rusqlite::Connection;

fn fresh() -> Connection {
    kasirmu_core::migrations::fresh_db()
}

#[test]
fn get_terminal_delegates_to_repository() {
    let conn = fresh();
    conn.execute(
        "INSERT INTO terminals (id, name, device_id, is_active) VALUES ('t-1', 'POS-1', 'dev-1', 1)",
        [],
    )
    .unwrap();
    let t = TerminalService::get_terminal(&conn, "t-1")
        .unwrap()
        .unwrap();
    assert_eq!(t.name, "POS-1");
}

#[test]
fn get_terminal_missing_returns_none() {
    let conn = fresh();
    assert!(
        TerminalService::get_terminal(&conn, "nope")
            .unwrap()
            .is_none()
    );
}
