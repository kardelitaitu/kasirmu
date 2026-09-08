//! Location-profile CRUD — list, get, create, update, set-primary.
/*
last audited 25-07-26 by RSA-Agent (oz-core slice B5 part 6)
crate: oz-core | status: SAFE | lint: CLEAN
findings: primary-invariant swap in tx with rollback on 0-rows; primary undeletable; store quota enforced; NOTE: the timezone column exists here — reports (COR-21) never consult it
next: none | perf: N/A
*/
//!
//! Every deployment has exactly one primary location, created on first
//! startup by the `platform-startup` crate. Additional locations can be
//! added / removed via these methods.

use rusqlite::params;

use super::Store;
use crate::downgrade::QuotaDimension;
use crate::subscription::{QuotaError, SubscriptionTier};
use crate::{CoreError, LocationProfile};

impl Store<'_> {
    /// List all location profiles ordered by `created_at`.
    pub fn list_locations(&self) -> Result<Vec<LocationProfile>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, address, tax_id, currency, timezone, is_primary, created_at, updated_at
             FROM locations ORDER BY is_primary DESC, created_at ASC",
        )?;
        let rows = stmt.query_map([], Self::row_to_location_profile)?;
        let mut profiles = Vec::new();
        for row in rows {
            profiles.push(row?);
        }
        Ok(profiles)
    }

    /// Get a single location profile by id.
    pub fn get_location_profile(&self, id: &str) -> Result<Option<LocationProfile>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, address, tax_id, currency, timezone, is_primary, created_at, updated_at
             FROM locations WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(params![id], Self::row_to_location_profile)?;
        match rows.next() {
            Some(Ok(profile)) => Ok(Some(profile)),
            Some(Err(e)) => Err(e.into()),
            None => Ok(None),
        }
    }

    /// Get the `legal_entity_id` of the entity a location belongs to
    /// (ADR #47 ruling 3's downward walk: a `legal_entity`-scoped
    /// assignment must cover every location whose row points at the
    /// assignment's entity).
    ///
    /// Returns `Ok(None)` when the location does not exist or carries no
    /// entity — callers treat both as deny (fail closed).
    pub fn location_legal_entity_id(&self, location_id: &str) -> Result<Option<String>, CoreError> {
        let mut stmt = self
            .conn
            .prepare("SELECT legal_entity_id FROM locations WHERE id = ?1")?;
        let mut rows =
            stmt.query_map(params![location_id], |row| row.get::<_, Option<String>>(0))?;
        match rows.next() {
            Some(Ok(entity)) => Ok(entity),
            Some(Err(e)) => Err(e.into()),
            None => Ok(None),
        }
    }

    /// Get the primary location profile.
    pub fn get_primary_location(&self) -> Result<Option<LocationProfile>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, address, tax_id, currency, timezone, is_primary, created_at, updated_at
             FROM locations WHERE is_primary = 1 LIMIT 1",
        )?;
        let mut rows = stmt.query_map([], Self::row_to_location_profile)?;
        match rows.next() {
            Some(Ok(profile)) => Ok(Some(profile)),
            Some(Err(e)) => Err(e.into()),
            None => Ok(None),
        }
    }

    /// Count active (non-deleted) location profiles.
    pub fn count_locations(&self) -> Result<i64, CoreError> {
        let count: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM locations", [], |row| row.get(0))?;
        Ok(count)
    }

    /// Enforce the subscription tier's location-count limit before creating
    /// a new location profile (C1.2 — §9 pre-launch: prevents revenue
    /// leakage from unlimited multi-location usage on lower tiers).
    ///
    /// When the tier's `max_locations()` cap is reached, returns
    /// [`QuotaError::StoreLimit`]. Unlimited tiers (`None`) pass.
    pub fn enforce_location_quota(&self, tier: &SubscriptionTier) -> Result<(), CoreError> {
        if let Some(limit) = QuotaDimension::Locations.limit_for(tier) {
            let current = self.count_locations()?;
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

    /// Create a new location profile.
    ///
    /// The new store will be **non-primary** by default. Use
    /// [`set_primary_location`](Self::set_primary_location) to promote it after
    /// creation.
    pub fn create_location_profile(
        &self,
        profile: &LocationProfile,
    ) -> Result<LocationProfile, CoreError> {
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
    pub fn update_location_profile(
        &self,
        id: &str,
        name: &str,
        address: &str,
        tax_id: &str,
        currency: &str,
        timezone: &str,
    ) -> Result<LocationProfile, CoreError> {
        let affected = self.conn.execute(
            "UPDATE locations SET name = ?1, address = ?2, tax_id = ?3,
             currency = ?4, timezone = ?5, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?6",
            params![name, address, tax_id, currency, timezone, id],
        )?;
        if affected == 0 {
            return Err(CoreError::NotFound {
                entity: "location_profile",
                id: id.to_owned(),
            });
        }
        self.get_location_profile(id)?
            .ok_or_else(|| CoreError::NotFound {
                entity: "location_profile",
                id: id.to_owned(),
            })
    }

    /// Promote a store to primary, demoting the current primary.
    ///
    /// Uses an explicit transaction so the `is_primary` invariant
    /// (exactly one row with `is_primary = 1`) is never violated.
    pub fn set_primary_location(&self, id: &str) -> Result<LocationProfile, CoreError> {
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
                entity: "location_profile",
                id: id.to_owned(),
            });
        }
        tx.commit()?;
        self.get_location_profile(id)?
            .ok_or_else(|| CoreError::NotFound {
                entity: "location_profile",
                id: id.to_owned(),
            })
    }

    /// Delete a location profile. The primary location cannot be deleted.
    pub fn delete_location_profile(&self, id: &str) -> Result<(), CoreError> {
        // Prevent deleting the primary location.
        if let Some(profile) = self.get_location_profile(id)? {
            if profile.is_primary {
                return Err(CoreError::Validation {
                    field: "id",
                    message: "cannot delete the primary location".into(),
                });
            }
        } else {
            return Err(CoreError::NotFound {
                entity: "location_profile",
                id: id.to_owned(),
            });
        }
        self.conn
            .execute("DELETE FROM locations WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Deprecated compatibility alias for list_locations.
    #[deprecated(note = "use list_locations")]
    pub fn list_store_profiles(&self) -> Result<Vec<LocationProfile>, CoreError> {
        self.list_locations()
    }

    /// Deprecated compatibility alias for get_location_profile.
    #[deprecated(note = "use get_location_profile")]
    pub fn get_store_profile(&self, id: &str) -> Result<Option<LocationProfile>, CoreError> {
        self.get_location_profile(id)
    }

    /// Deprecated compatibility alias for get_primary_location.
    #[deprecated(note = "use get_primary_location")]
    pub fn get_primary_store(&self) -> Result<Option<LocationProfile>, CoreError> {
        self.get_primary_location()
    }

    /// Deprecated compatibility alias for count_locations.
    #[deprecated(note = "use count_locations")]
    pub fn count_store_profiles(&self) -> Result<i64, CoreError> {
        self.count_locations()
    }

    /// Deprecated compatibility alias for enforce_location_quota.
    #[deprecated(note = "use enforce_location_quota")]
    pub fn enforce_store_quota(&self, tier: &SubscriptionTier) -> Result<(), CoreError> {
        self.enforce_location_quota(tier)
    }

    /// Deprecated compatibility alias for create_location_profile.
    #[deprecated(note = "use create_location_profile")]
    pub fn create_store_profile(
        &self,
        profile: &LocationProfile,
    ) -> Result<LocationProfile, CoreError> {
        self.create_location_profile(profile)
    }

    /// Deprecated compatibility alias for update_location_profile.
    #[deprecated(note = "use update_location_profile")]
    pub fn update_store_profile(
        &self,
        id: &str,
        name: &str,
        address: &str,
        tax_id: &str,
        currency: &str,
        timezone: &str,
    ) -> Result<LocationProfile, CoreError> {
        self.update_location_profile(id, name, address, tax_id, currency, timezone)
    }

    /// Deprecated compatibility alias for set_primary_location.
    #[deprecated(note = "use set_primary_location")]
    pub fn set_primary_store(&self, id: &str) -> Result<LocationProfile, CoreError> {
        self.set_primary_location(id)
    }

    /// Deprecated compatibility alias for delete_location_profile.
    #[deprecated(note = "use delete_location_profile")]
    pub fn delete_store_profile(&self, id: &str) -> Result<(), CoreError> {
        self.delete_location_profile(id)
    }

    // ── Row mapper ───────────────────────────────────────────────

    fn row_to_location_profile(row: &rusqlite::Row) -> rusqlite::Result<LocationProfile> {
        let is_primary_int: i32 = row.get("is_primary")?;
        Ok(LocationProfile {
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
#[path = "locations_tests.rs"]
mod tests;
