use super::*;
use std::str::FromStr;

fn fresh_db() -> Arc<Mutex<Connection>> {
    Arc::new(Mutex::new(kasirmu_core::migrations::fresh_db()))
}

/// Create a throwaway PostgreSQL database, apply the full schema, and
/// return `(pool, db_name)`. Each PG integration test gets its own
/// isolated database to avoid AccessExclusiveLock deadlocks from
/// concurrent PG_INIT DDL on the shared base DB.
///
/// Caller must clean up with `DROP DATABASE {db_name} WITH (FORCE)`.
async fn throwaway_pool() -> Option<(deadpool_postgres::Pool, String)> {
    let url = std::env::var("OZ_TEST_PG_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:15432/postgres".into());
    let config = tokio_postgres::Config::from_str(&url).ok()?;
    let admin_mgr = deadpool_postgres::Manager::new(config, tokio_postgres::NoTls);
    let admin_pool = deadpool_postgres::Pool::builder(admin_mgr)
        .max_size(2)
        .build()
        .ok()?;
    let admin = admin_pool.get().await.ok()?;

    // Clean up stale throwaway DBs from crashed runs.
    let stale: Vec<String> = admin
        .query(
            "SELECT datname FROM pg_database WHERE datname LIKE 'oz_sync_test_%'",
            &[],
        )
        .await
        .ok()?
        .iter()
        .map(|r| r.get::<_, String>(0))
        .collect();
    for d in &stale {
        let _ = admin
            .batch_execute(&format!("DROP DATABASE IF EXISTS {d} WITH (FORCE);"))
            .await;
    }

    // `.simple()` (hex only): the name is interpolated as an unquoted
    // identifier — UUID `Display` hyphens made CREATE DATABASE a syntax
    // error and silently skipped every sync-store PG test.
    let db_name = format!(
        "oz_sync_test_{}_{}",
        std::process::id(),
        uuid::Uuid::now_v7().simple()
    );
    admin
        .execute(&format!("CREATE DATABASE {db_name}"), &[])
        .await
        .ok()?;
    drop(admin);
    drop(admin_pool);

    // Connect to the new DB and apply schema.
    let db_url = format!("postgres://postgres:postgres@localhost:15432/{db_name}");
    let db_config = tokio_postgres::Config::from_str(&db_url).ok()?;
    let mgr = deadpool_postgres::Manager::new(db_config, tokio_postgres::NoTls);
    let pool = deadpool_postgres::Pool::builder(mgr)
        .max_size(3)
        .build()
        .ok()?;
    let client = pool.get().await.ok()?;
    client
        .batch_execute(kasirmu_core::migrations::PG_INIT)
        .await
        .ok()?;
    drop(client);

    Some((pool, db_name))
}

fn sample_item(id: &str) -> OfflineQueueItem {
    OfflineQueueItem {
        id: id.to_owned(),
        action: "complete_sale".into(),
        payload: r#"{"total":100}"#.into(),
        status: OfflineQueueStatus::Pending,
        retry_count: 0,
        last_error: None,
        tenant_id: "default".into(),
        created_at: "2026-01-01T00:00:00Z".into(),
        synced_at: None,
        priority: SyncPriority::Normal,
        origin_terminal_id: None,
    }
}

/// The SQLite backend must round-trip a push → pull → snapshot through
/// the same abstraction the handlers use, proving backend parity is
/// exercised in unit tests (the full Postgres path is covered by the
/// integration test below).
#[tokio::test]
async fn sqlite_backend_push_pull_plan_snapshot_roundtrip() {
    let conn = fresh_db();
    let store = SyncStore::sqlite(conn.clone());

    // Plan gating: no row → None, then a set row → Pro.
    assert_eq!(store.get_tenant_plan("tenant-a").await.unwrap(), None);
    {
        let conn = conn.lock().await;
        kasirmu_core::Store::new(&conn)
            .set_tenant_plan("tenant-a", TenantPlan::Pro)
            .unwrap();
    }
    assert_eq!(
        store.get_tenant_plan("tenant-a").await.unwrap(),
        Some(TenantPlan::Pro)
    );

    // Push two items, one a duplicate.
    let item = sample_item("id-1");
    assert!(matches!(
        store.push_item(&item, "tenant-a").await.unwrap(),
        PushOutcome::Accepted
    ));
    assert!(matches!(
        store.push_item(&item, "tenant-a").await.unwrap(),
        PushOutcome::Rejected { .. }
    ));

    // Pull returns the one accepted item.
    let items = store
        .pull_items("tenant-a", Some("2026-01-01T00:00:00Z"), None, 501)
        .await
        .unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].id, "id-1");

    // Status counts reflect the queue.
    assert_eq!(store.pending_count("tenant-a").await, 1);
    assert_eq!(store.distinct_tenant_count().await, 1);

    // Snapshot is empty but well-formed for a tenant with no products.
    let (products, tax_rates, users) = store.snapshot_all("tenant-a").await.unwrap();
    assert_eq!(products.len(), 0);
    assert_eq!(tax_rates.len(), 0);
    assert_eq!(users.len(), 0);
}

#[tokio::test]
async fn sqlite_snapshot_carries_tax_rate_scope_and_window() {
    // The producer half of the repair. A hub row scoped to a location must
    // leave the snapshot WITH that scope: the branch maps a missing key to
    // tenant-global, so an omitted column here is precisely how one location's
    // rate ends up pricing every location.
    let conn = fresh_db();
    {
        let guard = conn.lock().await;
        guard
            .execute(
                "INSERT INTO legal_entities (id, tenant_id, name) \
                 VALUES ('ent-hub', 'tenant-hub', 'Hub Entity')",
                [],
            )
            .unwrap();
        guard
            .execute(
                "INSERT INTO locations (id, name, tenant_id) \
                 VALUES ('loc-hub', 'Hub Location', 'tenant-hub')",
                [],
            )
            .unwrap();
        guard
            .execute(
                "INSERT INTO tax_rates (id, name, rate_bps, is_default, is_inclusive, \
                                        tenant_id, location_id, effective_from, effective_to) \
                 VALUES ('tax-hub', 'Hub VAT', 1100, 0, 0, 'tenant-hub', 'loc-hub', \
                         '2026-01-01', '2027-01-01')",
                [],
            )
            .unwrap();
    }

    let store = SyncStore::sqlite(conn);
    let (_, tax_rates, _) = store.snapshot_all("tenant-hub").await.unwrap();
    assert_eq!(tax_rates.len(), 1);
    assert_eq!(tax_rates[0]["location_id"], "loc-hub");
    assert_eq!(tax_rates[0]["effective_from"], "2026-01-01");
    assert_eq!(tax_rates[0]["effective_to"], "2027-01-01");
    assert_eq!(
        tax_rates[0]["legal_entity_id"],
        serde_json::Value::Null,
        "location-scoped, not entity-scoped: the other column stays null rather than \
         being invented"
    );
}

/// Duplicate-id detection for the Postgres path keys on SQLSTATE 23505,
/// not on the error message (unlike SQLite's "UNIQUE" substring).
#[tokio::test]
async fn sqlite_duplicate_rejection_uses_unique_substring() {
    let conn = fresh_db();
    let store = SyncStore::sqlite(conn);
    let item = sample_item("dup-id");
    store.push_item(&item, "default").await.unwrap();
    match store.push_item(&item, "default").await.unwrap() {
        PushOutcome::Rejected { reason } => {
            assert!(reason.contains("duplicate id: dup-id"), "got: {reason}");
        }
        other => panic!("expected Rejected, got: {other:?}"),
    }
}

/// `push_batch` must persist every item in one lock acquisition (SQLite)
/// and return one outcome per item, in order, matching `push_item` on the
/// same inputs — proving the batched path is a drop-in for the loop.
#[tokio::test]
async fn sqlite_push_batch_matches_per_item_semantics() {
    let conn = fresh_db();
    let store = SyncStore::sqlite(conn.clone());

    let items = vec![
        sample_item("batch-1"),
        sample_item("batch-2"),
        sample_item("batch-3"),
    ];
    let outcomes = store.push_batch(&items, "tenant-b").await.unwrap();
    assert_eq!(outcomes.len(), 3);
    assert!(matches!(outcomes[0], PushOutcome::Accepted));
    assert!(matches!(outcomes[1], PushOutcome::Accepted));
    assert!(matches!(outcomes[2], PushOutcome::Accepted));

    // Duplicate within the same batch: second copy is Rejected, the
    // remaining items still Accepted (no batch-wide rollback).
    let dup_batch = vec![
        sample_item("batch-4"),
        sample_item("batch-4"),
        sample_item("batch-5"),
    ];
    let outcomes = store.push_batch(&dup_batch, "tenant-b").await.unwrap();
    assert_eq!(outcomes.len(), 3);
    assert!(matches!(outcomes[0], PushOutcome::Accepted));
    match &outcomes[1] {
        PushOutcome::Rejected { reason } => {
            assert!(reason.contains("duplicate id: batch-4"), "got: {reason}");
        }
        other => panic!("expected Rejected for dup, got: {other:?}"),
    }
    assert!(matches!(outcomes[2], PushOutcome::Accepted));

    // Pull confirms exactly the accepted rows landed.
    let pulled = store
        .pull_items("tenant-b", Some("2026-01-01T00:00:00Z"), None, 501)
        .await
        .unwrap();
    let mut ids: Vec<_> = pulled.iter().map(|i| i.id.as_str()).collect();
    ids.sort_unstable();
    assert_eq!(
        ids,
        vec!["batch-1", "batch-2", "batch-3", "batch-4", "batch-5"]
    );
}

/// An empty batch must return an empty outcome list without error on both
/// backends — no pointless transaction is opened or committed.
#[tokio::test]
async fn store_push_batch_empty_returns_empty() {
    let conn = fresh_db();
    let store = SyncStore::sqlite(conn.clone());

    let outcomes = store.push_batch(&[], "tenant-empty").await.unwrap();
    assert!(outcomes.is_empty(), "empty batch → no outcomes");
    assert_eq!(store.pending_count("tenant-empty").await, 0);
}

/// Integration test against a live Postgres instance (the same Docker
/// service `db.rs` uses, port 15432). Skips when unreachable, so the
/// suite stays green on machines without a running Postgres.
#[tokio::test]
async fn pg_integration_push_pull_plan_snapshot_roundtrip() {
    let Some((pool, db_name)) = throwaway_pool().await else {
        eprintln!("PG sync-store integration test skipped: cannot create throwaway DB");
        return;
    };

    let tenant = format!("pg-sync-store-test-{}", uuid::Uuid::now_v7());
    let store = SyncStore::postgres(pool.clone());

    // Seed a plan and exercise every method end-to-end.
    {
        let client = pool.get().await.unwrap();
        client
            .execute(
                "INSERT INTO tenant_plans (tenant_id, plan, updated_at) VALUES ($1, 'pro', now()::text)
                 ON CONFLICT (tenant_id) DO UPDATE SET plan = 'pro'",
                &[&tenant],
            )
            .await
            .unwrap();
    }

    assert_eq!(
        store.get_tenant_plan(&tenant).await.unwrap(),
        Some(TenantPlan::Pro)
    );

    let mut item = sample_item(&format!("pg-item-{tenant}"));
    item.tenant_id = tenant.clone();
    // C3 S2: the Postgres arm must carry the origin through its INSERT, its
    // SELECT list and its row decode, exactly as the SQLite arm does.
    item.origin_terminal_id = Some("pg-terminal-abc".into());
    assert!(matches!(
        store.push_item(&item, &tenant).await.unwrap(),
        PushOutcome::Accepted
    ));
    assert!(matches!(
        store.push_item(&item, &tenant).await.unwrap(),
        PushOutcome::Rejected { .. }
    ));

    let items = store
        .pull_items(&tenant, Some("2026-01-01T00:00:00Z"), None, 501)
        .await
        .unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].id, format!("pg-item-{tenant}"));
    assert_eq!(items[0].tenant_id, tenant);
    assert_eq!(
        items[0].origin_terminal_id.as_deref(),
        Some("pg-terminal-abc"),
        "the Postgres INSERT/SELECT must carry the origin, or it vanishes here"
    );

    assert_eq!(store.pending_count(&tenant).await, 1);
    assert!(store.distinct_tenant_count().await >= 1);

    // Seed reference data with boolean columns so the snapshot path —
    // including the Postgres BIGINT(0/1) → bool mapping — is exercised
    // against a live database, not just the empty-set fast path.
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
        client
            .execute(
                "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, tenant_id)
                 VALUES ($1, $2, 'hash', 'Tester', $3, 0, $4)",
                &[
                    &format!("user-{tenant}"),
                    &format!("tester-{tenant}"),
                    &role_id,
                    &tenant,
                ],
            )
            .await
            .unwrap();
        client
            .execute(
                // is_default=0: the idx_tax_rates_single_default partial
                // UNIQUE index is GLOBAL (one default across the whole DB),
                // so seeding is_default=1 here would collide with any
                // concurrent test that also seeds a default. The snapshot
                // mapping (BIGINT 0/1 -> bool) is exercised identically
                // with a non-default row.
                "INSERT INTO tax_rates (id, name, rate_bps, is_default, is_inclusive, tenant_id)
                 VALUES ($1, 'Tax', 800, 0, 0, $2)",
                &[&format!("tax-{tenant}"), &tenant],
            )
            .await
            .unwrap();
        client
            .execute(
                "INSERT INTO products (id, sku, name, price_minor, currency, track_serial, is_active, tenant_id)
                 VALUES ($1, $2, 'Widget', 100, 'USD', 1, 1, $3)",
                &[&format!("prod-{tenant}"), &format!("SKU-{tenant}"), &tenant],
            )
            .await
            .unwrap();
    }

    // Products: track_serial=1 → true, is_active=1 → true.
    let (products, tax_rates, users) = store.snapshot_all(&tenant).await.unwrap();
    assert_eq!(products.len(), 1);
    assert_eq!(products[0]["track_serial"], true);
    assert_eq!(products[0]["is_active"], true);

    // Tax rates: is_default=0 → false, is_inclusive=0 → false.
    assert_eq!(tax_rates.len(), 1);
    assert_eq!(tax_rates[0]["is_default"], false);
    assert_eq!(tax_rates[0]["is_inclusive"], false);

    // The scope + window keys must be PRESENT on every snapshot row, including
    // an unscoped one. Their absence is what let a scoped rate reach a branch
    // reading as tenant-global; here null means "tenant-global" and the client
    // maps it to exactly that. Asserted for both backends because both build
    // the payload independently.
    for key in [
        "legal_entity_id",
        "location_id",
        "effective_from",
        "effective_to",
    ] {
        assert!(
            tax_rates[0].get(key).is_some(),
            "snapshot tax rate must carry {key:?} (null is meaningful, missing is not)"
        );
        assert_eq!(
            tax_rates[0][key],
            serde_json::Value::Null,
            "an unscoped rate emits {key:?} as null on both backends"
        );
    }

    // Users: is_active=0 → false, and pin_hash must not leak (SYNC-06).
    assert_eq!(users.len(), 1);
    assert_eq!(users[0]["is_active"], false);
    assert!(users[0].get("pin_hash").is_none());

    // Clean up the rows this test created so a shared dev DB stays tidy.
    {
        let client = pool.get().await.unwrap();
        let role_id = format!("role-{tenant}");
        client
            .execute("DELETE FROM offline_queue WHERE tenant_id = $1", &[&tenant])
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
    }
    // Cleanup: drop the throwaway database.
    drop(pool);
    let url = std::env::var("OZ_TEST_PG_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:15432/postgres".into());
    let config = tokio_postgres::Config::from_str(&url).unwrap();
    let mgr = deadpool_postgres::Manager::new(config, tokio_postgres::NoTls);
    let admin = deadpool_postgres::Pool::builder(mgr)
        .max_size(1)
        .build()
        .unwrap();
    let client = admin.get().await.unwrap();
    let _ = client
        .batch_execute(&format!("DROP DATABASE IF EXISTS {db_name} WITH (FORCE);"))
        .await;
}

/// The critical batch regression test: a duplicate id in the MIDDLE of a
/// batch must NOT poison the transaction on PostgreSQL.
///
/// `push_batch` uses `INSERT … ON CONFLICT (id) DO NOTHING RETURNING id`
/// so a duplicate reports `Rejected` without aborting the transaction —
/// a naive plain `INSERT` would abort the whole batch on the first
/// UNIQUE violation, and every subsequent item would fail with "current
/// transaction is aborted".
#[tokio::test]
async fn pg_integration_push_batch_duplicate_in_middle_survives() {
    let Some((pool, db_name)) = throwaway_pool().await else {
        eprintln!("PG push-batch integration test skipped: cannot create throwaway DB");
        return;
    };
    let tenant = format!("pg-batch-{}", uuid::Uuid::now_v7());
    let store = SyncStore::postgres(pool.clone());

    // Seed an existing row that the batch will duplicate.
    let existing = sample_item(&format!("pg-batch-dup-{}", uuid::Uuid::now_v7()));
    assert!(matches!(
        store.push_item(&existing, &tenant).await.unwrap(),
        PushOutcome::Accepted
    ));

    // Batch: [new-A, duplicate-of-existing, new-B].
    let new_a = sample_item(&format!("pg-batch-a-{}", uuid::Uuid::now_v7()));
    let new_b = sample_item(&format!("pg-batch-b-{}", uuid::Uuid::now_v7()));
    let mut dup = existing.clone();
    dup.id = existing.id.clone(); // same id → UNIQUE conflict
    let batch = vec![new_a.clone(), dup, new_b.clone()];

    let outcomes = store.push_batch(&batch, &tenant).await.unwrap();
    assert_eq!(outcomes.len(), 3);
    assert!(
        matches!(outcomes[0], PushOutcome::Accepted),
        "first (new) item must be Accepted, got: {:?}",
        outcomes[0]
    );
    match &outcomes[1] {
        PushOutcome::Rejected { reason } => {
            assert!(
                reason.contains("duplicate id:"),
                "middle item must be Rejected as duplicate, got: {reason}"
            );
        }
        other => panic!("expected Rejected for duplicate, got: {other:?}"),
    }
    assert!(
        matches!(outcomes[2], PushOutcome::Accepted),
        "third (new) item must STILL be Accepted — the duplicate must not abort the batch, got: {:?}",
        outcomes[2]
    );

    // Cleanup: drop the throwaway database.
    drop(pool);
    let url = std::env::var("OZ_TEST_PG_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:15432/postgres".into());
    let config = tokio_postgres::Config::from_str(&url).unwrap();
    let mgr = deadpool_postgres::Manager::new(config, tokio_postgres::NoTls);
    let admin = deadpool_postgres::Pool::builder(mgr)
        .max_size(1)
        .build()
        .unwrap();
    let client = admin.get().await.unwrap();
    let _ = client
        .batch_execute(&format!("DROP DATABASE IF EXISTS {db_name} WITH (FORCE);"))
        .await;
}

/// A committed batch must be durable and visible to a FRESH connection —
/// a `drop(tx)` (rollback) regression would pass within the batch's own
/// transaction but fail here.
#[tokio::test]
async fn pg_integration_push_batch_commit_visible_to_new_connection() {
    let Some((pool, db_name)) = throwaway_pool().await else {
        eprintln!("PG push-batch commit test skipped: cannot create throwaway DB");
        return;
    };
    let tenant = format!("pg-batch-commit-{}", uuid::Uuid::now_v7());
    let store = SyncStore::postgres(pool.clone());

    let items = vec![
        sample_item(&format!("pg-commit-1-{}", uuid::Uuid::now_v7())),
        sample_item(&format!("pg-commit-2-{}", uuid::Uuid::now_v7())),
        sample_item(&format!("pg-commit-3-{}", uuid::Uuid::now_v7())),
    ];
    let outcomes = store.push_batch(&items, &tenant).await.unwrap();
    assert_eq!(outcomes.len(), 3);
    assert!(outcomes.iter().all(|o| matches!(o, PushOutcome::Accepted)));

    // A brand-new pool connection (fresh checkout) must see all 3 rows —
    // proving the batch COMMIT was durable.
    let client = pool.get().await.unwrap();
    let count: i64 = client
        .query_one(
            "SELECT COUNT(*) FROM offline_queue WHERE tenant_id = $1",
            &[&tenant],
        )
        .await
        .unwrap()
        .get(0);
    assert_eq!(
        count, 3,
        "committed batch must be visible on a fresh connection"
    );

    // Cleanup: drop the throwaway database.
    drop(pool);
    let url = std::env::var("OZ_TEST_PG_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:15432/postgres".into());
    let config = tokio_postgres::Config::from_str(&url).unwrap();
    let mgr = deadpool_postgres::Manager::new(config, tokio_postgres::NoTls);
    let admin = deadpool_postgres::Pool::builder(mgr)
        .max_size(1)
        .build()
        .unwrap();
    let client = admin.get().await.unwrap();
    let _ = client
        .batch_execute(&format!("DROP DATABASE IF EXISTS {db_name} WITH (FORCE);"))
        .await;
}

/// RED (TDD): a per-item DATA error (not a UNIQUE conflict) in the middle
/// of a PG batch must NOT abort the whole transaction — the good items
/// must still land, and the batch must return per-item outcomes.
///
/// PostgreSQL aborts a transaction on ANY statement failure, so the
/// `Err` branch of the current `query_opt` loop leaves every subsequent
/// item failing with "current transaction is aborted" and `commit()`
/// fails — silently losing the valid items. This test installs a trigger
/// that raises on one specific payload to simulate a CHECK/trigger/NOT
/// NULL failure, exactly the class of error `ON CONFLICT DO NOTHING`
/// does NOT suppress.
#[tokio::test]
async fn pg_integration_push_batch_data_error_does_not_abort_batch() {
    let Some((pool, db_name)) = throwaway_pool().await else {
        eprintln!("PG push-batch data-error test skipped: cannot create throwaway DB");
        return;
    };
    let tenant = format!("pg-batch-err-{}", uuid::Uuid::now_v7());
    let store = SyncStore::postgres(pool.clone());

    // Install a trigger that rejects inserts whose payload contains
    // "poison" — simulating a CHECK constraint / trigger / future NOT
    // NULL failure that ON CONFLICT DO NOTHING cannot suppress.
    let trigger_fn = format!("reject_poison_{}", uuid::Uuid::now_v7().simple());
    let trigger = format!("{trigger_fn}_trg");
    let client = pool.get().await.unwrap();
    client
        .batch_execute(&format!(
            "CREATE OR REPLACE FUNCTION {trigger_fn}() RETURNS trigger AS $$
             BEGIN
                 IF NEW.payload LIKE '%poison%' THEN
                     RAISE EXCEPTION 'poison payload rejected by test trigger';
                 END IF;
                 RETURN NEW;
             END; $$ LANGUAGE plpgsql;
             CREATE TRIGGER {trigger}
                 BEFORE INSERT ON offline_queue
                 FOR EACH ROW EXECUTE FUNCTION {trigger_fn}();"
        ))
        .await
        .unwrap();
    drop(client);

    let ok_a = sample_item(&format!("pg-err-a-{}", uuid::Uuid::now_v7()));
    let mut poison = sample_item(&format!("pg-err-b-{}", uuid::Uuid::now_v7()));
    poison.payload = r#"{"poison":true}"#.to_owned();
    let ok_c = sample_item(&format!("pg-err-c-{}", uuid::Uuid::now_v7()));
    let batch = vec![ok_a.clone(), poison.clone(), ok_c.clone()];

    let result = store.push_batch(&batch, &tenant).await;
    let outcomes = match result {
        Ok(o) => o,
        Err(e) => panic!(
            "push_batch must return per-item outcomes, not Err: {e}\n\
             (a data error in one item must not abort the whole batch)"
        ),
    };

    assert_eq!(outcomes.len(), 3);
    assert!(
        matches!(outcomes[0], PushOutcome::Accepted),
        "item before the data error must be Accepted, got: {:?}",
        outcomes[0]
    );
    match &outcomes[1] {
        PushOutcome::Rejected { reason } => {
            assert!(
                reason.contains("poison payload rejected"),
                "poison item must be Rejected with its real error, got: {reason}"
            );
        }
        other => panic!("expected Rejected for poison item, got: {other:?}"),
    }
    assert!(
        matches!(outcomes[2], PushOutcome::Accepted),
        "item AFTER the data error must STILL be Accepted — the batch must survive, got: {:?}",
        outcomes[2]
    );

    // The two good items must actually have landed (the transaction
    // committed); the poison item must not.
    let client = pool.get().await.unwrap();
    let count: i64 = client
        .query_one(
            "SELECT COUNT(*) FROM offline_queue WHERE tenant_id = $1",
            &[&tenant],
        )
        .await
        .unwrap()
        .get(0);
    assert_eq!(
        count, 2,
        "exactly the two good items must be persisted, poison item dropped"
    );

    // Cleanup: drop the throwaway database.
    drop(pool);
    let url = std::env::var("OZ_TEST_PG_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:15432/postgres".into());
    let config = tokio_postgres::Config::from_str(&url).unwrap();
    let mgr = deadpool_postgres::Manager::new(config, tokio_postgres::NoTls);
    let admin = deadpool_postgres::Pool::builder(mgr)
        .max_size(1)
        .build()
        .unwrap();
    let client = admin.get().await.unwrap();
    let _ = client
        .batch_execute(&format!("DROP DATABASE IF EXISTS {db_name} WITH (FORCE);"))
        .await;
}

/// CS-3 fix: the SQLite arm now runs the batch inside one transaction.
/// These tests pin the commit path: all accepted rows land atomically and
/// duplicate-rejection semantics are unchanged from the per-item loop.
#[tokio::test]
async fn sqlite_push_batch_commits_atomically_and_rejects_dups() {
    let conn = fresh_db();
    let store = SyncStore::sqlite(conn.clone());

    // A batch where every item is new lands fully.
    let batch = vec![
        sample_item("cs3-a"),
        sample_item("cs3-b"),
        sample_item("cs3-c"),
    ];
    let outcomes = store.push_batch(&batch, "tenant-cs3").await.unwrap();
    assert!(outcomes.iter().all(|o| matches!(o, PushOutcome::Accepted)));

    // A batch with a duplicate inside it still records per-item outcomes
    // (the UNIQUE failure rolls back only its own statement) and the
    // non-duplicate items are committed — not lost to a batch rollback.
    let dup_batch = vec![
        sample_item("cs3-d"),
        sample_item("cs3-a"),
        sample_item("cs3-e"),
    ];
    let outcomes = store.push_batch(&dup_batch, "tenant-cs3").await.unwrap();
    assert_eq!(outcomes.len(), 3);
    assert!(matches!(outcomes[0], PushOutcome::Accepted));
    assert!(matches!(&outcomes[1], PushOutcome::Rejected { .. }));
    assert!(matches!(outcomes[2], PushOutcome::Accepted));

    let pulled = store
        .pull_items("tenant-cs3", Some("2026-01-01T00:00:00Z"), None, 501)
        .await
        .unwrap();
    let mut ids: Vec<_> = pulled.iter().map(|i| i.id.as_str()).collect();
    ids.sort_unstable();
    assert_eq!(ids, vec!["cs3-a", "cs3-b", "cs3-c", "cs3-d", "cs3-e"]);
}

// ---------------------------------------------------------------------------
// End-to-end conflict detection (sync-conflict work order)
//
// `conflict_resolution_tests.rs` proves the classifier in isolation. These
// drive the real production entry point — `push_batch` — with payloads
// stamped by `platform_sync::crdt::stamp_payload`, so a regression that
// leaves the classifier correct but unwired still fails here. That gap is
// not hypothetical: `classify` existed for a pass and was never called.
// ---------------------------------------------------------------------------

/// A queue item carrying an arbitrary action and payload.
///
/// Only `action` and `payload` differ from [`sample_item`]; everything else
/// is queue bookkeeping the detector never reads.
fn detection_item(id: &str, action: &str, payload: &str) -> OfflineQueueItem {
    OfflineQueueItem {
        id: id.to_owned(),
        action: action.to_owned(),
        payload: payload.to_owned(),
        ..sample_item(id)
    }
}

/// A money body, in `i64` minor units — never a float.
fn money_body(entity_id: &str, amount_minor: i64) -> String {
    serde_json::json!({ "entity_id": entity_id, "amount_minor": amount_minor }).to_string()
}

/// Two offline terminals redeeming the same gift card must produce a review
/// row, not a silently chosen winner.
///
/// Each terminal advanced only its own counter, so `{t1:1}` and `{t2:1}` are
/// concurrent. Gift cards are [`MergePolicy::NeverAutoMerge`]: redemption is
/// guarded by an atomic conditional UPDATE plus `uq_gift_card_redeem_sale`,
/// and an automatic merge would defeat both.
#[tokio::test]
async fn sqlite_concurrent_gift_card_redemption_is_flagged_end_to_end() {
    let conn = fresh_db();
    let store = SyncStore::sqlite(conn.clone());

    // Stamped by the sender-side helper, so both halves of the seam are
    // exercised: what the daemon puts on the wire is what is classified.
    let first = platform_sync::crdt::stamp_payload(&money_body("gc-1", 5_000), "t1", 1);
    let second = platform_sync::crdt::stamp_payload(&money_body("gc-1", 7_500), "t2", 1);

    store
        .push_batch(
            &[detection_item("gc-a", "gift_card.redeem", &first)],
            "tenant-a",
        )
        .await
        .unwrap();
    store
        .push_batch(
            &[detection_item("gc-b", "gift_card.redeem", &second)],
            "tenant-a",
        )
        .await
        .unwrap();

    let conflicts = store.list_conflicts("tenant-a", None, None).await.unwrap();
    assert_eq!(
        conflicts.len(),
        1,
        "concurrent money writes must be flagged for review"
    );

    let row = &conflicts[0];
    assert_eq!(row.entity_type, "gift_card.redeem");
    assert_eq!(row.entity_id, "gc-1");
    assert_eq!(row.severity, "high");
    assert_eq!(row.status, "open");

    // The stored side is attributed to the terminal that actually wrote it,
    // not to the peer arriving second.
    assert_eq!(row.local_terminal_id, "t1");
    assert_eq!(row.local_vector, r#"{"t1":1}"#);
    assert_eq!(row.remote_vector, r#"{"t2":1}"#);

    // Both bodies are preserved verbatim. They are never summed: combining
    // two redemptions would invent value neither write authorised.
    assert!(row.local_payload.contains("5000"));
    assert!(row.remote_payload.contains("7500"));

    // Tenant scoping survives the whole path.
    assert!(
        store
            .list_conflicts("tenant-b", None, None)
            .await
            .unwrap()
            .is_empty()
    );
}

/// Causally ordered writes are not conflicts, however many terminals take
/// part: each writer here has observed everything before it.
#[tokio::test]
async fn sqlite_causally_ordered_pushes_never_flag() {
    let conn = fresh_db();
    let store = SyncStore::sqlite(conn.clone());

    let sequence = [
        ("o-1", serde_json::json!({ "t1": 1 })),
        ("o-2", serde_json::json!({ "t1": 1, "t2": 1 })),
        ("o-3", serde_json::json!({ "t1": 2, "t2": 1 })),
        ("o-4", serde_json::json!({ "t1": 2, "t2": 3 })),
    ];

    for (id, vector) in sequence {
        let payload = serde_json::json!({
            "entity_id": "gc-2",
            "amount_minor": 1_000,
            "_terminal": "t1",
            "_vector": vector,
        })
        .to_string();
        store
            .push_batch(
                &[detection_item(id, "gift_card.redeem", &payload)],
                "tenant-a",
            )
            .await
            .unwrap();
    }

    assert!(
        store
            .list_conflicts("tenant-a", None, None)
            .await
            .unwrap()
            .is_empty(),
        "a dominated-by chain is ordered, not concurrent"
    );
}

/// A push older than what is stored is dropped without a review row: it adds
/// nothing the server did not already know.
#[tokio::test]
async fn sqlite_stale_push_is_dropped_without_flagging() {
    let conn = fresh_db();
    let store = SyncStore::sqlite(conn.clone());

    let newer = serde_json::json!({ "_terminal": "t1", "_vector": { "t1": 5, "t2": 3 }, "entity_id": "gc-3" }).to_string();
    let older =
        serde_json::json!({ "_terminal": "t1", "_vector": { "t1": 2 }, "entity_id": "gc-3" })
            .to_string();

    store
        .push_batch(
            &[detection_item("s-1", "gift_card.redeem", &newer)],
            "tenant-a",
        )
        .await
        .unwrap();
    store
        .push_batch(
            &[detection_item("s-2", "gift_card.redeem", &older)],
            "tenant-a",
        )
        .await
        .unwrap();

    assert!(
        store
            .list_conflicts("tenant-a", None, None)
            .await
            .unwrap()
            .is_empty()
    );
}

/// Concurrent stock movements auto-merge and need no human: quantities are
/// additive deltas, already reconciled by `resolve_stock_crdt`.
///
/// This pins the policy table from the production path — without it, a
/// classifier hard-wired to flag everything would still pass the gift-card
/// test above.
#[tokio::test]
async fn sqlite_concurrent_stock_movement_auto_merges_without_review_row() {
    let conn = fresh_db();
    let store = SyncStore::sqlite(conn.clone());

    let a = platform_sync::crdt::stamp_payload(r#"{"entity_id":"sku-1","quantity":2}"#, "t1", 1);
    let b = platform_sync::crdt::stamp_payload(r#"{"entity_id":"sku-1","quantity":3}"#, "t2", 1);

    store
        .push_batch(&[detection_item("st-a", "stock.adjusted", &a)], "tenant-a")
        .await
        .unwrap();
    store
        .push_batch(&[detection_item("st-b", "stock.adjusted", &b)], "tenant-a")
        .await
        .unwrap();

    assert!(
        store
            .list_conflicts("tenant-a", None, None)
            .await
            .unwrap()
            .is_empty(),
        "additive stock deltas must not page a human"
    );
}

/// Customer profiles merge only when the two sides touched different fields.
///
/// The stamp fields are metadata, not chosen fields: counting them would put
/// `_vector` and `_terminal` in every intersection and make every customer
/// push a conflict regardless of what the writers actually edited.
#[tokio::test]
async fn sqlite_customer_fields_decide_merge_versus_flag() {
    let conn = fresh_db();
    let store = SyncStore::sqlite(conn.clone());

    let disjoint_a =
        serde_json::json!({ "entity_id": "c-1", "email": "a@x.com", "_terminal": "t1", "_vector": { "t1": 1 } })
            .to_string();
    let disjoint_b =
        serde_json::json!({ "entity_id": "c-1", "phone": "555", "_terminal": "t2", "_vector": { "t2": 1 } })
            .to_string();
    let overlap_a =
        serde_json::json!({ "entity_id": "c-2", "email": "a@x.com", "_terminal": "t1", "_vector": { "t1": 1 } })
            .to_string();
    let overlap_b =
        serde_json::json!({ "entity_id": "c-2", "email": "b@x.com", "_terminal": "t2", "_vector": { "t2": 1 } })
            .to_string();

    for (id, payload) in [
        ("cu-1", &disjoint_a),
        ("cu-2", &disjoint_b),
        ("cu-3", &overlap_a),
        ("cu-4", &overlap_b),
    ] {
        store
            .push_batch(
                &[detection_item(id, "customer.updated", payload)],
                "tenant-a",
            )
            .await
            .unwrap();
    }

    let conflicts = store.list_conflicts("tenant-a", None, None).await.unwrap();
    assert_eq!(conflicts.len(), 1, "only the overlapping pair is ambiguous");
    assert_eq!(conflicts[0].entity_id, "c-2");
    assert_eq!(conflicts[0].severity, "medium");
}

/// A peer that predates vector support is skipped, not guessed at.
#[tokio::test]
async fn sqlite_unstamped_payload_is_skipped_not_flagged() {
    let conn = fresh_db();
    let store = SyncStore::sqlite(conn.clone());

    let legacy = r#"{"entity_id":"gc-4","amount_minor":100}"#;
    let legacy2 = r#"{"entity_id":"gc-4","amount_minor":900}"#;

    store
        .push_batch(
            &[detection_item("lg-1", "gift_card.redeem", legacy)],
            "tenant-a",
        )
        .await
        .unwrap();
    store
        .push_batch(
            &[detection_item("lg-2", "gift_card.redeem", legacy2)],
            "tenant-a",
        )
        .await
        .unwrap();

    assert!(
        store
            .list_conflicts("tenant-a", None, None)
            .await
            .unwrap()
            .is_empty()
    );
}

/// Conflict detection on PostgreSQL — the production backend, and the only
/// one where Row-Level Security applies.
///
/// Every path here touches a table with `tenant_isolation` enabled
/// (`USING`/`WITH CHECK` on `current_setting('oz.tenant_id')`). A missing GUC
/// does NOT raise: reads match nothing and the UPDATE affects zero rows, so
/// the failure mode is a permanently clean review queue, not a 500. SQLite
/// cannot catch any of this — it has no RLS.
///
/// CAVEAT: this test does NOT prove the RLS half. `throwaway_pool` connects
/// as `postgres`, and a superuser bypasses RLS even with FORCE — setting a
/// deliberately wrong tenant still passes here. The RLS behaviour was
/// therefore measured directly, as a non-superuser role given DML on the two
/// tables: with no GUC an INSERT fails with "new row violates row-level
/// security policy" and reads return 0; with `set_config('oz.tenant_id', …,
/// true)` inside the transaction the same INSERT succeeds and the row is
/// visible only to its own tenant (and an UPDATE from another tenant matches
/// 0 rows). What this test proves is that the PG arms execute at all —
/// before it, none of the six methods had ever run against Postgres.
#[tokio::test]
async fn pg_integration_conflict_detection_end_to_end() {
    let Some((pool, db_name)) = throwaway_pool().await else {
        eprintln!("PG conflict detection test skipped: cannot create throwaway DB");
        return;
    };
    let tenant = format!("pg-conflict-{}", uuid::Uuid::now_v7());
    let store = SyncStore::postgres(pool.clone());

    let first = platform_sync::crdt::stamp_payload(&money_body("gc-1", 5_000), "t1", 1);
    let second = platform_sync::crdt::stamp_payload(&money_body("gc-1", 7_500), "t2", 1);

    let id_a = format!("pgc-a-{}", uuid::Uuid::now_v7());
    let id_b = format!("pgc-b-{}", uuid::Uuid::now_v7());
    store
        .push_batch(
            &[detection_item(&id_a, "gift_card.redeem", &first)],
            &tenant,
        )
        .await
        .unwrap();
    store
        .push_batch(
            &[detection_item(&id_b, "gift_card.redeem", &second)],
            &tenant,
        )
        .await
        .unwrap();

    let conflicts = store.list_conflicts(&tenant, None, None).await.unwrap();
    assert_eq!(
        conflicts.len(),
        1,
        "concurrent money writes must be flagged on PG too"
    );
    let row = &conflicts[0];
    assert_eq!(row.entity_id, "gc-1");
    assert_eq!(row.severity, "high");
    assert_eq!(row.status, "open");
    // The stored side is attributed to the terminal that wrote it.
    assert_eq!(row.local_terminal_id, "t1");
    assert_eq!(row.local_vector, r#"{"t1":1}"#);
    assert_eq!(row.remote_vector, r#"{"t2":1}"#);

    // resolve_conflict must actually reach the row: with RLS and no GUC it
    // updates zero rows and reports false for every id.
    assert!(
        store
            .resolve_conflict(&tenant, &row.id, "keep_local", "tester")
            .await
            .unwrap(),
        "resolve must reach the row under RLS"
    );
    assert!(
        store
            .list_conflicts(&tenant, Some("open"), None)
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        store
            .list_conflicts(&tenant, Some("resolved"), None)
            .await
            .unwrap()
            .len(),
        1
    );

    // Another tenant sees nothing.
    assert!(
        store
            .list_conflicts("pg-other-tenant", None, None)
            .await
            .unwrap()
            .is_empty()
    );

    drop(pool);
    let url = std::env::var("OZ_TEST_PG_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:15432/postgres".into());
    let config = tokio_postgres::Config::from_str(&url).unwrap();
    let mgr = deadpool_postgres::Manager::new(config, tokio_postgres::NoTls);
    let admin = deadpool_postgres::Pool::builder(mgr)
        .max_size(1)
        .build()
        .unwrap();
    let client = admin.get().await.unwrap();
    let _ = client
        .batch_execute(&format!("DROP DATABASE IF EXISTS {db_name} WITH (FORCE);"))
        .await;
}

/// A causally ordered chain must NOT flag on PG either.
///
/// This is the counterpart that proves the stored vector is actually being
/// persisted and read back: if `sync_entity_vectors` were unreadable under
/// RLS, every push would look like the first and nothing would ever be
/// concurrent — which is the same "no conflicts" result, reached wrongly.
#[tokio::test]
async fn pg_integration_causally_ordered_pushes_never_flag() {
    let Some((pool, db_name)) = throwaway_pool().await else {
        eprintln!("PG ordered-push test skipped: cannot create throwaway DB");
        return;
    };
    let tenant = format!("pg-ordered-{}", uuid::Uuid::now_v7());
    let store = SyncStore::postgres(pool.clone());

    let sequence = [
        serde_json::json!({ "t1": 1 }),
        serde_json::json!({ "t1": 1, "t2": 1 }),
        serde_json::json!({ "t1": 2, "t2": 1 }),
    ];
    for vector in sequence {
        let payload = serde_json::json!({
            "entity_id": "gc-2",
            "amount_minor": 1_000,
            "_terminal": "t1",
            "_vector": vector,
        })
        .to_string();
        let id = format!("pgc-o-{}", uuid::Uuid::now_v7());
        store
            .push_batch(
                &[detection_item(&id, "gift_card.redeem", &payload)],
                &tenant,
            )
            .await
            .unwrap();
    }

    assert!(
        store
            .list_conflicts(&tenant, None, None)
            .await
            .unwrap()
            .is_empty()
    );

    drop(pool);
    let url = std::env::var("OZ_TEST_PG_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:15432/postgres".into());
    let config = tokio_postgres::Config::from_str(&url).unwrap();
    let mgr = deadpool_postgres::Manager::new(config, tokio_postgres::NoTls);
    let admin = deadpool_postgres::Pool::builder(mgr)
        .max_size(1)
        .build()
        .unwrap();
    let client = admin.get().await.unwrap();
    let _ = client
        .batch_execute(&format!("DROP DATABASE IF EXISTS {db_name} WITH (FORCE);"))
        .await;
}

/// The conflict tables must actually enforce tenant isolation under RLS.
///
/// The other PG tests connect as `postgres`, and a superuser bypasses RLS
/// even with FORCE, so they are structurally unable to see this — including
/// the end-to-end detection test above. This one deliberately drops to a
/// NON-superuser role and measures the same three facts directly: with no
/// `oz.tenant_id` the write is rejected, with it the row is visible only to
/// its own tenant, and another tenant cannot read or update it.
///
/// That is what makes the GUC in the store's PG arms load-bearing, and this
/// is the regression guard for the two lists that must stay in sync:
/// `RLS_TABLES` in scripts/generate-pg-migration.py and the table lists in
/// scripts/rls-cutover.sql. Drift in either is completely silent — the
/// tables just stop being protected, or stop being reachable by `oz_app`,
/// with no compile error and no failing test anywhere else.
#[tokio::test]
async fn pg_integration_conflict_tables_enforce_tenant_isolation() {
    let Some((pool, db_name)) = throwaway_pool().await else {
        eprintln!("PG tenant-isolation test skipped: cannot create throwaway DB");
        return;
    };

    // Roles are cluster-wide, not per-database, so the name must be unique
    // and the role must be dropped explicitly at the end.
    let role = format!("oz_rls_conflict_{}", uuid::Uuid::now_v7().simple());
    let client = pool.get().await.unwrap();
    client
        .batch_execute(&format!(
            "CREATE ROLE {role};
             GRANT USAGE ON SCHEMA public TO {role};
             GRANT SELECT, INSERT, UPDATE, DELETE ON sync_entity_vectors, sync_conflicts TO {role};
             ALTER TABLE sync_entity_vectors FORCE ROW LEVEL SECURITY;
             ALTER TABLE sync_conflicts FORCE ROW LEVEL SECURITY;"
        ))
        .await
        .unwrap();

    // A non-owner role is subject to RLS without any FORCE; the FORCE above
    // mirrors what scripts/rls-cutover.sql applies in production.
    client
        .batch_execute(&format!("SET ROLE {role}"))
        .await
        .unwrap();

    // 1. No GUC — the write is rejected outright rather than silently landing.
    client.batch_execute("BEGIN").await.unwrap();
    let rejected = client
        .execute(
            "INSERT INTO sync_entity_vectors (tenant_id, entity_type, entity_id, vector, last_payload)
             VALUES ('tenant-A','stock.adjusted','sku-1','{}','{}')",
            &[],
        )
        .await;
    assert!(
        rejected.is_err(),
        "a write with no tenant GUC must be rejected by RLS, got {rejected:?}"
    );
    client.batch_execute("ROLLBACK").await.unwrap();

    // 2. GUC set inside the transaction — the write lands and is visible.
    client.batch_execute("BEGIN").await.unwrap();
    client
        .execute("SELECT set_config('oz.tenant_id',$1,true)", &[&"tenant-A"])
        .await
        .unwrap();
    client
        .execute(
            "INSERT INTO sync_entity_vectors (tenant_id, entity_type, entity_id, vector, last_payload)
             VALUES ('tenant-A','stock.adjusted','sku-1','{}','{}')",
            &[],
        )
        .await
        .unwrap();
    let own: i64 = client
        .query_one("SELECT count(*) FROM sync_entity_vectors", &[])
        .await
        .unwrap()
        .get(0);
    assert_eq!(own, 1, "the row must be visible to its own tenant");
    client.batch_execute("COMMIT").await.unwrap();

    // 3. Another tenant sees nothing and cannot modify it.
    client.batch_execute("BEGIN").await.unwrap();
    client
        .execute("SELECT set_config('oz.tenant_id',$1,true)", &[&"tenant-B"])
        .await
        .unwrap();
    let other: i64 = client
        .query_one("SELECT count(*) FROM sync_entity_vectors", &[])
        .await
        .unwrap()
        .get(0);
    assert_eq!(other, 0, "another tenant must not see the row");
    let changed = client
        .execute("UPDATE sync_entity_vectors SET vector = '{}'", &[])
        .await
        .unwrap();
    assert_eq!(changed, 0, "another tenant must not be able to update it");
    client.batch_execute("ROLLBACK").await.unwrap();

    // Restore the login role before the connection returns to the pool,
    // or the next borrower inherits the restricted role.
    client.batch_execute("RESET ROLE").await.unwrap();
    drop(client);

    let admin = pool.get().await.unwrap();
    admin
        .batch_execute(&format!("DROP OWNED BY {role}; DROP ROLE {role};"))
        .await
        .unwrap();
    drop(admin);

    drop(pool);
    let url = std::env::var("OZ_TEST_PG_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:15432/postgres".into());
    let config = tokio_postgres::Config::from_str(&url).unwrap();
    let mgr = deadpool_postgres::Manager::new(config, tokio_postgres::NoTls);
    let cleanup = deadpool_postgres::Pool::builder(mgr)
        .max_size(1)
        .build()
        .unwrap();
    let client = cleanup.get().await.unwrap();
    let _ = client
        .batch_execute(&format!("DROP DATABASE IF EXISTS {db_name} WITH (FORCE);"))
        .await;
}

/// The resolve path on SQLite: records the decision once, then refuses.
///
/// WO2 §2.3 requires the resolve endpoint to be covered. The PG end-to-end
/// test exercises it under RLS, but SQLite — the backend every other store
/// test runs on — had none: `resolve_conflict`'s SQLite arm was never
/// called by any test, so the `AND status = 'open'` guard and the three
/// audit columns were unexercised on it.
#[tokio::test]
async fn sqlite_resolve_conflict_records_the_decision_once() {
    let conn = fresh_db();
    let store = SyncStore::sqlite(conn.clone());

    let first = platform_sync::crdt::stamp_payload(&money_body("gc-9", 1_000), "t1", 1);
    let second = platform_sync::crdt::stamp_payload(&money_body("gc-9", 2_000), "t2", 1);
    store
        .push_batch(
            &[detection_item("rs-a", "gift_card.redeem", &first)],
            "tenant-a",
        )
        .await
        .unwrap();
    store
        .push_batch(
            &[detection_item("rs-b", "gift_card.redeem", &second)],
            "tenant-a",
        )
        .await
        .unwrap();

    let open = store.list_conflicts("tenant-a", None, None).await.unwrap();
    assert_eq!(open.len(), 1);
    let id = open[0].id.clone();
    assert_eq!(open[0].status, "open");

    assert!(
        store
            .resolve_conflict("tenant-a", &id, "keep_local", "alice")
            .await
            .unwrap()
    );

    let resolved = store
        .list_conflicts("tenant-a", Some("resolved"), None)
        .await
        .unwrap();
    assert_eq!(resolved.len(), 1);
    assert_eq!(resolved[0].status, "resolved");
    assert_eq!(resolved[0].resolution.as_deref(), Some("keep_local"));
    assert_eq!(resolved[0].resolved_by.as_deref(), Some("alice"));
    assert!(
        matches!(resolved[0].resolved_at.as_deref(), Some(t) if !t.is_empty()),
        "resolved_at must be stamped, got {:?}",
        resolved[0].resolved_at
    );

    // The open list is now empty…
    assert!(
        store
            .list_conflicts("tenant-a", Some("open"), None)
            .await
            .unwrap()
            .is_empty()
    );

    // …and a second resolve must not overwrite the first decision. The audit
    // trail is the entire point of the row.
    assert!(
        !store
            .resolve_conflict("tenant-a", &id, "keep_remote", "bob")
            .await
            .unwrap(),
        "resolving twice must not silently overwrite the first decision"
    );
    assert_eq!(
        store
            .list_conflicts("tenant-a", Some("resolved"), None)
            .await
            .unwrap()[0]
            .resolution
            .as_deref(),
        Some("keep_local")
    );

    // Another tenant cannot resolve it at all.
    assert!(
        !store
            .resolve_conflict("tenant-b", &id, "keep_remote", "bob")
            .await
            .unwrap()
    );
}
/// C3 S2: the origin must survive the SERVER round trip — push into the
/// offline_queue table, pull it back out. This is the assertion the slice
/// exists for: a column dropped from the server INSERT list makes the value
/// round-trip locally and vanish at the server, which is silent.
#[tokio::test]
async fn sqlite_backend_push_pull_carries_the_origin_terminal() {
    let conn = fresh_db();
    let store = SyncStore::sqlite(conn.clone());

    // Case 1: an item built by the REAL local producer on the CLIENT database,
    // then pushed into the server database — the actual topology, so a column
    // the client writes and the server drops cannot hide. (The origin is set
    // directly because the producer does not write a real one until slice S3.)
    let mut with_origin = {
        let client = fresh_db();
        let client = client.lock().await;
        let mut item = kasirmu_core::Store::new(&client)
            .enqueue_offline_scoped(
                "complete_sale",
                r#"{"total":100}"#,
                "tenant-a",
                SyncPriority::Critical,
            )
            .unwrap();
        item.origin_terminal_id = Some("terminal-abc".into());
        item.created_at = "2026-01-01T00:00:00Z".into();
        item
    };
    assert!(matches!(
        store.push_item(&with_origin, "tenant-a").await.unwrap(),
        PushOutcome::Accepted
    ));

    // Case 2: an item WITHOUT one must come back None — never a default.
    let without_origin = OfflineQueueItem {
        origin_terminal_id: None,
        ..sample_item("origin-unset")
    };
    assert!(matches!(
        store.push_item(&without_origin, "tenant-a").await.unwrap(),
        PushOutcome::Accepted
    ));

    let items = store
        .pull_items("tenant-a", Some("2026-01-01T00:00:00Z"), None, 501)
        .await
        .unwrap();
    assert_eq!(items.len(), 2);

    let set = items.iter().find(|i| i.id == with_origin.id).unwrap();
    assert_eq!(
        set.origin_terminal_id.as_deref(),
        Some("terminal-abc"),
        "the server INSERT must carry the origin column, or it vanishes here"
    );

    let unset = items.iter().find(|i| i.id == "origin-unset").unwrap();
    assert_eq!(unset.origin_terminal_id, None);

    // The stored value is NULL, not an empty string.
    let stored: Option<String> = {
        let conn = conn.lock().await;
        conn.query_row(
            "SELECT origin_terminal_id FROM offline_queue WHERE id = ?1",
            params!["origin-unset"],
            |r| r.get(0),
        )
        .unwrap()
    };
    assert_eq!(stored, None, "an unset origin must be SQL NULL");
}

/// C3 S2: the per-item FALLBACK INSERT in `sync_store.rs` is a second,
/// separate column list from the multirow fast path. It only runs when the
/// fast path's statement fails, so nothing else exercises it — and a column
/// dropped there would silently lose the origin for exactly the batches that
/// took the fallback.
///
/// A trigger that raises on ONE id makes the multirow statement fail, so the
/// batch drops to the per-item loop, and the surviving items prove the
/// fallback carries the origin column.
#[tokio::test]
async fn sqlite_push_batch_fallback_carries_the_origin_terminal() {
    let conn = fresh_db();
    let store = SyncStore::sqlite(conn.clone());

    // Poison exactly one id: the multirow statement fails, the fallback runs.
    {
        let conn = conn.lock().await;
        conn.execute_batch(
            "CREATE TRIGGER poison_one BEFORE INSERT ON offline_queue
             WHEN NEW.id = 'fallback-poison'
             BEGIN SELECT RAISE(ABORT, 'poisoned for the fallback test'); END;",
        )
        .unwrap();
    }

    let batch = vec![
        OfflineQueueItem {
            origin_terminal_id: Some("fallback-terminal".into()),
            ..sample_item("fallback-ok")
        },
        sample_item("fallback-poison"),
    ];
    let outcomes = store.push_batch(&batch, "tenant-fallback").await.unwrap();
    assert_eq!(outcomes.len(), 2);
    assert!(matches!(outcomes[0], PushOutcome::Accepted));
    assert!(matches!(&outcomes[1], PushOutcome::Rejected { .. }));

    let pulled = store
        .pull_items("tenant-fallback", Some("2026-01-01T00:00:00Z"), None, 501)
        .await
        .unwrap();
    assert_eq!(pulled.len(), 1, "only the unpoisoned item lands");
    assert_eq!(
        pulled[0].origin_terminal_id.as_deref(),
        Some("fallback-terminal"),
        "the per-item fallback INSERT must carry the origin column too"
    );
}
