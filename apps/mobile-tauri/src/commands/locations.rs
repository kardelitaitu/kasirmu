//! Location commands — the tablet shell's copy of the desktop read surface.
//!
//! The settings hub lives in the shared `ui/`, so Settings → Business Defaults
//! renders in BOTH shells: its three cards (regional defaults, local payment
//! methods, receipt format) each resolve the tenant's primary location FIRST
//! via `get_primaryLocationScoped`, and that first call was the one command
//! the tablet shell had never registered — the rejection surfaced as three
//! permanent error banners that all had the same single root cause.
//!
//! READ-ONLY ON PURPOSE. Only `get_primary_location_scoped` is registered
//! here: it is the one command the shared settings cards (and the shared
//! locale-sync hook) reach on this shell. The full location-profile CRUD
//! surface (`list`/`get`/`create`/`update`/`set_primary`/`delete` and the
//! ticket-prefix pair) stays desktop-only — the multi-store dashboard,
//! topology editor and store switcher are back-office screens, not tablet
//! ones, so their commands remain in the tablet allowlist as recorded gaps.
//!
//! Each body is the same headless `kasirmu_bridge::locations` call the
//! desktop command makes, borrowing a `BridgeCtx` from `AppState` and mapping
//! `BridgeError` back to `AppError` (the `From` impl lives in
//! `commands/authz.rs`, the same seam the other tablet shims use). The
//! command name and parameter list are IDENTICAL to the desktop one, so the
//! UI's `invoke` call resolves unchanged.

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

pub use kasirmu_bridge::locations::LocationProfileDto;

/// Get the primary location for the session's tenant (ADR #7).
///
/// The Business Defaults cards' first hop: each card resolves the tenant's
/// primary location (for its timezone / local rails / receipt scope) before
/// loading its own scoped config, so this read must answer on every shell
/// the settings hub renders on.
#[tauri::command]
pub async fn get_primary_location_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Option<LocationProfileDto>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::locations::get_primary_location_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}
