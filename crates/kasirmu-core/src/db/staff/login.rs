//! Login-attempt tracking and lockout backoff (STAFF-07).
//!
//! Split out of `db/staff.rs` on 2026-09-28. These are the `Store` methods that
//! record a failed login, enforce the per-account, per-device and global limits,
//! and clear the counters on success.
//!
//! Invariant: every attempt row is PERSISTED in `login_attempts`, so a lockout
//! survives an app restart; expired attempts are pruned on every call rather than
//! by a timer. The backoff is exponential (`base * 2^(strikes-1)`, capped), so a
//! fixed short lock cannot be defeated by retrying.

use rusqlite::params;

use crate::db::Store;
use crate::error::CoreError;

use super::LoginLimits;

impl Store<'_> {
    pub(super) fn login_backoff_secs(base_secs: u64, strikes: usize, max_secs: u64) -> u64 {
        let shift = strikes.saturating_sub(1).min(16);
        base_secs.saturating_mul(1u64 << shift).min(max_secs).max(1)
    }

    /// Record a failed login attempt, enforcing per-account, per-device,
    /// and global limits within a sliding window (STAFF-07).
    ///
    /// Returns `Ok(remaining)` when the attempt is recorded and the caller
    /// may keep trying, or `Err(retry_after_secs)` when a limit is breached
    /// and the caller must wait. Expired attempts are pruned on every call;
    /// the data survives app restarts.
    pub fn record_login_attempt_scoped(
        &self,
        username: &str,
        device_id: Option<&str>,
        limits: LoginLimits,
    ) -> Result<Result<usize, u64>, CoreError> {
        let max_attempts = limits.max_attempts;
        let window_secs = limits.window_secs;
        let device_max_attempts = limits.device_max_attempts;
        let global_max_attempts = limits.global_max_attempts;
        let max_backoff_secs = limits.max_backoff_secs;
        let now = chrono::Utc::now().timestamp();
        let window_start = now - window_secs as i64;

        // C18: the prune, the three limit checks, the INSERT and the re-check are
        // ONE decision and run inside one transaction. They were separate
        // autocommit statements, so a failure after the prune committed the
        // deletion while recording no attempt at all -- the stored history was
        // destroyed AND the attempt stayed invisible to every limit, which is the
        // opposite of what a rate limiter may do under failure. `is_autocommit()`
        // owns-or-joins, so a caller that already holds a transaction keeps it.
        let tx = if self.conn.is_autocommit() {
            Some(self.conn.unchecked_transaction()?)
        } else {
            None
        };

        // Prune expired entries for the whole table (account + device +
        // global counters all share the same window).
        self.conn.execute(
            "DELETE FROM login_attempts WHERE attempted_at < ?1",
            params![window_start],
        )?;

        // ── Per-account limit ────────────────────────────────────
        let account_count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM login_attempts WHERE username = ?1",
            params![username],
            |row| row.get(0),
        )?;
        if account_count >= max_attempts as i64 {
            let strikes = (account_count as usize / max_attempts).max(1);
            // The breach is decided; the prune is still a legitimate effect and
            // commits with it. No attempt is recorded on this path.
            if let Some(tx) = tx {
                tx.commit()?;
            }
            return Ok(Err(Self::login_backoff_secs(
                window_secs,
                strikes,
                max_backoff_secs,
            )));
        }

        // ── Per-device limit (across all usernames) ───────────────
        if let Some(device) = device_id.filter(|d| !d.is_empty()) {
            let device_count: i64 = self.conn.query_row(
                "SELECT COUNT(*) FROM login_attempts WHERE device_id = ?1",
                params![device],
                |row| row.get(0),
            )?;
            if device_count >= device_max_attempts as i64 {
                let strikes = (device_count as usize / device_max_attempts).max(1);
                if let Some(tx) = tx {
                    tx.commit()?;
                }
                return Ok(Err(Self::login_backoff_secs(
                    window_secs,
                    strikes,
                    max_backoff_secs,
                )));
            }
        }

        // ── Global abuse limit ────────────────────────────────────
        let global_count: i64 =
            self.conn
                .query_row("SELECT COUNT(*) FROM login_attempts", [], |row| row.get(0))?;
        if global_count >= global_max_attempts as i64 {
            let strikes = (global_count as usize / global_max_attempts).max(1);
            if let Some(tx) = tx {
                tx.commit()?;
            }
            return Ok(Err(Self::login_backoff_secs(
                window_secs,
                strikes,
                max_backoff_secs,
            )));
        }

        // Record this attempt.
        self.conn.execute(
            "INSERT INTO login_attempts (id, username, device_id, attempted_at) VALUES (?1, ?2, ?3, ?4)",
            params![uuid::Uuid::now_v7().to_string(), username, device_id, now],
        )?;

        // Re-check after recording to catch the push-over-the-limit case.
        let new_count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM login_attempts WHERE username = ?1",
            params![username],
            |row| row.get(0),
        )?;
        // The attempt IS recorded, so the prune and the INSERT commit together.
        if let Some(tx) = tx {
            tx.commit()?;
        }

        if new_count >= max_attempts as i64 {
            let strikes = (new_count as usize / max_attempts).max(1);
            return Ok(Err(Self::login_backoff_secs(
                window_secs,
                strikes,
                max_backoff_secs,
            )));
        }

        let remaining = max_attempts.saturating_sub(new_count as usize);
        Ok(Ok(remaining))
    }

    /// Record a failed login attempt with the legacy username-only
    /// signature. Kept for callers that have no device context; delegates
    /// to [`Self::record_login_attempt_scoped`] with device-independent
    /// defaults so every path gets at least per-account protection.
    pub fn record_login_attempt(
        &self,
        username: &str,
        max_attempts: usize,
        window_secs: u64,
    ) -> Result<Result<usize, u64>, CoreError> {
        self.record_login_attempt_scoped(
            username,
            None,
            LoginLimits {
                max_attempts,
                window_secs,
                device_max_attempts: max_attempts.saturating_mul(4),
                global_max_attempts: max_attempts.saturating_mul(20),
                max_backoff_secs: window_secs.saturating_mul(8),
            },
        )
    }

    /// Clear all recorded login attempts for `username` (call on
    /// successful login or admin reset).
    pub fn clear_login_attempts(&self, username: &str) -> Result<(), CoreError> {
        self.conn.execute(
            "DELETE FROM login_attempts WHERE username = ?1",
            params![username],
        )?;
        Ok(())
    }

    /// Clear all recorded login attempts for a device (STAFF-07). Called on
    /// successful login so a legitimate terminal is not held at a per-device
    /// limit; does not touch other devices or global history.
    pub fn clear_login_attempts_by_device(&self, device_id: &str) -> Result<(), CoreError> {
        self.conn.execute(
            "DELETE FROM login_attempts WHERE device_id = ?1",
            params![device_id],
        )?;
        Ok(())
    }
}
