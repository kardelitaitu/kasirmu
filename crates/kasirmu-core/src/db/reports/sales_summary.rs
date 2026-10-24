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

/// The table-activity source shared by both turnover rollups: completed sales
/// that carry a table number, counted per SALE.
///
/// `kds_orders` is unique on `(sale_id, kitchen_zone)`, so a sale routed to two
/// kitchen zones has two tickets; `COUNT(*)` over them would report one party at
/// one table as two turns. The `DISTINCT` and the predicate stay together here
/// because two hand-copied versions drifting apart is what produced that bug
/// twice.
const TABLE_TURN_SOURCE: &str = "FROM kds_orders k
             JOIN sales s ON k.sale_id = s.id
             WHERE s.status = 'completed'
               AND k.table_number IS NOT NULL AND k.table_number != ''
               AND DATE(s.created_at, ?3) BETWEEN ?1 AND ?2";

// ── Hoisted SQL ───────────────────────────────────────────────────────
//
// `sales` grows with every order and `sale_lines` with every line, so a lost
// index seek in these rollups is paid on every dashboard load for the life of
// the install. The static text of the three readers below is hoisted to `pub`
// constants for the same reason as `DAILY_REVENUE_SQL`
// (`db/reports/revenue.rs`): the query-plan probe
// (`tests/integration/query_plan_probe.rs`) is a SEPARATE crate, so it can
// only import `pub` items, and a probe that holds its own COPY of a query
// stays green when the real one is reshaped back into the scanning form.
// `db/reports.rs` re-exports each constant next to the revenue triple, which
// is the path the probe imports.
//
// Purely textual: each method prepares exactly the string it did before, and
// the continuation indentation inside each literal is the original one - the
// text is relocated, not re-indented. Each literal is multi-line, so every
// constant carries `#[rustfmt::skip]`: rustfmt re-indents a multi-line
// literal's continuation lines, which would silently rewrite the text under
// test (see the note on `LIST_AUDIT_ENTRIES_SQL` in `db/audit.rs`).

/// `Store::hourly_heatmap`: completed sales per (store-local weekday, hour,
/// currency) cell.
///
/// `#[rustfmt::skip]` is load-bearing: rustfmt would re-indent the literal's
/// continuation lines and change the text the product prepares.
#[rustfmt::skip]
pub const HOURLY_HEATMAP_SQL: &str = "SELECT CAST(strftime('%w', created_at, ?3) AS INTEGER) AS day_of_week,
                    CAST(strftime('%H', created_at, ?3) AS INTEGER) AS hour,
                    currency,
                    SUM(total_minor) AS total_minor,
                    COUNT(*) AS sale_count
             FROM sales
             WHERE status = 'completed' AND DATE(created_at, ?3) BETWEEN ?1 AND ?2
             GROUP BY day_of_week, hour, currency
             ORDER BY day_of_week, hour";

/// `Store::payment_method_breakdown`: tender split per currency.
///
/// `#[rustfmt::skip]` for the same reason as [`HOURLY_HEATMAP_SQL`].
#[rustfmt::skip]
pub const PAYMENT_METHOD_BREAKDOWN_SQL: &str = "SELECT COALESCE(payment_method, 'other') AS payment_method,
                    currency,
                    SUM(total_minor) AS total_minor,
                    COUNT(*) AS sale_count
             FROM sales
             WHERE status = 'completed' AND DATE(created_at, ?3) BETWEEN ?1 AND ?2
             GROUP BY payment_method, currency
             ORDER BY currency, total_minor DESC";

/// `Store::piutang_collections`: receivable repayments collected in a date range,
/// split by the tender the money actually arrived in.
///
/// THE MISSING HALF OF DECISION Q1. The plan's ruling is that a piutang sale records
/// `method='pay_later'` on the sale day and a settlement record with the ACTUAL tender
/// on the collection day, so money appears as cash on the day it is received and the
/// drawer reconciles on both days. `receivable_payments` carries that tender (its own
/// column comment says so), but until this query existed NOTHING read it: the sale day
/// was correct and the collection day was invisible, so a day whose only takings were
/// repayments reported nothing.
///
/// `#[rustfmt::skip]` for the same reason as [`HOURLY_HEATMAP_SQL`].
#[rustfmt::skip]
pub const PIUTANG_COLLECTIONS_SQL: &str = "SELECT rp.method AS payment_method,
                    rp.currency AS currency,
                    SUM(rp.amount_minor) AS total_minor,
                    COUNT(*) AS payment_count
             FROM receivable_payments rp
             WHERE DATE(rp.paid_at, ?3) BETWEEN ?1 AND ?2
             GROUP BY rp.method, rp.currency
             ORDER BY rp.currency, total_minor DESC";

/// One tender's takings from receivable repayments in a date range.
#[derive(Debug, Clone, serde::Serialize)]
pub struct PiutangCollectionRow {
    /// ISO-4217 currency code (REP-06: one row per tender AND currency).
    pub currency: String,
    /// The tender the money arrived in (`cash`, `bank_transfer`, `qris`, ...).
    pub payment_method: String,
    /// Total collected in minor units.
    pub total_minor: i64,
    /// Number of repayments recorded this way.
    pub payment_count: i64,
}
/// `Store::voided_items`: the most-voided product lines in a date range.
///
/// `#[rustfmt::skip]` for the same reason as [`HOURLY_HEATMAP_SQL`].
#[rustfmt::skip]
pub const VOIDED_ITEMS_SQL: &str = "SELECT COALESCE(p.name, sl.sku) AS name, SUM(sl.qty) AS qty
             FROM sale_lines sl
             JOIN sales s ON sl.sale_id = s.id
             LEFT JOIN products p ON sl.sku = p.sku
             WHERE s.status = 'voided' AND DATE(s.created_at, ?4) BETWEEN ?1 AND ?2
             GROUP BY sl.sku
             ORDER BY qty DESC
             LIMIT ?3";

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
        let mut stmt = self.conn.prepare(HOURLY_HEATMAP_SQL)?;
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
        let mut stmt = self.conn.prepare(PAYMENT_METHOD_BREAKDOWN_SQL)?;
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

    /// Receivable repayments collected in a date range, split by the tender the money
    /// actually arrived in (decision Q1's collection-day settlement line).
    ///
    /// Deliberately a SEPARATE query from [`Self::payment_method_breakdown`] rather than a
    /// UNION into it: the two answer different questions. The breakdown reports what was
    /// SOLD that day (and therefore excludes `pay_later`, which is a promise, not money);
    /// this reports what was COLLECTED that day. Folding them into one list is how a
    /// reader would double-count today's cash sale plus a same-day repayment of last
    /// week's debt and conclude the drawer should hold both -- which it should, but the
    /// two numbers are also each readable on their own, and a UNION destroys that.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::Validation`] for a malformed date bound.
    pub fn piutang_collections(
        &self,
        start_date: &str,
        end_date: &str,
    ) -> Result<Vec<PiutangCollectionRow>, CoreError> {
        // REP-03: range filter in store-local dates, same contract as every other report.
        check_date_bound("start_date", start_date)?;
        check_date_bound("end_date", end_date)?;
        let tz = self.tz_modifier();
        let mut stmt = self.conn.prepare(PIUTANG_COLLECTIONS_SQL)?;
        let rows = stmt.query_map(params![start_date, end_date, tz], |row| {
            Ok(PiutangCollectionRow {
                currency: row.get("currency")?,
                payment_method: row.get("payment_method")?,
                total_minor: row.get("total_minor")?,
                payment_count: row.get("payment_count")?,
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
        let mut stmt = self.conn.prepare(VOIDED_ITEMS_SQL)?;
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
    ///
    /// The code list buckets on the DISPLAYED label, not the raw column: an
    /// unlabelled discount is stored either as NULL or as `''`, and both show
    /// as `discount`, so grouping the raw column would report the same code
    /// twice and spend two of the five slots on it.
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
             GROUP BY COALESCE(NULLIF(discount_label, ''), 'discount')
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
    ///
    /// The turn is counted per SALE, not per KDS ticket: a sale whose items
    /// span two kitchen zones fans out into one `kds_orders` row per zone
    /// (`UNIQUE (sale_id, kitchen_zone)`), and counting tickets would report
    /// one party at one table as two turns.
    pub fn table_turnover(
        &self,
        start_date: &str,
        end_date: &str,
    ) -> Result<Vec<TableTurnoverRow>, CoreError> {
        // REP-03: day buckets in store-local dates.
        check_date_bound("start_date", start_date)?;
        check_date_bound("end_date", end_date)?;
        let tz = self.tz_modifier();
        let mut stmt = self.conn.prepare(&format!(
            "SELECT DATE(s.created_at, ?3) AS date,
                    COUNT(DISTINCT s.id) AS table_orders
             {TABLE_TURN_SOURCE}
             GROUP BY DATE(s.created_at, ?3)
             ORDER BY date ASC"
        ))?;
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
        let mut stmt = self.conn.prepare(&format!(
            "SELECT CAST(strftime('%H', s.created_at, ?3) AS INTEGER) AS hour,
                    COUNT(DISTINCT s.id) AS table_orders
             {TABLE_TURN_SOURCE}
             GROUP BY hour
             ORDER BY hour ASC"
        ))?;
        let rows = stmt.query_map(params![start_date, end_date, tz], |row| {
            Ok(HourlyOccupancyRow {
                hour: row.get("hour")?,
                table_orders: row.get("table_orders")?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }
}
