//! Tests for the tablet's boot-time restore consumer (`recovery.rs`).
//!
//! Wired from `recovery.rs` as `#[cfg(test)] #[path = "recovery_tests.rs"] mod tests;`.
//!
//! Everything here drives [`consume_pending_restore`] through its single parameter — the
//! live database path — so no Tauri app, window or `AppState` is involved. This matters on
//! this shell in particular: the tablet's `run()` body sits under `#[cfg(not(test))]`, so a
//! test that needed a real boot could not run at all. The candidates are real migrated
//! files built by `kasirmu_core::migrations::run`.
//!
//! These cases are the tablet's copy of the desktop suite (slice S4a). The two shells must
//! not drift into two different recovery semantics, so the assertions are the same contract;
//! the byte-identical check below is stated on the file's own bytes rather than through a
//! re-open, because re-opening the live database is itself a write.

use super::*;
use kasirmu_core::{Store, migrations};
use rusqlite::Connection;
use tempfile::TempDir;

/// A scratch directory removed when the guard drops.
fn scratch(label: &str) -> TempDir {
    tempfile::Builder::new()
        .prefix(&format!("kasirmu_tablet_restore_{label}_"))
        .tempdir()
        .expect("create scratch dir")
}

/// A migrated, on-disk database carrying `store_name`.
fn migrated_db(path: &Path, store_name: &str) {
    let mut conn = Connection::open(path).expect("open database");
    migrations::run(&mut conn).expect("run migrations");
    Store::new(&conn)
        .set_store_name(store_name)
        .expect("set store name");
}

/// The store name a database carries.
fn store_name(path: &Path) -> Option<String> {
    let conn = Connection::open(path).expect("open database");
    Store::new(&conn).get_store_name().expect("read store name")
}

/// Write the request file the bridge's `restore_prepare` writes.
fn write_request(db_path: &Path, candidate: &Path) {
    let request = serde_json::json!({
        "candidate_path": candidate.display().to_string(),
        "requested_at": "2026-01-01T00:00:00.000Z",
        "verdict": "Acceptable",
        "candidate_schema": null,
        "confirmed_store_name": "irrelevant-to-the-boot-path",
    });
    std::fs::write(
        request_path_for(db_path),
        serde_json::to_vec_pretty(&request).expect("encode request"),
    )
    .expect("write request");
}

/// A boot with no request file is the ordinary boot.
#[test]
fn nothing_pending_when_no_request_file_exists() {
    let dir = scratch("nothing");
    let db = dir.path().join("kasir.db");
    migrated_db(&db, "Tablet Store");

    assert_eq!(consume_pending_restore(&db), Outcome::NothingPending);
    assert_eq!(store_name(&db).as_deref(), Some("Tablet Store"));
    assert!(!lock_path_for(&db).exists());
}

/// The happy path: a valid request is consumed, the candidate is promoted, the request is
/// archived and the pre-restore snapshot is left beside the database.
#[test]
fn consumes_a_request_and_restores_the_candidate() {
    let dir = scratch("consume");
    let db = dir.path().join("kasir.db");
    let candidate = dir.path().join("kasir.db.backup.db");
    migrated_db(&db, "Tablet Store");
    migrated_db(&candidate, "Backup Store");
    write_request(&db, &candidate);

    let outcome = consume_pending_restore(&db);

    match outcome {
        Outcome::Restored {
            candidate: restored,
            snapshot,
        } => {
            assert_eq!(restored, candidate);
            assert_eq!(snapshot, pre_restore_snapshot_path(&db));
        }
        other => panic!("expected Restored, got {other:?}"),
    }
    assert_eq!(store_name(&db).as_deref(), Some("Backup Store"));
    assert_eq!(
        store_name(&pre_restore_snapshot_path(&db)).as_deref(),
        Some("Tablet Store"),
        "the pre-restore snapshot must hold the database that was replaced"
    );
    assert!(
        !request_path_for(&db).is_file(),
        "the consumed request must not be left in place for the next boot"
    );
    assert!(
        with_suffix(&request_path_for(&db), ".done").is_file(),
        "the consumed request is archived, not silently dropped"
    );
    assert!(
        !lock_path_for(&db).exists(),
        "a completed restore keeps no boot lock"
    );
}

/// A candidate that no longer validates is never promoted, the request stays put so an
/// operator can see why, and the live database is byte-identical afterwards.
#[test]
fn refuses_a_corrupt_candidate_and_leaves_the_live_file_byte_identical() {
    let dir = scratch("corrupt");
    let db = dir.path().join("kasir.db");
    let candidate = dir.path().join("kasir.db.backup.db");
    migrated_db(&db, "Tablet Store");
    std::fs::write(&candidate, b"this is not a sqlite database at all").expect("write candidate");
    write_request(&db, &candidate);

    // Read the bytes BEFORE the attempt; nothing below re-opens the live database, because
    // opening it is itself a write and would make this assertion vacuous.
    let before = std::fs::read(&db).expect("read live database");

    match consume_pending_restore(&db) {
        Outcome::Refused { reason } => assert!(
            reason.contains("Corrupt"),
            "the refusal must name the verdict, got: {reason}"
        ),
        other => panic!("expected Refused, got {other:?}"),
    }

    let after = std::fs::read(&db).expect("read live database");
    assert_eq!(
        before, after,
        "a refused restore must leave the live database byte-identical"
    );
    assert!(
        request_path_for(&db).is_file(),
        "a refusal leaves the request in place for the operator"
    );
    assert!(
        !lock_path_for(&db).exists(),
        "a refused claim is released so the next boot retries"
    );
}

/// A request naming a missing candidate is refused, not a panic.
#[test]
fn refuses_a_candidate_that_is_gone() {
    let dir = scratch("gone");
    let db = dir.path().join("kasir.db");
    migrated_db(&db, "Tablet Store");
    write_request(&db, &dir.path().join("never-existed.db"));

    assert!(matches!(
        consume_pending_restore(&db),
        Outcome::Refused { .. }
    ));
    assert_eq!(store_name(&db).as_deref(), Some("Tablet Store"));
}

/// An unparseable request is refused and left alone.
#[test]
fn refuses_an_unreadable_request() {
    let dir = scratch("unreadable");
    let db = dir.path().join("kasir.db");
    migrated_db(&db, "Tablet Store");
    std::fs::write(request_path_for(&db), b"{ not json").expect("write request");

    assert!(matches!(
        consume_pending_restore(&db),
        Outcome::Refused { .. }
    ));
    assert!(request_path_for(&db).is_file());
}

/// A relative candidate path is refused: the request file is untrusted input, and a
/// relative path would resolve against whatever working directory the app was started in.
#[test]
fn refuses_a_relative_candidate_path() {
    let dir = scratch("relative");
    let db = dir.path().join("kasir.db");
    migrated_db(&db, "Tablet Store");
    let request = serde_json::json!({ "candidate_path": "kasir.db.backup.db" });
    std::fs::write(
        request_path_for(&db),
        serde_json::to_vec(&request).expect("encode request"),
    )
    .expect("write request");

    match consume_pending_restore(&db) {
        Outcome::Refused { reason } => assert!(
            reason.contains("relative"),
            "the refusal must say why, got: {reason}"
        ),
        other => panic!("expected Refused, got {other:?}"),
    }
    assert_eq!(store_name(&db).as_deref(), Some("Tablet Store"));
}

/// A second boot cannot claim a request the first already holds.
#[test]
fn refuses_a_double_boot_holding_the_lock() {
    let dir = scratch("double");
    let db = dir.path().join("kasir.db");
    let candidate = dir.path().join("kasir.db.backup.db");
    migrated_db(&db, "Tablet Store");
    migrated_db(&candidate, "Backup Store");
    write_request(&db, &candidate);
    std::fs::write(lock_path_for(&db), b"held by another boot").expect("write lock");

    assert_eq!(consume_pending_restore(&db), Outcome::AlreadyClaimed);
    assert_eq!(
        store_name(&db).as_deref(),
        Some("Tablet Store"),
        "the losing boot must not swap the database"
    );
    assert!(request_path_for(&db).is_file());
}

/// Consuming the same request twice is not a second restore.
#[test]
fn a_consumed_request_is_not_consumed_again() {
    let dir = scratch("twice");
    let db = dir.path().join("kasir.db");
    let candidate = dir.path().join("kasir.db.backup.db");
    migrated_db(&db, "Tablet Store");
    migrated_db(&candidate, "Backup Store");
    write_request(&db, &candidate);

    assert!(matches!(
        consume_pending_restore(&db),
        Outcome::Restored { .. }
    ));
    assert_eq!(consume_pending_restore(&db), Outcome::NothingPending);
    assert_eq!(store_name(&db).as_deref(), Some("Backup Store"));
}
