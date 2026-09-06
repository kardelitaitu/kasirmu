//! Store-profile CRUD — list, get, create, update, set-primary.
/*
last audited 25-07-26 by RSA-Agent (oz-core slice B5 part 6)
crate: oz-core | status: SAFE | lint: CLEAN
findings: primary-invariant swap in tx with rollback on 0-rows; primary undeletable; store quota enforced; NOTE: the timezone column exists here — reports (COR-21) never consult it
next: none | perf: N/A
*/
//!
//! Every deployment has exactly one primary store, created on first
//! startup by the `platform-startup` crate. Additional stores can be
//! added / removed via these methods.

use rusqlite::params;

use super::Store;
use crate::subscription::{QuotaError, SubscriptionTier};
use crate::{CoreError, StoreProfile};

impl Store<'_> {
    /// List all store profiles ordered by `created_at`.
    pub fn list_store_profiles(&self) -> Result<Vec<StoreProfile>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, address, tax_id, currency, timezone, is_primary, created_at, updated_at
             FROM locations ORDER BY is_primary DESC, created_at ASC",
        )?;
        let rows = stmt.query_map([], Self::row_to_store_profile)?;
        let mut profiles = Vec::new();
        for row in rows {
            profiles.push(row?);
        }
        Ok(profiles)
    }

    /// Get a single store profile by id.
    pub fn get_store_profile(&self, id: &str) -> Result<Option<StoreProfile>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, address, tax_id, currency, timezone, is_primary, created_at, updated_at
             FROM locations WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(params![id], Self::row_to_store_profile)?;
        match rows.next() {
            Some(Ok(profile)) => Ok(Some(profile)),
            Some(Err(e)) => Err(e.into()),
            None => Ok(None),
        }
    }

    /// Get the primary store profile.
    pub fn get_primary_store(&self) -> Result<Option<StoreProfile>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, address, tax_id, currency, timezone, is_primary, created_at, updated_at
             FROM locations WHERE is_primary = 1 LIMIT 1",
        )?;
        let mut rows = stmt.query_map([], Self::row_to_store_profile)?;
        match rows.next() {
            Some(Ok(profile)) => Ok(Some(profile)),
            Some(Err(e)) => Err(e.into()),
            None => Ok(None),
        }
    }

    /// Count active (non-deleted) store profiles.
    pub fn count_store_profiles(&self) -> Result<i64, CoreError> {
        let count: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM locations", [], |row| row.get(0))?;
        Ok(count)
    }

    /// Enforce the subscription tier's store-count limit before creating
    /// a new store profile (C1.2 — §9 pre-launch: prevents revenue
    /// leakage from unlimited multi-store usage on lower tiers).
    ///
    /// When the tier's `max_stores()` cap is reached, returns
    /// [`QuotaError::StoreLimit`]. Unlimited tiers (`None`) pass.
    pub fn enforce_store_quota(&self, tier: &SubscriptionTier) -> Result<(), CoreError> {
        if let Some(limit) = tier.max_stores() {
            let current = self.count_store_profiles()?;
            if current >= limit {
                return Err(QuotaError::StoreLimit {
                    tier: tier.name().into(),
                    limit,
                    current,
                }
                .into());
            }
        }
        Ok(())
    }

    /// Create a new store profile.
    ///
    /// The new store will be **non-primary** by default. Use
    /// [`set_primary_store`](Self::set_primary_store) to promote it after
    /// creation.
    pub fn create_store_profile(&self, profile: &StoreProfile) -> Result<StoreProfile, CoreError> {
        self.conn.execute(
            "INSERT INTO locations (id, name, address, tax_id, currency, timezone, is_primary, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                profile.id,
                profile.name,
                profile.address,
                profile.tax_id,
                profile.currency,
                profile.timezone,
                profile.is_primary as i32,
                profile.created_at,
                profile.updated_at,
            ],
        )?;
        Ok(profile.clone())
    }

    /// Update a store profile's mutable fields (name, address, tax_id, currency, timezone).
    ///
    /// Returns `NotFound` if the id does not exist.
    pub fn update_store_profile(
        &self,
        id: &str,
        name: &str,
        address: &str,
        tax_id: &str,
        currency: &str,
        timezone: &str,
    ) -> Result<StoreProfile, CoreError> {
        let affected = self.conn.execute(
            "UPDATE locations SET name = ?1, address = ?2, tax_id = ?3,
             currency = ?4, timezone = ?5, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?6",
            params![name, address, tax_id, currency, timezone, id],
        )?;
        if affected == 0 {
            return Err(CoreError::NotFound {
                entity: "store_profile",
                id: id.to_owned(),
            });
        }
        self.get_store_profile(id)?
            .ok_or_else(|| CoreError::NotFound {
                entity: "store_profile",
                id: id.to_owned(),
            })
    }

    /// Promote a store to primary, demoting the current primary.
    ///
    /// Uses an explicit transaction so the `is_primary` invariant
    /// (exactly one row with `is_primary = 1`) is never violated.
    pub fn set_primary_store(&self, id: &str) -> Result<StoreProfile, CoreError> {
        let tx = self.conn.unchecked_transaction()?;
        // Demote the current primary.
        tx.execute(
            "UPDATE locations SET is_primary = 0 WHERE is_primary = 1",
            [],
        )?;
        // Promote the target.
        let affected = tx.execute(
            "UPDATE locations SET is_primary = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?1",
            params![id],
        )?;
        if affected == 0 {
            tx.rollback()?;
            return Err(CoreError::NotFound {
                entity: "store_profile",
                id: id.to_owned(),
            });
        }
        tx.commit()?;
        self.get_store_profile(id)?
            .ok_or_else(|| CoreError::NotFound {
                entity: "store_profile",
                id: id.to_owned(),
            })
    }

    /// Delete a store profile. The primary store cannot be deleted.
    pub fn delete_store_profile(&self, id: &str) -> Result<(), CoreError> {
        // Prevent deleting the primary store.
        if let Some(profile) = self.get_store_profile(id)? {
            if profile.is_primary {
                return Err(CoreError::Validation {
                    field: "id",
                    message: "cannot delete the primary store".into(),
                });
            }
        } else {
            return Err(CoreError::NotFound {
                entity: "store_profile",
                id: id.to_owned(),
            });
        }
        self.conn
            .execute("DELETE FROM locations WHERE id = ?1", params![id])?;
        Ok(())
    }

    // ── Row mapper ───────────────────────────────────────────────

    fn row_to_store_profile(row: &rusqlite::Row) -> rusqlite::Result<StoreProfile> {
        let is_primary_int: i32 = row.get("is_primary")?;
        Ok(StoreProfile {
            id: row.get("id")?,
            name: row.get("name")?,
            address: row.get("address")?,
            tax_id: row.get("tax_id")?,
            currency: row.get("currency")?,
            timezone: row.get("timezone")?,
            is_primary: is_primary_int != 0,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        })
    }
}

#[cfg(test)]
#[path = "store_profiles_tests.rs"]
mod tests;
