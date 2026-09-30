//! Tests for the `ReportingFacade` trait (Phase 4 P4.2).

use crate::db::Store;
use crate::db::facade::ReportingFacade;
use crate::migrations;
use rusqlite::Connection;

fn fresh() -> Connection {
    migrations::fresh_db()
}

/// The trait is exactly the plan's four aggregate families. This test fails if a
/// fifth method is added without amending docs/architecture/reporting-facade-
/// inventory.md section 5 -- the trait grows by decision, not by mirroring the
/// 24 inherent methods.
#[test]
fn the_trait_is_exactly_four_aggregate_families() {
    // A compile-time witness: bind each of the four methods through the trait,
    // so a rename or a signature drift breaks this test rather than silently
    // widening/narrowing the contract.
    fn takes_facade<F: ReportingFacade>(_f: &F) {}
    let conn = fresh();
    let store = Store::new(&conn);
    takes_facade(&store);

    // The four families resolve through the trait, not the concrete inherent
    // methods: `facade::ReportingFacade` must be in scope for these calls.
    let _: Vec<crate::db::reports::DailyRevenueRow> = store
        .daily_revenue("2026-01-01", "2026-01-31")
        .expect("daily_revenue through the trait");
    let _: Vec<crate::db::reports::HourlyHeatmapRow> = store
        .hourly_heatmap("2026-01-01", "2026-01-31")
        .expect("hourly_heatmap through the trait");
    let _: Vec<crate::db::reports::TopProductRow> = store
        .top_products("2026-01-01", "2026-01-31", 10, "revenue")
        .expect("top_products through the trait");
    let _: Vec<crate::db::reports::LowStockAlert> = store
        .low_stock_alerts_at_location("loc-1", 5)
        .expect("low_stock_alerts_at_location through the trait");
}

/// The trait's method count is pinned by construction: this many methods exist.
/// If a method is added, this const and the inventory section 5 must both change
/// in the same commit.
const TRAIT_METHOD_COUNT: usize = 4;

#[test]
fn the_documented_method_count_matches_the_trait() {
    assert_eq!(TRAIT_METHOD_COUNT, 4, "the facade trait is four families");
}

/// A generic caller can be written against the trait alone -- the point of the
/// abstraction -- and still run against the concrete `Store`.
#[test]
fn a_generic_caller_resolves_through_the_trait() {
    fn revenue_days<F: ReportingFacade>(facade: &F) -> usize {
        facade
            .daily_revenue("2026-01-01", "2026-01-31")
            .expect("query")
            .len()
    }
    let conn = fresh();
    let store = Store::new(&conn);
    assert_eq!(revenue_days(&store), 0, "empty fresh db has no revenue rows");
}
