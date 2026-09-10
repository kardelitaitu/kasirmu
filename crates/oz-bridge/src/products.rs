//! Product catalog command bodies (Wave A / S9) — the tauri-free half of
//! `apps/desktop-client/src/commands/products.rs`.
//!
//! S9a landed the read half: [`list_scoped`],
//! [`list_warehouse_products_at_location`], [`lookup_by_barcode`],
//! [`lookup_product_by_sku`], [`get_product_track_serial`],
//! [`get_product_track_serial_batch`], plus the pure `&Connection` /
//! `&Store` bodies behind the command file's `run_*` test adapters
//! ([`run_list_products`], [`run_lookup_by_barcode`],
//! [`run_lookup_product_by_sku`], [`run_get_product_track_serial_batch`]).
//! S9b adds the write half (create / update / delete / stock adjust / search
//! signal) with its transaction and domain-event publishing.
//!
//! Gate order, store construction (`Store::new`, cache-free — as the shell
//! used) and error paths are verbatim ports of the command bodies: a shim
//! builds the context, calls one function here, and maps [`BridgeError`]
//! back to `AppError` so the wire shape never moves.

use serde::Serialize;

use foundation::validate_not_empty;
use oz_core::db::Store;
use oz_core::permissions;
use rusqlite::Connection;

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

/// A product-image assignment mirrored from the product-image command
/// module (spec 0046b).
///
/// The bridge crate cannot depend on the desktop shell, so `ProductDto`
/// carries this mirror instead of `commands::products_images::ProductImageDto`;
/// both serialize to the same `{slot, hash, position}` JSON shape, so the
/// wire contract is unchanged.
#[derive(Debug, Serialize)]
pub struct ProductImageDto {
    /// Slot 1 = primary; slots 2..5 = alternatives.
    pub slot: i32,
    /// Content-addressed hash (first 16 hex chars of sha-256).
    pub hash: String,
    /// Display order of alternatives (0-based).
    pub position: i32,
}

/// A product DTO for the front-end, mapped from `ProductWithDetails`.
#[derive(Debug, Serialize)]
pub struct ProductDto {
    /// Internal product ID (UUID) — used by image commands (spec 0046b).
    pub id: String,
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
    /// Slot-1 primary image content hash (spec 0046b); `None` = no image.
    pub image_hash: Option<String>,
    /// Content-addressed image assignments (slots 1..5) from the snapshot.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub images: Option<Vec<ProductImageDto>>,
}

/// Money DTO matching the front-end `Money` type (snake_case keys).
#[derive(Debug, Serialize)]
pub struct MoneyDto {
    /// Minor Units.
    pub minor_units: i64,
    /// ISO-4217 currency code.
    pub currency: String,
}

/// A single serial-tracking flag keyed by SKU (batch response row).
#[derive(Debug, Serialize)]
pub struct SerialTrackRow {
    /// Stock-keeping unit.
    pub sku: String,
    /// Whether the product is configured for serial tracking.
    pub track_serial: bool,
}

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
    products: Vec<oz_core::db::ProductWithDetails>,
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
    pwd: Option<oz_core::db::ProductWithDetails>,
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
