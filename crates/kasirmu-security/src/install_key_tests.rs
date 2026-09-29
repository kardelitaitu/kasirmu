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

// -- S2c: the staged rotation ------------------------------------------------

/// The parked entry is DERIVED from the current one, so a rename of either cannot
/// leave the two halves of a rotation pointing at different keychain entries.
#[test]
fn the_previous_entry_is_the_current_entry_plus_prev() {
    assert_eq!(
        INSTALL_KEY_PREV_ENTRY,
        format!("{INSTALL_KEY_ENTRY}-prev"),
        "the parked entry follows the same {{name}}-prev convention Keyring::rotate_key uses"
    );
    assert_ne!(INSTALL_KEY_PREV_ENTRY, INSTALL_KEY_ENTRY);
}

/// An absent parked entry is `Ok(None)` and writes NOTHING — a boot must never
/// start a rotation.
#[test]
fn resolve_previous_install_key_is_absent_by_default_and_never_generates() {
    let keyring = DurableStubKeyring::new();
    assert_eq!(
        resolve_previous_install_key(&keyring).expect("absent is not an error"),
        None,
        "no rotation in flight means there is nothing extra to read"
    );
    assert_eq!(
        keyring.peek(INSTALL_KEY_PREV_ENTRY),
        None,
        "a boot must never generate a parked key: a rotation is started by `oz rekey`, not by boot"
    );
}

/// The core of the ordering: the outgoing key is PARKED and a different key is
/// PROMOTED, so both are durably present after this call returns.
#[test]
fn begin_rotation_parks_the_outgoing_key_and_promotes_a_new_one() {
    let keyring = DurableStubKeyring::new();
    let old = hex::encode([0x11u8; 32]);
    keyring.seed(INSTALL_KEY_ENTRY, &old);

    let rotation = begin_install_key_rotation(&keyring).expect("rotation begins");

    assert_eq!(
        rotation.outgoing.map(hex::encode),
        Some(old.clone()),
        "the outgoing key handed back to the caller is the one that was current"
    );
    assert_eq!(
        keyring.peek(INSTALL_KEY_PREV_ENTRY),
        Some(old.clone()),
        "the outgoing key is parked, so rows still under it keep decrypting"
    );
    assert_eq!(
        keyring.peek(INSTALL_KEY_ENTRY),
        Some(hex::encode(rotation.new_secret)),
        "the current entry now holds the freshly generated key"
    );
    assert_ne!(
        hex::encode(rotation.new_secret),
        old,
        "a rotation must actually change the key"
    );
}

/// The state a crash between promote and sweep leaves: BOTH keys resolvable, so
/// every row reads — old or already re-encrypted. This is the slice's gate.
#[test]
fn an_interrupted_rotation_leaves_both_keys_resolvable() {
    let keyring = DurableStubKeyring::new();
    let old = [0x22u8; 32];
    keyring.seed(INSTALL_KEY_ENTRY, &hex::encode(old));

    let rotation = begin_install_key_rotation(&keyring).expect("rotation begins");

    // Deliberately NO retire: this is the interrupted state.
    let InstallKeyResolution::Ready {
        secret: current, ..
    } = resolve_install_key(&keyring).expect("current resolves")
    else {
        panic!("a key is present, so resolution must be Ready");
    };
    assert_eq!(
        current, rotation.new_secret,
        "the boot installs the new key"
    );
    assert_eq!(
        resolve_previous_install_key(&keyring).expect("previous resolves"),
        Some(old),
        "and the outgoing key too, so a row the sweep has not reached still reads"
    );
    assert_ne!(
        current, old,
        "the two slots must hold different keys, or 'both resolvable' proves nothing"
    );
}

/// A half-finished rotation must not be silently restarted: the parked key may be
/// the only way to read rows the sweep has not reached.
#[test]
fn begin_rotation_refuses_when_a_previous_key_is_already_parked() {
    let keyring = DurableStubKeyring::new();
    let current = hex::encode([0x33u8; 32]);
    let parked = hex::encode([0x44u8; 32]);
    keyring.seed(INSTALL_KEY_ENTRY, &current);
    keyring.seed(INSTALL_KEY_PREV_ENTRY, &parked);

    let err = begin_install_key_rotation(&keyring)
        .expect_err("a half-finished rotation must not be silently restarted");
    let msg = err.to_string();
    assert!(
        msg.contains(INSTALL_KEY_PREV_ENTRY),
        "the refusal names the entry, got: {msg}"
    );
    assert_eq!(
        keyring.peek(INSTALL_KEY_PREV_ENTRY),
        Some(parked),
        "the parked key is untouched — overwriting it would orphan the rows under it"
    );
    assert_eq!(
        keyring.peek(INSTALL_KEY_ENTRY),
        Some(current),
        "and the current key is untouched too"
    );
}

/// Retiring removes ONLY the parked entry; the promoted key survives, and a second
/// retire reports that there was nothing left to remove.
#[test]
fn retire_previous_install_key_deletes_only_the_parked_entry() {
    let keyring = DurableStubKeyring::new();
    keyring.seed(INSTALL_KEY_ENTRY, &hex::encode([0x55u8; 32]));
    let rotation = begin_install_key_rotation(&keyring).expect("rotation begins");
    let promoted = hex::encode(rotation.new_secret);

    assert!(
        retire_previous_install_key(&keyring).expect("retire"),
        "an entry was parked, so retiring removes one"
    );
    assert_eq!(keyring.peek(INSTALL_KEY_PREV_ENTRY), None);
    assert_eq!(
        keyring.peek(INSTALL_KEY_ENTRY),
        Some(promoted),
        "retiring the outgoing key must not disturb the current one"
    );
    assert!(
        !retire_previous_install_key(&keyring).expect("retire again"),
        "a second retire finds nothing and says so"
    );
}

/// `Debug` must not print either half of a rotation.
#[test]
fn rotation_debug_redacts_both_secrets() {
    let keyring = DurableStubKeyring::new();
    keyring.seed(INSTALL_KEY_ENTRY, &hex::encode([0x66u8; 32]));
    let rotation = begin_install_key_rotation(&keyring).expect("rotation begins");
    let outgoing = hex::encode(rotation.outgoing.expect("a key was parked"));

    let rendered = format!("{rotation:?}");
    assert!(rendered.contains("<redacted>"), "{rendered}");
    assert!(
        !rendered.contains(&hex::encode(rotation.new_secret)),
        "Debug printed the new key: {rendered}"
    );
    assert!(
        !rendered.contains(&outgoing),
        "Debug printed the outgoing key: {rendered}"
    );
}
