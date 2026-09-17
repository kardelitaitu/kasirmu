//! Purchasing commands: suppliers and purchase orders.
//!
//! Every body delegates to `kasirmu_bridge::purchasing` (ADR #49), and so do the
//! IPC DTOs: the eight structs and their three `From` impls are re-exported
//! from the bridge rather than defined twice, so the wire shape has exactly
//! one definition. All ten were checked field-for-field against the copies
//! this shell used to own before they were deleted.
//!
//! The gate is the **scope-aware** one (ADR #35 D5): `resolve_scope` resolves
//! the session *first*, then `require_permission_for_session` authorises it —
//! so a denied request has still opened the session's store connection. The
//! bridge's `ctx.require_session_permission` is the same check, in the same
//! order. The `validate_not_empty` bound checks stay **ahead of** the gate
//! exactly where they were, on both the create and the update paths.

use tauri::{State, command};

pub use kasirmu_bridge::purchasing::{
    CreatePurchaseOrderArgs, CreateSupplierArgs, PoLineInput, PurchaseOrderDto,
    PurchaseOrderLineDto, ReceivePoLineDto, SupplierDto, UpdatePoStatusArgs, UpdateSupplierArgs,
};

use crate::error::AppError;
use crate::state::AppState;

// ── Tests ──────────────────────────────────────────────────────────────

/// List suppliers resolved from a session token. ADR #7.
#[command]
pub async fn list_suppliers_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<SupplierDto>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::purchasing::list_suppliers_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Get one supplier resolved from a session token. ADR #7.
#[command]
pub async fn get_supplier_scoped(
    session_token: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<Option<SupplierDto>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::purchasing::get_supplier_scoped(&ctx, &id, &session_token)
        .await
        .map_err(Into::into)
}

/// Create a supplier resolved from a session token. ADR #7.
#[command]
pub async fn create_supplier_scoped(
    session_token: String,
    args: CreateSupplierArgs,
    state: State<'_, AppState>,
) -> Result<SupplierDto, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::purchasing::create_supplier_scoped(&ctx, &args, &session_token)
        .await
        .map_err(Into::into)
}

/// Update a supplier resolved from a session token. ADR #7.
#[command]
pub async fn update_supplier_scoped(
    session_token: String,
    args: UpdateSupplierArgs,
    state: State<'_, AppState>,
) -> Result<SupplierDto, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::purchasing::update_supplier_scoped(&ctx, &args, &session_token)
        .await
        .map_err(Into::into)
}

/// List purchase orders resolved from a session token. ADR #7.
#[command]
pub async fn list_purchase_orders_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<PurchaseOrderDto>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::purchasing::list_purchase_orders_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Get one purchase order resolved from a session token. ADR #7.
#[command]
pub async fn get_purchase_order_scoped(
    session_token: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<Option<PurchaseOrderDto>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::purchasing::get_purchase_order_scoped(&ctx, &id, &session_token)
        .await
        .map_err(Into::into)
}

/// Create a purchase order resolved from a session token. ADR #7.
#[command]
pub async fn create_purchase_order_scoped(
    session_token: String,
    args: CreatePurchaseOrderArgs,
    state: State<'_, AppState>,
) -> Result<PurchaseOrderDto, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::purchasing::create_purchase_order_scoped(&ctx, &args, &session_token)
        .await
        .map_err(Into::into)
}

/// Update a purchase order's status resolved from a session token. ADR #7.
#[command]
pub async fn update_po_status_scoped(
    session_token: String,
    args: UpdatePoStatusArgs,
    state: State<'_, AppState>,
) -> Result<PurchaseOrderDto, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::purchasing::update_po_status_scoped(&ctx, &args, &session_token)
        .await
        .map_err(Into::into)
}

/// Receive a purchase order resolved from a session token. ADR #7.
#[command]
pub async fn receive_purchase_order_scoped(
    session_token: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<PurchaseOrderDto, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::purchasing::receive_purchase_order_scoped(&ctx, &id, &session_token)
        .await
        .map_err(Into::into)
}

/// Receive a purchase order with per-line received/damaged quantities resolved from a session token. ADR #7.
#[command]
pub async fn receive_purchase_order_with_lines_scoped(
    session_token: String,
    id: String,
    lines: Vec<ReceivePoLineDto>,
    state: State<'_, AppState>,
) -> Result<PurchaseOrderDto, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::purchasing::receive_purchase_order_with_lines_scoped(
        &ctx,
        &id,
        &lines,
        &session_token,
    )
    .await
    .map_err(Into::into)
}

#[cfg(test)]
#[path = "purchasing_tests.rs"]
mod tests;
