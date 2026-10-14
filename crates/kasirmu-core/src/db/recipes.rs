//! Recipe / BOM queries — composite product ingredient lookups.
/*
last audited 25-07-26 by RSA-Agent (kasirmu-core slice B5)
crate: kasirmu-core | status: SAFE | lint: CLEAN
findings: single parameterized query; correct
next: none | perf: N/A
*/
//!
//! When a composite menu item is sold, the system needs to know which
//! raw ingredients to deduct from inventory rather than (or in addition
//! to) deducting the composite item's own stock level.

use rusqlite::params;

use crate::error::CoreError;
use crate::recipe::{RecipeIngredientInput, RecipeItem, RecipeItemDetails};

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

    /// Look up all recipe ingredients for a composite product with joined product details.
    ///
    /// Returns a list of [`RecipeItemDetails`] containing ingredient SKU, name,
    /// quantity, unit, and cost for dish margin calculation. Returns an empty vec
    /// if the product has no recipe.
    pub fn get_recipe_details(
        &self,
        parent_product_id: &str,
    ) -> Result<Vec<RecipeItemDetails>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT r.id, r.parent_product_id, r.ingredient_product_id,
                    p.sku AS ingredient_sku, p.name AS ingredient_name,
                    r.quantity_required, r.unit, COALESCE(p.cost_minor, 0) AS cost_minor
             FROM product_recipes r
             JOIN products p ON r.ingredient_product_id = p.id
             WHERE r.parent_product_id = ?1
             ORDER BY r.id ASC",
        )?;
        let rows = stmt.query_map(params![parent_product_id], |row| {
            Ok(RecipeItemDetails {
                id: row.get("id")?,
                parent_product_id: row.get("parent_product_id")?,
                ingredient_product_id: row.get("ingredient_product_id")?,
                ingredient_sku: row.get("ingredient_sku")?,
                ingredient_name: row.get("ingredient_name")?,
                quantity_required: row.get("quantity_required")?,
                unit: row.get("unit")?,
                cost_minor: row.get("cost_minor")?,
            })
        })?;
        let results: Result<Vec<_>, _> = rows.collect();
        Ok(results?)
    }

    /// Author or replace the recipe for a parent product.
    ///
    /// Atomically validates that the parent product exists, that each ingredient
    /// exists, that no self-references or duplicates exist, and replaces existing
    /// recipe rows with the new ingredients list in a single transaction.
    ///
    /// If `ingredients` is empty, existing recipe rows are deleted.
    pub fn set_recipe(
        &self,
        parent_product_id: &str,
        ingredients: &[RecipeIngredientInput],
    ) -> Result<Vec<RecipeItemDetails>, CoreError> {
        if parent_product_id.trim().is_empty() {
            return Err(CoreError::Validation {
                field: "parent_product_id",
                message: "parent_product_id must not be empty".into(),
            });
        }

        let tx = self.conn.unchecked_transaction()?;

        // 1. Verify parent product exists
        let parent_exists: bool = tx
            .query_row(
                "SELECT 1 FROM products WHERE id = ?1",
                params![parent_product_id],
                |_| Ok(true),
            )
            .unwrap_or(false);

        if !parent_exists {
            return Err(CoreError::NotFound {
                entity: "product",
                id: parent_product_id.to_string(),
            });
        }

        // 2. Validate ingredients
        let mut seen = std::collections::HashSet::new();
        for item in ingredients {
            if item.ingredient_product_id == parent_product_id {
                return Err(CoreError::Validation {
                    field: "ingredient_product_id",
                    message: "a product cannot be an ingredient of itself".into(),
                });
            }
            if !seen.insert(&item.ingredient_product_id) {
                return Err(CoreError::Validation {
                    field: "ingredient_product_id",
                    message: format!(
                        "duplicate ingredient product ID in recipe: {}",
                        item.ingredient_product_id
                    ),
                });
            }
            if item.quantity_required <= 0 {
                return Err(CoreError::Validation {
                    field: "quantity_required",
                    message: format!(
                        "quantity_required must be > 0, got {}",
                        item.quantity_required
                    ),
                });
            }

            let ing_exists: bool = tx
                .query_row(
                    "SELECT 1 FROM products WHERE id = ?1",
                    params![item.ingredient_product_id],
                    |_| Ok(true),
                )
                .unwrap_or(false);

            if !ing_exists {
                return Err(CoreError::NotFound {
                    entity: "product",
                    id: item.ingredient_product_id.clone(),
                });
            }
        }

        // 3. Delete existing recipe rows
        tx.execute(
            "DELETE FROM product_recipes WHERE parent_product_id = ?1",
            params![parent_product_id],
        )?;

        // 4. Insert new recipe rows
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        for item in ingredients {
            let row_id = uuid::Uuid::now_v7().to_string();
            let unit = if item.unit.trim().is_empty() {
                "pcs"
            } else {
                item.unit.trim()
            };
            tx.execute(
                "INSERT INTO product_recipes (id, parent_product_id, ingredient_product_id, quantity_required, unit, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
                params![
                    row_id,
                    parent_product_id,
                    item.ingredient_product_id,
                    item.quantity_required,
                    unit,
                    now,
                ],
            )?;
        }

        tx.commit()?;

        self.get_recipe_details(parent_product_id)
    }

    /// Delete a recipe for a product.
    ///
    /// Deletes all ingredient rows for `parent_product_id` in a single transaction.
    /// Returns the number of recipe rows removed.
    pub fn delete_recipe(&self, parent_product_id: &str) -> Result<usize, CoreError> {
        let tx = self.conn.unchecked_transaction()?;
        let count = tx.execute(
            "DELETE FROM product_recipes WHERE parent_product_id = ?1",
            params![parent_product_id],
        )?;
        tx.commit()?;
        Ok(count)
    }
}

#[cfg(test)]
#[path = "recipes_tests.rs"]
mod tests;
