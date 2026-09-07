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
        assert_eq!(dto.max_locations, Some(5));
        assert_eq!(dto.max_staff_users, Some(50));
        assert_eq!(dto.sales_history_days, None, "Premium = unlimited history");
        assert!(dto.supports_qris);
        assert!(dto.supports_analytics);
        assert!(dto.supports_loyalty);
    }
    #[cfg(not(debug_assertions))]
    {
        assert_eq!(dto.tier, "free");
        assert_eq!(dto.max_locations, Some(1));
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
    assert_eq!(dto.max_locations, Some(1));
    assert_eq!(dto.max_pos_instances, Some(2));
    assert_eq!(dto.max_staff_users, Some(5));
    assert_eq!(dto.sales_history_days, Some(365));
    assert!(dto.supports_qris);
    assert!(!dto.supports_analytics, "analytics stays Pro+");
    assert!(!dto.supports_loyalty, "loyalty stays Premium+");

    seed_tier(&conn, "pro");
    let dto = caps(&conn);
    assert_eq!(dto.tier, "pro");
    assert_eq!(dto.max_locations, Some(2));
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
    assert_eq!(dto.max_locations, Some(5));
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

// ── Feature-availability verdicts (Phase 3 observability) ────────────

/// An owner user: `role-owner`'s `*` grant holds every gate permission,
/// so the role axis never fires and the other axes stand alone.
fn verdict_with_owner(conn: &rusqlite::Connection, feature: &str) -> FeatureVerdict {
    conn.execute(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at)
         VALUES ('role-owner', 'Owner', '', '[\"*\"]', '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')
         ON CONFLICT(id) DO NOTHING",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-owner', 'owner', 'hash', 'Owner', 'role-owner', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')
         ON CONFLICT(id) DO NOTHING",
        [],
    )
    .unwrap();
    load_feature_verdict(conn, "user-owner", feature).unwrap()
}

#[test]
fn verdict_names_tier_when_the_flag_is_missing() {
    let conn = fresh_db();
    seed_tier(&conn, "plus");
    let v = verdict_with_owner(&conn, "supports_analytics");
    assert!(!v.available);
    assert_eq!(v.reason_code(), Some("tier"));
    assert_eq!(v.feature, "supports_analytics");
    assert_eq!(v.detail.permission.as_deref(), Some("analytics:view"));
    assert_eq!(v.detail.state, "active");
}

#[test]
fn verdict_names_quota_at_the_cap_and_clears_one_below() {
    let conn = fresh_db();
    seed_tier(&conn, "pro");
    // Pro caps locations at 2; the fresh DB seeds the primary store, so
    // one more reaches the cap.
    conn.execute(
        "INSERT INTO locations (id, name) VALUES ('loc-2', 'Second')",
        [],
    )
    .unwrap();
    let v = verdict_with_owner(&conn, "locations");
    assert!(!v.available, "pro at its 2-location cap must deny");
    assert_eq!(v.reason_code(), Some("quota"));
    assert_eq!(v.detail.limit, Some(2));
    assert_eq!(v.detail.usage, Some(2));

    conn.execute("DELETE FROM locations WHERE id = 'loc-2'", [])
        .unwrap();
    let v = load_feature_verdict(&conn, "user-owner", "locations").unwrap();
    assert!(v.available, "one below the cap must clear");
    assert_eq!(v.reason_code(), None);
}

#[test]
fn verdict_names_server_policy_when_the_tier_withholds_the_workspace_type() {
    let conn = fresh_db();
    seed_tier(&conn, "plus");
    let v = verdict_with_owner(&conn, "supports_qris");
    assert!(v.available, "plus supports qris");

    // The bootstrap Free row's allowed workspace types exclude
    // `warehouse` — the same `allows_workspace_type` answer the
    // workspace-creation gate enforces, so the verdict is server_policy
    // whatever the effective tier's flags say.
    let conn = fresh_db();
    let v = verdict_with_owner(&conn, "warehouses");
    assert!(!v.available);
    assert_eq!(v.reason_code(), Some("server_policy"));

    // The gate permission still echoes for diagnostics.
    assert_eq!(
        v.detail.permission.as_deref(),
        Some("inventory:locations_manage")
    );
}

#[test]
fn verdict_names_role_for_a_role_without_the_gate_permission() {
    let conn = fresh_db();
    seed_tier(&conn, "premium");
    conn.execute_batch(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at) VALUES
            ('role-lite', 'Lite', 'No analytics', '[\"loyalty:view\"]', '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');
         INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-lite', 'lite', 'hash', 'Lite', 'role-lite', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');",
    )
    .unwrap();
    let v = load_feature_verdict(&conn, "user-lite", "supports_analytics").unwrap();
    // Premium grants analytics on the tier; the caller's role is the
    // missing axis.
    assert!(!v.available);
    assert_eq!(v.reason_code(), Some("role"));

    let v = load_feature_verdict(&conn, "user-lite", "supports_loyalty").unwrap();
    assert!(v.available, "loyalty:view holds the loyalty gate");
}

#[test]
fn verdict_names_lifecycle_for_an_expired_subscription() {
    let conn = fresh_db();
    seed_tier(&conn, "premium");
    // Long past both expiry and the 60-day enterprise/premium grace —
    // hard-expired.
    conn.execute(
        "UPDATE tenant_subscription SET status = 'active', expires_at = '2025-01-01T00:00:00Z'
         WHERE tenant_id = 'default'",
        [],
    )
    .unwrap();
    let v = verdict_with_owner(&conn, "supports_loyalty");
    assert!(!v.available);
    assert_eq!(v.reason_code(), Some("lifecycle"));
    assert_eq!(v.detail.state, "expired");
    assert_eq!(v.detail.expires_at.as_deref(), Some("2025-01-01T00:00:00Z"));
}

#[test]
fn verdict_in_grace_stays_available_and_carries_the_deadline() {
    let conn = fresh_db();
    seed_tier(&conn, "premium");
    // Expired 3 days ago: inside premium's 60-day grace window.
    let three_days_ago = (chrono::Utc::now() - chrono::Duration::days(3)).to_rfc3339();
    conn.execute(
        "UPDATE tenant_subscription SET status = 'active', expires_at = ?1
         WHERE tenant_id = 'default'",
        [three_days_ago],
    )
    .unwrap();
    let v = verdict_with_owner(&conn, "supports_loyalty");
    assert!(v.available, "grace passes operational entitlements (§B)");
    assert_eq!(v.reason_code(), None);
    assert_eq!(v.detail.state, "grace");
    assert!(v.detail.grace_until.is_some(), "UI renders the deadline");
}

#[test]
fn verdict_addon_grant_clears_the_tier_denial_for_analytics() {
    let conn = fresh_db();
    seed_tier(&conn, "plus");
    // Signed payload carrying the advanced_analytics add-on (C4.3).
    conn.execute(
        "UPDATE tenant_subscription SET signed_payload = ?1 WHERE tenant_id = 'default'",
        [r#"{"addons":["advanced_analytics"]}"#],
    )
    .unwrap();
    let v = verdict_with_owner(&conn, "supports_analytics");
    assert!(v.available, "the add-on answers the tier question");
    assert_eq!(v.reason_code(), None);
}

#[test]
fn verdict_rejects_unknown_keys_fail_closed() {
    let conn = fresh_db();
    assert!(matches!(
        load_feature_verdict(&conn, "nobody", "analytics"),
        Err(AppError::Invalid(_))
    ));
    assert!(matches!(
        load_feature_verdict(&conn, "nobody", "max_stores"),
        Err(AppError::Invalid(_))
    ));
}
