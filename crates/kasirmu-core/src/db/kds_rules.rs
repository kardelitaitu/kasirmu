//! KDS routing rules CRUD — the `kds_routing_rules` repository.
//!
//! Per-restaurant rule sets backing `crate::kds::resolve_kds_targets_with_rules`:
//! explicit station assignments that override/augment the product
//! `kitchen_zone` default per line, enabling e.g. burger→Kitchen /
//! cocktail→Bar splits without touching catalog data.
//!
//! Key functions: [`Store::list_kds_routing_rules`],
//! [`Store::save_kds_routing_rules`] (whole-set replace inside one
//! transaction), [`Store::product_category_id_by_sku`] (the
//! category-matcher's fact source, sibling of
//! `product_kitchen_zone_by_sku`).
//!
//! Invariants: ids and timestamps are server-assigned (UUID v7); scope is
//! always `restaurant_pos_id` — there is no cross-restaurant listing; the
//! save replaces the scope's whole set in one `rusqlite` transaction; the
//! table carries no money and no floats (priorities are integers).

use crate::db::Store;
use crate::error::CoreError;
use crate::kds::{KdsRoutingRule, KdsRoutingRuleInput, KdsRuleMatcher};
use rusqlite::params;

impl Store<'_> {
    /// List one restaurant's routing rules, highest priority first
    /// (priority ascending — lower number = higher priority), then by
    /// insertion order so the listing is deterministic and mirrors how
    /// the pure matcher ranks ties.
    pub fn list_kds_routing_rules(
        &self,
        restaurant_pos_id: &str,
    ) -> Result<Vec<KdsRoutingRule>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, restaurant_pos_id, priority, matcher_kind, matcher_value,
                    target_station, is_active, created_at, updated_at
             FROM kds_routing_rules
             WHERE restaurant_pos_id = ?1
             ORDER BY priority ASC, created_at ASC, id ASC",
        )?;
        let rows = stmt.query_map(params![restaurant_pos_id], Self::row_to_kds_routing_rule)?;
        rows.map(|r| Ok(r?)).collect()
    }

    /// Replace the complete rule set of one restaurant atomically.
    ///
    /// The list is the new truth: rules missing from it are deleted, so a
    /// client that saves `[]` clears the scope. Ids, restaurant scope and
    /// both timestamps are server-assigned (UUID v7, mirroring the other
    /// KDS repos). Everything runs inside one `rusqlite` transaction — a
    /// failing insert rolls back the delete too, never leaving a
    /// half-cleared set.
    ///
    /// # Errors
    ///
    /// [`CoreError::Validation`] when the scope or any rule carries a
    /// blank `matcher_value` / `target_station`; the CHECK constraint
    /// rejects unknown matcher kinds at insert level.
    pub fn save_kds_routing_rules(
        &self,
        restaurant_pos_id: &str,
        rules: &[KdsRoutingRuleInput],
    ) -> Result<Vec<KdsRoutingRule>, CoreError> {
        if restaurant_pos_id.trim().is_empty() {
            return Err(CoreError::Validation {
                field: "restaurant_pos_id",
                message: "restaurant_pos_id must not be empty".into(),
            });
        }
        for (i, rule) in rules.iter().enumerate() {
            if rule.matcher_value.trim().is_empty() {
                return Err(CoreError::Validation {
                    field: "matcher_value",
                    message: format!("rule at index {i}: matcher_value must not be empty"),
                });
            }
            if rule.target_station.trim().is_empty() {
                return Err(CoreError::Validation {
                    field: "target_station",
                    message: format!("rule at index {i}: target_station must not be empty"),
                });
            }
        }

        let now = chrono::Utc::now()
            .format("%Y-%m-%dT%H:%M:%S%.3fZ")
            .to_string();

        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "DELETE FROM kds_routing_rules WHERE restaurant_pos_id = ?1",
            params![restaurant_pos_id],
        )?;
        for rule in rules {
            let id = uuid::Uuid::now_v7().to_string();
            tx.execute(
                "INSERT INTO kds_routing_rules
                     (id, restaurant_pos_id, priority, matcher_kind, matcher_value,
                      target_station, is_active, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    id,
                    restaurant_pos_id,
                    rule.priority,
                    rule.matcher.as_str(),
                    rule.matcher_value,
                    rule.target_station,
                    rule.is_active as i64,
                    now,
                    now,
                ],
            )?;
        }
        tx.commit()?;

        self.list_kds_routing_rules(restaurant_pos_id)
    }

    /// Look up the `category_id` for a product by SKU.
    ///
    /// Fact source for `KdsRuleMatcher::Category` rules, mirroring
    /// `product_kitchen_zone_by_sku`'s contract: `Ok(None)` when the SKU
    /// is unknown or carries no category.
    pub fn product_category_id_by_sku(&self, sku: &str) -> Result<Option<String>, CoreError> {
        let mut stmt = self
            .conn
            .prepare("SELECT category_id FROM products WHERE sku = ?1")?;
        let result = stmt.query_row(params![sku], |row| row.get::<_, Option<String>>(0));
        match result {
            Ok(category) => Ok(category),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    fn row_to_kds_routing_rule(row: &rusqlite::Row) -> rusqlite::Result<KdsRoutingRule> {
        let kind_str: String = row.get("matcher_kind")?;
        Ok(KdsRoutingRule {
            id: row.get("id")?,
            restaurant_pos_id: row.get("restaurant_pos_id")?,
            priority: row.get("priority")?,
            // Unknown kinds cannot exist through the save path or the CHECK
            // constraint; a corrupt row degrades to Sku (the only kind that
            // can match nothing if its value stops naming a SKU) rather
            // than poisoning the whole listing — same shape as the
            // connection-status mapper in kds_devices.
            matcher: KdsRuleMatcher::parse_db(&kind_str).unwrap_or(KdsRuleMatcher::Sku),
            matcher_value: row.get("matcher_value")?,
            target_station: row.get("target_station")?,
            is_active: row.get::<_, i64>("is_active")? != 0,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        })
    }
}

#[cfg(test)]
#[path = "kds_rules_tests.rs"]
mod tests;
