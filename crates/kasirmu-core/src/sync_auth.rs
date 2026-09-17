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
                                .as_ref()
                                .map(|e| format!("Token obtained — {}", format_expiry(e)))
                                .unwrap_or_else(|| "Token obtained".into()),
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
                let latency = start.elapsed().as_millis() as u64;
                if resp.status().is_success() {
                    PingResult {
                        ok: true,
                        status: format!("Connected ({latency}ms)"),
                        latency_ms: Some(latency),
                    }
                } else {
                    let status = resp.status();
                    PingResult {
                        ok: false,
                        status: format!("Server returned {status}"),
                        latency_ms: Some(latency),
                    }
                }
            }
            Err(e) => PingResult {
                ok: false,
                status: format!("Connection failed: {e}"),
                latency_ms: None,
            },
        },
        Err(e) => PingResult {
            ok: false,
            status: format!("Failed to build HTTP client: {e}"),
            latency_ms: None,
        },
    }
}

/// Stub when sync-http is disabled.
#[cfg(not(feature = "sync-http"))]
pub async fn ping_server(_url: &str) -> PingResult {
    PingResult {
        ok: false,
        status: "sync-http feature is disabled".into(),
        latency_ms: None,
    }
}
