/*
last audited 31-08-26 by DSH-Agent (four PLANNED stubs replaced with real CRUD)
crate: oz-core | status: SAFE | lint: CLEAN
findings: the stubs were the reason card terminals could never be configured — the HAL registry category (459f852c) and the fail-closed commands (ad908e96) had no source of truth to read. Signatures were free functions taking a &Store and nothing else, which cannot express a create; they are now Store methods. Adds a cross-field rule the CHECK constraints do not: connection_type must agree with transport, so 'wired' + 'tcp' is rejected rather than stored and then silently unregistrable. Writes go through unchecked_transaction per the crate idiom; every statement is parameterized. tenant_id is left to the column DEFAULT — no caller threads a tenant yet, and writing 'default' explicitly would read as multi-tenancy that does not exist.
next: commands should take a terminal_id once more than one terminal is configured | perf: idx_edc_terminals_tenant covers the active list
*/
//! EDC terminal registry — CRUD for configured card-payment terminals.
//!
//! Backs the `edc_terminals` table from migration `20260824_media_edc.sql`.
//! This is the configuration source the HAL reads at startup: rows become
//! `oz_hal::TerminalConfig` entries through `platform_startup::hardware`,
//! which is what lets a card tender reach real hardware instead of failing
//! closed with `NotFound`.
//!
//! A terminal is only ever *described* here. Nothing in this module opens a
//! port or probes a device; registration builds a driver that records
//! addressing, and the first real I/O happens on the operation that needs it.

use rusqlite::{OptionalExtension, params};

use crate::error::CoreError;

use super::Store;

/// A configured card-payment terminal, mirroring one `edc_terminals` row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EdcTerminalConfig {
    /// UUID v7.
    pub id: String,
    /// Human-readable name.
    pub name: String,
    /// Connection type: "wired" or "wireless".
    pub connection_type: String,
    /// Transport: "serial", "usb", "bluetooth", "tcp".
    pub transport: String,
    /// Device path / MAC address / host:port.
    pub address: String,
    /// Vendor (e.g. "ingenico", "verifone", "pax").
    pub vendor: Option<String>,
    /// Model identifier.
    pub model: Option<String>,
    /// Whether the terminal is active.
    pub is_active: bool,
    /// ISO-8601 creation timestamp.
    pub created_at: String,
    /// ISO-8601 update timestamp.
    pub updated_at: String,
}

/// What a caller supplies to create or replace a terminal row.
///
/// Deliberately not [`EdcTerminalConfig`]: id and timestamps are minted by
/// the database, so accepting them from a caller would let a client pin an
/// id or forge a creation time.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewEdcTerminal {
    /// Human-readable name, e.g. "Front counter EDC".
    pub name: String,
    /// `"wired"` or `"wireless"`.
    pub connection_type: String,
    /// `"serial"`, `"usb"`, `"bluetooth"` or `"tcp"`.
    pub transport: String,
    /// Device path, MAC, or `host:port`.
    pub address: String,
    /// Vendor, stored lowercased. Optional.
    pub vendor: Option<String>,
    /// Model identifier. Optional.
    pub model: Option<String>,
    /// Defaults to active when `None`.
    pub is_active: Option<bool>,
}

/// The transports each connection type may use.
///
/// The schema CHECKs each column separately, so `wired` + `tcp` would pass
/// the database and then produce a terminal the HAL cannot build a driver
/// for. Pairing them here is what makes a stored row registrable.
fn transport_is_valid(connection_type: &str, transport: &str) -> bool {
    match connection_type {
        "wired" => matches!(transport, "serial" | "usb"),
        "wireless" => matches!(transport, "bluetooth" | "tcp"),
        _ => false,
    }
}

impl NewEdcTerminal {
    /// Validate the row and normalise the free-text fields.
    ///
    /// Returns the trimmed, lowercased values so the caller stores exactly
    /// what was checked.
    fn normalize(&self) -> Result<(String, String, String, String, Option<String>), CoreError> {
        let name = self.name.trim();
        if name.is_empty() {
            return Err(CoreError::Validation {
                field: "name",
                message: "must not be empty — a terminal needs a label an operator can pick".into(),
            });
        }
        if name.chars().count() > 120 {
            return Err(CoreError::Validation {
                field: "name",
                message: "must be 120 characters or fewer".into(),
            });
        }

        let connection_type = self.connection_type.trim().to_ascii_lowercase();
        if !matches!(connection_type.as_str(), "wired" | "wireless") {
            return Err(CoreError::Validation {
                field: "connection_type",
                message: format!(
                    "must be 'wired' or 'wireless', got '{}'",
                    self.connection_type.trim()
                ),
            });
        }

        let transport = self.transport.trim().to_ascii_lowercase();
        if !transport_is_valid(&connection_type, &transport) {
            return Err(CoreError::Validation {
                field: "transport",
                message: format!(
                    "'{transport}' is not valid for a {connection_type} terminal \
                     (wired: serial|usb, wireless: bluetooth|tcp)"
                ),
            });
        }

        let address = self.address.trim();
        if address.is_empty() {
            return Err(CoreError::Validation {
                field: "address",
                message: "must not be empty — a transport with nothing to bind".into(),
            });
        }
        if address.chars().count() > 255 {
            return Err(CoreError::Validation {
                field: "address",
                message: "must be 255 characters or fewer".into(),
            });
        }

        let vendor = self
            .vendor
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .map(str::to_ascii_lowercase);

        Ok((
            name.to_owned(),
            connection_type,
            transport,
            address.to_owned(),
            vendor,
        ))
    }
}

/// The [`CoreError`] for "no such terminal", with the entity name the
/// front-end keys its message on.
fn not_found(id: &str) -> CoreError {
    CoreError::NotFound {
        entity: "edc_terminal",
        id: id.to_owned(),
    }
}

impl Store<'_> {
    /// Register a new card-payment terminal.
    ///
    /// Mints a UUID v7 id and lets the database stamp both timestamps, then
    /// returns the stored row so the caller can display what it saved.
    ///
    /// Rejects a name that is blank, a connection type or transport outside
    /// the schema's CHECK sets, a transport that does not match its
    /// connection type, and an empty address.
    pub fn create_edc_terminal(
        &self,
        input: &NewEdcTerminal,
    ) -> Result<EdcTerminalConfig, CoreError> {
        let (name, connection_type, transport, address, vendor) = input.normalize()?;
        let model = input
            .model
            .as_deref()
            .map(str::trim)
            .filter(|m| !m.is_empty())
            .map(str::to_owned);
        let is_active = input.is_active.unwrap_or(true);
        let id = uuid::Uuid::now_v7().to_string();

        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "INSERT INTO edc_terminals
                 (id, name, connection_type, transport, address, vendor, model, is_active)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                id,
                name,
                connection_type,
                transport,
                address,
                vendor,
                model,
                is_active as i64
            ],
        )?;
        let stored = read_terminal(&tx, &id)?.ok_or_else(|| {
            CoreError::Internal(format!("edc terminal {id} vanished after insert"))
        })?;
        tx.commit()?;
        Ok(stored)
    }

    /// Every configured terminal, oldest first.
    pub fn list_edc_terminals(&self) -> Result<Vec<EdcTerminalConfig>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, connection_type, transport, address, vendor, model,
                    is_active, created_at, updated_at
             FROM edc_terminals
             ORDER BY created_at, id",
        )?;
        let rows = stmt.query_map([], row_to_terminal)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    /// Only the terminals an operator has left switched on, oldest first.
    ///
    /// This is what the startup bootstrap reads: an inactive row stays in
    /// the database but never becomes a driver.
    pub fn list_active_edc_terminals(&self) -> Result<Vec<EdcTerminalConfig>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, connection_type, transport, address, vendor, model,
                    is_active, created_at, updated_at
             FROM edc_terminals
             WHERE is_active = 1
             ORDER BY created_at, id",
        )?;
        let rows = stmt.query_map([], row_to_terminal)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    /// Fetch one terminal by id.
    ///
    /// Returns [`CoreError::NotFound`] rather than `Ok(None)` so a caller
    /// editing a row that vanished gets an error it must surface.
    pub fn get_edc_terminal(&self, id: &str) -> Result<EdcTerminalConfig, CoreError> {
        read_terminal(self.conn, id)?.ok_or_else(|| not_found(id))
    }

    /// Replace a terminal row in place, keeping its id and `created_at`.
    ///
    /// Full replacement, matching how a settings screen saves a form: pass
    /// the complete desired row rather than a sparse patch. `updated_at` is
    /// stamped by the database.
    pub fn update_edc_terminal(
        &self,
        id: &str,
        input: &NewEdcTerminal,
    ) -> Result<EdcTerminalConfig, CoreError> {
        let (name, connection_type, transport, address, vendor) = input.normalize()?;
        let model = input
            .model
            .as_deref()
            .map(str::trim)
            .filter(|m| !m.is_empty())
            .map(str::to_owned);
        let is_active = input.is_active.unwrap_or(true);

        let tx = self.conn.unchecked_transaction()?;
        let changed = tx.execute(
            "UPDATE edc_terminals
             SET name = ?2, connection_type = ?3, transport = ?4, address = ?5,
                 vendor = ?6, model = ?7, is_active = ?8,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?1",
            params![
                id,
                name,
                connection_type,
                transport,
                address,
                vendor,
                model,
                is_active as i64
            ],
        )?;
        if changed == 0 {
            // Roll the transaction back rather than commit a no-op: the row
            // may exist with a different id, and a silent success here would
            // tell an operator their edit saved when it did not.
            drop(tx);
            return Err(not_found(id));
        }
        let stored = read_terminal(&tx, id)?.ok_or_else(|| {
            CoreError::Internal(format!("edc terminal {id} vanished after update"))
        })?;
        tx.commit()?;
        Ok(stored)
    }

    /// Delete a terminal row.
    ///
    /// Idempotent at the SQL level but reported as [`CoreError::NotFound`]
    /// when nothing matched, so a UI deleting a row already removed by
    /// another register learns about it instead of showing a success.
    pub fn delete_edc_terminal(&self, id: &str) -> Result<(), CoreError> {
        let tx = self.conn.unchecked_transaction()?;
        let changed = tx.execute("DELETE FROM edc_terminals WHERE id = ?1", params![id])?;
        if changed == 0 {
            drop(tx);
            return Err(not_found(id));
        }
        tx.commit()?;
        Ok(())
    }
}

/// Read one row through any rusqlite handle.
///
/// Takes a generic connection so the same mapping serves both a plain
/// `&Connection` read and a read inside an in-flight transaction.
fn read_terminal(
    conn: &rusqlite::Connection,
    id: &str,
) -> Result<Option<EdcTerminalConfig>, CoreError> {
    let row = conn
        .query_row(
            "SELECT id, name, connection_type, transport, address, vendor, model,
                    is_active, created_at, updated_at
             FROM edc_terminals WHERE id = ?1",
            params![id],
            row_to_terminal,
        )
        .optional()?;
    Ok(row)
}

/// Map a result row onto [`EdcTerminalConfig`].
fn row_to_terminal(row: &rusqlite::Row<'_>) -> Result<EdcTerminalConfig, rusqlite::Error> {
    Ok(EdcTerminalConfig {
        id: row.get("id")?,
        name: row.get("name")?,
        connection_type: row.get("connection_type")?,
        transport: row.get("transport")?,
        address: row.get("address")?,
        vendor: row.get("vendor")?,
        model: row.get("model")?,
        is_active: row.get::<_, i64>("is_active")? != 0,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

#[cfg(test)]
#[path = "edc_terminals_tests.rs"]
mod tests;
