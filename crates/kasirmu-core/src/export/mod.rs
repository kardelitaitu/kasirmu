//! Unified analytics export — collect all report data into a single JSON-bundle.
/*
last audited 25-07-26 by RSA-Agent (kasirmu-core slice D1: export/mod deep read)
crate: kasirmu-core | status: SAFE | lint: CLEAN
findings: custom report builder injection-safe — per-dataset hardcoded tables + column whitelists (unknown columns silently dropped), parameterized dates, clamped u32 limit/offset; CSV escaping correct (quote doubling); bundle export aggregates db::reports queries; no findings
next: none | perf: direct report-query reuse, no N+1
*/
//!
//! [`Store::export_analytics_bundle`] runs every report query defined in
//! [`crate::db::reports`] (daily/weekly/monthly revenue, top products, hourly
//! heatmap, category breakdown, low-stock alerts, active stock alerts) and
//! packages them together with export metadata into a serializable
//! [`AnalyticsBundle`](crate::export::AnalyticsBundle).

pub mod cloud_destination;
pub mod email_report;
pub mod email_sender;

use serde::{Deserialize, Serialize};

use crate::db::Store;
use crate::db::popularity::{CategoryForecastRow, CategoryPopularityRow};
use crate::db::reports::{
    CategoryBreakdownRow, DailyRevenueRow, HourlyHeatmapRow, LowStockAlert, MonthlyRevenueRow,
    StockAlertEvent, TopProductRow, WeeklyRevenueRow,
};
use crate::error::CoreError;

/// Column whitelist entries for custom report datasets.
type ColumnWhitelist = &'static [(&'static str, &'static str)];

/// Dataset definition for the custom report builder.
struct DatasetDef {
    table: &'static str,
    columns: ColumnWhitelist,
    has_date_filter: bool,
    /// Column name to use for date filtering (e.g. "created_at", "opened_at").
    /// Only meaningful when `has_date_filter` is true.
    date_column: &'static str,
}

/// Request payload for the custom report builder.
///
/// The backend validates `columns` against a per-dataset whitelist to prevent
/// SQL injection — only columns listed in the whitelist are included in the query.
#[derive(Debug, Clone, Deserialize)]
pub struct CustomReportRequest {
    /// Dataset key ("sales" or "inventory").
    pub dataset: String,
    /// Column names the user wants to see (whitelist-filtered).
    pub columns: Vec<String>,
    /// Optional ISO-8601 start date for date-filterable datasets.
    pub start_date: Option<String>,
    /// Optional ISO-8601 end date for date-filterable datasets.
    pub end_date: Option<String>,
    /// Maximum number of rows to return (clamped to MAX_LIMIT). None = no limit.
    pub limit: Option<u32>,
    /// Number of rows to skip before returning results.
    pub offset: Option<u32>,
}

/// Response from the custom report builder — a generic grid suitable for
/// table rendering and CSV export.
#[derive(Debug, Clone, Serialize)]
pub struct CustomReportResponse {
    /// Column headers in display order.
    pub columns: Vec<String>,
    /// Row data — each inner vec matches the length of `columns`.
    pub rows: Vec<Vec<String>>,
    /// Whether the result was truncated due to a limit.
    pub truncated: bool,
}

/// Convert a rusqlite Value to its string representation.
fn value_to_string(val: rusqlite::types::Value) -> String {
    match val {
        rusqlite::types::Value::Null => String::new(),
        rusqlite::types::Value::Integer(i) => i.to_string(),
        rusqlite::types::Value::Real(f) => f.to_string(),
        rusqlite::types::Value::Text(s) => s,
        rusqlite::types::Value::Blob(b) => format!("<{} bytes>", b.len()),
    }
}

/// Metadata stamped onto every analytics export.
#[derive(Debug, Clone, Serialize)]
pub struct ExportMetadata {
    /// ISO-8601 timestamp of the export generation.
    pub exported_at: String,
    /// Tenant ID (empty string for single-tenant deployments).
    pub tenant_id: String,
    /// Store profile name.
    pub store_name: String,
    /// Version of kasir.mu that generated this export.
    pub version: String,
}

/// A complete analytics bundle containing every report type plus metadata.
///
/// This is the output of [`Store::export_analytics_bundle`]. Serialize to
/// JSON for consumption by external analytics platforms (BigQuery,
/// Snowflake, custom BI tools) or to NDJSON for streaming ingestion.
#[derive(Debug, Clone, Serialize)]
pub struct AnalyticsBundle {
    /// Export metadata (timestamp, tenant, store, version).
    pub metadata: ExportMetadata,
    /// Daily revenue rows for the requested date range.
    pub daily_revenue: Vec<DailyRevenueRow>,
    /// Weekly revenue rows for the requested date range.
    pub weekly_revenue: Vec<WeeklyRevenueRow>,
    /// Monthly revenue rows for the requested date range.
    pub monthly_revenue: Vec<MonthlyRevenueRow>,
    /// Top products ranked by revenue (default limit: 25).
    pub top_products: Vec<TopProductRow>,
    /// Hourly heatmap — day-of-week × hour cross-tab of revenue and sale count.
    pub hourly_heatmap: Vec<HourlyHeatmapRow>,
    /// Revenue breakdown by product category with percentage.
    pub category_breakdown: Vec<CategoryBreakdownRow>,
    /// Products at or below threshold at the default location.
    pub low_stock_alerts: Vec<LowStockAlert>,
    /// Active (non-resolved) stock alert events at the default location.
    pub active_stock_alerts: Vec<StockAlertEvent>,
    /// Per-category popularity standings (ADR #37): each category's count,
    /// mean score, catalog ratio, and top-3 products with rank/percentile.
    pub category_popularity: Vec<CategoryPopularityRow>,
    /// Next-period demand forecast per category (ADR #37 prototype): weekly
    /// granularity over the export's date range, linear-fit projection.
    pub category_forecast: Vec<CategoryForecastRow>,
}

/// Configuration knobs for the analytics export.
#[derive(Debug, Clone)]
pub struct ExportConfig {
    /// Start of the date range (inclusive, ISO-8601 YYYY-MM-DD).
    pub start_date: String,
    /// End of the date range (inclusive, ISO-8601 YYYY-MM-DD).
    pub end_date: String,
    /// Maximum number of top products to include.
    pub top_product_limit: i64,
    /// Low-stock threshold for the default location.
    pub low_stock_threshold: i64,
}

impl Default for ExportConfig {
    fn default() -> Self {
        Self {
            start_date: "2000-01-01".to_string(),
            end_date: "2099-12-31".to_string(),
            top_product_limit: 25,
            low_stock_threshold: 10,
        }
    }
}

impl Store<'_> {
    /// Export a complete analytics bundle across all report types.
    ///
    /// # Arguments
    ///
    /// * `config` — date range, limit, and threshold knobs.
    /// * `tenant_id` — tenant identifier (empty string for standalone).
    /// * `store_name` — human-readable store name for the metadata header.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError`] if any of the underlying report queries fail.
    pub fn export_analytics_bundle(
        &self,
        config: ExportConfig,
        tenant_id: &str,
        store_name: &str,
    ) -> Result<AnalyticsBundle, CoreError> {
        let daily_revenue = self.daily_revenue(&config.start_date, &config.end_date)?;
        let weekly_revenue = self.weekly_revenue(&config.start_date, &config.end_date)?;
        let monthly_revenue = self.monthly_revenue(&config.start_date, &config.end_date)?;
        let top_products = self.top_products(
            &config.start_date,
            &config.end_date,
            config.top_product_limit,
            "revenue",
        )?;
        let hourly_heatmap = self.hourly_heatmap(&config.start_date, &config.end_date)?;
        let category_breakdown = self.category_breakdown(&config.start_date, &config.end_date)?;
        let low_stock_alerts = self.low_stock_alerts_at_location(
            crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID,
            config.low_stock_threshold,
        )?;
        let active_stock_alerts =
            self.active_stock_alerts(crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID)?;
        let category_popularity = self.category_popularity(3)?;
        let category_forecast =
            self.category_forecast(&config.start_date, &config.end_date, "weekly", 10)?;

        let exported_at = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

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
}

/// Scheduled report delivery configuration.
///
/// Persisted in the `settings` table under key `report_schedule` as JSON.
/// When email/SMTP infrastructure is wired in, a background task reads
/// this config and sends analytics bundles on the configured cadence.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReportScheduleConfig {
    /// Whether scheduled delivery is enabled.
    pub enabled: bool,
    /// Cron-style cadence: "daily", "weekly", "monthly", or a cron expression.
    pub cadence: String,
    /// Report types to include in the delivery.
    pub report_types: Vec<String>,
    /// Recipient email addresses.
    pub recipients: Vec<String>,
    /// ISO-8601 time of day to send (e.g. "08:00" for 8 AM).
    pub send_at_time: String,
    /// Timezone for scheduling (e.g. "Asia/Jakarta").
    pub timezone: String,
    /// Date range window in days (e.g. 7 for last week's data).
    pub lookback_days: u32,
}

impl Default for ReportScheduleConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            cadence: "daily".to_string(),
            report_types: vec!["daily_revenue".to_string(), "top_products".to_string()],
            recipients: Vec::new(),
            send_at_time: "08:00".to_string(),
            timezone: "UTC".to_string(),
            lookback_days: 1,
        }
    }
}

/// Settings key used to persist the report schedule.
pub const REPORT_SCHEDULE_SETTINGS_KEY: &str = "report_schedule";

/// Settings key used to persist the cloud export config.
pub const CLOUD_EXPORT_SETTINGS_KEY: &str = "cloud_export_config";

/// CSV escape — wraps a cell in quotes and escapes internal quotes.
fn csv_cell(value: &str) -> String {
    if value.contains(',') || value.contains('"') || value.contains('\n') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

/// Write a CSV row from an iterator of cells.
#[allow(dead_code)]
fn csv_row(cells: impl Iterator<Item = String>) -> String {
    cells.map(|c| csv_cell(&c)).collect::<Vec<_>>().join(",")
}

fn write_csv_cell<W: std::io::Write>(w: &mut W, value: &str) -> std::io::Result<()> {
    if value.contains(',') || value.contains('"') || value.contains('\n') {
        w.write_all(b"\"")?;
        for byte in value.bytes() {
            if byte == b'"' {
                w.write_all(b"\"\"")?;
            } else {
                w.write_all(&[byte])?;
            }
        }
        w.write_all(b"\"")?;
    } else {
        w.write_all(value.as_bytes())?;
    }
    Ok(())
}

fn write_csv_row<W: std::io::Write, I>(w: &mut W, cells: I) -> std::io::Result<()>
where
    I: IntoIterator,
    I::Item: AsRef<str>,
{
    let mut first = true;
    for c in cells {
        if !first {
            w.write_all(b",")?;
        }
        first = false;
        write_csv_cell(w, c.as_ref())?;
    }
    w.write_all(b"\n")
}

/// Write analytics data as CSV files and a metadata.json to the given directory.
///
/// Creates one `.csv` file per report type plus a `metadata.json` file.
/// Returns the list of file paths written. Existing files are overwritten.
///
/// # Example output
///
/// ```text
/// exports/2026-07-20/
///   metadata.json
///   daily_revenue.csv
///   weekly_revenue.csv
///   monthly_revenue.csv
///   top_products.csv
///   hourly_heatmap.csv
///   category_breakdown.csv
///   low_stock_alerts.csv
///   active_stock_alerts.csv
/// ```
pub fn write_analytics_bundle_csv(
    bundle: &AnalyticsBundle,
    dir: &str,
) -> Result<Vec<String>, CoreError> {
    use std::fs;
    use std::io::{BufWriter, Write};
    use std::path::Path;

    let root = Path::new(dir);
    fs::create_dir_all(root).map_err(|e| {
        CoreError::Internal(format!("failed to create export directory {dir}: {e}"))
    })?;

    let mut files: Vec<String> = Vec::new();

    let create_writer = |name: &str| -> Result<(BufWriter<fs::File>, String), CoreError> {
        let path = root.join(name);
        let file = fs::File::create(&path)
            .map_err(|e| CoreError::Internal(format!("failed to create {name}: {e}")))?;
        let writer = BufWriter::new(file);
        let path_str = path.to_string_lossy().to_string();
        Ok((writer, path_str))
    };

    // metadata.json
    let meta_json = serde_json::to_string_pretty(&bundle.metadata)
        .map_err(|e| CoreError::Internal(format!("failed to serialize metadata: {e}")))?;
    let meta_path = root.join("metadata.json");
    fs::write(&meta_path, meta_json)
        .map_err(|e| CoreError::Internal(format!("failed to write metadata.json: {e}")))?;
    files.push(meta_path.to_string_lossy().to_string());

    // Daily revenue (O-L04: write rows into BufWriter<File> directly to avoid unbounded memory accumulation)
    if !bundle.daily_revenue.is_empty() {
        let (mut w, path_str) = create_writer("daily_revenue.csv")?;
        w.write_all(b"date,total_minor,currency,sale_count\n")
            .map_err(|e| CoreError::Internal(e.to_string()))?;
        for r in &bundle.daily_revenue {
            let total_str = r.total_minor.to_string();
            let count_str = r.sale_count.to_string();
            write_csv_row(&mut w, [&r.date, &total_str, &r.currency, &count_str])
                .map_err(|e| CoreError::Internal(e.to_string()))?;
        }
        w.flush().map_err(|e| CoreError::Internal(e.to_string()))?;
        files.push(path_str);
    }

    // Weekly revenue
    if !bundle.weekly_revenue.is_empty() {
        let (mut w, path_str) = create_writer("weekly_revenue.csv")?;
        w.write_all(b"week_start,total_minor,currency,sale_count\n")
            .map_err(|e| CoreError::Internal(e.to_string()))?;
        for r in &bundle.weekly_revenue {
            let total_str = r.total_minor.to_string();
            let count_str = r.sale_count.to_string();
            write_csv_row(&mut w, [&r.week_start, &total_str, &r.currency, &count_str])
                .map_err(|e| CoreError::Internal(e.to_string()))?;
        }
        w.flush().map_err(|e| CoreError::Internal(e.to_string()))?;
        files.push(path_str);
    }

    // Monthly revenue
    if !bundle.monthly_revenue.is_empty() {
        let (mut w, path_str) = create_writer("monthly_revenue.csv")?;
        w.write_all(b"month,total_minor,currency,sale_count\n")
            .map_err(|e| CoreError::Internal(e.to_string()))?;
        for r in &bundle.monthly_revenue {
            let total_str = r.total_minor.to_string();
            let count_str = r.sale_count.to_string();
            write_csv_row(&mut w, [&r.month, &total_str, &r.currency, &count_str])
                .map_err(|e| CoreError::Internal(e.to_string()))?;
        }
        w.flush().map_err(|e| CoreError::Internal(e.to_string()))?;
        files.push(path_str);
    }

    // Top products
    if !bundle.top_products.is_empty() {
        let (mut w, path_str) = create_writer("top_products.csv")?;
        w.write_all(b"sku,name,total_qty,total_minor\n")
            .map_err(|e| CoreError::Internal(e.to_string()))?;
        for r in &bundle.top_products {
            let qty_str = r.total_qty.to_string();
            let total_str = r.total_minor.to_string();
            write_csv_row(&mut w, [&r.sku, &r.name, &qty_str, &total_str])
                .map_err(|e| CoreError::Internal(e.to_string()))?;
        }
        w.flush().map_err(|e| CoreError::Internal(e.to_string()))?;
        files.push(path_str);
    }

    // Hourly heatmap
    if !bundle.hourly_heatmap.is_empty() {
        let (mut w, path_str) = create_writer("hourly_heatmap.csv")?;
        w.write_all(b"day_of_week,hour,total_minor,sale_count\n")
            .map_err(|e| CoreError::Internal(e.to_string()))?;
        for r in &bundle.hourly_heatmap {
            let day_str = r.day_of_week.to_string();
            let hour_str = r.hour.to_string();
            let total_str = r.total_minor.to_string();
            let count_str = r.sale_count.to_string();
            write_csv_row(&mut w, [&day_str, &hour_str, &total_str, &count_str])
                .map_err(|e| CoreError::Internal(e.to_string()))?;
        }
        w.flush().map_err(|e| CoreError::Internal(e.to_string()))?;
        files.push(path_str);
    }

    // Category breakdown
    if !bundle.category_breakdown.is_empty() {
        let (mut w, path_str) = create_writer("category_breakdown.csv")?;
        w.write_all(b"category_name,total_minor,sale_count,percentage\n")
            .map_err(|e| CoreError::Internal(e.to_string()))?;
        for r in &bundle.category_breakdown {
            let total_str = r.total_minor.to_string();
            let count_str = r.sale_count.to_string();
            let pct_str = format!("{:.1}", r.percentage);
            write_csv_row(&mut w, [&r.category_name, &total_str, &count_str, &pct_str])
                .map_err(|e| CoreError::Internal(e.to_string()))?;
        }
        w.flush().map_err(|e| CoreError::Internal(e.to_string()))?;
        files.push(path_str);
    }

    // Low stock alerts
    if !bundle.low_stock_alerts.is_empty() {
        let (mut w, path_str) = create_writer("low_stock_alerts.csv")?;
        w.write_all(b"product_id,sku,name,current_qty,threshold\n")
            .map_err(|e| CoreError::Internal(e.to_string()))?;
        for r in &bundle.low_stock_alerts {
            let qty_str = r.current_qty.to_string();
            let thresh_str = r.threshold.to_string();
            write_csv_row(
                &mut w,
                [&r.product_id, &r.sku, &r.name, &qty_str, &thresh_str],
            )
            .map_err(|e| CoreError::Internal(e.to_string()))?;
        }
        w.flush().map_err(|e| CoreError::Internal(e.to_string()))?;
        files.push(path_str);
    }

    // Category popularity (one row per top product, category context repeated)
    if !bundle.category_popularity.is_empty() {
        let (mut w, path_str) = create_writer("category_popularity.csv")?;
        w.write_all(b"category_id,category_name,product_count,mean_score,catalog_ratio,rank,sku,product_name,popularity_score,percentile\n")
            .map_err(|e| CoreError::Internal(e.to_string()))?;
        for cat in &bundle.category_popularity {
            let cat_name = cat.category_name.as_deref().unwrap_or_default();
            let count_str = cat.product_count.to_string();
            let mean_str = format!("{:.4}", cat.mean_score);
            let ratio_str = format!("{:.4}", cat.catalog_ratio);
            for p in &cat.top_products {
                let rank_str = p.rank.to_string();
                let pop_str = format!("{:.4}", p.popularity_score);
                let pct_str = format!("{:.4}", p.percentile);
                write_csv_row(
                    &mut w,
                    [
                        &cat.category_id,
                        cat_name,
                        &count_str,
                        &mean_str,
                        &ratio_str,
                        &rank_str,
                        &p.sku,
                        &p.name,
                        &pop_str,
                        &pct_str,
                    ],
                )
                .map_err(|e| CoreError::Internal(e.to_string()))?;
            }
        }
        w.flush().map_err(|e| CoreError::Internal(e.to_string()))?;
        files.push(path_str);
    }

    // Category demand forecast
    if !bundle.category_forecast.is_empty() {
        let (mut w, path_str) = create_writer("category_forecast.csv")?;
        w.write_all(
            b"category_id,category_name,forecast_units,trend_per_period,recent_avg_units\n",
        )
        .map_err(|e| CoreError::Internal(e.to_string()))?;
        for r in &bundle.category_forecast {
            let cat_name = r.category_name.as_deref().unwrap_or_default();
            let forecast_str = r.forecast_units.to_string();
            let trend_str = format!("{:.2}", r.trend_per_period);
            let avg_str = format!("{:.2}", r.recent_avg_units);
            write_csv_row(
                &mut w,
                [
                    &r.category_id,
                    cat_name,
                    &forecast_str,
                    &trend_str,
                    &avg_str,
                ],
            )
            .map_err(|e| CoreError::Internal(e.to_string()))?;
        }
        w.flush().map_err(|e| CoreError::Internal(e.to_string()))?;
        files.push(path_str);
    }

    // Active stock alerts
    if !bundle.active_stock_alerts.is_empty() {
        let (mut w, path_str) = create_writer("active_stock_alerts.csv")?;
        w.write_all(b"id,threshold_id,product_id,location_id,current_qty,threshold,status,triggered_at,product_sku,product_name\n")
            .map_err(|e| CoreError::Internal(e.to_string()))?;
        for r in &bundle.active_stock_alerts {
            let qty_str = r.current_qty.to_string();
            let thresh_str = r.threshold.to_string();
            write_csv_row(
                &mut w,
                [
                    &r.id,
                    &r.threshold_id,
                    &r.product_id,
                    &r.location_id,
                    &qty_str,
                    &thresh_str,
                    &r.status,
                    &r.triggered_at,
                    &r.product_sku,
                    &r.product_name,
                ],
            )
            .map_err(|e| CoreError::Internal(e.to_string()))?;
        }
        w.flush().map_err(|e| CoreError::Internal(e.to_string()))?;
        files.push(path_str);
    }

    Ok(files)
}

impl Store<'_> {
    /// Save the report schedule configuration to the settings table.
    pub fn save_report_schedule(&self, config: &ReportScheduleConfig) -> Result<(), CoreError> {
        let json = serde_json::to_string(config).map_err(|e| {
            CoreError::Internal(format!("failed to serialize report schedule: {e}"))
        })?;
        self.set_setting(REPORT_SCHEDULE_SETTINGS_KEY, &json)
    }

    /// Save the cloud export configuration to the settings table.
    ///
    /// The two credential FIELDS -- the BigQuery service-account key and the
    /// Snowflake password -- are sealed with [`crate::crypto`] before the JSON is
    /// written. Base64 is an encoding, not encryption, so without this the keys
    /// rode every `.db` / `.backup.db` snapshot in the clear (COR-17/30). The
    /// remaining fields (project/dataset/table/username/host) are identifiers, not
    /// secrets, and stay legible for operator debugging, exactly as
    /// `smtp_config` seals only its password field.
    pub fn save_cloud_export_config(
        &self,
        config: &cloud_destination::CloudExportConfig,
    ) -> Result<(), CoreError> {
        let sealed = cloud_destination::seal_cloud_export_credentials(config)?;
        let json = serde_json::to_string(&sealed).map_err(|e| {
            CoreError::Internal(format!("failed to serialize cloud export config: {e}"))
        })?;
        self.set_setting(CLOUD_EXPORT_SETTINGS_KEY, &json)
    }

    /// Load the cloud export configuration from the settings table.
    /// Returns `None` if no config has been saved yet.
    ///
    /// Unseals the credential fields sealed by [`Self::save_cloud_export_config`];
    /// a value saved before sealing was introduced is passed through as legacy
    /// plaintext, so an upgraded install keeps working and is re-sealed on its next
    /// save.
    pub fn get_cloud_export_config(
        &self,
    ) -> Result<Option<cloud_destination::CloudExportConfig>, CoreError> {
        let Some(raw) = self.get_setting(CLOUD_EXPORT_SETTINGS_KEY)? else {
            return Ok(None);
        };
        let config: cloud_destination::CloudExportConfig =
            serde_json::from_str(&raw).map_err(|e| {
                CoreError::Internal(format!("failed to deserialize cloud export config: {e}"))
            })?;
        Ok(Some(cloud_destination::unseal_cloud_export_credentials(
            config,
        )?))
    }

    /// Load the report schedule configuration from the settings table.
    /// Returns `None` if no schedule has been saved yet.
    pub fn get_report_schedule(&self) -> Result<Option<ReportScheduleConfig>, CoreError> {
        let Some(raw) = self.get_setting(REPORT_SCHEDULE_SETTINGS_KEY)? else {
            return Ok(None);
        };
        let config: ReportScheduleConfig = serde_json::from_str(&raw).map_err(|e| {
            CoreError::Internal(format!("failed to deserialize report schedule: {e}"))
        })?;
        Ok(Some(config))
    }

    /// Build a custom report from user-selected columns and filters.
    ///
    /// Column names are validated against a per-dataset whitelist — unrecognized
    /// columns are silently dropped. This prevents SQL injection while allowing
    /// flexible column selection from predefined options.
    ///
    /// # Supported datasets
    ///
    /// | Key | Table | Date filter |
    /// |-----|-------|-------------|
    /// | `sales` | `sales` | `created_at` |
    /// | `inventory` | `products` | none |
    /// | `customers` | `customers` | `created_at` |
    /// | `staff` | `users` | none |
    /// | `tax_rates` | `tax_rates` | none |
    /// | `shifts` | `shifts` | `opened_at` |
    ///
    /// # Limits
    ///
    /// The request may specify `limit` (clamped to 1000) and `offset`.
    /// The response includes a `truncated` flag indicating whether results
    /// were limited.
    pub fn build_custom_report(
        &self,
        req: CustomReportRequest,
    ) -> Result<CustomReportResponse, CoreError> {
        // Maximum rows per custom report request
        const MAX_LIMIT: u32 = 1000;

        let dataset = Self::get_dataset_def(&req.dataset)?;

        // Filter requested columns through the whitelist
        let safe_cols: Vec<&str> = req
            .columns
            .iter()
            .filter_map(|c| {
                dataset
                    .columns
                    .iter()
                    .find(|(col_name, _)| col_name == c)
                    .map(|(col_name, _)| *col_name)
            })
            .collect();

        if safe_cols.is_empty() {
            return Ok(CustomReportResponse {
                columns: Vec::new(),
                rows: Vec::new(),
                truncated: false,
            });
        }

        // Apply limit and offset (clamped to MAX_LIMIT)
        let limit = req.limit.map_or(MAX_LIMIT, |l| l.min(MAX_LIMIT));
        let offset = req.offset.unwrap_or(0);

        // Build safe SQL — column names come from our whitelist, table name
        // from our dataset definitions, both hardcoded and validated above.
        // Date values are parameterized to prevent SQL injection.
        let cols_sql = safe_cols.join(", ");
        let mut sql = format!("SELECT {} FROM {}", cols_sql, dataset.table);
        let mut params: Vec<String> = Vec::new();

        if dataset.has_date_filter {
            let date_col = dataset.date_column;
            // Validate the bounds at the door, as every other date-bounded
            // report does (REP-03). `DATE(col, tz) BETWEEN ?2 AND ?3` compares
            // the converted day as a plain string, so a mistyped bound matches
            // nothing: the report would come back empty with no error, which
            // is precisely why `check_date_bound` exists.
            if let Some(start) = req.start_date.as_deref() {
                crate::db::reports::check_date_bound("start_date", start)?;
            }
            if let Some(end) = req.end_date.as_deref() {
                crate::db::reports::check_date_bound("end_date", end)?;
            }
            let start = req
                .start_date
                .clone()
                .unwrap_or_else(|| "0000-01-01".into());
            let end = req.end_date.clone().unwrap_or_else(|| "9999-12-31".into());
            // REP-03: the range is in STORE-LOCAL days, exactly as every
            // date-bucketed report is, and this is that idiom —
            // `DATE(col, tz) BETWEEN start AND end`, the same shape
            // `db/reports/` uses at all 37 of its range predicates.
            //
            // It replaced a raw comparison against the column (`created_at >=
            // ?1`, and an exclusive next-day bound for the end). Two things
            // were wrong with that. The bound was once
            // `"{date} 23:59:59"` — a SPACE at index 10 where the column
            // (`strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`) has `T`, and
            // `' '` (0x20) sorts BELOW `'T'` (0x54), so a row stamped on the
            // end date itself compared GREATER than the bound and a single-day
            // report came back empty while its rows plainly existed.
            //
            // Fixing that left the deeper half: the column was still compared in
            // UTC while the user picks a LOCAL day. Measured on an
            // `Asia/Jakarta` store, a sale at `2026-07-31T20:00:00.000Z` is
            // 1 August locally — the reports path says August, this filter said
            // July. `DATE(col, tz)` removes both problems at once: the column is
            // converted to the store day before comparison, so the sub-second
            // shape stops mattering and the day means the operator's day.
            //
            // `tz` is `±HH:MM` from the single REP-03 resolver and is embedded
            // after that validation, so it can inject nothing beyond a date
            // modifier. An absent bound widens to an open end rather than
            // narrowing the range.
            let tz = self.tz_modifier();
            let param_idx = params.len() + 1;
            sql.push_str(&format!(
                " WHERE DATE({date_col}, ?{param_idx}) BETWEEN ?{} AND ?{}",
                param_idx + 1,
                param_idx + 2
            ));
            params.push(tz);
            params.push(start);
            params.push(end);
        }

        // Ask for one row past the page: with only `limit` rows fetched,
        // "everything was returned" and "there is more" are the same
        // observation, so `truncated` could not be decided from the result.
        let fetch = limit.saturating_add(1);
        sql.push_str(&format!(" LIMIT {fetch} OFFSET {offset}"));

        let mut stmt = self.conn.prepare(&sql).map_err(|e| {
            CoreError::Internal(format!("failed to prepare custom report query: {e}"))
        })?;

        let col_count = stmt.column_count();

        // Convert params to rusqlite-compatible references
        let param_refs: Vec<&dyn rusqlite::types::ToSql> = params
            .iter()
            .map(|s| s as &dyn rusqlite::types::ToSql)
            .collect();

        let mut rows = stmt
            .query_map(param_refs.as_slice(), |row| {
                let mut row_data = Vec::with_capacity(col_count);
                for i in 0..col_count {
                    let val: rusqlite::types::Value = row.get(i)?;
                    row_data.push(value_to_string(val));
                }
                Ok(row_data)
            })
            .map_err(|e| CoreError::Internal(format!("failed to query custom report: {e}")))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| {
                CoreError::Internal(format!("failed to collect custom report rows: {e}"))
            })?;

        // The extra row exists only to answer the flag; it is not part of the
        // page, and a page that exactly fills the limit withheld nothing.
        let truncated = rows.len() > limit as usize;
        rows.truncate(limit as usize);

        Ok(CustomReportResponse {
            columns: safe_cols.iter().map(|&s| s.to_string()).collect(),
            rows,
            truncated,
        })
    }

    /// Look up a dataset definition by key.
    fn get_dataset_def(key: &str) -> Result<DatasetDef, CoreError> {
        match key {
            "sales" => Ok(DatasetDef {
                table: "sales",
                columns: &[
                    ("id", "Sale ID"),
                    ("total_minor", "Total (minor)"),
                    ("created_at", "Created"),
                    ("status", "Status"),
                    ("customer_id", "Customer ID"),
                ],
                has_date_filter: true,
                date_column: "created_at",
            }),
            "inventory" => Ok(DatasetDef {
                table: "products",
                columns: &[
                    ("sku", "SKU"),
                    ("name", "Name"),
                    ("price_minor", "Price (minor)"),
                    ("category_id", "Category ID"),
                    ("barcode", "Barcode"),
                    ("product_type", "Type"),
                ],
                has_date_filter: false,
                date_column: "",
            }),
            "customers" => Ok(DatasetDef {
                table: "customers",
                columns: &[
                    ("id", "Customer ID"),
                    ("name", "Name"),
                    ("email", "Email"),
                    ("phone", "Phone"),
                    ("loyalty_points", "Loyalty Points"),
                    ("total_spent_minor", "Total Spent (minor)"),
                    ("created_at", "Created"),
                ],
                has_date_filter: true,
                date_column: "created_at",
            }),
            "staff" => Ok(DatasetDef {
                table: "users",
                columns: &[
                    ("id", "User ID"),
                    ("username", "Username"),
                    ("display_name", "Display Name"),
                    ("is_active", "Active"),
                    ("created_at", "Created"),
                ],
                has_date_filter: false,
                date_column: "",
            }),
            "tax_rates" => Ok(DatasetDef {
                table: "tax_rates",
                columns: &[
                    ("id", "Rate ID"),
                    ("name", "Name"),
                    ("rate_bps", "Rate (bps)"),
                    ("is_default", "Default"),
                    ("created_at", "Created"),
                ],
                has_date_filter: false,
                date_column: "",
            }),
            "shifts" => Ok(DatasetDef {
                table: "shifts",
                columns: &[
                    ("id", "Shift ID"),
                    ("user_id", "User ID"),
                    ("opened_at", "Opened"),
                    ("closed_at", "Closed"),
                    ("status", "Status"),
                    ("total_sales_minor", "Total Sales (minor)"),
                    ("opening_balance_minor", "Opening Balance"),
                    ("closing_balance_minor", "Closing Balance"),
                ],
                has_date_filter: true,
                date_column: "opened_at",
            }),
            _ => Err(CoreError::Validation {
                field: "dataset",
                message: format!(
                    "unknown dataset '{key}'. Supported: sales, inventory, customers, staff, tax_rates, shifts"
                ),
            }),
        }
    }
}

#[cfg(test)]
#[path = "mod_tests.rs"]
mod tests;
