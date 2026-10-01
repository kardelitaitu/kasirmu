//! Product IPC wire types: the response DTOs the product reads and the
//! create/update/delete commands return.
//!
//! Split out of `products.rs` on 2026-09-27. `ProductImageDto` is a deliberate
//! MIRROR of `commands::products_images::ProductImageDto`: the bridge crate
//! cannot depend on the desktop shell, so the shape is restated here and both
//! serialize to the same `{slot, hash, position}` JSON, keeping the wire
//! contract unchanged (spec 0046b).

use serde::Serialize;

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
