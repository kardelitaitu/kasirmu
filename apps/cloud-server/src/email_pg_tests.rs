use super::*;
use oz_core::export::email_report::SMTP_CONFIG_SETTINGS_KEY;
use serial_test::serial;

/// Create a process-unique throwaway database (the established pattern for
/// tests that mutate global catalog state — roles, FORCE RLS — which would
/// otherwise race the other PG integration tests on a shared dev DB).
///
/// Returns `(db_url, db_name, admin_pool)`; the admin pool stays connected
/// to the base DB so the caller can `DROP DATABASE` on cleanup. Returns
/// `None` (test skips) when Postgres is unreachable or the URL role lacks
/// `CREATE DATABASE`.
async fn throwaway_pg_db(
    url: &str,
    prefix: &str,
) -> Option<(String, String, deadpool_postgres::Pool)> {
    // Admin connection is raw (apply_schema = false): it only sweeps stale
    // DBs and creates the throwaway one, so it must not re-apply PG_INIT
    // to the shared base DB (concurrent catalog DDL across parallel PG
    // test binaries is a flake source).
    let admin_pool = match crate::db::DbPool::connect_postgres(url, false, 20, false).await {
        Ok(crate::db::DbPool::Postgres(p)) => p,
        Ok(_) => unreachable!("connect_postgres with a postgres:// URL returns Postgres"),
        Err(e) => {
            eprintln!("PG test skipped: {e}");
            return None;
        }
    };
    let admin = admin_pool.get().await.expect("admin client");

    // Sweep any stale throwaway DBs a crashed run left behind (only
    // tests create `{prefix}_%`), so the fixed-name probe role never
    // owns objects in a leftover DB — DROP ROLE would then fail.
    let stale: Vec<String> = admin
        .query(
            "SELECT datname FROM pg_database WHERE datname LIKE $1",
            &[&format!("{prefix}\\_%")],
        )
        .await
        .expect("stale database query")
        .iter()
        .map(|r| r.get::<_, String>(0))
        .collect();
    for d in &stale {
        admin
            .batch_execute(&format!("DROP DATABASE IF EXISTS {d} WITH (FORCE);"))
            .await
            .expect("drop stale test database");
    }

    // A crashed earlier run (before the throwaway-DB refactor) may have
    // left the fixed-name probe roles owning objects in the BASE database.
    // DROP OWNED BY releases those so the role setup's DROP ROLE succeeds.
    // NOTE: `oz_email_discovery` is deliberately NOT dropped here — it is a
    // cluster-wide role that production code (`SET LOCAL ROLE
    // oz_email_discovery`) depends on, and nextest runs each test in its own
    // process, so dropping it from this helper would race a concurrent test
    // that is mid-flight using it (the observed flake). It is created
    // idempotently (`IF NOT EXISTS`) and owns nothing, so it is safe to
    // leave in place across test runs.
    for role in ["oz_email_rls_probe", "oz_email_tenants_probe"] {
        let _ = admin.batch_execute(&format!("DROP OWNED BY {role};")).await;
        let _ = admin
            .batch_execute(&format!("DROP ROLE IF EXISTS {role};"))
            .await;
    }

    let db_name = format!("{prefix}_{}", std::process::id());
    admin
        .batch_execute(&format!("DROP DATABASE IF EXISTS {db_name} WITH (FORCE);"))
        .await
        .expect("drop stale database should succeed");
    if let Err(e) = admin
        .execute(&format!("CREATE DATABASE {db_name}"), &[])
        .await
    {
        eprintln!("PG test skipped: cannot CREATE DATABASE ({e})");
        return None;
    }

    // URL for the throwaway DB (swap the path segment, keep any query).
    let (base, query) = match url.split_once('?') {
        Some((b, q)) => (b, Some(q)),
        None => (url, None),
    };
    let (head, _old_db) = base
        .rsplit_once('/')
        .expect("URL must have a database path");
    let db_url = match query {
        Some(q) => format!("{head}/{db_name}?{q}"),
        None => format!("{head}/{db_name}"),
    };
    Some((db_url, db_name, admin_pool))
}

/// Integration test against a live Postgres instance — seeds a product,
/// a completed sale with lines, stock, and the settings the loop reads,
/// then exercises the whole analytics bundle + settings helpers on the
/// real database. Skips when Postgres is unreachable.
///
/// Uses a throwaway database so the 20-connection pool does not exhaust
/// the shared dev DB's `max_connections` when run concurrently with other
/// PG tests (the pre-existing "PG connection pool contention" flake).
#[tokio::test]
async fn pg_integration_email_loop_reads_postgres() {
    let url = std::env::var("OZ_TEST_PG_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:15432/postgres".into());

    let Some((db_url, db_name, admin_pool)) = throwaway_pg_db(&url, "oz_email_loop").await else {
        return;
    };

    let pool = match crate::db::DbPool::connect_postgres(&db_url, false, 20, true).await {
        Ok(crate::db::DbPool::Postgres(pool)) => pool,
        Ok(_) => unreachable!("connect_postgres with a postgres:// URL returns Postgres"),
        Err(e) => {
            eprintln!("PG email-loop integration test skipped: {e}");
            return;
        }
    };

    let ns = format!("pg-email-test-{}", uuid::Uuid::now_v7());
    let product_id = format!("{ns}-product");
    let sku = format!("{ns}-sku");
    let category_id = format!("{ns}-cat");
    let sale_id = format!("{ns}-sale");
    let sale_line_id = format!("{ns}-line");
    // Use a fixed January date so parallel PG tests writing "today"
    // rows (webhooks, REST roundtrip) can never land inside this
    // test's analytics window.
    let now = "2026-01-15T09:00:00.000Z";

    // Clean up any leftovers from previous (failed) runs so assertions
    // count only this run's seeded rows.
    {
        let client = pool.get().await.unwrap();
        for sql in [
            "DELETE FROM sale_lines WHERE id LIKE 'pg-email-test-%'",
            "DELETE FROM sales WHERE id LIKE 'pg-email-test-%'",
            "DELETE FROM stock_summary WHERE item_id LIKE 'pg-email-test-%'",
            "DELETE FROM products WHERE id LIKE 'pg-email-test-%'",
            "DELETE FROM categories WHERE name LIKE 'pg-email-test-%'",
            "DELETE FROM settings WHERE key IN ('store.name', 'smtp_config', 'report_schedule', 'last_report_sent_at') AND value LIKE 'pg-email-test-%'",
        ] {
            client.execute(sql, &[]).await.unwrap();
        }
    }

    // ── Seed ──────────────────────────────────────────────────────
    let mut client = pool.get().await.unwrap();
    let tx = client.transaction().await.unwrap();
    let category_name = format!("{ns} Cat");
    tx.execute(
        "INSERT INTO categories (id, name, colour, icon, created_at, updated_at) VALUES ($1, $2, '#fff', '', $3, $3)",
        &[&category_id, &category_name, &now],
    )
    .await
    .unwrap();
    let barcode = format!("{ns}-barcode");
    tx.execute(
        "INSERT INTO products (id, sku, name, price_minor, currency, category_id, barcode, \
         created_at, updated_at, price_updated_at, track_serial, product_type, version, \
         cost_minor, brand, rack_location, notes, unit, is_active, default_supplier_id, tenant_id)
         VALUES ($1, $2, 'Cold Brew', 5000, 'USD', $3, $4, $5, $5, $5, 0, 'retail', 1, 2000, NULL, NULL, NULL, NULL, 1, NULL, 'default')",
        &[&product_id, &sku, &category_id, &barcode, &now],
    )
    .await
    .unwrap();
    tx.execute(
        "INSERT INTO stock_summary (item_id, location_id, qty, updated_at) VALUES ($1, $2, 4, $3)",
        &[
            &product_id,
            &oz_core::inventory::CANONICAL_DEFAULT_LOCATION_UUID,
            &now,
        ],
    )
    .await
    .unwrap();
    tx.execute(
        "INSERT INTO sales (id, total_minor, currency, line_count, status, payment_method, tendered_minor, \
         discount_percent, discount_label, user_id, created_at, updated_at, subtotal_minor, \
         tax_total_minor, customer_id, version)
         VALUES ($1, 5000, 'USD', 1, 'completed', 'cash', 5000, 0, NULL, NULL, $2, $2, 5000, 0, NULL, 1)",
        &[&sale_id, &now],
    )
    .await
    .unwrap();
    tx.execute(
        "INSERT INTO sale_lines (id, sale_id, sku, qty, unit_minor, line_minor, currency, line_position, \
         tax_minor, tax_rate_id, serial_number, store_id, course, modifiers_json, tax_breakdown_json, cost_minor)
         VALUES ($1, $2, $3, 1, 5000, 5000, 'USD', 1, 0, NULL, NULL, NULL, NULL, NULL, NULL, 2000)",
        &[&sale_line_id, &sale_id, &sku],
    )
    .await
    .unwrap();
    tx.execute(
        "INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, $3)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at",
        &[&"store.name", &format!("{ns} Store"), &now],
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();

    // ── Exercise the analytics bundle ─────────────────────────────
    let config = ExportConfig {
        start_date: "2026-01-01".into(),
        end_date: "2026-01-31".into(),
        top_product_limit: 25,
        low_stock_threshold: 10,
    };
    let bundle = export_analytics_bundle_pg(&pool, config, "default", &format!("{ns} Store"))
        .await
        .unwrap();

    // Daily revenue: one completed sale of 5000 minor units.
    assert_eq!(bundle.daily_revenue.len(), 1);
    assert_eq!(bundle.daily_revenue[0].date, "2026-01-15");
    assert_eq!(bundle.daily_revenue[0].total_minor, 5000);
    assert_eq!(bundle.daily_revenue[0].sale_count, 1);
    assert_eq!(bundle.daily_revenue[0].cogs_minor, 2000);
    assert_eq!(bundle.daily_revenue[0].gross_profit_minor, 3000);

    // Weekly revenue: same sale in the week of 2026-01-12 (Monday).
    assert_eq!(bundle.weekly_revenue.len(), 1);
    assert_eq!(bundle.weekly_revenue[0].week_start, "2026-01-12");
    assert_eq!(bundle.weekly_revenue[0].total_minor, 5000);

    // Monthly revenue: 2026-01.
    assert_eq!(bundle.monthly_revenue.len(), 1);
    assert_eq!(bundle.monthly_revenue[0].month, "2026-01");
    assert_eq!(bundle.monthly_revenue[0].total_minor, 5000);

    // Top products: the seeded SKU with qty 1, revenue 5000, COGS 2000.
    assert_eq!(bundle.top_products.len(), 1);
    assert_eq!(bundle.top_products[0].sku, sku);
    assert_eq!(bundle.top_products[0].total_qty, 1);
    assert_eq!(bundle.top_products[0].total_minor, 5000);
    assert_eq!(bundle.top_products[0].cogs_minor, 2000);
    assert_eq!(bundle.top_products[0].gross_profit_minor, 3000);

    // Hourly heatmap: Sunday=0, the sale is at 09:00 UTC on a Thursday.
    assert!(
        bundle
            .hourly_heatmap
            .iter()
            .any(|h| h.day_of_week == 4 && h.hour == 9)
    );

    // Category breakdown: the seeded category, 5000 minor units.
    assert_eq!(bundle.category_breakdown.len(), 1);
    assert_eq!(
        bundle.category_breakdown[0].category_name,
        format!("{ns} Cat")
    );
    assert_eq!(bundle.category_breakdown[0].total_minor, 5000);
    assert_eq!(bundle.category_breakdown[0].percentage, 100.0);

    // Low stock: qty 4 ≤ threshold 10.
    assert!(
        bundle
            .low_stock_alerts
            .iter()
            .any(|a| a.sku == sku && a.current_qty == 4 && a.threshold == 10)
    );

    // Popularity + forecast are computed (may be empty without activity —
    // the typed bundle field is present by construction, so no claim is
    // made about row counts here).

    // ── Settings round-trip (SMTP config + schedule + dedup key) ──
    let smtp = SmtpConfig {
        host: "smtp.test.com".into(),
        port: 587,
        username: Some("u".into()),
        password: Some("pw".into()),
        from: "reports@test.com".into(),
        use_tls: true,
    };
    set_setting_pg(
        &pool,
        SMTP_CONFIG_SETTINGS_KEY,
        &serde_json::to_string(&smtp).unwrap(),
    )
    .await
    .unwrap();
    let loaded = get_smtp_config_pg(&pool, "default").await.unwrap().unwrap();
    assert_eq!(loaded.host, "smtp.test.com");
    assert_eq!(loaded.password, Some("pw".into()));

    let schedule = ReportScheduleConfig {
        enabled: true,
        cadence: "daily".into(),
        report_types: vec!["daily_revenue".into()],
        recipients: vec!["a@b.c".into()],
        send_at_time: "08:00".into(),
        timezone: "UTC".into(),
        lookback_days: 7,
    };
    set_setting_pg(
        &pool,
        REPORT_SCHEDULE_SETTINGS_KEY,
        &serde_json::to_string(&schedule).unwrap(),
    )
    .await
    .unwrap();
    let loaded = get_report_schedule_pg(&pool, "default")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(loaded.cadence, "daily");
    assert_eq!(loaded.recipients, vec!["a@b.c".to_string()]);

    assert_eq!(
        get_store_name_pg(&pool, "default").await.unwrap(),
        format!("{ns} Store")
    );
    assert_eq!(get_setting_pg(&pool, LAST_SENT_KEY).await.unwrap(), None);

    // ── Shared SKU across tenants: joins must resolve within each
    //    sale's tenant, never cross into the other tenant's product ──
    let product_b_id = format!("{ns}-product-b");
    let sale_b_id = format!("{ns}-sale-b");
    let sale_b_line_id = format!("{ns}-line-b");
    let now_b = "2026-01-16T09:00:00.000Z";
    {
        let mut client = pool.get().await.unwrap();
        let tx = client.transaction().await.unwrap();
        // Same SKU as tenant A's product, but owned by tenant-b with a
        // very different cost (9999 vs 2000) — if the COGS/popularity
        // joins were sku-only, A's rows would pick up B's cost.
        tx.execute(
            "INSERT INTO products (id, sku, name, price_minor, currency, category_id, barcode, \
             created_at, updated_at, price_updated_at, track_serial, product_type, version, \
             cost_minor, brand, rack_location, notes, unit, is_active, default_supplier_id, tenant_id)
             VALUES ($1, $2, 'Tenant B Cold Brew', 5000, 'USD', NULL, NULL, $3, $3, $3, 0, 'retail', 1, 9999, NULL, NULL, NULL, NULL, 1, NULL, 'tenant-b')",
            &[&product_b_id, &sku, &now_b],
        )
        .await
        .unwrap();
        tx.execute(
            "INSERT INTO sales (id, total_minor, currency, line_count, status, payment_method, tendered_minor, \
             discount_percent, discount_label, user_id, created_at, updated_at, subtotal_minor, \
             tax_total_minor, customer_id, version, tenant_id)
             VALUES ($1, 5000, 'USD', 1, 'completed', 'cash', 5000, 0, NULL, NULL, $2, $2, 5000, 0, NULL, 1, 'tenant-b')",
            &[&sale_b_id, &now_b],
        )
        .await
        .unwrap();
        tx.execute(
            "INSERT INTO sale_lines (id, sale_id, sku, qty, unit_minor, line_minor, currency, line_position, \
             tax_minor, tax_rate_id, serial_number, store_id, course, modifiers_json, tax_breakdown_json, cost_minor)
             VALUES ($1, $2, $3, 1, 5000, 5000, 'USD', 1, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL)",
            &[&sale_b_line_id, &sale_b_id, &sku],
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();
    }

    // ── Tenant-filtered aggregation: each tenant's bundle sees ONLY its
    //    own sales, even when both tenants' sales sit in the same window
    //    and share a SKU (previously tenant_id only labelled metadata) ──
    let config2 = ExportConfig {
        start_date: "2026-01-01".into(),
        end_date: "2026-01-31".into(),
        top_product_limit: 25,
        low_stock_threshold: 10,
    };
    let bundle_default =
        export_analytics_bundle_pg(&pool, config2.clone(), "default", &format!("{ns} Store"))
            .await
            .unwrap();
    assert_eq!(
        bundle_default.daily_revenue.len(),
        1,
        "default must not see tenant-b's sale in its aggregation"
    );
    assert_eq!(
        (
            bundle_default.daily_revenue[0].total_minor,
            bundle_default.daily_revenue[0].cogs_minor
        ),
        (5000, 2000)
    );
    assert_eq!(bundle_default.top_products.len(), 1);
    assert_eq!(bundle_default.top_products[0].cogs_minor, 2000);

    let bundle_b = export_analytics_bundle_pg(&pool, config2, "tenant-b", "Tenant B Store")
        .await
        .unwrap();
    assert_eq!(
        bundle_b.daily_revenue.len(),
        1,
        "tenant-b must not see default's sale in its aggregation"
    );
    // B's day resolves B's product cost (9999) via the sale's tenant —
    // the join AND the WHERE filter both stay inside the tenant.
    assert_eq!(
        (
            bundle_b.daily_revenue[0].total_minor,
            bundle_b.daily_revenue[0].cogs_minor
        ),
        (5000, 9999)
    );
    assert_eq!(bundle_b.top_products.len(), 1);
    assert_eq!(bundle_b.top_products[0].cogs_minor, 9999);

    // ── Per-tenant scoped settings (suffix keys, bare-key fallback) ──
    set_setting_scoped_pg(&pool, "store.name", &format!("{ns} B Store"), "tenant-b")
        .await
        .unwrap();
    assert_eq!(
        get_store_name_pg(&pool, "tenant-b").await.unwrap(),
        format!("{ns} B Store"),
        "scoped key must win for tenant-b"
    );
    assert_eq!(
        get_store_name_pg(&pool, "default").await.unwrap(),
        format!("{ns} Store"),
        "default must keep reading the bare key"
    );
    // Remove the scoped key: the read falls back to the bare key.
    {
        let client = pool.get().await.unwrap();
        client
            .execute(
                "DELETE FROM settings WHERE key = $1",
                &[&scoped_key("store.name", "tenant-b")],
            )
            .await
            .unwrap();
    }
    assert_eq!(
        get_store_name_pg(&pool, "tenant-b").await.unwrap(),
        format!("{ns} Store"),
        "missing scoped key must fall back to the bare key"
    );

    // ── Loop decision paths (no SMTP involved) ──────────────────────
    // Tenant enumeration: `default` first, then the data-derived set
    // (offline_queue carries tenant-b).
    {
        let client = pool.get().await.unwrap();
        client
            .execute(
                "INSERT INTO offline_queue (id, action, payload, tenant_id)
                 VALUES ($1, 'test', '{}', 'tenant-b')",
                &[&format!("{ns}-queue")],
            )
            .await
            .unwrap();
    }
    let tenants = active_tenants_pg(&pool).await.unwrap();
    // The shared dev DB legitimately holds data-derived tenants from
    // other tests (e.g. the migration-bin integration test), so assert
    // the ordering properties — `default` first, this test's tenant
    // enumerated — not the exact list.
    assert_eq!(
        tenants.first(),
        Some(&"default".to_string()),
        "default must sort first in the tenant enumeration"
    );
    assert!(
        tenants.contains(&"tenant-b".to_string()),
        "tenant-b (data-derived via offline_queue) must be enumerated"
    );

    // Tenant-b has scoped SMTP + schedule + a future last-sent → not
    // due → the cycle returns Ok without attempting SMTP. `send_at_time`
    // is set 5 minutes ahead so the time-of-day gate is deterministic
    // regardless of when the suite runs.
    let send_at = (Utc::now() + chrono::Duration::minutes(5))
        .format("%H:%M")
        .to_string();
    let schedule_b = ReportScheduleConfig {
        enabled: true,
        cadence: "daily".into(),
        report_types: vec!["daily_revenue".into()],
        recipients: vec!["b@b.c".into()],
        send_at_time: send_at,
        timezone: "UTC".into(),
        lookback_days: 7,
    };
    set_setting_scoped_pg(
        &pool,
        SMTP_CONFIG_SETTINGS_KEY,
        &serde_json::to_string(&smtp).unwrap(),
        "tenant-b",
    )
    .await
    .unwrap();
    set_setting_scoped_pg(
        &pool,
        REPORT_SCHEDULE_SETTINGS_KEY,
        &serde_json::to_string(&schedule_b).unwrap(),
        "tenant-b",
    )
    .await
    .unwrap();
    set_setting_scoped_pg(&pool, LAST_SENT_KEY, "2099-01-01T00:00:00Z", "tenant-b")
        .await
        .unwrap();
    try_send_scheduled_for_tenant_pg(&pool, "tenant-b")
        .await
        .expect("already-sent tenant must short-circuit before SMTP");

    // A tenant with no scoped or bare config is skipped, not errored.
    try_send_scheduled_for_tenant_pg(&pool, "no-such-tenant")
        .await
        .expect("tenant without config must be skipped cleanly");

    // ── Cleanup ────────────────────────────────────────────────────
    // The throwaway database is dropped wholesale; row-level deletes are
    // unnecessary (the DB is process-unique). DROP DATABASE cannot run
    // inside a transaction — separate statements.
    drop(pool);
    let admin = admin_pool.get().await.expect("admin client for cleanup");
    admin
        .batch_execute(&format!("DROP DATABASE IF EXISTS {db_name} WITH (FORCE);"))
        .await
        .expect("drop throwaway email-loop DB should succeed");
}

// ── sent_reports dedup (at-most-once send) ─────────────────────

/// The dedup key must be stable per cadence: daily/weekly → the day
/// (weekly on its Monday), monthly → the month — so a crash + retry
/// always recomputes the same key for the same scheduled slot.
#[test]
fn period_for_schedule_buckets_by_cadence() {
    // 2026-01-15 is a Thursday; the Monday of that week is 2026-01-12.
    let now_tz = chrono::DateTime::parse_from_rfc3339("2026-01-15T09:00:00+00:00").unwrap();
    let base = || ReportScheduleConfig {
        enabled: true,
        cadence: "daily".into(),
        report_types: vec!["daily_revenue".into()],
        recipients: vec!["a@b.c".into()],
        send_at_time: "08:00".into(),
        timezone: "UTC".into(),
        lookback_days: 7,
    };

    let mut daily = base();
    daily.cadence = "daily".into();
    assert_eq!(period_for_schedule(&daily, now_tz), "2026-01-15");

    let mut weekly = base();
    weekly.cadence = "weekly".into();
    assert_eq!(period_for_schedule(&weekly, now_tz), "2026-01-12");

    let mut monthly = base();
    monthly.cadence = "monthly".into();
    assert_eq!(period_for_schedule(&monthly, now_tz), "2026-01");
}

/// Claim/release semantics against a live Postgres: the first claim
/// wins, a second claim for the same period loses (that is the
/// crash-recovery dedup), a different period is independent, and
/// releasing a failed claim lets the period retry.
#[tokio::test]
async fn pg_integration_sent_reports_claim_release() {
    let url = std::env::var("OZ_TEST_PG_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:15432/postgres".into());
    let pool = match crate::db::DbPool::connect_postgres(&url, false, 20, true).await {
        Ok(crate::db::DbPool::Postgres(pool)) => pool,
        Ok(_) => unreachable!("connect_postgres with a postgres:// URL returns Postgres"),
        Err(e) => {
            eprintln!("PG sent_reports integration test skipped: {e}");
            return;
        }
    };
    let tenant = format!("pg-sr-test-{}", uuid::Uuid::now_v7());
    let period = "2026-01-15";
    {
        let client = pool.get().await.unwrap();
        client
            .execute("DELETE FROM sent_reports WHERE tenant_id = $1", &[&tenant])
            .await
            .unwrap();
    }

    // First claim wins.
    assert!(
        claim_period_pg(&pool, &tenant, period, "id-1")
            .await
            .unwrap()
    );
    // The same period is already claimed — a restart or racing
    // instance must skip it.
    assert!(
        !claim_period_pg(&pool, &tenant, period, "id-2")
            .await
            .unwrap()
    );
    // A different period is independent.
    assert!(
        claim_period_pg(&pool, &tenant, "2026-01-16", "id-3")
            .await
            .unwrap()
    );
    // Releasing a failed claim lets the period retry.
    release_period_pg(&pool, &tenant, period).await.unwrap();
    assert!(
        claim_period_pg(&pool, &tenant, period, "id-4")
            .await
            .unwrap()
    );

    let client = pool.get().await.unwrap();
    client
        .execute("DELETE FROM sent_reports WHERE tenant_id = $1", &[&tenant])
        .await
        .unwrap();
}

/// The loop must skip an already-claimed period BEFORE sending: with a
/// due schedule (send_at_time = now) and the period pre-claimed, the
/// inner cycle returns Ok without ever attempting SMTP — proving a
/// crash after a successful send can never re-send the report.
#[tokio::test]
async fn pg_integration_sent_reports_skips_claimed_period_before_smtp() {
    let url = std::env::var("OZ_TEST_PG_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:15432/postgres".into());
    let pool = match crate::db::DbPool::connect_postgres(&url, false, 20, true).await {
        Ok(crate::db::DbPool::Postgres(pool)) => pool,
        Ok(_) => unreachable!("connect_postgres with a postgres:// URL returns Postgres"),
        Err(e) => {
            eprintln!("PG sent_reports integration test skipped: {e}");
            return;
        }
    };
    let ns = format!("pg-sr-skip-{}", uuid::Uuid::now_v7());
    let tenant = format!("{ns}-t");
    let now = Utc::now();
    // A due schedule: send_at_time is the current minute, so the
    // scheduler's 2-minute time-of-day gate passes deterministically.
    let schedule = ReportScheduleConfig {
        enabled: true,
        cadence: "daily".into(),
        report_types: vec!["daily_revenue".into()],
        recipients: vec!["x@y.z".into()],
        send_at_time: now.format("%H:%M").to_string(),
        timezone: "UTC".into(),
        lookback_days: 7,
    };
    let period = period_for_schedule(&schedule, resolve_now_in_timezone(&schedule.timezone));
    {
        let client = pool.get().await.unwrap();
        client
            .execute("DELETE FROM sent_reports WHERE tenant_id = $1", &[&tenant])
            .await
            .unwrap();
        // Scoped SMTP + schedule, no last-sent, and the period already
        // claimed (as if a crashed earlier attempt had sent it).
        for (key, value) in [
            (
                scoped_key(SMTP_CONFIG_SETTINGS_KEY, &tenant),
                serde_json::to_string(&SmtpConfig {
                    host: "smtp.invalid".into(),
                    port: 25,
                    username: None,
                    password: None,
                    from: "r@x.yz".into(),
                    use_tls: false,
                })
                .unwrap(),
            ),
            (
                scoped_key(REPORT_SCHEDULE_SETTINGS_KEY, &tenant),
                serde_json::to_string(&schedule).unwrap(),
            ),
        ] {
            set_setting_pg(&pool, &key, &value).await.unwrap();
        }
        claim_period_pg(&pool, &tenant, &period, "crashed-attempt")
            .await
            .unwrap();
    }

    // If the dedup fails, this would attempt SMTP to smtp.invalid and
    // return Err — Ok proves the skip happened before any send.
    try_send_scheduled_tenant_inner_pg(&pool, &tenant)
        .await
        .expect("already-claimed period must skip before SMTP");

    // Cleanup.
    let client = pool.get().await.unwrap();
    for (sql, key) in [
        (
            "DELETE FROM settings WHERE key = $1",
            scoped_key(SMTP_CONFIG_SETTINGS_KEY, &tenant),
        ),
        (
            "DELETE FROM settings WHERE key = $1",
            scoped_key(REPORT_SCHEDULE_SETTINGS_KEY, &tenant),
        ),
    ] {
        client.execute(sql, &[&key]).await.unwrap();
    }
    client
        .execute("DELETE FROM sent_reports WHERE tenant_id = $1", &[&tenant])
        .await
        .unwrap();
}

/// The advisory lock must not leak onto a pooled connection (Bug 2).
///
/// `pg_try_advisory_lock` is session-level: if the lock holder's
/// connection is returned to the pool still holding the lock, the next
/// borrower inherits it and that tenant's email cycle is blocked
/// forever. The RAII guard must release on the normal path, and on the
/// panic path must detach/close the connection so the lock dies with
/// the session.
#[tokio::test]
async fn pg_integration_advisory_lock_released_after_cycle() {
    let url = std::env::var("OZ_TEST_PG_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:15432/postgres".into());
    let pool = match crate::db::DbPool::connect_postgres(&url, false, 20, true).await {
        Ok(crate::db::DbPool::Postgres(pool)) => pool,
        Ok(_) => unreachable!("connect_postgres with a postgres:// URL returns Postgres"),
        Err(e) => {
            eprintln!("PG advisory-lock integration test skipped: {e}");
            return;
        }
    };
    let tenant = format!("pg-adv-lock-{}", uuid::Uuid::now_v7());

    // Simulate the full guard lifecycle WITHOUT running the inner cycle
    // (which would need seeded settings + SMTP): acquire, then release.
    {
        let mut guard = AdvisoryLockGuard::acquire(&pool, &tenant).await.unwrap();
        assert!(
            guard.acquired,
            "fresh tenant must acquire the advisory lock"
        );
        guard.release().await;
    }

    // The lock must be released — a second acquire on a (possibly
    // recycled) pool connection must succeed, proving the lock was not
    // leaked onto the returned connection.
    {
        let mut guard = AdvisoryLockGuard::acquire(&pool, &tenant).await.unwrap();
        assert!(
            guard.acquired,
            "advisory lock must be released after the cycle — a leaked lock would block this tenant forever"
        );
        guard.release().await;
    }
}

/// The panic path: if the inner cycle panics while holding the advisory
/// lock, the guard's Drop must close the connection so the session (and
/// the lock) dies — the tenant must not be blocked forever.
#[tokio::test]
async fn pg_integration_advisory_lock_guard_detaches_on_drop_without_release() {
    let url = std::env::var("OZ_TEST_PG_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:15432/postgres".into());
    let pool = match crate::db::DbPool::connect_postgres(&url, false, 20, true).await {
        Ok(crate::db::DbPool::Postgres(pool)) => pool,
        Ok(_) => unreachable!("connect_postgres with a postgres:// URL returns Postgres"),
        Err(e) => {
            eprintln!("PG advisory-lock guard integration test skipped: {e}");
            return;
        }
    };
    let tenant = format!("pg-adv-lock-panic-{}", uuid::Uuid::now_v7());

    // Acquire the lock, then drop the guard WITHOUT calling release —
    // this simulates a panic inside the inner cycle (Drop runs during
    // unwinding). The guard must detach the connection, closing the
    // session and releasing the lock.
    {
        let guard = AdvisoryLockGuard::acquire(&pool, &tenant).await.unwrap();
        assert!(
            guard.acquired,
            "fresh tenant must acquire the advisory lock"
        );
        // No `release()` — dropped here, as during panic unwinding.
    }

    // The lock must be gone: a new acquire must succeed.
    {
        let mut guard = AdvisoryLockGuard::acquire(&pool, &tenant).await.unwrap();
        assert!(
            guard.acquired,
            "a dropped-without-release guard must close the connection so the advisory lock dies with the session"
        );
        guard.release().await;
    }
}

/// Defect A (round-3): `release()` must NOT return a lock-holding
/// connection to the pool when the unlock query FAILS. The current code
/// does `let _ = unlock` — on failure the connection goes back to the
/// pool still holding the session-level lock, and Drop cannot detach it
/// (conn already taken). Simulate: acquire the lock, kill the backend,
/// then release() — the unlock fails, and the connection must be
/// detached (pool size drops), not returned holding a lock.
#[tokio::test]
async fn pg_integration_advisory_lock_release_detaches_on_unlock_failure() {
    let url = std::env::var("OZ_TEST_PG_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:15432/postgres".into());
    let pool = match crate::db::DbPool::connect_postgres(&url, false, 2, false).await {
        Ok(crate::db::DbPool::Postgres(pool)) => pool,
        Ok(_) => unreachable!("connect_postgres with a postgres:// URL returns Postgres"),
        Err(e) => {
            eprintln!("PG advisory-lock release integration test skipped: {e}");
            return;
        }
    };
    let tenant = format!("pg-adv-release-{}", uuid::Uuid::now_v7());

    // Acquire the lock and find the guard connection's backend PID.
    let mut guard = AdvisoryLockGuard::acquire(&pool, &tenant).await.unwrap();
    assert!(guard.acquired);
    let pid: i32 = guard
        .conn
        .as_ref()
        .unwrap()
        .query_one("SELECT pg_backend_pid()", &[])
        .await
        .unwrap()
        .get(0);

    // Kill the backend from a second connection — the unlock query in
    // release() will now fail.
    let killer = pool.get().await.unwrap();
    killer
        .execute("SELECT pg_terminate_backend($1)", &[&pid])
        .await
        .unwrap();
    drop(killer);

    let size_before = pool.status().size;
    guard.release().await;
    let size_after = pool.status().size;

    // The failed unlock must DETACH the dead connection (size drops),
    // not return it to the pool. A returned connection holding (or
    // about to leak) the lock is the exact bug we are guarding against.
    assert!(
        size_after < size_before || size_after == 0,
        "failed unlock must detach the connection (size {size_before} -> {size_after}), not return it to the pool"
    );
}
/// Defect B (round-3): when `pg_try_advisory_lock` returns false (another
/// instance holds the tenant's lock), the guard must return its
/// connection to the pool NORMALLY — NOT detach/destroy it. The current
/// `Drop` detaches unconditionally, so every lock-contention round
/// destroys a pool connection (deadpool `size` drops; the next get()
/// must create a brand-new session — connection churn).
///
/// Observable: with max_size(2), holder takes 1 (size → 1). The
/// non-acquired guard takes the 2nd (size → 2). After it drops:
///   correct:   connection returned → size stays 2
///   buggy:     detached/destroyed → size drops to 1
#[tokio::test]
async fn pg_integration_advisory_lock_not_acquired_returns_connection() {
    let url = std::env::var("OZ_TEST_PG_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:15432/postgres".into());
    let pool = match crate::db::DbPool::connect_postgres(&url, false, 2, false).await {
        Ok(crate::db::DbPool::Postgres(pool)) => pool,
        Ok(_) => unreachable!("connect_postgres with a postgres:// URL returns Postgres"),
        Err(e) => {
            eprintln!("PG advisory-lock contention integration test skipped: {e}");
            return;
        }
    };
    let tenant = format!("pg-adv-contend-{}", uuid::Uuid::now_v7());

    // Instance 1 holds the lock → size grows to 1.
    let mut holder = AdvisoryLockGuard::acquire(&pool, &tenant).await.unwrap();
    assert!(holder.acquired);
    assert_eq!(pool.status().size, 1, "holder must use 1 connection");

    // Instance 2 tries the same tenant — takes the 2nd connection,
    // does NOT acquire the lock.
    {
        let guard = AdvisoryLockGuard::acquire(&pool, &tenant).await.unwrap();
        assert!(
            !guard.acquired,
            "second instance must not acquire the held lock"
        );
        assert_eq!(
            pool.status().size,
            2,
            "contender must use the 2nd connection"
        );
    } // guard dropped here

    assert_eq!(
        pool.status().size,
        2,
        "a non-acquired guard must return its connection to the pool, not detach it (churn)"
    );

    holder.release().await;
}

/// RED (TDD): the email report path must be RLS-cutover compatible.
///
/// After `scripts/rls-cutover.sql` (FORCE ROW LEVEL SECURITY), every
/// query touching a tenant table must run with `SET LOCAL oz.tenant_id`
/// in a transaction. The webhook path was made oz_app-compatible; the
/// email analytics path was NOT — `daily_revenue_pg` (and the
/// sent_reports claim) run bare queries with no transaction and no GUC.
/// As the restricted role, the seeded sale is invisible → the report is
/// silently empty (bug), and the sent_reports INSERT violates WITH
/// CHECK.
#[tokio::test]
#[serial(pg_rls_cutover)]
async fn pg_integration_email_analytics_visible_as_restricted_role() {
    let url = std::env::var("OZ_TEST_PG_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:15432/postgres".into());
    // Throwaway DB: FORCE RLS on shared tables would race the other PG
    // integration tests (webhooks writes to the same tables). The admin
    // pool stays connected to the base DB for cleanup.
    let Some((db_url, db_name, admin_pool)) = throwaway_pg_db(&url, "oz_email_rls").await else {
        return;
    };
    let pool = match crate::db::DbPool::connect_postgres(&db_url, false, 20, true).await {
        Ok(crate::db::DbPool::Postgres(pool)) => pool,
        Ok(_) => unreachable!("connect_postgres with a postgres:// URL returns Postgres"),
        Err(e) => {
            eprintln!("PG email-RLS integration test skipped: {e}");
            return;
        }
    };
    let mut admin = pool.get().await.unwrap();
    let ns = format!("pg-email-rls-{}", std::process::id());
    let tenant = format!("{ns}-tenant");
    let role = "oz_email_rls_probe";

    // Set up the restricted role with FORCEd RLS on the tables the email
    // path touches (mirrors scripts/rls-cutover.sql). sale_lines is a
    // non-RLS child table (no tenant_id) — same as the real cutover.
    admin
        .batch_execute(&format!(
            "DO $$ BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{role}') THEN
                    EXECUTE 'DROP OWNED BY {role}';
                    EXECUTE 'DROP ROLE {role}';
                END IF;
             END $$;
             CREATE ROLE {role} LOGIN PASSWORD 'oz_email_rls_probe_pw';
             GRANT USAGE ON SCHEMA public TO {role};
             GRANT SELECT, INSERT, UPDATE, DELETE ON sales, sale_lines, sent_reports, products, refunds TO {role};
             ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
             ALTER TABLE sent_reports ENABLE ROW LEVEL SECURITY;
             ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;
             ALTER TABLE sales FORCE ROW LEVEL SECURITY;
             ALTER TABLE sent_reports FORCE ROW LEVEL SECURITY;
             ALTER TABLE refunds FORCE ROW LEVEL SECURITY;
             DROP POLICY IF EXISTS tenant_isolation ON sales;
             CREATE POLICY tenant_isolation ON sales
                 USING (tenant_id = current_setting('oz.tenant_id', true));
             DROP POLICY IF EXISTS tenant_isolation ON sent_reports;
             CREATE POLICY tenant_isolation ON sent_reports
                 USING (tenant_id = current_setting('oz.tenant_id', true));
             DROP POLICY IF EXISTS tenant_isolation ON refunds;
             CREATE POLICY tenant_isolation ON refunds
                 USING (tenant_id = current_setting('oz.tenant_id', true));"
        ))
        .await
        .expect("email-RLS probe role setup should succeed");

    // Seed as owner — FORCE applies to the owner too, so scope the seed
    // transaction to the tenant GUC (same as the webhook cutover test).
    let seed_tx = admin.transaction().await.unwrap();
    seed_tx
        .execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant])
        .await
        .unwrap();
    seed_tx
        .execute(
            "INSERT INTO sales (id, tenant_id, status, total_minor, currency, created_at, line_count)
             VALUES ($1, $2, 'completed', 100, 'USD', '2026-01-15T09:00:00.000Z', 1)",
            &[&format!("{ns}-sale"), &tenant],
        )
        .await
        .unwrap();
    seed_tx
        .execute(
            "INSERT INTO sale_lines (id, sale_id, sku, qty, unit_minor, line_minor, currency, line_position)
             VALUES ($1, $2, $3, 1, 100, 100, 'USD', 0)",
            &[&format!("{ns}-line"), &format!("{ns}-sale"), &format!("{ns}-sku")],
        )
        .await
        .unwrap();
    seed_tx.commit().await.unwrap();
    drop(admin);

    // The app pool: connects AS the restricted role (same pattern as the
    // webhook cutover test), to the THROWAWAY database.
    let scheme_end = db_url.find("://").expect("URL has a scheme") + 3;
    let at = db_url.find('@').expect("URL has credentials");
    let app_url = format!(
        "{}oz_email_rls_probe:oz_email_rls_probe_pw@{}",
        &db_url[..scheme_end],
        &db_url[at + 1..]
    );
    let app_pool = {
        use deadpool_postgres::Manager;
        use std::str::FromStr;
        let config = tokio_postgres::Config::from_str(&app_url).expect("valid app URL");
        let manager = Manager::new(config, tokio_postgres::NoTls);
        deadpool_postgres::Pool::builder(manager)
            .max_size(2)
            .build()
            .expect("app pool build")
    };

    // The actual email analytics function, run AS the restricted role.
    // Today it runs a bare query with no GUC → the seeded sale is
    // invisible → the report is empty. The fix must make it visible by
    // setting the tenant GUC in a transaction.
    let rows = daily_revenue_pg(&app_pool, "2026-01-01", "2026-01-31", &tenant).await;
    let rows = match rows {
        Ok(r) => r,
        Err(e) => panic!("daily_revenue_pg failed as restricted role: {e}"),
    };
    assert!(
        !rows.is_empty(),
        "the seeded sale must be visible to the restricted role — \
         daily_revenue_pg must set the tenant GUC (RLS cutover compat)"
    );

    // The sent_reports claim must also work as the restricted role.
    let claimed = claim_period_pg(&app_pool, &tenant, "2026-01", "rpt-1").await;
    assert!(
        claimed.is_ok() && claimed.unwrap(),
        "the sent_reports claim must succeed as the restricted role (WITH CHECK needs the GUC)"
    );

    // Cleanup: drop every handle, then the throwaway database (kills the
    // role's objects), then remove the probe role from the shared cluster.
    // DROP DATABASE cannot run inside a transaction — separate statements.
    drop(pool);
    let admin = admin_pool.get().await.unwrap();
    admin
        .batch_execute(&format!("DROP DATABASE IF EXISTS {db_name} WITH (FORCE);"))
        .await
        .expect("email-RLS drop throwaway database should succeed");
    admin
        .batch_execute(&format!("DROP ROLE IF EXISTS {role};"))
        .await
        .expect("email-RLS probe role cleanup should succeed");
}

/// RED (TDD): tenant discovery must survive RLS cutover.
///
/// `active_tenants_pg` enumerates every tenant by reading tenant_plans /
/// offline_queue / sync_terminals — all RLS FORCEd tables. As the
/// restricted role with no GUC, RLS hides all rows → the loop discovers
/// 0 tenants and scheduled reports silently stop. The webhook path solved
/// the identical read-before-tenant-known problem with a BYPASSRLS
/// resolver role; the email discovery path needs the same treatment.
#[tokio::test]
#[serial(pg_rls_cutover)]
async fn pg_integration_active_tenants_survives_rls_cutover() {
    let url = std::env::var("OZ_TEST_PG_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:15432/postgres".into());
    // Throwaway DB: FORCE RLS on shared tables (offline_queue etc.) would
    // race the other PG integration tests. Admin pool stays on base DB.
    let Some((db_url, db_name, admin_pool)) = throwaway_pg_db(&url, "oz_email_tenants").await
    else {
        return;
    };
    let pool = match crate::db::DbPool::connect_postgres(&db_url, false, 20, true).await {
        Ok(crate::db::DbPool::Postgres(pool)) => pool,
        Ok(_) => unreachable!("connect_postgres with a postgres:// URL returns Postgres"),
        Err(e) => {
            eprintln!("PG active-tenants integration test skipped: {e}");
            return;
        }
    };
    let mut admin = pool.get().await.unwrap();
    let ns = format!("pg-email-tenants-{}", std::process::id());
    let tenant = format!("{ns}-tenant");
    let role = "oz_email_tenants_probe";

    // Set up the restricted role + FORCE RLS on the discovery tables,
    // mirroring the real cutover.
    admin
        .batch_execute(&format!(
            "DO $$ BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{role}') THEN
                    EXECUTE 'DROP OWNED BY {role}';
                    EXECUTE 'DROP ROLE {role}';
                END IF;
             END $$;
             CREATE ROLE {role} LOGIN PASSWORD 'oz_email_tenants_probe_pw';
             GRANT USAGE ON SCHEMA public TO {role};
             GRANT SELECT ON tenant_plans, offline_queue, sync_terminals TO {role};
             -- The BYPASSRLS discovery role (mirrors rls-cutover.sql 2d):
             -- the code SET LOCAL ROLEs into it to read cross-tenant.
             DO $$ BEGIN
                 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oz_email_discovery') THEN
                     CREATE ROLE oz_email_discovery NOLOGIN BYPASSRLS;
                 END IF;
             END $$;
             GRANT USAGE ON SCHEMA public TO oz_email_discovery;
             GRANT SELECT ON tenant_plans, offline_queue, sync_terminals TO oz_email_discovery;
             GRANT oz_email_discovery TO {role};
             ALTER TABLE tenant_plans ENABLE ROW LEVEL SECURITY;
             ALTER TABLE offline_queue ENABLE ROW LEVEL SECURITY;
             ALTER TABLE sync_terminals ENABLE ROW LEVEL SECURITY;
             ALTER TABLE tenant_plans FORCE ROW LEVEL SECURITY;
             ALTER TABLE offline_queue FORCE ROW LEVEL SECURITY;
             ALTER TABLE sync_terminals FORCE ROW LEVEL SECURITY;
             DROP POLICY IF EXISTS tenant_isolation ON tenant_plans;
             CREATE POLICY tenant_isolation ON tenant_plans
                 USING (tenant_id = current_setting('oz.tenant_id', true));
             DROP POLICY IF EXISTS tenant_isolation ON offline_queue;
             CREATE POLICY tenant_isolation ON offline_queue
                 USING (tenant_id = current_setting('oz.tenant_id', true));
             DROP POLICY IF EXISTS tenant_isolation ON sync_terminals;
             CREATE POLICY tenant_isolation ON sync_terminals
                 USING (tenant_id = current_setting('oz.tenant_id', true));"
        ))
        .await
        .expect("active-tenants probe role setup should succeed");

    // Seed a tenant_plans row (owner + GUC, since FORCE applies to owner).
    let seed_tx = admin.transaction().await.unwrap();
    seed_tx
        .execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant])
        .await
        .unwrap();
    seed_tx
        .execute(
            "INSERT INTO tenant_plans (tenant_id, plan, updated_at)
             VALUES ($1, 'pro', '2026-01-01T00:00:00Z')
             ON CONFLICT (tenant_id) DO NOTHING",
            &[&tenant],
        )
        .await
        .unwrap();
    seed_tx.commit().await.unwrap();
    drop(admin);

    // The app pool connects AS the restricted role, to the THROWAWAY DB.
    let scheme_end = db_url.find("://").expect("URL has a scheme") + 3;
    let at = db_url.find('@').expect("URL has credentials");
    let app_url = format!(
        "{}oz_email_tenants_probe:oz_email_tenants_probe_pw@{}",
        &db_url[..scheme_end],
        &db_url[at + 1..]
    );
    let app_pool = {
        use deadpool_postgres::Manager;
        use std::str::FromStr;
        let config = tokio_postgres::Config::from_str(&app_url).expect("valid app URL");
        let manager = Manager::new(config, tokio_postgres::NoTls);
        deadpool_postgres::Pool::builder(manager)
            .max_size(2)
            .build()
            .expect("app pool build")
    };

    // The REAL discovery function, as the restricted role. Post-cutover it
    // must still enumerate the seeded tenant — today it returns only
    // 'default' (RLS hides every tenant row without a GUC).
    let tenants = active_tenants_pg(&app_pool).await.unwrap();
    assert!(
        tenants.contains(&tenant),
        "active_tenants_pg must enumerate the seeded tenant post-cutover, got: {tenants:?}"
    );

    // Cleanup: drop every handle, then the throwaway database (kills the
    // roles' objects), then remove the probe + discovery roles.
    // DROP DATABASE cannot run inside a transaction — separate statements.
    drop(pool);
    let admin = admin_pool.get().await.unwrap();
    admin
        .batch_execute(&format!("DROP DATABASE IF EXISTS {db_name} WITH (FORCE);"))
        .await
        .expect("active-tenants drop throwaway database should succeed");
    admin
        .batch_execute(&format!("DROP ROLE IF EXISTS {role};"))
        .await
        .expect("active-tenants probe role cleanup should succeed");
    // `oz_email_discovery` is deliberately left in place (see the NOTE at
    // the stale-role cleanup in `throwaway_pg_db`): it is cluster-wide,
    // production depends on it, and dropping it here would race concurrent
    // tests that use it. It is idempotently re-created (`IF NOT EXISTS`) by
    // the next run.
}

/// REP-04 cloud parity: daily revenue nets the refund ledger per
/// (date, currency) with FULL OUTER semantics — a refund-only day must
/// produce a row (total 0, negative net) instead of vanishing. Uses a
/// unique tenant id so concurrent PG tests on tenant 'default' can
/// never leak into the window. Skips when Postgres is unreachable.
/// `#[serial]`: like the other PG integration tests here, it shares the
/// base database's catalog state (roles, grants, FORCE RLS) with the
/// restricted-role tests, which mutate it mid-flight.
#[tokio::test]
#[serial(pg_rls_cutover)]
async fn pg_daily_revenue_nets_refunds_per_date_and_currency() {
    let url = std::env::var("OZ_TEST_PG_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:15432/postgres".into());
    // Throwaway database, exactly as the two sibling tests here already do (`:920`,
    // `:1067`) -- this was the last one in the file left on the base DB, and it was
    // measured failing: `E40P01 deadlock detected ... AccessExclusiveLock`, rescued by
    // nextest's retry budget so CI reported `1084 passed (1 flaky)` and exit 0 for a
    // revenue-netting assertion that had actually failed on its first attempt.
    //
    // Every reason this file already documents applies here: `apply_schema = true`
    // below means PG_INIT's catalog DDL runs on connect, and two parallel binaries
    // doing that in `postgres` deadlock (`:17`-`:20`); a 20-connection pool against the
    // shared dev DB exhausts `max_connections` under concurrency (`:101`-`:103`); and
    // `#[serial(pg_rls_cutover)]` above it does not cover nextest, which forks a process
    // per test -- a peer records that at `prune_tests.rs:443`-`:445`.
    let Some((db_url, db_name, admin_pool)) = throwaway_pg_db(&url, "oz_refund_net").await else {
        return;
    };
    let pool = match crate::db::DbPool::connect_postgres(&db_url, false, 20, true).await {
        Ok(crate::db::DbPool::Postgres(pool)) => pool,
        Ok(_) => unreachable!("postgres:// URL returns Postgres"),
        Err(e) => {
            eprintln!("PG refund-netting test skipped: {e}");
            return;
        }
    };

    let ns = format!("pg-refund-net-{}", uuid::Uuid::now_v7());
    let sale_id = format!("{ns}-sale");
    {
        let client = pool.get().await.unwrap();
        for sql in [
            "DELETE FROM refunds WHERE id LIKE 'pg-refund-net-%'",
            "DELETE FROM sales WHERE id LIKE 'pg-refund-net-%'",
        ] {
            client.execute(sql, &[]).await.unwrap();
        }
    }

    let mut client = pool.get().await.unwrap();
    let tx = client.transaction().await.unwrap();
    tx.execute(
        "INSERT INTO sales (id, tenant_id, total_minor, currency, line_count, status, payment_method,
                            tendered_minor, discount_percent, discount_label, user_id, created_at,
                            updated_at, subtotal_minor, tax_total_minor, customer_id, version)
         VALUES ($1, $2, 10000, 'USD', 0, 'completed', 'cash', 10000, 0, NULL, NULL,
                 '2026-01-10T09:00:00.000Z', '2026-01-10T09:00:00.000Z', 10000, 0, NULL, 1)",
        &[&sale_id, &ns],
    )
    .await
    .unwrap();
    // (date, currency, total) — two USD refunds on different days and one
    // IDR refund sharing a day with a USD refund (currency separation).
    for (rid, day, cur, amount) in [
        (format!("{ns}-r1"), "2026-01-11", "USD", 4000i64),
        (format!("{ns}-r2"), "2026-01-15", "USD", 2000),
        (format!("{ns}-r3"), "2026-01-11", "IDR", 5000),
    ] {
        tx.execute(
            "INSERT INTO refunds (id, tenant_id, sale_id, total_minor, currency, reason, note,
                                  processed_by, created_at)
             VALUES ($1, $2, $3, $4, $5, 'defective', '', 'user-1', $6)",
            &[
                &rid,
                &ns,
                &sale_id,
                &amount,
                &cur,
                &format!("{day}T12:00:00.000Z"),
            ],
        )
        .await
        .unwrap();
    }
    tx.commit().await.unwrap();

    let rows = daily_revenue_pg(&pool, "2026-01-01", "2026-01-31", &ns)
        .await
        .expect("daily_revenue_pg");

    let find = |date: &str, currency: &str| {
        rows.iter()
            .find(|r| r.date.starts_with(date) && r.currency == currency)
    };
    let sale_day = find("2026-01-10", "USD").expect("sale day row");
    assert_eq!(sale_day.total_minor, 10000);
    assert_eq!(sale_day.refund_minor, 0);
    assert_eq!(sale_day.net_revenue_minor, 10000);

    let r1 = find("2026-01-11", "USD").expect("refund-only USD day must produce a row");
    assert_eq!(r1.total_minor, 0);
    assert_eq!(r1.sale_count, 0);
    assert_eq!(r1.refund_minor, 4000);
    assert_eq!(r1.net_revenue_minor, -4000);

    let r_idr = find("2026-01-11", "IDR").expect("IDR refund must not merge into the USD row");
    assert_eq!(r_idr.refund_minor, 5000);
    assert_eq!(r_idr.net_revenue_minor, -5000);

    let r2 = find("2026-01-15", "USD").expect("second refund day row");
    assert_eq!(r2.refund_minor, 2000);
    assert_eq!(r2.net_revenue_minor, -2000);

    // Sweep this run's rows.
    let client = pool.get().await.unwrap();
    client
        .execute("DELETE FROM refunds WHERE id LIKE 'pg-refund-net-%'", &[])
        .await
        .unwrap();
    client
        .execute("DELETE FROM sales WHERE id LIKE 'pg-refund-net-%'", &[])
        .await
        .unwrap();
    // Release the database. The row sweep above is now belt-and-braces -- a throwaway
    // cannot carry rows into a later run -- but it stays so this change is confined to
    // where the test runs rather than what it asserts. Sibling idiom at
    // `:1174`-`:1178`: DROP DATABASE cannot run inside a transaction.
    drop(client);
    drop(pool);
    let admin = admin_pool.get().await.unwrap();
    admin
        .batch_execute(&format!("DROP DATABASE IF EXISTS {db_name} WITH (FORCE);"))
        .await
        .unwrap();
}
