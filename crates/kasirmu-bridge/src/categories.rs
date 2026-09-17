//! Category command bodies (Wave A / S3) — the tauri-free half of
//! `apps/desktop-client/src/commands/categories.rs`.
//!
//! Key functions: [`run_list_categories`] (pure `&Connection` body), and the
//! session-scoped [`list_scoped`], [`create_scoped`], [`update_scoped`] and
//! [`delete_scoped`] operations, each consuming a [`BridgeCtx`].
//!
//! Gate order, store construction (`Store::new`, cache-free — as the shell
//! used) and error paths are verbatim ports of the command bodies: a shim
//! builds the context, calls one function here, and maps [`BridgeError`]
//! back to `AppError` so the wire shape never moves.

use serde::{Deserialize, Serialize};

use kasirmu_core::db::Store;
use kasirmu_core::permissions;
use rusqlite::Connection;

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

/// A category DTO for the front-end.
#[derive(Debug, Serialize)]
pub struct CategoryDto {
    /// Unique identifier.
    pub id: String,
    /// Display name.
    pub name: String,
    /// Colour.
    pub colour: String,
    /// Icon.
    pub icon: String,
}

/// Arguments for creating a category (CAT-01).
#[derive(Debug, Deserialize)]
pub struct CreateCategoryArgs {
    /// Unique category id (e.g. "cat-drinks", "cat-bakery").
    pub id: String,
    /// Display name (must be unique across all categories).
    pub name: String,
    /// Hex colour string (e.g. "#06b6d4").
    pub colour: String,
    /// Icon identifier (e.g. a lucide icon name or empty string).
    pub icon: String,
}

/// Result of creating a category.
#[derive(Debug, Serialize)]
pub struct CreateCategoryResult {
    /// Unique identifier.
    pub id: String,
}

/// Arguments for updating an existing category.
#[derive(Debug, Deserialize)]
pub struct UpdateCategoryArgs {
    /// Existing category id (immutable).
    pub id: String,
    /// New display name.
    pub name: String,
    /// New hex colour string.
    pub colour: String,
    /// New icon identifier.
    pub icon: String,
}

/// Result of updating a category.
#[derive(Debug, Serialize)]
pub struct UpdateCategoryResult {
    /// Unique identifier.
    pub id: String,
}

/// Arguments for deleting a category.
#[derive(Debug, Deserialize)]
pub struct DeleteCategoryArgs {
    /// Unique identifier.
    pub id: String,
}

/// Result of deleting a category (CAT-02).
#[derive(Debug, Serialize)]
pub struct DeleteCategoryResult {
    /// Number of products unlinked from the deleted category.
    pub affected_products: i64,
}

/// Map a gate denial to the client's `permissionDenied` wire shape.
///
/// Local mirror of the private helper in [`crate::ctx`]: the category write
/// gates use `Store::require_permission` (not the scope-aware form), so they
/// need the same `PermissionDenied` → [`BridgeError::PermissionDenied`]
/// translation the authz seam applies.
fn map_gate_error(e: kasirmu_core::CoreError) -> BridgeError {
    match e {
        kasirmu_core::CoreError::PermissionDenied(message) => {
            BridgeError::PermissionDenied(message)
        }
        other => BridgeError::from(other),
    }
}

/// Verify a category permission against the global identity database.
///
/// Users and roles are global authentication records (ADR #4 / ADR #7);
/// category business data is read from the store-scoped connection after
/// this check succeeds. Port of `require_category_permission` in the desktop
/// command module: same global-DB `Store::new`, same non-scope-aware
/// `require_permission`, so a legacy user without an assignment row keeps
/// behaving exactly as before.
///
/// # Errors
///
/// Returns [`BridgeError::PermissionDenied`] when the role does not grant
/// `permission`; [`BridgeError::Core`] on DB errors.
pub async fn require_category_permission(
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

/// Business logic for listing categories over a locked store connection.
///
/// # Errors
///
/// Returns [`BridgeError::Core`] when the category query fails.
pub fn run_list_categories(conn: &Connection) -> Result<Vec<CategoryDto>, BridgeError> {
    let store = Store::new(conn);
    let categories = store.list_categories()?;

    let dtos: Vec<CategoryDto> = categories
        .into_iter()
        .map(|c| CategoryDto {
            id: c.id,
            name: c.name,
            colour: c.colour,
            icon: c.icon,
        })
        .collect();

    Ok(dtos)
}

/// Fetch all categories for the store resolved from a session token. ADR #7.
///
/// Gate order mirrors the command body: resolve the session, enforce
/// `products:read` scope-aware against the global identity DB, then open the
/// store connection and read.
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for an unknown/expired token,
/// [`BridgeError::PermissionDenied`] without `products:read`, and
/// [`BridgeError::Internal`] when the store lock is poisoned.
pub async fn list_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<Vec<CategoryDto>, BridgeError> {
    // F-017: enforce per-domain permission on this scoped command.
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::PRODUCTS_READ)
        .await?;
    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    run_list_categories(&db)
}

/// Create a category in the store resolved from a session token (CAT-01).
///
/// `products:create` is checked against the GLOBAL identity DB (ADR #4/#7)
/// before the store-scoped connection is opened — the same order as the
/// command body.
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`], [`BridgeError::PermissionDenied`]
/// or [`BridgeError::Core`] (validation / conflict on the category row).
pub async fn create_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: &CreateCategoryArgs,
) -> Result<CreateCategoryResult, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    require_category_permission(ctx, &session.user_id, permissions::PRODUCTS_CREATE).await?;
    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    store.create_category(&args.id, &args.name, &args.colour, &args.icon)?;

    Ok(CreateCategoryResult {
        id: args.id.clone(),
    })
}

/// Update a category in the store resolved from a session token (CAT-01).
///
/// Enforces `products:update` on the session user. ADR #7.
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`], [`BridgeError::PermissionDenied`]
/// or [`BridgeError::Core`] (validation / not-found on the category row).
pub async fn update_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: &UpdateCategoryArgs,
) -> Result<UpdateCategoryResult, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    require_category_permission(ctx, &session.user_id, permissions::PRODUCTS_UPDATE).await?;
    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    store.update_category(&args.id, &args.name, &args.colour, &args.icon)?;
    Ok(UpdateCategoryResult {
        id: args.id.clone(),
    })
}

/// Delete a category in the store resolved from a session token (CAT-01/02).
///
/// Enforces `products:delete` on the session user, then deletes the category
/// with the explicit unlink policy — products in the category are set to
/// `category_id = NULL` in the same transaction, and the number of unlinked
/// products is returned to the UI. ADR #7.
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`], [`BridgeError::PermissionDenied`]
/// or [`BridgeError::Core`] (not-found on the category row).
pub async fn delete_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: &DeleteCategoryArgs,
) -> Result<DeleteCategoryResult, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    require_category_permission(ctx, &session.user_id, permissions::PRODUCTS_DELETE).await?;
    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    let affected_products = store.delete_category_with_unlink(&args.id)?;
    Ok(DeleteCategoryResult { affected_products })
}

#[cfg(test)]
#[path = "categories_tests.rs"]
mod tests;
