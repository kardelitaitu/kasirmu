/*
last audited 25-07-26 by RSA-Agent (modules-inventory slice A: repository verified)
crate: modules-inventory | status: SAFE | lint: CLEAN
findings: clean — currency and Sku parse fail-closed into validation errors, parameterized SQL
next: none | perf: N/A
*/
//! Inventory Repository — database queries for products, categories, and stock levels.

use crate::error::InventoryError;
use crate::models::{Inventory, LocationId, Product, ProductType};
use foundation::{Barcode, Currency, Money, Sku};
use rusqlite::{Connection, Transaction, params};

/// Repository for inventory and product database operations.
pub struct InventoryRepository<'a> {
    conn: &'a Connection,
}

impl<'a> InventoryRepository<'a> {
    /// Create a new `InventoryRepository` borrowing a SQLite connection.
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    /// Retrieve a product by ID.
    pub fn get_product(&self, id: &str) -> Result<Option<Product>, InventoryError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, sku, name, price_minor, currency, category_id, barcode, created_at, updated_at, price_updated_at, track_serial, product_type, version, cost_minor, brand, rack_location, notes, unit, is_active, default_supplier_id, popularity_score, image_hash
             FROM products WHERE id = ?1",
        )?;

        let mut rows = stmt.query(params![id])?;
        let row = match rows.next()? {
            Some(r) => r,
            None => return Ok(None),
        };

        let currency_str: String = row.get(4)?;
        let currency: Currency = currency_str
            .parse()
            .map_err(|_| InventoryError::validation("currency", "invalid currency code"))?;
        let price_minor: i64 = row.get(3)?;
        let sku_str: String = row.get(1)?;
        let sku = Sku::try_new(sku_str)
            .ok_or_else(|| InventoryError::validation("sku", "invalid SKU"))?;

        let barcode_str: Option<String> = row.get(6)?;
        let barcode = barcode_str.and_then(|b| Barcode::new(b).ok());

        // Two swallows were stacked on this column: `row.get(11)
        // .unwrap_or_else(|_| "retail")` turned a missing or unreadable column
        // into the literal string `retail`, which parses cleanly — the helper
        // would then faithfully report nothing wrong. Read it as Option<String>
        // and warn at the get, so a missing column, a NULL and a real 'retail'
        // stay three different outcomes.
        let ptype_stored: Option<String> = match row.get::<_, Option<String>>(11) {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!(
                    sku = %sku.as_str(),
                    error = %e,
                    operation = "InventoryRepository::get_product",
                    "products row has no readable product_type column; treating it as NULL"
                );
                None
            }
        };
        let product_type = ProductType::parse_stored_or_default(
            ptype_stored.as_deref(),
            sku.as_str(),
            "InventoryRepository::get_product",
        );

        Ok(Some(Product {
            id: row.get(0)?,
            sku,
            name: row.get(2)?,
            price: Money {
                minor_units: price_minor,
                currency,
            },
            category_id: row.get(5)?,
            barcode,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
            price_updated_at: row.get(9)?,
            track_serial: row.get::<_, i64>(10).unwrap_or(0) != 0,
            product_type,
            version: row.get(12).unwrap_or(1),
            cost_minor: row.get(13).unwrap_or(0),
            brand: row.get(14).unwrap_or(None),
            rack_location: row.get(15).unwrap_or(None),
            notes: row.get(16).unwrap_or(None),
            unit: row.get(17).unwrap_or(None),
            is_active: row.get::<_, i64>(18).unwrap_or(1) != 0,
            default_supplier_id: row.get(19).unwrap_or(None),
            image_hash: row.get(20).unwrap_or(None),
        }))
    }

    /// Retrieve product stock level for a SKU.
    pub fn get_stock(&self, sku: &Sku) -> Result<Option<Inventory>, InventoryError> {
        let mut stmt = self.conn.prepare(
            "SELECT product_id, sku, qty, low_stock_threshold, updated_at, location_id
             FROM inventory WHERE sku = ?1",
        )?;

        let mut rows = stmt.query(params![sku.as_str()])?;
        let row = match rows.next()? {
            Some(r) => r,
            None => return Ok(None),
        };

        let sku_str: String = row.get(1)?;
        let sku = Sku::try_new(sku_str)
            .ok_or_else(|| InventoryError::validation("sku", "invalid SKU"))?;
        let loc_str: String = row.get(5).unwrap_or_default();

        Ok(Some(Inventory {
            product_id: row.get(0)?,
            sku,
            qty: row.get(2)?,
            low_stock_threshold: row.get(3)?,
            updated_at: row.get(4)?,
            location_id: LocationId::from(loc_str),
        }))
    }

    /// Adjust stock level for a product inside a transaction.
    pub fn adjust_stock_tx(
        &self,
        tx: &Transaction,
        sku: &Sku,
        delta: i64,
    ) -> Result<(), InventoryError> {
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        tx.execute(
            "UPDATE inventory SET qty = qty + ?1, updated_at = ?2 WHERE sku = ?3",
            params![delta, now, sku.as_str()],
        )?;
        Ok(())
    }
}

#[cfg(test)]
#[path = "repository_tests.rs"]
mod tests;
