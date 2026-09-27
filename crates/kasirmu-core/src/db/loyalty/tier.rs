//! Loyalty tiers: listing, lookup and authoring the tier configuration.
//!
//! Split out of `db/loyalty.rs` on 2026-09-28. A tier carries the earn rate, the
//! points-per-unit ratio and the display order the whole programme reads, so the
//! three methods that read and write it are kept together.
//!
//! Invariant: a tier write is VALIDATED before it lands
//! (`validate_tier_config`), so a nonsensical configuration cannot be persisted
//! and then silently mis-award every subsequent sale.

use rusqlite::params;

use crate::db::Store;
use crate::error::CoreError;

use super::{LoyaltyTier, validate_tier_config};

impl Store<'_> {
    /// List all loyalty tiers.
    pub fn list_tiers(&self) -> Result<Vec<LoyaltyTier>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, min_points, points_per_unit, earn_multiplier_millionths, colour, sort_order, created_at
             FROM loyalty_tiers ORDER BY sort_order",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(LoyaltyTier {
                id: row.get("id")?,
                name: row.get("name")?,
                min_points: row.get("min_points")?,
                points_per_unit: row.get("points_per_unit")?,
                earn_multiplier_millionths: row.get("earn_multiplier_millionths")?,
                colour: row.get("colour")?,
                sort_order: row.get("sort_order")?,
                created_at: row.get("created_at")?,
            })
        })?;
        rows.map(|r| Ok(r?)).collect()
    }

    pub(super) fn get_loyalty_tier(&self, id: &str) -> Result<Option<LoyaltyTier>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, min_points, points_per_unit, earn_multiplier_millionths, colour, sort_order, created_at
             FROM loyalty_tiers WHERE id = ?1",
        )?;
        let result = stmt.query_row(params![id], |row| {
            Ok(LoyaltyTier {
                id: row.get("id")?,
                name: row.get("name")?,
                min_points: row.get("min_points")?,
                points_per_unit: row.get("points_per_unit")?,
                earn_multiplier_millionths: row.get("earn_multiplier_millionths")?,
                colour: row.get("colour")?,
                sort_order: row.get("sort_order")?,
                created_at: row.get("created_at")?,
            })
        });
        match result {
            Ok(t) => Ok(Some(t)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// Update a loyalty tier.
    pub fn update_tier(
        &self,
        id: &str,
        name: &str,
        min_points: i64,
        points_per_unit: i64,
        earn_multiplier_millionths: i64,
        colour: &str,
    ) -> Result<LoyaltyTier, CoreError> {
        let tier_exists: bool = self
            .conn
            .query_row(
                "SELECT 1 FROM loyalty_tiers WHERE id = ?1",
                params![id],
                |_| Ok(true),
            )
            .unwrap_or(false);
        if !tier_exists {
            return Err(CoreError::NotFound {
                entity: "loyalty_tier",
                id: id.to_owned(),
            });
        }

        validate_tier_config(
            name,
            min_points,
            points_per_unit,
            earn_multiplier_millionths,
            colour,
        )?;

        let duplicate_threshold: bool = self.conn.query_row(
            "SELECT EXISTS(
                    SELECT 1 FROM loyalty_tiers
                    WHERE id <> ?1 AND min_points = ?2
                )",
            params![id, min_points],
            |row| row.get(0),
        )?;
        if duplicate_threshold {
            return Err(CoreError::Validation {
                field: "min_points",
                message: "tier thresholds must be unique".into(),
            });
        }

        if min_points > 0 {
            let has_zero_threshold: bool = self.conn.query_row(
                "SELECT EXISTS(
                        SELECT 1 FROM loyalty_tiers
                        WHERE id <> ?1 AND min_points = 0
                    )",
                params![id],
                |row| row.get(0),
            )?;
            if !has_zero_threshold {
                return Err(CoreError::Validation {
                    field: "min_points",
                    message: "at least one tier must start at zero points".into(),
                });
            }
        }

        let rows = self.conn.execute(
            "UPDATE loyalty_tiers SET name = ?1, min_points = ?2, points_per_unit = ?3,
             earn_multiplier_millionths = ?4, colour = ?5 WHERE id = ?6",
            params![
                name,
                min_points,
                points_per_unit,
                earn_multiplier_millionths,
                colour,
                id
            ],
        )?;

        if rows == 0 {
            return Err(CoreError::NotFound {
                entity: "loyalty_tier",
                id: id.to_owned(),
            });
        }

        self.get_loyalty_tier(id)?
            .ok_or_else(|| CoreError::NotFound {
                entity: "loyalty_tier",
                id: id.to_owned(),
            })
    }
}
