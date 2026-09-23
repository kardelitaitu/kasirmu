use super::*;
use crate::downgrade::DIMENSION_ORDER;
use crate::downgrade::OverQuotaSeverity;
use crate::error::CoreError;
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

/// Seed a deterministic tenant mirroring `db::downgrade_tests::seed`: 1
/// default location, 2 terminals, 2 active warehouses, 2 active staff
/// (+1 owner, +1 inactive), 2 products. Free caps: locations/pos/
/// warehouses/staff = 1, products = 200.
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

/// Bulk-insert `n` extra products (the S2 batch shape, via plain SQL).
fn seed_products(conn: &Connection, n: i64, prefix: &str) {
    for i in 0..n {
        conn.execute(
            "INSERT INTO products (id, sku, name, price_minor, currency) VALUES (?1, ?2, ?3, 100, 'USD')",
            rusqlite::params![format!("{prefix}-{i}"), format!("{prefix}{i}"), prefix],
        )
        .unwrap();
    }
}

#[test]
fn at_cap_rejects_with_the_legacy_error_shape_and_values() {
    let conn = fresh();
    seed(&conn);
    let s = store(&conn);
    // Free: locations at the cap (1/1), the other three over it (2/1).
    let err = s
        .enforce_creation_quota(QuotaDimension::Locations, &SubscriptionTier::Free)
        .unwrap_err();
    match err {
        CoreError::SubscriptionLimitExceeded(message) => {
            assert!(message.contains("maximum 1 stores"), "got: {message}");
            assert!(message.contains("currently have 1"), "got: {message}");
        }
        other => panic!("expected SubscriptionLimitExceeded, got {other:?}"),
    }
    for (dim, keyword) in [
        (QuotaDimension::PosRegisters, "registers per store"),
        (QuotaDimension::Warehouses, "warehouse locations"),
        (QuotaDimension::Staff, "staff users"),
    ] {
        let err = s
            .enforce_creation_quota(dim, &SubscriptionTier::Free)
            .unwrap_err();
        match err {
            CoreError::SubscriptionLimitExceeded(message) => {
                // RegisterLimit phrases the count as "already has 2"; the
                // staff/warehouse variants say "currently have 2" — accept
                // either, both carry the (limit = 1, current = 2) shape.
                assert!(
                    message.contains("maximum 1")
                        && (message.contains("currently have 2")
                            || message.contains("already has 2")),
                    "{keyword}: got {message}",
                );
            }
            other => panic!("expected SubscriptionLimitExceeded for {keyword}, got {other:?}"),
        }
    }
}

#[test]
fn under_limit_passes_and_batch_semantics_reject_exactly_at_the_edge() {
    let conn = fresh();
    seed(&conn);
    let s = store(&conn);
    // 2 products, Free cap 200: single creation passes.
    s.enforce_creation_quota(QuotaDimension::Products, &SubscriptionTier::Free)
        .unwrap();
    // Batch: 198 more = exactly 200 (== limit) — the last allowed batch.
    s.ensure_quota_allows(QuotaDimension::Products, &SubscriptionTier::Free, 198)
        .unwrap();
    seed_products(&conn, 198, "b");
    // 200 + 1 more = 201 > 200: rejected, reporting the CURRENT count.
    let err = s
        .ensure_quota_allows(QuotaDimension::Products, &SubscriptionTier::Free, 1)
        .unwrap_err();
    match err {
        CoreError::SubscriptionLimitExceeded(message) => {
            assert!(message.contains("maximum 200 products"), "got: {message}");
            assert!(message.contains("currently have 200"), "got: {message}");
        }
        other => panic!("expected ProductLimit, got {other:?}"),
    }
    // A zero-row batch at the cap is allowed (nothing is being added).
    s.ensure_quota_allows(QuotaDimension::Products, &SubscriptionTier::Free, 0)
        .unwrap();
}

#[test]
fn unlimited_tier_passes_every_dimension() {
    let conn = fresh();
    seed(&conn);
    let s = store(&conn);
    for dim in DIMENSION_ORDER {
        s.enforce_creation_quota(dim, &SubscriptionTier::Enterprise)
            .unwrap();
    }
}

#[test]
fn kds_screens_are_refused_loud_not_silently_allowed() {
    // T1 risk 4 pin: QuotaCounts::get answers 0 for KdsScreens; a generic
    // DIMENSION_ORDER loop would read that 0 and allow every KDS creation.
    // The central gate must refuse the dimension instead.
    let conn = fresh();
    seed(&conn);
    let s = store(&conn);
    let err = s
        .enforce_creation_quota(QuotaDimension::KdsScreens, &SubscriptionTier::Pro)
        .unwrap_err();
    match err {
        CoreError::Internal(message) => {
            assert!(message.contains("per-location"), "got: {message}");
        }
        other => panic!("expected Internal refusal, got {other:?}"),
    }
}

#[test]
fn topology_nodes_is_refused_loud_not_silently_read() {
    // TopologyNodes is a read-computed marker only — never persisted and
    // never gated. It has no per-creation count, so a generic loop would
    // read QuotaCounts' 0 and allow every creation; the count consult must
    // refuse loudly instead of answering a wrong number.
    let conn = fresh();
    seed(&conn);
    let s = store(&conn);
    let err = s
        .quota_count(QuotaDimension::TopologyNodes)
        .expect_err("gate counting must refuse TopologyNodes");
    match err {
        CoreError::Internal(message) => {
            assert!(message.contains("read-computed"), "got: {message}");
        }
        other => panic!("expected Internal refusal, got {other:?}"),
    }
}

#[test]
fn missing_subscription_fails_closed_to_free() {
    // A tenant with no subscriptions row resolves to Free (most
    // restrictive), never a crash and never a free pass.
    let conn = fresh();
    seed(&conn);
    conn.execute("DELETE FROM tenant_subscription", []).unwrap();
    let s = store(&conn);
    assert_eq!(
        s.resolve_tier_fail_closed().unwrap(),
        SubscriptionTier::Free
    );
    // 250 products over the fail-closed Free cap of 200: the gate must
    // reject through the resolved tier.
    seed_products(&conn, 248, "x");
    assert!(
        s.ensure_quota_allows(QuotaDimension::Products, &SubscriptionTier::Free, 0)
            .is_err(),
    );
}

#[test]
fn passing_gate_warms_the_marker_table() {
    let conn = fresh();
    seed(&conn);
    let s = store(&conn);
    // Products pass on Free (2 < 200), and the warm-call refreshes markers:
    // locations at cap (at), pos/warehouses/staff over (over), products none.
    s.enforce_creation_quota(QuotaDimension::Products, &SubscriptionTier::Free)
        .unwrap();
    let markers = s.over_quota_markers().unwrap();
    assert_eq!(markers.len(), 4, "got: {markers:?}");
    assert!(
        markers.iter().any(
            |m| m.dimension == QuotaDimension::Locations && m.severity == OverQuotaSeverity::At
        ),
    );
}

#[test]
fn test_resolve_tier_fail_closed_uses_ledger_time_past_grace() {
    let conn = fresh();
    let s = store(&conn);

    // Update the seeded bootstrap subscription to Plus, expiring 2 days ago (within 14-day grace).
    let recent_expiry = chrono::Utc::now() - chrono::Duration::days(2);
    conn.execute(
        "UPDATE tenant_subscription SET
            tier_key = 'plus', status = 'active', expires_at = ?1
         WHERE tenant_id = 'default'",
        rusqlite::params![recent_expiry.to_rfc3339()],
    )
    .unwrap();

    // With recent timestamps, effective tier is Plus.
    assert_eq!(
        s.resolve_tier_fail_closed().unwrap(),
        SubscriptionTier::Plus
    );

    // Insert a sale with a ledger timestamp 25 days past expiry (past the 14-day grace window).
    let future_sale = (recent_expiry + chrono::Duration::days(25)).to_rfc3339();
    conn.execute(
        "INSERT INTO sales (id, status, total_minor, currency, line_count, created_at, updated_at)
         VALUES ('s-future', 'completed', 1000, 'USD', 1, ?1, ?1)",
        rusqlite::params![future_sale],
    )
    .unwrap();

    // Monotonic ledger evaluation must detect that time has advanced past grace,
    // reverting the effective tier to Free!
    assert_eq!(
        s.resolve_tier_fail_closed().unwrap(),
        SubscriptionTier::Free
    );
}
