//! Shift management — open/close shifts, cash reconciliation.
/*
last audited 25-07-26 by RSA-Agent (oz-core slice B5 part 5)
crate: oz-core | status: SAFE | lint: CLEAN
findings: close_shift exemplary — all aggregation reads + final write in one tx, cash refunds subtracted from expected cash (documented false-positive fix), safe-drop payouts included, gross profit matches reporting-layer cost semantics; COR-27 LOW: open_shift COUNT-then-INSERT duplicate guard has NO partial unique index behind it (verified init.sql:1259-1263 — only plain indexes; inventory_shifts HAS idx_inv_shifts_active_per_user_location) — advisory-only, race-safe under single-connection mutex; hour labels in get_shift_report are UTC (COR-21 family, totals unaffected)
next: partial unique index on shifts(user_id) WHERE status='open' (COR-27) | perf: N/A
*/

use rusqlite::params;

use crate::Shift;
use crate::error::CoreError;

use super::Store;

impl Store<'_> {
    /// Open a new shift for a user.
    ///
    /// Validates that the user exists and is active, and that there is no
    /// other open shift for the same user.
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

        // Verify the user exists and is active.
        let active: bool = self
            .conn
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

        // Ensure no duplicate open shift for this user.
        let open_count: i64 = self.conn.query_row(
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

        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let id = uuid::Uuid::now_v7().to_string();

        self.conn.execute(
            "INSERT INTO shifts (id, user_id, terminal_id, opening_balance_minor, opened_at, created_at, updated_at, status)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'open')",
            params![id, user_id.trim(), terminal_id, opening_balance_minor, now, now, now],
        )?;

        self.get_shift(&id)?.ok_or_else(|| CoreError::NotFound {
            entity: "shift",
            id: id.to_owned(),
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

        let tx = self.conn.unchecked_transaction()?;

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

        // Calculate sales totals from the sales table for sales made during this shift.
        let (total_sales, total_cash, total_card, total_other, total_voids): (i64, i64, i64, i64, i64) = tx.query_row(
            "SELECT
                COALESCE(SUM(CASE WHEN status = 'completed' THEN total_minor ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN status = 'completed' AND payment_method = 'cash' THEN total_minor ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN status = 'completed' AND payment_method = 'card' THEN total_minor ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN status = 'completed' AND payment_method NOT IN ('cash', 'card') THEN total_minor ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN status = 'voided' THEN total_minor ELSE 0 END), 0)
             FROM sales WHERE user_id = ?1 AND created_at >= ?2 AND created_at <= ?3",
            params![shift.user_id, shift.opened_at, now],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
        )?;

        // Calculate total refunds for sales made by this user during the shift.
        let total_refunds: i64 = tx.query_row(
            "SELECT COALESCE(SUM(r.total_minor), 0)
             FROM refunds r
             JOIN sales s ON r.sale_id = s.id
             WHERE s.user_id = ?1 AND r.created_at >= ?2 AND r.created_at <= ?3",
            params![shift.user_id, shift.opened_at, now],
            |row| row.get(0),
        )?;

        // Cash refunds take cash OUT of the drawer, so the expected cash must
        // subtract them — otherwise a refund makes the drawer look OVER by
        // the refunded amount (a false positive that masks a real shortage).
        let cash_refunds: i64 = tx.query_row(
            "SELECT COALESCE(SUM(r.total_minor), 0)
             FROM refunds r
             JOIN sales s ON r.sale_id = s.id
             WHERE s.user_id = ?1 AND s.payment_method = 'cash'
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

        // Refund count from refunds table.
        let refund_count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM refunds r
             JOIN sales s ON r.sale_id = s.id
             WHERE s.user_id = ?1 AND r.created_at >= ?2 AND r.created_at <= ?3",
            params![user, start, end],
            |row| row.get(0),
        )?;

        // Cash payouts for this shift.
        let cash_payouts = self.list_cash_payouts(shift_id)?;

        // ── Gross profit (HPP) ────────────────────────────────────────
        // Revenue is the completed-sale totals (same source as the hourly
        // breakdown and the shift's stored total). COGS is the sum of
        // current product cost × qty over the completed-sale lines, matching
        // the reporting layer's cost semantics (costs are not snapshotted
        // per line). Lines whose product is unknown fall back to a zero cost.
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
        let gross_profit_minor = gross_revenue_minor - cogs_minor;
        let gross_margin_percent = if gross_revenue_minor > 0 {
            gross_profit_minor as f64 / gross_revenue_minor as f64 * 100.0
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
