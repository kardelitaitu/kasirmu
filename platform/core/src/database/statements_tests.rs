//! Tests for the SQL statement layer — splitting, tokenizing, comparing.
//!
//! The splitter's contract is losslessness and the four hiding places of a
//! `;`; the canonical form's contract is that the text SQLite stores and the
//! text a migration declares compare equal once `IF NOT EXISTS` and comments
//! are out of the way. The proofs that decide to skip a statement have their
//! own file: `proofs_tests.rs`.

use super::*;

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
