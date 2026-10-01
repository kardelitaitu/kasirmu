//! Tests for KDS device registration and status.
//!
//! Coverage: registration (unique-name guard, field round-trip), lookup,
//! status updates, and soft deactivation. Lives in a sibling file per repo
//! convention (no unit tests in production files).
//!
//! **What used to be here.** This file was 273 lines of pairing-token tests
//! (constant-time hash comparison, fail-closed expiry parsing, bare-date
//! tolerance, single-use consumption). All of it covered a credential no code
//! ever verified — see `20261014_kds_drop_pairing_tokens.sql`. Those tests
//! are deleted with the columns rather than kept green against a function
//! nobody calls: a test is evidence about the code, and 273 lines of it was
//! making a removed feature look maintained.

use super::*;
use crate::kds::RegisterKdsDeviceInput;

fn fresh() -> rusqlite::Connection {
    crate::migrations::fresh_db()
}

fn store(conn: &rusqlite::Connection) -> Store<'_> {
    Store::new(conn)
}

/// Seed the owning Restaurant POS: `restaurant_pos_id` is a real FK.
fn seed_pos(conn: &rusqlite::Connection) {
    conn.execute(
        "INSERT OR IGNORE INTO terminals (id, name, device_id, is_active) VALUES ('pos-1', 'POS 1', 'dev-pos-1', 1)",
        [],
    )
    .unwrap();
}

fn input(name: &str, stations: Vec<&str>) -> RegisterKdsDeviceInput {
    RegisterKdsDeviceInput {
        name: name.into(),
        restaurant_pos_id: "pos-1".into(),
        station_ids: stations.into_iter().map(String::from).collect(),
    }
}

#[test]
fn register_stores_the_device_and_returns_it() {
    let conn = fresh();
    seed_pos(&conn);
    let device = store(&conn)
        .register_kds_device(input("Grill", vec!["station-grill"]))
        .unwrap();

    assert_eq!(device.name, "Grill");
    assert_eq!(device.restaurant_pos_id, "pos-1");
    assert_eq!(device.station_ids, vec!["station-grill".to_string()]);
    assert!(device.is_active, "a freshly registered device is active");
    assert!(device.last_seen_at.is_none(), "it has never connected");
}

#[test]
fn register_round_trips_through_the_database() {
    // The read path must see what the write path stored — the station list
    // especially, since it is serialized as JSON in one column and a mapping
    // mistake there would silently produce an empty (broadcast) device.
    let conn = fresh();
    seed_pos(&conn);
    let created = store(&conn)
        .register_kds_device(input("Expo", vec!["station-hot", "station-cold"]))
        .unwrap();

    let fetched = store(&conn).get_kds_device(&created.id).unwrap().unwrap();
    assert_eq!(fetched.station_ids, created.station_ids);
    assert_eq!(fetched.name, created.name);
}

#[test]
fn register_rejects_a_duplicate_name_for_the_same_pos() {
    let conn = fresh();
    seed_pos(&conn);
    let s = store(&conn);
    s.register_kds_device(input("Grill", vec![])).unwrap();

    let err = s
        .register_kds_device(input("Grill", vec![]))
        .expect_err("a duplicate name under one POS must be refused");
    assert!(
        matches!(err, CoreError::Validation { field, .. } if field == "name"),
        "got: {err:?}"
    );
}

#[test]
fn register_allows_the_same_name_under_a_different_pos() {
    // The uniqueness rule is per owning POS, not global: two shops may each
    // have a "Grill" screen without colliding.
    let conn = fresh();
    seed_pos(&conn);
    conn.execute(
        "INSERT OR IGNORE INTO terminals (id, name, device_id, is_active) VALUES ('pos-2', 'POS 2', 'dev-pos-2', 1)",
        [],
    )
    .unwrap();

    let s = store(&conn);
    s.register_kds_device(input("Grill", vec![])).unwrap();
    let mut second = input("Grill", vec![]);
    second.restaurant_pos_id = "pos-2".into();
    s.register_kds_device(second)
        .expect("the same name under a different POS is not a duplicate");
}

#[test]
fn an_empty_station_list_means_broadcast_mode() {
    // Documented semantics: an empty list is not an error, it is "show
    // everything" (the Expo surface).
    let conn = fresh();
    seed_pos(&conn);
    let device = store(&conn)
        .register_kds_device(input("Expo", vec![]))
        .unwrap();
    assert!(device.station_ids.is_empty());
}

#[test]
fn update_status_writes_the_new_connection_state() {
    let conn = fresh();
    seed_pos(&conn);
    let s = store(&conn);
    let device = s.register_kds_device(input("Grill", vec![])).unwrap();

    s.update_kds_device_status(&device.id, KdsConnectionStatus::Connected)
        .unwrap();

    let fetched = s.get_kds_device(&device.id).unwrap().unwrap();
    assert_eq!(fetched.connection_status, KdsConnectionStatus::Connected);
}

#[test]
fn deactivate_is_soft_and_keeps_the_row() {
    // Soft by design: a deactivated screen keeps its identity and station
    // binding so it can be brought back without re-registering.
    let conn = fresh();
    seed_pos(&conn);
    let s = store(&conn);
    let device = s.register_kds_device(input("Grill", vec![])).unwrap();

    s.deactivate_kds_device(&device.id).unwrap();

    let fetched = s
        .get_kds_device(&device.id)
        .unwrap()
        .expect("the row must still exist after deactivation");
    assert!(
        !fetched.is_active,
        "deactivation flips the flag, not the row"
    );
}

#[test]
fn get_returns_none_for_an_unknown_device() {
    let conn = fresh();
    assert!(store(&conn).get_kds_device("nobody").unwrap().is_none());
}

// ── A corrupt station list must not become the broadcast sentinel ──────
//
// An `station_ids` value that cannot be parsed used to be
// `unwrap_or_default()`-ed, and the empty vec is NOT a neutral default here:
// `resolve_targets_by_station` Phase 2 (kds.rs) gives a device with empty
// `station_ids` EVERY order — it is the Expo "see everything" sentinel. So a
// station-scoped screen whose column is unreadable silently escalated to a
// broadcast screen. Contrast `connection_status` just below, whose
// `.unwrap_or(Disconnected)` is safe because it defaults to the NARROW end of
// that enum. Fail closed: surface the decode failure instead of widening the
// device's scope.

/// Corrupt a device's `station_ids` in place — the only way this column is
/// ever unreadable (`register_kds_device` always serializes a valid array).
fn corrupt_station_ids(conn: &rusqlite::Connection, id: &str) {
    conn.execute(
        "UPDATE kds_devices SET station_ids = 'not-a-json-array' WHERE id = ?1",
        rusqlite::params![id],
    )
    .unwrap();
}

#[test]
fn a_corrupt_station_list_is_refused_by_the_lookup() {
    let conn = fresh();
    seed_pos(&conn);
    let s = store(&conn);
    let device = s
        .register_kds_device(input("Grill", vec!["station-grill"]))
        .unwrap();
    corrupt_station_ids(&conn, &device.id);

    let err = s
        .get_kds_device(&device.id)
        .expect_err("an unreadable station list must not read as broadcast mode");
    assert!(
        format!("{err:?}").contains("station_ids") || matches!(err, CoreError::Db(_)),
        "the refusal must name the station list, got: {err:?}"
    );
}

#[test]
fn a_corrupt_station_list_is_refused_by_the_listing() {
    let conn = fresh();
    seed_pos(&conn);
    let s = store(&conn);
    let device = s
        .register_kds_device(input("Grill", vec!["station-grill"]))
        .unwrap();
    corrupt_station_ids(&conn, &device.id);

    // Routing reads the listing; a silently-empty device here would be
    // targeted for every order by Phase 2.
    let listed = s.list_kds_devices_for_restaurant("pos-1");
    assert!(
        listed.is_err(),
        "the listing must surface the corrupt row rather than return it as an Expo device, got: {listed:?}"
    );
}
