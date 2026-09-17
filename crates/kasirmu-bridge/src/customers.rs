//! Customer command bodies (Wave B / B1) — the tauri-free half of
//! `apps/desktop-tauri/src/commands/customers.rs`.
//!
//! Key types: [`CustomerDto`] plus the create/update/delete argument sets, the
//! bounded search page (CUST-06) and the read-only history aggregate (CUST-05).
//! Key functions: the five global-identity-DB operations (`list_global`,
//! `get_global`, `create_global`, `update_global`, `delete_global`) and the
//! seven session-scoped ones (`list_scoped`, `get_scoped`, `create_scoped`,
//! `update_scoped`, `delete_scoped`, `search_scoped`, `history_scoped`),
//! each consuming a [`BridgeCtx`].
//!
//! Gate order and error paths are verbatim ports of the command bodies: field
//! validation still runs before the session is resolved, the legacy commands
//! still authorize the caller-supplied `user_id` against the global DB with
//! the non-scope-aware `Store::require_permission`, and `get_scoped` alone
//! keeps the scope-aware session gate it always had. A shim builds the
//! context, calls one function here, and maps [`BridgeError`] back to
//! `AppError` so the wire shape never moves.

use serde::{Deserialize, Serialize};

use foundation::validate_not_empty;
use kasirmu_core::Customer;
use kasirmu_core::db::Store;
use kasirmu_core::permissions;

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

// ── DTO for the front-end ────────────────────────────────────────────

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

#[derive(Debug, Deserialize)]
/// Deletecustomerargs.
pub struct DeleteCustomerArgs {
    /// ID of the associated user.
    pub user_id: String,
    /// Unique identifier.
    pub id: String,
}

/// Bounded page of search results (CUST-06) — server-side query with an
/// explicit sort order and total count for pagination.
#[derive(Debug, Serialize)]
pub struct CustomerSearchPage {
    /// Matching customers on this page.
    pub items: Vec<CustomerDto>,
    /// Total number of matches across all pages.
    pub total: u64,
}

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

/// Map a gate denial to the client's `permissionDenied` wire shape.
///
/// Local mirror of the private helper in [`crate::ctx`]: the customer gates
/// use `Store::require_permission` (not the scope-aware form), so they need
/// the same `PermissionDenied` → [`BridgeError::PermissionDenied`]
/// translation the authz seam applies.
fn map_gate_error(e: kasirmu_core::CoreError) -> BridgeError {
    match e {
        kasirmu_core::CoreError::PermissionDenied(message) => {
            BridgeError::PermissionDenied(message)
        }
        other => BridgeError::from(other),
    }
}

/// Verify a customer permission against the global identity database.
///
/// Users and roles are global authentication records (ADR #4 / ADR #7);
/// customer business data is read from the store-scoped connection after this
/// check succeeds. Verbatim port of `require_customer_permission` in the
/// desktop command module (itself a mirror of `require_tax_permission`):
/// same global-DB `Store::new`, same non-scope-aware `require_permission`.
///
/// # Errors
///
/// Returns [`BridgeError::PermissionDenied`] when the user is missing,
/// inactive, or the role does not grant `permission`; [`BridgeError::Core`]
/// on DB errors.
pub async fn require_customer_permission(
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

/// Validate the fields shared by customer create and update commands.
///
/// # Errors
///
/// Returns [`BridgeError::Invalid`] for an empty name or an email/phone that
/// the foundation value objects reject.
pub fn validate_customer_fields(
    name: &str,
    email: Option<&str>,
    phone: Option<&str>,
) -> Result<(), BridgeError> {
    validate_not_empty("name", name).map_err(|e| BridgeError::Invalid(e.to_string()))?;
    if let Some(email) = email {
        foundation::Email::new(email).map_err(|e| BridgeError::Invalid(e.to_string()))?;
    }
    if let Some(phone) = phone {
        foundation::Phone::new(phone).map_err(|e| BridgeError::Invalid(e.to_string()))?;
    }
    Ok(())
}

// ── Global-identity-DB operations (deprecated multi-store paths) ─────

/// List every customer in the global database.
///
/// **Deprecated for multi-store (ADR #7):** [`list_scoped`] resolves the
/// store from the session. No permission gate — unchanged from the shell.
///
/// # Errors
///
/// Returns [`BridgeError::Core`] when the customer query fails.
pub async fn list_global(ctx: &BridgeCtx<'_>) -> Result<Vec<CustomerDto>, BridgeError> {
    let db = ctx.lock_global().await;
    let store = Store::new(&db);
    let customers = store.list_customers()?;
    drop(db);
    Ok(customers.into_iter().map(CustomerDto::from).collect())
}

/// Get a single customer from the global database.
///
/// **Deprecated for multi-store (ADR #7):** [`get_scoped`] resolves the
/// store from the session.
///
/// # Errors
///
/// Returns [`BridgeError::Core`] when the lookup fails.
pub async fn get_global(ctx: &BridgeCtx<'_>, id: &str) -> Result<Option<CustomerDto>, BridgeError> {
    let db = ctx.lock_global().await;
    let store = Store::new(&db);
    let customer = store.get_customer(id)?;
    drop(db);
    Ok(customer.map(CustomerDto::from))
}

/// Create a customer in the global database, authorizing the
/// caller-supplied `user_id`.
///
/// **Deprecated for multi-store UI paths (ADR #7):** [`create_scoped`] takes
/// the user from the session instead of the arguments. Validation runs first,
/// then the `customers:create` gate, then the write — all on one global
/// guard, as the command body did.
///
/// # Errors
///
/// Returns [`BridgeError::Invalid`] for a rejected name/email/phone,
/// [`BridgeError::PermissionDenied`] when that user lacks
/// `customers:create`, and [`BridgeError::Core`] on a failed write.
pub async fn create_global(
    ctx: &BridgeCtx<'_>,
    args: &CreateCustomerArgs,
) -> Result<CustomerDto, BridgeError> {
    validate_customer_fields(&args.name, args.email.as_deref(), args.phone.as_deref())?;

    let db = ctx.lock_global().await;
    let store = Store::new(&db);

    store
        .require_permission(&args.user_id, permissions::CUSTOMERS_CREATE)
        .map_err(map_gate_error)?;

    let customer = store.create_customer(
        args.name.trim(),
        args.email.as_deref(),
        args.phone.as_deref(),
        args.notes.as_deref(),
    )?;
    drop(db);
    Ok(CustomerDto::from(customer))
}

/// Update a customer in the global database, authorizing the
/// caller-supplied `user_id`.
///
/// **Deprecated for multi-store UI paths (ADR #7):** [`update_scoped`] takes
/// the user from the session instead of the arguments.
///
/// # Errors
///
/// Returns [`BridgeError::Invalid`] for a rejected name/email/phone,
/// [`BridgeError::PermissionDenied`] when that user lacks
/// `customers:edit`, and [`BridgeError::Core`] (validation / not-found) on a
/// failed write.
pub async fn update_global(
    ctx: &BridgeCtx<'_>,
    args: &UpdateCustomerArgs,
) -> Result<CustomerDto, BridgeError> {
    validate_customer_fields(&args.name, args.email.as_deref(), args.phone.as_deref())?;

    let db = ctx.lock_global().await;
    let store = Store::new(&db);

    store
        .require_permission(&args.user_id, permissions::CUSTOMERS_EDIT)
        .map_err(map_gate_error)?;

    let customer = store.update_customer(
        &args.id,
        args.name.trim(),
        args.email.as_deref(),
        args.phone.as_deref(),
        args.notes.as_deref(),
    )?;
    drop(db);
    Ok(CustomerDto::from(customer))
}

/// Delete a customer from the global database, authorizing the
/// caller-supplied `user_id`.
///
/// **Deprecated for multi-store UI paths (ADR #7):** [`delete_scoped`] takes
/// the user from the session instead of the arguments.
///
/// # Errors
///
/// Returns [`BridgeError::PermissionDenied`] when that user lacks
/// `customers:delete` and [`BridgeError::Core`] (not-found) on a failed
/// delete.
pub async fn delete_global(
    ctx: &BridgeCtx<'_>,
    args: &DeleteCustomerArgs,
) -> Result<(), BridgeError> {
    let db = ctx.lock_global().await;
    let store = Store::new(&db);

    store
        .require_permission(&args.user_id, permissions::CUSTOMERS_DELETE)
        .map_err(map_gate_error)?;

    store.delete_customer(&args.id)?;
    drop(db);
    Ok(())
}

// ── Session-scoped operations (ADR #7) ───────────────────────────────

/// List customers for the store resolved from a session token. ADR #7.
///
/// CRM-02: gated on `customers:view` like every other customer read — the
/// frontend registers the screen as manager-only, but the UI role gate is not
/// a security boundary; the command must enforce the declared permission
/// itself.
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`], [`BridgeError::PermissionDenied`],
/// [`BridgeError::Internal`] when the store lock is poisoned, and
/// [`BridgeError::Core`] from the read.
pub async fn list_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<Vec<CustomerDto>, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    require_customer_permission(ctx, &session.user_id, permissions::CUSTOMERS_VIEW).await?;
    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let customers = store.list_customers()?;
    drop(db);
    Ok(customers.into_iter().map(CustomerDto::from).collect())
}

/// Scoped variant of [`get_global`] (ADR #7).
///
/// This is the only customer read that keeps the SCOPE-AWARE session gate
/// (`require_permission_for_session` in the shell): the resolved store and
/// workspace type are checked against the caller's assignment, so a scoped
/// member reading outside their scope is denied fail-closed.
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`], [`BridgeError::PermissionDenied`]
/// (missing permission OR out of scope), [`BridgeError::Internal`] when the
/// store lock is poisoned, and [`BridgeError::Core`] from the read.
pub async fn get_scoped(
    ctx: &BridgeCtx<'_>,
    id: &str,
    session_token: &str,
) -> Result<Option<CustomerDto>, BridgeError> {
    // F-017: enforce per-domain permission on this scoped command.
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::CUSTOMERS_VIEW)
        .await?;
    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let customer = store.get_customer(id)?;
    drop(db);
    Ok(customer.map(CustomerDto::from))
}

/// Create a customer in the store resolved from a session token.
///
/// The session supplies both the store database and authenticated user; no
/// caller-provided user ID is accepted. ADR #7. Field validation runs BEFORE
/// the session is resolved, exactly as the command body did, so an invalid
/// payload fails with `invalidRequest` even on a bad token.
///
/// # Errors
///
/// Returns [`BridgeError::Invalid`] for a rejected name/email/phone,
/// [`BridgeError::InvalidSession`], [`BridgeError::PermissionDenied`],
/// [`BridgeError::Internal`] and [`BridgeError::Core`] from the write.
pub async fn create_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: &CreateCustomerScopedArgs,
) -> Result<CustomerDto, BridgeError> {
    validate_customer_fields(&args.name, args.email.as_deref(), args.phone.as_deref())?;
    let session = ctx.resolve_session(session_token)?;
    require_customer_permission(ctx, &session.user_id, permissions::CUSTOMERS_CREATE).await?;
    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
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
/// # Errors
///
/// Returns [`BridgeError::Invalid`] for a rejected name/email/phone,
/// [`BridgeError::InvalidSession`], [`BridgeError::PermissionDenied`],
/// [`BridgeError::Internal`] and [`BridgeError::Core`] (validation /
/// not-found) from the write.
pub async fn update_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: &UpdateCustomerScopedArgs,
) -> Result<CustomerDto, BridgeError> {
    validate_customer_fields(&args.name, args.email.as_deref(), args.phone.as_deref())?;
    let session = ctx.resolve_session(session_token)?;
    require_customer_permission(ctx, &session.user_id, permissions::CUSTOMERS_EDIT).await?;
    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
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
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`], [`BridgeError::PermissionDenied`],
/// [`BridgeError::Internal`] and [`BridgeError::Core`] (not-found).
pub async fn delete_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    id: &str,
) -> Result<(), BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    require_customer_permission(ctx, &session.user_id, permissions::CUSTOMERS_DELETE).await?;
    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    store.delete_customer(id)?;
    Ok(())
}

// ── Search (CUST-06) ──────────────────────────────────────────────

/// Search customers in the store resolved from a session token. ADR #7.
///
/// CUST-06: the query runs server-side (LIKE over name/email/phone) with a
/// bounded page size so the renderer never holds the full customer list.
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`], [`BridgeError::PermissionDenied`],
/// [`BridgeError::Internal`] and [`BridgeError::Core`] from the search.
pub async fn search_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    query: &str,
    limit: Option<u64>,
    offset: Option<u64>,
) -> Result<CustomerSearchPage, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    require_customer_permission(ctx, &session.user_id, permissions::CUSTOMERS_VIEW).await?;
    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let (items, total) = store.search_customers(query, limit.unwrap_or(50), offset.unwrap_or(0))?;
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
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`], [`BridgeError::PermissionDenied`],
/// [`BridgeError::Internal`] and [`BridgeError::Core`] — including the
/// typed `NotFound` refusal when `customer_id` names no live row.
pub async fn history_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    customer_id: &str,
    limit: Option<u64>,
    offset: Option<u64>,
) -> Result<CustomerHistoryDto, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    require_customer_permission(ctx, &session.user_id, permissions::CUSTOMERS_VIEW).await?;
    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    let customer = store.get_customer(customer_id)?.ok_or_else(|| {
        kasirmu_core::error::CoreError::NotFound {
            entity: "customer",
            id: customer_id.to_string(),
        }
    })?;

    let loyalty =
        store
            .get_loyalty_account(customer_id)?
            .map(|details| CustomerLoyaltySummaryDto {
                points: details.account.points,
                lifetime_points: details.account.lifetime_points,
                tier_name: details.tier.map(|t| t.name),
            });

    let (sales, sales_total) =
        store.list_sales_for_customer(customer_id, limit.unwrap_or(20), offset.unwrap_or(0))?;

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

#[cfg(test)]
#[path = "customers_tests.rs"]
mod tests;
