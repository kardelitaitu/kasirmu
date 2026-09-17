//! Stock transfer Tauri commands.
//!
//! Exposes CRUD + send/receive lifecycle operations to the front-end.
//!
//! Wave C / C3: the bodies now live in the headless
//! `kasirmu_bridge::stock_transfers` module. Each `#[tauri::command]` below
//! keeps its exact name, parameter list, attributes and `Result<_, AppError>`
//! wire contract; it builds a `BridgeCtx` from `AppState` and delegates.
//! The global-identity gate (`inventory:transfer`) and the store-local
//! location/terminal validation run inside the bridge, in the same order as
//! before. The DTOs moved with the bodies and are re-exported so
//! `use super::*` in `stock_transfers_tests.rs` still resolves them.

use tauri::State;

use oz_core::stock_transfer::{StockTransfer, StockTransferLine};

// Retained for the sibling test module, which reaches these through its
// glob import of this module; the command bodies no longer name them.
#[allow(unused_imports)]
use oz_core::db::Store;

use crate::error::AppError;
use crate::state::AppState;

pub use kasirmu_bridge::stock_transfers::{ReceivedLineInput, TransferWithLines};

/// Create a stock transfer in the store resolved from the session token.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn create_stock_transfer_scoped(
    session_token: String,
    source_location: Option<String>,
    destination_location: Option<String>,
    source_terminal_id: Option<String>,
    destination_terminal_id: Option<String>,
    notes: String,
    lines: Vec<StockTransferLine>,
    state: State<'_, AppState>,
) -> Result<StockTransfer, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::stock_transfers::create_stock_transfer_scoped(
        &ctx,
        &session_token,
        source_location.as_deref(),
        destination_location.as_deref(),
        source_terminal_id.as_deref(),
        destination_terminal_id.as_deref(),
        &notes,
        &lines,
    )
    .await
    .map_err(Into::into)
}

/// Get a stock transfer from the session-scoped store.
#[tauri::command]
pub async fn get_stock_transfer_scoped(
    session_token: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<Option<TransferWithLines>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::stock_transfers::get_stock_transfer_scoped(&ctx, &session_token, &id)
        .await
        .map_err(Into::into)
}

/// List stock transfers from the session-scoped store.
#[tauri::command]
pub async fn list_stock_transfers_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<StockTransfer>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::stock_transfers::list_stock_transfers_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// List in-transit transfers with their line items in one batch request.
///
/// The transit audit screen previously listed all transfers and then fetched
/// lines one transfer at a time (N+1). This command returns the lines in two
/// SQL queries so the whole audit view loads in a single IPC round-trip.
///
/// The status filter is intentionally `in_transit` only: this mirrors the
/// legacy screen's behavior, and partially-received transfers (`received_partial`)
/// continue to be received on the StockTransfersScreen, not the transit audit.
#[tauri::command]
pub async fn list_in_transit_transfers_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<TransferWithLines>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::stock_transfers::list_in_transit_transfers_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Get transfer lines from the session-scoped store.
#[tauri::command]
pub async fn get_stock_transfer_lines_scoped(
    session_token: String,
    transfer_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<StockTransferLine>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::stock_transfers::get_stock_transfer_lines_scoped(&ctx, &session_token, &transfer_id)
        .await
        .map_err(Into::into)
}

/// Add a transfer line in the session-scoped store.
#[tauri::command]
pub async fn add_stock_transfer_line_scoped(
    session_token: String,
    transfer_id: String,
    sku: String,
    product_name: String,
    qty: i64,
    state: State<'_, AppState>,
) -> Result<StockTransferLine, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::stock_transfers::add_stock_transfer_line_scoped(
        &ctx,
        &session_token,
        &transfer_id,
        &sku,
        &product_name,
        qty,
    )
    .await
    .map_err(Into::into)
}

/// Remove a transfer line in the session-scoped store.
#[tauri::command]
pub async fn remove_stock_transfer_line_scoped(
    session_token: String,
    line_id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::stock_transfers::remove_stock_transfer_line_scoped(&ctx, &session_token, &line_id)
        .await
        .map_err(Into::into)
}

/// Send a transfer in the session-scoped store.
#[tauri::command]
pub async fn send_stock_transfer_scoped(
    session_token: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<StockTransfer, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::stock_transfers::send_stock_transfer_scoped(&ctx, &session_token, &id)
        .await
        .map_err(Into::into)
}

/// Receive a transfer, attributing the actor to the authenticated session.
#[tauri::command]
pub async fn receive_stock_transfer_scoped(
    session_token: String,
    id: String,
    received_lines: Vec<ReceivedLineInput>,
    state: State<'_, AppState>,
) -> Result<StockTransfer, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::stock_transfers::receive_stock_transfer_scoped(
        &ctx,
        &session_token,
        &id,
        &received_lines,
    )
    .await
    .map_err(Into::into)
}

/// Cancel a transfer in the session-scoped store.
#[tauri::command]
pub async fn cancel_stock_transfer_scoped(
    session_token: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<StockTransfer, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::stock_transfers::cancel_stock_transfer_scoped(&ctx, &session_token, &id)
        .await
        .map_err(Into::into)
}
