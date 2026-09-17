//! Operational sales rollups: heatmap, tender split, voids, baskets,
//! customer mix, discounts, and table activity.
//!
//! The date-range aggregate queries that describe HOW a period traded —
//! hourly demand shape (REP-03 store-local), payment-method tender split,
//! voided-sale totals and lines (REP-06 per-currency), basket size and
//! trend, new-vs-returning customer mix, discount redemption, and the
//! restaurant table-turnover / hourly-occupancy curves. Time-bucketed
//! revenue aggregation is in [`super::revenue`]; product/category/stock
//! queries are in [`super::product_sales`].
//!
//! Split from `db/reports.rs` 13-09-26, behaviour unchanged — pure module
//! decomposition, no logic edits.

use rusqlite::params;

use crate::db::Store;
use crate::error::CoreError;

use super::check_date_bound;

/// Hourly sales heatmap entry.
#[derive(Debug, Clone, serde::Serialize)]
pub struct HourlyHeatmapRow {
    /// ISO-4217 currency code (REP-06: one row per cell AND currency).
    pub currency: String,
    /// Day of week (0=Sunday, 1=Monday, ...).
    pub day_of_week: i64,
    /// Hour of day (0–23).
    pub hour: i64,
    /// Total revenue in minor units.
    pub total_minor: i64,
    /// Number of completed sales in this time slot.
    pub sale_count: i64,
}

/// Sales revenue split by payment method for a date range.
#[derive(Debug, Clone, serde::Serialize)]
pub struct PaymentMethodRow {
    /// ISO-4217 currency code (REP-06: one row per method AND currency).
    pub currency: String,
    /// Payment method key (`cash`, `card`, `qris`, `ewallet`, … or `other`).
    pub payment_method: String,
    /// Total revenue in minor units.
    pub total_minor: i64,
    /// Number of completed sales paid this way.
    pub sale_count: i64,
}

/// Voided-sale totals for a date range.
#[derive(Debug, Clone, serde::Serialize)]
pub struct VoidedSummaryRow {
    /// ISO-4217 currency code (REP-06: one row per currency; the old
    /// single-row shape summed void totals across currencies).
    pub currency: String,
    /// Number of voided sales.
    pub void_count: i64,
    /// Sum of the voided sales' totals in minor units.
    pub void_total_minor: i64,
}

/// One product line found on voided sales.
#[derive(Debug, Clone, serde::Serialize)]
pub struct VoidedItemRow {
    /// Product display name (SKU fallback for deleted products).
    pub name: String,
    /// Total quantity voided.
    pub qty: i64,
}

/// Average basket size for a date range.
#[derive(Debug, Clone, serde::Serialize)]
pub struct BasketSizeRow {
    /// Number of completed sales.
    pub sale_count: i64,
    /// Mean `line_count` across those sales (0.0 when no sales).
    pub avg_line_count: f64,
}

/// Basket size (mean line count) per day within a date range — the raw
/// per-bucket shape behind the analytics basket-size trend card.
#[derive(Debug, Clone, serde::Serialize)]
pub struct BasketTrendRow {
    /// ISO date `YYYY-MM-DD`.
    pub date: String,
    /// Completed sales that day.
    pub sale_count: i64,
    /// Mean `line_count` across that day's completed sales.
    pub avg_line_count: f64,
}

/// New vs returning customers for a date range.
///
/// A customer is "returning" when they have a completed sale before the
/// range start; otherwise the range visit counts them as new.
#[derive(Debug, Clone, serde::Serialize)]
pub struct CustomerSplitRow {
    /// Distinct customers whose first completed sale falls inside the range.
    pub new_count: i64,
    /// Distinct customers with a completed sale inside the range who had
    /// one before it.
    pub returning_count: i64,
}

/// One discount code's redemption count within a date range.
#[derive(Debug, Clone, serde::Serialize)]
pub struct DiscountCodeRow {
    /// Discount label (empty label → `discount`).
    pub label: String,
    /// Completed sales using this discount.
    pub redeemed_count: i64,
}

/// Discount usage summary for a date range.
#[derive(Debug, Clone, serde::Serialize)]
pub struct DiscountsSummaryRow {
    /// Completed sales in the range.
    pub sale_count: i64,
    /// Completed sales that applied any discount.
    pub discounted_sale_count: i64,
    /// `discounted_sale_count / sale_count` as a percentage (0.0 when none).
    pub share_percent: f64,
    /// Top discount codes by redemption count.
    pub codes: Vec<DiscountCodeRow>,
}

/// Completed table-bound orders per day (restaurant table-turnover source).
#[derive(Debug, Clone, serde::Serialize)]
pub struct TableTurnoverRow {
    /// ISO date `YYYY-MM-DD`.
    pub date: String,
    /// Completed sales linked to a KDS order carrying a table number.
    pub table_orders: i64,
}

/// Completed table-bound orders per hour of day (0–23) — the real shape
/// behind the restaurant occupancy curve.
#[derive(Debug, Clone, serde::Serialize)]
pub struct HourlyOccupancyRow {
    /// Hour of day (0–23, local store time as stored in `created_at`).
    pub hour: i64,
    /// Completed sales linked to a KDS order carrying a table number.
    pub table_orders: i64,
}

impl Store<'_> {
    /// Hourly sales heatmap for a date range.
    pub fn hourly_heatmap(
        &self,
        start_date: &str,
        end_date: &str,
    ) -> Result<Vec<HourlyHeatmapRow>, CoreError> {
        // REP-03: day-of-week and hour cells are store-local.
        check_date_bound("start_date", start_date)?;
        check_date_bound("end_date", end_date)?;
        let tz = self.tz_modifier();
        let mut stmt = self.conn.prepare(
            "SELECT CAST(strftime('%w', created_at, ?3) AS INTEGER) AS day_of_week,
                    CAST(strftime('%H', created_at, ?3) AS INTEGER) AS hour,
                    currency,
                    SUM(total_minor) AS total_minor,
                    COUNT(*) AS sale_count
             FROM sales
             WHERE status = 'completed' AND DATE(created_at, ?3) BETWEEN ?1 AND ?2
             GROUP BY day_of_week, hour, currency
             ORDER BY day_of_week, hour",
        )?;
        let rows = stmt.query_map(params![start_date, end_date, tz], |row| {
            Ok(HourlyHeatmapRow {
                currency: row.get("currency")?,
                day_of_week: row.get("day_of_week")?,
                hour: row.get("hour")?,
                total_minor: row.get("total_minor")?,
                sale_count: row.get("sale_count")?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    /// Revenue split by payment method for a date range.
    pub fn payment_method_breakdown(
        &self,
        start_date: &str,
        end_date: &str,
    ) -> Result<Vec<PaymentMethodRow>, CoreError> {
        // REP-03: range filter in store-local dates.
        check_date_bound("start_date", start_date)?;
        check_date_bound("end_date", end_date)?;
        let tz = self.tz_modifier();
        let mut stmt = self.conn.prepare(
            "SELECT COALESCE(payment_method, 'other') AS payment_method,
                    currency,
                    SUM(total_minor) AS total_minor,
                    COUNT(*) AS sale_count
             FROM sales
             WHERE status = 'completed' AND DATE(created_at, ?3) BETWEEN ?1 AND ?2
             GROUP BY payment_method, currency
             ORDER BY currency, total_minor DESC",
        )?;
        let rows = stmt.query_map(params![start_date, end_date, tz], |row| {
            Ok(PaymentMethodRow {
                currency: row.get("currency")?,
                payment_method: row.get("payment_method")?,
                total_minor: row.get("total_minor")?,
                sale_count: row.get("sale_count")?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    /// Voided-sale totals for a date range, one row per currency (REP-06).
    pub fn voided_sales_summary(
        &self,
        start_date: &str,
        end_date: &str,
    ) -> Result<Vec<VoidedSummaryRow>, CoreError> {
        // REP-03: range filter in store-local dates.
        check_date_bound("start_date", start_date)?;
        check_date_bound("end_date", end_date)?;
        let tz = self.tz_modifier();
        let mut stmt = self.conn.prepare(
            "SELECT currency,
                    COUNT(*) AS void_count,
                    COALESCE(SUM(total_minor), 0) AS void_total_minor
             FROM sales
             WHERE status = 'voided' AND DATE(created_at, ?3) BETWEEN ?1 AND ?2
             GROUP BY currency
             ORDER BY currency",
        )?;
        let rows = stmt.query_map(params![start_date, end_date, tz], |row| {
            Ok(VoidedSummaryRow {
                currency: row.get("currency")?,
                void_count: row.get("void_count")?,
                void_total_minor: row.get("void_total_minor")?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    /// Top product lines found on voided sales for a date range.
    pub fn voided_items(
        &self,
        start_date: &str,
        end_date: &str,
        limit: i64,
    ) -> Result<Vec<VoidedItemRow>, CoreError> {
        // REP-03: range filter in store-local dates.
        check_date_bound("start_date", start_date)?;
        check_date_bound("end_date", end_date)?;
        let tz = self.tz_modifier();
        let limit = limit.clamp(1, 100);
        let mut stmt = self.conn.prepare(
            "SELECT COALESCE(p.name, sl.sku) AS name, SUM(sl.qty) AS qty
             FROM sale_lines sl
             JOIN sales s ON sl.sale_id = s.id
             LEFT JOIN products p ON sl.sku = p.sku
             WHERE s.status = 'voided' AND DATE(s.created_at, ?4) BETWEEN ?1 AND ?2
             GROUP BY sl.sku
             ORDER BY qty DESC
             LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![start_date, end_date, limit, tz], |row| {
            Ok(VoidedItemRow {
                name: row.get("name")?,
                qty: row.get("qty")?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    /// Average basket size (mean line count) for a date range.
    pub fn avg_basket_size(
        &self,
        start_date: &str,
        end_date: &str,
    ) -> Result<BasketSizeRow, CoreError> {
        // REP-03: range filter in store-local dates.
        check_date_bound("start_date", start_date)?;
        check_date_bound("end_date", end_date)?;
        let tz = self.tz_modifier();
        let row = self.conn.query_row(
            "SELECT COUNT(*) AS sale_count,
                    COALESCE(AVG(line_count), 0) AS avg_line_count
             FROM sales
             WHERE status = 'completed' AND DATE(created_at, ?3) BETWEEN ?1 AND ?2",
            params![start_date, end_date, tz],
            |row| {
                Ok(BasketSizeRow {
                    sale_count: row.get("sale_count")?,
                    avg_line_count: row.get("avg_line_count")?,
                })
            },
        )?;
        Ok(row)
    }

    /// Per-day basket size (mean line count) for a date range.
    pub fn basket_size_trend(
        &self,
        start_date: &str,
        end_date: &str,
    ) -> Result<Vec<BasketTrendRow>, CoreError> {
        // REP-03: day buckets in store-local dates.
        check_date_bound("start_date", start_date)?;
        check_date_bound("end_date", end_date)?;
        let tz = self.tz_modifier();
        let mut stmt = self.conn.prepare(
            "SELECT DATE(created_at, ?3) AS date,
                    COUNT(*) AS sale_count,
                    COALESCE(AVG(line_count), 0) AS avg_line_count
             FROM sales
             WHERE status = 'completed' AND DATE(created_at, ?3) BETWEEN ?1 AND ?2
             GROUP BY DATE(created_at, ?3)
             ORDER BY date ASC",
        )?;
        let rows = stmt.query_map(params![start_date, end_date, tz], |row| {
            Ok(BasketTrendRow {
                date: row.get("date")?,
                sale_count: row.get("sale_count")?,
                avg_line_count: row.get("avg_line_count")?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    /// New vs returning customer counts for a date range.
    pub fn customer_split(
        &self,
        start_date: &str,
        end_date: &str,
    ) -> Result<CustomerSplitRow, CoreError> {
        // REP-03: "new vs returning" is decided on store-local days.
        check_date_bound("start_date", start_date)?;
        check_date_bound("end_date", end_date)?;
        let tz = self.tz_modifier();
        let row = self.conn.query_row(
            "WITH range_customers AS (
                SELECT DISTINCT customer_id FROM sales
                WHERE status = 'completed' AND customer_id IS NOT NULL
                  AND DATE(created_at, ?3) BETWEEN ?1 AND ?2
             )
             SELECT
                (SELECT COUNT(*) FROM range_customers rc
                 WHERE NOT EXISTS (
                   SELECT 1 FROM sales s
                   WHERE s.customer_id = rc.customer_id AND s.status = 'completed'
                     AND DATE(s.created_at, ?3) < ?1)) AS new_count,
                (SELECT COUNT(*) FROM range_customers rc
                 WHERE EXISTS (
                   SELECT 1 FROM sales s
                   WHERE s.customer_id = rc.customer_id AND s.status = 'completed'
                     AND DATE(s.created_at, ?3) < ?1)) AS returning_count",
            params![start_date, end_date, tz],
            |row| {
                Ok(CustomerSplitRow {
                    new_count: row.get("new_count")?,
                    returning_count: row.get("returning_count")?,
                })
            },
        )?;
        Ok(row)
    }

    /// Discount usage for a date range: share of discounted sales plus the
    /// most-redeemed discount codes.
    pub fn discounts_summary(
        &self,
        start_date: &str,
        end_date: &str,
    ) -> Result<DiscountsSummaryRow, CoreError> {
        // REP-03: range filter in store-local dates.
        check_date_bound("start_date", start_date)?;
        check_date_bound("end_date", end_date)?;
        let tz = self.tz_modifier();
        let (sale_count, discounted_sale_count): (i64, i64) = self.conn.query_row(
            "SELECT COUNT(*) AS sale_count,
                    COALESCE(SUM(CASE WHEN discount_percent > 0 THEN 1 ELSE 0 END), 0)
                        AS discounted_sale_count
             FROM sales
             WHERE status = 'completed' AND DATE(created_at, ?3) BETWEEN ?1 AND ?2",
            params![start_date, end_date, tz],
            |row| Ok((row.get("sale_count")?, row.get("discounted_sale_count")?)),
        )?;
        let mut stmt = self.conn.prepare(
            "SELECT COALESCE(NULLIF(discount_label, ''), 'discount') AS label,
                    COUNT(*) AS redeemed_count
             FROM sales
             WHERE status = 'completed' AND discount_percent > 0
               AND DATE(created_at, ?3) BETWEEN ?1 AND ?2
             GROUP BY discount_label
             ORDER BY redeemed_count DESC
             LIMIT 5",
        )?;
        let codes = stmt
            .query_map(params![start_date, end_date, tz], |row| {
                Ok(DiscountCodeRow {
                    label: row.get("label")?,
                    redeemed_count: row.get("redeemed_count")?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let share_percent = if sale_count > 0 {
            discounted_sale_count as f64 / sale_count as f64 * 100.0
        } else {
            0.0
        };
        Ok(DiscountsSummaryRow {
            sale_count,
            discounted_sale_count,
            share_percent,
            codes,
        })
    }

    /// Completed table-bound orders per day for a date range. Table service
    /// is tracked through KDS orders carrying a table number; each completed
    /// sale with one represents a single table turn (takeaway orders without
    /// a table number are excluded).
    pub fn table_turnover(
        &self,
        start_date: &str,
        end_date: &str,
    ) -> Result<Vec<TableTurnoverRow>, CoreError> {
        // REP-03: day buckets in store-local dates.
        check_date_bound("start_date", start_date)?;
        check_date_bound("end_date", end_date)?;
        let tz = self.tz_modifier();
        let mut stmt = self.conn.prepare(
            "SELECT DATE(s.created_at, ?3) AS date,
                    COUNT(*) AS table_orders
             FROM kds_orders k
             JOIN sales s ON k.sale_id = s.id
             WHERE s.status = 'completed'
               AND k.table_number IS NOT NULL AND k.table_number != ''
               AND DATE(s.created_at, ?3) BETWEEN ?1 AND ?2
             GROUP BY DATE(s.created_at, ?3)
             ORDER BY date ASC",
        )?;
        let rows = stmt.query_map(params![start_date, end_date, tz], |row| {
            Ok(TableTurnoverRow {
                date: row.get("date")?,
                table_orders: row.get("table_orders")?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    /// Completed table-bound orders grouped by hour of day (0–23) within a
    /// date range — the real signal behind the occupancy-by-hour curve.
    pub fn hourly_table_activity(
        &self,
        start_date: &str,
        end_date: &str,
    ) -> Result<Vec<HourlyOccupancyRow>, CoreError> {
        // REP-03: hour-of-day cells are store-local.
        check_date_bound("start_date", start_date)?;
        check_date_bound("end_date", end_date)?;
        let tz = self.tz_modifier();
        let mut stmt = self.conn.prepare(
            "SELECT CAST(strftime('%H', s.created_at, ?3) AS INTEGER) AS hour,
                    COUNT(*) AS table_orders
             FROM kds_orders k
             JOIN sales s ON k.sale_id = s.id
             WHERE s.status = 'completed'
               AND k.table_number IS NOT NULL AND k.table_number != ''
               AND DATE(s.created_at, ?3) BETWEEN ?1 AND ?2
             GROUP BY hour
             ORDER BY hour ASC",
        )?;
        let rows = stmt.query_map(params![start_date, end_date, tz], |row| {
            Ok(HourlyOccupancyRow {
                hour: row.get("hour")?,
                table_orders: row.get("table_orders")?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }
}
