//! Customer management commands — list, get, create, update, delete.
//!
//! Delegates to `kasirmu_core::db::Store` for all CRUD operations.
//!
//! # ADR #49 status — 2 of 7 doors extracted, 5 refused
//!
//! [`list_customers_scoped`] and — since 2026-09-25 — [`get_customer_scoped`]
//! delegate to `kasirmu-bridge`. The remaining five are **refused** under ADR #49 §4,
//! not merely unported, and for one reason: their gate ORDER is fixed but their gate
//! KIND still differs from no shell, because the bridge twins gate with the same
//! non-scope-aware helper this module uses.
//!
//! * `create_customer_scoped`, `update_customer_scoped`,
//!   `delete_customer_scoped`, `search_customers_scoped`,
//!   `get_customer_history_scoped` — the gate-ORDER half, **FIXED 2026-09-24 under
//!   R10's explicit folding-in of BR-X4.** Each now runs session -> gate -> store,
//!   matching its bridge twin. The order mattered because `open_store` is not free
//!   (`platform/core/src/database/manager.rs:73-103`: on a cache miss it creates the
//!   directory, creates the database file and runs migrations), so opening first let
//!   an UNAUTHORIZED caller do filesystem work and read `Internal("opening store
//!   db")` where the bridge answers `PermissionDenied` — an authorisation failure
//!   surfacing as an infrastructure error. That leak is what closed it.
//!
//! **The gate-KIND half is now CLOSED, and it turned out to be one door rather than
//! six.** R10 shape 1 (owner, 2026-09-20; `done-todo-owner-rulings.md:258`) named
//! exactly one case: `get_customer_scoped` gated non-scope-aware where its bridge
//! twin gated scope-aware. Measured at this tip, the bridge's `customers.rs` gates
//! scope-aware in **one** place only — `get_scoped` at `:430` — while
//! `list_scoped` (`:400`) and the four mutations (`:461`, `:491`, `:519`, `:548`,
//! `:582`) call the same non-scope-aware `require_customer_permission` this module
//! does. So the two shells already AGREED on the other five, and there was no
//! divergence to adopt; the honest size of R10's gate-KIND half is 1 door, not 6.
//! That is a correction to the census the ruling table carried, recorded here rather
//! than back-edited there.
//!
//! Adopting the scope-aware form by delegating also makes the two shells agree by
//! construction instead of by two hand-kept bodies, which is what §4 actually protects.
//! A scoped member whose session is out of scope is now denied fail-closed on the
//! tablet exactly as on the desktop.
//!
//! The bridge's ordering came from the **desktop** shell, which disagreed with
//! this one long before the campaign started; the bridge is not at fault and
//! is not internally consistent about it either — `gift_cards`, `loyalty` and
//! `purchasing` all use the open-before-gate order this shell used. The ruling that
//! settled it is R10 in `done-todo-owner-rulings.md:272`, and it chose the
//! **scope-aware, gate-first** form as authoritative — so the bridge's ordering was
//! the design and this shell's was the divergence, which is why the five commands
//! above were corrected rather than the bridge. Those three bridge siblings are
//! now the remaining instance of the same shape under R10's sweep, not a
//! counter-example to it. Filed in `docs/records/audit-open-findings.md`.

use tauri::{State, command};

use foundation::validate_not_empty;
use kasirmu_core::db::Store;
use kasirmu_core::permissions;

use crate::commands::authz::require_permission_for_user;
use crate::error::AppError;
use crate::state::AppState;

// The wire DTOs and the create/update argument sets now live in `kasirmu-bridge`.
// All ten definitions are byte-identical (verified block-by-block) and the
// orphan rule forbids a shell-side `impl From<Customer> for CustomerDto`, so
// they are re-exported rather than duplicated.
pub use kasirmu_bridge::customers::{
    CreateCustomerArgs, CreateCustomerScopedArgs, CustomerDto, CustomerHistoryDto,
    CustomerLoyaltySummaryDto, CustomerSaleSummaryDto, CustomerSearchPage, DeleteCustomerArgs,
    UpdateCustomerArgs, UpdateCustomerScopedArgs,
};

// ── List customers ──────────────────────────────────────────────────

/// List customers for the store resolved from a session token. ADR #7.
///
/// CRM-02: gated on `customers:view` like every other customer read — the
/// frontend registers the screen as manager-only, but the UI role gate is
/// not a security boundary; the command must enforce the declared
/// permission itself.
#[command]
pub async fn list_customers_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<CustomerDto>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::customers::list_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

// ── Get single customer ─────────────────────────────────────────────

/// Get one customer, resolved from the session token (ADR #7) — the CRM-02 residual.
///
/// The legacy command was the only customer read registered without a
/// session/permission/scope gate on the tablet (the desktop had already
/// moved to this shape). Gated on `customers:view` like every other
/// customer read.
///
/// **Delegated 2026-09-25 under R10's gate-KIND half** (`done-todo-owner-rulings.md:272`),
/// which rules the scope-aware gate authoritative wherever the two shells disagree.
/// This body used to gate with the non-scope-aware `require_customer_permission`
/// while `kasirmu_bridge::customers::get_scoped` gated with the scope-aware
/// `require_session_permission` — the last divergence in this module, and ADR #49 §4
/// forbids an extraction from narrowing a gate. R10 makes the scope-aware form the
/// design, so the shell adopts it by delegating rather than by re-implementing: the
/// two shells now agree by construction, and a scoped member whose session is out of
/// scope is denied fail-closed here exactly as on the desktop.
///
/// `get_customer_scoped` is the only customer door whose bridge twin was already
/// scope-aware; the create/update/delete/search/history twins gate with the same
/// non-scope-aware helper this module still uses, so no other door moved.
#[command]
pub async fn get_customer_scoped(
    id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Option<CustomerDto>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::customers::get_scoped(&ctx, &id, &session_token)
        .await
        .map_err(Into::into)
}

// ── Store-scoped mutations (ADR #7) ─────────────────────────────────

/// Create a customer in the store resolved from a session token. ADR #7.
///
/// ADR #49 §4: **not delegated.** Gate order fixed under R10 (BR-X4):
/// session -> gate -> store, matching `kasirmu_bridge::customers::create_scoped`, which gates first.
#[command]
pub async fn create_customer_scoped(
    session_token: String,
    args: CreateCustomerScopedArgs,
    state: State<'_, AppState>,
) -> Result<CustomerDto, AppError> {
    validate_customer_fields(&args.name, args.email.as_deref(), args.phone.as_deref())?;
    // Gate BEFORE opening the store (BR-X4 / R10): `resolve_scope` calls
    // `open_store`, which on a cache miss creates the data directory and the db
    // file and runs migrations. Doing that first lets an UNAUTHORIZED caller both
    // trigger filesystem work and see `Internal("opening store db")` where the
    // bridge answers `PermissionDenied` — an authz failure leaking as an
    // infrastructure error. The bridge's `create_scoped` resolves the session,
    // gates, and only then opens the store; this now matches it.
    let session = state.resolve_session(&session_token)?;
    require_customer_permission(&state, &session.user_id, permissions::CUSTOMERS_CREATE).await?;
    let conn = state.resolve_store(&session_token)?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let customer = store.create_customer(
        args.name.trim(),
        args.email.as_deref(),
        args.phone.as_deref(),
        args.notes.as_deref(),
    )?;
    Ok(CustomerDto::from(customer))
}

/// Update a customer in the store resolved from a session token. ADR #7.
///
/// ADR #49 §4: **not delegated.** Gate order fixed under R10 (BR-X4):
/// session -> gate -> store, matching `kasirmu_bridge::customers::update_scoped`, which gates first.
#[command]
pub async fn update_customer_scoped(
    session_token: String,
    args: UpdateCustomerScopedArgs,
    state: State<'_, AppState>,
) -> Result<CustomerDto, AppError> {
    validate_customer_fields(&args.name, args.email.as_deref(), args.phone.as_deref())?;
    // Gate BEFORE opening the store (BR-X4 / R10). `resolve_scope` calls
    // `open_store`, which on a cache miss creates the data dir and db file and
    // runs migrations; doing that first lets an unauthorized caller trigger
    // filesystem work and see an `Internal` db error where the bridge answers
    // `PermissionDenied`. Matches `kasirmu_bridge::customers::*` gate-first order.
    let session = state.resolve_session(&session_token)?;
    require_customer_permission(&state, &session.user_id, permissions::CUSTOMERS_EDIT).await?;
    let conn = state.resolve_store(&session_token)?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let customer = store.update_customer(
        &args.id,
        args.name.trim(),
        args.email.as_deref(),
        args.phone.as_deref(),
        args.notes.as_deref(),
    )?;
    Ok(CustomerDto::from(customer))
}

/// Delete a customer from the store resolved from a session token. ADR #7.
///
/// ADR #49 §4: **not delegated.** Gate order fixed under R10 (BR-X4):
/// session -> gate -> store, matching `kasirmu_bridge::customers::delete_scoped`, which gates first.
#[command]
pub async fn delete_customer_scoped(
    session_token: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    // Gate BEFORE opening the store (BR-X4 / R10). `resolve_scope` calls
    // `open_store`, which on a cache miss creates the data dir and db file and
    // runs migrations; doing that first lets an unauthorized caller trigger
    // filesystem work and see an `Internal` db error where the bridge answers
    // `PermissionDenied`. Matches `kasirmu_bridge::customers::*` gate-first order.
    let session = state.resolve_session(&session_token)?;
    require_customer_permission(&state, &session.user_id, permissions::CUSTOMERS_DELETE).await?;
    let conn = state.resolve_store(&session_token)?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    store.delete_customer(&id)?;
    Ok(())
}

// ── Search (CUST-06) ──────────────────────────────────────────────

/// Search customers in the store resolved from a session token. ADR #7.
///
/// CUST-06: the query runs server-side (LIKE over name/email/phone) with a
/// bounded page size so the renderer never holds the full customer list.
///
/// ADR #49 §4: **not delegated.** Gate order fixed under R10 (BR-X4):
/// session -> gate -> store, matching `kasirmu_bridge::customers::search_scoped`, which gates first.
#[command]
pub async fn search_customers_scoped(
    session_token: String,
    query: String,
    limit: Option<u64>,
    offset: Option<u64>,
    state: State<'_, AppState>,
) -> Result<CustomerSearchPage, AppError> {
    // Gate BEFORE opening the store (BR-X4 / R10). `resolve_scope` calls
    // `open_store`, which on a cache miss creates the data dir and db file and
    // runs migrations; doing that first lets an unauthorized caller trigger
    // filesystem work and see an `Internal` db error where the bridge answers
    // `PermissionDenied`. Matches `kasirmu_bridge::customers::*` gate-first order.
    let session = state.resolve_session(&session_token)?;
    require_customer_permission(&state, &session.user_id, permissions::CUSTOMERS_VIEW).await?;
    let conn = state.resolve_store(&session_token)?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let (items, total) =
        store.search_customers(&query, limit.unwrap_or(50), offset.unwrap_or(0))?;
    Ok(CustomerSearchPage {
        items: items.into_iter().map(CustomerDto::from).collect(),
        total,
    })
}

// ── Customer history (CUST-05) ────────────────────────────────────

/// Get the read-only history for a customer (CUST-05). ADR #7.
///
/// Scoped to the session's store and gated on `customers:view`. Sales are
/// bounded (max 100/page) so a heavy-spending customer cannot bloat the
/// renderer.
///
/// ADR #49 §4: **not delegated.** Gate order fixed under R10 (BR-X4):
/// session -> gate -> store, matching `kasirmu_bridge::customers::history_scoped`, which gates first.
#[command]
pub async fn get_customer_history_scoped(
    session_token: String,
    customer_id: String,
    limit: Option<u64>,
    offset: Option<u64>,
    state: State<'_, AppState>,
) -> Result<CustomerHistoryDto, AppError> {
    // Gate BEFORE opening the store (BR-X4 / R10). `resolve_scope` calls
    // `open_store`, which on a cache miss creates the data dir and db file and
    // runs migrations; doing that first lets an unauthorized caller trigger
    // filesystem work and see an `Internal` db error where the bridge answers
    // `PermissionDenied`. Matches `kasirmu_bridge::customers::*` gate-first order.
    let session = state.resolve_session(&session_token)?;
    require_customer_permission(&state, &session.user_id, permissions::CUSTOMERS_VIEW).await?;
    let conn = state.resolve_store(&session_token)?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    let customer = store.get_customer(&customer_id)?.ok_or_else(|| {
        kasirmu_core::error::CoreError::NotFound {
            entity: "customer",
            id: customer_id.clone(),
        }
    })?;

    let loyalty =
        store
            .get_loyalty_account(&customer_id)?
            .map(|details| CustomerLoyaltySummaryDto {
                points: details.account.points,
                lifetime_points: details.account.lifetime_points,
                tier_name: details.tier.map(|t| t.name),
            });

    let (sales, sales_total) =
        store.list_sales_for_customer(&customer_id, limit.unwrap_or(20), offset.unwrap_or(0))?;

    Ok(CustomerHistoryDto {
        customer: CustomerDto::from(customer),
        loyalty,
        sales: sales
            .into_iter()
            .map(|s| CustomerSaleSummaryDto {
                id: s.id,
                total_minor: s.total.minor_units,
                currency: s.total.currency.to_string(),
                status: format!("{:?}", s.status),
                line_count: s.line_count,
                created_at: s.created_at,
            })
            .collect(),
        sales_total,
    })
}

/// Users and roles are global authentication records (ADR #4 / ADR #7);
/// customer business data is read from the store-scoped connection after
/// this check succeeds. Mirror of `require_tax_permission` in tax.rs.
async fn require_customer_permission(
    state: &AppState,
    user_id: &str,
    permission: &str,
) -> Result<(), AppError> {
    let db = state.db.lock().await;
    let store = Store::new(&db);
    require_permission_for_user(&store, user_id, permission)
}

/// Validate fields shared by customer create and update commands.
fn validate_customer_fields(
    name: &str,
    email: Option<&str>,
    phone: Option<&str>,
) -> Result<(), AppError> {
    validate_not_empty("name", name).map_err(|e| AppError::Invalid(e.to_string()))?;
    if let Some(email) = email {
        foundation::Email::new(email).map_err(|e| AppError::Invalid(e.to_string()))?;
    }
    if let Some(phone) = phone {
        foundation::Phone::new(phone).map_err(|e| AppError::Invalid(e.to_string()))?;
    }
    Ok(())
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "customers_tests.rs"]
mod tests;
