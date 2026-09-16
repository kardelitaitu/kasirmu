//! Sales domain types — sale lifecycle, refund models, and report row structures.
/*
last audited 25-07-26 by RSA-Agent (modules-sales slice A: models deep read)
crate: modules-sales | status: SAFE | lint: CLEAN
findings: clean — Money i64 minor units throughout (no floats); transition_to duplicates foundation's exhaustive matrix (test-pinned both directions); CUR-02 multi-currency fields documented for refund reconstruction; TAX-02 per-line tax breakdown JSON; optimistic-concurrency version; empty-cart sale is deliberate (zero-total, test-pinned)
next: none | perf: N/A
*/

use foundation::{Cart, Currency, InvalidTransition, Money, SaleStatus};
use serde::{Deserialize, Serialize};

/// Default version generator for optimistic concurrency.
pub fn default_version() -> i64 {
    1
}

/// A single line item within a sale.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SaleLine {
    /// Internal row id (UUID v4).
    pub id: String,

    /// FK to `sales.id`.
    pub sale_id: String,

    /// The product SKU at time of sale.
    pub sku: String,

    /// Quantity sold (≥ 1).
    pub qty: i64,

    /// Unit price at time of sale (in minor units).
    pub unit_price: Money,

    /// Line total: `unit_price * qty` (in minor units).
    pub line_total: Money,

    /// Ordinal position of this line within the sale (1-indexed).
    pub line_position: i64,

    /// Tax amount for this line (same currency as the sale).
    #[serde(default)]
    pub tax_amount: Money,

    /// Tax rate ID applied to this line (first applicable rate only).
    #[serde(default)]
    pub tax_rate_id: Option<String>,

    /// Full per-rate tax breakdown as a JSON array string (TAX-02 auditability).
    ///
    /// Each element: `{ "rate_id": "…" | null, "rate_bps": int,
    /// "is_inclusive": bool, "tax_minor": int }`. `rate_id` is null for
    /// Lua-override lines. `None` when no tax applies or for legacy rows
    /// (pre-migration 110).
    #[serde(default)]
    pub tax_breakdown_json: Option<String>,

    /// Serial number captured at checkout for this line item.
    #[serde(default)]
    pub serial_number: Option<String>,

    /// Course assignment (e.g. "appetizer", "main", "dessert").
    /// `None` for non-restaurant sales or legacy records.
    #[serde(default)]
    pub course: Option<String>,

    /// Modifier choices as JSON array string.
    /// Each element: `{ "name": "Temperature", "choice": "Medium Rare", "price_minor": 0 }`.
    /// `None` or empty string when no modifiers.
    #[serde(default)]
    pub modifiers_json: Option<String>,
}

/// A point-of-sale transaction with line items and a state machine.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Sale {
    /// Internal row id (UUID v4).
    pub id: String,

    /// Current state of the sale.
    pub status: SaleStatus,

    /// Grand total, computed from lines.
    pub total: Money,

    /// Number of line items.
    pub line_count: i64,

    /// Currency for all monetary values in this sale.
    pub currency: Currency,

    /// Payment method used ("cash", "card", "other", or `None`).
    pub payment_method: Option<String>,

    /// Amount tendered by the customer in minor units (for cash).
    pub tendered_minor: Option<i64>,

    /// User ID of the cashier who processed this sale.
    #[serde(default)]
    pub user_id: Option<String>,

    /// ISO-8601 creation timestamp.
    pub created_at: String,

    /// ISO-8601 timestamp of the last state transition.
    pub updated_at: String,

    /// Line items in positional order.
    pub lines: Vec<SaleLine>,

    /// Discount percentage applied (0-100). 0 means no discount.
    #[serde(default)]
    pub discount_percent: i64,

    /// Human-readable discount label (e.g. "Senior 10%").
    #[serde(default)]
    pub discount_label: Option<String>,

    /// Subtotal before discount (sum of line totals).
    #[serde(default)]
    pub subtotal: Money,

    /// Total tax amount across all line items.
    #[serde(default)]
    pub tax_total: Money,

    /// Customer ID linked to this sale for loyalty tracking.
    #[serde(default)]
    pub customer_id: Option<String>,

    /// CUR-02: original sale currency before multi-currency conversion.
    /// `None` for single-currency sales (the common case). When set, the
    /// sale was charged in a different tender currency and these fields
    /// record the base amount and the rate used, so refunds/reconciliation
    /// can reconstruct the original amount.
    #[serde(default)]
    pub base_currency: Option<String>,
    /// Original sale total in `base_currency` minor units (before
    /// conversion). `None` for single-currency sales.
    #[serde(default)]
    pub base_total_minor: Option<i64>,
    /// Fixed-point exchange rate (millionths) used for the conversion,
    /// in the direction `base_currency → sale.currency`. `None` for
    /// single-currency sales.
    #[serde(default)]
    pub tender_rate_millionths: Option<i64>,

    /// Tip amount in minor units collected at checkout (default 0).
    /// Persisted so the recorded total reflects what the customer paid.
    #[serde(default)]
    pub tip_minor: i64,
    /// Service-charge amount in minor units collected at checkout
    /// (default 0).
    #[serde(default)]
    pub service_charge_minor: i64,

    /// Optimistic concurrency version.
    #[serde(default = "default_version")]
    pub version: i64,
}

impl Sale {
    /// Create a new sale from a [`Cart`].
    pub fn from_cart(cart: &Cart) -> Option<Self> {
        Self::from_cart_with_user(cart, None)
    }

    /// Create a new sale from a [`Cart`], with an optional user_id.
    pub fn from_cart_with_user(cart: &Cart, user_id: Option<String>) -> Option<Self> {
        let id = uuid::Uuid::now_v7().to_string();
        let total = cart.total()?;
        let currency = cart.currency();
        let line_count = cart.line_count() as i64;
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

        let lines: Vec<SaleLine> = cart
            .lines()
            .iter()
            .enumerate()
            .map(|(i, cl)| {
                let line_total = cl.total()?;
                Some(SaleLine {
                    id: uuid::Uuid::now_v7().to_string(),
                    sale_id: id.clone(),
                    sku: cl.sku.as_str().to_owned(),
                    qty: cl.qty,
                    unit_price: cl.unit_price,
                    line_total,
                    line_position: (i as i64) + 1,
                    tax_amount: Money::zero(currency),
                    tax_rate_id: None,
                    tax_breakdown_json: None,
                    serial_number: None,
                    // Restaurant coursing: carried from the cart line (assigned
                    // via `set_line_course_scoped` or at add time). `None` for
                    // non-restaurant sales; modifiers stay `None` until the
                    // modifiers tranche wires them through the same path.
                    course: cl.course.clone(),
                    modifiers_json: None,
                })
            })
            .collect::<Option<Vec<_>>>()?;

        Some(Self {
            id,
            status: SaleStatus::Pending,
            total,
            line_count,
            currency,
            payment_method: None,
            tendered_minor: None,
            user_id,
            customer_id: None,
            base_currency: None,
            base_total_minor: None,
            tender_rate_millionths: None,
            tip_minor: 0,
            service_charge_minor: 0,
            created_at: now.clone(),
            updated_at: now,
            lines,
            discount_percent: cart.discount_percent(),
            discount_label: cart.discount_label().map(String::from),
            subtotal: Money::zero(currency),
            tax_total: Money::zero(currency),
            version: 1,
        })
    }

    /// Transition to a new state.
    pub fn transition_to(&mut self, to: SaleStatus) -> Result<(), InvalidTransition> {
        let from = self.status;
        let valid = matches!(
            (from, to),
            (SaleStatus::Pending, SaleStatus::Active)
                | (SaleStatus::Active, SaleStatus::Completed)
                | (SaleStatus::Active, SaleStatus::Voided)
        );

        if valid {
            self.status = to;
            Ok(())
        } else {
            Err(InvalidTransition { from, to })
        }
    }

    /// True when the sale cannot be modified further.
    pub fn is_terminal(&self) -> bool {
        self.status.is_terminal()
    }
}

/// A refund against a completed sale.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Refund {
    /// Internal row id (UUID v4).
    pub id: String,
    /// FK to the original sale.
    pub sale_id: String,
    /// Total refund amount in minor units.
    pub total: Money,
    /// Reason for the refund.
    pub reason: String,
    /// Internal note about the refund.
    pub note: String,
    /// User ID of the staff member who processed the refund.
    pub processed_by: String,
    /// ISO-8601 creation timestamp.
    pub created_at: String,
    /// Line items being refunded.
    pub lines: Vec<RefundLine>,
}

/// A single line item within a refund.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RefundLine {
    /// Internal row id (UUID v4).
    pub id: String,
    /// FK to the refund.
    pub refund_id: String,
    /// FK to the original sale line.
    pub sale_line_id: String,
    /// SKU of the refunded product.
    pub sku: String,
    /// Quantity refunded.
    pub qty: i64,
    /// Unit price at time of refund.
    pub unit_price: Money,
    /// Line total (unit_price * qty).
    pub line_total: Money,
    /// ISO-8601 creation timestamp.
    pub created_at: String,
}

impl RefundLine {
    /// Create a new refund line item.
    pub fn new(
        sale_line_id: impl Into<String>,
        sku: impl Into<String>,
        qty: i64,
        unit_price: Money,
        line_total: Money,
    ) -> Self {
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        Self {
            id: uuid::Uuid::now_v7().to_string(),
            refund_id: String::new(),
            sale_line_id: sale_line_id.into(),
            sku: sku.into(),
            qty,
            unit_price,
            line_total,
            created_at: now,
        }
    }
}

impl Refund {
    /// Create a new refund for the given sale.
    pub fn new(
        sale_id: impl Into<String>,
        total: Money,
        reason: impl Into<String>,
        note: impl Into<String>,
        processed_by: impl Into<String>,
        lines: Vec<RefundLine>,
    ) -> Self {
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let id = uuid::Uuid::now_v7().to_string();
        let mut lines = lines;
        for line in &mut lines {
            line.refund_id = id.clone();
        }
        Self {
            id,
            sale_id: sale_id.into(),
            total,
            reason: reason.into(),
            note: note.into(),
            processed_by: processed_by.into(),
            created_at: now,
            lines,
        }
    }
}

/// Lightweight header row representing a held cart.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HeldCartRow {
    /// Unique held cart ID.
    pub id: String,
    /// Optional customer / tab reference.
    pub customer_ref: Option<String>,
    /// Cart summary note.
    pub note: Option<String>,
    /// ISO-8601 creation timestamp.
    pub created_at: String,
    /// Number of line items.
    pub line_count: i64,
    /// Total minor units.
    pub total_minor: i64,
    /// Currency code (e.g. "USD").
    pub currency: String,
}

/// Full held cart representation including line items.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HeldCartFull {
    /// Header metadata.
    pub header: HeldCartRow,
    /// Embedded cart JSON.
    pub cart_json: String,
}

/// Daily sales summary aggregation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DailySummaryRow {
    /// Total number of sales recorded.
    pub total_sales: i64,
    /// Total revenue in minor units.
    pub total_revenue_minor: i64,
    /// Total voided sales.
    pub total_voids: i64,
    /// Currency code.
    pub currency: String,
}

/// Sales aggregated by hour of the day.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SalesByHourRow {
    /// Hour of the day (0-23).
    pub hour: u32,
    /// Number of sales in this hour.
    pub sale_count: i64,
    /// Total revenue in minor units in this hour.
    pub total_revenue_minor: i64,
}

#[cfg(test)]
#[path = "models_tests.rs"]
mod tests;
