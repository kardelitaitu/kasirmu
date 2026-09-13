//! Refund CRUD — create, list, and query refunds.
/*
last audited 25-07-26 by RSA-Agent (oz-core slice B5 part 4: refunds deep read)
crate: oz-core | status: SAFE | lint: CLEAN
findings: refund stock restoration per ADR-19 §5.3 is well built (FIFO full / reverse partial crediting via deduction_locations JSON, qty<=deducted guard, legacy fallback with warn audit, audit row inside the same tx); COR-25 MEDIUM: FIXED 30-08-26 — the over-refund guard now runs inside the transaction and propagates cumulative-SUM read errors (was: outside the tx with .unwrap_or(0), fail-open on a money guard); COR-26 LOW: FIXED 30-08-26 — create_refund now rejects a refund currency that differs from the sale currency (was: sale_currency read then discarded, trusting callers)
next: none for the guard path | perf: N/A
*/
//!
//! ADR-19 §5.3: On refund, stock is credited back to the original deduction
//! source locations in FIFO order (oldest deduction first for full refunds;
//! reverse-chronological for partial refunds). The `deduction_locations` JSON
//! column on the `sales` table records the per-line, per-location breakdown.
//!
//! Two cumulative bounds run inside the refund transaction, both reading the
//! rows already persisted for the same sale: a MONEY bound (cumulative
//! refunded minor units may not exceed the sale total) and a QUANTITY bound
//! (cumulative refunded units per sale line may not exceed the units that
//! line sold). The money bound alone does not stop stock leakage — a partial
//! refund priced below the line's unit price can be repeated inside the sale
//! total while restoring more units than were ever deducted.

use std::collections::HashMap;

use rusqlite::{OptionalExtension, params};

use crate::error::CoreError;
use crate::money::Currency;
use crate::{Money, Refund, RefundLine};

use super::Store;

impl Store<'_> {
    /// Process a refund — persist refund + lines inside a transaction
    /// and restore stock to the original deduction sources.
    ///
    /// **Two cumulative bounds, both read and enforced inside this
    /// transaction** (the refund rows are written before the stock credit, so
    /// the reads must exclude the refund under construction):
    /// - MONEY — `SUM(refunds.total_minor)` for this sale and currency may not
    ///   exceed `sales.total_minor` (COR-25).
    /// - QUANTITY — `SUM(refund_lines.qty)` per sale line may not exceed the
    ///   quantity that line sold (`sale_lines.qty`), and a line's cumulative
    ///   credit may not exceed what it deducted. The money bound does not
    ///   imply this one: under-priced repeat refunds stay inside the money
    ///   bound while returning more units than were ever sold.
    ///   Both bounds fail CLOSED — a failed cumulative read aborts the refund.
    ///
    /// **Stock restoration (ADR-19 §5.3):**
    /// - Reads the sale's `deduction_locations` JSON column.
    /// - For each refund line, matches it to a sale line and credits stock
    ///   back to the original deduction locations.
    /// - Full refund of a line: iterates deductions forward (FIFO oldest first).
    /// - Partial refund of a line (qty < original line qty): iterates
    ///   deductions in REVERSE, crediting the most recently deducted location
    ///   first, stopping when the refund qty is satisfied.
    pub fn create_refund(&self, refund: &Refund) -> Result<(), CoreError> {
        let cur_str =
            std::str::from_utf8(&refund.total.currency.0).map_err(|e| CoreError::Validation {
                field: "currency",
                message: format!("invalid UTF-8 in currency bytes: {e}"),
            })?;

        // COR-25: the guard reads and the refund writes share one
        // transaction, so the check-then-act window is closed against any
        // other writer on another connection (e.g. sync replay).
        let tx = self.conn.unchecked_transaction()?;

        // ── 0. Over-refund guard ──────────────────────────────────
        // A sale may be refunded AT MOST its original total. The sale stays
        // 'completed' (nothing transitions it to 'refunded'), so without
        // this check the same sale could be refunded unlimited times and
        // stock credited each time. Reject when the cumulative refunded
        // amount plus this refund would exceed the sale's total.
        let (sale_total, sale_currency, sale_customer_id, sale_base_total): (
            i64,
            String,
            Option<String>,
            Option<i64>,
        ) = match tx.query_row(
            "SELECT total_minor, currency, customer_id, base_total_minor FROM sales WHERE id = ?1",
            params![refund.sale_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        ) {
            Ok(pair) => pair,
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                return Err(CoreError::NotFound {
                    entity: "sale",
                    id: refund.sale_id.clone(),
                });
            }
            Err(e) => return Err(CoreError::Db(e)),
        };
        // COR-26: the refund must be denominated in the sale's own currency.
        // The per-currency SUM below only bounds refunds that share the
        // sale's unit; a foreign-currency refund would compare minor units
        // against the wrong total (and could be repeated once per currency
        // to bypass the guard). Enforced here so no caller has to be
        // trusted to have folded with `Money::zero(sale.currency)`.
        if cur_str != sale_currency {
            return Err(CoreError::CurrencyMismatch(
                sale_currency,
                cur_str.to_owned(),
            ));
        }
        // COR-25: fail CLOSED — a failed cumulative read must abort the
        // refund, never be mistaken for "no refunds yet" via unwrap_or(0).
        let already_refunded: i64 = tx
            .query_row(
                "SELECT COALESCE(SUM(total_minor), 0) FROM refunds WHERE sale_id = ?1 AND currency = ?2",
                params![refund.sale_id, cur_str],
                |row| row.get(0),
            )
            .map_err(CoreError::Db)?;
        let after = already_refunded
            .checked_add(refund.total.minor_units)
            .ok_or_else(|| CoreError::Validation {
                field: "total",
                message: "refund total overflow".into(),
            })?;
        if after > sale_total {
            return Err(CoreError::Validation {
                field: "total",
                message: format!(
                    "refund total {} exceeds refundable balance {} for sale {} (already refunded {})",
                    refund.total.minor_units,
                    sale_total - already_refunded,
                    refund.sale_id,
                    already_refunded
                ),
            });
        }

        // ── 0b. Cumulative QUANTITY bound ─────────────────────
        // The money guard above bounds VALUE, never UNITS. A sale line that
        // sold N units can still be refunded over and over in units, as long
        // as each refund is priced low enough to keep the running money total
        // under the sale total — and every one of those refunds pushes stock
        // back into inventory. Reject when the units already refunded for a
        // sale line plus the units requested here exceed the quantity that
        // line sold. Same transaction as the writes below, so the
        // check-then-act window stays closed (the COR-25 shape for money),
        // and the cumulative read fails CLOSED like the money read above.
        //
        // Requested units are aggregated per sale_line_id first: one refund
        // carrying two lines for the same sale line counts as their sum, not
        // as two independent refunds. The bound applies to EVERY refund line,
        // on both credit paths, so it is enforced here before any row is
        // written rather than separately per path.
        let mut requested_qty: HashMap<&str, i64> = HashMap::new();
        let mut claimed_value: HashMap<&str, i64> = HashMap::new();
        let mut claimed_sku: HashMap<&str, &str> = HashMap::new();
        for line in &refund.lines {
            if line.qty > 0 {
                // Two lines naming the SAME sale line must not disagree about
                // which product it was - that would let one of them carry the
                // identity check while the other gets credited.
                if let Some(prior) = claimed_sku.get(line.sale_line_id.as_str()) {
                    if *prior != line.sku.as_str() {
                        return Err(CoreError::Validation {
                            field: "refund_line.sku",
                            message: format!(
                                "sale line {} is claimed as both {} and {} in one refund",
                                line.sale_line_id, prior, line.sku
                            ),
                        });
                    }
                } else {
                    claimed_sku.insert(line.sale_line_id.as_str(), line.sku.as_str());
                }
                *requested_qty.entry(&line.sale_line_id).or_insert(0) += line.qty;
                let claimed = claimed_value.entry(&line.sale_line_id).or_insert(0);
                *claimed = claimed
                    .checked_add(line.line_total.minor_units)
                    .ok_or_else(|| CoreError::Validation {
                        field: "refund_line.line_total",
                        message: "refund line total overflow".into(),
                    })?;
            }
        }
        for (sale_line_id, qty) in &requested_qty {
            // A row that does not exist is a rejection, not a licence.
            // refund_lines.sale_line_id carries NO foreign key (the column is
            // a logical ref only — see 20260813_init.sql), so a bogus id
            // inserts cleanly, and with no sale_lines row there is no sold
            // quantity to bound it against: the credit pass would mint units
            // out of nothing. Legacy and imported sales reach this path
            // because create_sale never writes deduction_locations, so the
            // deduction_locations bound below cannot be relied on to catch it.
            let (sold_qty, line_minor, recorded_sku) =
                self.sold_line_for_sale_line_in_tx(&tx, &refund.sale_id, sale_line_id)?;

            // ── IDENTITY: the claimed sku must BE the sku that line sold ───
            // Both bounds above are measured against the named line, so they
            // are only as good as that line's identity: refund TEA's line
            // claiming GOLD and the quantity ceiling becomes "units of any
            // product" and GOLD is minted at the default location. The
            // deduction_locations arm cannot be spoofed this way (it takes the
            // sku from the recorded JSON, falling back to the caller only when
            // the JSON omits it); the default-location arm credits
            // refund_line.sku directly, which is where the mint lives.
            //
            // Rule, decided once: compare TRIMMED, CASE-SENSITIVE equality -
            // the same normalisation the domain type itself applies
            // (Sku::new trims and requires non-empty, foundation/src/sku.rs
            // :34-38; it does NOT case-fold, so neither does this). No
            // case-insensitive match: 'gold' is not 'GOLD' anywhere else in
            // this path either.
            //
            // Empty or whitespace-only recorded sku (possible in legacy and
            // imported rows; sale_lines.sku is NOT NULL so NULL is not):
            // REFUSE. Falling back to the caller's sku would reopen exactly
            // the mint this check exists to close, and a line that records no
            // product cannot have a unit of any product returned against it.
            // That turns a previously-working refund on a corrupt row into a
            // visible rejection, which is the intended trade: the row is the
            // defect, not the refund.
            let claimed = claimed_sku[sale_line_id];
            if recorded_sku.trim().is_empty() {
                return Err(CoreError::Validation {
                    field: "refund_line.sku",
                    message: format!(
                        "sale line {} of sale {} records no sku, so no refund line can be identified against it",
                        sale_line_id, refund.sale_id
                    ),
                });
            }
            if claimed.trim() != recorded_sku.trim() {
                return Err(CoreError::Validation {
                    field: "refund_line.sku",
                    message: format!(
                        "refund line {} claims sku {} but sale line {} of sale {} sold {}",
                        sale_line_id, claimed, sale_line_id, refund.sale_id, recorded_sku
                    ),
                });
            }
            let already_refunded_qty = self.refunded_qty_for_sale_line_in_tx(
                &tx,
                &refund.sale_id,
                sale_line_id,
                &refund.id,
            )?;
            let after_qty =
                already_refunded_qty
                    .checked_add(*qty)
                    .ok_or_else(|| CoreError::Validation {
                        field: "refund_line.qty",
                        message: "refund quantity overflow".into(),
                    })?;
            if after_qty > sold_qty {
                return Err(CoreError::Validation {
                    field: "refund_line.qty",
                    message: format!(
                        "refund qty {} exceeds refundable quantity {} for line {} of sale {} (already refunded {} of {} units sold)",
                        qty,
                        sold_qty - already_refunded_qty,
                        sale_line_id,
                        refund.sale_id,
                        already_refunded_qty,
                        sold_qty
                    ),
                });
            }

            // ── per-line MONEY ceiling ─────────────────────────────
            // line_total_minor is the last caller-supplied money figure in
            // this path: it used to be persisted verbatim. The line is now
            // GUARANTEED to exist (the lookup above refuses it otherwise), so
            // the server can always derive what that line can refund and
            // refuse anything above it.
            //
            // A RANGE, not an equality, for two verified reasons. (a) A price
            // override legitimately stores line_minor != unit_minor * qty:
            // CartLine::total uses the overridden price (foundation/cart.rs
            // :54-57, :94-106) while the model keeps unit_price as the BASE
            // and line_total as the OVERRIDE (modules/sales/src/models.rs
            // :181-188) - equality would reject refunds on lines the server
            // itself sold at a changed price. (b) The UI rounds: RefundModal
            // derives unitPriceMinor = round(total_minor / qty) and multiplies
            // back (:71-84) while its on-screen estimate uses the fractional
            // form (:59-62, :240), so the two already disagree by up to half
            // of sold_qty minor units whenever line_minor is not divisible.
            // The one-minor-unit tolerance absorbs that; an equality would not.
            //
            // Discounts never touch per-line figures, so this ceiling may sit
            // ABOVE what the customer actually paid for the line: cart percent
            // and fixed discounts apply to the summed total only
            // (foundation/cart.rs:284-296), promotions subtract at sale level
            // and promotion_applications carries no sale_line_id
            // (20260813_init.sql:459-466), loyalty is sale-level
            // (db/loyalty.rs:447-459), and tax-inclusive vs exclusive adds to
            // sale.total (db/sales_tax.rs:273-290). The SALE-LEVEL ceiling
            // above - SUM(refunds.total_minor) bounded by sales.total_minor -
            // is what absorbs all of them. A per-line figure at or under its
            // pro-rata share is therefore intended to pass even when the
            // customer paid less for that line; that is not a hole.
            //
            // Booked value: refuse above the ceiling, store the supplied
            // figure UNCHANGED below it. Clamping to min(supplied, ceiling)
            // would silently rewrite a receipt. This also leaves every
            // downstream number alone: loyalty reversal, customer
            // lifetime-spend reversal, is_full_refund KDS cancellation, shift
            // cash reconciliation (db/shifts.rs:158, :170) and report netting
            // (db/reports.rs:467, :534) all read refunds.total_minor, never
            // refund_lines.line_minor - which only list_refunds_for_sale and
            // the printed line consume.
            //
            // Joining a pattern, not inventing one: create_purchase_order
            // takes no total at all and re-derives it in the insert loop under
            // MONEY-05 (db/purchase_orders.rs:198-214); MONEY-01 recomputes
            // the IPC line total with checked_mul (db/sales_tax.rs:352-362);
            // F2-5 has the client supply only a boolean claim
            // (db/sales_checkout.rs:464-477). It is NOT the case that this
            // codebase always recomputes - hold_cart (oz-bridge/src/pos.rs
            // :621-630) and base_total_minor (:1446) still trust caller money.
            let claimed = claimed_value[sale_line_id];
            let numerator = i128::from(line_minor)
                .checked_mul(i128::from(*qty))
                .ok_or_else(|| CoreError::Validation {
                    field: "refund_line.line_total",
                    message: "refund line total overflow".into(),
                })?;
            // sale_lines.qty has CHECK (qty > 0); max(1) keeps this division
            // infallible without relying on the constraint, and i128 keeps it
            // exact - no float anywhere on money.
            let ratio = numerator / i128::from(sold_qty).max(1);
            let ceiling = ratio.max(0) + 1;
            if i128::from(claimed) > ceiling {
                return Err(CoreError::Validation {
                    field: "refund_line.line_total",
                    message: format!(
                        "refund line total {} exceeds the {} minor units refundable for line {} of sale {} (line booked {}, {} units sold, {} refunded)",
                        claimed, ceiling, sale_line_id, refund.sale_id, line_minor, sold_qty, qty
                    ),
                });
            }
        }

        // ── 1. Persist refund + lines ──────────────────────────────
        tx.execute(
            "INSERT INTO refunds (id, sale_id, total_minor, currency, reason, note, processed_by, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![refund.id, refund.sale_id, refund.total.minor_units, cur_str, refund.reason, refund.note, refund.processed_by, refund.created_at],
        )?;

        for line in &refund.lines {
            let line_cur = std::str::from_utf8(&line.unit_price.currency.0).map_err(|e| {
                CoreError::Validation {
                    field: "currency",
                    message: format!("invalid UTF-8 in currency bytes: {e}"),
                }
            })?;
            tx.execute(
                "INSERT INTO refund_lines (id, refund_id, sale_line_id, sku, qty, unit_minor, line_minor, currency, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![line.id, line.refund_id, line.sale_line_id, line.sku, line.qty,
                        line.unit_price.minor_units, line.line_total.minor_units, line_cur, line.created_at],
            )?;
        }

        // ── 2. Read deduction_locations from the sale ──────────────
        let deduction_locations_json: Option<String> = match tx.query_row(
            "SELECT deduction_locations FROM sales WHERE id = ?1",
            params![refund.sale_id],
            |row| row.get(0),
        ) {
            Ok(j) => j,
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                return Err(CoreError::NotFound {
                    entity: "sale",
                    id: refund.sale_id.clone(),
                });
            }
            Err(e) => return Err(CoreError::Db(e)),
        };

        // If deduction_locations is NULL (pre-093 legacy sale), fall
        // back to crediting the canonical default location.
        match deduction_locations_json.as_deref() {
            None | Some("null") | Some("") => {
                self.credit_refund_to_default_location(&tx, refund)?;
            }
            Some(locations) => {
                self.credit_refund_from_deduction_locations(&tx, refund, locations)?;
            }
        }

        // ── 2b. LOY-03: reverse the loyalty award proportionally ───
        // Same transaction as the refund rows; a loyalty bug must not
        // block the refund itself (same non-fatal policy as the award
        // hook in finalize_sale), so failures are logged, not raised.
        if let Err(e) = crate::db::loyalty::reverse_loyalty_on_refund(
            &tx,
            &refund.sale_id,
            &refund.id,
            refund.total.minor_units,
            sale_total,
        ) {
            tracing::warn!(
                "loyalty refund reversal failed for sale {} (refund {}): {e}",
                refund.sale_id,
                refund.id
            );
        }

        // ── 2c. CRM-06: reverse lifetime spend (base currency) ────
        // The completion hook accrues spend in base currency; the refund
        // converts its amount at the rate recorded on the sale
        // (refund_base = refund_total × base_total / total, integer
        // round-half-up — no floats on money). Floors at zero: legacy
        // customers accrued nothing during the projection-gap window.
        if let Some(customer_id) = sale_customer_id.as_deref() {
            let refund_base = match (sale_base_total, sale_total) {
                (Some(base), t) if t > 0 && base != t => {
                    let num = i128::from(refund.total.minor_units) * i128::from(base);
                    let den = i128::from(t);
                    ((num * 2 + den) / (den * 2)) as i64
                }
                _ => refund.total.minor_units,
            };
            if let Err(e) = tx.execute(
                "UPDATE customers SET total_spent_minor = MAX(total_spent_minor - ?1, 0),
                 updated_at = ?2 WHERE id = ?3",
                params![refund_base, refund.created_at, customer_id],
            ) {
                tracing::warn!(
                    "customer spend reversal failed for sale {} (refund {}): {e}",
                    refund.sale_id,
                    refund.id
                );
            }
        }

        // ── 3. Write audit log inside the same transaction ─────────
        tx.execute(
            "INSERT INTO audit_log (id, user_id, action, target_type, target_id, details, outcome, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                uuid::Uuid::now_v7().to_string(),
                refund.processed_by,
                "sale.refund",
                "sale",
                refund.sale_id,
                serde_json::json!({
                    "refund_id": refund.id,
                    "reason": refund.reason,
                    "total_minor": refund.total.minor_units,
                    "currency": cur_str,
                    "line_count": refund.lines.len(),
                }).to_string(),
                "success",
                refund.created_at,
            ],
        )?;

        // ── 4. S3: cancel KDS tickets on full refund ────────────────
        // Only a FULL refund pulls the kitchen's tickets — the food is
        // coming back entirely. Partial refunds keep the board as-is (the
        // kitchen is still cooking the remainder). Inside the same
        // transaction as the refund rows.
        let is_full_refund = already_refunded + refund.total.minor_units >= sale_total;
        if is_full_refund {
            self.cancel_kds_orders_for_sale_in_tx(&tx, &refund.sale_id)?;
        }

        tx.commit()?;
        Ok(())
    }

    /// The quantity a sale line sold, looked up inside the caller's
    /// transaction, or a rejection when it is not one of this sale's lines.
    ///
    /// Deliberately offers no "absent" escape hatch:
    /// refund_lines.sale_line_id carries no foreign key (the column is a
    /// logical ref only), so an unknown id inserts cleanly and would otherwise
    /// reach the credit path unbounded. Scope is enforced by "AND sale_id",
    /// so a line id belonging to a DIFFERENT sale cannot borrow that sale's
    /// sold quantity either.
    ///
    /// Returns (units sold, booked line total in minor units, sold sku) from
    /// ONE read: the quantity bound needs the first, the per-line money
    /// ceiling needs the second, and the identity check needs the third. All
    /// three from the same row, so no bound can be measured against a
    /// different snapshot of it than the one the others saw.
    fn sold_line_for_sale_line_in_tx(
        &self,
        tx: &rusqlite::Transaction<'_>,
        sale_id: &str,
        sale_line_id: &str,
    ) -> Result<(i64, i64, String), CoreError> {
        tx.query_row(
            "SELECT qty, line_minor, sku FROM sale_lines WHERE id = ?1 AND sale_id = ?2",
            params![sale_line_id, sale_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(CoreError::Db)?
        .ok_or_else(|| CoreError::Validation {
            field: "refund_line.sale_line_id",
            message: format!(
                "sale_line_id {} is not a line of sale {}; refusing to credit stock or value against an unknown line",
                sale_line_id, sale_id
            ),
        })
    }

    /// Cumulative units already refunded for one sale line, across every
    /// prior refund of that sale, read inside the caller's transaction.
    ///
    /// Joined through refunds.sale_id rather than filtered on refund_lines
    /// alone, so the sum cannot pick up an identically-named line belonging to
    /// a different sale. Non-positive quantities contribute nothing (the
    /// refund_lines CHECK rejects them anyway).
    ///
    /// A read failure is returned, never swallowed into a zero: the caller
    /// aborts the refund, matching the fail-closed money guard (COR-25).
    ///
    /// `exclude_refund_id` drops the refund under construction from the sum.
    /// `create_refund` inserts the refund rows BEFORE it restores stock, so a
    /// bound read inside the credit path would otherwise count this refund's
    /// own units twice; passing the id keeps both reads meaning the same thing
    /// — units refunded by EARLIER refunds.
    fn refunded_qty_for_sale_line_in_tx(
        &self,
        tx: &rusqlite::Transaction<'_>,
        sale_id: &str,
        sale_line_id: &str,
        exclude_refund_id: &str,
    ) -> Result<i64, CoreError> {
        tx.query_row(
            "SELECT COALESCE(SUM(rl.qty), 0)
             FROM refund_lines rl
             JOIN refunds r ON r.id = rl.refund_id
             WHERE r.sale_id = ?1 AND rl.sale_line_id = ?2 AND rl.qty > 0
               AND r.id <> ?3",
            params![sale_id, sale_line_id, exclude_refund_id],
            |row| row.get(0),
        )
        .map_err(CoreError::Db)
    }

    /// Credit stock back to original deduction sources per ADR-19 §5.3 FIFO.
    ///
    /// For each refund line:
    /// - Matches `sale_line_id` in the `deduction_locations` JSON.
    /// - If the refund qty equals or exceeds the original line qty (full
    ///   refund), iterates deductions forward — oldest deduction first.
    /// - If the refund qty is less than the original line qty (partial
    ///   refund), iterates deductions in REVERSE — most recent deduction
    ///   first — crediting `min(entry.qty, remaining)` until satisfied.
    fn credit_refund_from_deduction_locations(
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
            let total_deducted: i64 = deductions.iter().filter_map(|d| d["qty"].as_i64()).sum();
            let refund_qty = refund_line.qty;

            if refund_qty <= 0 {
                continue;
            }

            // COR-25 shape for units: this bound is CUMULATIVE, so a
            // repeat refund of the same line only gets the units that are
            // still outstanding against what was deducted here. Without
            // the sum, two refunds that each fit inside total_deducted
            // credit more stock than the line ever sold.
            let already_credited = self.refunded_qty_for_sale_line_in_tx(
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
    fn credit_refund_to_default_location(
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
            let (sold_qty, _, recorded_sku) =
                self.sold_line_for_sale_line_in_tx(tx, &refund.sale_id, &refund_line.sale_line_id)?;
            let already_credited = self.refunded_qty_for_sale_line_in_tx(
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

    /// List all refunds for a given sale.
    pub fn list_refunds_for_sale(&self, sale_id: &str) -> Result<Vec<Refund>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, sale_id, total_minor, currency, reason, note, processed_by, created_at
             FROM refunds WHERE sale_id = ?1 ORDER BY created_at ASC",
        )?;
        let refunds: Vec<Refund> = stmt
            .query_map(params![sale_id], |row| {
                let cur_str: String = row.get("currency")?;
                Ok(Refund {
                    id: row.get("id")?,
                    sale_id: row.get("sale_id")?,
                    total: Money {
                        minor_units: row.get("total_minor")?,
                        currency: cur_str.parse::<Currency>().map_err(|e| {
                            rusqlite::Error::ToSqlConversionFailure(
                                std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string())
                                    .into(),
                            )
                        })?,
                    },
                    reason: row.get("reason")?,
                    note: row.get("note")?,
                    processed_by: row.get("processed_by")?,
                    created_at: row.get("created_at")?,
                    lines: Vec::new(),
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let mut line_stmt = self.conn.prepare(
            "SELECT id, refund_id, sale_line_id, sku, qty, unit_minor, line_minor, currency, created_at
             FROM refund_lines WHERE refund_id = ?1 ORDER BY created_at ASC"
        )?;
        let mut result: Vec<Refund> = Vec::new();
        for mut r in refunds {
            let lines: Vec<RefundLine> = line_stmt
                .query_map(params![r.id], Self::row_to_refund_line)?
                .collect::<Result<Vec<_>, _>>()?;
            r.lines = lines;
            result.push(r);
        }

        Ok(result)
    }

    /// Get total refunded amount for a sale.
    ///
    /// Returns `Money::zero` in the sale's currency when the sale genuinely has
    /// no refunds — and an `Err` when the read itself failed. That distinction
    /// is the whole point of this method: a locked row, a disk fault or an
    /// interrupted write used to be swallowed into `Ok(0)` by an
    /// `.unwrap_or(0)`, which reads exactly like "nothing refunded yet". The
    /// in-tx over-refund guard in [`Store::create_refund`] had the same shape
    /// and was converted (COR-25, see the note at the head of this file); this
    /// public read was the last one left. Zero is zero, an error is an error.
    ///
    /// Only refunds in the SALE's currency are summed — a cross-currency refund
    /// line would not be comparable and is excluded from the balance.
    ///
    /// How load-bearing this is today: it has NO production caller (verified
    /// repo-wide — the only hits are this definition and tests), so nothing
    /// bounds a refund on it and the conversion is hygiene, not a live money
    /// bug. Fixed anyway because it is the exact shape a future balance check
    /// would be handed, and the doc used to assert that callers already used it
    /// as one.
    pub fn total_refunded_for_sale(&self, sale_id: &str) -> Result<Money, CoreError> {
        let row = self.conn.query_row(
            "SELECT total_minor, currency FROM sales WHERE id = ?1",
            params![sale_id],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
        );
        let (sale_total_unused, sale_currency_str) = match row {
            Ok(pair) => pair,
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                return Err(CoreError::NotFound {
                    entity: "sale",
                    id: sale_id.to_owned(),
                });
            }
            Err(e) => return Err(CoreError::Db(e)),
        };
        let _ = sale_total_unused;
        let sale_currency: Currency =
            sale_currency_str
                .parse()
                .map_err(|e| CoreError::Validation {
                    field: "currency",
                    message: format!("invalid sale currency: {e}"),
                })?;
        let total: i64 = self
            .conn
            .query_row(
                "SELECT COALESCE(SUM(total_minor), 0) FROM refunds WHERE sale_id = ?1 AND currency = ?2",
                params![sale_id, sale_currency_str],
                |row| row.get(0),
            )
            // Propagate, do not default: the `COALESCE(SUM(...), 0)` above
            // already gives the honest zero for "no refund rows". Anything this
            // query ERRORS on is a real failure, and turning that into 0 makes a
            // fault indistinguishable from an un-refunded sale.
            .map_err(CoreError::Db)?;
        Ok(Money {
            minor_units: total,
            currency: sale_currency,
        })
    }

    fn row_to_refund_line(row: &rusqlite::Row) -> rusqlite::Result<RefundLine> {
        let cur_str: String = row.get("currency")?;
        let currency: Currency = cur_str.parse::<Currency>().map_err(|e| {
            rusqlite::Error::ToSqlConversionFailure(
                std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()).into(),
            )
        })?;
        Ok(RefundLine {
            id: row.get("id")?,
            refund_id: row.get("refund_id")?,
            sale_line_id: row.get("sale_line_id")?,
            sku: row.get("sku")?,
            qty: row.get("qty")?,
            unit_price: Money {
                minor_units: row.get("unit_minor")?,
                currency,
            },
            line_total: Money {
                minor_units: row.get("line_minor")?,
                currency,
            },
            created_at: row.get("created_at")?,
        })
    }
}

// ── Tests ─────────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "refunds_tests.rs"]
mod tests;
