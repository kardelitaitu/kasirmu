//! Whether a statement's effect has already landed — or would not land at all.
//!
//! The migration runner's drift re-apply skips a statement only when one of two
//! proofs answers for it, and this module owns both:
//!
//! * [`already_satisfied`] — handed a statement SQLite just refused plus the
//!   error it raised, decides whether the intended change is *provably* already
//!   in the database, so the error can be ignored.
//! * [`insert_would_insert_nothing`] — answers *before* execution whether an
//!   `INSERT OR IGNORE` seed would insert nothing, because executing an
//!   already-satisfied seed is not free: SQLite allocates a rowid per attempted
//!   row, so an `AUTOINCREMENT` table's `sqlite_sequence` entry advances, and a
//!   `BEFORE INSERT` trigger fires for a row `OR IGNORE` then discards. The
//!   pre-execution answer is what lets a re-apply leave the data byte-identical.
//!
//! Both are deliberately conservative: a statement they cannot prove is never
//! skipped, because a wrong skip applies *nothing* while reporting success.
//! Passing the error message as `&str` keeps the proof free of `rusqlite`
//! error types, which is what makes it directly testable.
//!
//! The text understanding this needs — tokenizing, the canonical DDL form,
//! the parsing of `ADD COLUMN` and `CREATE` headers — is [`super::statements`]'s;
//! this module adds only the reading of the live catalogue (`pragma_table_info`,
//! `sqlite_master`, `pragma_index_list`) the comparison runs against. It never
//! touches the migration ledger: it knows no `Migration`, no `schema_migrations`
//! and no checksums.

use rusqlite::types::Value;
use rusqlite::{Connection, OptionalExtension, params};

use super::statements::{
    Token, TokenKind, canonical, canonical_ddl, identifier, is_terminator, is_word, tokenize,
};
use crate::error::PlatformError;

// ── Parsed statement shapes ──────────────────────────────────────

/// A column's declared definition, in canonical form.
struct ColumnDecl {
    /// Canonical token form of the declared type (`TEXT`, `INTEGER`).
    type_name: String,
    /// Whether the declaration carries `NOT NULL`.
    not_null: bool,
    /// Canonical token form of the `DEFAULT` expression, outer parentheses
    /// removed.
    default: Option<String>,
}

impl ColumnDecl {
    /// Whether an existing column carries exactly this declaration.
    fn matches(&self, existing: &ColumnInfo) -> bool {
        self.type_name == existing.type_name
            && self.not_null == existing.not_null
            && self.default == existing.default
    }
}

/// A column as the database reports it, in canonical form.
struct ColumnInfo {
    type_name: String,
    not_null: bool,
    default: Option<String>,
}

/// `ALTER TABLE <table> ADD [COLUMN] <column> <declaration>`.
struct AddColumn {
    table: String,
    column: String,
    declared: ColumnDecl,
}

/// The kind of object a `CREATE` statement declares.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CreateKind {
    Table,
    Index,
    Trigger,
    View,
}

/// `CREATE [UNIQUE|TEMP|TEMPORARY|VIRTUAL] <kind> [IF NOT EXISTS] <name>`.
struct Create {
    kind: CreateKind,
    name: String,
}

/// Parse an `ADD COLUMN` statement, or `None` for anything else.
fn parse_add_column(tokens: &[Token<'_>]) -> Option<AddColumn> {
    if !tokens.first().is_some_and(|t| is_word(t, "ALTER"))
        || !tokens.get(1).is_some_and(|t| is_word(t, "TABLE"))
    {
        return None;
    }
    let table = identifier(tokens.get(2)?)?;
    let mut cursor = 3usize;
    if !tokens.get(cursor).is_some_and(|t| is_word(t, "ADD")) {
        return None;
    }
    cursor += 1;
    if tokens.get(cursor).is_some_and(|t| is_word(t, "COLUMN")) {
        cursor += 1;
    }
    let column = identifier(tokens.get(cursor)?)?;
    let declared = parse_column_decl(&tokens[cursor + 1..]);
    Some(AddColumn {
        table,
        column,
        declared,
    })
}

/// Parse a `CREATE` statement, or `None` for anything else.
fn parse_create(tokens: &[Token<'_>]) -> Option<Create> {
    if !tokens.first().is_some_and(|t| is_word(t, "CREATE")) {
        return None;
    }
    let mut cursor = 1usize;
    while tokens.get(cursor).is_some_and(|t| {
        is_word(t, "UNIQUE")
            || is_word(t, "TEMP")
            || is_word(t, "TEMPORARY")
            || is_word(t, "VIRTUAL")
    }) {
        cursor += 1;
    }
    let kind = tokens.get(cursor)?;
    let kind = if is_word(kind, "TABLE") {
        CreateKind::Table
    } else if is_word(kind, "INDEX") {
        CreateKind::Index
    } else if is_word(kind, "TRIGGER") {
        CreateKind::Trigger
    } else if is_word(kind, "VIEW") {
        CreateKind::View
    } else {
        return None;
    };
    cursor += 1;
    if tokens.get(cursor).is_some_and(|t| is_word(t, "IF"))
        && tokens.get(cursor + 1).is_some_and(|t| is_word(t, "NOT"))
        && tokens.get(cursor + 2).is_some_and(|t| is_word(t, "EXISTS"))
    {
        cursor += 3;
    }
    let name = identifier(tokens.get(cursor)?)?;
    Some(Create { kind, name })
}

/// Parse the declaration that follows an `ADD COLUMN` column name.
fn parse_column_decl(tokens: &[Token<'_>]) -> ColumnDecl {
    // The declared type runs until the first constraint keyword at the top
    // level, so a type with arguments (`VARCHAR(255)`) stays intact.
    let mut depth = 0i32;
    let mut type_end = 0usize;
    while type_end < tokens.len() {
        let token = &tokens[type_end];
        if token.kind == TokenKind::Punct {
            if token.value == "(" {
                depth += 1;
            } else if token.value == ")" {
                depth -= 1;
            }
        } else if depth == 0 && (is_column_constraint_keyword(token) || is_terminator(token)) {
            break;
        }
        type_end += 1;
    }

    let mut not_null = false;
    let mut default = None;
    let mut cursor = type_end;
    while cursor < tokens.len() {
        if is_word(&tokens[cursor], "NOT")
            && tokens.get(cursor + 1).is_some_and(|t| is_word(t, "NULL"))
        {
            not_null = true;
            cursor += 2;
            continue;
        }
        if is_word(&tokens[cursor], "DEFAULT") {
            let end = expression_end(tokens, cursor + 1);
            default = Some(canonical(strip_outer_parens(&tokens[cursor + 1..end])));
            cursor = end;
            continue;
        }
        cursor += 1;
    }

    ColumnDecl {
        type_name: canonical(&tokens[..type_end]),
        not_null,
        default,
    }
}

/// Index of the first token that ends an expression starting at `start`.
fn expression_end(tokens: &[Token<'_>], start: usize) -> usize {
    let mut depth = 0i32;
    let mut cursor = start;
    while cursor < tokens.len() {
        let token = &tokens[cursor];
        if token.kind == TokenKind::Punct {
            if token.value == "(" {
                depth += 1;
            } else if token.value == ")" {
                if depth == 0 {
                    break;
                }
                depth -= 1;
            }
        } else if depth == 0 && (is_column_constraint_keyword(token) || is_terminator(token)) {
            break;
        }
        cursor += 1;
    }
    cursor
}

/// Keywords that terminate a column's declared type or default expression.
fn is_column_constraint_keyword(token: &Token<'_>) -> bool {
    token.kind == TokenKind::Word
        && [
            "NOT",
            "NULL",
            "DEFAULT",
            "CHECK",
            "PRIMARY",
            "UNIQUE",
            "REFERENCES",
            "COLLATE",
            "GENERATED",
            "AS",
            "CONSTRAINT",
        ]
        .iter()
        .any(|keyword| token.value.eq_ignore_ascii_case(keyword))
}

/// Strip parentheses that wrap a whole expression.
///
/// SQLite reports `DEFAULT (strftime(…))` as `strftime(…)` — measured — so the
/// wrapper has to be removed from the script's side too before comparing.
fn strip_outer_parens<'a>(mut tokens: &'a [Token<'a>]) -> &'a [Token<'a>] {
    loop {
        if tokens.len() < 2 {
            return tokens;
        }
        let opens = tokens[0].kind == TokenKind::Punct && tokens[0].value == "(";
        let closes = tokens[tokens.len() - 1].kind == TokenKind::Punct
            && tokens[tokens.len() - 1].value == ")";
        if !opens || !closes {
            return tokens;
        }
        let mut depth = 0i32;
        let mut wraps_whole = false;
        for (index, token) in tokens.iter().enumerate() {
            if token.kind == TokenKind::Punct && token.value == "(" {
                depth += 1;
            } else if token.kind == TokenKind::Punct && token.value == ")" {
                depth -= 1;
                if depth == 0 {
                    wraps_whole = index == tokens.len() - 1;
                    break;
                }
            }
        }
        if !wraps_whole {
            return tokens;
        }
        tokens = &tokens[1..tokens.len() - 1];
    }
}

/// Read a column's definition from the database.
fn column_info(
    conn: &Connection,
    table: &str,
    column: &str,
) -> Result<Option<ColumnInfo>, PlatformError> {
    let mut statement =
        conn.prepare("SELECT name, type, \"notnull\", dflt_value FROM pragma_table_info(?1)")?;
    let mut rows = statement.query(params![table])?;
    while let Some(row) = rows.next()? {
        let name: String = row.get(0)?;
        if !name.eq_ignore_ascii_case(column) {
            continue;
        }
        let declared_type: String = row.get(1)?;
        let not_null: i64 = row.get(2)?;
        let default: Option<String> = row.get(3)?;
        let default = default.map(|text| {
            let tokens = tokenize(&text);
            canonical(strip_outer_parens(&tokens))
        });
        let type_tokens = tokenize(&declared_type);
        return Ok(Some(ColumnInfo {
            type_name: canonical(&type_tokens),
            not_null: not_null != 0,
            default,
        }));
    }
    Ok(None)
}

// ── Already-satisfied proof ──────────────────────────────────────

/// Whether a statement's effect is already present *and provably identical*,
/// so the error it just raised can be ignored.
///
/// The proof is per statement kind and deliberately conservative — a
/// statement this function cannot prove is never skipped:
///
/// * `ALTER TABLE … ADD COLUMN` — `pragma_table_info` reports the existing
///   column's declared type, nullability and default. That is an
///   authoritative record of the definition the statement asked for, so a
///   difference in any of the three is a real divergence and is surfaced.
/// * `CREATE INDEX` / `CREATE TRIGGER` / `CREATE VIEW` — `sqlite_master.sql`
///   holds the statement verbatim, so the stored text and the script's text
///   are compared token for token.
/// * `CREATE TABLE` — never skipped, because `sqlite_master.sql` is not a
///   record of the statement that created the table: SQLite *rewrites* a
///   table's stored DDL when a later `ALTER TABLE ADD COLUMN` runs, and
///   rebuild migrations create `*_new` scratch tables that they then drop
///   and rename. Migrations whose only non-idempotent statements are
///   `CREATE TABLE` therefore still fail loudly, as they always have.
/// * `INSERT OR IGNORE … VALUES …` — a seed whose rows are still in the table
///   but whose column list names a column a *later* migration replaced. See
///   [`seed_rows_already_present`], which requires the whole primary key to be
///   named and every row to be found before anything is skipped.
///
/// `error_message` is the message SQLite raised for the statement, which is
/// what ties the failure to the absence the proof is explaining.
pub(super) fn already_satisfied(
    conn: &Connection,
    statement: &str,
    error_message: &str,
) -> Result<bool, PlatformError> {
    let tokens: Vec<Token<'_>> = tokenize(statement)
        .into_iter()
        .filter(|token| !is_terminator(token))
        .collect();

    if let Some(add) = parse_add_column(&tokens) {
        if !error_message.contains("duplicate column name") || !error_message.contains(&add.column)
        {
            return Ok(false);
        }
        let existing = column_info(conn, &add.table, &add.column)?;
        return Ok(existing.is_some_and(|existing| add.declared.matches(&existing)));
    }

    if let Some(create) = parse_create(&tokens) {
        if create.kind == CreateKind::Table {
            return Ok(false);
        }
        if !error_message.contains("already exists") || !error_message.contains(&create.name) {
            return Ok(false);
        }
        let stored: Option<String> = conn
            .query_row(
                "SELECT sql FROM sqlite_master WHERE name = ?1 AND sql IS NOT NULL",
                params![create.name],
                |row| row.get(0),
            )
            .optional()?;
        return Ok(stored.is_some_and(|stored| canonical_ddl(&stored) == canonical_ddl(statement)));
    }

    if tokens.first().is_some_and(|token| is_word(token, "INSERT")) {
        return seed_rows_already_present(conn, &tokens, error_message);
    }

    Ok(false)
}

/// Whether an `INSERT OR IGNORE … VALUES (…), (…)` seed is already fully
/// present, so its refusal to re-run can be ignored.
///
/// This is the shape the other proofs cannot reach, and the reason drift in
/// `20260813_init.sql` bricked startup: the script seeds the loyalty tiers
/// through `earn_multiplier`, and `20260831_loyalty_multiplier_fixedpoint.sql`
/// later converts that column to `earn_multiplier_millionths` and drops it. On a
/// database with the whole registry applied the statement can neither run nor be
/// a no-op SQLite reports, so it has to be *proved* satisfied. Both halves of the
/// proof are required:
///
/// 1. **The statement cannot run here.** At least one column it names is absent
///    from the existing table (`pragma_table_info`), at least one other named
///    column is present — so this is a stale reference, not a reference to a
///    table that was dropped or renamed — and the error actually names one of the
///    absent columns, so the failure is explained by the absence rather than
///    merely coinciding with it.
/// 2. **Its effect is already present.** The statement names the table's whole
///    primary key (`pk` ordinals), and every `VALUES` row's key literals identify
///    a row already in the table. `OR IGNORE` is required, because that clause is
///    what makes "every row already there" a proof of a **no-op** rather than an
///    observation that the statement would have failed on the unique key.
///
/// Anything short of both halves returns `Ok(false)` and the caller reports the
/// error, which is the point: skipping happens only for a statement whose
/// intended change is demonstrably already in the database.
fn seed_rows_already_present(
    conn: &Connection,
    tokens: &[Token<'_>],
    message: &str,
) -> Result<bool, PlatformError> {
    let Some(seed) = parse_ignore_seed(tokens) else {
        return Ok(false);
    };

    // The key the seed is identified by, and the absence half of the proof.
    let keys = primary_key_columns(conn, &seed.table)?;
    if keys.is_empty() {
        return Ok(false); // no such table, or a table without a primary key
    }
    let mut absent: Vec<String> = Vec::new();
    let mut present = 0usize;
    for name in &seed.columns {
        if column_info(conn, &seed.table, name)?.is_some() {
            present += 1;
        } else {
            absent.push(name.clone());
        }
    }
    if absent.is_empty() || present == 0 {
        return Ok(false);
    }
    if !absent.iter().any(|name| message.contains(name.as_str())) {
        return Ok(false);
    }

    // The presence half: every row the seed offers is already there, on the
    // whole primary key the statement names.
    for row in &seed.rows {
        if !row_already_present(conn, tokens, &seed, row, &keys)? {
            return Ok(false); // a row the seed asks for is missing: never skipped
        }
    }
    Ok(true)
}

// ── Pre-execution proof ──────────────────────────────────────────

/// Whether executing `statement` cannot insert anything: an `INSERT OR IGNORE …
/// VALUES ( … )` whose every row duplicates a row the table already holds, under
/// a uniqueness constraint the statement names in full.
///
/// This is the *pre-execution* half of the drift re-apply, and it exists because
/// executing an already-satisfied seed is not free. SQLite allocates a rowid for
/// every attempted row before the conflict is detected, so an `AUTOINCREMENT`
/// table's `sqlite_sequence` entry advances, and a `BEFORE INSERT` trigger fires
/// for a row `OR IGNORE` then discards — both measured, not assumed (one
/// invocation and one sequence step for a single ignored row). Skipping the
/// statement before it runs is the only way a re-apply leaves the data
/// byte-identical, which is what [`super::migrations`] calls this for.
///
/// The proof is narrower than the statement it excuses, which is what makes the
/// skip sound: every row must be rejected by a **non-partial, plain-column**
/// uniqueness constraint the statement names — the primary key or a `UNIQUE`
/// index — using the row's own literal values, and the table must carry no
/// trigger that can fire on `INSERT`. A statement this function cannot prove is
/// executed exactly as before — including one that would insert nothing for a
/// reason this proof does not model, such as a `NOT NULL` or `CHECK` violation,
/// which `OR IGNORE` also swallows.
pub(super) fn insert_would_insert_nothing(
    conn: &Connection,
    statement: &str,
) -> Result<bool, PlatformError> {
    let tokens: Vec<Token<'_>> = tokenize(statement)
        .into_iter()
        .filter(|token| !is_terminator(token))
        .collect();
    let Some(seed) = parse_ignore_seed(&tokens) else {
        return Ok(false);
    };
    if seed.end != tokens.len() {
        return Ok(false); // something follows the rows: not the plain seed shape
    }
    if has_insert_trigger(conn, &seed.table)? {
        return Ok(false); // the attempt could fire a trigger, so it is not a no-op
    }
    let constraints = unique_constraints(conn, &seed.table)?;
    if constraints.is_empty() {
        return Ok(false); // nothing the statement names can reject these rows
    }
    for row in &seed.rows {
        let mut rejected = false;
        for constraint in &constraints {
            if row_already_present(conn, &tokens, &seed, row, constraint)? {
                rejected = true;
                break;
            }
        }
        if !rejected {
            return Ok(false); // this row would be inserted: never skipped
        }
    }
    Ok(true)
}

// ── Seed parsing ─────────────────────────────────────────────────

/// A parsed `INSERT OR IGNORE INTO <table> ( <columns> ) VALUES ( … ), ( … )`.
///
/// Only this shape is ever reasoned about: a `SELECT` source, an expression in
/// the column list, a row whose value count differs from the column count and a
/// malformed tail all fail to parse, and a statement that fails to parse is never
/// skipped either way.
struct IgnoreSeed {
    /// The table the rows are offered to.
    table: String,
    /// The columns the statement names, in the statement's own order.
    columns: Vec<String>,
    /// The token range of each `VALUES` row's values, aligned with `columns`.
    rows: Vec<Vec<(usize, usize)>>,
    /// One past the last token this seed consumed, so a caller can insist that
    /// nothing follows the rows.
    end: usize,
}

/// Parse an `INSERT OR IGNORE … VALUES ( … )` statement, or `None` when the
/// statement is not that shape.
fn parse_ignore_seed(tokens: &[Token<'_>]) -> Option<IgnoreSeed> {
    if !tokens.first().is_some_and(|token| is_word(token, "INSERT")) {
        return None;
    }
    // INSERT OR IGNORE INTO <table> ( <columns> ) VALUES ( … ), ( … )
    let mut cursor = 1usize;
    if !(tokens.get(cursor).is_some_and(|token| is_word(token, "OR"))
        && tokens
            .get(cursor + 1)
            .is_some_and(|token| is_word(token, "IGNORE")))
    {
        return None;
    }
    cursor += 2;
    if !tokens
        .get(cursor)
        .is_some_and(|token| is_word(token, "INTO"))
    {
        return None;
    }
    cursor += 1;
    let table = tokens.get(cursor).and_then(identifier)?;
    cursor += 1;

    let (first, last) = paren_group(tokens, cursor)?;
    let mut columns: Vec<String> = Vec::new();
    for (start, end) in split_top_level(tokens, first, last) {
        if end != start + 1 {
            return None; // an expression in the column list: not a plain seed
        }
        columns.push(identifier(&tokens[start])?);
    }
    if columns.is_empty() {
        return None;
    }
    cursor = last + 1;

    if !tokens
        .get(cursor)
        .is_some_and(|token| is_word(token, "VALUES"))
    {
        return None;
    }
    cursor += 1;

    let mut rows: Vec<Vec<(usize, usize)>> = Vec::new();
    while cursor < tokens.len() {
        let (row_first, row_last) = paren_group(tokens, cursor)?;
        let values = split_top_level(tokens, row_first, row_last);
        if values.len() != columns.len() {
            return None;
        }
        rows.push(values);
        cursor = row_last + 1;
        if tokens
            .get(cursor)
            .is_some_and(|token| token.kind == TokenKind::Punct && token.value == ",")
        {
            cursor += 1;
            continue;
        }
        break;
    }
    // A trailing comma leaves the cursor past it, which is not the end of a row.
    if rows.is_empty()
        || !tokens
            .get(cursor.wrapping_sub(1))
            .is_some_and(|token| token.kind == TokenKind::Punct && token.value == ")")
    {
        return None;
    }
    Some(IgnoreSeed {
        table,
        columns,
        rows,
        end: cursor,
    })
}

// ── Catalogue readers and matchers ───────────────────────────────

/// Whether some row already in the seed's table matches `row` on every column of
/// `constraint`, which is what makes `OR IGNORE` discard that row.
///
/// `Ok(false)` means *not evidence*: the statement does not name every column of
/// the constraint, or names one with something other than a literal. A `NULL`
/// literal is not evidence either, because `column = NULL` is never true in
/// SQLite — so a row whose constraint column is null is never treated as
/// already present.
fn row_already_present(
    conn: &Connection,
    tokens: &[Token<'_>],
    seed: &IgnoreSeed,
    row: &[(usize, usize)],
    constraint: &[String],
) -> Result<bool, PlatformError> {
    let mut predicate = String::new();
    let mut binds: Vec<Value> = Vec::new();
    for (index, column) in constraint.iter().enumerate() {
        let Some(position) = seed
            .columns
            .iter()
            .position(|named| named.eq_ignore_ascii_case(column))
        else {
            return Ok(false); // the statement does not name this constraint in full
        };
        let (start, end) = row[position];
        let Some(literal) = seed_literal(tokens, start, end) else {
            return Ok(false); // a computed value is not a proof
        };
        if index > 0 {
            predicate.push_str(" AND ");
        }
        predicate.push_str(&format!("{} = ?{}", quote_ident(column), index + 1));
        binds.push(literal);
    }
    let probe = format!(
        "SELECT 1 FROM {} WHERE {}",
        quote_ident(&seed.table),
        predicate
    );
    let found: Option<i64> = conn
        .query_row(&probe, rusqlite::params_from_iter(binds), |row| row.get(0))
        .optional()?;
    Ok(found.is_some())
}

/// The table's uniqueness constraints, as column lists: its primary key plus
/// every `UNIQUE` index that is neither partial nor an expression index.
///
/// A partial index is excluded because rows outside its predicate are not
/// rejected by it, and an expression index because its columns cannot be
/// compared against the statement's literals.
fn unique_constraints(conn: &Connection, table: &str) -> Result<Vec<Vec<String>>, PlatformError> {
    let mut constraints: Vec<Vec<String>> = Vec::new();
    let primary = primary_key_columns(conn, table)?;
    if !primary.is_empty() {
        constraints.push(primary);
    }

    let mut indexes = conn
        .prepare("SELECT name FROM pragma_index_list(?1) WHERE \"unique\" = 1 AND partial = 0")?;
    let names: Vec<String> = indexes
        .query_map(params![table], |row| row.get(0))?
        .collect::<Result<_, _>>()?;
    drop(indexes);

    for name in names {
        let mut info = conn.prepare("SELECT name FROM pragma_index_info(?1)")?;
        let columns: Vec<Option<String>> = info
            .query_map(params![name], |row| row.get(0))?
            .collect::<Result<_, _>>()?;
        if columns.iter().all(Option::is_some) {
            constraints.push(columns.into_iter().flatten().collect());
        }
    }
    Ok(constraints)
}

/// Whether the table carries a trigger that a discarded insert could still fire.
///
/// Textual, and deliberately conservative: a trigger that only fires on `UPDATE`
/// but writes to another table also answers `true`, which costs a skip and never
/// a wrong one. SQLite runs a `BEFORE INSERT` trigger even for a row the
/// `OR IGNORE` clause then discards (measured), so a table that carries one is
/// never skipped before execution.
fn has_insert_trigger(conn: &Connection, table: &str) -> Result<bool, PlatformError> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master \
         WHERE type = 'trigger' AND tbl_name = ?1 AND upper(sql) LIKE '%INSERT%'",
        params![table],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

/// The token range inside the parenthesised group that opens at `start`.
///
/// Returns `(first, last)` — the range **between** the parentheses — or `None`
/// when `start` is not an opening parenthesis or the group is never closed.
fn paren_group(tokens: &[Token<'_>], start: usize) -> Option<(usize, usize)> {
    if !tokens
        .get(start)
        .is_some_and(|token| token.kind == TokenKind::Punct && token.value == "(")
    {
        return None;
    }
    let mut depth = 0i32;
    let mut cursor = start;
    while cursor < tokens.len() {
        let token = &tokens[cursor];
        if token.kind == TokenKind::Punct {
            if token.value == "(" {
                depth += 1;
            } else if token.value == ")" {
                depth -= 1;
                if depth == 0 {
                    return Some((start + 1, cursor));
                }
            }
        }
        cursor += 1;
    }
    None
}

/// Split the token range `[start, end)` on its top-level commas.
fn split_top_level(tokens: &[Token<'_>], start: usize, end: usize) -> Vec<(usize, usize)> {
    let mut parts = Vec::new();
    let mut part_start = start;
    let mut depth = 0i32;
    let mut cursor = start;
    while cursor < end {
        let token = &tokens[cursor];
        if token.kind == TokenKind::Punct {
            if token.value == "(" {
                depth += 1;
            } else if token.value == ")" {
                depth -= 1;
            } else if token.value == "," && depth == 0 {
                parts.push((part_start, cursor));
                part_start = cursor + 1;
            }
        }
        cursor += 1;
    }
    parts.push((part_start, end));
    parts
}

/// The value of a one-token literal in a `VALUES` entry, or `None` when the entry
/// is an expression whose value cannot be read without evaluating it (a function
/// call, a concatenation, a `strftime(…)` timestamp). An unprovable key value is
/// never guessed at: the caller does not skip.
fn seed_literal(tokens: &[Token<'_>], start: usize, end: usize) -> Option<Value> {
    match end - start {
        1 => {
            let token = tokens.get(start)?;
            match token.kind {
                TokenKind::Str => Some(Value::Text(token.value.to_string())),
                TokenKind::Word => token.value.parse::<i64>().ok().map(Value::Integer),
                TokenKind::Quoted | TokenKind::Punct => None,
            }
        }
        2 if tokens[start].kind == TokenKind::Punct && tokens[start].value == "-" => tokens
            [end - 1]
            .value
            .parse::<i64>()
            .ok()
            .map(|value| Value::Integer(-value)),
        _ => None,
    }
}

/// The primary-key columns of a table, in key order. Empty when the table does
/// not exist or declares no primary key.
fn primary_key_columns(conn: &Connection, table: &str) -> Result<Vec<String>, PlatformError> {
    let mut statement =
        conn.prepare("SELECT name FROM pragma_table_info(?1) WHERE pk > 0 ORDER BY pk")?;
    let mut rows = statement.query(params![table])?;
    let mut keys = Vec::new();
    while let Some(row) = rows.next()? {
        keys.push(row.get::<_, String>(0)?);
    }
    Ok(keys)
}

/// Quote an identifier for interpolation into a probe query. Values are always
/// bound; identifiers cannot be, so the quoting is done here — with the doubled
/// `""` escape — instead of assuming a name needs no quoting.
fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

#[cfg(test)]
#[path = "proofs_tests.rs"]
mod tests;
