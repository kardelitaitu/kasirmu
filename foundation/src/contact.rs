/*
last audited 25-07-26 by RSA-Agent (foundation slice E: contact+dto verified)
crate: foundation | status: SAFE | lint: CLEAN
findings: clean — Email/Phone validated newtypes (serde transparent), DTO conventions documented (Create and Update DTOs with Option PATCH semantics); dto unwraps are test-only (verified by line-range check)
next: none | perf: N/A
*/
//! Email address and phone number value objects.
//!
//! These newtypes wrap validated strings so that any `Email` or `Phone`
//! instance is guaranteed to be non-empty and structurally well-formed.
//! Both types are `#[serde(transparent)]` so they serialise as bare
//! strings — compatible with existing `Option<String>` fields in the
//! [`Customer`](https://docs.rs/kasirmu-core/latest/kasirmu_core/struct.Customer.html)
//! type and its DTOs.
//!
//! # Example
//!
//! ```rust
//! use foundation::contact::{Email, Phone};
//!
//! let email = Email::new("alice@example.com").unwrap();
//! assert_eq!(email.as_str(), "alice@example.com");
//!
//! let phone = Phone::new("+1-555-0102").unwrap();
//! assert_eq!(phone.as_str(), "+1-555-0102");
//! ```

use serde::{Deserialize, Serialize};

use crate::ValidationError;

// ── Email ──────────────────────────────────────────────────────────

/// A validated email address.
///
/// Guarantees:
/// - Non-empty (after trimming)
/// - Contains exactly one `@`
/// - Local part (before `@`) is non-empty
/// - Domain part (after `@`) is non-empty and contains at least one `.`
///
/// # Serialization
///
/// Serialises as a bare string via `#[serde(transparent)]`.
///
/// ```rust
/// # use foundation::contact::Email;
/// let email = Email::new("alice@example.com").unwrap();
/// assert_eq!(serde_json::to_string(&email).unwrap(), "\"alice@example.com\"");
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
#[serde(transparent)]
pub struct Email(String);

impl<'de> Deserialize<'de> for Email {
    fn deserialize<D: serde::Deserializer<'de>>(de: D) -> Result<Self, D::Error> {
        let s = String::deserialize(de)?;
        Email::new(s).map_err(|e| serde::de::Error::custom(e.message))
    }
}

impl Email {
    /// Construct an `Email`, trimming whitespace and validating the
    /// basic structure.
    ///
    /// # Errors
    ///
    /// Returns [`ValidationError`] when the input is empty or does not
    /// have a valid email structure.
    pub fn new(s: impl Into<String>) -> Result<Self, ValidationError> {
        let trimmed = s.into().trim().to_owned();
        Self::validate(&trimmed)?;
        Ok(Self(trimmed))
    }

    /// Borrow the underlying email string.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Internal validation logic shared by `new` and `FromStr`.
    fn validate(s: &str) -> Result<(), ValidationError> {
        if s.is_empty() {
            return Err(ValidationError {
                field: "email",
                message: "email must not be empty".into(),
            });
        }

        let at_count = s.chars().filter(|&c| c == '@').count();
        if at_count != 1 {
            return Err(ValidationError {
                field: "email",
                message: format!("email must contain exactly one '@' (found {at_count})"),
            });
        }

        let (local, domain) = s.split_once('@').expect("checked at_count == 1 above");
        if local.is_empty() {
            return Err(ValidationError {
                field: "email",
                message: "email must have a non-empty local part before '@'".into(),
            });
        }
        if domain.is_empty() {
            return Err(ValidationError {
                field: "email",
                message: "email must have a non-empty domain after '@'".into(),
            });
        }
        if !domain.contains('.') {
            return Err(ValidationError {
                field: "email",
                message: "email domain must contain at least one '.'".into(),
            });
        }
        if domain.starts_with('.') || domain.ends_with('.') {
            return Err(ValidationError {
                field: "email",
                message: "email domain must not start or end with a '.'".into(),
            });
        }
        if local.starts_with('.') || local.ends_with('.') {
            return Err(ValidationError {
                field: "email",
                message: "email local part must not start or end with a '.'".into(),
            });
        }

        Ok(())
    }
}

impl std::str::FromStr for Email {
    type Err = ValidationError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Self::new(s)
    }
}

impl std::fmt::Display for Email {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

// ── Phone ──────────────────────────────────────────────────────────

/// A validated phone number.
///
/// Guarantees:
/// - Non-empty (after trimming)
/// - Contains at least one digit
///
/// This is a **structural** validation — it does not verify reachability
/// or format compliance with any national numbering plan. The intent is
/// to catch accidental empty or garbage input while accepting the wide
/// variety of formats used in practice (`+1-555-0102`, `0812xxx`,
/// `+44 20 7946 0958`, etc.).
///
/// # Serialization
///
/// Serialises as a bare string via `#[serde(transparent)]`.
///
/// ```rust
/// # use foundation::contact::Phone;
/// let phone = Phone::new("+1-555-0102").unwrap();
/// assert_eq!(serde_json::to_string(&phone).unwrap(), "\"+1-555-0102\"");
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
#[serde(transparent)]
pub struct Phone(String);

impl<'de> Deserialize<'de> for Phone {
    fn deserialize<D: serde::Deserializer<'de>>(de: D) -> Result<Self, D::Error> {
        let s = String::deserialize(de)?;
        Phone::new(s).map_err(|e| serde::de::Error::custom(e.message))
    }
}

impl Phone {
    /// Construct a `Phone`, trimming whitespace and validating the
    /// structure.
    ///
    /// # Errors
    ///
    /// Returns [`ValidationError`] when the input is empty or contains
    /// no digits.
    pub fn new(s: impl Into<String>) -> Result<Self, ValidationError> {
        let trimmed = s.into().trim().to_owned();
        Self::validate(&trimmed)?;
        Ok(Self(trimmed))
    }

    /// Borrow the underlying phone string.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Internal validation logic.
    fn validate(s: &str) -> Result<(), ValidationError> {
        if s.is_empty() {
            return Err(ValidationError {
                field: "phone",
                message: "phone must not be empty".into(),
            });
        }
        if !s.chars().any(|c| c.is_ascii_digit()) {
            return Err(ValidationError {
                field: "phone",
                message: "phone must contain at least one digit".into(),
            });
        }
        Ok(())
    }
}

impl std::str::FromStr for Phone {
    type Err = ValidationError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Self::new(s)
    }
}

impl std::fmt::Display for Phone {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

// ── Tests ─────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "contact_tests.rs"]
mod tests;
