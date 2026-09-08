//! Role authoring — the write side of custom roles (ADR #47 ruling 4).
//!
//! A custom role is a named key-set row in `roles`, and the assignment
//! model does not care whether the role is preset or authored: both resolve
//! through the same registry vocabulary, and an unknown key denies. What
//! existed was `create_role` only, so a role could be minted but never
//! corrected or retired — the authoring half of the feature.
//!
//! Key items: [`Store::update_role`], [`Store::delete_role`], and
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
//! [`Store::create_role`], [`Store::update_role`], [`Store::delete_role`] and
//! [`Store::role_reference_counts`]. A fifth write, `seed_default_roles`,
//! deliberately stays in [`super::staff`] — it is the preset upsert this
//! module exists to keep callers away from, and it does not route through
//! any of these four.

use rusqlite::{Connection, OptionalExtension, params};

use crate::error::CoreError;
use crate::{Role, Store};

/// Re-exported so the authoring IPC can label preset rows without taking a
/// `platform-core` dependency of its own. Reached through this module rather
/// than `oz_core`'s crate root because that re-export list is a shared edit
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
    /// [`Store::delete_role`] already enforce: `seed_default_roles` upserts
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
    pub fn delete_role(&self, id: &str) -> Result<(), CoreError> {
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
        tx.execute("DELETE FROM roles WHERE id = ?1", params![id])?;
        tx.commit()?;
        Ok(())
    }
}

#[cfg(test)]
#[path = "roles_tests.rs"]
mod tests;
