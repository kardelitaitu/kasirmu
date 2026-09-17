//! Tax rate endpoints — the hub's scoped-rate authoring door.
//!
//! `POST /api/v1/tax-rates` creates a rate, `PUT /api/v1/tax-rates/{id}`
//! rewrites one. Both accept the optional scope (`legal_entity_id` /
//! `location_id`) and window (`effective_from` / `effective_to`) fields the
//! tax-separation schema added, which makes the cloud hub the ONLY surface that
//! can author a scoped rate (manager ruling D8): the device IPC commands stay
//! tenant-global-only and `tax_rates` has no sync push path by design, so
//! without these fields a hub-created scoped rate was impossible while a
//! hub-pulled one worked.
//!
//! Scope is one-or-the-other-or-neither — [`TaxRateScope`] cannot name "both" —
//! and `is_default` is per tier, so a write claims the flag inside the tier it
//! targets and never touches another tier's default.

use axum::{
    Extension, Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use serde::Deserialize;

use oz_core::db::Store;
use oz_core::db::tax::TaxRateScope;

use oz_core::CoreError;

use crate::AppState;
use crate::auth::ApiTokenClaims;
use crate::pg::{self, TaxRateWrite};
use crate::routes::tokens::require_admin_write;

/// Request body for creating a tax rate.
///
/// The four scope/window fields are optional and additive: a body without them
/// is exactly the pre-scoping request and writes a tenant-global, never-expiring
/// row. They are request-side only — the 201 body stays the seven-field
/// `TaxRate`, and the hub→device snapshot struct is untouched.
#[derive(Debug, Deserialize)]
pub struct CreateTaxRateRequest {
    /// Tax rate display name.
    pub name: String,
    /// Rate in basis points (e.g. 1000 = 10%).
    pub rate_bps: i64,
    /// Whether this is the default rate FOR ITS OWN TIER. A tenant-global
    /// default and a location default coexist; this flag never reaches across
    /// tiers.
    pub is_default: bool,
    /// Whether tax is inclusive of the listed price.
    pub is_inclusive: bool,
    /// Scope: the legal entity this rate applies to. Mutually exclusive with
    /// `location_id`; `None` on both arms is the tenant-global tier.
    #[serde(default)]
    pub legal_entity_id: Option<String>,
    /// Scope: the location this rate applies to, outranking the entity row
    /// above it. Mutually exclusive with `legal_entity_id`.
    #[serde(default)]
    pub location_id: Option<String>,
    /// Inclusive first business date, strict `YYYY-MM-DD`. `None` = no lower
    /// bound.
    #[serde(default)]
    pub effective_from: Option<String>,
    /// EXCLUSIVE last business date, strict `YYYY-MM-DD` — the rate stops
    /// applying ON this day. `None` = does not expire.
    #[serde(default)]
    pub effective_to: Option<String>,
    /// E1-9: statutory rounding mode priced with this rate. ```''``` or
    /// omitted = store preference applies; `half_up` and `truncate` are the
    /// statutory modes. Anything else is a 400 — the same three-value set
    /// the tax_rates CHECK (migration 20260929) enforces at the branch.
    #[serde(default)]
    pub rounding_mode: Option<String>,
}

/// Request body for updating a tax rate.
///
/// Same shape as [`CreateTaxRateRequest`] (both rewrite the whole row), kept as
/// its own type so the two OpenAPI bodies can drift apart if a PATCH-shaped
/// update is ever wanted. Omitting both scope arms moves the row to the
/// tenant-global tier; omitting both dates makes it unbounded — an update is a
/// rewrite, not a merge.
#[derive(Debug, Deserialize)]
pub struct UpdateTaxRateRequest {
    /// Tax rate display name.
    pub name: String,
    /// Rate in basis points (e.g. 1000 = 10%).
    pub rate_bps: i64,
    /// Whether this is the default rate for the tier being written.
    pub is_default: bool,
    /// Whether tax is inclusive of the listed price.
    pub is_inclusive: bool,
    /// Scope: the legal entity this rate applies to (`None` = not entity-scoped).
    #[serde(default)]
    pub legal_entity_id: Option<String>,
    /// Scope: the location this rate applies to (`None` = not location-scoped).
    #[serde(default)]
    pub location_id: Option<String>,
    /// Inclusive first business date, strict `YYYY-MM-DD`.
    #[serde(default)]
    pub effective_from: Option<String>,
    /// EXCLUSIVE last business date, strict `YYYY-MM-DD`.
    #[serde(default)]
    pub effective_to: Option<String>,
    /// E1-9: statutory rounding mode, same contract as the create body.
    #[serde(default)]
    pub rounding_mode: Option<String>,
}

/// Convert a [`CoreError`] from the Store into an HTTP response.
fn store_error_response(e: CoreError) -> Response {
    if let Some(resp) = default_conflict_response(&e) {
        return resp;
    }
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

/// Map a per-tier default clash into a typed 409, or `None` for other errors.
///
/// Both writers clear the tier's own default first, so reaching the partial
/// unique index means a concurrent author claimed the same tier in between — and
/// every such index is keyed on `tenant_id`, so "UNIQUE constraint failed:
/// tax_rates.tenant_id…" can only mean that clash. Left unmapped it arrives as
/// `CoreError::Db` and the operator gets a 500 for what is a normal retry.
fn default_conflict_response(e: &CoreError) -> Option<Response> {
    let CoreError::Db(rusqlite::Error::SqliteFailure(code, Some(message))) = e else {
        return None;
    };
    if code.code != rusqlite::ErrorCode::ConstraintViolation {
        return None;
    }
    if !message.starts_with("UNIQUE constraint failed: tax_rates.tenant_id") {
        return None;
    }
    Some(
        (
            StatusCode::CONFLICT,
            Json(serde_json::json!({
                "error": "this tier already has a default tax rate; retry, or set                           the default on the rate you mean to keep"
            })),
        )
            .into_response(),
    )
}

/// Refuse a scope target that is not a row of THIS tenant, before any write.
///
/// The core writers validate that a scope id exists (`db/tax.rs` runs on a
/// single-tenant device database where that is the whole question). The hub
/// shares one database across tenants, so "exists" is not enough: without this
/// filter tenant A could scope a rate to tenant B's location, and a snapshot
/// would then price B's branch under A's rule. Same message shape the Postgres
/// branch produces, so neither engine leaks which of the two cases it hit.
fn check_scope_target_sqlite(
    db: &rusqlite::Connection,
    tenant_id: &str,
    scope: &TaxRateScope,
) -> Result<(), CoreError> {
    let (table, column, target) = match scope {
        TaxRateScope::Global => return Ok(()),
        TaxRateScope::LegalEntity(id) => ("legal_entities", "legal_entity_id", id.as_str()),
        TaxRateScope::Location(id) => ("locations", "location_id", id.as_str()),
    };
    // Table and column come from the match arms above, never from the request.
    let sql = format!("SELECT tenant_id FROM {table} WHERE id = ?1");
    let owner: Option<String> = db
        .query_row(&sql, rusqlite::params![target], |row| row.get(0))
        .unwrap_or(None);
    if owner.as_deref() != Some(tenant_id) {
        return Err(CoreError::Validation {
            field: column,
            message: format!(
                "{column} '{target}' does not reference an existing {table} of this tenant"
            ),
        });
    }
    Ok(())
}

/// Resolve one request's scope + window into the write both data layers take.
///
/// Shared by both engines so the boundary rules cannot drift: a both-set scope,
/// a blank scope id, a non-`YYYY-MM-DD` arm and an empty period are all 400
/// with the same message whichever backend the hub runs on.
#[allow(clippy::result_large_err)]
fn resolve_write(
    legal_entity_id: Option<&str>,
    location_id: Option<&str>,
    effective_from: Option<&str>,
    effective_to: Option<&str>,
    rounding_mode: Option<&str>,
) -> Result<TaxRateWrite, axum::response::Response> {
    pg::validate_tax_rate_write(
        legal_entity_id,
        location_id,
        effective_from,
        effective_to,
        rounding_mode,
    )
    .map_err(|e| e.into_response())
}

/// Create a new tax rate, at a tier and window if the body asks for one.
///
/// Accepts a [`CreateTaxRateRequest`] JSON body. Returns 201 with the created
/// tax rate. The `tenant_id` from the JWT claims is stamped on the tax rate
/// row so the cloud server's snapshot endpoint can scope rates per tenant, and a
/// `legal_entity_id` / `location_id` is refused unless it is a row of that same
/// tenant.
///
/// A POST cannot change a row another POST created: re-issuing a POST with
/// different dates adds a row (how a rate change gets authored), while
/// [`update_tax_rate`] rewrites one in place.
pub async fn create_tax_rate(
    State(state): State<AppState>,
    headers: HeaderMap,
    Extension(claims): Extension<ApiTokenClaims>,
    Json(body): Json<CreateTaxRateRequest>,
) -> Response {
    // D1 residual (API-4): tax-rate creation mutates money-relevant master
    // data — gate on the operator admin key + reject terminal credentials.
    if let Err(resp) = require_admin_write(&headers, &claims, state.admin_key.as_deref()) {
        return resp;
    }

    let tenant_id = claims.tenant_id.as_deref().unwrap_or("default");

    let write = match resolve_write(
        body.legal_entity_id.as_deref(),
        body.location_id.as_deref(),
        body.effective_from.as_deref(),
        body.effective_to.as_deref(),
        body.rounding_mode.as_deref(),
    ) {
        Ok(w) => w,
        Err(resp) => return resp,
    };

    if let Some(pool) = &state.pg {
        return match crate::pg::create_tax_rate_scoped(
            pool,
            tenant_id,
            &body.name,
            body.rate_bps,
            body.is_default,
            body.is_inclusive,
            &write,
        )
        .await
        {
            Ok(rate) => (StatusCode::CREATED, Json(rate)).into_response(),
            Err(e) => e.into_response(),
        };
    }

    let db = state.db.lock().await;
    if let Err(e) = check_scope_target_sqlite(&db, tenant_id, &write.scope) {
        return store_error_response(e);
    }
    let store = Store::new(&db);

    match store.create_tax_rate_scoped(
        &body.name,
        body.rate_bps,
        body.is_default,
        body.is_inclusive,
        &write.scope,
        &write.window,
    ) {
        Ok(rate) => {
            // Stamp tenant_id from the JWT so snapshot filtering works.
            if let Err(e) = db.execute(
                "UPDATE tax_rates SET tenant_id = ?1 WHERE id = ?2",
                rusqlite::params![tenant_id, rate.id],
            ) {
                tracing::warn!(
                    tenant_id = tenant_id,
                    tax_rate_id = %rate.id,
                    error = %e,
                    "failed to stamp tenant_id on tax rate — snapshot scoping may be affected"
                );
            }
            // E1-9: core's writer has no rounding_mode parameter (device
            // IPC stays preference-only, D61 ruling 3), so the hub mirrors
            // its own tenant_id post-write stamp for a hub-authored mode.
            // '' and omitted leave the column at its '' default — no write.
            if let Some(mode) = body.rounding_mode.as_deref().filter(|m| !m.is_empty())
                && let Err(e) = db.execute(
                    "UPDATE tax_rates SET rounding_mode = ?1 WHERE id = ?2",
                    rusqlite::params![mode, rate.id],
                )
            {
                tracing::warn!(
                    tenant_id = tenant_id,
                    tax_rate_id = %rate.id,
                    error = %e,
                    "failed to stamp rounding_mode on tax rate — hub-authored mode may not reach branches"
                );
            }
            (StatusCode::CREATED, Json(rate)).into_response()
        }
        Err(e) => store_error_response(e),
    }
}

/// Rewrite an existing tax rate — its name, rate, flags, tier and window.
///
/// Accepts an [`UpdateTaxRateRequest`] JSON body for the row at
/// `/api/v1/tax-rates/{id}`. Returns 200 with the updated rate. A row of another
/// tenant and an archived row both read as 404 (`tax_rates` is a shared
/// cloud table, so the two are not distinguished — confirming another tenant's
/// id exists is not this endpoint's job, and core's archived-is-immutable rule
/// (TAX-03) uses the same shape).
pub async fn update_tax_rate(
    State(state): State<AppState>,
    headers: HeaderMap,
    Extension(claims): Extension<ApiTokenClaims>,
    Path(id): Path<String>,
    Json(body): Json<UpdateTaxRateRequest>,
) -> Response {
    // Same operator tier as the create path: master data, never a device.
    if let Err(resp) = require_admin_write(&headers, &claims, state.admin_key.as_deref()) {
        return resp;
    }

    let tenant_id = claims.tenant_id.as_deref().unwrap_or("default");

    let write = match resolve_write(
        body.legal_entity_id.as_deref(),
        body.location_id.as_deref(),
        body.effective_from.as_deref(),
        body.effective_to.as_deref(),
        body.rounding_mode.as_deref(),
    ) {
        Ok(w) => w,
        Err(resp) => return resp,
    };

    if let Some(pool) = &state.pg {
        return match crate::pg::update_tax_rate_scoped(
            pool,
            tenant_id,
            &id,
            &body.name,
            body.rate_bps,
            body.is_default,
            body.is_inclusive,
            &write,
        )
        .await
        {
            Ok(rate) => (StatusCode::OK, Json(rate)).into_response(),
            Err(e) => e.into_response(),
        };
    }

    let db = state.db.lock().await;
    if let Err(e) = check_scope_target_sqlite(&db, tenant_id, &write.scope) {
        return store_error_response(e);
    }
    // The hub shares one database: the row must belong to THIS tenant before
    // core's (device-shaped, tenant-blind) update runs on it.
    let owner: Option<String> = db
        .query_row(
            "SELECT tenant_id FROM tax_rates WHERE id = ?1 AND is_active = 1",
            rusqlite::params![id],
            |row| row.get(0),
        )
        .unwrap_or(None);
    if owner.as_deref() != Some(tenant_id) {
        return store_error_response(CoreError::NotFound {
            entity: "tax_rate",
            id: id.clone(),
        });
    }

    let store = Store::new(&db);
    match store.update_tax_rate_scoped(
        &id,
        &body.name,
        body.rate_bps,
        body.is_default,
        body.is_inclusive,
        &write.scope,
        &write.window,
    ) {
        Ok(rate) => {
            // E1-9: same mirror-stamp as the create arm — the mode was
            // boundary-validated in resolve_write, and '' is a no-op that
            // leaves the column at its store-preference default.
            if let Some(mode) = body.rounding_mode.as_deref().filter(|m| !m.is_empty())
                && let Err(e) = db.execute(
                    "UPDATE tax_rates SET rounding_mode = ?1 WHERE id = ?2",
                    rusqlite::params![mode, id],
                )
            {
                tracing::warn!(
                    tenant_id = tenant_id,
                    tax_rate_id = %id,
                    error = %e,
                    "failed to stamp rounding_mode on tax rate — hub-authored mode may not reach branches"
                );
            }
            (StatusCode::OK, Json(rate)).into_response()
        }
        Err(e) => store_error_response(e),
    }
}

#[cfg(test)]
#[path = "tax_rates_tests.rs"]
mod tests;
