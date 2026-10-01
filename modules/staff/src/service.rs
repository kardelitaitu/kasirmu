/*
last audited 31-08-26 by RSA-Agent (user-role campaign, Section E)
crate: modules-staff | status: SAFE | lint: CLEAN
findings: clean thin service facade over StaffRepository (get_user/get_role only — no mutation surface, no authz responsibility by design; enforcement lives in the centralized gate)
next: none | perf: N/A
*/

//! Staff Service — user and role business workflows.

use crate::error::StaffError;
use crate::repository::StaffRepository;
use platform_core::staff::{Role, User};
use rusqlite::Connection;

/// Service encapsulating staff management workflows.
pub struct StaffService;

impl StaffService {
    /// Retrieve user by ID.
    pub fn get_user(conn: &Connection, id: &str) -> Result<Option<User>, StaffError> {
        let repo = StaffRepository::new(conn);
        repo.get_user(id)
    }

    /// Retrieve role by ID.
    pub fn get_role(conn: &Connection, id: &str) -> Result<Option<Role>, StaffError> {
        let repo = StaffRepository::new(conn);
        repo.get_role(id)
    }
}

#[cfg(test)]
#[path = "service_tests.rs"]
mod tests;
