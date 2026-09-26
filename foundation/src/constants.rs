//! Shared constants for kasir.mu.
//!
//! Centralises magic numbers and string literals that appear across
//! multiple crates — currency defaults, discount bounds, tax basis
//! points, length limits, etc. Using named constants instead of
//! inline literals makes the code self-documenting and easier to
//! update.
//!
//! # Example
//!
//! ```rust
//! use foundation::constants::{DEFAULT_CURRENCY_CODE, MAX_DISCOUNT_PERCENT, PIN_MIN_LENGTH};
//!
//! assert_eq!(DEFAULT_CURRENCY_CODE, "USD");
//! assert_eq!(MAX_DISCOUNT_PERCENT, 100);
//! assert_eq!(PIN_MIN_LENGTH, 4);
//! ```

/// Default ISO-4217 currency code used when no currency is specified.
///
/// Used as a fallback in IPC command handlers, tests, payment-driver
/// defaults, and exchange-rate base currencies.
///
/// # Example
///
/// ```
/// # use foundation::constants::DEFAULT_CURRENCY_CODE;
/// let currency: foundation::Currency = DEFAULT_CURRENCY_CODE.parse().unwrap();
/// assert_eq!(currency.to_string(), "USD");
/// ```
pub const DEFAULT_CURRENCY_CODE: &str = "USD";

/// Maximum percentage value that [`Percentage`](crate::Percentage) can
/// represent (100% = full discount / free).
pub const MAX_DISCOUNT_PERCENT: u8 = 100;

/// Denominator for basis-point-based tax rates.
///
/// One basis point = 1/10000 of the principal.
/// A 10% tax rate is expressed as `1000` basis points.
/// The formula for exclusive tax is `price * rate_bps / BASIS_POINTS_DENOMINATOR`.
///
/// # Example
///
/// ```
/// # use foundation::constants::BASIS_POINTS_DENOMINATOR;
/// // 10% tax on $10.00 (1000 minor units)
/// let tax = 1000i64 * 1000 / BASIS_POINTS_DENOMINATOR; // = 100
/// assert_eq!(tax, 100);
/// ```
pub const BASIS_POINTS_DENOMINATOR: i64 = 10_000;

/// Minimum length (in characters) for a staff PIN code.
///
/// Used in [`validate_min_length`](crate::validate_min_length) calls
/// when creating or updating staff members.
pub const PIN_MIN_LENGTH: usize = 4;

/// Maximum length (in characters) for a SKU string.
///
/// SKUs longer than this are rejected during validation.
pub const MAX_SKU_LENGTH: usize = 64;

/// Maximum length (in characters) for a user-facing name
/// (product name, customer name, category name, etc.).
pub const MAX_NAME_LENGTH: usize = 255;

#[cfg(test)]
#[path = "constants_tests.rs"]
mod tests;
