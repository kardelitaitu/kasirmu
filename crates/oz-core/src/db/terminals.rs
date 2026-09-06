//! Terminal Management — register, list, update, ping, delete terminals.
/*
last audited 25-07-26 by RSA-Agent (oz-core slice B5 part 6)
crate: oz-core | status: SAFE | lint: CLEAN
findings: clean CRUD + HMAC binding signature for tamper detection; terminal_secret stored plaintext (acceptable local-POS threat model, same note as COR-17 — revisit for cloud sync)
next: none | perf: N/A
*/

use rusqlite::params;

use crate::Terminal;
use crate::error::CoreError;

use super::Store;

impl Store<'_> {
    /// List all registered terminals.
    pub fn list_terminals(&self) -> Result<Vec<Terminal>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, device_id, terminal_secret, is_active,
                    last_seen_at, metadata, created_at, updated_at
             FROM terminals ORDER BY name ASC",
        )?;
        let rows = stmt.query_map([], Self::row_to_terminal)?;
        rows.map(|r| Ok(r?)).collect()
    }

    /// Get a terminal by id.
    pub fn get_terminal(&self, id: &str) -> Result<Option<Terminal>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, device_id, terminal_secret, is_active,
                    last_seen_at, metadata, created_at, updated_at
             FROM terminals WHERE id = ?1",
        )?;
        let result = stmt.query_row(params![id], Self::row_to_terminal);
        match result {
            Ok(t) => Ok(Some(t)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// Get a terminal by device_id.
    pub fn get_terminal_by_device_id(
        &self,
        device_id: &str,
    ) -> Result<Option<Terminal>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, device_id, terminal_secret, is_active,
                    last_seen_at, metadata, created_at, updated_at
             FROM terminals WHERE device_id = ?1",
        )?;
        let result = stmt.query_row(params![device_id], Self::row_to_terminal);
        match result {
            Ok(t) => Ok(Some(t)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// Register a new terminal.
    pub fn create_terminal(&self, terminal: &Terminal) -> Result<(), CoreError> {
        if terminal.name.trim().is_empty() {
            return Err(CoreError::Validation {
                field: "name",
                message: "terminal name must not be empty".into(),
            });
        }
        if terminal.device_id.trim().is_empty() {
            return Err(CoreError::Validation {
                field: "device_id",
                message: "terminal device_id must not be empty".into(),
            });
        }
        self.conn.execute(
            "INSERT INTO terminals (id, name, device_id, terminal_secret, is_active,
                                    last_seen_at, metadata, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                terminal.id,
                terminal.name,
                terminal.device_id,
                terminal.terminal_secret,
                terminal.is_active as i64,
                terminal.last_seen_at,
                terminal.metadata,
                terminal.created_at,
                terminal.updated_at,
            ],
        )?;
        Ok(())
    }

    /// Update an existing terminal.
    pub fn update_terminal(&self, terminal: &Terminal) -> Result<(), CoreError> {
        if terminal.name.trim().is_empty() {
            return Err(CoreError::Validation {
                field: "name",
                message: "terminal name must not be empty".into(),
            });
        }
        let affected = self.conn.execute(
            "UPDATE terminals SET name = ?1, device_id = ?2, terminal_secret = ?3,
                                   is_active = ?4, last_seen_at = ?5, metadata = ?6,
                                   updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?7",
            params![
                terminal.name,
                terminal.device_id,
                terminal.terminal_secret,
                terminal.is_active as i64,
                terminal.last_seen_at,
                terminal.metadata,
                terminal.id,
            ],
        )?;
        if affected == 0 {
            return Err(CoreError::NotFound {
                entity: "terminal",
                id: terminal.id.clone(),
            });
        }
        Ok(())
    }

    /// Update a terminal's last_seen_at timestamp.
    pub fn ping_terminal(&self, id: &str) -> Result<(), CoreError> {
        let affected = self.conn.execute(
            "UPDATE terminals SET last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                                   updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?1",
            params![id],
        )?;
        if affected == 0 {
            return Err(CoreError::NotFound {
                entity: "terminal",
                id: id.to_owned(),
            });
        }
        Ok(())
    }

    /// Delete a terminal by id.
    pub fn delete_terminal(&self, id: &str) -> Result<(), CoreError> {
        let affected = self
            .conn
            .execute("DELETE FROM terminals WHERE id = ?1", params![id])?;
        if affected == 0 {
            return Err(CoreError::NotFound {
                entity: "terminal",
                id: id.to_owned(),
            });
        }
        Ok(())
    }

    /// Update a terminal's device binding (store + instance).
    ///
    /// Also stores the HMAC signature for tamper detection.
    /// `store_id` must exist in `locations` (enforced by FK).
    /// `instance_id` is a logical reference validated at boot.
    pub fn update_terminal_binding(
        &self,
        terminal_id: &str,
        bound_store_id: &str,
        bound_instance_id: &str,
        binding_signature: &str,
    ) -> Result<(), CoreError> {
        let affected = self.conn.execute(
            "UPDATE terminals SET
                bound_location_id = ?1,
                bound_instance_id = ?2,
                binding_signature = ?3,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?4",
            params![
                bound_store_id,
                bound_instance_id,
                binding_signature,
                terminal_id
            ],
        )?;
        if affected == 0 {
            return Err(CoreError::NotFound {
                entity: "terminal",
                id: terminal_id.to_owned(),
            });
        }
        Ok(())
    }

    /// Read a terminal's device binding columns.
    ///
    /// Returns `(bound_store_id, bound_instance_id, binding_signature)`
    /// or `None` if the terminal has no binding.
    pub fn get_terminal_binding(
        &self,
        terminal_id: &str,
    ) -> Result<Option<(String, String, String)>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT bound_location_id, bound_instance_id, binding_signature
             FROM terminals WHERE id = ?1",
        )?;
        let result = stmt.query_row(params![terminal_id], |row| {
            let store: Option<String> = row.get(0)?;
            let instance: Option<String> = row.get(1)?;
            let sig: Option<String> = row.get(2)?;
            match (store, instance, sig) {
                (Some(s), Some(i), Some(g)) => Ok(Some((s, i, g))),
                _ => Ok(None),
            }
        });
        match result {
            Ok(r) => Ok(r),
            Err(rusqlite::Error::QueryReturnedNoRows) => Err(CoreError::NotFound {
                entity: "terminal",
                id: terminal_id.to_owned(),
            }),
            Err(e) => Err(e.into()),
        }
    }

    /// Clear a terminal's device binding (remove store+instance binding).
    pub fn clear_terminal_binding(&self, terminal_id: &str) -> Result<(), CoreError> {
        let affected = self.conn.execute(
            "UPDATE terminals SET
                bound_location_id = NULL,
                bound_instance_id = NULL,
                binding_signature = NULL,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?1",
            params![terminal_id],
        )?;
        if affected == 0 {
            return Err(CoreError::NotFound {
                entity: "terminal",
                id: terminal_id.to_owned(),
            });
        }
        Ok(())
    }

    fn row_to_terminal(row: &rusqlite::Row) -> rusqlite::Result<Terminal> {
        Ok(Terminal {
            id: row.get("id")?,
            name: row.get("name")?,
            device_id: row.get("device_id")?,
            terminal_secret: row.get("terminal_secret")?,
            is_active: row.get::<_, i64>("is_active")? != 0,
            last_seen_at: row.get("last_seen_at")?,
            metadata: row.get("metadata")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        })
    }
}

// ── Tests ─────────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "terminals_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "multi_terminal_tests.rs"]
mod multi_terminal_tests;
