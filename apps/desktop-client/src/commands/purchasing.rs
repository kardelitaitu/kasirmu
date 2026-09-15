//! Purchasing Tauri commands.
//!
//! Exposes supplier CRUD and purchase-order lifecycle operations to the
//! front-end.
//!
//! Wave C / C4: the bodies now live in the headless
//! `oz_bridge::purchasing` module. Each `#[tauri::command]` below keeps
//! its exact name, parameter list, attributes and `Result<_, AppError>`
//! wire contract; it builds a `BridgeCtx` from `AppState` and delegates.
//! The global-database reads/writes run on `ctx.lock_global()` and the
//! scoped ADR #7 variants authorize through the scope-aware global-identity
//! gate inside the bridge, in the same order as before. The DTOs moved with
//! the bodies and are re-exported so `use super::*` in
//! `purchasing_tests.rs` still resolves them.

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

pub use oz_bridge::purchasing::{
    CreatePurchaseOrderArgs, CreateSupplierArgs, PoLineInput, PurchaseOrderDto,
    PurchaseOrderLineDto, ReceivePoLineDto, SupplierDto, UpdatePoStatusArgs, UpdateSupplierArgs,
};

// ── Supplier commands ───────────────────────────────────────────────

// ── Purchase Order commands ─────────────────────────────────────────

// ── Scoped variants (ADR #7) ────────────────────────────────────────

/// List suppliers resolved from a session token. ADR #7.
#[tauri::command]
pub async fn list_suppliers_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<SupplierDto>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::purchasing::list_suppliers_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Get supplier resolved from a session token. ADR #7.
#[tauri::command]
pub async fn get_supplier_scoped(
    id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Option<SupplierDto>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::purchasing::get_supplier_scoped(&ctx, &id, &session_token)
        .await
        .map_err(Into::into)
}

/// Create supplier resolved from a session token. ADR #7.
#[tauri::command]
pub async fn create_supplier_scoped(
    args: CreateSupplierArgs,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<SupplierDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::purchasing::create_supplier_scoped(&ctx, &args, &session_token)
        .await
        .map_err(Into::into)
}

/// Update supplier resolved from a session token. ADR #7.
#[tauri::command]
pub async fn update_supplier_scoped(
    args: UpdateSupplierArgs,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<SupplierDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::purchasing::update_supplier_scoped(&ctx, &args, &session_token)
        .await
        .map_err(Into::into)
}

/// List purchase orders resolved from a session token. ADR #7.
#[tauri::command]
pub async fn list_purchase_orders_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<PurchaseOrderDto>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::purchasing::list_purchase_orders_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Get purchase order resolved from a session token. ADR #7.
#[tauri::command]
pub async fn get_purchase_order_scoped(
    id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Option<PurchaseOrderDto>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::purchasing::get_purchase_order_scoped(&ctx, &id, &session_token)
        .await
        .map_err(Into::into)
}

/// Create purchase order resolved from a session token. ADR #7.
#[tauri::command]
pub async fn create_purchase_order_scoped(
    args: CreatePurchaseOrderArgs,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<PurchaseOrderDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::purchasing::create_purchase_order_scoped(&ctx, &args, &session_token)
        .await
        .map_err(Into::into)
}

/// Update po status resolved from a session token. ADR #7.
#[tauri::command]
pub async fn update_po_status_scoped(
    args: UpdatePoStatusArgs,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<PurchaseOrderDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::purchasing::update_po_status_scoped(&ctx, &args, &session_token)
        .await
        .map_err(Into::into)
}

/// Receive purchase order resolved from a session token. ADR #7.
#[tauri::command]
pub async fn receive_purchase_order_scoped(
    id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<PurchaseOrderDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::purchasing::receive_purchase_order_scoped(&ctx, &id, &session_token)
        .await
        .map_err(Into::into)
}

/// Receive a purchase order with per-line received/damaged quantities resolved from a session token. ADR #7.
#[tauri::command]
pub async fn receive_purchase_order_with_lines_scoped(
    id: String,
    lines: Vec<ReceivePoLineDto>,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<PurchaseOrderDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::purchasing::receive_purchase_order_with_lines_scoped(
        &ctx,
        &id,
        &lines,
        &session_token,
    )
    .await
    .map_err(Into::into)
}
