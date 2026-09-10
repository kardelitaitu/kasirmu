//! Tauri commands for multi-location inventory, shifts, transactions, thresholds, and pending sale checkout.
//!
//! The bodies live in `oz_bridge::inventory` (Wave C / C1); every command here
//! is a thin shim that builds the per-call [`BridgeCtx`] and maps `BridgeError`
//! back onto `AppError` variant-for-variant. The global-DB gate adapter below
//! stays because the sibling test module exercises it directly.

use crate::commands::authz::require_permission_for_user;
use crate::error::AppError;
use crate::state::AppState;
#[allow(unused_imports)] // sibling *_tests.rs depends on it
use oz_core::availability::UsageCounts;
#[allow(unused_imports)] // sibling *_tests.rs depends on it
use oz_core::entitlements::Entitlements;

#[allow(unused_imports)] // sibling *_tests.rs depends on it
use oz_core::{
    InventoryLocation, InventoryShift, InventoryTransaction, InventoryTransactionLine,
    StockThreshold, Store, WorkspaceInventoryLocation,
    db::inventory::InventoryTransactionLineInput,
    inventory_transaction::InventoryTransactionType,
    location_resolver::{
        WorkspaceLocationBinding, get_workspace_locations, invalidate_location_cache,
    },
};
use tauri::State;

/// Check a permission against the GLOBAL identity DB (ADR #4/#7).
///
/// Users and roles are global authentication records; the store-scoped DBs
/// contain no users. Every inventory command must authorise through this
/// helper rather than `require_permission_for_user(&store, …)` on the store
/// connection, which would fail with "user not found" for every caller.
#[allow(dead_code)] // command bodies now delegate to the bridge gate
async fn require_inventory_permission(
    state: &AppState,
    user_id: &str,
    permission: &str,
) -> Result<(), AppError> {
    let db = state.db.lock().await;
    let store = Store::new(&db);
    require_permission_for_user(&store, user_id, permission)
}

// ── Locations CRUD ──────────────────────────────────────────────────

/// Create a new inventory location.
///
/// Requires `INVENTORY_LOCATIONS_MANAGE` permission (LOC-06) — location
/// management is a dedicated capability, not a side effect of sales processing.
#[tauri::command]
pub async fn create_inventory_location(
    session_token: String,
    name: String,
    location_type: String,
    description: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::inventory::create_inventory_location(
        &ctx,
        &session_token,
        name,
        location_type,
        description,
    )
    .await
    .map_err(Into::into)
}

/// List all inventory locations.
///
/// Requires `INVENTORY_VIEW` permission (LOC-06) — reading the picker list
/// needs only stock visibility, not sales processing.
#[tauri::command]
pub async fn list_inventory_locations(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<InventoryLocation>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::inventory::list_inventory_locations(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Update details of an existing inventory location.
///
/// Requires `INVENTORY_LOCATIONS_MANAGE` permission (LOC-06).
#[tauri::command]
pub async fn update_inventory_location(
    session_token: String,
    id: String,
    name: String,
    location_type: String,
    description: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::inventory::update_inventory_location(
        &ctx,
        &session_token,
        id,
        name,
        location_type,
        description,
    )
    .await
    .map_err(Into::into)
}

/// Deactivate an inventory location (fails if contains stock or pending transfers).
///
/// Requires `INVENTORY_LOCATIONS_MANAGE` permission (LOC-06).
#[tauri::command]
pub async fn deactivate_inventory_location(
    session_token: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::inventory::deactivate_inventory_location(&ctx, &session_token, id)
        .await
        .map_err(Into::into)
}

/// Resolve locations bound to a workspace instance (unified resolver ADR-19 §10).
///
/// Requires `INVENTORY_VIEW` permission (LOC-06) — reading the bound-location
/// set is a stock-visibility operation.
#[tauri::command]
pub async fn get_workspace_locations_scoped(
    session_token: String,
    instance_id: String,
    type_key: String,
    state: State<'_, AppState>,
) -> Result<Vec<WorkspaceLocationBinding>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::inventory::get_workspace_locations_scoped(
        &ctx,
        &session_token,
        instance_id,
        type_key,
    )
    .await
    .map_err(Into::into)
}

/// Invalidate the location resolver cache.
///
/// Requires `INVENTORY_VIEW` permission (LOC-06) — cache invalidation is a
/// read-path hygiene operation.
#[tauri::command]
pub async fn invalidate_location_cache_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::inventory::invalidate_location_cache_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

// ── Workspace Location Bindings ─────────────────────────────────────

/// Set inventory location bindings for a workspace instance.
///
/// Requires `INVENTORY_LOCATIONS_MANAGE` permission (LOC-06) — binding is a
/// stock-policy management operation.
#[tauri::command]
pub async fn set_workspace_inventory_locations(
    session_token: String,
    instance_id: String,
    locations: Vec<WorkspaceInventoryLocation>,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::inventory::set_workspace_inventory_locations(
        &ctx,
        &session_token,
        instance_id,
        locations,
    )
    .await
    .map_err(Into::into)
}

/// Get inventory location bindings for a workspace instance.
///
/// Requires `INVENTORY_VIEW` permission (LOC-06).
#[tauri::command]
pub async fn get_workspace_inventory_locations(
    session_token: String,
    instance_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<WorkspaceInventoryLocation>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::inventory::get_workspace_inventory_locations(&ctx, &session_token, instance_id)
        .await
        .map_err(Into::into)
}

// ── Inventory Shifts ────────────────────────────────────────────────

/// Start a new inventory shift for the current user at a location.
///
/// Requires `SALES_PROCESS` permission.
#[tauri::command]
pub async fn start_inventory_shift(
    session_token: String,
    location_id: String,
    notes: String,
    state: State<'_, AppState>,
) -> Result<InventoryShift, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::inventory::start_inventory_shift(&ctx, &session_token, location_id, notes)
        .await
        .map_err(Into::into)
}

/// End an active inventory shift.
///
/// Requires `SALES_PROCESS` permission.
#[tauri::command]
pub async fn end_inventory_shift(
    session_token: String,
    shift_id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::inventory::end_inventory_shift(&ctx, &session_token, shift_id)
        .await
        .map_err(Into::into)
}

/// Retrieve the active inventory shift for the current user, if any.
///
/// Requires `SALES_PROCESS` permission.
#[tauri::command]
pub async fn get_active_inventory_shift(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Option<InventoryShift>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::inventory::get_active_inventory_shift(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// List all inventory shifts history.
///
/// Requires `SALES_PROCESS` permission.
#[tauri::command]
pub async fn list_inventory_shifts(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<InventoryShift>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::inventory::list_inventory_shifts(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

// ── Inventory Transaction Logs ──────────────────────────────────────

/// Create a new manual / staff inventory transaction audit log session.
///
/// Requires `SALES_PROCESS` permission.
#[tauri::command]
pub async fn create_inventory_transaction(
    session_token: String,
    type_str: String,
    location_id: String,
    notes: String,
    lines: Vec<InventoryTransactionLineInput>,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::inventory::create_inventory_transaction(
        &ctx,
        &session_token,
        type_str,
        location_id,
        notes,
        lines,
    )
    .await
    .map_err(Into::into)
}

/// List all inventory transactions.
///
/// Requires `SALES_PROCESS` permission.
#[tauri::command]
pub async fn list_inventory_transactions(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<InventoryTransaction>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::inventory::list_inventory_transactions(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// List inventory transactions for a specific shift (staff + location + time window).
///
/// Used by the inventory shift-bar summary to avoid client-side filtering
/// of all transactions. Requires `SALES_PROCESS` permission.
#[tauri::command]
pub async fn list_inventory_transactions_for_shift(
    session_token: String,
    location_id: String,
    since: String,
    state: State<'_, AppState>,
) -> Result<Vec<InventoryTransaction>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::inventory::list_inventory_transactions_for_shift(
        &ctx,
        &session_token,
        location_id,
        since,
    )
    .await
    .map_err(Into::into)
}

/// Retrieve details of a single transaction, including its lines.
///
/// Requires `SALES_PROCESS` permission.
#[tauri::command]
pub async fn get_inventory_transaction(
    session_token: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<Option<(InventoryTransaction, Vec<InventoryTransactionLine>)>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::inventory::get_inventory_transaction(&ctx, &session_token, id)
        .await
        .map_err(Into::into)
}

// ── Stock Thresholds ────────────────────────────────────────────────

/// Set a stock alert threshold boundary.
///
/// Requires `SALES_PROCESS` permission.
#[tauri::command]
pub async fn set_stock_threshold(
    session_token: String,
    product_id: String,
    location_id: Option<String>,
    threshold: i64,
    enabled: bool,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::inventory::set_stock_threshold(
        &ctx,
        &session_token,
        product_id,
        location_id,
        threshold,
        enabled,
    )
    .await
    .map_err(Into::into)
}

/// Get stock alert thresholds for a location.
///
/// Requires `SALES_PROCESS` permission.
#[tauri::command]
pub async fn get_stock_thresholds(
    session_token: String,
    location_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<StockThreshold>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::inventory::get_stock_thresholds(&ctx, &session_token, location_id)
        .await
        .map_err(Into::into)
}

/// Delete a stock alert threshold boundary.
///
/// Requires `SALES_PROCESS` permission.
#[tauri::command]
pub async fn delete_stock_threshold(
    session_token: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::inventory::delete_stock_threshold(&ctx, &session_token, id)
        .await
        .map_err(Into::into)
}

/// Get per-location low stock alerts.
///
/// Requires `SALES_PROCESS` permission.
#[tauri::command]
pub async fn get_low_stock_alerts_at_location_scoped(
    session_token: String,
    location_id: String,
    default_threshold: i64,
    state: State<'_, AppState>,
) -> Result<Vec<oz_core::db::reports::LowStockAlert>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::inventory::get_low_stock_alerts_at_location_scoped(
        &ctx,
        &session_token,
        location_id,
        default_threshold,
    )
    .await
    .map_err(Into::into)
}

// ── Stock Alerts ─────────────────────────────────────────────────────

/// Get active stock alerts for a location (enriched with product SKU/name).
///
/// Requires `SALES_PROCESS` permission.
#[tauri::command]
pub async fn active_stock_alerts_scoped(
    session_token: String,
    location_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<oz_core::db::reports::StockAlertEvent>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::inventory::active_stock_alerts_scoped(&ctx, &session_token, location_id)
        .await
        .map_err(Into::into)
}

/// Acknowledge a stock alert event (records who acknowledged it).
///
/// Requires `SALES_PROCESS` permission.
#[tauri::command]
pub async fn acknowledge_stock_alert_scoped(
    session_token: String,
    alert_id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::inventory::acknowledge_stock_alert_scoped(&ctx, &session_token, alert_id)
        .await
        .map_err(Into::into)
}

// ── Pending Sale Capture / Void ─────────────────────────────────────

/// Transition a pending sale's status to completed after payment capture.
///
/// Requires `SALES_PROCESS` permission.
#[tauri::command]
pub async fn finalize_sale(
    session_token: String,
    sale_id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::inventory::finalize_sale(&ctx, &session_token, sale_id)
        .await
        .map_err(Into::into)
}

/// Void a pending sale and restore stock.
///
/// Requires `SALES_PROCESS` permission.
#[tauri::command]
pub async fn void_pending_sale(
    session_token: String,
    sale_id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::inventory::void_pending_sale(&ctx, &session_token, sale_id)
        .await
        .map_err(Into::into)
}

#[cfg(test)]
#[path = "inventory_tests.rs"]
mod tests;
