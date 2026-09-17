use super::*;
use crate::test_helpers::{CredentialGuard, set_and_verify, unique_test_name};

fn test_keyring() -> MacOsKeychain {
    MacOsKeychain::new().expect("failed to create keyring")
}

#[test]
fn macos_roundtrip() {
    let k = test_keyring();
    let name = unique_test_name("oz-pos-test-macos-roundtrip");
    let _guard = CredentialGuard::new(name.clone(), &k);

    assert_eq!(k.get_secret(&name).unwrap(), None);

    set_and_verify(&k, &name, "s3kr3t!");

    assert!(k.delete_secret(&name).unwrap());
    assert_eq!(k.get_secret(&name).unwrap(), None);
}

#[test]
fn macos_delete_nonexistent_returns_false() {
    let k = test_keyring();
    let name = unique_test_name("oz-pos-test-nonexistent-del-mac");
    let _guard = CredentialGuard::new(name.clone(), &k);
    assert!(!k.delete_secret(&name).unwrap());
}

#[test]
fn macos_overwrite_existing() {
    let k = test_keyring();
    let name = unique_test_name("oz-pos-test-overwrite-mac");
    let _guard = CredentialGuard::new(name.clone(), &k);

    // Retry the writes until each value is observed. The macOS
    // keychain can be asynchronous about writes, so polling is more
    // robust than a single write/read.
    set_and_verify(&k, &name, "first");
    set_and_verify(&k, &name, "second");
}
