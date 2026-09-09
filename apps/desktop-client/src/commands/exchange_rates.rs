/*
last audited 12-07-26 by RSA-Agent
crate: oz-pos-app | status: SAFE | lint: CLEAN
findings: closed C-1 (Epic X-3, see audit doc §11); no remaining findings in this file | next: re-audit on next material change | perf: not a hot path
*/

//! Exchange rate commands.
//!
//! R2 Phase 2: DTO types moved to [`modules_currency::commands`].
//! The command handler functions themselves remain here because they
//! depend on Tauri-specific types (`State`, `#[command]`) and the
//! app-level `AppState` / `AppError`.

use tauri::State;

use foundation::validate_not_empty;
use modules_currency::commands::{CreateExchangeRateArgs, ExchangeRateDto};
use modules_currency::repository::CurrencyRepository;

use crate::commands::authz::require_permission_for_session;
use crate::error::AppError;
use crate::state::AppState;
use oz_core::db::Store;

#[tauri::command]
/// List exchange rates.
pub async fn list_exchange_rates(
    state: State<'_, AppState>,
) -> Result<Vec<ExchangeRateDto>, AppError> {
    let db = state.db.lock().await;
    let repo = CurrencyRepository::new(&db);
    let rows = repo.list_exchange_rates()?;
    Ok(rows.into_iter().map(ExchangeRateDto::from).collect())
}

/// Shared validation for exchange-rate creation (CUR-05), used by both
/// the legacy and scoped command paths so the two cannot drift.
fn validate_create_rate_args(args: &CreateExchangeRateArgs) -> Result<(), AppError> {
    validate_not_empty("from_currency", &args.from_currency)
        .map_err(|e| AppError::Invalid(e.to_string()))?;
    validate_not_empty("to_currency", &args.to_currency)
        .map_err(|e| AppError::Invalid(e.to_string()))?;
    if args.rate_millionths <= 0 {
        return Err(AppError::Invalid(
            "rate must be strictly positive (zero and negative are not valid exchange rates)"
                .into(),
        ));
    }
    // CUR-05: field-level validation. The repository/DB only rejects
    // non-empty strings and relies on FKs for currency existence — a
    // same-currency pair, a non-ISO-4217 code, or a malformed effective
    // date would otherwise persist as semantically invalid configuration
    // that the "latest effective rate" selection can never match. Fail here
    // with a field-specific error before any write.
    if args.from_currency == args.to_currency {
        return Err(AppError::Invalid(
            "from_currency and to_currency must differ".into(),
        ));
    }
    for field in ["from_currency", "to_currency"] {
        let code: &str = if field == "from_currency" {
            &args.from_currency
        } else {
            &args.to_currency
        };
        code.parse::<oz_core::Currency>().map_err(|_| {
            AppError::Invalid(format!("{field}: not a valid ISO-4217 currency code"))
        })?;
    }
    if let Some(date) = &args.effective_date {
        chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").map_err(|_| {
            AppError::Invalid(format!("effective_date: must be YYYY-MM-DD, got {date}"))
        })?;
    }
    Ok(())
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
    validate_create_rate_args(&args)?;
    let db = state.db.lock().await;
    let repo = CurrencyRepository::new(&db);
    let date = args
        .effective_date
        .unwrap_or_else(|| chrono::Utc::now().format("%Y-%m-%d").to_string());
    let source = args.source.unwrap_or_else(|| "manual".to_string());
    let row = repo.create_exchange_rate(
        &args.from_currency,
        &args.to_currency,
        args.rate_millionths,
        &source,
        &date,
    )?;
    Ok(ExchangeRateDto::from(row))
}

#[tauri::command]
/// Delete exchange rate.
pub async fn delete_exchange_rate(id: String, state: State<'_, AppState>) -> Result<(), AppError> {
    let db = state.db.lock().await;
    let repo = CurrencyRepository::new(&db);
    repo.delete_exchange_rate(&id)?;
    Ok(())
}

// ── Scoped variants (CUR-03) ─────────────────────────────────────────
//
// The legacy commands above operate on the global database and are kept
// only as compatibility wrappers for single-store deployments. Scoped
// variants resolve the store from the session token and enforce
// `SETTINGS_READ` / `SETTINGS_EDIT` on the backend, so multi-store
// deployments cannot mutate another store's currency configuration.

/// List exchange rates in the store resolved from a session token. ADR #7.
///
/// CUR-03: resolves the store from the session and enforces
/// `SETTINGS_READ` on the backend.
#[tauri::command]
pub async fn list_exchange_rates_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<ExchangeRateDto>, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, oz_core::permissions::SETTINGS_READ).await?;
    let conn = state.resolve_store(&session_token)?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let repo = CurrencyRepository::new(&db);
    let rows = repo.list_exchange_rates()?;
    drop(db);
    Ok(rows.into_iter().map(ExchangeRateDto::from).collect())
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
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, oz_core::permissions::SETTINGS_READ).await?;
    let conn = state.resolve_store(&session_token)?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let repo = CurrencyRepository::new(&db);
    let rows = repo.list_latest_exchange_rates()?;
    drop(db);
    Ok(rows.into_iter().map(ExchangeRateDto::from).collect())
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
    validate_create_rate_args(&args)?;
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, oz_core::permissions::SETTINGS_EDIT).await?;
    let conn = state.resolve_store(&session_token)?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let repo = CurrencyRepository::new(&db);
    // ADR #48 (Decision 3): default the effective date to the business date in
    // the store's IANA zone, not raw UTC.
    let timezone = oz_core::db::Store::new(&db)
        .get_location_profile(&session.store_id)
        .ok()
        .flatten()
        .map(|p| p.timezone)
        .unwrap_or_else(|| "UTC".to_string());
    let date = args
        .effective_date
        .unwrap_or_else(|| oz_core::timezone::business_date_in_zone(chrono::Utc::now(), &timezone));
    let source = args.source.unwrap_or_else(|| "manual".to_string());
    let row = repo.create_exchange_rate(
        &args.from_currency,
        &args.to_currency,
        args.rate_millionths,
        &source,
        &date,
    )?;
    drop(db);
    Ok(ExchangeRateDto::from(row))
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
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, oz_core::permissions::SETTINGS_EDIT).await?;
    let conn = state.resolve_store(&session_token)?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let repo = CurrencyRepository::new(&db);
    repo.delete_exchange_rate(&id)?;
    drop(db);
    Ok(())
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
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, oz_core::permissions::SETTINGS_READ).await?;
    let conn = state.resolve_store(&session_token)?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let repo = CurrencyRepository::new(&db);
    let as_of = effective_date.unwrap_or_else(|| {
        let tz = Store::new(&db)
            .get_location_profile(&session.store_id)
            .ok()
            .flatten()
            .map(|p| p.timezone)
            .unwrap_or_else(|| "UTC".to_string());
        oz_core::timezone::business_date_in_zone(chrono::Utc::now(), &tz)
    });
    let row = repo.get_latest_exchange_rate(&from_currency, &to_currency, &as_of)?;
    drop(db);
    Ok(row.map(ExchangeRateDto::from))
}

#[cfg(test)]
#[path = "exchange_rates_tests.rs"]
mod tests;
