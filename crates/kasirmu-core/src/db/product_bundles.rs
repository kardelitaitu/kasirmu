//! CRUD for product bundles and bundle-items.
/*
last audited 25-07-26 by RSA-Agent (kasirmu-core slice B5 part 6)
crate: kasirmu-core | status: SAFE | lint: CLEAN
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

/// Insert one `bundle_items` row, mapping a missing component product to a
/// typed error naming the SKU (MSL-48).
///
/// `bundle_items.sku` is `REFERENCES products(sku)`, and the SKU arrives as an
/// untyped `String` that the editor renders as free text. Without this mapping
/// a typo reaches the caller as a bare `FOREIGN KEY constraint failed` — no
/// field, no SKU, and nothing saying the *product* is what is missing — while
/// the bridge forwards the value unvalidated and the screen shows its generic
/// "could not be saved" message, because a DB error is not the client-side
/// validation error that catch distinguishes.
///
/// `NotFound` with `entity: "product"` and the offending SKU as `id` is the
/// answer the UI can act on, and it matches how the rest of the crate reports a
/// reference to a row that is not there.
/// Insert one `product_bundles` row, mapping a missing bundle product to a typed
/// error naming the SKU (MSL-48).
///
/// `bundle_sku` is `UNIQUE REFERENCES products(sku)`: a bundle is itself a
/// product, so the bundle SKU must already exist. The same raw-FK problem as the
/// item SKUs, on the row written first.
fn insert_bundle_row(
    tx: &rusqlite::Transaction<'_>,
    bundle: &ProductBundle,
) -> Result<(), CoreError> {
    let result = tx.execute(
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
    );
    match result {
        Err(rusqlite::Error::SqliteFailure(e, _))
            if e.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            // `UNIQUE` on bundle_sku and `REFERENCES products(sku)` both raise
            // ConstraintViolation here; either way the SKU is what the caller
            // must change, so one message serves both.
            Err(CoreError::NotFound {
                entity: "product",
                id: bundle.bundle_sku.clone(),
            })
        }
        Err(e) => Err(e.into()),
        Ok(_) => Ok(()),
    }
}

fn insert_bundle_item(tx: &rusqlite::Transaction<'_>, item: &BundleItem) -> Result<(), CoreError> {
    // MSL-51: `bundle_items.qty` is `INTEGER NOT NULL DEFAULT 1` with no CHECK, and
    // nothing validated it on the write path — the desktop editor guards it
    // client-side (the bundle-management screen) but both shells reach the
    // same bridge command, so the tablet or any IPC caller could store a
    // non-positive quantity. Negative component counts are meaningless: nothing
    // sums them for money (the bundle has its own price), so they survive as
    // corrupt rows that stock deduction and reporting would read as real.
    //
    // Rejecting here rather than adding a DB CHECK keeps the failure a named
    // field instead of a raw constraint error (the MSL-40 lesson), and avoids a
    // migration for a rule the store can enforce.
    if item.qty <= 0 {
        return Err(CoreError::Validation {
            field: "qty",
            message: format!("bundle item quantity must be positive, got {}", item.qty),
        });
    }
    // MSL-51, same class: `unit_price_minor` is a price OVERRIDE with no CHECK and
    // no store-side validation, while the editor refuses negatives. Nothing in
    // `kasirmu-core` sums this column today (the `qty * unit_price_minor`
    // arithmetic at `sales_tax.rs:385` is SALE lines), so a negative value is
    // inert — this is a consistency pin rather than a live wrong answer, recorded
    // as such. It belongs here because the column is money: the first consumer to
    // trust it would otherwise inherit a value the UI believes is impossible.
    if item.unit_price_minor.is_some_and(|p| p < 0) {
        return Err(CoreError::Validation {
            field: "unit_price_minor",
            message: format!(
                "bundle item price override must not be negative, got {}",
                item.unit_price_minor.unwrap_or_default()
            ),
        });
    }
    let result = tx.execute(
        "INSERT INTO bundle_items (id, bundle_id, sku, qty, unit_price_minor)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            item.id,
            item.bundle_id,
            item.sku,
            item.qty,
            item.unit_price_minor
        ],
    );
    match result {
        Err(rusqlite::Error::SqliteFailure(e, _))
            if e.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            // A nameable component beats the raw FK message: the only FK on this
            // table is `sku -> products(sku)` (the `bundle_id` FK is satisfied by
            // the row this same transaction just wrote), so the SKU is what is
            // wrong.
            Err(CoreError::NotFound {
                entity: "product",
                id: item.sku.clone(),
            })
        }
        Err(e) => Err(e.into()),
        Ok(_) => Ok(()),
    }
}

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

        insert_bundle_row(&tx, bundle)?;

        for item in items {
            insert_bundle_item(&tx, item)?;
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

        // MSL-48: the same typed mapping as the create path — renaming a bundle
        // onto a SKU that is not a product would otherwise leak a raw FK error.
        let renamed = tx.execute(
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
        );
        if let Err(rusqlite::Error::SqliteFailure(e, _)) = &renamed
            && e.code == rusqlite::ErrorCode::ConstraintViolation
        {
            return Err(CoreError::NotFound {
                entity: "product",
                id: bundle.bundle_sku.clone(),
            });
        }
        renamed?;

        // Delete old items and re-insert.
        tx.execute(
            "DELETE FROM bundle_items WHERE bundle_id = ?1",
            params![bundle.id],
        )?;
        for item in items {
            insert_bundle_item(&tx, item)?;
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
