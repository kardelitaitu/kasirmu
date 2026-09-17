//! Setup Wizard commands.
//!
//! `complete_setup` persists the chosen preset, enabled features and
//! default currency to the settings table and marks the wizard as
//! complete. `get_setup_status` lets the front-end decide whether to show
//! the wizard or go straight to the main app.
//!
//! `CompleteSetupArgs`, `SetupStatus` and `EnabledFeaturesResult` are all
//! re-exported from `kasirmu_bridge::setup`: the wire shape is one type shared
//! with the desktop shell, so a key the wizard sends — or a key the wizard
//! reads back — cannot exist on only one side.
//!
//! # ADR #49 status — measured 2026-09-16, `census-portable-doors.py` → 3 of 4
//!
//! **Three doors are ported, and all three are whole-body moves.** The census
//! calls a door *portable* only when its body is already statement-identical to
//! its twin, so these needed no rewriting — only the ctx source changes, which
//! is what [`AppState::bridge_ctx`] supplies: [`get_enabled_features`],
//! [`dismiss_setup_wizard`] and [`get_setup_status`]. None resolves a session,
//! so all three are ledger-neutral and the registration ratchet does not move.
//!
//! **What proves the move is the instrument, not a test on this shell.** The
//! `setup_tests.rs` cases that name two of these doors assert a hand-written
//! copy of the old body against a plain `Connection` (`setup_tests.rs:382` and
//! `:392`), so they keep passing while exercising `Settings` rather than the
//! command — the very mirrored-copy failure mode [`write_setup`] was split out
//! to avoid, and the reason those tests cannot reach the bridge twins either,
//! since a `BridgeCtx` is not constructible from a bare connection. The proof
//! is `verify-body-parity.py`: the pre-port bodies were statement-identical,
//! and the twins themselves are exercised by the desktop shell.
//!
//! **One door is REFUSED.** [`complete_setup`] would *gain* a statement: the
//! bridge's body opens its transaction with `store.seed_default_roles()`
//! (`crates/kasirmu-bridge/src/setup.rs:99`) and this shell has never run it. §4
//! forbids adding a statement inside an extraction as plainly as removing one,
//! so the body stays tablet-native and [`write_setup`] stays with it.
//!
//! The absent leg is **not** a defect here: `bootstrap_owner` seeds the default
//! roles before creating the first owner
//! (`apps/tablet-client/src/commands/staff.rs:444` → `kasirmu_bridge::staff::
//! bootstrap_owner` → `run_bootstrap_owner`), so a tablet-provisioned store
//! holds its role rows by the time the wizard runs. That is why the divergence
//! is recorded in [`write_setup`] as deliberate rather than owed.

use kasirmu_core::{FeatureRegistry, Settings, features};
use rusqlite::Connection;
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
/// (`apps/desktop-client/src/commands/setup.rs:19`); the keys are pinned here
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

/// Write every row the setup wizard collects, into `conn`.
///
/// Split out of the `#[command]` so tests drive the real statement list
/// with a plain `&Connection` instead of a mirrored copy of it — a copy is
/// how "the body writes it" and "the test checks it" came to disagree.
/// Legs and their order mirror `kasirmu_bridge::setup::complete_setup`; the
/// bridge's leading `seed_default_roles` is deliberately not mirrored here
/// (that seeding is not this command's behaviour to take on today).
fn write_setup(conn: &Connection, args: &CompleteSetupArgs) -> Result<(), AppError> {
    // Convert feature key strings → Feature enum variants.
    let mut registry = FeatureRegistry::new();
    for key in &args.features {
        if let Some(feat) = features::feature_from_key(key) {
            registry.enable(feat);
        } else {
            tracing::warn!(feature = %key, "unknown feature key in setup, skipping");
        }
    }

    // 1. Persist features.
    // RUST-08: write feature rows directly into the caller's transaction.
    // `store.save_features` -> Settings::set_batch opens its OWN
    // unchecked_transaction, which would be a nested BEGIN inside the
    // caller's ("cannot start a transaction within a transaction").
    for (key, value) in registry.to_settings_rows() {
        Settings::set(conn, &key, &value)?;
    }

    // 2. Prune stale feature rows that are no longer enabled.
    Settings::prune_stale_features(conn, &registry)?;

    // 3. Save the preset name.
    Settings::set(conn, kasirmu_core::settings::keys::STORE_PRESET, &args.preset)?;

    // 4. Mark setup as complete.
    Settings::set(conn, kasirmu_core::settings::keys::SETUP_COMPLETE, "1")?;

    // 5. Save the currency the wizard collected. The tablet dropped this
    // leg along with the struct field, so the choice never reached the
    // `currency.default` row.
    Settings::set_default_currency(conn, &args.default_currency)?;

    // 6. Dismiss the wizard so it doesn't show on next launch.
    Settings::set(conn, kasirmu_core::settings::keys::SHOW_SETUP_WIZARD, "false")?;

    Ok(())
}

/// Persist the chosen preset, features and default currency, then mark
/// setup as complete.
///
/// Called by the front-end when the user clicks "Complete Setup" on
/// the last step of the wizard.
///
/// # ADR #49 NOT APPLIED, deliberately
///
/// Refused 2026-09-16. Delegating would **add a statement**: the bridge body
/// opens its transaction with `store.seed_default_roles()`
/// (`crates/kasirmu-bridge/src/setup.rs:99`) which this shell's body has never
/// executed, and §4 pins the transaction's legs and their order. This is the
/// same class of change as adding a gate, and it is not an extraction.
///
/// The gap is deliberate rather than owed — `bootstrap_owner` already seeds
/// those rows on this shell — so nothing is filed as debt against this door.
/// What does *not* follow from that is a licence to delegate: the ledger is not
/// the only constraint, and a body that would gain a write leg fails §4 whether
/// or not anyone is owed it.
#[command]
pub async fn complete_setup(
    state: State<'_, AppState>,
    args: CompleteSetupArgs,
) -> Result<(), AppError> {
    let db = state.db.lock().await;

    // Save features + preset + currency + completed flag in a single
    // transaction.
    let tx = db.unchecked_transaction()?;
    write_setup(&tx, &args)?;
    tx.commit()?;

    tracing::info!(
        preset = %args.preset,
        feature_count = %args.features.len(),
        "setup wizard completed"
    );

    Ok(())
}

/// Dismiss the setup wizard without enabling any features.
///
/// Called when the user clicks "Skip setup". Only writes the
/// `show_setup_wizard = false` flag — no preset or features are saved.
///
/// # ADR #49 — ported 2026-09-16
///
/// Delegates to [`kasirmu_bridge::setup::dismiss_setup_wizard`]; the bodies were
/// statement-identical. Resolves no session, so the move is ledger-neutral.
#[command]
pub async fn dismiss_setup_wizard(state: State<'_, AppState>) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::setup::dismiss_setup_wizard(&ctx)
        .await
        .map_err(Into::into)
}

/// Returns whether the setup wizard has been completed.
///
/// The front-end calls this on mount to decide whether to render
/// the wizard or the main application.
///
/// # ADR #49 — ported 2026-09-16
///
/// Delegates to [`kasirmu_bridge::setup::get_setup_status`]; the bodies were
/// statement-identical. Resolves no session, so the move is ledger-neutral.
#[command]
pub async fn get_setup_status(state: State<'_, AppState>) -> Result<SetupStatus, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::setup::get_setup_status(&ctx)
        .await
        .map_err(Into::into)
}

#[cfg(test)]
#[path = "setup_tests.rs"]
mod tests;
