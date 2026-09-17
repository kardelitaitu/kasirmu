//! Unit tests for the report command bodies (Wave-A test relocation: moved
//! out of `apps/desktop-client/src/commands/reports_tests.rs`).
//!
//! Mounted at the foot of `reports.rs` with `#[cfg(test)] #[path]`, so
//! `use super::*` resolves the scoped report operations, the pure validators
//! and the `MAX_*` bounds exactly as the desktop sibling module did.
//!
//! Harness mapping: the desktop file built a Tauri mock app over
//! `AppState::for_test` / `AppState::for_test_with_conn` and swapped in a
//! temp-dir `StoreDatabaseManager`; here `TestBridge::new().with_conn(conn)`
//! supplies the same shape headlessly (the harness's own unique store
//! directory stands in for the temp dir, so `tempfile` is not needed), and
//! sessions are seeded into `tb.sessions()` before the context is used. The
//! scoped operations stay async - they are `pub async fn` in the bridge too -
//! so `#[tokio::test]` and `.await` are preserved; only the desktop wrapper's
//! `String` tokens became `&str` and the trailing state argument became
//! `&state.ctx()`.

use super::*;
use crate::testing::TestBridge;
use oz_core::session::SessionContext;

/// Build a headless test bridge over a seeded global identity DB, with the
/// session pre-inserted - the bridge stand-in for the desktop helper that
/// assembled `AppState::for_test_with_conn` plus a temp-dir db_manager (the
/// harness ships its own unique-temp-dir per-store manager).
fn scoped_state(
    conn: rusqlite::Connection,
    token: &str,
    user_id: &str,
    role_id: &str,
    store_id: &str,
) -> TestBridge {
    let state = TestBridge::new().with_conn(conn);
    state.sessions().write().unwrap().insert(
        token.into(),
        SessionContext::new(
            user_id.into(),
            role_id.into(),
            "terminal-1".into(),
            store_id.into(),
            "instance-1".into(),
            "pos".into(),
            None,
            0,
        ),
    );
    state
}

#[tokio::test]
async fn scoped_report_rejects_invalid_session() {
    let state = TestBridge::new();
    let result =
        resolve_report_scope(&state.ctx(), "missing-token", permissions::REPORTS_VIEW).await;
    assert!(matches!(result, Err(BridgeError::InvalidSession)));
}

#[tokio::test]
async fn scoped_report_denies_user_without_reports_permission() {
    let conn = oz_core::migrations::fresh_db();
    let store = Store::new(&conn);
    store.seed_default_roles().unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-custom', 'custom', 'hash', 'Custom', 'role-custom', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
        [],
    )
    .unwrap();

    let state = scoped_state(conn, "custom-token", "user-custom", "role-owner", "store-1");
    let result =
        resolve_report_scope(&state.ctx(), "custom-token", permissions::REPORTS_VIEW).await;
    assert!(matches!(result, Err(BridgeError::PermissionDenied(_))));
}

#[test]
fn top_product_limit_accepts_bounded_values() {
    assert!(validate_top_product_limit(1).is_ok());
    assert!(validate_top_product_limit(MAX_TOP_PRODUCTS).is_ok());
}

#[test]
fn top_product_limit_rejects_unbounded_values() {
    for limit in [0, -1, MAX_TOP_PRODUCTS + 1, i64::MAX] {
        assert!(validate_top_product_limit(limit).is_err());
    }
}

#[test]
fn top_product_order_accepts_revenue_and_profit() {
    assert!(validate_top_product_order("revenue").is_ok());
    assert!(validate_top_product_order("profit").is_ok());
}

#[test]
fn top_product_order_rejects_unknown_values() {
    for bad in ["", "quantity", "margin", "revenue DESC"] {
        assert!(validate_top_product_order(bad).is_err());
    }
}

// ── validate_category_top ──────────────────────────────────────────

#[test]
fn category_top_accepts_bounded_values() {
    assert!(validate_category_top(1).is_ok());
    assert!(validate_category_top(MAX_CATEGORY_TOP).is_ok());
}

#[test]
fn category_top_rejects_unbounded_values() {
    for val in [0, -1, MAX_CATEGORY_TOP + 1] {
        assert!(validate_category_top(val).is_err());
    }
}

// ── validate_trend_args ────────────────────────────────────────────

#[test]
fn trend_args_accepts_valid_granularity_and_top() {
    for g in oz_core::db::popularity::TREND_GRANULARITIES {
        assert!(validate_trend_args(g, 1).is_ok());
        assert!(validate_trend_args(g, MAX_TREND_CATEGORIES).is_ok());
    }
}

#[test]
fn trend_args_rejects_invalid_granularity() {
    assert!(validate_trend_args("invalid", 5).is_err());
    assert!(validate_trend_args("", 5).is_err());
}

#[test]
fn trend_args_rejects_unbounded_top_categories() {
    for val in [0, -1, MAX_TREND_CATEGORIES + 1] {
        assert!(validate_trend_args("daily", val).is_err());
    }
}

// ── resolve_report_scope edge cases ────────────────────────────────

#[tokio::test]
async fn scoped_report_rejects_empty_token() {
    let state = TestBridge::new();
    let result = resolve_report_scope(&state.ctx(), "", permissions::REPORTS_VIEW).await;
    assert!(matches!(result, Err(BridgeError::InvalidSession)));
}

#[tokio::test]
async fn scoped_report_returns_conn_for_valid_session() {
    let conn = oz_core::migrations::fresh_db();
    let store = Store::new(&conn);
    store.seed_default_roles().unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-rpt', 'rpt', 'hash', 'Reporter', 'role-owner', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
        [],
    )
    .unwrap();

    let state = scoped_state(conn, "rpt-token", "user-rpt", "role-owner", "store-1");
    let result = resolve_report_scope(&state.ctx(), "rpt-token", permissions::REPORTS_VIEW).await;
    assert!(result.is_ok(), "valid session should resolve scope");
}

// ── Helpers ───────────────────────────────────────────────────────

fn seed_owner(conn: &rusqlite::Connection) {
    let store = Store::new(conn);
    store.seed_default_roles().unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-owner', 'owner', 'hash', 'Owner', 'role-owner', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
        [],
    )
    .unwrap();
}

fn seed_staff(conn: &rusqlite::Connection) {
    let store = Store::new(conn);
    store.seed_default_roles().unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-staff', 'staff', 'hash', 'Staff', 'role-staff', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
        [],
    )
    .unwrap();
}

// ── Session validation for scoped report commands ─────────────────

#[tokio::test]
async fn daily_revenue_scoped_rejects_invalid_token() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    let state = scoped_state(conn, "tok", "user-owner", "role-owner", "s1");
    let result =
        get_daily_revenue_scoped(&state.ctx(), "bad-token", "2026-01-01", "2026-01-31").await;
    assert!(matches!(result, Err(BridgeError::InvalidSession)));
}

#[tokio::test]
async fn weekly_revenue_scoped_rejects_invalid_token() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    let state = scoped_state(conn, "tok", "user-owner", "role-owner", "s1");
    let result =
        get_weekly_revenue_scoped(&state.ctx(), "bad-token", "2026-01-01", "2026-01-31").await;
    assert!(matches!(result, Err(BridgeError::InvalidSession)));
}

#[tokio::test]
async fn monthly_revenue_scoped_rejects_invalid_token() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    let state = scoped_state(conn, "tok", "user-owner", "role-owner", "s1");
    let result =
        get_monthly_revenue_scoped(&state.ctx(), "bad-token", "2026-01-01", "2026-12-31").await;
    assert!(matches!(result, Err(BridgeError::InvalidSession)));
}

// ── Staff permission denial tests (staff has no REPORTS_VIEW) ─────

#[tokio::test]
async fn staff_denied_daily_revenue() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    seed_staff(&conn);
    let state = scoped_state(conn, "tok", "user-staff", "role-staff", "s1");
    let result = get_daily_revenue_scoped(&state.ctx(), "tok", "2026-01-01", "2026-01-31").await;
    assert!(matches!(result, Err(BridgeError::PermissionDenied(_))));
}

#[tokio::test]
async fn staff_denied_weekly_revenue() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    seed_staff(&conn);
    let state = scoped_state(conn, "tok", "user-staff", "role-staff", "s1");
    let result = get_weekly_revenue_scoped(&state.ctx(), "tok", "2026-01-01", "2026-01-31").await;
    assert!(matches!(result, Err(BridgeError::PermissionDenied(_))));
}

#[tokio::test]
async fn staff_denied_monthly_revenue() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    seed_staff(&conn);
    let state = scoped_state(conn, "tok", "user-staff", "role-staff", "s1");
    let result = get_monthly_revenue_scoped(&state.ctx(), "tok", "2026-01-01", "2026-12-31").await;
    assert!(matches!(result, Err(BridgeError::PermissionDenied(_))));
}

#[tokio::test]
async fn staff_denied_top_products() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    seed_staff(&conn);
    let state = scoped_state(conn, "tok", "user-staff", "role-staff", "s1");
    let result = get_top_products_scoped(
        &state.ctx(),
        "tok",
        "2026-01-01",
        "2026-01-31",
        10,
        "revenue",
    )
    .await;
    assert!(matches!(result, Err(BridgeError::PermissionDenied(_))));
}

#[tokio::test]
async fn staff_denied_low_stock_alerts() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    seed_staff(&conn);
    let state = scoped_state(conn, "tok", "user-staff", "role-staff", "s1");
    let result = get_low_stock_alerts_scoped(&state.ctx(), "tok", 5).await;
    assert!(matches!(result, Err(BridgeError::PermissionDenied(_))));
}

#[tokio::test]
async fn staff_denied_category_breakdown() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    seed_staff(&conn);
    let state = scoped_state(conn, "tok", "user-staff", "role-staff", "s1");
    let result =
        get_category_breakdown_scoped(&state.ctx(), "tok", "2026-01-01", "2026-01-31").await;
    assert!(matches!(result, Err(BridgeError::PermissionDenied(_))));
}

#[tokio::test]
async fn staff_denied_payment_method_breakdown() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    seed_staff(&conn);
    let state = scoped_state(conn, "tok", "user-staff", "role-staff", "s1");
    let result =
        get_payment_method_breakdown_scoped(&state.ctx(), "tok", "2026-01-01", "2026-01-31").await;
    assert!(matches!(result, Err(BridgeError::PermissionDenied(_))));
}

#[tokio::test]
async fn staff_denied_voided_sales_summary() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    seed_staff(&conn);
    let state = scoped_state(conn, "tok", "user-staff", "role-staff", "s1");
    let result =
        get_voided_sales_summary_scoped(&state.ctx(), "tok", "2026-01-01", "2026-01-31").await;
    assert!(matches!(result, Err(BridgeError::PermissionDenied(_))));
}

#[tokio::test]
async fn staff_denied_basket_size() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    seed_staff(&conn);
    let state = scoped_state(conn, "tok", "user-staff", "role-staff", "s1");
    let result = get_basket_size_scoped(&state.ctx(), "tok", "2026-01-01", "2026-01-31").await;
    assert!(matches!(result, Err(BridgeError::PermissionDenied(_))));
}

#[tokio::test]
async fn staff_denied_discounts_summary() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    seed_staff(&conn);
    let state = scoped_state(conn, "tok", "user-staff", "role-staff", "s1");
    let result =
        get_discounts_summary_scoped(&state.ctx(), "tok", "2026-01-01", "2026-01-31").await;
    assert!(matches!(result, Err(BridgeError::PermissionDenied(_))));
}

#[tokio::test]
async fn staff_denied_inventory_turnover() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    seed_staff(&conn);
    let state = scoped_state(conn, "tok", "user-staff", "role-staff", "s1");
    let result = get_inventory_turnover_scoped(
        &state.ctx(),
        "tok",
        "2026-01-01",
        "2026-01-31",
        "loc-default",
    )
    .await;
    assert!(matches!(result, Err(BridgeError::PermissionDenied(_))));
}

#[tokio::test]
async fn staff_denied_table_turnover() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    seed_staff(&conn);
    let state = scoped_state(conn, "tok", "user-staff", "role-staff", "s1");
    let result = get_table_turnover_scoped(&state.ctx(), "tok", "2026-01-01", "2026-01-31").await;
    assert!(matches!(result, Err(BridgeError::PermissionDenied(_))));
}

#[tokio::test]
async fn staff_denied_customer_split() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    seed_staff(&conn);
    let state = scoped_state(conn, "tok", "user-staff", "role-staff", "s1");
    let result = get_customer_split_scoped(&state.ctx(), "tok", "2026-01-01", "2026-01-31").await;
    assert!(matches!(result, Err(BridgeError::PermissionDenied(_))));
}

// ── Owner empty-data reports (no sales → empty results) ──────────

#[tokio::test]
async fn owner_daily_revenue_empty_when_no_sales() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    let state = scoped_state(conn, "tok", "user-owner", "role-owner", "s1");
    let result = get_daily_revenue_scoped(&state.ctx(), "tok", "2026-01-01", "2026-01-31").await;
    assert!(result.is_ok(), "owner should access daily revenue");
}

#[tokio::test]
async fn owner_top_products_empty_when_no_sales() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    let state = scoped_state(conn, "tok", "user-owner", "role-owner", "s1");
    let result = get_top_products_scoped(
        &state.ctx(),
        "tok",
        "2026-01-01",
        "2026-01-31",
        10,
        "revenue",
    )
    .await;
    assert!(result.is_ok(), "owner should access top products");
}

#[tokio::test]
async fn owner_low_stock_alerts_empty_when_no_products() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    let state = scoped_state(conn, "tok", "user-owner", "role-owner", "s1");
    let result = get_low_stock_alerts_scoped(&state.ctx(), "tok", 5).await;
    assert!(result.is_ok(), "owner should access low stock alerts");
    assert!(result.unwrap().is_empty());
}

#[tokio::test]
async fn owner_category_breakdown_empty_when_no_sales() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    let state = scoped_state(conn, "tok", "user-owner", "role-owner", "s1");
    let result =
        get_category_breakdown_scoped(&state.ctx(), "tok", "2026-01-01", "2026-01-31").await;
    assert!(result.is_ok(), "owner should access category breakdown");
}

#[tokio::test]
async fn owner_weekly_revenue_empty_when_no_sales() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    let state = scoped_state(conn, "tok", "user-owner", "role-owner", "s1");
    let result = get_weekly_revenue_scoped(&state.ctx(), "tok", "2026-01-01", "2026-01-31").await;
    assert!(result.is_ok(), "owner should access weekly revenue");
}

#[tokio::test]
async fn owner_monthly_revenue_empty_when_no_sales() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    let state = scoped_state(conn, "tok", "user-owner", "role-owner", "s1");
    let result = get_monthly_revenue_scoped(&state.ctx(), "tok", "2026-01-01", "2026-12-31").await;
    assert!(result.is_ok(), "owner should access monthly revenue");
}

#[tokio::test]
async fn owner_payment_method_breakdown_empty() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    let state = scoped_state(conn, "tok", "user-owner", "role-owner", "s1");
    let result =
        get_payment_method_breakdown_scoped(&state.ctx(), "tok", "2026-01-01", "2026-01-31").await;
    assert!(
        result.is_ok(),
        "owner should access payment method breakdown"
    );
}

#[tokio::test]
async fn owner_voided_sales_summary_empty() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    let state = scoped_state(conn, "tok", "user-owner", "role-owner", "s1");
    let result =
        get_voided_sales_summary_scoped(&state.ctx(), "tok", "2026-01-01", "2026-01-31").await;
    assert!(result.is_ok(), "owner should access voided sales summary");
}

#[tokio::test]
async fn owner_basket_size_empty() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    let state = scoped_state(conn, "tok", "user-owner", "role-owner", "s1");
    let result = get_basket_size_scoped(&state.ctx(), "tok", "2026-01-01", "2026-01-31").await;
    assert!(result.is_ok(), "owner should access basket size");
}

#[tokio::test]
async fn owner_discounts_summary_empty() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    let state = scoped_state(conn, "tok", "user-owner", "role-owner", "s1");
    let result =
        get_discounts_summary_scoped(&state.ctx(), "tok", "2026-01-01", "2026-01-31").await;
    assert!(result.is_ok(), "owner should access discounts summary");
}

#[tokio::test]
async fn owner_inventory_turnover_empty() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    let state = scoped_state(conn, "tok", "user-owner", "role-owner", "s1");
    let result = get_inventory_turnover_scoped(
        &state.ctx(),
        "tok",
        "2026-01-01",
        "2026-01-31",
        "loc-default",
    )
    .await;
    assert!(result.is_ok(), "owner should access inventory turnover");
}

#[tokio::test]
async fn owner_table_turnover_empty() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    let state = scoped_state(conn, "tok", "user-owner", "role-owner", "s1");
    let result = get_table_turnover_scoped(&state.ctx(), "tok", "2026-01-01", "2026-01-31").await;
    assert!(result.is_ok(), "owner should access table turnover");
}

#[tokio::test]
async fn owner_customer_split_empty() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    let state = scoped_state(conn, "tok", "user-owner", "role-owner", "s1");
    let result = get_customer_split_scoped(&state.ctx(), "tok", "2026-01-01", "2026-01-31").await;
    assert!(result.is_ok(), "owner should access customer split");
}
