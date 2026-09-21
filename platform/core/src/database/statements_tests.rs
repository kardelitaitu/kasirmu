//! Tests for the SQL statement layer.
//!
//! The proof is the only part of the drift re-apply that decides to *skip* a
//! statement, and a wrong skip applies nothing while reporting success — so
//! every refusal below is asserted together with the control that shows the same
//! statement *is* provable when the proof's conditions hold. A negative test
//! without its control would pass just as happily against a proof that refused
//! everything.

use super::*;

fn fresh() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON").unwrap();
    conn
}

/// Ask the proof the way the runner does.
fn satisfied(conn: &Connection, statement: &str, error_message: &str) -> bool {
    already_satisfied(conn, statement, error_message).unwrap()
}

fn count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |row| row.get(0)).unwrap()
}

/// The error SQLite raises for the init script's seed on a database where
/// `20260831_loyalty_multiplier_fixedpoint.sql` has already run.
const ABSENT_COLUMN_ERROR: &str = "table loyalty_tiers has no column named earn_multiplier";

/// The schema that migration leaves behind: the column the seed names is gone,
/// replaced by the millionths one.
fn loyalty_after_the_fixedpoint_migration() -> Connection {
    let conn = fresh();
    conn.execute_batch(
        "CREATE TABLE loyalty_tiers (\
             id TEXT PRIMARY KEY,\
             name TEXT NOT NULL,\
             earn_multiplier_millionths INTEGER NOT NULL\
         );\
         INSERT INTO loyalty_tiers (id, name, earn_multiplier_millionths) VALUES\
             ('tier-bronze', 'Bronze', 1000000),\
             ('tier-silver', 'Silver', 1250000),\
             ('tier-gold', 'Gold', 1500000),\
             ('tier-platinum', 'Platinum', 2000000);",
    )
    .unwrap();
    conn
}

/// The init script's seed, verbatim in shape: `earn_multiplier` is absent,
/// `id` and `name` are present, and `id` is the whole primary key.
const LOYALTY_SEED: &str = "INSERT OR IGNORE INTO loyalty_tiers \
     (id, name, min_points, points_per_unit, earn_multiplier, colour, sort_order) VALUES \
     ('tier-bronze', 'Bronze', 0, 10, 1.0, '#cd7f32', 1), \
     ('tier-gold', 'Gold', 500, 10, 1.5, '#ffd700', 3);";

#[test]
fn a_seed_whose_rows_are_all_present_is_skipped() {
    let conn = loyalty_after_the_fixedpoint_migration();
    assert!(satisfied(&conn, LOYALTY_SEED, ABSENT_COLUMN_ERROR));
}

#[test]
fn a_seed_with_a_missing_row_is_never_skipped() {
    let conn = loyalty_after_the_fixedpoint_migration();
    // Control: on this schema the same statement is provable…
    assert!(satisfied(&conn, LOYALTY_SEED, ABSENT_COLUMN_ERROR));
    // …and taking away a row the seed asks for takes the proof away with it.
    conn.execute("DELETE FROM loyalty_tiers WHERE id = 'tier-gold'", [])
        .unwrap();
    assert_eq!(
        count(
            &conn,
            "SELECT COUNT(*) FROM loyalty_tiers WHERE id = 'tier-gold'"
        ),
        0
    );
    assert!(!satisfied(&conn, LOYALTY_SEED, ABSENT_COLUMN_ERROR));
}

#[test]
fn a_seed_without_or_ignore_is_never_skipped() {
    let conn = loyalty_after_the_fixedpoint_migration();
    assert!(satisfied(&conn, LOYALTY_SEED, ABSENT_COLUMN_ERROR));
    // Without `OR IGNORE` the same statement is not a no-op, so "every row is
    // already there" stops being a proof of anything.
    let plain = LOYALTY_SEED.replace("INSERT OR IGNORE", "INSERT");
    assert!(!satisfied(&conn, &plain, ABSENT_COLUMN_ERROR));
}

#[test]
fn a_seed_is_never_skipped_when_the_error_names_no_absent_column() {
    let conn = loyalty_after_the_fixedpoint_migration();
    assert!(satisfied(&conn, LOYALTY_SEED, ABSENT_COLUMN_ERROR));
    // A failure that the absence of `earn_multiplier` does not explain must not
    // be excused by it.
    assert!(!satisfied(
        &conn,
        LOYALTY_SEED,
        "table loyalty_tiers has no column named something_else"
    ));
}

#[test]
fn a_seed_that_omits_part_of_the_primary_key_is_never_skipped() {
    let conn = loyalty_after_the_fixedpoint_migration();
    assert!(satisfied(&conn, LOYALTY_SEED, ABSENT_COLUMN_ERROR));
    // The same rows, addressed by nothing: the proof cannot identify them.
    let keyless = "INSERT OR IGNORE INTO loyalty_tiers \
         (name, min_points, earn_multiplier) VALUES ('Bronze', 0, 1.0)";
    assert!(!satisfied(&conn, keyless, ABSENT_COLUMN_ERROR));
}

#[test]
fn a_seed_with_a_computed_key_value_is_never_skipped() {
    let conn = loyalty_after_the_fixedpoint_migration();
    assert!(satisfied(&conn, LOYALTY_SEED, ABSENT_COLUMN_ERROR));
    // The key's value has to be read from the statement, not evaluated.
    let computed = "INSERT OR IGNORE INTO loyalty_tiers \
         (id, name, min_points, earn_multiplier) VALUES (lower('Bronze'), 'Bronze', 0, 1.0)";
    assert!(!satisfied(&conn, computed, ABSENT_COLUMN_ERROR));
}

#[test]
fn a_seed_against_a_table_that_does_not_exist_is_never_skipped() {
    let conn = loyalty_after_the_fixedpoint_migration();
    assert!(satisfied(&conn, LOYALTY_SEED, ABSENT_COLUMN_ERROR));
    // A dropped or renamed table has no primary key to prove rows against,
    // which is exactly the case the absent-column half must not swallow.
    let dropped = LOYALTY_SEED.replace("loyalty_tiers", "loyalty_tiers_gone");
    assert!(!satisfied(
        &conn,
        &dropped,
        "table loyalty_tiers_gone has no column named earn_multiplier"
    ));
}

// ── Pre-execution proof: a seed that would insert nothing ────────

/// Ask the pre-execution proof the way the runner does.
fn would_insert_nothing(conn: &Connection, statement: &str) -> bool {
    insert_would_insert_nothing(conn, statement).unwrap()
}

/// The shape `20260813_init.sql` uses for `workspace_screens`: an
/// `AUTOINCREMENT` rowid key the seed does **not** name, plus a `UNIQUE`
/// constraint over columns the seed does name.
fn screens_like_the_init_script() -> Connection {
    let conn = fresh();
    conn.execute_batch(
        "CREATE TABLE screens (\
             id INTEGER PRIMARY KEY AUTOINCREMENT,\
             workspace_key TEXT NOT NULL,\
             screen_key TEXT NOT NULL,\
             sort_order INTEGER NOT NULL DEFAULT 0,\
             UNIQUE (workspace_key, screen_key)\
         );\
         INSERT INTO screens (workspace_key, screen_key, sort_order)\
             VALUES ('pos', 'grid', 1), ('pos', 'cart', 2);",
    )
    .unwrap();
    conn
}

const SCREENS_SEED: &str = "INSERT OR IGNORE INTO screens (workspace_key, screen_key, sort_order)\
     VALUES ('pos', 'grid', 1), ('pos', 'cart', 2)";

#[test]
fn a_seed_whose_rows_are_already_there_would_insert_nothing() {
    let conn = screens_like_the_init_script();
    // Control: every row the seed offers is already in the table, so running it
    // would insert nothing.
    assert!(would_insert_nothing(&conn, SCREENS_SEED));

    // An `AUTOINCREMENT` rowid the statement never names is not the only key
    // that can reject a row: the primary key works the same way.
    conn.execute_batch(
        "CREATE TABLE codes (code TEXT PRIMARY KEY, name TEXT NOT NULL);\
         INSERT INTO codes (code, name) VALUES ('IDR', 'Rupiah');",
    )
    .unwrap();
    assert!(would_insert_nothing(
        &conn,
        "INSERT OR IGNORE INTO codes (code, name) VALUES ('IDR', 'Rupiah')"
    ));

    // Taking away a row the seed offers takes the proof away with it.
    conn.execute(
        "DELETE FROM screens WHERE workspace_key = 'pos' AND screen_key = 'cart'",
        [],
    )
    .unwrap();
    assert!(!would_insert_nothing(&conn, SCREENS_SEED));
}

#[test]
fn a_seed_over_a_table_with_an_insert_trigger_is_never_skipped() {
    let conn = screens_like_the_init_script();
    assert!(would_insert_nothing(&conn, SCREENS_SEED));
    // SQLite fires a BEFORE INSERT trigger even for a row `OR IGNORE` then
    // discards, so on a table that carries one the statement can have an effect
    // beyond the rows it does not insert — and is therefore run as before.
    conn.execute_batch(
        "CREATE TRIGGER screens_validate BEFORE INSERT ON screens \
         BEGIN SELECT RAISE(ABORT, 'bad screen'); END;",
    )
    .unwrap();
    assert!(!would_insert_nothing(&conn, SCREENS_SEED));
}

#[test]
fn a_partial_unique_index_is_not_evidence() {
    let conn = fresh();
    // Two tables with the same row and the same index over `code` — one partial,
    // one not. The partial index does not cover the row that is there, so the
    // attempt really would insert, and the proof must agree with the database
    // rather than with the index's column list.
    conn.execute_batch(
        "CREATE TABLE partials (id INTEGER PRIMARY KEY, code TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);\
         CREATE UNIQUE INDEX idx_partials_code ON partials (code) WHERE active = 1;\
         INSERT INTO partials (code, active) VALUES ('x', 0);\
         CREATE TABLE plains (id INTEGER PRIMARY KEY, code TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);\
         CREATE UNIQUE INDEX idx_plains_code ON plains (code);\
         INSERT INTO plains (code, active) VALUES ('x', 0);",
    )
    .unwrap();

    assert!(!would_insert_nothing(
        &conn,
        "INSERT OR IGNORE INTO partials (code) VALUES ('x')"
    ));
    // Control: the same statement, the same row, an index that is not partial.
    assert!(would_insert_nothing(
        &conn,
        "INSERT OR IGNORE INTO plains (code) VALUES ('x')"
    ));

    // …and both verdicts match what the database actually does.
    conn.execute_batch("INSERT OR IGNORE INTO partials (code) VALUES ('x')")
        .unwrap();
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM partials"), 2);
    conn.execute_batch("INSERT OR IGNORE INTO plains (code) VALUES ('x')")
        .unwrap();
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM plains"), 1);
}

#[test]
fn a_seed_that_names_no_unique_column_is_never_skipped() {
    let conn = screens_like_the_init_script();
    assert!(would_insert_nothing(&conn, SCREENS_SEED));
    // `workspace_key` and `sort_order` are not unique on their own, so a row
    // matching on them is not a row already there.
    assert!(!would_insert_nothing(
        &conn,
        "INSERT OR IGNORE INTO screens (workspace_key, sort_order) VALUES ('pos', 1)"
    ));
}

#[test]
fn a_null_in_a_unique_column_is_not_evidence() {
    let conn = fresh();
    conn.execute_batch(
        "CREATE TABLE nullables (id INTEGER PRIMARY KEY, tag TEXT UNIQUE);\
         INSERT INTO nullables (tag) VALUES (NULL);",
    )
    .unwrap();
    // SQLite treats NULLs as distinct, so the second NULL is inserted rather
    // than ignored — and a `NULL` literal never matches `column = ?` anyway.
    assert!(!would_insert_nothing(
        &conn,
        "INSERT OR IGNORE INTO nullables (tag) VALUES (NULL)"
    ));
    conn.execute_batch("INSERT OR IGNORE INTO nullables (tag) VALUES (NULL)")
        .unwrap();
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM nullables"), 2);
}

#[test]
fn only_the_plain_seed_shape_is_skipped_before_execution() {
    let conn = screens_like_the_init_script();
    assert!(would_insert_nothing(&conn, SCREENS_SEED));
    // Without `OR IGNORE` the statement is not a no-op.
    assert!(!would_insert_nothing(
        &conn,
        &SCREENS_SEED.replacen("INSERT OR IGNORE", "INSERT", 1)
    ));
    // A `SELECT` source offers rows the proof cannot read.
    assert!(!would_insert_nothing(
        &conn,
        "INSERT OR IGNORE INTO screens (workspace_key, screen_key) SELECT 'pos', 'grid'"
    ));
    // Anything following the rows means this is not the shape the proof read.
    let mut trailing = SCREENS_SEED.to_string();
    trailing.push_str(" RETURNING id");
    assert!(!would_insert_nothing(&conn, &trailing));
    // And a statement whose rows are malformed is not a skip either.
    assert!(!would_insert_nothing(
        &conn,
        "INSERT OR IGNORE INTO screens (workspace_key, screen_key) VALUES ('pos')"
    ));
}

#[test]
fn create_table_is_never_skipped() {
    let conn = loyalty_after_the_fixedpoint_migration();
    // `sqlite_master.sql` is not a record of the statement that created the
    // table, so agreement there would prove nothing.
    assert!(!satisfied(
        &conn,
        "CREATE TABLE loyalty_tiers (id TEXT PRIMARY KEY, name TEXT NOT NULL)",
        "table loyalty_tiers already exists"
    ));
}

#[test]
fn a_statement_kind_the_proof_cannot_read_is_never_skipped() {
    let conn = loyalty_after_the_fixedpoint_migration();
    assert!(!satisfied(
        &conn,
        "UPDATE loyalty_tiers SET name = name, earn_multiplier = 1.0",
        ABSENT_COLUMN_ERROR
    ));
}

#[test]
fn add_column_proof_compares_the_whole_declaration() {
    let conn = fresh();
    conn.execute_batch(
        "CREATE TABLE products (id TEXT PRIMARY KEY, sku TEXT NOT NULL DEFAULT 'x')",
    )
    .unwrap();

    let matching = "ALTER TABLE products ADD COLUMN sku TEXT NOT NULL DEFAULT 'x'";
    assert!(satisfied(&conn, matching, "duplicate column name: sku"));
    // Control: the same column, a different default.
    assert!(!satisfied(
        &conn,
        "ALTER TABLE products ADD COLUMN sku TEXT NOT NULL DEFAULT 'y'",
        "duplicate column name: sku"
    ));
    // Control: the same column, nullability dropped.
    assert!(!satisfied(
        &conn,
        "ALTER TABLE products ADD COLUMN sku TEXT DEFAULT 'x'",
        "duplicate column name: sku"
    ));
    // A different column entirely.
    assert!(!satisfied(
        &conn,
        "ALTER TABLE products ADD COLUMN missing TEXT",
        "duplicate column name: sku"
    ));
}

#[test]
fn split_statements_ignores_semicolons_in_comments_literals_and_trigger_bodies() {
    let sql = "\
-- a line comment with a ; semicolon\n\
CREATE TABLE t (a TEXT DEFAULT 'x;y');\n\
/* a block comment with a ; semicolon */\n\
CREATE TRIGGER trg AFTER INSERT ON t BEGIN\n\
    UPDATE t SET a = CASE WHEN a IS NULL THEN 'none' ELSE a END;\n\
    DELETE FROM t WHERE a = 'gone;';\n\
END;\n\
CREATE INDEX idx_t_a ON t(a);\n";

    let statements = split_statements(sql);

    // Lossless: no fragment can be dropped without changing the script.
    assert_eq!(statements.concat(), sql);

    let significant: Vec<&str> = statements
        .iter()
        .copied()
        .filter(|statement| !canonical_ddl(statement).is_empty())
        .collect();
    assert_eq!(significant.len(), 3, "got: {significant:#?}");
    assert!(
        significant[0].contains("CREATE TABLE t"),
        "{}",
        significant[0]
    );
    assert!(
        significant[1].contains("CREATE TRIGGER trg"),
        "{}",
        significant[1]
    );
    // The body's own `;` separators and the `CASE … END` inside it must
    // not split the statement.
    assert!(
        significant[1].trim_end().ends_with("END;"),
        "the trigger body must stay one statement: {}",
        significant[1]
    );
    assert!(
        significant[2].contains("CREATE INDEX idx_t_a"),
        "{}",
        significant[2]
    );
}

#[test]
fn canonical_ddl_ignores_if_not_exists_and_comments() {
    // SQLite stores a table's DDL without the `IF NOT EXISTS` clause it
    // was created with, so the two forms must compare equal.
    let stored = "CREATE TABLE product_images (product_id TEXT NOT NULL)";
    let statement = "CREATE TABLE IF NOT EXISTS product_images (\n\
                     product_id TEXT NOT NULL  -- the owning product\n\
                     );";
    assert_eq!(canonical_ddl(stored), canonical_ddl(statement));
}

#[test]
fn only_a_real_statement_is_significant() {
    // The fragments the splitter returns that have no effect: nothing at all,
    // whitespace, and nothing but comments. The comment case is covered
    // indirectly by `split_statements_ignores_semicolons_…`, through its count of
    // significant fragments; the empty and whitespace-only cases are asserted
    // nowhere else.
    assert!(!is_significant(""));
    assert!(!is_significant("   \n\t  "));
    assert!(!is_significant("-- just a comment\n"));
    assert!(!is_significant("/* just a block comment */"));
    // A real statement is significant, however it is padded.
    assert!(is_significant("CREATE TABLE t (a TEXT);"));
    assert!(is_significant("  \nCREATE TABLE t (a TEXT);  "));
}
