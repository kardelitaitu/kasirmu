//! Per-staff analytics over a date range (analytics:view).
/*
last audited 25-07-26 by RSA-Agent (oz-core slice B5 part 6)
crate: oz-core | status: SAFE | lint: CLEAN
findings: clean aggregation; DATE() bucketing is UTC (COR-21 family — day labels shift for UTC+7/+8)
next: none here | perf: two grouped queries, no N+1
*/
//!
//! Aggregates shift history and completed sales from the store-scoped DB,
//! grouped per staff member. Shift days use `opened_at` (the shift's start),
//! sales days use `created_at`; both are matched with SQLite `DATE()`
//! against an inclusive `[from, to]` `YYYY-MM-DD` range, mirroring the
//! reports module. All money is integer minor units (`i64`).
//!
//! The commands layer enforces the `analytics:view` permission and the
//! caller's scoped assignment (ADR #35 D5 / spec 0048); this module only
//! shapes the data. Sales without a `user_id` (pre-014 rows) are excluded.

use rusqlite::params;

use crate::error::CoreError;

use super::Store;
use super::reports::check_date_bound;

/// Per-staff aggregate over a date range.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StaffAnalyticsSummary {
    /// The staff member (cashier) id.
    pub user_id: String,
    /// Number of shifts opened in the range (open or closed).
    pub shift_count: i64,
    /// Number of those shifts already closed.
    pub closed_shift_count: i64,
    /// Sum of `shifts.total_sales_minor` for the range.
    pub shift_sales_minor: i64,
    /// Number of completed sales in the range attributed to this staff.
    pub sale_count: i64,
    /// Sum of `sales.total_minor` for the completed sales in the range.
    pub sale_total_minor: i64,
}

/// Per-day series for one staff member over a date range.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StaffAnalyticsDaily {
    /// `YYYY-MM-DD` (SQLite `DATE()`).
    pub day: String,
    /// Completed sales attributed to the staff member that day.
    pub sale_count: i64,
    /// Sum of `sales.total_minor` for those sales.
    pub sale_total_minor: i64,
    /// Shifts opened that day.
    pub shift_count: i64,
    /// Sum of `shifts.total_sales_minor` for those shifts.
    pub shift_sales_minor: i64,
}

impl Store<'_> {
    /// Per-staff shift + completed-sales aggregates over `[from, to]`.
    pub fn staff_analytics_summary(
        &self,
        from: &str,
        to: &str,
    ) -> Result<Vec<StaffAnalyticsSummary>, CoreError> {
        // REP-03: boundaries are store-local dates (contract in db::reports).
        check_date_bound("from", from)?;
        check_date_bound("to", to)?;
        let shifts = self.analytics_shift_rows(from, to)?;
        let sales = self.analytics_sale_rows(from, to)?;

        let mut out = Vec::new();
        for s in shifts {
            out.push(StaffAnalyticsSummary {
                user_id: s.user_id.clone(),
                shift_count: s.shift_count,
                closed_shift_count: s.closed_shift_count,
                shift_sales_minor: s.shift_sales_minor,
                sale_count: 0,
                sale_total_minor: 0,
            });
        }
        for s in sales {
            match out.iter_mut().find(|o| o.user_id == s.user_id) {
                Some(row) => {
                    row.sale_count = s.sale_count;
                    row.sale_total_minor = s.sale_total_minor;
                }
                None => out.push(StaffAnalyticsSummary {
                    user_id: s.user_id.clone(),
                    shift_count: 0,
                    closed_shift_count: 0,
                    shift_sales_minor: 0,
                    sale_count: s.sale_count,
                    sale_total_minor: s.sale_total_minor,
                }),
            }
        }
        out.sort_by(|a, b| a.user_id.cmp(&b.user_id));
        Ok(out)
    }

    /// Per-day shift + completed-sales series for one staff member.
    pub fn staff_analytics_daily(
        &self,
        user_id: &str,
        from: &str,
        to: &str,
    ) -> Result<Vec<StaffAnalyticsDaily>, CoreError> {
        // REP-03: day buckets in store-local dates.
        check_date_bound("from", from)?;
        check_date_bound("to", to)?;
        let tz = self.tz_modifier();
        let mut stmt = self.conn.prepare(
            "SELECT DATE(s.created_at, ?4) AS day,
                    COUNT(*) AS sale_count,
                    COALESCE(SUM(s.total_minor), 0) AS sale_total_minor
             FROM sales s
             WHERE s.status = 'completed'
               AND s.user_id IS NOT NULL
               AND s.user_id = ?1
               AND DATE(s.created_at, ?4) BETWEEN ?2 AND ?3
             GROUP BY DATE(s.created_at, ?4)",
        )?;
        let sales = stmt
            .query_map(params![user_id, from, to, tz], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let mut stmt = self.conn.prepare(
            "SELECT DATE(sh.opened_at, ?4) AS day,
                    COUNT(*) AS shift_count,
                    COALESCE(SUM(sh.total_sales_minor), 0) AS shift_sales_minor
             FROM shifts sh
             WHERE sh.user_id = ?1
               AND DATE(sh.opened_at, ?4) BETWEEN ?2 AND ?3
             GROUP BY DATE(sh.opened_at, ?4)",
        )?;
        let shifts = stmt
            .query_map(params![user_id, from, to, tz], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let mut out = Vec::new();
        for (day, count, total) in sales {
            out.push(StaffAnalyticsDaily {
                day: day.clone(),
                sale_count: count,
                sale_total_minor: total,
                shift_count: 0,
                shift_sales_minor: 0,
            });
        }
        for (day, count, total) in shifts {
            match out.iter_mut().find(|o| o.day == day) {
                Some(row) => {
                    row.shift_count = count;
                    row.shift_sales_minor = total;
                }
                None => out.push(StaffAnalyticsDaily {
                    day: day.clone(),
                    sale_count: 0,
                    sale_total_minor: 0,
                    shift_count: count,
                    shift_sales_minor: total,
                }),
            }
        }
        out.sort_by(|a, b| a.day.cmp(&b.day));
        Ok(out)
    }

    /// Shift rows: per-user count + closed count + sales total in range.
    fn analytics_shift_rows(&self, from: &str, to: &str) -> Result<Vec<ShiftAggregate>, CoreError> {
        let tz = self.tz_modifier();
        let mut stmt = self.conn.prepare(
            "SELECT sh.user_id,
                    COUNT(*) AS shift_count,
                    SUM(CASE WHEN sh.status = 'closed' THEN 1 ELSE 0 END) AS closed_count,
                    COALESCE(SUM(sh.total_sales_minor), 0) AS shift_sales_minor
             FROM shifts sh
             WHERE DATE(sh.opened_at, ?3) BETWEEN ?1 AND ?2
             GROUP BY sh.user_id",
        )?;
        let rows = stmt
            .query_map(params![from, to, tz], |row| {
                Ok(ShiftAggregate {
                    user_id: row.get(0)?,
                    shift_count: row.get(1)?,
                    closed_shift_count: row.get(2)?,
                    shift_sales_minor: row.get(3)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Sale rows: per-user count + total of completed sales in range.
    fn analytics_sale_rows(&self, from: &str, to: &str) -> Result<Vec<SaleAggregate>, CoreError> {
        let tz = self.tz_modifier();
        let mut stmt = self.conn.prepare(
            "SELECT s.user_id,
                    COUNT(*) AS sale_count,
                    COALESCE(SUM(s.total_minor), 0) AS sale_total_minor
             FROM sales s
             WHERE s.status = 'completed'
               AND s.user_id IS NOT NULL
               AND DATE(s.created_at, ?3) BETWEEN ?1 AND ?2
             GROUP BY s.user_id",
        )?;
        let rows = stmt
            .query_map(params![from, to, tz], |row| {
                Ok(SaleAggregate {
                    user_id: row.get(0)?,
                    sale_count: row.get(1)?,
                    sale_total_minor: row.get(2)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }
}

/// Per-user shift aggregate (internal).
struct ShiftAggregate {
    user_id: String,
    shift_count: i64,
    closed_shift_count: i64,
    shift_sales_minor: i64,
}

/// Per-user completed-sale aggregate (internal).
struct SaleAggregate {
    user_id: String,
    sale_count: i64,
    sale_total_minor: i64,
}

#[cfg(test)]
#[path = "analytics_tests.rs"]
mod tests;
