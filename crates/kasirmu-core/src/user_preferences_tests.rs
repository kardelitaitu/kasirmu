use super::*;
use crate::migrations;
use rusqlite::Connection;

fn setup_db() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    migrations::run(&mut conn).unwrap();
    conn
}

#[test]
fn get_all_returns_empty_for_new_user() {
    let conn = setup_db();
    let prefs = UserPreferences::get_all(&conn, "user-1").unwrap();
    assert!(prefs.is_empty());
}

#[test]
fn set_batch_stores_and_retrieves_preferences() {
    let conn = setup_db();
    let user_id = "user-1";

    UserPreferences::set_batch(
        &conn,
        user_id,
        &[
            ("card_size".into(), "large".into()),
            ("font_size".into(), "14".into()),
        ],
    )
    .unwrap();

    let prefs = UserPreferences::get_all(&conn, user_id).unwrap();
    assert_eq!(prefs.len(), 2);
    assert_eq!(prefs.get("card_size").unwrap(), "large");
    assert_eq!(prefs.get("font_size").unwrap(), "14");
}

#[test]
fn set_batch_upserts_existing_keys() {
    let conn = setup_db();
    let user_id = "user-1";

    // Insert initial preferences.
    UserPreferences::set_batch(&conn, user_id, &[("theme".into(), "dark".into())]).unwrap();

    // Update the same key.
    UserPreferences::set_batch(&conn, user_id, &[("theme".into(), "light".into())]).unwrap();

    let prefs = UserPreferences::get_all(&conn, user_id).unwrap();
    assert_eq!(prefs.len(), 1);
    assert_eq!(prefs.get("theme").unwrap(), "light");
}

#[test]
fn preferences_are_scoped_per_user() {
    let conn = setup_db();

    UserPreferences::set_batch(&conn, "user-a", &[("lang".into(), "en".into())]).unwrap();

    UserPreferences::set_batch(&conn, "user-b", &[("lang".into(), "id".into())]).unwrap();

    let prefs_a = UserPreferences::get_all(&conn, "user-a").unwrap();
    let prefs_b = UserPreferences::get_all(&conn, "user-b").unwrap();
    assert_eq!(prefs_a.get("lang").unwrap(), "en");
    assert_eq!(prefs_b.get("lang").unwrap(), "id");
}

#[test]
fn set_batch_empty_is_noop() {
    let conn = setup_db();
    let result = UserPreferences::set_batch(&conn, "user-1", &[]);
    assert!(result.is_ok(), "empty batch should not error");
    let prefs = UserPreferences::get_all(&conn, "user-1").unwrap();
    assert!(prefs.is_empty());
}

#[test]
fn set_batch_mixes_inserts_and_updates_in_one_call() {
    // The realistic save: a settings screen submits the whole form, so
    // one batch carries keys that already exist alongside brand-new
    // ones. Both arms of the UPSERT run in the same transaction.
    let conn = setup_db();
    UserPreferences::set_batch(
        &conn,
        "user-1",
        &[
            ("card_size".into(), "large".into()),
            ("theme".into(), "dark".into()),
        ],
    )
    .unwrap();

    UserPreferences::set_batch(
        &conn,
        "user-1",
        &[
            ("theme".into(), "light".into()),  // update
            ("locale".into(), "id-ID".into()), // insert
        ],
    )
    .unwrap();

    let prefs = UserPreferences::get_all(&conn, "user-1").unwrap();
    assert_eq!(prefs.len(), 3, "one update, one insert, one untouched");
    assert_eq!(prefs.get("theme").unwrap(), "light");
    assert_eq!(prefs.get("locale").unwrap(), "id-ID");
    assert_eq!(prefs.get("card_size").unwrap(), "large");
}

#[test]
fn set_batch_with_a_duplicate_key_in_one_batch_keeps_the_last_value() {
    // A merged preference map can carry the same key twice. ON CONFLICT
    // DO UPDATE makes this last-write-wins rather than an error, and the
    // row count must stay at one.
    let conn = setup_db();
    UserPreferences::set_batch(
        &conn,
        "user-1",
        &[
            ("font_size".into(), "12".into()),
            ("font_size".into(), "18".into()),
        ],
    )
    .unwrap();

    let prefs = UserPreferences::get_all(&conn, "user-1").unwrap();
    assert_eq!(prefs.len(), 1, "the duplicate must update, not add a row");
    assert_eq!(prefs.get("font_size").unwrap(), "18");
}
