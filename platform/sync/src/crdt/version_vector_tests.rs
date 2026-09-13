//! Tests for [`super::VersionVector`].

use super::{CausalOrder, VersionVector};

fn vector(entries: &[(&str, u64)]) -> VersionVector {
    let mut v = VersionVector::new();
    for (terminal, counter) in entries {
        v.record(terminal, *counter);
    }
    v
}

#[test]
fn a_vector_is_equal_to_itself() {
    let v = vector(&[("a", 1), ("b", 2)]);
    assert_eq!(v.compare(&v.clone()), CausalOrder::Equal);
    assert_eq!(v, v.clone());
}

#[test]
fn domination_is_detected_in_both_directions() {
    let older = vector(&[("a", 1), ("b", 2)]);
    let newer = vector(&[("a", 1), ("b", 3)]);

    assert_eq!(older.compare(&newer), CausalOrder::Before);
    assert_eq!(newer.compare(&older), CausalOrder::After);
}

#[test]
fn concurrent_updates_are_detected_not_guessed() {
    // The case a Lamport clock gets wrong: two terminals each advanced only
    // their own counter. A single global counter would order these; the vector
    // correctly reports that neither dominates the other.
    let a = vector(&[("a", 2), ("b", 1)]);
    let b = vector(&[("a", 1), ("b", 2)]);

    assert_eq!(a.compare(&b), CausalOrder::Concurrent);
    assert_eq!(b.compare(&a), CausalOrder::Concurrent);
}

#[test]
fn an_unseen_terminal_is_concurrent_not_dominated() {
    let seen = vector(&[("a", 3)]);
    let unseen = vector(&[("b", 1)]);

    assert_eq!(seen.compare(&unseen), CausalOrder::Concurrent);
    assert_eq!(seen.get("b"), 0, "a missing terminal reads as 0");
}

#[test]
fn observe_takes_the_pointwise_maximum() {
    let mut left = vector(&[("a", 5), ("b", 1)]);
    let right = vector(&[("a", 2), ("b", 9), ("c", 4)]);

    left.observe(&right);

    assert_eq!(left.get("a"), 5, "never lowers a counter");
    assert_eq!(left.get("b"), 9);
    assert_eq!(left.get("c"), 4);
    assert_eq!(left.len(), 3);
}

#[test]
fn observe_converges_regardless_of_arrival_order() {
    let updates = [
        vector(&[("a", 3), ("b", 1)]),
        vector(&[("a", 1), ("b", 7)]),
        vector(&[("c", 2)]),
    ];

    let mut forward = VersionVector::new();
    for u in &updates {
        forward.observe(u);
    }

    let mut backward = VersionVector::new();
    for u in updates.iter().rev() {
        backward.observe(u);
    }

    assert_eq!(forward, backward, "merge must be order-independent");
    assert_eq!(forward.get("a"), 3);
    assert_eq!(forward.get("b"), 7);
    assert_eq!(forward.get("c"), 2);
}

#[test]
fn observe_is_idempotent() {
    let mut v = vector(&[("a", 1)]);
    let remote = vector(&[("a", 4)]);

    v.observe(&remote);
    let once = v.clone();
    v.observe(&remote);
    v.observe(&remote);

    assert_eq!(v, once, "replaying a remote state must change nothing");
}

#[test]
fn tick_advances_only_the_named_terminal() {
    let mut v = VersionVector::new();

    assert_eq!(v.tick("a"), 1);
    assert_eq!(v.tick("a"), 2);
    assert_eq!(v.tick("b"), 1);

    assert_eq!(v.get("a"), 2);
    assert_eq!(v.get("b"), 1);
    assert!(!v.is_empty());
}

#[test]
fn tick_saturates_at_max() {
    let mut v = vector(&[("a", u64::MAX)]);
    assert_eq!(v.tick("a"), u64::MAX);
    assert_eq!(v.get("a"), u64::MAX);
}

#[test]
fn empty_vectors_are_equal() {
    assert_eq!(
        VersionVector::new().compare(&VersionVector::new()),
        CausalOrder::Equal
    );
    assert!(VersionVector::new().is_empty());
}

/// The wire shape is `{"terminal": counter}` — a bare map, not a wrapped
/// `{"counters": {...}}` object.
///
/// This is a cross-crate contract, and it was once broken: `stamp_payload`
/// wrote a bare map while `VersionVector` serialized wrapped, so the server's
/// `extract_vector` returned `None` for every payload the daemon sent and the
/// detector skipped everything. Both sides' unit tests passed, because each
/// only ever exercised its own shape. Pin both directions here.
#[test]
fn serializes_as_a_bare_terminal_to_counter_map() {
    let v = vector(&[("t1", 3), ("t2", 7)]);
    let json = serde_json::to_string(&v).unwrap();
    assert_eq!(json, r#"{"t1":3,"t2":7}"#);

    let back: VersionVector = serde_json::from_str(&json).unwrap();
    assert_eq!(back, v);
    assert_eq!(back.get("t1"), 3);
    assert_eq!(back.get("t2"), 7);
}

/// An empty vector is `{}`, and still round-trips.
#[test]
fn empty_vector_serializes_as_an_empty_object() {
    let v = VersionVector::new();
    assert_eq!(serde_json::to_string(&v).unwrap(), "{}");
    let back: VersionVector = serde_json::from_str("{}").unwrap();
    assert_eq!(back, v);
}

/// Round-trip through the exact shape `stamp_payload` puts on the wire.
///
/// This is the seam, end to end within the crate: stamp, then read back with
/// the same deserializer the server uses.
#[test]
fn round_trips_through_the_stamp_shape() {
    let stamped = super::super::push_stamp::stamp_payload(r#"{"x":1}"#, "t9", 4);
    let value: serde_json::Value = serde_json::from_str(&stamped).unwrap();
    let raw = value.get("_vector").unwrap().clone();

    let v: VersionVector = serde_json::from_value(raw).unwrap();
    assert_eq!(v.get("t9"), 4);
    assert_eq!(v.len(), 1);
}
