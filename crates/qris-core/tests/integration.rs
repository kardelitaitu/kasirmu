//! Comprehensive integration tests for qris-core.

use qris_core::{
    is_valid_qris,
    mcc::mcc_description,
    nmid::NmidInfo,
    InitiationMethod, QrisBuilder, QrisPayload, Tip,
};

/// Ground-truth payload scanned directly from the real Bank Jatim QRIS sticker.
const REAL_BANK_JATIM_STATIC_QRIS: &str =
    "00020101021126710019ID.CO.BANKJATIM.WWW0215ID102300088575201189360011400000888720303UKE51440014ID.CO.QRIS.WWW0215ID10232699107000303UKE5204939953033605802ID5917082 PUSK TROWULAN6009MOJOKERTO61056136362070703A016304A923";

#[test]
fn test_real_bank_jatim_sticker_full_parsing() {
    assert!(is_valid_qris(REAL_BANK_JATIM_STATIC_QRIS));

    let payload = QrisPayload::parse(REAL_BANK_JATIM_STATIC_QRIS).expect("must parse valid real sticker");

    // Initiation method
    assert_eq!(payload.initiation, InitiationMethod::Static);
    assert!(payload.is_static());
    assert!(!payload.is_dynamic());

    // Primary Acquirer & Issuer
    assert_eq!(payload.issuer(), "Bank Jatim");
    assert_eq!(payload.provider_guid(), "ID.CO.BANKJATIM.WWW");
    assert_eq!(payload.nmid(), "ID1023000885752");
    assert_eq!(payload.merchant_pan(), Some("936001140000088872"));
    assert_eq!(payload.criteria(), Some("UKE"));

    // NMID decomposed validation
    let nmid_info = NmidInfo::parse(payload.nmid()).expect("must parse NMID");
    assert_eq!(nmid_info.country_code, "ID");
    assert_eq!(nmid_info.acquirer_code, "1023");
    assert_eq!(nmid_info.merchant_number, "000885752");

    // Acquirer slots (Tag 26 Bank Jatim + Tag 51 QRIS Central Repository)
    assert_eq!(payload.merchant_accounts.len(), 2);
    let bank_jatim_slot = &payload.merchant_accounts[0];
    assert_eq!(bank_jatim_slot.tag, 26);
    assert_eq!(bank_jatim_slot.guid, "ID.CO.BANKJATIM.WWW");
    assert_eq!(bank_jatim_slot.merchant_pan.as_deref(), Some("936001140000088872"));
    assert_eq!(bank_jatim_slot.nmid, "ID1023000885752");
    assert_eq!(bank_jatim_slot.criteria.as_deref(), Some("UKE"));

    let central_slot = &payload.merchant_accounts[1];
    assert_eq!(central_slot.tag, 51);
    assert_eq!(central_slot.guid, "ID.CO.QRIS.WWW");
    assert_eq!(central_slot.nmid, "ID1023269910700");
    assert_eq!(central_slot.criteria.as_deref(), Some("UKE"));

    // Merchant details
    assert_eq!(payload.merchant_name, "082 PUSK TROWULAN");
    assert_eq!(payload.merchant_city, "MOJOKERTO");
    assert_eq!(payload.postal_code.as_deref(), Some("61363"));
    assert_eq!(payload.country_code, "ID");
    assert_eq!(payload.currency, "360");
    assert_eq!(payload.merchant_category_code, "9399");
    assert_eq!(
        mcc_description(&payload.merchant_category_code),
        Some("Government Services, Not Elsewhere Classified")
    );

    // Tag 62 Additional Data
    let ad = payload.additional_data.as_ref().expect("Tag 62 must be present");
    assert_eq!(ad.terminal_label.as_deref(), Some("A01"));

    // Static sticker should have no amount or tip
    assert_eq!(payload.amount, None);
    assert_eq!(payload.tip, None);
}

#[test]
fn test_generate_dynamic_with_pan_postal_and_fixed_fee() {
    let payload = QrisBuilder::new()
        .nmid("ID1023000885752")
        .guid("ID.CO.BANKJATIM.WWW")
        .merchant_pan("936001140000088872")
        .criteria("UKE")
        .postal_code("61363")
        .merchant_name("082 PUSK TROWULAN")
        .merchant_city("MOJOKERTO")
        .merchant_category_code("9399")
        .amount("100000")
        .tip_fixed("700")
        .terminal_label("A01")
        .bill_number("INV-2026-0001")
        .build()
        .expect("must build dynamic payload");

    assert!(payload.is_dynamic());
    assert_eq!(payload.amount.as_deref(), Some("100000"));
    assert_eq!(payload.amount_rupiah().unwrap(), Some(100_000));
    assert_eq!(payload.merchant_pan(), Some("936001140000088872"));
    assert_eq!(payload.criteria(), Some("UKE"));
    assert_eq!(payload.postal_code.as_deref(), Some("61363"));
    assert_eq!(payload.tip, Some(Tip::Fixed { amount: "700".to_string() }));

    let ad = payload.additional_data.as_ref().unwrap();
    assert_eq!(ad.terminal_label.as_deref(), Some("A01"));
    assert_eq!(ad.bill_number.as_deref(), Some("INV-2026-0001"));

    let qris_str = payload.to_qris_string();
    assert!(is_valid_qris(&qris_str));

    // Verify raw wire contents
    assert!(qris_str.starts_with("000201010212")); // 010212 = Dynamic
    assert!(qris_str.contains("0118936001140000088872")); // Tag 26 Sub-tag 01 (PAN)
    assert!(qris_str.contains("0215ID1023000885752"));    // Tag 26 Sub-tag 02 (NMID)
    assert!(qris_str.contains("0303UKE"));                // Tag 26 Sub-tag 03 (Criteria)
    assert!(qris_str.contains("5406100000"));             // Tag 54 Amount Rp 100.000
    assert!(qris_str.contains("5502025603700"));         // Tag 55 "02" + Tag 56 "700"
    assert!(qris_str.contains("610561363"));             // Tag 61 Postal Code

    // Parse back from string and ensure complete lossless fidelity
    let parsed_back = QrisPayload::parse(&qris_str).expect("must parse generated string");
    assert_eq!(parsed_back.initiation, InitiationMethod::Dynamic);
    assert_eq!(parsed_back.merchant_pan(), Some("936001140000088872"));
    assert_eq!(parsed_back.criteria(), Some("UKE"));
    assert_eq!(parsed_back.postal_code.as_deref(), Some("61363"));
    assert_eq!(parsed_back.amount.as_deref(), Some("100000"));
    assert_eq!(parsed_back.tip, Some(Tip::Fixed { amount: "700".to_string() }));
    assert_eq!(
        parsed_back.additional_data.as_ref().and_then(|a| a.bill_number.as_deref()),
        Some("INV-2026-0001")
    );
}

#[test]
fn test_percentage_fee_generation_and_parsing() {
    let payload = QrisBuilder::new()
        .nmid("ID1020001234567")
        .merchant_name("Resto Nusantara")
        .merchant_city("Surabaya")
        .merchant_category_code("5812")
        .amount("75000")
        .tip_percent("0.7")
        .build()
        .unwrap();

    assert_eq!(payload.tip, Some(Tip::Percentage { percent: "0.7".to_string() }));
    let s = payload.to_qris_string();
    assert!(s.contains("55020357030.7")); // Tag 55 indicator 03, Tag 57 percent 0.7

    let parsed = QrisPayload::parse(&s).unwrap();
    assert_eq!(parsed.tip, Some(Tip::Percentage { percent: "0.7".to_string() }));
}

#[test]
fn test_percentage_fee_0_01_accuracy_and_rounding_up() {
    use qris_core::amount::calculate_percentage_fee;

    // 1. High-precision 0.01% test cases
    // 0.01% on 350,000 = 35 rupiah exactly
    assert_eq!(calculate_percentage_fee(350_000, "0.01").unwrap(), 35);
    // 0.01% on 1,000,000 = 100 rupiah exactly
    assert_eq!(calculate_percentage_fee(1_000_000, "0.01").unwrap(), 100);

    // 2. Fractional fee rounding UP (ceil) tests:
    // e.g. amount 350_000 with 0.00003% or non-integer fraction producing 350000.11 total:
    // Any fractional rupiah remainder like 0.11 or 0.001 must round UP to 1 rupiah.
    // 0.01% on 350,001 = 35.0001 -> rounds up to 36
    assert_eq!(calculate_percentage_fee(350_001, "0.01").unwrap(), 36);
    // 0.01% on 350,100 = 35.01 -> rounds up to 36
    assert_eq!(calculate_percentage_fee(350_100, "0.01").unwrap(), 36);
    // 0.01% on 350,999 = 35.0999 -> rounds up to 36
    assert_eq!(calculate_percentage_fee(350_999, "0.01").unwrap(), 36);

    // 3. Two decimal places percentage fees (e.g. 0.15%, 0.75%, 1.25%):
    // 0.75% on 50,000 = 375 exactly
    assert_eq!(calculate_percentage_fee(50_000, "0.75").unwrap(), 375);
    // 0.75% on 50,001 = 375.0075 -> rounds up to 376
    assert_eq!(calculate_percentage_fee(50_001, "0.75").unwrap(), 376);

    // 4. End-to-end QR generation with 0.01% precision fee
    let qris = QrisBuilder::new()
        .nmid("ID1020001234567")
        .merchant_name("Merchant Precision")
        .merchant_city("Jakarta")
        .merchant_category_code("5812")
        .amount("350000")
        .tip_percent("0.01")
        .build()
        .unwrap();

    let raw = qris.to_qris_string();
    assert!(raw.contains("55020357040.01")); // Tag 55 "03", Tag 57 "0.01" (length 04)
    assert!(is_valid_qris(&raw));

    let reparsed = QrisPayload::parse(&raw).unwrap();
    assert_eq!(reparsed.tip, Some(Tip::Percentage { percent: "0.01".to_string() }));
}

#[test]
fn test_sticker_mutation_into_dynamic_preserves_pan_and_postal() {
    // Start with the real static sticker
    let original = QrisPayload::parse(REAL_BANK_JATIM_STATIC_QRIS).unwrap();

    // Mutate using into_builder()
    let dynamic = original.into_builder()
        .amount("250000")
        .tip_fixed("1500")
        .bill_number("ORDER-7788")
        .build()
        .unwrap();

    assert!(dynamic.is_dynamic());
    assert_eq!(dynamic.amount.as_deref(), Some("250000"));
    assert_eq!(dynamic.merchant_pan(), Some("936001140000088872"));
    assert_eq!(dynamic.criteria(), Some("UKE"));
    assert_eq!(dynamic.postal_code.as_deref(), Some("61363"));
    assert_eq!(dynamic.issuer(), "Bank Jatim");

    let dynamic_str = dynamic.to_qris_string();
    assert!(is_valid_qris(&dynamic_str));

    // Also test clearing amount switches back to static and removes fees
    let cleared = dynamic.into_static();
    assert!(cleared.is_static());
    assert_eq!(cleared.amount, None);
    assert_eq!(cleared.tip, None);
    assert_eq!(cleared.merchant_pan(), Some("936001140000088872"));
    assert_eq!(cleared.postal_code.as_deref(), Some("61363"));
}

#[test]
fn test_tamper_detection_rejects_altered_fields() {
    let valid_dynamic = QrisBuilder::new()
        .nmid("ID1023000885752")
        .guid("ID.CO.BANKJATIM.WWW")
        .merchant_pan("936001140000088872")
        .postal_code("61363")
        .merchant_name("082 PUSK TROWULAN")
        .merchant_city("MOJOKERTO")
        .merchant_category_code("9399")
        .amount("50000")
        .build()
        .unwrap()
        .to_qris_string();

    assert!(is_valid_qris(&valid_dynamic));

    // Tamper test 1: Modify amount from 50000 to 90000 without updating CRC
    let tampered_amount = valid_dynamic.replace("540550000", "540590000");
    assert!(!is_valid_qris(&tampered_amount));
    assert!(QrisPayload::parse(&tampered_amount).is_err());

    // Tamper test 2: Alter PAN
    let tampered_pan = valid_dynamic.replace("936001140000088872", "936001140000099999");
    assert!(!is_valid_qris(&tampered_pan));
    assert!(QrisPayload::parse(&tampered_pan).is_err());

    // Tamper test 3: Alter Postal Code
    let tampered_postal = valid_dynamic.replace("610561363", "610512345");
    assert!(!is_valid_qris(&tampered_postal));
    assert!(QrisPayload::parse(&tampered_postal).is_err());
}
