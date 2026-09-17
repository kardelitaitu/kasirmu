use super::*;
use rusqlite::params;
use serial_test::serial;

/// Create a process-unique throwaway database (mirrors email_pg_tests.rs).
/// Returns `(db_url, db_name, admin_pool)` — the admin pool stays connected
/// to the base DB so the caller can `DROP DATABASE` on cleanup. Returns
/// `None` (test skips) when Postgres is unreachable or the URL role lacks
/// `CREATE DATABASE`.
async fn throwaway_pg_db(
    url: &str,
    prefix: &str,
) -> Option<(String, String, deadpool_postgres::Pool)> {
    let admin_pool = match crate::db::DbPool::connect_postgres(url, false, 20, false).await {
        Ok(crate::db::DbPool::Postgres(p)) => p,
        Ok(_) => unreachable!("connect_postgres with a postgres:// URL returns Postgres"),
        Err(e) => {
            eprintln!("PG test skipped: {e}");
            return None;
        }
    };
    let admin = admin_pool.get().await.expect("admin client");
    // Sweep stale throwaway DBs from a crashed run.
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

/// The prune DELETE must treat ids as data, never as SQL. The cloud
/// server accepts client-supplied ids verbatim in `push_handler` (no
/// UUID validation), so a hostile id sitting in an old synced row must
/// not execute arbitrary statements when the hourly prune runs — the
/// "IDs are UUIDv7 — safe" comment is an assumption, not an invariant.
#[serial(pg_rls_cutover)]
#[test]
fn prune_delete_treats_hostile_id_as_data() {
    let conn = kasirmu_core::migrations::fresh_db();
    // An old synced row whose id carries a statement terminator plus a
    // destructive CREATE. If the DELETE interpolates the id, `hacked`
    // appears in the schema.
    let hostile_id = "x'); CREATE TABLE hacked(id TEXT);--";
    conn.execute(
        "INSERT INTO offline_queue (id, action, payload, status, retry_count, last_error, created_at, synced_at, tenant_id, priority)
         VALUES (?1, 'act', '{}', 'synced', 0, NULL, '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z', 't1', 1)",
        params![hostile_id],
    )
    .unwrap();

    let db = Arc::new(Mutex::new(conn));
    tokio::runtime::Runtime::new()
        .unwrap()
        .block_on(run_prune_cycle(&db));

    let conn = db.blocking_lock();
    let hacked: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'hacked'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        hacked, 0,
        "hostile id must never execute SQL in the prune DELETE"
    );
}
/// P-1 retention must cover API-pushed rows. `push_handler` persists
/// every accepted item with status `pending` and nothing ever
/// transitions it server-side, so the old `status IN ('synced','failed')`
/// filter exempted the entire push path — the cloud queue grew without
/// bound. Retention applies to every status: rows older than the 90-day
/// horizon are pruned (the anchor_expired -> snapshot recovery path is
/// the designed guardrail for stragglers), recent rows survive.
#[serial(pg_rls_cutover)]
#[test]
fn prune_ages_out_old_pending_rows_like_synced_ones() {
    let conn = kasirmu_core::migrations::fresh_db();
    conn.execute_batch(
        "INSERT INTO offline_queue (id, action, payload, status, retry_count, last_error, created_at, synced_at, tenant_id, priority) VALUES
         ('old-pending', 'act', '{}', 'pending', 0, NULL, '2025-01-01T00:00:00Z', NULL, 't1', 1),
         ('old-synced', 'act', '{}', 'synced', 0, NULL, '2025-01-02T00:00:00Z', '2025-01-03T00:00:00Z', 't1', 1),
         ('recent-pending', 'act', '{}', 'pending', 0, NULL, '2026-08-09T00:00:00Z', NULL, 't1', 1)"
    )
    .unwrap();

    let db = Arc::new(Mutex::new(conn));
    tokio::runtime::Runtime::new()
        .unwrap()
        .block_on(run_prune_cycle(&db));

    let conn = db.blocking_lock();
    let remaining: Vec<String> = conn
        .prepare("SELECT id FROM offline_queue ORDER BY id")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();
    assert_eq!(
        remaining,
        vec!["recent-pending".to_string()],
        "old pending and old synced rows must be pruned; the recent pending row survives"
    );
}
/// The prune must record every deleted row on the retention counter so
/// operators can observe that old queue rows are actually being aged
/// out (round-121 follow-up: retention observability).
#[serial(pg_rls_cutover)]
#[test]
fn prune_records_deleted_rows_on_retention_counter() {
    let conn = kasirmu_core::migrations::fresh_db();
    conn.execute_batch(
        "INSERT INTO offline_queue (id, action, payload, status, retry_count, last_error, created_at, synced_at, tenant_id, priority) VALUES
         ('old-1', 'act', '{}', 'pending', 0, NULL, '2025-01-01T00:00:00Z', NULL, 't1', 1),
         ('old-2', 'act', '{}', 'synced', 0, NULL, '2025-01-02T00:00:00Z', '2025-01-03T00:00:00Z', 't1', 1),
         ('fresh', 'act', '{}', 'pending', 0, NULL, '2026-08-09T00:00:00Z', NULL, 't1', 1)"
    )
    .unwrap();

    // Delta around the cycle: other prune tests (serialized via
    // #[serial(pg_rls_cutover)]) may have incremented the shared counter earlier.
    let before = crate::metrics::PRUNE_QUEUE_DELETED_TOTAL.get();
    let db = Arc::new(Mutex::new(conn));
    tokio::runtime::Runtime::new()
        .unwrap()
        .block_on(run_prune_cycle(&db));
    let after = crate::metrics::PRUNE_QUEUE_DELETED_TOTAL.get();

    assert_eq!(
        (after - before) as u64,
        2,
        "the prune must record the two deleted rows on the retention counter"
    );
}

/// Integration test: the Postgres prune cycle applies P-1 offline-queue
/// retention — old rows (any status) are deleted, recent rows survive.
/// Skips when no reachable Postgres is configured, so the suite stays
/// green on machines without one.
#[tokio::test]
async fn pg_integration_prune_ages_out_old_rows() {
    let url = std::env::var("OZ_TEST_PG_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:15432/postgres".into());

    let pool = match crate::db::DbPool::connect_postgres(&url, false, 20, true).await {
        Ok(crate::db::DbPool::Postgres(pool)) => pool,
        Ok(_) => unreachable!("connect_postgres with a postgres:// URL returns Postgres"),
        Err(e) => {
            eprintln!("PG prune integration test skipped: {e}");
            return;
        }
    };

    let tenant = format!("pg-prune-test-{}", uuid::Uuid::now_v7());
    let recent = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    {
        let client = pool.get().await.unwrap();
        client
            .execute(
                "INSERT INTO offline_queue (id, action, payload, status, retry_count, last_error, created_at, synced_at, tenant_id, priority)
                 VALUES
                 ($1, 'act', '{}', 'pending', 0, NULL, '2025-01-01T00:00:00Z', NULL, $4, 1),
                 ($2, 'act', '{}', 'synced', 0, NULL, '2025-01-02T00:00:00Z', '2025-01-03T00:00:00Z', $4, 1),
                 ($3, 'act', '{}', 'pending', 0, NULL, $5, NULL, $4, 1)",
                &[
                    &format!("old-pending-{tenant}"),
                    &format!("old-synced-{tenant}"),
                    &format!("recent-{tenant}"),
                    &tenant,
                    &recent,
                ],
            )
            .await
            .unwrap();
    }

    super::run_prune_cycle_pg(&pool).await;

    {
        let client = pool.get().await.unwrap();
        let rows = client
            .query(
                "SELECT id FROM offline_queue WHERE tenant_id = $1 ORDER BY id",
                &[&tenant],
            )
            .await
            .unwrap();
        let ids: Vec<String> = rows.iter().map(|r| r.get(0)).collect();
        assert_eq!(
            ids,
            vec![format!("recent-{tenant}")],
            "old pending and old synced rows must be pruned; the recent row survives"
        );

        client
            .execute("DELETE FROM offline_queue WHERE tenant_id = $1", &[&tenant])
            .await
            .unwrap();
    }
}

/// The `sent_reports` dedup table must not grow forever: claims older
/// than the 90-day horizon are aged out by the same prune cycle that
/// handles `offline_queue`. Seed an old claim plus fresh claims for two
/// tenants and assert only the old one is swept (fresh claims survive
/// regardless of tenant — the sweep must not over-delete).
#[tokio::test]
async fn pg_integration_prune_ages_out_old_sent_reports() {
    let url = std::env::var("OZ_TEST_PG_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:15432/postgres".into());

    let pool = match crate::db::DbPool::connect_postgres(&url, false, 20, true).await {
        Ok(crate::db::DbPool::Postgres(pool)) => pool,
        Ok(_) => unreachable!("connect_postgres with a postgres:// URL returns Postgres"),
        Err(e) => {
            eprintln!("PG prune sent_reports integration test skipped: {e}");
            return;
        }
    };

    let ns = format!("pg-prune-sr-{}", uuid::Uuid::now_v7());
    let tenant_a = format!("{ns}-a");
    let tenant_b = format!("{ns}-b");
    let old = "2025-01-01T00:00:00Z"; // > 90 days before now
    let recent = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    {
        let client = pool.get().await.unwrap();
        client
            .execute(
                "INSERT INTO sent_reports (tenant_id, period, report_id, sent_at) VALUES
                 ($1, '2025-01-01', 'r-old', $3),
                 ($2, '2026-08-01', 'r-fresh-a', $4),
                 ($2, '2026-08-02', 'r-fresh-b', $4)",
                &[&tenant_a, &tenant_b, &old, &recent],
            )
            .await
            .unwrap();
    }

    super::run_prune_cycle_pg(&pool).await;

    {
        let client = pool.get().await.unwrap();
        let rows = client
            .query(
                "SELECT tenant_id, period FROM sent_reports WHERE tenant_id IN ($1, $2) ORDER BY tenant_id, period",
                &[&tenant_a, &tenant_b],
            )
            .await
            .unwrap();
        let remaining: Vec<(String, String)> = rows.iter().map(|r| (r.get(0), r.get(1))).collect();
        assert_eq!(
            remaining,
            vec![
                (tenant_b.clone(), "2026-08-01".to_string()),
                (tenant_b.clone(), "2026-08-02".to_string()),
            ],
            "only the old claim is swept; fresh claims for both tenants survive"
        );

        client
            .execute(
                "DELETE FROM sent_reports WHERE tenant_id LIKE $1",
                &[&format!("{ns}-%")],
            )
            .await
            .unwrap();
    }
}

/// RED (TDD): the prune cycle must keep working after RLS cutover.
///
/// Post-cutover the app connects as `oz_app` with FORCE RLS, so a bare
/// `SELECT ... FROM offline_queue` sees zero rows (no GUC) and the prune
/// loop silently stops aging out old data — the cloud DB grows unbounded.
/// The cycle must scope itself to the BYPASSRLS `oz_email_discovery` role
/// (which the cutover grants) so retention still runs.
#[tokio::test]
#[serial(pg_rls_cutover)]
async fn pg_integration_prune_survives_rls_cutover() {
    let url = std::env::var("OZ_TEST_PG_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:15432/postgres".into());
    let Some((db_url, db_name, admin_pool)) = throwaway_pg_db(&url, "oz_prune").await else {
        return;
    };
    let pool = match crate::db::DbPool::connect_postgres(&db_url, false, 20, true).await {
        Ok(crate::db::DbPool::Postgres(pool)) => pool,
        Ok(_) => unreachable!("connect_postgres with a postgres:// URL returns Postgres"),
        Err(e) => {
            eprintln!("PG prune RLS integration test skipped: {e}");
            return;
        }
    };
    let mut owner = pool.get().await.expect("owner client");

    // Restricted role + FORCE RLS on the two tables the prune touches.
    let role = "oz_prune_probe";
    owner
        .batch_execute(&format!(
            "DO $$ BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{role}') THEN
                    EXECUTE 'DROP OWNED BY {role}';
                    EXECUTE 'DROP ROLE {role}';
                END IF;
             END $$;
             CREATE ROLE {role} LOGIN PASSWORD 'oz_prune_pw';
             GRANT USAGE ON SCHEMA public TO {role};
             GRANT SELECT, DELETE ON offline_queue, sent_reports TO {role};
             -- The BYPASSRLS role (mirrors rls-cutover.sql 2d): the prune
             -- must SET LOCAL ROLE into it for the cross-tenant sweep.
             DO $$ BEGIN
                 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oz_email_discovery') THEN
                     CREATE ROLE oz_email_discovery NOLOGIN BYPASSRLS;
                 END IF;
             END $$;
             GRANT USAGE ON SCHEMA public TO oz_email_discovery;
             GRANT SELECT, DELETE ON offline_queue, sent_reports TO oz_email_discovery;
             GRANT oz_email_discovery TO {role};
             ALTER TABLE offline_queue ENABLE ROW LEVEL SECURITY;
             ALTER TABLE sent_reports ENABLE ROW LEVEL SECURITY;
             ALTER TABLE offline_queue FORCE ROW LEVEL SECURITY;
             ALTER TABLE sent_reports FORCE ROW LEVEL SECURITY;
             DROP POLICY IF EXISTS tenant_isolation ON offline_queue;
             CREATE POLICY tenant_isolation ON offline_queue
                 USING (tenant_id = current_setting('oz.tenant_id', true));
             DROP POLICY IF EXISTS tenant_isolation ON sent_reports;
             CREATE POLICY tenant_isolation ON sent_reports
                 USING (tenant_id = current_setting('oz.tenant_id', true));"
        ))
        .await
        .expect("prune probe role setup should succeed");

    // Seed an old row as owner (GUC-scoped, since FORCE applies to owner).
    let tenant = format!("pg-prune-rls-{}", uuid::Uuid::now_v7());
    let seed_tx = owner.transaction().await.unwrap();
    seed_tx
        .execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant])
        .await
        .unwrap();
    seed_tx
        .execute(
            "INSERT INTO offline_queue (id, action, payload, status, retry_count, last_error, created_at, synced_at, tenant_id, priority)
             VALUES ($1, 'act', '{}', 'pending', 0, NULL, '2025-01-01T00:00:00Z', NULL, $2, 1)",
            &[&format!("old-{tenant}"), &tenant],
        )
        .await
        .unwrap();
    seed_tx.commit().await.unwrap();
    drop(owner);

    // The app pool: connects AS the restricted role, to the throwaway DB.
    let scheme_end = db_url.find("://").expect("URL has a scheme") + 3;
    let at = db_url.find('@').expect("URL has credentials");
    let app_url = format!(
        "{}oz_prune_probe:oz_prune_pw@{}",
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

    // The REAL prune cycle, as the restricted role. Post-cutover it must
    // still delete the old row (the code must SET LOCAL ROLE
    // oz_email_discovery for the cross-tenant retention sweep).
    super::run_prune_cycle_pg(&app_pool).await;

    // Assert the old row is gone — from the OWNER's perspective (the probe
    // role cannot see the row under RLS regardless, so a probe-side query
    // would be a false positive).
    let owner = pool.get().await.unwrap();
    let remaining: i64 = owner
        .query_one(
            "SELECT COUNT(*) FROM offline_queue WHERE id = $1",
            &[&format!("old-{tenant}")],
        )
        .await
        .unwrap()
        .get(0);
    assert_eq!(
        remaining, 0,
        "prune must delete the old row as the restricted role post-cutover"
    );

    // Cleanup: drop handles, then throwaway DB, then roles.
    drop(app_pool);
    drop(owner);
    let admin = admin_pool.get().await.unwrap();
    admin
        .batch_execute(&format!("DROP DATABASE IF EXISTS {db_name} WITH (FORCE);"))
        .await
        .unwrap();
    admin
        .batch_execute(&format!("DROP ROLE IF EXISTS {role};"))
        .await
        .unwrap();
    // `oz_email_discovery` deliberately left in place — it is a cluster-wide
    // role that production code (`SET LOCAL ROLE oz_email_discovery`) and
    // other parallel test processes depend on; dropping it here would race
    // them (nextest runs each test in its own process, so #[serial(pg_rls_cutover)] never
    // serialized). It is created IF NOT EXISTS and owns nothing, so leaving
    // it across runs is safe.
}
