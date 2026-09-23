//! Real-PostgreSQL execution of the SIX remaining trigger ports (C44).
//!
//! scripts/generate-pg-migration.py carries every conditional constraint into
//! PostgreSQL through a HAND-WRITTEN plpgsql port in TRIGGER_MAP. Of its seven
//! entries only stock_summary_qty_nonnegative_* (C42) named a test that
//! EXECUTES the plpgsql against real PostgreSQL; the other six named
//! SQLite-side tests, which pin the SQLITE trigger and never run the port at
//! all. A hand-written port that has never executed is exactly the artifact
//! this workstream has found wrong four times, and the C43 body digest cannot
//! help: it detects that a body CHANGED, never that it was wrong from the
//! start.
//!
//! This file closes that gap: each test drives the REAL plpgsql trigger
//! through raw SQL in a THROWAWAY database, in both directions where the
//! trigger is conditional, and asserts on the driver's STRUCTURED error
//! (as_db_error().message() plus SQLSTATE) rather than on Display — Display is
//! the generic "db error" and would pass on any failure, including the wrong
//! one. That was a real defect in the C42 test, caught before it shipped.
//!
//! House standard: a reachable run prints a PROVEN line per port and no skip
//! line; the control run against a dead port prints the skip lines instead.
//! Never read a bare ok here as coverage.
//!
//! Isolation: one throwaway database per test (oz_trigger_ports_test_%), the
//! same pattern src/sync_store_tests.rs::throwaway_pool uses and for the same
//! reason (concurrent PG_INIT DDL deadlocks on a shared base DB). The shared
//! schema, roles, RLS posture and rls-cutover.sql are never touched.

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

    // Clean up throwaway DBs left by crashed runs. The prefix is this file's
    // own, so it can never drop another suite's databases.
    if let Ok(rows) = admin
        .query(
            "SELECT datname FROM pg_database WHERE datname LIKE 'oz_trigger_ports_test_%'",
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
    // and UUID Display hyphens would make CREATE DATABASE a syntax error.
    let db_name = format!(
        "oz_trigger_ports_test_{}_{}",
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

/// Assert a statement was REFUSED by the plpgsql RAISE, and by nothing else.
///
/// Reads the STRUCTURED error: the generic Display of a tokio_postgres Error is
/// "db error", which would let a NOT NULL violation, a type error or a missing
/// table satisfy a naive is_err()/contains assertion.
#[track_caller]
fn assert_refused(err: tokio_postgres::Error, needle: &str, what: &str) {
    let db = err.as_db_error().unwrap_or_else(|| {
        panic!("{what}: expected a database error from the trigger, got: {err}")
    });
    assert!(
        db.message().contains(needle),
        "{what}: expected the guard message to contain {needle:?}, got {:?}",
        db.message()
    );
    assert_eq!(
        db.code(),
        &tokio_postgres::error::SqlState::RAISE_EXCEPTION,
        "{what}: expected the plpgsql RAISE (P0001), got {:?} — a different          constraint fired, so the port own predicate was never reached",
        db.code()
    );
}

/// Open a throwaway database for one port, or print the skip line and return
/// None. Shared so every test reports identically.
async fn harness(port: &str) -> Option<(tokio_postgres::Client, String)> {
    let Some((client, db_name)) = throwaway_db().await else {
        eprintln!("SKIP: PostgreSQL unreachable — set OZ_TEST_PG_URL to run {port}");
        return None;
    };
    Some((client, db_name))
}

/// Seed a role and a user, returning nothing (assignments FK targets).
async fn seed_user(client: &tokio_postgres::Client, user: &str) {
    client
        .batch_execute(
            "INSERT INTO roles (id, name) VALUES ('role-c44', 'c44-role') ON CONFLICT DO NOTHING",
        )
        .await
        .expect("roles fixture");
    client
        .execute(
            "INSERT INTO users (id, username, pin_hash, display_name, role_id)              VALUES ($1, $1, 'x', 'C44', 'role-c44')",
            &[&user],
        )
        .await
        .expect("users fixture");
}

// ── audit_log_immutable_delete ────────────────────────────────────────────
//
// SQLite (20260920_audit_retention.sql:25-34): BEFORE DELETE, WHEN NOT EXISTS
// (the sweep marker in settings) -> RAISE(ABORT). When the marker IS present
// the WHEN clause is false, the trigger body never runs, and the DELETE
// PROCEEDS — that is the whole point of the retention carve-out.
#[tokio::test]
async fn pg_audit_log_delete_port_matches_sqlite() {
    let Some((client, db_name)) = harness("audit_log_immutable_delete").await else {
        return;
    };

    client
        .batch_execute(
            "INSERT INTO audit_log (id, user_id, action, outcome) VALUES ('aud-c44', 'u1', 'sale.void', 'success')",
        )
        .await
        .expect("audit_log fixture");

    // Direction 1: no marker -> the DELETE must be REFUSED.
    let err = client
        .execute("DELETE FROM audit_log WHERE id = 'aud-c44'", &[])
        .await
        .expect_err("a DELETE without the sweep marker must be refused");
    assert_refused(err, "immutable", "audit delete without marker");

    // Direction 2: with the marker present the DELETE must SUCCEED.
    //
    // THIS IS WHERE THE PORT DIVERGED: a BEFORE DELETE trigger that returns
    // NULL CANCELS the delete, so RETURN NULL made the retention sweep delete
    // nothing while reporting success — a compliance failure that raises no
    // error anywhere. SQLite WHEN-clause triggers do nothing when the WHEN is
    // false, so the row is deleted there.
    client
        .batch_execute("INSERT INTO settings (key) VALUES ('audit.retention_sweep_active')")
        .await
        .expect("sweep marker fixture");
    let deleted = client
        .execute("DELETE FROM audit_log WHERE id = 'aud-c44'", &[])
        .await
        .expect("with the sweep marker the carve-out must permit the DELETE");
    assert_eq!(
        deleted, 1,
        "the carve-out must actually DELETE the row; a BEFORE DELETE trigger          returning NULL silently cancels it"
    );

    let left: i64 = client
        .query_one("SELECT COUNT(*) FROM audit_log WHERE id = 'aud-c44'", &[])
        .await
        .expect("count")
        .get(0);
    assert_eq!(left, 0, "the swept row must be gone");

    eprintln!("PROVEN: audit_log_immutable_delete (both directions)");
    drop(client);
    drop_throwaway(&db_name).await;
}

// ── audit_log_immutable_update ────────────────────────────────────────────
//
// SQLite: BEFORE UPDATE, RAISE(ABORT) unconditionally — no carve-out, no
// anonymization path. The port must refuse every UPDATE.
#[tokio::test]
async fn pg_audit_log_update_port_matches_sqlite() {
    let Some((client, db_name)) = harness("audit_log_immutable_update").await else {
        return;
    };

    client
        .batch_execute(
            "INSERT INTO audit_log (id, user_id, action, outcome) VALUES ('aud-c44u', 'u1', 'sale.void', 'success')",
        )
        .await
        .expect("audit_log fixture");

    let err = client
        .execute(
            "UPDATE audit_log SET action = 'hacked' WHERE id = 'aud-c44u'",
            &[],
        )
        .await
        .expect_err("an UPDATE must be refused unconditionally");
    assert_refused(err, "immutable", "audit update");

    // The row survives unchanged — a BEFORE UPDATE trigger that raised cannot
    // have mutated it.
    let action: String = client
        .query_one("SELECT action FROM audit_log WHERE id = 'aud-c44u'", &[])
        .await
        .expect("row must survive")
        .get(0);
    assert_eq!(
        action, "sale.void",
        "the refused UPDATE must not mutate the row"
    );

    // Even with the sweep marker set, UPDATE stays immutable (the carve-out is
    // DELETE-only in SQLite too).
    client
        .batch_execute("INSERT INTO settings (key) VALUES ('audit.retention_sweep_active')")
        .await
        .expect("sweep marker fixture");
    let err = client
        .execute(
            "UPDATE audit_log SET action = 'swept' WHERE id = 'aud-c44u'",
            &[],
        )
        .await
        .expect_err("the sweep marker must NOT open an UPDATE path");
    assert_refused(err, "immutable", "audit update under the sweep marker");

    eprintln!("PROVEN: audit_log_immutable_update (unconditional refusal)");
    drop(client);
    drop_throwaway(&db_name).await;
}

// ── loyalty_tiers_validate_insert ─────────────────────────────────────────
//
// SQLite (20260831_loyalty_multiplier_fixedpoint.sql:40-51): BEFORE INSERT,
// WHEN trim(name)='' OR min_points<0 OR points_per_unit<=0 OR
// earn_multiplier_millionths<=0 OR length(colour)<>7 OR first char not '#'
// OR the rest has a non-hex char -> RAISE(ABORT).
#[tokio::test]
async fn pg_loyalty_tiers_insert_port_matches_sqlite() {
    let Some((client, db_name)) = harness("loyalty_tiers_validate_insert").await else {
        return;
    };

    // Direction 1: a well-formed tier is ACCEPTED.
    client
        .batch_execute(
            "INSERT INTO loyalty_tiers (id, name, min_points, points_per_unit, earn_multiplier_millionths, colour)              VALUES ('t-ok', 'Gold', 100, 10, 1250000, '#6b7280')",
        )
        .await
        .expect("a valid tier must be accepted");

    // Direction 2: each invalid shape is REFUSED.
    let cases = [
        (
            "zero multiplier",
            "INSERT INTO loyalty_tiers (id, name, earn_multiplier_millionths) VALUES ('t-zero-mult', 'Bad', 0)",
        ),
        (
            "blank name",
            "INSERT INTO loyalty_tiers (id, name) VALUES ('t-blank-name', '   ')",
        ),
        (
            "negative min_points",
            "INSERT INTO loyalty_tiers (id, name, min_points) VALUES ('t-neg-points', 'Bad', -1)",
        ),
        (
            "zero points_per_unit",
            "INSERT INTO loyalty_tiers (id, name, points_per_unit) VALUES ('t-zero-ppu', 'Bad', 0)",
        ),
        (
            "short colour",
            "INSERT INTO loyalty_tiers (id, name, colour) VALUES ('t-bad-colour-len', 'Bad', '#fff')",
        ),
        (
            "non-hex colour",
            "INSERT INTO loyalty_tiers (id, name, colour) VALUES ('t-bad-colour-hex', 'Bad', '#12345g')",
        ),
    ];
    for (label, sql) in cases {
        let err = client
            .execute(sql, &[])
            .await
            .expect_err(&format!("{label} must be refused"));
        assert_refused(
            err,
            "invalid loyalty tier",
            &format!("loyalty insert: {label}"),
        );
    }

    eprintln!("PROVEN: loyalty_tiers_validate_insert (valid accepted, six invalid shapes refused)");
    drop(client);
    drop_throwaway(&db_name).await;
}

// ── loyalty_tiers_validate_update ─────────────────────────────────────────
//
// SQLite: BEFORE UPDATE OF name, min_points, points_per_unit,
// earn_multiplier_millionths, colour — the same predicate, on the update arm.
#[tokio::test]
async fn pg_loyalty_tiers_update_port_matches_sqlite() {
    let Some((client, db_name)) = harness("loyalty_tiers_validate_update").await else {
        return;
    };

    client
        .batch_execute(
            "INSERT INTO loyalty_tiers (id, name, min_points, points_per_unit, earn_multiplier_millionths, colour)              VALUES ('t-upd', 'Gold', 100, 10, 1250000, '#6b7280')",
        )
        .await
        .expect("tier fixture");

    // Direction 1: a valid update is ACCEPTED (and lands).
    client
        .execute(
            "UPDATE loyalty_tiers SET min_points = 250 WHERE id = 't-upd'",
            &[],
        )
        .await
        .expect("a valid update must be accepted");
    let min_points: i64 = client
        .query_one(
            "SELECT min_points FROM loyalty_tiers WHERE id = 't-upd'",
            &[],
        )
        .await
        .expect("read back")
        .get(0);
    assert_eq!(min_points, 250, "the accepted update must persist");

    // Direction 2: an invalid update is REFUSED.
    let err = client
        .execute(
            "UPDATE loyalty_tiers SET earn_multiplier_millionths = 0 WHERE id = 't-upd'",
            &[],
        )
        .await
        .expect_err("a zero multiplier must be refused on UPDATE");
    assert_refused(
        err,
        "invalid loyalty tier",
        "loyalty update: zero multiplier",
    );

    let err = client
        .execute(
            "UPDATE loyalty_tiers SET colour = '#12345g' WHERE id = 't-upd'",
            &[],
        )
        .await
        .expect_err("a non-hex colour must be refused on UPDATE");
    assert_refused(
        err,
        "invalid loyalty tier",
        "loyalty update: non-hex colour",
    );

    eprintln!("PROVEN: loyalty_tiers_validate_update (both directions)");
    drop(client);
    drop_throwaway(&db_name).await;
}

// ── trg_assignments_scope_id_pair ─────────────────────────────────────────
//
// SQLite (20260916_role_assignment_scopes.sql:34-40): AFTER INSERT, WHEN
// (scope_type = 'organization') != (scope_id IS NULL) -> RAISE(ABORT).
// scope_id must be NULL EXACTLY when the scope is org-wide.
#[tokio::test]
async fn pg_assignments_scope_pair_insert_port_matches_sqlite() {
    let Some((client, db_name)) = harness("trg_assignments_scope_id_pair").await else {
        return;
    };

    const INSERT: &str = "INSERT INTO assignments (user_id, role_id, scope_type, scope_id) VALUES ($1, 'role-c44', $2, $3)";

    // Direction 1: the two VALID shapes are ACCEPTED.
    seed_user(&client, "u-org-null").await;
    client
        .execute(INSERT, &[&"u-org-null", &"organization", &None::<String>])
        .await
        .expect("organization + NULL scope_id is the valid org-wide shape");

    seed_user(&client, "u-loc-set").await;
    client
        .execute(INSERT, &[&"u-loc-set", &"location", &Some("loc-a")])
        .await
        .expect("location + scope_id is a valid shape");

    // Direction 2: the two INVALID shapes are REFUSED.
    seed_user(&client, "u-org-set").await;
    let err = client
        .execute(INSERT, &[&"u-org-set", &"organization", &Some("loc-a")])
        .await
        .expect_err("organization + scope_id must be refused");
    assert_refused(err, "scope_id must be NULL", "assignments insert: org + id");

    seed_user(&client, "u-loc-null").await;
    let err = client
        .execute(INSERT, &[&"u-loc-null", &"location", &None::<String>])
        .await
        .expect_err("location + NULL scope_id must be refused");
    assert_refused(
        err,
        "scope_id must be NULL",
        "assignments insert: location + NULL",
    );

    eprintln!("PROVEN: trg_assignments_scope_id_pair (two valid accepted, two invalid refused)");
    drop(client);
    drop_throwaway(&db_name).await;
}

// ── trg_assignments_scope_id_pair_update ──────────────────────────────────
//
// SQLite: the same predicate on AFTER UPDATE OF scope_type, scope_id.
#[tokio::test]
async fn pg_assignments_scope_pair_update_port_matches_sqlite() {
    let Some((client, db_name)) = harness("trg_assignments_scope_id_pair_update").await else {
        return;
    };

    // A valid org-wide row to update.
    seed_user(&client, "u-upd-org").await;
    client
        .execute(
            "INSERT INTO assignments (user_id, role_id, scope_type, scope_id) VALUES ('u-upd-org', 'role-c44', 'organization', NULL)",
            &[],
        )
        .await
        .expect("org-wide fixture");

    // Direction 1: a valid transition is ACCEPTED.
    client
        .execute(
            "UPDATE assignments SET scope_type = 'location', scope_id = 'loc-a' WHERE user_id = 'u-upd-org'",
            &[],
        )
        .await
        .expect("org-wide -> location-scoped with an id is a valid transition");

    // Direction 2: flipping back to organization while KEEPING the id is REFUSED.
    let err = client
        .execute(
            "UPDATE assignments SET scope_type = 'organization' WHERE user_id = 'u-upd-org'",
            &[],
        )
        .await
        .expect_err("organization keeping a scope_id must be refused on UPDATE");
    assert_refused(
        err,
        "scope_id must be NULL",
        "assignments update: org keeping id",
    );

    // And the mirror: dropping the id while staying location-scoped is REFUSED.
    let err = client
        .execute(
            "UPDATE assignments SET scope_id = NULL WHERE user_id = 'u-upd-org'",
            &[],
        )
        .await
        .expect_err("location-scoped with NULL scope_id must be refused on UPDATE");
    assert_refused(
        err,
        "scope_id must be NULL",
        "assignments update: location losing id",
    );

    eprintln!("PROVEN: trg_assignments_scope_id_pair_update (both directions)");
    drop(client);
    drop_throwaway(&db_name).await;
}
