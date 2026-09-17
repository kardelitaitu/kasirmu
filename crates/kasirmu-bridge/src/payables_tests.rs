//! Unit tests for the accounts-payable command bodies (Wave-C test
//! relocation: moved out of `apps/desktop-client/src/commands/payables_tests.rs`).
//!
//! The desktop file booted a Tauri mock app over `AppState::for_test_with_conn`
//! and inserted sessions into `session_store`; the same seeds here go into a
//! [`TestBridge`] over the shared `temp_conn` harness (the same fully-migrated
//! in-memory global identity DB), and every scoped call takes `&bridge.ctx()`
//! with the session token as a `&str`. `AppError::` assertions map 1:1 onto
//! `BridgeError::` (identical variant shapes), and `parse_status_filter` now
//! exercises the bridge's own pub helper instead of the shell's adapter.

use super::*;
use crate::testing::{TestBridge, temp_conn};
use kasirmu_core::session::SessionContext;

fn idr(minor: i64) -> Money {
    Money {
        minor_units: minor,
        currency: "IDR".parse::<Currency>().unwrap(),
    }
}

// ── DTO / args / helper unit tests ──────────────────────────────────

#[test]
fn payable_dto_uses_camel_case_wire_fields_and_derives_balance() {
    let p = Payable {
        id: "p-1".into(),
        tenant_id: "default".into(),
        supplier_id: "sup-1".into(),
        po_id: Some("po-9".into()),
        source: "po_receive".into(),
        reference: "INV-9".into(),
        amount: idr(1000),
        paid: idr(400),
        due_date: Some("2999-01-01".into()),
        status: PayableStatus::Partial,
        note: String::new(),
        created_at: "2026-09-01T00:00:00.000Z".into(),
        updated_at: "2026-09-02T00:00:00.000Z".into(),
        settled_at: None,
        written_off_at: None,
    };
    let json = serde_json::to_value(PayableDto::from_payable(p)).unwrap();
    assert_eq!(json["supplierId"], "sup-1");
    assert_eq!(json["poId"], "po-9");
    assert_eq!(json["status"], "partial");
    assert_eq!(json["dueDate"], "2999-01-01");
    assert_eq!(json["amount"]["minor_units"], 1000);
    assert_eq!(json["amount"]["currency"], "IDR");
    assert_eq!(
        json["balance"]["minor_units"], 600,
        "balance = amount - paid"
    );
    assert_eq!(json["isOverdue"], false, "a future due date is not overdue");
    assert!(json.get("supplier_id").is_none());
    assert!(json.get("due_date").is_none());
}

#[test]
fn payable_dto_flags_overdue_past_due_open_payable() {
    let p = Payable {
        id: "p-2".into(),
        tenant_id: "default".into(),
        supplier_id: "sup-1".into(),
        po_id: None,
        source: "manual".into(),
        reference: String::new(),
        amount: idr(500),
        paid: idr(0),
        due_date: Some("2000-01-01".into()),
        status: PayableStatus::Open,
        note: String::new(),
        created_at: "2026-09-01T00:00:00.000Z".into(),
        updated_at: "2026-09-01T00:00:00.000Z".into(),
        settled_at: None,
        written_off_at: None,
    };
    let json = serde_json::to_value(PayableDto::from_payable(p)).unwrap();
    assert_eq!(json["isOverdue"], true);
    assert!(json["poId"].is_null());
}

#[test]
fn create_args_deserialize_camel_case_and_optionals() {
    let args: CreatePayableArgs = serde_json::from_value(serde_json::json!({
        "supplierId": "sup-1",
        "amount": { "minor_units": 2500, "currency": "IDR" },
    }))
    .unwrap();
    assert_eq!(args.supplier_id, "sup-1");
    assert_eq!(args.amount.minor_units, 2500);
    assert!(args.po_id.is_none());
    assert!(args.source.is_none());
    assert!(args.due_date.is_none());
}

#[test]
fn create_args_rejects_missing_required_fields() {
    // supplierId and amount are required.
    let missing: Result<CreatePayableArgs, _> = serde_json::from_value(
        serde_json::json!({ "amount": { "minor_units": 1, "currency": "IDR" } }),
    );
    assert!(missing.is_err());
}

#[test]
fn parse_status_filter_accepts_known_and_rejects_unknown() {
    assert!(parse_status_filter(None).unwrap().is_none());
    assert!(parse_status_filter(Some("")).unwrap().is_none());
    assert_eq!(
        parse_status_filter(Some("partial")).unwrap(),
        Some(PayableStatus::Partial)
    );
    assert!(parse_status_filter(Some("bogus")).is_err());
}

// ── command-level permission + lifecycle tests ──────────────────────

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

fn seed_supplier(conn: &rusqlite::Connection, id: &str) {
    conn.execute(
        "INSERT INTO suppliers (id, code, name, created_at, updated_at)
         VALUES (?1, ?1, ?1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
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

fn create_args(supplier: &str, amount: i64) -> CreatePayableArgs {
    CreatePayableArgs {
        supplier_id: supplier.into(),
        po_id: None,
        source: Some("manual".into()),
        reference: Some("INV-1".into()),
        amount: MoneyDto {
            minor_units: amount,
            currency: "IDR".into(),
        },
        due_date: None,
        note: None,
    }
}

#[tokio::test]
async fn owner_full_payable_lifecycle() {
    let conn = temp_conn();
    seed_user(&conn, "user-owner", "role-owner");
    seed_supplier(&conn, "sup-1");
    let bridge = TestBridge::new().with_conn(conn);
    insert_session(&bridge, "user-owner", "role-owner");

    let created = create_payable_scoped(&bridge.ctx(), create_args("sup-1", 1000), "tok")
        .await
        .unwrap();
    assert_eq!(created.status, "open");
    assert_eq!(created.balance.minor_units, 1000);

    let partial = record_payable_payment_scoped(
        &bridge.ctx(),
        RecordPayablePaymentArgs {
            payable_id: created.id.clone(),
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
    assert_eq!(partial.status, "partial");
    assert_eq!(partial.balance.minor_units, 600);

    let settled = record_payable_payment_scoped(
        &bridge.ctx(),
        RecordPayablePaymentArgs {
            payable_id: created.id.clone(),
            amount: MoneyDto {
                minor_units: 600,
                currency: "IDR".into(),
            },
            method: "bank_transfer".into(),
            note: None,
        },
        "tok",
    )
    .await
    .unwrap();
    assert_eq!(settled.status, "paid");
    assert_eq!(settled.balance.minor_units, 0);
    assert!(settled.settled_at.is_some());

    let all = list_payables_scoped(&bridge.ctx(), None, "tok")
        .await
        .unwrap();
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].status, "paid");
}

#[tokio::test]
async fn owner_can_write_off_a_payable() {
    let conn = temp_conn();
    seed_user(&conn, "user-owner", "role-owner");
    seed_supplier(&conn, "sup-1");
    let bridge = TestBridge::new().with_conn(conn);
    insert_session(&bridge, "user-owner", "role-owner");
    let created = create_payable_scoped(&bridge.ctx(), create_args("sup-1", 800), "tok")
        .await
        .unwrap();
    let wo = write_off_payable_scoped(&bridge.ctx(), &created.id, "tok")
        .await
        .unwrap();
    assert_eq!(wo.status, "written_off");
    assert!(wo.written_off_at.is_some());
}

#[tokio::test]
async fn auditor_can_view_but_not_write() {
    let conn = temp_conn();
    seed_user(&conn, "user-aud", "role-auditor");
    seed_supplier(&conn, "sup-1");
    // Seed a payable directly (the auditor cannot create one).
    Store::new(&conn)
        .create_payable(&NewPayable {
            tenant_id: "default".into(),
            supplier_id: "sup-1".into(),
            po_id: None,
            source: "manual".into(),
            reference: String::new(),
            amount: idr(300),
            due_date: None,
            note: String::new(),
        })
        .unwrap();
    let bridge = TestBridge::new().with_conn(conn);
    insert_session(&bridge, "user-aud", "role-auditor");

    let list = list_payables_scoped(&bridge.ctx(), None, "tok")
        .await
        .unwrap();
    assert_eq!(list.len(), 1, "auditor holds payables:view");

    let denied = create_payable_scoped(&bridge.ctx(), create_args("sup-1", 100), "tok").await;
    assert!(matches!(denied, Err(BridgeError::PermissionDenied(_))));
}

#[tokio::test]
async fn staff_cannot_view_payables() {
    let conn = temp_conn();
    seed_user(&conn, "user-staff", "role-staff");
    let bridge = TestBridge::new().with_conn(conn);
    insert_session(&bridge, "user-staff", "role-staff");
    let denied = list_payables_scoped(&bridge.ctx(), None, "tok").await;
    assert!(matches!(denied, Err(BridgeError::PermissionDenied(_))));
}

#[tokio::test]
async fn manager_cannot_settle_a_payable() {
    // Manager has no payables keys at all (AP is Owner-only + Auditor view).
    let conn = temp_conn();
    seed_user(&conn, "user-mgr", "role-manager");
    seed_supplier(&conn, "sup-1");
    let pid = Store::new(&conn)
        .create_payable(&NewPayable {
            tenant_id: "default".into(),
            supplier_id: "sup-1".into(),
            po_id: None,
            source: "manual".into(),
            reference: String::new(),
            amount: idr(500),
            due_date: None,
            note: String::new(),
        })
        .unwrap()
        .id;
    let bridge = TestBridge::new().with_conn(conn);
    insert_session(&bridge, "user-mgr", "role-manager");
    let denied = record_payable_payment_scoped(
        &bridge.ctx(),
        RecordPayablePaymentArgs {
            payable_id: pid,
            amount: MoneyDto {
                minor_units: 100,
                currency: "IDR".into(),
            },
            method: "cash".into(),
            note: None,
        },
        "tok",
    )
    .await;
    assert!(matches!(denied, Err(BridgeError::PermissionDenied(_))));
}

#[tokio::test]
async fn rejects_invalid_session() {
    let bridge = TestBridge::new();
    let r = list_payables_scoped(&bridge.ctx(), None, "missing-token").await;
    assert!(matches!(r, Err(BridgeError::InvalidSession)));
}
