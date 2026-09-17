//! Inventory management DB methods — locations CRUD, shifts, transaction logs, thresholds.
/*
last audited DD-MM-YY by DSH-Agent
crate: kasirmu-core (inventory) | status: SAFE | lint: CLEAN
findings: COR-11 FIXED DD-MM-YY — deactivate_inventory_location + shift-start guard queries now propagate DB errors (?) instead of unwrap_or(0), so a read error fails closed instead of satisfying the zero-stock/zero-transfer constraint. COR-13 INFO: read mappers coerce unknown stored enum values via from_stored_str().unwrap_or(ManualAdjustment) at 3 sites — misclassification risk for reports; positives: create_inventory_transaction writes header+lines+adjustments in ONE tx via the canonical adjust_stock_at_location_with_reason; set_stock_threshold distinguishes NoRows from real DB errors
next: none | perf: N/A
*/

use crate::downgrade::QuotaDimension;
use crate::error::CoreError;
use crate::subscription::SubscriptionTier;
use crate::{
    InventoryLocation, InventoryShift, InventoryTransaction, InventoryTransactionLine,
    StockThreshold, Store, WorkspaceInventoryLocation,
};
use rusqlite::params;

/// Input structure for adding lines to a transaction.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct InventoryTransactionLineInput {
    /// Product SKU.
    pub sku: String,
    /// Product Name.
    pub product_name: String,
    /// Positive magnitude of change.
    pub qty: i64,
    /// Signed delta adjustment.
    pub delta: i64,
    /// Optional barcode value scanned.
    pub barcode_scanned: Option<String>,
}

impl Store<'_> {
    // ── Locations CRUD ──────────────────────────────────────────────────

    /// Count active warehouse-type inventory locations.
    pub fn count_warehouse_locations(&self) -> Result<i64, CoreError> {
        let count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM inventory_locations WHERE type = 'warehouse' AND is_active = 1",
            [],
            |row| row.get(0),
        )?;
        Ok(count)
    }

    /// Enforce the subscription tier's warehouse limit before creating
    /// a new warehouse-type inventory location.
    ///
    /// Only fires for `type = "warehouse"` — store, transit, damaged,
    /// and virtual locations are not warehouse-counted.
    pub fn enforce_warehouse_quota(
        &self,
        tier: &SubscriptionTier,
        location_type: &str,
    ) -> Result<(), CoreError> {
        if location_type != "warehouse" {
            return Ok(());
        }
        // W4-S1: decision centralized in `quota_gate`; same limit source
        // (`max_warehouses`), same active-warehouse count, same
        // `WarehouseLimit` error.
        self.enforce_creation_quota(QuotaDimension::Warehouses, tier)
    }

    /// Create a new inventory location.
    pub fn create_inventory_location(
        &self,
        name: &str,
        location_type: &str,
        description: &str,
    ) -> Result<String, CoreError> {
        let id = uuid::Uuid::now_v7().to_string();
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

        // Validate name is not empty
        if name.trim().is_empty() {
            return Err(CoreError::Validation {
                field: "name",
                message: "location name must not be empty".into(),
            });
        }

        // Validate location type against allowed values
        match location_type {
            "store" | "warehouse" | "transit" | "damaged" | "virtual" => {}
            other => {
                return Err(CoreError::Validation {
                    field: "type",
                    message: format!("invalid location type: {}", other),
                });
            }
        }

        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "INSERT INTO inventory_locations (id, name, type, description, is_active, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5)",
            params![id, name, location_type, description, now],
        )?;
        // W7-B: mirror of the locations/products/staff veto (9264b8f67) —
        // post-insert, in-tx, on the same predicate the gate that armed it uses
        // (type = warehouse AND is_active = 1). Only a warehouse row may consume
        // the arm: a store/transit/damaged/virtual location must not be vetoed
        // against a cap that does not count it, and a Store armed for warehouses
        // that creates one of those leaves the arm in place for the next
        // warehouse create, exactly as before.
        let tier = if location_type == "warehouse" {
            self.take_armed_quota(QuotaDimension::Warehouses)
        } else {
            None
        };
        if let Some(limit) = tier
            .as_ref()
            .and_then(|t| QuotaDimension::Warehouses.limit_for(t))
        {
            let current: i64 = tx.query_row(
                "SELECT COUNT(*) FROM inventory_locations WHERE type = 'warehouse' AND is_active = 1",
                [],
                |r| r.get(0),
            )?;
            if current > limit {
                tx.rollback()?;
                return Err(crate::subscription::QuotaError::WarehouseLimit {
                    tier: tier.as_ref().map(|t| t.name().into()).unwrap_or_default(),
                    limit,
                    current: current - 1,
                }
                .into());
            }
        }
        tx.commit()?;

        Ok(id)
    }

    /// List all inventory locations (including inactive ones).
    pub fn list_inventory_locations(&self) -> Result<Vec<InventoryLocation>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, type, description, is_active, created_at, updated_at \
             FROM inventory_locations ORDER BY name ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            let active_int: i64 = row.get(4)?;
            Ok(InventoryLocation {
                id: row.get(0)?,
                name: row.get(1)?,
                location_type: row.get(2)?,
                description: row.get(3)?,
                is_active: active_int == 1,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })?;

        let mut locs = Vec::new();
        for r in rows {
            locs.push(r?);
        }
        Ok(locs)
    }

    /// Update an existing inventory location's details.
    pub fn update_inventory_location(
        &self,
        id: &str,
        name: &str,
        location_type: &str,
        description: &str,
    ) -> Result<(), CoreError> {
        // Validate name is not empty
        if name.trim().is_empty() {
            return Err(CoreError::Validation {
                field: "name",
                message: "location name must not be empty".into(),
            });
        }

        // Validate location type against allowed values
        match location_type {
            "store" | "warehouse" | "transit" | "damaged" | "virtual" => {}
            other => {
                return Err(CoreError::Validation {
                    field: "type",
                    message: format!("invalid location type: {}", other),
                });
            }
        }

        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let tx = self.conn.unchecked_transaction()?;
        let updated = tx.execute(
            "UPDATE inventory_locations SET name = ?1, type = ?2, description = ?3, updated_at = ?4 \
             WHERE id = ?5",
            params![name, location_type, description, now, id],
        )?;
        if updated == 0 {
            return Err(CoreError::NotFound {
                entity: "inventory_location",
                id: id.to_owned(),
            });
        }
        tx.commit()?;
        Ok(())
    }

    /// Deactivate an inventory location. Enforces constraints that the location
    /// must exist, be active, have a zero stock balance (positive or negative),
    /// and have no pending in-flight transfers.
    pub fn deactivate_inventory_location(&self, id: &str) -> Result<(), CoreError> {
        let tx = self.conn.unchecked_transaction()?;

        // Constraint 0: The location must exist and be active. A stale or
        // cross-workspace ID must not be reported as a successful no-op.
        let active_res = tx.query_row(
            "SELECT is_active FROM inventory_locations WHERE id = ?1",
            params![id],
            |row| row.get::<_, i64>(0),
        );
        let active = match active_res {
            Ok(v) => v,
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                return Err(CoreError::NotFound {
                    entity: "inventory_location",
                    id: id.to_owned(),
                });
            }
            Err(e) => return Err(CoreError::Db(e)),
        };
        if active == 0 {
            return Err(CoreError::Validation {
                field: "location",
                message: "location is already inactive".into(),
            });
        }

        // Constraint 1: Block deactivation when ANY balance is non-zero. A
        // negative balance would otherwise be hidden from active-location
        // workflows while its ledger still needs reconciliation.
        let stock_count: i64 = tx.query_row(
            "SELECT COUNT(*) FROM stock_summary WHERE location_id = ?1 AND qty <> 0",
            params![id],
            |row| row.get(0),
        )?;

        if stock_count > 0 {
            return Err(CoreError::Validation {
                field: "location",
                message: "cannot deactivate location with a non-zero stock balance".into(),
            });
        }

        // Constraint 2: Check that there are no in-flight (draft / pending / in_transit / received_partial) transfers involving this location
        let transfer_count: i64 = tx.query_row(
            "SELECT COUNT(*) FROM stock_transfers \
             WHERE (source_location_id = ?1 OR destination_location_id = ?1) \
             AND status IN ('draft', 'pending', 'in_transit', 'received_partial')",
            params![id],
            |row| row.get(0),
        )?;

        if transfer_count > 0 {
            return Err(CoreError::Validation {
                field: "location",
                message: "cannot deactivate location with pending stock transfers".into(),
            });
        }

        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        tx.execute(
            "UPDATE inventory_locations SET is_active = 0, updated_at = ?1 WHERE id = ?2",
            params![now, id],
        )?;
        tx.commit()?;
        Ok(())
    }

    // ── Workspace Locations ─────────────────────────────────────────────

    /// Set locations associated with a workspace instance, with priority and allowance settings.
    pub fn set_workspace_inventory_locations(
        &self,
        instance_id: &str,
        locations: &[WorkspaceInventoryLocation],
    ) -> Result<(), CoreError> {
        let tx = self.conn.unchecked_transaction()?;

        // Delete existing bindings
        tx.execute(
            "DELETE FROM workspace_inventory_locations WHERE instance_id = ?1",
            params![instance_id],
        )?;

        // Insert new bindings
        for loc in locations {
            let id = if loc.id.is_empty() {
                uuid::Uuid::now_v7().to_string()
            } else {
                loc.id.clone()
            };
            tx.execute(
                "INSERT INTO workspace_inventory_locations (id, instance_id, location_id, is_primary, allow_negative_stock, sort_order) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    id,
                    instance_id,
                    loc.location_id,
                    if loc.is_primary { 1 } else { 0 },
                    if loc.allow_negative_stock { 1 } else { 0 },
                    loc.sort_order
                ],
            )?;
        }

        tx.commit()?;
        Ok(())
    }

    /// Retrieve the locations associated with a workspace instance.
    pub fn get_workspace_inventory_locations(
        &self,
        instance_id: &str,
    ) -> Result<Vec<WorkspaceInventoryLocation>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, instance_id, location_id, is_primary, allow_negative_stock, sort_order \
             FROM workspace_inventory_locations WHERE instance_id = ?1 ORDER BY sort_order ASC",
        )?;
        let rows = stmt.query_map(params![instance_id], |row| {
            let prim_int: i64 = row.get(3)?;
            let neg_int: i64 = row.get(4)?;
            Ok(WorkspaceInventoryLocation {
                id: row.get(0)?,
                instance_id: row.get(1)?,
                location_id: row.get(2)?,
                is_primary: prim_int == 1,
                allow_negative_stock: neg_int == 1,
                sort_order: row.get(5)?,
            })
        })?;

        let mut locs = Vec::new();
        for r in rows {
            locs.push(r?);
        }
        Ok(locs)
    }

    // ── Inventory Shifts ────────────────────────────────────────────────

    /// Start a new inventory shift for a user at a location.
    /// Checks that the user does not already have an open shift at that location.
    pub fn start_inventory_shift(
        &self,
        user_id: &str,
        location_id: &str,
        terminal_id: Option<&str>,
        notes: &str,
    ) -> Result<InventoryShift, CoreError> {
        let tx = self.conn.unchecked_transaction()?;

        // Migration 086 permits one active shift per user/location pair.
        // Keep the application check aligned with that partial unique index;
        // a worker may legitimately work at two locations concurrently.
        let active_count: i64 = tx.query_row(
            "SELECT COUNT(*) FROM inventory_shifts
                 WHERE user_id = ?1 AND location_id = ?2 AND status = 'active'",
            params![user_id, location_id],
            |row| row.get(0),
        )?;

        if active_count > 0 {
            return Err(CoreError::Validation {
                field: "shift",
                message: "user already has an active inventory shift open at this location".into(),
            });
        }

        let id = uuid::Uuid::now_v7().to_string();
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

        tx.execute(
            "INSERT INTO inventory_shifts (id, user_id, location_id, terminal_id, started_at, ended_at, status, notes) \
             VALUES (?1, ?2, ?3, ?4, ?5, NULL, 'active', ?6)",
            params![id, user_id, location_id, terminal_id, now, notes],
        )?;

        tx.commit()?;

        Ok(InventoryShift {
            id,
            user_id: user_id.to_owned(),
            location_id: location_id.to_owned(),
            terminal_id: terminal_id.map(String::from),
            started_at: now,
            ended_at: None,
            status: "active".into(),
            notes: notes.to_owned(),
        })
    }

    /// Close an active inventory shift.
    pub fn end_inventory_shift(&self, shift_id: &str) -> Result<(), CoreError> {
        let tx = self.conn.unchecked_transaction()?;
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

        let updated = tx.execute(
            "UPDATE inventory_shifts SET ended_at = ?1, status = 'ended', updated_at = ?2 \
             WHERE id = ?3 AND status = 'active'",
            params![now, now, shift_id],
        )?;

        if updated == 0 {
            return Err(CoreError::NotFound {
                entity: "active_inventory_shift",
                id: shift_id.to_owned(),
            });
        }

        tx.commit()?;
        Ok(())
    }

    /// Retrieve the most recently started active shift for a user, if any.
    ///
    /// Multiple locations may be active concurrently under migration 086's
    /// per-user/location invariant. The existing IPC shape returns one
    /// optional shift, so the UI receives the latest one; history remains
    /// available through `list_inventory_shifts`.
    pub fn get_active_inventory_shift(
        &self,
        user_id: &str,
    ) -> Result<Option<InventoryShift>, CoreError> {
        let res = self.conn.query_row(
            "SELECT id, user_id, location_id, terminal_id, started_at, ended_at, status, notes \
             FROM inventory_shifts WHERE user_id = ?1 AND status = 'active'
             ORDER BY started_at DESC LIMIT 1",
            params![user_id],
            |row| {
                Ok(InventoryShift {
                    id: row.get(0)?,
                    user_id: row.get(1)?,
                    location_id: row.get(2)?,
                    terminal_id: row.get(3)?,
                    started_at: row.get(4)?,
                    ended_at: row.get(5)?,
                    status: row.get(6)?,
                    notes: row.get(7)?,
                })
            },
        );

        match res {
            Ok(shift) => Ok(Some(shift)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(CoreError::Db(e)),
        }
    }

    /// List all inventory shifts, ordered by started_at descending.
    pub fn list_inventory_shifts(&self) -> Result<Vec<InventoryShift>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, user_id, location_id, terminal_id, started_at, ended_at, status, notes \
             FROM inventory_shifts ORDER BY started_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(InventoryShift {
                id: row.get(0)?,
                user_id: row.get(1)?,
                location_id: row.get(2)?,
                terminal_id: row.get(3)?,
                started_at: row.get(4)?,
                ended_at: row.get(5)?,
                status: row.get(6)?,
                notes: row.get(7)?,
            })
        })?;

        let mut shifts = Vec::new();
        for r in rows {
            shifts.push(r?);
        }
        Ok(shifts)
    }

    // ── Inventory Transactions ──────────────────────────────────────────

    /// Create a new inventory transaction audit log session and execute adjustments.
    pub fn create_inventory_transaction(
        &self,
        transaction_type: crate::inventory_transaction::InventoryTransactionType,
        location_id: &str,
        staff_id: &str,
        notes: &str,
        lines: &[InventoryTransactionLineInput],
    ) -> Result<String, CoreError> {
        let tx = self.conn.unchecked_transaction()?;
        let id = uuid::Uuid::now_v7().to_string();
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

        // Insert transaction header
        tx.execute(
            "INSERT INTO inventory_transactions (id, type, location_id, staff_id, notes, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, transaction_type.as_stored_str(), location_id, staff_id, notes, now],
        )?;

        // Insert lines and adjust stock
        for (i, line) in lines.iter().enumerate() {
            let line_id = uuid::Uuid::now_v7().to_string();
            let sort_order = (i + 1) as i64;

            tx.execute(
                "INSERT INTO inventory_transaction_lines (id, transaction_id, sku, product_name, qty, barcode_scanned, sort_order) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![line_id, id, line.sku, line.product_name, line.qty, line.barcode_scanned, sort_order],
            )?;

            // Adjust stock
            let tx_id = crate::inventory_transaction::InventoryTransactionId::from(id.clone());
            let stf_id = crate::user::UserId::from(staff_id.to_owned());
            self.adjust_stock_at_location_with_reason(
                &tx,
                &line.sku,
                line.delta,
                &crate::inventory::LocationId::from(location_id),
                Some(transaction_type.as_stored_str()),
                Some(&tx_id),
                None, // terminal_id
                Some(&stf_id),
            )?;
        }

        tx.commit()?;
        Ok(id)
    }

    /// List all inventory transaction headers, sorted by created_at descending.
    pub fn list_inventory_transactions(&self) -> Result<Vec<InventoryTransaction>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, type, location_id, staff_id, transfer_id, purchase_order_id, notes, created_at \
             FROM inventory_transactions ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            let type_str: String = row.get(1)?;
            let ttype =
                crate::inventory_transaction::InventoryTransactionType::from_stored_str(&type_str)
                    .unwrap_or(
                        crate::inventory_transaction::InventoryTransactionType::ManualAdjustment,
                    );
            Ok(InventoryTransaction {
                id: crate::inventory_transaction::InventoryTransactionId::from(
                    row.get::<_, String>(0)?,
                ),
                transaction_type: ttype,
                location_id: row.get(2)?,
                staff_id: row.get(3)?,
                transfer_id: row.get(4)?,
                purchase_order_id: row.get(5)?,
                notes: row.get(6).unwrap_or_default(),
                created_at: row.get(7)?,
            })
        })?;

        let mut txs = Vec::new();
        for r in rows {
            txs.push(r?);
        }
        Ok(txs)
    }

    /// Retrieve a single transaction by ID and all of its details lines.
    pub fn get_inventory_transaction(
        &self,
        id: &str,
    ) -> Result<Option<(InventoryTransaction, Vec<InventoryTransactionLine>)>, CoreError> {
        let header_res = self.conn.query_row(
            "SELECT id, type, location_id, staff_id, transfer_id, purchase_order_id, notes, created_at \
             FROM inventory_transactions WHERE id = ?1",
            params![id],
            |row| {
                let type_str: String = row.get(1)?;
                let ttype = crate::inventory_transaction::InventoryTransactionType::from_stored_str(&type_str)
                    .unwrap_or(crate::inventory_transaction::InventoryTransactionType::ManualAdjustment);
                Ok(InventoryTransaction {
                    id: crate::inventory_transaction::InventoryTransactionId::from(row.get::<_, String>(0)?),
                    transaction_type: ttype,
                    location_id: row.get(2)?,
                    staff_id: row.get(3)?,
                    transfer_id: row.get(4)?,
                    purchase_order_id: row.get(5)?,
                    notes: row.get(6).unwrap_or_default(),
                    created_at: row.get(7)?,
                })
            },
        );

        let header = match header_res {
            Ok(h) => h,
            Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(None),
            Err(e) => return Err(CoreError::Db(e)),
        };

        // Query lines
        let mut stmt = self.conn.prepare(
            "SELECT id, transaction_id, sku, product_name, qty, barcode_scanned, sort_order \
             FROM inventory_transaction_lines WHERE transaction_id = ?1 ORDER BY sort_order ASC",
        )?;
        let lines_map = stmt.query_map(params![id], |row| {
            Ok(InventoryTransactionLine {
                id: row.get(0)?,
                transaction_id: crate::inventory_transaction::InventoryTransactionId::from(
                    row.get::<_, String>(1)?,
                ),
                sku: row.get(2)?,
                product_name: row.get(3)?,
                qty: row.get(4)?,
                barcode_scanned: row.get(5)?,
                sort_order: row.get(6)?,
            })
        })?;

        let mut lines = Vec::new();
        for r in lines_map {
            lines.push(r?);
        }

        Ok(Some((header, lines)))
    }

    /// Configure a stock threshold alert boundary for a product at a location.
    pub fn set_stock_threshold(
        &self,
        product_id: &str,
        location_id: Option<&str>,
        threshold: i64,
        enabled: bool,
    ) -> Result<(), CoreError> {
        let tx = self.conn.unchecked_transaction()?;
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

        // Check if a row already exists for this unique combination.
        // Distinguish QueryReturnedNoRows (no threshold yet → INSERT)
        // from real DB errors (corruption → propagate).
        let existing_id: Option<String> = match location_id {
            Some(loc) => match tx.query_row(
                "SELECT id FROM stock_thresholds WHERE product_id = ?1 AND location_id = ?2",
                params![product_id, loc],
                |row| row.get(0),
            ) {
                Ok(id) => Some(id),
                Err(rusqlite::Error::QueryReturnedNoRows) => None,
                Err(e) => return Err(CoreError::Db(e)),
            },
            None => match tx.query_row(
                "SELECT id FROM stock_thresholds WHERE product_id = ?1 AND location_id IS NULL",
                params![product_id],
                |row| row.get(0),
            ) {
                Ok(id) => Some(id),
                Err(rusqlite::Error::QueryReturnedNoRows) => None,
                Err(e) => return Err(CoreError::Db(e)),
            },
        };

        if let Some(id) = existing_id {
            tx.execute(
                "UPDATE stock_thresholds SET threshold = ?1, enabled = ?2, updated_at = ?3 WHERE id = ?4",
                params![threshold, if enabled { 1 } else { 0 }, now, id],
            )?;
        } else {
            let new_id = uuid::Uuid::now_v7().to_string();
            tx.execute(
                "INSERT INTO stock_thresholds (id, product_id, location_id, threshold, enabled, created_at, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
                params![new_id, product_id, location_id, threshold, if enabled { 1 } else { 0 }, now],
            )?;
        }

        tx.commit()?;
        Ok(())
    }

    /// List all stock thresholds configured for a location (or global if location_id is None).
    pub fn get_stock_thresholds(
        &self,
        location_id: Option<&str>,
    ) -> Result<Vec<StockThreshold>, CoreError> {
        let mut stmt = if location_id.is_some() {
            self.conn.prepare(
                "SELECT id, product_id, location_id, threshold, enabled, created_at, updated_at \
                 FROM stock_thresholds WHERE location_id = ?1",
            )?
        } else {
            self.conn.prepare(
                "SELECT id, product_id, location_id, threshold, enabled, created_at, updated_at \
                 FROM stock_thresholds WHERE location_id IS NULL",
            )?
        };

        let parse_row = |row: &rusqlite::Row<'_>| {
            let en_int: i64 = row.get(4)?;
            Ok(StockThreshold {
                id: row.get(0)?,
                product_id: row.get(1)?,
                location_id: row.get(2)?,
                threshold: row.get(3)?,
                enabled: en_int == 1,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        };

        let rows = if let Some(loc) = location_id {
            stmt.query_map(params![loc], parse_row)?
        } else {
            stmt.query_map([], parse_row)?
        };

        let mut thresholds = Vec::new();
        for r in rows {
            thresholds.push(r?);
        }
        Ok(thresholds)
    }

    /// List inventory transactions for a given staff member, location, and
    /// time window. Returns transactions ordered by created_at DESC.
    ///
    /// This is used by the inventory shift summary to avoid client-side
    /// filtering of all transactions.
    pub fn list_inventory_transactions_for_shift(
        &self,
        staff_id: &str,
        location_id: &str,
        since: &str,
    ) -> Result<Vec<InventoryTransaction>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, type, location_id, staff_id, transfer_id, purchase_order_id, notes, created_at \
             FROM inventory_transactions \
             WHERE staff_id = ?1 AND location_id = ?2 AND created_at >= ?3 \
             ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map(params![staff_id, location_id, since], |row| {
            let type_str: String = row.get(1)?;
            let ttype =
                crate::inventory_transaction::InventoryTransactionType::from_stored_str(&type_str)
                    .unwrap_or(
                        crate::inventory_transaction::InventoryTransactionType::ManualAdjustment,
                    );
            Ok(InventoryTransaction {
                id: crate::inventory_transaction::InventoryTransactionId::from(
                    row.get::<_, String>(0)?,
                ),
                transaction_type: ttype,
                location_id: row.get(2)?,
                staff_id: row.get(3)?,
                transfer_id: row.get(4)?,
                purchase_order_id: row.get(5)?,
                notes: row.get(6).unwrap_or_default(),
                created_at: row.get(7)?,
            })
        })?;

        let mut txs = Vec::new();
        for r in rows {
            txs.push(r?);
        }
        Ok(txs)
    }

    /// Delete a stock threshold configuration by ID.
    pub fn delete_stock_threshold(&self, id: &str) -> Result<(), CoreError> {
        let tx = self.conn.unchecked_transaction()?;
        tx.execute("DELETE FROM stock_thresholds WHERE id = ?1", params![id])?;
        tx.commit()?;
        Ok(())
    }
}

#[cfg(test)]
#[path = "inventory_tests.rs"]
mod tests;
