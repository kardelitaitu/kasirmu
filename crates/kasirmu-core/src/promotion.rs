//! Promotions domain type — buy-X-get-Y, % off, fixed discount.
//!
//! A [`Promotion`] defines a discount rule that can be applied to a sale.
//! The [`PromotionType`] enum discriminates between percentage discounts,
//! fixed-amount discounts, and buy-X-get-Y promotions. Applications are
//! recorded in [`PromotionApplication`] rows for audit and reporting.

use serde::{Deserialize, Serialize};

/// Type of promotion.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PromotionType {
    /// Percentage off the product price (value_minor = percent, e.g. 10 = 10%).
    Percentage,
    /// Fixed amount off in minor units.
    FixedAmount,
    /// Buy X, get Y at a discount (value_minor = discount % on the reward item).
    BuyXGetY,
}

impl PromotionType {
    /// Return the string representation used in the database.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Percentage => "percentage",
            Self::FixedAmount => "fixed_amount",
            Self::BuyXGetY => "buy_x_get_y",
        }
    }

    /// Parse a promotion type from its database string representation.
    #[allow(clippy::should_implement_trait)]
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "percentage" => Some(Self::Percentage),
            "fixed_amount" => Some(Self::FixedAmount),
            "buy_x_get_y" => Some(Self::BuyXGetY),
            _ => None,
        }
    }
}

/// A promotion rule.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Promotion {
    /// Unique identifier (UUID v7).
    pub id: String,
    /// Human-readable name for display on receipts and the POS UI.
    pub name: String,
    /// Optional detailed description of the promotion terms.
    pub description: String,
    /// Database string for the promotion type.
    pub promo_type: String,
    /// Numeric value whose meaning depends on `promo_type`.
    pub value_minor: i64,
    /// Minimum quantity the customer must buy (buy-X-get-Y only).
    pub min_qty: Option<i64>,
    /// Product SKU that must be in the cart (buy-X-get-Y only).
    pub trigger_sku: Option<String>,
    /// Product SKU that receives the discount (buy-X-get-Y, empty = trigger).
    pub reward_sku: Option<String>,
    /// How many reward items the customer receives (buy-X-get-Y).
    pub reward_qty: Option<i64>,
    /// ISO-8601 start timestamp for time-limited promotions.
    pub starts_at: Option<String>,
    /// ISO-8601 end timestamp for time-limited promotions.
    pub ends_at: Option<String>,
    /// Minimum order subtotal in minor units for the promotion to apply.
    pub min_order_minor: i64,
    /// Optional category ID that this promotion applies to.
    pub category_id: Option<String>,
    /// Whether this promotion is currently active.
    pub active: bool,
    /// ISO-8601 creation timestamp.
    pub created_at: String,
    /// ISO-8601 last-update timestamp.
    pub updated_at: String,
}

/// Record of a promotion being applied to a sale.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PromotionApplication {
    /// Unique identifier (UUID v7).
    pub id: String,
    /// FK to `promotions.id`.
    pub promotion_id: String,
    /// FK to `sales.id`.
    pub sale_id: String,
    /// Discount amount applied, in minor units.
    pub discount_minor: i64,
    /// Human-readable description of the discount applied.
    pub description: String,
    /// ISO-8601 creation timestamp.
    pub created_at: String,
}

#[cfg(test)]
#[path = "promotion_tests.rs"]
mod tests;
