//! Entitlements read model (todo-global-saas-2.md, "Entitlement
//! enforcement consolidation" Phase A).
//!
//! One struct that assembles the session's entitlement facts ONCE, so the
//! capabilities projection and the feature verdict gather from the same
//! instance instead of re-deriving each axis independently. This closes
//! the drift the design measured: tier limits were resolved in three
//! independent places and the caps DTO was assembled four times per
//! client, each copy free to drift from the others.
//!
//! Key types:
//! - [`Entitlements`] — the read model, built from the signed
//!   `TenantSubscription` row plus the usage counts the gates consult.
//! - [`build_entitlements`] — the shared fail-closed row loader (missing /
//!   tampered / unreadable yields `None`, which projects as Free +
//!   `unavailable` rather than an error).
//!
//! Invariants (tested in `entitlements_tests.rs`):
//! - **fail-closed identity**: an unreadable row projects exactly the
//!   Free + `unavailable` shape the caps commands have always produced.
//! - **limit identity**: every limit the caps DTO carries equals
//!   `QuotaDimension::limit_for` for the matching dimension — Phase B's
//!   one-limit-table contract, pinned from the read-model side.
//! - **usage identity**: the counts fed in are the counts projected out.

use crate::availability::{AvailabilityFacts, AvailabilityFeature, UsageCounts};
use crate::downgrade::QuotaDimension;
use crate::subscription::{SubscriptionLifecycleState, SubscriptionTier, TenantSubscription};

/// The tenant's assembled entitlement facts (Phase A read model).
///
/// Built once per read from the local signed subscription row and the
/// usage counts; consumed by projections, never mutated after the
/// client's tier policy (the desktop dev upgrade) is applied. `tier` is
/// the grace-aware effective tier — Free when the row is unreadable, so
/// every consumer fails closed without knowing the loader's failure modes.
#[derive(Debug, Clone)]
pub struct Entitlements {
    /// Grace-aware effective tier (the quota answer, never `None`).
    pub tier: SubscriptionTier,
    /// §B lifecycle state of the source row.
    pub state: SubscriptionLifecycleState,
    /// Whether a validly-signed row was loaded. `false` means the
    /// fail-closed projection: Free entitlements on the `unavailable`
    /// state; add-ons and server grants are empty/silent.
    pub loaded: bool,
    /// Add-on identifiers from the signed payload (empty when fail-closed).
    pub addons: Vec<String>,
    /// Phase C: whether the signed payload marks this period as a trial.
    ///
    /// Carried alongside `tier` rather than folded into it — the tier stays
    /// the quota answer (a trial resolves to Free), and this is the fact
    /// that used to be lost by that collapse. `false` when fail-closed: an
    /// unreadable row is never reported as a trial.
    pub is_trial: bool,
    /// When the trial ends, RFC3339, from the signed payload; `None` when
    /// this is not a trial or the date is absent/unparseable.
    pub trial_ends_at: Option<String>,
    /// Current usage counts (the same `count_*` the gates consult).
    pub usage: UsageCounts,
}

impl Entitlements {
    /// Build from a loaded (verified) subscription row and usage counts.
    #[must_use]
    pub fn from_subscription(sub: &TenantSubscription, usage: UsageCounts) -> Self {
        Self {
            tier: sub.effective_tier(),
            state: sub.lifecycle_state(),
            loaded: true,
            addons: sub.addons(),
            is_trial: sub.is_trial(),
            trial_ends_at: sub.trial_ends_at(),
            usage,
        }
    }

    /// The fail-closed shape: Free entitlements on `unavailable`.
    ///
    /// Mirrors `load_capabilities`' contract exactly — the UI's error
    /// path renders gates open, so a missing/tampered row must project a
    /// payload that locks every gate instead of surfacing an error.
    #[must_use]
    pub fn fail_closed(usage: UsageCounts) -> Self {
        Self {
            tier: SubscriptionTier::Free,
            state: SubscriptionLifecycleState::Unavailable,
            loaded: false,
            addons: Vec::new(),
            is_trial: false,
            trial_ends_at: None,
            usage,
        }
    }

    /// The desktop dev Free→Premium upgrade as a named decision: only a
    /// genuinely `active` Free row is promoted, so expired/canceled/
    /// paused/unavailable paths stay exercisable in dev. Tablet never
    /// calls this — the per-client divergence the consolidation design
    /// preserves deliberately (and the pre-existing tablet caps gap its
    /// owner may close separately).
    pub fn apply_debug_upgrade(&mut self) {
        if cfg!(debug_assertions)
            && self.state == SubscriptionLifecycleState::Active
            && self.tier == SubscriptionTier::Free
        {
            self.tier = SubscriptionTier::Premium;
        }
    }

    /// Whether the add-on analytics grant can flow (C4.3): the
    /// subscription must be active or in grace — canceled/expired rows
    /// keep the downgraded answer.
    #[must_use]
    pub fn addon_grant_flows(&self) -> bool {
        matches!(
            self.state,
            SubscriptionLifecycleState::Active | SubscriptionLifecycleState::Grace
        )
    }

    /// Project the caps DTO's location cap from this instance through
    /// `QuotaDimension::limit_for` — Phase B's one limit table — so a
    /// tier-limit change surfaces identically here, in a gate rejection,
    /// and in a verdict.
    #[must_use]
    pub fn max_locations(&self) -> Option<i64> {
        QuotaDimension::Locations.limit_for(&self.tier)
    }

    /// POS register cap (see [`Self::max_locations`]).
    #[must_use]
    pub fn max_pos_instances(&self) -> Option<i64> {
        QuotaDimension::PosRegisters.limit_for(&self.tier)
    }

    /// Warehouse stock-point cap (see [`Self::max_locations`]).
    #[must_use]
    pub fn max_warehouses(&self) -> Option<i64> {
        QuotaDimension::Warehouses.limit_for(&self.tier)
    }

    /// Staff-user cap (see [`Self::max_locations`]).
    #[must_use]
    pub fn max_staff_users(&self) -> Option<i64> {
        QuotaDimension::Staff.limit_for(&self.tier)
    }

    /// Product-menu cap (see [`Self::max_locations`]).
    ///
    /// Every tenant-global door now asks THIS object for its tier, the
    /// product door included: `commands/products.rs` in both clients passes
    /// `Entitlements::from_subscription(&sub, UsageCounts::default()).tier`
    /// into `Store::enforce_product_quota`, which reads the same
    /// `QuotaDimension::Products` row of this one limit table. This accessor
    /// keeps the parity matrix complete — it is the number the gate applies,
    /// spelled as a capability.
    #[must_use]
    pub fn max_products(&self) -> Option<i64> {
        QuotaDimension::Products.limit_for(&self.tier)
    }

    /// Per-location KDS screen cap (see [`Self::max_locations`]).
    ///
    /// Goes through the same one limit table as every other cap, even though
    /// `KdsScreens` is deliberately absent from `DIMENSION_ORDER`: it is a
    /// per-location ceiling, so it belongs in a caps projection and in
    /// per-location marker rows, but never in a tenant-global usage row.
    /// Free/OneTime/Plus are `Some(0)` (KDS unavailable at all), Pro `Some(2)`,
    /// Premium/Enterprise `None`.
    #[must_use]
    pub fn max_kds_screens(&self) -> Option<i64> {
        QuotaDimension::KdsScreens.limit_for(&self.tier)
    }

    /// Sales-history retention in days (a policy axis, not a count quota —
    /// reads the tier directly).
    #[must_use]
    pub fn sales_history_days(&self) -> Option<i64> {
        self.tier.sales_history_days()
    }

    /// Tier audit-log retention window in days, measured from the event
    /// timestamp (`None` = no retention entitlement — Free keeps no
    /// tenant-facing audit logs and the sweep purges). Reads the tier
    /// directly like `sales_history_days`; the same instance the caps
    /// projection and the audit commands consult, so a schedule change
    /// cannot drift between the sweep and any UI that displays it.
    #[must_use]
    pub fn audit_retention_days(&self) -> Option<i64> {
        self.tier.audit_retention_days()
    }

    /// The tier's offline grace window in days.
    #[must_use]
    pub fn offline_grace_days(&self) -> i64 {
        self.tier.offline_grace_days()
    }

    /// Whether the tier processes QRIS payments.
    #[must_use]
    pub fn supports_qris(&self) -> bool {
        self.tier.supports_qris()
    }

    /// Whether analytics is available: the tier's static answer plus the
    /// add-on grant (`advanced_analytics`) while it can flow.
    #[must_use]
    pub fn supports_analytics(&self) -> bool {
        self.tier.supports_analytics()
            || (self.addon_grant_flows() && self.addons.iter().any(|a| a == "advanced_analytics"))
    }

    /// Whether the tier runs the loyalty program.
    #[must_use]
    pub fn supports_loyalty(&self) -> bool {
        self.tier.supports_loyalty()
    }

    /// Whether the tier has the Daily Sales Dashboard.
    #[must_use]
    pub fn supports_daily_dashboard(&self) -> bool {
        self.tier.supports_daily_dashboard()
    }

    /// Whether the tier has cloud DB sync.
    #[must_use]
    pub fn supports_cloud_sync(&self) -> bool {
        self.tier.supports_cloud_sync()
    }

    /// Assemble the resolver's `AvailabilityFacts` from this instance.
    ///
    /// The caller supplies the axes only it knows — role, scope, the
    /// per-feature server grant, and the expiry echoes — while the tier,
    /// state, and usage come from here. A verdict built through this
    /// constructor and a caps payload projected from the same instance
    /// cannot disagree: the tier limits inside the verdict's detail read
    /// `QuotaDimension::limit_for` on the same tier this instance
    /// carries.
    #[must_use]
    #[allow(clippy::too_many_arguments)]
    pub fn availability_facts<'a>(
        &'a self,
        feature: AvailabilityFeature,
        role_granted: bool,
        scope_granted: Option<bool>,
        permission: Option<&'a str>,
        server_grant: Option<bool>,
        expires_at: Option<&'a str>,
        grace_until: Option<&'a str>,
    ) -> AvailabilityFacts<'a> {
        AvailabilityFacts {
            feature,
            tier: &self.tier,
            // `SubscriptionLifecycleState` is not Copy; the facts own
            // their state by value, so clone the read model's answer.
            state: self.state.clone(),
            usage: self.usage,
            server_grant,
            role_granted,
            scope_granted,
            permission,
            expires_at,
            grace_until,
        }
    }
}

/// The row-loading surface for [`build_entitlements`], so the helper
/// stays decoupled from any particular connection wrapper (unit tests
/// implement it over a bare connection).
pub trait SubscriptionLoader {
    /// Load + signature-verify the tenant's subscription row; `None`
    /// for missing/tampered/unreadable (the caller fails closed).
    fn load_verified_subscription(&self) -> Option<TenantSubscription>;
}

impl SubscriptionLoader for crate::db::Store<'_> {
    fn load_verified_subscription(&self) -> Option<TenantSubscription> {
        match TenantSubscription::load(self.conn, "default") {
            Ok(Some(sub)) => match sub.verify_signature() {
                Ok(()) => Some(sub),
                Err(e) => {
                    tracing::warn!(
                        "subscription signature verification failed — failing closed: {e}"
                    );
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
        }
    }
}

/// Load the row fail-closed and assemble the read model.
///
/// Missing/tampered/unreadable yields [`Entitlements::fail_closed`] —
/// never an error — because the UI's error path renders gates open.
///
/// `debug_upgrade` is the desktop dev Free→Premium upgrade as a named
/// decision: only a genuinely `active` Free row is promoted, so
/// expired/canceled/paused/unavailable paths stay exercisable in dev.
/// Tablet passes `false` — the per-client divergence the design
/// preserves deliberately (and the pre-existing tablet gap its caps
/// owner may close separately).
#[must_use]
pub fn build_entitlements<S: SubscriptionLoader + ?Sized>(
    loader: &S,
    usage: UsageCounts,
    debug_upgrade: bool,
) -> Entitlements {
    let Some(sub) = loader.load_verified_subscription() else {
        return Entitlements::fail_closed(usage);
    };
    let mut ent = Entitlements::from_subscription(&sub, usage);
    if debug_upgrade {
        ent.apply_debug_upgrade();
    }
    ent
}

#[cfg(test)]
#[path = "entitlements_tests.rs"]
mod tests;
