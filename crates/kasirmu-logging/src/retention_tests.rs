use super::*;
use std::sync::atomic::AtomicU64;

/// A fresh scratch directory for one test, removed when the guard drops.
///
/// This used to be `std::env::temp_dir()` with a hand-rolled pid/nanos suffix,
/// copied from the pre-O-M60 tests. That is a trap on this project's Windows
/// machines: the MACHINE-level `TEMP` is `C:\WINDOWS\TEMP`, where an ordinary
/// user can create but not delete, so `create_dir_all` fails with
/// `Access is denied. (os error 5)` the moment a stale fixture exists, and
/// every test in this file reports it as a product defect. `kasirmu_test_support`
/// roots the same per-call-unique directory under the gitignored `target/`,
/// which is both writable and cleanable, and its
/// `scratch_root_is_never_windows_temp` test pins that so it cannot come back.
///
/// The `ScratchDir` guard is returned rather than the bare path so the
/// directory is removed on drop; the tests below bind it as
/// `let (_scratch, dir) = temp_dir(..)`. Keeping `dir` a `PathBuf` means no
/// test's *semantics* change — only where the directory lives.
fn temp_dir(tag: &str) -> (kasirmu_test_support::ScratchDir, PathBuf) {
    let guard = kasirmu_test_support::ScratchDir::new(&format!("kasirmu-retention-{tag}"));
    let dir = guard.path().to_path_buf();
    (guard, dir)
}

/// The wall-clock "now" every test stamps against.
///
/// Day 100, far from the Unix epoch so an accidentally-epoch-dated fixture is
/// obvious rather than plausible, and far from the platform's file-time
/// granularity. `Clock::start` uses the same value, so a file stamped at
/// `EPOCH_SECS` is exactly "now" to the retainer.
const EPOCH_SECS: u64 = 100 * 86_400;

/// Write a file whose modification time is `age_days` before [`EPOCH_SECS`].
///
/// The age is measured against the *injected* clock, not against the real
/// system clock: a fixture dated from `UNIX_EPOCH` would look fifty-odd years
/// old to a clock starting at day 100 and would be swept out from under a test
/// that expected it to survive.
fn backdated(dir: &Path, name: &str, age_days: u64) -> PathBuf {
    let path = dir.join(name);
    std::fs::write(&path, b"log line").expect("test file must be writable");
    let when = EPOCH_SECS.saturating_sub(86_400 * age_days);
    stamp(&path, when);
    path
}

/// Stamp a file's mtime to `secs` seconds after the Unix epoch.
fn stamp(path: &Path, secs: u64) {
    let when = SystemTime::UNIX_EPOCH + Duration::from_secs(secs);
    std::fs::File::options()
        .write(true)
        .open(path)
        .expect("the file must be openable for a stamp")
        .set_modified(when)
        .expect("mtime must be settable");
}

/// An `Instant` `offset` after now, clamped so the addition cannot overflow.
///
/// `Instant + Duration` panics ("overflow when adding duration to instant")
/// once the sum leaves the platform's representable range: a bare
/// `Instant::now() + Duration::from_secs(100_000 * 86_400)` aborts the test
/// binary rather than failing one test. Tests that mean "a long time later"
/// therefore build the instant through this (checked_add), falling back to
/// "now" when even that is out of range — which still exercises the clamping
/// in `Retainer::rearm`, since the retainer is the side that must not panic.
fn future_instant(offset: Duration) -> Instant {
    let now = Instant::now();
    now.checked_add(offset).unwrap_or(now)
}

/// Wait out a short sweep interval so the next writer call is genuinely due.
///
/// The injected clock moves *wall-clock* time, but the deadline is measured on
/// the *monotonic* clock (`Instant`), which a test cannot move. When the
/// trigger under test is `RetainerWriter` — which calls `run_due(Instant::now())`
/// itself — the test therefore has to let a few milliseconds of monotonic time
/// pass. Every test that drives the retainer through `run_due` directly instead
/// injects the instant and waits for nothing.
fn await_interval(interval: Duration) {
    std::thread::sleep(interval + Duration::from_millis(20));
}

/// A controllable wall clock shared with the retainer.
struct Clock(Arc<AtomicU64>);

impl Clock {
    /// Start at day 100 so the "now" values are far from the Unix epoch and
    /// from the platform's file-time granularity.
    fn start() -> (Self, Arc<AtomicU64>) {
        let secs = Arc::new(AtomicU64::new(EPOCH_SECS));
        (Self(Arc::clone(&secs)), secs)
    }

    fn boxed(&self) -> Box<dyn Fn() -> SystemTime + Send + Sync> {
        let secs = Arc::clone(&self.0);
        Box::new(move || SystemTime::UNIX_EPOCH + Duration::from_secs(secs.load(Ordering::Relaxed)))
    }

    /// Advance the shared clock by whole days.
    fn advance_days(secs: &AtomicU64, days: u64) {
        secs.fetch_add(days * 86_400, Ordering::Relaxed);
    }
}

// ── The clock is injectable, so nothing here sleeps ─────────────────

/// The O-M60 case, end to end: a file older than the retention window is
/// deleted by a *later* sweep, with no restart.
#[test]
fn sweep_deletes_a_backdated_file_after_the_interval_passes() {
    let (_scratch, dir) = temp_dir("later-sweep");
    let old = backdated(&dir, "kasirmu.2026-09-01-00", 60);
    let fresh = dir.join("kasirmu.2026-10-01-00");
    std::fs::write(&fresh, b"log line").unwrap();

    let (clock, secs) = Clock::start();
    // Day 100; retention 30 days, so the cutoff is day 70. The backdated
    // file sits at day 60 -- already past the cutoff.
    let retainer = Retainer::with_interval(
        dir.clone(),
        "kasirmu",
        30,
        Duration::from_millis(50),
        clock.boxed(),
        Instant::now(),
    )
    .expect("retention_days = 30 must install a retainer");

    // The first sweep is the init-time sweep the pre-O-M60 code performed,
    // and it already prunes.
    let first = retainer.run_now();
    assert_eq!(first.removed, 1, "the init-time sweep must still prune");
    assert!(!old.exists(), "a file older than retention must be gone");
    assert!(fresh.exists(), "a fresh file must survive");

    // Now the long-running part: a new file ages out while the process is
    // up, and a subsequent deadline-driven sweep removes it.
    let aged = backdated(&dir, "kasirmu.2026-10-02-00", 10);
    assert!(aged.exists(), "the file starts out present");

    // Not due yet: a sweep within the interval is a no-op.
    assert!(
        retainer.run_due(Instant::now()).is_none(),
        "a sweep inside the interval must not run"
    );
    assert!(aged.exists(), "a file inside the interval must survive");

    // The process has now been up for 31 more days: the clock has moved the
    // file past the 30-day cutoff, and the deadline has elapsed.
    Clock::advance_days(&secs, 31);
    let later = retainer
        .run_due(future_instant(Duration::from_millis(51)))
        .expect("the deadline has passed, so the sweep must run");
    assert_eq!(later.removed, 1, "the aged file must be deleted");
    assert!(!aged.exists(), "retention must work without a restart");

    // And the deadline is re-armed, so it does not fire again immediately.
    assert!(
        retainer
            .run_due(future_instant(Duration::from_millis(52)))
            .is_none(),
        "the deadline must be re-armed after a sweep"
    );
}

/// The entry is specifically about a *long-running* process. Prove that the
/// number of sweeps is bounded by elapsed time, not by the number of writes:
/// one log line after the interval has passed produces exactly one sweep.
#[test]
fn one_write_after_the_deadline_runs_exactly_one_sweep() {
    let (_scratch, dir) = temp_dir("one-write");
    let (clock, secs) = Clock::start();
    let retainer = Retainer::with_interval(
        dir.clone(),
        "kasirmu",
        7,
        Duration::from_millis(50),
        clock.boxed(),
        Instant::now(),
    )
    .unwrap();
    let _ = retainer.run_now();

    // Age a file past the 7-day window, then advance time past the interval.
    let aged = backdated(&dir, "kasirmu.old", 8);
    Clock::advance_days(&secs, 10);

    let now = future_instant(Duration::from_millis(60));
    assert!(retainer.run_due(now).is_some(), "the first write sweeps");
    assert!(retainer.run_due(now).is_none(), "the second write does not");
    assert!(retainer.run_due(now).is_none(), "nor does the third");
    assert!(!aged.exists(), "the aged file must be gone");
}

/// The deadline is measured from the last actual sweep, so a process that was
/// suspended for days catches up with ONE sweep rather than firing once per
/// missed interval.
#[test]
fn a_suspended_process_runs_one_catch_up_sweep_not_one_per_missed_interval() {
    let (_scratch, dir) = temp_dir("suspend");
    let (clock, _secs) = Clock::start();
    let interval = Duration::from_millis(10);
    let retainer = Retainer::with_interval(
        dir.clone(),
        "kasirmu",
        7,
        interval,
        clock.boxed(),
        Instant::now(),
    )
    .unwrap();
    let _ = retainer.run_now();

    // "Suspend": 500 intervals pass with no write at all.
    let wake = future_instant(interval * 500);
    assert!(retainer.run_due(wake).is_some(), "the wake sweep must run");
    assert!(
        retainer.run_due(wake).is_none(),
        "the wake sweep must be exactly one, not one per missed interval"
    );
    // And the next one is a full interval after the wake.
    assert!(
        retainer
            .run_due(future_instant(interval * 500 + interval / 2))
            .is_none()
    );
    assert!(
        retainer
            .run_due(future_instant(interval * 500 + interval))
            .is_some()
    );
}

// ── retention_days = 0 keeps everything ─────────────────────────────

#[test]
fn retention_days_zero_disables_retention_entirely() {
    let (_scratch, dir) = temp_dir("zero-days");
    let (clock, _secs) = Clock::start();
    let retainer = Retainer::with_interval(
        dir.clone(),
        "kasirmu",
        0,
        RETENTION_SWEEP_INTERVAL,
        clock.boxed(),
        Instant::now(),
    );
    assert!(
        retainer.is_none(),
        "retention_days = 0 must install nothing -- it means off, not delete-all"
    );

    // Belt and braces: even if something swept, 0 must delete nothing.
    let old = backdated(&dir, "kasirmu.ancient", 3_650);
    let guard = Retainer::with_interval(
        dir.clone(),
        "kasirmu",
        0,
        Duration::ZERO,
        clock.boxed(),
        Instant::now(),
    );
    assert!(guard.is_none());
    assert!(
        old.exists(),
        "ten years old must still be kept when retention is 0"
    );
}

/// One day is the smallest value that means "on", and it must be honoured as
/// a real window rather than rounding to zero.
#[test]
fn retention_days_one_is_on_and_deletes_older_than_a_day() {
    let (_scratch, dir) = temp_dir("one-day");
    let (clock, _secs) = Clock::start();
    let retainer = Retainer::with_interval(
        dir.clone(),
        "kasirmu",
        1,
        Duration::from_millis(10),
        clock.boxed(),
        Instant::now(),
    )
    .unwrap();
    assert_eq!(retainer.retention_days(), 1);
    assert_eq!(retainer.dir(), dir.as_path());

    // A file whose mtime is inside the one-day window is 12 hours old;
    // a file two days old is past it.
    let twelve_hours = backdated(&dir, "kasirmu.hours", 0);
    backdated(&dir, "kasirmu.hours2", 0);
    // Backdate both precisely: 12h and 48h before "now" (day 100).
    for (name, hours) in [("kasirmu.hours", 12u64), ("kasirmu.hours2", 48)] {
        let path = dir.join(name);
        let when = SystemTime::UNIX_EPOCH + Duration::from_secs(100 * 86_400 - hours * 3_600);
        std::fs::File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_modified(when)
            .unwrap();
    }

    let report = retainer.run_now();
    assert_eq!(report.removed, 1, "only the 48-hour-old file is past 1 day");
    assert!(
        twelve_hours.exists(),
        "a 12-hour-old file survives a 1-day window"
    );
}

// ── The sweep keeps its old guarantees ─────────────────────────────

#[test]
fn sweep_skips_files_with_a_different_prefix() {
    let (_scratch, dir) = temp_dir("prefix");
    let (clock, _secs) = Clock::start();
    let retainer = Retainer::with_interval(
        dir.clone(),
        "kasirmu",
        7,
        Duration::from_millis(10),
        clock.boxed(),
        Instant::now(),
    )
    .unwrap();
    let other = backdated(&dir, "other-app.log", 90);
    let mine = backdated(&dir, "kasirmu.old", 90);

    let report = retainer.run_now();
    assert_eq!(report.removed, 1);
    assert!(report.failed.is_empty());
    assert!(other.exists(), "another app's files are not ours to delete");
    assert!(!mine.exists());
}

#[test]
fn sweep_on_an_empty_directory_reports_nothing() {
    let (_scratch, dir) = temp_dir("empty");
    let (clock, _secs) = Clock::start();
    let retainer = Retainer::with_interval(
        dir.clone(),
        "kasirmu",
        7,
        Duration::from_millis(10),
        clock.boxed(),
        Instant::now(),
    )
    .unwrap();
    let report = retainer.run_now();
    assert!(report.is_empty(), "nothing to do must be a quiet sweep");
    assert_eq!(report, SweepReport::default());
}

#[test]
fn sweep_on_a_directory_that_vanished_is_quiet() {
    let (_scratch, dir) = temp_dir("gone");
    let (clock, _secs) = Clock::start();
    let retainer = Retainer::with_interval(
        dir.clone(),
        "kasirmu",
        7,
        Duration::from_millis(10),
        clock.boxed(),
        Instant::now(),
    )
    .unwrap();
    let report = retainer.run_now();
    assert!(
        report.is_empty(),
        "a missing dir is not a failure to report"
    );
}

/// O-M60's second clause: a deletion failure must be *reported*, not
/// discarded. On Windows a file that is already open without FILE_SHARE_DELETE
/// cannot be removed, which gives a deterministic, cross-platform-ish way to
/// force the error path.
#[test]
fn sweep_reports_files_it_could_not_remove() {
    let (_scratch, dir) = temp_dir("undeletable");
    let (clock, _secs) = Clock::start();
    let retainer = Retainer::with_interval(
        dir.clone(),
        "kasirmu",
        7,
        Duration::from_millis(10),
        clock.boxed(),
        Instant::now(),
    )
    .unwrap();

    let held = backdated(&dir, "kasirmu.locked", 90);
    // Hold the file open for the duration of the sweep.
    let handle = std::fs::File::options()
        .read(true)
        .open(&held)
        .expect("the test file must be openable");

    let report = retainer.run_now();
    drop(handle);

    if report.failed.is_empty() {
        // The platform allowed the delete despite the open handle; that is a
        // valid outcome, and the file is simply gone.
        assert!(!held.exists(), "if nothing failed, the file must be gone");
    } else {
        assert_eq!(report.failed.len(), 1);
        assert_eq!(report.failed[0].0, held);
        assert!(
            !report.failed[0].1.is_empty(),
            "a reported failure must carry its reason"
        );
        assert_eq!(report.removed, 0);
    }
}

/// A clock whose "now" cannot represent the cutoff must decline to sweep
/// rather than compute a bogus cutoff and delete everything.
#[test]
fn an_unrepresentable_cutoff_declines_the_sweep() {
    let (_scratch, dir) = temp_dir("bad-clock");
    let ancient = backdated(&dir, "kasirmu.old", 0);
    // Find the platform's minimum representable SystemTime so that
    // `now().checked_sub(retention)` underflows on all platforms (Windows, Linux, etc.).
    let min_time = {
        let mut current = SystemTime::UNIX_EPOCH;
        let mut step = Duration::from_secs(1 << 62);
        while step.as_secs() > 0 {
            if let Some(prev) = current.checked_sub(step) {
                current = prev;
            }
            step = Duration::from_secs(step.as_secs() / 2);
        }
        current
    };
    let now: Box<dyn Fn() -> SystemTime + Send + Sync> = Box::new(move || min_time);
    let retainer = Retainer::with_interval(
        dir.clone(),
        "kasirmu",
        365_000,
        Duration::from_millis(10),
        now,
        Instant::now(),
    )
    .unwrap();
    let report = retainer.run_now();
    assert_eq!(report.removed, 0, "nothing may be deleted");
    assert_eq!(report.failed.len(), 1, "the skipped sweep must say why");
    assert!(ancient.exists(), "the file must be untouched");
}

// ── The writer layer ───────────────────────────────────────────────

/// The sentinel is ONE byte, not the four characters of its own escape.
///
/// A byte-string literal does not interpret escapes the way a string literal
/// is often assumed to: the source spelling of a NUL byte is the escape
/// `\x00` -- ONE backslash -- and `b"\\x00"` would be a literal backslash
/// followed by `x00`, four bytes that the appender would write into the log
/// file verbatim. Pinning the length here catches that the moment the literal
/// is mistyped.
#[test]
fn the_heartbeat_sentinel_is_exactly_one_nul_byte() {
    assert_eq!(HEARTBEAT.len(), 1, "the sentinel must be a single byte");
    assert_eq!(
        HEARTBEAT,
        &[0u8],
        "the sentinel must be a NUL byte, not text"
    );
    // And it must not be the literal spelling of its own escape, which is the
    // four-byte trap this test exists for.
    assert_ne!(HEARTBEAT, b"\\x00", "the sentinel must not be text");
}

/// A heartbeat write must leave the inner writer untouched: the sentinel is
/// consumed by [`RetainerWriter`] and never forwarded to the appender.
///
/// This is the assertion that makes Defect 1 visible. With a four-byte sentinel
/// the `Vec` would contain `\x00x00` and this test would fail; the corrected
/// single-byte literal leaves it empty.
#[test]
fn a_heartbeat_write_reaches_the_inner_writer_zero_times() {
    let (_scratch, dir) = temp_dir("sentinel-swallow");
    let (clock, _secs) = Clock::start();
    let retainer = Retainer::with_interval(
        dir.clone(),
        "kasirmu",
        7,
        Duration::from_millis(50),
        clock.boxed(),
        Instant::now(),
    )
    .unwrap();

    let mut sink: Vec<u8> = Vec::new();
    {
        let mut writer = RetainerWriter::new(&mut sink, Arc::clone(&retainer));
        std::io::Write::write_all(&mut writer, HEARTBEAT).unwrap();
        std::io::Write::write_all(&mut writer, HEARTBEAT).unwrap();
        std::io::Write::flush(&mut writer).unwrap();
    }
    assert!(
        sink.is_empty(),
        "the sentinel must be swallowed, not written to the log file; got {:?}",
        String::from_utf8_lossy(&sink)
    );
}

/// An absurd interval must not panic. `Duration::add` overflows and panics, so
/// the deadline arithmetic has to be checked; a caller (or a test) can reach
/// `with_interval` with any value at all.
#[test]
fn an_absurd_interval_does_not_panic_and_disables_the_periodic_sweep() {
    let (_scratch, dir) = temp_dir("absurd-interval");
    let (clock, _secs) = Clock::start();
    let retainer = Retainer::with_interval(
        dir.clone(),
        "kasirmu",
        7,
        Duration::MAX,
        clock.boxed(),
        Instant::now(),
    )
    .expect("a retainer must still be constructed");

    // The init-time sweep has already run, so retention is not silently off.
    let init = retainer.run_now();
    assert!(init.is_empty(), "an empty directory sweeps quietly");

    // No deadline can ever fire again, and computing one must not panic.
    let later = future_instant(Duration::from_secs(60 * 60 * 24 * 365));
    assert!(
        retainer.run_due(later).is_none(),
        "an interval that cannot be represented must mean never-due, not a panic"
    );
}

/// The same clamp must hold when the interval is merely very large rather than
/// `Duration::MAX`, because the clamp is on the *sum* of the offset and the
/// interval, not on the interval alone.
#[test]
fn a_very_large_interval_is_clamped_not_wrapped() {
    let (_scratch, dir) = temp_dir("large-interval");
    let (clock, _secs) = Clock::start();
    let retainer = Retainer::with_interval(
        dir.clone(),
        "kasirmu",
        7,
        Duration::MAX,
        clock.boxed(),
        Instant::now(),
    )
    .unwrap();
    let _ = retainer.run_now();

    // Far in the future, and still not due. A wrapped deadline would compare
    // as due and sweep immediately here.
    for days in [1u64, 10, 1_000, 100_000] {
        let at = future_instant(Duration::from_secs(days * 86_400));
        assert!(
            retainer.run_due(at).is_none(),
            "day {days}: a clamped deadline must never look due"
        );
    }
}

/// The O-M60 requirement, end to end and through the real writer chain.
///
/// A file older than `retention_days` is deleted by a *later* sweep, with no
/// restart, and the clock is injected rather than slept on: the file's mtime
/// and the retainer's "now" are both derived from the same counter, so the
/// only thing being exercised is the deadline and the directory walk. The
/// trigger is a real write through [`RetainerWriter`], not a direct call into
/// the retainer, so the whole chain is covered.
#[test]
fn a_file_older_than_retention_is_deleted_through_the_writer_chain() {
    let (_scratch, dir) = temp_dir("end-to-end");
    let (clock, secs) = Clock::start();
    const DAY: u64 = 86_400;

    // Short interval so the sweep deadline is reachable; the *wall* clock that
    // decides the cutoff is the injected one, so nothing ages in real time.
    let interval = Duration::from_millis(50);
    // Retention is 7 days, so the cutoff is (injected now) - 7 days.
    let retainer = Retainer::with_interval(
        dir.clone(),
        "kasirmu",
        7,
        interval,
        clock.boxed(),
        Instant::now(),
    )
    .expect("retention_days = 7 must install a retainer");
    let _ = retainer.run_now();

    // A file stamped at "now" is inside the window and must survive a
    // write that is not yet due.
    let fresh = dir.join("kasirmu.2026-10-01-00");
    std::fs::write(&fresh, b"line\n").unwrap();
    stamp(&fresh, 100 * DAY);
    {
        let mut writer = RetainerWriter::new(std::io::sink(), Arc::clone(&retainer));
        std::io::Write::write_all(&mut writer, b"a real log line\n").unwrap();
    }
    assert!(fresh.exists(), "a file inside the window must survive");

    // Now the process runs for 8 more days: the injected clock moves past
    // the window, so that same file is now 8 days old against a 7-day
    // retention, and the sweep deadline has elapsed.
    Clock::advance_days(&secs, 8);
    // The writer reads the monotonic clock itself, so let the short interval pass.
    await_interval(interval);
    {
        let mut writer = RetainerWriter::new(std::io::sink(), Arc::clone(&retainer));
        std::io::Write::write_all(&mut writer, HEARTBEAT).unwrap();
    }
    assert!(
        !fresh.exists(),
        "a file older than retention_days must be deleted without a restart"
    );
}

/// The writer must forward real bytes and consume only the heartbeat.
#[test]
fn the_writer_forwards_lines_and_swallows_the_heartbeat() {
    let (_scratch, dir) = temp_dir("writer");
    let (clock, secs) = Clock::start();
    let interval = Duration::from_millis(50);
    let retainer = Retainer::with_interval(
        dir.clone(),
        "kasirmu",
        7,
        interval,
        clock.boxed(),
        Instant::now(),
    )
    .unwrap();

    let mut sink: Vec<u8> = Vec::new();
    {
        let mut writer = RetainerWriter::new(&mut sink, Arc::clone(&retainer));
        std::io::Write::write_all(&mut writer, b"a real line\n").unwrap();
        std::io::Write::write_all(&mut writer, HEARTBEAT).unwrap();
        std::io::Write::flush(&mut writer).unwrap();
    }
    assert_eq!(
        sink, b"a real line\n",
        "the heartbeat must not reach the file"
    );

    // The heartbeat is what makes an idle process sweep: age a file past the
    // window, move the clock past the interval, then write only a heartbeat.
    let aged = backdated(&dir, "kasirmu.aged", 8);
    Clock::advance_days(&secs, 10);
    await_interval(interval);
    let mut writer = RetainerWriter::new(std::io::sink(), Arc::clone(&retainer));
    std::io::Write::write_all(&mut writer, HEARTBEAT).unwrap();
    assert!(
        !aged.exists(),
        "a heartbeat after the deadline must sweep, with no real log line"
    );
}

/// The heartbeat is not appended to the log file and does not rotate it, so
/// a quiet process produces no new files.
#[test]
fn the_heartbeat_writes_nothing_to_the_appender() {
    let (_scratch, dir) = temp_dir("heartbeat-sink");
    let (clock, _secs) = Clock::start();
    let retainer = Retainer::with_interval(
        dir.clone(),
        "kasirmu",
        7,
        Duration::from_millis(10),
        clock.boxed(),
        Instant::now(),
    )
    .unwrap();

    // A rolling appender is the real inner writer in production.
    let appender = tracing_appender::rolling::hourly(&dir, "kasirmu");
    let mut writer = RetainerWriter::new(appender, Arc::clone(&retainer));
    let before: Vec<PathBuf> = std::fs::read_dir(&dir)
        .unwrap()
        .flatten()
        .map(|e| e.path())
        .collect();
    for _ in 0..5 {
        std::io::Write::write_all(&mut writer, HEARTBEAT).unwrap();
        std::io::Write::flush(&mut writer).unwrap();
    }
    let after: Vec<PathBuf> = std::fs::read_dir(&dir)
        .unwrap()
        .flatten()
        .map(|e| e.path())
        .collect();
    assert_eq!(
        before.len(),
        after.len(),
        "heartbeats must not create files"
    );
    for path in &after {
        let bytes = std::fs::read(path).unwrap();
        assert!(bytes.is_empty(), "a heartbeat byte must not be appended");
    }
}

// ── Wiring helpers ──────────────────────────────────────────────────

/// The init paths must install a retainer for `retention_days >= 1` and
/// nothing at all for `0`, and the retainer must point at the log directory.
#[test]
fn the_init_path_installs_a_retainer_for_a_real_retention() {
    let (_scratch, dir) = temp_dir("wiring");
    let (clock, _secs) = Clock::start();
    let epoch = Instant::now();
    let retainer = crate::retention_retainer_for_test(&dir, "kasirmu", 30, clock.boxed(), epoch);
    let retainer = retainer.expect("retention_days = 30 must install a retainer");
    assert_eq!(retainer.dir(), dir.as_path());
    assert_eq!(retainer.retention_days(), 30);

    let none = crate::retention_retainer_for_test(&dir, "kasirmu", 0, clock.boxed(), epoch);
    assert!(none.is_none(), "retention_days = 0 must install nothing");
}

/// Both public intervals must stay what the module documents, since the
/// justification for each is written in terms of the hourly rotation.
#[test]
fn the_intervals_are_the_documented_ones() {
    assert_eq!(RETENTION_SWEEP_INTERVAL, Duration::from_secs(3_600));
    assert_eq!(RETENTION_HEARTBEAT, Duration::from_secs(1_800));
    assert!(
        RETENTION_HEARTBEAT <= RETENTION_SWEEP_INTERVAL,
        "the heartbeat must not be slower than the sweep it nudges"
    );
}
