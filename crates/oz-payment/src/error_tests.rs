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
fn network_display() {
    let err = PaymentError::Network("connection refused".into());
    assert_eq!(err.to_string(), "network error: connection refused");
}

#[test]
fn invalid_response_display() {
    let err = PaymentError::InvalidResponse("missing field 'auth_code'".into());
    assert_eq!(
        err.to_string(),
        "invalid response: missing field 'auth_code'"
    );
}

#[test]
fn invalid_card_display() {
    let err = PaymentError::InvalidCard("card expired".into());
    assert_eq!(err.to_string(), "invalid card: card expired");
}

#[test]
fn expired_display() {
    // PAY-8: expiry is its own variant, distinct from InvalidCard.
    let err = PaymentError::Expired("QRIS transaction expired".into());
    assert_eq!(err.to_string(), "payment expired: QRIS transaction expired");
}

#[test]
fn duplicate_display() {
    let err = PaymentError::Duplicate("idempotency key already used".into());
    assert_eq!(
        err.to_string(),
        "duplicate transaction: idempotency key already used"
    );
}

#[test]
fn debug_output() {
    let err = PaymentError::Declined("test".into());
    let debug = format!("{err:?}");
    assert!(debug.contains("Declined"));
}

#[test]
fn implements_std_error() {
    let err: Box<dyn std::error::Error> = Box::new(PaymentError::Network("test".into()));
    let _ = err.to_string();
}

#[test]
fn is_send_sync() {
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<PaymentError>();
}

#[test]
fn variants_are_distinct() {
    let a = format!("{:?}", PaymentError::Declined("x".into()));
    let b = format!("{:?}", PaymentError::Timeout(1));
    let c = format!("{:?}", PaymentError::Network("x".into()));
    let d = format!("{:?}", PaymentError::InvalidResponse("x".into()));
    let e = format!("{:?}", PaymentError::InvalidCard("x".into()));
    let f = format!("{:?}", PaymentError::Duplicate("x".into()));
    assert_ne!(a, b);
    assert_ne!(a, c);
    assert_ne!(a, d);
    assert_ne!(a, e);
    assert_ne!(a, f);
    assert_ne!(b, c);
    assert_ne!(b, d);
    assert_ne!(b, e);
    assert_ne!(b, f);
    assert_ne!(c, d);
    assert_ne!(c, e);
    assert_ne!(c, f);
    assert_ne!(d, e);
    assert_ne!(d, f);
    assert_ne!(e, f);
}

#[test]
fn classify_transient_errors() {
    assert_eq!(
        PaymentError::Network("conn dropped".into()).classify(),
        ErrorClass::Transient
    );
    assert_eq!(
        PaymentError::Timeout(3000).classify(),
        ErrorClass::Transient
    );
}

#[test]
fn classify_deferred_errors() {
    assert_eq!(
        PaymentError::Expired("QR expired".into()).classify(),
        ErrorClass::Deferred
    );
}

#[test]
fn classify_terminal_errors() {
    assert_eq!(
        PaymentError::Declined("no funds".into()).classify(),
        ErrorClass::Terminal
    );
    assert_eq!(
        PaymentError::InvalidResponse("bad json".into()).classify(),
        ErrorClass::Terminal
    );
    assert_eq!(
        PaymentError::InvalidCard("bad cvc".into()).classify(),
        ErrorClass::Terminal
    );
    assert_eq!(
        PaymentError::Duplicate("key exists".into()).classify(),
        ErrorClass::Terminal
    );
    assert_eq!(
        PaymentError::Unsupported("not ready".into()).classify(),
        ErrorClass::Terminal
    );
}

#[test]
fn error_class_serialization() {
    let json = serde_json::to_string(&ErrorClass::Transient).unwrap();
    assert_eq!(json, "\"Transient\"");
    let decoded: ErrorClass = serde_json::from_str(&json).unwrap();
    assert_eq!(decoded, ErrorClass::Transient);
}
