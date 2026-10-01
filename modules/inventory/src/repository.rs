/*
last audited 25-07-26 by RSA-Agent (modules-inventory slice A: repository verified)
crate: modules-inventory | status: SAFE | lint: CLEAN
findings: clean — currency and Sku parse fail-closed into validation errors, parameterized SQL
next: none | perf: N/A
*/
//! Inventory Repository — database queries for products, categories, and stock levels.

use crate::error::InventoryError;
use crate::models::{Product, ProductType};
use foundation::{Barcode, Currency, Money, Sku};
use kasirmu_core::db::Store;
use kasirmu_core::db::namespaced::{Grants, ModuleId, NamespacedStore};
use rusqlite::Connection;

/// The inventory module's own namespace id, as the ownership map names it.
const OWNER: ModuleId = ModuleId("inventory");

/// The module's own manifest, embedded so the runtime grant set is derived from
/// the same declaration the governance checker reads (Phase 4 P4.1 item 2).
const MANIFEST: &str = include_str!("../manifest.json");

/// Repository for inventory and product database operations.
///
/// Phase 3 P3.2: reaches the database through a [`NamespacedStore`] scoped to the
/// `inventory` namespace rather than a bare `&Connection`, so `get_product` is
/// checked against `modules/ownership.json` before it runs. `inventory` owns
/// `products` and declares no foreign read, so its embedded manifest
/// (Phase 4 P4.1) yields no grant.
pub struct InventoryRepository<'a> {
    ns: NamespacedStore<'a>,
}

impl<'a> InventoryRepository<'a> {
    /// Create a new `InventoryRepository` borrowing a SQLite connection.
    pub fn new(conn: &'a Connection) -> Self {
        Self {
            ns: NamespacedStore::new(
                Store::new(conn),
                OWNER,
                Grants::from_manifest_json(OWNER, MANIFEST),
            ),
        }
    }

    /// Retrieve a product by ID.
    pub fn get_product(&self, id: &str) -> Result<Option<Product>, InventoryError> {
        let rows = self.ns.own().query_try(
            "SELECT id, sku, name, price_minor, currency, category_id, barcode, created_at, updated_at, price_updated_at, track_serial, product_type, version, cost_minor, brand, rack_location, notes, unit, is_active, default_supplier_id, popularity_score, image_hash
             FROM products WHERE id = ?1",
            rusqlite::params![id],
            Self::map_product_row,
        )?;
        Ok(rows.into_iter().next())
    }

    /// Map a `products` row into a [`Product`].
    ///
    /// Kept as a named helper so the namespace-checked `query` closure stays a
    /// one-liner while the fail-closed parsing (currency/SKU validation, the
    /// `product_type` swallow the comment below explains) stays readable.
    fn map_product_row(row: &rusqlite::Row<'_>) -> Result<Product, InventoryError> {
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

        Ok(Product {
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
        })
    }

    // `get_stock` and `adjust_stock_tx` were REMOVED here on 2026-09-29. Both read or wrote
    // `inventory.sku` / `inventory.low_stock_threshold`, columns the migrations do not carry
    // -- `repository_tests.rs` said so in a note promising tests "once the migration is
    // applied" -- and after `InventoryService`'s wrappers went, they had no caller either.
    // SQL that cannot run is not a plan, and unreachable code cannot be covered: the pair was
    // holding `modules-inventory` at 75.2% against a 76.0% floor. They arrive with the
    // migration, tests included, or not at all.
}

#[cfg(test)]
#[path = "repository_tests.rs"]
mod tests;
