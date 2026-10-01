//! Unit tests for `builder`.
//!
//! Moved out of `builder.rs` to satisfy the AGENTS.md section 2 rule that unit
//! tests live in a sibling `*_tests.rs` file rather than inside a production
//! `.rs` file. Wired from `builder.rs` with:
//!   `#[cfg(test)] #[path = "builder_tests.rs"] mod tests;`

use super::*;

#[test]
fn minimal_build() {
    let p = QrisBuilder::new()
        .nmid("ID1020001234567")
        .merchant_name("Test")
        .merchant_city("Jakarta")
        .merchant_category_code("5812")
        .build()
        .unwrap();
    assert_eq!(p.nmid(), "ID1020001234567");
    assert!(p.is_static());
    // CRC must be valid
    assert!(QrisPayload::is_valid_crc(&p.to_qris_string().unwrap()));
}

#[test]
fn dynamic_with_amount() {
    let p = QrisBuilder::new()
        .nmid("ID1020001234567")
        .merchant_name("Test")
        .merchant_city("Jakarta")
        .merchant_category_code("5812")
        .amount("50000")
        .build()
        .unwrap();
    assert!(p.is_dynamic());
    assert_eq!(p.amount.as_deref(), Some("50000"));
}

#[test]
fn missing_nmid_error() {
    let err = QrisBuilder::new()
        .merchant_name("Test")
        .merchant_city("Jakarta")
        .merchant_category_code("5812")
        .build();
    assert!(matches!(err, Err(QrisError::MissingNmid)));
}

#[test]
fn with_additional_data() {
    let p = QrisBuilder::new()
        .nmid("ID1020001234567")
        .merchant_name("Test")
        .merchant_city("Jakarta")
        .merchant_category_code("5812")
        .terminal_label("T001")
        .bill_number("INV-2024-001")
        .build()
        .unwrap();
    let ad = p.additional_data.unwrap();
    assert_eq!(ad.terminal_label.as_deref(), Some("T001"));
    assert_eq!(ad.bill_number.as_deref(), Some("INV-2024-001"));
}

#[test]
fn from_payload_round_trip() {
    let original = QrisBuilder::new()
        .nmid("ID1020001234567")
        .merchant_name("Original Name")
        .merchant_city("Bandung")
        .merchant_category_code("5812")
        .build()
        .unwrap();

    let mutated = original
        .into_builder()
        .merchant_name("New Name")
        .build()
        .unwrap();

    assert_eq!(mutated.merchant_name, "New Name");
    assert_eq!(mutated.nmid(), "ID1020001234567");
}

#[test]
fn with_pan_criteria_postal() {
    let p = QrisBuilder::new()
        .nmid("ID1023000885752")
        .guid("ID.CO.BANKJATIM.WWW")
        .merchant_pan("936001140000088872")
        .criteria("UKE")
        .postal_code("61363")
        .merchant_name("082 PUSK TROWULAN")
        .merchant_city("MOJOKERTO")
        .merchant_category_code("9399")
        .amount("100000")
        .build()
        .unwrap();

    assert_eq!(p.merchant_pan(), Some("936001140000088872"));
    assert_eq!(p.criteria(), Some("UKE"));
    assert_eq!(p.postal_code.as_deref(), Some("61363"));
    assert!(p.is_dynamic());

    let raw = p.to_qris_string().unwrap();
    assert!(raw.contains("936001140000088872"));
    assert!(raw.contains("61363"));
    assert!(QrisPayload::is_valid_crc(&raw));

    let reparsed = QrisPayload::parse(&raw).unwrap();
    assert_eq!(reparsed.merchant_pan(), Some("936001140000088872"));
    assert_eq!(reparsed.criteria(), Some("UKE"));
    assert_eq!(reparsed.postal_code.as_deref(), Some("61363"));
}
