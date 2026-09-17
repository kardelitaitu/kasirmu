//! Cloud warehouse export destinations for the analytics bundle.
/*
last audited 31-08-26 by TDD-Agent (rounds H+I follow-up to slice D2; identifiers validated, request bounds added)
crate: oz-core | status: SAFE | lint: CLEAN
findings: COR-35 FIXED 25-07-26 for VALUES only — bind variables take row values out of the SQL text, but database/schema/table were still interpolated into the INSERT verbatim, and project_id/dataset/table into the insertAll URL path. Both closed in round H: snowflake_insert_statement and bigquery_insert_url are pure, tested, and reject anything outside the identifier grammar. The stamp's "eliminating the backslash-escape injection class" read as the class being shut, which is why the other half sat open for a month. COR-31 FIXED HERE in round I: all three request sites now build through http_client(), which bounds connect (10s) and total (120s) time; the total stays above the 60s statement timeout the request itself asks for, and a test pins that relationship. COR-31 repo-wide status, corrected in round L: an earlier version of this stamp claimed "15 untimed Client::new() sites in 10 other files" and that number was WRONG — it was produced by grepping for Client::new() and .build() without checking whether the resulting request carried a request-level .timeout(). It counted doc-comment mentions, MockNotificationClient::new() examples, and code that was already bounded. The measured set was 7 sites in 4 files: whatsapp x2, sync_pull x1, platform/startup/rate_sync x1 (all three fixed in round L), plus the three oz-payment drivers (stripe, square, qris), which are genuinely untimed but were deliberately LEFT that way — see the payment note. license_verification x5 and sync_client are already bounded by RequestBuilder::timeout and never needed anything. Lesson recorded where the bad claim was written: an unbounded-request audit has to end at the request, not at the client. Still open, unchanged: service-account key + Snowflake password persisted in settings JSON (base64 != encryption, COR-17/30 family).
next: encrypt stored warehouse credentials (COR-17/30); wire save/get_cloud_export_config to a caller — neither has one today, which is the only reason the above are latent; carry the http_client() pattern to the 15 remaining COR-31 sites | perf: 50-row batched inserts
*/
//!
//! Defines export targets (BigQuery, Snowflake) and their respective
//! connection configurations. The [`CloudExporter`] trait provides a
//! uniform interface for sending [`AnalyticsBundle`](super::AnalyticsBundle)
//! data to each destination via REST/HTTP.
//!
//! # Configuration
//!
//! The [`CloudExportConfig`] is persisted in the `settings` table under
//! key `cloud_export_config` as JSON (same pattern as
//! [`ReportScheduleConfig`](super::ReportScheduleConfig)), reached through
//! `Store::get_cloud_export_config`. Destination identifiers
//! (`database`/`schema`/`table`, `project_id`/`dataset`/`table`) are
//! allow-listed before use: bind variables protect values, never
//! identifiers, and identifiers are interpolated verbatim into the SQL
//! statement and the insertAll URL path (B51).
//!
//! # Usage
//!
//! ```rust,ignore
//! let config = store
//!     .get_cloud_export_config()?
//!     .expect("cloud export is not configured");
//! let result = CloudExporter::export(&bundle, &config).await?;
//! ```

use serde::{Deserialize, Serialize};

/// Supported cloud warehouse destinations.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ExportDestination {
    /// Google BigQuery — requires a service-account JSON key.
    BigQuery(BigQueryConfig),
    /// Snowflake — requires account URL + user credentials.
    Snowflake(SnowflakeConfig),
}

impl ExportDestination {
    /// Human-readable label for the destination type.
    pub fn label(&self) -> &str {
        match self {
            Self::BigQuery(_) => "BigQuery",
            Self::Snowflake(_) => "Snowflake",
        }
    }
}

/// BigQuery connection configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BigQueryConfig {
    /// GCP project ID.
    pub project_id: String,
    /// BigQuery dataset name.
    pub dataset: String,
    /// BigQuery table name.
    pub table: String,
    /// Service-account JSON key (base64-encoded for safe storage).
    pub service_account_key_b64: String,
    /// GCP region for the dataset (e.g. "US", "asia-southeast2").
    pub location: String,
}

impl BigQueryConfig {
    /// Create a new BigQuery config.
    pub fn new(
        project_id: impl Into<String>,
        dataset: impl Into<String>,
        table: impl Into<String>,
        service_account_key_b64: impl Into<String>,
        location: impl Into<String>,
    ) -> Self {
        Self {
            project_id: project_id.into(),
            dataset: dataset.into(),
            table: table.into(),
            service_account_key_b64: service_account_key_b64.into(),
            location: location.into(),
        }
    }
}

/// Snowflake connection configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnowflakeConfig {
    /// Snowflake account URL (e.g. `https://xyz12345.us-east-1.snowflakecomputing.com`).
    pub account_url: String,
    /// Snowflake warehouse name.
    pub warehouse: String,
    /// Database name.
    pub database: String,
    /// Schema name.
    pub schema: String,
    /// Table name for ingestion.
    pub table: String,
    /// Username for authentication.
    pub username: String,
    /// Password or private key for authentication.
    pub password: String,
}

impl SnowflakeConfig {
    /// Create a new Snowflake config.
    pub fn new(
        account_url: impl Into<String>,
        warehouse: impl Into<String>,
        database: impl Into<String>,
        schema: impl Into<String>,
        table: impl Into<String>,
        username: impl Into<String>,
        password: impl Into<String>,
    ) -> Self {
        Self {
            account_url: account_url.into(),
            warehouse: warehouse.into(),
            database: database.into(),
            schema: schema.into(),
            table: table.into(),
            username: username.into(),
            password: password.into(),
        }
    }
}

/// Persisted configuration for cloud warehouse export.
///
/// Stored in the `settings` table under key `cloud_export_config`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudExportConfig {
    /// Whether cloud export is enabled.
    pub enabled: bool,
    /// Selected destination.
    pub destination: ExportDestination,
    /// Include all report types or only selected ones.
    pub include_all_reports: bool,
    /// Specific report types to include when `include_all_reports` is false.
    pub report_types: Vec<String>,
}

impl Default for CloudExportConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            destination: ExportDestination::BigQuery(BigQueryConfig::new("", "", "", "", "")),
            include_all_reports: true,
            report_types: Vec::new(),
        }
    }
}

/// Settings key used to persist the cloud export config.
pub const CLOUD_EXPORT_SETTINGS_KEY: &str = "cloud_export_config";

/// Result of a cloud export operation.
#[derive(Debug, Clone, Serialize)]
pub struct CloudExportResult {
    /// Whether the export succeeded.
    pub success: bool,
    /// Number of rows exported.
    pub rows_exported: u64,
    /// Human-readable message (success detail or error).
    pub message: String,
}

/// Trait for exporting analytics data to cloud warehouse destinations.
pub struct CloudExporter;

impl CloudExporter {
    /// Export an analytics bundle to the configured cloud destination.
    ///
    /// Dispatches to the appropriate destination-specific implementation
    /// based on the `config.destination` variant.
    pub async fn export(
        bundle: &super::AnalyticsBundle,
        config: &CloudExportConfig,
    ) -> Result<CloudExportResult, crate::error::CoreError> {
        match &config.destination {
            ExportDestination::BigQuery(bq_config) => {
                Self::export_to_bigquery(bundle, bq_config).await
            }
            ExportDestination::Snowflake(sf_config) => {
                Self::export_to_snowflake(bundle, sf_config).await
            }
        }
    }

    /// Send analytics data to Google BigQuery via the Storage Write API
    /// (REST endpoint using service-account authentication).
    async fn export_to_bigquery(
        bundle: &super::AnalyticsBundle,
        config: &BigQueryConfig,
    ) -> Result<CloudExportResult, crate::error::CoreError> {
        // Decode the service-account key.
        let key_bytes = base64_decode(&config.service_account_key_b64)
            .map_err(|e| crate::error::CoreError::Internal(format!("invalid base64 key: {e}")))?;

        let key_json = String::from_utf8(key_bytes).map_err(|_| {
            crate::error::CoreError::Internal("service-account key is not valid UTF-8".into())
        })?;

        let _key: serde_json::Value = serde_json::from_str(&key_json).map_err(|e| {
            crate::error::CoreError::Internal(format!("invalid service-account JSON: {e}"))
        })?;

        // Serialise the bundle to NDJSON — one JSON object per row.
        let ndjson = bundle_to_ndjson(bundle);
        let row_count = ndjson.len();

        // Call BigQuery's tabledata.insertAll REST API.
        // This is a streaming insert — suitable for real-time analytics.
        let url = bigquery_insert_url(&config.project_id, &config.dataset, &config.table)?;

        let client = http_client().map_err(|e| {
            crate::error::CoreError::Internal(format!("failed to build HTTP client: {e}"))
        })?;

        // Obtain an OAuth2 access token from the service-account key.
        let access_token = get_gcp_access_token(&key_json).await.map_err(|e| {
            crate::error::CoreError::Internal(format!("failed to get GCP token: {e}"))
        })?;

        let payload = serde_json::json!({
            "kind": "bigquery#tableDataInsertAllRequest",
            "rows": ndjson.iter().map(|row| {
                serde_json::json!({"json": row})
            }).collect::<Vec<_>>(),
        });

        let resp = client
            .post(&url)
            .bearer_auth(&access_token)
            .json(&payload)
            .send()
            .await
            .map_err(|e| {
                crate::error::CoreError::Internal(format!("BigQuery request failed: {e}"))
            })?;

        let status = resp.status();
        let body: serde_json::Value = resp.json().await.unwrap_or_default();

        if status.is_success() {
            Ok(CloudExportResult {
                success: true,
                rows_exported: row_count as u64,
                message: format!(
                    "Exported {} rows to BigQuery {}.{}",
                    row_count, config.dataset, config.table
                ),
            })
        } else {
            Ok(CloudExportResult {
                success: false,
                rows_exported: 0,
                message: format!(
                    "BigQuery returned {}: {}",
                    status,
                    body.get("error")
                        .and_then(|e| e.get("message"))
                        .and_then(|m| m.as_str())
                        .unwrap_or("unknown error")
                ),
            })
        }
    }

    /// Send analytics data to Snowflake via the SQL REST API.
    ///
    /// Uses Snowflake's SQL statement execution endpoint to INSERT rows
    /// into the configured table via bulk INSERT statements (batched
    /// for efficiency).
    async fn export_to_snowflake(
        bundle: &super::AnalyticsBundle,
        config: &SnowflakeConfig,
    ) -> Result<CloudExportResult, crate::error::CoreError> {
        let ndjson = bundle_to_ndjson(bundle);
        let row_count = ndjson.len();

        if row_count == 0 {
            return Ok(CloudExportResult {
                success: true,
                rows_exported: 0,
                message: "No data to export — bundle is empty.".to_string(),
            });
        }

        let client = http_client().map_err(|e| {
            crate::error::CoreError::Internal(format!("failed to build HTTP client: {e}"))
        })?;

        // Step 1: Authenticate and get a session token.
        let login_url = format!("{}/session/v1/login-request", config.account_url);

        // Obtain a session token via basic-auth login.
        let auth_resp = client
            .post(&login_url)
            .json(&serde_json::json!({
                "data": {
                    "LOGIN_NAME": config.username,
                    "PASSWORD": config.password,
                }
            }))
            .send()
            .await
            .map_err(|e| {
                crate::error::CoreError::Internal(format!("Snowflake auth request failed: {e}"))
            })?;

        let auth_body: serde_json::Value = auth_resp.json().await.unwrap_or_default();
        let token = auth_body["data"]["token"].as_str().ok_or_else(|| {
            crate::error::CoreError::Internal("Snowflake auth failed — no token returned".into())
        })?;

        // Step 2: Build INSERT statements in batches (50 rows per batch).
        let batch_size = 50;

        for chunk in ndjson.chunks(batch_size) {
            let sql = snowflake_insert_statement(
                &config.database,
                &config.schema,
                &config.table,
                chunk.len(),
            )?;

            // Bindings are 1-based string keys in request order; each value is a
            // RAW (unescaped) string — the driver applies the escaping.
            let mut bindings = serde_json::Map::new();
            let mut bind_index = 0usize;
            for row in chunk {
                let exported_at = row
                    .get("exported_at")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let tenant_id = row.get("tenant_id").and_then(|v| v.as_str()).unwrap_or("");
                let store_name = row.get("store_name").and_then(|v| v.as_str()).unwrap_or("");
                let report_type = row
                    .get("report_type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown");
                let report_data = serde_json::to_string(row).unwrap_or_default();
                for value in [
                    exported_at,
                    tenant_id,
                    store_name,
                    report_type,
                    &report_data,
                ] {
                    bind_index += 1;
                    bindings.insert(
                        bind_index.to_string(),
                        serde_json::json!({ "type": "TEXT", "value": value }),
                    );
                }
            }

            let stmt_url = format!("{}/api/v2/statements", config.account_url);

            let stmt_resp = client
                .post(&stmt_url)
                .header("Authorization", format!("Bearer {token}"))
                .header("Content-Type", "application/json")
                .header("Accept", "application/json")
                .json(&serde_json::json!({
                    "statement": sql,
                    "bindings": bindings,
                    "timeout": SNOWFLAKE_STATEMENT_TIMEOUT_SECS,
                    "database": config.database,
                    "schema": config.schema,
                    "warehouse": config.warehouse,
                }))
                .send()
                .await
                .map_err(|e| {
                    crate::error::CoreError::Internal(format!(
                        "Snowflake INSERT request failed: {e}"
                    ))
                })?;

            let stmt_status = stmt_resp.status();
            let stmt_body: serde_json::Value = stmt_resp.json().await.unwrap_or_default();

            if !stmt_status.is_success() {
                return Ok(CloudExportResult {
                    success: false,
                    rows_exported: 0,
                    message: format!(
                        "Snowflake INSERT returned {}: {}",
                        stmt_status,
                        stmt_body
                            .get("message")
                            .and_then(|m| m.as_str())
                            .unwrap_or("unknown error")
                    ),
                });
            }
        }

        Ok(CloudExportResult {
            success: true,
            rows_exported: row_count as u64,
            message: format!(
                "Exported {} rows to Snowflake {}.{}.{}",
                row_count, config.database, config.schema, config.table
            ),
        })
    }
}

/// Columns the Snowflake exporter writes, in bind order.
const SNOWFLAKE_COLUMNS: [&str; 5] = [
    "exported_at",
    "tenant_id",
    "store_name",
    "report_type",
    "report_data",
];

/// Seconds the Snowflake statements API is told a batch may take.
const SNOWFLAKE_STATEMENT_TIMEOUT_SECS: u64 = 60;

/// Connect bound for every warehouse request. Short on purpose: this covers
/// a host that neither accepts the connection nor refuses it, which needs
/// no server cooperation to detect.
const HTTP_CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

/// Overall bound. Must stay above [`SNOWFLAKE_STATEMENT_TIMEOUT_SECS`] or
/// the client would abort batches the warehouse is still legitimately
/// running — a worse bug than the hang being fixed. Pinned by a test.
const HTTP_REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(120);

/// Build the HTTP client used for every warehouse request in this module.
///
/// COR-31: these clients used to be `reqwest::Client::new()`, which has NO
/// timeout at all. A warehouse endpoint that accepts the TCP connection and
/// then stops answering parks the export task forever, and whoever
/// triggered the export — a schedule or an operator pressing a button —
/// waits on it indefinitely.
///
/// reqwest 0.27 exposes no getter for either bound, so "is the client
/// bounded" is guaranteed by construction instead: this is the only client
/// constructor in the module and all three request sites call it. What the
/// test pins is the relationship between the two numbers, which is the part
/// a future edit can get wrong silently.
fn http_client() -> Result<reqwest::Client, reqwest::Error> {
    reqwest::Client::builder()
        .connect_timeout(HTTP_CONNECT_TIMEOUT)
        .timeout(HTTP_REQUEST_TIMEOUT)
        .build()
}

/// Is `s` a Snowflake identifier we are willing to write into SQL text?
///
/// Deliberately the strict unquoted form — `[A-Za-z_][A-Za-z0-9_$]*`, at
/// most 255 chars — rather than double-quoting the value. Quoting would
/// accept more names but silently changes Snowflake's semantics
/// (quoted identifiers are case-sensitive, so `"MYTABLE"` stops matching
/// a table created as `MYTABLE`), and it still needs to reject an
/// embedded `"`. Rejecting is the honest option: identifiers cannot be
/// bound, so they are the one part of the statement that must be
/// validated rather than transported.
fn is_safe_sql_identifier(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 255
        && s.starts_with(|c: char| c.is_ascii_alphabetic() || c == '_')
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$')
}

/// Is `s` a GCP project ID? Separate rule because project IDs legitimately
/// contain hyphens (`my-project-123`), which Snowflake and BigQuery
/// identifiers must not — applying the SQL rule here rejected real configs.
/// A hyphen cannot break out of a URL path segment, so it is safe to allow;
/// `.`, `/`, `?`, `#`, whitespace and quotes stay rejected.
fn is_safe_gcp_project_id(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 63
        && s.starts_with(|c: char| c.is_ascii_alphabetic() || c == '_')
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// Build the BigQuery `tabledata.insertAll` URL.
///
/// Extracted so the identifiers can be checked without an HTTP server.
/// The host is a literal, so a hostile value cannot redirect the request
/// or carry the bearer token elsewhere — but `?`, `#`, `/` or a space in
/// a project/dataset/table field would silently retarget or truncate the
/// API call, sending rows somewhere other than the configured table.
fn bigquery_insert_url(
    project_id: &str,
    dataset: &str,
    table: &str,
) -> Result<String, crate::error::CoreError> {
    if !is_safe_gcp_project_id(project_id) {
        return Err(crate::error::CoreError::Validation {
            field: "project_id",
            message: format!(
                "{project_id:?} is not a valid GCP project id; it is interpolated into the \
                 insertAll URL path, so it must start with a letter or underscore and contain \
                 only letters, digits, '_' and '-'"
            ),
        });
    }
    for (field, value) in [("dataset", dataset), ("table", table)] {
        if !is_safe_sql_identifier(value) {
            return Err(crate::error::CoreError::Validation {
                field,
                message: format!(
                    "{value:?} is not a valid BigQuery identifier; it is interpolated into the \
                     insertAll URL path, so it must start with a letter or underscore and \
                     contain only letters, digits, '_' and '$"
                ),
            });
        }
    }
    Ok(format!(
        "https://bigquery.googleapis.com/bigquery/v2/projects/{project_id}/datasets/{dataset}/tables/{table}/insertAll"
    ))
}

/// Build the batched `INSERT` for `row_count` rows.
///
/// Split out of the HTTP shell in `send_to_snowflake` so the statement
/// text — the artifact COR-35 changed, and the only part that reaches the
/// customer's warehouse as SQL — can be asserted without a server.
fn snowflake_insert_statement(
    database: &str,
    schema: &str,
    table: &str,
    row_count: usize,
) -> Result<String, crate::error::CoreError> {
    // COR-35 closed the VALUES half of the injection class; this closes
    // the other half. Bind variables take values out of the SQL text but
    // do nothing for identifiers, which are still interpolated below
    // straight from the persisted `cloud_export_config` setting.
    for (field, value) in [("database", database), ("schema", schema), ("table", table)] {
        if !is_safe_sql_identifier(value) {
            return Err(crate::error::CoreError::Validation {
                field,
                message: format!(
                    "{value:?} is not a valid Snowflake identifier; it would be written into \
                     the statement as SQL text, so it must start with a letter or underscore \
                     and contain only letters, digits, '_' and '$ (max 255 chars)"
                ),
            });
        }
    }

    // COR-35 fix: build the statement with bind variables ("?" placeholders
    // plus a "bindings" map) instead of string-concatenated, quote-escaped
    // literals. Snowflake treats "\" as an escape inside string literals,
    // so a user-controlled value ending in a backslash (product/store
    // names) previously escaped the closing quote and broke out of the
    // literal — SQL injection into the customer's warehouse. Bind values
    // are transported out-of-band and never parsed as SQL text.
    let row_placeholder = "(?, ?, ?, ?, PARSE_JSON(?))";
    let mut sql = format!(
        "INSERT INTO {}.{}.{} ({}) VALUES ",
        database,
        schema,
        table,
        SNOWFLAKE_COLUMNS.join(", ")
    );
    sql.push_str(
        &std::iter::repeat_n(row_placeholder, row_count)
            .collect::<Vec<_>>()
            .join(", "),
    );
    sql.push(';');
    Ok(sql)
}

/// Convert an AnalyticsBundle to NDJSON rows, one per report type.
fn bundle_to_ndjson(bundle: &super::AnalyticsBundle) -> Vec<serde_json::Value> {
    let mut rows = Vec::new();
    let meta = &bundle.metadata;

    // Helper to stamp each row with export metadata.
    let stamp = |report_type: &str, data: serde_json::Value| -> serde_json::Value {
        serde_json::json!({
            "exported_at": meta.exported_at,
            "tenant_id": meta.tenant_id,
            "store_name": meta.store_name,
            "version": meta.version,
            "report_type": report_type,
            "data": data,
        })
    };

    // Daily revenue
    for r in &bundle.daily_revenue {
        if let Ok(val) = serde_json::to_value(r) {
            rows.push(stamp("daily_revenue", val));
        }
    }

    // Weekly revenue
    for r in &bundle.weekly_revenue {
        if let Ok(val) = serde_json::to_value(r) {
            rows.push(stamp("weekly_revenue", val));
        }
    }

    // Monthly revenue
    for r in &bundle.monthly_revenue {
        if let Ok(val) = serde_json::to_value(r) {
            rows.push(stamp("monthly_revenue", val));
        }
    }

    // Top products
    for r in &bundle.top_products {
        if let Ok(val) = serde_json::to_value(r) {
            rows.push(stamp("top_products", val));
        }
    }

    // Hourly heatmap
    for r in &bundle.hourly_heatmap {
        if let Ok(val) = serde_json::to_value(r) {
            rows.push(stamp("hourly_heatmap", val));
        }
    }

    // Category breakdown
    for r in &bundle.category_breakdown {
        if let Ok(val) = serde_json::to_value(r) {
            rows.push(stamp("category_breakdown", val));
        }
    }

    // Low stock alerts
    for r in &bundle.low_stock_alerts {
        if let Ok(val) = serde_json::to_value(r) {
            rows.push(stamp("low_stock_alerts", val));
        }
    }

    // Active stock alerts
    for r in &bundle.active_stock_alerts {
        if let Ok(val) = serde_json::to_value(r) {
            rows.push(stamp("active_stock_alerts", val));
        }
    }

    // Category popularity (top products nested per category row)
    for r in &bundle.category_popularity {
        if let Ok(val) = serde_json::to_value(r) {
            rows.push(stamp("category_popularity", val));
        }
    }

    // Category demand forecast
    for r in &bundle.category_forecast {
        if let Ok(val) = serde_json::to_value(r) {
            rows.push(stamp("category_forecast", val));
        }
    }

    rows
}

/// Base64-decode a string.
fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    let engine = base64::engine::general_purpose::STANDARD;
    Engine::decode(&engine, input.as_bytes()).map_err(|e| format!("base64 decode: {e}"))
}

/// Obtain a GCP OAuth2 access token using a service-account JSON key.
async fn get_gcp_access_token(key_json: &str) -> Result<String, String> {
    let key: serde_json::Value =
        serde_json::from_str(key_json).map_err(|e| format!("parse key: {e}"))?;

    let client_email = key["client_email"]
        .as_str()
        .ok_or("missing client_email in service-account key")?;
    let private_key = key["private_key"]
        .as_str()
        .ok_or("missing private_key in service-account key")?;

    // Create a JWT assertion for GCP OAuth.
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let header = serde_json::json!({
        "alg": "RS256",
        "typ": "JWT",
        "kid": key["private_key_id"],
    });

    let claims = serde_json::json!({
        "iss": client_email,
        "scope": "https://www.googleapis.com/auth/bigquery.insertdata",
        "aud": "https://oauth2.googleapis.com/token",
        "exp": now + 3600,
        "iat": now,
    });

    use base64::Engine;
    let b64_engine = base64::engine::general_purpose::URL_SAFE_NO_PAD;
    let header_b64 = b64_engine.encode(
        serde_json::to_string(&header)
            .unwrap_or_default()
            .as_bytes(),
    );
    let claims_b64 = b64_engine.encode(
        serde_json::to_string(&claims)
            .unwrap_or_default()
            .as_bytes(),
    );

    let message = format!("{header_b64}.{claims_b64}");

    // Sign the JWT with the RSA private key.
    let signature = sign_rsa256(&message, private_key)?;
    let signature_b64 = b64_engine.encode(signature);

    let assertion = format!("{message}.{signature_b64}");

    // Exchange the assertion for an access token.
    let client = http_client().map_err(|e| format!("failed to build HTTP client: {e}"))?;
    let resp = client
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer"),
            ("assertion", &assertion),
        ])
        .send()
        .await
        .map_err(|e| format!("token request: {e}"))?;

    let body: serde_json::Value = resp.json().await.map_err(|e| format!("parse token: {e}"))?;
    body["access_token"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| {
            format!(
                "no access_token in response: {}",
                serde_json::to_string(&body).unwrap_or_default()
            )
        })
}

/// Sign a string with an RSA256 private key (PKCS#8 PEM format).
///
/// GCP service-account keys are always PKCS#8 format, so only
/// PKCS#8 PEM parsing is needed.
fn sign_rsa256(message: &str, private_key_pem: &str) -> Result<Vec<u8>, String> {
    use rsa::RsaPrivateKey;
    use rsa::pkcs1v15::SigningKey;
    use rsa::pkcs8::DecodePrivateKey;
    use rsa::signature::{SignatureEncoding, Signer};
    use sha2::Sha256;

    // Parse the PEM-encoded private key directly via rsa's PEM feature.
    let private_key = RsaPrivateKey::from_pkcs8_pem(private_key_pem)
        .map_err(|e| format!("RSA key parse from PEM: {e}"))?;

    // PKCS#1 v1.5 sign using the established pattern from license_verification.rs.
    let signing_key = SigningKey::<Sha256>::new(private_key);
    let signature = signing_key.sign(message.as_bytes());

    Ok(signature.to_vec())
}

#[cfg(test)]
#[path = "cloud_destination_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "cloud_destination_sql_tests.rs"]
mod sql_tests;
