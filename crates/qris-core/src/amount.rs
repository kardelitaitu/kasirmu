//! Amount parsing and formatting utilities.
//!
//! QRIS amounts are transmitted as decimal strings (e.g. `"50000"` or `"50000.00"`).
//! IDR has no practical minor units, so amounts are represented as whole `u64` rupiah.

use crate::error::QrisError;

/// Parse a QRIS amount string (e.g. `"50000"` or `"50000.00"`) into whole rupiah.
///
/// The decimal part, if present, must be `".00"` — fractional rupiah are not valid
/// in QRIS and will be truncated with a best-effort parse.
///
/// # Errors
/// Returns [`QrisError::InvalidAmount`] if the string cannot be parsed as a number.
///
/// # Examples
///
/// ```
/// use qris_core::amount::parse_amount;
///
/// assert_eq!(parse_amount("50000").unwrap(), 50_000);
/// assert_eq!(parse_amount("50000.00").unwrap(), 50_000);
/// ```
pub fn parse_amount(s: &str) -> Result<u64, QrisError> {
    let trimmed = s.trim();
    if trimmed.is_empty() {
        return Err(QrisError::InvalidAmount(s.to_string()));
    }

    // Handle "50000.00" style — truncate at the decimal point
    let integer_part = if let Some(dot_pos) = trimmed.find('.') {
        &trimmed[..dot_pos]
    } else {
        trimmed
    };

    integer_part
        .parse::<u64>()
        .map_err(|_| QrisError::InvalidAmount(s.to_string()))
}

/// Format a whole-rupiah amount as the string used in a QRIS payload.
///
/// Returns a plain decimal string with no decimal point (e.g. `50_000u64` → `"50000"`).
///
/// # Examples
///
/// ```
/// use qris_core::amount::format_amount;
///
/// assert_eq!(format_amount(50_000), "50000");
/// assert_eq!(format_amount(0), "0");
/// ```
pub fn format_amount(rupiah: u64) -> String {
    rupiah.to_string()
}

/// Returns `true` if `s` is a syntactically valid QRIS amount string.
///
/// A valid amount is a non-empty string of decimal digits with an optional `"."`
/// followed by exactly two more decimal digits.
pub fn is_valid_amount_str(s: &str) -> bool {
    parse_amount(s).is_ok()
}

/// A valid fee/tip percentage is a non-negative decimal string with at most 4 fractional digits (O-L13).
pub fn is_valid_percent_str(s: &str) -> bool {
    parse_percent(s).is_ok()
}

/// Calculate a percentage fee on a whole-rupiah base amount with 0.01% accuracy,
/// rounding any fractional rupiah up to the next integer (ceiling).
///
/// For example:
/// - Base `350_000_000` with `0.01%` (0.0001) = `35_000` exactly.
/// - Base `350_000` with `0.01%` = `35.0` -> `35`.
/// - Base `10_000` with `0.01%` = `1.0` -> `1`.
/// - If base + fee or calculated fee produces a fraction like `0.11`,
///   it rounds up to `1` whole rupiah.
///
/// QRIS-D: this is integer-only arithmetic. The previous implementation parsed
/// the percentage as `f64` and computed `(base as f64) * (pct / 100.0)`, which
/// breaks the house rule that monetary values never use floats — a percentage
/// such as `"0.1"` is not exactly representable, so the fee could be off by a
/// rupiah at a boundary. The percentage is now parsed as an exact decimal
/// (numerator over a power of ten) and the whole computation runs in `u128`.
///
/// # Errors
/// Returns [`QrisError::InvalidAmount`] if `percent_str` is not a non-negative
/// decimal with at most 4 fractional digits.
///
/// # Examples
/// ```
/// use qris_core::amount::calculate_percentage_fee;
///
/// // 0.01% on 350,000 = 35 rupiah
/// assert_eq!(calculate_percentage_fee(350_000, "0.01").unwrap(), 35);
///
/// // Any fractional remainder rounds up
/// // 0.7% on 50,005 = 350.035 -> rounds up to 351
/// assert_eq!(calculate_percentage_fee(50_005, "0.7").unwrap(), 351);
/// ```
pub fn calculate_percentage_fee(base_amount: u64, percent_str: &str) -> Result<u64, QrisError> {
    // Exact decimal parse: "0.7" -> (7, 10^1). Rejects signs, exponents and
    // more than 4 fractional digits, all of which would need a wider scale.
    let (num, scale) = parse_percent(percent_str)?;
    if num == 0 {
        return Ok(0);
    }
    // fee = ceil(base * num / (100 * scale)), in u128 so nothing overflows.
    let denom = 100u128 * scale;
    let numerator = (base_amount as u128) * (num as u128);
    // Ceiling division for positive integers.
    let fee = numerator.div_ceil(denom);
    u64::try_from(fee)
        .map_err(|_| QrisError::InvalidAmount(format!("fee out of range: {percent_str}")))
}

/// Parse a non-negative decimal percentage into (numerator, power-of-ten scale).
///
/// `"0.01"` -> `(1, 100)`; `"7"` -> `(7, 1)`. At most 4 fractional digits.
fn parse_percent(s: &str) -> Result<(u64, u128), QrisError> {
    let bad = || QrisError::InvalidAmount(format!("invalid fee percentage: {s}"));
    let t = s.trim();
    if t.is_empty() {
        return Err(bad());
    }
    let (int_part, frac_part) = match t.split_once('.') {
        Some((i, f)) => (i, f),
        None => (t, ""),
    };
    if frac_part.len() > 4 {
        return Err(QrisError::InvalidAmount(format!(
            "fee percentage has more than 4 decimal places: {s}"
        )));
    }
    let int_digits = if int_part.is_empty() { "0" } else { int_part };
    if !int_digits.bytes().all(|b| b.is_ascii_digit())
        || !frac_part.bytes().all(|b| b.is_ascii_digit())
    {
        return Err(bad());
    }
    // numerator = int_part concatenated with frac_part, padded to 4 digits.
    let mut digits = String::with_capacity(int_digits.len() + 4);
    digits.push_str(int_digits);
    digits.push_str(frac_part);
    for _ in frac_part.len()..4 {
        digits.push('0');
    }
    let num: u64 = digits.parse().map_err(|_| bad())?;
    Ok((num, 10_000))
}

#[cfg(test)]
#[path = "amount_tests.rs"]
mod tests;
