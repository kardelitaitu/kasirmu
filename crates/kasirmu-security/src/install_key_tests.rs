use super::*;
use crate::InMemoryKeyring;

/// A durable test keyring: an in-process map that claims durability.
///
/// It exists because the only non-durable implementation in the crate is
/// [`InMemoryKeyring`], and the guard under test is precisely the difference
/// between the two. Using a real OS keyring here would make the suite depend on a
/// developer machine's credential store.
#[derive(Default)]
struct DurableStubKeyring {
    secrets: std::sync::Mutex<std::collections::HashMap<String, String>>,
}

impl DurableStubKeyring {
    fn new() -> Self {
        Self::default()
    }

    /// Read a stored value directly, bypassing the trait, so a test can assert
    /// what the resolution actually wrote.
    fn peek(&self, name: &str) -> Option<String> {
        self.secrets.lock().unwrap().get(name).cloned()
    }

    /// Pre-seed an entry, so a test can drive the "already present" branches.
    fn seed(&self, name: &str, value: &str) {
        self.secrets
            .lock()
            .unwrap()
            .insert(name.to_owned(), value.to_owned());
    }
}

impl Keyring for DurableStubKeyring {
    fn get_secret(&self, name: &str) -> Result<Option<String>, SecurityError> {
        Ok(self.peek(name))
    }

    fn set_secret(&self, name: &str, value: &str) -> Result<(), SecurityError> {
        self.seed(name, value);
        Ok(())
    }

    fn delete_secret(&self, name: &str) -> Result<bool, SecurityError> {
        Ok(self.secrets.lock().unwrap().remove(name).is_some())
    }

    /// The one override that makes this stub the durable half of the pair.
    fn is_durable(&self) -> bool {
        true
    }
}

/// Case 3, the happy half: an absent entry on a durable store generates once,
/// stores the key, and returns it.
#[test]
fn generates_and_stores_once_on_a_durable_keyring() {
    let keyring = DurableStubKeyring::new();
    assert_eq!(keyring.peek(INSTALL_KEY_ENTRY), None);

    let first = resolve_install_key(&keyring).expect("resolve on an empty durable keyring");
    let InstallKeyResolution::Ready { secret, source } = first else {
        panic!("a durable keyring with no entry must generate one");
    };
    assert_eq!(source, InstallKeySource::Generated);

    // The key really was persisted, and as 32 hex-encoded bytes.
    let stored = keyring.peek(INSTALL_KEY_ENTRY).expect("entry written");
    assert_eq!(stored, hex::encode(secret));
    assert_eq!(stored.len(), 64);

    // Second call LOADS the same key rather than minting a new one. This is the
    // property that makes the boot path safe: `rotate_key` would have replaced it.
    let second = resolve_install_key(&keyring).expect("resolve again");
    let InstallKeyResolution::Ready {
        secret: again,
        source: again_source,
    } = second
    else {
        panic!("a populated durable keyring must resolve");
    };
    assert_eq!(again_source, InstallKeySource::Loaded);
    assert_eq!(
        again, secret,
        "a second resolution must return the SAME key, or every row written under \
         the first one would be orphaned on the next boot"
    );
}

/// Case 3, the guard: an absent entry on a NON-durable store generates nothing.
///
/// This is hazard H3. A key minted into the in-memory fallback is gone at the next
/// boot, and two of the six at-rest families have no production setter, so the
/// rows it encrypted could never be re-entered.
#[test]
fn refuses_to_generate_on_a_non_durable_keyring() {
    let keyring = InMemoryKeyring::new();

    let resolution = resolve_install_key(&keyring).expect("refusal is not an error");
    assert!(
        matches!(resolution, InstallKeyResolution::RefusedNonDurableKeyring),
        "a non-durable store must be refused, not silently used"
    );

    // And nothing was written: the store is still empty, so a later boot on a
    // durable store cannot mistake a throwaway key for a real one.
    assert_eq!(
        keyring.get_secret(INSTALL_KEY_ENTRY).unwrap(),
        None,
        "the refusal must not have written an entry"
    );
}

/// Case 1: an entry that is already present is LOADED and left untouched.
#[test]
fn loads_an_existing_key_without_rewriting_it() {
    let keyring = DurableStubKeyring::new();
    let existing = "ab".repeat(32);
    keyring.seed(INSTALL_KEY_ENTRY, &existing);

    let resolution = resolve_install_key(&keyring).expect("resolve a seeded entry");
    let InstallKeyResolution::Ready { secret, source } = resolution else {
        panic!("a seeded entry must resolve");
    };
    assert_eq!(source, InstallKeySource::Loaded);
    assert_eq!(hex::encode(secret), existing);

    assert_eq!(
        keyring.peek(INSTALL_KEY_ENTRY).as_deref(),
        Some(existing.as_str()),
        "resolution must not rewrite a key it merely read"
    );
}

/// Case 2: a malformed entry is an ERROR and is NEVER regenerated.
///
/// The failure mode this pins: treating an unreadable key as "absent" and minting
/// a replacement, which orphans every row the original key encrypted — silently,
/// and on a store the operator cannot re-enter for two of the six families.
#[test]
fn refuses_a_malformed_entry_and_never_regenerates_it() {
    for malformed in [
        "not-hex-at-all",
        "",
        "ab",
        &"ab".repeat(31),
        &"ab".repeat(33),
    ] {
        let keyring = DurableStubKeyring::new();
        keyring.seed(INSTALL_KEY_ENTRY, malformed);

        let result = resolve_install_key(&keyring);
        assert!(
            matches!(result, Err(SecurityError::KeyUnavailable(_))),
            "{malformed:?} must be refused as an unusable stored key"
        );

        assert_eq!(
            keyring.peek(INSTALL_KEY_ENTRY).as_deref(),
            Some(malformed),
            "{malformed:?} must still be in the store: regenerating over a key that \
             may still decrypt existing rows is the orphaning this refuses to do"
        );
    }
}

/// The resolved secret is real key material, so a derived `Debug` would leak it.
#[test]
fn debug_redacts_the_secret() {
    let keyring = DurableStubKeyring::new();
    let resolution = resolve_install_key(&keyring).expect("resolve");
    let InstallKeyResolution::Ready { secret, .. } = &resolution else {
        panic!("expected a generated key");
    };

    let rendered = format!("{resolution:?}");
    assert!(
        rendered.contains("<redacted>"),
        "Debug must show that a secret is present without showing it: {rendered}"
    );
    let hexed = hex::encode(secret);
    assert!(
        !rendered.contains(&hexed),
        "Debug printed the full key: {rendered}"
    );
    // A partial leak is still a leak: no 8-byte prefix, and no prefix of the
    // base64-ish rendering either.
    assert!(
        !rendered.contains(&hexed[..16]),
        "Debug printed a key prefix: {rendered}"
    );
}

/// The entry name is a claim about the keychain, and this one must not be the
/// entry the bridge already rotates.
///
/// `oz-pos/encryption-key` archives its previous value on rotation **without
/// re-wrapping any stored row**, so pointing the at-rest key at it would orphan the
/// settings ciphertext on an operator's next rotation.
#[test]
fn the_entry_is_its_own_name_and_not_the_rotated_bridge_entry() {
    assert_eq!(INSTALL_KEY_ENTRY, "oz-pos/at-rest-key.v1");
    assert!(
        INSTALL_KEY_ENTRY.starts_with("oz-pos/"),
        "keychain entries are namespaced"
    );
    assert_ne!(
        INSTALL_KEY_ENTRY, "oz-pos/encryption-key",
        "must not reuse the bridge's rotated entry"
    );
    assert!(
        INSTALL_KEY_ENTRY.ends_with(".v1"),
        "the entry carries a version so a future scheme can be added beside it"
    );
}
