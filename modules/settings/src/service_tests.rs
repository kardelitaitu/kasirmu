use super::*;
use rusqlite::Connection;

fn fresh() -> Connection {
    kasirmu_core::migrations::fresh_db()
}

#[test]
fn get_returns_none_for_missing() {
    let conn = fresh();
    assert!(SettingsService::get(&conn, "missing").unwrap().is_none());
}

#[test]
fn set_and_get_roundtrip() {
    let conn = fresh();
    SettingsService::set(&conn, "color", "blue").unwrap();
    let val = SettingsService::get(&conn, "color").unwrap().unwrap();
    assert_eq!(val, "blue");
}

#[test]
fn set_overwrites() {
    let conn = fresh();
    SettingsService::set(&conn, "k", "old").unwrap();
    SettingsService::set(&conn, "k", "new").unwrap();
    assert_eq!(SettingsService::get(&conn, "k").unwrap().unwrap(), "new");
}
