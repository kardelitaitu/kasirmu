//! Tests for the migration runner's ledger and drift policy.
//!
//! These subjects are the ledger, the checksums and the drift decision; the
//! statement layer's and the proofs' own tests live beside them in
//! `statements_tests.rs` and `proofs_tests.rs`. The file
//! was moved out of `migrations.rs` unchanged, so the production file is the size
//! of its responsibility.
//!
//! Three pins here are load-bearing beyond their names:
//! `checksum_hex_matches_independently_computed_digests` holds the stored digest
//! to literals computed outside this crate — every other checksum assertion
//! compares the function with its own output —
//! `the_statement_fallback_is_entered_only_for_a_classified_failure` holds the
//! drift fallback to the failures it is allowed to excuse, and
//! `the_classifier_excuses_exactly_its_four_texts` holds the classifier's
//! membership to SQLite's own wordings, from both sides.

use super::*;

fn fresh() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON").unwrap();
    conn
}

const TEST_MIGRATIONS: &[Migration] = &[Migration {
    id: "001_test.sql",
    sql: "CREATE TABLE test_table (id INTEGER PRIMARY KEY)",
}];

const TWO_MIGRATIONS: &[Migration] = &[
    Migration {
        id: "001_first.sql",
        sql: "CREATE TABLE test_table (id INTEGER PRIMARY KEY)",
    },
    Migration {
        id: "002_second.sql",
        sql: "ALTER TABLE test_table ADD COLUMN name TEXT",
    },
];

/// A registry in production's shape: date-prefixed ids, so the guard has a
/// vantage point from which "newer than me" means something.
const DATE_REGISTRY: &[Migration] = &[Migration {
    id: "20260101_first.sql",
    sql: "CREATE TABLE test_table (id INTEGER PRIMARY KEY)",
}];

fn ledger_has(conn: &Connection, id: &str) -> bool {
    conn.query_row(
        "SELECT COUNT(*) FROM schema_migrations WHERE id = ?1",
        params![id],
        |r| r.get::<_, i64>(0),
    )
    .unwrap()
        == 1
}

fn table_exists(conn: &Connection, name: &str) -> bool {
    conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name = ?1",
        params![name],
        |r| r.get::<_, i64>(0),
    )
    .unwrap()
        == 1
}

#[test]
fn a_database_migrated_by_a_newer_build_is_refused_before_anything_applies() {
    let mut conn = Connection::open_in_memory().unwrap();
    ensure_schema_migrations_table(&conn).unwrap();
    conn.execute(
        "INSERT INTO schema_migrations (id) VALUES ('20991231_from_the_future.sql')",
        [],
    )
    .unwrap();

    let err = run(&mut conn, DATE_REGISTRY).unwrap_err().to_string();
    assert!(
        err.contains("newer than this build") && err.contains("20991231_from_the_future.sql"),
        "unhelpful refusal: {err}"
    );
    // The point of checking first: nothing was applied on the way out.
    assert!(
        !table_exists(&conn, "test_table"),
        "the registry's own migration ran despite the refusal"
    );
}

#[test]
fn a_legacy_row_the_registry_no_longer_lists_still_upgrades() {
    // The documented dev-DB path, at this level: `001_sales.sql` is not
    // date-shaped, so it has no position in the chronology and must not be
    // read as coming from the future.
    let mut conn = Connection::open_in_memory().unwrap();
    ensure_schema_migrations_table(&conn).unwrap();
    conn.execute(
        "INSERT INTO schema_migrations (id) VALUES ('001_sales.sql')",
        [],
    )
    .unwrap();

    run(&mut conn, DATE_REGISTRY).unwrap();
    assert!(
        ledger_has(&conn, "001_sales.sql"),
        "the legacy row was pruned"
    );
    assert!(table_exists(&conn, "test_table"));
}

#[test]
fn a_pruned_older_date_shaped_migration_is_tolerated() {
    // History this build lost is not the future: an id that sorts BEFORE the
    // newest known one cannot come from a build ahead of this one.
    let mut conn = Connection::open_in_memory().unwrap();
    ensure_schema_migrations_table(&conn).unwrap();
    conn.execute(
        "INSERT INTO schema_migrations (id) VALUES ('20250101_pruned_away.sql')",
        [],
    )
    .unwrap();

    run(&mut conn, DATE_REGISTRY).unwrap();
    assert!(table_exists(&conn, "test_table"));
}

#[test]
fn a_registry_with_no_date_shaped_ids_cannot_call_anything_the_future() {
    // Guard stays inert rather than refusing everything: the `001_`/`002_`
    // fixture corpus has no vantage point, and must not acquire one by
    // accident. A genuinely-future row here is ignored, as before.
    let mut conn = Connection::open_in_memory().unwrap();
    ensure_schema_migrations_table(&conn).unwrap();
    conn.execute(
        "INSERT INTO schema_migrations (id) VALUES ('20991231_from_the_future.sql')",
        [],
    )
    .unwrap();

    run(&mut conn, TEST_MIGRATIONS).unwrap();
    assert!(table_exists(&conn, "test_table"));
}

#[test]
fn first_run_applies_all_migrations() {
    let mut conn = fresh();
    run(&mut conn, TEST_MIGRATIONS).unwrap();
    let applied = load_applied(&conn).unwrap();
    for mig in TEST_MIGRATIONS {
        assert!(
            applied.contains(mig.id),
            "missing applied entry for {}",
            mig.id
        );
    }
}

#[test]
fn second_run_is_idempotent() {
    let mut conn = fresh();
    run(&mut conn, TEST_MIGRATIONS).unwrap();
    run(&mut conn, TEST_MIGRATIONS).unwrap();
    let applied = load_applied(&conn).unwrap();
    assert_eq!(applied.len(), TEST_MIGRATIONS.len());
}

/// The digest of known bytes, written down from outside this crate.
///
/// Every other checksum assertion in this file compares `checksum_hex` with a
/// value `checksum_hex` itself wrote (`stored == checksum_hex(…)`), so a
/// change to *how* it hashes — which silently changes drift detection for
/// every database already in the field — leaves them all green. These
/// literals come from `sha256sum` over the exact bytes; the first is also a
/// published vector, so the pin does not rest on a value only this repository
/// ever produced.
#[test]
fn checksum_hex_matches_independently_computed_digests() {
    const SCRIPT: &str = "CREATE TABLE t (id INTEGER PRIMARY KEY)\n";
    /// `printf 'CREATE TABLE t (id INTEGER PRIMARY KEY)\n' | sha256sum`
    const SCRIPT_SHA256: &str = "d41b652bf285f8547f950532f73873f4184fe47bf08e0d0f55e80454b5e67973";

    assert_eq!(
        checksum_hex("abc"),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    assert_eq!(checksum_hex(SCRIPT), SCRIPT_SHA256);
    // Line-ending normalisation is part of the digest rather than a step
    // beside it: the CRLF spelling of the same script hashes to the *same*
    // literal. That is what keeps the stored checksum of a Windows-authored
    // file valid, and it is the half drift detection cannot survive losing —
    // without it this hashes the CRLF bytes and returns
    // `0009ec0748105c5ec64c829f3ce37612733f16b2ef73699011d1472fa26c0c66`.
    assert_eq!(checksum_hex(&SCRIPT.replace('\n', "\r\n")), SCRIPT_SHA256);
}

/// The statement-level fallback is entered on the strength of a failure the
/// classifier recognises, and not otherwise.
///
/// The two halves are one property. A failure outside the classifier's
/// vocabulary is reported verbatim and commits nothing (case U). A failure it
/// recognises earns the statement-by-statement attempt, which reaches a
/// *later* statement only by proving the earlier one already satisfied — so
/// the error it reports is the later statement's, not the one that let the
/// fallback in (case C). Neither half is observable from the other's setup,
/// which is why they are asserted together.
#[test]
fn the_statement_fallback_is_entered_only_for_a_classified_failure() {
    let checksum = |conn: &Connection| -> Option<String> {
        conn.query_row(
            "SELECT checksum FROM schema_migrations WHERE id = '001_shape.sql'",
            [],
            |row| row.get(0),
        )
        .unwrap()
    };

    // U — `CHECK constraint failed` is not one of the four texts the
    // classifier knows, so no statement of this script may be excused.
    let base = &[Migration {
        id: "001_shape.sql",
        sql: "CREATE TABLE shape (id INTEGER PRIMARY KEY, n INTEGER CHECK (n > 0))",
    }];
    let mut conn = fresh();
    run(&mut conn, base).unwrap();
    let before = checksum(&conn);

    let unclassified = &[Migration {
        id: "001_shape.sql",
        sql: "INSERT INTO shape (id, n) VALUES (1, -1);\n\
              CREATE INDEX idx_shape_n ON shape(n);\n",
    }];
    let err = run(&mut conn, unclassified).unwrap_err();
    assert!(
        err.to_string().contains("CHECK constraint failed"),
        "the failing statement's own error is what the user must see: {err}"
    );
    assert_eq!(
        before,
        checksum(&conn),
        "a drift re-apply that failed must not record the new checksum"
    );
    let index_rows: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE name = 'idx_shape_n'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        index_rows, 0,
        "nothing from the refused script may be committed"
    );

    // C — `duplicate column name` *is* recognised, and the first statement
    // is already satisfied, so the attempt runs on. Statement 2 inserts one
    // row; statement 3 repeats its primary key, which the classifier does not
    // know.
    let base2 = &[Migration {
        id: "002_shape.sql",
        sql: "CREATE TABLE shape2 (id INTEGER PRIMARY KEY, c TEXT)",
    }];
    let mut conn2 = fresh();
    run(&mut conn2, base2).unwrap();
    let drifted2 = &[Migration {
        id: "002_shape.sql",
        sql: "ALTER TABLE shape2 ADD COLUMN c TEXT;\n\
              INSERT INTO shape2 (id, c) VALUES (1, NULL);\n\
              INSERT INTO shape2 (id, c) VALUES (1, NULL);\n",
    }];
    let err2 = run(&mut conn2, drifted2).unwrap_err();
    assert!(
        err2.to_string().contains("UNIQUE constraint failed"),
        "the fallback must get past the satisfied statement and report the one that \
         actually blocked it: {err2}"
    );
    assert!(
        !err2.to_string().contains("duplicate column name"),
        "reporting the error the fallback was entered for means it never ran: {err2}"
    );
    let shape2_rows: i64 = conn2
        .query_row("SELECT COUNT(*) FROM shape2", [], |row| row.get(0))
        .unwrap();
    assert_eq!(shape2_rows, 0, "the failed attempt must roll back");
}

#[test]
fn the_classifier_excuses_exactly_its_four_texts() {
    // The four texts the drift fallback may be entered for, as SQLite words
    // them. A near-miss that slips into this list is a failure the proofs
    // cannot excuse being retried statement by statement before it is
    // reported — the mirror image of the gatekeeper test above, so the list
    // is pinned from both sides.
    let classified = [
        "table t already exists",
        "duplicate column name: c",
        "table t has no column named c",
        "no such column: c",
    ];
    for message in classified {
        assert!(
            is_skip_candidate_error(message),
            "the fallback must be entered for {message:?}"
        );
    }

    // Near-misses SQLite really raises, each naming a failure no proof can
    // satisfy. `no such table` was removed from the list on 22-09-26: a
    // statement naming an absent table has no `pragma_table_info` row, no
    // primary key and no `sqlite_master` row to compare, so every arm of
    // `already_satisfied` refuses at its first gate and admitting the text
    // only ever widened the retry. `no such table: main.t` is what a CREATE
    // INDEX or CREATE TRIGGER against a dropped table raises.
    let fatal = [
        "no such table: main.t",
        "no such table: t",
        "no such index: i",
        "no such module: fts5",
        "no such function: f",
    ];
    for message in fatal {
        assert!(
            !is_skip_candidate_error(message),
            "{message:?} must stay fatal: no proof can satisfy it"
        );
    }
}

#[test]
fn migration_checksums_are_stable_across_line_endings() {
    let lf = "CREATE TABLE test_table (id INTEGER PRIMARY KEY)\n";
    let crlf = lf.replace('\n', "\r\n");

    assert_eq!(checksum_hex(lf), checksum_hex(&crlf));
}

#[test]
fn legacy_line_ending_checksum_is_migrated() {
    use sha2::Digest;

    let migrations = [Migration {
        id: "001_line_endings.sql",
        sql: "CREATE TABLE line_endings (id INTEGER PRIMARY KEY)\n",
    }];
    let mut conn = fresh();
    run(&mut conn, &migrations).unwrap();

    let legacy_sql = migrations[0].sql.replace('\n', "\r\n");
    let legacy_checksum = hex::encode(sha2::Sha256::digest(legacy_sql.as_bytes()));
    let tx = conn.transaction().unwrap();
    tx.execute(
        "UPDATE schema_migrations SET checksum = ?1 WHERE id = ?2",
        params![legacy_checksum, migrations[0].id],
    )
    .unwrap();
    tx.commit().unwrap();

    run(&mut conn, &migrations).unwrap();
    let stored: String = conn
        .query_row(
            "SELECT checksum FROM schema_migrations WHERE id = ?1",
            params![migrations[0].id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(stored, checksum_hex(migrations[0].sql));
}

#[test]
fn migration_creates_table() {
    let mut conn = fresh();
    run(&mut conn, TEST_MIGRATIONS).unwrap();
    let exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='test_table'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(exists, 1, "expected `test_table` after migration");
}

#[test]
fn run_with_empty_list_does_nothing() {
    let mut conn = fresh();
    run(&mut conn, &[]).unwrap();
    let applied = load_applied(&conn).unwrap();
    assert!(applied.is_empty());
}

// ── Rollback tests ─────────────────────────────────────────────

#[test]
fn rollback_reverts_last_migration_and_removes_tracking() {
    let mut conn = fresh();
    run(&mut conn, TEST_MIGRATIONS).unwrap();

    // Verify table exists before rollback.
    let exists_before: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='test_table'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(exists_before, 1);

    // Rollback using the `rollback()` function with explicit down SQL.
    let rolled_back =
        rollback(&mut conn, "001_test.sql", "DROP TABLE IF EXISTS test_table").unwrap();
    assert!(rolled_back, "rollback should succeed");

    // Verify table was dropped.
    let exists_after: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='test_table'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(exists_after, 0, "table should be dropped after rollback");

    // Verify tracking row removed.
    let applied = load_applied(&conn).unwrap();
    assert!(
        !applied.contains("001_test.sql"),
        "tracking row should be removed"
    );
}

#[test]
fn rollback_empty_db_returns_false() {
    let mut conn = fresh();
    let result = rollback(&mut conn, "001_test.sql", "DROP TABLE test_table").unwrap();
    assert!(!result, "rollback on empty DB should return false");
}

#[test]
fn rollback_wrong_id_returns_false() {
    let mut conn = fresh();
    run(&mut conn, TEST_MIGRATIONS).unwrap();

    // Try rolling back with a non-matching ID.
    let result = rollback(&mut conn, "999_wrong.sql", "DROP TABLE test_table").unwrap();
    assert!(!result, "rollback with wrong ID should return false");

    // Table should still exist.
    let exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='test_table'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(exists, 1, "table should survive failed rollback");
}

#[test]
fn rollback_only_reverts_last_migration() {
    let mut conn = fresh();
    run(&mut conn, TWO_MIGRATIONS).unwrap();

    // Try rolling back the first migration while second is on top — should fail.
    let result = rollback(
        &mut conn,
        "001_first.sql",
        "DROP TABLE IF EXISTS test_table",
    )
    .unwrap();
    assert!(
        !result,
        "rollback of non-last migration should return false"
    );

    // Both still exist.
    let applied = load_applied(&conn).unwrap();
    assert_eq!(applied.len(), 2);

    // Rollback the last one instead.
    let result = rollback(
        &mut conn,
        "002_second.sql",
        "ALTER TABLE test_table DROP COLUMN name",
    )
    .unwrap();
    assert!(result, "rollback of last migration should succeed");

    let applied = load_applied(&conn).unwrap();
    assert_eq!(applied.len(), 1);
    assert!(applied.contains("001_first.sql"));
}

// ── Edge case tests ─────────────────────────────────────────────

#[test]
fn duplicate_migration_id_with_identical_sql_is_skipped() {
    let mut conn = fresh();
    // Run once.
    run(&mut conn, TEST_MIGRATIONS).unwrap();
    // Run again with the same list — the duplicate ID is skipped and the
    // checksum verifies (idempotent).
    run(&mut conn, TEST_MIGRATIONS).unwrap();
    let applied = load_applied(&conn).unwrap();
    assert_eq!(applied.len(), 1);
}

#[test]
fn drift_with_non_idempotent_sql_fails() {
    let mut conn = fresh();
    run(&mut conn, TEST_MIGRATIONS).unwrap();

    // Same ID, non-idempotent SQL (missing IF NOT EXISTS) → re-apply
    // fails because the table already exists, surfacing the breaking
    // change to the user.
    let drifted = &[Migration {
        id: "001_test.sql",
        sql: "CREATE TABLE test_table (id INTEGER PRIMARY KEY, name TEXT)",
    }];
    let err = run(&mut conn, drifted).unwrap_err();
    // The error comes from the SQL execution, not the checksum check.
    assert!(
        err.to_string().contains("already exists"),
        "expected SQL re-apply error, got: {err}"
    );
}

#[test]
fn drift_with_idempotent_sql_auto_patches() {
    let mut conn = fresh();
    run(&mut conn, TEST_MIGRATIONS).unwrap();

    // Same ID, idempotent SQL (IF NOT EXISTS) → re-apply is a no-op,
    // checksum is auto-updated, and startup succeeds.
    let drifted = &[Migration {
        id: "001_test.sql",
        sql: "CREATE TABLE IF NOT EXISTS test_table (id INTEGER PRIMARY KEY, name TEXT)",
    }];
    run(&mut conn, drifted).unwrap(); // must not error

    // Checksum was updated to match the new definition.
    let stored: String = conn
        .query_row(
            "SELECT checksum FROM schema_migrations WHERE id = '001_test.sql'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(stored, checksum_hex(drifted[0].sql));

    // Table still exists.
    let exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='test_table'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(exists, 1);
}

/// A drifted re-apply must leave the data byte-identical, and the statement that
/// breaks that is one which *succeeds* while inserting nothing: SQLite allocates a
/// rowid for every row an `OR IGNORE` attempt discards, so an `AUTOINCREMENT`
/// table's counter advances although no row is inserted.
#[test]
fn drift_re_apply_leaves_the_autoincrement_counter_untouched() {
    /// The shape `20260813_init.sql` uses for `workspace_screens`: the seed's
    /// uniqueness is a `UNIQUE` constraint over columns the statement names,
    /// while the `AUTOINCREMENT` key it never names is what advances.
    const SEEDED: &[Migration] = &[Migration {
        id: "001_seeded.sql",
        sql: "CREATE TABLE IF NOT EXISTS screens (\
                  id INTEGER PRIMARY KEY AUTOINCREMENT,\
                  workspace_key TEXT NOT NULL,\
                  screen_key TEXT NOT NULL,\
                  UNIQUE (workspace_key, screen_key)\
              );\n\
              INSERT OR IGNORE INTO screens (workspace_key, screen_key) \
                  VALUES ('pos', 'grid'), ('pos', 'cart');\n\
              CREATE INDEX screens_by_key ON screens (workspace_key);",
    }];
    /// The same script with a comment appended — a checksum-only drift whose
    /// unguarded `CREATE INDEX` still collides, so the re-apply reaches the
    /// statement-by-statement fallback, which is where the seed is re-run.
    const SEEDED_DRIFTED: &[Migration] = &[Migration {
        id: "001_seeded.sql",
        sql: "CREATE TABLE IF NOT EXISTS screens (\
                  id INTEGER PRIMARY KEY AUTOINCREMENT,\
                  workspace_key TEXT NOT NULL,\
                  screen_key TEXT NOT NULL,\
                  UNIQUE (workspace_key, screen_key)\
              );\n\
              INSERT OR IGNORE INTO screens (workspace_key, screen_key) \
                  VALUES ('pos', 'grid'), ('pos', 'cart');\n\
              CREATE INDEX screens_by_key ON screens (workspace_key);\n\
              -- cosmetic drift probe",
    }];

    let count = |conn: &Connection| -> i64 {
        conn.query_row("SELECT COUNT(*) FROM screens", [], |row| row.get(0))
            .unwrap()
    };
    let sequence = |conn: &Connection| -> i64 {
        conn.query_row(
            "SELECT seq FROM sqlite_sequence WHERE name = 'screens'",
            [],
            |row| row.get(0),
        )
        .unwrap()
    };

    let mut conn = fresh();
    run(&mut conn, SEEDED).unwrap();
    assert_eq!(count(&conn), 2, "the first run inserted both rows");
    assert_eq!(sequence(&conn), 2);

    run(&mut conn, SEEDED_DRIFTED).unwrap();

    assert_eq!(
        sequence(&conn),
        2,
        "a re-apply that inserts nothing must not advance the counter"
    );
    assert_eq!(count(&conn), 2, "and must not insert or duplicate a row");
    // The drift was still repaired: the skip removes a side effect, not the fix.
    let stored: String = conn
        .query_row(
            "SELECT checksum FROM schema_migrations WHERE id = '001_seeded.sql'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(stored, checksum_hex(SEEDED_DRIFTED[0].sql));
}

// ── DB-02: statement-level drift re-apply ───────────────────────

/// A migration shaped like `20260901_product_images.sql`: a guarded
/// `CREATE TABLE` plus the unguarded `ALTER TABLE … ADD COLUMN` that
/// SQLite offers no `IF NOT EXISTS` form for.
const ADD_COLUMN_MIGRATION: &[Migration] = &[Migration {
    id: "001_add_column.sql",
    sql: "CREATE TABLE IF NOT EXISTS products (id TEXT NOT NULL PRIMARY KEY);\n\
          ALTER TABLE products ADD COLUMN image_hash TEXT;",
}];

/// The same migration after a comment-only edit — the drift that used to
/// panic startup with `duplicate column name: image_hash`.
const ADD_COLUMN_MIGRATION_COMMENTED: &[Migration] = &[Migration {
    id: "001_add_column.sql",
    sql: "CREATE TABLE IF NOT EXISTS products (id TEXT NOT NULL PRIMARY KEY);\n\
          ALTER TABLE products ADD COLUMN image_hash TEXT;\n\
          -- cosmetic: the hash mirrors product_images slot 1",
}];

#[test]
fn drift_comment_only_edit_to_unguarded_add_column_self_heals() {
    let mut conn = fresh();
    run(&mut conn, ADD_COLUMN_MIGRATION).unwrap();

    // A comment-only edit changes the file's checksum but not its
    // executable SQL, so the re-apply must succeed: the `ADD COLUMN` is
    // already satisfied and the column definition is identical.
    run(&mut conn, ADD_COLUMN_MIGRATION_COMMENTED).unwrap();

    let stored: String = conn
        .query_row(
            "SELECT checksum FROM schema_migrations WHERE id = '001_add_column.sql'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(stored, checksum_hex(ADD_COLUMN_MIGRATION_COMMENTED[0].sql));

    let declared: Option<String> = conn
        .query_row(
            "SELECT type FROM pragma_table_info('products') WHERE name = 'image_hash'",
            [],
            |row| row.get(0),
        )
        .optional()
        .unwrap();
    assert_eq!(declared.as_deref(), Some("TEXT"));
}

#[test]
fn drift_add_column_with_conflicting_type_is_surfaced() {
    let mut conn = fresh();
    run(&mut conn, ADD_COLUMN_MIGRATION).unwrap();

    // Same column name, different declared type: the existing column is
    // not what the edited script asks for, so the drift must be reported
    // rather than skipped.
    let drifted = &[Migration {
        id: "001_add_column.sql",
        sql: "CREATE TABLE IF NOT EXISTS products (id TEXT NOT NULL PRIMARY KEY);\n\
              ALTER TABLE products ADD COLUMN image_hash INTEGER;",
    }];
    let err = run(&mut conn, drifted).unwrap_err();
    assert!(
        err.to_string().contains("duplicate column name"),
        "expected the duplicate-column error to surface, got: {err}"
    );
}

#[test]
fn drift_add_column_with_conflicting_default_is_surfaced() {
    let mut conn = fresh();
    run(
        &mut conn,
        &[Migration {
            id: "001_add_column.sql",
            sql: "CREATE TABLE IF NOT EXISTS products (id TEXT NOT NULL PRIMARY KEY);\n\
                  ALTER TABLE products ADD COLUMN currency TEXT NOT NULL DEFAULT '';",
        }],
    )
    .unwrap();

    let drifted = &[Migration {
        id: "001_add_column.sql",
        sql: "CREATE TABLE IF NOT EXISTS products (id TEXT NOT NULL PRIMARY KEY);\n\
              ALTER TABLE products ADD COLUMN currency TEXT NOT NULL DEFAULT 'IDR';",
    }];
    let err = run(&mut conn, drifted).unwrap_err();
    assert!(
        err.to_string().contains("duplicate column name"),
        "expected the duplicate-column error to surface, got: {err}"
    );
}

#[test]
fn drift_add_column_with_expression_default_self_heals() {
    // SQLite reports `DEFAULT (strftime(…))` without the wrapping
    // parentheses, so the comparison has to strip them from the script's
    // side too — otherwise a comment-only edit to a timestamp column
    // would look like a changed default.
    let mut conn = fresh();
    run(
        &mut conn,
        &[Migration {
            id: "001_add_column.sql",
            sql: "CREATE TABLE IF NOT EXISTS products (id TEXT NOT NULL PRIMARY KEY);\n\
                  ALTER TABLE products ADD COLUMN created_at TEXT NOT NULL \
                  DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));",
        }],
    )
    .unwrap();

    let drifted = &[Migration {
        id: "001_add_column.sql",
        sql: "CREATE TABLE IF NOT EXISTS products (id TEXT NOT NULL PRIMARY KEY);\n\
              ALTER TABLE products ADD COLUMN created_at TEXT NOT NULL \
              DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));\n\
              -- cosmetic",
    }];
    run(&mut conn, drifted).unwrap();
}

#[test]
fn drift_cosmetic_edit_to_unguarded_trigger_self_heals() {
    let mut conn = fresh();
    run(
        &mut conn,
        &[Migration {
            id: "001_trigger.sql",
            sql: "CREATE TABLE IF NOT EXISTS audit_log (id TEXT NOT NULL);\n\
                  CREATE TRIGGER audit_log_immutable_delete BEFORE DELETE ON audit_log \
                  BEGIN SELECT RAISE(ABORT, 'immutable'); END;",
        }],
    )
    .unwrap();

    let drifted = &[Migration {
        id: "001_trigger.sql",
        sql: "CREATE TABLE IF NOT EXISTS audit_log (id TEXT NOT NULL);\n\
              CREATE TRIGGER audit_log_immutable_delete BEFORE DELETE ON audit_log \
              BEGIN SELECT RAISE(ABORT, 'immutable'); END;\n\
              -- cosmetic",
    }];
    run(&mut conn, drifted).unwrap();
}

#[test]
fn drift_changed_trigger_body_is_surfaced() {
    let mut conn = fresh();
    run(
        &mut conn,
        &[Migration {
            id: "001_trigger.sql",
            sql: "CREATE TABLE IF NOT EXISTS audit_log (id TEXT NOT NULL);\n\
                  CREATE TRIGGER audit_log_immutable_delete BEFORE DELETE ON audit_log \
                  BEGIN SELECT RAISE(ABORT, 'immutable'); END;",
        }],
    )
    .unwrap();

    let drifted = &[Migration {
        id: "001_trigger.sql",
        sql: "CREATE TABLE IF NOT EXISTS audit_log (id TEXT NOT NULL);\n\
              CREATE TRIGGER audit_log_immutable_delete BEFORE DELETE ON audit_log \
              BEGIN SELECT RAISE(ABORT, 'cannot delete'); END;",
    }];
    let err = run(&mut conn, drifted).unwrap_err();
    assert!(
        err.to_string().contains("already exists"),
        "expected the duplicate-trigger error to surface, got: {err}"
    );
}

#[test]
fn partial_crash_with_if_not_exists_recovers() {
    // Simulate a crash that occurs AFTER the SQL executes but BEFORE
    // the tracking INSERT is committed.
    //
    // In this scenario, `run()` will see NO tracking row and attempt
    // to re-apply the SQL. If the SQL uses `IF NOT EXISTS`, it succeeds
    // idempotently. If it uses plain `CREATE TABLE`, the re-apply will
    // fail — which is correct: the migration author must use idempotent
    // SQL patterns.
    //
    // This test verifies that re-running with idempotent SQL works.
    let mut conn = fresh();

    // Create the table manually (simulating the SQL that executed before crash).
    conn.execute_batch("CREATE TABLE test_table (id INTEGER PRIMARY KEY)")
        .unwrap();
    // No tracking row — simulating the missing INSERT + commit.

    // Now run with a migration that uses IF NOT EXISTS (recommended pattern).
    let idempotent_migration = &[Migration {
        id: "001_test.sql",
        sql: "CREATE TABLE IF NOT EXISTS test_table (id INTEGER PRIMARY KEY)",
    }];
    run(&mut conn, idempotent_migration).unwrap();

    // Tracking row should now exist.
    let applied = load_applied(&conn).unwrap();
    assert!(
        applied.contains("001_test.sql"),
        "tracking row should be added on recovery"
    );

    // Table should still exist.
    let exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='test_table'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(exists, 1, "table should survive recovery re-run");
}

#[test]
fn migration_table_created_outside_of_runner() {
    // Verify that a table created manually (e.g. by a concurrent process)
    // is detected as already-applied via its tracking row.
    let mut conn = fresh();
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            id TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        )",
    )
    .unwrap();
    conn.execute(
        "INSERT INTO schema_migrations (id) VALUES (?1)",
        params!["001_test.sql"],
    )
    .unwrap();
    // Create the actual table too (simulating another process that did both).
    conn.execute_batch("CREATE TABLE test_table (id INTEGER PRIMARY KEY)")
        .unwrap();

    // Running migrations should be a no-op (and backfill the checksum).
    run(&mut conn, TEST_MIGRATIONS).unwrap();
    let applied = load_applied(&conn).unwrap();
    assert_eq!(applied.len(), 1);
    let stored: String = conn
        .query_row(
            "SELECT checksum FROM schema_migrations WHERE id = '001_test.sql'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(stored, checksum_hex(TEST_MIGRATIONS[0].sql));
}

#[test]
fn load_applied_ordered_returns_correct_order() {
    let mut conn = fresh();
    run(&mut conn, TWO_MIGRATIONS).unwrap();

    let ordered = load_applied_ordered(&conn).unwrap();
    assert_eq!(ordered.len(), 2);
    assert_eq!(ordered[0], "001_first.sql");
    assert_eq!(ordered[1], "002_second.sql");
}

#[test]
fn rollback_then_rereapply_works() {
    let mut conn = fresh();
    run(&mut conn, TEST_MIGRATIONS).unwrap();

    // Rollback.
    rollback(&mut conn, "001_test.sql", "DROP TABLE IF EXISTS test_table").unwrap();

    // Re-apply.
    run(&mut conn, TEST_MIGRATIONS).unwrap();

    // Table should exist again.
    let exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='test_table'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(exists, 1, "table should be re-created after re-apply");

    let applied = load_applied(&conn).unwrap();
    assert!(applied.contains("001_test.sql"));
}

// ── DB-02: checksum tracking & drift detection ─────────────────

#[test]
fn applied_migration_records_checksum() {
    let mut conn = fresh();
    run(&mut conn, TEST_MIGRATIONS).unwrap();
    let stored: String = conn
        .query_row(
            "SELECT checksum FROM schema_migrations WHERE id = '001_test.sql'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(stored, checksum_hex(TEST_MIGRATIONS[0].sql));
}

#[test]
fn legacy_row_without_checksum_is_backfilled() {
    // Old-shape tracking table (no checksum column) with an applied row
    // — simulates a database migrated before DB-02 shipped.
    let mut conn = fresh();
    conn.execute_batch(
        "CREATE TABLE schema_migrations (
            id TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        )",
    )
    .unwrap();
    conn.execute(
        "INSERT INTO schema_migrations (id) VALUES ('001_test.sql')",
        [],
    )
    .unwrap();
    conn.execute_batch("CREATE TABLE test_table (id INTEGER PRIMARY KEY)")
        .unwrap();

    run(&mut conn, TEST_MIGRATIONS).unwrap();

    let stored: String = conn
        .query_row(
            "SELECT checksum FROM schema_migrations WHERE id = '001_test.sql'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        stored,
        checksum_hex(TEST_MIGRATIONS[0].sql),
        "legacy row must be backfilled with the current definition checksum"
    );
}

// ── DB-05: FK isolation around rebuild migrations ──────────────

#[test]
fn foreign_keys_disabled_during_rebuild_migration() {
    let mut conn = fresh(); // FK enforcement ON

    run(
        &mut conn,
        &[Migration {
            id: "001_parent.sql",
            sql: "CREATE TABLE parent (id TEXT PRIMARY KEY);
                  CREATE TABLE child (id TEXT PRIMARY KEY, parent_id TEXT NOT NULL REFERENCES parent(id) ON DELETE CASCADE);",
        }],
    )
    .unwrap();
    conn.execute("INSERT INTO parent (id) VALUES ('p1')", [])
        .unwrap();
    conn.execute("INSERT INTO child (id, parent_id) VALUES ('c1', 'p1')", [])
        .unwrap();

    // Rebuild migration following the 081/089 pattern (DROP parent, then
    // rename the replacement into place). With FK enforcement ON at the
    // connection level, DROP TABLE would cascade-delete the child row.
    run(
        &mut conn,
        &[Migration {
            id: "002_rebuild.sql",
            sql: "CREATE TABLE parent_new (id TEXT PRIMARY KEY);
                  INSERT INTO parent_new SELECT id FROM parent;
                  DROP TABLE parent;
                  ALTER TABLE parent_new RENAME TO parent;",
        }],
    )
    .unwrap();

    // Child row must survive the parent rebuild.
    let children: i64 = conn
        .query_row("SELECT COUNT(*) FROM child", [], |r| r.get(0))
        .unwrap();
    assert_eq!(children, 1, "child row must survive parent rebuild");

    // FK enforcement restored, and no violations remain.
    let fk_violations: i64 = conn
        .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(fk_violations, 0, "no FK violations after rebuild");
}
