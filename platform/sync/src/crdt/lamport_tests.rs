//! Tests for [`super::LamportClock`].

use std::cmp::Ordering;

use super::{Counter, LamportClock};

#[test]
fn tick_is_monotonic() {
    let mut clock = LamportClock::new("t1");
    assert_eq!(clock.counter(), 0);
    assert_eq!(clock.tick(), 1);
    assert_eq!(clock.tick(), 2);
    assert_eq!(clock.tick(), 3);
    assert_eq!(clock.counter(), 3);
    assert_eq!(clock.terminal_id(), "t1");
}

#[test]
fn observe_pushes_local_strictly_beyond_remote() {
    let mut local = LamportClock::with_counter(4, "t1");
    let remote = LamportClock::with_counter(9, "t2");

    assert_eq!(local.observe(&remote), 10);
    assert_eq!(local.counter(), 10);
    // A later local event is ordered after the remote one it observed.
    assert!(local > remote);
}

#[test]
fn observe_a_lesser_remote_still_ticks() {
    let mut local = LamportClock::with_counter(7, "t1");
    let remote = LamportClock::with_counter(2, "t2");

    // The receive rule ticks even when nothing was learned.
    assert_eq!(local.observe(&remote), 8);
    assert!(local > remote);
}

#[test]
fn equal_counters_tie_break_on_terminal_id() {
    let a = LamportClock::with_counter(5, "alpha");
    let b = LamportClock::with_counter(5, "beta");

    assert_eq!(a.counter(), b.counter());
    assert!(a < b, "equal counters must not be left to chance");
    assert!(b > a);
}

#[test]
fn tie_break_is_deterministic_across_argument_order() {
    let a = LamportClock::with_counter(5, "alpha");
    let b = LamportClock::with_counter(5, "beta");

    // The property that actually matters for convergence: reversing the
    // arguments reverses the answer, so no replica can disagree.
    assert_eq!(a.cmp(&b), Ordering::Less);
    assert_eq!(b.cmp(&a), Ordering::Greater);
    assert_eq!(a.cmp(&a), Ordering::Equal);
}

#[test]
fn ordering_is_transitive_over_a_scrambled_set() {
    let mut clocks = vec![
        LamportClock::with_counter(3, "c"),
        LamportClock::with_counter(1, "z"),
        LamportClock::with_counter(3, "a"),
        LamportClock::with_counter(9, "a"),
        LamportClock::with_counter(3, "b"),
    ];
    clocks.sort();

    let ordered: Vec<(Counter, &str)> = clocks
        .iter()
        .map(|c| (c.counter(), c.terminal_id()))
        .collect();
    assert_eq!(
        ordered,
        vec![(1, "z"), (3, "a"), (3, "b"), (3, "c"), (9, "a")],
        "sort must be a stable total order: counter first, terminal second"
    );
}

#[test]
fn tick_saturates_instead_of_wrapping() {
    let mut clock = LamportClock::with_counter(Counter::MAX, "t1");

    // A wrapped counter would invert the order, so it must saturate.
    assert_eq!(clock.tick(), Counter::MAX);
    assert_eq!(clock.observe_counter(Counter::MAX), Counter::MAX);
}

#[test]
fn observe_counter_advances_past_a_stored_value() {
    let mut clock = LamportClock::new("t1");
    assert_eq!(clock.observe_counter(41), 42);
    assert_eq!(clock.observe_counter(10), 43, "never moves backwards");
}

#[test]
fn serde_round_trip_preserves_identity_and_order() {
    let clock = LamportClock::with_counter(12, "t7");
    let json = serde_json::to_string(&clock).expect("serialize");
    let back: LamportClock = serde_json::from_str(&json).expect("deserialize");

    assert_eq!(clock, back);
    assert_eq!(clock.cmp(&back), Ordering::Equal);
}
