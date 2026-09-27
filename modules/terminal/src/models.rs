/*
last audited 25-07-26 by RSA-Agent (modules-terminal slice A: models deep read)
crate: modules-terminal | status: SAFE | lint: CLEAN
findings: MSL-9 INFO — Terminal derives Debug WITHOUT redacting terminal_secret (contrast pg_transport's redacted Debug); a logged or panic-dumped Terminal leaks the device secret; shell module (terminal logic lives in kasirmu-core) so exposure is limited. TerminalId UUID v7 clean
next: redact terminal_secret in Debug or drop the derive | perf: N/A
*/
//! Terminal domain models.

use serde::{Deserialize, Serialize};

/// A registered POS terminal.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
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
