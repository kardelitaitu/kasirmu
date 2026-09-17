//! Product bundle domain type — a single SKU that bundles multiple sub-items.
//!
//! A [`ProductBundle`] groups several products into one sellable unit.
//! Each component is a [`BundleItem`] with its own quantity and optional
//! price override. The `BundleWithItems` struct is the compound result
//! returned by list/get endpoints.

use serde::{Deserialize, Serialize};

/// A product bundle — a single SKU that contains multiple sub-items.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProductBundle {
    /// Internal row id (UUID v7).
    pub id: String,
    /// The bundle's own SKU (must match an existing product).
    pub bundle_sku: String,
    /// Display name for the bundle.
    pub name: String,
    /// Optional description shown on receipts / UI.
    pub description: String,
    /// Bundle-level price in minor units, if overridden.
    pub bundle_price_minor: Option<i64>,
    /// ISO currency code (e.g. "USD").
    pub currency: String,
    /// Whether the bundle is available for sale.
    pub active: bool,
    /// ISO-8601 creation timestamp.
    pub created_at: String,
    /// ISO-8601 last-update timestamp.
    pub updated_at: String,
}

/// An item within a bundle.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BundleItem {
    /// Internal row id (UUID v7).
    pub id: String,
    /// FK to [`ProductBundle::id`].
    pub bundle_id: String,
    /// SKU of the component product.
    pub sku: String,
    /// Quantity of this component in the bundle.
    pub qty: i64,
    /// Per-unit price override (None = use product's price).
    pub unit_price_minor: Option<i64>,
}

/// A bundle with its items (returned by list/get).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BundleWithItems {
    /// The bundle metadata.
    pub bundle: ProductBundle,
    /// Component items in the bundle.
    pub items: Vec<BundleItem>,
}

#[cfg(test)]
#[path = "product_bundle_tests.rs"]
mod tests;
