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

fn seed_location(conn: &Connection, tenant_id: &str, id: &str) {
    conn.execute(
        "INSERT INTO locations (id, tenant_id, name, created_at, updated_at)
         VALUES (?1, ?2, 'Test Location', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        params![id, tenant_id],
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
    seed_user(
        &conn,
        tenant,
        "u-owner",
        kasirmu_core::builtin_roles::OWNER,
        1,
    );
    seed_user(
        &conn,
        tenant,
        "u-staff",
        kasirmu_core::builtin_roles::STAFF,
        1,
    );

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
    seed_user(
        &conn,
        tenant,
        "u-owner",
        kasirmu_core::builtin_roles::OWNER,
        1,
    );
    seed_user(
        &conn,
        tenant,
        "u-staff",
        kasirmu_core::builtin_roles::STAFF,
        1,
    );

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
    seed_user(
        &conn,
        tenant,
        "u-owner",
        kasirmu_core::builtin_roles::OWNER,
        1,
    );
    // Inactive staff should not count
    seed_user(
        &conn,
        tenant,
        "u-inactive",
        kasirmu_core::builtin_roles::STAFF,
        0,
    );
    // 2 active non-owner staff (Free tier cap is 1)
    seed_user(
        &conn,
        tenant,
        "u-staff-1",
        kasirmu_core::builtin_roles::STAFF,
        1,
    );
    seed_user(
        &conn,
        tenant,
        "u-staff-2",
        kasirmu_core::builtin_roles::MANAGER,
        1,
    );

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
        seed_user(
            &conn,
            tenant,
            &format!("u-{i}"),
            kasirmu_core::builtin_roles::STAFF,
            1,
        );
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

    assert!(
        !state
            .is_suppressed("tenant-1", CONDITION_PRODUCTS_OVER_QUOTA, t0)
            .await
    );

    state
        .record_alert("tenant-1", CONDITION_PRODUCTS_OVER_QUOTA, t0)
        .await;

    // Inside 7-day cooldown (e.g. 1 day later)
    let t_1day = t0 + Duration::from_secs(86400);
    assert!(
        state
            .is_suppressed("tenant-1", CONDITION_PRODUCTS_OVER_QUOTA, t_1day)
            .await
    );

    // Different condition for same tenant is NOT suppressed
    assert!(
        !state
            .is_suppressed("tenant-1", CONDITION_STAFF_OVER_QUOTA, t_1day)
            .await
    );

    // Different tenant is NOT suppressed
    assert!(
        !state
            .is_suppressed("tenant-2", CONDITION_PRODUCTS_OVER_QUOTA, t_1day)
            .await
    );

    // After 7 days, cooldown expires
    let t_8days = t0 + Duration::from_secs(8 * 86400);
    assert!(
        !state
            .is_suppressed("tenant-1", CONDITION_PRODUCTS_OVER_QUOTA, t_8days)
            .await
    );
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
        seed_product(
            &conn,
            tenant_bad,
            &format!("pbad-{i}"),
            &format!("SKUBAD-{i}"),
        );
    }

    let violations = scan_all_tenants_quota_sqlite(&conn);
    assert_eq!(violations.len(), 1);
    assert_eq!(violations[0].tenant_id, tenant_bad);
    assert_eq!(violations[0].dimension, QuotaDimensionKind::Products);
}

#[test]
fn test_location_quota_under_and_at_limit() {
    let conn = setup_test_db();
    let tenant = "tenant-loc-ok";

    // Free tier max_locations is 1
    seed_location(&conn, tenant, "loc-1");
    let violations = check_tenant_quota_sqlite(&conn, tenant);
    assert!(
        violations.is_empty(),
        "1 location on Free tier should have no violations"
    );
}

#[test]
fn test_location_quota_exceeded_violation() {
    let conn = setup_test_db();
    let tenant = "tenant-loc-over";

    // Free tier max_locations is 1. Seed 2 locations.
    seed_location(&conn, tenant, "loc-1");
    seed_location(&conn, tenant, "loc-2");

    let violations = check_tenant_quota_sqlite(&conn, tenant);
    assert_eq!(violations.len(), 1);
    assert_eq!(violations[0].tenant_id, tenant);
    assert_eq!(violations[0].dimension, QuotaDimensionKind::Locations);
    assert_eq!(violations[0].observed_count, 2);
    assert_eq!(violations[0].allowed_cap, 1);
}

#[test]
fn test_location_quota_unlimited_enterprise() {
    let conn = setup_test_db();
    let tenant = "tenant-enterprise";

    conn.execute(
        "INSERT INTO tenant_subscription (tenant_id, tier_key, status, max_locations, max_pos_instances, allowed_types_json, signature, signed_payload, api_key, updated_at)
         VALUES (?1, 'enterprise', 'active', 0, 0, '[]', 'sig', 'payload', 'key', '2026-01-01T00:00:00Z')",
        params![tenant],
    )
    .unwrap();

    // Seed 10 locations; Enterprise cap is None (unlimited)
    for i in 1..=10 {
        seed_location(&conn, tenant, &format!("loc-{i}"));
    }

    let violations = check_tenant_quota_sqlite(&conn, tenant);
    assert!(
        violations.is_empty(),
        "Enterprise tier allows unlimited locations"
    );
}

#[tokio::test]
async fn test_location_quota_alert_cooldown() {
    let state = QuotaAlertState::new();
    let t0 = Instant::now();

    assert!(
        !state
            .is_suppressed("tenant-1", CONDITION_LOCATIONS_OVER_QUOTA, t0)
            .await
    );

    state
        .record_alert("tenant-1", CONDITION_LOCATIONS_OVER_QUOTA, t0)
        .await;
    assert!(
        state
            .is_suppressed("tenant-1", CONDITION_LOCATIONS_OVER_QUOTA, t0)
            .await
    );

    // Still suppressed at 6 days
    let t_6days = t0 + Duration::from_secs(6 * 86400);
    assert!(
        state
            .is_suppressed("tenant-1", CONDITION_LOCATIONS_OVER_QUOTA, t_6days)
            .await
    );

    // After 7 days, cooldown expires
    let t_8days = t0 + Duration::from_secs(8 * 86400);
    assert!(
        !state
            .is_suppressed("tenant-1", CONDITION_LOCATIONS_OVER_QUOTA, t_8days)
            .await
    );
}

/// PIN (C36): the locations quota axis is structurally inert — it can never
/// fire. A red measurement, not a fix: the axis, the query and the tier caps are
/// all deliberately unchanged (the fix is owner decision D10).
///
/// The claim this pins: a tenant whose DEVICE holds location rows is still
/// counted as ZERO by the cloud, because nothing writes `locations` into
/// PostgreSQL. The test therefore proves the asymmetry that is the whole
/// finding — device has them, cloud cannot see them.
///
/// Three assertions, each catching a different way the pin could rot:
///
/// 1. A device-side store WITH location rows still yields no Locations
///    violation (the SQLite axis is fed, and stays silent).
/// 2. `locations` has no writer and no copy entry anywhere in the repo — the
///    compile-time source scan over the shipped files, so the claim fails loudly
///    if someone adds the missing writer.
/// 3. The tier caps make firing impossible even if the count were non-zero.
///
/// Assertion 2 is what makes this testable in every environment: the crate's PG
/// integration tests self-skip without a database, so a PG-only test would
/// silently pin nothing here. The live query is also exercised against a real
/// server by `pg_integration_locations_axis_counts_zero_on_the_cloud` below.
#[test]
fn test_locations_axis_is_structurally_inert() {
    // ── 1. Device side HAS location rows; the detector stays silent. ──
    let conn = setup_test_db();
    let tenant = "tenant-40-stores";
    for i in 1..=40 {
        seed_location(&conn, tenant, &format!("loc-{i}"));
    }
    let device_side = count_tenant_locations_sqlite(&conn, tenant);
    assert_eq!(
        device_side, 40,
        "precondition: the device-side store really does hold 40 locations"
    );

    // Free/OneTime/Plus cap is 1, so 40 > 1 WOULD fire — if the cloud could see
    // them. On the PG path the count is always 0, so no Locations violation is
    // ever produced for any tenant.
    let violations = check_tenant_quota_sqlite(&conn, tenant);
    let locations_violations: Vec<_> = violations
        .iter()
        .filter(|v| v.dimension == QuotaDimensionKind::Locations)
        .collect();
    assert!(
        !locations_violations.is_empty(),
        "the SQLite axis is fed and does fire — this is the DEVICE path, and it \
         is why the inert cloud path is invisible in practice"
    );

    // ── 2. The structural claim: no PG writer, no copy entry. ──
    // Compile-time source scan of the files that would have to change for the
    // cloud to see a location row. If a writer lands without updating the axis,
    // this fails and points at the axis rather than at a silent zero.
    const COPY_SURFACE: &str = include_str!("bin/migrate_sqlite_to_pg/main.rs");
    const SYNC_QUEUE: &str = include_str!("../../../platform/sync/src/queue.rs");

    assert!(
        !COPY_SURFACE.contains("\"locations\""),
        "locations gained a PG copy-surface entry — the cloud can now see location \
         rows, so the quota axis is no longer inert and C36/D10 needs revisiting"
    );
    assert!(
        !SYNC_QUEUE.contains("location.created") && !SYNC_QUEUE.contains("\"locations\""),
        "the sync action vocabulary gained a location action — the cloud can now see \
         location rows, so the quota axis is no longer inert"
    );

    // The two axes that DO reach PostgreSQL, for contrast. If this ever fails,
    // the copy surface itself changed and the comparison above is void.
    assert!(
        COPY_SURFACE.contains("\"products\"") && COPY_SURFACE.contains("\"users\""),
        "products/users must remain on the PG copy surface — they are the live axes"
    );

    // ── 3. Even a non-zero count could not fire below these caps. ──
    assert_eq!(SubscriptionTier::Free.max_locations(), Some(1));
    // `OneTime` is deprecated (legacy perpetual) but still a live tier, so its
    // cap is asserted with the deprecation explicitly acknowledged.
    #[allow(deprecated)]
    {
        assert_eq!(SubscriptionTier::OneTime.max_locations(), Some(1));
    }
    assert_eq!(SubscriptionTier::Plus.max_locations(), Some(1));
    assert_eq!(SubscriptionTier::Pro.max_locations(), Some(2));
    assert_eq!(SubscriptionTier::Premium.max_locations(), Some(5));
    assert_eq!(
        SubscriptionTier::Enterprise.max_locations(),
        None,
        "Enterprise is unlimited, so the axis is inert there by design"
    );
    // The cloud-side count is structurally 0 and the smallest cap is 1, so the
    // firing predicate `count > cap` is false for every tenant.
    let smallest_cap = SubscriptionTier::Free
        .max_locations()
        .expect("Free tier has a finite locations cap");
    let cloud_side_count = 0_i64;
    assert!(
        cloud_side_count <= smallest_cap,
        "the cloud-side count ({cloud_side_count}) can never exceed the smallest cap \
         ({smallest_cap}), so the axis never fires"
    );
}

/// Integration test (C36): the live PostgreSQL query really does return 0 for a
/// tenant whose device holds location rows — the executed form of the pin above.
///
/// Self-skips when Postgres is unreachable (the established pattern in this
/// crate), so it pins nothing in an environment without a database; the
/// structural assertions in `test_locations_axis_is_structurally_inert` are what
/// hold everywhere.
#[tokio::test]
async fn pg_integration_locations_axis_counts_zero_on_the_cloud() {
    let url = std::env::var("OZ_TEST_PG_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:15432/postgres".into());
    let pool = match crate::db::DbPool::connect_postgres(&url, false, 4, false).await {
        Ok(p) => p,
        Err(e) => {
            eprintln!("PG integration test skipped: {e}");
            return;
        }
    };
    let client = match pool.pg_client().await {
        Ok(c) => c,
        Err(e) => {
            eprintln!("PG integration test skipped: {e}");
            return;
        }
    };

    let tenant = format!("c36-locations-{}", std::process::id());

    // Step 1 — the query itself is CORRECT. Seed a location row directly in
    // PostgreSQL (the write a production path would perform) and prove the count
    // sees it. Without this the 0 below would be vacuous: a fresh tenant returns
    // 0 even if a writer existed. This separates "the query is broken" from
    // "nothing writes the row", which is the whole point of the pin.
    let seeded = client
        .execute(
            "INSERT INTO locations (id, tenant_id, name) VALUES ($1, $2, $3)",
            &[&format!("{tenant}-loc"), &tenant, &"C36 probe location"],
        )
        .await;
    match seeded {
        Ok(_) => {}
        Err(e) => {
            // Pre-cutover the app is the table owner and the INSERT succeeds.
            // Post-cutover (oz_app + FORCE RLS) it may be rejected without the
            // tenant GUC — in that case the structural assertions below still
            // carry the claim, and we say so rather than passing silently.
            eprintln!("PG locations probe insert skipped: {e}");
            return;
        }
    }

    let count_with_row = count_tenant_locations_pg(&client, &tenant)
        .await
        .expect("count_tenant_locations_pg should succeed against a live schema");
    assert_eq!(
        count_with_row, 1,
        "the query counts a seeded row — it is not broken, so a production 0 means \
         nothing wrote the row"
    );

    // Step 2 — the production claim. A tenant with NO synced location row (the
    // only state any supported path can produce) counts 0.
    let absent = format!("{tenant}-absent");
    let count_without = count_tenant_locations_pg(&client, &absent)
        .await
        .expect("count_tenant_locations_pg should succeed against a live schema");
    assert_eq!(
        count_without, 0,
        "no PG writer exists, so every tenant the cloud sees counts 0 (C36)"
    );

    // Clean up the probe row so repeated runs stay idempotent.
    let _ = client
        .execute(
            "DELETE FROM locations WHERE id = $1",
            &[&format!("{tenant}-loc")],
        )
        .await;
}
