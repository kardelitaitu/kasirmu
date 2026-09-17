//! Tests for the pure pub/sub filtering decision in [`Cache`]'s
//! inventory listener — bug hunt round C.
//!
//! The subscriber thread needs a live Redis plus a background task, so
//! its rules used to be untestable. `inventory_invalidation_target`
//! extracts the decision; these tests pin it.
//!
//! B48: with unknown terminal identity the subscriber skipped EVERY
//! message, contradicting the trait's documented contract.

use super::inventory_invalidation_target;

#[test]
fn a_foreign_terminal_message_invalidates_its_product() {
    let payload = r#"{"product_id":"p-1","sku":"LATTE","new_qty":4,"terminal_id":"T2"}"#;
    assert_eq!(
        inventory_invalidation_target(payload, "T1").as_deref(),
        Some("p-1"),
        "another terminal changed stock, so our cached quantity is stale"
    );
}

#[test]
fn our_own_message_is_skipped() {
    let payload = r#"{"product_id":"p-1","terminal_id":"T1"}"#;
    assert_eq!(
        inventory_invalidation_target(payload, "T1"),
        None,
        "a terminal must not invalidate what it just wrote"
    );
}

#[test]
fn malformed_payload_is_ignored() {
    assert_eq!(inventory_invalidation_target("not json", "T1"), None);
    assert_eq!(inventory_invalidation_target("", "T1"), None);
}

#[test]
fn payload_without_product_id_is_ignored() {
    let payload = r#"{"sku":"LATTE","terminal_id":"T2"}"#;
    assert_eq!(inventory_invalidation_target(payload, "T1"), None);
}

#[test]
fn non_string_product_id_is_ignored() {
    // A numeric id must not be coerced — it is a schema violation and
    // invalidating on a guessed key would be worse than doing nothing.
    let payload = r#"{"product_id":42,"terminal_id":"T2"}"#;
    assert_eq!(inventory_invalidation_target(payload, "T1"), None);
}

#[test]
fn unknown_identity_processes_every_message() {
    // The trait documents: "Pass None if terminal identity is unknown
    // (all messages will be processed)." An unknown local id arrives as
    // "", and publish_inventory_change() writes "" for an unknown remote
    // id too — so comparing them equal makes the subscriber ignore every
    // single notification and serve stale inventory until the TTL.
    let payload = r#"{"product_id":"p-1","terminal_id":""}"#;
    assert_eq!(
        inventory_invalidation_target(payload, "").as_deref(),
        Some("p-1"),
        "with no identity to compare against, nothing may be treated as our own write"
    );
}

#[test]
fn a_known_terminal_still_processes_an_untagged_message() {
    // The mirror case: a real terminal id vs a message with no tag.
    let payload = r#"{"product_id":"p-1"}"#;
    assert_eq!(
        inventory_invalidation_target(payload, "T1").as_deref(),
        Some("p-1")
    );
}
