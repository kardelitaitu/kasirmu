/*
last audited 25-07-26 by RSA-Agent (modules-terminal slice A: repository verified)
crate: modules-terminal | status: SAFE | lint: CLEAN
findings: clean parameterized terminal queries
next: none | perf: N/A
*/
//! Terminal Repository — database persistence layer for POS terminals.

use crate::error::TerminalError;
use crate::models::Terminal;
use kasirmu_core::db::Store;
use kasirmu_core::db::namespaced::{Grants, ModuleId, NamespacedStore};
use rusqlite::Connection;

/// The terminal module's own namespace id, as the ownership map names it.
const OWNER: ModuleId = ModuleId("terminal");

/// The module's own manifest, embedded so the runtime grant set is derived from
/// the same declaration the governance checker reads (Phase 4 P4.1 item 2).
const MANIFEST: &str = include_str!("../manifest.json");

/// Database access repository for terminal records.
///
/// Phase 3 P3.2: the repository reaches the database through a
/// [`NamespacedStore`] scoped to the `terminal` namespace rather than a bare
/// `&Connection`. `terminal` owns the `terminals` table
/// (`modules/ownership.json`), so it holds no foreign grant; the grant set is
/// derived from the embedded manifest (Phase 4 P4.1) and every statement is
/// checked against the ownership map before it runs.
pub struct TerminalRepository<'a> {
    ns: NamespacedStore<'a>,
}

impl<'a> TerminalRepository<'a> {
    /// Create a new `TerminalRepository` over the module's own namespace.
    pub fn new(conn: &'a Connection) -> Self {
        Self {
            ns: NamespacedStore::new(
                Store::new(conn),
                OWNER,
                Grants::from_manifest_json(OWNER, MANIFEST),
            ),
        }
    }

    /// Retrieve a terminal by ID.
    pub fn get_terminal(&self, id: &str) -> Result<Option<Terminal>, TerminalError> {
        let rows = self.ns.own().query(
            "SELECT id, name, device_id, terminal_secret, is_active, last_seen_at, metadata, created_at, updated_at
             FROM terminals WHERE id = ?1",
            rusqlite::params![id],
            |row| {
                Ok(Terminal {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    device_id: row.get(2)?,
                    terminal_secret: row.get(3)?,
                    is_active: row.get::<_, i64>(4)? != 0,
                    last_seen_at: row.get(5)?,
                    metadata: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            },
        )?;
        Ok(rows.into_iter().next())
    }
}

#[cfg(test)]
#[path = "repository_tests.rs"]
mod tests;
