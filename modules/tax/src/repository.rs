/*
last audited 25-07-26 by RSA-Agent (modules-tax slice A: repository verified)
crate: modules-tax | status: SAFE | lint: CLEAN
findings: clean — TAX-03 soft-delete honoured at the module boundary with cross-layer parity test (modules/tax/tests/boundary_contract.rs); parameterized SQL
next: none | perf: N/A
*/
//! Tax Repository — database persistence layer for tax configuration.

use crate::error::TaxError;
use crate::models::TaxRate;
use rusqlite::{Connection, params};

/// Database access repository for tax rates.
pub struct TaxRepository<'a> {
    conn: &'a Connection,
}

impl<'a> TaxRepository<'a> {
    /// Create a new `TaxRepository`.
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    /// Retrieve an active tax rate by ID.
    ///
    /// TAX-03: honours the `is_active` soft-delete flag exactly like
    /// `kasirmu_core::db::Store::get_tax_rate`, so archived (immutable) rates
    /// stay hidden through the module boundary too. The cross-layer
    /// contract test `modules/tax/tests/boundary_contract.rs` pins this
    /// parity.
    pub fn get_tax_rate(&self, id: &str) -> Result<Option<TaxRate>, TaxError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, rate_bps, is_default, is_inclusive, created_at, updated_at
             FROM tax_rates WHERE id = ?1 AND is_active = 1",
        )?;

        let mut rows = stmt.query(params![id])?;
        let row = match rows.next()? {
            Some(r) => r,
            None => return Ok(None),
        };

        Ok(Some(TaxRate {
            id: row.get(0)?,
            name: row.get(1)?,
            rate_bps: row.get(2)?,
            is_default: row.get::<_, i64>(3)? != 0,
            is_inclusive: row.get::<_, i64>(4)? != 0,
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
        }))
    }

    /// List all active tax rates, ordered by name.
    ///
    /// TAX-03: honours the `is_active` soft-delete flag exactly like
    /// `kasirmu_core::db::Store::list_tax_rates` — archived (immutable) rates
    /// are filtered out (`is_active = 1`) so callers across the module
    /// boundary only ever see assignable rates. The cross-layer contract
    /// test `modules/tax/tests/boundary_contract.rs` pins this parity.
    pub fn list_tax_rates(&self) -> Result<Vec<TaxRate>, TaxError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, rate_bps, is_default, is_inclusive, created_at, updated_at
             FROM tax_rates WHERE is_active = 1 ORDER BY name",
        )?;

        let rows = stmt.query_map([], |row| {
            Ok(TaxRate {
                id: row.get(0)?,
                name: row.get(1)?,
                rate_bps: row.get(2)?,
                is_default: row.get::<_, i64>(3)? != 0,
                is_inclusive: row.get::<_, i64>(4)? != 0,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })?;

        rows.map(|r| Ok(r?)).collect()
    }
}

#[cfg(test)]
#[path = "repository_tests.rs"]
mod tests;
