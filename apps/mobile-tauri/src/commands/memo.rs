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
//!
//! What is tablet-specific here is the ROUTE, not the rules: memos are authored
//! on a desktop and reach this shell through the cloud, so both commands try
//! `sync_client` first and fall back to the local read when sync is
//! unconfigured or unreachable. Everything else — the DTOs, the display cadence
//! and both local halves, including the device→terminal-row translation that
//! makes the recipient rows match — is the bridge's (`kasirmu_bridge::memo`), so
//! the wire shape and the resolution rule each have exactly one home.

use kasirmu_core::Store;
use kasirmu_core::sync_client::{self, SyncConfig};
use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

pub use kasirmu_bridge::memo::{
    ActiveMemoDto, DEFAULT_TENANT_ID, MemoCadenceDto, MemoDisplayDto, MemoDto,
};

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

    let ctx = state.bridge_ctx();
    kasirmu_bridge::memo::list_active_memos_local(&ctx, &session)
        .await
        .map_err(Into::into)
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

    let ctx = state.bridge_ctx();
    kasirmu_bridge::memo::acknowledge_memo_local(&ctx, &session, &memo_id)
        .await
        .map_err(Into::into)
}

#[cfg(test)]
#[path = "memo_tests.rs"]
mod tests;
