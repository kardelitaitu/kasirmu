//! Terminal profile CRUD — kiosk/kds lockdown per terminal.
/*
last audited 25-07-26 by RSA-Agent (oz-core slice B5 part 6)
crate: oz-core | status: SAFE | lint: CLEAN
findings: exists-check then ON CONFLICT upsert; clean
next: none | perf: N/A
*/
//!
//! Each terminal can have a profile type that controls which UI is
//! rendered and whether navigation is restricted. See the `050_terminal_profiles`
//! migration for schema details.

use rusqlite::params;

use crate::error::CoreError;
use crate::terminal_profile::TerminalProfile;

use super::Store;

impl Store<'_> {
    /// Get the profile for a terminal, if one exists.
    pub fn get_terminal_profile(
        &self,
        terminal_id: &str,
    ) -> Result<Option<TerminalProfile>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT terminal_id, profile_type, locked_screen, updated_at
             FROM terminal_profiles WHERE terminal_id = ?1",
        )?;
        let result = stmt.query_row(params![terminal_id], |row| {
            Ok(TerminalProfile {
                terminal_id: row.get("terminal_id")?,
                profile_type: row.get("profile_type")?,
                locked_screen: row.get("locked_screen")?,
                updated_at: row.get("updated_at")?,
            })
        });
        match result {
            Ok(p) => Ok(Some(p)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// Set (upsert) the profile for a terminal.
    ///
    /// If a profile already exists, it is replaced; otherwise a new
    /// row is inserted.
    pub fn set_terminal_profile(
        &self,
        terminal_id: &str,
        profile_type: &str,
        locked_screen: Option<&str>,
    ) -> Result<(), CoreError> {
        // Verify the terminal exists.
        let exists: bool = self
            .conn
            .query_row(
                "SELECT COUNT(*) FROM terminals WHERE id = ?1",
                params![terminal_id],
                |row| row.get::<_, i64>(0),
            )
            .map(|c| c > 0)
            .unwrap_or(false);

        if !exists {
            return Err(CoreError::NotFound {
                entity: "terminal",
                id: terminal_id.to_owned(),
            });
        }

        self.conn.execute(
            "INSERT INTO terminal_profiles (terminal_id, profile_type, locked_screen, updated_at)
             VALUES (?1, ?2, ?3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
             ON CONFLICT(terminal_id) DO UPDATE SET
                profile_type = excluded.profile_type,
                locked_screen = excluded.locked_screen,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
            params![terminal_id, profile_type, locked_screen],
        )?;
        Ok(())
    }

    /// Delete a terminal's profile row.
    pub fn delete_terminal_profile(&self, terminal_id: &str) -> Result<(), CoreError> {
        let affected = self.conn.execute(
            "DELETE FROM terminal_profiles WHERE terminal_id = ?1",
            params![terminal_id],
        )?;
        if affected == 0 {
            return Err(CoreError::NotFound {
                entity: "terminal_profile",
                id: terminal_id.to_owned(),
            });
        }
        self.persist_over_quota_markers()?;
        Ok(())
    }

    /// List all terminal profiles.
    pub fn list_terminal_profiles(&self) -> Result<Vec<TerminalProfile>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT terminal_id, profile_type, locked_screen, updated_at
             FROM terminal_profiles ORDER BY terminal_id ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(TerminalProfile {
                terminal_id: row.get("terminal_id")?,
                profile_type: row.get("profile_type")?,
                locked_screen: row.get("locked_screen")?,
                updated_at: row.get("updated_at")?,
            })
        })?;
        rows.map(|r| Ok(r?)).collect()
    }
}

#[cfg(test)]
#[path = "terminal_profiles_tests.rs"]
mod tests;
