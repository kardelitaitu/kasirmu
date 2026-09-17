/*
last audited 12-07-26 by RSA-Agent
crate: kasirmu-app | status: SAFE | lint: CLEAN
findings: closed C-1 (Epic X-3, see audit doc §11); no remaining findings in this file | next: re-audit on next material change | perf: not a hot path
*/

//! Exchange rate commands.
//!
//! R2 Phase 2: DTO types moved to [`modules_currency::commands`].
//!
//! Wave A / S4: the handler bodies now live in the headless
//! `oz_bridge::currency` module. Each `#[tauri::command]` below keeps its
//! exact name, parameter list and `Result<_, AppError>` return so the
//! registered IPC surface and the serialized error shape never move; it
//! borrows a `BridgeCtx` from `AppState`, calls the bridge, and maps
//! `BridgeError` back to `AppError` variant-for-variant.
//! `validate_create_rate_args` stays here as an `AppError`-returning adapter
//! over the bridge validator, because `exchange_rates_tests.rs` calls it
//! directly and matches on `AppError::Invalid`.

use tauri::State;

// Retained for the sibling test module, which reaches this through
// `use super::*`; the command bodies no longer name it.
#[allow(unused_imports)]
use oz_core::db::Store;

use modules_currency::commands::{CreateExchangeRateArgs, ExchangeRateDto};

use crate::error::AppError;
use crate::state::AppState;

/// Shared validation for exchange-rate creation (CUR-05), used by both
/// the legacy and scoped command paths so the two cannot drift.
///
/// The rules live in `oz_bridge::currency::validate_create_rate_args`; this
/// adapter exists so both the shell and its tests keep seeing `AppError`.
#[allow(dead_code)] // retained for exchange_rates_tests.rs, which calls it directly
fn validate_create_rate_args(args: &CreateExchangeRateArgs) -> Result<(), AppError> {
    oz_bridge::currency::validate_create_rate_args(args).map_err(AppError::from)
}

#[tauri::command]
/// Create a global exchange rate.
///
/// Legacy compatibility command: it operates on the global catalog database,
/// which carries no store or location context, so effective_date defaults to
/// the UTC business date (Utc::now()). That is the deliberate, documented
/// contract for the global path - see ADR #48 (Decision 3). Location-scoped
/// callers must use create_exchange_rate_scoped, which resolves the business
/// date in the store's IANA zone instead. Do not fix this to a timezone: with
/// no store in scope there is no location whose zone could apply.
pub async fn create_exchange_rate(
    args: CreateExchangeRateArgs,
    state: State<'_, AppState>,
) -> Result<ExchangeRateDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::currency::create_exchange_rate(&ctx, &args)
        .await
        .map_err(Into::into)
}

// ── Scoped variants (CUR-03) ─────────────────────────────────────────
//
// The legacy commands above operate on the global database and are kept
// only as compatibility wrappers for single-store deployments. Scoped
// variants resolve the store from the session token and enforce
// `SETTINGS_READ` / `SETTINGS_EDIT` on the backend, so multi-store
// deployments cannot mutate another store's currency configuration.
// The gates now run inside the bridge, in the same order as before.

/// List exchange rates in the store resolved from a session token. ADR #7.
///
/// CUR-03: resolves the store from the session and enforces
/// `SETTINGS_READ` on the backend.
#[tauri::command]
pub async fn list_exchange_rates_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<ExchangeRateDto>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::currency::list_exchange_rates_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// The current rate for every pair (CUR-11), store resolved from a
/// session token. ADR #7.
///
/// Bounded counterpart to `list_exchange_rates_scoped`: one row per
/// currency pair (newest effective date), so rate-overview consumers
/// never ship the full history over IPC. Same `SETTINGS_READ` gate.
#[tauri::command]
pub async fn list_latest_exchange_rates_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<ExchangeRateDto>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::currency::list_latest_exchange_rates_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Create an exchange rate in the store resolved from a session token. ADR #7.
///
/// CUR-03: resolves the store from the session and enforces
/// `SETTINGS_EDIT` on the backend. CUR-05 validation is shared with the
/// legacy path.
#[tauri::command]
pub async fn create_exchange_rate_scoped(
    session_token: String,
    args: CreateExchangeRateArgs,
    state: State<'_, AppState>,
) -> Result<ExchangeRateDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::currency::create_exchange_rate_scoped(&ctx, &session_token, &args)
        .await
        .map_err(Into::into)
}

/// Delete an exchange rate in the store resolved from a session token. ADR #7.
///
/// CUR-03: resolves the store from the session and enforces
/// `SETTINGS_EDIT` on the backend.
#[tauri::command]
pub async fn delete_exchange_rate_scoped(
    session_token: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::currency::delete_exchange_rate_scoped(&ctx, &session_token, &id)
        .await
        .map_err(Into::into)
}

/// Return the latest exchange rate for a pair effective on/before
/// `effective_date` in the session store (CUR-04).
///
/// Enforces `SETTINGS_READ`. The checkout path must use this instead of
/// `find()`-ing the full history list, so a rate is selected by effective
/// date rather than arbitrary list order.
#[tauri::command]
pub async fn get_latest_exchange_rate_scoped(
    session_token: String,
    from_currency: String,
    to_currency: String,
    effective_date: Option<String>,
    state: State<'_, AppState>,
) -> Result<Option<ExchangeRateDto>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::currency::get_latest_exchange_rate_scoped(
        &ctx,
        &session_token,
        &from_currency,
        &to_currency,
        effective_date,
    )
    .await
    .map_err(Into::into)
}
