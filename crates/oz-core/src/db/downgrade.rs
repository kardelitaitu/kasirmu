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
use crate::downgrade::{
    OverQuotaMarker, OverQuotaReport, OverQuotaSeverity, QuotaCounts, evaluate,
};
use crate::error::CoreError;
use crate::subscription::{SubscriptionTier, TenantSubscription};

use chrono::Utc;

/// The single-tenant id used throughout the local SQLite store. Mirrors the
/// `"default"` literal the quota gates and `get_over_quota_report` already
/// pass to `TenantSubscription::load`.
const TENANT_ID: &str = "default";

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

    /// Persist the current over-quota markers for the tenant (§J remediation).
    ///
    /// Full refresh inside a single transaction: delete every existing marker
    /// for the tenant, then insert one row per dimension that is `over`
    /// (`current > limit`) or `at` (`current == limit`) the cap. Dimensions in
    /// no danger get no row, so an absent marker means "fine". A marker that
    /// lies is worse than no marker, which is why the refresh is recomputed
    /// from the live counts on every call rather than incrementally patched.
    ///
    /// The effective tier is computed internally
    /// (`TenantSubscription::load` + `effective_tier`, fail-closed to `Free`),
    /// so this can be called from any create/archive/delete path without the
    /// caller threading a tier through. Runs in a savepoint so it nests safely
    /// inside an outer creation transaction. Returns the markers written so the
    /// `get_over_quota_report` read path can attach them to the report in one
    /// round-trip.
    pub fn persist_over_quota_markers(&self) -> Result<Vec<OverQuotaMarker>, CoreError> {
        let tier = match TenantSubscription::load(self.conn, TENANT_ID)? {
            Some(sub) => sub.effective_tier(),
            None => SubscriptionTier::Free,
        };
        let report = self.assess_downgrade(&tier)?;

        let now = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

        self.conn
            .execute_batch("SAVEPOINT over_quota_markers_refresh")?;
        let result: Result<Vec<OverQuotaMarker>, CoreError> =
            (|| -> Result<Vec<OverQuotaMarker>, CoreError> {
                self.conn.execute(
                    "DELETE FROM over_quota_markers WHERE tenant_id = ?1",
                    [TENANT_ID],
                )?;

                let mut markers = Vec::with_capacity(report.usages.len());
                for usage in &report.usages {
                    let (severity, severity_str) = if usage.is_over_quota() {
                        (OverQuotaSeverity::Over, "over")
                    } else if usage.blocks_creation() {
                        (OverQuotaSeverity::At, "at")
                    } else {
                        continue;
                    };
                    let dimension = usage.dimension.as_str();
                    self.conn.execute(
                "INSERT INTO over_quota_markers \
                 (resource_id, resource_type, dimension, severity, \"limit\", current, marked_at, tenant_id) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                rusqlite::params![
                    TENANT_ID,
                    dimension,
                    dimension,
                    severity_str,
                    usage.limit,
                    usage.current,
                    now,
                    TENANT_ID,
                ],
            )?;
                    markers.push(OverQuotaMarker {
                        resource_id: TENANT_ID.to_string(),
                        resource_type: dimension.to_string(),
                        dimension: usage.dimension,
                        severity,
                        limit: usage.limit,
                        current: usage.current,
                        marked_at: now.clone(),
                    });
                }
                Ok(markers)
            })();
        match result {
            Ok(markers) => {
                self.conn
                    .execute_batch("RELEASE over_quota_markers_refresh")?;
                Ok(markers)
            }
            Err(e) => {
                let _ = self
                    .conn
                    .execute_batch("ROLLBACK TO over_quota_markers_refresh");
                let _ = self
                    .conn
                    .execute_batch("RELEASE over_quota_markers_refresh");
                Err(e)
            }
        }
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
