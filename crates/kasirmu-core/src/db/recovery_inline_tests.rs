//! Tests for `recovery.rs` — restore validation and the atomic swap.
//!
//! CORE-B: these cases used to live inline in `recovery.rs`. They are moved
//! here to follow the house convention (tests in a sibling `*_tests.rs` wired
//! with `#[path]`), which is what the other 150+ production files in this
//! crate do. They do NOT overlap `recovery_tests.rs` (wired from `db/mod.rs`),
//! which covers backup-generation rotation.

use super::*;

/// A scratch directory removed when the guard drops.
struct Scratch(PathBuf);

impl Scratch {
    fn new(label: &str) -> Self {
        let dir =
            std::env::temp_dir().join(format!("oz_restore_{label}_{}", uuid::Uuid::now_v7()));
        std::fs::create_dir_all(&dir).unwrap();
        Self(dir)
    }

    fn join(&self, name: &str) -> PathBuf {
        self.0.join(name)
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn sha256(path: &Path) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(std::fs::read(path).unwrap());
    hex::encode(hasher.finalize())
}

/// A migrated file-backed database carrying one marker row.
fn live_db(path: &Path, marker: &str) {
    let mut conn = Connection::open(path).unwrap();
    migrations::run(&mut conn).unwrap();
    Store::new(&conn)
        .set_setting("restore.marker", marker)
        .unwrap();
}

fn marker(path: &Path) -> String {
    let conn = Connection::open(path).unwrap();
    conn.query_row(
        "SELECT value FROM settings WHERE key = 'restore.marker'",
        [],
        |r| r.get(0),
    )
    .unwrap()
}

fn hot_sidecars(db_path: &Path) {
    std::fs::write(sidecar_path(db_path, "-wal"), b"hot wal frames").unwrap();
    std::fs::write(sidecar_path(db_path, "-shm"), b"hot shm").unwrap();
}

#[test]
fn recovery_valid_candidate_is_accepted_and_restored() {
    let scratch = Scratch::new("accept");
    let live = scratch.join("live.db");
    let candidate = scratch.join("candidate.db");
    live_db(&live, "live");
    live_db(&candidate, "candidate");

    let report = validate_candidate(&candidate);
    assert_eq!(
        report.verdict,
        CandidateVerdict::Acceptable,
        "{}",
        report.reason
    );
    assert!(report.verdict.is_restorable());

    let outcome = restore_from(&candidate, &live).unwrap();
    assert!(outcome.verdict.is_restorable());
    assert_eq!(
        marker(&live),
        "candidate",
        "the live database must be the candidate's"
    );

    // The pre-restore snapshot survives and holds the pre-restore content.
    let snapshot = pre_restore_snapshot_path(&live);
    assert!(
        snapshot.exists(),
        "the pre-restore snapshot must be present"
    );
    assert_eq!(marker(&snapshot), "live");

    // The restored database is integrity-clean.
    verify_file(&live).unwrap();
}

#[test]
fn recovery_corrupt_candidate_is_refused_and_leaves_live_db_and_sidecars_untouched() {
    let scratch = Scratch::new("corrupt");
    let live = scratch.join("live.db");
    let candidate = scratch.join("corrupt.db");
    live_db(&live, "live");
    hot_sidecars(&live);
    std::fs::write(&candidate, b"not a sqlite database, deliberately").unwrap();

    let report = validate_candidate(&candidate);
    assert_eq!(
        report.verdict,
        CandidateVerdict::Corrupt,
        "{}",
        report.reason
    );
    assert!(!report.verdict.is_restorable());

    let before = sha256(&live);
    let err = restore_from(&candidate, &live).unwrap_err().to_string();
    assert!(
        err.contains("refusing"),
        "error must name the refusal: {err}"
    );

    assert_eq!(
        sha256(&live),
        before,
        "a refused restore must not touch the live database"
    );
    // Assert the sidecars BEFORE opening the live database: SQLite
    // recovers (and removes) a hot WAL as a side effect of opening it.
    for extension in ["-wal", "-shm"] {
        let sidecar = sidecar_path(&live, extension);
        assert!(
            sidecar.exists(),
            "sidecar {extension} must survive a refused restore"
        );
    }
    assert_eq!(marker(&live), "live");
    assert!(
        !pre_restore_snapshot_path(&live).exists(),
        "a refused restore must not even snapshot"
    );
}

#[test]
fn recovery_newer_than_build_candidate_is_refused_with_the_newer_reason() {
    let scratch = Scratch::new("newer");
    let live = scratch.join("live.db");
    let candidate = scratch.join("from-the-future.db");
    live_db(&live, "live");
    live_db(&candidate, "future");
    {
        let conn = Connection::open(&candidate).unwrap();
        conn.execute(
            "INSERT INTO schema_migrations (id) VALUES ('29990101_from_the_future.sql')",
            [],
        )
        .unwrap();
    }

    let report = validate_candidate(&candidate);
    assert_eq!(
        report.verdict,
        CandidateVerdict::NewerThanThisBuild,
        "{}",
        report.reason
    );
    assert!(
        report.reason.contains("newer than this build"),
        "reason must say why: {}",
        report.reason
    );
    assert_eq!(
        report.candidate_schema.as_deref(),
        Some("29990101_from_the_future.sql")
    );

    let before = sha256(&live);
    assert!(
        restore_from(&candidate, &live).is_err(),
        "a newer candidate must never reach the live database"
    );
    assert_eq!(
        sha256(&live),
        before,
        "the live database must be byte-identical"
    );
}

#[test]
fn recovery_older_candidate_is_acceptable() {
    let scratch = Scratch::new("older");
    let candidate = scratch.join("older.db");
    live_db(&candidate, "older");
    {
        let conn = Connection::open(&candidate).unwrap();
        conn.execute_batch("DELETE FROM schema_migrations").unwrap();
    }

    let report = validate_candidate(&candidate);
    assert_eq!(
        report.verdict,
        CandidateVerdict::OlderButAcceptable,
        "{}",
        report.reason
    );
}
