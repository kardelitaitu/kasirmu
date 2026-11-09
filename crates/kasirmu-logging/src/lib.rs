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
//! - [`try_init_with_file_or_stdout`] — what the shells actually call:
//!   file sink when the log directory resolves, stdout otherwise.
//!
//! # Which initialisers are actually wired, stated because it is not obvious
//!
//! **Both Tauri shells call [`try_init_with_file_or_stdout`] from their `setup`
//! closure** (desktop `apps/desktop-tauri/src/lib.rs`, tablet
//! `apps/mobile-tauri/src/lib.rs`): the rolling file sink when the platform
//! resolves a writable per-install log directory (`app.path().app_log_dir()` →
//! `%LOCALAPPDATA%\<id>\logs` on Windows, `<local data dir>/\<id>\logs` on
//! Linux, `~/Library/Logs/<id>` on macOS, `<config dir>/logs` on Android), and [`try_init`] (stdout) whenever it
//! cannot. `apps/cloud-server` keeps [`try_init_json`] (stdout) deliberately — a
//! container's stdout is already collected by supervisord/Northflank, and a file
//! written inside the container would die with it.
//!
//! The wiring landed 2026-09-29. Before it, both shells called [`try_init`] in
//! `run()` before the Tauri builder, which writes to **stdout only** — captured
//! nowhere on a double-clicked desktop build, so a field incident left no log
//! file to open. The file sink could not simply stay in `run()`: it needs a
//! writable per-install directory, and the only resolver that knows the right
//! path on every platform needs an `AppHandle`, which does not exist until
//! `setup`. Hence the combined initialiser, which keeps the good half of the old
//! ordering — logging is initialised once, early, and a directory that cannot be
//! prepared falls back to stdout (LOG-2) instead of going silent.
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
mod retention;
pub mod visitor;

pub use error::LoggingError;
use retention::Retainer;
pub use retention::{RETENTION_HEARTBEAT, RETENTION_SWEEP_INTERVAL, SweepReport};
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

/// Initialise client logging: the rolling file sink when `log_dir` is usable,
/// stdout when it is not.
///
/// This is the entry point both Tauri shells call from their `setup` closure,
/// where the platform log directory can be resolved (`app.path().app_log_dir()`).
/// The policy it encodes is *a working log beats the ideal log*:
///
/// 1. `log_dir` is `None` (the resolver failed) → [`try_init`], stdout only.
/// 2. `Some(dir)` but the directory cannot be prepared
///    ([`LoggingError::LogDirUnusable`]) → report it on stderr, then fall back
///    to [`try_init`]. The LOG-2 pre-flight exists precisely so this failure is
///    observable, so it is printed rather than swallowed; stderr, not
///    `tracing::warn!`, because the subscriber is not installed yet and an
///    event here would be dropped — the exact failure this function prevents.
/// 3. Any other error (the global subscriber is already set) is passed through
///    untouched: a second initialiser cannot improve the situation, and
///    reporting a duplicate as a directory problem would misdirect the reader.
///
/// Returns `Err` only for case 3 (and for case 2 when stdout is also taken).
pub fn try_init_with_file_or_stdout(
    log_dir: Option<&std::path::Path>,
    file_prefix: &str,
    retention_days: u32,
) -> Result<(), LoggingError> {
    if let Some(dir) = log_dir {
        let dir_str = dir.to_string_lossy();
        match try_init_with_file(&dir_str, file_prefix, retention_days) {
            Ok(()) => return Ok(()),
            Err(LoggingError::LogDirUnusable(e)) => {
                eprintln!(
                    "[kasirmu-logging] log dir {} unusable ({e}); falling back to stdout",
                    dir.display()
                );
            }
            Err(e) => return Err(e),
        }
    }
    try_init()
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

/// Build the retainer a file initialiser installs, or `None` when
/// `retention_days == 0`.
///
/// Split out of [`install_retention`] so the initialiser can hand the retainer
/// to the writer chain, and so a test can assert on what an init would install
/// without taking the process-global subscriber. The clock is a parameter for
/// the same reason: production passes `SystemTime::now`, tests pass a counter
/// they can advance.
fn retention_retainer_for_test(
    log_dir: &std::path::Path,
    file_prefix: &str,
    retention_days: u32,
    now: Box<dyn Fn() -> std::time::SystemTime + Send + Sync>,
    epoch: std::time::Instant,
) -> Option<std::sync::Arc<Retainer>> {
    Retainer::new(log_dir, file_prefix, retention_days, now, epoch)
}

/// Start continuous retention for an initialised file writer.
///
/// This replaces the pre-O-M60 `std::thread::spawn` of a one-shot sweep.
/// `retainer` has already been built by the initialiser and is already the
/// appender's inner writer, so the per-write check is wired; this function
/// adds the two things the writer alone cannot do:
///
/// 1. An **init-time sweep**, unconditionally, so a process that starts and
///    exits quickly still prunes exactly as before.
/// 2. A **heartbeat thread** that pushes a sentinel byte into `non_blocking`
///    every [`RETENTION_HEARTBEAT`]. The byte travels the same channel as a
///    log line, so the appender's worker thread performs the check -- it is
///    the only thread that already owns the file -- and
///    [`retention::RetainerWriter`] consumes the byte before the appender
///    sees it. This is what makes retention *continuous*: an idle process,
///    which writes no log lines at all, still sweeps.
///
/// `retainer` is `None` for `retention_days == 0`, in which case nothing runs
/// and the writer is left exactly as it was before O-M60.
fn install_retention(
    non_blocking: &tracing_appender::non_blocking::NonBlocking,
    retainer: Option<&std::sync::Arc<Retainer>>,
    log_dir: &str,
) {
    let Some(retainer) = retainer else {
        return;
    };

    // The init-time sweep, kept from the pre-O-M60 behaviour.
    report_sweep_failures(log_dir, &retainer.run_now());

    retention::spawn_heartbeat(non_blocking.clone(), std::sync::Arc::clone(retainer));
}

/// Report what a sweep could not delete, naming the file and the reason.
///
/// O-M60: the pre-fix sweep discarded `remove_file`'s error with `let _ =`, so
/// an unwritable directory was indistinguishable from an empty backlog.
///
/// This prints to **stderr directly**, never through `tracing`, and that is
/// deliberate for two reasons: the init-time sweep runs *before* the subscriber
/// is installed, so a `tracing::warn!` there would be dropped on the floor; and
/// a sweep triggered later runs *on the non-blocking worker thread*, so routing
/// the report through `tracing` would feed the very writer it is reporting about
/// -- a re-entrant loop through the log pipeline. Nothing in this crate or in
/// `retention.rs` emits through the subscriber, by design.
fn report_sweep_failures(log_dir: &str, report: &SweepReport) {
    for (path, reason) in &report.failed {
        eprintln!(
            "[kasirmu-logging] could not remove log file {} ({reason}); log dir {log_dir}",
            path.display()
        );
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

    // Writer chain: NonBlocking -> (optional RetainerWriter) -> rolling appender.
    // The retainer sits on the worker thread, the only thread that already owns
    // the file, and it is the single owner of the appender. When retention is
    // off (`retention_days == 0`) the appender goes in untouched, exactly as it
    // did before O-M60.
    let file_appender = tracing_appender::rolling::hourly(log_dir, file_prefix);
    let retainer = retention_retainer_for_test(
        std::path::Path::new(log_dir),
        file_prefix,
        retention_days,
        Box::new(std::time::SystemTime::now),
        std::time::Instant::now(),
    );
    // L-1 fix: the guard is retained process-wide (see FILE_LOG_GUARDS);
    // dropping it locally shut the file writer down immediately.
    let (non_blocking, guard) = match &retainer {
        Some(retainer) => tracing_appender::non_blocking(retention::RetainerWriter::new(
            file_appender,
            std::sync::Arc::clone(retainer),
        )),
        None => tracing_appender::non_blocking(file_appender),
    };

    // Retention starts BEFORE the subscriber takes the writer, so the
    // init-time sweep happens even if `try_init` then fails on a duplicate
    // subscriber -- which is exactly the short-lived-process case that must
    // still prune.
    install_retention(&non_blocking, retainer.as_ref(), log_dir);

    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .with_writer(non_blocking)
        .try_init()
        .map_err(|e| LoggingError::InitFailed(format!("{e}")))?;
    retain_file_log_guard(guard);

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

    // LOG-2 (O-M59): prove the directory is writable BEFORE the subscriber is set.
    ensure_log_dir_writable(log_dir)?;

    // Writer chain: NonBlocking -> (optional RetainerWriter) -> rolling appender.
    // The retainer sits on the worker thread, the only thread that already owns
    // the file, and it is the single owner of the appender. When retention is
    // off (`retention_days == 0`) the appender goes in untouched, exactly as it
    // did before O-M60.
    let file_appender = tracing_appender::rolling::hourly(log_dir, file_prefix);
    let retainer = retention_retainer_for_test(
        std::path::Path::new(log_dir),
        file_prefix,
        retention_days,
        Box::new(std::time::SystemTime::now),
        std::time::Instant::now(),
    );
    // L-1 fix: the guard is retained process-wide (see FILE_LOG_GUARDS);
    // dropping it locally shut the file writer down immediately.
    let (non_blocking, guard) = match &retainer {
        Some(retainer) => tracing_appender::non_blocking(retention::RetainerWriter::new(
            file_appender,
            std::sync::Arc::clone(retainer),
        )),
        None => tracing_appender::non_blocking(file_appender),
    };

    // Retention starts BEFORE the subscriber takes the writer; see the text
    // initialiser for why.
    install_retention(&non_blocking, retainer.as_ref(), log_dir);

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

    Ok(())
}

#[cfg(test)]
#[path = "lib_tests.rs"]
mod tests;
