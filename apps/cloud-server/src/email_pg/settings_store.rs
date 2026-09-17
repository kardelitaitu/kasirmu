//! Scoped `settings`-table access for the Postgres email loop.
//!
//! Raw KV get/set on the `settings` table, the `{key}:{tenant}` suffix
//! scoping with bare-key fallback, and the typed loaders the queue worker
//! uses: SMTP config (password decrypted at rest), report schedule, store
//! name. Split from `email_pg.rs` on 13-09-26; behaviour unchanged.

use deadpool_postgres::Pool;

use kasirmu_core::export::email_report::{SMTP_CONFIG_SETTINGS_KEY, SmtpConfig};
use kasirmu_core::export::{REPORT_SCHEDULE_SETTINGS_KEY, ReportScheduleConfig};
// ── Settings helpers ───────────────────────────────────────────────

/// Read a raw `settings` value (None when absent).
pub async fn get_setting_pg(pool: &Pool, key: &str) -> Result<Option<String>, String> {
    let client = pool.get().await.map_err(|e| e.to_string())?;
    let row = client
        .query_opt("SELECT value FROM settings WHERE key = $1", &[&key])
        .await
        .map_err(|e| format!("DB error: {e}"))?;
    Ok(row.map(|r| r.get(0)))
}

/// Upsert a `settings` value.
pub async fn set_setting_pg(pool: &Pool, key: &str, value: &str) -> Result<(), String> {
    let client = pool.get().await.map_err(|e| e.to_string())?;
    client
        .execute(
            "INSERT INTO settings (key, value, updated_at)
             VALUES ($1, $2, to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'))
             ON CONFLICT (key) DO UPDATE
               SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at",
            &[&key, &value],
        )
        .await
        .map_err(|e| format!("DB error: {e}"))?;
    Ok(())
}

/// Scoped settings key — suffix form (`{base}:{tenant}`), a plain PK
/// lookup that leaves the legacy bare keys untouched.
pub fn scoped_key(base: &str, tenant: &str) -> String {
    format!("{base}:{tenant}")
}

/// Read a scoped settings value with bare-key fallback: `{key}:{tenant}`
/// first, then the legacy bare `{key}` (canonical for `default`, so
/// existing deployments keep working byte-identically).
pub async fn get_setting_scoped_pg(
    pool: &Pool,
    key: &str,
    tenant: &str,
) -> Result<Option<String>, String> {
    if let Some(v) = get_setting_pg(pool, &scoped_key(key, tenant)).await? {
        return Ok(Some(v));
    }
    get_setting_pg(pool, key).await
}

/// Upsert a scoped settings value (writes `{key}:{tenant}`).
pub async fn set_setting_scoped_pg(
    pool: &Pool,
    key: &str,
    value: &str,
    tenant: &str,
) -> Result<(), String> {
    set_setting_pg(pool, &scoped_key(key, tenant), value).await
}

/// Load the tenant's SMTP config from the settings table (scoped key with
/// bare-key fallback), decrypting the password transparently (mirrors
/// `kasirmu_core`'s `Store::get_smtp_config`).
pub async fn get_smtp_config_pg(pool: &Pool, tenant: &str) -> Result<Option<SmtpConfig>, String> {
    let raw = match get_setting_scoped_pg(pool, SMTP_CONFIG_SETTINGS_KEY, tenant).await? {
        Some(v) => v,
        None => return Ok(None),
    };
    let mut config: SmtpConfig = serde_json::from_str(&raw)
        .map_err(|e| format!("failed to deserialize SMTP config: {e}"))?;
    if let Some(ref pwd) = config.password
        && !pwd.is_empty()
    {
        // F-029: fails closed — legacy plaintext passes through inside
        // decrypt_smtp_at_rest, tampered ciphertext surfaces as an error.
        config.password = Some(
            kasirmu_core::crypto::decrypt_smtp_at_rest(pwd)
                .map_err(|e| format!("stored SMTP password failed authentication: {e}"))?,
        );
    }
    Ok(Some(config))
}

/// Load the tenant's report schedule configuration from the settings table
/// (scoped key with bare-key fallback).
pub async fn get_report_schedule_pg(
    pool: &Pool,
    tenant: &str,
) -> Result<Option<ReportScheduleConfig>, String> {
    let raw = match get_setting_scoped_pg(pool, REPORT_SCHEDULE_SETTINGS_KEY, tenant).await? {
        Some(v) => v,
        None => return Ok(None),
    };
    let config: ReportScheduleConfig = serde_json::from_str(&raw)
        .map_err(|e| format!("failed to deserialize report schedule: {e}"))?;
    Ok(Some(config))
}

/// Read the tenant's store name from settings (scoped key with bare-key
/// fallback), falling back to a default.
pub async fn get_store_name_pg(pool: &Pool, tenant: &str) -> Result<String, String> {
    Ok(get_setting_scoped_pg(pool, "store.name", tenant)
        .await?
        .unwrap_or_else(|| "OZ-POS Store".to_string()))
}
