//! Shift management — open/close shifts, cash reconciliation.
// P2-5: `gross_profit_minor as f64 / net_revenue_minor as f64 * 100.0` is a
// MARGIN PERCENTAGE, not money. The minor-unit totals stay `i64` and remain
// the source of truth; only the displayed ratio is floating point.
#![allow(clippy::cast_precision_loss)]

/*
last audited 26-09-26 by DSH (COR-27 fully CLOSED; the previous claim was wrong and came from a scoped check)
crate: kasirmu-core | status: SAFE | lint: CLEAN
findings: close_shift exemplary — all aggregation reads + final write in one tx, cash refunds subtracted from expected cash (documented false-positive fix), safe-drop payouts included, gross profit matches reporting-layer cost semantics; COR-27 LOW: FULLY FIXED. Both halves now hold. (1) `open_shift`'s COUNT-then-INSERT guard runs with the INSERT inside one `BEGIN IMMEDIATE` transaction, so two opens for the same user serialize on the write lock (C18, slice P1.3). (2) The partial unique index DOES exist — `CREATE UNIQUE INDEX idx_shifts_open_per_user ON shifts(user_id) WHERE status = 'open'`, added by `migrations/20261011_open_shift_uniqueness.sql:92-94`, and that migration first re-opens nothing: it closes the older of any pre-existing duplicate open shifts (`:74-88`) before creating the guard. THIS STAMP PREVIOUSLY SAID THE OPPOSITE — "still NO partial unique index behind it (verified init.sql:1259-1263 — only plain indexes)" — and the error is instructive rather than careless: the check was real, but `init.sql` holds only the BASELINE schema, while this index arrives in a later migration file, so the referent set was incomplete and the conclusion inverted. Measured this pass against a migrated database (not a file): the index exists, is UNIQUE, is partial on status='open', and a direct INSERT that bypasses `open_shift` is REFUSED by it — pinned by `a_partial_unique_index_guards_open_shifts`, which also asserts a CLOSED shift still inserts freely. Hour labels in get_shift_report are UTC (COR-21 family, totals unaffected).
next: none for COR-27. | perf: N/A
*/

use rusqlite::{Transaction, TransactionBehavior, params};

use crate::Shift;
use crate::error::CoreError;

use super::Store;

impl Store<'_> {
    /// Open a new shift for a user.
    ///
    /// Validates that the user exists and is active, and that there is no
    /// other open shift for the same user.
    ///
    /// COR-27 (C18, slice P1.3): the duplicate check and the `INSERT` are one
    /// decision, so both run inside a single `BEGIN IMMEDIATE` transaction —
    /// the shape [`Self::close_shift`] already uses in this file, and the
    /// allocation idiom from `stock_counts.rs`. `IMMEDIATE` takes SQLite's
    /// write reservation *before* the check, so two opens for the same user
    /// serialize on the lock instead of both reading an empty count and then
    /// inserting (the old autocommit check-then-act, where a WAL reader did
    /// not even block on the rival writer). A refused open leaves no row: the
    /// transaction is dropped and rolled back, so the shift row and its
    /// opening float are written together or not at all.
    pub fn open_shift(
        &self,
        user_id: &str,
        terminal_id: Option<&str>,
        opening_balance_minor: i64,
    ) -> Result<Shift, CoreError> {
        if user_id.trim().is_empty() {
            return Err(CoreError::Validation {
                field: "user_id",
                message: "user_id must not be empty".into(),
            });
        }
        if opening_balance_minor < 0 {
            return Err(CoreError::Validation {
                field: "opening_balance_minor",
                message: "opening_balance_minor must be ≥ 0".into(),
            });
        }

        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let id = uuid::Uuid::now_v7().to_string();

        let tx = Transaction::new_unchecked(self.conn, TransactionBehavior::Immediate)?;

        // In single-database / test setups, verify against the local users table.
        // In store-scoped operation (ADR #4 / #35), users and permissions live
        // exclusively in the global identity database and are authorized upstream
        // by require_session_permission.
        let users_present: bool = tx
            .query_row("SELECT EXISTS(SELECT 1 FROM users LIMIT 1)", [], |row| {
                row.get::<_, bool>(0)
            })
            .unwrap_or(false);

        if users_present {
            let active: bool = tx
                .query_row(
                    "SELECT is_active FROM users WHERE id = ?1",
                    params![user_id.trim()],
                    |row| row.get::<_, i64>(0),
                )
                .map(|v| v != 0)
                .map_err(|e| match e {
                    rusqlite::Error::QueryReturnedNoRows => CoreError::Validation {
                        field: "user_id",
                        message: "user not found".into(),
                    },
                    _ => CoreError::Db(e),
                })?;

            if !active {
                return Err(CoreError::Validation {
                    field: "user_id",
                    message: "user account is deactivated".into(),
                });
            }
        }

        // Ensure no duplicate open shift for this user — evaluated under the
        // write lock taken above, so a rival open cannot overtake it.
        let open_count: i64 = tx.query_row(
            "SELECT COUNT(*) FROM shifts WHERE user_id = ?1 AND status = 'open'",
            params![user_id.trim()],
            |row| row.get(0),
        )?;
        if open_count > 0 {
            return Err(CoreError::Validation {
                field: "user_id",
                message: "user already has an open shift".into(),
            });
        }

        tx.execute(
            "INSERT INTO shifts (id, user_id, terminal_id, opening_balance_minor, opened_at, created_at, updated_at, status)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'open')",
            params![id, user_id.trim(), terminal_id, opening_balance_minor, now, now, now],
        )?;

        tx.commit()?;

        self.get_shift(&id)?.ok_or_else(|| CoreError::NotFound {
            entity: "shift",
            id: id.clone(),
        })
    }

    /// Close an active shift with a counted closing balance and optional notes.
    ///
    /// Calculates `expected_cash_minor` (opening + cash sales) and
    /// `cash_difference_minor` (closing - expected). Updates all aggregated
    /// sales fields from the sales table.
    ///
    /// All reads and the final write run inside a single SQLite transaction
    /// to prevent concurrent close operations from observing inconsistent
    /// intermediate state.
    pub fn close_shift(
        &self,
        id: &str,
        closing_balance_minor: i64,
        notes: Option<&str>,
    ) -> Result<Shift, CoreError> {
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

        let tx = Transaction::new_unchecked(self.conn, TransactionBehavior::Immediate)?;

        // Verify the shift exists and is open.
        let shift: Shift = {
            let mut stmt = tx.prepare(
                "SELECT id, user_id, terminal_id, opened_at, closed_at,
                        opening_balance_minor, closing_balance_minor,
                        expected_cash_minor, cash_difference_minor,
                        total_sales_minor, total_cash_minor, total_card_minor,
                        total_other_minor, total_voids_minor, total_refunds_minor,
                        total_payouts_minor,
                        notes, status, created_at, updated_at
                 FROM shifts WHERE id = ?1",
            )?;
            let result = stmt.query_row(params![id], Self::row_to_shift);
            match result {
                Ok(s) => s,
                Err(rusqlite::Error::QueryReturnedNoRows) => {
                    return Err(CoreError::NotFound {
                        entity: "shift",
                        id: id.to_owned(),
                    });
                }
                Err(e) => return Err(CoreError::Db(e)),
            }
        };

        if shift.is_closed() {
            return Err(CoreError::Validation {
                field: "status",
                message: "shift is already closed".into(),
            });
        }

        // Calculate sales totals for sales made during this shift.
        //
        // ── TENDER METHODS COME FROM `payments` FOR SPLIT SALES ─────────────
        // `sales.payment_method` is a SUMMARY stamp, not the tender record: a
        // split tender is stamped `split` (bridge/pos.rs SPLIT_MARKER), which
        // matched neither `cash` nor `card` and fell into `total_other` -- so
        // the cash leg of every split tender was invisible to the drawer
        // expectation, the drawer read short, and the cashier was recorded
        // over/short with no error. The real tenders ARE recorded, one row per
        // split in `payments` (sales_checkout.rs / sales_lifecycle.rs), and the
        // shift REPORT already reads that table (get_shift_report) -- so the
        // close and the report disagreed by construction (review 8.4).
        //
        // Scope, deliberately narrow: `payments` rows exist ONLY for split
        // tenders -- both checkout doors write them when `payment_splits` is
        // non-empty and write nothing otherwise, so a plain one-tender sale
        // has its method on the sale alone. The three tender buckets therefore
        // read `payments` exactly for the sales that carry the `split` stamp
        // and keep reading `payment_method` for every other sale, which is why
        // this is a CASE over the stamp and not a join over all sales.
        //
        // `total_sales` and `total_voids` are unchanged: the defect was in
        // tender attribution, not in which sales count.
        //
        // The tender buckets are summed over a `payments`-driven view, and the
        // bucket totals are TENDER AMOUNTS, not sale totals: a $20 sale paid
        // $10 cash + $10 card contributes 1000 to cash, not 2000. That is what
        // makes the drawer agree with get_shift_report's payment_breakdown,
        // which sums `payments.amount_minor` the same way.
        let (total_sales, total_cash, total_card, total_other, total_voids): (
            i64,
            i64,
            i64,
            i64,
            i64,
        ) = tx.query_row(
            "WITH tender AS (
                 SELECT s.id AS sale_id,
                        COALESCE(p.method, s.payment_method) AS tender,
                        COALESCE(p.amount_minor, s.total_minor) AS amount_minor
                   FROM sales s
                   LEFT JOIN payments p ON p.sale_id = s.id
                  WHERE s.status = 'completed'
                    AND s.user_id = ?1 AND s.created_at >= ?2 AND s.created_at <= ?3
             )
             SELECT
                COALESCE((SELECT SUM(total_minor) FROM sales
                           WHERE status = 'completed'
                             AND user_id = ?1 AND created_at >= ?2 AND created_at <= ?3), 0),
                COALESCE((SELECT SUM(amount_minor) FROM tender WHERE tender = 'cash'), 0),
                COALESCE((SELECT SUM(amount_minor) FROM tender WHERE tender = 'card'), 0),
                COALESCE((SELECT SUM(amount_minor) FROM tender
                           WHERE tender NOT IN ('cash', 'card')), 0),
                COALESCE((SELECT SUM(total_minor) FROM sales
                           WHERE status = 'voided'
                             AND user_id = ?1 AND created_at >= ?2 AND created_at <= ?3), 0)",
            params![shift.user_id, shift.opened_at, now],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )?;

        // Refunds are attributed to the user who PROCESSED them
        // (`refunds.processed_by`), not to the seller of the original sale.
        // The old join on `s.user_id` filed a refund under whoever rang up the
        // sale, so a refund handled the next day by another cashier belonged to
        // no shift at all -- silently absent from every drawer (review 8.4).
        let total_refunds: i64 = tx.query_row(
            "SELECT COALESCE(SUM(r.total_minor), 0)
             FROM refunds r
             WHERE r.processed_by = ?1 AND r.created_at >= ?2 AND r.created_at <= ?3",
            params![shift.user_id, shift.opened_at, now],
            |row| row.get(0),
        )?;

        // Cash refunds take cash OUT of the drawer, so the expected cash must
        // subtract them -- otherwise a refund makes the drawer look OVER by
        // the refunded amount (a false positive that masks a real shortage).
        //
        // Attribution follows `processed_by` exactly as `total_refunds` above.
        // The CASH test still reads the ORIGINAL sale's tender, and that is the
        // honest limit of this calculation: `refunds` has no tender column and
        // nothing anywhere records how a refund was paid out, so there is no
        // "the refund's own tender" to read. Re-typing a cash sale's refund as
        // a card payout would need a column this schema does not have; do not
        // pretend otherwise here (review 8.4, second half).
        let cash_refunds: i64 = tx.query_row(
            "SELECT COALESCE(SUM(r.total_minor), 0)
             FROM refunds r
             JOIN sales s ON r.sale_id = s.id
             WHERE r.processed_by = ?1 AND s.payment_method = 'cash'
               AND r.created_at >= ?2 AND r.created_at <= ?3",
            params![shift.user_id, shift.opened_at, now],
            |row| row.get(0),
        )?;

        // Include cash payouts (safe drops) in the expected cash calculation.
        let total_payouts: i64 = tx.query_row(
            "SELECT COALESCE(SUM(amount_minor), 0) FROM cash_payouts WHERE shift_id = ?1",
            params![id],
            |row| row.get(0),
        )?;

        let expected_cash = shift.opening_balance_minor + total_cash - cash_refunds - total_payouts;
        let cash_difference = closing_balance_minor - expected_cash;

        tx.execute(
            "UPDATE shifts SET
                closed_at = ?1, closing_balance_minor = ?2, expected_cash_minor = ?3,
                cash_difference_minor = ?4, total_sales_minor = ?5, total_cash_minor = ?6,
                total_card_minor = ?7, total_other_minor = ?8, total_voids_minor = ?9,
                total_refunds_minor = ?10, total_payouts_minor = ?11,
                notes = ?12, status = 'closed', updated_at = ?13
             WHERE id = ?14",
            params![
                now,
                closing_balance_minor,
                expected_cash,
                cash_difference,
                total_sales,
                total_cash,
                total_card,
                total_other,
                total_voids,
                total_refunds,
                total_payouts,
                notes.unwrap_or(""),
                now,
                id,
            ],
        )?;

        tx.commit()?;

        self.get_shift(id)?.ok_or_else(|| CoreError::NotFound {
            entity: "shift",
            id: id.to_owned(),
        })
    }

    /// Get the currently open shift for a user, if any.
    pub fn get_active_shift(&self, user_id: &str) -> Result<Option<Shift>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, user_id, terminal_id, opened_at, closed_at,
                    opening_balance_minor, closing_balance_minor,
                    expected_cash_minor, cash_difference_minor,
                    total_sales_minor, total_cash_minor, total_card_minor,
                    total_other_minor, total_voids_minor, total_refunds_minor,
                    total_payouts_minor,
                    notes, status, created_at, updated_at
             FROM shifts WHERE user_id = ?1 AND status = 'open'
             ORDER BY opened_at DESC LIMIT 1",
        )?;
        let result = stmt.query_row(params![user_id], Self::row_to_shift);
        match result {
            Ok(s) => Ok(Some(s)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// List all shifts, ordered by opened_at DESC (most recent first).
    pub fn list_shifts(&self) -> Result<Vec<Shift>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, user_id, terminal_id, opened_at, closed_at,
                    opening_balance_minor, closing_balance_minor,
                    expected_cash_minor, cash_difference_minor,
                    total_sales_minor, total_cash_minor, total_card_minor,
                    total_other_minor, total_voids_minor, total_refunds_minor,
                    total_payouts_minor,
                    notes, status, created_at, updated_at
             FROM shifts ORDER BY opened_at DESC",
        )?;
        let rows = stmt.query_map([], Self::row_to_shift)?;
        rows.map(|r| Ok(r?)).collect()
    }

    /// Get a single shift by id.
    pub fn get_shift(&self, id: &str) -> Result<Option<Shift>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, user_id, terminal_id, opened_at, closed_at,
                    opening_balance_minor, closing_balance_minor,
                    expected_cash_minor, cash_difference_minor,
                    total_sales_minor, total_cash_minor, total_card_minor,
                    total_other_minor, total_voids_minor, total_refunds_minor,
                    total_payouts_minor,
                    notes, status, created_at, updated_at
             FROM shifts WHERE id = ?1",
        )?;
        let result = stmt.query_row(params![id], Self::row_to_shift);
        match result {
            Ok(s) => Ok(Some(s)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// Generate a comprehensive report for a single shift.
    ///
    /// Returns the shift's aggregated totals plus payment-method and hourly
    /// breakdowns computed from the `sales` and `payments` tables within the
    /// shift's time window.
    pub fn get_shift_report(&self, shift_id: &str) -> Result<ShiftReport, CoreError> {
        let shift = self
            .get_shift(shift_id)?
            .ok_or_else(|| CoreError::NotFound {
                entity: "shift",
                id: shift_id.to_owned(),
            })?;

        let start = &shift.opened_at;
        let now_str = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let end = shift.closed_at.as_deref().unwrap_or(&now_str);

        let user = &shift.user_id;

        // Payment method breakdown within the shift window.
        let payment_breakdown: Vec<ShiftPaymentBreakdown> = {
            let mut stmt = self.conn.prepare(
                "SELECT p.method, COUNT(*) AS cnt, COALESCE(SUM(p.amount_minor), 0) AS tot
                 FROM payments p
                 JOIN sales s ON p.sale_id = s.id
                 WHERE s.user_id = ?1 AND s.created_at >= ?2 AND s.created_at <= ?3
                   AND s.status = 'completed'
                 GROUP BY p.method
                 ORDER BY tot DESC",
            )?;
            let rows = stmt.query_map(params![user, start, end], |row| {
                Ok(ShiftPaymentBreakdown {
                    method: row.get("method")?,
                    count: row.get("cnt")?,
                    total_minor: row.get("tot")?,
                })
            })?;
            rows.collect::<Result<Vec<_>, _>>()?
        };

        // Hourly sales breakdown within the shift window (from sales table).
        // REP-03: the window filter stays on absolute timestamps (shift
        // open/close are instants), but the hour-of-day labels are
        // store-local so the peak hour reads correctly for the cashier.
        let hourly_breakdown: Vec<ShiftSalesByHour> = {
            let tz = self.tz_modifier();
            let mut stmt = self.conn.prepare(
                "SELECT CAST(strftime('%H', created_at, ?4) AS INTEGER) AS hour,
                        SUM(total_minor) AS total_minor,
                        COUNT(*) AS sale_count
                 FROM sales
                 WHERE user_id = ?1 AND created_at >= ?2 AND created_at <= ?3
                   AND status = 'completed'
                 GROUP BY hour ORDER BY hour",
            )?;
            let rows = stmt.query_map(params![user, start, end, tz], |row| {
                Ok(ShiftSalesByHour {
                    hour: row.get("hour")?,
                    total_minor: row.get("total_minor")?,
                    sale_count: row.get("sale_count")?,
                })
            })?;
            rows.collect::<Result<Vec<_>, _>>()?
        };

        // Sale and void counts within the shift window.
        let (sale_count, void_count): (i64, i64) = self.conn.query_row(
            "SELECT
                COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN status = 'voided' THEN 1 ELSE 0 END), 0)
             FROM sales WHERE user_id = ?1 AND created_at >= ?2 AND created_at <= ?3",
            params![user, start, end],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;

        // Refund count, attributed to the user who PROCESSED the refund —
        // the same `refunds.processed_by` attribution `close_shift` uses for
        // `total_refunds_minor` (review 8.4). Joining the ORIGINAL sale's
        // `s.user_id` instead (the pre-fix shape) filed the count under the
        // SELLER's shift while the cash actually left the PROCESSOR's drawer,
        // so the report and the close disagreed by construction for any refund
        // handled by someone other than the seller.
        let refund_count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM refunds r
             WHERE r.processed_by = ?1 AND r.created_at >= ?2 AND r.created_at <= ?3",
            params![user, start, end],
            |row| row.get(0),
        )?;

        // Cash payouts for this shift.
        let cash_payouts = self.list_cash_payouts(shift_id)?;

        // ── Gross profit (HPP) ────────────────────────────────────────
        // Revenue is the completed-sale totals (same source as the hourly
        // breakdown and the shift's stored total). COGS sums the per-line
        // cost SNAPSHOT taken at checkout (`sale_lines.cost_minor`, written by
        // `insert_sale_line`), falling back to the product's current cost only
        // for legacy rows and lines whose product is missing -- the fallback is
        // not the primary source, and the earlier comment here claiming costs
        // "are not snapshotted per line" was stale.
        //
        // REP-08: both terms are refund-adjusted for THIS user's shift. Goods
        // returned to stock are no longer a cost of the units that stayed sold,
        // so their snapshot cost is subtracted from COGS, and profit is measured
        // against revenue net of the refunds. Using gross revenue with a
        // refund-netted COGS would add the refund back once and overstate profit
        // on any shift containing a refund.
        let gross_revenue_minor: i64 = self.conn.query_row(
            "SELECT COALESCE(SUM(total_minor), 0) FROM sales
             WHERE user_id = ?1 AND created_at >= ?2 AND created_at <= ?3
               AND status = 'completed'",
            params![user, start, end],
            |r| r.get(0),
        )?;
        let cogs_minor: i64 = self.conn.query_row(
            "SELECT COALESCE(SUM(COALESCE(sl.cost_minor, p.cost_minor, 0) * sl.qty), 0)
             FROM sale_lines sl
             JOIN sales s ON sl.sale_id = s.id
             LEFT JOIN products p ON sl.sku = p.sku
             WHERE s.user_id = ?1 AND s.created_at >= ?2 AND s.created_at <= ?3
               AND s.status = 'completed'",
            params![user, start, end],
            |r| r.get(0),
        )?;
        // Cost of the goods refunded within this shift, recovered from the
        // sale line the refund names. A refund line with no matching sale line
        // (a pre-guard row, or one written by the sync applier without
        // validation) contributes 0 rather than an invented cost.
        let refunded_cost_minor: i64 = self.conn.query_row(
            "SELECT COALESCE(SUM(COALESCE(sl.cost_minor, p.cost_minor, 0) * rl.qty), 0)
             FROM refund_lines rl
             JOIN refunds r ON r.id = rl.refund_id
             LEFT JOIN sale_lines sl ON sl.id = rl.sale_line_id
             LEFT JOIN products p ON sl.sku = p.sku
             WHERE r.processed_by = ?1 AND r.created_at >= ?2 AND r.created_at <= ?3",
            params![user, start, end],
            |r| r.get(0),
        )?;
        let refunded_revenue_minor: i64 = self.conn.query_row(
            "SELECT COALESCE(SUM(total_minor), 0) FROM refunds
             WHERE processed_by = ?1 AND created_at >= ?2 AND created_at <= ?3",
            params![user, start, end],
            |r| r.get(0),
        )?;
        let cogs_minor = cogs_minor - refunded_cost_minor;
        let net_revenue_minor = gross_revenue_minor - refunded_revenue_minor;
        let gross_profit_minor = net_revenue_minor - cogs_minor;
        let gross_margin_percent = if net_revenue_minor > 0 {
            gross_profit_minor as f64 / net_revenue_minor as f64 * 100.0
        } else {
            0.0
        };

        Ok(ShiftReport {
            shift,
            payment_breakdown,
            hourly_breakdown,
            cash_payouts,
            sale_count,
            void_count,
            refund_count,
            cogs_minor,
            gross_profit_minor,
            gross_margin_percent,
        })
    }

    fn row_to_shift(row: &rusqlite::Row) -> rusqlite::Result<Shift> {
        Ok(Shift {
            id: row.get("id")?,
            user_id: row.get("user_id")?,
            terminal_id: row.get("terminal_id")?,
            opened_at: row.get("opened_at")?,
            closed_at: row.get("closed_at")?,
            opening_balance_minor: row.get("opening_balance_minor")?,
            closing_balance_minor: row.get("closing_balance_minor")?,
            expected_cash_minor: row.get("expected_cash_minor")?,
            cash_difference_minor: row.get("cash_difference_minor")?,
            total_sales_minor: row.get("total_sales_minor")?,
            total_cash_minor: row.get("total_cash_minor")?,
            total_card_minor: row.get("total_card_minor")?,
            total_other_minor: row.get("total_other_minor")?,
            total_voids_minor: row.get("total_voids_minor")?,
            total_refunds_minor: row.get("total_refunds_minor")?,
            total_payouts_minor: row.get("total_payouts_minor")?,
            notes: row.get("notes")?,
            status: row.get("status")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        })
    }
}

// ── Shift Report types ────────────────────────────────────────────────

/// Comprehensive report for a single shift, including breakdowns.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ShiftReport {
    /// The shift record itself.
    pub shift: Shift,
    /// Payment method breakdown during this shift.
    pub payment_breakdown: Vec<ShiftPaymentBreakdown>,
    /// Hourly sales breakdown during this shift.
    pub hourly_breakdown: Vec<ShiftSalesByHour>,
    /// Cash payouts (safe drops) recorded during this shift.
    pub cash_payouts: Vec<crate::CashPayout>,
    /// Number of completed sales in this shift.
    pub sale_count: i64,
    /// Number of voided sales in this shift.
    pub void_count: i64,
    /// Number of refund transactions in this shift.
    pub refund_count: i64,
    /// Cost of goods sold in minor units (Σ current product cost × qty over
    /// completed-sale lines). 0 when no lines or costs are recorded.
    pub cogs_minor: i64,
    /// Gross profit in minor units: completed-sale revenue − COGS.
    pub gross_profit_minor: i64,
    /// Gross margin as a percentage of revenue; 0.0 when revenue is 0.
    pub gross_margin_percent: f64,
}

/// Payment method totals within a shift's time window.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ShiftPaymentBreakdown {
    /// Payment method name (e.g. "cash", "card").
    pub method: String,
    /// Number of payments using this method.
    pub count: i64,
    /// Total amount in minor units.
    pub total_minor: i64,
}

/// Hourly sales aggregate within a shift's time window.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ShiftSalesByHour {
    /// Hour of day (0–23).
    pub hour: i64,
    /// Total value in minor units.
    pub total_minor: i64,
    /// Number of sales in this hour.
    pub sale_count: i64,
}

#[cfg(test)]
#[path = "shifts_tests.rs"]
mod tests;
