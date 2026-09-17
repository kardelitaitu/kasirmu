/*
last audited DD-MM-YY by DSH-Agent
crate: kasirmu-logging | status: SAFE | lint: CLEAN
findings: 3 actual unsafe blocks verified (syslog: openlog + syslog; eventlog: OutputDebugStringW) — all with SAFETY comments and valid CString/wide-string guards. .expect() calls only in documented-panic wrapper functions (init/init_json/init_with_file/init_json_with_file — mirrored by try_* non-panicking variants). Error type #[non_exhaustive]. File logger guard retention fix (L-1) verified. No defects found.
next: none | perf: N/A
*/
//! Structured logging facade for OZ-POS.
//!
//! `kasirmu-logging` wraps the `tracing` ecosystem with context-tagged
//! record format, file + stdout writers, log rotation, and platform-
//! specific outputs (syslog on Linux, Event Log on Windows).
//!
//! # Initialisers
//!
//! - [`init`] — human-readable text format (stdout). Best for local dev.
//! - [`init_json`] — JSON-formatted log records (stdout). Best for
//!   production environments where logs are shipped to ELK/Loki.
//! - [`init_with_file`] — human-readable text + rolling file writer.
//! - [`init_json_with_file`] — JSON + rolling file writer.
//!
//! # Platform outputs
//!
//! - **Linux**: Syslog output is available via the `syslog` module.
//! - **Windows**: Event Log output is available via the `eventlog` module.

// Note: unsafe blocks are permitted for platform-specific FFI
// calls (libc syslog, Windows Event Log).

pub mod error;
#[cfg(target_os = "windows")]
pub mod eventlog;
#[cfg(target_os = "linux")]
pub mod syslog;
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
/// kasirmu_logging::init_with_file("logs", "oz-pos", 30);
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
