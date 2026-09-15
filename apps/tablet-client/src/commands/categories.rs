//! Category management Tauri commands.
//!
//! The front-end surface is `list_categories` plus the session-scoped
//! `create_category_scoped`, `update_category_scoped` and
//! `delete_category_scoped` (ADR #7), which is what the Category Management UI
//! displays and manipulates against. The unscoped write variants used to be
//! listed here as well; they were retired on 2026-09-16 in the T19 thinning
//! having been registered in neither shell, so this paragraph named three
//! commands a renderer could not invoke.

use serde::{Deserialize, Serialize};
use tauri::{State, command};

use oz_core::Store;
use oz_core::permissions;

use crate::commands::authz::require_permission_for_user;
use crate::error::AppError;
use crate::state::AppState;

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

/// Fetch all categories, ordered by name.
#[command]
pub async fn list_categories(state: State<'_, AppState>) -> Result<Vec<CategoryDto>, AppError> {
    let db = state.db.lock().await;
    let store = Store::new(&db);
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

// ── Create category ──────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
/// Createcategoryargs.
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

#[derive(Debug, Serialize)]
/// Createcategoryresult.
pub struct CreateCategoryResult {
    /// Unique identifier.
    pub id: String,
}

/// Create category in the store resolved from a session token (CAT-01).
///
/// Enforces `products:create` on the session user. ADR #7.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn create_category_scoped(
    session_token: String,
    args: CreateCategoryArgs,
    state: State<'_, AppState>,
) -> Result<CreateCategoryResult, AppError> {
    let (session, conn) = state.resolve_scope(&session_token)?;
    // Permission is checked against the GLOBAL identity DB (ADR #4/#7);
    // the store-scoped DB has no user rows.
    require_category_permission(&state, &session.user_id, permissions::PRODUCTS_CREATE).await?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    store.create_category(&args.id, &args.name, &args.colour, &args.icon)?;

    Ok(CreateCategoryResult { id: args.id })
}

// ── Update category ──────────────────────────────────────────────────

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

#[derive(Debug, Serialize)]
/// Updatecategoryresult.
pub struct UpdateCategoryResult {
    /// Unique identifier.
    pub id: String,
}

/// Update a category in the store resolved from a session token (CAT-01).
///
/// Enforces `products:update` on the session user. ADR #7.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn update_category_scoped(
    session_token: String,
    args: UpdateCategoryArgs,
    state: State<'_, AppState>,
) -> Result<UpdateCategoryResult, AppError> {
    let (session, conn) = state.resolve_scope(&session_token)?;
    require_category_permission(&state, &session.user_id, permissions::PRODUCTS_UPDATE).await?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    store.update_category(&args.id, &args.name, &args.colour, &args.icon)?;
    Ok(UpdateCategoryResult { id: args.id })
}

// ── Delete category ──────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
/// Deletecategoryargs.
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

/// Delete a category in the store resolved from a session token (CAT-01/02).
///
/// Enforces `products:delete` on the session user, then deletes the
/// category with the explicit unlink policy — products in the category are
/// set to `category_id = NULL` in the same transaction, and the number of
/// unlinked products is returned to the UI. ADR #7.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn delete_category_scoped(
    session_token: String,
    args: DeleteCategoryArgs,
    state: State<'_, AppState>,
) -> Result<DeleteCategoryResult, AppError> {
    let (session, conn) = state.resolve_scope(&session_token)?;
    require_category_permission(&state, &session.user_id, permissions::PRODUCTS_DELETE).await?;
    let db = conn
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    let affected_products = store.delete_category_with_unlink(&args.id)?;
    Ok(DeleteCategoryResult { affected_products })
}

/// Verify a category permission against the global identity database.
///
/// Users and roles are global authentication records (ADR #4 / ADR #7);
/// category business data is read from the store-scoped connection after
/// this check succeeds. Mirror of `require_tax_permission` in tax.rs.
async fn require_category_permission(
    state: &AppState,
    user_id: &str,
    permission: &str,
) -> Result<(), AppError> {
    let db = state.db.lock().await;
    let store = Store::new(&db);
    require_permission_for_user(&store, user_id, permission)
}

/// Session-scoped variant of `list_categories`.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn list_categories_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<CategoryDto>, AppError> {
    let (_session, conn_arc) = state.resolve_scope(&session_token)?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
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

#[cfg(test)]
#[path = "categories_tests.rs"]
mod tests;
