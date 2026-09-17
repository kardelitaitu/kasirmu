use super::*;
use crate::migrations;
use crate::money::Currency;
use crate::payable::{NewPayable, PayableStatus};
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

fn seed_supplier(conn: &Connection, id: &str) {
    conn.execute(
        "INSERT INTO suppliers (id, code, name, created_at, updated_at)
         VALUES (?1, ?1, ?1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
        params![id],
    )
    .unwrap();
}

fn np(supplier: &str, amount: i64, due: Option<&str>) -> NewPayable {
    NewPayable {
        tenant_id: "default".into(),
        supplier_id: supplier.into(),
        po_id: None,
        source: "manual".into(),
        reference: "INV-1".into(),
        amount: money("IDR", amount),
        due_date: due.map(str::to_string),
        note: String::new(),
    }
}

#[test]
fn create_payable_starts_open_and_zero_paid() {
    let conn = fresh();
    seed_supplier(&conn, "sup-1");
    let s = store(&conn);
    let p = s
        .create_payable(&np("sup-1", 100_000, Some("2026-12-31")))
        .unwrap();
    assert_eq!(p.status, PayableStatus::Open);
    assert_eq!(p.amount.minor_units, 100_000);
    assert_eq!(p.paid.minor_units, 0);
    assert_eq!(p.balance_minor(), 100_000);
    assert!(p.settled_at.is_none());
    assert_eq!(p.supplier_id, "sup-1");
}

#[test]
fn create_rejects_nonpositive_amount_and_blank_supplier() {
    let conn = fresh();
    seed_supplier(&conn, "sup-1");
    let s = store(&conn);
    assert!(s.create_payable(&np("sup-1", 0, None)).is_err());
    assert!(s.create_payable(&np("", 100, None)).is_err());
}

#[test]
fn partial_then_full_payment_settles() {
    let conn = fresh();
    seed_supplier(&conn, "sup-1");
    let s = store(&conn);
    let p = s.create_payable(&np("sup-1", 1000, None)).unwrap();

    let (after1, _pay1) = s
        .record_payable_payment(
            "default",
            &p.id,
            money("IDR", 400),
            "cash",
            Some("u-1"),
            "half",
        )
        .unwrap();
    assert_eq!(after1.status, PayableStatus::Partial);
    assert_eq!(after1.paid.minor_units, 400);
    assert_eq!(after1.balance_minor(), 600);
    assert!(after1.settled_at.is_none());

    let (after2, _pay2) = s
        .record_payable_payment(
            "default",
            &p.id,
            money("IDR", 600),
            "bank_transfer",
            None,
            "",
        )
        .unwrap();
    assert_eq!(after2.status, PayableStatus::Paid);
    assert_eq!(after2.paid.minor_units, 1000);
    assert_eq!(after2.balance_minor(), 0);
    assert!(after2.settled_at.is_some());
}

#[test]
fn payment_history_accumulates_and_matches_paid() {
    let conn = fresh();
    seed_supplier(&conn, "sup-1");
    let s = store(&conn);
    let p = s.create_payable(&np("sup-1", 1000, None)).unwrap();
    s.record_payable_payment("default", &p.id, money("IDR", 300), "cash", None, "")
        .unwrap();
    s.record_payable_payment("default", &p.id, money("IDR", 200), "cash", None, "")
        .unwrap();
    let history = s.list_payable_payments("default", &p.id).unwrap();
    assert_eq!(history.len(), 2);
    let sum: i64 = history.iter().map(|h| h.amount.minor_units).sum();
    assert_eq!(sum, 500);
    assert_eq!(
        s.get_payable("default", &p.id)
            .unwrap()
            .unwrap()
            .paid
            .minor_units,
        500
    );
}

#[test]
fn overpayment_is_rejected_and_leaves_payable_unchanged() {
    let conn = fresh();
    seed_supplier(&conn, "sup-1");
    let s = store(&conn);
    let p = s.create_payable(&np("sup-1", 1000, None)).unwrap();
    // 400 then 700 would total 1100 > 1000.
    s.record_payable_payment("default", &p.id, money("IDR", 400), "cash", None, "")
        .unwrap();
    let err = s
        .record_payable_payment("default", &p.id, money("IDR", 700), "cash", None, "")
        .unwrap_err();
    assert!(matches!(err, CoreError::Validation { .. }), "got {err:?}");
    let after = s.get_payable("default", &p.id).unwrap().unwrap();
    assert_eq!(
        after.paid.minor_units, 400,
        "rejected payment must not persist"
    );
    assert_eq!(after.status, PayableStatus::Partial);
    // And no orphan history row was written.
    assert_eq!(s.list_payable_payments("default", &p.id).unwrap().len(), 1);
}

#[test]
fn nonpositive_and_currency_mismatch_payments_rejected() {
    let conn = fresh();
    seed_supplier(&conn, "sup-1");
    let s = store(&conn);
    let p = s.create_payable(&np("sup-1", 1000, None)).unwrap();
    assert!(
        s.record_payable_payment("default", &p.id, money("IDR", 0), "cash", None, "")
            .is_err()
    );
    assert!(
        s.record_payable_payment("default", &p.id, money("USD", 500), "cash", None, "")
            .is_err()
    );
}

#[test]
fn cannot_pay_a_settled_payable() {
    let conn = fresh();
    seed_supplier(&conn, "sup-1");
    let s = store(&conn);
    let p = s.create_payable(&np("sup-1", 500, None)).unwrap();
    s.record_payable_payment("default", &p.id, money("IDR", 500), "cash", None, "")
        .unwrap();
    let err = s
        .record_payable_payment("default", &p.id, money("IDR", 100), "cash", None, "")
        .unwrap_err();
    assert!(matches!(err, CoreError::Validation { .. }), "got {err:?}");
}

#[test]
fn write_off_is_terminal_and_keeps_paid_portion() {
    let conn = fresh();
    seed_supplier(&conn, "sup-1");
    let s = store(&conn);
    let p = s.create_payable(&np("sup-1", 1000, None)).unwrap();
    s.record_payable_payment("default", &p.id, money("IDR", 300), "cash", None, "")
        .unwrap();
    let wo = s.write_off_payable("default", &p.id).unwrap();
    assert_eq!(wo.status, PayableStatus::WrittenOff);
    assert_eq!(wo.paid.minor_units, 300, "paid portion is preserved");
    assert!(wo.written_off_at.is_some());
    // Terminal: no further payment or write-off.
    assert!(
        s.record_payable_payment("default", &p.id, money("IDR", 100), "cash", None, "")
            .is_err()
    );
    assert!(s.write_off_payable("default", &p.id).is_err());
}

#[test]
fn list_filters_by_status_and_orders_newest_first() {
    let conn = fresh();
    seed_supplier(&conn, "sup-1");
    let s = store(&conn);
    let a = s.create_payable(&np("sup-1", 100, None)).unwrap();
    let _b = s.create_payable(&np("sup-1", 200, None)).unwrap();
    s.record_payable_payment("default", &a.id, money("IDR", 100), "cash", None, "")
        .unwrap();
    let all = s.list_payables("default", None).unwrap();
    assert_eq!(all.len(), 2);
    let open = s
        .list_payables("default", Some(PayableStatus::Open))
        .unwrap();
    assert_eq!(open.len(), 1);
    assert_eq!(open[0].id, _b.id);
    let paid = s
        .list_payables("default", Some(PayableStatus::Paid))
        .unwrap();
    assert_eq!(paid.len(), 1);
    assert_eq!(paid[0].id, a.id);
}

#[test]
fn overdue_and_outstanding_total() {
    let conn = fresh();
    seed_supplier(&conn, "sup-1");
    let s = store(&conn);
    // Overdue (past due, still owed).
    let _od = s
        .create_payable(&np("sup-1", 500, Some("2026-01-01")))
        .unwrap();
    // Not overdue (future due).
    let _fu = s
        .create_payable(&np("sup-1", 300, Some("2099-01-01")))
        .unwrap();
    // Open-ended (no due date).
    let _op = s.create_payable(&np("sup-1", 200, None)).unwrap();
    let overdue = s.list_overdue_payables("default", "2026-06-01").unwrap();
    assert_eq!(overdue.len(), 1);
    assert_eq!(overdue[0].id, _od.id);
    // Outstanding = 500 + 300 + 200 = 1000 (all still owed).
    assert_eq!(s.outstanding_payable_total("default").unwrap(), 1000);
    // Settling one reduces the total.
    s.record_payable_payment("default", &_od.id, money("IDR", 500), "cash", None, "")
        .unwrap();
    assert_eq!(s.outstanding_payable_total("default").unwrap(), 500);
}

#[test]
fn reads_are_tenant_scoped() {
    let conn = fresh();
    seed_supplier(&conn, "sup-1");
    let s = store(&conn);
    let p = s.create_payable(&np("sup-1", 100, None)).unwrap();
    assert!(s.get_payable("other-tenant", &p.id).unwrap().is_none());
    assert!(s.list_payables("other-tenant", None).unwrap().is_empty());
    assert_eq!(s.outstanding_payable_total("other-tenant").unwrap(), 0);
    // A payment against another tenant's payable is a NotFound.
    assert!(matches!(
        s.record_payable_payment("other-tenant", &p.id, money("IDR", 50), "cash", None, "")
            .unwrap_err(),
        CoreError::NotFound { .. }
    ));
}
