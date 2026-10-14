//! Sibling unit tests for `notification.rs`.

use super::*;

#[test]
fn test_parse_bca_mobile() {
    let notif = parse_notification(
        "com.bca",
        Some("BCA mobile"),
        "QRIS Masuk: Rp 150.000 dari SITI NURHALIZA 15/09 11:20:05",
        1726400000000,
    )
    .expect("should parse BCA mobile");

    assert_eq!(notif.provider, "BCA");
    assert_eq!(notif.amount_minor, 150_000);
    assert_eq!(notif.amount_formatted, "Rp 150.000");
    assert_eq!(notif.sender_name.as_deref(), Some("SITI NURHALIZA"));
}

#[test]
fn test_parse_bank_jatim() {
    let notif = parse_notification(
        "com.bankjatim.jatimmobile",
        Some("Bank Jatim"),
        "QRIS Diterima: Pembayaran sebesar Rp 35.000 dari BUDI SETIAWAN telah masuk.",
        1726400000000,
    )
    .expect("should parse Bank Jatim");

    assert_eq!(notif.provider, "Bank Jatim");
    assert_eq!(notif.amount_minor, 35_000);
    assert_eq!(notif.sender_name.as_deref(), Some("BUDI SETIAWAN"));
}

#[test]
fn test_parse_brimo() {
    let notif = parse_notification(
        "id.co.bri.brimo",
        Some("BRImo"),
        "Transaksi Sukses: Terima dana QRIS Rp25.500 dari 081234567890.",
        1726400000000,
    )
    .expect("should parse BRImo");

    assert_eq!(notif.provider, "BRI");
    assert_eq!(notif.amount_minor, 25_500);
    assert_eq!(notif.sender_name.as_deref(), Some("081234567890"));
}

#[test]
fn test_parse_livin_mandiri() {
    let notif = parse_notification(
        "id.bmri.livin",
        Some("Livin' by Mandiri"),
        "Pembayaran QRIS masuk sebesar Rp 75.000 berhasil diterima.",
        1726400000000,
    )
    .expect("should parse Livin Mandiri");

    assert_eq!(notif.provider, "Mandiri");
    assert_eq!(notif.amount_minor, 75_000);
}

#[test]
fn test_parse_gobiz_gopay() {
    let notif = parse_notification(
        "com.gojek.gobiz",
        Some("GoBiz"),
        "Yippee! Ada pembayaran masuk sebesar Rp 12.000 via GoPay.",
        1726400000000,
    )
    .expect("should parse GoBiz");

    assert_eq!(notif.provider, "GoPay");
    assert_eq!(notif.amount_minor, 12_000);
}

#[test]
fn test_parse_shopeepay_merchant() {
    let notif = parse_notification(
        "com.shopeepay.merchant",
        Some("ShopeePay Merchant"),
        "Pembayaran diterima: Rp 45.000 dari Pelanggan ShopeePay.",
        1726400000000,
    )
    .expect("should parse ShopeePay");

    assert_eq!(notif.provider, "ShopeePay");
    assert_eq!(notif.amount_minor, 45_000);
}

#[test]
fn test_parse_dana_bisnis() {
    let notif = parse_notification(
        "id.dana",
        Some("DANA Bisnis"),
        "Pembayaran QRIS sebesar Rp 50.000 berhasil diterima dari AGUS.",
        1726400000000,
    )
    .expect("should parse DANA");

    assert_eq!(notif.provider, "DANA");
    assert_eq!(notif.amount_minor, 50_000);
    assert_eq!(notif.sender_name.as_deref(), Some("AGUS"));
}

#[test]
fn test_parse_ovo_merchant() {
    let notif = parse_notification(
        "ovo.id",
        Some("OVO"),
        "Transaksi Berhasil! Pembayaran Rp 60.000 telah masuk ke OVO Anda.",
        1726400000000,
    )
    .expect("should parse OVO");

    assert_eq!(notif.provider, "OVO");
    assert_eq!(notif.amount_minor, 60_000);
}

#[test]
fn test_parse_bni_and_bsi() {
    let bni = parse_notification(
        "id.co.bni",
        Some("BNI Mobile"),
        "Transaksi QRIS Masuk Rp 100.000 berhasil dari RIKO.",
        1726400000000,
    )
    .expect("should parse BNI");
    assert_eq!(bni.provider, "BNI");
    assert_eq!(bni.amount_minor, 100_000);
    assert_eq!(bni.sender_name.as_deref(), Some("RIKO"));

    let bsi = parse_notification(
        "id.co.bankbsi",
        Some("BSI Mobile"),
        "Dana masuk QRIS Rp 80.000 berhasil diterima.",
        1726400000000,
    )
    .expect("should parse BSI");
    assert_eq!(bsi.provider, "BSI");
    assert_eq!(bsi.amount_minor, 80_000);
}

#[test]
fn test_rejects_outward_debits_and_otp() {
    // Transfer keluar
    assert!(
        parse_notification(
            "com.bca",
            Some("BCA"),
            "Transfer keluar sebesar Rp 50.000 ke REK 123456 berhasil.",
            1726400000000
        )
        .is_none()
    );

    // Pembelian / Pulsa
    assert!(
        parse_notification(
            "id.bmri.livin",
            Some("Livin"),
            "Pembelian pulsa sebesar Rp 25.000 berhasil diproses.",
            1726400000000
        )
        .is_none()
    );

    // Saldo terpotong
    assert!(
        parse_notification(
            "id.dana",
            Some("DANA"),
            "Saldo terpotong Rp 30.000 untuk transaksi merchant.",
            1726400000000
        )
        .is_none()
    );

    // OTP
    assert!(
        parse_notification(
            "com.bca",
            Some("BCA"),
            "JANGAN BERIKAN KODE OTP: 492011 kepada siapapun termasuk pihak bank.",
            1726400000000
        )
        .is_none()
    );

    // Unrelated WhatsApp message
    assert!(
        parse_notification(
            "com.whatsapp",
            Some("Budi"),
            "Halo bro, apa kabar?",
            1726400000000
        )
        .is_none()
    );
}

#[test]
fn test_amount_extraction_formats() {
    assert_eq!(
        extract_amount("Pembayaran Rp 50.000 berhasil"),
        Some(50_000)
    );
    assert_eq!(
        extract_amount("Total Rp. 150.000,00 diterima"),
        Some(150_000)
    );
    assert_eq!(
        extract_amount("Terima IDR 1.250.000 via transfer"),
        Some(1_250_000)
    );
    assert_eq!(extract_amount("Sukses 75.000 Rp masuk"), Some(75_000));
    assert_eq!(extract_amount("Transaksi Rp50000 diterima"), Some(50_000));
}

#[test]
fn test_format_idr() {
    assert_eq!(format_idr(0), "Rp 0");
    assert_eq!(format_idr(500), "Rp 500");
    assert_eq!(format_idr(50_000), "Rp 50.000");
    assert_eq!(format_idr(1_250_000), "Rp 1.250.000");
    assert_eq!(format_idr(-10_000), "-Rp 10.000");
}

#[test]
fn test_qris_match_engine() {
    let mut engine = QrisMatchEngine::new(50, Some(99));
    let base_time = 1726400000000u64;

    let notif = parse_notification(
        "com.bca",
        Some("BCA"),
        "QRIS Masuk: Rp 50.000 dari BUDI",
        base_time,
    )
    .unwrap();

    // 1. Exact match within TTL
    let res = engine.matches(50_000, &notif, 600_000, base_time + 5_000);
    assert_eq!(res, MatchResult::Exact);

    // 2. Duplicate detection
    let res_dup = engine.matches(50_000, &notif, 600_000, base_time + 10_000);
    assert_eq!(res_dup, MatchResult::Duplicate);

    // 3. Unique code offset match (e.g. sale is 35.000, customer pays 35.012)
    let notif_unique = parse_notification(
        "id.bmri.livin",
        Some("Livin"),
        "QRIS Masuk: Rp 35.012 dari SITI",
        base_time + 1_000,
    )
    .unwrap();

    let res_unique = engine.matches(35_000, &notif_unique, 600_000, base_time + 6_000);
    assert_eq!(res_unique, MatchResult::UniqueCode { offset: 12 });

    // 4. Mismatch
    let notif_diff = parse_notification(
        "com.bca",
        Some("BCA"),
        "QRIS Masuk: Rp 99.000 dari JOKO",
        base_time + 2_000,
    )
    .unwrap();
    let res_mismatch = engine.matches(50_000, &notif_diff, 600_000, base_time + 7_000);
    assert_eq!(res_mismatch, MatchResult::Mismatch);

    // 5. Expired TTL (older than 10 minutes)
    let notif_old = parse_notification(
        "com.bca",
        Some("BCA"),
        "QRIS Masuk: Rp 20.000 dari EKO",
        base_time,
    )
    .unwrap();
    let res_expired = engine.matches(20_000, &notif_old, 600_000, base_time + 700_000);
    assert_eq!(res_expired, MatchResult::Expired);
}
