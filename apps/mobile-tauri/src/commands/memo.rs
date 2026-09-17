//! Tauri commands for the Memo read/consumer path (Phase 2 P1).
//!
//! Tablet parity with the desktop `commands/memo.rs` consumption commands.
//! Memos live in the global identity database (tenant sentinel `default`),
//! the same database the tablet staff/terminals commands use.
//!
//! Only the consumer half is exposed here: `list_active_memos` and
//! `acknowledge_memo` are scoped to the caller's own terminal via the session
//! and require no extra permission — a staff member on a tablet must be able to
//! see and acknowledge memos addressed to their terminal. Authoring
//! (`create`/`publish`) is a manager/admin surface and is not wired to the
//! tablet shell yet; see the desktop module and the ipc-parity allowlist.

use chrono::Utc;
use kasirmu_core::Store;
use kasirmu_core::memo::{
    ActiveMemo, Memo, NOTIFICATION_BASE_INTERVAL_SECS, kds_notification_interval_secs,
};
use kasirmu_core::sync_client::{self, ActiveMemoCloud, SyncConfig};
use serde::Serialize;
use tauri::State;

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

/// Map a cloud-served memo into the display DTO. The cloud read is
/// claim-scoped (it echoes no tenant) and its query only returns
/// `published` rows, so those two DTO fields are filled from the read's
/// own invariants — the same values the local-read path derives.
impl From<ActiveMemoCloud> for ActiveMemoDto {
    fn from(m: ActiveMemoCloud) -> Self {
        Self {
            memo: MemoDto {
                id: m.id,
                tenant_id: DEFAULT_TENANT_ID.to_string(),
                location_ids: m.location_ids,
                author_user_id: m.author_user_id,
                author_role: m.author_role,
                title: m.title,
                body: m.body,
                status: kasirmu_core::memo::MemoStatus::Published
                    .as_str()
                    .to_string(),
                duration: m.duration,
                revision: m.revision,
                published_at: m.published_at,
                expires_at: m.expires_at,
                created_at: m.created_at,
            },
            delivery_status: m.delivery_status,
        }
    }
}

/// Display cadence served with the memo list. The backend is the single
/// source of truth for the notification intervals — the UI schedules its polls
/// from these values and never duplicates the literals (the spec's "coded as
/// 2× the shared base interval" lives in `kasirmu_core::memo`, not in TypeScript).
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

/// List the memos the caller's terminal should display, tier-stacked, plus
/// the server-issued display cadence. Authenticated-only: the recipient set
/// is already terminal-scoped.
///
/// Cloud-first (2026-09-07 cloud-read ruling): memos are authored on the
/// desktop and reach this tablet only through the cloud — the local
/// `memos` table is structurally empty on a terminal. When sync is
/// configured the read goes to `GET /api/v1/memos/active`; when sync is
/// unconfigured or unreachable it falls back to the local read (today's
/// behaviour, with a warn log).
#[tauri::command]
pub async fn list_active_memos_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<MemoDisplayDto, AppError> {
    let session = state.resolve_session(&session_token)?;

    // Scoped block: the connection guard must never be held across the
    // HTTP await below (it is not `Send`).
    let config = {
        let db = state.db.lock().await;
        let store = Store::new(&db);
        SyncConfig::from_settings(&store)?
    };

    if let Some(config) = config.as_ref() {
        match sync_client::fetch_active_memos_from_server(config, &session.terminal_id).await {
            Ok(response) => {
                return Ok(MemoDisplayDto {
                    memos: response
                        .memos
                        .into_iter()
                        .map(ActiveMemoDto::from)
                        .collect(),
                    cadence: MemoCadenceDto {
                        base_interval_secs: response.cadence.base_interval_secs,
                        kds_interval_secs: response.cadence.kds_interval_secs,
                    },
                });
            }
            Err(e) => {
                tracing::warn!(
                    error = %e,
                    terminal = %session.terminal_id,
                    "memo cloud read failed; falling back to local read"
                );
            }
        }
    }

    let now = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let db = state.db.lock().await;
    let store = Store::new(&db);
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
///
/// Cloud-first (2026-09-07 cloud-read ruling): the memo reached this
/// tablet through the cloud, so the durable ack flows back through it —
/// the local `memo_recipients` table is structurally empty on a
/// terminal, and the cloud merge keeps the ack alive against the
/// desktop's next (stale) push. When sync is unconfigured or the cloud
/// is unreachable the local write is the fallback. The ack carries the
/// session's user id as informational metadata (terminal tokens have no
/// user identity of their own).
#[tauri::command]
pub async fn acknowledge_memo_scoped(
    memo_id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let session = state.resolve_session(&session_token)?;

    // Scoped block: the connection guard must never be held across the
    // HTTP await below (it is not `Send`).
    let config = {
        let db = state.db.lock().await;
        let store = Store::new(&db);
        SyncConfig::from_settings(&store)?
    };

    if let Some(config) = config.as_ref() {
        match sync_client::ack_memo_on_server(config, &memo_id, Some(&session.user_id)).await {
            Ok(_) => return Ok(()),
            Err(e) => {
                tracing::warn!(
                    error = %e,
                    memo = %memo_id,
                    terminal = %session.terminal_id,
                    "memo ack through the cloud failed; falling back to local write"
                );
            }
        }
    }

    let db = state.db.lock().await;
    let store = Store::new(&db);
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
