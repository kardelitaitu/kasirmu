/*
last audited 25-07-26 by RSA-Agent (modules-inventory slice A: service verified)
crate: modules-inventory | status: SAFE | lint: CLEAN
findings: get_product is the whole live surface; the sibling get_stock/adjust_stock pair was dead AND untestable (planned-schema columns), removed 2026-09-29 with the coverage floor that exposed it
next: none | perf: N/A
*/
//! Inventory Service — product catalog and stock adjustment orchestration.

use crate::error::InventoryError;
use crate::models::Product;
use crate::repository::InventoryRepository;
use rusqlite::Connection;

/// Service encapsulating product and inventory domain operations.
pub struct InventoryService;

impl InventoryService {
    /// Retrieve product by ID.
    pub fn get_product(conn: &Connection, id: &str) -> Result<Option<Product>, InventoryError> {
        let repo = InventoryRepository::new(conn);
        repo.get_product(id)
    }

    // `get_stock` and `adjust_stock` were REMOVED here on 2026-09-29, and this note is why.
    // Both were dead (no caller anywhere in the tree -- only `get_product` is used, by
    // `tests/boundary_contract.rs` and the tests below) AND untestable: their columns
    // (`inventory.sku`, `inventory.low_stock_threshold`) are planned-schema columns that
    // the migrations do not carry, which the previous note in `service_tests.rs` admitted
    // while the module's audit stamp still claimed "thin orchestration with tx-scoped
    // adjust_stock". Unreachable code cannot be covered, so leaving it in place held
    // `modules-inventory` at 70.7% against a 76.0% floor (scripts/coverage-floors.json).
    // The canonical stock paths live in kasirmu-core's db layer; if an InventoryService
    // stock API is ever wanted, it arrives with the migration and its tests together.
}

#[cfg(test)]
#[path = "service_tests.rs"]
mod tests;
