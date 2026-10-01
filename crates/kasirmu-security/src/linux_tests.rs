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

/// SEC-9 regression pin: the `Delete` issued by `set_secret` before its
/// `CreateItem` must propagate a failure instead of being discarded.
///
/// A swallowed delete leaves the previous item live under the same name while
/// a new one is created, so one name resolves to two secrets and a later read
/// may return either value. The platform gate means this module is not compiled
/// on the Windows host CI runs on, so the check reads the source rather than
/// driving D-Bus: it fails if the swallow pattern reappears anywhere in
/// `set_secret`'s body.
#[test]
fn set_secret_never_discards_a_failed_delete() {
    const SOURCE: &str = include_str!("linux.rs");
    let body = source_between(SOURCE, "fn set_secret", "fn delete_secret");

    assert!(
        !body.contains("let _ ="),
        "set_secret must not discard a result with `let _ =`; a failed Delete has to abort the write (SEC-9)"
    );
    assert!(
        !body.contains("best_effort"),
        "set_secret must not treat the pre-create Delete as best-effort (SEC-9)"
    );
    assert!(
        body.contains("Delete failed") && body.contains(")?;"),
        "set_secret must propagate the Delete error with `?` (SEC-9)"
    );
}

/// The slice of `source` from `start` up to (not including) `end`.
fn source_between<'a>(source: &'a str, start: &str, end: &str) -> &'a str {
    let from = source
        .find(start)
        .unwrap_or_else(|| panic!("'{}' not found in linux.rs", start));
    let rest = &source[from..];
    let to = rest
        .find(end)
        .unwrap_or_else(|| panic!("'{}' not found after '{}'", end, start));
    &rest[..to]
}

#[test]
#[ignore = "requires org.freedesktop.secrets D-Bus service"]
fn linux_overwrite_leaves_exactly_one_item() {
    let k = test_keyring();
    let name = unique_test_name("oz-pos-test-overwrite-single-linux");
    let _guard = CredentialGuard::new(name.clone(), &k);

    set_and_verify(&k, &name, "original");
    set_and_verify(&k, &name, "replacement");

    // SEC-9: a superseded item must be gone, not shadowed by a duplicate.
    assert_eq!(
        k.rt.block_on(k.search_items(&attributes(&name)))
            .unwrap()
            .len(),
        1,
        "an overwrite must leave exactly one item for the name"
    );
    assert_eq!(k.get_secret(&name).unwrap().as_deref(), Some("replacement"));
}
