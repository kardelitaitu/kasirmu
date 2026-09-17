use super::*;
use crate::test_helpers::{CredentialGuard, set_and_verify, unique_test_name};

fn test_keyring() -> WindowsCredentialManager {
    WindowsCredentialManager::new().expect("failed to create keyring")
}

#[test]
fn windows_roundtrip() {
    let k = test_keyring();
    let name = unique_test_name("oz-pos-test-windows-roundtrip");
    let _guard = CredentialGuard::new(name.clone(), &k);

    assert_eq!(k.get_secret(&name).unwrap(), None);

    set_and_verify(&k, &name, "test-value-123");

    // Deletion is handled by the guard on scope exit, which also covers
    // the panic path. Keep the explicit delete here to verify the API
    // returns true for an existing credential and that the secret is gone.
    assert!(k.delete_secret(&name).unwrap());
    assert_eq!(k.get_secret(&name).unwrap(), None);
}

#[test]
fn windows_delete_nonexistent_returns_false() {
    let k = test_keyring();
    let name = unique_test_name("oz-pos-test-nonexistent-delete");
    let _guard = CredentialGuard::new(name.clone(), &k);
    assert!(!k.delete_secret(&name).unwrap());
}

#[test]
fn windows_overwrite_existing() {
    let k = test_keyring();
    // Use a truly unique name so parallel threads under nextest
    // do not race on the same Windows credential.
    let name = unique_test_name("oz-pos-test-overwrite");
    let _guard = CredentialGuard::new(name.clone(), &k);

    // Retry the writes until each value is observed. Windows
    // Credential Manager can be asynchronous about writes, so polling
    // is more robust than a single write/read.
    set_and_verify(&k, &name, "v1");
    set_and_verify(&k, &name, "v2");
}
