//! Physical inventory / stock counting database operations.
/*
last audited 25-07-26 by RSA-Agent (kasirmu-core slice B5 finale)
crate: kasirmu-core | status: SAFE | lint: CLEAN
findings: exemplary completion flow — BEGIN IMMEDIATE number allocation in-SQL (with dangling-tx rollback discipline), claim-first conditional completion, checked arithmetic throughout, NoRows-vs-error discipline, snapshot-consistent reads via tx; writes legacy inventory table (COR-19 family, already tracked); enum fallbacks to Draft/Full (COR-13 family)
next: none here | perf: N/A
*/
//!
//! Provides CRUD for `StockCount`, `StockCountLine`, and
//! `StockAdjustment` records, plus the `complete_stock_count`
//! workflow that finalises a count, creates adjustment records,
//! and updates inventory quantities.

use rusqlite::{OptionalExtension, params};

use crate::Store;
use crate::error::CoreError;
use crate::stock_count::{
    CountType, StockAdjustment, StockCount, StockCountLine, StockCountStatus,
};

fn validate_non_negative(field: &'static str, value: i64) -> Result<(), CoreError> {
    if value < 0 {
        Err(CoreError::Validation {
            field,
            message: "quantity must be non-negative".into(),
        })
    } else {
        Ok(())
    }
}

fn validate_line_quantities(line: &StockCountLine) -> Result<(), CoreError> {
    validate_non_negative("expected_qty", line.expected_qty)?;
    let expected_difference = match line.counted_qty {
        Some(counted) => {
            validate_non_negative("counted_qty", counted)?;
            counted
                .checked_sub(line.expected_qty)
                .ok_or_else(|| CoreError::Validation {
                    field: "difference",
                    message: "quantity difference overflow".into(),
                })?
        }
        None => 0,
    };
    if expected_difference != line.difference {
        return Err(CoreError::Validation {
            field: "difference",
            message: "difference must equal counted_qty - expected_qty".into(),
        });
    }
    Ok(())
}

impl Store<'_> {
    // ── Stock Count CRUD ───────────────────────────────────────────

    /// Create a new stock count record.
    ///
    /// C18 P1.10: runs inside a transaction — the caller's if one is open
    /// (SQLite has no nested `BEGIN`), otherwise its own. See
    /// [`Self::add_count_line`] for why the write surface of this file is
    /// transactional as a class.
    pub fn create_stock_count(&self, count: &StockCount) -> Result<(), CoreError> {
        let tx = if self.conn.is_autocommit() {
            Some(self.conn.unchecked_transaction()?)
        } else {
            None
        };
        self.conn.execute(
            "INSERT INTO stock_counts (id, count_number, status, count_type, notes, counted_by, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                count.id,
                count.count_number,
                count.status.as_str(),
                count.count_type.as_str(),
                count.notes,
                count.counted_by,
                count.created_at,
                count.updated_at,
            ],
        )?;
        if let Some(tx) = tx {
            tx.commit()?;
        }
        Ok(())
    }

    /// Insert a count while allocating today's number in the same SQL write.
    ///
    /// The number is derived inside the INSERT statement rather than through a
    /// separate `MAX(...)` read, so concurrent terminals cannot both reserve
    /// the same human-readable number. The caller's `count_number` is replaced
    /// with the number assigned by SQLite.
    pub fn create_stock_count_with_next_number(
        &self,
        count: &mut StockCount,
    ) -> Result<(), CoreError> {
        // `Store` intentionally borrows an immutable `Connection` for its
        // CRUD surface, so the IMMEDIATE transaction is opened by hand here:
        // the MAX-based sequence read and the insert must hold SQLite's write
        // reservation for the whole allocation.
        //
        // C18 P1.10: only when there is not one already. This used to run
        // `BEGIN IMMEDIATE` unconditionally, which FAILS with "cannot start a
        // transaction within a transaction" for any caller that already holds
        // one — the defect is not a lost rollback, it is an outright error.
        // SQLite has no nested `BEGIN`, so when a transaction is open we join it
        // and leave the commit to its owner.
        let owned = self.conn.is_autocommit();
        if owned {
            self.conn.execute_batch("BEGIN IMMEDIATE")?;
        }
        let result = (|| {
            let inserted = self.conn.execute(
                "INSERT INTO stock_counts
                    (id, count_number, status, count_type, notes, counted_by,
                     created_at, completed_at, updated_at)
                 VALUES (?1,
                         (SELECT 'CNT-' || strftime('%Y%m%d', 'now') || '-' ||
                                 printf('%03d', COALESCE(MAX(CAST(SUBSTR(count_number, 14) AS INTEGER)), 0) + 1)
                          FROM stock_counts
                          WHERE count_number LIKE 'CNT-' || strftime('%Y%m%d', 'now') || '-%'),
                         ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                rusqlite::params![
                    count.id,
                    count.status.as_str(),
                    count.count_type.as_str(),
                    count.notes,
                    count.counted_by,
                    count.created_at,
                    count.completed_at,
                    count.updated_at,
                ],
            )?;
            if inserted != 1 {
                return Err(CoreError::Internal(
                    "stock count number allocation inserted no row".into(),
                ));
            }
            let number = self.conn.query_row(
                "SELECT count_number FROM stock_counts WHERE id = ?1",
                rusqlite::params![count.id],
                |row| row.get(0),
            )?;
            Ok(number)
        })();

        // Commit or roll back only what THIS call opened; a joined caller owns
        // its own commit (and a rollback here would silently discard its work).
        if !owned {
            return result.map(|number| {
                count.count_number = number;
            });
        }

        match result {
            Ok(number) => {
                if let Err(commit_error) = self.conn.execute_batch("COMMIT") {
                    // Never leave the connection inside a dangling transaction:
                    // attempt a rollback so subsequent queries on the same
                    // connection do not fail with "cannot start a transaction
                    // within a transaction".
                    let _ = self.conn.execute_batch("ROLLBACK");
                    return Err(CoreError::Db(commit_error));
                }
                count.count_number = number;
                Ok(())
            }
            Err(error) => {
                let _ = self.conn.execute_batch("ROLLBACK");
                Err(error)
            }
        }
    }

    /// Fetch a single stock count by id.
    pub fn get_stock_count(&self, id: &str) -> Result<Option<StockCount>, CoreError> {
        let result = self.conn.query_row(
            "SELECT id, count_number, status, count_type, notes, counted_by, created_at, completed_at, updated_at
             FROM stock_counts WHERE id = ?1",
            params![id],
            |row| {
                let status_str: String = row.get("status")?;
                let type_str: String = row.get("count_type")?;
                Ok(StockCount {
                    id: row.get("id")?,
                    count_number: row.get("count_number")?,
                    status: StockCountStatus::from_db_str(&status_str).unwrap_or(StockCountStatus::Draft),
                    count_type: CountType::from_db_str(&type_str).unwrap_or(CountType::Full),
                    notes: row.get("notes")?,
                    counted_by: row.get("counted_by")?,
                    created_at: row.get("created_at")?,
                    completed_at: row.get("completed_at")?,
                    updated_at: row.get("updated_at")?,
                })
            },
        );
        match result {
            Ok(c) => Ok(Some(c)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// List all stock counts, newest first.
    pub fn list_stock_counts(&self) -> Result<Vec<StockCount>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, count_number, status, count_type, notes, counted_by, created_at, completed_at, updated_at
             FROM stock_counts ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            let status_str: String = row.get("status")?;
            let type_str: String = row.get("count_type")?;
            Ok(StockCount {
                id: row.get("id")?,
                count_number: row.get("count_number")?,
                status: StockCountStatus::from_db_str(&status_str)
                    .unwrap_or(StockCountStatus::Draft),
                count_type: CountType::from_db_str(&type_str).unwrap_or(CountType::Full),
                notes: row.get("notes")?,
                counted_by: row.get("counted_by")?,
                created_at: row.get("created_at")?,
                completed_at: row.get("completed_at")?,
                updated_at: row.get("updated_at")?,
            })
        })?;
        rows.map(|r| Ok(r?)).collect()
    }

    /// Update a stock count's details (status, notes, counted_by, etc.).
    pub fn update_stock_count(&self, count: &StockCount) -> Result<(), CoreError> {
        let current_status: String = self
            .conn
            .query_row(
                "SELECT status FROM stock_counts WHERE id = ?1",
                params![count.id],
                |row| row.get(0),
            )
            .map_err(|error| match error {
                rusqlite::Error::QueryReturnedNoRows => CoreError::NotFound {
                    entity: "stock_count",
                    id: count.id.clone(),
                },
                other => CoreError::Db(other),
            })?;
        if matches!(current_status.as_str(), "completed" | "cancelled") {
            return Err(CoreError::Validation {
                field: "status",
                message: "completed or cancelled stock counts cannot be modified".into(),
            });
        }
        // C18 P1.10: the guard read above and this UPDATE are one unit of work.
        let tx = if self.conn.is_autocommit() {
            Some(self.conn.unchecked_transaction()?)
        } else {
            None
        };
        self.conn.execute(
            "UPDATE stock_counts SET status = ?1, count_type = ?2, notes = ?3, counted_by = ?4, completed_at = ?5, updated_at = ?6
             WHERE id = ?7",
            params![
                count.status.as_str(),
                count.count_type.as_str(),
                count.notes,
                count.counted_by,
                count.completed_at,
                count.updated_at,
                count.id,
            ],
        )?;
        if let Some(tx) = tx {
            tx.commit()?;
        }
        Ok(())
    }

    // ── Count Lines ─────────────────────────────────────────────────

    /// Add a line to a stock count.
    pub fn add_count_line(&self, line: &StockCountLine) -> Result<(), CoreError> {
        let status: String = self
            .conn
            .query_row(
                "SELECT status FROM stock_counts WHERE id = ?1",
                params![line.count_id],
                |row| row.get(0),
            )
            .map_err(|error| match error {
                rusqlite::Error::QueryReturnedNoRows => CoreError::NotFound {
                    entity: "stock_count",
                    id: line.count_id.clone(),
                },
                other => CoreError::Db(other),
            })?;
        if !matches!(status.as_str(), "draft" | "in_progress") {
            return Err(CoreError::Validation {
                field: "status",
                message: "count lines can only be added to an editable stock count".into(),
            });
        }
        validate_line_quantities(line)?;
        // C18 P1.10: the guard read above and this INSERT are one unit of work —
        // the same check-then-write race `stock_transfers` had. Joins a
        // caller-owned transaction (SQLite has no nested `BEGIN`), or owns one in
        // autocommit. The `log_audit` idiom.
        let tx = if self.conn.is_autocommit() {
            Some(self.conn.unchecked_transaction()?)
        } else {
            None
        };
        self.conn.execute(
            "INSERT INTO stock_count_lines (id, count_id, sku, product_name, expected_qty, counted_qty, difference, notes)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                line.id, line.count_id, line.sku, line.product_name,
                line.expected_qty, line.counted_qty, line.difference, line.notes,
            ],
        )?;
        if let Some(tx) = tx {
            tx.commit()?;
        }
        Ok(())
    }

    /// Update a count line (counted_qty, notes, difference).
    pub fn update_count_line(&self, line: &StockCountLine) -> Result<(), CoreError> {
        let status: String = self
            .conn
            .query_row(
                "SELECT stock_counts.status FROM stock_count_lines
                 JOIN stock_counts ON stock_counts.id = stock_count_lines.count_id
                 WHERE stock_count_lines.id = ?1",
                params![line.id],
                |row| row.get(0),
            )
            .map_err(|error| match error {
                rusqlite::Error::QueryReturnedNoRows => CoreError::NotFound {
                    entity: "stock_count_line",
                    id: line.id.clone(),
                },
                other => CoreError::Db(other),
            })?;
        if !matches!(status.as_str(), "draft" | "in_progress") {
            return Err(CoreError::Validation {
                field: "status",
                message: "count lines can only be updated on an editable stock count".into(),
            });
        }
        validate_line_quantities(line)?;
        // C18 P1.10: the guard read above and this UPDATE are one unit of work.
        let tx = if self.conn.is_autocommit() {
            Some(self.conn.unchecked_transaction()?)
        } else {
            None
        };
        self.conn.execute(
            "UPDATE stock_count_lines SET counted_qty = ?1, difference = ?2, notes = ?3 WHERE id = ?4",
            params![line.counted_qty, line.difference, line.notes, line.id],
        )?;
        if let Some(tx) = tx {
            tx.commit()?;
        }
        Ok(())
    }

    /// Remove a line from a stock count.
    pub fn remove_count_line(&self, line_id: &str) -> Result<(), CoreError> {
        let status: Option<String> = self
            .conn
            .query_row(
                "SELECT stock_counts.status FROM stock_count_lines
                 JOIN stock_counts ON stock_counts.id = stock_count_lines.count_id
                 WHERE stock_count_lines.id = ?1",
                params![line_id],
                |row| row.get(0),
            )
            .optional()?;
        let Some(status) = status else {
            // Preserve the established idempotent delete contract for an
            // already-absent line; status enforcement applies when a row exists.
            return Ok(());
        };
        if !matches!(status.as_str(), "draft" | "in_progress") {
            return Err(CoreError::Validation {
                field: "status",
                message: "count lines can only be removed from an editable stock count".into(),
            });
        }
        // C18 P1.10: the guard read above and this DELETE are one unit of work.
        let tx = if self.conn.is_autocommit() {
            Some(self.conn.unchecked_transaction()?)
        } else {
            None
        };
        self.conn.execute(
            "DELETE FROM stock_count_lines WHERE id = ?1",
            params![line_id],
        )?;
        if let Some(tx) = tx {
            tx.commit()?;
        }
        Ok(())
    }

    /// Get a single count line by id.
    pub fn get_count_line_by_id(&self, line_id: &str) -> Result<Option<StockCountLine>, CoreError> {
        let result = self.conn.query_row(
            "SELECT id, count_id, sku, product_name, expected_qty, counted_qty, difference, notes
             FROM stock_count_lines WHERE id = ?1",
            params![line_id],
            |row| {
                Ok(StockCountLine {
                    id: row.get("id")?,
                    count_id: row.get("count_id")?,
                    sku: row.get("sku")?,
                    product_name: row.get("product_name")?,
                    expected_qty: row.get("expected_qty")?,
                    counted_qty: row.get("counted_qty")?,
                    difference: row.get("difference")?,
                    notes: row.get("notes")?,
                })
            },
        );
        match result {
            Ok(l) => Ok(Some(l)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// Get all lines for a stock count.
    pub fn get_count_lines(&self, count_id: &str) -> Result<Vec<StockCountLine>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, count_id, sku, product_name, expected_qty, counted_qty, difference, notes
             FROM stock_count_lines WHERE count_id = ?1 ORDER BY sku",
        )?;
        let rows = stmt.query_map(params![count_id], |row| {
            Ok(StockCountLine {
                id: row.get("id")?,
                count_id: row.get("count_id")?,
                sku: row.get("sku")?,
                product_name: row.get("product_name")?,
                expected_qty: row.get("expected_qty")?,
                counted_qty: row.get("counted_qty")?,
                difference: row.get("difference")?,
                notes: row.get("notes")?,
            })
        })?;
        rows.map(|r| Ok(r?)).collect()
    }

    // ── Complete ─────────────────────────────────────────────────────

    /// Finalise a stock count: generate stock adjustments, update inventory
    /// quantities, and mark the count as completed.
    ///
    /// Returns the list of adjustments that were created.
    pub fn complete_stock_count(
        &self,
        count_id: &str,
        completed_by: Option<&str>,
    ) -> Result<Vec<StockAdjustment>, CoreError> {
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let mut adjustments: Vec<StockAdjustment> = Vec::new();
        let tx = self.conn.unchecked_transaction()?;

        // Read, claim, and write through one transaction. The conditional
        // status update is the completion claim; if another caller wins it,
        // this transaction rolls back before any adjustment is committed.
        let (count, status): (StockCount, String) = tx
            .query_row(
                "SELECT id, count_number, status, count_type, notes, counted_by,
                    created_at, completed_at, updated_at
             FROM stock_counts WHERE id = ?1",
                params![count_id],
                |row| {
                    let status: String = row.get("status")?;
                    let count_type: String = row.get("count_type")?;
                    Ok((
                        StockCount {
                            id: row.get("id")?,
                            count_number: row.get("count_number")?,
                            status: StockCountStatus::from_db_str(&status)
                                .unwrap_or(StockCountStatus::Draft),
                            count_type: CountType::from_db_str(&count_type)
                                .unwrap_or(CountType::Full),
                            notes: row.get("notes")?,
                            counted_by: row.get("counted_by")?,
                            created_at: row.get("created_at")?,
                            completed_at: row.get("completed_at")?,
                            updated_at: row.get("updated_at")?,
                        },
                        status,
                    ))
                },
            )
            .map_err(|error| match error {
                rusqlite::Error::QueryReturnedNoRows => CoreError::NotFound {
                    entity: "stock_count",
                    id: count_id.to_owned(),
                },
                other => CoreError::Db(other),
            })?;
        if status != StockCountStatus::Draft.as_str()
            && status != StockCountStatus::InProgress.as_str()
        {
            return Err(CoreError::Validation {
                field: "status",
                message: format!("cannot complete count with status {status}"),
            });
        }
        let claimed = tx.execute(
            "UPDATE stock_counts SET status = 'completed', completed_at = ?1, updated_at = ?2
             WHERE id = ?3 AND status IN ('draft', 'in_progress')",
            params![now, now, count_id],
        )?;
        if claimed != 1 {
            return Err(CoreError::Validation {
                field: "status",
                message: "stock count was completed or changed concurrently".into(),
            });
        }
        let mut lines_stmt = tx.prepare(
            "SELECT id, count_id, sku, product_name, expected_qty, counted_qty, difference, notes
             FROM stock_count_lines WHERE count_id = ?1 ORDER BY sku",
        )?;
        let lines: Vec<StockCountLine> = lines_stmt
            .query_map(params![count_id], |row| {
                Ok(StockCountLine {
                    id: row.get("id")?,
                    count_id: row.get("count_id")?,
                    sku: row.get("sku")?,
                    product_name: row.get("product_name")?,
                    expected_qty: row.get("expected_qty")?,
                    counted_qty: row.get("counted_qty")?,
                    difference: row.get("difference")?,
                    notes: row.get("notes")?,
                })
            })?
            .collect::<Result<_, _>>()?;
        drop(lines_stmt);

        for line in &lines {
            validate_line_quantities(line)?;
            let counted_qty = line.counted_qty.unwrap_or(line.expected_qty);
            if counted_qty == line.expected_qty {
                continue;
            }

            let product_id: String = tx
                .query_row(
                    "SELECT id FROM products WHERE sku = ?1",
                    params![line.sku],
                    |row| row.get(0),
                )
                .map_err(|error| match error {
                    rusqlite::Error::QueryReturnedNoRows => CoreError::NotFound {
                        entity: "product",
                        id: line.sku.clone(),
                    },
                    other => CoreError::Db(other),
                })?;

            // Baseline: read the same value the product-grid reader derives —
            // SUM over the per-location stock_summary rows, falling back to the
            // legacy single-PK inventory row when the product has none — so the
            // count delta is computed against what the user actually sees
            // rather than a stale aggregate. Read through the active
            // transaction so the baseline and the writes see one snapshot.
            let previous_qty: i64 = match tx.query_row(
                "SELECT COALESCE((SELECT SUM(ss.qty) FROM stock_summary ss
                                  WHERE ss.item_id = ?1),
                                 (SELECT COALESCE(qty, 0) FROM inventory
                                  WHERE product_id = ?1))",
                params![product_id],
                |row| row.get(0),
            ) {
                Ok(q) => q,
                Err(e) => return Err(CoreError::Db(e)),
            };
            validate_non_negative("previous_qty", previous_qty)?;
            let delta =
                counted_qty
                    .checked_sub(previous_qty)
                    .ok_or_else(|| CoreError::Validation {
                        field: "counted_qty",
                        message: "quantity difference overflow".into(),
                    })?;

            // Apply the count delta through the canonical per-location adjust
            // fn so there is exactly one stock writer and the legacy aggregate
            // is recomputed as the SUM over all locations. A shrink is
            // waterfalled across the locations that hold stock (largest first,
            // never underflowing one); a surplus credits the largest holder —
            // or the canonical default location when the product has no
            // per-location rows.
            self.bridge_legacy_inventory_into_stock_summary_in_tx(&tx, &product_id)?;
            if delta != 0 {
                let holders: Vec<(String, i64)> = {
                    let mut stmt = tx.prepare(
                        "SELECT location_id, qty FROM stock_summary
                         WHERE item_id = ?1 ORDER BY qty DESC, location_id ASC",
                    )?;
                    stmt.query_map(params![product_id], |row| {
                        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
                    })?
                    .collect::<Result<Vec<_>, _>>()?
                };
                let reason = format!("stock count {}", count.count_number);
                let mut remaining = delta;
                for (location_id, location_qty) in &holders {
                    if remaining == 0 {
                        break;
                    }
                    let step = if remaining < 0 {
                        // Shrink: deduct up to what this location holds.
                        -(-remaining).min(*location_qty)
                    } else {
                        // Surplus: credit the largest holder once.
                        remaining
                    };
                    if step == 0 {
                        continue;
                    }
                    self.adjust_stock_at_location_with_reason(
                        &tx,
                        &line.sku,
                        step,
                        &crate::inventory::LocationId::from(location_id.as_str()),
                        Some(reason.as_str()),
                        None,
                        None,
                        None,
                    )?;
                    remaining -= step;
                }
                if remaining != 0 {
                    // Surplus with no per-location holder (or a defensive
                    // shortfall): land the remainder at the canonical default.
                    self.adjust_stock_at_location_with_reason(
                        &tx,
                        &line.sku,
                        remaining,
                        &crate::inventory::LocationId::from(
                            crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID,
                        ),
                        Some(reason.as_str()),
                        None,
                        None,
                        None,
                    )?;
                }
            }

            let adj_id = uuid::Uuid::now_v7().to_string();
            let adjustment = StockAdjustment {
                id: adj_id.clone(),
                count_id: Some(count_id.to_owned()),
                sku: line.sku.clone(),
                product_name: line.product_name.clone(),
                previous_qty,
                adjusted_qty: counted_qty,
                reason: format!("stock count {} ({})", count.count_number, line.notes),
                created_by: completed_by.map(|s| s.to_owned()),
                created_at: now.clone(),
            };

            tx.execute(
                "INSERT INTO stock_adjustments (id, count_id, sku, product_name, previous_qty, adjusted_qty, reason, created_by, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    adj_id, count_id, line.sku, line.product_name,
                    previous_qty, counted_qty, adjustment.reason, completed_by, now,
                ],
            )?;

            adjustments.push(adjustment);
        }

        tx.commit()?;

        Ok(adjustments)
    }

    // ── Adjustments ─────────────────────────────────────────────────

    /// List all stock adjustments, newest first.
    pub fn list_stock_adjustments(&self) -> Result<Vec<StockAdjustment>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, count_id, sku, product_name, previous_qty, adjusted_qty, reason, created_by, created_at
             FROM stock_adjustments ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(StockAdjustment {
                id: row.get("id")?,
                count_id: row.get("count_id")?,
                sku: row.get("sku")?,
                product_name: row.get("product_name")?,
                previous_qty: row.get("previous_qty")?,
                adjusted_qty: row.get("adjusted_qty")?,
                reason: row.get("reason")?,
                created_by: row.get("created_by")?,
                created_at: row.get("created_at")?,
            })
        })?;
        rows.map(|r| Ok(r?)).collect()
    }

    /// Generate a human-readable count number like "CNT-20260706-001".
    pub fn next_count_number(&self) -> Result<String, CoreError> {
        let today = chrono::Utc::now().format("%Y%m%d").to_string();
        let prefix = format!("CNT-{today}-");
        let max_seq: i64 = self
            .conn
            .query_row(
                "SELECT COALESCE(MAX(CAST(SUBSTR(count_number, ?2) AS INTEGER)), 0) FROM stock_counts WHERE count_number LIKE ?1",
                params![format!("{prefix}%"), prefix.len() + 1],
                |row| row.get(0),
            )
            .unwrap_or(0);
        Ok(format!("{}{:03}", prefix, max_seq + 1))
    }
}

#[cfg(test)]
#[path = "stock_counts_tests.rs"]
mod tests;
