/*
last audited (date unknown) by DSH-Agent
crate: foundation (percentage.rs) | status: SAFE | lint: CLEAN
findings: exemplary — MONEY-AUDIT-2 overflow-free decomposition verified (100% of i64::MAX = i64::MAX, tested at edges); total arithmetic for any i64 x 0..=100; bounded u8 construction incl. serde path. COR-33 FIXED (date unknown) — inline tests moved to sibling percentage_tests.rs (per AGENTS.md: "never put unit tests inside production .rs files").
next: none | perf: two extra mul/add
*/
//! Percentage value object — a bounded 0–100 integer type.
//!
//! Use this instead of raw `i64`/`u8` wherever a percentage discount,
//! tax rate part, or proportional amount is needed. Construction is
//! fallible so callers never deal with out-of-range values.
//!
//! # Example
//!
//! ```
//! use foundation::{Money, Currency, Percentage};
//!
//! let pct = Percentage::new(10).unwrap();
//! let usd: Currency = "USD".parse().unwrap();
//! let amount = Money::from_major(20, usd).unwrap();
//!
//! assert_eq!(pct.apply_to(amount).unwrap().minor_units, 200);   // 10% of 2000¢
//! assert_eq!(pct.complement_apply_to(amount).unwrap().minor_units, 1800); // 90% of 2000¢
//! ```

use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::money::Money;

/// A percentage value guaranteed to be in the range `0..=100`.
///
/// Construction via [`Percentage::new`] validates the range immediately
/// so consumers never have to check bounds.
///
/// The inner value is stored as [`u8`] because percentages never exceed
/// 100, making the type smaller and cheaper than `i64`.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Percentage(u8);

impl Serialize for Percentage {
    fn serialize<S: Serializer>(&self, ser: S) -> Result<S::Ok, S::Error> {
        self.0.serialize(ser)
    }
}

impl<'de> Deserialize<'de> for Percentage {
    fn deserialize<D: Deserializer<'de>>(de: D) -> Result<Self, D::Error> {
        let val = u8::deserialize(de)?;
        Percentage::new(val).ok_or_else(|| {
            serde::de::Error::custom(format!("percentage must be between 0 and 100, got {val}"))
        })
    }
}

impl Percentage {
    /// Try to create a `Percentage` from a raw value.
    ///
    /// Returns `None` when `value > 100`.
    #[must_use]
    pub fn new(value: u8) -> Option<Self> {
        if value <= 100 {
            Some(Self(value))
        } else {
            None
        }
    }

    /// Return the raw percentage value (`0..=100`).
    #[must_use]
    pub fn get(&self) -> u8 {
        self.0
    }

    /// Apply this percentage to a [`Money`] amount.
    ///
    /// E.g. `Percentage::new(10).apply_to(Money::from_major(20, …))`
    /// returns `200` (10% of 2000¢ = 200¢).
    ///
    /// Computed as `(x * p) / 100` **without a full-width product**, using
    /// the identity `x = 100q + r  ⇒  (x*p)/100 = q*p + (r*p)/100`. This is
    /// exact under Rust's truncating division and never overflows for any
    /// `i64` amount and any percentage `0..=100` (both terms are bounded by
    /// `|x|` and 9900 respectively). The previous `checked_mul(p)`
    /// implementation spuriously returned `None` for amounts where the
    /// *product* overflowed but the *result* fit — e.g. 100% of `i64::MAX`
    /// (the largest representable discount) failed instead of returning
    /// `i64::MAX`.
    ///
    /// `Option` is retained for API stability; the arithmetic is total.
    #[must_use]
    pub fn apply_to(self, money: Money) -> Option<Money> {
        let x = money.minor_units;
        let p = i64::from(self.0);
        let q = x / 100;
        let r = x % 100;
        let hi = q.checked_mul(p)?; // |hi| ≤ |x| — cannot overflow
        let lo = r.checked_mul(p)?; // |lo| ≤ 9900 — cannot overflow
        Some(Money {
            minor_units: hi.checked_add(lo / 100)?,
            currency: money.currency,
        })
    }

    /// Apply the **complement** of this percentage (i.e. `100% - self`)
    /// to a [`Money`] amount.
    ///
    /// E.g. with a 10% discount, `complement_apply_to` returns 90% of the
    /// amount. This is a single combined operation: `amount × (100 - pct) / 100`.
    ///
    /// Same overflow-free decomposition as [`apply_to`](Self::apply_to);
    /// never fails for any `i64` amount and any percentage `0..=100`.
    #[must_use]
    pub fn complement_apply_to(self, money: Money) -> Option<Money> {
        let x = money.minor_units;
        let p = i64::from(100 - self.0);
        let q = x / 100;
        let r = x % 100;
        let hi = q.checked_mul(p)?; // |hi| ≤ |x| — cannot overflow
        let lo = r.checked_mul(p)?; // |lo| ≤ 9900 — cannot overflow
        Some(Money {
            minor_units: hi.checked_add(lo / 100)?,
            currency: money.currency,
        })
    }

    /// Shorthand for `Percentage::new(0).unwrap()`.
    #[must_use]
    pub fn zero() -> Self {
        Self(0)
    }

    /// Shorthand for `Percentage::new(100).unwrap()`.
    #[must_use]
    pub fn hundred() -> Self {
        Self(100)
    }
}

impl std::fmt::Display for Percentage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}%", self.0)
    }
}

#[cfg(test)]
#[path = "percentage_tests.rs"]
mod tests;
