//! Shift management Tauri commands (mobile shell).
//!
//! Open/close cashier shifts with cash balance reconciliation.
//! Delegates directly to `kasirmu_bridge::shifts`.
//!
//! Key functions:
//! - `open_shift_scoped`: Open a new cashier shift with opening balance.
//! - `close_shift_scoped`: Close active shift and compute cash differences.
//! - `get_active_shift_scoped`: Query active shift for current cashier.
//! - `list_shifts_scoped`: List store shifts history.
//! - `get_shift_scoped`: Fetch detailed shift information by ID.
//! - `create_cash_payout_scoped`: Record cash payout during active shift.
//! - `get_shift_report_scoped`: Generate summary report for shift.

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

pub use kasirmu_bridge::shifts::{
    CashPayoutDto, CloseShiftArgs, CloseShiftScopedArgs, CreateCashPayoutArgs, OpenShiftArgs,
    OpenShiftScopedArgs, ShiftDto, ShiftPaymentBreakdownDto, ShiftReportDto, ShiftSalesByHourDto,
};

/// Open a shift in the store resolved from a session token. ADR #7.
#[tauri::command]
pub async fn open_shift_scoped(
    session_token: String,
    args: OpenShiftScopedArgs,
    state: State<'_, AppState>,
) -> Result<ShiftDto, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::shifts::open_shift_scoped(&ctx, &session_token, &args)
        .await
        .map_err(Into::into)
}

/// Close a shift in the store resolved from a session token. ADR #7.
#[tauri::command]
pub async fn close_shift_scoped(
    session_token: String,
    args: CloseShiftScopedArgs,
    state: State<'_, AppState>,
) -> Result<ShiftDto, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::shifts::close_shift_scoped(&ctx, &session_token, &args)
        .await
        .map_err(Into::into)
}

/// Get the active shift for the session user from the store-scoped DB. ADR #7.
#[tauri::command]
pub async fn get_active_shift_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Option<ShiftDto>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::shifts::get_active_shift_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// List shifts for the store resolved from a session token. ADR #7.
#[tauri::command]
pub async fn list_shifts_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<ShiftDto>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::shifts::list_shifts_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Scoped variant of `get_shift` (ADR #7).
#[tauri::command]
pub async fn get_shift_scoped(
    id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Option<ShiftDto>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::shifts::get_shift_scoped(&ctx, &id, &session_token)
        .await
        .map_err(Into::into)
}

/// Scoped variant of `create_cash_payout` (ADR #7).
#[tauri::command]
pub async fn create_cash_payout_scoped(
    args: CreateCashPayoutArgs,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<CashPayoutDto, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::shifts::create_cash_payout_scoped(&ctx, &args, &session_token)
        .await
        .map_err(Into::into)
}

/// Scoped variant of `get_shift_report` (ADR #7).
#[tauri::command]
pub async fn get_shift_report_scoped(
    shift_id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<ShiftReportDto, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::shifts::get_shift_report_scoped(&ctx, &shift_id, &session_token)
        .await
        .map_err(Into::into)
}
