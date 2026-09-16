//! Category management Tauri commands.
//!
//! The front-end surface is `list_categories` plus the session-scoped
//! `create_category_scoped`, `update_category_scoped` and
//! `delete_category_scoped` (ADR #7), which is what the Category Management UI
//! displays and manipulates against. The unscoped write variants used to be
//! listed here as well; they were retired on 2026-09-16 in the T19 thinning
//! having been registered in neither shell, so this paragraph named three
//! commands a renderer could not invoke.
//!
//! # ADR #49 status — measured 2026-09-16, `verify-body-parity.py` → **1 / 6**
//!
//! Read the numerator before quoting it: the one statement-identical pair is
//! `require_category_permission`, the gate helper **both** sides define and
//! which this port did not touch. It is not a door. All five doors diverge, and
//! the figure does not improve when a door is ported — delegating *creates*
//! divergence, because the shell body becomes a call the twin does not contain.
//!
//! The `--map` is load-bearing here: `list_categories` and `run_list_categories`
//! are renamed twins, and without that one entry the pair is never compared at
//! all. Naming it is what moves the denominator from 5 to 6 and reveals the
//! remaining four as the only real forks.
//!
//! The bridge twin is `crates/oz-bridge/src/categories.rs`, which documents
//! itself as the tauri-free half of the **desktop** module — and the desktop
//! has already delegated it (`apps/desktop-client/src/commands/categories.rs`
//! is a shim, 8 `oz_bridge::` references and no local `list_categories`). So
//! the bridge's shape *is* the desktop's original body, and this shell is the
//! divergent side of a two-shell fork.
//!
//! **One door is ported.** [`list_categories`] shares
//! [`oz_bridge::categories::run_list_categories`] — §1b.9's "port the query,
//! keep the door": this door resolves no session, so it is ledger-neutral, and
//! only the statement moves. The instrument still prints this pair as
//! DIVERGENT, and that is a gap in its normaliser rather than a fork: a `run_*`
//! helper *receives* the connection, so it has no `CTX.db.lock()` statement
//! where the door keeps one. That absent lock line is the shape §1b.9 asks for,
//! so **no `run_*` port can ever read clean** — expect it and read the diff.
//! [`CategoryDto`] crossed the boundary with it and is re-exported, so
//! `use super::*;` in `categories_tests.rs` keeps resolving it and no field
//! list is duplicated across two crates.
//!
//! **Four doors are REFUSED**, and three of them for one reason: this shell
//! calls `state.resolve_scope`, which resolves the session **and opens the
//! store** in a single call, and gates *after*; the bridge gates on
//! `resolve_session` and only then calls `resolve_store`. Delegating would drop
//! the deny-path store open and change the error a caller receives against an
//! unopenable store, because `open_store` creates the directory, the database
//! file and runs migrations on a cache miss. ADR #49 §4 pins gate and lock
//! order, so those bodies stay tablet-native. [`list_categories_scoped`] is
//! refused on two further grounds of its own — see its note.

use serde::{Deserialize, Serialize};
use tauri::{State, command};

use oz_core::Store;
use oz_core::permissions;

use crate::commands::authz::require_permission_for_user;
use crate::error::AppError;
use crate::state::AppState;

/// A category DTO for the front-end.
///
/// Re-exported from the bridge rather than declared here: the two definitions
/// were field-for-field identical (`id` / `name` / `colour` / `icon`, all
/// `String`) and **neither side carried `#[serde(rename_all)]`**, so the wire
/// spelling is unchanged. Nothing outside this module names the type.
pub use oz_bridge::categories::CategoryDto;

/// Fetch all categories, ordered by name.
///
/// The query is shared with the bridge rather than duplicated (ADR #49 §1b.9 —
/// "port the query, keep the door"). This door resolves **no** session, so
/// delegating its whole body would be ledger-neutral; what moves is the
/// statement. `run_list_categories` is the same `Store::list_categories` call
/// and the same `CategoryDto` mapping, and the returned DTO is the same type
/// this module re-exports, so the wire shape does not move.
#[command]
pub async fn list_categories(state: State<'_, AppState>) -> Result<Vec<CategoryDto>, AppError> {
    let db = state.db.lock().await;
    oz_bridge::categories::run_list_categories(&db).map_err(AppError::from)
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
///
/// # ADR #49 NOT APPLIED, deliberately
///
/// Refused 2026-09-16. `state.resolve_scope` below resolves the session **and
/// opens the store** in one call, and the gate runs after it; the bridge twin
/// gates on `ctx.resolve_session` and only then calls `ctx.resolve_store`
/// (`crates/oz-bridge/src/categories.rs:190-192`). Delegating would remove a
/// deny-path side effect and change the error a caller sees against an
/// unopenable store — `open_store` creates the directory, the database file and
/// runs migrations on a cache miss. §4 pins gate and lock order, so the body
/// stays tablet-native. The same refusal covers `update_category_scoped` and
/// `delete_category_scoped`.
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
///
/// # ADR #49 NOT APPLIED, deliberately
///
/// Refused 2026-09-16 on the same ground as `create_category_scoped`: this
/// shell opens the store before its gate, the bridge twin gates first
/// (`crates/oz-bridge/src/categories.rs:218-220`), and §4 pins that order.
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
///
/// # ADR #49 NOT APPLIED, deliberately
///
/// Refused 2026-09-16 on the same ground as `create_category_scoped`: this
/// shell opens the store before its gate, the bridge twin gates first
/// (`crates/oz-bridge/src/categories.rs:248-250`), and §4 pins that order.
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
///
/// # ADR #49 NOT APPLIED, deliberately — refused twice over
///
/// Refused 2026-09-16 on two independent grounds.
///
/// 1. **Case 2, not case 3.** This door resolves a session (`resolve_scope`
///    below) and names **no** permission, so it is on the debt ledger. Its twin
///    is not a same-name match — the bridge calls it `list_scoped`
///    (`crates/oz-bridge/src/categories.rs:160`), which is why an unmapped
///    parity run prints **`1 / 1`** — the lone pair being the shared gate
///    helper — and lists all five doors as `shell-only` facing five
///    bridge-only twins. Delegating would flip the ledger row to `Gated` and
///    **erase debt** rather than pay it (§1).
/// 2. **An EXTRA gate.** The twin adds `permissions::PRODUCTS_READ`
///    (`crates/oz-bridge/src/categories.rs:164-167`, marked `F-017`) which this
///    shell has never enforced, and §4 forbids adding a gate inside an
///    extraction as plainly as removing one. It is easy to miss because the
///    write doors' gates do match by name.
///
/// Ground 2 is a **parity gap rather than a policy question**: the desktop shell
/// has already delegated this module (`apps/desktop-client/src/commands/categories.rs`
/// is a shim), so the bridge's gate *is* the desktop's shipped behaviour and the
/// permission is already chosen. §1b.13 sanctions copying it — but that is a
/// **gating change, not an extraction**, so it must land in its own commit
/// together with the ledger row it pays (`DEBT_CEILING` and
/// `RESOLVES_SESSION_NAMES_NO_PERMISSION`, both decremented).
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
