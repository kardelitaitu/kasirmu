//! Product variant domain type — size/colour/flavour per parent product.

use foundation::Barcode;
use serde::{Deserialize, Serialize};

use crate::Money;

/// A product variant linked to a parent product via `parent_sku`.
///
/// Each variant can have its own SKU, optional price override (when `price`
/// is `None` the parent product's price is used), barcode, and sort order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProductVariant {
    /// Internal row id (UUID v7).
    pub id: String,
    /// SKU of the parent product this variant belongs to.
    pub parent_sku: String,
    /// Display name of this variant (e.g., "Small", "Red", "Mint").
    pub name: String,
    /// Unique SKU for this variant.
    pub sku: String,
    /// Optional price override. `None` means use parent product's price.
    pub price: Option<Money>,
    /// Optional barcode (unique when present).
    pub barcode: Option<Barcode>,
    /// Display order within the variant list (ascending).
    pub sort_order: i64,
    /// Whether this variant is available for sale.
    pub is_active: bool,
    /// ISO-8601 creation timestamp.
    pub created_at: String,
    /// ISO-8601 last-update timestamp.
    pub updated_at: String,
}

impl ProductVariant {
    /// Create a new product variant with the given parent SKU, name, and own SKU.
    ///
    /// Generates a fresh UUID for `id`. Optional fields (`price`, `barcode`)
    /// default to `None`. `sort_order` defaults to `0` and `is_active` to `true`.
    /// Timestamps are empty strings (the database layer fills them in).
    pub fn new(
        parent_sku: impl Into<String>,
        name: impl Into<String>,
        sku: impl Into<String>,
    ) -> Self {
        Self {
            id: uuid::Uuid::now_v7().to_string(),
            parent_sku: parent_sku.into(),
            name: name.into(),
            sku: sku.into(),
            price: None,
            barcode: None,
            sort_order: 0,
            is_active: true,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    /// Set the price override (builder-style).
    #[must_use]
    pub fn with_price(mut self, price: Money) -> Self {
        self.price = Some(price);
        self
    }

    /// Set the barcode (builder-style).
    #[must_use]
    pub fn with_barcode(mut self, barcode: Barcode) -> Self {
        self.barcode = Some(barcode);
        self
    }

    /// Set the sort order (builder-style).
    #[must_use]
    pub fn with_sort_order(mut self, order: i64) -> Self {
        self.sort_order = order;
        self
    }
}

#[cfg(test)]
#[path = "product_variant_tests.rs"]
mod tests;
