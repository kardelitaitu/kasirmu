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
    OverQuotaMarker, OverQuotaReport, OverQuotaSeverity, QuotaCounts, QuotaDimension, evaluate,
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
        // MSL-38: the LEDGER-aware reader, so this agrees with the gates that
        // call it. It previously used `effective_tier()` (the wall clock) while
        // the creation gates had moved to ledger time (MSL-36), which let a
        // refusal and the marker refresh two lines later be computed against
        // two different tiers. The doc above already promised the contract —
        // "obtained the same way the creation gates get it" — this makes it true.
        let tier = match TenantSubscription::load(self.conn, TENANT_ID)? {
            Some(sub) => sub.effective_tier_for_connection(self.conn),
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
                    // A dimension the tier does not include at all (a zero cap
                    // with nothing in it) is not an "at the cap" row: there is
                    // nothing to archive. Without this skip every Free/Plus/Pro
                    // tenant would carry a permanent `warehouses 0/0` marker.
                    if usage.is_unincluded_dimension() {
                        continue;
                    }
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

    /// Read this tenant's persisted markers back from `over_quota_markers`.
    ///
    /// [`Store::persist_over_quota_markers`] already RETURNS the rows it just wrote,
    /// so `get_over_quota_report` never needed this — it takes the in-memory
    /// return. What the table was for, per its own migration doc, is *other*
    /// surfaces reading "is this resource over quota" without recomputing; this is
    /// the read half of that promise. Until now the table had a writer, an index
    /// and three tests, and no production reader at all.
    ///
    /// Rows whose `dimension` key this build does not recognise are SKIPPED, not
    /// coerced: the column carries no CHECK constraint, so a row written by a newer
    /// build or by hand must not be reinterpreted under a different dimension's
    /// limits. The skip is counted and logged rather than swallowed because a
    /// silently shrinking marker list is how an unreadable row becomes an invisible
    /// one. A marker that lies is worse than no marker.
    ///
    /// Read-only: no transaction (RUST-08 read rule, matching `assess_downgrade`).
    pub fn over_quota_markers(&self) -> Result<Vec<OverQuotaMarker>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT resource_id, resource_type, dimension, severity, \"limit\", current, marked_at \
             FROM over_quota_markers WHERE tenant_id = ?1 \
             ORDER BY dimension, resource_type, resource_id",
        )?;
        let rows = stmt.query_map(rusqlite::params![TENANT_ID], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<i64>>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, String>(6)?,
            ))
        })?;
        let mut markers = Vec::new();
        let mut skipped = 0_i64;
        for row in rows {
            let (resource_id, resource_type, dim_key, severity_key, limit, current, marked_at) =
                row?;
            let Some(dimension) = QuotaDimension::from_key(&dim_key) else {
                skipped += 1;
                continue;
            };
            let severity = match severity_key.as_str() {
                "over" => OverQuotaSeverity::Over,
                "at" => OverQuotaSeverity::At,
                // Unreachable through this build's writer (the CHECK constraint
                // allows only these two), so an unexpected value means the row did
                // not come from here and must not be rendered as if it had.
                _ => {
                    skipped += 1;
                    continue;
                }
            };
            markers.push(OverQuotaMarker {
                resource_id,
                resource_type,
                dimension,
                severity,
                limit,
                current,
                marked_at,
            });
        }
        if skipped > 0 {
            tracing::warn!(
                skipped = %skipped,
                returned = %markers.len(),
                "over_quota_markers: rows skipped for an unknown dimension or severity key"
            );
        }
        Ok(markers)
    }

    /// Count all products in the catalog.
    ///
    /// THE shared products count, not a mirror. The over-quota assessment
    /// ([`Store::assess_downgrade`]) and the creation gate
    /// (`quota_gate::quota_count`, whose `Products` arm calls this) both read it,
    /// so the two cannot disagree about what consumes the product quota.
    ///
    /// This doc used to say the count was inline in
    /// [`Store::enforce_product_quota`] and that extracting it was a follow-up.
    /// That extraction has since happened: `enforce_product_quota` now delegates
    /// to `enforce_creation_quota`, which counts through `count_products`.
    ///
    /// One other products count exists on purpose and is NOT a duplicate:
    /// `create_product_with_attributes` counts inside its own transaction, after
    /// the insert, because under WAL a pre-transaction count reads only its
    /// snapshot — the doc there explains that this is what closes the TOCTOU the
    /// pre-transaction gate cannot.
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
