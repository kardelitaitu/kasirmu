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
///
/// An ABSENT table and an UNREADABLE one are different verdicts. The absent
/// table is the documented oldest state and stays restorable; a table whose
/// rows cannot decode is a candidate this build cannot judge, so the error
/// propagates and `validate_candidate` refuses it. Collapsing the two here
/// let an undecodable id read as "no migrations applied" — the oldest,
/// restorable state — and a newer candidate could be written over the live
/// database (the boot-brick path the gate exists to close).
fn applied_migration_ids(conn: &Connection) -> Result<Vec<String>, CoreError> {
    let has_table: bool = conn.query_row(
        "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
        [],
        |row| row.get(0),
    )?;
    if !has_table {
        return Ok(Vec::new());
    }

    let mut stmt = conn.prepare("SELECT id FROM schema_migrations")?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(CoreError::from)
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
        match applied_migration_ids(&conn) {
            Ok(ids) => ids,
            Err(e) => {
                return report(
                    CandidateVerdict::Corrupt,
                    format!("cannot read '{}' schema_migrations: {e}", path.display()),
                    None,
                );
            }
        }
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
/// Any failure from step 4 on ATTEMPTS to restore the live path from the
/// snapshot (or removes it, when there was no live database to begin with) and
/// returns the error.
///
/// MSL-25: the rollback is an attempt, and the returned message says which
/// outcome it had. It previously discarded the copy's `Result` and always
/// claimed "left intact", so an operator whose rollback failed was told their
/// data was safe while it was not. The failure message now names the
/// pre-restore snapshot, because restoring it by hand is the caller's next
/// step.
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

            // MSL-25: the rollback's OUTCOME decides the MESSAGE, not just the
            // state. This used to discard the copy's Result and always report
            // "restore rolled back, ... left intact", so a failed rollback told
            // the operator their data was safe at the exact moment it was not --
            // the worst untruth available during a restore, because it stops them
            // reaching for the snapshot they would need.
            let rollback: Result<(), String> = if had_live {
                std::fs::copy(&snapshot, db_path)
                    .map(|_| ())
                    .map_err(|copy_err| {
                        format!(
                            "the pre-restore snapshot '{}' could NOT be put back ({copy_err})",
                            snapshot.display()
                        )
                    })
            } else {
                // No live database existed, so removing the half-swapped file
                // restores the absent state. `NotFound` IS success here: the goal
                // was "not there".
                std::fs::remove_file(db_path)
                    .or_else(|remove_err| {
                        if remove_err.kind() == std::io::ErrorKind::NotFound {
                            Ok(())
                        } else {
                            Err(remove_err)
                        }
                    })
                    .map_err(|remove_err| {
                        format!(
                            "the partially-written database at '{}' could NOT be removed ({remove_err})",
                            db_path.display()
                        )
                    })
            };

            Err(CoreError::Internal(match rollback {
                Ok(()) if had_live => format!(
                    "restore rolled back, '{}' left intact: {e}",
                    db_path.display()
                ),
                Ok(()) => format!(
                    "restore rolled back, '{}' removed as it was before: {e}",
                    db_path.display()
                ),
                // Fail LOUDLY and name the snapshot: the operator's next step is
                // to restore it by hand, so the message must say so.
                Err(rollback_err) => format!(
                    "restore FAILED and the automatic rollback ALSO failed; '{}' is NOT \
                     intact. {rollback_err}. The original content is in the pre-restore \
                     snapshot. Original error: {e}",
                    db_path.display()
                ),
            }))
        }
    }
}

#[cfg(test)]
#[path = "recovery_inline_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "recovery_gate_tests.rs"]
mod gate_tests;
