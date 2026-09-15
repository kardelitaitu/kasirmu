//! Customer management commands — list, get, create, update, delete.
//!
//! Delegates to `oz_core::db::Store` for all CRUD operations.

use serde::{Deserialize, Serialize};
use tauri::{State, command};

use oz_core::Customer;
use oz_core::db::Store;

use foundation::validate_not_empty;

use oz_core::permissions;

use crate::commands::authz::require_permission_for_user;
use crate::error::AppError;
use crate::state::AppState;

// ── DTO for the front-end ───────────────────────────────────────────

/// Customer as seen by the front-end.
#[derive(Debug, Serialize)]
pub struct CustomerDto {
    /// Unique identifier.
    pub id: String,
    /// Display name.
    pub name: String,
    /// Email address.
    pub email: Option<String>,
    /// Phone number.
    pub phone: Option<String>,
    /// Notes.
    pub notes: String,
    /// ISO-8601 creation timestamp.
    pub created_at: String,
    /// ISO-8601 last-update timestamp.
    pub updated_at: String,
}

impl From<Customer> for CustomerDto {
    fn from(c: Customer) -> Self {
        Self {
            id: c.id,
            name: c.name,
            email: c.email.map(|e| e.to_string()),
            phone: c.phone.map(|p| p.to_string()),
            notes: c.notes,
            created_at: c.created_at,
            updated_at: c.updated_at,
        }
    }
}

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
    let session = state.resolve_session(&session_token)?;
    require_customer_permission(&state, &session.user_id, permissions::CUSTOMERS_VIEW).await?;
    let conn = state.resolve_store(&session_token)?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let customers = store.list_customers()?;
    Ok(customers.into_iter().map(CustomerDto::from).collect())
}

// ── Get single customer ─────────────────────────────────────────────

/// Get one customer, resolved from the session token (ADR #7) — the CRM-02 residual.
///
/// The legacy command above was the only customer read still registered
/// without a session/permission/scope gate on the tablet (the desktop
/// had already moved to this shape). Gated on `customers:view` like
/// every other customer read.
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

// ── Create customer ─────────────────────────────────────────────────

/// Arguments for creating a customer in the session's store.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCustomerScopedArgs {
    /// Display name.
    pub name: String,
    /// Email address.
    pub email: Option<String>,
    /// Phone number.
    pub phone: Option<String>,
    /// Notes.
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
/// Createcustomerargs.
pub struct CreateCustomerArgs {
    /// ID of the associated user.
    pub user_id: String,
    /// Display name.
    pub name: String,
    /// Email address.
    pub email: Option<String>,
    /// Phone number.
    pub phone: Option<String>,
    /// Notes.
    pub notes: Option<String>,
}

// ── Update customer ─────────────────────────────────────────────────

/// Arguments for updating a customer in the session's store.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCustomerScopedArgs {
    /// Unique identifier.
    pub id: String,
    /// Display name.
    pub name: String,
    /// Email address.
    pub email: Option<String>,
    /// Phone number.
    pub phone: Option<String>,
    /// Notes.
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
/// Updatecustomerargs.
pub struct UpdateCustomerArgs {
    /// ID of the associated user.
    pub user_id: String,
    /// Unique identifier.
    pub id: String,
    /// Display name.
    pub name: String,
    /// Email address.
    pub email: Option<String>,
    /// Phone number.
    pub phone: Option<String>,
    /// Notes.
    pub notes: Option<String>,
}

// ── Delete customer ─────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
/// Deletecustomerargs.
pub struct DeleteCustomerArgs {
    /// ID of the associated user.
    pub user_id: String,
    /// Unique identifier.
    pub id: String,
}

// ── Store-scoped mutations (ADR #7) ─────────────────────────────────

/// Create a customer in the store resolved from a session token. ADR #7.
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

/// Bounded page of search results (CUST-06) — server-side query with an
/// explicit sort order and total count for pagination.
#[derive(Debug, Serialize)]
pub struct CustomerSearchPage {
    /// Matching customers on this page.
    pub items: Vec<CustomerDto>,
    /// Total number of matches across all pages.
    pub total: u64,
}

/// Search customers in the store resolved from a session token. ADR #7.
///
/// CUST-06: the query runs server-side (LIKE over name/email/phone) with a
/// bounded page size so the renderer never holds the full customer list.
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

/// Summary of a single sale for the history view.
#[derive(Debug, Serialize)]
pub struct CustomerSaleSummaryDto {
    /// Sale id.
    pub id: String,
    /// Total in minor units.
    pub total_minor: i64,
    /// Currency code (e.g. "USD") for the total.
    pub currency: String,
    /// Status string (e.g. "Completed").
    pub status: String,
    /// Number of line items.
    pub line_count: i64,
    /// ISO-8601 creation timestamp.
    pub created_at: String,
}

/// Loyalty summary for the history view (CUST-05).
#[derive(Debug, Serialize)]
pub struct CustomerLoyaltySummaryDto {
    /// Current redeemable points.
    pub points: i64,
    /// Lifetime points earned.
    pub lifetime_points: i64,
    /// Current tier name (None when unassigned).
    pub tier_name: Option<String>,
}

/// Read-only customer history: profile, loyalty summary, recent sales.
#[derive(Debug, Serialize)]
pub struct CustomerHistoryDto {
    /// The customer profile.
    pub customer: CustomerDto,
    /// Loyalty account summary, if any.
    pub loyalty: Option<CustomerLoyaltySummaryDto>,
    /// Recent sales for this customer (most recent first).
    pub sales: Vec<CustomerSaleSummaryDto>,
    /// Total number of sales across all pages.
    pub sales_total: u64,
}

/// Get the read-only history for a customer (CUST-05). ADR #7.
///
/// Scoped to the session's store and gated on `customers:view`. Sales are
/// bounded (max 100/page) so a heavy-spending customer cannot bloat the
/// renderer.
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
