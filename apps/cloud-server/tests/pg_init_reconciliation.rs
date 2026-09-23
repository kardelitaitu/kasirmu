//! PostgreSQL init-time verification of the C38 pre-index reconciliation.
//!
//! The SQLite migration 20261011_open_shift_uniqueness.sql closes every open
//! shift but the newest for a user BEFORE it creates
//! idx_shifts_open_per_user, so the CREATE cannot fail on a database that
//! already holds a duplicate. Its own header says why the halves must travel
//! together: "the index without its reconciliation is exactly the
//! startup-bricking shape this file exists to prevent".
//!
//! The generator drops every DML statement in the migration chain (measured:
//! the generated PG file contained ZERO UPDATE statements while seven
//! migrations carry one), so the PG twin carried the bare index and a
//! PostgreSQL database holding two open shifts for one user FAILED AT INIT.
//! C38 added PRE_INDEX_RECONCILIATIONS to emit the repair first; this test is
//! the evidence its verified_by field names.
//!
//! Both directions, because one alone is worthless here:
//!
//! * a fresh database initialised from the generated file carries the index
//!   (the reconciliation is a guarded no-op where there is nothing to close);
//! * a database SEEDED with two open shifts for one user initialises
//!   successfully AND the older row is actually closed — the strong form,
//!   since a fresh database has no duplicate to prove the UPDATE ran on.
//!
//! House standard: a reachable run prints a PROVEN line and no skip line; the
//! control run against a dead port prints the skip line instead.
//!
//! Isolation: one throwaway database per test (oz_init_recon_test_%), never
//! the shared schema, roles, RLS or rls-cutover.sql.

/// Connect to the admin database, or None when PostgreSQL is unreachable.
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

/// Create an EMPTY throwaway database (no schema applied) and return a client.
///
/// Deliberately not applying PG_INIT here: each test decides when to run it,
/// because the point is to seed rows BEFORE init and prove init still works.
async fn empty_throwaway_db() -> Option<(tokio_postgres::Client, String)> {
    let (admin, config) = admin_client().await?;

    if let Ok(rows) = admin
        .query(
            "SELECT datname FROM pg_database WHERE datname LIKE 'oz_init_recon_test_%'",
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

    let db_name = format!(
        "oz_init_recon_test_{}_{}",
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
    Some((client, db_name))
}

async fn drop_throwaway(db_name: &str) {
    if let Some((admin, _)) = admin_client().await {
        let _ = admin
            .batch_execute(&format!("DROP DATABASE IF EXISTS {db_name} WITH (FORCE);"))
            .await;
    }
}

/// Does the guard index exist in this database?
async fn index_exists(client: &tokio_postgres::Client) -> bool {
    client
        .query_one(
            "SELECT COUNT(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_shifts_open_per_user'",
            &[],
        )
        .await
        .expect("pg_indexes query")
        .get::<_, i64>(0)
        > 0
}

/// (1) A fresh database initialised from the generated file carries the index.
#[tokio::test]
async fn pg_init_on_a_fresh_database_creates_the_open_shift_index() {
    let Some((client, db_name)) = empty_throwaway_db().await else {
        eprintln!("SKIP: PostgreSQL unreachable — set OZ_TEST_PG_URL to run the fresh-init case");
        return;
    };

    client
        .batch_execute(kasirmu_core::migrations::PG_INIT)
        .await
        .expect("PG_INIT must apply to a fresh database");

    assert!(
        index_exists(&client).await,
        "the guard index must exist after a fresh init"
    );

    eprintln!("PROVEN: fresh PG init carries idx_shifts_open_per_user");
    drop(client);
    drop_throwaway(&db_name).await;
}

/// (2) THE STRONG FORM: seed the duplicate, then init — which must SUCCEED and
/// actually CLOSE the older open shift.
///
/// Before C38 this init failed outright: the generated file created the unique
/// index with no preceding repair.
#[tokio::test]
async fn pg_init_survives_and_reconciles_a_seeded_duplicate_open_shift() {
    let Some((client, db_name)) = empty_throwaway_db().await else {
        eprintln!("SKIP: PostgreSQL unreachable — set OZ_TEST_PG_URL to run the duplicate case");
        return;
    };

    // Seed the PRE-C38 state by hand: just enough schema for two open shifts to
    // coexist, which is what a PostgreSQL database written by any other means
    // (a console session, a repair script, a migration) could hold. The index
    // does not exist yet, so both rows are accepted.
    client
        .batch_execute(
            "CREATE TABLE shifts (
                 id                    TEXT PRIMARY KEY,
                 user_id               TEXT NOT NULL,
                 terminal_id           TEXT,
                 opened_at             TEXT NOT NULL,
                 closed_at             TEXT,
                 opening_balance_minor BIGINT NOT NULL DEFAULT 0,
                 closing_balance_minor BIGINT,
                 expected_cash_minor   BIGINT,
                 cash_difference_minor BIGINT,
                 total_sales_minor     BIGINT NOT NULL DEFAULT 0,
                 total_cash_minor      BIGINT NOT NULL DEFAULT 0,
                 total_card_minor      BIGINT NOT NULL DEFAULT 0,
                 total_other_minor     BIGINT NOT NULL DEFAULT 0,
                 total_voids_minor     BIGINT NOT NULL DEFAULT 0,
                 total_refunds_minor   BIGINT NOT NULL DEFAULT 0,
                 notes                 TEXT NOT NULL DEFAULT '',
                 status                TEXT NOT NULL DEFAULT 'open',
                 created_at            TEXT NOT NULL DEFAULT '',
                 updated_at            TEXT NOT NULL DEFAULT '',
                 total_payouts_minor   BIGINT NOT NULL DEFAULT 0
             );
             INSERT INTO shifts (id, user_id, opened_at, notes, status)
             VALUES ('shift-old', 'user-dup', '2026-01-01T08:00:00.000Z', '', 'open'),
                    ('shift-new', 'user-dup', '2026-01-01T12:00:00.000Z', '', 'open');",
        )
        .await
        .expect("seed the duplicate-open-shift state");

    // THE ASSERTION THAT WOULD HAVE FAILED BEFORE C38: init must succeed.
    client
        .batch_execute(kasirmu_core::migrations::PG_INIT)
        .await
        .expect(
            "PG_INIT must succeed on a database holding two open shifts for one user —              the pre-index reconciliation is what makes the unique index applicable",
        );

    assert!(
        index_exists(&client).await,
        "the guard index must now exist"
    );

    // The reconciliation RAN: the older row is closed, the newest survives.
    let closed: i64 = client
        .query_one(
            "SELECT COUNT(*) FROM shifts WHERE id = 'shift-old' AND status = 'closed'",
            &[],
        )
        .await
        .expect("query the reconciled row")
        .get(0);
    assert_eq!(
        closed, 1,
        "the older duplicate must be CLOSED by the reconciliation"
    );
    let note: String = client
        .query_one("SELECT notes FROM shifts WHERE id = 'shift-old'", &[])
        .await
        .expect("read the reconciliation note")
        .get(0);
    assert!(
        note.contains("auto-closed: duplicate open shift"),
        "the reconciliation must stamp its own note, got: {note:?}"
    );
    let survivor: String = client
        .query_one("SELECT id FROM shifts WHERE status = 'open'", &[])
        .await
        .expect("exactly one open shift must remain")
        .get(0);
    assert_eq!(
        survivor, "shift-new",
        "the MOST RECENTLY opened row survives"
    );

    eprintln!("PROVEN: seeded duplicate reconciled by PG init (index created, older row closed)");
    drop(client);
    drop_throwaway(&db_name).await;
}
