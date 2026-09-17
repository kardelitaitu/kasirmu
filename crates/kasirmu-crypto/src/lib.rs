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

use aes_gcm::{Aes256Gcm, KeyInit, aead::Aead, aead::generic_array::GenericArray};
use hmac::{Hmac, Mac};
use rand::RngCore;
use sha2::{Digest, Sha256};

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
/// need real at-rest confidentiality set `OZ_MASTER_KEY` (see
/// [`derive_portable_key`]); a keyring-backed master key was
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

/// Read the optional `OZ_MASTER_KEY` override (64 hex chars = 32 bytes).
fn master_key_from_env() -> Option<[u8; 32]> {
    let raw = std::env::var("OZ_MASTER_KEY").ok()?;
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
/// With `OZ_MASTER_KEY` set (64 hex chars), the key is [`hmac_key`]
/// derived — real at-rest confidentiality, at the cost of pinning the
/// deployment to that master key. Without it, the family's `legacy`
/// derivation runs so that values written before this mechanism
/// existed keep decrypting (legacy derivations are deliberately kept
/// byte-identical for backward compatibility).
fn portable_key(domain: &[u8], legacy: impl FnOnce(&[u8]) -> [u8; 32]) -> [u8; 32] {
    match master_key_from_env() {
        Some(m) => hmac_key(&m, domain),
        None => legacy(domain),
    }
}

/// Whether [`portable_key`] is currently selecting the master-key HMAC
/// derivation, as a plain bool.
///
/// Returns `true` when `OZ_MASTER_KEY` is set to a usable 32-byte value -
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

/// [`portable_key`] with an injected master (test seam).
#[cfg(test)]
fn portable_key_with(
    domain: &[u8],
    master: &Option<[u8; 32]>,
    legacy: impl FnOnce(&[u8]) -> [u8; 32],
) -> [u8; 32] {
    match master {
        Some(m) => hmac_key(m, domain),
        None => legacy(domain),
    }
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
    let key = portable_key(SMTP_AT_REST_DOMAIN, derive_static_key);
    match decrypt(encrypted, &key) {
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
    let key = portable_key(SYNC_API_KEY_DOMAIN, |d| derive_key(d, "static"));
    decrypt(encrypted_b64, &key)
}

/// Encrypt a sync terminal secret for at-rest storage (static key, portable).
pub fn encrypt_sync_terminal_secret(plaintext: &str) -> Result<String, CryptoError> {
    let key = portable_key(SYNC_TERMINAL_SECRET_DOMAIN, |d| derive_key(d, "static"));
    encrypt(plaintext, &key)
}

/// Decrypt a sync terminal secret previously encrypted with [`encrypt_sync_terminal_secret`].
pub fn decrypt_sync_terminal_secret(encrypted_b64: &str) -> Result<String, CryptoError> {
    let key = portable_key(SYNC_TERMINAL_SECRET_DOMAIN, |d| derive_key(d, "static"));
    decrypt(encrypted_b64, &key)
}

/// Encrypt a PG sync password for at-rest storage (static key, portable).
pub fn encrypt_pg_sync_password(plaintext: &str) -> Result<String, CryptoError> {
    let key = portable_key(PG_SYNC_PASSWORD_DOMAIN, |d| derive_key(d, "static"));
    encrypt(plaintext, &key)
}

/// Decrypt a PG sync password previously encrypted with [`encrypt_pg_sync_password`].
pub fn decrypt_pg_sync_password(encrypted_b64: &str) -> Result<String, CryptoError> {
    let key = portable_key(PG_SYNC_PASSWORD_DOMAIN, |d| derive_key(d, "static"));
    decrypt(encrypted_b64, &key)
}

/// Encrypt a rate sync API key for at-rest storage (static key, portable).
pub fn encrypt_rate_api_key(plaintext: &str) -> Result<String, CryptoError> {
    let key = portable_key(RATE_API_KEY_DOMAIN, |d| derive_key(d, "static"));
    encrypt(plaintext, &key)
}

/// Decrypt a rate sync API key previously encrypted with [`encrypt_rate_api_key`].
pub fn decrypt_rate_api_key(encrypted_b64: &str) -> Result<String, CryptoError> {
    let key = portable_key(RATE_API_KEY_DOMAIN, |d| derive_key(d, "static"));
    decrypt(encrypted_b64, &key)
}

/// Encrypt a LAN server PSK for at-rest storage (static key, portable).
pub fn encrypt_lan_psk(plaintext: &str) -> Result<String, CryptoError> {
    let key = portable_key(LAN_PSK_DOMAIN, |d| derive_key(d, "static"));
    encrypt(plaintext, &key)
}

/// Decrypt a LAN server PSK previously encrypted with [`encrypt_lan_psk`].
pub fn decrypt_lan_psk(encrypted_b64: &str) -> Result<String, CryptoError> {
    let key = portable_key(LAN_PSK_DOMAIN, |d| derive_key(d, "static"));
    decrypt(encrypted_b64, &key)
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
    let key = portable_key(PROFILE_AT_REST_DOMAIN, derive_static_key);
    decrypt(encrypted_b64, &key)
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
