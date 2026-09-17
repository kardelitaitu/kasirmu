//! Recipe / BOM queries — composite product ingredient lookups.
/*
last audited 25-07-26 by RSA-Agent (oz-core slice B5)
crate: oz-core | status: SAFE | lint: CLEAN
findings: single parameterized query; correct
next: none | perf: N/A
*/
//!
//! When a composite menu item is sold, the system needs to know which
//! raw ingredients to deduct from inventory rather than (or in addition
//! to) deducting the composite item's own stock level.

use rusqlite::params;

use crate::error::CoreError;
use crate::recipe::RecipeItem;

use super::Store;

impl Store<'_> {
    /// Look up all ingredient rows for a composite product.
    ///
    /// Returns an empty vec if the product has no recipe (i.e. it is a
    /// simple product that should be deducted directly).
    pub fn get_recipe_ingredients(
        &self,
        parent_product_id: &str,
    ) -> Result<Vec<RecipeItem>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, parent_product_id, ingredient_product_id, quantity_required, unit
             FROM product_recipes
             WHERE parent_product_id = ?1
             ORDER BY id ASC",
        )?;
        let rows = stmt.query_map(params![parent_product_id], |row| {
            Ok(RecipeItem {
                id: row.get("id")?,
                parent_product_id: row.get("parent_product_id")?,
                ingredient_product_id: row.get("ingredient_product_id")?,
                quantity_required: row.get("quantity_required")?,
                unit: row.get("unit")?,
            })
        })?;
        let results: Result<Vec<_>, _> = rows.collect();
        Ok(results?)
    }
}

#[cfg(test)]
#[path = "recipes_tests.rs"]
mod tests;
