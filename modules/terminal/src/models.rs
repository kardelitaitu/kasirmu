/*
last audited 25-07-26 by RSA-Agent (modules-terminal slice A: models deep read)
crate: modules-terminal | status: SAFE | lint: CLEAN
findings: MSL-9 CLOSED 2026-09-27 (DSH credential-Debug pass) — Terminal no longer derives Debug; the manual impl below redacts `terminal_secret`, the fix MSL-9 named. The derive printed the device secret on any `{:?}` / panic dump, and the tree's own precedent for the repair is the manual redacting Debug on GiftCard (modules/loyalty/src/models.rs:127-144). Pinned executably by models_tests::terminal_debug_redacts_the_device_secret. Serialization is NOT the exposure here: `TerminalDto::from` drops the secret in both shells and every read path maps to a DTO, so `Serialize` stays derived. TerminalId UUID v7 clean
next: none | perf: N/A
*/
//! Terminal domain models.

use serde::{Deserialize, Serialize};

/// A registered POS terminal.
///
/// `Debug` is implemented by hand below, not derived: `terminal_secret` is
/// credential material (MSL-9) and a derived impl would print it in any
/// `{:?}` line or panic dump. `Serialize` stays derived because no
/// serialization surface exposes the secret — both shells convert through
/// `TerminalDto::from`, which omits the field.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Terminal {
    /// Internal row id (UUID v4).
    pub id: String,
    /// Human-readable terminal name.
    pub name: String,
    /// Unique device identifier.
    pub device_id: String,
    /// Optional shared secret.
    pub terminal_secret: Option<String>,
    /// Whether this terminal is active.
    pub is_active: bool,
    /// ISO-8601 timestamp of last communication.
    pub last_seen_at: Option<String>,
    /// JSON metadata blob.
    pub metadata: Option<String>,
    /// ISO-8601 creation timestamp.
    pub created_at: String,
    /// ISO-8601 last-update timestamp.
    pub updated_at: String,
}

/// Hand-written `std::fmt::Debug` that redacts `terminal_secret` (MSL-9).
///
/// The derive printed the device secret. The shape mirrors the tree's
/// existing precedent, `GiftCard`'s manual impl (`modules/loyalty/src/
/// models.rs:127-144`), with one difference forced by the field being an
/// `Option`: the redaction is applied through `map`, so `None` still renders
/// as `None` and a reader keeps the present/absent distinction the credential
/// itself is not needed for. Every other field stays printed so the row
/// remains debuggable.
impl std::fmt::Debug for Terminal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Terminal")
            .field("id", &self.id)
            .field("name", &self.name)
            .field("device_id", &self.device_id)
            .field(
                "terminal_secret",
                &self.terminal_secret.as_ref().map(|_| "<redacted>"),
            )
            .field("is_active", &self.is_active)
            .field("last_seen_at", &self.last_seen_at)
            .field("metadata", &self.metadata)
            .field("created_at", &self.created_at)
            .field("updated_at", &self.updated_at)
            .finish()
    }
}

impl Terminal {
    /// Create a new terminal.
    pub fn new(name: impl Into<String>, device_id: impl Into<String>) -> Self {
        Self {
            id: uuid::Uuid::now_v7().to_string(),
            name: name.into(),
            device_id: device_id.into(),
            terminal_secret: None,
            is_active: true,
            last_seen_at: None,
            metadata: None,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    /// Set terminal secret.
    #[must_use]
    pub fn with_secret(mut self, secret: impl Into<String>) -> Self {
        self.terminal_secret = Some(secret.into());
        self
    }

    /// Set metadata JSON string.
    #[must_use]
    pub fn with_metadata(mut self, metadata: impl Into<String>) -> Self {
        self.metadata = Some(metadata.into());
        self
    }
}

/// Strongly-typed identifier for a Terminal.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct TerminalId(String);

impl TerminalId {
    /// Generate a new UUID v7 identifier.
    #[must_use]
    pub fn new() -> Self {
        Self(uuid::Uuid::now_v7().to_string())
    }

    /// Borrow the underlying UUID string slice.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl Default for TerminalId {
    fn default() -> Self {
        Self::new()
    }
}

impl std::ops::Deref for TerminalId {
    type Target = str;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl std::fmt::Display for TerminalId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl From<String> for TerminalId {
    fn from(s: String) -> Self {
        Self(s)
    }
}

impl From<&str> for TerminalId {
    fn from(s: &str) -> Self {
        Self(s.to_owned())
    }
}

#[cfg(test)]
#[path = "models_tests.rs"]
mod tests;
