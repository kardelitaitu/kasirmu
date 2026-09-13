//! Tests for [`super::stamp_payload`].

use serde_json::Value;

use super::{TERMINAL_FIELD, VECTOR_FIELD, is_stamped, stamp_payload};

fn fields(payload: &str) -> Value {
    serde_json::from_str(payload).expect("object payload")
}

#[test]
fn stamping_adds_both_fields_and_keeps_the_originals() {
    let payload = r#"{"sku":"SKU-A","delta":-2}"#;

    let stamped = stamp_payload(payload, "terminal-7", 12);
    let value = fields(&stamped);

    assert_eq!(value["sku"], "SKU-A");
    assert_eq!(value["delta"], -2, "existing keys must survive");
    assert_eq!(value[TERMINAL_FIELD], "terminal-7");
    assert_eq!(value[VECTOR_FIELD]["terminal-7"], 12);
}

#[test]
fn the_vector_carries_only_this_terminals_counter() {
    // A single-entry vector is the correct shape for a sender: it says what
    // THIS terminal has seen, and the server merges it pointwise.
    let value = fields(&stamp_payload("{}", "t1", 5));
    let map = value[VECTOR_FIELD].as_object().expect("vector object");

    assert_eq!(map.len(), 1);
    assert_eq!(map["t1"], 5);
}

#[test]
fn a_counter_advances_across_stamps() {
    let first = fields(&stamp_payload("{}", "t1", 1));
    let second = fields(&stamp_payload("{}", "t1", 2));

    assert!(
        second[VECTOR_FIELD]["t1"].as_u64().expect("counter")
            > first[VECTOR_FIELD]["t1"].as_u64().expect("counter")
    );
}

#[test]
fn an_unparseable_payload_is_returned_unchanged() {
    // Rewriting it would change the wire shape the server parses.
    assert_eq!(stamp_payload("not json", "t1", 1), "not json");
    assert_eq!(stamp_payload("", "t1", 1), "");
}

#[test]
fn a_non_object_payload_is_returned_unchanged() {
    let payload = r#"[1,2,3]"#;
    assert_eq!(stamp_payload(payload, "t1", 1), payload);
    assert_eq!(stamp_payload(r#""a string""#, "t1", 1), r#""a string""#);
}

#[test]
fn an_empty_object_is_stamped() {
    let value = fields(&stamp_payload("{}", "t1", 3));
    assert_eq!(value[TERMINAL_FIELD], "t1");
    assert_eq!(value[VECTOR_FIELD]["t1"], 3);
}

#[test]
fn restamping_overwrites_rather_than_adding_a_second_vector() {
    let once = stamp_payload("{}", "t1", 1);
    let twice = stamp_payload(&once, "t1", 2);

    let value = fields(&twice);
    assert_eq!(value[VECTOR_FIELD]["t1"], 2, "latest counter wins");
}

#[test]
fn a_stamped_payload_is_recognised_as_stamped() {
    assert!(is_stamped(&stamp_payload("{}", "t1", 1)));
    assert!(!is_stamped("{}"));
    assert!(!is_stamped("not json"));
}
