use super::*;

#[test]
fn allows_up_to_max_attempts() {
    let limiter = LoginRateLimiter::new(3, 60);
    assert_eq!(limiter.record_failure("alice").unwrap(), 2);
    assert_eq!(limiter.record_failure("alice").unwrap(), 1);
}

#[test]
fn locks_out_after_max_attempts() {
    let limiter = LoginRateLimiter::new(3, 60);
    limiter.record_failure("alice").ok();
    limiter.record_failure("alice").ok();
    // Third attempt triggers lockout.
    let result = limiter.record_failure("alice");
    assert!(result.is_err());
    // Fourth attempt is also locked out.
    let result = limiter.record_failure("alice");
    assert!(result.is_err());
}

#[test]
fn lockout_has_reasonable_duration() {
    let limiter = LoginRateLimiter::new(3, 60);
    limiter.record_failure("alice").ok();
    limiter.record_failure("alice").ok();
    let result = limiter.record_failure("alice");
    let err = result.unwrap_err();
    assert!(err <= 60, "lockout should not exceed window");
    assert!(err >= 1, "lockout should be at least 1 second");
}

#[test]
fn reset_clears_attempts() {
    let limiter = LoginRateLimiter::new(3, 60);
    limiter.record_failure("alice").ok();
    limiter.record_failure("alice").ok();
    limiter.reset("alice");
    assert_eq!(limiter.record_failure("alice").unwrap(), 2);
}

#[test]
fn different_usernames_independent() {
    let limiter = LoginRateLimiter::new(3, 60);
    limiter.record_failure("alice").ok();
    limiter.record_failure("alice").ok();
    assert!(limiter.record_failure("alice").is_err()); // locked out
    // bob still has full quota
    assert_eq!(limiter.record_failure("bob").unwrap(), 2);
}

#[test]
fn clear_resets_all() {
    let limiter = LoginRateLimiter::new(3, 60);
    limiter.record_failure("alice").ok();
    limiter.record_failure("bob").ok();
    limiter.record_failure("alice").ok();
    limiter.clear();
    assert_eq!(limiter.record_failure("alice").unwrap(), 2);
    assert_eq!(limiter.record_failure("bob").unwrap(), 2);
}

// ── Edge-case: remaining count ─────────────────────────────────

#[test]
fn remaining_count_decrements_correctly() {
    let limiter = LoginRateLimiter::new(5, 60);
    assert_eq!(limiter.record_failure("alice").unwrap(), 4);
    assert_eq!(limiter.record_failure("alice").unwrap(), 3);
    assert_eq!(limiter.record_failure("alice").unwrap(), 2);
    assert_eq!(limiter.record_failure("alice").unwrap(), 1);
    // Fifth attempt hits the lockout boundary.
    assert!(limiter.record_failure("alice").is_err());
}

// ── Edge-case: zero max_attempts always locked ─────────────────

#[test]
fn zero_max_attempts_always_locked() {
    let limiter = LoginRateLimiter::new(0, 60);
    // Even a single attempt should be rejected — zero tolerance.
    let result = limiter.record_failure("alice");
    assert!(result.is_err());
}

// ── Edge-case: single-attempt window ───────────────────────────
//
// With max_attempts=1, the Nth attempt (the first) is recorded but
// immediately triggers lockout: the len check fires after push.

#[test]
fn single_attempt_locks_out() {
    let limiter = LoginRateLimiter::new(1, 60);
    // First attempt is recorded, then immediately locked out.
    assert!(limiter.record_failure("alice").is_err());
    // Second attempt is also locked out (step-2 check catches before push).
    assert!(limiter.record_failure("alice").is_err());
}

// ── Edge-case: serialized fail → reset → fail again ──────────

#[test]
fn fail_reset_fail_cycle() {
    let limiter = LoginRateLimiter::new(2, 60);
    limiter.record_failure("alice").ok();
    limiter.record_failure("alice").ok();
    assert!(limiter.record_failure("alice").is_err());
    limiter.reset("alice");
    assert_eq!(limiter.record_failure("alice").unwrap(), 1);
    // Should lock out again after 2 more.
    assert!(limiter.record_failure("alice").is_err());
}

// ── Edge-case: record_failure on never-failed user ────────────

#[test]
fn first_attempt_returns_max_minus_one() {
    let limiter = LoginRateLimiter::new(3, 60);
    assert_eq!(limiter.record_failure("new-user").unwrap(), 2);
}

// ── Edge-case: Debug output does not leak timestamps ──────────

#[test]
fn debug_format_does_not_leak_attempts() {
    let limiter = LoginRateLimiter::new(3, 5);
    limiter.record_failure("alice").ok();
    let debug = format!("{limiter:?}");
    assert!(debug.contains("max_attempts: 3"));
    assert!(debug.contains("window_secs: 5"));
    assert!(debug.contains("(locked)"));
    // Should NOT contain timestamps or attempt details.
    assert!(!debug.contains("Instant"));
    assert!(!debug.contains("alice"));
}

// ── Edge-case: default parameters ──────────────────────────────

#[test]
fn default_limiter_uses_3_per_60() {
    let limiter = LoginRateLimiter::default();
    assert_eq!(limiter.record_failure("alice").unwrap(), 2);
    assert_eq!(limiter.record_failure("alice").unwrap(), 1);
    assert!(limiter.record_failure("alice").is_err());
}

// ── First attempt recorded after reset does NOT inherit old state ─

#[test]
fn reset_removes_user_completely() {
    let limiter = LoginRateLimiter::new(3, 60);
    limiter.record_failure("alice").ok();
    limiter.reset("alice");
    // The internal HashMap should have no entry for alice.
    {
        let map = limiter.attempts.lock().unwrap();
        assert!(!map.contains_key("alice"));
    }
}

// ── Lockout does NOT record the rejected attempt ───────────────
//
// When a user is locked out, the rejected attempt should NOT be
// appended, so the retry_after value is based on the original set.
// This means after the window expires, the user has fewer than
// max_attempts remaining (the rejected ones are not counted).

#[test]
fn lockout_does_not_count_rejected_attempts() {
    let limiter = LoginRateLimiter::new(2, 3600); // 1-hour window
    limiter.record_failure("alice").ok();
    limiter.record_failure("alice").ok();
    // Locked out — this attempt is rejected and NOT recorded.
    assert!(limiter.record_failure("alice").is_err());
    assert!(limiter.record_failure("alice").is_err());
    // Internal count should still be exactly 2.
    {
        let map = limiter.attempts.lock().unwrap();
        let attempts = map.get("alice").unwrap();
        assert_eq!(attempts.len(), 2, "rejected attempts must not be appended");
    }
}

// ── Empty-string usernames are valid keys ─────────────────────

#[test]
fn empty_username_is_independent_key() {
    let limiter = LoginRateLimiter::new(2, 60);
    limiter.record_failure("").ok();
    // Second attempt with empty username triggers lockout (max=2).
    assert!(limiter.record_failure("").is_err());
    // 'alice' should still have full quota — independent key space.
    assert_eq!(limiter.record_failure("alice").unwrap(), 1);
}

// ── NEW TESTS: gaps identified in TDD analysis ───────────────────────

// ── Sliding window expiry (core feature) ─────────────────────────────

#[test]
fn window_expiry_allows_retry_after_wait() {
    // The core sliding-window behavior: after the window elapses,
    // old attempts are pruned and the user can try again.
    let limiter = LoginRateLimiter::new(2, 1); // 1-second window
    limiter.record_failure("alice").ok();
    limiter.record_failure("alice").ok();
    assert!(limiter.record_failure("alice").is_err()); // locked out

    // Wait for the window to elapse.
    std::thread::sleep(Duration::from_secs(2));

    // Should succeed — old attempts pruned. max=2, 1 recorded → 1 remaining.
    assert_eq!(limiter.record_failure("alice").unwrap(), 1);
}

#[test]
fn window_expiry_partial_prune() {
    // When some attempts are inside the window and some outside,
    // only the old ones are pruned.
    let limiter = LoginRateLimiter::new(3, 1); // 1-second window
    limiter.record_failure("alice").ok(); // t=0
    std::thread::sleep(Duration::from_millis(600));
    limiter.record_failure("alice").ok(); // t=0.6s — still in window
    std::thread::sleep(Duration::from_millis(600)); // total 1.2s
    // First attempt (t=0) is now outside window, second (t=0.6) is inside.
    // After pruning, only 1 attempt remains → 2 remaining.
    assert_eq!(limiter.record_failure("alice").unwrap(), 1);
}

// ── retry_after exact value ──────────────────────────────────────────

#[test]
fn retry_after_is_based_on_oldest_attempt() {
    // retry_after = window_secs - elapsed_since_oldest.
    let limiter = LoginRateLimiter::new(2, 10); // 10-second window
    limiter.record_failure("alice").ok(); // t=0
    std::thread::sleep(Duration::from_secs(1));
    limiter.record_failure("alice").ok(); // t=1 — locked out (max=2)
    let err = limiter.record_failure("alice").unwrap_err();
    // retry_after ≈ 10 - 1 = 9 seconds (±1 for sleep jitter)
    assert!(
        (8..=10).contains(&err),
        "retry_after should be ~9, got {err}"
    );
}

#[test]
fn retry_after_at_least_one_second() {
    // Even if the oldest attempt is very recent, retry_after >= 1.
    let limiter = LoginRateLimiter::new(1, 60);
    limiter.record_failure("alice").ok(); // immediately locked out
    let err = limiter.record_failure("alice").unwrap_err();
    assert!(err >= 1, "retry_after should be at least 1, got {err}");
    assert!(err <= 60, "retry_after should not exceed window, got {err}");
}

// ── window_secs=0 edge case ──────────────────────────────────────────

#[test]
fn zero_window_always_locks_out() {
    // With a 0-second window, every attempt is outside the window
    // (duration_since(now) = 0, which is NOT < 0), so the vec is always
    // empty after pruning. But max_attempts=1 means the first attempt
    // is recorded and immediately triggers lockout.
    let limiter = LoginRateLimiter::new(1, 0);
    assert!(limiter.record_failure("alice").is_err());
}

#[test]
fn zero_window_with_higher_max() {
    let limiter = LoginRateLimiter::new(5, 0);
    // All attempts are pruned immediately (window=0), so the vec stays
    // empty and we never hit the lockout. Each attempt returns remaining.
    assert_eq!(limiter.record_failure("alice").unwrap(), 4);
    assert_eq!(limiter.record_failure("alice").unwrap(), 4);
    assert_eq!(limiter.record_failure("alice").unwrap(), 4);
}

// ── Concurrent access ────────────────────────────────────────────────

#[test]
fn concurrent_failures_do_not_panic() {
    use std::sync::Arc;
    use std::thread;

    let limiter = Arc::new(LoginRateLimiter::new(100, 60));
    let mut handles = vec![];

    for i in 0..10 {
        let limiter = Arc::clone(&limiter);
        handles.push(thread::spawn(move || {
            for j in 0..10 {
                let username = format!("user-{i}");
                let _ = limiter.record_failure(&username);
                // Mix in resets to exercise contention.
                if j % 3 == 0 {
                    limiter.reset(&username);
                }
            }
        }));
    }

    for h in handles {
        h.join().expect("thread panicked");
    }

    // Verify no corruption — all users should have some attempts or be reset.
    let map = limiter.attempts.lock().unwrap();
    for i in 0..10 {
        let username = format!("user-{i}");
        // Each user may have 0-3 attempts depending on when resets happened.
        if let Some(attempts) = map.get(&username) {
            assert!(
                attempts.len() <= 3,
                "user-{i} has {} attempts, expected <= 3",
                attempts.len()
            );
        }
    }
}

#[test]
fn concurrent_clear_and_record() {
    use std::sync::Arc;
    use std::thread;

    let limiter = Arc::new(LoginRateLimiter::new(10, 60));
    let mut handles = vec![];

    // Half the threads record failures, half clear.
    for i in 0..10 {
        let limiter = Arc::clone(&limiter);
        if i % 2 == 0 {
            handles.push(thread::spawn(move || {
                for _ in 0..10 {
                    let _ = limiter.record_failure("shared-user");
                }
            }));
        } else {
            handles.push(thread::spawn(move || {
                for _ in 0..10 {
                    limiter.clear();
                }
            }));
        }
    }

    for h in handles {
        h.join().expect("thread panicked");
    }
}

// ── max_attempts=0 edge case ─────────────────────────────────────────

#[test]
fn zero_max_attempts_retry_after_is_at_least_one() {
    // The code has: Err(self.window_secs.max(1)).
    // With window_secs=0, retry_after should be 1 (the .max(1) guard).
    let limiter = LoginRateLimiter::new(0, 0);
    let err = limiter.record_failure("alice").unwrap_err();
    assert_eq!(err, 1, "retry_after should be 1 for max=0 window=0");
}

#[test]
fn zero_max_attempts_with_window() {
    let limiter = LoginRateLimiter::new(0, 30);
    let err = limiter.record_failure("alice").unwrap_err();
    assert_eq!(err, 30, "retry_after should be window_secs");
}

// ── Large max_attempts ───────────────────────────────────────────────

#[test]
fn large_max_attempts() {
    let limiter = LoginRateLimiter::new(1000, 60);
    for i in 0..999 {
        let remaining = limiter.record_failure("alice").unwrap();
        assert_eq!(remaining, 999 - i);
    }
    // 1000th attempt triggers lockout.
    assert!(limiter.record_failure("alice").is_err());
}

// ── reset during lockout ─────────────────────────────────────────────

#[test]
fn reset_during_lockout_allows_immediate_retry() {
    let limiter = LoginRateLimiter::new(2, 3600); // 1-hour window
    limiter.record_failure("alice").ok();
    limiter.record_failure("alice").ok();
    assert!(limiter.record_failure("alice").is_err()); // locked out
    limiter.reset("alice");
    // Should succeed immediately — all attempts cleared.
    assert_eq!(limiter.record_failure("alice").unwrap(), 1);
}

// ── clear during lockout ─────────────────────────────────────────────

#[test]
fn clear_during_lockout_allows_immediate_retry() {
    let limiter = LoginRateLimiter::new(2, 3600);
    limiter.record_failure("alice").ok();
    limiter.record_failure("alice").ok();
    assert!(limiter.record_failure("alice").is_err());
    limiter.clear();
    assert_eq!(limiter.record_failure("alice").unwrap(), 1);
}

// ── multiple users during lockout ────────────────────────────────────

#[test]
fn lockout_one_user_does_not_affect_others() {
    let limiter = LoginRateLimiter::new(2, 60);
    // Lock out alice.
    limiter.record_failure("alice").ok();
    limiter.record_failure("alice").ok();
    assert!(limiter.record_failure("alice").is_err());
    // bob, charlie, dave all have full quota.
    assert_eq!(limiter.record_failure("bob").unwrap(), 1);
    assert_eq!(limiter.record_failure("charlie").unwrap(), 1);
    assert_eq!(limiter.record_failure("dave").unwrap(), 1);
}
