//! Unit tests for the security command bodies (Wave-B test relocation: moved
//! out of `apps/desktop-tauri/src/commands/security_tests.rs`).
//!
//! Mounted at the foot of `security.rs` with `#[cfg(test)] #[path]`, so
//! `use super::*` resolves `ENCRYPTION_KEY_NAME`, the thread-isolated
//! `with_keyring` pipeline and the pure `key_rotation_status` step exactly
//! as the desktop sibling module did — the shell's `AppError`-typed adapters
//! were thin wrappers over this error-generic pipeline, so the async case now
//! drives `with_keyring` directly with `BridgeError` as the error type
//! (the reflexive `From` impl satisfies the bound). The InMemoryKeyring
//! cases need no `TestBridge`: the two command bodies are session-free by
//! design, and the keyring ops deliberately run on their own OS thread.

use super::*;
use kasirmu_security::Keyring;

#[test]
fn key_name_is_constant() {
    assert_eq!(ENCRYPTION_KEY_NAME, "oz-pos/encryption-key");
}

#[test]
fn rotation_status_defaults() {
    // When there's no key, status should reflect that.
    let keyring = kasirmu_security::InMemoryKeyring::new();
    assert_eq!(keyring.key_created_at("test").unwrap(), None);
}

#[tokio::test]
async fn get_key_rotation_info_returns_status() {
    // Exercise the async thread-isolation bridge without platform
    // dependencies or a Secret Service/D-Bus session.
    let status = with_keyring(
        || Ok(Box::new(kasirmu_security::InMemoryKeyring::new()) as Box<dyn Keyring>),
        key_rotation_status,
    )
    .await
    .unwrap();
    assert!(!status.has_key);
    assert!(status.created_at.is_none());
    assert!(status.age_days.is_none());
}

#[test]
fn key_rotation_info_reports_created_key() {
    let keyring = kasirmu_security::InMemoryKeyring::new();
    keyring.rotate_key(ENCRYPTION_KEY_NAME).unwrap();

    let status = key_rotation_status(&keyring).unwrap();
    assert!(status.has_key);
    assert!(status.created_at.is_some());
    assert_eq!(status.age_days, Some(0));
}
