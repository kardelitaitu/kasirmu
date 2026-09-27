//! Licence revocation: the CRL payload, its verification, and the revocation cache.
//!
//! Split out of `license_verification.rs` on 2026-09-28. A revoked licence must stop
//! working even when the machine is OFFLINE, so the CRL is shipped as a SIGNED
//! payload that is verified with the same RSA public key as the subscription
//! itself - never with a key carried in the response it is verifying.
//!
//! Invariant: revocation is checked against the CACHED CRL as well as a fresh one,
//! and absence of an entry means NOT revoked (fail-open on the list, fail-closed
//! on the signature). The signature check is the trust boundary; the cache is
//! only a transport optimisation.

// `base64::Engine` is the TRAIT providing `.decode()`; importing only the value
// types gives `E0599: no method named 'decode'`.
use base64::Engine;
use rsa::RsaPublicKey;
use rsa::pkcs1v15::VerifyingKey;

use rsa::signature::Verifier;
use serde::{Deserialize, Serialize};
use sha2::Sha256;

use crate::error::CoreError;

use super::{LICENSE_PUBLIC_KEY_PEM, license_server_url, refresh_subscription_status_from_server};

// ── Certificate / Licence Revocation List (CRL) ───────────────────────

/// An entry in the Certificate/Licence Revocation List (ADR #58 §2.1/§2.2).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CrlEntry {
    /// The license key in cleartext.
    pub key: String,
    /// SHA-256 hex digest of the key.
    pub key_hash: String,
    /// Tenant ID associated with the key if known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tenant_id: Option<String>,
    /// RFC 3339 timestamp when the key was revoked.
    pub revoked_at: String,
    /// Reason or notes associated with the revocation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// The cryptographically signed CRL payload issued by the license server.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CrlPayload {
    /// Issuer identifier (e.g. "kasir.mu").
    pub issuer: String,
    /// RFC 3339 timestamp when this CRL was minted.
    pub issued_at: String,
    /// List of revoked license key entries.
    #[serde(default)]
    pub entries: Vec<CrlEntry>,
    /// List of revoked tenant IDs.
    #[serde(default)]
    pub revoked_tenants: Vec<String>,
    /// List of revoked machine IDs.
    #[serde(default)]
    pub revoked_devices: Vec<String>,
}

/// Response returned by GET /api/v1/license/crl.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CrlResponse {
    /// Canonical JSON string of CrlPayload.
    pub payload: String,
    /// Base64 RSA-2048 PKCS1v15 SHA-256 signature over payload.
    pub signature: String,
}

// ── Signature Verification ──────────────────────────────────────────

/// Verify an RSA-2048 PKCS1v15 SHA-256 signature over a payload.
///
/// This is the core verification function used by the POS to validate
/// signed subscriptions from the license server.
///
/// # Arguments
/// * `payload` - The JSON payload that was signed.
/// * `signature_base64` - The base64-encoded RSA signature.
///
/// # Returns
/// `Ok(())` if the signature is valid, or `Err(CoreError::InvalidSubscriptionSignature)`.
pub fn verify_license_signature(payload: &str, signature_base64: &str) -> Result<(), CoreError> {
    // BOOTSTRAP_FREE is a sentinel for single-store deployments without a license server. It is seeded by
    // the INITIAL SCHEMA, not by a later migration: crates/kasirmu-core/migrations/20260813_init.sql:1514, whose
    // generated PostgreSQL twin repeats it at 20260813_init.pg.sql:2101 — edit the .sql and re-run
    // python3 scripts/generate-pg-migration.py; never hand-edit the .pg.sql. (The "(from migration 061)"
    // note above the seed, and the older copy of this comment, cite a pre-squash number: no file numbered 061
    // exists in crates/kasirmu-core/migrations.)
    //
    // This short-circuit is the DEBUG one, and it accepts the sentinel for any payload. The profile that
    // matters is release, and release no longer reaches this function carrying a sentinel: the policy now
    // lives in `TenantSubscription::verify_signature` (subscription.rs), which honours the sentinel in EVERY
    // profile but only for a Free-tier row. A sentinel-signed row claiming a paid tier therefore still falls
    // through to the base64 decode below and is rejected as an invalid symbol 95 at offset 9 — the '_' of
    // BOOTSTRAP_FREE — surfacing as CoreError::InvalidSubscriptionSignature. Callers that hold nothing but a
    // payload and a signature string (this module's own tests) keep the permissive debug behaviour.
    #[cfg(debug_assertions)]
    if signature_base64 == "BOOTSTRAP_FREE" {
        return Ok(());
    }

    let public_key = load_public_key()?;

    let sig_bytes = base64::engine::general_purpose::STANDARD
        .decode(signature_base64)
        .map_err(|e| {
            CoreError::InvalidSubscriptionSignature(format!(
                "failed to decode base64 signature: {e}"
            ))
        })?;

    let signature = rsa::pkcs1v15::Signature::try_from(sig_bytes.as_slice()).map_err(|e| {
        CoreError::InvalidSubscriptionSignature(format!("invalid RSA signature format: {e}"))
    })?;

    // Use VerifyingKey which handles SHA-256 hashing internally (matching SigningKey).
    let verifying_key = VerifyingKey::<Sha256>::new(public_key);
    verifying_key
        .verify(payload.as_bytes(), &signature)
        .map_err(|e| {
            CoreError::InvalidSubscriptionSignature(format!(
                "RSA signature verification failed: {e}"
            ))
        })?;

    Ok(())
}

/// Load the RSA-2048 public key from the embedded PEM.
fn load_public_key() -> Result<RsaPublicKey, CoreError> {
    use rsa::pkcs8::DecodePublicKey;

    RsaPublicKey::from_public_key_pem(LICENSE_PUBLIC_KEY_PEM).map_err(|e| {
        CoreError::InvalidSubscriptionSignature(format!("failed to load embedded public key: {e}"))
    })
}

/// Verify an RSA-2048 PKCS1v15 SHA-256 signature over a CRL payload using the embedded public key.
///
/// Returns the verified and deserialized [`CrlPayload`].
pub fn verify_crl_signature(
    payload_json: &str,
    signature_base64: &str,
) -> Result<CrlPayload, CoreError> {
    verify_crl_signature_with_pem(payload_json, signature_base64, LICENSE_PUBLIC_KEY_PEM)
}

/// Verify an RSA-2048 PKCS1v15 SHA-256 signature over a CRL payload using an explicit public key PEM.
pub fn verify_crl_signature_with_pem(
    payload_json: &str,
    signature_base64: &str,
    public_key_pem: &str,
) -> Result<CrlPayload, CoreError> {
    use rsa::pkcs8::DecodePublicKey;

    let public_key = RsaPublicKey::from_public_key_pem(public_key_pem).map_err(|e| {
        CoreError::InvalidSubscriptionSignature(format!("failed to load public key: {e}"))
    })?;

    let sig_bytes = base64::engine::general_purpose::STANDARD
        .decode(signature_base64)
        .map_err(|e| {
            CoreError::InvalidSubscriptionSignature(format!(
                "failed to decode CRL base64 signature: {e}"
            ))
        })?;

    let signature = rsa::pkcs1v15::Signature::try_from(sig_bytes.as_slice()).map_err(|e| {
        CoreError::InvalidSubscriptionSignature(format!("invalid CRL RSA signature format: {e}"))
    })?;

    let verifying_key = VerifyingKey::<Sha256>::new(public_key);
    verifying_key
        .verify(payload_json.as_bytes(), &signature)
        .map_err(|e| {
            CoreError::InvalidSubscriptionSignature(format!(
                "CRL RSA signature verification failed: {e}"
            ))
        })?;

    let payload: CrlPayload = serde_json::from_str(payload_json).map_err(|e| {
        CoreError::Internal(format!("failed to parse verified CRL payload JSON: {e}"))
    })?;

    Ok(payload)
}

/// Fetch the Certificate/Licence Revocation List from the licence server.
///
/// Hits `GET /api/v1/license/crl` unauthenticated with a 15-second timeout.
pub async fn fetch_license_crl(base_url: Option<&str>) -> Result<CrlResponse, CoreError> {
    let default_url = license_server_url();
    let base = base_url.unwrap_or(&default_url).trim_end_matches('/');
    let url = format!("{base}/api/v1/license/crl");
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| CoreError::Internal(format!("failed to build HTTP client: {e}")))?;

    let resp = client.get(&url).send().await.map_err(|e| {
        let msg = format!("license server CRL unreachable: {e}");
        tracing::warn!("{msg}");
        CoreError::Internal(msg)
    })?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        let err = format!("CRL fetch failed ({status}): {body}");
        tracing::warn!("{err}");
        return Err(CoreError::Internal(err));
    }

    resp.json().await.map_err(|e| {
        let msg = format!("failed to parse CRL response: {e}");
        tracing::warn!("{msg}");
        CoreError::Internal(msg)
    })
}

/// Store a verified CRL payload into the local database settings, check if the
/// current tenant or device is revoked, and apply the revocation locally if so.
///
/// Returns `true` if the local tenant or device is revoked.
pub fn apply_crl_to_cache(
    conn: &rusqlite::Connection,
    crl: &CrlPayload,
    current_tenant_id: Option<&str>,
    current_license_key: Option<&str>,
    current_machine_id: Option<&str>,
) -> Result<bool, CoreError> {
    let json_str = serde_json::to_string(crl)
        .map_err(|e| CoreError::Internal(format!("failed to serialize CRL: {e}")))?;

    crate::settings::Settings::set(conn, crate::settings::keys::CRL_CACHE_JSON, &json_str)?;
    crate::settings::Settings::set(
        conn,
        crate::settings::keys::CRL_CHECKED_AT,
        &chrono::Utc::now().to_rfc3339(),
    )?;

    let is_revoked = is_revoked_in_crl_payload(
        crl,
        current_license_key,
        current_tenant_id,
        current_machine_id,
    );
    if is_revoked {
        let tid = current_tenant_id.unwrap_or("default");
        if let Err(e) = refresh_subscription_status_from_server(conn, tid, "revoked", None) {
            tracing::warn!("failed to set subscription status to revoked from CRL: {e}");
        }
        if let Some(mid) = current_machine_id
            && crl.revoked_devices.iter().any(|d| d == mid)
            && let Err(e) =
                crate::settings::Settings::set(conn, crate::settings::keys::DEVICE_REVOKED, "true")
        {
            tracing::warn!("failed to set device.revoked to true from CRL: {e}");
        }
    }

    Ok(is_revoked)
}

/// Check whether a given license key, tenant, or machine is revoked in a [`CrlPayload`].
pub fn is_revoked_in_crl_payload(
    crl: &CrlPayload,
    license_key: Option<&str>,
    tenant_id: Option<&str>,
    machine_id: Option<&str>,
) -> bool {
    // 1. Check tenant ID
    if let Some(tid) = tenant_id
        && crl.revoked_tenants.iter().any(|t| t == tid)
    {
        return true;
    }

    // 2. Check machine ID
    if let Some(mid) = machine_id
        && crl.revoked_devices.iter().any(|d| d == mid)
    {
        return true;
    }

    // 3. Check license key (exact or SHA-256 hex digest)
    if let Some(key) = license_key {
        let key_hash = {
            use sha2::Digest;
            let mut hasher = Sha256::new();
            hasher.update(key.as_bytes());
            hex::encode(hasher.finalize())
        };

        if crl
            .entries
            .iter()
            .any(|e| e.key == key || e.key_hash == key_hash)
        {
            return true;
        }
    }

    false
}

/// Check whether a given license key, tenant, or machine is revoked according to the local cached CRL.
pub fn is_revoked_in_cached_crl(
    conn: &rusqlite::Connection,
    license_key: Option<&str>,
    tenant_id: Option<&str>,
    machine_id: Option<&str>,
) -> Result<bool, CoreError> {
    let cached_crl_opt =
        crate::settings::Settings::get(conn, crate::settings::keys::CRL_CACHE_JSON)?;
    let Some(crl_json) = cached_crl_opt else {
        return Ok(false);
    };

    let crl: CrlPayload = match serde_json::from_str(&crl_json) {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!("failed to deserialize cached CRL, ignoring: {e}");
            return Ok(false);
        }
    };

    Ok(is_revoked_in_crl_payload(
        &crl,
        license_key,
        tenant_id,
        machine_id,
    ))
}
