//! Settings serving layer for the cloud Postgres replica.
//!
//! Bare and tenant-scoped setting read/write, plus the key-forming helper the
//! scoped variant uses. The two shapes coexist deliberately: desktop writes
//! the bare key while the API writes scoped-first, and `stored_smtp_raw` reads
//! scoped-then-bare with a keep-on-blank merge.
//!
//! Main functions: [`get_setting_pg`], [`set_setting_pg`], [`scoped_setting_key`].

use deadpool_postgres::Pool;

/// Read a raw `settings` value from Postgres (`None` when absent).
pub async fn get_setting_pg(pool: &Pool, key: &str) -> Result<Option<String>, String> {
    let client = pool.get().await.map_err(|e| e.to_string())?;
    let row = client
        .query_opt("SELECT value FROM settings WHERE key = $1", &[&key])
        .await
        .map_err(|e| format!("DB error: {e}"))?;
    Ok(row.map(|r| r.get(0)))
}

/// Upsert a `settings` value into Postgres (same shape the cloud report
/// loop uses, so keys written here are read verbatim by `email_pg`).
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

/// Scoped settings key — suffix form (`{base}:{tenant}`), matching
/// `email_pg`'s per-tenant keys.
///
/// "The admin endpoint provisions exactly what the report loop reads" holds on
/// cloud-server and is FALSE on the desktop loopback. Do not rely on it as a
/// property of this function; it is a property of the deployment.
///
/// * Cloud — holds. `apps/cloud-server/src/main.rs:351` starts
///   `email_pg::start_report_sender_loop_pg`, whose read is
///   `get_smtp_config_pg` (`apps/cloud-server/src/email_pg.rs:207`, defined at
///   `:467-468`): scoped key first, bare fallback. This is the same scoped key
///   `PUT /api/v1/settings` writes, so the two agree.
/// * Desktop loopback — does not hold. The same handler reaches
///   `apply_ops_sqlite`, which writes this scoped key unconditionally, so a
///   write with the default tenant lands on `smtp_config:default`. The
///   desktop's own report loop never looks there: it reads only the bare
///   `smtp_config` (`crates/kasirmu-bridge/src/email.rs:35-43` →
///   `Store::get_smtp_config`, likewise the scheduler loop in
///   `crates/kasirmu-notification/src/email_scheduler.rs:44-45`).
///
/// The consequence on desktop is a fork, not a miss. `stored_smtp_raw` reads
/// scoped-then-bare and the keep-on-blank merge carries whatever it finds into
/// the value being written, so after ONE loopback write the bare secret is
/// copied into a scoped row — and the two secret-bearing rows then drift
/// independently: the settings page saves to bare, the API writes
/// scoped-first, and each keeps reading its own half. Closing the split is a
/// design decision taken elsewhere, not a bug to fix in this doc.
pub fn scoped_setting_key(base: &str, tenant: &str) -> String {
    format!("{base}:{tenant}")
}
