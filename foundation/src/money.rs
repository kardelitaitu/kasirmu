/*
last audited 25-07-26 by RSA-Agent (foundation slice A: money deep read)
crate: foundation (money.rs) | status: SAFE | lint: CLEAN
findings: exemplary — checked_* arithmetic everywhere with documented i64::MIN edges; currency mismatch -> None (no silent cross-currency math); deliberate no-Ord with PartialOrd-only rationale documented; format_minor handles i64::MIN via unsigned_abs + explicit sign; exponent table sync documented across migrations/cli/frontend; MONEY-AUDIT-1/2 fixes verified intact; serde-only Default fallback documented and fenced
next: none | perf: checked ops branch-predictable
*/
//! Money and currency primitives.
//!
//! Money is **always** stored as integer minor units (e.g., cents for USD,
//! paise for INR; IDR/JPY/KRW have a 0 exponent so the minor unit IS the
//! Rupiah/Yen/Won). Pair with an ISO-4217 currency code for display.
//! Floating point is forbidden anywhere in the money path.

use serde::{Deserialize, Serialize};
use std::str::FromStr;

/// A monetary amount in the smallest unit of a currency.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Money {
    /// Amount in the smallest currency unit (e.g., cents for USD).
    pub minor_units: i64,
    /// ISO-4217 currency code, e.g. "USD", "IDR", "EUR".
    pub currency: Currency,
}

/// `serde`-default fallback only — **never construct business money this
/// way**.
///
/// This impl exists so `#[serde(default)]` fields of type `Money` (e.g.
/// `modules/sales` `SaleLine::tax_amount`, `Sale::subtotal`) can
/// deserialize legacy payloads that omit the key. The currency is
/// hard-coded to USD, which is almost certainly NOT the sale's currency —
/// the value is a stand-in, not real money.
///
/// All production construction goes through [`Money::zero`] or
/// [`Money::from_major`], which take an explicit currency. Do not add new
/// call sites of `Money::default()`; if you need a serde fallback for a
/// new field, use `#[serde(default = "...")]` with a function that builds
/// `Money::zero` in the correct currency.
impl Default for Money {
    fn default() -> Self {
        Self {
            minor_units: 0,
            currency: Currency(*b"USD"),
        }
    }
}

/// Error returned by [`Currency`]'s [`FromStr`] impl when the input is
/// not a valid ISO-4217 alpha-3 code.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InvalidCurrencyCode;

impl std::fmt::Display for InvalidCurrencyCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("expected a 3-letter ISO-4217 currency code")
    }
}

impl std::error::Error for InvalidCurrencyCode {}

/// An ISO-4217 alpha-3 currency code stored as 3 raw ASCII bytes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Currency(pub [u8; 3]);

impl Currency {
    /// The number of decimal places used by this currency.
    ///
    /// ISO-4217 minor-unit exponent: IDR/JPY/KRW/VND/CLP/ISK/HUF = 0,
    /// KWD/OMR/BHD/JOD/TND = 3, everything else = 2. This must stay in
    /// sync with the seeds in `crates/oz-core/migrations/20260813_init.sql`,
    /// `crates/oz-cli` (init-db) and the frontend `MINOR_UNIT_EXPONENT`
    /// (ui/src/types/domain.ts) — all treat IDR as 0 (the Rupiah has no
    /// circulating minor unit).
    pub fn minor_unit_exponent(&self) -> u32 {
        match &self.0 {
            b"IDR" | b"JPY" | b"KRW" | b"VND" | b"CLP" | b"ISK" | b"HUF" => 0,
            b"KWD" | b"OMR" | b"BHD" | b"JOD" | b"TND" => 3,
            _ => 2,
        }
    }
}

/// Render a minor-unit amount as a major-unit decimal string using the
/// currency's ISO-4217 minor-unit exponent — e.g. `1_200` USD minor →
/// `"12.00"`, `4_450_000` IDR minor → `"4450000"`, `12` KWD minor →
/// `"0.012"`. No currency symbol/code is appended; the caller adds
/// context (symbol, "off", etc.).
#[must_use]
pub fn format_minor(minor: i64, currency: Currency) -> String {
    let exp = currency.minor_unit_exponent();
    if exp == 0 {
        minor.to_string()
    } else {
        let div = 10_i64.pow(exp);
        let major = minor / div;
        // `minor % div` keeps the dividend's sign (never overflows); take
        // the unsigned magnitude so `i64::MIN` cannot panic (`abs()` would)
        // or render as a negative fraction.
        let frac = (minor % div).unsigned_abs();
        // Integer division truncates toward zero, so a negative sub-major
        // amount (e.g. -12 cents) would otherwise render as "0.12" and lose
        // its sign — prefix it explicitly.
        let sign = if minor < 0 && major == 0 { "-" } else { "" };
        format!("{sign}{major}.{:0width$}", frac, width = exp as usize)
    }
}

impl std::fmt::Display for Currency {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = std::str::from_utf8(&self.0).unwrap_or("???");
        f.write_str(s)
    }
}

impl FromStr for Currency {
    type Err = InvalidCurrencyCode;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let bytes = s.as_bytes();
        if bytes.len() != 3 || !bytes.iter().all(|b| b.is_ascii_alphabetic()) {
            return Err(InvalidCurrencyCode);
        }
        let mut out = [0u8; 3];
        // Normalise to uppercase so e.g. "jpy" and "JPY" produce the same
        // Currency value and match the same minor_unit_exponent patterns.
        for (i, b) in bytes.iter().enumerate() {
            out[i] = b.to_ascii_uppercase();
        }
        Ok(Self(out))
    }
}

impl Serialize for Currency {
    fn serialize<S: serde::Serializer>(&self, ser: S) -> Result<S::Ok, S::Error> {
        let s = std::str::from_utf8(&self.0)
            .map_err(|e| serde::ser::Error::custom(format!("invalid currency bytes: {e}")))?;
        ser.serialize_str(s)
    }
}

impl<'de> Deserialize<'de> for Currency {
    fn deserialize<D: serde::Deserializer<'de>>(de: D) -> Result<Self, D::Error> {
        let s = String::deserialize(de)?;
        s.parse::<Currency>().map_err(serde::de::Error::custom)
    }
}

impl Money {
    /// Construct a zero amount in the given currency.
    #[must_use]
    pub fn zero(currency: Currency) -> Self {
        Self {
            minor_units: 0,
            currency,
        }
    }

    /// Construct from a major-unit amount (e.g., dollars).
    #[must_use]
    pub fn from_major(major: i64, currency: Currency) -> Option<Self> {
        let exp = currency.minor_unit_exponent();
        major.checked_mul(10_i64.pow(exp)).map(|minor_units| Self {
            minor_units,
            currency,
        })
    }

    /// Add two Money values. Returns `None` if currencies differ or overflow.
    #[must_use]
    pub fn checked_add(self, other: Money) -> Option<Money> {
        if self.currency != other.currency {
            return None;
        }
        self.minor_units
            .checked_add(other.minor_units)
            .map(|v| Self {
                minor_units: v,
                currency: self.currency,
            })
    }

    /// Subtract another Money value. Returns `None` if currencies differ
    /// or underflow.
    #[must_use]
    pub fn checked_sub(self, other: Money) -> Option<Money> {
        if self.currency != other.currency {
            return None;
        }
        self.minor_units
            .checked_sub(other.minor_units)
            .map(|v| Self {
                minor_units: v,
                currency: self.currency,
            })
    }

    /// Return the smaller of two amounts. Same currency.
    ///
    /// Returns `None` when the currencies differ — the same domain-error
    /// rule as [`checked_add`](Self::checked_add), so capping a USD amount
    /// at an EUR bound fails rather than silently comparing minor units.
    ///
    /// `Money` deliberately does not implement [`Ord`] (a total order
    /// across currencies would let `USD 1 < EUR 0` hold), so `Ord::min`
    /// is unavailable; this inherent method is the Ord-free,
    /// same-currency replacement for the raw-i64 cap-and-rewrap pattern.
    /// It cannot overflow, so it needs no `checked_` variant.
    #[must_use]
    pub fn min(self, other: Money) -> Option<Money> {
        if self.currency != other.currency {
            return None;
        }
        Some(if self.minor_units <= other.minor_units {
            self
        } else {
            other
        })
    }

    /// Multiply the minor-units amount by an integer scalar. Keeps the
    /// same currency. Returns `None` on overflow.
    #[must_use]
    pub fn checked_mul(self, scalar: i64) -> Option<Money> {
        self.minor_units.checked_mul(scalar).map(|v| Self {
            minor_units: v,
            currency: self.currency,
        })
    }

    /// Divide the minor-units amount by an integer divisor. Keeps the
    /// same currency. Returns `None` on overflow or division by zero.
    #[must_use]
    pub fn checked_div(self, divisor: i64) -> Option<Money> {
        self.minor_units.checked_div(divisor).map(|v| Self {
            minor_units: v,
            currency: self.currency,
        })
    }

    /// Negate the amount. Same currency. Returns `None` on `i64::MIN`
    /// overflow (where [`negate`](Self::negate) would panic).
    #[must_use]
    pub fn checked_negate(self) -> Option<Money> {
        self.minor_units.checked_neg().map(|v| Self {
            minor_units: v,
            currency: self.currency,
        })
    }

    /// Absolute value of the amount. Same currency. Returns `None` on
    /// `i64::MIN` overflow (where [`abs`](Self::abs) would panic).
    #[must_use]
    pub fn checked_abs(self) -> Option<Money> {
        self.minor_units.checked_abs().map(|v| Self {
            minor_units: v,
            currency: self.currency,
        })
    }

    /// Negate the amount. Positive becomes negative and vice versa.
    /// Same currency.
    ///
    /// ⚠️ **Panics on `i64::MIN` in release builds** (wraps in dev) —
    /// same behaviour as `i64::neg`. Prefer
    /// [`checked_negate`](Self::checked_negate) when the amount could be
    /// `i64::MIN`.
    #[must_use]
    pub fn negate(self) -> Money {
        Money {
            minor_units: -self.minor_units,
            currency: self.currency,
        }
    }

    /// Absolute value of the amount. Same currency.
    ///
    /// ⚠️ **Panics on `i64::MIN` in release builds** (wraps in dev) —
    /// same behaviour as [`i64::abs`]. Prefer
    /// [`checked_abs`](Self::checked_abs) when the amount could be
    /// `i64::MIN`.
    #[must_use]
    pub fn abs(self) -> Money {
        Money {
            minor_units: self.minor_units.abs(),
            currency: self.currency,
        }
    }

    /// Check whether the amount is zero.
    #[must_use]
    pub fn is_zero(&self) -> bool {
        self.minor_units == 0
    }
}

impl PartialOrd for Money {
    /// Compare two amounts. Returns `Some(ordering)` when the currencies
    /// match; returns `None` when they differ — the same domain-error
    /// rule as [`checked_add`](Self::checked_add), so a cross-currency
    /// comparison is incomparable rather than silently ordered.
    ///
    /// `Money` deliberately does **not** implement [`Ord`]: a total order
    /// across currencies (e.g. a derived one) would let `USD 1 < EUR 0`
    /// hold. Callers comparing amounts in different currencies must
    /// convert first.
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        if self.currency != other.currency {
            return None;
        }
        self.minor_units.partial_cmp(&other.minor_units)
    }
}

#[cfg(test)]
#[path = "money_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "money_proptests.rs"]
mod proptests;
