//! Inventory command bodies (Wave C / C1) — the tauri-free half of
//! `apps/desktop-client/src/commands/inventory.rs`.
//!
//! Locations CRUD, workspace location bindings, shifts, transaction logs, stock
//! thresholds, stock alerts and the pending-sale finalize/void pair. Each
//! operation is a verbatim port of its command body: session resolve → the
//! global-DB permission gate → `db_manager.open_store` → the store lock →
//! `Store::new` → one store call, in that order. Gate order is what the
//! desktop's permission tests pin, so nothing here re-sequences it.
//!
//! The gate keeps the shell's NON-scope-aware form
//! (`Store::require_permission` against the GLOBAL identity DB) through the
//! module-private [`require_inventory_permission`]. That is deliberate parity,
//! not an oversight: users and roles live only in the identity DB, so
//! authorizing against the store connection would deny every caller — see the
//! note on the helper. Wave-A's categories/tax gates set the same precedent.
//!
//! Errors are `BridgeError`s that the shims map to `AppError` variant-for-variant,
//! including the exact `opening store db: {e}` / `store db lock: {e}` texts and
//! the `invalid transaction type: {t}` denial.

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

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

/// Map an authz-gate failure onto the bridge error surface.
///
/// The gates call `Store::require_permission`, which reports denials as
/// `CoreError::PermissionDenied`; every other `CoreError` keeps its own
/// sub-kind through the shared `From` impl, so a DB failure never masquerades
/// as a permission denial on the wire.
fn map_gate_error(e: oz_core::CoreError) -> BridgeError {
    match e {
        oz_core::CoreError::PermissionDenied(message) => BridgeError::PermissionDenied(message),
        other => BridgeError::from(other),
    }
}

/// Check a permission against the GLOBAL identity DB (ADR #4/#7).
///
/// Users and roles are global authentication records; the store-scoped DBs
/// contain no users. Every inventory command must authorise through this
/// helper rather than a `require_permission_for_user(&store, …)` call on the
/// store connection, which would fail with "user not found" for every caller.
///
/// # Errors
///
/// Returns [`BridgeError::PermissionDenied`] when the role does not grant
/// `permission`, [`BridgeError::InvalidSession`] never (it takes the resolved
/// user id), and [`BridgeError::Core`] on DB errors.
async fn require_inventory_permission(
    ctx: &BridgeCtx<'_>,
    user_id: &str,
    permission: &str,
) -> Result<(), BridgeError> {
    let db = ctx.lock_global().await;
    let store = Store::new(&db);
    store
        .require_permission(user_id, permission)
        .map_err(map_gate_error)
}

/// Create a new inventory location.
///
/// Requires `INVENTORY_LOCATIONS_MANAGE` permission (LOC-06) — location
/// management is a dedicated capability, not a side effect of sales processing.
///
/// The warehouse quota is sourced from the entitlements read model so this gate
/// shares the caps projection's single source instead of a second subscription
/// derivation, and the identity lock is released before the store DB opens.
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for an unknown or expired token,
/// [`BridgeError::PermissionDenied`] when the caller's role lacks the
/// permission named above, and [`BridgeError::Core`] on DB errors.
pub async fn create_inventory_location(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    name: String,
    location_type: String,
    description: String,
) -> Result<String, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    require_inventory_permission(
        ctx,
        &session.user_id,
        oz_core::permissions::INVENTORY_LOCATIONS_MANAGE,
    )
    .await?;
    // Warehouse quota enforcement: Free allows 1, Plus 2, Pro 3,
    // Premium/Enterprise unlimited. Only fires for warehouse-type locations.
    // Load subscription from the identity DB first (tenant_subscription lives
    // there), then release the lock before opening the scoped store DB.
    let effective_tier = {
        let identity = ctx.lock_global().await;
        let sub = oz_core::subscription::TenantSubscription::load(&identity, "default")?
            .ok_or_else(|| BridgeError::Internal("default tenant subscription not found".into()))?;
        sub.verify_signature()?;
        // Source the quota tier from the entitlements read model (Phase B one
        // limit table) so the warehouse gate shares the caps projection's
        // single source instead of a second subscription derivation.
        Entitlements::from_subscription(&sub, UsageCounts::default()).tier
    };

    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    store.enforce_warehouse_quota(&effective_tier, &location_type)?;

    let id = store.create_inventory_location(&name, &location_type, &description)?;
    Ok(id)
}

/// List all inventory locations.
///
/// Requires `INVENTORY_VIEW` permission (LOC-06) — reading the picker list
/// needs only stock visibility, not sales processing.
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for an unknown or expired token,
/// [`BridgeError::PermissionDenied`] when the caller's role lacks the
/// permission named above, and [`BridgeError::Core`] on DB errors.
pub async fn list_inventory_locations(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<Vec<InventoryLocation>, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    require_inventory_permission(ctx, &session.user_id, oz_core::permissions::INVENTORY_VIEW)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    let locs = store.list_inventory_locations()?;
    Ok(locs)
}

/// Update details of an existing inventory location.
///
/// Requires `INVENTORY_LOCATIONS_MANAGE` permission (LOC-06).
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for an unknown or expired token,
/// [`BridgeError::PermissionDenied`] when the caller's role lacks the
/// permission named above, and [`BridgeError::Core`] on DB errors.
pub async fn update_inventory_location(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    id: String,
    name: String,
    location_type: String,
    description: String,
) -> Result<(), BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    require_inventory_permission(
        ctx,
        &session.user_id,
        oz_core::permissions::INVENTORY_LOCATIONS_MANAGE,
    )
    .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    store.update_inventory_location(&id, &name, &location_type, &description)?;
    Ok(())
}

/// Deactivate an inventory location (fails if contains stock or pending transfers).
///
/// Requires `INVENTORY_LOCATIONS_MANAGE` permission (LOC-06).
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for an unknown or expired token,
/// [`BridgeError::PermissionDenied`] when the caller's role lacks the
/// permission named above, and [`BridgeError::Core`] on DB errors.
pub async fn deactivate_inventory_location(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    id: String,
) -> Result<(), BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    require_inventory_permission(
        ctx,
        &session.user_id,
        oz_core::permissions::INVENTORY_LOCATIONS_MANAGE,
    )
    .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    store.deactivate_inventory_location(&id)?;
    Ok(())
}

/// Resolve locations bound to a workspace instance (unified resolver ADR-19 §10).
///
/// Requires `INVENTORY_VIEW` permission (LOC-06) — reading the bound-location
/// set is a stock-visibility operation.
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for an unknown or expired token,
/// [`BridgeError::PermissionDenied`] when the caller's role lacks the
/// permission named above, and [`BridgeError::Core`] on DB errors.
pub async fn get_workspace_locations_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    instance_id: String,
    type_key: String,
) -> Result<Vec<WorkspaceLocationBinding>, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    require_inventory_permission(ctx, &session.user_id, oz_core::permissions::INVENTORY_VIEW)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let binding = get_workspace_locations(&db, &instance_id, &type_key)?;
    Ok(binding)
}

/// Set inventory location bindings for a workspace instance.
///
/// Requires `INVENTORY_LOCATIONS_MANAGE` permission (LOC-06) — binding is a
/// stock-policy management operation.
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for an unknown or expired token,
/// [`BridgeError::PermissionDenied`] when the caller's role lacks the
/// permission named above, and [`BridgeError::Core`] on DB errors.
pub async fn set_workspace_inventory_locations(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    instance_id: String,
    locations: Vec<WorkspaceInventoryLocation>,
) -> Result<(), BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    require_inventory_permission(
        ctx,
        &session.user_id,
        oz_core::permissions::INVENTORY_LOCATIONS_MANAGE,
    )
    .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    store.set_workspace_inventory_locations(&instance_id, &locations)?;
    Ok(())
}

/// Get inventory location bindings for a workspace instance.
///
/// Requires `INVENTORY_VIEW` permission (LOC-06).
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for an unknown or expired token,
/// [`BridgeError::PermissionDenied`] when the caller's role lacks the
/// permission named above, and [`BridgeError::Core`] on DB errors.
pub async fn get_workspace_inventory_locations(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    instance_id: String,
) -> Result<Vec<WorkspaceInventoryLocation>, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    require_inventory_permission(ctx, &session.user_id, oz_core::permissions::INVENTORY_VIEW)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    let locs = store.get_workspace_inventory_locations(&instance_id)?;
    Ok(locs)
}

/// Start a new inventory shift for the current user at a location.
///
/// Requires `SALES_PROCESS` permission. The shift is bound to the session's
/// terminal, never to a caller-supplied one.
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for an unknown or expired token,
/// [`BridgeError::PermissionDenied`] when the caller's role lacks the
/// permission named above, and [`BridgeError::Core`] on DB errors.
pub async fn start_inventory_shift(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    location_id: String,
    notes: String,
) -> Result<InventoryShift, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    require_inventory_permission(ctx, &session.user_id, oz_core::permissions::SALES_PROCESS)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
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
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for an unknown or expired token,
/// [`BridgeError::PermissionDenied`] when the caller's role lacks the
/// permission named above, and [`BridgeError::Core`] on DB errors.
pub async fn end_inventory_shift(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    shift_id: String,
) -> Result<(), BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    require_inventory_permission(ctx, &session.user_id, oz_core::permissions::SALES_PROCESS)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    store.end_inventory_shift(&shift_id)?;
    Ok(())
}

/// Retrieve the active inventory shift for the current user, if any.
///
/// Requires `SALES_PROCESS` permission.
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for an unknown or expired token,
/// [`BridgeError::PermissionDenied`] when the caller's role lacks the
/// permission named above, and [`BridgeError::Core`] on DB errors.
pub async fn get_active_inventory_shift(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<Option<InventoryShift>, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    require_inventory_permission(ctx, &session.user_id, oz_core::permissions::SALES_PROCESS)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    let shift = store.get_active_inventory_shift(&session.user_id)?;
    Ok(shift)
}

/// List all inventory shifts history.
///
/// Requires `SALES_PROCESS` permission.
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for an unknown or expired token,
/// [`BridgeError::PermissionDenied`] when the caller's role lacks the
/// permission named above, and [`BridgeError::Core`] on DB errors.
pub async fn list_inventory_shifts(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<Vec<InventoryShift>, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    require_inventory_permission(ctx, &session.user_id, oz_core::permissions::SALES_PROCESS)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    let shifts = store.list_inventory_shifts()?;
    Ok(shifts)
}

/// Create a new manual / staff inventory transaction audit log session.
///
/// Requires `SALES_PROCESS` permission. `type_str` is validated against the
/// stored transaction-type vocabulary before anything is written.
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for an unknown or expired token,
/// [`BridgeError::PermissionDenied`] when the caller's role lacks the
/// permission named above, and [`BridgeError::Core`] on DB errors.
pub async fn create_inventory_transaction(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    type_str: String,
    location_id: String,
    notes: String,
    lines: Vec<InventoryTransactionLineInput>,
) -> Result<String, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    require_inventory_permission(ctx, &session.user_id, oz_core::permissions::SALES_PROCESS)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    let ttype = InventoryTransactionType::from_stored_str(&type_str)
        .ok_or_else(|| BridgeError::Invalid(format!("invalid transaction type: {}", type_str)))?;

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
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for an unknown or expired token,
/// [`BridgeError::PermissionDenied`] when the caller's role lacks the
/// permission named above, and [`BridgeError::Core`] on DB errors.
pub async fn list_inventory_transactions(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<Vec<InventoryTransaction>, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    require_inventory_permission(ctx, &session.user_id, oz_core::permissions::SALES_PROCESS)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    let txs = store.list_inventory_transactions()?;
    Ok(txs)
}

/// List inventory transactions for a specific shift (staff + location + time window).
///
/// Used by the inventory shift-bar summary to avoid client-side filtering
/// of all transactions. Requires `SALES_PROCESS` permission.
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for an unknown or expired token,
/// [`BridgeError::PermissionDenied`] when the caller's role lacks the
/// permission named above, and [`BridgeError::Core`] on DB errors.
pub async fn list_inventory_transactions_for_shift(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    location_id: String,
    since: String,
) -> Result<Vec<InventoryTransaction>, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    require_inventory_permission(ctx, &session.user_id, oz_core::permissions::SALES_PROCESS)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    let txs =
        store.list_inventory_transactions_for_shift(&session.user_id, &location_id, &since)?;
    Ok(txs)
}

/// Retrieve details of a single transaction, including its lines.
///
/// Requires `SALES_PROCESS` permission.
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for an unknown or expired token,
/// [`BridgeError::PermissionDenied`] when the caller's role lacks the
/// permission named above, and [`BridgeError::Core`] on DB errors.
pub async fn get_inventory_transaction(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    id: String,
) -> Result<Option<(InventoryTransaction, Vec<InventoryTransactionLine>)>, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    require_inventory_permission(ctx, &session.user_id, oz_core::permissions::SALES_PROCESS)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    let detail = store.get_inventory_transaction(&id)?;
    Ok(detail)
}

/// Set a stock alert threshold boundary.
///
/// Requires `SALES_PROCESS` permission.
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for an unknown or expired token,
/// [`BridgeError::PermissionDenied`] when the caller's role lacks the
/// permission named above, and [`BridgeError::Core`] on DB errors.
pub async fn set_stock_threshold(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    product_id: String,
    location_id: Option<String>,
    threshold: i64,
    enabled: bool,
) -> Result<(), BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    require_inventory_permission(ctx, &session.user_id, oz_core::permissions::SALES_PROCESS)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    store.set_stock_threshold(&product_id, location_id.as_deref(), threshold, enabled)?;
    Ok(())
}

/// Get stock alert thresholds for a location.
///
/// Requires `SALES_PROCESS` permission.
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for an unknown or expired token,
/// [`BridgeError::PermissionDenied`] when the caller's role lacks the
/// permission named above, and [`BridgeError::Core`] on DB errors.
pub async fn get_stock_thresholds(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    location_id: Option<String>,
) -> Result<Vec<StockThreshold>, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    require_inventory_permission(ctx, &session.user_id, oz_core::permissions::SALES_PROCESS)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    let thresholds = store.get_stock_thresholds(location_id.as_deref())?;
    Ok(thresholds)
}

/// Delete a stock alert threshold boundary.
///
/// Requires `SALES_PROCESS` permission.
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for an unknown or expired token,
/// [`BridgeError::PermissionDenied`] when the caller's role lacks the
/// permission named above, and [`BridgeError::Core`] on DB errors.
pub async fn delete_stock_threshold(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    id: String,
) -> Result<(), BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    require_inventory_permission(ctx, &session.user_id, oz_core::permissions::SALES_PROCESS)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    store.delete_stock_threshold(&id)?;
    Ok(())
}

/// Get per-location low stock alerts.
///
/// Requires `SALES_PROCESS` permission.
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for an unknown or expired token,
/// [`BridgeError::PermissionDenied`] when the caller's role lacks the
/// permission named above, and [`BridgeError::Core`] on DB errors.
pub async fn get_low_stock_alerts_at_location_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    location_id: String,
    default_threshold: i64,
) -> Result<Vec<oz_core::db::reports::LowStockAlert>, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    require_inventory_permission(ctx, &session.user_id, oz_core::permissions::SALES_PROCESS)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    let alerts = store.low_stock_alerts_at_location(&location_id, default_threshold)?;
    Ok(alerts)
}

/// Get active stock alerts for a location (enriched with product SKU/name).
///
/// Requires `SALES_PROCESS` permission.
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for an unknown or expired token,
/// [`BridgeError::PermissionDenied`] when the caller's role lacks the
/// permission named above, and [`BridgeError::Core`] on DB errors.
pub async fn active_stock_alerts_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    location_id: String,
) -> Result<Vec<oz_core::db::reports::StockAlertEvent>, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    require_inventory_permission(ctx, &session.user_id, oz_core::permissions::SALES_PROCESS)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    let alerts = store.active_stock_alerts(&location_id)?;
    Ok(alerts)
}

/// Acknowledge a stock alert event (records who acknowledged it).
///
/// Requires `SALES_PROCESS` permission. The acknowledger is the session user,
/// never a caller-supplied id.
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for an unknown or expired token,
/// [`BridgeError::PermissionDenied`] when the caller's role lacks the
/// permission named above, and [`BridgeError::Core`] on DB errors.
pub async fn acknowledge_stock_alert_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    alert_id: String,
) -> Result<(), BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    require_inventory_permission(ctx, &session.user_id, oz_core::permissions::SALES_PROCESS)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    store.acknowledge_stock_alert(&alert_id, &session.user_id)?;
    Ok(())
}

/// Transition a pending sale's status to completed after payment capture.
///
/// Requires `SALES_PROCESS` permission.
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for an unknown or expired token,
/// [`BridgeError::PermissionDenied`] when the caller's role lacks the
/// permission named above, and [`BridgeError::Core`] on DB errors.
pub async fn finalize_sale(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    sale_id: String,
) -> Result<(), BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    require_inventory_permission(ctx, &session.user_id, oz_core::permissions::SALES_PROCESS)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    store.finalize_sale(&sale_id)?;
    Ok(())
}

/// Void a pending sale and restore stock.
///
/// Requires `SALES_PROCESS` permission.
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for an unknown or expired token,
/// [`BridgeError::PermissionDenied`] when the caller's role lacks the
/// permission named above, and [`BridgeError::Core`] on DB errors.
pub async fn void_pending_sale(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    sale_id: String,
) -> Result<(), BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    require_inventory_permission(ctx, &session.user_id, oz_core::permissions::SALES_PROCESS)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    store.void_pending_sale(&sale_id)?;
    Ok(())
}

/// Invalidate the location resolver cache.
///
/// Requires `INVENTORY_VIEW` permission (LOC-06) — cache invalidation is a
/// read-path hygiene operation. Deliberately takes no store connection: the
/// resolver cache is process-global, so the gate is the whole operation.
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for an unknown or expired token and
/// [`BridgeError::PermissionDenied`] when the caller's role lacks
/// `INVENTORY_VIEW`.
pub async fn invalidate_location_cache_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<(), BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    require_inventory_permission(ctx, &session.user_id, oz_core::permissions::INVENTORY_VIEW)
        .await?;
    invalidate_location_cache();
    Ok(())
}
