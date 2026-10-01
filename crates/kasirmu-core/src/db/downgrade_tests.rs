use super::*;
use crate::downgrade::QuotaDimension;
use crate::migrations;
use crate::subscription::SubscriptionTier;
use rusqlite::Connection;

/// A provisioned store database.
///
/// ADR #56 §2.6 stopped the baseline migration seeding the `Default Store`
/// location, the five `default-*` workspaces and the BOOTSTRAP_FREE
/// subscription — `provision_device` creates them now, in one transaction.
/// These tests exercise layers BELOW provisioning, so they run against what
/// provisioning produces. See `migrations::seed_provisioned_baseline`.
fn fresh() -> Connection {
    let conn = migrations::fresh_db();
    migrations::seed_provisioned_baseline(&conn);
    conn
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
    // Downgrade to Free: caps locations 1, registers 1, warehouses 0, staff 1, products 200.
    let report = s.assess_downgrade(&SubscriptionTier::Free).unwrap();

    // Locations exactly at the cap: compliant but blocked from adding more.
    let loc = report.usage(QuotaDimension::Locations).unwrap();
    assert!(!loc.is_over_quota());
    assert!(loc.blocks_creation());

    // Registers / staff are strictly over by 1 (2 > 1).
    for d in [QuotaDimension::PosRegisters, QuotaDimension::Staff] {
        let u = report.usage(d).unwrap();
        assert!(u.is_over_quota(), "{d:?} should be over quota");
        assert_eq!(u.excess(), 1);
    }

    // Warehouses are over by 2, not 1: the Free cap is 0 because the
    // warehouse workspace is Premium+.
    let wh = report.usage(QuotaDimension::Warehouses).unwrap();
    assert!(wh.is_over_quota(), "warehouses should be over quota");
    assert_eq!(wh.excess(), 2);

    // Products (2) are far under the 200 cap.
    assert!(
        !report
            .usage(QuotaDimension::Products)
            .unwrap()
            .is_over_quota()
    );

    assert!(report.is_over_quota());
    assert_eq!(report.total_excess(), 4);
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

#[test]
fn persist_writes_one_marker_per_over_or_at_dimension() {
    // No subscription row -> TenantSubscription::load fails closed to Free:
    //   locations 1 (== cap 1 -> "at"), registers/warehouses/staff 2 each
    //   (> cap 1 -> "over"), products 2 (under 200 cap -> none).
    let conn = fresh();
    seed(&conn);
    let s = store(&conn);
    let markers = s.persist_over_quota_markers().unwrap();
    assert_eq!(markers.len(), 4);

    // Direct read of the persisted table to prove the row shape and that the
    // full-refresh wrote exactly the expected dimensions.
    let mut rows: Vec<(String, String, Option<i64>, i64)> = conn
        .prepare(
            "SELECT dimension, severity, \"limit\", current              FROM over_quota_markers WHERE tenant_id = 'default' ORDER BY dimension",
        )
        .unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();
    rows.sort_by(|a, b| a.0.cmp(&b.0));
    assert_eq!(rows.len(), 4);

    let loc = rows.iter().find(|r| r.0 == "locations").unwrap();
    assert_eq!(loc.1, "at");
    assert_eq!(loc.2, Some(1));
    assert_eq!(loc.3, 1);

    let reg = rows.iter().find(|r| r.0 == "pos_registers").unwrap();
    assert_eq!(reg.1, "over");
    assert_eq!(reg.2, Some(1));
    assert_eq!(reg.3, 2);

    // Every returned marker carries the tenant-global resource id.
    for m in &markers {
        assert_eq!(m.resource_id, "default");
        assert_eq!(m.resource_type, m.dimension.as_str());
    }
}

#[test]
fn persist_is_a_full_refresh_not_incremental() {
    let conn = fresh();
    seed(&conn);
    let s = store(&conn);
    s.persist_over_quota_markers().unwrap();
    // A second refresh over identical data must replace, never accumulate.
    s.persist_over_quota_markers().unwrap();
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM over_quota_markers WHERE tenant_id = 'default'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 4);
}

#[test]
fn persist_drops_markers_once_counts_fall_within_quota() {
    let conn = fresh();
    seed(&conn);
    let s = store(&conn);
    s.persist_over_quota_markers().unwrap();
    assert_eq!(
        conn.query_row(
            "SELECT COUNT(*) FROM over_quota_markers WHERE tenant_id = 'default'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        4
    );
    // Drive terminals and warehouses back to zero. Terminals fall under the
    // Free cap of 1 and drop their marker; warehouses drop theirs too, but not
    // because they fit — the Free warehouse cap is 0 (Premium+ only), and a
    // zero cap with nothing in it is a dimension the tier does not include at
    // all, so there is nothing to remediate and no row to write
    // (`QuotaUsage::is_unincluded_dimension`).
    conn.execute("DELETE FROM terminals WHERE id IN ('t-1','t-2')", [])
        .unwrap();
    conn.execute(
        "DELETE FROM inventory_locations WHERE id IN ('wh-1','wh-2')",
        [],
    )
    .unwrap();
    s.persist_over_quota_markers().unwrap();
    // Only locations (at cap) and staff (over) remain flagged.
    assert_eq!(
        conn.query_row(
            "SELECT COUNT(*) FROM over_quota_markers WHERE tenant_id = 'default'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        2
    );
}

// ── MSL-38: the over-quota markers must use the gate's tier, not the clock's ──

/// MSL-36 moved the creation gates onto the LEDGER tier. `persist_over_quota_markers`
/// resolves the tier a SECOND time, for itself, from `effective_tier()` — the wall
/// clock — and it is called from INSIDE those gates (`quota_gate.rs`,
/// `locations.rs`, `products_crud.rs`, `staff.rs`, `workspaces_lifecycle.rs`).
///
/// So a creation can be refused against the ledger tier while the marker
/// refresh, running two lines later in the same call, records markers computed
/// against a different tier. Its own doc states the contract it breaks:
/// "obtained the same way the creation gates get it".
///
/// The two clocks must disagree for this to be observable; a unit test cannot
/// move the OS clock, so it moves the LEDGER forward — the same relative state a
/// rollback produces.
#[test]
fn over_quota_markers_use_the_same_tier_as_the_gate() {
    let conn = fresh();
    seed(&conn);
    let s = store(&conn);

    // Premium, expiring 20 days ago in real time — inside Premium's 30-day
    // grace, so the aligned-clock answer is Premium and no marker is due.
    let ledger_now = chrono::Utc::now();
    let expiry = ledger_now - chrono::Duration::days(20);
    conn.execute(
        "UPDATE tenant_subscription SET tier_key = 'premium', status = 'active', expires_at = ?1 WHERE tenant_id = 'default'",
        rusqlite::params![expiry.to_rfc3339()],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO sales (id, status, total_minor, currency, line_count, created_at, updated_at) VALUES ('s1', 'completed', 1000, 'USD', 1, ?1, ?1)",
        rusqlite::params![ledger_now.to_rfc3339()],
    )
    .unwrap();

    // Aligned clocks: the gate and the markers both see Premium, so this is
    // the baseline the fix must preserve — the seeded store is comfortably
    // inside Premium on every dimension.
    assert_eq!(s.resolve_tier_fail_closed().unwrap().tier_key(), "premium");
    let baseline = s.persist_over_quota_markers().unwrap();
    assert_eq!(
        baseline.len(),
        0,
        "Premium fits the seeded store comfortably"
    );

    // Roll the ledger 40 days forward while the wall clock stays put: the
    // grace window has provably lapsed, so the gate now enforces Free.
    let rolled = ledger_now + chrono::Duration::days(40);
    conn.execute(
        "UPDATE sales SET created_at = ?1, updated_at = ?1 WHERE id = 's1'",
        rusqlite::params![rolled.to_rfc3339()],
    )
    .unwrap();

    assert_eq!(
        s.resolve_tier_fail_closed().unwrap().tier_key(),
        "free",
        "the gate enforces Free once grace has lapsed"
    );

    // The markers must agree with that gate. The seeded store has 2 terminals,
    // 2 active warehouses and 2 active staff — all over the Free caps — so a
    // marker refresh at the GATE's tier cannot come back empty.
    let markers = s.persist_over_quota_markers().unwrap();
    assert!(
        !markers.is_empty(),
        "the marker refresh must use the gate's tier: Free caps are exceeded by the seeded store, so an empty refresh means the markers were computed against the wall clock's Premium"
    );
}
