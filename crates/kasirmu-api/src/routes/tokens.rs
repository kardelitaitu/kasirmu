//! Token management endpoint.
/*
last audited 25-07-26 by RSA-Agent (kasirmu-api slice A: tokens deep read; API-2 FIXED 25-07-26)
crate: kasirmu-api | status: SAFE | lint: CLEAN
findings: API-2 FIXED — admin_key_authorised now compares via HMAC-SHA256 digests under a fixed context key with subtle-backed verify_slice (constant-time; plain == short-circuited on the first differing byte), 4 new unit tests (exact match, wrong/prefix/suffix probes, dev-open, missing header); dev-open mode remains documented and unreachable behind OZ_PRODUCTION=1 via the API-1 production-secrets gate. Clean structure otherwise — P2 admin-gated label mint, P3 terminal client-credentials path takes tenant from the registration (never the body)
next: none | perf: N/A
*/
//!
//! `POST /api/v1/tokens` — generate a new API token.
//!
//! ADR sync-auth-hardening P2: when the server is started with an
//! `OZ_ADMIN_KEY` environment variable, minting a token requires an
//! `X-Admin-Key` header matching it. When `OZ_ADMIN_KEY` is unset the
//! endpoint stays open (dev mode / local Docker) so auto-provisioning
//! keeps working without extra configuration.

use axum::{
    Extension, Json,
    extract::State,
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::auth::ApiTokenClaims;
use crate::auth::TokenResponse;

/// A request marker the SINGLE-TENANT embedder inserts so this route knows
/// which surface it is serving (C39).
///
/// The house shape is the one `AppState::allow_terminal_credentials` already
/// sets: the SURFACE declares what it allows and the route honours it. The
/// embedded local API serves exactly one store, so a caller-supplied
/// `tenant_id` names a tenant that surface can never honour - and one the
/// desktop boot check would later reject (see the C34 boundary guard).
///
/// WHY AN EXTENSION AND NOT A FIELD ON `AppState`. `AppState` is built as a
/// struct literal by ~20 sites, nearly all of them test files outside this
/// change; a new field would break them or force a sweep of files the change
/// has no business touching. A request extension is inserted by the
/// embedder's own layer, cannot be set by an HTTP client (unlike a sentinel
/// header), and is ABSENT on every other surface - so the cloud path is
/// untouched by construction rather than by a branch that could drift.
#[derive(Clone, Copy, Debug)]
pub struct SingleTenantSurface;

/// Request body for creating a new API token.
#[derive(Deserialize)]
pub struct CreateTokenRequest {
    /// Human-readable label for this token (e.g. "kitchen-display-1").
    pub label: String,
    /// Expiry in hours. Defaults to 24 if omitted.
    pub expiry_hours: Option<i64>,
    /// Optional tenant / store ID for multi-tenant cloud isolation.
    pub tenant_id: Option<String>,
    /// Client credentials from a registered terminal (ADR sync-auth-hardening
    /// P3). When both are present the token is minted for that terminal
    /// without requiring the admin key; the tenant is taken from the
    /// terminal's registration, never from the request body.
    #[serde(default)]
    pub client_id: Option<String>,
    /// Device secret paired with `client_id` (ADR sync-auth-hardening P3).
    #[serde(default)]
    pub client_secret: Option<String>,
    /// Read-tier preset name (terminal/dashboard/audit) — admin-key path
    /// only. Terminal client-credentials always bind the `terminal` preset
    /// server-side and cannot self-elevate via this field.
    #[serde(default)]
    pub read_preset: Option<String>,
    /// Custom read permission list — admin-key path only. Overrides
    /// `read_preset` when both are present (fine-grained control).
    /// Terminal client-credentials cannot set this field.
    #[serde(default)]
    pub read_permissions: Option<Vec<String>>,
}

/// Response body containing the newly created token.
#[derive(Serialize)]
pub struct CreateTokenResponse {
    /// The token details (JWT string, expiry, id).
    pub token: TokenResponse,
}

/// Header carrying the admin key that gates token minting (ADR
/// sync-auth-hardening P2).
const ADMIN_KEY_HEADER: &str = "x-admin-key";

/// Check whether the request is authorised to mint a token.
///
/// Returns `true` when the server has no admin key configured (dev mode),
/// or when the `X-Admin-Key` header matches the configured key.
///
/// API-2 fix: the comparison is constant-time. Both values are hashed
/// with HMAC-SHA256 under a fixed context key and the digests are checked
/// with `verify_slice` (subtle-backed), so response timing does not leak
/// how many leading bytes of the header matched — a plain `==` on strings
/// short-circuits on the first differing byte. The fixed HMAC key is fine
/// here: the admin key is not attacker-chosen secret input to the MAC, the
/// hashing exists only to make the equality check data-independent.
pub fn admin_key_authorised(headers: &HeaderMap, configured: Option<&str>) -> bool {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;

    let Some(key) = configured else {
        return true; // dev mode — no admin key configured
    };
    let Some(supplied) = headers
        .get(header::HeaderName::from_static(ADMIN_KEY_HEADER))
        .and_then(|v| v.to_str().ok())
    else {
        return false;
    };

    type HmacSha256 = Hmac<Sha256>;
    let digest = |value: &str| {
        let mut mac = HmacSha256::new_from_slice(b"kasirmu-api-admin-key-compare")
            // INVARIANT: HMAC accepts keys of any length (RFC 2104), so a fixed
            // literal domain-separation key cannot fail.
            .expect("HMAC accepts any key length");
        mac.update(value.as_bytes());
        mac.finalize().into_bytes()
    };

    let provided = digest(supplied);
    let mut mac = HmacSha256::new_from_slice(b"kasirmu-api-admin-key-compare")
        // INVARIANT: HMAC accepts keys of any length (RFC 2104), so a fixed
        // literal domain-separation key cannot fail.
        .expect("HMAC accepts any key length");
    mac.update(key.as_bytes());
    // `verify_slice` is the constant-time comparison; a digest `==` is not
    // guaranteed data-independent.
    mac.verify_slice(provided.as_slice()).is_ok()
}

/// Gate a write handler on the operator admin-key tier (D1 residual,
/// API-4 class).
///
/// Master-data writes (products, stock, tax rates, exchange rates)
/// must not be reachable with a bare tenant JWT or a device credential.
/// This helper enforces both defenses, mirroring the `users.rs` gate:
///
/// 1. **Admin key** (when configured): 401 `invalid_admin_key` unless
///    the `X-Admin-Key` header matches — same second factor as token
///    minting, plan changes, settings, and user creation.
/// 2. **Terminal-scope denial** (defense in depth): 403
///    `insufficient_scope` when the token is scoped to a registered
///    terminal — a device credential must never mutate money-relevant
///    master data even if it somehow carries a valid admin key.
///
/// Returns `Ok(())` to proceed, or the error response to short-circuit.
#[allow(clippy::result_large_err)]
pub fn require_admin_write(
    headers: &HeaderMap,
    claims: &ApiTokenClaims,
    configured: Option<&str>,
) -> Result<(), Response> {
    if !admin_key_authorised(headers, configured) {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error": "invalid_admin_key"})),
        )
            .into_response());
    }
    if claims.terminal_id.is_some() {
        return Err((
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({
                "error": "insufficient_scope",
                "message": "master-data writes require an admin-minted token; \
                            this token is scoped to a registered terminal",
            })),
        )
            .into_response());
    }
    Ok(())
}

/// `POST /api/v1/tokens` — create a new API token.
///
/// Returns 401 when an admin key is configured but missing/mismatched.
/// Returns 500 if JWT encoding fails (should never happen in practice).
pub async fn create_token_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    single_tenant: Option<Extension<SingleTenantSurface>>,
    Json(body): Json<CreateTokenRequest>,
) -> impl IntoResponse {
    // ADR sync-auth-hardening P3: terminal client-credentials path. A
    // registered terminal mints its own scoped token — no admin key needed.
    if let (Some(client_id), Some(client_secret)) =
        (body.client_id.as_deref(), body.client_secret.as_deref())
    {
        // Embedder opt-out (review MED-5): the desktop local API sets
        // `allow_terminal_credentials = false` — device credentials are
        // a cloud-fleet provisioning concept and must not become a
        // local credential the operator never minted.
        if !state.allow_terminal_credentials {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": "terminal_credentials_disabled"})),
            )
                .into_response();
        }
        let verified = if let Some(pool) = &state.pg {
            crate::pg::verify_terminal_credentials(pool, client_id, client_secret)
                .await
                .map_err(|e| e.to_string())
        } else {
            let db = state.db.lock().await;
            let verified = crate::routes::terminals::verify_terminal_credentials(
                &db,
                client_id,
                client_secret,
            );
            drop(db);
            verified.map_err(|e| e.to_string())
        };
        return match verified {
            Ok(Some(terminal)) => {
                // Terminal client-credentials bind the `terminal` preset
                // unconditionally (spec 0047 F2).  The escape hatch
                // OZ_TERMINAL_READ_TIER=full preserves legacy full-read.
                let permissions: Option<Vec<String>> =
                    if std::env::var("OZ_TERMINAL_READ_TIER").as_deref() == Ok("full") {
                        warn_terminal_read_tier_escape_once();
                        None
                    } else {
                        Some(
                            crate::read_tiers::TERMINAL_PRESET
                                .iter()
                                .map(|k| k.to_string())
                                .collect(),
                        )
                    };
                match crate::auth::create_token_full(
                    &body.label,
                    body.expiry_hours,
                    terminal.tenant_id.as_deref(),
                    Some(&terminal.terminal_id),
                    permissions.as_deref(),
                    Some(&state.api_secret),
                ) {
                    Ok(resp) => Json(CreateTokenResponse { token: resp }).into_response(),
                    Err(e) => {
                        tracing::error!(?e, "JWT encoding failed");
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            Json(serde_json::json!({"error": "token generation failed"})),
                        )
                            .into_response()
                    }
                }
            }
            Ok(None) => (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({"error": "invalid_credentials"})),
            )
                .into_response(),
            Err(e) => {
                tracing::error!(error = %e, "verifying terminal credentials failed");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({"error": "token generation failed"})),
                )
                    .into_response()
            }
        };
    }

    // Admin-gated label mint (P2).
    if !admin_key_authorised(&headers, state.admin_key.as_deref()) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error": "invalid_admin_key"})),
        )
            .into_response();
    }

    // C39: the embedded (single-tenant) surface REFUSES a caller-supplied
    // tenant rather than dropping it.
    //
    // WHY REFUSE AND NOT IGNORE. Dropping the claim would mint a token whose
    // scope silently differs from what the caller asked for: a script that
    // sent `tenant_id: "acme"` would receive a `default`-scoped token and
    // believe it holds acme scope. Every later request would then be judged
    // against a tenant the caller never agreed to - a silent authority
    // mismatch, which is worse than an error because nothing surfaces it.
    // A refusal names the problem at the only moment the caller can act on
    // it, and it is the shape this surface already uses for the sibling
    // restriction (`terminal_credentials_disabled`, 400).
    //
    // An ABSENT claim and an explicit `"default"` are both accepted: the
    // former is every UI-minted token (`mint_token` passes no tenant) and the
    // latter is the one value this surface can actually honour. Only a
    // DIFFERENT tenant is refused - which is exactly the set the C34 boundary
    // guard would later block on the write path, caught one step earlier.
    if single_tenant.is_some()
        && let Some(tenant) = body.tenant_id.as_deref()
        && tenant != "default"
    {
        tracing::warn!(
            tenant = %tenant,
            "local API: refused a token request naming a tenant - this surface serves a single store"
        );
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "tenant_claim_not_supported",
                "message": "this local API serves a single store; a token cannot be scoped to another tenant",
            })),
        )
            .into_response();
    }

    // Resolve read-tier permissions (spec 0047 F2).
    let permissions = match resolve_read_permissions(&body) {
        Ok(perms) => perms,
        Err((code, error)) => {
            return (code, Json(serde_json::json!({"error": error}))).into_response();
        }
    };

    match crate::auth::create_token_full(
        &body.label,
        body.expiry_hours,
        body.tenant_id.as_deref(),
        None,
        permissions.as_deref(),
        Some(&state.api_secret),
    ) {
        Ok(resp) => Json(CreateTokenResponse { token: resp }).into_response(),
        Err(e) => {
            tracing::error!(?e, "JWT encoding failed");
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                axum::Json(serde_json::json!({"error": "token generation failed"})),
            )
                .into_response()
        }
    }
}

/// Resolve the read-tier permissions for an admin-key mint (spec 0047 F2).
///
/// Rules:
/// - Neither field → `None` (legacy full-read).
/// - `read_permissions` set → validates each key against the registry;
///   unknown keys → 422 `unknown_permission`.
/// - Only `read_preset` set → resolves the preset; unknown preset → 422
///   `unknown_preset`.
/// - Both set → `read_permissions` wins (fine-grained overrides the named
///   preset), after validating the list.
///
/// Returns `Ok(None)` when the caller should mint a full-read token, or
/// `Err((StatusCode, error_code))` to short-circuit the response.
fn resolve_read_permissions(
    body: &CreateTokenRequest,
) -> Result<Option<Vec<String>>, (StatusCode, &'static str)> {
    match (&body.read_permissions, &body.read_preset) {
        (Some(keys), _) => {
            let owned: Vec<String> = keys.clone();
            if let Err(unknown) = crate::read_tiers::validate_keys(&owned) {
                tracing::warn!(?unknown, "token mint rejected unknown read permission(s)");
                return Err((StatusCode::UNPROCESSABLE_ENTITY, "unknown_permission"));
            }
            Ok(Some(owned))
        }
        (None, Some(preset)) => match crate::read_tiers::resolve_preset(preset) {
            Some(keys) => Ok(Some(keys.iter().map(|k| k.to_string()).collect())),
            None => {
                tracing::warn!(preset, "token mint rejected unknown read preset");
                Err((StatusCode::UNPROCESSABLE_ENTITY, "unknown_preset"))
            }
        },
        (None, None) => Ok(None),
    }
}

/// Warn once if the `OZ_TERMINAL_READ_TIER=full` escape hatch is set
/// (spec 0047 decision 1: window + flag, slated for removal).
fn warn_terminal_read_tier_escape_once() {
    static WARNED: std::sync::Once = std::sync::Once::new();
    WARNED.call_once(|| {
        eprintln!(
            "[kasirmu-api] WARNING: OZ_TERMINAL_READ_TIER=full — terminal tokens keep \
             legacy full read access. This escape hatch is slated for removal after \
             one release cycle; see spec 0047 decision 1."
        );
    });
}

#[cfg(test)]
#[path = "tokens_tests.rs"]
mod tests;
