//! Product catalog command bodies (Wave A / S9) — the tauri-free half of
//! `apps/desktop-tauri/src/commands/products.rs`.
//!
//! S9a landed the read half: [`list_scoped`](crate::products::list_scoped),
//! [`list_warehouse_products_at_location`](crate::products::list_warehouse_products_at_location), [`lookup_by_barcode`](crate::products::lookup_by_barcode),
//! [`lookup_product_by_sku`](crate::products::lookup_product_by_sku), [`get_product_track_serial`](crate::products::get_product_track_serial),
//! [`get_product_track_serial_batch`](crate::products::get_product_track_serial_batch), plus the pure `&Connection` /
//! `&Store` bodies behind the command file's `run_*` test adapters
//! ([`run_list_products`](crate::products::run_list_products), [`run_lookup_by_barcode`](crate::products::run_lookup_by_barcode),
//! [`run_lookup_product_by_sku`](crate::products::run_lookup_product_by_sku), [`run_get_product_track_serial_batch`](crate::products::run_get_product_track_serial_batch)).
//! S9b landed the write half: [`create_scoped`](crate::products::create_scoped), [`update_scoped`](crate::products::update_scoped),
//! [`delete_scoped`](crate::products::delete_scoped), [`adjust_stock_scoped`](crate::products::adjust_stock_scoped) (one `unchecked_transaction`
//! + the [`StockAdjusted`] event published via `ctx.publish_event` only
//! AFTER `tx.commit`) and [`record_product_search`](crate::products::record_product_search).
//!
//! Gate order, store construction (`Store::new`, cache-free — as the shell
//! used) and error paths are verbatim ports of the command bodies: a shim
//! builds the context, calls one function here, and maps [`BridgeError`](crate::error::BridgeError)
//! back to `AppError` so the wire shape never moves.

use serde::{Deserialize, Serialize};

use foundation::validate_not_empty;
use kasirmu_core::Money;
use kasirmu_core::availability::UsageCounts;
use kasirmu_core::db::Store;
use kasirmu_core::entitlements::Entitlements;
use kasirmu_core::events::ProductCreated;
use kasirmu_core::permissions;
use rusqlite::Connection;

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

pub mod dto;
pub use dto::{MoneyDto, ProductDto, ProductImageDto, SerialTrackRow};

/// Business logic for listing products over a locked store connection.
///
/// # Errors
///
/// Returns [`BridgeError::Core`] when the product or tax-rate query fails.
pub fn run_list_products(conn: &Connection) -> Result<Vec<ProductDto>, BridgeError> {
    let store = Store::new(conn);
    let products = store.list_products()?;
    map_products_to_dtos(&store, products)
}

/// Shared mapping from a vec of ProductWithDetails to ProductDto vec.
fn map_products_to_dtos(
    store: &Store<'_>,
    products: Vec<kasirmu_core::db::ProductWithDetails>,
) -> Result<Vec<ProductDto>, BridgeError> {
    // PROD-12: batch-load tax assignments in ONE query instead of one
    // `get_product_tax_rates` call per product (N+1 catalog-load pattern).
    let skus: Vec<String> = products
        .iter()
        .map(|pwd| pwd.product.sku.to_string())
        .collect();
    let tax_rates_by_sku = store.get_product_tax_rates_batch(&skus)?;
    let dtos: Vec<ProductDto> = products
        .into_iter()
        .map(|pwd| {
            let cur_str = std::str::from_utf8(&pwd.product.price.currency.0)
                .unwrap_or("USD")
                .to_owned();
            let sku = pwd.product.sku.to_string();
            let tax_rate_ids = tax_rates_by_sku.get(&sku).cloned().unwrap_or_default();
            ProductDto {
                id: pwd.product.id.clone(),
                sku,
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
                tax_rate_ids,
                cost_minor: pwd.product.cost_minor,
                brand: pwd.product.brand.clone(),
                rack_location: pwd.product.rack_location.clone(),
                notes: pwd.product.notes.clone(),
                unit: pwd.product.unit.clone(),
                is_active: pwd.product.is_active,
                default_supplier_id: pwd.product.default_supplier_id.clone(),
                popularity_score: pwd.popularity_score,
                image_hash: pwd.product.image_hash.clone(),
                images: Some(
                    pwd.images
                        .iter()
                        .map(|img| ProductImageDto {
                            slot: img.slot,
                            hash: img.hash.clone(),
                            position: img.position,
                        })
                        .collect(),
                ),
            }
        })
        .collect();
    Ok(dtos)
}

/// Business logic for barcode lookup over a locked store connection.
///
/// # Errors
///
/// Returns [`BridgeError::Core`] when the lookup query fails.
pub fn run_lookup_by_barcode(
    conn: &Connection,
    barcode: &str,
) -> Result<Option<ProductDto>, BridgeError> {
    let store = Store::new(conn);
    let pwd = store.lookup_product_with_details_by_barcode(barcode)?;
    map_pwd_to_dto(&store, pwd)
}

/// Business logic for SKU lookup over a locked store connection.
///
/// # Errors
///
/// Returns [`BridgeError::Core`] when the lookup query fails.
pub fn run_lookup_product_by_sku(
    conn: &Connection,
    sku: &str,
) -> Result<Option<ProductDto>, BridgeError> {
    let store = Store::new(conn);
    let pwd = store.get_product(sku)?;
    map_pwd_to_dto(&store, pwd)
}

/// Shared mapping from `ProductWithDetails` to `ProductDto`.
fn map_pwd_to_dto(
    store: &Store<'_>,
    pwd: Option<kasirmu_core::db::ProductWithDetails>,
) -> Result<Option<ProductDto>, BridgeError> {
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
            id: pwd.product.id.clone(),
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
            image_hash: pwd.product.image_hash.clone(),
            images: Some(
                pwd.images
                    .iter()
                    .map(|img| ProductImageDto {
                        slot: img.slot,
                        hash: img.hash.clone(),
                        position: img.position,
                    })
                    .collect(),
            ),
        }
    }))
}

/// Business logic for the batch serial-tracking lookup over a caller-built
/// store. Error and missing-product cases collapse into `track_serial = false`
/// so the batch never fails for unknown SKUs.
pub fn run_get_product_track_serial_batch(
    store: &Store<'_>,
    skus: &[String],
) -> Vec<SerialTrackRow> {
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

/// Fetch all products for the store resolved from a session token. ADR #7.
///
/// Gate order mirrors the command body: resolve the session, enforce
/// `products:read` scope-aware against the global identity DB, then open the
/// store connection and read.
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for an unknown/expired token,
/// [`BridgeError::PermissionDenied`] without `products:read`, and
/// [`BridgeError::Internal`] when the store lock is poisoned.
pub async fn list_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<Vec<ProductDto>, BridgeError> {
    // F-017: enforce per-domain permission on this scoped command.
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::PRODUCTS_READ)
        .await?;
    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    run_list_products(&db)
}

/// Fetch inventory-tracked products with stock at a specific location.
///
/// Used by the warehouse workspace to show per-location stock levels. The
/// `location_id` is the bound warehouse location from the topology editor
/// (workspace_instances → inventory_locations).
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`],
/// [`BridgeError::PermissionDenied`] without `inventory:adjust`, and
/// [`BridgeError::Core`] on query failures.
pub async fn list_warehouse_products_at_location(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    location_id: &str,
) -> Result<Vec<ProductDto>, BridgeError> {
    let session = ctx.resolve_session(session_token)?;

    // F-017: enforce per-domain permission on this scoped command.

    ctx.require_session_permission(&session, permissions::INVENTORY_ADJUST)
        .await?;
    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let products = store.list_warehouse_products_at_location(location_id)?;
    map_products_to_dtos(&store, products)
}

/// Look up a product by barcode for the store resolved from a session
/// token. ADR #7 scoped variant. No permission gate — the command body had
/// none, and inventing one would break legacy callers.
///
/// # Errors
///
/// Returns [`BridgeError::Invalid`] for an empty barcode and
/// [`BridgeError::Internal`] when the store lock is poisoned.
pub async fn lookup_by_barcode(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    barcode: &str,
) -> Result<Option<ProductDto>, BridgeError> {
    validate_not_empty("barcode", barcode).map_err(|e| BridgeError::Invalid(e.to_string()))?;
    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    run_lookup_by_barcode(&db, barcode)
}

/// Look up a product by SKU for the store resolved from a session token.
/// ADR #7 scoped variant. No permission gate — the command body had none.
///
/// # Errors
///
/// Returns [`BridgeError::Invalid`] for an empty SKU and
/// [`BridgeError::Internal`] when the store lock is poisoned.
pub async fn lookup_product_by_sku(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    sku: &str,
) -> Result<Option<ProductDto>, BridgeError> {
    validate_not_empty("sku", sku).map_err(|e| BridgeError::Invalid(e.to_string()))?;
    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    run_lookup_product_by_sku(&db, sku)
}

/// Check whether a product tracks serial numbers, store-scoped. ADR #7.
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`],
/// [`BridgeError::PermissionDenied`] without `products:read`, and
/// [`BridgeError::Core`] when the lookup query fails.
pub async fn get_product_track_serial(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    sku: &str,
) -> Result<bool, BridgeError> {
    // F-017: enforce per-domain permission on this scoped command.
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::PRODUCTS_READ)
        .await?;
    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let product = store.get_product(sku)?;
    Ok(product.map(|p| p.product.track_serial).unwrap_or(false))
}

/// Store-scoped batch variant of the serial-tracking lookup. ADR #7.
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`],
/// [`BridgeError::PermissionDenied`] without `products:read`, and
/// [`BridgeError::Internal`] when the store lock is poisoned.
pub async fn get_product_track_serial_batch(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    skus: &[String],
) -> Result<Vec<SerialTrackRow>, BridgeError> {
    // F-017: enforce per-domain permission on this scoped command.
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::PRODUCTS_READ)
        .await?;
    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    Ok(run_get_product_track_serial_batch(&store, skus))
}

// ── Stock adjustment (transaction + domain event) ───────────────────
pub mod stock;
pub use stock::{AdjustStockArgs, adjust_stock_scoped};

// ── Create product ──────────────────────────────────────────────────

/// Arguments for creating a product (global variant, `user_id` supplied).
#[derive(Debug, Deserialize)]
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

/// Args for `create_product_scoped` — identical to [`CreateProductArgs`]
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

/// Result of creating a product.
#[derive(Debug, Serialize)]
pub struct CreateProductResult {
    /// Stock-keeping unit identifier.
    pub sku: String,
}

/// Create a product within the store resolved from a session token.
///
/// ADR #7: the `user_id` for permission checks is read from the resolved
/// `SessionContext`, not passed as a frontend parameter. The product is
/// created in the store-scoped database for the session's `store_id`, and
/// the `ProductCreated` domain event is published after the write.
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`],
/// [`BridgeError::PermissionDenied`] without `products:create` (or
/// `products:edit_cost` when a non-zero cost is set, ADR #36 D7),
/// [`BridgeError::Invalid`] for an invalid currency, and
/// [`BridgeError::Internal`]/[`BridgeError::Core`] for quota,
/// subscription or DB failures.
pub async fn create_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: &CreateProductScopedArgs,
) -> Result<CreateProductResult, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::PRODUCTS_CREATE)
        .await?;
    // ADR #36 D7: setting a cost (HPP) requires the manager-only
    // products:edit_cost permission — staff can create products without
    // ever touching cost.
    if args.cost_minor != 0 {
        ctx.require_session_permission(&session, permissions::PRODUCTS_EDIT_COST)
            .await?;
    }
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;

    // Quota: the tier's product/menu cap (subscription-tiers.md §Numeric
    // Limits) is enforced per-location catalog before creation. The tier
    // comes from the global identity DB; the count from the store DB.
    let sub = {
        let global_db = ctx.lock_global().await;
        kasirmu_core::TenantSubscription::validate_clock_rollback(&global_db)?;
        kasirmu_core::TenantSubscription::load(&global_db, "default")?
            .ok_or_else(|| BridgeError::Internal("default tenant subscription not found".into()))?
    };
    sub.verify_signature()?;

    // Scope the DB borrow so Store (which is !Send) is dropped before
    // the next .await point when we lock the kernel for event publishing.
    {
        let db = conn
            .lock()
            .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
        let store = Store::new(&db);

        store.enforce_product_quota(
            &Entitlements::from_subscription(&sub, UsageCounts::default()).tier,
        )?;

        let currency: kasirmu_core::Currency = args
            .currency
            .parse()
            .map_err(|_| BridgeError::Invalid(format!("invalid currency '{}'", args.currency)))?;

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
            &kasirmu_core::db::CreateProductAttributes {
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
    ctx.publish_event(&ProductCreated {
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
    })
    .await;

    tracing::info!(sku = %args.sku, name = %args.name, "product created (scoped)");
    Ok(CreateProductResult {
        sku: args.sku.clone(),
    })
}

// ── Update product ──────────────────────────────────────────────────

/// Arguments for updating a product (global variant, `user_id` supplied).
#[derive(Debug, Deserialize)]
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

/// Args for `update_product_scoped` — identical to [`UpdateProductArgs`]
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
    fn to_update_attributes(&self) -> kasirmu_core::db::UpdateProductAttributes {
        kasirmu_core::db::UpdateProductAttributes {
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

/// Result of updating a product.
#[derive(Debug, Serialize)]
pub struct UpdateProductResult {
    /// Stock-keeping unit identifier.
    pub sku: String,
}

/// Update a product within the store resolved from a session token.
///
/// ADR #7: the `user_id` for permission checks is read from the resolved
/// `SessionContext`.
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`],
/// [`BridgeError::PermissionDenied`] without `products:update` (or
/// `products:edit_cost` when a cost change is present, ADR #36 D7),
/// [`BridgeError::Invalid`] for an invalid currency, and
/// [`BridgeError::Core`] on DB failures.
pub async fn update_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: &UpdateProductScopedArgs,
) -> Result<UpdateProductResult, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::PRODUCTS_UPDATE)
        .await?;
    // ADR #36 D7: changing a product's cost (HPP) requires the manager-only
    // products:edit_cost permission. A PATCH that does not touch cost
    // (cost_minor absent) stays open to PRODUCTS_UPDATE holders.
    if args.cost_minor.is_some() {
        ctx.require_session_permission(&session, permissions::PRODUCTS_EDIT_COST)
            .await?;
    }
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;

    // Scope the DB borrow so Store (which is !Send) is dropped before
    // any future .await points.
    {
        let db = conn
            .lock()
            .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
        let store = Store::new(&db);

        let currency: kasirmu_core::Currency = args
            .currency
            .parse()
            .map_err(|_| BridgeError::Invalid(format!("invalid currency '{}'", args.currency)))?;

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
    Ok(UpdateProductResult {
        sku: args.sku.clone(),
    })
}

/// Record an acted-upon product search for the popularity index (ADR #37).
///
/// Fire-and-forget: a tracking failure is logged and never fails the
/// command (ADR #37 D3 — a tracking failure must never fail an add-to-cart).
///
/// # Errors
///
/// Returns [`BridgeError::Internal`] when the store lock is poisoned;
/// store-level failures are logged, not propagated.
pub async fn record_product_search(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    sku: &str,
) -> Result<(), BridgeError> {
    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    match store.record_product_search(sku) {
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

/// Arguments for deleting a product (global variant, `user_id` supplied).
#[derive(Debug, Deserialize)]
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
/// ADR #7: the `user_id` for permission checks is read from the resolved
/// `SessionContext`.
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`],
/// [`BridgeError::PermissionDenied`] without `products:delete`, and
/// [`BridgeError::Core`] on DB failures.
pub async fn delete_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: &DeleteProductScopedArgs,
) -> Result<(), BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::PRODUCTS_DELETE)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;

    // Scope the DB borrow so Store (which is !Send) is dropped before
    // any future .await points.
    {
        let db = conn
            .lock()
            .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
        let store = Store::new(&db);
        store.delete_product(&args.sku)?;
    }

    tracing::info!(sku = %args.sku, "product deleted (scoped)");
    Ok(())
}

#[cfg(test)]
#[path = "products_tests.rs"]
mod tests;
