//! Cloud sync auth surface — token requests, tenant plan lookups, and
//! terminal registration, extracted from `sync_client.rs` (F-011).
//!
//! Key items:
//! - [`TokenResult`], [`TenantPlanResult`], [`TerminalRegistrationResult`]
//! - `fetch_tenant_plan`, `register_terminal`, `request_token*`,
//!   `mint_token`, `ping_server`, `persist_refreshed_api_key`
//!
//! Invariants: 401-classification refreshes once then surfaces
//! InvalidCredentials; admin-key endpoints require OZ_ADMIN_KEY.

use super::*;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::error::CoreError;
/// Result of requesting a new API token from the cloud server.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenResult {
    /// Whether the token was successfully obtained.
    pub ok: bool,
    /// The JWT token string (only present on success).
    pub token: Option<String>,
    /// Human-readable status or error message.
    pub status: String,
    /// Token expiry in ISO-8601 format, if the server returned one.
    pub expires_at: Option<String>,
}

/// Result of reading the caller's own sync plan (ADR sync-plan-gating).
///
/// The plan string is `free` | `pro`, or `None` when the read failed or the
/// server is unreachable — the UI falls back to showing nothing rather than
/// guessing.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TenantPlanResult {
    /// Whether the server responded successfully.
    pub ok: bool,
    /// Effective plan (`free` | `pro`), when the read succeeded.
    pub plan: Option<String>,
    /// Human-readable status or error message.
    pub status: String,
}

/// Read the caller's own sync plan from `GET /api/v1/tenants/me/plan`.
///
/// Uses the stored API key (JWT) so the server resolves the tenant from the
/// token claims. Unlike the sync endpoints this route is NOT plan-gated, so a
/// free tenant can read its own plan to render the upgrade prompt.
#[cfg(feature = "sync-http")]
pub async fn fetch_tenant_plan(url: &str, api_key: &str) -> TenantPlanResult {
    let plan_url = format!("{}/api/v1/tenants/me/plan", url.trim_end_matches('/'));

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return TenantPlanResult {
                ok: false,
                plan: None,
                status: format!("Failed to build HTTP client: {e}"),
            };
        }
    };

    match client
        .get(&plan_url)
        .header("Authorization", format!("Bearer {api_key}"))
        .send()
        .await
    {
        Ok(resp) => {
            if resp.status().is_success() {
                #[derive(Deserialize)]
                struct PlanPayload {
                    plan: String,
                }
                match resp.json::<PlanPayload>().await {
                    Ok(payload) => TenantPlanResult {
                        ok: true,
                        plan: Some(payload.plan),
                        status: "ok".into(),
                    },
                    Err(e) => TenantPlanResult {
                        ok: false,
                        plan: None,
                        status: format!("Failed to parse plan response: {e}"),
                    },
                }
            } else {
                TenantPlanResult {
                    ok: false,
                    plan: None,
                    status: format!("Server returned {}", resp.status()),
                }
            }
        }
        Err(e) => TenantPlanResult {
            ok: false,
            plan: None,
            status: format!("Connection failed: {e}"),
        },
    }
}

/// Stub when sync-http is disabled.
#[cfg(not(feature = "sync-http"))]
pub async fn fetch_tenant_plan(_url: &str, _api_key: &str) -> TenantPlanResult {
    TenantPlanResult {
        ok: false,
        plan: None,
        status: "sync-http feature is disabled".into(),
    }
}

/// Read the admin key that gates token minting (ADR sync-auth-hardening P2).
///
/// Comes from the `OZ_ADMIN_KEY` environment variable; the client sends it as
/// `X-Admin-Key` so auto-provisioning and refresh keep working against a
/// gated server. Returns `None` on dev machines without the variable.
pub fn admin_key_from_env() -> Option<String> {
    std::env::var("OZ_ADMIN_KEY")
        .ok()
        .filter(|key| !key.trim().is_empty())
}

/// Result of registering a sync terminal (ADR sync-auth-hardening P3).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalRegistrationResult {
    /// Whether registration succeeded.
    pub ok: bool,
    /// Terminal identifier (present on success).
    pub terminal_id: Option<String>,
    /// Plaintext device secret (present on success — shown once).
    pub device_secret: Option<String>,
    /// Human-readable status or error message.
    pub status: String,
}

/// Register this terminal with the sync server (ADR sync-auth-hardening P3).
///
/// Posts to `POST /api/v1/terminals` with the optional `X-Admin-Key` header.
/// Returns the plaintext device secret exactly once; the server only keeps
/// its SHA-256 hash.
#[cfg(feature = "sync-http")]
pub async fn register_terminal(
    url: &str,
    admin_key: Option<&str>,
    terminal_id: &str,
    label: &str,
) -> TerminalRegistrationResult {
    let register_url = format!("{}/api/v1/terminals", url.trim_end_matches('/'));
    let body = serde_json::json!({
        "terminal_id": terminal_id,
        "label": label,
    });

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return TerminalRegistrationResult {
                ok: false,
                terminal_id: None,
                device_secret: None,
                status: format!("Failed to build HTTP client: {e}"),
            };
        }
    };

    let mut request = client
        .post(&register_url)
        .header("Content-Type", "application/json");
    if let Some(key) = admin_key {
        request = request.header("X-Admin-Key", key);
    }

    match request.json(&body).send().await {
        Ok(resp) if resp.status().is_success() => {
            #[derive(Deserialize)]
            struct RegisterPayload {
                terminal_id: String,
                device_secret: String,
            }
            match resp.json::<RegisterPayload>().await {
                Ok(payload) => TerminalRegistrationResult {
                    ok: true,
                    terminal_id: Some(payload.terminal_id),
                    device_secret: Some(payload.device_secret),
                    status: "registered".into(),
                },
                Err(e) => TerminalRegistrationResult {
                    ok: false,
                    terminal_id: None,
                    device_secret: None,
                    status: format!("Failed to parse registration response: {e}"),
                },
            }
        }
        Ok(resp) => {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            TerminalRegistrationResult {
                ok: false,
                terminal_id: None,
                device_secret: None,
                status: format!("Server returned {status}: {body}"),
            }
        }
        Err(e) => TerminalRegistrationResult {
            ok: false,
            terminal_id: None,
            device_secret: None,
            status: format!("Request failed: {e}"),
        },
    }
}

/// Stub when sync-http is disabled.
#[cfg(not(feature = "sync-http"))]
pub async fn register_terminal(
    _url: &str,
    _admin_key: Option<&str>,
    _terminal_id: &str,
    _label: &str,
) -> TerminalRegistrationResult {
    TerminalRegistrationResult {
        ok: false,
        terminal_id: None,
        device_secret: None,
        status: "sync-http feature is disabled".into(),
    }
}

/// Request a token using terminal client credentials (ADR sync-auth-hardening
/// P3) — the client-credentials path, no admin key required.
#[cfg(feature = "sync-http")]
pub async fn request_token_client_credentials(
    url: &str,
    client_id: &str,
    client_secret: &str,
) -> TokenResult {
    let token_url = format!("{}/api/v1/tokens", url.trim_end_matches('/'));
    let body = serde_json::json!({
        "label": "pos-terminal",
        "client_id": client_id,
        "client_secret": client_secret,
    });

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return TokenResult {
                ok: false,
                token: None,
                status: format!("Failed to build HTTP client: {e}"),
                expires_at: None,
            };
        }
    };

    match client
        .post(&token_url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => {
            #[derive(Deserialize)]
            struct TokenPayload {
                token: String,
                #[serde(default)]
                expires_at: Option<String>,
            }
            #[derive(Deserialize)]
            struct TokenResponse {
                token: TokenPayload,
            }
            match resp.json::<TokenResponse>().await {
                Ok(tr) => TokenResult {
                    ok: true,
                    status: "Token obtained".into(),
                    token: Some(tr.token.token),
                    expires_at: tr.token.expires_at,
                },
                Err(e) => TokenResult {
                    ok: false,
                    token: None,
                    status: format!("Failed to parse token response: {e}"),
                    expires_at: None,
                },
            }
        }
        Ok(resp) => {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            TokenResult {
                ok: false,
                token: None,
                status: format!("Server returned {status}: {body}"),
                expires_at: None,
            }
        }
        Err(e) => TokenResult {
            ok: false,
            token: None,
            status: format!("Request failed: {e}"),
            expires_at: None,
        },
    }
}

/// Stub when sync-http is disabled.
#[cfg(not(feature = "sync-http"))]
pub async fn request_token_client_credentials(
    _url: &str,
    _client_id: &str,
    _client_secret: &str,
) -> TokenResult {
    TokenResult {
        ok: false,
        token: None,
        status: "sync-http feature is disabled".into(),
        expires_at: None,
    }
}

/// Mint a token using the strongest available authentication:
/// terminal client credentials first, then the admin key env var, then an
/// open (label-only) mint for dev servers.
pub async fn mint_token(server_url: &str, client_credentials: Option<(&str, &str)>) -> TokenResult {
    if let Some((client_id, client_secret)) = client_credentials {
        return request_token_client_credentials(server_url, client_id, client_secret).await;
    }
    let admin_key = admin_key_from_env();
    request_token(server_url, admin_key.as_deref()).await
}

/// Request a new JWT API token from the cloud server's
/// `POST /api/v1/tokens` endpoint (async — safe to call from
/// Tauri async command handlers).
///
/// `admin_key` is sent as `X-Admin-Key` when present (ADR sync-auth-hardening
/// P2); servers configured with `OZ_ADMIN_KEY` reject minting without it.
#[cfg(feature = "sync-http")]
pub async fn request_token(url: &str, admin_key: Option<&str>) -> TokenResult {
    let token_url = format!("{}/api/v1/tokens", url.trim_end_matches('/'));
    let body = serde_json::json!({"label": "pos-terminal"});

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return TokenResult {
                ok: false,
                token: None,
                status: format!("Failed to build HTTP client: {e}"),
                expires_at: None,
            };
        }
    };

    let mut request = client
        .post(&token_url)
        .header("Content-Type", "application/json");
    if let Some(key) = admin_key {
        request = request.header("X-Admin-Key", key);
    }

    match request.json(&body).send().await {
        Ok(resp) => {
            if resp.status().is_success() {
                #[derive(Deserialize)]
                struct TokenPayload {
                    token: String,
                    #[serde(default)]
                    expires_at: Option<String>,
                }
                #[derive(Deserialize)]
                struct TokenResponse {
                    token: TokenPayload,
                }
                match resp.json::<TokenResponse>().await {
                    Ok(tr) => {
                        let expires = tr.token.expires_at.clone();
                        TokenResult {
                            ok: true,
                            status: expires
                                .as_ref().map_or_else(|| "Token obtained".into(), |e| format!("Token obtained — {}", format_expiry(e))),
                            token: Some(tr.token.token),
                            expires_at: tr.token.expires_at,
                        }
                    }
                    Err(e) => TokenResult {
                        ok: false,
                        token: None,
                        status: format!("Failed to parse token response: {e}"),
                        expires_at: None,
                    },
                }
            } else {
                let status = resp.status();
                let body = resp.text().await.unwrap_or_default();
                TokenResult {
                    ok: false,
                    token: None,
                    status: format!("Server returned {status}: {body}"),
                    expires_at: None,
                }
            }
        }
        Err(e) => TokenResult {
            ok: false,
            token: None,
            status: format!("Request failed: {e}"),
            expires_at: None,
        },
    }
}

/// Stub when sync-http is disabled.
#[cfg(not(feature = "sync-http"))]
pub async fn request_token(_url: &str, _admin_key: Option<&str>) -> TokenResult {
    TokenResult {
        ok: false,
        token: None,
        status: "sync-http feature is disabled".into(),
        expires_at: None,
    }
}

/// Request a fresh token from the server (ADR sync-auth-hardening P1).
///
/// Async-only — performs no DB work, so callers can run it before taking
/// the DB lock (the same three-phase split the sync commands use). Returns
/// the new key on success, or `None` when the server refused to mint one.
pub async fn request_refresh_token(
    server_url: &str,
    client_credentials: Option<(&str, &str)>,
) -> Option<String> {
    let token = mint_token(server_url, client_credentials).await;
    if !token.ok {
        tracing::warn!(
            status = %token.status,
            "token refresh failed — sync stays on the stored key"
        );
        return None;
    }
    token.token
}

/// Persist a freshly requested API key (ADR sync-auth-hardening P1).
///
/// Synchronous write; callers hold the DB lock only for this call so the
/// guard never crosses an await point and Tauri command futures stay `Send`.
pub fn persist_refreshed_api_key(conn: &Connection, key: &str) -> Result<(), CoreError> {
    crate::settings::Settings::set_sync_api_key(conn, key)?;
    tracing::info!("refreshed sync API key after auth rejection");
    Ok(())
}

/// The authenticated half of a sync probe's answer.
///
/// `/health` is PUBLIC (`apps/unified/Caddyfile` routes it, and
/// `kasirmu-api`'s `/api/v1/health` is exempt from the read gate), so a
/// `ping_server` success proves only that a socket answered. It cannot
/// distinguish "sync will work" from "the credential is missing or dead" —
/// and that gap is exactly what let an enabled-but-unauthorised install draw
/// a green dot while every push 401'd.
///
/// This carries the *second*, credential-bearing question so the two can be
/// rendered as the different things they are.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SyncAuthHealth {
    /// No credential is stored — the device was never linked.
    Unauthenticated,
    /// A credential is stored and the server accepted it.
    Authorized,
    /// A credential is stored and the server rejected it (401/403), so the
    /// device is linked but its link is dead.
    Rejected,
    /// The credential check could not be completed (transport error, or the
    /// `sync-http` feature is off). Distinct from `Rejected`: nothing was
    /// refused, so nothing should be reported as refused.
    Unknown,
}

/// Ask the server an authenticated question, to learn whether the stored
/// credential actually works.
///
/// Reuses `fetch_tenant_plan` rather than adding a request: `GET
/// /api/v1/tenants/me/plan` is already (a) authenticated by the JWT, (b) in
/// the `terminal` read preset (`read_tiers.rs:131-136`), and (c) cheap and
/// read-only. So a probe that succeeds proves the token is accepted *and*
/// carries the scope a terminal was minted with, which is strictly more than
/// a reachability ping can say.
///
/// Classifying on the server's status, not on `ok` alone: a 401/403 is the
/// credential being refused, while a transport failure is the server being
/// unreachable — conflating them would revive the very confusion this
/// function exists to remove.
pub async fn probe_sync_auth(url: &str, api_key: Option<&str>) -> SyncAuthHealth {
    let Some(api_key) = api_key.filter(|k| !k.is_empty()) else {
        return SyncAuthHealth::Unauthenticated;
    };

    let result = fetch_tenant_plan(url, api_key).await;
    if result.ok {
        return SyncAuthHealth::Authorized;
    }

    // The status text is the only channel `fetch_tenant_plan` reports on.
    // A refused credential answers with the HTTP status; anything else is a
    // transport or parse failure that proves nothing about the credential.
    if result.status.contains("401") || result.status.contains("403") {
        SyncAuthHealth::Rejected
    } else {
        SyncAuthHealth::Unknown
    }
}

/// Ping the cloud server's `/health` endpoint to verify connectivity
/// (async — safe to call from Tauri async command handlers).
#[cfg(feature = "sync-http")]
pub async fn ping_server(url: &str) -> PingResult {
    let health_url = format!("{}/health", url.trim_end_matches('/'));
    let start = std::time::Instant::now();
    match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
    {
        Ok(client) => match client.get(&health_url).send().await {
            Ok(resp) => {
                // `try_from` rather than `as u64`: a health-check latency
                // cannot exceed u64 milliseconds, but saturating states that
                // explicitly and keeps the value monotone instead of wrapping
                // to ~0 on an absurd clock jump.
                let latency = u64::try_from(start.elapsed().as_millis()).unwrap_or(u64::MAX);
                if resp.status().is_success() {
                    PingResult {
                        ok: true,
                        status: format!("Connected ({latency}ms)"),
                        latency_ms: Some(latency),
                        auth: None,
                    }
                } else {
                    let status = resp.status();
                    PingResult {
                        ok: false,
                        status: format!("Server returned {status}"),
                        latency_ms: Some(latency),
                        auth: None,
                    }
                }
            }
            Err(e) => PingResult {
                ok: false,
                status: format!("Connection failed: {e}"),
                latency_ms: None,
                auth: None,
            },
        },
        Err(e) => PingResult {
            ok: false,
            status: format!("Failed to build HTTP client: {e}"),
            latency_ms: None,
            auth: None,
        },
    }
}

/** The full two-part sync answer: reachability *and* credential health.
 *
 * The status bar needs both halves and must not be given one dressed as the
 * other. `/health` is public, so a successful `ping_server` reports
 * reachability only; this adds the credential verdict from `probe_sync_auth`
 * on top, and is the single place both shells compose them — so desktop and
 * tablet cannot drift into different answers to the same question.
 *
 * When a stored key is present the credential question is always asked, even
 * if the ping failed: "the server is down" and "your credential is refused"
 * are different operator problems, and a transport failure should not
 * silently erase a rejection we could have seen.
 */
/// Whether the device should derive its sync URL from the attested origin.
///
/// The rule is the one the existing bootstrap already encoded, restated for a
/// release build: **only when nothing is configured**. A missing row or an
/// empty value is unconfigured; any real operator value wins forever, so
/// derivation can never overwrite a deliberate setting.
///
/// Deliberately does NOT consider the enabled flag or a retained API key. A
/// leftover key with no URL is still unconfigured (it is the state a wiped
/// settings row leaves behind), and the enabled flag is what derivation is
/// careful *not* to set.
pub fn should_derive_sync_url(configured_url: Option<&str>) -> bool {
    match configured_url {
        None => true,
        Some(url) => url.trim().is_empty(),
    }
}

/// Point this device at the origin it already resolved (ADR #55).
///
/// The unified deployment serves auth and sync from one host
/// (`apps/unified/Caddyfile`: `/api/v1/license/*` and `/api/sync/*` share a
/// port and certificate), and the device already resolves that host at boot
/// via the attestation cascade. So the sync endpoint needs no new setting, no
/// new transport, and no operator typing: it is a fact the device holds.
///
/// **What this deliberately does NOT do: enable sync, or invent a
/// credential.** `SyncConfig::from_settings` requires both `enabled` and a
/// non-empty URL, and sync still will not start after this write — the pill
/// will honestly read "Not configured" until `enabled` is set and a
/// credential arrives through the linking path. Writing `enabled = true` here
/// is the §4 trap: the status probe asks a *public* endpoint, so an install
/// with a URL but no working credential would draw a green dot while every
/// push 401'd. Storing the URL is safe precisely because it alone starts
/// nothing.
///
/// Returns `true` when a row was written. Idempotent: a second call with the
/// URL already stored writes nothing and reports `false`.
pub fn derive_sync_url_if_unset(
    conn: &rusqlite::Connection,
    origin: &str,
) -> Result<bool, CoreError> {
    if origin.trim().is_empty() {
        return Ok(false);
    }
    if !should_derive_sync_url(crate::settings::Settings::get_sync_server_url(conn)?.as_deref()) {
        return Ok(false);
    }
    crate::settings::Settings::set_sync_server_url(conn, origin.trim())?;
    tracing::info!(
        origin = %origin,
        "derived sync server URL from the attested server origin (sync left disabled)"
    );
    Ok(true)
}

/// The full two-part sync answer: reachability *and* credential health.
///
/// The status bar needs both halves and must not be given one dressed as the
/// other. `/health` is public, so a successful `ping_server` reports
/// reachability only; this adds the credential verdict from
/// `probe_sync_auth` on top, and is the single place both shells compose
/// them — so desktop and tablet cannot drift into different answers to the
/// same question.
///
/// When a stored key is present the credential question is always asked, even
/// if the ping failed: "the server is down" and "your credential is refused"
/// are different operator problems, and a transport failure should not
/// silently erase a rejection we could have seen.
pub async fn probe_sync_connection(url: &str, api_key: Option<&str>) -> PingResult {
    let mut ping = ping_server(url).await;
    if api_key.is_some_and(|k| !k.is_empty()) {
        ping.auth = Some(probe_sync_auth(url, api_key).await);
    }
    ping
}

/// Stub when sync-http is disabled.
#[cfg(not(feature = "sync-http"))]
pub async fn ping_server(_url: &str) -> PingResult {
    PingResult {
        ok: false,
        status: "sync-http feature is disabled".into(),
        latency_ms: None,
        auth: None,
    }
}

/// Stub when sync-http is disabled.
///
/// Answers `Unknown` and not `Rejected`: with the feature compiled out no
/// request was made, so no credential was refused. Reporting a rejection we
/// never observed would be the same class of invention this probe removes.
#[cfg(not(feature = "sync-http"))]
pub async fn probe_sync_auth(_url: &str, _api_key: Option<&str>) -> SyncAuthHealth {
    SyncAuthHealth::Unknown
}
