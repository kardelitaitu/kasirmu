use super::*;
use crate::downgrade::QuotaDimension;
use crate::migrations;
use crate::subscription::SubscriptionTier;
use rusqlite::Connection;

fn fresh() -> Connection {
    migrations::fresh_db()
}

fn store(conn: &Connection) -> Store<'_> {
    Store::new(conn)
}

/// Seed a deterministic tenant: 1 default location (from migration),
/// 2 terminals, 2 active warehouses (+1 inactive, +1 store-type that must
/// not count), 2 active staff (+1 owner +1 inactive that must not count),
/// and 2 products.
fn seed(conn: &Connection) {
    store(conn).seed_default_roles().unwrap();
    conn.execute_batch(
        "INSERT INTO terminals (id, name, device_id, terminal_secret, is_active, metadata, created_at, updated_at) VALUES
            ('t-1','Reg 1','dev-1','s1',1,'{}','2025-01-01T00:00:00.000Z','2025-01-01T00:00:00.000Z'),
            ('t-2','Reg 2','dev-2','s2',1,'{}','2025-01-01T00:00:00.000Z','2025-01-01T00:00:00.000Z');
         INSERT INTO inventory_locations (id, name, type, is_active) VALUES
            ('wh-1','WH A','warehouse',1),
            ('wh-2','WH B','warehouse',1),
            ('wh-3','WH C','warehouse',0),
            ('st-1','Store Room','store',1);
         INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at) VALUES
            ('u-1','alice','h','Alice','role-staff',1,'2025-01-01T00:00:00.000Z','2025-01-01T00:00:00.000Z'),
            ('u-2','bob','h','Bob','role-staff',1,'2025-01-01T00:00:00.000Z','2025-01-01T00:00:00.000Z'),
            ('u-3','owner','h','Owner','role-owner',1,'2025-01-01T00:00:00.000Z','2025-01-01T00:00:00.000Z'),
            ('u-4','gone','h','Gone','role-staff',0,'2025-01-01T00:00:00.000Z','2025-01-01T00:00:00.000Z');
         INSERT INTO products (id, sku, name, price_minor, currency) VALUES
            ('p-1','SKU1','P1',100,'USD'),
            ('p-2','SKU2','P2',100,'USD');",
    )
    .unwrap();
}

#[test]
fn assess_uses_the_same_counts_as_the_creation_gates() {
    // Wiring proof: every reported current equals the count_* method the
    // matching enforce_*_quota gate consults.
    let conn = fresh();
    seed(&conn);
    let s = store(&conn);
    let report = s.assess_downgrade(&SubscriptionTier::Pro).unwrap();
    let cur = |d| report.usage(d).unwrap().current;
    assert_eq!(cur(QuotaDimension::Locations), s.count_locations().unwrap());
    assert_eq!(
        cur(QuotaDimension::PosRegisters),
        s.count_terminals().unwrap()
    );
    assert_eq!(
        cur(QuotaDimension::Warehouses),
        s.count_warehouse_locations().unwrap()
    );
    assert_eq!(cur(QuotaDimension::Staff), s.count_staff_users().unwrap());
    assert_eq!(cur(QuotaDimension::Products), s.count_products().unwrap());
    // And the specific, intended values (owner + inactive excluded).
    assert_eq!(cur(QuotaDimension::Locations), 1);
    assert_eq!(cur(QuotaDimension::PosRegisters), 2);
    assert_eq!(cur(QuotaDimension::Warehouses), 2);
    assert_eq!(cur(QuotaDimension::Staff), 2);
    assert_eq!(cur(QuotaDimension::Products), 2);
}

#[test]
fn free_tier_reports_over_quota_after_a_downgrade() {
    let conn = fresh();
    seed(&conn);
    let s = store(&conn);
    // Downgrade to Free: caps locations 1, registers 1, warehouses 1, staff 1, products 200.
    let report = s.assess_downgrade(&SubscriptionTier::Free).unwrap();

    // Locations exactly at the cap: compliant but blocked from adding more.
    let loc = report.usage(QuotaDimension::Locations).unwrap();
    assert!(!loc.is_over_quota());
    assert!(loc.blocks_creation());

    // Registers / warehouses / staff are strictly over (2 > 1).
    for d in [
        QuotaDimension::PosRegisters,
        QuotaDimension::Warehouses,
        QuotaDimension::Staff,
    ] {
        let u = report.usage(d).unwrap();
        assert!(u.is_over_quota(), "{:?} should be over quota", d);
        assert_eq!(u.excess(), 1);
    }

    // Products (2) are far under the 200 cap.
    assert!(
        !report
            .usage(QuotaDimension::Products)
            .unwrap()
            .is_over_quota()
    );

    assert!(report.is_over_quota());
    assert_eq!(report.total_excess(), 3);
    assert_eq!(report.over_quota_usages().count(), 3);
}

#[test]
fn unlimited_tier_reports_nothing_over() {
    let conn = fresh();
    seed(&conn);
    let s = store(&conn);
    let report = s.assess_downgrade(&SubscriptionTier::Enterprise).unwrap();
    assert!(!report.is_over_quota());
    assert_eq!(report.total_excess(), 0);
    assert_eq!(report.over_quota_usages().count(), 0);
}

#[test]
fn empty_tenant_is_within_quota_but_at_the_location_cap() {
    // fresh_db seeds exactly one default location and nothing else.
    let conn = fresh();
    let s = store(&conn);
    let report = s.assess_downgrade(&SubscriptionTier::Free).unwrap();
    assert!(!report.is_over_quota());
    // The single default location sits at the Free cap of 1.
    assert!(
        report
            .usage(QuotaDimension::Locations)
            .unwrap()
            .blocks_creation()
    );
}
