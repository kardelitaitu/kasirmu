//! Subscription tiers: quotas, capabilities and feature entitlements.
//!
//! Split out of `subscription.rs` on 2026-09-28. `SubscriptionTier` is the one
//! type every entitlement question funnels through — quota limits, workspace-type
//! admission, and the feature flags the shells read — so it is kept with its
//! `impl` block rather than beside the row type that carries a tenant current
//! tier.
//!
//! Invariant: every workspace-type check goes through the
//! [`workspace_type`](crate::workspace_type) consts rather than string
//! literals, so a typo is a compile error and not a silently denied vertical.

use serde::{Deserialize, Serialize};

use crate::workspace_type::{ADMIN, INVENTORY, RESTAURANT_POS, STORE_POS, WAREHOUSE};

/// Subscription tiers with their quotas, capabilities, and feature entitlements.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SubscriptionTier {
    /// Free forever — 3-month sales history, 1 store, 1 register, 1 warehouse, offline-only.
    Free,
    /// 1-Time Perpetual License — 1 store, 1 register, 1 warehouse, offline-first.
    ///
    /// Deprecated: kept only for database back-compat (`from_db("one_time")`).
    /// Do not use for new code — the canonical lineup is Free / Plus / Pro / Premium / Enterprise.
    #[deprecated(
        note = "legacy perpetual license — kept only for database back-compat; do not use for new code"
    )]
    OneTime,
    /// Plus SaaS — 1 store, 2 registers, 2 warehouses, QRIS, cloud sync, Daily Sales Dashboard.
    Plus,
    /// Pro SaaS — 2 stores, 5 registers/store, 3 warehouses, analytics + KDS, Stripe + QRIS.
    Pro,
    /// Premium — 5 stores, unlimited registers/warehouses, loyalty program, Lua engine, priority support.
    Premium,
    /// Enterprise — unlimited stores/registers/warehouses, regional zones, custom ERP adaptors.
    Enterprise,
}

#[allow(deprecated)] // OneTime is intentionally referenced for DB back-compat
impl SubscriptionTier {
    /// Parse from the database TEXT column.
    pub fn from_db(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "free" | "trial" => Self::Free,
            "one_time" | "perpetual" | "one-time" | "onetime" => Self::OneTime,
            "plus" | "standard" => Self::Plus, // "standard" is a legacy alias for Plus
            "pro" => Self::Pro,
            "premium" => Self::Premium,
            "enterprise" => Self::Enterprise,
            _ => Self::Free,
        }
    }

    /// Human-readable tier name.
    pub fn name(&self) -> &'static str {
        match self {
            Self::Free => "Free",
            Self::OneTime => "1-Time Perpetual",
            Self::Plus => "Plus",
            Self::Pro => "Pro",
            Self::Premium => "Premium",
            Self::Enterprise => "Enterprise",
        }
    }

    /// Machine-readable tier key used in the DB and the UI
    /// (`free`, `plus`, `pro`, `premium`, `enterprise`). The deprecated
    /// `OneTime` variant is reported as `free` — its DB rows were always
    /// treated as the free quota tier.
    pub fn tier_key(&self) -> &'static str {
        match self {
            Self::Free | Self::OneTime => "free",
            Self::Plus => "plus",
            Self::Pro => "pro",
            Self::Premium => "premium",
            Self::Enterprise => "enterprise",
        }
    }

    /// Maximum number of locations allowed for this tier.
    /// C4.2: Premium allows up to 5 locations self-serve; more requires
    /// Enterprise contract. Enterprise is unlimited.
    pub fn max_locations(&self) -> Option<i64> {
        match self {
            Self::Free | Self::OneTime | Self::Plus => Some(1),
            Self::Pro => Some(2),
            Self::Premium => Some(5),
            Self::Enterprise => None,
        }
    }

    /// Deprecated compatibility alias, retained through the staged
    /// migration; the last caller is gone — use
    /// [`max_locations`](Self::max_locations).
    #[deprecated(note = "use max_locations")]
    pub fn max_stores(&self) -> Option<i64> {
        self.max_locations()
    }

    /// Maximum POS register instances per location for this tier.
    /// Returns `None` for unlimited (Premium / Enterprise).
    pub fn max_pos_instances(&self) -> Option<i64> {
        match self {
            Self::Free | Self::OneTime => Some(1),
            Self::Plus => Some(2),
            Self::Pro => Some(5),
            Self::Premium | Self::Enterprise => None,
        }
    }

    /// Maximum inventory warehouse storage points allowed for this tier.
    /// Returns `None` for unlimited (Premium / Enterprise).
    pub fn max_warehouses(&self) -> Option<i64> {
        match self {
            Self::Free | Self::OneTime => Some(1),
            Self::Plus => Some(2),
            Self::Pro => Some(3),
            Self::Premium | Self::Enterprise => None,
        }
    }

    /// Maximum staff users allowed for this tier.
    /// Returns `None` for unlimited (Premium / Enterprise).
    /// Enforced pre-launch per subscription-tiers.md §9 item 1.
    pub fn max_staff_users(&self) -> Option<i64> {
        match self {
            Self::Free | Self::OneTime => Some(1),
            Self::Plus => Some(5),
            Self::Pro => Some(20),
            Self::Premium => Some(50),
            Self::Enterprise => None,
        }
    }

    /// Maximum products/menu items allowed for this tier
    /// (subscription-tiers.md §Numeric Limits — published contract,
    /// now enforced). Returns `None` for unlimited (Enterprise).
    pub fn max_products(&self) -> Option<i64> {
        match self {
            Self::Free | Self::OneTime => Some(200),
            Self::Plus => Some(500),
            Self::Pro => Some(1_000),
            Self::Premium => Some(10_000),
            Self::Enterprise => None,
        }
    }

    /// Maximum KDS (kitchen display) screens allowed for this tier
    /// (subscription-tiers.md §Numeric Limits — published contract,
    /// now enforced). Free/Plus cannot run KDS at all (also rejected by
    /// `allows_workspace_type`); Pro is capped at 2; Premium/Enterprise
    /// are unlimited (`None`).
    pub fn max_kds_screens(&self) -> Option<i64> {
        match self {
            Self::Free | Self::OneTime | Self::Plus => Some(0),
            Self::Pro => Some(2),
            Self::Premium | Self::Enterprise => None,
        }
    }

    /// How far back (in days) sales history can be viewed/exported.
    /// Returns `None` for unlimited (Premium/Enterprise). Free/Plus/Pro
    /// have capped history as a tier differentiator.
    pub fn sales_history_days(&self) -> Option<i64> {
        match self {
            Self::Free | Self::OneTime => Some(90),   // 3 months
            Self::Plus => Some(365),                  // 1 year
            Self::Pro => Some(5 * 365),               // 5 years
            Self::Premium | Self::Enterprise => None, // Unlimited
        }
    }

    /// Tier audit-log retention window in days, measured from the event
    /// timestamp (todo-global-saas-2.md §Audit baseline — the adopted
    /// schedule the pricing page publishes).
    ///
    /// `None` means the tier has **no audit-log retention entitlement**:
    /// Free keeps no tenant-facing audit logs, so the retention sweep
    /// purges every row (and the read surface is gated off — see the
    /// audit commands). Paid tiers retain the basic security-event set
    /// for the published window; Enterprise's 3 years is the *default* —
    /// a contracted override ships as a signed custom entitlement, not a
    /// client-side fallback (same ruling as `offline_grace_days`).
    ///
    /// Note the deliberate inversion of `sales_history_days`' `None`
    /// ("unlimited"): here `None` means "nothing retained", because no
    /// tier carries an unlimited audit window.
    #[must_use]
    pub fn audit_retention_days(&self) -> Option<i64> {
        match self {
            Self::Free | Self::OneTime => None, // no retention entitlement
            Self::Plus => Some(90),
            Self::Pro => Some(180),
            Self::Premium => Some(365),      // 1 year
            Self::Enterprise => Some(1_095), // 3 years default
        }
    }

    /// Whether this tier supports PostgreSQL background cloud database sync.
    pub fn supports_cloud_sync(&self) -> bool {
        match self {
            Self::Free | Self::OneTime => false,
            Self::Plus | Self::Pro | Self::Premium | Self::Enterprise => true,
        }
    }

    /// Whether this tier supports dynamic QRIS payment processing (Midtrans).
    pub fn supports_qris(&self) -> bool {
        match self {
            Self::Free | Self::OneTime => false,
            Self::Plus | Self::Pro | Self::Premium | Self::Enterprise => true,
        }
    }

    /// Whether this tier supports Stripe credit/debit card processing.
    pub fn supports_stripe(&self) -> bool {
        match self {
            Self::Free | Self::OneTime | Self::Plus => false,
            Self::Pro | Self::Premium | Self::Enterprise => true,
        }
    }

    /// Whether this tier supports embedded Lua VM rule engine for custom promos.
    pub fn supports_lua_engine(&self) -> bool {
        match self {
            Self::Free | Self::OneTime | Self::Plus | Self::Pro => false,
            Self::Premium | Self::Enterprise => true,
        }
    }

    /// Whether this tier supports multi-warehouse stock deduction fallback wires in Node Topology.
    pub fn supports_multi_warehouse_fallback(&self) -> bool {
        match self {
            Self::Free | Self::OneTime | Self::Plus => false,
            Self::Pro | Self::Premium | Self::Enterprise => true,
        }
    }

    /// Whether this tier supports regional zone containers in Node Topology.
    pub fn supports_regional_zones(&self) -> bool {
        matches!(self, Self::Enterprise)
    }

    /// Whether this tier supports the loyalty program (points & tiers).
    /// Premium/Enterprise only — Pro sees a locked teaser (§3, §6).
    pub fn supports_loyalty(&self) -> bool {
        matches!(self, Self::Premium | Self::Enterprise)
    }

    /// Whether this tier supports reports & analytics (`analytics:view`).
    pub fn supports_analytics(&self) -> bool {
        matches!(self, Self::Pro | Self::Premium | Self::Enterprise)
    }

    /// Whether this tier supports the Daily Sales Dashboard (Laporan Harian) —
    /// the Plus hero feature; Free shows a blurred teaser instead.
    pub fn supports_daily_dashboard(&self) -> bool {
        matches!(
            self,
            Self::Plus | Self::Pro | Self::Premium | Self::Enterprise
        )
    }

    /// Offline grace period in days before POS runtime locks read-only
    /// (subscription-tiers.md §Numeric Limits + todo-global-saas-1.md §B:
    /// Free/OneTime 7, Plus 14, Pro 14, Premium 30, Enterprise 60 — the
    /// same numbers the pricing page publishes). Standard Enterprise uses
    /// 60; a contract requiring a different window ships as a signed
    /// custom override, not a client-side fallback.
    pub fn offline_grace_days(&self) -> i64 {
        match self {
            Self::Free | Self::OneTime => 7,
            Self::Plus | Self::Pro => 14,
            Self::Premium => 30,
            Self::Enterprise => 60,
        }
    }

    /// Check whether this tier allows the given workspace type.
    ///
    /// `type_key` is a workspace vertical ([`crate::workspace_type`]), not a
    /// terminal profile — the two are different axes.
    pub fn allows_workspace_type(&self, type_key: &str) -> bool {
        match self {
            Self::Free | Self::OneTime => {
                matches!(type_key, STORE_POS | RESTAURANT_POS | ADMIN)
            }
            // Plus unlocks inventory/warehouse but NOT kds (§3 Workspace Types).
            Self::Plus => matches!(
                type_key,
                STORE_POS | RESTAURANT_POS | ADMIN | WAREHOUSE | INVENTORY
            ),
            // Pro and above unlock every workspace type, including KDS.
            Self::Pro | Self::Premium | Self::Enterprise => true,
        }
    }
}
