//! KDS (Kitchen Display System) CRUD - order ticket lifecycle.
//!
//! F-011 split: the impl-Store groups moved to sibling part modules
//! (kds_orders, kds_lines, kds_devices, kds_ops), declared below; the
//! crate public API and every downstream path are unchanged. The parent
//! keeps the shared transactional creation cores and row mappers that
//! more than one part calls (private visibility reaches all children).
//!
//! Invariants: order-line transitions are enforced by an explicit
//! allowed() state machine; pairing tokens are stored hashed; fanout
//! tickets are normalized via kds_order_targets (no duplicates).

/*
last audited 25-07-26 by RSA-Agent (oz-core slice B final: kds deep read)
crate: oz-core | status: SAFE | lint: CLEAN
findings: clean — both format!-SQL sites interpolate only match-derived internal timestamp columns (verified injection-safe, closes B5-part-6 flag); line-item transitions enforced by an explicit allowed() state machine (order-level updates lack the same machine — INFO, frontend-driven fixed set); pairing tokens stored hashed; prep_time clamped >=0; fanout normalized via kds_order_targets (no duplicate tickets); stale devices auto-deactivated with logging
next: consider order-level transition validation | perf: queue filter in Rust post-query, fine at KDS scale
*/

use crate::db::Store;
use crate::error::CoreError;
use crate::{CreateKdsLineItemInput, CreateKdsOrderInput, KdsLineItem, KdsModifier, KdsOrder};
use rusqlite::params;

// F-011 split: cohesive impl-Store groups moved to sibling part files;
// child-module wiring below keeps every downstream path unchanged.
#[path = "kds_orders.rs"]
mod kds_orders;

#[path = "kds_lines.rs"]
mod kds_lines;

#[path = "kds_devices.rs"]
mod kds_devices;

#[path = "kds_ops.rs"]
mod kds_ops;

// Shared transactional creation cores and row mappers used by more than
// one part module stay in the parent; private items here remain visible
// to every child part (visibility semantics unchanged).
impl Store<'_> {
    fn row_to_kds_order(row: &rusqlite::Row) -> rusqlite::Result<KdsOrder> {
        Ok(KdsOrder {
            id: row.get("id")?,
            sale_id: row.get("sale_id")?,
            store_id: row.get("store_id")?,
            target_instance_id: row.get("target_instance_id")?,
            status: row.get("status")?,
            items_summary: row.get("items_summary")?,
            item_count: row.get("item_count")?,
            display_number: row.get("display_number")?,
            received_at: row.get("received_at")?,
            started_at: row.get("started_at")?,
            ready_at: row.get("ready_at")?,
            served_at: row.get("served_at")?,
            prep_time_seconds: row.get("prep_time_seconds")?,
            kitchen_zone: row.get("kitchen_zone")?,
            notes: row.get("notes")?,
            table_number: row.get("table_number")?,
            priority: row.get::<_, i64>("priority")? != 0,
        })
    }

    /// Same as [`Store::create_kds_order_fanout`] but inside a caller-owned
    /// transaction, so a multi-zone fanout commits atomically (a failure on
    /// one zone rolls back the whole set instead of leaving partial tickets).
    fn create_kds_order_fanout_in_tx(
        &self,
        tx: &rusqlite::Transaction<'_>,
        input: CreateKdsOrderInput,
        target_instance_ids: &[String],
    ) -> Result<KdsOrder, CoreError> {
        let primary_target = target_instance_ids.first().map(String::as_str);
        let order = self.create_kds_order_with_target_in_tx(tx, input, primary_target)?;
        for target_instance_id in target_instance_ids {
            tx.execute(
                "INSERT OR IGNORE INTO kds_order_targets (kds_order_id, target_instance_id) VALUES (?1, ?2)",
                params![order.id, target_instance_id],
            )?;
        }
        Ok(order)
    }

    fn create_kds_order_with_target(
        &self,
        input: CreateKdsOrderInput,
        target_instance_id: Option<&str>,
    ) -> Result<KdsOrder, CoreError> {
        let tx = self.conn.unchecked_transaction()?;
        let order = self.create_kds_order_with_target_in_tx(&tx, input, target_instance_id)?;
        tx.commit()?;
        Ok(order)
    }

    fn create_kds_order_with_target_in_tx(
        &self,
        tx: &rusqlite::Transaction<'_>,
        input: CreateKdsOrderInput,
        target_instance_id: Option<&str>,
    ) -> Result<KdsOrder, CoreError> {
        if input.sale_id.trim().is_empty() {
            return Err(CoreError::Validation {
                field: "sale_id",
                message: "sale_id must not be empty".into(),
            });
        }
        if input.items_summary.trim().is_empty() {
            return Err(CoreError::Validation {
                field: "items_summary",
                message: "items_summary must not be empty".into(),
            });
        }
        if input.item_count <= 0 {
            return Err(CoreError::Validation {
                field: "item_count",
                message: "item_count must be positive".into(),
            });
        }

        let id = uuid::Uuid::now_v7().to_string();
        // REP-03: the daily counter rolls over on the STORE-LOCAL day, not
        // UTC — a UTC+7 kitchen would otherwise reset its ticket numbers at
        // 07:00 local. Reuses the validated fixed-offset contract shared by
        // every date-bucketed query (falls back to UTC when the store has
        // no primary profile or an IANA name core cannot interpret).
        let tz = self.tz_modifier();
        let today: String = self.conn.query_row(
            &format!("SELECT strftime('%Y-%m-%d', 'now', '{tz}')"),
            [],
            |row| row.get(0),
        )?;
        let store_key = input.store_id.as_deref().unwrap_or("");

        // Upsert the daily counter, keyed by (date, store) so each store's
        // tickets start at #1 daily. '' = legacy single-store rows.
        tx.execute(
            "INSERT INTO kds_daily_counters (date, store_id, counter) VALUES (?1, ?2, 1)
             ON CONFLICT(date, store_id) DO UPDATE SET counter = counter + 1",
            params![today, store_key],
        )?;

        // Read back the counter.
        let display_number: i64 = tx.query_row(
            "SELECT counter FROM kds_daily_counters WHERE date = ?1 AND store_id = ?2",
            params![today, store_key],
            |row| row.get(0),
        )?;

        let now = chrono::Utc::now()
            .format("%Y-%m-%dT%H:%M:%S%.3fZ")
            .to_string();

        // W2-A: the prefix is a fact ABOUT THIS TICKET, not a display-time
        // lookup. `locations.ticket_prefix` is the config; a chit already in the
        // kitchen tray must keep the label it was given, so the value in force
        // now is copied onto the row - the same reason display_number below is
        // a frozen counter read rather than a re-derived one (D16). Read through
        // the landed getter INSIDE this transaction: the prefix a ticket gets is
        // the one the same tx would have written. No store id (legacy single-
        // store callers) means no prefix: there is no location to ask, and
        // guessing the primary would relabel tickets for another branch.
        let ticket_prefix = match input.store_id.as_deref() {
            Some(store_id) => self.location_ticket_prefix(store_id)?.unwrap_or_default(),
            None => String::new(),
        };
        tx.execute(
            "INSERT INTO kds_orders (id, sale_id, store_id, target_instance_id, status, items_summary, item_count,
                                     display_number, received_at, kitchen_zone, notes, table_number, priority, ticket_prefix)
             VALUES (?1, ?2, ?3, ?4, 'pending', ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                id,
                input.sale_id,
                input.store_id,
                target_instance_id,
                input.items_summary,
                input.item_count,
                display_number,
                now,
                input.kitchen_zone,
                input.notes,
                input.table_number,
                input.priority,
                ticket_prefix,
            ],
        )?;

        // Read back (within the caller's transaction so the whole fanout
        // commits atomically).
        let mut stmt = tx.prepare(
            "SELECT id, sale_id, store_id, target_instance_id, status, items_summary, item_count, display_number,
                    received_at, started_at, ready_at, served_at,
                    prep_time_seconds, kitchen_zone, notes, table_number, priority
             FROM kds_orders WHERE id = ?1",
        )?;
        let order = stmt.query_row(params![id], Self::row_to_kds_order)?;
        Ok(order)
    }

    fn row_to_kds_line_item(row: &rusqlite::Row) -> rusqlite::Result<KdsLineItem> {
        let modifiers_json: Option<String> = row.get("modifiers_json")?;
        let modifiers: Vec<KdsModifier> = match modifiers_json {
            Some(json) if !json.is_empty() => serde_json::from_str(&json).unwrap_or_default(),
            _ => vec![],
        };
        Ok(KdsLineItem {
            id: row.get("id")?,
            kds_order_id: row.get("kds_order_id")?,
            sku: row.get("sku")?,
            display_name: row.get("display_name")?,
            qty: row.get("qty")?,
            course: row.get("course")?,
            modifiers,
            line_position: row.get("line_position")?,
            item_status: row.get("item_status")?,
            started_at: row.get("started_at")?,
            ready_at: row.get("ready_at")?,
            served_at: row.get("served_at")?,
            created_at: row.get("created_at")?,
        })
    }

    /// Internal: Insert line items inside an existing transaction.
    ///
    /// Used by both `create_kds_line_items` (for initial creation) and
    /// `update_kds_order_items` (for replacement after deletion).
    fn create_kds_line_items_in_tx(
        &self,
        tx: &rusqlite::Transaction<'_>,
        order_id: &str,
        items: &[CreateKdsLineItemInput],
    ) -> Result<Vec<KdsLineItem>, CoreError> {
        if items.is_empty() {
            return Ok(vec![]);
        }
        let now = chrono::Utc::now()
            .format("%Y-%m-%dT%H:%M:%S%.3fZ")
            .to_string();
        let mut ids = Vec::with_capacity(items.len());

        for (i, item) in items.iter().enumerate() {
            let id = uuid::Uuid::now_v7().to_string();
            let modifiers_json = if item.modifiers.is_empty() {
                None
            } else {
                Some(
                    serde_json::to_string(&item.modifiers).map_err(|e| CoreError::Validation {
                        field: "modifiers",
                        message: format!("serializing modifiers: {e}"),
                    })?,
                )
            };
            tx.execute(
                "INSERT INTO kds_line_items
                    (id, kds_order_id, sku, display_name, qty, course, modifiers_json,
                     line_position, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    id,
                    order_id,
                    item.sku,
                    item.display_name,
                    item.qty,
                    item.course,
                    modifiers_json,
                    i as i64,
                    now,
                ],
            )?;
            ids.push(id);
        }

        // Read back the inserted items.
        let placeholders: Vec<String> = (0..ids.len()).map(|_| "?".to_string()).collect();
        let sql = format!(
            "SELECT id, kds_order_id, sku, display_name, qty, course, modifiers_json,
                    line_position, item_status, started_at, ready_at, served_at, created_at
             FROM kds_line_items WHERE id IN ({})
             ORDER BY line_position",
            placeholders.join(",")
        );
        let mut stmt = tx.prepare(&sql)?;
        let params_refs: Vec<&dyn rusqlite::types::ToSql> = ids
            .iter()
            .map(|s| s as &dyn rusqlite::types::ToSql)
            .collect();
        let rows = stmt.query_map(params_refs.as_slice(), Self::row_to_kds_line_item)?;
        rows.map(|r| Ok(r?)).collect()
    }
}

#[cfg(test)]
#[path = "kds_tests.rs"]
mod tests;
