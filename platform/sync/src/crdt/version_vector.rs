//! Version vector — the part of causality a Lamport clock cannot express.
/*
last audited 2026-09-13 by Agent 1 (sync-conflict work order)
crate: platform-sync | status: SAFE | lint: CLEAN
findings: pointwise-max `observe` is commutative, associative and idempotent,
so replicas converge regardless of arrival order — this is the property the
merge relies on; `compare` is the standard four-way classification and treats
a missing terminal as counter 0, which makes an unseen peer correctly
concurrent with (not dominated by) a vector that has never heard of it.
next: consumed by Agent 2's conflict detector | perf: O(terminals)
*/
//!
//! A [`crate::crdt::LamportClock`] yields a total order but cannot tell
//! "concurrent" from "ordered": two independent events still get ordered
//! timestamps. This type answers that question exactly, by keeping one counter
//! per terminal instead of a single global one.
//!
//! For every pair of vectors exactly one of these holds: `Before`, `After`,
//! `Equal`, or `Concurrent`.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::lamport::Counter;

/// The result of comparing two version vectors.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CausalOrder {
    /// `self` is strictly dominated by `other`: `other` has seen everything
    /// `self` has, and more. Safe to apply `other` with no conflict.
    Before,
    /// `self` strictly dominates `other`: the incoming mutation is stale.
    After,
    /// The two vectors are identical — the same state, not a coincidence.
    Equal,
    /// Neither dominates: the two diverged concurrently. This is the case that
    /// must be flagged for review rather than silently resolved.
    Concurrent,
}

/// One logical counter per terminal.
///
/// A terminal that has never been observed is absent from the map and reads as
/// counter `0`; this keeps the representation compact without changing any
/// comparison result.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct VersionVector {
    counters: BTreeMap<String, Counter>,
}

impl VersionVector {
    /// An empty vector — no terminal observed, nothing happened yet.
    pub fn new() -> Self {
        Self::default()
    }

    /// The counter recorded for `terminal_id` (`0` if never observed).
    pub fn get(&self, terminal_id: &str) -> Counter {
        self.counters.get(terminal_id).copied().unwrap_or(0)
    }

    /// Number of terminals tracked.
    pub fn len(&self) -> usize {
        self.counters.len()
    }

    /// Whether any terminal has been observed.
    pub fn is_empty(&self) -> bool {
        self.counters.is_empty()
    }

    /// Advance `terminal_id`'s own counter by one and return the new value.
    ///
    /// Saturates at [`Counter::MAX`].
    pub fn tick(&mut self, terminal_id: &str) -> Counter {
        let entry = self.counters.entry(terminal_id.to_owned()).or_insert(0);
        *entry = entry.saturating_add(1);
        *entry
    }

    /// Record a remote terminal's counter, keeping the pointwise maximum.
    ///
    /// Never lowers a counter: a replayed or reordered old update cannot pull
    /// the vector backwards.
    pub fn record(&mut self, terminal_id: &str, counter: Counter) {
        let entry = self.counters.entry(terminal_id.to_owned()).or_insert(0);
        if counter > *entry {
            *entry = counter;
        }
    }

    /// Merge another vector in by pointwise maximum.
    ///
    /// Commutative, associative and idempotent, so arrival order is irrelevant
    /// and applying the same remote state twice changes nothing.
    pub fn observe(&mut self, other: &Self) {
        for (terminal_id, counter) in &other.counters {
            self.record(terminal_id, *counter);
        }
    }

    /// Classify `self` against `other`.
    pub fn compare(&self, other: &Self) -> CausalOrder {
        let mut self_greater = false;
        let mut other_greater = false;

        // Walk the union of keys; a missing key reads as 0 on both sides.
        let keys: std::collections::BTreeSet<&String> =
            self.counters.keys().chain(other.counters.keys()).collect();

        for key in keys {
            match self.get(key).cmp(&other.get(key)) {
                std::cmp::Ordering::Greater => self_greater = true,
                std::cmp::Ordering::Less => other_greater = true,
                std::cmp::Ordering::Equal => {}
            }
        }

        match (self_greater, other_greater) {
            (true, false) => CausalOrder::After,
            (false, true) => CausalOrder::Before,
            (false, false) => CausalOrder::Equal,
            (true, true) => CausalOrder::Concurrent,
        }
    }

    /// Iterate the tracked `(terminal_id, counter)` pairs in terminal order.
    pub fn iter(&self) -> impl Iterator<Item = (&String, &Counter)> {
        self.counters.iter()
    }
}

#[cfg(test)]
#[path = "version_vector_tests.rs"]
mod tests;
