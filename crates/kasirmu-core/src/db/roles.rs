//! Role authoring — the write side of custom roles (ADR #47 ruling 4).
//!
//! A custom role is a named key-set row in `roles`, and the assignment
//! model does not care whether the role is preset or authored: both resolve
//! through the same registry vocabulary, and an unknown key denies. What
//! existed was `create_role` only, so a role could be minted but never
//! corrected or retired — the authoring half of the feature.
//!
//! Key items: [`Store::update_role`], [`Store::soft_delete_role`] (the role's
//! half of the trash), [`Store::restore_role`], and
//! [`Store::role_reference_counts`].
//!
//! Invariants:
//!
//! - **Preset ids are not authorable.** `seed_default_roles` upserts every
//!   `RolePreset` id and overwrites its grants, and it is reachable from
//!   the UI (`seed_default_roles_scoped`), so an edit to one of those rows
//!   is silently destroyed later. Refusing is the only honest answer a
//!   write can give to a row it does not own.
//! - **One grant-validation rule** for every role write: registered keys
//!   only, `"*"` never, sensitive keys never under a family wildcard
//!   (ADR #35 D3 / spec 0046).
//! - **A role in use cannot be dropped** from under its holders.
//! - **Writes are transactional**, and the read that justifies a write
//!   happens inside the same transaction.
//!
//! All four operations live here, so role CRUD has exactly one rule set:
//! [`Store::create_role`], [`Store::update_role`], [`Store::soft_delete_role`]
//! (plus the trash's `restore_role`, `list_trashed_roles` and
//! `purge_expired_roles`) and [`Store::role_reference_counts`]. A fifth write,
//! `seed_default_roles`,
//! deliberately stays in [`super::staff`] — it is the preset upsert this
//! module exists to keep callers away from, and it does not route through
//! any of these four.

use rusqlite::{Connection, OptionalExtension, params};

use super::staff::{TRASH_RETENTION_DAYS, TrashedRole};

use crate::error::CoreError;
use crate::{Role, Store};

/// Re-exported so the authoring IPC can label preset rows without taking a
/// `platform-core` dependency of its own. Reached through this module rather
/// than `kasirmu_core`'s crate root because that re-export list is a shared edit
/// point; the predicate itself lives beside `ROLE_PRESETS`, which is the only
/// thing it can be correct against.
pub use platform_core::rbac::is_builtin_role_id;

/// The tables that point at a role, in the order diagnostics list them.
///
/// Each declares `REFERENCES roles(id)` with the default NO ACTION, so
/// SQLite would raise a bare constraint violation on any of them. Reading
/// the counts first is what turns that into a message naming the referrer.
const ROLE_REFERRERS: [&str; 4] = [
    "users",
    "assignments",
    "role_workspace_types",
    "role_workspaces",
];

/// The largest holder list [`Store::role_holders`] returns in one call.
///
/// A deliberate cap, not a page size: the question asked of it is "who can
/// do what with this role", and a role held by four hundred accounts is a
/// list nobody reads. The total comes back regardless, so a surface can say
/// "and 350 more" honestly instead of truncating in silence.
pub const ROLE_HOLDERS_MAX: i64 = 50;

/// The single predicate that decides who holds a role.
///
/// Shared verbatim between [`Store::role_holders`] and
/// [`Store::role_holder_count`] so a count and a list of the same thing
/// cannot drift apart — which matters because they are rendered side by side
/// ("N accounts" beside the expanded list). Assignment first with a
/// `users.role_id` fallback, mirroring `Store::authorize_with`; see
/// [`Store::role_holders`] for why neither simpler form is correct.
const HOLDERS_FROM_WHERE: &str = " FROM users u LEFT JOIN assignments a ON a.user_id = u.id
                                  WHERE COALESCE(a.role_id, u.role_id) = ?1";

/// One account that resolves to a role, as reported by
/// [`Store::role_holders`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoleHolder {
    /// The account id.
    pub user_id: String,
    /// Login name.
    pub username: String,
    /// Display name.
    pub display_name: String,
    /// Whether the account is active. A deactivated holder still holds the
    /// role and still blocks deleting it, so this is shown, never filtered.
    pub is_active: bool,
    /// `false` when the account has no `assignments` row at all and resolves
    /// through `users.role_id` — the legacy arm of the resolver. Every scope
    /// field below is then `None`, which is NOT the same fact as "scoped to
    /// nothing".
    pub has_assignment: bool,
    /// `global` or `scoped` (the 0048 branch/workspace dimension).
    pub scope_mode: Option<String>,
    /// The ADR #47 resource axis: `organization` / `legal_entity` /
    /// `location`.
    pub scope_type: Option<String>,
    /// The resource the assignment is bound to; `None` exactly when
    /// `scope_type` is `organization`.
    pub scope_id: Option<String>,
    /// `all` or `list` — which dimension the branch count describes. Read
    /// this BEFORE `branch_count`: a scoped assignment with `all` covers
    /// every branch, so its count of explicit list rows being zero means
    /// "unrestricted", not "nothing". Reporting only the count would render
    /// an all-branches manager as having no branches at all.
    pub branch_scope: Option<String>,
    /// `all` or `list`, for `workspace_count` — same caveat.
    pub workspace_scope: Option<String>,
    /// Branch ids in scope; `None` when there is no assignment row.
    pub branch_count: Option<i64>,
    /// Workspace keys in scope; `None` when there is no assignment row.
    pub workspace_count: Option<i64>,
}

impl Store<'_> {
    /// Parse and validate a grant set — the rule every role write shares,
    /// so create and update can never disagree about what a legal
    /// permission list is.
    ///
    /// Every grant must be registered and sensitive keys must never ride a
    /// family wildcard (ADR #35 D3 / spec 0046). The global `"*"` is
    /// refused (`allow_global = false`): it is reserved for the Owner
    /// seed, which uses a direct insert and is never validated here.
    pub(crate) fn validate_permission_grants(permissions: &str) -> Result<(), CoreError> {
        let grants: Vec<String> =
            serde_json::from_str(permissions).map_err(|e| CoreError::Validation {
                field: "permissions",
                message: format!("permissions must be a JSON array of strings: {e}"),
            })?;
        platform_core::permission_registry::validate_grants(&grants, false).map_err(|errors| {
            let message = errors
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
                .join("; ");
            CoreError::Validation {
                field: "permissions",
                message,
            }
        })
    }

    /// Refuse to author a row whose id the preset seeder owns.
    ///
    /// Note `role-custom` is itself a preset — the empty-grant placeholder
    /// the role picker offers — so a role being *called* custom does not
    /// make its row authored. Only ids outside `ROLE_PRESETS` are.
    pub(crate) fn reject_builtin_role_id(id: &str) -> Result<(), CoreError> {
        if platform_core::rbac::is_builtin_role_id(id) {
            return Err(CoreError::Validation {
                field: "id",
                message: format!(
                    "{id} is a built-in preset role, re-synced from the preset on every seed; \
                     it cannot be authored — create a role with a new id instead"
                ),
            });
        }
        Ok(())
    }

    /// Rows still pointing at this role, as `(table, count)` for each
    /// referrer that has any.
    ///
    /// Public because the authoring UI disables Delete from the same
    /// numbers the delete path checks, and a second source for the count
    /// would drift from the one that actually decides.
    pub fn role_reference_counts(&self, id: &str) -> Result<Vec<(&'static str, i64)>, CoreError> {
        Self::role_references_on(self.conn, id)
    }

    /// The referrer counts on any connection, so a caller already inside a
    /// transaction reads the same view its write will be judged against.
    fn role_references_on(
        conn: &Connection,
        id: &str,
    ) -> Result<Vec<(&'static str, i64)>, CoreError> {
        let mut out = Vec::new();
        for table in ROLE_REFERRERS {
            let count: i64 = conn.query_row(
                &format!("SELECT COUNT(*) FROM {table} WHERE role_id = ?1"),
                params![id],
                |row| row.get(0),
            )?;
            if count > 0 {
                out.push((table, count));
            }
        }
        Ok(out)
    }

    /// Turn a uniqueness violation on the role name into the typed
    /// [`CoreError::Conflict`]; anything else passes through as `Db`.
    fn map_role_conflict(e: rusqlite::Error) -> CoreError {
        if let rusqlite::Error::SqliteFailure(ref f, _) = e
            && f.code == rusqlite::ErrorCode::ConstraintViolation
        {
            return CoreError::Conflict {
                entity: "role",
                field: "name",
            };
        }
        CoreError::Db(e)
    }

    /// Insert a new authored role.
    ///
    /// Preset ids are refused — see [`Store::reject_builtin_role_id`]. This is
    /// the create-side half of the rule [`Store::update_role`] and
    /// [`Store::soft_delete_role`] already enforce: `seed_default_roles` upserts
    /// every `RolePreset` id and overwrites its grants, so a row minted at one
    /// of those ids before the first seed is silently destroyed by it later,
    /// with no error to trace. The production caller generates
    /// `role-<uuidv7>` and documents that it is outside `ROLE_PRESETS` by
    /// construction — but until this guard existed that was a convention the
    /// command layer asked of itself, and the core write path would have
    /// accepted a preset id from any other caller.
    ///
    /// Grants go through [`Store::validate_permission_grants`], the same rule
    /// `update_role` applies, so create and update can never disagree about
    /// what a legal permission list is.
    ///
    /// # Errors
    ///
    /// [`CoreError::Validation`] for a preset id, an empty name, or an illegal
    /// grant set; [`CoreError::Conflict`] when `id` or `name` collides with an
    /// existing row. Known imprecision, carried over unchanged from the
    /// pre-fold version rather than silently fixed here: SQLite reports both
    /// as a bare constraint violation, and [`Store::map_role_conflict`] names
    /// `field: "name"` for either. A duplicate `id` therefore surfaces as a
    /// name conflict. Changing that error shape is a separate call — it is
    /// what the authoring UI reads — so this commit documents it instead of
    /// quietly moving a contract.
    pub fn create_role(
        &self,
        id: &str,
        name: &str,
        description: &str,
        permissions: &str,
    ) -> Result<Role, CoreError> {
        Self::reject_builtin_role_id(id)?;
        let name = name.trim();
        if name.is_empty() {
            return Err(CoreError::Validation {
                field: "name",
                message: "role name must not be empty".into(),
            });
        }
        Self::validate_permission_grants(permissions)?;

        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "INSERT INTO roles (id, name, description, permissions, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, name, description, permissions, now, now],
        )
        .map_err(Self::map_role_conflict)?;
        tx.commit()?;

        Ok(Role {
            id: id.to_owned(),
            name: name.to_owned(),
            description: description.to_owned(),
            permissions: permissions.to_owned(),
            created_at: now.clone(),
            updated_at: now,
        })
    }

    /// The accounts that resolve to this role, org-wide, capped at
    /// [`ROLE_HOLDERS_MAX`].
    ///
    /// Returns `(holders, total)` — `holders` is at most `limit` rows
    /// (clamped to `[1, ROLE_HOLDERS_MAX]`) in stable
    /// `(display_name COLLATE NOCASE, id)` order, and `total` is the full
    /// count regardless of the cap, which is what lets a caller render
    /// "and N more" truthfully.
    ///
    /// # The predicate is the resolver's, not the schema's
    ///
    /// `WHERE COALESCE(a.role_id, u.role_id) = ?1` is the whole design. A
    /// user resolves to a role assignment FIRST, with `users.role_id` as the
    /// fallback (see `Store::authorize_with`). So a query over
    /// `users.role_id` alone would list someone under a role they do not
    /// actually hold whenever the two disagree, and a query over
    /// `assignments.role_id` alone would silently drop every legacy account
    /// that has no assignment row. Both states are real: `update_user` keeps
    /// the pair in sync, but the sync is not a constraint, and a legacy row
    /// is not a bug. This is the one place a holder list can be read, so it
    /// reads it the way authorization resolves it.
    ///
    /// # Why this need not agree with [`Self::role_reference_counts`]
    ///
    /// Different questions. The referrer counts are FOREIGN KEY truth — "may
    /// this role be deleted" — and an `ON DELETE NO ACTION` row blocks
    /// deletion whether or not it decides resolution. This list is
    /// RESOLUTION truth — "what can this account do". For a synced user they
    /// name the same set; for a divergent one they do not, and neither is
    /// wrong. A holder is by construction also a referrer when the two agree,
    /// which is why `role_holders_agree_with_reference_counts_when_synced`
    /// pins the common case rather than assuming it.
    ///
    /// # Errors
    ///
    /// [`CoreError::NotFound`] when no such role — an empty list for a role
    /// that does not exist would read as "nobody holds this" and invite a
    /// delete decision on a typo.
    pub fn role_holders(
        &self,
        role_id: &str,
        limit: i64,
    ) -> Result<(Vec<RoleHolder>, i64), CoreError> {
        if self.get_role(role_id)?.is_none() {
            return Err(CoreError::NotFound {
                entity: "role",
                id: role_id.to_owned(),
            });
        }
        let bounded = limit.clamp(1, ROLE_HOLDERS_MAX);

        let total: i64 = self.conn.query_row(
            &format!("SELECT COUNT(*){HOLDERS_FROM_WHERE}"),
            params![role_id],
            |row| row.get(0),
        )?;

        let mut stmt = self.conn.prepare(&format!(
            "SELECT u.id, u.username, u.display_name, u.is_active,
                    a.user_id IS NOT NULL,
                    a.scope_mode, a.scope_type, a.scope_id,
                    a.branch_scope, a.workspace_scope,
                    CASE WHEN a.user_id IS NULL THEN NULL ELSE
                      (SELECT COUNT(*) FROM assignment_branches b
                       WHERE b.assignment_user_id = u.id) END,
                    CASE WHEN a.user_id IS NULL THEN NULL ELSE
                      (SELECT COUNT(*) FROM assignment_workspaces w
                       WHERE w.assignment_user_id = u.id) END
             {HOLDERS_FROM_WHERE}
             ORDER BY u.display_name COLLATE NOCASE ASC, u.id ASC
             LIMIT ?2"
        ))?;
        let rows = stmt.query_map(params![role_id, bounded], |row| {
            Ok(RoleHolder {
                user_id: row.get(0)?,
                username: row.get(1)?,
                display_name: row.get(2)?,
                is_active: row.get(3)?,
                has_assignment: row.get(4)?,
                scope_mode: row.get(5)?,
                scope_type: row.get(6)?,
                scope_id: row.get(7)?,
                branch_scope: row.get(8)?,
                workspace_scope: row.get(9)?,
                branch_count: row.get(10)?,
                workspace_count: row.get(11)?,
            })
        })?;
        let mut holders = Vec::new();
        for row in rows {
            holders.push(row?);
        }
        Ok((holders, total))
    }

    /// How many accounts resolve to this role — the count, without the rows.
    ///
    /// Built on the same [`HOLDERS_FROM_WHERE`] as [`Self::role_holders`],
    /// deliberately: the "N accounts" a surface prints must never disagree
    /// with the list rendered beside it.
    ///
    /// It is NOT derivable from [`Self::role_reference_counts`].
    /// `create_user` writes a `users` row AND an `assignments` row for the
    /// same person, so summing referrer rows counts every ordinary account
    /// twice — three holders read as six. Nor is it a matter of which table is
    /// queried: an account resolving through the legacy `users.role_id` arm is
    /// still exactly one holder. Counting accounts is therefore a question about
    /// resolution, and resolution has one definition in this crate.
    ///
    /// # Errors
    ///
    /// [`CoreError::NotFound`] when no such role — the same refusal as
    /// [`Self::role_holders`], so a caller cannot get a count for a role that
    /// would list nobody.
    pub fn role_holder_count(&self, role_id: &str) -> Result<i64, CoreError> {
        if self.get_role(role_id)?.is_none() {
            return Err(CoreError::NotFound {
                entity: "role",
                id: role_id.to_owned(),
            });
        }
        let total: i64 = self.conn.query_row(
            &format!("SELECT COUNT(*){HOLDERS_FROM_WHERE}"),
            params![role_id],
            |row| row.get(0),
        )?;
        Ok(total)
    }

    /// Re-name, re-describe, or re-grant an authored role.
    ///
    /// Editing a role re-points every user who holds it, so the grant set
    /// is validated exactly as on create — the vocabulary rule enforced at
    /// read time has to hold on the write path too, or the registry stops
    /// being the only source of truth.
    ///
    /// Preset ids are refused; see [`Store::reject_builtin_role_id`].
    ///
    /// # Errors
    ///
    /// [`CoreError::Validation`] for a preset id, an empty name, or an
    /// illegal grant set; [`CoreError::NotFound`] when no such role;
    /// [`CoreError::Conflict`] when `name` collides with another role.
    pub fn update_role(
        &self,
        id: &str,
        name: &str,
        description: &str,
        permissions: &str,
    ) -> Result<Role, CoreError> {
        Self::reject_builtin_role_id(id)?;
        let name = name.trim();
        if name.is_empty() {
            return Err(CoreError::Validation {
                field: "name",
                message: "role name must not be empty".into(),
            });
        }
        Self::validate_permission_grants(permissions)?;

        let tx = self.conn.unchecked_transaction()?;
        let created_at: Option<String> = tx
            .query_row(
                "SELECT created_at FROM roles WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .optional()?;
        let Some(created_at) = created_at else {
            return Err(CoreError::NotFound {
                entity: "role",
                id: id.to_owned(),
            });
        };
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        tx.execute(
            "UPDATE roles SET name = ?1, description = ?2, permissions = ?3, updated_at = ?4
             WHERE id = ?5",
            params![name, description, permissions, now, id],
        )
        .map_err(Self::map_role_conflict)?;
        tx.commit()?;

        Ok(Role {
            id: id.to_owned(),
            name: name.to_owned(),
            description: description.to_owned(),
            permissions: permissions.to_owned(),
            created_at,
            updated_at: now,
        })
    }

    /// Delete an authored role.
    ///
    /// Refuses preset ids for the same reason as [`Store::update_role`],
    /// and refuses any role still referenced — by a user, an assignment, or
    /// a workspace grant — so the caller is told to reassign first rather
    /// than hitting a raw FK error. Deleting a role a user still holds
    /// would strand it: `authorize_with` resolves the role and fails closed
    /// when it is missing, so the effect would be silent loss of access
    /// rather than an error.
    ///
    /// # Errors
    ///
    /// [`CoreError::Validation`] for a preset id or a still-referenced
    /// role; [`CoreError::NotFound`] when no such role.
    pub fn soft_delete_role(&self, id: &str) -> Result<(), CoreError> {
        Self::reject_builtin_role_id(id)?;

        let tx = self.conn.unchecked_transaction()?;
        let exists: Option<i64> = tx
            .query_row("SELECT 1 FROM roles WHERE id = ?1", params![id], |row| {
                row.get(0)
            })
            .optional()?;
        if exists.is_none() {
            return Err(CoreError::NotFound {
                entity: "role",
                id: id.to_owned(),
            });
        }
        let refs = Self::role_references_on(&tx, id)?;
        if !refs.is_empty() {
            let detail = refs
                .iter()
                .map(|(table, count)| format!("{table}={count}"))
                .collect::<Vec<_>>()
                .join(", ");
            return Err(CoreError::Validation {
                field: "id",
                message: format!(
                    "role {id} is still referenced ({detail}); reassign those rows before deleting it"
                ),
            });
        }
        // The row is STAMPED, not removed. Every guard above ran first, so a
        // trashed role is one nothing references — which is also what makes the
        // eventual purge a real DELETE (see `purge_expired_roles`).
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let rows = tx.execute(
            "UPDATE roles SET deleted_at = ?1, updated_at = ?1 \
             WHERE id = ?2 AND deleted_at IS NULL",
            params![now, id],
        )?;
        if rows == 0 {
            return Err(CoreError::Validation {
                field: "deleted_at",
                message: "this role is already in the trash".to_owned(),
            });
        }
        tx.commit()?;
        Ok(())
    }

    /// Take a custom role back out of the trash.
    ///
    /// # Errors
    ///
    /// [`CoreError::NotFound`] when no such role, or when it is not in the
    /// trash to begin with — a restore is not a way to prove a role exists.
    pub fn restore_role(&self, id: &str) -> Result<Role, CoreError> {
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let rows = self.conn.execute(
            "UPDATE roles SET deleted_at = NULL, updated_at = ?1 \
             WHERE id = ?2 AND deleted_at IS NOT NULL",
            params![now, id],
        )?;
        if rows == 0 {
            return Err(CoreError::NotFound {
                entity: "role",
                id: id.to_owned(),
            });
        }
        self.get_role(id)?.ok_or_else(|| CoreError::NotFound {
            entity: "role",
            id: id.to_owned(),
        })
    }

    /// The custom roles currently in the trash, newest first.
    ///
    /// RESTORABLE rows only: the same cutoff the purge compares against is a
    /// predicate here, so a window that has closed is never listed as if it had
    /// time left. The purge runs immediately before this read in the same command,
    /// which is what makes the two consistent — a row that survives the purge
    /// either has time left or is one the purge refused to delete because
    /// something still references it, and neither is restorable-and-hidden.
    pub fn list_trashed_roles(&self) -> Result<Vec<TrashedRole>, CoreError> {
        let cutoff = (chrono::Utc::now() - chrono::Duration::days(TRASH_RETENTION_DAYS))
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let mut stmt = self.conn.prepare(
            "SELECT id, name, description, permissions, created_at, updated_at, deleted_at \
             FROM roles WHERE deleted_at IS NOT NULL AND deleted_at >= ?1 ORDER BY deleted_at DESC",
        )?;
        let rows = stmt.query_map([&cutoff], |row| {
            Ok(TrashedRole {
                role: Role {
                    id: row.get("id")?,
                    name: row.get("name")?,
                    description: row.get("description")?,
                    permissions: row.get("permissions")?,
                    created_at: row.get("created_at")?,
                    updated_at: row.get("updated_at")?,
                },
                deleted_at: row.get("deleted_at")?,
            })
        })?;
        rows.map(|r| Ok(r?)).collect()
    }

    /// Remove trashed roles whose retention window has closed.
    ///
    /// THE ONE ROLE PATH THAT REALLY DELETES, and the reason it may: a role
    /// carries no personal data, and `soft_delete_role` only trashes a role
    /// after `role_references_on` proved nothing names it — so removing the row
    /// strands nothing and erases nobody. The staff half cannot do this
    /// (`purge_expired_users` anonymises instead) because shifts, stock
    /// transactions and audit rows must keep resolving to a person.
    ///
    /// The reference check is repeated here anyway, inside the same
    /// transaction as the delete: the guard held at trash time, and this is the
    /// second door, not a copy of the first.
    ///
    /// Deliberately NOT through the RESTORABLE read: `list_trashed_roles` excludes a
    /// closed window, which is precisely the set this sweep exists to delete. Reading
    /// it here made the purge report 0 and delete nothing while the expired rows
    /// stayed on disk, so the sweep asks the table for the expired set directly.
    /// Fixed-width RFC 3339 millis, so comparing the strings compares the instants —
    /// the clock check in SQL's own vocabulary, and the same boundary the read uses.
    pub fn purge_expired_roles(&self) -> Result<usize, CoreError> {
        let cutoff = (chrono::Utc::now() - chrono::Duration::days(TRASH_RETENTION_DAYS))
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let expired: Vec<String> = {
            let mut stmt = self
                .conn
                .prepare("SELECT id FROM roles WHERE deleted_at IS NOT NULL AND deleted_at < ?1")?;
            let rows = stmt.query_map([&cutoff], |row| row.get::<_, String>(0))?;
            rows.collect::<Result<Vec<_>, _>>()?
        };
        let tx = self.conn.unchecked_transaction()?;
        let mut removed = 0usize;
        for id in expired {
            if !Self::role_references_on(&tx, &id)?.is_empty() {
                continue;
            }
            removed += tx.execute("DELETE FROM roles WHERE id = ?1", params![id])?;
        }
        tx.commit()?;
        Ok(removed)
    }
}

#[cfg(test)]
#[path = "roles_tests.rs"]
mod tests;
