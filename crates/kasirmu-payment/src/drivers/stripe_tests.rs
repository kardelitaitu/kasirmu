use super::*;
use std::str;

fn test_key() -> String {
    "sk_test_dummy_key_1234567890".to_string()
}

fn currency_code(c: &Currency) -> &str {
    str::from_utf8(&c.0).unwrap_or("???")
}

#[test]
fn stripe_constructs() {
    let proc = StripePaymentProcessor::new(&test_key(), false);
    let info = proc.device_info();
    assert_eq!(info.vendor, "Stripe");
    assert_eq!(info.model, "REST API");
}

#[test]
fn stripe_pm_type_card() {
    let proc = StripePaymentProcessor::new(&test_key(), false);
    assert_eq!(proc.pm_type(), "card");
}

#[test]
fn stripe_pm_type_card_present() {
    let proc = StripePaymentProcessor::new(&test_key(), true);
    assert_eq!(proc.pm_type(), "card_present");
}

#[test]
fn stripe_to_stripe_amount() {
    let usd: Currency = "USD".parse().unwrap();
    let amount = Money::from_major(10, usd).unwrap();
    assert_eq!(StripePaymentProcessor::to_stripe_amount(&amount), 1000);
}

#[test]
fn stripe_to_currency_usd() {
    let c = StripePaymentProcessor::to_currency("usd").unwrap();
    assert_eq!(currency_code(&c), "USD");
}

#[test]
fn stripe_to_currency_eur() {
    let c = StripePaymentProcessor::to_currency("eur").unwrap();
    assert_eq!(currency_code(&c), "EUR");
}

#[test]
fn stripe_to_money_constructs() {
    let m = StripePaymentProcessor::to_money(1000, "usd").unwrap();
    assert_eq!(m.minor_units, 1000);
    assert_eq!(currency_code(&m.currency), "USD");
}

// PA-02: an unknown gateway currency code must be a hard error, never a
// silent USD fallback that mislabels the recorded amount.
#[test]
fn stripe_to_currency_rejects_unknown() {
    assert!(StripePaymentProcessor::to_currency("xx").is_err());
    assert!(StripePaymentProcessor::to_currency("us").is_err());
    assert!(StripePaymentProcessor::to_money(1000, "notacurrency").is_err());
}

#[test]
fn stripe_parse_intent_success() {
    let json = r#"{"id":"pi_test_123","amount":1000,"amount_received":1000,"currency":"usd","status":"succeeded"}"#;
    let intent = StripePaymentProcessor::parse_intent(json).unwrap();
    assert_eq!(intent.id, "pi_test_123");
    assert_eq!(intent.amount, 1000);
    assert_eq!(intent.amount_received, Some(1000));
    assert_eq!(intent.currency, "usd");
    assert_eq!(intent.status, "succeeded");
}

#[test]
fn stripe_parse_intent_no_amount_received() {
    let json = r#"{"id":"pi_test_456","amount":2000,"currency":"usd","status":"requires_capture"}"#;
    let intent = StripePaymentProcessor::parse_intent(json).unwrap();
    assert_eq!(intent.amount, 2000);
    assert_eq!(intent.amount_received, None);
}

#[test]
fn stripe_parse_refund_success() {
    let json = r#"{"id":"re_test_789","amount":500,"currency":"usd","status":"succeeded"}"#;
    let refund = StripePaymentProcessor::parse_refund(json).unwrap();
    assert_eq!(refund.id, "re_test_789");
    assert_eq!(refund.amount, 500);
    assert_eq!(refund.status, "succeeded");
}

#[test]
fn stripe_parse_error_body() {
    let json = r#"{"error":{"type":"card_error","message":"Your card was declined.","code":"card_declined"}}"#;
    let body: StripeErrorBody = serde_json::from_str(json).unwrap();
    assert_eq!(body.error.error_type, "card_error");
    assert_eq!(body.error.message.unwrap(), "Your card was declined.");
}

#[test]
fn stripe_parse_error_no_message() {
    let json = r#"{"error":{"type":"api_error"}}"#;
    let body: StripeErrorBody = serde_json::from_str(json).unwrap();
    assert_eq!(body.error.error_type, "api_error");
    assert!(body.error.message.is_none());
}

#[test]
fn stripe_secret_key_from_env_error_check() {
    let result = StripePaymentProcessor::from_env();
    match std::env::var("STRIPE_SECRET_KEY") {
        Ok(_) => assert!(result.is_ok()),
        Err(_) => {
            assert!(result.is_err());
            let msg = result.unwrap_err().to_string();
            assert!(msg.contains("not set"), "error: {}", msg);
        }
    }
}

#[test]
fn stripe_intent_result_succeeded() {
    let intent = PaymentIntentResponse {
        id: "pi_1".into(),
        amount: 1000,
        amount_received: Some(1000),
        currency: "usd".into(),
        status: "succeeded".into(),
    };
    let (success, money) = StripePaymentProcessor::intent_result(&intent).unwrap();
    assert!(success);
    assert_eq!(money.minor_units, 1000);
}

#[test]
fn stripe_intent_result_requires_capture() {
    let intent = PaymentIntentResponse {
        id: "pi_2".into(),
        amount: 2000,
        amount_received: None,
        currency: "usd".into(),
        status: "requires_capture".into(),
    };
    let (success, money) = StripePaymentProcessor::intent_result(&intent).unwrap();
    assert!(success);
    assert_eq!(money.minor_units, 2000);
}

#[test]
fn stripe_intent_result_canceled() {
    let intent = PaymentIntentResponse {
        id: "pi_3".into(),
        amount: 500,
        amount_received: None,
        currency: "usd".into(),
        status: "canceled".into(),
    };
    let (success, _) = StripePaymentProcessor::intent_result(&intent).unwrap();
    assert!(!success);
}

#[test]
fn stripe_parse_error_formats() {
    let err = StripePaymentProcessor::parse_error(
        402,
        r#"{"error":{"type":"card_error","message":"declined"}}"#,
    );
    let msg = err.to_string();
    assert!(msg.contains("declined"));
}

// ── PAY-4: decline classification ─────────────────────────────────────

#[test]
fn stripe_card_declined_maps_to_declined_not_invalid_card() {
    // card_declined is a bank/processor refusal — the previous classifier's
    // message.contains("card") heuristic sent this to InvalidCard, making
    // the "card_error => Declined" arm nearly unreachable.
    let err = StripePaymentProcessor::classify_stripe_error(
        "card_error",
        Some("Your card was declined."),
        Some("card_declined"),
    );
    assert!(
        matches!(err, PaymentError::Declined(_)),
        "card_declined should be Declined, got: {err}"
    );
}

#[test]
fn stripe_generic_card_error_maps_to_declined() {
    // No code — a plain card_error is a decline, not a card-data problem.
    let err = StripePaymentProcessor::classify_stripe_error("card_error", Some("declined"), None);
    assert!(
        matches!(err, PaymentError::Declined(_)),
        "plain card_error should be Declined, got: {err}"
    );
}

#[test]
fn stripe_card_data_problems_map_to_invalid_card() {
    for code in [
        "expired_card",
        "incorrect_number",
        "incorrect_cvc",
        "incorrect_zip",
    ] {
        let err = StripePaymentProcessor::classify_stripe_error(
            "card_error",
            Some("card problem"),
            Some(code),
        );
        assert!(
            matches!(err, PaymentError::InvalidCard(_)),
            "code {code} should be InvalidCard, got: {err}"
        );
    }
}

#[test]
fn stripe_processing_error_maps_to_declined() {
    let err = StripePaymentProcessor::classify_stripe_error(
        "card_error",
        Some("An error occurred while processing your card."),
        Some("processing_error"),
    );
    assert!(
        matches!(err, PaymentError::Declined(_)),
        "processing_error should be Declined, got: {err}"
    );
}

#[test]
fn stripe_idempotency_error_maps_to_duplicate() {
    let err = StripePaymentProcessor::classify_stripe_error(
        "idempotency_error",
        Some(
            "Keys for idempotent requests can only be used with the same parameters they were first used with.",
        ),
        Some("idempotency_key_in_use"),
    );
    assert!(
        matches!(err, PaymentError::Duplicate(_)),
        "idempotency_error should be Duplicate, got: {err}"
    );
}

#[test]
fn stripe_parse_error_non_json() {
    let err = StripePaymentProcessor::parse_error(500, "Internal Server Error");
    let msg = err.to_string();
    assert!(msg.contains("500"));
    assert!(msg.contains("Internal Server Error"));
}

#[test]
fn stripe_debug_masks_key() {
    let proc = StripePaymentProcessor::new(&test_key(), false);
    let debug = format!("{:?}", proc);
    assert!(!debug.contains("sk_test"));
    assert!(!debug.contains("dummy_key"));
    assert!(debug.contains("***"));
}

#[test]
fn stripe_clone_preserves_config() {
    let proc = StripePaymentProcessor::new(&test_key(), true);
    let cloned = proc.clone();
    assert_eq!(cloned.pm_type(), "card_present");
    let info = cloned.device_info();
    assert_eq!(info.vendor, "Stripe");
}

#[test]
fn stripe_new_with_endpoint_uses_custom_base() {
    let proc = StripePaymentProcessor::new_with_endpoint("sk_test", "http://localhost:9999", false);
    let debug = format!("{:?}", proc);
    assert!(debug.contains("localhost:9999"));
}
