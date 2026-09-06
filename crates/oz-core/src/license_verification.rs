//! License server verification and activation client for ADR #9.
/*
last audited 25-07-26 by RSA-Agent (oz-core slice C5: license_verification deep read)
crate: oz-core | status: SAFE | lint: CLEAN
findings: exemplary — RSA-2048 PKCS1v15/SHA-256 with build-embedded key; BOOTSTRAP_FREE sentinel accepted ONLY in debug builds (release requires a real signature); every server response signature-verified BEFORE trust; credentials travel only in Authorization headers (documented body-log-leak rationale); timeouts on all 5 HTTP clients (10/30/15/15s); api_key persisted plaintext in tenant_subscription (local threat model, COR-17/30 family)
next: none | perf: N/A
*/
//!
//! This module handles:
//! - RSA-2048 PKCS1v15 signature verification of signed subscriptions
//! - HTTP client calls to the PocketBase license server for activation,
//!   renewal, and status checks.
//!
//! The public key is embedded at build time via `LICENSE_PUBLIC_KEY_PEM`.
//! The server URL is `LICENSE_SERVER_URL` with env var override.

use base64::Engine;
use rsa::RsaPublicKey;
use rsa::pkcs1v15::VerifyingKey;
use rsa::signature::Verifier;
use serde::{Deserialize, Serialize};
use sha2::Sha256;

use crate::error::CoreError;

/// The license server URL embedded at build time.
///
/// Points at the unified deployment (auth + sync on one host, ADR #11):
/// the old standalone `oz-pos-license-service` was folded into it.
/// Override via the `OZ_LICENSE_SERVER_URL` environment variable
/// in production, or use `http://localhost:8090` for local testing.
pub const LICENSE_SERVER_URL: &str = "https://license.ozpos.my.id";

/// The RSA-2048 public key in PEM format, embedded at build time.
///
/// This key corresponds to the private key held by the PocketBase
/// license server. It is generated once and embedded in every POS
/// binary release.
///
/// In development/test builds, this defaults to a placeholder key.
/// Replace with the production public key before release.
pub const LICENSE_PUBLIC_KEY_PEM: &str = include_str!("../oz-license.key.pub");

/// Return the license server URL, respecting the env var override.
pub fn license_server_url() -> String {
    std::env::var("OZ_LICENSE_SERVER_URL").unwrap_or_else(|_| LICENSE_SERVER_URL.to_string())
}

/// Result of pinging the license server's unauthenticated health endpoint.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LicensePingResult {
    /// Whether the server responded successfully.
    pub ok: bool,
    /// Status text (e.g. "Connected", "Connection refused", ...).
    pub status: String,
    /// Round-trip latency in milliseconds, if the ping succeeded.
    pub latency_ms: Option<u64>,
}

/// Ping the license server's `/api/health` endpoint to verify reachability.
///
/// Unlike activation/renew/status, this needs NO credentials — the health
/// route returns `{"status":"ok"}` unauthenticated. The login/lock-screen
/// connection pill uses it so it shows green as soon as the auth server is
/// reachable, before any license is activated.
pub async fn ping_license_server() -> LicensePingResult {
    let health_url = format!("{}/api/health", license_server_url().trim_end_matches('/'));
    let start = std::time::Instant::now();
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build();
    match client {
        Ok(client) => match client.get(&health_url).send().await {
            Ok(resp) => {
                let latency = start.elapsed().as_millis() as u64;
                if resp.status().is_success() {
                    LicensePingResult {
                        ok: true,
                        status: format!("Connected ({latency}ms)"),
                        latency_ms: Some(latency),
                    }
                } else {
                    LicensePingResult {
                        ok: false,
                        status: format!("Server returned {}", resp.status()),
                        latency_ms: Some(latency),
                    }
                }
            }
            Err(e) => LicensePingResult {
                ok: false,
                status: format!("Connection failed: {e}"),
                latency_ms: None,
            },
        },
        Err(e) => LicensePingResult {
            ok: false,
            status: format!("HTTP client init failed: {e}"),
            latency_ms: None,
        },
    }
}

/// Extract a human-readable error message from a JSON error body
/// returned by the license server.
///
/// The server returns errors as `{"error": "message"}`. This helper
/// extracts the `error` field so the user sees the clean message
/// (e.g. "Wrong email or phone number") instead of the raw JSON blob.
///
/// Falls back to the raw body string if parsing fails.
fn extract_server_error(body: &str) -> String {
    if let Ok(obj) = serde_json::from_str::<serde_json::Value>(body)
        && let Some(msg) = obj.get("error").and_then(|v| v.as_str())
    {
        return msg.to_string();
    }
    body.to_string()
}

// ── Request/Response types ──────────────────────────────────────────

/// Request body for `POST /api/v1/license/activate`.
#[derive(Debug, Clone, Serialize)]
pub struct ActivateLicenseRequest {
    /// The license key purchased by the customer.
    pub key: String,
    /// The machine/hardware fingerprint.
    pub machine_id: String,
    /// The contact email (used as primary tenant identifier).
    pub email: String,
    /// The contact phone number for the licensee.
    pub phone: String,
    /// The segmented-trial vertical (C2.1, subscription-tiers.md §4). Only
    /// read by the server for trial keys: `None`/blank → 14-day Plus trial,
    /// `"restaurant"`/`"cafe"` → 14-day Pro trial, `"enterprise_referral"`
    /// → 30-day Pro trial. Paid keys ignore it — a client-supplied value
    /// never shortens or downgrades a paid license. Omitted from the body
    /// when unset so generic activations stay byte-identical.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub trial_vertical: Option<String>,
    /// The vertical-bundle id (C3.2, subscription-tiers.md §3).
    /// "restaurant_starter" unlocks the kds workspace type at the Plus
    /// tier. Mirrors `trial_vertical`'s trust boundary: the server only
    /// honors it for trial keys — a client-supplied bundle never widens a
    /// paid license. Omitted from the body when unset.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub bundle_id: Option<String>,
    /// The device-level hardware fingerprint (SPEC-2026-TRIAL-LOCK): the
    /// "hw_" + SHA-256 hex of the same hardware anchor `machine_id`
    /// derives from, stable across reinstalls. Unlike `machine_id` (the
    /// same digest truncated to 15 chars and persisted per-installation),
    /// the fingerprint is the full digest in the spec's canonical form, so
    /// the server's one-trial-per-device lock can key on it even after a
    /// wiped Settings table. The server falls back to `machine_id` when
    /// omitted and never gates PAID keys with the trial lock — sending it
    /// is always safe. Omitted from the body when unset.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub hardware_fingerprint: Option<String>,
    /// The api_key of an existing tenant, required when re-activating
    /// an installation whose tenant was previously activated (H1 audit
    /// fix). New tenants omit this on the first activation; the server
    /// issues a new api_key in the response which must be persisted
    /// locally and re-sent on every subsequent activation call.
    /// `None` for first activation; `Some(api_key)` for re-activation.
    ///
    /// The key is sent in the `Authorization: Bearer <api_key>` header
    /// (see [`activate_license`]) and is deliberately NEVER serialized
    /// into the request body — a body credential leaks into CDN /
    /// webserver access logs that capture request bodies.
    #[serde(skip_serializing, default)]
    pub api_key: Option<String>,
}

/// Response from `POST /api/v1/license/activate`.
#[derive(Debug, Clone, Deserialize)]
pub struct ActivateLicenseResponse {
    /// The signed subscription payload (JSON string).
    pub signed_payload: String,
    /// Base64-encoded RSA-2048 signature.
    pub signature: String,
    /// The Tenant ID returned by the server.
    #[serde(default)]
    pub tenant_id: String,
    /// The API key for subsequent renew/status calls.
    #[serde(default)]
    pub api_key: String,
}

/// Request body for `POST /api/v1/license/renew`.
#[derive(Debug, Serialize, Deserialize)]
pub struct RenewLicenseRequest {
    /// The tenant ID.
    pub tenant_id: String,
    /// The API key obtained during activation. Sent in the
    /// `Authorization: Bearer <api_key>` header (see [`renew_license`])
    /// and deliberately NEVER serialized into the request body — a body
    /// credential leaks into CDN / webserver access logs that capture
    /// request bodies.
    #[serde(default, skip_serializing)]
    pub api_key: String,
    /// The new license key.
    pub key: String,
}

/// Response from `POST /api/v1/license/renew`.
#[derive(Debug, Clone, Deserialize)]
pub struct RenewLicenseResponse {
    /// The signed subscription payload (JSON string).
    pub signed_payload: String,
    /// Base64-encoded RSA-2048 signature.
    pub signature: String,
}

/// Response from `POST /api/v1/license/status`.
#[derive(Debug, Clone, Deserialize)]
pub struct LicenseStatusResponse {
    /// The tenant ID.
    pub tenant_id: String,
    /// The subscription status.
    pub status: String,
    /// The tier key (free, pro, premium, enterprise).
    pub tier: String,
    /// Whether the subscription is active.
    pub active: bool,
    /// When the subscription expires (RFC 3339).
    #[serde(default)]
    pub expires_at: Option<String>,
    /// When the grace period ends (RFC 3339).
    #[serde(default)]
    pub grace_until: Option<String>,
    /// Tier location quota. Wire field keeps the historical `max_stores`
    /// name until the license-server payload rename (todo-global-saas-1.md
    /// item 1g, versioned migration with dual-read).
    #[serde(default)]
    pub max_stores: i64,
}

/// The subscription payload structure signed by the license server.
/// Matches the Go `SubscriptionPayload` struct in `apps/license-server/`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignedSubscriptionPayload {
    /// The tenant ID.
    pub tenant_id: String,
    /// The tier key (free, pro, premium, enterprise).
    pub tier_key: String,
    /// The subscription status.
    pub status: String,
    /// Maximum number of stores allowed. Wire field keeps the historical
    /// `max_stores` name (Go `SubscriptionPayload`) until the license-server
    /// payload rename (todo-global-saas-1.md item 1g, versioned, dual-read);
    /// it persists into the local `max_locations` column.
    #[serde(default)]
    pub max_stores: i64,
    /// Maximum POS register instances allowed.
    #[serde(default)]
    pub max_pos_instances: i64,
    /// List of workspace types allowed.
    #[serde(default)]
    pub allowed_types: Vec<String>,
    /// C4.3: Add-on identifiers purchased with this license.
    /// Add-ons extend tier capabilities (e.g. "advanced_analytics",
    /// "priority_support"). The list is additive to the base tier quotas.
    #[serde(default)]
    pub addons: Vec<String>,
    /// When the subscription becomes active.
    pub starts_at: String,
    /// When the subscription expires.
    pub expires_at: String,
    /// When the offline grace period ends (expires_at + 14 days).
    pub grace_until: String,
    /// When this payload was issued.
    pub issued_at: String,
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
    // BOOTSTRAP_FREE is a sentinel for single-store deployments without
    // a license server (seeded by migration 061). It is ONLY accepted in
    // debug/dev builds; release builds require a real RSA signature.
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

// ── HTTP Client Functions ───────────────────────────────────────────

/// Activate a license key with the PocketBase license server.
///
/// POSTs to `/api/v1/license/activate` with the license key, tenant ID,
/// and machine fingerprint. Returns the signed subscription and API key.
///
/// # Arguments
/// * `req` - The activation request with license key and tenant info.
///
/// # Returns
/// The activation response containing signed_payload, signature, and api_key.
pub async fn activate_license(
    req: &ActivateLicenseRequest,
) -> Result<ActivateLicenseResponse, CoreError> {
    let url = format!("{}/api/v1/license/activate", license_server_url());
    let client = reqwest::Client::new();

    let mut request = client.post(&url);
    // The api_key authenticates the caller as the tenant admin on
    // re-activations; it travels in the Authorization header (never the
    // body, which access logs capture). First activations have no key yet.
    if let Some(api_key) = &req.api_key {
        request = request.bearer_auth(api_key);
    }
    let resp = request
        .json(req)
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| {
            let msg = format!("license server unreachable: {e}");
            tracing::warn!("activation: {msg}");
            CoreError::Internal(msg)
        })?;

    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        let msg = extract_server_error(&body);
        let err = format!("activation failed ({status}): {msg}");
        tracing::warn!("{err}");
        return Err(CoreError::Internal(err));
    }

    let result: ActivateLicenseResponse = resp.json().await.map_err(|e| {
        let msg = format!("failed to parse activation response: {e}");
        tracing::warn!("{msg}");
        CoreError::Internal(msg)
    })?;

    // Verify the returned signature before trusting it.
    if let Err(e) = verify_license_signature(&result.signed_payload, &result.signature) {
        tracing::warn!("activation signature verification failed: {e}");
        return Err(e);
    }

    Ok(result)
}

/// Renew an existing subscription with the license server.
///
/// POSTs to `/api/v1/license/renew` with the tenant ID and API key.
pub async fn renew_license(req: &RenewLicenseRequest) -> Result<RenewLicenseResponse, CoreError> {
    let url = format!("{}/api/v1/license/renew", license_server_url());
    let client = reqwest::Client::new();

    let resp = client
        .post(&url)
        .bearer_auth(&req.api_key)
        .json(req)
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| {
            let msg = format!("license server unreachable: {e}");
            tracing::warn!("renewal: {msg}");
            CoreError::Internal(msg)
        })?;

    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        let msg = extract_server_error(&body);
        let err = format!("renewal failed ({status}): {msg}");
        tracing::warn!("{err}");
        return Err(CoreError::Internal(err));
    }

    let result: RenewLicenseResponse = resp.json().await.map_err(|e| {
        let msg = format!("failed to parse renewal response: {e}");
        tracing::warn!("{msg}");
        CoreError::Internal(msg)
    })?;

    if let Err(e) = verify_license_signature(&result.signed_payload, &result.signature) {
        tracing::warn!("renewal signature verification failed: {e}");
        return Err(e);
    }

    Ok(result)
}

/// Check the current license status from the license server.
///
/// POSTs to `/api/v1/license/status` with the api_key carried in an
/// `Authorization: Bearer <api_key>` header. The server authenticates the
/// caller by this header alone (no `tenant_id` path parameter). Moving
/// the credential out of the URL into a header prevents it from being
/// captured in webserver access logs, CDN logs, browser history, or
/// `Referer` request headers.
///
/// # Arguments
/// * `api_key` - The API key returned by the activation response, used
///   to authenticate this status check.
pub async fn check_license_status(api_key: &str) -> Result<LicenseStatusResponse, CoreError> {
    let url = format!("{}/api/v1/license/status", license_server_url());
    let client = reqwest::Client::new();

    let resp = client
        .post(&url)
        .bearer_auth(api_key)
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| {
            let msg = format!("license server unreachable: {e}");
            tracing::warn!("status check: {msg}");
            CoreError::Internal(msg)
        })?;

    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        let msg = extract_server_error(&body);
        let err = format!("status check failed ({status}): {msg}");
        tracing::warn!("{err}");
        return Err(CoreError::Internal(err));
    }

    resp.json().await.map_err(|e| {
        let msg = format!("failed to parse status response: {e}");
        tracing::warn!("{msg}");
        CoreError::Internal(msg)
    })
}

/// Store a signed subscription payload and API key in the local database.
///
/// Updates the `tenant_subscription` table with the payload and key
/// received from the license server after activation or renewal.
pub fn store_subscription(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    signed_payload: &str,
    signature: &str,
    api_key: &str,
) -> Result<(), CoreError> {
    // Parse the payload to extract tier info. The wire field is
    // `max_stores` (Go `SubscriptionPayload`), persisted into the local
    // `max_locations` column — the mapping is the 1c "activation mapping"
    // step; the wire rename itself is item 1g (versioned, dual-read).
    let payload: SignedSubscriptionPayload = serde_json::from_str(signed_payload)
        .map_err(|e| CoreError::Internal(format!("failed to parse signed payload: {e}")))?;

    let allowed_types_json =
        serde_json::to_string(&payload.allowed_types).unwrap_or_else(|_| "[]".into());

    conn.execute(
        "INSERT OR REPLACE INTO tenant_subscription
         (tenant_id, tier_key, status, expires_at, max_locations,
          max_pos_instances, allowed_types_json, signature, signed_payload,
          api_key, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
        rusqlite::params![
            tenant_id,
            payload.tier_key,
            payload.status,
            payload.expires_at,
            payload.max_stores,
            payload.max_pos_instances,
            allowed_types_json,
            signature,
            signed_payload,
            api_key,
        ],
    )?;

    Ok(())
}

/// Response from the pause/resume subscription endpoint.
#[derive(Debug, Deserialize)]
pub struct PauseResumeResponse {
    /// New subscription status ("paused" or "active").
    pub status: String,
    /// Tier key that was paused/resumed.
    pub tier_key: String,
    /// When the subscription was paused (only present on pause response).
    pub paused_at: Option<String>,
    /// When the pause expires (only present on pause response).
    pub paused_until: Option<String>,
}

/// Pause a subscription for 1–3 months.
///
/// Calls `POST /api/v1/license/pause` with `pause_months` in the body.
/// The subscription transitions to `paused` status with `paused_at` and
/// `paused_until` timestamps.
pub async fn pause_subscription(
    api_key: &str,
    pause_months: u8,
) -> Result<PauseResumeResponse, CoreError> {
    let url = format!("{}/api/v1/license/pause", license_server_url());
    let client = reqwest::Client::new();
    let body = serde_json::json!({ "pause_months": pause_months });

    let resp = client
        .post(&url)
        .bearer_auth(api_key)
        .timeout(std::time::Duration::from_secs(15))
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            let msg = format!("license server unreachable: {e}");
            tracing::warn!("pause: {msg}");
            CoreError::Internal(msg)
        })?;

    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        let msg = extract_server_error(&body);
        let err = format!("pause failed ({status}): {msg}");
        tracing::warn!("{err}");
        return Err(CoreError::Internal(err));
    }

    resp.json().await.map_err(|e| {
        let msg = format!("failed to parse pause response: {e}");
        tracing::warn!("{msg}");
        CoreError::Internal(msg)
    })
}

/// Resume a paused subscription.
///
/// Calls `POST /api/v1/license/resume`. The subscription transitions
/// back to `active` and the pause fields are cleared.
pub async fn resume_subscription(api_key: &str) -> Result<PauseResumeResponse, CoreError> {
    let url = format!("{}/api/v1/license/resume", license_server_url());
    let client = reqwest::Client::new();

    let resp = client
        .post(&url)
        .bearer_auth(api_key)
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| {
            let msg = format!("license server unreachable: {e}");
            tracing::warn!("resume: {msg}");
            CoreError::Internal(msg)
        })?;

    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        let msg = extract_server_error(&body);
        let err = format!("resume failed ({status}): {msg}");
        tracing::warn!("{err}");
        return Err(CoreError::Internal(err));
    }

    resp.json().await.map_err(|e| {
        let msg = format!("failed to parse resume response: {e}");
        tracing::warn!("{msg}");
        CoreError::Internal(msg)
    })
}

#[cfg(test)]
#[path = "license_verification_tests.rs"]
mod tests;
