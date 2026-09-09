/*
last audited 25-07-26 by RSA-Agent (modules-currency slice A: repository deep read)
crate: modules-currency | status: SAFE | lint: CLEAN
findings: exemplary — F-022 tx-wrapped writes with consistent read-back; CUR-04 as-of-date selection with documented forward-looking fallback; CUR-08 pair-scoped checkout query; rate_millionths strictly positive with pre-write validation and code trimming; settings delegated to platform-core (encrypted-at-rest and old-key migration preserved); all SQL parameterized
next: none | perf: N/A
*/
//! Currency/Exchange repository — database persistence for exchange rates.

use rusqlite::Connection;

use crate::commands::CurrencyDto;
use crate::error::CurrencyError;
use crate::models::ExchangeRateRow;

/// Database access repository for currency and exchange-rate data.
pub struct CurrencyRepository<'a> {
    conn: &'a Connection,
}

impl<'a> CurrencyRepository<'a> {
    /// Create a new `CurrencyRepository` borrowing a SQLite connection.
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    /// List all currencies from the ISO-4217 table, ordered by code.
    pub fn list_currencies(&self) -> Result<Vec<CurrencyDto>, CurrencyError> {
        let mut stmt = self
            .conn
            .prepare("SELECT code, name, minor_exponent, symbol FROM currencies ORDER BY code")?;
        let rows = stmt.query_map([], |row| {
            Ok(CurrencyDto {
                code: row.get(0)?,
                name: row.get(1)?,
                minor_exponent: row.get(2)?,
                symbol: row.get(3)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    /// List all exchange rates ordered by `(from_currency, to_currency)`,
    /// newest effective date first WITHIN each pair (CUR-04: consumers
    /// that take the first match per pair must get the current rate, not
    /// the oldest inserted).
    pub fn list_exchange_rates(&self) -> Result<Vec<ExchangeRateRow>, CurrencyError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, from_currency, to_currency, rate_millionths, source, effective_date, created_at
             FROM exchange_rates
             ORDER BY from_currency, to_currency, effective_date DESC, created_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(ExchangeRateRow {
                id: row.get(0)?,
                from_currency: row.get(1)?,
                to_currency: row.get(2)?,
                rate_millionths: row.get(3)?,
                source: row.get(4)?,
                effective_date: row.get(5)?,
                created_at: row.get(6)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    /// The CURRENT rate for every pair — one row per
    /// `(from_currency, to_currency)`, the full history excluded (CUR-11).
    ///
    /// `list_exchange_rates` grows without bound as rates are recorded;
    /// consumers that only ever read the first row per pair (dashboards,
    /// converters, the no-session PaymentModal fallback) should use this
    /// instead of shipping every historical row over IPC. Ordering within
    /// a pair mirrors the CUR-04 rule: newest `effective_date` wins —
    /// `UNIQUE(from, to, effective_date)` makes ties impossible, so the
    /// `created_at`/`rowid` tail of the ordering is defence in depth.
    pub fn list_latest_exchange_rates(&self) -> Result<Vec<ExchangeRateRow>, CurrencyError> {
        let mut stmt = self.conn.prepare(
            "SELECT er.id, er.from_currency, er.to_currency, er.rate_millionths,
                    er.source, er.effective_date, er.created_at
             FROM exchange_rates er
             WHERE er.id = (
                 SELECT e2.id FROM exchange_rates e2
                 WHERE e2.from_currency = er.from_currency
                   AND e2.to_currency = er.to_currency
                 ORDER BY e2.effective_date DESC, e2.created_at DESC, e2.rowid DESC
                 LIMIT 1
             )
             ORDER BY er.from_currency, er.to_currency",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(ExchangeRateRow {
                id: row.get(0)?,
                from_currency: row.get(1)?,
                to_currency: row.get(2)?,
                rate_millionths: row.get(3)?,
                source: row.get(4)?,
                effective_date: row.get(5)?,
                created_at: row.get(6)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    /// List exchange rates for a specific currency pair, ordered by
    /// effective date descending (most recent first).
    ///
    /// CUR-08: the checkout path must not load the full rate history; this
    /// bounds the query to the pair the payment modal actually needs.
    pub fn list_exchange_rates_for_pair(
        &self,
        from_currency: &str,
        to_currency: &str,
    ) -> Result<Vec<ExchangeRateRow>, CurrencyError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, from_currency, to_currency, rate_millionths, source, effective_date, created_at
             FROM exchange_rates
             WHERE from_currency = ?1 AND to_currency = ?2
             ORDER BY effective_date DESC, created_at DESC",
        )?;
        let rows = stmt.query_map(rusqlite::params![from_currency, to_currency], |row| {
            Ok(ExchangeRateRow {
                id: row.get(0)?,
                from_currency: row.get(1)?,
                to_currency: row.get(2)?,
                rate_millionths: row.get(3)?,
                source: row.get(4)?,
                effective_date: row.get(5)?,
                created_at: row.get(6)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    /// Return the exchange rate for a pair that is effective **on or
    /// before** `as_of_date`, preferring the most recent effective date
    /// (CUR-04). When no rate is effective on or before the date, returns
    /// the earliest rate *after* the date as a forward-looking fallback
    /// (a rate with a future effective date is still better than none when
    /// the store just added it). Returns `None` when the pair has no rate
    /// at all.
    pub fn get_latest_exchange_rate(
        &self,
        from_currency: &str,
        to_currency: &str,
        as_of_date: &str,
    ) -> Result<Option<ExchangeRateRow>, CurrencyError> {
        // 1. Most recent rate effective on or before the requested date.
        let on_or_before = self.conn.query_row(
            "SELECT id, from_currency, to_currency, rate_millionths, source, effective_date, created_at
             FROM exchange_rates
             WHERE from_currency = ?1 AND to_currency = ?2 AND effective_date <= ?3
             ORDER BY effective_date DESC, created_at DESC
             LIMIT 1",
            rusqlite::params![from_currency, to_currency, as_of_date],
            |row| {
                Ok(ExchangeRateRow {
                    id: row.get(0)?,
                    from_currency: row.get(1)?,
                    to_currency: row.get(2)?,
                    rate_millionths: row.get(3)?,
                    source: row.get(4)?,
                    effective_date: row.get(5)?,
                    created_at: row.get(6)?,
                })
            },
        );
        match on_or_before {
            Ok(row) => return Ok(Some(row)),
            Err(rusqlite::Error::QueryReturnedNoRows) => {}
            Err(e) => return Err(e.into()),
        }

        // 2. Earliest forward-looking rate (rate added with a future date).
        let forward = self.conn.query_row(
            "SELECT id, from_currency, to_currency, rate_millionths, source, effective_date, created_at
             FROM exchange_rates
             WHERE from_currency = ?1 AND to_currency = ?2 AND effective_date > ?3
             ORDER BY effective_date ASC, created_at ASC
             LIMIT 1",
            rusqlite::params![from_currency, to_currency, as_of_date],
            |row| {
                Ok(ExchangeRateRow {
                    id: row.get(0)?,
                    from_currency: row.get(1)?,
                    to_currency: row.get(2)?,
                    rate_millionths: row.get(3)?,
                    source: row.get(4)?,
                    effective_date: row.get(5)?,
                    created_at: row.get(6)?,
                })
            },
        );
        match forward {
            Ok(row) => Ok(Some(row)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// Create a new exchange rate entry.
    ///
    /// `rate_millionths` is the fixed-point exchange rate at a 6-decimal
    /// scale (e.g. `0.92` → `920_000`). Strictly positive — zero and
    /// negative rates are rejected at this layer.
    pub fn create_exchange_rate(
        &self,
        from_currency: &str,
        to_currency: &str,
        rate_millionths: i64,
        source: &str,
        effective_date: &str,
    ) -> Result<ExchangeRateRow, CurrencyError> {
        if rate_millionths <= 0 {
            return Err(CurrencyError::validation(
                "rate_millionths",
                "rate must be strictly positive; zero and negative exchange rates are not valid",
            ));
        }
        if from_currency.trim().is_empty() {
            return Err(CurrencyError::validation(
                "from_currency",
                "from_currency must not be empty",
            ));
        }
        if to_currency.trim().is_empty() {
            return Err(CurrencyError::validation(
                "to_currency",
                "to_currency must not be empty",
            ));
        }
        if source.trim().is_empty() {
            return Err(CurrencyError::validation(
                "source",
                "source must not be empty",
            ));
        }
        if effective_date.trim().is_empty() {
            return Err(CurrencyError::validation(
                "effective_date",
                "effective_date must not be empty",
            ));
        }
        let id = uuid::Uuid::now_v7().to_string();
        // Normalize currency codes to canonical uppercase: validation
        // accepts mixed case ("usd") and trims for emptiness, but lookups
        // (get_latest, CUR-08) compare exact stored codes — a lowercase
        // row would be invisible to the uppercase form.
        let from_currency = from_currency.trim().to_uppercase();
        let to_currency = to_currency.trim().to_uppercase();
        // F-022: the INSERT and its read-back SELECT run inside one
        // transaction so the returned row is a consistent snapshot of
        // exactly what was committed (never write outside a transaction).
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "INSERT INTO exchange_rates (id, from_currency, to_currency, rate_millionths, source, effective_date) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![id, from_currency, to_currency, rate_millionths, source, effective_date],
        )?;
        let row = {
            let mut stmt = tx.prepare(
                "SELECT id, from_currency, to_currency, rate_millionths, source, effective_date, created_at FROM exchange_rates WHERE id = ?1"
            )?;
            stmt.query_row(rusqlite::params![id], |row| {
                Ok(ExchangeRateRow {
                    id: row.get(0)?,
                    from_currency: row.get(1)?,
                    to_currency: row.get(2)?,
                    rate_millionths: row.get(3)?,
                    source: row.get(4)?,
                    effective_date: row.get(5)?,
                    created_at: row.get(6)?,
                })
            })?
        };
        tx.commit()?;
        Ok(row)
    }

    /// Insert or replace an exchange rate.
    ///
    /// Uses `INSERT OR REPLACE` so that a rate with the same
    /// `(from_currency, to_currency, effective_date)` is replaced
    /// with a new row and a fresh id. `rate_millionths` is at the 6-decimal
    /// scale. Zero and negative rates are rejected.
    pub fn upsert_exchange_rate(
        &self,
        from_currency: &str,
        to_currency: &str,
        rate_millionths: i64,
        source: &str,
        effective_date: &str,
    ) -> Result<ExchangeRateRow, CurrencyError> {
        if rate_millionths <= 0 {
            return Err(CurrencyError::validation(
                "rate_millionths",
                "rate must be strictly positive; zero and negative exchange rates are not valid",
            ));
        }
        if from_currency.trim().is_empty() {
            return Err(CurrencyError::validation(
                "from_currency",
                "from_currency must not be empty",
            ));
        }
        if to_currency.trim().is_empty() {
            return Err(CurrencyError::validation(
                "to_currency",
                "to_currency must not be empty",
            ));
        }
        if source.trim().is_empty() {
            return Err(CurrencyError::validation(
                "source",
                "source must not be empty",
            ));
        }
        if effective_date.trim().is_empty() {
            return Err(CurrencyError::validation(
                "effective_date",
                "effective_date must not be empty",
            ));
        }
        let id = uuid::Uuid::now_v7().to_string();
        // Normalize currency codes (same as create): "USD " / "usd" must be
        // stored as "USD" so lookups by the trimmed uppercase code match.
        let from_currency = from_currency.trim().to_uppercase();
        let to_currency = to_currency.trim().to_uppercase();
        // F-022: same transactional write + read-back as create.
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "INSERT OR REPLACE INTO exchange_rates (id, from_currency, to_currency, rate_millionths, source, effective_date) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![id, from_currency, to_currency, rate_millionths, source, effective_date],
        )?;
        let row = {
            let mut stmt = tx.prepare(
                "SELECT id, from_currency, to_currency, rate_millionths, source, effective_date, created_at FROM exchange_rates WHERE id = ?1"
            )?;
            stmt.query_row(rusqlite::params![id], |row| {
                Ok(ExchangeRateRow {
                    id: row.get(0)?,
                    from_currency: row.get(1)?,
                    to_currency: row.get(2)?,
                    rate_millionths: row.get(3)?,
                    source: row.get(4)?,
                    effective_date: row.get(5)?,
                    created_at: row.get(6)?,
                })
            })?
        };
        tx.commit()?;
        Ok(row)
    }

    /// Delete an exchange rate by ID.
    pub fn delete_exchange_rate(&self, id: &str) -> Result<(), CurrencyError> {
        // F-022: single-statement write, still wrapped per the
        // never-write-outside-a-transaction rule.
        let tx = self.conn.unchecked_transaction()?;
        let affected = tx.execute(
            "DELETE FROM exchange_rates WHERE id = ?1",
            rusqlite::params![id],
        )?;
        tx.commit()?;
        if affected == 0 {
            return Err(CurrencyError::NotFound {
                entity: "exchange_rate",
                id: id.to_string(),
            });
        }
        Ok(())
    }

    // ── Currency-format settings (R2 Phase 5) ────────────────────────────

    /// Get the default currency code (ISO-4217), if set.
    pub fn get_default_currency(&self) -> Result<Option<String>, CurrencyError> {
        let val = platform_core::settings::Settings::get_default_currency(self.conn)?;
        Ok(val)
    }

    /// Set the default currency code.
    pub fn set_default_currency(&self, code: &str) -> Result<(), CurrencyError> {
        platform_core::settings::Settings::set_default_currency(self.conn, code)?;
        Ok(())
    }

    /// Get the currency display format: `"symbol"` or `"code"`.
    pub fn get_currency_format(&self) -> Result<String, CurrencyError> {
        let val = platform_core::settings::Settings::get_currency_format(self.conn)?;
        Ok(val)
    }

    /// Set the currency display format.
    pub fn set_currency_format(&self, fmt: &str) -> Result<(), CurrencyError> {
        platform_core::settings::Settings::set_currency_format(self.conn, fmt)?;
        Ok(())
    }

    /// Get the currency symbol position: `"prefix"` or `"suffix"`.
    pub fn get_currency_symbol_position(&self) -> Result<String, CurrencyError> {
        let val = platform_core::settings::Settings::get_currency_symbol_position(self.conn)?;
        Ok(val)
    }

    /// Set the currency symbol position.
    pub fn set_currency_symbol_position(&self, pos: &str) -> Result<(), CurrencyError> {
        platform_core::settings::Settings::set_currency_symbol_position(self.conn, pos)?;
        Ok(())
    }

    /// Get the decimal separator: `"dot"` or `"comma"`.
    pub fn get_currency_decimal_separator(&self) -> Result<String, CurrencyError> {
        let val = platform_core::settings::Settings::get_currency_decimal_separator(self.conn)?;
        Ok(val)
    }

    /// Set the decimal separator.
    pub fn set_currency_decimal_separator(&self, sep: &str) -> Result<(), CurrencyError> {
        platform_core::settings::Settings::set_currency_decimal_separator(self.conn, sep)?;
        Ok(())
    }

    /// Get the thousands separator: `"comma"`, `"dot"`, `"space"`, or `"none"`.
    pub fn get_currency_thousands_separator(&self) -> Result<String, CurrencyError> {
        let val = platform_core::settings::Settings::get_currency_thousands_separator(self.conn)?;
        Ok(val)
    }

    /// Set the thousands separator.
    pub fn set_currency_thousands_separator(&self, sep: &str) -> Result<(), CurrencyError> {
        platform_core::settings::Settings::set_currency_thousands_separator(self.conn, sep)?;
        Ok(())
    }
}

#[cfg(test)]
#[path = "repository_tests.rs"]
mod tests;
