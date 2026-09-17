//! Tests for [`lock_or_report`], the poisoned-mutex policy shared by every
//! `RedisCache` operation.
//!
//! These need no Redis: the helper is generic over the guard, so a plain
//! `Mutex<i32>` exercises the exact same decision the connection lock
//! makes. What is under test is a safety choice, not a mechanism — that a
//! poisoned lock is *refused* rather than recovered.

use super::lock_or_report;
use std::sync::{Arc, Mutex};

#[test]
fn a_healthy_lock_hands_back_the_guard() {
    let m = Mutex::new(7i32);
    let guard = lock_or_report(m.lock(), "get_product").expect("unlocked mutex must yield a guard");
    assert_eq!(*guard, 7);
}

#[test]
fn a_poisoned_lock_is_refused_and_not_recovered() {
    let m = Arc::new(Mutex::new(7i32));
    let holder = Arc::clone(&m);
    let h = std::thread::spawn(move || {
        let _g = holder.lock().unwrap();
        panic!("simulated panic while holding the connection lock");
    });
    // The panic poisons the mutex; join() just reports it.
    assert!(h.join().is_err());

    // The decision that matters: no guard escapes. `PoisonError::into_inner`
    // would hand back a value that a panicking thread may have left
    // half-updated — for the real caller, a Redis socket mid-conversation,
    // whose next reply would be attributed to the wrong command.
    assert!(
        lock_or_report(m.lock(), "invalidate_inventory").is_none(),
        "a poisoned lock must be refused, never recovered"
    );
}

#[test]
fn refusing_a_poisoned_lock_does_not_panic_on_the_hot_path() {
    // Callers use `?`/early-return on the Option, so the failure mode must
    // be a quiet skip. A POS sale must not abort because the cache died.
    let m = Arc::new(Mutex::new(7i32));
    let holder = Arc::clone(&m);
    let h = std::thread::spawn(move || {
        let _g = holder.lock().unwrap();
        panic!("poison");
    });
    let _ = h.join();

    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        for _ in 0..3 {
            assert!(lock_or_report(m.lock(), "set_inventory").is_none());
        }
    }));
    assert!(
        outcome.is_ok(),
        "repeated poisoned-lock calls must skip, not unwind"
    );
}
