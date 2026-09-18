//! Memo command bodies (Wave F) — the tauri-free half of
//! `apps/desktop-tauri/src/commands/memo.rs`.
//!
//! Memos are a tenant-level resource (Organization Memos span every location;
//! Location Memos target one), stored in the global identity database
//! alongside `locations` and `terminals` — the same database the Legal Entity
//! commands use. The staged tenant sentinel is `default`.
//!
//! Gate order is a verbatim port of the shell: resolve the session, enforce
//! the permission (`memo:write` for authoring, `memo:stop` for a non-author
//! early stop, none for the terminal-scoped consumption reads), then take the
//! global connection lock and read or write.
//!
//! Authorization split, deliberately:
//! - Authoring (`create`, `publish`, `revise`) requires `memo:write`.
//! - Consumption (`list_active`, `acknowledge`) is scoped to the caller's own
//!   terminal via the session and requires no extra permission.
//! - Early stop (`stop`) is the 2026-09-07 A2 ruling: the AUTHOR of the memo
//!   may always stop it; anyone else must hold `memo:stop`.

use chrono::Utc;
use kasirmu_core::memo::{
    ActiveMemo, Memo, MemoStatus, NOTIFICATION_BASE_INTERVAL_SECS, NewMemo,
    kds_notification_interval_secs,
};
use kasirmu_core::session::SessionContext;
use kasirmu_core::sync_client::ActiveMemoCloud;
use kasirmu_core::{CoreError, Store, Terminal, permissions};
use serde::{Deserialize, Serialize};

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

/// The staged tenant sentinel every memo command reads and writes against.
pub const DEFAULT_TENANT_ID: &str = "default";

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
/// claim-scoped (it echoes no tenant) and its query only returns `published`
/// rows, so those two DTO fields are filled from the read's own invariants —
/// the same values the local-read path derives.
///
/// Lives here rather than in the shell that performs the cloud read because
/// this DTO is defined here: a shell crate cannot implement a foreign trait for
/// two foreign types, and the wire shape must not fork into one DTO per shell.
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
                status: MemoStatus::Published.as_str().to_string(),
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
    /// Memo title (optional in the display contract — blank renders a
    /// text-only bubble, owner direction 2026-09-08).
    pub title: String,
    /// Memo body (must be non-blank — content is the memo).
    pub body: String,
    /// Display duration; defaults to `24h` when omitted.
    #[serde(default)]
    pub duration: Option<String>,
}

/// Arguments for revising a published memo.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviseMemoArgs {
    /// Corrected title (optional in the display contract; a correction may
    /// blank it).
    pub title: String,
    /// Corrected body (must be non-blank — content is the memo).
    pub body: String,
}

/// Create a memo draft as the authenticated author. Requires `memo:write`.
pub async fn create_memo_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: CreateMemoArgs,
) -> Result<MemoDto, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::MEMO_WRITE)
        .await?;
    let duration = match args.duration.as_deref() {
        Some(s) => s
            .parse()
            .map_err(|_| BridgeError::Invalid(format!("invalid memo duration '{s}'")))?,
        None => kasirmu_core::memo::DEFAULT_MEMO_DURATION,
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
    let conn = ctx.lock_global().await;
    let store = Store::new(&conn);
    Ok(MemoDto::from(store.create_memo_draft(&new)?))
}

/// The terminals the publishing store has registered, each with its location
/// binding — read from the database `register_terminal_scoped` writes them to.
///
/// The store connection is a `std::sync::Mutex`, so this is a synchronous read
/// and no guard is held across an await; the caller locks the global DB after it
/// returns.
///
/// A store database that does not exist means the store has no registered
/// terminals, and the answer is an empty list — deliberately not `open_store`,
/// which would CREATE the file as a side effect of publishing a memo. A store
/// database that exists but cannot be read is an error rather than an empty
/// list: publishing without it would under-deliver silently down to (and
/// possibly past) the zero-recipient refusal.
fn store_registered_terminals(
    ctx: &BridgeCtx<'_>,
    session: &SessionContext,
) -> Result<Vec<(Terminal, Option<String>)>, BridgeError> {
    if !ctx.db_manager.store_db_exists(&session.store_id) {
        return Ok(Vec::new());
    }
    let conn = ctx.db_manager.open_store(&session.store_id)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let mut registered = Vec::new();
    for terminal in store.list_terminals()? {
        let bound_location_id = store.get_terminal_bound_location(&terminal.id)?;
        registered.push((terminal, bound_location_id));
    }
    Ok(registered)
}

/// Publish a draft memo. Requires `memo:write`.
///
/// Terminal registration has two homes and the memo tables can only address one
/// of them: `register_terminal_scoped` writes the terminal into the per-store
/// database, while the MultiTerminal auto-register path (`set_features`) writes
/// it into the global identity DB where the memo tables live and where
/// `memo_recipients.terminal_id` carries an enforced FK to `terminals(id)`. So
/// before publishing, this store's registered terminals are made addressable in
/// the global table — otherwise a device registered through Settings → Terminals
/// fans out to nobody and the publish reports the success of a memo no terminal
/// can receive (see `Store::ensure_terminal_addressable`).
///
pub async fn publish_memo_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    memo_id: &str,
) -> Result<MemoDto, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::MEMO_WRITE)
        .await?;
    let store_terminals = store_registered_terminals(ctx, &session)?;
    let conn = ctx.lock_global().await;
    let store = Store::new(&conn);
    let mut mirrored = 0_usize;
    for (terminal, bound_location_id) in &store_terminals {
        if store.ensure_terminal_addressable(
            terminal,
            DEFAULT_TENANT_ID,
            bound_location_id.as_deref(),
        )? {
            mirrored += 1;
        }
    }
    if mirrored > 0 {
        tracing::info!(
            mirrored,
            store_id = %session.store_id,
            "memo publish: made this store's registered terminals addressable"
        );
    }
    Ok(MemoDto::from(
        store.publish_memo(DEFAULT_TENANT_ID, memo_id)?,
    ))
}

/// List the memos the caller's terminal should display, newest tier-stacked,
/// plus the server-issued display cadence. Authenticated-only: the recipient
/// set is already terminal-scoped.
pub async fn list_active_memos_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<MemoDisplayDto, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    list_active_memos_local(ctx, &session).await
}

/// The local half of the display read, for a shell that reaches memos by another
/// route first: the tablet's local `memos` table is structurally empty, so it
/// reads the cloud and only falls back to this. Taking an already-resolved
/// session is what lets that fallback reuse the device→row translation instead
/// of copying it.
pub async fn list_active_memos_local(
    ctx: &BridgeCtx<'_>,
    session: &SessionContext,
) -> Result<MemoDisplayDto, BridgeError> {
    let now = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let conn = ctx.lock_global().await;
    let store = Store::new(&conn);
    // Translate the session's DEVICE identity into the terminal ROW id the
    // recipient table keys on before reading (see
    // `Store::resolve_terminal_row_id`): the fan-out writes one
    // `memo_recipients` row per `terminals.id`, so querying the raw session
    // value would match nothing even for a device that has memos waiting.
    // An unresolved device demonstrably has no recipient rows — serve an empty
    // list (with the cadence, so the banner keeps polling) rather than erroring.
    let memos = match store.resolve_terminal_row_id(DEFAULT_TENANT_ID, &session.terminal_id)? {
        Some(terminal_id) => store
            .list_active_for_terminal(DEFAULT_TENANT_ID, &terminal_id, &now)?
            .into_iter()
            .map(ActiveMemoDto::from)
            .collect(),
        None => {
            tracing::debug!(
                device = %session.terminal_id,
                "memo read: this device has no terminal row, so it has no memos"
            );
            Vec::new()
        }
    };
    Ok(MemoDisplayDto {
        memos,
        cadence: MemoCadenceDto {
            base_interval_secs: NOTIFICATION_BASE_INTERVAL_SECS,
            kds_interval_secs: kds_notification_interval_secs(),
        },
    })
}

/// Acknowledge a memo on the caller's terminal. Authenticated-only.
pub async fn acknowledge_memo_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    memo_id: &str,
) -> Result<(), BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    acknowledge_memo_local(ctx, &session, memo_id).await
}

/// The local half of the ack, the counterpart of [`list_active_memos_local`]
/// for a shell whose durable ack first travels through the cloud.
pub async fn acknowledge_memo_local(
    ctx: &BridgeCtx<'_>,
    session: &SessionContext,
    memo_id: &str,
) -> Result<(), BridgeError> {
    let conn = ctx.lock_global().await;
    let store = Store::new(&conn);
    // The same device→row translation the display read performs, or the ack
    // would target a recipient row that cannot exist. An unresolved device has
    // nothing to acknowledge: report the store's own unknown-recipient error
    // instead of succeeding silently, because the caller drops the memo from
    // view optimistically and would never learn the ack never landed.
    let terminal_id = store
        .resolve_terminal_row_id(DEFAULT_TENANT_ID, &session.terminal_id)?
        .ok_or_else(|| CoreError::NotFound {
            entity: "memo_recipient",
            id: format!("{memo_id}/{}", session.terminal_id),
        })?;
    store.acknowledge_memo(DEFAULT_TENANT_ID, memo_id, &terminal_id, &session.user_id)?;
    Ok(())
}

/// List every memo authored by the session user, newest first — the
/// management read behind the authoring screen. Requires `memo:write`; the
/// store deliberately filters on authorship rather than org-wide authority
/// (a "manage all Memos" view waits for Phase 1 scoped authorization).
pub async fn list_authored_memos_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<Vec<MemoDto>, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::MEMO_WRITE)
        .await?;
    let conn = ctx.lock_global().await;
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
pub async fn stop_memo_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    memo_id: &str,
) -> Result<MemoDto, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    // Scope-checked read first so the author comparison below runs on the
    // tenant's own row. The lock guard and the `Store` borrow are dropped
    // BEFORE the permission gate, which re-locks the global connection —
    // holding the mutex (a `RefCell`-backed rusqlite connection) across that
    // `.await` would make the command future non-`Send`.
    let is_author = {
        let conn = ctx.lock_global().await;
        let store = Store::new(&conn);
        let memo = store
            .get_memo(DEFAULT_TENANT_ID, memo_id)?
            .ok_or_else(|| BridgeError::Invalid(format!("memo not found: {memo_id}")))?;
        memo.author_user_id == session.user_id
    };
    if !is_author {
        ctx.require_session_permission(&session, permissions::MEMO_STOP)
            .await?;
    }
    let conn = ctx.lock_global().await;
    let store = Store::new(&conn);
    Ok(MemoDto::from(store.stop_memo(
        DEFAULT_TENANT_ID,
        memo_id,
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
pub async fn revise_memo_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    memo_id: &str,
    args: ReviseMemoArgs,
) -> Result<MemoDto, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::MEMO_WRITE)
        .await?;
    let conn = ctx.lock_global().await;
    let store = Store::new(&conn);
    Ok(MemoDto::from(store.revise_memo(
        DEFAULT_TENANT_ID,
        memo_id,
        &session.user_id,
        &args.title,
        &args.body,
    )?))
}

#[cfg(test)]
#[path = "memo_tests.rs"]
mod tests;
