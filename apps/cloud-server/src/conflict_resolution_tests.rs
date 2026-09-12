//! Tests for the conflict classification policy.

use platform_sync::crdt::VersionVector;
use serde_json::{Value, json};

use super::{
    ConflictCandidate, Decision, MergePolicy, Severity, classify, fields_are_disjoint,
    overlapping_fields, policy_for, severity_for, tie_break,
};

/// Build a vector from `(terminal, counter)` pairs.
fn vector(entries: &[(&str, u64)]) -> VersionVector {
    let mut v = VersionVector::new();
    for (terminal, counter) in entries {
        v.record(terminal, *counter);
    }
    v
}

fn candidate<'a>(
    entity_type: &'a str,
    stored: &'a VersionVector,
    incoming: &'a VersionVector,
) -> ConflictCandidate<'a> {
    ConflictCandidate {
        entity_type,
        stored,
        incoming,
        stored_payload: None,
        incoming_payload: None,
    }
}

/// A candidate carrying both payloads, for the field-wise merge policy.
fn candidate_with_payloads<'a>(
    entity_type: &'a str,
    stored: &'a VersionVector,
    incoming: &'a VersionVector,
    stored_payload: &'a Value,
    incoming_payload: &'a Value,
) -> ConflictCandidate<'a> {
    ConflictCandidate {
        entity_type,
        stored,
        incoming,
        stored_payload: Some(stored_payload),
        incoming_payload: Some(incoming_payload),
    }
}

#[test]
fn an_incoming_mutation_that_dominates_applies_cleanly() {
    let stored = vector(&[("a", 1), ("b", 1)]);
    let incoming = vector(&[("a", 1), ("b", 2)]);

    assert_eq!(
        classify(&candidate("product.update", &stored, &incoming)),
        Decision::Apply,
        "a strictly newer mutation is not a conflict"
    );
}

#[test]
fn an_incoming_mutation_that_lags_is_stale() {
    let stored = vector(&[("a", 5), ("b", 5)]);
    let incoming = vector(&[("a", 5), ("b", 2)]);

    assert_eq!(
        classify(&candidate("product.update", &stored, &incoming)),
        Decision::Stale
    );
}

#[test]
fn identical_vectors_are_not_a_conflict() {
    let stored = vector(&[("a", 3), ("b", 4)]);
    let incoming = stored.clone();

    assert_eq!(
        classify(&candidate("product.update", &stored, &incoming)),
        Decision::Identical
    );
}

#[test]
fn concurrent_gift_card_redemptions_are_flagged_high_and_never_merged() {
    // The case that must never auto-merge: two terminals redeeming the same
    // card. Summing them would produce a double spend that each individual
    // write would have rejected.
    let stored = vector(&[("a", 2), ("b", 1)]);
    let incoming = vector(&[("a", 1), ("b", 2)]);

    assert_eq!(severity_for("gift_card.redeem"), Severity::High);
    assert_eq!(policy_for("gift_card.redeem"), MergePolicy::NeverAutoMerge);
    assert_eq!(
        classify(&candidate("gift_card.redeem", &stored, &incoming)),
        Decision::Flag {
            severity: Severity::High
        }
    );
}

#[test]
fn every_money_flavour_refuses_to_auto_merge() {
    for entity in [
        "gift_card.redeem",
        "payment.captured",
        "refund.issued",
        "loyalty.redeem",
        "cash_payout.created",
    ] {
        assert_eq!(
            policy_for(entity),
            MergePolicy::NeverAutoMerge,
            "{entity} must never be merged automatically"
        );
        assert_eq!(severity_for(entity), Severity::High);
    }
}

#[test]
fn concurrent_stock_movements_merge_because_deltas_are_additive() {
    let stored = vector(&[("a", 2), ("b", 1)]);
    let incoming = vector(&[("a", 1), ("b", 2)]);

    assert_eq!(policy_for("stock.adjusted"), MergePolicy::AutoMergeDeltas);
    assert_eq!(
        classify(&candidate("stock.adjusted", &stored, &incoming)),
        Decision::AutoMerge {
            severity: Severity::High
        }
    );
}

#[test]
fn catalog_metadata_resolves_by_last_writer_wins() {
    let stored = vector(&[("a", 2), ("b", 1)]);
    let incoming = vector(&[("a", 1), ("b", 2)]);

    assert_eq!(severity_for("product.update"), Severity::Low);
    assert_eq!(policy_for("product.update"), MergePolicy::LastWriterWins);

    // Equal totals and equal terminal sets, so the counter sequence decides:
    // stored is [a=2, b=1] against incoming [a=1, b=2], and [2,1] > [1,2].
    assert_eq!(tie_break(&stored, &incoming), std::cmp::Ordering::Greater);
    assert_eq!(
        classify(&candidate("product.update", &stored, &incoming)),
        Decision::LastWriterWins {
            winner_is_remote: false
        }
    );
}

#[test]
fn tie_break_never_calls_two_different_vectors_equal() {
    // The bug this guards: [a=2,b=1] and [a=1,b=2] share both a total event
    // count and a terminal set, so a two-discriminator tie-break compared them
    // Equal — which would mean "same state" for a pair that is not.
    let stored = vector(&[("a", 2), ("b", 1)]);
    let incoming = vector(&[("a", 1), ("b", 2)]);

    assert_ne!(stored, incoming);
    assert_ne!(tie_break(&stored, &incoming), std::cmp::Ordering::Equal);
}

#[test]
fn disjoint_field_edits_do_not_overlap() {
    let local = json!({"email": "a@example.com"});
    let remote = json!({"phone": "555"});

    assert!(fields_are_disjoint(&local, &remote));
    assert!(overlapping_fields(&local, &remote).is_empty());
}

#[test]
fn overlapping_field_edits_are_detected() {
    let local = json!({"email": "a@example.com", "phone": "555"});
    let remote = json!({"email": "b@example.com", "notes": "x"});

    assert_eq!(
        overlapping_fields(&local, &remote),
        vec!["email".to_string()]
    );
    assert!(!fields_are_disjoint(&local, &remote));
}

#[test]
fn a_non_object_payload_has_no_overlapping_fields() {
    assert!(overlapping_fields(&json!(null), &json!({"a": 1})).is_empty());
    assert!(overlapping_fields(&json!([1, 2]), &json!([3])).is_empty());
}

#[test]
fn tie_break_is_total_and_symmetric() {
    let a = vector(&[("a", 2), ("b", 1)]);
    let b = vector(&[("a", 1), ("b", 2)]);

    // Equal totals, so the terminal set decides — and reversing the arguments
    // must reverse the answer, or replicas would disagree.
    assert_ne!(tie_break(&a, &b), std::cmp::Ordering::Equal);
    assert_eq!(tie_break(&a, &b), tie_break(&b, &a).reverse());
    assert_eq!(tie_break(&a, &a), std::cmp::Ordering::Equal);
}

#[test]
fn tie_break_prefers_the_vector_that_saw_more_events() {
    let busier = vector(&[("a", 9), ("b", 9)]);
    let quieter = vector(&[("a", 1)]);

    assert_eq!(tie_break(&quieter, &busier), std::cmp::Ordering::Less);
    assert_eq!(tie_break(&busier, &quieter), std::cmp::Ordering::Greater);
}

#[test]
fn a_customer_edit_to_different_fields_merges() {
    let stored = vector(&[("a", 2), ("b", 1)]);
    let incoming = vector(&[("a", 1), ("b", 2)]);
    let stored_payload = json!({"email": "a@example.com"});
    let incoming_payload = json!({"phone": "555"});

    assert_eq!(
        classify(&candidate_with_payloads(
            "customer.update",
            &stored,
            &incoming,
            &stored_payload,
            &incoming_payload,
        )),
        Decision::AutoMerge {
            severity: Severity::Medium
        }
    );
}

#[test]
fn a_customer_edit_to_the_same_field_is_flagged() {
    let stored = vector(&[("a", 2), ("b", 1)]);
    let incoming = vector(&[("a", 1), ("b", 2)]);
    let stored_payload = json!({"email": "a@example.com"});
    let incoming_payload = json!({"email": "b@example.com"});

    assert_eq!(
        classify(&candidate_with_payloads(
            "customer.update",
            &stored,
            &incoming,
            &stored_payload,
            &incoming_payload,
        )),
        Decision::Flag {
            severity: Severity::Medium
        }
    );
}

#[test]
fn a_customer_conflict_without_payloads_is_flagged_not_merged() {
    // Fail closed: with no bodies there is no way to prove the edits are
    // disjoint, so the conservative answer wins.
    let stored = vector(&[("a", 2), ("b", 1)]);
    let incoming = vector(&[("a", 1), ("b", 2)]);

    assert_eq!(
        classify(&candidate("customer.update", &stored, &incoming)),
        Decision::Flag {
            severity: Severity::Medium
        }
    );
}

#[test]
fn severity_strings_match_the_check_constraint() {
    // The column is CHECK (severity IN ('high','medium','low')); a typo here
    // would be rejected at insert time, far from the cause.
    assert_eq!(Severity::High.as_str(), "high");
    assert_eq!(Severity::Medium.as_str(), "medium");
    assert_eq!(Severity::Low.as_str(), "low");
}
