//! Shared validation utilities for kasir.mu.
/*
last audited 25-07-26 by RSA-Agent (foundation slice C: validation deep read)
crate: foundation | status: SAFE | lint: CLEAN
findings: clean, fail-closed throughout; regexes LazyLock-compiled; INFO note: min/max-length validators count BYTES not chars (.len()) so multi-byte UTF-8 names hit limits early (a 50-char cap admits ~16 CJK chars) — consider chars().count() for display-name fields; production 1-441 read, 442-1000 inline tests (COR-33 pattern)
next: byte-vs-char length decision | perf: single Regex compile
*/
//!
//! These functions provide consistent, reusable validation for common
//! constraints: non-empty strings, numeric ranges, and string lengths.
//! Every function returns `Result<(), ValidationError>` with a
//! descriptive message that includes the field name, making it easy to
//! chain with `?` in command handlers and domain logic.
//!
//! # Example
//!
//! ```rust
//! use foundation::validation::{validate_not_empty, validate_range};
//!
//! fn update_product(name: &str, price: i64) -> Result<(), foundation::ValidationError> {
//!     validate_not_empty("name", name)?;
//!     validate_range("price", price, 0, 1_000_000)?;
//!     Ok(())
//! }
//! ```

use crate::ValidationError;

/// Validate that a trimmed string is non-empty.
///
/// Returns `Err(ValidationError)` when the trimmed value has zero length.
///
/// # Example
///
/// ```
/// # use foundation::validation::validate_not_empty;
/// assert!(validate_not_empty("name", "Coffee").is_ok());
/// assert!(validate_not_empty("name", "  ").is_err());
/// assert!(validate_not_empty("name", "").is_err());
/// ```
pub fn validate_not_empty(field: &'static str, value: &str) -> Result<(), ValidationError> {
    if value.trim().is_empty() {
        Err(ValidationError {
            field,
            message: format!("{field} must not be empty"),
        })
    } else {
        Ok(())
    }
}

/// Validate that a value falls within the inclusive range `[min, max]`.
///
/// Works with any type that implements `PartialOrd + Display` (integers,
/// floats, etc.).
///
/// # Example
///
/// ```
/// # use foundation::validation::validate_range;
/// assert!(validate_range("discount", 10u8, 0u8, 100u8).is_ok());
/// assert!(validate_range("discount", 101u8, 0u8, 100u8).is_err());
/// ```
pub fn validate_range<T>(
    field: &'static str,
    value: T,
    min: T,
    max: T,
) -> Result<(), ValidationError>
where
    T: PartialOrd + std::fmt::Display,
{
    if value < min || value > max {
        Err(ValidationError {
            field,
            message: format!("{field} must be between {min} and {max}, got {value}"),
        })
    } else {
        Ok(())
    }
}

/// Validate that a trimmed string meets a minimum length.
///
/// # Example
///
/// ```
/// # use foundation::validation::validate_min_length;
/// assert!(validate_min_length("pin", "1234", 4).is_ok());
/// assert!(validate_min_length("pin", "12", 4).is_err());
/// ```
pub fn validate_min_length(
    field: &'static str,
    value: &str,
    min: usize,
) -> Result<(), ValidationError> {
    let len = value.trim().len();
    if len < min {
        Err(ValidationError {
            field,
            message: format!("{field} must be at least {min} characters (got {len})"),
        })
    } else {
        Ok(())
    }
}

/// Validate that a string does not exceed a maximum length.
///
/// # Example
///
/// ```
/// # use foundation::validation::validate_max_length;
/// assert!(validate_max_length("sku", "COFFEE", 20).is_ok());
/// assert!(validate_max_length("sku", &"X".repeat(21), 20).is_err());
/// ```
pub fn validate_max_length(
    field: &'static str,
    value: &str,
    max: usize,
) -> Result<(), ValidationError> {
    let len = value.trim().len();
    if len > max {
        Err(ValidationError {
            field,
            message: format!("{field} must be at most {max} characters (got {len})"),
        })
    } else {
        Ok(())
    }
}

/// Validate that a trimmed string contains only Unicode alphanumeric
/// characters (letters and digits from any script).
///
/// Returns `Err(ValidationError)` when the trimmed value is empty or
/// contains non-alphanumeric characters (spaces, punctuation, symbols).
///
/// # Example
///
/// ```
/// # use foundation::validation::validate_alphanumeric;
/// assert!(validate_alphanumeric("username", "alice_123").is_err());  // underscore
/// assert!(validate_alphanumeric("username", "alice123").is_ok());
/// assert!(validate_alphanumeric("username", "café").is_ok());  // Unicode é
/// assert!(validate_alphanumeric("username", "  alice  ").is_ok());  // trimmed
/// ```
pub fn validate_alphanumeric(field: &'static str, value: &str) -> Result<(), ValidationError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(ValidationError {
            field,
            message: format!("{field} must not be empty"),
        });
    }
    if let Some(bad) = trimmed.chars().find(|c| !c.is_alphanumeric()) {
        return Err(ValidationError {
            field,
            message: format!("{field} must be alphanumeric (found invalid character '{bad}')"),
        });
    }
    Ok(())
}

/// Validate that a trimmed string contains only ASCII alphanumeric
/// characters (`a-z`, `A-Z`, `0-9`).
///
/// Returns `Err(ValidationError)` when the trimmed value is empty or
/// contains any non-ASCII-alphanumeric character (spaces, punctuation,
/// symbols, accented letters, etc.).
///
/// # Example
///
/// ```
/// # use foundation::validation::validate_ascii_alphanumeric;
/// assert!(validate_ascii_alphanumeric("sku", "COFFEE123").is_ok());
/// assert!(validate_ascii_alphanumeric("sku", "COFFEE-123").is_err());  // hyphen
/// assert!(validate_ascii_alphanumeric("sku", "café").is_err());  // é is not ASCII
/// ```
pub fn validate_ascii_alphanumeric(
    field: &'static str,
    value: &str,
) -> Result<(), ValidationError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(ValidationError {
            field,
            message: format!("{field} must not be empty"),
        });
    }
    if let Some(bad) = trimmed.chars().find(|c| !c.is_ascii_alphanumeric()) {
        return Err(ValidationError {
            field,
            message: format!(
                "{field} must be ASCII alphanumeric (found invalid character '{bad}')"
            ),
        });
    }
    Ok(())
}

/// Validate that a trimmed string matches a regular expression pattern.
///
/// The pattern is applied via `Regex::is_match`, which searches for a
/// match anywhere in the string. To validate the **entire** string, use
/// `^` and `$` anchors in your pattern.
///
/// Returns `Err(ValidationError)` when the trimmed value is empty or
/// does not match the pattern.
///
/// # Example
///
/// ```
/// # use foundation::validation::validate_regex;
/// # use regex::Regex;
/// let hex_color = Regex::new(r"^#[0-9a-fA-F]{6}$").unwrap();
/// assert!(validate_regex("color", "#ff6600", &hex_color).is_ok());
/// assert!(validate_regex("color", "#GGG", &hex_color).is_err());
/// ```
pub fn validate_regex(
    field: &'static str,
    value: &str,
    pattern: &regex::Regex,
) -> Result<(), ValidationError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(ValidationError {
            field,
            message: format!("{field} must not be empty"),
        });
    }
    if !pattern.is_match(trimmed) {
        return Err(ValidationError {
            field,
            message: format!("{field} does not match the required pattern"),
        });
    }
    Ok(())
}

/// Validate that a trimmed string is non-empty and within a length range.
///
/// Equivalent to calling `validate_not_empty` then `validate_min_length`
/// and `validate_max_length`, but with a single error message when the
/// value is empty (rather than a cryptic "must be at least N characters").
///
/// # Example
///
/// ```
/// # use foundation::validation::validate_non_empty_bounded;
/// assert!(validate_non_empty_bounded("name", "Coffee", 2, 50).is_ok());
/// assert!(validate_non_empty_bounded("name", "", 2, 50).is_err());
/// assert!(validate_non_empty_bounded("name", "X", 2, 50).is_err());
/// assert!(validate_non_empty_bounded("name", &"X".repeat(51), 2, 50).is_err());
/// ```
pub fn validate_non_empty_bounded(
    field: &'static str,
    value: &str,
    min: usize,
    max: usize,
) -> Result<(), ValidationError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(ValidationError {
            field,
            message: format!("{field} must not be empty"),
        });
    }
    let len = trimmed.len();
    if len < min {
        return Err(ValidationError {
            field,
            message: format!("{field} must be at least {min} characters (got {len})"),
        });
    }
    if len > max {
        return Err(ValidationError {
            field,
            message: format!("{field} must be at most {max} characters (got {len})"),
        });
    }
    Ok(())
}

// ── Extended validators ───────────────────────────────────────────

/// Validate an SKU code: non-empty, ASCII alphanumeric-only,
/// and within the length range [1, `MAX_SKU_LENGTH`].
///
/// All checks operate on the trimmed value for consistent results.
///
/// # Example
///
/// ```
/// # use foundation::validation::validate_sku;
/// assert!(validate_sku("sku", "COFFEE123").is_ok());
/// assert!(validate_sku("sku", "").is_err());
/// assert!(validate_sku("sku", "COFFEE-1").is_err());
/// ```
pub fn validate_sku(field: &'static str, value: &str) -> Result<(), ValidationError> {
    let trimmed = value.trim();
    validate_not_empty(field, trimmed)?;
    validate_ascii_alphanumeric(field, trimmed)?;
    // Use trimmed length for consistency with the other checks
    let len = trimmed.len();
    if len > crate::constants::MAX_SKU_LENGTH {
        return Err(ValidationError {
            field,
            message: format!(
                "{field} must be at most {} characters (got {len})",
                crate::constants::MAX_SKU_LENGTH
            ),
        });
    }
    Ok(())
}

/// Validate an email address format using a simple but practical regex.
///
/// Accepts only the most common email formats: `user@domain.tld`.
/// Does NOT attempt full RFC 5322 compliance — that requires a parser,
/// not a regex. For production use, send a verification email.
///
/// The regex is compiled once via `LazyLock` to avoid repeated
/// compilation overhead on every call.
///
/// # Example
///
/// ```
/// # use foundation::validation::validate_email;
/// assert!(validate_email("email", "alice@example.com").is_ok());
/// assert!(validate_email("email", "not-an-email").is_err());
/// assert!(validate_email("email", "").is_err());
/// ```
pub fn validate_email(field: &'static str, value: &str) -> Result<(), ValidationError> {
    use std::sync::LazyLock;
    static EMAIL_RE: LazyLock<regex::Regex> = LazyLock::new(|| {
        regex::Regex::new(
            r"^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$"
        ).expect("email regex must compile")
    });

    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(ValidationError {
            field,
            message: format!("{field} must not be empty"),
        });
    }
    if !EMAIL_RE.is_match(trimmed) {
        return Err(ValidationError {
            field,
            message: format!("{field} must be a valid email address (got '{trimmed}')"),
        });
    }
    Ok(())
}

/// Validate a phone number format.
///
/// Accepts international format (`+<country><number>`), digits-only,
/// and common separators (spaces, hyphens, dots, parentheses).
/// Minimum 7 digits after stripping non-digit characters.
///
/// The regex is compiled once via `LazyLock` to avoid repeated
/// compilation overhead on every call.
///
/// # Example
///
/// ```
/// # use foundation::validation::validate_phone;
/// assert!(validate_phone("phone", "+6281234567890").is_ok());
/// assert!(validate_phone("phone", "+1-555-0100").is_ok());
/// assert!(validate_phone("phone", "123").is_err());
/// ```
pub fn validate_phone(field: &'static str, value: &str) -> Result<(), ValidationError> {
    use std::sync::LazyLock;
    static PHONE_RE: LazyLock<regex::Regex> = LazyLock::new(|| {
        regex::Regex::new(r"^\+?[0-9][0-9\s.\-()]{5,19}$").expect("phone regex must compile")
    });

    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(ValidationError {
            field,
            message: format!("{field} must not be empty"),
        });
    }
    if !PHONE_RE.is_match(trimmed) {
        return Err(ValidationError {
            field,
            message: format!("{field} must be a valid phone number (got '{trimmed}')"),
        });
    }
    // At least 7 actual digits
    let digit_count = trimmed.chars().filter(|c| c.is_ascii_digit()).count();
    if digit_count < 7 {
        return Err(ValidationError {
            field,
            message: format!("{field} must contain at least 7 digits (got {digit_count})"),
        });
    }
    Ok(())
}

/// Validate that a monetary value (in minor units) falls within an
/// inclusive range. Currency-aware wrapper around [`validate_range`].
///
/// # Example
///
/// ```
/// # use foundation::validation::validate_money_range;
/// assert!(validate_money_range("price", 1299, 0, 1_000_000).is_ok());
/// assert!(validate_money_range("price", -1, 0, 1_000_000).is_err());
/// assert!(validate_money_range("price", 2_000_000, 0, 1_000_000).is_err());
/// ```
pub fn validate_money_range(
    field: &'static str,
    minor_units: i64,
    min: i64,
    max: i64,
) -> Result<(), ValidationError> {
    validate_range(field, minor_units, min, max)
}

/// Validate that a string's length falls within `[min_len, max_len]`
/// (inclusive). Trims whitespace before checking.
///
/// Convenience wrapper for the common pattern of calling
/// `validate_min_length` + `validate_max_length` together.
///
/// # Example
///
/// ```
/// # use foundation::validation::validate_string_length;
/// assert!(validate_string_length("name", "Coffee", 2, 50).is_ok());
/// assert!(validate_string_length("name", "X", 2, 50).is_err());
/// ```
pub fn validate_string_length(
    field: &'static str,
    value: &str,
    min_len: usize,
    max_len: usize,
) -> Result<(), ValidationError> {
    validate_non_empty_bounded(field, value, min_len, max_len)
}

#[cfg(test)]
#[path = "validation_tests.rs"]
mod tests;
