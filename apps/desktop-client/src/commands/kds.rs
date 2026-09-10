//! Kitchen Display System (KDS) commands.
//!
//! IPC surface for the kitchen order queue: list orders, update status,
//! create tickets from completed sales.
//!
//! All KDS commands require `kds:view` or `kds:update` permission.
//!
//! Bodies live in [`oz_bridge::kds`]; each shim borrows a [`BridgeCtx`] from
//! `AppState` and maps `BridgeError` back to `AppError` variant-for-variant so
//! the wire shape is untouched. The pure topology helpers and the chit printers
//! stay reachable from here (and from the sibling test mount) through `pub use`.

use std::sync::Arc;

use tauri::{Emitter, State};

use oz_core::KdsOrder;
use serde_json::Value;

use crate::error::AppError;
use crate::state::AppState;

#[allow(unused_imports)] // sibling kds_tests.rs depends on it
use crate::commands::topology::TOPOLOGY_RUNTIME_SETTING_KEY;
#[allow(unused_imports)] // sibling kds_tests.rs depends on it
use oz_core::db::Store;

use oz_bridge::ctx::EventSink;
pub use oz_bridge::kds::{
    KdsChitJob, build_kds_chit_jobs, resolve_runtime_kds_plan, runtime_kds_hardware_targets,
    runtime_kds_target_instances, should_create_kds_tickets, try_auto_print_kds_chit_jobs,
};

/// Sink view of a shell `AppHandle`, for the two retained helpers below.
///
/// Mirrors the private `TauriEventSink` in `commands/authz.rs`: the extracted
/// bodies emit through [`EventSink`], while these helpers keep their original
/// `Option<&AppHandle>` parameter because it is part of the shell API.
struct HandleSink(tauri::AppHandle);

impl EventSink for HandleSink {
    fn emit(&self, event: &'static str, payload: Value) {
        let _ = self.0.emit(event, payload);
    }
}

fn sink_for(app: Option<&tauri::AppHandle>) -> Option<Arc<dyn EventSink>> {
    app.map(|app| Arc::new(HandleSink(app.clone())) as Arc<dyn EventSink>)
}

/// List KDS orders for the store resolved from a session token. ADR #7.
#[tauri::command]
pub async fn list_kds_orders_scoped(
    session_token: String,
    status: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<KdsOrder>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::kds::list_kds_orders_scoped(&ctx, &session_token, status)
        .await
        .map_err(Into::into)
}

/// Get the kitchen queue for the store resolved from a session token. ADR #7.
#[tauri::command]
pub async fn get_kds_queue_scoped(
    session_token: String,
    kds_zone: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<KdsOrder>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::kds::get_kds_queue_scoped(&ctx, &session_token, kds_zone)
        .await
        .map_err(Into::into)
}

/// Update the items on a KDS order in the store resolved from a session token. ADR #7.
#[tauri::command]
pub async fn update_kds_order_items_scoped(
    session_token: String,
    args: oz_core::UpdateKdsOrderItemsInput,
    state: State<'_, AppState>,
) -> Result<KdsOrder, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::kds::update_kds_order_items_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

/// Update a KDS order's status in the store resolved from a session token. ADR #7.
#[tauri::command]
pub async fn update_kds_status_scoped(
    session_token: String,
    id: String,
    status: String,
    state: State<'_, AppState>,
) -> Result<KdsOrder, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::kds::update_kds_status_scoped(&ctx, &session_token, &id, &status)
        .await
        .map_err(Into::into)
}

/// Create KDS orders in the store resolved from a session token. ADR #7.
///
/// Passes the session's `store_id` so the KDS order carries store identity
/// for defense-in-depth filtering on KDS tablets (ADR #8). Returns one
/// KDS order per kitchen zone; an empty vec when no restaurant items exist.
#[tauri::command]
pub async fn create_kds_order_from_sale_scoped(
    session_token: String,
    sale_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<KdsOrder>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::kds::create_kds_order_from_sale_scoped(&ctx, &session_token, &sale_id)
        .await
        .map_err(Into::into)
}

/// Get a KDS order from the store resolved from a session token. ADR #7.
#[tauri::command]
pub async fn get_kds_order_scoped(
    session_token: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<Option<KdsOrder>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::kds::get_kds_order_scoped(&ctx, &session_token, &id)
        .await
        .map_err(Into::into)
}

/// Print a kitchen chit for a single KDS order.
///
/// Tries the "kitchen" printer first; falls back to the "default"
/// receipt printer. Silently skips when no printer is registered
/// (the kitchen may not have a dedicated printer).
///
/// Returns `true` when the chit was printed, `false` when skipped.
pub async fn print_kds_chit_for_order(
    order: &KdsOrder,
    registry: &oz_hal::DriverRegistry,
    app: Option<&tauri::AppHandle>,
) -> bool {
    let sink = sink_for(app);
    oz_bridge::kds::print_kds_chit_for_order(order, registry, sink.as_ref()).await
}

/// Print a kitchen chit for a specific KDS order by ID (scoped - ADR #7).
///
/// Useful for manual re-print from the KDS screen when a chit was lost
/// or damaged. Returns`true` if the chit was printed, `false` if the
/// order was not found or no printer was available.
#[tauri::command]
pub async fn print_kds_chit_scoped(
    session_token: String,
    order_id: String,
    state: State<'_, AppState>,
) -> Result<bool, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::kds::print_kds_chit_scoped(&ctx, &session_token, &order_id)
        .await
        .map_err(Into::into)
}

// ── KDS line items (TODO 2a) ────────────────────────────

/// Get all line items for a KDS order (scoped - ADR #7).
///
/// Returns structured line items with course and modifier data,
/// ordered by course priority then line position.
#[tauri::command]
pub async fn get_kds_order_lines_scoped(
    session_token: String,
    order_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<oz_core::KdsLineItem>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::kds::get_kds_order_lines_scoped(&ctx, &session_token, &order_id)
        .await
        .map_err(Into::into)
}

/// Update the status of a single KDS line item in the store resolved
/// from a session token. ADR #7.
///
/// Returns the updated line item with the new status and timestamp.
#[tauri::command]
pub async fn update_kds_line_item_status_scoped(
    session_token: String,
    item_id: String,
    status: String,
    state: State<'_, AppState>,
) -> Result<oz_core::KdsLineItem, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::kds::update_kds_line_item_status_scoped(&ctx, &session_token, &item_id, &status)
        .await
        .map_err(Into::into)
}

/// Try to print kitchen chits for every order in the slice.
///
/// Best-effort: logs failures but does not return errors.
/// Called automatically after KDS order creation.
///
/// Takes owned clones of registry and app so the caller can drop any
/// Tauri state borrows before the first `.await`.
pub async fn try_auto_print_kds_chits(
    orders: &[KdsOrder],
    registry: &oz_hal::DriverRegistry,
    app: Option<&tauri::AppHandle>,
) {
    let sink = sink_for(app);
    oz_bridge::kds::try_auto_print_kds_chits(orders, registry, sink.as_ref()).await;
}

#[cfg(test)]
#[path = "kds_tests.rs"]
mod tests;
