use super::*;
use crate::testing::{TestBridge, temp_conn};
use kasirmu_core::session::SessionContext;

fn idr(minor: i64) -> Money {
    Money {
        minor_units: minor,
        currency: "IDR".parse::<Currency>().unwrap(),
    }
}

#[test]
fn receivable_dto_uses_camel_case_wire_fields_and_derives_balance() {
    let r = Receivable {
        id: "r-1".into(),
        tenant_id: "default".into(),
        customer_id: "cust-1".into(),
        sale_id: Some("sale-9".into()),
        source: "pos".into(),
        reference: "INV-9".into(),
        amount: idr(1000),
        paid: idr(400),
        due_date: Some("2999-01-01".into()),
        status: ReceivableStatus::Partial,
        note: String::new(),
        created_at: "2026-09-01T00:00:00.000Z".into(),
        updated_at: "2026-09-02T00:00:00.000Z".into(),
        settled_at: None,
        written_off_at: None,
    };
    let json = serde_json::to_value(ReceivableDto::from_receivable(r)).unwrap();
    assert_eq!(json["customerId"], "cust-1");
    assert_eq!(json["saleId"], "sale-9");
    assert_eq!(json["status"], "partial");
    assert_eq!(json["dueDate"], "2999-01-01");
    assert_eq!(json["amount"]["minor_units"], 1000);
    assert_eq!(json["amount"]["currency"], "IDR");
    assert_eq!(
        json["balance"]["minor_units"], 600,
        "balance = amount - paid"
    );
    assert_eq!(json["isOverdue"], false);
    assert!(json.get("customer_id").is_none());
    assert!(json.get("due_date").is_none());
}

#[test]
fn receivable_dto_flags_overdue_past_due_open_receivable() {
    let r = Receivable {
        id: "r-2".into(),
        tenant_id: "default".into(),
        customer_id: "cust-1".into(),
        sale_id: None,
        source: "pos".into(),
        reference: String::new(),
        amount: idr(500),
        paid: idr(0),
        due_date: Some("2000-01-01".into()),
        status: ReceivableStatus::Open,
        note: String::new(),
        created_at: "2026-09-01T00:00:00.000Z".into(),
        updated_at: "2026-09-01T00:00:00.000Z".into(),
        settled_at: None,
        written_off_at: None,
    };
    let json = serde_json::to_value(ReceivableDto::from_receivable(r)).unwrap();
    assert_eq!(json["isOverdue"], true);
}

#[test]
fn create_args_deserialize_camel_case_and_optionals() {
    let args: CreateReceivableArgs = serde_json::from_value(serde_json::json!({
        "customerId": "cust-1",
        "amount": { "minor_units": 2500, "currency": "IDR" },
    }))
    .unwrap();
    assert_eq!(args.customer_id, "cust-1");
    assert_eq!(args.amount.minor_units, 2500);
    assert!(args.sale_id.is_none());
    assert!(args.source.is_none());
    assert!(args.due_date.is_none());
}

#[test]
fn parse_status_filter_accepts_clean_tokens_and_rejects_bogus() {
    assert_eq!(parse_status_filter(None).unwrap(), None);
    assert!(parse_status_filter(Some("")).unwrap().is_none());
    assert_eq!(
        parse_status_filter(Some("partial")).unwrap(),
        Some(ReceivableStatus::Partial)
    );
    assert!(parse_status_filter(Some("bogus")).is_err());
}

// ── Command permission + lifecycle tests ────────────────────────────

fn seed_user(conn: &rusqlite::Connection, user_id: &str, role_id: &str) {
    let store = Store::new(conn);
    store.seed_default_roles().unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES (?1, ?1, 'hash', ?1, ?2, 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
        rusqlite::params![user_id, role_id],
    )
    .unwrap();
}

fn seed_customer(conn: &rusqlite::Connection, id: &str) {
    conn.execute(
        "INSERT INTO customers (id, name, created_at, updated_at)
         VALUES (?1, ?1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
        rusqlite::params![id],
    )
    .unwrap();
}

fn session_for(user_id: &str, role_id: &str) -> SessionContext {
    SessionContext::new(
        user_id.into(),
        role_id.into(),
        "term-1".into(),
        "store-a".into(),
        "inst-1".into(),
        "store-pos".into(),
        None,
        0,
    )
}

fn insert_session(bridge: &TestBridge, user_id: &str, role_id: &str) {
    bridge
        .sessions()
        .write()
        .unwrap()
        .insert("tok".into(), session_for(user_id, role_id));
}

fn create_args(customer: &str, amount: i64) -> CreateReceivableArgs {
    CreateReceivableArgs {
        customer_id: customer.into(),
        sale_id: None,
        source: Some("pos".into()),
        reference: Some("REC-1".into()),
        amount: MoneyDto {
            minor_units: amount,
            currency: "IDR".into(),
        },
        due_date: None,
        note: None,
    }
}

#[tokio::test]
async fn owner_full_receivable_lifecycle() {
    let conn = temp_conn();
    seed_user(&conn, "user-owner", "role-owner");
    seed_customer(&conn, "cust-1");
    let bridge = TestBridge::new().with_conn(conn);
    insert_session(&bridge, "user-owner", "role-owner");

    let created = create_receivable_scoped(&bridge.ctx(), create_args("cust-1", 1000), "tok")
        .await
        .unwrap();
    assert_eq!(created.amount.minor_units, 1000);
    assert_eq!(created.balance.minor_units, 1000);
    assert_eq!(created.status, "open");

    let paid = record_receivable_payment_scoped(
        &bridge.ctx(),
        RecordReceivablePaymentArgs {
            receivable_id: created.id.clone(),
            amount: MoneyDto {
                minor_units: 400,
                currency: "IDR".into(),
            },
            method: "cash".into(),
            note: None,
        },
        "tok",
    )
    .await
    .unwrap();
    assert_eq!(paid.paid.minor_units, 400);
    assert_eq!(paid.balance.minor_units, 600);
    assert_eq!(paid.status, "partial");

    let summary = get_customer_receivables_summary_scoped(&bridge.ctx(), "cust-1", "tok")
        .await
        .unwrap();
    assert_eq!(summary.outstanding_total.minor_units, 600);
    assert_eq!(summary.open_count, 1);
    assert!(!summary.has_overdue);

    let written_off = write_off_receivable_scoped(&bridge.ctx(), &created.id, "tok")
        .await
        .unwrap();
    assert_eq!(written_off.status, "written_off");
}

#[tokio::test]
async fn staff_can_view_and_collect_but_not_create_or_writeoff() {
    let conn = temp_conn();
    seed_user(&conn, "user-staff", "role-staff");
    seed_customer(&conn, "cust-1");
    let r_id = Store::new(&conn)
        .create_receivable(&NewReceivable {
            tenant_id: "default".into(),
            customer_id: "cust-1".into(),
            sale_id: None,
            source: "pos".into(),
            reference: String::new(),
            amount: idr(500),
            due_date: None,
            note: String::new(),
        })
        .unwrap()
        .id;
    let bridge = TestBridge::new().with_conn(conn);
    insert_session(&bridge, "user-staff", "role-staff");

    // Staff CAN view
    let list = list_receivables_scoped(&bridge.ctx(), None, "tok")
        .await
        .unwrap();
    assert_eq!(list.len(), 1);

    // Staff CAN collect repayment
    let paid = record_receivable_payment_scoped(
        &bridge.ctx(),
        RecordReceivablePaymentArgs {
            receivable_id: r_id.clone(),
            amount: MoneyDto {
                minor_units: 200,
                currency: "IDR".into(),
            },
            method: "cash".into(),
            note: None,
        },
        "tok",
    )
    .await
    .unwrap();
    assert_eq!(paid.paid.minor_units, 200);

    // Staff CANNOT create debt
    let denied_create =
        create_receivable_scoped(&bridge.ctx(), create_args("cust-1", 300), "tok").await;
    assert!(matches!(
        denied_create,
        Err(BridgeError::PermissionDenied(_))
    ));

    // Staff CANNOT write off
    let denied_wo = write_off_receivable_scoped(&bridge.ctx(), &r_id, "tok").await;
    assert!(matches!(denied_wo, Err(BridgeError::PermissionDenied(_))));
}

#[tokio::test]
async fn manager_can_create_and_writeoff() {
    let conn = temp_conn();
    seed_user(&conn, "user-mgr", "role-manager");
    seed_customer(&conn, "cust-1");
    let bridge = TestBridge::new().with_conn(conn);
    insert_session(&bridge, "user-mgr", "role-manager");

    let created = create_receivable_scoped(&bridge.ctx(), create_args("cust-1", 500), "tok")
        .await
        .unwrap();
    assert_eq!(created.amount.minor_units, 500);

    let written_off = write_off_receivable_scoped(&bridge.ctx(), &created.id, "tok")
        .await
        .unwrap();
    assert_eq!(written_off.status, "written_off");
}
