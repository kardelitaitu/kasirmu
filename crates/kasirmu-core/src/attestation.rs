//! Server origin attestation (ADR #55).
//!
//! A client about to send a bearer credential — the tenant api_key, a sync token,
//! a terminal device secret — to a *candidate* origin first asks that origin to
//! prove it holds the license keypair. A hijacked or lapsed fallback domain cannot
//! sign, so the credential is never offered to it.
//!
//! The wire contract is fixed by apps/license-server/attest.go and must match it
//! byte for byte: POST to the attest path with a nonce, answering a signature that
//! is RSA-2048 PKCS1v15/SHA-256 over the namespaced payload below.
//!
//! Verification deliberately does NOT honour the BOOTSTRAP_FREE sentinel that
//! verify_license_signature accepts in debug builds: attestation is the check that
//! decides whether a credential may leave, so there is no debug shortcut.

use std::sync::OnceLock;
use std::time::Duration;

use base64::Engine;
use rsa::RsaPublicKey;
use rsa::pkcs1v15::VerifyingKey;
use rsa::signature::Verifier;
use serde::Deserialize;
use sha2::Sha256;

use crate::error::CoreError;
use crate::server_origin::{OriginSource, ResolvedServerOrigin, release_ladder};

/// Path of the attestation endpoint on any candidate origin.
pub const ATTEST_PATH: &str = "/api/v1/license/attest";

/// Payload prefix. Mirrors attestPayloadPrefix in apps/license-server/attest.go;
/// a mismatch here is a client that can never attest a legitimate origin.
pub const ATTEST_PAYLOAD_PREFIX: &str = "ozpos-origin-attest-v1:";

/// Lower nonce bound, mirroring attestNonceMin on the server.
pub const ATTEST_NONCE_MIN: usize = 16;

/// Upper nonce bound, mirroring attestNonceMax on the server.
pub const ATTEST_NONCE_MAX: usize = 64;

/// Per-candidate probe budget. Short: attestation happens at boot, and a long
/// hang on a dead candidate would delay every start.
const ATTEST_TIMEOUT: Duration = Duration::from_secs(5);

/// The origin that won an attestation, cached for the process lifetime.
///
/// The cascade resolves once at boot and pins the winner: the sync dataset
/// belongs to an origin, so flipping mid-session would write to two backends.
static ATTESTED_ORIGIN: OnceLock<ResolvedServerOrigin> = OnceLock::new();

/// The canonical payload for a nonce.
pub fn attestation_payload(nonce: &str) -> String {
    format!("{ATTEST_PAYLOAD_PREFIX}{nonce}")
}

/// Whether a nonce is within bounds and uses only [A-Za-z0-9_-].
pub fn validate_nonce(nonce: &str) -> bool {
    if nonce.len() < ATTEST_NONCE_MIN || nonce.len() > ATTEST_NONCE_MAX {
        return false;
    }
    nonce
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// Generate a fresh nonce: a UUIDv4 rendered as 32 hex characters.
pub fn generate_nonce() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

/// Verify an attestation signature against a supplied public key PEM.
///
/// Takes the key as a parameter rather than reading the embedded one so tests can
/// drive it with a generated keypair; attest_origin supplies
/// LICENSE_PUBLIC_KEY_PEM in production.
pub fn verify_attestation_signature(
    public_pem: &str,
    nonce: &str,
    signature_base64: &str,
) -> Result<(), CoreError> {
    use rsa::pkcs8::DecodePublicKey;

    // No BOOTSTRAP_FREE short-circuit: accepting that sentinel here would make
    // every candidate origin attestable in a debug build.
    let public_key = RsaPublicKey::from_public_key_pem(public_pem).map_err(|e| {
        CoreError::InvalidSubscriptionSignature(format!("attestation public key: {e}"))
    })?;
    let sig_bytes = base64::engine::general_purpose::STANDARD
        .decode(signature_base64)
        .map_err(|e| {
            CoreError::InvalidSubscriptionSignature(format!("attestation signature is not base64: {e}"))
        })?;
    let signature = rsa::pkcs1v15::Signature::try_from(sig_bytes.as_slice()).map_err(|e| {
        CoreError::InvalidSubscriptionSignature(format!("invalid attestation signature format: {e}"))
    })?;
    let verifying_key = VerifyingKey::<Sha256>::new(public_key);
    verifying_key
        .verify(attestation_payload(nonce).as_bytes(), &signature)
        .map_err(|_| {
            CoreError::InvalidSubscriptionSignature("attestation signature did not verify".to_string())
        })
}

/// The tier label for a compiled origin.
pub fn source_for(origin: &str) -> Option<OriginSource> {
    let [main, fallback] = release_ladder();
    if origin == main {
        Some(OriginSource::Main)
    } else if origin == fallback {
        Some(OriginSource::Fallback)
    } else {
        None
    }
}

/// Ask one origin to attest a nonce, verifying the answer against a key.
///
/// Feature-gated to match the convention the rest of this crate follows for HTTP
/// paths. Note that `--no-default-features` does NOT currently build for this crate
/// (`license_verification.rs` and `sync_auth.rs` use reqwest ungated) — the attribute
/// keeps this module consistent rather than claiming a configuration that works.
#[cfg(feature = "sync-http")]
pub async fn attest_origin_with(
    origin: &str,
    nonce: &str,
    public_pem: &str,
) -> Result<(), CoreError> {
    #[derive(Deserialize)]
    struct AttestResponse {
        nonce: String,
        signature: String,
    }

    let url = format!("{}{ATTEST_PATH}", origin.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(ATTEST_TIMEOUT)
        .build()
        .map_err(|e| CoreError::Internal(format!("attestation client: {e}")))?;
    let response = client
        .post(&url)
        .json(&serde_json::json!({ "nonce": nonce }))
        .send()
        .await
        .map_err(|e| CoreError::Internal(format!("attestation request to {origin} failed: {e}")))?;
    if !response.status().is_success() {
        return Err(CoreError::Internal(format!(
            "attestation endpoint at {origin} answered {}",
            response.status()
        )));
    }
    let body: AttestResponse = response
        .json()
        .await
        .map_err(|e| CoreError::Internal(format!("attestation response from {origin}: {e}")))?;
    // The echoed nonce must be the one we sent, or the signature is over a
    // payload we never asked for.
    if body.nonce != nonce {
        return Err(CoreError::InvalidSubscriptionSignature(
            "attestation echoed a different nonce".to_string(),
        ));
    }
    verify_attestation_signature(public_pem, nonce, &body.signature)
}

/// Ask one origin to attest a nonce, verifying against the embedded key.
#[cfg(feature = "sync-http")]
pub async fn attest_origin(origin: &str, nonce: &str) -> Result<(), CoreError> {
    attest_origin_with(origin, nonce, crate::license_verification::LICENSE_PUBLIC_KEY_PEM).await
}

/// The cached attested origin, when the cascade has already resolved one.
pub fn cached_origin() -> Option<ResolvedServerOrigin> {
    ATTESTED_ORIGIN.get().cloned()
}

/// Pin an origin as the attested winner. The first writer wins for the process.
pub fn cache_origin(origin: ResolvedServerOrigin) -> bool {
    ATTESTED_ORIGIN.set(origin).is_ok()
}

/// The origin the app will use, together with the tier that won.
///
/// This is the single implementation of ADR #55's precedence — environment
/// override, then an origin the boot-time cascade already attested, then the
/// canonical compiled origin — so the credential path and the settings surface
/// report the same value instead of each deriving their own. The attested tier is
/// only ever populated by a successful attestation.
pub fn resolved_origin() -> ResolvedServerOrigin {
    crate::server_origin::resolve_origin(
        std::env::var(crate::server_origin::ORIGIN_ENV_OVERRIDE).ok(),
        cached_origin().map(|origin| origin.url),
    )
}

/// Resolve the origin to use by walking the compiled ladder, canonical first.
///
/// A candidate is accepted only when it *attests*; a transport failure or a bad
/// signature simply moves to the next entry. Callers invoke this once at boot,
/// before any credential is sent, and must not re-run it mid-session.
#[cfg(feature = "sync-http")]
pub async fn resolve_attested_origin(nonce: &str) -> Option<ResolvedServerOrigin> {
    for origin in release_ladder() {
        if attest_origin(origin, nonce).await.is_ok() {
            let resolved = ResolvedServerOrigin {
                url: origin.to_string(),
                source: source_for(origin).unwrap_or(OriginSource::Main),
            };
            cache_origin(resolved.clone());
            return Some(resolved);
        }
    }
    None
}

#[cfg(test)]
#[path = "attestation_tests.rs"]
mod tests;
