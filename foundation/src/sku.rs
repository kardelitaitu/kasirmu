//! Stock-Keeping Unit (SKU) — a string identifier for a product.
/*
last audited (date unknown) by DSH-Agent
crate: foundation | status: SAFE | lint: CLEAN
findings: clean validated newtype — trim+non-empty, serde validates via try_new. COR-33 FIXED (date unknown) — inline tests moved to sibling sku_tests.rs.
next: none | perf: N/A
*/
//!
//! `Sku` is `#[serde(transparent)]` so it serializes as its inner
//! `String`. `LineId` is a fresh UUID per line item.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A SKU string. Trimmed, must be non-empty.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
#[serde(transparent)]
pub struct Sku(String);

impl<'de> Deserialize<'de> for Sku {
    fn deserialize<D: serde::Deserializer<'de>>(de: D) -> Result<Self, D::Error> {
        let s = String::deserialize(de)?;
        Sku::try_new(s)
            .ok_or_else(|| serde::de::Error::custom("SKU must not be empty or whitespace-only"))
    }
}

impl Sku {
    /// Construct a SKU from any string-like value, trimming and panicking
    /// if empty.
    ///
    /// # Panics
    /// Panics if the trimmed input is empty.
    pub fn new(s: impl Into<String>) -> Self {
        let trimmed = s.into().trim().to_owned();
        assert!(!trimmed.is_empty(), "SKU cannot be empty");
        Self(trimmed)
    }

    /// Try-constructor returning `None` for empty input.
    #[must_use]
    pub fn try_new(s: impl Into<String>) -> Option<Self> {
        let trimmed = s.into().trim().to_owned();
        if trimmed.is_empty() {
            None
        } else {
            Some(Self(trimmed))
        }
    }

    /// Borrow the underlying string.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for Sku {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl From<&str> for Sku {
    fn from(s: &str) -> Self {
        Self::new(s)
    }
}

/// A `LineId` is a fresh UUID per line item within a cart.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct LineId(pub Uuid);

impl LineId {
    /// Create a new line identifier backed by a UUID v7.
    #[must_use]
    pub fn new() -> Self {
        Self(Uuid::now_v7())
    }
}

impl Default for LineId {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Display for LineId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

#[cfg(test)]
#[path = "sku_tests.rs"]
mod tests;
