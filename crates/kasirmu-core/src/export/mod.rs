//! Unified analytics export — collect all report data into a single JSON-bundle.
/*
last audited 25-07-26 by RSA-Agent (oz-core slice D1: export/mod deep read)
crate: oz-core | status: SAFE | lint: CLEAN
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
    /// Version of OZ-POS that generated this export.
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
fn csv_row(cells: impl Iterator<Item = String>) -> String {
    cells.map(|c| csv_cell(&c)).collect::<Vec<_>>().join(",")
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
    use std::path::Path;

    let root = Path::new(dir);
    fs::create_dir_all(root).map_err(|e| {
        CoreError::Internal(format!("failed to create export directory {dir}: {e}"))
    })?;

    let mut files: Vec<String> = Vec::new();

    let write = |name: &str, content: &str| -> Result<String, CoreError> {
        let path = root.join(name);
        fs::write(&path, content)
            .map_err(|e| CoreError::Internal(format!("failed to write {name}: {e}")))?;
        Ok(path.to_string_lossy().to_string())
    };

    // metadata.json
    let meta_json = serde_json::to_string_pretty(&bundle.metadata)
        .map_err(|e| CoreError::Internal(format!("failed to serialize metadata: {e}")))?;
    files.push(write("metadata.json", &meta_json)?);

    // Daily revenue
    if !bundle.daily_revenue.is_empty() {
        let mut csv = String::from("date,total_minor,currency,sale_count\n");
        for r in &bundle.daily_revenue {
            csv.push_str(&csv_row(
                [
                    r.date.clone(),
                    r.total_minor.to_string(),
                    r.currency.clone(),
                    r.sale_count.to_string(),
                ]
                .into_iter(),
            ));
            csv.push('\n');
        }
        files.push(write("daily_revenue.csv", &csv)?);
    }

    // Weekly revenue
    if !bundle.weekly_revenue.is_empty() {
        let mut csv = String::from("week_start,total_minor,currency,sale_count\n");
        for r in &bundle.weekly_revenue {
            csv.push_str(&csv_row(
                [
                    r.week_start.clone(),
                    r.total_minor.to_string(),
                    r.currency.clone(),
                    r.sale_count.to_string(),
                ]
                .into_iter(),
            ));
            csv.push('\n');
        }
        files.push(write("weekly_revenue.csv", &csv)?);
    }

    // Monthly revenue
    if !bundle.monthly_revenue.is_empty() {
        let mut csv = String::from("month,total_minor,currency,sale_count\n");
        for r in &bundle.monthly_revenue {
            csv.push_str(&csv_row(
                [
                    r.month.clone(),
                    r.total_minor.to_string(),
                    r.currency.clone(),
                    r.sale_count.to_string(),
                ]
                .into_iter(),
            ));
            csv.push('\n');
        }
        files.push(write("monthly_revenue.csv", &csv)?);
    }

    // Top products
    if !bundle.top_products.is_empty() {
        let mut csv = String::from("sku,name,total_qty,total_minor\n");
        for r in &bundle.top_products {
            csv.push_str(&csv_row(
                [
                    r.sku.clone(),
                    r.name.clone(),
                    r.total_qty.to_string(),
                    r.total_minor.to_string(),
                ]
                .into_iter(),
            ));
            csv.push('\n');
        }
        files.push(write("top_products.csv", &csv)?);
    }

    // Hourly heatmap
    if !bundle.hourly_heatmap.is_empty() {
        let mut csv = String::from("day_of_week,hour,total_minor,sale_count\n");
        for r in &bundle.hourly_heatmap {
            csv.push_str(&csv_row(
                [
                    r.day_of_week.to_string(),
                    r.hour.to_string(),
                    r.total_minor.to_string(),
                    r.sale_count.to_string(),
                ]
                .into_iter(),
            ));
            csv.push('\n');
        }
        files.push(write("hourly_heatmap.csv", &csv)?);
    }

    // Category breakdown
    if !bundle.category_breakdown.is_empty() {
        let mut csv = String::from("category_name,total_minor,sale_count,percentage\n");
        for r in &bundle.category_breakdown {
            csv.push_str(&csv_row(
                [
                    r.category_name.clone(),
                    r.total_minor.to_string(),
                    r.sale_count.to_string(),
                    format!("{:.1}", r.percentage),
                ]
                .into_iter(),
            ));
            csv.push('\n');
        }
        files.push(write("category_breakdown.csv", &csv)?);
    }

    // Low stock alerts
    if !bundle.low_stock_alerts.is_empty() {
        let mut csv = String::from("product_id,sku,name,current_qty,threshold\n");
        for r in &bundle.low_stock_alerts {
            csv.push_str(&csv_row(
                [
                    r.product_id.clone(),
                    r.sku.clone(),
                    r.name.clone(),
                    r.current_qty.to_string(),
                    r.threshold.to_string(),
                ]
                .into_iter(),
            ));
            csv.push('\n');
        }
        files.push(write("low_stock_alerts.csv", &csv)?);
    }

    // Category popularity (one row per top product, category context repeated)
    if !bundle.category_popularity.is_empty() {
        let mut csv = String::from(
            "category_id,category_name,product_count,mean_score,catalog_ratio,rank,sku,product_name,popularity_score,percentile\n",
        );
        for cat in &bundle.category_popularity {
            for p in &cat.top_products {
                csv.push_str(&csv_row(
                    [
                        cat.category_id.clone(),
                        cat.category_name.clone().unwrap_or_default(),
                        cat.product_count.to_string(),
                        format!("{:.4}", cat.mean_score),
                        format!("{:.4}", cat.catalog_ratio),
                        p.rank.to_string(),
                        p.sku.clone(),
                        p.name.clone(),
                        format!("{:.4}", p.popularity_score),
                        format!("{:.4}", p.percentile),
                    ]
                    .into_iter(),
                ));
                csv.push('\n');
            }
        }
        files.push(write("category_popularity.csv", &csv)?);
    }

    // Category demand forecast
    if !bundle.category_forecast.is_empty() {
        let mut csv = String::from(
            "category_id,category_name,forecast_units,trend_per_period,recent_avg_units\n",
        );
        for r in &bundle.category_forecast {
            csv.push_str(&csv_row(
                [
                    r.category_id.clone(),
                    r.category_name.clone().unwrap_or_default(),
                    r.forecast_units.to_string(),
                    format!("{:.2}", r.trend_per_period),
                    format!("{:.2}", r.recent_avg_units),
                ]
                .into_iter(),
            ));
            csv.push('\n');
        }
        files.push(write("category_forecast.csv", &csv)?);
    }

    // Active stock alerts
    if !bundle.active_stock_alerts.is_empty() {
        let mut csv = String::from(
            "id,threshold_id,product_id,location_id,current_qty,threshold,status,triggered_at,product_sku,product_name\n",
        );
        for r in &bundle.active_stock_alerts {
            csv.push_str(&csv_row(
                [
                    r.id.clone(),
                    r.threshold_id.clone(),
                    r.product_id.clone(),
                    r.location_id.clone(),
                    r.current_qty.to_string(),
                    r.threshold.to_string(),
                    r.status.clone(),
                    r.triggered_at.clone(),
                    r.product_sku.clone(),
                    r.product_name.clone(),
                ]
                .into_iter(),
            ));
            csv.push('\n');
        }
        files.push(write("active_stock_alerts.csv", &csv)?);
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
    pub fn save_cloud_export_config(
        &self,
        config: &cloud_destination::CloudExportConfig,
    ) -> Result<(), CoreError> {
        let json = serde_json::to_string(config).map_err(|e| {
            CoreError::Internal(format!("failed to serialize cloud export config: {e}"))
        })?;
        self.set_setting(CLOUD_EXPORT_SETTINGS_KEY, &json)
    }

    /// Load the cloud export configuration from the settings table.
    /// Returns `None` if no config has been saved yet.
    pub fn get_cloud_export_config(
        &self,
    ) -> Result<Option<cloud_destination::CloudExportConfig>, CoreError> {
        let raw = match self.get_setting(CLOUD_EXPORT_SETTINGS_KEY)? {
            Some(v) => v,
            None => return Ok(None),
        };
        let config: cloud_destination::CloudExportConfig =
            serde_json::from_str(&raw).map_err(|e| {
                CoreError::Internal(format!("failed to deserialize cloud export config: {e}"))
            })?;
        Ok(Some(config))
    }

    /// Load the report schedule configuration from the settings table.
    /// Returns `None` if no schedule has been saved yet.
    pub fn get_report_schedule(&self) -> Result<Option<ReportScheduleConfig>, CoreError> {
        let raw = match self.get_setting(REPORT_SCHEDULE_SETTINGS_KEY)? {
            Some(v) => v,
            None => return Ok(None),
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
        let limit = req.limit.map(|l| l.min(MAX_LIMIT)).unwrap_or(MAX_LIMIT);
        let offset = req.offset.unwrap_or(0);

        // Build safe SQL — column names come from our whitelist, table name
        // from our dataset definitions, both hardcoded and validated above.
        // Date values are parameterized to prevent SQL injection.
        let cols_sql = safe_cols.join(", ");
        let mut sql = format!("SELECT {} FROM {}", cols_sql, dataset.table);
        let mut params: Vec<String> = Vec::new();

        if dataset.has_date_filter {
            let date_col = dataset.date_column;
            if let Some(ref start_date) = req.start_date {
                sql.push_str(&format!(" WHERE {} >= ?1", date_col));
                params.push(start_date.clone());
            }
            if let Some(ref end_date) = req.end_date {
                let param_idx = params.len() + 1;
                let where_clause = if req.start_date.is_some() {
                    " AND"
                } else {
                    " WHERE"
                };
                sql.push_str(&format!("{} {} <= ?{}", where_clause, date_col, param_idx));
                params.push(format!("{} 23:59:59", end_date));
            }
        }

        // Add LIMIT and OFFSET
        sql.push_str(&format!(" LIMIT {} OFFSET {}", limit, offset));

        let mut stmt = self.conn.prepare(&sql).map_err(|e| {
            CoreError::Internal(format!("failed to prepare custom report query: {e}"))
        })?;

        let col_count = stmt.column_count();

        // Convert params to rusqlite-compatible references
        let param_refs: Vec<&dyn rusqlite::types::ToSql> = params
            .iter()
            .map(|s| s as &dyn rusqlite::types::ToSql)
            .collect();

        let rows = stmt
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

        let truncated = rows.len() >= limit as usize;

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
