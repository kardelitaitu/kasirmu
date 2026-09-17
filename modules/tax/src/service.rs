/*
last audited 25-07-26 by RSA-Agent (modules-tax slice A: service verified)
crate: modules-tax | status: SAFE | lint: CLEAN
findings: clean thin service facade
next: none | perf: N/A
*/
//! Tax Service — tax calculation and rate management workflows.

use crate::error::TaxError;
use crate::models::TaxRate;
use crate::repository::TaxRepository;
use rusqlite::Connection;

/// Service encapsulating tax workflows.
pub struct TaxService;

impl TaxService {
    /// Retrieve tax rate by ID.
    pub fn get_tax_rate(conn: &Connection, id: &str) -> Result<Option<TaxRate>, TaxError> {
        let repo = TaxRepository::new(conn);
        repo.get_tax_rate(id)
    }

    /// List all active tax rates, ordered by name.
    ///
    /// TAX-03: filters `is_active = 1` exactly like
    /// `kasirmu_core::db::Store::list_tax_rates`, so archived (immutable)
    /// rates stay hidden through the module boundary. Cross-layer parity
    /// is pinned by `modules/tax/tests/boundary_contract.rs`.
    pub fn list_tax_rates(conn: &Connection) -> Result<Vec<TaxRate>, TaxError> {
        let repo = TaxRepository::new(conn);
        repo.list_tax_rates()
    }
}

#[cfg(test)]
#[path = "service_tests.rs"]
mod tests;
