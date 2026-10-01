//! Settings delegation — store settings and the validated store-name, address and tax setters.
/*
last audited 25-07-26 by RSA-Agent (kasirmu-core slice B5 part 6)
crate: kasirmu-core | status: SAFE | lint: CLEAN
findings: settings CRUD + validated store-name/address/tax setters; no logic of its own; currency repo's own gaps tracked under the parallel review's F-findings
  RETIRED 2026-09-28 (ADR-61 / C26): the fifteen deprecated currency shims counted here are
  deleted, and kasirmu-core no longer depends on modules-currency; the delegation they performed
  is the public CurrencyRepository API their own deprecation notes named. Superseded text, kept:
  "pure delegation to modules_currency::CurrencyRepository (11 deprecated shims documented) +
  validated store-name/address/tax setters; no logic of its own; currency repo's own gaps tracked under the parallel review's F-findings"
next: none | perf: N/A
*/

use crate::Settings;
use crate::error::CoreError;

use super::Store;

impl Store<'_> {
    /// Read a single setting.
    pub fn get_setting(&self, key: &str) -> Result<Option<String>, CoreError> {
        Settings::get(self.conn, key)
    }

    /// Write a single setting.
    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), CoreError> {
        Settings::set(self.conn, key, value)
    }

    /// Load the feature flag registry.
    pub fn load_features(&self) -> Result<crate::FeatureRegistry, CoreError> {
        Settings::load_features(self.conn)
    }

    /// Save the feature flag registry.
    pub fn save_features(&self, reg: &crate::FeatureRegistry) -> Result<(), CoreError> {
        Settings::save_features(self.conn, reg)
    }

    /// Prune stale feature rows.
    pub fn prune_stale_features(&self, reg: &crate::FeatureRegistry) -> Result<usize, CoreError> {
        Settings::prune_stale_features(self.conn, reg)
    }

    /// Get the store display name.
    pub fn get_store_name(&self) -> Result<Option<String>, CoreError> {
        Settings::get_store_name(self.conn)
    }

    /// Set the store display name.
    pub fn set_store_name(&self, name: &str) -> Result<(), CoreError> {
        if name.trim().is_empty() {
            return Err(CoreError::Validation {
                field: "store_name",
                message: "store name must not be empty".into(),
            });
        }
        Settings::set_store_name(self.conn, name)
    }

    /// Get the store address.
    pub fn get_store_address(&self) -> Result<Option<String>, CoreError> {
        Settings::get_store_address(self.conn)
    }

    /// Set the store address.
    pub fn set_store_address(&self, addr: &str) -> Result<(), CoreError> {
        if addr.trim().is_empty() {
            return Err(CoreError::Validation {
                field: "store_address",
                message: "store address must not be empty".into(),
            });
        }
        Settings::set_store_address(self.conn, addr)
    }

    /// Get the store tax / VAT number.
    pub fn get_store_tax_id(&self) -> Result<Option<String>, CoreError> {
        Settings::get_store_tax_id(self.conn)
    }

    /// Set the store tax / VAT number.
    pub fn set_store_tax_id(&self, id: &str) -> Result<(), CoreError> {
        if id.trim().is_empty() {
            return Err(CoreError::Validation {
                field: "store_tax_id",
                message: "store tax id must not be empty".into(),
            });
        }
        Settings::set_store_tax_id(self.conn, id)
    }
}

// ── Tests ─────────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "settings_tests.rs"]
mod tests;
