//! Real-PostgreSQL execution of the C10b negative-stock guard (C42).
//!
//! The SQLite half of this guard is proven by
//! kasirmu_core::migrations::tests::stock_summary_negative_guard_is_conditional_on_the_binding.
//! The Postgres half is a HAND-WRITTEN plpgsql port in
//! scripts/generate-pg-migration.py (TRIGGER_MAP), carried into
//! 20260813_init.pg.sql by the generator. Nothing executed it: its correctness
//! rested on the generator's trigger parity check and on resembling the tested
//! SQLite predicate. A hand-written port of a tested predicate is exactly the
//! artifact that reads correct and behaves differently — and this one decides
//! whether a store may go negative.
//!
//! This test closes that gap by driving the REAL plpgsql trigger through raw
//! SQL in a THROWAWAY database, case for case against the SQLite predicate:
//!
//! * a negative qty at a BOUND NON-OPTED-IN location is REFUSED;
//! * the same qty at an OPTED-IN binding is ACCEPTED, including through the
//!   INSERT ... ON CONFLICT DO UPDATE upsert — the shape both writers use,
//!   which fires only the UPDATE arm once the row exists;
//! * an UNBOUND location is ACCEPTED, matching the refined predicate (the flag
//!   is a per-BINDING opt-out, so an unbound location has none to violate).
//!
//! House standard (inherited from the sibling PG slice): a green run must be
//! SHOWN to have run rather than skipped. The reachable run prints a PROVEN
//! marker and no skip line; the control run against a dead port prints the
//! skip line instead. Never read a bare ok here as coverage.
//!
//! Isolation: a throwaway database per run (oz_stock_guard_test_%), the same
//! pattern src/sync_store_tests.rs::throwaway_pool uses and for the same reason
//! (concurrent PG_INIT DDL deadlocks on a shared base DB). The shared schema,
//! roles and RLS posture are never touched.

/// Connect to the admin database, returning the client and the config it came
/// from, or None when PostgreSQL is unreachable (the caller then SKIPS loudly).
async fn admin_client() -> Option<(tokio_postgres::Client, tokio_postgres::Config)> {
    let url = std::env::var("OZ_TEST_PG_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:15432/postgres".into());
    let config = url.parse::<tokio_postgres::Config>().ok()?;
    let (client, connection) = config.connect(tokio_postgres::NoTls).await.ok()?;
    tokio::spawn(async move {
        let _ = connection.await;
    });
    Some((client, config))
}

/// Create a throwaway database, apply PG_INIT, and return a client to it.
async fn throwaway_db() -> Option<(tokio_postgres::Client, String)> {
    let (admin, config) = admin_client().await?;

    // Clean up throwaway DBs left by crashed runs. The prefix is this test's
    // own, so it can never drop the sync suite's databases.
    if let Ok(rows) = admin
        .query(
            "SELECT datname FROM pg_database WHERE datname LIKE 'oz_stock_guard_test_%'",
            &[],
        )
        .await
    {
        for row in rows {
            let name: String = row.get(0);
            let _ = admin
                .batch_execute(&format!("DROP DATABASE IF EXISTS {name} WITH (FORCE);"))
                .await;
        }
    }

    // simple() (hex only): the name is interpolated as an unquoted identifier,
    // and UUID Display hyphens would make CREATE DATABASE a syntax error — the
    // sibling slice hit exactly that and silently skipped every PG test.
    let db_name = format!(
        "oz_stock_guard_test_{}_{}",
        std::process::id(),
        uuid::Uuid::now_v7().simple()
    );
    if admin
        .execute(&format!("CREATE DATABASE {db_name}"), &[])
        .await
        .is_err()
    {
        eprintln!("SKIP: could not CREATE DATABASE {db_name} (insufficient privileges?)");
        return None;
    }
    drop(admin);

    let mut db_config = config;
    db_config.dbname(&db_name);
    let (client, connection) = db_config.connect(tokio_postgres::NoTls).await.ok()?;
    tokio::spawn(async move {
        let _ = connection.await;
    });

    if let Err(e) = client
        .batch_execute(kasirmu_core::migrations::PG_INIT)
        .await
    {
        eprintln!("SKIP: could not apply PG_INIT to {db_name}: {e}");
        return None;
    }

    Some((client, db_name))
}

/// Drop the throwaway database. Called on the happy path; a crash leaves it for
/// the next run's stale-cleanup pass.
async fn drop_throwaway(db_name: &str) {
    if let Some((admin, _)) = admin_client().await {
        let _ = admin
            .batch_execute(&format!("DROP DATABASE IF EXISTS {db_name} WITH (FORCE);"))
            .await;
    }
}

/// Seed a product plus three inventory locations: bound-without-opt-in,
/// bound-with-opt-in, and unbound. Returns (bound_no, bound_yes, unbound).
async fn seed_fixture(client: &tokio_postgres::Client) -> (String, String, String) {
    let bound_no = "loc-c42-no".to_string();
    let bound_yes = "loc-c42-yes".to_string();
    let unbound = "loc-c42-unbound".to_string();

    client
        .batch_execute(
            "INSERT INTO products (id, sku, name, price_minor, currency, product_type) VALUES ('prod-c42', 'SKU-C42', 'C42', 100, 'USD', 'retail');",
        )
        .await
        .expect("product fixture");

    client
        .batch_execute(
            "INSERT INTO inventory_locations (id, name) VALUES ('loc-c42-no', 'Bound No'), ('loc-c42-yes', 'Bound Yes'), ('loc-c42-unbound', 'Unbound');",
        )
        .await
        .expect("inventory_locations fixture");

    // A workspace instance: its location_id is the STORE profile (a NOT NULL
    // FK), not an inventory location. 'store-pos' is seeded by PG_INIT.
    client
        .batch_execute("INSERT INTO locations (id, name) VALUES ('loc-c42-site', 'C42 Site');")
        .await
        .expect("locations fixture");
    client
        .batch_execute(
            "INSERT INTO workspace_instances (id, type_key, location_id, name) VALUES ('ws-c42', 'store-pos', 'loc-c42-site', 'C42');",
        )
        .await
        .expect("workspace_instances fixture");

    // One binding per bound location: the first does NOT opt in, the second
    // does. The unbound location gets NO row here — that absence is the case.
    client
        .batch_execute(
            "INSERT INTO workspace_inventory_locations (id, instance_id, location_id, is_primary, allow_negative_stock, sort_order) VALUES ('wil-c42-no', 'ws-c42', 'loc-c42-no', 0, 0, 0), ('wil-c42-yes', 'ws-c42', 'loc-c42-yes', 0, 1, 1);",
        )
        .await
        .expect("workspace_inventory_locations fixture");

    (bound_no, bound_yes, unbound)
}

/// The three cases, case for case against the tested SQLite predicate.
#[tokio::test]
async fn pg_stock_summary_negative_guard_matches_the_sqlite_predicate() {
    let Some((client, db_name)) = throwaway_db().await else {
        eprintln!("SKIP: PostgreSQL unreachable — set OZ_TEST_PG_URL to run this");
        return;
    };
    eprintln!("PROVEN: executing the plpgsql port against real PostgreSQL (db {db_name})");

    let (bound_no, bound_yes, unbound) = seed_fixture(&client).await;

    const INSERT_NEGATIVE: &str =
        "INSERT INTO stock_summary (item_id, location_id, qty) VALUES ('prod-c42', $1, $2)";

    // -- Direction 1: the backstop BITES on a binding that did not opt in. --
    let err = client
        .execute(INSERT_NEGATIVE, &[&bound_no, &-3i64])
        .await
        .expect_err("a negative qty at a non-opted-in binding must be refused by the TRIGGER");
    // tokio-postgres Error Display is the generic "db error"; the real message
    // (and the SQLSTATE) live on the DbError — the same trap sync_store/pg.rs
    // documents. Asserting on Display would pass on ANY failure, including the
    // wrong one, so the guard's own words are what is read here.
    let db_err = err
        .as_db_error()
        .unwrap_or_else(|| panic!("expected a database error, got: {err}"));
    let msg = db_err.message().to_owned();
    assert!(
        msg.contains("allow_negative_stock"),
        "the refusal must come from the guard and name the flag, got: {msg}"
    );
    assert_eq!(
        db_err.code(),
        &tokio_postgres::error::SqlState::RAISE_EXCEPTION,
        "the refusal must be the plpgsql RAISE, not some other constraint, got: {msg}"
    );

    // The UPDATE arm: seed a non-negative row, then drive it below zero. This
    // is the INSERT ... ON CONFLICT DO UPDATE shape both writers use.
    client
        .execute(INSERT_NEGATIVE, &[&bound_no, &1i64])
        .await
        .expect("a non-negative qty is always allowed");
    let err = client
        .execute(
            "UPDATE stock_summary SET qty = -1 WHERE item_id = 'prod-c42' AND location_id = $1",
            &[&bound_no],
        )
        .await
        .expect_err("driving an existing row below zero must be refused by the UPDATE arm");
    let update_msg = err
        .as_db_error()
        .map(|d| d.message().to_owned())
        .unwrap_or_else(|| err.to_string());
    assert!(
        update_msg.contains("allow_negative_stock"),
        "the UPDATE arm must give the same refusal, got: {update_msg}"
    );

    // -- Direction 2: the feature still works. --
    client
        .execute(INSERT_NEGATIVE, &[&bound_yes, &-3i64])
        .await
        .expect("a binding that opted in must still be able to hold negative stock");

    // ...including through the upsert, which fires only the UPDATE arm.
    client
        .execute(
            "INSERT INTO stock_summary (item_id, location_id, qty) VALUES ('prod-c42', $1, -9) ON CONFLICT (item_id, location_id) DO UPDATE SET qty = excluded.qty",
            &[&bound_yes],
        )
        .await
        .expect("the opted-in upsert must pass");
    let stored: i64 = client
        .query_one(
            "SELECT qty FROM stock_summary WHERE item_id = 'prod-c42' AND location_id = $1",
            &[&bound_yes],
        )
        .await
        .expect("read back the opted-in row")
        .get(0);
    assert_eq!(stored, -9, "the opted-in value must be stored verbatim");

    // -- The refinement: no binding means no opt-out to violate. --
    client
        .execute(INSERT_NEGATIVE, &[&unbound, &-3i64])
        .await
        .expect(
            "a location with NO binding has no opt-out to violate; refusing here would diverge from the tested SQLite predicate",
        );

    // Prove the guard is CONDITIONAL in the port too: the unbound location
    // really did store the negative, so no blanket CHECK rode along.
    let unbound_qty: i64 = client
        .query_one(
            "SELECT qty FROM stock_summary WHERE item_id = 'prod-c42' AND location_id = $1",
            &[&unbound],
        )
        .await
        .expect("the unbound row must exist")
        .get(0);
    assert_eq!(unbound_qty, -3);

    drop(client);
    drop_throwaway(&db_name).await;
}
