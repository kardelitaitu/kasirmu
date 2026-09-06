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
//! - Early stop (`stop`) is the 2026-09-07 A2 ruling: the AUTHOR of the memo
//!   may always stop it; anyone else must hold `memo:stop` (Owner/Admin
//!   presets; custom roles deny by default). "Higher role" is a registry
//!   grant, not a rank map — the rank-based `may_stop` helper was deleted
//!   with its tests when this ruling landed.

use chrono::Utc;
use oz_core::memo::{
    ActiveMemo, Memo, NOTIFICATION_BASE_INTERVAL_SECS, NewMemo, kds_notification_interval_secs,
};
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
    /// Locations the memo targets (wire: `locationIds`); empty ⇒ Organization
    /// Memo (organization-wide audience), non-empty ⇒ Location Memo for
    /// exactly those locations.
    pub location_ids: Vec<String>,
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
            location_ids: m.location_ids,
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

/// Display cadence served with the memo list. The backend is the single
/// source of truth for the notification intervals — the UI schedules its polls
/// from these values and never duplicates the literals (the spec's "coded as
/// 2× the shared base interval" lives in `oz_core::memo`, not in TypeScript).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoCadenceDto {
    /// Base notification interval in seconds (all non-KDS surfaces).
    pub base_interval_secs: i64,
    /// KDS interval in seconds — derived as 2 × base, never tuned separately.
    pub kds_interval_secs: i64,
}

/// Response envelope for the memo display read: the memos this terminal
/// should display plus the cadence to poll them on.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoDisplayDto {
    /// Memos this terminal should display (Location stacked above Organization).
    pub memos: Vec<ActiveMemoDto>,
    /// The server-issued poll cadence.
    pub cadence: MemoCadenceDto,
}

/// Arguments for creating a memo draft.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateMemoArgs {
    /// Targeted location ids; empty/omitted ⇒ Organization Memo (the empty
    /// set is the organization-wide audience). One or more ⇒ the memo targets
    /// exactly those locations. Duplicates and whitespace-only entries are
    /// normalized away by the store.
    #[serde(default)]
    pub location_ids: Vec<String>,
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
        location_ids: args.location_ids,
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

/// List the memos the caller's terminal should display, newest tier-stacked,
/// plus the server-issued display cadence. Authenticated-only: the recipient
/// set is already terminal-scoped.
#[tauri::command]
pub async fn list_active_memos_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<MemoDisplayDto, AppError> {
    let session = state.resolve_session(&session_token)?;
    let now = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let conn = state.db.lock().await;
    let store = Store::new(&conn);
    let memos = store
        .list_active_for_terminal(DEFAULT_TENANT_ID, &session.terminal_id, &now)?
        .into_iter()
        .map(ActiveMemoDto::from)
        .collect();
    Ok(MemoDisplayDto {
        memos,
        cadence: MemoCadenceDto {
            base_interval_secs: NOTIFICATION_BASE_INTERVAL_SECS,
            kds_interval_secs: kds_notification_interval_secs(),
        },
    })
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

/// List every memo authored by the session user, newest first — the
/// management read behind the authoring screen. Requires `memo:write`; the
/// store deliberately filters on authorship rather than org-wide authority
/// (a "manage all Memos" view waits for Phase 1 scoped authorization).
#[tauri::command]
pub async fn list_authored_memos_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<MemoDto>, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::MEMO_WRITE).await?;
    let conn = state.db.lock().await;
    let store = Store::new(&conn);
    Ok(store
        .list_memos_authored_by(DEFAULT_TENANT_ID, &session.user_id)?
        .into_iter()
        .map(MemoDto::from)
        .collect())
}

/// Early-stop a published memo (`published → stopped`): it leaves every
/// display surface immediately and `stopped_by` records who ended it.
///
/// Authorization is the 2026-09-07 A2 ruling, enforced here rather than in
/// the store: the memo's AUTHOR may always stop their own (a manager author
/// keeps that right even without the new key); any other actor must hold
/// `memo:stop` (Owner/Admin presets — a peer manager cannot stop another
/// manager's memo, the property the old strict-`>` rank rule pinned). The
/// gate is evaluated against the global identity DB like every other
/// permission check, so a tampered client cannot forge the author match —
/// `author_user_id` comes from the memo row, the actor from the session.
#[tauri::command]
pub async fn stop_memo_scoped(
    memo_id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<MemoDto, AppError> {
    let session = state.resolve_session(&session_token)?;
    // Scope-checked read first so the author comparison below runs on the
    // tenant's own row. The lock guard and the `Store` borrow are dropped
    // BEFORE the permission gate, which re-locks `state.db` — holding the
    // mutex (a `RefCell`-backed rusqlite connection) across that `.await`
    // would make the command future non-`Send`.
    let is_author = {
        let conn = state.db.lock().await;
        let store = Store::new(&conn);
        let memo = store
            .get_memo(DEFAULT_TENANT_ID, &memo_id)?
            .ok_or_else(|| AppError::Invalid(format!("memo not found: {memo_id}")))?;
        memo.author_user_id == session.user_id
    };
    if !is_author {
        require_permission_for_session(&state, &session, permissions::MEMO_STOP).await?;
    }
    let conn = state.db.lock().await;
    let store = Store::new(&conn);
    Ok(MemoDto::from(store.stop_memo(
        DEFAULT_TENANT_ID,
        &memo_id,
        &session.user_id,
    )?))
}

/// Revise a published memo (the spec's "corrections create a new revision"):
/// inserts a NEW immutable `memo_revisions` row and bumps `memos.revision`;
/// prior revisions and the memo's lifetime are never touched. Requires
/// `memo:write` — matching authoring, since a correction is authorship of
/// new content (ruled in scope 2026-09-07; the store's TOCTOU guard rejects
/// a memo the expiry sweep ended mid-transaction). Non-blank validation
/// mirrors the create path.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviseMemoArgs {
    /// Corrected title (non-blank).
    pub title: String,
    /// Corrected body (non-blank).
    pub body: String,
}

#[tauri::command]
pub async fn revise_memo_scoped(
    memo_id: String,
    args: ReviseMemoArgs,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<MemoDto, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::MEMO_WRITE).await?;
    let conn = state.db.lock().await;
    let store = Store::new(&conn);
    Ok(MemoDto::from(store.revise_memo(
        DEFAULT_TENANT_ID,
        &memo_id,
        &session.user_id,
        &args.title,
        &args.body,
    )?))
}

#[cfg(test)]
#[path = "memo_tests.rs"]
mod tests;
