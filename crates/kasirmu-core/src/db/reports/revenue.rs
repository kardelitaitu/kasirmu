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

// P2-5: every cast here converts EXACT integer minor units to `f64` for one
// division whose result is a PERCENTAGE (`part as f64 / whole as f64 * 100.0`).
// A percentage is a ratio, not money — no monetary value is stored or summed in
// floating point, and the i64 minor-unit totals remain the source of truth that
// the ratio is derived FROM. `cast_precision_loss` is unactionable here for the
// same reason it exists: it is warning that a 53-bit mantissa cannot hold every
// i64, which is true and irrelevant to a two-significant-figure display value.
#![allow(clippy::cast_precision_loss)]

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
    /// ISO date of the week's Monday (Monday-first buckets, matching the UI's
    /// `weekStartKey`).
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

/// The daily revenue aggregation SQL.
///
/// Returns one row per (store-local day, currency): gross revenue, sale count,
/// COGS net of refunded goods, refunds and net revenue.
///
/// Hoisted to a module constant so the plan tests
/// (`revenue_refund_cte_uses_refunds_currency_created_date_index` in
/// `migrations_tests.rs` and the query-plan probe in
/// `tests/integration/query_plan_probe.rs`) read the SAME text the product
/// runs. `pub` rather than `pub(crate)` because the probe is a separate test
/// crate; the enclosing `revenue` module stays crate-private. A plan test
/// against a copy of the SQL is worthless — it stays green when the production
/// query is reshaped back into the form that scans.
///
/// **The refunds side is nested on purpose, and the defence is narrow.**
/// `rg` is its own CTE and `r` divides it by `n`; inline, SQLite prices the
/// correlated cost subquery against the GROUP BY block and abandons
/// `idx_refunds_currency_created_date` for a full scan of `refunds`
/// (measured 2026-10-24, both column orders, with and without ANALYZE). The
/// index is only reachable for a NARROW window — around 30 days the seek is
/// clearly cheaper, at 365 days the two estimates were within a few percent
/// (scan 20.0 vs index 19.1) and SQLite still prefers the scan. A manager's
/// usual window is a week; a full-year pull is not the case this optimises.
pub const DAILY_REVENUE_SQL: &str = "WITH s AS (
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
             rg AS (
             -- The refunds aggregate is spelled as a nested CTE and joined
             -- back on (d, c) rather than carried inline. Measured with
             -- EXPLAIN QUERY PLAN over a seeded + ANALYZE'd database
             -- (2026-10-24): with the cost subquery inline, SQLite prices the
             -- correlated per-row lookup against the GROUP BY block and
             -- abandons idx_refunds_currency_created_date for a full scan of
             -- refunds; as its own block it plans the scan the index EXISTS
             -- for. The cost subquery is evaluated once per refund, so it
             -- divides by the group's row count.
                 SELECT DATE(rf1.created_at, ?3) AS d, rf1.currency AS c,
                        SUM(rf1.total_minor) AS rf, COUNT(*) AS n,
                        SUM((SELECT COALESCE(SUM(COALESCE(sl3.cost_minor, p3.cost_minor, 0) * rl3.qty), 0)
                             FROM refund_lines rl3
                             JOIN refunds rf3 ON rf3.id = rl3.refund_id
                             LEFT JOIN sale_lines sl3 ON sl3.id = rl3.sale_line_id
                             LEFT JOIN products p3 ON sl3.sku = p3.sku
                             WHERE DATE(rf3.created_at, ?3) = DATE(rf1.created_at, ?3)
                               AND rf3.currency = rf1.currency)) AS rcost_sum
                 FROM refunds rf1
                 WHERE DATE(rf1.created_at, ?3) BETWEEN ?1 AND ?2
                 GROUP BY rf1.currency, DATE(rf1.created_at, ?3)
             ),
             r AS (
                 SELECT rg.d, rg.c, rg.rf, (rg.rcost_sum / rg.n) AS rcost FROM rg
             )
             SELECT COALESCE(s.d, r.d) AS date,
                    COALESCE(s.c, r.c) AS currency,
                    COALESCE(s.t, 0) AS total_minor,
                    COALESCE(s.n, 0) AS sale_count,
                    COALESCE(s.cogs, 0) - COALESCE(r.rcost, 0) AS cogs_minor,
                    COALESCE(r.rf, 0) AS refund_minor,
                    COALESCE(s.t, 0) - COALESCE(r.rf, 0) AS net_revenue_minor
             FROM s FULL OUTER JOIN r ON s.d = r.d AND s.c = r.c
             ORDER BY date ASC";

/// The weekly revenue aggregation SQL (Monday-first buckets, matching the UI's
/// `weekStartKey`).
///
/// Returns one row per (store-local week start, currency): gross revenue, sale
/// count, COGS net of refunded goods, refunds and net revenue.
///
/// Hoisted so the plan test reads the same text the product runs — see
/// [`DAILY_REVENUE_SQL`] for why the refunds side is nested and for the honest
/// limits of what that nesting buys.
pub const WEEKLY_REVENUE_SQL: &str = "WITH s AS (
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
             rg AS (
             -- The refunds aggregate is spelled as a nested CTE and joined
             -- back on (d, c) rather than carried inline. Measured with
             -- EXPLAIN QUERY PLAN over a seeded + ANALYZE'd database
             -- (2026-10-24): with the cost subquery inline, SQLite prices the
             -- correlated per-row lookup against the GROUP BY block and
             -- abandons idx_refunds_currency_created_date for a full scan of
             -- refunds; as its own block it plans the scan the index EXISTS
             -- for. The cost subquery is evaluated once per refund, so it
             -- divides by the group's row count.
                 SELECT DATE(rf1.created_at, ?3, '-6 days', 'weekday 1') AS d, rf1.currency AS c,
                        SUM(rf1.total_minor) AS rf, COUNT(*) AS n,
                        SUM((SELECT COALESCE(SUM(COALESCE(sl3.cost_minor, p3.cost_minor, 0) * rl3.qty), 0)
                             FROM refund_lines rl3
                             JOIN refunds rf3 ON rf3.id = rl3.refund_id
                             LEFT JOIN sale_lines sl3 ON sl3.id = rl3.sale_line_id
                             LEFT JOIN products p3 ON sl3.sku = p3.sku
                             WHERE DATE(rf3.created_at, ?3, '-6 days', 'weekday 1')
                                   = DATE(rf1.created_at, ?3, '-6 days', 'weekday 1')
                               AND rf3.currency = rf1.currency)) AS rcost_sum
                 FROM refunds rf1
                 WHERE DATE(rf1.created_at, ?3) BETWEEN ?1 AND ?2
                 GROUP BY rf1.currency, DATE(rf1.created_at, ?3, '-6 days', 'weekday 1')
             ),
             r AS (
                 SELECT rg.d, rg.c, rg.rf, (rg.rcost_sum / rg.n) AS rcost FROM rg
             )
             SELECT COALESCE(s.d, r.d) AS week_start,
                    COALESCE(s.c, r.c) AS currency,
                    COALESCE(s.t, 0) AS total_minor,
                    COALESCE(s.n, 0) AS sale_count,
                    COALESCE(s.cogs, 0) - COALESCE(r.rcost, 0) AS cogs_minor,
                    COALESCE(r.rf, 0) AS refund_minor,
                    COALESCE(s.t, 0) - COALESCE(r.rf, 0) AS net_revenue_minor
             FROM s FULL OUTER JOIN r ON s.d = r.d AND s.c = r.c
             ORDER BY week_start ASC";

/// The monthly revenue aggregation SQL (`YYYY-MM` buckets).
///
/// Returns one row per (store-local month, currency): gross revenue, sale
/// count, COGS net of refunded goods, refunds and net revenue.
///
/// Hoisted so the plan test reads the same text the product runs — see
/// [`DAILY_REVENUE_SQL`] for why the refunds side is nested and for the honest
/// limits of what that nesting buys.
pub const MONTHLY_REVENUE_SQL: &str = "WITH s AS (
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
             rg AS (
             -- The refunds aggregate is spelled as a nested CTE and joined
             -- back on (d, c) rather than carried inline. Measured with
             -- EXPLAIN QUERY PLAN over a seeded + ANALYZE'd database
             -- (2026-10-24): with the cost subquery inline, SQLite prices the
             -- correlated per-row lookup against the GROUP BY block and
             -- abandons idx_refunds_currency_created_date for a full scan of
             -- refunds; as its own block it plans the scan the index EXISTS
             -- for. The cost subquery is evaluated once per refund, so it
             -- divides by the group's row count.
                 SELECT strftime('%Y-%m', rf1.created_at, ?3) AS d, rf1.currency AS c,
                        SUM(rf1.total_minor) AS rf, COUNT(*) AS n,
                        SUM((SELECT COALESCE(SUM(COALESCE(sl3.cost_minor, p3.cost_minor, 0) * rl3.qty), 0)
                             FROM refund_lines rl3
                             JOIN refunds rf3 ON rf3.id = rl3.refund_id
                             LEFT JOIN sale_lines sl3 ON sl3.id = rl3.sale_line_id
                             LEFT JOIN products p3 ON sl3.sku = p3.sku
                             WHERE strftime('%Y-%m', rf3.created_at, ?3)
                                   = strftime('%Y-%m', rf1.created_at, ?3)
                               AND rf3.currency = rf1.currency)) AS rcost_sum
                 FROM refunds rf1
                 WHERE DATE(rf1.created_at, ?3) BETWEEN ?1 AND ?2
                 GROUP BY rf1.currency, strftime('%Y-%m', rf1.created_at, ?3)
             ),
             r AS (
                 SELECT rg.d, rg.c, rg.rf, (rg.rcost_sum / rg.n) AS rcost FROM rg
             )
             SELECT COALESCE(s.d, r.d) AS month,
                    COALESCE(s.c, r.c) AS currency,
                    COALESCE(s.t, 0) AS total_minor,
                    COALESCE(s.n, 0) AS sale_count,
                    COALESCE(s.cogs, 0) - COALESCE(r.rcost, 0) AS cogs_minor,
                    COALESCE(r.rf, 0) AS refund_minor,
                    COALESCE(s.t, 0) - COALESCE(r.rf, 0) AS net_revenue_minor
             FROM s FULL OUTER JOIN r ON s.d = r.d AND s.c = r.c
             ORDER BY month ASC";

impl Store<'_> {
    /// Map the shared revenue/COGS columns of the aggregation rows.
    fn revenue_profit_fields(row: &rusqlite::Row<'_>) -> rusqlite::Result<(i64, i64, i64, f64)> {
        let total_minor: i64 = row.get("total_minor")?;
        let cogs_minor: i64 = row.get("cogs_minor")?;
        // REP-08: profit is measured against NET revenue, not gross. Both terms
        // are already refund-adjusted -- `cogs_minor` has the returned goods'
        // cost removed by the query, and `refund_minor` is their revenue -- so
        // using the gross total here would add the refund back exactly once and
        // overstate profit on any day containing a refund. Net revenue is
        // gross - refunds, and the margin denominator matches the numerator.
        let refund_minor: i64 = row.get("refund_minor")?;
        let net_revenue_minor = total_minor - refund_minor;
        let gross_profit_minor = net_revenue_minor - cogs_minor;
        let gross_margin_percent = if net_revenue_minor > 0 {
            gross_profit_minor as f64 / net_revenue_minor as f64 * 100.0
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
        let mut stmt = self.conn.prepare(DAILY_REVENUE_SQL)?;
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
        let mut stmt = self.conn.prepare(WEEKLY_REVENUE_SQL)?;
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
        let mut stmt = self.conn.prepare(MONTHLY_REVENUE_SQL)?;
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
