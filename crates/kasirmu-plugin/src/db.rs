/*
last audited 25-07-26 by RSA-Agent (oz-plugin slice B: db.rs deep read; PLG-11 FIXED 25-07-26)
crate: oz-plugin | status: SAFE | lint: CLEAN
findings: PLG-11 FIXED — validate_sql now fail-closes on any quote/bracket character outside a single-quoted string literal (ensure_no_quoted_identifiers lexical scan), so the SQLite-legal quoting dialects ("sales", `sales`, [sales]) can no longer bypass the bare-identifier namespace regexes; unterminated string literals are also rejected; 7 new tests cover the bypass shapes and the string-literal escape case (all 180+2 oz-plugin tests pass). Prior verified positives: PLG-01/02/06/08 hardening intact; exec/query/execute all funnel through validate_sql
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
    pub fn query(&self, sql: &str) -> Result<String, PluginError> {
        validate_sql(sql, &self.prefix)?;
        let conn = self
            .conn
            .lock()
            .map_err(|e| PluginError::Internal(format!("database lock poisoned: {e}")))?;

        let mut stmt = conn
            .prepare(sql)
            .map_err(|e| PluginError::Internal(format!("query prepare error: {e}")))?;

        let column_names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();

        let mut rows: Vec<serde_json::Value> = Vec::new();

        let row_iter = stmt
            .query_map([], |row| {
                let mut obj = serde_json::Map::new();
                for (i, name) in column_names.iter().enumerate() {
                    let val: rusqlite::types::Value = row.get_unwrap(i);
                    let json_val = sqlite_value_to_json(val);
                    obj.insert(name.clone(), json_val);
                }
                Ok(serde_json::Value::Object(obj))
            })
            .map_err(|e| PluginError::Internal(format!("query error: {e}")))?;

        for row_result in row_iter {
            let row_val =
                row_result.map_err(|e| PluginError::Internal(format!("row read error: {e}")))?;
            rows.push(row_val);
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

    // 5. Extract all table references and validate them
    let table_names = extract_table_references(sql);
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

/// Check if `text` contains `keyword` as a whole word (bounded by non-alphanumeric chars).
fn contains_word(text: &str, keyword: &str) -> bool {
    let pattern = format!(r"(?i)\b{}\b", regex::escape(keyword));
    Regex::new(&pattern)
        .map(|re| re.is_match(text))
        .unwrap_or(false)
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
