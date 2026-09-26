//! KDS device management - registration and status.
//!
//! Key functions: register_kds_device, get_kds_device,
//! list_kds_devices_for_restaurant, update_kds_device_status,
//! deactivate_kds_device, plus the KdsDeviceRow query_map row type
//! and its mappers.
//!
//! Invariants: a device is registered by the POS that owns it (no
//! self-service enrollment); deactivation is soft (is_active flag) and
//! logged.
//!
//! **Why there is no pairing token here.** This table used to carry
//! `pairing_token_hash`/`pairing_expires_at` (and briefly a consumption pair)
//! for a QR flow in which a KDS screen scanned a code and redeemed it for a
//! credential. That flow was superseded: the POS registers the device, and
//! `station_ids` selects which topology stations it displays. Nothing ever
//! redeemed the token, so the UI displayed a secret that no code verified.
//! Removed in `20261014_kds_drop_pairing_tokens.sql`; do not reintroduce a
//! credential here without a consumer that actually checks it.

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
            "INSERT INTO kds_devices (id, name, restaurant_pos_id, station_ids, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
            params![
                id,
                input.name,
                input.restaurant_pos_id,
                station_ids_json,
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
        // Fail CLOSED. An empty `station_ids` is the BROADCAST sentinel — see
        // [`KdsDevice::station_ids`] and `resolve_targets_by_station` Phase 2
        // (`kds.rs`), which hands such a device EVERY order. Defaulting an
        // unreadable value to `[]` therefore silently widened a station-scoped
        // screen into an Expo "see everything" screen. Surface the decode
        // failure instead, using the same row-mapping idiom as
        // `db::row_to_product`. (The `connection_status` default below stays:
        // `Disconnected` is the NARROW end of that enum, so defaulting there is
        // already fail-closed.)
        let station_ids: Vec<String> = serde_json::from_str(&station_ids_str).map_err(|e| {
            rusqlite::Error::ToSqlConversionFailure(
                std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()).into(),
            )
        })?;
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
        // Fail CLOSED — see `row_to_kds_device` for why an empty list must not
        // be the default for an unreadable value.
        let station_ids: Vec<String> = serde_json::from_str(&row.station_ids).map_err(|e| {
            CoreError::Internal(format!(
                "kds_devices.station_ids is not a JSON string array: {e}"
            ))
        })?;
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
