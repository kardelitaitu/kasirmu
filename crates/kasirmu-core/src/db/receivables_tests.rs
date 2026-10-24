use super::*;
use crate::migrations;
use crate::money::Currency;
use crate::receivable::{NewReceivable, ReceivableStatus};
use rusqlite::Connection;

fn fresh() -> Connection {
    migrations::fresh_db()
}

fn store(conn: &Connection) -> Store<'_> {
    Store::new(conn)
}

fn money(code: &str, minor: i64) -> Money {
    Money {
        minor_units: minor,
        currency: code.parse::<Currency>().unwrap(),
    }
}

fn seed_customer(conn: &Connection, id: &str) {
    conn.execute(
        "INSERT INTO customers (id, name, created_at, updated_at)
         VALUES (?1, ?1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
        params![id],
    )
    .unwrap();
}

fn nr(customer: &str, amount: i64, due: Option<&str>) -> NewReceivable {
    NewReceivable {
        tenant_id: "default".into(),
        customer_id: customer.into(),
        sale_id: None,
        source: "pos".into(),
        reference: "INV-1".into(),
        amount: money("IDR", amount),
        due_date: due.map(str::to_string),
        note: String::new(),
    }
}

#[test]
fn create_receivable_starts_open_and_zero_paid() {
    let conn = fresh();
    seed_customer(&conn, "cust-1");
    let s = store(&conn);
    let r = s
        .create_receivable(&nr("cust-1", 100_000, Some("2026-12-31")))
        .unwrap();
    assert_eq!(r.status, ReceivableStatus::Open);
    assert_eq!(r.amount.minor_units, 100_000);
    assert_eq!(r.paid.minor_units, 0);
    assert_eq!(r.balance_minor(), 100_000);
    assert!(r.settled_at.is_none());
    assert_eq!(r.customer_id, "cust-1");
}

#[test]
fn create_rejects_nonpositive_amount_and_blank_customer() {
    let conn = fresh();
    seed_customer(&conn, "cust-1");
    let s = store(&conn);
    assert!(s.create_receivable(&nr("cust-1", 0, None)).is_err());
    assert!(s.create_receivable(&nr("", 100, None)).is_err());
}

#[test]
fn partial_then_full_payment_settles() {
    let conn = fresh();
    seed_customer(&conn, "cust-1");
    let s = store(&conn);
    let r = s.create_receivable(&nr("cust-1", 1000, None)).unwrap();

    let (after1, pay1) = s
        .record_receivable_payment(
            "default",
            &r.id,
            money("IDR", 400),
            "cash",
            Some("cashier-1"),
            "first installment",
        )
        .unwrap();
    assert_eq!(after1.status, ReceivableStatus::Partial);
    assert_eq!(after1.paid.minor_units, 400);
    assert_eq!(after1.balance_minor(), 600);
    assert!(after1.settled_at.is_none());
    assert_eq!(pay1.amount.minor_units, 400);
    assert_eq!(pay1.method, "cash");

    let (after2, _pay2) = s
        .record_receivable_payment(
            "default",
            &r.id,
            money("IDR", 600),
            "qris",
            Some("cashier-1"),
            "paid off",
        )
        .unwrap();
    assert_eq!(after2.status, ReceivableStatus::Paid);
    assert_eq!(after2.paid.minor_units, 1000);
    assert_eq!(after2.balance_minor(), 0);
    assert!(after2.settled_at.is_some());

    let history = s.list_receivable_payments("default", &r.id).unwrap();
    assert_eq!(history.len(), 2);
    assert_eq!(history[0].amount.minor_units, 400);
    assert_eq!(history[1].amount.minor_units, 600);
}

#[test]
fn payment_rejects_overpayment_and_currency_mismatch() {
    let conn = fresh();
    seed_customer(&conn, "cust-1");
    let s = store(&conn);
    let r = s.create_receivable(&nr("cust-1", 1000, None)).unwrap();

    // Overpayment
    assert!(
        s.record_receivable_payment("default", &r.id, money("IDR", 1001), "cash", None, "")
            .is_err()
    );
    // Currency mismatch
    assert!(
        s.record_receivable_payment("default", &r.id, money("USD", 500), "cash", None, "")
            .is_err()
    );
}

#[test]
fn write_off_forgives_unsettled_balance() {
    let conn = fresh();
    seed_customer(&conn, "cust-1");
    let s = store(&conn);
    let r = s.create_receivable(&nr("cust-1", 1000, None)).unwrap();

    let (after_partial, _) = s
        .record_receivable_payment("default", &r.id, money("IDR", 300), "cash", None, "")
        .unwrap();
    assert_eq!(after_partial.status, ReceivableStatus::Partial);

    let written_off = s.write_off_receivable("default", &r.id).unwrap();
    assert_eq!(written_off.status, ReceivableStatus::WrittenOff);
    assert!(written_off.written_off_at.is_some());
    assert_eq!(written_off.paid.minor_units, 300);
}

#[test]
fn cannot_pay_or_write_off_terminal_receivable() {
    let conn = fresh();
    seed_customer(&conn, "cust-1");
    let s = store(&conn);
    let r = s.create_receivable(&nr("cust-1", 500, None)).unwrap();

    let (paid, _) = s
        .record_receivable_payment("default", &r.id, money("IDR", 500), "cash", None, "")
        .unwrap();
    assert_eq!(paid.status, ReceivableStatus::Paid);

    assert!(
        s.record_receivable_payment("default", &r.id, money("IDR", 100), "cash", None, "")
            .is_err()
    );
    assert!(s.write_off_receivable("default", &r.id).is_err());
}

#[test]
fn list_and_customer_outstanding() {
    let conn = fresh();
    seed_customer(&conn, "cust-1");
    seed_customer(&conn, "cust-2");
    let s = store(&conn);

    let r1 = s.create_receivable(&nr("cust-1", 100_000, None)).unwrap();
    let _r2 = s.create_receivable(&nr("cust-1", 50_000, None)).unwrap();
    let _r3 = s.create_receivable(&nr("cust-2", 70_000, None)).unwrap();

    assert_eq!(s.outstanding_receivable_total("default").unwrap(), 220_000);
    assert_eq!(
        s.customer_outstanding_total("default", "cust-1").unwrap(),
        150_000
    );
    assert_eq!(
        s.customer_outstanding_total("default", "cust-2").unwrap(),
        70_000
    );

    // Pay part of r1
    let _ = s
        .record_receivable_payment("default", &r1.id, money("IDR", 40_000), "cash", None, "")
        .unwrap();
    assert_eq!(
        s.customer_outstanding_total("default", "cust-1").unwrap(),
        110_000
    );
    assert_eq!(s.outstanding_receivable_total("default").unwrap(), 180_000);

    let cust1_list = s
        .list_receivables_by_customer("default", "cust-1", None)
        .unwrap();
    assert_eq!(cust1_list.len(), 2);
}

#[test]
fn overdue_sweep() {
    let conn = fresh();
    seed_customer(&conn, "cust-1");
    let s = store(&conn);

    let _past = s
        .create_receivable(&nr("cust-1", 10_000, Some("2026-01-01")))
        .unwrap();
    let _future = s
        .create_receivable(&nr("cust-1", 20_000, Some("2026-12-31")))
        .unwrap();
    let _none = s.create_receivable(&nr("cust-1", 30_000, None)).unwrap();

    let overdue = s.list_overdue_receivables("default", "2026-06-01").unwrap();
    assert_eq!(overdue.len(), 1);
    assert_eq!(overdue[0].amount.minor_units, 10_000);
}

#[test]
fn ar_aging_report_buckets() {
    let conn = fresh();
    seed_customer(&conn, "cust-1");
    seed_customer(&conn, "cust-2");
    let s = store(&conn);

    let _r1 = s.create_receivable(&nr("cust-1", 100_000, None)).unwrap();
    let r2 = s.create_receivable(&nr("cust-1", 200_000, None)).unwrap();
    let r3 = s.create_receivable(&nr("cust-2", 300_000, None)).unwrap();
    let r4 = s.create_receivable(&nr("cust-2", 400_000, None)).unwrap();

    // Backdate r2 (36 days), r3 (77 days), r4 (123 days) from 2026-10-21
    conn.execute(
        "UPDATE receivables SET created_at = '2026-09-15 00:00:00' WHERE id = ?1",
        params![r2.id],
    )
    .unwrap();
    conn.execute(
        "UPDATE receivables SET created_at = '2026-08-05 00:00:00' WHERE id = ?1",
        params![r3.id],
    )
    .unwrap();
    conn.execute(
        "UPDATE receivables SET created_at = '2026-06-20 00:00:00' WHERE id = ?1",
        params![r4.id],
    )
    .unwrap();

    let report = s
        .get_ar_aging_report("default", Some("2026-10-21"))
        .unwrap();
    assert_eq!(report.as_of_date, "2026-10-21");
    assert_eq!(report.summary.current_minor, 100_000);
    assert_eq!(report.summary.days_31_60_minor, 200_000);
    assert_eq!(report.summary.days_61_90_minor, 300_000);
    assert_eq!(report.summary.days_over_90_minor, 400_000);
    assert_eq!(report.summary.total_outstanding_minor, 1_000_000);
    assert_eq!(report.customers.len(), 2);
}

/// Two PARTIAL payments of the same amount are both ACCEPTED, and the second overwrites
/// the paid total with a sum derived from a STALE read.
///
/// Not a bug report: recording two partial instalments is legitimate, and this function
/// cannot tell an instalment from a replay. It is recorded because
/// `record_receivable_payment` has no replay guard of its own and is reached from a UI
/// button. It reads the receivable at :242-247, computes `new_paid` at :272-279 and only
/// THEN opens the transaction at :300, so two calls dispatched from one double tap both
/// pass the overpayment check — the status CAS matches 'open'/'partial', which a partial
/// payment leaves unchanged. The protection therefore lives entirely in the caller:
/// `KasbonSettlementModal` holds an atomic ref taken before `setSubmitting(true)`. If a
/// second caller ever appears, this test is the reason it must carry its own guard.
#[test]
fn a_second_partial_payment_is_accepted_not_refused() {
    let conn = fresh();
    seed_customer(&conn, "cust-1");
    let s = store(&conn);
    let r = s.create_receivable(&nr("cust-1", 1000, None)).unwrap();

    let (first, _) = s
        .record_receivable_payment("default", &r.id, money("IDR", 300), "cash", None, "")
        .unwrap();
    assert_eq!(first.paid.minor_units, 300);

    // The replay the UI's ref guard now prevents: same arguments, a fresh call.
    let (second, _) = s
        .record_receivable_payment("default", &r.id, money("IDR", 300), "cash", None, "")
        .unwrap();
    assert_eq!(
        second.paid.minor_units, 600,
        "a second partial payment is absorbed, not refused"
    );
    assert_eq!(
        second.status,
        ReceivableStatus::Partial,
        "status stays 'partial', which is why the CAS cannot refuse a partial replay"
    );

    let history = s.list_receivable_payments("default", &r.id).unwrap();
    assert_eq!(
        history.len(),
        2,
        "both payments were recorded; nothing collapsed them"
    );
}
