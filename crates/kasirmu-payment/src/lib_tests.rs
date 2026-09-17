use super::*;

#[test]
fn declined_display() {
    let err = PaymentError::Declined("insufficient funds".into());
    assert_eq!(
        err.to_string(),
        "authorization declined: insufficient funds"
    );
}

#[test]
fn timeout_display() {
    let err = PaymentError::Timeout(5000);
    assert_eq!(err.to_string(), "processor timed out after 5000 ms");
}

#[test]
fn network_error_display() {
    let err = PaymentError::Network("connection refused".into());
    assert_eq!(err.to_string(), "network error: connection refused");
}

#[test]
fn invalid_response_display() {
    let err = PaymentError::InvalidResponse("missing field".into());
    assert_eq!(err.to_string(), "invalid response: missing field");
}

#[test]
fn error_is_debug() {
    let err = PaymentError::Declined("test".into());
    assert!(!format!("{err:?}").is_empty());
}

#[test]
fn payment_method_label_cash() {
    assert_eq!(PaymentMethod::Cash.label(), "Cash");
}

#[test]
fn payment_method_label_card() {
    assert_eq!(PaymentMethod::Card.label(), "Card");
}

#[test]
fn payment_method_label_qr() {
    assert_eq!(PaymentMethod::Qr.label(), "QR");
}

#[test]
fn payment_method_label_other() {
    assert_eq!(
        PaymentMethod::Other("Gift Card".into()).label(),
        "Gift Card"
    );
}

// ── PaymentMethod Debug ─────────────────────────────────────

#[test]
fn payment_method_debug_cash() {
    let debug = format!("{:?}", PaymentMethod::Cash);
    assert!(debug.contains("Cash"));
}

#[test]
fn payment_method_debug_card() {
    let debug = format!("{:?}", PaymentMethod::Card);
    assert!(debug.contains("Card"));
}

#[test]
fn payment_method_debug_other() {
    let debug = format!("{:?}", PaymentMethod::Other("Voucher".into()));
    assert!(debug.contains("Voucher"));
}

// ── PaymentMethod equality ──────────────────────────────────

#[test]
fn payment_method_equality_same_variant() {
    assert_eq!(PaymentMethod::Cash, PaymentMethod::Cash);
    assert_eq!(PaymentMethod::Card, PaymentMethod::Card);
    assert_eq!(PaymentMethod::Qr, PaymentMethod::Qr);
}

#[test]
fn payment_method_equality_different_variant() {
    assert_ne!(PaymentMethod::Cash, PaymentMethod::Card);
    assert_ne!(PaymentMethod::Cash, PaymentMethod::Qr);
    assert_ne!(PaymentMethod::Card, PaymentMethod::Qr);
}

#[test]
fn payment_method_equality_other_same_value() {
    assert_eq!(
        PaymentMethod::Other("Voucher".into()),
        PaymentMethod::Other("Voucher".into())
    );
}

#[test]
fn payment_method_equality_other_different_value() {
    assert_ne!(
        PaymentMethod::Other("Voucher".into()),
        PaymentMethod::Other("Gift Card".into())
    );
}

#[test]
fn payment_method_clone() {
    let m = PaymentMethod::Other("test".into());
    assert_eq!(m.clone(), m);
}

// ── PaymentMethod serde ─────────────────────────────────────

#[test]
fn payment_method_serde_roundtrip_all() {
    let methods = [
        PaymentMethod::Cash,
        PaymentMethod::Card,
        PaymentMethod::Qr,
        PaymentMethod::Other("Voucher".into()),
    ];
    for m in &methods {
        let json = serde_json::to_string(m).unwrap();
        let back: PaymentMethod = serde_json::from_str(&json).unwrap();
        assert_eq!(*m, back, "roundtrip failed for {m:?}");
    }
}

#[test]
fn payment_method_serde_json_cash() {
    let json = serde_json::to_value(PaymentMethod::Cash).unwrap();
    assert_eq!(json, "Cash");
}

#[test]
fn payment_method_serde_json_card() {
    let json = serde_json::to_value(PaymentMethod::Card).unwrap();
    assert_eq!(json, "Card");
}

#[test]
fn payment_method_serde_json_other() {
    let json = serde_json::to_value(PaymentMethod::Other("Voucher".into())).unwrap();
    assert_eq!(json["Other"], "Voucher");
}

// ── PaymentError std::error::Error trait ────────────────────

#[test]
fn payment_error_implements_std_error() {
    let err = PaymentError::Declined("test".into());
    let _: &dyn std::error::Error = &err;
}

#[test]
fn payment_error_source_returns_none() {
    let err = PaymentError::Network("test".into());
    assert!(std::error::Error::source(&err).is_none());
}

#[test]
fn payment_error_is_send_sync() {
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<PaymentError>();
}

// ── PaymentRequest debug ────────────────────────────────────

#[test]
fn payment_request_debug() {
    let req = PaymentRequest {
        amount: foundation::Money {
            minor_units: 50000,
            currency: "IDR".parse().unwrap(),
        },
        reference: Some("inv-001".into()),
        description: Some("Coffee order".into()),
        idempotency_key: None,
    };
    let debug = format!("{:?}", req);
    assert!(debug.contains("50000"));
    assert!(debug.contains("inv-001"));
}

#[test]
fn payment_request_minimal() {
    let req = PaymentRequest {
        amount: foundation::Money {
            minor_units: 0,
            currency: "USD".parse().unwrap(),
        },
        reference: None,
        description: None,
        idempotency_key: None,
    };
    assert_eq!(req.amount.minor_units, 0);
    assert!(req.reference.is_none());
    assert!(req.description.is_none());
}

// ── PaymentResult debug ─────────────────────────────────────

#[test]
fn payment_result_debug_success() {
    let r = PaymentResult {
        success: true,
        transaction_id: Some("txn_123".into()),
        auth_code: Some("AUTH01".into()),
        amount_charged: foundation::Money {
            minor_units: 10000,
            currency: "USD".parse().unwrap(),
        },
        message: Some("approved".into()),
    };
    let debug = format!("{:?}", r);
    assert!(debug.contains("txn_123"));
    assert!(debug.contains("approved"));
}

#[test]
fn payment_result_debug_failure() {
    let r = PaymentResult {
        success: false,
        transaction_id: None,
        auth_code: None,
        amount_charged: foundation::Money {
            minor_units: 0,
            currency: "USD".parse().unwrap(),
        },
        message: Some("declined".into()),
    };
    let debug = format!("{:?}", r);
    assert!(debug.contains("declined"));
    assert!(!debug.contains("txn_"));
}

#[test]
fn payment_result_success_vs_failure() {
    let ok = PaymentResult {
        success: true,
        transaction_id: Some("txn_ok".into()),
        auth_code: Some("AUTH01".into()),
        amount_charged: foundation::Money {
            minor_units: 2500,
            currency: "USD".parse().unwrap(),
        },
        message: Some("approved".into()),
    };
    assert!(ok.success);
    assert!(ok.transaction_id.is_some());

    let fail = PaymentResult {
        success: false,
        transaction_id: None,
        auth_code: None,
        amount_charged: foundation::Money {
            minor_units: 2500,
            currency: "USD".parse().unwrap(),
        },
        message: Some("declined".into()),
    };
    assert!(!fail.success);
    assert!(fail.transaction_id.is_none());
}

// ── PaymentReceipt debug ────────────────────────────────────

#[test]
fn payment_receipt_debug() {
    let receipt = PaymentReceipt {
        transaction_id: "txn_456".into(),
        method: PaymentMethod::Card,
        amount: foundation::Money {
            minor_units: 25000,
            currency: "USD".parse().unwrap(),
        },
        timestamp: "2026-07-07T12:00:00Z".into(),
        raw_data: Some("9F26...".into()),
    };
    let debug = format!("{:?}", receipt);
    assert!(debug.contains("txn_456"));
    assert!(debug.contains("Card"));
}

#[test]
fn payment_receipt_without_raw_data() {
    let receipt = PaymentReceipt {
        transaction_id: "txn_789".into(),
        method: PaymentMethod::Qr,
        amount: foundation::Money {
            minor_units: 15000,
            currency: "IDR".parse().unwrap(),
        },
        timestamp: "2026-07-07T12:00:00Z".into(),
        raw_data: None,
    };
    assert_eq!(receipt.method, PaymentMethod::Qr);
    assert!(receipt.raw_data.is_none());
}
