//! Exchange rate commands.
//!
//! R2 Phase 2: DTO types moved to [`modules_currency::commands`].
//! The command handler functions themselves remain here because they
//! depend on Tauri-specific types (`State`, `#[command]`) and the
//! app-level `AppState` / `AppError`.

use tauri::{State, command};

use modules_currency::commands::{CreateExchangeRateArgs, ExchangeRateDto};
use modules_currency::repository::CurrencyRepository;
use oz_core::db::Store;

use crate::commands::authz::require_permission_for_user;
use crate::error::AppError;
use crate::state::AppState;

#[command]
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
    if args.from_currency.trim().is_empty() || args.to_currency.trim().is_empty() {
        return Err(AppError::Invalid("Currency codes must not be empty".into()));
    }
    if args.rate_millionths <= 0 {
        return Err(AppError::Invalid(
            "rate must be strictly positive (zero and negative are not valid exchange rates)"
                .into(),
        ));
    }
    // CUR-05: field-level validation — a same-currency pair, a non-ISO-4217
    // code, or a malformed effective date must fail here with a
    // field-specific error before any write (mirror of the desktop client).
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

#[command]
/// Create exchange rate.
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

#[command]
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

fn run_list_exchange_rates(conn: &rusqlite::Connection) -> Result<Vec<ExchangeRateDto>, AppError> {
    let repo = CurrencyRepository::new(conn);
    let rows = repo.list_exchange_rates()?;
    Ok(rows.into_iter().map(ExchangeRateDto::from).collect())
}

fn run_list_latest_exchange_rates(
    conn: &rusqlite::Connection,
) -> Result<Vec<ExchangeRateDto>, AppError> {
    let repo = CurrencyRepository::new(conn);
    let rows = repo.list_latest_exchange_rates()?;
    Ok(rows.into_iter().map(ExchangeRateDto::from).collect())
}

/// List exchange rates in the store resolved from a session token. ADR #7.
///
/// CUR-03: resolves the store from the session and enforces
/// `SETTINGS_READ` on the backend.
#[command]
pub async fn list_exchange_rates_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<ExchangeRateDto>, AppError> {
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
        oz_core::permissions::SETTINGS_READ,
    )?;
    let out = run_list_exchange_rates(&db)?;
    drop(db);
    Ok(out)
}

/// The current rate for every pair (CUR-11), store resolved from a
/// session token. ADR #7.
///
/// Bounded counterpart to `list_exchange_rates_scoped`: one row per
/// currency pair (newest effective date), so rate-overview consumers
/// never ship the full history over IPC. Same `SETTINGS_READ` gate.
#[command]
pub async fn list_latest_exchange_rates_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<ExchangeRateDto>, AppError> {
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
        oz_core::permissions::SETTINGS_READ,
    )?;
    let out = run_list_latest_exchange_rates(&db)?;
    drop(db);
    Ok(out)
}

/// Create an exchange rate in the store resolved from a session token. ADR #7.
///
/// CUR-03: resolves the store from the session and enforces
/// `SETTINGS_EDIT` on the backend. CUR-05 validation is shared with the
/// legacy path.
#[command]
pub async fn create_exchange_rate_scoped(
    session_token: String,
    args: CreateExchangeRateArgs,
    state: State<'_, AppState>,
) -> Result<ExchangeRateDto, AppError> {
    validate_create_rate_args(&args)?;
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
        oz_core::permissions::SETTINGS_EDIT,
    )?;
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
    drop(db);
    Ok(ExchangeRateDto::from(row))
}

/// Delete an exchange rate in the store resolved from a session token. ADR #7.
///
/// CUR-03: resolves the store from the session and enforces
/// `SETTINGS_EDIT` on the backend.
#[command]
pub async fn delete_exchange_rate_scoped(
    session_token: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
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
        oz_core::permissions::SETTINGS_EDIT,
    )?;
    let repo = CurrencyRepository::new(&db);
    repo.delete_exchange_rate(&id)?;
    drop(db);
    Ok(())
}

/// Return the latest exchange rate for a pair effective on/before
/// `effective_date` in the session store (CUR-04).
///
/// Enforces `SETTINGS_READ`. The checkout path must use this instead of
/// `find()`-ing the full history list.
#[command]
pub async fn get_latest_exchange_rate_scoped(
    session_token: String,
    from_currency: String,
    to_currency: String,
    effective_date: Option<String>,
    state: State<'_, AppState>,
) -> Result<Option<ExchangeRateDto>, AppError> {
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
        oz_core::permissions::SETTINGS_READ,
    )?;
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
