//! CRDT primitives for offline sync — causality and delta merge.
/*
last audited 2026-09-13 by Agent 1 (sync-conflict work order)
crate: platform-sync | status: SAFE | lint: CLEAN
findings: lamport + version vector + typed delta merge + settings-backed clock
persistence; no migration added (the counter lives in the existing `settings`
key/value table), so no shared migration surface is touched. Stock additive
merge itself already exists in conflict.rs and is untouched.
next: Agent 2 consumes VersionVector/CausalOrder | perf: N/A
*/
//!
//! Scope note: gift card balances and loyalty points are deliberately **not**
//! additive CRDTs. Gift card redemption is guarded by an atomic conditional
//! `UPDATE` plus the `uq_gift_card_redeem_sale` unique index, and additive
//! merge would defeat both. Conflicting money movements are a conflict for
//! review, not a sum.

pub mod clock_store;
pub mod delta_mutation;
pub mod lamport;
pub mod version_vector;

pub use clock_store::{CLOCK_KEY, ClockStore, InMemoryClockStore, SettingsClockStore};
pub use delta_mutation::{DeltaError, DeltaMutation, MergeOutcome, merge_deltas};
pub use lamport::{Counter, LamportClock};
pub use version_vector::{CausalOrder, VersionVector};
