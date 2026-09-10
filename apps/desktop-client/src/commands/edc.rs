/*
last audited 31-08-26 by DSH-Agent (EDC commands rewired onto the HAL registry)
crate: oz-pos-app | status: SAFE | lint: CLEAN
findings: previously read a hardcoded AppState field holding an armed MockEdcTerminal, so any operator with SALES_PROCESS could call edc_sale and receive success:true with a Visa last4 and an auth code while no card terminal existed — the response shape gave the caller no way to tell it was fake. Nothing in ui/ imports edcSale yet, so it was latent rather than live. Now resolves through the registry and fails closed with HalErrorKind::NotFound. The hand-rolled five-arm status match is gone: TerminalStatus derives Serialize with rename_all camelCase, so the wire labels are produced by the compiler and a new variant cannot silently fall through to an unhandled arm.
next: accept a terminal_id argument once more than one terminal can be configured | perf: N/A
*/
//! EDC card-terminal commands.
//!
//! Wave D / D3b: the bodies live in the headless `oz_bridge::edc` module.
//! Each `#[tauri::command]` below keeps its exact name, parameter list
//! and `Result<_, AppError>` return so the registered IPC surface and the
//! serialized error shape are unchanged; it borrows a `BridgeCtx` from
//! `AppState`, calls the bridge, and maps `BridgeError` back to `AppError`
//! variant-for-variant. The DTOs and `DEFAULT_TERMINAL_ID` moved with the
//! bodies and are re-exported so the sibling test module still resolves
//! them via the parent module.
//!
//! Card-present payment goes through whatever terminal the operator
//! configured; with no terminal registered every command fails closed with
//! `AppError::Hardware` (`HalErrorKind::NotFound`), exactly as before.

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

pub use oz_bridge::edc::{DEFAULT_TERMINAL_ID, EdcResultDto, EdcStatusDto};

/// Query the EDC terminal's current status.
#[tauri::command]
pub async fn edc_terminal_status(state: State<'_, AppState>) -> Result<EdcStatusDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::edc::edc_terminal_status(&ctx)
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
) -> Result<EdcResultDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::edc::edc_sale(&ctx, &session_token, amount_minor, &currency)
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
) -> Result<EdcResultDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::edc::edc_refund(
        &ctx,
        &session_token,
        &transaction_id,
        amount_minor,
        &currency,
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
) -> Result<EdcResultDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::edc::edc_void(&ctx, &session_token, &transaction_id)
        .await
        .map_err(Into::into)
}

/// Session-scoped variant of [`edc_terminal_status`].
#[tauri::command]
pub async fn edc_terminal_status_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<EdcStatusDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::edc::edc_terminal_status_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

#[cfg(test)]
#[path = "edc_tests.rs"]
mod tests;
