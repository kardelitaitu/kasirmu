//! Feature-availability verdicts — *why* a feature is unavailable.
//!
//! Every entitlement gate in the app answers a boolean question and cannot
//! explain itself: `caps.supportsAnalytics === false` tells support nothing
//! about whether the cause is the plan, the expiry, the location count, or
//! the caller's role. This module is the single place that turns the raw
//! facts behind those gates into a ranked [`FeatureVerdict`].
//!
//! Key types: [`AvailabilityFeature`] (the v1 key set — exactly the surface
//! the existing gates consume, no new flags), [`AvailabilityFacts`] (the
//! inputs, gathered by the caller), and [`FeatureVerdict`] / [`VerdictDetail`]
//! (the output). Entry point: [`explain_availability`].
//!
//! Invariants:
//!
//! - **Pure.** No database, no clock, no network. Every input arrives in
//!   [`AvailabilityFacts`], so the precedence table is exhaustively testable
//!   without fixtures, and a verdict can never disagree with a live gate
//!   because of a read that happened twice.
//! - **One winner.** Only the highest-precedence denial is named. Lower
//!   causes are still computed into [`VerdictDetail`] but never reported.
//! - **Fixed precedence:** server_policy > lifecycle > tier > quota > role >
//!   scope (todo-global-saas-3.md, Feature-flag observability design).
//! - **Fail closed on unknown keys.** [`AvailabilityFeature::parse`] returns
//!   `None` for anything unrecognized; an unknown key is never default-allow.
//! - **`scope` cannot outrank `role`.** Role is evaluated first on purpose:
//!   naming a location the caller cannot act on is worse than saying they
//!   hold no such permission anywhere.

use serde::Serialize;

use crate::subscription::{SubscriptionLifecycleState, SubscriptionTier};

/// A feature the resolver can explain.
///
/// The keys mirror the capabilities field names the existing gates already
/// read — the five `supports_*` flags, the sales-history window, and the
/// four quota families — so this adds no new flag to invent or keep in sync.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AvailabilityFeature {
    /// QRIS payment processing (`supports_qris`, Plus+).
    Qris,
    /// Sales analytics (`supports_analytics`, Pro+, or Plus with the
    /// `advanced_analytics` add-on).
    Analytics,
    /// Loyalty program (`supports_loyalty`, Premium+).
    Loyalty,
    /// Daily sales dashboard (`supports_daily_dashboard`, Plus+).
    DailyDashboard,
    /// Cloud database sync (`supports_cloud_sync`, Plus+).
    CloudSync,
    /// The sales-history window itself (`sales_history_days`).
    SalesHistoryDays,
    /// Location quota family (`max_locations` vs location count).
    Locations,
    /// Staff-user quota family (`max_staff_users` vs staff count).
    StaffUsers,
    /// POS-instance quota family (`max_pos_instances` vs terminal count).
    PosInstances,
    /// Warehouse quota family (`max_warehouses` vs warehouse count).
    ///
    /// Usage comes from `Store::count_warehouse_locations`, the same count
    /// the creation-time inventory gate consults — not from
    /// `validate_warehouse_capacity`, which is a different concept (physical
    /// stock against node capacity, not an instance count).
    Warehouses,
}

/// How a feature is gated, which decides which sources can deny it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FeatureKind {
    /// A boolean `supports_*` flag on the tier.
    TierFlag,
    /// A day window rather than an on/off gate.
    HistoryWindow,
    /// A tier limit compared against current usage.
    Quota,
}

impl AvailabilityFeature {
    /// The wire key, identical to the capabilities field the gates consume.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Qris => "supports_qris",
            Self::Analytics => "supports_analytics",
            Self::Loyalty => "supports_loyalty",
            Self::DailyDashboard => "supports_daily_dashboard",
            Self::CloudSync => "supports_cloud_sync",
            Self::SalesHistoryDays => "sales_history_days",
            Self::Locations => "locations",
            Self::StaffUsers => "staff_users",
            Self::PosInstances => "pos_instances",
            Self::Warehouses => "warehouses",
        }
    }

    /// Parse a wire key. `None` for anything unrecognized — an unknown key
    /// must never resolve to "available".
    #[must_use]
    pub fn parse(key: &str) -> Option<Self> {
        match key {
            "supports_qris" => Some(Self::Qris),
            "supports_analytics" => Some(Self::Analytics),
            "supports_loyalty" => Some(Self::Loyalty),
            "supports_daily_dashboard" => Some(Self::DailyDashboard),
            "supports_cloud_sync" => Some(Self::CloudSync),
            "sales_history_days" => Some(Self::SalesHistoryDays),
            "locations" => Some(Self::Locations),
            "staff_users" => Some(Self::StaffUsers),
            "pos_instances" => Some(Self::PosInstances),
            "warehouses" => Some(Self::Warehouses),
            _ => None,
        }
    }

    /// Every v1 key, for enumeration by diagnostics and by the round-trip test.
    pub const ALL: [AvailabilityFeature; 10] = [
        Self::Qris,
        Self::Analytics,
        Self::Loyalty,
        Self::DailyDashboard,
        Self::CloudSync,
        Self::SalesHistoryDays,
        Self::Locations,
        Self::StaffUsers,
        Self::PosInstances,
        Self::Warehouses,
    ];

    /// How this feature is gated.
    #[must_use]
    fn kind(self) -> FeatureKind {
        match self {
            Self::Qris
            | Self::Analytics
            | Self::Loyalty
            | Self::DailyDashboard
            | Self::CloudSync => FeatureKind::TierFlag,
            Self::SalesHistoryDays => FeatureKind::HistoryWindow,
            Self::Locations | Self::StaffUsers | Self::PosInstances | Self::Warehouses => {
                FeatureKind::Quota
            }
        }
    }

    /// Whether the tier grants this feature on its own, ignoring add-ons,
    /// lifecycle, usage, and the caller's role.
    #[must_use]
    fn tier_allows(self, tier: &SubscriptionTier) -> bool {
        match self {
            Self::Qris => tier.supports_qris(),
            Self::Analytics => tier.supports_analytics(),
            Self::Loyalty => tier.supports_loyalty(),
            Self::DailyDashboard => tier.supports_daily_dashboard(),
            Self::CloudSync => tier.supports_cloud_sync(),
            // The history window is a limit, not an on/off gate — every tier
            // has some window, so only a zero-day window removes the feature.
            Self::SalesHistoryDays => tier.sales_history_days() != Some(0),
            // Quota families are never denied by the tier alone: the tier
            // supplies a limit, and `quota` decides whether it is reached.
            Self::Locations | Self::StaffUsers | Self::PosInstances | Self::Warehouses => true,
        }
    }

    /// The tier's limit for this feature, when it has one. `None` means
    /// unlimited, or that the feature is not limit-shaped at all.
    ///
    /// Public because diagnostics callers surface the same number the
    /// resolver compared against, and a second source for it would drift.
    #[must_use]
    pub fn tier_limit(self, tier: &SubscriptionTier) -> Option<i64> {
        match self {
            Self::Locations => tier.max_locations(),
            Self::StaffUsers => tier.max_staff_users(),
            Self::PosInstances => tier.max_pos_instances(),
            Self::Warehouses => tier.max_warehouses(),
            Self::SalesHistoryDays => tier.sales_history_days(),
            _ => None,
        }
    }

    /// Current consumption, when this feature is a counted quota.
    #[must_use]
    fn usage(self, counts: UsageCounts) -> Option<i64> {
        match self {
            Self::Locations => Some(counts.locations),
            Self::StaffUsers => Some(counts.staff_users),
            Self::PosInstances => Some(counts.pos_instances),
            Self::Warehouses => Some(counts.warehouses),
            _ => None,
        }
    }
}

/// Why a feature is unavailable, ordered highest precedence first.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AvailabilityReason {
    /// The signed server payload withholds an entitlement the tier alone
    /// would grant.
    ServerPolicy,
    /// Lifecycle state is neither `active` nor `grace` (§B fail-closed).
    Lifecycle,
    /// The effective tier does not include the feature.
    Tier,
    /// The tier's limit for this feature is already reached.
    Quota,
    /// The caller's resolved role does not grant the required permission.
    Role,
    /// The caller's scoped assignment excludes the target resource.
    Scope,
}

impl AvailabilityReason {
    /// The wire code, matching the reason-code table in the design.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ServerPolicy => "server_policy",
            Self::Lifecycle => "lifecycle",
            Self::Tier => "tier",
            Self::Quota => "quota",
            Self::Role => "role",
            Self::Scope => "scope",
        }
    }

    /// All six codes in precedence order, highest first.
    pub const PRECEDENCE: [AvailabilityReason; 6] = [
        Self::ServerPolicy,
        Self::Lifecycle,
        Self::Tier,
        Self::Quota,
        Self::Role,
        Self::Scope,
    ];
}

/// Current consumption of the counted quotas, read from the local DB.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct UsageCounts {
    /// Locations in the organization.
    pub locations: i64,
    /// Active staff users.
    pub staff_users: i64,
    /// Registered POS instances.
    pub pos_instances: i64,
    /// Warehouse inventory locations.
    pub warehouses: i64,
}

/// Everything the resolver reads, assembled by the caller from the same
/// local signed row the capabilities command uses — offline-honest by
/// construction, with no server round-trip.
#[derive(Debug, Clone)]
pub struct AvailabilityFacts<'a> {
    /// The feature being asked about.
    pub feature: AvailabilityFeature,
    /// Grace-aware effective tier. The caller resolves this through
    /// `TenantSubscription::effective_tier` so a lapsed subscription arrives
    /// as Free rather than under its nominal tier.
    pub tier: &'a SubscriptionTier,
    /// §B lifecycle state.
    pub state: SubscriptionLifecycleState,
    /// Current quota consumption.
    pub usage: UsageCounts,
    /// Server-issued entitlement for this feature from the signed payload:
    /// `Some(true)` grants beyond the tier (an add-on path), `Some(false)`
    /// withholds what the tier would grant, `None` leaves the question to
    /// the tier.
    pub server_grant: Option<bool>,
    /// Whether the caller's resolved role grants the feature's permission.
    pub role_granted: bool,
    /// Whether the caller's assignment covers the target resource. `None`
    /// when the question has no resource target, so `scope` cannot win
    /// precedence over a real answer.
    pub scope_granted: Option<bool>,
    /// The permission key the gate consults, echoed for diagnostics.
    pub permission: Option<&'a str>,
    /// Signed-row expiry, echoed verbatim so the UI can say "expired 3 days
    /// ago" rather than just "expired". `None` until the caller has it.
    pub expires_at: Option<&'a str>,
    /// End of the offline grace window, echoed verbatim.
    pub grace_until: Option<&'a str>,
}

impl<'a> AvailabilityFacts<'a> {
    /// A permissive fact set that isolates one axis: everything allows except
    /// what a test deliberately overrides.
    #[must_use]
    pub fn baseline(
        feature: AvailabilityFeature,
        tier: &'a SubscriptionTier,
    ) -> AvailabilityFacts<'a> {
        Self {
            feature,
            tier,
            state: SubscriptionLifecycleState::Active,
            usage: UsageCounts::default(),
            server_grant: None,
            role_granted: true,
            scope_granted: None,
            permission: None,
            expires_at: None,
            grace_until: None,
        }
    }
}

/// Renderable fields, so the UI never re-derives a message from a reason
/// code. Every field is advisory detail — the verdict is `available` plus
/// `reason`, never a re-read of these.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerdictDetail {
    /// Tier key (`free`, `plus`, `pro`, `premium`, `enterprise`).
    pub tier: &'static str,
    /// Lifecycle state wire name.
    pub state: &'static str,
    /// The tier's limit for this feature; `None` = unlimited or not applicable.
    pub limit: Option<i64>,
    /// Current usage against [`limit`](Self::limit).
    pub usage: Option<i64>,
    /// The permission key the gate consults, when one applies.
    pub permission: Option<String>,
    /// Signed expiry, verbatim.
    pub expires_at: Option<String>,
    /// Grace-window end, verbatim.
    pub grace_until: Option<String>,
}

/// The resolver's answer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeatureVerdict {
    /// The wire key this verdict is about.
    pub feature: &'static str,
    /// Whether the feature is available on these facts.
    pub available: bool,
    /// The highest-precedence denial; `None` exactly when `available`.
    pub reason: Option<AvailabilityReason>,
    /// Fields the UI renders directly.
    pub detail: VerdictDetail,
}

impl FeatureVerdict {
    /// The reason as a wire code, `None` when available. Convenience for IPC
    /// DTOs that serialize the reason as a plain string.
    #[must_use]
    pub fn reason_code(&self) -> Option<&'static str> {
        self.reason.map(AvailabilityReason::as_str)
    }
}

/// Resolve the highest-precedence reason a feature is unavailable.
///
/// Evaluation order is the contract: server_policy > lifecycle > tier >
/// quota > role > scope. A server grant (`server_grant: Some(true)`)
/// suppresses only the `tier` check — it cannot out-vote an expired
/// subscription or a caller holding no permission, which is why it is not
/// modelled as an early "available".
#[must_use]
pub fn explain_availability(facts: &AvailabilityFacts<'_>) -> FeatureVerdict {
    let feature = facts.feature;

    // Each source reduced to a boolean first, so the chain below is the only
    // place the precedence ordering lives.
    let server_denies = facts.server_grant == Some(false);
    let server_grants = facts.server_grant == Some(true);
    let lifecycle_denies = !matches!(
        facts.state,
        SubscriptionLifecycleState::Active | SubscriptionLifecycleState::Grace
    );
    let tier_denies = !server_grants && !feature.tier_allows(facts.tier);
    let limit = feature.tier_limit(facts.tier);
    let usage = feature.usage(facts.usage);
    let quota_denies = matches!(
        (feature.kind(), limit, usage),
        (FeatureKind::Quota, Some(cap), Some(used)) if used >= cap
    );
    let role_denies = !facts.role_granted;
    let scope_denies = facts.scope_granted == Some(false);

    let reason = if server_denies {
        Some(AvailabilityReason::ServerPolicy)
    } else if lifecycle_denies {
        Some(AvailabilityReason::Lifecycle)
    } else if tier_denies {
        Some(AvailabilityReason::Tier)
    } else if quota_denies {
        Some(AvailabilityReason::Quota)
    } else if role_denies {
        Some(AvailabilityReason::Role)
    } else if scope_denies {
        Some(AvailabilityReason::Scope)
    } else {
        None
    };

    FeatureVerdict {
        feature: feature.as_str(),
        available: reason.is_none(),
        reason,
        detail: VerdictDetail {
            tier: facts.tier.tier_key(),
            state: facts.state.as_str(),
            limit,
            usage,
            permission: facts.permission.map(str::to_string),
            expires_at: facts.expires_at.map(str::to_string),
            grace_until: facts.grace_until.map(str::to_string),
        },
    }
}

#[cfg(test)]
#[path = "availability_tests.rs"]
mod tests;
