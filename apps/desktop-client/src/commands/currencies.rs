//! Currency-lookup command for the front-end.
//!
//! R2 Phase 3: `list_currencies` migrated to use [`modules_currency::repository::CurrencyRepository`]
//! directly. `CurrencyDto` now comes from [`modules_currency::commands`].
//!
//! Wave A / S4: the bodies now live in the headless `oz_bridge::currency`
//! module. Each `#[tauri::command]` below keeps its exact name, parameter list
//! and `Result<_, AppError>` return so the registered IPC surface and the
//! serialized error shape never move; it borrows a `BridgeCtx` from
//! `AppState`, calls the bridge, and maps `BridgeError` back to `AppError`
//! variant-for-variant. The two DTOs defined here moved with the bodies and are
//! re-exported so `use super::*` in `currencies_tests.rs` still resolves them.
//! The four legacy commands still take no session at all — the bridge reads the
//! GLOBAL database for them, as before.

// Retained for the sibling test module, which reaches these through
// `use super::*`; the command bodies themselves no longer name them.
#[allow(unused_imports)]
use serde::{Deserialize, Serialize};
use tauri::State;

use modules_currency::commands::CurrencyDto;

use crate::error::AppError;
use crate::state::AppState;

pub use oz_bridge::currency::{CurrencyInfo, SetDefaultCurrencyArgs};

#[tauri::command]
/// Currency info.
pub async fn currency_info(code: String) -> Result<CurrencyInfo, AppError> {
    oz_bridge::currency::currency_info(&code).map_err(Into::into)
}

#[tauri::command]
/// List currencies.
pub async fn list_currencies(state: State<'_, AppState>) -> Result<Vec<CurrencyDto>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::currency::list_currencies(&ctx)
        .await
        .map_err(Into::into)
}

#[tauri::command]
/// List currencies resolved from a session token. ADR #7.
pub async fn list_currencies_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<CurrencyDto>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::currency::list_currencies_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

#[tauri::command]
/// Get default currency.
pub async fn get_default_currency(state: State<'_, AppState>) -> Result<Option<String>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::currency::get_default_currency(&ctx)
        .await
        .map_err(Into::into)
}

#[tauri::command]
/// Set default currency.
pub async fn set_default_currency(
    args: SetDefaultCurrencyArgs,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::currency::set_default_currency(&ctx, &args.code)
        .await
        .map_err(Into::into)
}

// ── Scoped variants (CUR-03) ─────────────────────────────────────────
//
// The default-currency commands above operate on the global database and
// are kept only as compatibility wrappers for single-store deployments.
// Scoped variants resolve the store from the session token and enforce
// `SETTINGS_READ` / `SETTINGS_EDIT` on the backend, so multi-store
// deployments cannot read or mutate another store's currency setting.
// The gate now runs inside the bridge, in the same order as before.

/// Get the default currency in the store resolved from a session token. ADR #7.
///
/// CUR-03: resolves the store from the session and enforces
/// `SETTINGS_READ` on the backend.
#[tauri::command]
pub async fn get_default_currency_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Option<String>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::currency::get_default_currency_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Set the default currency in the store resolved from a session token. ADR #7.
///
/// CUR-03: resolves the store from the session and enforces
/// `SETTINGS_EDIT` on the backend. Validates the code is a well-formed
/// ISO-4217 code before persisting (mirror of the exchange-rate path).
#[tauri::command]
pub async fn set_default_currency_scoped(
    session_token: String,
    args: SetDefaultCurrencyArgs,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::currency::set_default_currency_scoped(&ctx, &session_token, &args)
        .await
        .map_err(Into::into)
}

/// Session-scoped variant of [`currency_info`].
#[tauri::command]
pub async fn currency_info_scoped(
    session_token: String,
    code: String,
    state: State<'_, AppState>,
) -> Result<CurrencyInfo, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::currency::currency_info_scoped(&ctx, &session_token, &code)
        .await
        .map_err(Into::into)
}

#[cfg(test)]
#[path = "currencies_tests.rs"]
mod tests;
