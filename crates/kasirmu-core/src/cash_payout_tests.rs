use super::*;

#[test]
fn new_cash_payout_has_generated_id() {
    let p = CashPayout::new("shift-1", 5000, "bank drop");
    assert!(!p.id.is_empty());
    assert_eq!(p.shift_id, "shift-1");
    assert_eq!(p.amount_minor, 5000);
    assert_eq!(p.reason, "bank drop");
    assert!(p.created_at.contains('T'));
}

#[test]
fn new_cash_payout_zero_amount_allowed() {
    let p = CashPayout::new("shift-1", 0, "no-op");
    assert_eq!(p.amount_minor, 0);
}

#[test]
fn new_cash_payout_negative_amount_allowed_by_type() {
    // The domain type does not validate amount — storage layer enforces > 0.
    let p = CashPayout::new("shift-1", -500, "adjustment");
    assert_eq!(p.amount_minor, -500);
}

#[test]
fn new_cash_payout_empty_reason() {
    let p = CashPayout::new("shift-1", 1000, "");
    assert_eq!(p.reason, "");
}

#[test]
fn new_cash_payout_empty_shift_id() {
    let p = CashPayout::new("", 5000, "drop");
    assert_eq!(p.shift_id, "");
}

#[test]
fn new_cash_payout_large_amount() {
    let p = CashPayout::new("shift-1", i64::MAX, "max drop");
    assert_eq!(p.amount_minor, i64::MAX);
}

#[test]
fn new_cash_payout_uses_uuid_format() {
    let p = CashPayout::new("shift-1", 100, "test");
    assert_eq!(p.id.len(), 36);
    assert_eq!(p.id.chars().filter(|&c| c == '-').count(), 4);
}

#[test]
fn serde_roundtrip() {
    let p = CashPayout::new("shift-1", 10000, "manager pickup");
    let json = serde_json::to_string(&p).unwrap();
    let back: CashPayout = serde_json::from_str(&json).unwrap();
    assert_eq!(back.id, p.id);
    assert_eq!(back.amount_minor, 10000);
    assert_eq!(back.reason, "manager pickup");
}

#[test]
fn serde_roundtrip_zero_signed_amount() {
    // Verify -0 serialization
    let p = CashPayout::new("shift-1", 0, "zero");
    let json = serde_json::to_string(&p).unwrap();
    let back: CashPayout = serde_json::from_str(&json).unwrap();
    assert_eq!(back.amount_minor, 0);
}

#[test]
fn serde_roundtrip_negative_amount() {
    let p = CashPayout::new("shift-1", -2500, "adjustment");
    let json = serde_json::to_string(&p).unwrap();
    let back: CashPayout = serde_json::from_str(&json).unwrap();
    assert_eq!(back.amount_minor, -2500);
}

#[test]
fn cash_payout_debug_output() {
    let p = CashPayout::new("shift-1", 5000, "drop");
    let debug = format!("{:?}", p);
    assert!(debug.contains("shift-1"));
    assert!(debug.contains("5000"));
    assert!(debug.contains("drop"));
}

#[test]
fn cash_payout_created_at_is_iso8601() {
    let p = CashPayout::new("shift-1", 100, "test");
    assert!(p.created_at.contains('T'), "expected ISO-8601 format");
    assert!(p.created_at.ends_with('Z'), "expected UTC timezone");
}
