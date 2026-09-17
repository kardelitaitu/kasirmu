//! Time-bucketed revenue aggregation: daily, weekly and monthly.
//!
//! The three REP-04 `FULL OUTER` sales/refunds CTE queries that produce the
//! revenue rows every dashboard, export bundle and email report is built
//! from, plus [`Store::revenue_profit_fields`], the shared revenue/COGS
//! column mapper they all read through. Range validation and the store
//! offset come from [`super::datetime`].
//!
//! Split from `db/reports.rs` 13-09-26, behaviour unchanged — pure module
//! decomposition, no logic edits.

use rusqlite::params;

use crate::db::Store;
use crate::error::CoreError;

use super::check_date_bound;

/// Revenue aggregated by date.
#[derive(Debug, Clone, serde::Serialize)]
pub struct DailyRevenueRow {
    /// ISO date YYYY-MM-DD
    pub date: String,
    /// Total revenue in minor units.
    pub total_minor: i64,
    /// ISO-4217 currency code.
    pub currency: String,
    /// Number of completed sales on this date.
    pub sale_count: i64,
    /// Cost of goods sold in minor units (Σ current cost × qty over the
    /// date's completed-sale lines; 0 when no costs are recorded).
    pub cogs_minor: i64,
    /// Gross profit in minor units: revenue − COGS.
    pub gross_profit_minor: i64,
    /// Gross margin as a percentage of revenue; 0.0 when revenue is 0.
    pub gross_margin_percent: f64,
    /// Refunds processed on this date (minor units, same currency).
    /// REP-04: refunds are attributed to the REFUND's own day, not the
    /// original sale's — accounting convention, and the refund ledger is
    /// otherwise invisible in reports.
    pub refund_minor: i64,
    /// Net revenue in minor units: gross revenue − refunds. Can be
    /// negative on a day with only refunds (the row still appears).
    pub net_revenue_minor: i64,
}

/// Weekly revenue aggregation.
#[derive(Debug, Clone, serde::Serialize)]
pub struct WeeklyRevenueRow {
    /// ISO date of the week start (Sunday).
    pub week_start: String,
    /// Total revenue in minor units.
    pub total_minor: i64,
    /// ISO-4217 currency code.
    pub currency: String,
    /// Number of completed sales in this week.
    pub sale_count: i64,
    /// Cost of goods sold in minor units (Σ current cost × qty over the
    /// week's completed-sale lines; 0 when no costs are recorded).
    pub cogs_minor: i64,
    /// Gross profit in minor units: revenue − COGS.
    pub gross_profit_minor: i64,
    /// Gross margin as a percentage of revenue; 0.0 when revenue is 0.
    pub gross_margin_percent: f64,
    /// Refunds processed in this week (minor units, same currency; REP-04).
    pub refund_minor: i64,
    /// Net revenue in minor units: gross revenue − refunds (REP-04).
    pub net_revenue_minor: i64,
}

/// Monthly revenue aggregation.
#[derive(Debug, Clone, serde::Serialize)]
pub struct MonthlyRevenueRow {
    /// YYYY-MM
    pub month: String,
    /// Total revenue in minor units.
    pub total_minor: i64,
    /// ISO-4217 currency code.
    pub currency: String,
    /// Number of completed sales in this month.
    pub sale_count: i64,
    /// Cost of goods sold in minor units (Σ current cost × qty over the
    /// month's completed-sale lines; 0 when no costs are recorded).
    pub cogs_minor: i64,
    /// Gross profit in minor units: revenue − COGS.
    pub gross_profit_minor: i64,
    /// Gross margin as a percentage of revenue; 0.0 when revenue is 0.
    pub gross_margin_percent: f64,
    /// Refunds processed in this month (minor units, same currency; REP-04).
    pub refund_minor: i64,
    /// Net revenue in minor units: gross revenue − refunds (REP-04).
    pub net_revenue_minor: i64,
}

impl Store<'_> {
    /// Map the shared revenue/COGS columns of the aggregation rows.
    fn revenue_profit_fields(row: &rusqlite::Row<'_>) -> rusqlite::Result<(i64, i64, i64, f64)> {
        let total_minor: i64 = row.get("total_minor")?;
        let cogs_minor: i64 = row.get("cogs_minor")?;
        let gross_profit_minor = total_minor - cogs_minor;
        let gross_margin_percent = if total_minor > 0 {
            gross_profit_minor as f64 / total_minor as f64 * 100.0
        } else {
            0.0
        };
        Ok((
            total_minor,
            cogs_minor,
            gross_profit_minor,
            gross_margin_percent,
        ))
    }

    /// Daily revenue for a date range.
    pub fn daily_revenue(
        &self,
        start_date: &str,
        end_date: &str,
    ) -> Result<Vec<DailyRevenueRow>, CoreError> {
        // REP-03: every date/hour bucket uses the store's UTC offset.
        check_date_bound("start_date", start_date)?;
        check_date_bound("end_date", end_date)?;
        let tz = self.tz_modifier();
        // COGS is a correlated subquery: joining sale_lines directly would
        // multiply revenue/count by the line count per sale, so revenue stays
        // on the sales table and only the cost side joins the lines. Costs
        // use the product's current cost_minor (reporting-layer semantics).
        // REP-04: sales and refunds aggregate independently (CTEs) and join
        // FULL OUTER on (date, currency) — a refund-only day must still
        // produce a row, otherwise the refund silently vanishes from reports.
        let mut stmt = self.conn.prepare(
            "WITH s AS (
                 SELECT DATE(s1.created_at, ?3) AS d, s1.currency AS c,
                        SUM(s1.total_minor) AS t, COUNT(*) AS n,
                        (SELECT COALESCE(SUM(COALESCE(sl2.cost_minor, p2.cost_minor, 0) * sl2.qty), 0)
                         FROM sale_lines sl2
                         JOIN sales s2 ON sl2.sale_id = s2.id
                         LEFT JOIN products p2 ON sl2.sku = p2.sku
                         WHERE s2.status = 'completed'
                           AND s2.currency = s1.currency
                           AND DATE(s2.created_at, ?3) = DATE(s1.created_at, ?3)) AS cogs
                 FROM sales s1
                 WHERE s1.status = 'completed' AND DATE(s1.created_at, ?3) BETWEEN ?1 AND ?2
                 GROUP BY DATE(s1.created_at, ?3), s1.currency
             ),
             r AS (
                 SELECT DATE(created_at, ?3) AS d, currency AS c, SUM(total_minor) AS rf
                 FROM refunds
                 WHERE DATE(created_at, ?3) BETWEEN ?1 AND ?2
                 GROUP BY DATE(created_at, ?3), currency
             )
             SELECT COALESCE(s.d, r.d) AS date,
                    COALESCE(s.c, r.c) AS currency,
                    COALESCE(s.t, 0) AS total_minor,
                    COALESCE(s.n, 0) AS sale_count,
                    COALESCE(s.cogs, 0) AS cogs_minor,
                    COALESCE(r.rf, 0) AS refund_minor,
                    COALESCE(s.t, 0) - COALESCE(r.rf, 0) AS net_revenue_minor
             FROM s FULL OUTER JOIN r ON s.d = r.d AND s.c = r.c
             ORDER BY date ASC",
        )?;
        let rows = stmt.query_map(params![start_date, end_date, tz], |row| {
            let (total_minor, cogs_minor, gross_profit_minor, gross_margin_percent) =
                Self::revenue_profit_fields(row)?;
            Ok(DailyRevenueRow {
                date: row.get("date")?,
                total_minor,
                currency: row.get("currency")?,
                sale_count: row.get("sale_count")?,
                cogs_minor,
                gross_profit_minor,
                gross_margin_percent,
                refund_minor: row.get("refund_minor")?,
                net_revenue_minor: row.get("net_revenue_minor")?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    /// Weekly revenue (Monday-first weeks) for a date range.
    pub fn weekly_revenue(
        &self,
        start_date: &str,
        end_date: &str,
    ) -> Result<Vec<WeeklyRevenueRow>, CoreError> {
        // REP-03: store-offset shift applied BEFORE the week truncation.
        check_date_bound("start_date", start_date)?;
        check_date_bound("end_date", end_date)?;
        let tz = self.tz_modifier();
        // Monday-first weeks, matching the UI's `weekStartKey` and
        // `rangeForGranularity('weekly')`. `'-6 days', 'weekday 1'` is the
        // correct boundary idiom: `'weekday 1', '-7 days'` would push a
        // Monday sale into the PREVIOUS week. COGS is a correlated subquery
        // keyed on the same week expression, so joining sale_lines never
        // multiplies revenue/count per sale line.
        let mut stmt = self.conn.prepare(
            "WITH s AS (
                 SELECT DATE(s1.created_at, ?3, '-6 days', 'weekday 1') AS d, s1.currency AS c,
                        SUM(s1.total_minor) AS t, COUNT(*) AS n,
                        (SELECT COALESCE(SUM(COALESCE(sl2.cost_minor, p2.cost_minor, 0) * sl2.qty), 0)
                         FROM sale_lines sl2
                         JOIN sales s2 ON sl2.sale_id = s2.id
                         LEFT JOIN products p2 ON sl2.sku = p2.sku
                         WHERE s2.status = 'completed'
                           AND s2.currency = s1.currency
                           AND DATE(s2.created_at, ?3, '-6 days', 'weekday 1')
                                = DATE(s1.created_at, ?3, '-6 days', 'weekday 1')) AS cogs
                 FROM sales s1
                 WHERE s1.status = 'completed' AND DATE(s1.created_at, ?3) BETWEEN ?1 AND ?2
                 GROUP BY DATE(s1.created_at, ?3, '-6 days', 'weekday 1'), s1.currency
             ),
             r AS (
                 SELECT DATE(created_at, ?3, '-6 days', 'weekday 1') AS d, currency AS c,
                        SUM(total_minor) AS rf
                 FROM refunds
                 WHERE DATE(created_at, ?3) BETWEEN ?1 AND ?2
                 GROUP BY DATE(created_at, ?3, '-6 days', 'weekday 1'), currency
             )
             SELECT COALESCE(s.d, r.d) AS week_start,
                    COALESCE(s.c, r.c) AS currency,
                    COALESCE(s.t, 0) AS total_minor,
                    COALESCE(s.n, 0) AS sale_count,
                    COALESCE(s.cogs, 0) AS cogs_minor,
                    COALESCE(r.rf, 0) AS refund_minor,
                    COALESCE(s.t, 0) - COALESCE(r.rf, 0) AS net_revenue_minor
             FROM s FULL OUTER JOIN r ON s.d = r.d AND s.c = r.c
             ORDER BY week_start ASC",
        )?;
        let rows = stmt.query_map(params![start_date, end_date, tz], |row| {
            let (total_minor, cogs_minor, gross_profit_minor, gross_margin_percent) =
                Self::revenue_profit_fields(row)?;
            Ok(WeeklyRevenueRow {
                week_start: row.get("week_start")?,
                total_minor,
                currency: row.get("currency")?,
                sale_count: row.get("sale_count")?,
                cogs_minor,
                gross_profit_minor,
                gross_margin_percent,
                refund_minor: row.get("refund_minor")?,
                net_revenue_minor: row.get("net_revenue_minor")?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    /// Monthly revenue for a date range.
    pub fn monthly_revenue(
        &self,
        start_date: &str,
        end_date: &str,
    ) -> Result<Vec<MonthlyRevenueRow>, CoreError> {
        // REP-03: the YYYY-MM bucket key is derived from the store-local
        // date, not the raw UTC prefix.
        check_date_bound("start_date", start_date)?;
        check_date_bound("end_date", end_date)?;
        let tz = self.tz_modifier();
        // COGS is a correlated subquery keyed on the same YYYY-MM expression,
        // so joining sale_lines never multiplies revenue/count per line.
        let mut stmt = self.conn.prepare(
            "WITH s AS (
                 SELECT strftime('%Y-%m', s1.created_at, ?3) AS d, s1.currency AS c,
                        SUM(s1.total_minor) AS t, COUNT(*) AS n,
                        (SELECT COALESCE(SUM(COALESCE(sl2.cost_minor, p2.cost_minor, 0) * sl2.qty), 0)
                         FROM sale_lines sl2
                         JOIN sales s2 ON sl2.sale_id = s2.id
                         LEFT JOIN products p2 ON sl2.sku = p2.sku
                         WHERE s2.status = 'completed'
                           AND s2.currency = s1.currency
                           AND strftime('%Y-%m', s2.created_at, ?3) = strftime('%Y-%m', s1.created_at, ?3)) AS cogs
                 FROM sales s1
                 WHERE s1.status = 'completed' AND DATE(s1.created_at, ?3) BETWEEN ?1 AND ?2
                 GROUP BY strftime('%Y-%m', s1.created_at, ?3), s1.currency
             ),
             r AS (
                 SELECT strftime('%Y-%m', created_at, ?3) AS d, currency AS c, SUM(total_minor) AS rf
                 FROM refunds
                 WHERE DATE(created_at, ?3) BETWEEN ?1 AND ?2
                 GROUP BY strftime('%Y-%m', created_at, ?3), currency
             )
             SELECT COALESCE(s.d, r.d) AS month,
                    COALESCE(s.c, r.c) AS currency,
                    COALESCE(s.t, 0) AS total_minor,
                    COALESCE(s.n, 0) AS sale_count,
                    COALESCE(s.cogs, 0) AS cogs_minor,
                    COALESCE(r.rf, 0) AS refund_minor,
                    COALESCE(s.t, 0) - COALESCE(r.rf, 0) AS net_revenue_minor
             FROM s FULL OUTER JOIN r ON s.d = r.d AND s.c = r.c
             ORDER BY month ASC",
        )?;
        let rows = stmt.query_map(params![start_date, end_date, tz], |row| {
            let (total_minor, cogs_minor, gross_profit_minor, gross_margin_percent) =
                Self::revenue_profit_fields(row)?;
            Ok(MonthlyRevenueRow {
                month: row.get("month")?,
                total_minor,
                currency: row.get("currency")?,
                sale_count: row.get("sale_count")?,
                cogs_minor,
                gross_profit_minor,
                gross_margin_percent,
                refund_minor: row.get("refund_minor")?,
                net_revenue_minor: row.get("net_revenue_minor")?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }
}
