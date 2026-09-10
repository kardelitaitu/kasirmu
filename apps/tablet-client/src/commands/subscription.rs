//! Subscription capability command (C2.2 in-app upgrade triggers).
//!
//! Tablet mirror of the desktop command: exposes the active tenant
//! subscription's quotas and feature flags plus current usage counts so the
//! shared UI can render tier gates (QRIS gate, terminal-limit banner, …).
//!
//! Fail-closed (todo-global-saas-1.md §B): the payload always carries a
//! lifecycle `state`; a missing/tampered/unreadable subscription yields
//! Free entitlements + `unavailable` instead of an IPC error, because the
//! UI's error path renders gates open.

use chrono;
use serde::Serialize;
use tauri::{State, command};

use oz_core::availability::{AvailabilityFeature, FeatureVerdict, UsageCounts};
use oz_core::db::Store;
use oz_core::db::assignments::ScopeType;
use oz_core::downgrade::OverQuotaReport;
use oz_core::entitlements::{Entitlements, SubscriptionLoader, build_entitlements};
use oz_core::permissions;
use oz_core::subscription::{SubscriptionLifecycleState, SubscriptionTier, TenantSubscription};

use crate::commands::authz::require_permission_for_session;
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
    /// Whether the signed payload marks this period as a trial (Phase C,
    /// C+D-RES-1). Orthogonal to `tier` on purpose: a trial resolves to
    /// Free - the quota answer - and this flag is the fact that collapse
    /// used to lose. `false` when fail-closed: an unreadable row is never
    /// reported as a trial.
    pub is_trial: bool,
    /// When the trial ends (RFC3339, from the signed payload); `None`
    /// when this is not a trial or the date is absent/unparseable.
    /// Null-when-absent semantics: no default is ever invented here.
    pub trial_ends_at: Option<String>,
    /// The signed payload's explicit per-feature instructions (Phase D1,
    /// surfaced over the caps wire by C+D-RES-1): the server's `features`
    /// map keyed by the canonical
    /// [`oz_core::availability::AvailabilityFeature`] wire names. Empty
    /// when the payload has no opinion - silence is the only safe reading
    /// of data that cannot be trusted, so no default grant is invented.
    pub features: std::collections::HashMap<String, bool>,
    /// Maximum locations allowed (`None` = unlimited). Wire name renamed
    /// from `maxStores` — the §B gate the Phase-3 observability slice was
    /// waiting on (UI consumers renamed in the same commit).
    pub max_locations: Option<i64>,
    /// Maximum POS registers per store (`None` = unlimited).
    pub max_pos_instances: Option<i64>,
    /// Maximum inventory warehouses (`None` = unlimited).
    pub max_warehouses: Option<i64>,
    /// Per-location KDS screen cap (`None` = unlimited). Not a tenant-global
    /// quota — it governs each location separately (parity with desktop, §J B3).
    pub max_kds_screens: Option<i64>,
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

/// Read the tenant's subscription capabilities and current usage.
///
/// Fail-closed (todo-global-saas-1.md §B): a missing row, a tampered
/// signature, or an unreadable subscription table returns Free-tier
/// capabilities with `state: "unavailable"` instead of an IPC error — the
/// UI's error path renders gates open, so the authoritative fail-closed
/// representation must come from here.
#[command]
pub async fn get_subscription_capabilities(
    state: State<'_, AppState>,
) -> Result<SubscriptionCapabilitiesDto, AppError> {
    let db = state.db.lock().await;
    let store = Store::new(&db);
    // Tablet passes `debug_upgrade: false` — the per-client divergence
    // the consolidation design preserves deliberately: this client's
    // caps apply no dev Free→Premium upgrade, so the verdict beside it
    // must not either.
    let ent = build_entitlements(&store, gather_usage(&store), false);
    // The server's explicit feature-grant map is only readable from the
    // verified row itself (it is not on `Entitlements`), so it is loaded
    // here - before the guard is dropped - with the same fail-closed
    // semantics the verdict path uses: a missing/tampered/unreadable row
    // is `None`, whose map is empty.
    let features = store
        .load_verified_subscription()
        .map(|sub| sub.payload_features())
        .unwrap_or_default();

    drop(db);

    Ok(project_capabilities(&ent, &features))
}

/// Gather the usage counts the gates and the caps DTO share, best-effort:
/// they drive approaching-limit banners and verdict details, and a broken
/// global DB must still yield a definitive fail-closed payload rather
/// than an IPC error.
fn gather_usage(store: &Store<'_>) -> UsageCounts {
    UsageCounts {
        locations: store.count_locations().unwrap_or_else(|e| {
            tracing::warn!("location count failed — reporting 0: {e}");
            0
        }),
        staff_users: store.count_staff_users().unwrap_or_else(|e| {
            tracing::warn!("staff count failed — reporting 0: {e}");
            0
        }),
        pos_instances: store.count_terminals().unwrap_or_else(|e| {
            tracing::warn!("terminal count failed — reporting 0: {e}");
            0
        }),
        warehouses: store.count_warehouse_locations().unwrap_or_else(|e| {
            tracing::warn!("warehouse count failed — reporting 0: {e}");
            0
        }),
    }
}

/// Project the caps DTO from the one read model (Phase A): every axis —
/// tier, state, limits, flags, add-ons, usage — reads from the same
/// `Entitlements` instance the verdict gathers from, so the two surfaces
/// cannot disagree. The limits route through `QuotaDimension::limit_for`
/// (Phase B), matching the creation gates.
fn project_capabilities(
    ent: &Entitlements,
    features: &std::collections::HashMap<String, bool>,
) -> SubscriptionCapabilitiesDto {
    SubscriptionCapabilitiesDto {
        tier: ent.tier.tier_key().to_string(),
        state: ent.state.as_str().to_string(),
        // C+D-RES-1 (W7-C): trial state + feature grants ride the caps
        // payload so the UI reads the whole subscription picture from ONE
        // IPC instead of inferring it from a verdict it may never request.
        is_trial: ent.is_trial,
        trial_ends_at: ent.trial_ends_at.clone(),
        features: features.clone(),
        max_locations: ent.max_locations(),
        max_pos_instances: ent.max_pos_instances(),
        max_warehouses: ent.max_warehouses(),
        max_kds_screens: ent.max_kds_screens(),
        max_staff_users: ent.max_staff_users(),
        sales_history_days: ent.sales_history_days(),
        supports_qris: ent.supports_qris(),
        // Addon-aware (C4.3): Plus + advanced_analytics unlocks analytics.
        // The static part comes from the entitlement tier; the addon grant
        // flows only while the subscription is active or in grace —
        // canceled/expired rows get the downgraded answer.
        supports_analytics: ent.supports_analytics(),
        supports_loyalty: ent.supports_loyalty(),
        supports_daily_dashboard: ent.supports_daily_dashboard(),
        supports_cloud_sync: ent.supports_cloud_sync(),
        offline_grace_days: ent.offline_grace_days(),
        location_count: ent.usage.locations,
        staff_count: ent.usage.staff_users,
        terminal_count: ent.usage.pos_instances,
        addons: ent.addons.clone(),
    }
}

// ── Feature-availability verdicts (Phase 3 observability) ───────────

/// The registry permission whose holding decides the verdict's `role`
/// axis, per feature. Permissions are the vocabulary (ADR #47 stop_memo
/// ruling A2): no rank map is invented, and a custom role holding the
/// gate permission passes the same way a preset would.
fn gate_permission(feature: AvailabilityFeature) -> &'static str {
    match feature {
        AvailabilityFeature::Qris => permissions::SALES_PROCESS,
        AvailabilityFeature::Analytics => permissions::ANALYTICS_VIEW,
        AvailabilityFeature::Loyalty => permissions::LOYALTY_VIEW,
        AvailabilityFeature::DailyDashboard => permissions::REPORTS_VIEW,
        AvailabilityFeature::CloudSync => permissions::SYNC_MANAGE,
        AvailabilityFeature::SalesHistoryDays => permissions::SALES_VIEW,
        AvailabilityFeature::Locations | AvailabilityFeature::PosInstances => {
            permissions::TOPOLOGY_WRITE
        }
        AvailabilityFeature::StaffUsers => permissions::STAFF_CREATE,
        AvailabilityFeature::Warehouses => permissions::INVENTORY_LOCATIONS_MANAGE,
    }
}

/// The server-policy question per feature, from two producers in order:
///
/// 1. Phase D1 — the signed payload's explicit per-feature instruction
///    (`features: {"supports_analytics": false}`), which outranks anything
///    inferred, because it is the server speaking about THIS feature rather
///    than about a workspace type that merely implies something about it.
/// 2. `Some(false)` when the payload withholds a workspace type the feature
///    needs — the same [`TenantSubscription::allows_workspace_type`] answer
///    the workspace creation path enforces, so a verdict can never disagree
///    with the gate it explains.
///
/// `None` when the server has said nothing on either axis: the tier's own
/// answer stands. Producer 2 is reached only when 1 has no opinion, so every
/// payload written before Phase D1 resolves exactly as it always did.
fn server_grant_for(
    feature: AvailabilityFeature,
    loaded: Option<&TenantSubscription>,
) -> Option<bool> {
    let sub = loaded?;
    if let Some(explicit) = sub.payload_feature_grant(feature.as_str()) {
        return Some(explicit);
    }
    let allowed = |type_key: &str| sub.allows_workspace_type(type_key);
    match feature {
        // A warehouse workspace is an inventory-location surface; Free
        // tiers and withheld payload types both deny it server-side.
        AvailabilityFeature::Warehouses => Some(allowed("warehouse")),
        AvailabilityFeature::PosInstances => {
            Some(allowed("store-pos") || allowed("restaurant-pos"))
        }
        _ => None,
    }
}

/// Load the subscription row with the exact fail-closed semantics of the
/// capabilities command: missing/tampered/unreadable yields `None`, which
/// every axis then treats as Free + `unavailable` rather than an error.
fn load_subscription_for_verdict(db: &rusqlite::Connection) -> Option<TenantSubscription> {
    match TenantSubscription::load(db, "default") {
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
    }
}

/// End of the grace window for the loaded subscription, when the verdict's
/// lifecycle state is `Grace` and the row carries a parseable expiry.
/// Same per-tier window the desktop client uses, so the two diagnostics
/// surfaces agree.
fn grace_until_for(
    loaded: Option<&TenantSubscription>,
    tier: &SubscriptionTier,
    state: &SubscriptionLifecycleState,
) -> Option<String> {
    if *state != SubscriptionLifecycleState::Grace {
        return None;
    }
    let sub = loaded?;
    let expiry = chrono::DateTime::parse_from_rfc3339(sub.expires_at.as_ref()?).ok()?;
    let deadline = expiry + chrono::Duration::days(tier.offline_grace_days());
    Some(deadline.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
}

/// Resolve why `feature` is (un)available for `user_id`, from the same
/// local signed row and the same count/permission primitives the real
/// gates use. Pure read; no server round-trip; every gate question is
/// answered by the gate's own implementation so a verdict cannot drift
/// from enforcement.
/// `branch`/`workspace` carry the session's location and workspace type —
/// the scope verdict explains the caller where they stand (ADR #47 v1
/// scope ruling, current-location).
fn load_feature_verdict(
    db: &rusqlite::Connection,
    user_id: &str,
    feature_key: &str,
    branch: &str,
    workspace: &str,
) -> Result<FeatureVerdict, AppError> {
    // Fail closed on unknown keys: never resolve to "available".
    let feature = AvailabilityFeature::parse(feature_key).ok_or_else(|| {
        AppError::Invalid(format!(
            "unknown feature key {feature_key:?} — see oz_core::availability::AvailabilityFeature"
        ))
    })?;

    let store = Store::new(db);
    let loaded = load_subscription_for_verdict(db);
    // One read model for the whole verdict (Phase A) — and it must mirror
    // THIS client's `load_capabilities` exactly. The tablet's capabilities
    // command applies no debug Free→Premium upgrade (`debug_upgrade:
    // false` below), so neither may the verdict. The invariant that
    // matters is same-session agreement between a verdict and the gates
    // it explains: a verdict reporting `premium` while this client's caps
    // reports `free` would tell support a feature is available on a
    // register whose tier gates are locked — the exact contradiction this
    // command exists to prevent.
    //
    // Desktop's caps DOES apply that upgrade, so the two clients'
    // verdicts legitimately differ in debug builds and converge in
    // release. The missing upgrade in the tablet's capabilities command
    // is a pre-existing gap owned by that command, not something the
    // verdict should paper over by disagreeing with the payload beside it.
    let ent = loaded
        .as_ref()
        .map(|sub| Entitlements::from_subscription(sub, gather_usage(&store)))
        .unwrap_or_else(|| Entitlements::fail_closed(UsageCounts::default()));

    // Soft role check through the same authorize path the hard gates use —
    // a denial here is DIAGNOSED (reason `role`), not thrown.
    let role_granted = store
        .require_permission(user_id, gate_permission(feature))
        .is_ok();

    let server_grant = server_grant_for(feature, loaded.as_ref());
    let permission = gate_permission(feature);

    // Scope axis, identical to the desktop verdict: the 0048
    // branch/workspace check AND the ADR #47 resource-coverage check on
    // the session location, evaluated with the same primitives the hard
    // gates use. Legacy users without an assignment row are not
    // scope-restricted (ruling 5).
    // Both axes, one implementation: `Store::assignment_covers_session` is
    // the same composite the scoped session gates enforce, so the verdict
    // cannot drift from the gate it explains. This replaces a byte-identical
    // copy of ruling 3's inheritance that lived in each client command.
    let scope_granted =
        store.assignment_covers_session(user_id, ScopeType::Location, branch, branch, workspace)?;

    // Add-on grant (C4.3): `advanced_analytics` answers the tier question
    // for analytics on Plus — the resolver suppresses only the tier check
    // for it, which is exactly the addon semantics.
    let server_grant = if feature == AvailabilityFeature::Analytics
        && ent.addon_grant_flows()
        && ent.addons.iter().any(|a| a == "advanced_analytics")
    {
        Some(true)
    } else {
        server_grant
    };

    let expires_at_owned = loaded.as_ref().and_then(|sub| sub.expires_at.clone());
    let grace_until_owned = grace_until_for(loaded.as_ref(), &ent.tier, &ent.state);

    // ADR #47 v1 scope ruling (current-location), mirrored from
    // desktop so a tablet verdict can never disagree with its
    // desktop twin on the same assignment.
    let facts = ent.availability_facts(
        feature,
        role_granted,
        scope_granted,
        Some(permission),
        server_grant,
        expires_at_owned.as_deref(),
        grace_until_owned.as_deref(),
    );
    Ok(oz_core::availability::explain_availability(&facts))
}

/// Explain WHY a feature is (un)available for the session user — the
/// diagnostics surface behind support's "why can't I use X" question
/// (todo-global-saas-3.md, feature-flag observability).
///
/// Gated on `settings:read`: the verdict is a diagnostics read, but it
/// echoes quota numbers and permission keys, so it is not staff-ephemeral
/// data. Reads only the local signed subscription row and the global
/// identity DB — no network round-trip — so it is honest offline, where
/// "why" questions are most often asked.
#[command]
pub async fn explain_feature_availability_scoped(
    session_token: String,
    feature: String,
    state: State<'_, AppState>,
) -> Result<FeatureVerdict, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SETTINGS_READ).await?;
    let db = state.db.lock().await;
    load_feature_verdict(
        &db,
        &session.user_id,
        &feature,
        &session.store_id,
        &session.type_key,
    )
}

/// Tablet mirror of the desktop over-quota assessment (todo-global-saas-2.md
/// §J remediation): which resources exceed the effective tier's quota.
/// Read-only; gated `settings:read`; fails closed against the effective
/// (gates-enforced) tier exactly like the caps command.
#[command]
pub async fn get_over_quota_report(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<OverQuotaReport, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SETTINGS_READ).await?;
    let db = state.db.lock().await;
    let (report, _tier) = load_over_quota_report(&db)?;
    Ok(report)
}

/// The `_scoped` twin of [`get_over_quota_report`] (todo-global-saas-3.md
/// L142 recorded the surface as lacking one and failing
/// `verify-scoped-coverage.sh`). Same report, same `settings:read` gate,
/// and the scope is the authenticated session: an unknown `session_token`
/// fails closed via `resolve_session`. The dimensions the report assesses
/// are tenant ceilings (locations, registers, warehouses, staff, products)
/// rather than per-store ones — the reasoning that keeps the topology
/// commands in the scoped-coverage allowlist's category 2 — so there is
/// deliberately no store connection to resolve here, exactly like
/// `list_permission_keys_scoped` scopes the session without a store.
#[command]
pub async fn get_over_quota_report_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<OverQuotaReport, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SETTINGS_READ).await?;
    let db = state.db.lock().await;
    let (report, _tier) = load_over_quota_report(&db)?;
    Ok(report)
}

/// The synchronous body of both tablet over-quota commands, split out so
/// the tests exercise the exact production path (the desktop twin of this
/// helper carries the same rationale). Returns the effective tier
/// alongside the report so callers can render against the gates-enforced
/// tier without re-deriving entitlements.
fn load_over_quota_report(
    db: &rusqlite::Connection,
) -> Result<(OverQuotaReport, SubscriptionTier), AppError> {
    let store = Store::new(db);
    let ent = build_entitlements(&store, gather_usage(&store), false);
    let markers = store.persist_over_quota_markers()?;
    let mut report = store.assess_downgrade(&ent.tier)?;
    report.markers = markers;
    Ok((report, ent.tier))
}

// ── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "subscription_tests.rs"]
mod tests;
