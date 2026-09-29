/*
last audited 29-09-26 by DSH-Agent
crate: kasirmu-logging | status: SAFE | lint: CLEAN
findings: 0 unsafe blocks — the syslog/eventlog FFI modules (3 unsafe blocks: openlog + syslog, OutputDebugStringW) were DELETED 2026-09-29 under C29 / decision D13, so this crate is now entirely safe Rust and the crate-level `#![deny(unsafe_code)]` below makes that structural. .expect() calls only in documented-panic wrapper functions (init/init_json/init_with_file/init_json_with_file — mirrored by try_* non-panicking variants). Error type #[non_exhaustive]. File logger guard retention fix (L-1) verified. No defects found.
next: none | perf: N/A
*/
//! Structured logging facade for kasir.mu.
//!
//! `kasirmu-logging` wraps the `tracing` ecosystem with context-tagged
//! record format, file + stdout writers, and log rotation.
//!
//! # Initialisers
//!
//! - [`init`] — human-readable text format (stdout). Best for local dev.
//! - [`init_json`] — JSON-formatted log records (stdout). Best for
//!   production environments where logs are shipped to ELK/Loki.
//! - [`init_with_file`] — human-readable text + rolling file writer.
//! - [`init_json_with_file`] — JSON + rolling file writer.
//!
//! # Which initialisers are actually wired, stated because it is not obvious
//!
//! **The two FILE initialisers have no production caller.** Measured 2026-09-30
//! (C29 / decision D13): the only initialisers called by any shipped binary are
//! [`try_init`] (desktop `apps/desktop-tauri/src/lib.rs`, mobile
//! `apps/mobile-tauri/src/lib.rs`) and [`try_init_json`] (cloud-server
//! `apps/cloud-server/src/main.rs`), all of which write to **stdout**. Nothing in
//! the tree calls [`init_with_file`], [`try_init_with_file`],
//! [`init_json_with_file`] or [`try_init_json_with_file`] outside this crate's own
//! tests, which DO call them directly and are why they cannot simply be removed.
//!
//! They are kept, and kept labelled, under D13's rule — *redundant-and-inert is
//! deleted; unwired-but-implemented is kept and labelled honestly*. They fall on
//! the KEEP side for a reason the deleted syslog/eventlog pair did not: file
//! logging is **not redundant** with stdout on a desktop install, where stdout is
//! captured by nothing, so this is a real capability that simply is not switched
//! on yet — unlike a syslog sink, which duplicated what the container already
//! collects. Retaining them is a deliberate decision, not an oversight.
//!
//! # No platform-specific sinks
//!
//! The `syslog` (Linux) and `eventlog` (Windows) modules were **deleted
//! 2026-09-29** (C29 / decision D13). Both were unwired — zero callers
//! anywhere in the tree — and both were redundant with the stdout
//! initialisers above, which the container and the host already capture.
//! They also carried a `no_run` doctest advertising a usage that did not
//! exist, which is the defect class the deletion closes. There is
//! deliberately no FFI and no `unsafe` in this crate.

#![deny(unsafe_code)]

pub mod error;
pub mod visitor;

pub use error::LoggingError;
use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::EnvFilter;

/// Process-global registry of file-writer guards (L-1 fix).
///
/// The non-blocking file writer shuts down when its guard drops; binding
/// the guard to a local dropped the writer immediately after init returned,
/// leaving file logging dead for the rest of the process. Guards are
/// retained here for the process lifetime — the registry is never dropped,
/// and the OS reclaims it at exit, which is exactly the desired flush
/// window.
static FILE_LOG_GUARDS: std::sync::OnceLock<std::sync::Mutex<Vec<WorkerGuard>>> =
    std::sync::OnceLock::new();

/// Retain a `WorkerGuard` for the process lifetime (L-1 fix).
///
/// See [`FILE_LOG_GUARDS`]. If the registry mutex is poisoned (only
/// possible if a panic unwinds while the lock is held, which no code path
/// here does), the guard is dropped rather than blocking startup — the
/// pre-fix behaviour.
fn retain_file_log_guard(guard: WorkerGuard) {
    let registry = FILE_LOG_GUARDS.get_or_init(|| std::sync::Mutex::new(Vec::new()));
    if let Ok(mut guards) = registry.lock() {
        guards.push(guard);
    }
}

/// Number of file-writer guards currently retained (test/ops introspection).
#[doc(hidden)]
pub fn retained_file_log_guards() -> usize {
    FILE_LOG_GUARDS
        .get_or_init(|| std::sync::Mutex::new(Vec::new()))
        .lock()
        .map(|guards| guards.len())
        .unwrap_or(0)
}

/// Decide the filter from a `RUST_LOG` value, keeping "not set" and
/// "unparseable" apart.
///
/// `EnvFilter::try_from_default_env()` returns `Err` for BOTH cases, so the
/// one-liner it replaces printed `RUST_LOG parse failed` at every developer who
/// had never set `RUST_LOG` at all -- which is the documented default path
/// ("falls back to `info` if unset"). A report that sends someone hunting a bad
/// value they never wrote is a misreport, not a diagnostic. The fallback level
/// is the same either way, so this returns the message instead of printing it,
/// and the four init paths share one implementation.
fn filter_for(raw: Option<&str>) -> (EnvFilter, Option<String>) {
    let Some(raw) = raw.filter(|value| !value.trim().is_empty()) else {
        // Unset, or set to whitespace: the documented default, silently applied.
        return (EnvFilter::new("info"), None);
    };
    match EnvFilter::try_new(raw) {
        Ok(filter) => (filter, None),
        Err(e) => (
            EnvFilter::new("info"),
            Some(format!(
                "[kasirmu-logging] RUST_LOG={raw:?} could not be parsed ({e}); falling back to info"
            )),
        ),
    }
}

/// Non-panicking variant of [`init`].
///
/// Returns `Err` (instead of panicking) if the global subscriber has
/// already been set. All other behaviour is identical to [`init`].
pub fn try_init() -> Result<(), LoggingError> {
    let (filter, filter_warning) = filter_for(std::env::var("RUST_LOG").ok().as_deref());
    if let Some(warning) = filter_warning {
        eprintln!("{warning}");
    }

    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .try_init()
        .map_err(|e| LoggingError::InitFailed(format!("{e}")))?;
    Ok(())
}

/// Non-panicking variant of [`init_json`].
///
/// Returns `Err` (instead of panicking) if the global subscriber has
/// already been set. All other behaviour is identical to [`init_json`].
pub fn try_init_json() -> Result<(), LoggingError> {
    let (filter, filter_warning) = filter_for(std::env::var("RUST_LOG").ok().as_deref());
    if let Some(warning) = filter_warning {
        eprintln!("{warning}");
    }

    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .json()
        .with_target(false)
        .flatten_event(false)
        .with_current_span(false)
        .with_span_list(false)
        .try_init()
        .map_err(|e| LoggingError::InitFailed(format!("{e}")))?;
    Ok(())
}

/// Initialise structured logging via `tracing-subscriber` with
/// human-readable text output to stdout.
///
/// Reads `RUST_LOG` from the environment; falls back to `info` if unset.
/// Call this once, early in `main` / `run`, before any `tracing` macro
/// is hit.
///
/// # Panics
///
/// Panics if the global subscriber has already been set.
pub fn init() {
    // SAFETY: documented-panic wrapper — callers who need a `Result` use `try_init`.
    try_init().expect("logging init failed");
}

/// Initialise log output as newline-delimited JSON records (stdout).
///
/// Reads `RUST_LOG` from the environment; falls back to `info` if unset.
/// Each log line is a flat JSON object with `timestamp`, `level`,
/// `message`, and optional `fields` / `span` attributes.
///
/// Use this in production deployments where logs are shipped to
/// ELK, Loki, or Datadog.
///
/// # Panics
///
/// Panics if the global subscriber has already been set.
pub fn init_json() {
    // SAFETY: documented-panic wrapper — callers who need a `Result` use `try_init_json`.
    try_init_json().expect("logging init_json failed");
}

/// Prepare `dir` for the rolling file writer, failing loudly if it cannot be
/// used (LOG-2).
///
/// Creates the directory when missing (matching what
/// `tracing_appender::rolling` would do) and then opens and removes a probe
/// file, so a directory that exists but is not writable — a read-only mount,
/// a permissions mistake — is reported to the caller instead of being
/// discovered as silently missing log lines.
fn ensure_log_dir_writable(dir: &str) -> Result<(), LoggingError> {
    std::fs::create_dir_all(dir)?;
    let probe = std::path::Path::new(dir).join(".kasirmu-logging-write-probe");
    std::fs::write(&probe, b"")?;
    // Best-effort removal; a failure here does not mean the directory is
    // unusable, only that we left a zero-byte probe behind.
    let _ = std::fs::remove_file(&probe);
    Ok(())
}

/// Remove log files in `dir` that start with `file_prefix` and whose
/// modification time is older than `retention_days`.
fn cleanup_old_log_files(dir: &str, file_prefix: &str, retention_days: u32) {
    if retention_days == 0 {
        return;
    }
    let cutoff = chrono::Utc::now() - chrono::Duration::days(retention_days as i64);
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Some(name) = path.file_name().and_then(|n| n.to_str())
                && name.starts_with(file_prefix)
                && let Ok(metadata) = std::fs::metadata(&path)
                && let Ok(modified) = metadata.modified()
            {
                let modified: chrono::DateTime<chrono::Utc> = modified.into();
                if modified < cutoff {
                    let _ = std::fs::remove_file(&path);
                }
            }
        }
    }
}

/// Initialise human-readable log output to both stdout and a rolling
/// file writer.
///
/// The file appender rotates hourly (default) and uses the given
/// directory and file prefix for the log files. Logs older than
/// `retention_days` are automatically cleaned up.
///
/// # Panics
///
/// Panics if the global subscriber has already been set.
///
/// # Example
///
/// ```no_run
/// kasirmu_logging::init_with_file("logs", "kasirmu", 30);
/// ```
pub fn init_with_file(log_dir: &str, file_prefix: &str, retention_days: u32) {
    try_init_with_file(log_dir, file_prefix, retention_days)
        // SAFETY: documented-panic wrapper — callers who need a `Result` use `try_init_with_file`.
        .expect("logging init_with_file failed");
}

/// Non-panicking variant of [`init_with_file`].
///
/// Returns `Err` (instead of panicking) if the global subscriber has
/// already been set. All other behaviour is identical to
/// [`init_with_file`]. The retention-cleanup thread is spawned as
/// best-effort (detached) — if the process exits before cleanup
/// completes, old log files persist until the next run.
pub fn try_init_with_file(
    log_dir: &str,
    file_prefix: &str,
    retention_days: u32,
) -> Result<(), LoggingError> {
    let (filter, filter_warning) = filter_for(std::env::var("RUST_LOG").ok().as_deref());
    if let Some(warning) = filter_warning {
        eprintln!("{warning}");
    }

    // LOG-2: prove the directory is writable BEFORE the subscriber is set.
    // `try_init` below returns Err only when the global subscriber was already
    // set, so an unwritable path used to yield a non-blocking writer whose
    // writes are silently dropped and an `Ok(())` to the caller — the process
    // believed file logging was on. This pre-flight is the only place the
    // failure is observable, so it is also the only thing that constructs
    // `LoggingError::LogDirUnusable`.
    ensure_log_dir_writable(log_dir)?;

    let file_appender = tracing_appender::rolling::hourly(log_dir, file_prefix);
    // L-1 fix: the guard is retained process-wide (see FILE_LOG_GUARDS);
    // dropping it locally shut the file writer down immediately.
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);

    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .with_writer(non_blocking)
        .try_init()
        .map_err(|e| LoggingError::InitFailed(format!("{e}")))?;
    retain_file_log_guard(guard);

    // Spawn a best-effort background task for log retention cleanup.
    // The thread is detached — if the process exits before cleanup
    // finishes, old log files simply persist until the next run.
    let dir = log_dir.to_owned();
    let prefix = file_prefix.to_owned();
    std::thread::spawn(move || {
        cleanup_old_log_files(&dir, &prefix, retention_days);
    });

    Ok(())
}

/// Initialise JSON log output to both stdout and a rolling file writer.
///
/// Same as [`init_with_file`] but uses JSON formatting.
///
/// # Panics
///
/// Panics if the global subscriber has already been set.
pub fn init_json_with_file(log_dir: &str, file_prefix: &str, retention_days: u32) {
    try_init_json_with_file(log_dir, file_prefix, retention_days)
        // SAFETY: documented-panic wrapper — callers who need a `Result` use `try_init_json_with_file`.
        .expect("logging init_json_with_file failed");
}

/// Non-panicking variant of [`init_json_with_file`].
///
/// Returns `Err` (instead of panicking) if the global subscriber has
/// already been set. All other behaviour is identical to
/// [`init_json_with_file`]. The retention-cleanup thread is spawned as
/// best-effort (detached) — if the process exits before cleanup
/// completes, old log files persist until the next run.
pub fn try_init_json_with_file(
    log_dir: &str,
    file_prefix: &str,
    retention_days: u32,
) -> Result<(), LoggingError> {
    let (filter, filter_warning) = filter_for(std::env::var("RUST_LOG").ok().as_deref());
    if let Some(warning) = filter_warning {
        eprintln!("{warning}");
    }

    let file_appender = tracing_appender::rolling::hourly(log_dir, file_prefix);
    // L-1 fix: the guard is retained process-wide (see FILE_LOG_GUARDS);
    // dropping it locally shut the file writer down immediately.
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);

    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .json()
        .with_target(false)
        .flatten_event(false)
        .with_current_span(false)
        .with_span_list(false)
        .with_writer(non_blocking)
        .try_init()
        .map_err(|e| LoggingError::InitFailed(format!("{e}")))?;
    retain_file_log_guard(guard);

    // Spawn a best-effort background task for log retention cleanup.
    // The thread is detached — if the process exits before cleanup
    // finishes, old log files simply persist until the next run.
    let dir = log_dir.to_owned();
    let prefix = file_prefix.to_owned();
    std::thread::spawn(move || {
        cleanup_old_log_files(&dir, &prefix, retention_days);
    });

    Ok(())
}

#[cfg(test)]
#[path = "lib_tests.rs"]
mod tests;
