//! Consume a pending restore request at boot, before anything opens the database (C8, slice S4b).
//!
//! The bridge's `restore_prepare` writes `<db>.restore-request.json` naming a validated
//! backup, but performs no swap: the live connection is an `Arc<Mutex<Connection>>` cloned
//! into daemons that spawn detached, so an in-process swap would fight every one of them.
//! This module is the consumer. [`consume_pending_restore`] runs from the tablet setup
//! closure BEFORE `AppState::new` opens (and migrates) the database, when no connection and
//! no daemon exists yet — the only moment the swap is safe.
//!
//! A failed recovery must never become a failure to start. Every outcome is a value the
//! caller logs; the live database is left untouched on any refusal, and the request file
//! stays in place so an operator can read why. Success moves the request aside and leaves
//! `kasirmu-core`'s pre-restore snapshot beside the database.
//!
//! Invariants: the request is claimed exactly once (a `create_new` lock file, held for
//! the duration of the boot and released when it ends); a candidate that no longer validates
//! is never promoted;
//! the request path is derived in one place ([`request_path_for`]) and must stay
//! byte-identical to the writer's in `kasirmu-bridge`.
//!
//! This is the tablet twin of `apps/desktop-tauri/src/recovery.rs` (slice S4a). The two
//! shells must not drift into two different recovery semantics, so the structure, the
//! invariants and the on-disk contract here are deliberately identical; only this header
//! and the call site differ.

use std::path::{Component, Path, PathBuf};

use kasirmu_core::db::{pre_restore_snapshot_path, restore_from, validate_candidate};
use serde::Deserialize;

/// Filename infix and suffix of the restore request file.
///
/// Must stay byte-identical to the writer's constant in `kasirmu-bridge` (`data.rs`):
/// writer and reader agreeing on the name is the whole contract. Kept as a literal here
/// rather than shared, because the bridge's copy is private.
const RESTORE_REQUEST_SUFFIX: &str = ".restore-request.json";

/// Filename infix and suffix of the single-consumer boot lock.
const RESTORE_BOOT_LOCK_SUFFIX: &str = ".restore-boot.lock";

/// What the boot path did with a pending request.
#[derive(Debug, PartialEq, Eq)]
pub enum Outcome {
    /// No request file was present — the ordinary boot.
    NothingPending,
    /// Another boot already claimed the request; this one leaves it alone.
    AlreadyClaimed,
    /// The request was consumed and the live database replaced.
    Restored {
        /// The backup that was promoted.
        candidate: PathBuf,
        /// `kasirmu-core`'s snapshot of the database it replaced. Written only when a
        /// live database existed to snapshot.
        snapshot: PathBuf,
    },
    /// The request exists but was not consumed. The app boots on the existing database.
    Refused {
        /// Operator-readable explanation.
        reason: String,
    },
}

/// The one field of the on-disk request the boot path acts on.
///
/// The writer also records `requested_at`, `verdict`, `candidate_schema` and
/// `confirmed_store_name`; serde ignores them here on purpose. The boot path re-validates
/// the candidate itself rather than trusting a verdict written by an earlier process, and a
/// field added to the writer must never break a boot.
#[derive(Debug, Deserialize)]
struct RestoreRequest {
    candidate_path: String,
}

/// Path of the restore request file for a live database.
fn request_path_for(db_path: &Path) -> PathBuf {
    with_suffix(db_path, RESTORE_REQUEST_SUFFIX)
}

/// Path of the boot lock for a live database.
fn lock_path_for(db_path: &Path) -> PathBuf {
    with_suffix(db_path, RESTORE_BOOT_LOCK_SUFFIX)
}

/// `path` with `suffix` appended to its file name.
fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let name = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    path.with_file_name(format!("{name}{suffix}"))
}

/// Consume `<db_path>.restore-request.json` if one is pending.
///
/// Call this before anything opens the database. It never panics and never returns an
/// error: every failure is an [`Outcome::Refused`] the caller logs, and the app boots on
/// the existing database either way.
///
/// The request is claimed exactly once through a `create_new` lock file, so two boots
/// racing on the same request cannot both swap. The claim lives only as long as this boot
/// does: a completed swap archives the request, so there is nothing left to guard, and a
/// refusal must not leave a stale lock that would block the next request.
pub fn consume_pending_restore(db_path: &Path) -> Outcome {
    let request_path = request_path_for(db_path);
    if !request_path.is_file() {
        return Outcome::NothingPending;
    }

    let _claim = match BootLock::acquire(db_path) {
        Ok(lock) => lock,
        Err(ClaimError::Held) => return Outcome::AlreadyClaimed,
        Err(ClaimError::Unusable(reason)) => return Outcome::Refused { reason },
    };

    // Re-check under the claim: another process may have consumed the request between
    // the check above and the lock.
    if !request_path.is_file() {
        return Outcome::NothingPending;
    }

    let candidate = match read_candidate_path(&request_path) {
        Ok(candidate) => candidate,
        Err(reason) => return Outcome::Refused { reason },
    };

    // Re-validate. The verdict in the request was written by an earlier process, against a
    // file that may have been replaced, truncated or removed since; a candidate that no
    // longer validates must never be promoted. `restore_from` validates again — this is the
    // check whose refusal is reported while leaving the request on disk.
    let report = validate_candidate(&candidate);
    if !report.verdict.is_restorable() {
        return Outcome::Refused {
            reason: format!(
                "candidate '{}' is {:?}: {}",
                candidate.display(),
                report.verdict,
                report.reason
            ),
        };
    }

    match restore_from(&candidate, db_path) {
        Ok(_) => {
            archive_request(&request_path);
            Outcome::Restored {
                candidate,
                snapshot: pre_restore_snapshot_path(db_path),
            }
        }
        Err(error) => Outcome::Refused {
            reason: error.to_string(),
        },
    }
}

/// Read and vet the candidate path a request names.
///
/// The request file is untrusted input: anything that can write a file beside the database
/// can name a candidate. A relative path would resolve against the working directory and a
/// `..` segment would escape the database directory, so both are refused before the path
/// reaches the validator.
fn read_candidate_path(request_path: &Path) -> Result<PathBuf, String> {
    let bytes = std::fs::read(request_path).map_err(|e| {
        format!(
            "reading the restore request '{}': {e}",
            request_path.display()
        )
    })?;
    let request: RestoreRequest = serde_json::from_slice(&bytes).map_err(|e| {
        format!(
            "parsing the restore request '{}': {e}",
            request_path.display()
        )
    })?;

    let candidate = PathBuf::from(request.candidate_path.trim());
    if !candidate.is_absolute() {
        return Err(format!(
            "the restore request names the relative path '{}'; refusing to resolve it against the working directory",
            candidate.display()
        ));
    }
    if candidate
        .components()
        .any(|c| matches!(c, Component::ParentDir))
    {
        return Err(format!(
            "the restore request names a path containing '..' ('{}'); refusing to leave the database directory",
            candidate.display()
        ));
    }
    Ok(candidate)
}

/// Move the consumed request aside so no later boot consumes it again.
///
/// Best effort: the swap has already happened, so failing to archive must not turn a
/// completed restore into a failure. The request is removed instead, and if even that
/// fails the next boot re-runs the same idempotent restore.
fn archive_request(request_path: &Path) {
    let archived = with_suffix(request_path, ".done");
    if std::fs::rename(request_path, &archived).is_err() {
        let _ = std::fs::remove_file(request_path);
    }
}

/// Why a boot could not claim the request.
enum ClaimError {
    /// Another boot holds the lock.
    Held,
    /// The lock file cannot be created at all.
    Unusable(String),
}

/// Exclusive claim on the pending request, released when the boot finishes with it.
///
/// The claim covers one boot's consumption and nothing longer. A completed swap has
/// already archived the request, and a stale lock would refuse the NEXT restore request
/// instead of a concurrent boot — so the file always goes on drop, on every path.
struct BootLock {
    path: PathBuf,
}

impl BootLock {
    /// Create the lock with `create_new`, so exactly one boot can win it.
    fn acquire(db_path: &Path) -> Result<Self, ClaimError> {
        let path = lock_path_for(db_path);
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(_) => Ok(Self { path }),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Err(ClaimError::Held),
            Err(e) => Err(ClaimError::Unusable(format!(
                "cannot claim the restore lock '{}': {e}",
                path.display()
            ))),
        }
    }
}

impl Drop for BootLock {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

#[cfg(test)]
#[path = "recovery_tests.rs"]
mod tests;
