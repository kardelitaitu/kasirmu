//! Unit tests for `auth`.
//!
//! Moved out of `auth.rs` to satisfy the AGENTS.md section 2 rule that unit
//! tests live in a sibling `*_tests.rs` file rather than inside a production
//! `.rs` file. Wired from `auth.rs` with:
//!   `#[cfg(test)] #[path = "auth_tests.rs"] mod tests;`

use super::*;

#[test]
fn hash_and_verify_correct_pin() {
    let pin = "1234";
    let hash = hash_pin(pin).unwrap();
    assert!(hash.starts_with("$argon2id$"));
    assert!(verify_pin(pin, &hash).unwrap());
}

#[test]
fn verify_wrong_pin_returns_false() {
    let hash = hash_pin("1234").unwrap();
    assert!(!verify_pin("5678", &hash).unwrap());
}

#[test]
fn verify_empty_pin() {
    let hash = hash_pin("").unwrap();
    assert!(verify_pin("", &hash).unwrap());
    assert!(!verify_pin(" ", &hash).unwrap());
}

#[test]
fn hash_is_deterministic_with_different_salts() {
    let h1 = hash_pin("0000").unwrap();
    let h2 = hash_pin("0000").unwrap();
    assert_ne!(h1, h2);
    assert!(verify_pin("0000", &h1).unwrap());
    assert!(verify_pin("0000", &h2).unwrap());
}

#[test]
fn verify_invalid_hash_format_fails_closed() {
    // Malformed hashes must fail closed (Ok(false)), never an internal error.
    assert!(!verify_pin("1234", "not-a-valid-hash").unwrap());
}

#[test]
fn verify_snapshot_placeholder_hash_fails_closed() {
    // The sync-import placeholder (kasirmu-core SNAPSHOT_PIN_HASH_PLACEHOLDER)
    // must not verify against any PIN and must not surface an internal error.
    assert!(!verify_pin("1234", "!snapshot-no-credential!").unwrap());
    assert!(!verify_pin("", "!snapshot-no-credential!").unwrap());
}

#[test]
fn login_session_serde_roundtrip() {
    let session = LoginSession {
        user_id: "u1".into(),
        display_name: "Alice".into(),
        role_name: "staff".into(),
        role_id: "role-staff".into(),
        permissions: vec!["sales:process".into(), "analytics:view".into()],
    };
    let json = serde_json::to_string(&session).unwrap();
    let back: LoginSession = serde_json::from_str(&json).unwrap();
    assert_eq!(back.user_id, "u1");
    assert_eq!(back.display_name, "Alice");
    assert_eq!(back.role_name, "staff");
    assert_eq!(back.role_id, "role-staff");
    // The granted keys ride the wire verbatim — the UI mirrors the
    // backend registry from them.
    assert_eq!(back.permissions, vec!["sales:process", "analytics:view"]);
}

#[test]
fn login_session_missing_permissions_defaults_empty() {
    // Older payloads (and older clients) have no `permissions` field;
    // serde default keeps them parsing instead of failing the session.
    let json = r##"{"user_id":"u1","display_name":"Alice","role_name":"staff","role_id":"role-staff"}"##;
    let back: LoginSession = serde_json::from_str(json).unwrap();
    assert!(back.permissions.is_empty());
}

#[test]
fn login_session_debug() {
    let session = LoginSession {
        user_id: "u1".into(),
        display_name: "Alice".into(),
        role_name: "manager".into(),
        role_id: "role-manager".into(),
        permissions: vec![],
    };
    let debug = format!("{session:?}");
    assert!(debug.contains("u1"));
    assert!(debug.contains("Alice"));
    assert!(debug.contains("manager"));
}

#[test]
fn login_session_clone_eq() {
    let s1 = LoginSession {
        user_id: "u1".into(),
        display_name: "Bob".into(),
        role_name: "owner".into(),
        role_id: "role-owner".into(),
        permissions: vec!["*".into()],
    };
    let s2 = s1.clone();
    assert_eq!(s1.user_id, s2.user_id);
    assert_eq!(s1.display_name, s2.display_name);
    assert_eq!(s1.role_name, s2.role_name);
    assert_eq!(s1.role_id, s2.role_id);
}

#[test]
fn login_session_json_field_names() {
    let session = LoginSession {
        user_id: "u1".into(),
        display_name: "Alice".into(),
        role_name: "staff".into(),
        role_id: "role-staff".into(),
        permissions: vec!["sales:view".into()],
    };
    let json = serde_json::to_value(&session).unwrap();
    assert_eq!(json["user_id"], "u1");
    assert_eq!(json["display_name"], "Alice");
    assert_eq!(json["role_name"], "staff");
    assert_eq!(json["role_id"], "role-staff");
    assert_eq!(json["permissions"], serde_json::json!(["sales:view"]));
}
