//! Unit tests for the migrate_sqlite_to_pg bin, relocated from the bin
//! root's inline mod-tests per the house test-file rule (13-09-26 split).
//! Resolves the crate root through the glob import below.

use super::*;

fn sqlite_with_data() -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("oz-pos.db");
    let conn = Connection::open(&path).unwrap();
    conn.execute_batch(
        "CREATE TABLE tenant_plans (
                 tenant_id TEXT PRIMARY KEY,
                 plan      TEXT NOT NULL,
                 updated_at TEXT NOT NULL
             );
             CREATE TABLE settings (
                 key        TEXT PRIMARY KEY,
                 value      TEXT NOT NULL DEFAULT '',
                 updated_at TEXT NOT NULL
             );
             INSERT INTO tenant_plans VALUES ('tenant-a', 'pro', '2026-01-01T00:00:00Z');
             INSERT INTO tenant_plans VALUES ('tenant-b', 'free', '2026-01-02T00:00:00Z');
             INSERT INTO settings VALUES ('store.name', 'Migrate Store', '2026-01-03T00:00:00Z');",
    )
    .unwrap();
    (dir, path)
}

#[test]
fn fnv1a_is_stable() {
    assert_eq!(fnv1a(""), 0xcbf2_9ce4_8422_2325);
    assert_eq!(fnv1a("a"), 0xaf63_dc4c_8601_ec8c);
    // XOR of two fragment hashes is order-independent.
    let a = fnv1a("x") ^ fnv1a("y");
    let b = fnv1a("y") ^ fnv1a("x");
    assert_eq!(a, b);
}

#[test]
fn sqlite_rows_checksum_matches_readback() {
    let (_dir, path) = sqlite_with_data();
    let conn = Connection::open(&path).unwrap();
    let rows = read_sqlite_rows(&conn, "tenant_plans").unwrap();
    assert_eq!(rows.len(), 2);
    let checksum: u64 = rows
        .iter()
        .map(|r| fnv1a(&r.checksum_fragment()))
        .fold(0u64, |acc, h| acc ^ h);
    assert_ne!(checksum, 0);
    // The checksum is deterministic across reads.
    let rows2 = read_sqlite_rows(&conn, "tenant_plans").unwrap();
    let checksum2: u64 = rows2
        .iter()
        .map(|r| fnv1a(&r.checksum_fragment()))
        .fold(0u64, |acc, h| acc ^ h);
    assert_eq!(checksum, checksum2);
}

#[test]
fn topo_sort_orders_fk_children_after_parents() {
    let tables = vec![
        "sale_lines".to_string(),
        "sales".to_string(),
        "products".to_string(),
        "users".to_string(),
    ];
    let edges = vec![
        ("sale_lines".to_string(), "sales".to_string()),
        ("sale_lines".to_string(), "products".to_string()),
        ("sales".to_string(), "users".to_string()),
    ];
    let order = topo_sort(&tables, &edges);
    let pos = |t: &str| order.iter().position(|x| x == t).unwrap();
    assert!(
        pos("sales") < pos("sale_lines"),
        "sale_lines after sales: {order:?}"
    );
    assert!(
        pos("products") < pos("sale_lines"),
        "sale_lines after products: {order:?}"
    );
    assert!(pos("users") < pos("sales"), "sales after users: {order:?}");
    // Cycle fallback preserves the configured order.
    let cyclic = vec!["a".to_string(), "b".to_string()];
    let edges = vec![
        ("a".to_string(), "b".to_string()),
        ("b".to_string(), "a".to_string()),
    ];
    assert_eq!(topo_sort(&cyclic, &edges), cyclic);
}

/// Integration test: migrate a SQLite DB into a live Postgres and verify
/// row counts + checksums. Skips when Postgres is unreachable.
#[tokio::test]
async fn pg_integration_migrate_and_verify() {
    let url = std::env::var("OZ_TEST_PG_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:15432/postgres".into());
    let pool = match connect_postgres(&url).await {
        Ok(p) => p,
        Err(e) => {
            eprintln!("PG migration integration test skipped: {e}");
            return;
        }
    };

    let ns = format!("pg-migrate-test-{}", uuid::Uuid::now_v7());
    let tenant_a = format!("{ns}-a");
    let tenant_b = format!("{ns}-b");
    let store_key = format!("{ns}-store");

    // Seed a second SQLite DB whose tenant/settings rows are namespaced.
    let dir2 = tempfile::tempdir().unwrap();
    let path2 = dir2.path().join("oz-pos.db");
    {
        let conn = Connection::open(&path2).unwrap();
        conn.execute_batch(&format!(
                "CREATE TABLE tenant_plans (
                     tenant_id TEXT PRIMARY KEY,
                     plan      TEXT NOT NULL,
                     updated_at TEXT NOT NULL
                 );
                 CREATE TABLE settings (
                     key        TEXT PRIMARY KEY,
                     value      TEXT NOT NULL DEFAULT '',
                     updated_at TEXT NOT NULL
                 );
                 INSERT INTO tenant_plans VALUES ('{tenant_a}', 'pro', '2026-02-01T00:00:00Z');
                 INSERT INTO tenant_plans VALUES ('{tenant_b}', 'free', '2026-02-02T00:00:00Z');
                 INSERT INTO settings VALUES ('{store_key}', 'Migrated Store', '2026-02-03T00:00:00Z');",
            ))
            .unwrap();
    }

    // Clean any rows left by previous (possibly crashed) runs of this
    // test, then run the migration.
    {
        let client = pool.get().await.unwrap();
        client
            .execute(
                "DELETE FROM tenant_plans WHERE tenant_id LIKE 'pg-migrate-test-%'",
                &[],
            )
            .await
            .unwrap();
        client
            .execute(
                "DELETE FROM settings WHERE key LIKE 'pg-migrate-test-%'",
                &[],
            )
            .await
            .unwrap();
    }

    // Direct call: connect + copy (bypasses env parsing). The built-in
    // whole-table verification is not asserted — parallel test binaries
    // share this DB — so the definitive check below is namespaced.
    let conn = Connection::open(&path2).unwrap();
    let (_copied, _tables, _failures) = copy_and_verify(
        &pool,
        &conn,
        &["tenant_plans".to_string(), "settings".to_string()],
        500,
        false,
    )
    .await
    .unwrap();

    // Namespaced verification: every seeded row made it with an
    // identical checksum (tenant_id / key is the first column).
    let ns_prefix = format!("{ns}-");
    for table in ["tenant_plans", "settings"] {
        let columns = sqlite_columns(&conn, table).unwrap();
        let src = read_sqlite_rows(&conn, table).unwrap();
        let mut pg = read_pg_rows(&pool, table, &columns).await.unwrap();
        pg.retain(|r| matches!(&r.cells[0], Cell::Text(t) if t.starts_with(&ns_prefix)));
        assert_eq!(pg.len(), src.len(), "{table} row count");
        let src_sum: u64 = src
            .iter()
            .map(|r| fnv1a(&r.checksum_fragment()))
            .fold(0u64, |acc, h| acc ^ h);
        let pg_sum: u64 = pg
            .iter()
            .map(|r| fnv1a(&r.checksum_fragment()))
            .fold(0u64, |acc, h| acc ^ h);
        assert_eq!(pg_sum, src_sum, "{table} checksum");
    }

    // Verify the migrated values round-trip.
    let client = pool.get().await.unwrap();
    let plan: String = client
        .query_one(
            "SELECT plan FROM tenant_plans WHERE tenant_id = $1",
            &[&tenant_a],
        )
        .await
        .unwrap()
        .get(0);
    assert_eq!(plan, "pro");
    let store: String = client
        .query_one("SELECT value FROM settings WHERE key = $1", &[&store_key])
        .await
        .unwrap()
        .get(0);
    assert_eq!(store, "Migrated Store");

    // Cleanup.
    client
        .execute(
            "DELETE FROM tenant_plans WHERE tenant_id LIKE $1",
            &[&format!("{ns}-%")],
        )
        .await
        .unwrap();
    client
        .execute(
            "DELETE FROM settings WHERE key LIKE $1",
            &[&format!("{ns}-%")],
        )
        .await
        .unwrap();
}

/// Volume test: migrate a SQLite DB seeded with the **real** schema
/// (`oz_core::migrations::run`) and 10k+ rows across several tables, then
/// assert every row made it with an identical checksum. Exercises the
/// copy batching and the checksum path at the volume the cutover will
/// actually see. Skips when Postgres is unreachable.
#[tokio::test]
async fn pg_integration_migrate_large_db() {
    let url = std::env::var("OZ_TEST_PG_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:15432/postgres".into());
    let pool = match connect_postgres(&url).await {
        Ok(p) => p,
        Err(e) => {
            eprintln!("PG migration volume test skipped: {e}");
            return;
        }
    };

    let ns = format!("pg-migrate-vol-{}", uuid::Uuid::now_v7());
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("oz-pos.db");

    // Clean any rows left by previous runs of this test (a crashed run
    // keeps its rows, and `copy_and_verify` compares whole tables), then
    // seed the source DB.
    {
        let client = pool.get().await.unwrap();
        client
            .execute(
                "DELETE FROM offline_queue WHERE tenant_id LIKE 'pg-migrate-vol-%'",
                &[],
            )
            .await
            .unwrap();
        client
            .execute(
                "DELETE FROM products WHERE tenant_id LIKE 'pg-migrate-vol-%'",
                &[],
            )
            .await
            .unwrap();
        client
            .execute(
                "DELETE FROM settings WHERE key LIKE 'pg-migrate-vol-%'",
                &[],
            )
            .await
            .unwrap();
    }

    {
        let mut conn = Connection::open(&path).unwrap();
        oz_core::migrations::run(&mut conn).unwrap();

        let now = "2026-03-01T00:00:00Z";
        let tenant = format!("{ns}-default");
        let tx = conn.transaction().unwrap();
        {
            let mut stmt = tx
                    .prepare(
                        "INSERT INTO offline_queue \
                         (id, action, payload, status, retry_count, last_error, created_at, synced_at, tenant_id, priority) \
                         VALUES (?1, 'complete_sale', ?2, 'pending', 0, NULL, ?3, NULL, ?4, 1)",
                    )
                    .unwrap();
            for i in 0..10_000 {
                stmt.execute(rusqlite::params![
                    format!("{ns}-q{i:05}"),
                    format!(r#"{{"total":{i}}}"#),
                    now,
                    tenant,
                ])
                .unwrap();
            }
        }
        {
            let mut stmt = tx
                    .prepare(
                        "INSERT INTO products \
                         (id, sku, name, price_minor, currency, created_at, updated_at, price_updated_at, \
                          track_serial, product_type, version, cost_minor, store_id, tenant_id, \
                          brand, rack_location, notes, unit, is_active, default_supplier_id, popularity_score) \
                         VALUES (?1, ?2, ?3, ?4, 'USD', ?5, ?5, '', 0, 'retail', 1, 0, NULL, ?6, \
                                 NULL, NULL, NULL, NULL, 1, NULL, 0.0)",
                    )
                    .unwrap();
            for i in 0..300 {
                stmt.execute(rusqlite::params![
                    format!("{ns}-p{i:04}"),
                    format!("{ns}-SKU-{i:04}"),
                    format!("Volume Product {i}"),
                    100 + i as i64,
                    now,
                    tenant,
                ])
                .unwrap();
            }
        }
        {
            let mut stmt = tx
                .prepare("INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)")
                .unwrap();
            for i in 0..100 {
                stmt.execute(rusqlite::params![
                    format!("{ns}-key-{i}"),
                    format!("value-{i}"),
                    now
                ])
                .unwrap();
            }
        }
        tx.commit().unwrap();
    }

    // Migrate the three tables at volume. `copy_and_verify`'s built-in
    // whole-table verification is not asserted here: the shared dev DB
    // is written by parallel test binaries (webhooks, email), so a
    // concurrent row can legitimately appear mid-verify. The definitive
    // check below compares only this run's namespaced rows.
    let conn = Connection::open(&path).unwrap();
    let (copied, tables, _failures) = copy_and_verify(
        &pool,
        &conn,
        &[
            "offline_queue".to_string(),
            "products".to_string(),
            "settings".to_string(),
        ],
        500,
        false,
    )
    .await
    .unwrap();
    assert_eq!(tables, 3);
    assert_eq!(copied, 10_400, "10k queue + 300 products + 100 settings");

    // Namespaced verification: every row this test seeded made it to
    // Postgres with an identical checksum (ids/keys all carry the ns
    // prefix as their first column).
    let ns_prefix = format!("{ns}-");
    for table in ["offline_queue", "products", "settings"] {
        let columns = sqlite_columns(&conn, table).unwrap();
        let src = read_sqlite_rows(&conn, table).unwrap();
        let mut pg = read_pg_rows(&pool, table, &columns).await.unwrap();
        pg.retain(|r| matches!(&r.cells[0], Cell::Text(t) if t.starts_with(&ns_prefix)));
        assert_eq!(pg.len(), src.len(), "{table} row count");
        let src_sum: u64 = src
            .iter()
            .map(|r| fnv1a(&r.checksum_fragment()))
            .fold(0u64, |acc, h| acc ^ h);
        let pg_sum: u64 = pg
            .iter()
            .map(|r| fnv1a(&r.checksum_fragment()))
            .fold(0u64, |acc, h| acc ^ h);
        assert_eq!(pg_sum, src_sum, "{table} checksum");
    }

    // Exact row counts on the destination, then spot-check values.
    let client = pool.get().await.unwrap();
    let queue_rows: i64 = client
        .query_one(
            "SELECT COUNT(*) FROM offline_queue WHERE tenant_id = $1",
            &[&format!("{ns}-default")],
        )
        .await
        .unwrap()
        .get(0);
    assert_eq!(queue_rows, 10_000);
    let product_rows: i64 = client
        .query_one(
            "SELECT COUNT(*) FROM products WHERE tenant_id = $1",
            &[&format!("{ns}-default")],
        )
        .await
        .unwrap()
        .get(0);
    assert_eq!(product_rows, 300);
    let payload: String = client
        .query_one(
            "SELECT payload FROM offline_queue WHERE id = $1",
            &[&format!("{ns}-q09999")],
        )
        .await
        .unwrap()
        .get(0);
    assert_eq!(payload, r#"{"total":9999}"#);
    let price: i64 = client
        .query_one(
            "SELECT price_minor FROM products WHERE sku = $1",
            &[&format!("{ns}-SKU-0299")],
        )
        .await
        .unwrap()
        .get(0);
    assert_eq!(price, 100 + 299);

    // Cleanup.
    client
        .execute(
            "DELETE FROM offline_queue WHERE tenant_id LIKE $1",
            &[&format!("{ns}-%")],
        )
        .await
        .unwrap();
    client
        .execute(
            "DELETE FROM products WHERE tenant_id LIKE $1",
            &[&format!("{ns}-%")],
        )
        .await
        .unwrap();
    client
        .execute(
            "DELETE FROM settings WHERE key LIKE $1",
            &[&format!("{ns}-%")],
        )
        .await
        .unwrap();
}
