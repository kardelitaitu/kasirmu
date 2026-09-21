//! SQL statement text, and whether a statement's effect has already landed.
//!
//! The migration runner's drift re-apply has to decide one question about a
//! statement SQLite just refused: *is my intended change already in the
//! database?* Answering it means understanding SQL text, so this module owns
//! everything between a script and that answer:
//!
//! * **Splitting** — [`split_statements`] turns a script into statements, with a
//!   scanner that knows the four places a `;` can hide (a `--` comment, a
//!   `/* */` comment, a quoted literal or identifier, and a `CREATE TRIGGER`
//!   body). The split is lossless, so a fragment cannot be silently dropped.
//! * **Tokens** — [`tokenize`] and [`canonical_ddl`] give a comparable form of a
//!   statement, used both here and by the runner's comment-only filter.
//! * **Parsing** — `parse_add_column` / `parse_create` read the declared shape
//!   out of the two statement kinds whose effect can be checked against the
//!   catalogue.
//! * **Proof** — [`already_satisfied`] is the only entry point the runner calls.
//!   It is deliberately conservative: a statement it cannot prove is never
//!   skipped, because a wrong skip applies *nothing* while reporting success.
//!   Passing the error message as `&str` keeps the proof free of `rusqlite`
//!   error types, which is what makes it directly testable.
//!
//! This module never touches the migration ledger: it knows no `Migration`, no
//! `schema_migrations` and no checksums.

use rusqlite::types::Value;
use rusqlite::{Connection, OptionalExtension, params};

use crate::error::PlatformError;

// ── Statement splitting ──────────────────────────────────────────
//
// SQLite's own splitter is not reachable from `rusqlite` 0.31: the tail
// pointer `sqlite3_prepare_v3` produces is stored in `RawStatement::tail`,
// which is `pub(crate)` (`Statement::check_no_tail` is the only consumer).
// The fallback therefore walks the script itself, with a scanner that knows
// the four places a `;` can hide — a `--` comment, a `/* */` comment, a
// quoted literal or identifier, and a `CREATE TRIGGER` body, whose `;`
// separators sit between `BEGIN` and the `END` that closes it.

/// Split a migration script into its individual statements.
///
/// The split is lossless: concatenating the returned slices reproduces the
/// input exactly, so a fragment cannot be silently dropped.
pub(super) fn split_statements(sql: &str) -> Vec<&str> {
    let mut statements = Vec::new();
    let mut start = 0usize;
    let mut index = 0usize;
    // Inside a `CREATE TRIGGER` body, `BEGIN` and `CASE` open a level and
    // `END` closes one. The `;` that ends the statement is the first one seen
    // at level zero *after* the body's own `END` has closed it.
    let mut in_trigger = false;
    let mut trigger_depth = 0i32;
    let mut trigger_body_closed = false;
    let mut lead: Vec<&str> = Vec::with_capacity(3);

    while index < sql.len() {
        let rest = &sql[index..];
        if rest.starts_with("--") {
            index = skip_line_comment(sql, index + 2);
            continue;
        }
        if rest.starts_with("/*") {
            index = skip_block_comment(sql, index + 2);
            continue;
        }
        let ch = rest.chars().next().expect("index is on a char boundary");
        if ch == '\'' {
            index = skip_quoted(sql, index, '\'').1;
        } else if ch == '"' || ch == '`' {
            index = skip_quoted(sql, index, ch).1;
        } else if ch == '[' {
            index = skip_bracket(sql, index).1;
        } else if ch == ';' {
            if !in_trigger || (trigger_depth == 0 && trigger_body_closed) {
                statements.push(&sql[start..index + 1]);
                start = index + 1;
                in_trigger = false;
                trigger_depth = 0;
                trigger_body_closed = false;
                lead.clear();
            }
            index += 1;
        } else if is_identifier_char(ch) {
            let word_start = index;
            while index < sql.len() {
                let c = sql[index..].chars().next().expect("char boundary");
                if is_identifier_char(c) {
                    index += c.len_utf8();
                } else {
                    break;
                }
            }
            let word = &sql[word_start..index];
            if in_trigger {
                if word.eq_ignore_ascii_case("BEGIN") || word.eq_ignore_ascii_case("CASE") {
                    trigger_depth += 1;
                } else if word.eq_ignore_ascii_case("END") && trigger_depth > 0 {
                    trigger_depth -= 1;
                    if trigger_depth == 0 {
                        trigger_body_closed = true;
                    }
                }
            } else {
                if lead.len() < 3 {
                    lead.push(word);
                }
                if is_create_trigger_lead(&lead) {
                    in_trigger = true;
                }
            }
        } else {
            index += ch.len_utf8();
        }
    }
    if start < sql.len() {
        statements.push(&sql[start..]);
    }
    statements
}

/// Whether a character can appear in a bare SQL word (identifier or keyword).
fn is_identifier_char(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || ch == '_' || ch == '$'
}

/// Whether the leading words of a statement spell `CREATE [TEMP|TEMPORARY]
/// TRIGGER`.
fn is_create_trigger_lead(lead: &[&str]) -> bool {
    let is = |word: &str, expected: &str| word.eq_ignore_ascii_case(expected);
    match lead {
        [create, trigger] => is(create, "CREATE") && is(trigger, "TRIGGER"),
        [create, temp, trigger] => {
            is(create, "CREATE")
                && (is(temp, "TEMP") || is(temp, "TEMPORARY"))
                && is(trigger, "TRIGGER")
        }
        _ => false,
    }
}

/// Skip a quoted region opened by `quote` at `index`; returns
/// `(body_end, next_index)`. A doubled quote is an escaped quote rather than
/// a terminator, and an unterminated region runs to the end of the input.
fn skip_quoted(sql: &str, index: usize, quote: char) -> (usize, usize) {
    let mut cursor = index + quote.len_utf8();
    while cursor < sql.len() {
        let ch = sql[cursor..].chars().next().expect("char boundary");
        if ch == quote {
            let after = cursor + ch.len_utf8();
            if sql[after..].starts_with(quote) {
                cursor = after + quote.len_utf8();
                continue;
            }
            return (cursor, after);
        }
        cursor += ch.len_utf8();
    }
    (sql.len(), sql.len())
}

/// Skip a `[...]` identifier opened at `index`; returns `(body_end, next)`.
fn skip_bracket(sql: &str, index: usize) -> (usize, usize) {
    let mut cursor = index + 1;
    while cursor < sql.len() {
        if sql.as_bytes()[cursor] == b']' {
            return (cursor, cursor + 1);
        }
        cursor += sql[cursor..]
            .chars()
            .next()
            .expect("char boundary")
            .len_utf8();
    }
    (sql.len(), sql.len())
}

/// Skip past the newline that ends a `--` comment (or to the end of input).
fn skip_line_comment(sql: &str, index: usize) -> usize {
    match sql[index..].find('\n') {
        Some(offset) => index + offset + 1,
        None => sql.len(),
    }
}

/// Skip past the `*/` that closes a `/* */` comment (or to the end of input).
fn skip_block_comment(sql: &str, index: usize) -> usize {
    match sql[index..].find("*/") {
        Some(offset) => index + offset + 2,
        None => sql.len(),
    }
}

// ── Statement classification ─────────────────────────────────────

/// A significant token of a SQL statement. Whitespace and comments are not
/// tokens.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TokenKind {
    /// A bare word: `ALTER`, `products`, `TEXT`, `0`.
    Word,
    /// A single-quoted literal; `value` is the body without the quotes.
    Str,
    /// A quoted identifier (`"x"`, `` `x` ``, `[x]`); `value` is the body.
    Quoted,
    /// Any other significant character: `(`, `)`, `,`, `;`.
    Punct,
}

/// One token of a SQL statement.
#[derive(Debug, Clone, Copy)]
struct Token<'a> {
    kind: TokenKind,
    /// Unquoted token text.
    value: &'a str,
}

/// Tokenize a SQL statement, dropping whitespace and comments.
fn tokenize(sql: &str) -> Vec<Token<'_>> {
    let mut tokens = Vec::new();
    let mut index = 0usize;
    while index < sql.len() {
        let rest = &sql[index..];
        let ch = rest.chars().next().expect("index is on a char boundary");
        if ch.is_whitespace() {
            index += ch.len_utf8();
            continue;
        }
        if rest.starts_with("--") {
            index = skip_line_comment(sql, index + 2);
            continue;
        }
        if rest.starts_with("/*") {
            index = skip_block_comment(sql, index + 2);
            continue;
        }
        match ch {
            '\'' | '"' | '`' => {
                let (body_end, next) = skip_quoted(sql, index, ch);
                tokens.push(Token {
                    kind: if ch == '\'' {
                        TokenKind::Str
                    } else {
                        TokenKind::Quoted
                    },
                    value: &sql[index + ch.len_utf8()..body_end],
                });
                index = next;
            }
            '[' => {
                let (body_end, next) = skip_bracket(sql, index);
                tokens.push(Token {
                    kind: TokenKind::Quoted,
                    value: &sql[index + 1..body_end],
                });
                index = next;
            }
            _ if is_identifier_char(ch) => {
                let start = index;
                while index < sql.len() {
                    let c = sql[index..].chars().next().expect("char boundary");
                    if is_identifier_char(c) {
                        index += c.len_utf8();
                    } else {
                        break;
                    }
                }
                tokens.push(Token {
                    kind: TokenKind::Word,
                    value: &sql[start..index],
                });
            }
            _ => {
                tokens.push(Token {
                    kind: TokenKind::Punct,
                    value: &sql[index..index + ch.len_utf8()],
                });
                index += ch.len_utf8();
            }
        }
    }
    tokens
}

/// Canonical, comparable form of a token sequence.
///
/// SQL keywords, identifiers and function names are case-insensitive, so they
/// are upper-cased; string literals are not, so they are kept verbatim and
/// delimited, which also keeps a literal from ever being confused with a bare
/// word. Tokens are joined with a separator that cannot occur inside one.
fn canonical(tokens: &[Token<'_>]) -> String {
    let mut parts: Vec<String> = Vec::with_capacity(tokens.len());
    for token in tokens {
        match token.kind {
            TokenKind::Str => parts.push(format!("'{}'", token.value)),
            _ => parts.push(token.value.to_ascii_uppercase()),
        }
    }
    parts.join("\u{1}")
}

/// Canonical form of a whole DDL statement, for comparison against the text
/// SQLite stores in `sqlite_master.sql`.
///
/// SQLite strips `IF NOT EXISTS` from the DDL it stores — measured, not
/// assumed — so the clause is dropped from both sides before comparing.
pub(super) fn canonical_ddl(sql: &str) -> String {
    let tokens = tokenize(sql);
    let mut kept: Vec<Token<'_>> = Vec::with_capacity(tokens.len());
    let mut index = 0usize;
    while index < tokens.len() {
        let token = tokens[index];
        if is_terminator(&token) {
            index += 1;
            continue;
        }
        if is_word(&token, "IF")
            && tokens.get(index + 1).is_some_and(|t| is_word(t, "NOT"))
            && tokens.get(index + 2).is_some_and(|t| is_word(t, "EXISTS"))
        {
            index += 3;
            continue;
        }
        kept.push(token);
        index += 1;
    }
    canonical(&kept)
}

/// Whether a token is a statement terminator.
fn is_terminator(token: &Token<'_>) -> bool {
    token.kind == TokenKind::Punct && token.value == ";"
}

/// Whether a token is the given bare keyword, ignoring case.
fn is_word(token: &Token<'_>, word: &str) -> bool {
    token.kind == TokenKind::Word && token.value.eq_ignore_ascii_case(word)
}

/// The unquoted text of an identifier token.
fn identifier(token: &Token<'_>) -> Option<String> {
    match token.kind {
        TokenKind::Word | TokenKind::Quoted => Some(token.value.to_string()),
        _ => None,
    }
}

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
    // INSERT OR IGNORE INTO <table> ( <columns> ) VALUES ( … ), ( … )
    let mut cursor = 1usize;
    if !(tokens.get(cursor).is_some_and(|token| is_word(token, "OR"))
        && tokens
            .get(cursor + 1)
            .is_some_and(|token| is_word(token, "IGNORE")))
    {
        return Ok(false);
    }
    cursor += 2;
    if !tokens
        .get(cursor)
        .is_some_and(|token| is_word(token, "INTO"))
    {
        return Ok(false);
    }
    cursor += 1;
    let Some(table) = tokens.get(cursor).and_then(identifier) else {
        return Ok(false);
    };
    cursor += 1;

    let Some((first, last)) = paren_group(tokens, cursor) else {
        return Ok(false);
    };
    let mut columns: Vec<String> = Vec::new();
    for (start, end) in split_top_level(tokens, first, last) {
        if end != start + 1 {
            return Ok(false); // an expression in the column list: not a plain seed
        }
        match identifier(&tokens[start]) {
            Some(name) => columns.push(name),
            None => return Ok(false),
        }
    }
    if columns.is_empty() {
        return Ok(false);
    }
    cursor = last + 1;

    // The key the seed is identified by, and the absence half of the proof.
    let keys = primary_key_columns(conn, &table)?;
    if keys.is_empty() {
        return Ok(false); // no such table, or a table without a primary key
    }
    let mut absent: Vec<String> = Vec::new();
    let mut present = 0usize;
    for name in &columns {
        if column_info(conn, &table, name)?.is_some() {
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

    let mut key_positions: Vec<(String, usize)> = Vec::new();
    for key in &keys {
        match columns
            .iter()
            .position(|name| name.eq_ignore_ascii_case(key))
        {
            Some(position) => key_positions.push((key.clone(), position)),
            None => return Ok(false), // the seed does not name the whole key
        }
    }

    if !tokens
        .get(cursor)
        .is_some_and(|token| is_word(token, "VALUES"))
    {
        return Ok(false);
    }
    cursor += 1;

    let mut rows = 0usize;
    while cursor < tokens.len() {
        let Some((row_first, row_last)) = paren_group(tokens, cursor) else {
            return Ok(false);
        };
        let values = split_top_level(tokens, row_first, row_last);
        if values.len() != columns.len() {
            return Ok(false);
        }
        let mut predicate = String::new();
        let mut binds: Vec<Value> = Vec::new();
        for (index, (key, position)) in key_positions.iter().enumerate() {
            let (start, end) = values[*position];
            let Some(literal) = seed_literal(tokens, start, end) else {
                return Ok(false); // a computed key value is not a proof
            };
            if index > 0 {
                predicate.push_str(" AND ");
            }
            predicate.push_str(&format!("{} = ?{}", quote_ident(key), index + 1));
            binds.push(literal);
        }
        let probe = format!("SELECT 1 FROM {} WHERE {}", quote_ident(&table), predicate);
        let found: Option<i64> = conn
            .query_row(&probe, rusqlite::params_from_iter(binds), |row| row.get(0))
            .optional()?;
        if found.is_none() {
            return Ok(false); // a row the seed asks for is missing: never skipped
        }
        rows += 1;
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
    Ok(rows > 0)
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
#[path = "statements_tests.rs"]
mod tests;
