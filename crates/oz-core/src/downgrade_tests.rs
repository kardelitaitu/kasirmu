use super::*;
use crate::subscription::SubscriptionTier;

fn counts(
    locations: i64,
    pos_registers: i64,
    warehouses: i64,
    staff: i64,
    products: i64,
) -> QuotaCounts {
    QuotaCounts {
        locations,
        pos_registers,
        warehouses,
        staff,
        products,
    }
}

#[test]
fn free_tier_flags_every_over_cap_dimension() {
    // Free caps: locations 1, registers 1, warehouses 1, staff 1, products 200.
    let report = evaluate(&SubscriptionTier::Free, &counts(3, 2, 2, 2, 5));
    assert!(report.is_over_quota());

    let over: Vec<&str> = report
        .over_quota_usages()
        .map(|u| u.dimension.as_str())
        .collect();
    assert_eq!(
        over,
        vec!["locations", "pos_registers", "warehouses", "staff"]
    );

    assert_eq!(report.usage(QuotaDimension::Locations).unwrap().excess(), 2);
    assert_eq!(
        report.usage(QuotaDimension::PosRegisters).unwrap().excess(),
        1
    );
    assert_eq!(
        report.usage(QuotaDimension::Warehouses).unwrap().excess(),
        1
    );
    assert_eq!(report.usage(QuotaDimension::Staff).unwrap().excess(), 1);
    // 5 products is well under the 200 cap.
    assert!(
        !report
            .usage(QuotaDimension::Products)
            .unwrap()
            .is_over_quota()
    );
    assert_eq!(report.total_excess(), 5);
}

#[test]
fn at_cap_is_not_over_quota_but_blocks_creation() {
    // Exactly at the Free location cap (1): compliant, but no more may be created.
    let report = evaluate(&SubscriptionTier::Free, &counts(1, 0, 0, 0, 0));
    let loc = report.usage(QuotaDimension::Locations).unwrap();
    assert!(!loc.is_over_quota(), "at the cap is not above the cap");
    assert!(loc.blocks_creation(), "at the cap blocks the next creation");
    assert_eq!(loc.excess(), 0);
    assert!(!report.is_over_quota());
}

#[test]
fn strictly_over_also_blocks_creation() {
    let report = evaluate(&SubscriptionTier::Free, &counts(2, 0, 0, 0, 0));
    let loc = report.usage(QuotaDimension::Locations).unwrap();
    assert!(loc.is_over_quota());
    assert!(loc.blocks_creation());
}

#[test]
fn unlimited_tier_is_never_over_and_never_blocks() {
    // Enterprise: every cap is None. Even enormous counts are within quota.
    let report = evaluate(
        &SubscriptionTier::Enterprise,
        &counts(999, 999, 999, 999, 999_999),
    );
    assert!(!report.is_over_quota());
    assert_eq!(report.total_excess(), 0);
    for u in &report.usages {
        assert_eq!(u.limit, None);
        assert!(!u.blocks_creation());
    }
}

#[test]
fn dimensions_emit_in_canonical_order_with_matching_limits() {
    let tier = SubscriptionTier::Pro;
    let c = counts(1, 2, 3, 4, 5);
    let report = evaluate(&tier, &c);
    assert_eq!(report.usages.len(), DIMENSION_ORDER.len());
    for (i, usage) in report.usages.iter().enumerate() {
        assert_eq!(usage.dimension, DIMENSION_ORDER[i]);
        assert_eq!(usage.limit, DIMENSION_ORDER[i].limit_for(&tier));
        assert_eq!(usage.current, c.get(DIMENSION_ORDER[i]));
    }
}

#[test]
fn pro_tier_boundary_between_at_cap_and_over() {
    // Pro caps: locations 2, registers 5, warehouses 3, staff 20, products 1000.
    let report = evaluate(&SubscriptionTier::Pro, &counts(2, 6, 3, 20, 1000));
    // locations at cap (2): not over, blocks.
    assert!(
        !report
            .usage(QuotaDimension::Locations)
            .unwrap()
            .is_over_quota()
    );
    assert!(
        report
            .usage(QuotaDimension::Locations)
            .unwrap()
            .blocks_creation()
    );
    // registers over by 1.
    let pos = report.usage(QuotaDimension::PosRegisters).unwrap();
    assert!(pos.is_over_quota());
    assert_eq!(pos.excess(), 1);
    // warehouses/staff/products at cap: not over.
    assert!(
        !report
            .usage(QuotaDimension::Warehouses)
            .unwrap()
            .is_over_quota()
    );
    assert!(!report.usage(QuotaDimension::Staff).unwrap().is_over_quota());
    assert!(
        !report
            .usage(QuotaDimension::Products)
            .unwrap()
            .is_over_quota()
    );
    assert_eq!(report.total_excess(), 1);
}

#[test]
fn default_counts_are_within_every_paid_tier() {
    let zero = QuotaCounts::default();
    // Zero usage is never over quota on any tier (Free staff cap is 1, not 0).
    for tier in [
        SubscriptionTier::Free,
        SubscriptionTier::Plus,
        SubscriptionTier::Pro,
        SubscriptionTier::Premium,
        SubscriptionTier::Enterprise,
    ] {
        let report = evaluate(&tier, &zero);
        assert!(
            !report.is_over_quota(),
            "empty tenant over quota on {:?}",
            tier
        );
        assert_eq!(report.total_excess(), 0);
    }
}

#[test]
fn report_carries_tier_identity() {
    let report = evaluate(&SubscriptionTier::Premium, &QuotaCounts::default());
    assert_eq!(report.tier_key, "premium");
    assert_eq!(report.tier_name, "Premium");
}

#[test]
fn evaluate_leaves_markers_empty_pure_path_does_not_persist() {
    // The pure evaluator never touches the DB; the markers vec is a
    // backward-compatible field that only the separate persistence step fills.
    let report = evaluate(&SubscriptionTier::Free, &counts(3, 2, 2, 2, 5));
    assert!(report.markers.is_empty());
}

#[test]
fn topology_nodes_has_no_tier_cap_and_stays_out_of_the_report() {
    // Owner ruling: topology nodes are a marker-only dimension riding the
    // existing per-location caps. There is no tier cap — `limit_for` answers
    // None for EVERY tier — and the variant is absent from DIMENSION_ORDER,
    // so `evaluate` can never emit a topology row. QuotaCounts carries no
    // count for it either (the count lives in each store's own database).
    for tier in [
        SubscriptionTier::Free,
        SubscriptionTier::Plus,
        SubscriptionTier::Pro,
        SubscriptionTier::Premium,
        SubscriptionTier::Enterprise,
    ] {
        assert_eq!(
            QuotaDimension::TopologyNodes.limit_for(&tier),
            None,
            "topology nodes must have no tier cap on {tier:?}"
        );
    }
    assert!(!DIMENSION_ORDER.contains(&QuotaDimension::TopologyNodes));
    assert_eq!(QuotaCounts::default().get(QuotaDimension::TopologyNodes), 0);
}

#[test]
fn topology_nodes_key_round_trips() {
    // The read fan-out names its marker rows "topology_nodes"; the reader
    // must parse that key back instead of skipping it as unknown.
    assert_eq!(QuotaDimension::TopologyNodes.as_str(), "topology_nodes");
    assert_eq!(
        QuotaDimension::from_key("topology_nodes"),
        Some(QuotaDimension::TopologyNodes)
    );
}
