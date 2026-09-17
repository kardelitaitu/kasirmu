use super::*;

// ── Shift construction ───────────────────────────────────────

#[test]
fn new_shift_has_generated_id() {
    let s = Shift::new("user-1", Some("term-1"), 100);
    assert!(!s.id.is_empty());
    assert_eq!(s.user_id, "user-1");
    assert_eq!(s.terminal_id.as_deref(), Some("term-1"));
    assert_eq!(s.opening_balance_minor, 100);
    assert!(s.is_open());
    assert!(!s.is_closed());
    assert!(s.closed_at.is_none());
    assert!(s.closing_balance_minor.is_none());
    assert_eq!(s.total_sales_minor, 0);
    assert_eq!(s.total_cash_minor, 0);
    assert_eq!(s.total_card_minor, 0);
    assert_eq!(s.total_other_minor, 0);
    assert_eq!(s.total_voids_minor, 0);
    assert_eq!(s.total_refunds_minor, 0);
    assert!(s.opened_at.contains('T'));
    assert!(s.opened_at.ends_with('Z'));
}

#[test]
fn new_shift_without_terminal() {
    let s = Shift::new("user-1", None::<String>, 0);
    assert!(s.terminal_id.is_none());
}

#[test]
fn new_shift_default_opening_balance() {
    let s = Shift::new("user-2", None::<String>, 0);
    assert_eq!(s.opening_balance_minor, 0);
}

#[test]
#[should_panic(expected = "user_id must not be empty")]
fn new_shift_panics_on_empty_user() {
    Shift::new("", None::<String>, 0);
}

#[test]
#[should_panic(expected = "opening_balance_minor must be ≥ 0")]
fn new_shift_panics_on_negative_balance() {
    Shift::new("user-1", None::<String>, -1);
}

#[test]
fn is_open_and_is_closed() {
    let s = Shift::new("user-1", None::<String>, 0);
    assert!(s.is_open());
    assert!(!s.is_closed());
}

// ── UUID format ──────────────────────────────────────────────

#[test]
fn shift_id_is_uuid_v4() {
    let s = Shift::new("user-1", None::<String>, 0);
    assert_eq!(s.id.len(), 36);
    assert_eq!(s.id.chars().filter(|&c| c == '-').count(), 4);
}

// ── Opening balance ──────────────────────────────────────────

#[test]
fn shift_large_opening_balance() {
    let s = Shift::new("user-1", None::<String>, 10_000_000);
    assert_eq!(s.opening_balance_minor, 10_000_000);
}

// ── Close cycle ──────────────────────────────────────────────

#[test]
fn shift_can_be_marked_closed_manually() {
    // The domain type doesn't have a close() method, but the
    // status field and closing fields can be set directly.
    let mut s = Shift::new("user-1", Some("term-1"), 500);
    s.status = "closed".into();
    s.closed_at = Some("2026-01-15T18:00:00.000Z".into());
    s.closing_balance_minor = Some(1500);
    s.expected_cash_minor = Some(1200);
    s.cash_difference_minor = Some(300);

    assert!(s.is_closed());
    assert!(!s.is_open());
    assert_eq!(s.closed_at.as_deref(), Some("2026-01-15T18:00:00.000Z"));
    assert_eq!(s.closing_balance_minor, Some(1500));
    assert_eq!(s.expected_cash_minor, Some(1200));
    assert_eq!(s.cash_difference_minor, Some(300));
}

#[test]
fn shift_close_exact_cash() {
    let mut s = Shift::new("user-1", None::<String>, 500);
    s.status = "closed".into();
    s.closed_at = Some("2026-01-15T18:00:00.000Z".into());
    s.closing_balance_minor = Some(1000);
    s.expected_cash_minor = Some(1000);
    s.cash_difference_minor = Some(0);

    assert_eq!(s.cash_difference_minor, Some(0));
}

#[test]
fn shift_close_negative_difference_short() {
    let mut s = Shift::new("user-1", None::<String>, 500);
    s.status = "closed".into();
    s.closing_balance_minor = Some(800);
    s.expected_cash_minor = Some(1000);
    s.cash_difference_minor = Some(-200);

    assert_eq!(s.cash_difference_minor, Some(-200));
}

// ── Sales breakdown ──────────────────────────────────────────

#[test]
fn shift_with_sales_data() {
    let mut s = Shift::new("user-1", None::<String>, 500);
    s.total_sales_minor = 1_500_000;
    s.total_cash_minor = 800_000;
    s.total_card_minor = 600_000;
    s.total_other_minor = 100_000;
    s.total_voids_minor = 50_000;
    s.total_refunds_minor = 20_000;
    s.total_payouts_minor = 200_000;

    assert_eq!(s.total_sales_minor, 1_500_000);
    assert_eq!(s.total_cash_minor, 800_000);
    assert_eq!(s.total_card_minor, 600_000);
    assert_eq!(s.total_other_minor, 100_000);
    assert_eq!(s.total_voids_minor, 50_000);
    assert_eq!(s.total_refunds_minor, 20_000);
    assert_eq!(s.total_payouts_minor, 200_000);

    // Cash + card + other should equal total sales
    let payment_total = s.total_cash_minor + s.total_card_minor + s.total_other_minor;
    assert_eq!(payment_total, 1_500_000);
}

#[test]
fn shift_sales_breakdown_all_methods() {
    let mut s = Shift::new("user-1", None::<String>, 0);

    // Only cash sales
    s.total_sales_minor = 500_000;
    s.total_cash_minor = 500_000;
    assert_eq!(s.total_card_minor, 0);
    assert_eq!(s.total_other_minor, 0);

    // Only card sales
    let mut s2 = Shift::new("user-1", None::<String>, 0);
    s2.total_sales_minor = 750_000;
    s2.total_card_minor = 750_000;
    assert_eq!(s2.total_cash_minor, 0);

    // Only other payment method
    let mut s3 = Shift::new("user-1", None::<String>, 0);
    s3.total_sales_minor = 300_000;
    s3.total_other_minor = 300_000;
    assert_eq!(s3.total_cash_minor, 0);
    assert_eq!(s3.total_card_minor, 0);
}

// ── Notes ────────────────────────────────────────────────────

#[test]
fn shift_with_notes() {
    let mut s = Shift::new("user-1", None::<String>, 0);
    assert!(s.notes.is_empty());
    s.notes = "Manager approved overtime".into();
    assert_eq!(s.notes, "Manager approved overtime");
}

#[test]
fn shift_long_notes() {
    let mut s = Shift::new("user-1", None::<String>, 0);
    s.notes = "A".repeat(500);
    assert_eq!(s.notes.len(), 500);
}

// ── Serde ────────────────────────────────────────────────────

#[test]
fn serde_roundtrip() {
    let s = Shift::new("user-1", Some("term-1"), 500);
    let json = serde_json::to_string(&s).unwrap();
    let back: Shift = serde_json::from_str(&json).unwrap();
    assert_eq!(back.id, s.id);
    assert_eq!(back.user_id, s.user_id);
    assert_eq!(back.opening_balance_minor, 500);
    assert_eq!(back.total_payouts_minor, 0);
    assert_eq!(back.status, "open");
}

#[test]
fn serde_roundtrip_closed_shift() {
    let mut s = Shift::new("user-1", Some("term-1"), 500);
    s.status = "closed".into();
    s.closed_at = Some("2026-01-15T18:00:00.000Z".into());
    s.closing_balance_minor = Some(1500);
    s.expected_cash_minor = Some(1200);
    s.cash_difference_minor = Some(300);
    s.total_sales_minor = 100_000;
    s.total_cash_minor = 80_000;
    s.total_card_minor = 20_000;
    s.notes = "Good shift".into();

    let json = serde_json::to_string(&s).unwrap();
    let back: Shift = serde_json::from_str(&json).unwrap();
    assert_eq!(back.status, "closed");
    assert_eq!(back.closed_at, Some("2026-01-15T18:00:00.000Z".into()));
    assert_eq!(back.closing_balance_minor, Some(1500));
    assert_eq!(back.cash_difference_minor, Some(300));
    assert_eq!(back.notes, "Good shift");
}

#[test]
fn serde_json_field_names() {
    let s = Shift::new("user-1", None::<String>, 500);
    let json = serde_json::to_value(&s).unwrap();
    assert_eq!(json["user_id"], "user-1");
    assert_eq!(json["opening_balance_minor"], 500);
    assert_eq!(json["status"], "open");
    assert!(json.get("closed_at").unwrap().is_null());
    assert!(json.get("closing_balance_minor").unwrap().is_null());
}

// ── Clone + equality ─────────────────────────────────────────

#[test]
fn shift_clone_eq() {
    let a = Shift::new("user-1", Some("term-1"), 500);
    let b = a.clone();
    assert_eq!(a, b);
}

#[test]
fn shift_neq_when_field_differs() {
    let a = Shift::new("user-1", Some("term-1"), 500);
    let b = Shift::new("user-2", Some("term-2"), 1000);
    assert_ne!(a, b);
}

#[test]
fn shift_debug_output() {
    let s = Shift::new("user-1", None::<String>, 500);
    let debug = format!("{:?}", s);
    assert!(debug.contains("user-1"));
    assert!(debug.contains("500"));
}
