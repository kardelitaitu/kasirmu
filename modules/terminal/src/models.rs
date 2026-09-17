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
mod tests {
    use super::*;

    // ── Terminal ────────────────────────────────────────────────────

    #[test]
    fn terminal_new_sets_defaults() {
        let t = Terminal::new("POS-1", "device-abc");
        assert_eq!(t.name, "POS-1");
        assert_eq!(t.device_id, "device-abc");
        assert!(t.is_active);
        assert!(t.terminal_secret.is_none());
        assert!(t.last_seen_at.is_none());
        assert!(t.metadata.is_none());
    }

    #[test]
    fn terminal_new_generates_unique_id() {
        let a = Terminal::new("A", "d1");
        let b = Terminal::new("B", "d2");
        assert_ne!(a.id, b.id);
    }

    #[test]
    fn terminal_with_secret() {
        let t = Terminal::new("T", "d").with_secret("s3cret");
        assert_eq!(t.terminal_secret.as_deref(), Some("s3cret"));
    }

    #[test]
    fn terminal_with_metadata() {
        let t = Terminal::new("T", "d").with_metadata(r#"{"key":"val"}"#);
        assert_eq!(t.metadata.as_deref(), Some(r#"{"key":"val"}"#));
    }

    #[test]
    fn terminal_builder_chain() {
        let t = Terminal::new("T", "d")
            .with_secret("sec")
            .with_metadata("{}");
        assert_eq!(t.terminal_secret.as_deref(), Some("sec"));
        assert_eq!(t.metadata.as_deref(), Some("{}"));
    }

    #[test]
    fn terminal_serde_roundtrip() {
        let t = Terminal::new("POS-1", "dev-1")
            .with_secret("s")
            .with_metadata(r#"{"a":1}"#);
        let json = serde_json::to_string(&t).unwrap();
        let back: Terminal = serde_json::from_str(&json).unwrap();
        assert_eq!(back.id, t.id);
        assert_eq!(back.name, "POS-1");
        assert_eq!(back.device_id, "dev-1");
        assert!(back.is_active);
    }

    // ── TerminalId ──────────────────────────────────────────────────

    #[test]
    fn terminal_id_new_generates_uuid_v7() {
        let id = TerminalId::new();
        let parsed = uuid::Uuid::parse_str(id.as_str()).unwrap();
        assert_eq!(parsed.get_version_num(), 7);
    }

    #[test]
    fn terminal_id_default_is_new_uuid() {
        let a = TerminalId::default();
        let b = TerminalId::default();
        assert_ne!(a.as_str(), b.as_str());
    }

    #[test]
    fn terminal_id_display_matches_as_str() {
        let id = TerminalId::new();
        assert_eq!(format!("{id}"), id.as_str());
    }

    #[test]
    fn terminal_id_deref_to_str() {
        let id = TerminalId::from("custom-id");
        assert_eq!(&*id, "custom-id");
        assert_eq!(id.len(), 9);
    }

    #[test]
    fn terminal_id_from_string_roundtrip() {
        let id = TerminalId::from("abc".to_string());
        assert_eq!(id.as_str(), "abc");
    }

    #[test]
    fn terminal_id_from_str_roundtrip() {
        let id = TerminalId::from("xyz");
        assert_eq!(id.as_str(), "xyz");
    }

    #[test]
    fn terminal_id_serde_roundtrip() {
        let id = TerminalId::from("test-id");
        let json = serde_json::to_string(&id).unwrap();
        let back: TerminalId = serde_json::from_str(&json).unwrap();
        assert_eq!(back.as_str(), "test-id");
    }
}
