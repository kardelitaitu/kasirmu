/*
last audited 25-07-26 by RSA-Agent
crate: oz-security | status: SAFE | lint: CLEAN
findings: 4 variants, non_exhaustive, stable Display; SEC-7: DecryptionFailed unused in-crate (no decrypt path here) — verify consumer mapping during oz-core pass
next: none | perf: N/A
*/
//! Error type for `oz-security`.

use thiserror::Error;

/// Errors that can originate in the security subsystem.
#[derive(Debug, Error)]
#[non_exhaustive]
pub enum SecurityError {
    /// A key-encryption-key (KEK) was missing or inaccessible.
    #[error("key unavailable: {0}")]
    KeyUnavailable(String),

    /// A secret's ciphertext failed authentication on decrypt.
    #[error("decryption failed: ciphertext is corrupt or has been tampered with")]
    DecryptionFailed,

    /// The caller does not have the required permission.
    #[error("permission denied: {0}")]
    PermissionDenied(String),

    /// Cryptographic key generation failed.
    #[error("key generation failed: {0}")]
    KeyGenerationFailed(String),
}

#[cfg(test)]
#[path = "error_tests.rs"]
mod tests;
