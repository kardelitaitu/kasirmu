//! The restore gate's schema-level read: an ABSENT `schema_migrations` table
//! and an UNREADABLE one must not collapse into the same verdict.
//!
//! `applied_migration_ids` reads the candidate's applied migration ids, and
//! the whole point of `validate_candidate` is to refuse a candidate this build
//! cannot run. If a row's `id` cannot decode as TEXT, the gate must refuse the
//! candidate — not read it as "no migrations applied", the oldest state, which
//! is restorable and would put an unjudged file over the live database.
use super::*;

/// A scratch directory removed when the guard drops.
struct Scratch(PathBuf);

impl Scratch {
    fn new(label: &str) -> Self {
        let dir = std::env::temp_dir().join(format!(
            "oz_restore_gate_{label}_{}",
            uuid::Uuid::now_v7()
        ));
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

/// A valid SQLite file whose `schema_migrations.id` holds a BLOB, so
/// `row.get::<_, String>(0)` fails on every row.
///
/// The file passes `PRAGMA integrity_check` — this is not a corrupt page
/// structure, it is a value the gate cannot judge.
fn candidate_with_unreadable_migration(path: &Path) {
    let conn = Connection::open(path).unwrap();
    conn.execute_batch(
        "CREATE TABLE schema_migrations (id BLOB NOT NULL);
         INSERT INTO schema_migrations (id) VALUES (x'deadbeef');",
    )
    .unwrap();
}

/// A candidate the gate cannot read must be refused, never treated as the
/// oldest restorable state.
///
/// `applied_migration_ids` read the ids with `rows.filter_map(Result::ok)`, so
/// an undecodable row was dropped. With every row dropped the set was empty,
/// `newest_dated_id` returned `None`, and the verdict fell into the
/// `(None, _)` arm — `OlderButAcceptable`, i.e. RESTORABLE. A newer candidate
/// whose ids cannot be read could therefore be written over the live database,
/// which is exactly the boot-brick path the gate exists to close.
#[test]
fn validate_candidate_refuses_a_candidate_whose_migration_rows_cannot_be_read() {
    let s = Scratch::new("unreadable_migrations");
    let candidate = s.join("candidate.db");
    candidate_with_unreadable_migration(&candidate);

    let report = validate_candidate(&candidate);

    // RED before the fix: OlderButAcceptable, so `is_restorable()` was true.
    // GREEN after: the read failure refuses the candidate.
    assert!(
        !report.verdict.is_restorable(),
        "an unreadable schema_migrations must not be restorable, got {:?}: {}",
        report.verdict,
        report.reason
    );
    assert_eq!(report.verdict, CandidateVerdict::Corrupt);
}

/// The documented behavior survives: a file with NO `schema_migrations` table
/// is the oldest possible state (a pre-migration snapshot) and stays
/// restorable. Absence must not be turned into a refusal.
#[test]
fn validate_candidate_treats_a_missing_migration_table_as_the_oldest_state() {
    let s = Scratch::new("no_migrations_table");
    let candidate = s.join("candidate.db");
    {
        let conn = Connection::open(&candidate).unwrap();
        conn.execute_batch("CREATE TABLE unrelated (id INTEGER);")
            .unwrap();
    }

    let report = validate_candidate(&candidate);

    assert_eq!(
        report.verdict,
        CandidateVerdict::OlderButAcceptable,
        "a table-less candidate must stay the documented oldest state: {}",
        report.reason
    );
    assert!(report.verdict.is_restorable());
}

/// A well-formed candidate still resolves to its newest date-shaped id, so the
/// hardening does not break the ordinary read.
#[test]
fn validate_candidate_still_reads_a_well_formed_migration_table() {
    let s = Scratch::new("well_formed");
    let candidate = s.join("candidate.db");
    {
        let conn = Connection::open(&candidate).unwrap();
        conn.execute_batch(
            "CREATE TABLE schema_migrations (id TEXT NOT NULL);
             INSERT INTO schema_migrations (id) VALUES ('20200101_seed');",
        )
        .unwrap();
    }

    let report = validate_candidate(&candidate);

    assert_eq!(report.verdict, CandidateVerdict::OlderButAcceptable);
    assert_eq!(report.candidate_schema.as_deref(), Some("20200101_seed"));
}
