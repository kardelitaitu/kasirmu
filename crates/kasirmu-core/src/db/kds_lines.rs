//! Sale-to-KDS fanout and line-item transitions.
//!
//! Key functions: complete_sale_to_kds (+routed/+fanout) building one
//! ticket per kitchen zone from a completed sale, the SKU product-type /
//! name / kitchen-zone lookups, create_kds_line_items,
//! get_kds_order_lines (+_for_instance), update_kds_line_item_status
//! (+_for_instance), and derive_kds_summary.
//!
//! Invariants: line-item status transitions are enforced by the
//! allowed() state machine; product type filters decide ticket
//! eligibility (restaurant/both only); prep_time is clamped >= 0.

use crate::db::Store;
use crate::error::CoreError;
use crate::{
    CreateKdsLineItemInput, CreateKdsOrderInput, KdsLineItem, KdsModifier, KdsOrder, KdsStatus,
};
use rusqlite::params;

impl Store<'_> {
    /// Complete a sale to KDS orders: creates one KDS ticket per kitchen zone
    /// from a completed sale for items whose product type is `restaurant` or `both`.
    ///
    /// When `store_id` is provided (from the caller's `SessionContext`), the
    /// resulting KDS orders are tagged with that store for defense-in-depth
    /// filtering on KDS tablets (ADR #8).
    ///
    /// Returns an empty `Vec` when the sale has no restaurant-eligible items.
    pub fn complete_sale_to_kds(
        &self,
        sale_id: &str,
        store_id: Option<&str>,
    ) -> Result<Vec<KdsOrder>, CoreError> {
        self.complete_sale_to_kds_routed(sale_id, store_id, None)
    }

    /// Complete a sale to KDS orders routed to one topology-selected instance.
    pub fn complete_sale_to_kds_routed(
        &self,
        sale_id: &str,
        store_id: Option<&str>,
        target_instance_id: Option<&str>,
    ) -> Result<Vec<KdsOrder>, CoreError> {
        let targets = target_instance_id
            .map(str::to_owned)
            .into_iter()
            .collect::<Vec<_>>();
        self.complete_sale_to_kds_fanout(sale_id, store_id, &targets)
    }

    /// Complete a sale and deliver each zone ticket to every target instance.
    ///
    /// One `kds_orders` row is created per sale/zone. The normalized target
    /// table carries fan-out delivery without violating `sale_id` uniqueness.
    pub fn complete_sale_to_kds_fanout(
        &self,
        sale_id: &str,
        store_id: Option<&str>,
        target_instance_ids: &[String],
    ) -> Result<Vec<KdsOrder>, CoreError> {
        let sale = self.get_sale(sale_id)?.ok_or_else(|| CoreError::NotFound {
            entity: "sale",
            id: sale_id.to_owned(),
        })?;

        // Keep only lines whose product is restaurant or both.
        let kds_lines: Vec<_> = sale
            .lines
            .iter()
            .filter(|l| {
                self.product_type_by_sku(&l.sku)
                    .ok()
                    .flatten()
                    .is_some_and(|pt| pt == "restaurant" || pt == "both")
            })
            .collect();

        if kds_lines.is_empty() {
            return Ok(vec![]);
        }

        // Idempotent-replay guard: a retried checkout (double-tapped pay,
        // transient error between ticket creation and finalize) must not
        // violate UNIQUE(sale_id, kitchen_zone) — which for zoned sales
        // surfaces as a swallowed checkout error, and for unzoned sales
        // silently creates duplicate tickets (SQLite treats NULL zones as
        // distinct in a UNIQUE index). Any zone that already has a ticket
        // for this sale is skipped; when nothing new is created, the
        // existing (non-cancelled) tickets are returned unchanged.
        let existing_zones: std::collections::HashSet<Option<String>> = {
            let mut stmt = self
                .conn
                .prepare("SELECT kitchen_zone FROM kds_orders WHERE sale_id = ?1")?;
            let rows = stmt.query_map(params![sale_id], |row| row.get::<_, Option<String>>(0))?;
            rows.collect::<Result<std::collections::HashSet<_>, _>>()?
        };

        // Group eligible lines by kitchen zone.
        let mut by_zone: std::collections::BTreeMap<Option<String>, Vec<&crate::SaleLine>> =
            std::collections::BTreeMap::new();
        for line in &kds_lines {
            let zone = self
                .product_kitchen_zone_by_sku(&line.sku)
                .ok()
                .flatten()
                .filter(|z| !z.is_empty());
            by_zone.entry(zone).or_default().push(line);
        }

        // Look up the table name assigned to this sale (TODO 1b).
        let table_number: Option<String> = {
            let mut stmt = self
                .conn
                .prepare("SELECT name FROM tables WHERE active_sale_id = ?1")?;
            match stmt.query_row(params![sale_id], |row| row.get::<_, String>(0)) {
                Ok(name) => Some(name),
                Err(rusqlite::Error::QueryReturnedNoRows) => None,
                Err(e) => return Err(e.into()),
            }
        };

        let mut orders = Vec::with_capacity(by_zone.len());
        // Skip zones that already have a ticket for this sale.
        by_zone.retain(|zone, _| !existing_zones.contains(zone));
        if by_zone.is_empty() {
            return self.get_kds_orders_by_sale(sale_id).map(|all| {
                all.into_iter()
                    .filter(|o| o.status != "cancelled")
                    .collect()
            });
        }
        // One transaction for the WHOLE fanout: a failure on any zone
        // (duplicate sale/zone, line-item error) rolls back every ticket
        // created so far, so the kitchen never sees a partial set.
        let tx = self.conn.unchecked_transaction()?;
        for (zone, lines) in by_zone {
            // Build structured line items with course + modifier data (TODO 2a).
            let structured_items: Vec<CreateKdsLineItemInput> = lines
                .iter()
                .map(|l| {
                    let display_name = self
                        .product_name_by_sku(&l.sku)
                        .ok()
                        .flatten()
                        .unwrap_or_else(|| l.sku.clone());

                    // Parse modifiers_json from the sale line.
                    let modifiers: Vec<KdsModifier> = l
                        .modifiers_json
                        .as_deref()
                        .filter(|j| !j.is_empty())
                        .and_then(|j| serde_json::from_str(j).ok())
                        .unwrap_or_default();

                    CreateKdsLineItemInput {
                        sku: l.sku.clone(),
                        display_name,
                        qty: l.qty,
                        course: l.course.clone(),
                        modifiers,
                    }
                })
                .collect();

            let (items_summary, item_count) = Store::derive_kds_summary(&structured_items);

            let order = self.create_kds_order_fanout_in_tx(
                &tx,
                CreateKdsOrderInput {
                    sale_id: sale_id.to_owned(),
                    store_id: store_id.map(|s| s.to_owned()),
                    items_summary,
                    item_count,
                    kitchen_zone: zone,
                    notes: String::new(),
                    table_number: table_number.clone(),
                    priority: false,
                },
                target_instance_ids,
            )?;

            // Create the structured line items in the new kds_line_items table.
            self.create_kds_line_items_in_tx(&tx, &order.id, &structured_items)?;

            orders.push(order);
        }
        tx.commit()?;

        Ok(orders)
    }

    fn product_type_by_sku(&self, sku: &str) -> Result<Option<String>, CoreError> {
        let mut stmt = self
            .conn
            .prepare("SELECT product_type FROM products WHERE sku = ?1")?;
        let result = stmt.query_row(params![sku], |row| row.get::<_, String>(0));
        match result {
            Ok(pt) => Ok(Some(pt)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    fn product_name_by_sku(&self, sku: &str) -> Result<Option<String>, CoreError> {
        let mut stmt = self
            .conn
            .prepare("SELECT name FROM products WHERE sku = ?1")?;
        let result = stmt.query_row(params![sku], |row| row.get::<_, String>(0));
        match result {
            Ok(name) => Ok(Some(name)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// Look up the `kitchen_zone` for a product by SKU.
    ///
    /// Used by the multi-KDS routing engine to map line-item SKUs to
    /// kitchen zones, which in turn map to device `station_ids`.
    pub fn product_kitchen_zone_by_sku(&self, sku: &str) -> Result<Option<String>, CoreError> {
        let mut stmt = self
            .conn
            .prepare("SELECT kitchen_zone FROM products WHERE sku = ?1")?;
        let result = stmt.query_row(params![sku], |row| row.get::<_, Option<String>>(0));
        match result {
            Ok(zone) => Ok(zone),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    // ── KDS line items (TODO 2a) ────────────────────────────────────

    /// Create KDS line items for an order.
    pub fn create_kds_line_items(
        &self,
        order_id: &str,
        items: &[CreateKdsLineItemInput],
    ) -> Result<Vec<KdsLineItem>, CoreError> {
        if items.is_empty() {
            return Ok(vec![]);
        }
        let tx = self.conn.unchecked_transaction()?;
        let result = self.create_kds_line_items_in_tx(&tx, order_id, items)?;
        tx.commit()?;
        Ok(result)
    }

    /// Get line items only when the parent order belongs to the current instance.
    pub fn get_kds_order_lines_for_instance(
        &self,
        order_id: &str,
        instance_id: &str,
    ) -> Result<Vec<KdsLineItem>, CoreError> {
        self.ensure_kds_order_visible_to_instance(order_id, instance_id)?;
        self.get_kds_order_lines(order_id)
    }

    /// Get all line items for a KDS order, ordered by course then position.
    pub fn get_kds_order_lines(&self, order_id: &str) -> Result<Vec<KdsLineItem>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, kds_order_id, sku, display_name, qty, course, modifiers_json,
                    line_position, item_status, started_at, ready_at, served_at, created_at
             FROM kds_line_items
             WHERE kds_order_id = ?1
             ORDER BY
                 CASE course
                     WHEN 'appetizer' THEN 0
                     WHEN 'main' THEN 1
                     WHEN 'side' THEN 2
                     WHEN 'dessert' THEN 3
                     WHEN 'beverage' THEN 4
                     ELSE 99
                 END,
                 line_position",
        )?;
        let rows = stmt.query_map(params![order_id], Self::row_to_kds_line_item)?;
        rows.map(|r| Ok(r?)).collect()
    }

    /// Update the status of a single KDS line item. Automatically sets
    /// the corresponding timestamp (started_at, ready_at, served_at)
    /// based on the new status.
    /// Update a line item only when its parent order belongs to the current
    /// KDS instance.
    pub fn update_kds_line_item_status_for_instance(
        &self,
        item_id: &str,
        new_status: &str,
        instance_id: &str,
    ) -> Result<KdsLineItem, CoreError> {
        let order_id: String = self
            .conn
            .query_row(
                "SELECT kds_order_id FROM kds_line_items WHERE id = ?1",
                params![item_id],
                |row| row.get(0),
            )
            .map_err(|error| match error {
                rusqlite::Error::QueryReturnedNoRows => CoreError::NotFound {
                    entity: "kds_line_item",
                    id: item_id.to_owned(),
                },
                other => CoreError::Db(other),
            })?;
        self.ensure_kds_order_visible_to_instance(&order_id, instance_id)?;
        self.update_kds_line_item_status(item_id, new_status)
    }

    /// Update a line item's status and its corresponding workflow timestamp.
    ///
    /// Forward-only transitions (pending → preparing → ready → served, plus
    /// cancelled from any active state) — mirrors the order-level state
    /// machine so a stale offline replay cannot regress a line item.
    pub fn update_kds_line_item_status(
        &self,
        item_id: &str,
        new_status: &str,
    ) -> Result<KdsLineItem, CoreError> {
        if KdsStatus::from_str(new_status).is_none() {
            return Err(CoreError::Validation {
                field: "item_status",
                message: format!("invalid KDS line item status: {new_status}"),
            });
        }

        // Read the current status before mutating (no partial writes on
        // regression).
        let current_status: String = self
            .conn
            .query_row(
                "SELECT item_status FROM kds_line_items WHERE id = ?1",
                params![item_id],
                |row| row.get(0),
            )
            .map_err(|error| match error {
                rusqlite::Error::QueryReturnedNoRows => CoreError::NotFound {
                    entity: "kds_line_item",
                    id: item_id.to_owned(),
                },
                other => CoreError::Db(other),
            })?;
        let allowed = |from: &str, to: &str| match (from, to) {
            ("pending", "preparing") | ("preparing", "ready") | ("ready", "served") => true,
            ("pending", "cancelled") | ("preparing", "cancelled") | ("ready", "cancelled") => true,
            (from, to) if from == to => true,
            _ => false,
        };
        if !allowed(&current_status, new_status) {
            return Err(CoreError::Validation {
                field: "item_status",
                message: format!(
                    "invalid KDS line item status transition: {current_status} -> {new_status}"
                ),
            });
        }

        let now = chrono::Utc::now()
            .format("%Y-%m-%dT%H:%M:%S%.3fZ")
            .to_string();

        let timestamp_col = match new_status {
            "preparing" => "started_at",
            "ready" => "ready_at",
            "served" => "served_at",
            _ => "",
        };

        let rows = if timestamp_col.is_empty() {
            self.conn.execute(
                "UPDATE kds_line_items SET item_status = ?1 WHERE id = ?2",
                params![new_status, item_id],
            )?
        } else {
            let sql = format!(
                "UPDATE kds_line_items SET item_status = ?1, {timestamp_col} = ?2 WHERE id = ?3"
            );
            self.conn.execute(&sql, params![new_status, now, item_id])?
        };

        if rows == 0 {
            return Err(CoreError::NotFound {
                entity: "kds_line_item",
                id: item_id.to_owned(),
            });
        }

        let mut stmt = self.conn.prepare(
            "SELECT id, kds_order_id, sku, display_name, qty, course, modifiers_json,
                    line_position, item_status, started_at, ready_at, served_at, created_at
             FROM kds_line_items WHERE id = ?1",
        )?;
        let result = stmt.query_row(params![item_id], Self::row_to_kds_line_item);
        match result {
            Ok(item) => Ok(item),
            Err(rusqlite::Error::QueryReturnedNoRows) => Err(CoreError::NotFound {
                entity: "kds_line_item",
                id: item_id.to_owned(),
            }),
            Err(e) => Err(e.into()),
        }
    }

    /// Derive the flat items_summary and item_count from structured line items.
    pub fn derive_kds_summary(items: &[CreateKdsLineItemInput]) -> (String, i64) {
        let summary = items
            .iter()
            .map(|i| {
                if i.qty > 1 {
                    format!("{} x{}", i.display_name, i.qty)
                } else {
                    i.display_name.clone()
                }
            })
            .collect::<Vec<_>>()
            .join(", ");
        let count: i64 = items.iter().map(|i| i.qty).sum();
        (summary, count)
    }
}
