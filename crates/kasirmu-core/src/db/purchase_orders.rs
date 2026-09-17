//! Purchase order CRUD — list, get, create, update status, receive.
/*
last audited 25-07-26 by RSA-Agent (oz-core slice B5 finale)
crate: oz-core | status: SAFE | lint: CLEAN
findings: exemplary — MONEY-05 checked arithmetic at IPC boundary with documented dev-build rationale (subtotal pass + per-line recompute); atomic create AND receive; canonical stock API in-tx; damage accounting with short-qty surfacing; COR-29 LOW: line 452 uses plain received+damaged (the one unchecked add in an otherwise checked file) — i64 overflow wraps negative in release and bypasses the ordered-qty cap (stock itself still guarded by checked_add inside adjust); receipts land at CANONICAL_DEFAULT_LOCATION (COR-19 family note); list POs reuses a prepared statement per order (acceptable N+1)
next: checked_add for received+damaged (COR-29) | perf: statement reuse mitigates the per-order line query
*/

use rusqlite::params;

use crate::error::CoreError;
use crate::{PurchaseOrder, PurchaseOrderLine, PurchaseOrderWithLines};

use super::Store;

impl Store<'_> {
    /// List all purchase orders, ordered by creation date descending, with lines.
    pub fn list_purchase_orders(&self) -> Result<Vec<PurchaseOrderWithLines>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT po.id, po.po_number, po.supplier_id, po.status, po.order_date,
                    po.expected_date, po.received_date, po.subtotal_minor, po.tax_minor,
                    po.total_minor, po.notes, po.created_by, po.created_at, po.updated_at,
                    s.name AS supplier_name
             FROM purchase_orders po
             LEFT JOIN suppliers s ON po.supplier_id = s.id
             ORDER BY po.created_at DESC",
        )?;
        let orders: Vec<PurchaseOrderWithLines> = stmt
            .query_map([], |row| {
                Ok(PurchaseOrderWithLines {
                    order: PurchaseOrder {
                        id: row.get("id")?,
                        po_number: row.get("po_number")?,
                        supplier_id: row.get("supplier_id")?,
                        status: row.get("status")?,
                        order_date: row.get("order_date")?,
                        expected_date: row.get("expected_date")?,
                        received_date: row.get("received_date")?,
                        subtotal_minor: row.get("subtotal_minor")?,
                        tax_minor: row.get("tax_minor")?,
                        total_minor: row.get("total_minor")?,
                        notes: row.get("notes")?,
                        created_by: row.get("created_by")?,
                        created_at: row.get("created_at")?,
                        updated_at: row.get("updated_at")?,
                    },
                    lines: Vec::new(),
                    supplier_name: row.get("supplier_name")?,
                })
            })?
            .map(|r| Ok(r?))
            .collect::<Result<Vec<_>, CoreError>>()?;

        if orders.is_empty() {
            return Ok(orders);
        }

        let mut line_stmt = self.conn.prepare(
            "SELECT id, po_id, sku, product_name, qty, unit_cost_minor, line_total_minor,
                    received_qty, damaged_qty
             FROM purchase_order_lines WHERE po_id = ?1 ORDER BY id",
        )?;

        let mut result: Vec<PurchaseOrderWithLines> = Vec::with_capacity(orders.len());
        for mut order in orders {
            let lines: Vec<PurchaseOrderLine> = line_stmt
                .query_map(params![&order.order.id], |row| {
                    Ok(PurchaseOrderLine {
                        id: row.get("id")?,
                        po_id: row.get("po_id")?,
                        sku: row.get("sku")?,
                        product_name: row.get("product_name")?,
                        qty: row.get("qty")?,
                        unit_cost_minor: row.get("unit_cost_minor")?,
                        line_total_minor: row.get("line_total_minor")?,
                        received_qty: row.get("received_qty")?,
                        damaged_qty: row.get("damaged_qty")?,
                    })
                })?
                .map(|r| Ok(r?))
                .collect::<Result<Vec<_>, CoreError>>()?;
            order.lines = lines;
            result.push(order);
        }

        Ok(result)
    }

    /// Look up a single purchase order by id, including lines.
    pub fn get_purchase_order(
        &self,
        id: &str,
    ) -> Result<Option<PurchaseOrderWithLines>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT po.id, po.po_number, po.supplier_id, po.status, po.order_date,
                    po.expected_date, po.received_date, po.subtotal_minor, po.tax_minor,
                    po.total_minor, po.notes, po.created_by, po.created_at, po.updated_at,
                    s.name AS supplier_name
             FROM purchase_orders po
             LEFT JOIN suppliers s ON po.supplier_id = s.id
             WHERE po.id = ?1",
        )?;
        let result = stmt.query_row(params![id], |row| {
            Ok(PurchaseOrderWithLines {
                order: PurchaseOrder {
                    id: row.get("id")?,
                    po_number: row.get("po_number")?,
                    supplier_id: row.get("supplier_id")?,
                    status: row.get("status")?,
                    order_date: row.get("order_date")?,
                    expected_date: row.get("expected_date")?,
                    received_date: row.get("received_date")?,
                    subtotal_minor: row.get("subtotal_minor")?,
                    tax_minor: row.get("tax_minor")?,
                    total_minor: row.get("total_minor")?,
                    notes: row.get("notes")?,
                    created_by: row.get("created_by")?,
                    created_at: row.get("created_at")?,
                    updated_at: row.get("updated_at")?,
                },
                lines: Vec::new(),
                supplier_name: row.get("supplier_name")?,
            })
        });

        let mut order = match result {
            Ok(o) => o,
            Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(None),
            Err(e) => return Err(e.into()),
        };

        let mut line_stmt = self.conn.prepare(
            "SELECT id, po_id, sku, product_name, qty, unit_cost_minor, line_total_minor,
                    received_qty, damaged_qty
             FROM purchase_order_lines WHERE po_id = ?1 ORDER BY id",
        )?;
        let lines: Vec<PurchaseOrderLine> = line_stmt
            .query_map(params![id], |row| {
                Ok(PurchaseOrderLine {
                    id: row.get("id")?,
                    po_id: row.get("po_id")?,
                    sku: row.get("sku")?,
                    product_name: row.get("product_name")?,
                    qty: row.get("qty")?,
                    unit_cost_minor: row.get("unit_cost_minor")?,
                    line_total_minor: row.get("line_total_minor")?,
                    received_qty: row.get("received_qty")?,
                    damaged_qty: row.get("damaged_qty")?,
                })
            })?
            .map(|r| Ok(r?))
            .collect::<Result<Vec<_>, CoreError>>()?;
        order.lines = lines;

        Ok(Some(order))
    }

    /// Insert a new purchase order with line items (all in one transaction).
    ///
    /// The header INSERT and every line INSERT execute inside a single
    /// SQLite transaction (`unchecked_transaction` + `commit`). If any
    /// line INSERT fails, the entire batch — header and prior lines —
    /// rolls back, preventing the orphaned partial-PO state the previous
    /// autocommit version could leave behind.
    pub fn create_purchase_order(
        &self,
        po_number: &str,
        supplier_id: &str,
        expected_date: &str,
        notes: &str,
        created_by: Option<&str>,
        lines: &[CreatePoLineInput],
    ) -> Result<PurchaseOrderWithLines, CoreError> {
        if po_number.trim().is_empty() {
            return Err(CoreError::Validation {
                field: "po_number",
                message: "PO number must not be empty".into(),
            });
        }

        let id = uuid::Uuid::now_v7().to_string();
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

        let mut subtotal: i64 = 0;
        for line in lines {
            if line.qty < 0 {
                return Err(CoreError::Validation {
                    field: "qty",
                    message: "quantity must not be negative".into(),
                });
            }
            if line.unit_cost_minor < 0 {
                return Err(CoreError::Validation {
                    field: "unit_cost_minor",
                    message: "unit cost must not be negative".into(),
                });
            }
            // MONEY-05: CreatePoLineInput arrives over IPC (untrusted) and
            // dev/test builds disable overflow checks, so a bare `*` silently
            // wraps and the PO is persisted with a corrupt subtotal. Match the
            // compute_line_tax (TAX-04) checked-arithmetic pattern.
            let line_total = line.qty.checked_mul(line.unit_cost_minor).ok_or_else(|| {
                CoreError::Validation {
                    field: "line_total",
                    message: "line total overflow".into(),
                }
            })?;
            subtotal = subtotal
                .checked_add(line_total)
                .ok_or_else(|| CoreError::Validation {
                    field: "subtotal",
                    message: "purchase order subtotal overflow".into(),
                })?;
        }

        let tx = self.conn.unchecked_transaction()?;

        tx.execute(
            "INSERT INTO purchase_orders (id, po_number, supplier_id, status, order_date,
                                          expected_date, subtotal_minor, tax_minor, total_minor,
                                          notes, created_by, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'draft', ?4, ?5, ?6, 0, ?7, ?8, ?9, ?10, ?11)",
            params![
                id,
                po_number.trim(),
                supplier_id,
                now,
                expected_date,
                subtotal,
                subtotal,
                notes,
                created_by,
                now,
                now
            ],
        )?;

        let mut created_lines: Vec<PurchaseOrderLine> = Vec::with_capacity(lines.len());
        for line in lines {
            let line_id = uuid::Uuid::now_v7().to_string();
            // MONEY-05: re-validate per line — the same overflow contract as
            // the subtotal pass above. (Recompute is intentional: the insert
            // loop must never trust a bare multiply.)
            let line_total = line.qty.checked_mul(line.unit_cost_minor).ok_or_else(|| {
                CoreError::Validation {
                    field: "line_total",
                    message: "line total overflow".into(),
                }
            })?;
            tx.execute(
                "INSERT INTO purchase_order_lines (id, po_id, sku, product_name, qty,
                                                    unit_cost_minor, line_total_minor)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    line_id,
                    id,
                    line.sku,
                    line.product_name,
                    line.qty,
                    line.unit_cost_minor,
                    line_total
                ],
            )?;
            created_lines.push(PurchaseOrderLine {
                id: line_id,
                po_id: id.clone(),
                sku: line.sku.to_owned(),
                product_name: line.product_name.to_owned(),
                qty: line.qty,
                unit_cost_minor: line.unit_cost_minor,
                line_total_minor: line_total,
                received_qty: 0,
                damaged_qty: 0,
            });
        }

        tx.commit()?;

        Ok(PurchaseOrderWithLines {
            order: PurchaseOrder {
                id,
                po_number: po_number.trim().to_owned(),
                supplier_id: supplier_id.to_owned(),
                status: "draft".into(),
                order_date: now.clone(),
                expected_date: expected_date.to_owned(),
                received_date: None,
                subtotal_minor: subtotal,
                tax_minor: 0,
                total_minor: subtotal,
                notes: notes.to_owned(),
                created_by: created_by.map(|s| s.to_owned()),
                created_at: now.clone(),
                updated_at: now,
            },
            lines: created_lines,
            supplier_name: None,
        })
    }

    /// Update the status of a purchase order.
    pub fn update_po_status(
        &self,
        id: &str,
        new_status: &str,
    ) -> Result<PurchaseOrderWithLines, CoreError> {
        let valid_statuses = ["draft", "pending", "approved", "received", "cancelled"];
        if !valid_statuses.contains(&new_status) {
            return Err(CoreError::Validation {
                field: "status",
                message: format!("invalid status: {new_status}"),
            });
        }

        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let rows = self.conn.execute(
            "UPDATE purchase_orders SET status=?1, updated_at=?2 WHERE id=?3",
            params![new_status, now, id],
        )?;

        if rows == 0 {
            return Err(CoreError::NotFound {
                entity: "purchase_order",
                id: id.to_owned(),
            });
        }

        self.get_purchase_order(id)?.ok_or(CoreError::NotFound {
            entity: "purchase_order",
            id: id.to_owned(),
        })
    }

    /// Mark a purchase order as received and adjust inventory quantities.
    #[allow(deprecated)]
    pub fn receive_purchase_order(&self, id: &str) -> Result<PurchaseOrderWithLines, CoreError> {
        let mut po = self.get_purchase_order(id)?.ok_or(CoreError::NotFound {
            entity: "purchase_order",
            id: id.to_owned(),
        })?;

        if po.order.status != "approved" {
            return Err(CoreError::Validation {
                field: "status",
                message: "only approved orders can be received".into(),
            });
        }

        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

        // Wrap the PO status update AND all stock adjustments in a single
        // transaction so the receive is atomic: if any line's
        // adjust_stock fails, the status change and all prior lines are
        // rolled back. This matches the atomicity contract documented in
        // db/mod.rs ("All writes that touch more than one row use
        // unchecked_transaction for atomicity") and ADR-19 §5.2 (caller
        // is responsible for BEGIN IMMEDIATE atomicity).
        let tx = self.conn.unchecked_transaction()?;

        tx.execute(
            "UPDATE purchase_orders SET status='received', received_date=?1, updated_at=?2 WHERE id=?3",
            params![now, now, id],
        )?;

        let default_location = crate::inventory::LocationId::from(
            crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID.to_string(),
        );
        for line in &po.lines {
            if !line.sku.is_empty() {
                // Use the transactional canonical API (accepts &Transaction)
                // rather than adjust_stock() which starts its own
                // transaction — that would break atomicity. Propagate
                // errors via ? instead of silently swallowing them.
                self.adjust_stock_at_location_with_reason(
                    &tx,
                    &line.sku,
                    line.qty,
                    &default_location,
                    Some("purchase_order_receive"),
                    None,
                    None,
                    None,
                )?;
            }
        }

        tx.commit()?;

        po.order.status = "received".into();
        po.order.received_date = Some(now.clone());
        po.order.updated_at = now;
        Ok(po)
    }

    /// Receive a purchase order with per-line received/damaged quantities
    /// (warehouse Phase 2).
    ///
    /// Each [`ReceivePoLineInput`] declares how many units of that line were
    /// received in good condition and how many arrived damaged. Only the
    /// good quantity is added to sellable stock; damaged units are recorded
    /// on the line (for the receiving report / supplier claim) but never
    /// enter stock. Short (ordered − received − damaged) is implied and
    /// surfaced via [`PurchaseOrderLine::short_qty`].
    ///
    /// Validation:
    /// - the PO must be `approved`
    /// - every line must be accounted: `received + damaged <= qty`, both
    ///   non-negative
    /// - the input must cover every line (or exactly the lines given —
    ///   uncovered lines are treated as fully short)
    ///
    /// Atomic: the status change, per-line writes, and all stock movements
    /// commit in one transaction.
    pub fn receive_purchase_order_with_lines(
        &self,
        id: &str,
        lines: &[ReceivePoLineInput],
    ) -> Result<PurchaseOrderWithLines, CoreError> {
        let po = self.get_purchase_order(id)?.ok_or(CoreError::NotFound {
            entity: "purchase_order",
            id: id.to_owned(),
        })?;

        if po.order.status != "approved" {
            return Err(CoreError::Validation {
                field: "status",
                message: "only approved orders can be received".into(),
            });
        }

        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let default_location = crate::inventory::LocationId::from(
            crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID.to_string(),
        );

        let tx = self.conn.unchecked_transaction()?;

        tx.execute(
            "UPDATE purchase_orders SET status='received', received_date=?1, updated_at=?2 WHERE id=?3",
            params![now, now, id],
        )?;

        // Index the input by line id for O(1) lookup.
        let by_line: std::collections::HashMap<&str, &ReceivePoLineInput> =
            lines.iter().map(|l| (l.line_id.as_str(), l)).collect();

        for line in &po.lines {
            let input = by_line.get(line.id.as_str());
            let received = input.map(|i| i.received_qty).unwrap_or(0);
            let damaged = input.map(|i| i.damaged_qty).unwrap_or(0);

            if received < 0 || damaged < 0 {
                return Err(CoreError::Validation {
                    field: "qty",
                    message: "received/damaged quantities must not be negative".into(),
                });
            }
            if received + damaged > line.qty {
                return Err(CoreError::Validation {
                    field: "qty",
                    message: format!(
                        "line '{}' received+damaged ({}+{}) exceeds ordered qty ({})",
                        line.sku, received, damaged, line.qty
                    ),
                });
            }

            // Persist the receive state on the line.
            tx.execute(
                "UPDATE purchase_order_lines SET received_qty=?1, damaged_qty=?2 WHERE id=?3",
                params![received, damaged, line.id],
            )?;

            // Only good received units enter sellable stock.
            if received > 0 && !line.sku.is_empty() {
                self.adjust_stock_at_location_with_reason(
                    &tx,
                    &line.sku,
                    received,
                    &default_location,
                    Some("purchase_order_receive"),
                    None,
                    None,
                    None,
                )?;
            }
        }

        tx.commit()?;

        // Re-load so the returned lines carry the persisted receive state.
        let updated = self.get_purchase_order(id)?.ok_or(CoreError::NotFound {
            entity: "purchase_order",
            id: id.to_owned(),
        })?;
        Ok(updated)
    }
}

/// Input for receiving one purchase order line with damage accounting.
#[derive(Debug, Clone)]
pub struct ReceivePoLineInput {
    /// The `purchase_order_lines.id` being received.
    pub line_id: String,
    /// Units received in good condition (added to stock).
    pub received_qty: i64,
    /// Units received but damaged (recorded, not added to stock).
    pub damaged_qty: i64,
}

/// Input for creating a purchase order line item.
#[derive(Debug, Clone)]
pub struct CreatePoLineInput {
    /// SKU of the product being ordered.
    pub sku: String,
    /// Display name of the product.
    pub product_name: String,
    /// Quantity ordered (must not be negative).
    pub qty: i64,
    /// Unit cost in minor units (must not be negative).
    pub unit_cost_minor: i64,
}

#[cfg(test)]
#[path = "purchase_orders_tests.rs"]
mod tests;
