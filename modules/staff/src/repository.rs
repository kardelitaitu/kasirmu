/*
last audited 31-08-26 by RSA-Agent (user-role campaign, Section E)
crate: modules-staff | status: SAFE | lint: CLEAN
findings: clean read-only user/role lookups, fully parameterized queries, Option-returning (no row-loss panics)
next: none | perf: indexed PK lookups
*/

//! Staff Repository — database persistence for users and roles.

use crate::error::StaffError;
use platform_core::staff::{Role, User};
use rusqlite::{Connection, params};

/// Database access repository for users and roles.
pub struct StaffRepository<'a> {
    conn: &'a Connection,
}

impl<'a> StaffRepository<'a> {
    /// Create a new `StaffRepository`.
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    /// Retrieve a user by ID.
    pub fn get_user(&self, id: &str) -> Result<Option<User>, StaffError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at
             FROM users WHERE id = ?1",
        )?;

        let mut rows = stmt.query(params![id])?;
        let row = match rows.next()? {
            Some(r) => r,
            None => return Ok(None),
        };

        Ok(Some(User {
            id: row.get(0)?,
            username: row.get(1)?,
            pin_hash: row.get(2)?,
            display_name: row.get(3)?,
            role_id: row.get(4)?,
            is_active: row.get::<_, i64>(5)? != 0,
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
        }))
    }

    /// Retrieve a role by ID.
    pub fn get_role(&self, id: &str) -> Result<Option<Role>, StaffError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, description, permissions, created_at, updated_at
             FROM roles WHERE id = ?1",
        )?;

        let mut rows = stmt.query(params![id])?;
        let row = match rows.next()? {
            Some(r) => r,
            None => return Ok(None),
        };

        Ok(Some(Role {
            id: row.get(0)?,
            name: row.get(1)?,
            description: row.get(2)?,
            permissions: row.get(3)?,
            created_at: row.get(4)?,
            updated_at: row.get(5)?,
        }))
    }
}

#[cfg(test)]
#[path = "repository_tests.rs"]
mod tests;
