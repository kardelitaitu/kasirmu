//! Exchange-rate endpoints (ARCH-01-family repair, 2026-08-31).
//!
//! The rate commands existed only as Tauri IPC + dev-mock; the cloud had
//! no REST counterpart, so web deployments could not read or manage
//! rates. These routes mirror the scoped IPC surface 1:1:
//!
//! `GET    /api/v1/exchange-rates`                    — full history (CUR-04 order)
//! `GET    /api/v1/exchange-rates/latest`             — one row per pair (CUR-11)
//! `GET    /api/v1/exchange-rates/latest/{from}/{to}` — newest rate for a pair
//! `POST   /api/v1/exchange-rates`                    — create (CUR-05 validation)
//! `DELETE /api/v1/exchange-rates/{id}`               — delete
//!
//! Rates are GLOBAL reference data in the cloud schema (no `tenant_id`,
//! no RLS — same treatment as `categories`), so no tenant stamping here.

use axum::{
    Extension, Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use serde::Deserialize;

use modules_currency::repository::CurrencyRepository;
use oz_core::CoreError;

use crate::AppState;
use crate::auth::ApiTokenClaims;
use crate::pg::{self, ExchangeRateDto};
use crate::routes::tokens::require_admin_write;

/// Convert a [`CoreError`] from the SQLite fallback path into an HTTP
/// response — same mapping as the tax-rates route (kept local per the
/// routes-module convention).
fn store_error_response(e: CoreError) -> Response {
    match e {
        CoreError::Validation { message, .. } => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": message})),
        )
            .into_response(),
        CoreError::Conflict { .. } => (
            StatusCode::CONFLICT,
            Json(serde_json::json!({"error": "resource already exists"})),
        )
            .into_response(),
        CoreError::NotFound { .. } => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "not found"})),
        )
            .into_response(),
        e => {
            tracing::error!("unexpected store error: {e}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal error"})),
            )
                .into_response()
        }
    }
}

/// Request body for creating an exchange rate — same field names and
/// semantics as the IPC `CreateExchangeRateArgs` (CUR-05).
#[derive(Deserialize)]
pub struct CreateExchangeRateRequest {
    /// ISO-4217 alpha-3 source code.
    pub from_currency: String,
    /// ISO-4217 alpha-3 target code.
    pub to_currency: String,
    /// Fixed-point rate at 6-decimal scale, strictly positive.
    pub rate_millionths: i64,
    /// Provenance label; defaults to `manual` when absent.
    #[serde(default)]
    pub source: String,
    /// `YYYY-MM-DD`; defaults to today (UTC) when absent, mirroring the
    /// IPC command's optional-date behavior.
    #[serde(default)]
    pub effective_date: Option<String>,
}

fn rate_dto_from_row(r: modules_currency::ExchangeRateRow) -> ExchangeRateDto {
    ExchangeRateDto {
        id: r.id,
        from_currency: r.from_currency,
        to_currency: r.to_currency,
        rate_millionths: r.rate_millionths,
        source: r.source,
        effective_date: r.effective_date,
        created_at: r.created_at,
    }
}

/// `GET /api/v1/exchange-rates`
pub async fn list_rates(State(state): State<AppState>) -> Response {
    if let Some(pool) = &state.pg {
        return match pg::list_exchange_rates_pg(pool).await {
            Ok(rows) => (StatusCode::OK, Json(rows)).into_response(),
            Err(e) => e.into_response(),
        };
    }
    let db = state.db.lock().await;
    let repo = CurrencyRepository::new(&db);
    match repo.list_exchange_rates() {
        Ok(rows) => {
            let out: Vec<ExchangeRateDto> = rows.into_iter().map(rate_dto_from_row).collect();
            (StatusCode::OK, Json(out)).into_response()
        }
        Err(e) => store_error_response(e.into()),
    }
}

/// `GET /api/v1/exchange-rates/latest` — CUR-11 bounded listing.
pub async fn list_latest_rates(State(state): State<AppState>) -> Response {
    if let Some(pool) = &state.pg {
        return match pg::list_latest_exchange_rates_pg(pool).await {
            Ok(rows) => (StatusCode::OK, Json(rows)).into_response(),
            Err(e) => e.into_response(),
        };
    }
    let db = state.db.lock().await;
    let repo = CurrencyRepository::new(&db);
    match repo.list_latest_exchange_rates() {
        Ok(rows) => {
            let out: Vec<ExchangeRateDto> = rows.into_iter().map(rate_dto_from_row).collect();
            (StatusCode::OK, Json(out)).into_response()
        }
        Err(e) => store_error_response(e.into()),
    }
}

/// `GET /api/v1/exchange-rates/latest/{from}/{to}`
pub async fn latest_rate(
    State(state): State<AppState>,
    Path((from, to)): Path<(String, String)>,
) -> Response {
    let from = from.to_uppercase();
    let to = to.to_uppercase();
    if let Err(e) = pg::validate_exchange_rate_request(&from, &to, 1, None) {
        return e.into_response();
    }
    if let Some(pool) = &state.pg {
        return match pg::get_latest_exchange_rate_pg(pool, &from, &to).await {
            Ok(row) => (StatusCode::OK, Json(row)).into_response(),
            Err(e) => e.into_response(),
        };
    }
    let db = state.db.lock().await;
    let repo = CurrencyRepository::new(&db);
    // CUR-04 ordering: the pair list is newest-first, so head == latest.
    match repo.list_exchange_rates_for_pair(&from, &to) {
        Ok(rows) => match rows.into_iter().next() {
            Some(r) => (StatusCode::OK, Json(rate_dto_from_row(r))).into_response(),
            None => (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": "not found"})),
            )
                .into_response(),
        },
        Err(e) => store_error_response(e.into()),
    }
}

/// `POST /api/v1/exchange-rates`
pub async fn create_rate(
    State(state): State<AppState>,
    headers: HeaderMap,
    Extension(claims): Extension<ApiTokenClaims>,
    Json(body): Json<CreateExchangeRateRequest>,
) -> Response {
    // D1 residual (API-4): exchange-rate creation mutates money-relevant
    // master data — gate on the operator admin key + reject terminal
    // credentials.
    if let Err(resp) = require_admin_write(&headers, &claims, state.admin_key.as_deref()) {
        return resp;
    }

    let effective = body
        .effective_date
        .clone()
        .unwrap_or_else(|| chrono::Utc::now().format("%Y-%m-%d").to_string());
    // Same contract as the desktop/tablet command layer (CUR-05) —
    // shared with the pair-lookup handler above so REST cannot drift.
    if let Err(e) = pg::validate_exchange_rate_request(
        &body.from_currency,
        &body.to_currency,
        body.rate_millionths,
        Some(&effective),
    ) {
        return e.into_response();
    }
    let source = if body.source.trim().is_empty() {
        "manual"
    } else {
        body.source.trim()
    };
    if let Some(pool) = &state.pg {
        return match pg::create_exchange_rate_pg(
            pool,
            &body.from_currency,
            &body.to_currency,
            body.rate_millionths,
            source,
            &effective,
        )
        .await
        {
            Ok(row) => (StatusCode::CREATED, Json(row)).into_response(),
            Err(e) => e.into_response(),
        };
    }
    let db = state.db.lock().await;
    let repo = CurrencyRepository::new(&db);
    // Duplicate (pair, effective_date) → 409, mirroring the PG path's
    // unique-violation mapping. The repository surfaces the constraint
    // as a raw Db error; the check runs under the same store lock as
    // the INSERT, so it is race-free here.
    //
    // A `false` below is AMBIGUOUS: it means either genuinely no
    // duplicate or a failed lookup. The fall-through is deliberate —
    // the INSERT's unique constraint is the write-side backstop, so a
    // failed lookup cannot double-insert; it only costs the client a
    // 500 (raw Db error) where it would have gotten a 409. The warning
    // is how you tell the two cases apart; keep it loud.
    let duplicate = match repo.list_exchange_rates_for_pair(&body.from_currency, &body.to_currency)
    {
        Ok(rows) => rows.iter().any(|r| r.effective_date == effective),
        Err(e) => {
            tracing::warn!(
                tenant_id = claims.tenant_id.as_deref().unwrap_or("default"),
                operation = "CurrencyRepository::list_exchange_rates_for_pair",
                error = %e,
                "exchange-rates create: duplicate lookup failed, falling through to the INSERT (unique constraint is the backstop)"
            );
            false
        }
    };
    if duplicate {
        return (
            StatusCode::CONFLICT,
            Json(serde_json::json!({"error": "resource already exists"})),
        )
            .into_response();
    }
    match repo.create_exchange_rate(
        &body.from_currency,
        &body.to_currency,
        body.rate_millionths,
        source,
        &effective,
    ) {
        Ok(row) => (StatusCode::CREATED, Json(rate_dto_from_row(row))).into_response(),
        Err(e) => store_error_response(e.into()),
    }
}

/// `DELETE /api/v1/exchange-rates/{id}`
pub async fn delete_rate(
    State(state): State<AppState>,
    headers: HeaderMap,
    Extension(claims): Extension<ApiTokenClaims>,
    Path(id): Path<String>,
) -> Response {
    // D1 residual (API-4): rate deletion mutates money-relevant master
    // data — gate on the operator admin key + reject terminal credentials.
    if let Err(resp) = require_admin_write(&headers, &claims, state.admin_key.as_deref()) {
        return resp;
    }

    if let Some(pool) = &state.pg {
        return match pg::delete_exchange_rate_pg(pool, &id).await {
            Ok(()) => StatusCode::NO_CONTENT.into_response(),
            Err(e) => e.into_response(),
        };
    }
    let db = state.db.lock().await;
    let repo = CurrencyRepository::new(&db);
    match repo.delete_exchange_rate(&id) {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => store_error_response(e.into()),
    }
}

#[cfg(test)]
#[path = "exchange_rates_tests.rs"]
mod tests;
