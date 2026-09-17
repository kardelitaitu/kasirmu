use super::*;

fn test_api_key() -> String {
    "EAAA_test_square_api_key_123456".to_string()
}

fn test_location_id() -> String {
    "L_ABC123".to_string()
}

#[test]
fn square_processor_construction() {
    let proc = SquarePaymentProcessor::new(&test_api_key(), &test_location_id());
    assert_eq!(proc.api_key, test_api_key());
    assert_eq!(proc.location_id, test_location_id());
}

#[test]
fn square_device_info() {
    let proc = SquarePaymentProcessor::new(&test_api_key(), &test_location_id());
    let info = proc.device_info();
    assert_eq!(info.vendor, "Square");
    assert_eq!(info.model, "Square API");
}

#[test]
fn square_debug_masks_key() {
    let proc = SquarePaymentProcessor::new(&test_api_key(), &test_location_id());
    let debug = format!("{:?}", proc);
    assert!(!debug.contains("EAAA_test"));
    assert!(debug.contains("***"));
}

#[test]
fn square_parse_payment_success() {
    let json = r#"{
        "payment": {
            "id": "sq_payment_123",
            "status": "COMPLETED",
            "amount_money": {"amount": 1000, "currency": "USD"},
            "created_at": "2026-06-30T12:00:00Z"
        }
    }"#;
    let payment = SquarePaymentProcessor::parse_payment(json).unwrap();
    assert_eq!(payment.id, "sq_payment_123");
    assert_eq!(payment.status, "COMPLETED");
    assert_eq!(payment.amount_money.amount, 1000);
    assert_eq!(payment.created_at.unwrap(), "2026-06-30T12:00:00Z");
}

#[test]
fn square_parse_refund_success() {
    let json = r#"{
        "refund": {
            "id": "sq_refund_456",
            "status": "COMPLETED",
            "amount_money": {"amount": 500, "currency": "USD"}
        }
    }"#;
    let refund = SquarePaymentProcessor::parse_refund(json).unwrap();
    assert_eq!(refund.id, "sq_refund_456");
    assert_eq!(refund.status, "COMPLETED");
    assert_eq!(refund.amount_money.amount, 500);
}

#[test]
fn square_parse_error_body() {
    let json = r#"{
        "errors": [
            {"code": "CARD_DECLINED", "detail": "The card was declined."}
        ]
    }"#;
    let body: SquareErrorBody = serde_json::from_str(json).unwrap();
    assert_eq!(body.errors[0].code.as_deref(), Some("CARD_DECLINED"));
    assert_eq!(
        body.errors[0].detail.as_deref(),
        Some("The card was declined.")
    );
}

#[test]
fn square_parse_error_no_detail() {
    let json = r#"{"errors": [{"code": "NOT_FOUND"}]}"#;
    let body: SquareErrorBody = serde_json::from_str(json).unwrap();
    assert_eq!(body.errors[0].detail, None);
}

#[test]
fn square_parse_error_formats() {
    let err = SquarePaymentProcessor::parse_error(
        402,
        r#"{"errors":[{"code":"CARD_DECLINED","detail":"declined"}]}"#,
    );
    let msg = err.to_string();
    assert!(msg.contains("declined"));
}

#[test]
fn square_parse_error_non_json() {
    let err = SquarePaymentProcessor::parse_error(500, "Internal Server Error");
    let msg = err.to_string();
    assert!(msg.contains("500"));
    assert!(msg.contains("Internal Server Error"));
}

#[test]
fn square_payment_result_completed() {
    let data = PaymentData {
        id: "sq_1".into(),
        status: "COMPLETED".into(),
        amount_money: MoneyAmountResponse {
            amount: 1000,
            currency: "USD".into(),
        },
        created_at: None,
    };
    let (success, money) = SquarePaymentProcessor::payment_result(&data).unwrap();
    assert!(success);
    assert_eq!(money.minor_units, 1000);
}

#[test]
fn square_payment_result_approved() {
    let data = PaymentData {
        id: "sq_2".into(),
        status: "APPROVED".into(),
        amount_money: MoneyAmountResponse {
            amount: 2000,
            currency: "USD".into(),
        },
        created_at: None,
    };
    let (success, _) = SquarePaymentProcessor::payment_result(&data).unwrap();
    assert!(success);
}

#[test]
fn square_payment_result_failed() {
    let data = PaymentData {
        id: "sq_3".into(),
        status: "FAILED".into(),
        amount_money: MoneyAmountResponse {
            amount: 500,
            currency: "USD".into(),
        },
        created_at: None,
    };
    let (success, _) = SquarePaymentProcessor::payment_result(&data).unwrap();
    assert!(!success);
}

#[test]
fn square_to_money_constructs() {
    let m = SquarePaymentProcessor::to_money(1000, "USD").unwrap();
    assert_eq!(m.minor_units, 1000);
}

// PA-02: an unknown gateway currency code must be a hard error, never a
// silent USD fallback that mislabels the recorded amount.
#[test]
fn square_to_money_rejects_unknown_currency() {
    assert!(SquarePaymentProcessor::to_money(1000, "XX").is_err());
    assert!(SquarePaymentProcessor::to_money(1000, "US").is_err());
    assert!(SquarePaymentProcessor::to_money(1000, "usd1").is_err());
}

#[test]
fn square_to_square_amount() {
    let usd: Currency = "USD".parse().unwrap();
    let amount = Money::from_major(10, usd).unwrap();
    assert_eq!(SquarePaymentProcessor::to_square_amount(&amount), 1000);
}

// ── PAY-2: idempotency key derivation ─────────────────────────

fn charge_request(key: Option<&str>) -> PaymentRequest {
    PaymentRequest {
        amount: Money::from_major(25, "USD".parse().unwrap()).unwrap(),
        reference: Some("order-42".into()),
        description: None,
        idempotency_key: key.map(str::to_string),
    }
}

#[test]
fn a_retried_charge_must_derive_the_same_idempotency_key() {
    // The PAY-2 property, stated once: two authorize() calls carrying the
    // same caller key must send the same key, or Square cannot recognise the
    // second as a retry and both are charged.
    let first = SquarePaymentProcessor::idempotency_key_for(&charge_request(Some("order-42-v1")));
    let retry = SquarePaymentProcessor::idempotency_key_for(&charge_request(Some("order-42-v1")));
    assert_eq!(
        first, retry,
        "same caller key must derive the same idempotency_key, got {first} and {retry}"
    );
}

#[test]
fn the_caller_key_is_used_verbatim() {
    // Square's idempotency_key is free-form, so unlike Midtrans there is no
    // charset to sanitize into. Passing the value through unchanged keeps
    // `order-42-v1` and `order-42-v2` distinct; any rewriting here risks two
    // different caller keys landing on one, which drops a payment silently.
    let key = "018f3c2e-7b1a-7000-8000-00000000abcd";
    assert_eq!(
        SquarePaymentProcessor::idempotency_key_for(&charge_request(Some(key))),
        key
    );
}

#[test]
fn a_long_caller_key_is_not_truncated() {
    // Tempting to clamp to a "safe" length, and wrong: truncation maps two
    // distinct keys onto one, and a collision on the money path means a
    // legitimate charge is silently treated as a duplicate and dropped. If
    // the key is too long for Square, the API should say so loudly.
    let long = "k".repeat(200);
    let derived = SquarePaymentProcessor::idempotency_key_for(&charge_request(Some(&long)));
    assert_eq!(
        derived.len(),
        200,
        "the key must be passed through, not clamped: got {} chars",
        derived.len()
    );
}

#[test]
fn a_missing_key_still_produces_a_unique_one_per_call() {
    // Guard, not a fix: PaymentRequest documents idempotency_key as
    // optional, and the previous behavior of minting per call is correct for
    // callers that do not supply one. The fix must not make keyless calls
    // collide.
    let first = SquarePaymentProcessor::idempotency_key_for(&charge_request(None));
    let second = SquarePaymentProcessor::idempotency_key_for(&charge_request(None));
    assert_ne!(first, second, "keyless calls must not share a key");
    assert!(!first.is_empty());
}

#[test]
fn a_blank_key_is_treated_as_no_key_at_all() {
    // The sharp edge of "honor the caller key": Some("") is a key. Sent
    // verbatim, every caller that leaves the field blank would share one
    // idempotency key, and after the first charge Square would reject each
    // subsequent one as a duplicate. Blank and whitespace-only are absent.
    let blank = SquarePaymentProcessor::idempotency_key_for(&charge_request(Some("")));
    let spaces = SquarePaymentProcessor::idempotency_key_for(&charge_request(Some("   ")));
    assert!(!blank.is_empty(), "a blank key must not be sent as-is");
    assert_ne!(
        blank, spaces,
        "both blank forms must fall back to fresh keys, not share one"
    );
}
