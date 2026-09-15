use tauri::{State, command};

use oz_core::Table;
use oz_core::db::Store;

use crate::commands::authz::require_permission_for_session;
use crate::error::AppError;
use crate::state::AppState;

/// List tables resolved from a session token. ADR #7.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn list_tables_scoped(
    session_token: String,
    section: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<Table>, AppError> {
    let (_session, conn_arc) = state.resolve_scope(&session_token)?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    let tables = store.list_tables(section.as_deref())?;
    drop(db);
    Ok(tables)
}

/// Get one table resolved from a session token. ADR #7.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn get_table_scoped(
    session_token: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<Option<Table>, AppError> {
    let (_session, conn_arc) = state.resolve_scope(&session_token)?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    let table = store.get_table(&id)?;
    drop(db);
    Ok(table)
}

// ── Scoped writes (T8: session-derived identity, F-017 parity) ────────
//
// All six scoped writes below declared a required `user_id: String` and gated on
// `require_permission_for_user(&store, &user_id, TABLES_*)`, while every wrapper
// in `ui/src/api/tables.ts` sends only `{ sessionToken, … }` — `create_table_scoped`
// `{sessionToken, table}`, `update_table_scoped` `{sessionToken, table}`,
// `delete_table_scoped` `{sessionToken, id}`, `update_table_status_scoped`
// `{sessionToken, id, status}`, `assign_table_order_scoped`
// `{sessionToken, tableId, saleId}`, `release_table_scoped` `{sessionToken, tableId}`.
// Tauri camelCase-converts outer argument names and passes nothing else, so the
// missing key was a hard rejection (`tauri-2.11.3/src/ipc/command.rs:100`)
// before any body ran — the whole table-management write surface was dead on
// this shell, the third occurrence after settings (T4-1) and terminals (T7-2).
// The actor now comes from the session, matching `oz_bridge::tables`, whose
// twins never took a caller-named id (`crates/oz-bridge/src/tables.rs:64` resolves
// the session and calls `require_session_permission(&session, TABLES_CREATE)`),
// and the check is awaited before the store lock rather than inside it.
//
// The six unscoped variants that used to sit above took a caller-named `user_id`
// and were registered in neither shell (see T7-4 for the same dead surface in
// terminals). They are now deleted rather than merely left alone, which is the
// stronger form of the same conclusion: the caller-named-actor door cannot be
// re-opened through a function that no longer exists. Recovered 2026-09-16 in the
// T19 thinning, which is also why `require_permission_for_user` is no longer
// imported here -- other modules still gate on it, this one no longer can.

/// Create a table resolved from a session token. ADR #7.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn create_table_scoped(
    session_token: String,
    args: Table,
    state: State<'_, AppState>,
) -> Result<Table, AppError> {
    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, oz_core::permissions::TABLES_CREATE).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    let table = store.create_table(&args)?;
    drop(db);
    Ok(table)
}

/// Update a table resolved from a session token. ADR #7.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn update_table_scoped(
    session_token: String,
    table: Table,
    state: State<'_, AppState>,
) -> Result<Table, AppError> {
    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, oz_core::permissions::TABLES_EDIT).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    let result = store.update_table(&table)?;
    drop(db);
    Ok(result)
}

/// Delete a table resolved from a session token. ADR #7.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn delete_table_scoped(
    session_token: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, oz_core::permissions::TABLES_DELETE).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    store.delete_table(&id)?;
    drop(db);
    Ok(())
}

/// Update a table status resolved from a session token. ADR #7.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn update_table_status_scoped(
    session_token: String,
    id: String,
    status: String,
    state: State<'_, AppState>,
) -> Result<Table, AppError> {
    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, oz_core::permissions::TABLES_CLOSE).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    let table = store.update_table_status(&id, &status)?;
    drop(db);
    Ok(table)
}

/// Assign an order to a table, resolved from a session token. ADR #7.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn assign_table_order_scoped(
    session_token: String,
    table_id: String,
    sale_id: String,
    state: State<'_, AppState>,
) -> Result<Table, AppError> {
    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, oz_core::permissions::TABLES_ASSIGN).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    let table = store.assign_table_order(&table_id, &sale_id)?;
    drop(db);
    Ok(table)
}

/// Release a table resolved from a session token. ADR #7.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn release_table_scoped(
    session_token: String,
    table_id: String,
    state: State<'_, AppState>,
) -> Result<Table, AppError> {
    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, oz_core::permissions::TABLES_CLOSE).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    let table = store.release_table(&table_id)?;
    drop(db);
    Ok(table)
}

/// List sections resolved from a session token. ADR #7.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn list_sections_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<String>, AppError> {
    let (_session, conn_arc) = state.resolve_scope(&session_token)?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    let sections = store.list_sections()?;
    drop(db);
    Ok(sections)
}

#[cfg(test)]
#[path = "tables_tests.rs"]
mod tests;
