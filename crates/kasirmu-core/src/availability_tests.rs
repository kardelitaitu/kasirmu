//! Exhaustive precedence coverage for the availability resolver.
//!
//! The interesting property is not "does each source deny when it should"
//! but "when several deny at once, is the NAMED one the highest-precedence
//! one" — that ranking is the whole point of the surface, and it is exactly
//! what a hand-rolled per-site gate gets wrong.
//!
//! Strategy: each [`Case`] pairs a feature with a tier that grants it and a
//! tier that withholds it, so the `tier` source is a real knob rather than a
//! side effect of the base configuration. The test first probes which
//! sources are ABLE to deny that case at all (`tier` and `quota` are
//! mutually exclusive by feature kind, so the set differs per case), then
//! asserts over every non-empty subset of that set that the winner is the
//! precedence-minimum. The oracle is the probe, not a re-implementation of
//! the resolver, so the two cannot agree by sharing a bug.

use super::{
    AvailabilityFacts, AvailabilityFeature, AvailabilityReason, FeatureVerdict, UsageCounts,
    explain_availability,
};
use crate::entitlements::Entitlements;
use crate::subscription::{SubscriptionLifecycleState, SubscriptionTier, TenantSubscription};

/// A probe case: one feature plus the tiers that grant and withhold it.
///
/// `withholding` only differs from `granting` where the tier can actually
/// gate the feature — quota families have no tier boolean and the history
/// window has no zero-day tier, so those cases keep one tier for both.
struct Case {
    feature: AvailabilityFeature,
    granting: &'static SubscriptionTier,
    withholding: &'static SubscriptionTier,
    label: &'static str,
}

/// Every v1 feature paired with tiers that make each of its sources probeable.
fn cases() -> Vec<Case> {
    use AvailabilityFeature as F;
    let tier_flag = [
        F::Qris,
        F::Analytics,
        F::Loyalty,
        F::DailyDashboard,
        F::CloudSync,
    ];
    let quota = [F::Locations, F::StaffUsers, F::PosInstances, F::Warehouses];
    let mut out = Vec::new();
    for f in tier_flag {
        // Enterprise grants every flag; Free withholds most of them.
        out.push(Case {
            feature: f,
            granting: &SubscriptionTier::Enterprise,
            withholding: &SubscriptionTier::Free,
            label: "enterprise/free",
        });
    }
    for f in quota {
        // Free supplies a finite limit so the quota knob has something to
        // reach; the tier source cannot deny a quota family at any tier.
        //
        // Warehouses are the exception. Their only finite cap is 0, on the
        // tiers that do not include the workspace at all (Free/Plus/Pro), and
        // a 0 cap is already reached at zero usage — there is no "one below
        // the limit" state to probe. So the warehouse case baselines on
        // Premium (unlimited, so the clean ground is available) against a Free
        // withholding tier, and its quota arm is pinned separately by
        // `warehouse_quota_denies_on_every_tier_that_does_not_include_it`.
        let warehouse = f == F::Warehouses;
        out.push(Case {
            feature: f,
            granting: if warehouse {
                &SubscriptionTier::Premium
            } else {
                &SubscriptionTier::Free
            },
            // Also Premium for warehouses, NOT Free. The probe infers "this
            // source is able to deny" from a single-source denial, so the
            // withholding tier must not itself fail the quota arm: on Free the
            // 0 warehouse cap already denies, which would make the Tier probe
            // come back unavailable for a reason that is not Tier at all.
            // (Quota families are never denied by the tier flag anyway —
            // `tier_allows` answers true for all four — so this arm is inert
            // for every quota case and only the confounding matters.)
            withholding: if warehouse {
                &SubscriptionTier::Premium
            } else {
                &SubscriptionTier::Free
            },
            label: if warehouse { "premium" } else { "free" },
        });
    }
    out.push(Case {
        feature: F::SalesHistoryDays,
        granting: &SubscriptionTier::Enterprise,
        withholding: &SubscriptionTier::Enterprise,
        label: "enterprise",
    });
    out
}

/// Look up one case by feature.
fn case_for(feature: AvailabilityFeature) -> Case {
    cases()
        .into_iter()
        .find(|c| c.feature == feature)
        .unwrap_or_else(|| panic!("no case for {}", feature.as_str()))
}

/// Build facts in which exactly the listed sources are set to deny.
fn facts_with(case: &Case, deniers: &[AvailabilityReason]) -> AvailabilityFacts<'static> {
    let has = |r: AvailabilityReason| deniers.contains(&r);
    let tier = if has(AvailabilityReason::Tier) {
        case.withholding
    } else {
        case.granting
    };
    AvailabilityFacts {
        feature: case.feature,
        tier,
        state: if has(AvailabilityReason::Lifecycle) {
            SubscriptionLifecycleState::Expired
        } else {
            SubscriptionLifecycleState::Active
        },
        usage: if has(AvailabilityReason::Quota) {
            UsageCounts {
                locations: i64::MAX,
                staff_users: i64::MAX,
                pos_instances: i64::MAX,
                warehouses: i64::MAX,
            }
        } else {
            UsageCounts::default()
        },
        server_grant: if has(AvailabilityReason::ServerPolicy) {
            Some(false)
        } else {
            None
        },
        role_granted: !has(AvailabilityReason::Role),
        scope_granted: if has(AvailabilityReason::Scope) {
            Some(false)
        } else {
            None
        },
        permission: None,
        expires_at: None,
        grace_until: None,
    }
}

/// Sources that flip this case to unavailable when set alone.
fn deniable_sources(case: &Case) -> Vec<AvailabilityReason> {
    AvailabilityReason::PRECEDENCE
        .iter()
        .copied()
        .filter(|r| !explain_availability(&facts_with(case, &[*r])).available)
        .collect()
}

/// Position in the precedence table — lower is stronger.
fn rank(r: AvailabilityReason) -> usize {
    AvailabilityReason::PRECEDENCE
        .iter()
        .position(|p| *p == r)
        .unwrap_or(usize::MAX)
}

/// Every non-empty subset of `sources`, as a denial set to apply.
fn subsets(sources: &[AvailabilityReason]) -> Vec<Vec<AvailabilityReason>> {
    let n = sources.len();
    let mut out = Vec::new();
    for mask in 1u32..(1 << n) {
        out.push(
            (0..n)
                .filter(|i| mask & (1 << i) != 0)
                .map(|i| sources[i])
                .collect(),
        );
    }
    out
}

/// Assert the winner is the precedence-minimum for every denial combination.
fn check_case(case: &Case) {
    let clean = explain_availability(&facts_with(case, &[]));
    assert!(
        clean.available,
        "{} on {}: unavailable with no denials — the case is not a clean probe ground",
        case.feature.as_str(),
        case.label
    );
    let sources = deniable_sources(case);
    assert!(
        sources.len() >= 4,
        "{} on {}: expected at least four probeable sources, got {:?}",
        case.feature.as_str(),
        case.label,
        sources
    );

    for set in subsets(&sources) {
        let expected = *set
            .iter()
            .min_by_key(|r| rank(**r))
            .expect("non-empty subset");
        let verdict = explain_availability(&facts_with(case, &set));
        assert!(
            !verdict.available,
            "{} on {}: denial set {:?} reported available",
            case.feature.as_str(),
            case.label,
            set
        );
        assert_eq!(
            verdict.reason,
            Some(expected),
            "{} on {}: denial set {:?} named {:?}, expected {:?}",
            case.feature.as_str(),
            case.label,
            set,
            verdict.reason,
            expected
        );
    }
}

#[test]
fn precedence_holds_for_every_feature_and_denial_combination() {
    let all = cases();
    assert_eq!(
        all.len(),
        AvailabilityFeature::ALL.len(),
        "every v1 key must be covered"
    );
    for case in &all {
        check_case(case);
    }
}

#[test]
fn every_v1_key_round_trips_through_parse() {
    for feature in AvailabilityFeature::ALL {
        assert_eq!(AvailabilityFeature::parse(feature.as_str()), Some(feature));
    }
    assert_eq!(AvailabilityFeature::ALL.len(), 10);
}

#[test]
fn parse_rejects_unknown_keys_rather_than_defaulting_open() {
    for key in [
        "",
        "analytics",
        "max_stores",
        "Supports_Qris",
        "supports_qris ",
        "role_assignments",
    ] {
        assert_eq!(
            AvailabilityFeature::parse(key),
            None,
            "{key} must not parse"
        );
    }
}

#[test]
fn warehouse_quota_denies_on_every_tier_that_does_not_include_it() {
    // Owner ruling 2026-09-29 (matching the website's pricing row): the
    // warehouse workspace is Premium and up, so every lower tier carries a
    // ZERO warehouse cap. A zero cap is reached at zero usage, which means the
    // quota arm denies before a single warehouse exists — and it denies as
    // `Quota`, not `Tier`, because quota families have no tier boolean.
    for tier in [
        SubscriptionTier::Free,
        SubscriptionTier::Plus,
        SubscriptionTier::Pro,
    ] {
        let facts = AvailabilityFacts::baseline(AvailabilityFeature::Warehouses, &tier);
        assert_eq!(facts.usage.warehouses, 0);
        let verdict = explain_availability(&facts);
        assert!(!verdict.available, "{tier:?} must not offer warehouses");
        assert_eq!(
            verdict.reason,
            Some(AvailabilityReason::Quota),
            "{tier:?} denies warehouses through the zero cap, not the tier flag"
        );
        assert_eq!(verdict.detail.limit, Some(0));
    }
    // Premium and Enterprise are unlimited: no count can deny them, and the
    // clean-ground probe the precedence walk uses depends on that.
    for tier in [SubscriptionTier::Premium, SubscriptionTier::Enterprise] {
        let mut facts = AvailabilityFacts::baseline(AvailabilityFeature::Warehouses, &tier);
        facts.usage.warehouses = i64::MAX;
        assert!(
            explain_availability(&facts).available,
            "{tier:?} must allow warehouses at any count"
        );
    }
}

#[test]
fn tier_and_quota_are_mutually_exclusive_by_feature_kind() {
    // The structural reason each case's denial set differs: a boolean flag has
    // no usage to compare, and a quota family has no tier boolean.
    let flag = deniable_sources(&case_for(AvailabilityFeature::Analytics));
    assert!(flag.contains(&AvailabilityReason::Tier));
    assert!(!flag.contains(&AvailabilityReason::Quota));

    let quota = deniable_sources(&case_for(AvailabilityFeature::Locations));
    assert!(quota.contains(&AvailabilityReason::Quota));
    assert!(!quota.contains(&AvailabilityReason::Tier));
}

#[test]
fn scope_never_outranks_role() {
    // The ordering rationale made executable: with both denying, the answer
    // must name the permission, not a location the caller cannot act on.
    let case = case_for(AvailabilityFeature::Analytics);
    let v = explain_availability(&facts_with(
        &case,
        &[AvailabilityReason::Role, AvailabilityReason::Scope],
    ));
    assert_eq!(v.reason, Some(AvailabilityReason::Role));
}

#[test]
fn lifecycle_outranks_tier_even_though_expiry_also_downgrades_the_tier() {
    let case = case_for(AvailabilityFeature::Analytics);
    let v = explain_availability(&facts_with(
        &case,
        &[AvailabilityReason::Lifecycle, AvailabilityReason::Tier],
    ));
    assert_eq!(v.reason, Some(AvailabilityReason::Lifecycle));
}

#[test]
fn revoked_denies_availability_exactly_like_canceled_does() {
    // ADR #58 §2.1's required audit at this site. `explain_availability`
    // computes `lifecycle_denies = !matches!(state, Active | Grace)` — an
    // ALLOW-LIST, so the new `Revoked` variant falls into the denying branch
    // with NO compile error, no warning and no other test failure. That silence
    // is what this case exists to break: it pins the answer the ADR requires
    // rather than letting the variant inherit it unobserved.
    //
    // The answer is intended, not incidental: a revoked tenant must not be
    // `available` for any feature, and grouping it with `Canceled` here is
    // correct because both are lifecycle denials — the difference between them
    // is what they do to the TIER and the SESSION (ADR #58 §2.2), not whether
    // they pass this predicate.
    let case = case_for(AvailabilityFeature::Analytics);
    for state in [
        SubscriptionLifecycleState::Revoked,
        SubscriptionLifecycleState::Canceled,
    ] {
        let mut facts = facts_with(&case, &[AvailabilityReason::Lifecycle]);
        facts.state = state.clone();
        let verdict = explain_availability(&facts);
        assert!(
            !verdict.available,
            "{state:?} must deny availability at the lifecycle arm"
        );
        assert_eq!(
            verdict.reason,
            Some(AvailabilityReason::Lifecycle),
            "{state:?} must deny for the LIFECYCLE reason, not a lower-precedence one"
        );
    }
}

#[test]
fn server_grant_suppresses_only_the_tier_check() {
    let case = case_for(AvailabilityFeature::Analytics);
    // An add-on grant answers "your plan lacks it" — the analytics-on-Plus
    // path — so it must clear the tier denial.
    let mut granted = facts_with(&case, &[AvailabilityReason::Tier]);
    granted.server_grant = Some(true);
    assert!(explain_availability(&granted).available);

    // But a grant cannot out-vote an expired subscription or a missing role.
    granted.state = SubscriptionLifecycleState::Expired;
    assert_eq!(
        explain_availability(&granted).reason,
        Some(AvailabilityReason::Lifecycle)
    );
    granted.state = SubscriptionLifecycleState::Active;
    granted.role_granted = false;
    assert_eq!(
        explain_availability(&granted).reason,
        Some(AvailabilityReason::Role)
    );
}

#[test]
fn absent_scope_target_cannot_win_precedence() {
    // scope_granted None means "no resource in this question" — skipped, not
    // read as a denial.
    let case = case_for(AvailabilityFeature::Analytics);
    let v = explain_availability(&facts_with(&case, &[AvailabilityReason::Role]));
    assert_eq!(v.reason, Some(AvailabilityReason::Role));
    assert!(explain_availability(&facts_with(&case, &[])).available);
}

#[test]
fn quota_denies_at_the_boundary_and_not_one_below() {
    let tier = SubscriptionTier::Free;
    let limit = AvailabilityFeature::Locations
        .tier_limit(&tier)
        .expect("Free caps locations");
    let mut at_limit = AvailabilityFacts::baseline(AvailabilityFeature::Locations, &tier);
    at_limit.usage.locations = limit;
    assert!(!explain_availability(&at_limit).available);

    let mut one_below = AvailabilityFacts::baseline(AvailabilityFeature::Locations, &tier);
    one_below.usage.locations = limit - 1;
    assert!(explain_availability(&one_below).available);
}

#[test]
fn unlimited_quota_never_denies_however_great_the_usage() {
    let tier = SubscriptionTier::Enterprise;
    let mut f = AvailabilityFacts::baseline(AvailabilityFeature::Locations, &tier);
    f.usage.locations = i64::MAX;
    assert!(
        explain_availability(&f).available,
        "Enterprise locations must be unlimited"
    );
}

#[test]
fn detail_keeps_rendering_the_lower_cause_when_a_higher_one_wins() {
    let tier = SubscriptionTier::Free;
    let mut f = AvailabilityFacts::baseline(AvailabilityFeature::Locations, &tier);
    f.state = SubscriptionLifecycleState::Expired;
    f.usage.locations = i64::MAX;
    f.permission = Some("topology:write");
    f.expires_at = Some("2026-09-01T00:00:00Z");
    f.grace_until = Some("2026-09-15T00:00:00Z");
    let v: FeatureVerdict = explain_availability(&f);
    // Lifecycle outranks quota, but the UI still gets the numbers it needs.
    assert_eq!(v.reason, Some(AvailabilityReason::Lifecycle));
    assert_eq!(v.feature, "locations");
    assert_eq!(v.detail.tier, "free");
    assert_eq!(v.detail.state, "expired");
    assert_eq!(v.detail.usage, Some(i64::MAX));
    assert!(v.detail.limit.is_some());
    assert_eq!(v.detail.permission.as_deref(), Some("topology:write"));
    assert_eq!(v.detail.expires_at.as_deref(), Some("2026-09-01T00:00:00Z"));
    assert_eq!(
        v.detail.grace_until.as_deref(),
        Some("2026-09-15T00:00:00Z")
    );
}

#[test]
fn reason_code_matches_the_wire_table() {
    let expected = [
        (AvailabilityReason::ServerPolicy, "server_policy"),
        (AvailabilityReason::Lifecycle, "lifecycle"),
        (AvailabilityReason::Tier, "tier"),
        (AvailabilityReason::Quota, "quota"),
        (AvailabilityReason::Role, "role"),
        (AvailabilityReason::Scope, "scope"),
    ];
    for (reason, code) in expected {
        assert_eq!(reason.as_str(), code);
    }
    let case = case_for(AvailabilityFeature::Analytics);
    let v = explain_availability(&facts_with(&case, &[AvailabilityReason::Scope]));
    assert_eq!(v.reason_code(), Some("scope"));
    assert_eq!(
        explain_availability(&facts_with(&case, &[])).reason_code(),
        None
    );
}

#[test]
fn verdict_serializes_camel_case_for_the_ipc_wire() {
    let case = case_for(AvailabilityFeature::Analytics);
    let v = explain_availability(&facts_with(&case, &[AvailabilityReason::Role]));
    let json = serde_json::to_value(&v).expect("verdict serializes");
    assert_eq!(json["feature"], "supports_analytics");
    assert_eq!(json["available"], false);
    assert_eq!(json["reason"], "role");
    let detail = json.get("detail").expect("detail present");
    assert_eq!(detail["tier"], "enterprise");
    assert_eq!(detail["state"], "active");
    assert!(
        detail.get("expiresAt").is_some() && detail.get("graceUntil").is_some(),
        "detail keys must be camelCase, got {detail}"
    );
}
/// The one shared predicate behind the lifecycle arm: every state is either
/// explicitly flowing or explicitly denied, and no variant is left to inherit
/// an answer silently.
///
/// `explain_availability`'s `lifecycle_denies` and
/// `Entitlements::addon_grant_flows` are two consumers of ONE decision, and
/// before `grants_entitlements` each wrote the set `{Active, Grace}` out
/// separately. An allow-list absorbs a new enum variant with no compile error,
/// so a future `SubscriptionLifecycleState` would have inherited "denied" in
/// both places without anyone choosing it — the hazard
/// `revoked_denies_availability_exactly_like_canceled_does` already documents
/// for one variant. This walks ALL of them.
#[test]
fn every_lifecycle_state_declares_whether_it_grants_entitlements() {
    // Named one by one, so adding a variant is a compile error HERE rather
    // than a silently-passing test.
    let all = [
        SubscriptionLifecycleState::Active,
        SubscriptionLifecycleState::Grace,
        SubscriptionLifecycleState::Expired,
        SubscriptionLifecycleState::Canceled,
        SubscriptionLifecycleState::Revoked,
        SubscriptionLifecycleState::Paused,
        SubscriptionLifecycleState::Unavailable,
    ];
    let flowing: Vec<&str> = all
        .iter()
        .filter(|s| s.grants_entitlements())
        .map(super::super::subscription::SubscriptionLifecycleState::as_str)
        .collect();
    assert_eq!(
        flowing,
        vec!["active", "grace"],
        "a state changing sides here changes what every gate in the app allows",
    );

    // Each consumer must agree with it, because agreeing is why it exists.
    for state in all {
        // The COLUMN vocabulary, not `as_str()` (the wire form): the reader
        // matches the server's status strings and `Grace` is `grace_period`
        // there. See `lifecycle_state_as_str_is_the_wire_form_not_the_status_
        // column_vocabulary`.
        let column_status = match &state {
            SubscriptionLifecycleState::Grace => "grace_period",
            other => other.as_str(),
        };
        let sub = TenantSubscription {
            tenant_id: "default".into(),
            tier: SubscriptionTier::Premium,
            status: column_status.into(),
            expires_at: Some((chrono::Utc::now() + chrono::Duration::days(30)).to_rfc3339()),
            max_locations: 99,
            max_pos_instances: 99,
            allowed_types_json: "[]".into(),
            signature: String::new(),
            signed_payload: String::new(),
            api_key: String::new(),
            updated_at: String::new(),
        };
        let ent = Entitlements::from_subscription(&sub, UsageCounts::default());
        assert_eq!(
            ent.addon_grant_flows(),
            state.grants_entitlements(),
            "Entitlements and the shared predicate disagree about {state:?}",
        );
    }
}
