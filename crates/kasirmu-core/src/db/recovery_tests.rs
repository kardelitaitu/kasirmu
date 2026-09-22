//! Backup durability tests for `db/mod.rs` (checklist C8, decision D5).
//!
//! The backup path is the only recovery artefact a merchant has, so the
//! invariants under test are the ones that decide whether a failed backup can
//! cost them their data:
//!
//! * a successful backup promotes an integrity-clean snapshot and keeps the
//!   previous one as generation 1 (`<db>.backup.1.db`);
//! * a copy that fails leaves the pre-existing destination BYTE-IDENTICAL and
//!   drops no temporary file;
//! * four backups leave exactly [`BACKUP_GENERATIONS`] generations, the newest
//!   at the destination;
//! * a destination that exists and is not a file is a typed error (the RUST-03
//!   semantics `tests/backup_restore_integration.rs` pins).
//!
//! Wired from `mod.rs` as `#[cfg(test)] #[path = "recovery_tests.rs"] mod recovery_tests;`
//! — not `mod tests`, which `mod_tests.rs` already occupies.

use super::*;
use crate::migrations;
use rusqlite::Connection;
use std::path::Path;

const MARKER: &str = "recovery.marker";

fn store(conn: &Connection) -> Store<'_> {
    Store::new(conn)
}

/// A scratch directory removed when the returned guard drops, so a failed
/// assertion cannot leave fixtures behind for the next run.
struct Scratch(std::path::PathBuf);

impl Scratch {
    fn new(label: &str) -> Self {
        let dir =
            std::env::temp_dir().join(format!("oz_recovery_{label}_{}", uuid::Uuid::now_v7()));
        std::fs::create_dir_all(&dir).unwrap();
        Self(dir)
    }

    fn join(&self, name: &str) -> std::path::PathBuf {
        self.0.join(name)
    }

    fn entries(&self) -> Vec<String> {
        std::fs::read_dir(&self.0)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect()
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Open a snapshot, assert it passes `PRAGMA integrity_check`, and return the
/// marker value it carries.
fn verified_marker(path: &Path) -> String {
    let conn = Connection::open(path).unwrap();
    let s = store(&conn);
    s.check_integrity()
        .unwrap_or_else(|e| panic!("snapshot {} is not integrity-clean: {e}", path.display()));
    conn.query_row("SELECT value FROM settings WHERE key = ?1", [MARKER], |r| {
        r.get::<_, String>(0)
    })
    .unwrap_or_else(|e| {
        panic!(
            "snapshot {} ({} bytes) carries no marker: {e}",
            path.display(),
            std::fs::metadata(path).map(|m| m.len()).unwrap_or(0)
        )
    })
}

fn bytes(path: &Path) -> Vec<u8> {
    std::fs::read(path).unwrap()
}

/* ── promotion + rotation ───────────────────────────────────────── */

#[test]
fn recovery_successful_backup_verifies_and_keeps_previous_generation() {
    let scratch = Scratch::new("promote");
    let destination = scratch.join("store.backup.db");
    let conn = migrations::fresh_db();
    let s = store(&conn);

    s.set_setting(MARKER, "first").unwrap();
    s.backup(&destination.to_string_lossy()).unwrap();
    assert_eq!(verified_marker(&destination), "first");
    assert!(
        !scratch.join("store.backup.1.db").exists(),
        "the first backup has no previous generation to rotate"
    );

    // Second backup over the same destination: the snapshot must be promoted
    // and the first one must survive as generation 1, still readable.
    s.set_setting(MARKER, "second").unwrap();
    s.backup(&destination.to_string_lossy()).unwrap();

    assert_eq!(verified_marker(&destination), "second");
    let previous = scratch.join("store.backup.1.db");
    assert!(previous.exists(), "the previous snapshot must be kept");
    assert_eq!(
        verified_marker(&previous),
        "first",
        "generation 1 must be the snapshot replaced by this backup"
    );

    // No temporary file survives a successful backup.
    let leftovers: Vec<String> = scratch
        .entries()
        .into_iter()
        .filter(|n| n.contains(".tmp-"))
        .collect();
    assert!(
        leftovers.is_empty(),
        "temp files left behind: {leftovers:?}"
    );
}

#[test]
fn recovery_four_backups_keep_exactly_three_generations() {
    let scratch = Scratch::new("generations");
    let destination = scratch.join("store.backup.db");
    let conn = migrations::fresh_db();
    let s = store(&conn);

    for round in 0..4 {
        s.set_setting(MARKER, &format!("round-{round}")).unwrap();
        s.backup(&destination.to_string_lossy()).unwrap();
    }

    assert_eq!(verified_marker(&destination), "round-3");
    assert_eq!(
        verified_marker(&scratch.join("store.backup.1.db")),
        "round-2"
    );
    assert_eq!(
        verified_marker(&scratch.join("store.backup.2.db")),
        "round-1"
    );
    assert_eq!(
        BACKUP_GENERATIONS, 3,
        "three generations is the contract this test pins"
    );
    assert!(
        !scratch.join("store.backup.3.db").exists(),
        "the fourth backup must drop the oldest generation, not accumulate"
    );
}

/* ── failure never destroys the previous snapshot ───────────────── */

#[test]
fn recovery_failed_copy_leaves_destination_byte_identical() {
    let scratch = Scratch::new("copy-failure");
    let destination = scratch.join("store.backup.db");

    // A good first backup, plus one generation, so both are at risk if the
    // failing path rotates or truncates the destination.
    let conn = migrations::fresh_db();
    let s = store(&conn);
    s.set_setting(MARKER, "first").unwrap();
    s.backup(&destination.to_string_lossy()).unwrap();
    s.set_setting(MARKER, "second").unwrap();
    s.backup(&destination.to_string_lossy()).unwrap();

    let before = bytes(&destination);
    let before_gen1 = bytes(&scratch.join("store.backup.1.db"));

    // A source that is not a SQLite database fails inside the copy step —
    // the deterministic stand-in for a full disk or a crash mid-copy, and
    // platform-independent, unlike a read-only directory on Windows.
    let bogus = scratch.join("not-a-database.db");
    std::fs::write(&bogus, b"not a sqlite database, deliberately").unwrap();
    let bogus_conn = Connection::open(&bogus).unwrap();
    let result = store(&bogus_conn).backup(&destination.to_string_lossy());

    assert!(
        result.is_err(),
        "backing up a non-database source must fail"
    );
    assert_eq!(
        bytes(&destination),
        before,
        "a failed backup must leave the destination byte-identical"
    );
    assert_eq!(
        bytes(&scratch.join("store.backup.1.db")),
        before_gen1,
        "a failed backup must not rotate the older generation"
    );
    assert_eq!(verified_marker(&destination), "second");
    let leftovers: Vec<String> = scratch
        .entries()
        .into_iter()
        .filter(|n| n.contains(".tmp-"))
        .collect();
    assert!(
        leftovers.is_empty(),
        "temp files left behind: {leftovers:?}"
    );
}

#[test]
fn recovery_directory_destination_is_a_typed_error() {
    // RUST-03, kept by the destination guard: a destination that exists and is
    // not a file must error rather than be silently replaced.
    let scratch = Scratch::new("dir-target");
    let destination = scratch.join("store.backup.db");
    std::fs::create_dir_all(&destination).unwrap();

    let conn = migrations::fresh_db();
    let err = store(&conn)
        .backup(&destination.to_string_lossy())
        .expect_err("a directory destination must fail");
    let msg = err.to_string();
    assert!(
        msg.contains("not a file"),
        "the error must name the real cause: {msg}"
    );
    assert!(destination.is_dir(), "the directory must be left alone");
}
