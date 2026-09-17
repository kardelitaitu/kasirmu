//! Recipe / Bill of Materials (BOM) domain types.
//!
//! A recipe maps a composite menu item (e.g. "Cheeseburger") to its
//! raw ingredient products (e.g. "Burger Bun", "Beef Patty") with
//! required quantities. When a composite item is sold, the system
//! deducts the ingredient quantities from inventory instead of (or
//! in addition to) deducting the composite item itself.

use serde::{Deserialize, Serialize};

/// A single ingredient row in a product recipe.
///
/// Maps a parent product (the composite menu item) to one of its
/// required ingredients with the quantity needed per unit of the
/// parent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecipeItem {
    /// ID of this recipe row.
    pub id: String,
    /// ID of the composite/parent product.
    pub parent_product_id: String,
    /// ID of the ingredient product.
    pub ingredient_product_id: String,
    /// Quantity of the ingredient required to make one unit of the parent.
    pub quantity_required: i64,
    /// Unit of measurement (e.g. "pcs", "g", "ml").
    pub unit: String,
}

#[cfg(test)]
#[path = "recipe_tests.rs"]
mod tests;
