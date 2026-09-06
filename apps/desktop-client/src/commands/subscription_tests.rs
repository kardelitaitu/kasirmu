use super::*;
use oz_core::migrations;

fn fresh_db() -> rusqlite::Connection {
    migrations::fresh_db()
}

fn seed_tier(conn: &rusqlite::Connection, tier_key: &str) {
    conn.execute(
        "UPDATE tenant_subscription SET tier_key = ?1 WHERE tenant_id = 'default'",
        [tier_key],
    )
    .unwrap();
}

fn caps(conn: &rusqlite::Connection) -> SubscriptionCapabilitiesDto {
    load_capabilities(conn).unwrap()
}

#[test]
fn capabilities_reflect_free_tier_and_zero_usage() {
    let conn = fresh_db();
    let dto = caps(&conn);
    // In debug builds, load_capabilities upgrades Free -> Premium
    // so all features are available during development.
    #[cfg(debug_assertions)]
    {
        assert_eq!(
            dto.tier, "premium",
            "debug builds upgrade Free tier to Premium"
        );
        assert_eq!(dto.max_stores, Some(5));
        assert_eq!(dto.max_staff_users, Some(50));
        assert_eq!(dto.sales_history_days, None, "Premium = unlimited history");
        assert!(dto.supports_qris);
        assert!(dto.supports_analytics);
        assert!(dto.supports_loyalty);
    }
    #[cfg(not(debug_assertions))]
    {
        assert_eq!(dto.tier, "free");
        assert_eq!(dto.max_stores, Some(1));
        assert_eq!(dto.max_staff_users, Some(1));
        assert_eq!(dto.sales_history_days, Some(90));
        assert!(!dto.supports_qris);
        assert!(!dto.supports_analytics);
        assert!(!dto.supports_loyalty);
    }
    assert_eq!(dto.location_count, 1, "fresh DB seeds the primary store");
    assert_eq!(dto.staff_count, 0);
    assert_eq!(dto.terminal_count, 0);
}

#[test]
fn capabilities_reflect_plus_and_pro_tiers() {
    let conn = fresh_db();
    seed_tier(&conn, "plus");
    let dto = caps(&conn);
    assert_eq!(dto.tier, "plus");
    assert_eq!(dto.max_stores, Some(1));
    assert_eq!(dto.max_pos_instances, Some(2));
    assert_eq!(dto.max_staff_users, Some(5));
    assert_eq!(dto.sales_history_days, Some(365));
    assert!(dto.supports_qris);
    assert!(!dto.supports_analytics, "analytics stays Pro+");
    assert!(!dto.supports_loyalty, "loyalty stays Premium+");

    seed_tier(&conn, "pro");
    let dto = caps(&conn);
    assert_eq!(dto.tier, "pro");
    assert_eq!(dto.max_stores, Some(2));
    assert_eq!(dto.max_pos_instances, Some(5));
    assert_eq!(dto.max_staff_users, Some(20));
    assert!(dto.supports_analytics);
    assert!(!dto.supports_loyalty);
}

#[test]
fn capabilities_reflect_premium_tier() {
    let conn = fresh_db();
    seed_tier(&conn, "premium");
    let dto = caps(&conn);
    assert_eq!(dto.tier, "premium");
    // C4.2: Premium allows up to 5 stores self-serve
    assert_eq!(dto.max_stores, Some(5));
    assert_eq!(dto.max_pos_instances, None);
    assert_eq!(dto.max_staff_users, Some(50));
    assert_eq!(dto.sales_history_days, None); // unlimited
    assert!(dto.supports_qris);
    assert!(dto.supports_analytics);
    assert!(dto.supports_loyalty);
}
