//! Product image storage — set/clear image assignments (spec 0046b §3.2–3.3).
//!
//! These methods manage the DB-side of the content-addressed image store:
//! `product_images` table (slots 1..5, hashes only) and the slot-1 mirror on
//! `products.image_hash`. Image processing (sniff, transcode, hash, atomic
//! file write) lives in the Tauri command layer — this module receives only
//! the already-computed hash string.
//!
//! Invariants enforced here:
//! - slot 1..=5 validation
//! - menu item (`product_type = 'restaurant'`) has exactly 1 image (slot 1 only)
//! - clearing slot 1 on a menu item is refused
//! - clearing slot 1 while alternatives exist promotes the first alternative
//!   (lowest `position`, tie-break lowest `slot`) to primary in the same
//!   transaction
//! - every image-set/clear bumps `products.version` for sync

use super::Store;
use crate::error::CoreError;
use rusqlite::OptionalExtension;

impl Store<'_> {
    /// Assign image `hash` to `product_id` at `slot` (1..=5) in one transaction.
    ///
    /// Upserts `product_images`, maintains the slot-1 mirror on
    /// `products.image_hash`, and bumps `products.version`.
    ///
    /// # Errors
    ///
    /// - [`CoreError::Validation`] if `slot` is out of range.
    /// - [`CoreError::NotFound`] if `product_id` does not exist.
    /// - [`CoreError::Validation`] if the product is a menu item and `slot != 1`
    ///   (menu items always have exactly 1 image).
    pub fn set_product_image(
        &self,
        product_id: &str,
        slot: i32,
        hash: &str,
    ) -> Result<(), CoreError> {
        // Validate slot
        if !(1..=5).contains(&slot) {
            return Err(CoreError::Validation {
                field: "slot",
                message: format!("slot must be between 1 and 5, got {slot}"),
            });
        }
        if hash.is_empty() {
            return Err(CoreError::Validation {
                field: "hash",
                message: "hash must not be empty".into(),
            });
        }

        let tx = self
            .conn
            .unchecked_transaction()
            .map_err(|e| CoreError::Internal(format!("starting tx: {e}")))?;

        // Check product type — menu items can only have slot 1.
        let product_type: String = tx
            .query_row(
                "SELECT product_type FROM products WHERE id = ?1",
                rusqlite::params![product_id],
                |row| row.get(0),
            )
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => CoreError::NotFound {
                    entity: "product",
                    id: product_id.to_owned(),
                },
                other => CoreError::Internal(format!("reading product_type: {other}")),
            })?;

        if product_type == "restaurant" && slot != 1 {
            return Err(CoreError::Validation {
                field: "slot",
                message: "menu items (restaurant type) can only have slot 1 (primary image)".into(),
            });
        }

        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

        // Upsert the product_images row
        tx.execute(
            "INSERT INTO product_images (product_id, slot, hash, position, updated_at)
             VALUES (?1, ?2, ?3, 0, ?4)
             ON CONFLICT(product_id, slot) DO UPDATE SET
                 hash = excluded.hash,
                 updated_at = excluded.updated_at",
            rusqlite::params![product_id, slot, hash, now],
        )?;

        // Maintain slot-1 mirror and bump version
        if slot == 1 {
            tx.execute(
                "UPDATE products SET image_hash = ?1, version = version + 1, updated_at = ?2 WHERE id = ?3",
                rusqlite::params![hash, now, product_id],
            )?;
        } else {
            tx.execute(
                "UPDATE products SET version = version + 1, updated_at = ?1 WHERE id = ?2",
                rusqlite::params![now, product_id],
            )?;
        }

        tx.commit()
            .map_err(|e| CoreError::Internal(format!("commit: {e}")))?;
        Ok(())
    }

    /// Remove the image at `slot` for `product_id` in one transaction.
    ///
    /// If slot is 1 and alternatives exist (slots 2..5), the first alternative
    /// (lowest `position`, tie-break lowest `slot`) is promoted to primary
    /// (moved to slot 1, image_hash updated) in the same transaction.
    ///
    /// # Errors
    ///
    /// - [`CoreError::Validation`] if `slot` is out of range.
    /// - [`CoreError::NotFound`] if `product_id` does not exist.
    /// - [`CoreError::Validation`] if the product is a menu item and `slot == 1`
    ///   (menu items always have exactly 1 image).
    pub fn clear_product_image(&self, product_id: &str, slot: i32) -> Result<(), CoreError> {
        if !(1..=5).contains(&slot) {
            return Err(CoreError::Validation {
                field: "slot",
                message: format!("slot must be between 1 and 5, got {slot}"),
            });
        }

        let tx = self
            .conn
            .unchecked_transaction()
            .map_err(|e| CoreError::Internal(format!("starting tx: {e}")))?;

        // Check product exists and get product_type
        let (product_type, _version): (String, i64) = tx
            .query_row(
                "SELECT product_type, version FROM products WHERE id = ?1",
                rusqlite::params![product_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => CoreError::NotFound {
                    entity: "product",
                    id: product_id.to_owned(),
                },
                other => CoreError::Internal(format!("reading product: {other}")),
            })?;

        // Menu invariant: restaurant-type items always have exactly 1 image
        if product_type == "restaurant" && slot == 1 {
            return Err(CoreError::Validation {
                field: "slot",
                message: "menu items (restaurant type) must always have exactly 1 image; clear the image by replacing it, not by removing it".into(),
            });
        }

        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

        if slot == 1 {
            // Primary image: check for alternatives to promote
            let promoted: Option<(i32, String)> = tx
                .query_row(
                    "SELECT slot, hash FROM product_images
                     WHERE product_id = ?1 AND slot BETWEEN 2 AND 5
                     ORDER BY position ASC, slot ASC
                     LIMIT 1",
                    rusqlite::params![product_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()?;

            if let Some((alt_slot, alt_hash)) = promoted {
                // Delete the current slot-1 row
                tx.execute(
                    "DELETE FROM product_images WHERE product_id = ?1 AND slot = 1",
                    rusqlite::params![product_id],
                )?;
                // Move the promoted alternative into slot 1
                tx.execute(
                    "UPDATE product_images SET slot = 1, position = 0, updated_at = ?1 WHERE product_id = ?2 AND slot = ?3",
                    rusqlite::params![now, product_id, alt_slot],
                )?;
                // Update slot-1 mirror
                tx.execute(
                    "UPDATE products SET image_hash = ?1, version = version + 1, updated_at = ?2 WHERE id = ?3",
                    rusqlite::params![alt_hash, now, product_id],
                )?;
            } else {
                // No alternatives: clear the mirror and delete the row
                tx.execute(
                    "DELETE FROM product_images WHERE product_id = ?1 AND slot = 1",
                    rusqlite::params![product_id],
                )?;
                tx.execute(
                    "UPDATE products SET image_hash = NULL, version = version + 1, updated_at = ?1 WHERE id = ?2",
                    rusqlite::params![now, product_id],
                )?;
            }
        } else {
            // Non-primary slot: just delete the row and bump version
            let deleted = tx.execute(
                "DELETE FROM product_images WHERE product_id = ?1 AND slot = ?2",
                rusqlite::params![product_id, slot],
            )?;
            tx.execute(
                "UPDATE products SET version = version + 1, updated_at = ?1 WHERE id = ?2",
                rusqlite::params![now, product_id],
            )?;
            // If nothing was deleted, it's still a success (idempotent)
            let _ = deleted;
        }

        tx.commit()
            .map_err(|e| CoreError::Internal(format!("commit: {e}")))?;
        Ok(())
    }

    /// List the image assignments for a product, ordered by slot.
    ///
    /// Returns `[(slot, hash, position)]` for slots 1..=5 present in
    /// `product_images`. Slot 1 is the primary; slots 2..5 are the
    /// alternatives (ordered by `position` by the UI).
    pub fn list_product_images(&self, product_id: &str) -> Result<Vec<ProductImage>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT slot, hash, position FROM product_images
             WHERE product_id = ?1
             ORDER BY slot ASC",
        )?;
        let rows = stmt.query_map(rusqlite::params![product_id], |row| {
            Ok(ProductImage {
                slot: row.get(0)?,
                hash: row.get(1)?,
                position: row.get(2)?,
            })
        })?;
        rows.map(|r| r.map_err(CoreError::from)).collect()
    }

    /// List every image assignment across all products, as `(hash, slot)`.
    ///
    /// Used by the tablet download manager (spec 0046b §3.7) to compute the
    /// missing-hash set at each cycle: referenced hashes minus files present
    /// on disk. Returns hashes in slot order so callers can download
    /// primaries (slot 1) before alternatives.
    pub fn list_all_product_images(&self) -> Result<Vec<(String, i32)>, CoreError> {
        let mut stmt = self
            .conn
            .prepare("SELECT hash, slot FROM product_images ORDER BY slot ASC, position ASC")?;
        let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
        rows.map(|r| r.map_err(CoreError::from)).collect()
    }
}

/// A single product image assignment (spec 0046b §3.2).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ProductImage {
    /// Slot 1 = primary; slots 2..5 = alternatives.
    pub slot: i32,
    /// Content-addressed hash (first 16 hex chars of sha-256).
    pub hash: String,
    /// Display order of alternatives (0-based); primary slot 1 always 0.
    pub position: i32,
}

#[cfg(test)]
#[path = "products_images_tests.rs"]
mod tests;
