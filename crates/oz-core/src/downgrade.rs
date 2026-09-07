//! Downgrade assessment — which existing resources exceed a (lower)
//! subscription tier's quotas.
//!
//! When a tenant's plan is downgraded, or a paid tier lapses to Free,
//! resources already created above the new tier's quota must be kept
//! readable and surfaced to the owner rather than silently deleted
//! (adopted §J — `todo-global-saas-2.md` §"Downgrade behavior"). The
//! creation-time gates (`Store::enforce_location_quota`,
//! `enforce_terminal_quota`, `enforce_warehouse_quota`,
//! `enforce_staff_quota`, `enforce_product_quota`) already block *new*
//! resources once a cap is reached; POS registers additionally get the
//! suspend/restore path (`Store::suspend_surplus_instances`, ADR #5
//! Phase 3c). What was missing is the complementary, tenant-level
//! question this module answers: given the effective (post-change) tier
//! and the current per-dimension counts, **which dimensions are over
//! quota and by how much** — the detection layer an owner-facing
//! "archive or upgrade" remediation view consumes.
//!
//! # Two thresholds, deliberately distinguished
//!
//! - **Over quota** (`current > limit`) — the tenant is *above* the cap
//!   and holds resources that must be archived or the plan upgraded.
//!   This is the §J "mark resources above the new quota as `over_quota`"
//!   condition and what [`QuotaUsage::is_over_quota`] reports.
//! - **At the cap** (`current == limit`) — fully compliant, but the next
//!   creation is blocked. Reported by [`QuotaUsage::blocks_creation`] so
//!   a UI can distinguish "remove some" from "you can't add more".
//!
//! An unlimited tier (`limit == None`) is never over quota and never
//! blocks creation.
//!
//! # Scope
//!
//! Only globally-countable dimensions are assessed here. KDS screens are
//! capped per location (`max_kds_screens`, checked against
//! `count_active_kds_instances(store_id)` during topology Apply) and are
//! owned by the workspace/topology path, so they are intentionally not a
//! tenant-global row in this report.

use serde::Serialize;

use crate::subscription::SubscriptionTier;

/// A quota-governed resource category assessable at the tenant (global)
/// level.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum QuotaDimension {
    /// Location profiles (`max_locations`).
    Locations,
    /// Registered POS terminals (`max_pos_instances`).
    PosRegisters,
    /// Active warehouse inventory locations (`max_warehouses`).
    Warehouses,
    /// Active staff users, owner excluded (`max_staff_users`).
    Staff,
    /// Products / menu items (`max_products`).
    Products,
}

impl QuotaDimension {
    /// Stable machine key for the dimension (matches the serde form).
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Locations => "locations",
            Self::PosRegisters => "pos_registers",
            Self::Warehouses => "warehouses",
            Self::Staff => "staff",
            Self::Products => "products",
        }
    }

    /// The tier's cap for this dimension, or `None` when unlimited.
    ///
    /// Single source of truth pairing [`QuotaCounts`]'s field order with
    /// the `SubscriptionTier::max_*` accessors, so [`evaluate`] and any
    /// future caller agree on which limit governs which count.
    pub fn limit_for(self, tier: &SubscriptionTier) -> Option<i64> {
        match self {
            Self::Locations => tier.max_locations(),
            Self::PosRegisters => tier.max_pos_instances(),
            Self::Warehouses => tier.max_warehouses(),
            Self::Staff => tier.max_staff_users(),
            Self::Products => tier.max_products(),
        }
    }
}

/// The canonical order in which dimensions appear in a report. Stable so
/// the UI can render without re-sorting and tests can index positionally.
pub const DIMENSION_ORDER: [QuotaDimension; 5] = [
    QuotaDimension::Locations,
    QuotaDimension::PosRegisters,
    QuotaDimension::Warehouses,
    QuotaDimension::Staff,
    QuotaDimension::Products,
];

/// Current counts for every assessable dimension, gathered by the caller
/// (see `Store::assess_downgrade` for the live-table gatherer).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct QuotaCounts {
    /// Active location profiles.
    pub locations: i64,
    /// Registered POS terminals.
    pub pos_registers: i64,
    /// Active warehouse inventory locations.
    pub warehouses: i64,
    /// Active staff users (owner excluded).
    pub staff: i64,
    /// Products in the catalog.
    pub products: i64,
}

impl QuotaCounts {
    /// The count for one dimension.
    pub fn get(&self, dimension: QuotaDimension) -> i64 {
        match dimension {
            QuotaDimension::Locations => self.locations,
            QuotaDimension::PosRegisters => self.pos_registers,
            QuotaDimension::Warehouses => self.warehouses,
            QuotaDimension::Staff => self.staff,
            QuotaDimension::Products => self.products,
        }
    }
}

/// One dimension's quota status: its cap, current usage, and derived
/// over-quota / at-cap verdicts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct QuotaUsage {
    /// The dimension this row describes.
    pub dimension: QuotaDimension,
    /// The tier's cap for this dimension, or `None` for unlimited.
    pub limit: Option<i64>,
    /// Current usage count.
    pub current: i64,
}

impl QuotaUsage {
    /// True when usage is strictly above a finite cap — the tenant holds
    /// resources that must be archived or the plan upgraded (§J). An
    /// unlimited tier (`limit == None`) is never over quota.
    pub fn is_over_quota(&self) -> bool {
        matches!(self.limit, Some(limit) if self.current > limit)
    }

    /// True when usage is at or above a finite cap — exactly the
    /// condition the matching `enforce_*_quota` gate uses to reject the
    /// next creation. Includes the strictly-over case.
    pub fn blocks_creation(&self) -> bool {
        matches!(self.limit, Some(limit) if self.current >= limit)
    }

    /// How far past the cap the tenant already is (`current - limit`),
    /// or 0 when not over quota. This is the number of resources the
    /// owner must archive — or the upgrade delta — to return to within
    /// quota.
    pub fn excess(&self) -> i64 {
        match self.limit {
            Some(limit) if self.current > limit => self.current - limit,
            _ => 0,
        }
    }
}

/// The full downgrade assessment for one tier: every dimension's usage
/// plus convenience aggregates for the owner-facing view.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct OverQuotaReport {
    /// Machine tier key (`free` / `plus` / `pro` / `premium` / `enterprise`).
    pub tier_key: String,
    /// Human-readable tier name.
    pub tier_name: String,
    /// Per-dimension usage, in [`DIMENSION_ORDER`].
    pub usages: Vec<QuotaUsage>,
}

impl OverQuotaReport {
    /// The dimensions strictly over quota (need remediation).
    pub fn over_quota_usages(&self) -> impl Iterator<Item = &QuotaUsage> {
        self.usages.iter().filter(|u| u.is_over_quota())
    }

    /// Whether any dimension is strictly over quota.
    pub fn is_over_quota(&self) -> bool {
        self.usages.iter().any(QuotaUsage::is_over_quota)
    }

    /// Total resources across all dimensions that must be archived (or
    /// the upgrade delta) to return fully within quota.
    pub fn total_excess(&self) -> i64 {
        self.usages.iter().map(QuotaUsage::excess).sum()
    }

    /// Look up one dimension's usage row, if present.
    pub fn usage(&self, dimension: QuotaDimension) -> Option<&QuotaUsage> {
        self.usages.iter().find(|u| u.dimension == dimension)
    }
}

/// Assess the current counts against a tier's quotas.
///
/// Pure and DB-free: the caller gathers [`QuotaCounts`] (see
/// `Store::assess_downgrade`). Dimensions are emitted in
/// [`DIMENSION_ORDER`].
#[must_use]
pub fn evaluate(tier: &SubscriptionTier, counts: &QuotaCounts) -> OverQuotaReport {
    let usages = DIMENSION_ORDER
        .iter()
        .map(|&dimension| QuotaUsage {
            dimension,
            limit: dimension.limit_for(tier),
            current: counts.get(dimension),
        })
        .collect();
    OverQuotaReport {
        tier_key: tier.tier_key().to_string(),
        tier_name: tier.name().to_string(),
        usages,
    }
}

#[cfg(test)]
#[path = "downgrade_tests.rs"]
mod tests;
