use super::*;
use crate::money::Currency;

fn money(minor: i64) -> Money {
    Money {
        minor_units: minor,
        currency: "IDR".parse::<Currency>().unwrap(),
    }
}

fn payable(status: PayableStatus, amount: i64, paid: i64, due: Option<&str>) -> Payable {
    Payable {
        id: "p1".into(),
        tenant_id: "default".into(),
        supplier_id: "s1".into(),
        po_id: None,
        source: "manual".into(),
        reference: String::new(),
        amount: money(amount),
        paid: money(paid),
        due_date: due.map(str::to_string),
        status,
        note: String::new(),
        created_at: String::new(),
        updated_at: String::new(),
        settled_at: None,
        written_off_at: None,
    }
}

#[test]
fn status_round_trips_through_db_strings() {
    for s in [
        PayableStatus::Open,
        PayableStatus::Partial,
        PayableStatus::Paid,
        PayableStatus::WrittenOff,
    ] {
        assert_eq!(PayableStatus::from_db(s.as_str()), s);
    }
    // An unknown stored value fails toward Open, never toward settled.
    assert_eq!(PayableStatus::from_db("garbage"), PayableStatus::Open);
}

#[test]
fn from_amounts_maps_paid_to_status() {
    assert_eq!(PayableStatus::from_amounts(0, 100), PayableStatus::Open);
    assert_eq!(PayableStatus::from_amounts(50, 100), PayableStatus::Partial);
    assert_eq!(PayableStatus::from_amounts(100, 100), PayableStatus::Paid);
    // A defensive over-clamp still reads as fully paid.
    assert_eq!(PayableStatus::from_amounts(120, 100), PayableStatus::Paid);
}

#[test]
fn terminal_states_are_terminal_and_have_no_exits() {
    assert!(PayableStatus::Paid.is_terminal());
    assert!(PayableStatus::WrittenOff.is_terminal());
    assert!(!PayableStatus::Open.is_terminal());
    assert!(!PayableStatus::Partial.is_terminal());
    assert!(!PayableStatus::can_transition(
        PayableStatus::Paid,
        PayableStatus::Open
    ));
    assert!(!PayableStatus::can_transition(
        PayableStatus::WrittenOff,
        PayableStatus::Partial
    ));
}

#[test]
fn legal_payment_and_writeoff_transitions() {
    assert!(PayableStatus::can_transition(
        PayableStatus::Open,
        PayableStatus::Partial
    ));
    assert!(PayableStatus::can_transition(
        PayableStatus::Open,
        PayableStatus::Paid
    ));
    assert!(PayableStatus::can_transition(
        PayableStatus::Partial,
        PayableStatus::Paid
    ));
    assert!(PayableStatus::can_transition(
        PayableStatus::Open,
        PayableStatus::WrittenOff
    ));
    assert!(PayableStatus::can_transition(
        PayableStatus::Partial,
        PayableStatus::WrittenOff
    ));
    // Never backwards, never out of a terminal state.
    assert!(!PayableStatus::can_transition(
        PayableStatus::Partial,
        PayableStatus::Open
    ));
    assert!(!PayableStatus::can_transition(
        PayableStatus::Paid,
        PayableStatus::WrittenOff
    ));
}

#[test]
fn balance_and_is_owed() {
    let p = payable(PayableStatus::Partial, 1000, 400, None);
    assert_eq!(p.balance_minor(), 600);
    assert!(p.is_owed());
    let paid = payable(PayableStatus::Paid, 1000, 1000, None);
    assert_eq!(paid.balance_minor(), 0);
    assert!(!paid.is_owed());
    let wo = payable(PayableStatus::WrittenOff, 1000, 200, None);
    assert!(!wo.is_owed());
}

#[test]
fn overdue_requires_due_date_strictly_in_the_past_and_still_owed() {
    assert!(payable(PayableStatus::Open, 100, 0, Some("2026-01-01")).is_overdue("2026-06-01"));
    // Due today is not yet overdue (strictly-before semantics).
    assert!(!payable(PayableStatus::Open, 100, 0, Some("2026-06-01")).is_overdue("2026-06-01"));
    // Future due date is not overdue.
    assert!(!payable(PayableStatus::Open, 100, 0, Some("2027-01-01")).is_overdue("2026-06-01"));
    // No due date is never overdue.
    assert!(!payable(PayableStatus::Open, 100, 0, None).is_overdue("2026-06-01"));
    // Settled is not overdue even with a past due date.
    assert!(!payable(PayableStatus::Paid, 100, 100, Some("2026-01-01")).is_overdue("2026-06-01"));
}
