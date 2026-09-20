//! Own-avatar read and avatar write commands — the tablet half of the desktop's
//! `avatars.rs`.
//!
//! ## Why this module exists (parity gap, closed 2026-09-19)
//!
//! The avatar feature landed in `f49170d3d` (*"feat(restaurant): add sidebar
//! profile header, avatar write path, footer and row alignment"*) and registered
//! its three commands in `apps/desktop-tauri/src/commands/avatars.rs` **only**.
//! The renderer it also changed is shared, and this shell renders it:
//! `ui/src/features/sales/PosScreen.tsx` → `RestaurantMenu` → `RestaurantSidebar`,
//! mounted from `ui/src/app/tablet/TabletAppShell.tsx:232`. So the tablet invoked
//! `get_own_avatar_scoped` with nothing registered to answer it, and
//! `scripts/verify-ipc-parity.py` reported three tablet violations on the pushed
//! branch.
//!
//! The registration ratchet could not see this: `run_sweep()` in
//! `registration_gate_tests.rs` iterates the names **this shell already
//! registers**, so a command that was never registered produces no row and no
//! ledger entry. The ratchet and the parity gate are complementary — neither
//! subsumes the other.
//!
//! Before this module existed the failure was **silent**: `PosScreen.tsx` wraps
//! the read in `.catch(() => { /* offline or unsupported — keep the initials
//! fallback */ })`, so "command not registered" and "genuinely offline" were
//! indistinguishable and the sidebar header's avatar was permanently the
//! initials fallback.
//!
//! ## Why only the READ *was* registered here — and why that is overturned
//!
//! The split was an owner ruling (2026-09-19), and its reasoning was correct at
//! the time:
//!
//! * the read **completes an existing surface** — `PosScreen` calls it
//!   unconditionally on mount and the tablet renders that screen, so the door is
//!   already invoked by shipped UI;
//! * the two writes would **invent a surface**, which this repo does not do. Their
//!   affordance is the restaurant sidebar's "Change photo", whose string then read
//!   `restaurant-avatar-desktop-only = Changing your photo needs the desktop app`,
//!   and **this shell bundled no dialog plugin to pick a file with**. They were
//!   recorded as a desktop-only product choice in
//!   `scripts/ipc-parity-allowlist.json`, following the memo-authoring and
//!   legal-entity precedents.
//!
//! Both premises are now false, and it is the owner who reversed the ruling
//! (2026-09-20, "we want b-full"):
//!
//! * the dialog plugin **is** bundled — `tauri_plugin_dialog` and
//!   `tauri_plugin_fs` were promoted to direct dependencies of this shell and
//!   registered in `lib.rs`, with `dialog:allow-open` / `dialog:allow-save` and a
//!   narrow `fs:scope` granted in `capabilities/mobile.json`;
//! * the string is **gone**. `PosScreen` now routes "Change photo" through
//!   `ui/src/api/image-pick.ts`, which bridges the `content://` URI Android
//!   returns into a real cache path, and the guard string is `image-pick-app-only`
//!   — "app", not "desktop", because what it excludes is the browser dev preview,
//!   not the tablet.
//!
//! So the two writes are registered below, and the allowlist entry that called
//! them desktop-only is stale from the moment this file carries them.
//!
//! ## ADR #49
//!
//! Every body is the bridge's. Each shim borrows a `BridgeCtx` and maps
//! `BridgeError` back to `AppError`; none holds SQL, a gate or a lock. The read
//! injects no media root — unlike `set_avatar_scoped`, it touches no file — while
//! the write takes the same root `AppState::bridge_ctx()` already resolved from
//! `app_cache_dir()` (`apps/mobile-tauri/src/state.rs:449-458`).
//!
//! Classification, measured rather than assumed: `crates/kasirmu-bridge/src/avatars.rs`
//! names a permission constant, so its file stem is in `gated_bridge_stems()`, and a
//! shim whose text names `kasirmu_bridge::` therefore reads `Gated` — this door is
//! ledger-neutral and adds no debt row.

use tauri::{State, command};

use crate::error::AppError;
use crate::state::AppState;

/// Read the SESSION user's own avatar hash, or null when none is set.
///
/// Takes no `user_id`: the subject is always the caller, so there is nothing to
/// forge and no grant to check beyond a valid session. This is what the restaurant
/// sidebar header reads, because `get_staff_profile_scoped` requires `staff:read`,
/// which a cashier does not hold, and it would fail closed on an undecryptable
/// sensitive column that has nothing to do with a photo.
///
/// `None` is the honest "no photo set" answer, which the renderer shows as the
/// initials fallback — not an error.
///
/// ADR #49: the body is the bridge's.
#[command]
pub async fn get_own_avatar_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Option<String>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::avatars::get_own_avatar_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// The error text both shells report when the media root cannot be resolved.
///
/// `bridge_ctx()` logs the underlying error and degrades to `None`; a caller
/// still has to be told, and told the same thing on both shells.
const MEDIA_ROOT_UNAVAILABLE: &str = "resolving app cache dir: media root unavailable";

// ── Command: write avatar ──────────────────────────────────────────────

/// Set `user_id`'s avatar from the image at `source_path`.
///
/// Zero image bytes cross the IPC boundary — what arrives is a path, and on
/// Android that path is the cache copy `ui/src/api/file-bridge.ts` made from the
/// `content://` URI the picker returned. Self-writes need no grant; writing
/// another user's avatar requires `staff:update`, decided in the bridge.
///
/// Returns the 16-hex-char content hash now stored in `users.avatar`.
#[command]
pub async fn set_avatar_scoped(
    session_token: String,
    user_id: String,
    source_path: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let ctx = state.bridge_ctx();
    let image_root = ctx
        .media_cache_dir
        .clone()
        .ok_or_else(|| AppError::Internal(MEDIA_ROOT_UNAVAILABLE.into()))?;
    kasirmu_bridge::avatars::set_avatar_scoped(
        &ctx,
        &session_token,
        &user_id,
        &source_path,
        &image_root,
    )
    .await
    .map_err(Into::into)
}

// ── Command: clear avatar ──────────────────────────────────────────────

/// Clear `user_id`'s avatar back to the initials fallback.
///
/// Only the column is cleared; the file on disk is left for the GC sweep, since
/// content-addressed dedup means the same bytes may still be referenced by a
/// product or another user.
#[command]
pub async fn clear_avatar_scoped(
    session_token: String,
    user_id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::avatars::clear_avatar_scoped(&ctx, &session_token, &user_id)
        .await
        .map_err(Into::into)
}
