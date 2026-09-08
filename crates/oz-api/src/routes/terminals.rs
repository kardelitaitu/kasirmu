//! Terminal registration endpoint (ADR sync-auth-hardening P3).
//!
//! `POST /api/v1/terminals` — register a sync terminal and receive a
//! high-entropy device secret. Only the SHA-256 hash of the secret is
//! stored; the plaintext is returned exactly once. The terminal then mints
//! short-lived API tokens with its credentials (client-credentials style).
//!
//! Gated by the same `OZ_ADMIN_KEY` as token minting: when the admin key is
//! configured, the `X-Admin-Key` header must match. In dev mode (no admin
//! key) registration is open so local auto-provisioning can pair devices
//! without extra configuration.

use axum::{
    Json,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::AppState;
use crate::routes::tokens::admin_key_authorised;

/// Request body for registering a sync terminal.
#[derive(Deserialize)]
pub struct RegisterTerminalRequest {
    /// Stable terminal identifier (matches the POS `terminal_id`).
    pub terminal_id: String,
    /// Human-readable label, e.g. "Front counter".
    pub label: Option<String>,
    /// Optional tenant / store ID for multi-tenant isolation.
    pub tenant_id: Option<String>,
}

/// Response body containing the newly issued device secret.
#[derive(Serialize)]
pub struct RegisterTerminalResponse {
    /// Terminal identifier (echoed back).
    pub terminal_id: String,
    /// Plaintext device secret — shown exactly once, never retrievable
    /// again. Store it in the terminal's local settings.
    pub device_secret: String,
}

/// A registered terminal resolved from valid client credentials.
#[derive(Debug, Clone)]
pub struct RegisteredTerminal {
    /// Terminal identifier.
    pub terminal_id: String,
    /// Tenant the terminal belongs to (optional).
    pub tenant_id: Option<String>,
}

/// SHA-256 hex digest of a device secret. Digests are what the server
/// stores and compares — the plaintext secret is never persisted.
pub fn hash_secret(secret: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(secret.as_bytes());
    hex::encode(hasher.finalize())
}

/// Generate a new high-entropy device secret (UUID v4, no dashes).
fn generate_device_secret() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

/// Resolve a terminal from presented client credentials, or `None` when
/// the id is unknown or the secret does not match.
pub fn verify_terminal_credentials(
    conn: &rusqlite::Connection,
    client_id: &str,
    client_secret: &str,
) -> Result<Option<RegisteredTerminal>, rusqlite::Error> {
    let digest = hash_secret(client_secret);
    let row = conn.query_row(
        "SELECT terminal_id, tenant_id
         FROM sync_terminals
         WHERE terminal_id = ?1 AND secret_hash = ?2",
        rusqlite::params![client_id, digest],
        |r| {
            Ok(RegisteredTerminal {
                terminal_id: r.get(0)?,
                tenant_id: r.get(1)?,
            })
        },
    );
    match row {
        Ok(terminal) => Ok(Some(terminal)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}

/// `POST /api/v1/terminals` — register a sync terminal.
///
/// Re-registering an existing `terminal_id` rotates its secret (old
/// credentials immediately stop working). Returns 400 for a blank id and
/// 401 when an admin key is configured but missing/mismatched.
pub async fn register_terminal_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<RegisterTerminalRequest>,
) -> impl IntoResponse {
    if !admin_key_authorised(&headers, state.admin_key.as_deref()) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error": "invalid_admin_key"})),
        )
            .into_response();
    }

    let terminal_id = body.terminal_id.trim().to_owned();
    if terminal_id.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "terminal_id is required"})),
        )
            .into_response();
    }
    // Bound terminal_id (≤64, `[A-Za-z0-9_-]`) so an admin-minted token
    // can never propagate arbitrary bytes into the store or a query path.
    if terminal_id.len() > 64
        || !terminal_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "invalid_terminal_id"})),
        )
            .into_response();
    }
    let label = body.label.unwrap_or_default();
    if label.len() > 128 {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "terminal label too long (max 128)"})),
        )
            .into_response();
    }
    if let Some(tenant) = body.tenant_id.as_deref() {
        if tenant.trim().is_empty()
            || tenant.len() > 64
            || !tenant
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": "invalid_tenant", "tenant": tenant})),
            )
                .into_response();
        }
    }

    let device_secret = generate_device_secret();
    let secret_hash = hash_secret(&device_secret);

    if let Some(pool) = &state.pg {
        return match crate::pg::register_terminal(
            pool,
            &terminal_id,
            &secret_hash,
            &label,
            body.tenant_id.as_deref(),
        )
        .await
        {
            Ok(()) => {
                tracing::info!(terminal_id, "registered sync terminal");
                Json(RegisterTerminalResponse {
                    terminal_id,
                    device_secret,
                })
                .into_response()
            }
            Err(e) => {
                tracing::error!(error = %e, "registering sync terminal failed");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({"error": "terminal registration failed"})),
                )
                    .into_response()
            }
        };
    }

    let db = state.db.lock().await;
    let result = db.execute(
        "INSERT INTO sync_terminals (terminal_id, secret_hash, label, tenant_id)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(terminal_id) DO UPDATE SET
            secret_hash = excluded.secret_hash,
            label = excluded.label,
            tenant_id = excluded.tenant_id",
        rusqlite::params![terminal_id, secret_hash, label, body.tenant_id],
    );

    match result {
        Ok(_) => {
            tracing::info!(terminal_id, "registered sync terminal");
            Json(RegisterTerminalResponse {
                terminal_id,
                device_secret,
            })
            .into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "registering sync terminal failed");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "terminal registration failed"})),
            )
                .into_response()
        }
    }
}

#[cfg(test)]
#[path = "terminals_tests.rs"]
mod tests;
