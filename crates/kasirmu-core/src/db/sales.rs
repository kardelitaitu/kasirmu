/*
last audited 25-07-26 by RSA-Agent (oz-core slice B2: sales deep read; CLI-1 support 25-07-26: new tx-aware create_sale_in_tx + shared validate_sale_money/insert_sale_with_lines helpers); COR-7 re-audited 31-08-26 by docs-auditor (idempotency_key now persisted on both sale paths)
crate: oz-core | status: SAFE | lint: CLEAN
findings: money paths exemplary (MONEY-01..04 + TAX-02..06 in-line, checked arithmetic at every IPC boundary, explicit rounding modes, TAX-06 exclusive-total correction); COR-7 RESOLVED (re-audited 31-08-26, corrected 31-08-26): persisting the idempotency_key column was never the fix — the column existed and was already written on both sale paths (sales_checkout.rs:466/478, sales_lifecycle.rs:463/475); the bug was that nothing populated it and nothing read it back, so a retried checkout inserted a second full payment set. What actually closed it: the desktop command layer derives one key per split as {attempt_id}:{n} from a mount-scoped attempt id (apps/desktop-client/src/commands/pos.rs, stamp_attempt_split_keys), and Store::find_sale_by_idempotency_key (db/payments.rs) resolves an attempt key back to its sale so a replay returns the original receipt instead of tripping UNIQUE idx_payments_idempotency_key. The per-split index is load-bearing — a shared key would make one multi-tender sale collide with itself (pinned by complete_sale_deduction_persists_every_split_keyed_to_one_attempt); COR-8 LOW still open: void_sale (sales_lifecycle.rs:567) increments version and guards status='pending', but that is a state guard not the version CAS its comment claims, and the execute() row count is discarded so voiding an already-voided or completed sale returns Ok; COR-9 INFO: receipt-barcode lookup swallows DB errors via .ok(); COR-10 INFO: PartialStockResult travels inside Validation.message JSON (documented tradeoff)
next: check void_sale affected-rows and return Conflict, or add a real WHERE version = ?expected CAS (COR-8) | perf: batch SKU lookup avoids N+1; popularity recompute outside tx
*/
//! Sale domain core — shared DTOs, cross-part helpers, small query APIs.
//!
//! F-011 split: the big impl-Store groups moved to sibling part files
//! (`sales_checkout`, `sales_lifecycle`, `sales_crud`, `sales_tax`),
//! declared as child modules below so the crate public API and every
//! downstream path are unchanged. This parent keeps
//! the shared types (`CartLineTaxInput`, `CartTaxResult`, export and
//! held-cart rows), the cross-part helpers (`insert_sale_line`,
//! `validate_payment_splits_cover_total`, `compute_line_tax`), and the
//! export / held-cart / receipt-barcode queries.
//!
//! Invariant: monetary math is i64 minor units with checked arithmetic;
//! every DB write runs inside an explicit rusqlite transaction.

use rusqlite::params;

use crate::error::CoreError;
use crate::money::Currency;
use crate::tax_rate::RoundingMode;
use crate::{Money, Sale, SaleLine};

use super::Store;

// F-011 split: cohesive impl-Store groups moved to sibling part files;
// child-module wiring below keeps every downstream path unchanged. The
// parts hold inherent `impl Store` blocks + private fns, so no `pub use`
// re-exports are needed or wanted (globs would resolve to zero items and
// trip unused-import warnings).
#[path = "sales_checkout.rs"]
mod sales_checkout;

#[path = "sales_crud.rs"]
mod sales_crud;

#[path = "sales_lifecycle.rs"]
mod sales_lifecycle;

#[path = "sales_tax.rs"]
mod sales_tax;

/// Input for cart-level tax computation (used by IPC command).
#[derive(Debug, Clone, serde::Deserialize)]
pub struct CartLineTaxInput {
    /// Product SKU for rate lookup.
    pub sku: String,
    /// Quantity in this line.
    pub qty: i64,
    /// Unit price in minor units.
    pub unit_price_minor: i64,
}

/// Result of cart-level tax computation, including whether any EXCLUSIVE
/// rate applied. The frontend must add `tax_minor` to the payable total
/// ONLY when `has_exclusive` is true — inclusive tax is already embedded
/// in the displayed price, so adding it again would double-charge.
#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CartTaxResult {
    /// Total tax across all lines/rates, in minor units.
    pub tax_minor: i64,
    /// True when at least one applied rate is exclusive (tax added on top
    /// of the price). When false, all rates were inclusive or none applied.
    pub has_exclusive: bool,
}

// ── Export types ─────────────────────────────────────────────────────

/// Row returned by [`Store::export_daily_summary`].
#[derive(Debug, Clone, serde::Serialize)]
pub struct DailySummaryRow {
    /// Sale unique identifier.
    pub sale_id: String,
    /// Total sale amount in minor units (e.g. cents).
    pub total_minor: i64,
    /// ISO-4217 currency code.
    pub currency: String,
    /// Number of line items in the sale.
    pub line_count: i64,
    /// Sale status (e.g. "active", "completed", "voided").
    pub status: String,
    /// RFC-3339 timestamp of when the sale was created.
    pub created_at: String,
}

/// Row returned by [`Store::export_sales_by_hour`].
#[derive(Debug, Clone, serde::Serialize)]
pub struct SalesByHourRow {
    /// Hour of day (0–23).
    pub hour: i64,
    /// Total value of all sales in this hour, in minor units.
    pub total_minor: i64,
    /// Number of sales transacted in this hour.
    pub sale_count: i64,
}

/// Summary row for a held (parked) cart.
#[derive(Debug, Clone, serde::Serialize)]
pub struct HeldCartRow {
    /// Held cart unique identifier.
    pub id: String,
    /// User-assigned label for the cart.
    pub label: String,
    /// Number of line items in the cart.
    pub item_count: i64,
    /// Cart total in minor units.
    pub total_minor: i64,
    /// ISO-4217 currency code.
    pub currency: String,
    /// RFC-3339 timestamp of when the cart was parked.
    pub created_at: String,
    /// Type of cart: 'hold' or 'open_bill'.
    pub bill_type: String,
    /// Customer name (set when bill_type = 'open_bill').
    pub customer_name: Option<String>,
}

/// Full held cart data including the JSON cart_data blob.
#[derive(Debug, Clone, serde::Serialize)]
pub struct HeldCartFull {
    /// Held cart unique identifier.
    pub id: String,
    /// User-assigned label for the cart.
    pub label: String,
    /// JSON-encoded cart state (line items, discounts, etc.).
    pub cart_data: String,
    /// Number of line items in the cart.
    pub item_count: i64,
    /// Cart total in minor units.
    pub total_minor: i64,
    /// ISO-4217 currency code.
    pub currency: String,
    /// RFC-3339 timestamp of when the cart was parked.
    pub created_at: String,
    /// Type of cart: 'hold' or 'open_bill'.
    pub bill_type: String,
    /// Customer name (set when bill_type = 'open_bill').
    pub customer_name: Option<String>,
    /// ADR-19 §6.3: deduction location UUID locked at cart-start time.
    /// `None` for pre-095 held carts or legacy single-location deployments.
    pub deduction_location_id: Option<String>,
}

// ── Sale Deduction (ADR-19) ────────────────────────────────────────

/// MONEY-04: payment splits must cover the recorded sale total before a
/// sale may be persisted.
///
/// Over-tender is allowed (the difference becomes change back to the
/// customer); under-payment is rejected so a hostile IPC caller (or a buggy
/// front-end) cannot complete a sale for less than the ledger total. A
/// negative split is never legitimate and is rejected even when the sum
/// happens to cover the total. Summing uses checked arithmetic so a huge
/// split list cannot overflow past the total.
/// Insert one sale line with the HPP cost snapshot (ADR #36 reporting)
/// and the product-identity snapshot (REP-05).
///
/// The product's cost is frozen at write time so historical margins never
/// change when `products.cost_minor` is edited later. The product id, name
/// and category are frozen too, so renaming a product, moving it between
/// categories, or reusing a deleted product's sku cannot relabel historical
/// revenue in reports. NULL snapshots (missing product, or rows written
/// before the snapshot migration) fall back to the products join via
/// COALESCE in the reporting layer.
fn insert_sale_line(tx: &rusqlite::Transaction<'_>, line: &SaleLine) -> Result<(), CoreError> {
    let unit_cur =
        std::str::from_utf8(&line.unit_price.currency.0).map_err(|e| CoreError::Validation {
            field: "currency",
            message: format!("invalid UTF-8 in currency bytes: {e}"),
        })?;
    // `products.cost_minor` is `NOT NULL DEFAULT 0` — 0 means "cost not
    // set". Normalize it to NULL so an unset snapshot can never shadow a
    // later-set product cost in the reporting COALESCE fallback.
    let (cost_minor, product_id, product_name, category_id) = match tx.query_row(
        "SELECT cost_minor, id, name, category_id FROM products WHERE sku = ?1",
        params![line.sku],
        |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        },
    ) {
        Ok((c, pid, pname, cid)) => (if c > 0 { Some(c) } else { None }, pid, pname, cid),
        Err(rusqlite::Error::QueryReturnedNoRows) => (None, None, None, None),
        Err(e) => return Err(CoreError::Db(e)),
    };
    tx.execute(
        "INSERT INTO sale_lines (id, sale_id, sku, qty, unit_minor, line_minor, currency, line_position,
                                 tax_minor, tax_rate_id, tax_breakdown_json,
                                 serial_number, course, modifiers_json, cost_minor,
                                 product_id, product_name, category_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
        params![
            line.id,
            line.sale_id,
            line.sku,
            line.qty,
            line.unit_price.minor_units,
            line.line_total.minor_units,
            unit_cur,
            line.line_position,
            line.tax_amount.minor_units,
            line.tax_rate_id,
            line.tax_breakdown_json,
            line.serial_number,
            line.course,
            line.modifiers_json,
            cost_minor,
            product_id,
            product_name,
            category_id,
        ],
    )?;
    Ok(())
}

fn validate_payment_splits_cover_total(
    splits: &[crate::PaymentSplitArg],
    total_minor: i64,
) -> Result<(), CoreError> {
    let mut sum: i64 = 0;
    for split in splits {
        if split.amount_minor < 0 {
            return Err(CoreError::Validation {
                field: "payments",
                message: format!(
                    "payment split amount must be non-negative, got {}",
                    split.amount_minor
                ),
            });
        }
        sum = sum
            .checked_add(split.amount_minor)
            .ok_or_else(|| CoreError::Validation {
                field: "payments",
                message: "payment split total overflow".into(),
            })?;
    }
    if sum < total_minor {
        return Err(CoreError::Validation {
            field: "payments",
            message: format!("payment splits ({sum}) do not cover the sale total ({total_minor})"),
        });
    }
    Ok(())
}

// ── Export / Report queries ─────────────────────────────────────────

impl Store<'_> {
    /// Query all sales for today, ordered chronologically.
    ///
    /// "Today" is the store's business day (REP-03): both sides of the
    /// comparison use the store's UTC offset, so a UTC+7 store's day ends
    /// at 23:00Z, not midnightZ.
    pub fn export_daily_summary(&self) -> Result<Vec<DailySummaryRow>, CoreError> {
        let tz = self.tz_modifier();
        let mut stmt = self.conn.prepare(&format!(
            "SELECT id, total_minor, currency, line_count, status, created_at
             FROM sales WHERE DATE(created_at, '{tz}') = DATE('now', '{tz}') ORDER BY created_at"
        ))?;
        let rows = stmt.query_map([], |row| {
            Ok(DailySummaryRow {
                sale_id: row.get("id")?,
                total_minor: row.get("total_minor")?,
                currency: row.get("currency")?,
                line_count: row.get("line_count")?,
                status: row.get("status")?,
                created_at: row.get("created_at")?,
            })
        })?;
        rows.map(|r| Ok(r?)).collect()
    }

    /// Query sales volume grouped by hour of day (for the store's today,
    /// REP-03 — hours are store-local).
    pub fn export_sales_by_hour(&self) -> Result<Vec<SalesByHourRow>, CoreError> {
        let tz = self.tz_modifier();
        let mut stmt = self.conn.prepare(&format!(
            "SELECT CAST(strftime('%H', created_at, '{tz}') AS INTEGER) AS hour,
                    SUM(total_minor) AS total_minor, COUNT(*) AS sale_count
             FROM sales WHERE DATE(created_at, '{tz}') = DATE('now', '{tz}')
             GROUP BY hour ORDER BY hour",
        ))?;
        let rows = stmt.query_map([], |row| {
            Ok(SalesByHourRow {
                hour: row.get("hour")?,
                total_minor: row.get("total_minor")?,
                sale_count: row.get("sale_count")?,
            })
        })?;
        rows.map(|r| Ok(r?)).collect()
    }
}

// ── Held Carts ──────────────────────────────────────────────────────

impl Store<'_> {
    /// Persist a cart as a held (parked) order or open bill.
    ///
    /// `bill_type` should be `"hold"` or `"open_bill"`. When `customer_name`
    /// is set, it is stored alongside the cart for open-bill listing.
    ///
    /// `deduction_location_id` — ADR-19 §5.3 / §6.3: the deduction location
    /// locked on the active cart at cart-start time. Pass `None` for legacy
    /// single-location deployments. When restoring a held cart, the caller
    /// should set this value on the new active cart via `save_active_cart`.
    #[allow(clippy::too_many_arguments)]
    pub fn hold_cart(
        &self,
        label: &str,
        cart_data: &str,
        item_count: i64,
        total_minor: i64,
        currency: &str,
        bill_type: &str,
        customer_name: Option<&str>,
        deduction_location_id: Option<&str>,
    ) -> Result<String, CoreError> {
        let id = uuid::Uuid::now_v7().to_string();
        self.conn.execute(
            "INSERT INTO held_carts (id, label, cart_data, item_count, total_minor, currency, bill_type, customer_name, deduction_location_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                id,
                label.trim(),
                cart_data,
                item_count,
                total_minor,
                currency,
                bill_type,
                customer_name,
                deduction_location_id,
            ],
        )?;
        Ok(id)
    }

    /// List all held (parked) orders, most recent first.
    pub fn list_held_carts(&self) -> Result<Vec<HeldCartRow>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, label, item_count, total_minor, currency, created_at, bill_type, customer_name
             FROM held_carts ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(HeldCartRow {
                id: row.get("id")?,
                label: row.get("label")?,
                item_count: row.get("item_count")?,
                total_minor: row.get("total_minor")?,
                currency: row.get("currency")?,
                created_at: row.get("created_at")?,
                bill_type: row.get("bill_type")?,
                customer_name: row.get("customer_name")?,
            })
        })?;
        rows.map(|r| Ok(r?)).collect()
    }

    /// List only open bills (bill_type = 'open_bill'), most recent first.
    pub fn list_open_bills(&self) -> Result<Vec<HeldCartRow>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, label, item_count, total_minor, currency, created_at, bill_type, customer_name
             FROM held_carts WHERE bill_type = 'open_bill' ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(HeldCartRow {
                id: row.get("id")?,
                label: row.get("label")?,
                item_count: row.get("item_count")?,
                total_minor: row.get("total_minor")?,
                currency: row.get("currency")?,
                created_at: row.get("created_at")?,
                bill_type: row.get("bill_type")?,
                customer_name: row.get("customer_name")?,
            })
        })?;
        rows.map(|r| Ok(r?)).collect()
    }

    /// Look up a held cart by id.
    pub fn get_held_cart(&self, id: &str) -> Result<Option<HeldCartFull>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, label, cart_data, item_count, total_minor, currency, created_at, bill_type, customer_name, deduction_location_id
             FROM held_carts WHERE id = ?1",
        )?;
        let result = stmt.query_row(params![id], |row| {
            Ok(HeldCartFull {
                id: row.get("id")?,
                label: row.get("label")?,
                cart_data: row.get("cart_data")?,
                item_count: row.get("item_count")?,
                total_minor: row.get("total_minor")?,
                currency: row.get("currency")?,
                created_at: row.get("created_at")?,
                bill_type: row.get("bill_type")?,
                customer_name: row.get("customer_name")?,
                deduction_location_id: row.get("deduction_location_id")?,
            })
        });
        match result {
            Ok(c) => Ok(Some(c)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// Delete a held cart by id.
    pub fn delete_held_cart(&self, id: &str) -> Result<(), CoreError> {
        let rows = self
            .conn
            .execute("DELETE FROM held_carts WHERE id = ?1", params![id])?;
        if rows == 0 {
            return Err(CoreError::NotFound {
                entity: "held_cart",
                id: id.to_owned(),
            });
        }
        Ok(())
    }
}

// ── Receipt Barcodes ──────────────────────────────────────────────────

impl Store<'_> {
    /// Store a receipt barcode mapping for a sale.
    pub fn save_receipt_barcode(&self, sale_id: &str, barcode: &str) -> Result<(), CoreError> {
        let id = uuid::Uuid::now_v7().to_string();
        self.conn.execute(
            "INSERT INTO receipt_barcodes (id, sale_id, barcode) VALUES (?1, ?2, ?3)",
            params![id, sale_id, barcode],
        )?;
        Ok(())
    }

    /// Look up a sale by its receipt barcode.
    pub fn lookup_sale_by_receipt_barcode(&self, barcode: &str) -> Result<Option<Sale>, CoreError> {
        let sale_id: Option<String> = self
            .conn
            .query_row(
                "SELECT sale_id FROM receipt_barcodes WHERE barcode = ?1",
                params![barcode],
                |row| row.get(0),
            )
            .ok();

        match sale_id {
            Some(id) => self.get_sale(&id),
            None => Ok(None),
        }
    }
}

// ── Tax Computation ───────────────────────────────────────────────────

/// Compute the tax contribution for one line/rate pair with integer-safe
/// arithmetic (TAX-04) and an explicit rounding policy (TAX-05).
///
/// Exclusive tax: `base * bps / 10_000`; inclusive tax:
/// `base * bps / (10_000 + bps)`. Uses checked multiplication and
/// division so an extreme (bounded) rate or large amount cannot panic
/// or silently truncate through overflow. The fractional result is then
/// reduced per `mode` ([`RoundingMode::Truncate`] for legacy behavior,
/// [`RoundingMode::HalfUp`] as the recommended default).
fn compute_line_tax(
    base_minor: i64,
    rate_bps: i64,
    is_inclusive: bool,
    currency: Currency,
    mode: RoundingMode,
) -> Result<Money, CoreError> {
    let numerator = base_minor
        .checked_mul(rate_bps)
        .ok_or_else(|| CoreError::Validation {
            field: "tax",
            message: "tax multiplication overflow".into(),
        })?;
    let divisor = if is_inclusive {
        10_000i64
            .checked_add(rate_bps)
            .ok_or_else(|| CoreError::Validation {
                field: "rate_bps",
                message: "inclusive divisor overflow".into(),
            })?
    } else {
        10_000i64
    };
    let tax_minor = mode
        .divide(numerator, divisor)
        .ok_or_else(|| CoreError::Validation {
            field: "tax",
            message: "tax rounding overflow".into(),
        })?;
    Ok(Money {
        minor_units: tax_minor,
        currency,
    })
}

// ── Tests ─────────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "sales_tests.rs"]
mod tests;
