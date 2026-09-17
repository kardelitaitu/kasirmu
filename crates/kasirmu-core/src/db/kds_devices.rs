//! KDS device management - registration, pairing, and status.
//!
//! Key functions: register_kds_device (hashes pairing tokens),
//! validate_pairing_token, get_kds_device,
//! list_kds_devices_for_restaurant, update_kds_device_status,
//! deactivate_kds_device, plus the KdsDeviceRow query_map row type
//! and its mappers.
//!
//! Invariants: pairing tokens are stored hashed (never plaintext);
//! deactivation is soft (is_active flag) and logged.

use crate::db::Store;
use crate::error::CoreError;
use rusqlite::params;

// ── KDS Device Management ───────────────────────────────────────

use crate::kds::{KdsConnectionStatus, KdsDevice, RegisterKdsDeviceInput};

impl Store<'_> {
    /// Register a new KDS device.
    ///
    /// Returns a `Validation` error if a device with the same name already
    /// exists under the same Restaurant POS.
    pub fn register_kds_device(
        &self,
        input: RegisterKdsDeviceInput,
    ) -> Result<KdsDevice, CoreError> {
        // Enforce unique name per restaurant POS.
        let existing: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM kds_devices WHERE name = ?1 AND restaurant_pos_id = ?2",
            params![input.name, input.restaurant_pos_id],
            |row| row.get(0),
        )?;
        if existing > 0 {
            return Err(CoreError::Validation {
                field: "name",
                message: format!(
                    "device name '{}' already exists for restaurant POS '{}'",
                    input.name, input.restaurant_pos_id
                ),
            });
        }

        let id = uuid::Uuid::now_v7().to_string();
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let station_ids_json = serde_json::to_string(&input.station_ids)
            .map_err(|e| CoreError::Internal(format!("serialize station_ids: {e}")))?;

        self.conn.execute(
            "INSERT INTO kds_devices (id, name, restaurant_pos_id, station_ids, pairing_token_hash, pairing_expires_at, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
            params![
                id,
                input.name,
                input.restaurant_pos_id,
                station_ids_json,
                input.pairing_token_hash,
                input.pairing_expires_at,
                now,
            ],
        )?;

        Ok(KdsDevice {
            id,
            name: input.name,
            restaurant_pos_id: input.restaurant_pos_id,
            station_ids: input.station_ids,
            is_active: true,
            last_seen_at: None,
            connection_status: KdsConnectionStatus::Disconnected,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    /// Validate a pairing token against a device's stored hash and expiry.
    ///
    /// Returns `Ok(true)` if the token hash matches AND the token has not
    /// expired. Returns `Ok(false)` if the device is not found.
    /// Returns `Err` for expired tokens or hash mismatches.
    pub fn validate_pairing_token(
        &self,
        token_hash: &str,
        device_id: &str,
    ) -> Result<bool, CoreError> {
        // Query the pairing fields directly (not exposed on domain struct).
        let result: Result<(String, String), _> = self.conn.query_row(
            "SELECT pairing_token_hash, pairing_expires_at FROM kds_devices WHERE id = ?1",
            params![device_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        );

        let (stored_hash, expires_at) = match result {
            Ok(pair) => pair,
            Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(false),
            Err(e) => return Err(e.into()),
        };

        // Check hash match (F9: constant-time — the byte-wise XOR fold
        // removes the timing oracle on a hash-prefix match; both values are
        // hex digests, so length is compared first and the fold's outcome
        // is all that varies).
        let hash_matches = stored_hash.len() == token_hash.len()
            && stored_hash
                .bytes()
                .zip(token_hash.bytes())
                .fold(0u8, |acc, (a, b)| acc | (a ^ b))
                == 0;
        if !hash_matches {
            return Err(CoreError::Validation {
                field: "token_hash",
                message: "pairing token hash mismatch".into(),
            });
        }

        // Check expiry (F9: fail CLOSED on unparseable values). The stored
        // value is RFC 3339; a bare `YYYY-MM-DD` (legacy/fixture shape) is
        // tolerated as UTC midnight so expiry is still enforced on it.
        // Previously ANY unparseable timestamp silently skipped the check,
        // letting a corrupt or tampered expiry bypass pairing validation.
        let expires: Option<chrono::DateTime<chrono::FixedOffset>> =
            match chrono::DateTime::parse_from_rfc3339(&expires_at) {
                Ok(dt) => Some(dt),
                Err(_) => chrono::NaiveDate::parse_from_str(&expires_at, "%Y-%m-%d")
                    .ok()
                    .and_then(|d| d.and_hms_opt(0, 0, 0))
                    .map(|dt| dt.and_utc().fixed_offset()),
            };
        match expires {
            Some(expires) if chrono::Utc::now() > expires => {
                return Err(CoreError::Validation {
                    field: "pairing_expires_at",
                    message: "pairing token has expired".into(),
                });
            }
            Some(_) => {}
            None => {
                return Err(CoreError::Validation {
                    field: "pairing_expires_at",
                    message: format!("malformed pairing_expires_at: {expires_at}"),
                });
            }
        }

        Ok(true)
    }

    /// Retrieve a KDS device by ID.
    pub fn get_kds_device(&self, id: &str) -> Result<Option<KdsDevice>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, restaurant_pos_id, station_ids, is_active, last_seen_at, connection_status, created_at, updated_at
             FROM kds_devices WHERE id = ?1",
        )?;
        let mut rows = stmt.query(params![id])?;
        match rows.next()? {
            Some(row) => Ok(Some(self.row_to_kds_device(row)?)),
            None => Ok(None),
        }
    }

    /// List all KDS devices for a Restaurant POS.
    pub fn list_kds_devices_for_restaurant(
        &self,
        restaurant_pos_id: &str,
    ) -> Result<Vec<KdsDevice>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, restaurant_pos_id, station_ids, is_active, last_seen_at, connection_status, created_at, updated_at
             FROM kds_devices WHERE restaurant_pos_id = ?1 ORDER BY name",
        )?;
        let rows = stmt.query_map(params![restaurant_pos_id], |row| {
            Ok(KdsDeviceRow {
                id: row.get("id")?,
                name: row.get("name")?,
                restaurant_pos_id: row.get("restaurant_pos_id")?,
                station_ids: row.get("station_ids")?,
                is_active: row.get::<_, i64>("is_active")? != 0,
                last_seen_at: row.get("last_seen_at")?,
                connection_status: row.get("connection_status")?,
                created_at: row.get("created_at")?,
                updated_at: row.get("updated_at")?,
            })
        })?;
        rows.map(|r| {
            let row = r?;
            self.row_from_kds_device_row(row)
        })
        .collect()
    }

    /// Update a KDS device's connection status.
    pub fn update_kds_device_status(
        &self,
        id: &str,
        status: KdsConnectionStatus,
    ) -> Result<(), CoreError> {
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let last_seen = if status == KdsConnectionStatus::Connected {
            Some(now.clone())
        } else {
            None
        };
        let affected = self.conn.execute(
            "UPDATE kds_devices SET connection_status = ?1, last_seen_at = ?2, updated_at = ?3 WHERE id = ?4",
            params![status.as_str(), last_seen, now, id],
        )?;
        if affected == 0 {
            return Err(CoreError::NotFound {
                entity: "kds_device",
                id: id.to_string(),
            });
        }
        Ok(())
    }

    /// Deactivate a KDS device.
    pub fn deactivate_kds_device(&self, id: &str) -> Result<(), CoreError> {
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let affected = self.conn.execute(
            "UPDATE kds_devices SET is_active = 0, updated_at = ?1 WHERE id = ?2",
            params![now, id],
        )?;
        if affected == 0 {
            return Err(CoreError::NotFound {
                entity: "kds_device",
                id: id.to_string(),
            });
        }
        Ok(())
    }

    fn row_to_kds_device(&self, row: &rusqlite::Row) -> rusqlite::Result<KdsDevice> {
        let station_ids_str: String = row.get("station_ids")?;
        let station_ids: Vec<String> = serde_json::from_str(&station_ids_str).unwrap_or_default();
        let status_str: String = row.get("connection_status")?;
        Ok(KdsDevice {
            id: row.get("id")?,
            name: row.get("name")?,
            restaurant_pos_id: row.get("restaurant_pos_id")?,
            station_ids,
            is_active: row.get::<_, i64>("is_active")? != 0,
            last_seen_at: row.get("last_seen_at")?,
            connection_status: KdsConnectionStatus::parse_db(&status_str)
                .unwrap_or(KdsConnectionStatus::Disconnected),
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        })
    }

    fn row_from_kds_device_row(&self, row: KdsDeviceRow) -> Result<KdsDevice, CoreError> {
        let station_ids: Vec<String> = serde_json::from_str(&row.station_ids).unwrap_or_default();
        Ok(KdsDevice {
            id: row.id,
            name: row.name,
            restaurant_pos_id: row.restaurant_pos_id,
            station_ids,
            is_active: row.is_active,
            last_seen_at: row.last_seen_at,
            connection_status: KdsConnectionStatus::parse_db(&row.connection_status)
                .unwrap_or(KdsConnectionStatus::Disconnected),
            created_at: row.created_at,
            updated_at: row.updated_at,
        })
    }
}

/// Intermediate row type for query_map closures.
struct KdsDeviceRow {
    id: String,
    name: String,
    restaurant_pos_id: String,
    station_ids: String,
    is_active: bool,
    last_seen_at: Option<String>,
    connection_status: String,
    created_at: String,
    updated_at: String,
}

#[cfg(test)]
#[path = "kds_devices_tests.rs"]
mod tests;
