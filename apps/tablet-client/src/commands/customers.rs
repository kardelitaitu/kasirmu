//! Customer management commands — list, get, create, update, delete.
//!
//! Delegates to `oz_core::db::Store` for all CRUD operations.
//!
//! # ADR #49 status — 1 of 7 doors extracted, 6 refused
//!
//! Only [`list_customers_scoped`] delegates to `oz-bridge`. The other six are
//! **refused** under ADR #49 §4 — not merely unported — and each carries a
//! note saying which parity rule it breaks:
//!
//! * `get_customer_scoped` — the bridge twin gates with the scope-aware
//!   `require_session_permission`; this shell gates with the non-scope-aware
//!   `require_customer_permission`. §4: *"Gates that are not scope-aware stay
//!   not scope-aware; an extraction is not the place to widen a gate."*
//! * `create_customer_scoped`, `update_customer_scoped`,
//!   `delete_customer_scoped`, `search_customers_scoped`,
//!   `get_customer_history_scoped` — these open the store database **before**
//!   the gate; the bridge twins gate first and open afterwards. `open_store`
//!   is not free (`platform/core/src/database/manager.rs:73-103`: on a cache
//!   miss it creates the directory, creates the database file and runs
//!   migrations), so the two orderings differ observably, and against an
//!   unopenable store they return different errors — `Internal` here,
//!   `PermissionDenied` there.
//!
//! The bridge's ordering came from the **desktop** shell, which disagreed with
//! this one long before the campaign started; the bridge is not at fault and
//! is not internally consistent about it either — `gift_cards`, `loyalty` and
//! `purchasing` all use the open-before-gate order this shell uses. This is a
//! two-shell fork for an owner to rule on. Filed in
//! `docs/records/audit-open-findings.md`.

use tauri::{State, command};

use foundation::validate_not_empty;
use oz_core::db::Store;
use oz_core::permissions;

use crate::commands::authz::require_permission_for_user;
use crate::error::AppError;
use crate::state::AppState;

// The wire DTOs and the create/update argument sets now live in `oz-bridge`.
// All ten definitions are byte-identical (verified block-by-block) and the
// orphan rule forbids a shell-side `impl From<Customer> for CustomerDto`, so
// they are re-exported rather than duplicated.
pub use oz_bridge::customers::{
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
    oz_bridge::customers::list_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

// ── Get single customer ─────────────────────────────────────────────

/// Get one customer, resolved from the session token (ADR #7) — the CRM-02 residual.
///
/// The legacy command above was the only customer read still registered
/// without a session/permission/scope gate on the tablet (the desktop
/// had already moved to this shape). Gated on `customers:view` like
/// every other customer read.
///
/// ADR #49 §4: **not delegated.** `oz_bridge::customers::get_scoped` gates
/// with the scope-aware `require_session_permission`; this body gates with
/// the non-scope-aware `require_customer_permission`. Delegating would widen
/// the gate, which §4 forbids outright.
#[command]
pub async fn get_customer_scoped(
    id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Option<CustomerDto>, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_customer_permission(&state, &session.user_id, permissions::CUSTOMERS_VIEW).await?;
    let conn = state.resolve_store(&session_token)?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let customer = store.get_customer(&id)?;
    drop(db);
    Ok(customer.map(CustomerDto::from))
}

// ── Store-scoped mutations (ADR #7) ─────────────────────────────────

/// Create a customer in the store resolved from a session token. ADR #7.
///
/// ADR #49 §4: **not delegated.** This body opens the store database before
/// the gate; `oz_bridge::customers::create_scoped` gates first.
#[command]
pub async fn create_customer_scoped(
    session_token: String,
    args: CreateCustomerScopedArgs,
    state: State<'_, AppState>,
) -> Result<CustomerDto, AppError> {
    validate_customer_fields(&args.name, args.email.as_deref(), args.phone.as_deref())?;
    let (session, conn) = state.resolve_scope(&session_token)?;
    require_customer_permission(&state, &session.user_id, permissions::CUSTOMERS_CREATE).await?;
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
/// ADR #49 §4: **not delegated.** This body opens the store database before
/// the gate; `oz_bridge::customers::update_scoped` gates first.
#[command]
pub async fn update_customer_scoped(
    session_token: String,
    args: UpdateCustomerScopedArgs,
    state: State<'_, AppState>,
) -> Result<CustomerDto, AppError> {
    validate_customer_fields(&args.name, args.email.as_deref(), args.phone.as_deref())?;
    let (session, conn) = state.resolve_scope(&session_token)?;
    require_customer_permission(&state, &session.user_id, permissions::CUSTOMERS_EDIT).await?;
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
/// ADR #49 §4: **not delegated.** This body opens the store database before
/// the gate; `oz_bridge::customers::delete_scoped` gates first.
#[command]
pub async fn delete_customer_scoped(
    session_token: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let (session, conn) = state.resolve_scope(&session_token)?;
    require_customer_permission(&state, &session.user_id, permissions::CUSTOMERS_DELETE).await?;
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
/// ADR #49 §4: **not delegated.** This body opens the store database before
/// the gate; `oz_bridge::customers::search_scoped` gates first.
#[command]
pub async fn search_customers_scoped(
    session_token: String,
    query: String,
    limit: Option<u64>,
    offset: Option<u64>,
    state: State<'_, AppState>,
) -> Result<CustomerSearchPage, AppError> {
    let (session, conn) = state.resolve_scope(&session_token)?;
    require_customer_permission(&state, &session.user_id, permissions::CUSTOMERS_VIEW).await?;
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
/// ADR #49 §4: **not delegated.** This body opens the store database before
/// the gate; `oz_bridge::customers::history_scoped` gates first.
#[command]
pub async fn get_customer_history_scoped(
    session_token: String,
    customer_id: String,
    limit: Option<u64>,
    offset: Option<u64>,
    state: State<'_, AppState>,
) -> Result<CustomerHistoryDto, AppError> {
    let (session, conn) = state.resolve_scope(&session_token)?;
    require_customer_permission(&state, &session.user_id, permissions::CUSTOMERS_VIEW).await?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    let customer =
        store
            .get_customer(&customer_id)?
            .ok_or_else(|| oz_core::error::CoreError::NotFound {
                entity: "customer",
                id: customer_id.clone(),
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
