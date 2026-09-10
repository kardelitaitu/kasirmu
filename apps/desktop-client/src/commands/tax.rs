//! Tax rate configuration commands.
//!
//! These commands provide CRUD access to the `tax_rates` table and
//! category-level tax rate assignments for the TaxConfigurationScreen
//! front-end.
//!
//! Wave A / S5: the bodies now live in the headless `oz_bridge::tax` module.
//! Each `#[tauri::command]` below keeps its exact name, parameter list and
//! `Result<_, AppError>` return so the registered IPC surface and the
//! serialized error shape are unchanged; it borrows a `BridgeCtx` from
//! `AppState`, calls the bridge, and maps `BridgeError` back to `AppError`
//! variant-for-variant. The DTOs moved with the bodies and are re-exported so
//! `use super::*` in `tax_tests.rs` still resolves them, and the `run_*`
//! helpers stay here as thin `AppError`-returning adapters because the
//! sibling test module calls them directly and matches on `AppError::Core`.
//!
//! The permission gate (TAX-01) and store resolution run inside the bridge, in
//! the same order as before: resolve the session, authorize the user against
//! the GLOBAL identity DB (`Store::require_permission`, non-scope-aware — the
//! gate is deliberately unchanged), then open the store-scoped connection.

// Retained for the sibling test module, which reaches these through
// `use super::*`; the command bodies themselves no longer name them.
#[allow(unused_imports)]
use oz_core::db::Store;
#[allow(unused_imports)]
use serde::{Deserialize, Serialize};
use tauri::State;

use oz_core::tax_rate::RoundingMode;

use crate::error::AppError;
use crate::state::AppState;

pub use oz_bridge::tax::{
    CategoryTaxRateRow, CreateTaxRateArgs, SetCategoryTaxRatesArgs, TaxRateDependencyCountsDto,
    TaxRateDto, TaxRateScopeDto, TaxRateWindowDto, UpdateTaxRateArgs,
};

/// Verify a tax permission against the global identity database.
///
/// Thin adapter over `oz_bridge::tax::require_tax_permission`: the name,
/// parameter list and `Result<_, AppError>` type are unchanged so the sibling
/// test module keeps exercising the global-identity-DB gate (ADR #4 / ADR #7)
/// through `AppState`.
#[allow(dead_code)] // retained by the Wave-A extraction contract for sibling tests
async fn require_tax_permission(
    state: &AppState,
    user_id: &str,
    permission: &str,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::tax::require_tax_permission(&ctx, user_id, permission)
        .await
        .map_err(AppError::from)
}

// ── Tax Rate CRUD ─────────────────────────────────────────────────────

/// List tax rates for the store resolved from a session token. ADR #7.
///
/// TAX-01: session-scoped read with `SETTINGS_READ` on the backend.
#[tauri::command]
pub async fn list_tax_rates_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<TaxRateDto>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::tax::list_rates_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Business logic for listing tax rates (extracted for testing).
///
/// Thin adapter over `oz_bridge::tax::run_list_tax_rates` — unchanged name,
/// parameter list and `Result<_, AppError>` type so the sibling test module
/// keeps matching on `AppError::Core`. The bridge joins
/// `list_tax_rate_scopes()` so each row carries its authoring scope and
/// validity window (Option B side-channel composition: the core `TaxRate`
/// struct is not widened and the sync snapshot wire is untouched).
#[allow(dead_code)] // retained by the Wave-A extraction contract for sibling tests
fn run_list_tax_rates(conn: &rusqlite::Connection) -> Result<Vec<TaxRateDto>, AppError> {
    oz_bridge::tax::run_list_tax_rates(conn).map_err(AppError::from)
}

/// Create a tax rate in the store resolved from a session token. ADR #7.
///
/// TAX-01: resolves the store from the session, enforces `SETTINGS_EDIT`
/// on the backend, and rejects rates outside the bounded range (TAX-04).
#[tauri::command]
pub async fn create_tax_rate_scoped(
    session_token: String,
    args: CreateTaxRateArgs,
    state: State<'_, AppState>,
) -> Result<TaxRateDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::tax::create_rate_scoped(&ctx, &session_token, &args)
        .await
        .map_err(Into::into)
}

/// Business logic for creating a tax rate (extracted for testing).
///
/// Thin adapter over `oz_bridge::tax::run_create_tax_rate`, which routes on
/// the optional scope/window args: any of them present sends the write to the
/// tier-scoped core fn; all absent keeps the legacy global-arm write so
/// existing callers behave byte-identically. Both-set entity+location is
/// refused there, before the core could see it.
#[allow(dead_code)] // retained by the Wave-A extraction contract for sibling tests
fn run_create_tax_rate(
    conn: &rusqlite::Connection,
    args: &CreateTaxRateArgs,
) -> Result<TaxRateDto, AppError> {
    oz_bridge::tax::run_create_tax_rate(conn, args).map_err(AppError::from)
}

/// Update a tax rate in the store resolved from a session token. ADR #7.
///
/// TAX-01: resolves the store from the session and enforces
/// `SETTINGS_EDIT` on the backend.
#[tauri::command]
pub async fn update_tax_rate_scoped(
    session_token: String,
    args: UpdateTaxRateArgs,
    state: State<'_, AppState>,
) -> Result<TaxRateDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::tax::update_rate_scoped(&ctx, &session_token, &args)
        .await
        .map_err(Into::into)
}

/// Business logic for updating a tax rate (extracted for testing).
///
/// Thin adapter over `oz_bridge::tax::run_update_tax_rate` — same routing
/// rule as [`run_create_tax_rate`]. F1 SURFACING DEBT: a tier change (new
/// legal_entity_id or location_id) silently empties the vacated tier's
/// default — the UI must warn before saving, because nothing re-fills it.
#[allow(dead_code)] // retained by the Wave-A extraction contract for sibling tests
fn run_update_tax_rate(
    conn: &rusqlite::Connection,
    args: &UpdateTaxRateArgs,
) -> Result<TaxRateDto, AppError> {
    oz_bridge::tax::run_update_tax_rate(conn, args).map_err(AppError::from)
}

/// Delete (archive) a tax rate in the store resolved from a session token.
/// ADR #7.
///
/// TAX-01: resolves the store from the session and enforces
/// `SETTINGS_EDIT` on the backend.
///
/// A3 coverage guard: the core refuses with a typed `Validation` error
/// naming the location/entity when this delete would strip that tier's
/// LAST covering rate (the tenant-global tier is deliberately unguarded —
/// `Ok(None)` from the resolver is the legitimate "no tax" answer). The
/// error surfaces to the wire as `AppError::Core` with the full message.
/// F1 SURFACING DEBT: the refusal needs an author-replacement path in the
/// configuration UI — the operator must create the replacement rate BEFORE
/// the delete can succeed, not just see the refusal.
#[tauri::command]
pub async fn delete_tax_rate_scoped(
    session_token: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::tax::delete_rate_scoped(&ctx, &session_token, &id)
        .await
        .map_err(Into::into)
}

// ── Dependency Counts (TAX-03) ───────────────────────────────────────

/// Get dependency (reference) counts for a tax rate in the store resolved
/// from a session token. ADR #7.
///
/// TAX-01: session-scoped read with `SETTINGS_READ` on the backend.
/// TAX-03: the delete-confirmation UI fetches these counts before showing
/// the confirm dialog, so the operator can see exactly what archiving the
/// rate will detach (product/category assignments) and what blocks it
/// (historical sale lines).
#[tauri::command]
pub async fn get_tax_rate_dependency_counts_scoped(
    session_token: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<TaxRateDependencyCountsDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::tax::dependency_counts_scoped(&ctx, &session_token, &id)
        .await
        .map_err(Into::into)
}

// ── Category Tax Rates ───────────────────────────────────────────────

/// List category-to-tax-rate assignments for the store resolved from a
/// session token. ADR #7. TAX-01: session-scoped with `SETTINGS_READ`.
#[tauri::command]
pub async fn list_category_tax_rates_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<CategoryTaxRateRow>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::tax::list_category_rates_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Business logic for listing category tax rates (extracted for testing).
///
/// Thin adapter over `oz_bridge::tax::run_list_category_tax_rates`:
/// unchanged name, parameter list and `Result<_, AppError>` type.
#[allow(dead_code)] // retained by the Wave-A extraction contract for sibling tests
fn run_list_category_tax_rates(
    db: &rusqlite::Connection,
) -> Result<Vec<CategoryTaxRateRow>, AppError> {
    oz_bridge::tax::run_list_category_tax_rates(db).map_err(AppError::from)
}

/// Set (replace) the tax rates assigned to a category in the store resolved
/// from a session token. ADR #7. TAX-01: session-scoped with `SETTINGS_EDIT`.
#[tauri::command]
pub async fn set_category_tax_rates_scoped(
    session_token: String,
    args: SetCategoryTaxRatesArgs,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::tax::set_category_rates_scoped(&ctx, &session_token, &args)
        .await
        .map_err(Into::into)
}

// ── E1-5: statutory rounding-mode read surface ────────────────────────

/// The statutory rounding directive of each named rate row, in one batch
/// read (E1-5 read surface over the E1-2 core door). Mirrors the
/// list_tax_rate_scopes side-channel precedent: a session-scoped read,
/// gated `SETTINGS_READ`, resolving the store from the session token.
///
/// Wire: a map keyed by the requested rate ids — `"half_up"` /
/// `"truncate"` verbatim from the core RoundingMode serde spellings,
/// `null` when the row's column is `''` or the id does not match a live
/// row (both mean the store preference applies; unknown and absent read
/// identically so the lookup is never a second failure mode). The core
/// fn chunks ids below SQLite's bind limit and refuses out-of-alphabet
/// values loudly (the CHECK makes them hand-edited data).
#[tauri::command]
pub async fn list_tax_rate_rounding_modes_scoped(
    session_token: String,
    rate_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<std::collections::HashMap<String, Option<RoundingMode>>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::tax::rounding_modes_scoped(&ctx, &session_token, &rate_ids)
        .await
        .map_err(Into::into)
}

/// Business logic for the batch rounding-mode read (extracted for
/// testing, mirroring `run_list_tax_rates`).
///
/// Thin adapter over `oz_bridge::tax::run_list_tax_rate_rounding_modes`:
/// unchanged name, parameter list and `Result<_, AppError>` type, and still
/// test-only.
#[cfg(test)]
fn run_list_tax_rate_rounding_modes(
    conn: &rusqlite::Connection,
    rate_ids: &[&str],
) -> Result<std::collections::HashMap<String, Option<RoundingMode>>, AppError> {
    oz_bridge::tax::run_list_tax_rate_rounding_modes(conn, rate_ids).map_err(AppError::from)
}
