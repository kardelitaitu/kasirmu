//! First-run provisioning — the per-terminal record whose presence IS the
//! "this device is set up" fact (ADR #56 §2.1).
//!
//! Replaces three independently-read booleans (`setup.completed`, the wizard's
//! `show_setup_wizard` dismissal key, and the owner-existing check). A failed
//! read of a boolean can FORGE a verdict — which is why the shells carried a
//! boot-retry workaround for a lost IPC response. A row cannot be forged the
//! same way: an unreadable DB yields no row, and no row means unprovisioned, so
//! a retry becomes an ordinary idempotent re-read.
//!
//! Key invariants:
//! - One row per **terminal**, so the gate is an indexed local lookup and never
//!   a network call (§2.1, §5 Q4).
//! - `home_region` is RESIDENCY, never the market anchor; the market is
//!   `legal_entities.country_code` (§2.1, mirroring ADR #59 §2.2).
//! - The row is written LAST inside one transaction (§2.2), so its presence
//!   proves the licence, location and owner were all written.

use rusqlite::{OptionalExtension, params};

use crate::error::CoreError;

use super::Store;

/// Which onboarding tier produced this terminal (ADR #56 §2.4).
///
/// `local` is the DEFAULT, not a fallback: the target deployment includes
/// merchants with unreliable connectivity, and a first run that demands the
/// network fails the merchant who most needs the product. `linked` adds the
/// identity step and is the only route to server-side enforcement.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProvisioningMode {
    /// No network: a working OS and a sellable terminal.
    Local,
    /// Identity-linked: adds `tenant_id`, sync and topology.
    Linked,
}

impl ProvisioningMode {
    /// The stored keyword, matching the column CHECK constraint.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Local => "local",
            Self::Linked => "linked",
        }
    }

    /// Parse a stored keyword; anything else is a validation error rather than
    /// a silently-unknown mode.
    pub fn parse(raw: &str) -> Result<Self, CoreError> {
        match raw {
            "local" => Ok(Self::Local),
            "linked" => Ok(Self::Linked),
            other => Err(CoreError::Validation {
                field: "mode",
                message: format!("provisioning mode must be local or linked; got {other:?}"),
            }),
        }
    }
}

/// One terminal's provisioning record (ADR #56 §2.1).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProvisioningRecord {
    /// Matches `terminals.device_id`, not the `terminals.id` surrogate: a
    /// replaced tablet keeps its id but changes its device.
    pub terminal_id: String,
    /// The licence server's tenant id. `None` for a `local` install — and
    /// deliberately NOT the local literal `'default'`, a different namespace.
    pub tenant_id: Option<String>,
    /// The `locations` row this terminal belongs to.
    pub location_id: Option<String>,
    /// The bootstrapped owner.
    pub owner_user_id: Option<String>,
    /// The credential this device authenticates to sync with.
    pub device_id: Option<String>,
    /// Which tier of §2.4 was used.
    pub mode: ProvisioningMode,
    /// RESIDENCY mirror — which deployment holds this tenant's data. Never a
    /// market anchor and never a country code; see the module docs.
    pub home_region: String,
    /// Audit timestamp.
    pub provisioned_at: String,
}

/// The derived first-run state (ADR #56 §2.1).
///
/// One value replaces the three booleans. Note what is NOT representable:
/// "setup completed but nothing provisioned" was reachable via the wizard's
/// Skip button and is now unrepresentable rather than merely guarded, because
/// the row cannot exist unless the whole transaction committed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FirstRunState {
    /// No `provisioning` row for this terminal — render the provisioning flow.
    Unprovisioned,
    /// A row exists; the session decides which screen renders.
    Provisioned(ProvisioningRecord),
}
impl Store<'_> {
    /// Read one terminal's provisioning record, or `None` when it has none.
    pub fn get_provisioning(
        &self,
        terminal_id: &str,
    ) -> Result<Option<ProvisioningRecord>, CoreError> {
        // One line on purpose: a Rust line-continuation inside a Rust string
        // literal is emitted verbatim, so a wrapped query reaches SQLite with
        // the backslashes in it and fails to parse.
        let mut stmt = self.conn.prepare(
            "SELECT terminal_id, tenant_id, location_id, owner_user_id, device_id, mode, home_region, provisioned_at FROM provisioning WHERE terminal_id = ?1",
        )?;
        // `.optional()` already turns the no-rows error into `None`, so the
        // mapper's own `Result` is what remains — no transpose needed.
        let row = stmt
            .query_row(params![terminal_id], Self::row_to_provisioning)
            .optional()?;
        Ok(row)
    }

    /// The single derived first-run state for a terminal (ADR #56 §2.1).
    ///
    /// This is the gate: `Unprovisioned` for any terminal without a row, so an
    /// unreadable or empty database can never report a provisioned device.
    pub fn first_run_state(&self, terminal_id: &str) -> Result<FirstRunState, CoreError> {
        Ok(match self.get_provisioning(terminal_id)? {
            Some(rec) => FirstRunState::Provisioned(rec),
            None => FirstRunState::Unprovisioned,
        })
    }

    /// Whether this terminal has been provisioned.
    ///
    /// Its own method because it is the question the boot ladder asks, and
    /// because a boolean derived FROM a row read is safe where a stored boolean
    /// was not: the only way to get `true` is a row that exists.
    pub fn is_provisioned(&self, terminal_id: &str) -> Result<bool, CoreError> {
        Ok(self.get_provisioning(terminal_id)?.is_some())
    }

    /// Insert a provisioning record, or return the existing one unchanged.
    ///
    /// The idempotency guard of ADR #56 §2.2 step 1, and the reason a retry
    /// after a crash, a lost Android IPC response, or a re-polled pairing claim
    /// is safe: the same device can never mint two terminals. Returns
    /// `(record, created)` so a caller can distinguish a fresh provision from a
    /// replay without a second read.
    pub fn provision_terminal(
        &self,
        rec: &ProvisioningRecord,
    ) -> Result<(ProvisioningRecord, bool), CoreError> {
        if let Some(existing) = self.get_provisioning(&rec.terminal_id)? {
            return Ok((existing, false));
        }
        self.conn.execute(
            "INSERT INTO provisioning (terminal_id, tenant_id, location_id, owner_user_id, device_id, mode, home_region) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                rec.terminal_id,
                rec.tenant_id,
                rec.location_id,
                rec.owner_user_id,
                rec.device_id,
                rec.mode.as_str(),
                rec.home_region,
            ],
        )?;
        // Re-read rather than trusting the in-memory copy: `provisioned_at` is a
        // column default, so the stored value is the authority.
        let stored = self.get_provisioning(&rec.terminal_id)?.ok_or_else(|| {
            CoreError::Internal("provisioning row vanished after insert".into())
        })?;
        Ok((stored, true))
    }
    /// Promote a `local` provisioning record to `linked` (ADR #56 §2.4).
    ///
    /// This is the in-app upgrade that makes ADR #54's optional Account step
    /// unnecessary: the same action moves from "step 8 of setup" to "an action
    /// on a working terminal", and stops being skippable because it is no longer
    /// part of a linear gate.
    ///
    /// Refuses to overwrite an already-linked tenant with a different one — that
    /// would reassign a device between merchants.
    pub fn link_provisioning(
        &self,
        terminal_id: &str,
        tenant_id: &str,
        device_id: &str,
    ) -> Result<ProvisioningRecord, CoreError> {
        let existing = self.get_provisioning(terminal_id)?.ok_or_else(|| {
            CoreError::Validation {
                field: "terminal_id",
                message: format!("cannot link an unprovisioned terminal: {terminal_id:?}"),
            }
        })?;
        if let Some(current) = &existing.tenant_id {
            if current != tenant_id {
                return Err(CoreError::Validation {
                    field: "tenant_id",
                    message: format!(
                        "terminal {terminal_id:?} already belongs to tenant {current:?}; refusing to reassign it to {tenant_id:?}"
                    ),
                });
            }
        }
        self.conn.execute(
            "UPDATE provisioning SET tenant_id = ?1, device_id = ?2, mode = 'linked' WHERE terminal_id = ?3",
            params![tenant_id, device_id, terminal_id],
        )?;
        self.get_provisioning(terminal_id)?.ok_or_else(|| {
            CoreError::Internal("provisioning row vanished after link".into())
        })
    }

    /// Replace the cached residency mirror (ADR #56 §2.1).
    ///
    /// The licence server's `tenants.region` is authoritative (ADR #59 §Q5) and
    /// this column is a local copy written only from a server response — the same
    /// relationship the subscription row has. There is deliberately no local
    /// writer that invents a region.
    pub fn set_provisioning_home_region(
        &self,
        terminal_id: &str,
        home_region: &str,
    ) -> Result<(), CoreError> {
        let changed = self.conn.execute(
            "UPDATE provisioning SET home_region = ?1 WHERE terminal_id = ?2",
            params![home_region, terminal_id],
        )?;
        if changed == 0 {
            return Err(CoreError::Validation {
                field: "terminal_id",
                message: format!("no provisioning row for terminal {terminal_id:?}"),
            });
        }
        Ok(())
    }

    /// Row mapper for a provisioning record.
    fn row_to_provisioning(row: &rusqlite::Row<'_>) -> rusqlite::Result<ProvisioningRecord> {
        let mode: String = row.get(5)?;
        Ok(ProvisioningRecord {
            terminal_id: row.get(0)?,
            tenant_id: row.get(1)?,
            location_id: row.get(2)?,
            owner_user_id: row.get(3)?,
            device_id: row.get(4)?,
            // A mode outside the CHECK constraint cannot be stored, so this maps
            // rather than failing: an unreadable mode must not turn a
            // provisioned terminal into an error at boot.
            mode: ProvisioningMode::parse(&mode).unwrap_or(ProvisioningMode::Local),
            home_region: row.get(6)?,
            provisioned_at: row.get(7)?,
        })
    }
}

#[cfg(test)]
#[path = "provisioning_tests.rs"]
mod tests;