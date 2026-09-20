//! Export and import commands — the tablet half of the desktop's `data.rs`.
//!
//! ## Why this module exists (b-full Phase 3, 2026-09-20)
//!
//! `ui/src/features/settings/` renders the same Data Management surface on both
//! shells, and `ui/src/api/data.ts` invokes `export_data`, `import_preview` and
//! `import_data` from it. Until this module existed the tablet had **nothing
//! registered** to answer them, so every export and every import failed as
//! "command not found" — the same silent shape as the avatar read gap that
//! `commands/avatars.rs` closed, and invisible to the registration ratchet for
//! the same reason: `run_sweep()` only walks the names this shell *already*
//! registers, so an unregistered command produces no row and no ledger entry.
//!
//! ## What crosses the IPC boundary, and what does not
//!
//! The picked file arrives as a **path**, never as bytes. On Android that path
//! is a copy inside the app cache, made by `ui/src/api/file-bridge.ts` from the
//! `content://` URI the Storage Access Framework returned — `tokio::fs` cannot
//! open a URI, so the crossing is done in JS on purpose and this module sees only
//! the ordinary path it already handled on desktop. Export is the mirror image:
//! `export_data` writes to a cache path and the UI walks those bytes out to the
//! user's URI afterwards.
//!
//! ## ADR #49
//!
//! Each body is the bridge's. These shims borrow a `BridgeCtx` from `AppState`
//! and map `BridgeError` back to `AppError`; they hold no SQL, no gate and no
//! lock, and the gate kind and order stay the bridge's, exactly as on desktop.
//!
//! Classification, measured rather than assumed:
//! `crates/kasirmu-bridge/src/data.rs` names `permissions::DATA_EXPORT` (`:797`,
//! `:812`) and `kasirmu_core::permissions::SETTINGS_EDIT` (`:375`, `:530`,
//! `:559`), so its file stem is in `gated_bridge_stems()` and a shim whose text
//! names `kasirmu_bridge::data` therefore reads `Gated` — all three doors are
//! ledger-neutral and add no debt row.
//!
//! ## Deliberately absent: the status pair, present: the backup-to-destination twin
//!
//! `get_backup_status` / `get_backup_status_scoped` are **not** here — status read
//! has no destination concern, so the desktop's pair stays the tablet's source of
//! truth and the panel's mount fetch still calls them (silently no-op on the tablet,
//! exactly as before this module existed; see `useBackupStatus.ts`).
//!
//! `create_backup` / `create_backup_scoped` are also **not** here: they take no
//! destination — `create_backup(db_path)` — so they write wherever the shell's own
//! `default_backup_path` lands, which on Android is inside the app's private storage
//! with no way for the operator to reach it. That is why the tablet got its own
//! command instead of a contract change to the desktop's: [`create_backup_to`] takes
//! the cache path the UI bridged from the save dialog's `content://` URI and writes
//! there, then the UI walks the bytes out — the same two-leg cross as `export_data`
//! (see `todo-tablet-dialog-content-uri.md` §3.3). The owner chose the tablet-only
//! variant so the desktop's `create_backup` / `get_backup_status` stay untouched.

use tauri::{State, command};

use crate::error::AppError;
use crate::state::AppState;

pub use kasirmu_bridge::data::{
    ExportDataArgs, ExportDataResult, ImportDataArgs, ImportDataResult, ImportPreviewArgs,
    ImportPreviewResult,
};

// ── Command: export ─────────────────────────────────────────────

/// Export data to an encrypted `.kasirpkg`.
///
/// `args.output_path` is where the package is written. On Android the UI passes
/// a path inside the app cache and moves the bytes to the operator's chosen URI
/// once this returns; the Rust side never sees the URI.
#[command]
pub async fn export_data(
    session_token: String,
    args: ExportDataArgs,
    state: State<'_, AppState>,
) -> Result<ExportDataResult, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::data::export_data(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

// ── Command: import preview ─────────────────────────────────────

/// Read an `.kasirpkg` far enough to describe it, without writing anything.
///
/// The wizard shows this before it asks the operator to confirm, which is why it
/// is a separate door from [`import_data`] rather than a flag on it.
#[command]
pub async fn import_preview(
    session_token: String,
    args: ImportPreviewArgs,
    state: State<'_, AppState>,
) -> Result<ImportPreviewResult, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::data::import_preview(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

// ── Command: import ─────────────────────────────────────────────

/// Import data from an encrypted `.kasirpkg`.
///
/// Reads the same file [`import_preview`] described. On Android that file is the
/// cache copy made when it was picked, which is why nothing here removes it —
/// see the note in `ui/src/api/data.ts`.
#[command]
pub async fn import_data(
    session_token: String,
    args: ImportDataArgs,
    state: State<'_, AppState>,
) -> Result<ImportDataResult, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::data::import_data(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

// ── Command: backup to a chosen destination (tablet only) ──────

/// Backup the database to an operator-chosen destination (tablet only).
///
/// The desktop's `create_backup` / `create_backup_scoped` take no destination and
/// write to the shell's `default_backup_path` — inside private storage on Android,
/// unreachable by the operator. This command takes the cache path the UI already
/// bridged from the save dialog's `content://` URI and writes there; the UI then
/// walks the bytes out to the real URI, exactly like `export_data`. The chosen
/// path is an ordinary cache path, never the URI itself — `tokio::fs` cannot open a
/// URI, so the crossing is done in JS on purpose, as in the export and import shims.
///
/// ADR #49 applies verbatim: the body is the bridge's `create_backup_to`, this shim
/// only borrows a `BridgeCtx` and maps `BridgeError` back to `AppError`; it holds no
/// SQL, no gate and no lock, and the gate kind and order stay the bridge's. It names
/// `kasirmu_bridge::data` and therefore resolves through `permissions::DATA_EXPORT`,
/// so it reads `Gated` and adds no debt row — ledger-neutral, like
/// `create_backup_scoped`.
#[command]
pub async fn create_backup_to(
    session_token: String,
    target_path: String,
    state: State<'_, AppState>,
) -> Result<kasirmu_bridge::data::BackupResult, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::data::create_backup_to(&ctx, &session_token, &target_path)
        .await
        .map_err(Into::into)
}
