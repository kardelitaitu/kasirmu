/*
last audited 25-07-26 by RSA-Agent (modules-tax slice A: repository verified)
crate: modules-tax | status: SAFE | lint: CLEAN
findings: clean — TAX-03 soft-delete honoured at the module boundary with cross-layer parity test (modules/tax/tests/boundary_contract.rs); parameterized SQL
next: none | perf: N/A
*/
//! Tax Repository — database persistence layer for tax configuration.

use crate::error::TaxError;
use crate::models::TaxRate;
use kasirmu_core::db::Store;
use kasirmu_core::db::namespaced::{Grants, ModuleId, NamespacedStore};
use rusqlite::Connection;

/// The tax module's own namespace id, as the ownership map names it.
const OWNER: ModuleId = ModuleId("tax");

/// The module's own manifest, embedded so the runtime grant set is derived from
/// the same declaration the governance checker reads (Phase 4 P4.1 item 2).
const MANIFEST: &str = include_str!("../manifest.json");

/// Database access repository for tax rates.
///
/// Phase 3 P3.2: reaches the database through a [`NamespacedStore`] scoped to
/// the `tax` namespace rather than a bare `&Connection`, so every statement is
/// checked against `modules/ownership.json` before it runs. `tax` owns
/// `tax_rates` and declares no foreign read, so its embedded manifest
/// (Phase 4 P4.1) yields no grant.
pub struct TaxRepository<'a> {
    ns: NamespacedStore<'a>,
}

impl<'a> TaxRepository<'a> {
    /// Create a new `TaxRepository` over the module's own namespace.
    pub fn new(conn: &'a Connection) -> Self {
        Self {
            ns: NamespacedStore::new(Store::new(conn), OWNER, Grants::from_manifest_json(OWNER, MANIFEST)),
        }
    }

    /// Retrieve an active tax rate by ID.
    ///
    /// TAX-03: honours the `is_active` soft-delete flag exactly like
    /// `kasirmu_core::db::Store::get_tax_rate`, so archived (immutable) rates
    /// stay hidden through the module boundary too. The cross-layer
    /// contract test `modules/tax/tests/boundary_contract.rs` pins this
    /// parity.
    pub fn get_tax_rate(&self, id: &str) -> Result<Option<TaxRate>, TaxError> {
        let rows = self.ns.own().query(
            "SELECT id, name, rate_bps, is_default, is_inclusive, created_at, updated_at
             FROM tax_rates WHERE id = ?1 AND is_active = 1",
            rusqlite::params![id],
            |row| {
                Ok(TaxRate {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    rate_bps: row.get(2)?,
                    is_default: row.get::<_, i64>(3)? != 0,
                    is_inclusive: row.get::<_, i64>(4)? != 0,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            },
        )?;
        Ok(rows.into_iter().next())
    }

    /// List all active tax rates, ordered by name.
    ///
    /// TAX-03: honours the `is_active` soft-delete flag exactly like
    /// `kasirmu_core::db::Store::list_tax_rates` — archived (immutable) rates
    /// are filtered out (`is_active = 1`) so callers across the module
    /// boundary only ever see assignable rates. The cross-layer contract
    /// test `modules/tax/tests/boundary_contract.rs` pins this parity.
    pub fn list_tax_rates(&self) -> Result<Vec<TaxRate>, TaxError> {
        let rows = self.ns.own().query(
            "SELECT id, name, rate_bps, is_default, is_inclusive, created_at, updated_at
             FROM tax_rates WHERE is_active = 1 ORDER BY name",
            [],
            |row| {
                Ok(TaxRate {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    rate_bps: row.get(2)?,
                    is_default: row.get::<_, i64>(3)? != 0,
                    is_inclusive: row.get::<_, i64>(4)? != 0,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            },
        )?;
        Ok(rows)
    }
}

#[cfg(test)]
#[path = "repository_tests.rs"]
mod tests;
