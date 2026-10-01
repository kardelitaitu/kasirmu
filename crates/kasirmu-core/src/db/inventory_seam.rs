//! The inventory seam for the sale-settlement path (Phase 5 P5.2).
//!
//! `crates/kasirmu-core/src/db/sales_lifecycle.rs` must read three inventory-owned
//! tables (`products`, `stock_summary`, `workspace_inventory_locations`) while it
//! builds the BOM deduction list for `complete_sale_with_resolved_shortfalls`.
//! The sale path runs in core, below the module layer, so no `NamespacedStore`
//! sees those statements and the governance gate (which scans only `modules/`)
//! cannot either.
//!
//! This module is where that SQL lives instead: one core-owned seam the sale
//! lifecycle calls by name. It is the read-side counterpart of
//! `products_stock_adjust::adjust_stock_batch` (which already owns the write
//! side) and the inventory analogue of `db::customers` for the crm table. The
//! statements are tx-scoped: every read takes the caller's `&Transaction` so the
//! settlement stays one atomic unit.
//!
//! Behaviour is preserved exactly: the queries, their COALESCE/optional handling
//! and their error mapping are the same bytes that used to be inline in
//! `sales_lifecycle.rs`.

use rusqlite::OptionalExtension;

use crate::error::CoreError;

/// A sale line's inventory identity: the product id and its stored
/// `product_type` string.
pub struct LineProductInfo {
    /// The product row's id.
    pub product_id: String,
    /// The raw `product_type` column value.
    pub product_type: String,
}

/// Look up a product's id and `product_type` by SKU inside the caller's
/// transaction. `None` when no product carries that SKU.
///
/// # Errors
///
/// Returns `CoreError::Db` on a read failure other than "no rows".
pub fn product_info_by_sku_in_tx(
    tx: &rusqlite::Transaction<'_>,
    sku: &str,
) -> Result<Option<LineProductInfo>, CoreError> {
    match tx.query_row(
        "SELECT id, product_type FROM products WHERE sku = ?1",
        rusqlite::params![sku],
        |row| {
            Ok(LineProductInfo {
                product_id: row.get(0)?,
                product_type: row.get(1)?,
            })
        },
    ) {
        Ok(info) => Ok(Some(info)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(CoreError::Db(e)),
    }
}

/// Look up an ingredient's SKU and `product_type` by product id inside the
/// caller's transaction. `None` when no product carries that id.
///
/// # Errors
///
/// Returns `CoreError::Db` on a read failure other than "no rows".
pub fn ingredient_info_by_id_in_tx(
    tx: &rusqlite::Transaction<'_>,
    product_id: &str,
) -> Result<Option<LineProductInfo>, CoreError> {
    match tx.query_row(
        "SELECT sku, product_type FROM products WHERE id = ?1",
        rusqlite::params![product_id],
        |row| {
            Ok(LineProductInfo {
                product_id: row.get(0)?,
                product_type: row.get(1)?,
            })
        },
    ) {
        Ok(info) => Ok(Some(info)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(CoreError::Db(e)),
    }
}

/// Resolve a product id from a SKU inside the caller's transaction, failing with
/// `NotFound` when absent.
///
/// # Errors
///
/// Returns `CoreError::NotFound` when no product carries the SKU.
pub fn require_product_id_by_sku_in_tx(
    tx: &rusqlite::Transaction<'_>,
    sku: &str,
) -> Result<String, CoreError> {
    tx.query_row(
        "SELECT id FROM products WHERE sku = ?1",
        rusqlite::params![sku],
        |row| row.get(0),
    )
    .map_err(|_| CoreError::NotFound {
        entity: "product",
        id: sku.to_owned(),
    })
}

/// Current `stock_summary` quantity for a product at a location inside the
/// caller's transaction. A missing summary row reads as 0.
///
/// # Errors
///
/// Returns `CoreError::Db` on a read failure.
pub fn location_qty_in_tx(
    tx: &rusqlite::Transaction<'_>,
    product_id: &str,
    location_id: &str,
) -> Result<i64, CoreError> {
    tx.query_row(
        "SELECT COALESCE(qty, 0) FROM stock_summary \
         WHERE item_id = ?1 AND location_id = ?2",
        rusqlite::params![product_id, location_id],
        |row| row.get(0),
    )
    .optional()
    .map(|v| v.unwrap_or(0))
    .map_err(CoreError::from)
}

/// Whether negative stock is allowed at a location for a workspace instance,
/// inside the caller's transaction. A missing override row reads as "not
/// allowed".
///
/// # Errors
///
/// Returns `CoreError::Db` on a read failure.
pub fn allow_negative_at_in_tx(
    tx: &rusqlite::Transaction<'_>,
    workspace_instance_id: &str,
    location_id: &str,
) -> Result<bool, CoreError> {
    tx.query_row(
        "SELECT COALESCE(allow_negative_stock, 0) \
         FROM workspace_inventory_locations \
         WHERE instance_id = ?1 AND location_id = ?2",
        rusqlite::params![workspace_instance_id, location_id],
        |row| row.get::<_, i64>(0),
    )
    .optional()
    .map(|v| v.unwrap_or(0) == 1)
    .map_err(CoreError::from)
}

#[cfg(test)]
#[path = "inventory_seam_tests.rs"]
mod tests;
