//! Unit and wire-contract tests for `qris_listener`.

use super::*;

#[test]
fn test_dto_camel_case_serialization() {
    let status = QrisListenerStatusDto {
        is_supported: true,
        is_enabled: true,
        is_connected: true,
        platform: "android".to_string(),
    };

    let json = serde_json::to_string(&status).unwrap();
    assert!(json.contains("\"isSupported\":true"));
    assert!(json.contains("\"isEnabled\":true"));
    assert!(json.contains("\"isConnected\":true"));
    assert!(json.contains("\"platform\":\"android\""));

    let payment = QrisRecentPaymentDto {
        provider: "BCA".to_string(),
        amount_minor: 75_000,
        amount_formatted: "Rp 75.000".to_string(),
        raw_text: "QRIS Masuk: Rp 75.000".to_string(),
        package_name: "com.bca".to_string(),
        timestamp_ms: 1726400000000,
        sender_name: Some("BUDI".to_string()),
    };

    let p_json = serde_json::to_string(&payment).unwrap();
    assert!(p_json.contains("\"provider\":\"BCA\""));
    assert!(p_json.contains("\"amountMinor\":75000"));
    assert!(p_json.contains("\"amountFormatted\":\"Rp 75.000\""));
    assert!(p_json.contains("\"senderName\":\"BUDI\""));
    assert!(p_json.contains("\"timestampMs\":1726400000000"));
}

#[test]
fn test_conversion_from_bank_notification() {
    let notif = qris_core::parse_notification(
        "com.bca",
        Some("BCA"),
        "QRIS Masuk: Rp 125.000 dari CITRA 15/09 10:00:00",
        1726400000000,
    )
    .expect("should parse");

    let dto: QrisRecentPaymentDto = notif.into();
    assert_eq!(dto.provider, "BCA");
    assert_eq!(dto.amount_minor, 125_000);
    assert_eq!(dto.amount_formatted, "Rp 125.000");
    assert_eq!(dto.sender_name.as_deref(), Some("CITRA"));
    assert_eq!(dto.package_name, "com.bca");
    assert_eq!(dto.timestamp_ms, 1726400000000);
}

#[test]
fn test_simulate_args_parsing() {
    let args = SimulateQrisNotificationArgs {
        package_name: Some("id.bmri.livin".to_string()),
        title: Some("Livin' by Mandiri".to_string()),
        text: "Pembayaran QRIS masuk sebesar Rp 50.000 berhasil diterima.".to_string(),
        timestamp_ms: Some(1726400000000),
    };

    let parsed = qris_core::parse_notification(
        args.package_name.as_deref().unwrap_or("com.bca"),
        args.title.as_deref(),
        &args.text,
        args.timestamp_ms.unwrap_or(0),
    )
    .expect("should parse simulation");

    let dto: QrisRecentPaymentDto = parsed.into();
    assert_eq!(dto.provider, "Mandiri");
    assert_eq!(dto.amount_minor, 50_000);
    assert_eq!(dto.package_name, "id.bmri.livin");
}
