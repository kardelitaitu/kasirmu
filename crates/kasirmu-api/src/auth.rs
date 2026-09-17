//! JSON Web Token generation and validation for the OZ-POS OpenAPI.
/*
last audited 25-07-26 by RSA-Agent (oz-api slice A: auth deep read; API-1 FIXED 25-07-26)
crate: oz-api | status: SAFE | lint: CLEAN
findings: API-1 FIXED — serve() now refuses to boot when OZ_PRODUCTION=1 and OZ_API_SECRET (or OZ_ADMIN_KEY) is missing (validate_production_secrets, mirroring the cloud-server boot gate), so the hard-coded dev JWT signing secret is unreachable in production; the dev fallback itself remains for zero-config dev startup with a one-time loud eprintln warning (warn_dev_fallback_once); signing_secret_for_tests() exposes the resolved secret for tests. API-2 INFO unchanged — 60s JWT validation cache means an expired token passes up to 60s past exp (documented tradeoff, bounded cache); structured 401 taxonomy per P4 with WWW-Authenticate; exp validated, HS256-only validation default (no alg confusion)
next: API-2 INFO — constant-time admin-key compare, decrypted-GET documentation | perf: N/A
*/
//!
//! Tokens are signed with HS256 and carry an `exp` (expiration) claim.
//! The signing secret is loaded from the `OZ_API_SECRET` env var at
//! startup. Every request to a protected route must include an
//! `Authorization: Bearer <token>` header.
//!
//! Token generation via `POST /api/v1/tokens` returns the JWT string
//! and the expiry timestamp. There is no revocation list in this pass;
//! tokens are valid until their `exp` claim expires.

use std::collections::HashMap;
use std::sync::LazyLock;
use std::time::Instant;

use axum::{
    extract::{Request, State},
    http::{StatusCode, header},
    middleware::Next,
    response::{IntoResponse, Response},
};
use chrono::{Duration, Utc};
use jsonwebtoken::{DecodingKey, EncodingKey, Header, Validation, decode, encode};
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

const DEFAULT_EXPIRY_HOURS: i64 = 24;

/// JWT validation cache: (resolved secret, token) → (claims, cached_at).
/// Reduces CPU by skipping HMAC + base64 decode on repeat requests.
/// TTL is 60 seconds — short enough that expired tokens are caught
/// quickly, long enough to eliminate redundant crypto on hot paths.
/// The secret is part of the key so a server configured with one secret
/// can never serve a cached validation result produced under another
/// (relevant now that the desktop app signs with a per-install secret
/// while tests/dev may use the fallback constant in the same process).
const JWT_CACHE_TTL_SECS: u64 = 60;

/// Cache entry: validated claims + timestamp of validation.
type JwtCacheEntry = (ApiTokenClaims, Instant);

/// Cache key: (resolved_secret, raw_token).
type JwtCacheKey = (String, String);

/// In-memory JWT validation cache.
type JwtCache = RwLock<HashMap<JwtCacheKey, JwtCacheEntry>>;

static JWT_CACHE: LazyLock<JwtCache> = LazyLock::new(|| RwLock::new(HashMap::new()));

/// The payload embedded in every API token.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ApiTokenClaims {
    /// Standard JWT subject — a human-readable label for this token.
    pub sub: String,
    /// Token identifier (UUID v4).
    pub jti: String,
    /// Standard JWT expiry (epoch seconds).
    pub exp: usize,
    /// When the token was issued (epoch seconds).
    pub iat: usize,
    /// Tenant / store ID for multi-tenant cloud isolation.
    /// `None` for single-store deployments (backward compatible).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tenant_id: Option<String>,

    /// Registered terminal that minted this token (ADR sync-auth-hardening
    /// P3). `None` for admin-minted or legacy tokens.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub terminal_id: Option<String>,

    /// Read-tier permission keys (spec 0047 Part B). `None` = legacy
    /// full-read — every GET is allowed, byte-compatible with tokens
    /// minted before this field existed. When present, GETs are gated
    /// through the registry (`has_permission`) with a 403 on denial.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub permissions: Option<Vec<String>>,
}

/// Response body returned when a new token is created.
#[derive(Debug, Serialize)]
pub struct TokenResponse {
    /// The signed JWT string. Pass this as `Authorization: Bearer <token>`.
    pub token: String,
    /// ISO-8601 expiry timestamp for display.
    pub expires_at: String,
    /// Token identifier (same as `jti` in claims).
    pub token_id: String,
}

/// Hard-coded development fallback secret (API-1).
///
/// Only reachable when `OZ_API_SECRET` is unset/empty AND `OZ_PRODUCTION`
/// is not enabled — `serve()` refuses to boot in production without a real
/// secret, so a known-constant forgery path cannot exist on a production
/// deployment.
const DEV_FALLBACK_SECRET: &str = "oz-pos-dev-secret-change-in-production";

/// Warn once when the dev fallback secret is in use (API-1).
fn warn_dev_fallback_once() {
    static DEV_FALLBACK_WARNED: std::sync::Once = std::sync::Once::new();
    DEV_FALLBACK_WARNED.call_once(|| {
        eprintln!(
            "[oz-api] WARNING: OZ_API_SECRET is not set — using the hard-coded \
             dev signing secret. Tokens are forgeable by anyone who knows the \
             constant. Set OZ_API_SECRET (required when OZ_PRODUCTION=1)."
        );
    });
}

/// Load the signing secret from the environment.
///
/// Falls back to a hard-coded dev secret if `OZ_API_SECRET` is unset,
/// so the server starts in development without extra config. A loud
/// one-time warning is printed when the fallback is used. Production
/// deployments MUST set `OZ_API_SECRET` — `serve()` refuses to start
/// when `OZ_PRODUCTION=1` and the secret is missing, so this fallback
/// is unreachable in production.
fn signing_secret(provided: Option<&str>) -> String {
    match provided
        .filter(|s| !s.is_empty())
        .map(|s| s.to_owned())
        .or_else(|| std::env::var("OZ_API_SECRET").ok())
        .filter(|s| !s.is_empty())
    {
        Some(secret) => secret,
        None => {
            warn_dev_fallback_once();
            DEV_FALLBACK_SECRET.to_owned()
        }
    }
}

/// Expose the resolved signing secret for tests/ops introspection.
///
/// `signing_secret` is private (implementation detail of mint/validate);
/// this `#[doc(hidden)]` wrapper lets tests assert the dev-fallback
/// constant without widening the real API surface.
#[doc(hidden)]
pub fn signing_secret_for_tests() -> String {
    signing_secret(None)
}

/// Generate a new signed JWT with the given subject label, optionally
/// scoped to a tenant.
///
/// The token expires after `expiry_hours` (default 24). Returns the
/// signed token string and its expiry timestamp.
///
/// # Errors
///
/// Returns an error if the JWT encoding fails (extremely rare; requires
/// a malformed key or a serialization bug).
pub fn create_token(
    subject: &str,
    expiry_hours: Option<i64>,
    tenant_id: Option<&str>,
    secret: Option<&str>,
) -> Result<TokenResponse, jsonwebtoken::errors::Error> {
    create_token_scoped(subject, expiry_hours, tenant_id, None, secret)
}

/// Mint a token scoped to a registered terminal (ADR sync-auth-hardening
/// P3). `terminal_id` is embedded in the claims so the server knows which
/// device the token belongs to.
pub fn create_token_scoped(
    subject: &str,
    expiry_hours: Option<i64>,
    tenant_id: Option<&str>,
    terminal_id: Option<&str>,
    secret: Option<&str>,
) -> Result<TokenResponse, jsonwebtoken::errors::Error> {
    create_token_full(subject, expiry_hours, tenant_id, terminal_id, None, secret)
}

/// Mint a token with optional read-tier permissions (spec 0047 Part B).
///
/// `permissions` is a list of registry keys that narrow the token's GET
/// surface: when `Some`, reads are gated through `has_permission` and a
/// denied key yields 403. `None` preserves the legacy full-read contract
/// (byte-compatible with pre-tier tokens — the claim is skipped entirely).
///
/// # Errors
///
/// Returns an error if the JWT encoding fails (extremely rare; requires
/// a malformed key or a serialization bug).
pub fn create_token_full(
    subject: &str,
    expiry_hours: Option<i64>,
    tenant_id: Option<&str>,
    terminal_id: Option<&str>,
    permissions: Option<&[String]>,
    secret: Option<&str>,
) -> Result<TokenResponse, jsonwebtoken::errors::Error> {
    let hours = expiry_hours.unwrap_or(DEFAULT_EXPIRY_HOURS);
    let now = Utc::now();
    let exp_time = now + Duration::hours(hours);
    let token_id = uuid::Uuid::now_v7().to_string();

    let claims = ApiTokenClaims {
        sub: subject.to_owned(),
        jti: token_id.clone(),
        exp: exp_time.timestamp() as usize,
        iat: now.timestamp() as usize,
        tenant_id: tenant_id.map(|s| s.to_owned()),
        terminal_id: terminal_id.map(|s| s.to_owned()),
        permissions: permissions.map(|p| p.to_vec()),
    };

    let secret = signing_secret(secret);
    let encoding_key = EncodingKey::from_secret(secret.as_bytes());
    let token = encode(&Header::default(), &claims, &encoding_key)?;

    Ok(TokenResponse {
        token,
        expires_at: exp_time.to_rfc3339(),
        token_id,
    })
}

/// Validate a JWT and return its claims.
///
/// Returns `Ok(claims)` if the token is valid and not expired.
/// Uses an in-memory cache to skip redundant HMAC + base64 decode
/// on hot paths (saves ~0.005 core at 200+ terminals).
pub async fn validate_token(
    token_str: &str,
) -> Result<ApiTokenClaims, jsonwebtoken::errors::Error> {
    validate_token_with_secret(token_str, None).await
}

/// Validate a JWT against an explicit signing secret.
///
/// `secret` follows the same resolution order as [`signing_secret`]:
/// non-empty provided value → `OZ_API_SECRET` env → dev fallback
/// constant. This is the variant the stateful middleware uses so a
/// server can sign and validate with a per-instance secret (the desktop
/// local API) instead of the process-wide env, without ever touching
/// `std::env::set_var` (UB from async workers — removed in C-2).
pub async fn validate_token_with_secret(
    token_str: &str,
    secret: Option<&str>,
) -> Result<ApiTokenClaims, jsonwebtoken::errors::Error> {
    let secret = signing_secret(secret);
    let cache_key = (secret.clone(), token_str.to_string());

    // Check cache first (read lock — non-blocking for concurrent readers).
    {
        let cache = JWT_CACHE.read().await;
        if let Some((claims, cached_at)) = cache.get(&cache_key)
            && cached_at.elapsed().as_secs() < JWT_CACHE_TTL_SECS
        {
            return Ok(claims.clone());
        }
    }

    // Cache miss or expired — validate the token cryptographically.
    let decoding_key = DecodingKey::from_secret(secret.as_bytes());
    let mut validation = Validation::default();
    validation.validate_exp = true;
    let claims =
        decode::<ApiTokenClaims>(token_str, &decoding_key, &validation).map(|data| data.claims)?;

    // Store in cache (write lock — brief).
    {
        let mut cache = JWT_CACHE.write().await;
        // Evict expired entries opportunistically (keep cache bounded).
        if cache.len() > 1000 {
            cache.retain(|_, (_, at)| at.elapsed().as_secs() < JWT_CACHE_TTL_SECS);
        }
        cache.insert(cache_key, (claims.clone(), Instant::now()));
    }

    Ok(claims)
}

/// Build a structured 401 response distinguishing why auth failed
/// (ADR sync-auth-hardening P4): `token_expired`, `invalid_token`, or
/// `missing_token`. The client refreshes its stored key ONLY on
/// `token_expired`; the other codes indicate a configuration problem.
fn unauthorized(error_code: &'static str) -> Response {
    (
        StatusCode::UNAUTHORIZED,
        [(header::WWW_AUTHENTICATE, "Bearer")],
        axum::Json(serde_json::json!({ "error": error_code })),
    )
        .into_response()
}

/// Classify a JWT validation failure as `token_expired` or `invalid_token`.
fn error_code_for(e: &jsonwebtoken::errors::Error) -> &'static str {
    if matches!(e.kind(), jsonwebtoken::errors::ErrorKind::ExpiredSignature) {
        "token_expired"
    } else {
        "invalid_token"
    }
}

/// Extract the bearer token, validate it, and insert the claims into the
/// request extensions. Shared by both middleware variants.
///
/// `secret` is forwarded to [`validate_token_with_secret`] (None = env /
/// dev-fallback resolution).
#[allow(clippy::result_large_err)]
async fn authenticate(req: &mut Request, secret: Option<&str>) -> Result<(), Response> {
    let auth_header = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| unauthorized("missing_token"))?;

    let token = auth_header
        .strip_prefix("Bearer ")
        .ok_or_else(|| unauthorized("missing_token"))?;

    match validate_token_with_secret(token, secret).await {
        Ok(claims) => {
            req.extensions_mut().insert(claims);
            Ok(())
        }
        Err(e) => Err(unauthorized(error_code_for(&e))),
    }
}

/// Axum middleware that rejects requests without a valid JWT.
///
/// Attach to protected routes via `Router::layer(from_fn(auth_middleware))`.
/// Returns a structured 401 body (`token_expired` / `invalid_token` /
/// `missing_token`) plus `WWW-Authenticate: Bearer` so clients can tell
/// why auth failed (ADR sync-auth-hardening P4).
///
/// Resolves the signing secret from the environment — use
/// [`auth_middleware_with_state`] when the server carries its own secret
/// in [`crate::AppState`] (the desktop local API does).
#[allow(clippy::result_large_err)]
pub async fn auth_middleware(mut req: Request, next: Next) -> Result<Response, Response> {
    authenticate(&mut req, None).await?;
    Ok(next.run(req).await)
}

/// Minimal state for [`auth_middleware_with_state`]: just the signing
/// secret behind an `Arc`, so per-request extraction is an `Arc::clone`
/// instead of a full [`crate::AppState`] clone (~7 heap allocations on
/// every protected request).
#[derive(Clone)]
pub struct AuthState {
    /// JWT signing secret for this server instance.
    pub secret: std::sync::Arc<String>,
}

/// Stateful variant of [`auth_middleware`]: validates bearer tokens
/// against [`AuthState::secret`] instead of the process environment, so
/// multiple servers with different secrets can coexist (and the desktop
/// app can sign with a per-install random secret without mutating env).
#[allow(clippy::result_large_err)]
pub async fn auth_middleware_with_state(
    State(auth): State<AuthState>,
    mut req: Request,
    next: Next,
) -> Result<Response, Response> {
    authenticate(&mut req, Some(auth.secret.as_str())).await?;
    Ok(next.run(req).await)
}

#[cfg(test)]
#[path = "auth_tests.rs"]
mod tests;
