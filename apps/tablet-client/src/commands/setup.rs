//! Setup Wizard commands.
//!
//! `complete_setup` persists the chosen preset, enabled features and
//! default currency to the settings table and marks the wizard as
//! complete. `get_setup_status` lets the front-end decide whether to show
//! the wizard or go straight to the main app.
//!
//! `CompleteSetupArgs`, `SetupStatus` and `EnabledFeaturesResult` are all
//! re-exported from `oz_bridge::setup`: the wire shape is one type shared
//! with the desktop shell, so a key the wizard sends — or a key the wizard
//! reads back — cannot exist on only one side.

use oz_core::{FeatureRegistry, Settings, features};
use rusqlite::Connection;
use tauri::{State, command};

use crate::error::AppError;
use crate::state::AppState;

// ── Args ─────────────────────────────────────────────────────────────

/// Completesetupargs — the payload the setup wizard sends.
///
/// Re-exported from `oz_bridge::setup` instead of copied locally. The local
/// copy of this struct carried only `preset` and `features`; serde ignores
/// unknown keys, so the `default_currency` the wizard collects was dropped
/// on tablet with no error on either side. A field list duplicated across
/// two crates drifts again the next time the bridge gains a key — sharing
/// the one type makes that class of loss impossible rather than unlikely.
pub use oz_bridge::setup::CompleteSetupArgs;

// ── Response types ───────────────────────────────────────────────────

/// Outbound wire shapes for `get_setup_status` and `get_enabled_features`.
///
/// Re-exported from `oz_bridge::setup` for the same reason
/// [`CompleteSetupArgs`] is: both copies declared `completed` + `preset` and
/// `features` with no `#[serde(rename_all)]`, so they had not drifted yet —
/// which is only because each side is a single-word field list, the casing
/// axis a rename cannot reach. A duplicated field list still drifts the next
/// time the bridge gains a response key, and serde would drop it on one shell
/// in silence exactly as it dropped `default_currency` on the way in.
/// The desktop shell already re-exports both
/// (`apps/desktop-client/src/commands/setup.rs:19`); the keys are pinned here
/// against what `ui/src/api/settings.ts:155` and `:179` read.
pub use oz_bridge::setup::{EnabledFeaturesResult, SetupStatus};

// ── Commands ─────────────────────────────────────────────────────────

/// Return the list of currently-enabled feature keys.
///
/// The front-end calls this once on mount to decide which nav items
/// and UI elements to show/hide.
#[command]
pub async fn get_enabled_features(
    state: State<'_, AppState>,
) -> Result<EnabledFeaturesResult, AppError> {
    let conn = state.db.lock().await;
    let registry = Settings::load_features(&conn)?;

    let features: Vec<String> = registry
        .enabled_features()
        .map(|f| oz_core::features::feature_key(f).to_string())
        .collect();

    Ok(EnabledFeaturesResult { features })
}

/// Write every row the setup wizard collects, into `conn`.
///
/// Split out of the `#[command]` so tests drive the real statement list
/// with a plain `&Connection` instead of a mirrored copy of it — a copy is
/// how "the body writes it" and "the test checks it" came to disagree.
/// Legs and their order mirror `oz_bridge::setup::complete_setup`; the
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
    Settings::set(conn, oz_core::settings::keys::STORE_PRESET, &args.preset)?;

    // 4. Mark setup as complete.
    Settings::set(conn, oz_core::settings::keys::SETUP_COMPLETE, "1")?;

    // 5. Save the currency the wizard collected. The tablet dropped this
    // leg along with the struct field, so the choice never reached the
    // `currency.default` row.
    Settings::set_default_currency(conn, &args.default_currency)?;

    // 6. Dismiss the wizard so it doesn't show on next launch.
    Settings::set(conn, oz_core::settings::keys::SHOW_SETUP_WIZARD, "false")?;

    Ok(())
}

/// Persist the chosen preset, features and default currency, then mark
/// setup as complete.
///
/// Called by the front-end when the user clicks "Complete Setup" on
/// the last step of the wizard.
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
#[command]
pub async fn dismiss_setup_wizard(state: State<'_, AppState>) -> Result<(), AppError> {
    let db = state.db.lock().await;
    Settings::set(&db, oz_core::settings::keys::SHOW_SETUP_WIZARD, "false")?;
    tracing::info!("setup wizard dismissed (skip)");
    Ok(())
}

/// Returns whether the setup wizard has been completed.
///
/// The front-end calls this on mount to decide whether to render
/// the wizard or the main application.
#[command]
pub async fn get_setup_status(state: State<'_, AppState>) -> Result<SetupStatus, AppError> {
    let db = state.db.lock().await;

    let completed = Settings::get(&db, oz_core::settings::keys::SHOW_SETUP_WIZARD)?
        .map(|v| v == "false")
        .unwrap_or(false);

    let preset = Settings::get(&db, oz_core::settings::keys::STORE_PRESET)?;

    Ok(SetupStatus { completed, preset })
}

#[cfg(test)]
#[path = "setup_tests.rs"]
mod tests;
