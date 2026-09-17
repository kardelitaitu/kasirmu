use super::*;
use crate::money::Money;

// ── Payment serde roundtrip ────────────────────────────────────

#[test]
fn payment_serde_roundtrip_basic() {
    let payment = Payment {
        id: "pay-1".into(),
        sale_id: "sale-1".into(),
        method: "cash".into(),
        amount: Money {
            minor_units: 50000,
            currency: "IDR".parse().unwrap(),
        },
        created_at: "2025-07-07T12:00:00.000Z".into(),
        gateway_reference: None,
        gateway_status: None,
        gateway_response: None,
        idempotency_key: None,
    };
    let json = serde_json::to_string(&payment).unwrap();
    let back: Payment = serde_json::from_str(&json).unwrap();
    assert_eq!(back.id, "pay-1");
    assert_eq!(back.method, "cash");
    assert_eq!(back.amount.minor_units, 50000);
    assert_eq!(back.amount.currency.to_string(), "IDR");
}

#[test]
fn payment_serde_roundtrip_with_gateway() {
    let payment = Payment {
        id: "pay-2".into(),
        sale_id: "sale-2".into(),
        method: "card".into(),
        amount: Money {
            minor_units: 25000,
            currency: "USD".parse().unwrap(),
        },
        created_at: "2025-07-07T12:00:00.000Z".into(),
        gateway_reference: Some("txn_abc123".into()),
        gateway_status: Some("approved".into()),
        gateway_response: Some(r#"{"id":"txn_abc123"}"#.into()),
        idempotency_key: Some("key_abc".into()),
    };
    let json = serde_json::to_string(&payment).unwrap();
    let back: Payment = serde_json::from_str(&json).unwrap();
    assert_eq!(back.idempotency_key.as_deref(), Some("key_abc"));
    assert_eq!(back.gateway_reference.as_deref(), Some("txn_abc123"));
    assert_eq!(back.gateway_status.as_deref(), Some("approved"));
    assert!(back.gateway_response.is_some());
}

#[test]
fn payment_split_arg_serde_roundtrip() {
    let split = PaymentSplitArg {
        method: "card".into(),
        amount_minor: 30000,
        gateway_reference: Some("txn_def456".into()),
        gateway_status: Some("approved".into()),
        gateway_response: None,
        idempotency_key: Some("key_def".into()),
    };
    let json = serde_json::to_string(&split).unwrap();
    let back: PaymentSplitArg = serde_json::from_str(&json).unwrap();
    assert_eq!(back.method, "card");
    assert_eq!(back.amount_minor, 30000);
    assert_eq!(back.gateway_reference.as_deref(), Some("txn_def456"));
    assert_eq!(back.gateway_status.as_deref(), Some("approved"));
    assert!(back.gateway_response.is_none());
}

#[test]
fn payment_split_arg_minimal() {
    let split = PaymentSplitArg {
        method: "cash".into(),
        amount_minor: 50000,
        gateway_reference: None,
        gateway_status: None,
        gateway_response: None,
        idempotency_key: None,
    };
    assert_eq!(split.method, "cash");
    assert_eq!(split.amount_minor, 50000);
    assert!(split.gateway_reference.is_none());
}

#[test]
fn payment_equality() {
    let p1 = Payment {
        id: "p1".into(),
        sale_id: "s1".into(),
        method: "cash".into(),
        amount: Money {
            minor_units: 100,
            currency: "IDR".parse().unwrap(),
        },
        created_at: "2025-01-01T00:00:00.000Z".into(),
        gateway_reference: None,
        gateway_status: None,
        gateway_response: None,
        idempotency_key: None,
    };
    let p2 = p1.clone();
    assert_eq!(p1, p2);
}

#[test]
fn payment_split_arg_equality() {
    let s1 = PaymentSplitArg {
        method: "cash".into(),
        amount_minor: 100,
        gateway_reference: None,
        gateway_status: None,
        gateway_response: None,
        idempotency_key: None,
    };
    let s2 = PaymentSplitArg {
        method: "cash".into(),
        amount_minor: 100,
        gateway_reference: None,
        gateway_status: None,
        gateway_response: None,
        idempotency_key: None,
    };
    assert_eq!(s1, s2);
}

#[test]
fn payment_different_methods_not_equal() {
    let p1 = Payment {
        id: "p1".into(),
        sale_id: "s1".into(),
        method: "cash".into(),
        amount: Money {
            minor_units: 100,
            currency: "IDR".parse().unwrap(),
        },
        created_at: String::new(),
        gateway_reference: None,
        gateway_status: None,
        gateway_response: None,
        idempotency_key: None,
    };
    let p2 = Payment {
        id: "p1".into(),
        sale_id: "s1".into(),
        method: "card".into(),
        amount: Money {
            minor_units: 100,
            currency: "IDR".parse().unwrap(),
        },
        created_at: String::new(),
        gateway_reference: None,
        gateway_status: None,
        gateway_response: None,
        idempotency_key: None,
    };
    assert_ne!(p1, p2);
}

// ── Debug output ────────────────────────────────────────────

#[test]
fn payment_debug_output() {
    let payment = Payment {
        id: "pay-1".into(),
        sale_id: "sale-1".into(),
        method: "cash".into(),
        amount: Money {
            minor_units: 50000,
            currency: "IDR".parse().unwrap(),
        },
        created_at: "2025-07-07T12:00:00.000Z".into(),
        gateway_reference: None,
        gateway_status: None,
        gateway_response: None,
        idempotency_key: None,
    };
    let debug = format!("{:?}", payment);
    assert!(debug.contains("pay-1"));
    assert!(debug.contains("cash"));
}

#[test]
fn payment_split_arg_debug_output() {
    let split = PaymentSplitArg {
        method: "card".into(),
        amount_minor: 30000,
        gateway_reference: Some("txn_123".into()),
        gateway_status: Some("approved".into()),
        gateway_response: None,
        idempotency_key: None,
    };
    let debug = format!("{:?}", split);
    assert!(debug.contains("card"));
    assert!(debug.contains("txn_123"));
}

// ── Edge cases ──────────────────────────────────────────────

#[test]
fn payment_zero_amount() {
    let payment = Payment {
        id: "pay-zero".into(),
        sale_id: "sale-1".into(),
        method: "voucher".into(),
        amount: Money {
            minor_units: 0,
            currency: "IDR".parse().unwrap(),
        },
        created_at: String::new(),
        gateway_reference: None,
        gateway_status: None,
        gateway_response: None,
        idempotency_key: None,
    };
    assert_eq!(payment.amount.minor_units, 0);
}

#[test]
fn payment_empty_method() {
    let payment = Payment {
        id: "pay-empty".into(),
        sale_id: "sale-1".into(),
        method: String::new(),
        amount: Money {
            minor_units: 100,
            currency: "IDR".parse().unwrap(),
        },
        created_at: String::new(),
        gateway_reference: None,
        gateway_status: None,
        gateway_response: None,
        idempotency_key: None,
    };
    assert_eq!(payment.method, "");
}

#[test]
fn payment_declined_gateway() {
    let payment = Payment {
        id: "pay-declined".into(),
        sale_id: "sale-1".into(),
        method: "card".into(),
        amount: Money {
            minor_units: 50000,
            currency: "IDR".parse().unwrap(),
        },
        created_at: String::new(),
        gateway_reference: Some("txn_fail".into()),
        gateway_status: Some("declined".into()),
        gateway_response: Some(r#"{"error":"insufficient_funds"}"#.into()),
        idempotency_key: None,
    };
    assert_eq!(payment.gateway_status.as_deref(), Some("declined"));
    assert!(payment.gateway_response.is_some());
}

#[test]
fn payment_split_arg_all_gateway_fields() {
    let split = PaymentSplitArg {
        method: "card".into(),
        amount_minor: 75000,
        gateway_reference: Some("txn_full".into()),
        gateway_status: Some("approved".into()),
        gateway_response: Some(r#"{"id":"txn_full","amount":75000}"#.into()),
        idempotency_key: None,
    };
    assert_eq!(split.gateway_reference.as_deref(), Some("txn_full"));
    assert_eq!(split.gateway_status.as_deref(), Some("approved"));
    assert!(split.gateway_response.is_some());
}

#[test]
fn payment_amount_large() {
    let payment = Payment {
        id: "pay-large".into(),
        sale_id: "sale-1".into(),
        method: "card".into(),
        amount: Money {
            minor_units: i64::MAX,
            currency: "IDR".parse().unwrap(),
        },
        created_at: String::new(),
        gateway_reference: None,
        gateway_status: None,
        gateway_response: None,
        idempotency_key: None,
    };
    assert_eq!(payment.amount.minor_units, i64::MAX);
}

#[test]
fn payment_json_field_names() {
    let payment = Payment {
        id: "pay-fields".into(),
        sale_id: "sale-1".into(),
        method: "cash".into(),
        amount: Money {
            minor_units: 50000,
            currency: "IDR".parse().unwrap(),
        },
        created_at: String::new(),
        gateway_reference: Some("ref_1".into()),
        gateway_status: Some("approved".into()),
        gateway_response: None,
        idempotency_key: None,
    };
    let json = serde_json::to_value(&payment).unwrap();
    assert_eq!(json["method"], "cash");
    assert_eq!(json["sale_id"], "sale-1");
    assert_eq!(json["gateway_reference"], "ref_1");
    assert_eq!(json["gateway_status"], "approved");
    assert!(json.get("gateway_response").unwrap().is_null());
}

#[test]
fn payment_split_arg_json_field_names() {
    let split = PaymentSplitArg {
        method: "card".into(),
        amount_minor: 50000,
        gateway_reference: Some("txn_abc".into()),
        gateway_status: Some("approved".into()),
        gateway_response: None,
        idempotency_key: None,
    };
    let json = serde_json::to_value(&split).unwrap();
    assert_eq!(json["method"], "card");
    assert_eq!(json["amountMinor"], 50000);
    assert_eq!(json["gatewayReference"], "txn_abc");
}

#[test]
fn payment_split_arg_from_camel_case_json() {
    let json = r#"{"method":"cash","amountMinor":25000,"idempotencyKey":null}"#;
    let split: PaymentSplitArg = serde_json::from_str(json).unwrap();
    assert_eq!(split.method, "cash");
    assert_eq!(split.amount_minor, 25000);
    assert!(split.idempotency_key.is_none());
}

#[test]
fn payment_clone_preserves_all_fields() {
    let p1 = Payment {
        id: "p1".into(),
        sale_id: "s1".into(),
        method: "card".into(),
        amount: Money {
            minor_units: 25000,
            currency: "USD".parse().unwrap(),
        },
        created_at: "2025-01-01T00:00:00.000Z".into(),
        gateway_reference: Some("txn_abc".into()),
        gateway_status: Some("approved".into()),
        gateway_response: Some(r#"{"ok":true}"#.into()),
        idempotency_key: None,
    };
    let p2 = p1.clone();
    assert_eq!(p1, p2);
}

// ── Idempotency key tests ──────────────────────────────────

#[test]
fn payment_with_idempotency_key_serde() {
    let payment = Payment {
        id: "pay-ikey".into(),
        sale_id: "sale-1".into(),
        method: "card".into(),
        amount: Money {
            minor_units: 1000,
            currency: "USD".parse().unwrap(),
        },
        created_at: String::new(),
        gateway_reference: Some("txn_456".into()),
        gateway_status: Some("approved".into()),
        gateway_response: None,
        idempotency_key: Some("01926b3a-0000-7000-8000-000000000001".into()),
    };
    let json = serde_json::to_string(&payment).unwrap();
    let back: Payment = serde_json::from_str(&json).unwrap();
    assert_eq!(
        back.idempotency_key.as_deref(),
        Some("01926b3a-0000-7000-8000-000000000001")
    );
}

#[test]
fn payment_split_arg_with_idempotency_key() {
    let split = PaymentSplitArg {
        method: "card".into(),
        amount_minor: 1000,
        gateway_reference: None,
        gateway_status: None,
        gateway_response: None,
        idempotency_key: Some("01926b3a-0000-7000-8000-000000000002".into()),
    };
    assert_eq!(
        split.idempotency_key.as_deref(),
        Some("01926b3a-0000-7000-8000-000000000002")
    );
}
