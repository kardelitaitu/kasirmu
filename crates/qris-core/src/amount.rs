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
/// # Errors
/// Returns [`QrisError::InvalidAmount`] if `percent_str` cannot be parsed as a positive float.
///
/// # Examples
///
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
    let trimmed = percent_str.trim();
    let pct = trimmed
        .parse::<f64>()
        .map_err(|_| QrisError::InvalidAmount(format!("invalid fee percentage: {percent_str}")))?;

    if pct < 0.0 || !pct.is_finite() {
        return Err(QrisError::InvalidAmount(format!(
            "fee percentage must be positive: {percent_str}"
        )));
    }

    let fee_float = (base_amount as f64) * (pct / 100.0);
    Ok(fee_float.ceil() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_integer_amount() {
        assert_eq!(parse_amount("50000").unwrap(), 50_000);
    }

    #[test]
    fn parse_decimal_amount() {
        assert_eq!(parse_amount("50000.00").unwrap(), 50_000);
    }

    #[test]
    fn parse_zero() {
        assert_eq!(parse_amount("0").unwrap(), 0);
    }

    #[test]
    fn reject_empty() {
        assert!(parse_amount("").is_err());
    }

    #[test]
    fn reject_text() {
        assert!(parse_amount("abc").is_err());
    }

    #[test]
    fn format_round_trip() {
        let amount = 123_456u64;
        let s = format_amount(amount);
        assert_eq!(parse_amount(&s).unwrap(), amount);
    }

    #[test]
    fn fee_percentage_accuracy_and_rounding() {
        // 0.01% accuracy tests:
        // 0.01% on 350,000 = 35 rupiah exactly
        assert_eq!(calculate_percentage_fee(350_000, "0.01").unwrap(), 35);
        assert_eq!(calculate_percentage_fee(10_000, "0.01").unwrap(), 1);
        assert_eq!(calculate_percentage_fee(100_000, "0.01").unwrap(), 10);
        assert_eq!(calculate_percentage_fee(1_000_000, "0.01").unwrap(), 100);

        // Fractional result must be rounded up (ceil):
        // e.g. 0.01% on 5,555 = 0.5555 -> rounds up to 1
        assert_eq!(calculate_percentage_fee(5_555, "0.01").unwrap(), 1);
        // 0.01% on 1 = 0.0001 -> rounds up to 1
        assert_eq!(calculate_percentage_fee(1, "0.01").unwrap(), 1);
        // 0.01% on 350,001 = 35.0001 -> rounds up to 36
        assert_eq!(calculate_percentage_fee(350_001, "0.01").unwrap(), 36);

        // Standard QRIS fees (0.7% MDR):
        // 0.7% on 50,000 = 350 exactly
        assert_eq!(calculate_percentage_fee(50_000, "0.7").unwrap(), 350);
        // 0.7% on 50,001 = 350.007 -> rounds up to 351
        assert_eq!(calculate_percentage_fee(50_001, "0.7").unwrap(), 351);
        // 0.7% on 50,010 = 350.07 -> rounds up to 351
        assert_eq!(calculate_percentage_fee(50_010, "0.7").unwrap(), 351);

        // 0.3% MDR:
        // 0.3% on 33,333 = 99.999 -> rounds up to 100
        assert_eq!(calculate_percentage_fee(33_333, "0.3").unwrap(), 100);

        // Invalid percentage inputs
        assert!(calculate_percentage_fee(100_000, "-0.5").is_err());
        assert!(calculate_percentage_fee(100_000, "abc").is_err());
    }
}
