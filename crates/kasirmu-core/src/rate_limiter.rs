/*
last audited 26-09-26 by DSH (COR-2 CLOSED)
crate: kasirmu-core | status: SAFE | lint: CLEAN
findings: sliding-window logic correct (prune -> lockout check -> record -> recheck; max_attempts=0 guarded); poison-recovery on hot path good. COR-2 CLOSED: the per-username map is now evicted on every record. The original diagnosis was accurate and the mechanism is worth restating precisely, because "unbounded HashMap" undersells it — the per-key VEC was pruned on every call but the KEY was never removed, so the map only ever grew. Since the username is the map key and the login form is unauthenticated, an attacker supplying a distinct name per request allocated one entry per request for the process lifetime; the entry held an empty vec after pruning, so the cost per request was one String plus a map slot that nothing would ever free. `evict_expired_locked` now drops every username whose attempts have all aged out, before the caller's key is inserted, so the map holds at most the names active within the last window. A live lockout is never evicted (its vec is non-empty and in-window), which is asserted rather than assumed. Note the module still has ZERO production callers at HEAD (exported at lib.rs:269, never used), so this was latent — the fix matters because it is a public API whose stated purpose is protecting an unauthenticated form.
next: none for COR-2. | perf: pruning bounds per-key vec AND the key set now; the sweep is O(keys) per record, bounded by the live-username count
*/
//! Sliding-window rate limiter for login PIN attempts.
//!
//! Tracks failed PIN attempts per username. After `LoginRateLimiter::max_attempts`
//! failures within `LoginRateLimiter::window_secs`, the username is locked out
//! until the oldest attempt falls outside the window.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Default maximum number of distinct usernames tracked in memory simultaneously (O-M10).
pub const DEFAULT_MAX_TRACKED_USERNAMES: usize = 10_000;

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
    /// Maximum distinct usernames tracked simultaneously (O-M10 cap against login spray).
    max_tracked: usize,
}

impl LoginRateLimiter {
    /// Create a new rate limiter with default capacity ceiling (10,000 tracked usernames).
    ///
    /// * `max_attempts` — number of failed attempts allowed within the window.
    /// * `window_secs` — sliding window duration in seconds.
    #[must_use]
    pub fn new(max_attempts: usize, window_secs: u64) -> Self {
        Self::with_max_tracked(max_attempts, window_secs, DEFAULT_MAX_TRACKED_USERNAMES)
    }

    /// Create a new rate limiter with a custom capacity ceiling.
    ///
    /// * `max_attempts` — number of failed attempts allowed within the window.
    /// * `window_secs` — sliding window duration in seconds.
    /// * `max_tracked` — maximum distinct usernames tracked before eviction occurs.
    #[must_use]
    pub fn with_max_tracked(max_attempts: usize, window_secs: u64, max_tracked: usize) -> Self {
        Self {
            attempts: Mutex::new(HashMap::new()),
            max_attempts,
            window_secs,
            max_tracked: max_tracked.max(1),
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

        // COR-2: drop usernames whose whole window has expired BEFORE adding the
        // caller's key. Without this the map only ever grows: the per-key vec was
        // pruned, but the key itself was never removed, so a caller that supplies
        // a distinct username per request (the login form is unauthenticated)
        // allocates an entry each time and nothing ever frees it.
        //
        // This runs on every record, so the map holds at most the usernames that
        // have attempted within the last window — bounded by the request rate
        // over the window, not by the process lifetime.
        Self::evict_expired_locked(&mut map, now, window);

        // O-M10: Borrow-keyed lookup to avoid allocating `String` on recurring attempts.
        if let Some(attempts) = map.get_mut(username) {
            // Prune entries whose window has expired.
            attempts.retain(|t| now.duration_since(*t) < window);

            // Check lockout BEFORE recording.
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

            return Ok(self.max_attempts.saturating_sub(attempts.len()));
        }

        // New username branch:
        if self.max_attempts == 0 {
            return Err(self.window_secs.max(1));
        }

        // O-M10: Capacity ceiling enforcement against login spray floods.
        if map.len() >= self.max_tracked {
            let candidate = map
                .iter()
                .filter_map(|(k, v)| {
                    let is_locked = v.len() >= self.max_attempts;
                    v.first().map(|&oldest| (k.clone(), oldest, is_locked))
                })
                .min_by_key(|(_, oldest, is_locked)| (*is_locked, *oldest));

            if let Some((victim, _, _)) = candidate {
                map.remove(&victim);
            }
        }

        map.insert(username.to_string(), vec![now]);

        if 1 >= self.max_attempts {
            return Err(self.window_secs.max(1));
        }

        Ok(self.max_attempts.saturating_sub(1))
    }

    /// Remove every username whose attempts have all fallen outside the window.
    ///
    /// COR-2. A username with a non-empty, still-live attempt list is retained —
    /// its lockout is the whole point of the map. A username whose every entry
    /// has aged out carries no information (the next attempt from that name
    /// starts at zero anyway) and is dropped, which is what keeps the map from
    /// growing without bound.
    fn evict_expired_locked(
        map: &mut HashMap<String, Vec<Instant>>,
        now: Instant,
        window: Duration,
    ) {
        map.retain(|_, attempts| attempts.iter().any(|t| now.duration_since(*t) < window));
    }

    /// Number of usernames currently tracked.
    ///
    /// Exposed so the COR-2 bound can be asserted rather than merely described:
    /// it holds at most the names that attempted inside the last window.
    #[must_use]
    pub fn tracked_usernames(&self) -> usize {
        self.attempts
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .len()
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
        // `finish_non_exhaustive` rather than `finish`: the previous form silently
        // omitted `max_tracked`, so two limiters with different capacities printed
        // identically and the ".." is the honest way to say so (clippy 1.98).
        f.debug_struct("LoginRateLimiter")
            .field("max_attempts", &self.max_attempts)
            .field("window_secs", &self.window_secs)
            .field("max_tracked", &self.max_tracked)
            .field("attempts", &"(locked)")
            .finish_non_exhaustive()
    }
}

#[cfg(test)]
#[path = "rate_limiter_tests.rs"]
mod tests;
