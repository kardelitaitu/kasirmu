//! Void sale command — void a completed sale and restore stock.
//!
//! Delegates to `Store::void_sale` which handles the status transition,
//! stock restoration, and audit logging inside a single transaction.
//!
//! Phase 3.3 T2: the args DTOs moved to the shared `kasirmu_bridge::void`
//! module (Agent 2's Wave D extraction) and are re-exported here, same
//! as the desktop shell. The bodies stay tablet-native this slice: the
//! tablet `AppState` cannot yet build a full `BridgeCtx` (its `db` is a
//! bare tokio `Mutex<Connection>`, not `Arc`, and it has no cache /
//! plugins / emitter / topology_apply_lock fields), so the shims keep
//! the native `state.resolve_session` + `require_permission_for_user`
//! path until that seam exists.
//!
//! WIRE FIX riding this slice: the UI caller sends camelCase
//! (`args: { saleId, reason }` — ui/src/api/sales.ts voidSaleScoped);
//! the old local DTO was snake_case-only, so the tablet command could
//! not deserialize its own caller's payload. The bridge DTO carries
//! `#[serde(rename_all = "camelCase")]`, which is exactly the wire
//! shape the desktop twin already answers.

use tauri::{State, command};

use oz_core::permissions;

use crate::commands::authz::require_permission_for_user;
use crate::error::AppError;
use crate::state::AppState;

pub use kasirmu_bridge::void::{VoidSaleArgs, VoidSaleScopedArgs};

/// Void a completed sale within the session scope. ADR #7.
///
/// The `user_id` for permission checks and audit logging is read from
/// the resolved session context.
#[command]
pub async fn void_sale_scoped(
    session_token: String,
    args: VoidSaleScopedArgs,
    state: State<'_, AppState>,
) -> Result<oz_core::Sale, AppError> {
    let session = state.resolve_session(&session_token)?;

    let db = state.db.lock().await;
    let store = oz_core::db::Store::new(&db);

    require_permission_for_user(&store, &session.user_id, permissions::SALES_VOID)?;

    let sale = store.void_sale(&args.sale_id, &session.user_id, &args.reason)?;
    drop(db);

    tracing::info!(sale_id = %args.sale_id, reason = %args.reason, "sale voided (scoped)");
    Ok(sale)
}

#[cfg(test)]
#[path = "void_tests.rs"]
mod tests;
