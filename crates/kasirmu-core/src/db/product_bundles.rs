//! CRUD for product bundles and bundle-items.
/*
last audited 25-07-26 by RSA-Agent (oz-core slice B5 part 6)
crate: oz-core | status: SAFE | lint: CLEAN
findings: tx on every multi-row write; batched item load avoids N+1; clean
next: none | perf: batched load
*/
//!
//! A bundle is a single SKU that contains multiple sub-items. All
//! multi-row writes use transactions for atomicity.

use rusqlite::params;

use crate::error::CoreError;
use crate::product_bundle::{BundleItem, BundleWithItems, ProductBundle};

use super::Store;

// ── Row mappers ──────────────────────────────────────────────────────────

fn row_to_bundle(row: &rusqlite::Row) -> rusqlite::Result<ProductBundle> {
    Ok(ProductBundle {
        id: row.get("id")?,
        bundle_sku: row.get("bundle_sku")?,
        name: row.get("name")?,
        description: row.get("description")?,
        bundle_price_minor: row.get("bundle_price_minor")?,
        currency: row.get("currency")?,
        active: row.get::<_, i64>("active")? != 0,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn row_to_bundle_item(row: &rusqlite::Row) -> rusqlite::Result<BundleItem> {
    Ok(BundleItem {
        id: row.get("id")?,
        bundle_id: row.get("bundle_id")?,
        sku: row.get("sku")?,
        qty: row.get("qty")?,
        unit_price_minor: row.get("unit_price_minor")?,
    })
}

// ── CRUD ─────────────────────────────────────────────────────────────────

impl Store<'_> {
    /// List all bundles with their items.
    pub fn list_bundles(&self) -> Result<Vec<BundleWithItems>, CoreError> {
        let bundles = {
            let mut stmt = self.conn.prepare(
                "SELECT id, bundle_sku, name, description, bundle_price_minor,
                        currency, active, created_at, updated_at
                 FROM product_bundles
                 ORDER BY name",
            )?;
            let rows = stmt.query_map([], row_to_bundle)?;
            rows.map(|r| Ok(r?))
                .collect::<Result<Vec<_>, CoreError>>()?
        };

        let items = self.load_all_bundle_items()?;

        Ok(assemble(bundles, items))
    }

    /// Get a single bundle by id.
    pub fn get_bundle(&self, id: &str) -> Result<Option<BundleWithItems>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, bundle_sku, name, description, bundle_price_minor,
                    currency, active, created_at, updated_at
             FROM product_bundles
             WHERE id = ?1",
        )?;
        let bundle = match stmt.query_row(params![id], row_to_bundle) {
            Ok(b) => b,
            Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(None),
            Err(e) => return Err(e.into()),
        };

        let items = self.load_bundle_items(&bundle.id)?;
        Ok(Some(BundleWithItems { bundle, items }))
    }

    /// Look up a bundle by its SKU (for scanning/lookup).
    pub fn get_bundle_by_sku(&self, sku: &str) -> Result<Option<BundleWithItems>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, bundle_sku, name, description, bundle_price_minor,
                    currency, active, created_at, updated_at
             FROM product_bundles
             WHERE bundle_sku = ?1",
        )?;
        let bundle = match stmt.query_row(params![sku], row_to_bundle) {
            Ok(b) => b,
            Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(None),
            Err(e) => return Err(e.into()),
        };

        let items = self.load_bundle_items(&bundle.id)?;
        Ok(Some(BundleWithItems { bundle, items }))
    }

    /// Create a new bundle with its items in a transaction.
    pub fn create_bundle(
        &self,
        bundle: &ProductBundle,
        items: &[BundleItem],
    ) -> Result<BundleWithItems, CoreError> {
        let tx = self.conn.unchecked_transaction()?;

        tx.execute(
            "INSERT INTO product_bundles (id, bundle_sku, name, description, bundle_price_minor, currency, active, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                bundle.id,
                bundle.bundle_sku,
                bundle.name,
                bundle.description,
                bundle.bundle_price_minor,
                bundle.currency,
                if bundle.active { 1 } else { 0 },
                bundle.created_at,
                bundle.updated_at,
            ],
        )?;

        for item in items {
            tx.execute(
                "INSERT INTO bundle_items (id, bundle_id, sku, qty, unit_price_minor)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    item.id,
                    item.bundle_id,
                    item.sku,
                    item.qty,
                    item.unit_price_minor
                ],
            )?;
        }

        tx.commit()?;

        Ok(BundleWithItems {
            bundle: bundle.clone(),
            items: items.to_vec(),
        })
    }

    /// Update a bundle and replace its items in a transaction.
    pub fn update_bundle(
        &self,
        bundle: &ProductBundle,
        items: &[BundleItem],
    ) -> Result<BundleWithItems, CoreError> {
        let tx = self.conn.unchecked_transaction()?;

        tx.execute(
            "UPDATE product_bundles
             SET bundle_sku = ?2, name = ?3, description = ?4,
                 bundle_price_minor = ?5, currency = ?6, active = ?7,
                 updated_at = ?8
             WHERE id = ?1",
            params![
                bundle.id,
                bundle.bundle_sku,
                bundle.name,
                bundle.description,
                bundle.bundle_price_minor,
                bundle.currency,
                if bundle.active { 1 } else { 0 },
                bundle.updated_at,
            ],
        )?;

        // Delete old items and re-insert.
        tx.execute(
            "DELETE FROM bundle_items WHERE bundle_id = ?1",
            params![bundle.id],
        )?;
        for item in items {
            tx.execute(
                "INSERT INTO bundle_items (id, bundle_id, sku, qty, unit_price_minor)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    item.id,
                    item.bundle_id,
                    item.sku,
                    item.qty,
                    item.unit_price_minor
                ],
            )?;
        }

        tx.commit()?;

        Ok(BundleWithItems {
            bundle: bundle.clone(),
            items: items.to_vec(),
        })
    }

    /// Delete a bundle and its items.
    pub fn delete_bundle(&self, id: &str) -> Result<(), CoreError> {
        let tx = self.conn.unchecked_transaction()?;
        tx.execute("DELETE FROM bundle_items WHERE bundle_id = ?1", params![id])?;
        tx.execute("DELETE FROM product_bundles WHERE id = ?1", params![id])?;
        tx.commit()?;
        Ok(())
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────

impl Store<'_> {
    fn load_all_bundle_items(&self) -> Result<Vec<BundleItem>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, bundle_id, sku, qty, unit_price_minor
             FROM bundle_items
             ORDER BY bundle_id, sku",
        )?;
        let rows = stmt.query_map([], row_to_bundle_item)?;
        rows.map(|r| Ok(r?)).collect()
    }

    fn load_bundle_items(&self, bundle_id: &str) -> Result<Vec<BundleItem>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, bundle_id, sku, qty, unit_price_minor
             FROM bundle_items
             WHERE bundle_id = ?1
             ORDER BY sku",
        )?;
        let rows = stmt.query_map(params![bundle_id], row_to_bundle_item)?;
        rows.map(|r| Ok(r?)).collect()
    }
}

fn assemble(bundles: Vec<ProductBundle>, items: Vec<BundleItem>) -> Vec<BundleWithItems> {
    let mut grouped: std::collections::HashMap<String, Vec<BundleItem>> =
        std::collections::HashMap::new();
    for item in items {
        grouped
            .entry(item.bundle_id.clone())
            .or_default()
            .push(item);
    }
    bundles
        .into_iter()
        .map(|b| BundleWithItems {
            bundle: b.clone(),
            items: grouped.remove(&b.id).unwrap_or_default(),
        })
        .collect()
}

#[cfg(test)]
#[path = "product_bundles_tests.rs"]
mod tests;
