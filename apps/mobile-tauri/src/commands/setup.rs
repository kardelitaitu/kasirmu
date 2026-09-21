//! Setup / first-run provisioning commands.
//!
//! Three commands remain, and the retired ones are named below rather than
//! silently dropped, because three separate decisions removed them:
//!
//! - [`get_enabled_features`] — unchanged. The feature read the shell makes on
//!   mount to decide which nav items to show.
//! - [`get_first_run_state`] — replaces `get_setup_status` (ADR #56 §2.1). It
//!   returns the provisioning ROW rather than a boolean derived from the
//!   `show_setup_wizard` key, so an unreadable database yields
//!   `unprovisioned` instead of forging a verdict.
//! - [`provision_device`] — replaces `complete_setup` and `bootstrap_owner` on
//!   the fresh-install path (ADR #56 §2.2). One idempotent transaction creates
//!   the location, the workspaces, the owner, the features and the marker.
//!
//! `EnabledFeaturesResult`, `FirstRunStateDto`, `ProvisionDeviceArgs` and
//! `ProvisionDeviceResultDto` are all re-exported from `kasirmu_bridge::setup`:
//! the wire shape is one type shared with the desktop shell, so a key the UI
//! sends — or a key it reads back — cannot exist on only one side.
//!
//! # The ADR #49 divergence this file used to carry is CLOSED
//!
//! `complete_setup` was the one door the ADR #49 tablet port refused, on the
//! ground that delegating to the bridge twin would have ADDED a statement (the
//! bridge's leading `seed_default_roles`) inside an extraction. That tension is
//! gone rather than resolved: the command itself is retired, and both shells
//! now call the single `provision_device` implementation, which seeds roles
//! itself as step 2 of its transaction (ADR #56 §2.2).
//!
//! `dismiss_setup_wizard` is retired for a different reason, recorded because
//! it was a design decision rather than a refactor: ADR #56 §1.5 identifies
//! "Skip setup" as a TRAPDOOR — it marked setup complete while provisioning
//! nothing, producing a login screen with zero users. Once the marker is a row
//! instead of a flag there is nothing to skip PAST, so the command has no
//! meaning left to implement.

use tauri::{State, command};

use crate::error::AppError;
use crate::state::AppState;

// ── Args ─────────────────────────────────────────────────────────────

/// Completesetupargs — the payload the setup wizard sends.
///
/// Re-exported from `kasirmu_bridge::setup` instead of copied locally. The local
/// copy of this struct carried only `preset` and `features`; serde ignores
/// unknown keys, so the `default_currency` the wizard collects was dropped
/// on tablet with no error on either side. A field list duplicated across
/// two crates drifts again the next time the bridge gains a key — sharing
/// the one type makes that class of loss impossible rather than unlikely.
pub use kasirmu_bridge::setup::CompleteSetupArgs;

// ── Response types ───────────────────────────────────────────────────

/// Outbound wire shapes for `get_setup_status` and `get_enabled_features`.
///
/// Re-exported from `kasirmu_bridge::setup` for the same reason
/// [`CompleteSetupArgs`] is: both copies declared `completed` + `preset` and
/// `features` with no `#[serde(rename_all)]`, so they had not drifted yet —
/// which is only because each side is a single-word field list, the casing
/// axis a rename cannot reach. A duplicated field list still drifts the next
/// time the bridge gains a response key, and serde would drop it on one shell
/// in silence exactly as it dropped `default_currency` on the way in.
/// The desktop shell already re-exports both
/// (`apps/desktop-tauri/src/commands/setup.rs:19`); the keys are pinned here
/// against what `ui/src/api/settings.ts:155` and `:179` read.
pub use kasirmu_bridge::setup::{EnabledFeaturesResult, SetupStatus};

// ── Commands ─────────────────────────────────────────────────────────

/// Return the list of currently-enabled feature keys.
///
/// The front-end calls this once on mount to decide which nav items
/// and UI elements to show/hide.
///
/// # ADR #49 — ported 2026-09-16
///
/// Delegates to [`kasirmu_bridge::setup::get_enabled_features`]. The two bodies were
/// statement-identical, so this is a whole-body move rather than a rewrite; the
/// door resolves no session, which makes the delegation ledger-neutral.
#[command]
pub async fn get_enabled_features(
    state: State<'_, AppState>,
) -> Result<EnabledFeaturesResult, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::setup::get_enabled_features(&ctx)
        .await
        .map_err(Into::into)
}

// ── Retired by ADR #56 §2.2/§2.3 ─────────────────────────────────────
//
// `write_setup` and `complete_setup` were REMOVED here. The body wrote the
// two booleans §2.1 retires (steps 4 and 6 of the old list below), and the
// flow that called it is no longer on the critical path:
// `ProvisioningFlow` calls `provision_device`, which writes the feature rows,
// the preset and the currency inside the transaction that also creates the
// location, the workspaces and the owner.
//
// Removing this body also CLOSES the ADR #49 divergence this file used to
// record. `complete_setup` was the one door the ADR #49 port refused, because
// delegating to the bridge twin would have ADDED a statement (the bridge's
// leading `seed_default_roles`) inside an extraction. There is no twin to
// diverge from now — `provision_device` is the only writer, and both shells
// call the one bridge implementation.

/// The first-run state for one terminal (ADR #56 §2.1).
///
/// Replaces [`get_setup_status`]'s boolean. The shell calls this on mount and
/// renders the provisioning flow when `state` is `unprovisioned`.
#[command]
pub async fn get_first_run_state(
    state: State<'_, AppState>,
    terminal_id: String,
) -> Result<kasirmu_bridge::setup::FirstRunStateDto, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::setup::get_first_run_state(&ctx, &terminal_id)
        .await
        .map_err(Into::into)
}

/// Provision this terminal in one idempotent transaction (ADR #56 §2.2).
///
/// The replacement for the wizard's completion path: it creates the location,
/// the workspaces, the owner, the features and the marker together, or none of
/// them. A retry returns the existing row and creates nothing.
#[command]
pub async fn provision_device(
    state: State<'_, AppState>,
    args: kasirmu_bridge::setup::ProvisionDeviceArgs,
) -> Result<kasirmu_bridge::setup::ProvisionDeviceResultDto, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::setup::provision_device(&ctx, args)
        .await
        .map_err(Into::into)
}

// ── Retired by ADR #56 §2.2 ──────────────────────────────────────────
//
// `dismiss_setup_wizard` and `get_setup_status` were REMOVED here. Both
// existed to serve the three booleans §2.1 retires:
//
// - `dismiss_setup_wizard` wrote `show_setup_wizard = false`, the "Skip
//   setup" escape hatch. §1.5 records that Skip is a trapdoor, not an exit:
//   it marked setup complete while provisioning nothing, which is the state
//   §2.1 makes unrepresentable — there is no row to write without an owner,
//   a location and a workspace to point at.
// - `get_setup_status` derived `completed` from that same key. A failed read
//   could forge the answer in either direction, which is why the shells
//   carried a boot-retry workaround for a lost IPC response (§1.4).
//
// Their replacement is `get_first_run_state` above, which reads the
// provisioning row: an unreadable database yields no row, and no row means
// unprovisioned, so a retry is an ordinary idempotent re-read.

#[cfg(test)]
#[path = "setup_tests.rs"]
mod tests;
