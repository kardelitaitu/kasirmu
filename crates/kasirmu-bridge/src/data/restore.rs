//! The C8 restore surface: inspect candidates, request a restore, read status.
//!
//! **This module never performs a restore.** It writes a `<db>.restore-request.json`
//! that the BOOT path (slice S4) consumes before the database is opened — so the
//! operator's confirmation and the restore itself are deliberately not in the
//! same process run.
//!
//! Split out of `data.rs` on 2026-09-28. `RESTORE_REQUEST_SUFFIX` is defined
//! here because writer and reader must agree and a second derivation is how they
//! drift; the file name is derived in exactly ONE place.
//!
//! NOTE FOR ANYONE MOVING CODE OUT OF THIS FILE: `data_tests.rs` holds two
//! source scans over `data.rs` — one counting `pub async fn ` (floor 2) and one
//! counting `tx.execute(` (floor 5, whitespace-normalised). This band adds
//! `pub async fn` to nothing and contains no `tx.execute(`, so both floors are
//! unaffected; a band carrying either would need those scans widened.

use std::path::{Path, PathBuf};

use kasirmu_core::db::{BACKUP_GENERATIONS, CandidateVerdict, Store, validate_candidate};
use kasirmu_core::permissions;

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

use super::dto::RestoreRequest;
use super::helpers::validate_contained_path;
use super::{
    ListRestoreCandidatesResult, RestoreCandidate, RestorePrepareArgs, RestorePrepareResult,
    RestoreStatus,
};

/// Filename infix and suffix of the restore request file.
///
/// The full shape is `<db-name>.restore-request.json` — the live database's
/// own name with `.restore-request.json` appended, so the request sits BESIDE
/// the database it names and the boot path (slice S4) finds it from the same
/// `db_path` every other command here receives. The name is derived in ONE
/// place: writer and reader must agree, and a second derivation is how they
/// drift.
pub(super) const RESTORE_REQUEST_SUFFIX: &str = ".restore-request.json";

/// Path of the restore request file for a live database.
pub(super) fn restore_request_path(db_path: &Path) -> PathBuf {
    let name = db_path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    db_path.with_file_name(format!("{name}{RESTORE_REQUEST_SUFFIX}"))
}

/// Path of backup generation `generation` for the live database.
///
/// Mirrors `Store::backup_generation_path` (private in kasirmu-core, which is
/// why this is not called): generation 0 is `<db>.backup.db` itself — the name
/// `default_backup_path` writes — and generation `n` is its sibling
/// `<db>.backup.n.db`, the generation number inserted before the extension.
pub(super) fn backup_generation_path(db_path: &Path, generation: usize) -> PathBuf {
    let mut path = db_path.to_path_buf();
    path.set_extension("backup.db");
    if generation == 0 {
        return path;
    }
    let mut name = path.file_stem().unwrap_or_default().to_os_string();
    name.push(format!(".{generation}"));
    let extension = path.extension().unwrap_or_default().to_os_string();
    if !extension.is_empty() {
        name.push(".");
        name.push(extension);
    }
    path.with_file_name(name)
}

/// Stable wire name of a verdict.
///
/// Spelled out rather than derived from `Debug`, so a refactor of the core
/// enum cannot silently change what the IPC surface and the request file say.
pub(super) fn verdict_name(verdict: CandidateVerdict) -> &'static str {
    match verdict {
        CandidateVerdict::Acceptable => "Acceptable",
        CandidateVerdict::OlderButAcceptable => "OlderButAcceptable",
        CandidateVerdict::NewerThanThisBuild => "NewerThanThisBuild",
        CandidateVerdict::Corrupt => "Corrupt",
    }
}

/// The store name a candidate database carries, read READ-ONLY.
///
/// Returns `None` when the candidate has no `store.name` row (or no settings
/// table at all) — a legitimate state, and one the confirmation check must
/// treat as "cannot be confirmed" rather than as a match.
pub(super) fn candidate_store_name(candidate: &Path) -> Result<Option<String>, BridgeError> {
    let conn = rusqlite::Connection::open_with_flags(
        candidate,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .map_err(|e| {
        BridgeError::Internal(format!(
            "cannot open the candidate '{}' read-only: {e}",
            candidate.display()
        ))
    })?;
    Ok(Store::new(&conn).get_store_name()?)
}

/// Enumerate the backup generations beside the database, each with its verdict.
///
/// Generation 0 is the current backup (`<db>.backup.db`), generations 1 and 2
/// are its rotated siblings, so at most [`BACKUP_GENERATIONS`] entries exist.
/// Only generations actually present on disk are returned, newest first.
///
/// A generation that exists but FAILS validation is returned as `Corrupt` with
/// the validator's reason — never skipped. That is the whole point of the list:
/// an operator looking at "why can I not restore this backup" has to see the
/// unusable one and read why, and a silently shorter list answers a question
/// nobody asked.
///
/// Read-only: this command opens each candidate read-only and never touches the
/// live database, its sidecars or any request file. It takes no session token
/// for the same reason `list_products` takes none — it is a pure read of data
/// the caller can already see, and the mutating half of this surface
/// ([`restore_prepare`]) is where `SETTINGS_EDIT` is enforced.
pub async fn list_restore_candidates(
    db_path: &Path,
) -> Result<ListRestoreCandidatesResult, BridgeError> {
    let mut candidates = Vec::new();
    for generation in (0..BACKUP_GENERATIONS).rev() {
        let path = backup_generation_path(db_path, generation);
        if !path.is_file() {
            continue;
        }
        let report = validate_candidate(&path);
        let (size_bytes, modified) = match std::fs::metadata(&path) {
            Ok(meta) => {
                let modified = meta.modified().ok().map(|t| {
                    let dt: chrono::DateTime<chrono::Local> = t.into();
                    dt.format("%Y-%m-%d %H:%M:%S").to_string()
                });
                (meta.len(), modified)
            }
            Err(_) => (0, None),
        };
        candidates.push(RestoreCandidate {
            generation,
            path: path.display().to_string(),
            size_bytes,
            modified,
            verdict: verdict_name(report.verdict).to_string(),
            restorable: report.verdict.is_restorable(),
            reason: report.reason,
            candidate_schema: report.candidate_schema,
            build_schema: report.build_schema,
        });
    }
    Ok(ListRestoreCandidatesResult {
        candidates,
        generations_examined: BACKUP_GENERATIONS,
    })
}

/// Prepare a restore request for the next boot — gated on `SETTINGS_EDIT`.
///
/// This does NOT restore anything and does NOT touch the live database. It
/// validates the candidate, checks the operator's typed confirmation against
/// the candidate's OWN `store.name`, and writes
/// `<db>.restore-request.json` for the boot path (slice S4) to consume before
/// `AppState::new` opens anything. The gate is the one `import_data` uses, and
/// for the same reason: both commands replace the merchant's data with data
/// from a file.
///
/// The order of the three refusals is deliberate — validate first, confirm
/// second, write third — so a corrupt candidate produces no file even when the
/// operator typed the right name, and a wrong name produces no file even when
/// the candidate is perfect.
///
/// # Errors
///
/// * [`BridgeError::Core`] when the candidate is `Corrupt` or
///   `NewerThanThisBuild` — the validator's typed refusal, before any write.
/// * [`BridgeError::Invalid`] when the typed confirmation does not match the
///   candidate's store name, or the candidate has none to match.
/// * [`BridgeError::Internal`] when the request file cannot be written.
pub async fn restore_prepare(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    db_path: &Path,
    args: RestorePrepareArgs,
) -> Result<RestorePrepareResult, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::SETTINGS_EDIT)
        .await?;
    // C-1: contain the candidate path — reject path traversal, exactly as the
    // two import/export lanes do.
    validate_contained_path(&args.candidate_path)?;
    let candidate = Path::new(&args.candidate_path);

    // 1. Validate. A refusal here returns the core's own typed message and
    //    writes nothing: the request file must not exist for a candidate the
    //    boot path would refuse anyway.
    let report = validate_candidate(candidate).into_result(candidate)?;

    // 2. Confirm. The operator must type the store name READ FROM THE
    //    CANDIDATE — proof they are looking at the database they are about to
    //    promote, not at the live one. A candidate with no store name cannot
    //    be confirmed at all, so it is refused rather than accepted on an
    //    empty string.
    let confirmation = args.confirm_store_name.trim();
    //    The expected name is deliberately NOT echoed back: the confirmation
    //    is only a real barrier if the answer is not in the error.
    match candidate_store_name(candidate)? {
        Some(name) if name == confirmation => {}
        Some(_) => {
            return Err(BridgeError::Invalid(
                "the store name typed does not match the name the candidate carries".into(),
            ));
        }
        None => {
            return Err(BridgeError::Invalid(
                "the candidate carries no store name to confirm against".into(),
            ));
        }
    }

    // 3. Preflight disk space before writing request (Phase 3 data layer):
    // Staging the restore candidate and writing the pre-restore snapshot
    // requires candidate_size + live_db_size + safety margin.
    if let Ok(space) = platform_instance_guard::get_disk_space(db_path) {
        let candidate_size = std::fs::metadata(candidate).map(|m| m.len()).unwrap_or(0);
        let live_size = std::fs::metadata(db_path).map(|m| m.len()).unwrap_or(0);
        let required_bytes = candidate_size
            .saturating_add(live_size)
            .saturating_add(50 * 1024 * 1024);
        if space.available_bytes < required_bytes {
            return Err(BridgeError::Invalid(format!(
                "insufficient disk space for restore: {} bytes available, {} bytes required",
                space.available_bytes, required_bytes
            )));
        }
    }

    // 4. Write. The request names the candidate, the moment and the verdict,
    //    so the boot path re-checks nothing it has to guess at and an operator
    //    can read what is pending.
    let requested_at = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let request = RestoreRequest {
        candidate_path: args.candidate_path.clone(),
        requested_at: requested_at.clone(),
        verdict: verdict_name(report.verdict).to_string(),
        candidate_schema: report.candidate_schema.clone(),
        confirmed_store_name: confirmation.to_string(),
    };
    let request_path = restore_request_path(db_path);
    let bytes = serde_json::to_vec_pretty(&request)
        .map_err(|e| BridgeError::Internal(format!("encoding the restore request: {e}")))?;
    std::fs::write(&request_path, bytes).map_err(|e| {
        BridgeError::Internal(format!(
            "writing the restore request '{}': {e}",
            request_path.display()
        ))
    })?;

    Ok(RestorePrepareResult {
        candidate_path: args.candidate_path,
        request_path: request_path.display().to_string(),
        requested_at,
        verdict: verdict_name(report.verdict).to_string(),
        candidate_schema: report.candidate_schema,
    })
}

/// Report whether a restore request is pending, and what it names.
///
/// The boot path consumes the request (slice S4); until it does, this is how a
/// caller tells the operator that a restore is pending and which candidate it
/// will promote. A request file that cannot be parsed is reported as an error
/// WITH `pending: true` — the file is there, so the honest answer is "pending,
/// but unreadable", never "nothing pending".
///
/// Read-only, and it takes no token for the same reason
/// [`list_restore_candidates`] does not.
pub async fn restore_status(db_path: &Path) -> Result<RestoreStatus, BridgeError> {
    let request_path = restore_request_path(db_path);
    if !request_path.is_file() {
        return Ok(RestoreStatus {
            pending: false,
            candidate_path: None,
            requested_at: None,
            verdict: None,
            error: None,
        });
    }
    let read = std::fs::read(&request_path)
        .map_err(|e| format!("reading '{}': {e}", request_path.display()))
        .and_then(|bytes| {
            serde_json::from_slice::<RestoreRequest>(&bytes)
                .map_err(|e| format!("parsing '{}': {e}", request_path.display()))
        });
    Ok(match read {
        Ok(request) => RestoreStatus {
            pending: true,
            candidate_path: Some(request.candidate_path),
            requested_at: Some(request.requested_at),
            verdict: Some(request.verdict),
            error: None,
        },
        Err(error) => RestoreStatus {
            pending: true,
            candidate_path: None,
            requested_at: None,
            verdict: None,
            error: Some(error),
        },
    })
}
