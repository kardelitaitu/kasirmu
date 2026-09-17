//! Queue worker for the Postgres scheduled-report email loop.
//!
//! Owns the background loop (`start_report_sender_loop_pg`), the per-tenant
//! cycle with its session-advisory-lock guard, tenant enumeration, and the
//! `sent_reports` at-most-once period claim. Scoped settings access lives in
//! `super::settings_store`; report generation in `super::analytics`.
//! Split from the monolithic `email_pg.rs` on 13-09-26; behaviour unchanged.

use std::time::Duration;

use chrono::{Datelike, SecondsFormat, Utc};
use deadpool_postgres::Pool;
use tracing::{error, info};

use kasirmu_core::export::ReportScheduleConfig;
use kasirmu_core::export::email_sender::{
    LAST_SENT_KEY, resolve_now_in_timezone, should_send_scheduled_with_last_sent,
};

use crate::email::send_email;

use super::analytics::generate_filtered_report_email_pg;
use super::settings_store::{
    get_report_schedule_pg, get_setting_scoped_pg, get_smtp_config_pg, get_store_name_pg,
    set_setting_scoped_pg,
};
// ── Background scheduled send loop (Postgres) ──────────────────────

/// Start the background task that polls every 60s and sends scheduled
/// report emails on the Postgres branch.
pub fn start_report_sender_loop_pg(pool: Pool) {
    tokio::spawn(async move {
        // Poll every 5 min instead of 60s — reports are hourly, so 60s
        // polling wastes CPU on idle loops. Saves ~0.001 core.
        info!("Report sender background loop started (Postgres, poll interval: 300s)");
        loop {
            tokio::time::sleep(Duration::from_secs(300)).await;

            if let Err(e) = try_send_scheduled_pg(&pool).await {
                error!("Report sender loop error (Postgres): {e}");
            }
        }
    });
}

/// Try to send the scheduled reports for every active tenant — the Postgres
/// mirror of `crate::email::try_send_scheduled` walked per tenant. Each
/// cycle: enumerate tenants, then for each one read its scoped settings,
/// check the schedule (cadence + timezone + dedup via the shared scheduler),
/// generate its tenant-filtered report, send, and record the send timestamp.
/// Per-tenant errors are logged and the cycle continues; only a DB-level
/// failure (e.g. enumeration) aborts the cycle.
async fn try_send_scheduled_pg(pool: &Pool) -> Result<(), String> {
    for tenant in active_tenants_pg(pool).await? {
        if let Err(e) = try_send_scheduled_for_tenant_pg(pool, &tenant).await {
            error!("Report sender error for tenant {tenant}: {e}");
        }
    }
    Ok(())
}

/// Try to send one tenant's scheduled report, serialized across instances
/// by a session advisory lock keyed on the tenant id.
///
/// `pg_try_advisory_lock` returns `false` when another instance is already
/// inside this tenant's cycle, so a second instance skips the tenant
/// entirely — two instances can never both send the same tenant's report.
/// The lock lives on its own dedicated connection for the whole cycle
/// (every helper below uses independent pooled connections, so a
/// transaction-scoped lock would not guard them).
///
/// # Lock lifecycle
///
/// The advisory lock is session-level, and the connection comes from the
/// pool. If the unlock failed or the inner cycle panicked, the lock would
/// leak onto the recycled connection, permanently blocking that tenant's
/// future sends. The guard handles this:
///
/// 1. On success → explicit `release()` unlocks the lock and returns the
///    connection to the pool normally.
/// 2. On error → `release()` still unlocks (runs after inner), then the
///    error is propagated — the lock is clean.
/// 3. On panic → `Drop` runs, which calls `AdvisoryLockGuard::take()` to
///    **detach** the connection from the pool. When the detached wrapper
///    drops, the underlying socket is closed, the session ends, and the
///    advisory lock dies with it — no leak.
pub async fn try_send_scheduled_for_tenant_pg(pool: &Pool, tenant: &str) -> Result<(), String> {
    let mut guard = AdvisoryLockGuard::acquire(pool, tenant).await?;
    if !guard.acquired {
        return Ok(());
    }
    let result = try_send_scheduled_tenant_inner_pg(pool, tenant).await;
    // `release` unlocks on success OR error — the guard's Drop only runs
    // if release is NOT called (panic or early return before this line).
    guard.release().await;
    result
}

/// RAII guard for a session-level advisory lock on a pooled connection.
/// On `Drop` (including panic unwinding), the connection is detached from
/// the pool and closed — the session ends, and the advisory lock dies
/// with it. This prevents a classic PG pooled-connection footgun: a
/// leaked lock on a recycled connection would block that tenant forever.
pub struct AdvisoryLockGuard {
    /// `None` after `release()` or `take()` — prevents double-free.
    pub conn: Option<deadpool_postgres::Client>,
    /// `false` when `pg_try_advisory_lock` returned false (lock not held).
    pub acquired: bool,
    /// Tenant identifier for the unlock query.
    tenant: String,
}

impl AdvisoryLockGuard {
    /// Acquire the advisory lock. Returns `Ok(guard)` with `acquired`
    /// set to `false` when another instance holds the lock.
    pub async fn acquire(pool: &Pool, tenant: &str) -> Result<Self, String> {
        let conn = pool.get().await.map_err(|e| e.to_string())?;
        let acquired: bool = conn
            .query_one("SELECT pg_try_advisory_lock(hashtext($1))", &[&tenant])
            .await
            .map_err(|e| format!("DB error: {e}"))?
            .get(0);
        Ok(Self {
            conn: Some(conn),
            acquired,
            tenant: tenant.to_owned(),
        })
    }

    /// Release the advisory lock. Always called on the success OR error
    /// path (after `inner`) — the guard's `Drop` is only for the panic
    /// case.
    pub async fn release(&mut self) {
        let Some(conn) = self.conn.take() else {
            return; // already released or taken
        };
        // `pg_advisory_unlock` with the same key as the lock.
        // If the unlock fails (dead connection, transient error), the
        // connection must NOT return to the pool still holding the lock.
        // Detach it instead — the session (and the lock) dies with the
        // closed socket.
        match conn
            .execute("SELECT pg_advisory_unlock(hashtext($1))", &[&self.tenant])
            .await
        {
            Ok(_) => { /* returned to pool normally — no lock held */ }
            Err(_) => {
                // Unlock failed — cannot trust the connection's lock state.
                let _ = deadpool_postgres::Client::take(conn);
            }
        }
    }
}

impl Drop for AdvisoryLockGuard {
    fn drop(&mut self) {
        if let Some(conn) = self.conn.take()
            && self.acquired
        {
            // Lock was never released — detach so the session dies
            // and the advisory lock is released with it.
            let _ = deadpool_postgres::Client::take(conn);
        }
        // Not acquired → connection holds no lock → returns to pool normally.
    }
}
/// The un-serialized per-tenant send cycle: scoped settings → due check →
/// claim the period → tenant-filtered report → send → scoped last-sent
/// stamp. The `sent_reports` claim is what makes send at-most-once: it is
/// committed BEFORE the email is sent, so a crash between a successful
/// send and the last-sent stamp (or a racing second instance) is recovered
/// by the next cycle seeing the claim and skipping.
pub async fn try_send_scheduled_tenant_inner_pg(pool: &Pool, tenant: &str) -> Result<(), String> {
    // Scope 1: Read the tenant's SMTP + schedule config (scoped keys with
    // bare-key fallback), check the schedule.
    let smtp_config = match get_smtp_config_pg(pool, tenant).await? {
        Some(c) => c,
        None => return Ok(()),
    };

    let schedule = match get_report_schedule_pg(pool, tenant).await? {
        Some(s) if s.enabled => s,
        _ => return Ok(()),
    };

    let last_sent = get_setting_scoped_pg(pool, LAST_SENT_KEY, tenant).await?;
    let should_send = should_send_scheduled_with_last_sent(&schedule, last_sent)
        .map_err(|e| format!("Schedule check failed: {e}"))?;

    if !should_send {
        return Ok(());
    }

    // Scope 2: Claim the scheduled slot BEFORE generating or sending. If a
    // previous attempt already claimed it — a crash after a successful
    // send but before the stamp, or another instance racing — skip, so a
    // report can never be sent twice for the same period.
    let period = period_for_schedule(&schedule, resolve_now_in_timezone(&schedule.timezone));
    let report_id = uuid::Uuid::now_v7().to_string();
    if !claim_period_pg(pool, tenant, &period, &report_id).await? {
        info!(tenant, period, "report period already claimed; skipping");
        return Ok(());
    }

    // Scope 3: Generate, send, stamp. Any failure releases the claim so
    // the period retries next cycle; a claim that survives (success, or a
    // crash anywhere after this line) is exactly what prevents duplicates.
    let result: Result<(), String> = async {
        let store_name = get_store_name_pg(pool, tenant).await?;
        let report =
            generate_filtered_report_email_pg(pool, &schedule, &store_name, tenant).await?;
        let recipients = schedule.recipients.clone();
        send_email(&smtp_config, &report, &recipients).await?;
        let now = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
        set_setting_scoped_pg(pool, LAST_SENT_KEY, &now, tenant).await?;
        Ok(())
    }
    .await;

    match result {
        Ok(()) => {
            info!(
                "Scheduled report sent to {} recipients (tenant: {tenant}, cadence: {}, types: {:?}, period: {period})",
                schedule.recipients.len(),
                schedule.cadence,
                schedule.report_types,
            );
            Ok(())
        }
        Err(e) => {
            if let Err(release_err) = release_period_pg(pool, tenant, &period).await {
                error!(tenant, period, error = %release_err, "releasing failed-report claim errored");
            }
            Err(e)
        }
    }
}

/// Enumerate the tenants this loop must serve: the union of every
/// tenant-scoped table that can identify an active tenant, plus `default`
/// always (so a fresh deployment whose config lives in bare keys still
/// sends). `default` sorts first, the rest alphabetically, for
/// deterministic log output.
pub async fn active_tenants_pg(pool: &Pool) -> Result<Vec<String>, String> {
    let mut client = pool.get().await.map_err(|e| e.to_string())?;
    let tx = client.transaction().await.map_err(|e| e.to_string())?;

    // Tenant discovery is a CROSS-tenant read: the loop must enumerate
    // every tenant before any single tenant is known. Post-RLS-cutover
    // (oz_app + FORCE RLS) a bare read sees zero rows — the email loop
    // would silently stop. Mirror the webhook pattern: if this session
    // user is a member of the dedicated BYPASSRLS discovery role, scope
    // the read to it (`SET LOCAL ROLE` auto-resets on commit so the
    // pooled connection never keeps the bypass). Pre-cutover the app
    // connects as the table owner, which is not a member and bypasses
    // RLS until FORCE — the unscoped read below is the owner's behaviour.
    let is_discovery_member: bool = tx
        .query_one(
            "SELECT EXISTS(
                SELECT 1 FROM pg_roles r
                JOIN pg_auth_members m ON m.roleid = r.oid
                WHERE r.rolname = 'oz_email_discovery'
                  AND m.member = (SELECT oid FROM pg_roles WHERE rolname = current_user)
             )",
            &[],
        )
        .await
        .map_err(|e| format!("DB error: {e}"))?
        .get(0);
    if is_discovery_member {
        tx.execute("SET LOCAL ROLE oz_email_discovery", &[])
            .await
            .map_err(|e| format!("DB error: {e}"))?;
    }

    let rows = tx
        .query(
            "SELECT tenant_id FROM tenant_plans
             UNION SELECT tenant_id FROM offline_queue
             UNION SELECT tenant_id FROM sync_terminals",
            &[],
        )
        .await
        .map_err(|e| format!("DB error: {e}"))?;
    let mut tenants: Vec<String> = rows
        .iter()
        .map(|r| r.get::<_, String>(0))
        .filter(|t| !t.is_empty())
        .collect();
    if !tenants.iter().any(|t| t == "default") {
        tenants.push("default".into());
    }
    tenants.sort_by(|a, b| {
        (a != "default")
            .cmp(&(b != "default"))
            .then_with(|| a.cmp(b))
    });
    tenants.dedup();
    Ok(tenants)
}

// ── Send dedup (sent_reports) ─────────────────────────────────────

/// The dedup key for a scheduled slot — the calendar bucket the report
/// belongs to, derived from the cadence in the schedule's timezone so a
/// crash + retry (or a second instance) always computes the same key:
/// daily → `YYYY-MM-DD`, weekly → the Monday of the week (`YYYY-MM-DD`),
/// monthly → `YYYY-MM`.
pub fn period_for_schedule(
    schedule: &ReportScheduleConfig,
    now_tz: chrono::DateTime<chrono::FixedOffset>,
) -> String {
    match schedule.cadence.as_str() {
        "monthly" => now_tz.format("%Y-%m").to_string(),
        "weekly" => {
            // Monday-start week (same shape as the analytics weekly
            // grouping), so the claim key is stable within the week.
            let days_back = now_tz.weekday().num_days_from_monday() as i64;
            (now_tz - chrono::Duration::days(days_back))
                .format("%Y-%m-%d")
                .to_string()
        }
        _ => now_tz.format("%Y-%m-%d").to_string(),
    }
}

/// Claim the `(tenant, period)` slot before sending. Returns `true` when
/// this attempt is the first to claim it (proceed), `false` when it was
/// already claimed (skip — a crash-recovery restart or another instance
/// already sent / attempted it).
pub async fn claim_period_pg(
    pool: &Pool,
    tenant: &str,
    period: &str,
    report_id: &str,
) -> Result<bool, String> {
    let mut client = pool.get().await.map_err(|e| e.to_string())?;
    let tx = client.transaction().await.map_err(|e| e.to_string())?;
    tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant])
        .await
        .map_err(|e| e.to_string())?;
    let n = tx
        .execute(
            "INSERT INTO sent_reports (tenant_id, period, report_id)
             VALUES ($1, $2, $3)
             ON CONFLICT (tenant_id, period) DO NOTHING",
            &[&tenant, &period, &report_id],
        )
        .await
        .map_err(|e| format!("DB error: {e}"))?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(n > 0)
}

/// Release a claim because the send definitively failed, allowing the
/// period to retry on the next cycle. A send that actually succeeded but
/// whose SMTP response was lost is the unavoidable at-least-once boundary
/// of email delivery.
pub async fn release_period_pg(pool: &Pool, tenant: &str, period: &str) -> Result<(), String> {
    let mut client = pool.get().await.map_err(|e| e.to_string())?;
    let tx = client.transaction().await.map_err(|e| e.to_string())?;
    tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant])
        .await
        .map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM sent_reports WHERE tenant_id = $1 AND period = $2",
        &[&tenant, &period],
    )
    .await
    .map_err(|e| format!("DB error: {e}"))?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}
