//! Tests for [`crate::workspace_type`].

use super::*;

/// The literals are a wire contract with the licence server's `allowed_types`
/// and with the topology canvas, so a rename here is a breaking change to two
/// other systems. Pin the exact strings rather than referencing the constants,
/// which would pass for any value.
#[test]
fn keys_match_the_licence_server_contract() {
    assert_eq!(STORE_POS, "store-pos");
    assert_eq!(RESTAURANT_POS, "restaurant-pos");
    assert_eq!(KDS, "kds");
    assert_eq!(WAREHOUSE, "warehouse");
    assert_eq!(INVENTORY, "inventory");
    assert_eq!(ADMIN, "admin");
}

#[test]
fn pos_types_are_exactly_the_two_pos_terminals() {
    assert_eq!(POS_TYPES, [STORE_POS, RESTAURANT_POS]);
}

#[test]
fn is_pos_type_accepts_both_pos_verticals() {
    assert!(is_pos_type(STORE_POS));
    assert!(is_pos_type(RESTAURANT_POS));
}

#[test]
fn is_pos_type_rejects_every_non_pos_vertical() {
    for key in [KDS, WAREHOUSE, INVENTORY, ADMIN] {
        assert!(!is_pos_type(key), "{key} is not a POS vertical");
    }
}

/// Fail-closed on anything unrecognised: an unknown or empty key must not be
/// treated as a register, because that would hand it the register quota.
#[test]
fn is_pos_type_rejects_unknown_and_empty_keys() {
    assert!(!is_pos_type(""));
    assert!(!is_pos_type("store_pos"));
    assert!(!is_pos_type("STORE-POS"));
    assert!(!is_pos_type("restaurant"));
    assert!(!is_pos_type("pos"));
}

#[test]
fn is_restaurant_pos_type_is_true_only_for_the_restaurant_vertical() {
    assert!(is_restaurant_pos_type(RESTAURANT_POS));
    assert!(!is_restaurant_pos_type(STORE_POS));
    assert!(!is_restaurant_pos_type(KDS));
    assert!(!is_restaurant_pos_type(""));
}

/// A terminal id is not a vertical. `restaurant_pos_id` (ADR #40) holds a
/// *terminal* id, and the two must never be interchangeable — that confusion is
/// the reason these helpers carry the `_type` suffix.
#[test]
fn a_terminal_id_is_not_a_workspace_type() {
    assert!(!is_restaurant_pos_type("restaurant-pos-01"));
    assert!(!is_pos_type("terminal-001"));
    assert!(!is_pos_type("01H8XYZ"));
}
