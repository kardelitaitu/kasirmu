//! Settings delegation — store settings, currencies, exchange rates.
/*
last audited 25-07-26 by RSA-Agent (oz-core slice B5 part 6)
crate: oz-core | status: SAFE | lint: CLEAN
findings: pure delegation to modules_currency::CurrencyRepository (11 deprecated shims documented) + validated store-name/address/tax setters; no logic of its own; currency repo's own gaps tracked under the parallel review's F-findings
next: none | perf: N/A
*/

use modules_currency::repository::CurrencyRepository;

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

    /// Get the default currency.
    ///
    /// **Deprecated:** Use [`CurrencyRepository::get_default_currency`] directly.
    /// Delegates to [`modules_currency::repository::CurrencyRepository`].
    #[deprecated(note = "use CurrencyRepository::get_default_currency directly")]
    pub fn get_default_currency(&self) -> Result<Option<String>, CoreError> {
        let repo = CurrencyRepository::new(self.conn);
        Ok(repo.get_default_currency()?)
    }

    /// Set the default currency.
    ///
    /// **Deprecated:** Use [`CurrencyRepository::set_default_currency`] directly.
    /// Delegates to [`modules_currency::repository::CurrencyRepository`].
    #[deprecated(note = "use CurrencyRepository::set_default_currency directly")]
    pub fn set_default_currency(&self, code: &str) -> Result<(), CoreError> {
        let repo = CurrencyRepository::new(self.conn);
        Ok(repo.set_default_currency(code)?)
    }

    /// Get the currency display format: `"symbol"` or `"code"`.
    ///
    /// **Deprecated:** Use [`CurrencyRepository::get_currency_format`] directly.
    /// Delegates to [`modules_currency::repository::CurrencyRepository`].
    #[deprecated(note = "use CurrencyRepository::get_currency_format directly")]
    pub fn get_currency_format(&self) -> Result<String, CoreError> {
        let repo = CurrencyRepository::new(self.conn);
        Ok(repo.get_currency_format()?)
    }

    /// Set the currency display format.
    ///
    /// **Deprecated:** Use [`CurrencyRepository::set_currency_format`] directly.
    /// Delegates to [`modules_currency::repository::CurrencyRepository`].
    #[deprecated(note = "use CurrencyRepository::set_currency_format directly")]
    pub fn set_currency_format(&self, fmt: &str) -> Result<(), CoreError> {
        let repo = CurrencyRepository::new(self.conn);
        Ok(repo.set_currency_format(fmt)?)
    }

    /// Get the currency symbol position: `"prefix"` or `"suffix"`.
    ///
    /// **Deprecated:** Use [`CurrencyRepository::get_currency_symbol_position`] directly.
    /// Delegates to [`modules_currency::repository::CurrencyRepository`].
    #[deprecated(note = "use CurrencyRepository::get_currency_symbol_position directly")]
    pub fn get_currency_symbol_position(&self) -> Result<String, CoreError> {
        let repo = CurrencyRepository::new(self.conn);
        Ok(repo.get_currency_symbol_position()?)
    }

    /// Set the currency symbol position.
    ///
    /// **Deprecated:** Use [`CurrencyRepository::set_currency_symbol_position`] directly.
    /// Delegates to [`modules_currency::repository::CurrencyRepository`].
    #[deprecated(note = "use CurrencyRepository::set_currency_symbol_position directly")]
    pub fn set_currency_symbol_position(&self, pos: &str) -> Result<(), CoreError> {
        let repo = CurrencyRepository::new(self.conn);
        Ok(repo.set_currency_symbol_position(pos)?)
    }

    /// Get the decimal separator: `"dot"` or `"comma"`.
    ///
    /// **Deprecated:** Use [`CurrencyRepository::get_currency_decimal_separator`] directly.
    /// Delegates to [`modules_currency::repository::CurrencyRepository`].
    #[deprecated(note = "use CurrencyRepository::get_currency_decimal_separator directly")]
    pub fn get_currency_decimal_separator(&self) -> Result<String, CoreError> {
        let repo = CurrencyRepository::new(self.conn);
        Ok(repo.get_currency_decimal_separator()?)
    }

    /// Set the decimal separator.
    ///
    /// **Deprecated:** Use [`CurrencyRepository::set_currency_decimal_separator`] directly.
    /// Delegates to [`modules_currency::repository::CurrencyRepository`].
    #[deprecated(note = "use CurrencyRepository::set_currency_decimal_separator directly")]
    pub fn set_currency_decimal_separator(&self, sep: &str) -> Result<(), CoreError> {
        let repo = CurrencyRepository::new(self.conn);
        Ok(repo.set_currency_decimal_separator(sep)?)
    }

    /// Get the thousands separator: `"comma"`, `"dot"`, `"space"`, or `"none"`.
    ///
    /// **Deprecated:** Use [`CurrencyRepository::get_currency_thousands_separator`] directly.
    /// Delegates to [`modules_currency::repository::CurrencyRepository`].
    #[deprecated(note = "use CurrencyRepository::get_currency_thousands_separator directly")]
    pub fn get_currency_thousands_separator(&self) -> Result<String, CoreError> {
        let repo = CurrencyRepository::new(self.conn);
        Ok(repo.get_currency_thousands_separator()?)
    }

    /// Set the thousands separator.
    ///
    /// **Deprecated:** Use [`CurrencyRepository::set_currency_thousands_separator`] directly.
    /// Delegates to [`modules_currency::repository::CurrencyRepository`].
    #[deprecated(note = "use CurrencyRepository::set_currency_thousands_separator directly")]
    pub fn set_currency_thousands_separator(&self, sep: &str) -> Result<(), CoreError> {
        let repo = CurrencyRepository::new(self.conn);
        Ok(repo.set_currency_thousands_separator(sep)?)
    }

    /// List all currencies from the ISO-4217 table, ordered by code.
    ///
    /// **Deprecated:** Use [`CurrencyRepository::list_currencies`] directly.
    /// Delegates to [`modules_currency::repository::CurrencyRepository`].
    #[deprecated(note = "use CurrencyRepository::list_currencies directly")]
    pub fn list_currencies(&self) -> Result<Vec<(String, String, u32, String)>, CoreError> {
        let repo = CurrencyRepository::new(self.conn);
        let rows = repo.list_currencies()?;
        Ok(rows
            .into_iter()
            .map(|dto| (dto.code, dto.name, dto.minor_exponent, dto.symbol))
            .collect())
    }

    /// List all exchange rates.
    ///
    /// **Deprecated:** Use [`CurrencyRepository::list_exchange_rates`] directly.
    /// Delegates to [`modules_currency::repository::CurrencyRepository`].
    #[deprecated(note = "use CurrencyRepository::list_exchange_rates directly")]
    pub fn list_exchange_rates(&self) -> Result<Vec<modules_currency::ExchangeRateRow>, CoreError> {
        let repo = CurrencyRepository::new(self.conn);
        Ok(repo.list_exchange_rates()?)
    }

    /// Create a new exchange rate entry.
    ///
    /// `rate_millionths` is the fixed-point exchange rate at a 6-decimal
    /// scale (e.g. `0.92` → `920_000`). Strictly positive — zero and
    /// negative rates are rejected at this layer (defence in depth; the
    /// Tauri command layer also rejects them).
    ///
    /// **Deprecated:** Use [`CurrencyRepository::create_exchange_rate`] directly.
    /// Delegates to [`modules_currency::repository::CurrencyRepository`].
    #[deprecated(note = "use CurrencyRepository::create_exchange_rate directly")]
    pub fn create_exchange_rate(
        &self,
        from_currency: &str,
        to_currency: &str,
        rate_millionths: i64,
        source: &str,
        effective_date: &str,
    ) -> Result<modules_currency::ExchangeRateRow, CoreError> {
        let repo = CurrencyRepository::new(self.conn);
        Ok(repo.create_exchange_rate(
            from_currency,
            to_currency,
            rate_millionths,
            source,
            effective_date,
        )?)
    }

    /// Insert or replace an exchange rate.
    ///
    /// Uses `INSERT OR REPLACE` so that a rate with the same
    /// `(from_currency, to_currency, effective_date)` is replaced
    /// with a new row and a fresh id. `rate_millionths` is at the 6-decimal
    /// scale (see [`modules_currency::ExchangeRateRow`]). Zero and
    /// negative rates are rejected (matching [`Self::create_exchange_rate`]).
    ///
    /// **Deprecated:** Use [`CurrencyRepository::upsert_exchange_rate`] directly.
    /// Delegates to [`modules_currency::repository::CurrencyRepository`].
    #[deprecated(note = "use CurrencyRepository::upsert_exchange_rate directly")]
    pub fn upsert_exchange_rate(
        &self,
        from_currency: &str,
        to_currency: &str,
        rate_millionths: i64,
        source: &str,
        effective_date: &str,
    ) -> Result<modules_currency::ExchangeRateRow, CoreError> {
        let repo = CurrencyRepository::new(self.conn);
        Ok(repo.upsert_exchange_rate(
            from_currency,
            to_currency,
            rate_millionths,
            source,
            effective_date,
        )?)
    }

    /// Delete an exchange rate by ID.
    ///
    /// **Deprecated:** Use [`CurrencyRepository::delete_exchange_rate`] directly.
    /// Delegates to [`modules_currency::repository::CurrencyRepository`].
    #[deprecated(note = "use CurrencyRepository::delete_exchange_rate directly")]
    pub fn delete_exchange_rate(&self, id: &str) -> Result<(), CoreError> {
        let repo = CurrencyRepository::new(self.conn);
        Ok(repo.delete_exchange_rate(id)?)
    }
}

// ── Tests ─────────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "settings_tests.rs"]
mod tests;
