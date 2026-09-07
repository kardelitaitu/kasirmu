//! Role assignments with explicit-all scopes (ADR #35 D5 / spec 0048).
/*
last audited 25-07-26 by RSA-Agent (oz-core slice B5 part 6)
crate: oz-core | status: SAFE | lint: CLEAN
findings: fail-closed scope evaluation (empty list never means all, unparsable mode = no assignment) — matches ADR #35 D5 exactly; multi-row writes in tx
next: none | perf: N/A
*/
//!
//! A user's single effective assignment pairs a role with a `scope_mode`:
//! `global` (org-level roles — Owner, Admin, Auditor; branch/workspace scope
//! is ignored) or `scoped` (each of the branch and workspace dimensions is an
//! explicit `all` or a `list` — empty lists never mean "all", per the ADR).
//!
//! The evaluation rule is fail-closed: a scoped assignment grants only when
//! every requested dimension is either explicit `all` or contains the
//! requested id; a missing request context on a `list` dimension denies; an
//! unparsable `scope_mode` row is treated as no assignment at all.

use rusqlite::{Connection, OptionalExtension, params};

use crate::error::CoreError;

use super::Store;

/// Assignment scope mode (ADR #35 D5).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScopeMode {
    /// Org-level role — branch and workspace scope are ignored.
    Global,
    /// Branch and workspace dimensions are evaluated.
    Scoped,
}

impl ScopeMode {
    /// The SQL value for this mode.
    pub fn as_str(self) -> &'static str {
        match self {
            ScopeMode::Global => "global",
            ScopeMode::Scoped => "scoped",
        }
    }

    /// Parse the SQL value; `None` for anything else (fail closed).
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "global" => Some(ScopeMode::Global),
            "scoped" => Some(ScopeMode::Scoped),
            _ => None,
        }
    }
}

/// A scoped assignment write (ADR #35 D5 / spec 0048): the scope mode plus
/// the per-dimension explicit-all flag and list. Empty lists never mean
/// "all" — the `*_all` flags are the explicit marker, so `list` with no
/// rows is a deny, not an implicit "all".
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssignmentSpec {
    /// `global` or `scoped`.
    pub scope_mode: ScopeMode,
    /// Branch dimension is explicit `all`.
    pub branches_all: bool,
    /// Branch ids in scope when `branches_all` is false.
    pub branches: Vec<String>,
    /// Workspace dimension is explicit `all`.
    pub workspaces_all: bool,
    /// Workspace keys in scope when `workspaces_all` is false.
    pub workspaces: Vec<String>,
    /// The ADR #47 resource axis (ruling 1A): which resource kind this
    /// assignment covers. Every writer before the assignment-creation
    /// slice granted only [`ScopeType::Organization`]; narrower kinds are
    /// how a manager gets bound to one location or entity.
    pub scope_type: ScopeType,
    /// The resource id; `None` exactly when `scope_type` is `Organization`
    /// (enforced by [`Self::validate_resource_pair`] and the SQL pair
    /// triggers).
    pub scope_id: Option<String>,
}

impl AssignmentSpec {
    /// The pre-ADR-47 default: org-wide, unrestricted on both 0048
    /// dimensions — the shape every default assignment has always had.
    pub fn org_wide() -> Self {
        Self {
            scope_mode: ScopeMode::Global,
            branches_all: true,
            branches: vec![],
            workspaces_all: true,
            workspaces: vec![],
            scope_type: ScopeType::Organization,
            scope_id: None,
        }
    }

    /// Reject an invalid (scope_type, scope_id) pair with a typed error
    /// before the SQL pair triggers abort the statement: the id is
    /// required for `legal_entity` / `location` and forbidden for
    /// `organization`.
    pub fn validate_resource_pair(&self) -> Result<(), CoreError> {
        match (self.scope_type, self.scope_id.as_deref()) {
            (ScopeType::Organization, None) => Ok(()),
            (ScopeType::Organization, Some(_)) => Err(CoreError::Validation {
                field: "scope_id",
                message: "organization scope must not carry a scope_id".into(),
            }),
            (_, None) | (_, Some("")) => Err(CoreError::Validation {
                field: "scope_id",
                message: format!(
                    "{} scope requires a non-empty scope_id",
                    self.scope_type.as_str()
                ),
            }),
            (_, Some(_)) => Ok(()),
        }
    }
}

/// Assignment scope type (ADR #47 ruling 1A): where in the business
/// hierarchy the assignment grants authority. `Organization` is the
/// org-wide row (the only type the backfill migration creates and the
/// only type today's callers write); `LegalEntity` and `Location` are
/// representable from migration `20260916_role_assignment_scopes.sql`
/// onward for the choke-point slice to resolve and later slices to
/// create. Workspaces and terminals are deliberately NOT scope types —
/// they sit below locations and inherit (ruling 1A).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScopeType {
    /// Org-wide — covers every legal entity, location, workspace, and
    /// terminal. Preserves the pre-ADR-47 behavior bit-for-bit.
    Organization,
    /// Covers only the named legal entity's locations (and, by downward
    /// inheritance, their workspaces and terminals).
    LegalEntity,
    /// Covers only the named location (and, by downward inheritance, its
    /// workspaces and terminals).
    Location,
}

impl ScopeType {
    /// Parse the SQL value; `None` for anything else (fail closed — an
    /// unparsable scope_type row must not silently become org-wide).
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "organization" => Some(ScopeType::Organization),
            "legal_entity" => Some(ScopeType::LegalEntity),
            "location" => Some(ScopeType::Location),
            _ => None,
        }
    }

    /// The SQL value for this type.
    pub fn as_str(self) -> &'static str {
        match self {
            ScopeType::Organization => "organization",
            ScopeType::LegalEntity => "legal_entity",
            ScopeType::Location => "location",
        }
    }
}

/// A user's single effective role assignment (ADR #35 D5).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Assignment {
    /// The owning user (also the assignments primary key).
    pub user_id: String,
    /// The role this user resolves to.
    pub role_id: String,
    /// `global` or `scoped`.
    pub scope_mode: ScopeMode,
    /// Branch dimension is explicit `all` (ignored for `Global`).
    pub branches_all: bool,
    /// Branch ids in scope when `branches_all` is false.
    pub branches: Vec<String>,
    /// Workspace dimension is explicit `all` (ignored for `Global`).
    pub workspaces_all: bool,
    /// Workspace keys in scope when `workspaces_all` is false.
    pub workspaces: Vec<String>,
    /// Hierarchical scope axis (ADR #47 ruling 1A). The backfill makes
    /// every row `Organization`, so legacy callers see unchanged behavior;
    /// `None` only when the row predates the scope columns AND a load
    /// path could not default it (unreachable via SQL — the column is
    /// NOT NULL DEFAULT — kept for defense-in-depth symmetry with
    /// `scope_mode` parsing).
    pub scope_type: Option<ScopeType>,
    /// The resource `scope_type` names. `None` exactly when the type is
    /// `Organization` (enforced by the migration's pair triggers).
    pub scope_id: Option<String>,
}

impl Assignment {
    /// Whether this assignment grants access to the given `(branch, workspace)`
    /// request context.
    ///
    /// - `Global` mode ignores both dimensions.
    /// - `Scoped` mode requires each dimension to be explicit `all` or contain
    ///   the requested id; `None` context on a `list` dimension denies
    ///   (fail closed), and an empty list never means "all".
    pub fn matches_scope(&self, branch: Option<&str>, workspace: Option<&str>) -> bool {
        match self.scope_mode {
            // Org-level roles ignore both dimensions.
            ScopeMode::Global => true,
            ScopeMode::Scoped => {
                let branch_ok = self.branches_all
                    || branch.is_some_and(|b| self.branches.iter().any(|x| x == b));
                let workspace_ok = self.workspaces_all
                    || workspace.is_some_and(|w| self.workspaces.iter().any(|x| x == w));
                branch_ok && workspace_ok
            }
        }
    }

    /// Whether this assignment's ADR #47 hierarchical scope covers the
    /// named resource (ruling 3, downward-only inheritance).
    ///
    /// - `Organization` covers everything (the backfill's bit-for-bit
    ///   behavior preservation).
    /// - `LegalEntity` covers only its own entity id; the entity→location
    ///   downward walk needs the locations table, so location refs are
    ///   resolved by the choke point (see `covers_location`), not here.
    /// - `Location` covers only its own location id.
    ///
    /// A row whose `scope_type`/`scope_id` pair is unparsable or missing
    /// denies (fail closed) — matching the `scope_mode` precedent.
    pub fn covers_resource(&self, scope_type: ScopeType, scope_id: &str) -> bool {
        match (self.scope_type, self.scope_id.as_deref()) {
            (Some(ScopeType::Organization), _) => true,
            (Some(ScopeType::LegalEntity), Some(id)) => {
                scope_type == ScopeType::LegalEntity && id == scope_id
            }
            (Some(ScopeType::Location), Some(id)) => {
                scope_type == ScopeType::Location && id == scope_id
            }
            _ => false,
        }
    }
}

impl Store<'_> {
    /// Load a user's single effective assignment, or `None` when the user has
    /// none — legacy rows created before 0048, or a corrupt `scope_mode`
    /// (fail closed: no assignment means no grant).
    pub fn assignment_for_user(&self, user_id: &str) -> Result<Option<Assignment>, CoreError> {
        let Some((role_id, scope_mode, branch_scope, workspace_scope, scope_type, scope_id)) = self
            .conn
            .query_row(
                "SELECT role_id, scope_mode, branch_scope, workspace_scope, scope_type, scope_id
                 FROM assignments WHERE user_id = ?1",
                params![user_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, Option<String>>(4)?,
                        row.get::<_, Option<String>>(5)?,
                    ))
                },
            )
            .optional()?
        else {
            return Ok(None);
        };

        // Fail closed: an unparsable scope_mode is treated as no assignment
        // (no grant). The schema CHECK makes this unreachable via SQL, but
        // defense-in-depth keeps the rule in the model.
        let Some(scope_mode) = ScopeMode::parse(&scope_mode) else {
            return Ok(None);
        };

        // Same fail-closed rule for the ADR #47 scope axis: an unparsable
        // scope_type denies (the choke point's covers_resource would too,
        // but a non-Organization row without a parsable type must not be
        // silently re-interpreted as org-wide). The column is NOT NULL
        // DEFAULT 'organization', so None here can only mean a hand-edited
        // DB — exactly the case the fail-closed rule exists for.
        let scope_type = match scope_type.as_deref().and_then(ScopeType::parse) {
            Some(t) => t,
            None => return Ok(None),
        };

        let branches = self.branch_ids_for(user_id)?;
        let workspaces = self.workspace_keys_for(user_id)?;

        Ok(Some(Assignment {
            user_id: user_id.to_string(),
            role_id,
            scope_mode,
            branches_all: branch_scope != "list",
            branches,
            workspaces_all: workspace_scope != "list",
            workspaces,
            scope_type: Some(scope_type),
            scope_id,
        }))
    }

    /// Write a user's assignment scope (ADR #35 D5 / spec 0048) inside an
    /// open transaction: upserts the `assignments` row and replaces the
    /// dimension rows. Safe to call inside an existing transaction — the
    /// statements join it (no nested BEGIN). Standalone callers should use
    /// [`Store::set_assignment`], which wraps this in one transaction.
    pub fn write_assignment_scope(
        &self,
        user_id: &str,
        role_id: &str,
        spec: &AssignmentSpec,
    ) -> Result<(), CoreError> {
        Self::write_assignment_scope_on(self.conn, user_id, role_id, spec)
    }

    /// Write a user's single effective assignment (ADR #35 D5 / spec 0048),
    /// atomic in its own transaction.
    ///
    /// Upserts the `assignments` row and replaces the scoped dimension rows
    /// to match: `branches_all` / `workspaces_all` set that dimension's `all`
    /// flag and clear its rows, so toggling `list` → `all` never leaves stale
    /// grants (and a `list` dimension re-inserts exactly the given ids — an
    /// empty list is a deny, never an implicit "all"). The `role_id` is kept
    /// in sync with `users.role_id` by `update_user` / `create_user`; this
    /// write preserves it and only replaces the scope.
    pub fn set_assignment(
        &self,
        user_id: &str,
        role_id: &str,
        spec: &AssignmentSpec,
    ) -> Result<(), CoreError> {
        let tx = self.conn.unchecked_transaction()?;
        Self::write_assignment_scope_on(&tx, user_id, role_id, spec)?;
        tx.commit()?;
        Ok(())
    }

    /// The upsert + dimension-replacement statements, runnable on any
    /// connection (joins an open transaction when one exists).
    ///
    /// Writes the ADR #47 scope axis from the spec: `organization` with a
    /// NULL id for org-wide grants, `legal_entity` / `location` with their
    /// resource id for narrowed ones (ruling 1A — the assignment-creation
    /// slice's IPC layer is the only intended producer of narrow rows, but
    /// the writer itself validates the pair so no caller can silently
    /// write an invalid one). The pair triggers remain the SQL backstop.
    fn write_assignment_scope_on(
        conn: &Connection,
        user_id: &str,
        role_id: &str,
        spec: &AssignmentSpec,
    ) -> Result<(), CoreError> {
        spec.validate_resource_pair()?;
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let branch_scope = if spec.branches_all { "all" } else { "list" };
        let workspace_scope = if spec.workspaces_all { "all" } else { "list" };

        conn.execute(
            "INSERT INTO assignments
                 (user_id, role_id, scope_mode, branch_scope, workspace_scope, scope_type, scope_id, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
             ON CONFLICT(user_id) DO UPDATE SET
                 role_id = excluded.role_id,
                 scope_mode = excluded.scope_mode,
                 branch_scope = excluded.branch_scope,
                 workspace_scope = excluded.workspace_scope,
                 scope_type = excluded.scope_type,
                 scope_id = excluded.scope_id,
                 updated_at = excluded.updated_at",
            params![
                user_id,
                role_id,
                spec.scope_mode.as_str(),
                branch_scope,
                workspace_scope,
                spec.scope_type.as_str(),
                spec.scope_id.as_deref(),
                now
            ],
        )?;

        // Replace the branch dimension rows: a stale row must never survive a
        // scope change, and `all` always means every branch (ADR #35 D5).
        conn.execute(
            "DELETE FROM assignment_branches WHERE assignment_user_id = ?1",
            params![user_id],
        )?;
        for branch in &spec.branches {
            conn.execute(
                "INSERT INTO assignment_branches (assignment_user_id, branch_id) VALUES (?1, ?2)",
                params![user_id, branch],
            )?;
        }

        // Same replacement semantics for the workspace dimension.
        conn.execute(
            "DELETE FROM assignment_workspaces WHERE assignment_user_id = ?1",
            params![user_id],
        )?;
        for workspace in &spec.workspaces {
            conn.execute(
                "INSERT INTO assignment_workspaces (assignment_user_id, workspace_key) VALUES (?1, ?2)",
                params![user_id, workspace],
            )?;
        }

        Ok(())
    }

    /// Branch ids in scope for a user's assignment (empty when `all`).
    fn branch_ids_for(&self, user_id: &str) -> Result<Vec<String>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT branch_id FROM assignment_branches
             WHERE assignment_user_id = ?1 ORDER BY branch_id",
        )?;
        let rows = stmt.query_map(params![user_id], |row| row.get::<_, String>(0))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    /// Workspace keys in scope for a user's assignment (empty when `all`).
    fn workspace_keys_for(&self, user_id: &str) -> Result<Vec<String>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT workspace_key FROM assignment_workspaces
             WHERE assignment_user_id = ?1 ORDER BY workspace_key",
        )?;
        let rows = stmt.query_map(params![user_id], |row| row.get::<_, String>(0))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }
}

#[cfg(test)]
#[path = "assignments_tests.rs"]
mod tests;
