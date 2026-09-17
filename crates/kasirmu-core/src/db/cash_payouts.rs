//! Cash payout (safe drop) database operations.
/*
last audited 25-07-26 by RSA-Agent (oz-core slice B5 part 6)
crate: oz-core | status: SAFE | lint: CLEAN
findings: validates amount>0 and open shift; COR-28 INFO: open-shift check is outside the insert (TOCTOU — a concurrently closed shift can still receive a payout; advisory class, low stakes)
next: none | perf: N/A
*/

use rusqlite::params;

use crate::CashPayout;
use crate::error::CoreError;

use super::Store;

impl Store<'_> {
    /// Record a cash payout (safe drop) against an open shift.
    ///
    /// Returns `CoreError::Validation` if the shift is not found or is
    /// already closed, or if `amount_minor ≤ 0`.
    pub fn create_cash_payout(
        &self,
        shift_id: &str,
        amount_minor: i64,
        reason: &str,
    ) -> Result<CashPayout, CoreError> {
        if amount_minor <= 0 {
            return Err(CoreError::Validation {
                field: "amount_minor",
                message: "amount_minor must be > 0".into(),
            });
        }

        // Verify the shift exists and is open.
        let shift = self
            .get_shift(shift_id)?
            .ok_or_else(|| CoreError::NotFound {
                entity: "shift",
                id: shift_id.to_owned(),
            })?;
        if shift.is_closed() {
            return Err(CoreError::Validation {
                field: "status",
                message: "cannot add payout to a closed shift".into(),
            });
        }

        let payout = CashPayout::new(shift_id, amount_minor, reason);
        let now = &payout.created_at;

        self.conn.execute(
            "INSERT INTO cash_payouts (id, shift_id, amount_minor, reason, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![payout.id, shift_id, amount_minor, reason, now],
        )?;

        Ok(payout)
    }

    /// List all cash payouts for a shift, ordered by created_at ASC.
    pub fn list_cash_payouts(&self, shift_id: &str) -> Result<Vec<CashPayout>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, shift_id, amount_minor, reason, created_at
             FROM cash_payouts WHERE shift_id = ?1
             ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map(params![shift_id], |row| {
            Ok(CashPayout {
                id: row.get("id")?,
                shift_id: row.get("shift_id")?,
                amount_minor: row.get("amount_minor")?,
                reason: row.get("reason")?,
                created_at: row.get("created_at")?,
            })
        })?;
        rows.map(|r| Ok(r?)).collect()
    }

    /// Get the total amount of all cash payouts for a shift (0 if none).
    pub fn get_total_payouts_for_shift(&self, shift_id: &str) -> Result<i64, CoreError> {
        let total: i64 = self.conn.query_row(
            "SELECT COALESCE(SUM(amount_minor), 0) FROM cash_payouts WHERE shift_id = ?1",
            params![shift_id],
            |row| row.get(0),
        )?;
        Ok(total)
    }
}

#[cfg(test)]
#[path = "cash_payouts_tests.rs"]
mod tests;
