/*
last audited DD-MM-YY by DSH-Agent
crate: kasirmu-crypto | status: SAFE | lint: CLEAN
findings: CryptoError marked #[non_exhaustive] per house convention; one .expect() in hmac_key documented as INVARIANT (32-byte HMAC key never empty, safe by construction); 0 unsafe blocks verified by source sweep; portable derivation is documented obfuscation (not confidentiality), master-key opt-in available via OZ_MASTER_KEY env; 196-line test suite covers all paths. No new defects found.
next: none — crate is stable and well-tested | perf: N/A
*/
//! AES-256-GCM encryption helpers for encrypting sensitive data at rest.
//!
//! Uses AES-256-GCM with a key derived from a domain prefix and either
//! the machine's hardware fingerprint (machine-bound) or a static
//! derivation (portable across machines).
//!
//! Ciphertext format: `base64(nonce || ciphertext || tag)` where
//! `nonce` is 12 bytes (random), `ciphertext` is the encrypted
//! plaintext, and `tag` is the 16-byte GCM authentication tag
//! (appended automatically by `aes-gcm`).
//!
//! Reads are branch-tolerant: a row is accepted under whichever candidate
//! derivation authenticates it - the family's legacy derivation, the
//! `OZ_MASTER_KEY` HMAC derivation, or (C1 slice S2b-1) a per-install key
//! installed into this process with [`set_install_key`]. Writes still use
//! exactly one derivation, selected by [`portable_key`]: install key when one is
//! installed, else `OZ_MASTER_KEY`, else legacy. With no key installed the
//! selection is byte-identical to the pre-S2b-1 behaviour, so this seam alone
//! changes nothing at runtime.

// rustdoc::private_intra_doc_links is allowed crate-wide, deliberately.
//
// The crate's public API is small (`encrypt`, `decrypt`, `install_key`,
// `set_install_key`, `install_key_derivation_active`,
// `master_key_derivation_active`) but its correctness argument lives in the
// PRIVATE derivation helpers: `portable_key`, `candidate_keys`, `hmac_key`
// and `master_key_from_env`. The public doc comments reference those helpers
// by intra-doc link because naming the actual function is more precise than a
// prose description — "falls back in `portable_key`" says something a reader
// can verify, "falls back to the legacy derivation" does not.
//
// Rustdoc cannot resolve a link to a private item from a public doc, so
// `RUSTDOCFLAGS="-D warnings"` turns each one into an error (measured
// 2026-09-27: 10 sites across this file). Rendering them as plain code spans
// instead would keep the build green and lose the navigability that makes
// them worth writing.
//
// The allow is scoped to this lint only, so a genuinely broken link — one
// pointing at an item that does NOT exist — still fails the build. Only
// "private but present" is tolerated, which is exactly the case that is
// correct here.
#![deny(unsafe_code)]
#![allow(rustdoc::private_intra_doc_links)]

use aes_gcm::{Aes256Gcm, KeyInit, aead::Aead, aead::generic_array::GenericArray};
use hmac::{Hmac, Mac};
use rand::RngCore;
use sha2::{Digest, Sha256};
use std::sync::OnceLock;

/// Error type for cryptographic operations.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum CryptoError {
    /// An internal cryptographic error occurred.
    #[error("crypto error: {0}")]
    Internal(String),
}

// ── Key derivation ───────────────────────────────────────────────────

/// Derive a 256-bit AES key from a domain prefix and machine ID via SHA-256.
///
/// The key is deterministic for the same domain + machine ID — this is by
/// design: machine-bound encryption binds the ciphertext to the hardware
/// that owns it.
///
/// # Unsalted-KDF note (audit F-029)
///
/// SHA-256 is used directly over `domain || machine_id` with no salt.
/// This is acceptable here because the input is a hardware fingerprint,
/// not a user-chosen low-entropy secret: there is no offline-guessing
/// target, and domain separation (see the `*_DOMAIN` prefixes) prevents
/// cross-domain key reuse. The machine ID's entropy is not verified by
/// this crate — deployments should pass a UUID-grade fingerprint
/// (`kasirmu_hal` device id), not a guessable name.
fn derive_key(domain: &[u8], machine_id: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(domain);
    hasher.update(machine_id.as_bytes());
    let hash = hasher.finalize();
    let mut key = [0u8; 32];
    key.copy_from_slice(&hash);
    key
}

/// Derive the default static 256-bit key from a domain prefix (no
/// machine binding).
///
/// # Threat model (audit F-029)
///
/// This key is a public constant: anyone with the repo can derive it
/// and decrypt every portable at-rest value in any deployment's
/// database. It protects against opportunistic database inspection
/// only — it is obfuscation, NOT confidentiality. Deployments that
/// need real at-rest confidentiality set [`MASTER_KEY_ENV`] (`KASIRMU_MASTER_KEY`;
/// the legacy `OZ_MASTER_KEY` is still read) — see [`derive_portable_key`];
/// a keyring-backed master key was
/// deliberately NOT adopted because it would break the documented
/// cross-machine portability of these fields.
fn derive_static_key(domain: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(domain);
    let hash = hasher.finalize();
    let mut key = [0u8; 32];
    key.copy_from_slice(&hash);
    key
}

/// The preferred environment variable holding the at-rest master key.
///
/// `OZ_MASTER_KEY` ([`MASTER_KEY_ENV_LEGACY`]) is the pre-rebrand name and is
/// still read, because renaming it outright would orphan every credential
/// family derived from it; this name is preferred so a deployment can move over
/// before the alias is retired.
const MASTER_KEY_ENV: &str = "KASIRMU_MASTER_KEY";

/// The pre-rebrand alias of [`MASTER_KEY_ENV`], honoured while it is set.
const MASTER_KEY_ENV_LEGACY: &str = "OZ_MASTER_KEY";

/// Pick the master-key value, preferring the new name over the legacy alias.
///
/// Split out of [`master_key_from_env`] so the precedence is testable without
/// mutating the process environment, where a `set_var` would race every other
/// case in this binary that reads the key.
fn master_key_raw_from(preferred: Option<String>, legacy: Option<String>) -> Option<String> {
    preferred.or(legacy)
}

/// Read the optional at-rest master key (64 hex chars = 32 bytes).
///
/// Prefers [`MASTER_KEY_ENV`] and falls back to [`MASTER_KEY_ENV_LEGACY`], so an
/// install configured before the rename keeps decrypting. A malformed value is
/// treated as unset, exactly as before.
fn master_key_from_env() -> Option<[u8; 32]> {
    let raw = master_key_raw_from(
        std::env::var(MASTER_KEY_ENV).ok(),
        std::env::var(MASTER_KEY_ENV_LEGACY).ok(),
    )?;
    let decoded = hex::decode(raw.trim()).ok()?;
    decoded.try_into().ok()
}

/// HMAC-SHA256(master, domain) — the master-key portable derivation.
fn hmac_key(master: &[u8; 32], domain: &[u8]) -> [u8; 32] {
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(master)
        // INVARIANT: HMAC accepts keys of any length (RFC 2104), so deriving
        // from the 32-byte master key cannot fail.
        .expect("HMAC accepts any key length");
    mac.update(domain);
    mac.finalize().into_bytes().into()
}

/// Derive a portable at-rest key for `domain`.
///
/// Precedence is **install > master > legacy** (decision D1, answered
/// 2026-09-29):
///
/// 1. a per-install key installed into this process with [`set_install_key`] —
///    the real key once it exists, which is why it wins;
/// 2. otherwise the [`hmac_key`] derivation when a master key is set
///    (64 hex chars) — real at-rest confidentiality, at the cost of pinning the
///    deployment to that master key;
/// 3. otherwise the family's `legacy` derivation, so that values written before
///    either mechanism existed keep decrypting (legacy derivations are
///    deliberately kept byte-identical for backward compatibility).
///
/// With no install key installed this is exactly the pre-S2b-1 selection, so the
/// seam alone changes no ciphertext.
fn portable_key(domain: &[u8], legacy: impl FnOnce(&[u8]) -> [u8; 32]) -> [u8; 32] {
    let install = install_key_from_process();
    let master = master_key_from_env();
    portable_key_from(domain, install.as_ref(), master.as_ref(), legacy)
}

/// [`portable_key`]'s precedence with every key source injected.
///
/// Split out for the same reason [`master_key_raw_from`] and
/// [`decrypt_smtp_at_rest_under`] are: the install key lives in a process
/// global that cannot be un-set, so a test that installed one to observe the
/// precedence would race every other case in this binary. Injecting the
/// candidate sources makes the ordering observable without touching the global.
fn portable_key_from(
    domain: &[u8],
    install: Option<&[u8; 32]>,
    master: Option<&[u8; 32]>,
    legacy: impl FnOnce(&[u8]) -> [u8; 32],
) -> [u8; 32] {
    if let Some(secret) = install {
        return hmac_key(secret, domain);
    }
    match master {
        Some(m) => hmac_key(m, domain),
        None => legacy(domain),
    }
}

/// Whether [`portable_key`] is currently selecting the master-key HMAC
/// derivation, as a plain bool.
///
/// Returns `true` when a master key is set to a usable 32-byte value -
/// i.e. when the five portable credential families derive through [`hmac_key`]
/// instead of their byte-identical `legacy` fallback - and `false` when they
/// derive `legacy`. It reports **which derivation this process selected** and
/// nothing else: not whether the setting is correct, not whether the deployment is
/// secure, and never the key material.
///
/// Reads the same [`master_key_from_env`] the derivation itself reads, so the
/// answer cannot drift from the code path it describes: a set-but-malformed value
/// reports `false` here for exactly the reason it falls back in [`portable_key`].
///
/// # Why publishing presence is safe
///
/// The operator already controls whether the variable exists, so learning that it does
/// discloses nothing they do not know; omitting it is what leaves them unable to explain
/// why five credential families stopped decrypting.
pub fn master_key_derivation_active() -> bool {
    master_key_from_env().is_some()
}

/// [`portable_key`] with an injected master and NO install key (test seam).
///
/// The install-key arm is deliberately not reachable from here: this helper is
/// the pre-S2b-1 seam and every existing case that calls it is asserting the
/// master-vs-legacy selection. Use [`portable_key_from`] directly to observe the
/// install arm.
#[cfg(test)]
fn portable_key_with(
    domain: &[u8],
    master: &Option<[u8; 32]>,
    legacy: impl FnOnce(&[u8]) -> [u8; 32],
) -> [u8; 32] {
    portable_key_from(domain, None, master.as_ref(), legacy)
}

/// Every key a `domain` row may have been written under, in try order: the
/// per-install key when this process has one, then the family's `legacy`
/// derivation, then the master-key HMAC derivation when a master key decodes to
/// 32 bytes.
///
/// This is [`portable_key`] widened for READING only. Writes still call
/// [`portable_key`], so bytes written today are byte-identical; a reader that
/// finds a newly installed key can still open rows the legacy and master
/// branches wrote before it existed.
///
/// The install branch lands in the SAME slice as the [`portable_key`] arm
/// (hazard H1): a writer that used a derivation no reader tries would brick the
/// install immediately, on its own rows.
fn candidate_keys(domain: &[u8], legacy: impl Fn(&[u8]) -> [u8; 32]) -> Vec<[u8; 32]> {
    let install = install_key_from_process();
    let master = master_key_from_env();
    candidate_keys_from(domain, install.as_ref(), master.as_ref(), legacy)
}

/// [`candidate_keys`] with every key source injected. See that function for the
/// try order and why it is a read-only concern.
fn candidate_keys_from(
    domain: &[u8],
    install: Option<&[u8; 32]>,
    master: Option<&[u8; 32]>,
    legacy: impl Fn(&[u8]) -> [u8; 32],
) -> Vec<[u8; 32]> {
    let mut keys = Vec::with_capacity(3);
    // The install branch is tried FIRST: it is the newest derivation, so it is
    // the one a row written since the upgrade is most likely to be under. The
    // legacy-then-master tail keeps the order it had before this slice, so a
    // process with no install key produces a byte-identical list -- including
    // which error surfaces when every candidate fails. The plan that scoped this
    // slice wrote the order as "install -> master -> legacy"; the tail order is
    // preserved instead because AES-GCM's tag is the only oracle, so the order
    // decides nothing but the failure message, and preserving it is the strictly
    // smaller change.
    if let Some(secret) = install {
        keys.push(hmac_key(secret, domain));
    }
    keys.push(legacy(domain));
    if let Some(master) = master {
        keys.push(hmac_key(master, domain));
    }
    keys
}

/// Derive a portable at-rest key from a **per-install** secret rather than
/// from the environment or the public static constant.
///
/// # Status: the seam is live, the source is not (C1 slices S2a + S2b-1)
///
/// Nothing in production calls this directly yet — there is still no keychain
/// read, which is S2b-2. But as of S2b-1 the derivation is reachable through the
/// public path: [`set_install_key`] installs a secret into this process, and
/// [`portable_key`] and [`candidate_keys`] then select and try it. This function
/// stays the pure, stateless form of that derivation — what the tests drive, and
/// what S2c's re-encryption calls per row.
///
/// **S2b-2** resolves the secret from the OS keychain (entry
/// `oz-pos/at-rest-key.v1`) at boot and hands it to [`set_install_key`];
/// **S2c** (`oz rekey`) re-writes rows under a newly rotated secret.
///
/// # Why the derivation is separate from [`portable_key`]
///
/// [`portable_key`] is load-bearing for READING and its `legacy` arm must stay
/// byte-identical forever — existing rows decrypt through it. This function is a
/// third, additive derivation (public-constant legacy, `OZ_MASTER_KEY`,
/// per-install), and it is reached only through an *installed* key, so a process
/// that installs none derives exactly as it did before this seam existed.
///
/// # Threat model
///
/// This is the first derivation in the crate that is **not** a public
/// constant. Confidentiality therefore rests entirely on `install_secret`
/// being high-entropy and stored outside the repository — it is the
/// installer's job to guarantee that, and this function does not verify it.
/// The derivation is plain HMAC-SHA256 domain separation, matching
/// [`hmac_key`], so a row written under a per-install key is a different
/// ciphertext from one written under the master key even for the same domain.
///
/// # Wiring an install onto this derivation is NOT a one-line change
///
/// Switching a live deployment to a per-install key orphans every row written
/// under the previous derivation unless the reader is branch-tolerant for the
/// new candidate too — the same prerequisite (D1) that gated S2b, and which the
/// branch-tolerant reader satisfied before S2b-1 landed. The remaining ordering
/// rule is the other half: the candidate branch and the write arm ship together
/// (they did, in S2b-1), and a boot path must never install a key it cannot
/// re-read on the next boot (hazard H3 — see [`set_install_key`]).
#[must_use]
pub fn install_key(domain: &[u8], install_secret: &[u8; 32]) -> [u8; 32] {
    hmac_key(install_secret, domain)
}

/// The process-wide per-install at-rest key, installed once at boot.
///
/// C1 slice S2b-1. A `OnceLock` rather than a parameter threaded through the
/// derivation: the six decrypt functions are called from `platform/core`, the
/// bridge and both shells at points far from any boot closure, so threading a
/// key would touch every caller and every test. A process global set once is the
/// smaller, safer change.
///
/// It is deliberately **optional**. A process that never installs a key behaves
/// exactly as it did before this seam existed — hazard H2, where a missing key
/// must degrade to today's derivation rather than become an error.
static INSTALL_KEY: OnceLock<[u8; 32]> = OnceLock::new();

/// Install the process-wide per-install key. Idempotent; the first call wins.
///
/// Returns `true` when this call installed the key, `false` when one was already
/// present. The key is never logged, printed or returned.
///
/// **A `false` is not a failure.** It means another boot path already resolved
/// the same key, which is the expected outcome when more than one place installs
/// it. Boot code should treat both answers as success and must never treat a
/// missing keychain entry as an error (hazard H2).
///
/// # The caller must guarantee the key is durable (hazard H3)
///
/// This function cannot tell where the secret came from, so it cannot refuse a
/// key read from an in-memory keyring that starts empty on every boot. Installing
/// one of those orphans every row written under it. S2b-2's boot path is
/// responsible for detecting the in-memory fallback and **refusing to generate**
/// a key there — the decision recorded for D1 on 2026-09-29.
pub fn set_install_key(secret: [u8; 32]) -> bool {
    INSTALL_KEY.set(secret).is_ok()
}

/// The per-install key installed into this process, if any.
fn install_key_from_process() -> Option<[u8; 32]> {
    INSTALL_KEY.get().copied()
}

/// Whether a per-install key derivation is active **in this process**, as a plain
/// bool.
///
/// Returns `true` exactly when [`set_install_key`] has installed a key, i.e. when
/// that key is the derivation [`portable_key`] selects and the first candidate
/// [`candidate_keys`] tries. It reports **which derivation this process selected**
/// and nothing else: not whether a keychain source exists, not whether a
/// deployment is correctly configured, and never any key material — the same
/// reasoning [`master_key_derivation_active`] records for itself.
///
/// It reads the same [`install_key_from_process`] the derivations read, so the
/// answer cannot drift from the code path it describes.
///
/// Before S2b-2 wires a keychain read at boot this returns `false` everywhere,
/// which is the pre-seam behaviour rather than an error.
#[must_use]
pub fn install_key_derivation_active() -> bool {
    install_key_from_process().is_some()
}

/// Internal: decrypt with the first candidate key that authenticates.
///
/// AES-GCM tag verification is the only oracle: a key that did not write the
/// row fails it, and the wrong-key acceptance probability is negligible - so
/// no marker column, version byte or salt row is needed. The error returned
/// is the last candidate's, which names no key and no domain.
fn decrypt_with_candidates(encrypted_b64: &str, keys: &[[u8; 32]]) -> Result<String, CryptoError> {
    let mut last_err = CryptoError::Internal("no candidate decryption key".into());
    for key in keys {
        match decrypt(encrypted_b64, key) {
            Ok(plaintext) => return Ok(plaintext),
            Err(e) => last_err = e,
        }
    }
    Err(last_err)
}

// ── Domain-separation prefixes ───────────────────────────────────────

/// SMTP password domain-separation prefix.
const SMTP_DOMAIN: &[u8] = b"oz-pos.smtp-password.v1:";

/// API key domain-separation prefix.
const API_KEY_DOMAIN: &[u8] = b"oz-pos.api-key.v1:";

/// Sync API key domain-separation prefix.
const SYNC_API_KEY_DOMAIN: &[u8] = b"oz-pos.sync-api-key.v1:";

/// Sync terminal secret domain-separation prefix.
const SYNC_TERMINAL_SECRET_DOMAIN: &[u8] = b"oz-pos.sync-terminal-secret.v1:";

/// PG sync password domain-separation prefix.
const PG_SYNC_PASSWORD_DOMAIN: &[u8] = b"oz-pos.pg-sync-password.v1:";

/// Rate sync API key domain-separation prefix.
const RATE_API_KEY_DOMAIN: &[u8] = b"oz-pos.rate-api-key.v1:";

/// LAN server PSK domain-separation prefix.
const LAN_PSK_DOMAIN: &[u8] = b"oz-pos.lan-psk.v1:";

/// SMTP at-rest domain-separation prefix.
const SMTP_AT_REST_DOMAIN: &[u8] = b"oz-pos.smtp-at-rest.v1:";

/// User-profile at-rest domain-separation prefix.
const PROFILE_AT_REST_DOMAIN: &[u8] = b"oz-pos.user-profile-at-rest.v1:";

// ── Machine-bound (API key / SMTP password) ──────────────────────────

/// Encrypt an API key with a machine-bound key.
pub fn encrypt_api_key(plaintext: &str, machine_id: &str) -> Result<String, CryptoError> {
    let key = derive_key(API_KEY_DOMAIN, machine_id);
    encrypt(plaintext, &key)
}

/// Decrypt an API key previously produced by [`encrypt_api_key`].
pub fn decrypt_api_key(encrypted_b64: &str, machine_id: &str) -> Result<String, CryptoError> {
    let key = derive_key(API_KEY_DOMAIN, machine_id);
    decrypt(encrypted_b64, &key)
}

/// Encrypt an SMTP password with a machine-bound key.
pub fn encrypt_smtp_password(plaintext: &str, machine_id: &str) -> Result<String, CryptoError> {
    let key = derive_key(SMTP_DOMAIN, machine_id);
    encrypt(plaintext, &key)
}

/// Decrypt an SMTP password previously encrypted with [`encrypt_smtp_password`].
///
/// Legacy passthrough is format-gated (see [`decrypt_smtp_at_rest`]):
/// values that are not valid ciphertext-formatted base64 pass through
/// unchanged; well-formed values that fail authentication are tampering
/// and surface as an error.
pub fn decrypt_smtp_password(encrypted_b64: &str, machine_id: &str) -> Result<String, CryptoError> {
    let key = derive_key(SMTP_DOMAIN, machine_id);
    match decrypt(encrypted_b64, &key) {
        Ok(plaintext) => Ok(plaintext),
        Err(_) if !looks_like_ciphertext(encrypted_b64) => Ok(encrypted_b64.to_string()),
        Err(e) => Err(e),
    }
}

// ── Static-key (portable across machines) ────────────────────────────

/// Encrypt an SMTP password for at-rest storage using a portable key.
///
/// Unlike [`encrypt_smtp_password`], this does NOT bind to the machine
/// fingerprint — the database can be copied between machines without
/// losing access to the SMTP password.
///
/// # Fails closed (audit F-029)
///
/// Returns the error on encryption failure instead of the plaintext —
/// the old `unwrap_or_else(|_| password.to_string())` fallback would
/// have stored an UNENCRYPTED password that every reader treats as
/// ciphertext.
pub fn encrypt_smtp_at_rest(password: &str) -> Result<String, CryptoError> {
    let key = portable_key(SMTP_AT_REST_DOMAIN, derive_static_key);
    encrypt(password, &key)
}

/// Decrypt an SMTP password stored with [`encrypt_smtp_at_rest`].
///
/// Legacy passthrough is now format-gated (audit F-029): values that
/// are not valid base64 or shorter than our nonce+tag minimum are
/// treated as legacy plaintext and returned unchanged; values in our
/// ciphertext format that FAIL decryption are tampering, not legacy,
/// and return an error instead of silently handing back ciphertext.
pub fn decrypt_smtp_at_rest(encrypted: &str) -> Result<String, CryptoError> {
    decrypt_smtp_at_rest_under(
        encrypted,
        &candidate_keys(SMTP_AT_REST_DOMAIN, derive_static_key),
    )
}

/// [`decrypt_smtp_at_rest`] with its candidate key list injected.
///
/// Split out so a test can drive the PRODUCTION read with an explicit key list.
/// The alternative -- setting `OZ_MASTER_KEY` and calling the public function --
/// would race every other case in the binary that reads the same variable, which
/// is the reason the sibling `decrypt_with_candidates` case takes this shape too.
///
/// The legacy arm is preserved exactly: a value that is not in our ciphertext
/// format is returned unchanged, while one that IS and fails every candidate is
/// tampering and errors. On the candidate path "fails" now means "fails under
/// every key", which is what makes the master branch able to open a row the
/// legacy branch wrote -- and vice versa.
fn decrypt_smtp_at_rest_under(encrypted: &str, keys: &[[u8; 32]]) -> Result<String, CryptoError> {
    match decrypt_with_candidates(encrypted, keys) {
        Ok(plaintext) => Ok(plaintext),
        Err(_) if !looks_like_ciphertext(encrypted) => Ok(encrypted.to_string()),
        Err(e) => Err(e),
    }
}

/// Encrypt a sync API key for at-rest storage (static key, portable).
pub fn encrypt_sync_api_key(plaintext: &str) -> Result<String, CryptoError> {
    let key = portable_key(SYNC_API_KEY_DOMAIN, |d| derive_key(d, "static"));
    encrypt(plaintext, &key)
}

/// Decrypt a sync API key previously encrypted with [`encrypt_sync_api_key`].
pub fn decrypt_sync_api_key(encrypted_b64: &str) -> Result<String, CryptoError> {
    decrypt_with_candidates(
        encrypted_b64,
        &candidate_keys(SYNC_API_KEY_DOMAIN, |d| derive_key(d, "static")),
    )
}

/// Encrypt a sync terminal secret for at-rest storage (static key, portable).
pub fn encrypt_sync_terminal_secret(plaintext: &str) -> Result<String, CryptoError> {
    let key = portable_key(SYNC_TERMINAL_SECRET_DOMAIN, |d| derive_key(d, "static"));
    encrypt(plaintext, &key)
}

/// Decrypt a sync terminal secret previously encrypted with [`encrypt_sync_terminal_secret`].
pub fn decrypt_sync_terminal_secret(encrypted_b64: &str) -> Result<String, CryptoError> {
    decrypt_with_candidates(
        encrypted_b64,
        &candidate_keys(SYNC_TERMINAL_SECRET_DOMAIN, |d| derive_key(d, "static")),
    )
}

/// Encrypt a PG sync password for at-rest storage (static key, portable).
pub fn encrypt_pg_sync_password(plaintext: &str) -> Result<String, CryptoError> {
    let key = portable_key(PG_SYNC_PASSWORD_DOMAIN, |d| derive_key(d, "static"));
    encrypt(plaintext, &key)
}

/// Decrypt a PG sync password previously encrypted with [`encrypt_pg_sync_password`].
pub fn decrypt_pg_sync_password(encrypted_b64: &str) -> Result<String, CryptoError> {
    decrypt_with_candidates(
        encrypted_b64,
        &candidate_keys(PG_SYNC_PASSWORD_DOMAIN, |d| derive_key(d, "static")),
    )
}

/// Encrypt a rate sync API key for at-rest storage (static key, portable).
pub fn encrypt_rate_api_key(plaintext: &str) -> Result<String, CryptoError> {
    let key = portable_key(RATE_API_KEY_DOMAIN, |d| derive_key(d, "static"));
    encrypt(plaintext, &key)
}

/// Decrypt a rate sync API key previously encrypted with [`encrypt_rate_api_key`].
pub fn decrypt_rate_api_key(encrypted_b64: &str) -> Result<String, CryptoError> {
    decrypt_with_candidates(
        encrypted_b64,
        &candidate_keys(RATE_API_KEY_DOMAIN, |d| derive_key(d, "static")),
    )
}

/// Encrypt a LAN server PSK for at-rest storage (static key, portable).
pub fn encrypt_lan_psk(plaintext: &str) -> Result<String, CryptoError> {
    let key = portable_key(LAN_PSK_DOMAIN, |d| derive_key(d, "static"));
    encrypt(plaintext, &key)
}

/// Decrypt a LAN server PSK previously encrypted with [`encrypt_lan_psk`].
pub fn decrypt_lan_psk(encrypted_b64: &str) -> Result<String, CryptoError> {
    decrypt_with_candidates(
        encrypted_b64,
        &candidate_keys(LAN_PSK_DOMAIN, |d| derive_key(d, "static")),
    )
}

/// Encrypt a user-profile sensitive field for at-rest storage (static key).
pub fn encrypt_profile_field(plaintext: &str) -> Result<String, CryptoError> {
    let key = portable_key(PROFILE_AT_REST_DOMAIN, derive_static_key);
    encrypt(plaintext, &key)
}

/// Decrypt a user-profile sensitive field previously encrypted with
/// [`encrypt_profile_field`].
///
/// Fails closed: corrupted, truncated, or cross-domain ciphertext returns
/// an error — never plaintext.
pub fn decrypt_profile_field(encrypted_b64: &str) -> Result<String, CryptoError> {
    decrypt_with_candidates(
        encrypted_b64,
        &candidate_keys(PROFILE_AT_REST_DOMAIN, derive_static_key),
    )
}

// ── Internal encrypt / decrypt ───────────────────────────────────────

/// Whether `value` has the shape of this crate's ciphertext
/// (`base64(nonce || ciphertext || tag)`, i.e. decodable base64 of at
/// least 12 nonce + 16 tag bytes).
///
/// Used by the legacy-passthrough decrypt paths to distinguish "this
/// value was never encrypted" (legacy plaintext, pass through) from
/// "this value is our format but failed authentication" (tampering,
/// error out).
fn looks_like_ciphertext(value: &str) -> bool {
    match base64_decode(value) {
        Ok(bytes) => bytes.len() >= 12 + 16,
        Err(_) => false,
    }
}

/// Internal: encrypt plaintext with a pre-derived key.
fn encrypt(plaintext: &str, key: &[u8; 32]) -> Result<String, CryptoError> {
    let cipher = Aes256Gcm::new(GenericArray::from_slice(key));

    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = GenericArray::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| CryptoError::Internal(format!("encryption failed: {e}")))?;

    // Format: nonce (12) + ciphertext+tag (variable)
    let mut combined = Vec::with_capacity(12 + ciphertext.len());
    combined.extend_from_slice(&nonce_bytes);
    combined.extend_from_slice(&ciphertext);

    Ok(base64_encode(&combined))
}

/// Internal: decrypt a base64-encoded ciphertext with a pre-derived key.
fn decrypt(encrypted_b64: &str, key: &[u8; 32]) -> Result<String, CryptoError> {
    let cipher = Aes256Gcm::new(GenericArray::from_slice(key));

    let combined = base64_decode(encrypted_b64)?;

    if combined.len() < 12 + 16 {
        return Err(CryptoError::Internal(
            "encrypted data too short: corrupted or tampered".into(),
        ));
    }

    let nonce = GenericArray::from_slice(&combined[..12]);
    let ciphertext = &combined[12..];

    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| CryptoError::Internal(format!("decryption failed: {e}")))?;

    String::from_utf8(plaintext)
        .map_err(|e| CryptoError::Internal(format!("decrypted data is not valid UTF-8: {e}")))
}

// ── Base64 helpers ───────────────────────────────────────────────────

/// Encode bytes as URL-safe base64 (no padding).
fn base64_encode(data: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(data)
}

/// Decode URL-safe base64 (with or without padding).
fn base64_decode(encoded: &str) -> Result<Vec<u8>, CryptoError> {
    use base64::Engine;
    base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(encoded)
        .or_else(|_| base64::engine::general_purpose::URL_SAFE.decode(encoded))
        .or_else(|_| base64::engine::general_purpose::STANDARD_NO_PAD.decode(encoded))
        .or_else(|_| base64::engine::general_purpose::STANDARD.decode(encoded))
        .map_err(|e| CryptoError::Internal(format!("failed to decode base64 ciphertext: {e}")))
}

#[cfg(test)]
#[path = "lib_tests.rs"]
mod tests;
