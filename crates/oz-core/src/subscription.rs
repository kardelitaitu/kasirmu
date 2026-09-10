//! Subscription tier definitions, signature verification, quota
//! enforcement, clock rollback detection, and offline grace period
//! for ADR #5 (Subscription Tier & Entitlement Architecture).
/*
last audited 25-07-26 by RSA-Agent (oz-core slice C5: subscription deep read)
crate: oz-core | status: SAFE | lint: CLEAN
findings: exemplary — RSA verification delegated to license_verification; 30s clock-skew tolerance (tightened from M1 audit finding, documented); ledger-based rollback detection (MAX over sales+audit_log); canceled never in grace, entitlement reverts to Free out-of-grace; from_db unknown -> Free (fail-closed for entitlements); typed QuotaError with actionable upgrade messaging; signature field verified before use by callers
next: none | perf: N/A
*/
//!
//! The `tenant_subscription` table lives in the global database. This
//! module provides the Rust types and logic for reading that table,
//! verifying its cryptographic signature, and enforcing tier limits
//! when creating stores and workspace instances.

use rusqlite::params;
use serde::{Deserialize, Serialize};

use crate::error::CoreError;

/// Maximum clock skew tolerance before detecting tampering (30 seconds).
///
/// Tightened from the previous 5-minute window (M1 audit finding) to
/// catch clock-rollback bypass attempts sooner. 30s is the smallest
/// value that still absorbs typical RTC drift on consumer hardware
/// without producing false positives on slow or paused devices.
const CLOCK_SKEW_TOLERANCE_SECONDS: i64 = 30;

// ── Instance Status ─────────────────────────────────────────────────

/// Three-state status for workspace instances, replacing the old
/// `is_active` boolean (ADR #4).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InstanceStatus {
    /// Normal operating register — fully functional.
    Active,
    /// Suspended automatically by subscription downgrade or offline
    /// grace expiration. Historical data preserved; register cannot
    /// accept new sales until restored.
    QuotaSuspended,
    /// Manually deleted/deactivated by an admin.
    Archived,
}

impl InstanceStatus {
    /// Parse from the database TEXT column.
    pub fn from_db(s: &str) -> Self {
        match s {
            "active" => Self::Active,
            "quota_suspended" => Self::QuotaSuspended,
            "archived" => Self::Archived,
            _ => Self::Active, // Default for unknown values
        }
    }

    /// Return the database representation.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::QuotaSuspended => "quota_suspended",
            Self::Archived => "archived",
        }
    }
}

// ── Subscription Tier ────────────────────────────────────────────────

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
    pub fn allows_workspace_type(&self, type_key: &str) -> bool {
        match self {
            Self::Free | Self::OneTime => {
                matches!(type_key, "store-pos" | "restaurant-pos" | "admin")
            }
            // Plus unlocks inventory/warehouse but NOT kds (§3 Workspace Types).
            Self::Plus => matches!(
                type_key,
                "store-pos" | "restaurant-pos" | "admin" | "warehouse" | "inventory"
            ),
            // Pro and above unlock every workspace type, including KDS.
            Self::Pro | Self::Premium | Self::Enterprise => true,
        }
    }
}

// ── Subscription Row ──────────────────────────────────────────────────

/// A row from the `tenant_subscription` table.
#[derive(Debug, Clone)]
pub struct TenantSubscription {
    /// The unique identifier of the tenant.
    pub tenant_id: String,
    /// The subscription tier (Free, Plus, Pro, Premium, Enterprise).
    pub tier: SubscriptionTier,
    /// The subscription status (e.g. "active", "canceled").
    pub status: String,
    /// The optional expiration timestamp in RFC 3339 format.
    pub expires_at: Option<String>,
    /// The maximum number of locations allowed for this tenant. Rust field
    /// aligned with the `max_locations` column (renamed from `max_stores`
    /// by migration 20260906); the SIGNED payload keeps its own wire names.
    pub max_locations: i64,
    /// The maximum number of POS instances allowed for this tenant.
    pub max_pos_instances: i64,
    /// A JSON string listing the workspace types allowed on this tier.
    pub allowed_types_json: String,
    /// The cryptographic signature verifying the subscription.
    pub signature: String,
    /// The signed subscription payload from the license server (JSON).
    pub signed_payload: String,
    /// The API key for subsequent renew/status calls.
    pub api_key: String,
    /// The timestamp of the last update in RFC 3339 format.
    pub updated_at: String,
}

impl TenantSubscription {
    /// Load the subscription for a tenant from the global database.
    pub fn load(conn: &rusqlite::Connection, tenant_id: &str) -> Result<Option<Self>, CoreError> {
        let mut stmt = conn.prepare(
            "SELECT tenant_id, tier_key, status, expires_at, max_locations,
                    max_pos_instances, allowed_types_json, signature, signed_payload,
                    api_key, updated_at
             FROM tenant_subscription
             WHERE tenant_id = ?1",
        )?;

        let result = stmt.query_row(params![tenant_id], |row| {
            Ok(TenantSubscription {
                tenant_id: row.get(0)?,
                tier: SubscriptionTier::from_db(&row.get::<_, String>(1)?),
                status: row.get(2)?,
                expires_at: row.get(3)?,
                max_locations: row.get(4)?,
                max_pos_instances: row.get(5)?,
                allowed_types_json: row.get(6)?,
                signature: row.get(7)?,
                signed_payload: row.get::<_, Option<String>>(8)?.unwrap_or_default(),
                api_key: row.get::<_, Option<String>>(9)?.unwrap_or_default(),
                updated_at: row.get(10)?,
            })
        });

        match result {
            Ok(sub) => Ok(Some(sub)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(CoreError::from(e)),
        }
    }

    /// Verify the subscription signature using RSA-2048 PKCS1v15.
    ///
    /// During local development / single-store deployments, the bootstrap
    /// signature `BOOTSTRAP_FREE` is accepted. In production, the signature
    /// must be validated against the embedded RSA public key.
    pub fn verify_signature(&self) -> Result<(), CoreError> {
        crate::license_verification::verify_license_signature(&self.signed_payload, &self.signature)
    }

    /// Compute the maximum ledger timestamp across all domain tables
    /// in the given database connection.
    ///
    /// Queries `MAX(created_at)` from the `sales` and `audit_log` tables.
    /// The effective time is the maximum of these values (or `Utc::now()`
    /// if all tables are empty). This prevents users from rolling back
    /// their OS clock to bypass subscription expiration.
    ///
    /// In multi-store mode (Phase 2), this would iterate all store
    /// databases and return the global maximum.
    pub fn compute_max_ledger_timestamp(conn: &rusqlite::Connection) -> Result<String, CoreError> {
        // Get the most recent timestamp from sales.
        let max_sales: Option<String> = conn
            .query_row("SELECT MAX(created_at) FROM sales", [], |row| row.get(0))
            .unwrap_or(None);

        // Get the most recent timestamp from audit_log.
        let max_audit: Option<String> = conn
            .query_row("SELECT MAX(created_at) FROM audit_log", [], |row| {
                row.get(0)
            })
            .unwrap_or(None);

        // Pick the maximum of the two ledger timestamps.
        let ledger_max = match (max_sales, max_audit) {
            (Some(a), Some(b)) => {
                if a > b {
                    a
                } else {
                    b
                }
            }
            (Some(v), None) | (None, Some(v)) => v,
            (None, None) => {
                // No ledger data — use current time.
                return Ok(chrono::Utc::now().to_rfc3339());
            }
        };

        Ok(ledger_max)
    }

    /// Validate that the system clock has not been rolled back.
    ///
    /// Compares the maximum ledger timestamp against `Utc::now()`.
    /// If the ledger has timestamps more than `CLOCK_SKEW_TOLERANCE`
    /// in the future relative to the wall clock, the system detects
    /// clock tampering and returns `CoreError::SystemClockTampered`.
    pub fn validate_clock_rollback(conn: &rusqlite::Connection) -> Result<(), CoreError> {
        let ledger_ts = Self::compute_max_ledger_timestamp(conn)?;
        let ledger_dt = chrono::DateTime::parse_from_rfc3339(&ledger_ts).map_err(|e| {
            CoreError::Internal(format!(
                "failed to parse ledger timestamp '{ledger_ts}': {e}"
            ))
        })?;
        let now_naive = chrono::Utc::now().naive_utc();
        let ledger_naive = ledger_dt.naive_utc();

        // If the ledger timestamp is further in the future than our
        // tolerance window, the clock has been rolled back.
        let delta = ledger_naive.signed_duration_since(now_naive).num_seconds();

        if delta > CLOCK_SKEW_TOLERANCE_SECONDS {
            return Err(CoreError::SystemClockTampered(format!(
                "Ledger timestamp {ledger_ts} is {delta}s ahead of system clock. \
                 Clock rollback detected — register locked until online cloud sync."
            )));
        }

        Ok(())
    }

    /// Check if the subscription is within the offline grace period.
    ///
    /// Free tier has no grace period (always "within grace" since it's free).
    /// Paid tiers get a per-tier offline grace (`offline_grace_days()`, see
    /// subscription-tiers.md §3 Support table) before quotas revert to Free.
    ///
    /// A canceled subscription is never within grace.
    ///
    /// Returns `true` if the subscription is still valid (not expired or
    /// within grace period).
    pub fn is_within_grace_period(&self) -> bool {
        self.is_within_grace_period_at(chrono::Utc::now())
    }

    /// Check if the subscription is within grace evaluated against a specific RFC3339 timestamp.
    ///
    /// Useful for validating grace against a monotonic ledger timestamp (e.g. `compute_max_ledger_timestamp`)
    /// to detect and resist local system clock tampering/rollback.
    /// Fails closed to `false` if `reference_timestamp` cannot be parsed.
    pub fn is_within_grace_period_with_timestamp(&self, reference_timestamp: &str) -> bool {
        match chrono::DateTime::parse_from_rfc3339(reference_timestamp) {
            Ok(dt) => self.is_within_grace_period_at(dt.with_timezone(&chrono::Utc)),
            Err(_) => false,
        }
    }

    /// Check if the subscription is within grace evaluated at a specific UTC datetime.
    pub fn is_within_grace_period_at(&self, now: chrono::DateTime<chrono::Utc>) -> bool {
        // Canceled subscriptions are never within grace.
        if self.status == "canceled" {
            return false;
        }

        // Free tier — always within grace.
        if self.tier == SubscriptionTier::Free {
            return true;
        }

        // No expiry — lifetime/perpetual license.
        let expires_at = match &self.expires_at {
            Some(ts) => ts,
            None => return true,
        };

        let expiry = match chrono::DateTime::parse_from_rfc3339(expires_at) {
            Ok(dt) => dt.with_timezone(&chrono::Utc),
            Err(_) => return false, // Unparseable expiry → assume expired
        };

        // When marked as a trial with an explicit trial_ends_at, the trial deadline
        // strictly governs offline validity (0 offline grace days post-trial).
        if self.is_trial() {
            if let Some(ends_at_str) = self.trial_ends_at() {
                if let Ok(trial_end) = chrono::DateTime::parse_from_rfc3339(&ends_at_str) {
                    let trial_end_utc = trial_end.with_timezone(&chrono::Utc);
                    if now > trial_end_utc {
                        return false;
                    }
                }
            }
        }

        let grace_deadline = expiry + chrono::Duration::days(self.tier.offline_grace_days());

        now <= grace_deadline
    }

    /// A defensive default for tenants without a subscription row — Free
    /// tier with an empty quota block (workspace types fall back to the
    /// tier defaults). Mirrors the bootstrap row the migration seeds.
    pub fn bootstrap_free() -> Self {
        Self {
            tenant_id: "default".into(),
            tier: SubscriptionTier::Free,
            status: "active".into(),
            expires_at: None,
            max_locations: 1,
            max_pos_instances: 1,
            allowed_types_json: "[]".into(),
            signature: String::new(),
            signed_payload: String::new(),
            api_key: String::new(),
            updated_at: String::new(),
        }
    }

    /// Whether the subscription currently allows the given workspace type.
    ///
    /// Honors the signed payload's quota block (`allowed_types_json` — e.g.
    /// a Plus + restaurant_starter bundle lists `kds`, C3.2), falling back
    /// to the tier's static defaults when the list is empty or unparseable
    /// (bootstrap `[]`, legacy rows). A grace-expired or canceled
    /// subscription reverts to the Free defaults regardless of the stored
    /// list — the entitlement the server granted no longer applies.
    pub fn allows_workspace_type(&self, type_key: &str) -> bool {
        if !self.is_within_grace_period() {
            return SubscriptionTier::Free.allows_workspace_type(type_key);
        }
        match serde_json::from_str::<Vec<String>>(&self.allowed_types_json) {
            Ok(types) if !types.is_empty() => types.iter().any(|t| t == type_key),
            _ => self.tier.allows_workspace_type(type_key),
        }
    }

    /// Parse the add-on identifiers from the signed subscription payload.
    ///
    /// Add-ons are stored as a JSON array of strings in the signed payload
    /// (e.g. `["advanced_analytics", "priority_support"]`). They are additive
    /// to the base tier quotas — a Plus subscriber with `advanced_analytics`
    /// gains analytics without upgrading to Pro.
    ///
    /// Returns an empty vec if the payload is empty or unparseable.
    pub fn addons(&self) -> Vec<String> {
        if self.signed_payload.is_empty() {
            return Vec::new();
        }
        // The signed payload is a JSON object; extract the "addons" array.
        serde_json::from_str::<serde_json::Value>(&self.signed_payload)
            .ok()
            .and_then(|v| v.get("addons").cloned())
            .and_then(|v| serde_json::from_value::<Vec<String>>(v).ok())
            .unwrap_or_default()
    }

    /// Check if the subscription has a specific add-on.
    ///
    /// Case-insensitive comparison against the `addons` list in the signed
    /// payload. Returns `false` for empty/unparseable payloads.
    pub fn has_addon(&self, addon: &str) -> bool {
        let lower = addon.to_lowercase();
        self.addons().iter().any(|a| a.to_lowercase() == lower)
    }

    /// Trial state carried by the signed payload (Phase C), parsed in one
    /// pass: `(is_trial, trial_ends_at)`.
    ///
    /// Read from the signed payload rather than a column — Phase C is
    /// deliberately JSON-only with no schema migration, and the payload is
    /// the signature-covered source of truth, so a tampered row cannot
    /// invent a trial. Everything that cannot be trusted fails closed to
    /// `(false, None)`: an empty or unparseable payload, an absent or
    /// wrongly-typed `is_trial`, an absent or empty `trial_ends_at` — and,
    /// the interesting case, a `trial_ends_at` that is not valid RFC3339.
    /// A trial whose end date cannot be parsed is not a trial we can warn
    /// about, so it reports as not-a-trial rather than as a trial with no
    /// deadline.
    fn parsed_trial(&self) -> (bool, Option<String>) {
        if self.signed_payload.is_empty() {
            return (false, None);
        }
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&self.signed_payload) else {
            return (false, None);
        };
        let is_trial = value
            .get("is_trial")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false);
        let ends_at = value
            .get("trial_ends_at")
            .and_then(serde_json::Value::as_str)
            .filter(|s| !s.is_empty())
            .filter(|s| chrono::DateTime::parse_from_rfc3339(s).is_ok())
            .map(str::to_string);
        (is_trial, ends_at)
    }

    /// Whether the signed payload marks this period as a trial.
    ///
    /// Orthogonal to the tier on purpose: `SubscriptionTier::from_db("trial")`
    /// keeps resolving to Free, so this flag is the only thing that survives
    /// the collapse. See [`Self::parsed_trial`] for the fail-closed contract.
    #[must_use]
    pub fn is_trial(&self) -> bool {
        self.parsed_trial().0
    }

    /// When the trial ends, from the signed payload (`None` when this is
    /// not a trial, or when the date is absent or unparseable).
    ///
    /// Returned owned because it is parsed per call, like [`Self::addons`].
    #[must_use]
    pub fn trial_ends_at(&self) -> Option<String> {
        self.parsed_trial().1
    }
    /// The signed payload's explicit per-feature instructions (Phase D1).
    ///
    /// Keyed by the canonical [`crate::availability::AvailabilityFeature`]
    /// wire name. An absent `features` block, an empty one, an unparseable
    /// payload and a wrongly-typed value all yield NO override, leaving the
    /// tier's own answer in place. That direction is deliberate: an
    /// unreadable block must not hand out a feature nobody signed, and it
    /// must not withhold one either — silence is the only safe reading of
    /// data that cannot be trusted.
    ///
    /// Unknown keys are returned as-is but are inert, because every caller
    /// looks up by `AvailabilityFeature::as_str()`. The enum therefore stays
    /// the single source of the key vocabulary: a shortened alias such as
    /// `"analytics"` is not a recognised key and silently does nothing.
    ///
    /// Parsed from the signed payload like [`Self::addons`] and
    /// [`Self::parsed_trial`], so the signature covers it and no migration
    /// is needed.
    #[must_use]
    pub fn payload_features(&self) -> std::collections::HashMap<String, bool> {
        if self.signed_payload.is_empty() {
            return std::collections::HashMap::new();
        }
        serde_json::from_str::<serde_json::Value>(&self.signed_payload)
            .ok()
            .and_then(|v| v.get("features").cloned())
            .and_then(|v| serde_json::from_value::<std::collections::HashMap<String, bool>>(v).ok())
            .unwrap_or_default()
    }

    /// The payload's instruction for one feature, or `None` when it has no
    /// opinion and the tier's answer stands.
    ///
    /// Pass `AvailabilityFeature::as_str()` — anything else is a lookup miss
    /// by design, not an error. A whole-block type error (e.g. `features`
    /// being a string) drops every entry rather than partially trusting the
    /// block.
    #[must_use]
    pub fn payload_feature_grant(&self, key: &str) -> Option<bool> {
        self.payload_features().get(key).copied()
    }

    /// Whether the subscription supports analytics, accounting for add-ons.
    ///
    /// Pro+ natively supports analytics. Plus gains analytics via the
    /// `advanced_analytics` add-on. Other tiers do not support analytics
    /// regardless of add-ons.
    pub fn supports_analytics_with_addons(&self) -> bool {
        if self.tier.supports_analytics() {
            return true;
        }
        matches!(self.tier, SubscriptionTier::Plus) && self.has_addon("advanced_analytics")
    }

    /// Determine the effective subscription tier after applying
    /// offline grace rules.
    ///
    /// - If the subscription has not expired (or is within the 14-day
    ///   grace period), returns the actual tier.
    /// - If the grace period has elapsed and the register is still
    ///   offline, returns `Free` (downgraded).
    pub fn effective_tier(&self) -> SubscriptionTier {
        self.effective_tier_at(chrono::Utc::now())
    }

    /// Determine the effective subscription tier evaluated against a specific RFC3339 timestamp.
    pub fn effective_tier_with_timestamp(&self, reference_timestamp: &str) -> SubscriptionTier {
        match chrono::DateTime::parse_from_rfc3339(reference_timestamp) {
            Ok(dt) => self.effective_tier_at(dt.with_timezone(&chrono::Utc)),
            Err(_) => SubscriptionTier::Free,
        }
    }

    /// Determine the effective subscription tier evaluated at a specific UTC datetime.
    pub fn effective_tier_at(&self, now: chrono::DateTime<chrono::Utc>) -> SubscriptionTier {
        if self.is_within_grace_period_at(now) {
            self.tier.clone()
        } else {
            tracing::warn!(
                tier = %self.tier.name(),
                expires_at = ?self.expires_at,
                "subscription grace period expired — reverting to Free tier"
            );
            SubscriptionTier::Free
        }
    }

    /// Normalize the row into the shared lifecycle state contract
    /// (todo-global-saas-1.md §B: loading/active/grace/expired/canceled/
    /// paused/unavailable — `loading` is the UI's fetch phase, the rest
    /// live here).
    ///
    /// Status strings the license server writes (`active`, `grace_period`,
    /// `paused`, `canceled`, `revoked`, `expired`) map first; anything else
    /// is [`SubscriptionLifecycleState::Unavailable`] — unrecognized data
    /// must fail closed, not guess. An `active` row is then refined by
    /// date, mirroring [`Self::is_within_grace_period`] exactly so the
    /// reported state can never disagree with `effective_tier`: Free is
    /// active forever, a missing expiry is a perpetual license, an
    /// unparseable expiry fails closed as expired, and a paid row past its
    /// expiry reports `Grace` until the tier's offline grace window ends.
    pub fn lifecycle_state(&self) -> SubscriptionLifecycleState {
        self.lifecycle_state_at(chrono::Utc::now())
    }

    /// Normalize the row into the shared lifecycle state contract evaluated against a specific RFC3339 timestamp.
    ///
    /// Fails closed to `SubscriptionLifecycleState::Expired` if `reference_timestamp` cannot be parsed.
    pub fn lifecycle_state_with_timestamp(
        &self,
        reference_timestamp: &str,
    ) -> SubscriptionLifecycleState {
        match chrono::DateTime::parse_from_rfc3339(reference_timestamp) {
            Ok(dt) => self.lifecycle_state_at(dt.with_timezone(&chrono::Utc)),
            Err(_) => SubscriptionLifecycleState::Expired,
        }
    }

    /// Normalize the row into the shared lifecycle state contract evaluated at a specific UTC datetime.
    pub fn lifecycle_state_at(
        &self,
        now: chrono::DateTime<chrono::Utc>,
    ) -> SubscriptionLifecycleState {
        match self.status.as_str() {
            "canceled" | "revoked" => return SubscriptionLifecycleState::Canceled,
            "paused" => return SubscriptionLifecycleState::Paused,
            "expired" => return SubscriptionLifecycleState::Expired,
            "grace_period" => return SubscriptionLifecycleState::Grace,
            "active" => {}
            _ => return SubscriptionLifecycleState::Unavailable,
        }
        // Free is active forever (same semantics as is_within_grace_period).
        if self.tier == SubscriptionTier::Free {
            return SubscriptionLifecycleState::Active;
        }
        let Some(expires_at) = &self.expires_at else {
            return SubscriptionLifecycleState::Active; // perpetual / lifetime
        };
        let Ok(expiry) = chrono::DateTime::parse_from_rfc3339(expires_at) else {
            // Unparseable expiry — is_within_grace_period fails closed here.
            return SubscriptionLifecycleState::Expired;
        };
        let expiry = expiry.with_timezone(&chrono::Utc);

        // When marked as a trial with an explicit trial_ends_at, the trial deadline
        // strictly governs offline validity (0 offline grace days post-trial).
        if self.is_trial() {
            if let Some(ends_at_str) = self.trial_ends_at() {
                if let Ok(trial_end) = chrono::DateTime::parse_from_rfc3339(&ends_at_str) {
                    let trial_end_utc = trial_end.with_timezone(&chrono::Utc);
                    if now > trial_end_utc {
                        return SubscriptionLifecycleState::Expired;
                    }
                }
            }
        }

        if now <= expiry {
            return SubscriptionLifecycleState::Active;
        }
        if now <= expiry + chrono::Duration::days(self.tier.offline_grace_days()) {
            return SubscriptionLifecycleState::Grace;
        }
        SubscriptionLifecycleState::Expired
    }

    /// Whether POS runtime is locked to a read-only state (§B).
    ///
    /// True ONLY when the offline grace window has fully lapsed
    /// ([`SubscriptionLifecycleState::Expired`]): no new sales, order
    /// mutations, or sync queueing — viewing, data export, and sign-out
    /// remain available, and the register reopens automatically once
    /// connectivity returns and a valid subscription is verified.
    ///
    /// Deliberately narrow: `Canceled`/`Paused` revert entitlements to
    /// Free (Free can still sell), and missing/tampered data degrades to
    /// Free-tier operations rather than bricking a register — the §B
    /// fail-closed rule targets administrative features, not the
    /// operational sale path. Data-integrity responses live in the
    /// capabilities command and the admin gate.
    pub fn pos_read_only(&self) -> bool {
        self.pos_read_only_at(chrono::Utc::now())
    }

    /// Whether POS runtime is locked to a read-only state evaluated against a specific RFC3339 timestamp.
    pub fn pos_read_only_with_timestamp(&self, reference_timestamp: &str) -> bool {
        self.lifecycle_state_with_timestamp(reference_timestamp)
            == SubscriptionLifecycleState::Expired
    }

    /// Whether POS runtime is locked to a read-only state evaluated at a specific UTC datetime.
    pub fn pos_read_only_at(&self, now: chrono::DateTime<chrono::Utc>) -> bool {
        self.lifecycle_state_at(now) == SubscriptionLifecycleState::Expired
    }

    /// Enforce [`Self::pos_read_only`] — returns
    /// [`CoreError::SubscriptionReadOnly`] when the register is locked.
    pub fn enforce_pos_writable(&self) -> Result<(), CoreError> {
        if self.pos_read_only() {
            return Err(CoreError::SubscriptionReadOnly(
                "The offline grace window has expired. This register is read-only: ".to_string()
                    + "sales and order changes are locked until the subscription is verified online. "
                    + "Data export and viewing remain available.",
            ));
        }
        Ok(())
    }
}

/// Normalized subscription lifecycle state shared by the license server,
/// the local snapshot, and the UI (todo-global-saas-1.md §B).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SubscriptionLifecycleState {
    /// Paid period valid (`now <= expires_at`, or no expiry, or Free).
    Active,
    /// Paid period elapsed but still inside the tier's offline grace
    /// window. Operational entitlements continue; grace never grants new
    /// access.
    Grace,
    /// Expired and outside grace (or the server marked the row expired).
    Expired,
    /// Canceled or revoked server-side — never within grace.
    Canceled,
    /// Paused by the server (pause window / billing hold).
    Paused,
    /// Missing, tampered, or unrecognized subscription data — fail closed
    /// for tier-gated features.
    Unavailable,
}

impl SubscriptionLifecycleState {
    /// Database/wire representation (snake_case, matches the serde form).
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Grace => "grace",
            Self::Expired => "expired",
            Self::Canceled => "canceled",
            Self::Paused => "paused",
            Self::Unavailable => "unavailable",
        }
    }
}

// ── Quota Enforcement ─────────────────────────────────────────────────

/// Error type for quota-related failures, used by the subscription
/// module to provide actionable upgrade messaging.
#[derive(Debug)]
pub enum QuotaError {
    /// The tenant has reached their per-store register limit.
    RegisterLimit {
        /// The subscription tier name.
        tier: String,
        /// The maximum number allowed.
        limit: i64,
        /// The current usage count.
        current: i64,
    },
    /// The tenant has reached their store count limit.
    StoreLimit {
        /// The subscription tier name.
        tier: String,
        /// The maximum number allowed.
        limit: i64,
        /// The current usage count.
        current: i64,
    },
    /// The workspace type is not available on this tier.
    TypeNotAllowed {
        /// The subscription tier name.
        tier: String,
        /// The workspace type key that was rejected.
        type_key: String,
    },
    /// The tenant has reached their staff-user limit (C1.1, §9 pre-launch item 1).
    StaffLimit {
        /// The subscription tier name.
        tier: String,
        /// The maximum number of staff users allowed.
        limit: i64,
        /// The current active staff count.
        current: i64,
    },
    /// The tenant has reached their warehouse-location limit.
    WarehouseLimit {
        /// The subscription tier name.
        tier: String,
        /// The maximum number of warehouse locations allowed.
        limit: i64,
        /// The current active warehouse count.
        current: i64,
    },
    /// The tenant has reached their product/menu-item limit
    /// (subscription-tiers.md §Numeric Limits).
    ProductLimit {
        /// The subscription tier name.
        tier: String,
        /// The maximum number of products allowed.
        limit: i64,
        /// The current product count.
        current: i64,
    },
    /// The tenant has reached their KDS screen limit
    /// (subscription-tiers.md §Numeric Limits).
    KdsScreenLimit {
        /// The subscription tier name.
        tier: String,
        /// The maximum number of KDS screens allowed.
        limit: i64,
        /// The current active KDS screen count.
        current: i64,
    },
}

impl std::fmt::Display for QuotaError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::RegisterLimit {
                tier,
                limit,
                current,
            } => {
                write!(
                    f,
                    "Your {tier} tier allows maximum {limit} registers per store. \
                     This store already has {current}. Upgrade to add more."
                )
            }
            Self::StoreLimit {
                tier,
                limit,
                current,
            } => {
                write!(
                    f,
                    "Your {tier} tier allows maximum {limit} stores. \
                     You currently have {current}. Upgrade to add more."
                )
            }
            Self::TypeNotAllowed { tier, type_key } => {
                write!(
                    f,
                    "The '{type_key}' workspace type requires a higher tier. \
                     Your current tier is {tier}."
                )
            }
            Self::StaffLimit {
                tier,
                limit,
                current,
            } => {
                write!(
                    f,
                    "Your {tier} tier allows maximum {limit} staff users. \
                     You currently have {current}. Upgrade to add more."
                )
            }
            Self::WarehouseLimit {
                tier,
                limit,
                current,
            } => {
                write!(
                    f,
                    "Your {tier} tier allows maximum {limit} warehouse locations. \
                     You currently have {current}. Upgrade to add more."
                )
            }
            Self::ProductLimit {
                tier,
                limit,
                current,
            } => {
                write!(
                    f,
                    "Your {tier} tier allows maximum {limit} products. \
                     You currently have {current}. Upgrade to add more."
                )
            }
            Self::KdsScreenLimit {
                tier,
                limit,
                current,
            } => {
                write!(
                    f,
                    "Your {tier} tier allows maximum {limit} KDS screens. \
                     You currently have {current}. Upgrade to add more."
                )
            }
        }
    }
}

impl From<QuotaError> for CoreError {
    fn from(e: QuotaError) -> Self {
        CoreError::SubscriptionLimitExceeded(e.to_string())
    }
}

#[cfg(test)]
#[path = "subscription_tests.rs"]
mod tests;
