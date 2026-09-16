//! Subscription bridge module (Wave E).
//!
//! Ported verbatim from `apps/desktop-client/src/commands/subscription.rs`
//! (Wave E slice E4): the capability read model, the feature-availability
//! verdict and the over-quota report live here; the desktop command file
//! keeps thin `#[tauri::command]` shims plus the AppError-returning adapters
//! its mounted `subscription_tests.rs` exercises.
//!
//! Exposes the tenant subscription's quotas and feature flags — straight
//! from `SubscriptionTier` in oz-core — plus the tenant's current usage
//! counts (stores, staff, terminals). The UI uses this single read to
//! render tier gates: analytics/loyalty locks, QRIS gate, second-store
//! gate, terminal-limit banner, and the approaching-limit banners.
//!
//! Fail-closed (todo-global-saas-1.md §B): the payload always carries a
//! lifecycle `state`; a missing/tampered/unreadable subscription yields
//! Free entitlements + `unavailable` instead of an IPC error, because the
//! UI's error path renders gates open.

use serde::Serialize;

use oz_core::availability::{AvailabilityFeature, FeatureVerdict, UsageCounts};
use oz_core::db::Store;
use oz_core::db::assignments::ScopeType;
use oz_core::downgrade::{OverQuotaMarker, OverQuotaReport, OverQuotaSeverity, QuotaDimension};
use oz_core::entitlements::{Entitlements, SubscriptionLoader, build_entitlements};
use oz_core::permissions;
use oz_core::subscription::{SubscriptionLifecycleState, SubscriptionTier, TenantSubscription};
use oz_core::workspace_type::{RESTAURANT_POS, STORE_POS, WAREHOUSE};

use platform_core::StoreDatabaseManager;

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

/// The tenant's tier capabilities + current usage (C2.2).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionCapabilitiesDto {
    /// Tier key (`free`, `plus`, `pro`, `premium`, `enterprise`).
    pub tier: String,
    /// Raw subscription status (`active`, `canceled`, `paused`, etc.) from
    /// the local signed row, or `unavailable` when fail-closed.
    pub status: String,
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
    /// quota — it governs each location separately, which is why the over-quota
    /// report surfaces it as per-location rows rather than a usage row (§J B3).
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
    /// When the subscription expires (RFC 3339, from the local signed row).
    /// `None` for the bootstrap Free row (no expiry) or when the row is
    /// unreadable (fail-closed). The UI uses this for countdown banners.
    pub expires_at: Option<String>,
    /// End of the offline grace window (RFC 3339). Derived as
    /// `expires_at + tier.offline_grace_days()` and only present when the
    /// lifecycle state is `grace` and `expires_at` is parseable. `None`
    /// otherwise — the UI must not invent a grace deadline client-side.
    pub grace_until: Option<String>,
    /// Whether the lifecycle state is `expired` (i.e. past expiry AND past
    /// the grace window). Convenience alias so the Tools gate and upgrade
    /// modals need not compare string states.
    pub is_expired: bool,
    /// Current location count (approaching-limit banners).
    pub location_count: i64,
    /// Current active staff count (approaching-limit banners).
    pub staff_count: i64,
    /// Current registered terminal count (limit banners).
    pub terminal_count: i64,
}

/// Load the tenant's capabilities + usage from the global identity DB.
///
/// Fail-closed (todo-global-saas-1.md §B): a missing row, a tampered
/// signature, or an unreadable subscription table must NOT error into the
/// UI's catch path (where `caps: null` renders every gate open). It
/// returns Free-tier capabilities with `state: "unavailable"` so every
/// tier gate locks; the UI shows the state instead of silently granting.
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
    status: &str,
    expires_at: Option<String>,
    grace_until: Option<String>,
) -> SubscriptionCapabilitiesDto {
    SubscriptionCapabilitiesDto {
        tier: ent.tier.tier_key().to_string(),
        status: status.to_string(),
        state: ent.state.as_str().to_string(),
        // C+D-RES-1 (W7-C): trial state + feature grants ride the caps
        // payload so the UI reads the whole subscription picture from ONE
        // IPC instead of inferring it from a verdict it may never request.
        is_trial: ent.is_trial,
        trial_ends_at: ent.trial_ends_at.clone(),
        features: features.clone(),
        // Canonical wire name (the 1b staged migration completes here):
        // the field is `max_locations`, the quota method always was.
        max_locations: ent.max_locations(),
        max_pos_instances: ent.max_pos_instances(),
        max_warehouses: ent.max_warehouses(),
        max_kds_screens: ent.max_kds_screens(),
        max_staff_users: ent.max_staff_users(),
        sales_history_days: ent.sales_history_days(),
        supports_qris: ent.supports_qris(),
        // Addon-aware (C4.3): Plus + advanced_analytics unlocks analytics —
        // parity with the tablet command. The static part comes from the
        // entitlement tier (so the dev Free→Premium upgrade applies); the
        // addon grant flows only while the subscription is active or in
        // grace — canceled/expired rows get the downgraded answer.
        supports_analytics: ent.supports_analytics(),
        supports_loyalty: ent.supports_loyalty(),
        supports_daily_dashboard: ent.supports_daily_dashboard(),
        supports_cloud_sync: ent.supports_cloud_sync(),
        offline_grace_days: ent.offline_grace_days(),
        expires_at,
        grace_until,
        is_expired: ent.state == SubscriptionLifecycleState::Expired,
        location_count: ent.usage.locations,
        staff_count: ent.usage.staff_users,
        terminal_count: ent.usage.pos_instances,
        addons: ent.addons.clone(),
    }
}

/// Load the tenant's capabilities + usage from the global identity DB.
///
/// # Errors
///
/// Reads are fail-closed by design; an `Err` here is a DB fault the desktop
/// shim surfaces as `AppError::Core`.
pub fn load_capabilities(
    db: &rusqlite::Connection,
) -> Result<SubscriptionCapabilitiesDto, BridgeError> {
    let store = Store::new(db);
    // `debug_upgrade: true` is the desktop side of the per-client
    // divergence: only a genuinely active Free row is promoted in dev.
    let ent = build_entitlements(&store, gather_usage(&store), true);
    // The server's explicit feature-grant map is only readable from the
    // verified row itself (it is not on `Entitlements`), so it is loaded
    // here with the same fail-closed semantics the verdict path uses: a
    // missing/tampered/unreadable row is `None`, whose map is empty.
    let loaded = store.load_verified_subscription();
    let features = loaded
        .as_ref()
        .map(|sub| sub.payload_features())
        .unwrap_or_default();
    let status = loaded
        .as_ref()
        .map(|sub| sub.status.clone())
        .unwrap_or_else(|| "unavailable".to_string());
    let expires_at = loaded.as_ref().and_then(|sub| sub.expires_at.clone());
    let grace_until = grace_until_for(loaded.as_ref(), &ent.tier, &ent.state);
    Ok(project_capabilities(
        &ent,
        &features,
        &status,
        expires_at,
        grace_until,
    ))
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
        AvailabilityFeature::Warehouses => Some(allowed(WAREHOUSE)),
        AvailabilityFeature::PosInstances => Some(allowed(STORE_POS) || allowed(RESTAURANT_POS)),
        _ => None,
    }
}

/// Load the subscription row with the exact fail-closed semantics of
/// [`load_capabilities`]: missing/tampered/unreadable yields `None`, which
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
/// Same per-tier window `crate::commands::license::grace_deadline_for`
/// (desktop) uses, so the two diagnostics surfaces agree.
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

/// Resolve why `feature` is (un)available for `session`, from the same
/// local signed row and the same count/permission primitives the real
/// gates use. Pure read; no server round-trip; every gate question is
/// answered by the gate's own implementation so a verdict cannot drift
/// from enforcement.
///
/// The scope axis (ADR #47 v1 ruling, current-location): the verdict
/// explains the gates that bind the caller where they stand, so the
/// resource target is the session's own location and workspace — the same
/// pair `require_permission_for_session` already scopes on. The answer
/// is the composite the authorization model asks for: the spec-0048
/// branch/workspace check AND the ADR #47 resource-coverage check on
/// `session.store_id`. Legacy users without an assignment row are not
/// scope-restricted (ruling 5), mirroring the gates bit-for-bit.
///
/// # Errors
///
/// Returns [`BridgeError::Invalid`] for an unknown feature key and
/// [`BridgeError::Core`] when the assignment lookup fails.
pub fn load_feature_verdict(
    db: &rusqlite::Connection,
    user_id: &str,
    feature_key: &str,
    branch: &str,
    workspace: &str,
) -> Result<FeatureVerdict, BridgeError> {
    // Fail closed on unknown keys: never resolve to "available".
    let feature = AvailabilityFeature::parse(feature_key).ok_or_else(|| {
        BridgeError::Invalid(format!(
            "unknown feature key {feature_key:?} — see oz_core::availability::AvailabilityFeature"
        ))
    })?;

    let store = Store::new(db);
    let loaded = load_subscription_for_verdict(db);
    // One read model for the whole verdict (Phase A): tier, state, and
    // usage come from the same `Entitlements` shape the caps projection
    // uses, so a verdict cannot contradict the payload beside it. The dev
    // upgrade is the same named helper caps applies — only a genuinely
    // active Free row is promoted (no-op in release builds).
    let mut ent = loaded
        .as_ref()
        .map(|sub| Entitlements::from_subscription(sub, gather_usage(&store)))
        .unwrap_or_else(|| Entitlements::fail_closed(UsageCounts::default()));
    ent.apply_debug_upgrade();

    // Soft role check through the same authorize path the hard gates use —
    // a denial here is DIAGNOSED (reason `role`), not thrown.
    let role_granted = store
        .require_permission(user_id, gate_permission(feature))
        .is_ok();

    let server_grant = server_grant_for(feature, loaded.as_ref());
    let permission = gate_permission(feature);

    // Scope axis, evaluated with the same primitives the hard gates use so
    // a scope denial here is exactly the gate's answer for the caller's own
    // context. Composite per the ADR #47 model: the 0048 branch/workspace
    // check (require_permission_scoped runs it) AND the hierarchical
    // resource-coverage check on the session location
    // (require_permission_for_session_resource layers it).
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

    // ADR #47 v1 scope ruling (current-location): Some(true) = the
    // caller's assignment covers where they stand, Some(false) = the
    // assignment excludes the session's location/context, None = no
    // assignment row (ruling 5: not scope-restricted).
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

/// Read the tenant's subscription capabilities and current usage.
///
/// Like `crate::commands::license::get_license_status` (desktop side), this
/// is a local read — no network call — so the gates render immediately from
/// the bootstrap/activated subscription row.
///
/// # Errors
///
/// Returns [`BridgeError::Core`] when the global identity DB cannot be read.
pub async fn get_subscription_capabilities(
    ctx: &BridgeCtx<'_>,
) -> Result<SubscriptionCapabilitiesDto, BridgeError> {
    let db = ctx.lock_global().await;
    let dto = load_capabilities(&db);
    drop(db);
    dto
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
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for an unknown token,
/// [`BridgeError::PermissionDenied`] when `settings:read` is missing,
/// [`BridgeError::Invalid`] for an unknown feature key, and
/// [`BridgeError::Core`] on DB errors.
pub async fn explain_feature_availability_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    feature: &str,
) -> Result<FeatureVerdict, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::SETTINGS_READ)
        .await?;
    let db = ctx.lock_global().await;
    load_feature_verdict(
        &db,
        &session.user_id,
        feature,
        &session.store_id,
        &session.type_key,
    )
}

/// The tenant-level over-quota assessment for the owner-facing
/// remediation view (todo-global-saas-2.md §J downgrade item): which
/// resources exceed the effective tier's quota and by how much.
///
/// Read-only, no mutation — the view offers archive-or-upgrade actions
/// that live in their own features; this command only reports. Fails
/// closed exactly like the caps command: an unreadable row projects the
/// Free tier's quotas, which is the honest answer for a lapsed
/// subscription. Gated `settings:read` — a diagnostics read that echoes
/// quota numbers, like the verdict command.
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for an unknown token,
/// [`BridgeError::PermissionDenied`] when `settings:read` is missing, and
/// [`BridgeError::Core`] / [`BridgeError::Internal`] on DB faults.
pub async fn get_over_quota_report(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<OverQuotaReport, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::SETTINGS_READ)
        .await?;
    compute_over_quota_report(ctx).await
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
///
/// # Errors
///
/// Identical to [`get_over_quota_report`].
pub async fn get_over_quota_report_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<OverQuotaReport, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::SETTINGS_READ)
        .await?;
    compute_over_quota_report(ctx).await
}

/// The shared production body of both over-quota commands, split out so
/// the scoped and unscoped twins cannot drift (the same pattern
/// `load_over_quota_report` uses for the synchronous half).
async fn compute_over_quota_report(ctx: &BridgeCtx<'_>) -> Result<OverQuotaReport, BridgeError> {
    // The global guard is dropped before the fan-out below, which opens other
    // databases. Holding it across those opens is the hazard this file's own
    // comments warn about elsewhere (a MutexGuard held across work that can
    // block), and the location list is all the global DB is needed for.
    let (mut report, tier, locations) = {
        let db = ctx.lock_global().await;
        let (report, tier) = load_over_quota_report(&db)?;
        let locations: Vec<(String, String)> = Store::new(&db)
            .list_locations()?
            .into_iter()
            .map(|l| (l.id, l.name))
            .collect();
        Ok::<_, BridgeError>((report, tier, locations))
    }?;
    report.markers.extend(per_location_over_quota_rows(
        &locations,
        ctx.db_manager,
        &tier,
    )?);
    Ok(report)
}

/// The synchronous body of the over-quota report, split out so the
/// tests exercise the exact production path. Returns the effective tier
/// alongside the report so the per-location fan-out is not forced to
/// re-derive entitlements a second time.
///
/// # Errors
///
/// Returns [`BridgeError::Core`] when the marker refresh or the downgrade
/// assessment cannot read the global DB.
pub fn load_over_quota_report(
    db: &rusqlite::Connection,
) -> Result<(OverQuotaReport, SubscriptionTier), BridgeError> {
    let store = Store::new(db);
    // The effective tier is what the gates enforce — assess against it,
    // not the nominal tier, so the report matches the next rejection.
    let ent = build_entitlements(&store, gather_usage(&store), false);
    // Refresh (and return) the persisted over-quota markers so the report the
    // owner view renders is always in step with the live counts (Slice C §J).
    let markers = store.persist_over_quota_markers()?;
    let mut report = store.assess_downgrade(&ent.tier)?;
    report.markers = markers;
    Ok((report, ent.tier))
}
/// §J B3: per-location over-quota rows for KDS screens and warehouses.
///
/// # Why this is a fan-out and not one grouped query
///
/// `workspace_instances` carries a `location_id`, so a
/// `GROUP BY location_id` looks like the obvious single query — but it would
/// run against the wrong database. Every store connection is migrated with the
/// SAME `oz_core::migrations::ALL` list (`AppState` builds
/// `StoreDatabaseManager::new(dir, oz_core::migrations::ALL)`), and the
/// production writers and readers both use a STORE handle:
/// `create_workspace_instance_scoped` inserts via `open_store(&session.store_id)`,
/// `list_workspaces_scoped` reads via `open_store(&session.store_id)`, and
/// `enforce_instance_quota` counts via the same. The global DB's copy of the
/// table is therefore empty for these purposes, so a grouped query on it would
/// report no location as over quota — a clean bill of health invented out of
/// thin air. The counts have to be read where they are written: one visit per
/// store database.
///
/// # Reads never create
///
/// `StoreDatabaseManager::open_store` CREATES the database file when it is
/// missing. This is a read path reached by opening a settings screen, so a
/// location whose database does not exist yet is SKIPPED rather than opened.
/// The skip is honest, not lossy: a store with no database has no instances by
/// construction, so there is nothing it could be over quota on. Minting a
/// database as a side effect of a page view would also be inconsistent with the
/// rule this slice already applies to `store_id` input — a remediation that
/// looks finished at 0 is the failure shape to avoid.
///
/// # What each row means
/// Only rows that are over or at a finite cap are emitted, mirroring the
/// tenant-global writer's rule that an absent marker means "fine". An unlimited
/// cap (`None`) never produces a row. `resource_id` is the store id, so the
/// owner-facing row carries the target its action needs; `dimension` is
/// `kds_screens` for KDS (a per-location dimension that deliberately has no
/// tenant-global usage row) and `warehouses` for warehouse instances, whose
/// dimension IS tenant-global — the per-location row refines it, it does not
/// contradict the aggregate above it. The third row is the topology-node
/// aggregate (`topology_nodes`, also absent from `DIMENSION_ORDER`): the
/// store's non-archived instance count against the SUM of the finite
/// per-location caps, over the moment at least one instance had to be
/// quota-suspended. Read-computed marker only — it is never persisted and
/// the creation gates refuse the dimension.
///
/// # Errors
///
/// Returns [`BridgeError::Internal`] when a store database that exists cannot
/// be opened or locked; an unreadable store is skipped, never fatal.
pub fn per_location_over_quota_rows(
    locations: &[(String, String)],
    manager: &StoreDatabaseManager,
    tier: &SubscriptionTier,
) -> Result<Vec<OverQuotaMarker>, BridgeError> {
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let mut rows = Vec::new();
    for (store_id, _name) in locations {
        if !manager.store_db_exists(store_id) {
            continue;
        }
        let conn = manager
            .open_store(store_id)
            .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
        let db = conn
            .lock()
            .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
        let store = Store::new(&db);
        // A store database that fails to answer is skipped rather than
        // aborting the whole report: one unreadable location must not hide the
        // others. The trade is stated rather than hidden — a skipped store can
        // under-report, which is why the error is logged.
        let (kds, warehouses, nodes, suspended) = match (
            store.count_active_kds_instances(store_id),
            store.count_active_warehouse_instances(store_id),
            store.count_topology_nodes(store_id),
            store.count_quota_suspended_instances(store_id),
        ) {
            (Ok(k), Ok(w), Ok(n), Ok(s)) => (k, w, n, s),
            (Err(e), _, _, _) | (_, Err(e), _, _) | (_, _, Err(e), _) | (_, _, _, Err(e)) => {
                tracing::warn!(store_id = %store_id, error = %e, "per-location quota dims: store skipped");
                continue;
            }
        };
        push_dim_row(
            &mut rows,
            &now,
            store_id,
            "kds_screen",
            QuotaDimension::KdsScreens,
            tier.max_kds_screens(),
            kds,
            0,
        );
        push_dim_row(
            &mut rows,
            &now,
            store_id,
            "warehouse",
            QuotaDimension::Warehouses,
            tier.max_warehouses(),
            warehouses,
            0,
        );
        // D61 owner ruling: topology nodes are a marker-only dimension
        // riding the EXISTING per-location caps — there is no tier cap for
        // the aggregate, so the limit is the SUM of the finite ones. When
        // every cap is unlimited there is no constraint to violate and no
        // honest row: None suppresses the row entirely (also suppressing
        // the suspension signal, which cannot arise on a tier that never
        // capped anything).
        let caps = [
            tier.max_pos_instances(),
            tier.max_warehouses(),
            tier.max_kds_screens(),
        ];
        let topology_limit = if caps.iter().all(Option::is_none) {
            None
        } else {
            Some(caps.iter().filter_map(|&c| c).sum())
        };
        push_dim_row(
            &mut rows,
            &now,
            store_id,
            "topology_node",
            QuotaDimension::TopologyNodes,
            topology_limit,
            nodes,
            suspended,
        );
    }
    Ok(rows)
}

/// Emit one per-location marker row when `current` is over or exactly at a
/// finite `limit`, or when `suspended` is non-zero: a quota suspension IS an
/// over-quota verdict — the system had to park instances to admit new ones —
/// and it can outlive the over-quota state itself (a tier upgrade raises the
/// cap while the suspended instances stay parked until restored). Shared by
/// all three dims so the over/at/none decision exists once; the KDS and
/// warehouse rows have no suspension semantics of their own and pass 0.
#[allow(clippy::too_many_arguments)]
pub fn push_dim_row(
    rows: &mut Vec<OverQuotaMarker>,
    now: &str,
    store_id: &str,
    resource_type: &str,
    dimension: QuotaDimension,
    limit: Option<i64>,
    current: i64,
    suspended: i64,
) {
    let Some(limit) = limit else { return };
    let severity = if suspended > 0 || current > limit {
        OverQuotaSeverity::Over
    } else if current == limit {
        OverQuotaSeverity::At
    } else {
        return;
    };
    rows.push(OverQuotaMarker {
        resource_id: store_id.to_string(),
        resource_type: resource_type.to_string(),
        dimension,
        severity,
        limit: Some(limit),
        current,
        marked_at: now.to_string(),
    });
}

#[cfg(test)]
#[path = "subscription_tests.rs"]
mod subscription_tests;
