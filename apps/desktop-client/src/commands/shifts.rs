//! Shift management Tauri commands.
//!
//! Open/close cashier shifts with cash balance reconciliation.
//!
//! Wave D / D4a: the bodies now live in the headless `oz_bridge::shifts`
//! module. Each `#[tauri::command]` below keeps its exact name, parameter
//! list, attributes and `Result<_, AppError>` wire contract; it builds a
//! `BridgeCtx` from `AppState` and delegates, preserving gate order and
//! the deliberate ungated `get_active_shift_scoped`. The DTOs moved with
//! the bodies and are re-exported so `use super::*` in
//! `shifts_tests.rs` still resolves them.

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

pub use oz_bridge::shifts::{
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
    oz_bridge::shifts::open_shift_scoped(&ctx, &session_token, &args)
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
    oz_bridge::shifts::close_shift_scoped(&ctx, &session_token, &args)
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
    oz_bridge::shifts::get_active_shift_scoped(&ctx, &session_token)
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
    oz_bridge::shifts::list_shifts_scoped(&ctx, &session_token)
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
    oz_bridge::shifts::get_shift_scoped(&ctx, &id, &session_token)
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
    oz_bridge::shifts::create_cash_payout_scoped(&ctx, &args, &session_token)
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
    oz_bridge::shifts::get_shift_report_scoped(&ctx, &shift_id, &session_token)
        .await
        .map_err(Into::into)
}

#[cfg(test)]
#[path = "shifts_tests.rs"]
mod tests;
