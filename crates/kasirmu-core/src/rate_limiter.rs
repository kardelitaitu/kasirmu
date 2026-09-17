/*
last audited 25-07-26 by RSA-Agent (oz-core slice A)
crate: oz-core | status: SAFE | lint: CLEAN
findings: sliding-window logic correct (prune -> lockout check -> record -> recheck; max_attempts=0 guarded); poison-recovery on hot path good; COR-2: per-username HashMap unbounded — login-form spam grows memory without cap
next: cap entries or evict idle usernames (COR-2) | perf: pruning bounds per-key vec
*/
//! Sliding-window rate limiter for login PIN attempts.
//!
//! Tracks failed PIN attempts per username. After `LoginRateLimiter::max_attempts`
//! failures within `LoginRateLimiter::window_secs`, the username is locked out
//! until the oldest attempt falls outside the window.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Sliding-window rate limiter for login PIN attempts.
///
/// Tracks failed attempts per username. When the number of attempts within
/// the configured window reaches the maximum, the caller is locked out until
/// the oldest attempt falls outside the window.
///
/// Lock is never held across `.await` points.
pub struct LoginRateLimiter {
    /// Per-username list of attempt timestamps (oldest first after pruning).
    attempts: Mutex<HashMap<String, Vec<Instant>>>,
    /// Maximum failed attempts within the sliding window before lockout.
    max_attempts: usize,
    /// Sliding window duration in seconds.
    window_secs: u64,
}

impl LoginRateLimiter {
    /// Create a new rate limiter.
    ///
    /// * `max_attempts` — number of failed attempts allowed within the window.
    /// * `window_secs` — sliding window duration in seconds.
    #[must_use]
    pub fn new(max_attempts: usize, window_secs: u64) -> Self {
        Self {
            attempts: Mutex::new(HashMap::new()),
            max_attempts,
            window_secs,
        }
    }

    /// Record a failed PIN attempt for `username`.
    ///
    /// # Returns
    ///
    /// * `Ok(remaining)` — the number of attempts remaining before lockout.
    /// * `Err(retry_after_secs)` — the caller is locked out; must wait this
    ///   many seconds before trying again.
    pub fn record_failure(&self, username: &str) -> Result<usize, u64> {
        let mut map = self
            .attempts
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let now = Instant::now();
        let window = Duration::from_secs(self.window_secs);
        let attempts = map.entry(username.to_string()).or_default();

        // Prune entries whose window has expired.
        attempts.retain(|t| now.duration_since(*t) < window);

        // Check lockout BEFORE recording.
        //
        // Guard against empty vec when max_attempts is 0 — the caller is
        // always locked out so we return the full window duration.
        if attempts.len() >= self.max_attempts {
            if attempts.is_empty() {
                return Err(self.window_secs.max(1));
            }
            let oldest = attempts[0];
            let elapsed = now.duration_since(oldest).as_secs();
            let retry_after = self.window_secs.saturating_sub(elapsed);
            return Err(retry_after.max(1));
        }

        // Record this attempt.
        attempts.push(now);

        // Check if this attempt pushed us over the limit.
        if attempts.len() >= self.max_attempts {
            return Err(self.window_secs);
        }

        let remaining = self.max_attempts.saturating_sub(attempts.len());
        Ok(remaining)
    }

    /// Reset the attempt counter for `username` (call on successful login).
    pub fn reset(&self, username: &str) {
        if let Ok(mut map) = self.attempts.lock() {
            map.remove(username);
        }
    }

    /// Clear all records (for testing or admin reset).
    pub fn clear(&self) {
        if let Ok(mut map) = self.attempts.lock() {
            map.clear();
        }
    }
}

impl Default for LoginRateLimiter {
    /// Default: 3 attempts per 60-second sliding window.
    fn default() -> Self {
        Self::new(3, 60)
    }
}

impl std::fmt::Debug for LoginRateLimiter {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LoginRateLimiter")
            .field("max_attempts", &self.max_attempts)
            .field("window_secs", &self.window_secs)
            .field("attempts", &"(locked)")
            .finish()
    }
}

#[cfg(test)]
#[path = "rate_limiter_tests.rs"]
mod tests;
