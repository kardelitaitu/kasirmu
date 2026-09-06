//! Subscription capability command (C2.2 in-app upgrade triggers).
//!
//! Tablet mirror of the desktop command: exposes the active tenant
//! subscription's quotas and feature flags plus current usage counts so the
//! shared UI can render tier gates (QRIS gate, terminal-limit banner, …).

use serde::Serialize;
use tauri::{State, command};

use oz_core::db::Store;
use oz_core::subscription::TenantSubscription;

use crate::error::AppError;
use crate::state::AppState;

/// The tenant's tier capabilities + current usage (C2.2).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionCapabilitiesDto {
    /// Tier key (`free`, `plus`, `pro`, `premium`, `enterprise`).
    pub tier: String,
    /// Maximum stores allowed (`None` = unlimited).
    pub max_stores: Option<i64>,
    /// Maximum POS registers per store (`None` = unlimited).
    pub max_pos_instances: Option<i64>,
    /// Maximum inventory warehouses (`None` = unlimited).
    pub max_warehouses: Option<i64>,
    /// Maximum staff users (`None` = unlimited).
    pub max_staff_users: Option<i64>,
    /// Free = 3 months; Plus = 1 year; Pro = 5 years; Premium/Enterprise = unlimited (`None`).
    pub sales_history_days: Option<i64>,
    /// Whether the tier can process QRIS payments (Plus+).
    pub supports_qris: bool,
    /// Whether the tier can view analytics (Pro+).
    pub supports_analytics: bool,
    /// C4.3: Add-on identifiers purchased with this license.
    pub addons: Vec<String>,
    /// Whether the tier can run the loyalty program (Premium+).
    pub supports_loyalty: bool,
    /// Whether the tier has the Daily Sales Dashboard (Plus+).
    pub supports_daily_dashboard: bool,
    /// Whether the tier has cloud DB sync (Plus+).
    pub supports_cloud_sync: bool,
    /// Offline grace period in days.
    pub offline_grace_days: i64,
    /// Current location count (approaching-limit banners).
    pub location_count: i64,
    /// Current active staff count (approaching-limit banners).
    pub staff_count: i64,
    /// Current registered terminal count (limit banners).
    pub terminal_count: i64,
}

/// Read the tenant's subscription capabilities and current usage.
#[command]
pub async fn get_subscription_capabilities(
    state: State<'_, AppState>,
) -> Result<SubscriptionCapabilitiesDto, AppError> {
    let db = state.db.lock().await;
    let sub = TenantSubscription::load(&db, "default")?
        .ok_or_else(|| AppError::Internal("default tenant subscription not found".into()))?;
    sub.verify_signature()?;
    let tier = sub.effective_tier();

    let location_count: i64 = db
        .query_row("SELECT COUNT(*) FROM locations", [], |r| r.get(0))
        .map_err(|e| AppError::Internal(format!("count locations: {e}")))?;
    let terminal_count: i64 = db
        .query_row("SELECT COUNT(*) FROM terminals", [], |r| r.get(0))
        .map_err(|e| AppError::Internal(format!("count terminals: {e}")))?;
    let staff_count = Store::new(&db).count_staff_users()?;

    drop(db);

    Ok(SubscriptionCapabilitiesDto {
        tier: tier.tier_key().to_string(),
        max_stores: tier.max_stores(),
        max_pos_instances: tier.max_pos_instances(),
        max_warehouses: tier.max_warehouses(),
        max_staff_users: tier.max_staff_users(),
        sales_history_days: tier.sales_history_days(),
        supports_qris: tier.supports_qris(),
        supports_analytics: sub.supports_analytics_with_addons(),
        supports_loyalty: tier.supports_loyalty(),
        supports_daily_dashboard: tier.supports_daily_dashboard(),
        supports_cloud_sync: tier.supports_cloud_sync(),
        offline_grace_days: tier.offline_grace_days(),
        location_count,
        staff_count,
        terminal_count,
        addons: sub.addons(),
    })
}
