//! Server-side quota effect detection for the cloud sync server (ADR #57 §2.4, Option A).
//!
//! Evaluates observed products and staff record counts directly against
//! the tenant's tier caps (`kasirmu_core::SubscriptionTier`). A tampered client
//! may bypass its local quota enforcement, but cannot alter the reality of
//! data synced to the cloud server.
//!
//! Key types:
//! - [`QuotaDimensionKind`]: the quota dimension being evaluated (Products, Staff).
//! - [`TenantQuotaViolation`]: an observed over-quota finding for a tenant.
//! - [`QuotaAlertState`]: thread-safe cooldown manager preventing duplicate alerts.
//!
//! Invariants:
//! - Non-destructive: violations flag and notify the operator; NEVER auto-terminate
//!   an account or lock out a POS till (ADR #57 §2.4 response policy).
//! - Cooldown: 7 days minimum between repeat alerts for the same tenant and condition.
//! - Fail-safe logging: unconfigured SMTP logs at WARN without recording cooldown.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use kasirmu_core::subscription::SubscriptionTier;
use rusqlite::params;
use tokio::sync::Mutex;
use tracing::{error, info, warn};

use crate::config::CloudServerConfig;
use crate::email::send_email;

/// Condition identifier for product quota alert state.
pub const CONDITION_PRODUCTS_OVER_QUOTA: &str = "products_over_quota";
/// Condition identifier for staff quota alert state.
pub const CONDITION_STAFF_OVER_QUOTA: &str = "staff_over_quota";
/// Condition identifier for locations quota alert state.
pub const CONDITION_LOCATIONS_OVER_QUOTA: &str = "locations_over_quota";

/// Default alert cooldown period: 7 days, matching the license-server integrity alert window.
pub const ALERT_COOLDOWN: Duration = Duration::from_secs(7 * 24 * 3600);

/// The quota dimension being evaluated.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QuotaDimensionKind {
    /// Product records in the catalog.
    Products,
    /// Active staff user accounts (excluding owner).
    Staff,
    /// Physical store locations.
    Locations,
}

impl QuotaDimensionKind {
    /// Machine-readable condition key used for cooldown deduplication.
    pub fn condition_key(&self) -> &'static str {
        match self {
            Self::Products => CONDITION_PRODUCTS_OVER_QUOTA,
            Self::Staff => CONDITION_STAFF_OVER_QUOTA,
            Self::Locations => CONDITION_LOCATIONS_OVER_QUOTA,
        }
    }

    /// Human-readable label for alert notifications.
    pub fn label(&self) -> &'static str {
        match self {
            Self::Products => "products",
            Self::Staff => "staff members",
            Self::Locations => "locations",
        }
    }
}

/// An observed quota violation finding for a tenant.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TenantQuotaViolation {
    /// Target tenant identifier.
    pub tenant_id: String,
    /// The tenant's resolved subscription tier.
    pub tier: SubscriptionTier,
    /// The dimension on which quota was exceeded.
    pub dimension: QuotaDimensionKind,
    /// The observed record count in the server database.
    pub observed_count: i64,
    /// The numeric maximum allowed by the tier.
    pub allowed_cap: i64,
}

/// Thread-safe in-memory cooldown state tracker.
/// Key is `(tenant_id, condition_key)`.
#[derive(Clone, Default)]
pub struct QuotaAlertState {
    last_alerts: Arc<Mutex<HashMap<(String, String), Instant>>>,
}

impl QuotaAlertState {
    /// Create a new empty alert state tracker.
    pub fn new() -> Self {
        Self {
            last_alerts: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Check whether an alert for `(tenant_id, condition)` is currently suppressed by cooldown.
    pub async fn is_suppressed(&self, tenant_id: &str, condition: &str, now: Instant) -> bool {
        let guard = self.last_alerts.lock().await;
        if let Some(&last) = guard.get(&(tenant_id.to_string(), condition.to_string())) {
            now.duration_since(last) < ALERT_COOLDOWN
        } else {
            false
        }
    }

    /// Record that an alert was sent, starting the 7-day cooldown window.
    pub async fn record_alert(&self, tenant_id: &str, condition: &str, now: Instant) {
        let mut guard = self.last_alerts.lock().await;
        guard.insert((tenant_id.to_string(), condition.to_string()), now);
    }
}

// ── SQLite Queries ───────────────────────────────────────────────────

/// Resolve a tenant's subscription tier on SQLite.
///
/// Priority:
/// 1. `tenant_subscription.tier_key`
/// 2. `tenant_plans.plan`
/// 3. Fail-closed default: `SubscriptionTier::Free`.
pub fn resolve_tenant_tier_sqlite(
    conn: &rusqlite::Connection,
    tenant_id: &str,
) -> SubscriptionTier {
    if let Ok(tier_key) = conn.query_row(
        "SELECT tier_key FROM tenant_subscription WHERE tenant_id = ?1",
        params![tenant_id],
        |row| row.get::<_, String>(0),
    ) {
        return SubscriptionTier::from_db(&tier_key);
    }

    if let Ok(plan) = conn.query_row(
        "SELECT plan FROM tenant_plans WHERE tenant_id = ?1",
        params![tenant_id],
        |row| row.get::<_, String>(0),
    ) {
        return SubscriptionTier::from_db(&plan);
    }

    SubscriptionTier::Free
}

/// Count products for a tenant on SQLite.
pub fn count_tenant_products_sqlite(conn: &rusqlite::Connection, tenant_id: &str) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM products WHERE tenant_id = ?1",
        params![tenant_id],
        |row| row.get::<_, i64>(0),
    )
    .unwrap_or(0)
}

/// Count active staff users (excluding owner) for a tenant on SQLite.
pub fn count_tenant_staff_sqlite(conn: &rusqlite::Connection, tenant_id: &str) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM users WHERE tenant_id = ?1 AND is_active = 1 AND role_id != ?2",
        params![tenant_id, kasirmu_core::builtin_roles::OWNER],
        |row| row.get::<_, i64>(0),
    )
    .unwrap_or(0)
}

/// Count locations for a tenant on SQLite.
pub fn count_tenant_locations_sqlite(conn: &rusqlite::Connection, tenant_id: &str) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM locations WHERE tenant_id = ?1",
        params![tenant_id],
        |row| row.get::<_, i64>(0),
    )
    .unwrap_or(0)
}

/// Check quota violations for a single tenant on SQLite.
pub fn check_tenant_quota_sqlite(
    conn: &rusqlite::Connection,
    tenant_id: &str,
) -> Vec<TenantQuotaViolation> {
    let tier = resolve_tenant_tier_sqlite(conn, tenant_id);
    let mut violations = Vec::new();

    // Check products axis
    if let Some(cap) = tier.max_products() {
        let count = count_tenant_products_sqlite(conn, tenant_id);
        if count > cap {
            violations.push(TenantQuotaViolation {
                tenant_id: tenant_id.to_string(),
                tier: tier.clone(),
                dimension: QuotaDimensionKind::Products,
                observed_count: count,
                allowed_cap: cap,
            });
        }
    }

    // Check staff axis
    if let Some(cap) = tier.max_staff_users() {
        let count = count_tenant_staff_sqlite(conn, tenant_id);
        if count > cap {
            violations.push(TenantQuotaViolation {
                tenant_id: tenant_id.to_string(),
                tier: tier.clone(),
                dimension: QuotaDimensionKind::Staff,
                observed_count: count,
                allowed_cap: cap,
            });
        }
    }

    // Check locations axis
    if let Some(cap) = tier.max_locations() {
        let count = count_tenant_locations_sqlite(conn, tenant_id);
        if count > cap {
            violations.push(TenantQuotaViolation {
                tenant_id: tenant_id.to_string(),
                tier: tier.clone(),
                dimension: QuotaDimensionKind::Locations,
                observed_count: count,
                allowed_cap: cap,
            });
        }
    }

    violations
}

/// Enumerate distinct active tenants on SQLite.
pub fn enumerate_active_tenants_sqlite(conn: &rusqlite::Connection) -> Vec<String> {
    let mut tenants = Vec::new();
    let query = "SELECT DISTINCT tenant_id FROM tenant_plans \
                 UNION SELECT DISTINCT tenant_id FROM products \
                 UNION SELECT DISTINCT tenant_id FROM users \
                 UNION SELECT DISTINCT tenant_id FROM locations";
    if let Ok(mut stmt) = conn.prepare(query)
        && let Ok(rows) = stmt.query_map([], |row| row.get::<_, String>(0))
    {
        for row in rows.flatten() {
            if !row.trim().is_empty() {
                tenants.push(row);
            }
        }
    }
    if !tenants.iter().any(|t| t == "default") {
        tenants.push("default".to_string());
    }
    tenants.sort();
    tenants.dedup();
    tenants
}

/// Scan all active tenants on SQLite and return all quota violations.
pub fn scan_all_tenants_quota_sqlite(conn: &rusqlite::Connection) -> Vec<TenantQuotaViolation> {
    let tenants = enumerate_active_tenants_sqlite(conn);
    let mut all_violations = Vec::new();
    for tenant_id in &tenants {
        all_violations.extend(check_tenant_quota_sqlite(conn, tenant_id));
    }
    all_violations
}

// ── PostgreSQL Queries ───────────────────────────────────────────────

/// Resolve a tenant's subscription tier on PostgreSQL.
pub async fn resolve_tenant_tier_pg(
    client: &deadpool_postgres::Client,
    tenant_id: &str,
) -> Result<SubscriptionTier, String> {
    if let Ok(Some(row)) = client
        .query_opt(
            "SELECT tier_key FROM tenant_subscription WHERE tenant_id = $1",
            &[&tenant_id],
        )
        .await
    {
        let tier_key: String = row.get(0);
        return Ok(SubscriptionTier::from_db(&tier_key));
    }

    if let Ok(Some(row)) = client
        .query_opt(
            "SELECT plan FROM tenant_plans WHERE tenant_id = $1",
            &[&tenant_id],
        )
        .await
    {
        let plan: String = row.get(0);
        return Ok(SubscriptionTier::from_db(&plan));
    }

    Ok(SubscriptionTier::Free)
}

/// Count products for a tenant on PostgreSQL.
pub async fn count_tenant_products_pg(
    client: &deadpool_postgres::Client,
    tenant_id: &str,
) -> Result<i64, String> {
    let row = client
        .query_one(
            "SELECT COUNT(*) FROM products WHERE tenant_id = $1",
            &[&tenant_id],
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(row.get::<_, i64>(0))
}

/// Count active staff users (excluding owner) for a tenant on PostgreSQL.
pub async fn count_tenant_staff_pg(
    client: &deadpool_postgres::Client,
    tenant_id: &str,
) -> Result<i64, String> {
    let row = client
        .query_one(
            "SELECT COUNT(*) FROM users WHERE tenant_id = $1 AND is_active = 1 AND role_id != $2",
            &[&tenant_id, &kasirmu_core::builtin_roles::OWNER],
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(row.get::<_, i64>(0))
}

/// Count locations for a tenant on PostgreSQL.
pub async fn count_tenant_locations_pg(
    client: &deadpool_postgres::Client,
    tenant_id: &str,
) -> Result<i64, String> {
    let row = client
        .query_one(
            "SELECT COUNT(*) FROM locations WHERE tenant_id = $1",
            &[&tenant_id],
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(row.get::<_, i64>(0))
}

/// Check quota violations for a single tenant on PostgreSQL.
pub async fn check_tenant_quota_pg(
    client: &deadpool_postgres::Client,
    tenant_id: &str,
) -> Result<Vec<TenantQuotaViolation>, String> {
    let tier = resolve_tenant_tier_pg(client, tenant_id).await?;
    let mut violations = Vec::new();

    // Check products axis
    if let Some(cap) = tier.max_products() {
        let count = count_tenant_products_pg(client, tenant_id).await?;
        if count > cap {
            violations.push(TenantQuotaViolation {
                tenant_id: tenant_id.to_string(),
                tier: tier.clone(),
                dimension: QuotaDimensionKind::Products,
                observed_count: count,
                allowed_cap: cap,
            });
        }
    }

    // Check staff axis
    if let Some(cap) = tier.max_staff_users() {
        let count = count_tenant_staff_pg(client, tenant_id).await?;
        if count > cap {
            violations.push(TenantQuotaViolation {
                tenant_id: tenant_id.to_string(),
                tier: tier.clone(),
                dimension: QuotaDimensionKind::Staff,
                observed_count: count,
                allowed_cap: cap,
            });
        }
    }

    // Check locations axis
    if let Some(cap) = tier.max_locations() {
        let count = count_tenant_locations_pg(client, tenant_id).await?;
        if count > cap {
            violations.push(TenantQuotaViolation {
                tenant_id: tenant_id.to_string(),
                tier: tier.clone(),
                dimension: QuotaDimensionKind::Locations,
                observed_count: count,
                allowed_cap: cap,
            });
        }
    }

    Ok(violations)
}

/// Scan all active tenants on PostgreSQL and return all quota violations.
pub async fn scan_all_tenants_quota_pg(
    pool: &deadpool_postgres::Pool,
) -> Result<Vec<TenantQuotaViolation>, String> {
    let tenants = crate::email_pg::active_tenants_pg(pool).await?;
    let client = pool.get().await.map_err(|e| e.to_string())?;
    let mut all_violations = Vec::new();

    for tenant_id in &tenants {
        match check_tenant_quota_pg(&client, tenant_id).await {
            Ok(violations) => all_violations.extend(violations),
            Err(e) => {
                warn!(tenant = %tenant_id, error = %e, "quota_detector (pg): tenant check failed");
            }
        }
    }

    Ok(all_violations)
}

// ── Alert Rendering & Dispatch ──────────────────────────────────────

/// Render the subject and body for a quota-effect alert.
pub fn render_quota_alert(v: &TenantQuotaViolation) -> (String, String) {
    let subject = format!(
        "kasir.mu: tenant has exceeded their tier cap for {}",
        v.dimension.label()
    );
    let body = format!(
        r#"Hi,

A tenant has more {dim_label} registered in cloud sync than their subscription tier permits.

  Tenant:   {tenant_id}
  Observed: {observed_count} active
  Allowed:  {allowed_cap}
  Tier:     {tier_name}

This is a SIGNAL, not proof of wrongdoing. A local quota gate normally prevents
this, so the usual innocent explanations are:

  1. A tier change that has not fully synced to the affected terminal.
  2. A restore from a backup taken on a larger plan.
  3. A support correction that raised or lowered a limit by hand.

The one explanation that is not innocent is a modified client that skipped the
gate, which is what this signal exists to catch. Nothing about this report can
tell those apart — only a person can.

What to check:

  - Whether the tenant recently changed tier or restored a backup.
  - Whether the records appear legitimate.
  - If it looks deliberate, review the tenant from the admin dashboard.

Nothing has been locked. This system deliberately never auto-terminates an
account; a false positive must not dark a shop.

--- The kasir.mu Security Team"#,
        dim_label = v.dimension.label(),
        tenant_id = v.tenant_id,
        observed_count = v.observed_count,
        allowed_cap = v.allowed_cap,
        tier_name = v.tier.name(),
    );
    (subject, body)
}

/// Process a single violation: evaluate cooldown, send email or log.
pub async fn process_violation(
    v: &TenantQuotaViolation,
    config: &CloudServerConfig,
    state: &QuotaAlertState,
    now: Instant,
) {
    let condition = v.dimension.condition_key();
    if state.is_suppressed(&v.tenant_id, condition, now).await {
        info!(
            tenant = %v.tenant_id,
            condition = %condition,
            "quota_detector: violation within 7-day cooldown window — skipping repeat alert"
        );
        return;
    }

    warn!(
        tenant = %v.tenant_id,
        tier = %v.tier.tier_key(),
        dimension = %v.dimension.label(),
        observed = v.observed_count,
        cap = v.allowed_cap,
        "quota_detector: OVER-QUOTA SIGNAL DETECTED"
    );

    let Some(smtp_config) = config.alert_smtp_config() else {
        warn!(
            tenant = %v.tenant_id,
            "quota_detector: OZ_SMTP_HOST not configured — quota alert logged only, cooldown not stamped"
        );
        return;
    };

    let (subject, body) = render_quota_alert(v);
    let escaped_body = body
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;");
    let report_email = kasirmu_core::export::email_report::ReportEmail {
        subject,
        text_body: body.clone(),
        html_body: format!("<pre>{escaped_body}</pre>"),
    };

    match send_email(
        &smtp_config,
        &report_email,
        std::slice::from_ref(&config.admin_email),
    )
    .await
    {
        Ok(()) => {
            info!(
                tenant = %v.tenant_id,
                recipient = %config.admin_email,
                condition = %condition,
                "quota_detector: alert email delivered to operator"
            );
            state.record_alert(&v.tenant_id, condition, now).await;
        }
        Err(e) => {
            error!(
                tenant = %v.tenant_id,
                recipient = %config.admin_email,
                error = %e,
                "quota_detector: failed to deliver alert email — cooldown not stamped"
            );
        }
    }
}

// ── Background Scan Cycles ──────────────────────────────────────────

/// Execute one scan cycle for SQLite.
pub async fn run_quota_scan_cycle_sqlite(
    db: &Arc<Mutex<rusqlite::Connection>>,
    config: &CloudServerConfig,
    state: &QuotaAlertState,
) {
    let db = db.clone();
    let violations = tokio::task::spawn_blocking(move || {
        let conn = db.blocking_lock();
        scan_all_tenants_quota_sqlite(&conn)
    })
    .await
    .unwrap_or_default();

    let now = Instant::now();
    for v in &violations {
        process_violation(v, config, state, now).await;
    }
}

/// Execute one scan cycle for PostgreSQL.
pub async fn run_quota_scan_cycle_pg(
    pool: &deadpool_postgres::Pool,
    config: &CloudServerConfig,
    state: &QuotaAlertState,
) {
    let violations = match scan_all_tenants_quota_pg(pool).await {
        Ok(v) => v,
        Err(e) => {
            error!(error = %e, "quota_detector (pg): scan cycle failed");
            return;
        }
    };

    let now = Instant::now();
    for v in &violations {
        process_violation(v, config, state, now).await;
    }
}

/// Start the background quota detection loop on SQLite.
/// Runs every 24 hours (with an initial run shortly after boot).
pub fn start_quota_detector_loop_sqlite(
    db: Arc<Mutex<rusqlite::Connection>>,
    config: CloudServerConfig,
) {
    let state = QuotaAlertState::new();
    tokio::spawn(async move {
        info!("quota_detector (sqlite): background loop started (interval = 24h)");
        // Initial run after 15 seconds to allow migrations and initial sync to settle
        tokio::time::sleep(Duration::from_secs(15)).await;
        run_quota_scan_cycle_sqlite(&db, &config, &state).await;

        let mut interval = tokio::time::interval(Duration::from_secs(86400));
        interval.tick().await; // consume initial tick

        loop {
            interval.tick().await;
            run_quota_scan_cycle_sqlite(&db, &config, &state).await;
        }
    });
}

/// Start the background quota detection loop on PostgreSQL.
/// Runs every 24 hours (with an initial run shortly after boot).
pub fn start_quota_detector_loop_pg(pool: deadpool_postgres::Pool, config: CloudServerConfig) {
    let state = QuotaAlertState::new();
    tokio::spawn(async move {
        info!("quota_detector (pg): background loop started (interval = 24h)");
        // Initial run after 15 seconds to allow migrations and initial sync to settle
        tokio::time::sleep(Duration::from_secs(15)).await;
        run_quota_scan_cycle_pg(&pool, &config, &state).await;

        let mut interval = tokio::time::interval(Duration::from_secs(86400));
        interval.tick().await; // consume initial tick

        loop {
            interval.tick().await;
            run_quota_scan_cycle_pg(&pool, &config, &state).await;
        }
    });
}

#[cfg(test)]
#[path = "quota_detector_tests.rs"]
mod tests;
