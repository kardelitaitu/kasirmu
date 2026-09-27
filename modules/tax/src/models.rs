/*
last audited 25-07-26 by RSA-Agent (modules-tax slice A: models deep read)
crate: modules-tax | status: SAFE | lint: CLEAN
findings: exemplary — TAX-05 integer-only rounding with HalfUp default (jurisdiction-defensible) and legacy Truncate documented for backward compat; overflow-checked divide; bps math with rejection tests
next: none | perf: N/A
*/
//! Tax domain models.

use serde::{Deserialize, Serialize};

/// Rounding policy applied to fractional tax amounts.
///
/// TAX-05: tax is computed in integer minor units, so a per-line/rate
/// result like `333.5` must be reduced to a whole minor unit. The legacy
/// behavior silently truncated toward zero (understating tax); [`HalfUp`](Self::HalfUp)
/// is the recommended, jurisdiction-defensible default.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RoundingMode {
    /// Truncate toward zero — legacy behavior, kept for backward
    /// compatibility with previously recorded sales.
    Truncate,
    /// Round half away from zero (`0.5` → `1`) — recommended default.
    ///
    /// The integer implementation assumes non-negative numerators, which
    /// is the only domain tax math produces (base and rate are both ≥ 0).
    #[default]
    HalfUp,
}

impl RoundingMode {
    /// Stable wire/storage name (matches the `serde` `snake_case` form
    /// declared by `#[serde(rename_all = "snake_case")]` on this enum —
    /// keep the two in sync if the rename changes).
    #[must_use]
    pub fn wire_name(self) -> &'static str {
        match self {
            Self::Truncate => "truncate",
            Self::HalfUp => "half_up",
        }
    }

    /// Divide `numerator / divisor` and round per this mode using
    /// integer-only arithmetic (no floats).
    ///
    /// `HalfUp` computes `(numerator + divisor/2) / divisor`, which rounds
    /// ties away from zero for non-negative inputs (the only domain tax
    /// math produces). `divisor` must be strictly positive.
    ///
    /// Returns `None` if the intermediate `numerator + divisor/2` would
    /// overflow `i64`.
    #[must_use]
    pub fn divide(self, numerator: i64, divisor: i64) -> Option<i64> {
        debug_assert!(divisor > 0, "divisor must be positive");
        match self {
            Self::Truncate => Some(numerator / divisor),
            Self::HalfUp => {
                if numerator % divisor == 0 {
                    // Exact division — no rounding needed.
                    // The checked_add formula below shifts exact negative
                    // results (e.g. HalfUp.divide(-4, 2) → -1, not -2).
                    Some(numerator / divisor)
                } else {
                    numerator.checked_add(divisor / 2).map(|n| n / divisor)
                }
            }
        }
    }
}

/// A named tax rate, stored in basis points.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TaxRate {
    /// Internal row id (UUID v4).
    pub id: String,
    /// Display name (e.g. "Sales Tax", "VAT 20%").
    pub name: String,
    /// Rate in basis points — 1 bps = 0.01 %.
    pub rate_bps: i64,
    /// Whether this is the default tax rate for the store.
    pub is_default: bool,
    /// Whether tax is included in the displayed price (true) or added at checkout (false).
    pub is_inclusive: bool,
    /// ISO-8601 creation timestamp.
    pub created_at: String,
    /// ISO-8601 last-update timestamp.
    pub updated_at: String,
}

impl TaxRate {
    /// Create a new tax rate.
    pub fn new(name: impl Into<String>, rate_bps: i64) -> Self {
        let name = name.into().trim().to_owned();
        assert!(!name.is_empty(), "tax rate name must not be empty");
        assert!(rate_bps >= 0, "rate_bps must be non-negative");

        Self {
            id: uuid::Uuid::now_v7().to_string(),
            name,
            rate_bps,
            is_default: false,
            is_inclusive: false,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    /// Mark this rate as the store default.
    #[must_use]
    pub fn with_default(mut self) -> Self {
        self.is_default = true;
        self
    }

    /// Mark this rate as inclusive.
    #[must_use]
    pub fn with_inclusive(mut self) -> Self {
        self.is_inclusive = true;
        self
    }

    /// Get display percentage string.
    pub fn display_rate(&self) -> String {
        let major = self.rate_bps / 100;
        let frac = self.rate_bps % 100;
        if frac == 0 {
            format!("{major}%")
        } else {
            format!("{major}.{frac:02}%")
        }
    }
}

#[cfg(test)]
#[path = "models_tests.rs"]
mod tests;
