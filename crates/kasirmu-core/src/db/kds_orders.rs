//! KDS order lifecycle - creation, queries, and status/item updates.
//!
//! Key functions: create_kds_order (plus routed/fanout variants),
//! list_kds_orders(+_for_instance), instance-visibility filtering,
//! get_kds_order(+_by_sale), update_kds_order_items, update_kds_status,
//! and the queue getters.
//!
//! Invariants: creation cores shared with the fanout path live in the
//! parent module (private visibility reaches all child parts); fanout
//! tickets are normalized via kds_order_targets so each zone gets
//! exactly one ticket; instance scoping is defense-in-depth.

use crate::db::Store;
use crate::error::CoreError;
use crate::{CreateKdsOrderInput, KdsOrder, KdsStatus};
use rusqlite::params;

impl Store<'_> {
    /// Create a KDS order from input, auto-incrementing the display number per day.
    pub fn create_kds_order(&self, input: CreateKdsOrderInput) -> Result<KdsOrder, CoreError> {
        self.create_kds_order_with_target(input, None)
    }

    /// Create a KDS order and persist the topology-selected target instance.
    pub fn create_kds_order_routed(
        &self,
        input: CreateKdsOrderInput,
        target_instance_id: Option<&str>,
    ) -> Result<KdsOrder, CoreError> {
        let targets = target_instance_id
            .map(str::to_owned)
            .into_iter()
            .collect::<Vec<_>>();
        self.create_kds_order_fanout(input, &targets)
    }

    /// Create one KDS order and attach zero or more delivery targets.
    ///
    /// The order remains unique per sale/zone; fan-out is represented by the
    /// normalized `kds_order_targets` table rather than duplicate orders.
    pub fn create_kds_order_fanout(
        &self,
        input: CreateKdsOrderInput,
        target_instance_ids: &[String],
    ) -> Result<KdsOrder, CoreError> {
        let tx = self.conn.unchecked_transaction()?;
        let order = self.create_kds_order_fanout_in_tx(&tx, input, target_instance_ids)?;
        tx.commit()?;
        Ok(order)
    }

    /// List KDS orders, optionally filtered by status. Ordered by received_at DESC.
    pub fn list_kds_orders(&self, status_filter: Option<&str>) -> Result<Vec<KdsOrder>, CoreError> {
        let mut sql = String::from(
            "SELECT id, sale_id, store_id, target_instance_id, status, items_summary, item_count, display_number,
                    received_at, started_at, ready_at, served_at,
                    prep_time_seconds, kitchen_zone, notes, table_number, priority, ticket_prefix
             FROM kds_orders",
        );
        let params: Vec<Box<dyn rusqlite::types::ToSql>> = if let Some(s) = status_filter {
            sql.push_str(" WHERE status = ?1");
            vec![Box::new(s.to_owned())]
        } else {
            vec![]
        };
        sql.push_str(" ORDER BY received_at DESC");

        let mut stmt = self.conn.prepare(&sql)?;
        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            params.iter().map(|p| p.as_ref()).collect();
        let rows = stmt.query_map(param_refs.as_slice(), Self::row_to_kds_order)?;
        rows.map(|r| Ok(r?)).collect()
    }

    /// Visibility condition pushed into SQL (PERF-KDS-02).
    ///
    /// Mirrors [`Self::order_visible_to_instance`] exactly: an order is
    /// visible when it has NO targeting rows and is untargeted (legacy
    /// rows stay visible everywhere) or when an explicit target row names
    /// `instance_id`. Applied as a WHERE fragment so list/queue queries
    /// filter in one indexed pass instead of issuing per-order COUNT
    /// queries (the N+1).
    ///
    /// Returns a bare parenthesised condition with NO leading `WHERE` or
    /// `AND`, so a caller cannot depend on one existing. It previously
    /// began with `" AND ("`, which made `list_kds_orders_for_instance`
    /// emit `FROM kds_orders AND (...)` whenever `status_filter` was
    /// `None` — the default KDS listing call, so SQLite rejected it with
    /// `near "AND": syntax error` rather than returning unfiltered rows.
    /// Callers now join their conditions into a single `WHERE`.
    fn instance_visibility_condition_sql() -> &'static str {
        "(
            (
                NOT EXISTS (
                    SELECT 1 FROM kds_order_targets t
                    WHERE t.kds_order_id = kds_orders.id
                )
                AND (
                    kds_orders.target_instance_id IS NULL
                    OR kds_orders.target_instance_id = :iid
                )
            )
            OR EXISTS (
                SELECT 1 FROM kds_order_targets t2
                WHERE t2.kds_order_id = kds_orders.id
                  AND t2.target_instance_id = :iid
            )
        )"
    }

    /// List orders visible to one KDS workspace instance.
    ///
    /// Legacy orders without a target remain visible to every instance.
    /// Instance filtering happens in SQL (PERF-KDS-02), not per row.
    pub fn list_kds_orders_for_instance(
        &self,
        status_filter: Option<&str>,
        instance_id: &str,
    ) -> Result<Vec<KdsOrder>, CoreError> {
        let mut conditions: Vec<&str> = Vec::new();
        if status_filter.is_some() {
            conditions.push("status = :status");
        }
        conditions.push(Self::instance_visibility_condition_sql());
        let mut sql = String::from(
            "SELECT id, sale_id, store_id, target_instance_id, status, items_summary, item_count, display_number,
                    received_at, started_at, ready_at, served_at,
                    prep_time_seconds, kitchen_zone, notes, table_number, priority, ticket_prefix
             FROM kds_orders",
        );
        sql.push_str(" WHERE ");
        sql.push_str(&conditions.join(" AND"));
        sql.push_str(" ORDER BY received_at DESC");

        // Bind only parameters the assembled SQL actually references —
        // rusqlite rejects a bound name the statement does not contain.
        let status_param: Option<&str> = status_filter;
        let mut binds: Vec<(&str, &dyn rusqlite::types::ToSql)> = vec![(":iid", &instance_id)];
        if let Some(s) = &status_param {
            binds.push((":status", s));
        }

        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map(binds.as_slice(), Self::row_to_kds_order)?;
        rows.map(|r| Ok(r?)).collect()
    }

    /// Return an order only when it is visible to the requested KDS instance.
    ///
    /// A targeted order is hidden from every other instance, including direct
    /// lookups; legacy untargeted orders remain visible for compatibility.
    pub fn get_kds_order_for_instance(
        &self,
        id: &str,
        instance_id: &str,
    ) -> Result<Option<KdsOrder>, CoreError> {
        let Some(order) = self.get_kds_order(id)? else {
            return Ok(None);
        };
        Ok(self
            .order_visible_to_instance(&order, instance_id)?
            .then_some(order))
    }

    /// Require that a KDS order belongs to the current instance.
    ///
    /// Inaccessible orders deliberately return `NotFound` rather than an
    /// authorization detail so a direct IPC caller cannot probe another
    /// display's ticket IDs.
    pub fn ensure_kds_order_visible_to_instance(
        &self,
        id: &str,
        instance_id: &str,
    ) -> Result<(), CoreError> {
        if self.get_kds_order_for_instance(id, instance_id)?.is_some() {
            Ok(())
        } else {
            Err(CoreError::NotFound {
                entity: "kds_order",
                id: id.to_owned(),
            })
        }
    }

    fn order_visible_to_instance(
        &self,
        order: &KdsOrder,
        instance_id: &str,
    ) -> Result<bool, CoreError> {
        let target_count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM kds_order_targets WHERE kds_order_id = ?1",
            params![order.id],
            |row| row.get(0),
        )?;
        if target_count > 0 {
            let matching_target: i64 = self.conn.query_row(
                "SELECT COUNT(*) FROM kds_order_targets WHERE kds_order_id = ?1 AND target_instance_id = ?2",
                params![order.id, instance_id],
                |row| row.get(0),
            )?;
            return Ok(matching_target > 0);
        }
        Ok(order
            .target_instance_id
            .as_deref()
            .is_none_or(|target| target == instance_id))
    }

    /// Get a single KDS order by its id.
    pub fn get_kds_order(&self, id: &str) -> Result<Option<KdsOrder>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, sale_id, store_id, target_instance_id, status, items_summary, item_count, display_number,
                    received_at, started_at, ready_at, served_at,
                    prep_time_seconds, kitchen_zone, notes, table_number, priority, ticket_prefix
             FROM kds_orders WHERE id = ?1",
        )?;
        let result = stmt.query_row(params![id], Self::row_to_kds_order);
        match result {
            Ok(order) => Ok(Some(order)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// Get the KDS orders originating from one sale (one per kitchen zone
    /// when the sale's items span multiple zones).
    pub fn get_kds_orders_by_sale(&self, sale_id: &str) -> Result<Vec<KdsOrder>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, sale_id, store_id, target_instance_id, status, items_summary, item_count, display_number,
                    received_at, started_at, ready_at, served_at,
                    prep_time_seconds, kitchen_zone, notes, table_number, priority, ticket_prefix
             FROM kds_orders WHERE sale_id = ?1",
        )?;
        let rows = stmt.query_map(params![sale_id], Self::row_to_kds_order)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    /// Update the items (summary + count) on an existing KDS order.
    ///
    /// Used when FOH adds items to an order mid-preparation, or when
    /// kitchen staff correct the items shown on a ticket.
    ///
    /// When `input.line_items` is `Some`, the existing kds_line_items
    /// for this order are deleted and replaced with the new ones, and
    /// the summary/count are re-derived from the structured data.
    /// Update an order only when it belongs to the current KDS instance.
    pub fn update_kds_order_items_for_instance(
        &self,
        input: crate::UpdateKdsOrderItemsInput,
        instance_id: &str,
    ) -> Result<KdsOrder, CoreError> {
        self.ensure_kds_order_visible_to_instance(&input.id, instance_id)?;
        self.update_kds_order_items(input)
    }

    /// Update an order status only when it belongs to the current KDS instance.
    pub fn update_kds_status_for_instance(
        &self,
        id: &str,
        new_status: &str,
        instance_id: &str,
    ) -> Result<KdsOrder, CoreError> {
        self.ensure_kds_order_visible_to_instance(id, instance_id)?;
        self.update_kds_status(id, new_status)
    }

    /// Update an order's summary and optionally replace its structured line items.
    ///
    /// When `line_items` are replaced, the per-item workflow state is
    /// PRESERVED: incoming items are matched against existing rows by
    /// `(sku, course)` and inherit the matched item's status and
    /// timestamps, so adding items mid-preparation no longer resets the
    /// kitchen's progress. Unmatched (new) items start `pending`.
    pub fn update_kds_order_items(
        &self,
        input: crate::UpdateKdsOrderItemsInput,
    ) -> Result<KdsOrder, CoreError> {
        // ── Resolve final summary/count ────────────────────────────
        let (final_summary, final_count) = if let Some(ref line_items) = input.line_items {
            if line_items.is_empty() {
                return Err(CoreError::Validation {
                    field: "line_items",
                    message: "line_items must not be empty when provided".into(),
                });
            }
            Store::derive_kds_summary(line_items)
        } else {
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
            (input.items_summary.clone(), input.item_count)
        };

        let tx = self.conn.unchecked_transaction()?;

        // ── Replace line items when provided (status-preserving) ───
        if let Some(ref line_items) = input.line_items {
            type LineItemStateTuple = (String, Option<String>, Option<String>, Option<String>);
            // Capture the current per-line workflow state keyed by
            // (sku, course), consuming matches FIFO in position order.
            let mut old_states: std::collections::HashMap<
                (String, Option<String>),
                std::collections::VecDeque<LineItemStateTuple>,
            > = Default::default();
            {
                let mut stmt = tx.prepare(
                    "SELECT sku, course, item_status, started_at, ready_at, served_at
                     FROM kds_line_items
                     WHERE kds_order_id = ?1
                     ORDER BY line_position",
                )?;
                let mut rows = stmt.query(params![input.id])?;
                while let Some(row) = rows.next()? {
                    let sku: String = row.get(0)?;
                    let course: Option<String> = row.get(1)?;
                    let state = (
                        row.get::<_, String>(2)?,
                        row.get::<_, Option<String>>(3)?,
                        row.get::<_, Option<String>>(4)?,
                        row.get::<_, Option<String>>(5)?,
                    );
                    old_states
                        .entry((sku, course))
                        .or_default()
                        .push_back(state);
                }
            }
            let carry: Vec<Option<LineItemStateTuple>> = line_items
                .iter()
                .map(|item| {
                    old_states
                        .get_mut(&(item.sku.clone(), item.course.clone()))
                        .and_then(|q| q.pop_front())
                })
                .collect();

            tx.execute(
                "DELETE FROM kds_line_items WHERE kds_order_id = ?1",
                rusqlite::params![input.id],
            )?;
            let inserted = self.create_kds_line_items_in_tx(&tx, &input.id, line_items)?;
            for (row, state) in inserted.iter().zip(&carry) {
                if let Some((status, started, ready, served)) = state {
                    tx.execute(
                        "UPDATE kds_line_items
                         SET item_status = ?1, started_at = ?2, ready_at = ?3, served_at = ?4
                         WHERE id = ?5",
                        params![status, started, ready, served, row.id],
                    )?;
                }
            }
        }

        tx.execute(
            "UPDATE kds_orders SET items_summary = ?1, item_count = ?2 WHERE id = ?3",
            rusqlite::params![final_summary, final_count, input.id],
        )?;

        tx.commit()?;

        self.get_kds_order(&input.id)?
            .ok_or_else(|| CoreError::NotFound {
                entity: "kds_order",
                id: input.id,
            })
    }

    /// Update the status of a KDS order. Automatically sets the corresponding
    /// timestamp field (started_at, ready_at, served_at) based on the new status.
    ///
    /// Transitions are FORWARD-ONLY: `pending → preparing → ready → served`,
    /// plus `cancelled` from any non-terminal state. A regression (e.g. a
    /// stale offline replay moving a served order back to preparing) is
    /// rejected with a `Validation` error so ticket timestamps and the
    /// kitchen queue are never corrupted. `served` and `cancelled` are
    /// terminal. Reaching `served` computes `prep_time_seconds`
    /// (`served_at − started_at`).
    pub fn update_kds_status(&self, id: &str, new_status: &str) -> Result<KdsOrder, CoreError> {
        let valid = KdsStatus::from_str(new_status).is_some();
        if !valid {
            return Err(CoreError::Validation {
                field: "status",
                message: format!("invalid KDS status: {new_status}"),
            });
        }

        // ── State machine: reject regressions + transitions from terminal
        //    states before touching any row (no partial writes).
        let current = self.get_kds_order(id)?.ok_or_else(|| CoreError::NotFound {
            entity: "kds_order",
            id: id.to_owned(),
        })?;
        let allowed = |from: &str, to: &str| match (from, to) {
            // Forward progression.
            ("pending", "preparing") | ("preparing", "ready") | ("ready", "served") => true,
            // Cancellation from any active state.
            ("pending", "cancelled") | ("preparing", "cancelled") | ("ready", "cancelled") => true,
            // No-op (idempotent replay of the current state).
            (from, to) if from == to => true,
            // Everything else (regressions, terminal-state moves) is invalid.
            _ => false,
        };
        if !allowed(&current.status, new_status) {
            return Err(CoreError::Validation {
                field: "status",
                message: format!(
                    "invalid KDS status transition: {} -> {new_status}",
                    current.status
                ),
            });
        }

        // Same-state replay is a true no-op: re-writing the row would
        // overwrite the workflow timestamp (e.g. a re-fired auto-ack or a
        // duplicate offline replay resetting `started_at`) and silently
        // restart the prep timer the board displays.
        if current.status == new_status {
            return Ok(current);
        }

        let now = chrono::Utc::now()
            .format("%Y-%m-%dT%H:%M:%S%.3fZ")
            .to_string();

        // Compute prep time when the ticket is served: served_at - started_at.
        let prep_time = if new_status == "served" {
            match (current.started_at.as_deref(), Some(now.as_str())) {
                (Some(started), Some(served)) => {
                    let parse = |ts: &str| {
                        chrono::DateTime::parse_from_rfc3339(ts)
                            .map(|dt| dt.with_timezone(&chrono::Utc))
                            .ok()
                    };
                    match (parse(started), parse(served)) {
                        (Some(start), Some(served_dt)) => {
                            let secs = served_dt.signed_duration_since(start).num_seconds();
                            std::cmp::max(0, secs)
                        }
                        _ => current.prep_time_seconds,
                    }
                }
                _ => current.prep_time_seconds,
            }
        } else {
            current.prep_time_seconds
        };

        let timestamp_col = match new_status {
            "preparing" => "started_at",
            "ready" => "ready_at",
            "served" => "served_at",
            _ => "",
        };

        if timestamp_col.is_empty() {
            self.conn.execute(
                "UPDATE kds_orders SET status = ?1, prep_time_seconds = ?2 WHERE id = ?3",
                params![new_status, prep_time, id],
            )?;
        } else {
            let sql = format!(
                "UPDATE kds_orders SET status = ?1, {timestamp_col} = ?2, prep_time_seconds = ?3 WHERE id = ?4"
            );
            self.conn
                .execute(&sql, params![new_status, now, prep_time, id])?;
        }

        self.get_kds_order(id)?.ok_or_else(|| CoreError::NotFound {
            entity: "kds_order",
            id: id.to_owned(),
        })
    }

    /// Get the kitchen queue: orders with status 'pending', 'preparing', or 'ready',
    /// ordered by status priority then received_at ASC (oldest first).
    ///
    /// When `zone_filter` is `Some(zone)`, only orders with that `kitchen_zone`
    /// value are returned. Pass `Some("")` to match orders with no zone assigned.
    /// When `None`, all orders are returned (no zone filtering).
    pub fn get_kds_queue(&self, zone_filter: Option<&str>) -> Result<Vec<KdsOrder>, CoreError> {
        let mut sql = String::from(
            "SELECT id, sale_id, store_id, target_instance_id, status, items_summary, item_count, display_number,
                    received_at, started_at, ready_at, served_at,
                    prep_time_seconds, kitchen_zone, notes, table_number, priority, ticket_prefix
             FROM kds_orders
             WHERE status IN ('pending', 'preparing', 'ready')",
        );

        let params: Vec<Box<dyn rusqlite::types::ToSql>> = if let Some(zone) = zone_filter {
            if zone.is_empty() {
                sql.push_str(" AND (kitchen_zone IS NULL OR kitchen_zone = '')");
                vec![]
            } else {
                sql.push_str(" AND kitchen_zone = ?1");
                vec![Box::new(zone.to_owned())]
            }
        } else {
            vec![]
        };

        sql.push_str(
            " ORDER BY
                CASE status
                    WHEN 'pending' THEN 1
                    WHEN 'preparing' THEN 2
                    WHEN 'ready' THEN 3
                END,
                received_at ASC",
        );

        let mut stmt = self.conn.prepare(&sql)?;
        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            params.iter().map(|p| p.as_ref()).collect();
        let rows = stmt.query_map(param_refs.as_slice(), Self::row_to_kds_order)?;
        rows.map(|r| Ok(r?)).collect()
    }

    /// Get the active queue visible to one KDS workspace instance.
    ///
    /// Instance filtering happens in SQL (PERF-KDS-02), not per row.
    pub fn get_kds_queue_for_instance(
        &self,
        zone_filter: Option<&str>,
        instance_id: &str,
    ) -> Result<Vec<KdsOrder>, CoreError> {
        let mut sql = String::from(
            "SELECT id, sale_id, store_id, target_instance_id, status, items_summary, item_count, display_number,
                    received_at, started_at, ready_at, served_at,
                    prep_time_seconds, kitchen_zone, notes, table_number, priority, ticket_prefix
             FROM kds_orders
             WHERE status IN ('pending', 'preparing', 'ready')",
        );

        // Zone parameter is only pushed into SQL when that branch is
        // active; binding names the statement does not contain is an error
        // in rusqlite, so the bind list is assembled to match the SQL.
        let zone_param: Option<String> = match zone_filter {
            None => None,
            Some("") => {
                sql.push_str(" AND (kitchen_zone IS NULL OR kitchen_zone = '')");
                None
            }
            Some(zone) => {
                sql.push_str(" AND kitchen_zone = :zone");
                Some(zone.to_owned())
            }
        };
        // The queue always opens with `WHERE status IN (...)`, so the
        // connector lives here rather than inside the condition: the
        // condition helper returns a bare fragment precisely so no caller
        // can inherit the bug that ` AND (`-prefixed text caused in
        // `list_kds_orders_for_instance`.
        sql.push_str(" AND ");
        sql.push_str(Self::instance_visibility_condition_sql());
        sql.push_str(
            " ORDER BY
                CASE status
                    WHEN 'pending' THEN 1
                    WHEN 'preparing' THEN 2
                    WHEN 'ready' THEN 3
                END,
                received_at ASC",
        );

        let mut binds: Vec<(&str, &dyn rusqlite::types::ToSql)> = vec![(":iid", &instance_id)];
        if let Some(zone) = &zone_param {
            binds.push((":zone", zone));
        }

        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map(binds.as_slice(), Self::row_to_kds_order)?;
        rows.map(|r| Ok(r?)).collect()
    }

    /// Cancel every active KDS ticket belonging to a sale (S3 lifecycle).
    ///
    /// Called when a sale is voided or refunded so voided tickets cannot
    /// linger on the kitchen board. Targets only `pending`/`preparing`/
    /// `ready` tickets — `served` food was eaten and `cancelled` is
    /// already terminal. `started_at` is preserved (real prep time was
    /// spent); `served_at`/`prep_time_seconds` are untouched. Line items
    /// of the cancelled tickets follow their parent to `cancelled`.
    ///
    /// Runs inside the caller's transaction (the void/refund flow) so the
    /// sale-state change and the ticket cancellation commit atomically.
    /// Returns the number of tickets cancelled.
    pub fn cancel_kds_orders_for_sale_in_tx(
        &self,
        tx: &rusqlite::Transaction<'_>,
        sale_id: &str,
    ) -> Result<usize, CoreError> {
        let cancelled = tx.execute(
            "UPDATE kds_orders
             SET status = 'cancelled'
             WHERE sale_id = ?1
               AND status IN ('pending', 'preparing', 'ready')",
            params![sale_id],
        )?;
        if cancelled == 0 {
            return Ok(0);
        }
        tx.execute(
            "UPDATE kds_line_items
             SET item_status = 'cancelled'
             WHERE kds_order_id IN (SELECT id FROM kds_orders WHERE sale_id = ?1)
               AND item_status IN ('pending', 'preparing', 'ready')",
            params![sale_id],
        )?;
        Ok(cancelled)
    }
}
