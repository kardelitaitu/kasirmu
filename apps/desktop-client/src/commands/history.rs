/*
last audited 25-07-26 by RSA-Agent (desktop-client slice C: pos head+sweep)
crate: desktop-client | status: SAFE | lint: CLEAN
findings: head 1-160 read + global sweep — all six Percentage::new unwraps preceded by explicit 0..=100 range checks with SAFETY comments (contains LUA-2 at consumer); ADR-20 PaymentKind marker; authz decorators present; cart/sale state machine lives in oz_core (audited). Coverage note: risk-ranked sampling, not full deep read
next: none | perf: N/A
*/
//! Sales history and report commands: list, get, export summaries.
//!
//! These commands provide read-only access to completed sales and
//! aggregate report data for the dashboard, history screens, and
//! end-of-day reporting.
//!
//! Carts are persisted in the SQLite `active_carts` table so they
//! survive application restarts.

// Wave F: the bodies moved to kasirmu_bridge::history. The DTOs are re-exported
// so the sibling history_tests.rs (which opens use super::*;) keeps
// resolving them from this module unchanged.
use oz_core::db::{DailySummaryRow, SalesByHourRow};
use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

pub use kasirmu_bridge::history::{
    EodReport, PaymentBreakdown, SaleDetail, SaleListItem, SaleListResponse,
};

/// List all sales for the store resolved from a session token.
///
/// ADR #7: Scoped variant of `list_sales`. The backend resolves the
/// opaque `session_token` to a `SessionContext`, opens the store-scoped
/// database, and returns only that store's completed sales.
#[tauri::command]
pub async fn list_sales_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<SaleListResponse, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::history::list_sales_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Fetch a single sale by ID from the store resolved from a session token.
///
/// ADR #7: Scoped variant of `get_sale`. The backend resolves the
/// session token to open the store-scoped database and looks up the
/// sale within that store only.
#[tauri::command]
pub async fn get_sale_scoped(
    session_token: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<Option<SaleDetail>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::history::get_sale_scoped(&ctx, &session_token, &id)
        .await
        .map_err(Into::into)
}

/// Fetch the daily sales summary for the store resolved from a session token.
///
/// ADR #7: Scoped variant of `export_daily_summary`.
#[tauri::command]
pub async fn export_daily_summary_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<DailySummaryRow>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::history::export_daily_summary_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Fetch sales-by-hour breakdown for the store resolved from a session token.
///
/// ADR #7: Scoped variant of `export_sales_by_hour`.
#[tauri::command]
pub async fn export_sales_by_hour_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<SalesByHourRow>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::history::export_sales_by_hour_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Fetch the full EOD report for the store resolved from a session token.
///
/// ADR #7: Scoped variant of `export_eod_report`. Opens the store-scoped
/// database and builds the report from that store's data only.
#[tauri::command]
pub async fn export_eod_report_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<EodReport, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::history::export_eod_report_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}
