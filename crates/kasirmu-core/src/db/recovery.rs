//! Restore-candidate validation and the atomic restore swap (C8, slice S2).
//!
//! A restore replaces the only copy of a merchant's data, so the candidate is
//! judged BEFORE anything is touched: `validate_candidate` opens it
//! read-only, runs `PRAGMA integrity_check`, and applies a schema gate
//! comparing its newest date-shaped `schema_migrations` id against this
//! build's registry (`migrations::ALL`). The verdict is typed
//! (`CandidateVerdict`) and always carries a human-readable reason —
//! never a bare bool — so a caller can tell "older but fine" apart from
//! "refuse".
//!
//! `restore_from` is the single swap the CLI and the future in-app restore
//! path share: validate, snapshot the live database to `<db>.pre-restore.db`,
//! delete the `-wal`/`-shm` sidecars only once validation passed, copy the
//! candidate to a temporary file in the live database's OWN directory, rename
//! it over the live path (never a direct copy over a live file), and re-verify
//! the result — rolling back from the snapshot on any failure so the original
//! is left intact.
//!
//! Invariant: a candidate that fails validation changes not one byte of the
//! live database or of its sidecars.
//!
//! # Design decisions (C8)
//!
//! * An OLDER candidate is acceptable: `migrations::run` re-applies forward
//!   on the next boot, so a candidate behind this build is a supported state,
//!   not a refusal.
//! * A NEWER candidate is refused: its schema carries columns and tables this
//!   build cannot read, which is the boot-brick path. It must never be written
//!   over the live database.
//! * A candidate with no applied migrations (or no `schema_migrations` table
//!   at all) is the oldest possible state and therefore
//!   `CandidateVerdict::OlderButAcceptable` — the forward runner brings it up
//!   to date. This is what keeps a pre-migration snapshot restorable.

use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags};

use crate::db::Store;
use crate::error::CoreError;
use crate::migrations;

/// Suffix appended to the live database path for the pre-restore snapshot.
///
/// The snapshot is taken before the swap and is the rollback source when the
/// swap fails, so it is written even when the restore later succeeds.
pub const PRE_RESTORE_SUFFIX: &str = ".pre-restore.db";

/// What a candidate backup is worth as a restore source.
///
/// Deliberately not a bool: "older" and "newer" lead to opposite actions, and
/// only the reason string lets an operator act on a refusal.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CandidateVerdict {
    /// The candidate is at exactly this build's schema.
    Acceptable,
    /// The candidate is behind this build; migrations re-apply forward.
    OlderButAcceptable,
    /// The candidate is ahead of this build — refused, it would brick the boot.
    NewerThanThisBuild,
    /// The candidate failed to open or failed `PRAGMA integrity_check`.
    Corrupt,
}

impl CandidateVerdict {
    /// Whether this verdict permits the candidate to replace the live database.
    pub fn is_restorable(self) -> bool {
        matches!(self, Self::Acceptable | Self::OlderButAcceptable)
    }
}

/// The verdict on a candidate plus the evidence behind it.
#[derive(Debug, Clone)]
pub struct CandidateReport {
    /// The typed decision.
    pub verdict: CandidateVerdict,
    /// Human-readable explanation of `verdict`.
    pub reason: String,
    /// Newest date-shaped id the candidate's `schema_migrations` carries.
    pub candidate_schema: Option<String>,
    /// Newest date-shaped id in this build's registry (`migrations::ALL`).
    pub build_schema: Option<String>,
}

impl CandidateReport {
    /// A refusal is an error the operator can read; an acceptance is not.
    ///
    /// # Errors
    ///
    /// Returns `CoreError::Validation` naming the candidate and the reason
    /// when the verdict is not restorable.
    pub fn into_result(self, candidate: &Path) -> Result<Self, CoreError> {
        if self.verdict.is_restorable() {
            Ok(self)
        } else {
            Err(CoreError::Validation {
                field: "restore candidate",
                message: format!("refusing '{}': {}", candidate.display(), self.reason),
            })
        }
    }
}

/// The `YYYYMMDD` key of a date-shaped migration id, if it is date-shaped.
fn date_key(id: &str) -> Option<u32> {
    let prefix = id.get(..8)?;
    if prefix.bytes().all(|b| b.is_ascii_digit()) {
        prefix.parse().ok()
    } else {
        None
    }
}

/// The newest date-shaped id in `ids` — the schema level they represent.
fn newest_dated_id<'a>(ids: impl IntoIterator<Item = &'a str>) -> Option<&'a str> {
    ids.into_iter()
        .filter_map(|id| date_key(id).map(|key| (key, id)))
        .max_by_key(|(key, _)| *key)
        .map(|(_, id)| id)
}

/// This build's newest date-shaped migration id.
fn build_schema() -> Option<String> {
    newest_dated_id(migrations::ALL.iter().map(|m| m.id)).map(str::to_string)
}

/// The migration ids a candidate has applied; empty when it has no
/// `schema_migrations` table (an un-migrated or non-kasir.mu file).
fn applied_migration_ids(conn: &Connection) -> Vec<String> {
    let Ok(mut stmt) = conn.prepare("SELECT id FROM schema_migrations") else {
        return Vec::new();
    };
    let Ok(rows) = stmt.query_map([], |row| row.get::<_, String>(0)) else {
        return Vec::new();
    };
    rows.filter_map(Result::ok).collect()
}

/// Open `path` read-only and run `PRAGMA integrity_check` on it.
fn verify_file(path: &Path) -> Result<(), CoreError> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| CoreError::Internal(format!("cannot open '{}': {e}", path.display())))?;
    Store::new(&conn).check_integrity()
}

/// Judge a candidate backup WITHOUT modifying anything.
///
/// Opens `path` read-only, runs `PRAGMA integrity_check`, and compares the
/// newest date-shaped `schema_migrations` id it carries against this build's
/// registry. A file that cannot be opened or fails the integrity check is
/// `CandidateVerdict::Corrupt`; a schema ahead of this build is
/// `CandidateVerdict::NewerThanThisBuild`.
///
/// Never writes, never deletes, never opens the live database.
pub fn validate_candidate(path: &Path) -> CandidateReport {
    let build = build_schema();
    let report =
        |verdict: CandidateVerdict, reason: String, candidate: Option<String>| CandidateReport {
            verdict,
            reason,
            candidate_schema: candidate,
            build_schema: build.clone(),
        };

    if !path.is_file() {
        return report(
            CandidateVerdict::Corrupt,
            format!("'{}' is not a readable file", path.display()),
            None,
        );
    }

    let ids = {
        let conn = match Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY) {
            Ok(conn) => conn,
            Err(e) => {
                return report(
                    CandidateVerdict::Corrupt,
                    format!("cannot open '{}' read-only: {e}", path.display()),
                    None,
                );
            }
        };
        if let Err(e) = Store::new(&conn).check_integrity() {
            return report(
                CandidateVerdict::Corrupt,
                format!("'{}' failed integrity_check: {e}", path.display()),
                None,
            );
        }
        applied_migration_ids(&conn)
    };

    let candidate = newest_dated_id(ids.iter().map(String::as_str)).map(str::to_string);
    match (
        candidate.as_deref().and_then(date_key),
        build.as_deref().and_then(date_key),
    ) {
        (Some(candidate_key), Some(build_key)) if candidate_key > build_key => report(
            CandidateVerdict::NewerThanThisBuild,
            format!(
                "candidate schema {} is newer than this build's {} — this build cannot run it",
                candidate.as_deref().unwrap_or("?"),
                build.as_deref().unwrap_or("?")
            ),
            candidate,
        ),
        (Some(candidate_key), Some(build_key)) if candidate_key < build_key => report(
            CandidateVerdict::OlderButAcceptable,
            format!(
                "candidate schema {} is older than this build's {} — migrations re-apply forward",
                candidate.as_deref().unwrap_or("?"),
                build.as_deref().unwrap_or("?")
            ),
            candidate,
        ),
        (Some(_), Some(_)) => report(
            CandidateVerdict::Acceptable,
            format!(
                "candidate schema matches this build ({})",
                build.as_deref().unwrap_or("?")
            ),
            candidate,
        ),
        (None, _) => report(
            CandidateVerdict::OlderButAcceptable,
            "candidate carries no applied migrations — the oldest state, brought forward by migrations"
                .to_string(),
            candidate,
        ),
        (Some(_), None) => report(
            CandidateVerdict::Acceptable,
            "this build's registry carries no date-shaped migration id to compare against"
                .to_string(),
            candidate,
        ),
    }
}

/// Path of the pre-restore snapshot for a live database.
pub fn pre_restore_snapshot_path(db_path: &Path) -> PathBuf {
    let name = db_path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    db_path.with_file_name(format!("{name}{PRE_RESTORE_SUFFIX}"))
}

/// Path of a sidecar (`-wal` / `-shm`) belonging to a database file.
fn sidecar_path(db_path: &Path, extension: &str) -> PathBuf {
    let name = db_path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    db_path.with_file_name(format!("{name}{extension}"))
}

/// Validate `candidate`, then swap it over `db_path` atomically.
///
/// The order is load-bearing:
/// 1. `validate_candidate` — nothing is touched when the candidate is refused;
/// 2. the live database is copied to `<db>.pre-restore.db` (the rollback source);
/// 3. the `-wal` / `-shm` sidecars are deleted — a hot WAL would otherwise win
///    the next open and resurrect pre-restore data (CLI-4);
/// 4. the candidate is copied to a temporary file in the live database's OWN
///    directory and verified, so a truncated copy is never promoted;
/// 5. that temporary file is renamed over the live path — same-filesystem and
///    atomic — and the result is re-verified.
///
/// Any failure from step 4 on restores the live path from the snapshot (or
/// removes it, when there was no live database to begin with) and returns the
/// error.
///
/// # Errors
///
/// Returns `CoreError::Validation` when the candidate is refused, and a typed
/// I/O error when the snapshot, the copy, the rename or the re-verify fails.
pub fn restore_from(candidate: &Path, db_path: &Path) -> Result<CandidateReport, CoreError> {
    let report = validate_candidate(candidate).into_result(candidate)?;

    if candidate == db_path {
        return Err(CoreError::Validation {
            field: "restore candidate",
            message: format!(
                "candidate and destination are the same path ('{}')",
                db_path.display()
            ),
        });
    }

    // 2. Snapshot the live database before anything is destroyed.
    let had_live = db_path.exists();
    let snapshot = pre_restore_snapshot_path(db_path);
    if had_live {
        std::fs::copy(db_path, &snapshot).map_err(|e| {
            CoreError::Internal(format!(
                "failed to write the pre-restore snapshot '{}': {e}",
                snapshot.display()
            ))
        })?;
    }

    // 3. Sidecars go only now, with validation already passed.
    for extension in ["-wal", "-shm"] {
        let sidecar = sidecar_path(db_path, extension);
        if !sidecar.exists() {
            continue;
        }
        std::fs::remove_file(&sidecar).map_err(|e| {
            CoreError::Internal(format!(
                "failed to remove the sidecar '{}' before restoring: {e}",
                sidecar.display()
            ))
        })?;
    }

    // 4. Write and verify the candidate beside the live database.
    let temporary = {
        let name = db_path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        db_path.with_file_name(format!("{name}.restore-{}", uuid::Uuid::now_v7()))
    };
    let staged = (|| -> Result<(), CoreError> {
        std::fs::copy(candidate, &temporary).map_err(|e| {
            CoreError::Internal(format!(
                "failed to stage the candidate '{}' at '{}': {e}",
                candidate.display(),
                temporary.display()
            ))
        })?;
        verify_file(&temporary).map_err(|e| {
            CoreError::Internal(format!(
                "the staged candidate at '{}' is not integrity-clean: {e}",
                temporary.display()
            ))
        })
    })();

    let swapped = staged.and_then(|()| {
        std::fs::rename(&temporary, db_path).map_err(|e| {
            CoreError::Internal(format!(
                "failed to move the verified candidate into place at '{}': {e}",
                db_path.display()
            ))
        })?;
        // 5. Re-verify the database now at the live path.
        verify_file(db_path).map_err(|e| {
            CoreError::Internal(format!(
                "the restored database at '{}' failed re-verification: {e}",
                db_path.display()
            ))
        })
    });

    match swapped {
        Ok(()) => Ok(report),
        Err(e) => {
            let _ = std::fs::remove_file(&temporary);
            if had_live {
                let _ = std::fs::copy(&snapshot, db_path);
            } else {
                let _ = std::fs::remove_file(db_path);
            }
            Err(CoreError::Internal(format!(
                "restore rolled back, '{}' left intact: {e}",
                db_path.display()
            )))
        }
    }
}

#[cfg(test)]
mod tests {
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
}
