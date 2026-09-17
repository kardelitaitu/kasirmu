//! Tax-rate command bodies (Wave A / S5) — the tauri-free half of
//! `apps/desktop-client/src/commands/tax.rs`.
//!
//! Key types: the rate/scope/window DTOs the TaxConfigurationScreen consumes.
//! Key functions: the pure `&Connection` bodies (`run_list_tax_rates`,
//! [`run_create_tax_rate`], [`run_update_tax_rate`],
//! [`run_list_category_tax_rates`], [`run_list_tax_rate_rounding_modes`])
//! and the eight session-scoped operations that wrap them, each consuming a
//! [`BridgeCtx`].
//!
//! Gate order, store construction (`Store::new`, cache-free — as the shell
//! used) and error paths are verbatim ports of the command bodies: a shim
//! builds the context, calls one function here, and maps [`BridgeError`]
//! back to `AppError` so the wire shape never moves.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use oz_core::db::Store;
use oz_core::db::tax::TaxRateWindow;
use oz_core::tax_rate::RoundingMode;
use rusqlite::Connection;

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

/// DTO for a tax rate sent to the front-end.
#[derive(Debug, Serialize)]
pub struct TaxRateDto {
    /// Unique identifier.
    pub id: String,
    /// Display name.
    pub name: String,
    /// Rate Bps.
    pub rate_bps: i64,
    /// Whether this is default.
    pub is_default: bool,
    /// Whether this is inclusive.
    pub is_inclusive: bool,
    /// Display Rate.
    pub display_rate: String,
    /// ISO-8601 creation timestamp.
    pub created_at: String,
    /// ISO-8601 last-update timestamp.
    pub updated_at: String,
    /// The rate's authoring scope, joined from `list_tax_rate_scopes`
    /// (Option B side-channel: the core `TaxRate` struct stays 7 fields and
    /// the sync snapshot wire is untouched). `None` only when the active
    /// row has no scope entry, which a migrated database does not produce.
    pub scope: Option<TaxRateScopeDto>,
    /// The rate's validity window, joined the same way.
    pub window: Option<TaxRateWindowDto>,
}

/// The authoring scope of a tax-rate row, in wire form.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaxRateScopeDto {
    /// `global` | `legal_entity` | `location`.
    pub scope: String,
    /// The owning legal entity, for entity-scoped rows.
    pub legal_entity_id: Option<String>,
    /// The owning location, for location-scoped rows.
    pub location_id: Option<String>,
}

/// The validity window of a tax-rate row, in wire form.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaxRateWindowDto {
    /// Inclusive first business date, `YYYY-MM-DD`. `None` = no lower bound.
    pub effective_from: Option<String>,
    /// EXCLUSIVE last business date, `YYYY-MM-DD`. `None` = never expires.
    pub effective_to: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
/// Createtaxrateargs.
pub struct CreateTaxRateArgs {
    /// Display name.
    pub name: String,
    /// Rate Bps.
    pub rate_bps: i64,
    /// Whether this is default.
    pub is_default: bool,
    /// Whether this is inclusive.
    pub is_inclusive: bool,
    /// Scope the rate to this legal entity (mutually exclusive with
    /// `location_id`; omit both for the tenant-global arm).
    pub legal_entity_id: Option<String>,
    /// Scope the rate to this location (mutually exclusive with
    /// `legal_entity_id`).
    pub location_id: Option<String>,
    /// Inclusive first business date, `YYYY-MM-DD`. Strict; `None` = no
    /// lower bound.
    pub effective_from: Option<String>,
    /// EXCLUSIVE last business date, `YYYY-MM-DD`. Strict; `None` = never
    /// expires.
    pub effective_to: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
/// Updatetaxrateargs.
pub struct UpdateTaxRateArgs {
    /// Unique identifier.
    pub id: String,
    /// Display name.
    pub name: String,
    /// Rate Bps.
    pub rate_bps: i64,
    /// Whether this is default.
    pub is_default: bool,
    /// Whether this is inclusive.
    pub is_inclusive: bool,
    /// New scope for the rate (mutually exclusive with `location_id`).
    /// F1 SURFACING DEBT: moving a rate between tiers silently empties the
    /// vacated tier's default — the configuration UI must warn.
    pub legal_entity_id: Option<String>,
    /// New location scope (mutually exclusive with `legal_entity_id`).
    pub location_id: Option<String>,
    /// New inclusive first business date, `YYYY-MM-DD`.
    pub effective_from: Option<String>,
    /// New exclusive last business date, `YYYY-MM-DD`.
    pub effective_to: Option<String>,
}

#[derive(Debug, Deserialize)]
/// Setcategorytaxratesargs.
pub struct SetCategoryTaxRatesArgs {
    /// ID of the associated category.
    pub category_id: String,
    /// Tax Rate Ids.
    pub tax_rate_ids: Vec<String>,
}

#[derive(Debug, Serialize)]
/// Categorytaxraterow.
pub struct CategoryTaxRateRow {
    /// ID of the associated category.
    pub category_id: String,
    /// Tax Rate Ids.
    pub tax_rate_ids: Vec<String>,
}

/// DTO for tax-rate reference counts sent to the front-end.
///
/// # Wire
///
/// Deliberately **snake_case, with no `rename_all`**. The renderer reads
/// `sale_lines` — declared at `ui/src/api/tax.ts:114` and consumed by the
/// tax configuration screen's delete guard, whose Confirm button is
/// `disabled={(pendingDeleteCounts?.sale_lines ?? 0) > 0}`. This type used to
/// carry `rename_all = "camelCase"`, which emitted `saleLines` instead, so the
/// guard read `undefined`, `undefined > 0` is `false`, and the dialog offered a
/// rate that historical sale lines reference with no warning and a live Confirm
/// button. The backend refused the delete anyway
/// (`crates/kasirmu-core/src/db/tax/rates.rs:359`), which is why the bug cost the
/// operator the warning rather than the data — and why nothing surfaced it:
/// two of these three fields are single words, so they are spelled the same in
/// either convention, and only the key that gated the button moved.
///
/// Pinned by `tax_rate_dependency_counts_wire_is_the_key_the_delete_guard_reads`
/// against the renderer's declaration, not against this file.
#[derive(Debug, Serialize)]
pub struct TaxRateDependencyCountsDto {
    /// Number of product assignments referencing this rate.
    pub products: i64,
    /// Number of category assignments referencing this rate.
    pub categories: i64,
    /// Number of historical sale lines referencing this rate.
    pub sale_lines: i64,
}

/// Map a gate denial to the client's `permissionDenied` wire shape.
///
/// Local mirror of the private helper in [`crate::ctx`]: the tax write gates
/// use `Store::require_permission` (not the scope-aware form), so they need
/// the same `PermissionDenied` → [`BridgeError::PermissionDenied`]
/// translation the authz seam applies.
fn map_gate_error(e: oz_core::CoreError) -> BridgeError {
    match e {
        oz_core::CoreError::PermissionDenied(message) => BridgeError::PermissionDenied(message),
        other => BridgeError::from(other),
    }
}

/// Verify a tax permission against the global identity database.
///
/// Users and roles are global authentication records (ADR #4 / ADR #7); tax
/// business data is read from the store-scoped connection after this check
/// succeeds. Verbatim port of `require_tax_permission` in the desktop command
/// module: same global-DB `Store::new`, same non-scope-aware
/// `require_permission`, so a legacy user without an assignment row keeps
/// behaving exactly as before.
///
/// # Errors
///
/// Returns [`BridgeError::PermissionDenied`] when the user is missing,
/// inactive, or the role does not grant `permission`; [`BridgeError::Core`]
/// on DB errors.
pub async fn require_tax_permission(
    ctx: &BridgeCtx<'_>,
    user_id: &str,
    permission: &str,
) -> Result<(), BridgeError> {
    let db = ctx.lock_global().await;
    let store = Store::new(&db);
    store
        .require_permission(user_id, permission)
        .map_err(map_gate_error)
}

/// Project a core scope onto its wire form.
fn scope_dto(s: &oz_core::db::tax::TaxRateScope) -> TaxRateScopeDto {
    use oz_core::db::tax::TaxRateScope;
    match s {
        TaxRateScope::Global => TaxRateScopeDto {
            scope: "global".into(),
            legal_entity_id: None,
            location_id: None,
        },
        TaxRateScope::LegalEntity(id) => TaxRateScopeDto {
            scope: "legal_entity".into(),
            legal_entity_id: Some(id.clone()),
            location_id: None,
        },
        TaxRateScope::Location(id) => TaxRateScopeDto {
            scope: "location".into(),
            legal_entity_id: None,
            location_id: Some(id.clone()),
        },
    }
}

/// Project a core validity window onto its wire form.
fn window_dto(w: &oz_core::db::tax::TaxRateWindow) -> TaxRateWindowDto {
    TaxRateWindowDto {
        effective_from: w.effective_from.clone(),
        effective_to: w.effective_to.clone(),
    }
}

/// Project a core `TaxRate` onto the wire DTO, with scope/window unfilled.
fn to_dto(r: oz_core::tax_rate::TaxRate) -> TaxRateDto {
    let display_rate = r.display_rate();
    TaxRateDto {
        id: r.id,
        name: r.name,
        rate_bps: r.rate_bps,
        is_default: r.is_default,
        is_inclusive: r.is_inclusive,
        display_rate,
        created_at: r.created_at,
        updated_at: r.updated_at,
        scope: None,
        window: None,
    }
}

/// Resolve the optional scope args to a core scope, refusing the both-set
/// combination the core CHECK would reject anyway — at the boundary, with
/// a message that names the mistake rather than a SQLite error.
fn scoped_scope(
    legal_entity_id: Option<&str>,
    location_id: Option<&str>,
) -> Result<oz_core::db::tax::TaxRateScope, BridgeError> {
    oz_core::db::tax::TaxRateScope::classify(legal_entity_id, location_id).ok_or_else(|| {
        BridgeError::from(oz_core::CoreError::Validation {
            field: "legal_entity_id",
            message: "legal_entity_id and location_id are mutually exclusive: a tax rate                       is entity-scoped OR location-scoped OR tenant-global"
                .into(),
        })
    })
}

// ── Pure bodies ──────────────────────────────────────────────────────

/// Business logic for listing tax rates over a locked store connection.
///
/// Joins `list_tax_rate_scopes()` so each row carries its authoring scope
/// and validity window (Option B side-channel composition — the core
/// `TaxRate` struct is not widened, and the sync snapshot wire is
/// untouched: this join lives entirely in the IPC response).
///
/// # Errors
///
/// Returns [`BridgeError::Core`] when either tax query fails.
pub fn run_list_tax_rates(conn: &Connection) -> Result<Vec<TaxRateDto>, BridgeError> {
    let store = Store::new(conn);
    let rates = store.list_tax_rates()?;
    let scopes = store.list_tax_rate_scopes()?;
    let by_id: HashMap<&str, &oz_core::db::tax::TaxRateScopeInfo> =
        scopes.iter().map(|s| (s.id.as_str(), s)).collect();
    Ok(rates
        .into_iter()
        .map(|r| {
            let mut dto = to_dto(r);
            if let Some(info) = by_id.get(dto.id.as_str()) {
                dto.scope = Some(scope_dto(&info.scope));
                dto.window = Some(window_dto(&info.window));
            }
            dto
        })
        .collect())
}

/// Business logic for creating a tax rate.
///
/// Routes on the optional scope/window args: any of them present sends the
/// write to the tier-scoped core fn (`create_tax_rate_scoped`, which
/// validates the window and the scope target and clears only its own
/// tier's default); all absent keeps the legacy global-arm write so
/// existing callers behave byte-identically. Both-set entity+location is
/// refused here, before the core could see it.
///
/// # Errors
///
/// Returns [`BridgeError::Core`] for the mutual-exclusion refusal (a typed
/// `Validation` error) and for any core write failure (scope/window
/// validation, bounded-range rejection TAX-04).
pub fn run_create_tax_rate(
    conn: &Connection,
    args: &CreateTaxRateArgs,
) -> Result<TaxRateDto, BridgeError> {
    let store = Store::new(conn);
    let wants_scope = args.legal_entity_id.is_some()
        || args.location_id.is_some()
        || args.effective_from.is_some()
        || args.effective_to.is_some();
    let dto = if wants_scope {
        let scope = scoped_scope(args.legal_entity_id.as_deref(), args.location_id.as_deref())?;
        let window = TaxRateWindow {
            effective_from: args.effective_from.clone(),
            effective_to: args.effective_to.clone(),
        };
        let rate = store.create_tax_rate_scoped(
            &args.name,
            args.rate_bps,
            args.is_default,
            args.is_inclusive,
            &scope,
            &window,
        )?;
        let mut dto = to_dto(rate);
        dto.scope = Some(scope_dto(&scope));
        dto.window = Some(window_dto(&window));
        dto
    } else {
        let rate = store.create_tax_rate(
            &args.name,
            args.rate_bps,
            args.is_default,
            args.is_inclusive,
        )?;
        let mut dto = to_dto(rate);
        dto.scope = Some(scope_dto(&oz_core::db::tax::TaxRateScope::Global));
        dto.window = Some(window_dto(&TaxRateWindow {
            effective_from: None,
            effective_to: None,
        }));
        dto
    };
    Ok(dto)
}

/// Business logic for updating a tax rate.
///
/// Same routing rule as [`run_create_tax_rate`]: scope/window args present
/// route to the tier-scoped core fn, all absent keep the legacy global-arm
/// write. F1 SURFACING DEBT: a tier change (new legal_entity_id or
/// location_id) silently empties the vacated tier's default — the UI must
/// warn before saving, because nothing re-fills that tier.
///
/// # Errors
///
/// Returns [`BridgeError::Core`] for the mutual-exclusion refusal and for
/// any core write failure (validation / not-found on the rate row).
pub fn run_update_tax_rate(
    conn: &Connection,
    args: &UpdateTaxRateArgs,
) -> Result<TaxRateDto, BridgeError> {
    let store = Store::new(conn);
    let wants_scope = args.legal_entity_id.is_some()
        || args.location_id.is_some()
        || args.effective_from.is_some()
        || args.effective_to.is_some();
    let dto = if wants_scope {
        let scope = scoped_scope(args.legal_entity_id.as_deref(), args.location_id.as_deref())?;
        let window = TaxRateWindow {
            effective_from: args.effective_from.clone(),
            effective_to: args.effective_to.clone(),
        };
        let rate = store.update_tax_rate_scoped(
            &args.id,
            &args.name,
            args.rate_bps,
            args.is_default,
            args.is_inclusive,
            &scope,
            &window,
        )?;
        let mut dto = to_dto(rate);
        dto.scope = Some(scope_dto(&scope));
        dto.window = Some(window_dto(&window));
        dto
    } else {
        let rate = store.update_tax_rate(
            &args.id,
            &args.name,
            args.rate_bps,
            args.is_default,
            args.is_inclusive,
        )?;
        let mut dto = to_dto(rate);
        dto.scope = Some(scope_dto(&oz_core::db::tax::TaxRateScope::Global));
        dto.window = Some(window_dto(&TaxRateWindow {
            effective_from: None,
            effective_to: None,
        }));
        dto
    };
    Ok(dto)
}

/// Business logic for listing category tax rates over a locked connection.
///
/// # Errors
///
/// Returns [`BridgeError::Core`] when the category list or an assignment
/// lookup fails.
pub fn run_list_category_tax_rates(
    db: &Connection,
) -> Result<Vec<CategoryTaxRateRow>, BridgeError> {
    let store = Store::new(db);
    let categories = store.list_categories()?;

    let mut rows = Vec::new();
    for cat in &categories {
        let ids = store.get_category_tax_rates(&cat.id)?;
        if !ids.is_empty() {
            rows.push(CategoryTaxRateRow {
                category_id: cat.id.clone(),
                tax_rate_ids: ids,
            });
        }
    }
    Ok(rows)
}

/// Business logic for the batch rounding-mode read (mirrors
/// [`run_list_tax_rates`]).
///
/// # Errors
///
/// Returns [`BridgeError::Core`] when the batch read fails — including the
/// core's loud refusal on an out-of-alphabet stored value.
pub fn run_list_tax_rate_rounding_modes(
    conn: &Connection,
    rate_ids: &[&str],
) -> Result<HashMap<String, Option<RoundingMode>>, BridgeError> {
    let store = Store::new(conn);
    Ok(store.list_tax_rate_rounding_modes(rate_ids)?)
}

// ── Session-scoped operations ────────────────────────────────────────

/// List tax rates for the store resolved from a session token. ADR #7.
///
/// TAX-01: session-scoped read with `SETTINGS_READ` on the backend.
///
/// Gate order mirrors the command body: resolve the session, authorize the
/// user against the GLOBAL identity DB, then open the store connection and
/// read.
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for an unknown/expired token,
/// [`BridgeError::PermissionDenied`] without `SETTINGS_READ`,
/// [`BridgeError::Internal`] when the store lock is poisoned, and
/// [`BridgeError::Core`] from the read.
pub async fn list_rates_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<Vec<TaxRateDto>, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    require_tax_permission(ctx, &session.user_id, oz_core::permissions::SETTINGS_READ).await?;
    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let rows = run_list_tax_rates(&db);
    drop(db);
    rows
}

/// Create a tax rate in the store resolved from a session token. ADR #7.
///
/// TAX-01: resolves the store from the session, enforces `SETTINGS_EDIT`
/// on the backend, and rejects rates outside the bounded range (TAX-04).
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`], [`BridgeError::PermissionDenied`]
/// or [`BridgeError::Core`] (mutual exclusion / validation / range).
pub async fn create_rate_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: &CreateTaxRateArgs,
) -> Result<TaxRateDto, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    require_tax_permission(ctx, &session.user_id, oz_core::permissions::SETTINGS_EDIT).await?;
    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    run_create_tax_rate(&db, args)
}

/// Update a tax rate in the store resolved from a session token. ADR #7.
///
/// TAX-01: resolves the store from the session and enforces
/// `SETTINGS_EDIT` on the backend.
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`], [`BridgeError::PermissionDenied`]
/// or [`BridgeError::Core`] (mutual exclusion / validation / not-found).
pub async fn update_rate_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: &UpdateTaxRateArgs,
) -> Result<TaxRateDto, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    require_tax_permission(ctx, &session.user_id, oz_core::permissions::SETTINGS_EDIT).await?;
    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    run_update_tax_rate(&db, args)
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
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`], [`BridgeError::PermissionDenied`]
/// or [`BridgeError::Core`] (the coverage-guard refusal / not-found).
pub async fn delete_rate_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    id: &str,
) -> Result<(), BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    require_tax_permission(ctx, &session.user_id, oz_core::permissions::SETTINGS_EDIT).await?;
    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    store.delete_tax_rate(id)?;
    drop(db);
    Ok(())
}

/// Get dependency (reference) counts for a tax rate in the store resolved
/// from a session token. ADR #7.
///
/// TAX-01: session-scoped read with `SETTINGS_READ` on the backend.
/// TAX-03: the delete-confirmation UI fetches these counts before showing
/// the confirm dialog, so the operator can see exactly what archiving the
/// rate will detach (product/category assignments) and what blocks it
/// (historical sale lines).
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`], [`BridgeError::PermissionDenied`]
/// or [`BridgeError::Core`] (not-found on the rate row).
pub async fn dependency_counts_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    id: &str,
) -> Result<TaxRateDependencyCountsDto, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    require_tax_permission(ctx, &session.user_id, oz_core::permissions::SETTINGS_READ).await?;
    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let counts = store.tax_rate_dependency_counts(id)?;
    drop(db);
    Ok(TaxRateDependencyCountsDto {
        products: counts.products,
        categories: counts.categories,
        sale_lines: counts.sale_lines,
    })
}

/// List category-to-tax-rate assignments for the store resolved from a
/// session token. ADR #7. TAX-01: session-scoped with `SETTINGS_READ`.
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`], [`BridgeError::PermissionDenied`],
/// [`BridgeError::Internal`] when the store lock is poisoned, and
/// [`BridgeError::Core`] from the reads.
pub async fn list_category_rates_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<Vec<CategoryTaxRateRow>, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    require_tax_permission(ctx, &session.user_id, oz_core::permissions::SETTINGS_READ).await?;
    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let rows = run_list_category_tax_rates(&db);
    drop(db);
    rows
}

/// Set (replace) the tax rates assigned to a category in the store resolved
/// from a session token. ADR #7. TAX-01: session-scoped with `SETTINGS_EDIT`.
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`], [`BridgeError::PermissionDenied`]
/// or [`BridgeError::Core`] (unknown rate id / category id).
pub async fn set_category_rates_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: &SetCategoryTaxRatesArgs,
) -> Result<(), BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    require_tax_permission(ctx, &session.user_id, oz_core::permissions::SETTINGS_EDIT).await?;
    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    store.set_category_tax_rates(&args.category_id, &args.tax_rate_ids)?;
    drop(db);
    Ok(())
}

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
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`], [`BridgeError::PermissionDenied`]
/// or [`BridgeError::Core`] from the batch read.
pub async fn rounding_modes_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    rate_ids: &[String],
) -> Result<HashMap<String, Option<RoundingMode>>, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    require_tax_permission(ctx, &session.user_id, oz_core::permissions::SETTINGS_READ).await?;
    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let refs: Vec<&str> = rate_ids.iter().map(String::as_str).collect();
    let out = run_list_tax_rate_rounding_modes(&db, &refs);
    drop(db);
    out
}

#[cfg(test)]
#[path = "tax_tests.rs"]
mod tests;
