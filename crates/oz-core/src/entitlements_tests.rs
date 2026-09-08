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
