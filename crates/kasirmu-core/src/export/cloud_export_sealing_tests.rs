//! Pins for COR-17/30: the cloud-export credential fields are sealed at rest.
//!
//! `save_cloud_export_config` writes a JSON blob into the `settings` table. Two of
//! its fields are secrets -- the BigQuery service-account key and the Snowflake
//! password -- and both were base64/plaintext in that blob, so they rode every
//! `.db` snapshot in the clear. These pins hold the sealing in place from both
//! ends: the raw stored bytes must NOT contain the secret, and a save/load
//! round-trip must return it unchanged.

use super::*;
use crate::db::Store;
use crate::export::cloud_destination::{
    BigQueryConfig, CloudExportConfig, ExportDestination, SnowflakeConfig,
};
use crate::migrations;

fn store(conn: &rusqlite::Connection) -> Store<'_> {
    Store::new(conn)
}

fn bigquery_config(key: &str) -> CloudExportConfig {
    CloudExportConfig {
        enabled: true,
        destination: ExportDestination::BigQuery(BigQueryConfig::new(
            "proj", "ds", "tbl", key, "US",
        )),
        include_all_reports: true,
        report_types: Vec::new(),
    }
}

fn snowflake_config(password: &str) -> CloudExportConfig {
    CloudExportConfig {
        enabled: true,
        destination: ExportDestination::Snowflake(SnowflakeConfig::new(
            "https://acct.snowflakecomputing.com",
            "WH",
            "DB",
            "SCHEMA",
            "TABLE",
            "svc_user",
            password,
        )),
        include_all_reports: true,
        report_types: Vec::new(),
    }
}

#[test]
fn bigquery_service_account_key_is_never_stored_in_the_clear() {
    let conn = migrations::fresh_db();
    let s = store(&conn);
    let secret = "{\"private_key\":\"-----BEGIN PRIVATE KEY-----SUPERSECRET";
    s.save_cloud_export_config(&bigquery_config(secret))
        .unwrap();

    let raw = s.get_setting(CLOUD_EXPORT_SETTINGS_KEY).unwrap().unwrap();
    assert!(
        !raw.contains("SUPERSECRET"),
        "the service-account key must not appear in the stored settings row"
    );
    assert!(
        raw.contains("\"project_id\":\"proj\""),
        "identifier fields stay legible for debugging"
    );

    // The round-trip returns the plaintext unchanged.
    let loaded = s.get_cloud_export_config().unwrap().unwrap();
    match loaded.destination {
        ExportDestination::BigQuery(cfg) => assert_eq!(cfg.service_account_key_b64, secret),
        _ => panic!("expected BigQuery"),
    }
}

#[test]
fn snowflake_password_is_never_stored_in_the_clear() {
    let conn = migrations::fresh_db();
    let s = store(&conn);
    let secret = "hunter2-SUPERSECRET";
    s.save_cloud_export_config(&snowflake_config(secret))
        .unwrap();

    let raw = s.get_setting(CLOUD_EXPORT_SETTINGS_KEY).unwrap().unwrap();
    assert!(
        !raw.contains("SUPERSECRET"),
        "the Snowflake password must not appear in the stored settings row"
    );

    let loaded = s.get_cloud_export_config().unwrap().unwrap();
    match loaded.destination {
        ExportDestination::Snowflake(cfg) => assert_eq!(cfg.password, secret),
        _ => panic!("expected Snowflake"),
    }
}

#[test]
fn a_pre_sealing_plaintext_row_is_still_readable_as_legacy() {
    // An install that stored a config before sealing existed must keep working:
    // the loader passes a non-ciphertext value through unchanged.
    let conn = migrations::fresh_db();
    let s = store(&conn);
    let legacy = serde_json::to_string(&snowflake_config("legacy-plain-password")).unwrap();
    s.set_setting(CLOUD_EXPORT_SETTINGS_KEY, &legacy).unwrap();

    let loaded = s.get_cloud_export_config().unwrap().unwrap();
    match loaded.destination {
        ExportDestination::Snowflake(cfg) => assert_eq!(cfg.password, "legacy-plain-password"),
        _ => panic!("expected Snowflake"),
    }
}
