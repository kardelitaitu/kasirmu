//! Unit tests for `models`.
//!
//! Moved out of `models.rs` to satisfy the AGENTS.md section 2 rule that unit
//! tests live in a sibling `*_tests.rs` file rather than inside a production
//! `.rs` file. Wired from `models.rs` with:
//!   `#[cfg(test)] #[path = "models_tests.rs"] mod tests;`

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
