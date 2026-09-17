use super::*;
use crate::test_helpers::{CredentialGuard, set_and_verify, unique_test_name};

fn test_keyring() -> LibSecretKeyring {
    LibSecretKeyring::new().expect("failed to create keyring")
}

#[test]
#[ignore = "requires org.freedesktop.secrets D-Bus service"]
fn linux_roundtrip() {
    let k = test_keyring();
    let name = unique_test_name("oz-pos-test-linux-roundtrip");
    let _guard = CredentialGuard::new(name.clone(), &k);

    assert_eq!(k.get_secret(&name).unwrap(), None);

    set_and_verify(&k, &name, "linux-secret-42");

    assert!(k.delete_secret(&name).unwrap());
    assert_eq!(k.get_secret(&name).unwrap(), None);
}

#[test]
#[ignore = "requires org.freedesktop.secrets D-Bus service"]
fn linux_delete_nonexistent_returns_false() {
    let k = test_keyring();
    let name = unique_test_name("oz-pos-test-nonexistent-del-linux");
    let _guard = CredentialGuard::new(name.clone(), &k);
    assert!(!k.delete_secret(&name).unwrap());
}

#[test]
#[ignore = "requires org.freedesktop.secrets D-Bus service"]
fn linux_overwrite_existing() {
    let k = test_keyring();
    let name = unique_test_name("oz-pos-test-overwrite-linux");
    let _guard = CredentialGuard::new(name.clone(), &k);

    // Retry the writes until each value is observed. The Linux
    // Secret Service can be asynchronous about writes, so polling is
    // more robust than a single write/read.
    set_and_verify(&k, &name, "original");
    set_and_verify(&k, &name, "replacement");
}
