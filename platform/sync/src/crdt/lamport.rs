//! Lamport logical clock with a deterministic terminal tie-break.
/*
last audited 2026-09-13 by Agent 1 (sync-conflict work order)
crate: platform-sync | status: SAFE | lint: CLEAN
findings: total order is (counter, terminal_id) — the terminal tie-break is
load-bearing, not cosmetic: a bare Lamport counter only orders events
CONSISTENT WITH causality, so two concurrent events may carry the same counter
and each replica would otherwise resolve the tie differently and diverge.
Increment and merge saturate at u64::MAX rather than wrapping, because a
wrapped counter silently inverts the order.
next: wire the daemon's mutation path to tick this clock | perf: N/A
*/
//!
//! # What this type cannot do
//!
//! A Lamport clock is **not** a concurrency detector. If `a` happened before
//! `b` then `L(a) < L(b)`, but the converse does not hold: two concurrent
//! events still receive ordered timestamps. Detecting concurrency requires a
//! [`crate::crdt::VersionVector`]. This type is for producing a single total
//! order once a decision has been made — last-writer-wins among ties, and a
//! stable sort key for audit trails.

use std::cmp::Ordering;

use serde::{Deserialize, Serialize};

/// A Lamport counter value.
pub type Counter = u64;

/// A Lamport timestamp: a logical counter plus the terminal that produced it.
///
/// Ordering is `(counter, terminal_id)`. Two clocks are `Equal` only when both
/// the counter and the terminal match, which keeps `Ord` consistent with the
/// derived `PartialEq`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LamportClock {
    counter: Counter,
    terminal_id: String,
}

impl LamportClock {
    /// A fresh clock for `terminal_id`, starting at counter `0`.
    pub fn new(terminal_id: impl Into<String>) -> Self {
        Self {
            counter: 0,
            terminal_id: terminal_id.into(),
        }
    }

    /// Rebuild a clock from a persisted counter.
    pub fn with_counter(counter: Counter, terminal_id: impl Into<String>) -> Self {
        Self {
            counter,
            terminal_id: terminal_id.into(),
        }
    }

    /// The current counter value.
    pub fn counter(&self) -> Counter {
        self.counter
    }

    /// The terminal that owns this clock.
    pub fn terminal_id(&self) -> &str {
        &self.terminal_id
    }

    /// Advance this clock for a local event and return the new counter.
    ///
    /// Saturates at [`Counter::MAX`]; it never wraps.
    pub fn tick(&mut self) -> Counter {
        self.counter = self.counter.saturating_add(1);
        self.counter
    }

    /// Fold a remote clock into this one, then tick.
    ///
    /// The result is `max(local, remote) + 1`, which is the standard Lamport
    /// receive rule: the local clock is pushed strictly beyond everything it
    /// has observed, so a subsequent local event cannot be ordered before the
    /// remote one.
    pub fn observe(&mut self, other: &Self) -> Counter {
        if other.counter > self.counter {
            self.counter = other.counter;
        }
        self.tick()
    }

    /// Advance past a raw counter value, then tick. Used when only a peer's
    /// counter is known (for example a value read back from storage).
    pub fn observe_counter(&mut self, other: Counter) -> Counter {
        if other > self.counter {
            self.counter = other;
        }
        self.tick()
    }
}

impl Ord for LamportClock {
    fn cmp(&self, other: &Self) -> Ordering {
        self.counter
            .cmp(&other.counter)
            .then_with(|| self.terminal_id.cmp(&other.terminal_id))
    }
}

impl PartialOrd for LamportClock {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

#[cfg(test)]
#[path = "lamport_tests.rs"]
mod tests;
