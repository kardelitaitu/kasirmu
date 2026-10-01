//! Terminal domain types — shared by the terminal module and the core facade.
//!
//! Moved here from `modules-terminal` (ADR-61 / C26, 2026-09-28) so `kasirmu-core` can re-export
//! them without depending on a business module. Every impl moved with its type, inherent ones
//! because Rust requires that (E0116) and trait ones because the types are local here. Neither type
//! carries a database dependency — the only imports are serde and uuid.
//!
//! The hand-written `Debug` for `Terminal` is preserved verbatim: it redacts `terminal_secret`
//! (MSL-9), and moving the type must not silently restore a derived impl that printed it.

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
#[path = "terminal_tests.rs"]
mod tests;
