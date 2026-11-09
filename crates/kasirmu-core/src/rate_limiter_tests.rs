use super::*;

// ── Deterministic time control (no wall-clock sleeps) ──────────────────────
//
// The sliding window is a comparison against the `Instant` values stored in
// the limiter's map, so a test can stand at any point in the window's future by
// moving those stored timestamps into the past. That reproduces exactly the
// state a real `thread::sleep` would reach — same prune, same lockout maths —
// without paying the wall-clock cost, and without the jitter that forces
// tolerance ranges such as `(8..=10)` into the assertions. Production code is
// untouched: the helpers only mutate the map the tests already reach through
// `limiter.attempts`, the same seam `apps/cloud-server/src/rate_limit_tests.rs:25`
// uses for the cloud server's token bucket (`bucket.last_refill`).

/// Back-date every recorded attempt of each username in `usernames` by `older_by`.
///
/// Use when the whole window for those users must have elapsed, so that the
/// prune step drops them.
fn backdate_attempts(limiter: &LoginRateLimiter, usernames: &[&str], older_by: Duration) {
    let mut map = limiter.attempts.lock().unwrap();
    for username in usernames {
        let Some(attempts) = map.get_mut(*username) else {
            panic!("no attempts recorded for {username:?}");
        };
        for timestamp in attempts.iter_mut() {
            *timestamp = timestamp
                .checked_sub(older_by)
                .expect("stored attempt must be newer than the back-date offset");
        }
    }
}

/// Back-date only the FIRST (oldest) recorded attempt of `username` by `older_by`.
///
/// `attempts` is oldest-first, so this ages the single timestamp the lockout
/// maths reads (`attempts[0]`) while leaving the newer attempts fresh — the
/// state that distinguishes "retry_after is based on the oldest attempt" from
/// "it is based on the newest".
fn backdate_first_attempt(limiter: &LoginRateLimiter, username: &str, older_by: Duration) {
    let mut map = limiter.attempts.lock().unwrap();
    let Some(attempts) = map.get_mut(username) else {
        panic!("no attempts recorded for {username:?}");
    };
    let Some(oldest) = attempts.first_mut() else {
        panic!("{username:?} must have at least one recorded attempt");
    };
    *oldest = oldest
        .checked_sub(older_by)
        .expect("stored attempt must be newer than the back-date offset");
}

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

    // Let the window elapse — deterministically. Both stored timestamps move
    // 2 seconds into the past, which is the exact state the sleep used to
    // reach; the prune compares against the stored values and cannot tell the
    // difference.
    backdate_attempts(&limiter, &["alice"], Duration::from_secs(2));

    // Should succeed — old attempts pruned. max=2, 1 recorded → 1 remaining.
    assert_eq!(limiter.record_failure("alice").unwrap(), 1);
}

#[test]
fn window_expiry_partial_prune() {
    // When some attempts are inside the window and some outside,
    // only the old ones are pruned.
    let limiter = LoginRateLimiter::new(3, 1); // 1-second window
    limiter.record_failure("alice").ok(); // t=0
    limiter.record_failure("alice").ok(); // t≈0 — still in window
    // Deterministic stand-in for the old "600ms, attempt, 600ms" choreography:
    // age ONLY the first attempt past the 1-second window and leave the second
    // fresh. That is the state those two sleeps were trying to reach — attempt
    // #1 outside the window, attempt #2 inside — reached without the waits.
    backdate_first_attempt(&limiter, "alice", Duration::from_millis(1_500));
    // First attempt (1.5s old) is now outside the window, second (fresh) is inside.
    // Pruning leaves 1 attempt; the third call pushes the vec to 2, so exactly
    // 1 attempt remains before lockout.
    assert_eq!(limiter.record_failure("alice").unwrap(), 1);
}

// ── retry_after exact value ──────────────────────────────────────────

#[test]
fn retry_after_is_based_on_oldest_attempt() {
    // retry_after = window_secs - elapsed_since_oldest.
    let limiter = LoginRateLimiter::new(2, 10); // 10-second window
    limiter.record_failure("alice").ok(); // t=0
    limiter.record_failure("alice").ok(); // t≈0 — locked out (max=2)
    // Deterministic stand-in for the old 1-second sleep between the attempts:
    // age ONLY the oldest timestamp by exactly 1 second and leave the second
    // attempt fresh. The result is then only correct if the code reads
    // `attempts[0]` — which is precisely what this test names.
    backdate_first_attempt(&limiter, "alice", Duration::from_secs(1));
    let err = limiter.record_failure("alice").unwrap_err();
    // retry_after = window_secs - elapsed_since_oldest = 10 - 1 = 9, exactly.
    // The old assertion tolerated the range (8..=10) to absorb sleep jitter;
    // with the timestamps under test control the value is pinned instead.
    assert_eq!(err, 9, "retry_after should be exactly 9, got {err}");
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

// ── COR-2: the map must not grow without bound ───────────────────────

/// COR-2 regression. The login form is unauthenticated, so the username is an
/// attacker-controlled map key. Before the fix, `record_failure` inserted an
/// entry per distinct name and removed none: the per-key vector was pruned but
/// the key lived forever, so N requests with N distinct usernames leaked N
/// entries for the life of the process.
///
/// A zero-length window makes every recorded attempt expire immediately, so the
/// only reason a key could survive is the bug itself. With eviction the map is
/// emptied on every call — the count stays at exactly 1 (the key just added, not
/// yet revisited) no matter how many distinct names are thrown at it.
#[test]
fn distinct_usernames_do_not_accumulate_without_bound() {
    let limiter = LoginRateLimiter::new(3, 0); // everything expires at once
    for i in 0..10_000 {
        limiter.record_failure(&format!("spray-{i}")).ok();
    }
    assert_eq!(
        limiter.tracked_usernames(),
        1,
        "only the key added by the current call may remain; {0} entries would be the leak",
        limiter.tracked_usernames()
    );
}

/// The same property stated against a live window: usernames whose attempts have
/// all aged out are dropped, so the tracked set is bounded by activity inside the
/// window rather than by the process lifetime.
#[test]
fn expired_usernames_are_evicted_and_live_ones_are_kept() {
    // 1-second window: long enough that a live entry is retained, short enough
    // that the back-date below reliably expires it.
    let limiter = LoginRateLimiter::new(3, 1);
    limiter.record_failure("alice").ok();
    limiter.record_failure("bob").ok();
    assert_eq!(limiter.tracked_usernames(), 2, "both names are live");

    // Deterministic stand-in for the 1100ms sleep: age both names' attempts
    // past the 1-second window instead of waiting for the window to pass.
    backdate_attempts(&limiter, &["alice", "bob"], Duration::from_millis(1_100));

    // A brand-new name arrives; the sweep must drop the two expired ones.
    limiter.record_failure("carol").ok();
    assert_eq!(
        limiter.tracked_usernames(),
        1,
        "alice and bob expired and must be gone; only carol remains"
    );
    // And the retained set really is carol: her lockout still works.
    limiter.record_failure("carol").ok();
    assert!(limiter.record_failure("carol").is_err());
}

/// Eviction must never drop a username that is still locked out — that would
/// hand an attacker a free reset simply by waiting for an unrelated sweep.
#[test]
fn eviction_never_clears_a_live_lockout() {
    let limiter = LoginRateLimiter::new(2, 3600); // 1-hour window
    limiter.record_failure("alice").ok();
    assert!(
        limiter.record_failure("alice").is_err(),
        "alice is locked out"
    );

    // Traffic from other names triggers the sweep repeatedly.
    for i in 0..500 {
        limiter.record_failure(&format!("noise-{i}")).ok();
    }

    assert!(
        limiter.record_failure("alice").is_err(),
        "alice's lockout must survive 500 sweeps"
    );
    assert!(
        limiter.tracked_usernames() >= 1,
        "alice's entry must still be tracked"
    );
}

// ── O-M10: capacity bound protects against login spray floods ────────

#[test]
fn max_tracked_capacity_evicts_oldest_non_locked_entry() {
    let limiter = LoginRateLimiter::with_max_tracked(3, 3600, 3);
    // User alice is locked out (3 attempts)
    limiter.record_failure("alice").ok();
    limiter.record_failure("alice").ok();
    assert!(limiter.record_failure("alice").is_err());

    // User bob has 1 attempt
    limiter.record_failure("bob").ok();

    // User charlie has 1 attempt -> now at max capacity (3)
    limiter.record_failure("charlie").ok();
    assert_eq!(limiter.tracked_usernames(), 3);

    // User dave arrives -> exceeds capacity 3, should evict oldest non-locked (bob)
    limiter.record_failure("dave").ok();
    assert_eq!(limiter.tracked_usernames(), 3);

    // Alice must still be locked out!
    assert!(limiter.record_failure("alice").is_err());
}
