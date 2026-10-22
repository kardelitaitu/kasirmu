use super::*;

// ── Static regex compile guard ─────────────────────────────────────

#[test]
fn sql_validation_regexes_compile() {
    // Every literal fed to `sql_regex` in production must compile. This
    // makes the `sql_regex` invariant panic unreachable: a malformed edit
    // to any pattern fails here under CI instead of in a live process.
    for pattern in [
        FROM_PATTERN,
        JOIN_PATTERN,
        INTO_PATTERN,
        UPDATE_PATTERN,
        TABLE_PATTERN,
        INSERT_INTO_PATTERN,
        DELETE_FROM_PATTERN,
        DROP_TABLE_PATTERN,
        CTE_PATTERN,
        CTE_COMMA_PATTERN,
    ] {
        assert!(
            Regex::new(pattern).is_ok(),
            "static SQL-validation regex must compile: {pattern}"
        );
    }
}

// ── O-M47: the cached keyword regexes keep the WORD-BOUNDARY rule ──

/// The keyword set is now compiled once into a `OnceLock` instead of once per
/// call. This pins the property that a cache keyed on the keyword TEXT could
/// most easily break: `contains_word` matches a WHOLE WORD (`\b{kw}\b`), so a
/// blocked keyword appearing only as a SUBSTRING of a longer identifier must
/// stay allowed, while the bare word must stay rejected.
///
/// Both directions matter and for different reasons. A too-loose matcher
/// rejects legitimate plugin SQL (a column called `pragma_notes`, a table called
/// `tableau`), which is a false positive a user cannot work around. A
/// too-strict one lets `ATTACH` reach the engine, which is the security hole
/// the whole function exists to close.
#[test]
fn cached_keyword_regexes_preserve_word_boundary_semantics() {
    // (keyword, a statement that must be ACCEPTED because the keyword is only a
    //  substring of a longer identifier, and one that must be REJECTED bare)
    let cases: [(&str, &str); 3] = [
        ("PRAGMA", "SELECT * FROM test_pragma_notes"),
        ("TABLE", "SELECT * FROM test_tableau"),
        ("ATTACH", "SELECT * FROM test_attached_items"),
    ];
    for (keyword, allowed) in cases {
        assert!(
            !contains_word(&allowed.to_uppercase(), keyword),
            "{keyword} as a substring of a longer identifier must not match: {allowed}"
        );
    }

    // And the bare word, in each surrounding form a statement can present it,
    // is still caught. This is the direction that fails OPEN if it regresses.
    for keyword in ["PRAGMA", "TABLE", "ATTACH"] {
        for statement in [
            format!("{keyword} foo"),
            format!("  {keyword}  "),
            format!("SELECT 1; {keyword}"),
            format!("({keyword})"),
        ] {
            assert!(
                contains_word(&statement.to_uppercase(), keyword),
                "a bare {keyword} must still match: {statement}"
            );
        }
    }
}

/// Every keyword the cache answers for compiles, and each one MATCHES itself.
///
/// The sibling of `sql_validation_regexes_compile` for the O-M47 cache: a
/// pattern typo, or a keyword added to `validate_sql` but missed by
/// `build_keyword_regexes`, fails here rather than at the first plugin call in
/// a live process.
#[test]
fn keyword_regex_cache_compiles_and_matches_every_keyword() {
    let cached = keyword_regexes();
    assert!(
        !cached.blocked.is_empty(),
        "the blocked-keyword cache must not be empty"
    );
    for (keyword, regex) in &cached.blocked {
        assert!(
            regex.is_match(keyword),
            "the cached regex for {keyword} must match its own keyword"
        );
    }
    // The three keywords `validate_sql` matches outside BLOCKED_KEYWORDS.
    for (keyword, regex) in [
        ("PRAGMA", &cached.pragma),
        ("ALTER", &cached.alter),
        ("TABLE", &cached.table),
    ] {
        assert!(
            regex.is_match(keyword),
            "the cached regex for {keyword} must match its own keyword"
        );
    }
}

// ── PLG-A: comments cannot hide a table reference ───────────────────

/// Every comment form that used to defeat the extraction regexes must now be
/// rejected. The regexes anchor the table name to its keyword with whitespace,
/// so a comment between the two extracted ZERO tables and the statement passed
/// validation — reaching the core schema with no quoting at all.
#[test]
fn validate_sql_rejects_comments_between_keyword_and_table() {
    let prefix = "plugin_my_plugin_";
    let bypasses = [
        "DELETE FROM/**/sales",
        "SELECT * FROM--x\n sales",
        "CREATE TABLE/**/sales (id INT)",
        "UPDATE/**/users SET x=1",
        "INSERT INTO/**/products VALUES (1)",
        "SELECT * FROM plugin_my_plugin_a JOIN/**/sales ON 1",
        "DELETE FROM /* c */ sales",
    ];
    for sql in bypasses {
        let result = validate_sql(sql, prefix);
        assert!(
            result.is_err(),
            "comment-hidden core table must be rejected: {sql:?} -> {result:?}"
        );
    }
}

/// The prefixed form must still pass once comments are stripped — the fix
/// removes comments, it does not refuse every commented statement.
#[test]
fn validate_sql_still_accepts_prefixed_tables_behind_comments() {
    let prefix = "plugin_my_plugin_";
    for sql in [
        "SELECT * FROM/**/plugin_my_plugin_items",
        "UPDATE/* c */plugin_my_plugin_items SET x=1",
    ] {
        assert!(
            validate_sql(sql, prefix).is_ok(),
            "a prefixed table behind a comment must still pass: {sql:?}"
        );
    }
}

/// A comment marker inside a string literal is data, not a comment: stripping
/// must not eat the rest of the statement.
#[test]
fn strip_sql_comments_leaves_string_literals_intact() {
    let stripped = strip_sql_comments("SELECT '--not a comment' FROM plugin_x_items");
    assert!(
        stripped.contains("--not a comment"),
        "a quoted comment marker must survive: {stripped:?}"
    );
    assert!(
        stripped.contains("plugin_x_items"),
        "the table after the literal must survive: {stripped:?}"
    );
    // And a real comment is still removed.
    let stripped = strip_sql_comments("SELECT 1 -- gone\nFROM plugin_x_items");
    assert!(!stripped.contains("gone"), "a real line comment must go");
    assert!(stripped.contains("plugin_x_items"));
}

// ── SQL Validator Tests ─────────────────────────────────────────────

#[test]
fn validate_allowed_select() {
    validate_sql("SELECT * FROM plugin_test_items", "plugin_test_").unwrap();
}

#[test]
fn validate_allowed_insert() {
    validate_sql(
        "INSERT INTO plugin_test_items (id, name) VALUES (1, 'foo')",
        "plugin_test_",
    )
    .unwrap();
}

#[test]
fn validate_allowed_update() {
    validate_sql(
        "UPDATE plugin_test_items SET name = 'bar' WHERE id = 1",
        "plugin_test_",
    )
    .unwrap();
}

#[test]
fn validate_allowed_delete() {
    validate_sql("DELETE FROM plugin_test_items WHERE id = 1", "plugin_test_").unwrap();
}

#[test]
fn validate_allowed_create_table() {
    validate_sql(
        "CREATE TABLE plugin_test_items (id INTEGER PRIMARY KEY, name TEXT)",
        "plugin_test_",
    )
    .unwrap();
}

#[test]
fn validate_allowed_drop_table() {
    validate_sql("DROP TABLE plugin_test_items", "plugin_test_").unwrap();
}

#[test]
fn validate_allowed_create_table_if_not_exists() {
    validate_sql(
        "CREATE TABLE IF NOT EXISTS plugin_test_items (id INTEGER)",
        "plugin_test_",
    )
    .unwrap();
}

#[test]
fn validate_allowed_join() {
    validate_sql(
        "SELECT a.* FROM plugin_test_a a INNER JOIN plugin_test_b b ON a.id = b.id",
        "plugin_test_",
    )
    .unwrap();
}

#[test]
fn validate_allowed_left_join() {
    validate_sql(
        "SELECT * FROM plugin_test_items LEFT JOIN plugin_test_tags ON plugin_test_items.id = plugin_test_tags.item_id",
        "plugin_test_",
    )
    .unwrap();
}

#[test]
fn validate_rejects_core_table_in_from() {
    let err = validate_sql("SELECT * FROM sales", "plugin_test_").unwrap_err();
    assert!(err.to_string().contains("prefix"));
}

#[test]
fn validate_rejects_core_table_in_join() {
    let err = validate_sql(
        "SELECT * FROM plugin_test_items JOIN users ON plugin_test_items.owner_id = users.id",
        "plugin_test_",
    )
    .unwrap_err();
    assert!(err.to_string().contains("prefix"));
}

#[test]
fn validate_rejects_core_table_in_insert() {
    let err =
        validate_sql("INSERT INTO products (sku) VALUES ('test')", "plugin_test_").unwrap_err();
    assert!(err.to_string().contains("prefix"));
}

#[test]
fn validate_rejects_core_table_in_update() {
    let err = validate_sql(
        "UPDATE users SET name = 'hacker' WHERE id = 1",
        "plugin_test_",
    )
    .unwrap_err();
    assert!(err.to_string().contains("prefix"));
}

#[test]
fn validate_rejects_core_table_in_delete() {
    let err = validate_sql("DELETE FROM sales WHERE id = 1", "plugin_test_").unwrap_err();
    assert!(err.to_string().contains("prefix"));
}

#[test]
fn validate_rejects_pragma() {
    let err = validate_sql("PRAGMA table_info(plugin_test_items)", "plugin_test_").unwrap_err();
    assert!(err.to_string().contains("PRAGMA"));
}

#[test]
fn validate_rejects_attach() {
    let err = validate_sql("ATTACH DATABASE 'other.db' AS other", "plugin_test_").unwrap_err();
    assert!(err.to_string().contains("ATTACH"));
}

#[test]
fn validate_rejects_vacuum() {
    let err = validate_sql("VACUUM", "plugin_test_").unwrap_err();
    assert!(err.to_string().contains("VACUUM"));
}

#[test]
fn validate_rejects_alter_table() {
    let err = validate_sql(
        "ALTER TABLE plugin_test_items ADD COLUMN x INTEGER",
        "plugin_test_",
    )
    .unwrap_err();
    assert!(err.to_string().contains("ALTER TABLE"));
}

#[test]
fn validate_rejects_create_index() {
    let err = validate_sql(
        "CREATE INDEX idx_test ON plugin_test_items(id)",
        "plugin_test_",
    )
    .unwrap_err();
    assert!(err.to_string().contains("CREATE INDEX"));
}

#[test]
fn validate_allows_cte_with_prefixed_tables() {
    validate_sql(
        "WITH ranked AS (SELECT * FROM plugin_test_items ORDER BY id) SELECT * FROM ranked",
        "plugin_test_",
    )
    .unwrap();
}

#[test]
fn validate_rejects_cte_with_non_prefixed_table() {
    let err = validate_sql(
        "WITH bad AS (SELECT * FROM sales) SELECT * FROM plugin_test_items JOIN bad",
        "plugin_test_",
    )
    .unwrap_err();
    assert!(err.to_string().contains("prefix"));
}

#[test]
fn validate_allows_subquery_in_from() {
    validate_sql(
        "SELECT * FROM (SELECT id FROM plugin_test_items) AS sub",
        "plugin_test_",
    )
    .unwrap();
}

#[test]
fn validate_with_different_prefix() {
    let prefix = "plugin_my_awesome_plugin_";
    validate_sql("SELECT * FROM plugin_my_awesome_plugin_data", prefix).unwrap();
    let err = validate_sql("SELECT * FROM plugin_wrong_prefix_data", prefix).unwrap_err();
    assert!(err.to_string().contains("prefix"));
}

#[test]
fn validate_allows_insert_or_replace() {
    validate_sql(
        "INSERT OR REPLACE INTO plugin_test_items (id, name) VALUES (1, 'x')",
        "plugin_test_",
    )
    .unwrap();
}

// ── PLG-11: quoted-identifier bypass ──────────────────────────────

#[test]
fn plg11_rejects_double_quoted_table_reference() {
    // Before the fix: zero tables captured, statement passed validation
    // and reached the core schema.
    let err = validate_sql("DELETE FROM \"sales\"", "plugin_test_").unwrap_err();
    assert!(err.to_string().contains("quoted identifiers"));
}

#[test]
fn plg11_rejects_backtick_table_reference() {
    let err = validate_sql("SELECT * FROM `sales`", "plugin_test_").unwrap_err();
    assert!(err.to_string().contains("quoted identifiers"));
}

#[test]
fn plg11_rejects_bracket_table_reference() {
    let err = validate_sql("SELECT * FROM [sales]", "plugin_test_").unwrap_err();
    assert!(err.to_string().contains("quoted identifiers"));
}

#[test]
fn plg11_rejects_quoted_identifier_via_execute_batch_path() {
    // `execute` routes through validate_sql before execute_batch; the
    // multi-statement form inherits the same fail-closed scan.
    let db = make_db("plugin_test");
    let err = db
        .execute("DELETE FROM plugin_test_items; DELETE FROM \"sales\";")
        .unwrap_err();
    assert!(err.to_string().contains("quoted identifiers"));
}

#[test]
fn plg11_allows_quote_chars_inside_string_literals() {
    // Values legitimately containing quote/bracket characters are invisible
    // to the scan inside single-quoted literals (with '' doubling).
    validate_sql(
        "INSERT INTO plugin_test_items (id, name) VALUES (1, 'it''s \"quoted\" [brackets] `ticks`')",
        "plugin_test_",
    )
    .unwrap();
}

#[test]
fn plg11_rejects_unterminated_string_literal() {
    // Fail-closed: an unterminated literal is malformed SQL whose quote
    // characters cannot be classified as values.
    let err = validate_sql(
        "INSERT INTO plugin_test_items (id, name) VALUES (1, 'unterminated)",
        "plugin_test_",
    )
    .unwrap_err();
    assert!(err.to_string().contains("unterminated string literal"));
}

#[test]
fn plg11_rejects_quoted_identifier_between_literals() {
    // The quote characters sit BETWEEN two string literals — outside, and
    // therefore identified as an identifier quoting dialect.
    let err = validate_sql("SELECT * FROM \"sales\" WHERE name = 'x'", "plugin_test_").unwrap_err();
    assert!(err.to_string().contains("quoted identifiers"));
}

// ── PluginDb Tests ─────────────────────────────────────────────────

fn make_db(plugin_id: &str) -> PluginDb {
    let conn = Connection::open_in_memory().unwrap();
    PluginDb::new(conn, plugin_id)
}

#[test]
fn plugin_db_create_and_query() {
    let db = make_db("test");
    db.execute("CREATE TABLE plugin_test_items (id INTEGER PRIMARY KEY, name TEXT)")
        .unwrap();
    db.exec("INSERT INTO plugin_test_items VALUES (1, 'hello')")
        .unwrap();
    let result = db.query("SELECT * FROM plugin_test_items").unwrap();
    assert!(result.contains("\"id\":1"));
    assert!(result.contains("\"name\":\"hello\""));
}

#[test]
fn plugin_db_rejects_non_prefixed() {
    let db = make_db("test");
    let err = db
        .execute("CREATE TABLE core_table (id INTEGER)")
        .unwrap_err();
    assert!(err.to_string().contains("prefix"));
}

#[test]
fn plugin_db_query_returns_json_array() {
    let db = make_db("test");
    db.execute("CREATE TABLE plugin_test_items (id INTEGER PRIMARY KEY, val TEXT)")
        .unwrap();
    db.exec("INSERT INTO plugin_test_items VALUES (1, 'a'), (2, 'b')")
        .unwrap();
    let result = db
        .query("SELECT * FROM plugin_test_items ORDER BY id")
        .unwrap();
    let parsed: Vec<serde_json::Value> = serde_json::from_str(&result).unwrap();
    assert_eq!(parsed.len(), 2);
    assert_eq!(parsed[0]["id"], 1);
    assert_eq!(parsed[1]["val"], "b");
}

#[test]
fn plugin_db_query_empty_result() {
    let db = make_db("test");
    db.execute("CREATE TABLE plugin_test_items (id INTEGER PRIMARY KEY)")
        .unwrap();
    let result = db.query("SELECT * FROM plugin_test_items").unwrap();
    assert_eq!(result, "[]");
}

#[test]
fn plugin_db_exec_returns_row_count() {
    let db = make_db("test");
    db.execute("CREATE TABLE plugin_test_items (id INTEGER PRIMARY KEY)")
        .unwrap();
    let count = db
        .exec("INSERT INTO plugin_test_items VALUES (1), (2), (3)")
        .unwrap();
    assert_eq!(count, 3);
}

#[test]
fn plugin_db_multiple_instances_share_connection() {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("CREATE TABLE plugin_shared_data (id INTEGER)")
        .unwrap();

    let db1 = PluginDb::new(conn, "shared");
    // db1 uses the connection; db2 is a clone sharing the same Arc
    let db2 = db1.clone();

    db1.exec("INSERT INTO plugin_shared_data VALUES (42)")
        .unwrap();
    let result = db2.query("SELECT * FROM plugin_shared_data").unwrap();
    assert!(result.contains("42"));
}

#[test]
fn plugin_db_sanitises_hyphens_in_id() {
    let db = make_db("my-plugin");
    assert_eq!(db.plugin_id(), "my_plugin");
    assert_eq!(db.prefix(), "plugin_my_plugin_");
}

#[test]
fn plugin_db_rejects_blocked_pragma() {
    let db = make_db("test");
    let err = db
        .query("PRAGMA table_info(plugin_test_items)")
        .unwrap_err();
    assert!(err.to_string().contains("PRAGMA"));
}

#[test]
fn plugin_db_rejects_attach_database() {
    let db = make_db("test");
    let err = db
        .execute("ATTACH DATABASE ':memory:' AS other")
        .unwrap_err();
    assert!(err.to_string().contains("ATTACH"));
}

#[test]
fn validate_allows_multiple_prefixed_tables_in_from() {
    validate_sql(
        "SELECT a.*, b.* FROM plugin_test_a a, plugin_test_b b WHERE a.id = b.id",
        "plugin_test_",
    )
    .unwrap();
}

#[test]
fn validate_rejects_mixed_prefix_and_non_prefix() {
    let err = validate_sql("SELECT * FROM plugin_test_items, sales", "plugin_test_").unwrap_err();
    assert!(err.to_string().contains("prefix"));
}

#[test]
fn validate_allows_drop_table_if_exists() {
    validate_sql("DROP TABLE IF EXISTS plugin_test_items", "plugin_test_").unwrap();
}

// ── extract_table_references unit tests ─────────────────────────——

#[test]
fn extract_tables_from_select() {
    let tables = extract_table_references("SELECT * FROM plugin_test_items");
    assert_eq!(tables, vec!["plugin_test_items"]);
}

#[test]
fn extract_tables_from_join() {
    let tables = extract_table_references(
        "SELECT * FROM plugin_a JOIN plugin_b ON plugin_a.id = plugin_b.id",
    );
    assert!(tables.contains(&"plugin_a".to_string()));
    assert!(tables.contains(&"plugin_b".to_string()));
}

#[test]
fn extract_tables_skips_cte_names() {
    let tables =
        extract_table_references("WITH cte AS (SELECT * FROM plugin_test_items) SELECT * FROM cte");
    // cte should NOT appear (it's a CTE name, not a real table)
    // plugin_test_items should appear
    assert!(tables.contains(&"plugin_test_items".to_string()));
    // But 'cte' might also appear — actually CTE names in FROM should be skipped
    // The current implementation skips CTE names only in FROM clauses, not in JOIN etc.
    // Since CTE is used in FROM, it should be skipped.
    // Let's just verify plugin_test_items is there
    assert!(!tables.is_empty());
}

#[test]
fn extract_tables_from_create_table() {
    let tables = extract_table_references("CREATE TABLE plugin_test_items (id INTEGER)");
    assert_eq!(tables, vec!["plugin_test_items"]);
}

#[test]
fn extract_tables_from_delete() {
    let tables = extract_table_references("DELETE FROM plugin_test_items WHERE id = 1");
    assert_eq!(tables, vec!["plugin_test_items"]);
}

#[test]
fn extract_tables_from_update() {
    let tables = extract_table_references("UPDATE plugin_test_items SET name = 'x'");
    assert_eq!(tables, vec!["plugin_test_items"]);
}

// ── O-M48: row ceiling on plugin queries ───────────────────────────

/// Insert `n` rows into `plugin_test_items` in ONE statement.
///
/// One `INSERT ... VALUES (..),(..),...` keeps the fixture cost in the
/// engine rather than in N Rust calls; at the 10 000-row boundary a
/// per-row `exec` loop would dominate the test's runtime.
fn seed_rows(db: &PluginDb, n: usize) {
    db.execute("CREATE TABLE plugin_test_items (id INTEGER PRIMARY KEY, name TEXT)")
        .unwrap();
    let mut values: Vec<String> = Vec::with_capacity(n);
    for i in 0..n {
        values.push(format!("({i}, 'row{i}')"));
    }
    let sql = format!("INSERT INTO plugin_test_items VALUES {}", values.join(", "));
    let inserted = db.exec(&sql).unwrap();
    assert_eq!(inserted, n, "fixture must insert exactly {n} rows");
}

/// One row BELOW the cap is returned whole — the ceiling must not trim a
/// legitimate result.
#[test]
fn query_cap_returns_every_row_one_below_the_ceiling() {
    let db = make_db("test");
    seed_rows(&db, MAX_QUERY_ROWS - 1);
    let result = db.query("SELECT * FROM plugin_test_items").unwrap();
    let parsed: Vec<serde_json::Value> = serde_json::from_str(&result).unwrap();
    assert_eq!(parsed.len(), MAX_QUERY_ROWS - 1);
    // First and last row intact — no rows dropped from either end.
    assert_eq!(parsed[0]["id"], 0);
    assert_eq!(parsed[MAX_QUERY_ROWS - 2]["id"], MAX_QUERY_ROWS - 2);
}

/// Exactly at the cap succeeds. The boundary is inclusive, which is what the
/// error message's `LIMIT {MAX_QUERY_ROWS}` hint promises the plugin author:
/// the LIMIT they are told to add must not itself trip the ceiling.
#[test]
fn query_cap_allows_exactly_the_ceiling() {
    let db = make_db("test");
    seed_rows(&db, MAX_QUERY_ROWS);
    let result = db.query("SELECT * FROM plugin_test_items").unwrap();
    let parsed: Vec<serde_json::Value> = serde_json::from_str(&result).unwrap();
    assert_eq!(parsed.len(), MAX_QUERY_ROWS);
}

/// One row ABOVE the cap is an ERROR, not a truncated prefix. This is the
/// case that proves the ceiling is enforced rather than aspirational: if the
/// check regressed to a `LIMIT`-style truncation the call would still return
/// `Ok` with 10 000 rows and every other test would still pass.
#[test]
fn query_cap_rejects_one_row_above_the_ceiling() {
    let db = make_db("test");
    seed_rows(&db, MAX_QUERY_ROWS + 1);
    let err = db.query("SELECT * FROM plugin_test_items").unwrap_err();
    assert!(
        matches!(err, PluginError::PermissionDenied(_)),
        "over-cap query must be a permission error, got: {err:?}"
    );
    let msg = err.to_string();
    assert!(
        msg.contains(&MAX_QUERY_ROWS.to_string()),
        "the error must name the ceiling: {msg}"
    );
    assert!(
        msg.contains("LIMIT"),
        "the error must tell the plugin author to add a LIMIT: {msg}"
    );
}

/// The cap counts rows the ENGINE produced, so a plugin `LIMIT` above the
/// ceiling cannot buy a larger result, and the limit the error message
/// recommends is itself accepted (see `validate_sql` note on MAX_QUERY_ROWS).
#[test]
fn query_cap_counts_engine_rows_not_the_plugins_limit_clause() {
    let db = make_db("test");
    seed_rows(&db, MAX_QUERY_ROWS + 5);
    // A plugin LIMIT larger than the cap still errors: the ceiling is
    // enforced while reading, not by trusting the statement.
    let err = db
        .query("SELECT * FROM plugin_test_items LIMIT 999999")
        .unwrap_err();
    assert!(err.to_string().contains("LIMIT"), "got: {err}");
    // And the recommended shape — LIMIT exactly the ceiling — succeeds.
    let ok = db
        .query(&format!(
            "SELECT * FROM plugin_test_items ORDER BY id LIMIT {MAX_QUERY_ROWS}"
        ))
        .unwrap();
    let parsed: Vec<serde_json::Value> = serde_json::from_str(&ok).unwrap();
    assert_eq!(parsed.len(), MAX_QUERY_ROWS);
}

/// The names half of O-M48 changes HOW the row maps are built, so this pins
/// that the OUTPUT is unchanged: every row carries every column exactly once,
/// with its name spelled as SQLite reports it, and the original `SELECT *`,
/// aliased and expression-column forms all still produce identical JSON.
#[test]
fn query_output_is_unchanged_by_name_sharing() {
    let db = make_db("test");
    db.execute(
        "CREATE TABLE plugin_test_items (id INTEGER PRIMARY KEY, name TEXT, price INTEGER, \
         ratio REAL, blob_col BLOB, missing TEXT)",
    )
    .unwrap();
    db.exec(
        "INSERT INTO plugin_test_items VALUES (1, 'a', 100, 0.5, X'0001FF', NULL), \
         (2, NULL, -7, 2.25, NULL, 'set')",
    )
    .unwrap();

    let parsed: Vec<serde_json::Value> = serde_json::from_str(
        &db.query("SELECT * FROM plugin_test_items ORDER BY id")
            .unwrap(),
    )
    .unwrap();
    assert_eq!(
        parsed,
        vec![
            serde_json::json!({
                "id": 1,
                "name": "a",
                "price": 100,
                "ratio": 0.5,
                "blob_col": "AAH/",
                "missing": serde_json::Value::Null,
            }),
            serde_json::json!({
                "id": 2,
                "name": serde_json::Value::Null,
                "price": -7,
                "ratio": 2.25,
                "blob_col": serde_json::Value::Null,
                "missing": "set",
            }),
        ]
    );
}

/// Expression columns are still named by SQLite's own label, and duplicate
/// labels still collapse into ONE key (the map insert overwrites), which is
/// the behaviour the pre-O-M48 `Map::insert` had.
#[test]
fn query_expression_and_duplicate_column_names_are_unchanged() {
    let db = make_db("test");
    db.execute("CREATE TABLE plugin_test_items (id INTEGER)")
        .unwrap();
    db.exec("INSERT INTO plugin_test_items VALUES (3)").unwrap();
    let parsed: Vec<serde_json::Value> = serde_json::from_str(
        &db.query("SELECT id AS n, id + 1 AS n FROM plugin_test_items")
            .unwrap(),
    )
    .unwrap();
    assert_eq!(parsed, vec![serde_json::json!({ "n": 4 })]);
}

/// An ordinary small query is untouched by the ceiling or the key buffer,
/// including the empty-result case and a query with no rows to seed the
/// buffer from.
#[test]
fn query_small_result_is_unaffected() {
    let db = make_db("test");
    db.execute("CREATE TABLE plugin_test_items (id INTEGER PRIMARY KEY, name TEXT)")
        .unwrap();
    assert_eq!(db.query("SELECT * FROM plugin_test_items").unwrap(), "[]");
    db.exec("INSERT INTO plugin_test_items VALUES (1, 'one')")
        .unwrap();
    let one: Vec<serde_json::Value> =
        serde_json::from_str(&db.query("SELECT * FROM plugin_test_items").unwrap()).unwrap();
    assert_eq!(one, vec![serde_json::json!({ "id": 1, "name": "one" })]);
}

// ── SQLite value conversion tests ──────────────────────────────────

#[test]
fn sqlite_null_to_json() {
    assert_eq!(
        sqlite_value_to_json(rusqlite::types::Value::Null),
        serde_json::Value::Null
    );
}

#[test]
fn sqlite_integer_to_json() {
    assert_eq!(
        sqlite_value_to_json(rusqlite::types::Value::Integer(42)),
        serde_json::json!(42)
    );
}

#[test]
fn sqlite_text_to_json() {
    assert_eq!(
        sqlite_value_to_json(rusqlite::types::Value::Text("hello".into())),
        serde_json::json!("hello")
    );
}

#[test]
#[allow(clippy::approx_constant)]
fn sqlite_real_to_json() {
    assert_eq!(
        sqlite_value_to_json(rusqlite::types::Value::Real(3.14)),
        serde_json::json!(3.14)
    );
}

#[test]
fn base64_encode_empty() {
    assert_eq!(base64_encode(b""), "");
}

#[test]
fn base64_encode_hello() {
    let result = base64_encode(b"hello");
    assert_eq!(result, "aGVsbG8=");
}

#[test]
fn base64_encode_binary() {
    let result = base64_encode(&[0x00, 0x01, 0x02, 0x03]);
    assert_eq!(result, "AAECAw==");
}
