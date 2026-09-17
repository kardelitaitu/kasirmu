/*
last audited 25-07-26 by RSA-Agent (oz-reporting slice A: verified)
crate: oz-reporting | status: SAFE | lint: CLEAN
findings: clean — parameterized queries, integer minor units, sibling tests per convention
next: none | perf: N/A
*/
//! Daily Sales Summary Analytics — count, revenue, average ticket, hourly
//! breakdown, and top products for a given date range.
//!
//! These queries are designed for offline-first operation: they run against
//! the local SQLite store and produce pre-aggregated results suitable for
//! dashboard widgets and CSV export.

use rusqlite::params;
use serde::{Deserialize, Serialize};

use oz_core::CoreError;

/// Daily sales summary row: one row per day in the range.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailySummaryRow {
    /// ISO date string (YYYY-MM-DD).
    pub date: String,
    /// Number of completed sales on this day.
    pub sale_count: i64,
    /// Total revenue (minor units) from completed sales.
    pub total_revenue_minor: i64,
    /// Average ticket size (minor units). 0 when no sales.
    pub avg_ticket_minor: i64,
    /// Number of unique customers with purchases on this day.
    pub unique_customers: i64,
}

/// Sales-by-hour breakdown for a specific day or range.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HourlySalesRow {
    /// Hour of day (0-23).
    pub hour: u8,
    /// Number of completed sales in this hour.
    pub sale_count: i64,
    /// Total revenue (minor units) in this hour.
    pub total_revenue_minor: i64,
}

/// Top product row for the product leaderboard.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopProductRow {
    /// Product SKU.
    pub sku: String,
    /// Product display name.
    pub name: String,
    /// Total quantity sold.
    pub total_qty: i64,
    /// Total revenue generated (minor units).
    pub total_revenue_minor: i64,
}

/// Complete daily summary result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailySummaryResult {
    /// Per-day summary rows, ordered by date ASC.
    pub daily: Vec<DailySummaryRow>,
    /// Grand totals across all days in the range.
    pub total_sales: i64,
    /// Grand total revenue across all days.
    pub total_revenue_minor: i64,
}

/// Query daily sales summary for a date range.
///
/// Returns one row per day with sale count, total revenue, average
/// ticket, and unique customer count.
pub fn query_daily_summary(
    conn: &rusqlite::Connection,
    start_date: &str,
    end_date: &str,
) -> Result<DailySummaryResult, CoreError> {
    let mut stmt = conn.prepare(
        "SELECT DATE(s.created_at) AS sale_date,
                COUNT(*) AS sale_count,
                COALESCE(SUM(s.total_minor), 0) AS total_revenue_minor,
                COUNT(DISTINCT s.customer_id) AS unique_customers
         FROM sales s
         WHERE s.status = 'completed'
           AND DATE(s.created_at) BETWEEN ?1 AND ?2
         GROUP BY sale_date
         ORDER BY sale_date ASC",
    )?;

    let rows: Vec<DailySummaryRow> = stmt
        .query_map(params![start_date, end_date], |row| {
            let count: i64 = row.get("sale_count")?;
            let revenue: i64 = row.get("total_revenue_minor")?;
            Ok(DailySummaryRow {
                date: row.get("sale_date")?,
                sale_count: count,
                total_revenue_minor: revenue,
                avg_ticket_minor: if count > 0 { revenue / count } else { 0 },
                unique_customers: row.get("unique_customers")?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let (total_sales, total_revenue_minor) = rows.iter().fold((0, 0), |(ts, tr), r| {
        (ts + r.sale_count, tr + r.total_revenue_minor)
    });

    Ok(DailySummaryResult {
        daily: rows,
        total_sales,
        total_revenue_minor,
    })
}

/// Query sales-by-hour breakdown for a date range.
///
/// Returns one row per hour (0-23) with sale count and revenue.
/// Hours with no sales are excluded.
pub fn query_sales_by_hour(
    conn: &rusqlite::Connection,
    start_date: &str,
    end_date: &str,
) -> Result<Vec<HourlySalesRow>, CoreError> {
    let mut stmt = conn.prepare(
        "SELECT CAST(strftime('%H', s.created_at) AS INTEGER) AS hour,
                COUNT(*) AS sale_count,
                COALESCE(SUM(s.total_minor), 0) AS total_revenue_minor
         FROM sales s
         WHERE s.status = 'completed'
           AND DATE(s.created_at) BETWEEN ?1 AND ?2
         GROUP BY hour
         ORDER BY hour ASC",
    )?;

    stmt.query_map(params![start_date, end_date], |row| {
        Ok(HourlySalesRow {
            hour: row.get::<_, i64>("hour")? as u8,
            sale_count: row.get("sale_count")?,
            total_revenue_minor: row.get("total_revenue_minor")?,
        })
    })?
    .collect::<Result<Vec<_>, _>>()
    .map_err(CoreError::from)
}

/// Query top N products by quantity sold in a date range.
pub fn query_top_products(
    conn: &rusqlite::Connection,
    start_date: &str,
    end_date: &str,
    limit: i64,
) -> Result<Vec<TopProductRow>, CoreError> {
    let mut stmt = conn.prepare(
        "SELECT p.sku,
                p.name,
                COALESCE(SUM(sl.qty), 0) AS total_qty,
                COALESCE(SUM(sl.line_minor), 0) AS total_revenue_minor
         FROM sale_lines sl
         JOIN sales s ON sl.sale_id = s.id
         JOIN products p ON sl.sku = p.sku
         WHERE s.status = 'completed'
           AND DATE(s.created_at) BETWEEN ?1 AND ?2
         GROUP BY p.sku
         ORDER BY total_qty DESC
         LIMIT ?3",
    )?;

    stmt.query_map(params![start_date, end_date, limit], |row| {
        Ok(TopProductRow {
            sku: row.get("sku")?,
            name: row.get("name")?,
            total_qty: row.get("total_qty")?,
            total_revenue_minor: row.get("total_revenue_minor")?,
        })
    })?
    .collect::<Result<Vec<_>, _>>()
    .map_err(CoreError::from)
}

#[cfg(test)]
#[path = "daily_summary_tests.rs"]
mod tests;
