/*
last audited DD-MM-YY by DSH-Agent
crate: foundation (cart.rs) | status: SAFE | lint: CLEAN
findings: exemplary — MONEY-AUDIT-3 fixes verified intact (CartLine::total fails closed on serde-bypassed qty<=0; discount_amount never masks with .or(Some(zero))); fixed discount capped via Money::min; debug_assert currency guards for direct-field mutation. COR-33 FIXED DD-MM-YY — ~850 lines of inline tests moved to sibling cart_tests.rs (per AGENTS.md: "never put unit tests inside production .rs files").
next: none | perf: discount folds lines once
*/
//! Cart and CartLine — the in-memory sale pipeline.
//!
//! A `Cart` is created with a [`Currency`], lines are added via
//! [`Cart::add_line`], and the total is computed by summing line totals
//! in checked arithmetic.

use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

use crate::money::{Currency, Money};
use crate::percentage::Percentage;
use crate::sku::{LineId, Sku};

/// Unique identifier for a cart.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct CartId(pub Uuid);

impl CartId {
    /// Create a new cart identifier backed by a UUID v7.
    #[must_use]
    pub fn new() -> Self {
        Self(Uuid::now_v7())
    }
}

impl Default for CartId {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Display for CartId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// A single line in a cart.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CartLine {
    /// Unique line identifier.
    pub id: LineId,
    /// The product SKU.
    pub sku: Sku,
    /// Quantity ordered (must be > 0).
    pub qty: i64,
    /// Base unit price (before per-line override).
    pub unit_price: Money,
    /// Optional per-line price override.
    pub overridden_price: Option<Money>,
}

impl CartLine {
    /// Construct a new line. `qty` is asserted > 0.
    ///
    /// # Panics
    /// Panics if `qty <= 0`.
    pub fn new(sku: Sku, qty: i64, unit_price: Money) -> Self {
        assert!(qty > 0, "qty must be > 0, got {qty}");
        Self {
            id: LineId::new(),
            sku,
            qty,
            unit_price,
            overridden_price: None,
        }
    }

    /// Total for this line: `unit_price * qty`, in minor units.
    /// If [`overridden_price`](Self::overridden_price) is set, uses that instead.
    ///
    /// # Panics (debug only)
    ///
    /// In debug builds, panics if `overridden_price` is set but its currency
    /// does not match `unit_price.currency`. This guards against direct field
    /// mutation bypassing [`set_overridden_price`](Self::set_overridden_price).
    ///
    /// # Errors
    ///
    /// Returns `None` on `i64` overflow **or** when `qty <= 0`. `qty <= 0`
    /// cannot occur through [`CartLine::new`] (which asserts `qty > 0`), but
    /// it CAN occur through `serde` deserialization of a persisted cart (the
    /// fields are public and `Deserialize` does not run the constructor
    /// assert). Returning `None` makes a corrupt persisted line fail closed
    /// instead of silently computing a zero or negative total.
    #[must_use]
    pub fn total(&self) -> Option<Money> {
        if self.qty <= 0 {
            return None;
        }
        let price = self.overridden_price.unwrap_or(self.unit_price);
        debug_assert!(
            price.currency == self.unit_price.currency,
            "CartLine::total: overridden_price currency ({}) does not match unit_price currency ({})",
            price.currency,
            self.unit_price.currency
        );
        price.checked_mul(self.qty)
    }

    /// Override the unit price for this line.
    ///
    /// Returns `Err(CartError::CurrencyMismatch)` if `price.currency`
    /// does not match `self.unit_price.currency`.
    pub fn set_overridden_price(&mut self, price: Money) -> Result<(), CartError> {
        if price.currency != self.unit_price.currency {
            return Err(CartError::CurrencyMismatch {
                cart: self.unit_price.currency.to_string(),
                line: price.currency.to_string(),
            });
        }
        self.overridden_price = Some(price);
        Ok(())
    }
}

/// Failure modes for cart mutations.
#[derive(Debug, Error, PartialEq, Eq)]
#[non_exhaustive]
pub enum CartError {
    /// Line currency does not match the cart currency.
    #[error("currency mismatch: cart is {cart}, line is {line}")]
    CurrencyMismatch {
        /// Cart currency code.
        cart: String,
        /// Line currency code.
        line: String,
    },
    /// Attempted to remove a SKU that is not in the cart.
    #[error("sku not in cart: {0}")]
    SkuNotInCart(String),
}

/// An open cart scoped to a single currency.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Cart {
    id: CartId,
    currency: Currency,
    lines: Vec<CartLine>,
    #[serde(default)]
    discount_percent: Percentage,
    #[serde(default)]
    discount_label: Option<String>,
    /// Fixed discount in minor currency units, applied after any percentage discount.
    #[serde(default)]
    fixed_discount_minor: i64,
}

impl Cart {
    /// Create a new empty cart in the given currency.
    #[must_use]
    pub fn new(currency: Currency) -> Self {
        Self {
            id: CartId::new(),
            currency,
            lines: Vec::new(),
            discount_percent: Percentage::zero(),
            discount_label: None,
            fixed_discount_minor: 0,
        }
    }

    /// Return the cart's unique identifier.
    #[must_use]
    pub fn id(&self) -> CartId {
        self.id
    }
    /// Return the currency scoped to this cart.
    #[must_use]
    pub fn currency(&self) -> Currency {
        self.currency
    }
    /// Return a shared reference to the line items.
    #[must_use]
    pub fn lines(&self) -> &[CartLine] {
        &self.lines
    }
    /// Return a mutable reference to the line items.
    pub fn lines_mut(&mut self) -> &mut [CartLine] {
        &mut self.lines
    }
    /// Return the number of line items.
    #[must_use]
    pub fn line_count(&self) -> usize {
        self.lines.len()
    }
    /// Return the discount percentage as an integer (0–100).
    #[must_use]
    pub fn discount_percent(&self) -> i64 {
        self.discount_percent.get() as i64
    }
    /// Return an optional label for the current discount.
    #[must_use]
    pub fn discount_label(&self) -> Option<&str> {
        self.discount_label.as_deref()
    }

    /// Get the discount as a [`Percentage`] value.
    #[must_use]
    pub fn discount_percentage(&self) -> Percentage {
        self.discount_percent
    }

    /// Set a cart-level percentage discount and clear any fixed discount.
    pub fn set_discount(&mut self, percent: Percentage, label: Option<String>) {
        self.discount_percent = percent;
        self.fixed_discount_minor = 0;
        self.discount_label = if percent.get() == 0 { None } else { label };
    }

    /// Set a fixed cart discount in minor currency units.
    ///
    /// The amount is capped at the cart's payable total when the total is
    /// calculated, so a discount can safely be applied before all lines exist.
    pub fn set_fixed_discount(&mut self, minor_units: i64, label: Option<String>) {
        self.fixed_discount_minor = minor_units.max(0);
        self.discount_label = if self.fixed_discount_minor == 0 {
            None
        } else {
            label
        };
    }

    /// Return the fixed discount in minor currency units.
    #[must_use]
    pub fn fixed_discount_minor(&self) -> i64 {
        self.fixed_discount_minor
    }

    /// Append a line. Returns `Err` on currency mismatch.
    pub fn add_line(&mut self, line: CartLine) -> Result<LineId, CartError> {
        if line.unit_price.currency != self.currency {
            return Err(CartError::CurrencyMismatch {
                cart: currency_summary(&self.currency),
                line: currency_summary(&line.unit_price.currency),
            });
        }
        let id = line.id;
        self.lines.push(line);
        Ok(id)
    }

    /// Remove every line with the given SKU.
    pub fn remove_sku(&mut self, sku: &str) -> Result<usize, CartError> {
        let before = self.lines.len();
        self.lines.retain(|l| l.sku.as_str() != sku);
        let removed = before - self.lines.len();
        if removed == 0 {
            Err(CartError::SkuNotInCart(sku.to_owned()))
        } else {
            Ok(removed)
        }
    }

    /// Sum of all line totals, minus any discount.
    ///
    /// # Panics (debug only)
    ///
    /// In debug builds, panics if any line's effective currency (unit_price
    /// or overridden_price) does not match the cart's currency.
    ///
    /// Returns `None` on overflow or currency mismatch (both are
    /// caught by [`Money::checked_add`] in every profile).
    #[must_use]
    pub fn total(&self) -> Option<Money> {
        let mut acc = Money::zero(self.currency);
        for line in &self.lines {
            debug_assert!(
                line.unit_price.currency == self.currency,
                "Cart::total: line unit_price currency ({}) does not match cart currency ({})",
                line.unit_price.currency,
                self.currency
            );
            let t = line.total()?;
            acc = acc.checked_add(t)?;
        }
        if self.discount_percent.get() > 0 {
            acc = self.discount_percent.complement_apply_to(acc)?;
        }
        if self.fixed_discount_minor > 0 {
            // Cap the fixed discount at the payable total. Both amounts are
            // in `self.currency`, so `Money::min` cannot return `None` here;
            // the `?` propagates a mismatch the same way `checked_sub` does.
            let fixed = Money {
                minor_units: self.fixed_discount_minor,
                currency: self.currency,
            };
            acc = acc.checked_sub(fixed.min(acc)?)?;
        }
        Some(acc)
    }

    /// The discount amount in minor units, or 0 if no discount.
    ///
    /// # Panics (debug only)
    ///
    /// In debug builds, panics if any line's effective currency does not
    /// match the cart's currency.
    ///
    /// Returns `None` on overflow, currency mismatch, or a corrupt line
    /// (`qty <= 0` deserialized from a persisted cart) — the same
    /// fail-closed contract as [`Cart::total`](Self::total).
    #[must_use]
    pub fn discount_amount(&self) -> Option<Money> {
        let mut subtotal = Money::zero(self.currency);
        for line in &self.lines {
            debug_assert!(
                line.unit_price.currency == self.currency,
                "Cart::discount_amount: line unit_price currency ({}) does not match cart currency ({})",
                line.unit_price.currency,
                self.currency
            );
            let t = line.total()?;
            subtotal = subtotal.checked_add(t)?;
        }
        if self.discount_percent.get() == 0 && self.fixed_discount_minor == 0 {
            return Some(Money::zero(self.currency));
        }
        let discounted = if self.discount_percent.get() > 0 {
            self.discount_percent.complement_apply_to(subtotal)?
        } else {
            subtotal
        };
        let fixed = Money {
            minor_units: self.fixed_discount_minor,
            currency: self.currency,
        };
        // Both subtractions are on amounts capped by `fixed.min(discounted)`
        // (which cannot fail here: both operands are in `self.currency`), so
        // they cannot underflow. `?` propagates any overflow as `None` — we
        // deliberately do NOT fall back to a zero discount here, because a
        // failure means the discount amount is unknown, not zero.
        let capped = fixed.min(discounted)?;
        let total_after_discount = discounted.checked_sub(capped)?;
        subtotal.checked_sub(total_after_discount)
    }
}

fn currency_summary(c: &Currency) -> String {
    std::str::from_utf8(&c.0).unwrap_or("???").to_owned()
}

#[cfg(test)]
#[path = "cart_tests.rs"]
mod tests;
