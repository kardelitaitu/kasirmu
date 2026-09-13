use super::*;

fn test_key() -> String {
    "MID-server_test_key_123456".to_string()
}

#[test]
fn qris_constructs() {
    let proc = QrisPaymentProcessor::new(&test_key(), false);
    let info = proc.device_info();
    assert_eq!(info.vendor, "Midtrans");
    assert_eq!(info.model, "QRIS");
}

#[test]
fn qris_constructs_sandbox() {
    let proc = QrisPaymentProcessor::new(&test_key(), true);
    assert!(proc.sandbox);
}

#[test]
fn qris_base_url_production() {
    let proc = QrisPaymentProcessor::new(&test_key(), false);
    assert_eq!(proc.base_url(), "https://api.midtrans.com/v2");
}

#[test]
fn qris_base_url_sandbox() {
    let proc = QrisPaymentProcessor::new(&test_key(), true);
    assert_eq!(proc.base_url(), "https://api.sandbox.midtrans.com/v2");
}

#[test]
fn qris_base_url_custom_endpoint() {
    let proc = QrisPaymentProcessor::new_with_endpoint("sk_test", "http://localhost:9999", false);
    assert_eq!(proc.base_url(), "http://localhost:9999");
}

#[test]
fn qris_from_env_missing_key() {
    let result = QrisPaymentProcessor::from_env();
    match std::env::var("MIDTRANS_SERVER_KEY") {
        Ok(_) => assert!(result.is_ok()),
        Err(_) => {
            assert!(result.is_err());
            let msg = result.unwrap_err().to_string();
            assert!(msg.contains("not set"), "error: {}", msg);
        }
    }
}

#[test]
fn qris_generate_order_id_format() {
    let id = QrisPaymentProcessor::generate_order_id();
    assert!(
        id.starts_with("QRIS-"),
        "order id should start with QRIS-: {}",
        id
    );
    assert!(id.len() > 10, "order id should have reasonable length");
}

#[test]
fn qris_to_amount_string() {
    let idr = Currency(*b"IDR");
    let money = Money {
        minor_units: 50000,
        currency: idr,
    };
    assert_eq!(QrisPaymentProcessor::to_amount_string(&money), "50000");
}

#[test]
fn qris_parse_amount() {
    // PAY-1: Midtrans decimal-form amounts must parse, never zero out.
    // IDR is exp-0 (minor unit == Rupiah) and to_amount_string sends minor
    // units raw, so the major part maps 1:1 to minor units.
    assert_eq!(QrisPaymentProcessor::parse_amount("75000").unwrap(), 75000);
    assert_eq!(QrisPaymentProcessor::parse_amount("0").unwrap(), 0);
    assert_eq!(
        QrisPaymentProcessor::parse_amount("14500.00").unwrap(),
        14500
    );
    assert_eq!(
        QrisPaymentProcessor::parse_amount(" 25000.00 ").unwrap(),
        25000
    );
    assert_eq!(QrisPaymentProcessor::parse_amount("-50.00").unwrap(), -50);
}

#[test]
fn qris_parse_amount_rejects_malformed_and_sub_minor() {
    // Malformed input is a hard error — the old unwrap_or(0) silently
    // zeroed these and corrupted charge/capture/refund accounting.
    assert!(QrisPaymentProcessor::parse_amount("abc").is_err());
    assert!(QrisPaymentProcessor::parse_amount("").is_err());
    assert!(QrisPaymentProcessor::parse_amount("1.2.3").is_err());
    // Non-zero fractions are sub-Rupiah and unrepresentable in exp-0 IDR.
    assert!(QrisPaymentProcessor::parse_amount("14500.50").is_err());
    assert!(QrisPaymentProcessor::parse_amount("0.01").is_err());
    assert!(QrisPaymentProcessor::parse_amount("1.999").is_err());
}

#[test]
fn qris_order_id_uses_idempotency_key() {
    // PAY-2: a retried charge with the same idempotency key must resolve to
    // the same Midtrans order_id instead of minting a duplicate QR code.
    let req = |key: Option<&str>| PaymentRequest {
        amount: Money {
            minor_units: 50000,
            currency: Currency(*b"IDR"),
        },
        reference: None,
        description: None,
        idempotency_key: key.map(str::to_string),
    };
    let first =
        QrisPaymentProcessor::order_id_for(&req(Some("018f3c2e-7b1a-7000-8000-000000000001")));
    let retry =
        QrisPaymentProcessor::order_id_for(&req(Some("018f3c2e-7b1a-7000-8000-000000000001")));
    assert_eq!(first, retry, "same key must derive the same order_id");
    assert!(first.starts_with("QRIS-"));
    assert!(
        first.len() <= 50,
        "Midtrans caps order_id at 50 chars: {first}"
    );

    // Keys are sanitized to Midtrans's charset (alphanumerics, '-', '_').
    let dirty = QrisPaymentProcessor::order_id_for(&req(Some("key/with spaces!@#")));
    assert!(!dirty.contains(' '));
    assert!(!dirty.contains('/'));

    // A key that sanitizes to nothing falls back to a fresh order id.
    let junk = QrisPaymentProcessor::order_id_for(&req(Some("!!!")));
    assert!(junk.starts_with("QRIS-"));
    assert!(junk != "QRIS-");

    // No key: documented fallback is a freshly generated order id.
    let none_a = QrisPaymentProcessor::order_id_for(&req(None));
    let none_b = QrisPaymentProcessor::order_id_for(&req(None));
    assert_ne!(none_a, none_b, "fallback order ids must be unique");
}

#[test]
fn qris_parse_charge_response() {
    let json = r#"{
        "status_code": "201",
        "status_message": "QRIS transaction is created",
        "transaction_id": "txn_qris_001",
        "order_id": "QRIS-1234567890-abc",
        "gross_amount": "25000",
        "transaction_status": "pending",
        "qr_code_url": "https://api.midtrans.com/qris/qr-code-abc"
    }"#;
    let resp: QrisChargeResponse = serde_json::from_str(json).unwrap();
    assert_eq!(resp.status_code, "201");
    assert_eq!(resp.transaction_id, "txn_qris_001");
    assert_eq!(resp.order_id, "QRIS-1234567890-abc");
    assert_eq!(resp.gross_amount, "25000");
    assert_eq!(resp.transaction_status, "pending");
    assert_eq!(
        resp.qr_code_url.unwrap(),
        "https://api.midtrans.com/qris/qr-code-abc"
    );
}

#[test]
fn qris_parse_charge_response_minimal() {
    let json = r#"{
        "status_code": "201",
        "transaction_id": "txn_002",
        "order_id": "QRIS-xxx",
        "gross_amount": "10000",
        "transaction_status": "pending",
        "status_message": "OK"
    }"#;
    let resp: QrisChargeResponse = serde_json::from_str(json).unwrap();
    assert_eq!(resp.transaction_id, "txn_002");
    assert!(resp.qr_code_url.is_none());
}

#[test]
fn qris_parse_transaction_status() {
    let json = r#"{
        "transaction_id": "txn_003",
        "order_id": "QRIS-abc",
        "gross_amount": "50000",
        "transaction_status": "settlement",
        "status_code": "200",
        "status_message": "Success",
        "currency": "IDR",
        "payment_type": "qris"
    }"#;
    let tx: TransactionStatusResponse = serde_json::from_str(json).unwrap();
    assert_eq!(tx.transaction_status, "settlement");
    assert_eq!(tx.gross_amount, "50000");
    assert_eq!(tx.currency, "IDR");
}

#[test]
fn qris_parse_charge_response_qr_string_alias() {
    // The live Midtrans QRIS charge response names the payload `qr_string`
    // (https://docs.midtrans.com/reference/charge-bapi-1). The fixture above
    // used the struct field's own name and passed while the real gateway
    // would have deserialized to None — the alias is the fix, found wiring
    // the cloud charge endpoint (todo-payment-agents-1, 09-13).
    let json = r#"{
        "status_code": "201",
        "transaction_id": "txn_qris_003",
        "order_id": "QRIS-live-abc",
        "gross_amount": "15000.00",
        "transaction_status": "pending",
        "currency": "IDR",
        "qr_string": "0002010212154354112093600002AGWID20103UMI5144001646346777669208ID.CO.QRIS.WWW63041C96"
    }"#;
    let resp: QrisChargeResponse = serde_json::from_str(json).unwrap();
    assert!(resp
        .qr_code_url
        .unwrap()
        .starts_with("0002010212154354112093600002AGWID20103UMI"));
}

#[test]
fn qris_parse_error_response() {
    let json = r#"{"status_code": "402", "status_message": "Transaction amount exceeds limit"}"#;
    let err: MidtransErrorResponse = serde_json::from_str(json).unwrap();
    assert_eq!(err.status_code, "402");
    assert_eq!(err.status_message, "Transaction amount exceeds limit");
}

#[test]
fn qris_parse_error_empty() {
    let json = r#"{"status_code": "500", "status_message": ""}"#;
    let err: MidtransErrorResponse = serde_json::from_str(json).unwrap();
    assert_eq!(err.status_code, "500");
    assert!(err.status_message.is_empty());
}

#[test]
fn qris_debug_masks_key() {
    let proc = QrisPaymentProcessor::new(&test_key(), false);
    let debug = format!("{:?}", proc);
    assert!(!debug.contains("test_key"));
    assert!(!debug.contains("MID-server"));
    assert!(debug.contains("***"));
}

#[test]
fn qris_clone_preserves_config() {
    let proc = QrisPaymentProcessor::new(&test_key(), true);
    let cloned = proc.clone();
    assert!(cloned.sandbox);
    let info = cloned.device_info();
    assert_eq!(info.vendor, "Midtrans");
}

#[test]
fn qris_base64_encoding() {
    let encoded = base64_standard("test:key");
    assert!(!encoded.is_empty());
    assert!(!encoded.contains('\n'));
}
