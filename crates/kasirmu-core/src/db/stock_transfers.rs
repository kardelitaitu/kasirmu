//! Stock transfer CRUD — create, send, receive, cancel.
//!
//! Transfers move inventory between terminals/stores. The lifecycle is:
//! draft → pending → in_transit → received / cancelled.
//! `send_transfer` decrements source inventory; `receive_transfer` increments
//! destination inventory and records received quantities.
/*
last audited 25-07-26 by RSA-Agent (kasirmu-core slice B4: stock transfers deep read)
crate: kasirmu-core | status: SAFE | lint: CLEAN
findings: lifecycle handling exemplary (claim-first conditional status UPDATEs inside the same tx as stock writes; cancel re-reads status in-tx fixing a documented prior race; receives validated non-negative/ordered-cap/monotonic with delta-only crediting; checked_add/sub everywhere); COR-19 MEDIUM: send/receive/cancel read+write the LEGACY inventory table (single-PK product_id, per-location unrepresentable) while sales precheck/deduct the canonical stock_summary per ADR-18/19 — no schema trigger bridges them, so transfer moves are invisible to sale-time availability and the retail grid once ledger rows exist (ADR-36 fallback masks it). This is the §3.4 foot-gun the codebase self-documents, applied to production flows
next: complete ADR-19 §3.4 — route transfers (and stock_counts) through stock_summary rows at source/destination locations, or bridge both tables atomically in the same tx as an interim step | perf: list_transfers_with_lines_by_status uses one grouped IN query (no N+1)
*/

use rusqlite::params;

use crate::error::CoreError;
use crate::stock_transfer::{StockTransfer, StockTransferLine};

use super::Store;

impl Store<'_> {
    /// Create a new stock transfer with the given lines.
    ///
    /// Generates a unique transfer number (`TRF-<timestamp>-<short-id>`).
    /// All lines are inserted in the same transaction as the header.
    #[allow(clippy::too_many_arguments)]
    pub fn create_transfer(
        &self,
        source_location: Option<&str>,
        destination_location: Option<&str>,
        source_terminal_id: Option<&str>,
        destination_terminal_id: Option<&str>,
        notes: &str,
        created_by: &str,
        lines: &[StockTransferLine],
    ) -> Result<StockTransfer, CoreError> {
        let id = uuid::Uuid::now_v7().to_string();
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let ts = chrono::Utc::now().timestamp_millis();
        // Use the random tail of the UUID v7 for the short suffix. The first
        // 8 hex chars of a UUID v7 encode the millisecond timestamp, so two
        // transfers created in the same millisecond would collide and trip
        // the UNIQUE constraint on `transfer_number`. The tail is random.
        let short = &id[24..];
        let transfer_number = format!("TRF-{ts}-{short}");

        // ADR-18 §13-36 canonical default-location UUID (see
        // `crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID` for the
        // frozen-invariant rationale). Migration 081's
        // `source_location_id` and `destination_location_id` columns are
        // NOT NULL with this canonical UUID as DEFAULT. SQLite does NOT
        // fall back to DEFAULT when VALUES provides an explicit NULL —
        // a NOT NULL constraint violation fires instead. We resolve the
        // None → canonical mapping at the Rust layer so the bound value
        // is always a non-NULL FK string, while keeping the function
        // signature ergonomic (Option<&str> for callers that don't care
        // to specify a location).
        let canonical_default_loc = crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID;
        let source_loc = source_location.unwrap_or(canonical_default_loc);
        let destination_loc = destination_location.unwrap_or(canonical_default_loc);

        let tx = self.conn.unchecked_transaction()?;

        tx.execute(
            "INSERT INTO stock_transfers
                (id, transfer_number, status, source_location_id, destination_location_id,
                 source_terminal_id, destination_terminal_id, notes, created_by,
                 created_at, updated_at)
             VALUES (?1, ?2, 'draft', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                id,
                transfer_number,
                source_loc,
                destination_loc,
                source_terminal_id,
                destination_terminal_id,
                notes,
                created_by,
                now,
                now,
            ],
        )?;

        for line in lines {
            let line_id = uuid::Uuid::now_v7().to_string();
            tx.execute(
                "INSERT INTO stock_transfer_lines (id, transfer_id, sku, product_name, qty, received_qty)
                 VALUES (?1, ?2, ?3, ?4, ?5, 0)",
                params![line_id, id, line.sku, line.product_name, line.qty],
            )?;
        }

        tx.commit()?;

        Ok(StockTransfer {
            id,
            transfer_number,
            status: "draft".into(),
            source_location: source_location.map(String::from),
            destination_location: destination_location.map(String::from),
            source_terminal_id: source_terminal_id.map(String::from),
            destination_terminal_id: destination_terminal_id.map(String::from),
            notes: notes.to_owned(),
            created_by: created_by.to_owned(),
            received_by: None,
            created_at: now.clone(),
            sent_at: None,
            received_at: None,
            updated_at: now,
        })
    }

    /// Get a single transfer by id (with lines populated via
    /// `get_transfer_lines`).
    pub fn get_transfer(&self, id: &str) -> Result<Option<StockTransfer>, CoreError> {
        // ADR-18 §2d: read the FK columns (source_location_id, destination_location_id)
        // introduced by migration 081's column rename (`source_location` →
        // `source_location_old` audit + `source_location_id` FK). The domain
        // field names `source_location`/`destination_location` are preserved
        // for JSON contract backward compat — callers receive FK UUID strings.
        let mut stmt = self.conn.prepare(
            "SELECT id, transfer_number, status,
                    source_location_id AS source_location,
                    destination_location_id AS destination_location,
                    source_terminal_id, destination_terminal_id,
                    notes, created_by, received_by,
                    created_at, sent_at, received_at, updated_at
             FROM stock_transfers WHERE id = ?1",
        )?;
        let result = stmt.query_row(params![id], |row| {
            Ok(StockTransfer {
                id: row.get("id")?,
                transfer_number: row.get("transfer_number")?,
                status: row.get("status")?,
                source_location: row.get("source_location")?,
                destination_location: row.get("destination_location")?,
                source_terminal_id: row.get("source_terminal_id")?,
                destination_terminal_id: row.get("destination_terminal_id")?,
                notes: row.get("notes")?,
                created_by: row.get("created_by")?,
                received_by: row.get("received_by")?,
                created_at: row.get("created_at")?,
                sent_at: row.get("sent_at")?,
                received_at: row.get("received_at")?,
                updated_at: row.get("updated_at")?,
            })
        });
        match result {
            Ok(t) => Ok(Some(t)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// List all transfers, newest first.
    pub fn list_transfers(&self) -> Result<Vec<StockTransfer>, CoreError> {
        // ADR-18 §2d: read the FK columns (source_location_id, destination_location_id)
        // introduced by migration 081. Domain field names preserved via column
        // aliasing; actual storage is FK UUID strings (NOT NULL DEFAULT canonical).
        let mut stmt = self.conn.prepare(
            "SELECT id, transfer_number, status,
                    source_location_id AS source_location,
                    destination_location_id AS destination_location,
                    source_terminal_id, destination_terminal_id,
                    notes, created_by, received_by,
                    created_at, sent_at, received_at, updated_at
             FROM stock_transfers ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(StockTransfer {
                id: row.get("id")?,
                transfer_number: row.get("transfer_number")?,
                status: row.get("status")?,
                source_location: row.get("source_location")?,
                destination_location: row.get("destination_location")?,
                source_terminal_id: row.get("source_terminal_id")?,
                destination_terminal_id: row.get("destination_terminal_id")?,
                notes: row.get("notes")?,
                created_by: row.get("created_by")?,
                received_by: row.get("received_by")?,
                created_at: row.get("created_at")?,
                sent_at: row.get("sent_at")?,
                received_at: row.get("received_at")?,
                updated_at: row.get("updated_at")?,
            })
        })?;
        rows.map(|r| Ok(r?)).collect()
    }

    /// List transfers in a given status with their line items, newest first.
    ///
    /// Runs two queries (transfers, then one `IN` query for every line) so
    /// the front end does not need to fetch lines one transfer at a time.
    /// This powers the transit audit screen without an N+1 request pattern.
    pub fn list_transfers_with_lines_by_status(
        &self,
        status: &str,
    ) -> Result<Vec<(StockTransfer, Vec<StockTransferLine>)>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, transfer_number, status,
                    source_location_id AS source_location,
                    destination_location_id AS destination_location,
                    source_terminal_id, destination_terminal_id,
                    notes, created_by, received_by,
                    created_at, sent_at, received_at, updated_at
             FROM stock_transfers WHERE status = ?1 ORDER BY created_at DESC",
        )?;
        let transfers: Vec<StockTransfer> = stmt
            .query_map(params![status], |row| {
                Ok(StockTransfer {
                    id: row.get("id")?,
                    transfer_number: row.get("transfer_number")?,
                    status: row.get("status")?,
                    source_location: row.get("source_location")?,
                    destination_location: row.get("destination_location")?,
                    source_terminal_id: row.get("source_terminal_id")?,
                    destination_terminal_id: row.get("destination_terminal_id")?,
                    notes: row.get("notes")?,
                    created_by: row.get("created_by")?,
                    received_by: row.get("received_by")?,
                    created_at: row.get("created_at")?,
                    sent_at: row.get("sent_at")?,
                    received_at: row.get("received_at")?,
                    updated_at: row.get("updated_at")?,
                })
            })?
            .collect::<Result<_, _>>()?;

        if transfers.is_empty() {
            return Ok(Vec::new());
        }

        // Fetch all matching lines in one IN query, then group them back onto
        // their transfers in transfer order.
        let placeholders = std::iter::repeat_n("?", transfers.len())
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "SELECT id, transfer_id, sku, product_name, qty, received_qty
             FROM stock_transfer_lines WHERE transfer_id IN ({placeholders})
             ORDER BY transfer_id, id"
        );
        let mut line_stmt = self.conn.prepare(&sql)?;
        let ids: Vec<&str> = transfers.iter().map(|t| t.id.as_str()).collect();
        let lines: Vec<StockTransferLine> = line_stmt
            .query_map(rusqlite::params_from_iter(ids.iter().copied()), |row| {
                Ok(StockTransferLine {
                    id: row.get("id")?,
                    transfer_id: row.get("transfer_id")?,
                    sku: row.get("sku")?,
                    product_name: row.get("product_name")?,
                    qty: row.get("qty")?,
                    received_qty: row.get("received_qty")?,
                })
            })?
            .collect::<Result<_, _>>()?;

        let mut by_transfer: std::collections::HashMap<String, Vec<StockTransferLine>> =
            std::collections::HashMap::new();
        for line in lines {
            by_transfer
                .entry(line.transfer_id.clone())
                .or_default()
                .push(line);
        }

        Ok(transfers
            .into_iter()
            .map(|transfer| {
                let transfer_lines = by_transfer.remove(&transfer.id).unwrap_or_default();
                (transfer, transfer_lines)
            })
            .collect())
    }

    /// Get lines for a transfer.
    pub fn get_transfer_lines(
        &self,
        transfer_id: &str,
    ) -> Result<Vec<StockTransferLine>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, transfer_id, sku, product_name, qty, received_qty
             FROM stock_transfer_lines WHERE transfer_id = ?1
             ORDER BY id",
        )?;
        let rows = stmt.query_map(params![transfer_id], |row| {
            Ok(StockTransferLine {
                id: row.get("id")?,
                transfer_id: row.get("transfer_id")?,
                sku: row.get("sku")?,
                product_name: row.get("product_name")?,
                qty: row.get("qty")?,
                received_qty: row.get("received_qty")?,
            })
        })?;
        rows.map(|r| Ok(r?)).collect()
    }

    /// Add a line to an existing transfer (only allowed in `draft` status).
    pub fn add_transfer_line(
        &self,
        transfer_id: &str,
        sku: &str,
        product_name: &str,
        qty: i64,
    ) -> Result<StockTransferLine, CoreError> {
        let status: String = self
            .conn
            .query_row(
                "SELECT status FROM stock_transfers WHERE id = ?1",
                params![transfer_id],
                |row| row.get(0),
            )
            .map_err(|_| CoreError::NotFound {
                entity: "stock_transfer",
                id: transfer_id.to_owned(),
            })?;

        if status != "draft" {
            return Err(CoreError::Validation {
                field: "status",
                message: "can only add lines to a draft transfer".into(),
            });
        }

        let id = uuid::Uuid::now_v7().to_string();
        self.conn.execute(
            "INSERT INTO stock_transfer_lines (id, transfer_id, sku, product_name, qty, received_qty)
             VALUES (?1, ?2, ?3, ?4, ?5, 0)",
            params![id, transfer_id, sku, product_name, qty],
        )?;

        Ok(StockTransferLine {
            id,
            transfer_id: transfer_id.to_owned(),
            sku: sku.to_owned(),
            product_name: product_name.to_owned(),
            qty,
            received_qty: 0,
        })
    }

    /// Remove a line from a draft transfer.
    pub fn remove_transfer_line(&self, line_id: &str) -> Result<(), CoreError> {
        let transfer_id: String = self
            .conn
            .query_row(
                "SELECT transfer_id FROM stock_transfer_lines WHERE id = ?1",
                params![line_id],
                |row| row.get(0),
            )
            .map_err(|_| CoreError::NotFound {
                entity: "stock_transfer_line",
                id: line_id.to_owned(),
            })?;

        let status: String = self.conn.query_row(
            "SELECT status FROM stock_transfers WHERE id = ?1",
            params![transfer_id],
            |row| row.get(0),
        )?;

        if status != "draft" {
            return Err(CoreError::Validation {
                field: "status",
                message: "can only remove lines from a draft transfer".into(),
            });
        }

        let deleted = self.conn.execute(
            "DELETE FROM stock_transfer_lines WHERE id = ?1",
            params![line_id],
        )?;
        if deleted == 0 {
            return Err(CoreError::NotFound {
                entity: "stock_transfer_line",
                id: line_id.to_owned(),
            });
        }
        Ok(())
    }

    /// Mark a transfer as `in_transit` and decrement source inventory for each line.
    ///
    /// Only allowed when status is `draft` or `pending`.
    pub fn send_transfer(&self, id: &str) -> Result<StockTransfer, CoreError> {
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let tx = self.conn.unchecked_transaction()?;

        // Claim the lifecycle transition before touching inventory. If a
        // concurrent cancel/receive wins the status claim, this transaction
        // fails without deducting stock. Any later stock error rolls back the
        // claim and all deductions together.
        let status: String = tx
            .query_row(
                "SELECT status FROM stock_transfers WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .map_err(|error| match error {
                rusqlite::Error::QueryReturnedNoRows => CoreError::NotFound {
                    entity: "stock_transfer",
                    id: id.to_owned(),
                },
                other => CoreError::Db(other),
            })?;
        if status != "draft" && status != "pending" {
            return Err(CoreError::Validation {
                field: "status",
                message: format!(
                    "cannot send transfer in status '{status}'; expected 'draft' or 'pending'"
                ),
            });
        }
        let claimed = tx.execute(
            "UPDATE stock_transfers SET status = 'in_transit', sent_at = ?1, updated_at = ?2
             WHERE id = ?3 AND status IN ('draft', 'pending')",
            params![now, now, id],
        )?;
        if claimed != 1 {
            return Err(CoreError::Validation {
                field: "status",
                message: "transfer changed concurrently; send was not applied".into(),
            });
        }

        // Source location for the per-location deduction (migration 081 FK
        // column; create_transfer resolves None to the canonical default).
        let source_location_id: String = tx.query_row(
            "SELECT source_location_id FROM stock_transfers WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )?;

        let mut lines_stmt = tx.prepare(
            "SELECT id, transfer_id, sku, product_name, qty, received_qty
             FROM stock_transfer_lines WHERE transfer_id = ?1 ORDER BY id",
        )?;
        let lines: Vec<StockTransferLine> = lines_stmt
            .query_map(params![id], |row| {
                Ok(StockTransferLine {
                    id: row.get("id")?,
                    transfer_id: row.get("transfer_id")?,
                    sku: row.get("sku")?,
                    product_name: row.get("product_name")?,
                    qty: row.get("qty")?,
                    received_qty: row.get("received_qty")?,
                })
            })?
            .collect::<Result<_, _>>()?;
        drop(lines_stmt);

        // Decrement source inventory for each line.
        for line in &lines {
            if line.qty <= 0 {
                return Err(CoreError::Validation {
                    field: "qty",
                    message: "transfer quantity must be greater than zero".into(),
                });
            }
            let product_id = tx
                .query_row(
                    "SELECT id FROM products WHERE sku = ?1",
                    params![line.sku],
                    |row| row.get::<_, String>(0),
                )
                .map_err(|_| CoreError::NotFound {
                    entity: "product",
                    id: line.sku.clone(),
                })?;

            // Route the deduction through the canonical per-location adjust
            // fn (ADR-19 §3.1) so there is exactly one stock writer: it
            // pre-checks stock_summary at the SOURCE location, appends the
            // stock_movements delta row, upserts the per-location row, and
            // recomputes the legacy inventory aggregate as the SUM over all
            // locations. The legacy single-PK precheck/write this replaces
            // clobbered the aggregate and was invisible to stock_summary.
            self.bridge_legacy_inventory_into_stock_summary_in_tx(&tx, &product_id)?;
            if let Err(err) = self.adjust_stock_at_location_with_reason(
                &tx,
                &line.sku,
                -line.qty,
                &crate::inventory::LocationId::from(source_location_id.as_str()),
                Some("stock_transfer_out"),
                None,
                None,
                None,
            ) {
                return Err(match err {
                    CoreError::InsufficientStockAtLocation {
                        sku,
                        requested_delta,
                        available_qty,
                        ..
                    } => CoreError::Validation {
                        field: "qty",
                        message: format!(
                            "insufficient stock for SKU '{}': have {}, need {}",
                            sku,
                            available_qty,
                            requested_delta.abs()
                        ),
                    },
                    other => other,
                });
            }
        }

        tx.commit()?;

        self.get_transfer(id)?.ok_or_else(|| CoreError::NotFound {
            entity: "stock_transfer",
            id: id.to_owned(),
        })
    }

    /// Mark a transfer as `received`, record received quantities, and
    /// increment destination inventory.
    ///
    /// Only allowed when status is `in_transit` or `received_partial`.
    pub fn receive_transfer(
        &self,
        id: &str,
        received_by: &str,
        received_lines: &[ReceivedLine],
    ) -> Result<StockTransfer, CoreError> {
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let tx = self.conn.unchecked_transaction()?;

        // Claim the in-transit lifecycle inside the same transaction as the
        // destination inventory writes. A pre-transaction status read would
        // allow a concurrent cancellation to win and still let this receive
        // path credit stock on a cancelled transfer.
        let (status, destination_location_id): (String, String) = tx
            .query_row(
                "SELECT status, destination_location_id FROM stock_transfers WHERE id = ?1",
                params![id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|error| match error {
                rusqlite::Error::QueryReturnedNoRows => CoreError::NotFound {
                    entity: "stock_transfer",
                    id: id.to_owned(),
                },
                other => CoreError::Db(other),
            })?;
        if status != "in_transit" && status != "received_partial" {
            return Err(CoreError::Validation {
                field: "status",
                message: format!(
                    "cannot receive transfer in status '{status}'; expected 'in_transit' or 'received_partial'"
                ),
            });
        }

        for rl in received_lines {
            // Validate that received_qty does not exceed the line's ordered qty.
            let (ordered_qty, previous_received_qty): (i64, i64) = tx.query_row(
                "SELECT qty, received_qty FROM stock_transfer_lines
                 WHERE id = ?1 AND transfer_id = ?2",
                params![rl.line_id, id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            if rl.received_qty < 0 {
                return Err(CoreError::Validation {
                    field: "received_qty",
                    message: "received quantity must be non-negative".into(),
                });
            }
            if rl.received_qty > ordered_qty {
                return Err(CoreError::Validation {
                    field: "received_qty",
                    message: format!(
                        "received_qty ({}) exceeds ordered qty ({}) for line {}",
                        rl.received_qty, ordered_qty, rl.line_id
                    ),
                });
            }
            if rl.received_qty < previous_received_qty {
                return Err(CoreError::Validation {
                    field: "received_qty",
                    message: "received quantity cannot decrease after inventory was credited"
                        .into(),
                });
            }
            let newly_received = rl.received_qty - previous_received_qty;

            // Update received_qty on the line.
            tx.execute(
                "UPDATE stock_transfer_lines SET received_qty = ?1 WHERE id = ?2 AND transfer_id = ?3",
                params![rl.received_qty, rl.line_id, id],
            )?;

            if newly_received > 0 {
                let sku: String = tx.query_row(
                    "SELECT sku FROM stock_transfer_lines WHERE id = ?1",
                    params![rl.line_id],
                    |row| row.get(0),
                )?;

                let product_id: String = tx
                    .query_row(
                        "SELECT id FROM products WHERE sku = ?1",
                        params![sku],
                        |row| row.get(0),
                    )
                    .map_err(|_| CoreError::NotFound {
                        entity: "product",
                        id: sku.clone(),
                    })?;

                // Route the credit through the canonical per-location adjust
                // fn at the DESTINATION location (see send_transfer) so the
                // per-location rows and the legacy aggregate stay consistent.
                self.bridge_legacy_inventory_into_stock_summary_in_tx(&tx, &product_id)?;
                self.adjust_stock_at_location_with_reason(
                    &tx,
                    &sku,
                    newly_received,
                    &crate::inventory::LocationId::from(destination_location_id.as_str()),
                    Some("stock_transfer_in"),
                    None,
                    None,
                    None,
                )?;
            }
        }

        let all_received: bool = {
            let mut stmt = tx.prepare(
                "SELECT COUNT(*) FROM stock_transfer_lines
                 WHERE transfer_id = ?1 AND received_qty < qty",
            )?;
            let partial: i64 = stmt.query_row(params![id], |row| row.get(0))?;
            partial == 0
        };

        let has_any_received: bool = {
            let mut stmt = tx.prepare(
                "SELECT COUNT(*) FROM stock_transfer_lines
                 WHERE transfer_id = ?1 AND received_qty > 0",
            )?;
            let count: i64 = stmt.query_row(params![id], |row| row.get(0))?;
            count > 0
        };

        let final_status = if all_received {
            "received"
        } else if has_any_received {
            "received_partial"
        } else {
            "in_transit"
        };

        let claimed = tx.execute(
            "UPDATE stock_transfers SET status = ?1, received_by = ?2, received_at = ?3, updated_at = ?4
             WHERE id = ?5 AND status IN ('in_transit', 'received_partial')",
            params![final_status, received_by, now, now, id],
        )?;
        if claimed != 1 {
            return Err(CoreError::Validation {
                field: "status",
                message: "transfer changed concurrently; receive was not applied".into(),
            });
        }

        tx.commit()?;

        self.get_transfer(id)?.ok_or_else(|| CoreError::NotFound {
            entity: "stock_transfer",
            id: id.to_owned(),
        })
    }

    /// Cancel a transfer and reverse source stock deducted at dispatch.
    ///
    /// Draft and pending transfers have not moved stock and are only marked
    /// cancelled. An in-transit transfer is reversed atomically: each line's
    /// dispatched quantity is credited back to the source inventory before the
    /// status changes. Received and partially received transfers are rejected;
    /// their destination-side movement requires a separate audited correction
    /// rather than an ambiguous cancellation.
    pub fn cancel_transfer(&self, id: &str) -> Result<StockTransfer, CoreError> {
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let tx = self.conn.unchecked_transaction()?;

        // Read the lifecycle state inside the same transaction as the
        // reversal. The previous implementation read it before opening the
        // transaction, which allowed a concurrent send to be observed as
        // `draft` and then cancelled without restoring the stock that send
        // deducted.
        let (status, source_location_id): (String, String) = tx
            .query_row(
                "SELECT status, source_location_id FROM stock_transfers WHERE id = ?1",
                params![id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|error| match error {
                rusqlite::Error::QueryReturnedNoRows => CoreError::NotFound {
                    entity: "stock_transfer",
                    id: id.to_owned(),
                },
                other => CoreError::Db(other),
            })?;

        if matches!(
            status.as_str(),
            "received" | "received_partial" | "cancelled"
        ) {
            return Err(CoreError::Validation {
                field: "status",
                message: format!("cannot cancel transfer in status '{status}'"),
            });
        }

        if status == "in_transit" {
            let mut lines_stmt =
                tx.prepare("SELECT sku, qty FROM stock_transfer_lines WHERE transfer_id = ?1")?;
            let lines: Vec<(String, i64)> = lines_stmt
                .query_map(params![id], |row| Ok((row.get(0)?, row.get(1)?)))?
                .collect::<Result<_, _>>()?;
            drop(lines_stmt);

            for (sku, qty) in lines {
                let product_id: String = tx
                    .query_row(
                        "SELECT id FROM products WHERE sku = ?1",
                        params![sku],
                        |row| row.get(0),
                    )
                    .map_err(|error| match error {
                        rusqlite::Error::QueryReturnedNoRows => CoreError::NotFound {
                            entity: "product",
                            id: sku.clone(),
                        },
                        other => CoreError::Db(other),
                    })?;
                // Route the reversal through the canonical per-location
                // adjust fn: the dispatched qty is credited back at the
                // SOURCE location it was deducted from (see send_transfer).
                self.bridge_legacy_inventory_into_stock_summary_in_tx(&tx, &product_id)?;
                self.adjust_stock_at_location_with_reason(
                    &tx,
                    &sku,
                    qty,
                    &crate::inventory::LocationId::from(source_location_id.as_str()),
                    Some("stock_transfer_cancel"),
                    None,
                    None,
                    None,
                )?;
            }
        }

        let changed = tx.execute(
            "UPDATE stock_transfers SET status = 'cancelled', updated_at = ?1
             WHERE id = ?2 AND status IN ('draft', 'pending', 'in_transit')",
            params![now, id],
        )?;
        if changed != 1 {
            return Err(CoreError::Validation {
                field: "status",
                message: "transfer changed concurrently; cancellation was not applied".into(),
            });
        }
        tx.commit()?;

        self.get_transfer(id)?.ok_or_else(|| CoreError::NotFound {
            entity: "stock_transfer",
            id: id.to_owned(),
        })
    }
}

/// A line-level received quantity for [`Store::receive_transfer`].
#[derive(Debug, Clone)]
pub struct ReceivedLine {
    /// FK to stock_transfer_lines.id.
    pub line_id: String,
    /// Quantity actually received for this line.
    pub received_qty: i64,
}

#[cfg(test)]
#[path = "stock_transfers_tests.rs"]
mod tests;
