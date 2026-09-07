//! Subscription capability command (C2.2 in-app upgrade triggers).
//!
//! Exposes the tenant subscription's quotas and feature flags — straight
//! from `SubscriptionTier` in oz-core — plus the tenant's current usage
//! counts (stores, staff, terminals). The UI uses this single read to
//! render tier gates: analytics/loyalty locks, QRIS gate, second-store
//! gate, terminal-limit banner, and the approaching-limit banners.
//!
//! Fail-closed (todo-global-saas-1.md §B): the payload always carries a
//! lifecycle `state`; a missing/tampered/unreadable subscription yields
//! Free entitlements + `unavailable` instead of an IPC error, because the
//! UI's error path renders gates open.

use serde::Serialize;
use tauri::State;

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

/// Load the tenant's capabilities + usage from the global identity DB.
///
/// Fail-closed (todo-global-saas-1.md §B): a missing row, a tampered
/// signature, or an unreadable subscription table must NOT error into the
/// UI's catch path (where `caps: null` renders every gate open). It
/// returns Free-tier capabilities with `state: "unavailable"` so every
/// tier gate locks; the UI shows the state instead of silently granting.
fn load_capabilities(db: &rusqlite::Connection) -> Result<SubscriptionCapabilitiesDto, AppError> {
    let loaded = match TenantSubscription::load(db, "default") {
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

    let state = loaded
        .as_ref()
        .map(|sub| sub.lifecycle_state())
        .unwrap_or(SubscriptionLifecycleState::Unavailable);
    // Grace-aware entitlement tier; Free when the subscription is not
    // readable (fail closed).
    let tier = loaded
        .as_ref()
        .map(|sub| sub.effective_tier())
        .unwrap_or(SubscriptionTier::Free);

    // In debug/dev builds, upgrade the bootstrap Free tier to Premium so
    // all features are available during development. This mirrors the
    // dev-mock's behavior (which returns Pro-tier capabilities). The real
    // Free tier is only enforced in release builds where a license server
    // issues signed subscriptions. The upgrade applies only to a genuinely
    // `active` subscription — expired/canceled/paused/unavailable rows
    // keep their downgraded entitlements so dev can exercise those paths.
    #[cfg(debug_assertions)]
    let tier = if state == SubscriptionLifecycleState::Active && tier == SubscriptionTier::Free {
        SubscriptionTier::Premium
    } else {
        tier
    };

    // Usage counts are best-effort: they drive approaching-limit banners
    // only, and a broken global DB must still yield a definitive
    // fail-closed capabilities payload rather than an IPC error.
    let count = |sql: &str| -> i64 {
        db.query_row(sql, [], |r| r.get(0)).unwrap_or_else(|e| {
            tracing::warn!("usage count failed ({sql}) — reporting 0: {e}");
            0
        })
    };
    let staff_count = Store::new(db).count_staff_users().unwrap_or_else(|e| {
        tracing::warn!("staff count failed — reporting 0: {e}");
        0
    });

    Ok(SubscriptionCapabilitiesDto {
        tier: tier.tier_key().to_string(),
        state: state.as_str().to_string(),
        // Canonical wire name (the 1b staged migration completes here):
        // the field is `max_locations`, the quota method always was.
        max_locations: tier.max_locations(),
        max_pos_instances: tier.max_pos_instances(),
        max_warehouses: tier.max_warehouses(),
        max_staff_users: tier.max_staff_users(),
        sales_history_days: tier.sales_history_days(),
        supports_qris: tier.supports_qris(),
        // Addon-aware (C4.3): Plus + advanced_analytics unlocks analytics —
        // parity with the tablet command. The static part comes from the
        // entitlement tier (so the dev Free→Premium upgrade applies); the
        // addon grant flows only while the subscription is active or in
        // grace — canceled/expired rows get the downgraded answer.
        supports_analytics: tier.supports_analytics()
            || ((state == SubscriptionLifecycleState::Active
                || state == SubscriptionLifecycleState::Grace)
                && loaded
                    .as_ref()
                    .is_some_and(|sub| sub.supports_analytics_with_addons())),
        supports_loyalty: tier.supports_loyalty(),
        supports_daily_dashboard: tier.supports_daily_dashboard(),
        supports_cloud_sync: tier.supports_cloud_sync(),
        offline_grace_days: tier.offline_grace_days(),
        location_count: count("SELECT COUNT(*) FROM locations"),
        staff_count,
        terminal_count: count("SELECT COUNT(*) FROM terminals"),
        addons: loaded.as_ref().map(|sub| sub.addons()).unwrap_or_default(),
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
