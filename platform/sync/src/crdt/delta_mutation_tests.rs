//! Tests for [`super::merge_deltas`] and payload round-tripping.

use serde_json::json;

use super::{DeltaMutation, merge_deltas};
use crate::crdt::lamport::LamportClock;

fn delta(id: &str, sku: &str, qty: i64, counter: u64, terminal: &str) -> DeltaMutation {
    DeltaMutation::new(
        id,
        sku,
        qty,
        terminal,
        LamportClock::with_counter(counter, terminal),
    )
}

#[test]
fn independent_deltas_from_both_sides_survive() {
    let local = vec![delta("m1", "SKU-A", -2, 1, "t1")];
    let remote = vec![delta("m2", "SKU-A", -3, 2, "t2")];

    let outcome = merge_deltas(&local, &remote);

    // The existing "both deltas apply" semantics must be preserved.
    assert_eq!(outcome.applied.len(), 2);
    assert_eq!(outcome.total_quantity, -5);
    assert!(!outcome.had_replays());
}

#[test]
fn a_replayed_movement_applies_once() {
    let local = vec![delta("m1", "SKU-A", -2, 1, "t1")];
    let remote = vec![delta("m1", "SKU-A", -2, 1, "t1")];

    let outcome = merge_deltas(&local, &remote);

    assert_eq!(
        outcome.applied.len(),
        1,
        "the same movement_id must not apply twice"
    );
    assert_eq!(outcome.total_quantity, -2);
    assert_eq!(outcome.duplicates, vec!["m1".to_string()]);
    assert!(outcome.had_replays());
}

#[test]
fn a_duplicate_within_one_side_is_also_collapsed() {
    let local = vec![
        delta("m1", "SKU-A", -2, 1, "t1"),
        delta("m1", "SKU-A", -2, 1, "t1"),
        delta("m2", "SKU-A", -1, 2, "t1"),
    ];

    let outcome = merge_deltas(&local, &[]);

    assert_eq!(outcome.applied.len(), 2);
    assert_eq!(outcome.total_quantity, -3);
    assert_eq!(outcome.duplicates, vec!["m1".to_string()]);
}

#[test]
fn merge_order_is_deterministic_and_clock_ordered() {
    let local = vec![delta("m2", "SKU-A", 1, 9, "t1")];
    let remote = vec![delta("m1", "SKU-A", 1, 3, "t2")];

    let forward = merge_deltas(&local, &remote);
    let reversed = merge_deltas(&remote, &local);

    let ids: Vec<&str> = forward
        .applied
        .iter()
        .map(|d| d.movement_id.as_str())
        .collect();
    assert_eq!(ids, vec!["m1", "m2"], "lower clock applies first");

    assert_eq!(
        forward, reversed,
        "swapping the arguments must not change the result"
    );
}

#[test]
fn same_clock_ties_break_on_movement_id() {
    let a = delta("aaa", "SKU-A", 1, 5, "t1");
    let b = delta("bbb", "SKU-A", 1, 5, "t2");

    let outcome = merge_deltas(&[b.clone()], &[a.clone()]);
    let ids: Vec<&str> = outcome
        .applied
        .iter()
        .map(|d| d.movement_id.as_str())
        .collect();

    assert_eq!(ids, vec!["aaa", "bbb"]);
}

#[test]
fn total_quantity_saturates_rather_than_wrapping() {
    let local = vec![delta("m1", "SKU-A", i64::MAX, 1, "t1")];
    let remote = vec![delta("m2", "SKU-A", i64::MAX, 2, "t2")];

    let outcome = merge_deltas(&local, &remote);

    assert_eq!(
        outcome.total_quantity,
        i64::MAX,
        "a wrapped total would read as a plausible negative number"
    );
}

#[test]
fn empty_inputs_produce_an_empty_merge() {
    let outcome = merge_deltas(&[], &[]);
    assert!(outcome.applied.is_empty());
    assert!(outcome.duplicates.is_empty());
    assert_eq!(outcome.total_quantity, 0);
    assert!(!outcome.had_replays());
}

#[test]
fn json_round_trip_preserves_the_delta() {
    let d = delta("m1", "SKU-A", -7, 4, "t9");

    let value = d.to_json().expect("serialize");
    let back = DeltaMutation::try_from_json(&value).expect("deserialize");

    assert_eq!(d, back);
    assert_eq!(back.quantity, -7);
    assert_eq!(back.clock.counter(), 4);
}

#[test]
fn a_payload_missing_a_field_fails_closed() {
    // Defaulting would apply a wrong quantity to the wrong product, so this
    // must be an error rather than a delta full of empty strings and zeros.
    let missing_quantity = json!({
        "movement_id": "m1",
        "sku": "SKU-A",
        "terminal_id": "t1",
        "clock": { "counter": 1, "terminal_id": "t1" }
    });

    assert!(
        DeltaMutation::try_from_json(&missing_quantity).is_err(),
        "an incomplete delta must be rejected"
    );
}

#[test]
fn unknown_extra_fields_are_ignored() {
    let payload = json!({
        "movement_id": "m1",
        "sku": "SKU-A",
        "quantity": 3,
        "terminal_id": "t1",
        "clock": { "counter": 1, "terminal_id": "t1" },
        "something_from_a_newer_peer": true
    });

    let d = DeltaMutation::try_from_json(&payload).expect("unknown fields must not break parsing");
    assert_eq!(d.quantity, 3);
}
