//! Terminal Management — register, list, update, ping, delete terminals.
/*
last audited 25-07-26 by RSA-Agent (kasirmu-core slice B5 part 6)
crate: kasirmu-core | status: SAFE | lint: CLEAN
findings: clean CRUD + HMAC binding signature for tamper detection; terminal_secret stored plaintext (acceptable local-POS threat model, same note as COR-17 — revisit for cloud sync)
next: none | perf: N/A
*/

use rusqlite::{OptionalExtension, params};

use crate::Terminal;
use crate::downgrade::QuotaDimension;
use crate::error::CoreError;
use crate::subscription::SubscriptionTier;

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

    /// Resolve the `terminals.id` ROW id behind an identity string a session
    /// may carry.
    ///
    /// Two different values are both called "terminal id" in this codebase,
    /// and dependent tables key on one while sessions carry the other:
    /// `terminals.id` is the row's UUID ([`Terminal::new`]) and is what
    /// dependent foreign keys store, whereas a session's `terminal_id` is the
    /// DEVICE identity the renderer derived from the `get_device_id` command
    /// (the machine's hostname) — `create_session` persists that verbatim.
    /// The two coincide only by accident, so a dependent read that queries the
    /// raw session value matches no row at all, and does so silently.
    ///
    /// Either form resolves. `None` means the device has no terminal row in
    /// `tenant_id`, and therefore no dependent rows either — there is
    /// deliberately no "hand the input back unchanged" fallback, because a
    /// value that cannot resolve is a value that cannot match a foreign key.
    /// The id form is matched first (`ORDER BY (id = ?2) DESC`): an id always
    /// beats another row's `device_id`, and ids are what dependents store.
    ///
    /// Tenant-scoped to agree with the writers that fan out against this table:
    /// resolving a terminal another tenant owns would hand the caller an id
    /// whose dependent rows cannot exist.
    pub fn resolve_terminal_row_id(
        &self,
        tenant_id: &str,
        identity: &str,
    ) -> Result<Option<String>, CoreError> {
        if identity.trim().is_empty() {
            return Ok(None);
        }
        let mut stmt = self.conn.prepare(
            "SELECT id FROM terminals
             WHERE tenant_id = ?1 AND (id = ?2 OR device_id = ?2)
             ORDER BY (id = ?2) DESC
             LIMIT 1",
        )?;
        let result = stmt.query_row(params![tenant_id, identity], |r| r.get::<_, String>(0));
        match result {
            Ok(id) => Ok(Some(id)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// The location a terminal is bound to, if any.
    ///
    /// `list_terminals`/`get_terminal` deliberately project the terminal's
    /// display fields only, so the binding has to be read by name when a caller
    /// needs it (the memo fan-out targets Location Memos through it).
    pub fn get_terminal_bound_location(&self, id: &str) -> Result<Option<String>, CoreError> {
        let found: Option<Option<String>> = self
            .conn
            .query_row(
                "SELECT bound_location_id FROM terminals WHERE id = ?1",
                params![id],
                |r| r.get(0),
            )
            .optional()?;
        Ok(found.flatten())
    }

    /// Make a terminal that was registered in ANOTHER database addressable to
    /// the tables here that key on `terminals.id` — the memo fan-out and the
    /// memo display read.
    ///
    /// Terminal registration has two homes: `register_terminal_scoped` writes
    /// the row into the per-store database (`store-<id>.sqlite`), while the
    /// MultiTerminal auto-register path writes it into this (global) one. The
    /// memo tables live here and `memo_recipients.terminal_id` carries an
    /// enforced FK to `terminals(id)`, so a memo can only be delivered to a
    /// terminal this table holds a row for — and the recipient's read resolves
    /// through this table too, which is why the mirror is what makes both ends
    /// agree instead of merely one.
    ///
    /// Idempotent, and addressability is per DEVICE: a row already present for
    /// the id, or for the device identity, makes this a no-op — if the device is
    /// already known here under another id, that row is the one delivery must
    /// use, because the session carries the device identity, not the id.
    ///
    /// Deliberately NOT a general terminal re-home: it writes only what delivery
    /// and the read have to agree on (id, device identity, name, activity,
    /// metadata, own tenant, and the location binding Location Memos target). No
    /// `terminal_secret` rides along — a credential belongs to the database that
    /// minted it. Returns whether it inserted.
    ///
    /// On an existing row it refreshes the location binding and nothing else.
    /// That refresh is what makes a Location Memo deliverable at all: the row
    /// delivery resolves may already have been mirrored (the sync bootstrap
    /// mirrors the device before any location is known), and a Location Memo
    /// fans out through `bound_location_id` — so a row that was mirrored without
    /// one could never be bound later and every publish to it refused with no
    /// recipients. `COALESCE` keeps a caller that does not know a location yet
    /// (passing `None`) from wiping a binding that is already there.
    pub fn ensure_terminal_addressable(
        &self,
        source: &Terminal,
        tenant_id: &str,
        bound_location_id: Option<&str>,
    ) -> Result<bool, CoreError> {
        let tx = self.conn.unchecked_transaction()?;
        let existing: Option<String> = tx
            .query_row(
                "SELECT id FROM terminals WHERE id = ?1 OR device_id = ?2 LIMIT 1",
                params![source.id, source.device_id],
                |r| r.get(0),
            )
            .optional()?;
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        if let Some(row_id) = existing {
            tx.execute(
                "UPDATE terminals SET
                    bound_location_id = COALESCE(?1, bound_location_id),
                    updated_at = ?2
                 WHERE id = ?3",
                params![bound_location_id, now, row_id],
            )?;
            tx.commit()?;
            return Ok(false);
        }
        tx.execute(
            "INSERT INTO terminals (id, name, device_id, terminal_secret, is_active,
                                    last_seen_at, metadata, created_at, updated_at,
                                    tenant_id, bound_location_id)
             VALUES (?1, ?2, ?3, NULL, ?4, NULL, ?5, ?6, ?6, ?7, ?8)",
            params![
                source.id,
                source.name,
                source.device_id,
                source.is_active as i64,
                source.metadata,
                now,
                tenant_id,
                bound_location_id,
            ],
        )?;
        tx.commit()?;
        Ok(true)
    }

    /// Enforce the subscription tier's terminal/register limit before registering
    /// a new terminal.
    ///
    /// When the tier's `max_pos_instances()` cap is reached, returns
    /// [`QuotaError::RegisterLimit`]. Unlimited tiers (`None`) pass.
    pub fn enforce_terminal_quota(&self, tier: &SubscriptionTier) -> Result<(), CoreError> {
        // W4-S1: decision centralized in `quota_gate`; same limit source
        // (`max_pos_instances`), same count, same `RegisterLimit` error.
        self.enforce_creation_quota(QuotaDimension::PosRegisters, tier)
    }

    /// Count all registered terminals in the store.
    pub fn count_terminals(&self) -> Result<i64, CoreError> {
        let count: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM terminals", [], |r| r.get(0))?;
        Ok(count)
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
        // W7-B: the write moved into a transaction so the armed quota verdict
        // (armed by enforce_terminal_quota through the central gate) can be
        // re-checked against the row it just inserted, atomically. Post-insert
        // veto rather than a pre-insert count, because under WAL a pre-insert
        // count reads only this connection snapshot: current > limit here is the
        // same predicate the pre-tx gate applied (current >= limit before its own
        // insert), which is what closes the race where two concurrent
        // registrations both pass at limit-1. An un-armed Store (a programmatic
        // create, the pre-auth provisioning path) keeps the legacy un-gated
        // behaviour — no arm, no veto.
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
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
        let tier = self.take_armed_quota(QuotaDimension::PosRegisters);
        if let Some(limit) = tier
            .as_ref()
            .and_then(|t| QuotaDimension::PosRegisters.limit_for(t))
        {
            let current: i64 = tx.query_row("SELECT COUNT(*) FROM terminals", [], |r| r.get(0))?;
            if current > limit {
                tx.rollback()?;
                return Err(crate::subscription::QuotaError::RegisterLimit {
                    tier: tier.as_ref().map(|t| t.name().into()).unwrap_or_default(),
                    limit,
                    current: current - 1,
                }
                .into());
            }
        }
        tx.commit()?;
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
