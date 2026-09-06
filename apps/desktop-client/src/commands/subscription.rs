//! Subscription capability command (C2.2 in-app upgrade triggers).
//!
//! Exposes the active tenant subscription's quotas and feature flags —
//! straight from `SubscriptionTier` in oz-core — plus the tenant's current
//! usage counts (stores, staff, terminals). The UI uses this single read
//! to render tier gates: analytics/loyalty locks, QRIS gate, second-store
//! gate, terminal-limit banner, and the approaching-limit banners.

use serde::Serialize;
use tauri::State;

use oz_core::db::Store;
use oz_core::subscription::{SubscriptionTier, TenantSubscription};

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
    /// Current store count (approaching-limit banners).
    pub store_count: i64,
    /// Current active staff count (approaching-limit banners).
    pub staff_count: i64,
    /// Current registered terminal count (limit banners).
    pub terminal_count: i64,
}

/// Load the tenant's capabilities + usage from the global identity DB.
fn load_capabilities(db: &rusqlite::Connection) -> Result<SubscriptionCapabilitiesDto, AppError> {
    let sub = TenantSubscription::load(db, "default")?
        .ok_or_else(|| AppError::Internal("default tenant subscription not found".into()))?;
    sub.verify_signature()?;
    let tier = sub.effective_tier();

    // In debug/dev builds, upgrade the bootstrap Free tier to Premium so
    // all features are available during development. This mirrors the
    // dev-mock's behavior (which returns Pro-tier capabilities). The real
    // Free tier is only enforced in release builds where a license server
    // issues signed subscriptions.
    #[cfg(debug_assertions)]
    let tier = if tier == SubscriptionTier::Free {
        SubscriptionTier::Premium
    } else {
        tier
    };

    let store_count: i64 = db
        .query_row("SELECT COUNT(*) FROM locations", [], |r| r.get(0))
        .map_err(|e| AppError::Internal(format!("count locations: {e}")))?;
    let terminal_count: i64 = db
        .query_row("SELECT COUNT(*) FROM terminals", [], |r| r.get(0))
        .map_err(|e| AppError::Internal(format!("count terminals: {e}")))?;
    let staff_count = Store::new(db).count_staff_users()?;

    Ok(SubscriptionCapabilitiesDto {
        tier: tier.tier_key().to_string(),
        max_stores: tier.max_stores(),
        max_pos_instances: tier.max_pos_instances(),
        max_warehouses: tier.max_warehouses(),
        max_staff_users: tier.max_staff_users(),
        sales_history_days: tier.sales_history_days(),
        supports_qris: tier.supports_qris(),
        supports_analytics: tier.supports_analytics(),
        supports_loyalty: tier.supports_loyalty(),
        supports_daily_dashboard: tier.supports_daily_dashboard(),
        supports_cloud_sync: tier.supports_cloud_sync(),
        offline_grace_days: tier.offline_grace_days(),
        store_count,
        staff_count,
        terminal_count,
        addons: sub.addons(),
    })
}

/// Read the tenant's subscription capabilities and current usage.
///
/// Like [`crate::commands::license::get_license_status`], this is a local
/// read — no network call — so the gates render immediately from the
/// bootstrap/activated subscription row.
#[tauri::command]
pub async fn get_subscription_capabilities(
    state: State<'_, AppState>,
) -> Result<SubscriptionCapabilitiesDto, AppError> {
    let db = state.db.lock().await;
    let dto = load_capabilities(&db);
    drop(db);
    dto
}

// ── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "subscription_tests.rs"]
mod tests;
