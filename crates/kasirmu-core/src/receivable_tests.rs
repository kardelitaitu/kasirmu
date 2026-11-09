use super::*;
use crate::money::Currency;

fn money(minor: i64) -> Money {
    Money {
        minor_units: minor,
        currency: "IDR".parse::<Currency>().unwrap(),
    }
}

fn receivable(status: ReceivableStatus, amount: i64, paid: i64, due: Option<&str>) -> Receivable {
    Receivable {
        id: "r1".into(),
        tenant_id: "default".into(),
        customer_id: "c1".into(),
        sale_id: None,
        source: "pos".into(),
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
        ReceivableStatus::Open,
        ReceivableStatus::Partial,
        ReceivableStatus::Paid,
        ReceivableStatus::WrittenOff,
    ] {
        assert_eq!(ReceivableStatus::from_db(s.as_str()), s);
    }
    // An unknown stored value fails toward Open, never toward settled.
    assert_eq!(ReceivableStatus::from_db("garbage"), ReceivableStatus::Open);
}

#[test]
fn from_amounts_maps_paid_to_status() {
    assert_eq!(
        ReceivableStatus::from_amounts(0, 100),
        ReceivableStatus::Open
    );
    assert_eq!(
        ReceivableStatus::from_amounts(50, 100),
        ReceivableStatus::Partial
    );
    assert_eq!(
        ReceivableStatus::from_amounts(100, 100),
        ReceivableStatus::Paid
    );
    // A defensive over-clamp still reads as fully paid.
    assert_eq!(
        ReceivableStatus::from_amounts(120, 100),
        ReceivableStatus::Paid
    );
}

#[test]
fn terminal_states_are_terminal_and_have_no_exits() {
    assert!(ReceivableStatus::Paid.is_terminal());
    assert!(ReceivableStatus::WrittenOff.is_terminal());
    assert!(!ReceivableStatus::Open.is_terminal());
    assert!(!ReceivableStatus::Partial.is_terminal());
    assert!(!ReceivableStatus::can_transition(
        ReceivableStatus::Paid,
        ReceivableStatus::Open
    ));
    assert!(!ReceivableStatus::can_transition(
        ReceivableStatus::WrittenOff,
        ReceivableStatus::Partial
    ));
}

#[test]
fn legal_payment_and_writeoff_transitions() {
    assert!(ReceivableStatus::can_transition(
        ReceivableStatus::Open,
        ReceivableStatus::Partial
    ));
    assert!(ReceivableStatus::can_transition(
        ReceivableStatus::Open,
        ReceivableStatus::Paid
    ));
    assert!(ReceivableStatus::can_transition(
        ReceivableStatus::Partial,
        ReceivableStatus::Paid
    ));
    assert!(ReceivableStatus::can_transition(
        ReceivableStatus::Open,
        ReceivableStatus::WrittenOff
    ));
    assert!(ReceivableStatus::can_transition(
        ReceivableStatus::Partial,
        ReceivableStatus::WrittenOff
    ));
    // Never backwards, never out of a terminal state.
    assert!(!ReceivableStatus::can_transition(
        ReceivableStatus::Partial,
        ReceivableStatus::Open
    ));
    assert!(!ReceivableStatus::can_transition(
        ReceivableStatus::Paid,
        ReceivableStatus::WrittenOff
    ));
}

#[test]
fn balance_and_is_owed() {
    let r = receivable(ReceivableStatus::Partial, 1000, 400, None);
    assert_eq!(r.balance_minor(), 600);
    assert!(r.is_owed());
    let paid = receivable(ReceivableStatus::Paid, 1000, 1000, None);
    assert_eq!(paid.balance_minor(), 0);
    assert!(!paid.is_owed());
    let wo = receivable(ReceivableStatus::WrittenOff, 1000, 200, None);
    assert!(!wo.is_owed());
}

#[test]
fn overdue_requires_due_date_strictly_in_the_past_and_still_owed() {
    assert!(
        receivable(ReceivableStatus::Open, 100, 0, Some("2026-01-01")).is_overdue("2026-06-01")
    );
    // Due today is not yet overdue (strictly-before semantics).
    assert!(
        !receivable(ReceivableStatus::Open, 100, 0, Some("2026-06-01")).is_overdue("2026-06-01")
    );
    // Future due date is not overdue.
    assert!(
        !receivable(ReceivableStatus::Open, 100, 0, Some("2027-01-01")).is_overdue("2026-06-01")
    );
    // No due date is never overdue.
    assert!(!receivable(ReceivableStatus::Open, 100, 0, None).is_overdue("2026-06-01"));
    // Settled is not overdue even with a past due date.
    assert!(
        !receivable(ReceivableStatus::Paid, 100, 100, Some("2026-01-01")).is_overdue("2026-06-01")
    );
}
