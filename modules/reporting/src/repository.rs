/*
last audited 25-07-26 by RSA-Agent (modules-reporting slice A: repository deep read; MSL-7 FIXED 25-07-26)
crate: modules-reporting | status: SAFE | lint: CLEAN
findings: MSL-7 FIXED — generate_daily_report now queries SUM(tax_total_minor) (the real sales column; the previous SUM(tax_minor) failed at runtime with no-such-column on every call). Test ALTER TABLE shims removed; tests seed tax_total_minor directly and pass against the migrated schema. Live-table query correctly filters status = completed
next: strftime per row prevents index use (perf, INFO) | perf: see next
*/
//! Reporting Repository — database query layer for reports.

use crate::error::ReportingError;
use crate::models::DailyReport;
use foundation::{Currency, Money};
use rusqlite::Connection;

/// Database access repository for sales and inventory reports.
pub struct ReportingRepository<'a> {
    conn: &'a Connection,
}

impl<'a> ReportingRepository<'a> {
    /// Create a new `ReportingRepository`.
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    /// Generate daily report for date.
    pub fn generate_daily_report(&self, date: &str) -> Result<DailyReport, ReportingError> {
        // MSL-7 fix: the sales table column is `tax_total_minor` (the
        // per-line `tax_minor` lives on `sale_lines`); the previous
        // `SUM(tax_minor)` failed at runtime with "no such column" on
        // every call.
        // namespace: cross-vertical read sales granted (read-only daily sales aggregate; reporting owns no sales data and Phase 4 moves this behind a store read API)
        let mut stmt = self.conn.prepare(
            "SELECT COUNT(*), COALESCE(SUM(total_minor), 0), COALESCE(SUM(tax_total_minor), 0)
             FROM sales WHERE strftime('%Y-%m-%d', created_at) = ?1 AND status = 'completed'",
        )?;

        let mut rows = stmt.query([date])?;
        let (count, rev_minor, tax_minor): (i64, i64, i64) = if let Some(row) = rows.next()? {
            (row.get(0)?, row.get(1)?, row.get(2)?)
        } else {
            (0, 0, 0)
        };

        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        Ok(DailyReport {
            date: date.to_string(),
            total_sales_count: count,
            total_revenue: Money {
                minor_units: rev_minor,
                currency: Currency(*b"USD"),
            },
            total_tax: Money {
                minor_units: tax_minor,
                currency: Currency(*b"USD"),
            },
            generated_at: now,
        })
    }
}

#[cfg(test)]
#[path = "repository_tests.rs"]
mod tests;
