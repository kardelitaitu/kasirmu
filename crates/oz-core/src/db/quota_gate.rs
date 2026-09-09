//! Central creation-quota gate (W4-S1 — T1's adopted equivalence design).
//!
//! Every dimension previously enforced its own copy of the same three-line
//! decision (limit_for -> count -> QuotaError variant) plus the marker
//! warm-call. This module is the single decision point the six gates now
//! delegate to:
//!
//! * [`Store::enforce_creation_quota`] — the classic single-creation gate
//!   (reject when `current >= limit`), the exact legacy predicate.
//! * [`Store::ensure_quota_allows`] — the batch-aware variant
//!   (`additional` = rows the caller is about to insert), so a batch
//!   import rejects BEFORE doing the work instead of failing midway.
//!
//! Equivalence contract: the ~40 existing per-gate tests pass unmodified.
//! `current + 1 > limit` is the same predicate as `current >= limit`; each
//! per-dimension count and each [`QuotaError`] variant is the one its
//! legacy gate consulted, so the only observable change is centralized
//! duplication.
//!
//! # Two standing rulings encoded here
//!
//! * **Missing subscription row fails CLOSED to Free** (the
//!   `Entitlements::fail_closed` precedent) — use
//!   [`Store::resolve_tier_fail_closed`] instead of erroring `Internal` or
//!   silently proceeding; see S3 for consolidating the remaining divergent
//!   call sites.
//! * **KDS screens never route through this gate.**
//!   [`crate::downgrade::QuotaDimension::KdsScreens`] has no tenant-global
//!   count ([`crate::downgrade::QuotaCounts::get`] answers 0 for it), and a
//!   generic loop would therefore silently report KDS as allowed
//!   everywhere. The per-location KDS cap keeps its bespoke logic in
//!   `enforce_instance_quota`; asking this gate for KDS is an `Internal`
//!   error, not a wrong answer.

use crate::downgrade::QuotaDimension;
use crate::error::CoreError;
use crate::subscription::{QuotaError, SubscriptionTier, TenantSubscription};

use super::Store;

/// The tenant id the single-tenant store schema stamps (mirrors the
/// migration DEFAULT and the module-private constant in `db::downgrade`).
const TENANT_ID: &str = "default";

impl Store<'_> {
    /// Resolve the tenant's effective tier, failing CLOSED to
    /// [`SubscriptionTier::Free`] when no subscription row exists.
    ///
    /// Standardizes the two previous divergent behaviors (an `Internal`
    /// error at one call site vs. a silent `Free` at another) on the
    /// `Entitlements::fail_closed` precedent: an unprovisioned tenant gets
    /// the most restrictive tier, never a crash and never a free pass.
    pub fn resolve_tier_fail_closed(&self) -> Result<SubscriptionTier, CoreError> {
        Ok(match TenantSubscription::load(self.conn, TENANT_ID)? {
            Some(sub) => sub.effective_tier(),
            None => SubscriptionTier::Free,
        })
    }

    /// The live count the legacy gate for `dimension` consulted. One arm
    /// per tenant-global dimension; KDS is refused (see the module doc).
    fn quota_count(&self, dimension: QuotaDimension) -> Result<i64, CoreError> {
        match dimension {
            QuotaDimension::Locations => self.count_locations(),
            QuotaDimension::PosRegisters => self.count_terminals(),
            QuotaDimension::Warehouses => self.count_warehouse_locations(),
            QuotaDimension::Staff => self.count_staff_users(),
            QuotaDimension::Products => self.count_products(),
            // T1 risk 4: a generic loop would read QuotaCounts' 0 for KDS
            // and silently allow every KDS creation. The per-location cap
            // stays in `enforce_instance_quota`; reaching the central gate
            // with KDS is a programming error, made loud instead of wrong.
            QuotaDimension::KdsScreens => Err(CoreError::Internal(
                "quota_gate: KdsScreens is a per-location dimension; use enforce_instance_quota"
                    .into(),
            )),
        }
    }

    /// The [`QuotaError`] variant the legacy gate for `dimension` returned.
    fn quota_limit_error(
        dimension: QuotaDimension,
        tier: &SubscriptionTier,
        limit: i64,
        current: i64,
    ) -> QuotaError {
        match dimension {
            QuotaDimension::Locations => QuotaError::StoreLimit {
                tier: tier.name().into(),
                limit,
                current,
            },
            QuotaDimension::PosRegisters => QuotaError::RegisterLimit {
                tier: tier.name().into(),
                limit,
                current,
            },
            QuotaDimension::Warehouses => QuotaError::WarehouseLimit {
                tier: tier.name().into(),
                limit,
                current,
            },
            QuotaDimension::Staff => QuotaError::StaffLimit {
                tier: tier.name().into(),
                limit,
                current,
            },
            QuotaDimension::Products => QuotaError::ProductLimit {
                tier: tier.name().into(),
                limit,
                current,
            },
            // Unreachable: quota_count refuses KdsScreens before any limit
            // is consulted, so no cap can ever be exceeded for it here.
            QuotaDimension::KdsScreens => QuotaError::StoreLimit {
                tier: tier.name().into(),
                limit,
                current,
            },
        }
    }

    /// The batch-aware creation gate: allow adding `additional` rows of
    /// `dimension` on `tier`.
    ///
    /// Unlimited tiers (`limit == None`) pass. Rejects with the
    /// dimension's legacy [`QuotaError`] variant when `current + additional`
    /// would exceed the cap; the error reports the CURRENT count (the
    /// caller's batch has not happened yet). On a pass, warms the marker
    /// table — one central call site replacing the six former per-gate
    /// warm-calls.
    pub fn ensure_quota_allows(
        &self,
        dimension: QuotaDimension,
        tier: &SubscriptionTier,
        additional: i64,
    ) -> Result<(), CoreError> {
        if let Some(limit) = dimension.limit_for(tier) {
            let current = self.quota_count(dimension)?;
            if current + additional > limit {
                return Err(Self::quota_limit_error(dimension, tier, limit, current).into());
            }
        }
        // Keep the over-quota marker table in step with every creation
        // attempt (Slice C §J): the next read refreshes too, but this warms
        // the cache.
        self.persist_over_quota_markers()?;
        Ok(())
    }

    /// The single-creation form of [`Store::ensure_quota_allows`]: reject
    /// when the dimension is already at or over the tier's cap. This is
    /// the exact legacy predicate (`current >= limit`) every per-gate test
    /// was written against.
    pub fn enforce_creation_quota(
        &self,
        dimension: QuotaDimension,
        tier: &SubscriptionTier,
    ) -> Result<(), CoreError> {
        self.ensure_quota_allows(dimension, tier, 1)
    }
}

// -- Tests --------------------------------------------------------------

#[cfg(test)]
#[path = "quota_gate_tests.rs"]
mod tests;
