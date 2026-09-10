//! Refund commands — process refund against a completed sale.
//!
//! Wave D / D4a: the bodies now live in the headless `oz_bridge::refunds`
//! module. Each `#[tauri::command]` below keeps its exact name, parameter
//! list, attributes and `Result<_, AppError>` wire contract; it builds a
//! `BridgeCtx` from `AppState` and delegates, preserving gate order and
//! the strict no-currency-fallback refund arithmetic. The DTOs moved with
//! the bodies and are re-exported so `use super::*` in
//! `refunds_tests.rs` still resolves them.

use tauri::State;

#[allow(unused_imports)] // sibling *_tests.rs depends on it
use oz_core::db::Store;
#[allow(unused_imports)] // sibling *_tests.rs depends on it
use oz_core::{Money, RefundLine};

use oz_core::{Refund, Sale};

use crate::error::AppError;
use crate::state::AppState;

pub use oz_bridge::refunds::{
    ProcessRefundArgs, ProcessRefundResult, ProcessRefundScopedArgs, RefundLineArg,
};

/// Process a refund within the store resolved from a session token.
///
/// ADR #7: Scoped variant of `process_refund`. The `user_id` for
/// permission checks and the refund record is read from the resolved
/// `SessionContext`.
#[tauri::command]
pub async fn process_refund_scoped(
    session_token: String,
    args: ProcessRefundScopedArgs,
    state: State<'_, AppState>,
) -> Result<ProcessRefundResult, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::refunds::process_refund_scoped(&ctx, &session_token, &args)
        .await
        .map_err(Into::into)
}

/// Process an already-authorized refund against a store-scoped database.
/// Scoped commands authorize the session against the global identity DB
/// before opening the store connection, then call this business path.
#[allow(dead_code)]
fn run_process_refund_unchecked(
    db: &rusqlite::Connection,
    sale_id: &str,
    reason: &str,
    note: Option<&str>,
    user_id: &str,
    lines: &[RefundLineArg],
) -> Result<ProcessRefundResult, AppError> {
    oz_bridge::refunds::process_refund_unchecked(db, sale_id, reason, note, user_id, lines)
        .map_err(AppError::from)
}

/// Look up a sale by receipt barcode from the store resolved from a session token.
///
/// ADR #7: Scoped variant of `lookup_sale_by_receipt_barcode`.
///
/// Requires `SALES_PROCESS` permission.
#[tauri::command]
pub async fn lookup_sale_by_receipt_barcode_scoped(
    session_token: String,
    barcode: String,
    state: State<'_, AppState>,
) -> Result<Option<Sale>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::refunds::lookup_sale_by_receipt_barcode_scoped(&ctx, &session_token, &barcode)
        .await
        .map_err(Into::into)
}

/// List all refunds for a sale from the store resolved from a session token.
///
/// ADR #7: Scoped variant of `list_refunds`.
///
/// Requires `SALES_PROCESS` permission.
#[tauri::command]
pub async fn list_refunds_scoped(
    session_token: String,
    sale_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<Refund>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::refunds::list_refunds_scoped(&ctx, &session_token, &sale_id)
        .await
        .map_err(Into::into)
}

