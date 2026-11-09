//! Tauri commands for Accounts Receivable (Piutang / Jual Tempo / Kasbon — Phase 3 of
//! `docs/plans/_done/done-payment-methods-plan.md`) — tablet shell twin.

pub use kasirmu_bridge::receivables::{
    CreateReceivableArgs, CustomerReceivablesSummaryDto, MoneyDto, ReceivableDto,
    RecordReceivablePaymentArgs,
};
use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

/// List receivables. Requires `receivables:view`.
#[tauri::command]
pub async fn list_receivables_scoped(
    status: Option<String>,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<ReceivableDto>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::receivables::list_receivables_scoped(&ctx, status, &session_token)
        .await
        .map_err(Into::into)
}

/// List receivables for a single customer. Requires `receivables:view`.
#[tauri::command]
pub async fn list_customer_receivables_scoped(
    customer_id: String,
    status: Option<String>,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<ReceivableDto>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::receivables::list_customer_receivables_scoped(
        &ctx,
        &customer_id,
        status,
        &session_token,
    )
    .await
    .map_err(Into::into)
}

/// Fetch one receivable by ID. Requires `receivables:view`.
#[tauri::command]
pub async fn get_receivable_scoped(
    receivable_id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Option<ReceivableDto>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::receivables::get_receivable_scoped(&ctx, &receivable_id, &session_token)
        .await
        .map_err(Into::into)
}

/// Get a customer's total outstanding debt summary. Requires `receivables:view`.
#[tauri::command]
pub async fn get_customer_receivables_summary_scoped(
    customer_id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<CustomerReceivablesSummaryDto, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::receivables::get_customer_receivables_summary_scoped(
        &ctx,
        &customer_id,
        &session_token,
    )
    .await
    .map_err(Into::into)
}

/// Raise a receivable (extend credit to a customer). Requires `receivables:create`.
#[tauri::command]
pub async fn create_receivable_scoped(
    args: CreateReceivableArgs,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<ReceivableDto, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::receivables::create_receivable_scoped(&ctx, args, &session_token)
        .await
        .map_err(Into::into)
}

/// Record a payment collected toward a receivable. Requires `receivables:collect`.
#[tauri::command]
pub async fn record_receivable_payment_scoped(
    args: RecordReceivablePaymentArgs,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<ReceivableDto, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::receivables::record_receivable_payment_scoped(&ctx, args, &session_token)
        .await
        .map_err(Into::into)
}

/// Forgive an uncollectible customer debt. Requires `receivables:writeoff`.
#[tauri::command]
pub async fn write_off_receivable_scoped(
    receivable_id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<ReceivableDto, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::receivables::write_off_receivable_scoped(&ctx, &receivable_id, &session_token)
        .await
        .map_err(Into::into)
}

/// Generate the accounts receivable aging report. Requires `receivables:view`.
#[tauri::command]
pub async fn get_ar_aging_report_scoped(
    as_of_date: Option<String>,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<kasirmu_core::receivable::ReceivableAgingReport, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::receivables::get_ar_aging_report_scoped(&ctx, as_of_date, &session_token)
        .await
        .map_err(Into::into)
}
