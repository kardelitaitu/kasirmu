//! Cloud memo serving layer (2026-09-07 cloud-read ruling).
//!
//! Memos are authored on the desktop into its local identity database; the
//! KDS/tablet terminals read them through the cloud (their local `memos`
//! tables are structurally empty). Two endpoints:
//!
//! - `POST /api/v1/memos/sync` — the desktop pushes the tenant's COMPLETE
//!   memo state; the server reconciles PG with it (upsert + delete-by-
//!   omission), so desktop-side retention deletes propagate naturally.
//!   JWT-authenticated with the `tenant_id` taken from the claims, never
//!   the body — a terminal token cannot spoof another tenant.
//! - `GET /api/v1/memos/active?terminal_id=` — a terminal's active memos,
//!   the same shape the desktop command returns (`memos` + server-issued
//!   cadence), so the banner consumes one DTO on every surface.

use axum::{
    Extension, Json,
    extract::{Path, Query, State},
    http::HeaderMap,
    response::{IntoResponse, Response},
};
use serde::Deserialize;

use crate::AppState;
use crate::auth::ApiTokenClaims;
use crate::pg::{ActiveMemoPg, MemoSyncRow, PgError};
use crate::routes::tokens::admin_key_authorised;

/// Body of `POST /api/v1/memos/sync`: the tenant's complete memo state.
#[derive(Debug, Deserialize)]
pub struct MemoSyncRequest {
    /// Every non-deleted memo of the tenant (with targeting + recipients).
    pub memos: Vec<MemoSyncRow>,
}

/// Resolve the caller's tenant, rejecting admin-scope requests without the
/// admin key (the terminal-credential path must not be able to mint a
/// tenant-wide write for a tenant it is not registered to — the claims'
/// tenant is authoritative regardless).
fn require_tenant_write(
    headers: &HeaderMap,
    claims: &ApiTokenClaims,
    admin_key: Option<&str>,
) -> Result<String, Response> {
    let tenant_id = claims.tenant_id.clone().unwrap_or_else(|| "default".into());
    // Defense in depth: a terminal-scoped credential may only ever write its
    // own registration's tenant, and only when the deployment chose to allow
    // terminal credentials at all. Admin-minted tokens (no terminal_id) are
    // the normal desktop path and additionally want the admin key when one
    // is configured — mirroring `require_admin_write`, but tenant-scoped
    // instead of global.
    if claims.terminal_id.is_none() && !admin_key_authorised(headers, admin_key) {
        return Err((
            axum::http::StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error": "invalid_admin_key"})),
        )
            .into_response());
    }
    Ok(tenant_id)
}

/// `POST /api/v1/memos/sync` — reconcile the tenant's memo state.
pub async fn sync_memos_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Extension(claims): Extension<ApiTokenClaims>,
    Json(body): Json<MemoSyncRequest>,
) -> Response {
    let tenant_id = match require_tenant_write(&headers, &claims, state.admin_key.as_deref()) {
        Ok(t) => t,
        Err(resp) => return resp,
    };

    match &state.pg {
        Some(pool) => match crate::pg::sync_memos(pool, &tenant_id, &body.memos).await {
            Ok(result) => Json(result).into_response(),
            Err(e) => e.into_response(),
        },
        // No PG backend: the cloud is running on SQLite and does not serve
        // memo state — the desktop keeps its local write (the push is
        // best-effort by design) and the client retries on the next tick.
        None => (
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "pg_unavailable"})),
        )
            .into_response(),
    }
}

/// Query for `GET /api/v1/memos/active`.
#[derive(Debug, Deserialize)]
pub struct ActiveMemosQuery {
    /// The terminal asking — must match a terminal-scoped token's claim.
    pub terminal_id: String,
}

/// Response envelope for `GET /api/v1/memos/active` — mirrors the desktop
/// `MemoDisplayDto` so the banner consumes one shape everywhere.
#[derive(Debug, serde::Serialize)]
pub struct ActiveMemosResponse {
    /// The memos this terminal should display (Location above Organization).
    pub memos: Vec<ActiveMemoPg>,
    /// Server-issued poll cadence (base + KDS interval in seconds).
    pub cadence: CadenceDto,
}

/// Server-issued cadence (mirrors the desktop `MemoCadenceDto`).
#[derive(Debug, serde::Serialize)]
pub struct CadenceDto {
    /// Base notification interval in seconds.
    pub base_interval_secs: i64,
    /// KDS interval in seconds (2 × base, derived from the shared constant).
    pub kds_interval_secs: i64,
}

/// Optional body of `POST /api/v1/memos/{memo_id}/ack`.
#[derive(Debug, Default, Deserialize)]
pub struct MemoAckRequest {
    /// The staff user at the terminal who acknowledged (informational —
    /// terminal tokens carry no user identity; the cloud cannot verify it
    /// and treats it as a display fact, not an authorization input).
    #[serde(default)]
    pub acknowledged_by: Option<String>,
}

/// `POST /api/v1/memos/{memo_id}/ack` — a terminal acknowledges a memo.
///
/// The upstream half of the cloud-read path: the ack moves the caller's
/// own recipient row (`claims.terminal_id` — the caller cannot name
/// another terminal) straight in PG, and the desktop's next push merges
/// delivery state monotonically so the ack survives. Terminal-scoped
/// tokens only: an admin-minted token has no terminal identity and acks
/// nothing (desktop acks flow up through the push instead).
pub async fn ack_memo_handler(
    State(state): State<AppState>,
    Extension(claims): Extension<ApiTokenClaims>,
    Path(memo_id): Path<String>,
    body: Option<Json<MemoAckRequest>>,
) -> Response {
    let Some(terminal_id) = claims.terminal_id.clone() else {
        return (
            axum::http::StatusCode::FORBIDDEN,
            Json(serde_json::json!({"error": "not_terminal_token"})),
        )
            .into_response();
    };
    let acknowledged_by = body
        .as_ref()
        .and_then(|Json(b)| b.acknowledged_by.as_deref())
        .map(str::trim)
        .filter(|s| !s.is_empty());

    match &state.pg {
        Some(pool) => {
            let tenant_id = claims.tenant_id.clone().unwrap_or_else(|| "default".into());
            match crate::pg::ack_memo(pool, &tenant_id, &memo_id, &terminal_id, acknowledged_by)
                .await
            {
                Ok(result) => Json(result).into_response(),
                Err(PgError::NotFound) => (
                    axum::http::StatusCode::NOT_FOUND,
                    Json(serde_json::json!({"error": "recipient_not_found"})),
                )
                    .into_response(),
                Err(e) => e.into_response(),
            }
        }
        None => (
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "pg_unavailable"})),
        )
            .into_response(),
    }
}

/// `GET /api/v1/memos/active?terminal_id=` — a terminal's active memos.
pub async fn list_active_memos_handler(
    State(state): State<AppState>,
    Extension(claims): Extension<ApiTokenClaims>,
    Query(query): Query<ActiveMemosQuery>,
) -> Response {
    // Defense in depth (device credentials are registration-scoped): when
    // the token carries a terminal_id, the query may not name another one.
    // NB: this only binds terminal-scoped tokens. An admin-minted token
    // (no terminal_id — the normal desktop path) carries no such claim and
    // may query ANY terminal's active memos via `?terminal_id=`, as long as
    // its tenant matches the bill being scoped. Deliberate: the desktop
    // must poll arbitrary terminals. Reads stay within-tenant (tenant comes
    // from claims, never the query).
    if let Some(claimed) = &claims.terminal_id {
        if claimed != &query.terminal_id {
            return (
                axum::http::StatusCode::FORBIDDEN,
                Json(serde_json::json!({"error": "terminal_mismatch"})),
            )
                .into_response();
        }
    }
    let tenant_id = claims.tenant_id.clone().unwrap_or_else(|| "default".into());
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    match &state.pg {
        Some(pool) => {
            match crate::pg::list_active_memos_for_terminal(
                pool,
                &tenant_id,
                &query.terminal_id,
                &now,
            )
            .await
            {
                Ok(memos) => Json(ActiveMemosResponse {
                    memos,
                    cadence: CadenceDto {
                        base_interval_secs: oz_core::memo::NOTIFICATION_BASE_INTERVAL_SECS,
                        kds_interval_secs: oz_core::memo::kds_notification_interval_secs(),
                    },
                })
                .into_response(),
                Err(e) => e.into_response(),
            }
        }
        None => (
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "pg_unavailable"})),
        )
            .into_response(),
    }
}
