//! `NamespacedStore` - a module-scoped, runtime-checked view over the shared
//! connection (plan section 7 Phase 2, P1 of `docs/architecture/phase2-implementation-tickets.md`).
//!
//! The Phase 1 checker (`scripts/verify-namespace-governance.py`) governs what raw
//! SQL a *file* may say. It cannot stop a runtime path that assembles SQL from data.
//! This module adds a *runtime-checked* route beside it: a module wraps the borrowed
//! connection, and every statement is validated against the table-ownership map
//! (`crate::db::ownership`) before it runs.
//!
//! Design constraints, from `docs/architecture/namespaced-store-api-draft.md`:
//! - **C1 one connection, zero copies.** The store borrows `&Connection`; it never
//!   owns, clones, or pools one.
//! - **C2 additive.** Existing `conn`-taking functions keep working; a module opts in
//!   by wrapping.
//! - **no cross-namespace write.** Only reads of a foreign namespace are possible; the
//!   `Grants` struct has no `write` field by construction.
//!
//! The scanner is a deliberate reimplementation of the proven
//! `crates/kasirmu-plugin/src/db.rs` logic, not a call into it: `kasirmu-core` does
//! not depend on `kasirmu-plugin`, and adding that edge would invert the dependency
//! graph. The behaviour mirrors the plugin scanner.

use rusqlite::Connection;

use crate::db::Store;
use crate::db::ownership;

/// The identity of a module, matching its manifest `id`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct ModuleId(pub &'static str);

impl ModuleId {
    /// The raw module id string.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        self.0
    }
}

impl core::fmt::Display for ModuleId {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str(self.0)
    }
}

/// The foreign namespaces a module may read (ADR-62 D5).
///
/// There is deliberately no `write` field: the current tree has no sanctioned
/// cross-namespace write, and adding the door now would invite the first one.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Grants {
    read: Vec<ModuleId>,
}

impl Grants {
    /// No foreign reads at all (the default, and correct for most modules).
    #[must_use]
    pub fn none() -> Self {
        Self { read: Vec::new() }
    }

    /// Build grants from the modules whose data may be read.
    #[must_use]
    pub fn read(modules: impl IntoIterator<Item = ModuleId>) -> Self {
        Self {
            read: modules.into_iter().collect(),
        }
    }

    /// Build read grants from a manifest `capabilities` list.
    ///
    /// Phase 4 P4.1: a module's own namespace is reached through `own()`, not a
    /// grant, so `read:<own>` and `write:<own>` are skipped; every other
    /// `read:<module>` becomes a foreign read grant. `write:<other>` is ignored
    /// because [`Grants`] has no write field by construction. Entries that are
    /// not `read:`/`write:` actions (such as `subscribe:<event>`) contribute
    /// nothing.
    ///
    /// The `module` argument is the owning module's own id, so its `read:<id>`
    /// entries are not mistaken for foreign grants.
    ///
    /// [`ModuleId`] holds a `&'static str`, so the borrowed capability targets
    /// are interned for the process lifetime. This is a boot-time construction
    /// (once per module), so the leak is bounded and intentional; callers on a
    /// per-request path should build grants from `ModuleId` constants instead.
    #[must_use]
    pub fn from_capabilities(module: ModuleId, capabilities: &[String]) -> Self {
        let read = capabilities
            .iter()
            .filter_map(|cap| cap.strip_prefix("read:"))
            .filter(|target| *target != module.0)
            .map(|target| {
                // Module ids are `&'static str`; the manifest's capability
                // strings are borrowed, so intern the target for the grant.
                ModuleId(Box::leak(target.to_string().into_boxed_str()))
            })
            .collect();
        Self { read }
    }

    /// Whether `module` may be read.
    #[must_use]
    pub fn allows(&self, module: ModuleId) -> bool {
        self.read.contains(&module)
    }

    /// The granted modules.
    #[must_use]
    pub fn modules(&self) -> &[ModuleId] {
        &self.read
    }
}

/// Why a statement was rejected by the namespace check.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NamespaceError {
    /// The statement names a table owned by a module not in the grants.
    Foreign {
        /// The offending table.
        table: String,
        /// The module that owns it.
        owner: ModuleId,
        /// The module that tried to touch it.
        self_owner: ModuleId,
    },
    /// The statement names a table the ownership map does not know.
    /// Fail-closed: an unmapped table is a governance gap, not permission.
    UnknownTable {
        /// The offending table.
        table: String,
    },
    /// A foreign namespace was requested that is not granted.
    NotGranted {
        /// The module that was requested.
        module: ModuleId,
    },
    /// The SQL could not be validated (quoting, comments, malformed literal).
    Sql(String),
    /// The underlying database returned an error.
    Db(String),
}

impl core::fmt::Display for NamespaceError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            NamespaceError::Foreign {
                table,
                owner,
                self_owner,
            } => write!(
                f,
                "namespace violation: module '{self_owner}' reads table '{table}' owned by '{owner}'"
            ),
            NamespaceError::UnknownTable { table } => {
                write!(
                    f,
                    "namespace violation: table '{table}' is not in the ownership map"
                )
            }
            NamespaceError::NotGranted { module } => {
                write!(
                    f,
                    "namespace violation: no read grant for module '{module}'"
                )
            }
            NamespaceError::Sql(reason) => write!(f, "namespace SQL rejected: {reason}"),
            NamespaceError::Db(reason) => write!(f, "namespace db error: {reason}"),
        }
    }
}

impl std::error::Error for NamespaceError {}

impl From<rusqlite::Error> for NamespaceError {
    fn from(e: rusqlite::Error) -> Self {
        NamespaceError::Db(e.to_string())
    }
}

/// A module-scoped view over a borrowed shared connection.
pub struct NamespacedStore<'a> {
    store: Store<'a>,
    owner: ModuleId,
    grants: Grants,
}

impl<'a> NamespacedStore<'a> {
    /// Wrap a store for `owner`, with the foreign namespaces in `grants`.
    #[must_use]
    pub fn new(store: Store<'a>, owner: ModuleId, grants: Grants) -> Self {
        Self {
            store,
            owner,
            grants,
        }
    }

    /// The owning module's own namespace (reads and writes allowed).
    #[must_use]
    pub fn own(&self) -> Namespace<'_, 'a> {
        Namespace {
            conn: self.store.conn,
            owner: self.owner,
            posture: Posture::ReadWrite,
            _handle: core::marker::PhantomData,
        }
    }

    /// A sanctioned read-only view of another module's namespace.
    ///
    /// # Errors
    /// Returns [`NamespaceError::NotGranted`] when `module` is not in the grants.
    pub fn read(&self, module: ModuleId) -> Result<Namespace<'_, 'a>, NamespaceError> {
        if self.grants.allows(module) {
            Ok(Namespace {
                conn: self.store.conn,
                owner: module,
                posture: Posture::ReadOnly,
                _handle: core::marker::PhantomData,
            })
        } else {
            Err(NamespaceError::NotGranted { module })
        }
    }

    /// The grants this store was built with.
    #[must_use]
    pub fn grants(&self) -> &Grants {
        &self.grants
    }

    /// The owning module.
    #[must_use]
    pub fn owner(&self) -> ModuleId {
        self.owner
    }

    /// The underlying borrowed connection (the migration escape hatch; prefer
    /// `own()`/`read()`).
    #[must_use]
    pub fn conn(&self) -> &'a Connection {
        self.store.conn
    }
}

/// Whether a namespace handle may write.
///
/// `ReadWrite` is the owning module's own namespace; `ReadOnly` is a granted
/// foreign read (no writes, enforced by [`check_statement`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Posture {
    /// The owning module's own namespace: reads and writes.
    ReadWrite,
    /// A granted foreign namespace: reads only.
    ReadOnly,
}

/// A handle to one module's namespace. Statements are checked before execution.
#[derive(Debug)]
pub struct Namespace<'s, 'a> {
    conn: &'a Connection,
    owner: ModuleId,
    posture: Posture,
    _handle: core::marker::PhantomData<&'s ()>,
}

impl Namespace<'_, '_> {
    /// Validate a statement against the ownership map, then execute it.
    ///
    /// # Errors
    /// Returns a [`NamespaceError`] if the statement is rejected by the check
    /// or by the database.
    pub fn execute<P: rusqlite::Params>(
        &self,
        sql: &str,
        params: P,
    ) -> Result<usize, NamespaceError> {
        check_statement(self.owner, &Grants::none(), sql, self.posture)?;
        self.conn.execute(sql, params).map_err(NamespaceError::from)
    }

    /// Validate a statement, then run it and map rows with `map`.
    ///
    /// # Errors
    /// Returns a [`NamespaceError`] if the statement is rejected by the check
    /// or by the database.
    pub fn query<T, P, F>(&self, sql: &str, params: P, mut map: F) -> Result<Vec<T>, NamespaceError>
    where
        P: rusqlite::Params,
        F: FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<T>,
    {
        check_statement(self.owner, &Grants::none(), sql, self.posture)?;
        let mut stmt = self.conn.prepare(sql).map_err(NamespaceError::from)?;
        let rows = stmt
            .query_map(params, |row| map(row))
            .map_err(NamespaceError::from)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(NamespaceError::from)?);
        }
        Ok(out)
    }

    /// Validate a statement, then run it and map rows with a mapper that may
    /// itself fail with a domain error.
    ///
    /// [`query`](Self::query) pins the mapper to [`rusqlite::Result`], which
    /// cannot express a *deliberate* domain rejection such as "this column is not
    /// a valid currency". Modules that fail closed on parsed values use this
    /// variant instead: `E` is the module error, which must be constructible
    /// from both a [`rusqlite::Error`] and a [`NamespaceError`].
    ///
    /// # Errors
    /// Returns `E` when the statement is rejected by the check, the database
    /// rejects it, or the mapper rejects a row.
    pub fn query_try<T, P, F, E>(&self, sql: &str, params: P, mut map: F) -> Result<Vec<T>, E>
    where
        P: rusqlite::Params,
        F: FnMut(&rusqlite::Row<'_>) -> Result<T, E>,
        E: From<rusqlite::Error> + From<NamespaceError>,
    {
        check_statement(self.owner, &Grants::none(), sql, self.posture).map_err(E::from)?;
        let mut stmt = self.conn.prepare(sql).map_err(E::from)?;
        let mut rows = stmt.query(params).map_err(E::from)?;
        let mut out = Vec::new();
        while let Some(row) = rows.next().map_err(E::from)? {
            out.push(map(row)?);
        }
        Ok(out)
    }

}

/// The pure core of the namespace check: what tables does `sql` name, and may
/// `owner` touch them given `grants`?
///
/// Deliberately a free function over plain values so it unit-tests without a
/// database (P1 acceptance criterion).
///
/// # Errors
/// [`NamespaceError::Sql`] for unparseable/unsafe SQL,
/// [`NamespaceError::UnknownTable`] for an unmapped table, and
/// [`NamespaceError::Foreign`] for a mapped table the module may not read.
pub fn check_statement(
    owner: ModuleId,
    grants: &Grants,
    sql: &str,
    posture: Posture,
) -> Result<(), NamespaceError> {
    ensure_no_quoted_identifiers(sql)?;
    let stripped = strip_sql_comments(sql);
    if matches!(posture, Posture::ReadOnly) && is_write_statement(&stripped) {
        return Err(NamespaceError::Sql(
            "write statements are not allowed on a foreign (read-only) namespace".into(),
        ));
    }
    for table in extract_table_references(&stripped) {
        match ownership::owner_of(&table) {
            None => return Err(NamespaceError::UnknownTable { table }),
            Some(table_owner) => {
                if table_owner == owner.as_str() {
                    continue;
                }
                let owner_module = ModuleId(table_owner);
                if grants.allows(owner_module) {
                    continue;
                }
                return Err(NamespaceError::Foreign {
                    table,
                    owner: owner_module,
                    self_owner: owner,
                });
            }
        }
    }
    Ok(())
}

/// Whether the statement's leading verb is a write (DML) verb.
fn is_write_statement(sql: &str) -> bool {
    let head = sql.trim_start().to_ascii_lowercase();
    [
        "insert", "update", "delete", "replace", "drop", "alter", "create",
    ]
    .iter()
    .any(|v| head.starts_with(v))
}

// -- SQL scanner (mirrors crates/kasirmu-plugin/src/db.rs) ---------------------

/// Reject quoted identifiers (fail-closed). Double-quoted, back-quoted, and
/// bracketed identifiers would bypass bare-name extraction.
fn ensure_no_quoted_identifiers(sql: &str) -> Result<(), NamespaceError> {
    let bytes = sql.as_bytes();
    let mut in_string = false;
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'\'' => {
                if in_string && i + 1 < bytes.len() && bytes[i + 1] == b'\'' {
                    i += 2;
                    continue;
                }
                in_string = !in_string;
            }
            b'"' | b'`' | b'[' | b']' if !in_string => {
                return Err(NamespaceError::Sql(
                    "quoted identifiers are not allowed (use bare names, e.g. sales not \"sales\")"
                        .into(),
                ));
            }
            _ => {}
        }
        i += 1;
    }
    if in_string {
        return Err(NamespaceError::Sql("unterminated string literal".into()));
    }
    Ok(())
}

/// Remove `--` line and `/* */` block comments, leaving string literals intact.
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

/// Extract bare table names from the statements this API allows, skipping CTE names.
fn extract_table_references(sql: &str) -> Vec<String> {
    let lower = sql.to_ascii_lowercase();
    let bytes = lower.as_bytes();
    let mut out: Vec<String> = Vec::new();
    let cte_names = extract_cte_names(&lower);
    for kw in ["from", "join", "update", "into", "table", "delete from"] {
        let mut start = 0;
        while let Some(rel) = lower[start..].find(kw) {
            let at = start + rel;
            // Must be a word boundary before the keyword.
            if at > 0 && (bytes[at - 1].is_ascii_alphanumeric() || bytes[at - 1] == b'_') {
                start = at + kw.len();
                continue;
            }
            // `UPDATE` introduces a table only as a statement-initial write
            // verb. Inside an UPSERT it is `... ON CONFLICT (...) DO UPDATE
            // SET ...`, where "update" is part of the clause, not a table
            // reference — reading the next token would name "set".
            if kw == "update" && lower[..at].trim_end().ends_with(" do") {
                start = at + kw.len();
                continue;
            }
            let after = at + kw.len();
            if after < bytes.len() && (bytes[after].is_ascii_alphanumeric() || bytes[after] == b'_')
            {
                start = after;
                continue;
            }
            // Skip whitespace, then read an identifier (or a comma list for FROM).
            let mut j = after;
            while j < bytes.len() && bytes[j].is_ascii_whitespace() {
                j += 1;
            }
            // `TABLE IF [NOT] EXISTS name` -> skip the two qualifier words.
            if kw == "table" {
                for qual in ["if", "not", "exists"] {
                    if lower[j..].starts_with(qual) {
                        j += qual.len();
                        while j < bytes.len() && bytes[j].is_ascii_whitespace() {
                            j += 1;
                        }
                    }
                }
            }
            while j < bytes.len() && is_ident_continue(bytes[j]) {
                j += 1;
            }
            if j > after {
                let name = lower[skip_ws_start(&lower, after)..j].to_string();
                if !cte_names.contains(&name) {
                    out.push(name);
                }
            }
            start = after;
        }
    }
    out
}

/// First non-whitespace index at or after `from`.
fn skip_ws_start(s: &str, from: usize) -> usize {
    let bytes = s.as_bytes();
    let mut j = from;
    while j < bytes.len() && bytes[j].is_ascii_whitespace() {
        j += 1;
    }
    j
}

/// CTE names from `with <name> as (` and `), <name> as (`.
fn extract_cte_names(lower: &str) -> Vec<String> {
    let mut names = Vec::new();
    for kw in ["with", ","] {
        let mut start = 0;
        while let Some(rel) = lower[start..].find(kw) {
            let at = start + rel;
            let after = at + kw.len();
            let mut j = skip_ws_start(lower, after);
            if lower[j..].starts_with("recursive") {
                j = skip_ws_start(lower, j + "recursive".len());
            }
            let name_start = j;
            while j < lower.len() && is_ident_continue(lower.as_bytes()[j]) {
                j += 1;
            }
            if j > name_start {
                let rest = &lower[j..];
                if rest.trim_start().starts_with("as") {
                    names.push(lower[name_start..j].to_string());
                }
            }
            start = after;
        }
    }
    names
}

fn is_ident_continue(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

#[cfg(test)]
#[path = "namespaced_tests.rs"]
mod tests;
