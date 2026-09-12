use super::*;
use foundation::Currency;
use oz_core::{Money, SaleLine};

fn usd() -> Currency {
    "USD".parse().unwrap()
}

fn price(minor: i64) -> Money {
    Money {
        minor_units: minor,
        currency: usd(),
    }
}

fn make_sale_line(sale_id: &str, sku: &str, qty: i64, unit: i64) -> SaleLine {
    SaleLine {
        id: uuid::Uuid::now_v7().to_string(),
        sale_id: sale_id.into(),
        sku: sku.into(),
        qty,
        unit_price: price(unit),
        line_total: price(unit * qty),
        line_position: 1,
        tax_amount: Money::zero(usd()),
        tax_rate_id: None,
        tax_breakdown_json: None,
        serial_number: None,
        course: None,
        modifiers_json: None,
    }
}

// ── SaleListItem ───────────────────────────────────────────────────

// ── F2-7: the estimate note rides the detail DTO ───────────────────

#[test]
fn sale_detail_carries_the_estimate_stamp_when_claimed() {
    let detail = SaleDetail {
        id: "s-est".into(),
        total: price(770),
        line_count: 1,
        status: "Pending".into(),
        payment_method: Some("cash".into()),
        tendered_minor: Some(770),
        user_id: None,
        created_at: "2026-09-10T00:00:00.000Z".into(),
        lines: vec![],
        tax_estimate_note: Some("{\"estimated\":true,\"computed_tax\":70}".into()),
    };
    let json = serde_json::to_value(&detail).unwrap();
    assert_eq!(
        json["taxEstimateNote"], "{\"estimated\":true,\"computed_tax\":70}",
        "the badge source rides the wire camelCase"
    );
}

#[test]
fn sale_detail_serializes_null_when_unstamped() {
    let detail = SaleDetail {
        id: "s-est".into(),
        total: price(770),
        line_count: 1,
        status: "Pending".into(),
        payment_method: None,
        tendered_minor: None,
        user_id: None,
        created_at: "2026-09-10T00:00:00.000Z".into(),
        lines: vec![],
        tax_estimate_note: None,
    };
    let json = serde_json::to_value(&detail).unwrap();
    assert!(
        json["taxEstimateNote"].is_null(),
        "NULL = unstamped — absence must never read as a claim"
    );
}

#[test]
fn sale_list_item_debug() {
    let item = SaleListItem {
        id: "s1".into(),
        total: price(5000),
        line_count: 3,
        status: "completed".into(),
        payment_method: Some("cash".into()),
        user_id: Some("u1".into()),
        created_at: "2025-01-01".into(),
    };
    let d = format!("{item:?}");
    assert!(d.contains("s1"));
    assert!(d.contains("5000"));
    assert!(d.contains("completed"));
    assert!(d.contains("cash"));
}

#[test]
fn sale_list_item_serialize() {
    let item = SaleListItem {
        id: "s2".into(),
        total: price(7500),
        line_count: 1,
        status: "voided".into(),
        payment_method: None,
        user_id: None,
        created_at: "2025-06-01".into(),
    };
    let json = serde_json::to_value(&item).unwrap();
    assert_eq!(json["id"], "s2");
    assert_eq!(json["line_count"], 1);
    assert_eq!(json["status"], "voided");
    assert!(json["payment_method"].is_null());
}

// ── SaleDetail ──────────────────────────────────────────────────────

#[test]
fn sale_detail_debug() {
    let detail = SaleDetail {
        id: "sd1".into(),
        total: price(10000),
        line_count: 2,
        status: "completed".into(),
        payment_method: Some("card".into()),
        tendered_minor: Some(12000),
        user_id: Some("u2".into()),
        created_at: "2025-03-15".into(),
        lines: vec![make_sale_line("sd1", "SKU-A", 2, 5000)],
        tax_estimate_note: None,
    };
    let d = format!("{detail:?}");
    assert!(d.contains("sd1"));
    assert!(d.contains("SKU-A"));
}

#[test]
fn sale_detail_serialize() {
    let detail = SaleDetail {
        id: "sd2".into(),
        total: price(3000),
        line_count: 1,
        status: "completed".into(),
        payment_method: None,
        tendered_minor: None,
        user_id: None,
        created_at: "2025-01-01".into(),
        lines: vec![],
        tax_estimate_note: None,
    };
    let json = serde_json::to_value(&detail).unwrap();
    assert_eq!(json["id"], "sd2");
    assert!(
        json["paymentMethod"].is_null(),
        "camelCase wire: paymentMethod"
    );
    assert!(
        json["tenderedMinor"].is_null(),
        "camelCase wire: tenderedMinor"
    );
    assert!(
        json["taxEstimateNote"].is_null(),
        "camelCase wire: taxEstimateNote"
    );
    assert_eq!(json["lines"].as_array().unwrap().len(), 0);
}

// ── PaymentBreakdown ────────────────────────────────────────────────

#[test]
fn payment_breakdown_debug() {
    let pb = PaymentBreakdown {
        method: "cash".into(),
        count: 15,
        total: 50000,
    };
    let d = format!("{pb:?}");
    assert!(d.contains("cash"));
    assert!(d.contains("15"));
    assert!(d.contains("50000"));
}

#[test]
fn payment_breakdown_serialize() {
    let pb = PaymentBreakdown {
        method: "card".into(),
        count: 42,
        total: 120000,
    };
    let json = serde_json::to_value(&pb).unwrap();
    assert_eq!(json["method"], "card");
    assert_eq!(json["count"], 42);
    assert_eq!(json["total"], 120000);
}

// ── EodReport ───────────────────────────────────────────────────────

#[test]
fn eod_report_debug() {
    let report = EodReport {
        total_sales: 100,
        total_revenue: 500000,
        currency: "IDR".into(),
        payment_breakdown: vec![],
        void_count: 3,
        void_total: 15000,
        discount_count: 10,
        discount_total: 25000,
        hourly_breakdown: vec![],
    };
    let d = format!("{report:?}");
    assert!(d.contains("100"));
    assert!(d.contains("IDR"));
}

#[test]
fn eod_report_serialize() {
    let report = EodReport {
        total_sales: 50,
        total_revenue: 250000,
        currency: "USD".into(),
        payment_breakdown: vec![PaymentBreakdown {
            method: "cash".into(),
            count: 30,
            total: 150000,
        }],
        void_count: 1,
        void_total: 5000,
        discount_count: 5,
        discount_total: 10000,
        hourly_breakdown: vec![],
    };
    let json = serde_json::to_value(&report).unwrap();
    assert_eq!(json["total_sales"], 50);
    assert_eq!(json["currency"], "USD");
    assert_eq!(json["void_count"], 1);
    assert!(!json["payment_breakdown"].as_array().unwrap().is_empty());
}

// ── F-017: the five session-scoped twins must CHECK a permission ────────
//
// `resolve_scope` resolves the session and opens the store database and
// stops there, so a `_scoped` twin that asks nothing after it is a name that
// looks gated and is not — worse than an unscoped door, because it survives
// review. Each case drives the real command twice through the real harness:
// a session whose role lacks the permission must be refused, and the same
// door must open for a session that holds it. Deny comes first in every
// case, because a check that never runs can only fail the deny leg. The
// permission is named by constant, never by a copy of the wire string, and
// the refusal text is checked for what it must not carry.

use oz_core::migrations;
use platform_core::StoreDatabaseManager;
use tauri::Manager as _;

const HIST_SALE: &str = "s-hist-1";
const DENIED_TOKEN: &str = "tok-no-perm";
const GRANTED_TOKEN: &str = "tok-granted";

/// Global db seeded with the default roles; store-a holds the two roles and
/// two users the doors are tested against, plus one sale row to identify.
fn history_state() -> (AppState, tempfile::TempDir) {
    let conn = migrations::fresh_db();
    {
        let store = Store::new(&conn);
        store.seed_default_roles().unwrap();
    }
    let temp_dir = tempfile::tempdir().unwrap();
    let mut state = AppState::for_test_with_conn(conn);
    state.db_manager = StoreDatabaseManager::new(temp_dir.path().to_path_buf(), migrations::ALL);
    let conn = state.db_manager.open_store("store-a").unwrap();
    let db = conn.lock().unwrap();
    db.execute_batch(
        r#"INSERT INTO roles (id, name, description, permissions, created_at, updated_at)
         VALUES ('role-nope', 'Nope', 'Nothing granted', '[]', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
            ('role-full', 'Full', 'Both doors granted', '["sales:view","reports:export"]', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
         INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at) VALUES
            ('user-nope', 'nope', 'hash-not-a-real-pin', 'Nope', 'role-nope', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
            ('user-full', 'full', 'hash-not-a-real-pin', 'Full', 'role-full', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
         INSERT INTO sales (id, total_minor, currency, line_count, status, user_id, created_at) VALUES
            ('s-hist-1', 12000, 'USD', 1, 'completed', 'user-full', '2026-07-10T09:00:00Z');"#
    )
    .unwrap();
    drop(db);
    (state, temp_dir)
}

fn mint(state: &mut AppState, token: &str, user: &str, role: &str) {
    state.session_store.write().unwrap().insert(
        token.into(),
        oz_core::session::SessionContext::new(
            user.into(),
            role.into(),
            "terminal-1".into(),
            "store-a".into(),
            "ws-a-1".into(),
            "store-pos".into(),
            None,
            0,
        ),
    );
}

fn mock_app(state: AppState) -> tauri::App<tauri::test::MockRuntime> {
    tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap()
}

/// The refusal must say no, name nothing it should not, and carry no value.
fn assert_refusal_text(cmd: &str, message: &str) {
    assert!(
        !message.is_empty(),
        "{cmd}: an empty refusal tells the cashier nothing"
    );
    for leak in [DENIED_TOKEN, GRANTED_TOKEN, "hash-not-a-real-pin", "12000"] {
        assert!(
            !message.contains(leak),
            "{cmd}: the refusal leaks a session token, a pin hash or a row value"
        );
    }
}

#[tokio::test]
async fn list_sales_scoped_requires_sales_view() {
    let (mut state, _dir) = history_state();
    mint(&mut state, DENIED_TOKEN, "user-nope", "role-nope");
    mint(&mut state, GRANTED_TOKEN, "user-full", "role-full");
    let app = mock_app(state);

    // Deny first: this is the leg a missing check cannot pass.
    let denied = list_sales_scoped(DENIED_TOKEN.into(), app.state()).await;
    let Err(AppError::PermissionDenied(message)) = denied else {
        panic!("list_sales_scoped let a session without sales:view through: {denied:?}")
    };
    assert_refusal_text("list_sales_scoped", &message);

    // Allow: the same door, same data, one role apart.
    let allowed = list_sales_scoped(GRANTED_TOKEN.into(), app.state()).await;
    assert!(
        matches!(allowed, Ok(_)),
        "list_sales_scoped must still open for a session holding sales:view: {allowed:?}"
    );
}

#[tokio::test]
async fn get_sale_scoped_requires_sales_view() {
    let (mut state, _dir) = history_state();
    mint(&mut state, DENIED_TOKEN, "user-nope", "role-nope");
    mint(&mut state, GRANTED_TOKEN, "user-full", "role-full");
    let app = mock_app(state);

    // Deny first: this is the leg a missing check cannot pass.
    let denied = get_sale_scoped(DENIED_TOKEN.into(), HIST_SALE.into(), app.state()).await;
    let Err(AppError::PermissionDenied(message)) = denied else {
        panic!("get_sale_scoped let a session without sales:view through: {denied:?}")
    };
    assert_refusal_text("get_sale_scoped", &message);

    // Allow: the same door, same data, one role apart.
    let allowed = get_sale_scoped(GRANTED_TOKEN.into(), HIST_SALE.into(), app.state()).await;
    assert!(
        matches!(allowed, Ok(_)),
        "get_sale_scoped must still open for a session holding sales:view: {allowed:?}"
    );
}

#[tokio::test]
async fn export_daily_summary_scoped_requires_reports_export() {
    let (mut state, _dir) = history_state();
    mint(&mut state, DENIED_TOKEN, "user-nope", "role-nope");
    mint(&mut state, GRANTED_TOKEN, "user-full", "role-full");
    let app = mock_app(state);

    // Deny first: this is the leg a missing check cannot pass.
    let denied = export_daily_summary_scoped(DENIED_TOKEN.into(), app.state()).await;
    let Err(AppError::PermissionDenied(message)) = denied else {
        panic!(
            "export_daily_summary_scoped let a session without reports:export through: {denied:?}"
        )
    };
    assert_refusal_text("export_daily_summary_scoped", &message);

    // Allow: the same door, same data, one role apart.
    let allowed = export_daily_summary_scoped(GRANTED_TOKEN.into(), app.state()).await;
    assert!(
        matches!(allowed, Ok(_)),
        "export_daily_summary_scoped must still open for a session holding reports:export: {allowed:?}"
    );
}

#[tokio::test]
async fn export_sales_by_hour_scoped_requires_reports_export() {
    let (mut state, _dir) = history_state();
    mint(&mut state, DENIED_TOKEN, "user-nope", "role-nope");
    mint(&mut state, GRANTED_TOKEN, "user-full", "role-full");
    let app = mock_app(state);

    // Deny first: this is the leg a missing check cannot pass.
    let denied = export_sales_by_hour_scoped(DENIED_TOKEN.into(), app.state()).await;
    let Err(AppError::PermissionDenied(message)) = denied else {
        panic!(
            "export_sales_by_hour_scoped let a session without reports:export through: {denied:?}"
        )
    };
    assert_refusal_text("export_sales_by_hour_scoped", &message);

    // Allow: the same door, same data, one role apart.
    let allowed = export_sales_by_hour_scoped(GRANTED_TOKEN.into(), app.state()).await;
    assert!(
        matches!(allowed, Ok(_)),
        "export_sales_by_hour_scoped must still open for a session holding reports:export: {allowed:?}"
    );
}

#[tokio::test]
async fn export_eod_report_scoped_requires_reports_export() {
    let (mut state, _dir) = history_state();
    mint(&mut state, DENIED_TOKEN, "user-nope", "role-nope");
    mint(&mut state, GRANTED_TOKEN, "user-full", "role-full");
    let app = mock_app(state);

    // Deny first: this is the leg a missing check cannot pass.
    let denied = export_eod_report_scoped(DENIED_TOKEN.into(), app.state()).await;
    let Err(AppError::PermissionDenied(message)) = denied else {
        panic!("export_eod_report_scoped let a session without reports:export through: {denied:?}")
    };
    assert_refusal_text("export_eod_report_scoped", &message);

    // Allow: the same door, same data, one role apart.
    let allowed = export_eod_report_scoped(GRANTED_TOKEN.into(), app.state()).await;
    assert!(
        matches!(allowed, Ok(_)),
        "export_eod_report_scoped must still open for a session holding reports:export: {allowed:?}"
    );
}
