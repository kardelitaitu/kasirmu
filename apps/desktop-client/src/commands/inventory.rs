//! Tauri commands for multi-location inventory, shifts, transactions, thresholds, and pending sale checkout.

use crate::commands::authz::require_permission_for_user;
use crate::error::AppError;
use crate::state::AppState;
use oz_core::availability::UsageCounts;
use oz_core::entitlements::Entitlements;

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
    let session = state.resolve_session(&session_token)?;
    require_inventory_permission(
        &state,
        &session.user_id,
        oz_core::permissions::INVENTORY_LOCATIONS_MANAGE,
    )
    .await?;

    // Warehouse quota enforcement: Free allows 1, Plus 2, Pro 3,
    // Premium/Enterprise unlimited. Only fires for warehouse-type locations.
    // Load subscription from the identity DB first (tenant_subscription lives
    // there), then release the lock before opening the scoped store DB.
    let effective_tier = {
        let identity = state.db.lock().await;
        let sub = oz_core::subscription::TenantSubscription::load(&identity, "default")?
            .ok_or_else(|| AppError::Internal("default tenant subscription not found".into()))?;
        sub.verify_signature()?;
        // Source the quota tier from the entitlements read model (Phase B one
        // limit table) so the warehouse gate shares the caps projection's
        // single source instead of a second subscription derivation.
        Entitlements::from_subscription(&sub, UsageCounts::default()).tier
    };

    let conn = state
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    store.enforce_warehouse_quota(&effective_tier, &location_type)?;

    let id = store.create_inventory_location(&name, &location_type, &description)?;
    Ok(id)
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
    let session = state.resolve_session(&session_token)?;
    require_inventory_permission(
        &state,
        &session.user_id,
        oz_core::permissions::INVENTORY_VIEW,
    )
    .await?;
    let conn = state
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    let locs = store.list_inventory_locations()?;
    Ok(locs)
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
    let session = state.resolve_session(&session_token)?;
    require_inventory_permission(
        &state,
        &session.user_id,
        oz_core::permissions::INVENTORY_LOCATIONS_MANAGE,
    )
    .await?;
    let conn = state
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    store.update_inventory_location(&id, &name, &location_type, &description)?;
    Ok(())
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
    let session = state.resolve_session(&session_token)?;
    require_inventory_permission(
        &state,
        &session.user_id,
        oz_core::permissions::INVENTORY_LOCATIONS_MANAGE,
    )
    .await?;
    let conn = state
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    store.deactivate_inventory_location(&id)?;
    Ok(())
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
    let session = state.resolve_session(&session_token)?;
    require_inventory_permission(
        &state,
        &session.user_id,
        oz_core::permissions::INVENTORY_VIEW,
    )
    .await?;
    let conn = state
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;

    let binding = get_workspace_locations(&db, &instance_id, &type_key)?;
    Ok(binding)
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
    let session = state.resolve_session(&session_token)?;
    require_inventory_permission(
        &state,
        &session.user_id,
        oz_core::permissions::INVENTORY_VIEW,
    )
    .await?;
    invalidate_location_cache();
    Ok(())
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
    let session = state.resolve_session(&session_token)?;
    require_inventory_permission(
        &state,
        &session.user_id,
        oz_core::permissions::INVENTORY_LOCATIONS_MANAGE,
    )
    .await?;
    let conn = state
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    store.set_workspace_inventory_locations(&instance_id, &locations)?;
    Ok(())
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
    let session = state.resolve_session(&session_token)?;
    require_inventory_permission(
        &state,
        &session.user_id,
        oz_core::permissions::INVENTORY_VIEW,
    )
    .await?;
    let conn = state
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    let locs = store.get_workspace_inventory_locations(&instance_id)?;
    Ok(locs)
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
    let session = state.resolve_session(&session_token)?;
    require_inventory_permission(
        &state,
        &session.user_id,
        oz_core::permissions::SALES_PROCESS,
    )
    .await?;
    let conn = state
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    let shift = store.start_inventory_shift(
        &session.user_id,
        &location_id,
        Some(&session.terminal_id),
        &notes,
    )?;
    Ok(shift)
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
    let session = state.resolve_session(&session_token)?;
    require_inventory_permission(
        &state,
        &session.user_id,
        oz_core::permissions::SALES_PROCESS,
    )
    .await?;
    let conn = state
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    store.end_inventory_shift(&shift_id)?;
    Ok(())
}

/// Retrieve the active inventory shift for the current user, if any.
///
/// Requires `SALES_PROCESS` permission.
#[tauri::command]
pub async fn get_active_inventory_shift(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Option<InventoryShift>, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_inventory_permission(
        &state,
        &session.user_id,
        oz_core::permissions::SALES_PROCESS,
    )
    .await?;
    let conn = state
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    let shift = store.get_active_inventory_shift(&session.user_id)?;
    Ok(shift)
}

/// List all inventory shifts history.
///
/// Requires `SALES_PROCESS` permission.
#[tauri::command]
pub async fn list_inventory_shifts(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<InventoryShift>, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_inventory_permission(
        &state,
        &session.user_id,
        oz_core::permissions::SALES_PROCESS,
    )
    .await?;
    let conn = state
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    let shifts = store.list_inventory_shifts()?;
    Ok(shifts)
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
    let session = state.resolve_session(&session_token)?;
    require_inventory_permission(
        &state,
        &session.user_id,
        oz_core::permissions::SALES_PROCESS,
    )
    .await?;
    let conn = state
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    let ttype = InventoryTransactionType::from_stored_str(&type_str)
        .ok_or_else(|| AppError::Invalid(format!("invalid transaction type: {}", type_str)))?;

    let tx_id = store.create_inventory_transaction(
        ttype,
        &location_id,
        &session.user_id,
        &notes,
        &lines,
    )?;
    Ok(tx_id)
}

/// List all inventory transactions.
///
/// Requires `SALES_PROCESS` permission.
#[tauri::command]
pub async fn list_inventory_transactions(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<InventoryTransaction>, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_inventory_permission(
        &state,
        &session.user_id,
        oz_core::permissions::SALES_PROCESS,
    )
    .await?;
    let conn = state
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    let txs = store.list_inventory_transactions()?;
    Ok(txs)
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
    let session = state.resolve_session(&session_token)?;
    require_inventory_permission(
        &state,
        &session.user_id,
        oz_core::permissions::SALES_PROCESS,
    )
    .await?;
    let conn = state
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    let txs =
        store.list_inventory_transactions_for_shift(&session.user_id, &location_id, &since)?;
    Ok(txs)
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
    let session = state.resolve_session(&session_token)?;
    require_inventory_permission(
        &state,
        &session.user_id,
        oz_core::permissions::SALES_PROCESS,
    )
    .await?;
    let conn = state
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    let detail = store.get_inventory_transaction(&id)?;
    Ok(detail)
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
    let session = state.resolve_session(&session_token)?;
    require_inventory_permission(
        &state,
        &session.user_id,
        oz_core::permissions::SALES_PROCESS,
    )
    .await?;
    let conn = state
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    store.set_stock_threshold(&product_id, location_id.as_deref(), threshold, enabled)?;
    Ok(())
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
    let session = state.resolve_session(&session_token)?;
    require_inventory_permission(
        &state,
        &session.user_id,
        oz_core::permissions::SALES_PROCESS,
    )
    .await?;
    let conn = state
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    let thresholds = store.get_stock_thresholds(location_id.as_deref())?;
    Ok(thresholds)
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
    let session = state.resolve_session(&session_token)?;
    require_inventory_permission(
        &state,
        &session.user_id,
        oz_core::permissions::SALES_PROCESS,
    )
    .await?;
    let conn = state
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    store.delete_stock_threshold(&id)?;
    Ok(())
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
    let session = state.resolve_session(&session_token)?;
    require_inventory_permission(
        &state,
        &session.user_id,
        oz_core::permissions::SALES_PROCESS,
    )
    .await?;
    let conn = state
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    let alerts = store.low_stock_alerts_at_location(&location_id, default_threshold)?;
    Ok(alerts)
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
    let session = state.resolve_session(&session_token)?;
    require_inventory_permission(
        &state,
        &session.user_id,
        oz_core::permissions::SALES_PROCESS,
    )
    .await?;
    let conn = state
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    let alerts = store.active_stock_alerts(&location_id)?;
    Ok(alerts)
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
    let session = state.resolve_session(&session_token)?;
    require_inventory_permission(
        &state,
        &session.user_id,
        oz_core::permissions::SALES_PROCESS,
    )
    .await?;
    let conn = state
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    store.acknowledge_stock_alert(&alert_id, &session.user_id)?;
    Ok(())
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
    let session = state.resolve_session(&session_token)?;
    require_inventory_permission(
        &state,
        &session.user_id,
        oz_core::permissions::SALES_PROCESS,
    )
    .await?;
    let conn = state
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    store.finalize_sale(&sale_id)?;
    Ok(())
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
    let session = state.resolve_session(&session_token)?;
    require_inventory_permission(
        &state,
        &session.user_id,
        oz_core::permissions::SALES_PROCESS,
    )
    .await?;
    let conn = state
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    store.void_pending_sale(&sale_id)?;
    Ok(())
}

#[cfg(test)]
#[path = "inventory_tests.rs"]
mod tests;
