//! Persistence for the local logical clock.
/*
last audited 2026-09-13 by Agent 1 (sync-conflict work order)
crate: platform-sync | status: SAFE | lint: CLEAN
findings: the counter lives in the existing generic `settings` key/value table
rather than a new `sync_clock` table — same durability, but it needs no
migration, so it touches neither the migration registry nor the generated PG
init (both shared surfaces outside this work order's fence). Absent key reads
as 0; a *corrupt* value is an error rather than a silent reset, because
silently restarting the counter at 0 would order this terminal's next
mutation before mutations it has already seen.
next: callers should tick the daemon's mutation path | perf: N/A
*/

use kasirmu_core::Store;
use kasirmu_core::error::CoreError;
use rusqlite::{Connection, Transaction};

use super::lamport::{Counter, LamportClock};

/// Settings key holding this terminal's Lamport counter.
pub const CLOCK_KEY: &str = "sync.clock.counter";

/// Read/write the persisted logical clock counter.
pub trait ClockStore {
    /// Load the last persisted counter (`0` if never written).
    fn load_counter(&self) -> Result<Counter, CoreError>;

    /// Persist a counter value.
    fn save_counter(&self, counter: Counter) -> Result<(), CoreError>;
}

/// A clock store backed by the `settings` table.
///
/// Constructed from a [`Transaction`] so the write cannot happen outside one
/// (AGENTS.md: every database write runs in an explicit transaction).
pub struct SettingsClockStore<'a> {
    conn: &'a Connection,
}

impl<'a> SettingsClockStore<'a> {
    /// Wrap an open transaction.
    pub fn new(tx: &'a Transaction<'_>) -> Self {
        Self { conn: tx }
    }

    /// Load the counter as a full [`LamportClock`] for `terminal_id`.
    pub fn load_clock(&self, terminal_id: &str) -> Result<LamportClock, CoreError> {
        let counter = self.load_counter()?;
        Ok(LamportClock::with_counter(counter, terminal_id))
    }
}

impl ClockStore for SettingsClockStore<'_> {
    fn load_counter(&self) -> Result<Counter, CoreError> {
        let store = Store::new(self.conn);
        match store.get_setting(CLOCK_KEY)? {
            Some(raw) => parse_counter(&raw),
            None => Ok(0),
        }
    }

    fn save_counter(&self, counter: Counter) -> Result<(), CoreError> {
        Store::new(self.conn).set_setting(CLOCK_KEY, &counter.to_string())
    }
}

/// Parse a persisted counter.
///
/// A value that does not parse is an error, not a `0`: the caller must find
/// out that the stored clock is unusable instead of being handed a fresh one
/// that orders its next mutation in the past.
pub fn parse_counter(raw: &str) -> Result<Counter, CoreError> {
    raw.trim()
        .parse::<Counter>()
        .map_err(|_| CoreError::Internal(format!("corrupt sync clock counter: {raw:?}")))
}

/// An in-process clock store. Used in tests and wherever no database exists.
#[derive(Debug, Default)]
pub struct InMemoryClockStore {
    counter: std::cell::Cell<Counter>,
}

impl InMemoryClockStore {
    /// A store starting at `counter`.
    pub fn new(counter: Counter) -> Self {
        Self {
            counter: std::cell::Cell::new(counter),
        }
    }
}

impl ClockStore for InMemoryClockStore {
    fn load_counter(&self) -> Result<Counter, CoreError> {
        Ok(self.counter.get())
    }

    fn save_counter(&self, counter: Counter) -> Result<(), CoreError> {
        self.counter.set(counter);
        Ok(())
    }
}

#[cfg(test)]
#[path = "clock_store_tests.rs"]
mod tests;
