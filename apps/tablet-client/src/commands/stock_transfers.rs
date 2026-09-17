//! Stock transfer Tauri commands (tablet).
//!
//! ADR #49: the bodies are the bridge's. All ten doors are thin shims over
//! `kasirmu_bridge::stock_transfers` — the gate, the store construction, the
//! validation order and the error mapping live there now, and this shell keeps
//! only its `#[tauri::command]` signatures so the wire never moves.
//!
//! **Why this module ported whole, in one pass.** None of the ten doors is on
//! this shell's registration-gate debt ledger. Each resolves a session and gates
//! through the domain helper `require_inventory_permission`, which the sweep's
//! classifier reads as a gate (`classifier_reads_a_domain_permission_helper_as_a_gate_and_its_absence_as_debt`),
//! so the sweep already calls them `Gated` — the delegation is ledger-neutral by
//! construction rather than by measurement, and the ratchet confirms it either
//! way.
//!
//! **And why the gate kind had to be compared anyway.** The gate is the
//! **unscoped** `Store::require_permission(user_id, inventory:transfer)` on both
//! sides: `crates/kasirmu-bridge/src/stock_transfers.rs:73-82` documents its helper as
//! a verbatim port of the one that stood here, "same non-scope-aware
//! `require_permission`, so a legacy user without an assignment row keeps behaving
//! exactly as before". Had the bridge's twin used the scope-aware form instead,
//! this port would have *tightened* a gate and been refused — §4 pins the gate's
//! kind, not just its permission name.
//!
//! There is no `run_*` seam to keep: the transfer bodies were logic-inline, so the
//! store work stays inside the bridge's scoped functions (its module doc says so)
//! and this shell has nothing left to test but the DTOs, which are the bridge's.

use tauri::{State, command};

use kasirmu_core::stock_transfer::{StockTransfer, StockTransferLine};

use crate::error::AppError;
use crate::state::AppState;

// ADR #49: both DTOs are the bridge's, re-exported rather than restated. The two
// definitions were byte-identical — same two fields each, same doc comments, and
// **no `rename_all` on either side**, so the wire stays snake_case and the
// renderer sees no change. `stock_transfers_tests.rs` reaches both through
// `use super::*`, which is why they are re-exported here rather than dropped.
pub use kasirmu_bridge::stock_transfers::{ReceivedLineInput, TransferWithLines};

// ── Session-scoped commands (ADR #7) ─────────────────────────────────

/// Create a stock transfer in the store resolved from the session token.
///
/// ADR #49: the body is the bridge's; the signature is this shell's, which is why
/// the `Option<String>` locations arrive as `.as_deref()` and the `Vec` lines as a
/// slice.
#[command]
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
///
/// ADR #49: the body is the bridge's.
#[command]
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
///
/// ADR #49: the body is the bridge's.
#[command]
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
/// ADR #49: the body is the bridge's. The single-round-trip shape the transit
/// audit screen depends on — two SQL queries rather than one per transfer — is
/// the bridge's `list_transfers_with_lines_by_status` call, unchanged.
#[command]
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
///
/// ADR #49: the body is the bridge's.
#[command]
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
///
/// ADR #49: the body is the bridge's.
#[command]
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
///
/// ADR #49: the body is the bridge's.
#[command]
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
///
/// ADR #49: the body is the bridge's.
#[command]
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
///
/// ADR #49: the body is the bridge's. The `Vec<ReceivedLineInput>` → `ReceivedLine`
/// mapping that stood here — `into_iter` on this side, `iter` with a `clone` on the
/// bridge's — is the same mapping, so the actor attribution is unchanged.
#[command]
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
///
/// ADR #49: the body is the bridge's.
#[command]
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

#[cfg(test)]
#[path = "stock_transfers_tests.rs"]
mod tests;
