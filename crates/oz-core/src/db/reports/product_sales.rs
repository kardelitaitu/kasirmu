//! Product- and category-level sales breakdowns, plus the stock
//! visibility queries that sit in the reporting module: top products,
//! category split, low-stock alerts and alert events, and the
//! inventory turnover/trend snapshots.
//!
//! The row shapes are REP-05 identity-snapshot aware (sale-line snapshot
//! first, `products` join as legacy fallback) and REP-06 per-currency.
//! Time-bucketed revenue aggregation is in [`super::revenue`]; the
//! operational rollups (voids, baskets, discounts, table activity) are in
//! [`super::sales_summary`].
//!
//! Split from `db/reports.rs` 13-09-26, behaviour unchanged — pure module
//! decomposition, no logic edits.

use rusqlite::params;

use crate::db::Store;
use crate::error::CoreError;

use super::check_date_bound;

/// Top product ranking.
#[derive(Debug, Clone, serde::Serialize)]
pub struct TopProductRow {
    /// ISO-4217 currency code (REP-06: rows are per product AND currency —
    /// minor units must never be summed across currencies).
    pub currency: String,
    /// Product unique identifier.
    pub product_id: String,
    /// Product SKU.
    pub sku: String,
    /// Product display name.
    pub name: String,
    /// Total quantity sold.
    pub total_qty: i64,
    /// Total revenue in minor units.
    pub total_minor: i64,
    /// Cost of goods sold in minor units (snapshotted sale-line cost,
    /// falling back to the product's current cost).
    pub cogs_minor: i64,
    /// Gross profit in minor units: revenue − COGS.
    pub gross_profit_minor: i64,
    /// Gross margin as a percentage of revenue; 0.0 when revenue is 0.
    pub gross_margin_percent: f64,
}

/// Low-stock alert.
#[derive(Debug, Clone, serde::Serialize)]
pub struct LowStockAlert {
    /// Product unique identifier.
    pub product_id: String,
    /// Product SKU.
    pub sku: String,
    /// Product display name.
    pub name: String,
    /// Current inventory quantity.
    pub current_qty: i64,
    /// Low-stock threshold that triggered the alert.
    pub threshold: i64,
    /// Product currency code.
    pub currency: String,
    /// Product selling price per unit in minor units.
    pub price_minor: i64,
    /// Product cost (HPP) per unit in minor units.
    pub cost_minor: i64,
}

/// A row from the `stock_alert_events` table (ADR-18 §9e).
#[derive(Debug, Clone, serde::Serialize)]
pub struct StockAlertEvent {
    /// Unique event ID.
    pub id: String,
    /// FK to `stock_thresholds.id`.
    pub threshold_id: String,
    /// The affected product ID.
    pub product_id: String,
    /// The affected location ID.
    pub location_id: String,
    /// Current stock at time of event.
    pub current_qty: i64,
    /// Threshold that was breached.
    pub threshold: i64,
    /// One of 'active', 'acknowledged', 'resolved'.
    pub status: String,
    /// ISO-8601 timestamp when the alert was triggered.
    pub triggered_at: String,
    /// ISO-8601 timestamp when the alert was acknowledged (nullable).
    pub acknowledged_at: Option<String>,
    /// ISO-8601 timestamp when the alert was resolved (nullable).
    pub resolved_at: Option<String>,
    /// User ID who acknowledged the alert (nullable).
    pub acknowledged_by: Option<String>,
    /// Product SKU (empty string if product deleted).
    pub product_sku: String,
    /// Product display name (empty string if product deleted).
    pub product_name: String,
}

/// Category sales breakdown.
#[derive(Debug, Clone, serde::Serialize)]
pub struct CategoryBreakdownRow {
    /// ISO-4217 currency code (REP-06: one row per category AND currency;
    /// `percentage` normalizes within the currency).
    pub currency: String,
    /// Category id (None for uncategorised products).
    pub category_id: Option<String>,
    /// Category display name.
    pub category_name: String,
    /// Total revenue in minor units.
    pub total_minor: i64,
    /// Number of distinct sales that included this category.
    pub sale_count: i64,
    /// Percentage of grand total revenue (0.0–100.0).
    pub percentage: f64,
}

/// Stock-turnover snapshot for a date range at one location.
#[derive(Debug, Clone, serde::Serialize)]
pub struct InventoryTurnoverRow {
    /// Units sold across completed sales in the range.
    pub units_sold: i64,
    /// Units on hand at the location (from `stock_summary`).
    pub stock_on_hand: i64,
    /// Number of catalog products.
    pub sku_count: i64,
    /// Length of the queried range in days (inclusive).
    pub range_days: i64,
}

/// Units sold per day for a date range (inventory trend line).
#[derive(Debug, Clone, serde::Serialize)]
pub struct InventoryTrendRow {
    /// ISO date `YYYY-MM-DD`.
    pub date: String,
    /// Units sold that day.
    pub units_sold: i64,
}

impl Store<'_> {
    /// Top products ranked by `order_by` (`"revenue"` or `"profit"`) for a
    /// date range. Unknown values fall back to revenue ranking.
    pub fn top_products(
        &self,
        start_date: &str,
        end_date: &str,
        limit: i64,
        order_by: &str,
    ) -> Result<Vec<TopProductRow>, CoreError> {
        // REP-03: the range filter is evaluated in store-local dates.
        check_date_bound("start_date", start_date)?;
        check_date_bound("end_date", end_date)?;
        let tz = self.tz_modifier();
        let order_clause = if order_by == "profit" {
            "gross_profit_minor DESC"
        } else {
            "total_minor DESC"
        };
        let mut stmt = self.conn.prepare(&format!(
            // REP-05: identity comes from the sale-line snapshot first; the
            // products join is only a fallback for legacy NULL rows. Grouping
            // by the resolved id/name keeps each sale era of a reused sku on
            // its own correctly-labelled row instead of relabelling history.
            "SELECT COALESCE(sl.product_id, p.id, sl.sku) AS product_id,
                    sl.sku AS sku,
                    COALESCE(sl.product_name, p.name, sl.sku) AS name,
                    sl.currency AS currency,
                    SUM(sl.qty) AS total_qty,
                    SUM(sl.line_minor) AS total_minor,
                    SUM(COALESCE(sl.cost_minor, p.cost_minor, 0) * sl.qty) AS cogs_minor,
                    (SUM(sl.line_minor) - SUM(COALESCE(sl.cost_minor, p.cost_minor, 0) * sl.qty)) AS gross_profit_minor
             FROM sale_lines sl
             JOIN sales s ON sl.sale_id = s.id
             LEFT JOIN products p ON sl.sku = p.sku
             WHERE s.status = 'completed' AND DATE(s.created_at, ?4) BETWEEN ?1 AND ?2
             GROUP BY sl.sku, sl.currency,
                      COALESCE(sl.product_id, p.id, sl.sku),
                      COALESCE(sl.product_name, p.name, sl.sku)
             ORDER BY {order_clause}, sl.sku
             LIMIT ?3"
        ))?;
        let rows = stmt.query_map(params![start_date, end_date, limit, tz], |row| {
            let total_minor = row.get::<_, i64>("total_minor")?;
            let cogs_minor = row.get::<_, i64>("cogs_minor")?;
            let gross_profit_minor = row.get::<_, i64>("gross_profit_minor")?;
            Ok(TopProductRow {
                currency: row.get("currency")?,
                product_id: row.get("product_id")?,
                sku: row.get("sku")?,
                name: row.get("name")?,
                total_qty: row.get("total_qty")?,
                total_minor,
                cogs_minor,
                gross_profit_minor,
                gross_margin_percent: if total_minor > 0 {
                    (gross_profit_minor as f64 / total_minor as f64) * 100.0
                } else {
                    0.0
                },
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    /// Products whose current stock is at or below `threshold`.
    ///
    /// **Deprecated in favour of `low_stock_alerts_at_location`
    /// (Self::low_stock_alerts_at_location)**, which respects the
    /// per-location stock from `stock_summary`.
    #[deprecated(note = "use low_stock_alerts_at_location instead")]
    pub fn low_stock_alerts(&self, threshold: i64) -> Result<Vec<LowStockAlert>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT p.id AS product_id, p.sku, p.name, p.currency,
                    p.price_minor, p.cost_minor,
                    COALESCE(i.qty, 0) AS current_qty,
                    ?1 AS threshold
             FROM products p
             LEFT JOIN inventory i ON p.id = i.product_id
             WHERE COALESCE(i.qty, 0) <= ?1
             ORDER BY current_qty ASC",
        )?;
        let rows = stmt.query_map(params![threshold], |row| {
            Ok(LowStockAlert {
                product_id: row.get("product_id")?,
                sku: row.get("sku")?,
                name: row.get("name")?,
                current_qty: row.get("current_qty")?,
                threshold: row.get("threshold")?,
                currency: row.get("currency")?,
                price_minor: row.get("price_minor")?,
                cost_minor: row.get("cost_minor")?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    /// Per-location low-stock alerts using `stock_summary`.
    ///
    /// For each product at the given location, if the current qty from
    /// `stock_summary` is ≤ `default_threshold` AND no custom threshold
    /// (product+location or product+global) is configured, the row appears
    /// with the `default_threshold` value. If a custom threshold is
    /// configured, that threshold is used instead.
    pub fn low_stock_alerts_at_location(
        &self,
        location_id: &str,
        default_threshold: i64,
    ) -> Result<Vec<LowStockAlert>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT p.id AS product_id, p.sku, p.name, p.currency,
                    p.price_minor, p.cost_minor,
                    COALESCE(ss.qty, 0) AS current_qty,
                    COALESCE(
                        (SELECT st.threshold FROM stock_thresholds st
                         WHERE st.product_id = p.id
                           AND st.location_id = ?1 AND st.enabled = 1
                         LIMIT 1),
                        (SELECT st.threshold FROM stock_thresholds st
                         WHERE st.product_id = p.id
                           AND st.location_id IS NULL AND st.enabled = 1
                         LIMIT 1),
                        ?2
                    ) AS threshold
             FROM products p
             LEFT JOIN stock_summary ss
                ON ss.item_id = p.id AND ss.location_id = ?1
             WHERE COALESCE(ss.qty, 0) <= ?2
                OR (SELECT 1 FROM stock_thresholds st
                    WHERE st.product_id = p.id
                      AND (st.location_id = ?1 OR st.location_id IS NULL)
                      AND st.enabled = 1
                      AND COALESCE(ss.qty, 0) <= st.threshold
                    LIMIT 1) = 1
             ORDER BY current_qty ASC",
        )?;
        let rows = stmt.query_map(params![location_id, default_threshold], |row| {
            Ok(LowStockAlert {
                product_id: row.get("product_id")?,
                sku: row.get("sku")?,
                name: row.get("name")?,
                current_qty: row.get("current_qty")?,
                threshold: row.get("threshold")?,
                currency: row.get("currency")?,
                price_minor: row.get("price_minor")?,
                cost_minor: row.get("cost_minor")?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    /// Active (non-resolved) stock alert events for a location, enriched
    /// with product SKU and name.
    ///
    /// Returns rows from `stock_alert_events` LEFT JOINed with `products`,
    /// where `status` is 'active' or 'acknowledged', filtered by
    /// `location_id`, ordered by `triggered_at DESC`.
    pub fn active_stock_alerts(
        &self,
        location_id: &str,
    ) -> Result<Vec<StockAlertEvent>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT sae.id, sae.threshold_id, sae.product_id, sae.location_id,
                    sae.current_qty, sae.threshold, sae.status,
                    sae.triggered_at, sae.acknowledged_at, sae.resolved_at,
                    sae.acknowledged_by,
                    COALESCE(p.sku, '') AS product_sku,
                    COALESCE(p.name, '') AS product_name
             FROM stock_alert_events sae
             LEFT JOIN products p ON sae.product_id = p.id
             WHERE sae.location_id = ?1 AND sae.status IN ('active', 'acknowledged')
             ORDER BY sae.triggered_at DESC",
        )?;
        let rows = stmt.query_map(params![location_id], |row| {
            Ok(StockAlertEvent {
                id: row.get("id")?,
                threshold_id: row.get("threshold_id")?,
                product_id: row.get("product_id")?,
                location_id: row.get("location_id")?,
                current_qty: row.get("current_qty")?,
                threshold: row.get("threshold")?,
                status: row.get("status")?,
                triggered_at: row.get("triggered_at")?,
                acknowledged_at: row.get("acknowledged_at")?,
                resolved_at: row.get("resolved_at")?,
                acknowledged_by: row.get("acknowledged_by")?,
                product_sku: row.get("product_sku")?,
                product_name: row.get("product_name")?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    /// Acknowledge a stock alert event — records who acknowledged it and
    /// transitions the status from `active` to `acknowledged`.
    ///
    /// Only `active` alerts can be acknowledged; already-`acknowledged` or
    /// `resolved` alerts are left unchanged silently.
    pub fn acknowledge_stock_alert(&self, alert_id: &str, user_id: &str) -> Result<(), CoreError> {
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let affected = self.conn.execute(
            "UPDATE stock_alert_events
             SET status = 'acknowledged', acknowledged_at = ?1, acknowledged_by = ?2
             WHERE id = ?3 AND status = 'active'",
            params![now, user_id, alert_id],
        )?;
        if affected == 0 {
            return Err(CoreError::NotFound {
                entity: "active_stock_alert",
                id: alert_id.to_owned(),
            });
        }
        Ok(())
    }

    /// Revenue breakdown by product category for a date range.
    ///
    /// Each row includes a `percentage` field relative to the grand total
    /// across all categories in the queried period.
    pub fn category_breakdown(
        &self,
        start_date: &str,
        end_date: &str,
    ) -> Result<Vec<CategoryBreakdownRow>, CoreError> {
        // REP-03: range filter in store-local dates.
        check_date_bound("start_date", start_date)?;
        check_date_bound("end_date", end_date)?;
        let tz = self.tz_modifier();
        let mut stmt = self.conn.prepare(
            // REP-05: the category is resolved from the sale-line snapshot
            // first, so moving a product between categories after the sale
            // no longer relabels (or moves) historical revenue. Legacy NULL
            // rows fall back to the products join.
            "SELECT COALESCE(sl.category_id, p.category_id) AS category_id,
                    COALESCE(c.name, 'Uncategorised') AS category_name,
                    sl.currency AS currency,
                    SUM(sl.line_minor) AS total_minor,
                    COUNT(DISTINCT s.id) AS sale_count
             FROM sale_lines sl
             JOIN sales s ON sl.sale_id = s.id
             LEFT JOIN products p ON sl.sku = p.sku
             LEFT JOIN categories c ON c.id = COALESCE(sl.category_id, p.category_id)
             WHERE s.status = 'completed' AND DATE(s.created_at, ?3) BETWEEN ?1 AND ?2
             GROUP BY COALESCE(sl.category_id, p.category_id), sl.currency
             ORDER BY sl.currency, total_minor DESC",
        )?;
        let mut rows: Vec<CategoryBreakdownRow> = stmt
            .query_map(params![start_date, end_date, tz], |row| {
                Ok(CategoryBreakdownRow {
                    currency: row.get("currency")?,
                    category_id: row.get("category_id")?,
                    category_name: row.get("category_name")?,
                    total_minor: row.get("total_minor")?,
                    sale_count: row.get("sale_count")?,
                    percentage: 0.0,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        // REP-06: percentages normalize WITHIN each currency — a share of
        // the grand total summed across currencies is meaningless.
        let mut totals: std::collections::HashMap<String, i64> = std::collections::HashMap::new();
        for row in &rows {
            *totals.entry(row.currency.clone()).or_insert(0) += row.total_minor;
        }
        for row in &mut rows {
            let grand = totals.get(&row.currency).copied().unwrap_or(0);
            if grand > 0 {
                row.percentage = (row.total_minor as f64 / grand as f64) * 100.0;
            }
        }

        Ok(rows)
    }

    /// Stock-turnover snapshot for a date range at one location: units sold
    /// over the period vs stock on hand, plus the catalog size.
    pub fn inventory_turnover(
        &self,
        start_date: &str,
        end_date: &str,
        location_id: &str,
    ) -> Result<InventoryTurnoverRow, CoreError> {
        // REP-03: units-sold window is store-local; `?3` stays the location.
        check_date_bound("start_date", start_date)?;
        check_date_bound("end_date", end_date)?;
        let tz = self.tz_modifier();
        let row = self.conn.query_row(
            "SELECT
                (SELECT COALESCE(SUM(sl.qty), 0) FROM sale_lines sl
                 JOIN sales s ON sl.sale_id = s.id
                 WHERE s.status = 'completed' AND DATE(s.created_at, ?4) BETWEEN ?1 AND ?2)
                    AS units_sold,
                (SELECT COALESCE(SUM(COALESCE(qty, 0)), 0) FROM stock_summary
                 WHERE location_id = ?3) AS stock_on_hand,
                (SELECT COUNT(*) FROM products) AS sku_count",
            params![start_date, end_date, location_id, tz],
            |row| {
                Ok(InventoryTurnoverRow {
                    units_sold: row.get("units_sold")?,
                    stock_on_hand: row.get("stock_on_hand")?,
                    sku_count: row.get("sku_count")?,
                    range_days: 0,
                })
            },
        )?;
        Ok(InventoryTurnoverRow {
            range_days: Self::inclusive_range_days(start_date, end_date),
            ..row
        })
    }

    /// Units sold per day for a date range (the inventory trend line).
    pub fn inventory_trend(
        &self,
        start_date: &str,
        end_date: &str,
    ) -> Result<Vec<InventoryTrendRow>, CoreError> {
        // REP-03: day buckets in store-local dates.
        check_date_bound("start_date", start_date)?;
        check_date_bound("end_date", end_date)?;
        let tz = self.tz_modifier();
        let mut stmt = self.conn.prepare(
            "SELECT DATE(s.created_at, ?3) AS date,
                    COALESCE(SUM(sl.qty), 0) AS units_sold
             FROM sale_lines sl
             JOIN sales s ON sl.sale_id = s.id
             WHERE s.status = 'completed' AND DATE(s.created_at, ?3) BETWEEN ?1 AND ?2
             GROUP BY DATE(s.created_at, ?3)
             ORDER BY date ASC",
        )?;
        let rows = stmt.query_map(params![start_date, end_date, tz], |row| {
            Ok(InventoryTrendRow {
                date: row.get("date")?,
                units_sold: row.get("units_sold")?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    /// Inclusive day count of a `YYYY-MM-DD` range (0 when unparseable).
    fn inclusive_range_days(start_date: &str, end_date: &str) -> i64 {
        let (Ok(start), Ok(end)) = (
            chrono::NaiveDate::parse_from_str(start_date, "%Y-%m-%d"),
            chrono::NaiveDate::parse_from_str(end_date, "%Y-%m-%d"),
        ) else {
            return 0;
        };
        (end - start).num_days() + 1
    }
}
