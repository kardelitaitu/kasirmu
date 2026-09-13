//! Tax-rate record CRUD — list, get, create, update, archive, dependency
//! counts and the statutory rounding-directive reads.
//!
//! Rate rows are the "rule" side of tax configuration: one `tax_rates` row
//! per rate, with the TAX-02 default-flag swap, TAX-03 archive-not-delete
//! lifecycle and TAX-04 bounded-bps validation living here. Scoped authoring
//! and effective-rate resolution are in [`super::scopes`]; product/category
//! assignments are in [`super::assignments`].
//!
//! Split from `db/tax.rs` 13-09-26, behaviour unchanged — pure module
//! decomposition, no logic edits. The tier-default clear and the
//! last-coverage guard are cross-referenced helpers defined in
//! [`super::scopes`] and called from the write paths below.

use rusqlite::params;

use crate::db::Store;
use crate::error::CoreError;
use crate::tax_rate::{RoundingMode, TaxRate};

use super::scopes::TaxRateScope;

/// Reference counts for a tax rate (TAX-03) — used by the delete
/// confirmation UI to show dependencies before archiving.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaxRateDependencyCounts {
    /// Number of product assignments referencing this rate.
    pub products: i64,
    /// Number of category assignments referencing this rate.
    pub categories: i64,
    /// Number of historical sale lines referencing this rate.
    pub sale_lines: i64,
}

/// Maximum supported tax rate in basis points (1_000_000 bps = 10,000%).
///
/// TAX-04: bounds every accepted rate so the calculation
/// expressions `line_total_minor * rate_bps` and `10_000 + rate_bps`
/// cannot overflow `i64` for realistic amounts, and so an accidental
/// or malicious extreme rate is rejected with a structured error
/// instead of silently corrupting totals.
pub const MAX_TAX_RATE_BPS: i64 = 1_000_000;

impl Store<'_> {
    /// Validate the shared tax-rate input invariants (name + bounded rate).
    ///
    /// TAX-04: rejects negative rates and rates above
    /// [`MAX_TAX_RATE_BPS`], giving callers a structured validation
    /// error instead of allowing overflow-prone extremes into the store.
    pub(super) fn validate_tax_rate_input(name: &str, rate_bps: i64) -> Result<(), CoreError> {
        if name.trim().is_empty() {
            return Err(CoreError::Validation {
                field: "name",
                message: "tax rate name must not be empty".into(),
            });
        }
        if !(0..=MAX_TAX_RATE_BPS).contains(&rate_bps) {
            return Err(CoreError::Validation {
                field: "rate_bps",
                message: format!("rate must be between 0 and {MAX_TAX_RATE_BPS} bps"),
            });
        }
        Ok(())
    }

    /// List all active tax rates, ordered by name.
    ///
    /// TAX-03: archived (soft-deleted, `is_active = 0`) rates are hidden
    /// from listing so they can no longer be assigned or selected.
    pub fn list_tax_rates(&self) -> Result<Vec<TaxRate>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, rate_bps, is_default, is_inclusive, created_at, updated_at
             FROM tax_rates WHERE is_active = 1 ORDER BY name",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(TaxRate {
                id: row.get("id")?,
                name: row.get("name")?,
                rate_bps: row.get("rate_bps")?,
                is_default: row.get("is_default")?,
                is_inclusive: row.get("is_inclusive")?,
                created_at: row.get("created_at")?,
                updated_at: row.get("updated_at")?,
            })
        })?;
        rows.map(|r| Ok(r?)).collect()
    }

    /// Look up a single active tax rate by id.
    ///
    /// TAX-03: archived rates return `None` so they are invisible to
    /// rate resolution and management screens alike.
    pub fn get_tax_rate(&self, id: &str) -> Result<Option<TaxRate>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, rate_bps, is_default, is_inclusive, created_at, updated_at
             FROM tax_rates WHERE id = ?1 AND is_active = 1",
        )?;
        let result = stmt.query_row(params![id], |row| {
            Ok(TaxRate {
                id: row.get("id")?,
                name: row.get("name")?,
                rate_bps: row.get("rate_bps")?,
                is_default: row.get("is_default")?,
                is_inclusive: row.get("is_inclusive")?,
                created_at: row.get("created_at")?,
                updated_at: row.get("updated_at")?,
            })
        });
        match result {
            Ok(r) => Ok(Some(r)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// Return the active tax rate marked as the store-wide default.
    ///
    /// Returns `None` when no default rate is configured or the
    /// default rate has been archived.
    pub fn get_default_tax_rate(&self) -> Result<Option<TaxRate>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, rate_bps, is_default, is_inclusive, created_at, updated_at
             FROM tax_rates WHERE is_default = 1 AND is_active = 1",
        )?;
        let mut rows = stmt.query([])?;
        match rows.next()? {
            Some(row) => Ok(Some(TaxRate {
                id: row.get("id")?,
                name: row.get("name")?,
                rate_bps: row.get("rate_bps")?,
                is_default: row.get("is_default")?,
                is_inclusive: row.get("is_inclusive")?,
                created_at: row.get("created_at")?,
                updated_at: row.get("updated_at")?,
            })),
            None => Ok(None),
        }
    }

    /// Insert a new tax rate.
    pub fn create_tax_rate(
        &self,
        name: &str,
        rate_bps: i64,
        is_default: bool,
        is_inclusive: bool,
    ) -> Result<TaxRate, CoreError> {
        Self::validate_tax_rate_input(name, rate_bps)?;

        // TAX-02: clear the previous default and insert the new rate in one
        // transaction so a failed write cannot leave the store without a
        // default rate, and concurrent writers cannot race the flag swap.
        let tx = self.conn.unchecked_transaction()?;
        if is_default {
            // This writer cannot produce a scoped row, so the tier it belongs to
            // is always the tenant-global one. Clearing table-wide — what this
            // statement used to do — let a new global default silently
            // un-default every entity and location tier; the predicate below is
            // the global arm of clear_tier_default, which is the rule the
            // per-tier indexes state.
            Self::clear_tier_default(&tx, &TaxRateScope::Global)?;
        }

        let id = uuid::Uuid::now_v7().to_string();
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

        tx.execute(
            "INSERT INTO tax_rates (id, name, rate_bps, is_default, is_inclusive, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, name.trim(), rate_bps, is_default, is_inclusive, now, now],
        )?;
        tx.commit()?;

        Ok(TaxRate {
            id,
            name: name.trim().to_owned(),
            rate_bps,
            is_default,
            is_inclusive,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    /// Update an existing tax rate.
    pub fn update_tax_rate(
        &self,
        id: &str,
        name: &str,
        rate_bps: i64,
        is_default: bool,
        is_inclusive: bool,
    ) -> Result<TaxRate, CoreError> {
        Self::validate_tax_rate_input(name, rate_bps)?;

        // TAX-02: clear the previous default and apply the update in one
        // transaction so a failure cannot leave the store default-less or
        // with a stale default flag.
        let tx = self.conn.unchecked_transaction()?;
        if is_default {
            // This writer cannot produce a scoped row, so the tier it belongs to
            // is always the tenant-global one. Clearing table-wide — what this
            // statement used to do — let a new global default silently
            // un-default every entity and location tier; the predicate below is
            // the global arm of clear_tier_default, which is the rule the
            // per-tier indexes state.
            Self::clear_tier_default(&tx, &TaxRateScope::Global)?;
        }

        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        // TAX-03: archived (is_active = 0) rates are immutable — updating them
        // would resurrect a rate the operator explicitly hid, so the write is
        // rejected with NotFound (same as a missing id).
        let affected = tx.execute(
            "UPDATE tax_rates SET name = ?1, rate_bps = ?2, is_default = ?3, is_inclusive = ?4, updated_at = ?5 WHERE id = ?6 AND is_active = 1",
            params![name.trim(), rate_bps, is_default, is_inclusive, now, id],
        )?;
        if affected == 0 {
            return Err(CoreError::NotFound {
                entity: "tax_rate",
                id: id.to_owned(),
            });
        }
        tx.commit()?;

        Ok(TaxRate {
            id: id.to_owned(),
            name: name.trim().to_owned(),
            rate_bps,
            is_default,
            is_inclusive,
            created_at: String::new(),
            updated_at: now,
        })
    }

    /// The statutory rounding directive of each named rate row, in one read
    /// (E1-2, owner ruling 2026-09-10: statutory rounding wins over the store
    /// preference).
    ///
    /// `Some(mode)` = the row carries a statutory directive that outranks the
    /// preference; `None` = `''` or an id the query did not match — unknown and
    /// absent read identically as "the preference applies", because a caller
    /// resolved those rates from live rows a moment earlier and must not have
    /// the lookup turn into a second failure mode.
    ///
    /// The spellings are exactly `RoundingMode`'s serde `snake_case` names,
    /// pinned to this alphabet by the 20260929 CHECK — the schema refuses
    /// anything else, so an unparseable value here is hand-edited data and is
    /// refused loudly (the `tax_rate_scope` precedent: an unreadable row is an
    /// error, not a guess about money). Ids are chunked well below SQLite's
    /// `SQLITE_MAX_VARIABLE_NUMBER` (the PROD-12 batch bound).
    pub fn list_tax_rate_rounding_modes(
        &self,
        rate_ids: &[&str],
    ) -> Result<std::collections::HashMap<String, Option<RoundingMode>>, CoreError> {
        let mut out: std::collections::HashMap<String, Option<RoundingMode>> =
            rate_ids.iter().map(|id| ((*id).to_owned(), None)).collect();
        for chunk in rate_ids.chunks(500) {
            let placeholders = (1..=chunk.len())
                .map(|i| format!("?{i}"))
                .collect::<Vec<_>>()
                .join(", ");
            let sql = format!(
                "SELECT id, rounding_mode FROM tax_rates \
                 WHERE is_active = 1 AND id IN ({placeholders})"
            );
            let mut stmt = self.conn.prepare(&sql)?;
            let rows = stmt
                .query_map(rusqlite::params_from_iter(chunk.iter()), |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            for (id, raw) in rows {
                let directive = match raw.as_str() {
                    "" => None,
                    "half_up" => Some(RoundingMode::HalfUp),
                    "truncate" => Some(RoundingMode::Truncate),
                    other => {
                        return Err(CoreError::Validation {
                            field: "rounding_mode",
                            message: format!(
                                "tax rate {id} stores rounding_mode {other:?}, which is \
                                 outside the statutory alphabet; the 20260929 CHECK refuses \
                                 writes of it, so this is hand-edited data"
                            ),
                        });
                    }
                };
                out.insert(id, directive);
            }
        }
        Ok(out)
    }

    /// The statutory rounding directive of ONE rate row — the E1-2
    /// convenience over [`Self::list_tax_rate_rounding_modes`]. `None` = no
    /// directive, the store preference applies.
    pub fn tax_rate_rounding_mode(&self, rate_id: &str) -> Result<Option<RoundingMode>, CoreError> {
        self.list_tax_rate_rounding_modes(std::slice::from_ref(&rate_id))
            .map(|modes| modes.get(rate_id).cloned().flatten())
    }

    /// Count every reference to a tax rate (TAX-03).
    ///
    /// Returns how many products, categories, and historical sale lines
    /// currently reference the rate. Used by the delete confirmation UI
    /// to show dependencies before archiving, and by [`Self::delete_tax_rate`]
    /// to enforce the "block archiving rates referenced by sales" policy.
    pub fn tax_rate_dependency_counts(
        &self,
        id: &str,
    ) -> Result<TaxRateDependencyCounts, CoreError> {
        let products: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM product_taxes WHERE tax_rate_id = ?1",
            params![id],
            |row| row.get(0),
        )?;
        let categories: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM category_taxes WHERE tax_rate_id = ?1",
            params![id],
            |row| row.get(0),
        )?;
        let sale_lines: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM sale_lines WHERE tax_rate_id = ?1",
            params![id],
            |row| row.get(0),
        )?;
        Ok(TaxRateDependencyCounts {
            products,
            categories,
            sale_lines,
        })
    }

    /// Archive (soft-delete) a tax rate by id.
    ///
    /// TAX-03: instead of a hard `DELETE`, sets `is_active = 0` so
    /// historical `sale_lines.tax_rate_id` references keep a resolvable
    /// (though hidden) rate row for audit/reconciliation. Junction rows
    /// in `product_taxes`/`category_taxes` are removed in the same
    /// transaction, mirroring the old cascade behaviour.
    ///
    /// Archiving a rate still referenced by historical sales is blocked
    /// with a [`CoreError::Validation`] — receipts and audit trails must
    /// keep their rate linkage, and that check runs FIRST so an operator
    /// removing a rate that both prices a past sale and is someone's only
    /// coverage hears the history reason, which is the permanent one.
    ///
    /// A rate that is the last row covering a scoped location is blocked too
    /// — see [`Self::ensure_scoped_coverage_survives`]. The check runs inside
    /// this transaction, so the coverage it judged is the coverage the archive
    /// changes; the tenant-global tier is deliberately exempt there, which is
    /// also why a single-rate tenant can still turn its tax off.
    pub fn delete_tax_rate(&self, id: &str) -> Result<(), CoreError> {
        // TAX-03: never archive a rate referenced by historical sales.
        let counts = self.tax_rate_dependency_counts(id)?;
        if counts.sale_lines > 0 {
            return Err(CoreError::Validation {
                field: "tax_rate",
                message: format!(
                    "cannot archive tax rate {id}: referenced by {} historical sale line(s)",
                    counts.sale_lines
                ),
            });
        }

        let tx = self.conn.unchecked_transaction()?;
        Self::ensure_scoped_coverage_survives(&tx, id)?;
        let affected = tx.execute(
            "UPDATE tax_rates SET is_active = 0 WHERE id = ?1 AND is_active = 1",
            params![id],
        )?;
        if affected == 0 {
            return Err(CoreError::NotFound {
                entity: "tax_rate",
                id: id.to_owned(),
            });
        }
        // Junction rows are configuration, not history — drop them so no
        // product/category points at an archived rate.
        tx.execute(
            "DELETE FROM product_taxes WHERE tax_rate_id = ?1",
            params![id],
        )?;
        tx.execute(
            "DELETE FROM category_taxes WHERE tax_rate_id = ?1",
            params![id],
        )?;
        tx.commit()?;
        Ok(())
    }
}
