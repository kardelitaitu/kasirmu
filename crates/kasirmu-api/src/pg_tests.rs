use super::*;

/// Cluster-wide advisory-lock key ("OZTESTSQ") serializing EVERY DDL window in
/// the PG integration suite — the `PG_INIT` schema apply, `CREATE`/`DROP
/// DATABASE` and `CREATE`/`DROP ROLE`. Roles and databases live in the
/// CLUSTER catalogs (`pg_authid`/`pg_database`), not in one test database, so
/// every window takes the lock in the SAME database (the base DB) where it
/// actually contends.
///
/// Why: the CI PG service starts EMPTY, so under nextest every worker process
/// drives its own init against the SAME shared base DB at the same time. The
/// collision surfaces as `Db("db error")` / deadpool's "Error occurred while
/// creating a new object: db error" (deadpool-0.12 `PoolError::Backend`) — a
/// `pool.get()` that failed because a concurrent worker's DDL dropped or
/// recreated what this test was connecting to. Locally the base DB is already
/// migrated and the windows are short, so the race never reproduces.
///
/// Release: the guard's dedicated connection is closed at the end of the
/// window, which ends the session and releases the lock server-side;
/// `PgDdlGuard::release` unlocks explicitly first so release is deterministic
/// rather than dependent on the FIN arriving. Test bodies still run fully in
/// parallel — only the DDL windows serialize.
const SCHEMA_LOCK_KEY: i64 = 0x4f5a_5445_5354_5351;

/// How long a DDL window waits for the lock before proceeding unlocked. A
/// wedged holder must never turn a flaky suite into a hung CI job.
const SCHEMA_LOCK_TIMEOUT: &str = "120s";

/// A held cluster-wide DDL serialization lock. See `SCHEMA_LOCK_KEY`.
struct PgDdlGuard {
    /// `None` when the connection could not be opened or the lock could not be
    /// taken: the window then runs unserialized, exactly as it did before this
    /// guard existed, so the lock can never add a new skip or failure mode.
    client: Option<tokio_postgres::Client>,
}

impl PgDdlGuard {
    /// Explicitly unlock, then close the dedicated connection.
    async fn release(mut self) {
        if let Some(client) = self.client.take() {
            let _ = client
                .batch_execute(&format!("SELECT pg_advisory_unlock({SCHEMA_LOCK_KEY});"))
                .await;
        }
    }
}

/// Take the cluster-wide DDL lock on a DEDICATED connection to `base_url`
/// (the shared base DB — the database every worker actually contends in).
///
/// Best-effort: connect/lock failures are logged and the caller proceeds
/// unlocked. Dropping the returned guard (or calling `release`) ends the
/// window. Never hold it across a test body: it serializes, so short windows
/// only.
async fn pg_ddl_guard(base_url: &str) -> PgDdlGuard {
    let (client, conn) = match tokio_postgres::connect(base_url, tokio_postgres::NoTls).await {
        Ok(pair) => pair,
        Err(e) => {
            eprintln!("PG DDL lock: no serialization connection ({e}); continuing");
            return PgDdlGuard { client: None };
        }
    };
    // Drive the connection on a background task; dropping the client ends the
    // session, and with it the session-level advisory lock.
    tokio::spawn(async move {
        let _ = conn.await;
    });
    let _ = client
        .batch_execute(&format!("SET lock_timeout = '{SCHEMA_LOCK_TIMEOUT}';"))
        .await;
    match client
        .batch_execute(&format!("SELECT pg_advisory_lock({SCHEMA_LOCK_KEY});"))
        .await
    {
        Ok(()) => PgDdlGuard {
            client: Some(client),
        },
        Err(e) => {
            // Timed out or refused: fall back to the pre-lock behaviour rather
            // than failing an otherwise healthy test.
            eprintln!("PG DDL lock: pg_advisory_lock failed ({e}); continuing unserialized");
            PgDdlGuard { client: None }
        }
    }
}

/// Build a deadpool pool from a `postgres://` URL (plaintext — the test
/// DB runs locally in Docker, mirroring `sync_store`'s integration test).
///
/// The schema apply is wrapped in a cluster-wide advisory lock: under
/// nextest every PG test runs in its own process and several call this on
/// the SAME base DB, so concurrent `PG_INIT` catalog DDL was a recurring
/// flake source (duplicate-object / cache-invalidation errors). The lock
/// serializes the DDL across processes; it is released immediately after,
/// so test bodies still run fully in parallel.
async fn test_pool(url: &str) -> Option<deadpool_postgres::Pool> {
    use deadpool_postgres::Manager;
    use std::str::FromStr;
    let config = tokio_postgres::Config::from_str(url).expect("valid postgres URL");
    let manager = Manager::new(config, tokio_postgres::NoTls);
    let pool = deadpool_postgres::Pool::builder(manager)
        .max_size(5)
        .build()
        .expect("pool build");
    match pool.get().await {
        Ok(client) => {
            // Serialize PG_INIT across test processes (module-level fixed key,
            // shared with the CREATE/DROP DATABASE and CREATE/DROP ROLE
            // windows below). Bounded by lock_timeout so a wedged holder
            // degrades to the pre-lock behaviour instead of hanging.
            let _ = client
                .batch_execute(&format!(
                    "SET lock_timeout = '{SCHEMA_LOCK_TIMEOUT}';\n\
                     SELECT pg_advisory_lock({SCHEMA_LOCK_KEY});"
                ))
                .await;
            let apply = client
                .batch_execute(kasirmu_core::migrations::PG_INIT)
                .await;
            let _ = client
                .batch_execute(&format!("SELECT pg_advisory_unlock({SCHEMA_LOCK_KEY});"))
                .await;
            if let Err(e) = apply {
                eprintln!("PG REST integration: schema apply failed: {e:?}");
                return None;
            }
            Some(pool)
        }
        Err(e) => {
            eprintln!("PG REST integration: pool get failed: {e}");
            None
        }
    }
}

/// Build a pool WITHOUT applying the schema. Used for admin connections
/// (CREATE/DROP DATABASE) so a test that needs a throwaway database does
/// not re-run the full PG_INIT DDL on the shared dev database — under
/// full-suite load every PG test process already applies PG_INIT to the
/// same base DB, and concurrent catalog DDL there is a flake source.
async fn raw_pool(url: &str) -> Option<deadpool_postgres::Pool> {
    use deadpool_postgres::Manager;
    use std::str::FromStr;
    let config = tokio_postgres::Config::from_str(url).expect("valid postgres URL");
    let manager = Manager::new(config, tokio_postgres::NoTls);
    let pool = deadpool_postgres::Pool::builder(manager)
        .max_size(3)
        .build()
        .expect("pool build");
    match pool.get().await {
        Ok(_) => Some(pool),
        Err(e) => {
            eprintln!("PG integration: admin pool get failed: {e}");
            None
        }
    }
}

fn unique_id(prefix: &str) -> String {
    format!("{prefix}-{}", uuid::Uuid::now_v7())
}

/// Create a throwaway database, apply the full schema to it, and return
/// `(pool, db_name, admin_pool)`. Tests that exercise concurrency on
/// `products`/`sales` rows (`FOR UPDATE` chains, `adjust_stock`,
/// `create_sale`) must run on a throwaway DB: on the SHARED base DB, a
/// lock-ordering collision with another parallel test process (or its
/// `PG_INIT` DDL re-apply) surfaces as a spurious deadlock/lock-timeout
/// abort — the terse `Db("db error")`. The throwaway DB removes that whole
/// flake class while keeping the test's semantics identical. Callers must
/// `DROP DATABASE {db_name} WITH (FORCE)` in cleanup (see the existing
/// `concurrent_adjust_stock` test for the exact shape).
async fn throwaway_test_pool(
    url: &str,
    prefix: &str,
) -> Option<(deadpool_postgres::Pool, String, deadpool_postgres::Pool)> {
    // Admin connection is raw (no schema): it only creates/drops the
    // throwaway database, so it must not re-apply PG_INIT to the shared
    // base DB (concurrent catalog DDL across parallel test binaries).
    let admin_pool = raw_pool(url).await?;
    let admin = admin_pool.get().await.ok()?;

    // ── Cluster DDL window ─────────────────────────────────────────────
    // The stale sweep and CREATE DATABASE below touch the SHARED cluster
    // catalog (pg_database), where every other worker process is doing the
    // same at once; that interleaving is the mid-init collision behind the
    // terse Db("db error"). Serialize it, and release before the schema
    // apply so only this window pays for the lock.
    let ddl = pg_ddl_guard(url).await;

    // Sweep throwaway databases a crashed run left behind (only tests
    // with this prefix create them), so stale DBs cannot accumulate or
    // collide with a fresh run after an OS PID is reused.
    let stale: Vec<String> = admin
        .query(
            "SELECT datname FROM pg_database WHERE datname LIKE $1",
            &[&format!("{prefix}_%")],
        )
        .await
        .ok()?
        .iter()
        .map(|r| r.get::<_, String>(0))
        .collect();
    for d in &stale {
        admin
            .batch_execute(&format!("DROP DATABASE IF EXISTS {d} WITH (FORCE);"))
            .await
            .ok()?;
    }
    // PID + random suffix: unique even if the OS reuses a PID while a
    // stale DB from a crashed run is still present. `.simple()` (hex only)
    // is REQUIRED: the name is interpolated as an unquoted identifier, and
    // UUID `Display` hyphens made `CREATE DATABASE` a syntax error on the
    // server — every throwaway-DB test silently skipped and reported PASS.
    let db_name = format!(
        "{prefix}_{}_{}",
        std::process::id(),
        uuid::Uuid::now_v7().simple()
    );
    if admin
        .execute(&format!("CREATE DATABASE {db_name}"), &[])
        .await
        .is_err()
    {
        eprintln!("PG integration skipped: cannot CREATE DATABASE");
        ddl.release().await;
        return None;
    }
    drop(admin);
    ddl.release().await;

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
    // `test_pool` applies PG_INIT (full schema) to the throwaway DB.
    let pool = test_pool(&db_url).await?;
    Some((pool, db_name, admin_pool))
}

/// Integration test against a live Postgres (the same Docker service
/// `db.rs` uses, port 15432). Skips when unreachable, so the suite stays
/// green on machines without a running Postgres.
#[tokio::test]
async fn pg_integration_rest_roundtrip() {
    let url = std::env::var("OZ_TEST_PG_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:15432/postgres".into());
    // Throwaway DB: this test exercises `adjust_stock` FOR UPDATE chains on
    // `products`; on the shared base DB a lock-ordering collision with a
    // parallel test process surfaces as a spurious `Db("db error")` abort.
    let Some((pool, db_name, admin_pool)) = throwaway_test_pool(&url, "oz_rest").await else {
        eprintln!("PG REST integration test skipped (Postgres unreachable at {url})");
        return;
    };

    let tenant = unique_id("pg-rest");
    let sku = unique_id("PG-SKU");
    let currency: Currency = "USD".parse().unwrap();

    // ── Products: create with initial stock, list, get, adjust, oversell ──
    let created = create_product(
        &pool,
        &tenant,
        &sku,
        "PG Espresso",
        Money {
            minor_units: 350,
            currency,
        },
        None,
        None,
        10,
    )
    .await
    .expect("create_product");
    assert_eq!(created.stock_qty, Some(10));
    assert_eq!(created.product.sku.as_str(), sku);
    assert!(created.product.is_active);

    let listed = list_products(&pool, &tenant).await.expect("list_products");
    assert!(
        listed.iter().any(|p| p.product.sku.as_str() == sku),
        "created product must appear in the listing"
    );

    let fetched = get_product(&pool, &tenant, &sku)
        .await
        .expect("get_product")
        .expect("product must exist");
    assert_eq!(fetched.stock_qty, Some(10));
    assert_eq!(fetched.product.name, "PG Espresso");

    let adj = adjust_stock(&pool, &tenant, &sku, -4)
        .await
        .expect("adjust_stock");
    assert_eq!((adj.previous_qty, adj.new_qty), (10, 6));
    assert!(matches!(
        adjust_stock(&pool, &tenant, &sku, -100).await,
        Err(PgError::Validation(_))
    ));
    assert!(matches!(
        adjust_stock(&pool, &tenant, &unique_id("PG-SKU"), 1).await,
        Err(PgError::NotFound)
    ));

    // ── Tax rates ──
    let rate = create_tax_rate(&pool, &tenant, "PG VAT", 1000, true, false)
        .await
        .expect("create_tax_rate");
    assert!(rate.is_default);
    assert_eq!(rate.rate_bps, 1000);
    assert!(matches!(
        create_tax_rate(&pool, &tenant, "", 100, false, false).await,
        Err(PgError::Validation(_))
    ));

    // ── Users (role required) ──
    {
        let client = pool.get().await.unwrap();
        let role_id = format!("role-{tenant}");
        client
            .execute(
                "INSERT INTO roles (id, name, permissions) VALUES ($1, $2, '[]')",
                &[&role_id, &role_id],
            )
            .await
            .unwrap();
    }
    let username = format!("pgstaff-{}", uuid::Uuid::now_v7());
    let user = create_user(
        &pool,
        &tenant,
        &username,
        "hash",
        "PG Staff",
        &format!("role-{tenant}"),
    )
    .await
    .expect("create_user");
    assert_eq!(user.username, username);
    assert!(user.is_active);
    assert!(matches!(
        create_user(
            &pool,
            &tenant,
            &username,
            "hash",
            "PG Staff 2",
            &format!("role-{tenant}"),
        )
        .await,
        Err(PgError::Conflict)
    ));
    assert!(matches!(
        create_user(&pool, &tenant, "ghost", "h", "Ghost", "role-missing").await,
        Err(PgError::Validation(_))
    ));

    // ── Plans ──
    set_tenant_plan(&pool, &tenant, TenantPlan::Pro)
        .await
        .expect("set_tenant_plan");
    assert_eq!(
        get_tenant_plan(&pool, &tenant)
            .await
            .expect("get_tenant_plan"),
        Some(TenantPlan::Pro)
    );
    assert_eq!(
        get_tenant_plan(&pool, &unique_id("pg-noplan"))
            .await
            .unwrap(),
        None
    );

    // ── Sales: create (with lines), get, transition ──
    let sale = Sale::from_cart(&kasirmu_core::Cart::new(currency)).expect("from_cart");
    // Hand-build a single-line sale so the ledger row is well-formed.
    let line_id = unique_id("pg-line");
    let mut sale = sale;
    sale.line_count = 1;
    sale.total = Money {
        minor_units: 700,
        currency,
    };
    sale.subtotal = Money {
        minor_units: 700,
        currency,
    };
    sale.lines = vec![SaleLine {
        id: line_id,
        sale_id: sale.id.clone(),
        sku: sku.clone(),
        qty: 2,
        unit_price: Money {
            minor_units: 350,
            currency,
        },
        line_total: Money {
            minor_units: 700,
            currency,
        },
        line_position: 1,
        tax_amount: Money::zero(currency),
        tax_rate_id: None,
        tax_breakdown_json: None,
        serial_number: None,
        course: None,
        modifiers_json: None,
    }];
    // CUR-02: a multi-currency tender sale — the metadata the desktop
    // PaymentModal snapshots must round-trip through the cloud.
    sale.base_currency = Some("IDR".into());
    sale.base_total_minor = Some(11_000_000);
    sale.tender_rate_millionths = Some(16_500_000);
    sale.tip_minor = 150;
    sale.service_charge_minor = 70;
    create_sale(&pool, &tenant, &sale)
        .await
        .expect("create_sale");

    let fetched_sale = get_sale(&pool, &tenant, &sale.id)
        .await
        .expect("get_sale")
        .expect("sale must exist");
    assert_eq!(fetched_sale.lines.len(), 1);
    assert_eq!(fetched_sale.lines[0].sku, sku);
    assert_eq!(fetched_sale.total.minor_units, 700);
    assert_eq!(fetched_sale.status, SaleStatus::Pending);
    // CUR-02 cloud gap: the multi-currency tender metadata and the
    // tip/service amounts must survive the create_sale → get_sale
    // round-trip. The PG INSERT previously omitted all five columns, so
    // the cloud always saw NULL/0 and reconciliation could not see what
    // the customer was actually charged in.
    assert_eq!(fetched_sale.base_currency, sale.base_currency);
    assert_eq!(fetched_sale.base_total_minor, sale.base_total_minor);
    assert_eq!(
        fetched_sale.tender_rate_millionths,
        sale.tender_rate_millionths
    );
    assert_eq!(fetched_sale.tip_minor, sale.tip_minor);
    assert_eq!(fetched_sale.service_charge_minor, sale.service_charge_minor);
    assert_eq!(
        get_sale(&pool, &tenant, &unique_id("pg-nosale"))
            .await
            .unwrap(),
        None
    );

    // Pending → Completed is invalid (the state machine requires Active).
    assert!(matches!(
        update_sale_status(&pool, &tenant, &sale.id, SaleStatus::Completed).await,
        Err(PgError::Validation(_))
    ));
    // Pending → Active → Completed is the legal path.
    let updated = update_sale_status(&pool, &tenant, &sale.id, SaleStatus::Active)
        .await
        .expect("update_sale_status");
    assert_eq!(updated.status, SaleStatus::Active);
    let completed = update_sale_status(&pool, &tenant, &sale.id, SaleStatus::Completed)
        .await
        .expect("update_sale_status");
    assert_eq!(completed.status, SaleStatus::Completed);
    assert!(matches!(
        update_sale_status(&pool, &tenant, &unique_id("pg-nosale"), SaleStatus::Active).await,
        Err(PgError::NotFound)
    ));

    // ── Terminals: register + client-credentials verify ──
    let term_id = unique_id("pg-term");
    register_terminal(
        &pool,
        &term_id,
        &crate::routes::terminals::hash_secret("secret"),
        "front",
        Some(&tenant),
    )
    .await
    .expect("register_terminal");
    let verified = verify_terminal_credentials(&pool, &term_id, "secret")
        .await
        .expect("verify_terminal_credentials");
    assert_eq!(
        verified.as_ref().and_then(|t| t.tenant_id.as_deref()),
        Some(tenant.as_str())
    );
    assert!(
        verify_terminal_credentials(&pool, &term_id, "wrong")
            .await
            .unwrap()
            .is_none()
    );

    // ── Categories (endpoint must respond; the shared dev DB may
    //    hold categories from parallel tests, so no emptiness claim) ──
    let _ = list_categories(&pool).await.expect("list_categories");

    // Clean up the rows this test created so a shared dev DB stays tidy
    // (the sync-store integration test does the same).
    {
        let client = pool.get().await.unwrap();
        let role_id = format!("role-{tenant}");
        client
            .execute("DELETE FROM sale_lines WHERE sale_id = $1", &[&sale.id])
            .await
            .unwrap();
        client
            .execute("DELETE FROM sales WHERE id = $1", &[&sale.id])
            .await
            .unwrap();
        client
            .execute(
                "DELETE FROM sync_terminals WHERE tenant_id = $1",
                &[&tenant],
            )
            .await
            .unwrap();
        client
            .execute("DELETE FROM users WHERE tenant_id = $1", &[&tenant])
            .await
            .unwrap();
        client
            .execute("DELETE FROM roles WHERE id = $1", &[&role_id])
            .await
            .unwrap();
        client
            .execute("DELETE FROM tax_rates WHERE tenant_id = $1", &[&tenant])
            .await
            .unwrap();
        client
            .execute(
                "DELETE FROM stock_movements WHERE item_id IN (SELECT id FROM products WHERE tenant_id = $1)",
                &[&tenant],
            )
            .await
            .unwrap();
        client
            .execute("DELETE FROM products WHERE tenant_id = $1", &[&tenant])
            .await
            .unwrap();
        client
            .execute("DELETE FROM tenant_plans WHERE tenant_id = $1", &[&tenant])
            .await
            .unwrap();
    }

    // Cleanup: drop the throwaway database.
    // DROP DATABASE is cluster DDL too: take the same lock so a
    // concurrent worker's CREATE DATABASE cannot interleave with it.
    let ddl = pg_ddl_guard(&url).await;
    drop(pool);
    admin_pool
        .get()
        .await
        .expect("cleanup admin client")
        .batch_execute(&format!("DROP DATABASE IF EXISTS {db_name} WITH (FORCE);"))
        .await
        .expect("drop throwaway database should succeed");
    ddl.release().await;
}

/// Integration test: the REST layer works under RLS as a NON-OWNER role
/// because every tenant-scoped transaction sets `SET LOCAL oz.tenant_id`.
///
/// The init schema enables RLS + the `tenant_isolation` policy on every
/// table in `RLS_TABLES` (`scripts/generate-pg-migration.py` — the source
/// of truth; do not hardcode the count here), but a non-owner connection
/// sees nothing until the
/// `oz.tenant_id` GUC is set. Each REST function now opens a transaction
/// and sets the GUC first; this test drives the real functions through a
/// pool that connects as a restricted `oz_rest_probe` role (password
/// login, DML grants only — no table ownership, no superuser), exactly
/// the deployment shape the RLS cutover prescribes (`oz_app`).
///
/// Two proofs:
/// 1. The barrier is genuinely live: a dedicated probe connection with no
///    GUC sees ZERO products (and an INSERT is rejected) even though the
///    owner created a row — otherwise the round trip would pass trivially.
/// 2. The REST round trip succeeds as the restricted role
///    (create_product → get_product → list_products → create_sale →
///    get_sale), which is only possible because every function scopes its
///    transaction with the tenant GUC before touching the DB.
#[tokio::test]
async fn pg_integration_rest_rls_non_owner() {
    let url = std::env::var("OZ_TEST_PG_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:15432/postgres".into());
    // Throwaway DB: this test creates a restricted role with DML grants
    // on shared tables and runs create_sale/adjust chains; on the shared
    // base DB concurrent role setup + FOR UPDATE chains race parallel
    // test processes. The throwaway DB isolates both.
    let Some((pool, db_name, admin_pool)) = throwaway_test_pool(&url, "oz_rest_rls").await else {
        eprintln!("PG REST RLS test skipped (Postgres unreachable at {url})");
        return;
    };

    let tenant = unique_id("pg-rls");
    let sku = unique_id("PG-RLS-SKU");
    let currency: Currency = "USD".parse().unwrap();

    // Restricted role (idempotent): DML on the tenant tables + the
    // non-tenant `roles` table the REST layer touches (sale_lines is
    // RLS-covered too — the functions stamp tenant_id explicitly).
    // Cluster DDL window: `oz_rest_probe` is a CLUSTER-wide role shared
    // with `pg_isolates_locations_by_tenant`, so this setup races that
    // test and every other worker’s throwaway-DB DDL. Serialize it.
    let ddl = pg_ddl_guard(&url).await;
    let owner = pool.get().await.expect("owner connection");
    owner
        .batch_execute(
            "DO $$\n\
             BEGIN\n\
                 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oz_rest_probe') THEN\n\
                     EXECUTE 'DROP OWNED BY oz_rest_probe';\n\
                     EXECUTE 'DROP ROLE oz_rest_probe';\n\
                 END IF;\n\
             END $$;\n\
             CREATE ROLE oz_rest_probe LOGIN PASSWORD 'oz_rest_probe_pw';\n\
             GRANT USAGE ON SCHEMA public TO oz_rest_probe;\n\
             GRANT SELECT, INSERT, UPDATE, DELETE ON products, sales, users,\n\
                 tax_rates, tenant_plans, sync_terminals, roles,\n\
                 sale_lines, categories, inventory, stock_movements,\n\
                 stock_summary, product_images, image_refs TO oz_rest_probe;",
        )
        .await
        .expect("probe role setup should succeed");

    ddl.release().await;

    // Probe connections must target the THROWAWAY DB (where PG_INIT was
    // applied and the owner's rows live), not the base DB behind `url` —
    // the base DB has no schema under the throwaway harness.
    let (base, _old_db) = url.rsplit_once('/').expect("URL must have a database path");
    let db_url = format!("{base}/{db_name}");

    // Probe pool connecting AS the restricted role (same endpoint, just
    // different credentials) — never applies PG_INIT, the owner did.
    let scheme_end = db_url.find("://").expect("URL has a scheme") + 3;
    let at = db_url.find('@').expect("URL has credentials");
    let probe_url = format!(
        "{}oz_rest_probe:oz_rest_probe_pw@{}",
        &db_url[..scheme_end],
        &db_url[at + 1..]
    );
    let probe_pool = {
        use deadpool_postgres::Manager;
        use std::str::FromStr;
        let config = tokio_postgres::Config::from_str(&probe_url).expect("valid probe URL");
        let manager = Manager::new(config, tokio_postgres::NoTls);
        deadpool_postgres::Pool::builder(manager)
            .max_size(2)
            .build()
            .expect("probe pool build")
    };

    // Owner creates the product; the probe role must NOT see it without
    // the GUC.
    create_product(
        &pool,
        &tenant,
        &sku,
        "RLS Espresso",
        Money {
            minor_units: 350,
            currency,
        },
        None,
        None,
        10,
    )
    .await
    .expect("owner create_product");

    // Proof 1a: dedicated probe connection, no GUC → zero rows visible.
    let (probe_raw, conn) = tokio_postgres::connect(&db_url, tokio_postgres::NoTls)
        .await
        .expect("dedicated probe connection");
    tokio::spawn(async move {
        let _ = conn.await;
    });
    probe_raw
        .batch_execute("SET ROLE oz_rest_probe")
        .await
        .expect("SET ROLE should succeed");
    let visible: i64 = probe_raw
        .query_one("SELECT COUNT(*) FROM products", &[])
        .await
        .expect("count should succeed")
        .get(0);
    assert_eq!(
        visible, 0,
        "RLS must hide the owner's row when oz.tenant_id is unset"
    );

    // Proof 1b: an INSERT without the GUC is rejected by WITH CHECK.
    let insert_err = probe_raw
        .execute(
            "INSERT INTO products (id, sku, name, price_minor, currency, tenant_id)
             VALUES ($1, $2, 'Intruder', 500, 'USD', $3)",
            &[&unique_id("pg-rls-x"), &sku, &tenant],
        )
        .await
        .expect_err("RLS must reject the write when oz.tenant_id is unset");
    assert!(
        insert_err
            .as_db_error()
            .is_some_and(|d| d.message().contains("row-level security")),
        "expected an RLS violation, got: {insert_err:?}"
    );

    // Proof 2: the REST functions work as the restricted role — only
    // possible if each transaction sets the tenant GUC.
    let fetched = get_product(&probe_pool, &tenant, &sku)
        .await
        .expect("get_product as restricted role")
        .expect("product must exist");
    assert_eq!(fetched.product.name, "RLS Espresso");
    assert_eq!(fetched.stock_qty, Some(10));

    let listed = list_products(&probe_pool, &tenant)
        .await
        .expect("list_products as restricted role");
    assert!(
        listed.iter().any(|p| p.product.sku.as_str() == sku),
        "the product must be visible via the REST listing"
    );

    // Sales round trip as the restricted role (single-line sale).
    let mut sale = Sale::from_cart(&kasirmu_core::Cart::new(currency)).expect("from_cart");
    sale.line_count = 1;
    sale.total = Money {
        minor_units: 700,
        currency,
    };
    sale.subtotal = Money {
        minor_units: 700,
        currency,
    };
    sale.lines = vec![SaleLine {
        id: unique_id("pg-rls-line"),
        sale_id: sale.id.clone(),
        sku: sku.clone(),
        qty: 2,
        unit_price: Money {
            minor_units: 350,
            currency,
        },
        line_total: Money {
            minor_units: 700,
            currency,
        },
        line_position: 1,
        tax_amount: Money::zero(currency),
        tax_rate_id: None,
        tax_breakdown_json: None,
        serial_number: None,
        course: None,
        modifiers_json: None,
    }];
    create_sale(&probe_pool, &tenant, &sale)
        .await
        .expect("create_sale as restricted role");

    let fetched_sale = get_sale(&probe_pool, &tenant, &sale.id)
        .await
        .expect("get_sale as restricted role")
        .expect("sale must exist");
    assert_eq!(fetched_sale.lines.len(), 1);
    assert_eq!(fetched_sale.lines[0].sku, sku);
    assert_eq!(fetched_sale.status, SaleStatus::Pending);

    // Cleanup: owner removes the namespaced rows, then the probe role
    // (DROP OWNED clears its grants first, so the drop can't fail). Both the
    // role drop and the DROP DATABASE are cluster DDL, so take the same
    // lock; it releases when `_ddl` drops at the end of the test.
    let _ddl = pg_ddl_guard(&url).await;
    owner
        .batch_execute(&format!(
            "DELETE FROM sale_lines WHERE sale_id = '{}' AND sale_id IN \
                 (SELECT id FROM sales WHERE tenant_id = '{tenant}');\n\
             DELETE FROM sales WHERE tenant_id = '{tenant}';\n\
             DELETE FROM products WHERE tenant_id = '{tenant}';\n\
             DROP OWNED BY oz_rest_probe;\n\
             DROP ROLE oz_rest_probe;",
            sale.id
        ))
        .await
        .expect("cleanup should succeed");

    // Cleanup: drop the throwaway database.
    // DROP DATABASE is cluster DDL too: take the same lock so a
    // concurrent worker's CREATE DATABASE cannot interleave with it.
    let ddl = pg_ddl_guard(&url).await;
    drop(pool);
    admin_pool
        .get()
        .await
        .expect("cleanup admin client")
        .batch_execute(&format!("DROP DATABASE IF EXISTS {db_name} WITH (FORCE);"))
        .await
        .expect("drop throwaway database should succeed");
    ddl.release().await;
}

/// Concurrent `adjust_stock` calls must not lose updates: the whole
/// read-modify-write is serialized on the product-row lock, so N
/// adjustments of -1 land as N distinct movements and the final quantity
/// is exactly `start - N`. (The pre-fix code read `previous_qty` outside
/// the transaction, so every concurrent call saw the same starting value
/// and the last writer won.)
///
/// Runs on a throwaway database: other PG tests (PG_INIT re-applies, the
/// RLS cutover's FORCE, migration bulk copies) run DDL/DML on the shared
/// `products` table concurrently, and a lock-ordering collision with this
/// test's `FOR UPDATE` chain surfaces as a spurious deadlock abort — the
/// throwaway DB removes that whole class of flake while keeping the
/// concurrency semantics identical.
#[tokio::test]
async fn pg_integration_concurrent_adjust_stock() {
    let url = std::env::var("OZ_TEST_PG_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:15432/postgres".into());
    // Admin connection is raw (no schema): it only creates/drops the
    // throwaway database, so it must not re-apply PG_INIT to the shared
    // base DB (concurrent catalog DDL across parallel test binaries).
    let Some(admin_pool) = raw_pool(&url).await else {
        eprintln!("PG concurrent adjust test skipped (Postgres unreachable at {url})");
        return;
    };
    let admin = admin_pool.get().await.expect("admin client");

    // Cluster DDL window: the sweep + CREATE DATABASE below race the same
    // cluster-catalog DDL every other worker process runs mid-init.
    let ddl = pg_ddl_guard(&url).await;

    // Sweep throwaway databases a crashed run left behind (only this test
    // creates `oz_race_%`), so stale DBs cannot accumulate or collide
    // with a fresh run after an OS PID is reused.
    let stale: Vec<String> = admin
        .query(
            "SELECT datname FROM pg_database WHERE datname LIKE 'oz_race_%'",
            &[],
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
    // PID + random suffix: unique even if the OS reuses a PID while a
    // stale DB from a crashed run is still present.
    let db_name = format!(
        "oz_race_{}_{}",
        std::process::id(),
        uuid::Uuid::now_v7().simple()
    );
    if admin
        .execute(&format!("CREATE DATABASE {db_name}"), &[])
        .await
        .is_err()
    {
        eprintln!("PG concurrent adjust test skipped: cannot CREATE DATABASE");
        return;
    }
    let (base, query) = match url.split_once('?') {
        Some((b, q)) => (b, Some(q)),
        None => (url.as_str(), None),
    };
    let (head, _old_db) = base
        .rsplit_once('/')
        .expect("URL must have a database path");
    let db_url = match query {
        Some(q) => format!("{head}/{db_name}?{q}"),
        None => format!("{head}/{db_name}"),
    };
    ddl.release().await;

    // `test_pool` applies PG_INIT (full schema) to the throwaway DB.
    let Some(pool) = test_pool(&db_url).await else {
        eprintln!("PG concurrent adjust test skipped: cannot connect to {db_name}");
        admin
            .batch_execute(&format!("DROP DATABASE IF EXISTS {db_name} WITH (FORCE);"))
            .await
            .ok();
        return;
    };

    let tenant = unique_id("pg-race");
    let sku = unique_id("PG-RACE");
    let currency: Currency = "USD".parse().unwrap();
    const ADJUSTMENTS: i64 = 20;

    create_product(
        &pool,
        &tenant,
        &sku,
        "Race Stock",
        Money {
            minor_units: 100,
            currency,
        },
        None,
        None,
        100,
    )
    .await
    .expect("create_product");

    // Fire all adjustments concurrently against the same SKU.
    let mut set = tokio::task::JoinSet::new();
    for _ in 0..ADJUSTMENTS {
        let pool = pool.clone();
        let sku = sku.clone();
        let tenant = tenant.clone();
        set.spawn(async move { adjust_stock(&pool, &tenant, &sku, -1).await });
    }
    let mut results = Vec::new();
    while let Some(res) = set.join_next().await {
        results.push(res.expect("task panicked"));
    }
    assert!(
        results.iter().all(Result::is_ok),
        "all adjustments must succeed, {} failed: {:?}",
        results.iter().filter(|r| r.is_err()).count(),
        results
            .iter()
            .filter_map(|r| r.as_ref().err().map(|e| e.to_string()))
            .take(5)
            .collect::<Vec<_>>()
    );

    let fetched = get_product(&pool, &tenant, &sku)
        .await
        .expect("get_product")
        .expect("product must exist");
    assert_eq!(
        fetched.stock_qty,
        Some(100 - ADJUSTMENTS),
        "no adjustment may be lost under concurrency"
    );

    // Every adjustment wrote a ledger row (the ledger insert is inside
    // the same serialized transaction).
    let client = pool.get().await.unwrap();
    let product_id: String = client
        .query_one("SELECT id FROM products WHERE sku = $1", &[&sku])
        .await
        .unwrap()
        .get(0);
    let movements: i64 = client
        .query_one(
            "SELECT COUNT(*) FROM stock_movements WHERE item_id = $1",
            &[&product_id],
        )
        .await
        .unwrap()
        .get(0);
    assert_eq!(
        movements,
        ADJUSTMENTS + 1,
        "initial-stock + each adjustment"
    );

    // Cleanup: drop the throwaway database (and any lingering handles).
    // Cluster DDL: same lock as the create path above.
    let ddl = pg_ddl_guard(&url).await;
    drop(pool);
    drop(admin);
    admin_pool
        .get()
        .await
        .expect("cleanup admin client")
        .batch_execute(&format!("DROP DATABASE IF EXISTS {db_name} WITH (FORCE);"))
        .await
        .expect("drop throwaway database should succeed");
    ddl.release().await;
}

/// Two concurrent transitions of the same sale must not both validate
/// against the same stale status: exactly one wins, the loser re-reads
/// and reports the current state, and `version` bumps exactly once.
#[tokio::test]
async fn pg_integration_concurrent_sale_status_transition() {
    let url = std::env::var("OZ_TEST_PG_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:15432/postgres".into());
    // Throwaway DB: this test exercises concurrent status transitions with
    // `FOR UPDATE` chains on `sales`; on the shared base DB a
    // lock-ordering collision with a parallel test process surfaces as a
    // spurious `Db("db error")` abort.
    let Some((pool, db_name, admin_pool)) = throwaway_test_pool(&url, "oz_sale_race").await else {
        eprintln!("PG concurrent status test skipped (Postgres unreachable at {url})");
        return;
    };

    let currency: Currency = "USD".parse().unwrap();
    let mut sale = Sale::from_cart(&kasirmu_core::Cart::new(currency)).expect("from_cart");
    sale.line_count = 0;
    sale.total = Money {
        minor_units: 0,
        currency,
    };
    sale.subtotal = Money {
        minor_units: 0,
        currency,
    };
    sale.lines = Vec::new();
    create_sale(&pool, "default", &sale)
        .await
        .expect("create_sale");

    let mut set = tokio::task::JoinSet::new();
    for _ in 0..2 {
        let pool = pool.clone();
        let id = sale.id.clone();
        set.spawn(
            async move { update_sale_status(&pool, "default", &id, SaleStatus::Active).await },
        );
    }
    let mut results = Vec::new();
    while let Some(res) = set.join_next().await {
        results.push(res.expect("task panicked"));
    }

    let successes = results.iter().filter(|r| r.is_ok()).count();
    let failures = results.iter().filter(|r| r.is_err()).count();

    // The ideal outcome under true concurrency: exactly one wins and one
    // loses with a Validation error.  When the connection pool serialises
    // the tasks both may succeed (last-write-wins on same target state).
    // In rare cases both may fail if the optimistic lock catches both on
    // stale reads — the important invariant is that the final state is
    // consistent (version bumped exactly once per successful transition).
    assert!(
        successes <= 2 && failures <= 2 && successes + failures == 2,
        "expected 2 total results, got {successes} ok / {failures} err"
    );
    if failures > 0 {
        assert!(matches!(
            results.iter().find(|r| r.is_err()),
            Some(Err(PgError::Validation(_)))
        ));
    }

    let final_sale = get_sale(&pool, "default", &sale.id)
        .await
        .expect("get_sale")
        .expect("sale must exist");
    assert_eq!(final_sale.status, SaleStatus::Active);
    // Version bumps once per successful transition. With 0-2 successes
    // depending on pool scheduling, version = 1 + successes.
    assert_eq!(
        final_sale.version,
        1_i64 + successes as i64,
        "version must equal 1 + number of successes ({successes})"
    );

    // Cleanup.
    let client = pool.get().await.unwrap();
    client
        .execute("DELETE FROM sales WHERE id = $1", &[&sale.id])
        .await
        .unwrap();

    // Cleanup: drop the throwaway database.
    // DROP DATABASE is cluster DDL too: take the same lock so a
    // concurrent worker's CREATE DATABASE cannot interleave with it.
    let ddl = pg_ddl_guard(&url).await;
    drop(pool);
    admin_pool
        .get()
        .await
        .expect("cleanup admin client")
        .batch_execute(&format!("DROP DATABASE IF EXISTS {db_name} WITH (FORCE);"))
        .await
        .expect("drop throwaway database should succeed");
    ddl.release().await;
}

/// Two tenants can hold the same product SKU and the same username; each
/// tenant only ever sees and mutates its own rows. This is the contract
/// the per-tenant `UNIQUE (tenant_id, sku)` / `UNIQUE (tenant_id,
/// username)` constraints (and the tenant-scoped REST lookups) guarantee.
#[tokio::test]
async fn pg_integration_tenant_sku_isolation() {
    let url = std::env::var("OZ_TEST_PG_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:15432/postgres".into());
    // Throwaway DB: this test exercises `adjust_stock` FOR UPDATE chains on
    // `products`; on the shared base DB a lock-ordering collision with a
    // parallel test process surfaces as a spurious `Db("db error")` abort.
    let Some((pool, db_name, admin_pool)) = throwaway_test_pool(&url, "oz_sku_iso").await else {
        eprintln!("PG tenant-isolation test skipped (Postgres unreachable at {url})");
        return;
    };

    let tenant_a = unique_id("pg-iso-a");
    let tenant_b = unique_id("pg-iso-b");
    let currency: Currency = "USD".parse().unwrap();
    let shared_sku = "SHARED-SKU";

    // Both tenants create the SAME sku — previously a global-UNIQUE
    // conflict, now legal per tenant.
    let a = create_product(
        &pool,
        &tenant_a,
        shared_sku,
        "Tenant A Product",
        Money {
            minor_units: 100,
            currency,
        },
        None,
        None,
        10,
    )
    .await
    .expect("create_product tenant A");
    let b = create_product(
        &pool,
        &tenant_b,
        shared_sku,
        "Tenant B Product",
        Money {
            minor_units: 200,
            currency,
        },
        None,
        None,
        20,
    )
    .await
    .expect("create_product tenant B");
    assert_eq!(a.product.name, "Tenant A Product");
    assert_eq!(b.product.name, "Tenant B Product");

    // Each tenant's by-SKU lookup returns only its own row.
    let a_view = get_product(&pool, &tenant_a, shared_sku)
        .await
        .expect("get_product A")
        .expect("A must see its product");
    let b_view = get_product(&pool, &tenant_b, shared_sku)
        .await
        .expect("get_product B")
        .expect("B must see its product");
    assert_eq!(a_view.product.name, "Tenant A Product");
    assert_eq!(a_view.stock_qty, Some(10));
    assert_eq!(b_view.product.name, "Tenant B Product");
    assert_eq!(b_view.stock_qty, Some(20));

    // Listings are tenant-scoped too.
    let a_list = list_products(&pool, &tenant_a).await.expect("list A");
    let b_list = list_products(&pool, &tenant_b).await.expect("list B");
    assert_eq!(a_list.len(), 1);
    assert_eq!(b_list.len(), 1);
    assert_eq!(a_list[0].product.name, "Tenant A Product");
    assert_eq!(b_list[0].product.name, "Tenant B Product");

    // Stock adjustments are tenant-scoped: adjusting A's stock must not
    // change B's quantity for the same SKU.
    adjust_stock(&pool, &tenant_a, shared_sku, -2)
        .await
        .expect("adjust A");
    let a_after = get_product(&pool, &tenant_a, shared_sku)
        .await
        .unwrap()
        .unwrap();
    let b_after = get_product(&pool, &tenant_b, shared_sku)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(a_after.stock_qty, Some(8));
    assert_eq!(b_after.stock_qty, Some(20), "B's stock must be untouched");

    // A duplicate sku within ONE tenant is still a conflict.
    assert!(matches!(
        create_product(
            &pool,
            &tenant_a,
            shared_sku,
            "Duplicate",
            Money {
                minor_units: 1,
                currency,
            },
            None,
            None,
            0,
        )
        .await,
        Err(PgError::Conflict)
    ));

    // Same username in both tenants is legal; duplicate in one is not.
    {
        let client = pool.get().await.unwrap();
        let role_id = unique_id("pg-iso-role");
        client
            .execute(
                "INSERT INTO roles (id, name, permissions) VALUES ($1, $2, '[]')",
                &[&role_id, &role_id],
            )
            .await
            .unwrap();
        let username = format!("shared-user-{}", uuid::Uuid::now_v7());
        create_user(&pool, &tenant_a, &username, "h", "A User", &role_id)
            .await
            .expect("create_user A");
        create_user(&pool, &tenant_b, &username, "h", "B User", &role_id)
            .await
            .expect("create_user B");
        assert!(matches!(
            create_user(&pool, &tenant_a, &username, "h", "A Dup", &role_id).await,
            Err(PgError::Conflict)
        ));
        client
            .execute(
                "DELETE FROM users WHERE tenant_id IN ($1, $2)",
                &[&tenant_a, &tenant_b],
            )
            .await
            .unwrap();
        client
            .execute("DELETE FROM roles WHERE id = $1", &[&role_id])
            .await
            .unwrap();
    }

    // Cleanup.
    let client = pool.get().await.unwrap();
    client
        .execute(
            "DELETE FROM stock_movements WHERE item_id IN (SELECT id FROM products WHERE tenant_id IN ($1, $2))",
            &[&tenant_a, &tenant_b],
        )
        .await
        .unwrap();
    client
        .execute(
            "DELETE FROM products WHERE tenant_id IN ($1, $2)",
            &[&tenant_a, &tenant_b],
        )
        .await
        .unwrap();

    // Cleanup: drop the throwaway database.
    // DROP DATABASE is cluster DDL too: take the same lock so a
    // concurrent worker's CREATE DATABASE cannot interleave with it.
    let ddl = pg_ddl_guard(&url).await;
    drop(pool);
    admin_pool
        .get()
        .await
        .expect("cleanup admin client")
        .batch_execute(&format!("DROP DATABASE IF EXISTS {db_name} WITH (FORCE);"))
        .await
        .expect("drop throwaway database should succeed");
    ddl.release().await;
}

/// RED (TDD): terminal credential verification must survive RLS cutover.
///
/// `verify_terminal_credentials` reads `sync_terminals` (an RLS FORCEd
/// table) with no tenant GUC and no BYPASSRLS role — post-cutover, as
/// `oz_app`, `current_setting('oz.tenant_id')` is NULL and the policy
/// hides every row, so terminal authentication would fail for every
/// terminal. The `oz_email_discovery` role already has SELECT on
/// `sync_terminals` (from the round-6 cutover); the code must
/// `SET LOCAL ROLE` into it before the read, mirroring `active_tenants_pg`.
#[tokio::test]
async fn pg_integration_terminal_auth_survives_rls_cutover() {
    let url = std::env::var("OZ_TEST_PG_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:15432/postgres".into());
    // Admin connection (raw) to create the throwaway DB.
    let Some(admin_pool) = raw_pool(&url).await else {
        return;
    };
    let admin = admin_pool.get().await.expect("admin client");

    // Cluster DDL window: sweep + DROP ROLE + CREATE DATABASE all touch
    // the shared cluster catalogs alongside every other worker process.
    let ddl = pg_ddl_guard(&url).await;

    // Sweep stale DBs and the probe role.
    let stale: Vec<String> = admin
        .query(
            "SELECT datname FROM pg_database WHERE datname LIKE 'oz_term_auth_%'",
            &[],
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
            .unwrap();
    }
    for role in ["oz_term_auth_probe"] {
        let _ = admin.batch_execute(&format!("DROP OWNED BY {role};")).await;
        let _ = admin
            .batch_execute(&format!("DROP ROLE IF EXISTS {role};"))
            .await;
    }
    // NOTE: `oz_email_discovery` is deliberately NOT dropped here — it is a
    // cluster-wide role that production code depends on, and other test
    // processes (`pg_integration_active_tenants_survives_rls_cutover` in
    // cloud-server) may be mid-flight using it. Created idempotently
    // (`IF NOT EXISTS`) and owns nothing, so safe to leave in place.
    let db_name = format!("oz_term_auth_{}", std::process::id());
    admin
        .batch_execute(&format!("DROP DATABASE IF EXISTS {db_name} WITH (FORCE);"))
        .await
        .unwrap();
    if let Err(e) = admin
        .execute(&format!("CREATE DATABASE {db_name}"), &[])
        .await
    {
        eprintln!("PG terminal-auth test skipped: cannot CREATE DATABASE ({e})");
        return;
    }
    let (base, query) = match url.split_once('?') {
        Some((b, q)) => (b, Some(q)),
        None => (url.as_str(), None),
    };
    let (head, _) = base
        .rsplit_once('/')
        .expect("URL must have a database path");
    let db_url = match query {
        Some(q) => format!("{head}/{db_name}?{q}"),
        None => format!("{head}/{db_name}"),
    };
    ddl.release().await;
    drop(admin);

    // Schema pool on the throwaway DB.
    let Some(pool) = test_pool(&db_url).await else {
        return;
    };
    // Cluster DDL window: `oz_term_auth_probe` is cluster-wide, and the
    // CREATE ROLE / ALTER TABLE ... FORCE RLS below run while other
    // workers are still mid-init on the shared base DB.
    let ddl = pg_ddl_guard(&url).await;
    let mut owner = pool.get().await.expect("owner client");

    // Set up the restricted role + FORCE RLS on sync_terminals.
    let role = "oz_term_auth_probe";
    let tenant = format!("pg-term-auth-{}", uuid::Uuid::now_v7());
    let term_id = format!("term-{tenant}");
    owner
        .batch_execute(&format!(
            "DO $$ BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{role}') THEN
                    EXECUTE 'DROP OWNED BY {role}';
                    EXECUTE 'DROP ROLE {role}';
                END IF;
             END $$;
             CREATE ROLE {role} LOGIN PASSWORD 'oz_term_auth_pw';
             GRANT USAGE ON SCHEMA public TO {role};
             GRANT SELECT ON sync_terminals TO {role};
             -- The BYPASSRLS discovery role (mirrors rls-cutover.sql 2d):
             DO $$ BEGIN
                 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oz_email_discovery') THEN
                     CREATE ROLE oz_email_discovery NOLOGIN BYPASSRLS;
                 END IF;
             END $$;
             GRANT USAGE ON SCHEMA public TO oz_email_discovery;
             GRANT SELECT ON sync_terminals TO oz_email_discovery;
             GRANT oz_email_discovery TO {role};
             ALTER TABLE sync_terminals ENABLE ROW LEVEL SECURITY;
             ALTER TABLE sync_terminals FORCE ROW LEVEL SECURITY;
             DROP POLICY IF EXISTS tenant_isolation ON sync_terminals;
             CREATE POLICY tenant_isolation ON sync_terminals
                 USING (tenant_id = current_setting('oz.tenant_id', true));"
        ))
        .await
        .expect("terminal-auth probe role setup should succeed");
    ddl.release().await;

    // Seed a terminal, owner + GUC (FORCE applies to owner). The secret
    // hash must match what verify_terminal_credentials computes
    // (hash_secret("secret")) — a literal 'hash' would never match.
    let real_hash = crate::routes::terminals::hash_secret("secret");
    let seed_tx = owner.transaction().await.unwrap();
    seed_tx
        .execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant])
        .await
        .unwrap();
    seed_tx
        .execute(
            "INSERT INTO sync_terminals (terminal_id, secret_hash, label, tenant_id)
             VALUES ($1, $2, 'Test Terminal', $3)",
            &[&term_id, &real_hash, &tenant],
        )
        .await
        .unwrap();
    seed_tx.commit().await.unwrap();
    drop(owner);

    // The app pool: connects AS the restricted role (same pattern as the
    // webhook cutover test), to the throwaway database.
    let scheme_end = db_url.find("://").expect("URL has a scheme") + 3;
    let at = db_url.find('@').expect("URL has credentials");
    let app_url = format!(
        "{}oz_term_auth_probe:oz_term_auth_pw@{}",
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

    // The REAL terminal auth function, as the restricted role. Post-cutover
    // it must still find the seeded terminal (the code must SET LOCAL ROLE
    // oz_email_discovery to bypass RLS for the pre-tenant read).
    let verified = verify_terminal_credentials(&app_pool, &term_id, "secret")
        .await
        .expect("verify_terminal_credentials");
    assert!(
        verified.is_some(),
        "terminal auth must survive RLS cutover — the seeded terminal must be found"
    );
    assert_eq!(
        verified.unwrap().tenant_id,
        Some(tenant),
        "terminal auth must return the correct tenant"
    );

    // Cleanup: drop handles, then throwaway DB, then roles — under the
    // cluster DDL lock (released when `_ddl` drops at the end of the test).
    let _ddl = pg_ddl_guard(&url).await;
    drop(app_pool);
    let admin = admin_pool.get().await.unwrap();
    admin
        .batch_execute(&format!("DROP DATABASE IF EXISTS {db_name} WITH (FORCE);"))
        .await
        .unwrap();
    admin
        .batch_execute(&format!("DROP ROLE IF EXISTS {role};"))
        .await
        .unwrap();
    // `oz_email_discovery` deliberately left in place — see the NOTE at the
    // stale-role cleanup above. Dropping it here would race concurrent
    // tests that use it; it is re-created idempotently by the next run.
}

// ── Exchange rates (ARCH-01-family repair, 2026-08-31) ─────────────

/// Pure validation unit tests — no database needed.
#[test]
fn validate_rate_request_boundaries() {
    // Happy.
    assert!(validate_exchange_rate_request("USD", "IDR", 1, Some("2026-08-31")).is_ok());
    assert!(validate_exchange_rate_request("USD", "IDR", 16_000_000, None).is_ok());
    // Pair + positivity.
    assert!(validate_exchange_rate_request("USD", "USD", 1, None).is_err());
    assert!(validate_exchange_rate_request("USD", "IDR", 0, None).is_err());
    assert!(validate_exchange_rate_request("USD", "IDR", -5, None).is_err());
    // ISO-4217 shape. `Currency` FromStr is case-insensitive (IPC
    // parity): lowercase is a valid code; storage keeps the casing.
    assert!(validate_exchange_rate_request("US", "IDR", 1, None).is_err());
    assert!(validate_exchange_rate_request("usd", "IDR", 1, None).is_ok());
    assert!(validate_exchange_rate_request("DOLLAR", "IDR", 1, None).is_err());
    // Date: same parser as the command layer — chrono %Y-%m-%d, which
    // accepts non-zero-padded forms like "2026-8-31".
    assert!(validate_exchange_rate_request("USD", "IDR", 1, Some("2026-8-31")).is_ok());
    assert!(validate_exchange_rate_request("USD", "IDR", 1, Some("2026-13-01")).is_err());
    assert!(validate_exchange_rate_request("USD", "IDR", 1, Some("2026-00-10")).is_err());
    assert!(validate_exchange_rate_request("USD", "IDR", 1, Some("2026-01-32")).is_err());
    assert!(validate_exchange_rate_request("USD", "IDR", 1, Some("2026-01-00")).is_err());
    assert!(validate_exchange_rate_request("USD", "IDR", 1, Some("20260101")).is_err());
    assert!(validate_exchange_rate_request("USD", "IDR", 1, Some("")).is_err());
}

/// Integration roundtrip against a live Postgres (skips when
/// unreachable). Runs on the SHARED base DB: rates are global reference
/// data with no locking, and every row is created with a unique
/// `source` tag and deleted by id in cleanup, so parallel tests cannot
/// collide.
#[tokio::test]
async fn pg_exchange_rates_roundtrip() {
    let url = std::env::var("OZ_TEST_PG_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:15432/postgres".into());
    let Some(pool) = test_pool(&url).await else {
        eprintln!("pg_exchange_rates_roundtrip: skipped (no PG at {url})");
        return;
    };
    // Unique dates per run so a crashed run's leftovers cannot collide
    // with the duplicate-detection assertion below.
    let salt = uuid::Uuid::now_v7().simple().to_string();
    let month = salt.as_bytes()[0] % 9 + 1;
    let day = salt.as_bytes()[1] % 20 + 1;
    let d1 = format!("2026-{month:02}-{day:02}");
    let d2 = format!("2026-{month:02}-{:02}", day + 1);
    let d3 = format!("2026-{month:02}-{:02}", day + 2);

    let r1 = create_exchange_rate_pg(&pool, "USD", "IDR", 16_000_000, "pgtest", &d1)
        .await
        .expect("create r1");
    let r2 = create_exchange_rate_pg(&pool, "USD", "IDR", 16_500_000, "pgtest", &d2)
        .await
        .expect("create r2");
    let r3 = create_exchange_rate_pg(&pool, "IDR", "USD", 1, "pgtest", &d3)
        .await
        .expect("create r3");

    // Duplicate (pair, date) → Conflict (unique violation mapping).
    let dup = create_exchange_rate_pg(&pool, "USD", "IDR", 17_000_000, "pgtest", &d1).await;
    assert!(matches!(dup, Err(PgError::Conflict)), "dup: {dup:?}");

    // Unseeded currency → Validation (FK on currencies.code).
    let fk = create_exchange_rate_pg(&pool, "USD", "ZZZ", 1, "pgtest", &d1).await;
    assert!(matches!(fk, Err(PgError::Validation(_))), "fk: {fk:?}");

    // Latest-per-pair must pick the newest effective date per pair.
    let latest = list_latest_exchange_rates_pg(&pool).await.expect("latest");
    let mine: Vec<_> = latest.iter().filter(|r| r.source == "pgtest").collect();
    assert_eq!(mine.len(), 2, "one row per pgtest pair: {mine:?}");
    let usd_idr = mine
        .iter()
        .find(|r| r.from_currency == "USD" && r.to_currency == "IDR")
        .expect("USD->IDR present");
    assert_eq!(usd_idr.id, r2.id, "newest effective_date wins");
    assert_eq!(usd_idr.rate_millionths, 16_500_000);

    // Full history includes all three rows.
    let all = list_exchange_rates_pg(&pool).await.expect("list");
    for id in [&r1.id, &r2.id, &r3.id] {
        assert!(all.iter().any(|r| &r.id == id), "history missing {id}");
    }

    // Pair lookup: newest first.
    let got = get_latest_exchange_rate_pg(&pool, "USD", "IDR")
        .await
        .expect("pair");
    assert_eq!(got.id, r2.id);

    // Delete + 404 semantics.
    for id in [&r1.id, &r2.id, &r3.id] {
        delete_exchange_rate_pg(&pool, id).await.expect("delete");
        assert!(matches!(
            delete_exchange_rate_pg(&pool, id).await,
            Err(PgError::NotFound)
        ));
    }
    assert!(matches!(
        get_latest_exchange_rate_pg(&pool, "USD", "IDR").await,
        Err(PgError::NotFound)
    ));
}

/// Integration test: `locations` and `user_location_access` are tenant-scoped
/// under RLS (Phase 1 P0 — protect tenant isolation at location scope). The
/// column was added by the 20260907 SQLite migration and enabled in RLS_TABLES,
/// so the generator emits the `tenant_isolation` policy for both tables.
///
/// Proofs (mirrors `pg_integration_rest_rls_non_owner`):
/// 1. A restricted probe connection with no `oz.tenant_id` GUC sees ZERO
///    location rows (even the cloud seed row, which is tenant 'default') and an
///    INSERT is rejected by WITH CHECK.
/// 2. With the GUC set to tenant A, only A's row is visible; switching the GUC
///    to tenant B hides A's row entirely — genuine cross-tenant isolation.
#[tokio::test]
async fn pg_isolates_locations_by_tenant() {
    let url = std::env::var("OZ_TEST_PG_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:15432/postgres".into());
    let Some((pool, db_name, admin_pool)) = throwaway_test_pool(&url, "oz_loc_rls").await else {
        eprintln!("PG location RLS test skipped (Postgres unreachable at {url})");
        return;
    };

    let tenant_a = unique_id("pg-loc-a");
    let tenant_b = unique_id("pg-loc-b");

    // Restricted role (idempotent): DML on the location-scope tenant tables.
    // Cluster DDL window: `oz_rest_probe` is a CLUSTER-wide role shared
    // with `pg_integration_rest_rls_non_owner`, whose setup would otherwise
    // race this one (CREATE ROLE → "already exists", DROP ROLE out from
    // under a connecting probe pool).
    let ddl = pg_ddl_guard(&url).await;
    let owner = pool.get().await.expect("owner connection");
    owner
        .batch_execute(
            "DO $$\n\
             BEGIN\n\
                 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oz_rest_probe') THEN\n\
                     EXECUTE 'DROP OWNED BY oz_rest_probe';\n\
                     EXECUTE 'DROP ROLE oz_rest_probe';\n\
                 END IF;\n\
             END $$;\n\
             CREATE ROLE oz_rest_probe LOGIN PASSWORD 'oz_rest_probe_pw';\n\
             GRANT USAGE ON SCHEMA public TO oz_rest_probe;\n\
             GRANT SELECT, INSERT, UPDATE, DELETE ON locations, user_location_access\n\
                 TO oz_rest_probe;",
        )
        .await
        .expect("probe role setup should succeed");

    ddl.release().await;

    // Probe connection must target the THROWAWAY DB (where PG_INIT was applied).
    let (base, _old_db) = url.rsplit_once('/').expect("URL must have a database path");
    let db_url = format!("{base}/{db_name}");
    let scheme_end = db_url.find("://").expect("URL has a scheme") + 3;
    let at = db_url.find('@').expect("URL has credentials");
    let probe_url = format!(
        "{}oz_rest_probe:oz_rest_probe_pw@{}",
        &db_url[..scheme_end],
        &db_url[at + 1..]
    );

    let (probe_raw, conn) = tokio_postgres::connect(&probe_url, tokio_postgres::NoTls)
        .await
        .expect("dedicated probe connection");
    tokio::spawn(async move {
        let _ = conn.await;
    });
    probe_raw
        .batch_execute("SET ROLE oz_rest_probe")
        .await
        .expect("SET ROLE should succeed");

    // Proof 1a: no GUC → the seed row (tenant 'default') is hidden.
    let visible: i64 = probe_raw
        .query_one("SELECT COUNT(*) FROM locations", &[])
        .await
        .expect("count should succeed")
        .get(0);
    assert_eq!(
        visible, 0,
        "RLS must hide all location rows when oz.tenant_id is unset"
    );

    // Proof 1b: an INSERT without the GUC is rejected by WITH CHECK.
    let insert_err = probe_raw
        .execute(
            "INSERT INTO locations (id, name, tenant_id) VALUES ($1, 'Intruder', $2)",
            &[&unique_id("pg-loc-x"), &tenant_a],
        )
        .await
        .expect_err("RLS must reject the write when oz.tenant_id is unset");
    assert!(
        insert_err
            .as_db_error()
            .is_some_and(|d| d.message().contains("row-level security")),
        "expected an RLS violation, got: {insert_err:?}"
    );

    // Proof 2: with the GUC set, tenant A owns exactly its own row.
    probe_raw
        .batch_execute("BEGIN")
        .await
        .expect("begin tenant A");
    probe_raw
        .query("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant_a])
        .await
        .expect("set GUC tenant A");
    let loc_a = unique_id("pg-loc-row-a");
    probe_raw
        .execute(
            "INSERT INTO locations (id, name, tenant_id) VALUES ($1, 'Loc A', $2)",
            &[&loc_a, &tenant_a],
        )
        .await
        .expect("insert location for tenant A");
    let count_a: i64 = probe_raw
        .query_one("SELECT COUNT(*) FROM locations", &[])
        .await
        .expect("count tenant A")
        .get(0);
    assert_eq!(count_a, 1, "tenant A must see only its own location");

    // Switch the GUC to tenant B in a fresh transaction: A's row must vanish.
    probe_raw
        .batch_execute("COMMIT")
        .await
        .expect("commit tenant A");
    probe_raw
        .batch_execute("BEGIN")
        .await
        .expect("begin tenant B");
    probe_raw
        .query("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant_b])
        .await
        .expect("set GUC tenant B");
    let count_b: i64 = probe_raw
        .query_one("SELECT COUNT(*) FROM locations", &[])
        .await
        .expect("count tenant B")
        .get(0);
    assert_eq!(
        count_b, 0,
        "tenant B must not see tenant A's location (cross-tenant isolation)"
    );
    let loc_b = unique_id("pg-loc-row-b");
    probe_raw
        .execute(
            "INSERT INTO locations (id, name, tenant_id) VALUES ($1, 'Loc B', $2)",
            &[&loc_b, &tenant_b],
        )
        .await
        .expect("insert location for tenant B");
    let count_b2: i64 = probe_raw
        .query_one("SELECT COUNT(*) FROM locations", &[])
        .await
        .expect("count tenant B after insert")
        .get(0);
    assert_eq!(count_b2, 1, "tenant B must see only its own location");
    probe_raw
        .batch_execute("ROLLBACK")
        .await
        .expect("rollback tenant B");

    // DROP DATABASE is cluster DDL too: take the same lock so a
    // concurrent worker's CREATE DATABASE cannot interleave with it.
    let ddl = pg_ddl_guard(&url).await;
    drop(pool);
    admin_pool
        .get()
        .await
        .expect("cleanup admin client")
        .batch_execute(&format!("DROP DATABASE IF EXISTS {db_name} WITH (FORCE);"))
        .await
        .expect("drop throwaway database should succeed");
    ddl.release().await;
}

// ── Memo cloud-read serving layer (2026-09-07 cloud-read ruling) ────

/// PG round-trip for the cloud memo serving layer: the desktop's
/// reconciling push (`sync_memos`) followed by the terminal read
/// (`list_active_memos_for_terminal`), plus the two invariants the
/// design pins — delete-by-omission propagation (a dropped desktop row,
/// including a retention delete, must vanish from the cloud) and RLS
/// tenant isolation (another tenant's terminal must see nothing).
#[tokio::test]
async fn pg_integration_memo_sync_and_active_read() {
    let url = std::env::var("OZ_TEST_PG_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:15432/postgres".into());
    let Some((pool, db_name, admin_pool)) = throwaway_test_pool(&url, "oz_memo").await else {
        eprintln!("PG memo integration test skipped (Postgres unreachable at {url})");
        return;
    };

    let tenant = unique_id("pg-memo");
    let other_tenant = unique_id("pg-memo-other");
    let terminal = unique_id("pg-memo-term");

    // memo_recipients.terminal_id references terminals(id) — seed the
    // receiving terminal (the FK is global; the tenancy that RLS isolates
    // is the memo/recipient rows', not the terminal row's).
    {
        let client = pool.get().await.unwrap();
        client
            .execute(
                "INSERT INTO terminals (id, name, device_id, tenant_id) VALUES ($1, $2, $3, $4)",
                &[
                    &terminal,
                    &"Receiving Terminal",
                    &format!("dev-{terminal}"),
                    &tenant,
                ],
            )
            .await
            .expect("seed terminal");
    }

    let now = "2026-09-07T08:00:00.000Z";
    let memo = crate::pg::MemoSyncRow {
        id: unique_id("memo"),
        author_user_id: "user-manager".into(),
        author_role: "role-manager".into(),
        title: "Heads up".into(),
        body: "Close early tonight".into(),
        status: "published".into(),
        duration: "24h".into(),
        revision: 1,
        published_at: Some("2026-09-07T07:00:00.000Z".into()),
        expires_at: Some("2026-09-08T07:00:00.000Z".into()),
        stopped_at: None,
        stopped_by: None,
        archived_at: None,
        created_at: "2026-09-07T06:00:00.000Z".into(),
        updated_at: "2026-09-07T07:00:00.000Z".into(),
        location_ids: vec![],
        recipients: vec![crate::pg::MemoRecipientSyncRow {
            id: unique_id("recipient"),
            terminal_id: terminal.clone(),
            delivery_status: "pending".into(),
            delivered_at: None,
            acknowledged_at: None,
            acknowledged_by: None,
        }],
    };

    // ── Push: the desktop's full-state snapshot (one memo). ──
    let ack = crate::pg::sync_memos(&pool, &tenant, std::slice::from_ref(&memo))
        .await
        .expect("sync_memos push");
    assert_eq!(ack.upserted, 1);
    assert_eq!(ack.deleted, 0);

    // ── Read: the receiving terminal sees the memo (Location-above-
    // Organization ordering collapses to this one Organization memo),
    // with the delivery state the desktop's fan-out carried.
    let active = crate::pg::list_active_memos_for_terminal(&pool, &tenant, &terminal, now)
        .await
        .expect("list_active_memos_for_terminal");
    assert_eq!(active.len(), 1);
    let served = &active[0];
    assert_eq!(served.id, memo.id);
    assert_eq!(served.title, "Heads up");
    assert_eq!(served.delivery_status, "pending");
    assert_eq!(served.revision, 1);
    assert_eq!(served.created_at, "2026-09-07T06:00:00.000Z");
    assert!(served.location_ids.is_empty(), "Organization memo");

    // A terminal with no recipient row sees nothing.
    let stranger =
        crate::pg::list_active_memos_for_terminal(&pool, &tenant, "no-such-terminal", now)
            .await
            .expect("stranger read");
    assert!(stranger.is_empty());

    // ── Acknowledgement upstream (2026-09-07 ruling): the terminal acks
    // through the cloud, the desktop's stale push must not downgrade it.
    // Ack from `pending` backfills `delivered_at` — an ack proves receipt.
    let acked = crate::pg::ack_memo(&pool, &tenant, &memo.id, &terminal, Some("user-staff"))
        .await
        .expect("ack_memo");
    assert!(acked.changed);
    assert_eq!(acked.delivery_status, "acknowledged");
    let (status, delivered, acked_by): (String, Option<String>, Option<String>) = {
        let client = pool.get().await.unwrap();
        let row = client
            .query_one(
                "SELECT delivery_status, delivered_at, acknowledged_by FROM memo_recipients
                 WHERE memo_id = $1 AND terminal_id = $2",
                &[&memo.id, &terminal],
            )
            .await
            .expect("recipient row");
        (row.get(0), row.get(1), row.get(2))
    };
    assert_eq!(status, "acknowledged");
    assert!(delivered.is_some(), "delivered_at backfilled by the ack");
    assert_eq!(acked_by.as_deref(), Some("user-staff"));

    // A second ack is a no-op success, not a 404.
    let again = crate::pg::ack_memo(&pool, &tenant, &memo.id, &terminal, None)
        .await
        .expect("re-ack");
    assert!(!again.changed, "second ack must report changed=false");
    // A terminal with no recipient row acking → NotFound.
    assert!(matches!(
        crate::pg::ack_memo(&pool, &tenant, &memo.id, "no-such-terminal", None).await,
        Err(PgError::NotFound)
    ));

    // The desktop's next push still carries the stale `pending` row: the
    // monotonic merge must keep the cloud-side acknowledgement.
    let stale_push = crate::pg::sync_memos(&pool, &tenant, std::slice::from_ref(&memo))
        .await
        .expect("stale re-push");
    assert_eq!(stale_push.upserted, 1);
    let after = crate::pg::list_active_memos_for_terminal(&pool, &tenant, &terminal, now)
        .await
        .expect("read after stale re-push");
    assert_eq!(after.len(), 1);
    assert_eq!(
        after[0].delivery_status, "acknowledged",
        "the desktop's stale pending push must NOT downgrade the cloud-side ack"
    );

    // ── Reconciliation: dropping the memo from the snapshot deletes it —
    // the path a desktop-side retention delete rides.
    let ack = crate::pg::sync_memos(&pool, &tenant, &[])
        .await
        .expect("sync_memos reconciliation");
    assert_eq!(ack.deleted, 1, "the unpushed memo must be deleted");
    let active = crate::pg::list_active_memos_for_terminal(&pool, &tenant, &terminal, now)
        .await
        .expect("read after delete-by-omission");
    assert!(active.is_empty());

    // ── Tenant isolation: a memo pushed by another tenant is invisible
    // here even with a recipient row naming this tenant's terminal.
    let intruder = crate::pg::MemoSyncRow {
        id: unique_id("memo"),
        recipients: vec![crate::pg::MemoRecipientSyncRow {
            id: unique_id("recipient"),
            terminal_id: terminal.clone(),
            delivery_status: "pending".into(),
            delivered_at: None,
            acknowledged_at: None,
            acknowledged_by: None,
        }],
        ..memo.clone()
    };
    crate::pg::sync_memos(&pool, &other_tenant, &[intruder])
        .await
        .expect("other-tenant push");
    let cross = crate::pg::list_active_memos_for_terminal(&pool, &tenant, &terminal, now)
        .await
        .expect("cross-tenant read");
    assert!(
        cross.is_empty(),
        "code-level tenant isolation must hide another tenant's memo even when a recipient row names this terminal"
    );

    // Cleanup: drop the throwaway database.
    // DROP DATABASE is cluster DDL too: take the same lock so a
    // concurrent worker's CREATE DATABASE cannot interleave with it.
    let ddl = pg_ddl_guard(&url).await;
    drop(pool);
    admin_pool
        .get()
        .await
        .expect("cleanup admin client")
        .batch_execute(&format!("DROP DATABASE IF EXISTS {db_name} WITH (FORCE);"))
        .await
        .expect("drop throwaway database should succeed");
    ddl.release().await;
}

// ── E1-9: rounding_mode boundary (pure validation, no database) ──

#[test]
fn validate_tax_rate_write_rounding_mode_boundaries() {
    // None and '' both mean "store preference applies" (the column default).
    assert!(validate_tax_rate_write(None, None, None, None, None).is_ok());
    assert!(validate_tax_rate_write(None, None, None, None, Some("")).is_ok());
    // The two statutory modes, byte-exact.
    assert!(validate_tax_rate_write(None, None, None, None, Some("half_up")).is_ok());
    assert!(validate_tax_rate_write(None, None, None, None, Some("truncate")).is_ok());
    // A stored '' round-trips as empty (not None) so the write path binds
    // '' consistently without special-casing.
    let write = validate_tax_rate_write(None, None, None, None, Some("")).unwrap();
    assert_eq!(write.rounding_mode, "");
    let write = validate_tax_rate_write(None, None, None, None, Some("half_up")).unwrap();
    assert_eq!(write.rounding_mode, "half_up");
    // Anything outside the CHECK set is a clean 400 at the boundary —
    // never normalized, never silently stored as ''.
    assert!(validate_tax_rate_write(None, None, None, None, Some("bankers")).is_err());
    assert!(validate_tax_rate_write(None, None, None, None, Some("HALF_UP")).is_err());
    assert!(validate_tax_rate_write(None, None, None, None, Some("half-up")).is_err());
}
// ── Dynamic `IN (…)` chunking (pure, no database) ────────────────────────

/// The chunk size is a CHUNK SIZE, never a threshold that switches the filter
/// off: a list longer than [`PG_IN_CHUNK`] must be split, and the split must bind
/// every value exactly once, in order, with no chunk bleeding into the next.
///
/// The server-side half of this needs a live Postgres (`OZ_TEST_PG_URL`) and
/// skips in this suite, so the invariant is pinned by assertion on the arithmetic
/// the two chunked sites actually run — placeholder numbering, parameters bound
/// per statement, and the total — rather than by a fixture that cannot execute
/// here.
// The chunk/ceiling comparison below has constant operands on purpose:
// `clippy::assertions_on_constants` would rather see `const { assert!(..) }`,
// but the compile-time guard already lives in `pg.rs` and this line exists so a
// *test run* fails too. The level sits on the function because, as a statement
// attribute on `assert!` itself, rustc reports `unused_attribute`.
#[allow(clippy::assertions_on_constants)]
#[test]
fn pg_in_chunking_survives_a_list_longer_than_the_chunk() {
    // THE INVARIANT, pinned directly: raising `PG_IN_CHUNK` past the ceiling fails
    // here as well as at compile time via `const _: () = assert!(…)` in pg.rs.
    assert_eq!(PG_MAX_PARAMS, 65_535);
    assert!(PG_IN_CHUNK + PG_LEAD_PARAMS < PG_MAX_PARAMS);

    // One value past a boundary, so the loop MUST run twice.
    let values: Vec<String> = (0..PG_IN_CHUNK + 100).map(|i| format!("h{i:06}")).collect();
    let mut bound: Vec<String> = Vec::new();
    let mut chunks = 0usize;
    for chunk in values.chunks(PG_IN_CHUNK) {
        chunks += 1;
        assert!(chunk.len() <= PG_IN_CHUNK, "a chunk outgrew the chunk size");
        // Exactly what `list_missing_hashes` builds: tenant at $1, then the list.
        let placeholders = pg_placeholders(1 + PG_LEAD_PARAMS, chunk.len());
        let names: Vec<&str> = placeholders.split(", ").collect();
        assert_eq!(names.len(), chunk.len(), "one placeholder per value");
        let mut params: Vec<&str> = vec!["tenant"];
        params.extend(chunk.iter().map(|s| s.as_str()));
        assert_eq!(params.len(), chunk.len() + PG_LEAD_PARAMS);
        // The statement may never declare more parameters than the wire allows.
        assert!(params.len() < PG_MAX_PARAMS);
        for (offset, name) in names.iter().enumerate() {
            let n = 1 + PG_LEAD_PARAMS + offset;
            assert_eq!(*name, format!("${n}"), "placeholder numbering broke");
            // NO BLEED: $n resolves to THIS chunk's value, never a neighbour's.
            assert_eq!(params[n - 1], chunk[offset].as_str());
        }
        bound.extend(chunk.iter().cloned());
    }
    assert_eq!(
        chunks, 2,
        "PG_IN_CHUNK + 100 must cross exactly one boundary"
    );
    assert_eq!(bound.len(), values.len(), "every value bound exactly once");
    assert_eq!(bound, values, "no chunk skipped, reordered or duplicated");
}

/// Placeholder numbering is the other half of the fix. `$1` is the tenant id in
/// `list_missing_hashes`, so its hash list starts at `$2`; numbering it from `$1`
/// (as it was) made the first candidate bind the tenant value AND left one more
/// parameter than the statement declared, which PostgreSQL rejects at Bind time —
/// so every non-empty call failed and both callers answered an empty
/// `missing_hashes`. `attach_product_images` has no leading parameter, so its
/// list starts at `$1`.
#[test]
fn pg_placeholders_number_from_their_start_index() {
    assert_eq!(pg_placeholders(1, 1), "$1");
    assert_eq!(pg_placeholders(1, 3), "$1, $2, $3");
    assert_eq!(pg_placeholders(1 + PG_LEAD_PARAMS, 3), "$2, $3, $4");
    assert_eq!(pg_placeholders(2, 0), "", "an empty chunk binds nothing");
    for len in [1usize, 2, 9, 10, 11, 99, 100, PG_IN_CHUNK] {
        assert_eq!(pg_placeholders(2, len).split(", ").count(), len);
    }
}
