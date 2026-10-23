//! Continuous retention for the rolling log directory (debt entry O-M60).
//!
//! Before this module the retention sweep was `std::thread::spawn`ed exactly
//! once, from `try_init_with_file` / `try_init_json_with_file`, and never ran
//! again. Against an **hourly** rotation (24 files a day, with no count or
//! size cap) that means a process which stays up for weeks stops deleting
//! anything the moment it starts: every file written after init is never
//! pruned. The log directory grows until the process is restarted.
//!
//! # Trigger and sweep
//!
//! - **Trigger** -- [`RetainerWriter`], a writer in the chain between the
//!   non-blocking worker and the rolling file appender. It sees every write
//!   the worker performs and compares an in-memory deadline; when the
//!   deadline has passed it runs the sweep and re-arms. Log lines alone are
//!   not a sufficient trigger (an idle till writes nothing for hours), so
//!   [`spawn_heartbeat`] keeps a thread that pushes a sentinel byte through
//!   the same chain. [`RetainerWriter`] swallows that byte, so the appender
//!   never sees it and nothing is appended to the log file.
//!
//!   The swallow rule is **exact whole-buffer equality**: a write is treated
//!   as the sentinel only when its entire contents equal [`HEARTBEAT`]. Do
//!   not "fix" this to search for the sentinel inside a larger buffer -- a
//!   log line that merely contains a NUL byte is real output and must be
//!   written, not eaten. The worker hands over one formatted record per
//!   write, so real lines are never mistaken for the sentinel; the reason a
//!   lone NUL can never be real output is recorded on the constant itself.
//!
//! - **Sweep** -- [`Retainer::run_due`], which walks the directory once,
//!   removes `<prefix>*` files whose modification time is older than
//!   `retention_days`, and **reports** what it could not remove. O-M60: the
//!   pre-fix code discarded `remove_file`'s error with `let _ =`.
//!
//! # Cost
//!
//! The per-batch check is one relaxed load of an `AtomicIsize` and one
//! comparison. The directory is read **only** when the deadline is due.
//!
//! # No runtime
//!
//! Everything here is `std`. `kasirmu-logging` deliberately has no async
//! runtime -- it is initialised from a Tauri `setup` closure and, for
//! `cloud-server`, from `main` before any executor exists -- so the periodic
//! trigger is a plain thread, not `tokio::spawn`. No dependency is added.
//!
//! # `retention_days = 0` keeps everything
//!
//! `0` means *retention is off*, not *delete everything*. That is what the
//! pre-O-M60 code did (`if retention_days == 0 { return; }`) and both Tauri
//! shells really do pass `0` today, so re-reading it as "delete all" would
//! wipe an install's log history on the next upgrade -- exactly when that
//! history is worth having. [`Retainer::new`] therefore returns `None` for
//! `0`, and neither the writer nor the heartbeat thread is installed.
//!
//! # The clock is injectable
//!
//! `Retainer` takes `now: Box<dyn Fn() -> SystemTime + Send + Sync>` plus a
//! monotonic `epoch`. Production passes `SystemTime::now`; the tests pass a
//! counter behind an `AtomicU64` and jump it by days, so "a process was up
//! long enough for a file to age out" is asserted without sleeping.

use std::path::PathBuf;

#[cfg(test)]
use std::path::Path;
use std::sync::atomic::{AtomicIsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};

/// How often the retention sweep runs while the process is up.
///
/// Hourly, because the rotation is hourly: sweeping as often as a new file
/// appears is the tightest bound on directory size, and it costs one
/// `read_dir` over roughly `24 * retention_days` entries per hour. The
/// deadline is measured from the *last actual sweep* rather than from a
/// fixed sleep, so a suspended laptop (the main uptime pattern for a till)
/// runs one catch-up sweep on wake instead of drifting one interval per
/// suspend.
pub const RETENTION_SWEEP_INTERVAL: Duration = Duration::from_secs(60 * 60);

/// How long the heartbeat thread sleeps between nudges of the writer.
///
/// Half the sweep interval, so a pending sweep is executed within half an
/// interval of becoming due even when nothing is being logged.
pub const RETENTION_HEARTBEAT: Duration = Duration::from_secs(30 * 60);

/// The one-byte sentinel the heartbeat writes.
///
/// This is a single NUL byte (`0x00`), written in source as the escape
/// `\x00` -- one backslash. It must not be confused with a four-character
/// string spelling out the escape: a multi-byte sentinel would be forwarded
/// to the appender and appear in the log file verbatim.
///
/// # Why a one-byte sentinel cannot collide with real log output
///
/// [`RetainerWriter`] swallows a write only when the buffer is **exactly**
/// this sentinel, so the question is whether a real log line can ever be a
/// lone NUL byte. It cannot, for two independent reasons:
///
/// 1. Both formatters bracket every record in an ANSI escape (`\x1b[` for
///    text, `{` for JSON), so no formatted line starts with NUL.
/// 2. The worker delivers one whole formatted record per write, and the
///    record format is never zero bytes long.
///
/// If the record format is ever changed so that a line could begin with a
/// NUL, this sentinel -- not the comparison -- is what must change: widen it
/// and keep the "whole buffer equals the sentinel" test below the same.
const HEARTBEAT: &[u8] = b"\x00";

/// One retention sweep's outcome, returned by `Retainer::run_due`.
///
/// Public so tests can assert on what a sweep did rather than only on its
/// side effects.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct SweepReport {
    /// Files removed by this sweep.
    pub removed: usize,
    /// Files matching the prefix that were past the cutoff but could not be
    /// removed, with the reason. O-M60: the pre-fix code discarded this
    /// error, so a permissions problem was indistinguishable from an empty
    /// backlog.
    pub failed: Vec<(PathBuf, String)>,
}

impl SweepReport {
    /// `true` when the sweep was a no-op: nothing removed, nothing failed.
    pub fn is_empty(&self) -> bool {
        self.removed == 0 && self.failed.is_empty()
    }
}

/// State shared between the writer layer and the heartbeat thread.
pub(crate) struct Retainer {
    dir: PathBuf,
    file_prefix: String,
    /// Kept so `retention_days()` can report what an init installed; the sweep
    /// itself uses the pre-computed `retention` duration.
    #[cfg_attr(not(test), allow(dead_code))]
    retention_days: u32,
    interval: Duration,
    retention: Duration,
    now: Box<dyn Fn() -> SystemTime + Send + Sync>,
    due: AtomicIsize,
    arm: Mutex<()>,
    epoch: Instant,
}

/// A duration as an `isize` count of nanoseconds, saturating at `isize::MAX`.
///
/// The deadline is stored in an `AtomicIsize` so the per-write check is a
/// single relaxed load. Saturating (rather than wrapping) keeps "very far in
/// the future" meaning exactly that after the conversion.
fn nanos_to_isize(d: Duration) -> isize {
    d.as_nanos().min(isize::MAX as u128) as isize
}

impl Retainer {
    /// Build a retainer, or `None` when `retention_days == 0`.
    ///
    /// `now` is the injectable wall clock and `epoch` the monotonic reference
    /// the deadline is measured from. A `retention_days` of `0` returns
    /// `None`, so callers skip both the writer and the heartbeat: that is the
    /// documented "retention off" value and it has to cost nothing.
    pub(crate) fn new(
        dir: impl Into<PathBuf>,
        file_prefix: impl Into<String>,
        retention_days: u32,
        now: Box<dyn Fn() -> SystemTime + Send + Sync>,
        epoch: Instant,
    ) -> Option<Arc<Self>> {
        Self::with_interval(
            dir,
            file_prefix,
            retention_days,
            RETENTION_SWEEP_INTERVAL,
            now,
            epoch,
        )
    }

    /// [`Retainer::new`] with an explicit sweep interval.
    ///
    /// Production always passes [`RETENTION_SWEEP_INTERVAL`]; the shorter
    /// interval exists so a test can observe a real end-to-end sweep through
    /// the writer chain in milliseconds.
    pub(crate) fn with_interval(
        dir: impl Into<PathBuf>,
        file_prefix: impl Into<String>,
        retention_days: u32,
        interval: Duration,
        now: Box<dyn Fn() -> SystemTime + Send + Sync>,
        epoch: Instant,
    ) -> Option<Arc<Self>> {
        if retention_days == 0 {
            return None;
        }
        let retainer = Arc::new(Self {
            dir: dir.into(),
            file_prefix: file_prefix.into(),
            retention_days,
            interval,
            retention: Duration::from_secs(u64::from(retention_days) * 86_400),
            now,
            due: AtomicIsize::new(0),
            arm: Mutex::new(()),
            epoch,
        });
        // The first sweep is due at once: this preserves the init-time sweep
        // the pre-O-M60 code performed, so a process that starts and exits
        // quickly still prunes.
        retainer.rearm(Instant::now());
        Some(retainer)
    }

    /// Run the sweep if the deadline has passed.
    ///
    /// Returns `None` when the sweep was not yet due -- the common path, one
    /// relaxed load and one comparison.
    pub(crate) fn run_due(&self, now: Instant) -> Option<SweepReport> {
        if self.offset(now) < self.due.load(Ordering::Relaxed) {
            return None;
        }
        // Only one caller widens the window. `arm` is a NON-reentrant mutex, so
        // the store below is `store_deadline`, never `rearm` -- calling the
        // locking wrapper while this guard is held would self-deadlock. The
        // re-check after taking the guard matters because another thread may
        // have swept between the load above and the lock.
        let _guard = self.arm.lock().unwrap_or_else(|e| e.into_inner());
        if self.offset(now) < self.due.load(Ordering::Relaxed) {
            return None;
        }
        let report = self.sweep();
        self.store_deadline(now);
        Some(report)
    }

    /// Run the sweep unconditionally and re-arm, ignoring the deadline.
    ///
    /// This is the init-time sweep: it always happens, exactly as the
    /// pre-O-M60 detached thread did, and it leaves the deadline armed so the
    /// next one fires after a full interval.
    pub(crate) fn run_now(&self) -> SweepReport {
        let report = self.sweep();
        self.rearm(Instant::now());
        report
    }

    /// Monotonic `now` as nanoseconds after `epoch`, saturating.
    fn offset(&self, now: Instant) -> isize {
        nanos_to_isize(now.saturating_duration_since(self.epoch))
    }

    /// Arm the deadline to fire `interval` after `from`.
    ///
    /// The arithmetic is checked rather than plain: `Duration::add` panics on
    /// overflow, and [`Retainer::with_interval`] accepts an arbitrary
    /// interval (the tests use it, and a caller could pass `Duration::MAX`).
    /// On overflow the deadline is clamped to `isize::MAX` nanoseconds, which
    /// is the "never due again" value the `offset` comparison saturates at --
    /// so an absurd interval disables the periodic sweep instead of panicking
    /// the non-blocking worker thread. The init-time sweep has already run,
    /// so retention is not silently off when this happens.
    fn rearm(&self, from: Instant) {
        let _guard = self.arm.lock().unwrap_or_else(|e| e.into_inner());
        self.store_deadline(from);
    }

    /// Arm the deadline to fire `interval` after `from`, WITHOUT locking.
    ///
    /// Split out of [`Retainer::rearm`] because `run_due` already holds `arm`
    /// when it re-arms; the caller is responsible for holding the lock. Kept as
    /// an `AtomicIsize` store so the fast path in `run_due`'s first check stays
    /// lock-free.
    fn store_deadline(&self, from: Instant) {
        let next = from
            .saturating_duration_since(self.epoch)
            .checked_add(self.interval)
            .unwrap_or(Duration::MAX);
        self.due.store(nanos_to_isize(next), Ordering::Relaxed);
    }

    /// One directory walk: remove `<prefix>*` files older than the cutoff.
    fn sweep(&self) -> SweepReport {
        let mut report = SweepReport::default();
        let Some(cutoff) = (self.now)().checked_sub(self.retention) else {
            // The stored age reaches past the representable instant range, so
            // the cutoff cannot be computed. Deleting against a bogus cutoff
            // could remove everything; decline and say so.
            report.failed.push((
                self.dir.clone(),
                "retention cutoff is not representable on this clock; sweep skipped".to_owned(),
            ));
            return report;
        };
        let Ok(entries) = std::fs::read_dir(&self.dir) else {
            // A directory that has gone away is not worth an error per file;
            // the next sweep looks again.
            return report;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            if !name.starts_with(self.file_prefix.as_str()) {
                continue;
            }
            let Ok(modified) = entry.metadata().and_then(|m| m.modified()) else {
                continue;
            };
            if modified >= cutoff {
                continue;
            }
            match std::fs::remove_file(&path) {
                Ok(()) => report.removed += 1,
                Err(error) => report.failed.push((path, error.to_string())),
            }
        }
        report
    }

    /// The configured retention in whole days (`>= 1`).
    #[cfg(test)]
    pub(crate) fn retention_days(&self) -> u32 {
        self.retention_days
    }

    /// The directory this retainer sweeps.
    #[cfg(test)]
    pub(crate) fn dir(&self) -> &Path {
        &self.dir
    }
}

/// A writer that runs the retention sweep whenever the deadline is due.
///
/// Sits between the non-blocking worker and the rolling file appender, so it
/// observes every write the worker performs. That placement matters for three
/// reasons:
///
/// - `MakeWriter` is `&self`, so a layer in that position can only carry
///   atomics between writes -- which is exactly the shape the deadline needs.
/// - The worker calls `write_all` then `flush` once per batch, so a burst of
///   log lines costs one check per batch rather than one per line.
/// - Writes only reach it on the worker thread, which already serialises all
///   file access, so the sweep never runs on a thread trying to emit a line.
///
/// It forwards every byte to the real appender except [`HEARTBEAT`], which
/// [`spawn_heartbeat`] pushes through and which is consumed here.
pub(crate) struct RetainerWriter<W> {
    inner: W,
    retainer: Arc<Retainer>,
}

impl<W> RetainerWriter<W> {
    /// Wrap `inner`, checking the retainer deadline on each write and flush.
    pub(crate) fn new(inner: W, retainer: Arc<Retainer>) -> Self {
        Self { inner, retainer }
    }
}

impl<W: std::io::Write> std::io::Write for RetainerWriter<W> {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        if buf == HEARTBEAT {
            // Heartbeat byte: run the deadline check, but never reach the log
            // file, so nothing is appended and no rotation is triggered.
            let _ = self.retainer.run_due(Instant::now());
            return Ok(buf.len());
        }
        let written = self.inner.write(buf)?;
        let _ = self.retainer.run_due(Instant::now());
        Ok(written)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        let flushed = self.inner.flush();
        let _ = self.retainer.run_due(Instant::now());
        flushed
    }
}

/// Start the detached heartbeat thread for `retainer`.
///
/// A log line is the natural retention trigger, but it only fires while the
/// process is actually logging. A till that is open and idle for an afternoon
/// writes nothing, so the deadline would go unseen until the next line --
/// which is exactly the long-running-process case this module exists to fix.
/// The heartbeat thread pushes [`HEARTBEAT`] into the same non-blocking writer
/// once every [`RETENTION_HEARTBEAT`], so the sweep is driven by wall-clock
/// time and not by log traffic.
///
/// The thread never touches the filesystem itself. The heartbeat byte is a
/// `Msg::Line` through the channel, so the worker thread -- the only thread
/// that already owns the appender -- performs the check and any directory
/// walk, keeping the sweep off the heartbeat thread entirely.
///
/// The handle is a *clone* of the `NonBlocking` writer the subscriber holds;
/// cloning is cheap (a channel sender and an error counter) and the worker
/// outlives the guard, which is retained for the process lifetime.
///
/// A failed spawn costs the heartbeat, not the process: the writer layer
/// still checks the deadline on every real log line, so only the "nothing is
/// being logged" case degrades.
pub(crate) fn spawn_heartbeat(
    writer: tracing_appender::non_blocking::NonBlocking,
    retainer: Arc<Retainer>,
) {
    // The retainer is not used on this thread: the check happens on the
    // writer's worker thread. It is kept as a parameter so a caller cannot
    // start a heartbeat for a retainer it is not also wiring in, which keeps
    // the two obviously paired at every call site.
    let _ = &retainer;
    std::thread::Builder::new()
        .name("kasirmu-logging-retention".to_owned())
        .spawn(move || {
            loop {
                std::thread::sleep(RETENTION_HEARTBEAT);
                let mut writer = writer.clone();
                let _ = std::io::Write::write_all(&mut writer, HEARTBEAT);
            }
        })
        // A failed spawn costs the heartbeat, not the process: the writer layer
        // still checks the deadline on every real log line, so only the
        // "nothing is being logged" case degrades.
        .ok();
}

#[cfg(test)]
#[path = "retention_tests.rs"]
mod tests;
