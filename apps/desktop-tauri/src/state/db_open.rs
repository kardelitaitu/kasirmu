//! Opening the desktop store database, with recovery from a stale `-shm` mapping.
//!
//! Split out of `state.rs` (C28 size reduction, 2026-09-29). The block is a
//! cohesive unit — one public entry point ([`open_store_connection`]), one retry
//! loop, one single-attempt body, and the header probe the body needs — with no
//! `AppState` coupling at all. That is what made it a safe seam rather than a
//! line-count-driven cut: nothing here reads state, so the extraction is a MOVE
//! and the caller in `state.rs` is the only change.
//!
//! # Why the recovery exists
//!
//! A killed predecessor can leave a `-shm` memory mapping behind. SQLite then
//! fails with `SQLITE_CANTOPEN`, which reads like a missing file but is not, and
//! which no amount of retrying fixes until the stale sidecar is removed. The
//! open sequence therefore retries with the sidecar deleted between attempts,
//! and distinguishes the two real causes of a write-lock failure in the error
//! text an operator reads off a console when the till will not boot.

use rusqlite::Connection;

use crate::error::AppError;

/// Step name reported for a failure of the `BEGIN IMMEDIATE` probe, so the
/// caller can render the fuller "not writable by this process" explanation.
const WRITABILITY_STEP: &str = "taking the write lock on";

/// One attempt at opening the store database at `db_path`.
///
/// Returns the failing step beside the underlying `rusqlite` error so the
/// caller can read the SQLite error code: `CannotOpen` is recoverable (a
/// stale `-shm` mapping), anything else is not.
fn open_store_connection_once(
    db_path: &std::path::Path,
) -> Result<Connection, (&'static str, rusqlite::Error)> {
    let conn = Connection::open(db_path).map_err(|e| ("opening", e))?;
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| ("setting busy_timeout on", e))?;
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(|e| ("enabling foreign_keys on", e))?;

    // A database already using WAL records that fact in its file header at a
    // fixed offset. Asking SQLite (`PRAGMA journal_mode`) would itself open
    // the `-shm` sidecar and can fail with the very CANTOPEN we are trying to
    // survive, before telling us anything; read the header instead. Only a
    // new or legacy rollback-journal database needs the write-like
    // journal-mode transition, which is the slowest of the three steps.
    if sqlite_header_uses_wal(db_path) {
        tracing::debug!("database header already specifies WAL; skipping journal-mode transition");
    } else {
        conn.pragma_update(None, "journal_mode", "WAL")
            .map_err(|e| ("enabling WAL on", e))?;
    }

    // ── Writability probe ─────────────────────────────────────────────
    // `BEGIN IMMEDIATE` takes the write lock and `ROLLBACK` releases it
    // without touching a row. It belongs INSIDE the retried sequence, not
    // after it: on a database whose header already says WAL — the normal
    // case here — the journal-mode transition above is skipped, so this is
    // the first statement that touches the database for writing and therefore
    // the first one to create the `-shm` / `-wal` sidecars. That makes it the
    // first statement to fail with SQLITE_CANTOPEN when a killed predecessor
    // still holds a mapping on them — measured 2026-09-28, where the setup
    // hook died on exactly this line with "unable to open database file".
    conn.execute_batch("BEGIN IMMEDIATE; ROLLBACK;")
        .map_err(|e| (WRITABILITY_STEP, e))?;

    Ok(conn)
}

/// Open the store database, retrying past a stale `-shm` memory mapping.
///
/// See the call site in `AppState::new` for why the recovery has to wrap
/// the whole open sequence rather than one pragma.
pub(crate) fn open_store_connection(db_path: &std::path::Path) -> Result<Connection, AppError> {
    const ATTEMPTS: u8 = 8;
    const RETRY_DELAY_MS: u64 = 250;

    let shm_path = {
        let mut p = db_path.to_path_buf();
        let name = p
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string()
            + "-shm";
        p.set_file_name(name);
        p
    };

    let mut last: Option<(&'static str, rusqlite::Error)> = None;
    for attempt in 0..ATTEMPTS {
        match open_store_connection_once(db_path) {
            Ok(conn) => return Ok(conn),
            Err((step, e)) => {
                if e.sqlite_error_code() != Some(rusqlite::ffi::ErrorCode::CannotOpen) {
                    return Err(AppError::Internal(format!("{step} {db_path:?}: {e}")));
                }
                tracing::warn!(
                    attempt,
                    step,
                    shm = %shm_path.display(),
                    "database open failed with SQLITE_CANTOPEN (stale -shm mapping from a \
                     previous instance); deleting the stale sidecar and retrying"
                );
                let _ = std::fs::remove_file(&shm_path);
                last = Some((step, e));
                if attempt + 1 < ATTEMPTS {
                    std::thread::sleep(std::time::Duration::from_millis(RETRY_DELAY_MS));
                }
            }
        }
    }

    // INVARIANT: the loop returns on success and records every failure, so one exists here.
    let (step, e) = last.expect("a failed open records its error before the loop ends");

    // A write-lock failure gets the operator-facing wording rather than the
    // terse step name. SQLite reports a lock held by another process and a
    // permission that denies write with the same terse string, so the message
    // has to name both real causes: this is what someone reads off a console
    // when the till will not boot, and it has to say what to do next.
    if step == WRITABILITY_STEP {
        return Err(AppError::Internal(format!(
            "the store database at {db_path:?} is not writable by this process ({e}). Either \
             another kasir.mu instance is already running (or a stale one still holds the \
             file), or this process lacks write permission on the file and its directory. \
             ({ATTEMPTS} attempts with stale -shm cleanup)"
        )));
    }

    Err(AppError::Internal(format!(
        "{step} {db_path:?}: {e} (after {ATTEMPTS} attempts with stale -shm cleanup)"
    )))
}

/// Whether the SQLite file header at `path` declares WAL.
///
/// Offsets 18 and 19 of the 100-byte header are the file-format write and
/// read versions; `2` means WAL in both. Anything unverifiable — missing
/// file, shorter than the header, wrong magic, unreadable — is reported as
/// "not WAL" so the caller falls through to the journal-mode transition,
/// which then surfaces the real problem if there is one.
pub(crate) fn sqlite_header_uses_wal(path: &std::path::Path) -> bool {
    use std::io::Read as _;

    let mut header = [0u8; 20];
    let mut file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return false,
    };
    if file.read_exact(&mut header).is_err() {
        return false;
    }
    if &header[0..16] != b"SQLite format 3\0" {
        return false;
    }
    header[18] == 2 && header[19] == 2
}
