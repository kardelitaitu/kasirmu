use super::*;
use crate::export::AnalyticsBundle;
use crate::export::ExportMetadata;

fn sample_bundle() -> AnalyticsBundle {
    AnalyticsBundle {
        metadata: ExportMetadata {
            exported_at: "2026-07-21T00:00:00.000Z".to_string(),
            tenant_id: "test-tenant".to_string(),
            store_name: "Test Store".to_string(),
            version: "0.0.17".to_string(),
        },
        daily_revenue: Vec::new(),
        weekly_revenue: Vec::new(),
        monthly_revenue: Vec::new(),
        top_products: Vec::new(),
        hourly_heatmap: Vec::new(),
        category_breakdown: Vec::new(),
        low_stock_alerts: Vec::new(),
        active_stock_alerts: Vec::new(),
        category_popularity: Vec::new(),
        category_forecast: Vec::new(),
    }
}

#[test]
fn export_config_default() {
    let cfg = CloudExportConfig::default();
    assert!(!cfg.enabled);
    assert!(cfg.include_all_reports);
}

#[test]
fn destination_labels() {
    let bq = ExportDestination::BigQuery(BigQueryConfig::new("p", "d", "t", "k", "US"));
    assert_eq!(bq.label(), "BigQuery");

    let sf = ExportDestination::Snowflake(SnowflakeConfig::new(
        "https://test.snowflake.com",
        "wh",
        "db",
        "s",
        "t",
        "u",
        "p",
    ));
    assert_eq!(sf.label(), "Snowflake");
}

#[test]
fn export_destination_serde_roundtrip() {
    let bq = ExportDestination::BigQuery(BigQueryConfig::new(
        "my-project",
        "my_dataset",
        "my_table",
        "base64key==",
        "US",
    ));
    let json = serde_json::to_string(&bq).unwrap();
    let back: ExportDestination = serde_json::from_str(&json).unwrap();
    match back {
        ExportDestination::BigQuery(cfg) => {
            assert_eq!(cfg.project_id, "my-project");
            assert_eq!(cfg.dataset, "my_dataset");
            assert_eq!(cfg.table, "my_table");
            assert_eq!(cfg.location, "US");
        }
        _ => panic!("expected BigQuery"),
    }
}

#[test]
fn cloud_export_config_serde_roundtrip() {
    let cfg = CloudExportConfig {
        enabled: true,
        destination: ExportDestination::Snowflake(SnowflakeConfig::new(
            "https://test.snowflake.com",
            "COMPUTE_WH",
            "ANALYTICS",
            "PUBLIC",
            "EXPORT_TABLE",
            "svc_user",
            "supersecret",
        )),
        include_all_reports: false,
        report_types: vec!["daily_revenue".to_string(), "top_products".to_string()],
    };
    let json = serde_json::to_string(&cfg).unwrap();
    let back: CloudExportConfig = serde_json::from_str(&json).unwrap();
    assert!(back.enabled);
    assert!(!back.include_all_reports);
    assert_eq!(back.report_types.len(), 2);
    match back.destination {
        ExportDestination::Snowflake(s) => {
            assert_eq!(s.username, "svc_user");
            assert_eq!(s.warehouse, "COMPUTE_WH");
        }
        _ => panic!("expected Snowflake"),
    }
}

#[test]
fn bundle_to_ndjson_empty_bundle() {
    let bundle = sample_bundle();
    let rows = bundle_to_ndjson(&bundle);
    assert!(rows.is_empty(), "empty bundle should produce no rows");
}

#[test]
fn export_result_serialization() {
    let result = CloudExportResult {
        success: true,
        rows_exported: 42,
        message: "Exported to BigQuery".to_string(),
    };
    let json = serde_json::to_string(&result).unwrap();
    assert!(json.contains("\"success\":true"));
    assert!(json.contains("\"rows_exported\":42"));
}
