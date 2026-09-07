//! `Store` gatherer for the tenant-level downgrade assessment.
//!
//! The decision itself is pure and lives in [`crate::downgrade`]; this
//! file's only job is to read the live per-dimension counts using the
//! SAME `count_*` methods the creation-time `enforce_*_quota` gates use,
//! so a dimension reported over quota here is exactly one whose next
//! creation the gate would reject. Keeping the count source identical to
//! the gate is the point — it stops the assessment and the enforcement
//! from drifting apart.
//!
//! Read-only: the queries run directly on the connection, no transaction
//! (RUST-08 read rule).

use super::Store;
use crate::downgrade::{OverQuotaReport, QuotaCounts, evaluate};
use crate::error::CoreError;
use crate::subscription::SubscriptionTier;

impl Store<'_> {
    /// Assess which tenant-level resources exceed `tier`'s quotas.
    ///
    /// Pass the *effective* (post-change) tier — the tier a tenant is
    /// being downgraded to, or `Free` when a paid subscription has
    /// lapsed — obtained the same way the creation gates get it
    /// (`Subscription::effective_tier()`). The returned
    /// [`OverQuotaReport`] is the detection layer an owner-facing
    /// "archive or upgrade" view renders; it mutates nothing.
    pub fn assess_downgrade(&self, tier: &SubscriptionTier) -> Result<OverQuotaReport, CoreError> {
        let counts = QuotaCounts {
            locations: self.count_locations()?,
            pos_registers: self.count_terminals()?,
            warehouses: self.count_warehouse_locations()?,
            staff: self.count_staff_users()?,
            products: self.count_products()?,
        };
        Ok(evaluate(tier, &counts))
    }

    /// Count all products in the catalog.
    ///
    /// Mirrors the inline count in [`Store::enforce_product_quota`] so
    /// the assessment and the creation gate agree on what consumes the
    /// product quota. (Extracting the shared count out of
    /// `enforce_product_quota` is a possible follow-up; kept local here
    /// to avoid editing the concurrent-agent hot file.)
    pub fn count_products(&self) -> Result<i64, CoreError> {
        let count: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM products", [], |r| r.get(0))?;
        Ok(count)
    }
}

#[cfg(test)]
#[path = "downgrade_tests.rs"]
mod tests;
