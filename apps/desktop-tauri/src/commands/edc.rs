/*
last audited 29-09-26 by Antigravity (multi-terminal routing + scoped CRUD)
crate: kasirmu-app | status: SAFE | lint: CLEAN
findings: added terminal_id parameter to payment and status commands for R4 multi-terminal routing, with backward-compatible None fallback to DEFAULT_TERMINAL_ID ("default"). Added scoped CRUD commands (list_edc_terminals_scoped, create_edc_terminal_scoped, update_edc_terminal_scoped, delete_edc_terminal_scoped) with dynamic DriverRegistry synchronization.
*/
//! EDC card-terminal commands.
//!
//! Wave D / D3b & R4 multi-terminal: the bodies live in the headless `kasirmu_bridge::edc` module.
//! Each `#[tauri::command]` below keeps its name, parameter list
//! and `Result<_, AppError>` return; it borrows a `BridgeCtx` from
//! `AppState`, calls the bridge, and maps `BridgeError` back to `AppError`
//! variant-for-variant.
//!
//! When multiple card terminals exist per store / register, commands route
//! explicitly via `terminal_id: Option<String>`. Omitted or null values fall
//! back to [`DEFAULT_TERMINAL_ID`](kasirmu_bridge::edc::DEFAULT_TERMINAL_ID) for
//! single-terminal stores. Linked to the bridge constant this module re-exports
//! (:24) rather than to the re-export itself: a module-level `//!` doc resolves
//! links in the ENCLOSING scope, so the bare label does not see the `pub use`
//! below it.

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

pub use kasirmu_bridge::edc::{
    CreateEdcTerminalArgs, DEFAULT_TERMINAL_ID, EdcResultDto, EdcStatusDto, EdcTerminalDto,
    UpdateEdcTerminalArgs,
};

/// Query the EDC terminal's current status.
#[tauri::command]
pub async fn edc_terminal_status(
    state: State<'_, AppState>,
    terminal_id: Option<String>,
) -> Result<EdcStatusDto, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::edc::edc_terminal_status(&ctx, terminal_id.as_deref())
        .await
        .map_err(Into::into)
}

/// Session-scoped variant of [`edc_terminal_status`].
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
///
/// `amount_minor` is in the currency's minor units (e.g. cents for USD,
/// rupiah for IDR). `currency` is an ISO-4217 code.
#[tauri::command]
pub async fn edc_sale(
    session_token: String,
    state: State<'_, AppState>,
    amount_minor: i64,
    currency: String,
    terminal_id: Option<String>,
) -> Result<EdcResultDto, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::edc::edc_sale(
        &ctx,
        &session_token,
        amount_minor,
        &currency,
        terminal_id.as_deref(),
    )
    .await
    .map_err(Into::into)
}

/// Refund a previously captured card transaction.
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

/// Void a pending authorisation before capture.
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

/// List configured card-payment terminals (session-scoped).
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

/// Create a new card-payment terminal (session-scoped).
#[tauri::command]
pub async fn create_edc_terminal_scoped(
    session_token: String,
    state: State<'_, AppState>,
    args: CreateEdcTerminalArgs,
) -> Result<EdcTerminalDto, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::edc::create_edc_terminal_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

/// Update an existing card-payment terminal (session-scoped).
#[tauri::command]
pub async fn update_edc_terminal_scoped(
    session_token: String,
    state: State<'_, AppState>,
    args: UpdateEdcTerminalArgs,
) -> Result<EdcTerminalDto, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::edc::update_edc_terminal_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

/// Delete a card-payment terminal (session-scoped).
#[tauri::command]
pub async fn delete_edc_terminal_scoped(
    session_token: String,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::edc::delete_edc_terminal_scoped(&ctx, &session_token, &id)
        .await
        .map_err(Into::into)
}

#[cfg(test)]
#[path = "edc_tests.rs"]
mod tests;
