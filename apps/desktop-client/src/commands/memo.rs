//! Tauri commands for the Memo lifecycle (Phase 2 P1).
//!
//! Memos are a tenant-level resource (Organization Memos span every location;
//! Location Memos target one), stored in the global identity database alongside
//! `locations` and `terminals` — the same database the Legal Entity commands
//! use. The staged tenant sentinel is `default`; future tenant claims can
//! supply the resolved tenant without changing these DTOs.
//!
//! Authorization split, deliberately:
//! - Authoring (`create`, `publish`) requires `memo:write`.
//! - Consumption (`list_active`, `acknowledge`) is scoped to the caller's own
//!   terminal via the session and requires no extra permission — a staff member
//!   must be able to see and acknowledge memos addressed to their terminal, and
//!   the recipient set is already terminal-scoped by the store's fan-out.
//! - `stop` is intentionally NOT exposed yet: the spec's "early stop by author
//!   or higher role" needs a role→rank ordering, and the presence of custom
//!   roles (`role-custom`) makes "higher" ambiguous. That is a design decision
//!   to make deliberately, not a gap to paper over with an arbitrary rank map.

use chrono::Utc;
use oz_core::memo::{ActiveMemo, Memo, NewMemo};
use oz_core::{Store, permissions};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::commands::authz::require_permission_for_session;
use crate::error::AppError;
use crate::state::AppState;

const DEFAULT_TENANT_ID: &str = "default";

/// JSON representation of a memo returned to the front-end.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoDto {
    /// Stable memo identifier.
    pub id: String,
    /// Organization/Tenant owner.
    pub tenant_id: String,
    /// `null` ⇒ Organization Memo; a value ⇒ Location Memo for that location.
    pub location_id: Option<String>,
    /// Author's user id.
    pub author_user_id: String,
    /// Author's role snapshot at publish time.
    pub author_role: String,
    /// Memo title.
    pub title: String,
    /// Memo body.
    pub body: String,
    /// Lifecycle status (`draft`/`published`/`expired`/`stopped`/`archived`).
    pub status: String,
    /// Display duration (`12h`/`24h`/`3d`/`7d`/`30d`).
    pub duration: String,
    /// Current published revision.
    pub revision: i64,
    /// ISO-8601 publish instant, if published.
    pub published_at: Option<String>,
    /// ISO-8601 expiry instant, if published.
    pub expires_at: Option<String>,
    /// ISO-8601 creation timestamp.
    pub created_at: String,
}

impl From<Memo> for MemoDto {
    fn from(m: Memo) -> Self {
        Self {
            id: m.id,
            tenant_id: m.tenant_id,
            location_id: m.location_id,
            author_user_id: m.author_user_id,
            author_role: m.author_role,
            title: m.title,
            body: m.body,
            status: m.status.as_str().to_string(),
            duration: m.duration.as_str().to_string(),
            revision: m.revision,
            published_at: m.published_at,
            expires_at: m.expires_at,
            created_at: m.created_at,
        }
    }
}

/// A memo plus this terminal's delivery state.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveMemoDto {
    /// The memo.
    pub memo: MemoDto,
    /// This terminal's delivery/acknowledgement state.
    pub delivery_status: String,
}

impl From<ActiveMemo> for ActiveMemoDto {
    fn from(a: ActiveMemo) -> Self {
        Self {
            memo: MemoDto::from(a.memo),
            delivery_status: a.delivery_status.as_str().to_string(),
        }
    }
}

/// Arguments for creating a memo draft.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateMemoArgs {
    /// `null`/omitted ⇒ Organization Memo; a location id ⇒ Location Memo.
    pub location_id: Option<String>,
    /// Memo title (non-blank).
    pub title: String,
    /// Memo body (non-blank).
    pub body: String,
    /// Display duration; defaults to `24h` when omitted.
    #[serde(default)]
    pub duration: Option<String>,
}

/// Create a memo draft as the authenticated author. Requires `memo:write`.
#[tauri::command]
pub async fn create_memo_scoped(
    args: CreateMemoArgs,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<MemoDto, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::MEMO_WRITE).await?;
    let duration = match args.duration.as_deref() {
        Some(s) => s
            .parse()
            .map_err(|_| AppError::Invalid(format!("invalid memo duration '{s}'")))?,
        None => oz_core::memo::DEFAULT_MEMO_DURATION,
    };
    let new = NewMemo {
        tenant_id: DEFAULT_TENANT_ID.into(),
        location_id: args.location_id,
        author_user_id: session.user_id,
        author_role: session.role_id,
        title: args.title,
        body: args.body,
        duration,
    };
    let conn = state.db.lock().await;
    let store = Store::new(&conn);
    Ok(MemoDto::from(store.create_memo_draft(&new)?))
}

/// Publish a draft memo. Requires `memo:write`.
#[tauri::command]
pub async fn publish_memo_scoped(
    memo_id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<MemoDto, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::MEMO_WRITE).await?;
    let conn = state.db.lock().await;
    let store = Store::new(&conn);
    Ok(MemoDto::from(
        store.publish_memo(DEFAULT_TENANT_ID, &memo_id)?,
    ))
}

/// List the memos the caller's terminal should display, newest tier-stacked.
/// Authenticated-only: the recipient set is already terminal-scoped.
#[tauri::command]
pub async fn list_active_memos_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<ActiveMemoDto>, AppError> {
    let session = state.resolve_session(&session_token)?;
    let now = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let conn = state.db.lock().await;
    let store = Store::new(&conn);
    Ok(store
        .list_active_for_terminal(DEFAULT_TENANT_ID, &session.terminal_id, &now)?
        .into_iter()
        .map(ActiveMemoDto::from)
        .collect())
}

/// Acknowledge a memo on the caller's terminal. Authenticated-only.
#[tauri::command]
pub async fn acknowledge_memo_scoped(
    memo_id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let session = state.resolve_session(&session_token)?;
    let conn = state.db.lock().await;
    let store = Store::new(&conn);
    store.acknowledge_memo(
        DEFAULT_TENANT_ID,
        &memo_id,
        &session.terminal_id,
        &session.user_id,
    )?;
    Ok(())
}

#[cfg(test)]
#[path = "memo_tests.rs"]
mod tests;
