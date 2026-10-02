use super::*;
use foundation::Currency;

fn usd() -> Currency {
    "USD".parse().unwrap()
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

#[test]
fn payment_request_has_required_fields() {
    let req = PaymentRequest {
        amount: Money::from_major(10, usd()).unwrap(),
        reference: None,
        description: None,
        idempotency_key: None,
    };
    assert_eq!(req.amount.minor_units, 1000);
}

#[test]
fn payment_result_success_vs_failure() {
    let ok = PaymentResult {
        success: true,
        phase: PaymentPhase::Confirmed,
        transaction_id: Some("txn_123".into()),
        auth_code: Some("AUTH01".into()),
        amount_charged: Money::from_major(10, usd()).unwrap(),
        message: Some("approved".into()),
    };
    assert!(ok.success);
    assert_eq!(ok.phase, PaymentPhase::Confirmed);

    let fail = PaymentResult {
        success: false,
        phase: PaymentPhase::Confirmed,
        transaction_id: None,
        auth_code: None,
        amount_charged: Money::from_major(10, usd()).unwrap(),
        message: Some("declined: insufficient funds".into()),
    };
    assert!(!fail.success);
}

#[test]
fn payment_receipt_holds_processor_data() {
    let receipt = PaymentReceipt {
        transaction_id: "txn_456".into(),
        method: PaymentMethod::Card,
        amount: Money::from_major(25, usd()).unwrap(),
        timestamp: "2026-06-30T12:00:00Z".into(),
        raw_data: Some("9F26...".into()),
    };
    assert_eq!(receipt.transaction_id, "txn_456");
    assert_eq!(receipt.method, PaymentMethod::Card);
}

#[test]
fn payment_method_serde_roundtrip() {
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
fn payment_result_debug() {
    let r = PaymentResult {
        success: true,
        phase: PaymentPhase::Confirmed,
        transaction_id: None,
        auth_code: None,
        amount_charged: Money::zero(usd()),
        message: None,
    };
    assert!(!format!("{r:?}").is_empty());
}

#[test]
fn payment_phase_and_tender_state_serde_roundtrip() {
    let phases = [PaymentPhase::Issued, PaymentPhase::Confirmed];
    for p in &phases {
        let json = serde_json::to_string(p).unwrap();
        let back: PaymentPhase = serde_json::from_str(&json).unwrap();
        assert_eq!(*p, back);
    }

    let states = [
        TenderState::Pending,
        TenderState::Authorized,
        TenderState::Confirmed,
        TenderState::Settled,
        TenderState::Failed,
        TenderState::Voided,
        TenderState::Refunded,
        TenderState::Disputed,
        TenderState::Unconfirmed,
    ];
    for s in &states {
        let json = serde_json::to_string(s).unwrap();
        let back: TenderState = serde_json::from_str(&json).unwrap();
        assert_eq!(*s, back);
    }
}

#[test]
fn payment_result_constructors() {
    let issued = PaymentResult::issued(
        Some("qr_order_123".into()),
        Money::from_major(50, usd()).unwrap(),
        Some("SCAN_QR|123".into()),
    );
    assert!(issued.success);
    assert_eq!(issued.phase, PaymentPhase::Issued);
    assert_eq!(issued.transaction_id.as_deref(), Some("qr_order_123"));

    let confirmed = PaymentResult::confirmed(
        true,
        Some("tx_999".into()),
        Some("AUTH_OK".into()),
        Money::from_major(50, usd()).unwrap(),
        Some("settled".into()),
    );
    assert!(confirmed.success);
    assert_eq!(confirmed.phase, PaymentPhase::Confirmed);
}
