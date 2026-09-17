//! Cloud settings administration — per-tenant SMTP / report-schedule
//! provisioning.
/*
last audited 25-07-26 by RSA-Agent (oz-api slice A: settings routes deep read; API-2 documented 25-07-26)
crate: oz-api | status: SAFE | lint: CLEAN
findings: clean — both handlers admin-key-gate first despite the public-router placement (verified); tenant ids charset-validated; field ops resolved before any write (no half-applied config); SMTP password encrypted at rest on write, DECRYPTED in GET responses — API-2: the decrypted-GET tradeoff is now documented on get_settings_handler (safe because admin-gated with constant-time compare + OZ_ADMIN_KEY mandatory behind OZ_PRODUCTION=1; redaction path specified if either guard is ever relaxed); PG and SQLite paths mirror each other
next: none here | perf: N/A
*/
//!
//! - `GET /api/v1/settings?tenant=<id>` — read a tenant's **effective**
//!   cloud settings (scoped key `{base}:{tenant}` first, bare-key fallback),
//!   exactly as the report-sender loop in `apps/cloud-server` resolves them.
//! - `PUT /api/v1/settings` — write a tenant's scoped settings (SMTP
//!   config, report schedule, store name). Absent fields are left
//!   unchanged; an explicit `null` deletes the tenant's scoped override so
//!   it falls back to the bare key again.
//!
//! "Absent is left untouched" is a per-TOP-LEVEL-field rule, and the SMTP
//! blob is one top-level field whose value is written whole. `SmtpConfig`
//! declares no serde defaults but does carry two `Option`s, so a blob that
//! supplies host/port/from/use_tls and omits `password` used to persist
//! `password: null` - destroying the secret the live report loop reads - and
//! one that omitted `username` did the same to the account that secret
//! belongs to. The write now goes through the same keep-on-blank merge the
//! desktop and tablet funnels use ([`merge_smtp_password_json`]), against the
//! scoped row this handler owns ([`stored_smtp_raw`]): EVERY absent optional
//! field keeps its stored value, a supplied one replaces it, and an explicit
//! empty string clears it. The blob is also run through `SmtpConfig::validate`
//! first, so this door refuses what this lane's sender would refuse anyway.
//!
//! Both are gated by the same `OZ_ADMIN_KEY` as token minting and plan
//! assignment (ADR sync-auth-hardening P2): when the admin key is
//! configured, the `X-Admin-Key` header must match; in dev mode (no admin
//! key) the endpoints are open.
//!
//! Keys are always written in scoped suffix form (`smtp_config:{tenant}`,
//! `report_schedule:{tenant}`, `store.name:{tenant}`), which is exactly
//! what the cloud report loop reads — a second tenant is enabled purely by
//! provisioning its scoped keys, with no data migration. SMTP passwords
//! are encrypted at rest with `oz_core::crypto::encrypt_smtp_at_rest`
//! (matching what the report loop's `decrypt_smtp_at_rest` expects) and
//! decrypted in the GET response so admin round-trips are lossless.

use axum::{
    Json,
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use oz_core::db::Store;
use oz_core::export::email_report::{
    SMTP_CONFIG_SETTINGS_KEY, SmtpConfig, merge_smtp_password_json,
};
use oz_core::export::email_sender::LAST_SENT_KEY;
use oz_core::export::{REPORT_SCHEDULE_SETTINGS_KEY, ReportScheduleConfig};

use crate::AppState;
use crate::routes::tokens::admin_key_authorised;
use crate::routes::validate::valid_tenant;

/// Store-name settings key (bare form; scoped as `store.name:{tenant}`).
const STORE_NAME_SETTINGS_KEY: &str = "store.name";

/// One field-level write operation, resolved before any write happens so a
/// bad request never leaves a half-applied config.
enum Op {
    /// Field absent from the request — leave the stored value untouched.
    Leave,
    /// Explicit `null` — delete the tenant's scoped override (falls back
    /// to the bare key).
    Delete,
    /// Write this canonical serialized value to `{base}:{tenant}`.
    Write(String),
}

/// Query params for `GET /api/v1/settings`.
#[derive(Deserialize)]
pub struct GetSettingsParams {
    /// Tenant to read (defaults to `default`).
    pub tenant: Option<String>,
}

/// A PUT field that distinguishes absent from explicit `null`: a plain
/// `Option<Field<T>>` would have serde swallow the `null` into the outer
/// `None`, so the fields use `deserialize_field` (below):
/// absent → `None`, `null` → `Some(Field::Null)`, value → `Some(Field::Value(v))`.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum Field<T> {
    /// Explicit JSON `null` — delete the tenant's scoped override.
    Null,
    /// A concrete value to validate and store.
    Value(T),
}

/// Deserialize an optional PUT field, preserving explicit `null` (which a
/// plain `Option` would collapse into `None`). Used via `#[serde(default,
/// deserialize_with = "deserialize_field")]` on every optional field.
fn deserialize_field<'de, D, T>(d: D) -> Result<Option<Field<T>>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::de::DeserializeOwned,
{
    let value = Value::deserialize(d)?;
    match value {
        Value::Null => Ok(Some(Field::Null)),
        other => match serde_json::from_value(other) {
            Ok(v) => Ok(Some(Field::Value(v))),
            Err(e) => Err(serde::de::Error::custom(e)),
        },
    }
}

/// Request body for `PUT /api/v1/settings` — every field is optional;
/// absent fields are left untouched, `null` deletes the scoped override.
#[derive(Deserialize)]
pub struct PutSettingsRequest {
    /// Tenant to write (defaults to `default`).
    pub tenant: Option<String>,
    /// Store display name override.
    #[serde(default, deserialize_with = "deserialize_field")]
    pub store_name: Option<Field<String>>,
    /// SMTP config override (validated against the loop's `SmtpConfig`).
    #[serde(default, deserialize_with = "deserialize_field")]
    pub smtp_config: Option<Field<Value>>,
    /// Report schedule override (validated against `ReportScheduleConfig`).
    #[serde(default, deserialize_with = "deserialize_field")]
    pub report_schedule: Option<Field<Value>>,
}

/// Effective per-tenant settings view returned by GET and after PUT.
#[derive(Serialize)]
pub struct SettingsView {
    /// The tenant these settings belong to.
    pub tenant: String,
    /// Effective store name (scoped first, then bare, then `null`).
    pub store_name: Option<String>,
    /// Effective SMTP config (password decrypted) or `null`.
    pub smtp_config: Option<SmtpConfig>,
    /// Effective report schedule or `null`.
    pub report_schedule: Option<ReportScheduleConfig>,
    /// Effective last-sent dedup timestamp or `null`.
    pub last_report_sent_at: Option<String>,
}

fn scoped_key(base: &str, tenant: &str) -> String {
    crate::pg::scoped_setting_key(base, tenant)
}

/// The stored smtp_config blob this tenant’s report sender would actually use:
/// the scoped row (smtp_config:{tenant}) first, then the bare smtp_config — the
/// same resolution order as [`read_settings`] here and as `get_smtp_config_pg`
/// in `apps/cloud-server/src/email_pg.rs:467`.
///
/// The keep-on-blank merge has to be told WHICH row to preserve, and on this
/// lane it is not the row [`Store::merged_smtp_password_json`] reads: that one
/// is pinned to the bare key, which is the desktop’s single-tenant row.
/// Merging against it would carry some other tenant’s secret into this one
/// and still blank the scoped row. This reads the row the write is about to
/// overwrite, so the secret that survives is the one that was in play.
async fn stored_smtp_raw(state: &AppState, tenant: &str) -> Result<Option<String>, String> {
    if let Some(pool) = &state.pg {
        return get_setting_scoped_pg(pool, SMTP_CONFIG_SETTINGS_KEY, tenant).await;
    }
    let db = state.db.lock().await;
    let store = Store::new(&db);
    let scoped = store
        .get_setting(&scoped_key(SMTP_CONFIG_SETTINGS_KEY, tenant))
        .map_err(|e| e.to_string())?;
    if scoped.is_some() {
        return Ok(scoped);
    }
    store
        .get_setting(SMTP_CONFIG_SETTINGS_KEY)
        .map_err(|e| e.to_string())
}

/// Deserialize a stored SMTP config, decrypting the password (legacy
/// plaintext passes through unchanged). `None` on malformed storage or
/// tampered ciphertext (F-029: decryption now fails closed — a
/// well-formed value that no longer authenticates is NOT returned as
/// if it were the stored secret).
fn parse_smtp_config(raw: &str) -> Option<SmtpConfig> {
    let mut config: SmtpConfig = serde_json::from_str(raw).ok()?;
    if let Some(ref pwd) = config.password
        && !pwd.is_empty()
    {
        match oz_core::crypto::decrypt_smtp_at_rest(pwd) {
            Ok(plaintext) => config.password = Some(plaintext),
            Err(e) => {
                tracing::error!(error = %e, "smtp at-rest ciphertext failed authentication");
                return None;
            }
        }
    }
    Some(config)
}

/// `GET /api/v1/settings` — read a tenant's effective cloud settings.
///
/// # API-2 security note (decrypted SMTP password)
///
/// The response contains the tenant's SMTP password **decrypted** so the
/// admin client can round-trip the full configuration. This is a
/// deliberate tradeoff, safe only because:
///
/// 1. the endpoint is gated by the admin key with a constant-time compare
///    (`admin_key_authorised`), and
/// 2. `OZ_ADMIN_KEY` **must** be set in production (`validate_production_secrets`
///    in [`crate::serve`] refuses to start without it) — the dev-open mode
///    that would expose decrypted credentials to anyone is unreachable
///    behind `OZ_PRODUCTION=1`.
///
/// Do not relax either guard without first switching the GET response to
/// redact the password (e.g. return a `has_password: true` marker and
/// accept "leave unchanged" semantics on PUT).
pub async fn get_settings_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(params): Query<GetSettingsParams>,
) -> Response {
    if !admin_key_authorised(&headers, state.admin_key.as_deref()) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error": "invalid_admin_key"})),
        )
            .into_response();
    }
    let tenant = params.tenant.as_deref().unwrap_or("default");
    if !valid_tenant(tenant) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "invalid_tenant", "tenant": tenant})),
        )
            .into_response();
    }
    match read_settings(&state, tenant).await {
        Ok(view) => (StatusCode::OK, Json(view)).into_response(),
        Err(e) => {
            tracing::error!(error = %e, tenant, "reading settings failed");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "settings_read_failed"})),
            )
                .into_response()
        }
    }
}

/// `PUT /api/v1/settings` — write a tenant's scoped settings.
///
/// Returns 401 without a matching admin key, 400 on validation failure
/// (unknown tenant charset, empty store name, malformed SMTP/schedule
/// JSON), 200 with the effective settings after the write.
pub async fn put_settings_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<PutSettingsRequest>,
) -> Response {
    if !admin_key_authorised(&headers, state.admin_key.as_deref()) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error": "invalid_admin_key"})),
        )
            .into_response();
    }
    let tenant = body.tenant.as_deref().unwrap_or("default");
    if !valid_tenant(tenant) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "invalid_tenant", "tenant": tenant})),
        )
            .into_response();
    }

    // Validate + canonicalize every provided field BEFORE writing anything,
    // so a bad request never leaves a half-applied config.
    if let Some(Field::Value(name)) = &body.store_name
        && name.trim().is_empty()
    {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "invalid_store_name"})),
        )
            .into_response();
    }
    let smtp_op = match &body.smtp_config {
        Some(Field::Value(value)) => match serde_json::from_value::<SmtpConfig>(value.clone()) {
            Ok(config) => {
                // The door and the SENDER on this lane must agree about what a
                // valid SMTP config is, and they did not: this handler only
                // DESERIALISED, so an empty host, port 0 and a from of
                // "not-an-email" were all accepted and stored, while the cloud
                // report loop refuses to send anything that fails this same
                // validate() (apps/cloud-server/src/email.rs:49-51; the PG lane
                // reaches it through the same send_email at email_pg.rs:244).
                // So nothing rejected here was ever SENDABLE on this lane — the
                // write only moved the failure from the console to 08:00. It
                // runs before the merge and long before write_settings, so the
                // documented validate-and-canonicalize-before-any-write
                // invariant holds.
                //
                // This is NOT a claim that the desktop door applies the same
                // rule. It does not: outside this handler, `SmtpConfig::validate`
                // has exactly one production caller — the cloud sender. The
                // desktop write funnel (crates/kasirmu-bridge/src/settings.rs
                // ::run_set_setting) and the desktop sender
                // (crates/kasirmu-bridge/src/email.rs:77) never call it. The seam
                // this closes is cloud-door to cloud-sender, not desktop to
                // cloud, and reading it as the latter would make the one shape
                // below look like a desktop parity change when it is not.
                //
                // The one shape newly refused here that was storable before is
                // a from-address whose domain has no dot — `reports@localhost`
                // — rejected by the `!self.from.contains('.')` clause of
                // SmtpConfig::validate (email_report.rs:101). A desktop install
                // can legitimately run that shape, because its sender skips
                // validate(); a cloud tenant never could, because its sender
                // already refused it. So the shape stays storable where it
                // works and stops being storable where it does not.
                if let Err(e) = config.validate() {
                    tracing::warn!(
                        error = %e,
                        tenant,
                        "rejected an smtp_config the report sender could not use"
                    );
                    return (
                        StatusCode::BAD_REQUEST,
                        Json(serde_json::json!({"error": "invalid_smtp_config"})),
                    )
                        .into_response();
                }
                // Keep-on-blank, through the ONE merge the two single-write
                // funnels use as well. Do NOT swap this for its wrapper,
                // `Store::merged_smtp_password_json`: that one reads the BARE
                // key, which is the desktop's single-tenant row and NOT the row
                // this handler writes. Merging against it would carry some
                // other tenant's secret into this one and still blank the
                // scoped row. The underlying `merge_smtp_password_json` plus
                // [stored_smtp_raw] is what keeps the cloud lane preserving the
                // secret it actually owns.
                //
                // `SmtpConfig` declares no serde defaults, so every field a
                // blob can omit is an Option — and the merge now carries all of
                // them forward, not just the password. Before that, a PUT that
                // omitted `username` left a stored relay password
                // authenticating as nobody.
                //
                // The merge also owns the at-rest encryption, so the blob
                // handed to it is PLAINTEXT — pre-encrypting here would
                // double-wrap the value. F-029's fail-closed rule still
                // holds: an encrypt failure is an Err from the merge.
                let incoming = match serde_json::to_string(&config) {
                    Ok(json) => json,
                    Err(_) => {
                        return (
                            StatusCode::BAD_REQUEST,
                            Json(serde_json::json!({"error": "invalid_smtp_config"})),
                        )
                            .into_response();
                    }
                };
                let stored = match stored_smtp_raw(&state, tenant).await {
                    Ok(raw) => raw,
                    Err(e) => {
                        tracing::error!(
                            error = %e,
                            tenant,
                            "reading the stored smtp_config for the keep-on-blank merge failed"
                        );
                        return (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            Json(serde_json::json!({"error": "settings_write_failed"})),
                        )
                            .into_response();
                    }
                };
                match merge_smtp_password_json(&incoming, stored.as_deref()) {
                    Ok(json) => Op::Write(json),
                    Err(e) => {
                        tracing::error!(error = %e, "smtp at-rest encryption failed");
                        return (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            Json(serde_json::json!({"error": "settings_write_failed"})),
                        )
                            .into_response();
                    }
                }
            }
            Err(_) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({"error": "invalid_smtp_config"})),
                )
                    .into_response();
            }
        },
        Some(Field::Null) => Op::Delete,
        None => Op::Leave,
    };
    let schedule_op = match &body.report_schedule {
        Some(Field::Value(value)) => {
            match serde_json::from_value::<ReportScheduleConfig>(value.clone()) {
                Ok(config) => match serde_json::to_string(&config) {
                    Ok(json) => Op::Write(json),
                    Err(_) => {
                        return (
                            StatusCode::BAD_REQUEST,
                            Json(serde_json::json!({"error": "invalid_report_schedule"})),
                        )
                            .into_response();
                    }
                },
                Err(_) => {
                    return (
                        StatusCode::BAD_REQUEST,
                        Json(serde_json::json!({"error": "invalid_report_schedule"})),
                    )
                        .into_response();
                }
            }
        }
        Some(Field::Null) => Op::Delete,
        None => Op::Leave,
    };
    let store_op = match &body.store_name {
        Some(Field::Value(name)) => Op::Write(name.trim().to_string()),
        Some(Field::Null) => Op::Delete,
        None => Op::Leave,
    };

    if let Err(e) = write_settings(&state, tenant, store_op, smtp_op, schedule_op).await {
        tracing::error!(error = %e, tenant, "writing settings failed");
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "settings_write_failed"})),
        )
            .into_response();
    }

    match read_settings(&state, tenant).await {
        Ok(view) => (StatusCode::OK, Json(view)).into_response(),
        Err(e) => {
            tracing::error!(error = %e, tenant, "re-reading settings failed");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "settings_read_failed"})),
            )
                .into_response()
        }
    }
}

/// Apply the per-field write operations for one tenant.
async fn write_settings(
    state: &AppState,
    tenant: &str,
    store_op: Op,
    smtp_op: Op,
    schedule_op: Op,
) -> Result<(), String> {
    if let Some(pool) = &state.pg {
        apply_ops_pg(pool, tenant, store_op, smtp_op, schedule_op).await
    } else {
        let db = state.db.lock().await;
        apply_ops_sqlite(&db, tenant, store_op, smtp_op, schedule_op)
    }
}

/// Apply one field-level operation for a tenant on Postgres.
async fn apply_op_pg(
    pool: &deadpool_postgres::Pool,
    tenant: &str,
    base: &str,
    op: &Op,
) -> Result<(), String> {
    use crate::pg::set_setting_pg;
    match op {
        Op::Leave => Ok(()),
        Op::Delete => {
            let client = pool.get().await.map_err(|e| e.to_string())?;
            client
                .execute(
                    "DELETE FROM settings WHERE key = $1",
                    &[&scoped_key(base, tenant)],
                )
                .await
                .map_err(|e| format!("DB error: {e}"))?;
            Ok(())
        }
        Op::Write(value) => set_setting_pg(pool, &scoped_key(base, tenant), value).await,
    }
}

async fn apply_ops_pg(
    pool: &deadpool_postgres::Pool,
    tenant: &str,
    store_op: Op,
    smtp_op: Op,
    schedule_op: Op,
) -> Result<(), String> {
    apply_op_pg(pool, tenant, STORE_NAME_SETTINGS_KEY, &store_op).await?;
    apply_op_pg(pool, tenant, SMTP_CONFIG_SETTINGS_KEY, &smtp_op).await?;
    apply_op_pg(pool, tenant, REPORT_SCHEDULE_SETTINGS_KEY, &schedule_op).await?;
    Ok(())
}

fn apply_ops_sqlite(
    conn: &rusqlite::Connection,
    tenant: &str,
    store_op: Op,
    smtp_op: Op,
    schedule_op: Op,
) -> Result<(), String> {
    let store = Store::new(conn);
    let apply = |op: &Op, base: &str| -> Result<(), String> {
        let key = scoped_key(base, tenant);
        match op {
            Op::Leave => Ok(()),
            Op::Delete => conn
                .execute(
                    "DELETE FROM settings WHERE key = ?1",
                    rusqlite::params![key],
                )
                .map(|_| ())
                .map_err(|e| format!("DB error: {e}")),
            Op::Write(value) => store.set_setting(&key, value).map_err(|e| e.to_string()),
        }
    };
    apply(&store_op, STORE_NAME_SETTINGS_KEY)?;
    apply(&smtp_op, SMTP_CONFIG_SETTINGS_KEY)?;
    apply(&schedule_op, REPORT_SCHEDULE_SETTINGS_KEY)?;
    Ok(())
}

/// Read a scoped settings value from Postgres with bare-key fallback
/// (mirrors the report loop's resolution order).
async fn get_setting_scoped_pg(
    pool: &deadpool_postgres::Pool,
    base: &str,
    tenant: &str,
) -> Result<Option<String>, String> {
    let scoped = scoped_key(base, tenant);
    if let Some(v) = crate::pg::get_setting_pg(pool, &scoped).await? {
        return Ok(Some(v));
    }
    crate::pg::get_setting_pg(pool, base).await
}

/// Read a tenant's effective settings (scoped key first, bare fallback).
async fn read_settings(state: &AppState, tenant: &str) -> Result<SettingsView, String> {
    let (store_name, smtp_raw, schedule_raw, last_sent) = if let Some(pool) = &state.pg {
        (
            get_setting_scoped_pg(pool, STORE_NAME_SETTINGS_KEY, tenant).await?,
            get_setting_scoped_pg(pool, SMTP_CONFIG_SETTINGS_KEY, tenant).await?,
            get_setting_scoped_pg(pool, REPORT_SCHEDULE_SETTINGS_KEY, tenant).await?,
            get_setting_scoped_pg(pool, LAST_SENT_KEY, tenant).await?,
        )
    } else {
        let db = state.db.lock().await;
        let store = Store::new(&db);
        let get_scoped = |base: &str| -> Result<Option<String>, String> {
            if let Some(v) = store
                .get_setting(&scoped_key(base, tenant))
                .map_err(|e| e.to_string())?
            {
                return Ok(Some(v));
            }
            store.get_setting(base).map_err(|e| e.to_string())
        };
        (
            get_scoped(STORE_NAME_SETTINGS_KEY)?,
            get_scoped(SMTP_CONFIG_SETTINGS_KEY)?,
            get_scoped(REPORT_SCHEDULE_SETTINGS_KEY)?,
            get_scoped(LAST_SENT_KEY)?,
        )
    };

    // Malformed stored values surface as `null` rather than failing the
    // whole read (the loop tolerates per-tenant parse failures too).
    let smtp_config = smtp_raw.as_deref().and_then(parse_smtp_config).or_else(|| {
        tracing::warn!(
            tenant,
            "stored smtp_config failed to parse; treating as unset"
        );
        None
    });
    let report_schedule = schedule_raw
        .as_deref()
        .and_then(|raw| serde_json::from_str::<ReportScheduleConfig>(raw).ok())
        .or_else(|| {
            tracing::warn!(
                tenant,
                "stored report_schedule failed to parse; treating as unset"
            );
            None
        });

    Ok(SettingsView {
        tenant: tenant.to_string(),
        store_name,
        smtp_config,
        report_schedule,
        last_report_sent_at: last_sent,
    })
}

#[cfg(test)]
#[path = "settings_tests.rs"]
mod tests;
