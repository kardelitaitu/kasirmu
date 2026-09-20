//! Own-avatar read command — the tablet half of the desktop's `avatars.rs`.
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
//! ## Why only the READ is registered here
//!
//! That split is an owner ruling (2026-09-19), not an omission:
//!
//! * the read **completes an existing surface** — `PosScreen` calls it
//!   unconditionally on mount and the tablet renders that screen, so the door is
//!   already invoked by shipped UI;
//! * the two writes would **invent a surface**, which this repo does not do. Their
//!   affordance is the restaurant sidebar's "Change photo", whose own string reads
//!   `restaurant-avatar-desktop-only = Changing your photo needs the desktop app`,
//!   and this shell bundles no dialog plugin to pick a file with. They are recorded
//!   as a desktop-only product choice in `scripts/ipc-parity-allowlist.json`,
//!   following the memo-authoring and legal-entity precedents.
//!
//! ## ADR #49
//!
//! The body is the bridge's. This shim borrows a `BridgeCtx` and maps `BridgeError`
//! back to `AppError`; it holds no SQL, no gate and no lock. No media root is
//! injected — unlike `set_avatar_scoped`, the read touches no file, so
//! `BridgeCtx::media_cache_dir` is not needed here.
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
