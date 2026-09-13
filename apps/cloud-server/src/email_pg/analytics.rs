//! Tenant-filtered analytics queries for the Postgres report bundle.
//!
//! The Postgres mirror of `oz_core::db::reports`: report-email generation,
//! bundle assembly, and the revenue / top-product / heatmap /
//! category-breakdown / stock-alert queries. Popularity and forecast queries
//! live in `super::popularity`; scoped settings in `super::settings_store`.
//! Split from `email_pg.rs` on 13-09-26; behaviour unchanged.

use chrono::{NaiveDate, SecondsFormat, Utc};
use deadpool_postgres::Pool;

use oz_core::db::reports::{
    CategoryBreakdownRow, DailyRevenueRow, HourlyHeatmapRow, LowStockAlert, MonthlyRevenueRow,
    StockAlertEvent, TopProductRow, WeeklyRevenueRow,
};
use oz_core::export::email_report::ReportEmailBuilder;
use oz_core::export::email_sender::filter_analytics_bundle;
use oz_core::export::{AnalyticsBundle, ExportConfig, ExportMetadata, ReportScheduleConfig};

use super::popularity::{category_forecast_pg, category_popularity_pg};
// ── Report email generation ────────────────────────────────────────

/// Generate a filtered report email from Postgres — the mirror of
/// `oz_core::export::email_sender::generate_filtered_report_email`.
pub async fn generate_filtered_report_email_pg(
    pool: &Pool,
    schedule: &ReportScheduleConfig,
    store_name: &str,
    tenant: &str,
) -> Result<oz_core::export::email_report::ReportEmail, String> {
    let lookback_start = Utc::now()
        .checked_sub_signed(chrono::Duration::days(schedule.lookback_days as i64))
        .unwrap_or(Utc::now())
        .format("%Y-%m-%d")
        .to_string();
    let end = Utc::now().format("%Y-%m-%d").to_string();

    let mut bundle = export_analytics_bundle_pg(
        pool,
        ExportConfig {
            start_date: lookback_start.clone(),
            end_date: end.clone(),
            ..ExportConfig::default()
        },
        tenant,
        store_name,
    )
    .await?;

    filter_analytics_bundle(&mut bundle, &schedule.report_types);

    let date_label = format!("{lookback_start} to {end}");
    Ok(ReportEmailBuilder::build(&bundle, store_name, &date_label))
}

/// Parse a `YYYY-MM-DD` range bound into a `NaiveDate` for parameter
/// binding (Postgres `date` columns compare against `date`-typed params).
pub fn parse_date(s: &str) -> Result<NaiveDate, String> {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").map_err(|e| format!("invalid date '{s}': {e}"))
}

// ── Analytics bundle (Postgres) ────────────────────────────────────

/// Export a complete analytics bundle from Postgres — the mirror of
/// `oz_core::Store::export_analytics_bundle`.
pub async fn export_analytics_bundle_pg(
    pool: &Pool,
    config: ExportConfig,
    tenant_id: &str,
    store_name: &str,
) -> Result<AnalyticsBundle, String> {
    let daily_revenue =
        daily_revenue_pg(pool, &config.start_date, &config.end_date, tenant_id).await?;
    let weekly_revenue =
        weekly_revenue_pg(pool, &config.start_date, &config.end_date, tenant_id).await?;
    let monthly_revenue =
        monthly_revenue_pg(pool, &config.start_date, &config.end_date, tenant_id).await?;
    let top_products = top_products_pg(
        pool,
        &config.start_date,
        &config.end_date,
        config.top_product_limit,
        "revenue",
        tenant_id,
    )
    .await?;
    let hourly_heatmap =
        hourly_heatmap_pg(pool, &config.start_date, &config.end_date, tenant_id).await?;
    let category_breakdown =
        category_breakdown_pg(pool, &config.start_date, &config.end_date, tenant_id).await?;
    let low_stock_alerts = low_stock_alerts_at_location_pg(
        pool,
        oz_core::inventory::CANONICAL_DEFAULT_LOCATION_UUID,
        config.low_stock_threshold,
        tenant_id,
    )
    .await?;
    let active_stock_alerts = active_stock_alerts_pg(
        pool,
        oz_core::inventory::CANONICAL_DEFAULT_LOCATION_UUID,
        tenant_id,
    )
    .await?;
    let category_popularity = category_popularity_pg(pool, 3, tenant_id).await?;
    let category_forecast = category_forecast_pg(
        pool,
        &config.start_date,
        &config.end_date,
        "weekly",
        10,
        tenant_id,
    )
    .await?;

    let exported_at = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);

    Ok(AnalyticsBundle {
        metadata: ExportMetadata {
            exported_at,
            tenant_id: tenant_id.to_string(),
            store_name: store_name.to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
        },
        daily_revenue,
        weekly_revenue,
        monthly_revenue,
        top_products,
        hourly_heatmap,
        category_breakdown,
        low_stock_alerts,
        active_stock_alerts,
        category_popularity,
        category_forecast,
    })
}

/// Compute revenue profit fields from a row (shared by the daily/weekly/
/// monthly queries — same arithmetic as `oz_core::db::reports`).
fn revenue_profit_fields(total_minor: i64, cogs_minor: i64) -> (i64, i64, i64, f64) {
    let gross_profit_minor = total_minor - cogs_minor;
    let gross_margin_percent = if total_minor > 0 {
        gross_profit_minor as f64 / total_minor as f64 * 100.0
    } else {
        0.0
    };
    (
        total_minor,
        cogs_minor,
        gross_profit_minor,
        gross_margin_percent,
    )
}

/// Daily revenue for a date range (Postgres mirror of
/// `oz_core::db::reports::Store::daily_revenue`).
pub async fn daily_revenue_pg(
    pool: &Pool,
    start_date: &str,
    end_date: &str,
    tenant: &str,
) -> Result<Vec<DailyRevenueRow>, String> {
    let mut client = pool.get().await.map_err(|e| e.to_string())?;
    let tx = client.transaction().await.map_err(|e| e.to_string())?;
    tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant])
        .await
        .map_err(|e| e.to_string())?;
    let start = parse_date(start_date)?;
    let end = parse_date(end_date)?;
    let rows = tx
        .query(
            // REP-04 cloud parity: sales and refunds aggregate independently
            // and join FULL OUTER on (date, currency) — a refund-only day
            // must still produce a row, mirroring the local daily_revenue
            // semantics exactly. COGS is a pre-aggregated CTE rather than
            // the local correlated subquery: PG rejects subqueries that
            // reference ungrouped outer columns (E42803), and joining an
            // aggregate keyed on (date, currency) cannot multiply rows.
            "WITH s AS (
                 SELECT to_char(s1.created_at::date, 'YYYY-MM-DD') AS d, s1.currency AS c,
                        SUM(s1.total_minor)::bigint AS t, COUNT(*) AS n
                 FROM sales s1
                 WHERE s1.status = 'completed'
                   AND s1.tenant_id = $3
                   AND s1.created_at::date BETWEEN $1 AND $2
                 GROUP BY s1.created_at::date, s1.currency
             ),
             c AS (
                 SELECT to_char(s3.created_at::date, 'YYYY-MM-DD') AS d, s3.currency AS c,
                        SUM(COALESCE(sl3.cost_minor, p3.cost_minor, 0) * sl3.qty)::bigint AS cogs
                 FROM sale_lines sl3
                 JOIN sales s3 ON sl3.sale_id = s3.id
                 LEFT JOIN products p3 ON p3.sku = sl3.sku AND p3.tenant_id = s3.tenant_id
                 WHERE s3.status = 'completed'
                   AND s3.tenant_id = $3
                   AND s3.created_at::date BETWEEN $1 AND $2
                 GROUP BY s3.created_at::date, s3.currency
             ),
             r AS (
                 SELECT to_char(created_at::date, 'YYYY-MM-DD') AS d, currency AS c,
                        SUM(total_minor)::bigint AS rf
                 FROM refunds
                 WHERE tenant_id = $3 AND created_at::date BETWEEN $1 AND $2
                 GROUP BY created_at::date, currency
             )
             SELECT COALESCE(s.d, r.d) AS date,
                    COALESCE(s.t, 0)::bigint AS total_minor,
                    COALESCE(s.c, r.c) AS currency,
                    COALESCE(s.n, 0)::bigint AS sale_count,
                    COALESCE(c.cogs, 0)::bigint AS cogs_minor,
                    COALESCE(r.rf, 0)::bigint AS refund_minor,
                    (COALESCE(s.t, 0) - COALESCE(r.rf, 0))::bigint AS net_revenue_minor
             FROM s FULL OUTER JOIN r ON s.d = r.d AND s.c = r.c
             LEFT JOIN c ON c.d = s.d AND c.c = s.c
             ORDER BY date ASC",
            &[&start, &end, &tenant],
        )
        .await
        .map_err(|e| format!("DB error: {e:?}"))?;

    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let total_minor: i64 = row.get(1);
        let cogs_minor: i64 = row.get(4);
        let (total_minor, cogs_minor, gross_profit_minor, gross_margin_percent) =
            revenue_profit_fields(total_minor, cogs_minor);
        out.push(DailyRevenueRow {
            date: row.get(0),
            total_minor,
            currency: row.get(2),
            sale_count: row.get(3),
            cogs_minor,
            gross_profit_minor,
            gross_margin_percent,
            refund_minor: row.get(5),
            net_revenue_minor: row.get(6),
        });
    }
    Ok(out)
}

/// Weekly revenue (Monday-first weeks) for a date range.
async fn weekly_revenue_pg(
    pool: &Pool,
    start_date: &str,
    end_date: &str,
    tenant: &str,
) -> Result<Vec<WeeklyRevenueRow>, String> {
    let mut client = pool.get().await.map_err(|e| e.to_string())?;
    let tx = client.transaction().await.map_err(|e| e.to_string())?;
    tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant])
        .await
        .map_err(|e| e.to_string())?;
    let start = parse_date(start_date)?;
    let end = parse_date(end_date)?;
    let rows = tx
        .query(
            // REP-04 cloud parity: FULL OUTER netting on (week_start,
            // currency); a refund-only week still produces a row. COGS is
            // a pre-aggregated CTE (PG forbids the correlated form over
            // ungrouped outer columns).
            "WITH s AS (
                 SELECT to_char(date_trunc('week', s1.created_at::date)::date, 'YYYY-MM-DD') AS d,
                        s1.currency AS c,
                        SUM(s1.total_minor)::bigint AS t, COUNT(*) AS n
                 FROM sales s1
                 WHERE s1.status = 'completed'
                   AND s1.tenant_id = $3
                   AND s1.created_at::date BETWEEN $1 AND $2
                 GROUP BY date_trunc('week', s1.created_at::date), s1.currency
             ),
             c AS (
                 SELECT to_char(date_trunc('week', s3.created_at::date)::date, 'YYYY-MM-DD') AS d,
                        s3.currency AS c,
                        SUM(COALESCE(sl3.cost_minor, p3.cost_minor, 0) * sl3.qty)::bigint AS cogs
                 FROM sale_lines sl3
                 JOIN sales s3 ON sl3.sale_id = s3.id
                 LEFT JOIN products p3 ON p3.sku = sl3.sku AND p3.tenant_id = s3.tenant_id
                 WHERE s3.status = 'completed'
                   AND s3.tenant_id = $3
                   AND s3.created_at::date BETWEEN $1 AND $2
                 GROUP BY date_trunc('week', s3.created_at::date), s3.currency
             ),
             r AS (
                 SELECT to_char(date_trunc('week', created_at::date)::date, 'YYYY-MM-DD') AS d,
                        currency AS c,
                        SUM(total_minor)::bigint AS rf
                 FROM refunds
                 WHERE tenant_id = $3 AND created_at::date BETWEEN $1 AND $2
                 GROUP BY date_trunc('week', created_at::date), currency
             )
             SELECT COALESCE(s.d, r.d) AS week_start,
                    COALESCE(s.t, 0)::bigint AS total_minor,
                    COALESCE(s.c, r.c) AS currency,
                    COALESCE(s.n, 0)::bigint AS sale_count,
                    COALESCE(c.cogs, 0)::bigint AS cogs_minor,
                    COALESCE(r.rf, 0)::bigint AS refund_minor,
                    (COALESCE(s.t, 0) - COALESCE(r.rf, 0))::bigint AS net_revenue_minor
             FROM s FULL OUTER JOIN r ON s.d = r.d AND s.c = r.c
             LEFT JOIN c ON c.d = s.d AND c.c = s.c
             ORDER BY week_start ASC",
            &[&start, &end, &tenant],
        )
        .await
        .map_err(|e| format!("DB error: {e}"))?;

    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let total_minor: i64 = row.get(1);
        let cogs_minor: i64 = row.get(4);
        let (total_minor, cogs_minor, gross_profit_minor, gross_margin_percent) =
            revenue_profit_fields(total_minor, cogs_minor);
        out.push(WeeklyRevenueRow {
            week_start: row.get(0),
            total_minor,
            currency: row.get(2),
            sale_count: row.get(3),
            cogs_minor,
            gross_profit_minor,
            gross_margin_percent,
            refund_minor: row.get(5),
            net_revenue_minor: row.get(6),
        });
    }
    Ok(out)
}

/// Monthly revenue for a date range.
async fn monthly_revenue_pg(
    pool: &Pool,
    start_date: &str,
    end_date: &str,
    tenant: &str,
) -> Result<Vec<MonthlyRevenueRow>, String> {
    let mut client = pool.get().await.map_err(|e| e.to_string())?;
    let tx = client.transaction().await.map_err(|e| e.to_string())?;
    tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant])
        .await
        .map_err(|e| e.to_string())?;
    let start = parse_date(start_date)?;
    let end = parse_date(end_date)?;
    let rows = tx
        .query(
            // REP-04 cloud parity: FULL OUTER netting on (month, currency);
            // a refund-only month still produces a row. COGS is a
            // pre-aggregated CTE (PG forbids the correlated form over
            // ungrouped outer columns).
            "WITH s AS (
                 SELECT LEFT(s1.created_at, 7) AS d, s1.currency AS c,
                        SUM(s1.total_minor)::bigint AS t, COUNT(*) AS n
                 FROM sales s1
                 WHERE s1.status = 'completed'
                   AND s1.tenant_id = $3
                   AND s1.created_at::date BETWEEN $1 AND $2
                 GROUP BY LEFT(s1.created_at, 7), s1.currency
             ),
             c AS (
                 SELECT LEFT(s3.created_at, 7) AS d, s3.currency AS c,
                        SUM(COALESCE(sl3.cost_minor, p3.cost_minor, 0) * sl3.qty)::bigint AS cogs
                 FROM sale_lines sl3
                 JOIN sales s3 ON sl3.sale_id = s3.id
                 LEFT JOIN products p3 ON p3.sku = sl3.sku AND p3.tenant_id = s3.tenant_id
                 WHERE s3.status = 'completed'
                   AND s3.tenant_id = $3
                   AND s3.created_at::date BETWEEN $1 AND $2
                 GROUP BY LEFT(s3.created_at, 7), s3.currency
             ),
             r AS (
                 SELECT LEFT(created_at, 7) AS d, currency AS c,
                        SUM(total_minor)::bigint AS rf
                 FROM refunds
                 WHERE tenant_id = $3 AND created_at::date BETWEEN $1 AND $2
                 GROUP BY LEFT(created_at, 7), currency
             )
             SELECT COALESCE(s.d, r.d) AS month,
                    COALESCE(s.t, 0)::bigint AS total_minor,
                    COALESCE(s.c, r.c) AS currency,
                    COALESCE(s.n, 0)::bigint AS sale_count,
                    COALESCE(c.cogs, 0)::bigint AS cogs_minor,
                    COALESCE(r.rf, 0)::bigint AS refund_minor,
                    (COALESCE(s.t, 0) - COALESCE(r.rf, 0))::bigint AS net_revenue_minor
             FROM s FULL OUTER JOIN r ON s.d = r.d AND s.c = r.c
             LEFT JOIN c ON c.d = s.d AND c.c = s.c
             ORDER BY month ASC",
            &[&start, &end, &tenant],
        )
        .await
        .map_err(|e| format!("DB error: {e}"))?;

    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let total_minor: i64 = row.get(1);
        let cogs_minor: i64 = row.get(4);
        let (total_minor, cogs_minor, gross_profit_minor, gross_margin_percent) =
            revenue_profit_fields(total_minor, cogs_minor);
        out.push(MonthlyRevenueRow {
            month: row.get(0),
            total_minor,
            currency: row.get(2),
            sale_count: row.get(3),
            cogs_minor,
            gross_profit_minor,
            gross_margin_percent,
            refund_minor: row.get(5),
            net_revenue_minor: row.get(6),
        });
    }
    Ok(out)
}

/// Top products ranked by revenue (or profit) for a date range.
async fn top_products_pg(
    pool: &Pool,
    start_date: &str,
    end_date: &str,
    limit: i64,
    order_by: &str,
    tenant: &str,
) -> Result<Vec<TopProductRow>, String> {
    let order_clause = if order_by == "profit" {
        "gross_profit_minor DESC"
    } else {
        "total_minor DESC"
    };
    let mut client = pool.get().await.map_err(|e| e.to_string())?;
    let tx = client.transaction().await.map_err(|e| e.to_string())?;
    tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant])
        .await
        .map_err(|e| e.to_string())?;
    let start = parse_date(start_date)?;
    let end = parse_date(end_date)?;
    let sql = format!(
        // REP-06: include currency so rows are grouped per-product AND
        // per-currency; minor units must never be summed across currencies.
        // REP-05: identity comes from the sale-line snapshot first; the
        // products join is only a fallback for legacy NULL rows. Grouping
        // by the resolved expressions keeps each sale era of a reused sku
        // on its own correctly-labelled row instead of relabelling history.
        "SELECT COALESCE(sl.product_id, p.id, 'deleted:' || sl.sku) AS product_id,
                sl.sku,
                COALESCE(sl.product_name, p.name, sl.sku) AS name,
                SUM(sl.qty)::bigint AS total_qty,
                SUM(sl.line_minor)::bigint AS total_minor,
                SUM(sl.qty * COALESCE(sl.cost_minor, p.cost_minor, 0))::bigint AS cogs_minor,
                (SUM(sl.line_minor) - SUM(sl.qty * COALESCE(sl.cost_minor, p.cost_minor, 0)))::bigint AS gross_profit_minor,
                s.currency
         FROM sale_lines sl
         JOIN sales s ON sl.sale_id = s.id
         LEFT JOIN products p ON p.sku = sl.sku AND p.tenant_id = s.tenant_id
         WHERE s.status = 'completed'
           AND s.tenant_id = $4
           AND s.created_at::date BETWEEN $1 AND $2
         GROUP BY sl.sku, s.currency, p.cost_minor,
                  COALESCE(sl.product_id, p.id, 'deleted:' || sl.sku),
                  COALESCE(sl.product_name, p.name, sl.sku)
         ORDER BY {order_clause}, sl.sku
         LIMIT $3"
    );
    let rows = tx
        .query(&sql, &[&start, &end, &limit, &tenant])
        .await
        .map_err(|e| format!("DB error: {e}"))?;

    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let total_minor: i64 = row.get(4);
        let cogs_minor: i64 = row.get(5);
        let gross_profit_minor: i64 = row.get(6);
        out.push(TopProductRow {
            product_id: row.get(0),
            sku: row.get(1),
            name: row.get(2),
            total_qty: row.get(3),
            total_minor,
            cogs_minor,
            gross_profit_minor,
            gross_margin_percent: if total_minor > 0 {
                (gross_profit_minor as f64 / total_minor as f64) * 100.0
            } else {
                0.0
            },
            currency: row.get(7),
        });
    }
    Ok(out)
}

/// Hourly sales heatmap for a date range.
async fn hourly_heatmap_pg(
    pool: &Pool,
    start_date: &str,
    end_date: &str,
    tenant: &str,
) -> Result<Vec<HourlyHeatmapRow>, String> {
    let mut client = pool.get().await.map_err(|e| e.to_string())?;
    let tx = client.transaction().await.map_err(|e| e.to_string())?;
    tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant])
        .await
        .map_err(|e| e.to_string())?;
    let start = parse_date(start_date)?;
    let end = parse_date(end_date)?;
    let rows = tx
        .query(
            // REP-06: group by currency so minor units are never mixed.
            "SELECT EXTRACT(DOW FROM created_at::timestamp)::bigint AS day_of_week,
                    EXTRACT(HOUR FROM created_at::timestamp)::bigint AS hour,
                    SUM(total_minor)::bigint AS total_minor,
                    COUNT(*) AS sale_count,
                    currency
             FROM sales
             WHERE status = 'completed'
               AND tenant_id = $3
               AND created_at::date BETWEEN $1 AND $2
             GROUP BY day_of_week, hour, currency
             ORDER BY day_of_week, hour",
            &[&start, &end, &tenant],
        )
        .await
        .map_err(|e| format!("DB error: {e}"))?;

    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        out.push(HourlyHeatmapRow {
            day_of_week: row.get(0),
            hour: row.get(1),
            total_minor: row.get(2),
            sale_count: row.get(3),
            currency: row.get(4),
        });
    }
    Ok(out)
}

/// Revenue breakdown by product category for a date range.
async fn category_breakdown_pg(
    pool: &Pool,
    start_date: &str,
    end_date: &str,
    tenant: &str,
) -> Result<Vec<CategoryBreakdownRow>, String> {
    let mut client = pool.get().await.map_err(|e| e.to_string())?;
    let tx = client.transaction().await.map_err(|e| e.to_string())?;
    tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant])
        .await
        .map_err(|e| e.to_string())?;
    let start = parse_date(start_date)?;
    let end = parse_date(end_date)?;
    let rows = tx
        .query(
            // REP-06: group by currency so per-currency percentage is correct.
            // REP-05: category resolved from the sale-line snapshot first —
            // moving a product between categories after the sale no longer
            // relabels historical revenue; legacy NULL rows fall back to the
            // products join.
            "SELECT COALESCE(sl.category_id, p.category_id) AS category_id,
                    COALESCE(c.name, 'Uncategorised') AS category_name,
                    SUM(sl.line_minor)::bigint AS total_minor,
                    COUNT(DISTINCT s.id) AS sale_count,
                    s.currency
             FROM sale_lines sl
             JOIN sales s ON sl.sale_id = s.id
             LEFT JOIN products p ON p.sku = sl.sku AND p.tenant_id = s.tenant_id
             LEFT JOIN categories c ON c.id = COALESCE(sl.category_id, p.category_id)
             WHERE s.status = 'completed'
               AND s.tenant_id = $3
               AND s.created_at::date BETWEEN $1 AND $2
             GROUP BY COALESCE(sl.category_id, p.category_id), c.name, s.currency
             ORDER BY total_minor DESC",
            &[&start, &end, &tenant],
        )
        .await
        .map_err(|e| format!("DB error: {e}"))?;

    let mut out: Vec<CategoryBreakdownRow> = Vec::with_capacity(rows.len());
    for row in rows {
        out.push(CategoryBreakdownRow {
            category_id: row.get(0),
            category_name: row.get(1),
            total_minor: row.get(2),
            sale_count: row.get(3),
            percentage: 0.0,
            currency: row.get(4),
        });
    }

    // Percentage is normalised within each currency bucket.
    // Group by currency and compute grand total per currency.
    let mut currency_totals: std::collections::HashMap<String, f64> =
        std::collections::HashMap::new();
    for row in &out {
        *currency_totals.entry(row.currency.clone()).or_insert(0.0) += row.total_minor as f64;
    }
    for row in &mut out {
        let grand_total = currency_totals.get(&row.currency).copied().unwrap_or(0.0);
        if grand_total > 0.0 {
            row.percentage = (row.total_minor as f64 / grand_total) * 100.0;
        }
    }

    Ok(out)
}

/// Per-location low-stock alerts using `stock_summary`.
async fn low_stock_alerts_at_location_pg(
    pool: &Pool,
    location_id: &str,
    default_threshold: i64,
    tenant: &str,
) -> Result<Vec<LowStockAlert>, String> {
    let mut client = pool.get().await.map_err(|e| e.to_string())?;
    let tx = client.transaction().await.map_err(|e| e.to_string())?;
    tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant])
        .await
        .map_err(|e| e.to_string())?;
    let rows = tx
        .query(
            "SELECT p.id AS product_id, p.sku, p.name, p.currency,
                    p.price_minor, p.cost_minor,
                    COALESCE(ss.qty, 0) AS current_qty,
                    COALESCE(
                        (SELECT st.threshold FROM stock_thresholds st
                         WHERE st.product_id = p.id
                           AND st.location_id = $1 AND st.enabled = 1
                         LIMIT 1),
                        (SELECT st.threshold FROM stock_thresholds st
                         WHERE st.product_id = p.id
                           AND st.location_id IS NULL AND st.enabled = 1
                         LIMIT 1),
                        $2
                    ) AS threshold
             FROM products p
             LEFT JOIN stock_summary ss
                ON ss.item_id = p.id AND ss.location_id = $1
             WHERE p.tenant_id = $3
               AND (COALESCE(ss.qty, 0) <= $2
                    OR (SELECT 1 FROM stock_thresholds st
                        WHERE st.product_id = p.id
                          AND (st.location_id = $1 OR st.location_id IS NULL)
                          AND st.enabled = 1
                          AND COALESCE(ss.qty, 0) <= st.threshold
                        LIMIT 1) = 1)
             ORDER BY current_qty ASC",
            &[&location_id, &default_threshold, &tenant],
        )
        .await
        .map_err(|e| format!("DB error: {e}"))?;

    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        out.push(LowStockAlert {
            product_id: row.get(0),
            sku: row.get(1),
            name: row.get(2),
            currency: row.get(3),
            price_minor: row.get(4),
            cost_minor: row.get(5),
            current_qty: row.get(6),
            threshold: row.get(7),
        });
    }
    Ok(out)
}

/// Active (non-resolved) stock alert events for a location.
async fn active_stock_alerts_pg(
    pool: &Pool,
    location_id: &str,
    tenant: &str,
) -> Result<Vec<StockAlertEvent>, String> {
    let mut client = pool.get().await.map_err(|e| e.to_string())?;
    let tx = client.transaction().await.map_err(|e| e.to_string())?;
    tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant])
        .await
        .map_err(|e| e.to_string())?;
    let rows = tx
        .query(
            "SELECT sae.id, sae.threshold_id, sae.product_id, sae.location_id,
                    sae.current_qty, sae.threshold, sae.status,
                    sae.triggered_at, sae.acknowledged_at, sae.resolved_at,
                    sae.acknowledged_by,
                    COALESCE(p.sku, '') AS product_sku,
                    COALESCE(p.name, '') AS product_name
             FROM stock_alert_events sae
             LEFT JOIN products p ON sae.product_id = p.id
             WHERE sae.location_id = $1
               AND p.tenant_id = $2
               AND sae.status IN ('active', 'acknowledged')
             ORDER BY sae.triggered_at DESC",
            &[&location_id, &tenant],
        )
        .await
        .map_err(|e| format!("DB error: {e}"))?;

    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        out.push(StockAlertEvent {
            id: row.get(0),
            threshold_id: row.get(1),
            product_id: row.get(2),
            location_id: row.get::<_, Option<String>>(3).unwrap_or_default(),
            current_qty: row.get(4),
            threshold: row.get(5),
            status: row.get(6),
            triggered_at: row.get(7),
            acknowledged_at: row.get(8),
            resolved_at: row.get(9),
            acknowledged_by: row.get(10),
            product_sku: row.get(11),
            product_name: row.get(12),
        });
    }
    Ok(out)
}
