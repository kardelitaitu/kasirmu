//! Product catalog commands.
//!
//! `list_products` fetches all products with category names and stock
//! quantities from the database and returns them as a JSON array.
//! The front-end uses this to populate the product grid.

use serde::{Deserialize, Serialize};
use tauri::{State, command};

use oz_core::availability::UsageCounts;
use oz_core::entitlements::Entitlements;
use oz_core::{Money, Store};

use oz_core::events::{ProductCreated, StockAdjusted};

use foundation::validate_not_empty;

use oz_core::permissions;

use crate::commands::authz::require_permission_for_user;
use crate::error::AppError;
use crate::state::AppState;

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

/// Adjust stock for a product identified by SKU.
///
/// Positive `delta` restocks, negative `delta` removes stock.
/// Returns the new quantity on success.
#[deprecated(note = "use adjust_stock_scoped instead")]
#[allow(deprecated)]
#[command]
pub async fn adjust_stock(
    args: AdjustStockArgs,
    state: State<'_, AppState>,
) -> Result<i64, AppError> {
    validate_not_empty("sku", &args.sku).map_err(|e| AppError::Invalid(e.to_string()))?;
    validate_not_empty("reason", &args.reason).map_err(|e| AppError::Invalid(e.to_string()))?;
    if args.delta == 0 {
        return Err(AppError::Invalid("delta must be non-zero".into()));
    }

    // Scope the DB borrow so Store (which is !Send) is dropped before
    // the next .await point when we lock the kernel for event publishing.
    let new_qty = {
        let db = state.db.lock().await;
        let tid = state.terminal_id.lock().await.clone();
        let store = oz_core::db::Store::new(&db).with_terminal_id(tid);
        #[allow(deprecated)]
        store.adjust_stock(&args.sku, args.delta)?
    };

    // Publish the StockAdjusted domain event so that subscribers
    // (AuditLogHandler, etc.) fire their side effects.
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
            // Logged by the bus; do not fail the command.
            tracing::warn!(sku = %args.sku, error = %e, "event bus publish failed");
        }
    }

    tracing::info!(sku = %args.sku, delta = %args.delta, reason = %args.reason, new_qty, "stock adjusted");
    Ok(new_qty)
}

/// A product DTO for the front-end, mapped from `ProductWithDetails`.
#[derive(Debug, Serialize)]
pub struct ProductDto {
    /// Stock-keeping unit — the human-readable product code.
    pub sku: String,
    /// Display name shown on receipts and the POS UI.
    pub name: String,
    /// Category display name, if the product is linked to a category.
    pub category: Option<String>,
    /// Sale price with currency.
    pub price: MoneyDto,
    /// Machine-readable barcode (EAN-13, UPC-A, etc.) if available.
    pub barcode: Option<String>,
    /// Whether the product is in stock (stock_qty > 0 or null = false).
    pub in_stock: bool,
    /// Current stock quantity, or `null` if tracking is disabled.
    pub stock_qty: Option<i64>,
    /// Tax rate IDs assigned to this product.
    pub tax_rate_ids: Vec<String>,
    /// ISO-8601 creation timestamp.
    pub created_at: String,
    /// ISO-8601 timestamp of the last price change.
    pub price_updated_at: String,
    /// Product type: "retail", "restaurant", or "both".
    pub product_type: String,
    /// Cost price in minor units (local-only, ADR #36).
    pub cost_minor: i64,
    /// Brand (free text).
    pub brand: Option<String>,
    /// Rack position code.
    pub rack_location: Option<String>,
    /// Free-text notes.
    pub notes: Option<String>,
    /// Unit of measure.
    pub unit: Option<String>,
    /// Active/sellable status.
    pub is_active: bool,
    /// Default supplier FK (local-only).
    pub default_supplier_id: Option<String>,
    /// Materialized popularity score (ADR #37) — retail grid sort key.
    pub popularity_score: f64,
}

/// Money DTO matching the front-end `Money` type (snake_case keys).
#[derive(Debug, Serialize)]
pub struct MoneyDto {
    /// Minor Units.
    pub minor_units: i64,
    /// ISO-4217 currency code.
    pub currency: String,
}

/// Fetch all products from the database.
///
/// Returns an array of product DTOs with category names and stock
/// status. The front-end calls this on mount to populate the product
/// lookup grid.
#[command]
pub async fn list_products(state: State<'_, AppState>) -> Result<Vec<ProductDto>, AppError> {
    let db = state.db.lock().await;
    run_list_products(&db)
}

/// Fetch warehouse-tracked products only (excludes services).
#[command]
pub async fn list_warehouse_products(
    state: State<'_, AppState>,
) -> Result<Vec<ProductDto>, AppError> {
    let db = state.db.lock().await;
    run_list_warehouse_products(&db)
}

/// Business logic for listing products (extracted for testing).
fn run_list_products(conn: &rusqlite::Connection) -> Result<Vec<ProductDto>, AppError> {
    let store = Store::new(conn);
    let products = store.list_products()?;
    map_products_to_dtos(&store, products)
}

/// Business logic for listing warehouse-tracked products only.
fn run_list_warehouse_products(conn: &rusqlite::Connection) -> Result<Vec<ProductDto>, AppError> {
    let store = Store::new(conn);
    let products = store.list_warehouse_products()?;
    map_products_to_dtos(&store, products)
}

/// Shared mapping from a vec of ProductWithDetails to ProductDto vec.
fn map_products_to_dtos(
    store: &Store<'_>,
    products: Vec<oz_core::db::ProductWithDetails>,
) -> Result<Vec<ProductDto>, AppError> {
    let dtos: Vec<ProductDto> = products
        .into_iter()
        .map(|pwd| {
            let cur_str = std::str::from_utf8(&pwd.product.price.currency.0)
                .unwrap_or("USD")
                .to_owned();
            ProductDto {
                sku: pwd.product.sku.to_string(),
                name: pwd.product.name,
                category: pwd.category_name,
                price: MoneyDto {
                    minor_units: pwd.product.price.minor_units,
                    currency: cur_str,
                },
                barcode: pwd.product.barcode.as_ref().map(|b| b.to_string()),
                in_stock: pwd.stock_qty.is_some_and(|q| q > 0),
                stock_qty: pwd.stock_qty,
                created_at: pwd.product.created_at,
                price_updated_at: pwd.product.price_updated_at,
                product_type: pwd.product.product_type.as_str().to_owned(),
                tax_rate_ids: store
                    .get_product_tax_rates(pwd.product.sku.as_str())
                    .unwrap_or_default(),
                cost_minor: pwd.product.cost_minor,
                brand: pwd.product.brand.clone(),
                rack_location: pwd.product.rack_location.clone(),
                notes: pwd.product.notes.clone(),
                unit: pwd.product.unit.clone(),
                is_active: pwd.product.is_active,
                default_supplier_id: pwd.product.default_supplier_id.clone(),
                popularity_score: pwd.popularity_score,
            }
        })
        .collect();
    Ok(dtos)
}

// ── Lookup by barcode ────────────────────────────────────────────────

/// Look up a single product by barcode.
///
/// Returns the product DTO or `null` when no match is found.
/// Returns validation error for empty barcodes.
#[command]
pub async fn lookup_by_barcode(
    barcode: String,
    state: State<'_, AppState>,
) -> Result<Option<ProductDto>, AppError> {
    validate_not_empty("barcode", &barcode).map_err(|e| AppError::Invalid(e.to_string()))?;
    let db = state.db.lock().await;
    let _store = Store::new(&db);
    let result = run_lookup_by_barcode(&db, &barcode);
    drop(db);
    result
}

/// Business logic for barcode lookup (extracted for testing).
fn run_lookup_by_barcode(
    conn: &rusqlite::Connection,
    barcode: &str,
) -> Result<Option<ProductDto>, AppError> {
    let store = Store::new(conn);
    let pwd = store.lookup_product_with_details_by_barcode(barcode)?;
    map_pwd_to_dto(&store, pwd)
}

/// Look up a single product by SKU.
///
/// Returns the product DTO or `null` when no match is found.
#[command]
pub async fn lookup_product_by_sku(
    sku: String,
    state: State<'_, AppState>,
) -> Result<Option<ProductDto>, AppError> {
    validate_not_empty("sku", &sku).map_err(|e| AppError::Invalid(e.to_string()))?;
    let db = state.db.lock().await;
    let _store = Store::new(&db);
    let result = run_lookup_product_by_sku(&db, &sku);
    drop(db);
    result
}

/// Business logic for SKU lookup (extracted for testing).
fn run_lookup_product_by_sku(
    conn: &rusqlite::Connection,
    sku: &str,
) -> Result<Option<ProductDto>, AppError> {
    let store = Store::new(conn);
    let pwd = store.get_product(sku)?;
    map_pwd_to_dto(&store, pwd)
}

/// Shared mapping from `ProductWithDetails` to `ProductDto`.
fn map_pwd_to_dto(
    store: &Store<'_>,
    pwd: Option<oz_core::db::ProductWithDetails>,
) -> Result<Option<ProductDto>, AppError> {
    let tax_rate_ids = match pwd {
        Some(ref p) => store
            .get_product_tax_rates(p.product.sku.as_str())
            .unwrap_or_default(),
        None => vec![],
    };
    Ok(pwd.map(|pwd| {
        let cur_str = std::str::from_utf8(&pwd.product.price.currency.0)
            .unwrap_or("USD")
            .to_owned();
        ProductDto {
            sku: pwd.product.sku.to_string(),
            name: pwd.product.name,
            category: pwd.category_name,
            price: MoneyDto {
                minor_units: pwd.product.price.minor_units,
                currency: cur_str,
            },
            barcode: pwd.product.barcode.as_ref().map(|b| b.to_string()),
            in_stock: pwd.stock_qty.is_some_and(|q| q > 0),
            stock_qty: pwd.stock_qty,
            tax_rate_ids,
            product_type: pwd.product.product_type.as_str().to_owned(),
            created_at: pwd.product.created_at,
            price_updated_at: pwd.product.price_updated_at,
            cost_minor: pwd.product.cost_minor,
            brand: pwd.product.brand.clone(),
            rack_location: pwd.product.rack_location.clone(),
            notes: pwd.product.notes.clone(),
            unit: pwd.product.unit.clone(),
            is_active: pwd.product.is_active,
            default_supplier_id: pwd.product.default_supplier_id.clone(),
            popularity_score: pwd.popularity_score,
        }
    }))
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

fn default_product_type() -> String {
    "retail".to_owned()
}

#[derive(Debug, Serialize)]
/// Createproductresult.
pub struct CreateProductResult {
    /// Stock-keeping unit identifier.
    pub sku: String,
}

#[command]
/// Create product.
pub async fn create_product(
    args: CreateProductArgs,
    state: State<'_, AppState>,
) -> Result<CreateProductResult, AppError> {
    // Quota: the tier's product/menu cap (subscription-tiers.md §Numeric
    // Limits) is enforced before creation. This legacy pre-session command
    // runs against the global database, so both the tier and the product
    // count come from that single connection.
    let sub = {
        let global_db = state.db.lock().await;
        oz_core::TenantSubscription::validate_clock_rollback(&global_db)?;
        let sub = oz_core::TenantSubscription::load(&global_db, "default")?
            .ok_or_else(|| AppError::Internal("default tenant subscription not found".into()))?;
        sub.verify_signature()?;
        sub
    };
    // Scope the DB borrow so Store (which is !Send) is dropped before
    // the next .await point when we lock the kernel for event publishing.
    {
        let db = state.db.lock().await;
        let store = Store::new(&db);

        require_permission_for_user(&store, &args.user_id, permissions::PRODUCTS_CREATE)?;
        // ADR #36 D7: setting a cost (HPP) requires the manager-only
        // products:edit_cost permission — staff can create products without
        // ever touching cost.
        if args.cost_minor != 0 {
            require_permission_for_user(&store, &args.user_id, permissions::PRODUCTS_EDIT_COST)?;
        }
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

    // Publish the ProductCreated domain event so that subscribers
    // (AuditLogHandler, etc.) fire their side effects.
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
            // Logged by the bus; do not fail the command.
            tracing::warn!(sku = %args.sku, error = %e, "event bus publish failed");
        }
    }

    tracing::info!(sku = %args.sku, name = %args.name, "product created");
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

impl UpdateProductArgs {
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

#[command]
/// Update product.
pub async fn update_product(
    args: UpdateProductArgs,
    state: State<'_, AppState>,
) -> Result<UpdateProductResult, AppError> {
    let db = state.db.lock().await;
    let store = Store::new(&db);

    require_permission_for_user(&store, &args.user_id, permissions::PRODUCTS_UPDATE)?;
    // ADR #36 D7: changing a product's cost (HPP) requires the manager-only
    // products:edit_cost permission. A PATCH that does not touch cost
    // (cost_minor absent) stays open to PRODUCTS_UPDATE holders.
    if args.cost_minor.is_some() {
        require_permission_for_user(&store, &args.user_id, permissions::PRODUCTS_EDIT_COST)?;
    }

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

    Ok(UpdateProductResult { sku: args.sku })
}

/// Check whether a product tracks serial numbers.
#[command]
pub async fn get_product_track_serial(
    sku: String,
    state: State<'_, AppState>,
) -> Result<bool, AppError> {
    let db = state.db.lock().await;
    let store = Store::new(&db);
    let product = store.get_product(&sku)?;
    drop(db);
    Ok(product.map(|p| p.product.track_serial).unwrap_or(false))
}

/// A single serial-tracking flag keyed by SKU (batch response row).
#[derive(Debug, Serialize)]
pub struct SerialTrackRow {
    /// Stock-keeping unit.
    pub sku: String,
    /// Whether the product is configured for serial tracking.
    pub track_serial: bool,
}

/// Check serial-tracking flags for many SKUs in one round trip
/// (PERF-03: replaces the N+1 `get_product_track_serial` loop).
/// Unknown SKUs resolve to `track_serial: false`; order is preserved.
#[command]
pub async fn get_product_track_serial_batch(
    skus: Vec<String>,
    state: State<'_, AppState>,
) -> Result<Vec<SerialTrackRow>, AppError> {
    let db = state.db.lock().await;
    let store = Store::new(&db);
    let rows = run_get_product_track_serial_batch(&store, &skus);
    drop(db);
    Ok(rows)
}

/// Business logic for the batch serial-tracking lookup (extracted for testing).
fn run_get_product_track_serial_batch(store: &Store<'_>, skus: &[String]) -> Vec<SerialTrackRow> {
    skus.iter()
        .map(|sku| {
            // get_product returns Result<Option<ProductWithDetails>> —
            // collapse both error and missing-product into `false` so the
            // batch never fails for unknown SKUs (matches single-SKU).
            let track_serial = store
                .get_product(sku)
                .ok()
                .flatten()
                .map(|p| p.product.track_serial)
                .unwrap_or(false);
            SerialTrackRow {
                sku: sku.clone(),
                track_serial,
            }
        })
        .collect()
}

// ── Popularity search signal (ADR #37) ──────────────────────────────

/// Record an acted-upon product search for the popularity index.
///
/// ADR #37 D2: only searches that end in an add-to-cart count. Fire
/// and forget — failures are logged, never surfaced.
#[command]
pub async fn record_product_search(
    sku: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let db = state.db.lock().await;
    let store = Store::new(&db);
    match store.record_product_search(&sku) {
        Ok(()) => {}
        Err(e) => {
            tracing::warn!(sku = %sku, error = %e, "product search signal not recorded");
        }
    }
    drop(db);
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

#[command]
/// Delete product.
pub async fn delete_product(
    args: DeleteProductArgs,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let db = state.db.lock().await;
    let store = Store::new(&db);
    require_permission_for_user(&store, &args.user_id, permissions::PRODUCTS_DELETE)?;
    store.delete_product(&args.sku)?;
    Ok(())
}

/// Session-scoped variant of `adjust_stock`.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn adjust_stock_scoped(
    session_token: String,
    args: AdjustStockArgs,
    state: State<'_, AppState>,
) -> Result<i64, AppError> {
    validate_not_empty("sku", &args.sku).map_err(|e| AppError::Invalid(e.to_string()))?;
    validate_not_empty("reason", &args.reason).map_err(|e| AppError::Invalid(e.to_string()))?;
    if args.delta == 0 {
        return Err(AppError::Invalid("delta must be non-zero".into()));
    }

    // Get terminal_id before acquiring the DB lock (await must not be
    // inside a block that holds a std::sync::MutexGuard, which is !Send).
    let tid = state.terminal_id.lock().await.clone();

    // Scope the DB borrow so Store (which is !Send) is dropped before
    // the next .await point when we lock the kernel for event publishing.
    let new_qty = {
        let (_session, conn_arc) = state.resolve_scope(&session_token)?;
        let db_guard = conn_arc
            .lock()
            .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
        let db = &*db_guard;
        let store = oz_core::db::Store::new(&db).with_terminal_id(tid);
        #[allow(deprecated)]
        store.adjust_stock(&args.sku, args.delta)?
    };

    // Publish the StockAdjusted domain event so that subscribers
    // (AuditLogHandler, etc.) fire their side effects.
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
            // Logged by the bus; do not fail the command.
            tracing::warn!(sku = %args.sku, error = %e, "event bus publish failed");
        }
    }

    tracing::info!(sku = %args.sku, delta = %args.delta, reason = %args.reason, new_qty, "stock adjusted");
    Ok(new_qty)
}

/// Session-scoped variant of `list_products`.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn list_products_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<ProductDto>, AppError> {
    let (_session, conn_arc) = state.resolve_scope(&session_token)?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    run_list_products(&db)
}

/// Session-scoped variant of `list_warehouse_products`.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn list_warehouse_products_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<ProductDto>, AppError> {
    let (_session, conn_arc) = state.resolve_scope(&session_token)?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    run_list_warehouse_products(&db)
}

/// Session-scoped variant of `lookup_by_barcode`.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn lookup_by_barcode_scoped(
    session_token: String,
    barcode: String,
    state: State<'_, AppState>,
) -> Result<Option<ProductDto>, AppError> {
    validate_not_empty("barcode", &barcode).map_err(|e| AppError::Invalid(e.to_string()))?;
    let (_session, conn_arc) = state.resolve_scope(&session_token)?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let _store = Store::new(&db);
    let result = run_lookup_by_barcode(&db, &barcode);
    drop(db);
    result
}

/// Session-scoped variant of `lookup_product_by_sku`.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn lookup_product_by_sku_scoped(
    session_token: String,
    sku: String,
    state: State<'_, AppState>,
) -> Result<Option<ProductDto>, AppError> {
    validate_not_empty("sku", &sku).map_err(|e| AppError::Invalid(e.to_string()))?;
    let (_session, conn_arc) = state.resolve_scope(&session_token)?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let _store = Store::new(&db);
    let result = run_lookup_product_by_sku(&db, &sku);
    drop(db);
    result
}

/// Session-scoped variant of `create_product`.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn create_product_scoped(
    session_token: String,
    args: CreateProductArgs,
    state: State<'_, AppState>,
) -> Result<CreateProductResult, AppError> {
    // Scope the DB borrow so Store (which is !Send) is dropped before
    // the next .await point when we lock the kernel for event publishing.
    {
        let (session, conn_arc) = state.resolve_scope(&session_token)?;
        // Quota: the tier's product/menu cap (subscription-tiers.md
        // §Numeric Limits) is enforced per-location catalog before
        // creation. Tier from the global identity DB, count from the
        // scoped store DB.
        let sub = {
            let global_db = state.db.lock().await;
            oz_core::TenantSubscription::validate_clock_rollback(&global_db)?;
            oz_core::TenantSubscription::load(&global_db, "default")?
                .ok_or_else(|| AppError::Internal("default tenant subscription not found".into()))?
        };
        sub.verify_signature()?;
        let db_guard = conn_arc
            .lock()
            .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
        let db = &*db_guard;
        let store = Store::new(&db);

        require_permission_for_user(&store, &session.user_id, permissions::PRODUCTS_CREATE)?;
        // ADR #36 D7: setting a cost (HPP) requires the manager-only
        // products:edit_cost permission — staff can create products without
        // ever touching cost.
        if args.cost_minor != 0 {
            require_permission_for_user(&store, &session.user_id, permissions::PRODUCTS_EDIT_COST)?;
        }
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

    // Publish the ProductCreated domain event so that subscribers
    // (AuditLogHandler, etc.) fire their side effects.
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
            // Logged by the bus; do not fail the command.
            tracing::warn!(sku = %args.sku, error = %e, "event bus publish failed");
        }
    }

    tracing::info!(sku = %args.sku, name = %args.name, "product created");
    Ok(CreateProductResult { sku: args.sku })
}

/// Session-scoped variant of `update_product`.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn update_product_scoped(
    session_token: String,
    args: UpdateProductArgs,
    state: State<'_, AppState>,
) -> Result<UpdateProductResult, AppError> {
    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);

    require_permission_for_user(&store, &session.user_id, permissions::PRODUCTS_UPDATE)?;
    // ADR #36 D7: changing a product's cost (HPP) requires the manager-only
    // products:edit_cost permission. A PATCH that does not touch cost
    // (cost_minor absent) stays open to PRODUCTS_UPDATE holders.
    if args.cost_minor.is_some() {
        require_permission_for_user(&store, &session.user_id, permissions::PRODUCTS_EDIT_COST)?;
    }

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

    Ok(UpdateProductResult { sku: args.sku })
}

/// Session-scoped variant of `get_product_track_serial`.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn get_product_track_serial_scoped(
    session_token: String,
    sku: String,
    state: State<'_, AppState>,
) -> Result<bool, AppError> {
    let (_session, conn_arc) = state.resolve_scope(&session_token)?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    let product = store.get_product(&sku)?;
    drop(db);
    Ok(product.map(|p| p.product.track_serial).unwrap_or(false))
}

/// Session-scoped variant of `get_product_track_serial_batch`.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn get_product_track_serial_batch_scoped(
    session_token: String,
    skus: Vec<String>,
    state: State<'_, AppState>,
) -> Result<Vec<SerialTrackRow>, AppError> {
    let (_session, conn_arc) = state.resolve_scope(&session_token)?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    let rows = run_get_product_track_serial_batch(&store, &skus);
    drop(db);
    Ok(rows)
}

/// Session-scoped variant of `record_product_search`.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn record_product_search_scoped(
    session_token: String,
    sku: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let (_session, conn_arc) = state.resolve_scope(&session_token)?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    match store.record_product_search(&sku) {
        Ok(()) => {}
        Err(e) => {
            tracing::warn!(sku = %sku, error = %e, "product search signal not recorded");
        }
    }
    drop(db);
    Ok(())
}

/// Session-scoped variant of `delete_product`.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn delete_product_scoped(
    session_token: String,
    args: DeleteProductArgs,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    require_permission_for_user(&store, &session.user_id, permissions::PRODUCTS_DELETE)?;
    store.delete_product(&args.sku)?;
    Ok(())
}

#[cfg(test)]
#[path = "products_tests.rs"]
mod tests;
