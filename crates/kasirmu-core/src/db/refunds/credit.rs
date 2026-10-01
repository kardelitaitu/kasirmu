//! Stock crediting on refund: where a returned unit goes back to (ADR-19 §5.3).
//!
//! Split out of `db/refunds.rs` on 2026-09-28. A refund must put stock back where
//! it was DEDUCTED FROM, not wherever the line happens to be now, so these two
//! helpers read the sale line own `deduction_locations` record and credit it
//! FIFO; the fallback credits the canonical default location when a line carries
//! no deduction record at all.
//!
//! Invariant: the FIFO direction depends on whether the refund is FULL or
//! PARTIAL - a full refund walks deductions oldest-first, a partial refund walks
//! them in REVERSE (most recent first), crediting `min(entry.qty, remaining)`
//! until satisfied. Crediting the wrong end silently corrupts stock attribution.

use rusqlite::params;

use crate::db::Store;
use crate::error::CoreError;

use super::Refund;

impl Store<'_> {
    /// Credit stock back to original deduction sources per ADR-19 §5.3 FIFO.
    ///
    /// For each refund line:
    /// - Matches `sale_line_id` in the `deduction_locations` JSON.
    /// - If the refund qty equals or exceeds the original line qty (full
    ///   refund), iterates deductions forward — oldest deduction first.
    /// - If the refund qty is less than the original line qty (partial
    ///   refund), iterates deductions in REVERSE — most recent deduction
    ///   first — crediting `min(entry.qty, remaining)` until satisfied.
    pub(super) fn credit_refund_from_deduction_locations(
        &self,
        tx: &rusqlite::Transaction<'_>,
        refund: &Refund,
        deduction_locations_json: &str,
    ) -> Result<(), CoreError> {
        let v: serde_json::Value =
            serde_json::from_str(deduction_locations_json).map_err(|e| CoreError::Validation {
                field: "deduction_locations",
                message: e.to_string(),
            })?;

        let lines_array = v["lines"].as_array().ok_or_else(|| CoreError::Validation {
            field: "deduction_locations.lines",
            message: "expected an array".into(),
        })?;

        for refund_line in &refund.lines {
            // Find the matching line in deduction_locations by sale_line_id.
            let dl_line = lines_array
                .iter()
                .find(|l| l["sale_line_id"].as_str() == Some(&refund_line.sale_line_id))
                .ok_or_else(|| CoreError::Validation {
                    field: "deduction_locations",
                    message: format!(
                        "sale_line_id {} not found in deduction_locations",
                        refund_line.sale_line_id
                    ),
                })?;

            let deductions =
                dl_line["deductions"]
                    .as_array()
                    .ok_or_else(|| CoreError::Validation {
                        field: "deduction_locations.deductions",
                        message: "expected an array".into(),
                    })?;

            // Determine if this is a full or partial refund of the line.
            // Every entry must carry an integer qty. `filter_map(..).sum()`
            // silently DROPPED an entry it could not read, which UNDER-counts
            // this bound -- and a low bound is the dangerous direction: the
            // `credit_after > total_deducted` check below then lets more stock
            // through than was ever deducted, which is the exact over-credit the
            // COR-25 comment under this block says the sum exists to prevent.
            // The two other readers of this same JSON shape in this file already
            // refuse a bad qty (:147, :175); this one now matches them.
            let mut total_deducted: i64 = 0;
            for d in deductions {
                let qty = d["qty"].as_i64().ok_or_else(|| CoreError::Validation {
                    field: "deduction_locations.qty",
                    message: "deduction entry records no integer qty, so the ".to_string()
                        + "deductible bound cannot be computed",
                })?;
                total_deducted = total_deducted
                    .checked_add(qty)
                    .ok_or_else(|| CoreError::Validation {
                        field: "deduction_locations.qty",
                        message: "deducted quantity overflow".to_string(),
                    })?;
            }
            let refund_qty = refund_line.qty;

            if refund_qty <= 0 {
                continue;
            }

            // COR-25 shape for units: this bound is CUMULATIVE, so a
            // repeat refund of the same line only gets the units that are
            // still outstanding against what was deducted here. Without
            // the sum, two refunds that each fit inside total_deducted
            // credit more stock than the line ever sold.
            let already_credited = Self::refunded_qty_for_sale_line_in_tx(
                tx,
                &refund.sale_id,
                &refund_line.sale_line_id,
                &refund.id,
            )?;
            // checked_add, not +: a quantity near i64::MAX must be rejected,
            // not wrapped. A wrapping add underflows to a negative number in
            // release, the comparison passes, and stock is credited for a
            // quantity that never existed.
            let credit_after =
                already_credited
                    .checked_add(refund_qty)
                    .ok_or_else(|| CoreError::Validation {
                        field: "refund_line.qty",
                        message: "refund quantity overflow".into(),
                    })?;
            if credit_after > total_deducted {
                return Err(CoreError::Validation {
                    field: "refund_line.qty",
                    message: format!(
                        "refund qty {} exceeds remaining deductible qty {} for line {} ({} of {} already credited)",
                        refund_qty,
                        total_deducted - already_credited,
                        refund_line.sale_line_id,
                        already_credited,
                        total_deducted
                    ),
                });
            }

            // ── Credit stock per ADR-19 §5.3 FIFO ─────────────
            //
            // The recorded JSON names the product; a line that names none is a
            // REJECTION, not a licence to fall back to the caller's sku. Same
            // rule as the void path over this very json
            // (sales_lifecycle.rs:556-564, "missing sku in deduction_locations")
            // and the empty-recorded-sku identity rule in create_refund. The old
            // `unwrap_or(&refund_line.sku)` re-derived identity from caller
            // input: inert TODAY only because that guard pins refund_line.sku to
            // sale_lines.sku before this runs, and a mint the moment the guard is
            // reordered or a second caller appears. Credit must not depend on
            // check ordering.
            let sku = dl_line["sku"]
                .as_str()
                .filter(|s| !s.trim().is_empty())
                .ok_or_else(|| CoreError::Validation {
                    field: "deduction_locations.sku",
                    message: format!(
                        "deduction_locations for sale line {} records no sku, so its units cannot be credited to any product",
                        refund_line.sale_line_id
                    ),
                })?;
            let mut remaining = refund_qty;

            if refund_qty >= total_deducted {
                // Full refund: iterate forward (oldest deduction first).
                for d in deductions {
                    let loc_id =
                        d["location_id"]
                            .as_str()
                            .ok_or_else(|| CoreError::Validation {
                                field: "location_id",
                                message: "missing location_id in deductions".into(),
                            })?;
                    let qty = d["qty"].as_i64().ok_or_else(|| CoreError::Validation {
                        field: "qty",
                        message: "missing qty in deductions".into(),
                    })?;
                    self.adjust_stock_at_location_with_reason(
                        tx,
                        sku,
                        qty,
                        &crate::inventory::LocationId::from(loc_id),
                        Some("refund"),
                        None,
                        None,
                        None,
                    )?;
                }
            } else {
                // Partial refund: iterate REVERSE (most recent deduction first).
                for d in deductions.iter().rev() {
                    if remaining <= 0 {
                        break;
                    }
                    let loc_id =
                        d["location_id"]
                            .as_str()
                            .ok_or_else(|| CoreError::Validation {
                                field: "location_id",
                                message: "missing location_id in deductions".into(),
                            })?;
                    let entry_qty = d["qty"].as_i64().ok_or_else(|| CoreError::Validation {
                        field: "qty",
                        message: "missing qty in deductions".into(),
                    })?;
                    let credit = entry_qty.min(remaining);
                    self.adjust_stock_at_location_with_reason(
                        tx,
                        sku,
                        credit,
                        &crate::inventory::LocationId::from(loc_id),
                        Some("refund"),
                        None,
                        None,
                        None,
                    )?;
                    remaining -= credit;
                }
            }
        }

        Ok(())
    }

    /// Fallback for pre-093 legacy sales (NULL / empty / literal `null`
    /// `deduction_locations`): credit refund qty to the canonical default
    /// location and emit a warning audit log entry.
    ///
    /// Every unit credited here is bounded by the sold quantity of the line it
    /// names, CUMULATIVELY across prior refunds — this path has no
    /// deduction_locations to lean on, so without this bound an unknown or
    /// repeated line would mint stock. Lines naming a `sale_line_id` that is
    /// not one of the sale's are rejected by `create_refund`'s quantity guard
    /// and again here.
    pub(super) fn credit_refund_to_default_location(
        &self,
        tx: &rusqlite::Transaction<'_>,
        refund: &Refund,
    ) -> Result<(), CoreError> {
        let default_loc =
            crate::inventory::LocationId::from("01926b3a-0000-7000-8000-000000000001");

        for refund_line in &refund.lines {
            if refund_line.qty <= 0 {
                continue;
            }
            // BOUND THIS PATH TOO. A legacy / imported sale reaches here with
            // no deduction_locations, so the deducted-quantity bound on the
            // other path never runs; the units this loop credits are bounded
            // only by what sale_lines says the line sold, CUMULATIVELY across
            // every earlier refund of it, so repeated partial refunds cannot
            // each look plausible and together return more stock than was
            // sold. checked_add, not +: a near-i64::MAX quantity must be
            // rejected rather than wrapped negative past the comparison.
            let (sold_qty, _, recorded_sku) = Self::sold_line_for_sale_line_in_tx(
                tx,
                &refund.sale_id,
                &refund_line.sale_line_id,
            )?;
            let already_credited = Self::refunded_qty_for_sale_line_in_tx(
                tx,
                &refund.sale_id,
                &refund_line.sale_line_id,
                &refund.id,
            )?;
            let credit_after = already_credited
                .checked_add(refund_line.qty)
                .ok_or_else(|| CoreError::Validation {
                    field: "refund_line.qty",
                    message: "refund quantity overflow".into(),
                })?;
            if credit_after > sold_qty {
                return Err(CoreError::Validation {
                    field: "refund_line.qty",
                    message: format!(
                        "refund qty {} exceeds refundable quantity {} for line {} of sale {} ({} of {} units already credited)",
                        refund_line.qty,
                        sold_qty - already_credited,
                        refund_line.sale_line_id,
                        refund.sale_id,
                        already_credited,
                        sold_qty
                    ),
                });
            }
            // Credit the RECORDED sku, not the caller's copy of it - the same
            // property the deduction arm already has, where the sku comes from
            // the recorded JSON. create_refund's identity guard has proved the
            // two agree once trimmed, so this only stops a padded caller string
            // (" TEA3 ") from reaching the product lookup as its own id and
            // failing there with NotFound after the guard said it was fine.
            self.adjust_stock_at_location_with_reason(
                tx,
                &recorded_sku,
                refund_line.qty,
                &default_loc,
                Some("refund"),
                None,
                None,
                None,
            )?;
        }

        // Emit a warning audit entry for the legacy fallback. This targets
        // the refund (not the sale) so it does not shadow the primary
        // `sale.refund` audit entry written by `create_refund`.
        tx.execute(
            "INSERT INTO audit_log (id, user_id, action, target_type, target_id, details, outcome, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                uuid::Uuid::now_v7().to_string(),
                refund.processed_by,
                "sale.refund.legacy",
                "refund",
                &refund.id,
                serde_json::json!({
                    "refund_id": refund.id,
                    "note": "deduction_locations was NULL; credited to default location",
                }).to_string(),
                "warn",
                refund.created_at,
            ],
        )?;

        Ok(())
    }
}
