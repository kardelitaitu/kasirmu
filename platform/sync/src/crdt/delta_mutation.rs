//! Typed, idempotent delta-merge contract for stock movements.
/*
last audited 2026-09-13 by Agent 1 (sync-conflict work order)
crate: platform-sync | status: SAFE | lint: CLEAN
findings: the merge is keyed on `movement_id`, which is the property the
current blob merge in `conflict.rs` lacks — without it a redelivered item
applies its delta twice. Dedupe keeps the FIRST occurrence and the result is
sorted by (clock, movement_id) so the applied order is identical on every
replica. `total_quantity` saturates: an overflowing sum is reported as
i64::MAX/MIN rather than wrapping into a plausible wrong number. Payload
parsing fails closed — a delta missing any required field is an error, never a
silently zeroed delta.
next: adopt in queue.rs once the crdt_delta blob is retired | perf: N/A
*/
//!
//! This module **describes** the merge contract. It does not replace
//! `resolve_stock_crdt` in [`crate::conflict`], which is consumed in four
//! places in [`crate::queue`] and must keep working unchanged. Migrating the
//! daemon off the `{"local", "remote", "merge_type"}` blob onto this type is
//! separate work.
//!
//! Money and counts are `i64` minor units throughout. There is no float in
//! this module and there must never be one.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

use super::lamport::LamportClock;

/// A single immutable stock movement.
///
/// Two deltas with the same `movement_id` are the *same* movement, not two
/// movements — replaying one must not apply twice.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeltaMutation {
    /// Stable identity of the movement. The idempotency key.
    pub movement_id: String,
    /// Product the movement applies to.
    pub sku: String,
    /// Signed quantity in minor units. Negative reduces stock.
    pub quantity: i64,
    /// Terminal that originated the movement.
    pub terminal_id: String,
    /// Logical timestamp used to order application.
    pub clock: LamportClock,
}

impl DeltaMutation {
    /// Build a delta from its parts.
    pub fn new(
        movement_id: impl Into<String>,
        sku: impl Into<String>,
        quantity: i64,
        terminal_id: impl Into<String>,
        clock: LamportClock,
    ) -> Self {
        Self {
            movement_id: movement_id.into(),
            sku: sku.into(),
            quantity,
            terminal_id: terminal_id.into(),
            clock,
        }
    }

    /// Serialise to a JSON value.
    pub fn to_json(&self) -> Result<Value, DeltaError> {
        serde_json::to_value(self).map_err(DeltaError::from)
    }

    /// Parse from a JSON value.
    ///
    /// Fails closed: a payload missing `movement_id`, `sku`, `quantity`,
    /// `terminal_id` or `clock` is rejected rather than defaulted, because a
    /// defaulted delta would apply a wrong quantity to the wrong product.
    /// Unknown extra fields are ignored, so a newer peer can extend the
    /// payload without breaking an older reader.
    pub fn try_from_json(value: &Value) -> Result<Self, DeltaError> {
        serde_json::from_value(value.clone()).map_err(DeltaError::from)
    }
}

/// The result of merging two sets of deltas.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MergeOutcome {
    /// Deltas to apply, deduplicated, in a deterministic order.
    pub applied: Vec<DeltaMutation>,
    /// `movement_id`s that arrived more than once — the replays that were
    /// collapsed. Recorded so callers can log or audit them.
    pub duplicates: Vec<String>,
    /// Saturating sum of [`DeltaMutation::quantity`] over `applied`.
    pub total_quantity: i64,
}

impl MergeOutcome {
    /// Whether every incoming delta was unique.
    pub fn had_replays(&self) -> bool {
        !self.duplicates.is_empty()
    }
}

/// A delta payload could not be parsed.
#[derive(Debug, Error)]
pub enum DeltaError {
    /// Required field missing or of the wrong type.
    #[error("invalid delta payload: {0}")]
    InvalidPayload(#[from] serde_json::Error),
}

/// Merge local and remote deltas into one deterministic, idempotent set.
///
/// Both sides' deltas are preserved — this matches the existing behaviour in
/// [`crate::queue`], which applies the local and remote halves of a
/// `crdt_delta` payload instead of picking a winner. What this adds is
/// **idempotency**: a `movement_id` present on both sides (or twice on one)
/// yields a single delta.
///
/// The result is sorted by `(clock, movement_id)`, so every replica applies
/// the same set in the same order regardless of arrival order.
pub fn merge_deltas(local: &[DeltaMutation], remote: &[DeltaMutation]) -> MergeOutcome {
    let mut first_seen: BTreeMap<String, DeltaMutation> = BTreeMap::new();
    let mut counts: BTreeMap<String, usize> = BTreeMap::new();

    for delta in local.iter().chain(remote.iter()) {
        *counts.entry(delta.movement_id.clone()).or_insert(0) += 1;
        // First occurrence wins; the deltas are the same movement, so there is
        // nothing to reconcile — only a duplicate to drop.
        first_seen
            .entry(delta.movement_id.clone())
            .or_insert_with(|| delta.clone());
    }

    let mut applied: Vec<DeltaMutation> = first_seen.into_values().collect();
    applied.sort_by(|a, b| {
        a.clock
            .cmp(&b.clock)
            .then_with(|| a.movement_id.cmp(&b.movement_id))
    });

    let duplicates = counts
        .into_iter()
        .filter(|(_, count)| *count > 1)
        .map(|(movement_id, _)| movement_id)
        .collect();

    let total_quantity = applied
        .iter()
        .fold(0_i64, |acc, delta| acc.saturating_add(delta.quantity));

    MergeOutcome {
        applied,
        duplicates,
        total_quantity,
    }
}

#[cfg(test)]
#[path = "delta_mutation_tests.rs"]
mod tests;
