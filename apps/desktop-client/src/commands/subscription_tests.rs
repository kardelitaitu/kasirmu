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

// ── Lifecycle state + fail-closed (todo-global-saas-1.md §B) ─────────

#[test]
fn capabilities_report_active_state_for_bootstrap_row() {
    let conn = fresh_db();
    assert_eq!(caps(&conn).state, "active");
}

#[test]
fn capabilities_fail_closed_when_subscription_row_missing() {
    let conn = fresh_db();
    conn.execute(
        "DELETE FROM tenant_subscription WHERE tenant_id = 'default'",
        [],
    )
    .unwrap();
    let dto = caps(&conn);
    assert_eq!(dto.state, "unavailable");
    // Fail closed: Free entitlements — the debug Premium upgrade must not
    // apply, so every tier gate locks even in dev builds.
    assert_eq!(dto.tier, "free");
    assert!(!dto.supports_qris);
    assert!(!dto.supports_analytics);
    assert!(!dto.supports_loyalty);
    assert!(dto.addons.is_empty());
    // Usage counts stay best-effort readable (banner inputs only).
    assert_eq!(dto.location_count, 1, "fresh DB seeds the primary store");
}

#[test]
fn capabilities_fail_closed_when_signature_tampered() {
    let conn = fresh_db();
    conn.execute(
        "UPDATE tenant_subscription SET signature = 'tampered' WHERE tenant_id = 'default'",
        [],
    )
    .unwrap();
    let dto = caps(&conn);
    assert_eq!(dto.state, "unavailable");
    assert_eq!(dto.tier, "free");
    assert!(!dto.supports_qris);
}

#[test]
fn capabilities_report_grace_state_within_offline_grace() {
    // Row columns are independent of the signature (verify_signature
    // covers only signed_payload), so a local snapshot edit is enough to
    // drive the state machine. Premium grace is 30 days.
    let conn = fresh_db();
    seed_tier(&conn, "premium");
    let recent = (chrono::Utc::now() - chrono::Duration::days(7)).to_rfc3339();
    conn.execute(
        "UPDATE tenant_subscription SET expires_at = ?1 WHERE tenant_id = 'default'",
        [recent],
    )
    .unwrap();
    let dto = caps(&conn);
    assert_eq!(dto.state, "grace");
    // Within grace the REAL tier applies (operational continuity) — the
    // debug Free→Premium upgrade does not mask the state.
    assert_eq!(dto.tier, "premium");
}

#[test]
fn capabilities_report_expired_state_and_free_entitlements() {
    let conn = fresh_db();
    seed_tier(&conn, "plus");
    // Plus grace is 14 days — 30 days past expiry is outside it.
    let old = (chrono::Utc::now() - chrono::Duration::days(30)).to_rfc3339();
    conn.execute(
        "UPDATE tenant_subscription SET expires_at = ?1 WHERE tenant_id = 'default'",
        [old],
    )
    .unwrap();
    let dto = caps(&conn);
    assert_eq!(dto.state, "expired");
    assert_eq!(
        dto.tier, "free",
        "outside grace the tier downgrades to Free"
    );
    assert!(!dto.supports_qris);
}

#[test]
fn capabilities_report_canceled_state_even_with_live_expiry() {
    let conn = fresh_db();
    seed_tier(&conn, "pro");
    let future = (chrono::Utc::now() + chrono::Duration::days(30)).to_rfc3339();
    conn.execute(
        "UPDATE tenant_subscription SET status = 'canceled', expires_at = ?1
         WHERE tenant_id = 'default'",
        [future],
    )
    .unwrap();
    let dto = caps(&conn);
    assert_eq!(dto.state, "canceled");
    assert_eq!(dto.tier, "free", "canceled is never within grace");
}

#[test]
fn capabilities_report_paused_state() {
    let conn = fresh_db();
    seed_tier(&conn, "plus");
    conn.execute(
        "UPDATE tenant_subscription SET status = 'paused' WHERE tenant_id = 'default'",
        [],
    )
    .unwrap();
    let dto = caps(&conn);
    assert_eq!(dto.state, "paused");
    assert_eq!(
        dto.tier, "plus",
        "pause flags the state; entitlements unchanged here"
    );
}
