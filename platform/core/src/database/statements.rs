//! SQL statement text: splitting a script and comparing its statements.
//!
//! The migration runner's drift re-apply has to reason about SQL text before it
//! can decide anything about a statement, and this module owns that text layer:
//!
//! * **Splitting** — [`split_statements`] turns a script into statements, with a
//!   scanner that knows the four places a `;` can hide (a `--` comment, a
//!   `/* */` comment, a quoted literal or identifier, and a `CREATE TRIGGER`
//!   body). The split is lossless, so a fragment cannot be silently dropped.
//! * **Tokens** — [`tokenize`] and [`canonical_ddl`] give a comparable form of a
//!   statement, used here and exposed to the runner only through
//!   [`is_significant`], which says whether a fragment has any effect at all.
//!
//! The layer is pure: it opens no connection, reads no catalogue and keeps no
//! state. The two proofs that decide whether a statement's effect has already
//! landed — or would not land at all — live in [`super::proofs`], which consumes
//! this module's tokens and parsers.

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
pub(super) enum TokenKind {
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
pub(super) struct Token<'a> {
    pub kind: TokenKind,
    /// Unquoted token text.
    pub value: &'a str,
}

/// Tokenize a SQL statement, dropping whitespace and comments.
pub(super) fn tokenize(sql: &str) -> Vec<Token<'_>> {
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
pub(super) fn canonical(tokens: &[Token<'_>]) -> String {
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

/// Whether a fragment of a script has any effect at all.
///
/// The splitter's output is lossless, so a fragment can be whitespace, a
/// trailing comment, or nothing but comments — those have to be filtered by
/// whoever runs the statements, and this is the one place that decides it. A
/// fragment is significant when tokens remain once terminators, a dropped
/// `IF NOT EXISTS` clause and comments are accounted for, which is exactly what
/// a non-empty canonical form means.
pub(super) fn is_significant(statement: &str) -> bool {
    !canonical_ddl(statement).is_empty()
}

/// Whether a token is a statement terminator.
pub(super) fn is_terminator(token: &Token<'_>) -> bool {
    token.kind == TokenKind::Punct && token.value == ";"
}

/// Whether a token is the given bare keyword, ignoring case.
pub(super) fn is_word(token: &Token<'_>, word: &str) -> bool {
    token.kind == TokenKind::Word && token.value.eq_ignore_ascii_case(word)
}

/// The unquoted text of an identifier token.
pub(super) fn identifier(token: &Token<'_>) -> Option<String> {
    match token.kind {
        TokenKind::Word | TokenKind::Quoted => Some(token.value.to_string()),
        _ => None,
    }
}

#[cfg(test)]
#[path = "statements_tests.rs"]
mod tests;
