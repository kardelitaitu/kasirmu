//! Sale tax computation (TAX-04/05/06).
//!
//! Key functions: `compute_sale_tax` (per-line breakdown across all
//! applicable rates), `compute_cart_tax` (cart-level IPC input), and
//! `resolve_best_tax_rates_for_sku`. Line/rate math reuses the parent
//! `compute_line_tax` helper, kept in the parent because the unit tests
//! call it directly.
//!
//! Invariants: integer-only arithmetic with explicit rounding modes;
//! inclusive tax is never added on top of displayed prices.
//!
//! E1 (owner ruling 2026-09-10): a rate row may carry a STATUTORY rounding
//! directive (`tax_rates.rounding_mode`, 20260929). When present it outranks
//! the `mode` argument — which is the store preference — for that rate's
//! contribution, and the per-line breakdown JSON stamps `rounding` +
//! `rounding_source` at write time so a ticket freezes its rounding
//! provenance. Breakdown rows written before E1 carry neither key: read them
//! as `preference`, which was the only mode that existed. A line whose rates
//! carry no directive rounds exactly as before — the zero-behavior-change
//! invariant, pinned by this module's pre-E1 tests running unmodified.

use super::*;
use crate::db::tax::TaxSaleScope;
use crate::tax_rate::{RoundingMode, TaxRate};

impl Store<'_> {
    /// E1: the mode that rounds THIS rate's contribution — the row's
    /// statutory directive when it carries one, else the preference — plus
    /// which of the two decided, for the breakdown's freeze-at-write stamp.
    fn effective_rounding_for_rate(
        &self,
        rate_id: &str,
        preference: RoundingMode,
    ) -> Result<(RoundingMode, &'static str), CoreError> {
        match self.tax_rate_rounding_mode(rate_id)? {
            Some(statutory) => Ok((statutory, "statutory")),
            None => Ok((preference, "preference")),
        }
    }

    /// Compute tax breakdown for a sale in-place.
    ///
    /// For each line resolves ALL applicable tax rates via the chain:
    /// 1. Product-level tax rates (`get_product_tax_rates`)
    /// 2. Category-level tax rates (via the product's `category_id`)
    /// 3. Default store-wide tax rate (where `is_default = true`)
    ///
    /// `lua_overrides` — per-SKU tax rate overrides from plugins.
    /// When a SKU is present in `lua_overrides` its `(rate_bps, is_inclusive)`
    /// values are used instead of the DB-resolved rates for that line.
    ///
    /// All rates for a line contribute to its total tax. Stores the
    /// first rate's id in `tax_rate_id` for backward compatibility.
    /// Updates each line's `tax_amount`, then sets `sale.subtotal`
    /// and `sale.tax_total`.
    ///
    /// `mode` controls how fractional per-rate results are rounded
    /// (TAX-05): pass [`RoundingMode::HalfUp`] for new sales and
    /// [`RoundingMode::Truncate`] when reproducing legacy behavior.
    ///
    /// The UNSCOPED door: no location, so only tenant-global rates can apply.
    ///
    /// Kept as a named function rather than a `None` argument because 30+
    /// existing tests and the legacy rounding paths call it, and every one of
    /// them is now also the proof that scoping moved nothing for a tenant with
    /// no scoped rows. A caller that knows which branch the customer is
    /// standing in — which is every real sale path — must use
    /// [`Self::compute_sale_tax_for_location`] instead, or a scoped rate will
    /// silently not apply.
    pub fn compute_sale_tax(
        &self,
        sale: &mut Sale,
        lua_overrides: &[(String, i64, bool)],
        mode: RoundingMode,
    ) -> Result<(), CoreError> {
        self.compute_sale_tax_for_location(sale, lua_overrides, mode, None)
    }

    /// `scope` is the location + business date the sale is priced on; see
    /// [`Self::resolve_best_tax_rates_for_sku`] for exactly what it changes.
    /// `None` reproduces the pre-scoping answer bit for bit.
    ///
    /// `is_inclusive` is read PER RATE, from the resolved row, so a location
    /// override carries its own inclusive flag rather than inheriting the
    /// tenant default's: the inclusive/exclusive branch below is driven by
    /// `rate.is_inclusive` for each rate that survives resolution.
    pub fn compute_sale_tax_for_location(
        &self,
        sale: &mut Sale,
        lua_overrides: &[(String, i64, bool)],
        mode: RoundingMode,
        scope: Option<&TaxSaleScope>,
    ) -> Result<(), CoreError> {
        let currency = sale.currency;
        let mut total_tax: Option<Money> = None;
        let mut subtotal: Option<Money> = None;
        // TAX-06: exclusive-tax contributions tracked separately so the
        // sale total reflects the true collectible amount. Inclusive tax
        // is embedded in the displayed price (total already includes it);
        // exclusive tax must be added to the total.
        let mut exclusive_tax: Option<Money> = None;

        // MONEY-02 follow-up: reject negative line totals in a pre-pass so a
        // hand-built `Sale` cannot record negative tax on the ledger, and so
        // the error path leaves no partially-mutated Sale behind. CartLine
        // asserts qty > 0 so this is unreachable from the front-end, but this
        // is the tax boundary.
        for line in &sale.lines {
            if line.line_total.minor_units < 0 {
                return Err(CoreError::Validation {
                    field: "line_total",
                    message: format!(
                        "line total must be non-negative, got {}",
                        line.line_total.minor_units
                    ),
                });
            }
        }

        for line in &mut sale.lines {
            let line_subtotal = line.line_total;
            let mut line_tax = Money::zero(currency);
            // TAX-02: per-rate breakdown persisted on the line so multi-rate
            // detail survives (state + local, etc.) even if a rate is later
            // archived/renamed. `tax_rate_id` keeps only the FIRST rate id.
            let mut line_breakdown: Vec<serde_json::Value> = Vec::new();

            // Check for a Lua plugin override first.
            let override_idx = lua_overrides
                .iter()
                .position(|(sku, _, _)| sku == &line.sku);

            if let Some(idx) = override_idx {
                let (_, rate_bps, is_inclusive) = &lua_overrides[idx];
                // D89-1 Option B (owner ruling; D90 rulings): the plugin OWNS
                // the amount — `rate_bps` and `is_inclusive` below are the
                // plugin's verdict — but the WINNING rate's statutory rounding
                // directive still governs how that amount is rounded. Same
                // resolver the DB arm uses, FIRST-ROW directive
                // (`rates.first()`, mirroring the DB arm's
                // `line.tax_rate_id = rates.first()` winning semantics);
                // empty rates fall back to the preference. Resolver errors
                // propagate like the DB arm's — the directive is a money
                // input now, so it must never be silently folded away.
                let rates = self.resolve_best_tax_rates_for_sku_at(&line.sku, scope)?;
                let (effective, source) = match rates.first() {
                    Some(winning) => self.effective_rounding_for_rate(&winning.id, mode)?,
                    None => (mode, "preference"),
                };
                let rbps = *rate_bps;
                let tax = compute_line_tax(
                    line_subtotal.minor_units,
                    rbps,
                    *is_inclusive,
                    line_subtotal.currency,
                    effective,
                )?;
                line_tax = line_tax
                    .checked_add(tax)
                    .ok_or_else(|| CoreError::Validation {
                        field: "tax",
                        message: "line tax overflow".into(),
                    })?;
                // TAX-06: track exclusive tax for the total correction.
                if !is_inclusive {
                    exclusive_tax = Some(match exclusive_tax {
                        None => tax,
                        Some(acc) => acc.checked_add(tax).ok_or_else(|| CoreError::Validation {
                            field: "tax",
                            message: "exclusive tax accumulation overflow".into(),
                        })?,
                    });
                }
                // No DB tax_rate_id for override lines. `rate_source` marks
                // the plugin provenance (additive key, no consumers today);
                // `rounding`/`rounding_source` keep the shared vocabulary.
                line.tax_rate_id = None;
                line_breakdown.push(serde_json::json!({
                    "rate_id": null,
                    "rate_bps": rbps,
                    "is_inclusive": *is_inclusive,
                    "tax_minor": tax.minor_units,
                    "rounding": effective.wire_name(),
                    "rounding_source": source,
                    "rate_source": "lua_override",
                }));
            } else {
                let rates = self.resolve_best_tax_rates_for_sku_at(&line.sku, scope)?;

                for rate in &rates {
                    // E1: per rate — two rates with different directives on
                    // one line each round their own contribution.
                    let (effective, source) = self.effective_rounding_for_rate(&rate.id, mode)?;
                    let tax = compute_line_tax(
                        line_subtotal.minor_units,
                        rate.rate_bps,
                        rate.is_inclusive,
                        line_subtotal.currency,
                        effective,
                    )?;
                    line_tax = line_tax
                        .checked_add(tax)
                        .ok_or_else(|| CoreError::Validation {
                            field: "tax",
                            message: "line tax overflow".into(),
                        })?;
                    // TAX-06: track exclusive tax for the total correction.
                    if !rate.is_inclusive {
                        exclusive_tax = Some(match exclusive_tax {
                            None => tax,
                            Some(acc) => {
                                acc.checked_add(tax).ok_or_else(|| CoreError::Validation {
                                    field: "tax",
                                    message: "exclusive tax accumulation overflow".into(),
                                })?
                            }
                        });
                    }
                    line_breakdown.push(serde_json::json!({
                        "rate_id": rate.id,
                        "rate_bps": rate.rate_bps,
                        "is_inclusive": rate.is_inclusive,
                        "tax_minor": tax.minor_units,
                        "rounding": effective.wire_name(),
                        "rounding_source": source,
                    }));
                }

                line.tax_rate_id = rates.first().map(|r| r.id.clone());
            }

            line.tax_breakdown_json =
                if line_breakdown.is_empty() {
                    None
                } else {
                    Some(serde_json::to_string(&line_breakdown).map_err(|e| {
                        CoreError::Internal(format!("serializing tax breakdown: {e}"))
                    })?)
                };

            line.tax_amount = line_tax;

            total_tax = match total_tax {
                None => Some(line_tax),
                Some(acc) => {
                    Some(
                        acc.checked_add(line_tax)
                            .ok_or_else(|| CoreError::Validation {
                                field: "tax",
                                message: "sale tax total overflow".into(),
                            })?,
                    )
                }
            };

            subtotal =
                match subtotal {
                    None => Some(line.line_total),
                    Some(acc) => Some(acc.checked_add(line.line_total).ok_or_else(|| {
                        CoreError::Validation {
                            field: "subtotal",
                            message: "sale subtotal overflow".into(),
                        }
                    })?),
                };
        }

        // A sale always has ≥ 1 line (the loop above runs once per line), so
        // `subtotal`/`total_tax` are always `Some` here — overflow would have
        // already returned a `Validation` error. `unwrap_or_else` is defensive
        // only; it must NOT silently zero real money, which is why overflow
        // is propagated above instead of folded into `None`.
        sale.subtotal = subtotal.unwrap_or_else(|| Money::zero(currency));
        sale.tax_total = total_tax.unwrap_or_else(|| Money::zero(currency));

        // TAX-06: when exclusive tax was computed, the sale total must
        // include it. `Sale::from_cart` sets `total` from the cart total
        // (post-discount, pre-tax); the customer pays the discounted
        // subtotal PLUS the exclusive tax on top. Adding it here makes
        // `sales.total_minor` the true collectible amount, matching the
        // receipt's "grand total (subtotal + tax)" contract.
        if let Some(et) = exclusive_tax {
            sale.total = sale
                .total
                .checked_add(et)
                .ok_or_else(|| CoreError::Validation {
                    field: "total",
                    message: "sale total overflow from exclusive tax".into(),
                })?;
        }

        Ok(())
    }

    /// Compute the total tax for a set of cart lines (live preview).
    ///
    /// For each cart line resolves ALL applicable tax rates and sums
    /// their contributions. Returns the total tax amount plus whether any
    /// EXCLUSIVE rate applied (see [`CartTaxResult`]).
    ///
    /// `mode` controls how fractional per-rate results are rounded
    /// (TAX-05): pass [`RoundingMode::HalfUp`] for new sales and
    /// [`RoundingMode::Truncate`] when reproducing legacy behavior.
    ///
    /// The UNSCOPED door — see [`Self::compute_sale_tax`] for why it stays a
    /// named function rather than a `None` argument.
    pub fn compute_cart_tax(
        &self,
        lines: &[CartLineTaxInput],
        currency: Currency,
        mode: RoundingMode,
    ) -> Result<CartTaxResult, CoreError> {
        self.compute_cart_tax_for_location(lines, currency, mode, None)
    }

    /// `scope` must be the SAME location + business date the checkout will use,
    /// or the preview and the receipt disagree about what the customer owes.
    /// A cart preview crossing midnight into a rate's boundary day is a real
    /// case, not a curiosity: the exclusive `effective_to` means the successor
    /// takes over on that day, so the two calls must resolve on the same date
    /// for the same location.
    pub fn compute_cart_tax_for_location(
        &self,
        lines: &[CartLineTaxInput],
        currency: Currency,
        mode: RoundingMode,
        scope: Option<&TaxSaleScope>,
    ) -> Result<CartTaxResult, CoreError> {
        let mut total_tax: Option<Money> = None;
        let mut has_exclusive = false;

        for line in lines {
            // MONEY-02: negative qty/price would produce a negative line total
            // and a negative "tax" preview (the front-end renders it raw). The
            // cart model never allows negative qty/price, so reject them with a
            // structured Validation error naming the offending field.
            if line.qty < 0 {
                return Err(CoreError::Validation {
                    field: "qty",
                    message: format!("qty must be positive, got {}", line.qty),
                });
            }
            if line.unit_price_minor < 0 {
                return Err(CoreError::Validation {
                    field: "price",
                    message: format!(
                        "unit price must be non-negative, got {}",
                        line.unit_price_minor
                    ),
                });
            }
            // MONEY-01: the line total comes from untrusted IPC input and must
            // use checked arithmetic like `compute_line_tax` (TAX-04). The
            // workspace disables overflow-checks for dev/test builds, so a
            // bare `*` silently wraps and feeds a wrong tax to the register.
            let line_total_minor =
                line.qty.checked_mul(line.unit_price_minor).ok_or_else(|| {
                    CoreError::Validation {
                        field: "tax",
                        message: "cart line total overflow".into(),
                    }
                })?;
            let rates = self.resolve_best_tax_rates_for_sku_at(&line.sku, scope)?;

            for rate in &rates {
                let (effective, _source) = self.effective_rounding_for_rate(&rate.id, mode)?;
                let tax = compute_line_tax(
                    line_total_minor,
                    rate.rate_bps,
                    rate.is_inclusive,
                    currency,
                    effective,
                )?;
                if !rate.is_inclusive {
                    has_exclusive = true;
                }
                total_tax = match total_tax {
                    None => Some(tax),
                    Some(acc) => {
                        Some(acc.checked_add(tax).ok_or_else(|| CoreError::Validation {
                            field: "tax",
                            message: "cart tax overflow".into(),
                        })?)
                    }
                };
            }
        }

        let tax = total_tax.unwrap_or_else(|| Money::zero(currency));
        Ok(CartTaxResult {
            tax_minor: tax.minor_units,
            has_exclusive,
        })
    }

    /// Resolve all applicable tax rates for a SKU using the chain:
    /// product rates → category rates → default rate.
    ///
    /// Returns ALL rates at the first matching level (e.g. all product-
    /// level rates). Returns an empty vec when no rate is configured.
    ///
    /// `scope` is the location + business date being priced, and it changes two
    /// things — nothing else:
    ///
    /// * levels 1 and 2 drop any assigned rate whose own scope or validity
    ///   window does not cover this sale. An assignment is an instruction to USE
    ///   a rate, not a licence to ignore where that rate says it applies, so a
    ///   product pinned to a Jakarta-only rate falls through in Bali rather
    ///   than paying Jakarta tax;
    /// * level 3 asks [`Self::resolve_tax_rate_for_location`] — location row,
    ///   then entity row, then tenant-global — instead of the single
    ///   `is_default` row.
    ///
    /// `None` is the unscoped answer and is byte-for-byte the behaviour this
    /// function had before scoping: no filtering, `get_default_tax_rate` at
    /// level 3. That is what lets the sale path adopt the resolver without
    /// moving a single price for a tenant that has no scoped rows.
    pub fn resolve_best_tax_rates_for_sku(&self, sku: &str) -> Result<Vec<TaxRate>, CoreError> {
        self.resolve_best_tax_rates_for_sku_at(sku, None)
    }

    /// The scoped form. Separate name rather than a defaulted argument so a
    /// call site that passes no scope is visible in the diff.
    pub fn resolve_best_tax_rates_for_sku_at(
        &self,
        sku: &str,
        scope: Option<&TaxSaleScope>,
    ) -> Result<Vec<TaxRate>, CoreError> {
        // Resolved ONCE per call, and from the location row rather than from
        // whatever the caller asserts: level 2 must be the entity the branch
        // actually belongs to.
        let entity_owned: Option<String> = match scope {
            None => None,
            Some(s) => self.location_legal_entity(&s.location_id)?,
        };
        let entity_of_scope = entity_owned.as_deref();
        let applies = |id: &str| -> Result<bool, CoreError> {
            match scope {
                None => Ok(true),
                Some(sc) => self.tax_rate_applies_at(id, sc, entity_of_scope),
            }
        };

        // 1. Product-level tax rates — return ALL assigned rates.
        let product_rate_ids = self.get_product_tax_rates(sku)?;
        if !product_rate_ids.is_empty() {
            let mut rates = Vec::with_capacity(product_rate_ids.len());
            for id in &product_rate_ids {
                if !applies(id)? {
                    continue;
                }
                if let Some(rate) = self.get_tax_rate(id)? {
                    rates.push(rate);
                }
            }
            if !rates.is_empty() {
                return Ok(rates);
            }
        }

        // 2. Category-level tax rates (via product.category_id).
        let product_id = self.product_id_by_sku(sku)?;
        if let Some(pid) = product_id {
            let category_id: Option<String> = self
                .conn
                .query_row(
                    "SELECT category_id FROM products WHERE id = ?1",
                    params![pid],
                    |row| row.get(0),
                )
                .ok()
                .and_then(|v| v);

            if let Some(cid) = category_id {
                let cat_rate_ids = self.get_category_tax_rates(&cid)?;
                if !cat_rate_ids.is_empty() {
                    let mut rates = Vec::with_capacity(cat_rate_ids.len());
                    for id in &cat_rate_ids {
                        if !applies(id)? {
                            continue;
                        }
                        if let Some(rate) = self.get_tax_rate(id)? {
                            rates.push(rate);
                        }
                    }
                    if !rates.is_empty() {
                        return Ok(rates);
                    }
                }
            }
        }

        // 3. The fallback rate. Unscoped, this is the single store-wide
        // `is_default = 1` row, exactly as it has always been. Scoped, it is
        // the location → entity → tenant-global walk, so a location with its
        // own rate stops inheriting the default and a location without one
        // still gets the default answer.
        let fallback = match scope {
            Some(sc) => {
                self.resolve_tax_rate_for_location(&sc.location_id, entity_of_scope, &sc.as_of)?
            }
            None => self.get_default_tax_rate()?,
        };
        if let Some(rate) = fallback {
            return Ok(vec![rate]);
        }

        Ok(Vec::new())
    }
}
