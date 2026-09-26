//! Unit tests for `tlv`.
//!
//! Moved out of `tlv.rs` to satisfy the AGENTS.md section 2 rule that unit
//! tests live in a sibling `*_tests.rs` file rather than inside a production
//! `.rs` file. Wired from `tlv.rs` with:
//!   `#[cfg(test)] #[path = "tlv_tests.rs"] mod tests;`

use super::*;

#[test]
fn round_trip_simple() {
    let encoded = encode_field(0, "01").unwrap();
    assert_eq!(encoded, "000201");
    let tlvs = parse_tlvs(&encoded).unwrap();
    assert_eq!(tlvs.len(), 1);
    assert_eq!(tlvs[0].tag, 0);
    assert_eq!(tlvs[0].value, "01");
}

#[test]
fn round_trip_multiple() {
    let mut s = encode_field(0, "01").unwrap();
    s.push_str(&encode_field(1, "11").unwrap());
    let tlvs = parse_tlvs(&s).unwrap();
    assert_eq!(tlvs.len(), 2);
    assert_eq!(tlvs[1].tag, 1);
    assert_eq!(tlvs[1].value, "11");
}

#[test]
fn nested_round_trip() {
    let nested = encode_nested(26, &[(0, "ID.CO.QRIS.WWW"), (2, "ID1020001234567")]).unwrap();
    let outer = parse_tlvs(&nested).unwrap();
    assert_eq!(outer.len(), 1);
    assert_eq!(outer[0].tag, 26);

    let inner = parse_nested(&outer[0].value).unwrap();
    assert_eq!(inner[0].tag, 0);
    assert_eq!(inner[0].value, "ID.CO.QRIS.WWW");
    assert_eq!(inner[1].tag, 2);
    assert_eq!(inner[1].value, "ID1020001234567");
}
