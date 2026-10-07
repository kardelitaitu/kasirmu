//! EDC payment terminal commands (mobile shell).
//!
//! Card-present payment processing and terminal management.
//! Delegates directly to `kasirmu_bridge::edc`.

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

pub use kasirmu_bridge::edc::{
    CreateEdcTerminalArgs, DEFAULT_TERMINAL_ID, EdcResultDto, EdcSettlementDto, EdcStatusDto,
    EdcTerminalDto, UpdateEdcTerminalArgs,
};

/// Query the EDC terminal's current status (scoped).
#[tauri::command]
pub async fn edc_terminal_status_scoped(
    session_token: String,
    state: State<'_, AppState>,
    terminal_id: Option<String>,
) -> Result<EdcStatusDto, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::edc::edc_terminal_status_scoped(&ctx, &session_token, terminal_id.as_deref())
        .await
        .map_err(Into::into)
}

/// Process a card-present sale (authorize + capture in one call).
#[tauri::command]
pub async fn edc_sale(
    session_token: String,
    state: State<'_, AppState>,
    amount_minor: i64,
    currency: String,
    terminal_id: Option<String>,
    reference: Option<String>,
) -> Result<EdcResultDto, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::edc::edc_sale(
        &ctx,
        &session_token,
        amount_minor,
        &currency,
        terminal_id.as_deref(),
        reference.as_deref(),
    )
    .await
    .map_err(Into::into)
}

/// Refund a previous card-present transaction.
#[tauri::command]
pub async fn edc_refund(
    session_token: String,
    state: State<'_, AppState>,
    transaction_id: String,
    amount_minor: i64,
    currency: String,
    terminal_id: Option<String>,
) -> Result<EdcResultDto, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::edc::edc_refund(
        &ctx,
        &session_token,
        &transaction_id,
        amount_minor,
        &currency,
        terminal_id.as_deref(),
    )
    .await
    .map_err(Into::into)
}

/// Void an unsettled card-present transaction.
#[tauri::command]
pub async fn edc_void(
    session_token: String,
    state: State<'_, AppState>,
    transaction_id: String,
    terminal_id: Option<String>,
) -> Result<EdcResultDto, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::edc::edc_void(
        &ctx,
        &session_token,
        &transaction_id,
        terminal_id.as_deref(),
    )
    .await
    .map_err(Into::into)
}

/// Perform batch settlement on the EDC terminal.
#[tauri::command]
pub async fn edc_settle(
    session_token: String,
    state: State<'_, AppState>,
    terminal_id: Option<String>,
) -> Result<EdcSettlementDto, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::edc::edc_settle(&ctx, &session_token, terminal_id.as_deref())
        .await
        .map_err(Into::into)
}

/// Query or reconcile transaction status by invoice reference.
#[tauri::command]
pub async fn edc_inquiry(
    session_token: String,
    state: State<'_, AppState>,
    invoice: String,
    terminal_id: Option<String>,
) -> Result<EdcResultDto, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::edc::edc_inquiry(&ctx, &session_token, &invoice, terminal_id.as_deref())
        .await
        .map_err(Into::into)
}

/// List all EDC terminals for the active store (scoped - ADR #7).
#[tauri::command]
pub async fn list_edc_terminals_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<EdcTerminalDto>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::edc::list_edc_terminals_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Register a new EDC terminal for the active store (scoped - ADR #7).
#[tauri::command]
pub async fn create_edc_terminal_scoped(
    session_token: String,
    args: CreateEdcTerminalArgs,
    state: State<'_, AppState>,
) -> Result<EdcTerminalDto, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::edc::create_edc_terminal_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

/// Update an existing EDC terminal configuration (scoped - ADR #7).
#[tauri::command]
pub async fn update_edc_terminal_scoped(
    session_token: String,
    args: UpdateEdcTerminalArgs,
    state: State<'_, AppState>,
) -> Result<EdcTerminalDto, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::edc::update_edc_terminal_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

/// Soft-delete (deactivate) an EDC terminal (scoped - ADR #7).
#[tauri::command]
pub async fn delete_edc_terminal_scoped(
    session_token: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::edc::delete_edc_terminal_scoped(&ctx, &session_token, &id)
        .await
        .map_err(Into::into)
}
