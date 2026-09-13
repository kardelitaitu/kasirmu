//! Kernel lock lifecycle audit — verifies that the bounded-retry pattern
//! in AppState::drop() correctly handles lock contention during shutdown.
//!
//! The Drop implementation uses a 500ms bounded retry loop to acquire the
//! kernel lock. This test simulates contention scenarios and verifies the
//! retry behaviour is correct — it should either acquire within 500ms or
//! log a warning and proceed (never panic, never hang indefinitely).

use std::sync::Arc;
use std::time::{Duration, Instant};

use platform_kernel::Kernel;
use tokio::sync::Mutex;

// ── Test helpers ────────────────────────────────────────────────────

/// Simulate the Drop retry pattern used in app state.
/// Returns (acquired, elapsed_ms).
fn simulate_drop_retry(kernel: &Mutex<Kernel>, max_retries: usize, delay_ms: u64) -> (bool, u64) {
    let start = Instant::now();
    let mut acquired = false;
    for _ in 0..max_retries {
        if let Ok(mut k) = kernel.try_lock() {
            let _ = k.stop_all();
            acquired = true;
            break;
        }
        std::thread::sleep(Duration::from_millis(delay_ms));
    }
    let elapsed = start.elapsed().as_millis() as u64;
    (acquired, elapsed)
}

// ── Tests ───────────────────────────────────────────────────────────

#[test]
fn kernel_drop_acquires_when_uncontended() {
    let kernel = Mutex::new(Kernel::new());
    let (acquired, elapsed) = simulate_drop_retry(&kernel, 50, 10);
    assert!(
        acquired,
        "should acquire uncontended kernel lock immediately"
    );
    assert!(
        elapsed < 50,
        "uncontended lock should be near-instant, took {elapsed}ms"
    );
}

#[test]
fn kernel_drop_retries_and_eventually_succeeds() {
    let kernel = Arc::new(Mutex::new(Kernel::new()));
    let k_clone = kernel.clone();

    // Hold the lock from another thread for 150ms.
    let join_handle = std::thread::spawn(move || {
        let guard = k_clone.blocking_lock();
        std::thread::sleep(Duration::from_millis(150));
        drop(guard);
    });

    // Small delay to let the other thread acquire first.
    std::thread::sleep(Duration::from_millis(10));

    let (acquired, elapsed) = simulate_drop_retry(&kernel, 50, 10);
    join_handle.join().unwrap();

    assert!(acquired, "should eventually acquire after holder releases");
    assert!(
        (130..=520).contains(&elapsed),
        "should take roughly 150ms to acquire, took {elapsed}ms"
    );
}

#[test]
fn kernel_drop_respects_max_retries() {
    let kernel = Arc::new(Mutex::new(Kernel::new()));
    let k_clone = kernel.clone();
    let shutdown = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let shutdown_clone = shutdown.clone();

    // Hold the lock indefinitely until signalled.
    let join_handle = std::thread::spawn(move || {
        let guard = k_clone.blocking_lock();
        while !shutdown_clone.load(std::sync::atomic::Ordering::SeqCst) {
            std::thread::sleep(Duration::from_millis(10));
        }
        drop(guard);
    });

    // Small delay so the holder acquires first.
    std::thread::sleep(Duration::from_millis(10));

    let (acquired, elapsed) = simulate_drop_retry(&kernel, 5, 10);
    shutdown.store(true, std::sync::atomic::Ordering::SeqCst);
    join_handle.join().unwrap();

    assert!(
        !acquired,
        "should NOT acquire when holder never releases within retries"
    );
    assert!(
        (40..=120).contains(&elapsed),
        "5 retries × 10ms should take ~50ms, took {elapsed}ms"
    );
}

#[test]
fn kernel_try_lock_returns_none_when_contended() {
    let kernel = Arc::new(Mutex::new(Kernel::new()));
    let k_clone = kernel.clone();

    let holder = std::thread::spawn(move || {
        let guard = k_clone.blocking_lock();
        std::thread::sleep(Duration::from_millis(200));
        drop(guard);
    });

    std::thread::sleep(Duration::from_millis(10));

    // try_lock should fail while another thread holds.
    assert!(
        kernel.try_lock().is_err(),
        "try_lock should fail when contended"
    );

    holder.join().unwrap();

    // After release, try_lock should succeed.
    assert!(
        kernel.try_lock().is_ok(),
        "try_lock should succeed after holder releases"
    );
}

#[test]
fn kernel_stop_all_idempotent() {
    // stop_all() should be safe to call on an empty kernel.
    let mut kernel = Kernel::new();
    let result = kernel.stop_all();
    assert!(result.is_ok(), "stop_all on empty kernel should succeed");
}

#[test]
fn bounded_retry_runs_at_least_once() {
    // Even with 0 retries (max_retries=1), we should attempt once.
    let kernel = Mutex::new(Kernel::new());
    // We DON'T hold the lock — should succeed on first attempt.
    let (acquired, _) = simulate_drop_retry(&kernel, 1, 10);
    assert!(acquired, "should acquire on first and only attempt");
}

#[test]
fn retry_timing_is_within_bounds() {
    // WHAT THIS PINS: the bounded-retry loop spends its whole budget and never
    // acquires a lock that is held from underneath it. That is the behaviour, and
    // it is now asserted directly - attempt count and `!stopped` - with the
    // milliseconds sitting on top of it as a cadence check.
    //
    // WHY THE BOUND MOVED, measured not guessed. This used `elapsed <= 650ms`
    // against a nominal 50 x 10ms = 500ms: 30% headroom, on a platform whose
    // default system timer resolution is 15.625ms. sleep(10ms) therefore costs
    // 10-15.6ms per call before any scheduler delay, so 50 sleeps legitimately
    // reach ~781ms with NO regression in the code under test - the old ceiling sat
    // BELOW the platform's own worst case. At e046e2f26 this target measured:
    // ten single-test runs unloaded, min / median / max target wall time
    // 0.53 / 0.53 / 0.54s (the retry loop itself ~500-520ms); inside an unfiltered
    // `cargo test -p oz-pos-app` with three other sessions compiling at the same
    // time it took 654ms and FAILED. A bound a busy machine can cross while every
    // line of production code is fine is a red somebody re-runs instead of
    // investigating, and dev-ci.yml#cargo-nextest runs this crate on shared runners.
    //
    // So both bounds are now RELATIVE to what sleep(10ms) actually costs this
    // machine this run, measured in this process just before the loop. Neither
    // bound was deleted: the lower one is what still stops this passing by being
    // instant, the upper one is what stops a runaway loop.
    const RETRIES: u32 = 50;

    let kernel = Arc::new(Mutex::new(Kernel::new()));
    let k_clone = kernel.clone();
    let shutdown = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let sd = shutdown.clone();

    let holder = std::thread::spawn(move || {
        let guard = k_clone.blocking_lock();
        while !sd.load(std::sync::atomic::Ordering::SeqCst) {
            std::thread::sleep(Duration::from_millis(10));
        }
        drop(guard);
    });

    std::thread::sleep(Duration::from_millis(10));

    // Calibrate the ruler before measuring with it: five of the SAME sleeps
    // the loop is about to take, averaged.
    let cal_start = Instant::now();
    for _ in 0..5 {
        std::thread::sleep(Duration::from_millis(10));
    }
    let unit = cal_start.elapsed() / 5;
    assert!(
        unit >= Duration::from_millis(5) && unit <= Duration::from_millis(100),
        "sleep(10ms) calibrated at {unit:?} per call is not a credible ruler on any platform (10-15.6ms unloaded, more under load): every bound below compares against it, so refuse rather than pass vacuously"
    );

    let start = Instant::now();
    let mut attempts = 0u32;
    let mut stopped = false;
    for _ in 0..RETRIES {
        attempts += 1;
        if let Ok(mut k) = kernel.try_lock() {
            let _ = k.stop_all();
            stopped = true;
            break;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    let elapsed = start.elapsed();

    shutdown.store(true, std::sync::atomic::Ordering::SeqCst);
    holder.join().unwrap();

    assert_eq!(
        attempts, RETRIES,
        "the retry budget must be spent in full while the lock is held; it gave up after {attempts} of {RETRIES} attempts"
    );
    assert!(!stopped, "should not stop when held indefinitely");
    // 50 sleeps cost ~50 units. Floor 45 units, so an early return or a sleep
    // that stopped sleeping cannot pass. Ceiling 75 units = 1.5x the cadence
    // measured in the same breath, which absorbs timer-resolution and scheduler
    // drift without absorbing a 50% slowdown.
    assert!(
        elapsed >= unit * (RETRIES - 5) && elapsed <= unit * (RETRIES * 3 / 2),
        "50 retries x sleep(10ms) took {elapsed:?} against a calibrated per-sleep unit of {unit:?}; expected between {:?} and {:?} (unloaded this loop runs ~500ms; 654ms was observed under three concurrent builds)",
        unit * (RETRIES - 5),
        unit * (RETRIES * 3 / 2)
    );
}
