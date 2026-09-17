//! Active cart persistence — load, save, delete, and list active carts.
/*
last audited 25-07-26 by RSA-Agent (oz-core slice B5 part 6)
crate: oz-core | status: SAFE | lint: CLEAN
findings: ADR-19 §5.1 location lock preserved via COALESCE upsert (never silently cleared); typed NoDeductionLocationLock error; ensure lock uses .unwrap_or(false) (fail-closed direction — missing lock denies mutation)
next: none | perf: N/A
*/
//!
//! Carts are serialised as JSON blobs in the `active_carts` table so they
//! survive application restarts.  This is the same strategy used for
//! [`held_carts`](crate::db::sales).

use foundation::Cart;
use foundation::CartId;
use uuid::Uuid;

use crate::error::CoreError;

use super::Store;

/// Error returned when an `add_line` (or other mutation) is attempted on
/// a cart whose `deduction_location_id` is NULL — callers must create the
/// cart via `start_sale_scoped` (which resolves and locks the location)
/// before adding lines.
#[derive(Debug, thiserror::Error)]
#[error("cart {cart_id} has no deduction_location_id — create the cart via start_sale_scoped")]
pub struct NoDeductionLocationLock {
    /// Identifier of the cart that is missing its deduction location lock.
    pub cart_id: String,
}

impl Store<'_> {
    /// Record a manager override of the deduction location lock on an active cart.
    ///
    /// Sets `location_override_at` to the current UTC timestamp (ISO-8601).
    /// This is an audit record — the `deduction_location_id` itself is not
    /// changed by this call.
    ///
    /// ADR-19 §5.1: manager override via FastPINOverlay (ADR-6 pattern).
    /// Call this after the manager PIN is verified.
    pub fn override_active_cart_deduction_location(&self, id: &CartId) -> Result<(), CoreError> {
        let id_str = id.to_string();
        let updated = self.conn.execute(
            "UPDATE active_carts
             SET location_override_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?1",
            rusqlite::params![id_str],
        )?;
        if updated == 0 {
            return Err(CoreError::NotFound {
                entity: "active_cart",
                id: id_str.clone(),
            });
        }
        Ok(())
    }

    /// Persist (insert or update) an active cart in SQLite.
    ///
    /// The cart is serialised to JSON via `serde_json`.  If a cart with
    /// the same id already exists it is replaced.
    ///
    /// When `deduction_location_id` is `Some`, the column is set (or updated)
    /// on the `active_carts` row.  When `None`, the existing value is preserved
    /// (cart operations like `add_line` must not clear the location lock).
    ///
    /// ADR-19 §5.1: the location lock is set once at cart-start time and must
    /// not be silently cleared by subsequent saves.
    pub fn save_active_cart(
        &self,
        cart: &Cart,
        deduction_location_id: Option<&str>,
    ) -> Result<(), CoreError> {
        let id = cart.id().to_string();
        let cart_data = serde_json::to_string(cart)
            .map_err(|e| CoreError::Internal(format!("serialising cart {id}: {e}")))?;
        self.conn.execute(
            "INSERT INTO active_carts (id, cart_data, deduction_location_id, updated_at)
             VALUES (?1, ?2, ?3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
             ON CONFLICT(id) DO UPDATE SET
                cart_data = excluded.cart_data,
                deduction_location_id = COALESCE(excluded.deduction_location_id, active_carts.deduction_location_id),
                updated_at = excluded.updated_at",
            rusqlite::params![id, cart_data, deduction_location_id],
        )?;
        Ok(())
    }

    /// Return the deduction location info (id, name, override timestamp) for
    /// an active cart by JOINing with `inventory_locations`.  Returns `None`
    /// when the cart row does not exist or `deduction_location_id` is NULL.
    ///
    /// ADR-19 §17: consumed by `get_cart_deduction_location` Tauri command.
    pub fn get_active_cart_deduction_location_info(
        &self,
        id: &CartId,
    ) -> Result<Option<(String, String, Option<String>)>, CoreError> {
        let id_str = id.to_string();
        let result = self.conn.query_row(
            "SELECT l.name, ac.deduction_location_id, ac.location_override_at
             FROM active_carts ac
             LEFT JOIN inventory_locations l ON l.id = ac.deduction_location_id
             WHERE ac.id = ?1 AND ac.deduction_location_id IS NOT NULL",
            rusqlite::params![id_str],
            |row| {
                let loc_name: String = row.get::<_, String>(0).unwrap_or_default();
                let loc_id: String = row.get(1)?;
                let override_at: Option<String> = row.get(2)?;
                Ok((loc_id, loc_name, override_at))
            },
        );
        match result {
            Ok(val) => Ok(Some(val)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// Return the `deduction_location_id` for an active cart, or `None`
    /// when the cart row does not exist OR the column is NULL.
    ///
    /// ADR-19 §5.1: the location lock is set once at cart-start time.
    pub fn get_active_cart_deduction_location(
        &self,
        id: &CartId,
    ) -> Result<Option<String>, CoreError> {
        let id_str = id.to_string();
        match self.conn.query_row(
            "SELECT deduction_location_id FROM active_carts WHERE id = ?1",
            rusqlite::params![id_str],
            |row| row.get(0),
        ) {
            Ok(val) => Ok(val),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// Check that an active cart has a non-NULL `deduction_location_id`.
    /// Returns `Ok(())` when set; returns `Err(NoDeductionLocationLock)`
    /// when the cart has no location lock.
    ///
    /// Call this at the start of every mutation command (e.g. `add_line`)
    /// that should be rejected when no lock exists.
    pub fn ensure_cart_deduction_location_lock(
        &self,
        id: &CartId,
    ) -> Result<(), NoDeductionLocationLock> {
        let id_str = id.to_string();
        let has_lock: bool = self
            .conn
            .query_row(
                "SELECT 1 FROM active_carts WHERE id = ?1 AND deduction_location_id IS NOT NULL",
                rusqlite::params![id_str],
                |_| Ok(true),
            )
            .unwrap_or(false);
        if has_lock {
            Ok(())
        } else {
            Err(NoDeductionLocationLock { cart_id: id_str })
        }
    }

    /// Load an active cart by id.  Returns `None` when the id does not
    /// exist in the database.
    pub fn load_active_cart(&self, id: &CartId) -> Result<Option<Cart>, CoreError> {
        let id_str = id.to_string();
        let result: Result<String, rusqlite::Error> = self.conn.query_row(
            "SELECT cart_data FROM active_carts WHERE id = ?1",
            rusqlite::params![id_str],
            |row| row.get(0),
        );
        match result {
            Ok(json) => {
                let cart: Cart = serde_json::from_str(&json).map_err(|e| {
                    CoreError::Internal(format!("deserialising cart {id_str}: {e}"))
                })?;
                Ok(Some(cart))
            }
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// Delete an active cart by id.  Succeeds even if the id does not
    /// exist (no-op delete).
    pub fn delete_active_cart(&self, id: &CartId) -> Result<(), CoreError> {
        self.conn.execute(
            "DELETE FROM active_carts WHERE id = ?1",
            rusqlite::params![id.to_string()],
        )?;
        Ok(())
    }

    /// Return all active cart ids, most-recently-updated first.
    pub fn list_active_carts(&self) -> Result<Vec<CartId>, CoreError> {
        let mut stmt = self
            .conn
            .prepare("SELECT id FROM active_carts ORDER BY updated_at DESC")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        let mut ids = Vec::new();
        for row in rows {
            let id_str: String = row?;
            let uuid = Uuid::parse_str(&id_str).map_err(|e| {
                CoreError::Internal(format!("invalid cart id in DB: {id_str}: {e}"))
            })?;
            ids.push(CartId(uuid));
        }
        Ok(ids)
    }
}

#[cfg(test)]
#[path = "cart_tests.rs"]
mod tests;
