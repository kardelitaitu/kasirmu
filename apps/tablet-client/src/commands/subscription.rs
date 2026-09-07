//! Subscription capability command (C2.2 in-app upgrade triggers).
//!
//! Tablet mirror of the desktop command: exposes the active tenant
//! subscription's quotas and feature flags plus current usage counts so the
//! shared UI can render tier gates (QRIS gate, terminal-limit banner, …).
//!
//! Fail-closed (todo-global-saas-1.md §B): the payload always carries a
//! lifecycle `state`; a missing/tampered/unreadable subscription yields
//! Free entitlements + `unavailable` instead of an IPC error, because the
//! UI's error path renders gates open.

use serde::Serialize;
use tauri::{State, command};

use oz_core::db::Store;
use oz_core::subscription::{SubscriptionLifecycleState, SubscriptionTier, TenantSubscription};

use crate::error::AppError;
use crate::state::AppState;

/// The tenant's tier capabilities + current usage (C2.2).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionCapabilitiesDto {
    /// Tier key (`free`, `plus`, `pro`, `premium`, `enterprise`).
    pub tier: String,
    /// Lifecycle state (todo-global-saas-1.md §B): `active`, `grace`,
    /// `expired`, `canceled`, `paused`, or `unavailable`. Anything other
    /// than `active`/`grace` carries Free-tier entitlements below.
    pub state: String,
    /// Maximum locations allowed (`None` = unlimited). Wire name renamed
    /// from `maxStores` — the §B gate the Phase-3 observability slice was
    /// waiting on (UI consumers renamed in the same commit).
    pub max_locations: Option<i64>,
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
///
/// Fail-closed (todo-global-saas-1.md §B): a missing row, a tampered
/// signature, or an unreadable subscription table returns Free-tier
/// capabilities with `state: "unavailable"` instead of an IPC error — the
/// UI's error path renders gates open, so the authoritative fail-closed
/// representation must come from here.
#[command]
pub async fn get_subscription_capabilities(
    state: State<'_, AppState>,
) -> Result<SubscriptionCapabilitiesDto, AppError> {
    let db = state.db.lock().await;
    let loaded = match TenantSubscription::load(&db, "default") {
        Ok(Some(sub)) => match sub.verify_signature() {
            Ok(()) => Some(sub),
            Err(e) => {
                tracing::warn!("subscription signature verification failed — failing closed: {e}");
                None
            }
        },
        Ok(None) => {
            tracing::warn!("no tenant_subscription row for 'default' — failing closed");
            None
        }
        Err(e) => {
            tracing::warn!("tenant_subscription read failed — failing closed: {e}");
            None
        }
    };

    let lifecycle = loaded
        .as_ref()
        .map(|sub| sub.lifecycle_state())
        .unwrap_or(SubscriptionLifecycleState::Unavailable);
    // Grace-aware entitlement tier; Free when the subscription is not
    // readable (fail closed).
    let tier = loaded
        .as_ref()
        .map(|sub| sub.effective_tier())
        .unwrap_or(SubscriptionTier::Free);

    // Usage counts are best-effort: they drive approaching-limit banners
    // only, and a broken global DB must still yield a definitive
    // fail-closed capabilities payload rather than an IPC error.
    let count = |sql: &str| -> i64 {
        db.query_row(sql, [], |r| r.get(0)).unwrap_or_else(|e| {
            tracing::warn!("usage count failed ({sql}) — reporting 0: {e}");
            0
        })
    };
    let staff_count = Store::new(&db).count_staff_users().unwrap_or_else(|e| {
        tracing::warn!("staff count failed — reporting 0: {e}");
        0
    });
    let location_count = count("SELECT COUNT(*) FROM locations");
    let terminal_count = count("SELECT COUNT(*) FROM terminals");

    drop(db);

    Ok(SubscriptionCapabilitiesDto {
        tier: tier.tier_key().to_string(),
        state: lifecycle.as_str().to_string(),
        max_locations: tier.max_locations(),
        max_pos_instances: tier.max_pos_instances(),
        max_warehouses: tier.max_warehouses(),
        max_staff_users: tier.max_staff_users(),
        sales_history_days: tier.sales_history_days(),
        supports_qris: tier.supports_qris(),
        // Addon-aware (C4.3): Plus + advanced_analytics unlocks analytics.
        // The static part comes from the entitlement tier; the addon grant
        // flows only while the subscription is active or in grace —
        // canceled/expired rows get the downgraded answer.
        supports_analytics: tier.supports_analytics()
            || ((lifecycle == SubscriptionLifecycleState::Active
                || lifecycle == SubscriptionLifecycleState::Grace)
                && loaded
                    .as_ref()
                    .is_some_and(|sub| sub.supports_analytics_with_addons())),
        supports_loyalty: tier.supports_loyalty(),
        supports_daily_dashboard: tier.supports_daily_dashboard(),
        supports_cloud_sync: tier.supports_cloud_sync(),
        offline_grace_days: tier.offline_grace_days(),
        location_count,
        staff_count,
        terminal_count,
        addons: loaded.as_ref().map(|sub| sub.addons()).unwrap_or_default(),
    })
}
