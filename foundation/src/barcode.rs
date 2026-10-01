//! Barcode — a validated product barcode string.
/*
last audited (date unknown) by DSH-Agent
crate: foundation | status: SAFE | lint: CLEAN
findings: clean validated newtype — format-agnostic non-empty, serde validated. COR-33 FIXED (date unknown) — inline tests moved to sibling barcode_tests.rs.
next: none | perf: N/A
*/
//!
//! `Barcode` is a `#[serde(transparent)]` newtype validated to be
//! non-empty after trimming. It accepts any barcode format (EAN-13,
//! UPC-A, Code-128, etc.) as long as it is non-empty.
//!
//! # Example
//!
//! ```rust
//! use foundation::barcode::Barcode;
//!
//! let bc = Barcode::new("5901234123457").unwrap();
//! assert_eq!(bc.as_str(), "5901234123457");
//! ```

use serde::{Deserialize, Serialize};

use crate::ValidationError;

/// A validated product barcode.
///
/// Guarantees:
/// - Non-empty (after trimming)
///
/// # Serialization
///
/// Serializes as a bare string via `#[serde(transparent)]`.
///
/// ```rust
/// # use foundation::barcode::Barcode;
/// let bc = Barcode::new("4901234567890").unwrap();
/// assert_eq!(serde_json::to_string(&bc).unwrap(), "\"4901234567890\"");
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
#[serde(transparent)]
pub struct Barcode(String);

impl<'de> Deserialize<'de> for Barcode {
    fn deserialize<D: serde::Deserializer<'de>>(de: D) -> Result<Self, D::Error> {
        let s = String::deserialize(de)?;
        Barcode::new(s).map_err(|e| serde::de::Error::custom(e.message))
    }
}

impl Barcode {
    /// Construct a `Barcode`, trimming whitespace and validating non-empty.
    ///
    /// # Errors
    ///
    /// Returns [`ValidationError`] when the input is empty or whitespace-only.
    pub fn new(s: impl Into<String>) -> Result<Self, ValidationError> {
        let trimmed = s.into().trim().to_owned();
        if trimmed.is_empty() {
            return Err(ValidationError {
                field: "barcode",
                message: "barcode must not be empty".into(),
            });
        }
        Ok(Self(trimmed))
    }

    /// Borrow the underlying barcode string.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::str::FromStr for Barcode {
    type Err = ValidationError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Self::new(s)
    }
}

impl std::fmt::Display for Barcode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

#[cfg(test)]
#[path = "barcode_tests.rs"]
mod tests;
