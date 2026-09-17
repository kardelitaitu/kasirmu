//! Currency lookups and the default-currency setting for the front-end.
//!
//! R2 Phase 3 moved these reads onto [`modules_currency::repository::CurrencyRepository`]
//! directly, and `CurrencyDto` now comes from [`modules_currency::commands`].
//!
//! What the front-end can invoke here is `currency_info`, `list_currencies_scoped`,
//! `get_default_currency`, `set_default_currency` and their scoped pair. The unscoped
//! `list_currencies` that this paragraph used to name was retired on 2026-09-16 (T19):
//! registered in neither shell, unnamed by UI code, uncalled by any Rust in this crate.

use serde::{Deserialize, Serialize};
use tauri::State;
use tauri::command;

use modules_currency::commands::CurrencyDto;
use modules_currency::repository::CurrencyRepository;
use kasirmu_core::db::Store;

use crate::commands::authz::require_permission_for_user;
use crate::error::AppError;
use crate::state::AppState;

/// Currency info returned to the front-end for formatting.
#[derive(Debug, Serialize)]
pub struct CurrencyInfo {
    /// ISO-4217 alpha-3 code, e.g. "USD".
    pub code: String,
    /// Minor-unit exponent (decimal places), e.g. 2 for USD.
    pub exponent: u32,
}

#[command]
/// Currency info.
pub async fn currency_info(code: String) -> Result<CurrencyInfo, AppError> {
    let currency: kasirmu_core::Currency = code
        .parse()
        .map_err(|_| AppError::Invalid(format!("invalid currency code: {code}")))?;
    Ok(CurrencyInfo {
        code: String::from_utf8_lossy(&currency.0).into_owned(),
        exponent: currency.minor_unit_exponent(),
    })
}

#[command]
/// List currencies resolved from a session token. ADR #7.
pub async fn list_currencies_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<CurrencyDto>, AppError> {
    let session = state.resolve_session(&session_token)?;
    let conn = state
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    require_permission_for_user(
        &Store::new(&db),
        &session.user_id,
        kasirmu_core::permissions::SETTINGS_READ,
    )?;
    let repo = CurrencyRepository::new(&db);
    let out = repo.list_currencies()?;
    drop(db);
    Ok(out)
}

#[derive(Debug, Deserialize)]
/// Setdefaultcurrencyargs.
pub struct SetDefaultCurrencyArgs {
    /// Code.
    pub code: String,
}

#[command]
/// Get default currency.
pub async fn get_default_currency(state: State<'_, AppState>) -> Result<Option<String>, AppError> {
    let db = state.db.lock().await;
    let repo = CurrencyRepository::new(&db);
    Ok(repo.get_default_currency()?)
}

#[command]
/// Set default currency.
pub async fn set_default_currency(
    args: SetDefaultCurrencyArgs,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let db = state.db.lock().await;
    let repo = CurrencyRepository::new(&db);
    repo.set_default_currency(&args.code)?;
    Ok(())
}

// ── Scoped variants (CUR-03) ─────────────────────────────────────────
//
// The default-currency commands above operate on the global database and
// are kept only as compatibility wrappers for single-store deployments.
// Scoped variants resolve the store from the session token and enforce
// `SETTINGS_READ` / `SETTINGS_EDIT` on the backend.

/// Get the default currency in the store resolved from a session token. ADR #7.
///
/// CUR-03: resolves the store from the session and enforces
/// `SETTINGS_READ` on the backend.
#[command]
pub async fn get_default_currency_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Option<String>, AppError> {
    let session = state.resolve_session(&session_token)?;
    let conn = state
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    require_permission_for_user(
        &Store::new(&db),
        &session.user_id,
        kasirmu_core::permissions::SETTINGS_READ,
    )?;
    let repo = CurrencyRepository::new(&db);
    let out = repo.get_default_currency()?;
    drop(db);
    Ok(out)
}

/// Set the default currency in the store resolved from a session token. ADR #7.
///
/// CUR-03: resolves the store from the session and enforces
/// `SETTINGS_EDIT` on the backend. Validates the code is a well-formed
/// ISO-4217 code before persisting.
#[command]
pub async fn set_default_currency_scoped(
    session_token: String,
    args: SetDefaultCurrencyArgs,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    args.code
        .parse::<kasirmu_core::Currency>()
        .map_err(|_| AppError::Invalid(format!("invalid currency code: {}", args.code)))?;
    let session = state.resolve_session(&session_token)?;
    let conn = state
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| AppError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    require_permission_for_user(
        &Store::new(&db),
        &session.user_id,
        kasirmu_core::permissions::SETTINGS_EDIT,
    )?;
    let repo = CurrencyRepository::new(&db);
    repo.set_default_currency(&args.code)?;
    drop(db);
    Ok(())
}

#[cfg(test)]
#[path = "currencies_tests.rs"]
mod tests;
