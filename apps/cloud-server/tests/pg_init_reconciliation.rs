//! PostgreSQL init-time verification of the C38 pre-index reconciliation and
//! the C46 table backfills.
//!
//! C46: the generator drops every DML statement in the migration chain, so six
//! backfills the SQLite chain performed never reached an EXISTING PostgreSQL
//! database. C46 measured all six and ported the ONE that unambiguously
//! matters — 20260910_memo_child_tenant_id.sql — because memo_recipients has a
//! live PG writer (crates/kasirmu-api/src/pg.rs:2621, the memo fan-out) AND is
//! in RLS_TABLES, so its tenant_id is a live isolation key: a pre-migration row
//! carries the DEFAULT 'default' and is invisible to the correct tenant. The
//! other five are recorded as unmatterable in the RECONCILIATIONS comment,
//! each with its reason.
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
/// C46 STRONG FORM: a pre-migration `memo_recipients` row (tenant_id still at
/// its DEFAULT 'default') must be repaired to its owning memo's tenant by
/// PG_INIT.
///
/// This is the only one of the six C46 backfills with a live PostgreSQL writer
/// AND RLS membership, so it is the only one where the missing port is a real
/// isolation defect rather than dormant surface: the row belongs to a
/// non-default tenant but carries 'default', and RLS filters on tenant_id.
///
/// Seeding the pre-migration state is the point. A fresh database has no such
/// row, so asserting a no-op would prove nothing.
#[tokio::test]
async fn pg_init_backfills_a_pre_migration_memo_recipient_tenant() {
    let Some((client, db_name)) = empty_throwaway_db().await else {
        eprintln!(
            "SKIP: PostgreSQL unreachable — set OZ_TEST_PG_URL to run the memo backfill case"
        );
        return;
    };

    // The pre-migration shape: memo_recipients WITHOUT tenant_id, holding a row
    // that belongs to tenant 'acme'. Enough of the surrounding schema for the
    // backfill's join to resolve; PG_INIT then converges everything else.
    client
        .batch_execute(
            "CREATE TABLE terminals (
                 id TEXT PRIMARY KEY,
                 name TEXT NOT NULL,
                 device_id TEXT NOT NULL UNIQUE
             );
             CREATE TABLE memos (
                 id         TEXT PRIMARY KEY,
                 tenant_id  TEXT NOT NULL,
                 title      TEXT NOT NULL,
                 body       TEXT NOT NULL
             );
             CREATE TABLE memo_recipients (
                 id              TEXT PRIMARY KEY,
                 memo_id         TEXT NOT NULL,
                 terminal_id     TEXT NOT NULL,
                 delivery_status TEXT NOT NULL DEFAULT 'pending',
                 UNIQUE (memo_id, terminal_id)
             );
             INSERT INTO terminals (id, name, device_id) VALUES ('term-1', 'T1', 'dev-1');
             INSERT INTO memos (id, tenant_id, title, body)
             VALUES ('memo-1', 'acme', 'Closing', 'Count the drawer');
             INSERT INTO memo_recipients (id, memo_id, terminal_id)
             VALUES ('rec-1', 'memo-1', 'term-1');",
        )
        .await
        .expect("seed the pre-migration memo_recipients state");

    // PG_INIT must apply (it adds tenant_id via the column reconciliation) and
    // the backfill must repair the row.
    client
        .batch_execute(kasirmu_core::migrations::PG_INIT)
        .await
        .expect("PG_INIT must apply over the pre-migration memo_recipients table");

    let tenant: String = client
        .query_one(
            "SELECT tenant_id FROM memo_recipients WHERE id = 'rec-1'",
            &[],
        )
        .await
        .expect("the recipient row must survive the migration")
        .get(0);
    assert_eq!(
        tenant, "acme",
        "the backfill must stamp the OWNING memo's tenant, not the 'default' column default — a 'default' here hides the row from its real tenant under RLS"
    );

    eprintln!("PROVEN: pre-migration memo_recipients row backfilled to its memo tenant");
    drop(client);
    drop_throwaway(&db_name).await;
}
