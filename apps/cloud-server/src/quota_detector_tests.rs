use super::*;
use rusqlite::Connection;

fn setup_test_db() -> Connection {
    let conn = kasirmu_core::migrations::fresh_db();
    conn.execute_batch(
        "INSERT OR IGNORE INTO roles (id, name, permissions) VALUES
         ('role-owner', 'Owner', '[]'),
         ('role-manager', 'Manager', '[]'),
         ('role-staff', 'Staff', '[]');",
    )
    .unwrap();
    conn
}

fn seed_product(conn: &Connection, tenant_id: &str, id: &str, sku: &str) {
    conn.execute(
        "INSERT INTO products (id, tenant_id, sku, name, price_minor, currency, is_active, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'Test Product', 1000, 'IDR', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        params![id, tenant_id, sku],
    )
    .unwrap();
}

fn seed_user(conn: &Connection, tenant_id: &str, id: &str, role_id: &str, is_active: i64) {
    conn.execute(
        "INSERT INTO users (id, tenant_id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'dummy_pin_hash', 'Test User', ?4, ?5, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        params![id, tenant_id, id, role_id, is_active],
    )
    .unwrap();
}

#[test]
fn test_resolve_tenant_tier_priority() {
    let conn = setup_test_db();

    // Default tenant without records resolves to Free
    assert_eq!(
        resolve_tenant_tier_sqlite(&conn, "tenant-unknown"),
        SubscriptionTier::Free
    );

    // Tenant in tenant_plans resolves to Pro
    conn.execute(
        "INSERT INTO tenant_plans (tenant_id, plan, updated_at) VALUES ('tenant-plans-pro', 'pro', '2026-01-01T00:00:00Z')",
        [],
    )
    .unwrap();
    assert_eq!(
        resolve_tenant_tier_sqlite(&conn, "tenant-plans-pro"),
        SubscriptionTier::Pro
    );

    // Tenant in tenant_subscription overrides tenant_plans
    conn.execute(
        "INSERT INTO tenant_plans (tenant_id, plan, updated_at) VALUES ('tenant-sub', 'free', '2026-01-01T00:00:00Z')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO tenant_subscription (tenant_id, tier_key, status, max_locations, max_pos_instances, allowed_types_json, signature, signed_payload, api_key, updated_at)
         VALUES ('tenant-sub', 'plus', 'active', 1, 2, '[]', 'sig', 'payload', 'key', '2026-01-01T00:00:00Z')",
        [],
    )
    .unwrap();
    assert_eq!(
        resolve_tenant_tier_sqlite(&conn, "tenant-sub"),
        SubscriptionTier::Plus
    );
}

#[test]
fn test_under_quota_no_violations() {
    let conn = setup_test_db();
    let tenant = "tenant-normal";

    // Seed 5 products (Free cap is 200)
    for i in 1..=5 {
        seed_product(&conn, tenant, &format!("p-{i}"), &format!("SKU-{i}"));
    }

    // Seed 1 owner, 1 active staff (Free staff cap is 1)
    seed_user(&conn, tenant, "u-owner", kasirmu_core::builtin_roles::OWNER, 1);
    seed_user(&conn, tenant, "u-staff", kasirmu_core::builtin_roles::STAFF, 1);

    let violations = check_tenant_quota_sqlite(&conn, tenant);
    assert!(violations.is_empty(), "expected no violations under quota");
}

#[test]
fn test_at_quota_limit_no_violations() {
    let conn = setup_test_db();
    let tenant = "tenant-at-limit";

    // Free tier max_products = 200
    for i in 1..=200 {
        seed_product(&conn, tenant, &format!("p-{i}"), &format!("SKU-{i}"));
    }
    // Free tier max_staff_users = 1
    seed_user(&conn, tenant, "u-owner", kasirmu_core::builtin_roles::OWNER, 1);
    seed_user(&conn, tenant, "u-staff", kasirmu_core::builtin_roles::STAFF, 1);

    let violations = check_tenant_quota_sqlite(&conn, tenant);
    assert!(
        violations.is_empty(),
        "expected no violations when exactly at quota cap"
    );
}

#[test]
fn test_products_over_quota_detected() {
    let conn = setup_test_db();
    let tenant = "tenant-products-over";

    // Free tier max_products = 200, seed 201 products
    for i in 1..=201 {
        seed_product(&conn, tenant, &format!("p-{i}"), &format!("SKU-{i}"));
    }

    let violations = check_tenant_quota_sqlite(&conn, tenant);
    assert_eq!(violations.len(), 1);
    let v = &violations[0];
    assert_eq!(v.tenant_id, tenant);
    assert_eq!(v.tier, SubscriptionTier::Free);
    assert_eq!(v.dimension, QuotaDimensionKind::Products);
    assert_eq!(v.observed_count, 201);
    assert_eq!(v.allowed_cap, 200);
}

#[test]
fn test_staff_over_quota_detected_excludes_owner_and_inactive() {
    let conn = setup_test_db();
    let tenant = "tenant-staff-over";

    // Owner should not count towards staff quota
    seed_user(&conn, tenant, "u-owner", kasirmu_core::builtin_roles::OWNER, 1);
    // Inactive staff should not count
    seed_user(&conn, tenant, "u-inactive", kasirmu_core::builtin_roles::STAFF, 0);
    // 2 active non-owner staff (Free tier cap is 1)
    seed_user(&conn, tenant, "u-staff-1", kasirmu_core::builtin_roles::STAFF, 1);
    seed_user(&conn, tenant, "u-staff-2", kasirmu_core::builtin_roles::MANAGER, 1);

    let violations = check_tenant_quota_sqlite(&conn, tenant);
    assert_eq!(violations.len(), 1);
    let v = &violations[0];
    assert_eq!(v.tenant_id, tenant);
    assert_eq!(v.dimension, QuotaDimensionKind::Staff);
    assert_eq!(v.observed_count, 2);
    assert_eq!(v.allowed_cap, 1);
}

#[test]
fn test_unlimited_tier_no_violations() {
    let conn = setup_test_db();
    let tenant = "tenant-enterprise";

    conn.execute(
        "INSERT INTO tenant_subscription (tenant_id, tier_key, status, max_locations, max_pos_instances, allowed_types_json, signature, signed_payload, api_key, updated_at)
         VALUES (?1, 'enterprise', 'active', 0, 0, '[]', 'sig', 'payload', 'key', '2026-01-01T00:00:00Z')",
        params![tenant],
    )
    .unwrap();

    // 250 products (exceeds Free/Plus, but Enterprise is unlimited)
    for i in 1..=250 {
        seed_product(&conn, tenant, &format!("p-{i}"), &format!("SKU-{i}"));
    }
    // 10 staff
    for i in 1..=10 {
        seed_user(&conn, tenant, &format!("u-{i}"), kasirmu_core::builtin_roles::STAFF, 1);
    }

    let violations = check_tenant_quota_sqlite(&conn, tenant);
    assert!(
        violations.is_empty(),
        "unlimited Enterprise tier must never report quota violations"
    );
}

#[tokio::test]
async fn test_alert_cooldown_state() {
    let state = QuotaAlertState::new();
    let t0 = Instant::now();

    assert!(!state.is_suppressed("tenant-1", CONDITION_PRODUCTS_OVER_QUOTA, t0).await);

    state.record_alert("tenant-1", CONDITION_PRODUCTS_OVER_QUOTA, t0).await;

    // Inside 7-day cooldown (e.g. 1 day later)
    let t_1day = t0 + Duration::from_secs(86400);
    assert!(state.is_suppressed("tenant-1", CONDITION_PRODUCTS_OVER_QUOTA, t_1day).await);

    // Different condition for same tenant is NOT suppressed
    assert!(!state.is_suppressed("tenant-1", CONDITION_STAFF_OVER_QUOTA, t_1day).await);

    // Different tenant is NOT suppressed
    assert!(!state.is_suppressed("tenant-2", CONDITION_PRODUCTS_OVER_QUOTA, t_1day).await);

    // After 7 days, cooldown expires
    let t_8days = t0 + Duration::from_secs(8 * 86400);
    assert!(!state.is_suppressed("tenant-1", CONDITION_PRODUCTS_OVER_QUOTA, t_8days).await);
}

#[test]
fn test_render_quota_alert_invariants() {
    let v = TenantQuotaViolation {
        tenant_id: "test-tenant-123".into(),
        tier: SubscriptionTier::Free,
        dimension: QuotaDimensionKind::Products,
        observed_count: 215,
        allowed_cap: 200,
    };

    let (subject, body) = render_quota_alert(&v);
    assert!(subject.contains("products"));
    assert!(body.contains("test-tenant-123"));
    assert!(body.contains("215 active"));
    assert!(body.contains("200"));
    assert!(body.contains("Free"));
    assert!(body.contains("This is a SIGNAL, not proof of wrongdoing"));
    assert!(body.contains("Nothing has been locked"));
    assert!(body.contains("never auto-terminates"));
}

#[test]
fn test_scan_all_tenants_sqlite() {
    let conn = setup_test_db();
    let tenant_ok = "tenant-clean";
    let tenant_bad = "tenant-over";

    // Tenant OK: 10 products
    for i in 1..=10 {
        seed_product(&conn, tenant_ok, &format!("pok-{i}"), &format!("SKUOK-{i}"));
    }

    // Tenant BAD: 205 products (Free tier cap is 200)
    for i in 1..=205 {
        seed_product(&conn, tenant_bad, &format!("pbad-{i}"), &format!("SKUBAD-{i}"));
    }

    let violations = scan_all_tenants_quota_sqlite(&conn);
    assert_eq!(violations.len(), 1);
    assert_eq!(violations[0].tenant_id, tenant_bad);
    assert_eq!(violations[0].dimension, QuotaDimensionKind::Products);
}
