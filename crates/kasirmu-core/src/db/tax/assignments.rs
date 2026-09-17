//! Product/category ↔ tax-rate junction assignments.
//!
//! Which rates a product or a category carries: the `product_taxes` /
//! `category_taxes` junction tables' whole read/write surface, including the
//! TAX-03 active-rate guard every assignment passes through and the PROD-12
//! batch read the catalog list endpoints use. Rate records themselves are in
//! [`super::rates`]; whether a rate may price a sale at a scope is decided by
//! [`super::scopes`].
//!
//! Split from `db/tax.rs` 13-09-26, behaviour unchanged — pure module
//! decomposition, no logic edits.

use rusqlite::params;

use crate::db::Store;
use crate::error::CoreError;

impl Store<'_> {
    /// Validate that every id in `tax_rate_ids` resolves to an active
    /// (`is_active = 1`) tax rate.
    ///
    /// TAX-03: archived rates are immutable and hidden — an assignment
    /// must not silently point a product/category at one. Unknown ids are
    /// rejected with the same structured `NotFound` so a stale/malformed
    /// payload cannot wedge a junction row against a missing rate.
    fn ensure_active_tax_rate_ids(&self, tax_rate_ids: &[String]) -> Result<(), CoreError> {
        for id in tax_rate_ids {
            if self.get_tax_rate(id)?.is_none() {
                return Err(CoreError::NotFound {
                    entity: "tax_rate",
                    id: id.clone(),
                });
            }
        }
        Ok(())
    }

    /// Assign tax rates to a product.
    ///
    /// TAX-03: every id must resolve to an active rate — archived or
    /// unknown ids are rejected up front so the junction can never point
    /// at a hidden/immutable rate (defense-in-depth on top of the UI only
    /// listing active rates).
    pub fn set_product_tax_rates(
        &self,
        sku: &str,
        tax_rate_ids: &[String],
    ) -> Result<(), CoreError> {
        self.ensure_active_tax_rate_ids(tax_rate_ids)?;
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "DELETE FROM product_taxes WHERE product_sku = ?1",
            params![sku],
        )?;
        for id in tax_rate_ids {
            tx.execute(
                "INSERT OR IGNORE INTO product_taxes (product_sku, tax_rate_id) VALUES (?1, ?2)",
                params![sku, id],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Get all tax rate IDs assigned to a product.
    pub fn get_product_tax_rates(&self, sku: &str) -> Result<Vec<String>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT tax_rate_id FROM product_taxes WHERE product_sku = ?1 ORDER BY created_at",
        )?;
        let ids = stmt
            .query_map(params![sku], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(ids)
    }

    /// Get tax rate IDs for many products in one query (PROD-12).
    ///
    /// Returns a map of `product_sku -> [tax_rate_id, ...]` ordered by
    /// `created_at`. This replaces the per-product `get_product_tax_rates`
    /// loop in list endpoints, removing the N+1 database pattern for
    /// catalog loads. Products with no assignments are absent from the map.
    ///
    /// Bounds: the `IN (...)` clause binds one parameter per SKU, so very
    /// large catalogs are capped by SQLite's `SQLITE_MAX_VARIABLE_NUMBER`
    /// (999 in common builds). Callers with larger catalogs should chunk
    /// the SKU list; the current list endpoint stays well under this limit.
    pub fn get_product_tax_rates_batch(
        &self,
        skus: &[String],
    ) -> Result<std::collections::HashMap<String, Vec<String>>, CoreError> {
        use std::collections::HashMap;

        let mut map: HashMap<String, Vec<String>> = HashMap::new();
        if skus.is_empty() {
            return Ok(map);
        }
        let placeholders: Vec<String> = (1..=skus.len()).map(|i| format!("?{i}")).collect();
        let sql = format!(
            "SELECT product_sku, tax_rate_id FROM product_taxes \
             WHERE product_sku IN ({}) ORDER BY created_at",
            placeholders.join(", ")
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map(rusqlite::params_from_iter(skus.iter()), |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        for row in rows {
            let (sku, rate_id) = row?;
            map.entry(sku).or_default().push(rate_id);
        }
        Ok(map)
    }

    /// Assign tax rates to a category.
    ///
    /// TAX-03: every id must resolve to an active rate — archived or
    /// unknown ids are rejected up front (see
    /// `Self::ensure_active_tax_rate_ids`).
    pub fn set_category_tax_rates(
        &self,
        category_id: &str,
        tax_rate_ids: &[String],
    ) -> Result<(), CoreError> {
        self.ensure_active_tax_rate_ids(tax_rate_ids)?;
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "DELETE FROM category_taxes WHERE category_id = ?1",
            params![category_id],
        )?;
        for id in tax_rate_ids {
            tx.execute(
                "INSERT OR IGNORE INTO category_taxes (category_id, tax_rate_id) VALUES (?1, ?2)",
                params![category_id, id],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Get all tax rate IDs assigned to a category.
    pub fn get_category_tax_rates(&self, category_id: &str) -> Result<Vec<String>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT tax_rate_id FROM category_taxes WHERE category_id = ?1 ORDER BY created_at",
        )?;
        let ids = stmt
            .query_map(params![category_id], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(ids)
    }
}
