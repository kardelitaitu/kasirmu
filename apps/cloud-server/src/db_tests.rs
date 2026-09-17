use super::*;
use serial_test::serial;

#[test]
fn sqlite_in_memory_creates_db() {
    let pool = DbPool::connect_sqlite_in_memory().unwrap();
    assert!(pool.is_sqlite());
    assert!(!pool.is_postgres());
}

#[test]
fn sqlite_conn_returns_connection() {
    let pool = DbPool::connect_sqlite_in_memory().unwrap();
    let conn = pool.sqlite_conn();
    let guard = conn.blocking_lock();
    let result: i64 = guard.query_row("SELECT 1", [], |row| row.get(0)).unwrap();
    assert_eq!(result, 1);
}

#[test]
fn sqlite_migrations_run() {
    let pool = DbPool::connect_sqlite_in_memory().unwrap();
    let conn = pool.sqlite_conn();
    let guard = conn.blocking_lock();
    // Verify a core table exists after migrations
    let count: i64 = guard
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='settings'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 1, "settings table should exist after migrations");
}

#[test]
fn windows_style_paths_are_detected() {
    // Windows drive-letter prefixes (forward or backslash).
    assert!(DbPool::looks_like_windows_path(
        "C:/Users/User/AppData/Local/Temp/test.db"
    ));
    assert!(DbPool::looks_like_windows_path("C:\\Users\\User\\test.db"));
    assert!(DbPool::looks_like_windows_path("c:/data/db.sqlite"));
    // Bare drive letters and backslash separators.
    assert!(DbPool::looks_like_windows_path("C:relative.db"));
    assert!(DbPool::looks_like_windows_path("/data/oz\\pos.db"));
    // Legitimate Linux/container paths must NOT be flagged.
    assert!(!DbPool::looks_like_windows_path("/data/kasir.db"));
    assert!(!DbPool::looks_like_windows_path("kasir.db"));
    assert!(!DbPool::looks_like_windows_path(":memory:"));
}

#[cfg(unix)]
#[test]
fn connect_sqlite_rejects_windows_path_on_unix() {
    let err = DbPool::connect_sqlite("C:/Users/User/AppData/Local/Temp/test.db")
        .expect_err("Windows-style path must be rejected on Unix");
    let msg = err.to_string();
    assert!(
        msg.contains("MSYS_NO_PATHCONV"),
        "message should hint the fix: {msg}"
    );
    assert!(
        msg.contains("Windows path"),
        "message should name the path kind: {msg}"
    );
}

#[test]
fn sqlite_from_path_creates_db() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("test.db");
    let path_str = path.to_str().unwrap();
    let pool = DbPool::connect_sqlite(path_str).unwrap();
    assert!(pool.is_sqlite());
    assert!(path.exists(), "database file should exist");
}

#[tokio::test]
async fn postgres_url_parsing_rejects_bad_url() {
    let result = DbPool::connect_postgres("not-a-url", false, 20, true).await;
    // This should fail because Config::from_str will reject invalid URLs
    assert!(result.is_err());
}

#[tokio::test]
async fn postgres_url_parsing_accepts_valid_url() {
    // This won't connect, but the URL parsing should succeed.
    // max_attempts=1 skips the 30+ seconds of production retry backoff
    // on a dead port — the test only asserts parsing + connection failure.
    let result = DbPool::connect_postgres_with_retries(
        "postgresql://localhost:5432/test",
        false,
        20,
        true,
        1,
    )
    .await;
    // Will fail at connection, not parsing
    let err = result.unwrap_err();
    let msg = err.to_string();
    assert!(
        msg.contains("Connection") || msg.contains("connection"),
        "expected connection error, got: {msg}"
    );
}

#[tokio::test]
async fn require_tls_rejects_url_without_sslmode_require() {
    // No sslmode → defaults to `prefer`, which could fall back to
    // plaintext, so the TLS requirement must fail before connecting.
    let err = DbPool::connect_postgres("postgresql://localhost:5432/test", true, 20, true)
        .await
        .unwrap_err();
    assert!(
        err.to_string().contains("sslmode=require"),
        "expected an sslmode=require error, got: {err}"
    );
}

#[tokio::test]
async fn require_tls_accepts_sslmode_require_and_fails_on_connection() {
    // sslmode=require passes the check; it then fails because no server
    // is listening — a Connection error, not a config error. max_attempts=1
    // skips the 30+ seconds of production retry backoff on a dead port.
    let err = DbPool::connect_postgres_with_retries(
        "postgresql://localhost:5432/test?sslmode=require",
        true,
        20,
        true,
        1,
    )
    .await
    .unwrap_err();
    let msg = err.to_string();
    assert!(
        msg.contains("Connection") || msg.contains("connection"),
        "expected connection error, got: {msg}"
    );
}

/// Serializes env-var-dependent tests since `std::env::set_var` is
/// process-global and tokio runs tests in parallel.
static ENV_LOCK: std::sync::LazyLock<tokio::sync::Mutex<()>> =
    std::sync::LazyLock::new(|| tokio::sync::Mutex::new(()));

#[serial(pg_rls_cutover)]
#[serial]
#[tokio::test]
async fn from_env_defaults_to_sqlite() {
    let _guard = ENV_LOCK.lock().await;
    // SAFETY: env var mutations are serialized via ENV_LOCK (held by _guard)
    // to prevent data races on the process-global environment. The Mutex guard
    // ensures exclusive access; the environment is restored in reverse order.
    unsafe { std::env::set_var("DATABASE_URL", "") };
    unsafe { std::env::set_var("OZ_DB_PATH", ":memory:") };
    let pool = DbPool::from_env().await.unwrap();
    assert!(pool.is_sqlite());
    // SAFETY: Same ENV_LOCK serialization as above. These restore env vars
    // to their prior state (empty/unset) before the guard is released.
    unsafe { std::env::remove_var("DATABASE_URL") };
    unsafe { std::env::remove_var("OZ_DB_PATH") };
}

#[serial(pg_rls_cutover)]
#[serial]
#[tokio::test]
async fn from_env_detects_postgres_url() {
    let _guard = ENV_LOCK.lock().await;
    // SAFETY: ENV_LOCK (held by _guard) serializes access to the process-global
    // environment. The set_var is paired with a remove_var before the guard drops.
    unsafe { std::env::set_var("DATABASE_URL", "postgresql://localhost:5432/test") };
    // max_attempts=1 skips the 30+ seconds of production retry backoff on a
    // dead port — the test only asserts the URL is routed to PostgreSQL.
    let pool = DbPool::from_env_with_retries(1).await;
    // SAFETY: Restores the environment — see SAFETY note on set_var above.
    unsafe { std::env::remove_var("DATABASE_URL") };
    // Should attempt connection but fail
    assert!(pool.is_err());
    let msg = pool.unwrap_err().to_string();
    assert!(
        msg.contains("Connection") || msg.contains("connection"),
        "expected connection error, got: {msg}"
    );
}

#[test]
fn db_error_sqlite_display() {
    let err = DbError::Sqlite(rusqlite::Error::InvalidColumnName("x".into()));
    let msg = err.to_string();
    assert!(msg.contains("SQLite error"));
}

#[test]
fn db_error_config_display() {
    let err = DbError::Config("missing host".into());
    assert_eq!(err.to_string(), "Configuration error: missing host");
}

#[test]
fn db_error_connection_display() {
    let err = DbError::Connection("refused".into());
    assert_eq!(err.to_string(), "Connection error: refused");
}

#[test]
fn db_error_pool_display() {
    let err = DbError::Pool("no connections available".into());
    assert_eq!(
        err.to_string(),
        "Pool creation error: no connections available"
    );
}

#[test]
fn db_error_migration_display() {
    let err = DbError::Migration("syntax error".into());
    assert_eq!(err.to_string(), "Migration error: syntax error");
}

#[test]
fn db_error_debug() {
    let err = DbError::Config("test".into());
    assert!(!format!("{err:?}").is_empty());
}

#[test]
fn db_error_from_core_error() {
    let core_err = kasirmu_core::CoreError::NotFound {
        entity: "table",
        id: "x".into(),
    };
    let db_err: DbError = core_err.into();
    assert!(db_err.to_string().contains("not found"));
}

/// Integration test: connect to a real PostgreSQL instance.
///
/// Uses `OZ_TEST_PG_URL` (set by CI's Postgres service), falling back
/// to the local dev container on port 15432. Skipped when Postgres is
/// not reachable.
#[tokio::test]
async fn pg_integration_connect_and_create_tables() {
    let url = std::env::var("OZ_TEST_PG_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:15432/postgres".into());
    let pool = match DbPool::connect_postgres(&url, false, 20, true).await {
        Ok(p) => p,
        Err(e) => {
            eprintln!("PG integration test skipped: {e}");
            return;
        }
    };
    assert!(pool.is_postgres());

    // Verify we can get a client and query
    let client = pool.pg_client().await.expect("pg_client should succeed");
    let row = client
        .query_one("SELECT COUNT(*) FROM processed_webhooks", &[])
        .await
        .expect("query should succeed");
    let count: i64 = row.get(0);
    assert!(
        count >= 0,
        "processed_webhooks table should exist and be queryable"
    );

    // Verify offline_queue table exists too
    let row = client
        .query_one("SELECT COUNT(*) FROM offline_queue", &[])
        .await
        .expect("offline_queue query should succeed");
    let count: i64 = row.get(0);
    assert!(count >= 0, "offline_queue table should exist");

    // The full Postgres migration (not the old 2-table stub) must have
    // applied: 92 base tables and the 4 rewritten triggers. `>=` tolerates
    // a shared dev database with extra objects.
    let table_count: i64 = client
        .query_one(
            "SELECT COUNT(*) FROM information_schema.tables
             WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
            &[],
        )
        .await
        .expect("information_schema query should succeed")
        .get(0);
    assert!(
        table_count >= 92,
        "expected the full 92-table schema, found {table_count} tables"
    );
    let trigger_count: i64 = client
        .query_one(
            "SELECT COUNT(*) FROM pg_trigger WHERE NOT tgisinternal",
            &[],
        )
        .await
        .expect("pg_trigger query should succeed")
        .get(0);
    assert!(
        trigger_count >= 4,
        "expected the 4 rewritten triggers, found {trigger_count}"
    );
}

/// Integration test: a fully-exhausted pool must FAIL FAST instead of
/// hanging request threads forever.
///
/// The pool is built with `max_size(1)` + the 5s `wait_timeout` from
/// `connect_postgres`. Holding the only connection and then asking for a
/// second one must return `PoolError::Timeout` in ~5s (not block
/// indefinitely). This is the SOTA guarantee behind Finding D: a stalled
/// DB can no longer wedge every request.
#[tokio::test]
async fn pg_integration_pool_get_fails_fast_when_exhausted() {
    let url = std::env::var("OZ_TEST_PG_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:15432/postgres".into());
    let pool = match DbPool::connect_postgres(&url, false, 1, false).await {
        Ok(DbPool::Postgres(pool)) => pool,
        Ok(_) => unreachable!("postgres:// URL returns Postgres"),
        Err(e) => {
            eprintln!("PG pool-timeout integration test skipped: {e}");
            return;
        }
    };

    // Exhaust the pool: take the single connection and keep it.
    let held = pool.get().await.expect("first get should succeed");

    // A second get must time out (deadpool `wait_timeout` = 5s) rather
    // than wait forever. Wrap in an outer 15s guard so a regression that
    // removes the timeout fails the test instead of hanging the suite.
    let start = std::time::Instant::now();
    let result = tokio::time::timeout(std::time::Duration::from_secs(15), pool.get()).await;

    let elapsed = start.elapsed();
    let err = match result {
        Err(_) => panic!("pool.get() blocked beyond the 15s guard — wait_timeout lost"),
        Ok(Err(e)) => e,
        Ok(Ok(_)) => panic!("second get succeeded despite max_size(1) — pool not exhausted"),
    };
    let msg = err.to_string();
    assert!(
        msg.contains("Timeout") || msg.contains("waiting for a slot"),
        "expected a wait timeout, got: {msg}"
    );
    assert!(
        elapsed < std::time::Duration::from_secs(12),
        "wait timeout took too long: {elapsed:?}"
    );

    // Dropping the held connection must free the slot immediately.
    drop(held);
    let _ = pool.get().await.expect("get after drop should succeed");
}

/// Integration test: `OZ_APPLY_SCHEMA=0` skips the `PG_INIT` re-apply.
///
/// `connect_postgres` applies the full schema at startup by default —
/// fine while the app connects as the table owner, but a hard failure
/// once the RLS cutover (`scripts/rls-cutover.sql`) points the app at the
/// restricted `oz_app` role, which only has DML grants (the DDL re-apply
/// hits `permission denied for schema public`). This test proves the
/// escape hatch on a throwaway database:
///
/// * `apply_schema = false` connects cleanly and leaves the database
///   EMPTY (no `PG_INIT` ran);
/// * `apply_schema = true` on the same database applies the full
///   93-table schema — the flag is the only difference;
/// * the throwaway database is dropped afterwards.
///
/// Skips when Postgres is unreachable or the URL role lacks `CREATE
/// DATABASE` (matching the established skip-if-unreachable pattern).
#[tokio::test]
async fn pg_integration_apply_schema_can_be_skipped() {
    let url = std::env::var("OZ_TEST_PG_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:15432/postgres".into());
    // Admin connection is raw (apply_schema = false): it only drops /
    // creates the throwaway database, so it must not re-apply PG_INIT to
    // the shared base DB (concurrent catalog DDL across parallel PG test
    // binaries is a flake source).
    let pool = match DbPool::connect_postgres(&url, false, 20, false).await {
        Ok(p) => p,
        Err(e) => {
            eprintln!("PG integration test skipped: {e}");
            return;
        }
    };
    let admin = pool.pg_client().await.expect("pg_client should succeed");

    let db_name = format!("oz_apply_schema_{}", std::process::id());
    // CREATE DATABASE cannot run inside a transaction; execute() uses
    // autocommit. The name is process-unique; drop any stale leftover
    // from a crashed previous run first.
    admin
        .batch_execute(&format!("DROP DATABASE IF EXISTS {db_name} WITH (FORCE);"))
        .await
        .expect("drop stale database should succeed");
    if let Err(e) = admin
        .execute(&format!("CREATE DATABASE {db_name}"), &[])
        .await
    {
        eprintln!("PG integration test skipped: cannot CREATE DATABASE ({e})");
        return;
    }

    // Build the URL for the new database by swapping the path segment,
    // preserving any query string (e.g. `?sslmode=require`).
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

    // 1. apply_schema = false: connects, but no PG_INIT ran.
    let pool_no_schema = DbPool::connect_postgres(&db_url, false, 20, false)
        .await
        .expect("connecting with apply_schema=false must succeed");
    let client = pool_no_schema
        .pg_client()
        .await
        .expect("pg_client should succeed");
    let tables: i64 = client
        .query_one(
            "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'",
            &[],
        )
        .await
        .expect("count should succeed")
        .get(0);
    assert_eq!(
        tables, 0,
        "apply_schema=false must skip PG_INIT entirely (found {tables} tables)"
    );
    drop(pool_no_schema);

    // 2. apply_schema = true on the same database: full schema appears.
    let pool_with_schema = DbPool::connect_postgres(&db_url, false, 20, true)
        .await
        .expect("connecting with apply_schema=true must succeed");
    let client = pool_with_schema
        .pg_client()
        .await
        .expect("pg_client should succeed");
    let tables: i64 = client
        .query_one(
            "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'",
            &[],
        )
        .await
        .expect("count should succeed")
        .get(0);
    assert!(
        tables >= 93,
        "apply_schema=true must apply the full schema (found {tables} tables)"
    );
    drop(pool_with_schema);

    // 3. Cleanup the throwaway database (terminate lingering connections).
    admin
        .batch_execute(&format!("DROP DATABASE IF EXISTS {db_name} WITH (FORCE);"))
        .await
        .expect("drop throwaway database should succeed");
}

/// Integration test: Row-Level Security fails closed for non-owner roles.
///
/// The schema enables RLS on every tenant-scoped table (see
/// `scripts/generate-pg-migration.py`) with a `tenant_isolation` policy
/// keyed on the `oz.tenant_id` session GUC. The table owner — today's app
/// role — bypasses RLS, so this test proves the guarantee for a real
/// non-owner role:
///
/// * without `oz.tenant_id` set, reads see nothing and writes are
///   rejected (a missed `WHERE tenant_id = ?` fails closed);
/// * with it set, only that tenant's rows are visible and writable, and
///   writing a row for another tenant is rejected by the WITH CHECK.
///
/// Privileges are granted in full so RLS alone is the barrier. The probe
/// runs on a dedicated connection (`SET ROLE` never touches the shared
/// pool), rows are namespaced per process for shared dev databases, and
/// the test skips when Postgres is unreachable.
#[tokio::test]
#[serial(pg_rls_cutover)]
async fn pg_integration_rls_fails_closed() {
    let url = std::env::var("OZ_TEST_PG_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:15432/postgres".into());
    // Throwaway DB: this test queries `products` while the cutover test
    // (`pg_integration_rls_force_blocks_owner`) runs FORCE RLS on the
    // shared base tables inside an open transaction — a concurrent query
    // there surfaces as a spurious RLS denial. The throwaway DB isolates
    // this test from that window entirely.
    // Admin connection is raw (apply_schema = false): it only creates /
    // drops the throwaway database.
    let admin_pool = match DbPool::connect_postgres(&url, false, 20, false).await {
        Ok(p) => p,
        Err(e) => {
            eprintln!("PG integration test skipped: {e}");
            return;
        }
    };
    let admin = admin_pool
        .pg_client()
        .await
        .expect("pg_client should succeed");
    let db_name = format!("oz_rls_closed_{}", std::process::id());
    admin
        .batch_execute(&format!("DROP DATABASE IF EXISTS {db_name} WITH (FORCE);"))
        .await
        .expect("drop stale database should succeed");
    if let Err(e) = admin
        .execute(&format!("CREATE DATABASE {db_name}"), &[])
        .await
    {
        eprintln!("PG integration test skipped: cannot CREATE DATABASE ({e})");
        return;
    }
    drop(admin);
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
    let pool = match DbPool::connect_postgres(&db_url, false, 20, true).await {
        Ok(p) => p,
        Err(e) => {
            eprintln!("PG integration test skipped: {e}");
            return;
        }
    };
    let client = pool.pg_client().await.expect("pg_client should succeed");

    // Namespace every row/role for this run so a shared dev database
    // (or a crashed previous run) can't interfere.
    let ns = format!("rls-{}", std::process::id());
    let alpha = format!("{ns}-alpha");
    let beta = format!("{ns}-beta");
    let sku = format!("{ns}-sku");
    // Per-process role name: under nextest each test runs in its own
    // process, and a FIXED name would race a concurrent test session
    // (another agent's run) doing DROP OWNED BY on the same role →
    // "tuple concurrently updated". A pid-suffixed role can never collide.
    let probe_role = format!("oz_rls_probe_{}", std::process::id());

    // Set up the non-owner role (idempotent) and clear prior rows. A
    // previous run's role persists WITH its grants (this test
    // intentionally leaves them for the probe connection), so DROP OWNED
    // BY must run first — DROP ROLE IF EXISTS alone fails on the
    // dependent privileges.
    client
        .batch_execute(&format!(
            "DO $$ BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{probe_role}') THEN
                    EXECUTE 'DROP OWNED BY {probe_role}';
                    EXECUTE 'DROP ROLE {probe_role}';
                END IF;
             END $$;
             CREATE ROLE {probe_role};
             GRANT USAGE ON SCHEMA public TO {probe_role};
             GRANT SELECT, INSERT, UPDATE, DELETE ON products TO {probe_role};
             DELETE FROM products WHERE tenant_id LIKE '{ns}%';"
        ))
        .await
        .expect("probe role setup should succeed");

    // Seed two tenants that share one SKU (the natural-key collision RLS
    // must keep apart), with different prices to tell them apart.
    client
        .execute(
            "INSERT INTO products (id, sku, name, price_minor, currency, tenant_id)
             VALUES ($1, $2, 'Alpha', 1000, 'USD', $3)",
            &[&format!("{ns}-p-a"), &sku, &alpha],
        )
        .await
        .expect("seed alpha product should succeed");
    client
        .execute(
            "INSERT INTO products (id, sku, name, price_minor, currency, tenant_id)
             VALUES ($1, $2, 'Beta', 9000, 'USD', $3)",
            &[&format!("{ns}-p-b"), &sku, &beta],
        )
        .await
        .expect("seed beta product should succeed");

    // A dedicated connection for the probe role — SET ROLE must never
    // leak onto a pooled connection another test might reuse. Connects to
    // the THROWAWAY database (the probe role's grants live there).
    let (probe, conn) = tokio_postgres::connect(&db_url, tokio_postgres::NoTls)
        .await
        .expect("dedicated probe connection should succeed");
    tokio::spawn(async move {
        let _ = conn.await;
    });
    probe
        .execute(&format!("SET ROLE {probe_role}"), &[])
        .await
        .expect("SET ROLE should succeed");

    // 1. Without the GUC: RLS fails closed — nothing visible, writes
    //    rejected. Privileges are granted, so RLS alone is the barrier.
    let visible: i64 = probe
        .query_one("SELECT COUNT(*) FROM products", &[])
        .await
        .expect("count should succeed")
        .get(0);
    assert_eq!(
        visible, 0,
        "RLS must hide every row when oz.tenant_id is unset"
    );

    let insert_err = probe
        .execute(
            "INSERT INTO products (id, sku, name, price_minor, currency, tenant_id)
             VALUES ($1, $2, 'Intruder', 500, 'USD', $3)",
            &[&format!("{ns}-p-x"), &sku, &alpha],
        )
        .await
        .expect_err("RLS must reject the write when oz.tenant_id is unset");
    // tokio_postgres renders every DB error as the terse "db error"; the
    // real message lives in the DbError payload (SQLSTATE 42501,
    // insufficient_privilege). Check it directly so a genuine RLS
    // rejection is recognized even when the Display text is opaque.
    let is_rls = insert_err
        .as_db_error()
        .is_some_and(|db| db.message().contains("row-level security"));
    assert!(is_rls, "expected an RLS violation, got: {insert_err}");

    // 2. With the GUC set: only that tenant's row is visible, and the
    //    shared SKU resolves to the right tenant's price.
    probe
        .execute("SELECT set_config('oz.tenant_id', $1, false)", &[&alpha])
        .await
        .expect("set_config should succeed");
    let visible: i64 = probe
        .query_one("SELECT COUNT(*) FROM products", &[])
        .await
        .expect("count should succeed")
        .get(0);
    assert_eq!(visible, 1, "only the alpha row must be visible");
    let price: i64 = probe
        .query_one("SELECT price_minor FROM products WHERE sku = $1", &[&sku])
        .await
        .expect("sku lookup should succeed")
        .get(0);
    assert_eq!(price, 1000, "the visible row must be alpha's (shared SKU)");

    // 3. Writing a row for the *other* tenant is rejected by WITH CHECK.
    let wrong_tenant = probe
        .execute(
            "INSERT INTO products (id, sku, name, price_minor, currency, tenant_id)
             VALUES ($1, $2, 'Intruder', 500, 'USD', $3)",
            &[&format!("{ns}-p-y"), &sku, &beta],
        )
        .await
        .expect_err("RLS must reject writing another tenant's row");
    // Same opaque-Display caveat as the first rejection above.
    let is_rls = wrong_tenant
        .as_db_error()
        .is_some_and(|db| db.message().contains("row-level security"));
    assert!(is_rls, "expected an RLS violation, got: {wrong_tenant}");

    // 4. An UPDATE on the visible row succeeds (normal app workflow).
    probe
        .execute(
            "UPDATE products SET name = 'Alpha2' WHERE id = $1",
            &[&format!("{ns}-p-a")],
        )
        .await
        .expect("update of the visible row should succeed");

    // Cleanup: drop the throwaway database.
    drop(probe);
    drop(pool);
    admin_pool
        .pg_client()
        .await
        .expect("cleanup admin client")
        .batch_execute(&format!("DROP DATABASE IF EXISTS {db_name} WITH (FORCE);"))
        .await
        .expect("drop throwaway database should succeed");
}

/// Integration test: the deployment cutover script
/// (`scripts/rls-cutover.sql`) ends the owner bypass with
/// `FORCE ROW LEVEL SECURITY`.
///
/// The test above proves NON-owner roles are isolated, but today's app
/// role is the table owner, which bypasses RLS entirely — the policies
/// ship inert. The cutover script closes that gap: it creates the
/// restricted `oz_app` role, grants DML on the tenant tables, and sets
/// `FORCE ROW LEVEL SECURITY` so the owner is isolated too.
///
/// Two proofs, both on a dedicated connection (never the shared pool):
///
/// 1. **The shipped script executes.** Run verbatim (via `include_str!`)
///    inside a transaction, twice (idempotency), and assert all 19
///    tenant-scoped tables are FORCEd; the rollback leaves the shared
///    schema untouched.
/// 2. **FORCE blocks the table owner.** A dedicated NON-superuser role
///    owns a dedicated table (superusers bypass RLS even with FORCE, so
///    the proof must use a real non-superuser owner): with the GUC unset
///    the owner sees zero rows and writes are rejected; with the GUC set
///    (the sync data layer's per-request `SET LOCAL`) the owner's rows
///    are visible again. This is exactly the mechanism the cutover
///    relies on for a non-superuser deployment role.
#[tokio::test]
#[serial(pg_rls_cutover)]
async fn pg_integration_rls_force_blocks_owner() {
    let url = std::env::var("OZ_TEST_PG_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:15432/postgres".into());
    // Run in a throwaway database, not in the shared base one.
    //
    // This test passes `apply_schema = true` (4th arg, `db.rs:169`-`:174`), so it
    // applies the full 123-table PG_INIT on connect, and it then runs the real
    // production cutover script twice over that schema -- cluster-wide
    // `ALTER TABLE … FORCE ROW LEVEL SECURITY` DDL. Two processes doing that in
    // one database deadlock, which was not theoretical: this test failed with
    // `E40P01 deadlock detected … AccessExclusiveLock … of database 5` (5 =
    // `postgres`, per `SELECT oid, datname FROM pg_database`), rescued silently
    // by CI's `retries = 2`.
    //
    // The `#[serial(pg_rls_cutover)]` above does not cover this. It is an
    // in-process lock and CI runs nextest, which forks a process per test -- as a
    // peer already recorded at `prune_tests.rs:443`-`:445`: "nextest runs each
    // test in its own process, so #[serial(pg_rls_cutover)] never serialized".
    // 13 sites carry that guard across 4 files.
    let db_name = format!("oz_rls_force_{}", std::process::id());
    {
        // Admin connection with apply_schema = false, for the same reason
        // `:377`-`:380` gives: it must not re-apply PG_INIT to the shared base DB.
        let admin_pool = match DbPool::connect_postgres(&url, false, 20, false).await {
            Ok(p) => p,
            Err(e) => {
                eprintln!("PG integration test skipped: {e}");
                return;
            }
        };
        let admin = admin_pool
            .pg_client()
            .await
            .expect("pg_client should succeed");
        // Sweep every stale throwaway from an earlier crashed run, not just this
        // process's. This is required, not tidy: the role this test creates is
        // cluster-global while the tables it owns live inside the throwaway, so a
        // leftover `oz_rls_force_<pid>` makes the run-start sweep at `:838` die on
        // `E2BP01 role "oz_rls_owner_<pid>" cannot be dropped because some objects
        // depend on it -- 2 objects in database oz_rls_force_<pid>`, which then
        // fails every subsequent run, not just the crashed one. Measured here: two
        // databases left by an interrupted earlier version of this change turned
        // the next three runs red at a line none of them had touched. Same shape
        // as the stale sweep in `sync_store_tests.rs:25`-`:40`, which this block
        // originally omitted.
        let stale: Vec<String> = admin
            .query(
                "SELECT datname FROM pg_database WHERE datname LIKE 'oz_rls_force_%'",
                &[],
            )
            .await
            .unwrap_or_default()
            .iter()
            .map(|r| r.get::<_, String>(0))
            .collect();
        for d in &stale {
            let _ = admin
                .batch_execute(&format!("DROP DATABASE IF EXISTS {d} WITH (FORCE);"))
                .await;
        }
        admin
            .batch_execute(&format!("DROP DATABASE IF EXISTS {db_name} WITH (FORCE);"))
            .await
            .expect("drop stale database should succeed");
        if let Err(e) = admin
            .execute(&format!("CREATE DATABASE {db_name}"), &[])
            .await
        {
            eprintln!("PG integration test skipped: cannot CREATE DATABASE ({e})");
            return;
        }
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
    let pool = match DbPool::connect_postgres(&db_url, false, 20, false).await {
        Ok(p) => p,
        Err(e) => {
            eprintln!("PG integration test skipped: {e}");
            return;
        }
    };
    let client = pool.pg_client().await.expect("pg_client should succeed");
    // PG_INIT is applied here, explicitly, rather than by passing
    // `apply_schema = true` on the connect above. Measured, not inferred: the
    // first version of this change did pass it, and the test then reported
    // `1 passed` in 80.09s after printing `failed to connect to PostgreSQL after
    // 5 attempts: pool.get() failed: Timeout occurred while creating a new
    // object` -- on this machine, at that moment, the schema path exceeded that
    // helper's own connect budget on a freshly created database, so the error arm
    // fired, the test returned, and 220 lines of assertions silently did not run.
    //
    // Phrased that way deliberately, because the general form is NOT true: two
    // siblings in `email_pg_tests.rs` (`:920`, `:1067`) pass `apply_schema = true`
    // against a throwaway database and run green, and `pg_daily_revenue_...` in that
    // file now does the same. What is established is the 80.09s vacuous PASS, twice,
    // which is enough to prefer an explicit apply here and not enough to call the
    // helper broken. Same shape as
    // `pg_ddl_guard`'s continue-unserialized fallback at
    // `crates/kasirmu-api/src/pg_tests.rs:78`-`:82`: an error path that yields a PASS
    // is worse than one that yields a failure. `expect` here fails loudly.
    client
        .batch_execute(kasirmu_core::migrations::PG_INIT)
        .await
        .expect("PG_INIT should apply to the throwaway database");
    let ns = format!("rls-force-{}", std::process::id());
    let tenant = format!("{ns}-alpha");
    let table = format!("rls_force_probe_{}", std::process::id());
    let owner_role = format!("oz_rls_owner_{}", std::process::id());

    // Clear any probe leftovers from a crashed previous run.
    client
        .batch_execute(
            "DO $$ DECLARE r record; BEGIN
                -- A crashed run leaves FORCE RLS applied to the shared
                -- tenant tables (FORCE is non-transactional). NO FORCE
                -- them so the Proof-1 rollback assertion starts clean.
                FOR r IN
                    SELECT relname FROM pg_class
                    WHERE relkind = 'r' AND relforcerowsecurity
                      AND relname IN ('bundle_items','memo_locations','memo_recipients',
                                      'memos','offline_queue','product_activity',
                                      'product_bundles','product_taxes','product_variants',
                                      'products','refunds','sales','sent_reports','stripe_customers',
                                      'sync_terminals','tax_rates','tenant_plans',
                                      'tenant_subscription','users')
                LOOP
                    EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY', r.relname);
                END LOOP;
                FOR r IN
                    SELECT relname FROM pg_class
                    WHERE relkind = 'r' AND relname LIKE 'rls_force_probe_%'
                LOOP
                    EXECUTE format('DROP TABLE IF EXISTS %I', r.relname);
                END LOOP;
                FOR r IN
                    SELECT rolname FROM pg_roles WHERE rolname LIKE 'oz_rls_owner_%'
                LOOP
                    EXECUTE format('REVOKE ALL ON SCHEMA public FROM %I', r.rolname);
                    EXECUTE format('DROP ROLE IF EXISTS %I', r.rolname);
                END LOOP;
            END $$;",
        )
        .await
        .expect("probe leftovers cleanup should succeed");

    // ── Proof 1: the real cutover script executes and is idempotent. ──
    // Runs inside a transaction that ROLLBACKs below; the assertion after
    // rollback (`forced == 0`) proves FORCE RLS is transactional here.
    const CUTOVER: &str = include_str!("../../../scripts/rls-cutover.sql");
    client
        .batch_execute("BEGIN")
        .await
        .expect("begin should succeed");
    client
        .batch_execute(CUTOVER)
        .await
        .expect("cutover script should execute cleanly");
    client
        .batch_execute(CUTOVER)
        .await
        .expect("cutover script must be idempotent");
    // Count FORCEd tables among the 19 canonical tenant-scoped tables
    // only (a stray probe table must not skew the proof).
    let forced: i64 = client
        .query_one(
            "SELECT count(*) FROM pg_class c
             JOIN unnest(ARRAY['bundle_items','memo_locations','memo_recipients',
                               'memos','offline_queue','product_activity',
                               'product_bundles','product_taxes','product_variants',
                               'products','refunds','sales','sent_reports','stripe_customers',
                               'sync_terminals','tax_rates','tenant_plans',
                               'tenant_subscription','users']) AS t(name)
               ON c.relname = t.name
             WHERE c.relforcerowsecurity",
            &[],
        )
        .await
        .expect("count should succeed")
        .get(0);
    assert_eq!(
        forced, 19,
        "the cutover must FORCE every tenant-scoped table"
    );
    client
        .batch_execute("ROLLBACK")
        .await
        .expect("rollback should succeed");
    let forced: i64 = client
        .query_one(
            "SELECT count(*) FROM pg_class c
             JOIN unnest(ARRAY['bundle_items','memo_locations','memo_recipients',
                               'memos','offline_queue','product_activity',
                               'product_bundles','product_taxes','product_variants',
                               'products','refunds','sales','sent_reports','stripe_customers',
                               'sync_terminals','tax_rates','tenant_plans',
                               'tenant_subscription','users']) AS t(name)
               ON c.relname = t.name
             WHERE c.relforcerowsecurity",
            &[],
        )
        .await
        .expect("count should succeed")
        .get(0);
    assert_eq!(
        forced, 0,
        "the rollback must leave the shared schema untouched"
    );

    // ── Proof 2: FORCE blocks a non-superuser table owner. ──
    // The dev connection is a superuser (superusers bypass RLS even with
    // FORCE), so this proof uses a dedicated non-superuser role that OWNS
    // a dedicated table — the same ownership relationship the cutover
    // assumes between the migration role and the app role.
    client
        .batch_execute(&format!(
            "DROP TABLE IF EXISTS {table};
             DROP ROLE IF EXISTS {owner_role};
             CREATE ROLE {owner_role} NOLOGIN;
             GRANT USAGE ON SCHEMA public TO {owner_role};
             CREATE TABLE {table} (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL);
             ALTER TABLE {table} OWNER TO {owner_role};
             ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;
             ALTER TABLE {table} FORCE ROW LEVEL SECURITY;
             CREATE POLICY tenant_isolation ON {table}
               USING (tenant_id = current_setting('oz.tenant_id', true))
               WITH CHECK (tenant_id = current_setting('oz.tenant_id', true));"
        ))
        .await
        .expect("probe table setup should succeed");

    // Act as the owner on a dedicated connection so SET ROLE never leaks
    // onto a pooled connection another test might reuse.
    //
    // `db_url`, not `url`: the role this session assumes owns a table that now
    // lives in the throwaway database, and roles are cluster-global while
    // relations are not. Pointing this at the base URL made the owner's INSERT
    // fail with `E42P01 relation "rls_force_probe_<pid>" does not exist` -- the
    // table was real, the owner was simply standing in the other database. `url`
    // remains only as the administrative endpoint for CREATE / DROP DATABASE.
    let (owner, conn) = tokio_postgres::connect(&db_url, tokio_postgres::NoTls)
        .await
        .expect("dedicated owner connection should succeed");
    tokio::spawn(async move {
        let _ = conn.await;
    });
    owner
        .execute(&format!("SET ROLE {owner_role}"), &[])
        .await
        .expect("SET ROLE should succeed");
    // Seed the owner's row WITH the GUC set (WITH CHECK requires it).
    owner
        .execute("SELECT set_config('oz.tenant_id', $1, false)", &[&tenant])
        .await
        .expect("set_config should succeed");
    owner
        .execute(
            &format!("INSERT INTO {table} (id, tenant_id) VALUES ($1, $2)"),
            &[&format!("{ns}-row"), &tenant],
        )
        .await
        .expect("owner seed should succeed");
    // Clear the GUC — from here on the owner runs WITHOUT it.
    owner
        .execute("RESET oz.tenant_id", &[])
        .await
        .expect("reset should succeed");

    // Without the GUC, FORCE applies to the OWNER: nothing visible,
    // writes rejected — a missed `WHERE tenant_id = ?` fails closed.
    let visible: i64 = owner
        .query_one(&format!("SELECT count(*) FROM {table}"), &[])
        .await
        .expect("count should succeed")
        .get(0);
    assert_eq!(
        visible, 0,
        "FORCE must isolate the table owner when oz.tenant_id is unset"
    );
    let insert_err = owner
        .execute(
            &format!("INSERT INTO {table} (id, tenant_id) VALUES ($1, $2)"),
            &[&format!("{ns}-intruder"), &tenant],
        )
        .await
        .expect_err("FORCE must reject the owner's write when oz.tenant_id is unset");
    let detail = insert_err
        .as_db_error()
        .map(|d| d.message().to_string())
        .unwrap_or_default();
    assert!(
        detail.contains("row-level security"),
        "expected an RLS violation, got: {detail}"
    );

    // With the GUC set, the owner sees only that tenant's rows again.
    owner
        .execute("SELECT set_config('oz.tenant_id', $1, false)", &[&tenant])
        .await
        .expect("set_config should succeed");
    let visible: i64 = owner
        .query_one(&format!("SELECT count(*) FROM {table}"), &[])
        .await
        .expect("count should succeed")
        .get(0);
    assert_eq!(
        visible, 1,
        "the seeded row must be visible with the GUC set"
    );

    // Cleanup: drop the owner role and its table unconditionally.
    owner
        .execute("RESET ROLE", &[])
        .await
        .expect("reset role should succeed");
    drop(owner);
    client
        .batch_execute(&format!(
            "DROP TABLE IF EXISTS {table};
             REVOKE ALL ON SCHEMA public FROM {owner_role};
             DROP ROLE IF EXISTS {owner_role};"
        ))
        .await
        .expect("probe cleanup should succeed");

    // Release the database. The role was dropped above (roles are cluster-global,
    // so that part had to stay); the tables never left this database.
    drop(client);
    drop(pool);
    let admin_pool = match DbPool::connect_postgres(&url, false, 20, false).await {
        Ok(p) => p,
        Err(_) => return,
    };
    if let Ok(admin) = admin_pool.pg_client().await {
        let _ = admin
            .batch_execute(&format!("DROP DATABASE IF EXISTS {db_name} WITH (FORCE);"))
            .await;
    }
}

/// A connection killed server-side (PG addon idle-timeout, restart,
/// `pg_terminate_backend`) must be recycled — the next `pool.get()`
/// returns a WORKING connection, not the stale socket.
///
/// This is the behavior `RecyclingMethod::Fast`'s `is_closed()` probe
/// relies on (SOTA finding F): deadpool 0.12 has no max_lifetime, so
/// server-closed connections are detected reactively on checkout.
#[tokio::test]
async fn pg_integration_stale_connection_recycled() {
    let url = std::env::var("OZ_TEST_PG_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:15432/postgres".into());
    let pool = match DbPool::connect_postgres(&url, false, 20, false).await {
        Ok(DbPool::Postgres(pool)) => pool,
        Ok(_) => unreachable!("postgres:// URL returns Postgres"),
        Err(e) => {
            eprintln!("PG stale-connection integration test skipped: {e}");
            return;
        }
    };

    // Take one connection and find its backend PID.
    let client = pool.get().await.expect("get should succeed");
    let pid: i32 = client
        .query_one("SELECT pg_backend_pid()", &[])
        .await
        .expect("pg_backend_pid should work")
        .get(0);

    // Kill it server-side, simulating the PG addon dropping the session.
    let killer = pool.get().await.expect("second get should succeed");
    killer
        .execute("SELECT pg_terminate_backend($1)", &[&pid])
        .await
        .expect("pg_terminate_backend should succeed");
    drop(killer);

    // The next query on the killed client must fail — proving it really
    // is dead (not a false-positive scenario).
    let query_after_kill = client.query_one("SELECT 1", &[]).await;
    assert!(
        query_after_kill.is_err(),
        "the terminated connection must fail its next query"
    );
    drop(client);

    // The pool must recycle it: a fresh get() gives a working connection.
    let fresh = pool
        .get()
        .await
        .expect("pool must hand out a new connection");
    let row = fresh
        .query_one("SELECT 1", &[])
        .await
        .expect("fresh connection must serve queries after recycle");
    assert_eq!(row.get::<_, i32>(0), 1);
}
