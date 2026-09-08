//! Tax rate CRUD — list, get, create, update, delete, and product/category assignments.
/*
last audited 25-07-26 by RSA-Agent (oz-core slice B5 part 4)
crate: oz-core | status: SAFE | lint: CLEAN
findings: exemplary — TAX-02 default-flag swap atomic in tx; TAX-03 archive-not-delete with sale-line reference guard + junction cleanup + archived-rate immutability + active-rate validation on assignment; TAX-04 bounded bps with overflow rationale (MAX_TAX_RATE_BPS); PROD-12 batch junction query with documented SQLITE_MAX_VARIABLE_NUMBER bound
next: none | perf: batch query documented
*/

use rusqlite::params;

use crate::error::CoreError;
use crate::tax_rate::TaxRate;

use super::Store;

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
    fn validate_tax_rate_input(name: &str, rate_bps: i64) -> Result<(), CoreError> {
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
            tx.execute(
                "UPDATE tax_rates SET is_default = 0 WHERE is_default = 1",
                [],
            )?;
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
            tx.execute(
                "UPDATE tax_rates SET is_default = 0 WHERE is_default = 1",
                [],
            )?;
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
    /// keep their rate linkage.
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

    /// Validate that every id in `tax_rate_ids` resolves to an active
    /// (`is_active = 1`) tax rate.
    ///
    /// TAX-03: archived rates are immutable and hidden — an assignment
    /// must not silently point a product/category at one. Unknown ids are
    /// rejected with the same structured `NotFound` so a stale/malformed
    /// payload cannot wedge a junction row against a missing rate.
    fn ensure_active_tax_rate_ids(&self, tax_rate_ids: &[String]) -> Result<(), CoreError> {
        for id in tax_rate_ids {
            if self.get_tax_rate(id)?.is_none() {
                return Err(CoreError::NotFound {
                    entity: "tax_rate",
                    id: id.clone(),
                });
            }
        }
        Ok(())
    }

    /// Assign tax rates to a product.
    ///
    /// TAX-03: every id must resolve to an active rate — archived or
    /// unknown ids are rejected up front so the junction can never point
    /// at a hidden/immutable rate (defense-in-depth on top of the UI only
    /// listing active rates).
    pub fn set_product_tax_rates(
        &self,
        sku: &str,
        tax_rate_ids: &[String],
    ) -> Result<(), CoreError> {
        self.ensure_active_tax_rate_ids(tax_rate_ids)?;
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "DELETE FROM product_taxes WHERE product_sku = ?1",
            params![sku],
        )?;
        for id in tax_rate_ids {
            tx.execute(
                "INSERT OR IGNORE INTO product_taxes (product_sku, tax_rate_id) VALUES (?1, ?2)",
                params![sku, id],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Get all tax rate IDs assigned to a product.
    pub fn get_product_tax_rates(&self, sku: &str) -> Result<Vec<String>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT tax_rate_id FROM product_taxes WHERE product_sku = ?1 ORDER BY created_at",
        )?;
        let ids = stmt
            .query_map(params![sku], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(ids)
    }

    /// Get tax rate IDs for many products in one query (PROD-12).
    ///
    /// Returns a map of `product_sku -> [tax_rate_id, ...]` ordered by
    /// `created_at`. This replaces the per-product `get_product_tax_rates`
    /// loop in list endpoints, removing the N+1 database pattern for
    /// catalog loads. Products with no assignments are absent from the map.
    ///
    /// Bounds: the `IN (...)` clause binds one parameter per SKU, so very
    /// large catalogs are capped by SQLite's `SQLITE_MAX_VARIABLE_NUMBER`
    /// (999 in common builds). Callers with larger catalogs should chunk
    /// the SKU list; the current list endpoint stays well under this limit.
    pub fn get_product_tax_rates_batch(
        &self,
        skus: &[String],
    ) -> Result<std::collections::HashMap<String, Vec<String>>, CoreError> {
        use std::collections::HashMap;

        let mut map: HashMap<String, Vec<String>> = HashMap::new();
        if skus.is_empty() {
            return Ok(map);
        }
        let placeholders: Vec<String> = (1..=skus.len()).map(|i| format!("?{i}")).collect();
        let sql = format!(
            "SELECT product_sku, tax_rate_id FROM product_taxes \
             WHERE product_sku IN ({}) ORDER BY created_at",
            placeholders.join(", ")
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map(rusqlite::params_from_iter(skus.iter()), |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        for row in rows {
            let (sku, rate_id) = row?;
            map.entry(sku).or_default().push(rate_id);
        }
        Ok(map)
    }

    /// Assign tax rates to a category.
    ///
    /// TAX-03: every id must resolve to an active rate — archived or
    /// unknown ids are rejected up front (see
    /// `Self::ensure_active_tax_rate_ids`).
    pub fn set_category_tax_rates(
        &self,
        category_id: &str,
        tax_rate_ids: &[String],
    ) -> Result<(), CoreError> {
        self.ensure_active_tax_rate_ids(tax_rate_ids)?;
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "DELETE FROM category_taxes WHERE category_id = ?1",
            params![category_id],
        )?;
        for id in tax_rate_ids {
            tx.execute(
                "INSERT OR IGNORE INTO category_taxes (category_id, tax_rate_id) VALUES (?1, ?2)",
                params![category_id, id],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Get all tax rate IDs assigned to a category.
    pub fn get_category_tax_rates(&self, category_id: &str) -> Result<Vec<String>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT tax_rate_id FROM category_taxes WHERE category_id = ?1 ORDER BY created_at",
        )?;
        let ids = stmt
            .query_map(params![category_id], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(ids)
    }
    // ── Scoped resolution ─────────────────────────────────────────────
    //
    // tax-separation P1 slice 1 (todo-global-saas-2.md, "Separate business
    // tax configuration from application defaults"). The four columns added by
    // 20260921_tax_rate_scoping.sql are read here and nowhere else; nothing in
    // the sale computation path calls this yet, because nothing can author a
    // scoped row until the write-side slice lands. Wiring the resolver into
    // `compute_sale_tax` before then would change money math on every sale to
    // serve a table that can only ever hold tenant-global rows.

    /// Resolve the tax rate that applies at one location on one business date.
    ///
    /// Walks the three applicability levels most-specific-first and returns the
    /// first level that yields a live row:
    ///
    /// 1. the row scoped to `location_id`;
    /// 2. the row scoped to `legal_entity_id` (every location under the entity);
    /// 3. the **tenant-global** row — both scope columns NULL, which is what
    ///    every row in this table is today.
    ///
    /// That last level is the fail-closed answer, and it is why this slice can
    /// land before any writer exists: an unscoped database resolves to exactly
    /// the row it resolves to now. Passing `None` for `legal_entity_id` skips
    /// level 2 rather than matching rows whose entity is NULL — a NULL entity
    /// means "not scoped to an entity", never "matches any entity".
    ///
    /// Within a level the winner is `is_default` first (the operator's explicit
    /// pick, and the only applicability signal that predates scoping), then the
    /// newest `effective_from`, then the id — so the answer never depends on
    /// SQLite's row order.
    ///
    /// A row that cannot be trusted is SKIPPED, not guessed at, and the walk
    /// continues to the next level: an ambiguous scope (both columns set), a
    /// malformed `effective_from` / `effective_to`, or an empty-string date.
    /// Same ruling as the signed payload's `features` block in
    /// [`crate::subscription::TenantSubscription::payload_features`] — silence
    /// is the only safe reading of data that cannot be trusted, and a corrupt
    /// expiry must not get to decide a money question.
    ///
    /// `as_of` must be a business date, `YYYY-MM-DD`. A malformed `as_of` is
    /// the CALLER's bug and returns `CoreError::Validation` rather than
    /// resolving to nothing: `Ok(None)` here means "no rate is configured", so
    /// swallowing a bad argument would make a typo look like an unconfigured
    /// tenant.
    ///
    /// Returns `Ok(None)` when no level matches — the same "no tax configured"
    /// answer [`Self::get_default_tax_rate`] gives, which the callers' existing
    /// zero-rate path handles unchanged.
    pub fn resolve_tax_rate_for_location(
        &self,
        location_id: &str,
        legal_entity_id: Option<&str>,
        as_of: &str,
    ) -> Result<Option<TaxRate>, CoreError> {
        let as_of = parse_effective_date(as_of).ok_or_else(|| CoreError::Validation {
            field: "as_of",
            message: format!("expected a business date 'YYYY-MM-DD', got {as_of:?}"),
        })?;

        let mut stmt = self.conn.prepare(
            "SELECT id, name, rate_bps, is_default, is_inclusive, created_at, updated_at,
                    legal_entity_id, location_id, effective_from, effective_to
             FROM tax_rates
             WHERE is_active = 1
               AND ( location_id = ?1
                  OR (location_id IS NULL AND legal_entity_id = ?2)
                  OR (location_id IS NULL AND legal_entity_id IS NULL) )",
        )?;
        let candidates = stmt
            .query_map(params![location_id, legal_entity_id], |row| {
                Ok(TaxRateCandidate {
                    rate: TaxRate {
                        id: row.get("id")?,
                        name: row.get("name")?,
                        rate_bps: row.get("rate_bps")?,
                        is_default: row.get("is_default")?,
                        is_inclusive: row.get("is_inclusive")?,
                        created_at: row.get("created_at")?,
                        updated_at: row.get("updated_at")?,
                    },
                    legal_entity_id: row.get("legal_entity_id")?,
                    location_id: row.get("location_id")?,
                    effective_from: row.get("effective_from")?,
                    effective_to: row.get("effective_to")?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        for tier in [
            ScopeTier::Location,
            ScopeTier::LegalEntity,
            ScopeTier::Global,
        ] {
            let mut best: Option<&TaxRateCandidate> = None;
            for c in candidates
                .iter()
                .filter(|c| c.in_tier(tier, location_id, legal_entity_id) && c.is_live(as_of))
            {
                let replace = match best {
                    None => true,
                    Some(b) => c.is_better_than(b),
                };
                if replace {
                    best = Some(c);
                }
            }
            if let Some(winner) = best {
                return Ok(Some(winner.rate.clone()));
            }
        }

        Ok(None)
    }

    /// The scope one stored rate row carries, as a type that cannot express the
    /// ambiguous "both columns set" case.
    ///
    /// Outer `None` means there is no such active row (missing or archived). An
    /// ambiguous row is an ERROR, not a silent downgrade to one of the two
    /// scopes: the caller is told which rate is unresolvable instead of being
    /// handed a guess about money.
    pub fn tax_rate_scope(&self, rate_id: &str) -> Result<Option<TaxRateScope>, CoreError> {
        let pair: Option<(Option<String>, Option<String>)> = self
            .conn
            .query_row(
                "SELECT legal_entity_id, location_id FROM tax_rates
                 WHERE id = ?1 AND is_active = 1",
                params![rate_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .ok();
        let Some((entity, location)) = pair else {
            return Ok(None);
        };
        match TaxRateScope::classify(entity.as_deref(), location.as_deref()) {
            Some(scope) => Ok(Some(scope)),
            None => Err(CoreError::Validation {
                field: "tax_rate_scope",
                message: format!(
                    "tax rate {rate_id} is scoped to both a legal entity and a location; \
                     the two columns are one-or-the-other-or-neither"
                ),
            }),
        }
    }

    /// The legal entity a location sits under, from the location row itself.
    ///
    /// Derived rather than passed, so a caller cannot claim an entity its
    /// location does not have — the walk's level 2 must be the entity the
    /// branch actually belongs to, not whichever one the request named.
    /// `Ok(None)` covers both "no such location" and "location with no entity
    /// assigned" (`legal_entity_id` is still nullable per
    /// 20260908_legal_entities.sql), and in both cases the entity level is
    /// skipped rather than wildcarded.
    pub fn location_legal_entity(&self, location_id: &str) -> Result<Option<String>, CoreError> {
        Ok(self
            .conn
            .query_row(
                "SELECT legal_entity_id FROM locations WHERE id = ?1",
                rusqlite::params![location_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .ok()
            .flatten())
    }

    /// Whether one rate row may price a sale at `scope`.
    ///
    /// This is the filter the product- and category-assigned levels need, and
    /// it is the same two questions the scoped walk asks of its own candidates:
    /// does the row's scope cover this location, and is its window open on this
    /// date. An assignment is an instruction to USE a rate, not a licence to
    /// ignore where that rate says it applies — a product pinned to a
    /// Jakarta-only rate must not pay Jakarta tax in Bali, and a rate whose
    /// period has ended must not price anything at all.
    ///
    /// Returns `true` for a tenant-global row with an open (or absent) window,
    /// which is every row written before 20260921 — so filtering an
    /// assignment list changes nothing for an unscoped tenant.
    ///
    /// A missing or archived row is `false`: it cannot price a sale, and
    /// "not found" and "not applicable" have the same money answer.
    pub(crate) fn tax_rate_applies_at(
        &self,
        rate_id: &str,
        scope: &TaxSaleScope,
        entity_of_scope: Option<&str>,
    ) -> Result<bool, CoreError> {
        let row = self
            .conn
            .query_row(
                "SELECT legal_entity_id, location_id, effective_from, effective_to \
                 FROM tax_rates WHERE id = ?1 AND is_active = 1",
                rusqlite::params![rate_id],
                |r| {
                    Ok((
                        r.get::<_, Option<String>>(0)?,
                        r.get::<_, Option<String>>(1)?,
                        r.get::<_, Option<String>>(2)?,
                        r.get::<_, Option<String>>(3)?,
                    ))
                },
            )
            .ok();
        let Some((entity, location, from, to)) = row else {
            return Ok(false);
        };
        let Some(mine) = TaxRateScope::classify(entity.as_deref(), location.as_deref()) else {
            // Ambiguous scope: no tier may claim it, same refusal as the walk.
            return Ok(false);
        };
        let in_scope = match mine {
            TaxRateScope::Global => true,
            TaxRateScope::Location(l) => l == scope.location_id,
            TaxRateScope::LegalEntity(e) => entity_of_scope == Some(e.as_str()),
        };
        if !in_scope {
            return Ok(false);
        }
        Ok(window_covers(
            from.as_deref(),
            to.as_deref(),
            scope.as_date()?,
        ))
    }
}

// ── Scoped-resolution support types ─────────────────────────────────────────

/// Which applicability level a tax-rate row belongs to.
///
/// The point of this enum is what it CANNOT hold: a row scoped to both a legal
/// entity and a location is not a third, narrower scope — it is an ambiguous
/// one, and there is no variant for it. SQLite cannot add a CHECK constraint by
/// `ALTER TABLE`, so this type is where the one-or-the-other-or-neither rule
/// lives until the write-side slice can put a guard on the only path able to
/// create such a row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TaxRateScope {
    /// Both scope columns NULL — the tenant-global legacy default, which is
    /// what every row in this table is today.
    Global,
    /// Applies to every location under this legal entity.
    LegalEntity(String),
    /// Applies to this location only; outranks the entity row above it.
    Location(String),
}

impl TaxRateScope {
    /// Classify a stored scope pair, or return `None` when the pair is
    /// ambiguous (both set).
    #[must_use]
    pub fn classify(legal_entity_id: Option<&str>, location_id: Option<&str>) -> Option<Self> {
        match (legal_entity_id, location_id) {
            (None, None) => Some(Self::Global),
            (Some(e), None) => Some(Self::LegalEntity(e.to_owned())),
            (None, Some(l)) => Some(Self::Location(l.to_owned())),
            (Some(_), Some(_)) => None,
        }
    }

    /// Whether this is the tenant-global legacy row.
    #[must_use]
    pub fn is_global(&self) -> bool {
        matches!(self, Self::Global)
    }
}

/// Where and when a sale is being priced — the input the tax read path needs
/// before it can honour a scoped rate.
///
/// Both fields are REQUIRED, deliberately: an optional date would silently
/// degrade every scoped row to "as if today", and "today" is the exact value
/// this table windows on. A caller that does not know the location or the
/// business date passes `None` for the whole scope and gets the tenant-global
/// answer, not a guessed one.
///
/// `as_of` is a business date, `YYYY-MM-DD`. **Who owns that date is a live
/// question, not a solved one:** `sale.created_at` is a UTC RFC3339 stamp and
/// `locations.timezone` is written as an IANA name but read as a fixed offset —
/// the defect recorded in todo-global-saas-2.md §Regional configuration, open
/// question 1. Converting here would invent a timezone policy inside money
/// math, so the CALLER supplies the date and this layer stays honest: a sale
/// rung up at 20:00 UTC on 31 December in Jakarta is 03:00 on 1 January
/// locally, and only the caller knows which one it means.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TaxSaleScope {
    /// The location pricing the sale — the branch the customer stands in.
    pub location_id: String,
    /// Business date the sale is priced on, `YYYY-MM-DD`.
    pub as_of: String,
}

impl TaxSaleScope {
    /// Parse `as_of`, or a `Validation` error.
    ///
    /// A bad date is the caller's bug and errors rather than resolving to
    /// "nothing applies": silently dropping every scoped rate because of a
    /// typo'd date would price the sale on the tenant-global row and look like
    /// a configuration answer rather than a crash.
    pub(crate) fn as_date(&self) -> Result<chrono::NaiveDate, CoreError> {
        let as_of = self.as_of.as_str();
        // Same `field` name as [`Store::resolve_tax_rate_for_location`] uses for
        // the same mistake, so a bad business date has ONE error vocabulary
        // whichever door the caller came through.
        parse_effective_date(as_of).ok_or_else(|| CoreError::Validation {
            field: "as_of",
            message: format!("expected a business date 'YYYY-MM-DD', got {as_of:?}"),
        })
    }
}

/// Whether a validity window covers `as_of`.
///
/// Extracted so the rule is stated ONCE for both readers: the scoped resolver
/// walking the levels, and the applicability filter applied to
/// product/category assignments. `effective_to` is EXCLUSIVE — a period and
/// its successor cannot both match on the boundary day. A date that does not
/// parse makes the row untrusted, so it does NOT cover.
pub(crate) fn window_covers(
    effective_from: Option<&str>,
    effective_to: Option<&str>,
    as_of: chrono::NaiveDate,
) -> bool {
    let lower_ok = match effective_from {
        None => true,
        Some(v) => parse_effective_date(v).is_some_and(|d| d <= as_of),
    };
    if !lower_ok {
        return false;
    }
    match effective_to {
        None => true,
        Some(v) => parse_effective_date(v).is_some_and(|d| as_of < d),
    }
}

/// One candidate row, deliberately kept out of [`TaxRate`].
///
/// Folding the four new columns into `TaxRate` would rewrite ten literal
/// constructions across `oz-api`, `modules/tax` and `platform/sync` for a slice
/// that changes no wire shape — and `TaxRate` is serialized straight into both
/// clients' tax screens. Scope and window are resolution inputs, not part of a
/// rate's published identity.
struct TaxRateCandidate {
    rate: TaxRate,
    legal_entity_id: Option<String>,
    location_id: Option<String>,
    effective_from: Option<String>,
    effective_to: Option<String>,
}

/// The three levels of the walk, most specific first.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ScopeTier {
    Location,
    LegalEntity,
    Global,
}

impl TaxRateCandidate {
    /// Whether this row belongs to `tier` for the requested location / entity.
    ///
    /// Every arm goes through [`TaxRateScope::classify`], so an ambiguous row
    /// matches no tier and is skipped by the walk rather than being claimed by
    /// whichever column happened to be read first.
    fn in_tier(&self, tier: ScopeTier, location_id: &str, legal_entity_id: Option<&str>) -> bool {
        let mine =
            TaxRateScope::classify(self.legal_entity_id.as_deref(), self.location_id.as_deref());
        match tier {
            ScopeTier::Location => mine == Some(TaxRateScope::Location(location_id.to_owned())),
            ScopeTier::LegalEntity => match legal_entity_id {
                // No entity in the request means level 2 is skipped entirely —
                // never "matches every entity-scoped row".
                None => false,
                Some(entity) => mine == Some(TaxRateScope::LegalEntity(entity.to_owned())),
            },
            ScopeTier::Global => mine == Some(TaxRateScope::Global),
        }
    }

    /// Whether the row's validity window covers `as_of`.
    ///
    /// `effective_to` is EXCLUSIVE, so a period and its successor cannot both
    /// match on the boundary day. A stored date that does not parse returns
    /// false: the row is skipped, never trusted.
    fn is_live(&self, as_of: chrono::NaiveDate) -> bool {
        window_covers(
            self.effective_from.as_deref(),
            self.effective_to.as_deref(),
            as_of,
        )
    }

    /// Ordering within one tier: explicit default, then newest start, then id.
    fn is_better_than(&self, other: &Self) -> bool {
        if self.rate.is_default != other.rate.is_default {
            return self.rate.is_default;
        }
        let mine = self
            .effective_from
            .as_deref()
            .and_then(parse_effective_date)
            .unwrap_or(chrono::NaiveDate::MIN);
        let theirs = other
            .effective_from
            .as_deref()
            .and_then(parse_effective_date)
            .unwrap_or(chrono::NaiveDate::MIN);
        if mine != theirs {
            return mine > theirs;
        }
        self.rate.id < other.rate.id
    }
}

/// Parse a business date, strictly: exactly `YYYY-MM-DD`.
///
/// Rejects RFC3339 timestamps, `YYYY-M-D`, trailing whitespace and the empty
/// string. The window comparison is only meaningful while every stored value
/// shares one shape, and [`chrono::NaiveDate`] ordering (not string ordering)
/// is what decides, so a month 13 or a leap-day typo fails here instead of
/// comparing as text.
fn parse_effective_date(value: &str) -> Option<chrono::NaiveDate> {
    let b = value.as_bytes();
    let shape_ok = b.len() == 10
        && b[..4].iter().all(|c| c.is_ascii_digit())
        && b[4] == b'-'
        && b[5..7].iter().all(|c| c.is_ascii_digit())
        && b[7] == b'-'
        && b[8..].iter().all(|c| c.is_ascii_digit());
    if !shape_ok {
        return None;
    }
    chrono::NaiveDate::from_ymd_opt(
        value.get(0..4)?.parse().ok()?,
        value.get(5..7)?.parse().ok()?,
        value.get(8..10)?.parse().ok()?,
    )
}

#[cfg(test)]
#[path = "tax_tests.rs"]
mod tests;
