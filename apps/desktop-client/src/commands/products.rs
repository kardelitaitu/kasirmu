//! Product catalog commands.
//!
//! `list_products` fetches all products with category names and stock
//! quantities from the database and returns them as a JSON array.
//! The front-end uses this to populate the product grid.
//!
//! Wave A / S9a: the read bodies (list / barcode + SKU lookup / serial
//! tracking) now live in the headless `oz_bridge::products` module. Each
//! `#[tauri::command]` below keeps its exact name, parameter list and
//! `Result<_, AppError>` return so the registered IPC surface and the
//! serialized error shape are unchanged; it borrows a `BridgeCtx` from
//! `AppState`, calls the bridge, and maps `BridgeError` back to
//! `AppError` variant-for-variant. The read DTOs moved with the bodies
//! and are re-exported so `use super::*` in `products_tests.rs` still
//! resolves them. The write bodies (create / update / delete / stock
//! adjust / search signal) are extracted in S9b.

use serde::{Deserialize, Serialize};
use tauri::State;

use oz_core::availability::UsageCounts;
use oz_core::entitlements::Entitlements;
use oz_core::inventory::{CANONICAL_DEFAULT_LOCATION_UUID, LocationId};
use oz_core::inventory_transaction::InventoryTransactionId;
use oz_core::{Money, Store};

use oz_core::events::{ProductCreated, StockAdjusted};

use foundation::validate_not_empty;

use oz_core::permissions;

use crate::commands::authz::require_permission_for_session;
use crate::error::AppError;
use crate::state::AppState;

pub use oz_bridge::products::{MoneyDto, ProductDto, SerialTrackRow};

// ── Adjust stock ────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
/// Adjuststockargs.
pub struct AdjustStockArgs {
    /// SKU of the product to adjust.
    pub sku: String,
    /// Quantity change (positive = restock, negative = removal).
    pub delta: i64,
    /// Reason for the adjustment (e.g. "stock-take", "damaged", "return").
    pub reason: String,
}

/// Adjust stock for the store resolved from a session token.
///
/// ADR #7: Scoped variant of `adjust_stock`. The frontend passes a
/// `session_token` instead of relying on the global database. The
/// backend resolves the token to a `SessionContext`, opens the
/// store-scoped database, and adjusts stock within that store only.
#[tauri::command]
pub async fn adjust_stock_scoped(
    session_token: String,
    args: AdjustStockArgs,
    state: State<'_, AppState>,
) -> Result<i64, AppError> {
    // F-017: enforce per-domain permission on this scoped command.
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::INVENTORY_ADJUST).await?;
    validate_not_empty("sku", &args.sku).map_err(|e| AppError::Invalid(e.to_string()))?;
    validate_not_empty("reason", &args.reason).map_err(|e| AppError::Invalid(e.to_string()))?;
    if args.delta == 0 {
        return Err(AppError::Invalid("delta must be non-zero".into()));
    }

    let conn = state
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;

    let new_qty = {
        let tid = state.terminal_id.lock().await.clone();
        let db = conn
            .lock()
            .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
        let store = state.store_with_tid(&db, tid);
        let tx = db
            .unchecked_transaction()
            .map_err(|e| AppError::Internal(format!("starting tx: {e}")))?;
        let loc = LocationId::from(CANONICAL_DEFAULT_LOCATION_UUID);
        let new_qty = store.adjust_stock_at_location_with_reason(
            &tx,
            &args.sku,
            args.delta,
            &loc,
            Some(&args.reason),
            Some(&InventoryTransactionId::new()),
            Some(&oz_core::terminal::TerminalId::from(
                session.terminal_id.as_str(),
            )),
            Some(&oz_core::user::UserId::from(session.user_id.clone())),
        )?;
        tx.commit()
            .map_err(|e| AppError::Internal(format!("commit tx: {e}")))?;
        new_qty
    };

    // Publish the StockAdjusted domain event.
    {
        let event = StockAdjusted {
            sku: args.sku.clone(),
            delta: args.delta,
            new_qty,
            reason: args.reason.clone(),
        };

        let kernel = state.kernel.lock().await;
        let bus = kernel.event_bus();
        if let Err(e) = bus.publish(&event) {
            tracing::warn!(sku = %args.sku, error = %e, "event bus publish failed");
        }
    }

    tracing::info!(sku = %args.sku, delta = %args.delta, reason = %args.reason, new_qty, "stock adjusted (scoped)");
    Ok(new_qty)
}

/// Fetch all products for the store resolved from a session token.
///
/// ADR #4 / ADR #7 canonical pattern: The frontend passes an opaque
/// `session_token` (obtained from `create_session`). The backend
/// resolves it to a `SessionContext` containing `store_id`, then
/// opens the store-scoped database and queries only that store's
/// products.
///
/// This is the reference implementation for all store-scoped domain
/// commands. New commands should follow this pattern.
#[tauri::command]
pub async fn list_products_scoped(
    state: State<'_, AppState>,
    session_token: String,
) -> Result<Vec<ProductDto>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::products::list_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Business logic for listing products (extracted for testing).
///
/// Thin adapter over `oz_bridge::products::run_list_products`: the name,
/// parameter list and `Result<_, AppError>` type are unchanged so the
/// sibling test module keeps matching on `AppError::Core`.
#[allow(dead_code)] // retained by the Wave-A extraction contract for sibling tests
fn run_list_products(conn: &rusqlite::Connection) -> Result<Vec<ProductDto>, AppError> {
    oz_bridge::products::run_list_products(conn).map_err(AppError::from)
}

/// Fetch inventory-tracked products with stock at a specific location.
///
/// Used by the warehouse workspace to show per-location stock levels.
/// The `location_id` is the bound warehouse location from the topology
/// editor (workspace_instances → inventory_locations).
#[tauri::command]
pub async fn list_warehouse_products_at_location(
    state: State<'_, AppState>,
    session_token: String,
    location_id: String,
) -> Result<Vec<ProductDto>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::products::list_warehouse_products_at_location(&ctx, &session_token, &location_id)
        .await
        .map_err(Into::into)
}

// ── Lookup by barcode ────────────────────────────────────────────────

/// Look up a product by barcode for the store resolved from a
/// session token. ADR #7 scoped variant.
#[tauri::command]
pub async fn lookup_by_barcode_scoped(
    session_token: String,
    barcode: String,
    state: State<'_, AppState>,
) -> Result<Option<ProductDto>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::products::lookup_by_barcode(&ctx, &session_token, &barcode)
        .await
        .map_err(Into::into)
}

/// Business logic for barcode lookup (extracted for testing).
///
/// Thin adapter over `oz_bridge::products::run_lookup_by_barcode`: the
/// name, parameter list and `Result<_, AppError>` type are unchanged so
/// the sibling test module keeps matching on `AppError::Core`.
#[allow(dead_code)] // retained by the Wave-A extraction contract for sibling tests
fn run_lookup_by_barcode(
    conn: &rusqlite::Connection,
    barcode: &str,
) -> Result<Option<ProductDto>, AppError> {
    oz_bridge::products::run_lookup_by_barcode(conn, barcode).map_err(AppError::from)
}

/// Look up a product by SKU for the store resolved from a
/// session token. ADR #7 scoped variant.
#[tauri::command]
pub async fn lookup_product_by_sku_scoped(
    session_token: String,
    sku: String,
    state: State<'_, AppState>,
) -> Result<Option<ProductDto>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::products::lookup_product_by_sku(&ctx, &session_token, &sku)
        .await
        .map_err(Into::into)
}

/// Business logic for SKU lookup (extracted for testing).
///
/// Thin adapter over `oz_bridge::products::run_lookup_product_by_sku`:
/// the name, parameter list and `Result<_, AppError>` type are unchanged
/// so the sibling test module keeps matching on `AppError::Core`.
#[allow(dead_code)] // retained by the Wave-A extraction contract for sibling tests
fn run_lookup_product_by_sku(
    conn: &rusqlite::Connection,
    sku: &str,
) -> Result<Option<ProductDto>, AppError> {
    oz_bridge::products::run_lookup_product_by_sku(conn, sku).map_err(AppError::from)
}

// ── Create product ──────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
/// Createproductargs.
pub struct CreateProductArgs {
    /// ID of the associated user.
    pub user_id: String,
    /// Stock-keeping unit identifier.
    pub sku: String,
    /// Display name.
    pub name: String,
    /// Price Minor.
    pub price_minor: i64,
    /// ISO-4217 currency code.
    pub currency: String,
    /// ID of the associated category.
    pub category_id: Option<String>,
    /// Barcode string.
    pub barcode: Option<String>,
    /// Initial Stock.
    pub initial_stock: i64,
    /// Tax Rate Ids.
    pub tax_rate_ids: Vec<String>,
    #[serde(default = "default_product_type")]
    /// Product Type.
    pub product_type: String,
    #[serde(default)]
    /// Cost price in minor units (ADR #36, local-only).
    pub cost_minor: i64,
    #[serde(default)]
    /// Brand (free text).
    pub brand: Option<String>,
    #[serde(default)]
    /// Rack position code.
    pub rack_location: Option<String>,
    #[serde(default)]
    /// Free-text notes.
    pub notes: Option<String>,
    #[serde(default)]
    /// Unit of measure.
    pub unit: Option<String>,
    #[serde(default = "default_true")]
    /// Active/sellable status.
    pub is_active: bool,
    #[serde(default)]
    /// Default supplier FK (local-only).
    pub default_supplier_id: Option<String>,
}

fn default_true() -> bool {
    true
}

/// Args for `create_product_scoped` — identical to `CreateProductArgs`
/// but without `user_id` (read from the session token instead).
#[derive(Debug, Deserialize)]
pub struct CreateProductScopedArgs {
    /// Stock-keeping unit identifier.
    pub sku: String,
    /// Display name.
    pub name: String,
    /// Price Minor.
    pub price_minor: i64,
    /// ISO-4217 currency code.
    pub currency: String,
    /// ID of the associated category.
    pub category_id: Option<String>,
    /// Barcode string.
    pub barcode: Option<String>,
    /// Initial Stock.
    pub initial_stock: i64,
    /// Tax Rate Ids.
    pub tax_rate_ids: Vec<String>,
    #[serde(default = "default_product_type")]
    /// Product Type.
    pub product_type: String,
    #[serde(default)]
    /// Cost price in minor units (ADR #36, local-only).
    pub cost_minor: i64,
    #[serde(default)]
    /// Brand (free text).
    pub brand: Option<String>,
    #[serde(default)]
    /// Rack position code.
    pub rack_location: Option<String>,
    #[serde(default)]
    /// Free-text notes.
    pub notes: Option<String>,
    #[serde(default)]
    /// Unit of measure.
    pub unit: Option<String>,
    #[serde(default = "default_true")]
    /// Active/sellable status.
    pub is_active: bool,
    #[serde(default)]
    /// Default supplier FK (local-only).
    pub default_supplier_id: Option<String>,
}

fn default_product_type() -> String {
    "retail".to_owned()
}

#[derive(Debug, Serialize)]
/// Createproductresult.
pub struct CreateProductResult {
    /// Stock-keeping unit identifier.
    pub sku: String,
}

/// Create a product within the store resolved from a session token.
///
/// ADR #7: Scoped variant of `create_product`. The `user_id` for
/// permission checks is read from the resolved `SessionContext`,
/// not passed as a frontend parameter. The product is created in
/// the store-scoped database for the session's `store_id`.
#[tauri::command]
pub async fn create_product_scoped(
    session_token: String,
    args: CreateProductScopedArgs,
    state: State<'_, AppState>,
) -> Result<CreateProductResult, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::PRODUCTS_CREATE).await?;
    // ADR #36 D7: setting a cost (HPP) requires the manager-only
    // products:edit_cost permission — staff can create products without
    // ever touching cost.
    if args.cost_minor != 0 {
        require_permission_for_session(&state, &session, permissions::PRODUCTS_EDIT_COST).await?;
    }
    let conn = state
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;

    // Quota: the tier's product/menu cap (subscription-tiers.md §Numeric
    // Limits) is enforced per-location catalog before creation. The tier
    // comes from the global identity DB; the count from the store DB.
    let sub = {
        let global_db = state.db.lock().await;
        oz_core::TenantSubscription::validate_clock_rollback(&global_db)?;
        oz_core::TenantSubscription::load(&global_db, "default")?
            .ok_or_else(|| AppError::Internal("default tenant subscription not found".into()))?
    };
    sub.verify_signature()?;

    // Scope the DB borrow so Store (which is !Send) is dropped before
    // the next .await point when we lock the kernel for event publishing.
    {
        let db = conn
            .lock()
            .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
        let store = Store::new(&db);

        store.enforce_product_quota(
            &Entitlements::from_subscription(&sub, UsageCounts::default()).tier,
        )?;

        let currency: oz_core::Currency = args
            .currency
            .parse()
            .map_err(|_| AppError::Invalid(format!("invalid currency '{}'", args.currency)))?;

        let price = Money {
            minor_units: args.price_minor,
            currency,
        };

        store.create_product_with_attributes(
            &args.sku,
            &args.name,
            price,
            args.category_id.as_deref(),
            args.barcode.as_deref(),
            args.initial_stock,
            Some(&args.product_type),
            &oz_core::db::CreateProductAttributes {
                cost_minor: args.cost_minor,
                brand: args.brand.clone(),
                rack_location: args.rack_location.clone(),
                notes: args.notes.clone(),
                unit: args.unit.clone(),
                is_active: args.is_active,
                default_supplier_id: args.default_supplier_id.clone(),
            },
        )?;

        store.set_product_tax_rates(&args.sku, &args.tax_rate_ids)?;
    } // db and store dropped here before .await

    // Publish the ProductCreated domain event.
    {
        let event = ProductCreated {
            sku: args.sku.clone(),
            name: args.name.clone(),
            price_minor: args.price_minor,
            currency: args.currency.clone(),
            category_id: args.category_id.clone(),
            barcode: args
                .barcode
                .as_ref()
                .and_then(|s| foundation::Barcode::new(s).ok()),
            initial_stock: args.initial_stock,
        };

        let kernel = state.kernel.lock().await;
        let bus = kernel.event_bus();
        if let Err(e) = bus.publish(&event) {
            tracing::warn!(sku = %args.sku, error = %e, "event bus publish failed");
        }
    }

    tracing::info!(sku = %args.sku, name = %args.name, "product created (scoped)");
    Ok(CreateProductResult { sku: args.sku })
}

// ── Update product ──────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
/// Updateproductargs.
pub struct UpdateProductArgs {
    /// ID of the associated user.
    pub user_id: String,
    /// Stock-keeping unit identifier.
    pub sku: String,
    /// Display name.
    pub name: String,
    /// Price Minor.
    pub price_minor: i64,
    /// ISO-4217 currency code.
    pub currency: String,
    /// ID of the associated category.
    pub category_id: Option<String>,
    /// Barcode string.
    pub barcode: Option<String>,
    /// Tax Rate Ids.
    pub tax_rate_ids: Vec<String>,
    /// Product Type.
    pub product_type: Option<String>,
    #[serde(default)]
    /// Updated cost in minor units (None keeps).
    pub cost_minor: Option<i64>,
    #[serde(default)]
    /// Updated brand — `null` clears, string sets, absent keeps.
    pub brand: Option<Option<String>>,
    #[serde(default)]
    /// Updated rack position code — `null` clears, string sets, absent keeps.
    pub rack_location: Option<Option<String>>,
    #[serde(default)]
    /// Updated notes — `null` clears, string sets, absent keeps.
    pub notes: Option<Option<String>>,
    #[serde(default)]
    /// Updated unit — `null` clears, string sets, absent keeps.
    pub unit: Option<Option<String>>,
    #[serde(default)]
    /// Updated active status.
    pub is_active: Option<bool>,
    #[serde(default)]
    /// Updated default supplier — `null` clears, string sets, absent keeps.
    pub default_supplier_id: Option<Option<String>>,
}

/// Args for `update_product_scoped` — identical to `UpdateProductArgs`
/// but without `user_id` (read from the session token instead).
#[derive(Debug, Deserialize)]
pub struct UpdateProductScopedArgs {
    /// Stock-keeping unit identifier.
    pub sku: String,
    /// Display name.
    pub name: String,
    /// Price Minor.
    pub price_minor: i64,
    /// ISO-4217 currency code.
    pub currency: String,
    /// ID of the associated category.
    pub category_id: Option<String>,
    /// Barcode string.
    pub barcode: Option<String>,
    /// Tax Rate Ids.
    pub tax_rate_ids: Vec<String>,
    /// Product Type.
    pub product_type: Option<String>,
    #[serde(default)]
    /// Updated cost in minor units (None keeps).
    pub cost_minor: Option<i64>,
    #[serde(default)]
    /// Updated brand — `null` clears, string sets, absent keeps.
    pub brand: Option<Option<String>>,
    #[serde(default)]
    /// Updated rack position code — `null` clears, string sets, absent keeps.
    pub rack_location: Option<Option<String>>,
    #[serde(default)]
    /// Updated notes — `null` clears, string sets, absent keeps.
    pub notes: Option<Option<String>>,
    #[serde(default)]
    /// Updated unit — `null` clears, string sets, absent keeps.
    pub unit: Option<Option<String>>,
    #[serde(default)]
    /// Updated active status.
    pub is_active: Option<bool>,
    #[serde(default)]
    /// Updated default supplier — `null` clears, string sets, absent keeps.
    pub default_supplier_id: Option<Option<String>>,
}

impl UpdateProductArgs {}

impl UpdateProductScopedArgs {
    /// Map the PATCH-style attribute fields onto the core update struct.
    fn to_update_attributes(&self) -> oz_core::db::UpdateProductAttributes {
        oz_core::db::UpdateProductAttributes {
            cost_minor: self.cost_minor,
            brand: self.brand.clone(),
            rack_location: self.rack_location.clone(),
            notes: self.notes.clone(),
            unit: self.unit.clone(),
            is_active: self.is_active,
            default_supplier_id: self.default_supplier_id.clone(),
        }
    }
}

#[derive(Debug, Serialize)]
/// Updateproductresult.
pub struct UpdateProductResult {
    /// Stock-keeping unit identifier.
    pub sku: String,
}

/// Update a product within the store resolved from a session token.
///
/// ADR #7: Scoped variant of `update_product`. The `user_id` for
/// permission checks is read from the resolved `SessionContext`.
#[tauri::command]
pub async fn update_product_scoped(
    session_token: String,
    args: UpdateProductScopedArgs,
    state: State<'_, AppState>,
) -> Result<UpdateProductResult, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::PRODUCTS_UPDATE).await?;
    // ADR #36 D7: changing a product's cost (HPP) requires the manager-only
    // products:edit_cost permission. A PATCH that does not touch cost
    // (cost_minor absent) stays open to PRODUCTS_UPDATE holders.
    if args.cost_minor.is_some() {
        require_permission_for_session(&state, &session, permissions::PRODUCTS_EDIT_COST).await?;
    }
    let conn = state
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;

    // Scope the DB borrow so Store (which is !Send) is dropped before
    // any future .await points.
    {
        let db = conn
            .lock()
            .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
        let store = Store::new(&db);

        let currency: oz_core::Currency = args
            .currency
            .parse()
            .map_err(|_| AppError::Invalid(format!("invalid currency '{}'", args.currency)))?;

        let price = Money {
            minor_units: args.price_minor,
            currency,
        };

        store.update_product(
            &args.sku,
            &args.name,
            price,
            args.category_id.as_deref(),
            args.barcode.as_deref(),
            args.product_type.as_deref(),
            None,
        )?;

        store.set_product_tax_rates(&args.sku, &args.tax_rate_ids)?;

        store.update_product_attributes(&args.sku, &args.to_update_attributes())?;
    }

    tracing::info!(sku = %args.sku, name = %args.name, "product updated (scoped)");
    Ok(UpdateProductResult { sku: args.sku })
}

/// Check whether a product tracks serial numbers, store-scoped. ADR #7.
#[tauri::command]
pub async fn get_product_track_serial_scoped(
    session_token: String,
    sku: String,
    state: State<'_, AppState>,
) -> Result<bool, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::products::get_product_track_serial(&ctx, &session_token, &sku)
        .await
        .map_err(Into::into)
}

/// Store-scoped batch variant of `get_product_track_serial_batch`. ADR #7.
#[tauri::command]
pub async fn get_product_track_serial_batch_scoped(
    session_token: String,
    skus: Vec<String>,
    state: State<'_, AppState>,
) -> Result<Vec<SerialTrackRow>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::products::get_product_track_serial_batch(&ctx, &session_token, &skus)
        .await
        .map_err(Into::into)
}

/// Business logic for the batch serial-tracking lookup (extracted for testing).
///
/// Thin adapter over `oz_bridge::products::run_get_product_track_serial_batch`:
/// the name, parameter list and `Vec<SerialTrackRow>` return are unchanged
/// so the sibling test module keeps its assertions.
#[allow(dead_code)] // retained by the Wave-A extraction contract for sibling tests
fn run_get_product_track_serial_batch(store: &Store<'_>, skus: &[String]) -> Vec<SerialTrackRow> {
    oz_bridge::products::run_get_product_track_serial_batch(store, skus)
}

// ── Popularity search signal (ADR #37) ──────────────────────────────

/// Record an acted-upon product search for the popularity index.
///
/// ADR #37 D2: only searches that end in an add-to-cart count — raw
/// search counts are polluted by typos and "do you have…" lookups, so
/// the UI fires this event when a search result is actually added.
///
/// Fire-and-forget from the frontend: the response is `()` and failures
/// are logged, never surfaced. The write is a single append to
/// `product_activity` plus a single-SKU score recompute.
#[tauri::command]
pub async fn record_product_search_scoped(
    session_token: String,
    sku: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let conn = state.resolve_store(&session_token)?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    match store.record_product_search(&sku) {
        Ok(()) => {}
        Err(e) => {
            // ADR #37 D3: non-blocking — a tracking failure must never
            // fail an add-to-cart.
            tracing::warn!(sku = %sku, error = %e, "product search signal not recorded");
        }
    }
    Ok(())
}

// ── Delete product ──────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
/// Deleteproductargs.
pub struct DeleteProductArgs {
    /// ID of the associated user.
    pub user_id: String,
    /// Stock-keeping unit identifier.
    pub sku: String,
}

/// Args for `delete_product_scoped` — no `user_id`; read from session.
#[derive(Debug, Deserialize)]
pub struct DeleteProductScopedArgs {
    /// Stock-keeping unit identifier.
    pub sku: String,
}

/// Delete a product within the store resolved from a session token.
///
/// ADR #7: Scoped variant of `delete_product`. The `user_id` for
/// permission checks is read from the resolved `SessionContext`.
#[tauri::command]
pub async fn delete_product_scoped(
    session_token: String,
    args: DeleteProductScopedArgs,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::PRODUCTS_DELETE).await?;
    let conn = state
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;

    // Scope the DB borrow so Store (which is !Send) is dropped before
    // any future .await points.
    {
        let db = conn
            .lock()
            .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
        let store = Store::new(&db);
        store.delete_product(&args.sku)?;
    }

    tracing::info!(sku = %args.sku, "product deleted (scoped)");
    Ok(())
}

#[cfg(test)]
#[path = "products_tests.rs"]
mod tests;
