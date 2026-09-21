//! License server verification and activation client for ADR #9.
/*
last audited 25-07-26 by RSA-Agent (kasirmu-core slice C5: license_verification deep read)
crate: kasirmu-core | status: SAFE | lint: CLEAN
findings: exemplary — RSA-2048 PKCS1v15/SHA-256 with build-embedded key; BOOTSTRAP_FREE sentinel honoured in every profile but ONLY for a Free-tier row, the policy living in TenantSubscription::verify_signature since 19-09-26 (this module's own debug short-circuit stays any-payload); every server response signature-verified BEFORE trust; credentials travel only in Authorization headers (documented body-log-leak rationale); timeouts on all 5 HTTP clients (10/30/15/15s); api_key persisted plaintext in tenant_subscription (local threat model, COR-17/30 family)
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

use std::collections::HashMap;

use base64::Engine;
use rsa::RsaPublicKey;
use rsa::pkcs1v15::VerifyingKey;
use rsa::signature::Verifier;
use serde::{Deserialize, Serialize};
use sha2::Sha256;

use crate::error::CoreError;

/// The license server URL embedded at build time.
///
/// Points at the unified deployment (auth + sync on one host, ADR #11): the old
/// standalone `oz-pos-license-service` was folded into it. This is an alias for
/// [`crate::server_origin::MAIN_SERVER_ORIGIN`] — the single compiled definition
/// of the origin lives in `server_origin` (ADR #55).
pub const LICENSE_SERVER_URL: &str = crate::server_origin::MAIN_SERVER_ORIGIN;

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
///
/// Delegates to [`crate::server_origin::resolve_origin`] so the precedence table
/// has exactly one implementation. A blank or malformed override is ignored
/// rather than producing an empty base URL.
pub fn license_server_url() -> String {
    // One precedence implementation for the whole app: the settings surface
    // reports the same value through attestation::resolved_origin.
    crate::attestation::resolved_origin().url
}

/// Result of pinging the license server's unauthenticated health endpoint.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LicensePingResult {
    /// Whether the server answered with a 2xx. Deliberately unchanged by
    /// the addition of [`Self::state`]: existing callers render a connected
    /// pill from this field, and redefining it would silently recolour a
    /// degraded server as healthy everywhere at once. `ok` answers "did the
    /// HTTP call succeed"; `state` answers "is the service well". They
    /// disagree exactly when the server is up and reporting a broken
    /// subsystem, which is the case that used to be invisible.
    pub ok: bool,
    /// Status text (e.g. "Connected", "Connection refused", ...).
    pub status: String,
    /// Round-trip latency in milliseconds, if the ping succeeded.
    pub latency_ms: Option<u64>,
    /// The health state, from the payload rather than the status code.
    pub state: crate::service_health::HealthState,
    /// What is wrong, when [`Self::state`] is not
    /// [`HealthState::Operational`](crate::service_health::HealthState::Operational).
    pub cause: Option<String>,
}

/// Ping the license server's `/api/health` endpoint to verify reachability.
///
/// Unlike activation/renew/status, this needs NO credentials — the health
/// route returns `{"status":"ok"}` unauthenticated. The login/lock-screen
/// connection pill uses it so it shows green as soon as the auth server is
/// reachable, before any license is activated.
pub async fn ping_license_server() -> LicensePingResult {
    use crate::service_health::{HealthState, classify_license_health};

    let health_url = format!("{}/api/health", license_server_url().trim_end_matches('/'));
    let start = std::time::Instant::now();
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build();
    match client {
        Ok(client) => match client.get(&health_url).send().await {
            Ok(resp) => {
                // Measured before the body read, so latency stays a
                // round-trip figure and not a download figure.
                let latency = start.elapsed().as_millis() as u64;
                let code = resp.status().as_u16();
                let ok = resp.status().is_success();
                // Read the body on a failure too. The server answers 503
                // *with* its full health payload when its database is down,
                // and that body is the only thing distinguishing "up but
                // unhealthy" from "not there". Discarding it is what made
                // the two render identically.
                let parsed = resp
                    .text()
                    .await
                    .ok()
                    .and_then(|t| serde_json::from_str(&t).ok());
                let (state, cause) = classify_license_health(code, parsed.as_ref());
                let status = match state {
                    HealthState::Operational => format!("Connected ({latency}ms)"),
                    HealthState::Degraded => format!(
                        "Degraded: {} ({latency}ms)",
                        cause.clone().unwrap_or_else(|| "reported degraded".into())
                    ),
                    other => format!(
                        "{}: {}",
                        other.as_str(),
                        cause.clone().unwrap_or_else(|| format!("HTTP {code}"))
                    ),
                };
                LicensePingResult {
                    ok,
                    status,
                    latency_ms: Some(latency),
                    state,
                    cause,
                }
            }
            Err(e) => LicensePingResult {
                ok: false,
                status: format!("Connection failed: {e}"),
                latency_ms: None,
                state: HealthState::Unavailable,
                cause: Some("connection failed".into()),
            },
        },
        Err(e) => LicensePingResult {
            ok: false,
            status: format!("HTTP client init failed: {e}"),
            latency_ms: None,
            state: HealthState::Unavailable,
            cause: Some("http client init failed".into()),
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
    /// Whether **this device** has been revoked by a tenant admin
    /// (ADR #58 §2.4a.2).
    ///
    /// Server-authored, from `tenant_machines.revoked_at` for the `machine_id`
    /// this client sent. `#[serde(default)]` so a server that predates the
    /// field parses as `false` — the pre-existing behaviour, never a lockout.
    ///
    /// The verdict is only meaningful when the client actually sent a
    /// non-empty `machine_id`; with no machine id the server cannot resolve a
    /// row and answers `false`. That is the fail-open direction §2.4 requires.
    #[serde(default)]
    pub device_revoked: bool,
    /// When the subscription expires (RFC 3339).
    #[serde(default)]
    pub expires_at: Option<String>,
    /// When the grace period ends (RFC 3339).
    #[serde(default)]
    pub grace_until: Option<String>,
    /// Tier location quota, primary wire name. The 1g rename made this
    /// the license-server wire name; the server dual-emits both names at
    /// the same value during the client rotation window, and pre-rename
    /// servers send only `max_stores`. Resolve with
    /// [`Self::effective_max_locations`] — a bare `serde(alias)` cannot
    /// be used here because serde rejects a document carrying BOTH
    /// names (duplicate field), which is exactly the dual-emit shape.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_locations: Option<i64>,
    /// Legacy pre-rename wire name (`max_stores`), kept so payloads from
    /// un-upgraded servers keep parsing; the server sends it alongside
    /// `max_locations` with the same value during the rotation window.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_stores: Option<i64>,
}

impl SignedSubscriptionPayload {
    /// The location quota regardless of which wire name carried it.
    /// 0 when neither name is present — the pre-1g `#[serde(default)]`
    /// behavior (0 reads as unlimited server-side).
    pub fn effective_max_locations(&self) -> i64 {
        self.max_locations.or(self.max_stores).unwrap_or(0)
    }
}

impl LicenseStatusResponse {
    /// The location quota regardless of which wire name carried it.
    /// 0 when neither name is present — the pre-1g `#[serde(default)]`
    /// behavior (0 reads as unlimited server-side).
    pub fn effective_max_locations(&self) -> i64 {
        self.max_locations.or(self.max_stores).unwrap_or(0)
    }
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
    /// Tier location quota, primary 1g wire name
    /// (Go `SubscriptionPayload.MaxLocations`). See the field docs on
    /// [`LicenseStatusResponse`] for the dual-name compat shape; resolve
    /// with [`Self::effective_max_locations`] and persist into the local
    /// `max_locations` column.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_locations: Option<i64>,
    /// Legacy pre-rename wire name, dual-emitted by the Go side with the
    /// same value during the rotation window.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_stores: Option<i64>,
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
    /// Phase C (todo-global-saas-2.md): whether this subscription period is
    /// a trial. Defaults to `false` when the field is absent, which is both
    /// a paid subscription and any payload signed before Phase C — the
    /// additive wire change needs no dual-read. The tier/quota answer is
    /// unaffected: a trial tier still resolves to Free.
    #[serde(default)]
    pub is_trial: bool,
    /// When the trial ends, RFC3339, from the signed payload. `None` when
    /// the field is absent or empty (i.e. not a trial, or a pre-Phase-C
    /// payload). Validated by [`crate::subscription::TenantSubscription`]
    /// rather than here: an unparseable value fails closed to `None`.
    #[serde(default)]
    pub trial_ends_at: Option<String>,
    /// Phase D1 (todo-global-saas-2.md): the server's explicit
    /// per-feature instructions, keyed by the canonical
    /// [`crate::availability::AvailabilityFeature`] wire name (e.g.
    /// `"supports_analytics"`). `Some(false)` withholds where the tier
    /// would allow, `Some(true)` grants beyond tier, and a key that is
    /// simply absent leaves the tier's own answer in place.
    ///
    /// `serde(default)` so a payload signed before Phase D1 — or one the
    /// current server emits today, since authoring is not yet wired —
    /// deserializes to an empty map rather than failing.
    #[serde(default)]
    pub features: HashMap<String, bool>,
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
/// The body carries `machine_id`, which the server needs to resolve this
/// device's `tenant_machines` row and answer `device_revoked`
/// (ADR #58 §2.4a.2). Before that field was sent, the server's device lookup
/// never ran and the verdict was always `false` — a revocation capability
/// that existed at both endpoints and was never joined up.
///
/// An **empty** `machine_id` is sent as-is rather than omitted: the server
/// skips its lookup on an empty value and answers `device_revoked: false`,
/// which is the fail-open direction (no machine identity means no verdict,
/// never a lockout).
///
/// # Arguments
/// * `api_key` - The API key returned by the activation response, used
///   to authenticate this status check.
/// * `machine_id` - The persisted machine fingerprint (`keys::MACHINE_ID`),
///   used by the server to identify this device.
pub async fn check_license_status(
    api_key: &str,
    machine_id: &str,
) -> Result<LicenseStatusResponse, CoreError> {
    let url = format!("{}/api/v1/license/status", license_server_url());
    let client = reqwest::Client::new();

    let resp = client
        .post(&url)
        .bearer_auth(api_key)
        .json(&serde_json::json!({ "machine_id": machine_id }))
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

/// Apply a server licence verdict to the local cache, and report whether the
/// tenant is now revoked.
///
/// This is the shared body of ADR #58 option C ("ride any authenticated
/// call"): the same three local effects must happen wherever a server verdict
/// arrives, and duplicating them per call site is how a revocation path
/// silently drifts from its sibling.
///
/// The effects, in this order and deliberately:
///
/// 1. Refresh the local `tenant_subscription` row's server-authoritative
///    `status`/`expires_at` (`refresh_subscription_status_from_server`).
/// 2. Cache the per-device verdict in `keys::DEVICE_REVOKED`, so the session
///    gate can enforce it without a network call (ADR #58 §2.4a.2, §2.7).
/// 3. Return whether the **tenant** verdict is `revoked`, so the caller can
///    drop live sessions.
///
/// **Why the cache write precedes the return.** The caller sweeps live
/// sessions on a `revoked` answer. If the sweep ran before the write, a
/// session created in that window would read the stale `active` row and slip
/// through; writing first means such a session fails closed on the cached
/// verdict instead. §2.5 names this ordering explicitly.
///
/// **Fail-open on any write failure.** Both writes are logged and swallowed:
/// the verdict is a *restriction*, and losing it must leave the device
/// working rather than lock a till (§2.4). A `None` `tenant_id` row is a
/// no-op, not an error — the caller has already handled the
/// no-license-activated path before any network call.
///
/// # Arguments
/// * `conn` — global identity database connection.
/// * `resp` — a signature-unverified status response; this only caches
///   server-authored *lifecycle* fields, never quota, so no signature is
///   trusted here (quota still comes from the signed payload).
///
/// # Returns
/// `true` when the tenant-level status is `revoked` — the caller must then
/// drop every live session. `false` for every other status, including the
/// device-level verdict, which the caller reads from the cache instead.
pub fn apply_license_verdict_to_cache(
    conn: &rusqlite::Connection,
    resp: &LicenseStatusResponse,
) -> bool {
    if let Err(e) = refresh_subscription_status_from_server(
        conn,
        "default",
        &resp.status,
        resp.expires_at.as_deref(),
    ) {
        tracing::warn!("failed to refresh subscription status cache: {e}");
    }

    // Server-authored only — never written from user input. A failed write
    // fails open (the device keeps working), which is the direction §2.4
    // requires for anything that could otherwise lock a till.
    if let Err(e) = crate::settings::Settings::set(
        conn,
        crate::settings::keys::DEVICE_REVOKED,
        if resp.device_revoked { "true" } else { "false" },
    ) {
        tracing::warn!("failed to persist device_revoked cache: {e}");
    }

    resp.status.eq_ignore_ascii_case("revoked")
}

/// Store a signed subscription payload in the local `tenant_subscription`
/// table after an activation or a renewal.
///
/// It deliberately does NOT take, or write, the API key. The live key is
/// sealed once into the machine-bound `license.api_key` settings row by the
/// bridge lane, which is the only reader of it; a second, unencrypted copy in
/// this table duplicated the secret for no consumer. The
/// `tenant_subscription.api_key` column is left out of the INSERT below, so
/// a row written here gets the column's empty default — but "the column
/// keeps its empty default" is true only of a FRESH install, and only of a
/// row this function has just written. Read the writers together:
///
/// - the `INSERT OR REPLACE` below DOES clear a legacy value, on activate
///   and on renew, because the omitted column falls back to its default;
/// - the only production `UPDATE` of this table,
///   `refresh_subscription_status_from_server` below, is partial and leaves
///   the column exactly as it found it;
/// - pause and resume never touch this table at all —
///   `crates/kasirmu-bridge/src/license.rs` (`pause_subscription` and
///   `resume_subscription`) read the sealed settings key and write nothing
///   locally.
///
/// So the window is real: an install that activated BEFORE `5e054714e` and
/// has not re-activated or renewed since still carries a cleartext API key
/// in this column, and nothing scrubs it — no code path and no migration.
/// Closing it is a data mutation, not a doc fix, and is parked together with
/// dropping the column (dropping would mutate hosted merchant databases, and
/// `TenantSubscription::load` still selects it, so the field stays on the
/// struct either way).
pub fn store_subscription(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    signed_payload: &str,
    signature: &str,
) -> Result<(), CoreError> {
    // Parse the payload to extract tier info. The 1g primary wire name
    // is `max_locations`, with the legacy `max_stores` still accepted
    // from pre-rename servers; either lands in the local
    // `max_locations` column.
    let payload: SignedSubscriptionPayload = serde_json::from_str(signed_payload)
        .map_err(|e| CoreError::Internal(format!("failed to parse signed payload: {e}")))?;

    let allowed_types_json =
        serde_json::to_string(&payload.allowed_types).unwrap_or_else(|_| "[]".into());

    conn.execute(
        "INSERT OR REPLACE INTO tenant_subscription
         (tenant_id, tier_key, status, expires_at, max_locations,
          max_pos_instances, allowed_types_json, signature, signed_payload,
          updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
        rusqlite::params![
            tenant_id,
            payload.tier_key,
            payload.status,
            payload.expires_at,
            payload.effective_max_locations(),
            payload.max_pos_instances,
            allowed_types_json,
            signature,
            signed_payload,
        ],
    )?;

    Ok(())
}

/// Refresh the local cache from a successful `/api/v1/license/status` response.
///
/// The status endpoint returns authoritative `status` and `expires_at` data
/// but does NOT re-issue a signed payload. We apply a partial UPDATE to the
/// local `tenant_subscription` row so that the next call to
/// `get_subscription_capabilities` reads up-to-date lifecycle information
/// without requiring a full re-activation. The signed payload and signature
/// remain unchanged (they carry quota data that only changes on
/// activation/renewal); only the server-authoritative fields are refreshed.
///
/// Runs inside a transaction per the DB-write policy. A missing row is a
/// no-op (the caller already handled the no-license-activated path before
/// the network call).
///
/// # Arguments
/// * `conn` — global identity database connection.
/// * `tenant_id` — the tenant key in the row (always `"default"` for now).
/// * `status` — the raw status string from the server (e.g. `"active"`, `"canceled"`).
/// * `expires_at` — RFC 3339 expiry timestamp from the server, if present.
pub fn refresh_subscription_status_from_server(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    status: &str,
    expires_at: Option<&str>,
) -> Result<(), CoreError> {
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE tenant_subscription
         SET status = ?1,
             expires_at = ?2,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE tenant_id = ?3",
        rusqlite::params![status, expires_at, tenant_id],
    )?;
    tx.commit()?;
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
