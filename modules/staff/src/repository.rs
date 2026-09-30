/*
last audited 31-08-26 by RSA-Agent (user-role campaign, Section E)
crate: modules-staff | status: SAFE | lint: CLEAN
findings: clean read-only user/role lookups, fully parameterized queries, Option-returning (no row-loss panics)
next: none | perf: indexed PK lookups
*/

//! Staff Repository — database persistence for users and roles.

use crate::error::StaffError;
use kasirmu_core::db::Store;
use kasirmu_core::db::namespaced::{Grants, ModuleId, NamespacedStore};
use platform_core::staff::{Role, User};
use rusqlite::Connection;

/// The staff module's own namespace id, as the ownership map names it.
const OWNER: ModuleId = ModuleId("staff");

/// Database access repository for users and roles.
///
/// Phase 3 P3.2: reaches the database through a [`NamespacedStore`] scoped to
/// the `staff` namespace rather than a bare `&Connection`, so every statement is
/// checked against `modules/ownership.json` before it runs. `staff` owns
/// `users` and `roles`, so the store carries `Grants::none()`.
pub struct StaffRepository<'a> {
    ns: NamespacedStore<'a>,
}

impl<'a> StaffRepository<'a> {
    /// Create a new `StaffRepository` over the module's own namespace.
    pub fn new(conn: &'a Connection) -> Self {
        Self {
            ns: NamespacedStore::new(Store::new(conn), OWNER, Grants::none()),
        }
    }

    /// Retrieve a user by ID.
    pub fn get_user(&self, id: &str) -> Result<Option<User>, StaffError> {
        let rows = self.ns.own().query(
            "SELECT id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at
             FROM users WHERE id = ?1",
            rusqlite::params![id],
            |row| {
                Ok(User {
                    id: row.get(0)?,
                    username: row.get(1)?,
                    pin_hash: row.get(2)?,
                    display_name: row.get(3)?,
                    role_id: row.get(4)?,
                    is_active: row.get::<_, i64>(5)? != 0,
                    created_at: row.get(6)?,
                    updated_at: row.get(7)?,
                })
            },
        )?;
        Ok(rows.into_iter().next())
    }

    /// Retrieve a role by ID.
    pub fn get_role(&self, id: &str) -> Result<Option<Role>, StaffError> {
        let rows = self.ns.own().query(
            "SELECT id, name, description, permissions, created_at, updated_at
             FROM roles WHERE id = ?1",
            rusqlite::params![id],
            |row| {
                Ok(Role {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    description: row.get(2)?,
                    permissions: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                })
            },
        )?;
        Ok(rows.into_iter().next())
    }
}

#[cfg(test)]
#[path = "repository_tests.rs"]
mod tests;
