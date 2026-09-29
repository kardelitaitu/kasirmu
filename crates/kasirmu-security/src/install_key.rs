//! Resolution of the per-install at-rest key — the keychain half of C1 slice S2b-2.
//!
//! `kasirmu-crypto` derives at-rest keys; this crate owns the OS credential store.
//! The two crates are deliberate **siblings** — neither depends on the other — so
//! the place that reads the keychain cannot be the place that derives from it.
//! This module is the seam between them: it resolves the per-install secret from
//! the keyring and hands the caller 32 raw bytes, which the caller passes to
//! `kasirmu_crypto::set_install_key`.
//!
//! # Why this is not [`Keyring::rotate_key`]
//!
//! [`Keyring::rotate_key`] overwrites the stored key every time it is called.
//! Calling it from a boot path would mint a fresh secret on **every launch** and
//! orphan every row written under the previous one. Resolution here is
//! **generate-once**: it reads, and generates only when the entry is absent.
//!
//! # Why "absent" does not simply mean "generate"
//!
//! The in-memory fallback ([`crate::InMemoryKeyring`]) starts empty on every boot,
//! so a key generated into it is gone at the next launch. See
//! [`resolve_install_key`] for the guard and why refusing is the conservative
//! answer.

use crate::{Keyring, SecurityError};
use rand::RngCore;
use zeroize::Zeroizing;

/// The keychain entry holding the per-install at-rest key.
///
/// Deliberately **not** `oz-pos/encryption-key`
/// (`crates/kasirmu-bridge/src/security.rs`): that entry is rotated on demand and
/// its rotation archives the old value **without re-wrapping any stored row**, so
/// reusing it would orphan the settings ciphertext the moment an operator rotated
/// it. This entry has its own lifecycle, and its only rotation path is `oz rekey`
/// (C1 slice S2c).
pub const INSTALL_KEY_ENTRY: &str = "oz-pos/at-rest-key.v1";

/// How a resolved key came to exist.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum InstallKeySource {
    /// The keychain entry already held a usable key.
    Loaded,
    /// No entry existed and a fresh key was generated and stored.
    Generated,
}

/// The outcome of [`resolve_install_key`].
///
/// `Debug` is written by hand rather than derived: the `Ready` arm holds key
/// material, and a derived `Debug` would print it into any log line, panic
/// message or `dbg!` that ever formats this value. (The same defect class was
/// recorded as C89 for two domain structs with derived `Debug`.)
pub enum InstallKeyResolution {
    /// A usable 32-byte secret.
    Ready {
        /// The per-install secret. Hand this to `kasirmu_crypto::set_install_key`.
        secret: [u8; 32],
        /// Whether it was loaded or freshly generated.
        source: InstallKeySource,
    },
    /// No key was provided, and none was generated because the keyring is not
    /// durable (C1 hazard H3).
    ///
    /// **This is not an error.** The caller must keep the previous derivation and
    /// log the reason; treating it as a failure would make a developer machine or
    /// a CI runner unable to start at all.
    RefusedNonDurableKeyring,
}

impl std::fmt::Debug for InstallKeyResolution {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Ready { source, .. } => f
                .debug_struct("InstallKeyResolution::Ready")
                .field("secret", &"<redacted>")
                .field("source", source)
                .finish(),
            Self::RefusedNonDurableKeyring => {
                f.write_str("InstallKeyResolution::RefusedNonDurableKeyring")
            }
        }
    }
}

/// Resolve the per-install at-rest key, generating one only when that is safe.
///
/// # The three cases
///
/// 1. **Entry present and well-formed** → [`InstallKeyResolution::Ready`] with
///    [`InstallKeySource::Loaded`]. Nothing is written.
/// 2. **Entry present but malformed** → an error, and it is **never regenerated**.
///    A value that cannot be parsed may still be the key that decrypts every
///    existing row; replacing it would orphan them, and doing so silently is the
///    worst outcome available here.
/// 3. **Entry absent** → generate **only if the keyring is durable**
///    ([`Keyring::is_durable`]). Otherwise
///    [`InstallKeyResolution::RefusedNonDurableKeyring`].
///
/// # Why case 3 refuses rather than warns (C1 hazard H3)
///
/// The in-memory fallback starts empty on every boot. A key generated into it is
/// gone at the next launch and every row written under it becomes undecryptable —
/// including rows the operator cannot re-enter, because two of the six at-rest
/// families (`set_rate_sync_api_key`, `set_lan_server_psk`) have no production
/// setter at all. Refusing leaves at-rest behaviour exactly as it was, which is
/// the conservative answer D1 recorded on 2026-09-29.
///
/// # Errors
///
/// Returns [`SecurityError::KeyUnavailable`] when the entry exists but is not a
/// 32-byte hex value, and [`SecurityError::KeyGenerationFailed`] when the OS RNG
/// fails. A backend read or write failure surfaces as its own [`SecurityError`].
pub fn resolve_install_key(keyring: &dyn Keyring) -> Result<InstallKeyResolution, SecurityError> {
    if let Some(stored) = keyring.get_secret(INSTALL_KEY_ENTRY)? {
        return Ok(InstallKeyResolution::Ready {
            secret: decode_stored_key(&stored)?,
            source: InstallKeySource::Loaded,
        });
    }

    if !keyring.is_durable() {
        return Ok(InstallKeyResolution::RefusedNonDurableKeyring);
    }

    let mut secret = [0u8; 32];
    rand::thread_rng()
        .try_fill_bytes(&mut secret)
        .map_err(|e| SecurityError::KeyGenerationFailed(format!("rng error: {e}")))?;

    // SEC-6 pattern, as in `Keyring::rotate_key`: the encoded copy lives in a
    // zeroizing allocation so the hex string does not outlive this call. The
    // returned array is the caller's — `set_install_key` takes it by value, and
    // this function cannot scrub a copy it no longer owns.
    let encoded = Zeroizing::new(hex::encode(secret));
    keyring.set_secret(INSTALL_KEY_ENTRY, &encoded)?;

    Ok(InstallKeyResolution::Ready {
        secret,
        source: InstallKeySource::Generated,
    })
}

/// Decode a stored key, refusing anything that is not exactly 32 hex-encoded bytes.
///
/// Both messages name the entry and the problem and never the value.
fn decode_stored_key(stored: &str) -> Result<[u8; 32], SecurityError> {
    let bytes = hex::decode(stored.trim()).map_err(|_| {
        SecurityError::KeyUnavailable(format!(
            "the {INSTALL_KEY_ENTRY} entry is not valid hex; refusing to regenerate it, \
             because a key that cannot be parsed may still decrypt existing rows and \
             replacing it would orphan them"
        ))
    })?;
    bytes.try_into().map_err(|v: Vec<u8>| {
        SecurityError::KeyUnavailable(format!(
            "the {INSTALL_KEY_ENTRY} entry is {} bytes, not 32; refusing to regenerate it \
             for the same reason",
            v.len()
        ))
    })
}

#[cfg(test)]
#[path = "install_key_tests.rs"]
mod tests;
