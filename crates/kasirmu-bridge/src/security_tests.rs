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

// ── C1 S2b-2b: the boot-time at-rest key resolver ───────────────────
//
// These drive the seam the boot path calls. The process-global `INSTALL_KEY`
// in `kasirmu-crypto` is a `OnceLock`, so a test that installs one cannot be
// repeated or undone — which is why the cases below assert on the RESOLUTION
// (pure, per-keyring) rather than on `install_at_rest_key`'s process-global
// effect. `crates/kasirmu-crypto/tests/at_rest_key_lifecycle.rs` owns the
// install-and-derive half, in its own process.

/// The in-memory keyring is never durable, so the H3 refusal is deterministic.
#[test]
fn in_memory_keyring_is_not_durable() {
    assert!(
        !kasirmu_security::InMemoryKeyring::new().is_durable(),
        "the in-memory fallback must report non-durable or H3's guard is untestable"
    );
}

/// H3: an absent entry on a non-durable keyring must REFUSE, never generate.
#[test]
fn absent_entry_on_a_non_durable_keyring_refuses_to_generate() {
    use kasirmu_security::install_key::{InstallKeyResolution, resolve_install_key};

    let keyring = kasirmu_security::InMemoryKeyring::new();
    let resolved = resolve_install_key(&keyring).expect("resolution must not error");

    assert!(
        matches!(resolved, InstallKeyResolution::RefusedNonDurableKeyring),
        "a key generated into an in-memory keyring is gone next boot, so it must \
         be refused rather than generated; got {resolved:?}"
    );
    // And nothing was written, so a later boot sees the same absent entry.
    assert_eq!(
        keyring
            .get_secret(kasirmu_security::install_key::INSTALL_KEY_ENTRY)
            .unwrap(),
        None,
        "a refusal must not leave anything behind"
    );
}

/// The entry is read back verbatim when present — no regeneration.
#[test]
fn a_present_entry_is_loaded_not_regenerated() {
    use kasirmu_security::install_key::{
        INSTALL_KEY_ENTRY, InstallKeyResolution, InstallKeySource, resolve_install_key,
    };

    let keyring = kasirmu_security::InMemoryKeyring::new();
    let original = [7u8; 32];
    keyring
        .set_secret(INSTALL_KEY_ENTRY, &hex::encode(original))
        .unwrap();

    let resolved = resolve_install_key(&keyring).expect("resolution must not error");
    match resolved {
        InstallKeyResolution::Ready { secret, source } => {
            assert_eq!(
                secret, original,
                "the stored key must be returned unchanged"
            );
            assert_eq!(
                source,
                InstallKeySource::Loaded,
                "a present entry is LOADED"
            );
        }
        other => panic!("expected Ready/Loaded, got {other:?}"),
    }
}

/// A malformed entry is an ERROR, and is never silently replaced.
///
/// This is the case that would orphan every existing row if it regenerated: a
/// value that cannot be parsed may still be the key that decrypts them.
#[test]
fn a_malformed_entry_errors_and_is_never_regenerated() {
    use kasirmu_security::install_key::{INSTALL_KEY_ENTRY, resolve_install_key};

    let keyring = kasirmu_security::InMemoryKeyring::new();
    keyring
        .set_secret(INSTALL_KEY_ENTRY, "not-hex-at-all")
        .unwrap();

    let err = resolve_install_key(&keyring).expect_err("malformed must be an error");
    let msg = err.to_string();
    assert!(
        msg.contains(INSTALL_KEY_ENTRY),
        "the error must name the entry, got: {msg}"
    );
    assert!(
        !msg.contains("not-hex-at-all"),
        "the error must never echo the stored value, got: {msg}"
    );
    // The malformed value is still there — nothing overwrote it.
    assert_eq!(
        keyring.get_secret(INSTALL_KEY_ENTRY).unwrap().as_deref(),
        Some("not-hex-at-all"),
        "a malformed key must be left intact for the operator to inspect"
    );
}

/// A wrong-length but valid-hex entry is also refused, by length.
#[test]
fn a_wrong_length_entry_is_refused_by_length() {
    use kasirmu_security::install_key::{INSTALL_KEY_ENTRY, resolve_install_key};

    let keyring = kasirmu_security::InMemoryKeyring::new();
    keyring
        .set_secret(INSTALL_KEY_ENTRY, &hex::encode([1u8; 16]))
        .unwrap();

    let msg = resolve_install_key(&keyring).unwrap_err().to_string();
    assert!(
        msg.contains("16 bytes"),
        "the error must name the length, got: {msg}"
    );
}

/// `install_at_rest_key` never fails boot, on any keychain outcome.
///
/// This is the property that matters most for a boot path: no arm may abort the
/// process. On a CI/developer machine the real keyring may be absent entirely,
/// so the assertion is on the SHAPE of the outcome, not on which arm is taken.
#[test]
fn install_at_rest_key_never_panics_and_reports_an_outcome() {
    let outcome = install_at_rest_key();
    match outcome {
        InstallKeyOutcome::Ready { .. }
        | InstallKeyOutcome::RefusedNonDurableKeyring
        | InstallKeyOutcome::Unavailable(_) => {}
    }
}

/// The outcome type must not leak key material through `Debug`.
#[test]
fn the_outcome_debug_carries_no_key_material() {
    let ready = InstallKeyOutcome::Ready {
        installed_now: true,
        source: InstallKeySource::Generated,
    };
    let rendered = format!("{ready:?}");
    assert!(rendered.contains("Generated"), "got: {rendered}");
    // A 64-char hex string is what a key would look like if it leaked.
    assert!(
        !rendered.chars().filter(|c| c.is_ascii_hexdigit()).count() >= 64,
        "the Debug rendering must not contain key material: {rendered}"
    );
}
