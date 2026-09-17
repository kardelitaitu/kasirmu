//! Void sale command — void a completed sale and restore stock.
//!
//! Delegates to `Store::void_sale` which handles the status transition,
//! stock restoration, and audit logging inside a single transaction.
//!
//! Wave D / D4a: the body now lives in the headless `kasirmu_bridge::void`
//! module. The `#[tauri::command]` below keeps its exact name, parameter
//! list, attributes and `Result<_, AppError>` wire contract; it builds a
//! `BridgeCtx` from `AppState` and delegates. The args DTOs moved with
//! the body and are re-exported so `use super::*` in `void_tests.rs`
//! still resolves them.

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

pub use kasirmu_bridge::void::{VoidSaleArgs, VoidSaleScopedArgs};

/// Void a sale within the store resolved from a session token.
///
/// ADR #7: Scoped variant of `void_sale`. The `user_id` for permission
/// checks and the void operation is read from the resolved `SessionContext`.
#[tauri::command]
pub async fn void_sale_scoped(
    session_token: String,
    args: VoidSaleScopedArgs,
    state: State<'_, AppState>,
) -> Result<oz_core::Sale, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::void::void_sale_scoped(&ctx, &session_token, &args)
        .await
        .map_err(Into::into)
}
