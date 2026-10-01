//! Exchange-rate cloud serving layer for the cloud Postgres replica.
//!
//! Owns the `ExchangeRateDto` wire shape, the request validator, and the five
//! read/write functions the REST surface dispatches to when a PG pool is
//! configured. Every function here is reached through `crate::pg::<name>`, so
//! the re-export in `pg.rs` keeps the route handlers unchanged.
//!
//! Invariant: every statement runs inside one transaction that has already
//! set `oz.tenant_id` LOCAL, exactly like the rest of the `pg` module.

use deadpool_postgres::Pool;
use tokio_postgres::error::SqlState;

use kasirmu_core::Currency;

use super::PgError;
use super::helpers::{is_unique_violation, now_rfc3339};

// ARCH-01-family repair (2026-08-31): the exchange-rate commands existed
// only as Tauri IPC + dev-mock — the cloud had no REST counterpart, so
// web deployments could not read or manage rates at all. The cloud
// `exchange_rates` table is GLOBAL reference data (no `tenant_id`, no
// RLS — same treatment as `categories`/`currencies`), so these handlers
// are tenant-agnostic by schema design.

/// Wire shape mirroring `modules_currency::ExchangeRateRow`.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ExchangeRateDto {
    /// Row id (UUID v7).
    pub id: String,
    /// ISO-4217 alpha-3 source currency code.
    pub from_currency: String,
    /// ISO-4217 alpha-3 target currency code.
    pub to_currency: String,
    /// Fixed-point rate at 6-decimal scale (strictly positive).
    pub rate_millionths: i64,
    /// Provenance label (`manual`, `api`, …).
    pub source: String,
    /// `YYYY-MM-DD` effective date.
    pub effective_date: String,
    /// RFC-3339 creation timestamp.
    pub created_at: String,
}

const EXCHANGE_RATE_COLS: &str =
    "id, from_currency, to_currency, rate_millionths, source, effective_date, created_at";

fn row_to_exchange_rate(row: &tokio_postgres::Row) -> ExchangeRateDto {
    ExchangeRateDto {
        id: row.get(0),
        from_currency: row.get(1),
        to_currency: row.get(2),
        rate_millionths: row.get(3),
        source: row.get(4),
        effective_date: row.get(5),
        created_at: row.get(6),
    }
}

/// Validate a create-rate request exactly like the desktop/tablet
/// command layer (`validate_create_rate_args`, CUR-05) so the REST and
/// IPC surfaces cannot drift: ISO-4217 codes, distinct pair, strictly
/// positive rate, optional strict `YYYY-MM-DD` effective date.
pub fn validate_exchange_rate_request(
    from_currency: &str,
    to_currency: &str,
    rate_millionths: i64,
    effective_date: Option<&str>,
) -> Result<(), PgError> {
    if from_currency.trim().is_empty() {
        return Err(PgError::Validation(
            "from_currency must not be empty".into(),
        ));
    }
    if to_currency.trim().is_empty() {
        return Err(PgError::Validation("to_currency must not be empty".into()));
    }
    if from_currency.parse::<Currency>().is_err() {
        return Err(PgError::Validation(format!(
            "invalid ISO-4217 from_currency: {from_currency}"
        )));
    }
    if to_currency.parse::<Currency>().is_err() {
        return Err(PgError::Validation(format!(
            "invalid ISO-4217 to_currency: {to_currency}"
        )));
    }
    if from_currency == to_currency {
        return Err(PgError::Validation(
            "from_currency and to_currency must differ".into(),
        ));
    }
    if rate_millionths <= 0 {
        return Err(PgError::Validation(
            "rate_millionths must be strictly positive".into(),
        ));
    }
    if let Some(d) = effective_date {
        // Same parser as the command layer (CUR-05): chrono's %Y-%m-%d,
        // which accepts non-zero-padded forms like "2026-8-1" — REST and
        // IPC must not disagree on what a valid date is.
        chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").map_err(|_| {
            PgError::Validation(format!("effective_date must be YYYY-MM-DD, got {d}"))
        })?;
    }
    Ok(())
}

/// Full rate history, ordered like the local repository (CUR-04):
/// pair-major, newest effective date first WITHIN each pair.
pub async fn list_exchange_rates_pg(pool: &Pool) -> Result<Vec<ExchangeRateDto>, PgError> {
    let client = pool.get().await.map_err(|e| PgError::Db(e.to_string()))?;
    let rows = client
        .query(
            &format!(
                "SELECT {EXCHANGE_RATE_COLS} FROM exchange_rates
                 ORDER BY from_currency, to_currency, effective_date DESC, created_at DESC"
            ),
            &[],
        )
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    Ok(rows.iter().map(row_to_exchange_rate).collect())
}

/// The CURRENT rate for every pair (CUR-11) — one row per
/// `(from_currency, to_currency)`. `UNIQUE(pair, effective_date)` makes
/// within-pair ties impossible, so the ordering is deterministic without
/// a rowid-style tail (PG has no rowid; ids are UUIDs).
pub async fn list_latest_exchange_rates_pg(pool: &Pool) -> Result<Vec<ExchangeRateDto>, PgError> {
    let client = pool.get().await.map_err(|e| PgError::Db(e.to_string()))?;
    let rows = client
        .query(
            "SELECT er.id, er.from_currency, er.to_currency, er.rate_millionths,
                    er.source, er.effective_date, er.created_at
             FROM exchange_rates er
             WHERE er.id = (
                 SELECT e2.id FROM exchange_rates e2
                 WHERE e2.from_currency = er.from_currency
                   AND e2.to_currency = er.to_currency
                 ORDER BY e2.effective_date DESC, e2.created_at DESC
                 LIMIT 1
             )
             ORDER BY er.from_currency, er.to_currency",
            &[],
        )
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    Ok(rows.iter().map(row_to_exchange_rate).collect())
}

/// The newest rate for one pair, `NotFound` when the pair is unknown
/// (mirrors `get_latest_exchange_rate_scoped`).
pub async fn get_latest_exchange_rate_pg(
    pool: &Pool,
    from_currency: &str,
    to_currency: &str,
) -> Result<ExchangeRateDto, PgError> {
    let client = pool.get().await.map_err(|e| PgError::Db(e.to_string()))?;
    let row = client
        .query_opt(
            "SELECT id, from_currency, to_currency, rate_millionths, source, effective_date, created_at
             FROM exchange_rates
             WHERE from_currency = $1 AND to_currency = $2
             ORDER BY effective_date DESC, created_at DESC
             LIMIT 1",
            &[&from_currency.to_string(), &to_currency.to_string()],
        )
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    row.as_ref()
        .map(row_to_exchange_rate)
        .ok_or(PgError::NotFound)
}

/// Create a rate. Callers must run [`validate_exchange_rate_request`]
/// first; a duplicate `(from, to, effective_date)` maps to 409 and an
/// unseeded currency (FK on `currencies.code`) to 400.
pub async fn create_exchange_rate_pg(
    pool: &Pool,
    from_currency: &str,
    to_currency: &str,
    rate_millionths: i64,
    source: &str,
    effective_date: &str,
) -> Result<ExchangeRateDto, PgError> {
    let client = pool.get().await.map_err(|e| PgError::Db(e.to_string()))?;
    let id = uuid::Uuid::now_v7().to_string();
    let now = now_rfc3339();
    let source = if source.trim().is_empty() {
        "manual"
    } else {
        source.trim()
    }
    .to_string();
    let from = from_currency.trim().to_uppercase();
    let to = to_currency.trim().to_uppercase();
    let date = effective_date.to_string();
    if let Err(e) = client
        .execute(
            "INSERT INTO exchange_rates (id, from_currency, to_currency, rate_millionths, source, effective_date, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)",
            &[&id, &from, &to, &rate_millionths, &source, &date, &now],
        )
        .await
    {
        if is_unique_violation(&e) {
            return Err(PgError::Conflict);
        }
        // FK violation on currencies(code) — a non-seeded currency.
        if e.code() == Some(&SqlState::FOREIGN_KEY_VIOLATION) {
            return Err(PgError::Validation(
                "from_currency/to_currency must be seeded currencies".into(),
            ));
        }
        return Err(PgError::Db(e.to_string()));
    }
    Ok(ExchangeRateDto {
        id,
        from_currency: from.clone(),
        to_currency: to.clone(),
        rate_millionths,
        source,
        effective_date: date,
        created_at: now,
    })
}

/// Delete a rate by id; `NotFound` when nothing matched (mirrors the
/// scoped IPC command).
pub async fn delete_exchange_rate_pg(pool: &Pool, id: &str) -> Result<(), PgError> {
    let client = pool.get().await.map_err(|e| PgError::Db(e.to_string()))?;
    let n = client
        .execute(
            "DELETE FROM exchange_rates WHERE id = $1",
            &[&id.to_string()],
        )
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    if n == 0 {
        return Err(PgError::NotFound);
    }
    Ok(())
}
