//! Product-variant command bodies (Wave A / S7) — the tauri-free half of
//! `apps/desktop-client/src/commands/product_variants.rs`.
//!
//! Key functions: the session-scoped [`list_scoped`], [`get_scoped`],
//! [`create_scoped`], [`update_scoped`] and [`delete_scoped`] operations,
//! each consuming a [`BridgeCtx`]. There is no `run_*` `&Connection`
//! helper here: the variant bodies were logic-inline in the shell, so the
//! store work stays inside the scoped functions.
//!
//! Gate order, store construction (`Store::new`, cache-free — as the shell
//! used) and error paths are verbatim ports of the command bodies: a shim
//! builds the context, calls one function here, and maps [`BridgeError`]
//! back to `AppError` so the wire shape never moves.

use serde::{Deserialize, Serialize};

use oz_core::db::Store;
use oz_core::permissions;
use oz_core::{Money, ProductVariant};

use foundation::validate_not_empty;

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

// ── DTOs ──────────────────────────────────────────────────────────────

/// Money DTO matching the front-end `Money` type (snake_case keys).
#[derive(Debug, Serialize)]
pub struct MoneyDto {
    /// Minor Units.
    pub minor_units: i64,
    /// ISO-4217 currency code.
    pub currency: String,
}

/// Product variant DTO for the front-end.
#[derive(Debug, Serialize)]
pub struct ProductVariantDto {
    /// Unique identifier.
    pub id: String,
    /// Parent Sku.
    pub parent_sku: String,
    /// Display name.
    pub name: String,
    /// Stock-keeping unit identifier.
    pub sku: String,
    /// Unit price in minor currency units.
    pub price: Option<MoneyDto>,
    /// Barcode string.
    pub barcode: Option<String>,
    /// Display sort order.
    pub sort_order: i64,
    /// Whether this is active.
    pub is_active: bool,
    /// ISO-8601 creation timestamp.
    pub created_at: String,
    /// ISO-8601 last-update timestamp.
    pub updated_at: String,
}

impl From<ProductVariant> for ProductVariantDto {
    fn from(v: ProductVariant) -> Self {
        Self {
            id: v.id,
            parent_sku: v.parent_sku,
            name: v.name,
            sku: v.sku,
            price: v.price.map(|m| {
                let cur_str = std::str::from_utf8(&m.currency.0)
                    .unwrap_or("USD")
                    .to_owned();
                MoneyDto {
                    minor_units: m.minor_units,
                    currency: cur_str,
                }
            }),
            barcode: v.barcode.map(|b| b.to_string()),
            sort_order: v.sort_order,
            is_active: v.is_active,
            created_at: v.created_at,
            updated_at: v.updated_at,
        }
    }
}

// ── Create ────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
/// Createproductvariantargs.
pub struct CreateProductVariantArgs {
    /// Parent Sku.
    pub parent_sku: String,
    /// Display name.
    pub name: String,
    /// Stock-keeping unit identifier.
    pub sku: String,
    /// Price Minor.
    pub price_minor: Option<i64>,
    /// ISO-4217 currency code.
    pub currency: Option<String>,
    /// Barcode string.
    pub barcode: Option<String>,
    /// Display sort order.
    pub sort_order: Option<i64>,
    /// Whether this is active.
    pub is_active: Option<bool>,
}

#[derive(Debug, Serialize)]
/// Createproductvariantresult.
pub struct CreateProductVariantResult {
    /// Stock-keeping unit identifier.
    pub sku: String,
}

// ── Update ────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
/// Updateproductvariantargs.
pub struct UpdateProductVariantArgs {
    /// Stock-keeping unit identifier.
    pub sku: String,
    /// Display name.
    pub name: Option<String>,
    /// Price Minor.
    pub price_minor: Option<i64>,
    /// ISO-4217 currency code.
    pub currency: Option<String>,
    /// Barcode string.
    pub barcode: Option<String>,
    /// Display sort order.
    pub sort_order: Option<i64>,
    /// Whether this is active.
    pub is_active: Option<bool>,
}

#[derive(Debug, Serialize)]
/// Updateproductvariantresult.
pub struct UpdateProductVariantResult {
    /// Stock-keeping unit identifier.
    pub sku: String,
}

// ── List ──────────────────────────────────────────────────────────────

/// List the variants of a product for the store resolved from a session
/// token. ADR #7.
///
/// Gate order mirrors the command body: validate, resolve the session scope,
/// enforce `products:read` scope-aware against the global identity DB, then
/// open the store connection and read.
///
/// # Errors
///
/// Returns [`BridgeError::Invalid`] for an empty `parent_sku`,
/// [`BridgeError::InvalidSession`] for an unknown/expired token,
/// [`BridgeError::PermissionDenied`] without `products:read`, and
/// [`BridgeError::Internal`] when the store lock is poisoned.
pub async fn list_scoped(
    ctx: &BridgeCtx<'_>,
    parent_sku: &str,
    session_token: &str,
) -> Result<Vec<ProductVariantDto>, BridgeError> {
    validate_not_empty("parent_sku", parent_sku)
        .map_err(|e| BridgeError::Invalid(e.to_string()))?;

    let (session, conn) = ctx.resolve_scope(session_token)?;

    // F-017: enforce per-domain permission on this scoped command.

    ctx.require_session_permission(&session, permissions::PRODUCTS_READ)
        .await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let variants = store.list_product_variants(parent_sku)?;
    drop(db);

    let dtos: Vec<ProductVariantDto> = variants.into_iter().map(ProductVariantDto::from).collect();
    Ok(dtos)
}

// ── Get by SKU ────────────────────────────────────────────────────────

/// Fetch one product variant by SKU for the store resolved from a session
/// token. ADR #7.
///
/// # Errors
///
/// Returns [`BridgeError::Invalid`], [`BridgeError::InvalidSession`],
/// [`BridgeError::PermissionDenied`] or [`BridgeError::Internal`] /
/// [`BridgeError::Core`] on DB errors.
pub async fn get_scoped(
    ctx: &BridgeCtx<'_>,
    sku: &str,
    session_token: &str,
) -> Result<Option<ProductVariantDto>, BridgeError> {
    validate_not_empty("sku", sku).map_err(|e| BridgeError::Invalid(e.to_string()))?;

    let (session, conn) = ctx.resolve_scope(session_token)?;

    // F-017: enforce per-domain permission on this scoped command.

    ctx.require_session_permission(&session, permissions::PRODUCTS_READ)
        .await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let variant = store.get_product_variant(sku)?;
    drop(db);

    Ok(variant.map(ProductVariantDto::from))
}

// ── Delete ────────────────────────────────────────────────────────────

/// Delete a product variant by SKU in the store resolved from a session
/// token. ADR #7.
///
/// # Errors
///
/// Returns [`BridgeError::Invalid`], [`BridgeError::InvalidSession`],
/// [`BridgeError::PermissionDenied`] or [`BridgeError::Core`]
/// (not-found on the variant row).
pub async fn delete_scoped(
    ctx: &BridgeCtx<'_>,
    sku: &str,
    session_token: &str,
) -> Result<(), BridgeError> {
    validate_not_empty("sku", sku).map_err(|e| BridgeError::Invalid(e.to_string()))?;

    let (session, conn) = ctx.resolve_scope(session_token)?;

    // F-017: enforce per-domain permission on this scoped command.

    ctx.require_session_permission(&session, permissions::PRODUCTS_DELETE)
        .await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    store.delete_product_variant(sku)?;
    drop(db);

    tracing::info!(sku, "product variant deleted");
    Ok(())
}

/// Create a product variant in the store resolved from a session token
/// (scoped).
///
/// Validates the identifiers, builds the [`ProductVariant`] (optional
/// price, validated barcode, sort order) exactly as the shell did, then
/// enforces `products:create` on the session user before the store-scoped
/// write. ADR #7.
///
/// # Errors
///
/// Returns [`BridgeError::Invalid`] (validation / invalid currency or
/// barcode), [`BridgeError::InvalidSession`],
/// [`BridgeError::PermissionDenied`] or [`BridgeError::Core`] on the
/// insert.
pub async fn create_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: &CreateProductVariantArgs,
) -> Result<CreateProductVariantResult, BridgeError> {
    validate_not_empty("parent_sku", &args.parent_sku)
        .map_err(|e| BridgeError::Invalid(e.to_string()))?;
    validate_not_empty("name", &args.name).map_err(|e| BridgeError::Invalid(e.to_string()))?;
    validate_not_empty("sku", &args.sku).map_err(|e| BridgeError::Invalid(e.to_string()))?;

    let price = match (args.price_minor, args.currency.as_deref()) {
        (Some(minor), Some(cur_str)) => {
            let currency: oz_core::Currency = cur_str
                .parse()
                .map_err(|_| BridgeError::Invalid(format!("invalid currency '{cur_str}'")))?;
            Some(Money {
                minor_units: minor,
                currency,
            })
        }
        _ => None,
    };

    let mut variant =
        ProductVariant::new(args.parent_sku.clone(), args.name.clone(), args.sku.clone());
    if let Some(p) = price {
        variant = variant.with_price(p);
    }
    if let Some(ref barcode) = args.barcode {
        let parsed = foundation::Barcode::new(barcode)
            .map_err(|e| BridgeError::Invalid(e.message.to_string()))?;
        variant = variant.with_barcode(parsed);
    }
    if let Some(order) = args.sort_order {
        variant = variant.with_sort_order(order);
    }

    let (session, conn) = ctx.resolve_scope(session_token)?;

    // F-017: enforce per-domain permission on this scoped command.

    ctx.require_session_permission(&session, permissions::PRODUCTS_CREATE)
        .await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    store.create_product_variant(&variant)?;
    drop(db);

    tracing::info!(sku = %variant.sku, parent_sku = %variant.parent_sku, "product variant created (scoped)");
    Ok(CreateProductVariantResult { sku: variant.sku })
}

/// Update an existing product variant in the store resolved from a session
/// token (scoped).
///
/// Enforces `products:update` on the session user, loads the current row,
/// applies the present fields, and writes. ADR #7.
///
/// # Errors
///
/// Returns [`BridgeError::Invalid`] (validation / unknown variant),
/// [`BridgeError::InvalidSession`], [`BridgeError::PermissionDenied`]
/// or [`BridgeError::Core`] on DB errors.
pub async fn update_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: &UpdateProductVariantArgs,
) -> Result<UpdateProductVariantResult, BridgeError> {
    validate_not_empty("sku", &args.sku).map_err(|e| BridgeError::Invalid(e.to_string()))?;

    let (session, conn) = ctx.resolve_scope(session_token)?;

    // F-017: enforce per-domain permission on this scoped command.

    ctx.require_session_permission(&session, permissions::PRODUCTS_UPDATE)
        .await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    let mut variant = store
        .get_product_variant(&args.sku)?
        .ok_or_else(|| BridgeError::Invalid(format!("variant '{}' not found", args.sku)))?;

    if let Some(name) = &args.name {
        validate_not_empty("name", name).map_err(|e| BridgeError::Invalid(e.to_string()))?;
        variant.name = name.clone();
    }
    if let (Some(minor), Some(cur_str)) = (args.price_minor, args.currency.as_deref()) {
        let currency: oz_core::Currency = cur_str
            .parse()
            .map_err(|_| BridgeError::Invalid(format!("invalid currency '{cur_str}'")))?;
        variant.price = Some(Money {
            minor_units: minor,
            currency,
        });
    }
    if let Some(barcode) = &args.barcode {
        if barcode.is_empty() {
            variant.barcode = None;
        } else {
            let parsed = foundation::Barcode::new(barcode)
                .map_err(|e| BridgeError::Invalid(e.message.to_string()))?;
            variant.barcode = Some(parsed);
        }
    }
    if let Some(order) = args.sort_order {
        variant.sort_order = order;
    }
    if let Some(active) = args.is_active {
        variant.is_active = active;
    }

    // NOTE (S7 port): the shell re-stamped `variant.updated_at` with chrono
    // here, but the field is write-only on this path —
    // `Store::update_product_variant` sets `updated_at` in SQL
    // (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) and neither the stored row nor
    // the response reads the stamped value. The stamp is dropped so
    // oz-bridge stays chrono-free; observable behaviour is unchanged.
    store.update_product_variant(&variant)?;
    drop(db);

    tracing::info!(sku = %variant.sku, "product variant updated (scoped)");
    Ok(UpdateProductVariantResult { sku: variant.sku })
}
