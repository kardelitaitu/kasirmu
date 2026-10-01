//! Unit tests for `payload`.
//!
//! Moved out of `payload.rs` to satisfy the AGENTS.md section 2 rule that unit
//! tests live in a sibling `*_tests.rs` file rather than inside a production
//! `.rs` file. Wired from `payload.rs` with:
//!   `#[cfg(test)] #[path = "payload_tests.rs"] mod tests;`

use super::*;

fn minimal_payload() -> String {
    // Build a valid minimal static payload through the builder
    QrisBuilder::new()
        .nmid("ID1020001234567")
        .merchant_name("Test Merchant")
        .merchant_city("Jakarta")
        .merchant_category_code("5812")
        .build()
        .unwrap()
        .to_qris_string()
        .unwrap()
}

#[test]
fn parse_and_round_trip() {
    let s = minimal_payload();
    let p = QrisPayload::parse(&s).unwrap();
    let s2 = p.to_qris_string().unwrap();
    assert_eq!(s, s2, "round-trip must be identity");
}

#[test]
fn nmid_accessor() {
    let s = minimal_payload();
    let p = QrisPayload::parse(&s).unwrap();
    assert_eq!(p.nmid(), "ID1020001234567");
}

#[test]
fn into_dynamic_sets_amount() {
    let s = minimal_payload();
    let p = QrisPayload::parse(&s).unwrap();
    let dyn_p = p.into_dynamic("50000").unwrap();
    assert!(dyn_p.is_dynamic());
    assert_eq!(dyn_p.amount.as_deref(), Some("50000"));
    // The serialised result must still have a valid CRC
    assert!(QrisPayload::is_valid_crc(&dyn_p.to_qris_string().unwrap()));
}

#[test]
fn into_static_clears_amount() {
    let s = minimal_payload();
    let p = QrisPayload::parse(&s)
        .unwrap()
        .into_dynamic("50000")
        .unwrap()
        .into_static();
    assert!(p.is_static());
    assert!(p.amount.is_none());
}

#[test]
fn invalid_crc_rejected() {
    let mut s = minimal_payload();
    // Corrupt the last character of the CRC
    let last = s.pop().unwrap();
    s.push(if last == 'F' { '0' } else { 'F' });
    assert!(QrisPayload::parse(&s).is_err());
}
