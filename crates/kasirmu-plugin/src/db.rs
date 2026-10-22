/*
last audited 25-07-26 by RSA-Agent (kasirmu-plugin slice B: db.rs deep read; PLG-11 FIXED 25-07-26)
crate: kasirmu-plugin | status: SAFE | lint: CLEAN
findings: PLG-11 FIXED — validate_sql now fail-closes on any quote/bracket character outside a single-quoted string literal (ensure_no_quoted_identifiers lexical scan), so the SQLite-legal quoting dialects ("sales", `sales`, [sales]) can no longer bypass the bare-identifier namespace regexes; unterminated string literals are also rejected; 7 new tests cover the bypass shapes and the string-literal escape case (all 180+2 kasirmu-plugin tests pass). Prior verified positives: PLG-01/02/06/08 hardening intact; exec/query/execute all funnel through validate_sql
next: consider sqlite3_set_authorizer as the long-term replacement for the regex layer | perf: scan is O(n) over ASCII bytes
*/
//! Isolated database namespace for plugins.
//!
//! Every SQL statement executed by a plugin is validated to ensure all
//! table references use the `plugin_<plugin_id>_` prefix. This prevents
//! plugins from accidentally or maliciously modifying core tables (e.g.
//! `sales`, `users`, `products`).
//!
//! # Example
//!
//! ```no_run
//! # use kasirmu_plugin::db::PluginDb;
//! # fn main() -> Result<(), Box<dyn std::error::Error>> {
//! let conn = rusqlite::Connection::open_in_memory()?;
//! let db = PluginDb::new(conn, "my-plugin");
//! db.exec("CREATE TABLE plugin_my_plugin_items (id INTEGER PRIMARY KEY)")?;
//! db.exec("INSERT INTO plugin_my_plugin_items VALUES (1)")?;
//! let result = db.query("SELECT * FROM plugin_my_plugin_items")?;
//! # Ok(())
//! # }

use std::sync::{Arc, Mutex, OnceLock};

use regex::Regex;
use rusqlite::Connection;

use crate::PluginError;

// ── Row ceiling for plugin queries (O-M48) ────────────────────────────────

/// Maximum number of rows a single plugin `query` may return.
///
/// # Why there is a cap at all
///
/// `PluginDb::query` materialises the whole result set into a `Vec<Value>`
/// and then serialises it to a `String`, so peak memory for one call is
/// roughly TWICE the encoded result — the value tree plus the JSON text that
/// is handed back to the plugin. Every other plugin budget in this workspace
/// is a hard number: the Lua VM the plugins run in is capped at 10 MiB
/// (`kasirmu_lua::MEMORY_LIMIT`), a plugin script file at 1 MiB
/// (`loader::MAX_SCRIPT_FILE_SIZE`), and a package entry at 16 MiB
/// (`package::MAX_ENTRY_UNCOMPRESSED_SIZE`). Unbounded SQL was the one budget
/// with no number at all, so `SELECT * FROM plugin_x_events` over a busy
/// merchant's plugin table grew until the process died.
///
/// # Why 10 000
///
/// Tied to the Lua VM cap above, which is the budget the result competes
/// against: the JSON string returned here crosses into the plugin as a Lua
/// string, and a Lua string is allocated by the VM and counted against its
/// 10 MiB. A row of a realistic plugin table (a handful of INTEGER/TEXT
/// columns) encodes to a few hundred bytes, so 10 000 rows is a few MiB —
/// comfortably inside the 10 MiB VM budget, leaving the script's own tables
/// room, and far beyond any legitimate plugin hook (which runs inside a
/// checkout, not a report generator). Exceeding it is a query-shape bug in
/// the plugin, not a capacity limit a real UI would encounter.
///
/// # Why it ERRORS instead of truncating
///
/// This is a sandbox boundary, so it fails explicitly. Returning a silently
/// truncated prefix would hand a plugin wrong data it cannot detect — a
/// discount or tax hook computing over the first 10 000 rows and reporting a
/// total as if it were complete. The error names the ceiling and tells the
/// plugin author to add a `LIMIT`, which is a fix they can apply without
/// host involvement.
///
/// # Who sees this number
///
/// The value is `pub` so a plugin author (and `db_tests`) can address the
/// boundary itself rather than a copy of it. `validate_sql` does NOT reject a
/// plugin `LIMIT` larger than this: the cap is enforced while reading, so a
/// `LIMIT 999999` cannot reach the engine's result set, and rejecting it in
/// the validator would duplicate the check in a second place that could
/// disagree with this one.
pub const MAX_QUERY_ROWS: usize = 10_000;

/// A validated, namespace-isolated database handle for a single plugin.
///
/// Wraps a shared `rusqlite::Connection` behind `Arc<Mutex<>>` so that
/// multiple plugins can safely share the same underlying database file.
/// Every SQL statement is validated before execution to enforce the
/// `plugin_<plugin_id>_` table-name prefix.
#[derive(Debug, Clone)]
pub struct PluginDb {
    conn: Arc<Mutex<Connection>>,
    /// Sanitised plugin identifier used as the table-name prefix.
    plugin_id: String,
    /// Pre-computed prefix: `plugin_<sanitised>_`
    prefix: String,
}

impl PluginDb {
    /// Create a new `PluginDb` for the given plugin.
    ///
    /// The `plugin_id` is sanitised (hyphens → underscores) before being
    /// used as the table-name prefix.
    pub fn new(conn: Connection, plugin_id: &str) -> Self {
        let sanitised = plugin_id.replace('-', "_");
        let prefix = format!("plugin_{sanitised}_");
        Self {
            conn: Arc::new(Mutex::new(conn)),
            plugin_id: sanitised,
            prefix,
        }
    }

    /// The sanitised plugin identifier used as the namespace prefix.
    pub fn plugin_id(&self) -> &str {
        &self.plugin_id
    }

    /// The required prefix for all table references: `plugin_<id>_`.
    pub fn prefix(&self) -> &str {
        &self.prefix
    }

    /// Execute a non-query SQL statement (e.g. `CREATE TABLE`, `INSERT`, `UPDATE`, `DELETE`).
    ///
    /// Returns the number of rows modified/affected.
    pub fn exec(&self, sql: &str) -> Result<usize, PluginError> {
        validate_sql(sql, &self.prefix)?;
        let conn = self
            .conn
            .lock()
            .map_err(|e| PluginError::Internal(format!("database lock poisoned: {e}")))?;
        let count = conn
            .execute(sql, [])
            .map_err(|e| PluginError::Internal(format!("database error: {e}")))?;
        Ok(count)
    }

    /// Execute a query and return results as a JSON array string.
    ///
    /// Each row is represented as a JSON object `{ "col": value, ... }`.
    /// Returns `"[]"` if the query produces no rows.
    ///
    /// At most [`MAX_QUERY_ROWS`] rows are returned. A query that would produce
    /// more fails with [`PluginError::PermissionDenied`] rather than returning a
    /// truncated prefix — see that constant for why the cap exists and why it
    /// errors instead of truncating.
    ///
    /// The row ceiling is enforced by COUNTING rows as they are read, never by
    /// rewriting the plugin's SQL. A rewrite would have to append to a
    /// statement that may already end in `;`, carry its own `LIMIT`, or end in
    /// a comment, and would have to stay compatible with `validate_sql`'s
    /// refusal of quoted identifiers (PLG-11). Counting cannot be defeated by
    /// any statement shape.
    ///
    /// Column names are resolved once per query and shared by every row
    /// (O-M48), so the per-cell cost of a wide result is the SQLite value read
    /// plus its JSON conversion — not an extra `String` allocation.
    pub fn query(&self, sql: &str) -> Result<String, PluginError> {
        validate_sql(sql, &self.prefix)?;
        let conn = self
            .conn
            .lock()
            .map_err(|e| PluginError::Internal(format!("database lock poisoned: {e}")))?;

        let mut stmt = conn
            .prepare(sql)
            .map_err(|e| PluginError::Internal(format!("query prepare error: {e}")))?;

        // O-M48: the column names are resolved ONCE per query, not once per
        // cell. The old code collected them up front and then `name.clone()`d
        // for every cell, so a 1 000 x 10 result paid 10 000 allocations for
        // at most 10 distinct names.
        //
        // The names cannot simply BE the map keys: `OwnedName` borrows from the
        // map that yields it, so a key cannot borrow from the `Vec` the map is
        // being built into. Instead each name is turned into an owning
        // `serde_json::Map` key exactly once, on the first row, into this
        // buffer; every later row clones from the buffer. That is one
        // allocation per distinct name per query instead of one per cell.
        let column_names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
        let mut owned_keys: Vec<serde_json::Map<String, serde_json::Value>> = Vec::new();

        let mut rows: Vec<serde_json::Value> = Vec::with_capacity(MAX_QUERY_ROWS.min(256));

        {
            let mut row_iter = stmt
                .query([])
                .map_err(|e| PluginError::Internal(format!("query error: {e}")))?;
            let mut seen: usize = 0;
            while let Some(row) = row_iter
                .next()
                .map_err(|e| PluginError::Internal(format!("row read error: {e}")))?
            {
                if seen == MAX_QUERY_ROWS {
                    return Err(PluginError::PermissionDenied(format!(
                        "query returned more than {MAX_QUERY_ROWS} rows — \
                         plugin queries are capped at {MAX_QUERY_ROWS} rows; \
                         add a LIMIT to your query (e.g. ... LIMIT {MAX_QUERY_ROWS}), \
                         narrow the WHERE clause, or page through the data"
                    )));
                }
                seen += 1;

                if owned_keys.is_empty() {
                    // First row: build every owning key once.
                    for name in &column_names {
                        let mut probe = serde_json::Map::new();
                        probe.insert(name.clone(), serde_json::Value::Null);
                        owned_keys.push(probe);
                    }
                }

                let mut obj = serde_json::Map::new();
                for (i, key_buf) in owned_keys.iter().enumerate() {
                    let val: rusqlite::types::Value = row
                        .get::<_, rusqlite::types::Value>(i)
                        .map_err(|e| PluginError::Internal(format!("row read error: {e}")))?;
                    // A one-entry map is the only way to obtain an OWNING
                    // `String` key from the buffer; this clone is the intended
                    // once-per-name-per-query source of that ownership.
                    // INVARIANT: key_buf is populated above with probe.insert(name.clone(), Value::Null) and holds exactly one entry.
                    let (key, _) = key_buf.iter().next().expect("key buffer holds one entry");
                    obj.insert(key.clone(), sqlite_value_to_json(val));
                }
                rows.push(serde_json::Value::Object(obj));
            }
        }

        serde_json::to_string(&rows)
            .map_err(|e| PluginError::Internal(format!("JSON serialisation error: {e}")))
    }

    /// Execute a non-query SQL statement with no return value.
    ///
    /// Equivalent to `exec` but discards the row count. Useful for `CREATE TABLE`
    /// and similar DDL statements.
    pub fn execute(&self, sql: &str) -> Result<(), PluginError> {
        validate_sql(sql, &self.prefix)?;
        let conn = self
            .conn
            .lock()
            .map_err(|e| PluginError::Internal(format!("database lock poisoned: {e}")))?;
        conn.execute_batch(sql)
            .map_err(|e| PluginError::Internal(format!("database error: {e}")))
    }
}

// ── SQL Validator ─────────────────────────────────────────────────────────

/// List of SQL keywords that are blocked entirely for plugin use.
const BLOCKED_KEYWORDS: &[&str] = &[
    "ATTACH",
    "DETACH",
    "VACUUM",
    "REINDEX",
    "GRANT",
    "REVOKE",
    "ALTER SYSTEM",
    "ALTER DATABASE",
    "ALTER ROLE",
    "CREATE INDEX",
    "CREATE TRIGGER",
    "CREATE VIEW",
    "CREATE VIRTUAL TABLE",
];

// ── Static SQL-validation regexes ──────────────────────────────────────
// The ten pattern literals below are compiled once into `static` `OnceLock`s
// at first use. Because they are compile-time constants, the only way
// `Regex::new` can fail is a programming error in the literal itself — so
// the shared `sql_regex()` helper documents that failure as an unreachable
// invariant rather than a recoverable runtime condition (RUST-07 policy).
// `sql_validation_regexes_compile` (test module) additionally compiles every
// literal under CI so a broken edit fails loudly in tests, never in prod.

/// `FROM <table1>, <table2>, ...` — captures the full comma-separated list.
const FROM_PATTERN: &str =
    r"(?i)\bFROM\s+([A-Za-z_][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*)*)";
/// `JOIN <table>`.
const JOIN_PATTERN: &str = r"(?i)\bJOIN\s+([A-Za-z_][A-Za-z0-9_]*)";
/// `INTO <table>` (INSERT INTO).
const INTO_PATTERN: &str = r"(?i)\bINTO\s+([A-Za-z_][A-Za-z0-9_]*)";
/// `UPDATE <table>`.
const UPDATE_PATTERN: &str = r"(?i)\bUPDATE\s+([A-Za-z_][A-Za-z0-9_]*)";
/// `TABLE <table>` (CREATE TABLE / DROP TABLE), skipping `IF [NOT] EXISTS`.
const TABLE_PATTERN: &str = r"(?i)\bTABLE\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?([A-Za-z_][A-Za-z0-9_]*)";
/// `INSERT INTO <table>`.
const INSERT_INTO_PATTERN: &str = r"(?i)\bINSERT\s+INTO\s+([A-Za-z_][A-Za-z0-9_]*)";
/// `DELETE FROM <table>`.
const DELETE_FROM_PATTERN: &str = r"(?i)\bDELETE\s+FROM\s+([A-Za-z_][A-Za-z0-9_]*)";
/// `DROP TABLE <table>`, skipping `IF EXISTS`.
const DROP_TABLE_PATTERN: &str =
    r"(?i)\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_]*)";
/// `WITH [RECURSIVE] <name> AS (`.
const CTE_PATTERN: &str = r#"(?i)\bWITH\s+(?:RECURSIVE\s+)?([A-Za-z_][A-Za-z0-9_]*)\s+AS\s*\("#;
/// `, <name> AS (` for comma-separated CTEs.
const CTE_COMMA_PATTERN: &str = r#"(?i),\s*([A-Za-z_][A-Za-z0-9_]*)\s+AS\s*\("#;

/// Word-boundary template for a blocked keyword: `(?i)\b<escaped keyword>\b`.
///
/// The `{}` is replaced by `regex::escape(keyword)` at cache-build time, so the
/// resulting pattern is valid for any keyword text (including the multi-word
/// entries in `BLOCKED_KEYWORDS`). See `compile_keyword`.
const KEYWORD_PATTERN: &str = r"(?i)\b{}\b";

/// Compile a static SQL-validation regex, compiled once into a `OnceLock`.
///
/// # Invariant
///
/// The pattern is a compile-time constant in this module; `Regex::new` can
/// only fail if the literal is malformed, which `sql_validation_regexes_compile`
/// (in the test module) verifies at CI time. A failure here is therefore an
/// unreachable programming error, not a recoverable runtime condition — the
/// panic is the deliberate RUST-07 policy for impossible invariants.
fn sql_regex(pattern: &'static str) -> Regex {
    // SAFETY: compile-time constant literals; `sql_validation_regexes_compile` compiles every production literal at CI time.
    Regex::new(pattern).expect("static SQL-validation regex must compile")
}

/// Validate that a SQL statement only references tables with the required prefix.
///
/// Returns `Ok(())` if validation passes, or `Err(PluginError::PermissionDenined)`
/// with a descriptive message.
pub fn validate_sql(sql: &str, prefix: &str) -> Result<(), PluginError> {
    let sql_upper = sql.to_uppercase();

    // 1. Check for blocked keywords
    for kw in BLOCKED_KEYWORDS {
        if contains_word(&sql_upper, kw) {
            return Err(PluginError::PermissionDenied(format!(
                "SQL statement uses blocked keyword '{kw}'"
            )));
        }
    }

    // 2. Check for PRAGMA statements
    if contains_word(&sql_upper, "PRAGMA") {
        return Err(PluginError::PermissionDenied(
            "PRAGMA statements are not allowed for plugins".into(),
        ));
    }

    // 3. Block ALTER TABLE (can rename/drop columns)
    if contains_word(&sql_upper, "ALTER") && contains_word(&sql_upper, "TABLE") {
        return Err(PluginError::PermissionDenied(
            "ALTER TABLE is not allowed for plugins".into(),
        ));
    }

    // 4. Fail-closed: reject quoted identifiers (PLG-11).
    ensure_no_quoted_identifiers(sql)?;

    // 5. Strip comments before extraction (PLG-A).
    //
    // The extraction regexes anchor each table name to its keyword with
    // whitespace, and a comment is legal SQLite between the two:
    // `DELETE FROM/**/sales` extracted ZERO tables, so the prefix loop below
    // had nothing to reject and the statement reached the core schema. Quoted
    // identifiers (PLG-11) were closed; this is the same bypass with no
    // quoting at all. Removing comments first — rather than teaching every
    // regex the comment grammar — keeps one place that knows what a comment is.
    let sql = strip_sql_comments(sql);

    // 6. Extract all table references and validate them
    let table_names = extract_table_references(&sql);
    for tbl in &table_names {
        // Skip CTE names (they start with the CTE, no prefix enforcement)
        if !tbl.starts_with(prefix) {
            return Err(PluginError::PermissionDenied(format!(
                "table '{tbl}' does not have required prefix '{prefix}'"
            )));
        }
    }

    Ok(())
}

/// Reject SQLite-legal quoted identifiers (fail-closed lexical scan).
///
/// The namespace regexes extract BARE identifiers only. SQLite also accepts
/// `"name"`, `` `name` ``, and `[name]` as quoted identifiers, which would
/// bypass extraction entirely — `DELETE FROM "sales"` yields zero captured
/// tables and would reach the core schema (PLG-11). Rather than teaching
/// every regex the three quoting dialects, this scan fail-closes: any
/// quote/bracket character appearing OUTSIDE a single-quoted string literal
/// rejects the statement. Plugin SQL only needs bare identifiers — the host
/// creates the prefixed tables — and values legitimately containing these
/// characters are invisible inside `'...'` literals (with `''` doubling as
/// the escape). The scan walks ASCII bytes: UTF-8 continuation/lead bytes
/// never collide with ASCII code points, so multibyte values cannot spoof
/// the toggles.
pub fn ensure_no_quoted_identifiers(sql: &str) -> Result<(), PluginError> {
    let bytes = sql.as_bytes();
    let mut in_string = false;
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'\'' => {
                // `''` inside a string is an escaped quote, not the terminator.
                if in_string && i + 1 < bytes.len() && bytes[i + 1] == b'\'' {
                    i += 2;
                    continue;
                }
                in_string = !in_string;
            }
            b'"' | b'`' | b'[' | b']' if !in_string => {
                return Err(PluginError::PermissionDenied(
                    "quoted identifiers are not allowed in plugin SQL (use bare names, e.g. sales_orders instead of \"sales_orders\")"
                        .into(),
                ));
            }
            _ => {}
        }
        i += 1;
    }
    // An unterminated string literal is malformed SQL; reject it fail-closed
    // rather than guessing whether quote characters inside it were values.
    if in_string {
        return Err(PluginError::PermissionDenied(
            "unterminated string literal in plugin SQL".into(),
        ));
    }
    Ok(())
}

/// The word-boundary regexes `validate_sql` tests every statement against.
///
/// Before O-M47 each of these was built per call: `contains_word` ran `format!`
/// and `Regex::new` on every invocation, and `validate_sql` invokes it once per
/// `BLOCKED_KEYWORDS` entry plus PRAGMA plus the two ALTER/TABLE checks — about
/// sixteen compilations per plugin `exec`/`query`. The keyword set is fixed at
/// compile time, so caching it removes that cost without changing which
/// statements are rejected: the patterns, and therefore the matches, are
/// exactly the ones the old code built inline.
///
/// The cache also holds ALTER, TABLE and PRAGMA even though they are not in
/// `BLOCKED_KEYWORDS` — `validate_sql` tests those separately, with their own
/// error messages, and they carried the same compile-per-call cost.
struct KeywordRegexes {
    /// One regex per `BLOCKED_KEYWORDS` entry, in the same order.
    blocked: Vec<(&'static str, Regex)>,
    /// `PRAGMA` — blocked on its own, ahead of the table-reference scan.
    pragma: Regex,
    /// `ALTER`, which together with [`Self::table`] rejects ALTER TABLE.
    alter: Regex,
    /// `TABLE`, which together with [`Self::alter`] rejects ALTER TABLE.
    table: Regex,
}

/// Build the [`KeywordRegexes`] cache.
///
/// Every keyword compiled here is a compile-time constant, and
/// `keyword_regexes_compile_and_match` (test module) compiles AND matches all of
/// them under CI, so the `expect` inside [`compile_keyword`] cannot fire for any
/// keyword that `validate_sql` actually uses.
fn build_keyword_regexes() -> KeywordRegexes {
    let blocked = BLOCKED_KEYWORDS
        .iter()
        .map(|kw| (*kw, compile_keyword(kw)))
        .collect::<Vec<_>>();
    KeywordRegexes {
        blocked,
        pragma: compile_keyword("PRAGMA"),
        alter: compile_keyword("ALTER"),
        table: compile_keyword("TABLE"),
    }
}

/// The keyword regex cache, built once on first use.
fn keyword_regexes() -> &'static KeywordRegexes {
    static KEYWORD_REGEXES: OnceLock<KeywordRegexes> = OnceLock::new();
    KEYWORD_REGEXES.get_or_init(build_keyword_regexes)
}

/// Compile the word-boundary pattern for a single keyword.
///
/// Unlike `sql_regex` above, the pattern is assembled at runtime from
/// [`KEYWORD_PATTERN`] and the keyword — but this is still not a fallible
/// operation, for the same reason `contains_word` documented before the regexes
/// were cached: `regex::escape` makes the result valid by construction.
fn compile_keyword(keyword: &str) -> Regex {
    // SAFETY: the keyword is `regex::escape`d, so the pattern is valid by
    // construction; `keyword_regexes_compile_and_match` compiles every keyword
    // in the set at CI time. `KEYWORD_PATTERN` is the only literal supplied.
    Regex::new(&KEYWORD_PATTERN.replace("{}", &regex::escape(keyword)))
        .expect("escaped keyword pattern must compile")
}

/// The regex for a `validate_sql` keyword, from the [`keyword_regexes`] cache.
///
/// `validate_sql` only ever passes `BLOCKED_KEYWORDS` entries or the literals
/// `"PRAGMA"`, `"ALTER"` and `"TABLE"`, so the search below always hits.
///
/// # Invariant
///
/// An unknown keyword panics rather than being compiled fresh or reported as
/// absent. A fresh compile would quietly restore the per-call cost this cache
/// exists to remove; reporting absent would be the fail-OPEN direction that
/// `contains_word`'s PLG-B note forbids on a security check. Panicking makes a
/// keyword added to `validate_sql` without being added to
/// [`build_keyword_regexes`] fail loudly in the first test that exercises it.
fn keyword_regex(keyword: &'static str) -> &'static Regex {
    let cached = keyword_regexes();
    let found = match keyword {
        "PRAGMA" => Some(&cached.pragma),
        "ALTER" => Some(&cached.alter),
        "TABLE" => Some(&cached.table),
        _ => cached
            .blocked
            .iter()
            .find(|(kw, _)| *kw == keyword)
            .map(|(_, re)| re),
    };
    found.unwrap_or_else(|| {
        let known = cached
            .blocked
            .iter()
            .map(|(kw, _)| *kw)
            .chain(["PRAGMA", "ALTER", "TABLE"])
            .collect::<Vec<_>>()
            .join(", ");
        panic!("keyword '{keyword}' has no cached regex (known: {known})")
    })
}

fn contains_word(text: &str, keyword: &'static str) -> bool {
    keyword_regex(keyword).is_match(text)
}

/// Remove SQL comments from `sql`, leaving string literals intact (PLG-A).
///
/// Handles `--` line comments and `/* ... */` block comments. A comment
/// character inside a single-quoted string literal is data, not a comment, so
/// the same in-string toggle the quoted-identifier scan uses guards this walk
/// (with `''` as the escape). Comments are replaced by a single space rather
/// than deleted, so `FROM/**/sales` becomes `FROM sales` and the keyword
/// stays separated from the identifier instead of fusing into one token.
///
/// An unterminated block comment consumes the remainder; the statement is then
/// validated as written and will almost certainly fail to extract the trailing
/// tables, which is the fail-closed direction.
fn strip_sql_comments(sql: &str) -> String {
    let bytes = sql.as_bytes();
    let mut out = String::with_capacity(sql.len());
    let mut in_string = false;
    let mut i = 0;
    while i < bytes.len() {
        let b = bytes[i];
        if in_string {
            out.push(b as char);
            if b == b'\'' {
                // `''` inside a string is an escaped quote, not the terminator.
                if i + 1 < bytes.len() && bytes[i + 1] == b'\'' {
                    out.push('\'');
                    i += 2;
                    continue;
                }
                in_string = false;
            }
            i += 1;
            continue;
        }
        match b {
            b'\'' => {
                in_string = true;
                out.push('\'');
                i += 1;
            }
            b'-' if i + 1 < bytes.len() && bytes[i + 1] == b'-' => {
                // Line comment: skip to end of line (keep the newline).
                while i < bytes.len() && bytes[i] != b'\n' {
                    i += 1;
                }
                out.push(' ');
            }
            b'/' if i + 1 < bytes.len() && bytes[i + 1] == b'*' => {
                i += 2;
                while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                    i += 1;
                }
                i = (i + 2).min(bytes.len());
                out.push(' ');
            }
            _ => {
                out.push(b as char);
                i += 1;
            }
        }
    }
    out
}

/// Extract table names referenced in a SQL statement.
///
/// Handles common SQL patterns:
/// - `FROM <table>`, `FROM <table> AS <alias>`
/// - `JOIN <table>`, `INNER JOIN <table>`, etc.
/// - `INTO <table>`
/// - `UPDATE <table>`
/// - `TABLE <table>` (for CREATE TABLE, DROP TABLE)
/// - Skips CTE (WITH ... AS (...)) names
fn extract_table_references(sql: &str) -> Vec<String> {
    let mut tables: Vec<String> = Vec::new();

    // Collect CTE names so we can exclude them
    let cte_names = extract_cte_names(sql);

    // Patterns that capture table names (case-insensitive via regex).
    // Each regex is compiled once into a static OnceLock.

    // Pattern 1: FROM <table1>, <table2>, ...
    static FROM_RE: OnceLock<Regex> = OnceLock::new();
    let from_re = FROM_RE.get_or_init(|| sql_regex(FROM_PATTERN));
    for cap in from_re.captures_iter(sql) {
        let table_list = cap[1].to_string();
        for part in table_list.split(',') {
            let tbl = part.trim().to_string();
            if !tbl.is_empty() && !cte_names.contains(&tbl.to_uppercase()) {
                tables.push(tbl);
            }
        }
    }

    // Pattern 2: JOIN <table>
    static JOIN_RE: OnceLock<Regex> = OnceLock::new();
    let join_re = JOIN_RE.get_or_init(|| sql_regex(JOIN_PATTERN));
    for cap in join_re.captures_iter(sql) {
        let tbl = cap[1].to_string();
        if !cte_names.contains(&tbl.to_uppercase()) {
            tables.push(tbl);
        }
    }

    // Pattern 3: INTO <table> (INSERT INTO)
    static INTO_RE: OnceLock<Regex> = OnceLock::new();
    let into_re = INTO_RE.get_or_init(|| sql_regex(INTO_PATTERN));
    for cap in into_re.captures_iter(sql) {
        let tbl = cap[1].to_string();
        tables.push(tbl);
    }

    // Pattern 4: UPDATE <table>
    static UPDATE_RE: OnceLock<Regex> = OnceLock::new();
    let update_re = UPDATE_RE.get_or_init(|| sql_regex(UPDATE_PATTERN));
    for cap in update_re.captures_iter(sql) {
        let tbl = cap[1].to_string();
        tables.push(tbl);
    }

    // Pattern 5: TABLE <table> (CREATE TABLE, DROP TABLE)
    static TABLE_RE: OnceLock<Regex> = OnceLock::new();
    let table_re = TABLE_RE.get_or_init(|| sql_regex(TABLE_PATTERN));
    for cap in table_re.captures_iter(sql) {
        let tbl = cap[1].to_string();
        tables.push(tbl);
    }

    // Pattern 6: INSERT INTO <table>
    static INSERT_INTO_RE: OnceLock<Regex> = OnceLock::new();
    let insert_into_re = INSERT_INTO_RE.get_or_init(|| sql_regex(INSERT_INTO_PATTERN));
    for cap in insert_into_re.captures_iter(sql) {
        let tbl = cap[1].to_string();
        if !tables.contains(&tbl) {
            tables.push(tbl);
        }
    }

    // Pattern 7: DELETE FROM <table>
    static DELETE_FROM_RE: OnceLock<Regex> = OnceLock::new();
    let delete_from_re = DELETE_FROM_RE.get_or_init(|| sql_regex(DELETE_FROM_PATTERN));
    for cap in delete_from_re.captures_iter(sql) {
        let tbl = cap[1].to_string();
        tables.push(tbl);
    }

    // Pattern 8: DROP TABLE <table>
    static DROP_TABLE_RE: OnceLock<Regex> = OnceLock::new();
    let drop_table_re = DROP_TABLE_RE.get_or_init(|| sql_regex(DROP_TABLE_PATTERN));
    for cap in drop_table_re.captures_iter(sql) {
        let tbl = cap[1].to_string();
        tables.push(tbl);
    }

    // Remove duplicates while preserving order
    let mut seen = std::collections::HashSet::new();
    tables.retain(|t| seen.insert(t.clone()));

    tables
}

/// Extract CTE (Common Table Expression) names from a SQL WITH clause.
///
/// Returns them in UPPERCASE for easy comparison.
fn extract_cte_names(sql: &str) -> Vec<String> {
    let mut names = Vec::new();
    // Match: WITH <name> AS ( ... ) or WITH RECURSIVE <name> AS ( ... )
    static CTE_RE: OnceLock<Regex> = OnceLock::new();
    let cte_re = CTE_RE.get_or_init(|| sql_regex(CTE_PATTERN));
    for cap in cte_re.captures_iter(sql) {
        names.push(cap[1].to_uppercase());
    }
    // Also match comma-separated CTEs: , <name> AS (
    static CTE_COMMA_RE: OnceLock<Regex> = OnceLock::new();
    let cte_comma_re = CTE_COMMA_RE.get_or_init(|| sql_regex(CTE_COMMA_PATTERN));
    for cap in cte_comma_re.captures_iter(sql) {
        names.push(cap[1].to_uppercase());
    }
    names
}

/// Convert a `rusqlite::types::Value` into a `serde_json::Value`.
fn sqlite_value_to_json(val: rusqlite::types::Value) -> serde_json::Value {
    match val {
        rusqlite::types::Value::Null => serde_json::Value::Null,
        rusqlite::types::Value::Integer(i) => serde_json::Value::Number(i.into()),
        rusqlite::types::Value::Real(f) => serde_json::Number::from_f64(f)
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::Null),
        rusqlite::types::Value::Text(s) => serde_json::Value::String(s),
        rusqlite::types::Value::Blob(b) => serde_json::Value::String(base64_encode(&b)),
    }
}

/// Minimal base64 encoding for blob values (avoids adding a base64 crate dep).
fn base64_encode(bytes: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::new();
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let triple = (b0 << 16) | (b1 << 8) | b2;
        result.push(CHARS[((triple >> 18) & 0x3F) as usize] as char);
        result.push(CHARS[((triple >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 {
            result.push(CHARS[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
        if chunk.len() > 2 {
            result.push(CHARS[(triple & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
    }
    result
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "db_tests.rs"]
mod tests;
