use super::*;
use crate::availability::AvailabilityFeature;
use crate::db::Store;
use crate::downgrade::QuotaDimension;
use crate::migrations;
use crate::subscription::SubscriptionTier;

fn fresh_db() -> rusqlite::Connection {
    migrations::fresh_db()
}

/// Every tier's caps projection must equal the one limit table
/// (Phase B correspondence, pinned from the read-model side): a
/// tier-limit change surfaces identically in a gate rejection, an
/// `OverQuotaReport` row, and a caps payload.
#[test]
fn limits_match_the_one_limit_table_for_every_tier() {
    let tiers = [
        SubscriptionTier::Free,
        SubscriptionTier::Plus,
        SubscriptionTier::Pro,
        SubscriptionTier::Premium,
        SubscriptionTier::Enterprise,
    ];
    for tier in tiers {
        let e = Entitlements {
            tier: tier.clone(),
            state: SubscriptionLifecycleState::Active,
            loaded: true,
            addons: Vec::new(),
            usage: UsageCounts::default(),
        };
        assert_eq!(
            e.max_locations(),
            QuotaDimension::Locations.limit_for(&tier)
        );
        assert_eq!(
            e.max_pos_instances(),
            QuotaDimension::PosRegisters.limit_for(&tier)
        );
        assert_eq!(
            e.max_warehouses(),
            QuotaDimension::Warehouses.limit_for(&tier)
        );
        assert_eq!(e.max_staff_users(), QuotaDimension::Staff.limit_for(&tier));
        // And the table itself must still agree with the tier accessors —
        // the identity the five gates now route through.
        assert_eq!(
            QuotaDimension::Locations.limit_for(&tier),
            tier.max_locations()
        );
        assert_eq!(
            QuotaDimension::PosRegisters.limit_for(&tier),
            tier.max_pos_instances()
        );
        assert_eq!(
            QuotaDimension::Warehouses.limit_for(&tier),
            tier.max_warehouses()
        );
        assert_eq!(
            QuotaDimension::Staff.limit_for(&tier),
            tier.max_staff_users()
        );
        assert_eq!(
            QuotaDimension::Products.limit_for(&tier),
            tier.max_products()
        );
    }
}

/// The fail-closed projection is exactly what the caps commands have
/// always produced for an unreadable row: Free entitlements on
/// `unavailable`, no add-ons, `loaded: false` — not an error.
#[test]
fn fail_closed_projects_free_unavailable() {
    let e = Entitlements::fail_closed(UsageCounts::default());
    assert_eq!(e.tier, SubscriptionTier::Free);
    assert_eq!(e.state, SubscriptionLifecycleState::Unavailable);
    assert!(!e.loaded);
    assert!(e.addons.is_empty());
    assert!(!e.supports_qris());
    assert!(!e.supports_analytics());
    assert!(!e.supports_loyalty());
    assert!(!e.supports_cloud_sync());
    assert_eq!(e.max_locations(), SubscriptionTier::Free.max_locations());
}

/// An active row projects the tier's own answers with the usage counts
/// passed in (usage identity: what the caller gathers is what the
/// projections report).
#[test]
fn active_row_projects_tier_answers_and_usage_identity() {
    let conn = fresh_db();
    let usage = UsageCounts {
        locations: 1,
        staff_users: 3,
        pos_instances: 2,
        warehouses: 1,
    };
    let e = build_entitlements(&Store::new(&conn), usage, false);
    // fresh_db seeds a signed active Free row.
    assert!(e.loaded);
    assert_eq!(e.state, SubscriptionLifecycleState::Active);
    assert_eq!(e.tier, SubscriptionTier::Free);
    assert_eq!(e.usage, usage, "usage identity: in == out");
    assert_eq!(
        e.offline_grace_days(),
        SubscriptionTier::Free.offline_grace_days()
    );
    assert_eq!(
        e.sales_history_days(),
        SubscriptionTier::Free.sales_history_days()
    );
}

/// The analytics add-on flows only while the subscription is active or
/// in grace — an expired row with the same payload keeps the downgraded
/// answer (the caps commands' C4.3 rule, now on the read model).
#[test]
fn analytics_addon_flows_only_while_active_or_grace() {
    let conn = fresh_db();
    conn.execute(
        "UPDATE tenant_subscription SET signed_payload = ?1 WHERE tenant_id = 'default'",
        [r#"{"addons":["advanced_analytics"]}"#],
    )
    .unwrap();
    let e = build_entitlements(&Store::new(&conn), UsageCounts::default(), false);
    // Active Free row + advanced_analytics: the add-on answers analytics
    // even though the Free tier does not.
    assert!(e.supports_analytics(), "active row: addon grant flows");

    // Expire the same row: the grant stops flowing.
    conn.execute(
        "UPDATE tenant_subscription SET status = 'expired' WHERE tenant_id = 'default'",
        [],
    )
    .unwrap();
    let e = build_entitlements(&Store::new(&conn), UsageCounts::default(), false);
    assert_eq!(e.state, SubscriptionLifecycleState::Expired);
    assert!(!e.supports_analytics(), "expired row: addon grant stops");
}

/// The named dev upgrade promotes only a genuinely active Free row;
/// expired/canceled/paused/unavailable rows keep their downgraded
/// entitlements so dev can exercise those paths. In release builds the
/// upgrade is a no-op by definition, so the promote half of this test
/// is debug-only while the not-promoted halves always run.
#[cfg(debug_assertions)]
#[test]
fn debug_upgrade_promotes_only_active_free() {
    let conn = fresh_db();
    let mut e = build_entitlements(&Store::new(&conn), UsageCounts::default(), true);
    assert_eq!(
        e.tier,
        SubscriptionTier::Premium,
        "active Free upgraded in dev"
    );

    // Expired Free is NOT promoted.
    let conn = fresh_db();
    conn.execute(
        "UPDATE tenant_subscription SET status = 'expired' WHERE tenant_id = 'default'",
        [],
    )
    .unwrap();
    let mut e = build_entitlements(&Store::new(&conn), UsageCounts::default(), true);
    e.apply_debug_upgrade();
    assert_eq!(e.tier, SubscriptionTier::Free, "expired row keeps Free");
}

/// `debug_upgrade: false` (the tablet's builder call) never promotes,
/// even in dev — the per-client divergence is a named decision, not an
/// accident of which crate compiled the call.
#[cfg(debug_assertions)]
#[test]
fn builder_without_debug_upgrade_never_promotes() {
    let conn = fresh_db();
    let e = build_entitlements(&Store::new(&conn), UsageCounts::default(), false);
    assert_eq!(
        e.tier,
        SubscriptionTier::Free,
        "tablet path stays on the row tier"
    );
}

/// An unreadable row fails closed through the builder — the projection,
/// not an error, exactly like the caps commands' contract.
#[test]
fn builder_fails_closed_when_the_row_is_missing() {
    let conn = fresh_db();
    conn.execute(
        "DELETE FROM tenant_subscription WHERE tenant_id = 'default'",
        [],
    )
    .unwrap();
    let e = build_entitlements(&Store::new(&conn), UsageCounts::default(), true);
    assert!(!e.loaded);
    assert_eq!(e.state, SubscriptionLifecycleState::Unavailable);
    assert_eq!(e.tier, SubscriptionTier::Free);
}

// ── What the seven correspondence tests do not reach ──────────────────
//
// The shipped suite pins the limit table, the fail-closed projection,
// usage identity, the add-on rule on two of six states, and both
// debug-upgrade decisions. Three things it never touches are exactly the
// ones Phase A's "cannot disagree" claim rests on: the loader's tamper
// arm, the grace half of the add-on predicate, and availability_facts
// itself — the join point, which no test in this file calls.

#[test]
fn a_signature_that_does_not_verify_fails_closed_and_the_upgrade_cannot_resurrect_it() {
    // This is the arm that decides whether a hand-edited subscription row
    // can buy a tier. fresh_db seeds the BOOTSTRAP_FREE sentinel, which
    // verify_license_signature accepts only in debug builds — that is why
    // the add-on test above can rewrite signed_payload and still load.
    // Swap the sentinel for a well-formed but wrong signature and the same
    // payload must stop granting anything, and the desktop's dev upgrade
    // must not promote the corpse: build_entitlements returns fail_closed
    // BEFORE debug_upgrade is consulted, so reordering those two lines
    // would hand an active Free tier to a tampered row.
    let conn = fresh_db();
    conn.execute(
        "UPDATE tenant_subscription
             SET signed_payload = ?1, signature = ?2
             WHERE tenant_id = 'default'",
        rusqlite::params![
            r#"{"tier":"premium","status":"active"}"#,
            "bm90LWEtcmVhbC1zaWduYXR1cmU="
        ],
    )
    .unwrap();

    let e = build_entitlements(&Store::new(&conn), UsageCounts::default(), true);
    assert!(!e.loaded, "an unverifiable row is not a loaded row");
    assert_eq!(e.state, SubscriptionLifecycleState::Unavailable);
    assert_eq!(
        e.tier,
        SubscriptionTier::Free,
        "the dev upgrade promotes a loaded active Free row, never a fail-closed one"
    );
    assert!(
        !e.supports_qris(),
        "no tier answer survives a failed verification"
    );
    assert_eq!(
        e.max_locations(),
        SubscriptionTier::Free.max_locations(),
        "and no quota answer does either"
    );
}

#[test]
fn the_analytics_addon_flows_in_grace_and_stops_in_every_other_terminal_state() {
    // The predicate is matches!(Active | Grace). The shipped test pins
    // Active (flows) and Expired (stops), so Grace — the payment-retry
    // window — is the arm nothing holds up: drop it and a tenant that is
    // mid-retry loses an add-on it paid for while every existing test
    // stays green. The unparsable status is here too, because it maps to
    // Unavailable and must not be swept into the active arm.
    let cases = [
        (
            "grace_period",
            true,
            "grace is a payment-retry window, not a denial",
        ),
        (
            "canceled",
            false,
            "a canceled subscription has no grant to flow",
        ),
        ("revoked", false, "revoked maps to Canceled"),
        ("paused", false, "paused keeps the downgraded answer"),
        (
            "who-knows",
            false,
            "an unparsable status is Unavailable, not Active",
        ),
    ];
    for (status, expected, why) in cases {
        let conn = fresh_db();
        conn.execute(
            "UPDATE tenant_subscription SET signed_payload = ?1 WHERE tenant_id = 'default'",
            [r#"{"addons":["advanced_analytics"]}"#],
        )
        .unwrap();
        conn.execute(
            "UPDATE tenant_subscription SET status = ?1 WHERE tenant_id = 'default'",
            [status],
        )
        .unwrap();

        let e = build_entitlements(&Store::new(&conn), UsageCounts::default(), false);
        assert!(
            e.loaded,
            "{status}: the row still verifies (BOOTSTRAP_FREE)"
        );
        assert_eq!(e.addon_grant_flows(), expected, "{status}: {why}");
        assert_eq!(
            e.supports_analytics(),
            expected,
            "{status}: the analytics answer follows the flow rule, since Free never grants it"
        );
    }
}

#[test]
fn a_verdict_and_the_caps_payload_are_read_from_one_instance() {
    // Phase A's claim is that a verdict and the caps payload beside it
    // cannot disagree, because both come from one Entitlements. Nothing
    // called availability_facts until now, so the join was convention.
    // It matters most on desktop, which applies the dev upgrade between
    // loading the row and gathering the facts: gather from the raw row and
    // project from the upgraded instance, and the two surfaces split.
    let conn = fresh_db();
    let usage = UsageCounts {
        locations: 4,
        staff_users: 2,
        pos_instances: 1,
        warehouses: 3,
    };
    let e = build_entitlements(&Store::new(&conn), usage, true);
    let facts = e.availability_facts(
        AvailabilityFeature::Locations,
        true,
        None,
        Some("topology:write"),
        None,
        Some("2027-01-01T00:00:00Z"),
        None,
    );

    // Every limit the caps DTO projects must equal the table read at the
    // tier the resolver is actually holding.
    assert_eq!(facts.tier, &e.tier);
    assert_eq!(
        e.max_locations(),
        QuotaDimension::Locations.limit_for(facts.tier)
    );
    assert_eq!(
        e.max_pos_instances(),
        QuotaDimension::PosRegisters.limit_for(facts.tier)
    );
    assert_eq!(
        e.max_warehouses(),
        QuotaDimension::Warehouses.limit_for(facts.tier)
    );
    assert_eq!(
        e.max_staff_users(),
        QuotaDimension::Staff.limit_for(facts.tier)
    );

    // Usage identity reaches the resolver, not just the DTO, and the
    // caller-only axes pass through untouched. Ruling 5 survives the trip:
    // no scope answer stays None, so scope cannot win a precedence contest
    // it has no part in.
    assert_eq!(facts.usage, usage);
    assert_eq!(facts.state, e.state);
    assert_eq!(facts.scope_granted, None);
    assert_eq!(facts.permission, Some("topology:write"));
    assert_eq!(facts.expires_at, Some("2027-01-01T00:00:00Z"));
    assert_eq!(facts.grace_until, None);

    #[cfg(debug_assertions)]
    {
        assert_eq!(e.tier, SubscriptionTier::Premium, "active Free promoted");
        assert_eq!(
            facts.tier,
            &SubscriptionTier::Premium,
            "and the verdict was promoted with it, not left on the row's Free"
        );
    }
}
