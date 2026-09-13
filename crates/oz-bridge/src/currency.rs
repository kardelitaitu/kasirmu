//! Currency and exchange-rate command bodies (Wave A / S4) — the tauri-free
//! half of commands/currencies.rs and commands/exchange_rates.rs.
//!
//! Key functions: the pure validators and info lookup, plus the global-database
//! list/get/set operations and their session-scoped counterparts, each
//! consuming a BridgeCtx.
//!
//! Gate order, database selection and error paths are verbatim ports of the
//! command bodies. The eight legacy commands keep operating on the GLOBAL
//! database through lock_global — no session requirement is invented for them.
//! Store construction stays cache-free (Store::new) exactly as the shell used
//! it, and the ADR #48 business-date resolution differs deliberately between
//! the global path (raw UTC) and the scoped path (store IANA zone).

use foundation::validate_not_empty;
use serde::{Deserialize, Serialize};

use modules_currency::commands::{CreateExchangeRateArgs, CurrencyDto, ExchangeRateDto};
use modules_currency::repository::CurrencyRepository;
use oz_core::db::Store;
use oz_core::permissions;

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

/// Currency info returned to the front-end for formatting.
#[derive(Debug, Serialize)]
pub struct CurrencyInfo {
    /// ISO-4217 alpha-3 code, e.g. "USD".
    pub code: String,
    /// Minor-unit exponent (decimal places), e.g. 2 for USD.
    pub exponent: u32,
}

/// Arguments for setting the default currency.
#[derive(Debug, Deserialize)]
pub struct SetDefaultCurrencyArgs {
    /// Code.
    pub code: String,
}

/// Currency info for a code. Pure: needs no database and no session.
pub fn currency_info(code: &str) -> Result<CurrencyInfo, BridgeError> {
    let currency: oz_core::Currency = code
        .parse()
        .map_err(|_| BridgeError::Invalid(format!("invalid currency code: {code}")))?;
    Ok(CurrencyInfo {
        code: String::from_utf8_lossy(&currency.0).into_owned(),
        exponent: currency.minor_unit_exponent(),
    })
}

/// Session-scoped variant of currency_info: the session is resolved (so an
/// unknown token still fails) but carries no further meaning, as before.
pub async fn currency_info_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    code: &str,
) -> Result<CurrencyInfo, BridgeError> {
    let _session = ctx.resolve_session(session_token)?;
    currency_info(code)
}

/// List currencies from the global database.
pub async fn list_currencies(ctx: &BridgeCtx<'_>) -> Result<Vec<CurrencyDto>, BridgeError> {
    let db = ctx.lock_global().await;
    let repo = CurrencyRepository::new(&db);
    Ok(repo.list_currencies()?)
}

/// List currencies in the store resolved from a session token. ADR #7.
pub async fn list_currencies_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<Vec<CurrencyDto>, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let repo = CurrencyRepository::new(&db);
    Ok(repo.list_currencies()?)
}

/// Get the default currency from the global database.
pub async fn get_default_currency(ctx: &BridgeCtx<'_>) -> Result<Option<String>, BridgeError> {
    let db = ctx.lock_global().await;
    let repo = CurrencyRepository::new(&db);
    Ok(repo.get_default_currency()?)
}

/// Set the default currency in the global database.
pub async fn set_default_currency(ctx: &BridgeCtx<'_>, code: &str) -> Result<(), BridgeError> {
    let db = ctx.lock_global().await;
    let repo = CurrencyRepository::new(&db);
    repo.set_default_currency(code)?;
    Ok(())
}

/// Get the default currency in the store resolved from a session token. ADR #7.
///
/// CUR-03: resolves the store from the session and enforces SETTINGS_READ on
/// the backend.
pub async fn get_default_currency_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<Option<String>, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::SETTINGS_READ)
        .await?;
    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let repo = CurrencyRepository::new(&db);
    let out = repo.get_default_currency()?;
    drop(db);
    Ok(out)
}

/// Set the default currency in the store resolved from a session token. ADR #7.
///
/// CUR-03: validates the code before anything else, then resolves the session
/// and enforces SETTINGS_EDIT, mirroring the shell order exactly.
pub async fn set_default_currency_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: &SetDefaultCurrencyArgs,
) -> Result<(), BridgeError> {
    args.code
        .parse::<oz_core::Currency>()
        .map_err(|_| BridgeError::Invalid(format!("invalid currency code: {}", args.code)))?;
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::SETTINGS_EDIT)
        .await?;
    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let repo = CurrencyRepository::new(&db);
    repo.set_default_currency(&args.code)?;
    drop(db);
    Ok(())
}

/// Shared validation for exchange-rate creation (CUR-05), used by both the
/// legacy and scoped paths so the two cannot drift.
pub fn validate_create_rate_args(args: &CreateExchangeRateArgs) -> Result<(), BridgeError> {
    validate_not_empty("from_currency", &args.from_currency)
        .map_err(|e| BridgeError::Invalid(e.to_string()))?;
    validate_not_empty("to_currency", &args.to_currency)
        .map_err(|e| BridgeError::Invalid(e.to_string()))?;
    if args.rate_millionths <= 0 {
        return Err(BridgeError::Invalid(
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
        return Err(BridgeError::Invalid(
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
            BridgeError::Invalid(format!("{field}: not a valid ISO-4217 currency code"))
        })?;
    }
    if let Some(date) = &args.effective_date {
        chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").map_err(|_| {
            BridgeError::Invalid(format!("effective_date: must be YYYY-MM-DD, got {date}"))
        })?;
    }
    Ok(())
}

/// List exchange rates from the global database.
pub async fn list_exchange_rates(ctx: &BridgeCtx<'_>) -> Result<Vec<ExchangeRateDto>, BridgeError> {
    let db = ctx.lock_global().await;
    let repo = CurrencyRepository::new(&db);
    let rows = repo.list_exchange_rates()?;
    Ok(rows.into_iter().map(ExchangeRateDto::from).collect())
}

/// Create a global exchange rate.
///
/// Legacy compatibility command: it operates on the global catalog database,
/// which carries no store or location context, so effective_date defaults to
/// the UTC business date. That is the deliberate, documented contract for the
/// global path — see ADR #48 (Decision 3). Do not fix this to a timezone: with
/// no store in scope there is no location whose zone could apply.
pub async fn create_exchange_rate(
    ctx: &BridgeCtx<'_>,
    args: &CreateExchangeRateArgs,
) -> Result<ExchangeRateDto, BridgeError> {
    validate_create_rate_args(args)?;
    let db = ctx.lock_global().await;
    let repo = CurrencyRepository::new(&db);
    let date = args
        .effective_date
        .clone()
        .unwrap_or_else(|| chrono::Utc::now().format("%Y-%m-%d").to_string());
    let source = args.source.clone().unwrap_or_else(|| "manual".to_string());
    let row = repo.create_exchange_rate(
        &args.from_currency,
        &args.to_currency,
        args.rate_millionths,
        &source,
        &date,
    )?;
    Ok(ExchangeRateDto::from(row))
}

/// Delete an exchange rate from the global database.
pub async fn delete_exchange_rate(ctx: &BridgeCtx<'_>, id: &str) -> Result<(), BridgeError> {
    let db = ctx.lock_global().await;
    let repo = CurrencyRepository::new(&db);
    repo.delete_exchange_rate(id)?;
    Ok(())
}

/// List exchange rates in the store resolved from a session token. ADR #7.
pub async fn list_exchange_rates_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<Vec<ExchangeRateDto>, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::SETTINGS_READ)
        .await?;
    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let repo = CurrencyRepository::new(&db);
    let rows = repo.list_exchange_rates()?;
    drop(db);
    Ok(rows.into_iter().map(ExchangeRateDto::from).collect())
}

/// The current rate for every pair (CUR-11), store resolved from a session
/// token. ADR #7. Bounded counterpart to list_exchange_rates_scoped: one row
/// per currency pair, newest effective date. Same SETTINGS_READ gate.
pub async fn list_latest_exchange_rates_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<Vec<ExchangeRateDto>, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::SETTINGS_READ)
        .await?;
    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let repo = CurrencyRepository::new(&db);
    let rows = repo.list_latest_exchange_rates()?;
    drop(db);
    Ok(rows.into_iter().map(ExchangeRateDto::from).collect())
}

/// Create an exchange rate in the store resolved from a session token. ADR #7.
///
/// CUR-03 gate; CUR-05 validation shared with the legacy path. ADR #48
/// (Decision 3): the effective date defaults to the business date in the
/// store IANA zone, not raw UTC.
pub async fn create_exchange_rate_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: &CreateExchangeRateArgs,
) -> Result<ExchangeRateDto, BridgeError> {
    validate_create_rate_args(args)?;
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::SETTINGS_EDIT)
        .await?;
    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let repo = CurrencyRepository::new(&db);
    let timezone = Store::new(&db)
        .get_location_profile(&session.store_id)
        .ok()
        .flatten()
        .map(|p| p.timezone)
        .unwrap_or_else(|| "UTC".to_string());
    let date = args
        .effective_date
        .clone()
        .unwrap_or_else(|| oz_core::timezone::business_date_in_zone(chrono::Utc::now(), &timezone));
    let source = args.source.clone().unwrap_or_else(|| "manual".to_string());
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
pub async fn delete_exchange_rate_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    id: &str,
) -> Result<(), BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::SETTINGS_EDIT)
        .await?;
    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let repo = CurrencyRepository::new(&db);
    repo.delete_exchange_rate(id)?;
    drop(db);
    Ok(())
}

/// Return the latest exchange rate for a pair effective on/before
/// effective_date in the session store (CUR-04). Enforces SETTINGS_READ; when
/// no date is supplied the store business date is used, per ADR #48.
pub async fn get_latest_exchange_rate_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    from_currency: &str,
    to_currency: &str,
    effective_date: Option<String>,
) -> Result<Option<ExchangeRateDto>, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::SETTINGS_READ)
        .await?;
    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
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
    let row = repo.get_latest_exchange_rate(from_currency, to_currency, &as_of)?;
    drop(db);
    Ok(row.map(ExchangeRateDto::from))
}

#[cfg(test)]
#[path = "currency_tests.rs"]
mod tests;
